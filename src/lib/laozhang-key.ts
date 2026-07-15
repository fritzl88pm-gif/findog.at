import { MAX_PROVIDER_KEY_CHARS } from "./config";
import { UserVisibleError } from "./errors";

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveLaoZhangApiKey(): string {
  const key = trimOptional(process.env.LAOZHANG_API_KEY);
  if (!key) {
    throw new UserVisibleError(
      "Serverseitige LaoZhang-Konfiguration fehlt. Bitte Administrator kontaktieren.",
      503,
    );
  }
  if (key.length > MAX_PROVIDER_KEY_CHARS) {
    throw new UserVisibleError("LaoZhang API Key ist zu lang.", 400);
  }
  return key;
}

export function isLaoZhangApiKeyConfigured(): boolean {
  try {
    resolveLaoZhangApiKey();
    return true;
  } catch {
    return false;
  }
}
