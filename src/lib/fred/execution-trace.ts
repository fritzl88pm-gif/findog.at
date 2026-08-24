export const MAX_EXECUTION_STEPS = 200;
export const MAX_EXECUTION_DETAIL_CHARS = 2000;
export const MAX_EXECUTION_LABEL_CHARS = 200;
export const MAX_PLANNING_TODOS_COUNT = 50;
export const MAX_PLANNING_TASK_CHARS = 200;

export type FredExecutionStepKind =
  | "analysis"
  | "planning"
  | "knowledge"
  | "web"
  | "tool"
  | "evaluation"
  | "sources";

export type FredExecutionStepStatus = "running" | "completed" | "failed";

export type FredPlanningCounts = {
  total?: number;
  open?: number;
  inProgress?: number;
  completed?: number;
};

export type FredExecutionStep = {
  id: string;
  kind: FredExecutionStepKind;
  status: FredExecutionStepStatus;
  label: string;
  detail?: string;
  durationMs?: number;
  counts?: FredPlanningCounts;
};

export type FredExecutionUpdate = {
  step?: FredExecutionStep;
  fatalError: boolean;
  unsupported: boolean;
};

const PLANNING_TOOL_PATTERN = /(?:todo|todos|task|tasks|plan|planning)/iu;
const KNOWLEDGE_TOOL_PATTERN = /(?:knowledge|knowledge_base|kb|chunk|document|grep|retrieve|search_docs)/iu;
const WEB_TOOL_PATTERN = /(?:web|internet|browser|search_engine|google)/iu;

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function durationMs(value: unknown): number | undefined {
  const duration = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(duration) || duration < 0) return undefined;
  return Math.min(Math.round(duration), 3_600_000);
}

function sanitizeControlCharacters(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function redactSensitiveText(input: string): string {
  return input
    // Bearer / Authorization tokens
    .replace(/\bBearer\s+[A-Za-z0-9_\-\.~+/]+=*/gi, "Bearer [REDACTED]")
    // API keys with standard prefixes
    .replace(/\b(?:sk|key|glpat|xox[baprs])-[A-Za-z0-9_\-]{8,}/gi, "[REDACTED_API_KEY]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIzaSy[A-Za-z0-9_-]{20,})/g, "[REDACTED_API_KEY]")
    .replace(/\bsk-[A-Za-z0-9_\-]{8,}/gi, "[REDACTED_API_KEY]")
    .replace(/\b(?:sk_live|sk_test)_[A-Za-z0-9]{16,}/gi, "[REDACTED_API_KEY]")
    // Secret / password / credential key-value assignments
    .replace(/\b(?:api[_-]?key|secret(?:[_-]?key)?|password|passwd|auth[_-]?token|access[_-]?token)[A-Za-z0-9_]*\s*[:=]\s*['"]?[^\s,'">]+['"]?/gi, "[REDACTED]")
    // JWT tokens
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, "[REDACTED_TOKEN]")
    // Database connection strings
    .replace(/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|mssql|cockroachdb):\/\/[^\s]+/gi, "[REDACTED_CONNECTION]")
    // Private storage URIs
    .replace(/\b(?:s3|gs|gcs|azure|blob|oss|cos|minio):\/\/[^\s]+/gi, "[REDACTED_STORAGE_URI]")
    // Local filesystem paths
    .replace(/(?:\/(?:var|tmp|etc|proc|sys|opt|home|root|usr|private|Users)\/[^\s'"]+)/gi, "[REDACTED_PATH]")
    .replace(/\b[A-Za-z]:\\[^\s'"]+/g, "[REDACTED_PATH]")
    // Internal/corporate URLs
    .replace(/\bhttps?:\/\/(?:[^\s/$.?#]*\.(?:local|internal|corp|lan|service|intra)|localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[0-1])\.\d+\.\d+)[^\s]*/gi, "[REDACTED_INTERNAL_URL]")
    // URLs with sensitive query parameters
    .replace(/\bhttps?:\/\/[^\s]*[?&](?:token|secret|password|key|api_key|access_token|auth)=[^&\s]+/gi, "[REDACTED_URL]");
}

export function sanitizeAndRedactDetail(value: unknown, maxLength = MAX_EXECUTION_DETAIL_CHARS): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = sanitizeControlCharacters(value);
  if (!sanitized.trim()) return undefined;
  const redacted = redactSensitiveText(sanitized);
  const bounded = redacted.slice(0, maxLength);
  return bounded || undefined;
}

function eventId(event: Record<string, unknown>, data: Record<string, unknown>, prefix: string): string {
  const upstreamId = boundedText(
    data.tool_call_id ?? data.event_id ?? event.event_id ?? event.id,
    180,
  ) || boundedText(data.iteration ?? event.iteration, 20) || "0";
  let hash = 2_166_136_261;
  for (let index = 0; index < upstreamId.length; index += 1) {
    hash = Math.imul(hash ^ upstreamId.charCodeAt(index), 16_777_619);
  }
  return `${prefix}:${(hash >>> 0).toString(36)}`;
}

function parseTodosFromUnknown(source: unknown): Array<Record<string, unknown>> | null {
  if (typeof source === "string" && source.length <= 100_000) {
    try {
      return parseTodosFromUnknown(JSON.parse(source) as unknown);
    } catch {
      return null;
    }
  }
  if (Array.isArray(source)) {
    const list = source.filter((item): item is Record<string, unknown> => Boolean(recordOf(item)));
    return list.length > 0 ? list : null;
  }
  const record = recordOf(source);
  if (!record) return null;
  if (record.todos !== undefined) return parseTodosFromUnknown(record.todos);
  if (record.tasks !== undefined) return parseTodosFromUnknown(record.tasks);
  if (record.items !== undefined) return parseTodosFromUnknown(record.items);
  if (record.plan !== undefined) return parseTodosFromUnknown(record.plan);
  if (record.todo_list !== undefined) return parseTodosFromUnknown(record.todo_list);
  if (record.todoList !== undefined) return parseTodosFromUnknown(record.todoList);
  return null;
}

function extractPlanningCounts(
  data: Record<string, unknown>,
  event: Record<string, unknown>,
): FredPlanningCounts | null {
  const candidates = [
    data.arguments,
    data.result,
    data.todos,
    data.tasks,
    event.arguments,
    event.result,
    event.todos,
  ];

  for (const candidate of candidates) {
    const items = parseTodosFromUnknown(candidate);
    if (items) {
      let completed = 0;
      let inProgress = 0;
      let open = 0;

      for (const item of items) {
        const status = boundedText(item.status ?? item.state, 40).toLowerCase();
        const isDone = item.completed === true || ["completed", "done", "finished", "success", "closed", "resolved"].includes(status);
        const isInProgress = ["in_progress", "in-progress", "running", "active", "in_bearbeitung", "in bearbeitung", "started"].includes(status);

        if (isDone) {
          completed += 1;
        } else if (isInProgress) {
          inProgress += 1;
        } else {
          open += 1;
        }
      }

      const total = items.length;
      return { total, completed, inProgress, open };
    }
  }

  return null;
}

function formatPlanningDetail(counts: FredPlanningCounts): string | undefined {
  const total = counts.total ?? 0;
  if (total <= 0) return undefined;

  const completed = counts.completed ?? 0;
  const inProgress = counts.inProgress ?? 0;
  const open = counts.open ?? 0;

  const parts: string[] = [`${total} ${total === 1 ? "Aufgabe" : "Aufgaben"} geplant`];
  if (completed > 0) parts.push(`${completed} abgeschlossen`);
  if (inProgress > 0) parts.push(`${inProgress} in Bearbeitung`);
  if (open > 0) parts.push(`${open} offen`);

  return parts.join(" · ");
}

function extractPlanningItems(
  data: Record<string, unknown>,
  event: Record<string, unknown>,
): Array<Record<string, unknown>> | null {
  const candidates = [
    data.arguments,
    data.result,
    data.todos,
    data.tasks,
    event.arguments,
    event.result,
    event.todos,
  ];

  for (const candidate of candidates) {
    const items = parseTodosFromUnknown(candidate);
    if (items && items.length > 0) {
      return items;
    }
  }
  return null;
}

function formatPlanningDetailWithItems(
  counts: FredPlanningCounts,
  items: Array<Record<string, unknown>> | null,
): string | undefined {
  const summary = formatPlanningDetail(counts);
  if (!items || items.length === 0) {
    return summary ? summary.slice(0, MAX_EXECUTION_DETAIL_CHARS) : undefined;
  }

  const lines: string[] = [];
  let currentLength = 0;

  if (summary) {
    const boundedSummary = summary.slice(0, MAX_EXECUTION_DETAIL_CHARS);
    lines.push(boundedSummary);
    currentLength = boundedSummary.length;
  }

  const cappedItems = items.slice(0, MAX_PLANNING_TODOS_COUNT);
  for (const item of cappedItems) {
    const rawTask = boundedText(
      item.task ?? item.title ?? item.label ?? item.description ?? item.text ?? item.content ?? item.name,
      MAX_PLANNING_TASK_CHARS,
    );
    const sanitizedTask = sanitizeAndRedactDetail(rawTask, MAX_PLANNING_TASK_CHARS);
    if (!sanitizedTask) continue;

    const status = boundedText(item.status ?? item.state, 40).toLowerCase();
    const isDone = item.completed === true || ["completed", "done", "finished", "success", "closed", "resolved"].includes(status);
    const isInProgress = ["in_progress", "in-progress", "running", "active", "in_bearbeitung", "in bearbeitung", "started"].includes(status);

    let prefix = "- [ ]";
    if (isDone) {
      prefix = "- [x]";
    } else if (isInProgress) {
      prefix = "- [/]";
    }

    const line = `${prefix} ${sanitizedTask}`;
    const addedLength = lines.length > 0 ? 1 + line.length : line.length;

    if (currentLength + addedLength <= MAX_EXECUTION_DETAIL_CHARS) {
      lines.push(line);
      currentLength += addedLength;
    } else {
      break;
    }
  }

  if (lines.length > 0) {
    const joined = lines.join("\n");
    return joined.length <= MAX_EXECUTION_DETAIL_CHARS
      ? joined
      : joined.slice(0, MAX_EXECUTION_DETAIL_CHARS);
  }

  return summary ? summary.slice(0, MAX_EXECUTION_DETAIL_CHARS) : undefined;
}

type ToolConfig = {
  kind: FredExecutionStepKind;
  running: string;
  completed: string;
  failed: string;
  isPlanning?: boolean;
};

function resolveToolConfig(toolName: string): ToolConfig {
  if (PLANNING_TOOL_PATTERN.test(toolName)) {
    return {
      kind: "planning",
      running: "Rechercheplan wird aktualisiert",
      completed: "Rechercheplan aktualisiert",
      failed: "Rechercheplan konnte nicht aktualisiert werden",
      isPlanning: true,
    };
  }
  if (KNOWLEDGE_TOOL_PATTERN.test(toolName)) {
    return {
      kind: "knowledge",
      running: "Wissensbasis wird durchsucht",
      completed: "Wissensbasis durchsucht",
      failed: "Wissensbasis-Suche fehlgeschlagen",
    };
  }
  if (WEB_TOOL_PATTERN.test(toolName)) {
    return {
      kind: "web",
      running: "Websuche wird durchgeführt",
      completed: "Websuche durchgeführt",
      failed: "Websuche fehlgeschlagen",
    };
  }
  return {
    kind: "tool",
    running: "Recherchewerkzeug wird ausgeführt",
    completed: "Recherchewerkzeug ausgeführt",
    failed: "Recherchewerkzeug fehlgeschlagen",
  };
}

function extractSafeSearchQuery(data: Record<string, unknown>, event: Record<string, unknown>): string | undefined {
  const args = recordOf(data.arguments) ?? recordOf(event.arguments) ?? (typeof data.arguments === "string" ? (() => {
    try { return recordOf(JSON.parse(data.arguments)); } catch { return null; }
  })() : null);

  const rawQuery = boundedText(
    args?.query ?? args?.search_query ?? args?.q ?? args?.text ?? args?.search_term ?? args?.keyword ?? args?.keywords ?? data.query ?? event.query,
    300,
  );
  if (!rawQuery) return undefined;

  // Check if query is an internal URL, storage URI, or local path
  if (
    /^https?:\/\/(?:[^\s/$.?#]*\.(?:local|internal|corp|lan|service|intra)|localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1]))/i.test(rawQuery)
    || /^(?:s3|gs|gcs|azure|blob|file|minio):\/\//i.test(rawQuery)
    || /^(?:\/(?:var|tmp|etc|proc|sys|opt|home|root|usr|private)\/|[A-Za-z]:\\)/i.test(rawQuery)
  ) {
    return undefined;
  }

  // Check for credential assignments or tokens
  if (
    /(?:api[_-]?key|secret|password|passwd|auth[_-]?token|access[_-]?token)\s*[:=]/i.test(rawQuery)
    || /\b(?:sk|ghp|gho|AIza)-[A-Za-z0-9_\-]{8,}/i.test(rawQuery)
    || /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIzaSy[A-Za-z0-9_-]{20,})/.test(rawQuery)
    || /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/i.test(rawQuery)
  ) {
    return undefined;
  }

  const sanitized = sanitizeAndRedactDetail(rawQuery, 150);
  if (!sanitized || sanitized.includes("[REDACTED")) {
    return undefined;
  }

  return sanitized;
}

function extractSearchResultSummary(data: Record<string, unknown>, event: Record<string, unknown>): string | undefined {
  const resultRecord = recordOf(data.result) ?? recordOf(event.result);
  let count: number | undefined;

  if (resultRecord) {
    if (Array.isArray(resultRecord.matches)) count = resultRecord.matches.length;
    else if (Array.isArray(resultRecord.results)) count = resultRecord.results.length;
    else if (Array.isArray(resultRecord.references)) count = resultRecord.references.length;
    else if (Array.isArray(resultRecord.documents)) count = resultRecord.documents.length;
    else if (Array.isArray(resultRecord.chunks)) count = resultRecord.chunks.length;
    else if (Array.isArray(resultRecord.items)) count = resultRecord.items.length;
    else if (typeof resultRecord.total === "number" && Number.isFinite(resultRecord.total) && resultRecord.total >= 0) {
      count = Math.round(resultRecord.total);
    } else if (typeof resultRecord.count === "number" && Number.isFinite(resultRecord.count) && resultRecord.count >= 0) {
      count = Math.round(resultRecord.count);
    } else if (typeof resultRecord.matches_count === "number" && Number.isFinite(resultRecord.matches_count) && resultRecord.matches_count >= 0) {
      count = Math.round(resultRecord.matches_count);
    }
  } else if (Array.isArray(data.result)) {
    count = data.result.length;
  } else if (Array.isArray(event.result)) {
    count = event.result.length;
  } else if (Array.isArray(data.matches)) {
    count = data.matches.length;
  } else if (Array.isArray(event.matches)) {
    count = event.matches.length;
  } else if (typeof data.count === "number" && Number.isFinite(data.count) && data.count >= 0) {
    count = Math.round(data.count);
  }

  if (count === undefined) return undefined;
  return count === 1 ? "1 Treffer" : `${count} Treffer`;
}

function extractProviderReasoningContent(event: Record<string, unknown>, data: Record<string, unknown>): string | undefined {
  // Prefer canonical top-level SSE content
  if (typeof event.content === "string" && event.content.length > 0) {
    return event.content;
  }

  // Documented bounded fallbacks in order of preference
  const fallbacks: unknown[] = [
    event.reasoning_content,
    event.thought,
    event.reasoning,
    event.reflection,
    data.content,
    data.reasoning_content,
    data.thought,
    data.reasoning,
    data.reflection,
  ];

  for (const fallback of fallbacks) {
    if (typeof fallback === "string" && fallback.trim().length > 0) {
      return fallback;
    }
  }

  const thinkingData = recordOf(data.thinking) ?? recordOf(event.thinking);
  if (thinkingData) {
    const text = thinkingData.content ?? thinkingData.text;
    if (typeof text === "string" && text.trim().length > 0) {
      return text;
    }
  }

  const reflectionData = recordOf(data.reflection) ?? recordOf(event.reflection);
  if (reflectionData) {
    const text = reflectionData.content ?? reflectionData.text;
    if (typeof text === "string" && text.trim().length > 0) {
      return text;
    }
  }

  return undefined;
}

export function parseWeKnoraExecutionEvent(value: unknown): FredExecutionUpdate {
  const event = recordOf(value);
  if (!event) return { fatalError: false, unsupported: false };

  const responseType = boundedText(event.response_type ?? event.type, 80).toLowerCase();
  const data = recordOf(event.data) ?? {};

  if (responseType === "tool_approval_required" || responseType === "mcp_oauth_required") {
    return { fatalError: false, unsupported: true };
  }
  if (responseType === "error" && !boundedText(data.tool_name ?? event.tool_name, 180)) {
    return { fatalError: true, unsupported: false };
  }

  if (responseType === "thinking") {
    const done = data.done === true || event.done === true;
    const rawContent = extractProviderReasoningContent(event, data);
    const detail = rawContent ? sanitizeAndRedactDetail(rawContent) : undefined;
    return {
      fatalError: false,
      unsupported: false,
      step: {
        id: eventId(event, data, "analysis"),
        kind: "analysis",
        status: done ? "completed" : "running",
        label: done ? "Anfrage analysiert" : "Anfrage wird analysiert",
        ...(detail ? { detail } : {}),
      },
    };
  }

  if (responseType === "reflection") {
    const done = data.done === true || event.done === true;
    const rawContent = extractProviderReasoningContent(event, data);
    const detail = rawContent ? sanitizeAndRedactDetail(rawContent) : undefined;
    return {
      fatalError: false,
      unsupported: false,
      step: {
        id: eventId(event, data, "evaluation"),
        kind: "evaluation",
        status: done ? "completed" : "running",
        label: done ? "Rechercheergebnisse bewertet" : "Rechercheergebnisse werden bewertet",
        ...(detail ? { detail } : {}),
      },
    };
  }

  if (responseType === "references") {
    const references = Array.isArray(data.references)
      ? data.references
      : Array.isArray(event.references)
        ? event.references
        : [];
    const count = references.length;
    return {
      fatalError: false,
      unsupported: false,
      step: count > 0 ? {
        id: eventId(event, data, "sources"),
        kind: "sources",
        status: "completed",
        label: `${count} ${count === 1 ? "Quelle" : "Quellen"} gefunden`,
      } : undefined,
    };
  }

  if (responseType === "tool_call" || responseType === "tool_result" || responseType === "error") {
    const toolName = boundedText(data.tool_name ?? event.tool_name, 180);
    const config = resolveToolConfig(toolName);
    const successful = responseType !== "error" && data.success !== false && event.success !== false;
    const finished = responseType !== "tool_call";
    const status: FredExecutionStepStatus = finished ? (successful ? "completed" : "failed") : "running";

    let label = config.running;
    if (status === "completed") {
      label = config.completed;
    } else if (status === "failed") {
      label = config.failed;
    }

    const duration = durationMs(data.duration_ms ?? data.duration ?? event.duration_ms ?? event.duration);
    let detail: string | undefined;
    let counts: FredPlanningCounts | null = null;

    if (config.isPlanning) {
      counts = extractPlanningCounts(data, event);
      const items = extractPlanningItems(data, event);
      detail = counts ? formatPlanningDetailWithItems(counts, items) : undefined;
    } else if (config.kind === "knowledge" || config.kind === "web") {
      if (responseType === "tool_call") {
        const query = extractSafeSearchQuery(data, event);
        detail = query ? `Suche: ${query}` : undefined;
      } else if (responseType === "tool_result" && successful) {
        detail = extractSearchResultSummary(data, event);
      }
    }

    return {
      fatalError: false,
      unsupported: false,
      step: {
        id: eventId(event, data, config.kind),
        kind: config.kind,
        status,
        label,
        ...(detail ? { detail } : {}),
        ...(counts ? { counts } : {}),
        ...(duration !== undefined ? { durationMs: duration } : {}),
      },
    };
  }

  return { fatalError: false, unsupported: false };
}

export function mergeFredExecutionStep(
  steps: FredExecutionStep[],
  update: FredExecutionStep,
): FredExecutionStep[] {
  const existingIndex = steps.findIndex((step) => step.id === update.id);
  if (existingIndex < 0) {
    return [...steps, update].slice(-MAX_EXECUTION_STEPS);
  }

  const existing = steps[existingIndex];
  let detail = existing.detail;
  if (update.detail !== undefined && update.detail !== "") {
    if (!existing.detail) {
      detail = update.detail;
    } else if (update.detail.startsWith(existing.detail)) {
      detail = update.detail;
    } else if (existing.detail.startsWith(update.detail)) {
      detail = existing.detail;
    } else if (existing.kind === "analysis" || existing.kind === "evaluation") {
      detail = sanitizeAndRedactDetail(existing.detail + update.detail, MAX_EXECUTION_DETAIL_CHARS);
    } else {
      detail = update.detail;
    }
  }

  const merged: FredExecutionStep = {
    ...existing,
    ...update,
    ...(detail !== undefined ? { detail } : {}),
  };
  if (detail === undefined) {
    delete merged.detail;
  }

  const next = [...steps];
  next[existingIndex] = merged;
  return next;
}

export function parseStoredFredExecutionTrace(value: unknown): FredExecutionStep[] {
  if (!Array.isArray(value)) return [];
  const validKinds = new Set(["analysis", "planning", "knowledge", "web", "tool", "evaluation", "sources"]);
  const validStatuses = new Set(["running", "completed", "failed"]);

  return value.slice(0, MAX_EXECUTION_STEPS).flatMap((candidate) => {
    const item = recordOf(candidate);
    if (!item) return [];

    const id = boundedText(item.id, 180);
    const kind = boundedText(item.kind, 30) as FredExecutionStepKind;
    const status = boundedText(item.status, 30) as FredExecutionStepStatus;
    const label = boundedText(item.label, MAX_EXECUTION_LABEL_CHARS);

    if (!id || !validKinds.has(kind) || !validStatuses.has(status) || !label) {
      return [];
    }

    const rawDetail = typeof item.detail === "string" ? item.detail : undefined;
    const detail = rawDetail
      ? sanitizeAndRedactDetail(rawDetail, MAX_EXECUTION_DETAIL_CHARS)
      : undefined;
    const duration = durationMs(item.durationMs);

    let counts: FredPlanningCounts | undefined;
    const rawCounts = recordOf(item.counts);
    if (rawCounts) {
      const total = typeof rawCounts.total === "number" && Number.isFinite(rawCounts.total) && rawCounts.total >= 0 ? Math.round(rawCounts.total) : undefined;
      const completed = typeof rawCounts.completed === "number" && Number.isFinite(rawCounts.completed) && rawCounts.completed >= 0 ? Math.round(rawCounts.completed) : undefined;
      const inProgress = typeof rawCounts.inProgress === "number" && Number.isFinite(rawCounts.inProgress) && rawCounts.inProgress >= 0 ? Math.round(rawCounts.inProgress) : undefined;
      const open = typeof rawCounts.open === "number" && Number.isFinite(rawCounts.open) && rawCounts.open >= 0 ? Math.round(rawCounts.open) : undefined;
      if (total !== undefined || completed !== undefined || inProgress !== undefined || open !== undefined) {
        counts = {
          ...(total !== undefined ? { total } : {}),
          ...(completed !== undefined ? { completed } : {}),
          ...(inProgress !== undefined ? { inProgress } : {}),
          ...(open !== undefined ? { open } : {}),
        };
      }
    }

    return [{
      id,
      kind,
      status,
      label,
      ...(detail ? { detail } : {}),
      ...(duration !== undefined ? { durationMs: duration } : {}),
      ...(counts ? { counts } : {}),
    }];
  });
}
