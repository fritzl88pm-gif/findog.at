/**
 * Pure view-model helpers for the advanced execution view (no React, no DOM).
 */
import type { FredSourceReference } from "@/lib/weknora/fred-research";

import {
  cleanSourceText,
  dedupeSources,
  parseFaq,
  prettifySourceTitle,
  sanitizeStoredSource,
  toolVariant,
  type FaqParts,
  type FredExecutionSource,
} from "./execution-structured";
import type { FredExecutionStep } from "./execution-trace";

export type ExecutionIconKey =
  | "analysis" | "search" | "read" | "web" | "shell" | "agent" | "planning" | "memory" | "context" | "sources" | "generic";

export const MAX_AGGREGATED_SOURCES = 8;

export function executionIconKey(step: Pick<FredExecutionStep, "kind" | "toolName">): ExecutionIconKey {
  const variant = toolVariant(step.toolName);
  switch (step.kind) {
    case "analysis":
    case "evaluation":
      return "analysis";
    case "planning":
    case "memory":
    case "context":
    case "agent":
    case "sources":
      return step.kind;
    case "knowledge":
      return variant === "read" ? "read" : "search";
    case "web":
      return "web";
    default:
      if (variant === "shell") return "shell";
      if (variant === "agent") return "agent";
      if (variant === "read") return "read";
      if (variant === "search") return "search";
      if (variant === "web") return "web";
      return "generic";
  }
}

export function formatDuration(ms: number): string {
  if (ms < 100) return "<0,1 s";
  if (ms >= 60_000) {
    const minutes = Math.floor(ms / 60_000);
    const seconds = Math.round((ms % 60_000) / 1_000);
    return `${minutes} min ${seconds} s`;
  }
  return `${(ms / 1_000).toLocaleString("de-AT", { maximumFractionDigits: 1 })} s`;
}

const MATCH_TYPE_LABELS: Record<string, string> = {
  vector: "Semantisch",
  embedding: "Semantisch",
  semantic: "Semantisch",
  keyword: "Stichwort",
  keywords: "Stichwort",
  bm25: "Stichwort",
  hybrid: "Hybrid",
  exact: "Exakt",
  grep: "Textsuche",
  rerank: "Neu gewichtet",
};

export function matchTypeLabel(matchType: string | undefined): string | undefined {
  if (!matchType) return undefined;
  const key = matchType.trim().toLowerCase();
  if (MATCH_TYPE_LABELS[key]) return MATCH_TYPE_LABELS[key];
  return /^[\p{L} -]{2,20}$/u.test(matchType.trim()) ? matchType.trim() : undefined;
}

/** Converts the answer's final source references (names/links only) into display sources. */
function sourcesFromReferences(references: readonly FredSourceReference[]): FredExecutionSource[] {
  return references.flatMap((reference) => {
    const source = reference.kind === "web"
      ? sanitizeStoredSource({ title: reference.title || reference.url, url: reference.url, kind: "web" })
      : sanitizeStoredSource({ title: reference.doc });
    return source ? [source] : [];
  });
}

/**
 * Top sources of the whole answer: hits of all steps, deduplicated by title + snippet and ordered by
 * relevance, followed by the answer's final references that no step hit already covers.
 */
export function aggregateExecutionSources(
  steps: readonly FredExecutionStep[],
  references: readonly FredSourceReference[] = [],
  limit = MAX_AGGREGATED_SOURCES,
): FredExecutionSource[] {
  const fromSteps = dedupeSources(steps.flatMap((step) => step.sources ?? []))
    .map((source, index) => ({ source, index }))
    .sort((left, right) => (right.source.score ?? -1) - (left.source.score ?? -1) || left.index - right.index)
    .map(({ source }) => source);
  const seenTitles = new Set(fromSteps.map((source) => prettifySourceTitle(source.title).toLowerCase()));
  const extra = dedupeSources(sourcesFromReferences(references))
    .filter((source) => !seenTitles.has(prettifySourceTitle(source.title).toLowerCase()));
  return [...fromSteps, ...extra].slice(0, limit);
}

export type ExecutionOverview = {
  steps: number;
  tools: number;
  sources: number;
  durationMs?: number;
};

export function buildExecutionOverview(
  steps: readonly FredExecutionStep[],
  references: readonly FredSourceReference[] = [],
): ExecutionOverview {
  const toolKinds = new Set(["knowledge", "web", "tool", "planning"]);
  const sourceCount = aggregateExecutionSources(steps, references, Number.MAX_SAFE_INTEGER).length;
  const total = steps
    .filter((step) => !step.parentId && step.durationMs !== undefined)
    .reduce((sum, step) => sum + (step.durationMs ?? 0), 0);
  return {
    steps: steps.length,
    tools: steps.filter((step) => toolKinds.has(step.kind)).length,
    sources: sourceCount,
    ...(total > 0 ? { durationMs: total } : {}),
  };
}

export type PlanningDetail = {
  notes: string[];
  items: Array<{ state: "done" | "active" | "open"; text: string }>;
};

/** Splits the stored planning detail ("- [x] task" lines plus summary lines). */
export function parsePlanningDetail(detail: string): PlanningDetail {
  const notes: string[] = [];
  const items: PlanningDetail["items"] = [];
  for (const line of detail.split("\n")) {
    const match = /^- \[([ x/])\]\s+(.*)$/u.exec(line);
    if (match) {
      items.push({ state: match[1] === "x" ? "done" : match[1] === "/" ? "active" : "open", text: match[2] });
    } else if (line.trim()) {
      notes.push(line.trim());
    }
  }
  return { notes, items };
}

export function pluralize(count: number, singular: string, plural: string): string {
  return `${count.toLocaleString("de-AT")} ${count === 1 ? singular : plural}`;
}

// ── Source card view model ──────────────────────────────────────────────────

export const FAQ_TITLE_CHARS = 90;
const LEGACY_SECTION_PATTERN = /^Abschnitt\s+\d+$/u;

export type SourceView = {
  /** Card heading: prettified document title, or the (shortened) question for FAQ rows. */
  title: string;
  /** FAQ rows: the knowledge-base title as small secondary text. */
  subtitle?: string;
  /** Short human locator ("§ 33 Abs. 4 Z 3 lit. c", "Rz 795a · S. 479"). */
  locator?: string;
  faq?: FaqParts;
  snippet?: string;
  excerpt?: string;
};

export function shortenText(text: string, maximum: number): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  if (flat.length <= maximum) return flat;
  const cut = flat.slice(0, maximum);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > maximum * 0.6 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

function flatLength(text: string): number {
  return text.replace(/\s+/gu, " ").replace(/\s*(?:\.{3}|…)$/u, "").trim().length;
}

/** Cut texts end on a whole word: drop the (likely partial) last word before a trailing ellipsis. */
function endOnWord(text: string | undefined): string | undefined {
  if (!text) return text;
  return text.replace(/(\S)\s+[^\s.…]+\s*(?:…|\.{3})\s*$/u, "$1 …");
}

/**
 * Display projection of a source hit: index breadcrumbs / metadata stripped, ISO dates in German
 * format, FAQ rows split into question + answer and a human locator instead of internal chunk numbers.
 */
export function buildSourceView(source: FredExecutionSource): SourceView {
  const kind = source.kind ?? "document";
  const baseTitle = kind === "web" ? source.title : prettifySourceTitle(source.title);
  const snippet = source.snippet ? cleanSourceText(source.snippet) : undefined;
  const excerpt = source.excerpt ? cleanSourceText(source.excerpt) : undefined;
  const locator = snippet?.locator ?? excerpt?.locator
    ?? (source.section && !LEGACY_SECTION_PATTERN.test(source.section) ? source.section : undefined);

  if (kind === "faq") {
    const fromSnippet = snippet ? parseFaq(snippet.text) : null;
    const fromExcerpt = excerpt ? parseFaq(excerpt.text) : null;
    const primary = fromSnippet ?? fromExcerpt;
    if (primary) {
      const answers = [fromSnippet?.answer, fromExcerpt?.answer].filter((answer): answer is string => Boolean(answer));
      const answer = answers.sort((left, right) => right.length - left.length)[0] ?? "";
      return {
        title: shortenText(primary.question, FAQ_TITLE_CHARS),
        subtitle: baseTitle,
        ...(locator ? { locator } : {}),
        faq: { question: primary.question, answer: endOnWord(answer) ?? "" },
      };
    }
  }

  const keepExcerpt = excerpt?.text && flatLength(excerpt.text) > (snippet ? flatLength(snippet.text) : 0) + 12;
  return {
    title: baseTitle,
    ...(locator ? { locator } : {}),
    ...(snippet?.text ? { snippet: endOnWord(snippet.text) } : {}),
    ...(keepExcerpt && excerpt ? { excerpt: endOnWord(excerpt.text) } : {}),
  };
}
