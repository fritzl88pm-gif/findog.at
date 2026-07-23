import { createHash, randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import {
  buildAttachmentContext,
  type AttachmentInput,
} from "@/lib/attachments/context";
import { extractDocumentsWithConfiguredModel } from "@/lib/attachments/document-fallback";
import { processMineruBatch } from "@/lib/attachments/mineru-cloud";
import { describeImage } from "@/lib/attachments/gemini-image-context";
import {
  createDeadline,
  runWithTimeout,
} from "@/lib/deadline";
import { UserVisibleError } from "@/lib/errors";
import {
  extractStreamStableBfgGzCandidates,
  linkVerifiedBfgCitations,
  resolveBfgCitation,
  type BfgCitationResolution,
  type VerifiedBfgCitation,
} from "@/lib/findok/bfg-citations";
import {
  FRED_NATIVE_STREAM_CONTENT_TYPE,
  encodeFredNativeStreamEvent,
} from "@/lib/fred-native-stream";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getScanningSettings } from "@/lib/scanning/settings";
import {
  FredEmbedConfigurationError,
  FredEmbedUpstreamError,
  mintFredEmbedSession,
  readFredEmbedServerConfig,
  readFredProModelId,
} from "@/lib/weknora/fred-embed";
import { parseFredConversationSummary } from "@/lib/weknora/fred-history";
import {
  createFredUpstreamSession,
  deriveFredSessionSignature,
  fetchFredUpstreamConfig,
  fredVisitorId,
  openFredUpstreamStream,
  relayFredWebhookEvent,
  stopFredUpstreamSession,
  type FredUpstreamSession,
} from "@/lib/weknora/fred-native";
import {
  FRED_CONTENT_TRANSFORMATION,
  mergeFredResearchStep,
  mergeFredSources,
  parseWeKnoraResearchEvent,
  transformWeKnoraAnswer,
  type FredResearchStep,
  type FredSourceReference,
} from "@/lib/weknora/fred-research";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_REQUEST_BYTES = 64 * 1_024;
const MAX_QUERY_LENGTH = 50_000;
const MAX_IMAGE_UPLOADS = 5;
const MAX_FILE_UPLOADS = 5;
const MAX_IMAGE_UPLOAD_BYTES = 10 * 1_024 * 1_024;
const MAX_FILE_UPLOAD_BYTES = 20 * 1_024 * 1_024;
const MAX_MULTIPART_REQUEST_BYTES = MAX_REQUEST_BYTES
  + MAX_IMAGE_UPLOADS * MAX_IMAGE_UPLOAD_BYTES
  + MAX_FILE_UPLOADS * MAX_FILE_UPLOAD_BYTES
  + 1_024 * 1_024; // Multipart boundaries and per-part headers.
const MAX_REQUESTS_PER_WINDOW = 30;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1_000;
const TOTAL_TIMEOUT_MS = 600_000;
const PREPROCESSING_TIMEOUT_MS = 240_000;
const FRED_RESERVE_MS = 300_000;
const ATTACHMENT_HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_LIVE_BFG_CITATIONS = 20;
const MAX_CONCURRENT_LIVE_BFG_VERIFICATIONS = 4;

type RateLimitEntry = { count: number; resetAt: number };
type ParsedFredChatRequest = {
  query: string;
  conversationId: string;
  webSearchEnabled: boolean;
  proModeEnabled: boolean;
  attachments: FindogAttachment[];
};
type FredConversationRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  weknora_channel_id: string;
  weknora_session_id: string;
};

type FindogAttachment = {
  kind: "image" | "file";
  name: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  bytes: Uint8Array;
};

const rateLimit = new Map<string, RateLimitEntry>();
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const FILE_MIME_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const MIME_TO_ATTACHMENT_KIND: Record<string, AttachmentInput["kind"]> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Vary: "Authorization",
    },
  });
}

function requireSameSiteRequest(request: Request): void {
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    throw new UserVisibleError("Diese Fred-Anfrage ist nicht erlaubt.", 403);
  }
}

function enforceRateLimit(userId: string): void {
  const now = Date.now();
  for (const [key, entry] of rateLimit) {
    if (entry.resetAt <= now) rateLimit.delete(key);
  }
  const current = rateLimit.get(userId);
  if (!current) {
    rateLimit.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return;
  }
  if (current.count >= MAX_REQUESTS_PER_WINDOW) {
    throw new UserVisibleError("Zu viele Fred-Anfragen. Bitte kurz warten.", 429);
  }
  current.count += 1;
}

function validatedRequestFields(value: unknown): Omit<ParsedFredChatRequest, "attachments"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UserVisibleError("Die Fred-Anfrage ist ungültig.", 400);
  }
  const body = value as Record<string, unknown>;
  const query = typeof body.query === "string" ? body.query.trim() : "";
  const conversationId = typeof body.conversationId === "string" ? body.conversationId.trim() : "";
  const webSearchEnabled = body.webSearchEnabled === true;
  if (body.webSearchEnabled !== undefined && typeof body.webSearchEnabled !== "boolean") {
    throw new UserVisibleError("Die Websuche-Einstellung ist ungültig.", 400);
  }
  const proModeEnabled = body.proModeEnabled === true;
  if (body.proModeEnabled !== undefined && typeof body.proModeEnabled !== "boolean") {
    throw new UserVisibleError("Die Fred-Pro-Einstellung ist ungültig.", 400);
  }
  if (!query || query.length > MAX_QUERY_LENGTH) {
    throw new UserVisibleError("Bitte gib eine gültige Frage an Fred ein.", 400);
  }
  if (conversationId && !UUID_PATTERN.test(conversationId)) {
    throw new UserVisibleError("Die Fred-Unterhaltung ist ungültig.", 400);
  }
  return { query, conversationId, webSearchEnabled, proModeEnabled };
}

function sanitizedFilename(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .replace(/[\\/]/gu, "_")
    .trim()
    .slice(0, 255);
  return normalized || "datei";
}

function uploadedFile(value: FormDataEntryValue): value is File {
  return typeof File !== "undefined" && value instanceof File;
}

function startsWithBytes(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((value, index) => bytes[offset + index] === value);
}

function attachmentTypeCategory(mimeType: string): string {
  const categories: Record<string, string> = {
    "application/pdf": "PDF",
    "application/msword": "DOC",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
    "application/vnd.ms-excel": "XLS",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
    "application/vnd.ms-powerpoint": "PPT",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
    "text/plain": "TXT",
    "text/markdown": "Markdown",
    "text/csv": "CSV",
    "image/jpeg": "JPEG",
    "image/png": "PNG",
    "image/gif": "GIF",
    "image/webp": "WebP",
  };
  return categories[mimeType] ?? "Datei";
}

function hasExpectedAttachmentSignature(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === "application/pdf") {
    return startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  }
  if (mimeType === "image/png") {
    return startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (mimeType === "image/jpeg") {
    return startsWithBytes(bytes, [0xff, 0xd8, 0xff]);
  }
  if (mimeType === "image/gif") {
    return startsWithBytes(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61])
      || startsWithBytes(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  }
  if (mimeType === "image/webp") {
    return startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46])
      && startsWithBytes(bytes, [0x57, 0x45, 0x42, 0x50], 8);
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    || mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    || mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04]);
  }
  if (
    mimeType === "application/msword"
    || mimeType === "application/vnd.ms-excel"
    || mimeType === "application/vnd.ms-powerpoint"
  ) {
    return startsWithBytes(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  }
  if (mimeType === "text/plain" || mimeType === "text/markdown" || mimeType === "text/csv") {
    return !bytes.includes(0);
  }
  return false;
}

async function validatedAttachment(file: File, kind: "image" | "file"): Promise<FindogAttachment> {
  const name = sanitizedFilename(file.name);
  let mimeType: string;
  if (kind === "image") {
    mimeType = file.type.toLowerCase();
    if (!IMAGE_MIME_TYPES.has(mimeType)) {
      throw new UserVisibleError("Erlaubt sind JPEG-, PNG-, GIF- und WebP-Bilder.", 400);
    }
    if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
      throw new UserVisibleError("Ein Bild darf maximal 10 MB groß sein.", 413);
    }
  } else {
    const extension = /\.[^.]+$/u.exec(name.toLowerCase())?.[0] ?? "";
    mimeType = FILE_MIME_BY_EXTENSION[extension] ?? "";
    if (!mimeType) {
      throw new UserVisibleError(
        "Erlaubt sind PDF-, Word-, Text-, Markdown-, CSV-, Excel- und PowerPoint-Dateien.",
        400,
      );
    }
    if (file.size > MAX_FILE_UPLOAD_BYTES) {
      throw new UserVisibleError("Eine Datei darf maximal 20 MB groß sein.", 413);
    }
  }
  if (file.size < 1) {
    throw new UserVisibleError("Leere Dateien können nicht hochgeladen werden.", 400);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasExpectedAttachmentSignature(bytes, mimeType)) {
    const category = attachmentTypeCategory(mimeType);
    throw new UserVisibleError(`${name}: Inhalt entspricht nicht dem erwarteten ${category}-Dateityp.`, 400);
  }
  return {
    kind,
    name,
    mimeType,
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes,
  };
}

function attachmentToInput(a: FindogAttachment): AttachmentInput {
  const mappedKind = MIME_TO_ATTACHMENT_KIND[a.mimeType];
  if (!mappedKind) {
    throw new UserVisibleError(
      `${sanitizedFilename(a.name)}: nicht unterstützter Anhangstyp.`,
      400,
    );
  }
  return {
    kind: mappedKind,
    name: a.name,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    sha256: a.sha256,
    bytes: a.bytes,
  };
}

function attachmentMetadata(a: FindogAttachment) {
  return {
    kind: a.kind,
    name: a.name,
    mime_type: a.mimeType,
    size_bytes: a.sizeBytes,
    sha256: a.sha256,
  };
}

async function readJsonRequestBody(request: Request): Promise<ParsedFredChatRequest> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    throw new UserVisibleError("Die Fred-Anfrage ist zu groß.", 413);
  }
  if (!request.body) {
    throw new UserVisibleError("Die Fred-Anfrage enthält kein JSON.", 400);
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new UserVisibleError("Die Fred-Anfrage ist zu groß.", 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new UserVisibleError("Die Fred-Anfrage enthält kein gültiges JSON.", 400);
  }
  return { ...validatedRequestFields(value), attachments: [] };
}

async function readMultipartRequestBody(request: Request): Promise<ParsedFredChatRequest> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MULTIPART_REQUEST_BYTES) {
    throw new UserVisibleError("Die Fred-Anfrage ist zu groß.", 413);
  }
  if (!request.body) throw new UserVisibleError("Die Fred-Anfrage ist leer.", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_MULTIPART_REQUEST_BYTES) {
      await reader.cancel();
      throw new UserVisibleError("Die Fred-Anfrage ist zu groß.", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const contentType = request.headers.get("content-type") ?? "";
  let formData: FormData;
  try {
    formData = await new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: bytes,
    }).formData();
  } catch {
    throw new UserVisibleError("Die Fred-Anfrage enthält keine gültigen Formulardaten.", 400);
  }
  const payload = formData.get("payload");
  if (typeof payload !== "string") {
    throw new UserVisibleError("Die Fred-Anfrage enthält kein gültiges Payload.", 400);
  }
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    throw new UserVisibleError("Die Fred-Anfrage enthält kein gültiges JSON-Payload.", 400);
  }
  const images = formData.getAll("image");
  const files = formData.getAll("attachment");
  if (images.some((entry) => !uploadedFile(entry)) || files.some((entry) => !uploadedFile(entry))) {
    throw new UserVisibleError("Ein Fred-Anhang ist ungültig.", 400);
  }
  if (images.length > MAX_IMAGE_UPLOADS) {
    throw new UserVisibleError("Bitte maximal fünf Bilder pro Anfrage hochladen.", 400);
  }
  if (files.length > MAX_FILE_UPLOADS) {
    throw new UserVisibleError("Bitte maximal fünf Dateien pro Anfrage hochladen.", 400);
  }
  const attachments = await Promise.all([
    ...images.map((entry) => validatedAttachment(entry as File, "image")),
    ...files.map((entry) => validatedAttachment(entry as File, "file")),
  ]);
  return { ...validatedRequestFields(value), attachments };
}

async function readRequestBody(request: Request): Promise<ParsedFredChatRequest> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.startsWith("multipart/form-data")) {
    return readMultipartRequestBody(request);
  }
  if (contentType.startsWith("application/json")) {
    return readJsonRequestBody(request);
  }
  throw new UserVisibleError("Die Fred-Anfrage muss JSON oder Formulardaten enthalten.", 415);
}

async function recordEvent(options: {
  supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>;
  userId: string;
  channelId: string;
  sessionId: string;
  eventId: string;
  eventType: "message_sent" | "message_received";
  content: string;
  occurredAt: string;
  attachments?: FindogAttachment[];
  webSearchEnabled?: boolean;
  proModeEnabled?: boolean;
  displayContent?: string;
  researchTrace?: FredResearchStep[];
  sourceReferences?: FredSourceReference[];
}) {
  const payload = {
    client_id: options.userId,
    channel_id: options.channelId,
    session_id: options.sessionId,
    event_id: options.eventId,
    event_type: options.eventType,
    content: options.content,
    occurred_at: options.occurredAt,
    attachments: (options.attachments ?? []).map(attachmentMetadata),
    web_search_enabled: options.webSearchEnabled ?? false,
    pro_mode_enabled: options.proModeEnabled ?? false,
    ...(options.displayContent !== undefined ? {
      display_content: options.displayContent,
      research_trace: options.researchTrace ?? [],
      source_references: options.sourceReferences ?? [],
      content_transformation: FRED_CONTENT_TRANSFORMATION,
    } : {}),
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await options.supabase.rpc("record_fred_native_event", { payload });
    if (!error) return parseFredConversationSummary(data);
  }
  throw new UserVisibleError("Der Fred-Verlauf konnte nicht gespeichert werden.", 503);
}

async function resolveUpstreamSession(options: {
  supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>;
  userId: string;
  conversationId: string;
  channelId: string;
  publishToken: string;
  session: Awaited<ReturnType<typeof mintFredEmbedSession>>;
  config: ReturnType<typeof readFredEmbedServerConfig>;
  signal: AbortSignal;
}): Promise<FredUpstreamSession> {
  if (!options.conversationId) {
    return createFredUpstreamSession({
      session: options.session,
      config: options.config,
      signal: options.signal,
    });
  }

  const { data, error } = await options.supabase
    .from("fred_conversations")
    .select("id,title,created_at,updated_at,weknora_channel_id,weknora_session_id")
    .eq("id", options.conversationId)
    .eq("client_id", options.userId)
    .maybeSingle();
  if (error) {
    throw new UserVisibleError("Die Fred-Unterhaltung konnte nicht geladen werden.", 503);
  }
  if (!data) {
    throw new UserVisibleError("Die Fred-Unterhaltung wurde nicht gefunden.", 404);
  }
  const row = data as FredConversationRow;
  if (row.weknora_channel_id !== options.channelId) {
    throw new UserVisibleError("Diese Fred-Unterhaltung gehört zu einer älteren Kanalkonfiguration.", 409);
  }
  return {
    id: row.weknora_session_id,
    signature: deriveFredSessionSignature(
      { channelId: options.channelId, publishToken: options.publishToken },
      row.weknora_session_id,
    ),
  };
}

function upstreamDelta(value: unknown): { content?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const event = value as Record<string, unknown>;
  const responseType = typeof event.response_type === "string" ? event.response_type : "";
  if (responseType === "answer" || event.type === "answer") {
    return { content: typeof event.content === "string" ? event.content : undefined };
  }
  if (!responseType && typeof event.content === "string") {
    return { content: event.content };
  }
  return {};
}

function sseData(frame: string): string | null {
  const lines = frame.split(/\r?\n/u);
  const data = lines
    .filter((line) => line === "data" || line.startsWith("data:"))
    .map((line) => line.startsWith("data:") ? line.slice(5).trimStart() : "")
    .join("\n");
  return data || null;
}

export async function POST(request: Request) {
  let lifetimeAbort: AbortController | undefined;
  let onRequestAbort: (() => void) | undefined;
  let cleanupResources: (() => void) | undefined;
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) throw new UserVisibleError("Fred ist derzeit nicht verfügbar.", 503);
    const user = await authenticateSupabaseRequest(request, supabase);
    requireSameSiteRequest(request);
    enforceRateLimit(user.id);
    const body = await readRequestBody(request);

    lifetimeAbort = new AbortController();
    const deadline = createDeadline(TOTAL_TIMEOUT_MS, {
      parentSignal: lifetimeAbort.signal,
      timeoutMessage: "Die Verarbeitung der Anfrage hat zu lange gedauert.",
    });
    let attachmentHeartbeat: ReturnType<typeof setInterval> | undefined;
    let activeUpstreamReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let requestUpstreamStop: (() => Promise<void>) | undefined;
    let upstreamCancelRequested = false;
    let cleanedUp = false;
    const clearAttachmentHeartbeat = () => {
      if (attachmentHeartbeat !== undefined) {
        clearInterval(attachmentHeartbeat);
        attachmentHeartbeat = undefined;
      }
    };
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearAttachmentHeartbeat();
      deadline.dispose();
      if (onRequestAbort) request.signal.removeEventListener("abort", onRequestAbort);
    };
    cleanupResources = cleanup;
    const stopAndCancelUpstream = async (reason?: unknown) => {
      const stopPromise = requestUpstreamStop?.().catch(() => undefined) ?? Promise.resolve();
      let cancelPromise = Promise.resolve();
      if (activeUpstreamReader && !upstreamCancelRequested) {
        upstreamCancelRequested = true;
        cancelPromise = activeUpstreamReader.cancel(reason).catch(() => undefined);
      }
      await Promise.all([stopPromise, cancelPromise]);
    };
    onRequestAbort = () => {
      lifetimeAbort?.abort(request.signal.reason);
      const upstreamCleanup = stopAndCancelUpstream(request.signal.reason);
      cleanup();
      void upstreamCleanup;
    };
    request.signal.addEventListener("abort", onRequestAbort, { once: true });

    const encoder = new TextEncoder();
    const send = (controller: ReadableStreamDefaultController<Uint8Array>, event: Parameters<typeof encodeFredNativeStreamEvent>[0]) => {
      if (!lifetimeAbort!.signal.aborted) {
        controller.enqueue(encoder.encode(encodeFredNativeStreamEvent(event)));
      }
    };

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let upstreamQuery = body.query;

        if (body.attachments.length > 0) {
          send(controller, { type: "status", label: "Anhänge werden analysiert …" });
          attachmentHeartbeat = setInterval(() => {
            send(controller, { type: "status", label: "Anhänge werden analysiert …" });
          }, ATTACHMENT_HEARTBEAT_INTERVAL_MS);
          try {
            const attachmentInputs = body.attachments.map(attachmentToInput);
            const combined = await runWithTimeout(
              async (signal) => buildAttachmentContext(body.query, attachmentInputs, {
                mineruProvider: (files) => processMineruBatch(files, { signal }),
                geminiProvider: (uri) => describeImage(uri, { signal }),
                documentFallbackProvider: async (files) => {
                  const settings = await getScanningSettings(supabase);
                  return extractDocumentsWithConfiguredModel(files, {
                    model: settings.modelId,
                    signal,
                  });
                },
              }),
              {
                deadline,
                timeoutMs: PREPROCESSING_TIMEOUT_MS,
                reserveMs: FRED_RESERVE_MS,
                timeoutMessage: "Die Anhänge konnten nicht analysiert werden.",
              },
            );
            upstreamQuery = combined;
          } catch (error) {
            if (!lifetimeAbort!.signal.aborted) {
              send(controller, {
                type: "error",
                error: error instanceof UserVisibleError
                  ? error.message
                  : "Die Anhänge konnten nicht analysiert werden.",
              });
            }
            try { controller.close(); } catch { /* already closed */ }
            cleanup();
            return;
          } finally {
            clearAttachmentHeartbeat();
          }
          send(controller, { type: "status", label: "Fred bearbeitet die Frage …" });
        }

        let acceptingCitationUpdates = true;
        try {
          const config = readFredEmbedServerConfig();
          const embedSession = await mintFredEmbedSession({ signal: deadline.signal });
          const [upstreamConfig, upstreamSession] = await Promise.all([
            fetchFredUpstreamConfig({ session: embedSession, config, signal: deadline.signal }),
            resolveUpstreamSession({
              supabase,
              userId: user.id,
              conversationId: body.conversationId,
              channelId: config.channelId,
              publishToken: config.publishToken,
              session: embedSession,
              config,
              signal: deadline.signal,
            }),
          ]);
          if (body.webSearchEnabled && !upstreamConfig.allowWebSearch) {
            throw new UserVisibleError("Die Websuche ist für diesen Fred-Kanal nicht freigeschaltet.", 400);
          }
          const summaryModelId = body.proModeEnabled
            ? readFredProModelId()
            : "";

          const userOccurredAt = new Date().toISOString();
          const conversation = await recordEvent({
            supabase,
            userId: user.id,
            channelId: config.channelId,
            sessionId: upstreamSession.id,
            eventId: randomUUID(),
            eventType: "message_sent",
            content: body.query,
            occurredAt: userOccurredAt,
            attachments: body.attachments,
            webSearchEnabled: body.webSearchEnabled,
            proModeEnabled: body.proModeEnabled,
          });
          void relayFredWebhookEvent({
            session: embedSession,
            config,
            upstreamSession,
            type: "message_sent",
            content: body.query,
            signal: deadline.signal,
          });

          const upstream = await openFredUpstreamStream({
            session: embedSession,
            config,
            upstreamConfig,
            upstreamSession,
            visitorId: fredVisitorId(config.publishToken, user.id),
            query: upstreamQuery,
            webSearchEnabled: body.webSearchEnabled,
            signal: deadline.signal,
            summaryModelId,
          });
          const upstreamReader = upstream.body!.getReader();
          activeUpstreamReader = upstreamReader;
          const decoder = new TextDecoder();
          let assistantMessageId = "";
          let stopRequested = false;
          requestUpstreamStop = async () => {
            if (!assistantMessageId || stopRequested) return;
            stopRequested = true;
            await stopFredUpstreamSession({
              session: embedSession,
              config,
              upstreamSession,
              messageId: assistantMessageId,
              signal: AbortSignal.timeout(5_000),
            });
          };

          let buffer = "";
          let rawAnswer = "";
          let visibleAnswer = "";
          let researchTrace: FredResearchStep[] = [];
          let sourceReferences: FredSourceReference[] = [];
          let activeCitationVerifications = 0;
          const citationTasks = new Map<string, Promise<void>>();
          const verifiedCitations = new Map<string, VerifiedBfgCitation>();
          const citationQueue: Array<{
            gz: string;
            resolve: (result: BfgCitationResolution) => void;
          }> = [];
          const pumpCitationQueue = () => {
            while (
              activeCitationVerifications < MAX_CONCURRENT_LIVE_BFG_VERIFICATIONS
              && citationQueue.length > 0
            ) {
              const queued = citationQueue.shift();
              if (!queued) break;
              activeCitationVerifications += 1;
              void resolveBfgCitation(queued.gz, fetch, { signal: deadline.signal })
                .then(queued.resolve)
                .finally(() => {
                  activeCitationVerifications -= 1;
                  pumpCitationQueue();
                });
            }
          };
          const queuedCitationResolution = (gz: string) => new Promise<BfgCitationResolution>((resolve) => {
            citationQueue.push({ gz, resolve });
            pumpCitationQueue();
          });
          const beginCitationVerification = (text: string, streamComplete = false) => {
            for (const gz of extractStreamStableBfgGzCandidates(text, streamComplete)) {
              if (
                citationTasks.has(gz)
                || citationTasks.size >= MAX_LIVE_BFG_CITATIONS
              ) continue;
              const task = queuedCitationResolution(gz).then((resolution) => {
                if (!acceptingCitationUpdates || resolution.status !== "verified") return;
                verifiedCitations.set(gz, resolution);
                sourceReferences = mergeFredSources(sourceReferences, [{
                  kind: "web",
                  url: resolution.fullTextUrl,
                  title: `BFG ${resolution.gz}: ${resolution.title}`.slice(0, 512),
                }]);
                const verificationStep: FredResearchStep = {
                  id: `findok:${resolution.gz}`,
                  kind: "sources",
                  status: "completed",
                  label: `BFG-Fundstelle ${resolution.gz} verifiziert`,
                };
                researchTrace = mergeFredResearchStep(researchTrace, verificationStep);
                send(controller, { type: "research", step: verificationStep });
                const linkedAnswer = linkVerifiedBfgCitations(
                  visibleAnswer,
                  [...verifiedCitations.values()],
                  { target: "fullText" },
                );
                if (linkedAnswer !== visibleAnswer) send(controller, { type: "replace", answer: linkedAnswer });
              });
              citationTasks.set(gz, task);
            }
          };
          const processFrame = (frame: string) => {
            const data = sseData(frame);
            if (!data || data === "[DONE]") return;
            let parsed: unknown;
            try {
              parsed = JSON.parse(data);
            } catch {
              throw new UserVisibleError("Fred hat ein ungültiges Streaming-Ereignis geliefert.", 502);
            }
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              const upstreamEvent = parsed as Record<string, unknown>;
              if (
                upstreamEvent.response_type === "agent_query"
                && typeof upstreamEvent.assistant_message_id === "string"
              ) {
                assistantMessageId = upstreamEvent.assistant_message_id;
              }
            }
            const research = parseWeKnoraResearchEvent(parsed);
            if (research.fatalError) {
              throw new UserVisibleError("Fred konnte die Anfrage nicht abschließen.", 502);
            }
            if (research.unsupported) {
              throw new UserVisibleError("Diese Fred-Aktion benötigt eine zusätzliche Bestätigung, die hier noch nicht unterstützt wird.", 409);
            }
            sourceReferences = mergeFredSources(sourceReferences, research.sources);
            if (research.step) {
              researchTrace = mergeFredResearchStep(researchTrace, research.step);
              send(controller, { type: "research", step: research.step });
            }
            const event = upstreamDelta(parsed);
            if (event.content) {
              rawAnswer += event.content;
              const transformed = transformWeKnoraAnswer(rawAnswer, { streaming: true });
              sourceReferences = mergeFredSources(sourceReferences, transformed.sources);
              if (transformed.text.startsWith(visibleAnswer)) {
                const delta = transformed.text.slice(visibleAnswer.length);
                visibleAnswer = transformed.text;
                if (delta) send(controller, { type: "delta", content: delta });
              }
              beginCitationVerification(transformed.text);
            }
          };

          send(controller, { type: "conversation", conversation });
          while (true) {
            const { value, done } = await upstreamReader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const frames = buffer.split(/\r?\n\r?\n/u);
            buffer = frames.pop() ?? "";
            for (const frame of frames) processFrame(frame);
          }
          buffer += decoder.decode();
          if (buffer.trim()) processFrame(buffer);
          const finalTransformation = transformWeKnoraAnswer(rawAnswer);
          const plainFinalAnswer = finalTransformation.text.trim();
          sourceReferences = mergeFredSources(sourceReferences, finalTransformation.sources);
          if (!plainFinalAnswer) {
            throw new UserVisibleError("Fred hat keine Antwort geliefert.", 502);
          }
          beginCitationVerification(plainFinalAnswer, true);
          await Promise.all(citationTasks.values());
          const finalAnswer = linkVerifiedBfgCitations(
            plainFinalAnswer,
            [...verifiedCitations.values()],
            { target: "fullText" },
          );
          const finalConversation = await recordEvent({
            supabase,
            userId: user.id,
            channelId: config.channelId,
            sessionId: upstreamSession.id,
            eventId: randomUUID(),
            eventType: "message_received",
            content: rawAnswer,
            occurredAt: new Date().toISOString(),
            displayContent: finalAnswer,
            researchTrace,
            sourceReferences,
            proModeEnabled: false,
          });
          void relayFredWebhookEvent({
            session: embedSession,
            config,
            upstreamSession,
            type: "message_received",
            content: rawAnswer,
            signal: deadline.signal,
          });
          send(controller, {
            type: "final",
            answer: finalAnswer,
            conversation: finalConversation,
            researchTrace,
            sourceReferences,
          });
          if (!lifetimeAbort!.signal.aborted) {
            try { controller.close(); } catch { /* already closed */ }
          }
        } catch (error) {
          acceptingCitationUpdates = false;
          await stopAndCancelUpstream(error);
          if (!deadline.signal.aborted && !lifetimeAbort!.signal.aborted) {
            send(controller, {
              type: "error",
              error: error instanceof UserVisibleError
                ? error.message
                : "Fred konnte die Anfrage nicht abschließen.",
            });
          }
          try { controller.close(); } catch { /* already closed */ }
        } finally {
          acceptingCitationUpdates = false;
          cleanup();
        }
      },
      async cancel(reason) {
        lifetimeAbort?.abort(reason);
        const upstreamCleanup = stopAndCancelUpstream(reason);
        cleanup();
        await upstreamCleanup;
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": `${FRED_NATIVE_STREAM_CONTENT_TYPE}; charset=utf-8`,
        "Cache-Control": "private, no-cache, no-transform",
        "X-Accel-Buffering": "no",
        Vary: "Authorization",
      },
    });
  } catch (error) {
    cleanupResources?.();
    lifetimeAbort?.abort(error);
    if (error instanceof UserVisibleError) return json({ error: error.message }, error.status);
    if (error instanceof FredEmbedConfigurationError) {
      return json({ error: "Fred ist noch nicht vollständig eingerichtet." }, 503);
    }
    if (error instanceof FredEmbedUpstreamError) {
      return json({ error: "Fred ist derzeit nicht erreichbar. Bitte später erneut versuchen." }, 502);
    }
    return json({ error: "Fred konnte die Anfrage nicht verarbeiten." }, 500);
  }
}
