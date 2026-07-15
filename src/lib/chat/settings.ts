import {
  DEFAULT_MODEL,
  isDynamicModelId,
  isSupportedModel,
} from "../config";

export type ChatSettings = {
  model: string;
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
      typeof stored.model === "string" && (isSupportedModel(stored.model) || isDynamicModelId(stored.model))
        ? stored.model
        : DEFAULT_MODEL,
  };
}
