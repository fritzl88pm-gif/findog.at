import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ResearchTrace, resolveResearchTraceDisplay } from "./fred-native-chat-view";
import type { FredExecutionStep } from "@/lib/fred/execution-trace";
import type { FredSourceReference } from "@/lib/weknora/fred-research";

describe("ResearchTrace advanced collapsible detail and sources display", () => {
  it("resolves display state correctly for advanced mode", () => {
    const displayState = resolveResearchTraceDisplay({
      executionSteps: [
        {
          id: "step-1",
          kind: "analysis",
          status: "completed",
          label: "Anfrage analysiert",
        },
      ],
      displayMode: "advanced",
      active: false,
    });

    expect(displayState.shouldRender).toBe(true);
    expect(displayState.isAdvanced).toBe(true);
    expect(displayState.summary).toBe("Ausführungsverlauf · 1 Schritte");
  });

  it("Task 6: renders collapsible <details> with summary 'Details' for detail > 400 chars (collapsed by default when completed)", () => {
    const longDetail = "A".repeat(500);
    const executionSteps: FredExecutionStep[] = [
      {
        id: "step-long",
        kind: "tool",
        status: "completed",
        label: "Recherchewerkzeug ausgeführt",
        detail: longDetail,
      },
    ];

    const html = renderToStaticMarkup(
      React.createElement(ResearchTrace, {
        steps: [],
        sources: [],
        active: false,
        agentName: "Fred",
        executionSteps,
        displayMode: "advanced",
      }),
    );

    expect(html).toContain('class="fred-execution-detail-fold"');
    expect(html).toContain("<summary>Details</summary>");
    expect(html).toContain(longDetail);
    expect(html).not.toMatch(/<details\s+class="fred-execution-detail-fold"\s+open/);
  });

  it("Task 6: auto-opens collapsible <details> when step.status === 'running'", () => {
    const longDetail = "B".repeat(500);
    const executionSteps: FredExecutionStep[] = [
      {
        id: "step-running-long",
        kind: "analysis",
        status: "running",
        label: "Anfrage wird analysiert",
        detail: longDetail,
      },
    ];

    const html = renderToStaticMarkup(
      React.createElement(ResearchTrace, {
        steps: [],
        sources: [],
        active: true,
        agentName: "Fred",
        executionSteps,
        displayMode: "advanced",
      }),
    );

    expect(html).toContain('class="fred-execution-detail-fold"');
    expect(html).toMatch(/<details\s+class="fred-execution-detail-fold"\s+open/);
    expect(html).toContain("<summary>Details</summary>");
  });

  it("Task 6: renders short detail (<= 400 chars) inline without <details> fold", () => {
    const shortDetail = "Kurzer Detailtext zu den Parametern.";
    const executionSteps: FredExecutionStep[] = [
      {
        id: "step-short",
        kind: "tool",
        status: "completed",
        label: "Recherchewerkzeug ausgeführt",
        detail: shortDetail,
      },
    ];

    const html = renderToStaticMarkup(
      React.createElement(ResearchTrace, {
        steps: [],
        sources: [],
        active: false,
        agentName: "Fred",
        executionSteps,
        displayMode: "advanced",
      }),
    );

    expect(html).toContain('class="fred-execution-detail"');
    expect(html).toContain(shortDetail);
    expect(html).not.toContain("fred-execution-detail-fold");
    expect(html).not.toContain("<summary>Details</summary>");
  });

  it("Task 7: renders KB/chunk identity under doc name in Advanced mode", () => {
    const sources: FredSourceReference[] = [
      {
        kind: "knowledge",
        doc: "EStG Richtlinien 2024",
        knowledgeBaseId: "12345678-aaaa-bbbb-cccc-dddddddddddd",
        chunkId: "87654321-zzzz-yyyy-xxxx-wwwwwwwwwwww",
      },
      {
        kind: "web",
        url: "https://ris.bka.gv.at/Dokument.wxe?id=123",
        title: "RIS Judikatur",
      },
    ];

    const executionSteps: FredExecutionStep[] = [
      {
        id: "step-1",
        kind: "sources",
        status: "completed",
        label: "2 Quellen gefunden",
      },
    ];

    const htmlAdvanced = renderToStaticMarkup(
      React.createElement(ResearchTrace, {
        steps: [],
        sources,
        active: false,
        agentName: "Fred",
        executionSteps,
        displayMode: "advanced",
      }),
    );

    expect(htmlAdvanced).toContain("EStG Richtlinien 2024");
    expect(htmlAdvanced).toContain("KB 12345678 · Chunk 87654321");

    const htmlSimple = renderToStaticMarkup(
      React.createElement(ResearchTrace, {
        steps: [
          {
            id: "s1",
            kind: "sources",
            status: "completed",
            label: "2 Quellen gefunden",
          },
        ],
        sources,
        active: false,
        agentName: "Fred",
        displayMode: "simple",
      }),
    );

    expect(htmlSimple).toContain("EStG Richtlinien 2024");
    expect(htmlSimple).not.toContain("KB 12345678 · Chunk 87654321");
  });
});

describe("ResearchTrace advanced: full execution payloads", () => {
  const render = (executionSteps: FredExecutionStep[], displayMode: "simple" | "advanced" = "advanced") =>
    renderToStaticMarkup(
      React.createElement(ResearchTrace, {
        steps: [{ id: "r1", kind: "sources", status: "completed", label: "Einfache Ansicht" }],
        sources: [],
        active: false,
        agentName: "Fred",
        executionSteps,
        displayMode,
      }),
    );

  it("renders Parameter and Ergebnis as collapsed <details> with wrapping <pre>", () => {
    const html = render([{
      id: "tool:1",
      kind: "tool",
      status: "completed",
      label: "Recherchewerkzeug ausgeführt",
      arguments: '{\n  "query": "Pendlerpauschale"\n}',
      result: "Ergebnis <b>roh</b>",
    }]);

    expect(html).toMatch(/<details class="fred-execution-payload-fold"><summary>Parameter<\/summary><pre class="fred-execution-payload">/);
    expect(html).toContain("&quot;query&quot;: &quot;Pendlerpauschale&quot;");
    expect(html).toMatch(/<summary>Ergebnis<\/summary><pre class="fred-execution-payload">Ergebnis &lt;b&gt;roh&lt;\/b&gt;<\/pre>/);
    expect(html).not.toMatch(/<details class="fred-execution-payload-fold" open/);
  });

  it("renders command output in a terminal <pre>, open while running and collapsed when finished", () => {
    const base: FredExecutionStep = {
      id: "tool:2",
      kind: "tool",
      status: "running",
      label: "Befehl wird ausgeführt",
      command: "ls -la",
      output: "total 0\nfile.txt",
    };
    const running = render([base]);
    expect(running).toContain('<code class="fred-execution-command">ls -la</code>');
    expect(running).toMatch(/<details class="fred-execution-payload-fold" open=""><summary>Ausgabe<\/summary><pre class="fred-execution-terminal">total 0\nfile.txt<\/pre>/);

    const finished = render([{ ...base, status: "completed", label: "Recherchewerkzeug ausgeführt" }]);
    expect(finished).toMatch(/<details class="fred-execution-payload-fold"><summary>Ausgabe<\/summary><pre class="fred-execution-terminal">/);
    expect(finished).not.toContain('open=""><summary>Ausgabe');
  });

  it("nests steps below their parent in arrival order and keeps orphans at top level", () => {
    const html = render([
      { id: "tool:spawn", kind: "tool", status: "completed", label: "Spawn-Schritt" },
      { id: "agent:a", kind: "agent", status: "running", label: "Hilfs-Agent A: Läuft", parentId: "tool:spawn" },
      { id: "agent:b", kind: "agent", status: "completed", label: "Hilfs-Agent B: Fertig", parentId: "tool:spawn" },
      { id: "agent:orphan", kind: "agent", status: "running", label: "Hilfs-Agent Waise: Läuft", parentId: "tool:missing" },
    ]);

    const spawnAt = html.indexOf("Spawn-Schritt");
    const childList = html.indexOf('<ol class="fred-execution-steps fred-execution-children">');
    expect(childList).toBeGreaterThan(spawnAt);
    expect(html.indexOf("Hilfs-Agent A")).toBeGreaterThan(childList);
    expect(html.indexOf("Hilfs-Agent B")).toBeGreaterThan(html.indexOf("Hilfs-Agent A"));
    // the orphan is rendered after the nested list closed, not inside it
    const childListEnd = html.indexOf("</ol>", childList);
    expect(html.indexOf("Hilfs-Agent Waise")).toBeGreaterThan(childListEnd);
    expect(html.match(/fred-execution-children/g)).toHaveLength(1);
  });

  it("does not render execution payloads in the simple view", () => {
    const html = render([{
      id: "tool:3",
      kind: "tool",
      status: "completed",
      label: "Recherchewerkzeug ausgeführt",
      arguments: "geheimer-parameter",
      result: "geheimes-ergebnis",
    }], "simple");
    expect(html).not.toContain("geheimer-parameter");
    expect(html).not.toContain("geheimes-ergebnis");
  });
});
