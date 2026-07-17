import { describe, expect, it } from "vitest";

import type { AgentStep } from "./agent-steps";
import { createLlmProgressStepTitle } from "./agent-progress-status";
import { agentStepDisplayLabel } from "./agent-step-display";
import {
  RESEARCH_SOURCE_NAMES,
  researchSourceCallTitle,
  researchSourceResultTitle,
} from "./research-source-display";

describe("agentStepDisplayLabel", () => {
  it("maps database searches to simple German wording", () => {
    const step: AgentStep = {
      type: "tool_call",
      title: "Internal MCP call",
      content: '{"query":"Pendlerpauschale","kb_id":"fred"}',
      toolName: "hybrid_search",
      arguments: { query: "Pendlerpauschale", kb_id: "fred" },
    };

    expect(agentStepDisplayLabel(step)).toBe("Rechtsquelle wird durchsucht");
  });

  it("shows the concrete source name for calls, results, and failures", () => {
    const sourceName = RESEARCH_SOURCE_NAMES.GESETZE;
    const callStep: AgentStep = {
      type: "tool_call",
      title: researchSourceCallTitle(sourceName),
      content: "interne Argumente",
      toolName: "search_laws",
    };
    const resultStep: AgentStep = {
      type: "tool_result",
      title: researchSourceResultTitle(sourceName, true),
      content: "interne Treffer",
      toolName: "search_laws",
      success: true,
    };
    const failedStep: AgentStep = {
      type: "tool_result",
      title: researchSourceResultTitle(sourceName, false),
      content: "interner Fehler",
      toolName: "search_laws",
      success: false,
    };

    expect(agentStepDisplayLabel(callStep)).toBe("Suche in „Gesetze und Verordnungen“");
    expect(agentStepDisplayLabel(resultStep)).toBe(
      "Treffer aus „Gesetze und Verordnungen“ werden ausgewertet",
    );
    expect(agentStepDisplayLabel(failedStep)).toBe(
      "Abfrage von „Gesetze und Verordnungen“ fehlgeschlagen",
    );
  });

  it("maps policy and citation verification to user-facing wording", () => {
    const policyStep: AgentStep = {
      type: "tool_call",
      title: "Policy lookup",
      content: "provider trace",
      toolName: "policy_search",
    };
    const citationStep: AgentStep = {
      type: "citation_verification",
      title: "Findok verification",
      content: "1 verified, 0 rejected",
    };

    expect(agentStepDisplayLabel(policyStep)).toBe("Richtlinien werden durchsucht");
    expect(agentStepDisplayLabel(citationStep)).toBe("Fundstellen werden geprüft");
  });

  it.each([
    [{ type: "plan", title: "raw", content: "raw" }, "Plan wird erstellt"],
    [{ type: "finalize", title: "raw", content: "raw" }, "Antwort wird vorbereitet"],
    [{ type: "answer", title: "raw", content: "raw" }, "Antwort wird erstellt"],
    [{ type: "pdf_context", title: "raw", content: "raw" }, "PDF wird gelesen"],
    [{ type: "pdf_offer", title: "raw", content: "raw" }, "PDF-Download wird vorbereitet"],
    [{ type: "attachment_context", title: "Bild-Kontext", content: "raw" }, "Anhang wird gelesen"],
    [{ type: "progress", title: "raw", content: "raw" }, "Rechercheergebnisse werden ausgewertet"],
  ] as const)("maps %s to %s", (step, expected) => {
    expect(agentStepDisplayLabel(step as AgentStep)).toBe(expected);
  });

  it("never returns raw trace content, arguments, or internal tool identifiers", () => {
    const rawValues = [
      "RAW_TITLE_deepseek-v4-pro",
      "RAW_CONTENT_2026-07-10T12:00:00Z",
      "RAW_ARGUMENT_secret-id-42",
      "mcp__provider__opaque_tool_id",
    ];
    const step: AgentStep = {
      type: "tool_call",
      title: rawValues[0],
      content: `{"trace":"${rawValues[1]}"}`,
      toolName: rawValues[3],
      arguments: { secret: rawValues[2] },
    };

    const label = agentStepDisplayLabel(step);

    for (const rawValue of rawValues) {
      expect(label).not.toContain(rawValue);
    }
  });

  it("uses a short, neutral fallback for unknown runtime step types", () => {
    const unknownStep = {
      type: "provider_internal_event",
      title: "Provider error with identifier abc-123",
      content: '{"error":"sensitive trace"}',
    } as unknown as AgentStep;

    const label = agentStepDisplayLabel(unknownStep);

    expect(label).toBe("Anfrage wird verarbeitet");
    expect(label.length).toBeLessThanOrEqual(30);
  });

  it("shows a validated model-generated activity for progress steps", () => {
    const title = createLlmProgressStepTitle("STATUS: Werte BFG-Urteile aus.");
    expect(title).toBeDefined();

    const step: AgentStep = {
      type: "progress",
      title: title!,
      content: "interner Fortschritt",
    };

    expect(agentStepDisplayLabel(step)).toBe("Werte BFG-Urteile aus.");
  });

  it("does not trust a source name embedded in an arbitrary title", () => {
    const step: AgentStep = {
      type: "tool_call",
      title: "Gesetze und Verordnungen: secret-id-42",
      content: "raw",
      toolName: "unknown_tool",
    };

    expect(agentStepDisplayLabel(step)).toBe("Recherchequelle wird abgefragt");
  });
});
