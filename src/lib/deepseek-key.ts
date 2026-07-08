import { MAX_DEEPSEEK_KEY_CHARS, type ChatModel } from "./config";
import { UserVisibleError } from "./errors";

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function validateKeyLength(value: string, label: string): string {
  if (value.length > MAX_DEEPSEEK_KEY_CHARS) {
    throw new UserVisibleError(`${label} ist zu lang.`, 400);
  }

  return value;
}

function getServerDeepSeekFlashKey(): string {
  const key = trimOptional(process.env.DEEPSEEK_API_KEY) ?? trimOptional(process.env.GLOBAL_DEEPSEEK_API_KEY);
  if (!key) {
    throw new UserVisibleError(
      "Serverseitige DeepSeek Flash Konfiguration fehlt. Bitte Administrator kontaktieren.",
      503,
    );
  }

  return validateKeyLength(key, "DeepSeek Flash API Key");
}

export function resolveDeepSeekApiKey(options: {
  model: ChatModel;
  userApiKey?: string;
}): string {
  if (options.model === "deepseek-v4-flash") {
    return getServerDeepSeekFlashKey();
  }

  const userApiKey = trimOptional(options.userApiKey);
  if (!userApiKey) {
    throw new UserVisibleError(
      "DeepSeek Pro benötigt deinen eigenen API Key. Bitte in den Einstellungen eintragen.",
      400,
    );
  }

  return validateKeyLength(userApiKey, "DeepSeek Pro API Key");
}
