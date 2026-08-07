import { randomUUID } from "node:crypto";

// ── Title normalization ────────────────────────────────────────────────────
// Title: string, trim/collapse whitespace, 1..80 Unicode code points, reject
// control chars (U+0000–U+001F, U+007F–U+009F) anywhere in the raw input
// before trim/collapse.

const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/u;

export function normalizeTitle(raw: string): string | null {
  // Reject any control character in the raw input, including at edges
  if (CONTROL_RE.test(raw)) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const collapsed = trimmed.replace(/\s+/gu, " ");
  if ([...collapsed].length > 80) return null;
  if ([...collapsed].length < 1) return null;
  return collapsed;
}

// ── Prompt text normalization ──────────────────────────────────────────────
// Prompt: normalize CRLF/bare CR to LF first, then reject disallowed control
// chars everywhere including outer edges, then trim, then enforce 4000
// Unicode code points. Allowed: newline (U+000A) and tab (U+0009).

const PROMPT_DISALLOWED_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;

export function normalizePromptText(raw: string): string | null {
  // Normalize CRLF to LF first, then bare CR to LF
  let text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // Reject disallowed controls anywhere in the text BEFORE trim
  if (PROMPT_DISALLOWED_RE.test(text)) return null;
  text = text.trim();
  if (text.length === 0) return "";
  if ([...text].length > 4000) return null;
  return text;
}

// ── POST body validation (create) ──────────────────────────────────────────
// Must be object with exactly the keys "title" and "promptText".
// Never accept "id" on POST — it is server-generated.

const POST_ALLOWED_KEYS = new Set(["title", "promptText"]);

export function validatePostBody(body: unknown): { title: string; promptText: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throwRequestBodyError();
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  // Only allowed keys; "id" is never accepted
  for (const key of keys) {
    if (!POST_ALLOWED_KEYS.has(key)) throwRequestBodyError();
  }
  if (!("title" in record) || !("promptText" in record)) throwRequestBodyError();
  if (typeof record.title !== "string") throwRequestBodyError();
  if (typeof record.promptText !== "string") throwRequestBodyError();
  return { title: record.title, promptText: record.promptText };
}

// ── PUT body validation (update) ───────────────────────────────────────────
// Must be object with exactly the keys "id", "title", and "promptText".
// ID is immutable (not updated); it identifies the row.

const PUT_ALLOWED_KEYS = new Set(["id", "title", "promptText"]);

export function validatePutBody(body: unknown): { id: string; title: string; promptText: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throwRequestBodyError();
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  for (const key of keys) {
    if (!PUT_ALLOWED_KEYS.has(key)) throwRequestBodyError();
  }
  if (!("id" in record) || !("title" in record) || !("promptText" in record)) throwRequestBodyError();
  if (typeof record.id !== "string") throwRequestBodyError();
  if (typeof record.title !== "string") throwRequestBodyError();
  if (typeof record.promptText !== "string") throwRequestBodyError();
  return { id: record.id, title: record.title, promptText: record.promptText };
}

// ── ID generation ──────────────────────────────────────────────────────────
// New IDs are generated server-side with crypto.randomUUID().

export function generateProfileId(): string {
  return randomUUID();
}

// ── Helpers ────────────────────────────────────────────────────────────────

function throwRequestBodyError(): never {
  throw new RequestBodyError("Ungültiger Request-Body.");
}

class RequestBodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestBodyError";
  }
}
