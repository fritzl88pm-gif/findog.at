import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { UserVisibleError } from "../errors";
import {
  isFredAgentKey,
  type FredAgentKey,
} from "./fred-agent";

export const FRED_EVENT_BODY_MAX_BYTES = 1_048_576;
export const FRED_EVENT_CONTENT_MAX_LENGTH = 500_000;
export const FRED_WEBHOOK_TIMESTAMP_TOLERANCE_MS = 10 * 60 * 1_000;

const CHANNEL_OR_SESSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SIGNATURE_PATTERN = /^sha256=([0-9a-f]{64})$/iu;

export type FredEventType = "message_sent" | "message_received";

export type FredBridgeEvent = {
  eventId: string;
  type: FredEventType;
  channelId: string;
  sessionId: string;
  content: string;
};

export type FredWebhookEvent = {
  type: FredEventType;
  channelId: string;
  sessionId: string;
  content: string;
  providerCreatedAt: string;
  rawEvent: Record<string, unknown>;
};

export type FredConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  agentKey: FredAgentKey;
};

function recordOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UserVisibleError("Das Fred-Ereignis ist ungültig.", 400);
  }
  return value as Record<string, unknown>;
}

function identifier(value: unknown, label: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!CHANNEL_OR_SESSION_PATTERN.test(normalized)) {
    throw new UserVisibleError(`${label} ist ungültig.`, 400);
  }
  return normalized;
}

function eventType(value: unknown): FredEventType {
  if (value !== "message_sent" && value !== "message_received") {
    throw new UserVisibleError("Der Fred-Ereignistyp ist ungültig.", 400);
  }
  return value;
}

function eventContent(value: unknown): string {
  const content = typeof value === "string" ? value.trim() : "";
  if (!content || content.length > FRED_EVENT_CONTENT_MAX_LENGTH) {
    throw new UserVisibleError("Der Fred-Nachrichteninhalt ist ungültig.", 400);
  }
  return content;
}

export function parseFredBridgeEvent(value: unknown, expectedChannelId: string): FredBridgeEvent {
  const record = recordOf(value);
  const eventId = typeof record.eventId === "string" ? record.eventId.trim() : "";
  if (!UUID_PATTERN.test(eventId)) {
    throw new UserVisibleError("Die Fred-Ereignis-ID ist ungültig.", 400);
  }
  const channelId = identifier(record.channelId, "Der Fred-Kanal");
  if (channelId !== expectedChannelId) {
    throw new UserVisibleError("Der Fred-Kanal stimmt nicht überein.", 403);
  }
  return {
    eventId,
    type: eventType(record.type),
    channelId,
    sessionId: identifier(record.sessionId, "Die Fred-Sitzung"),
    content: eventContent(record.content),
  };
}

export function parseFredWebhookEvent(
  value: unknown,
  expectedChannelIds: string | readonly string[],
  now = new Date(),
): FredWebhookEvent {
  const record = recordOf(value);
  const channelId = identifier(record.channel_id, "Der Fred-Kanal");
  const allowedChannelIds = typeof expectedChannelIds === "string"
    ? [expectedChannelIds]
    : expectedChannelIds;
  if (!allowedChannelIds.includes(channelId)) {
    throw new UserVisibleError("Der Fred-Kanal stimmt nicht überein.", 403);
  }
  const type = eventType(record.type);
  const timestamp = typeof record.timestamp === "string" ? record.timestamp.trim() : "";
  const providerDate = new Date(timestamp);
  if (
    !timestamp
    || Number.isNaN(providerDate.getTime())
    || Math.abs(now.getTime() - providerDate.getTime()) > FRED_WEBHOOK_TIMESTAMP_TOLERANCE_MS
  ) {
    throw new UserVisibleError("Der Fred-Webhook-Zeitstempel ist ungültig oder abgelaufen.", 400);
  }
  const content = type === "message_sent" ? record.query : record.content;
  return {
    type,
    channelId,
    sessionId: identifier(record.session_id, "Die Fred-Sitzung"),
    content: eventContent(content),
    providerCreatedAt: providerDate.toISOString(),
    rawEvent: record,
  };
}

export function readFredWebhookSecret(
  environment: Record<string, string | undefined> = process.env,
): string {
  const secret = environment.WEKNORA_FRED_WEBHOOK_SECRET?.trim() ?? "";
  if (secret.length < 32 || secret.length > 512) {
    throw new UserVisibleError("Der Fred-Webhook ist nicht vollständig konfiguriert.", 503);
  }
  return secret;
}

export function verifyFredWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  const match = signatureHeader?.trim().match(SIGNATURE_PATTERN);
  if (!match) return false;
  const received = Buffer.from(match[1], "hex");
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function fredWebhookDeliverySha256(rawBody: string): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

export async function readBoundedFredEventBody(request: Request): Promise<string> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > FRED_EVENT_BODY_MAX_BYTES) {
    throw new UserVisibleError("Das Fred-Ereignis ist zu groß.", 413);
  }
  if (!request.body) {
    throw new UserVisibleError("Das Fred-Ereignis enthält kein JSON.", 400);
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let result = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > FRED_EVENT_BODY_MAX_BYTES) {
        await reader.cancel();
        throw new UserVisibleError("Das Fred-Ereignis ist zu groß.", 413);
      }
      result += decoder.decode(value, { stream: true });
    }
    result += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  if (!result.trim()) {
    throw new UserVisibleError("Das Fred-Ereignis enthält kein JSON.", 400);
  }
  return result;
}

export function parseFredConversationSummary(value: unknown): FredConversationSummary {
  const record = recordOf(value);
  if (
    typeof record.conversation_id !== "string"
    || typeof record.title !== "string"
    || typeof record.created_at !== "string"
    || typeof record.updated_at !== "string"
    || !isFredAgentKey(record.agent_key)
  ) {
    throw new UserVisibleError("Fred hat ein ungültiges Speicherergebnis geliefert.", 503);
  }
  return {
    id: record.conversation_id,
    title: record.title,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    agentKey: record.agent_key,
  };
}
