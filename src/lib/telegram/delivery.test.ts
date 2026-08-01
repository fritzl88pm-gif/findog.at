import { describe, expect, it, vi } from "vitest";

import {
  SanitizedTelegramError,
  createBotApi,
  type BotApi,
  type SendChatActionParams,
  type SendMessageDraftParams,
  type SendMessageParams,
  type SendRichMessageParams,
  type TelegramMessageResult,
} from "./bot-api";

import {
  deliverFinalAnswer,
  refreshDraftPreview,
  sendTypingIndicator,
  type DeliveryLedger,
} from "./delivery";

// ── Fake BotApi ─────────────────────────────────────────────────────────────

function fakeBotApi(
  overrides: Partial<{
    sendMessageDraft: (params: SendMessageDraftParams) => Promise<TelegramMessageResult>;
    sendChatAction: (params: SendChatActionParams) => Promise<boolean>;
    sendMessage: (params: SendMessageParams) => Promise<TelegramMessageResult>;
    sendRichMessage: (params: SendRichMessageParams) => Promise<TelegramMessageResult>;
  }> = {},
): BotApi {
  return {
    getMe: vi.fn(),
    getWebhookInfo: vi.fn(),
    setWebhook: vi.fn(),
    deleteWebhook: vi.fn(),
    setMyCommands: vi.fn(),
    deleteMyCommands: vi.fn(),
    sendMessageDraft: overrides.sendMessageDraft
      ? vi.fn(overrides.sendMessageDraft)
      : vi.fn().mockResolvedValue({ message_id: 1, date: 1, chat: { id: 123, type: "private" } }),
    sendChatAction: overrides.sendChatAction
      ? vi.fn(overrides.sendChatAction)
      : vi.fn().mockResolvedValue(true),
    sendMessage: overrides.sendMessage
      ? vi.fn(overrides.sendMessage)
      : vi.fn().mockResolvedValue({ message_id: 2, date: 1, chat: { id: 123, type: "private" } }),
    sendRichMessage: overrides.sendRichMessage
      ? vi.fn(overrides.sendRichMessage)
      : vi.fn().mockResolvedValue({ message_id: 3, date: 1, chat: { id: 123, type: "private" } }),
  };
}

const chatId = 123;

describe("sendTypingIndicator", () => {
  it("sends typing action via BotApi", async () => {
    const api = fakeBotApi();
    await sendTypingIndicator(api, chatId);
    expect(api.sendChatAction).toHaveBeenCalledWith({ chat_id: chatId, action: "typing" });
  });

  it("swallows errors silently", async () => {
    const api = fakeBotApi({
      sendChatAction: vi.fn().mockRejectedValue(new Error("network error")),
    });
    await expect(sendTypingIndicator(api, chatId)).resolves.toBeUndefined();
  });
});

describe("refreshDraftPreview", () => {
  it("sends a draft message via sendMessageDraft", async () => {
    const api = fakeBotApi();
    const result = await refreshDraftPreview(api, chatId, "Thinking...");
    expect(result).toEqual({ message_id: 1, date: 1, chat: { id: 123, type: "private" } });
    expect(api.sendMessageDraft).toHaveBeenCalledWith({
      chat_id: chatId,
      text: "Thinking...",
    });
  });

  it("returns null when sendMessageDraft fails", async () => {
    const api = fakeBotApi({
      sendMessageDraft: vi.fn().mockRejectedValue(new Error("draft failed")),
    });
    const result = await refreshDraftPreview(api, chatId, "Thinking...");
    expect(result).toBeNull();
  });
});

describe("deliverFinalAnswer", () => {
  it("delivers a short answer in a single chunk", async () => {
    const api = fakeBotApi();
    const ledger: DeliveryLedger = { chunks: [], uncertainChunks: [] };
    const result = await deliverFinalAnswer(api, chatId, "Hello world", { ledger });
    expect(result.sent).toBe(true);
    expect(result.uncertain).toBe(false);
    expect(ledger.chunks).toHaveLength(1);
    expect(ledger.chunks[0].content).toBe("Hello world");
    expect(ledger.chunks[0].status).toBe("sent");
    expect(api.sendMessage).toHaveBeenCalledWith({
      chat_id: chatId,
      text: "Hello world",
      parse_mode: "HTML",
    });
  });

  it("delivers eligible raw Markdown through sendRichMessage", async () => {
    const api = fakeBotApi();
    const ledger: DeliveryLedger = { chunks: [], uncertainChunks: [] };
    const rawMarkdown = "| A | B |\n|---|---|\n| 1 | 2 |";

    const result = await deliverFinalAnswer(api, chatId, "<pre>A  B\n─  ─\n1  2</pre>", {
      ledger,
      richMarkdown: rawMarkdown,
    });

    expect(result).toEqual({ sent: true, uncertain: false });
    expect(api.sendRichMessage).toHaveBeenCalledWith({
      chat_id: chatId,
      rich_message: { markdown: rawMarkdown },
    });
    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(ledger.chunks[0]).toMatchObject({ status: "sent", messageId: 3 });
  });

  it("falls back once after a permanent rich rejection", async () => {
    const api = fakeBotApi({
      sendRichMessage: vi.fn().mockRejectedValue(new SanitizedTelegramError({
        message: "Bad Request: can't parse rich message",
        errorCode: 400,
      })),
    });
    const ledger: DeliveryLedger = { chunks: [], uncertainChunks: [] };
    const fallback = "<pre>A  B\n─  ─\n1  2</pre>";

    const result = await deliverFinalAnswer(api, chatId, fallback, {
      ledger,
      richMarkdown: "| A | B |\n|---|---|\n| 1 | 2 |",
    });

    expect(result).toEqual({ sent: true, uncertain: false });
    expect(api.sendRichMessage).toHaveBeenCalledTimes(1);
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(api.sendMessage).toHaveBeenCalledWith({
      chat_id: chatId,
      text: fallback,
      parse_mode: "HTML",
    });
  });

  it("marks ambiguous rich failures uncertain without a legacy resend", async () => {
    const api = fakeBotApi({
      sendRichMessage: vi.fn().mockRejectedValue(new TypeError("network connection reset")),
    });
    const ledger: DeliveryLedger = { chunks: [], uncertainChunks: [] };

    const result = await deliverFinalAnswer(api, chatId, "fallback", {
      ledger,
      richMarkdown: "| A | B |\n|---|---|\n| 1 | 2 |",
      maxRetries: 5,
    });

    expect(result).toEqual({ sent: false, uncertain: true });
    expect(api.sendRichMessage).toHaveBeenCalledTimes(1);
    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(ledger.chunks[0]?.status).toBe("uncertain");
  });

  it("treats rich 5xx responses as uncertain without a legacy resend", async () => {
    const api = fakeBotApi({
      sendRichMessage: vi.fn().mockRejectedValue(new SanitizedTelegramError({
        message: "Internal Server Error",
        errorCode: 500,
      })),
    });
    const ledger: DeliveryLedger = { chunks: [], uncertainChunks: [] };

    const result = await deliverFinalAnswer(api, chatId, "fallback", {
      ledger,
      richMarkdown: "| A | B |\n|---|---|\n| 1 | 2 |",
    });

    expect(result).toEqual({ sent: false, uncertain: true });
    expect(api.sendRichMessage).toHaveBeenCalledTimes(1);
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("retries rich delivery after 429 using retry_after", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const sendRichMessage = vi.fn()
      .mockRejectedValueOnce(new SanitizedTelegramError({
        message: "Too Many Requests",
        errorCode: 429,
        retryAfter: 2,
      }))
      .mockResolvedValueOnce({ message_id: 3, date: 1, chat: { id: 123, type: "private" } });
    const api = fakeBotApi({ sendRichMessage });
    const ledger: DeliveryLedger = { chunks: [], uncertainChunks: [] };

    const result = await deliverFinalAnswer(api, chatId, "fallback", {
      ledger,
      richMarkdown: "| A | B |\n|---|---|\n| 1 | 2 |",
      sleep,
    });

    expect(result).toEqual({ sent: true, uncertain: false });
    expect(sendRichMessage).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_000);
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("delivers a long answer in multiple chunks", async () => {
    const api = fakeBotApi();
    const longText = "word ".repeat(1500); // ~7500 chars -> 2 chunks
    const ledger: DeliveryLedger = { chunks: [], uncertainChunks: [] };
    const result = await deliverFinalAnswer(api, chatId, longText, { ledger, maxRetries: 2, retryDelayMs: 1 });
    expect(result.sent).toBe(true);
    expect(ledger.chunks.length).toBeGreaterThan(1);
    for (let i = 0; i < ledger.chunks.length; i++) {
      expect(ledger.chunks[i].chunkIndex).toBe(i);
    }
  });

  it("marks chunk as uncertain on ambiguous post-send failure", async () => {
    let callCount = 0;
    const api = fakeBotApi({
      sendMessage: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // First chunk succeeds
          return { message_id: 2, date: 1, chat: { id: 123, type: "private" } };
        }
        // Second chunk: ambiguous failure (network error, not 429)
        throw new Error("Connection reset");
      }),
    });
    const longText = "word ".repeat(1500);
    const ledger: DeliveryLedger = { chunks: [], uncertainChunks: [] };
    const result = await deliverFinalAnswer(api, chatId, longText, { ledger, maxRetries: 2, retryDelayMs: 1 });
    expect(result.uncertain).toBe(true);
    expect(ledger.uncertainChunks).toHaveLength(1);
  });

  it("recognizes a sanitized Bot API network failure as uncertain", async () => {
    const token = "123456:secret-token-value";
    const fetchMock = vi.fn().mockRejectedValue(
      new TypeError(`Network reset at https://api.telegram.org/bot${token}/sendMessage`),
    );
    const api = createBotApi(token, fetchMock as never);
    const ledger: DeliveryLedger = { chunks: [], uncertainChunks: [] };

    const result = await deliverFinalAnswer(api, chatId, "Hello", {
      ledger,
      maxRetries: 1,
    });

    expect(result).toEqual({ sent: false, uncertain: true });
    expect(ledger.chunks[0]?.status).toBe("uncertain");
    expect(JSON.stringify(ledger)).not.toContain(token);
  });

  it("stops all later chunks after the first uncertain outcome", async () => {
    const api = fakeBotApi({
      sendMessage: vi.fn().mockRejectedValue(new TypeError("network connection reset")),
    });
    const ledger: DeliveryLedger = { chunks: [], uncertainChunks: [] };

    const result = await deliverFinalAnswer(api, chatId, "word ".repeat(2_500), {
      ledger,
      maxRetries: 1,
    });

    expect(result.uncertain).toBe(true);
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(ledger.chunks).toHaveLength(1);
  });

  it("never retries an ambiguous send within the same delivery attempt", async () => {
    const api = fakeBotApi({
      sendMessage: vi.fn().mockRejectedValue(new TypeError("network connection reset")),
    });
    const ledger: DeliveryLedger = { chunks: [], uncertainChunks: [] };

    const result = await deliverFinalAnswer(api, chatId, "Hello", {
      ledger,
      maxRetries: 5,
      retryDelayMs: 1,
    });

    expect(result.uncertain).toBe(true);
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("retries on transient send errors (non-429)", async () => {
    let attempts = 0;
    const api = fakeBotApi({
      sendMessage: vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 3) throw new Error("transient error");
        return { message_id: 2, date: 1, chat: { id: 123, type: "private" } };
      }),
    });
    const ledger: DeliveryLedger = { chunks: [], uncertainChunks: [] };
    const result = await deliverFinalAnswer(api, chatId, "Hello", { ledger, maxRetries: 5 });
    expect(result.sent).toBe(true);
    expect(attempts).toBe(3);
  });

  it("gives up after max retries", async () => {
    const api = fakeBotApi({
      sendMessage: vi.fn().mockRejectedValue(new Error("persistent error")),
    });
    const ledger: DeliveryLedger = { chunks: [], uncertainChunks: [] };
    const result = await deliverFinalAnswer(api, chatId, "Hello", { ledger, maxRetries: 2 });
    expect(result.sent).toBe(false);
    expect(ledger.chunks[0].status).toBe("failed");
  });

  it("handles 429 with retry_after", async () => {
    let callCount = 0;
    const api = fakeBotApi({
      sendMessage: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          const err = new Error("Too Many Requests");
          (err as unknown as Record<string, unknown>).telegramRetryAfter = 1;
          throw err;
        }
        return { message_id: 2, date: 1, chat: { id: 123, type: "private" } };
      }),
    });
    const ledger: DeliveryLedger = { chunks: [], uncertainChunks: [] };
    const result = await deliverFinalAnswer(api, chatId, "Hello", { ledger });
    expect(result.sent).toBe(true);
    expect(callCount).toBe(2);
  });

  it("does not send empty messages", async () => {
    const api = fakeBotApi();
    const ledger: DeliveryLedger = { chunks: [], uncertainChunks: [] };
    const result = await deliverFinalAnswer(api, chatId, "", { ledger });
    expect(result.sent).toBe(false);
    expect(api.sendMessage).not.toHaveBeenCalled();
  });
});
