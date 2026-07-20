
import { UserVisibleError } from "@/lib/errors";

export class GeminiImageError extends UserVisibleError {
  constructor(message: string, status = 502) {
    super(message, status);
    this.name = "GeminiImageError";
  }
}

export const GEMINI_CONTEXT_PROMPT =
  "Describe this image in detail, including all visible text, numbers, tables, labels, and markings.";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemini-3.5-flash";
const MAX_DESCRIPTION_CHARS = 15_000;
const REQUEST_TIMEOUT_MS = 75_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export type DescribeImageOptions = {
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  maxResponseBytes?: number;
};

function apiKey(): string {
  const value = process.env.OPENROUTER_API_KEY?.trim() ?? "";
  if (!value) {
    throw new GeminiImageError(
      "Bildanalyse ist serverseitig nicht konfiguriert. Bitte Administrator kontaktieren.",
      503,
    );
  }
  return value;
}

function providerError(status: number): GeminiImageError {
  if (status === 401 || status === 403) {
    return new GeminiImageError(
      "Bildanalyse ist serverseitig nicht verfügbar. Bitte Administrator kontaktieren.",
      503,
    );
  }
  if (status === 429) return new GeminiImageError("Die Bildanalyse ist derzeit ausgelastet.", 429);
  if (status === 413) return new GeminiImageError("Das Bild ist für die Analyse zu groß.", 413);
  return new GeminiImageError("Die Bildanalyse ist derzeit nicht erreichbar.", 502);
}

async function readJsonCapped(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.body) throw new GeminiImageError("Die Bildanalyse lieferte keine gültige Antwort.", 502);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new GeminiImageError("Die Antwort der Bildanalyse ist zu groß.", 502);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof GeminiImageError) throw error;
    throw new GeminiImageError("Die Bildanalyse lieferte keine gültige Antwort.", 502);
  }
}

function parseContent(payload: unknown): string {
  const body = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
  const choices = Array.isArray(body?.choices) ? body.choices : [];
  const message = (choices[0] && typeof choices[0] === "object" && !Array.isArray(choices[0])
    ? (choices[0] as Record<string, unknown>).message
    : null) as Record<string, unknown> | null;
  const content = message?.content;

  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .flatMap((part: unknown) => {
      if (typeof part === "string") return [part];
      if (part && typeof part === "object" && !Array.isArray(part)) {
        const p = part as Record<string, unknown>;
        if (typeof p.text === "string") return [p.text];
      }
      return [];
    })
    .join("");
}

function capContent(text: string): string {
  const TRUNCATION_SUFFIX = "\n\n[Bildbeschreibung aus technischen Gründen gekürzt.]";
  if (text.length <= MAX_DESCRIPTION_CHARS) return text;
  const available = Math.max(0, MAX_DESCRIPTION_CHARS - TRUNCATION_SUFFIX.length);
  return text.slice(0, available).trimEnd() + TRUNCATION_SUFFIX;
}

export async function describeImage(
  imageDataUri: string,
  options: DescribeImageOptions = {},
): Promise<string> {
  if (options.signal?.aborted) {
    throw new GeminiImageError("Die Anfrage wurde abgebrochen.");
  }

  const key = apiKey();
  const fetcher = options.fetch ?? globalThis.fetch;

  const controller = new AbortController();
  const onAbort = () => { if (!controller.signal.aborted) controller.abort(options.signal?.reason); };
  if (options.signal?.aborted) onAbort();
  else options.signal?.addEventListener("abort", onAbort, { once: true });

  const timeout = setTimeout(() => {
    if (!controller.signal.aborted) controller.abort(new GeminiImageError("Die Bildanalyse hat nicht rechtzeitig geantwortet."));
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetcher(ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Title": "findog.at Attachments",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: GEMINI_CONTEXT_PROMPT },
              { type: "image_url", image_url: { url: imageDataUri } },
            ],
          },
        ],
        max_tokens: 15_000,
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) throw providerError(response.status);

    const payload = await readJsonCapped(
      response,
      options.maxResponseBytes ?? MAX_RESPONSE_BYTES,
    );

    const result = parseContent(payload);
    if (!result || result.trim().length === 0) {
      throw new GeminiImageError("Die Bildanalyse lieferte keinen Beschreibungstext.", 502);
    }

    return capContent(result);
  } catch (error) {
    if (error instanceof GeminiImageError) throw error;
    if (options.signal?.aborted) {
      throw new GeminiImageError("Die Anfrage wurde abgebrochen.");
    }
    throw new GeminiImageError("Die Bildanalyse ist derzeit nicht erreichbar.", 502);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
