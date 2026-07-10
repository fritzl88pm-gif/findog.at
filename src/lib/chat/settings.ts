import {
  DEFAULT_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  isSupportedModel,
  type ChatModel,
} from "../config";

export type ChatSettings = {
  systemPrompt: string;
  model: ChatModel;
  usesGlobalDefault: boolean;
};

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  systemPrompt: "",
  model: DEFAULT_MODEL,
  usesGlobalDefault: true,
};

export function normalizeStoredChatSettings(value: unknown): ChatSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_CHAT_SETTINGS;
  }

  const stored = value as Record<string, unknown>;
  const hasStoredPrompt = typeof stored.systemPrompt === "string" && Boolean(stored.systemPrompt.trim());
  const usesGlobalDefault = stored.usesGlobalDefault === true
    || !hasStoredPrompt
    || (stored.usesGlobalDefault !== false && stored.systemPrompt === DEFAULT_SYSTEM_PROMPT);

  return {
    systemPrompt: usesGlobalDefault
      ? ""
      : (hasStoredPrompt ? stored.systemPrompt as string : ""),
    model:
      typeof stored.model === "string" && isSupportedModel(stored.model)
        ? stored.model
        : DEFAULT_MODEL,
    usesGlobalDefault,
  };
}

export function displayedSystemPrompt(settings: ChatSettings, globalSystemPrompt: string): string {
  return settings.usesGlobalDefault ? globalSystemPrompt : settings.systemPrompt;
}

export function editPersonalSystemPrompt(
  settings: ChatSettings,
  systemPrompt: string,
): ChatSettings {
  return {
    ...settings,
    systemPrompt,
    usesGlobalDefault: false,
  };
}

export function resetToGlobalSystemPrompt(settings: ChatSettings): ChatSettings {
  return {
    ...settings,
    systemPrompt: "",
    usesGlobalDefault: true,
  };
}

export function systemPromptForChatRequest(settings: ChatSettings): string | undefined {
  if (settings.usesGlobalDefault) {
    return undefined;
  }

  return settings.systemPrompt.trim() || undefined;
}
