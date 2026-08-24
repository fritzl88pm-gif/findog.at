export const FRED_CONTENT_TRANSFORMATION = "weknora-research-de-v1";

export type FredResearchStepKind = "analysis" | "knowledge" | "web" | "tool" | "evaluation" | "sources";
export type FredResearchStepStatus = "running" | "completed" | "failed";

export type FredKnowledgeSource = {
  kind: "knowledge";
  doc: string;
  chunkId?: string;
  knowledgeBaseId?: string;
};

export type FredWebSource = {
  kind: "web";
  url: string;
  title?: string;
};

export type FredSourceReference = FredKnowledgeSource | FredWebSource;

export type FredResearchStep = {
  id: string;
  kind: FredResearchStepKind;
  status: FredResearchStepStatus;
  label: string;
  detail?: string;
  durationMs?: number;
};

export type FredResearchUpdate = {
  step?: FredResearchStep;
  sources: FredSourceReference[];
  fatalError: boolean;
  unsupported: boolean;
};

const COMPLETE_CITATION_TAG = /<(kb|web)\b([^>]{0,4096})\s*\/?>/giu;
const ATTRIBUTE = /([a-z_][a-z0-9_-]*)\s*=\s*(["'])(.*?)\2/giu;
const TOOL_HINTS: Array<{ pattern: RegExp; kind: FredResearchStepKind; running: string; completed: string }> = [
  {
    pattern: /(?:knowledge|knowledge_base|kb|chunk|document|grep|retrieve|search_docs)/iu,
    kind: "knowledge",
    running: "Wissensbasis wird durchsucht",
    completed: "Wissensbasis durchsucht",
  },
  {
    pattern: /(?:web|internet|browser|search_engine)/iu,
    kind: "web",
    running: "Websuche wird durchgeführt",
    completed: "Websuche durchgeführt",
  },
];

import {
  sanitizePublicSourceUrl,
  sanitizeSafeId,
  sanitizeSafeLabel,
} from "@/lib/fred/safe-research-display";

export {
  sanitizePublicSourceUrl,
  sanitizeSafeId,
  sanitizeSafeLabel,
};


function firstValidId(value: unknown, maxLength = 128): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const text = sanitizeSafeId(entry, maxLength);
      if (text) return text;
    }
  }
  return undefined;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function decodeAttribute(value: string): string {
  return value
    .replace(/&quot;/giu, '"')
    .replace(/&#(?:39|x27);/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&amp;/giu, "&");
}

function attributes(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of value.matchAll(ATTRIBUTE)) {
    result[match[1].toLowerCase()] = decodeAttribute(match[3]);
  }
  return result;
}

function sourceKey(source: FredSourceReference): string {
  return source.kind === "knowledge"
    ? `knowledge:${source.knowledgeBaseId ?? ""}:${source.chunkId ?? ""}:${source.doc}`
    : `web:${source.url}`;
}

export function mergeFredSources(...groups: FredSourceReference[][]): FredSourceReference[] {
  const sources = new Map<string, FredSourceReference>();
  for (const source of groups.flat()) sources.set(sourceKey(source), source);
  return [...sources.values()].slice(0, 100);
}

function citationSource(kind: string, rawAttributes: string): FredSourceReference | null {
  const values = attributes(rawAttributes);
  if (kind.toLowerCase() === "kb") {
    const doc = sanitizeSafeLabel(values.doc, 512);
    if (!doc) return null;
    const chunkId = sanitizeSafeId(values.chunk_id ?? values.faq_id, 128);
    const knowledgeBaseId = sanitizeSafeId(
      values.kb_id ?? values.knowledge_base_id ?? values.knowledge_base,
      128,
    );
    return {
      kind: "knowledge",
      doc,
      ...(chunkId ? { chunkId } : {}),
      ...(knowledgeBaseId ? { knowledgeBaseId } : {}),
    };
  }
  const url = sanitizePublicSourceUrl(values.url, 2_048);
  if (!url) return null;
  const title = sanitizeSafeLabel(values.title, 512);
  return { kind: "web", url, ...(title ? { title } : {}) };
}

function incompleteCitationStart(value: string): number {
  const start = value.lastIndexOf("<");
  if (start < 0 || value.indexOf(">", start) >= 0) return -1;
  const tail = value.slice(start).toLowerCase();
  return /^(?:<|<k|<kb(?:\s|$)|<w|<we|<web(?:\s|$))/u.test(tail) ? start : -1;
}

export function transformWeKnoraAnswer(
  rawContent: string,
  options: { streaming?: boolean } = {},
): { text: string; sources: FredSourceReference[] } {
  const sources: FredSourceReference[] = [];
  let text = rawContent.replace(
    COMPLETE_CITATION_TAG,
    (_tag, kind: string, rawAttributes: string) => {
      const source = citationSource(kind, rawAttributes);
      if (source) sources.push(source);
      return "";
    },
  );
  if (options.streaming) {
    const incompleteStart = incompleteCitationStart(text);
    if (incompleteStart >= 0) text = text.slice(0, incompleteStart);
  }
  return { text, sources: mergeFredSources(sources) };
}

function sourceFromObject(
  value: unknown,
  parentData?: Record<string, unknown> | null,
): FredSourceReference | null {
  const item = recordOf(value);
  if (!item) return null;

  // 1. Check Web source
  const rawUrl = item.url ?? item.link;
  if (rawUrl !== undefined && rawUrl !== null) {
    const url = sanitizePublicSourceUrl(rawUrl, 2_048);
    if (!url) return null;
    const title = sanitizeSafeLabel(item.title ?? item.source ?? item.name, 512);
    return {
      kind: "web",
      url,
      ...(title ? { title } : {}),
    };
  }

  // 2. Check Knowledge source
  const rawDoc = item.faq_standard_question
    ?? item.faq_question
    ?? item.doc
    ?? item.document_name
    ?? item.file_name
    ?? item.filename
    ?? item.title
    ?? item.knowledge_title
    ?? parentData?.faq_standard_question
    ?? parentData?.faq_question
    ?? parentData?.knowledge_title
    ?? parentData?.title
    ?? parentData?.doc;

  const doc = sanitizeSafeLabel(rawDoc, 512);
  if (!doc) return null;

  const rawChunkId = item.chunk_id
    ?? item.chunkId
    ?? item.faq_id
    ?? item.faqId
    ?? (Array.isArray(item.chunks) && item.chunks.length > 0 && recordOf(item.chunks[0])
      ? (recordOf(item.chunks[0])?.chunk_id ?? recordOf(item.chunks[0])?.faq_id ?? recordOf(item.chunks[0])?.id)
      : undefined)
    ?? item.id;

  const chunkId = sanitizeSafeId(rawChunkId, 128);

  const rawKnowledgeBaseId = item.kb_id
    ?? item.knowledge_base_id
    ?? item.knowledgeBaseId
    ?? item.knowledge_base
    ?? item.knowledgeBase
    ?? parentData?.knowledge_base_id
    ?? parentData?.kb_id
    ?? parentData?.knowledgeBaseId
    ?? parentData?.knowledge_base
    ?? parentData?.knowledgeBase
    ?? firstValidId(item.knowledge_base_ids)
    ?? firstValidId(item.kb_ids)
    ?? firstValidId(parentData?.knowledge_base_ids)
    ?? firstValidId(parentData?.kb_ids);

  const knowledgeBaseId = sanitizeSafeId(rawKnowledgeBaseId, 128);

  return {
    kind: "knowledge",
    doc,
    ...(chunkId ? { chunkId } : {}),
    ...(knowledgeBaseId ? { knowledgeBaseId } : {}),
  };
}

function sourcesFromUnknown(value: unknown, parentData?: Record<string, unknown> | null): FredSourceReference[] {
  if (Array.isArray(value)) {
    return mergeFredSources(value.flatMap((item) => {
      const direct = sourceFromObject(item, parentData);
      if (direct) return [direct];
      const record = recordOf(item);
      return record ? sourcesFromUnknown(record.references ?? record.sources ?? record.chunks, record) : [];
    }));
  }
  const record = recordOf(value);
  if (!record) return [];
  const direct = sourceFromObject(record, parentData);
  if (direct) return [direct];
  return sourcesFromUnknown(record.references ?? record.sources ?? record.chunks, record);
}

const NATIVE_RESULTS_TOOLS = new Set([
  "web_search",
  "web_fetch",
  "search_knowledge",
  "knowledge_search",
  "grep_chunks",
  "list_knowledge_chunks",
  "wiki_read_source_doc",
]);

const NATIVE_GREP_TOOLS = new Set([
  "grep_chunks",
  "search_knowledge",
  "knowledge_search",
  "wiki_read_source_doc",
]);

const NATIVE_CHUNKS_TOOLS = new Set([
  "list_knowledge_chunks",
  "grep_chunks",
  "search_knowledge",
  "knowledge_search",
  "wiki_read_source_doc",
]);

export type ParseWeKnoraResearchEventOptions = {
  includeDirectSources?: boolean;
  researchDisplayMode?: "simple" | "advanced" | string;
};

function extractToolSources(
  toolName: string,
  data: Record<string, unknown>,
  event: Record<string, unknown>,
  options?: ParseWeKnoraResearchEventOptions,
): FredSourceReference[] {
  const resultRecord = recordOf(data.result) ?? recordOf(event.result);
  const sources: FredSourceReference[] = [];

  // 1. Direct references / sources envelope (enabled in all modes)
  const envelopeSources = sourcesFromUnknown(data.references ?? data.sources ?? event.references, data);
  sources.push(...envelopeSources);

  const includeDirect = options?.includeDirectSources === true;
  if (!includeDirect) {
    return mergeFredSources(sources);
  }

  const normalizedTool = boundedText(toolName, 180).toLowerCase();

  // 2. Direct results from tool payloads (web_search, search_knowledge, etc.)
  if (NATIVE_RESULTS_TOOLS.has(normalizedTool)) {
    const resultsArray = (Array.isArray(data.results) ? data.results : undefined)
      ?? (resultRecord && Array.isArray(resultRecord.results) ? resultRecord.results : undefined)
      ?? (Array.isArray(event.results) ? event.results : undefined);

    if (resultsArray) {
      for (const item of resultsArray) {
        const src = sourceFromObject(item, data);
        if (src) sources.push(src);
      }
    }
  }

  // 3. grep_chunks (chunk_results and knowledge_results)
  if (NATIVE_GREP_TOOLS.has(normalizedTool)) {
    const chunkResults = (Array.isArray(data.chunk_results) ? data.chunk_results : undefined)
      ?? (resultRecord && Array.isArray(resultRecord.chunk_results) ? resultRecord.chunk_results : undefined)
      ?? (Array.isArray(event.chunk_results) ? event.chunk_results : undefined);
    if (chunkResults) {
      for (const item of chunkResults) {
        const src = sourceFromObject(item, data);
        if (src) sources.push(src);
      }
    }

    const knowledgeResults = (Array.isArray(data.knowledge_results) ? data.knowledge_results : undefined)
      ?? (resultRecord && Array.isArray(resultRecord.knowledge_results) ? resultRecord.knowledge_results : undefined)
      ?? (Array.isArray(event.knowledge_results) ? event.knowledge_results : undefined);
    if (knowledgeResults) {
      for (const item of knowledgeResults) {
        const src = sourceFromObject(item, data);
        if (src) sources.push(src);
      }
    }
  }

  // 4. list_knowledge_chunks (chunks)
  if (NATIVE_CHUNKS_TOOLS.has(normalizedTool)) {
    const chunks = (Array.isArray(data.chunks) ? data.chunks : undefined)
      ?? (resultRecord && Array.isArray(resultRecord.chunks) ? resultRecord.chunks : undefined)
      ?? (Array.isArray(event.chunks) ? event.chunks : undefined);
    if (chunks) {
      for (const item of chunks) {
        const src = sourceFromObject(item, data);
        if (src) sources.push(src);
      }
    }
  }

  return mergeFredSources(sources);
}

function eventId(event: Record<string, unknown>, data: Record<string, unknown>, prefix: string): string {
  return boundedText(
    data.tool_call_id ?? data.event_id ?? event.event_id ?? event.id,
    180,
  ) || `${prefix}:${boundedText(data.iteration ?? event.iteration, 20) || "0"}`;
}

function toolPresentation(toolName: string): {
  kind: FredResearchStepKind;
  running: string;
  completed: string;
} {
  return TOOL_HINTS.find((hint) => hint.pattern.test(toolName)) ?? {
    kind: "tool",
    running: "Recherchewerkzeug wird ausgeführt",
    completed: "Recherchewerkzeug ausgeführt",
  };
}

function durationMs(value: unknown): number | undefined {
  const duration = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(duration) || duration < 0) return undefined;
  return Math.min(Math.round(duration), 3_600_000);
}

export function parseWeKnoraResearchEvent(
  value: unknown,
  options?: ParseWeKnoraResearchEventOptions,
): FredResearchUpdate {
  const event = recordOf(value);
  if (!event) return { sources: [], fatalError: false, unsupported: false };
  const responseType = boundedText(event.response_type ?? event.type, 80).toLowerCase();
  const data = recordOf(event.data) ?? {};
  const toolName = boundedText(data.tool_name ?? event.tool_name, 180);
  const sources = extractToolSources(toolName, data, event, options);

  if (responseType === "tool_approval_required" || responseType === "mcp_oauth_required") {
    return { sources, fatalError: false, unsupported: true };
  }
  if (responseType === "error" && !boundedText(data.tool_name ?? event.tool_name, 180)) {
    return { sources, fatalError: true, unsupported: false };
  }
  if (responseType === "thinking") {
    const done = data.done === true || event.done === true;
    return {
      sources,
      fatalError: false,
      unsupported: false,
      step: {
        id: eventId(event, data, "analysis"),
        kind: "analysis",
        status: done ? "completed" : "running",
        label: done ? "Anfrage analysiert" : "Anfrage wird analysiert",
      },
    };
  }
  if (responseType === "reflection") {
    const done = data.done === true || event.done === true;
    return {
      sources,
      fatalError: false,
      unsupported: false,
      step: {
        id: eventId(event, data, "evaluation"),
        kind: "evaluation",
        status: done ? "completed" : "running",
        label: done ? "Rechercheergebnisse bewertet" : "Rechercheergebnisse werden bewertet",
      },
    };
  }
  if (responseType === "references") {
    return {
      sources,
      fatalError: false,
      unsupported: false,
      step: sources.length > 0 ? {
        id: eventId(event, data, "sources"),
        kind: "sources",
        status: "completed",
        label: `${sources.length} ${sources.length === 1 ? "Quelle" : "Quellen"} gefunden`,
      } : undefined,
    };
  }
  if (responseType === "tool_call" || responseType === "tool_result" || responseType === "error") {
    const presentation = toolPresentation(toolName);
    const successful = responseType !== "error" && data.success !== false && event.success !== false;
    const finished = responseType !== "tool_call";
    return {
      sources,
      fatalError: false,
      unsupported: false,
      step: {
        id: eventId(event, data, `tool:${toolName || "unknown"}`),
        kind: presentation.kind,
        status: finished ? (successful ? "completed" : "failed") : "running",
        label: finished
          ? (successful ? presentation.completed : "Recherchewerkzeug fehlgeschlagen")
          : presentation.running,
        ...(durationMs(data.duration_ms ?? data.duration) !== undefined
          ? { durationMs: durationMs(data.duration_ms ?? data.duration) }
          : {}),
      },
    };
  }
  return { sources, fatalError: false, unsupported: false };
}

export function mergeFredResearchStep(
  steps: FredResearchStep[],
  update: FredResearchStep,
): FredResearchStep[] {
  const existingIndex = steps.findIndex((step) => step.id === update.id);
  if (existingIndex < 0) {
    if (steps.length > 0 && update.kind === "analysis") {
      const lastIndex = steps.length - 1;
      const lastStep = steps[lastIndex];
      if (lastStep.kind === "analysis") {
        const merged: FredResearchStep = {
          ...lastStep,
          status: update.status,
          label: update.label,
          ...(update.durationMs !== undefined ? { durationMs: update.durationMs } : (lastStep.durationMs !== undefined ? { durationMs: lastStep.durationMs } : {})),
        };
        const next = [...steps];
        next[lastIndex] = merged;
        return next;
      }
    }
    return [...steps, update].slice(-200);
  }
  const next = [...steps];
  next[existingIndex] = { ...next[existingIndex], ...update };
  return next;
}

export function parseStoredFredResearchTrace(value: unknown): FredResearchStep[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 200).flatMap((candidate) => {
    const item = recordOf(candidate);
    if (!item) return [];
    const id = boundedText(item.id, 180);
    const kind = boundedText(item.kind, 20) as FredResearchStepKind;
    const status = boundedText(item.status, 20) as FredResearchStepStatus;
    const label = boundedText(item.label, 200);
    if (
      !id
      || !["analysis", "knowledge", "web", "tool", "evaluation", "sources"].includes(kind)
      || !["running", "completed", "failed"].includes(status)
      || !label
    ) return [];
    const detail = boundedText(item.detail, 500);
    const duration = durationMs(item.durationMs);
    return [{
      id,
      kind,
      status,
      label,
      ...(detail ? { detail } : {}),
      ...(duration !== undefined ? { durationMs: duration } : {}),
    }];
  });
}

export function parseStoredFredSources(value: unknown): FredSourceReference[] {
  if (!Array.isArray(value)) return [];
  return mergeFredSources(value.flatMap((candidate): FredSourceReference[] => {
    const item = recordOf(candidate);
    if (!item) return [];
    if (item.kind === "web") {
      const url = sanitizePublicSourceUrl(item.url, 2_048);
      if (!url) return [];
      const title = sanitizeSafeLabel(item.title, 512);
      return [{
        kind: "web",
        url,
        ...(title ? { title } : {}),
      }];
    }
    if (item.kind !== "knowledge") return [];
    const doc = sanitizeSafeLabel(item.doc, 512);
    if (!doc) return [];
    const chunkId = sanitizeSafeId(item.chunkId ?? item.chunk_id ?? item.faqId ?? item.faq_id, 128);
    const knowledgeBaseId = sanitizeSafeId(
      item.knowledgeBaseId ?? item.knowledge_base_id ?? item.kb_id ?? item.knowledge_base ?? item.knowledgeBase,
      128,
    );
    return [{
      kind: "knowledge",
      doc,
      ...(chunkId ? { chunkId } : {}),
      ...(knowledgeBaseId ? { knowledgeBaseId } : {}),
    }];
  }));
}
