import { MAX_DEEPSEEK_KEY_CHARS } from "./config";
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

function getServerDeepSeekProKey(): string {
  const key = trimOptional(process.env.DEEPSEEK_API_KEY) ?? trimOptional(process.env.GLOBAL_DEEPSEEK_API_KEY);
  if (!key) {
    throw new UserVisibleError(
      "Serverseitige DeepSeek Pro Konfiguration fehlt. Bitte Administrator kontaktieren.",
      503,
    );
  }

  return validateKeyLength(key, "DeepSeek Pro API Key");
}

export function resolveDeepSeekApiKey(): string {
  return getServerDeepSeekProKey();
}
