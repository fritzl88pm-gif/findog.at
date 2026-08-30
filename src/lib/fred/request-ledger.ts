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

export type FredRequestLedgerStatus = "received" | FredRequestStatus;

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
  status: FredRequestLedgerStatus;
  receivedAt: string;
}

export interface FredRequestResume {
  status: FredRequestLedgerStatus;
  contentDeleted: boolean;
  conversationId?: string;
  userMessageId?: number;
  assistantMessageId?: number;
  answer?: string;
  webSearchEnabled: boolean;
  proModeEnabled: boolean;
}

export type FredOptionalReceiptTransition =
  | { leaseValid: false; receiptPresent: false }
  | { leaseValid: true; receiptPresent: false }
  | ({ leaseValid: true; receiptPresent: true } & FredRequestResume);

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new UserVisibleError(`Ungültiger ${label} im Fred-Eingangsbeleg.`, 503);
  }
  return value;
}

function requestStatus(value: unknown): FredRequestLedgerStatus {
  if (
    value === "received"
    || value === "user_persisted"
    || value === "generating"
    || value === "completed"
    || value === "failed"
    || value === "cancelled"
  ) {
    return value;
  }
  throw new UserVisibleError("Ungültiger Status im Fred-Eingangsbeleg.", 503);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseFredRequestResume(data: unknown): FredRequestResume | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;

  const result = data as Record<string, unknown>;
  const status = requestStatus(result.status);
  const contentDeleted = result.content_deleted === true;
  const conversationId = optionalString(result.conversation_id);
  const userMessageId = optionalPositiveInteger(result.user_message_id);
  const assistantMessageId = optionalPositiveInteger(result.assistant_message_id);
  const answer = optionalString(result.answer);

  if (
    typeof result.web_search_enabled !== "boolean"
    || typeof result.pro_mode_enabled !== "boolean"
  ) {
    return undefined;
  }

  if (
    !contentDeleted
    && (status === "user_persisted" || status === "generating")
    && (!conversationId || userMessageId === undefined)
  ) {
    return undefined;
  }
  if (
    !contentDeleted
    && status === "completed"
    && (!conversationId || userMessageId === undefined || assistantMessageId === undefined || !answer)
  ) {
    return undefined;
  }

  return {
    status,
    contentDeleted,
    ...(conversationId ? { conversationId } : {}),
    ...(userMessageId === undefined ? {} : { userMessageId }),
    ...(assistantMessageId === undefined ? {} : { assistantMessageId }),
    ...(answer ? { answer } : {}),
    webSearchEnabled: result.web_search_enabled,
    proModeEnabled: result.pro_mode_enabled,
  };
}

interface CreateFredRequestReceiptBaseOptions {
  supabase: ServerSupabaseClient;
  clientId: string;
  agentKey: FredAgentKey;
  content: string;
  requestId?: string;
  userEventId?: string;
  assistantEventId?: string;
  conversationId?: string;
  webSearchEnabled?: boolean;
  proModeEnabled?: boolean;
}

interface CreateFredWebRequestReceiptOptions extends CreateFredRequestReceiptBaseOptions {
  origin: "web";
  telegramUpdateId?: never;
  updateRowId?: never;
  leaseId?: never;
}

interface CreateFredTelegramRequestReceiptOptions extends CreateFredRequestReceiptBaseOptions {
  origin: "telegram";
  telegramUpdateId: number;
  updateRowId: number;
  leaseId: string;
}

export function createFredRequestReceipt(
  options: CreateFredWebRequestReceiptOptions,
): Promise<FredRequestReceipt>;
export function createFredRequestReceipt(
  options: CreateFredTelegramRequestReceiptOptions,
): Promise<FredRequestReceipt | false>;
export async function createFredRequestReceipt(
  options: CreateFredWebRequestReceiptOptions | CreateFredTelegramRequestReceiptOptions,
): Promise<FredRequestReceipt | false> {
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
    web_search_enabled: options.webSearchEnabled === true,
    pro_mode_enabled: options.proModeEnabled === true,
    ...(options.telegramUpdateId === undefined
      ? {}
      : { telegram_update_id: options.telegramUpdateId }),
    ...(options.origin === "telegram"
      ? {
          telegram_update_row_id: options.updateRowId,
          telegram_lease_id: options.leaseId,
        }
      : {}),
    ...(options.conversationId === undefined
      ? {}
      : { conversation_id: options.conversationId }),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await options.supabase.rpc(
      "create_fred_request_receipt",
      { payload },
    );
    if (error) continue;
    if (data === false && options.origin === "telegram") return false;

    const result = data as Record<string, unknown>;
    return {
      requestId: requiredString(result.request_id, "Request-ID"),
      userEventId: requiredString(result.user_event_id, "User-Event-ID"),
      assistantEventId: requiredString(result.assistant_event_id, "Assistant-Event-ID"),
      status: requestStatus(result.status),
      receivedAt: requiredString(result.received_at, "Eingangszeitpunkt"),
    };
  }

  throw new UserVisibleError(
    "Die Anfrage konnte nicht sicher protokolliert werden. Bitte erneut versuchen.",
    503,
  );
}

export async function resumeFredRequestReceipt(options: {
  supabase: ServerSupabaseClient;
  requestId: string;
  clientId: string;
  telegramUpdateId: number;
}): Promise<FredRequestResume> {
  const payload = {
    request_id: options.requestId,
    client_id: options.clientId,
    telegram_update_id: options.telegramUpdateId,
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await options.supabase.rpc(
      "resume_fred_request_receipt",
      { payload },
    );
    if (error) continue;
    const parsed = parseFredRequestResume(data);
    if (parsed) return parsed;
  }

  throw new UserVisibleError(
    "Der gespeicherte Stand der Anfrage konnte nicht sicher geladen werden.",
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

/**
 * Terminal gates can run before the worker knows whether an earlier attempt
 * created a receipt. The RPC binds the optional transition to the worker's
 * current queue lease. The structured result distinguishes lease loss, a valid
 * no-op without a receipt, and the atomically reconciled terminal snapshot.
 */
export async function transitionFredRequestReceiptIfPresent(options: {
  supabase: ServerSupabaseClient;
  requestId: string;
  updateRowId: number;
  leaseId: string;
  status: FredRequestStatus;
  failurePhase?: FredRequestFailurePhase;
  errorCode?: string;
}): Promise<FredOptionalReceiptTransition> {
  const payload = {
    request_id: options.requestId,
    telegram_update_row_id: options.updateRowId,
    telegram_lease_id: options.leaseId,
    status: options.status,
    ...(options.failurePhase === undefined
      ? {}
      : { failure_phase: options.failurePhase }),
    ...(options.errorCode === undefined
      ? {}
      : { error_code: options.errorCode }),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await options.supabase.rpc(
      "transition_fred_request_receipt_if_present",
      { payload },
    );
    if (error || !data || typeof data !== "object" || Array.isArray(data)) continue;
    const result = data as Record<string, unknown>;
    if (result.lease_valid === false && result.receipt_present === false) {
      return { leaseValid: false, receiptPresent: false };
    }
    if (result.lease_valid === true && result.receipt_present === false) {
      return { leaseValid: true, receiptPresent: false };
    }
    if (result.lease_valid === true && result.receipt_present === true) {
      const resume = parseFredRequestResume(result);
      if (resume) {
        return { leaseValid: true, receiptPresent: true, ...resume };
      }
    }
  }

  throw new UserVisibleError(
    "Der Status der Anfrage konnte nicht sicher protokolliert werden.",
    503,
  );
}
