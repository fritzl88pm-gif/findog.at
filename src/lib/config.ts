import { DEFAULT_SYSTEM_PROMPT } from "./default-system-prompt";

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const BFG_MCP_ENDPOINT = "https://taxdog.cloud/mcp/bfg-query";
export const DEFAULT_MODEL = "deepseek-v4-flash";
export const AVAILABLE_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"] as const;
export const MCP_PROTOCOL_VERSION = "2024-11-05";
export const MAX_REQUEST_BYTES = 400_000;
export const MAX_MESSAGES = 20;
export const MAX_MESSAGE_CHARS = 6_000;
export const MAX_SYSTEM_PROMPT_CHARS = 40_000;
export const MAX_DEEPSEEK_KEY_CHARS = 512;
export const MAX_MCP_TOKEN_CHARS = 2_048;
export const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
export const RATE_LIMIT_MAX_REQUESTS = 20;
export { DEFAULT_SYSTEM_PROMPT };

export type ChatModel = (typeof AVAILABLE_MODELS)[number];

export function isSupportedModel(model: string): model is ChatModel {
  return AVAILABLE_MODELS.includes(model as ChatModel);
}
