import { describe, expect, it } from "vitest";

import { encodeChatStreamEvent, parseChatStreamLine } from "./chat-stream";

describe("chat stream events", () => {
  it("encodes and parses step events as newline-delimited JSON", () => {
    const event = {
      type: "step" as const,
      step: {
        type: "tool_call" as const,
        title: "Werkzeugaufruf: hybrid_search",
        content: "Argumente:\nPendlerpauschale",
        toolName: "hybrid_search",
        arguments: "Pendlerpauschale",
      },
    };

    const encoded = encodeChatStreamEvent(event);

    expect(encoded.endsWith("\n")).toBe(true);
    expect(parseChatStreamLine(encoded)).toEqual(event);
    expect(parseChatStreamLine("   ")).toBeNull();
  });

  it("accepts citation verification steps", () => {
    const event = {
      type: "step" as const,
      step: {
        type: "citation_verification" as const,
        title: "BFG-Fundstellen geprüft",
        content: "1 verifiziert, 1 verworfen.",
      },
    };

    expect(parseChatStreamLine(encodeChatStreamEvent(event))).toEqual(event);
  });

  it("preserves the generated conversation title in final events", () => {
    const event = {
      type: "final" as const,
      answer: "Antwort",
      title: "Unterhaltsabsetzbetrag bei Drittstaatenkindern",
      steps: [],
      tools: ["hybrid_search"],
      conversationId: "11111111-1111-4111-8111-111111111111",
      model: "deepseek-v4-pro",
      availableModels: ["deepseek-v4-pro"],
    };

    expect(parseChatStreamLine(encodeChatStreamEvent(event))).toEqual(event);
  });

  it("rejects malformed or unknown stream events", () => {
    expect(() => parseChatStreamLine("{")).toThrow("Ungültiges Streaming-Ereignis");
    expect(() => parseChatStreamLine(JSON.stringify({ type: "unknown" }))).toThrow(
      "Unbekanntes Streaming-Ereignis",
    );
  });
});
