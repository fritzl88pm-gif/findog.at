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

  it("rejects malformed or unknown stream events", () => {
    expect(() => parseChatStreamLine("{")).toThrow("Ungültiges Streaming-Ereignis");
    expect(() => parseChatStreamLine(JSON.stringify({ type: "unknown" }))).toThrow(
      "Unbekanntes Streaming-Ereignis",
    );
  });
});
