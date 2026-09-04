import { describe, expect, it, vi } from "vitest";

import {
  cancelAllUpdatesForIntegration,
  cancelUpdate,
  checkUpdateCancelled,
  claimPendingUpdates,
  completeUpdate,
  failUpdate,
  heartbeatUpdate,
  requestCancelForChat,
  retryUpdate,
  type JobQueueRpc,
  TelegramUpdateLeaseLostError,
} from "./jobs";

function makeRpc(behavior: Record<string, ReturnType<typeof vi.fn>> = {}): JobQueueRpc {
  return {
    claimControls: vi.fn().mockResolvedValue({ data: [], error: null }),
    claimPending: (behavior.claimPending ?? vi.fn().mockResolvedValue({ data: [], error: null })) as never,
    heartbeat: (behavior.heartbeat ?? vi.fn().mockResolvedValue({ data: true, error: null })) as never,
    complete: (behavior.complete ?? vi.fn().mockResolvedValue({ data: true, error: null })) as never,
    retry: (behavior.retry ?? vi.fn().mockResolvedValue({ data: "retried", error: null })) as never,
    cancel: (behavior.cancel ?? vi.fn().mockResolvedValue({ data: true, error: null })) as never,
    cancelAll: (behavior.cancelAll ?? vi.fn().mockResolvedValue({ data: true, error: null })) as never,
    fail: (behavior.fail ?? vi.fn().mockResolvedValue({ data: true, error: null })) as never,
    requestCancelForChat: (behavior.requestCancelForChat ?? vi.fn().mockResolvedValue({ data: true, error: null })) as never,
    checkCancelled: (behavior.checkCancelled ?? vi.fn().mockResolvedValue({ data: false, error: null })) as never,
    enqueue: (behavior.enqueue ?? vi.fn().mockResolvedValue({ data: true, error: null })) as never,
  };
}

const integrationId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const leaseId = "11111111-2222-4333-8444-555555555555";
const rpcSecret = "supabase-service-role-secret";

function privateRpcError(): Record<string, unknown> {
  return {
    message: `PostgREST failed with ${rpcSecret}: ${"private-payload-".repeat(100)}`,
    details: { raw_update: { token: rpcSecret } },
    hint: `Authorization: Bearer ${rpcSecret}`,
  };
}

async function expectSanitizedRpcFailure(
  promise: Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );

  expect(error).toBeInstanceOf(Error);
  if (!(error instanceof Error)) return;
  expect(error.message).toBe(expectedMessage);
  expect(error.message.length).toBeLessThanOrEqual(64);
  expect(error.message).not.toContain(rpcSecret);
  expect(error.message).not.toContain("private-payload");
}

function claimedRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    update_id: 1001,
    integration_id: integrationId,
    raw_update: { update_id: 1001, message: { chat: { id: 123 }, text: "hello" } },
    telegram_chat_id: 123,
    telegram_message_id: 55,
    update_kind: "message",
    status: "processing",
    lease_id: leaseId,
    lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    attempt_count: 0,
    max_attempts: 5,
    available_at: new Date().toISOString(),
    cancel_requested: false,
    ...overrides,
  };
}

describe("claimPendingUpdates", () => {
  it("returns empty array when no updates are available", async () => {
    const rpc = makeRpc();
    const result = await claimPendingUpdates(rpc, 2, leaseId, 60);
    expect(result).toEqual([]);
    expect(rpc.claimPending).toHaveBeenCalledWith(expect.objectContaining({
        p_limit: 2, p_lease_id: leaseId, p_lease_seconds: 60 }),
    );
    // Claiming is global: no per-integration filter is sent.
    expect(rpc.claimPending).not.toHaveBeenCalledWith(
      expect.objectContaining({ p_integration_id: expect.anything() }),
    );
  });

  it("returns parsed claimed updates including chat/message/kind", async () => {
    const row = claimedRow();
    const rpc = makeRpc({
      claimPending: vi.fn().mockResolvedValue({ data: [row], error: null }),
    });

    const result = await claimPendingUpdates(rpc, 1, leaseId, 60);
    expect(result).toHaveLength(1);
    expect(result[0].updateId).toBe(1001);
    expect(result[0].leaseId).toBe(leaseId);
    expect(result[0].rawUpdate).toEqual(row.raw_update);
    expect(result[0].attemptCount).toBe(0);
    expect(result[0].maxAttempts).toBe(5);
    expect(result[0].cancelRequested).toBe(false);
    expect(result[0].telegramChatId).toBe(123);
    expect(result[0].telegramMessageId).toBe(55);
    expect(result[0].updateKind).toBe("message");
  });

  it("throws a bounded sanitized error on RPC failure", async () => {
    const rpc = makeRpc({
      claimPending: vi.fn().mockResolvedValue({ data: null, error: privateRpcError() }),
    });
    await expectSanitizedRpcFailure(
      claimPendingUpdates(rpc, 1, leaseId, 60),
      "claim failed",
    );
  });
});

describe("heartbeatUpdate", () => {
  it("returns true on successful heartbeat", async () => {
    const rpc = makeRpc();
    const result = await heartbeatUpdate(rpc, { rowId: 1, leaseId });
    expect(result).toBe(true);
    expect(rpc.heartbeat).toHaveBeenCalledWith(expect.objectContaining({ p_update_id: 1, p_lease_id: leaseId }),
    );
  });

  it("returns false when RPC indicates lease mismatch", async () => {
    const rpc = makeRpc({
      heartbeat: vi.fn().mockResolvedValue({ data: false, error: null }),
    });
    const result = await heartbeatUpdate(rpc, { rowId: 1, leaseId });
    expect(result).toBe(false);
  });

  it("surfaces a bounded sanitized RPC error instead of treating it as a lost lease", async () => {
    const rpc = makeRpc({
      heartbeat: vi.fn().mockResolvedValue({ data: null, error: privateRpcError() }),
    });
    await expectSanitizedRpcFailure(
      heartbeatUpdate(rpc, { rowId: 1, leaseId }),
      "heartbeat failed",
    );
  });
});

describe("completeUpdate", () => {
  it("marks an update as completed", async () => {
    const rpc = makeRpc();
    await completeUpdate(rpc, { rowId: 1, leaseId });
    expect(rpc.complete).toHaveBeenCalledWith(expect.objectContaining({ p_update_id: 1, p_lease_id: leaseId }),
    );
  });

  it("throws a bounded sanitized error when the completion RPC fails", async () => {
    const rpc = makeRpc({
      complete: vi.fn().mockResolvedValue({ data: null, error: privateRpcError() }),
    });
    await expectSanitizedRpcFailure(
      completeUpdate(rpc, { rowId: 1, leaseId }),
      "complete update failed",
    );
  });
});

describe("retryUpdate", () => {
  it("marks an update for retry with delay", async () => {
    const rpc = makeRpc();
    await expect(retryUpdate(rpc, {
      rowId: 1,
      leaseId,
      retryDelaySeconds: 30,
      lastErrorCode: "ERR_TIMEOUT",
    })).resolves.toBe("retried");
    expect(rpc.retry).toHaveBeenCalledWith(expect.objectContaining({
        p_update_id: 1, p_lease_id: leaseId, p_retry_delay_seconds: 30, p_last_error_code: "ERR_TIMEOUT" }),
    );
  });

  it("uses defaults for delay and error code", async () => {
    const rpc = makeRpc();
    await retryUpdate(rpc, { rowId: 1, leaseId });
    expect(rpc.retry).toHaveBeenCalledWith(expect.objectContaining({
        p_retry_delay_seconds: 60, p_last_error_code: "UNKNOWN" }),
    );
  });

  it("throws a bounded sanitized error when the retry RPC fails", async () => {
    const rpc = makeRpc({
      retry: vi.fn().mockResolvedValue({ data: null, error: privateRpcError() }),
    });
    await expectSanitizedRpcFailure(
      retryUpdate(rpc, { rowId: 1, leaseId }),
      "retry update failed",
    );
  });
});

describe("cancelUpdate", () => {
  it("marks an update as cancelled", async () => {
    const rpc = makeRpc();
    await cancelUpdate(rpc, { rowId: 1, leaseId });
    expect(rpc.cancel).toHaveBeenCalledWith(expect.objectContaining({ p_update_id: 1, p_lease_id: leaseId }),
    );
  });

  it("throws a bounded sanitized error when the cancellation RPC fails", async () => {
    const rpc = makeRpc({
      cancel: vi.fn().mockResolvedValue({ data: null, error: privateRpcError() }),
    });
    await expectSanitizedRpcFailure(
      cancelUpdate(rpc, { rowId: 1, leaseId }),
      "cancel update failed",
    );
  });
});

describe("cancelAllUpdatesForIntegration", () => {
  it("cancels all active updates for an integration", async () => {
    const rpc = makeRpc();
    await cancelAllUpdatesForIntegration(rpc, integrationId);
    expect(rpc.cancelAll).toHaveBeenCalledWith(expect.objectContaining({ p_integration_id: integrationId }),
    );
  });

  it("throws a bounded sanitized error when the integration cancellation RPC fails", async () => {
    const rpc = makeRpc({
      cancelAll: vi.fn().mockResolvedValue({ data: null, error: privateRpcError() }),
    });
    await expectSanitizedRpcFailure(
      cancelAllUpdatesForIntegration(rpc, integrationId),
      "cancel all updates failed",
    );
  });
});

describe("failUpdate", () => {
  it("marks an update as terminally failed with a sanitized error code", async () => {
    const rpc = makeRpc();
    await failUpdate(rpc, { rowId: 1, leaseId, lastErrorCode: "POISON" });
    expect(rpc.fail).toHaveBeenCalledWith(expect.objectContaining({
      p_update_id: 1, p_lease_id: leaseId, p_last_error_code: "POISON",
    }));
  });

  it("defaults the error code when none is given", async () => {
    const rpc = makeRpc();
    await failUpdate(rpc, { rowId: 1, leaseId });
    expect(rpc.fail).toHaveBeenCalledWith(expect.objectContaining({ p_last_error_code: "UNKNOWN" }));
  });

  it("throws a bounded sanitized error when the terminal failure RPC fails", async () => {
    const rpc = makeRpc({
      fail: vi.fn().mockResolvedValue({ data: null, error: privateRpcError() }),
    });
    await expectSanitizedRpcFailure(
      failUpdate(rpc, { rowId: 1, leaseId }),
      "fail update failed",
    );
  });
});

describe("lifecycle stale-lease/no-match results", () => {
  it.each([
    ["completeUpdate", "complete", (rpc: JobQueueRpc) => completeUpdate(rpc, { rowId: 1, leaseId })],
    ["retryUpdate", "retry", (rpc: JobQueueRpc) => retryUpdate(rpc, { rowId: 1, leaseId })],
    ["cancelUpdate", "cancel", (rpc: JobQueueRpc) => cancelUpdate(rpc, { rowId: 1, leaseId })],
    ["failUpdate", "fail", (rpc: JobQueueRpc) => failUpdate(rpc, { rowId: 1, leaseId })],
  ])("%s fails closed when %s reports no matching lease", async (_name, method, invoke) => {
    const rpc = makeRpc({
      [method]: vi.fn().mockResolvedValue({ data: false, error: null }),
    });

    await expect(invoke(rpc)).rejects.toBeInstanceOf(TelegramUpdateLeaseLostError);
  });

  it("reports when a concurrent stop won without releasing the lease", async () => {
    const rpc = makeRpc({
      retry: vi.fn().mockResolvedValue({ data: "cancel_requested", error: null }),
    });

    await expect(retryUpdate(rpc, { rowId: 1, leaseId })).resolves.toBe("cancel_requested");
  });

  it("does not treat cancel-all's zero-result response as a per-update lease loss", async () => {
    const rpc = makeRpc({
      cancelAll: vi.fn().mockResolvedValue({ data: 0, error: null }),
    });

    await expect(cancelAllUpdatesForIntegration(rpc, integrationId)).resolves.toBeUndefined();
  });
});

describe("requestCancelForChat", () => {
  it("returns true when an in-flight job was flagged for cancellation", async () => {
    const rpc = makeRpc({
      requestCancelForChat: vi.fn().mockResolvedValue({ data: true, error: null }),
    });
    const result = await requestCancelForChat(rpc, {
      integrationId, telegramChatId: 123, excludeRowId: 999,
    });
    expect(result).toBe(true);
    expect(rpc.requestCancelForChat).toHaveBeenCalledWith(expect.objectContaining({
      p_integration_id: integrationId, p_telegram_chat_id: 123, p_exclude_update_id: 999,
    }));
  });

  it("returns false when nothing was in flight", async () => {
    const rpc = makeRpc({
      requestCancelForChat: vi.fn().mockResolvedValue({ data: false, error: null }),
    });
    const result = await requestCancelForChat(rpc, { integrationId, telegramChatId: 123 });
    expect(result).toBe(false);
    expect(rpc.requestCancelForChat).toHaveBeenCalledWith(
      expect.objectContaining({ p_exclude_update_id: null }),
    );
  });

  it("surfaces a bounded sanitized RPC error instead of reporting that nothing was running", async () => {
    const rpc = makeRpc({
      requestCancelForChat: vi.fn().mockResolvedValue({ data: null, error: privateRpcError() }),
    });
    await expectSanitizedRpcFailure(
      requestCancelForChat(rpc, { integrationId, telegramChatId: 123 }),
      "cancel request failed",
    );
  });
});

describe("checkUpdateCancelled", () => {
  it("returns true when cancellation was requested", async () => {
    const rpc = makeRpc({
      checkCancelled: vi.fn().mockResolvedValue({ data: true, error: null }),
    });
    const result = await checkUpdateCancelled(rpc, { rowId: 1, leaseId });
    expect(result).toBe(true);
    expect(rpc.checkCancelled).toHaveBeenCalledWith(
      expect.objectContaining({ p_update_id: 1, p_lease_id: leaseId }),
    );
  });

  it("surfaces a bounded sanitized RPC error instead of failing open", async () => {
    const rpc = makeRpc({
      checkCancelled: vi.fn().mockResolvedValue({ data: null, error: privateRpcError() }),
    });
    await expectSanitizedRpcFailure(
      checkUpdateCancelled(rpc, { rowId: 1, leaseId }),
      "cancel check failed",
    );
  });
});
