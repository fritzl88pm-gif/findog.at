import {
  DEFAULT_MODEL,
  isSupportedModel,
  type ChatModel,
} from "../config";

export type ChatSettings = {
  model: ChatModel;
};

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  model: DEFAULT_MODEL,
};

export function normalizeStoredChatSettings(value: unknown): ChatSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_CHAT_SETTINGS;
  }

  const stored = value as Record<string, unknown>;
  return {
    model:
      typeof stored.model === "string" && isSupportedModel(stored.model)
        ? stored.model
        : DEFAULT_MODEL,
  };
}
