import { afterEach, describe, expect, it, vi } from "vitest";

import type { BotApi } from "./bot-api";
import type { ClaimedUpdate, JobQueueRpc } from "./jobs";
import {
  processUpdate,
  runWorkerLoop,
  type WorkerConfig,
  type WorkerIntegration,
  type WorkerStorage,
} from "./worker";
import type { FredTurnRequest, FredTurnResult } from "../fred/turn-types";
import type { FredNativeConversation } from "../fred-native-stream";
import { executeFredTurn, type TurnServiceConfigDeps, type TurnServicePersistenceDeps, type TurnServiceUpstreamDeps } from "../fred/turn-service";

// ── Fixtures ────────────────────────────────────────────────────────────────

const integrationId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const clientId = "11111111-1111-4111-8111-111111111111";
const botUserId = 987654321;
const telegramUserId = 42;
const telegramChatId = 123456;
const updateId = 1001;
const updateRowId = 7;

const fakeConversation: FredNativeConversation = {
  id: "conv-abc",
  title: "Steuerfrage",
  createdAt: "2026-07-31T00:00:00.000Z",
  updatedAt: "2026-07-31T00:00:00.000Z",
  agentKey: "fred",
};

function makeIntegration(overrides: Partial<WorkerIntegration> = {}): WorkerIntegration {
  return {
    id: integrationId,
    clientId,
    botUserId,
    encryptedToken: "v1.iv.tag.encrypted",
    status: "active",
    pairedTelegramUserId: telegramUserId,
    pairedTelegramChatId: telegramChatId,
    ...overrides,
  };
}

function textUpdate(text: string, overrides: Record<string, unknown> = {}) {
  return {
    update_id: updateId,
    message: {
      message_id: 55,
      from: { id: telegramUserId, is_bot: false, first_name: "Test" },
      chat: { id: telegramChatId, type: "private" },
      date: Math.floor(Date.now() / 1000),
      text,
    },
    ...overrides,
  };
}

function makeUpdate(overrides: Partial<ClaimedUpdate> = {}): ClaimedUpdate {
  return {
    id: updateRowId,
    updateId,
    integrationId,
    rawUpdate: textUpdate("Wie hoch ist die Umsatzsteuer?"),
    telegramChatId,
    updateKind: "message",
    status: "processing",
    leaseId: "lease-1",
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    attemptCount: 0,
    availableAt: new Date().toISOString(),
    cancelRequested: false,
    ...overrides,
  };
}

function fakeBotApi(): BotApi {
  return {
    getMe: vi.fn(),
    getWebhookInfo: vi.fn(),
    setWebhook: vi.fn(),
    deleteWebhook: vi.fn(),
    setMyCommands: vi.fn(),
    deleteMyCommands: vi.fn(),
    sendMessageDraft: vi.fn().mockResolvedValue({ message_id: 1, date: 1, chat: { id: telegramChatId, type: "private" } }),
    sendChatAction: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 2, date: 1, chat: { id: telegramChatId, type: "private" } }),
  };
}

function fakeRpc(overrides: Partial<Record<keyof JobQueueRpc, ReturnType<typeof vi.fn>>> = {}): JobQueueRpc {
  return {
    claimPending: overrides.claimPending ?? vi.fn().mockResolvedValue({ data: [], error: null }),
    heartbeat: overrides.heartbeat ?? vi.fn().mockResolvedValue({ data: true, error: null }),
    complete: overrides.complete ?? vi.fn().mockResolvedValue({ data: true, error: null }),
    retry: overrides.retry ?? vi.fn().mockResolvedValue({ data: true, error: null }),
    cancel: overrides.cancel ?? vi.fn().mockResolvedValue({ data: true, error: null }),
    cancelAll: overrides.cancelAll ?? vi.fn().mockResolvedValue({ data: true, error: null }),
    fail: overrides.fail ?? vi.fn().mockResolvedValue({ data: true, error: null }),
    requestCancelForChat: overrides.requestCancelForChat ?? vi.fn().mockResolvedValue({ data: true, error: null }),
    checkCancelled: overrides.checkCancelled ?? vi.fn().mockResolvedValue({ data: false, error: null }),
    enqueue: overrides.enqueue ?? vi.fn().mockResolvedValue({ data: true, error: null }),
  } as JobQueueRpc;
}

function fakeStorage(overrides: Partial<WorkerStorage> = {}): WorkerStorage {
  return {
    loadIntegration: vi.fn().mockResolvedValue(makeIntegration()),
    getActiveConversation: vi.fn().mockResolvedValue(null),
    clearActiveConversation: vi.fn().mockResolvedValue(undefined),
    bindConversation: vi.fn().mockResolvedValue(undefined),
    markTelegramOrigin: vi.fn().mockResolvedValue(undefined),
    getDeliveryState: vi.fn().mockResolvedValue([]),
    recordDelivery: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function fakeConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    rpc: fakeRpc(),
    storage: fakeStorage(),
    turnUpstream: {} as unknown as TurnServiceUpstreamDeps,
    turnPersistence: {} as unknown as TurnServicePersistenceDeps,
    turnConfig: {} as unknown as TurnServiceConfigDeps,
    createBotApiForToken: vi.fn(() => fakeBotApi()),
    decryptToken: vi.fn().mockReturnValue("decrypted-bot-token"),
    encryptionKey: "test-key",
    concurrency: 2,
    leaseSeconds: 60,
    pollIntervalMs: 5,
    heartbeatIntervalMs: 1000,
    draftRefreshIntervalMs: 2000,
    maxDraftRefreshes: 3,
    maxDeliveryRetries: 2,
    ...overrides,
  };
}

/** Builds an `executeTurn` fake that records every request it was called with. */
function capturingTurn(
  behavior: (request: FredTurnRequest) => AsyncGenerator<import("../fred/turn-types").FredTurnEvent, FredTurnResult>,
): { executeTurn: typeof executeFredTurn; calls: FredTurnRequest[] } {
  const calls: FredTurnRequest[] = [];
  const executeTurn = ((request: FredTurnRequest) => {
    calls.push(request);
    return behavior(request);
  }) as unknown as typeof executeFredTurn;
  return { executeTurn, calls };
}

function answerTurn(answer = "Hallo Welt", stopped = false) {
  return capturingTurn(async function* (request) {
    yield { type: "conversation", conversation: fakeConversation };
    await request.onConversationEvent?.(fakeConversation);
    yield { type: "delta", content: answer };
    return {
      answer,
      rawAnswer: answer,
      conversation: fakeConversation,
      researchTrace: [],
      sourceReferences: [],
      stopped,
    };
  });
}

function stoppedTurn() {
  return capturingTurn(async function* () {
    return {
      answer: "",
      rawAnswer: "",
      conversation: fakeConversation,
      researchTrace: [],
      sourceReferences: [],
      stopped: true,
    };
  });
}

function erroringTurn(message: string) {
  return capturingTurn(async function* () {
    yield { type: "error", error: message };
    return {
      answer: "",
      rawAnswer: "",
      conversation: fakeConversation,
      researchTrace: [],
      sourceReferences: [],
      stopped: false,
    };
  });
}

afterEach(() => {
  vi.useRealTimers();
});

// ── Integration gating ──────────────────────────────────────────────────────

describe("processUpdate: integration gating", () => {
  it("terminally fails when the integration does not exist, without calling Telegram", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({ loadIntegration: vi.fn().mockResolvedValue(null) });
    const createBotApiForToken = vi.fn(() => fakeBotApi());
    const config = fakeConfig({ rpc, storage, createBotApiForToken });

    const result = await processUpdate(config, makeUpdate());

    expect(result.status).toBe("failed");
    expect(rpc.fail).toHaveBeenCalledWith(expect.objectContaining({ p_update_id: updateRowId }));
    expect(rpc.complete).not.toHaveBeenCalled();
    expect(createBotApiForToken).not.toHaveBeenCalled();
  });

  it("terminally fails when the integration is not active, without calling Telegram", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      loadIntegration: vi.fn().mockResolvedValue(makeIntegration({ status: "awaiting_pairing" })),
    });
    const createBotApiForToken = vi.fn(() => fakeBotApi());
    const config = fakeConfig({ rpc, storage, createBotApiForToken });

    const result = await processUpdate(config, makeUpdate());

    expect(result.status).toBe("failed");
    expect(rpc.fail).toHaveBeenCalled();
    expect(createBotApiForToken).not.toHaveBeenCalled();
  });
});

// ── Token handling ───────────────────────────────────────────────────────────

describe("processUpdate: token decryption", () => {
  it("decrypts with the correct AAD, creates a per-token client, and uses the real clientId", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const decryptToken = vi.fn().mockReturnValue("plaintext-bot-token");
    const createBotApiForToken = vi.fn(() => fakeBotApi());
    const { executeTurn, calls } = answerTurn();
    const config = fakeConfig({ rpc, storage, decryptToken, createBotApiForToken, executeTurn });

    await processUpdate(config, makeUpdate());

    expect(decryptToken).toHaveBeenCalledWith("v1.iv.tag.encrypted", {
      integrationId,
      clientId,
      botUserId,
    });
    expect(createBotApiForToken).toHaveBeenCalledWith("plaintext-bot-token");
    expect(calls[0]?.clientId).toBe(clientId);
    expect(calls[0]?.clientId).not.toBe(integrationId);
  });

  it("terminally fails without exposing the token when decryption throws", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const decryptToken = vi.fn(() => {
      throw new Error("bad ciphertext for secret-token-xyz");
    });
    const createBotApiForToken = vi.fn(() => fakeBotApi());
    const config = fakeConfig({ rpc, storage, decryptToken, createBotApiForToken });

    const result = await processUpdate(config, makeUpdate());

    expect(result.status).toBe("failed");
    expect(rpc.fail).toHaveBeenCalled();
    const failCall = (rpc.fail as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(JSON.stringify(failCall)).not.toContain("secret-token-xyz");
    expect(createBotApiForToken).not.toHaveBeenCalled();
  });
});

// ── Message routing ──────────────────────────────────────────────────────────

describe("processUpdate: message routing", () => {
  it("completes silently for a foreign user, without decrypting the token", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const decryptToken = vi.fn().mockReturnValue("plaintext");
    const config = fakeConfig({ rpc, storage, decryptToken });
    const update = makeUpdate({
      rawUpdate: textUpdate("Hallo", { message: { ...textUpdate("Hallo").message, from: { id: 999999, is_bot: false, first_name: "Stranger" } } }),
    });

    const result = await processUpdate(config, update);

    expect(result.status).toBe("completed");
    expect(rpc.complete).toHaveBeenCalledWith(expect.objectContaining({ p_update_id: updateRowId }));
    expect(decryptToken).not.toHaveBeenCalled();
  });

  it("completes silently when the chat id does not match the paired chat", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const config = fakeConfig({ rpc, storage });
    const update = makeUpdate({ telegramChatId: 555, rawUpdate: textUpdate("Hallo") });

    const result = await processUpdate(config, update);

    expect(result.status).toBe("completed");
    expect(rpc.complete).toHaveBeenCalled();
  });

  it("sends a single German notice and completes for unsupported non-text messages", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi });
    const update = makeUpdate({
      rawUpdate: {
        update_id: updateId,
        message: {
          message_id: 55,
          from: { id: telegramUserId, is_bot: false, first_name: "Test" },
          chat: { id: telegramChatId, type: "private" },
          date: Math.floor(Date.now() / 1000),
        },
      },
    });

    const result = await processUpdate(config, update);

    expect(result.status).toBe("completed");
    expect(botApi.sendMessage).toHaveBeenCalledTimes(1);
    expect(rpc.complete).toHaveBeenCalled();
  });
});

// ── Slash commands ────────────────────────────────────────────────────────────

describe("processUpdate: slash commands", () => {
  it.each([
    ["/start", "Willkommen"],
    ["/help", "Befehle"],
    ["/status", "verbunden"],
    ["/settings", "Einstellungen"],
  ])("replies locally to %s and completes", async (command, expectedSubstring) => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi });
    const update = makeUpdate({ rawUpdate: textUpdate(command) });

    const result = await processUpdate(config, update);

    expect(result.status).toBe("completed");
    expect(botApi.sendMessage).toHaveBeenCalledTimes(1);
    const sentText = (botApi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].text as string;
    expect(sentText).toContain(expectedSubstring);
    expect(rpc.complete).toHaveBeenCalled();
  });

  it("/new clears the active conversation and confirms", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi });
    const update = makeUpdate({ rawUpdate: textUpdate("/new") });

    const result = await processUpdate(config, update);

    expect(result.status).toBe("completed");
    expect(storage.clearActiveConversation).toHaveBeenCalledWith(integrationId, telegramChatId);
    expect(botApi.sendMessage).toHaveBeenCalledTimes(1);
    expect(rpc.complete).toHaveBeenCalled();
  });

  it("/stop requests cancellation for the chat, excludes its own update, and completes (not cancels) itself", async () => {
    const rpc = fakeRpc({ requestCancelForChat: vi.fn().mockResolvedValue({ data: true, error: null }) });
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi });
    const update = makeUpdate({ rawUpdate: textUpdate("/stop") });

    const result = await processUpdate(config, update);

    expect(result.status).toBe("completed");
    expect(rpc.requestCancelForChat).toHaveBeenCalledWith(expect.objectContaining({
      p_integration_id: integrationId,
      p_telegram_chat_id: telegramChatId,
      p_exclude_update_id: updateRowId,
    }));
    expect(rpc.cancel).not.toHaveBeenCalled();
    expect(rpc.complete).toHaveBeenCalled();
    const sentText = (botApi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].text as string;
    expect(sentText).toContain("abgebrochen");
  });

  it("/stop reports nothing running when no job was cancelled", async () => {
    const rpc = fakeRpc({ requestCancelForChat: vi.fn().mockResolvedValue({ data: false, error: null }) });
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi });
    const update = makeUpdate({ rawUpdate: textUpdate("/stop") });

    await processUpdate(config, update);

    const sentText = (botApi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].text as string;
    expect(sentText).toContain("keine Antwort");
  });

  it("replies with an unknown-command notice and never calls Fred for unrecognized commands", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    const { executeTurn, calls } = answerTurn();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn });
    const update = makeUpdate({ rawUpdate: textUpdate("/frobnicate") });

    const result = await processUpdate(config, update);

    expect(result.status).toBe("completed");
    expect(calls).toHaveLength(0);
    expect(botApi.sendMessage).toHaveBeenCalledTimes(1);
    const sentText = (botApi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].text as string;
    expect(sentText).toContain("Unbekannter Befehl");
    expect(rpc.complete).toHaveBeenCalled();
  });
});

// ── Free text / Fred turn ────────────────────────────────────────────────────

describe("processUpdate: free text routed to Fred", () => {
  it("passes an existing conversation binding through to the Fred request", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({ getActiveConversation: vi.fn().mockResolvedValue("existing-conv-id") });
    const { executeTurn, calls } = answerTurn();
    const config = fakeConfig({ rpc, storage, executeTurn });

    await processUpdate(config, makeUpdate());

    expect(calls[0]?.conversationId).toBe("existing-conv-id");
  });

  it("binds a newly created conversation and marks its Telegram origin via onConversationEvent", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({ getActiveConversation: vi.fn().mockResolvedValue(null) });
    const { executeTurn } = answerTurn();
    const config = fakeConfig({ rpc, storage, executeTurn });

    await processUpdate(config, makeUpdate());

    expect(storage.markTelegramOrigin).toHaveBeenCalledWith(clientId, fakeConversation.id, integrationId);
    expect(storage.bindConversation).toHaveBeenCalledWith(integrationId, telegramChatId, fakeConversation.id);
  });

  it("derives stable, deterministic event IDs from integrationId:updateId:role across retries", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const { executeTurn, calls } = answerTurn();
    const config = fakeConfig({ rpc, storage, executeTurn });

    await processUpdate(config, makeUpdate({ attemptCount: 0 }));
    await processUpdate(config, makeUpdate({ attemptCount: 1 }));

    expect(calls).toHaveLength(2);
    expect(calls[0]?.userEventId).toBe(calls[1]?.userEventId);
    expect(calls[0]?.assistantEventId).toBe(calls[1]?.assistantEventId);
    expect(calls[0]?.userEventId).not.toBe(calls[0]?.assistantEventId);
  });

  it("delivers the final answer and completes the update", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    const { executeTurn } = answerTurn("Die Umsatzsteuer beträgt 20%.");
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn });

    const result = await processUpdate(config, makeUpdate({ id: 42 }));

    expect(result.status).toBe("completed");
    expect(botApi.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ chat_id: telegramChatId, text: expect.stringContaining("20%") }),
    );
    expect(storage.recordDelivery).toHaveBeenCalledWith(42, 0, expect.any(String), "pending");
    expect(storage.recordDelivery).toHaveBeenCalledWith(42, 0, expect.any(String), "sent", 2);
    expect(rpc.complete).toHaveBeenCalled();
  });

  it("skips chunks already marked sent in delivery state instead of resending them", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      getDeliveryState: vi.fn().mockResolvedValue([{ chunkIndex: 0, status: "sent" }]),
    });
    const botApi = fakeBotApi();
    const { executeTurn } = answerTurn("Kurze Antwort.");
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn });

    const result = await processUpdate(config, makeUpdate({ id: 9 }));

    expect(result.status).toBe("completed");
    expect(botApi.sendMessage).not.toHaveBeenCalled();
    expect(storage.recordDelivery).not.toHaveBeenCalled();
  });

  it("terminally fails without resending when a persisted delivery chunk is uncertain", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      getDeliveryState: vi.fn().mockResolvedValue([{ chunkIndex: 0, status: "uncertain" }]),
    });
    const botApi = fakeBotApi();
    const { executeTurn } = answerTurn("Kurze Antwort.");
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn });

    const result = await processUpdate(config, makeUpdate());

    expect(result.status).toBe("failed");
    expect(botApi.sendMessage).not.toHaveBeenCalled();
    expect(storage.recordDelivery).not.toHaveBeenCalled();
    expect(rpc.retry).not.toHaveBeenCalled();
    expect(rpc.fail).toHaveBeenCalledWith(expect.objectContaining({
      p_update_id: updateRowId,
      p_last_error_code: "DELIVERY_UNCERTAIN",
    }));
  });

  it("terminally fails an uncertain send and never attempts later answer chunks", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    vi.mocked(botApi.sendMessage).mockRejectedValue(new TypeError("network connection reset"));
    const { executeTurn } = answerTurn("word ".repeat(2_500));
    const config = fakeConfig({
      rpc,
      storage,
      createBotApiForToken: () => botApi,
      executeTurn,
      maxDeliveryRetries: 1,
    });

    const result = await processUpdate(config, makeUpdate());

    expect(result.status).toBe("failed");
    expect(botApi.sendMessage).toHaveBeenCalledTimes(1);
    expect(rpc.retry).not.toHaveBeenCalled();
    expect(rpc.fail).toHaveBeenCalledWith(expect.objectContaining({
      p_update_id: updateRowId,
      p_last_error_code: "DELIVERY_UNCERTAIN",
    }));
  });

  it("does not send a final answer and cancels the update when Fred reports stopped", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    const { executeTurn } = stoppedTurn();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn });

    const result = await processUpdate(config, makeUpdate());

    expect(result.status).toBe("cancelled");
    expect(botApi.sendMessage).not.toHaveBeenCalled();
    expect(rpc.cancel).toHaveBeenCalledWith(expect.objectContaining({ p_update_id: updateRowId }));
    expect(rpc.complete).not.toHaveBeenCalled();
  });

  it("aborts the turn's signal and cancels when cancellation is detected during heartbeat polling", async () => {
    vi.useFakeTimers();
    const rpc = fakeRpc({
      heartbeat: vi.fn().mockResolvedValue({ data: true, error: null }),
      checkCancelled: vi.fn().mockResolvedValue({ data: true, error: null }),
    });
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    let capturedSignal: AbortSignal | undefined;
    const executeTurn = ((request: FredTurnRequest) => {
      capturedSignal = request.signal;
      return (async function* () {
        await new Promise<void>((resolve) => {
          request.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        return {
          answer: "",
          rawAnswer: "",
          conversation: fakeConversation,
          researchTrace: [],
          sourceReferences: [],
          stopped: true,
        };
      })();
    }) as unknown as typeof executeFredTurn;
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn, heartbeatIntervalMs: 1000 });

    const pending = processUpdate(config, makeUpdate());
    await vi.advanceTimersByTimeAsync(1000);
    const result = await pending;

    expect(capturedSignal?.aborted).toBe(true);
    expect(result.status).toBe("cancelled");
    expect(botApi.sendMessage).not.toHaveBeenCalled();
    expect(rpc.heartbeat).toHaveBeenCalledWith(expect.objectContaining({ p_update_id: updateRowId }));
    expect(rpc.checkCancelled).toHaveBeenCalledWith(expect.objectContaining({ p_update_id: updateRowId }));
  });

  it("retries with backoff when attemptCount is below the max", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    const { executeTurn } = erroringTurn("Upstream fehlgeschlagen");
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn });

    const result = await processUpdate(config, makeUpdate({ attemptCount: 2 }));

    expect(result.status).toBe("failed");
    expect(rpc.retry).toHaveBeenCalledWith(expect.objectContaining({
      p_update_id: updateRowId,
      p_retry_delay_seconds: 60 * 2 ** 2,
    }));
    expect(rpc.fail).not.toHaveBeenCalled();
    expect(botApi.sendMessage).not.toHaveBeenCalled();
  });

  it("terminally fails and sends a generic German failure notice once attemptCount reaches the max", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    const { executeTurn } = erroringTurn("Upstream fehlgeschlagen dauerhaft");
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn });

    const result = await processUpdate(config, makeUpdate({ attemptCount: 5 }));

    expect(result.status).toBe("failed");
    expect(rpc.fail).toHaveBeenCalledWith(expect.objectContaining({ p_update_id: updateRowId }));
    expect(rpc.retry).not.toHaveBeenCalled();
    expect(botApi.sendMessage).toHaveBeenCalledTimes(1);
    const sentText = (botApi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].text as string;
    expect(sentText).toContain("Fehler");
  });
});

// ── Worker loop ───────────────────────────────────────────────────────────────

describe("runWorkerLoop", () => {
  it("claims globally (no integration filter), processes a batch concurrently, and exits on abort", async () => {
    function rawUpdateFor(chatId: number) {
      return {
        update_id: chatId,
        message: {
          message_id: 55,
          from: { id: telegramUserId, is_bot: false, first_name: "Test" },
          chat: { id: chatId, type: "private" },
          date: Math.floor(Date.now() / 1000),
          text: "/status",
        },
      };
    }

    const integrations: Record<string, WorkerIntegration> = {
      "int-a": makeIntegration({ id: "int-a", pairedTelegramChatId: 1 }),
      "int-b": makeIntegration({ id: "int-b", pairedTelegramChatId: 2 }),
    };

    const controller = new AbortController();
    let claimCallCount = 0;
    const claimPending = vi.fn().mockImplementation(() => {
      claimCallCount++;
      if (claimCallCount === 1) {
        return Promise.resolve({
          data: [
            { id: 1, update_id: 1, integration_id: "int-a", raw_update: rawUpdateFor(1), telegram_chat_id: 1, status: "processing", lease_id: "l1", lease_expires_at: new Date().toISOString(), attempt_count: 0, available_at: new Date().toISOString(), cancel_requested: false, update_kind: "message" },
            { id: 2, update_id: 2, integration_id: "int-b", raw_update: rawUpdateFor(2), telegram_chat_id: 2, status: "processing", lease_id: "l2", lease_expires_at: new Date().toISOString(), attempt_count: 0, available_at: new Date().toISOString(), cancel_requested: false, update_kind: "message" },
          ],
          error: null,
        });
      }
      // Second claim finds nothing left to do — end the test deterministically
      // instead of racing a tight mocked-sleep loop against external abort().
      controller.abort();
      return Promise.resolve({ data: [], error: null });
    });
    const complete = vi.fn().mockResolvedValue({ data: true, error: null });
    const rpc = fakeRpc({ claimPending, complete });
    const storage = fakeStorage({
      loadIntegration: vi.fn((id: string) => Promise.resolve(integrations[id] ?? null)),
    });
    const botApi = fakeBotApi();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, sleep: vi.fn().mockResolvedValue(undefined) });

    await runWorkerLoop({ config, signal: controller.signal });

    const firstCallArgs = claimPending.mock.calls[0][0];
    expect(firstCallArgs).not.toHaveProperty("p_integration_id");
    expect(firstCallArgs.p_limit).toBe(2);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ p_update_id: 1 }));
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ p_update_id: 2 }));
  });

  it("cooperatively aborts an in-flight Fred turn and requeues its durable row on shutdown", async () => {
    const controller = new AbortController();
    const claimed = makeUpdate();
    const claimPending = vi.fn().mockResolvedValue({
      data: [{
        id: claimed.id,
        update_id: claimed.updateId,
        integration_id: claimed.integrationId,
        raw_update: claimed.rawUpdate,
        telegram_chat_id: claimed.telegramChatId,
        update_kind: claimed.updateKind,
        status: claimed.status,
        lease_id: claimed.leaseId,
        lease_expires_at: claimed.leaseExpiresAt,
        attempt_count: claimed.attemptCount,
        available_at: claimed.availableAt,
        cancel_requested: claimed.cancelRequested,
      }],
      error: null,
    });
    const rpc = fakeRpc({ claimPending });
    let capturedTurnSignal: AbortSignal | undefined;
    let turnStarted!: () => void;
    const started = new Promise<void>((resolve) => { turnStarted = resolve; });
    const executeTurn = ((request: FredTurnRequest) => {
      capturedTurnSignal = request.signal;
      return (async function* () {
        turnStarted();
        await new Promise<void>((resolve) => {
          controller.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        return {
          answer: "",
          rawAnswer: "",
          conversation: fakeConversation,
          researchTrace: [],
          sourceReferences: [],
          stopped: true,
        };
      })();
    }) as unknown as typeof executeFredTurn;
    const config = fakeConfig({ rpc, executeTurn });

    const loop = runWorkerLoop({ config, signal: controller.signal });
    await started;
    controller.abort();
    await loop;

    expect(capturedTurnSignal?.aborted).toBe(true);
    expect(rpc.retry).toHaveBeenCalledWith(expect.objectContaining({
      p_update_id: updateRowId,
      p_retry_delay_seconds: 0,
      p_last_error_code: "WORKER_SHUTDOWN",
    }));
    expect(rpc.cancel).not.toHaveBeenCalled();
    expect(rpc.complete).not.toHaveBeenCalled();
  });
});
