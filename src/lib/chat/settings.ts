import {
  isDynamicModelId,
  isSupportedModel,
} from "../config";

export type ChatSettings = {
  model: string | null;
  followsDefault: boolean;
};

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  model: null,
  followsDefault: true,
};

function isSelectableModelId(value: unknown): value is string {
  return typeof value === "string" && (isSupportedModel(value) || isDynamicModelId(value));
}

export function normalizeStoredChatSettings(value: unknown): ChatSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_CHAT_SETTINGS;
  }

  const stored = value as Record<string, unknown>;
  if (stored.followsDefault === true) {
    return DEFAULT_CHAT_SETTINGS;
  }
  if (stored.followsDefault === false && isSelectableModelId(stored.model)) {
    return { model: stored.model, followsDefault: false };
  }

  // Before the global-default feature, Flash was written to storage even when
  // the user had never selected a model. Treat only that legacy value as the
  // inherited default; every other valid legacy model remains an explicit choice.
  if (stored.model === "deepseek-v4-flash") {
    return DEFAULT_CHAT_SETTINGS;
  }
  return {
    model: isSelectableModelId(stored.model) ? stored.model : null,
    followsDefault: !isSelectableModelId(stored.model),
  };
}
