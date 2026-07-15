import {
  DEEPSEEK_BASE_URL,
  LAOZHANG_BASE_URL,
  ZAI_CODING_BASE_URL,
  getModelDefinition,
  isReasoningSettingForModel,
  type ChatModel,
  type ModelProvider,
  type ReasoningSetting,
} from "../config";
import { UserVisibleError } from "../errors";
import {
  isModelProviderConfigured,
  isProviderConfigured,
  resolveProviderApiKey,
} from "./credentials";
import type { DynamicModelSetting } from "../model-settings";

export type LlmRuntime = {
  model: string;
  provider: ModelProvider;
  upstreamModel: string;
  baseUrl: string;
  apiKey: string;
  reasoning: ReasoningSetting;
};

function providerBaseUrl(provider: ModelProvider): string {
  switch (provider) {
    case "deepseek":
      return DEEPSEEK_BASE_URL;
    case "zai":
      return ZAI_CODING_BASE_URL;
    case "laozhang":
      return LAOZHANG_BASE_URL;
  }
}

function validatedReasoning(
  model: ChatModel,
  value: ReasoningSetting | undefined,
): ReasoningSetting {
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

export function resolveLlmRuntime(options: {
  model: ChatModel;
  reasoning?: ReasoningSetting;
}): LlmRuntime {
  const definition = getModelDefinition(options.model);
  const reasoning = validatedReasoning(definition.id, options.reasoning);
  const apiKey = resolveProviderApiKey(definition.provider);
  return {
    model: definition.id,
    provider: definition.provider,
    upstreamModel: definition.upstreamModel,
    baseUrl: providerBaseUrl(definition.provider),
    apiKey,
    reasoning,
  };
}

export function resolveDynamicLlmRuntime(setting: DynamicModelSetting): LlmRuntime {
  const apiKey = resolveProviderApiKey(setting.provider);
  return {
    model: setting.id,
    provider: setting.provider,
    upstreamModel: setting.upstreamModel,
    baseUrl: providerBaseUrl(setting.provider),
    apiKey,
    reasoning: "disabled",
  };
}

export function withRuntimeReasoning(
  runtime: LlmRuntime,
  reasoning: ReasoningSetting,
): LlmRuntime {
  return {
    ...runtime,
    reasoning: validatedReasoning(runtime.model as ChatModel, reasoning),
  };
}

export { isModelProviderConfigured, isProviderConfigured };
