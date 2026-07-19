import { describe, expect, it } from "vitest";

import { encodeScanningStreamEvent, parseScanningStreamLine } from "./stream";
import type { ScanningStreamEvent } from "./types";

describe("scanning NDJSON events", () => {
  it("round-trips progress and final events", () => {
    const progress = { type: "progress", stage: "extracting", completed: 1, total: 2, fileName: "a.pdf" } as const;
    expect(parseScanningStreamLine(encodeScanningStreamEvent(progress))).toEqual(progress);

    const final: ScanningStreamEvent = {
      type: "final",
      report: "# Bericht",
      files: [{ id: "1", name: "a.pdf", kind: "pdf", status: "completed" }],
      model: "google/gemini-3.5-flash",
    };
    expect(parseScanningStreamLine(encodeScanningStreamEvent(final))).toEqual(final);
  });

  it("ignores malformed or foreign events", () => {
    expect(parseScanningStreamLine("not-json")).toBeNull();
    expect(parseScanningStreamLine('{"type":"progress","stage":"secret"}')).toBeNull();
  });
});
