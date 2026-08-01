import { randomBytes, randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type {
  GetTelegramIntegrationResult,
} from "./settings";
import {
  deleteTelegramIntegration,
  getTelegramIntegration,
  registerTelegramIntegration,
  rotatePairingToken,
} from "./settings";
import type { BotApi } from "./bot-api";
import { encryptTelegramToken } from "./credentials";

vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

const CLIENT_ID = "b0000000-0000-0000-0000-000000000001";
const TOKEN = "1234567890:AAECDefghIJKLMNOPQRSTUVWXYZabcdefg";
const ENV_KEY = randomBytes(32).toString("base64");

afterEach(() => {
  delete process.env.TELEGRAM_CREDENTIALS_KEY;
  delete process.env.TELEGRAM_PUBLIC_ORIGIN;
});

function makeEncryptedToken(integrationId: string, botUserId: number): string {
  process.env.TELEGRAM_CREDENTIALS_KEY = ENV_KEY;
  return encryptTelegramToken("test-bot-token-for-encryption", {
    integrationId,
    clientId: CLIENT_ID,
    botUserId,
  });
}

function mockSelectMaybeSingle(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const neq = vi.fn().mockReturnValue({ maybeSingle });
  const eq = vi.fn().mockReturnValue({ neq, maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  return { select, eq, neq, maybeSingle };
}

function mockBotApi(overrides: Partial<BotApi> = {}): BotApi {
  return {
    getMe: vi.fn().mockResolvedValue({ id: 123456789, is_bot: true, first_name: "TestBot", username: "test_bot" }),
    getWebhookInfo: vi.fn().mockResolvedValue({ url: "", has_custom_certificate: false, pending_update_count: 0 }),
    setWebhook: vi.fn().mockResolvedValue(true),
    deleteWebhook: vi.fn().mockResolvedValue(true),
    setMyCommands: vi.fn().mockResolvedValue(true),
    deleteMyCommands: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1, date: 1, chat: { id: 1, type: "private" } }),
    sendRichMessage: vi.fn().mockResolvedValue({ message_id: 1, date: 1, chat: { id: 1, type: "private" } }),
    sendMessageDraft: vi.fn().mockResolvedValue({ message_id: 1, date: 1, chat: { id: 1, type: "private" } }),
    sendChatAction: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("getTelegramIntegration", () => {
  beforeEach(() => { process.env.TELEGRAM_CREDENTIALS_KEY = ENV_KEY; });

  it("returns null when no integration exists", async () => {
    const ms = mockSelectMaybeSingle({ data: null, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn().mockReturnValue(ms) } as never);
    expect(await getTelegramIntegration(CLIENT_ID)).toBeNull();
  });

  it("returns status/bot data but never token/ciphertext/secret/hash", async () => {
    const ms = mockSelectMaybeSingle({ data: { id: randomUUID(), client_id: CLIENT_ID, bot_user_id: 123456789, bot_username: "test_bot", status: "awaiting_pairing", pairing_expires_at: null, paired_telegram_user_id: null, paired_telegram_chat_id: null, last_error_code: null, last_error_description: null, last_error_at: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", encrypted_token: "v1.abc.def.ghi", webhook_id: randomUUID(), webhook_secret_sha256: "a".repeat(64), pairing_token_sha256: null }, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn().mockReturnValue(ms) } as never);
    const r = (await getTelegramIntegration(CLIENT_ID)) as GetTelegramIntegrationResult;
    expect(r.status).toBe("awaiting_pairing");
    expect(r.botUsername).toBe("test_bot");
    expect(r.hasActivePairing).toBe(false);
    expect(r.hasPairedChat).toBe(false);
    expect((r as unknown as Record<string, unknown>).encrypted_token).toBeUndefined();
    expect((r as unknown as Record<string, unknown>).encryptedToken).toBeUndefined();
    expect((r as unknown as Record<string, unknown>).webhook_secret_sha256).toBeUndefined();
    expect((r as unknown as Record<string, unknown>).webhookSecret).toBeUndefined();
  });

  it("returns hasActivePairing true when pairing token is pending", async () => {
    const future = new Date(Date.now() + 300000).toISOString();
    const ms = mockSelectMaybeSingle({ data: { id: randomUUID(), client_id: CLIENT_ID, bot_user_id: 123456789, bot_username: "test_bot", status: "awaiting_pairing", pairing_expires_at: future, paired_telegram_user_id: null, paired_telegram_chat_id: null, last_error_code: null, last_error_description: null, last_error_at: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn().mockReturnValue(ms) } as never);
    expect((await getTelegramIntegration(CLIENT_ID) as GetTelegramIntegrationResult).hasActivePairing).toBe(true);
  });

  it("returns hasPairedChat true when pairing is complete", async () => {
    const ms = mockSelectMaybeSingle({ data: { id: randomUUID(), client_id: CLIENT_ID, bot_user_id: 123456789, bot_username: "test_bot", status: "active", pairing_expires_at: null, paired_telegram_user_id: 456, paired_telegram_chat_id: 789, last_error_code: null, last_error_description: null, last_error_at: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn().mockReturnValue(ms) } as never);
    const r = (await getTelegramIntegration(CLIENT_ID)) as GetTelegramIntegrationResult;
    expect(r.hasPairedChat).toBe(true);
    expect(r.status).toBe("active");
  });
});

describe("registerTelegramIntegration", () => {
  beforeEach(() => { process.env.TELEGRAM_CREDENTIALS_KEY = ENV_KEY; process.env.TELEGRAM_PUBLIC_ORIGIN = "https://findog.at"; });

  it("validates the token through getMe before persisting", async () => {
    const ms = mockSelectMaybeSingle({ data: null, error: null });
    const mockInsert = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn().mockReturnValue({ ...ms, insert: mockInsert }) } as never);
    const botApi = mockBotApi();
    const result = await registerTelegramIntegration(CLIENT_ID, TOKEN, botApi);
    expect(botApi.getMe).toHaveBeenCalled();
    expect(result.status).toBe("awaiting_pairing");
    expect(result.deepLink).toContain("https://t.me/test_bot?start=");
  });

  it("rejects when getMe fails", async () => {
    const ms = mockSelectMaybeSingle({ data: null, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn().mockReturnValue(ms) } as never);
    const botApi = mockBotApi({ getMe: vi.fn().mockRejectedValue(new Error("Not Found")) });
    await expect(registerTelegramIntegration(CLIENT_ID, TOKEN, botApi)).rejects.toThrow("ungültig");
  });

  it("enforces one bot per unique bot_user_id", async () => {
    let callCount = 0;
    const from = vi.fn().mockImplementation(() => {
      callCount++;
      return mockSelectMaybeSingle(callCount === 1 ? { data: null, error: null } : { data: { id: randomUUID(), client_id: "other-client" }, error: null });
    });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never);
    await expect(registerTelegramIntegration(CLIENT_ID, TOKEN, mockBotApi())).rejects.toThrow("bereits");
  });

  it("detects foreign webhook and returns conflict unless replaceExistingWebhook is true", async () => {
    const ms = mockSelectMaybeSingle({ data: null, error: null });
    const mockInsert = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn().mockReturnValue({ ...ms, insert: mockInsert }) } as never);
    const botApi = mockBotApi({ getWebhookInfo: vi.fn().mockResolvedValue({ url: "https://other.example.com/webhook", has_custom_certificate: false, pending_update_count: 0 }) });
    const result = await registerTelegramIntegration(CLIENT_ID, TOKEN, botApi);
    expect(result.conflict).toBe("foreign_webhook");
    const resultReplace = await registerTelegramIntegration(CLIENT_ID, TOKEN, botApi, { replaceExistingWebhook: true });
    expect(resultReplace.conflict).toBeUndefined();
    expect(botApi.setWebhook).toHaveBeenCalled();
  });

  it("inserts DB row before setting webhook and preserves row on Telegram registration failure", async () => {
    let dbInserted = false;
    const ms = mockSelectMaybeSingle({ data: null, error: null });
    const mockInsert = vi.fn().mockImplementation(() => {
      dbInserted = true;
      return Promise.resolve({ error: null });
    });

    // Simulate: setWebhook fails (Telegram unreachable after DB insert)
    const botApi = mockBotApi({
      setWebhook: vi.fn().mockImplementation(() => {
        if (!dbInserted) throw new Error("setWebhook called before DB insert");
        return Promise.reject(new Error("Telegram network error"));
      }),
    });

    const eqOk = vi.fn().mockResolvedValue({ error: null });
    const mockUpdate = vi.fn().mockReturnValue({ eq: eqOk });
    const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ ...ms, insert: mockInsert, update: mockUpdate }),
      rpc: mockRpc,
    } as never);

    // Should throw because registration failed
    await expect(
      registerTelegramIntegration(CLIENT_ID, TOKEN, botApi),
    ).rejects.toThrow("Registrierung fehlgeschlagen");

    // DB row must have been inserted before setWebhook was called
    expect(dbInserted).toBe(true);

    // Must NOT have deleted the row — update should preserve it as error
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
      }),
    );
  });

  it("calls setCommands before setWebhook and DB insert before both", async () => {
    const callOrder: string[] = [];
    const ms = mockSelectMaybeSingle({ data: null, error: null });
    const mockInsert = vi.fn().mockImplementation(() => {
      callOrder.push("db-insert");
      return Promise.resolve({ error: null });
    });

    const botApi = mockBotApi({
      setMyCommands: vi.fn().mockImplementation(() => {
        callOrder.push("commands");
        return Promise.resolve(true);
      }),
      setWebhook: vi.fn().mockImplementation(() => {
        callOrder.push("webhook");
        return Promise.resolve(true);
      }),
    });

    const eqOk = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ ...ms, insert: mockInsert, update: vi.fn().mockReturnValue({ eq: eqOk }) }),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as never);

    await registerTelegramIntegration(CLIENT_ID, TOKEN, botApi);

    // Order must be: db-insert first, then commands, then webhook last
    expect(callOrder).toEqual(["db-insert", "commands", "webhook"]);
  });

});

describe("rotatePairingToken", () => {
  beforeEach(() => { process.env.TELEGRAM_CREDENTIALS_KEY = ENV_KEY; });

  it("throws if no integration exists", async () => {
    const ms = mockSelectMaybeSingle({ data: null, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn().mockReturnValue(ms) } as never);
    await expect(rotatePairingToken(CLIENT_ID)).rejects.toThrow("Integration");
  });

  it("throws if integration is not in awaiting_pairing status", async () => {
    const ms = mockSelectMaybeSingle({ data: { id: randomUUID(), client_id: CLIENT_ID, bot_user_id: 123456789, bot_username: "test_bot", status: "active" }, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn().mockReturnValue(ms) } as never);
    await expect(rotatePairingToken(CLIENT_ID)).rejects.toThrow("Pairing");
  });

  it("creates a fresh one-time token and returns deep link", async () => {
    const integrationId = randomUUID();
    const ms = mockSelectMaybeSingle({ data: { id: integrationId, client_id: CLIENT_ID, bot_user_id: 123456789, bot_username: "test_bot", status: "awaiting_pairing" }, error: null });
    const mockEq = vi.fn().mockResolvedValue({ error: null });
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn().mockReturnValue({ ...ms, update: mockUpdate }) } as never);
    const result = await rotatePairingToken(CLIENT_ID);
    expect(result.deepLink).toContain("https://t.me/test_bot?start=");
    expect(result.deepLink).not.toContain(integrationId);
  });
});

describe("deleteTelegramIntegration", () => {
  beforeEach(() => { process.env.TELEGRAM_CREDENTIALS_KEY = ENV_KEY; });

  it("throws if no integration exists", async () => {
    const ms = mockSelectMaybeSingle({ data: null, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn().mockReturnValue(ms) } as never);
    await expect(deleteTelegramIntegration(CLIENT_ID)).rejects.toThrow("Integration");
  });

  it("marks disconnecting, calls deleteWebhook and deleteMyCommands, then deletes", async () => {
    const integrationId = randomUUID();
    const botUserId = 123456789;
    const encryptedToken = makeEncryptedToken(integrationId, botUserId);
    const ms = mockSelectMaybeSingle({ data: { id: integrationId, client_id: CLIENT_ID, bot_user_id: botUserId, encrypted_token: encryptedToken, webhook_id: randomUUID(), status: "active" }, error: null });
    const order: string[] = [];
    const eqOk = vi.fn().mockResolvedValue({ error: null });
    const mockUpdate = vi.fn().mockImplementation(() => {
      order.push("mark-disconnecting");
      return { eq: eqOk };
    });
    const mockDelete = vi.fn().mockImplementation(() => {
      order.push("delete-integration");
      return { eq: eqOk };
    });
    const mockRpc = vi.fn().mockImplementation(async () => {
      order.push("cancel-jobs");
      return { data: 5, error: null };
    });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn().mockReturnValue({ ...ms, update: mockUpdate, delete: mockDelete }), rpc: mockRpc } as never);
    const botApi = mockBotApi({
      deleteWebhook: vi.fn().mockImplementation(async () => {
        order.push("delete-webhook");
        return true;
      }),
      deleteMyCommands: vi.fn().mockImplementation(async () => {
        order.push("delete-commands");
        return true;
      }),
    });
    const result = await deleteTelegramIntegration(CLIENT_ID, botApi);
    expect(result.deleted).toBe(true);
    expect(botApi.deleteWebhook).toHaveBeenCalledWith(true);
    expect(botApi.deleteMyCommands).toHaveBeenCalled();
    expect(order).toEqual([
      "mark-disconnecting",
      "cancel-jobs",
      "delete-webhook",
      "delete-commands",
      "delete-integration",
    ]);
  });

  it("preserves the integration when queue cancellation fails", async () => {
    const integrationId = randomUUID();
    const botUserId = 123456789;
    const encryptedToken = makeEncryptedToken(integrationId, botUserId);
    const ms = mockSelectMaybeSingle({ data: { id: integrationId, client_id: CLIENT_ID, bot_user_id: botUserId, encrypted_token: encryptedToken, status: "active" }, error: null });
    const eqOk = vi.fn().mockResolvedValue({ error: null });
    const mockDelete = vi.fn().mockReturnValue({ eq: eqOk });
    vi.mocked(getSupabaseServerClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ ...ms, update: vi.fn().mockReturnValue({ eq: eqOk }), delete: mockDelete }),
      rpc: vi.fn().mockResolvedValue({ data: null, error: new Error("private db error") }),
    } as never);
    const botApi = mockBotApi();

    const result = await deleteTelegramIntegration(CLIENT_ID, botApi);

    expect(result.deleted).toBe(false);
    expect(botApi.deleteWebhook).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("preserves the integration when command removal fails", async () => {
    const integrationId = randomUUID();
    const botUserId = 123456789;
    const encryptedToken = makeEncryptedToken(integrationId, botUserId);
    const ms = mockSelectMaybeSingle({ data: { id: integrationId, client_id: CLIENT_ID, bot_user_id: botUserId, encrypted_token: encryptedToken, status: "active" }, error: null });
    const eqOk = vi.fn().mockResolvedValue({ error: null });
    const mockDelete = vi.fn().mockReturnValue({ eq: eqOk });
    vi.mocked(getSupabaseServerClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ ...ms, update: vi.fn().mockReturnValue({ eq: eqOk }), delete: mockDelete }),
      rpc: vi.fn().mockResolvedValue({ data: 1, error: null }),
    } as never);
    const botApi = mockBotApi({ deleteMyCommands: vi.fn().mockRejectedValue(new Error("private API error")) });

    const result = await deleteTelegramIntegration(CLIENT_ID, botApi);

    expect(result.deleted).toBe(false);
    expect(botApi.deleteWebhook).toHaveBeenCalledWith(true);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("preserves encrypted token and status on Telegram failure", async () => {
    const integrationId = randomUUID();
    const botUserId = 123456789;
    const encryptedToken = makeEncryptedToken(integrationId, botUserId);
    const ms = mockSelectMaybeSingle({ data: { id: integrationId, client_id: CLIENT_ID, bot_user_id: botUserId, encrypted_token: encryptedToken, webhook_id: randomUUID(), status: "active" }, error: null });
    const eqOk = vi.fn().mockResolvedValue({ error: null });
    const mockRpc = vi.fn().mockResolvedValue({ data: 5, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn().mockReturnValue({ ...ms, update: vi.fn().mockReturnValue({ eq: eqOk }) }), rpc: mockRpc } as never);
    const botApi = mockBotApi({ deleteWebhook: vi.fn().mockRejectedValue(new Error("Telegram network error")) });
    const result = await deleteTelegramIntegration(CLIENT_ID, botApi);
    expect(result.deleted).toBe(false);
    expect(result.error).toBeDefined();
  });
});

  it("preserves encrypted integration row and returns error on decryption failure", async () => {
    const integrationId = randomUUID();
    const botUserId = 123456789;
    const encryptedToken = makeEncryptedToken(integrationId, botUserId);
    // Corrupt the encryption key so that decryptToken throws
    process.env.TELEGRAM_CREDENTIALS_KEY = randomBytes(32).toString("base64");

    const ms = mockSelectMaybeSingle({ data: { id: integrationId, client_id: CLIENT_ID, bot_user_id: botUserId, encrypted_token: encryptedToken, webhook_id: randomUUID(), status: "active" }, error: null });
    const eqOk = vi.fn().mockReturnValue(Promise.resolve({ error: null }));

    const mockUpdate = vi.fn().mockReturnValue({ eq: eqOk });
    const mockDelete = vi.fn().mockReturnValue({ eq: eqOk });
    const mockFrom = vi.fn().mockReturnValue({ ...ms, update: mockUpdate, delete: mockDelete });
    const mockRpc = vi.fn().mockResolvedValue({ data: 5, error: null });

    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: mockFrom, rpc: mockRpc } as never);

    const result = await deleteTelegramIntegration(CLIENT_ID);
    expect(result.deleted).toBe(false);
    expect(result.error).toBeDefined();

    // MUST NOT delete — the encrypted row must be preserved
    expect(mockDelete).not.toHaveBeenCalled();

    // MUST update status to error with sanitized metadata
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        last_error_code: expect.any(Number) as number,
      }),
    );
  });

describe("replaceTelegramBot", () => {
  beforeEach(() => {
    process.env.TELEGRAM_CREDENTIALS_KEY = ENV_KEY;
    process.env.TELEGRAM_PUBLIC_ORIGIN = "https://findog.at";
  });

  function mockIntegrationRow(overrides: Record<string, unknown> = {}) {
    const integrationId = randomUUID();
    const botUserId = 123456789;
    const encryptedToken = makeEncryptedToken(integrationId, botUserId);
    return {
      id: integrationId,
      client_id: CLIENT_ID,
      bot_user_id: botUserId,
      bot_username: "old_bot",
      encrypted_token: encryptedToken,
      webhook_id: randomUUID(),
      webhook_secret_sha256: "a".repeat(64),
      status: "active",
      pairing_token_sha256: null,
      pairing_expires_at: null,
      paired_telegram_user_id: 456,
      paired_telegram_chat_id: 789,
      last_error_code: null,
      last_error_description: null,
      last_error_at: null,
      ...overrides,
    };
  }

  it("rejects when no existing integration", async () => {
    const ms = mockSelectMaybeSingle({ data: null, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn().mockReturnValue(ms) } as never);
    const { replaceTelegramBot } = await import("./settings");
    await expect(replaceTelegramBot(CLIENT_ID, TOKEN, mockBotApi())).rejects.toThrow("Integration");
  });

  it("validates new token via getMe before any side effect", async () => {
    const integration = mockIntegrationRow();
    const ms = mockSelectMaybeSingle({ data: integration, error: null });

    // Second select for bot ownership check
    let callCount = 0;
    const from = vi.fn().mockImplementation((table: string) => {
      if (table === "telegram_integrations") {
        callCount++;
        if (callCount === 1) return ms;
        return mockSelectMaybeSingle({ data: null, error: null });
      }
      return ms;
    });

    const mockRpc = vi.fn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from, rpc: mockRpc } as never);
    const botApi = mockBotApi({ getMe: vi.fn().mockRejectedValue(new Error("Unauthorized")) });
    const { replaceTelegramBot } = await import("./settings");
    await expect(replaceTelegramBot(CLIENT_ID, TOKEN, botApi)).rejects.toThrow("ungültig");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects bot ownership collision (another user owns new bot)", async () => {
    const integration = mockIntegrationRow();

    let callCount = 0;
    const from = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return mockSelectMaybeSingle({ data: integration, error: null });
      }
      // bot_user_id collision
      return mockSelectMaybeSingle({ data: { id: randomUUID(), client_id: "other-client" }, error: null });
    });

    const mockRpc = vi.fn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from, rpc: mockRpc } as never);
    const botApi = mockBotApi({ getMe: vi.fn().mockResolvedValue({ id: 999888777, is_bot: true, first_name: "OtherBot", username: "other_bot" }) });

    const { replaceTelegramBot } = await import("./settings");
    await expect(replaceTelegramBot(CLIENT_ID, TOKEN, botApi)).rejects.toThrow("bereits");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("detects foreign webhook and returns conflict unless replaceExistingWebhook is true", async () => {
    const integration = mockIntegrationRow();

    let callCount = 0;
    const from = vi.fn().mockImplementation(() => {
      callCount++;
      return callCount % 2 === 1
        ? mockSelectMaybeSingle({ data: integration, error: null })
        : mockSelectMaybeSingle({ data: null, error: null });
    });

    const mockRpc = vi.fn().mockResolvedValue({ data: true, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from, rpc: mockRpc } as never);

    const botApi = mockBotApi({
      getMe: vi.fn().mockResolvedValue({ id: 111222333, is_bot: true, first_name: "NewBot", username: "new_bot" }),
      getWebhookInfo: vi.fn().mockResolvedValue({ url: "https://other.example.com/webhook", has_custom_certificate: false, pending_update_count: 0 }),
    });

    const { replaceTelegramBot } = await import("./settings");
    const result = await replaceTelegramBot(CLIENT_ID, TOKEN, botApi);
    expect(result.conflict).toBe("foreign_webhook");

    const resultReplace = await replaceTelegramBot(CLIENT_ID, TOKEN, botApi, {
      replaceExistingWebhook: true,
      oldBotApi: mockBotApi(),
    });
    expect(resultReplace.conflict).toBeUndefined();
  });

  it("configures new bot commands+webhook first, then calls RPC, then cleans up old bot", async () => {
    const integration = mockIntegrationRow();
    const oldBotUserId = integration.bot_user_id;
    const newBotId = 111222333;

    let callCount = 0;
    const from = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return mockSelectMaybeSingle({ data: integration, error: null });
      return mockSelectMaybeSingle({ data: null, error: null });
    });

    const callOrder: string[] = [];
    const mockRpc = vi.fn().mockImplementation(async () => {
      callOrder.push("rpc-swap");
      return { data: true, error: null };
    });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from, rpc: mockRpc } as never);

    const botApi = mockBotApi({
      getMe: vi.fn().mockResolvedValue({ id: newBotId, is_bot: true, first_name: "NewBot", username: "new_bot" }),
      setMyCommands: vi.fn().mockImplementation(async () => { callOrder.push("new-commands"); return true; }),
      setWebhook: vi.fn().mockImplementation(async () => { callOrder.push("new-webhook"); return true; }),
    });

    const { replaceTelegramBot } = await import("./settings");
    const oldBotApi = mockBotApi({
      deleteWebhook: vi.fn().mockImplementation(async () => { callOrder.push("old-webhook-cleanup"); return true; }),
      deleteMyCommands: vi.fn().mockImplementation(async () => { callOrder.push("old-commands-cleanup"); return true; }),
    });
    await replaceTelegramBot(CLIENT_ID, TOKEN, botApi, { oldBotApi });

    // Order: new commands, new webhook, RPC swap, then old cleanup
    expect(callOrder).toEqual(["new-commands", "new-webhook", "rpc-swap", "old-webhook-cleanup", "old-commands-cleanup"]);

    // RPC must be called with correct args
    expect(mockRpc).toHaveBeenCalledWith("swap_telegram_bot", expect.objectContaining({
      p_integration_id: integration.id,
      p_client_id: CLIENT_ID,
      p_old_bot_user_id: oldBotUserId,
      p_new_bot_user_id: newBotId,
      p_new_bot_username: "new_bot",
    }));
  });

  it("rolls back new bot webhook+commands when RPC swap fails", async () => {
    const integration = mockIntegrationRow();

    let callCount = 0;
    const from = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return mockSelectMaybeSingle({ data: integration, error: null });
      return mockSelectMaybeSingle({ data: null, error: null });
    });

    const mockRpc = vi.fn().mockResolvedValue({ data: false, error: null }); // RPC returns false (no row matched)
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from, rpc: mockRpc } as never);

    const newDeleteWebhook = vi.fn().mockResolvedValue(true);
    const newDeleteCommands = vi.fn().mockResolvedValue(true);

    const botApi = mockBotApi({
      getMe: vi.fn().mockResolvedValue({ id: 111222333, is_bot: true, first_name: "NewBot", username: "new_bot" }),
      setMyCommands: vi.fn().mockResolvedValue(true),
      setWebhook: vi.fn().mockResolvedValue(true),
      deleteWebhook: newDeleteWebhook,
      deleteMyCommands: newDeleteCommands,
    });

    const { replaceTelegramBot } = await import("./settings");
    await expect(replaceTelegramBot(CLIENT_ID, TOKEN, botApi)).rejects.toThrow("Datenbank-Aktualisierung");

    // Must clean up new bot's webhook and commands on rollback
    expect(newDeleteWebhook).toHaveBeenCalledWith(true);
    expect(newDeleteCommands).toHaveBeenCalled();
  });

  it("leaves the existing webhook intact when a same-bot DB swap fails", async () => {
    const integration = mockIntegrationRow();
    let callCount = 0;
    const from = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return mockSelectMaybeSingle({ data: integration, error: null });
      return mockSelectMaybeSingle({ data: null, error: null });
    });
    const mockRpc = vi.fn().mockResolvedValue({ data: false, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from, rpc: mockRpc } as never);

    const setWebhook = vi.fn().mockResolvedValue(true);
    const deleteWebhook = vi.fn().mockResolvedValue(true);
    const deleteMyCommands = vi.fn().mockResolvedValue(true);
    const botApi = mockBotApi({
      getMe: vi.fn().mockResolvedValue({
        id: integration.bot_user_id,
        is_bot: true,
        first_name: "SameBot",
        username: "same_bot",
      }),
      getWebhookInfo: vi.fn().mockResolvedValue({
        url: `https://findog.at/api/webhooks/telegram/${integration.webhook_id}`,
        has_custom_certificate: false,
        pending_update_count: 0,
      }),
      setWebhook,
      deleteWebhook,
      deleteMyCommands,
    });

    const { replaceTelegramBot } = await import("./settings");
    await expect(replaceTelegramBot(CLIENT_ID, TOKEN, botApi))
      .rejects.toThrow("Datenbank-Aktualisierung");

    expect(setWebhook).not.toHaveBeenCalled();
    expect(deleteWebhook).not.toHaveBeenCalled();
    expect(deleteMyCommands).not.toHaveBeenCalled();
    expect(mockRpc).toHaveBeenCalledWith("swap_telegram_bot", expect.objectContaining({
      p_new_webhook_id: integration.webhook_id,
      p_new_webhook_secret_sha256: integration.webhook_secret_sha256,
    }));
  });

  it("skips old bot cleanup when new and old bot IDs are the same (same-bot credential rotation)", async () => {
    const integration = mockIntegrationRow();
    const sameBotId = integration.bot_user_id;

    let callCount = 0;
    const from = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return mockSelectMaybeSingle({ data: integration, error: null });
      return mockSelectMaybeSingle({ data: null, error: null });
    });

    const mockRpc = vi.fn().mockResolvedValue({ data: true, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from, rpc: mockRpc } as never);

    const oldDeleteWebhook = vi.fn().mockResolvedValue(true);
    const oldDeleteCommands = vi.fn().mockResolvedValue(true);

    const botApi = mockBotApi({
      getMe: vi.fn().mockResolvedValue({ id: sameBotId, is_bot: true, first_name: "SameBot", username: "same_bot" }),
      setMyCommands: vi.fn().mockResolvedValue(true),
      setWebhook: vi.fn().mockResolvedValue(true),
      deleteWebhook: oldDeleteWebhook,
      deleteMyCommands: oldDeleteCommands,
    });

    const { replaceTelegramBot } = await import("./settings");
    const oldBotApi = mockBotApi({
      deleteWebhook: oldDeleteWebhook,
      deleteMyCommands: oldDeleteCommands,
    });
    await replaceTelegramBot(CLIENT_ID, TOKEN, botApi, { oldBotApi });

    // Must NOT call old bot cleanup when same bot
    expect(oldDeleteWebhook).not.toHaveBeenCalled();
    expect(oldDeleteCommands).not.toHaveBeenCalled();
  });

  it("records warning but keeps new integration active when old webhook cleanup fails", async () => {
    const integration = mockIntegrationRow();

    let callCount = 0;
    const from = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return mockSelectMaybeSingle({ data: integration, error: null });
      return mockSelectMaybeSingle({ data: null, error: null });
    });

    const mockRpc = vi.fn()
      .mockResolvedValueOnce({ data: true, error: null }) // swap_telegram_bot
      .mockResolvedValueOnce({ data: null, error: null }); // record_telegram_integration_warning

    vi.mocked(getSupabaseServerClient).mockReturnValue({ from, rpc: mockRpc } as never);

    const oldBotApi = mockBotApi({
      deleteWebhook: vi.fn().mockRejectedValue(new Error("Old bot unreachable")),
      deleteMyCommands: vi.fn().mockResolvedValue(true),
    });

    const botApi = mockBotApi({
      getMe: vi.fn().mockResolvedValue({ id: 111222333, is_bot: true, first_name: "NewBot", username: "new_bot" }),
      setMyCommands: vi.fn().mockResolvedValue(true),
      setWebhook: vi.fn().mockResolvedValue(true),
    });

    const { replaceTelegramBot } = await import("./settings");
    const result = await replaceTelegramBot(CLIENT_ID, TOKEN, botApi, { oldBotApi });

    // Returns success — new integration is active
    expect(result.status).toBe("awaiting_pairing");
    expect(result.deepLink).toContain("https://t.me/new_bot?start=");

    // record_telegram_integration_warning must have been called
    expect(mockRpc).toHaveBeenCalledWith("record_telegram_integration_warning", expect.objectContaining({
      p_integration_id: integration.id,
      p_warning: expect.stringContaining("Old bot webhook cleanup failed") as unknown,
    }));
  });

  it("never returns or logs old/new token secrets", async () => {
    const integration = mockIntegrationRow();

    let callCount = 0;
    const from = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return mockSelectMaybeSingle({ data: integration, error: null });
      return mockSelectMaybeSingle({ data: null, error: null });
    });

    const mockRpc = vi.fn().mockResolvedValue({ data: true, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from, rpc: mockRpc } as never);

    const oldBotApi = mockBotApi({
      deleteWebhook: vi.fn().mockResolvedValue(true),
      deleteMyCommands: vi.fn().mockResolvedValue(true),
    });

    const botApi = mockBotApi({
      getMe: vi.fn().mockResolvedValue({ id: 111222333, is_bot: true, first_name: "NewBot", username: "new_bot" }),
    });

    const { replaceTelegramBot } = await import("./settings");
    const result = await replaceTelegramBot(CLIENT_ID, TOKEN, botApi, { oldBotApi });

    // Result must never contain token, webhook secret, or pairing secret
    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toContain(TOKEN);
    expect(resultStr).not.toContain("webhook_secret");
    expect(resultStr).not.toContain("pairing_token");
    expect(resultStr).not.toContain("encrypted_token");
  });

  it("preserves first-install registration unchanged", async () => {
    // Verify registerTelegramIntegration still works for new users
    const ms = mockSelectMaybeSingle({ data: null, error: null });
    const mockInsert = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn().mockReturnValue({ ...ms, insert: mockInsert }) } as never);
    const botApi = mockBotApi();
    const result = await registerTelegramIntegration(CLIENT_ID, TOKEN, botApi);
    expect(result.status).toBe("awaiting_pairing");
    expect(result.deepLink).toContain("https://t.me/test_bot?start=");
    expect(result.conflict).toBeUndefined();
  });
});

describe("TELEGRAM_BOT_COMMANDS includes pro and web", () => {
  function makeIntegrationRow() {
    const integrationId = randomUUID();
    const botUserId = 123456789;
    const encryptedToken = makeEncryptedToken(integrationId, botUserId);
    return {
      id: integrationId,
      client_id: CLIENT_ID,
      bot_user_id: botUserId,
      bot_username: "old_bot",
      encrypted_token: encryptedToken,
      webhook_id: randomUUID(),
      webhook_secret_sha256: "a".repeat(64),
      status: "active",
      pairing_token_sha256: null,
      pairing_expires_at: null,
      paired_telegram_user_id: 456,
      paired_telegram_chat_id: 789,
      last_error_code: null,
      last_error_description: null,
      last_error_at: null,
    };
  }

  it("registerTelegramIntegration calls setMyCommands with pro and web", async () => {
    process.env.TELEGRAM_CREDENTIALS_KEY = ENV_KEY;
    process.env.TELEGRAM_PUBLIC_ORIGIN = "https://findog.at";

    const ms = mockSelectMaybeSingle({ data: null, error: null });
    const mockInsert = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ ...ms, insert: mockInsert }),
    } as never);

    const setMyCommands = vi.fn().mockResolvedValue(true);
    const botApi = mockBotApi({ setMyCommands });

    await registerTelegramIntegration(CLIENT_ID, TOKEN, botApi);

    expect(setMyCommands).toHaveBeenCalledTimes(1);
    const cmds = setMyCommands.mock.calls[0][0] as Array<{ command: string; description: string }>;
    const cmdNames = cmds.map((c: { command: string }) => c.command);
    expect(cmdNames).toContain("pro");
    expect(cmdNames).toContain("web");
    const proCmd = cmds.find((c: { command: string }) => c.command === "pro");
    expect(proCmd?.description).toBe("Pro-Modus einstellen");
    const webCmd = cmds.find((c: { command: string }) => c.command === "web");
    expect(webCmd?.description).toBe("Websuche einstellen");
    // All original commands still present
    expect(cmdNames).toContain("start");
    expect(cmdNames).toContain("new");
    expect(cmdNames).toContain("stop");
    expect(cmdNames).toContain("status");
    expect(cmdNames).toContain("help");
    expect(cmdNames).toContain("settings");
  });

  it("replaceTelegramBot sends both pro and web commands", async () => {
    process.env.TELEGRAM_CREDENTIALS_KEY = ENV_KEY;
    process.env.TELEGRAM_PUBLIC_ORIGIN = "https://findog.at";

    const integration = makeIntegrationRow();

    let callCount = 0;
    const from = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return mockSelectMaybeSingle({ data: integration, error: null });
      return mockSelectMaybeSingle({ data: null, error: null });
    });

    const mockRpc = vi.fn().mockImplementation(async () => {
      return { data: true, error: null };
    });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from, rpc: mockRpc } as never);

    const setMyCommands = vi.fn().mockResolvedValue(true);
    const botApi = mockBotApi({
      getMe: vi.fn().mockResolvedValue({ id: 111222333, is_bot: true, first_name: "NewBot", username: "new_bot" }),
      setMyCommands,
    });

    const { replaceTelegramBot } = await import("./settings");
    const oldBotApi = mockBotApi({
      deleteWebhook: vi.fn().mockResolvedValue(true),
      deleteMyCommands: vi.fn().mockResolvedValue(true),
    });
    await replaceTelegramBot(CLIENT_ID, TOKEN, botApi, { oldBotApi });

    expect(setMyCommands).toHaveBeenCalledTimes(1);
    const cmds = setMyCommands.mock.calls[0][0] as Array<{ command: string; description: string }>;
    const cmdNames = cmds.map((c: { command: string }) => c.command);
    expect(cmdNames).toContain("pro");
    expect(cmdNames).toContain("web");
  });

  it("both register and replace use the same centralized command list", async () => {
    process.env.TELEGRAM_CREDENTIALS_KEY = ENV_KEY;
    process.env.TELEGRAM_PUBLIC_ORIGIN = "https://findog.at";

    // Register
    const ms1 = mockSelectMaybeSingle({ data: null, error: null });
    const mockInsert1 = vi.fn().mockResolvedValue({ error: null });
    const setMyCommands1 = vi.fn().mockResolvedValue(true);
    vi.mocked(getSupabaseServerClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ ...ms1, insert: mockInsert1 }),
    } as never);
    await registerTelegramIntegration(CLIENT_ID, TOKEN, mockBotApi({ setMyCommands: setMyCommands1 }));

    // Replace
    const integration = makeIntegrationRow();
    let callCount = 0;
    const from2 = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return mockSelectMaybeSingle({ data: integration, error: null });
      return mockSelectMaybeSingle({ data: null, error: null });
    });
    const mockRpc2 = vi.fn().mockResolvedValue({ data: true, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: from2, rpc: mockRpc2 } as never);
    const setMyCommands2 = vi.fn().mockResolvedValue(true);

    const { replaceTelegramBot } = await import("./settings");
    const oldBotApi = mockBotApi({
      deleteWebhook: vi.fn().mockResolvedValue(true),
      deleteMyCommands: vi.fn().mockResolvedValue(true),
    });
    await replaceTelegramBot(CLIENT_ID, TOKEN, mockBotApi({
      getMe: vi.fn().mockResolvedValue({ id: 111222333, is_bot: true, first_name: "NewBot", username: "new_bot" }),
      setMyCommands: setMyCommands2,
    }), { oldBotApi });

    // Both command lists should be identical
    const cmds1 = setMyCommands1.mock.calls[0][0] as Array<{ command: string }>;
    const cmds2 = setMyCommands2.mock.calls[0][0] as Array<{ command: string }>;
    expect(cmds1.map((c: { command: string }) => c.command)).toEqual(cmds2.map((c: { command: string }) => c.command));
    expect(cmds1.map((c: { command: string; description: string }) => c.description)).toEqual(cmds2.map((c: { command: string; description: string }) => c.description));
  });
});
