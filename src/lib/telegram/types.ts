/** Status of a Telegram bot integration */
export const TELEGRAM_INTEGRATION_STATUSES = [
  "awaiting_pairing",
  "active",
  "disconnecting",
  "error",
] as const;
export type TelegramIntegrationStatus = (typeof TELEGRAM_INTEGRATION_STATUSES)[number];

/** Update processing state machine states */
export const TELEGRAM_UPDATE_STATES = [
  "pending",
  "processing",
  "completed",
  "retry",
  "failed",
  "cancelled",
] as const;
export type TelegramUpdateState = (typeof TELEGRAM_UPDATE_STATES)[number];

/** Delivery state for a delivery ledger entry */
export const TELEGRAM_DELIVERY_STATES = [
  "pending",
  "sent",
  "uncertain",
  "failed",
] as const;
export type TelegramDeliveryState = (typeof TELEGRAM_DELIVERY_STATES)[number];

/** Telegram Bot API response shape */
export interface TelegramApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: {
    retry_after?: number;
    migrate_to_chat_id?: number;
  };
}

/** Telegram User object (subset) */
export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

/** getMe result */
export interface TelegramBotInfo {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
  supports_inline_queries?: boolean;
}

/** getWebhookInfo result */
export interface TelegramWebhookInfo {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  ip_address?: string;
  last_error_date?: number;
  last_error_message?: string;
  last_synchronization_error_date?: number;
  max_connections?: number;
  allowed_updates?: string[];
}

/** Telegram update (subset relevant for this bot) */
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  my_chat_member?: TelegramChatMemberUpdate;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  entities?: TelegramMessageEntity[];
}

export interface TelegramMessageEntity {
  type: string;
  offset: number;
  length: number;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramChatMemberUpdate {
  chat: TelegramChat;
  from: TelegramUser;
  date: number;
  old_chat_member: TelegramChatMember;
  new_chat_member: TelegramChatMember;
}

export interface TelegramChatMember {
  status: string;
  user: TelegramUser;
}

/** Bot command definition */
export interface TelegramBotCommand {
  command: string;
  description: string;
}

/** Serialized encrypted token */
export interface EncryptedToken {
  ciphertext: string;
}

/** Sanitized error for persistence */
export interface SanitizedTelegramError {
  error_code?: number;
  description?: string;
  retry_after?: number;
}
