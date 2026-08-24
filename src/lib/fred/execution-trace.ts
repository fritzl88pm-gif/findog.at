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
  if (Array.isArray(record.todos)) return parseTodosFromUnknown(record.todos);
  if (Array.isArray(record.tasks)) return parseTodosFromUnknown(record.tasks);
  if (Array.isArray(record.items)) return parseTodosFromUnknown(record.items);
  if (Array.isArray(record.plan)) return parseTodosFromUnknown(record.plan);
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
        const isDone = item.completed === true || ["completed", "done", "finished", "success"].includes(status);
        const isInProgress = ["in_progress", "in-progress", "running", "active"].includes(status);

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
    return {
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

    const duration = durationMs(data.duration_ms ?? data.duration);
    const counts = config.isPlanning ? extractPlanningCounts(data, event) : null;
    const detail = counts ? formatPlanningDetail(counts) : undefined;

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
  if (existingIndex < 0) return [...steps, update].slice(-200);
  const next = [...steps];
  next[existingIndex] = { ...next[existingIndex], ...update };
  return next;
}

export function parseStoredFredExecutionTrace(value: unknown): FredExecutionStep[] {
  if (!Array.isArray(value)) return [];
  const validKinds = new Set(["analysis", "planning", "knowledge", "web", "tool", "evaluation", "sources"]);
  const validStatuses = new Set(["running", "completed", "failed"]);

  return value.slice(0, 200).flatMap((candidate) => {
    const item = recordOf(candidate);
    if (!item) return [];

    const id = boundedText(item.id, 180);
    const kind = boundedText(item.kind, 30) as FredExecutionStepKind;
    const status = boundedText(item.status, 30) as FredExecutionStepStatus;
    const label = boundedText(item.label, 200);

    if (!id || !validKinds.has(kind) || !validStatuses.has(status) || !label) {
      return [];
    }

    const detail = boundedText(item.detail, 500);
    const duration = durationMs(item.durationMs);

    let counts: FredPlanningCounts | undefined;
    const rawCounts = recordOf(item.counts);
    if (rawCounts) {
      const total = typeof rawCounts.total === "number" ? rawCounts.total : undefined;
      const completed = typeof rawCounts.completed === "number" ? rawCounts.completed : undefined;
      const inProgress = typeof rawCounts.inProgress === "number" ? rawCounts.inProgress : undefined;
      const open = typeof rawCounts.open === "number" ? rawCounts.open : undefined;
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
