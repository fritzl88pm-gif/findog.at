import { createHash, randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import {
  FRED_NATIVE_STREAM_CONTENT_TYPE,
  encodeFredNativeStreamEvent,
} from "@/lib/fred-native-stream";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  FredEmbedConfigurationError,
  FredEmbedUpstreamError,
  mintFredEmbedSession,
  readFredEmbedServerConfig,
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
  type FredUpstreamAttachment,
  type FredUpstreamSession,
} from "@/lib/weknora/fred-native";

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
const STREAM_TIMEOUT_MS = 5 * 60 * 1_000;

type RateLimitEntry = { count: number; resetAt: number };
type ParsedFredChatRequest = {
  query: string;
  conversationId: string;
  webSearchEnabled: boolean;
  attachments: FredUpstreamAttachment[];
};
type FredConversationRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  weknora_channel_id: string;
  weknora_session_id: string;
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
  if (!query || query.length > MAX_QUERY_LENGTH) {
    throw new UserVisibleError("Bitte gib eine gültige Frage an Fred ein.", 400);
  }
  if (conversationId && !UUID_PATTERN.test(conversationId)) {
    throw new UserVisibleError("Die Fred-Unterhaltung ist ungültig.", 400);
  }
  return { query, conversationId, webSearchEnabled };
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

async function upstreamAttachment(
  file: File,
  kind: FredUpstreamAttachment["kind"],
): Promise<FredUpstreamAttachment> {
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
  return {
    kind,
    name,
    mimeType,
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    dataUri: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
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
    ...images.map((entry) => upstreamAttachment(entry as File, "image")),
    ...files.map((entry) => upstreamAttachment(entry as File, "file")),
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
  attachments?: FredUpstreamAttachment[];
  webSearchEnabled?: boolean;
}) {
  const payload = {
    client_id: options.userId,
    channel_id: options.channelId,
    session_id: options.sessionId,
    event_id: options.eventId,
    event_type: options.eventType,
    content: options.content,
    occurred_at: options.occurredAt,
    attachments: (options.attachments ?? []).map((attachment) => ({
      kind: attachment.kind,
      name: attachment.name,
      mime_type: attachment.mimeType,
      size_bytes: attachment.sizeBytes,
      sha256: attachment.sha256,
    })),
    web_search_enabled: options.webSearchEnabled ?? false,
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

function upstreamDelta(value: unknown): { content?: string; error?: boolean; unsupported?: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const event = value as Record<string, unknown>;
  const responseType = typeof event.response_type === "string" ? event.response_type : "";
  if (responseType === "error") return { error: true };
  if (responseType === "tool_approval_required" || responseType === "mcp_oauth_required") {
    return { unsupported: true };
  }
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
  let lifetime: AbortController | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onRequestAbort: (() => void) | undefined;
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) throw new UserVisibleError("Fred ist derzeit nicht verfügbar.", 503);
    const user = await authenticateSupabaseRequest(request, supabase);
    requireSameSiteRequest(request);
    enforceRateLimit(user.id);
    const body = await readRequestBody(request);
    const config = readFredEmbedServerConfig();

    lifetime = new AbortController();
    onRequestAbort = () => lifetime?.abort(request.signal.reason);
    request.signal.addEventListener("abort", onRequestAbort, { once: true });
    timeout = setTimeout(
      () => lifetime?.abort(new UserVisibleError("Fred hat zu lange gebraucht.", 504)),
      STREAM_TIMEOUT_MS,
    );

    const embedSession = await mintFredEmbedSession({ signal: lifetime.signal });
    const [upstreamConfig, upstreamSession] = await Promise.all([
      fetchFredUpstreamConfig({ session: embedSession, config, signal: lifetime.signal }),
      resolveUpstreamSession({
        supabase,
        userId: user.id,
        conversationId: body.conversationId,
        channelId: config.channelId,
        publishToken: config.publishToken,
        session: embedSession,
        config,
        signal: lifetime.signal,
      }),
    ]);
    if (body.webSearchEnabled && !upstreamConfig.allowWebSearch) {
      throw new UserVisibleError("Die Websuche ist für diesen Fred-Kanal nicht freigeschaltet.", 400);
    }
    if (body.attachments.length > 0 && !upstreamConfig.allowFileUpload) {
      throw new UserVisibleError("Dateianhänge sind für diesen Fred-Kanal nicht freigeschaltet.", 400);
    }
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
    });
    void relayFredWebhookEvent({
      session: embedSession,
      config,
      upstreamSession,
      type: "message_sent",
      content: body.query,
      signal: lifetime.signal,
    });
    const upstream = await openFredUpstreamStream({
      session: embedSession,
      config,
      upstreamConfig,
      upstreamSession,
      visitorId: fredVisitorId(config.publishToken, user.id),
      query: body.query,
      webSearchEnabled: body.webSearchEnabled,
      attachments: body.attachments,
      signal: lifetime.signal,
    });
    const upstreamReader = upstream.body!.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const activeLifetime = lifetime;
    const activeTimeout = timeout;
    const activeAbortListener = onRequestAbort;
    let assistantMessageId = "";
    let stopRequested = false;
    const requestUpstreamStop = async () => {
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

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let buffer = "";
        let answer = "";
        let failed = false;
        const send = (event: Parameters<typeof encodeFredNativeStreamEvent>[0]) => {
          if (!activeLifetime.signal.aborted) {
            controller.enqueue(encoder.encode(encodeFredNativeStreamEvent(event)));
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
          const event = upstreamDelta(parsed);
          if (event.error) throw new UserVisibleError("Fred konnte die Anfrage nicht abschließen.", 502);
          if (event.unsupported) {
            throw new UserVisibleError("Diese Fred-Aktion benötigt eine zusätzliche Bestätigung, die hier noch nicht unterstützt wird.", 409);
          }
          if (event.content) {
            answer += event.content;
            send({ type: "delta", content: event.content });
          }
        };

        try {
          send({ type: "conversation", conversation });
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
          if (!answer.trim()) {
            throw new UserVisibleError("Fred hat keine Antwort geliefert.", 502);
          }
          const finalConversation = await recordEvent({
            supabase,
            userId: user.id,
            channelId: config.channelId,
            sessionId: upstreamSession.id,
            eventId: randomUUID(),
            eventType: "message_received",
            content: answer,
            occurredAt: new Date().toISOString(),
          });
          void relayFredWebhookEvent({
            session: embedSession,
            config,
            upstreamSession,
            type: "message_received",
            content: answer,
            signal: activeLifetime.signal,
          });
          send({ type: "final", answer, conversation: finalConversation });
        } catch (error) {
          failed = true;
          if (!activeLifetime.signal.aborted) {
            send({
              type: "error",
              error: error instanceof UserVisibleError
                ? error.message
                : "Fred konnte die Anfrage nicht abschließen.",
            });
          }
        } finally {
          if (activeLifetime.signal.aborted) void requestUpstreamStop();
          clearTimeout(activeTimeout);
          request.signal.removeEventListener("abort", activeAbortListener);
          if (!failed && !activeLifetime.signal.aborted) controller.close();
          else {
            try { controller.close(); } catch { /* The browser already cancelled the stream. */ }
          }
        }
      },
      async cancel(reason) {
        const stopPromise = requestUpstreamStop();
        activeLifetime.abort(reason);
        await Promise.all([
          stopPromise,
          upstreamReader.cancel(reason).catch(() => undefined),
        ]);
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
    if (timeout) clearTimeout(timeout);
    if (onRequestAbort) request.signal.removeEventListener("abort", onRequestAbort);
    lifetime?.abort(error);
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
