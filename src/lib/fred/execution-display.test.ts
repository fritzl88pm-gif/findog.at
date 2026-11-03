import { describe, expect, it } from "vitest";

import {
  aggregateExecutionSources,
  buildExecutionOverview,
  buildSourceView,
  executionIconKey,
  formatDuration,
  parsePlanningDetail,
} from "./execution-display";
import type { FredExecutionStep } from "./execution-trace";

const step = (overrides: Partial<FredExecutionStep>): FredExecutionStep => ({
  id: "s", kind: "knowledge", status: "completed", label: "L", ...overrides,
});

describe("execution display helpers", () => {
  it("aggregates sources across steps: deduped, best score first, capped, extra references appended", () => {
    const steps = [
      step({ id: "a", sources: [{ title: "Doku A", snippet: "eins", score: 0.4 }, { title: "Doku B", snippet: "zwei", score: 0.9 }] }),
      step({ id: "b", sources: [{ title: "Doku A", snippet: "eins", score: 0.7 }, { title: "Doku C", snippet: "drei" }] }),
    ];
    const aggregated = aggregateExecutionSources(steps, [
      { kind: "knowledge", doc: "Doku B", chunkId: "x" },
      { kind: "web", url: "https://ris.bka.gv.at/", title: "RIS" },
    ]);
    expect(aggregated.map((source) => source.title)).toEqual(["Doku B", "Doku A", "Doku C", "RIS"]);
    expect(aggregated[1].score).toBe(0.7);
    expect(JSON.stringify(aggregated)).not.toContain("chunkId");
    expect(aggregateExecutionSources(steps, [], 2)).toHaveLength(2);
  });

  it("builds the overview chips", () => {
    const overview = buildExecutionOverview([
      step({ id: "p", kind: "analysis", durationMs: 100 }),
      step({ id: "a", sources: [{ title: "Doku A", snippet: "eins" }], durationMs: 1_500 }),
      step({ id: "t", kind: "tool", toolName: "shell_exec", durationMs: 500 }),
      step({ id: "c", kind: "agent", parentId: "t", durationMs: 9_999 }),
    ]);
    expect(overview).toEqual({ steps: 4, tools: 2, sources: 1, durationMs: 2_100 });
    expect(buildExecutionOverview([step({ id: "x" })]).durationMs).toBeUndefined();
  });

  it("maps steps to icons", () => {
    expect(executionIconKey({ kind: "knowledge", toolName: "search_knowledge" })).toBe("search");
    expect(executionIconKey({ kind: "knowledge", toolName: "read_document" })).toBe("read");
    expect(executionIconKey({ kind: "web" })).toBe("web");
    expect(executionIconKey({ kind: "tool", toolName: "shell_exec" })).toBe("shell");
    expect(executionIconKey({ kind: "tool", toolName: "spawn_agent" })).toBe("agent");
    expect(executionIconKey({ kind: "agent" })).toBe("agent");
    expect(executionIconKey({ kind: "evaluation" })).toBe("analysis");
    expect(executionIconKey({ kind: "tool", toolName: "calculate_tax" })).toBe("generic");
  });

  it("parses the planning detail and formats durations", () => {
    expect(parsePlanningDetail("Aktuelle Aufgabe: X\n2 Aufgaben geplant\n- [x] A\n- [/] B\n- [ ] C")).toEqual({
      notes: ["Aktuelle Aufgabe: X", "2 Aufgaben geplant"],
      items: [{ state: "done", text: "A" }, { state: "active", text: "B" }, { state: "open", text: "C" }],
    });
    expect(formatDuration(1_234)).toBe("1,2 s");
    expect(formatDuration(80_000)).toBe("1 min 20 s");
  });
});

describe("buildSourceView", () => {
  it("shows no internal chunk sequence; uses the breadcrumb locator and cleaned text", () => {
    const view = buildSourceView({
      title: "LStR_2002_idF_2025-12-18_full_verified.md",
      kind: "guideline",
      section: "Abschnitt 4459",
      snippet: "... > LStR 2002 · Rz 795a · Teil 1 · Stichtag: 2025-12-18 · PDF S. 479 · BMF GZ 2025-0.951.634 Der monatliche Unterhaltsabsetzbetrag beträgt 35 Euro ...",
      excerpt: "> LStR 2002 · Rz 795a · Teil 1 · Stichtag: 2025-12-18 · PDF S. 479 · BMF GZ 2025-0.951.634\nDer monatliche Unterhaltsabsetzbetrag beträgt 35 Euro für ein Kind, 52 Euro für das zweite Kind.",
    });
    expect(view.locator).toBe("Rz 795a · S. 479");
    expect(view.snippet).toBe("Der monatliche Unterhaltsabsetzbetrag beträgt 35 …");
    expect(view.excerpt).toBe("Der monatliche Unterhaltsabsetzbetrag beträgt 35 Euro für ein Kind, 52 Euro für das zweite Kind.");
    expect(JSON.stringify(view)).not.toMatch(/Abschnitt|Stichtag|GZ/u);
  });

  it("drops the internal Abschnitt number and keeps real sections such as pages", () => {
    expect(buildSourceView({ title: "Doku", snippet: "Text", section: "Abschnitt 11" }).locator).toBeUndefined();
    expect(buildSourceView({ title: "Doku", snippet: "Text", section: "Seite 4" }).locator).toBe("Seite 4");
  });

  it("omits an excerpt that adds nothing beyond the snippet", () => {
    expect(buildSourceView({ title: "Doku", snippet: "Kurzer Text", excerpt: "Kurzer Text" }).excerpt).toBeUndefined();
  });

  it("renders FAQ hits as question + answer with the question as card title", () => {
    const longQuestion = "Unterhaltsabsetzbetrag 2024 – Jahresübersicht aller Staffeln für nicht haushaltszugehörige Kinder: Wie hoch ist der Betrag?";
    const view = buildSourceView({
      title: "Betragstabelle",
      kind: "faq",
      snippet: `Q: ${longQuestion} | A: 35,00 € pro Monat für 2025-12-18.`,
      excerpt: "Q: Welche Beträge gelten?\nSimilar Questions:\n- UAB 2024?\n- Wie hoch?\nAnswers:\n- 35,00 € pro Monat für das erste Kind, weitere Details folgen hier.",
    });
    expect(view.faq?.question).toBe(longQuestion);
    expect(view.faq?.answer).toBe("35,00 € pro Monat für das erste Kind, weitere Details folgen hier.");
    expect(view.title.length).toBeLessThanOrEqual(91);
    expect(view.title.endsWith("…")).toBe(true);
    expect(view.subtitle).toBe("Betragstabelle");
    expect(view.snippet).toBeUndefined();
    expect(JSON.stringify(view)).not.toMatch(/Similar Questions|\| A:|Q:/u);
  });

  it("converts ISO dates in FAQ answers and plain snippets to German dates", () => {
    expect(buildSourceView({ title: "FAQ", kind: "faq", snippet: "Q: Wann? | A: Stand 2025-12-18." }).faq?.answer).toBe("Stand 18.12.2025.");
    expect(buildSourceView({ title: "Doku", snippet: "Fassung 2026-07-12" }).snippet).toBe("Fassung 12.07.2026");
  });
});
