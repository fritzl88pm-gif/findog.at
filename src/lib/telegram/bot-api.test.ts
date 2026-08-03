import { beforeEach, describe, expect, it, vi } from "vitest";

import { createBotApi, sanitizeTelegramError, TelegramFileTooLargeError } from "./bot-api";
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

describe("getFile", () => {
  it("returns file path on success", async () => {
    const fetchMock = vi.fn<(_url: string | URL, _init?: RequestInit) => Promise<Response>>();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: {
            file_id: "file-abc",
            file_unique_id: "unq",
            file_size: 1024,
            file_path: "documents/file_123.pdf",
          },
        }),
        { status: 200 },
      ),
    );
    const api = createBotApi(TOKEN, fetchMock as never);

    const result = await api.getFile({ file_id: "file-abc" });

    expect(result.file_path).toBe("documents/file_123.pdf");
    expect(result.file_size).toBe(1024);
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/getFile`,
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.file_id).toBe("file-abc");
  });

  it("supports AbortSignal", async () => {
    const fetchMock = vi.fn<(_url: string | URL, _init?: RequestInit) => Promise<Response>>();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, result: { file_id: "f", file_unique_id: "u", file_path: "p" } }),
        { status: 200 },
      ),
    );
    const api = createBotApi(TOKEN, fetchMock as never);
    const controller = new AbortController();

    await api.getFile({ file_id: "f" }, { signal: controller.signal });

    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].signal).toBe(controller.signal);
  });
});

describe("downloadFile", () => {
  it("sanitizes stream read failures that contain the bot token", async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error(`socket failed for https://api.telegram.org/file/bot${TOKEN}/documents/file.pdf`));
      },
    });
    const fetchMock = vi.fn<(_url: string | URL, _init?: RequestInit) => Promise<Response>>();
    fetchMock.mockResolvedValue(new Response(stream, { status: 200 }));
    const api = createBotApi(TOKEN, fetchMock as never);

    const error = await api.downloadFile("documents/file.pdf", { maxBytes: 100 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(TOKEN);
    expect(JSON.stringify(error)).not.toContain(TOKEN);
  });

  it("streams response body bytes up to the cap", async () => {
    const fileBytes = new Uint8Array(100).fill(0x41);
    const fetchMock = vi.fn<(_url: string | URL, _init?: RequestInit) => Promise<Response>>();
    fetchMock.mockResolvedValue(
      new Response(fileBytes, {
        status: 200,
        headers: { "Content-Length": "100" },
      }),
    );
    const api = createBotApi(TOKEN, fetchMock as never);

    const result = await api.downloadFile("documents/file.pdf", { maxBytes: 100 });

    expect(result.length).toBe(100);
    expect(result[0]).toBe(0x41);
  });

  it("enforces Content-Length cap before streaming", async () => {
    const fetchMock = vi.fn<(_url: string | URL, _init?: RequestInit) => Promise<Response>>();
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array(10), {
        status: 200,
        headers: { "Content-Length": "999999999" },
      }),
    );
    const api = createBotApi(TOKEN, fetchMock as never);

    await expect(api.downloadFile("file", { maxBytes: 100 })).rejects.toBeInstanceOf(TelegramFileTooLargeError);
  });

  it("enforces streaming cap mid-download", async () => {
    const overflow = new Uint8Array(200).fill(0x42);
    const fetchMock = vi.fn<(_url: string | URL, _init?: RequestInit) => Promise<Response>>();
    fetchMock.mockResolvedValue(
      new Response(overflow, { status: 200 }),
    );
    const api = createBotApi(TOKEN, fetchMock as never);

    await expect(api.downloadFile("file", { maxBytes: 100 })).rejects.toBeInstanceOf(TelegramFileTooLargeError);
  });

  it("propagates AbortSignal to fetch", async () => {
    const fetchMock = vi.fn<(_url: string | URL, _init?: RequestInit) => Promise<Response>>();
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array(5).fill(0x41), {
        status: 200,
        headers: { "Content-Length": "5" },
      }),
    );
    const api = createBotApi(TOKEN, fetchMock as never);
    const controller = new AbortController();

    await api.downloadFile("file", { maxBytes: 100, signal: controller.signal });

    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].signal).toBe(controller.signal);
  });

  it("sanitizes errors so the file URL and token are never exposed", async () => {
    const fetchMock = vi.fn<(_url: string | URL, _init?: RequestInit) => Promise<Response>>();
    fetchMock.mockRejectedValue(
      new Error(`Network error for https://api.telegram.org/file/bot${TOKEN}/documents/file.pdf`),
    );
    const api = createBotApi(TOKEN, fetchMock as never);

    const error = await api.downloadFile("documents/file.pdf", { maxBytes: 100 }).catch((e: unknown) => e);
    const message = error instanceof Error ? error.message : String(error);
    expect(message).not.toContain(TOKEN);
    expect(message).not.toContain("api.telegram.org/file/bot");
  });

  it("uses the correct file download URL", async () => {
    const fetchMock = vi.fn<(_url: string | URL, _init?: RequestInit) => Promise<Response>>();
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array(3).fill(0x41), {
        status: 200,
        headers: { "Content-Length": "3" },
      }),
    );
    const api = createBotApi(TOKEN, fetchMock as never);

    await api.downloadFile("documents/file_1.pdf", { maxBytes: 10 });

    const url = (fetchMock.mock.calls[0] as [string])[0];
    expect(url).toBe(`https://api.telegram.org/file/bot${TOKEN}/documents/file_1.pdf`);
  });
});

// ── downloadFile non-2xx ─────────────────────────────────────────────────────

describe("downloadFile non-2xx responses", () => {
  it("rejects non-2xx responses without returning bytes and sanitizes the error", async () => {
    const fetchMock = vi.fn<(_url: string | URL, _init?: RequestInit) => Promise<Response>>();
    fetchMock.mockResolvedValue(
      new Response("Internal Server Error", {
        status: 500,
        statusText: "Internal Server Error",
      }),
    );
    const api = createBotApi(TOKEN, fetchMock as never);

    const error = await api.downloadFile("documents/file.pdf", { maxBytes: 100 }).catch((e: unknown) => e);
    const message = error instanceof Error ? error.message : String(error);
    expect(message).not.toContain(TOKEN);
    expect(message).not.toContain("file/bot");
    expect(error).toBeInstanceOf(Error);
  });

  it("rejects 404 responses without buffering an unbounded error body", async () => {
    // Simulate a response with a huge body that would consume memory if buffered
    const fetchMock = vi.fn<(_url: string | URL, _init?: RequestInit) => Promise<Response>>();
    // Create a response with a large body but non-2xx status
    const largeBody = new Uint8Array(10 * 1024 * 1024).fill(0x42); // 10 MB error body
    fetchMock.mockResolvedValue(
      new Response(largeBody, { status: 404, statusText: "Not Found" }),
    );
    const api = createBotApi(TOKEN, fetchMock as never);

    // Should reject without streaming the entire error body
    const error = await api.downloadFile("documents/missing.pdf", { maxBytes: 100 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    const message = error instanceof Error ? error.message : String(error);
    expect(message).not.toContain(TOKEN);
  });

  it("does not expose the full file URL in non-2xx error messages", async () => {
    const fetchMock = vi.fn<(_url: string | URL, _init?: RequestInit) => Promise<Response>>();
    fetchMock.mockResolvedValue(
      new Response("Not found", { status: 404, statusText: "Not Found" }),
    );
    const api = createBotApi(TOKEN, fetchMock as never);

    const error = await api.downloadFile("documents/$ecret.pdf", { maxBytes: 100 }).catch((e: unknown) => e);
    const message = error instanceof Error ? error.message : String(error);
    expect(message).not.toContain("$ecret.pdf");
    expect(message).not.toContain(TOKEN);
    expect(message).not.toContain("file/bot");
  });
});

describe("TelegramFileTooLargeError", () => {
  it("is classified by type rather than message text", () => {
    const error = new TelegramFileTooLargeError("unrelated wording");

    expect(error).toBeInstanceOf(TelegramFileTooLargeError);
    expect(error.message).not.toContain("größer");
  });
});
