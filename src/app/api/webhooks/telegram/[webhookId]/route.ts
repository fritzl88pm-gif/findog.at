import { NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { parseSlashCommand } from "@/lib/telegram/commands";
import { hashToken, timingSafeDigestEqual } from "@/lib/telegram/pairing";
import type { TelegramUpdate } from "@/lib/telegram/types";

type UpdateKind = "message" | "command" | "my_chat_member" | "other";

function classifyUpdate(body: TelegramUpdate): { chatId: number; messageId: number | null; kind: UpdateKind } | null {
  if (body.message) {
    const kind: UpdateKind = body.message.text && parseSlashCommand(body.message.text) ? "command" : "message";
    return { chatId: body.message.chat.id, messageId: body.message.message_id, kind };
  }
  if (body.my_chat_member) {
    return { chatId: body.my_chat_member.chat.id, messageId: null, kind: "my_chat_member" };
  }
  return null;
}

export const runtime = "nodejs";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_SECRET_TOKEN_CHARS = 256;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SECRET_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/u;
const BUSY_RESPONSE_TEXT =
  "⏳ Fred bearbeitet bereits fünf Fragen. Bitte warte, bis eine Antwort fertig ist.";

class WebhookBodyError extends Error {
  constructor(
    readonly status: 400 | 413,
    readonly responseText: string,
  ) {
    super(responseText);
    this.name = "WebhookBodyError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(status: number, body: string): NextResponse {
  return new NextResponse(body, { status });
}

function okJson(payload: unknown): NextResponse {
  return NextResponse.json(payload);
}

function isValidSecretToken(value: string | null): value is string {
  return Boolean(
    value
    && value.length <= MAX_SECRET_TOKEN_CHARS
    && SECRET_TOKEN_PATTERN.test(value),
  );
}

async function readBoundedJsonBody(request: Request): Promise<unknown> {
  if (!request.body) {
    throw new WebhookBodyError(400, "Bad request");
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let rawBody = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new WebhookBodyError(413, "Payload too large");
      }
      rawBody += decoder.decode(value, { stream: true });
    }
    rawBody += decoder.decode();
  } catch (error) {
    if (error instanceof WebhookBodyError) throw error;
    throw new WebhookBodyError(400, "Bad request");
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new WebhookBodyError(400, "Bad request: invalid JSON");
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ webhookId: string }> },
): Promise<NextResponse> {
  const { webhookId } = await params;

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number.parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    return text(413, "Payload too large");
  }

  const secretToken = request.headers.get("x-telegram-bot-api-secret-token");
  if (!UUID_PATTERN.test(webhookId) || !isValidSecretToken(secretToken)) {
    return text(404, "Not Found");
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return text(503, "Service Unavailable");
  }

  const { data: integration, error: lookupError } = await supabase
    .from("telegram_integrations")
    .select("id, webhook_secret_sha256, status, pairing_token_sha256, pairing_expires_at, paired_telegram_user_id, paired_telegram_chat_id")
    .eq("webhook_id", webhookId)
    .maybeSingle();

  if (lookupError || !integration) {
    return text(404, "Not Found");
  }

  const expectedHash = integration.webhook_secret_sha256 as string;
  const providedHash = hashToken(secretToken);

  if (!timingSafeDigestEqual(expectedHash, providedHash)) {
    return text(404, "Not Found");
  }

  let body: TelegramUpdate;
  try {
    body = await readBoundedJsonBody(request) as TelegramUpdate;
  } catch (error) {
    if (error instanceof WebhookBodyError) {
      return text(error.status, error.responseText);
    }
    return text(400, "Bad request");
  }

  if (!body || typeof body !== "object" || typeof body.update_id !== "number") {
    return text(400, "Bad request: missing update_id");
  }

  const status = integration.status as string;

  if (
    status === "awaiting_pairing" &&
    body.message?.chat?.type === "private" &&
    body.message?.text?.startsWith("/start")
  ) {
    return handleStartPairing(supabase, integration as {
      id: string;
      pairing_token_sha256: string | null;
      pairing_expires_at: string | null;
    }, body);
  }

  if (status === "active") {
    const pairedUser = integration.paired_telegram_user_id as number | null;
    const pairedChat = integration.paired_telegram_chat_id as number | null;

    if (body.message) {
      if (body.message.chat.type !== "private") {
        return okJson({ ok: true });
      }
      if (body.message.from?.id !== pairedUser || body.message.chat.id !== pairedChat) {
        return okJson({ ok: true });
      }
    } else if (body.my_chat_member) {
      if (
        body.my_chat_member.chat.id !== pairedChat ||
        body.my_chat_member.from.id !== pairedUser
      ) {
        return okJson({ ok: true });
      }
    } else {
      return okJson({ ok: true });
    }
  } else {
    return okJson({ ok: true });
  }

  const classified = classifyUpdate(body);
  if (!classified) {
    return okJson({ ok: true });
  }

  const { data: enqueueResult, error: enqueueError } = await supabase.rpc("enqueue_telegram_update", {
    p_integration_id: integration.id,
    p_update_id: body.update_id,
    p_raw_update: body,
    p_telegram_chat_id: classified.chatId,
    p_telegram_message_id: classified.messageId,
    p_update_kind: classified.kind,
  });

  if (enqueueError) {
    return text(500, "Internal server error");
  }

  if (
    classified.kind === "message"
    && isRecord(enqueueResult)
    && enqueueResult.status === "busy"
  ) {
    return okJson({
      method: "sendMessage",
      chat_id: classified.chatId,
      text: BUSY_RESPONSE_TEXT,
    });
  }

  return okJson({ ok: true });
}

async function handleStartPairing(
  supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  integration: {
    id: string;
    pairing_token_sha256: string | null;
    pairing_expires_at: string | null;
  },
  body: TelegramUpdate,
): Promise<NextResponse> {
  const messageText = body.message?.text ?? "";
  const parts = messageText.split(/\s+/);
  const providedToken = parts[1] ?? "";

  if (!providedToken) {
    return okJson({ ok: true });
  }

  const now = new Date();
  const expiresAt = integration.pairing_expires_at ? new Date(integration.pairing_expires_at) : null;

  if (!expiresAt || expiresAt <= now) {
    return okJson({ ok: true });
  }

  const expectedHash = integration.pairing_token_sha256;
  if (!expectedHash) {
    return okJson({ ok: true });
  }

  const providedHash = hashToken(providedToken);
  if (!timingSafeDigestEqual(expectedHash, providedHash)) {
    return okJson({ ok: true });
  }

  const telegramUserId = body.message?.from?.id;
  const telegramChatId = body.message?.chat?.id;

  if (!telegramUserId || !telegramChatId) {
    return okJson({ ok: true });
  }

  // Atomic pairing RPC: only succeeds if integration is still awaiting_pairing,
  // the pairing hash matches, and the token is not expired.
  const { data: paired, error: pairError } = await supabase.rpc(
    "pair_telegram_integration",
    {
      p_integration_id: integration.id,
      p_pairing_hash: expectedHash,
      p_telegram_user_id: telegramUserId,
      p_telegram_chat_id: telegramChatId,
    },
  );

  if (pairError || !paired) {
    // Race, reused token, or expired — silent no-op
    return okJson({ ok: true });
  }

  // Enqueue the /start message to kick off the conversation
  const { error: enqueueError } = await supabase.rpc("enqueue_telegram_update", {
    p_integration_id: integration.id,
    p_update_id: body.update_id,
    p_raw_update: body,
    p_telegram_chat_id: telegramChatId,
    p_telegram_message_id: body.message?.message_id ?? null,
    p_update_kind: "command",
  });

  if (enqueueError) {
    return text(500, "Internal server error");
  }

  return okJson({ ok: true });
}
