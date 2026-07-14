import {
  MAX_PROVIDER_KEY_CHARS,
  getModelDefinition,
  type ChatModel,
  type ModelProvider,
} from "../config";
import { resolveDeepSeekApiKey } from "../deepseek-key";
import { UserVisibleError } from "../errors";

function normalizedKey(value: string | undefined): string | undefined {
  const key = value?.trim();
  return key ? key : undefined;
}

function validateKey(value: string, providerLabel: string): string {
  if (value.length > MAX_PROVIDER_KEY_CHARS) {
    throw new UserVisibleError(`${providerLabel} API Key ist zu lang.`, 400);
  }
  return value;
}

function resolveZaiApiKey(): string {
  const key = normalizedKey(process.env.ZAI_API_KEY);
  if (!key) {
    throw new UserVisibleError(
      "Serverseitige Z.AI-Konfiguration fehlt. Bitte Administrator kontaktieren.",
      503,
    );
  }
  return validateKey(key, "Z.AI");
}

export function resolveProviderApiKey(provider: ModelProvider): string {
  return provider === "deepseek" ? resolveDeepSeekApiKey() : resolveZaiApiKey();
}

export function isProviderConfigured(provider: ModelProvider): boolean {
  try {
    resolveProviderApiKey(provider);
    return true;
  } catch {
    return false;
  }
}

export function isModelProviderConfigured(model: ChatModel): boolean {
  return isProviderConfigured(getModelDefinition(model).provider);
}
