import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ResearchTrace, resolveResearchTraceDisplay } from "./fred-native-chat-view";
import type { FredExecutionStep } from "@/lib/fred/execution-trace";
import type { FredSourceReference } from "@/lib/weknora/fred-research";

const uuid = "6f9619ff-8b86-d011-b42d-00c04fc964ff";

const render = (
  executionSteps: FredExecutionStep[],
  displayMode: "simple" | "advanced" = "advanced",
  sources: FredSourceReference[] = [],
  active = false,
) =>
  renderToStaticMarkup(
    React.createElement(ResearchTrace, {
      steps: [{ id: "r1", kind: "sources", status: "completed", label: "Einfache Ansicht" }],
      sources,
      active,
      agentName: "Fred",
      executionSteps,
      displayMode,
    }),
  );

const knowledgeStep = (overrides: Partial<FredExecutionStep> = {}): FredExecutionStep => ({
  id: "knowledge:1",
  kind: "knowledge",
  status: "completed",
  label: "Wissensbasis durchsucht",
  toolName: "search_knowledge",
  queries: ["Pendlerpauschale Voraussetzungen"],
  durationMs: 1_200,
  sources: [
    {
      title: "EStG_1988_Einkommensteuergesetz_1988_RIS_Fassung_2026-07-12_verified.md",
      kind: "law",
      snippet: "Das Pendlerpauschale steht zu, wenn die Voraussetzungen erfüllt sind.",
      excerpt: "Langer Volltext des Paragrafen mit allen Absätzen ".repeat(5),
      score: 0.87,
      matchType: "vector",
    },
    {
      title: "Pendler-FAQ",
      kind: "faq",
      snippet: "Q: Wann steht der Pendlereuro zu? | A: Bei Anspruch auf das Pendlerpauschale.",
      score: 0.5,
    },
  ],
  ...overrides,
});

describe("ResearchTrace advanced: display state", () => {
  it("resolves display state correctly for advanced mode", () => {
    const displayState = resolveResearchTraceDisplay({
      executionSteps: [{ id: "step-1", kind: "analysis", status: "completed", label: "Anfrage analysiert" }],
      displayMode: "advanced",
      active: false,
    });
    expect(displayState).toMatchObject({ shouldRender: true, isAdvanced: true, summary: "Ausführungsverlauf · 1 Schritte" });
  });

  it("keeps execution-only data invisible in simple mode", () => {
    const html = render([knowledgeStep()], "simple");
    expect(html).not.toContain("fred-exec");
    expect(html).not.toContain("Volltext-Ausschnitt");
    expect(html).not.toContain("Pendlerpauschale Voraussetzungen");
  });
});

describe("ResearchTrace advanced: timeline", () => {
  it("renders an overview chip row, per-kind icons (aria-hidden) and a timeline", () => {
    const html = render([
      { id: "analysis:phase", kind: "analysis", status: "completed", label: "Anfrage analysiert" },
      knowledgeStep(),
      { id: "tool:1", kind: "tool", status: "completed", label: "Sandbox-Befehl ausgeführt", toolName: "shell_exec", durationMs: 800, command: "ls", output: "a.txt" },
    ]);
    expect(html).toContain('class="fred-exec-overview"');
    expect(html).toContain("<strong>3</strong> Schritte");
    expect(html).toContain("<strong>2</strong> Werkzeuge");
    expect(html).toContain("<strong>2</strong> Quellen");
    expect(html).toContain("Gesamtdauer");
    expect(html).toMatch(/<ol class="fred-exec-timeline">/u);
    expect(html).toContain("icon-analysis");
    expect(html).toContain("icon-search");
    expect(html).toContain("icon-shell");
    // every inline icon is decorative
    const svgs = html.match(/<svg\b[^>]*>/gu) ?? [];
    expect(svgs.length).toBeGreaterThan(3);
    expect(svgs.every((svg) => svg.includes('aria-hidden="true"'))).toBe(true);
  });

  it("marks running steps (open, pulsing marker) and failed steps with a short German error", () => {
    const html = render([
      knowledgeStep({ status: "running", label: "Wissensbasis wird durchsucht" }),
      { id: "tool:2", kind: "tool", status: "failed", label: "Recherchewerkzeug fehlgeschlagen", error: "Zeitüberschreitung" },
    ], "advanced", [], true);
    expect(html).toContain("is-running");
    expect(html).toMatch(/<details class="fred-exec-fold" open=""/u);
    expect(html).toContain("is-failed");
    expect(html).toContain('<p class="fred-exec-error" role="status">Zeitüberschreitung</p>');
    expect(html).toContain("fred-exec-spinner");
  });

  it("renders query chips and keeps source cards in a collapsed fold when completed", () => {
    const html = render([knowledgeStep()]);
    expect(html).toContain('<span class="fred-exec-chip">Pendlerpauschale Voraussetzungen</span>');
    expect(html).toMatch(/<details class="fred-exec-fold"><summary class="fred-exec-head">/u);
    expect(html).not.toMatch(/<details class="fred-exec-fold" open/u);
  });

  it("nests helper agents below their parent step in arrival order and keeps orphans at top level", () => {
    const html = render([
      { id: "tool:spawn", kind: "tool", status: "completed", label: "Hilfs-Agent gestartet", toolName: "spawn_agent", facts: [{ label: "Aufgabe", value: "Recherche BFG" }] },
      { id: "agent:a", kind: "agent", status: "running", label: "Hilfs-Agent A: Läuft", parentId: "tool:spawn", taskName: "Recherche BFG" },
      { id: "agent:b", kind: "agent", status: "completed", label: "Hilfs-Agent B: Fertig", parentId: "tool:spawn" },
      { id: "agent:orphan", kind: "agent", status: "running", label: "Hilfs-Agent Waise: Läuft", parentId: "tool:missing" },
    ]);
    const spawnAt = html.indexOf("Hilfs-Agent gestartet");
    const childList = html.indexOf('<ol class="fred-exec-timeline fred-exec-children">');
    expect(childList).toBeGreaterThan(spawnAt);
    expect(html.indexOf("Hilfs-Agent A")).toBeGreaterThan(childList);
    expect(html.indexOf("Hilfs-Agent B")).toBeGreaterThan(html.indexOf("Hilfs-Agent A"));
    const childListEnd = html.indexOf("</ol>", childList);
    expect(html.indexOf("Hilfs-Agent Waise")).toBeGreaterThan(childListEnd);
    expect(html.match(/fred-exec-children/gu)).toHaveLength(1);
    expect(html).toContain("Aufgabe: Recherche BFG");
  });

  it("renders shell steps as a terminal block with the command and output, open while running", () => {
    const step: FredExecutionStep = {
      id: "tool:3", kind: "tool", status: "running", label: "Sandbox-Befehl wird ausgeführt", toolName: "shell_exec",
      command: "ls -la", output: "total 0\nfile.txt",
    };
    const running = render([step], "advanced", [], true);
    expect(running).toContain('class="fred-exec-terminal"');
    expect(running).toContain('<span class="fred-exec-prompt">$ ls -la\n</span>total 0\nfile.txt');
    expect(running).toMatch(/<details class="fred-exec-fold" open=""/u);
    const finished = render([{ ...step, status: "completed", label: "Sandbox-Befehl ausgeführt" }]);
    expect(finished).not.toMatch(/<details class="fred-exec-fold" open/u);
  });

  it("renders planning as a checklist, memory and compaction as one compact line", () => {
    const html = render([
      {
        id: "planning:1", kind: "planning", status: "completed", label: "Rechercheplan aktualisiert",
        detail: "2 Aufgaben geplant · 1 abgeschlossen\n- [x] Gesetz lesen\n- [ ] Richtlinie prüfen",
      },
      { id: "memory:1", kind: "memory", status: "completed", label: "2 Erinnerungen abgerufen" },
      { id: "context:1", kind: "context", status: "completed", label: "Gesprächsverlauf komprimiert (12.000 → 3.000 Tokens)" },
    ]);
    expect(html).toContain('class="fred-exec-checklist"');
    expect(html).toContain('<li class="is-done">');
    expect(html).toContain("Richtlinie prüfen");
    expect(html).toContain("2 Erinnerungen abgerufen");
    expect(html).toContain("Gesprächsverlauf komprimiert (12.000 → 3.000 Tokens)");
    expect(html).not.toContain("- [x]");
  });

  it("shows unknown tools with a key/value list and a short summary, never raw JSON", () => {
    const html = render([{
      id: "tool:9", kind: "tool", status: "completed", label: "Recherchewerkzeug ausgeführt", toolName: "calculate_tax",
      facts: [{ label: "Jahr", value: "2025" }, { label: "Kategorie", value: "pendler" }],
      detail: "Berechnung abgeschlossen. Ergebnis liegt vor und wurde in der Antwort verwendet, Details siehe unten.",
    }]);
    expect(html).toContain("<dt>Jahr</dt><dd>2025</dd>");
    expect(html).toContain("Berechnung abgeschlossen");
    expect(html).not.toMatch(/[{]&quot;|\{"/u);
    expect(html).not.toContain("calculate_tax");
  });
});

describe("ResearchTrace advanced: source cards", () => {
  it("renders prettified title, badge, relevance bar, highlighted snippet and an expandable full excerpt", () => {
    const html = render([knowledgeStep()]);
    expect(html).toContain("EStG 1988 · Einkommensteuergesetz 1988 · RIS-Fassung 12.07.2026");
    expect(html).not.toContain("_verified");
    expect(html).toContain('<span class="fred-source-badge kind-law">Gesetz</span>');
    expect(html).toContain('<span class="fred-source-badge kind-faq">FAQ</span>');
    expect(html).toContain('role="img" aria-label="Relevanz 87 Prozent"');
    expect(html).toContain('style="width:87%"');
    expect(html).toContain('<mark class="fred-source-hit">Pendlerpauschale</mark>');
    expect(html).toContain("Volltext-Ausschnitt anzeigen");
    expect(html).toContain("Volltext-Ausschnitt ausblenden");
    expect(html).toContain("Langer Volltext des Paragrafen");
  });

  it("renders FAQ rows as question and answer", () => {
    const html = render([knowledgeStep()]);
    expect(html).toContain('<h4 class="fred-source-card-title">Wann steht der Pendlereuro zu?</h4>');
    expect(html).toContain('<p class="fred-source-faq-answer">Bei Anspruch auf das <mark class="fred-source-hit">Pendlerpauschale</mark>.</p>');
    // the question doubles as card title, the knowledge-base title becomes secondary text
    expect(html).toContain('<h4 class="fred-source-card-title">Wann steht der Pendlereuro zu?</h4>');
    expect(html).toContain('<p class="fred-source-subtitle">Pendler-FAQ</p>');
    expect(html).not.toContain("Q: Wann");
    expect(html).not.toContain("| A:");
  });

  it("renders web results with safe links", () => {
    const html = render([{
      id: "web:1", kind: "web", status: "completed", label: "Websuche durchgeführt", toolName: "web_search", queries: ["Pendlerrechner"],
      sources: [{ title: "BMF Pendlerrechner", kind: "web", url: "https://pendlerrechner.bmf.gv.at/", snippet: "Berechnen Sie Ihre Pauschale." }],
    }]);
    expect(html).toContain('href="https://pendlerrechner.bmf.gv.at/" target="_blank" rel="noreferrer"');
    expect(html).toContain("pendlerrechner.bmf.gv.at");
    expect(html).toContain('<span class="fred-source-badge kind-web">Web</span>');
  });

  it("builds an aggregated, deduplicated Quellen section that replaces 'Gefundene Quellen'", () => {
    const first = knowledgeStep();
    const second = knowledgeStep({ id: "knowledge:2", queries: ["Pendlereuro"] });
    const references: FredSourceReference[] = [
      { kind: "knowledge", doc: "Pendler-FAQ", knowledgeBaseId: uuid, chunkId: uuid },
      { kind: "web", url: "https://ris.bka.gv.at/Dokument.wxe?id=123", title: "RIS Judikatur" },
    ];
    const html = render([first, second], "advanced", references);
    expect(html).toContain('<h3 id=');
    expect(html).toContain(">Quellen</h3>");
    expect(html).not.toContain("Gefundene Quellen");
    // the same two hits exist in both steps and once in the aggregate: 2 step lists + aggregate = 3 occurrences
    expect(html.match(/Einkommensteuergesetz 1988 · RIS-Fassung/gu)).toHaveLength(3);
    // references already covered by a hit are not repeated; new ones are appended
    expect(html.match(/Pendler-FAQ/gu)).toHaveLength(3);
    expect(html).toContain("RIS Judikatur");
    expect(html).toContain("<strong>3</strong> Quellen");
    // no internal ids
    expect(html).not.toContain(uuid);
    expect(html).not.toContain("6f9619ff");
  });

  it("never shows KB or chunk ids in the advanced fallback source list", () => {
    const references: FredSourceReference[] = [{ kind: "knowledge", doc: "EStG Richtlinien 2024", knowledgeBaseId: "12345678-aaaa-bbbb-cccc-dddddddddddd", chunkId: "87654321-zzzz-yyyy-xxxx-wwwwwwwwwwww" }];
    const advancedWithoutSteps = renderToStaticMarkup(
      React.createElement(ResearchTrace, {
        steps: [{ id: "s1", kind: "sources", status: "completed", label: "1 Quelle gefunden" }],
        sources: references,
        active: false,
        agentName: "Fred",
        displayMode: "advanced",
      }),
    );
    expect(advancedWithoutSteps).toContain("EStG Richtlinien 2024");
    expect(advancedWithoutSteps).not.toContain("KB 12345678");
    expect(advancedWithoutSteps).not.toContain("Chunk");
    expect(advancedWithoutSteps).not.toContain("87654321");
    expect(advancedWithoutSteps).not.toContain("12345678-aaaa");
  });
});

describe("ResearchTrace advanced: thinking and legacy data never render", () => {
  const secret = "Ich überlege geheim, ob das Pendlerpauschale zusteht";

  it("does not render reasoning text of legacy analysis / evaluation steps", () => {
    const html = render([
      { id: "analysis:1", kind: "analysis", status: "completed", label: "Anfrage analysiert", detail: secret },
      { id: "evaluation:1", kind: "evaluation", status: "completed", label: "Rechercheergebnisse bewertet", detail: secret },
      { id: "tool:thinking", kind: "analysis", status: "completed", label: "Anfrage analysiert (1/2)", toolName: "thinking", detail: secret },
    ]);
    expect(html).not.toContain("geheim");
    expect(html).toContain("Anfrage analysiert");
    // coalesced into one marker
    expect(html.match(/fred-exec-step /gu)?.length).toBeLessThanOrEqual(2);
  });

  it("renders legacy steps with raw arguments/result strings without dumping JSON or ids", () => {
    const rows = [{ result_index: 1, content: "Volltext des Treffers", knowledge_id: uuid, knowledge_base_id: uuid, knowledge_title: "LStR_2002_idF_2025-12-18_full_verified.md", match_snippet: "Pendlerpauschale Rz 250", score: 0.9, source_query: "Pendlerpauschale" }];
    const html = render([{
      id: "knowledge:legacy", kind: "knowledge", status: "completed", label: "Wissensbasis durchsucht", toolName: "search_knowledge",
      callId: "raw-upstream-call", detail: "Suche: Pendlerpauschale",
      arguments: JSON.stringify({ queries: ["Pendlerpauschale"], knowledge_base_ids: [uuid] }, null, 2),
      result: JSON.stringify({ results: rows, display_type: "search_results" }, null, 2),
    }, {
      id: "tool:legacy2", kind: "tool", status: "completed", label: "Recherchewerkzeug ausgeführt", toolName: "custom_tool",
      arguments: '{\n  "limit": 5,\n  "api_key": "sk-secret-value-1234"\n}',
      result: '{\n  "alpha": {\n    "beta": [1, 2, 3],\n    "gamma": "cut',
    }]);
    expect(html).toContain("LStR 2002 · idF 18.12.2025");
    expect(html).toContain('<span class="fred-source-badge kind-guideline">Richtlinie</span>');
    expect(html).toContain("Pendlerpauschale");
    expect(html).toContain("<dt>Limit</dt><dd>5</dd>");
    for (const leaked of [uuid, "raw-upstream-call", "sk-secret", "alpha", "result_index", "knowledge_base_ids", "display_type", "&quot;"]) {
      expect(html).not.toContain(leaked);
    }
    expect(html).not.toContain("<pre");
  });

  it("masks internal ids, hosts and model names that reach the renderer", () => {
    const html = render([{
      id: "tool:x", kind: "tool", status: "completed", label: `Schritt ${uuid}`, detail: "Antwort von app:8080 mit gpt-4o-mini aus /var/lib/weknora/x.md ist da und lang genug für den Text",
    }]);
    for (const leaked of [uuid, "app:8080", "gpt-4o", "/var/lib"]) expect(html).not.toContain(leaked);
  });
});
