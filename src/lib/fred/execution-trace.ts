import { sanitizeAndRedactDetail } from "./safe-research-display";
import {
  EXECUTION_CUT_MARKER,
  sanitizeDisplayBlock,
  sanitizeDisplayLine,
  sanitizePayload,
} from "./execution-sanitize";
import {
  COMMAND_KEYS,
  MAX_STEP_FACTS,
  MAX_STEP_QUERIES,
  MAX_STEP_SOURCES,
  QUERY_KEY_SET,
  argumentsRecord,
  classifyError,
  dedupeSources,
  extractChunkExcerpts,
  extractFacts,
  extractQueries,
  extractSourcesFromPayload,
  parseMaybeJson,
  salvageSourcesFromText,
  sanitizeQuery,
  sanitizeStoredFacts,
  sanitizeStoredSource,
  sourceFromReference,
  titleFromPayload,
  summarizePayloadText,
  toolLabels,
  toolVariant,
  type FredExecutionFact,
  type FredExecutionSource,
  type FredToolVariant,
} from "./execution-structured";
import { THINKING_STEP_LABEL, MAX_THINKING_DETAIL_CHARS, sanitizeThinkingText } from "./thinking-sanitize";

export { EXECUTION_CUT_MARKER, sanitizeAndRedactDetail };
export type { FredExecutionFact, FredExecutionSource };

export const MAX_EXECUTION_STEPS = 200;
export const MAX_EXECUTION_DETAIL_CHARS = 2000;
export const MAX_EXECUTION_LABEL_CHARS = 200;
export const MAX_PLANNING_TODOS_COUNT = 50;
export const MAX_PLANNING_TASK_CHARS = 200;
/** Legacy: only applied when old persisted `arguments` strings are projected on read. */
export const MAX_EXECUTION_ARGUMENTS_CHARS = 8_000;
/** Legacy: only applied when old persisted `result` strings are projected on read. */
export const MAX_EXECUTION_RESULT_CHARS = 20_000;
export const MAX_EXECUTION_OUTPUT_CHARS = 8_000;
export const MAX_EXECUTION_COMMAND_CHARS = 2_000;
export const MAX_EXECUTION_ID_CHARS = 180;
/** Id of the single, text-free "analysing" phase marker. */
export const EXECUTION_PHASE_STEP_ID = "analysis:phase";
const PHASE_RUNNING_LABEL = "Analysiert die Anfrage";
const PHASE_DONE_LABEL = "Anfrage analysiert";

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
  | "context"
  /** Admin-only German "Gedankengang" (sanitized + translated reasoning); `detail` is the text. */
  | "thinking";

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
  /**
   * Short plain-text summary. Never raw reasoning text: analysis/evaluation steps carry no detail; only
   * admin-only `thinking` steps carry (sanitized, German) reasoning.
   */
  detail?: string;
  /** `thinking` steps only: id of the step this block follows (translation finishes after later steps). */
  afterId?: string;
  durationMs?: number;
  counts?: FredPlanningCounts;
  /** Opaque (hashed) correlation id of the upstream tool call / helper agent; never the raw id. */
  callId?: string;
  toolName?: string;
  /** Search queries / keywords as chips. */
  queries?: string[];
  /** Source hits (knowledge, document reads, web results). */
  sources?: FredExecutionSource[];
  /** Non-sensitive scalar arguments for tools without a dedicated view. */
  facts?: FredExecutionFact[];
  /** Short German failure reason for failed steps. */
  error?: string;
  /** Opaque tokens linking spawn_agent steps to their helper agents. */
  refs?: string[];
  /** Live or final sandbox command output (tail). */
  output?: string;
  command?: string;
  /** Id of the parent step (helper agents hang below their spawn_agent step). */
  parentId?: string;
  /** Helper-agent bookkeeping: collaboration group (opaque), latest seen revision and task name. */
  groupId?: string;
  revision?: number;
  taskName?: string;
  /**
   * @deprecated Legacy persisted payloads. Never produced anymore and removed by
   * `sanitizeStoredExecutionTrace`, which projects them into the structured fields above.
   */
  arguments?: string;
  /** @deprecated See `arguments`. */
  result?: string;
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

function hashedId(prefix: string, upstreamId: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < upstreamId.length; index += 1) {
    hash = Math.imul(hash ^ upstreamId.charCodeAt(index), 16_777_619);
  }
  return `${prefix}:${(hash >>> 0).toString(36)}`;
}

/** One-way, idempotent stand-in for upstream ids that are only needed for correlation. */
function opaqueId(prefix: string, upstreamId: string): string {
  return new RegExp(`^${prefix}:[0-9a-z]{1,8}$`, "u").test(upstreamId) ? upstreamId : hashedId(prefix, upstreamId);
}

function eventId(event: Record<string, unknown>, data: Record<string, unknown>, prefix: string): string {
  const upstreamId = boundedText(
    data.tool_call_id ?? data.event_id ?? event.event_id ?? event.id,
    180,
  ) || boundedText(data.iteration ?? event.iteration, 20) || "0";
  return hashedId(prefix, upstreamId);
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
      running: PHASE_RUNNING_LABEL,
      completed: PHASE_DONE_LABEL,
      failed: PHASE_DONE_LABEL,
      isThinkingTool: true,
    };
  }
  const variant = toolVariant(toolName);
  const labels = toolLabels(toolName, variant);
  if (PLANNING_TOOL_PATTERN.test(toolName)) {
    return {
      kind: "planning",
      running: "Rechercheplan wird aktualisiert",
      completed: "Rechercheplan aktualisiert",
      failed: "Rechercheplan konnte nicht aktualisiert werden",
      isPlanning: true,
    };
  }
  if (variant === "shell" || variant === "agent") {
    return { kind: "tool", ...(labels as NonNullable<typeof labels>) };
  }
  if (KNOWLEDGE_TOOL_PATTERN.test(toolName) && !WEB_TOOL_PATTERN.test(toolName)) {
    return {
      kind: "knowledge",
      running: labels?.running ?? "Wissensbasis wird durchsucht",
      completed: labels?.completed ?? "Wissensbasis durchsucht",
      failed: labels?.failed ?? "Wissensbasis-Suche fehlgeschlagen",
    };
  }
  if (WEB_TOOL_PATTERN.test(toolName)) {
    return {
      kind: "web",
      running: labels?.running ?? "Websuche wird durchgeführt",
      completed: labels?.completed ?? "Websuche durchgeführt",
      failed: labels?.failed ?? "Websuche fehlgeschlagen",
    };
  }
  return {
    kind: "tool",
    running: labels?.running ?? "Recherchewerkzeug wird ausgeführt",
    completed: labels?.completed ?? "Recherchewerkzeug ausgeführt",
    failed: labels?.failed ?? "Recherchewerkzeug fehlgeschlagen",
  };
}

// ── Tool projection ─────────────────────────────────────────────────────────

const TOOL_RESULT_META_KEYS = new Set(["tool_name", "tool_call_id", "success", "error", "duration_ms", "arguments"]);
const MEMBER_ID_KEYS = ["member_id", "task_id", "agent_id", "id"];

type ToolProjection = Partial<Pick<
  FredExecutionStep,
  "queries" | "sources" | "facts" | "command" | "output" | "detail" | "refs" | "error"
>>;

/** Places a tool result may carry structured rows (WeKnora wraps them in `data`). */
function resultCandidates(data: Record<string, unknown>, event: Record<string, unknown>): unknown[] {
  const rest = Object.fromEntries(Object.entries(data).filter(([key]) => !TOOL_RESULT_META_KEYS.has(key)));
  return [data.result, data.data, data.results, data.chunk_results, event.result, data.output, rest]
    .filter((candidate) => candidate !== undefined && candidate !== null);
}

function shellOutput(candidates: readonly unknown[]): string | undefined {
  for (const candidate of candidates) {
    const parsed = parseMaybeJson(candidate);
    if (typeof parsed === "string") return parsed;
    const record = recordOf(parsed);
    if (!record) continue;
    const parts = [record.stdout, record.output, record.stderr]
      .filter((part): part is string => typeof part === "string" && part.length > 0);
    if (parts.length > 0) return parts.join("\n");
  }
  return undefined;
}

function shellExitCode(candidates: readonly unknown[]): number | undefined {
  for (const candidate of candidates) {
    const record = recordOf(parseMaybeJson(candidate));
    const code = record?.exit_code ?? record?.exitCode ?? record?.returncode;
    if (typeof code === "number" && Number.isFinite(code)) return Math.round(code);
  }
  return undefined;
}

function collectMemberTokens(value: unknown, tokens: Set<string>, depth = 0): void {
  if (depth > 3 || tokens.size >= 20) return;
  const parsed = parseMaybeJson(value);
  if (Array.isArray(parsed)) {
    for (const item of parsed.slice(0, 20)) collectMemberTokens(item, tokens, depth + 1);
    return;
  }
  const record = recordOf(parsed);
  if (!record) return;
  for (const key of MEMBER_ID_KEYS) {
    const id = boundedText(record[key], MAX_EXECUTION_ID_CHARS);
    if (id) tokens.add(opaqueId("call", id));
  }
  const name = sanitizeDisplayLine(record.task_name ?? record.name ?? record.display_name, 120);
  if (name) tokens.add(`name:${name}`);
  for (const nested of ["tasks", "members", "agents", "result", "data"]) {
    if (record[nested] !== undefined) collectMemberTokens(record[nested], tokens, depth + 1);
  }
}

function agentTaskNames(args: Record<string, unknown> | null): string[] {
  if (!args) return [];
  const names = new Set<string>();
  const add = (value: unknown) => {
    const name = sanitizeDisplayLine(value, 120);
    if (name) names.add(name);
  };
  add(args.task_name ?? args.name ?? args.display_name);
  if (Array.isArray(args.tasks)) {
    for (const task of args.tasks.slice(0, 10)) add(recordOf(task)?.name ?? recordOf(task)?.task_name);
  }
  return [...names];
}

function projectTool(input: {
  toolName: string;
  variant: FredToolVariant;
  args: Record<string, unknown> | null;
  results: readonly unknown[];
  successful: boolean;
  finished: boolean;
  /** Plain-text result (legacy rows or `data.output`). */
  resultText?: string;
}): ToolProjection {
  const { variant, args, results, finished } = input;
  const projection: ToolProjection = {};

  if (variant === "shell") {
    const rawCommand = args
      ? Object.entries(args).find(([key, value]) => COMMAND_KEYS.has(key) && typeof value === "string" && value.trim().length > 0)?.[1]
      : undefined;
    const command = sanitizePayload(rawCommand, MAX_EXECUTION_COMMAND_CHARS);
    if (command) projection.command = command;
    if (finished) {
      const output = sanitizePayload(shellOutput([...results, ...(input.resultText ? [input.resultText] : [])]), MAX_EXECUTION_OUTPUT_CHARS, "tail", { environment: true });
      if (output) projection.output = output;
      const exitCode = shellExitCode(results);
      if (exitCode !== undefined && exitCode !== 0) projection.facts = [{ label: "Exit-Code", value: String(exitCode) }];
    }
    return finishProjection(projection, input);
  }

  if (variant === "search" || variant === "web" || variant === "read") {
    const extracted = finished ? extractSourcesFromPayload(results) : { sources: [], queries: [] };
    const queries = extractQueries(args, extracted.queries);
    if (queries.length > 0) projection.queries = queries;
    let { sources } = extracted;
    if (finished && variant === "read" && sources.length === 0) {
      sources = extractChunkExcerptsFor(results, args);
    }
    if (sources.length > 0) projection.sources = sources;
    if (variant === "web" || variant === "read") {
      const facts = extractFacts(args, QUERY_KEY_SET);
      if (facts.length > 0) projection.facts = facts;
    }
    return finishProjection(projection, input);
  }

  if (variant === "agent") {
    const tasks = agentTaskNames(args);
    if (tasks.length > 0) projection.facts = tasks.slice(0, MAX_STEP_FACTS).map((value) => ({ label: "Aufgabe", value }));
    const tokens = new Set<string>(tasks.map((name) => `name:${name}`));
    if (finished) for (const result of results) collectMemberTokens(result, tokens);
    if (tokens.size > 0) projection.refs = [...tokens].slice(0, 20);
    return finishProjection(projection, input);
  }

  // Unknown tools: a few harmless scalar arguments, never the payload itself.
  const facts = extractFacts(args);
  if (facts.length > 0) projection.facts = facts;
  return finishProjection(projection, input);
}

function extractChunkExcerptsFor(results: readonly unknown[], args: Record<string, unknown> | null): FredExecutionSource[] {
  const fallback = titleFromArguments(args) ?? titleFromPayload(results) ?? "Dokument";
  return extractChunkExcerpts(results, fallback).slice(0, MAX_STEP_SOURCES);
}

function titleFromArguments(args: Record<string, unknown> | null): string | undefined {
  return titleFromPayload(args ? [args] : []);
}

function finishProjection(
  projection: ToolProjection,
  input: { variant: FredToolVariant; results: readonly unknown[]; successful: boolean; finished: boolean; resultText?: string },
): ToolProjection {
  if (!input.finished) return projection;
  if (!input.successful) {
    projection.error = classifyError(input.resultText);
    return projection;
  }
  if (input.variant === "shell" || input.variant === "agent") return projection;
  if (!projection.sources) {
    const text = summarizePayloadText(input.resultText);
    if (text) projection.detail = text;
  }
  return projection;
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
  const rawCallId = boundedText(data.tool_call_id ?? fallbackCallId, MAX_EXECUTION_ID_CHARS);
  if (!rawCallId) return undefined;
  const done = data.done === true;
  const output = sanitizePayload(data.output, MAX_EXECUTION_OUTPUT_CHARS, "tail", { environment: true });
  const command = sanitizePayload(data.command, MAX_EXECUTION_COMMAND_CHARS);
  return {
    id: hashedId("tool", rawCallId),
    kind: "tool",
    status: done ? "completed" : "running",
    label: done ? COMMAND_DONE_LABEL : COMMAND_RUNNING_LABEL,
    callId: opaqueId("call", rawCallId),
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
    const taskName = sanitizeDisplayLine(boundedText(task.name ?? task.task_name, 120), 120);
    const displayName = sanitizeDisplayLine(boundedText(task.display_name, 120), 120) ?? taskName;
    const rawStatus = boundedText(task.status, 40).toLowerCase();
    const cancelling = task.cancel_requested === true && !["succeeded", "failed", "cancelled", "interrupted"].includes(rawStatus);
    const statusLabel = cancelling ? "Wird abgebrochen" : AGENT_STATUS_LABELS[rawStatus] ?? "Läuft";
    const status: FredExecutionStepStatus = rawStatus === "succeeded"
      ? "completed"
      : ["failed", "interrupted", "cancelled"].includes(rawStatus) ? "failed" : "running";

    // Only the progress counter is shown: helper-agent messages may contain reasoning text.
    const progress = recordOf(task.progress);
    const iteration = Number(progress?.iteration);
    const detail = Number.isFinite(iteration) && iteration > 0 ? `Schritt ${Math.round(iteration)}` : undefined;

    return [{
      id: hashedId("agent", taskId),
      kind: "agent",
      status,
      label: boundedText(`Hilfs-Agent${displayName ? ` ${displayName}` : ""}: ${statusLabel}`, MAX_EXECUTION_LABEL_CHARS),
      ...(detail ? { detail } : {}),
      callId: opaqueId("call", memberId),
      ...(taskName ? { taskName } : {}),
      ...(groupId ? { groupId: opaqueId("grp", groupId) } : {}),
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
  return {
    id: hashedId("memory", boundedText(event.id ?? data.event_id, 180) || memories.map((memory) => memory.id || memory.content).join("|")),
    kind: "memory",
    status: "completed",
    // One compact line: the recalled content itself stays on the server.
    label: `${memories.length} ${memories.length === 1 ? "Erinnerung" : "Erinnerungen"} abgerufen`,
  };
}

function contextCompactedStep(event: Record<string, unknown>, data: Record<string, unknown>): FredExecutionStep {
  const before = Number(data.tokens_before);
  const after = Number(data.tokens_after);
  const hasTokens = data.tokens_before != null && data.tokens_after != null && Number.isFinite(before) && Number.isFinite(after);
  return {
    id: hashedId("context", boundedText(event.id ?? data.event_id, 180) || [data.tokens_before, data.tokens_after, data.messages_before, data.messages_after].join("|")),
    kind: "context",
    status: "completed",
    label: hasTokens
      ? `Gesprächsverlauf komprimiert (${Math.round(before).toLocaleString("de-DE")} → ${Math.round(after).toLocaleString("de-DE")} Tokens)`
      : "Gesprächsverlauf komprimiert",
  };
}

/** The single text-free "analysing" marker; thinking/reflection text never reaches a step. */
function phaseStep(done: boolean): FredExecutionStep {
  return {
    id: EXECUTION_PHASE_STEP_ID,
    kind: "analysis",
    status: done ? "completed" : "running",
    label: done ? PHASE_DONE_LABEL : PHASE_RUNNING_LABEL,
  };
}

function referencesStep(event: Record<string, unknown>, data: Record<string, unknown>): FredExecutionStep | undefined {
  const references = Array.isArray(data.references)
    ? data.references
    : Array.isArray(event.references)
      ? event.references
      : [];
  const sources = dedupeSources(references.slice(0, 50).flatMap((item) => {
    const source = sourceFromReference(item);
    return source ? [source] : [];
  })).slice(0, MAX_STEP_SOURCES);
  const count = references.length;
  if (count === 0) return undefined;
  return {
    id: eventId(event, data, "sources"),
    kind: "sources",
    status: "completed",
    label: `${count} ${count === 1 ? "Quelle" : "Quellen"} gefunden`,
    ...(sources.length > 0 ? { sources } : {}),
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
      return { fatalError: false, unsupported: false, step: phaseStep(false) };
    }
    return { fatalError: false, unsupported: false };
  }

  if (responseType === "thinking") {
    // Reasoning text is never surfaced by this parser - only the neutral phase marker. The admin-only German
    // "Gedankengang" is built separately (thinking-trace.ts: sanitized + translated) and never untranslated.
    const done = data.done === true || event.done === true;
    return { fatalError: false, unsupported: false, step: phaseStep(done) };
  }

  if (responseType === "reflection") {
    return { fatalError: false, unsupported: false };
  }

  if (responseType === "references") {
    return { fatalError: false, unsupported: false, step: referencesStep(event, data) };
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

    if (config.isThinkingTool) {
      // The thinking tool carries reasoning text: only the phase marker survives.
      return { fatalError: false, unsupported: false, step: phaseStep(status !== "running") };
    }

    let label = config.running;
    if (status === "completed") {
      label = config.completed;
    } else if (status === "failed") {
      label = config.failed;
    }

    const duration = durationMs(data.duration_ms ?? data.duration ?? event.duration_ms ?? event.duration);
    let detail: string | undefined;
    let counts: FredPlanningCounts | null = null;
    let projection: ToolProjection = {};
    const variant = toolVariant(toolName);

    if (config.isPlanning) {
      counts = extractPlanningCounts(data, event);
      const items = extractPlanningItems(data, event);
      const currentTask = extractPlanningTask(data, event);
      detail = counts || currentTask ? formatPlanningDetailWithItems(counts ?? { total: 0 }, items, currentTask) : undefined;
    } else {
      const args = argumentsRecord(data.arguments ?? event.arguments);
      const results = finished ? resultCandidates(data, event) : [];
      const resultText = typeof data.output === "string" ? data.output : undefined;
      projection = projectTool({
        toolName,
        variant,
        args,
        results,
        successful,
        finished,
        resultText: !successful ? [resultText, boundedText(data.error ?? event.error, 400)].filter(Boolean).join("\n") : resultText,
      });
      if (finished && successful && (config.kind === "knowledge" || config.kind === "web")) {
        detail = toolName.toLowerCase() === "list_knowledge_chunks"
          ? extractKnowledgeChunksListSummary(data, event) ?? extractSearchResultSummary(data, event)
          : extractSearchResultSummary(data, event);
      } else if (finished && successful && projection.detail === undefined && variant === "generic") {
        detail = extractGenericResultSummary(data, event);
      }
      if (projection.detail && detail === undefined) detail = projection.detail;
    }

    label = boundedText(label, MAX_EXECUTION_LABEL_CHARS);

    const callId = boundedText(data.tool_call_id ?? event.tool_call_id, MAX_EXECUTION_ID_CHARS);

    return {
      fatalError: false,
      unsupported: false,
      step: {
        id: eventId(event, data, config.kind),
        kind: config.kind,
        status,
        label,
        ...(callId ? { callId: opaqueId("call", callId) } : {}),
        ...(toolName ? { toolName: sanitizeDisplayLine(toolName, 80) ?? "" } : {}),
        ...(projection.queries ? { queries: projection.queries } : {}),
        ...(projection.sources ? { sources: projection.sources } : {}),
        ...(projection.facts ? { facts: projection.facts } : {}),
        ...(projection.command ? { command: projection.command } : {}),
        ...(projection.output ? { output: projection.output } : {}),
        ...(projection.refs ? { refs: projection.refs } : {}),
        ...(projection.error ? { error: projection.error } : {}),
        ...(detail ? { detail } : {}),
        ...(counts ? { counts } : {}),
        ...(duration !== undefined ? { durationMs: duration } : {}),
      },
    };
  }

  return { fatalError: false, unsupported: false };
}

function findSpawnParentId(steps: FredExecutionStep[], agent: FredExecutionStep): string | undefined {
  const nameToken = agent.taskName ? `name:${agent.taskName}` : undefined;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (toolVariant(step.toolName) !== "agent" || !step.refs) continue;
    if (agent.callId && step.refs.includes(agent.callId)) return step.id;
    if (nameToken && step.refs.includes(nameToken)) return step.id;
  }
  return undefined;
}

function completePhase(steps: FredExecutionStep[]): FredExecutionStep[] {
  const index = steps.findIndex((step) => step.id === EXECUTION_PHASE_STEP_ID && step.status === "running");
  if (index < 0) return steps;
  const next = [...steps];
  next[index] = { ...steps[index], status: "completed", label: PHASE_DONE_LABEL };
  return next;
}

function unique(values: readonly string[], maximum: number): string[] {
  return [...new Set(values)].slice(0, maximum);
}

/**
 * Thinking blocks are translated asynchronously, so they arrive after later steps: they are placed right
 * after the step that was current when the block ended (and after earlier blocks of the same anchor).
 * They never close the analysis marker and are inserted at most once per id.
 */
function mergeThinkingStep(steps: FredExecutionStep[], update: FredExecutionStep): FredExecutionStep[] {
  if (steps.some((step) => step.id === update.id)) return steps;
  const anchor = update.afterId ? steps.findIndex((step) => step.id === update.afterId) : -1;
  if (anchor < 0) return [...steps, update].slice(-MAX_EXECUTION_STEPS);
  let position = anchor + 1;
  while (position < steps.length && steps[position].kind === "thinking" && steps[position].afterId === update.afterId) {
    position += 1;
  }
  return [...steps.slice(0, position), update, ...steps.slice(position)].slice(-MAX_EXECUTION_STEPS);
}

export function mergeFredExecutionStep(
  rawSteps: FredExecutionStep[],
  rawUpdate: FredExecutionStep,
): FredExecutionStep[] {
  let update = rawUpdate;
  const isAgent = update.kind === "agent";
  if (isAgent) {
    // Helper-agent snapshots carry a group revision: a lower one than already seen is stale.
    if (update.revision !== undefined && rawSteps.some((step) =>
      step.kind === "agent" && step.groupId === update.groupId && (step.revision ?? -Infinity) > update.revision!)) {
      return rawSteps;
    }
  }
  if (update.id === EXECUTION_PHASE_STEP_ID) {
    const known = rawSteps.find((step) => step.id === EXECUTION_PHASE_STEP_ID);
    // The marker is coalesced: once completed, later thinking/reflection rounds never reopen it.
    if (known && (known.status !== "running" || update.status === "running")) return rawSteps;
  }
  if (update.kind === "thinking") return mergeThinkingStep(rawSteps, update);
  const steps = update.id === EXECUTION_PHASE_STEP_ID ? rawSteps : completePhase(rawSteps);
  if (isAgent) {
    const parentId = update.parentId ?? findSpawnParentId(steps, update);
    if (parentId) update = { ...update, parentId };
  }
  const isCommandUpdate = update.kind === "tool" && (update.label === COMMAND_RUNNING_LABEL || update.label === COMMAND_DONE_LABEL);

  let existingIndex = steps.findIndex((step) => step.id === update.id);
  if (existingIndex < 0 && update.callId && !isAgent) {
    // Updates without a reliable id (e.g. live command output) are matched by the correlation id.
    existingIndex = steps.findIndex((step) => step.kind !== "agent" && step.callId === update.callId);
  }
  if (existingIndex < 0) {
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
    detail = update.detail;
  } else if (isAgent) {
    detail = undefined;
  }

  const queries = unique([...(existing.queries ?? []), ...(update.queries ?? [])], MAX_STEP_QUERIES);
  const refs = unique([...(existing.refs ?? []), ...(update.refs ?? [])], 20);
  const merged: FredExecutionStep = {
    ...existing,
    ...update,
    id: existing.id,
    ...(queries.length > 0 ? { queries } : {}),
    ...(refs.length > 0 ? { refs } : {}),
    ...(detail !== undefined ? { detail } : {}),
  };
  if (detail === undefined) delete merged.detail;
  if (update.status === "completed") delete merged.error;

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

/** Marks a still-running analysis marker as finished (end of a run, or any stored trace). */
export function finalizeExecutionTrace(steps: FredExecutionStep[]): FredExecutionStep[] {
  const closed = completePhase(steps);
  if (!closed.some((step) => step.status === "running" && (step.kind === "analysis" || step.kind === "evaluation"))) return closed;
  return closed.map((step) => step.status === "running" && (step.kind === "analysis" || step.kind === "evaluation")
    ? completedMarkerLabel({ ...step, status: "completed" as const })
    : step);
}

// ── Stored / streamed trace sanitizing ──────────────────────────────────────

const VALID_KINDS = new Set<string>(["analysis", "planning", "knowledge", "web", "tool", "evaluation", "sources", "agent", "memory", "context", "thinking"]);
const VALID_STATUSES = new Set<string>(["running", "completed", "failed"]);
const REASONING_KINDS = new Set<string>(["analysis", "evaluation"]);

function sanitizeCounts(value: unknown): FredPlanningCounts | undefined {
  const rawCounts = recordOf(value);
  if (!rawCounts) return undefined;
  const count = (raw: unknown) => typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : undefined;
  const total = count(rawCounts.total);
  const completed = count(rawCounts.completed);
  const inProgress = count(rawCounts.inProgress);
  const open = count(rawCounts.open);
  if (total === undefined && completed === undefined && inProgress === undefined && open === undefined) return undefined;
  return {
    ...(total !== undefined ? { total } : {}),
    ...(completed !== undefined ? { completed } : {}),
    ...(inProgress !== undefined ? { inProgress } : {}),
    ...(open !== undefined ? { open } : {}),
  };
}

/** Old `detail` strings that merely echoed raw parameters / queries; they are replaced by structured fields. */
function isLegacyEchoDetail(detail: string): boolean {
  return /^(?:Parameter|Suche):\s/u.test(detail);
}

/**
 * Projects legacy raw `arguments` / `result` strings of a stored tool step into the structured fields.
 * Raw payloads are never passed through.
 */
function projectLegacyPayload(
  item: Record<string, unknown>,
  status: FredExecutionStepStatus,
  toolName: string,
): ToolProjection {
  const argumentsText = typeof item.arguments === "string" ? item.arguments.slice(0, MAX_EXECUTION_ARGUMENTS_CHARS * 2) : undefined;
  const resultText = typeof item.result === "string" ? item.result.slice(0, MAX_EXECUTION_RESULT_CHARS * 2) : undefined;
  if (!argumentsText && !resultText) return {};
  const parsedResult = resultText ? parseMaybeJson(resultText) : undefined;
  const variant = toolVariant(toolName);
  const finished = status !== "running";
  const projection = projectTool({
    toolName,
    variant,
    args: argumentsText ? argumentsRecord(argumentsText) : null,
    results: parsedResult !== undefined ? [parsedResult] : [],
    successful: status !== "failed",
    finished: finished && resultText !== undefined,
    resultText: typeof parsedResult === "string" ? parsedResult : undefined,
  });
  if (!projection.sources && resultText && (variant === "search" || variant === "read" || variant === "web")) {
    const salvaged = salvageSourcesFromText(resultText);
    if (salvaged.length > 0) projection.sources = salvaged;
  }
  if (!projection.detail && !projection.sources && typeof parsedResult !== "string" && resultText && status === "failed") {
    projection.error ??= classifyError(resultText);
  }
  return projection;
}

function sanitizeStoredStep(candidate: unknown): FredExecutionStep | null {
  const item = recordOf(candidate);
  if (!item) return null;

  const id = boundedText(item.id, 180);
  const kind = boundedText(item.kind, 30) as FredExecutionStepKind;
  const status = boundedText(item.status, 30) as FredExecutionStepStatus;
  const label = sanitizeDisplayLine(boundedText(item.label, MAX_EXECUTION_LABEL_CHARS), MAX_EXECUTION_LABEL_CHARS) ?? "";
  if (!id || !VALID_KINDS.has(kind) || !VALID_STATUSES.has(status) || !label) return null;

  if (kind === "thinking") {
    // Only German, sanitized text survives; a block without text is dropped (never an empty or English stub).
    const text = sanitizeThinkingText(item.detail, "de").slice(0, MAX_THINKING_DETAIL_CHARS).trim();
    if (!text) return null;
    const afterId = boundedText(item.afterId, 180);
    return {
      id,
      kind: "thinking",
      status: "completed",
      label: THINKING_STEP_LABEL,
      detail: text,
      ...(afterId ? { afterId } : {}),
    };
  }

  const toolName = sanitizeDisplayLine(boundedText(item.toolName, 80), 80);
  const isReasoning = REASONING_KINDS.has(kind) || toolName?.toLowerCase() === "thinking";
  // Legacy search steps were all labelled "Wissensbasis durchsucht", also document reads.
  const toolLabel = !isReasoning && toolName && (kind === "knowledge" || kind === "web")
    ? toolLabels(toolName, toolVariant(toolName))?.[status]
    : undefined;
  const legacy = isReasoning ? {} : projectLegacyPayload(item, status, toolName ?? "");

  // Reasoning is never shown: analysis/evaluation steps carry no detail, memory/context only their label.
  let detail: string | undefined;
  if (!isReasoning && kind !== "memory" && kind !== "context") {
    const rawDetail = typeof item.detail === "string" ? item.detail : undefined;
    if (kind === "agent") {
      detail = rawDetail?.split("\n").find((line) => /^Schritt \d+/u.test(line));
    } else if (rawDetail && !isLegacyEchoDetail(rawDetail)) {
      detail = sanitizeDisplayBlock(rawDetail, MAX_EXECUTION_DETAIL_CHARS);
    }
    detail ??= legacy.detail;
  }

  const queries = isReasoning ? [] : unique([
    ...(Array.isArray(item.queries) ? item.queries.flatMap((query) => {
      const clean = sanitizeQuery(query);
      return clean ? [clean] : [];
    }) : []),
    ...(legacy.queries ?? []),
  ], MAX_STEP_QUERIES);

  const storedSources = Array.isArray(item.sources)
    ? item.sources.slice(0, MAX_STEP_SOURCES).flatMap((source) => {
      const clean = sanitizeStoredSource(source);
      return clean ? [clean] : [];
    })
    : [];
  const sources = isReasoning ? [] : (storedSources.length > 0 ? storedSources : legacy.sources ?? []);

  const storedFacts = sanitizeStoredFacts(item.facts);
  const facts = isReasoning ? [] : (storedFacts.length > 0 ? storedFacts : legacy.facts ?? []);

  const command = sanitizePayload(item.command, MAX_EXECUTION_COMMAND_CHARS) ?? legacy.command;
  const output = sanitizePayload(item.output, MAX_EXECUTION_OUTPUT_CHARS, "tail", { environment: true }) ?? legacy.output;
  const error = status === "failed"
    ? sanitizeDisplayLine(item.error, 80) ?? legacy.error
    : undefined;

  const rawRefs = Array.isArray(item.refs) ? item.refs : [];
  const refs = unique([
    ...rawRefs.flatMap((ref) => {
      const text = sanitizeDisplayLine(ref, 130);
      return text ? [text] : [];
    }),
    ...(legacy.refs ?? []),
  ], 20);

  const duration = durationMs(item.durationMs);
  const counts = sanitizeCounts(item.counts);
  const rawCallId = boundedText(item.callId, MAX_EXECUTION_ID_CHARS);
  const rawGroupId = boundedText(item.groupId, MAX_EXECUTION_ID_CHARS);
  const parentId = boundedText(item.parentId, MAX_EXECUTION_ID_CHARS);
  const taskName = sanitizeDisplayLine(boundedText(item.taskName, MAX_EXECUTION_ID_CHARS), 120);
  const revision = typeof item.revision === "number" && Number.isFinite(item.revision) ? item.revision : undefined;

  return {
    id,
    kind,
    status,
    label: toolLabel ?? label,
    ...(detail ? { detail } : {}),
    ...(duration !== undefined ? { durationMs: duration } : {}),
    ...(counts ? { counts } : {}),
    ...(rawCallId ? { callId: opaqueId("call", rawCallId) } : {}),
    ...(toolName ? { toolName } : {}),
    ...(queries.length > 0 ? { queries } : {}),
    ...(sources.length > 0 ? { sources } : {}),
    ...(facts.length > 0 ? { facts } : {}),
    ...(error ? { error } : {}),
    ...(refs.length > 0 ? { refs } : {}),
    ...(output ? { output } : {}),
    ...(command ? { command } : {}),
    ...(parentId ? { parentId } : {}),
    ...(rawGroupId ? { groupId: opaqueId("grp", rawGroupId) } : {}),
    ...(taskName ? { taskName } : {}),
    ...(revision !== undefined ? { revision } : {}),
  };
}

/**
 * Legacy traces stored one analysis/evaluation step per event, interleaved with tools. Only the first
 * (text-free) marker is kept; a completed marker always reads like the live phase marker once done.
 */
function coalesceReasoningSteps(steps: FredExecutionStep[]): FredExecutionStep[] {
  const result: FredExecutionStep[] = [];
  let marker: FredExecutionStep | undefined;
  for (const step of steps) {
    if (!REASONING_KINDS.has(step.kind) && step.toolName?.toLowerCase() !== "thinking") {
      result.push(step);
      continue;
    }
    if (!marker) {
      marker = step;
      result.push(step);
      continue;
    }
    // Later markers only advance the first one (a still-running marker is closed by a later completed one).
    if (marker.status === "running" && step.status !== "running") {
      const index = result.indexOf(marker);
      marker = { ...marker, status: step.status };
      result[index] = marker;
    }
  }
  return result.map(completedMarkerLabel);
}

function completedMarkerLabel(step: FredExecutionStep): FredExecutionStep {
  return (REASONING_KINDS.has(step.kind) || step.toolName?.toLowerCase() === "thinking") && step.status === "completed" && step.label !== PHASE_DONE_LABEL
    ? { ...step, label: PHASE_DONE_LABEL }
    : step;
}

/**
 * Validates, masks and projects a persisted or streamed execution trace for the browser:
 * no raw reasoning text (only admin-only, sanitized German `thinking` steps; `stripThinking` removes them), no internal ids / hosts / model names, no raw JSON payloads.
 * Idempotent, so it is safe to apply on the server (read path) and again on the client.
 * `finalize` closes a still-running analysis marker (stored traces belong to finished runs).
 */
export function sanitizeStoredExecutionTrace(
  value: unknown,
  options: { finalize?: boolean; stripThinking?: boolean } = {},
): FredExecutionStep[] {
  if (!Array.isArray(value)) return [];
  const steps = coalesceReasoningSteps(value.slice(0, MAX_EXECUTION_STEPS).flatMap((candidate) => {
    const step = sanitizeStoredStep(candidate);
    // `stripThinking` is the server-side admin gate for reads: non-admins never receive "Gedankengang" text.
    return step && !(options.stripThinking && step.kind === "thinking") ? [step] : [];
  }));
  return options.finalize ? finalizeExecutionTrace(steps) : steps;
}

/** Kept for existing callers; identical to `sanitizeStoredExecutionTrace`. */
export function parseStoredFredExecutionTrace(value: unknown): FredExecutionStep[] {
  return sanitizeStoredExecutionTrace(value);
}
