/**
 * Structured, display-safe projections of Fred's tool calls and results: search queries, source hits,
 * document excerpts and key/value facts. Everything here is pure and shared by the server-side trace
 * builder, the stored-trace sanitizer and the browser renderer.
 */
import {
  isInternalKey,
  sanitizeDisplayBlock,
  sanitizeDisplayLine,
} from "./execution-sanitize";
import { sanitizePublicSourceUrl } from "./safe-research-display";

export const MAX_STEP_SOURCES = 12;
export const MAX_STEP_QUERIES = 8;
export const MAX_STEP_FACTS = 6;
export const MAX_SOURCE_TITLE_CHARS = 200;
export const MAX_SOURCE_SNIPPET_CHARS = 400;
export const MAX_SOURCE_EXCERPT_CHARS = 1_500;
const MAX_QUERY_CHARS = 160;
const MAX_FACT_VALUE_CHARS = 120;
const MAX_PAYLOAD_DEPTH = 6;
const MAX_ROWS_SCANNED = 60;
const MAX_JSON_PARSE_CHARS = 400_000;

export type FredExecutionSourceKind = "law" | "guideline" | "faq" | "bfg" | "web" | "document";

export type FredExecutionSource = {
  /** Original (sanitized) document title; prettify with `prettifySourceTitle` for display. */
  title: string;
  kind?: FredExecutionSourceKind;
  /** Short highlighted hit text (WeKnora `match_snippet`). */
  snippet?: string;
  /** Longer excerpt of the passage (capped, ~1.500 chars). */
  excerpt?: string;
  /** Relevance 0..1. */
  score?: number;
  matchType?: string;
  /** Search query that produced the hit. */
  query?: string;
  /** Public http(s) URL (web hits only). */
  url?: string;
  /** Position in the document, e.g. "Abschnitt 3" or "Seite 4". */
  section?: string;
};

export type FredExecutionFact = { label: string; value: string };

export type FredToolVariant = "search" | "read" | "web" | "shell" | "agent" | "planning" | "thinking" | "generic";

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_JSON_PARSE_CHARS) return value;
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

// ── Tool classification ──────────────────────────────────────────────────────

export function toolVariant(toolName: string | undefined): FredToolVariant {
  const name = (toolName ?? "").toLowerCase();
  if (!name) return "generic";
  if (name === "thinking") return "thinking";
  if (/(?:^|_)(?:shell|bash|terminal|sandbox)|shell_exec|run_command|exec_command|execute_command/u.test(name)) return "shell";
  if (/(?:spawn|delegate|collaborat|sub_?agent|wait_?(?:for_)?agent|agent_task)/u.test(name)) return "agent";
  if (/(?:todo|plan|planning|task)/u.test(name)) return "planning";
  if (/(?:web|internet|browser|search_engine|google|fetch_url)/u.test(name)) return "web";
  if (/(?:read_?document|get_?document|document_info|get_?chunk|list_knowledge_chunks|read_knowledge|get_knowledge|read_?file)/u.test(name)) return "read";
  if (/(?:knowledge|kb|chunk|document|grep|retrieve|search_docs|faq)/u.test(name)) return "search";
  return "generic";
}

type ToolLabels = { running: string; completed: string; failed: string };

const VARIANT_LABELS: Partial<Record<FredToolVariant, ToolLabels>> = {
  read: {
    running: "Dokument wird gelesen",
    completed: "Dokument gelesen",
    failed: "Dokument konnte nicht gelesen werden",
  },
  shell: {
    running: "Sandbox-Befehl wird ausgeführt",
    completed: "Sandbox-Befehl ausgeführt",
    failed: "Sandbox-Befehl fehlgeschlagen",
  },
  agent: {
    running: "Hilfs-Agent wird gestartet",
    completed: "Hilfs-Agent gestartet",
    failed: "Hilfs-Agent konnte nicht gestartet werden",
  },
};

const NAMED_LABELS: Array<[RegExp, ToolLabels]> = [
  [/web_?fetch|fetch_url/u, {
    running: "Webseite wird abgerufen",
    completed: "Webseite abgerufen",
    failed: "Webseite konnte nicht abgerufen werden",
  }],
  [/data_?analysis|database_query|data_schema/u, {
    running: "Daten werden analysiert",
    completed: "Daten analysiert",
    failed: "Datenanalyse fehlgeschlagen",
  }],
  [/skill/u, {
    running: "Fähigkeit wird genutzt",
    completed: "Fähigkeit genutzt",
    failed: "Fähigkeit konnte nicht genutzt werden",
  }],
  [/final_answer/u, {
    running: "Antwort wird formuliert",
    completed: "Antwort formuliert",
    failed: "Antwort konnte nicht formuliert werden",
  }],
];

export function toolLabels(toolName: string, variant: FredToolVariant): ToolLabels | undefined {
  const name = toolName.toLowerCase();
  const named = NAMED_LABELS.find(([pattern]) => pattern.test(name));
  if (named) return named[1];
  return VARIANT_LABELS[variant];
}

// ── Titles and source classification ────────────────────────────────────────

const FILE_EXTENSION_PATTERN = /\.(?:md|markdown|pdf|txt|docx?|html?|json|csv|xlsx?)$/iu;
const TITLE_SUFFIX_PATTERN = /[_\s-]+(?:verified|full|clean|final|raw|converted|ocr)$/iu;
const ISO_DATE_PATTERN = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/gu;

/**
 * "EStG_1988_Einkommensteuergesetz_1988_RIS_Fassung_2026-07-12_verified.md"
 * → "EStG 1988 · Einkommensteuergesetz 1988 · RIS-Fassung 12.07.2026"
 */
export function prettifySourceTitle(raw: string): string {
  let title = raw.trim().split(/[\\/]/u).pop() ?? "";
  title = title.replace(FILE_EXTENSION_PATTERN, "");
  while (TITLE_SUFFIX_PATTERN.test(title)) title = title.replace(TITLE_SUFFIX_PATTERN, "");
  title = title.replace(ISO_DATE_PATTERN, (_match, year: string, month: string, day: string) => `${day}.${month}.${year}`);
  if (!title.includes("_")) return title.trim();

  const groups: string[][] = [];
  for (const token of title.split("_").filter(Boolean)) {
    const numeric = /^[\d.]+$/u.test(token);
    const current = groups[groups.length - 1];
    if (!current || (!numeric && current.some((part) => /^[\d.]+$/u.test(part)))) {
      groups.push([token]);
    } else {
      current.push(token);
    }
  }
  return groups
    .map((group) => group.join(" ").replace(/\bRIS Fassung\b/u, "RIS-Fassung"))
    .join(" · ");
}

const LAW_PATTERN = /^(?:EStG|UStG|KStG|BAO|FLAG|ASVG|NoVAG|GrEStG|GebG|KommStG|AVRAG|ABGB|UGB|B-VG|BUAG|PendlerV|[A-Z][A-Za-z]{1,10}G)(?:[\s_-]|$)|gesetz|verordnung|_RIS_|bundesnormen|BGBl/u;
const GUIDELINE_PATTERN = /^(?:LStR|EStR|UStR|KStR|BAO-?Erlass|VwGH|AÖF|UFS|EAS|Rz)(?:[\s_-]|$)|richtlinie|erlass|wartungserlass|info\s?(?:blatt|schreiben)|findok/iu;
const BFG_PATTERN = /\bBFG\b|\bRV\/\d{3,}|\bGZ\b|entscheidung|erkenntnis|beschluss/iu;

export function classifySource(input: {
  title: string;
  knowledgeBaseType?: string;
  content?: string;
  url?: string;
}): FredExecutionSourceKind {
  if (input.url) return "web";
  if (input.knowledgeBaseType?.toLowerCase() === "faq" || /^\s*Q:[\s\S]*\|\s*A:/u.test(input.content ?? "")) return "faq";
  if (BFG_PATTERN.test(input.title)) return "bfg";
  if (GUIDELINE_PATTERN.test(input.title)) return "guideline";
  if (LAW_PATTERN.test(input.title)) return "law";
  return "document";
}

export const SOURCE_KIND_LABELS: Record<FredExecutionSourceKind, string> = {
  law: "Gesetz",
  guideline: "Richtlinie",
  faq: "FAQ",
  bfg: "BFG",
  web: "Web",
  document: "Dokument",
};

/** "Q: Frage | A: Antwort" → question/answer (null when the text is not a FAQ row). */
export function splitFaq(text: string): { question: string; answer: string } | null {
  const match = /^\s*Q:\s*([\s\S]*?)\s*\|\s*A:\s*([\s\S]*)$/u.exec(text);
  if (!match || !match[1].trim()) return null;
  return { question: match[1].trim(), answer: match[2].trim() };
}

export function sourceDomain(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./u, "") || undefined;
  } catch {
    return undefined;
  }
}

// ── Highlighting ────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "der", "die", "das", "den", "dem", "des", "ein", "eine", "einer", "einen", "einem", "eines", "und", "oder", "für",
  "von", "vom", "mit", "bei", "beim", "ist", "sind", "war", "wird", "werden", "wurde", "wurden", "hat", "haben",
  "im", "in", "zu", "zur", "zum", "auf", "aus", "als", "wie", "was", "wer", "wen", "wem", "wann", "wo", "welche",
  "welcher", "welches", "welchen", "nach", "über", "unter", "bis", "ab", "um", "nur", "noch", "auch", "sich",
  "dass", "wenn", "dann", "nicht", "kann", "können", "muss", "müssen", "gilt", "gelten", "the", "and", "for",
]);

export const MAX_HIGHLIGHTS_PER_TERM = 2;

export function searchTerms(queries: readonly string[]): string[] {
  const terms = new Set<string>();
  for (const query of queries) {
    for (const token of query.toLowerCase().split(/[^\p{L}\p{N}§]+/u)) {
      if (token.length >= 3 && !STOP_WORDS.has(token)) terms.add(token);
      if (terms.size >= 12) return [...terms];
    }
  }
  return [...terms];
}

export type HighlightSegment = { text: string; match: boolean };

/**
 * Splits text so that search terms can be emphasised: whole words only (German compounds such as
 * "Monatsbetrag" never match "Betrag"), at most the first two occurrences per term.
 */
export function highlightSegments(text: string, queries: readonly string[]): HighlightSegment[] {
  const terms = searchTerms(queries).sort((left, right) => right.length - left.length);
  if (terms.length === 0 || !text) return [{ text, match: false }];
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|")})(?![\\p{L}\\p{N}])`,
    "giu",
  );
  const counts = new Map<string, number>();
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const found of text.matchAll(pattern)) {
    const key = found[0].toLowerCase();
    const seen = counts.get(key) ?? 0;
    if (seen >= MAX_HIGHLIGHTS_PER_TERM) continue;
    counts.set(key, seen + 1);
    const index = found.index ?? 0;
    if (index > cursor) segments.push({ text: text.slice(cursor, index), match: false });
    segments.push({ text: found[0], match: true });
    cursor = index + found[0].length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments.length > 0 ? segments : [{ text, match: false }];
}

// ── Snippet cleanup ─────────────────────────────────────────────────────────

const GERMAN_DATE_REPLACER = (_match: string, year: string, month: string, day: string) => `${day}.${month}.${year}`;

export function germanizeDates(text: string): string {
  return text.replace(ISO_DATE_PATTERN, GERMAN_DATE_REPLACER);
}

/**
 * Index breadcrumb such as "> EStG 1988 | § 33 | Abs. 4 | Stichtag: 2026-07-12 | RIS: 10004570" or
 * "LStR 2002 · Rz 795a · Teil 1 · Stichtag: 2025-12-18 · PDF S. 479 · BMF GZ 2025-0.951.634".
 */
const BREADCRUMB_SOURCE =
  String.raw`(?:>[ \t]*)?\p{L}[^\n|·>]{1,30}?(?:[ \t]*[|·][ \t]*[^\n|·>]{1,40}?){0,8}?[ \t]*[|·][ \t]*Stichtag:[ \t]*\d{4}-\d{2}-\d{2}` +
  String.raw`(?:[ \t]*[|·][ \t]*(?:RIS:[ \t]*\d+|PDF S\.[ \t]*\d+|BMF GZ[ \t]*[\w.\-]+|GZ[ \t]*[\w.\-]+))*`;
const BREADCRUMB_PATTERN = new RegExp(BREADCRUMB_SOURCE, "gu");
/** A breadcrumb that the snippet cut off inside its metadata ("… | Stichtag: 2026- ..."). */
const TRUNCATED_BREADCRUMB_PATTERN = new RegExp(
  BREADCRUMB_SOURCE.replace(String.raw`Stichtag:[ \t]*\d{4}-\d{2}-\d{2}`, String.raw`Stichtag:[^\n]{0,40}?`) +
    String.raw`[ \t]*(?:\.{3}|…)?[ \t]*$`,
  "u",
);
/** Heading tail cut off before the first breadcrumb ("lit. c\n> EStG 1988 | …"). */
const LEADING_FRAGMENT_PATTERN = new RegExp(String.raw`^[^>]{0,25}>[ \t]*(?=${BREADCRUMB_SOURCE})`, "u");

function locatorFromBreadcrumb(crumb: string): string | undefined {
  const items = crumb.replace(/^>\s*/u, "").split(/\s*[|·]\s*/u).map((item) => item.trim()).filter(Boolean).slice(1);
  const legal: string[] = [];
  const other: string[] = [];
  for (const item of items) {
    if (/^(?:§§?|Abs\.|Z\b|lit\.|Art\.)/u.test(item)) legal.push(item);
    else if (/^Rz\s*\S+/u.test(item)) other.push(item);
    else {
      const page = /^PDF S\.\s*(\d+)/u.exec(item);
      if (page) other.push(`S. ${page[1]}`);
    }
  }
  const locator = [legal.join(" "), ...other].filter(Boolean).join(" · ");
  return locator || undefined;
}

export type CleanedSourceText = { text: string; locator?: string };

/**
 * Removes index breadcrumbs / metadata prefixes from a snippet or excerpt, turns ISO dates into German
 * dates and returns a short human locator ("§ 33 Abs. 4 Z 3 lit. c", "Rz 795a · S. 479") from the first one.
 */
export function cleanSourceText(raw: string): CleanedSourceText {
  let text = raw.replace(/^\s*(?:\.{3}|…)\s*/u, "").replace(LEADING_FRAGMENT_PATTERN, "");
  let locator: string | undefined;
  text = text.replace(BREADCRUMB_PATTERN, (crumb) => {
    locator ??= locatorFromBreadcrumb(crumb);
    return " ";
  });
  const truncated = TRUNCATED_BREADCRUMB_PATTERN.test(text);
  if (truncated) text = `${text.replace(TRUNCATED_BREADCRUMB_PATTERN, "").trimEnd()} ...`;
  text = germanizeDates(text)
    .replace(/^[ \t]*#{1,6}[ \t]+/gmu, "")
    .replace(/(\S)[ \t]+#{1,6}[ \t]+/gu, "$1 ")
    .replace(/\s*#{1,6}\s*$/u, "")
    .replace(/(\S)\s+\S*[^\s.…](?:…|\.{3})\s*$/u, "$1 …")
    .replace(/[ \t]{2,}/gu, " ")
    .replace(/[ \t]*\n[ \t]*/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  return { text, ...(locator ? { locator } : {}) };
}

export type FaqParts = { question: string; answer: string };

/**
 * "Q: … | A: …" (snippets) and "Q: …\nSimilar Questions:\n- …\nAnswers:\n- …" (excerpts) → question + answer;
 * the English index metadata is dropped. Null when the text is not a FAQ row.
 */
export function parseFaq(text: string): FaqParts | null {
  const inline = splitFaq(text);
  if (inline) return { question: inline.question, answer: inline.answer };
  const match = /^\s*Q:\s*([^\n]*?)\s*(?:\n[\s\S]*)?$/u.exec(text);
  if (!match || !match[1].trim()) return null;
  const answers = /\n\s*Answers?:\s*(?:\n\s*)?(?:-\s+)?([\s\S]*)$/u.exec(text);
  return { question: match[1].trim(), answer: answers ? answers[1].trim() : "" };
}

// ── Row extraction ──────────────────────────────────────────────────────────

const ROW_CONTAINER_KEYS = [
  "results", "chunk_results", "knowledge_results", "chunks", "matches", "references", "documents", "items",
  "data", "result", "output", "sources", "hits",
];

function isRow(record: Record<string, unknown>): boolean {
  if ("knowledge_title" in record || "match_snippet" in record || "result_index" in record) return true;
  const hasTitle = ["title", "doc", "document_name", "file_name", "name", "faq_standard_question"].some((key) => typeof record[key] === "string");
  const hasBody = ["content", "snippet", "text", "description", "url", "link", "page_content"].some((key) => typeof record[key] === "string");
  return hasTitle && hasBody;
}

function collectRows(value: unknown, depth = 0, rows: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (depth > MAX_PAYLOAD_DEPTH || rows.length >= MAX_ROWS_SCANNED) return rows;
  const parsed = parseMaybeJson(value);
  if (Array.isArray(parsed)) {
    for (const item of parsed.slice(0, MAX_ROWS_SCANNED)) {
      const record = recordOf(item);
      if (record && isRow(record)) rows.push(record);
      else if (record || Array.isArray(item)) collectRows(item, depth + 1, rows);
      if (rows.length >= MAX_ROWS_SCANNED) break;
    }
    return rows;
  }
  const record = recordOf(parsed);
  if (!record) return rows;
  if (isRow(record)) {
    rows.push(record);
    return rows;
  }
  for (const key of ROW_CONTAINER_KEYS) {
    if (record[key] !== undefined) collectRows(record[key], depth + 1, rows);
  }
  return rows;
}

function numberOf(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

/** Upstream scores are 0..1; values up to 100 are read as percentages. Stored data is never rescaled. */
function normalizeScore(value: unknown, upstream = true): number | undefined {
  const score = numberOf(value);
  if (score === undefined || score < 0) return undefined;
  if (score <= 1) return Math.round(score * 1_000) / 1_000;
  if (upstream && score <= 100) return Math.round(score * 10) / 1_000;
  return undefined;
}

function sectionOf(row: Record<string, unknown>): string | undefined {
  const heading = sanitizeDisplayLine(row.heading ?? row.section ?? row.section_title ?? row.header ?? row.title_path, 80);
  if (heading) return heading;
  const page = numberOf(row.page ?? row.page_number ?? row.page_no);
  if (page !== undefined && page >= 0) return `Seite ${Math.round(page)}`;
  const start = numberOf(row.start_at ?? row.start);
  const end = numberOf(row.end_at ?? row.end);
  if (start !== undefined && end !== undefined && end >= start) return `Zeichen ${Math.round(start)}–${Math.round(end)}`;
  return undefined;
}

function rowToSource(row: Record<string, unknown>): { source: FredExecutionSource; query?: string } | null {
  const rawUrl = typeof row.url === "string" ? row.url : typeof row.link === "string" ? row.link : undefined;
  const url = rawUrl ? sanitizePublicSourceUrl(rawUrl) ?? undefined : undefined;
  const rawTitle = [row.knowledge_title, row.title, row.doc, row.document_name, row.file_name, row.name, row.faq_standard_question]
    .find((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0);
  const content = typeof row.content === "string" ? row.content
    : typeof row.text === "string" ? row.text
      : typeof row.page_content === "string" ? row.page_content : undefined;
  const rawSnippet = typeof row.match_snippet === "string" ? row.match_snippet
    : typeof row.snippet === "string" ? row.snippet
      : typeof row.description === "string" ? row.description : undefined;

  const knowledgeBaseType = typeof row.knowledge_base_type === "string" ? row.knowledge_base_type : undefined;
  const title = sanitizeDisplayLine(rawTitle ?? (url ? sourceDomain(url) : undefined), MAX_SOURCE_TITLE_CHARS);
  if (!title) return null;

  const excerptText = sanitizeDisplayBlock(content, MAX_SOURCE_EXCERPT_CHARS);
  const snippetText = sanitizeDisplayBlock(rawSnippet, MAX_SOURCE_SNIPPET_CHARS)
    ?? (excerptText ? sanitizeDisplayBlock(excerptText.replace(/\s+/gu, " "), 240) : undefined);
  // Only keep a separate excerpt when it adds something beyond the snippet.
  const excerpt = excerptText && (!snippetText || excerptText.replace(/\s+/gu, " ").length > snippetText.length + 12)
    ? excerptText
    : undefined;
  const score = normalizeScore(row.score ?? row.relevance ?? row.similarity);
  const matchType = sanitizeDisplayLine(row.match_type ?? row.matchType, 40);
  const section = sectionOf(row);
  const query = sanitizeDisplayLine(row.source_query, MAX_QUERY_CHARS);

  return {
    source: {
      title,
      kind: classifySource({ title, knowledgeBaseType, content: content ?? rawSnippet, url }),
      ...(snippetText ? { snippet: snippetText } : {}),
      ...(excerpt ? { excerpt } : {}),
      ...(score !== undefined ? { score } : {}),
      ...(matchType ? { matchType } : {}),
      ...(query ? { query } : {}),
      ...(url ? { url } : {}),
      ...(section ? { section } : {}),
    },
    ...(query ? { query } : {}),
  };
}

export function sourceKey(source: FredExecutionSource): string {
  const text = (source.snippet ?? source.excerpt ?? source.url ?? "").replace(/\s+/gu, " ").trim().toLowerCase();
  return `${prettifySourceTitle(source.title).toLowerCase()}|${text.slice(0, 120)}`;
}

/** Drops identical hits (title + snippet); the copy with the better score wins. */
export function dedupeSources(sources: readonly FredExecutionSource[]): FredExecutionSource[] {
  const byKey = new Map<string, FredExecutionSource>();
  for (const source of sources) {
    const key = sourceKey(source);
    const known = byKey.get(key);
    if (!known) byKey.set(key, source);
    else if ((source.score ?? -1) > (known.score ?? -1)) byKey.set(key, { ...known, ...source });
  }
  return [...byKey.values()];
}

export function extractSourcesFromPayload(candidates: readonly unknown[]): { sources: FredExecutionSource[]; queries: string[] } {
  const sources: FredExecutionSource[] = [];
  const queries = new Set<string>();
  for (const candidate of candidates) {
    for (const row of collectRows(candidate)) {
      const projected = rowToSource(row);
      if (!projected) continue;
      sources.push(projected.source);
      if (projected.query) queries.add(projected.query);
    }
    if (sources.length > 0) break;
  }
  return { sources: dedupeSources(sources).slice(0, MAX_STEP_SOURCES), queries: [...queries] };
}

const JSON_STRING = String.raw`"((?:[^"\\]|\\.)*)"?`;

function jsonField(segment: string, key: string): string | undefined {
  const match = new RegExp(`"${key}"\\s*:\\s*${JSON_STRING}`, "u").exec(segment);
  if (!match) return undefined;
  try {
    return JSON.parse(`"${match[1].replace(/\\$/u, "")}"`) as string;
  } catch {
    return match[1];
  }
}

/** Last resort for legacy results that were cut mid-JSON: pull hits out with regular expressions. */
export function salvageSourcesFromText(text: string): FredExecutionSource[] {
  if (!/"(?:knowledge_title|match_snippet)"/u.test(text)) return [];
  const segments = text.split(/(?="result_index"|\{\s*"(?:content|knowledge_id|chunk_id)")/u).slice(1, MAX_ROWS_SCANNED + 1);
  const sources: FredExecutionSource[] = [];
  for (const segment of segments) {
    const row: Record<string, unknown> = {
      knowledge_title: jsonField(segment, "knowledge_title"),
      content: jsonField(segment, "content"),
      match_snippet: jsonField(segment, "match_snippet"),
      match_type: jsonField(segment, "match_type"),
      source_query: jsonField(segment, "source_query"),
      knowledge_base_type: jsonField(segment, "knowledge_base_type"),
      score: /"score"\s*:\s*([\d.]+)/u.exec(segment)?.[1],
    };
    if (!row.knowledge_title) continue;
    const projected = rowToSource(row);
    if (projected) sources.push(projected.source);
  }
  return dedupeSources(sources).slice(0, MAX_STEP_SOURCES);
}

// ── Queries and facts ───────────────────────────────────────────────────────

const QUERY_KEYS = ["query", "queries", "search_query", "search_queries", "keywords", "keyword", "pattern", "patterns", "q", "search_term", "question"] as const;

function isSafeQueryText(raw: string): boolean {
  if (/^https?:\/\/(?:[^\s/$.?#]*\.(?:local|internal|corp|lan|service|intra)|localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01]))/iu.test(raw)) return false;
  if (/^(?:s3|gs|gcs|azure|blob|file|minio):\/\//iu.test(raw)) return false;
  if (/^(?:\/(?:var|tmp|etc|proc|sys|opt|home|root|usr|private)\/|[A-Za-z]:\\)/iu.test(raw)) return false;
  if (/(?:api[_-]?key|secret|password|passwd|auth[_-]?token|access[_-]?token)\s*[:=]/iu.test(raw)) return false;
  if (/\b(?:sk|ghp|gho|AIza)-[A-Za-z0-9_-]{8,}/iu.test(raw)) return false;
  if (/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIzaSy[A-Za-z0-9_-]{20,})/u.test(raw)) return false;
  if (/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/iu.test(raw)) return false;
  return true;
}

export function sanitizeQuery(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw.trim() || !isSafeQueryText(raw.trim())) return undefined;
  const text = sanitizeDisplayLine(raw, MAX_QUERY_CHARS);
  if (!text || /\[(?:REDACTED[A-Z_]*|intern)\]/u.test(text)) return undefined;
  return text;
}

export function argumentsRecord(raw: unknown): Record<string, unknown> | null {
  return recordOf(parseMaybeJson(raw));
}

export function extractQueries(args: Record<string, unknown> | null, extra: readonly string[] = []): string[] {
  const found: string[] = [];
  const push = (value: unknown) => {
    const query = sanitizeQuery(value);
    if (query && !found.some((known) => known.toLowerCase() === query.toLowerCase())) found.push(query);
  };
  if (args) {
    for (const key of QUERY_KEYS) {
      const value = args[key];
      if (Array.isArray(value)) {
        for (const item of value) push(typeof item === "string" ? item : recordOf(item)?.query ?? recordOf(item)?.text);
      } else {
        push(value);
      }
    }
  }
  for (const query of extra) push(query);
  return found.slice(0, MAX_STEP_QUERIES);
}

const FACT_LABELS: Record<string, string> = {
  query: "Suche", queries: "Suchen", url: "Adresse", limit: "Limit", top_k: "Max. Treffer", max_results: "Max. Treffer",
  language: "Sprache", lang: "Sprache", count: "Anzahl", name: "Name", task_name: "Aufgabe", task: "Aufgabe",
  command: "Befehl", path: "Datei", file: "Datei", filename: "Datei", file_name: "Datei", format: "Format", page: "Seite",
  page_size: "Seitengröße", offset: "Offset", year: "Jahr", date: "Datum", type: "Art", mode: "Modus", timeout: "Zeitlimit",
  topic: "Thema", title: "Titel", description: "Beschreibung", status: "Status", exit_code: "Exit-Code",
};

export function humanizeKey(key: string): string {
  const known = FACT_LABELS[key.toLowerCase()];
  if (known) return known;
  const words = key.replace(/([a-z])([A-Z])/gu, "$1 $2").replace(/[_-]+/gu, " ").trim().toLowerCase();
  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : key;
}

function factValue(value: unknown): string | undefined {
  if (typeof value === "boolean") return value ? "Ja" : "Nein";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return undefined;
  const text = sanitizeDisplayLine(value, MAX_FACT_VALUE_CHARS);
  if (!text || /\[(?:REDACTED[A-Z_]*|ID|intern|Modell)\]/u.test(text)) return undefined;
  return text;
}

/** Up to six non-sensitive scalar arguments as label/value pairs. */
export function extractFacts(
  args: Record<string, unknown> | null,
  omitKeys: ReadonlySet<string> = new Set(),
): FredExecutionFact[] {
  if (!args) return [];
  const facts: FredExecutionFact[] = [];
  for (const [key, raw] of Object.entries(args)) {
    if (facts.length >= MAX_STEP_FACTS) break;
    if (omitKeys.has(key) || isInternalKey(key)) continue;
    const value = factValue(raw);
    if (value === undefined) continue;
    facts.push({ label: humanizeKey(key), value });
  }
  return facts;
}

export const QUERY_KEY_SET: ReadonlySet<string> = new Set(QUERY_KEYS);
export const COMMAND_KEYS: ReadonlySet<string> = new Set(["command", "cmd", "script", "code"]);

// ── Errors and summaries ────────────────────────────────────────────────────

/** Maps raw upstream errors to a short, non-technical German message. */
export function classifyError(raw: unknown): string {
  const text = typeof raw === "string" ? raw.toLowerCase() : "";
  if (/time(?:d)?[ -]?out|zeit(?:ü|u)berschreitung|deadline/u.test(text)) return "Zeitüberschreitung";
  if (/not found|404|nicht gefunden|no such/u.test(text)) return "Nicht gefunden";
  if (/rate.?limit|429|quota|too many/u.test(text)) return "Anfragelimit erreicht";
  if (/permission|forbidden|unauthori[sz]ed|denied|\b40[13]\b/u.test(text)) return "Zugriff nicht möglich";
  return "Schritt fehlgeschlagen";
}

/** Short plain-text summary of an arbitrary payload; never returns structured JSON. */
export function summarizePayloadText(value: unknown, maximum = 280): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  // JSON that failed to parse (cut mid-way) is not meaningful as text.
  if (/^[{[]/u.test(trimmed)) return undefined;
  const text = sanitizeDisplayLine(trimmed.replace(/^#+\s*/gmu, "").replace(/^Fehler:\s*/u, ""), maximum);
  return text && !/^[\W_]+$/u.test(text) ? text : undefined;
}

// ── Re-validation of stored / streamed data ─────────────────────────────────

const SOURCE_KINDS: ReadonlySet<string> = new Set(["law", "guideline", "faq", "bfg", "web", "document"]);

/** Validates and re-sanitizes a source coming from storage or the wire. */
export function sanitizeStoredSource(value: unknown): FredExecutionSource | null {
  const record = recordOf(value);
  if (!record) return null;
  const title = sanitizeDisplayLine(record.title, MAX_SOURCE_TITLE_CHARS);
  if (!title) return null;
  const rawUrl = typeof record.url === "string" ? sanitizePublicSourceUrl(record.url) ?? undefined : undefined;
  const snippet = sanitizeDisplayBlock(record.snippet, MAX_SOURCE_SNIPPET_CHARS);
  const excerpt = sanitizeDisplayBlock(record.excerpt, MAX_SOURCE_EXCERPT_CHARS);
  const score = normalizeScore(record.score, false);
  const matchType = sanitizeDisplayLine(record.matchType, 40);
  const query = sanitizeDisplayLine(record.query, MAX_QUERY_CHARS);
  const section = sanitizeDisplayLine(record.section, 80);
  const kind = typeof record.kind === "string" && SOURCE_KINDS.has(record.kind)
    ? record.kind as FredExecutionSourceKind
    : classifySource({ title, content: snippet ?? excerpt, url: rawUrl });
  return {
    title,
    kind,
    ...(snippet ? { snippet } : {}),
    ...(excerpt ? { excerpt } : {}),
    ...(score !== undefined ? { score } : {}),
    ...(matchType ? { matchType } : {}),
    ...(query ? { query } : {}),
    ...(rawUrl ? { url: rawUrl } : {}),
    ...(section ? { section } : {}),
  };
}

/** One entry of a WeKnora `references` event (record, URL string or document name). */
export function sourceFromReference(item: unknown): FredExecutionSource | null {
  if (typeof item === "string") {
    const text = item.trim();
    if (!text) return null;
    const url = sanitizePublicSourceUrl(text) ?? undefined;
    return sanitizeStoredSource(url
      ? { title: sourceDomain(url) ?? text, url, kind: "web" }
      : { title: text });
  }
  const record = recordOf(item);
  if (!record) return null;
  return rowToSource(record)?.source
    ?? sanitizeStoredSource({
      title: record.doc ?? record.title ?? record.document_name ?? record.file_name ?? record.name,
      url: record.url ?? record.link,
    });
}

export function sanitizeStoredFacts(value: unknown): FredExecutionFact[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_STEP_FACTS).flatMap((candidate) => {
    const record = recordOf(candidate);
    const label = sanitizeDisplayLine(record?.label, 40);
    const factText = sanitizeDisplayLine(record?.value, MAX_FACT_VALUE_CHARS);
    return label && factText ? [{ label, value: factText }] : [];
  });
}

/** Rows of `chunks` style results that carry only text and a position (document reads). */
export function extractChunkExcerpts(candidates: readonly unknown[], fallbackTitle: string): FredExecutionSource[] {
  const sources: FredExecutionSource[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > MAX_PAYLOAD_DEPTH || sources.length >= MAX_STEP_SOURCES) return;
    const parsed = parseMaybeJson(value);
    if (Array.isArray(parsed)) {
      for (const item of parsed.slice(0, MAX_STEP_SOURCES)) visit(item, depth + 1);
      return;
    }
    const record = recordOf(parsed);
    if (!record) return;
    if (typeof record.content === "string" && record.content.trim()) {
      const title = [record.knowledge_title, record.title, record.file_name, record.doc]
        .find((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0) ?? fallbackTitle;
      const projected = rowToSource({ ...record, knowledge_title: title });
      if (projected) sources.push(projected.source);
      return;
    }
    for (const key of ["chunks", "results", "data", "result", "items"]) {
      if (record[key] !== undefined) visit(record[key], depth + 1);
    }
  };
  for (const candidate of candidates) {
    visit(candidate, 0);
    if (sources.length > 0) break;
  }
  return sources;
}

export function titleFromPayload(candidates: readonly unknown[]): string | undefined {
  for (const candidate of candidates) {
    const record = recordOf(parseMaybeJson(candidate));
    if (!record) continue;
    for (const key of ["knowledge_title", "title", "file_name", "doc", "document_name", "name"]) {
      const text = sanitizeDisplayLine(record[key], MAX_SOURCE_TITLE_CHARS);
      if (text) return text;
    }
  }
  return undefined;
}
