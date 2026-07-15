import {
  DEEPSEEK_BASE_URL,
  ZAI_CODING_BASE_URL,
  getModelDefinition,
  isReasoningSettingForModel,
  type ChatModel,
  type ModelProvider,
  type ReasoningSetting,
} from "../config";
import { UserVisibleError } from "../errors";
import { decryptOpenAICompatibleApiKey } from "../openai-compatible-credentials";
import type { DynamicModelSetting } from "../model-settings";
import {
  isModelProviderConfigured,
  isProviderConfigured,
  resolveProviderApiKey,
} from "./credentials";

export type LlmRuntime = {
  model: string;
  provider: ModelProvider;
  upstreamModel: string;
  baseUrl: string;
  apiKey: string;
  reasoning: ReasoningSetting;
};

function providerBaseUrl(provider: "deepseek" | "zai"): string {
  return provider === "deepseek" ? DEEPSEEK_BASE_URL : ZAI_CODING_BASE_URL;
}

function validatedReasoning(model: ChatModel, value: ReasoningSetting | undefined): ReasoningSetting {
  const definition = getModelDefinition(model);
  const reasoning = value ?? definition.defaultReasoning;
  if (!isReasoningSettingForModel(model, reasoning)) {
    throw new UserVisibleError(
      `Die Reasoning-Einstellung „${reasoning}“ wird von ${definition.label} nicht unterstützt.`,
      400,
    );
  }
  return reasoning;
}

export function resolveLlmRuntime(options: { model: ChatModel; reasoning?: ReasoningSetting }): LlmRuntime {
  const definition = getModelDefinition(options.model);
  return {
    model: definition.id,
    provider: definition.provider,
    upstreamModel: definition.upstreamModel,
    baseUrl: providerBaseUrl(definition.provider),
    apiKey: resolveProviderApiKey(definition.provider),
    reasoning: validatedReasoning(definition.id, options.reasoning),
  };
}

export function resolveDynamicLlmRuntime(setting: DynamicModelSetting): LlmRuntime {
  return {
    model: setting.id,
    provider: "openai_compatible",
    upstreamModel: setting.upstreamModel,
    baseUrl: setting.baseUrl,
    apiKey: decryptOpenAICompatibleApiKey(setting.apiKeyCiphertext),
    reasoning: "disabled",
  };
}

export function withRuntimeReasoning(runtime: LlmRuntime, reasoning: ReasoningSetting): LlmRuntime {
  return { ...runtime, reasoning: validatedReasoning(runtime.model as ChatModel, reasoning) };
}

export { isModelProviderConfigured, isProviderConfigured };
