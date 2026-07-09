import type { AgentStep } from "./agent-steps";

export const CHAT_STREAM_CONTENT_TYPE = "application/x-ndjson";

export type ChatStreamEvent =
  | { type: "step"; step: AgentStep }
  | {
      type: "final";
      answer: string;
      steps: AgentStep[];
      tools: string[];
      conversationId: string;
      model: string;
      availableModels: readonly string[];
    }
  | { type: "error"; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isAgentStep(value: unknown): value is AgentStep {
  if (!isRecord(value) || typeof value.type !== "string" || typeof value.title !== "string" || typeof value.content !== "string") {
    return false;
  }

  if (
    value.type === "pdf_context" ||
    value.type === "attachment_context" ||
    value.type === "plan" ||
    value.type === "progress" ||
    value.type === "finalize" ||
    value.type === "citation_verification" ||
    value.type === "self_check" ||
    value.type === "answer"
  ) {
    return true;
  }
  if (value.type === "tools") {
    return value.tools === undefined || (Array.isArray(value.tools) && value.tools.every((tool) => typeof tool === "string"));
  }
  if (value.type === "tool_call") {
    return typeof value.toolName === "string";
  }
  if (value.type === "tool_result") {
    return typeof value.toolName === "string" && typeof value.success === "boolean";
  }

  return false;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    throw new Error("Ungültiges Streaming-Ereignis.");
  }
}

export function encodeChatStreamEvent(event: ChatStreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export function parseChatStreamLine(line: string): ChatStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = parseJsonLine(trimmed);
  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    throw new Error("Ungültiges Streaming-Ereignis.");
  }

  if (parsed.type === "step") {
    if (!isAgentStep(parsed.step)) {
      throw new Error("Ungültiges Streaming-Ereignis.");
    }
    return { type: "step", step: parsed.step };
  }

  if (parsed.type === "final") {
    if (
      typeof parsed.answer !== "string" ||
      !Array.isArray(parsed.steps) ||
      !parsed.steps.every(isAgentStep) ||
      !isStringArray(parsed.tools) ||
      typeof parsed.conversationId !== "string" ||
      typeof parsed.model !== "string" ||
      !isStringArray(parsed.availableModels)
    ) {
      throw new Error("Ungültiges Streaming-Ereignis.");
    }
    return {
      type: "final",
      answer: parsed.answer,
      steps: parsed.steps,
      tools: parsed.tools,
      conversationId: parsed.conversationId,
      model: parsed.model,
      availableModels: parsed.availableModels,
    };
  }

  if (parsed.type === "error") {
    if (typeof parsed.error !== "string") {
      throw new Error("Ungültiges Streaming-Ereignis.");
    }
    return { type: "error", error: parsed.error };
  }

  throw new Error("Unbekanntes Streaming-Ereignis.");
}
