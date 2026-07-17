import { describe, expect, it } from "vitest";

import { EvidenceStore, type EvidenceInput } from "./agent-evidence";
import { buildEvidenceBatches, missingEvidenceSegmentIds } from "./agent-evidence-batching";

function input(index: number, rawText: string): EvidenceInput {
  return {
    source: { key: "GESETZE", name: "Gesetze und Verordnungen", kind: "primary_law" },
    fundType: "norm",
    temporal: { stichtag: "2024-12-31", validityStatus: "applicable" },
    provenance: { locator: `EStG:paragraph-${index}`, chunkId: `chunk-${index}` },
    raw: { rawText },
    observations: [{
      retrievedAt: "2026-07-16T10:00:00.000Z",
      toolName: "search_laws",
    }],
  };
}

describe("buildEvidenceBatches", () => {
  it("processes every record exactly once without exceeding the batch budget", () => {
    const store = new EvidenceStore();
    for (let index = 0; index < 100; index += 1) {
      store.add(input(index, `record-${index}:${"X".repeat(300)}`));
    }

    const batches = buildEvidenceBatches(store.values(), { maxChars: 8_000 });
    const evidenceIds = batches.flatMap((batch) => batch.evidenceIds);

    expect(batches.every((batch) => batch.charCount <= 8_000)).toBe(true);
    expect(new Set(evidenceIds)).toEqual(new Set(store.values().map((record) => record.evidenceId)));
    expect(batches.flatMap((batch) => batch.segmentIds)).toHaveLength(100);
  });

  it("splits an oversized record losslessly and keeps a stable parent id", () => {
    const store = new EvidenceStore();
    const rawText = `${"A".repeat(9_000)}MIDDLE${"B".repeat(9_000)}TAIL`;
    const record = store.add(input(1, rawText)).record;

    const batches = buildEvidenceBatches([record], { maxChars: 5_000 });
    const segments = batches.flatMap((batch) => batch.segments);

    expect(segments.length).toBeGreaterThan(1);
    expect(segments.map((segment) => segment.rawText).join("")).toBe(rawText);
    expect(segments.every((segment) => segment.evidenceId === record.evidenceId)).toBe(true);
    expect(batches.every((batch) => batch.charCount <= 5_000)).toBe(true);
  });

  it("reports every segment that is absent from an analysis ledger", () => {
    const store = new EvidenceStore();
    const batch = buildEvidenceBatches([
      store.add(input(1, "A".repeat(7_000))).record,
    ], { maxChars: 5_000 })[0]!;

    expect(missingEvidenceSegmentIds(batch.segmentIds[0]!, batch)).toEqual(
      batch.segmentIds.slice(1),
    );
  });
});
