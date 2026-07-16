import type { AgentStep } from "./agent-steps";
import { readLlmProgressStepTitle } from "./agent-progress-status";
import { safeResearchSourceStepTitle } from "./research-source-display";

function toolStepDisplayLabel(step: Extract<AgentStep, { type: "tool_call" | "tool_result" }>): string {
  const sourceStepTitle = safeResearchSourceStepTitle(step.title);
  if (sourceStepTitle) {
    return sourceStepTitle;
  }

  const category = `${step.toolName} ${step.title}`.toLowerCase();

  if (/list_research_sources|list_knowledge_bases/.test(category)) {
    return "Verfügbare Quellen werden ermittelt";
  }
  if (/findok|citation|fundstell|verif/.test(category)) {
    return "Fundstellen werden geprüft";
  }
  if (/policy|policies|richtlin|regelwerk/.test(category)) {
    return "Richtlinien werden durchsucht";
  }
  if (/hybrid[_ -]?search|datenbank|database/.test(category)) {
    return "Rechtsquelle wird durchsucht";
  }

  if (step.type === "tool_result") {
    return step.success
      ? "Rechercheergebnis wird ausgewertet"
      : "Recherchequelle nicht erreichbar";
  }

  return "Recherchequelle wird abgefragt";
}

export function agentStepDisplayLabel(step: AgentStep): string {
  switch (step.type) {
    case "pdf_context":
      return "PDF wird gelesen";
    case "attachment_context":
      return /pdf/i.test(step.title) ? "PDF wird gelesen" : "Anhang wird gelesen";
    case "plan":
      return "Plan wird erstellt";
    case "tools":
      return "Recherchequellen werden vorbereitet";
    case "tool_call":
    case "tool_result":
      return toolStepDisplayLabel(step);
    case "progress":
      return readLlmProgressStepTitle(step.title)
        ?? "Rechercheergebnisse werden ausgewertet";
    case "finalize":
      return "Antwort wird vorbereitet";
    case "citation_verification":
      return "Fundstellen werden geprüft";
    case "self_check":
      return "Antwort wird geprüft";
    case "answer":
      return "Antwort wird erstellt";
    default:
      return "Anfrage wird verarbeitet";
  }
}
