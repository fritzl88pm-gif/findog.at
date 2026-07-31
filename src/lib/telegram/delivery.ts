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
  const chunks = chunkTelegramMessage(text);

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

    let lastError: unknown;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await api.sendMessage({ chat_id: chatId, text: content });
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
          await sleep(retryAfter * 1000);
        } else if (attempt < maxRetries - 1) {
          // Transient error — exponential backoff
          await sleep(retryDelayMs * Math.pow(2, attempt));
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
