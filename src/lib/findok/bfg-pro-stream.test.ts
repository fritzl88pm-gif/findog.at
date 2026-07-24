import { describe, expect, it } from "vitest";

import {
  BFG_PRO_STREAM_CONTENT_TYPE,
  bfgProStageLabel,
  encodeBfgProStreamEvent,
  parseBfgProStreamLine,
  type BfgProStreamEvent,
} from "./bfg-pro-stream";

describe("BFG PRO progress stream", () => {
  it("streams newline-delimited JSON", () => {
    expect(BFG_PRO_STREAM_CONTENT_TYPE).toBe("application/x-ndjson");
    expect(encodeBfgProStreamEvent({ type: "status", stage: "fetching", count: 18 }))
      .toBe('{"type":"status","stage":"fetching","count":18}\n');
  });

  it("round-trips every event kind", () => {
    for (const event of [
      { type: "status", stage: "queries" },
      { type: "status", stage: "summarizing", count: 12 },
      { type: "result", results: [{ title: "Entscheidung" }] },
      { type: "error", error: "Findok ist derzeit nicht erreichbar." },
    ] satisfies BfgProStreamEvent[]) {
      expect(parseBfgProStreamLine(encodeBfgProStreamEvent(event))).toEqual(event);
    }
  });

  it("ignores blank keepalive lines", () => {
    expect(parseBfgProStreamLine("")).toBeNull();
    expect(parseBfgProStreamLine("   \n")).toBeNull();
  });

  it.each([
    ["malformed JSON", "{"],
    ["missing type", JSON.stringify({ stage: "fetching" })],
    ["unknown type", JSON.stringify({ type: "delta", content: "x" })],
    ["unknown stage", JSON.stringify({ type: "status", stage: "hacking" })],
    ["non-integer count", JSON.stringify({ type: "status", stage: "fetching", count: 1.5 })],
    ["negative count", JSON.stringify({ type: "status", stage: "fetching", count: -1 })],
    ["non-array results", JSON.stringify({ type: "result", results: { title: "x" } })],
    ["blank error", JSON.stringify({ type: "error", error: "" })],
  ])("rejects an invalid stream line: %s", (_label, line) => {
    expect(() => parseBfgProStreamLine(line)).toThrow(/PRO-Streaming-Ereignis/u);
  });

  it("labels each pipeline stage in German", () => {
    expect(bfgProStageLabel({ stage: "queries" })).toBe("Suchanfragen werden erstellt…");
    expect(bfgProStageLabel({ stage: "fetching" })).toBe("BFG-Urteile werden geholt…");
    expect(bfgProStageLabel({ stage: "fetching", count: 18 }))
      .toBe("BFG-Urteile werden geholt… 18 Entscheidungen gefunden");
    expect(bfgProStageLabel({ stage: "sorting", count: 42 }))
      .toBe("42 Entscheidungen werden sortiert…");
    expect(bfgProStageLabel({ stage: "summarizing", count: 18 }))
      .toBe("18 Urteile werden bewertet und zusammengefasst…");
  });

  it("uses singular wording for a single decision", () => {
    expect(bfgProStageLabel({ stage: "fetching", count: 1 }))
      .toBe("BFG-Urteile werden geholt… 1 Entscheidung gefunden");
    expect(bfgProStageLabel({ stage: "sorting", count: 1 })).toBe("1 Entscheidung wird sortiert…");
    expect(bfgProStageLabel({ stage: "summarizing", count: 1 }))
      .toBe("1 Urteil wird bewertet und zusammengefasst…");
  });
});
