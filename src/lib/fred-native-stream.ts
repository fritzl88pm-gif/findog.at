import {
  isFredAgentKey,
  type FredAgentKey,
} from "./weknora/fred-agent";
import {
  parseStoredFredResearchTrace,
  parseStoredFredSources,
  type FredResearchStep,
  type FredSourceReference,
} from "./weknora/fred-research";

export const FRED_NATIVE_STREAM_CONTENT_TYPE = "application/x-ndjson";

export type FredNativeConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  agentKey: FredAgentKey;
};

export type FredNativeStreamEvent =
  | { type: "conversation"; conversation: FredNativeConversation }
  | { type: "delta"; content: string }
  | { type: "replace"; answer: string }
  | { type: "research"; step: FredResearchStep }
  | { type: "status"; label: string }
  | {
    type: "final";
    answer: string;
    conversation: FredNativeConversation;
    researchTrace?: FredResearchStep[];
    sourceReferences?: FredSourceReference[];
  }
  | { type: "error"; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseConversation(value: unknown): FredNativeConversation | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string"
    || typeof value.title !== "string"
    || typeof value.createdAt !== "string"
    || typeof value.updatedAt !== "string"
    || !isFredAgentKey(value.agentKey)
  ) {
    return null;
  }
  return {
    id: value.id,
    title: value.title,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    agentKey: value.agentKey,
  };
}

export function encodeFredNativeStreamEvent(event: FredNativeStreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export function parseFredNativeStreamLine(line: string): FredNativeStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    throw new Error("Ungültiges Fred-Streaming-Ereignis.");
  }
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("Ungültiges Fred-Streaming-Ereignis.");
  }

  if (value.type === "conversation") {
    const conversation = parseConversation(value.conversation);
    if (!conversation) throw new Error("Ungültiges Fred-Streaming-Ereignis.");
    return { type: "conversation", conversation };
  }
  if (value.type === "delta") {
    if (typeof value.content !== "string") {
      throw new Error("Ungültiges Fred-Streaming-Ereignis.");
    }
    return { type: "delta", content: value.content };
  }
  if (value.type === "replace") {
    if (typeof value.answer !== "string") {
      throw new Error("Ungültiges Fred-Streaming-Ereignis.");
    }
    return { type: "replace", answer: value.answer };
  }
  if (value.type === "research") {
    const step = parseStoredFredResearchTrace([value.step])[0];
    if (!step) throw new Error("Ungültiges Fred-Streaming-Ereignis.");
    return { type: "research", step };
  }
  if (value.type === "status") {
    if (typeof value.label !== "string" || !value.label) {
      throw new Error("Ungültiges Fred-Streaming-Ereignis.");
    }
    return { type: "status", label: value.label };
  }
  if (value.type === "final") {
    const conversation = parseConversation(value.conversation);
    if (typeof value.answer !== "string" || !conversation) {
      throw new Error("Ungültiges Fred-Streaming-Ereignis.");
    }
    return {
      type: "final",
      answer: value.answer,
      conversation,
      researchTrace: parseStoredFredResearchTrace(value.researchTrace),
      sourceReferences: parseStoredFredSources(value.sourceReferences),
    };
  }
  if (value.type === "error") {
    if (typeof value.error !== "string") {
      throw new Error("Ungültiges Fred-Streaming-Ereignis.");
    }
    return { type: "error", error: value.error };
  }

  throw new Error("Unbekanntes Fred-Streaming-Ereignis.");
}
