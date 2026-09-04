import { afterEach, describe, expect, it, vi } from "vitest";

import { TelegramFileTooLargeError, type BotApi } from "./bot-api";
import { TelegramUpdateLeaseLostError, type ClaimedUpdate, type JobQueueRpc } from "./jobs";
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
import { UserVisibleError } from "../errors";
import { createAttachmentPreprocessor } from "./attachment-preprocessor";

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
    proModeEnabled: false,
    webSearchEnabled: false,
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
    maxAttempts: 5,
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
    sendRichMessage: vi.fn().mockResolvedValue({ message_id: 3, date: 1, chat: { id: telegramChatId, type: "private" } }),
    getFile: vi.fn().mockResolvedValue({ file_id: "f", file_unique_id: "u", file_path: "path" }),
    downloadFile: vi.fn().mockResolvedValue(new Uint8Array(100)),
  };
}

function fakeRpc(overrides: Partial<Record<keyof JobQueueRpc, ReturnType<typeof vi.fn>>> = {}): JobQueueRpc {
  return {
    claimControls: overrides.claimControls ?? vi.fn().mockResolvedValue({ data: [], error: null }),
    claimPending: overrides.claimPending ?? vi.fn().mockResolvedValue({ data: [], error: null }),
    heartbeat: overrides.heartbeat ?? vi.fn().mockResolvedValue({ data: true, error: null }),
    complete: overrides.complete ?? vi.fn().mockResolvedValue({ data: true, error: null }),
    retry: overrides.retry ?? vi.fn().mockResolvedValue({ data: "retried", error: null }),
    cancel: overrides.cancel ?? vi.fn().mockResolvedValue({ data: true, error: null }),
    cancelAll: overrides.cancelAll ?? vi.fn().mockResolvedValue({ data: true, error: null }),
    fail: overrides.fail ?? vi.fn().mockResolvedValue({ data: true, error: null }),
    requestCancelForChat: overrides.requestCancelForChat ?? vi.fn().mockResolvedValue({ data: true, error: null }),
    checkCancelled: overrides.checkCancelled ?? vi.fn().mockResolvedValue({ data: false, error: null }),
    enqueue: overrides.enqueue ?? vi.fn().mockResolvedValue({ data: true, error: null }),
  } as JobQueueRpc;
}

function fakeStorage(overrides: Partial<WorkerStorage> = {}): WorkerStorage {
  let receiptCreated = false;
  let receiptStatus: "received" | "failed" | "cancelled" = "received";
  let ingressContext = {
    conversationId: undefined as string | undefined,
    webSearchEnabled: false,
    proModeEnabled: false,
  };
  return {
    loadIntegration: vi.fn().mockResolvedValue(makeIntegration()),
    getActiveConversation: vi.fn().mockResolvedValue(null),
    clearActiveConversation: vi.fn().mockResolvedValue(undefined),
    bindConversation: vi.fn().mockResolvedValue(undefined),
    markTelegramOrigin: vi.fn().mockResolvedValue(undefined),
    createRequestReceipt: vi.fn().mockImplementation(async (params) => {
      receiptCreated = true;
      ingressContext = {
        conversationId: params.conversationId,
        webSearchEnabled: params.webSearchEnabled,
        proModeEnabled: params.proModeEnabled,
      };
      return {
        requestId: params.requestId,
        userEventId: params.userEventId,
        assistantEventId: params.assistantEventId,
        status: "received" as const,
        receivedAt: "2026-08-29T10:00:00.000Z",
      };
    }),
    resumeRequestReceipt: vi.fn().mockImplementation(async () => ({
      status: receiptStatus,
      contentDeleted: false,
      ...(ingressContext.conversationId ? { conversationId: ingressContext.conversationId } : {}),
      webSearchEnabled: ingressContext.webSearchEnabled,
      proModeEnabled: ingressContext.proModeEnabled,
    })),
    transitionRequestReceipt: vi.fn().mockResolvedValue(undefined),
    transitionRequestReceiptIfPresent: vi.fn().mockImplementation(async (params) => {
      if (!receiptCreated) return { leaseValid: true, receiptPresent: false } as const;
      if (receiptStatus === "received") receiptStatus = params.status;
      return {
        leaseValid: true,
        receiptPresent: true,
        status: receiptStatus,
        contentDeleted: false,
        webSearchEnabled: ingressContext.webSearchEnabled,
        proModeEnabled: ingressContext.proModeEnabled,
      } as const;
    }),
    claimDelivery: vi.fn().mockResolvedValue("claimed"),
    finishDelivery: vi.fn().mockResolvedValue(true),
    setMode: vi.fn().mockImplementation(async (_integrationId: string, mode: string, enabled: boolean) => {
      return { proModeEnabled: mode === "pro" ? enabled : false, webSearchEnabled: mode === "web" ? enabled : false };
    }),
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
  it("settles an already-requested cancellation before loading integration or Telegram state", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const createBotApiForToken = vi.fn(() => fakeBotApi());
    const config = fakeConfig({ rpc, storage, createBotApiForToken });

    const result = await processUpdate(config, makeUpdate({ cancelRequested: true }));

    expect(result.status).toBe("cancelled");
    expect(storage.loadIntegration).not.toHaveBeenCalled();
    expect(storage.transitionRequestReceiptIfPresent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelled", updateRowId, leaseId: "lease-1" }),
    );
    expect(rpc.cancel).toHaveBeenCalled();
    expect(createBotApiForToken).not.toHaveBeenCalled();
  });

  it("retries a transient integration read failure without poisoning the receipt", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      loadIntegration: vi.fn().mockRejectedValue(new Error("temporary database outage")),
    });
    const config = fakeConfig({ rpc, storage });

    const result = await processUpdate(config, makeUpdate({ attemptCount: 2 }));

    expect(result.status).toBe("retry");
    expect(rpc.retry).toHaveBeenCalledWith(expect.objectContaining({
      p_update_id: updateRowId,
      p_last_error_code: "INTEGRATION_READ_FAILED",
    }));
    expect(storage.transitionRequestReceiptIfPresent).not.toHaveBeenCalled();
    expect(rpc.fail).not.toHaveBeenCalled();
  });

  it("keeps retrying a max-plus-one integration read outage without terminalizing a persisted answer", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      loadIntegration: vi.fn().mockRejectedValue(new Error("temporary database outage")),
    });
    const config = fakeConfig({ rpc, storage });

    const result = await processUpdate(config, makeUpdate({ attemptCount: 6, maxAttempts: 5 }));

    expect(result.status).toBe("retry");
    expect(rpc.retry).toHaveBeenCalledWith(expect.objectContaining({
      p_update_id: updateRowId,
      p_last_error_code: "INTEGRATION_READ_FAILED",
    }));
    expect(storage.transitionRequestReceiptIfPresent).not.toHaveBeenCalled();
    expect(storage.createRequestReceipt).not.toHaveBeenCalled();
    expect(rpc.fail).not.toHaveBeenCalled();
  });

  it("honors a queued cancellation discovered while retrying an integration read", async () => {
    const rpc = fakeRpc({
      retry: vi.fn().mockResolvedValue({ data: "cancel_requested", error: null }),
    });
    const storage = fakeStorage({
      loadIntegration: vi.fn().mockRejectedValue(new Error("temporary database outage")),
    });
    const config = fakeConfig({ rpc, storage });

    const result = await processUpdate(config, makeUpdate({ attemptCount: 2 }));

    expect(result.status).toBe("cancelled");
    expect(storage.transitionRequestReceiptIfPresent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelled", updateRowId, leaseId: "lease-1" }),
    );
    expect(rpc.cancel).toHaveBeenCalledWith(expect.objectContaining({ p_update_id: updateRowId }));
    expect(rpc.fail).not.toHaveBeenCalled();
  });

  it("honors a queued cancellation when shutdown tries to requeue the update", async () => {
    const rpc = fakeRpc({
      retry: vi.fn().mockResolvedValue({ data: "cancel_requested", error: null }),
    });
    const storage = fakeStorage();
    const config = fakeConfig({ rpc, storage });
    const shutdownController = new AbortController();
    shutdownController.abort();

    const result = await processUpdate(
      config,
      makeUpdate(),
      { shutdownSignal: shutdownController.signal },
    );

    expect(result.status).toBe("cancelled");
    expect(storage.loadIntegration).not.toHaveBeenCalled();
    expect(storage.transitionRequestReceiptIfPresent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelled" }),
    );
    expect(rpc.cancel).toHaveBeenCalled();
  });

  it("terminally fails when the integration does not exist, without calling Telegram", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({ loadIntegration: vi.fn().mockResolvedValue(null) });
    const createBotApiForToken = vi.fn(() => fakeBotApi());
    const config = fakeConfig({ rpc, storage, createBotApiForToken });

    const result = await processUpdate(config, makeUpdate());

    expect(result.status).toBe("failed");
    expect(storage.transitionRequestReceiptIfPresent).toHaveBeenCalledWith(expect.objectContaining({
      updateRowId,
      leaseId: "lease-1",
      status: "failed",
      errorCode: "integration_inactive",
    }));
    expect(rpc.fail).toHaveBeenCalledWith(expect.objectContaining({ p_update_id: updateRowId }));
    expect(rpc.complete).not.toHaveBeenCalled();
    expect(createBotApiForToken).not.toHaveBeenCalled();
  });

  it("stops before queue terminalization when the receipt RPC rejects a stale lease", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      loadIntegration: vi.fn().mockResolvedValue(null),
      transitionRequestReceiptIfPresent: vi.fn().mockResolvedValue({
        leaseValid: false,
        receiptPresent: false,
      }),
    });
    const config = fakeConfig({ rpc, storage });

    await expect(processUpdate(config, makeUpdate())).rejects.toBeInstanceOf(
      TelegramUpdateLeaseLostError,
    );

    expect(storage.transitionRequestReceiptIfPresent).toHaveBeenCalledWith(
      expect.objectContaining({ updateRowId, leaseId: "lease-1" }),
    );
    expect(rpc.fail).not.toHaveBeenCalled();
    expect(rpc.complete).not.toHaveBeenCalled();
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
  it("does not create or run a Fred request after the queue lease was reclaimed", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      createRequestReceipt: vi.fn().mockResolvedValue(false),
    });
    const { executeTurn, calls } = answerTurn();
    const config = fakeConfig({ rpc, storage, executeTurn });

    await expect(processUpdate(config, makeUpdate())).rejects.toBeInstanceOf(
      TelegramUpdateLeaseLostError,
    );

    expect(storage.createRequestReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        telegramUpdateId: updateRowId,
        updateRowId,
        leaseId: "lease-1",
      }),
    );
    expect(storage.resumeRequestReceipt).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    expect(rpc.complete).not.toHaveBeenCalled();
    expect(rpc.fail).not.toHaveBeenCalled();
  });

  it("does not send draft previews while Fred emits partial answer deltas", async () => {
    vi.useFakeTimers();
    let settleTurn!: () => void;
    const turnSettled = new Promise<void>((resolve) => { settleTurn = resolve; });
    let pending: Promise<Awaited<ReturnType<typeof processUpdate>>> | undefined;
    try {
      const rpc = fakeRpc();
      const storage = fakeStorage();
      const botApi = fakeBotApi();
      const { executeTurn } = capturingTurn(async function* () {
        yield { type: "delta", content: "Teilantwort" };
        await turnSettled;
        return {
          answer: "Fertige Antwort",
          rawAnswer: "Fertige Antwort",
          conversation: fakeConversation,
          researchTrace: [],
          sourceReferences: [],
          stopped: false,
        };
      });
      const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn });

      pending = processUpdate(config, makeUpdate());
      void pending.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(6_000);

      expect(botApi.sendMessageDraft).not.toHaveBeenCalled();
    } finally {
      settleTurn();
      await pending?.catch(() => undefined);
      vi.useRealTimers();
    }
  });

  it("sends typing immediately, refreshes every four seconds, and stops after the Fred turn settles", async () => {
    vi.useFakeTimers();
    let settleTurn!: () => void;
    const turnSettled = new Promise<void>((resolve) => { settleTurn = resolve; });
    let pending: ReturnType<typeof processUpdate> | undefined;
    try {
      const rpc = fakeRpc();
      const storage = fakeStorage();
      const botApi = fakeBotApi();
      let fredSignal: AbortSignal | undefined;
      const { executeTurn } = capturingTurn(async function* (request) {
        fredSignal = request.signal;
        await turnSettled;
        return {
          answer: "Fertige Antwort",
          rawAnswer: "Fertige Antwort",
          conversation: fakeConversation,
          researchTrace: [],
          sourceReferences: [],
          stopped: false,
        };
      });
      const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn });

      pending = processUpdate(config, makeUpdate());
      void pending.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(0);

      expect(botApi.sendChatAction).toHaveBeenCalledTimes(1);
      const typingSignal = vi.mocked(botApi.sendChatAction).mock.calls[0]?.[1]?.signal;
      expect(typingSignal).toBeInstanceOf(AbortSignal);
      expect(typingSignal).not.toBe(fredSignal);
      expect(botApi.sendChatAction).toHaveBeenLastCalledWith(
        { chat_id: telegramChatId, action: "typing" },
        { signal: typingSignal },
      );

      await vi.advanceTimersByTimeAsync(3_999);
      expect(botApi.sendChatAction).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(botApi.sendChatAction).toHaveBeenCalledTimes(2);
      for (const call of vi.mocked(botApi.sendChatAction).mock.calls) {
        expect(call).toEqual([
          { chat_id: telegramChatId, action: "typing" },
          { signal: typingSignal },
        ]);
      }

      settleTurn();
      const result = await pending;
      expect(result.status).toBe("completed");
      expect(typingSignal?.aborted).toBe(true);

      await vi.advanceTimersByTimeAsync(8_000);
      expect(botApi.sendChatAction).toHaveBeenCalledTimes(2);
    } finally {
      settleTurn();
      await pending?.catch(() => undefined);
      vi.useRealTimers();
    }
  });

  it("ignores typing-action rejection and still delivers the final answer", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    vi.mocked(botApi.sendChatAction).mockRejectedValue(new Error("typing unavailable"));
    const { executeTurn } = answerTurn("Die Antwort wird trotzdem zugestellt.");
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn });

    const result = await processUpdate(config, makeUpdate());

    expect(result.status).toBe("completed");
    expect(botApi.sendChatAction).toHaveBeenCalledWith(
      { chat_id: telegramChatId, action: "typing" },
      { signal: expect.any(AbortSignal) },
    );
    expect(botApi.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_id: telegramChatId,
        text: expect.stringContaining("trotzdem zugestellt"),
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(rpc.complete).toHaveBeenCalled();
  });

  it("passes an existing conversation binding through to the Fred request", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({ getActiveConversation: vi.fn().mockResolvedValue("existing-conv-id") });
    const { executeTurn, calls } = answerTurn();
    const config = fakeConfig({ rpc, storage, executeTurn });

    await processUpdate(config, makeUpdate());

    expect(calls[0]?.conversationId).toBe("existing-conv-id");
  });

  it("resumes with the frozen conversation and modes instead of the current binding and integration settings", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      loadIntegration: vi.fn().mockResolvedValue(makeIntegration({
        proModeEnabled: true,
        webSearchEnabled: false,
      })),
      getActiveConversation: vi.fn().mockResolvedValue("current-conversation-id"),
      resumeRequestReceipt: vi.fn().mockResolvedValue({
        status: "user_persisted",
        contentDeleted: false,
        conversationId: "frozen-conversation-id",
        userMessageId: 81,
        webSearchEnabled: true,
        proModeEnabled: false,
      }),
    });
    const { executeTurn, calls } = answerTurn();
    const config = fakeConfig({ rpc, storage, executeTurn });

    await processUpdate(config, makeUpdate({ attemptCount: 1 }));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(expect.objectContaining({
      conversationId: "frozen-conversation-id",
      webSearchEnabled: true,
      proModeEnabled: false,
    }));
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
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(storage.claimDelivery).toHaveBeenCalledWith(expect.objectContaining({
      updateRowId: 42,
      chunkIndex: 0,
      leaseId: "lease-1",
    }));
    expect(storage.finishDelivery).toHaveBeenCalledWith(expect.objectContaining({
      updateRowId: 42,
      chunkIndex: 0,
      leaseId: "lease-1",
      status: "sent",
      telegramMessageId: 2,
    }));
    expect(rpc.complete).toHaveBeenCalled();
  });

  it("delivers a valid GFM table as raw Markdown", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    const answer = "Ergebnis:\n\n| Steuer | Satz |\n|---|---|\n| USt | 20% |";
    const { executeTurn } = answerTurn(answer);
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn });

    const result = await processUpdate(config, makeUpdate({ id: 43 }));

    expect(result.status).toBe("completed");
    expect(botApi.sendRichMessage).toHaveBeenCalledWith(
      {
        chat_id: telegramChatId,
        rich_message: { markdown: answer },
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(botApi.sendMessage).not.toHaveBeenCalled();
    expect(storage.claimDelivery).toHaveBeenCalledWith(expect.objectContaining({
      updateRowId: 43,
      chunkIndex: 0,
      content: expect.stringContaining("<pre>"),
    }));
    expect(storage.finishDelivery).toHaveBeenCalledWith(expect.objectContaining({
      updateRowId: 43,
      chunkIndex: 0,
      status: "sent",
      telegramMessageId: 3,
    }));
  });

  it("uses legacy delivery when rich Markdown exceeds the cap", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    const answer = `| A | B |\n|---|---|\n| 1 | 2 |\n\n${"x".repeat(32_769)}`;
    const { executeTurn } = answerTurn(answer);
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn });

    const result = await processUpdate(config, makeUpdate({ id: 44 }));

    expect(result.status).toBe("completed");
    expect(botApi.sendRichMessage).not.toHaveBeenCalled();
    expect(botApi.sendMessage).toHaveBeenCalled();
  });

  it("skips chunks already marked sent in delivery state instead of resending them", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      claimDelivery: vi.fn().mockResolvedValue("sent"),
    });
    const botApi = fakeBotApi();
    const { executeTurn } = answerTurn("Kurze Antwort.");
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn });

    const result = await processUpdate(config, makeUpdate({ id: 9 }));

    expect(result.status).toBe("completed");
    expect(botApi.sendMessage).not.toHaveBeenCalled();
    expect(storage.finishDelivery).not.toHaveBeenCalled();
  });

  it("terminally fails without resending when a persisted delivery chunk is uncertain", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      claimDelivery: vi.fn().mockResolvedValue("uncertain"),
    });
    const botApi = fakeBotApi();
    const { executeTurn } = answerTurn("Kurze Antwort.");
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn });

    const result = await processUpdate(config, makeUpdate());

    expect(result.status).toBe("failed");
    expect(botApi.sendMessage).not.toHaveBeenCalled();
    expect(storage.finishDelivery).not.toHaveBeenCalled();
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
      checkCancelled: vi.fn()
        .mockResolvedValueOnce({ data: false, error: null })
        .mockResolvedValue({ data: true, error: null }),
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

  it("honors a queued cancellation discovered while retrying a turn failure", async () => {
    const rpc = fakeRpc({
      retry: vi.fn().mockResolvedValue({ data: "cancel_requested", error: null }),
    });
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    const { executeTurn } = erroringTurn("Upstream fehlgeschlagen");
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn });

    const result = await processUpdate(config, makeUpdate({ attemptCount: 2 }));

    expect(result.status).toBe("cancelled");
    expect(storage.transitionRequestReceiptIfPresent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelled", failurePhase: "connecting" }),
    );
    expect(rpc.cancel).toHaveBeenCalled();
    expect(rpc.fail).not.toHaveBeenCalled();
  });

  it("delivers an atomically reconciled completed receipt on the generic final attempt", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      resumeRequestReceipt: vi.fn().mockRejectedValue(new Error("transient resume read")),
      transitionRequestReceiptIfPresent: vi.fn().mockResolvedValue({
        leaseValid: true,
        receiptPresent: true,
        status: "completed",
        contentDeleted: false,
        conversationId: "frozen-conversation-id",
        userMessageId: 81,
        assistantMessageId: 82,
        answer: "Atomar wiedergefundene Antwort",
        webSearchEnabled: false,
        proModeEnabled: false,
      }),
    });
    const botApi = fakeBotApi();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi });

    const result = await processUpdate(config, makeUpdate({ attemptCount: 5 }));

    expect(result.status).toBe("completed");
    expect(storage.transitionRequestReceiptIfPresent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", updateRowId, leaseId: "lease-1" }),
    );
    expect(botApi.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Atomar wiedergefundene Antwort" }),
      expect.any(Object),
    );
    expect(rpc.complete).toHaveBeenCalled();
    expect(rpc.fail).not.toHaveBeenCalled();
  });

  it("uses a max-plus-one reclaim only for reconciliation and never starts upstream work", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      transitionRequestReceiptIfPresent: vi.fn().mockResolvedValue({
        leaseValid: true,
        receiptPresent: true,
        status: "completed",
        contentDeleted: false,
        conversationId: "frozen-conversation-id",
        userMessageId: 81,
        assistantMessageId: 82,
        answer: "Nach Lease-Ablauf wiedergefundene Antwort",
        webSearchEnabled: false,
        proModeEnabled: false,
      }),
    });
    const botApi = fakeBotApi();
    const executeTurn = vi.fn() as unknown as typeof executeFredTurn;
    const config = fakeConfig({
      rpc,
      storage,
      createBotApiForToken: () => botApi,
      executeTurn,
    });

    const result = await processUpdate(config, makeUpdate({ attemptCount: 6, maxAttempts: 5 }));

    expect(result.status).toBe("completed");
    expect(executeTurn).not.toHaveBeenCalled();
    expect(storage.createRequestReceipt).not.toHaveBeenCalled();
    expect(storage.transitionRequestReceiptIfPresent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", errorCode: "EXHAUSTED_ATTEMPT_CLEANUP" }),
    );
    expect(botApi.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Nach Lease-Ablauf wiedergefundene Antwort" }),
      expect.any(Object),
    );
    expect(rpc.complete).toHaveBeenCalledTimes(1);
    expect(rpc.retry).not.toHaveBeenCalled();
    expect(rpc.fail).not.toHaveBeenCalled();
  });

  it("terminally records an uncertain delivery of a reconciled final-attempt answer", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      resumeRequestReceipt: vi.fn().mockRejectedValue(new Error("transient resume read")),
      transitionRequestReceiptIfPresent: vi.fn().mockResolvedValue({
        leaseValid: true,
        receiptPresent: true,
        status: "completed",
        contentDeleted: false,
        conversationId: "frozen-conversation-id",
        userMessageId: 81,
        assistantMessageId: 82,
        answer: "Nicht doppelt zustellen",
        webSearchEnabled: false,
        proModeEnabled: false,
      }),
    });
    const botApi = fakeBotApi();
    vi.mocked(botApi.sendMessage).mockRejectedValue(new TypeError("socket closed after write"));
    const config = fakeConfig({
      rpc,
      storage,
      createBotApiForToken: () => botApi,
      maxDeliveryRetries: 1,
    });

    const result = await processUpdate(config, makeUpdate({ attemptCount: 5, maxAttempts: 5 }));

    expect(result.status).toBe("failed");
    expect(rpc.fail).toHaveBeenCalledWith(expect.objectContaining({
      p_update_id: updateRowId,
      p_last_error_code: "DELIVERY_UNCERTAIN",
    }));
    expect(rpc.retry).not.toHaveBeenCalled();
    expect(rpc.complete).not.toHaveBeenCalled();
  });

  it("keeps a transient failed attempt nonterminal before retrying the queue row", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    const { executeTurn } = capturingTurn(async function* (request) {
      await request.onRequestTransition?.({
        status: "user_persisted",
        conversationId: "frozen-conversation-id",
        userMessageId: 81,
      });
      await request.onRequestTransition?.({ status: "generating" });
      throw new Error("transient upstream failure");
    });
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn });

    const result = await processUpdate(config, makeUpdate({ attemptCount: 2 }));

    expect(result.status).toBe("failed");
    expect(storage.transitionRequestReceipt).toHaveBeenCalledWith(expect.objectContaining({
      status: "user_persisted",
    }));
    expect(storage.transitionRequestReceipt).toHaveBeenCalledWith(expect.objectContaining({
      status: "generating",
    }));
    expect(storage.transitionRequestReceipt).not.toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
    }));
    expect(storage.transitionRequestReceipt).not.toHaveBeenCalledWith(expect.objectContaining({
      status: "cancelled",
    }));
    expect(rpc.retry).toHaveBeenCalledWith(expect.objectContaining({
      p_update_id: updateRowId,
      p_retry_delay_seconds: 60 * 2 ** 2,
    }));
    expect(rpc.fail).not.toHaveBeenCalled();
  });

  it("propagates a lost completion lease without attempting a stale retry or fail transition", async () => {
    const rpc = fakeRpc({
      complete: vi.fn().mockResolvedValue({ data: false, error: null }),
    });
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    const { executeTurn } = answerTurn("Persistierte Antwort");
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn });

    await expect(processUpdate(config, makeUpdate())).rejects.toBeInstanceOf(
      TelegramUpdateLeaseLostError,
    );

    expect(rpc.complete).toHaveBeenCalledTimes(1);
    expect(rpc.retry).not.toHaveBeenCalled();
    expect(rpc.fail).not.toHaveBeenCalled();
  });

  it("refuses to start Telegram delivery when the synchronous lease check is lost", async () => {
    const rpc = fakeRpc({
      heartbeat: vi.fn().mockResolvedValue({ data: false, error: null }),
    });
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    const { executeTurn } = answerTurn("Nicht mehr zustellen.");
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn });

    await expect(processUpdate(config, makeUpdate())).rejects.toBeInstanceOf(
      TelegramUpdateLeaseLostError,
    );

    expect(storage.claimDelivery).not.toHaveBeenCalled();
    expect(botApi.sendMessage).not.toHaveBeenCalled();
    expect(rpc.retry).not.toHaveBeenCalled();
    expect(rpc.fail).not.toHaveBeenCalled();
  });

  it("does not start normal text upstream work when the synchronous first heartbeat loses the lease", async () => {
    const rpc = fakeRpc({
      heartbeat: vi.fn().mockResolvedValue({ data: false, error: null }),
    });
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    const executeTurn = vi.fn() as unknown as typeof executeFredTurn;
    const config = fakeConfig({
      rpc,
      storage,
      createBotApiForToken: () => botApi,
      executeTurn,
    });

    await expect(processUpdate(config, makeUpdate())).rejects.toBeInstanceOf(
      TelegramUpdateLeaseLostError,
    );

    expect(executeTurn).not.toHaveBeenCalled();
    expect(botApi.sendMessage).not.toHaveBeenCalled();
    expect(rpc.retry).not.toHaveBeenCalled();
    expect(rpc.fail).not.toHaveBeenCalled();
  });

  it("refuses to send a chunk when its durable claim reports lease loss", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      claimDelivery: vi.fn().mockResolvedValue("lease_lost"),
    });
    const botApi = fakeBotApi();
    const { executeTurn } = answerTurn("Nicht mehr zustellen.");
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn });

    await expect(processUpdate(config, makeUpdate())).rejects.toBeInstanceOf(
      TelegramUpdateLeaseLostError,
    );

    expect(botApi.sendMessage).not.toHaveBeenCalled();
    expect(storage.finishDelivery).not.toHaveBeenCalled();
    expect(rpc.retry).not.toHaveBeenCalled();
    expect(rpc.fail).not.toHaveBeenCalled();
  });

  it("cancels without sending when /stop wins the locked delivery claim", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      claimDelivery: vi.fn().mockResolvedValue("cancelled"),
    });
    const botApi = fakeBotApi();
    const { executeTurn } = answerTurn("Nicht mehr zustellen.");
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn });

    const result = await processUpdate(config, makeUpdate());

    expect(result.status).toBe("cancelled");
    expect(botApi.sendMessage).not.toHaveBeenCalled();
    expect(storage.finishDelivery).not.toHaveBeenCalled();
    expect(rpc.cancel).not.toHaveBeenCalled();
    expect(rpc.complete).not.toHaveBeenCalled();
    expect(rpc.retry).not.toHaveBeenCalled();
    expect(rpc.fail).not.toHaveBeenCalled();
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

  it("delivers a concurrently persisted answer instead of poisoning it on the last attempt", async () => {
    const rpc = fakeRpc();
    let resumeCalls = 0;
    const storage = fakeStorage({
      transitionRequestReceiptIfPresent: vi.fn().mockResolvedValue({
        leaseValid: true,
        receiptPresent: false,
      }),
      resumeRequestReceipt: vi.fn().mockImplementation(async () => {
        resumeCalls += 1;
        if (resumeCalls === 1) {
          return {
            status: "generating" as const,
            contentDeleted: false,
            conversationId: "frozen-conversation-id",
            userMessageId: 81,
            webSearchEnabled: false,
            proModeEnabled: false,
          };
        }
        return {
          status: "completed" as const,
          contentDeleted: false,
          conversationId: "frozen-conversation-id",
          userMessageId: 81,
          assistantMessageId: 82,
          answer: "Atomar reconciliierte Antwort.",
          webSearchEnabled: false,
          proModeEnabled: false,
        };
      }),
    });
    const botApi = fakeBotApi();
    const { executeTurn } = erroringTurn("stale worker event collision");
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn });

    const result = await processUpdate(config, makeUpdate({ attemptCount: 5 }));

    expect(result.status).toBe("completed");
    expect(storage.transitionRequestReceiptIfPresent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", errorCode: "turn_failed" }),
    );
    expect(botApi.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("Atomar reconciliierte Antwort") }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(rpc.complete).toHaveBeenCalledTimes(1);
    expect(rpc.fail).not.toHaveBeenCalled();
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
            { id: 1, update_id: 1, integration_id: "int-a", raw_update: rawUpdateFor(1), telegram_chat_id: 1, status: "processing", lease_id: "l1", lease_expires_at: new Date().toISOString(), attempt_count: 0, max_attempts: 5, available_at: new Date().toISOString(), cancel_requested: false, update_kind: "message" },
            { id: 2, update_id: 2, integration_id: "int-b", raw_update: rawUpdateFor(2), telegram_chat_id: 2, status: "processing", lease_id: "l2", lease_expires_at: new Date().toISOString(), attempt_count: 0, max_attempts: 5, available_at: new Date().toISOString(), cancel_requested: false, update_kind: "message" },
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
        max_attempts: claimed.maxAttempts,
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
    const storage = fakeStorage();
    const config = fakeConfig({ rpc, storage, executeTurn });

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
    expect(storage.transitionRequestReceipt).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelled" }),
    );
  });
});

// ── Pro/Web mode tests ──────────────────────────────────────────────────────

describe("processUpdate: pro command", () => {
  it("replies with current pro mode status for bare /pro", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      loadIntegration: vi.fn().mockResolvedValue(makeIntegration({ proModeEnabled: false, webSearchEnabled: false })),
    });
    const botApi = fakeBotApi();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi });
    const update = makeUpdate({ rawUpdate: textUpdate("/pro") });

    const result = await processUpdate(config, update);

    expect(result.status).toBe("completed");
    expect(storage.setMode).not.toHaveBeenCalled();
    const sentText = (botApi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].text as string;
    expect(sentText).toContain("Pro-Modus");
    expect(sentText).toContain("deaktiviert");
    expect(sentText).toContain("/pro on");
    expect(rpc.complete).toHaveBeenCalled();
  });

  it("/pro status reports current state without writing", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      loadIntegration: vi.fn().mockResolvedValue(makeIntegration({ proModeEnabled: true, webSearchEnabled: false })),
    });
    const botApi = fakeBotApi();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi });
    const update = makeUpdate({ rawUpdate: textUpdate("/pro status") });

    const result = await processUpdate(config, update);

    expect(result.status).toBe("completed");
    expect(storage.setMode).not.toHaveBeenCalled();
    const sentText = (botApi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].text as string;
    expect(sentText).toContain("aktiviert");
    expect(rpc.complete).toHaveBeenCalled();
  });

  it("/pro on idempotently enables pro mode", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      loadIntegration: vi.fn().mockResolvedValue(makeIntegration({ proModeEnabled: false, webSearchEnabled: false })),
      setMode: vi.fn().mockResolvedValue({ proModeEnabled: true, webSearchEnabled: false }),
    });
    const botApi = fakeBotApi();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi });
    const update = makeUpdate({ rawUpdate: textUpdate("/pro on") });

    const result = await processUpdate(config, update);

    expect(result.status).toBe("completed");
    expect(storage.setMode).toHaveBeenCalledWith(integrationId, "pro", true);
    const sentText = (botApi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].text as string;
    expect(sentText).toContain("aktiviert");
    expect(rpc.complete).toHaveBeenCalled();
  });

  it("/pro off idempotently disables pro mode", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      loadIntegration: vi.fn().mockResolvedValue(makeIntegration({ proModeEnabled: true, webSearchEnabled: false })),
    });
    const botApi = fakeBotApi();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi });
    const update = makeUpdate({ rawUpdate: textUpdate("/pro off") });

    const result = await processUpdate(config, update);

    expect(result.status).toBe("completed");
    expect(storage.setMode).toHaveBeenCalledWith(integrationId, "pro", false);
    const sentText = (botApi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].text as string;
    expect(sentText).toContain("deaktiviert");
    expect(rpc.complete).toHaveBeenCalled();
  });

  it("/pro on is idempotent when already enabled", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      loadIntegration: vi.fn().mockResolvedValue(makeIntegration({ proModeEnabled: true, webSearchEnabled: false })),
    });
    const botApi = fakeBotApi();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi });
    const update = makeUpdate({ rawUpdate: textUpdate("/pro on") });

    await processUpdate(config, update);

    expect(storage.setMode).toHaveBeenCalledWith(integrationId, "pro", true);
  });

  it("/pro nonsense sends pro usage and does NOT call setMode", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      loadIntegration: vi.fn().mockResolvedValue(makeIntegration({ proModeEnabled: false, webSearchEnabled: false })),
    });
    const botApi = fakeBotApi();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi });
    const update = makeUpdate({ rawUpdate: textUpdate("/pro nonsense") });

    const result = await processUpdate(config, update);

    expect(result.status).toBe("completed");
    expect(storage.setMode).not.toHaveBeenCalled();
    const sentText = (botApi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].text as string;
    expect(sentText).toBe("Nutzung: /pro on|off|status");
    expect(rpc.complete).toHaveBeenCalled();
  });
});

describe("processUpdate: web command", () => {
  it("/web reports deactivated when web search is off", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      loadIntegration: vi.fn().mockResolvedValue(makeIntegration({ proModeEnabled: false, webSearchEnabled: false })),
    });
    const botApi = fakeBotApi();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi });
    const update = makeUpdate({ rawUpdate: textUpdate("/web") });

    const result = await processUpdate(config, update);

    expect(result.status).toBe("completed");
    const sentText = (botApi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].text as string;
    expect(sentText).toContain("Websuche");
    expect(sentText).toContain("deaktiviert");
    expect(sentText).toContain("/web on");
    expect(storage.setMode).not.toHaveBeenCalled();
  });

  it("/web on enables web search", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      loadIntegration: vi.fn().mockResolvedValue(makeIntegration({ proModeEnabled: false, webSearchEnabled: false })),
    });
    const botApi = fakeBotApi();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi });
    const update = makeUpdate({ rawUpdate: textUpdate("/web on") });

    await processUpdate(config, update);

    expect(storage.setMode).toHaveBeenCalledWith(integrationId, "web", true);
  });

  it("/web off disables web search", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      loadIntegration: vi.fn().mockResolvedValue(makeIntegration({ proModeEnabled: false, webSearchEnabled: true })),
    });
    const botApi = fakeBotApi();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi });
    const update = makeUpdate({ rawUpdate: textUpdate("/web off") });

    await processUpdate(config, update);

    expect(storage.setMode).toHaveBeenCalledWith(integrationId, "web", false);
  });

  it("/web on please sends web usage and does NOT call setMode", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      loadIntegration: vi.fn().mockResolvedValue(makeIntegration({ proModeEnabled: false, webSearchEnabled: false })),
    });
    const botApi = fakeBotApi();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi });
    const update = makeUpdate({ rawUpdate: textUpdate("/web on please") });

    const result = await processUpdate(config, update);

    expect(result.status).toBe("completed");
    expect(storage.setMode).not.toHaveBeenCalled();
    const sentText = (botApi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].text as string;
    expect(sentText).toBe("Nutzung: /web on|off|status");
    expect(rpc.complete).toHaveBeenCalled();
  });
});

describe("processUpdate: /settings displays dynamic modes", () => {
  it("shows both pro and web status in settings", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      loadIntegration: vi.fn().mockResolvedValue(makeIntegration({ proModeEnabled: true, webSearchEnabled: false })),
    });
    const botApi = fakeBotApi();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi });
    const update = makeUpdate({ rawUpdate: textUpdate("/settings") });

    await processUpdate(config, update);

    const sentText = (botApi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].text as string;
    expect(sentText).toContain("Einstellungen");
    expect(sentText).toContain("Pro-Modus");
    expect(sentText).toContain("aktiviert");
    expect(sentText).toContain("Websuche");
    expect(sentText).toContain("deaktiviert");
    expect(sentText).toContain("/pro");
    expect(sentText).toContain("/web");
  });
});

describe("processUpdate: /new preserves modes", () => {
  it("clears conversation but does not change pro/web mode", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      loadIntegration: vi.fn().mockResolvedValue(makeIntegration({ proModeEnabled: true, webSearchEnabled: true })),
    });
    const botApi = fakeBotApi();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi });
    const update = makeUpdate({ rawUpdate: textUpdate("/new") });

    await processUpdate(config, update);

    expect(storage.clearActiveConversation).toHaveBeenCalledWith(integrationId, telegramChatId);
    expect(storage.setMode).not.toHaveBeenCalled();
    expect(rpc.complete).toHaveBeenCalled();
  });
});

describe("processUpdate: turn routing with pro/web flags", () => {
  it("passes proModeEnabled=true and webSearchEnabled=false from integration to FredTurnRequest", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      loadIntegration: vi.fn().mockResolvedValue(makeIntegration({ proModeEnabled: true, webSearchEnabled: false })),
    });
    const { executeTurn, calls } = answerTurn();
    const config = fakeConfig({ rpc, storage, executeTurn });

    await processUpdate(config, makeUpdate());

    expect(calls[0]?.proModeEnabled).toBe(true);
    expect(calls[0]?.webSearchEnabled).toBe(false);
  });

  it("passes proModeEnabled=false and webSearchEnabled=true", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      loadIntegration: vi.fn().mockResolvedValue(makeIntegration({ proModeEnabled: false, webSearchEnabled: true })),
    });
    const { executeTurn, calls } = answerTurn();
    const config = fakeConfig({ rpc, storage, executeTurn });

    await processUpdate(config, makeUpdate());

    expect(calls[0]?.proModeEnabled).toBe(false);
    expect(calls[0]?.webSearchEnabled).toBe(true);
  });

  it("passes both true", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      loadIntegration: vi.fn().mockResolvedValue(makeIntegration({ proModeEnabled: true, webSearchEnabled: true })),
    });
    const { executeTurn, calls } = answerTurn();
    const config = fakeConfig({ rpc, storage, executeTurn });

    await processUpdate(config, makeUpdate());

    expect(calls[0]?.proModeEnabled).toBe(true);
    expect(calls[0]?.webSearchEnabled).toBe(true);
  });

  it("passes both false (default)", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      loadIntegration: vi.fn().mockResolvedValue(makeIntegration({ proModeEnabled: false, webSearchEnabled: false })),
    });
    const { executeTurn, calls } = answerTurn();
    const config = fakeConfig({ rpc, storage, executeTurn });

    await processUpdate(config, makeUpdate());

    expect(calls[0]?.proModeEnabled).toBe(false);
    expect(calls[0]?.webSearchEnabled).toBe(false);
  });
});

describe("processUpdate: /help and /start list pro and web", () => {
  it("/help lists /pro and /web", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi });
    const update = makeUpdate({ rawUpdate: textUpdate("/help") });

    await processUpdate(config, update);

    const sentText = (botApi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].text as string;
    expect(sentText).toContain("/pro");
    expect(sentText).toContain("/web");
  });

  it("/start lists /pro and /web", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi });
    const update = makeUpdate({ rawUpdate: textUpdate("/start") });

    await processUpdate(config, update);

    const sentText = (botApi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].text as string;
    expect(sentText).toContain("/pro");
    expect(sentText).toContain("/web");
  });
});

describe("processUpdate: bare commands do not toggle", () => {
  it("bare /pro does NOT toggle pro mode", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      loadIntegration: vi.fn().mockResolvedValue(makeIntegration({ proModeEnabled: false, webSearchEnabled: false })),
    });
    const botApi = fakeBotApi();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi });
    const update = makeUpdate({ rawUpdate: textUpdate("/pro") });

    await processUpdate(config, update);

    expect(storage.setMode).not.toHaveBeenCalled();
    expect(rpc.complete).toHaveBeenCalled();
  });

  it("bare /web does NOT toggle web search", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      loadIntegration: vi.fn().mockResolvedValue(makeIntegration({ proModeEnabled: false, webSearchEnabled: true })),
    });
    const botApi = fakeBotApi();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi });
    const update = makeUpdate({ rawUpdate: textUpdate("/web") });

    await processUpdate(config, update);

    expect(storage.setMode).not.toHaveBeenCalled();
    expect(rpc.complete).toHaveBeenCalled();
  });
});

// ── Attachment support ───────────────────────────────────────────────────────

import type { AttachmentPreprocessResult, AttachmentPreprocessor } from "./worker";
import type { FredTurnAttachmentMeta } from "../fred/turn-types";

const fakeAttachmentMeta: FredTurnAttachmentMeta = {
  kind: "file",
  name: "test.pdf",
  mime_type: "application/pdf",
  size_bytes: 100,
  sha256: "abc123",
};

function docUpdate(fileName = "test.pdf", mimeType = "application/pdf", fileSize = 100, caption?: string) {
  return {
    update_id: updateId,
    message: {
      message_id: 55,
      from: { id: telegramUserId, is_bot: false, first_name: "Test" },
      chat: { id: telegramChatId, type: "private" },
      date: Math.floor(Date.now() / 1000),
      document: {
        file_id: "file-doc-1",
        file_unique_id: "unq-doc-1",
        file_name: fileName,
        mime_type: mimeType,
        file_size: fileSize,
      },
      ...(caption !== undefined ? { caption } : {}),
    },
  };
}

function photoUpdate(fileSizes: Array<number | undefined> = [5000, 15000, 30000], caption?: string) {
  const sizes = fileSizes.map((fs, i) => ({
    file_id: `photo-${i}`,
    file_unique_id: `unq-photo-${i}`,
    width: 100 * (i + 1),
    height: 100 * (i + 1),
    ...(fs !== undefined ? { file_size: fs } : {}),
  }));
  return {
    update_id: updateId,
    message: {
      message_id: 55,
      from: { id: telegramUserId, is_bot: false, first_name: "Test" },
      chat: { id: telegramChatId, type: "private" },
      date: Math.floor(Date.now() / 1000),
      photo: sizes,
      ...(caption !== undefined ? { caption } : {}),
    },
  };
}

function fakePreprocessor(result: AttachmentPreprocessResult): AttachmentPreprocessor {
  return vi.fn<AttachmentPreprocessor>().mockResolvedValue(result);
}

describe("processUpdate: document attachments", () => {
  it("delivers a persisted completed answer without rerunning the turn or attachment preprocessor", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage({
      resumeRequestReceipt: vi.fn().mockResolvedValue({
        status: "completed",
        contentDeleted: false,
        conversationId: "completed-conversation-id",
        userMessageId: 81,
        assistantMessageId: 82,
        answer: "Bereits gespeicherte Antwort.",
        webSearchEnabled: false,
        proModeEnabled: false,
      }),
    });
    const botApi = fakeBotApi();
    const preprocessor = vi.fn<AttachmentPreprocessor>();
    const { executeTurn, calls } = answerTurn("Diese Antwort darf nicht erzeugt werden.");
    const config = fakeConfig({
      rpc,
      storage,
      createBotApiForToken: () => botApi,
      executeTurn,
      attachmentPreprocessor: preprocessor,
    });
    const update = makeUpdate({
      rawUpdate: docUpdate("report.pdf", "application/pdf", 1024, "Bitte prüfen."),
      attemptCount: 1,
    });

    const result = await processUpdate(config, update);

    expect(result.status).toBe("completed");
    expect(preprocessor).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    expect(botApi.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_id: telegramChatId,
        text: expect.stringContaining("Bereits gespeicherte Antwort"),
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(rpc.complete).toHaveBeenCalledTimes(1);
  });

  it("downloads, validates, preprocesses a PDF document with caption and calls FredTurn with original query and upstreamQuery", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const preprocessor = fakePreprocessor({
      upstreamQuery: "Wie hoch ist die Umsatzsteuer?\n\n--- BEGINN DER ANHÄNGE ---\nPDF content",
      metadata: fakeAttachmentMeta,
    });
    const { executeTurn, calls } = answerTurn();
    const config = fakeConfig({ rpc, storage, executeTurn, attachmentPreprocessor: preprocessor });
    const update = makeUpdate({ rawUpdate: docUpdate("report.pdf", "application/pdf", 1024, "Wie hoch ist die Umsatzsteuer?") });

    const result = await processUpdate(config, update);

    expect(result.status).toBe("completed");
    expect(preprocessor).toHaveBeenCalledTimes(1);
    expect(preprocessor).toHaveBeenCalledWith(
      expect.anything(),
      "file-doc-1",
      "report.pdf",
      "application/pdf",
      1024,
      "Wie hoch ist die Umsatzsteuer?",
      expect.any(AbortSignal),
    );
    // FredTurnRequest: query = original question
    expect(calls[0]?.query).toBe("Wie hoch ist die Umsatzsteuer?");
    // upstreamQuery = combined attachment context
    expect(calls[0]?.upstreamQuery).toBe("Wie hoch ist die Umsatzsteuer?\n\n--- BEGINN DER ANHÄNGE ---\nPDF content");
    // attachments metadata present
    expect(calls[0]?.attachments).toEqual([expect.objectContaining({ kind: "file", name: "test.pdf" })]);
  });

  it("uses default German question when caption is absent", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const preprocessor = fakePreprocessor({
      upstreamQuery: "Bitte analysiere diesen Anhang.\n\n--- BEGINN DER ANHÄNGE ---\nPDF content",
      metadata: fakeAttachmentMeta,
    });
    const { executeTurn, calls } = answerTurn();
    const config = fakeConfig({ rpc, storage, executeTurn, attachmentPreprocessor: preprocessor });
    // caption absent
    const update = makeUpdate({ rawUpdate: docUpdate("file.pdf", "application/pdf", 500) });

    const result = await processUpdate(config, update);

    expect(result.status).toBe("completed");
    expect(preprocessor).toHaveBeenCalledWith(
      expect.anything(),
      "file-doc-1",
      "file.pdf",
      "application/pdf",
      500,
      undefined,
      expect.any(AbortSignal),
    );
    expect(calls[0]?.query).toBe("Bitte analysiere diesen Anhang.");
  });

  it("trims caption whitespace for the query", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const preprocessor = fakePreprocessor({
      upstreamQuery: "  Frage?  \n\n--- BEGINN DER ANHÄNGE ---\ncontent",
      metadata: fakeAttachmentMeta,
    });
    const { executeTurn, calls } = answerTurn();
    const config = fakeConfig({ rpc, storage, executeTurn, attachmentPreprocessor: preprocessor });
    const update = makeUpdate({ rawUpdate: docUpdate("doc.pdf", "application/pdf", 100, "  Frage?  ") });

    await processUpdate(config, update);

    expect(calls[0]?.query).toBe("Frage?");
  });

  it("does NOT call FredTurn and sends a German error message when preprocessor throws a user-visible error without retries", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    const preprocessor = vi.fn<AttachmentPreprocessor>().mockRejectedValue(
      new UserVisibleError("Nicht unterstützter Dateityp.", 400),
    );
    const { executeTurn, calls } = answerTurn();
    const config = fakeConfig({ rpc, storage, executeTurn, attachmentPreprocessor: preprocessor, createBotApiForToken: () => botApi });
    const update = makeUpdate({ rawUpdate: docUpdate("bad.xyz", "application/octet-stream", 100, "Frage") });

    const result = await processUpdate(config, update);

    // Should complete (not retry) and send a user message
    expect(result.status).toBe("completed");
    expect(calls).toHaveLength(0);
    expect(botApi.sendMessage).toHaveBeenCalledTimes(1);
    const sentText = (botApi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].text as string;
    expect(sentText).toContain("Nicht unterstützter Dateityp");
    expect(rpc.retry).not.toHaveBeenCalled();
    expect(rpc.fail).not.toHaveBeenCalled();
  });

  it("delivers an answer reconciled during attachment rejection instead of sending the rejection", async () => {
    const rpc = fakeRpc();
    let resumeCalls = 0;
    const storage = fakeStorage({
      transitionRequestReceiptIfPresent: vi.fn().mockResolvedValue({
        leaseValid: true,
        receiptPresent: false,
      }),
      resumeRequestReceipt: vi.fn().mockImplementation(async () => {
        resumeCalls += 1;
        if (resumeCalls === 1) {
          return {
            status: "generating" as const,
            contentDeleted: false,
            conversationId: "frozen-conversation-id",
            userMessageId: 81,
            webSearchEnabled: false,
            proModeEnabled: false,
          };
        }
        return {
          status: "completed" as const,
          contentDeleted: false,
          conversationId: "frozen-conversation-id",
          userMessageId: 81,
          assistantMessageId: 82,
          answer: "Während der Vorverarbeitung persistierte Antwort.",
          webSearchEnabled: false,
          proModeEnabled: false,
        };
      }),
    });
    const botApi = fakeBotApi();
    const preprocessor = vi.fn<AttachmentPreprocessor>().mockRejectedValue(
      new UserVisibleError("Nicht unterstützter Dateityp.", 400),
    );
    const { executeTurn, calls } = answerTurn("Darf nicht neu erzeugt werden.");
    const config = fakeConfig({
      rpc,
      storage,
      executeTurn,
      attachmentPreprocessor: preprocessor,
      createBotApiForToken: () => botApi,
    });

    const result = await processUpdate(config, makeUpdate({
      rawUpdate: docUpdate("race.pdf", "application/pdf", 100, "Frage"),
      attemptCount: 5,
    }));

    expect(result.status).toBe("completed");
    expect(calls).toHaveLength(0);
    expect(botApi.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Während der Vorverarbeitung persistierte Antwort"),
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(botApi.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("Nicht unterstützter") }),
    );
    expect(rpc.fail).not.toHaveBeenCalled();
  });

  it("retries on transient preprocessor errors", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    const preprocessor = vi.fn<AttachmentPreprocessor>().mockRejectedValue(new Error("Network timeout"));
    const { executeTurn, calls } = answerTurn();
    const config = fakeConfig({ rpc, storage, executeTurn, attachmentPreprocessor: preprocessor, createBotApiForToken: () => botApi });
    const update = makeUpdate({ rawUpdate: docUpdate("file.pdf", "application/pdf", 100, "Frage") });

    const result = await processUpdate(config, update);

    // Should retry (not fail terminally)
    expect(result.status).toBe("failed");
    expect(calls).toHaveLength(0);
    expect(rpc.retry).toHaveBeenCalled();
    expect(rpc.fail).not.toHaveBeenCalled();
  });
});

describe("processUpdate: photo attachments", () => {
  it("reports the 10 MB image limit for a streamed oversize photo without retrying or calling Fred", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    vi.mocked(botApi.getFile).mockResolvedValue({
      file_id: "photo-2",
      file_unique_id: "unq-photo-2",
      file_path: "photos/file.jpg",
    });
    vi.mocked(botApi.downloadFile).mockRejectedValue(
      new TelegramFileTooLargeError("this message intentionally has no German size wording"),
    );
    const preprocessor = createAttachmentPreprocessor({
      document: vi.fn(),
      gemini: vi.fn(),
    });
    const { executeTurn, calls } = answerTurn();
    const config = fakeConfig({
      rpc,
      storage,
      createBotApiForToken: () => botApi,
      executeTurn,
      attachmentPreprocessor: preprocessor,
    });

    const result = await processUpdate(
      config,
      makeUpdate({ rawUpdate: photoUpdate([undefined], "Foto prüfen") }),
    );

    expect(result.status).toBe("completed");
    expect(botApi.sendMessage).toHaveBeenCalledWith({
      chat_id: telegramChatId,
      text: "Ein Bild darf maximal 10 MB groß sein.",
    });
    expect(rpc.complete).toHaveBeenCalledTimes(1);
    expect(rpc.retry).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("chooses the largest photo by file_size, treats it as JPEG, and preprocesses", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const preprocessor = fakePreprocessor({
      upstreamQuery: "Was ist auf diesem Bild?\n\n--- BEGINN DER ANHÄNGE ---\nimage desc",
      metadata: { kind: "image", name: "photo.jpg", mime_type: "image/jpeg", size_bytes: 500, sha256: "sha" },
    });
    const { executeTurn } = answerTurn();
    const config = fakeConfig({ rpc, storage, executeTurn, attachmentPreprocessor: preprocessor });
    // Three photo sizes: small (file_size 5000), large (file_size 40000), no file_size
    const update = makeUpdate({ rawUpdate: photoUpdate([5000, 40000, 30000], "Was ist auf diesem Bild?") });

    const result = await processUpdate(config, update);

    expect(result.status).toBe("completed");
    expect(preprocessor).toHaveBeenCalledTimes(1);
    // Should have picked photo-1 (largest file_size: 40000)
    expect(preprocessor).toHaveBeenCalledWith(
      expect.anything(),
      "photo-1",
      "photo.jpg",
      "image/jpeg",
      40000,
      "Was ist auf diesem Bild?",
      expect.any(AbortSignal),
    );
  });

  it("falls back to width*height when no file_size is provided", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const preprocessor = fakePreprocessor({
      upstreamQuery: "Bild\n\n--- context ---",
      metadata: { kind: "image", name: "photo.jpg", mime_type: "image/jpeg", size_bytes: 0, sha256: "sha" },
    });
    const { executeTurn } = answerTurn();
    const config = fakeConfig({ rpc, storage, executeTurn, attachmentPreprocessor: preprocessor });
    // No file_size, so area determines: photo-0=100*100=10000, photo-1=200*200=40000, photo-2=300*300=90000
    const update = makeUpdate({ rawUpdate: photoUpdate([undefined, undefined, undefined]) });

    await processUpdate(config, update);

    // Should pick photo-2 (largest width*height)
    expect(preprocessor).toHaveBeenCalledWith(
      expect.anything(),
      "photo-2",
      expect.anything(),
      expect.anything(),
      undefined,
      undefined,
      expect.any(AbortSignal),
    );
  });

  it("uses default question for captionless photos", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const preprocessor = fakePreprocessor({
      upstreamQuery: "Bitte analysiere diesen Anhang.\n\n--- context ---",
      metadata: { kind: "image", name: "photo.jpg", mime_type: "image/jpeg", size_bytes: 0, sha256: "sha" },
    });
    const { executeTurn, calls } = answerTurn();
    const config = fakeConfig({ rpc, storage, executeTurn, attachmentPreprocessor: preprocessor });
    const update = makeUpdate({ rawUpdate: photoUpdate([5000]) });

    await processUpdate(config, update);

    expect(calls[0]?.query).toBe("Bitte analysiere diesen Anhang.");
  });

  it("uses filename 'photo.jpg' for photos with deterministic sanitized name", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const preprocessor = fakePreprocessor({
      upstreamQuery: "Frage\n\n--- context ---",
      metadata: { kind: "image", name: "photo.jpg", mime_type: "image/jpeg", size_bytes: 0, sha256: "sha" },
    });
    const { executeTurn } = answerTurn();
    const config = fakeConfig({ rpc, storage, executeTurn, attachmentPreprocessor: preprocessor });
    const update = makeUpdate({ rawUpdate: photoUpdate([5000], "Frage") });

    await processUpdate(config, update);

    expect(preprocessor).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "photo.jpg",
      "image/jpeg",
      expect.anything(),
      expect.anything(),
      expect.any(AbortSignal),
    );
  });
});

describe("processUpdate: unchanged text and unsupported media", () => {
  it("still routes plain text messages to FredTurn normally", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const { executeTurn, calls } = answerTurn();
    const preprocessor = vi.fn<AttachmentPreprocessor>();
    const config = fakeConfig({ rpc, storage, executeTurn, attachmentPreprocessor: preprocessor });
    const update = makeUpdate({ rawUpdate: textUpdate("Normale Frage") });

    const result = await processUpdate(config, update);

    expect(result.status).toBe("completed");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).toBe("Normale Frage");
    expect(calls[0]?.upstreamQuery).toBeUndefined();
    expect(storage.createRequestReceipt).toHaveBeenCalledWith(expect.objectContaining({
      clientId,
      telegramUpdateId: updateRowId,
      updateRowId,
      leaseId: "lease-1",
      content: "Normale Frage",
      requestId: expect.any(String),
      userEventId: expect.any(String),
      assistantEventId: expect.any(String),
    }));
    expect(calls[0]?.requestId).toEqual(expect.any(String));
    expect(calls[0]?.onRequestTransition).toEqual(expect.any(Function));
    expect(preprocessor).not.toHaveBeenCalled();
  });

  it("still sends unsupported notice for video/audio/sticker messages", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    const { executeTurn, calls } = answerTurn();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn });
    const update = makeUpdate({
      rawUpdate: {
        update_id: updateId,
        message: {
          message_id: 55,
          from: { id: telegramUserId, is_bot: false, first_name: "Test" },
          chat: { id: telegramChatId, type: "private" },
          date: Math.floor(Date.now() / 1000),
          video: { file_id: "vid-1", file_unique_id: "unq", width: 100, height: 100, duration: 10 },
        },
      },
    });

    const result = await processUpdate(config, update);

    expect(result.status).toBe("completed");
    expect(botApi.sendMessage).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });

  it("still handles /start and /help normally", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi });
    const update = makeUpdate({ rawUpdate: textUpdate("/help") });

    const result = await processUpdate(config, update);

    expect(result.status).toBe("completed");
    expect(botApi.sendMessage).toHaveBeenCalledTimes(1);
  });
});

// ── Attachment lifecycle (typing/heartbeat before preprocessor) ──────────────

describe("processUpdate: attachment lifecycle ordering", () => {
  it("starts typing action before running the attachment preprocessor", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    let preprocessorStarted = false;
    let preprocessorResolve!: (value: AttachmentPreprocessResult) => void;
    const preprocessor = vi.fn<AttachmentPreprocessor>().mockImplementation(
      () => new Promise<AttachmentPreprocessResult>((resolve) => {
        preprocessorStarted = true;
        preprocessorResolve = resolve;
      }),
    );
    const { executeTurn } = answerTurn();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn, attachmentPreprocessor: preprocessor, heartbeatIntervalMs: 100 });
    const update = makeUpdate({ rawUpdate: docUpdate("test.pdf", "application/pdf", 100) });

    const resultPromise = processUpdate(config, update);
    // Wait a microtick for async flow to start
    await vi.waitFor(() => expect(preprocessorStarted).toBe(true), { timeout: 1000 });

    // typing should have been called before preprocessor resolved
    expect(botApi.sendChatAction).toHaveBeenCalled();

    // resolve preprocessor so the turn can complete
    preprocessorResolve({
      upstreamQuery: "Frage\n\n--- context ---",
      metadata: fakeAttachmentMeta,
    });
    const result = await resultPromise;

    expect(result.status).toBe("completed");
  });

  it("runs a heartbeat before the attachment preprocessor begins", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    let preprocessorStarted = false;
    let preprocessorResolve!: (value: AttachmentPreprocessResult) => void;
    const preprocessor = vi.fn<AttachmentPreprocessor>().mockImplementation(
      () => new Promise<AttachmentPreprocessResult>((resolve) => {
        preprocessorStarted = true;
        preprocessorResolve = resolve;
      }),
    );
    const { executeTurn } = answerTurn();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn, attachmentPreprocessor: preprocessor, heartbeatIntervalMs: 100 });
    const update = makeUpdate({ rawUpdate: docUpdate("test.pdf", "application/pdf", 100) });

    const resultPromise = processUpdate(config, update);
    await vi.waitFor(() => expect(preprocessorStarted).toBe(true), { timeout: 1000 });

    // heartbeat should have been called before preprocessor resolved
    expect(rpc.heartbeat).toHaveBeenCalled();

    preprocessorResolve({
      upstreamQuery: "Frage\n\n--- context ---",
      metadata: fakeAttachmentMeta,
    });
    await resultPromise;
  });

  it("shares cancellation state through Fred generation and stops all lifecycle work", async () => {
    vi.useFakeTimers();
    const rpc = fakeRpc({
      checkCancelled: vi.fn()
        .mockResolvedValueOnce({ data: false, error: null })
        .mockResolvedValueOnce({ data: true, error: null }),
    });
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    const preprocessor = fakePreprocessor({ upstreamQuery: "Frage\n\n--- context ---", metadata: fakeAttachmentMeta });
    let fredSignal: AbortSignal | undefined;
    const { executeTurn } = capturingTurn(async function* (request) {
      fredSignal = request.signal;
      await new Promise<void>((resolve) => {
        if (request.signal?.aborted) resolve();
        else request.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      return { answer: "Darf nicht zugestellt werden", rawAnswer: "Darf nicht zugestellt werden", conversation: fakeConversation, researchTrace: [], sourceReferences: [], stopped: false };
    });
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn, attachmentPreprocessor: preprocessor, heartbeatIntervalMs: 50 });

    const resultPromise = processUpdate(config, makeUpdate({ rawUpdate: docUpdate() }));
    await vi.waitFor(() => expect(fredSignal).toBeDefined());
    await vi.advanceTimersByTimeAsync(50);
    const result = await resultPromise;

    expect(fredSignal?.aborted).toBe(true);
    expect(result.status).toBe("cancelled");
    expect(rpc.cancel).toHaveBeenCalledTimes(1);
    expect(rpc.complete).not.toHaveBeenCalled();
    expect(rpc.retry).not.toHaveBeenCalled();
    expect(botApi.sendMessage).not.toHaveBeenCalled();
    const heartbeatCalls = vi.mocked(rpc.heartbeat).mock.calls.length;
    const typingCalls = vi.mocked(botApi.sendChatAction).mock.calls.length;
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(rpc.heartbeat).toHaveBeenCalledTimes(heartbeatCalls);
    expect(botApi.sendChatAction).toHaveBeenCalledTimes(typingCalls);
  });

  it("shares shutdown state through Fred generation, requeues, and stops all lifecycle work", async () => {
    vi.useFakeTimers();
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    const preprocessor = fakePreprocessor({ upstreamQuery: "Frage\n\n--- context ---", metadata: fakeAttachmentMeta });
    const shutdownController = new AbortController();
    const removeListener = vi.spyOn(shutdownController.signal, "removeEventListener");
    let fredSignal: AbortSignal | undefined;
    const { executeTurn } = capturingTurn(async function* (request) {
      fredSignal = request.signal;
      await new Promise<void>((resolve) => {
        if (request.signal?.aborted) resolve();
        else request.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      return { answer: "Darf nicht zugestellt werden", rawAnswer: "Darf nicht zugestellt werden", conversation: fakeConversation, researchTrace: [], sourceReferences: [], stopped: false };
    });
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn, attachmentPreprocessor: preprocessor, heartbeatIntervalMs: 50 });

    const resultPromise = processUpdate(config, makeUpdate({ rawUpdate: docUpdate() }), { shutdownSignal: shutdownController.signal });
    await vi.waitFor(() => expect(fredSignal).toBeDefined());
    shutdownController.abort();
    const result = await resultPromise;

    expect(fredSignal?.aborted).toBe(true);
    expect(result.status).toBe("retry");
    expect(rpc.retry).toHaveBeenCalledWith(expect.objectContaining({ p_last_error_code: "WORKER_SHUTDOWN", p_retry_delay_seconds: 0 }));
    expect(rpc.complete).not.toHaveBeenCalled();
    expect(botApi.sendMessage).not.toHaveBeenCalled();
    expect(removeListener).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans attachment timers after successful delivery", async () => {
    vi.useFakeTimers();
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    const preprocessor = fakePreprocessor({ upstreamQuery: "Frage\n\n--- context ---", metadata: fakeAttachmentMeta });
    const { executeTurn } = answerTurn("Einmalige Antwort");
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn, attachmentPreprocessor: preprocessor, heartbeatIntervalMs: 50 });

    const result = await processUpdate(config, makeUpdate({ rawUpdate: docUpdate() }));
    const heartbeatCalls = vi.mocked(rpc.heartbeat).mock.calls.length;
    const typingCalls = vi.mocked(botApi.sendChatAction).mock.calls.length;

    expect(result.status).toBe("completed");
    expect(botApi.sendMessage).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(rpc.heartbeat).toHaveBeenCalledTimes(heartbeatCalls);
    expect(botApi.sendChatAction).toHaveBeenCalledTimes(typingCalls);
  });

  it("cleans attachment timers and shutdown listener when Fred throws before retrying", async () => {
    vi.useFakeTimers();
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    const preprocessor = fakePreprocessor({ upstreamQuery: "Frage\n\n--- context ---", metadata: fakeAttachmentMeta });
    const shutdownController = new AbortController();
    const removeListener = vi.spyOn(shutdownController.signal, "removeEventListener");
    const { executeTurn } = erroringTurn("Fred kaputt");
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn, attachmentPreprocessor: preprocessor, heartbeatIntervalMs: 50 });

    const result = await processUpdate(config, makeUpdate({ rawUpdate: docUpdate() }), { shutdownSignal: shutdownController.signal });

    expect(result.status).toBe("failed");
    expect(rpc.retry).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

// ── /stop cancellation during preprocessing ─────────────────────────────────

describe("processUpdate: /stop cancels preprocessing", () => {
  it("aborts the preprocessor signal when /stop cancellation is detected during preprocessing, cancels update without error message or Fred call", async () => {
    vi.useFakeTimers();
    const rpc = fakeRpc({
      // First heartbeat returns ok, then cancellation is detected
      heartbeat: vi.fn()
        .mockResolvedValueOnce({ data: true, error: null })
        .mockResolvedValueOnce({ data: true, error: null }),
      checkCancelled: vi.fn()
        .mockResolvedValueOnce({ data: false, error: null })
        .mockResolvedValueOnce({ data: true, error: null }),
    });
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    let capturedSignal: AbortSignal | undefined;
    let preprocessorResolve!: (value: AttachmentPreprocessResult) => void;
    const preprocessor = vi.fn<AttachmentPreprocessor>().mockImplementation(
      (_botApi, _fileId, _fileName, _mimeType, _fileSize, _caption, signal) => {
        capturedSignal = signal;
        return new Promise<AttachmentPreprocessResult>((resolve) => {
          preprocessorResolve = resolve;
        });
      },
    );
    const { executeTurn, calls } = answerTurn();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn, attachmentPreprocessor: preprocessor, heartbeatIntervalMs: 50 });
    const update = makeUpdate({ rawUpdate: docUpdate("test.pdf", "application/pdf", 100) });

    const resultPromise = processUpdate(config, update);
    // Let typing + first heartbeat run
    await vi.advanceTimersByTimeAsync(60);
    // Now advance to second heartbeat which detects cancellation
    await vi.advanceTimersByTimeAsync(60);

    // The controller should have been aborted, which aborts the signal
    expect(capturedSignal?.aborted).toBe(true);

    // Resolve preprocessor (it was already aborted though, so this may not matter)
    preprocessorResolve({
      upstreamQuery: "Frage\n\n--- context ---",
      metadata: fakeAttachmentMeta,
    });
    const result = await resultPromise;

    expect(result.status).toBe("cancelled");
    expect(calls).toHaveLength(0);
    expect(botApi.sendMessage).not.toHaveBeenCalled();
    expect(rpc.cancel).toHaveBeenCalledWith(expect.objectContaining({ p_update_id: updateRowId }));
    vi.useRealTimers();
  });
});

// ── Shutdown during preprocessing ───────────────────────────────────────────

describe("processUpdate: shutdown during preprocessing", () => {
  it("aborts preprocessing and requeues when shutdown signal fires during preprocessing", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    let capturedSignal: AbortSignal | undefined;
    let preprocessorResolve!: (value: AttachmentPreprocessResult) => void;
    const preprocessor = vi.fn<AttachmentPreprocessor>().mockImplementation(
      (_botApi, _fileId, _fileName, _mimeType, _fileSize, _caption, signal) => {
        capturedSignal = signal;
        return new Promise<AttachmentPreprocessResult>((resolve) => {
          preprocessorResolve = resolve;
        });
      },
    );
    const { executeTurn, calls } = answerTurn();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn, attachmentPreprocessor: preprocessor });
    const update = makeUpdate({ rawUpdate: docUpdate("test.pdf", "application/pdf", 100) });
    const shutdownController = new AbortController();

    const resultPromise = processUpdate(config, update, { shutdownSignal: shutdownController.signal });
    // Wait a tick for preprocessor to be called
    await vi.waitFor(() => expect(capturedSignal).toBeDefined(), { timeout: 1000 });

    // Fire shutdown
    shutdownController.abort();

    // Preprocessor signal should be aborted
    expect(capturedSignal?.aborted).toBe(true);

    // Resolve preprocessor
    preprocessorResolve({
      upstreamQuery: "Frage\n\n--- context ---",
      metadata: fakeAttachmentMeta,
    });
    const result = await resultPromise;

    expect(result.status).toBe("retry");
    expect(calls).toHaveLength(0);
    expect(rpc.retry).toHaveBeenCalled();
    expect(rpc.complete).not.toHaveBeenCalled();
  });
});

// ── Provider signal contract ─────────────────────────────────────────────────

describe("processUpdate: provider signal contract", () => {
  it("passes the per-turn AbortSignal to the preprocessor, not the shutdown signal", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    let capturedSignal: AbortSignal | undefined;
    const preprocessor = vi.fn<AttachmentPreprocessor>().mockImplementation(
      (_botApi, _fileId, _fileName, _mimeType, _fileSize, _caption, signal) => {
        capturedSignal = signal;
        return Promise.resolve({
          upstreamQuery: "Frage\n\n--- context ---",
          metadata: fakeAttachmentMeta,
        });
      },
    );
    const { executeTurn } = answerTurn();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn, attachmentPreprocessor: preprocessor });
    const update = makeUpdate({ rawUpdate: docUpdate("test.pdf", "application/pdf", 100) });
    const shutdownController = new AbortController();

    await processUpdate(config, update, { shutdownSignal: shutdownController.signal });

    // The signal passed to the preprocessor should be the per-turn controller's signal,
    // not the shutdown signal
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal).not.toBe(shutdownController.signal);
    // The per-turn signal should not be aborted yet (it should only abort on shutdown, cancellation, etc.)
    expect(capturedSignal?.aborted).toBe(false);
  });
});

// ── Message-level file_size preflight ─────────────────────────────────────────

describe("processUpdate: message file_size oversize", () => {
  it("rejects a document with file_size > 20 MiB before any getFile call, sends one user-visible message, and completes without retry", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    const preprocessor = vi.fn<AttachmentPreprocessor>();
    const { executeTurn, calls } = answerTurn();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn, attachmentPreprocessor: preprocessor });
    const oversizedBytes = 21 * 1024 * 1024; // 21 MiB
    const update = makeUpdate({ rawUpdate: docUpdate("big.pdf", "application/pdf", oversizedBytes, "Frage") });

    const result = await processUpdate(config, update);

    expect(result.status).toBe("completed");
    // Zero getFile calls
    expect(botApi.getFile).not.toHaveBeenCalled();
    // Zero download calls
    expect(botApi.downloadFile).not.toHaveBeenCalled();
    // Zero preprocessor calls
    expect(preprocessor).not.toHaveBeenCalled();
    // Zero Fred calls
    expect(calls).toHaveLength(0);
    // One user-visible message about size limit
    expect(botApi.sendMessage).toHaveBeenCalledTimes(1);
    const sentText = (botApi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].text as string;
    expect(sentText).toContain("20 MB");
    // No retry
    expect(rpc.retry).not.toHaveBeenCalled();
    // Completed (not failed)
    expect(rpc.complete).toHaveBeenCalled();
  });

  it("rejects a photo with file_size > 10 MiB before any getFile call", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    const preprocessor = vi.fn<AttachmentPreprocessor>();
    const { executeTurn, calls } = answerTurn();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn, attachmentPreprocessor: preprocessor });
    const oversizedBytes = 11 * 1024 * 1024; // 11 MiB
    const update = makeUpdate({ rawUpdate: photoUpdate([oversizedBytes], "Frage") });

    const result = await processUpdate(config, update);

    expect(result.status).toBe("completed");
    expect(botApi.getFile).not.toHaveBeenCalled();
    expect(botApi.downloadFile).not.toHaveBeenCalled();
    expect(preprocessor).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    expect(botApi.sendMessage).toHaveBeenCalledTimes(1);
    const sentText = (botApi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].text as string;
    expect(sentText).toContain("10 MB");
    expect(rpc.complete).toHaveBeenCalled();
  });
});

// ── getFile-reported file_size oversize ──────────────────────────────────────

describe("processUpdate: getFile file_size oversize", () => {
  it("rejects when getFile reports file_size above limit, makes zero download/provider/Fred calls", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    // The real preprocessor calls getFile, discovers oversize, and throws UserVisibleError.
    // This test validates the worker handles that by completing without retry.
    const preprocessor = vi.fn<AttachmentPreprocessor>().mockRejectedValue(
      new UserVisibleError("Eine Datei darf maximal 20 MB groß sein.", 413),
    );
    const { executeTurn, calls } = answerTurn();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn, attachmentPreprocessor: preprocessor });
    const update = makeUpdate({ rawUpdate: docUpdate("report.pdf", "application/pdf", 1 * 1024 * 1024, "Frage") });

    const result = await processUpdate(config, update);

    expect(result.status).toBe("completed");
    // preprocessor was called (and threw UserVisibleError after internal getFile check)
    expect(preprocessor).toHaveBeenCalledTimes(1);
    // Zero Fred calls
    expect(calls).toHaveLength(0);
    // One user-visible message
    expect(botApi.sendMessage).toHaveBeenCalledTimes(1);
    const sentText = (botApi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].text as string;
    expect(sentText).toContain("20 MB");
    expect(rpc.complete).toHaveBeenCalled();
    expect(rpc.retry).not.toHaveBeenCalled();
  });
});

// ── Streamed oversize by BotApi ─────────────────────────────────────────────

describe("processUpdate: download streamed oversize", () => {
  it("completes with one user-visible size message and does not retry when BotApi reports oversize during download", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const botApi = fakeBotApi();
    // The real preprocessor catches SanitizedTelegramError with "größer"
    // and rethrows as UserVisibleError. This test validates the worker
    // handles that UserVisibleError by completing without retry.
    const preprocessor = vi.fn<AttachmentPreprocessor>().mockRejectedValue(
      new UserVisibleError("Eine Datei darf maximal 20 MB groß sein.", 413),
    );
    const { executeTurn, calls } = answerTurn();
    const config = fakeConfig({ rpc, storage, createBotApiForToken: () => botApi, executeTurn, attachmentPreprocessor: preprocessor });
    const update = makeUpdate({ rawUpdate: docUpdate("test.pdf", "application/pdf", 50, "Frage") });

    const result = await processUpdate(config, update);

    expect(result.status).toBe("completed");
    expect(calls).toHaveLength(0);
    expect(botApi.sendMessage).toHaveBeenCalledTimes(1);
    const sentText = (botApi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].text as string;
    expect(sentText).toContain("20 MB");
    expect(rpc.retry).not.toHaveBeenCalled();
    expect(rpc.complete).toHaveBeenCalled();
  });
});


describe("worker capacity and generation deadlines", () => {
  function row(chat: number, command = "/status") {
    return {
      id: chat, update_id: chat, integration_id: `int-${chat}`,
      raw_update: { update_id: chat, message: { message_id: chat,
        from: { id: telegramUserId, is_bot: false, first_name: "Test" },
        chat: { id: chat, type: "private" }, date: 1, text: command } },
      telegram_chat_id: chat, status: "processing", lease_id: `lease-${chat}`,
      lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      attempt_count: 1, max_attempts: 5, available_at: new Date().toISOString(),
      cancel_requested: false, update_kind: "command",
    };
  }

  it("refills a free slot and handles /stop while another job is still blocked", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const control = new AbortController();
    const claimed = vi.fn().mockResolvedValueOnce({ data: [row(1), row(2)], error: null })
      .mockResolvedValueOnce({ data: [row(3)], error: null })
      .mockResolvedValue({ data: [], error: null });
    const controls = vi.fn().mockResolvedValue({ data: [], error: null });
    const rpc = fakeRpc({ claimPending: claimed, claimControls: controls });
    const bot = fakeBotApi();
    vi.mocked(bot.sendMessage).mockImplementation(async (params) => {
      if ((params.chat_id === 1 || params.chat_id === 3) && params.text.includes("verbunden")) await blocked;
      return { message_id: 1, date: 1, chat: { id: Number(params.chat_id), type: "private" } };
    });
    const storage = fakeStorage({ loadIntegration: vi.fn(async (id: string) =>
      makeIntegration({ id, pairedTelegramChatId: Number(id.slice(4)) })) });
    const loop = runWorkerLoop({ config: fakeConfig({ rpc, storage, createBotApiForToken: () => bot }), signal: control.signal });
    try {
      await vi.waitFor(() => expect(bot.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ chat_id: 3 })));
      expect(claimed.mock.calls[1][0].p_limit).toBe(1);
      expect(rpc.complete).not.toHaveBeenCalledWith(expect.objectContaining({ p_update_id: 1 }));
      controls.mockResolvedValueOnce({ data: [{ ...row(1, "/stop"), id: 4, update_id: 4 }], error: null });
      await vi.waitFor(() => expect(rpc.requestCancelForChat).toHaveBeenCalled());
      expect(rpc.complete).not.toHaveBeenCalledWith(expect.objectContaining({ p_update_id: 1 }));
    } finally {
      control.abort();
      release();
      await loop;
    }
  });

  it("times out a real stalled upstream stream, stops it and retries instead of recording user cancellation", async () => {
    vi.useFakeTimers();
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const cancelStream = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"response_type":"agent_query","assistant_message_id":"hung-answer"}\n\n'));
      }, cancel: cancelStream,
    });
    const upstream: TurnServiceUpstreamDeps = {
      mintSession: vi.fn().mockResolvedValue({ token: "test", expiresIn: 1800 }),
      fetchUpstreamConfig: vi.fn().mockResolvedValue({ agentId: "agent", knowledgeBaseIds: [], allowWebSearch: false }),
      createSession: vi.fn().mockResolvedValue({ id: "session", signature: "signature" }),
      deriveSessionSignature: vi.fn().mockReturnValue("signature"),
      visitorId: vi.fn().mockReturnValue("visitor"),
      openStream: vi.fn().mockResolvedValue(stream),
      relayEvent: vi.fn().mockResolvedValue(undefined), stopSession: vi.fn().mockResolvedValue(undefined),
    };
    const persistence: TurnServicePersistenceDeps = {
      loadConversation: vi.fn().mockResolvedValue(null),
      recordEvent: vi.fn().mockResolvedValue({ conversation: fakeConversation, messageId: 1 }),
    };
    const turnConfig: TurnServiceConfigDeps = {
      readFredConfig: () => ({ channelId: "channel", publishToken: "test", exchangeOrigin: "https://findog.at" }),
      readQuickFredConfig: () => null, readProModelId: () => "model",
    };
    const config = fakeConfig({ rpc, storage, executeTurn: executeFredTurn,
      turnUpstream: upstream, turnPersistence: persistence, turnConfig,
      generationIdleTimeoutMs: 100, generationTimeoutMs: 1_000 });
    const pending = processUpdate(config, makeUpdate({ attemptCount: 1 }));
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(upstream.stopSession).toHaveBeenCalledWith(expect.objectContaining({ messageId: "hung-answer" }));
    expect(cancelStream).toHaveBeenCalledOnce();
    expect(rpc.retry).toHaveBeenCalledWith(expect.objectContaining({ p_last_error_code: "GENERATION_IDLE_TIMEOUT" }));
    expect(rpc.cancel).not.toHaveBeenCalled();
    expect(persistence.recordEvent).not.toHaveBeenCalledWith(expect.objectContaining({ eventType: "message_received" }));
    expect(vi.getTimerCount()).toBe(0);
  });
});


it("reconciles an answer committed during timeout on the final attempt", async () => {
  vi.useFakeTimers();
  const rpc = fakeRpc();
  const bot = fakeBotApi();
  const storage = fakeStorage({ transitionRequestReceiptIfPresent: vi.fn().mockResolvedValue({
    leaseValid: true, receiptPresent: true, status: "completed", contentDeleted: false,
    answer: "Bereits gespeicherte Antwort.", webSearchEnabled: false, proModeEnabled: false,
  }) });
  const { executeTurn } = capturingTurn(async function* (request) {
    await new Promise<void>((resolve) => request.signal!.addEventListener("abort", () => resolve(), { once: true }));
    return { answer: "", rawAnswer: "", stopped: true, conversation: fakeConversation, researchTrace: [], sourceReferences: [] };
  });
  const pending = processUpdate(fakeConfig({ rpc, storage, executeTurn,
    createBotApiForToken: () => bot, generationIdleTimeoutMs: 100 }), makeUpdate({ attemptCount: 5 }));
  await vi.advanceTimersByTimeAsync(100);
  const result = await pending;
  expect(result.status).toBe("completed");
  expect(rpc.fail).not.toHaveBeenCalled();
  expect(rpc.cancel).not.toHaveBeenCalled();
  expect(bot.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: "Bereits gespeicherte Antwort." }), expect.any(Object));
  expect(vi.getTimerCount()).toBe(0);
});
