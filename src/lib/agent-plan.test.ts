import { describe, expect, it } from "vitest";

import type { AgentStep } from "./agent-steps";
import { AGENT_PLAN_ITEMS, completedAgentPlanItemCount } from "./agent-plan";

describe("agent plan", () => {
  it("exposes the fixed four phases in user-facing order", () => {
    expect(AGENT_PLAN_ITEMS).toEqual([
      "Anfrage prüfen",
      "Erforderliche Quellen gezielt prüfen",
      "Rechtsstand und Fundstellen absichern",
      "Antwort erstellen",
    ]);
  });

  it("advances only from observed agent lifecycle milestones", () => {
    const steps: AgentStep[] = [
      { type: "plan", title: "Arbeitsplan", content: "internal plan payload" },
      { type: "progress", title: "Internal progress", content: "provider trace" },
      { type: "tool_call", title: "Internal call", content: "{}", toolName: "opaque_tool" },
    ];

    expect(completedAgentPlanItemCount(steps)).toBe(0);
    expect(completedAgentPlanItemCount([
      ...steps,
      { type: "tools", title: "Internal tools", content: "tool metadata" },
    ])).toBe(1);
    expect(completedAgentPlanItemCount([
      ...steps,
      { type: "tool_result", title: "Internal result", content: "result", toolName: "opaque_tool", success: true },
    ])).toBe(2);
    expect(completedAgentPlanItemCount([
      ...steps,
      { type: "citation_verification", title: "Internal verification", content: "raw verification" },
    ])).toBe(3);
  });

  it("does not finish the research phase after an unsuccessful tool result", () => {
    const steps: AgentStep[] = [
      { type: "tools", title: "Internal tools", content: "tool metadata" },
      {
        type: "tool_result",
        title: "Internal failure",
        content: "sensitive error details",
        toolName: "opaque_tool",
        success: false,
      },
    ];

    expect(completedAgentPlanItemCount(steps)).toBe(1);
  });

  it("completes every phase after the final answer", () => {
    const steps: AgentStep[] = [
      { type: "answer", title: "Internal answer", content: "raw answer" },
    ];

    expect(completedAgentPlanItemCount(steps)).toBe(4);
  });

  it("never derives plan display text from raw trace content", () => {
    const rawTrace = "RAW_TRACE_mcp__provider__secret-42";
    const steps: AgentStep[] = [
      { type: "plan", title: rawTrace, content: rawTrace },
      { type: "tool_call", title: rawTrace, content: rawTrace, toolName: rawTrace, arguments: rawTrace },
    ];

    completedAgentPlanItemCount(steps);

    expect(AGENT_PLAN_ITEMS).toHaveLength(4);
    for (const item of AGENT_PLAN_ITEMS) {
      expect(item).not.toContain(rawTrace);
    }
  });
});
