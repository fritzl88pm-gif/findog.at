import { createHash, randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { parseBoundedMultipart } from "@/lib/attachments/bounded-multipart";
import {
  acquireHeavyAttachmentRequest,
  type HeavyAttachmentRequestLease,
} from "@/lib/attachments/heavy-request-admission";
import { createDeadline } from "@/lib/deadline";
import { UserVisibleError } from "@/lib/errors";
import {
  matchesScanningFileSignature,
  MAX_SCANNING_IMAGE_BYTES,
  MAX_SCANNING_IMAGES,
  MAX_SCANNING_INSTRUCTIONS_CHARS,
  MAX_SCANNING_MULTIPART_BYTES,
  MAX_SCANNING_PDF_BYTES,
  MAX_SCANNING_PDFS,
  sanitizeScanningFilename,
  SCANNING_IMAGE_MIME_TYPES,
  SCANNING_RATE_LIMIT_REQUESTS,
  SCANNING_RATE_LIMIT_WINDOW_MS,
} from "@/lib/scanning/config";
import { analyzeScanningBatch, ScanningProviderError, scanningModelForProvider } from "@/lib/scanning/openrouter";
import { ScanningRateLimiter } from "@/lib/scanning/rate-limit";
import { getScanningSettings } from "@/lib/scanning/settings";
import { encodeScanningStreamEvent, SCANNING_STREAM_CONTENT_TYPE } from "@/lib/scanning/stream";
import type { ScanningFileStatus, ScanningUpload } from "@/lib/scanning/types";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const SCANNING_INGRESS_TIMEOUT_MS = 120_000;

const rateLimit = new ScanningRateLimiter({
  maxRequests: SCANNING_RATE_LIMIT_REQUESTS,
  windowMs: SCANNING_RATE_LIMIT_WINDOW_MS,
});

function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" },
  });
}

function enforceRateLimit(userId: string): void {
  rateLimit.consume(userId);
}

function validateMultipartHeader(request: Request): string {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new UserVisibleError("Die Scanning-Anfrage ist ungültig.", 400);
  }
  const rawLength = request.headers.get("content-length");
  if (rawLength !== null) {
    if (!/^\d+$/u.test(rawLength)) throw new UserVisibleError("Die Scanning-Anfrage ist ungültig.", 400);
    const length = Number(rawLength);
    if (!Number.isSafeInteger(length) || length <= 0) {
      throw new UserVisibleError("Die Scanning-Anfrage ist ungültig.", 400);
    }
    if (length > MAX_SCANNING_MULTIPART_BYTES) {
      throw new UserVisibleError("Die Scanning-Anfrage ist zu groß.", 413);
    }
  }
  return contentType;
}

async function parseUploads(
  request: Request,
  contentType: string,
  signal: AbortSignal,
): Promise<{
  uploads: ScanningUpload[];
  statuses: ScanningFileStatus[];
  instructions: string;
}> {
  const multipart = await parseBoundedMultipart({
    request,
    signal,
    contentType,
    maxBytes: MAX_SCANNING_MULTIPART_BYTES,
    maxFileAggregateBytes:
      MAX_SCANNING_IMAGES * MAX_SCANNING_IMAGE_BYTES
      + MAX_SCANNING_PDFS * MAX_SCANNING_PDF_BYTES,
    fileRules: {
      image: {
        maxCount: MAX_SCANNING_IMAGES,
        maxBytes: MAX_SCANNING_IMAGE_BYTES,
        tooManyMessage: "Bitte maximal fünf Bilder hochladen.",
        tooLargeMessage: "Ein Bild darf maximal 5 MB groß sein.",
      },
      pdf: {
        maxCount: MAX_SCANNING_PDFS,
        maxBytes: MAX_SCANNING_PDF_BYTES,
        tooManyMessage: "Bitte maximal fünf PDFs hochladen.",
        tooLargeMessage: "Ein PDF darf maximal 10 MB groß sein.",
      },
    },
    fieldRules: {
      instructions: {
        maxCount: 1,
        maxBytes: MAX_SCANNING_INSTRUCTIONS_CHARS * 4,
        invalidMessage: "Die zusätzlichen Anweisungen sind ungültig.",
      },
    },
    emptyMessage: "Die Scanning-Anfrage ist leer.",
    invalidMessage: "Die Scanning-Anfrage enthält keine gültigen Formulardaten.",
    tooLargeMessage: "Die Scanning-Anfrage ist zu groß.",
    fileAggregateTooLargeMessage: "Die Scanning-Dateien sind zusammen zu groß.",
  });
  const images = multipart.files.filter((file) => file.fieldName === "image");
  const pdfs = multipart.files.filter((file) => file.fieldName === "pdf");
  const instructionEntry = multipart.fields.find((field) => field.name === "instructions");
  const instructions = instructionEntry
    ? instructionEntry.value
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
      .trim()
    : "";
  if (instructions.length > MAX_SCANNING_INSTRUCTIONS_CHARS) {
    throw new UserVisibleError(
      "Zusätzliche Anweisungen dürfen maximal 1.000 Zeichen lang sein.",
      400,
    );
  }
  if (images.length + pdfs.length === 0) {
    throw new UserVisibleError("Bitte mindestens ein Bild oder PDF hochladen.", 400);
  }
  if ([...images, ...pdfs].some((file) => file.sizeBytes <= 0)) {
    throw new UserVisibleError("Eine hochgeladene Datei ist ungültig oder leer.", 400);
  }

  const candidates = [
    ...images.map((file) => ({ file, kind: "image" as const })),
    ...pdfs.map((file) => ({ file, kind: "pdf" as const })),
  ];
  const uploads: ScanningUpload[] = [];
  const statuses: ScanningFileStatus[] = [];
  const hashes = new Set<string>();
  for (const candidate of candidates) {
    const mimeType = candidate.file.mimeType.toLowerCase();
    if (candidate.kind === "image" && !SCANNING_IMAGE_MIME_TYPES.has(mimeType)) {
      throw new UserVisibleError("Erlaubt sind JPEG-, PNG-, WebP- und GIF-Bilder.", 400);
    }
    if (candidate.kind === "pdf" && mimeType !== "application/pdf") {
      throw new UserVisibleError("Bitte nur PDF-Dateien im PDF-Feld hochladen.", 400);
    }
    const maximum = candidate.kind === "image" ? MAX_SCANNING_IMAGE_BYTES : MAX_SCANNING_PDF_BYTES;
    if (candidate.file.sizeBytes > maximum) {
      throw new UserVisibleError(
        candidate.kind === "image" ? "Ein Bild darf maximal 5 MB groß sein." : "Ein PDF darf maximal 10 MB groß sein.",
        413,
      );
    }
    const bytes = candidate.file.bytes;
    if (!matchesScanningFileSignature(mimeType, bytes)) {
      throw new UserVisibleError("Dateityp und Dateiinhalt stimmen nicht überein.", 400);
    }
    const id = randomUUID();
    const name = sanitizeScanningFilename(candidate.file.name);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (hashes.has(sha256)) {
      statuses.push({ id, name, kind: candidate.kind, status: "duplicate" });
      continue;
    }
    hashes.add(sha256);
    uploads.push({
      id,
      kind: candidate.kind,
      name,
      mimeType,
      sizeBytes: candidate.file.sizeBytes,
      sha256,
      bytes,
    });
    statuses.push({ id, name, kind: candidate.kind, status: "failed", detail: "Noch nicht ausgewertet" });
  }
  return { uploads, statuses, instructions };
}

function fileError(error: unknown): string {
  if (error instanceof ScanningProviderError) return error.message;
  if (error instanceof UserVisibleError) return error.message;
  return "Die Dokumentauswertung konnte nicht abgeschlossen werden.";
}

export async function POST(request: Request) {
  let admissionLease: HeavyAttachmentRequestLease | undefined;
  let ingressDeadline: ReturnType<typeof createDeadline> | undefined;
  try {
    if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
      throw new UserVisibleError("Diese Scanning-Anfrage ist nicht erlaubt.", 403);
    }
    const contentType = validateMultipartHeader(request);
    const supabase = getSupabaseServerClient();
    if (!supabase) throw new UserVisibleError("Scanning ist derzeit nicht verfügbar.", 503);
    const user = await authenticateSupabaseRequest(request, supabase);

    // Resolve settings before reserving the single large-body slot. A stalled
    // settings lookup must not retain an upload or block every other request.
    const settings = await getScanningSettings(supabase);
    ingressDeadline = createDeadline(SCANNING_INGRESS_TIMEOUT_MS, {
      parentSignal: request.signal,
      timeoutMessage: "Der Upload hat zu lange gedauert. Bitte erneut versuchen.",
    });
    ingressDeadline.throwIfExpired();
    try {
      admissionLease = acquireHeavyAttachmentRequest();
    } catch (error) {
      void request.body?.cancel(error).catch(() => undefined);
      throw error;
    }
    // Overload rejections must not consume the user's five-request quota.
    enforceRateLimit(user.id);
    const parsed = await parseUploads(request, contentType, ingressDeadline.signal);
    ingressDeadline.throwIfExpired();
    ingressDeadline.dispose();
    ingressDeadline = undefined;

    const encoder = new TextEncoder();
    const lifetime = new AbortController();
    const onRequestAbort = () => lifetime.abort(request.signal.reason);
    if (request.signal.aborted) onRequestAbort();
    else request.signal.addEventListener("abort", onRequestAbort, { once: true });

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: Parameters<typeof encodeScanningStreamEvent>[0]) => {
          if (!lifetime.signal.aborted) controller.enqueue(encoder.encode(encodeScanningStreamEvent(event)));
        };
        send({ type: "progress", stage: "validating", completed: 0, total: parsed.uploads.length });

        try {
          send({
            type: "progress",
            stage: "extracting",
            completed: 0,
            total: parsed.uploads.length,
            fileName: parsed.uploads.length === 1 ? parsed.uploads[0]?.name : `${parsed.uploads.length} Dateien`,
          });
          const report = await analyzeScanningBatch(
            parsed.uploads,
            lifetime.signal,
            parsed.instructions,
            settings.modelId,
            settings.prompt,
            settings.scanningProvider,
          );
          const completedIds = new Set(parsed.uploads.map((upload) => upload.id));
          const statuses = parsed.statuses.map((status): ScanningFileStatus => (
            completedIds.has(status.id)
              ? { id: status.id, name: status.name, kind: status.kind, status: "completed" }
              : status
          ));
          send({
            type: "progress",
            stage: "extracting",
            completed: parsed.uploads.length,
            total: parsed.uploads.length,
          });
          send({
            type: "progress",
            stage: "organizing",
            completed: parsed.uploads.length,
            total: parsed.uploads.length,
          });
          send({ type: "final", report, files: statuses, model: scanningModelForProvider(settings.scanningProvider, settings.modelId) });
          controller.close();
        } catch (error) {
          if (!lifetime.signal.aborted) {
            send({ type: "error", error: fileError(error) });
          }
          try { controller.close(); } catch { /* Client already disconnected. */ }
        } finally {
          request.signal.removeEventListener("abort", onRequestAbort);
          admissionLease?.release();
        }
      },
      cancel(reason) {
        lifetime.abort(reason);
        request.signal.removeEventListener("abort", onRequestAbort);
        admissionLease?.release();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": SCANNING_STREAM_CONTENT_TYPE,
        "Cache-Control": "private, no-store, max-age=0, no-transform",
        Vary: "Authorization",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (!request.bodyUsed) void request.body?.cancel(error).catch(() => undefined);
    ingressDeadline?.dispose();
    admissionLease?.release();
    if (error instanceof UserVisibleError) return json({ error: error.message }, error.status);
    return json({ error: "Die Scanning-Anfrage konnte nicht verarbeitet werden." }, 500);
  }
}
