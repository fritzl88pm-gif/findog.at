export const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
export const BFG_MCP_ENDPOINT = "https://taxdog.cloud/mcp/bfg-query";
export const DEFAULT_MODEL = "deepseek-chat";
export const AVAILABLE_MODELS = ["deepseek-chat", "deepseek-reasoner"] as const;
export const MCP_PROTOCOL_VERSION = "2024-11-05";
export const MAX_REQUEST_BYTES = 100_000;
export const MAX_MESSAGES = 20;
export const MAX_MESSAGE_CHARS = 6_000;
export const MAX_SYSTEM_PROMPT_CHARS = 6_000;
export const MAX_DEEPSEEK_KEY_CHARS = 512;
export const MAX_MCP_TOKEN_CHARS = 2_048;
export const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
export const RATE_LIMIT_MAX_REQUESTS = 20;

export const DEFAULT_SYSTEM_PROMPT =
  "Du bist Findog/Fred, ein sachlicher KI-Agent für österreichisches Steuerrecht. Antworte auf Deutsch, nutze verfügbare BFG/WeKnora-MCP-Werkzeuge für Recherche, zitiere Quellen/Normen soweit im Werkzeugergebnis vorhanden und kennzeichne Unsicherheiten klar.";

export type ChatModel = (typeof AVAILABLE_MODELS)[number];

export function isSupportedModel(model: string): model is ChatModel {
  return AVAILABLE_MODELS.includes(model as ChatModel);
}
