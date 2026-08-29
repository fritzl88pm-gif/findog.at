import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { UserVisibleError } from "@/lib/errors";
import type { FredAgentKey } from "@/lib/weknora/fred-agent";

type ServerSupabaseClient = Pick<SupabaseClient, "rpc">;

export type FredRequestStatus =
  | "user_persisted"
  | "generating"
  | "completed"
  | "failed"
  | "cancelled";

export type FredRequestFailurePhase =
  | "ingress"
  | "preprocessing"
  | "connecting"
  | "streaming"
  | "delivery";

export interface FredRequestReceipt {
  requestId: string;
  userEventId: string;
  assistantEventId: string;
  receivedAt: string;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new UserVisibleError(`Ungültiger ${label} im Fred-Eingangsbeleg.`, 503);
  }
  return value;
}

export async function createFredRequestReceipt(options: {
  supabase: ServerSupabaseClient;
  clientId: string;
  origin: "web" | "telegram";
  agentKey: FredAgentKey;
  content: string;
  requestId?: string;
  userEventId?: string;
  assistantEventId?: string;
  telegramUpdateId?: number;
}): Promise<FredRequestReceipt> {
  const requestId = options.requestId ?? randomUUID();
  const userEventId = options.userEventId ?? randomUUID();
  const assistantEventId = options.assistantEventId ?? randomUUID();
  const payload = {
    request_id: requestId,
    client_id: options.clientId,
    origin: options.origin,
    agent_key: options.agentKey,
    content: options.content,
    user_event_id: userEventId,
    assistant_event_id: assistantEventId,
    ...(options.telegramUpdateId === undefined
      ? {}
      : { telegram_update_id: options.telegramUpdateId }),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await options.supabase.rpc(
      "create_fred_request_receipt",
      { payload },
    );
    if (error) continue;

    const result = data as Record<string, unknown>;
    return {
      requestId: requiredString(result.request_id, "Request-ID"),
      userEventId: requiredString(result.user_event_id, "User-Event-ID"),
      assistantEventId: requiredString(result.assistant_event_id, "Assistant-Event-ID"),
      receivedAt: requiredString(result.received_at, "Eingangszeitpunkt"),
    };
  }

  throw new UserVisibleError(
    "Die Anfrage konnte nicht sicher protokolliert werden. Bitte erneut versuchen.",
    503,
  );
}

export async function transitionFredRequestReceipt(options: {
  supabase: ServerSupabaseClient;
  requestId: string;
  status: FredRequestStatus;
  conversationId?: string;
  userMessageId?: number;
  assistantMessageId?: number;
  failurePhase?: FredRequestFailurePhase;
  errorCode?: string;
}): Promise<void> {
  const payload = {
    request_id: options.requestId,
    status: options.status,
    ...(options.conversationId === undefined
      ? {}
      : { conversation_id: options.conversationId }),
    ...(options.userMessageId === undefined
      ? {}
      : { user_message_id: options.userMessageId }),
    ...(options.assistantMessageId === undefined
      ? {}
      : { assistant_message_id: options.assistantMessageId }),
    ...(options.failurePhase === undefined
      ? {}
      : { failure_phase: options.failurePhase }),
    ...(options.errorCode === undefined
      ? {}
      : { error_code: options.errorCode }),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { error } = await options.supabase.rpc(
      "transition_fred_request_receipt",
      { payload },
    );
    if (!error) return;
  }

  throw new UserVisibleError(
    "Der Status der Anfrage konnte nicht sicher protokolliert werden.",
    503,
  );
}
