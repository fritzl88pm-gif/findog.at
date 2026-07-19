import type { ScanningStreamEvent } from "./types";

export const SCANNING_STREAM_CONTENT_TYPE = "application/x-ndjson; charset=utf-8";

export function encodeScanningStreamEvent(event: ScanningStreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export function parseScanningStreamLine(line: string): ScanningStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let value: unknown;
  try {
    value = JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (event.type === "error" && typeof event.error === "string") {
    return { type: "error", error: event.error };
  }
  if (
    event.type === "progress"
    && ["validating", "extracting", "organizing"].includes(String(event.stage))
    && typeof event.completed === "number"
    && typeof event.total === "number"
    && (event.fileName === undefined || typeof event.fileName === "string")
  ) {
    return {
      type: "progress",
      stage: event.stage as "validating" | "extracting" | "organizing",
      completed: event.completed,
      total: event.total,
      ...(typeof event.fileName === "string" ? { fileName: event.fileName } : {}),
    };
  }
  if (
    event.type === "final"
    && typeof event.report === "string"
    && Array.isArray(event.files)
    && event.model === "google/gemini-3.5-flash"
  ) {
    return event as ScanningStreamEvent;
  }
  return null;
}
