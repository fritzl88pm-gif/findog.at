import { createHash, randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
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
import { analyzeScanningBatch, ScanningProviderError } from "@/lib/scanning/openrouter";
import { getScanningSettings } from "@/lib/scanning/settings";
import { encodeScanningStreamEvent, SCANNING_STREAM_CONTENT_TYPE } from "@/lib/scanning/stream";
import type { ScanningFileStatus, ScanningUpload } from "@/lib/scanning/types";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type RateEntry = { startedAt: number; count: number };
const rateLimit = new Map<string, RateEntry>();

function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" },
  });
}

function enforceRateLimit(userId: string): void {
  const now = Date.now();
  const current = rateLimit.get(userId);
  if (!current || now - current.startedAt >= SCANNING_RATE_LIMIT_WINDOW_MS) {
    rateLimit.set(userId, { startedAt: now, count: 1 });
    return;
  }
  if (current.count >= SCANNING_RATE_LIMIT_REQUESTS) {
    throw new UserVisibleError("Zu viele Scanning-Anfragen. Bitte kurz warten.", 429);
  }
  current.count += 1;
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

async function readBoundedBody(request: Request): Promise<Uint8Array<ArrayBuffer>> {
  if (!request.body) throw new UserVisibleError("Die Scanning-Anfrage ist leer.", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_SCANNING_MULTIPART_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new UserVisibleError("Die Scanning-Anfrage ist zu groß.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function uploadedFile(value: FormDataEntryValue): value is File {
  return typeof File !== "undefined" && value instanceof File;
}

async function parseUploads(request: Request, contentType: string): Promise<{
  uploads: ScanningUpload[];
  statuses: ScanningFileStatus[];
  instructions: string;
}> {
  const body = await readBoundedBody(request);
  let formData: FormData;
  try {
    formData = await new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: body.buffer,
    }).formData();
  } catch {
    throw new UserVisibleError("Die Scanning-Anfrage enthält keine gültigen Formulardaten.", 400);
  }
  if ([...formData.keys()].some((key) => key !== "image" && key !== "pdf" && key !== "instructions")) {
    throw new UserVisibleError("Die Scanning-Anfrage enthält unbekannte Felder.", 400);
  }
  const images = formData.getAll("image");
  const pdfs = formData.getAll("pdf");
  const instructionEntries = formData.getAll("instructions");
  if (instructionEntries.length > 1 || instructionEntries.some((entry) => typeof entry !== "string")) {
    throw new UserVisibleError("Die zusätzlichen Anweisungen sind ungültig.", 400);
  }
  const instructions = typeof instructionEntries[0] === "string"
    ? instructionEntries[0]
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
      .trim()
    : "";
  if (instructions.length > MAX_SCANNING_INSTRUCTIONS_CHARS) {
    throw new UserVisibleError(
      "Zusätzliche Anweisungen dürfen maximal 1.000 Zeichen lang sein.",
      400,
    );
  }
  if (images.length > MAX_SCANNING_IMAGES) {
    throw new UserVisibleError("Bitte maximal fünf Bilder hochladen.", 400);
  }
  if (pdfs.length > MAX_SCANNING_PDFS) {
    throw new UserVisibleError("Bitte maximal fünf PDFs hochladen.", 400);
  }
  if (images.length + pdfs.length === 0) {
    throw new UserVisibleError("Bitte mindestens ein Bild oder PDF hochladen.", 400);
  }
  if ([...images, ...pdfs].some((entry) => !uploadedFile(entry) || entry.size <= 0)) {
    throw new UserVisibleError("Eine hochgeladene Datei ist ungültig oder leer.", 400);
  }

  const candidates = [
    ...images.map((file) => ({ file: file as File, kind: "image" as const })),
    ...pdfs.map((file) => ({ file: file as File, kind: "pdf" as const })),
  ];
  const uploads: ScanningUpload[] = [];
  const statuses: ScanningFileStatus[] = [];
  const hashes = new Set<string>();
  for (const candidate of candidates) {
    const mimeType = candidate.file.type.toLowerCase();
    if (candidate.kind === "image" && !SCANNING_IMAGE_MIME_TYPES.has(mimeType)) {
      throw new UserVisibleError("Erlaubt sind JPEG-, PNG-, WebP- und GIF-Bilder.", 400);
    }
    if (candidate.kind === "pdf" && mimeType !== "application/pdf") {
      throw new UserVisibleError("Bitte nur PDF-Dateien im PDF-Feld hochladen.", 400);
    }
    const maximum = candidate.kind === "image" ? MAX_SCANNING_IMAGE_BYTES : MAX_SCANNING_PDF_BYTES;
    if (candidate.file.size > maximum) {
      throw new UserVisibleError(
        candidate.kind === "image" ? "Ein Bild darf maximal 5 MB groß sein." : "Ein PDF darf maximal 10 MB groß sein.",
        413,
      );
    }
    const bytes = new Uint8Array(await candidate.file.arrayBuffer());
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
      sizeBytes: candidate.file.size,
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
  try {
    if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
      throw new UserVisibleError("Diese Scanning-Anfrage ist nicht erlaubt.", 403);
    }
    const contentType = validateMultipartHeader(request);
    const supabase = getSupabaseServerClient();
    if (!supabase) throw new UserVisibleError("Scanning ist derzeit nicht verfügbar.", 503);
    const user = await authenticateSupabaseRequest(request, supabase);
    enforceRateLimit(user.id);
    const parsed = await parseUploads(request, contentType);

    // Resolve scanning settings server-side, do not trust client-provided model/prompt
    const settings = await getScanningSettings(supabase);

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
          send({ type: "final", report, files: statuses, model: settings.modelId });
          controller.close();
        } catch (error) {
          if (!lifetime.signal.aborted) {
            send({ type: "error", error: fileError(error) });
          }
          try { controller.close(); } catch { /* Client already disconnected. */ }
        } finally {
          request.signal.removeEventListener("abort", onRequestAbort);
        }
      },
      cancel(reason) {
        lifetime.abort(reason);
        request.signal.removeEventListener("abort", onRequestAbort);
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
    if (error instanceof UserVisibleError) return json({ error: error.message }, error.status);
    return json({ error: "Die Scanning-Anfrage konnte nicht verarbeitet werden." }, 500);
  }
}
