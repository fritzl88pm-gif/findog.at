import type { BotApi, TelegramMessageResult } from "./bot-api";
import { chunkTelegramMessage } from "./text";

// ── Types ───────────────────────────────────────────────────────────────────

export interface DeliveryLedgerEntry {
  chunkIndex: number;
  content: string;
  status: "pending" | "sent" | "uncertain" | "failed";
  messageId?: number;
  error?: string;
}

export interface DeliveryLedger {
  chunks: DeliveryLedgerEntry[];
  uncertainChunks: DeliveryLedgerEntry[];
}

export interface DeliveryOptions {
  /** Ledger to record delivery outcomes. */
  ledger: DeliveryLedger;
  /** Maximum send retries per chunk. */
  maxRetries?: number;
  /** Per-chunk retry delay base in ms. */
  retryDelayMs?: number;
  /** Raw Markdown eligible for a single native Rich Message attempt. */
  richMarkdown?: string;
  /** Overridable sleep for deterministic retry tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface DeliveryResult {
  sent: boolean;
  uncertain: boolean;
}

// ── Constants ───────────────────────────────────────────────────────────────

const TYPING_ACTION = "typing";
const DRAFT_MAX_LENGTH = 50;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Send a "typing" chat action. Swallows all errors silently.
 */
export async function sendTypingIndicator(
  api: BotApi,
  chatId: number,
): Promise<void> {
  try {
    await api.sendChatAction({ chat_id: chatId, action: TYPING_ACTION });
  } catch {
    // Best-effort — never throw
  }
}

/**
 * Send a draft preview message. Returns the message result or null on failure.
 */
export async function refreshDraftPreview(
  api: BotApi,
  chatId: number,
  text: string,
): Promise<TelegramMessageResult | null> {
  try {
    const truncated = text.slice(0, DRAFT_MAX_LENGTH);
    return await api.sendMessageDraft({ chat_id: chatId, text: truncated });
  } catch {
    return null;
  }
}

/**
 * Deliver the final answer as one or more Telegram messages.
 * Chunks the text, sends each chunk, retries on transient errors,
 * honors 429 retry_after, and records ambiguous failures.
 */
export async function deliverFinalAnswer(
  api: BotApi,
  chatId: number,
  text: string,
  options: DeliveryOptions,
): Promise<DeliveryResult> {
  const { ledger, maxRetries = 5, retryDelayMs = 1000 } = options;
  const sleepFn = options.sleep ?? sleep;
  const chunks = chunkTelegramMessage(text);
  const richMarkdown = chunks.length === 1 ? options.richMarkdown : undefined;

  if (chunks.length === 0) {
    return { sent: false, uncertain: false };
  }

  let anySent = false;
  let anyUncertain = false;

  for (let i = 0; i < chunks.length; i++) {
    const content = chunks[i];
    if (!content) continue;

    const entry: DeliveryLedgerEntry = {
      chunkIndex: i,
      content,
      status: "pending",
    };
    ledger.chunks.push(entry);

    if (i === 0 && richMarkdown) {
      let richError: unknown;
      let fallbackToLegacy = false;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const result = await api.sendRichMessage({
            chat_id: chatId,
            rich_message: { markdown: richMarkdown },
          });
          entry.status = "sent";
          entry.messageId = result.message_id;
          anySent = true;
          richError = null;
          break;
        } catch (err) {
          richError = err;
          if (isAmbiguousError(err) || isServerError(err)) {
            entry.status = "uncertain";
            ledger.uncertainChunks.push(entry);
            return { sent: anySent, uncertain: true };
          }
          if (isPermanentRichRejection(err)) {
            fallbackToLegacy = true;
            richError = null;
            break;
          }

          const retryAfter = extractRetryAfter(err);
          if (retryAfter !== undefined) {
            await sleepFn(retryAfter * 1000);
          } else if (attempt < maxRetries - 1) {
            await sleepFn(retryDelayMs * Math.pow(2, attempt));
          }
        }
      }

      if (entry.status === "sent") continue;
      if (richError || !fallbackToLegacy) {
        entry.status = "failed";
        entry.error = String(richError ?? "Telegram Rich Message delivery failed");
        continue;
      }
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await api.sendMessage({ chat_id: chatId, text: content, parse_mode: "HTML" });
        entry.status = "sent";
        entry.messageId = result.message_id;
        anySent = true;
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        if (isAmbiguousError(err)) {
          entry.status = "uncertain";
          ledger.uncertainChunks.push(entry);
          return { sent: anySent, uncertain: true };
        }
        const retryAfter = extractRetryAfter(err);

        if (retryAfter !== undefined) {
          // 429 with retry_after — wait and retry
          await sleepFn(retryAfter * 1000);
        } else if (attempt < maxRetries - 1) {
          // Transient error — exponential backoff
          await sleepFn(retryDelayMs * Math.pow(2, attempt));
        }
        // If last attempt, don't sleep
      }
    }

    if (lastError) {
      // Ambiguous: we don't know if Telegram received the request
      // If we sent a request to Telegram and got a connection error,
      // it's uncertain. If it was a clear API error (e.g., 400), it's failed.
      if (isAmbiguousError(lastError)) {
        entry.status = "uncertain";
        ledger.uncertainChunks.push(entry);
        anyUncertain = true;
        return { sent: anySent, uncertain: true };
      } else {
        entry.status = "failed";
        entry.error = String(lastError);
      }
    }
  }

  return {
    sent: anySent,
    uncertain: anyUncertain,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractErrorCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const errorCode = (error as Record<string, unknown>).telegramErrorCode;
  return typeof errorCode === "number" ? errorCode : undefined;
}

function isPermanentRichRejection(error: unknown): boolean {
  const errorCode = extractErrorCode(error);
  return errorCode === 400 || errorCode === 404;
}

function isServerError(error: unknown): boolean {
  const errorCode = extractErrorCode(error);
  return errorCode !== undefined && errorCode >= 500 && errorCode <= 599;
}

function extractRetryAfter(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const err = error as Record<string, unknown>;
  const retryAfter = err.telegramRetryAfter;
  if (typeof retryAfter === "number" && retryAfter > 0 && retryAfter <= 3600) {
    return retryAfter;
  }
  return undefined;
}

function isAmbiguousError(error: unknown): boolean {
  // Ambiguous: network errors where we can't be sure if the message was sent
  if (error instanceof TypeError) return true; // fetch network errors
  if (error instanceof Error) {
    if ((error as Error & { telegramDeliveryUncertain?: boolean }).telegramDeliveryUncertain === true) {
      return true;
    }
    const msg = error.message.toLowerCase();
    if (
      msg.includes("connection") ||
      msg.includes("network") ||
      msg.includes("timeout") ||
      msg.includes("reset") ||
      msg.includes("econnrefused") ||
      msg.includes("enotfound") ||
      msg.includes("abort")
    ) {
      return true;
    }
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
