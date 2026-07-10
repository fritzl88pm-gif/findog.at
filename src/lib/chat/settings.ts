import {
  DEFAULT_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  isSupportedModel,
  type ChatModel,
} from "../config";

export type ChatSettings = {
  systemPrompt: string;
  model: ChatModel;
};

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  model: DEFAULT_MODEL,
};

export function normalizeStoredChatSettings(value: unknown): ChatSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_CHAT_SETTINGS;
  }

  const stored = value as Record<string, unknown>;
  return {
    systemPrompt:
      typeof stored.systemPrompt === "string" && stored.systemPrompt.trim()
        ? stored.systemPrompt
        : DEFAULT_SYSTEM_PROMPT,
    model:
      typeof stored.model === "string" && isSupportedModel(stored.model)
        ? stored.model
        : DEFAULT_MODEL,
  };
}
