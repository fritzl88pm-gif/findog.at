import { createHmac, timingSafeEqual } from "node:crypto";

import { UserVisibleError } from "../errors";
import {
  FRED_EMBED_ORIGIN,
  type FredEmbedServerConfig,
  type FredEmbedSession,
} from "./fred-embed";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const MAX_JSON_BYTES = 64 * 1_024;

export type FredUpstreamConfig = {
  agentId: string;
  knowledgeBaseIds: string[];
  allowWebSearch: boolean;
};

export type FredUpstreamSession = {
  id: string;
  signature: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function boundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
    throw new UserVisibleError("Fred hat eine ungültige Antwort geliefert.", 502);
  }
  if (!response.body) {
    throw new UserVisibleError("Fred hat eine ungültige Antwort geliefert.", 502);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let byteLength = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_JSON_BYTES) {
        await reader.cancel();
        throw new UserVisibleError("Fred hat eine ungültige Antwort geliefert.", 502);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch {
    throw new UserVisibleError("Fred hat eine ungültige Antwort geliefert.", 502);
  } finally {
    reader.releaseLock();
  }
}

function embedHeaders(token: string, config: FredEmbedServerConfig): HeadersInit {
  return {
    Accept: "application/json",
    Authorization: `Embed ${token}`,
    Origin: config.exchangeOrigin,
  };
}

function ensureUpstreamOk(response: Response): void {
  if (response.ok) return;
  if (response.status === 429) {
    throw new UserVisibleError("Fred ist derzeit ausgelastet. Bitte versuche es gleich noch einmal.", 429);
  }
  if (response.status === 401 || response.status === 403) {
    throw new UserVisibleError("Die sichere Fred-Verbindung ist abgelaufen.", 502);
  }
  throw new UserVisibleError("Fred ist derzeit nicht erreichbar.", 502);
}

export function deriveFredSessionSignature(
  config: Pick<FredEmbedServerConfig, "channelId" | "publishToken">,
  sessionId: string,
): string {
  if (!IDENTIFIER_PATTERN.test(sessionId)) {
    throw new UserVisibleError("Die Fred-Sitzung ist ungültig.", 400);
  }
  return createHmac("sha256", config.publishToken)
    .update(`${config.channelId}|${sessionId}`)
    .digest("base64url");
}

export function fredVisitorId(publishToken: string, userId: string): string {
  return createHmac("sha256", publishToken)
    .update(`findog-user|${userId}`)
    .digest("base64url");
}

export async function fetchFredUpstreamConfig(options: {
  session: FredEmbedSession;
  config: FredEmbedServerConfig;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<FredUpstreamConfig> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `${FRED_EMBED_ORIGIN}/api/v1/embed/${encodeURIComponent(options.config.channelId)}/config`,
    {
      headers: embedHeaders(options.session.token, options.config),
      cache: "no-store",
      signal: options.signal,
    },
  );
  ensureUpstreamOk(response);
  const payload = await boundedJson(response);
  if (!isRecord(payload) || payload.success !== true || !isRecord(payload.data)) {
    throw new UserVisibleError("Fred hat eine ungültige Konfiguration geliefert.", 502);
  }
  const agentId = typeof payload.data.agent_id === "string" ? payload.data.agent_id.trim() : "";
  const rawKnowledgeBaseIds = payload.data.knowledge_base_ids;
  const knowledgeBaseIds = Array.isArray(rawKnowledgeBaseIds)
    ? rawKnowledgeBaseIds.filter((id): id is string => typeof id === "string" && IDENTIFIER_PATTERN.test(id))
    : [];
  if (!IDENTIFIER_PATTERN.test(agentId)) {
    throw new UserVisibleError("Fred hat eine ungültige Konfiguration geliefert.", 502);
  }
  return {
    agentId,
    knowledgeBaseIds,
    allowWebSearch: payload.data.allow_web_search === true && payload.data.agent_web_search_enabled === true,
  };
}

export async function createFredUpstreamSession(options: {
  session: FredEmbedSession;
  config: FredEmbedServerConfig;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<FredUpstreamSession> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `${FRED_EMBED_ORIGIN}/api/v1/embed/${encodeURIComponent(options.config.channelId)}/sessions`,
    {
      method: "POST",
      headers: {
        ...embedHeaders(options.session.token, options.config),
        "Content-Type": "application/json",
      },
      body: "{}",
      cache: "no-store",
      signal: options.signal,
    },
  );
  ensureUpstreamOk(response);
  const payload = await boundedJson(response);
  if (!isRecord(payload) || payload.success !== true || !isRecord(payload.data)) {
    throw new UserVisibleError("Fred konnte keine Sitzung starten.", 502);
  }
  const id = typeof payload.data.id === "string" ? payload.data.id.trim() : "";
  const signature = typeof payload.data.sig === "string" ? payload.data.sig.trim() : "";
  if (!IDENTIFIER_PATTERN.test(id)) {
    throw new UserVisibleError("Fred hat eine ungültige Sitzung geliefert.", 502);
  }
  const expected = deriveFredSessionSignature(options.config, id);
  const receivedBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (
    receivedBytes.length !== expectedBytes.length
    || !timingSafeEqual(receivedBytes, expectedBytes)
  ) {
    throw new UserVisibleError("Fred hat eine ungültige Sitzung geliefert.", 502);
  }
  return { id, signature };
}

export async function openFredUpstreamStream(options: {
  session: FredEmbedSession;
  config: FredEmbedServerConfig;
  upstreamConfig: FredUpstreamConfig;
  upstreamSession: FredUpstreamSession;
  visitorId: string;
  query: string;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const agentEnabled = options.upstreamConfig.agentId !== "builtin-quick-answer";
  const endpoint = agentEnabled ? "agent-chat" : "knowledge-chat";
  const response = await fetchImpl(
    `${FRED_EMBED_ORIGIN}/api/v1/embed/${encodeURIComponent(options.config.channelId)}/${endpoint}/${encodeURIComponent(options.upstreamSession.id)}`,
    {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Accept-Language": "de-AT",
        Authorization: `Embed ${options.session.token}`,
        "Content-Type": "application/json",
        Origin: options.config.exchangeOrigin,
        "X-Embed-Session": options.upstreamSession.signature,
        "X-Embed-Visitor": options.visitorId,
      },
      body: JSON.stringify({
        query: options.query,
        agent_enabled: agentEnabled,
        knowledge_base_ids: options.upstreamConfig.knowledgeBaseIds,
        knowledge_ids: [],
        agent_id: options.upstreamConfig.agentId,
        web_search_enabled: options.upstreamConfig.allowWebSearch,
        summary_model_id: "",
        mcp_service_ids: [],
        mentioned_items: [],
        channel: "embed",
      }),
      cache: "no-store",
      signal: options.signal,
    },
  );
  ensureUpstreamOk(response);
  if (!response.body) {
    throw new UserVisibleError("Fred hat keinen Antwortstream geliefert.", 502);
  }
  return response;
}

export function relayFredWebhookEvent(options: {
  session: FredEmbedSession;
  config: FredEmbedServerConfig;
  upstreamSession: FredUpstreamSession;
  type: "message_sent" | "message_received";
  content: string;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  return fetchImpl(
    `${FRED_EMBED_ORIGIN}/api/v1/embed/${encodeURIComponent(options.config.channelId)}/sessions/${encodeURIComponent(options.upstreamSession.id)}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Embed ${options.session.token}`,
        "Content-Type": "application/json",
        Origin: options.config.exchangeOrigin,
        "X-Embed-Session": options.upstreamSession.signature,
      },
      body: JSON.stringify({
        type: options.type,
        session_id: options.upstreamSession.id,
        ...(options.type === "message_sent"
          ? { query: options.content }
          : { content: options.content }),
      }),
      cache: "no-store",
      signal: options.signal,
    },
  ).then(() => undefined).catch(() => undefined);
}

export function stopFredUpstreamSession(options: {
  session: FredEmbedSession;
  config: FredEmbedServerConfig;
  upstreamSession: FredUpstreamSession;
  messageId: string;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  return fetchImpl(
    `${FRED_EMBED_ORIGIN}/api/v1/embed/${encodeURIComponent(options.config.channelId)}/sessions/${encodeURIComponent(options.upstreamSession.id)}/stop`,
    {
      method: "POST",
      headers: {
        Authorization: `Embed ${options.session.token}`,
        "Content-Type": "application/json",
        Origin: options.config.exchangeOrigin,
        "X-Embed-Session": options.upstreamSession.signature,
      },
      body: JSON.stringify({ message_id: options.messageId }),
      cache: "no-store",
      signal: options.signal,
    },
  ).then(() => undefined).catch(() => undefined);
}
