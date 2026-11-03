export const MAX_EXECUTION_STEPS = 200;
export const MAX_EXECUTION_DETAIL_CHARS = 2000;
export const MAX_EXECUTION_LABEL_CHARS = 200;
export const MAX_PLANNING_TODOS_COUNT = 50;
export const MAX_PLANNING_TASK_CHARS = 200;
export const MAX_EXECUTION_ARGUMENTS_CHARS = 8_000;
export const MAX_EXECUTION_RESULT_CHARS = 20_000;
export const MAX_EXECUTION_OUTPUT_CHARS = 8_000;
export const MAX_EXECUTION_COMMAND_CHARS = 2_000;
export const MAX_EXECUTION_ID_CHARS = 180;
export const EXECUTION_CUT_MARKER = "…[gekürzt]";

export type FredExecutionStepKind =
  | "analysis"
  | "planning"
  | "knowledge"
  | "web"
  | "tool"
  | "evaluation"
  | "sources"
  | "agent"
  | "memory"
  | "context";

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
  /** Raw upstream tool_call_id (tools) or member/task id (helper agents). */
  callId?: string;
  toolName?: string;
  /** Pretty-printed, redacted tool arguments. */
  arguments?: string;
  /** Redacted tool result payload. */
  result?: string;
  /** Live or final sandbox command output (tail). */
  output?: string;
  command?: string;
  /** Id of the parent step (helper agents hang below their spawn_agent step). */
  parentId?: string;
  /** Helper-agent bookkeeping: collaboration group, latest seen revision and task name. */
  groupId?: string;
  revision?: number;
  taskName?: string;
};

export type FredExecutionUpdate = {
  step?: FredExecutionStep;
  steps?: FredExecutionStep[];
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

import {
  isSensitiveQueryParam,
  redactSensitiveText,
  sanitizeAndRedactDetail,
  sanitizeControlCharacters,
} from "./safe-research-display";

export {
  sanitizeAndRedactDetail,
};


function hashedId(prefix: string, upstreamId: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < upstreamId.length; index += 1) {
    hash = Math.imul(hash ^ upstreamId.charCodeAt(index), 16_777_619);
  }
  return `${prefix}:${(hash >>> 0).toString(36)}`;
}

function eventId(event: Record<string, unknown>, data: Record<string, unknown>, prefix: string): string {
  const upstreamId = boundedText(
    data.tool_call_id ?? data.event_id ?? event.event_id ?? event.id,
    180,
  ) || boundedText(data.iteration ?? event.iteration, 20) || "0";
  return hashedId(prefix, upstreamId);
}

const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const PAYLOAD_PRE_CUT_CHARS = 400_000;
const MAX_PAYLOAD_DEPTH = 12;
const TOOL_RESULT_META_KEYS = new Set(["tool_name", "tool_call_id", "success", "error", "duration_ms", "arguments"]);

/** Masks values of credential-like keys structurally (JSON keys are quoted, so text redaction alone misses them). */
function redactStructured(value: unknown, depth = 0): unknown {
  if (depth > MAX_PAYLOAD_DEPTH) return "…";
  if (Array.isArray(value)) return value.map((item) => redactStructured(item, depth + 1));
  const record = recordOf(value);
  if (!record) return value;
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [
    key,
    (typeof item === "string" || (item !== null && typeof item === "object")) && isSensitiveQueryParam(key)
      ? "[REDACTED]"
      : redactStructured(item, depth + 1),
  ]));
}

/**
 * Control-char sanitizing + redaction of only the sensitive substrings, then a visible cut.
 * `keep: "tail"` keeps the END (rolling output); the cut is idempotent for already-cut text.
 */
function capPayload(value: unknown, maximum: number, keep: "head" | "tail" = "head"): string | undefined {
  if (typeof value !== "string") return undefined;
  const bounded = keep === "head" ? value.slice(0, PAYLOAD_PRE_CUT_CHARS) : value.slice(-PAYLOAD_PRE_CUT_CHARS);
  const sanitized = sanitizeControlCharacters(bounded.replace(ANSI_ESCAPE_PATTERN, ""));
  if (!sanitized.trim()) return undefined;
  // Bearer tokens first: "Authorization: Bearer <token>" would otherwise only mask the word "Bearer".
  const text = redactSensitiveText(sanitized.replace(/\bBearer\s+[A-Za-z0-9_\-.~+/]+=*/gi, "Bearer [REDACTED]"));
  const alreadyCut = keep === "head"
    ? text.endsWith(`\n${EXECUTION_CUT_MARKER}`)
    : text.startsWith(`${EXECUTION_CUT_MARKER}\n`);
  if (text.length <= maximum + (alreadyCut ? EXECUTION_CUT_MARKER.length + 1 : 0)) return text;
  return keep === "head"
    ? `${text.slice(0, maximum)}\n${EXECUTION_CUT_MARKER}`
    : `${EXECUTION_CUT_MARKER}\n${text.slice(-maximum)}`;
}

function prettyJsonPayload(value: unknown, maximum: number): string | undefined {
  try {
    return capPayload(JSON.stringify(redactStructured(value), null, 2), maximum);
  } catch {
    return undefined;
  }
}

function formatArgumentsPayload(raw: unknown): string | undefined {
  let value = raw;
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === "object") value = parsed;
    } catch {
      // Not JSON: show the raw string.
    }
  }
  if (value !== null && typeof value === "object") {
    return Object.keys(value).length > 0 ? prettyJsonPayload(value, MAX_EXECUTION_ARGUMENTS_CHARS) : undefined;
  }
  return capPayload(value, MAX_EXECUTION_ARGUMENTS_CHARS);
}

function formatResultPayload(
  data: Record<string, unknown>,
  event: Record<string, unknown>,
  successful: boolean,
): string | undefined {
  const parts: string[] = [];
  const error = boundedText(data.error ?? event.error, MAX_EXECUTION_RESULT_CHARS);
  if (!successful && error) parts.push(`Fehler: ${error}`);
  if (typeof data.output === "string" && data.output.trim()) {
    parts.push(data.output);
  } else {
    const rest = Object.fromEntries(Object.entries(data).filter(([key]) => !TOOL_RESULT_META_KEYS.has(key)));
    if (Object.keys(rest).length > 0) {
      try {
        parts.push(JSON.stringify(redactStructured(rest), null, 2));
      } catch {
        // Unserializable payloads are skipped.
      }
    }
  }
  return parts.length > 0 ? capPayload(parts.join("\n\n"), MAX_EXECUTION_RESULT_CHARS) : undefined;
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
  if (record.steps !== undefined) return parseTodosFromUnknown(record.steps);
  if (record.todos !== undefined) return parseTodosFromUnknown(record.todos);
  if (record.tasks !== undefined) return parseTodosFromUnknown(record.tasks);
  if (record.items !== undefined) return parseTodosFromUnknown(record.items);
  if (record.plan !== undefined) return parseTodosFromUnknown(record.plan);
  if (record.todo_list !== undefined) return parseTodosFromUnknown(record.todo_list);
  if (record.todoList !== undefined) return parseTodosFromUnknown(record.todoList);
  if (record.arguments !== undefined) return parseTodosFromUnknown(record.arguments);
  if (record.result !== undefined) return parseTodosFromUnknown(record.result);
  if (typeof record.task === "string" && record.task.trim()) {
    return [{ task: record.task.trim(), status: (typeof record.status === "string" ? record.status : undefined) ?? "in_progress" }];
  }
  return null;
}

function extractPlanningCounts(
  data: Record<string, unknown>,
  event: Record<string, unknown>,
): FredPlanningCounts | null {
  const candidates = [
    data.steps,
    data.todos,
    data.tasks,
    data.plan,
    data.arguments,
    data.result,
    data,
    event.steps,
    event.todos,
    event.tasks,
    event.plan,
    event.arguments,
    event.result,
    event,
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

function extractPlanningTask(
  data: Record<string, unknown>,
  event: Record<string, unknown>,
): string | undefined {
  const args = recordOf(data.arguments) ?? recordOf(event.arguments) ?? (typeof data.arguments === "string" ? (() => {
    try { return recordOf(JSON.parse(data.arguments)); } catch { return null; }
  })() : null);

  const raw = boundedText(
    data.task ?? data.current_task ?? data.currentTask ?? args?.task ?? args?.current_task ?? args?.currentTask ?? event.task ?? event.current_task,
    MAX_PLANNING_TASK_CHARS,
  );
  if (!raw) return undefined;
  return sanitizeAndRedactDetail(raw, MAX_PLANNING_TASK_CHARS);
}

function extractPlanningItems(
  data: Record<string, unknown>,
  event: Record<string, unknown>,
): Array<Record<string, unknown>> | null {
  const candidates = [
    data.steps,
    data.todos,
    data.tasks,
    data.plan,
    data.arguments,
    data.result,
    data,
    event.steps,
    event.todos,
    event.tasks,
    event.plan,
    event.arguments,
    event.result,
    event,
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
  currentTask?: string,
): string | undefined {
  const lines: string[] = [];
  let currentLength = 0;

  if (currentTask) {
    const taskLine = `Aktuelle Aufgabe: ${currentTask}`.slice(0, MAX_PLANNING_TASK_CHARS + 25);
    lines.push(taskLine);
    currentLength = taskLine.length;
  }

  const summary = formatPlanningDetail(counts);
  if (summary) {
    const boundedSummary = summary.slice(0, MAX_EXECUTION_DETAIL_CHARS);
    const addedLength = lines.length > 0 ? 1 + boundedSummary.length : boundedSummary.length;
    if (currentLength + addedLength <= MAX_EXECUTION_DETAIL_CHARS) {
      lines.push(boundedSummary);
      currentLength += addedLength;
    }
  }

  if (items && items.length > 0) {
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
  }

  if (lines.length > 0) {
    const joined = lines.join("\n");
    return joined.length <= MAX_EXECUTION_DETAIL_CHARS
      ? joined
      : joined.slice(0, MAX_EXECUTION_DETAIL_CHARS);
  }

  return undefined;
}

type ToolConfig = {
  kind: FredExecutionStepKind;
  running: string;
  completed: string;
  failed: string;
  isPlanning?: boolean;
  isThinkingTool?: boolean;
};

function resolveToolConfig(toolName: string): ToolConfig {
  if (toolName.toLowerCase() === "thinking") {
    return {
      kind: "analysis",
      running: "Anfrage wird analysiert",
      completed: "Anfrage analysiert",
      failed: "Anfrage konnte nicht analysiert werden",
      isThinkingTool: true,
    };
  }
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

function extractThoughtProgress(data: Record<string, unknown>, event: Record<string, unknown>): string | undefined {
  const args = recordOf(data.arguments) ?? recordOf(event.arguments) ?? (typeof data.arguments === "string" ? (() => {
    try { return recordOf(JSON.parse(data.arguments)); } catch { return null; }
  })() : null);

  const numVal = data.thought_number ?? data.thoughtNumber ?? args?.thought_number ?? args?.thoughtNumber ?? event.thought_number ?? event.thoughtNumber;
  const totalVal = data.total_thoughts ?? data.totalThoughts ?? args?.total_thoughts ?? args?.totalThoughts ?? event.total_thoughts ?? event.totalThoughts;

  const num = typeof numVal === "number" && Number.isFinite(numVal) && numVal > 0 && numVal <= 999
    ? Math.round(numVal)
    : (typeof numVal === "string" && /^\d{1,3}$/.test(numVal) ? parseInt(numVal, 10) : undefined);
  const total = typeof totalVal === "number" && Number.isFinite(totalVal) && totalVal > 0 && totalVal <= 999
    ? Math.round(totalVal)
    : (typeof totalVal === "string" && /^\d{1,3}$/.test(totalVal) ? parseInt(totalVal, 10) : undefined);

  if (num !== undefined && total !== undefined) {
    return `${num}/${total}`;
  }
  if (num !== undefined) {
    return `${num}`;
  }
  return undefined;
}

function extractThinkingToolContent(data: Record<string, unknown>, event: Record<string, unknown>): string | undefined {
  const candidates: unknown[] = [
    data.thought,
    data.output,
    event.output,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return undefined;
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

function extractCountFromObject(obj: Record<string, unknown> | null): number | undefined {
  if (!obj) return undefined;

  // 1. Total matches for grep
  if (typeof obj.total_matches === "number" && Number.isFinite(obj.total_matches) && obj.total_matches >= 0) {
    return Math.round(obj.total_matches);
  }

  // 2. Direct results array length (native precedence: results?.length ?? count)
  if (Array.isArray(obj.results)) {
    return obj.results.length;
  }

  // 3. Other result arrays
  const otherArrays = [
    obj.chunk_results,
    obj.knowledge_results,
    obj.chunks,
    obj.matches,
    obj.references,
    obj.documents,
    obj.items,
  ];
  for (const arr of otherArrays) {
    if (Array.isArray(arr)) {
      return arr.length;
    }
  }

  // 4. Numeric fallback count properties
  const numProps = [
    obj.result_count,
    obj.matches_count,
    obj.count,
    obj.total,
  ];
  for (const num of numProps) {
    if (typeof num === "number" && Number.isFinite(num) && num >= 0) {
      return Math.round(num);
    }
  }

  // 5. Fallback: if any arrayProp itself was a number
  const allArrayProps = [obj.results, ...otherArrays];
  for (const arr of allArrayProps) {
    if (typeof arr === "number" && Number.isFinite(arr) && arr >= 0) {
      return Math.round(arr);
    }
  }

  return undefined;
}

function extractKnowledgeChunksListSummary(
  data: Record<string, unknown>,
  event: Record<string, unknown>,
): string | undefined {
  const resultRecord = recordOf(data.result) ?? recordOf(event.result) ?? (typeof data.result === "string" ? (() => {
    try { return recordOf(JSON.parse(data.result)); } catch { return null; }
  })() : null);

  const fetchedVal = data.fetched_chunks ?? resultRecord?.fetched_chunks ?? event.fetched_chunks;
  if (fetchedVal === undefined) return undefined;

  const fetched = Math.max(0, Math.round(Number(fetchedVal) || 0));
  const totalVal = data.total_chunks ?? resultRecord?.total_chunks ?? event.total_chunks;
  const total = totalVal !== undefined ? Math.max(0, Math.round(Number(totalVal) || 0)) : undefined;

  const parts: string[] = [];
  if (total !== undefined) {
    parts.push(`${fetched} von ${total} ${total === 1 ? "Abschnitt" : "Abschnitten"} geladen`);
  } else {
    parts.push(`${fetched} ${fetched === 1 ? "Abschnitt" : "Abschnitte"} geladen`);
  }

  const pageSizeVal = data.page_size ?? resultRecord?.page_size ?? event.page_size;
  const pageSize = Number(pageSizeVal || 0);
  if (total !== undefined && pageSize > 0 && total > pageSize) {
    const pageVal = data.page ?? resultRecord?.page ?? event.page;
    const page = Math.max(1, Math.round(Number(pageVal) || 1));
    parts.push(`Seite ${page}`);
  }

  return parts.join(" · ");
}

function formatSafeToolArguments(
  data: Record<string, unknown>,
  event: Record<string, unknown>,
): string | undefined {
  const raw = data.arguments !== undefined ? data.arguments : event.arguments;
  let argsObj: Record<string, unknown> | null = null;
  if (typeof raw === "string" && raw.length <= 100_000) {
    try {
      argsObj = recordOf(JSON.parse(raw));
    } catch {
      return undefined;
    }
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    argsObj = raw as Record<string, unknown>;
  }

  if (!argsObj) return undefined;

  const entries: string[] = [];
  for (const [key, value] of Object.entries(argsObj)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      entries.push(`${key}: ${value}`);
    } else if (value !== null && typeof value === "object") {
      entries.push(`${key}: …`);
    }
  }

  if (entries.length === 0) return undefined;

  const joined = `Parameter: ${entries.join("; ")}`;
  const sanitized = sanitizeAndRedactDetail(joined, 300);
  if (!sanitized || sanitized.includes("[REDACTED") || !sanitized.trim()) {
    return undefined;
  }

  return sanitized;
}

function extractGenericResultSummary(
  data: Record<string, unknown>,
  event: Record<string, unknown>,
): string | undefined {
  const raw = data.result !== undefined ? data.result : event.result;
  let resultObj: Record<string, unknown> | null = null;
  let itemsArray: unknown[] | null = null;

  if (typeof raw === "string" && raw.length <= 100_000) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        itemsArray = parsed;
      } else {
        resultObj = recordOf(parsed);
      }
    } catch {
      return undefined;
    }
  } else if (Array.isArray(raw)) {
    itemsArray = raw;
  } else if (raw && typeof raw === "object") {
    resultObj = raw as Record<string, unknown>;
  }

  if (!resultObj && !itemsArray) return undefined;

  const parts: string[] = [];

  // 1. Scalar summary fields in order: status, ok, error, result_count, total, count
  if (resultObj) {
    const summaryFields = ["status", "ok", "error", "result_count", "total", "count"] as const;
    for (const field of summaryFields) {
      if (field in resultObj) {
        const val = resultObj[field];
        if (typeof val === "string" && val.trim().length > 0) {
          parts.push(`${field}: ${val.trim()}`);
        } else if (typeof val === "number" || typeof val === "boolean") {
          parts.push(`${field}: ${val}`);
        }
      }
    }

    if (!itemsArray) {
      const arrayKeys = ["results", "items", "documents", "data", "entries", "records", "matches", "chunks", "todos", "steps"];
      for (const key of arrayKeys) {
        if (Array.isArray(resultObj[key])) {
          itemsArray = resultObj[key] as unknown[];
          break;
        }
      }
      if (!itemsArray) {
        for (const val of Object.values(resultObj)) {
          if (Array.isArray(val)) {
            itemsArray = val;
            break;
          }
        }
      }
    }
  }

  // 2. Up to 3 item names/titles
  if (itemsArray && itemsArray.length > 0) {
    const topItems = itemsArray.slice(0, 3);
    for (const item of topItems) {
      if (typeof item === "string" && item.trim().length > 0) {
        parts.push(item.trim());
      } else if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        const label = boundedText(
          rec.name ?? rec.title ?? rec.label ?? rec.task ?? rec.text ?? rec.doc ?? rec.id,
          100,
        );
        if (label) {
          parts.push(label);
        }
      }
    }
  }

  if (parts.length === 0) return undefined;

  const joined = `Ergebnis: ${parts.join("; ")}`;
  const sanitized = sanitizeAndRedactDetail(joined, 300);
  if (!sanitized || sanitized.includes("[REDACTED") || !sanitized.trim()) {
    return undefined;
  }

  return sanitized;
}

function formatReferencesDetail(references: unknown[]): string | undefined {
  if (!Array.isArray(references) || references.length === 0) return undefined;
  const entries = references.slice(0, 10);
  const lines: string[] = [];

  for (const item of entries) {
    if (typeof item === "string" && item.trim().length > 0) {
      const trimmed = item.trim();
      if (/^https?:\/\//i.test(trimmed)) {
        try {
          lines.push(new URL(trimmed).hostname);
        } catch {
          lines.push(trimmed);
        }
      } else {
        lines.push(trimmed);
      }
      continue;
    }

    const rec = recordOf(item);
    if (!rec) continue;

    const kind = boundedText(rec.kind, 40).toLowerCase();
    const rawUrl = rec.url ?? rec.link;
    const isWeb = kind === "web" || (typeof rawUrl === "string" && rawUrl.trim().length > 0);

    if (isWeb) {
      let host = "";
      if (typeof rawUrl === "string" && rawUrl.trim().length > 0) {
        try {
          host = new URL(rawUrl.trim()).hostname;
        } catch {
          host = rawUrl.trim();
        }
      }
      const title = boundedText(rec.title ?? rec.name, 200);
      if (title && host) {
        lines.push(`${title} (${host})`);
      } else if (title) {
        lines.push(title);
      } else if (host) {
        lines.push(host);
      }
    } else {
      const doc = boundedText(
        rec.doc ?? rec.title ?? rec.document_name ?? rec.file_name ?? rec.name ?? rec.faq_standard_question ?? rec.faq_question,
        200,
      );
      const rawKbId = boundedText(
        rec.knowledge_base_id ?? rec.kb_id ?? rec.knowledgeBaseId ?? rec.knowledge_base ?? rec.kbId,
        100,
      );
      const shortKbId = rawKbId ? rawKbId.slice(0, 8) : "";

      if (doc && shortKbId) {
        lines.push(`${doc} (${shortKbId})`);
      } else if (doc) {
        lines.push(doc);
      } else if (shortKbId) {
        lines.push(`KB ${shortKbId}`);
      }
    }
  }

  if (lines.length === 0) return undefined;

  return sanitizeAndRedactDetail(lines.join("\n"), 1000);
}

function extractSearchResultSummary(data: Record<string, unknown>, event: Record<string, unknown>): string | undefined {
  const resultRecord = recordOf(data.result) ?? recordOf(event.result) ?? (typeof data.result === "string" ? (() => {
    try { return recordOf(JSON.parse(data.result)); } catch { return null; }
  })() : null);

  let count: number | undefined;

  // Check direct on data
  count = extractCountFromObject(data);

  // Check in resultRecord (data.result or event.result)
  if (count === undefined && resultRecord) {
    count = extractCountFromObject(resultRecord);
  }

  // Check on event
  if (count === undefined) {
    count = extractCountFromObject(event);
  }

  // Check if data.result or event.result itself is an array
  if (count === undefined) {
    if (Array.isArray(data.result)) {
      count = data.result.length;
    } else if (Array.isArray(event.result)) {
      count = event.result.length;
    }
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

const COMMAND_RUNNING_LABEL = "Befehl wird ausgeführt";
const COMMAND_DONE_LABEL = "Befehl ausgeführt";

const AGENT_STATUS_LABELS: Record<string, string> = {
  queued: "Wartet",
  running: "Läuft",
  waiting: "Wartet auf Freigabe",
  succeeded: "Fertig",
  failed: "Fehlgeschlagen",
  interrupted: "Unterbrochen",
  cancelled: "Abgebrochen",
  needs_attention: "Braucht Aufmerksamkeit",
};

function commandOutputStep(data: Record<string, unknown>, fallbackCallId?: unknown): FredExecutionStep | undefined {
  const callId = boundedText(data.tool_call_id ?? fallbackCallId, MAX_EXECUTION_ID_CHARS);
  if (!callId) return undefined;
  const done = data.done === true;
  const output = capPayload(data.output, MAX_EXECUTION_OUTPUT_CHARS, "tail");
  const command = capPayload(data.command, MAX_EXECUTION_COMMAND_CHARS);
  return {
    id: hashedId("tool", callId),
    kind: "tool",
    status: done ? "completed" : "running",
    label: done ? COMMAND_DONE_LABEL : COMMAND_RUNNING_LABEL,
    callId,
    ...(command ? { command } : {}),
    ...(output ? { output } : {}),
  };
}

function collaborationSteps(data: Record<string, unknown>): FredExecutionStep[] {
  const groupId = boundedText(data.group_id, MAX_EXECUTION_ID_CHARS);
  const revision = Number(data.revision);
  const tasks = Array.isArray(data.tasks) ? data.tasks.slice(0, 50) : [];
  return tasks.flatMap((candidate): FredExecutionStep[] => {
    const task = recordOf(candidate);
    if (!task) return [];
    const taskId = boundedText(task.id ?? task.member_id, MAX_EXECUTION_ID_CHARS);
    if (!taskId) return [];
    const memberId = boundedText(task.member_id, MAX_EXECUTION_ID_CHARS) || taskId;
    const taskName = sanitizeAndRedactDetail(boundedText(task.name ?? task.task_name, 120), 120);
    const displayName = sanitizeAndRedactDetail(boundedText(task.display_name, 120), 120) ?? taskName;
    const rawStatus = boundedText(task.status, 40).toLowerCase();
    const cancelling = task.cancel_requested === true && !["succeeded", "failed", "cancelled", "interrupted"].includes(rawStatus);
    const statusLabel = cancelling ? "Wird abgebrochen" : AGENT_STATUS_LABELS[rawStatus] ?? "Läuft";
    const status: FredExecutionStepStatus = rawStatus === "succeeded"
      ? "completed"
      : ["failed", "interrupted", "cancelled"].includes(rawStatus) ? "failed" : "running";

    const message = recordOf(task.latest_message);
    const latest = boundedText(typeof task.latest_message === "string" ? task.latest_message : message?.content ?? message?.message, MAX_EXECUTION_DETAIL_CHARS);
    const progress = recordOf(task.progress);
    const iteration = Number(progress?.iteration);
    const progressTool = boundedText(progress?.tool_name, 120);
    const progressLine = [
      Number.isFinite(iteration) && iteration > 0 ? `Schritt ${Math.round(iteration)}` : "",
      progressTool,
    ].filter(Boolean).join(": ");
    const detail = sanitizeAndRedactDetail([latest, progressLine].filter(Boolean).join("\n"), MAX_EXECUTION_DETAIL_CHARS);

    return [{
      id: hashedId("agent", taskId),
      kind: "agent",
      status,
      label: boundedText(`Hilfs-Agent${displayName ? ` ${displayName}` : ""}: ${statusLabel}`, MAX_EXECUTION_LABEL_CHARS),
      ...(detail ? { detail } : {}),
      callId: memberId,
      ...(taskName ? { taskName } : {}),
      ...(groupId ? { groupId } : {}),
      ...(Number.isFinite(revision) ? { revision } : {}),
    }];
  });
}

function memoryStep(event: Record<string, unknown>, data: Record<string, unknown>): FredExecutionStep | undefined {
  const memories = (Array.isArray(data.memories) ? data.memories : []).flatMap((candidate) => {
    const memory = recordOf(candidate);
    const content = boundedText(memory?.content, MAX_EXECUTION_DETAIL_CHARS);
    return memory && content ? [{ id: boundedText(memory.id, 80), content }] : [];
  });
  if (memories.length === 0) return undefined;
  const detail = sanitizeAndRedactDetail(memories.map((memory) => `- ${memory.content}`).join("\n"), MAX_EXECUTION_DETAIL_CHARS);
  return {
    id: hashedId("memory", boundedText(event.id ?? data.event_id, 180) || memories.map((memory) => memory.id || memory.content).join("|")),
    kind: "memory",
    status: "completed",
    label: `${memories.length} ${memories.length === 1 ? "Erinnerung" : "Erinnerungen"} abgerufen`,
    ...(detail ? { detail } : {}),
  };
}

function contextCompactedStep(event: Record<string, unknown>, data: Record<string, unknown>): FredExecutionStep {
  const before = Number(data.tokens_before);
  const after = Number(data.tokens_after);
  const hasTokens = data.tokens_before != null && data.tokens_after != null && Number.isFinite(before) && Number.isFinite(after);
  const detail = sanitizeAndRedactDetail(boundedText(data.summary, MAX_EXECUTION_DETAIL_CHARS), MAX_EXECUTION_DETAIL_CHARS);
  return {
    id: hashedId("context", boundedText(event.id ?? data.event_id, 180) || [data.tokens_before, data.tokens_after, data.messages_before, data.messages_after].join("|")),
    kind: "context",
    status: "completed",
    label: hasTokens
      ? `Gesprächsverlauf komprimiert (${Math.round(before).toLocaleString("de-DE")} → ${Math.round(after).toLocaleString("de-DE")} Tokens)`
      : "Gesprächsverlauf komprimiert",
    ...(detail ? { detail } : {}),
  };
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

  if (responseType === "agent_query") {
    const rawId = event.assistant_message_id ?? data.assistant_message_id;
    if (typeof rawId === "string" && rawId.trim().length > 0) {
      return {
        fatalError: false,
        unsupported: false,
        step: {
          id: eventId(event, data, "analysis"),
          kind: "analysis",
          status: "completed",
          label: "Anfrage an Fred übermittelt",
        },
      };
    }
    return { fatalError: false, unsupported: false };
  }

  if (responseType === "thinking") {
    const done = data.done === true || event.done === true;
    const rawContent = extractProviderReasoningContent(event, data);
    const detail = rawContent ? sanitizeAndRedactDetail(rawContent) : undefined;
    const duration = durationMs(data.duration_ms ?? data.duration ?? event.duration_ms ?? event.duration);
    return {
      fatalError: false,
      unsupported: false,
      step: {
        id: eventId(event, data, "analysis"),
        kind: "analysis",
        status: done ? "completed" : "running",
        label: done ? "Anfrage analysiert" : "Anfrage wird analysiert",
        ...(detail ? { detail } : {}),
        ...(duration !== undefined ? { durationMs: duration } : {}),
      },
    };
  }

  if (responseType === "reflection") {
    const done = data.done === true || event.done === true;
    const rawContent = extractProviderReasoningContent(event, data);
    const detail = rawContent ? sanitizeAndRedactDetail(rawContent) : undefined;
    const duration = durationMs(data.duration_ms ?? data.duration ?? event.duration_ms ?? event.duration);
    return {
      fatalError: false,
      unsupported: false,
      step: {
        id: eventId(event, data, "evaluation"),
        kind: "evaluation",
        status: done ? "completed" : "running",
        label: done ? "Rechercheergebnisse bewertet" : "Rechercheergebnisse werden bewertet",
        ...(detail ? { detail } : {}),
        ...(duration !== undefined ? { durationMs: duration } : {}),
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
    const detail = formatReferencesDetail(references);
    return {
      fatalError: false,
      unsupported: false,
      step: count > 0 ? {
        id: eventId(event, data, "sources"),
        kind: "sources",
        status: "completed",
        label: `${count} ${count === 1 ? "Quelle" : "Quellen"} gefunden`,
        ...(detail ? { detail } : {}),
      } : undefined,
    };
  }

  if (responseType === "command_output" || responseType === "work_event") {
    const inner = responseType === "work_event" ? recordOf(data.inner) : null;
    if (responseType === "work_event" && boundedText(inner?.response_type, 40).toLowerCase() !== "command_output") {
      return { fatalError: false, unsupported: false };
    }
    const step = commandOutputStep(inner ? recordOf(inner.data) ?? {} : data, data.work_id);
    return { fatalError: false, unsupported: false, ...(step ? { step } : {}) };
  }

  if (responseType === "collaboration_status") {
    const steps = collaborationSteps(data);
    return { fatalError: false, unsupported: false, ...(steps.length > 0 ? { steps } : {}) };
  }

  if (responseType === "memory_recalled") {
    const step = memoryStep(event, data);
    return { fatalError: false, unsupported: false, ...(step ? { step } : {}) };
  }

  if (responseType === "context_compacted") {
    return { fatalError: false, unsupported: false, step: contextCompactedStep(event, data) };
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

    if (config.isThinkingTool) {
      const progress = extractThoughtProgress(data, event);
      if (progress) {
        if (status === "running") {
          label = `Anfrage wird analysiert (${progress})`;
        } else if (status === "completed") {
          label = `Anfrage analysiert (${progress})`;
        }
      }
      if (finished) {
        const rawThought = extractThinkingToolContent(data, event);
        detail = rawThought ? sanitizeAndRedactDetail(rawThought) : undefined;
      }
    } else if (config.isPlanning) {
      counts = extractPlanningCounts(data, event);
      const items = extractPlanningItems(data, event);
      const currentTask = extractPlanningTask(data, event);
      detail = counts || currentTask ? formatPlanningDetailWithItems(counts ?? { total: 0 }, items, currentTask) : undefined;
    } else if (config.kind === "knowledge" || config.kind === "web") {
      if (responseType === "tool_call") {
        const query = extractSafeSearchQuery(data, event);
        detail = query ? `Suche: ${query}` : undefined;
      } else if (responseType === "tool_result" && successful) {
        if (toolName.toLowerCase() === "list_knowledge_chunks") {
          detail = extractKnowledgeChunksListSummary(data, event) ?? extractSearchResultSummary(data, event);
        } else {
          detail = extractSearchResultSummary(data, event);
        }
      }
    } else {
      if (responseType === "tool_call") {
        detail = formatSafeToolArguments(data, event);
      } else if (responseType === "tool_result" && successful) {
        detail = extractGenericResultSummary(data, event);
      }
    }

    label = boundedText(label, MAX_EXECUTION_LABEL_CHARS);

    const callId = boundedText(data.tool_call_id ?? event.tool_call_id, MAX_EXECUTION_ID_CHARS);
    const argumentsText = responseType === "tool_call" ? formatArgumentsPayload(data.arguments ?? event.arguments) : undefined;
    const resultText = responseType === "tool_call" ? undefined : formatResultPayload(data, event, successful);

    return {
      fatalError: false,
      unsupported: false,
      step: {
        id: eventId(event, data, config.kind),
        kind: config.kind,
        status,
        label,
        ...(callId ? { callId } : {}),
        ...(toolName ? { toolName } : {}),
        ...(argumentsText ? { arguments: argumentsText } : {}),
        ...(resultText ? { result: resultText } : {}),
        ...(detail ? { detail } : {}),
        ...(counts ? { counts } : {}),
        ...(duration !== undefined ? { durationMs: duration } : {}),
      },
    };
  }

  return { fatalError: false, unsupported: false };
}

function findSpawnParentId(steps: FredExecutionStep[], agent: FredExecutionStep): string | undefined {
  const quotedName = agent.taskName ? JSON.stringify(agent.taskName) : undefined;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step.toolName !== "spawn_agent") continue;
    if (agent.callId && step.result?.includes(agent.callId)) return step.id;
    if (quotedName && step.arguments?.includes(quotedName)) return step.id;
  }
  return undefined;
}

export function mergeFredExecutionStep(
  steps: FredExecutionStep[],
  rawUpdate: FredExecutionStep,
): FredExecutionStep[] {
  let update = rawUpdate;
  const isAgent = update.kind === "agent";
  if (isAgent) {
    // Helper-agent snapshots carry a group revision: a lower one than already seen is stale.
    if (update.revision !== undefined && steps.some((step) =>
      step.kind === "agent" && step.groupId === update.groupId && (step.revision ?? -Infinity) > update.revision!)) {
      return steps;
    }
    const parentId = update.parentId ?? findSpawnParentId(steps, update);
    if (parentId) update = { ...update, parentId };
  }
  const isCommandUpdate = update.kind === "tool" && (update.label === COMMAND_RUNNING_LABEL || update.label === COMMAND_DONE_LABEL);

  let existingIndex = steps.findIndex((step) => step.id === update.id);
  if (existingIndex < 0 && update.callId && !isAgent) {
    // Updates without a reliable id (e.g. live command output) are matched by the upstream tool_call_id.
    existingIndex = steps.findIndex((step) => step.kind !== "agent" && step.callId === update.callId);
  }
  if (existingIndex < 0) {
    // Merge consecutive analysis steps (mirroring native WeKnora buildFullEventList)
    if (steps.length > 0 && update.kind === "analysis") {
      const lastIndex = steps.length - 1;
      const lastStep = steps[lastIndex];
      if (lastStep.kind === "analysis") {
        const prevDetail = lastStep.detail || "";
        const curDetail = update.detail || "";

        let mergedDetail: string | undefined;
        if (curDetail && prevDetail && prevDetail.includes(curDetail)) {
          mergedDetail = prevDetail;
        } else if (curDetail && prevDetail && curDetail.includes(prevDetail)) {
          mergedDetail = curDetail;
        } else if (curDetail && prevDetail) {
          mergedDetail = sanitizeAndRedactDetail(`${prevDetail}\n\n${curDetail}`, MAX_EXECUTION_DETAIL_CHARS);
        } else {
          mergedDetail = curDetail || prevDetail || undefined;
        }

        const merged: FredExecutionStep = {
          ...lastStep,
          status: update.status,
          label: update.label,
          ...(mergedDetail !== undefined ? { detail: mergedDetail } : {}),
          ...(update.durationMs !== undefined ? { durationMs: update.durationMs } : (lastStep.durationMs !== undefined ? { durationMs: lastStep.durationMs } : {})),
        };
        if (mergedDetail === undefined) {
          delete merged.detail;
        }

        const next = [...steps];
        next[lastIndex] = merged;
        return next;
      }
    }
    return [...steps, update].slice(-MAX_EXECUTION_STEPS);
  }

  const existing = steps[existingIndex];
  const next = [...steps];

  if (isCommandUpdate) {
    // Live output replaces the previous tail; it never changes label/status of a real tool step.
    const placeholder = existing.label === COMMAND_RUNNING_LABEL && update.status !== "running";
    next[existingIndex] = {
      ...existing,
      ...(placeholder ? { status: update.status, label: update.label } : {}),
      callId: existing.callId ?? update.callId,
      ...(update.command ? { command: update.command } : {}),
      ...(update.output ? { output: update.output } : {}),
    };
    return next;
  }

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
  } else if (isAgent) {
    detail = undefined;
  }

  const merged: FredExecutionStep = {
    ...existing,
    ...update,
    id: existing.id,
    ...(detail !== undefined ? { detail } : {}),
  };
  if (detail === undefined) {
    delete merged.detail;
  }

  next[existingIndex] = merged;
  return next;
}

/** Merges every step of a parsed update and returns the steps that changed (for per-frame streaming). */
export function mergeFredExecutionUpdate(
  steps: FredExecutionStep[],
  update: FredExecutionUpdate,
): { trace: FredExecutionStep[]; touched: FredExecutionStep[] } {
  let trace = steps;
  for (const step of [...(update.step ? [update.step] : []), ...(update.steps ?? [])]) {
    trace = mergeFredExecutionStep(trace, step);
  }
  if (trace === steps) return { trace, touched: [] };
  const previous = new Set(steps);
  return { trace, touched: trace.filter((step) => !previous.has(step)) };
}

export function parseStoredFredExecutionTrace(value: unknown): FredExecutionStep[] {
  if (!Array.isArray(value)) return [];
  const validKinds = new Set(["analysis", "planning", "knowledge", "web", "tool", "evaluation", "sources", "agent", "memory", "context"]);
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

    const callId = boundedText(item.callId, MAX_EXECUTION_ID_CHARS);
    const toolName = boundedText(item.toolName, MAX_EXECUTION_ID_CHARS);
    const argumentsText = capPayload(item.arguments, MAX_EXECUTION_ARGUMENTS_CHARS);
    const result = capPayload(item.result, MAX_EXECUTION_RESULT_CHARS);
    const output = capPayload(item.output, MAX_EXECUTION_OUTPUT_CHARS, "tail");
    const command = capPayload(item.command, MAX_EXECUTION_COMMAND_CHARS);
    const parentId = boundedText(item.parentId, MAX_EXECUTION_ID_CHARS);
    const groupId = boundedText(item.groupId, MAX_EXECUTION_ID_CHARS);
    const taskName = boundedText(item.taskName, MAX_EXECUTION_ID_CHARS);
    const revision = typeof item.revision === "number" && Number.isFinite(item.revision) ? item.revision : undefined;

    return [{
      id,
      kind,
      status,
      label,
      ...(detail ? { detail } : {}),
      ...(duration !== undefined ? { durationMs: duration } : {}),
      ...(counts ? { counts } : {}),
      ...(callId ? { callId } : {}),
      ...(toolName ? { toolName } : {}),
      ...(argumentsText ? { arguments: argumentsText } : {}),
      ...(result ? { result } : {}),
      ...(output ? { output } : {}),
      ...(command ? { command } : {}),
      ...(parentId ? { parentId } : {}),
      ...(groupId ? { groupId } : {}),
      ...(taskName ? { taskName } : {}),
      ...(revision !== undefined ? { revision } : {}),
    }];
  });
}
