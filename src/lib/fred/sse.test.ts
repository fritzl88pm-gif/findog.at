import { describe, expect, it } from "vitest";

import {
  type FredSseEvent,
  formatSseFrame,
  isTerminalFredEvent,
  parseSseChunk,
  sanitizeFredEvent,
} from "./sse";

describe("isTerminalFredEvent", () => {
  it("stops on complete and error but not on answer chunks", () => {
    expect(isTerminalFredEvent({ response_type: "complete" })).toBe(true);
    expect(isTerminalFredEvent({ response_type: "error" })).toBe(true);
    expect(isTerminalFredEvent({ response_type: "answer", content: "chunk" })).toBe(false);
  });
});

describe("parseSseChunk – incremental SSE frame parser", () => {
  it("parses a complete single frame with event and data lines", () => {
    const input = "event: message\ndata: {\"response_type\":\"answer\",\"content\":\"Hallo\"}\n\n";
    const result = parseSseChunk(input);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.response_type).toBe("answer");
    expect(result.events[0]!.content).toBe("Hallo");
    expect(result.remainder).toBe("");
  });

  it("parses multiple frames from one chunk", () => {
    const input =
      "event: message\ndata: {\"response_type\":\"answer\",\"content\":\"first\"}\n\n" +
      "event: message\ndata: {\"response_type\":\"answer\",\"content\":\"second\"}\n\n";
    const result = parseSseChunk(input);
    expect(result.events).toHaveLength(2);
    expect(result.events[0]!.content).toBe("first");
    expect(result.events[1]!.content).toBe("second");
    expect(result.remainder).toBe("");
  });

  it("preserves remainder for an incomplete frame", () => {
    const input = "event: message\ndata: {\"response_type\":\"answer\",\"content\":\"Hallo\"}";
    const result = parseSseChunk(input);
    expect(result.events).toHaveLength(0);
    expect(result.remainder).toBe(input);
  });

  it("parses one complete frame and preserves remainder of the next", () => {
    const complete = "event: message\ndata: {\"response_type\":\"answer\",\"content\":\"done\"}\n\n";
    const partial = "event: message\ndata: {\"response_type\":\"answer\",\"content\":\"partial\"}";
    const result = parseSseChunk(complete + partial);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.content).toBe("done");
    expect(result.remainder).toBe(partial);
  });

  it("handles CRLF line endings", () => {
    const input = "event: message\r\ndata: {\"response_type\":\"answer\",\"content\":\"CRLF ok\"}\r\n\r\n";
    const result = parseSseChunk(input);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.content).toBe("CRLF ok");
    expect(result.remainder).toBe("");
  });

  it("ignores event types other than message (comments/keepalive)", () => {
    const input =
      ": keepalive comment\n" +
      "event: message\ndata: {\"response_type\":\"answer\",\"content\":\"real\"}\n\n" +
      ": another comment\n";
    const result = parseSseChunk(input);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.content).toBe("real");
  });

  it("ignores lines with unknown event types but still parses data:", () => {
    const input =
      "event: custom\ndata: {\"response_type\":\"answer\",\"content\":\"still captured\"}\n\n";
    const result = parseSseChunk(input);
    // We capture data: regardless of event: value
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.content).toBe("still captured");
  });

  it("skips malformed JSON in data field", () => {
    const input = "event: message\ndata: not-json\n\n";
    const result = parseSseChunk(input);
    expect(result.events).toHaveLength(0);
    expect(result.remainder).toBe("");
  });

  it("skips empty data field", () => {
    const input = "event: message\ndata:\n\n";
    const result = parseSseChunk(input);
    expect(result.events).toHaveLength(0);
    expect(result.remainder).toBe("");
  });

  it("handles data lines with leading space after colon", () => {
    const input = "event: message\ndata: {\"response_type\":\"answer\",\"content\":\"space ok\"}\n\n";
    const result = parseSseChunk(input);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.content).toBe("space ok");
  });

  it("handles chunk split in the middle of a data line", () => {
    const chunk1 = "event: message\nda";
    const chunk2 = "ta: {\"response_type\":\"answer\",\"content\":\"split\"}\n\n";
    const r1 = parseSseChunk(chunk1);
    expect(r1.events).toHaveLength(0);
    expect(r1.remainder).toBe(chunk1);

    const r2 = parseSseChunk(r1.remainder + chunk2);
    expect(r2.events).toHaveLength(1);
    expect(r2.events[0]!.content).toBe("split");
    expect(r2.remainder).toBe("");
  });

  it("handles chunk split at frame boundary (empty line split across chunks)", () => {
    const chunk1 = "event: message\ndata: {\"response_type\":\"answer\",\"content\":\"a\"}\n";
    const chunk2 = "\nevent: message\ndata: {\"response_type\":\"answer\",\"content\":\"b\"}\n\n";
    const r1 = parseSseChunk(chunk1);
    expect(r1.events).toHaveLength(0);
    expect(r1.remainder).toBe(chunk1);

    const r2 = parseSseChunk(r1.remainder + chunk2);
    expect(r2.events).toHaveLength(2);
    expect(r2.events[0]!.content).toBe("a");
    expect(r2.events[1]!.content).toBe("b");
    expect(r2.remainder).toBe("");
  });

  it("handles a CRLF frame delimiter split across chunks", () => {
    const chunk1 =
      "event: message\r\ndata: {\"response_type\":\"answer\",\"content\":\"crlf split\"}\r\n\r";
    const chunk2 = "\n";
    const r1 = parseSseChunk(chunk1);
    expect(r1.events).toHaveLength(0);
    expect(r1.remainder).toBe(chunk1);

    const r2 = parseSseChunk(r1.remainder + chunk2);
    expect(r2.events).toHaveLength(1);
    expect(r2.events[0]!.content).toBe("crlf split");
    expect(r2.remainder).toBe("");
  });
});

describe("sanitizeFredEvent – strip sensitive fields", () => {
  it("strips content and data from thinking events", () => {
    const sanitized = sanitizeFredEvent({
      response_type: "thinking",
      content: "Raw thinking text with sensitive info",
      data: { query: "secret query" },
    });
    expect(sanitized.response_type).toBe("thinking");
    expect((sanitized as Record<string, unknown>).content).toBeUndefined();
    expect((sanitized as Record<string, unknown>).data).toBeUndefined();
  });

  it("strips content, data, tool_call_id from tool_call events", () => {
    const sanitized = sanitizeFredEvent({
      response_type: "tool_call",
      content: "secret args",
      data: { function: "search", args: { q: "secret" } },
      tool_call_id: "call-123",
    });
    expect(sanitized.response_type).toBe("tool_call");
    expect((sanitized as Record<string, unknown>).content).toBeUndefined();
    expect((sanitized as Record<string, unknown>).data).toBeUndefined();
    expect((sanitized as Record<string, unknown>).tool_call_id).toBeUndefined();
  });

  it("strips raw fields from tool_result events", () => {
    const sanitized = sanitizeFredEvent({
      response_type: "tool_result",
      content: "sensitive output",
      data: { result: "confidential" },
      tool_call_id: "call-123",
    });
    expect(sanitized.response_type).toBe("tool_result");
    expect((sanitized as Record<string, unknown>).content).toBeUndefined();
    expect((sanitized as Record<string, unknown>).data).toBeUndefined();
    expect((sanitized as Record<string, unknown>).tool_call_id).toBeUndefined();
  });

  it("preserves answer response_type and content, strips data", () => {
    const sanitized = sanitizeFredEvent({
      response_type: "answer",
      content: "Antwort text",
      data: { citations: [] },
    });
    expect(sanitized.response_type).toBe("answer");
    expect(sanitized.content).toBe("Antwort text");
    expect((sanitized as Record<string, unknown>).data).toBeUndefined();
  });

  it("preserves agent_query assistant_message_id, strips data", () => {
    const sanitized = sanitizeFredEvent({
      response_type: "agent_query",
      content: "internal query text",
      assistant_message_id: "msg-123",
      data: { sources: [] },
    });
    expect(sanitized.response_type).toBe("agent_query");
    expect(sanitized.assistant_message_id).toBe("msg-123");
    expect((sanitized as Record<string, unknown>).data).toBeUndefined();
    // content is not needed by the client for agent_query
    expect((sanitized as Record<string, unknown>).content).toBeUndefined();
  });

  it("preserves only the complete marker", () => {
    const sanitized = sanitizeFredEvent({
      response_type: "complete",
      data: { reason: "done" },
    });
    expect(sanitized).toEqual({ response_type: "complete" });
  });

  it("fails closed for unknown event types", () => {
    const sanitized = sanitizeFredEvent({
      response_type: "future_event",
      content: "secret content",
      data: { secret: "payload" },
      arbitrary: "upstream field",
    });
    expect(sanitized).toEqual({ response_type: "future_event" });
  });

  it("preserves error content and strips nested data", () => {
    const sanitized = sanitizeFredEvent({
      response_type: "error",
      content: "Ein Fehler ist aufgetreten.",
      data: { stack: "trace" },
    });
    expect(sanitized.response_type).toBe("error");
    expect(sanitized.content).toBe("Ein Fehler ist aufgetreten.");
    expect((sanitized as Record<string, unknown>).data).toBeUndefined();
  });
});

describe("formatSseFrame – format event as SSE frame", () => {
  it("formats a simple event", () => {
    const event: FredSseEvent = { response_type: "answer", content: "Hallo" };
    const frame = formatSseFrame(event);
    expect(frame).toBe("event: message\ndata: {\"response_type\":\"answer\",\"content\":\"Hallo\"}\n\n");
  });

  it("includes assistant_message_id when present", () => {
    const event: FredSseEvent = { response_type: "agent_query", assistant_message_id: "msg-1" };
    const frame = formatSseFrame(event);
    expect(frame).toContain('"assistant_message_id":"msg-1"');
    expect(frame).toContain("event: message\ndata: ");
    expect(frame).toMatch(/\n\n$/);
  });

  it("each frame ends with double newline", () => {
    const event: FredSseEvent = { response_type: "complete", data: {} };
    const frame = formatSseFrame(event);
    expect(frame.endsWith("\n\n")).toBe(true);
  });
});

describe("Full round-trip: live fixture", () => {
  it("parses a live-style SSE stream, sanitizes, and reformats", () => {
    const upstreamSse =
      "event: message\n" +
      "data: {\"response_type\":\"agent_query\",\"assistant_message_id\":\"msg-abc\",\"content\":\"query...\",\"data\":{\"sources\":[]}}\n\n" +
      "event: message\n" +
      "data: {\"response_type\":\"thinking\",\"content\":\"SECRET_INTERNAL_THOUGHT\",\"data\":{\"model\":\"gpt-4\"}}\n\n" +
      "event: message\n" +
      "data: {\"response_type\":\"answer\",\"content\":\"Hallo Welt\",\"data\":{\"citations\":[]}}\n\n" +
      "event: message\n" +
      "data: {\"response_type\":\"answer\",\"content\":\" weiterer Text\",\"data\":{}}\n\n" +
      "event: message\n" +
      "data: {\"response_type\":\"complete\",\"data\":{}}\n\n";

    const parsed = parseSseChunk(upstreamSse);
    expect(parsed.events).toHaveLength(5);
    expect(parsed.remainder).toBe("");

    // Sanitize each
    const sanitized = parsed.events.map(sanitizeFredEvent);

    // Answer content should survive
    expect(sanitized[2]!.response_type).toBe("answer");
    expect(sanitized[2]!.content).toBe("Hallo Welt");
    expect(sanitized[3]!.response_type).toBe("answer");
    expect(sanitized[3]!.content).toBe(" weiterer Text");

    // Thinking should have content stripped
    expect(sanitized[1]!.response_type).toBe("thinking");
    expect((sanitized[1] as Record<string, unknown>).content).toBeUndefined();

    // Reformat as SSE frames
    const output = sanitized.map(formatSseFrame).join("");

    // The secret thinking text must NOT appear anywhere
    expect(output).not.toContain("SECRET_INTERNAL_THOUGHT");

    // Answer content MUST appear
    expect(output).toContain("Hallo Welt");
    expect(output).toContain("weiterer Text");

    // assistant_message_id from agent_query should survive
    expect(output).toContain("msg-abc");

    // Valid SSE framing
    expect(output).toContain("event: message");
    expect(output.match(/\n\n/g)).toHaveLength(5);
  });
});
