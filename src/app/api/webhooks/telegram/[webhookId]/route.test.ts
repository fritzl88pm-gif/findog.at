import { randomBytes, randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { generateWebhookSecret, hashToken } from "@/lib/telegram/pairing";
import { POST } from "./route";

vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

const ENV_KEY = randomBytes(32).toString("base64");
const webhookId = randomUUID();
const webhookSecret = generateWebhookSecret();
const webhookSecretHash = hashToken(webhookSecret);

function buildRequest(body: unknown, secretToken?: string): Request {
  return new Request(
    `https://findog.at/api/webhooks/telegram/${webhookId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secretToken ? { "X-Telegram-Bot-Api-Secret-Token": secretToken } : {}),
      },
      body: JSON.stringify(body),
    },
  );
}

function mockQuery(result: unknown) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  return { select, eq, maybeSingle };
}

function mockRpc(result: unknown) {
  return vi.fn().mockResolvedValue(result);
}

describe("POST /api/webhooks/telegram/[webhookId]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.TELEGRAM_CREDENTIALS_KEY = ENV_KEY;
  });
  afterEach(() => { delete process.env.TELEGRAM_CREDENTIALS_KEY; });

  it("returns 404 for unknown webhook ID", async () => {
    const ms = mockQuery({ data: null, error: null });
    const rpc = mockRpc({ data: { id: 1, status: "pending" }, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn().mockReturnValue(ms), rpc } as never);
    const response = await POST(buildRequest({ update_id: 1 }, "some-secret"), {
      params: Promise.resolve({ webhookId: randomUUID() }),
    });
    expect(response.status).toBe(404);
  });

  it("returns 404 for invalid secret token (timing-safe)", async () => {
    const ms = mockQuery({
      data: { id: "int-1", webhook_secret_sha256: webhookSecretHash, status: "active" },
      error: null,
    });
    const rpc = mockRpc({ data: { id: 1, status: "pending" }, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn().mockReturnValue(ms), rpc } as never);
    const response = await POST(buildRequest({ update_id: 1 }, "wrong-secret"), {
      params: Promise.resolve({ webhookId }),
    });
    expect(response.status).toBe(404);
  });

  it("returns 200 for unknown/unsupported update types", async () => {
    const ms = mockQuery({
      data: { id: "int-1", webhook_secret_sha256: webhookSecretHash, status: "active" },
      error: null,
    });
    const rpc = mockRpc({ data: { id: 1, status: "pending" }, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn().mockReturnValue(ms), rpc } as never);
    const response = await POST(
      buildRequest({ update_id: 1, edited_message: {} }, webhookSecret),
      { params: Promise.resolve({ webhookId }) },
    );
    expect(response.status).toBe(200);
  });

  it("returns 200 and enqueues a valid message update idempotently", async () => {
    const integrationId = randomUUID();
    const ms = mockQuery({
      data: { id: integrationId, webhook_secret_sha256: webhookSecretHash, status: "active", paired_telegram_user_id: 123, paired_telegram_chat_id: 456 },
      error: null,
    });
    const rpc = mockRpc({ data: { id: 1, status: "pending" }, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn().mockReturnValue(ms), rpc } as never);

    const response = await POST(
      buildRequest({
        update_id: 100,
        message: {
          message_id: 200,
          from: { id: 123, is_bot: false, first_name: "User" },
          chat: { id: 456, type: "private" },
          date: Math.floor(Date.now() / 1000),
          text: "Hello",
        },
      }, webhookSecret),
      { params: Promise.resolve({ webhookId }) },
    );
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("enqueue_telegram_update", expect.objectContaining({
      p_integration_id: integrationId,
      p_update_id: 100,
      p_telegram_chat_id: 456,
      p_telegram_message_id: 200,
      p_update_kind: "message",
    }));
  });

  it("acknowledges immediately with a Telegram Busy reply when PostgreSQL rejects the sixth queued question", async () => {
    const integrationId = randomUUID();
    const ms = mockQuery({
      data: { id: integrationId, webhook_secret_sha256: webhookSecretHash, status: "active", paired_telegram_user_id: 123, paired_telegram_chat_id: 456 },
      error: null,
    });
    const rpc = mockRpc({ data: { id: null, status: "busy" }, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn().mockReturnValue(ms), rpc } as never);

    const response = await POST(
      buildRequest({
        update_id: 106,
        message: {
          message_id: 206,
          from: { id: 123, is_bot: false, first_name: "User" },
          chat: { id: 456, type: "private" },
          date: Math.floor(Date.now() / 1000),
          text: "Sechste Steuerfrage",
        },
      }, webhookSecret),
      { params: Promise.resolve({ webhookId }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      method: "sendMessage",
      chat_id: 456,
      text: expect.stringContaining("Bitte warte"),
    });
  });

  it("classifies a known slash command as update_kind 'command'", async () => {
    const integrationId = randomUUID();
    const ms = mockQuery({
      data: { id: integrationId, webhook_secret_sha256: webhookSecretHash, status: "active", paired_telegram_user_id: 123, paired_telegram_chat_id: 456 },
      error: null,
    });
    const rpc = mockRpc({ data: { id: 1, status: "pending" }, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn().mockReturnValue(ms), rpc } as never);

    const response = await POST(
      buildRequest({
        update_id: 103,
        message: {
          message_id: 203,
          from: { id: 123, is_bot: false, first_name: "User" },
          chat: { id: 456, type: "private" },
          date: Math.floor(Date.now() / 1000),
          text: "/status",
        },
      }, webhookSecret),
      { params: Promise.resolve({ webhookId }) },
    );
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("enqueue_telegram_update", expect.objectContaining({
      p_update_kind: "command",
    }));
  });

  it("returns 200 and ignores duplicate update_id", async () => {
    const integrationId = randomUUID();
    const ms = mockQuery({
      data: { id: integrationId, webhook_secret_sha256: webhookSecretHash, status: "active", paired_telegram_user_id: 123, paired_telegram_chat_id: 456 },
      error: null,
    });
    const rpc = mockRpc({ data: { id: 1, status: "pending" }, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn().mockReturnValue(ms), rpc } as never);

    const update = {
      update_id: 100,
      message: { message_id: 200, from: { id: 123, is_bot: false, first_name: "User" }, chat: { id: 456, type: "private" }, date: 1234567890, text: "Hi" },
    };
    await POST(buildRequest(update, webhookSecret), { params: Promise.resolve({ webhookId }) });
    await POST(buildRequest(update, webhookSecret), { params: Promise.resolve({ webhookId }) });

    // Both should return 200, second call shouldn't create duplicate
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("ignores messages from foreign private chat after pairing", async () => {
    const integrationId = randomUUID();
    const ms = mockQuery({
      data: { id: integrationId, webhook_secret_sha256: webhookSecretHash, status: "active", paired_telegram_user_id: 123, paired_telegram_chat_id: 456 },
      error: null,
    });
    const rpc = mockRpc({ data: { id: 1, status: "pending" }, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn().mockReturnValue(ms), rpc } as never);

    // Message from chat 999 (not the paired chat)
    const response = await POST(
      buildRequest({
        update_id: 101,
        message: { message_id: 201, from: { id: 999, is_bot: false, first_name: "Stranger" }, chat: { id: 999, type: "private" }, date: 1234567890, text: "Hi" },
      }, webhookSecret),
      { params: Promise.resolve({ webhookId }) },
    );
    expect(response.status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("ignores group/supergroup messages", async () => {
    const integrationId = randomUUID();
    const ms = mockQuery({
      data: { id: integrationId, webhook_secret_sha256: webhookSecretHash, status: "active", paired_telegram_user_id: 123, paired_telegram_chat_id: 456 },
      error: null,
    });
    const rpc = mockRpc({ data: { id: 1, status: "pending" }, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn().mockReturnValue(ms), rpc } as never);

    const response = await POST(
      buildRequest({
        update_id: 102,
        message: { message_id: 202, from: { id: 123, is_bot: false, first_name: "User" }, chat: { id: 789, type: "group" }, date: 1234567890, text: "Hi" },
      }, webhookSecret),
      { params: Promise.resolve({ webhookId }) },
    );
    expect(response.status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("handles /start pairing token for unpaired integration via atomic RPC", async () => {
    const integrationId = randomUUID();
    const pairingToken = randomBytes(32).toString("base64url");
    const pairingTokenHash = hashToken(pairingToken);
    const future = new Date(Date.now() + 600000).toISOString();

    const ms = mockQuery({
      data: {
        id: integrationId,
        webhook_secret_sha256: webhookSecretHash,
        status: "awaiting_pairing",
        pairing_token_sha256: pairingTokenHash,
        pairing_expires_at: future,
        paired_telegram_user_id: null,
        paired_telegram_chat_id: null,
      },
      error: null,
    });

    // pair_telegram_integration returns true, then enqueue
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: { id: 1, status: "pending" }, error: null });

    vi.mocked(getSupabaseServerClient).mockReturnValue({
      from: vi.fn().mockReturnValue(ms),
      rpc,
    } as never);

    const response = await POST(
      buildRequest({
        update_id: 200,
        message: {
          message_id: 300,
          from: { id: 111, is_bot: false, first_name: "Pairer" },
          chat: { id: 222, type: "private" },
          date: Math.floor(Date.now() / 1000),
          text: `/start ${pairingToken}`,
          entities: [{ type: "bot_command", offset: 0, length: 6 }],
        },
      }, webhookSecret),
      { params: Promise.resolve({ webhookId }) },
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("pair_telegram_integration", expect.objectContaining({
      p_integration_id: integrationId,
      p_pairing_hash: pairingTokenHash,
    }));
    expect(rpc).toHaveBeenCalledWith("enqueue_telegram_update", expect.objectContaining({
      p_integration_id: integrationId,
      p_update_id: 200,
      p_telegram_chat_id: 222,
      p_update_kind: "command",
    }));
  });

  it("returns 200 but does NOT enqueue when atomic pairing RPC returns false (race/reuse)", async () => {
    const integrationId = randomUUID();
    const pairingToken = randomBytes(32).toString("base64url");
    const pairingTokenHash = hashToken(pairingToken);
    const future = new Date(Date.now() + 600000).toISOString();

    const ms = mockQuery({
      data: {
        id: integrationId,
        webhook_secret_sha256: webhookSecretHash,
        status: "awaiting_pairing",
        pairing_token_sha256: pairingTokenHash,
        pairing_expires_at: future,
        paired_telegram_user_id: null,
        paired_telegram_chat_id: null,
      },
      error: null,
    });

    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: false, error: null });

    vi.mocked(getSupabaseServerClient).mockReturnValue({
      from: vi.fn().mockReturnValue(ms),
      rpc,
    } as never);

    const response = await POST(
      buildRequest({
        update_id: 201,
        message: {
          message_id: 301,
          from: { id: 111, is_bot: false, first_name: "Pairer" },
          chat: { id: 222, type: "private" },
          date: Math.floor(Date.now() / 1000),
          text: `/start ${pairingToken}`,
          entities: [{ type: "bot_command", offset: 0, length: 6 }],
        },
      }, webhookSecret),
      { params: Promise.resolve({ webhookId }) },
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("pair_telegram_integration", expect.anything());
  });


  it("rejects payloads exceeding 256 KiB of UTF-8 bytes (not UTF-16 code units)", async () => {
    // 3-byte UTF-8 character (e.g., €) repeated: 90000 * 3 bytes = 270000 > 256 KiB
    const char3byte = "€"; // € — 3 bytes in UTF-8, 1 UTF-16 code unit
    // Create a payload that fits in UTF-16 units but exceeds UTF-8 bytes
    // 90000 * 3 = 270000 bytes > 256 * 1024 = 262144 bytes
    // But only 90000 UTF-16 code units < 262144
    const largePayload = JSON.stringify({
      update_id: 999,
      message: {
        message_id: 1,
        from: { id: 123, is_bot: false, first_name: "Test" },
        chat: { id: 456, type: "private" },
        date: 1234567890,
        text: char3byte.repeat(89000),
      },
    });

    // Verify the UTF-8 size exceeds the limit
    const utf8Bytes = new TextEncoder().encode(largePayload).length;
    expect(utf8Bytes).toBeGreaterThan(256 * 1024);
    // But UTF-16 length is below the limit
    expect(largePayload.length).toBeLessThan(256 * 1024);

    const ms = mockQuery({
      data: { id: "int-1", webhook_secret_sha256: webhookSecretHash, status: "active", paired_telegram_user_id: 123, paired_telegram_chat_id: 456 },
      error: null,
    });
    const rpc = mockRpc({ data: { id: 1, status: "pending" }, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn().mockReturnValue(ms), rpc } as never);

    const request = new Request(
      `https://findog.at/api/webhooks/telegram/${webhookId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": webhookSecret,
        },
        body: largePayload,
      },
    );

    const response = await POST(request, { params: Promise.resolve({ webhookId }) });
    expect(response.status).toBe(413);
  });

    it("returns 200 and ignores /start with invalid/expired pairing token", async () => {
    const integrationId = randomUUID();
    const oldExpiry = new Date(Date.now() - 60000).toISOString(); // expired
    const pairingToken = randomBytes(32).toString("base64url");
    const pairingTokenHash = hashToken(pairingToken);

    const ms = mockQuery({
      data: {
        id: integrationId,
        webhook_secret_sha256: webhookSecretHash,
        status: "awaiting_pairing",
        pairing_token_sha256: pairingTokenHash,
        pairing_expires_at: oldExpiry,
        paired_telegram_user_id: null,
        paired_telegram_chat_id: null,
      },
      error: null,
    });
    const rpc = mockRpc({ data: { id: 1, status: "pending" }, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn().mockReturnValue(ms), rpc } as never);

    const response = await POST(
      buildRequest({
        update_id: 201,
        message: {
          message_id: 301,
          from: { id: 111, is_bot: false, first_name: "Pairer" },
          chat: { id: 222, type: "private" },
          date: Math.floor(Date.now() / 1000),
          text: `/start ${pairingToken}`,
          entities: [{ type: "bot_command", offset: 0, length: 6 }],
        },
      }, webhookSecret),
      { params: Promise.resolve({ webhookId }) },
    );

    expect(response.status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
  });
});
