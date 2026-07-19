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
    const doc = boundedText(values.doc, 512);
    if (!doc) return null;
    const chunkId = boundedText(values.chunk_id, 128);
    const knowledgeBaseId = boundedText(values.kb_id, 128);
    return {
      kind: "knowledge",
      doc,
      ...(chunkId ? { chunkId } : {}),
      ...(knowledgeBaseId ? { knowledgeBaseId } : {}),
    };
  }
  const urlValue = boundedText(values.url, 2_048);
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const title = boundedText(values.title, 512);
  return { kind: "web", url: url.toString(), ...(title ? { title } : {}) };
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

function sourceFromObject(value: unknown): FredSourceReference | null {
  const item = recordOf(value);
  if (!item) return null;
  const url = boundedText(item.url ?? item.link, 2_048);
  if (url) return citationSource("web", `url="${url.replaceAll('"', "&quot;")}" title="${boundedText(item.title, 512).replaceAll('"', "&quot;")}"`);
  const doc = boundedText(
    item.doc ?? item.document_name ?? item.file_name ?? item.filename ?? item.title,
    512,
  );
  if (!doc) return null;
  const chunkId = boundedText(item.chunk_id ?? item.chunkId ?? item.id, 128);
  const knowledgeBaseId = boundedText(item.kb_id ?? item.knowledge_base_id ?? item.knowledgeBaseId, 128);
  return {
    kind: "knowledge",
    doc,
    ...(chunkId ? { chunkId } : {}),
    ...(knowledgeBaseId ? { knowledgeBaseId } : {}),
  };
}

function sourcesFromUnknown(value: unknown): FredSourceReference[] {
  if (Array.isArray(value)) {
    return mergeFredSources(value.flatMap((item) => {
      const direct = sourceFromObject(item);
      if (direct) return [direct];
      const record = recordOf(item);
      return record ? sourcesFromUnknown(record.references ?? record.sources ?? record.chunks) : [];
    }));
  }
  const record = recordOf(value);
  if (!record) return [];
  const direct = sourceFromObject(record);
  if (direct) return [direct];
  return sourcesFromUnknown(record.references ?? record.sources ?? record.chunks);
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

export function parseWeKnoraResearchEvent(value: unknown): FredResearchUpdate {
  const event = recordOf(value);
  if (!event) return { sources: [], fatalError: false, unsupported: false };
  const responseType = boundedText(event.response_type ?? event.type, 80).toLowerCase();
  const data = recordOf(event.data) ?? {};
  const sources = mergeFredSources(
    sourcesFromUnknown(data.references ?? data.sources ?? event.references),
  );

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
    const toolName = boundedText(data.tool_name ?? event.tool_name, 180);
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
  if (existingIndex < 0) return [...steps, update].slice(-200);
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
  return mergeFredSources(value.flatMap((candidate) => {
    const item = recordOf(candidate);
    if (!item) return [];
    if (item.kind === "web") {
      const url = boundedText(item.url, 2_048);
      return url ? [citationSource("web", `url="${url.replaceAll('"', "&quot;")}" title="${boundedText(item.title, 512).replaceAll('"', "&quot;")}"`)].filter((source): source is FredSourceReference => source !== null) : [];
    }
    if (item.kind !== "knowledge") return [];
    const doc = boundedText(item.doc, 512);
    if (!doc) return [];
    const chunkId = boundedText(item.chunkId, 128);
    const knowledgeBaseId = boundedText(item.knowledgeBaseId, 128);
    return [{
      kind: "knowledge" as const,
      doc,
      ...(chunkId ? { chunkId } : {}),
      ...(knowledgeBaseId ? { knowledgeBaseId } : {}),
    }];
  }));
}
