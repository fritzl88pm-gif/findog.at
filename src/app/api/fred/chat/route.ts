import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import {
  buildAttachmentContext,
  type AttachmentInput,
} from "@/lib/attachments/context";
import {
  validateAttachmentBytes,
  attachmentMetadata as buildAttachmentMeta,
  attachmentKindFromMime,
  MAX_FILE_BYTES,
  MAX_IMAGE_BYTES,
  MAX_FILE_UPLOADS,
  MAX_IMAGE_UPLOADS,
} from "@/lib/attachments/validation";
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
import {
  executeFredTurn,
  type TurnServiceConfigDeps,
  type TurnServicePersistenceDeps,
  type TurnServiceUpstreamDeps,
} from "@/lib/fred/turn-service";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { recordAdminRequest } from "@/lib/admin-request-history";
import { getScanningSettings } from "@/lib/scanning/settings";
import {
  FredEmbedConfigurationError,
  FredEmbedUpstreamError,
  FRED_EMBED_ORIGIN,
  mintFredEmbedSession,
  readFredEmbedServerConfig,
  readFredProModelId,
  readQuickFredEmbedServerConfig,
} from "@/lib/weknora/fred-embed";
import {
  fredAgentName,
  type FredAgentKey,
} from "@/lib/weknora/fred-agent";
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
import { buildUserPersonalizationBlock } from "@/lib/fred/user-personalization";
import {
  FRED_CONTENT_TRANSFORMATION,
  mergeFredResearchStep,
  mergeFredSources,
  parseWeKnoraResearchEvent,
  type FredResearchStep,
  type FredSourceReference,
} from "@/lib/weknora/fred-research";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_REQUEST_BYTES = 64 * 1_024;
const MAX_QUERY_LENGTH = 50_000;
const MAX_MULTIPART_REQUEST_BYTES = MAX_REQUEST_BYTES
  + MAX_IMAGE_UPLOADS * MAX_IMAGE_BYTES
  + MAX_FILE_UPLOADS * MAX_FILE_BYTES
  + 1_024 * 1_024; // Multipart boundaries and per-part headers.
const MAX_REQUESTS_PER_WINDOW = 30;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1_000;
const TOTAL_TIMEOUT_MS = 720_000;
const PREPROCESSING_TIMEOUT_MS = 300_000;
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
  quickFredEnabled: boolean | undefined;
  attachments: FindogAttachment[];
};
type FredConversationRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  weknora_channel_id: string;
  weknora_session_id: string;
  agent_key: FredAgentKey;
  weknora_agent_id: string | null;
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
  const quickFredEnabled = body.quickFredEnabled === undefined
    ? undefined
    : body.quickFredEnabled === true;
  if (body.quickFredEnabled !== undefined && typeof body.quickFredEnabled !== "boolean") {
    throw new UserVisibleError("Die QuickFred-Einstellung ist ungültig.", 400);
  }
  if (quickFredEnabled === true && proModeEnabled) {
    throw new UserVisibleError("QuickFred und Fred Pro können nicht gleichzeitig verwendet werden.", 400);
  }
  if (!query || query.length > MAX_QUERY_LENGTH) {
    throw new UserVisibleError("Bitte gib eine gültige Frage an Fred ein.", 400);
  }
  if (conversationId && !UUID_PATTERN.test(conversationId)) {
    throw new UserVisibleError("Die Fred-Unterhaltung ist ungültig.", 400);
  }
  return {
    query,
    conversationId,
    webSearchEnabled,
    proModeEnabled,
    quickFredEnabled,
  };
}


function uploadedFile(value: FormDataEntryValue): value is File {
  return typeof File !== "undefined" && value instanceof File;
}




async function validatedAttachment(file: File, kind: "image" | "file"): Promise<FindogAttachment> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validated = validateAttachmentBytes({
    kind,
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    bytes,
  });
  return {
    kind: validated.kind,
    name: validated.name,
    mimeType: validated.mimeType,
    sizeBytes: validated.sizeBytes,
    sha256: validated.sha256,
    bytes: validated.bytes,
  };
}

function attachmentToInput(a: FindogAttachment): AttachmentInput {
  const mappedKind = attachmentKindFromMime(a.mimeType);
  return {
    kind: mappedKind,
    name: a.name,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    sha256: a.sha256,
    bytes: a.bytes,
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
  agentKey: FredAgentKey;
  weknoraAgentId: string;
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
    attachments: (options.attachments ?? []).map(buildAttachmentMeta),
    web_search_enabled: options.webSearchEnabled ?? false,
    pro_mode_enabled: options.proModeEnabled ?? false,
    agent_key: options.agentKey,
    weknora_agent_id: options.weknoraAgentId,
    ...(options.displayContent !== undefined ? {
      display_content: options.displayContent,
      research_trace: options.researchTrace ?? [],
      source_references: options.sourceReferences ?? [],
      content_transformation: FRED_CONTENT_TRANSFORMATION,
    } : {}),
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await options.supabase.rpc("record_fred_native_event", { payload });
    if (!error) {
      const result = data as Record<string, unknown>;
      const conversation = parseFredConversationSummary(data);
      if (!("message_id" in result)) return { conversation, messageId: undefined };
      const messageId = typeof result.message_id === "number"
        ? result.message_id
        : Number(result.message_id);
      if (!Number.isFinite(messageId) || messageId <= 0 || !Number.isSafeInteger(messageId)) {
        throw new UserVisibleError("Ungültige Fred-Nachrichten-ID.", 503);
      }
      return { conversation, messageId };
    }
  }
  throw new UserVisibleError("Der Fred-Verlauf konnte nicht gespeichert werden.", 503);
}

async function loadOwnedConversation(options: {
  supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>;
  userId: string;
  conversationId: string;
}): Promise<FredConversationRow | null> {
  if (!options.conversationId) return null;
  const { data, error } = await options.supabase
    .from("fred_conversations")
    .select("id,title,created_at,updated_at,weknora_channel_id,weknora_session_id,agent_key,weknora_agent_id")
    .eq("id", options.conversationId)
    .eq("client_id", options.userId)
    .maybeSingle();
  if (error) {
    throw new UserVisibleError("Die Fred-Unterhaltung konnte nicht geladen werden.", 503);
  }
  if (!data) {
    throw new UserVisibleError("Die Fred-Unterhaltung wurde nicht gefunden.", 404);
  }
  return data as FredConversationRow;
}

async function resolveUpstreamSession(options: {
  conversation: FredConversationRow | null;
  channelId: string;
  publishToken: string;
  session: Awaited<ReturnType<typeof mintFredEmbedSession>>;
  config: ReturnType<typeof readFredEmbedServerConfig>;
  signal: AbortSignal;
}): Promise<FredUpstreamSession> {
  if (!options.conversation) {
    return createFredUpstreamSession({
      session: options.session,
      config: options.config,
      signal: options.signal,
    });
  }

  const row = options.conversation;
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

type FredServerConfig = ReturnType<typeof readFredEmbedServerConfig>;

function buildWebTurnUpstream(
  registeredConfigs: Map<string, FredServerConfig>,
): TurnServiceUpstreamDeps {
  const serverConfig = (channelId: string): FredServerConfig => {
    const value = registeredConfigs.get(channelId);
    if (!value) throw new UserVisibleError("Fred ist nicht vollständig konfiguriert.", 503);
    return value;
  };
  return {
    async mintSession(params) {
      const session = await mintFredEmbedSession({
        config: serverConfig(params.channelId),
        signal: params.signal,
      });
      return { token: session.token, expiresIn: session.expiresIn };
    },
    async fetchUpstreamConfig(params) {
      return fetchFredUpstreamConfig({
        session: {
          token: params.sessionToken,
          expiresIn: 0,
          channelId: params.channelId,
          embedOrigin: FRED_EMBED_ORIGIN,
        },
        config: serverConfig(params.channelId),
        signal: params.signal,
      });
    },
    async createSession(params) {
      const session = await createFredUpstreamSession({
        session: {
          token: params.sessionToken,
          expiresIn: 0,
          channelId: params.channelId,
          embedOrigin: FRED_EMBED_ORIGIN,
        },
        config: serverConfig(params.channelId),
        signal: params.signal,
      });
      return { id: session.id, signature: session.signature };
    },
    deriveSessionSignature(params) {
      return deriveFredSessionSignature(
        { channelId: params.channelId, publishToken: params.publishToken },
        params.sessionId,
      );
    },
    async openStream(params) {
      const response = await openFredUpstreamStream({
        session: {
          token: params.sessionToken,
          expiresIn: 0,
          channelId: params.channelId,
          embedOrigin: FRED_EMBED_ORIGIN,
        },
        config: serverConfig(params.channelId),
        upstreamConfig: {
          agentId: params.agentId,
          knowledgeBaseIds: params.knowledgeBaseIds,
          allowWebSearch: params.webSearchEnabled,
          allowFileUpload: false,
        },
        upstreamSession: { id: params.sessionId, signature: params.sessionSignature },
        visitorId: params.visitorId,
        query: params.query,
        webSearchEnabled: params.webSearchEnabled,
        summaryModelId: params.summaryModelId,
        signal: params.signal,
      });
      if (!response.body) {
        throw new UserVisibleError("Fred hat keinen Antwortstream geliefert.", 502);
      }
      return response.body;
    },
    visitorId: (publishToken, userId) => fredVisitorId(publishToken, userId),
    async relayEvent(params) {
      await relayFredWebhookEvent({
        session: {
          token: params.sessionToken,
          expiresIn: 0,
          channelId: params.channelId,
          embedOrigin: FRED_EMBED_ORIGIN,
        },
        config: serverConfig(params.channelId),
        upstreamSession: { id: params.sessionId, signature: params.sessionSignature },
        type: params.type,
        content: params.content,
        signal: params.signal,
      });
    },
    async stopSession(params) {
      await stopFredUpstreamSession({
        session: {
          token: params.sessionToken,
          expiresIn: 0,
          channelId: params.channelId,
          embedOrigin: FRED_EMBED_ORIGIN,
        },
        config: serverConfig(params.channelId),
        upstreamSession: { id: params.sessionId, signature: params.sessionSignature },
        messageId: params.messageId,
        signal: params.signal,
      });
    },
  };
}

function buildWebTurnPersistence(
  supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
): TurnServicePersistenceDeps {
  return {
    async recordEvent(params) {
      return recordEvent({
        supabase,
        userId: params.clientId,
        channelId: params.channelId,
        sessionId: params.sessionId,
        eventId: params.eventId,
        eventType: params.eventType,
        content: params.content,
        occurredAt: params.occurredAt,
        attachments: [],
        webSearchEnabled: params.webSearchEnabled,
        proModeEnabled: params.proModeEnabled,
        agentKey: params.agentKey,
        weknoraAgentId: params.weknoraAgentId,
        displayContent: params.displayContent,
        researchTrace: params.researchTrace,
        sourceReferences: params.sourceReferences,
      });
    },
    async loadConversation(params) {
      return loadOwnedConversation({
        supabase,
        userId: params.clientId,
        conversationId: params.conversationId,
      });
    },
    async recordAdminRequest(params) {
      await recordAdminRequest({
        supabase,
        userId: params.clientId,
        conversationId: params.conversationId,
        content: params.content,
      });
    },
  };
}

function buildWebTurnConfig(
  registeredConfigs: Map<string, FredServerConfig>,
): TurnServiceConfigDeps {
  return {
    readFredConfig: () => {
      const value = readFredEmbedServerConfig();
      registeredConfigs.set(value.channelId, value);
      return value;
    },
    readQuickFredConfig: () => {
      try {
        const value = readQuickFredEmbedServerConfig();
        registeredConfigs.set(value.channelId, value);
        return value;
      } catch {
        return null;
      }
    },
    readProModelId: () => readFredProModelId(),
  };
}

async function loadUserPersonalizationBlock(
  supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  userId: string,
): Promise<string> {
  try {
    const { data: prefData, error: prefError } = await supabase
      .from("fred_user_preferences")
      .select("preferred_name,personality")
      .eq("user_id", userId)
      .maybeSingle();

    if (prefError) return "";

    const personalityId: string = prefData?.personality ?? "standard";
    const preferredName: string | null = prefData?.preferred_name ?? null;

    // Look up the admin-managed prompt text for this personality.
    const { data: profileData, error: profileError } = await supabase
      .from("fred_personality_profiles")
      .select("prompt_text")
      .eq("id", personalityId)
      .maybeSingle();

    if (profileError) {
      // Log a bounded diagnostic — do not leak internal details.
      console.error("fred personalization: failed to load profile prompt_text", personalityId);
      return "";
    }

    if (!profileData) {
      console.error("fred personalization: profile definition missing", personalityId);
      return "";
    }

    const promptText: string = profileData.prompt_text ?? "";

    return buildUserPersonalizationBlock({
      promptText,
      preferredName,
    });
  } catch {
    return "";
  }
}

function streamTextOnlyTurn(options: {
  request: Request;
  supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>;
  userId: string;
  body: ParsedFredChatRequest;
  agentKey: FredAgentKey;
  personalizationBlock: string;
}): Response {
  const encoder = new TextEncoder();
  const registeredConfigs = new Map<string, FredServerConfig>();
  const streamAbort = new AbortController();
  const onRequestAbort = () => streamAbort.abort(options.request.signal.reason);
  if (options.request.signal.aborted) onRequestAbort();
  else options.request.signal.addEventListener("abort", onRequestAbort, { once: true });
  let resolveTurnFinished: () => void = () => undefined;
  const turnFinished = new Promise<void>((resolve) => {
    resolveTurnFinished = resolve;
  });
  const deadline = createDeadline(TOTAL_TIMEOUT_MS, {
    timeoutMessage: "Die Verarbeitung der Anfrage hat zu lange gedauert.",
  });
  const onDeadlineAbort = () => {
    if (!streamAbort.signal.aborted) streamAbort.abort(deadline.signal.reason);
  };
  deadline.signal.addEventListener("abort", onDeadlineAbort, { once: true });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let errorSent = false;
      try {
        const turn = executeFredTurn(
          {
            clientId: options.userId,
            ...(options.body.conversationId
              ? { conversationId: options.body.conversationId }
              : {}),
            query: options.body.query,
            ...(options.personalizationBlock
              ? { upstreamQuery: options.personalizationBlock + "\n\n" + options.body.query }
              : {}),
            origin: "web",
            agentKey: options.agentKey,
            webSearchEnabled: options.body.webSearchEnabled,
            proModeEnabled: options.body.proModeEnabled,
            signal: streamAbort.signal,
          },
          buildWebTurnUpstream(registeredConfigs),
          buildWebTurnPersistence(options.supabase),
          buildWebTurnConfig(registeredConfigs),
        );
        while (true) {
          const { value, done } = await turn.next();
          if (done) break;
          if (value.type === "cancelled") continue;
          if (value.type === "error") errorSent = true;
          controller.enqueue(encoder.encode(encodeFredNativeStreamEvent(value)));
        }
      } catch (error) {
        if (!errorSent && !options.request.signal.aborted) {
          controller.enqueue(encoder.encode(encodeFredNativeStreamEvent({
            type: "error",
            error: error instanceof UserVisibleError
              ? error.message
              : "Fred konnte die Anfrage nicht abschließen.",
          })));
        }
      } finally {
        deadline.signal.removeEventListener("abort", onDeadlineAbort);
        deadline.dispose();
        options.request.signal.removeEventListener("abort", onRequestAbort);
        resolveTurnFinished();
        try { controller.close(); } catch { /* already closed */ }
      }
    },
    async cancel(reason) {
      streamAbort.abort(reason);
      deadline.dispose();
      await turnFinished;
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": FRED_NATIVE_STREAM_CONTENT_TYPE,
      "Cache-Control": "private, no-store, max-age=0",
      Vary: "Authorization",
      "X-Content-Type-Options": "nosniff",
    },
  });
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
    const personalizationBlock = await loadUserPersonalizationBlock(supabase, user.id);
    const storedConversation = await loadOwnedConversation({
      supabase,
      userId: user.id,
      conversationId: body.conversationId,
    });
    const requestedAgentKey: FredAgentKey = body.quickFredEnabled === true
      ? "quickfred"
      : "fred";
    if (
      storedConversation
      && body.quickFredEnabled !== undefined
      && storedConversation.agent_key !== requestedAgentKey
    ) {
      throw new UserVisibleError(
        "Der Agent ist für diese Unterhaltung bereits festgelegt.",
        409,
      );
    }
    const agentKey = storedConversation?.agent_key ?? requestedAgentKey;
    const selectedAgentName = fredAgentName(agentKey);
    if (agentKey === "quickfred" && body.proModeEnabled) {
      throw new UserVisibleError(
        "Fred Pro ist in einer QuickFred-Unterhaltung nicht verfügbar.",
        400,
      );
    }
    if (body.attachments.length === 0) {
      return streamTextOnlyTurn({
        request,
        supabase,
        userId: user.id,
        body,
        agentKey,
        personalizationBlock,
      });
    }
    let config: ReturnType<typeof readFredEmbedServerConfig>;
    if (agentKey === "quickfred") {
      try {
        const quickFredConfig = readQuickFredEmbedServerConfig();
        const fredConfig = readFredEmbedServerConfig();
        if (quickFredConfig.channelId === fredConfig.channelId) {
          throw new UserVisibleError(
            "QuickFred benötigt einen eigenen WeKnora-Kanal.",
            503,
          );
        }
        config = quickFredConfig;
      } catch (error) {
        if (error instanceof UserVisibleError) throw error;
        throw new UserVisibleError(
          "QuickFred ist noch nicht vollständig eingerichtet.",
          503,
        );
      }
    } else {
      config = readFredEmbedServerConfig();
    }

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
        let acceptingCitationUpdates = true;
        try {
          let upstreamQuery = body.query;
          if (personalizationBlock) {
            upstreamQuery = personalizationBlock + "\n\n" + upstreamQuery;
          }

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
              if (personalizationBlock) {
                upstreamQuery = personalizationBlock + "\n\n" + combined;
              }
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
            send(controller, {
              type: "status",
              label: `${selectedAgentName} bearbeitet die Frage …`,
            });
          }

          const embedSession = await mintFredEmbedSession({
            config,
            signal: deadline.signal,
          });
          const [upstreamConfig, upstreamSession] = await Promise.all([
            fetchFredUpstreamConfig({ session: embedSession, config, signal: deadline.signal }),
            resolveUpstreamSession({
              conversation: storedConversation,
              channelId: config.channelId,
              publishToken: config.publishToken,
              session: embedSession,
              config,
              signal: deadline.signal,
            }),
          ]);
          if (
            config.expectedAgentId
            && upstreamConfig.agentId !== config.expectedAgentId
          ) {
            throw new UserVisibleError(
              "Der QuickFred-Kanal ist nicht an den erwarteten Agenten gebunden.",
              503,
            );
          }
          if (
            storedConversation?.weknora_agent_id
            && storedConversation.weknora_agent_id !== upstreamConfig.agentId
          ) {
            throw new UserVisibleError(
              "Die Agentenkonfiguration dieser Unterhaltung hat sich geändert.",
              409,
            );
          }
          if (body.webSearchEnabled && !upstreamConfig.allowWebSearch) {
            throw new UserVisibleError(
              `Die Websuche ist für ${selectedAgentName} nicht freigeschaltet.`,
              400,
            );
          }
          const summaryModelId = body.proModeEnabled
            ? readFredProModelId()
            : "";

          const userOccurredAt = new Date().toISOString();
          const { conversation } = await recordEvent({
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
            agentKey,
            weknoraAgentId: upstreamConfig.agentId,
          });
          await recordAdminRequest({
            supabase,
            userId: user.id,
            conversationId: conversation.id,
            content: body.query,
          });
          send(controller, { type: "conversation", conversation });
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
          let upstreamMsgId = "";
          let stopRequested = false;
          requestUpstreamStop = async () => {
            if (!upstreamMsgId || stopRequested) return;
            stopRequested = true;
            await stopFredUpstreamSession({
              session: embedSession,
              config,
              upstreamSession,
              messageId: upstreamMsgId,
              signal: AbortSignal.timeout(5_000),
            });
          };

          let buffer = "";
          const answerChunks: string[] = [];
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
          const beginFinalCitationVerification = (text: string) => {
            const candidates = [
              ...new Set(extractStreamStableBfgGzCandidates(text, true)),
            ].slice(0, MAX_LIVE_BFG_CITATIONS);
            for (const gz of candidates) {
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
                upstreamMsgId = upstreamEvent.assistant_message_id;
              }
            }
            const research = parseWeKnoraResearchEvent(parsed);
            if (research.fatalError) {
              throw new UserVisibleError(
                `${selectedAgentName} konnte die Anfrage nicht abschließen.`,
                502,
              );
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
              answerChunks.push(event.content);
              send(controller, { type: "delta", content: event.content });
            }
          };

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
          const rawAnswer = answerChunks.join("");
          const plainFinalAnswer = rawAnswer.trim();
          if (!plainFinalAnswer) {
            throw new UserVisibleError(
              `${selectedAgentName} hat keine Antwort geliefert.`,
              502,
            );
          }
          beginFinalCitationVerification(plainFinalAnswer);
          await Promise.all(citationTasks.values());
          const finalAnswer = linkVerifiedBfgCitations(
            plainFinalAnswer,
            [...verifiedCitations.values()],
            { target: "fullText" },
          );
          const { conversation: finalConversation, messageId: assistantMessageId } = await recordEvent({
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
            agentKey,
            weknoraAgentId: upstreamConfig.agentId,
          });
          void relayFredWebhookEvent({
            session: embedSession,
            config,
            upstreamSession,
            type: "message_received",
            content: rawAnswer,
            signal: deadline.signal,
          });
          const finalEvent: Parameters<typeof encodeFredNativeStreamEvent>[0] = {
            type: "final",
            answer: finalAnswer,
            conversation: finalConversation,
            researchTrace,
            sourceReferences,
          };
          if (assistantMessageId !== undefined) {
            finalEvent.assistantMessageId = assistantMessageId;
          }
          send(controller, finalEvent);
          if (!lifetimeAbort!.signal.aborted) {
            try { controller.close(); } catch { /* already closed */ }
          }
        } catch (error) {
          acceptingCitationUpdates = false;
          await stopAndCancelUpstream(error);
          if (!lifetimeAbort!.signal.aborted) {
            const visibleError = deadline.signal.aborted
              ? deadline.signal.reason
              : error;
            send(controller, {
              type: "error",
              error: visibleError instanceof UserVisibleError
                ? visibleError.message
                : `${selectedAgentName} konnte die Anfrage nicht abschließen.`,
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
