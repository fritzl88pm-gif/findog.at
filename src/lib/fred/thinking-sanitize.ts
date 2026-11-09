/**
 * Client-safe sanitizing for the German "Gedankengang" (no server-only imports):
 * shared by the collector (server) and the trace parser (server + browser).
 */
import { maskDisplayText } from "./execution-sanitize";

export const THINKING_STEP_LABEL = "Gedankengang";
/** Stored/displayed German text may be somewhat longer than the English source (6.000 chars). */
export const MAX_THINKING_DETAIL_CHARS = 9_000;

export type ThinkingLanguage = "en" | "de";

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;
/** Internal URI schemes (`weknora://doc/...`, `kb://...`); public http(s) links are left to the other maskers. */
const INTERNAL_URI_PATTERN = /\b(?!https?:)[a-z][a-z0-9+.-]{1,20}:\/\/[^\s)\]}>"'`,;]*[^\s)\]}>"'`,;.:!?]/giu;
const CHUNK_PATTERN = /\bchunks?\b(?:[\s_-]*#?\d+(?:\s*(?:,|;|&|\band\b|\bund\b|\bor\b|\bto\b|-|–)\s*#?\d+)*)?/giu;
const FUNCTION_CALL_PATTERN = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\s*\([^()\n]{0,200}\)/gu;
const SNAKE_CASE_PATTERN = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/gu;
const MASKED_ID_TOKEN = /\s*\[ID\]/gu;

const TOOL_WORDING: Record<ThinkingLanguage, string> = { en: "a tool", de: "ein Werkzeug" };

function chunkWording(match: string): string {
  const numbers = match.match(/\d+/gu)?.length ?? 0;
  return /^chunks/iu.test(match) || numbers > 1 ? "Fundstellen" : "Fundstelle";
}

/**
 * Removes everything internal from reasoning text: internal URIs, UUIDs, chunk numbers, tool identifiers,
 * hosts, model names, paths and secrets. Pure and idempotent (the output survives another pass unchanged).
 */
export function sanitizeThinkingText(value: unknown, language: ThinkingLanguage = "de"): string {
  if (typeof value !== "string") return "";
  let text = value.slice(0, MAX_THINKING_DETAIL_CHARS * 4);
  text = text.replace(INTERNAL_URI_PATTERN, "").replace(UUID_PATTERN, "");
  text = text.replace(CHUNK_PATTERN, chunkWording);
  text = text.replace(FUNCTION_CALL_PATTERN, TOOL_WORDING[language]).replace(SNAKE_CASE_PATTERN, TOOL_WORDING[language]);
  text = maskDisplayText(text).replace(MASKED_ID_TOKEN, "");
  return text
    .replace(/\(\s*\)/gu, "")
    .replace(/[ \t]+([.,;:!?])/gu, "$1")
    .replace(/[ \t]+([)\]])/gu, "$1")
    .replace(/[ \t]{2,}/gu, " ")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

