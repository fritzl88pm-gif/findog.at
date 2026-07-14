export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const ZAI_CODING_BASE_URL = "https://api.z.ai/api/coding/paas/v4";

export const MODEL_IDS = [
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "glm-5.2",
  "glm-5-turbo",
] as const;

export type ChatModel = (typeof MODEL_IDS)[number];
export type ModelProvider = "deepseek" | "zai";
export type ReasoningSetting = "disabled" | "enabled" | "high" | "max";

export type ModelDefinition = {
  id: ChatModel;
  label: string;
  description: string;
  provider: ModelProvider;
  upstreamModel: string;
  alwaysEnabled: boolean;
  reasoningOptions: readonly ReasoningSetting[];
  defaultReasoning: ReasoningSetting;
};

export const MODEL_CATALOG: Readonly<Record<ChatModel, ModelDefinition>> = {
  "deepseek-v4-flash": {
    id: "deepseek-v4-flash",
    label: "DeepSeek v4 Flash",
    description: "Schnelles Standardmodell",
    provider: "deepseek",
    upstreamModel: "deepseek-v4-flash",
    alwaysEnabled: true,
    reasoningOptions: ["disabled", "high", "max"],
    defaultReasoning: "disabled",
  },
  "deepseek-v4-pro": {
    id: "deepseek-v4-pro",
    label: "DeepSeek v4 Pro",
    description: "Leistungsstarkes Modell für komplexe Recherche",
    provider: "deepseek",
    upstreamModel: "deepseek-v4-pro",
    alwaysEnabled: false,
    reasoningOptions: ["disabled", "high", "max"],
    defaultReasoning: "high",
  },
  "glm-5.2": {
    id: "glm-5.2",
    label: "GLM-5.2",
    description: "Z.AI Coding-Modell für komplexe Aufgaben",
    provider: "zai",
    upstreamModel: "glm-5.2",
    alwaysEnabled: false,
    reasoningOptions: ["disabled", "high", "max"],
    defaultReasoning: "max",
  },
  "glm-5-turbo": {
    id: "glm-5-turbo",
    label: "GLM-5-Turbo",
    description: "Schnelles Z.AI Coding-Modell",
    provider: "zai",
    upstreamModel: "glm-5-turbo",
    alwaysEnabled: false,
    reasoningOptions: ["disabled", "enabled"],
    defaultReasoning: "enabled",
  },
};

export const DEFAULT_MODEL: ChatModel = "deepseek-v4-flash";
export const AVAILABLE_MODELS = MODEL_IDS;
export const MAX_REQUEST_BYTES = 400_000;
export const MAX_PDF_UPLOAD_BYTES = 50_000_000;
export const MAX_IMAGE_UPLOAD_BYTES = 5_000_000;
export const MAX_PDF_UPLOADS = 5;
export const MAX_IMAGE_UPLOADS = 5;
export const MAX_MULTIPART_REQUEST_BYTES =
  MAX_REQUEST_BYTES + MAX_PDF_UPLOAD_BYTES * MAX_PDF_UPLOADS + MAX_IMAGE_UPLOAD_BYTES * MAX_IMAGE_UPLOADS;
export const MAX_MESSAGES = 20;
export const MAX_PROVIDER_KEY_CHARS = 512;
export const MAX_DEEPSEEK_KEY_CHARS = MAX_PROVIDER_KEY_CHARS;
export const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
export const RATE_LIMIT_MAX_REQUESTS = 20;

export function isSupportedModel(model: string): model is ChatModel {
  return MODEL_IDS.includes(model as ChatModel);
}

export function getModelDefinition(model: ChatModel): ModelDefinition {
  return MODEL_CATALOG[model];
}

export function isReasoningSettingForModel(
  model: ChatModel,
  reasoning: string,
): reasoning is ReasoningSetting {
  return MODEL_CATALOG[model].reasoningOptions.includes(reasoning as ReasoningSetting);
}
