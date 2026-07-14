import type { AgentStep } from "./agent-steps";

export const AGENT_PLAN_ITEMS = [
  "Anfrage prüfen",
  "Erforderliche Quellen gezielt prüfen",
  "Rechtsstand und Fundstellen absichern",
  "Antwort erstellen",
] as const;

export function completedAgentPlanItemCount(steps: AgentStep[]): number {
  let completedCount = 0;

  for (const step of steps) {
    if (step.type === "answer") {
      return AGENT_PLAN_ITEMS.length;
    }
    if (step.type === "citation_verification") {
      completedCount = Math.max(completedCount, 3);
    } else if (step.type === "tool_result" && step.success) {
      completedCount = Math.max(completedCount, 2);
    } else if (step.type === "tools") {
      completedCount = Math.max(completedCount, 1);
    }
  }

  return completedCount;
}
