import { beforeEach, describe, expect, it, vi } from "vitest";

import { createBotApi, sanitizeTelegramError } from "./bot-api";
import type { TelegramApiResponse } from "./types";

function mockFetch(responseInit: ResponseInit & { payload?: unknown }): ReturnType<typeof vi.fn> {
  const fn = vi.fn<(_url: string | URL, _init?: RequestInit) => Promise<Response>>();
  fn.mockResolvedValue(
    new Response(
      responseInit.payload !== undefined ? JSON.stringify(responseInit.payload) : null,
      { status: responseInit.status ?? 200, statusText: responseInit.statusText },
    ),
  );
  return fn;
}

const TOKEN = "1234567890:AAECDefghIJKLMNOPQRSTUVWXYZabcdefg";
const BASE_URL = `https://api.telegram.org/bot${TOKEN}`;

describe("createBotApi", () => {
  let fetchMock: ReturnType<typeof mockFetch>;

  beforeEach(() => {
    fetchMock = mockFetch({});
  });

  it("getMe returns parsed TelegramBotInfo on success", async () => {
    const api = createBotApi(TOKEN, fetchMock as never);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: {
            id: 123456789,
            is_bot: true,
            first_name: "TestBot",
            username: "test_bot",
          } satisfies TelegramApiResponse["result"],
        }),
        { status: 200 },
      ),
    );

    const result = await api.getMe();
    expect(result.id).toBe(123456789);
    expect(result.username).toBe("test_bot");
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/getMe`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("getMe throws on Telegram error (ok: false)", async () => {
    const api = createBotApi(TOKEN, fetchMock as never);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          description: "Not Found",
          error_code: 404,
        } satisfies TelegramApiResponse),
        { status: 404 },
      ),
    );

    await expect(api.getMe()).rejects.toThrow("Not Found");
  });

  it("getWebhookInfo returns parsed webhook info", async () => {
    const api = createBotApi(TOKEN, fetchMock as never);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: {
            url: "",
            has_custom_certificate: false,
            pending_update_count: 0,
          },
        }),
        { status: 200 },
      ),
    );

    const result = await api.getWebhookInfo();
    expect(result.url).toBe("");
    expect(result.pending_update_count).toBe(0);
  });

  it("setWebhook sends correct parameters", async () => {
    const api = createBotApi(TOKEN, fetchMock as never);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: true, description: "Webhook was set" }), {
        status: 200,
      }),
    );

    await api.setWebhook({
      url: "https://example.com/webhook",
      secret_token: "secret123",
      allowed_updates: ["message", "my_chat_member"],
      drop_pending_updates: true,
      max_connections: 10,
    });

    const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.url).toBe("https://example.com/webhook");
    expect(body.secret_token).toBe("secret123");
    expect(body.allowed_updates).toEqual(["message", "my_chat_member"]);
    expect(body.drop_pending_updates).toBe(true);
    expect(body.max_connections).toBe(10);
  });

  it("deleteWebhook sends drop_pending_updates when requested", async () => {
    const api = createBotApi(TOKEN, fetchMock as never);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: true, description: "Webhook was deleted" }), {
        status: 200,
      }),
    );

    await api.deleteWebhook(true);
    const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.drop_pending_updates).toBe(true);
  });

  it("setMyCommands sends command array", async () => {
    const api = createBotApi(TOKEN, fetchMock as never);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }),
    );

    await api.setMyCommands([
      { command: "start", description: "Start the bot" },
    ]);

    const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.commands).toEqual([{ command: "start", description: "Start the bot" }]);
  });

  it("deleteMyCommands calls the correct endpoint", async () => {
    const api = createBotApi(TOKEN, fetchMock as never);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }),
    );

    await api.deleteMyCommands();
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/deleteMyCommands`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("supports custom timeout via AbortSignal", async () => {
    const api = createBotApi(TOKEN, fetchMock as never);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }),
    );

    const controller = new AbortController();
    await api.getMe({ signal: controller.signal });

    const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(callArgs[1].signal).toBe(controller.signal);
  });

  it("sendMessage sends correct parameters", async () => {
    const api = createBotApi(TOKEN, fetchMock as never);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: { message_id: 42, date: 1234567890, chat: { id: 123, type: "private" } },
        }),
        { status: 200 },
      ),
    );

    const result = await api.sendMessage({ chat_id: 123, text: "Hello" });
    expect(result.message_id).toBe(42);

    const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.chat_id).toBe(123);
    expect(body.text).toBe("Hello");
  });

  it("sendRichMessage calls the correct endpoint with raw Markdown", async () => {
    const api = createBotApi(TOKEN, fetchMock as never);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: { message_id: 43, date: 1234567890, chat: { id: 123, type: "private" } },
        }),
        { status: 200 },
      ),
    );
    const markdown = "| A | B |\n|---|---|\n| 1 | 2 |";

    const result = await api.sendRichMessage({
      chat_id: 123,
      rich_message: { markdown },
    });

    expect(result.message_id).toBe(43);
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/sendRichMessage`,
      expect.objectContaining({ method: "POST" }),
    );
    const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(callArgs[1].body as string)).toEqual({
      chat_id: 123,
      rich_message: { markdown },
    });
  });

  it("throws a real sanitized Error with safe ambiguity metadata on network failure", async () => {
    const fetchFailure = new TypeError(`Network failure for ${BASE_URL}/sendMessage`);
    fetchMock.mockRejectedValue(fetchFailure);
    const api = createBotApi(TOKEN, fetchMock as never);

    const error = await api.sendMessage({ chat_id: 123, text: "Hello" }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ telegramDeliveryUncertain: true });
    expect((error as Error).message).not.toContain(TOKEN);
    expect(JSON.stringify(error)).not.toContain(TOKEN);
  });

  it("sendMessageDraft sends correct parameters", async () => {
    const api = createBotApi(TOKEN, fetchMock as never);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: { message_id: 99, date: 1234567890, chat: { id: 123, type: "private" } },
        }),
        { status: 200 },
      ),
    );

    const result = await api.sendMessageDraft({ chat_id: 123, text: "Draft..." });
    expect(result.message_id).toBe(99);

    const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.chat_id).toBe(123);
    expect(body.text).toBe("Draft...");
  });

  it("sendChatAction sends correct parameters", async () => {
    const api = createBotApi(TOKEN, fetchMock as never);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }),
    );

    await api.sendChatAction({ chat_id: 123, action: "typing" });

    const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.chat_id).toBe(123);
    expect(body.action).toBe("typing");
  });
});

describe("sanitizeTelegramError", () => {
  it("never includes the token in the sanitized error", () => {
    const err = sanitizeTelegramError(
      TOKEN,
      new Error(`Failed to fetch https://api.telegram.org/bot${TOKEN}/getMe`),
    );
    expect(err.message).not.toContain(TOKEN);
    expect(err.message).not.toContain("1234567890");
    expect(err.error_code).toBeUndefined();
  });

  it("never includes the full bot API URL in the sanitized error", () => {
    const err = sanitizeTelegramError(
      TOKEN,
      new Error(`Network error for https://api.telegram.org/bot${TOKEN}/getWebhookInfo`),
    );
    expect(err.message).not.toContain("https://api.telegram.org/bot");
    expect(err.message).not.toContain(TOKEN);
  });

  it("extracts error_code and description from Telegram API error JSON", () => {
    const err = sanitizeTelegramError(
      TOKEN,
      new Error(
        `Telegram API error: ${JSON.stringify({
          ok: false,
          error_code: 429,
          description: "Too Many Requests",
          parameters: { retry_after: 30 },
        })}`,
      ),
    );
    expect(err.error_code).toBe(429);
    expect(err.description).toBe("Too Many Requests");
    expect(err.retry_after).toBe(30);
  });
});
