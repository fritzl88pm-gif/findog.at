// ── Types ───────────────────────────────────────────────────────────────────

export interface ClaimedUpdate {
  /** Primary key of the telegram_updates row. */
  id: number;
  /** Telegram update_id. */
  updateId: number;
  /** The integration that owns this update. */
  integrationId: string;
  /** The raw Telegram update JSON. */
  rawUpdate: Record<string, unknown>;
  /** The Telegram chat this update belongs to. */
  telegramChatId: number;
  /** The Telegram message ID, when applicable (absent for e.g. my_chat_member updates). */
  telegramMessageId?: number;
  /** Coarse classification persisted at enqueue time. */
  updateKind: string;
  /** Current status. */
  status: string;
  /** The lease ID assigned by claim. */
  leaseId: string;
  /** When the lease expires. */
  leaseExpiresAt: string;
  /** Number of processing attempts so far. */
  attemptCount: number;
  /** Durable per-row attempt limit; attemptCount > maxAttempts marks cleanup-only reclaim. */
  maxAttempts: number;
  /** When the update becomes available for claiming. */
  availableAt: string;
  /** Whether a /stop cancellation has been requested. */
  cancelRequested: boolean;
}

export interface UpdateHandle {
  /** Primary key of the durable telegram_updates row. */
  rowId: number;
  leaseId: string;
}

export interface JobQueueRpc {
  claimPending(params: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  heartbeat(params: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  complete(params: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  retry(params: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  cancel(params: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  cancelAll(params: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  fail(params: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  requestCancelForChat(params: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  checkCancelled(params: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  enqueue(params: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}


function requireRpcData(
  operation: string,
  result: { data: unknown; error: unknown },
): unknown {
  if (!result.error) return result.data;
  throw new Error(`${operation} failed`);
}

export class TelegramUpdateLeaseLostError extends Error {
  constructor(operation: string) {
    super(`${operation} lease lost`);
    this.name = "TelegramUpdateLeaseLostError";
  }
}

function requireLeaseTransition(
  operation: string,
  result: { data: unknown; error: unknown },
): void {
  const data = requireRpcData(operation, result);
  if (data !== true) {
    throw new TelegramUpdateLeaseLostError(operation);
  }
}

function parseClaimedRow(row: unknown): ClaimedUpdate | null {
  if (!isRecord(row)) return null;
  const id = typeof row.id === "number" ? row.id : Number(row.id);
  const updateId = typeof row.update_id === "number" ? row.update_id : Number(row.update_id);
  if (!Number.isFinite(id) || !Number.isFinite(updateId)) return null;
  const rawUpdate = isRecord(row.raw_update) ? row.raw_update : {};
  const leaseId = typeof row.lease_id === "string" ? row.lease_id : "";
  if (!leaseId) return null;
  const telegramMessageId = typeof row.telegram_message_id === "number" ? row.telegram_message_id : undefined;
  const maxAttempts = typeof row.max_attempts === "number" ? row.max_attempts : Number(row.max_attempts);
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) return null;
  return {
    id,
    updateId,
    integrationId: typeof row.integration_id === "string" ? row.integration_id : "",
    rawUpdate,
    telegramChatId: typeof row.telegram_chat_id === "number" ? row.telegram_chat_id : Number(row.telegram_chat_id),
    ...(telegramMessageId !== undefined ? { telegramMessageId } : {}),
    updateKind: typeof row.update_kind === "string" ? row.update_kind : "message",
    status: typeof row.status === "string" ? row.status : "processing",
    leaseId,
    leaseExpiresAt: typeof row.lease_expires_at === "string" ? row.lease_expires_at : new Date().toISOString(),
    attemptCount: typeof row.attempt_count === "number" ? row.attempt_count : 0,
    maxAttempts,
    availableAt: typeof row.available_at === "string" ? row.available_at : new Date().toISOString(),
    cancelRequested: row.cancel_requested === true,
  };
}

// ── Public API ──────────────────────────────────────────────────────────────


/**
 * Claim up to `limit` pending/retry updates, globally across all
 * integrations. The underlying RPC guarantees at most one active
 * (processing) update per (integration, telegram chat) at a time.
 * Assigns a fresh lease with the given duration.
 */
export async function claimPendingUpdates(
  rpc: JobQueueRpc,
  limit: number,
  leaseId: string,
  leaseSeconds: number,
): Promise<ClaimedUpdate[]> {
  const result = await rpc.claimPending({
    p_limit: limit,
    p_lease_id: leaseId,
    p_lease_seconds: leaseSeconds,
  });

  const data = requireRpcData("claim", result);
  if (!Array.isArray(data)) {
    return [];
  }

  return data.map(parseClaimedRow).filter((row): row is ClaimedUpdate => row !== null);
}

/**
 * Extend the lease on an in-progress update.
 * Returns true if the heartbeat succeeded (lease still held), false otherwise.
 */
export async function heartbeatUpdate(
  rpc: JobQueueRpc,
  handle: UpdateHandle,
): Promise<boolean> {
  const result = await rpc.heartbeat({
    p_update_id: handle.rowId,
    p_lease_id: handle.leaseId,
  });
  const data = requireRpcData("heartbeat", result);
  return data === true;
}

/**
 * Mark an update as successfully completed.
 */
export async function completeUpdate(
  rpc: JobQueueRpc,
  handle: UpdateHandle,
): Promise<void> {
  const result = await rpc.complete({
    p_update_id: handle.rowId,
    p_lease_id: handle.leaseId,
  });
  requireLeaseTransition("complete update", result);
}

/**
 * Mark an update for retry with a delay.
 */
export async function retryUpdate(
  rpc: JobQueueRpc,
  params: {
    rowId: number;
    leaseId: string;
    retryDelaySeconds?: number;
    lastErrorCode?: string;
  },
): Promise<"retried" | "cancel_requested"> {
  const result = await rpc.retry({
    p_update_id: params.rowId,
    p_lease_id: params.leaseId,
    p_retry_delay_seconds: params.retryDelaySeconds ?? 60,
    p_last_error_code: params.lastErrorCode ?? "UNKNOWN",
  });
  const data = requireRpcData("retry update", result);
  if (data === "retried" || data === "cancel_requested") return data;
  throw new TelegramUpdateLeaseLostError("retry update");
}

/**
 * Mark an update as cancelled (e.g. /stop).
 */
export async function cancelUpdate(
  rpc: JobQueueRpc,
  handle: UpdateHandle,
): Promise<void> {
  const result = await rpc.cancel({
    p_update_id: handle.rowId,
    p_lease_id: handle.leaseId,
  });
  requireLeaseTransition("cancel update", result);
}

/**
 * Cancel all active (pending/processing/retry) updates for an integration.
 */
export async function cancelAllUpdatesForIntegration(
  rpc: JobQueueRpc,
  integrationId: string,
): Promise<void> {
  const result = await rpc.cancelAll({
    p_integration_id: integrationId,
  });
  requireRpcData("cancel all updates", result);
}

/**
 * Mark an update as terminally failed (poison), clearing the raw payload.
 */
export async function failUpdate(
  rpc: JobQueueRpc,
  params: {
    rowId: number;
    leaseId: string;
    lastErrorCode?: string;
  },
): Promise<void> {
  const result = await rpc.fail({
    p_update_id: params.rowId,
    p_lease_id: params.leaseId,
    p_last_error_code: params.lastErrorCode ?? "UNKNOWN",
  });
  requireLeaseTransition("fail update", result);
}

/**
 * Request cancellation of whichever *other* update is currently being
 * processed for the same integration + Telegram chat (used by /stop).
 * Returns true if an in-flight job was found and flagged.
 */
export async function requestCancelForChat(
  rpc: JobQueueRpc,
  params: {
    integrationId: string;
    telegramChatId: number;
    excludeRowId?: number;
  },
): Promise<boolean> {
  const result = await rpc.requestCancelForChat({
    p_integration_id: params.integrationId,
    p_telegram_chat_id: params.telegramChatId,
    p_exclude_update_id: params.excludeRowId ?? null,
  });
  return requireRpcData("cancel request", result) === true;
}

/**
 * Cheap poll for whether cancellation has been requested for an
 * in-flight update. Does not extend or otherwise mutate the lease.
 */
export async function checkUpdateCancelled(
  rpc: JobQueueRpc,
  handle: UpdateHandle,
): Promise<boolean> {
  const result = await rpc.checkCancelled({
    p_update_id: handle.rowId,
    p_lease_id: handle.leaseId,
  });
  return requireRpcData("cancel check", result) === true;
}
