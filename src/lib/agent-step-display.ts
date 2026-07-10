import type { AgentStep } from "./agent-steps";

function toolStepDisplayLabel(step: Extract<AgentStep, { type: "tool_call" | "tool_result" }>): string {
  const category = `${step.toolName} ${step.title}`.toLowerCase();

  if (/findok|citation|fundstell|verif/.test(category)) {
    return "Fundstellen werden geprüft";
  }
  if (/policy|policies|richtlin|regelwerk/.test(category)) {
    return "Richtlinien werden durchsucht";
  }
  if (/hybrid[_ -]?search|datenbank|database/.test(category)) {
    return "Datenbank wird durchsucht";
  }

  return "Recherche wird durchgeführt";
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
      return "Recherche wird vorbereitet";
    case "tool_call":
    case "tool_result":
      return toolStepDisplayLabel(step);
    case "progress":
      return "Recherche läuft";
    case "finalize":
      return "Antwort wird vorbereitet";
    case "citation_verification":
      return "Fundstellen werden geprüft";
    case "self_check":
      return "Antwort wird geprüft";
    case "answer":
      return "Antwort wird erstellt";
    default:
      return "Recherche läuft";
  }
}
