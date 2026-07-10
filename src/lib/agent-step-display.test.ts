import { describe, expect, it } from "vitest";

import type { AgentStep } from "./agent-steps";
import { agentStepDisplayLabel } from "./agent-step-display";

describe("agentStepDisplayLabel", () => {
  it("maps database searches to simple German wording", () => {
    const step: AgentStep = {
      type: "tool_call",
      title: "Internal MCP call",
      content: '{"query":"Pendlerpauschale","kb_id":"fred"}',
      toolName: "hybrid_search",
      arguments: { query: "Pendlerpauschale", kb_id: "fred" },
    };

    expect(agentStepDisplayLabel(step)).toBe("Datenbank wird durchsucht");
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
    [{ type: "attachment_context", title: "Bild-Kontext", content: "raw" }, "Anhang wird gelesen"],
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

    expect(label).toBe("Recherche läuft");
    expect(label.length).toBeLessThanOrEqual(30);
  });
});
