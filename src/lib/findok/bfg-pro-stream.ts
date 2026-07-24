export const BFG_PRO_STREAM_CONTENT_TYPE = "application/x-ndjson";

export const BFG_PRO_STAGES = ["queries", "fetching", "sorting", "summarizing"] as const;

export type BfgProStage = (typeof BFG_PRO_STAGES)[number];

export type BfgProProgress = {
  stage: BfgProStage;
  count?: number;
};

export type BfgProStreamEvent =
  | ({ type: "status" } & BfgProProgress)
  | { type: "result"; results: unknown[] }
  | { type: "error"; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isBfgProStage(value: unknown): value is BfgProStage {
  return typeof value === "string" && (BFG_PRO_STAGES as readonly string[]).includes(value);
}

function isCount(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isInteger(value) && value >= 0);
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

export function bfgProStageLabel(progress: BfgProProgress): string {
  const { stage, count } = progress;
  if (stage === "queries") {
    return "Suchanfragen werden erstellt…";
  }
  if (stage === "fetching") {
    return count === undefined
      ? "BFG-Urteile werden geholt…"
      : `BFG-Urteile werden geholt… ${count} ${plural(count, "Entscheidung", "Entscheidungen")} gefunden`;
  }
  if (stage === "sorting") {
    return count === undefined
      ? "Urteile werden sortiert…"
      : `${count} ${plural(count, "Entscheidung wird", "Entscheidungen werden")} sortiert…`;
  }
  return count === undefined
    ? "Urteile werden zusammengefasst…"
    : `${count} ${plural(count, "Urteil wird", "Urteile werden")} bewertet und zusammengefasst…`;
}

export function encodeBfgProStreamEvent(event: BfgProStreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export function parseBfgProStreamLine(line: string): BfgProStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    throw new Error("Ungültiges PRO-Streaming-Ereignis.");
  }
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("Ungültiges PRO-Streaming-Ereignis.");
  }

  if (value.type === "status") {
    if (!isBfgProStage(value.stage) || !isCount(value.count)) {
      throw new Error("Ungültiges PRO-Streaming-Ereignis.");
    }
    return value.count === undefined
      ? { type: "status", stage: value.stage }
      : { type: "status", stage: value.stage, count: value.count };
  }
  if (value.type === "result") {
    if (!Array.isArray(value.results)) {
      throw new Error("Ungültiges PRO-Streaming-Ereignis.");
    }
    return { type: "result", results: value.results };
  }
  if (value.type === "error") {
    if (typeof value.error !== "string" || !value.error) {
      throw new Error("Ungültiges PRO-Streaming-Ereignis.");
    }
    return { type: "error", error: value.error };
  }

  throw new Error("Unbekanntes PRO-Streaming-Ereignis.");
}
