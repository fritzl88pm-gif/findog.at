import { describe, expect, it } from "vitest";

import { isPreambleRetractingToolCall, upstreamFinalContent } from "./run-diagnostics";

describe("isPreambleRetractingToolCall", () => {
  it("retracts on agent tool calls but not on final_answer or other events", () => {
    expect(isPreambleRetractingToolCall({ response_type: "tool_call", data: { tool_name: "knowledge_search" } })).toBe(true);
    expect(isPreambleRetractingToolCall({ response_type: "tool_call", tool_name: "web_search" })).toBe(true);
    expect(isPreambleRetractingToolCall({ response_type: "tool_call", data: { tool_name: "final_answer" } })).toBe(false);
    expect(isPreambleRetractingToolCall({ response_type: "tool_result", data: { tool_name: "knowledge_search" } })).toBe(false);
    expect(isPreambleRetractingToolCall({ response_type: "answer", content: "Antwort" })).toBe(false);
    expect(isPreambleRetractingToolCall(null)).toBe(false);
  });
});

describe("upstreamFinalContent", () => {
  it("returns the non-empty final content of a complete event only", () => {
    expect(upstreamFinalContent({ response_type: "complete", data: { final_content: "Antwort" } })).toBe("Antwort");
    expect(upstreamFinalContent({ response_type: "complete", data: { final_content: "  " } })).toBe("");
    expect(upstreamFinalContent({ response_type: "complete", data: {} })).toBe("");
    expect(upstreamFinalContent({ response_type: "complete" })).toBe("");
    expect(upstreamFinalContent({ response_type: "answer", data: { final_content: "Antwort" } })).toBe("");
  });
});
