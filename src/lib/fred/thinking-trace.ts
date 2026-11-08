/**
 * Admin-only "Gedankengang": Fred's (English) reasoning blocks, sanitized and translated to German.
 *
 * Pipeline per thinking block: accumulate chunks (by upstream event id) → sanitize deterministically →
 * translate with a small model in the background → sanitize again → deliver as a `thinking` trace step.
 * Translation never blocks the answer stream; any failure drops the block silently, so untranslated
 * English text can never reach a browser.
 */
import { DEEPSEEK_BASE_URL } from "../config";
import { resolveDeepSeekApiKey } from "../deepseek-key";
import type { FredExecutionStep } from "./execution-trace";
import {
  MAX_THINKING_DETAIL_CHARS,
  THINKING_STEP_LABEL,
  sanitizeThinkingText,
} from "./thinking-sanitize";

export { THINKING_STEP_LABEL, MAX_THINKING_DETAIL_CHARS, sanitizeThinkingText };

export const MAX_THINKING_BLOCK_CHARS = 6_000;
export const MAX_THINKING_BLOCKS = 20;
export const THINKING_TRANSLATION_TIMEOUT_MS = 20_000;
/** How long the end of a turn waits for still-running translations before delivering what is ready. */
export const THINKING_FINAL_GRACE_MS = 3_000;
export const THINKING_TRANSLATION_MODEL = "deepseek-v4-flash";

// ── Translation (DeepSeek Flash) ────────────────────────────────────────────

export const THINKING_TRANSLATION_SYSTEM_PROMPT = [
  "Übersetze den folgenden englischen Gedankengang eines Steuerrecht-Assistenten sinngetreu ins Deutsche (Österreich).",
  "Behalte juristische Fundstellen (z. B. § 33 Abs. 4 Z 1 EStG, LStR Rz 785), Beträge, Zahlen und Datumsangaben exakt bei.",
  "Füge nichts hinzu, kommentiere nichts und lasse nichts weg. Gib nur die Übersetzung aus.",
  "Ersetze technische Bezeichner (Werkzeug-, Funktions-, Datei- oder Datenbanknamen, IDs, Links) durch neutrale Wörter wie „Suche“ oder „Fundstelle“.",
].join(" ");

export type ThinkingTranslator = (text: string, signal: AbortSignal) => Promise<string | null>;

type TranslatorOptions = {
  fetchImpl?: typeof fetch;
  apiKey?: string;
};

/** Default translator: DeepSeek Flash over the OpenAI-compatible chat endpoint. Returns null on any failure. */
export function createDeepSeekThinkingTranslator(options: TranslatorOptions = {}): ThinkingTranslator {
  const fetchImpl = options.fetchImpl ?? fetch;
  return async (text, signal) => {
    try {
      const response = await fetchImpl(`${DEEPSEEK_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.apiKey ?? resolveDeepSeekApiKey()}`,
        },
        body: JSON.stringify({
          model: THINKING_TRANSLATION_MODEL,
          temperature: 0.1,
          stream: false,
          thinking: { type: "disabled" },
          max_tokens: 4_096,
          messages: [
            { role: "system", content: THINKING_TRANSLATION_SYSTEM_PROMPT },
            { role: "user", content: text },
          ],
        }),
        signal,
      });
      if (!response.ok) return null;
      const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
      const content = body.choices?.[0]?.message?.content;
      return typeof content === "string" && content.trim() ? content : null;
    } catch {
      return null;
    }
  };
}

// ── Block collection ────────────────────────────────────────────────────────

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function hashId(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

type OpenBlock = { key: string; text: string; truncated: boolean };

export type ThinkingCollectorOptions = {
  translate: ThinkingTranslator;
  /** Id of the trace step after which a finished block belongs (keeps the timeline in thinking order). */
  currentStepId?: () => string | undefined;
  maxBlocks?: number;
  maxBlockChars?: number;
  timeoutMs?: number;
  /** Aborts all running translations (request cancelled / turn finished abnormally). */
  signal?: AbortSignal;
};

export type ThinkingCollector = {
  /** Feeds one parsed upstream SSE event. Never throws. */
  ingest(event: unknown): void;
  /** Translated steps that became ready since the last call (non-blocking). */
  drain(): FredExecutionStep[];
  /** Finalizes open blocks and waits up to `graceMs` for pending translations; returns the ready steps. */
  settle(graceMs?: number): Promise<FredExecutionStep[]>;
  /** Discards everything (e.g. when a fallback attempt replaces the first run). */
  reset(): void;
};

export function createThinkingCollector(options: ThinkingCollectorOptions): ThinkingCollector {
  const maxBlocks = options.maxBlocks ?? MAX_THINKING_BLOCKS;
  const maxBlockChars = options.maxBlockChars ?? MAX_THINKING_BLOCK_CHARS;
  const timeoutMs = options.timeoutMs ?? THINKING_TRANSLATION_TIMEOUT_MS;

  let open = new Map<string, OpenBlock>();
  let started = 0;
  let generation = 0;
  let pending = new Set<Promise<void>>();
  let ready: FredExecutionStep[] = [];

  const translateBlock = (block: OpenBlock, afterId: string | undefined, index: number): void => {
    const source = sanitizeThinkingText(block.text, "en");
    if (!source) return;
    const myGeneration = generation;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const task = (async () => {
      let translated: string | null = null;
      try {
        translated = await options.translate(source, controller.signal);
      } catch {
        translated = null;
      }
      if (myGeneration !== generation || controller.signal.aborted) return;
      const detail = sanitizeThinkingText(translated ?? "", "de").slice(0, MAX_THINKING_DETAIL_CHARS).trim();
      if (!detail) return;
      ready.push({
        id: `thinking:${hashId(block.key)}:${index}`,
        kind: "thinking",
        status: "completed",
        label: THINKING_STEP_LABEL,
        detail,
        ...(afterId ? { afterId } : {}),
      });
    })().finally(() => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      pending.delete(task);
    });
    pending.add(task);
  };

  const finalize = (key: string): void => {
    const block = open.get(key);
    if (!block) return;
    open.delete(key);
    if (started >= maxBlocks) return;
    if (!block.text.trim()) return;
    started += 1;
    translateBlock(block, options.currentStepId?.(), started);
  };

  const finalizeAll = (): void => {
    for (const key of [...open.keys()]) finalize(key);
  };

  return {
    ingest(event) {
      try {
        const record = recordOf(event);
        if (!record) return;
        const responseType = typeof (record.response_type ?? record.type) === "string"
          ? String(record.response_type ?? record.type).toLowerCase()
          : "";
        if (responseType !== "thinking") {
          // Any other event ends the running thinking block(s).
          if (responseType) finalizeAll();
          return;
        }
        const data = recordOf(record.data) ?? {};
        const rawId = record.id ?? data.id ?? data.event_id;
        const key = typeof rawId === "string" || typeof rawId === "number" ? String(rawId) : "default";
        const chunk = typeof record.content === "string"
          ? record.content
          : typeof data.content === "string" ? data.content : "";
        if (chunk && !open.has(key) && started + open.size >= maxBlocks) {
          // Block budget exhausted: ignore further blocks entirely.
        } else if (chunk) {
          const block = open.get(key) ?? { key, text: "", truncated: false };
          if (!block.truncated) {
            block.text += chunk;
            if (block.text.length >= maxBlockChars) {
              block.text = block.text.slice(0, maxBlockChars);
              block.truncated = true;
            }
          }
          open.set(key, block);
        }
        if (data.done === true || record.done === true) finalize(key);
      } catch {
        // Reasoning capture is best effort and must never disturb the stream.
      }
    },
    drain() {
      const steps = ready;
      ready = [];
      return steps;
    },
    async settle(graceMs = THINKING_FINAL_GRACE_MS) {
      finalizeAll();
      if (pending.size > 0) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          Promise.allSettled([...pending]),
          new Promise<void>((resolve) => { timer = setTimeout(resolve, graceMs); }),
        ]);
        if (timer) clearTimeout(timer);
      }
      const steps = ready;
      ready = [];
      return steps;
    },
    reset() {
      generation += 1;
      open = new Map();
      started = 0;
      pending = new Set();
      ready = [];
    },
  };
}
