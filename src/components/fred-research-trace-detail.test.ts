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
