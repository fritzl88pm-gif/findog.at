export type AgentStep =
  | { type: "pdf_context"; title: string; content: string }
  | { type: "plan"; title: string; content: string }
  | { type: "tools"; title: string; content: string; tools?: string[] }
  | { type: "tool_call"; title: string; content: string; toolName: string; arguments?: unknown }
  | { type: "tool_result"; title: string; content: string; toolName: string; success: boolean }
  | { type: "progress"; title: string; content: string }
  | { type: "finalize"; title: string; content: string }
  | { type: "self_check"; title: string; content: string }
  | { type: "answer"; title: string; content: string };

export type AgentRunResult = {
  answer: string;
  steps: AgentStep[];
  tools: string[];
};

const DEFAULT_STEP_TEXT_LIMIT = 1_200;
const DEFAULT_ARGUMENT_LIMIT = 800;
const MAX_VISIBLE_TOOL_NAMES = 40;

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function summarizeStepText(value: unknown, maxLength = DEFAULT_STEP_TEXT_LIMIT): string {
  const text = stringifyUnknown(value).replace(/\r\n/g, "\n").trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength).trimEnd()}... [gekürzt]`;
}

export function summarizeToolArguments(value: unknown): string {
  return summarizeStepText(value, DEFAULT_ARGUMENT_LIMIT);
}

export function summarizeToolNames(toolNames: string[]): string {
  if (toolNames.length === 0) {
    return "Keine MCP-Werkzeuge verfügbar.";
  }

  const visibleNames = toolNames.slice(0, MAX_VISIBLE_TOOL_NAMES);
  const remaining = toolNames.length - visibleNames.length;
  return remaining > 0
    ? `${visibleNames.join(", ")} und ${remaining} weitere`
    : visibleNames.join(", ");
}
