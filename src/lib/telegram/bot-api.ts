import type {
  TelegramApiResponse,
  TelegramBotCommand,
  TelegramBotInfo,
  TelegramChat,
  TelegramUser,
  TelegramWebhookInfo,
} from "./types";

const TELEGRAM_BASE = "https://api.telegram.org/bot";

export interface BotApiOptions {
  signal?: AbortSignal;
}

export interface SetWebhookParams {
  url: string;
  secret_token?: string;
  allowed_updates?: string[];
  drop_pending_updates?: boolean;
  max_connections?: number;
}

export class SanitizedTelegramError extends Error {
  readonly error_code?: number;
  readonly description?: string;
  readonly retry_after?: number;
  readonly telegramErrorCode?: number;
  readonly telegramDescription?: string;
  readonly telegramRetryAfter?: number;
  readonly telegramDeliveryUncertain: boolean;

  constructor(params: {
    message: string;
    errorCode?: number;
    description?: string;
    retryAfter?: number;
    deliveryUncertain?: boolean;
  }) {
    super(params.message);
    this.name = "SanitizedTelegramError";
    this.telegramDeliveryUncertain = params.deliveryUncertain === true;
    if (params.errorCode !== undefined) {
      this.error_code = params.errorCode;
      this.telegramErrorCode = params.errorCode;
    }
    if (params.description !== undefined) {
      this.description = params.description;
      this.telegramDescription = params.description;
    }
    if (params.retryAfter !== undefined) {
      this.retry_after = params.retryAfter;
      this.telegramRetryAfter = params.retryAfter;
    }
  }
}

export class TelegramFileTooLargeError extends Error {
  constructor(message = "Telegram file exceeds configured size limit") {
    super(message);
    this.name = "TelegramFileTooLargeError";
  }
}

type FetchFn = (url: string | URL, init?: RequestInit) => Promise<Response>;

export interface SendMessageParams {
  chat_id: number;
  text: string;
  parse_mode?: string;
  link_preview_options?: { is_disabled?: boolean };
}

export interface SendRichMessageParams {
  chat_id: number;
  rich_message: {
    markdown: string;
  };
}

export interface SendMessageDraftParams {
  chat_id: number;
  text: string;
  reply_to_message_id?: number;
}

export interface SendChatActionParams {
  chat_id: number;
  action: string;
}

export interface TelegramMessageResult {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
}

export interface BotApi {
  getMe(options?: BotApiOptions): Promise<TelegramBotInfo>;
  getWebhookInfo(options?: BotApiOptions): Promise<TelegramWebhookInfo>;
  setWebhook(params: SetWebhookParams, options?: BotApiOptions): Promise<boolean>;
  deleteWebhook(dropPendingUpdates?: boolean, options?: BotApiOptions): Promise<boolean>;
  setMyCommands(commands: TelegramBotCommand[], options?: BotApiOptions): Promise<boolean>;
  deleteMyCommands(options?: BotApiOptions): Promise<boolean>;
  sendMessage(params: SendMessageParams, options?: BotApiOptions): Promise<TelegramMessageResult>;
  sendRichMessage(params: SendRichMessageParams, options?: BotApiOptions): Promise<TelegramMessageResult>;
  sendMessageDraft(params: SendMessageDraftParams, options?: BotApiOptions): Promise<TelegramMessageResult>;
  sendChatAction(params: SendChatActionParams, options?: BotApiOptions): Promise<boolean>;
  getFile(params: GetFileParams, options?: BotApiOptions): Promise<TelegramFileInfo>;
  downloadFile(filePath: string, params: DownloadFileParams): Promise<Uint8Array>;
}

class BotApiImpl implements BotApi {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchFn: FetchFn;

  constructor(token: string, fetchFn: FetchFn = globalThis.fetch.bind(globalThis)) {
    this.token = token;
    this.baseUrl = `${TELEGRAM_BASE}${token}`;
    this.fetchFn = fetchFn;
  }

  async getMe(options?: BotApiOptions): Promise<TelegramBotInfo> {
    return this.post<TelegramBotInfo>("getMe", {}, options);
  }

  async getWebhookInfo(options?: BotApiOptions): Promise<TelegramWebhookInfo> {
    return this.post<TelegramWebhookInfo>("getWebhookInfo", {}, options);
  }

  async setWebhook(params: SetWebhookParams, options?: BotApiOptions): Promise<boolean> {
    const body: Record<string, unknown> = { url: params.url };
    if (params.secret_token) body.secret_token = params.secret_token;
    if (params.allowed_updates) body.allowed_updates = params.allowed_updates;
    if (params.drop_pending_updates !== undefined) body.drop_pending_updates = params.drop_pending_updates;
    if (params.max_connections !== undefined) body.max_connections = params.max_connections;
    return this.post<boolean>("setWebhook", body, options);
  }

  async deleteWebhook(dropPendingUpdates?: boolean, options?: BotApiOptions): Promise<boolean> {
    const body: Record<string, unknown> = {};
    if (dropPendingUpdates) body.drop_pending_updates = true;
    return this.post<boolean>("deleteWebhook", body, options);
  }

  async setMyCommands(commands: TelegramBotCommand[], options?: BotApiOptions): Promise<boolean> {
    return this.post<boolean>("setMyCommands", { commands }, options);
  }

  async deleteMyCommands(options?: BotApiOptions): Promise<boolean> {
    return this.post<boolean>("deleteMyCommands", {}, options);
  }

  async sendMessage(params: SendMessageParams, options?: BotApiOptions): Promise<TelegramMessageResult> {
    return this.post<TelegramMessageResult>("sendMessage", params as unknown as Record<string, unknown>, options);
  }

  async sendRichMessage(params: SendRichMessageParams, options?: BotApiOptions): Promise<TelegramMessageResult> {
    return this.post<TelegramMessageResult>("sendRichMessage", params as unknown as Record<string, unknown>, options);
  }

  async sendMessageDraft(params: SendMessageDraftParams, options?: BotApiOptions): Promise<TelegramMessageResult> {
    return this.post<TelegramMessageResult>("sendMessageDraft", params as unknown as Record<string, unknown>, options);
  }

  async sendChatAction(params: SendChatActionParams, options?: BotApiOptions): Promise<boolean> {
    return this.post<boolean>("sendChatAction", params as unknown as Record<string, unknown>, options);
  }

  async getFile(params: GetFileParams, options?: BotApiOptions): Promise<TelegramFileInfo> {
    return this.post<TelegramFileInfo>("getFile", params as unknown as Record<string, unknown>, options);
  }

  async downloadFile(filePath: string, params: DownloadFileParams): Promise<Uint8Array> {
    const url = `https://api.telegram.org/file/bot${this.token}/${filePath}`;
    let response: Response;
    try {
      response = await this.fetchFn(url, { signal: params.signal });
    } catch (err) {
      throw sanitizeTelegramError(this.token, err);
    }

    // ── reject non-2xx responses before consuming the body ────────────
    if (!response.ok) {
      throw new SanitizedTelegramError({
        message: `Telegram file download failed with status ${response.status}`,
        errorCode: response.status,
        description: response.statusText,
      });
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      const declared = Number(contentLength);
      if (Number.isFinite(declared) && declared > params.maxBytes) {
        throw new TelegramFileTooLargeError();
      }
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new SanitizedTelegramError({
        message: "Telegram API returned no body",
        deliveryUncertain: true,
      });
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > params.maxBytes) {
          await reader.cancel();
          throw new TelegramFileTooLargeError();
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof TelegramFileTooLargeError) throw error;
      throw sanitizeTelegramError(this.token, error);
    } finally {
      reader.releaseLock();
    }

    const result = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }

  private async post<T>(method: string, body: Record<string, unknown>, options?: BotApiOptions): Promise<T> {
    const url = `${this.baseUrl}/${method}`;
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: options?.signal,
      });
    } catch (err) {
      throw sanitizeTelegramError(this.token, err);
    }

    let json: TelegramApiResponse<T>;
    try {
      json = (await response.json()) as TelegramApiResponse<T>;
    } catch {
      throw new SanitizedTelegramError({
        message: "Telegram API returned non-JSON response",
        deliveryUncertain: true,
      });
    }

    if (!json.ok) {
      const msg = json.description ?? (json.error_code ? String(json.error_code) : "Telegram API error");
      throw new SanitizedTelegramError({
        message: msg,
        errorCode: json.error_code,
        description: json.description,
        retryAfter: json.parameters?.retry_after,
      });
    }

    return json.result as T;
  }
}

export function createBotApi(token: string, fetchFn?: FetchFn): BotApi {
  return new BotApiImpl(token, fetchFn);
}


/** getFile result */
export interface TelegramFileInfo {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

/** getFile params */
export interface GetFileParams {
  file_id: string;
}

/** downloadFile params */
export interface DownloadFileParams {
  maxBytes: number;
  signal?: AbortSignal;
}

/**
 * Sanitize any error so the Telegram bot token and full Bot API URL
 * can never escape in error messages.
 */
export function sanitizeTelegramError(token: string, error: unknown): SanitizedTelegramError {
  const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tokenPattern = new RegExp(escapedToken, "g");
  const baseUrlPattern = new RegExp(`https://api\\.telegram\\.org/bot${escapedToken}`, "g");
  const fileUrlPattern = new RegExp(`https://api\\.telegram\\.org/file/bot${escapedToken}`, "g");

  let message = "Telegram API error";
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  }

  message = message.replace(fileUrlPattern, "[redacted-telegram-file-url]");
  message = message.replace(baseUrlPattern, "[redacted-telegram-url]");
  message = message.replace(tokenPattern, "[redacted]");

  let error_code: number | undefined;
  let description: string | undefined;
  let retry_after: number | undefined;

  if (error && typeof error === "object") {
    const structured = error as Record<string, unknown>;
    const structuredCode = structured.error_code ?? structured.telegramErrorCode;
    const structuredDescription = structured.description ?? structured.telegramDescription;
    const structuredRetryAfter = structured.retry_after ?? structured.telegramRetryAfter;
    if (typeof structuredCode === "number") error_code = structuredCode;
    if (typeof structuredDescription === "string") description = structuredDescription;
    if (typeof structuredRetryAfter === "number") retry_after = structuredRetryAfter;
  }

  try {
    const jsonMatch = message.match(/\{[\s\S]*"ok"\s*:\s*false[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as TelegramApiResponse;
      error_code = parsed.error_code;
      description = parsed.description;
      retry_after = parsed.parameters?.retry_after;
      message = message.replace(
        jsonMatch[0],
        `Telegram error ${error_code ?? ""}: ${description ?? ""}`.trim(),
      );
    }
  } catch {
    // Not JSON, keep the message as-is
  }

  const lowerMessage = message.toLowerCase();
  const deliveryUncertain = error instanceof TypeError
    || (error instanceof SanitizedTelegramError && error.telegramDeliveryUncertain)
    || lowerMessage.includes("connection")
    || lowerMessage.includes("network")
    || lowerMessage.includes("timeout")
    || lowerMessage.includes("reset")
    || lowerMessage.includes("econnrefused")
    || lowerMessage.includes("enotfound")
    || lowerMessage.includes("abort")
    || lowerMessage.includes("fetch failed");

  return new SanitizedTelegramError({
    message,
    errorCode: error_code,
    description,
    retryAfter: retry_after,
    deliveryUncertain,
  });
}
