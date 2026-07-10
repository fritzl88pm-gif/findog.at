import { DEFAULT_SYSTEM_PROMPT } from "./default-system-prompt";

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_MODEL = "deepseek-v4-pro";
export const AVAILABLE_MODELS = ["deepseek-v4-flash", DEFAULT_MODEL] as const;
export const MAX_REQUEST_BYTES = 400_000;
export const MAX_PDF_UPLOAD_BYTES = 50_000_000;
export const MAX_IMAGE_UPLOAD_BYTES = 5_000_000;
export const MAX_PDF_UPLOADS = 5;
export const MAX_IMAGE_UPLOADS = 5;
export const MAX_MULTIPART_REQUEST_BYTES =
  MAX_REQUEST_BYTES + MAX_PDF_UPLOAD_BYTES * MAX_PDF_UPLOADS + MAX_IMAGE_UPLOAD_BYTES * MAX_IMAGE_UPLOADS;
export const MAX_MESSAGES = 20;
export const MAX_SYSTEM_PROMPT_CHARS = 40_000;
export const MAX_DEEPSEEK_KEY_CHARS = 512;
export const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
export const RATE_LIMIT_MAX_REQUESTS = 20;
export { DEFAULT_SYSTEM_PROMPT };

export type ChatModel = (typeof AVAILABLE_MODELS)[number];

export function isSupportedModel(model: string): model is ChatModel {
  return AVAILABLE_MODELS.includes(model as ChatModel);
}
