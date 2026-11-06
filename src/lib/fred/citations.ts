import { prettifySourceTitle } from "@/lib/fred/execution-structured";
import { stripSourceReferenceIds } from "@/lib/fred/execution-sanitize";
import {
  fredSourceKey,
  incompleteCitationStart,
  replaceCitationTags,
  splitByCitationTags,
  type FredSourceReference,
} from "@/lib/weknora/fred-research";
import { sanitizePublicSourceUrl, sanitizeSafeLabel } from "@/lib/fred/safe-research-display";

/**
 * WeKnora (citation_enabled) puts self-closing `<kb …/>` / `<web …/>` tags into
 * the answer. This module is the single place that turns them into text for
 * every surface:
 *
 *  - the live stream drops them (`createCitationStreamFilter`),
 *  - the stored answer keeps them verbatim (`display_content`),
 *  - every reader of the stored answer calls `renderCitedAnswer`, which
 *    replaces each tag with a numbered marker `⟦n⟧` and returns the ordered
 *    list of cited sources. Marker n is entry n-1 of that list, so the live
 *    final event, the reload route and the snippet route agree by construction.
 */

export const MAX_CITED_SOURCES = 99;

const MARKER_OPEN = "⟦";
const MARKER_CLOSE = "⟧";
const MARKER_PATTERN = /⟦(\d{1,3})⟧/gu;
const TRAILING_BLANKS = /[ \t]+$/u;

export function formatCitationMarker(number: number): string {
  return `${MARKER_OPEN}${number}${MARKER_CLOSE}`;
}

/** Splits text into plain text and `⟦n⟧` markers; n is 1-based. */
export function splitCitationMarkers(text: string): Array<{ marker: false; text: string } | { marker: true; number: number }> {
  const parts: Array<{ marker: false; text: string } | { marker: true; number: number }> = [];
  let position = 0;
  for (const match of text.matchAll(MARKER_PATTERN)) {
    const index = match.index ?? 0;
    if (index > position) parts.push({ marker: false, text: text.slice(position, index) });
    parts.push({ marker: true, number: Number(match[1]) });
    position = index + match[0].length;
  }
  if (position < text.length) parts.push({ marker: false, text: text.slice(position) });
  return parts;
}

/** `⟦1⟧` → `[1]` for copy, Telegram and plain-text surfaces. */
export function citationMarkersToBrackets(text: string): string {
  return text.replace(MARKER_PATTERN, (_marker, number: string) => `[${number}]`);
}

/** Removes complete citation tags together with the blanks hugging the claim before them. */
function removeCitationTags(text: string): string {
  let result = "";
  for (const part of splitByCitationTags(text)) {
    result = part.tag ? result.replace(TRAILING_BLANKS, "") : result + part.value;
  }
  return result;
}

/** Removes every complete citation tag (and a dangling incomplete one). */
export function stripCitationTags(text: string): string {
  const result = removeCitationTags(text);
  const incomplete = incompleteCitationStart(result);
  return incomplete >= 0 ? result.slice(0, incomplete) : result;
}

/**
 * Applies `transform` to the text between citation tags and keeps the tags
 * untouched, so text rewriting (BFG linking, …) never edits tag attributes.
 */
export function mapOutsideCitationTags(text: string, transform: (segment: string) => string): string {
  return splitByCitationTags(text)
    .map((part) => (part.tag ? part.value : transform(part.value)))
    .join("");
}

/**
 * Streaming counterpart of `stripCitationTags`: feed raw deltas, get text that
 * never contains (part of) a citation tag. An unfinished trailing tag is held
 * back until the next chunk completes it.
 */
export function createCitationStreamFilter() {
  let pending = "";
  return {
    push(chunk: string): string {
      const text = removeCitationTags(pending + chunk);
      const incomplete = incompleteCitationStart(text);
      if (incomplete >= 0) {
        pending = text.slice(incomplete);
        return text.slice(0, incomplete);
      }
      pending = "";
      return text;
    },
    reset(): void {
      pending = "";
    },
  };
}

export type CitedAnswer = {
  /** Answer text with `⟦n⟧` markers, trimmed. */
  text: string;
  /** Ordered cited sources (with ids). Marker n is `cited[n - 1]`. */
  cited: FredSourceReference[];
};

/**
 * The one function behind marker numbering. Numbering follows the first
 * occurrence of a source; the same source keeps its number and directly
 * adjacent duplicates collapse into one marker.
 */
export function renderCitedAnswer(stored: string): CitedAnswer {
  const input = stored.replaceAll(MARKER_OPEN, "[").replaceAll(MARKER_CLOSE, "]");
  const cited: FredSourceReference[] = [];
  const numbers = new Map<string, number>();
  let output = "";
  for (const piece of splitByCitationTags(input)) {
    if (!piece.tag) {
      output += piece.value;
      continue;
    }
    let marker = "";
    replaceCitationTags(piece.value, (source) => {
      if (!source) return "";
      const key = fredSourceKey(source);
      let number = numbers.get(key);
      if (number === undefined && cited.length < MAX_CITED_SOURCES) {
        cited.push(source);
        number = cited.length;
        numbers.set(key, number);
      }
      if (number !== undefined) marker = formatCitationMarker(number);
      return "";
    });
    // A marker (or a dropped tag) hugs the claim it supports.
    output = output.replace(TRAILING_BLANKS, "");
    if (marker && !output.endsWith(marker)) output += marker;
  }
  const incomplete = incompleteCitationStart(output);
  if (incomplete >= 0) output = output.slice(0, incomplete);
  return { text: output.trim(), cited };
}

/** Cited sources without knowledge-base or chunk ids; safe for the browser in every mode. */
export function publicCitedSources(cited: readonly FredSourceReference[]): FredSourceReference[] {
  return stripSourceReferenceIds(cited);
}

/** Parses the id-free cited list from a stream/reload payload; keeps order and duplicates. */
export function parseCitedSources(value: unknown): FredSourceReference[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_CITED_SOURCES).flatMap((candidate): FredSourceReference[] => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const item = candidate as Record<string, unknown>;
    if (item.kind === "web") {
      const url = sanitizePublicSourceUrl(item.url, 2_048);
      if (!url) return [];
      const title = sanitizeSafeLabel(item.title, 512);
      return [{ kind: "web", url, ...(title ? { title } : {}) }];
    }
    if (item.kind !== "knowledge") return [];
    const doc = sanitizeSafeLabel(item.doc, 512);
    return doc ? [{ kind: "knowledge", doc }] : [];
  });
}

export function citedSourceLabel(source: FredSourceReference): string {
  if (source.kind === "web") {
    if (source.title) return source.title;
    try {
      return new URL(source.url).hostname;
    } catch {
      return source.url;
    }
  }
  return prettifySourceTitle(source.doc) || source.doc;
}

/**
 * Index (0-based) of the first cited source a list entry refers to, or -1.
 * Knowledge sources match by prettified document name, web sources by URL.
 */
export function findCitedIndex(
  cited: readonly FredSourceReference[],
  entry: { doc?: string; title?: string; url?: string },
): number {
  if (cited.length === 0) return -1;
  if (entry.url) {
    const byUrl = cited.findIndex((source) => source.kind === "web" && source.url === entry.url);
    if (byUrl >= 0) return byUrl;
  }
  const name = entry.doc ?? entry.title;
  if (!name) return -1;
  const wanted = prettifySourceTitle(name).toLowerCase();
  return cited.findIndex((source) => source.kind === "knowledge"
    && prettifySourceTitle(source.doc).toLowerCase() === wanted);
}

const TELEGRAM_MAX_SOURCES = 10;

/** `Quellen:` lines for plain-text surfaces: `[1, 3] DBA Deutschland`, one line per document. */
export function citedSourceLines(cited: readonly FredSourceReference[], maximum = TELEGRAM_MAX_SOURCES): string[] {
  const groups = new Map<string, number[]>();
  cited.forEach((source, index) => {
    const label = citedSourceLabel(source);
    groups.set(label, [...(groups.get(label) ?? []), index + 1]);
  });
  return [...groups.entries()]
    .slice(0, maximum)
    .map(([label, numbers]) => `[${numbers.join(", ")}] ${label}`);
}

/** Stored answer → plain text with `[n]` markers and a compact `Quellen:` list (Telegram). */
export function answerWithPlainCitations(stored: string): string {
  const { text, cited } = renderCitedAnswer(stored);
  const body = citationMarkersToBrackets(text);
  if (cited.length === 0) return body;
  return `${body}\n\nQuellen:\n${citedSourceLines(cited).join("\n")}`;
}
