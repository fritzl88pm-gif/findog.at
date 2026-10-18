import { describe, expect, it, vi } from "vitest";

import { isPreambleRetractingToolCall, updateGenerationRun, upstreamFinalContent } from "./run-diagnostics";

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

describe("updateGenerationRun", () => {
  it("stamps first delta and completion with the time the event happened", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    const supabase = { from: vi.fn().mockReturnValue({ update }) };
    const occurredAt = new Date("2026-10-19T08:00:00.000Z");

    await updateGenerationRun({
      supabase: supabase as never,
      runId: "run-1",
      firstDelta: true,
      completed: true,
      occurredAt,
    });

    expect(supabase.from).toHaveBeenCalledWith("fred_generation_runs");
    expect(update).toHaveBeenCalledWith({
      first_delta_at: "2026-10-19T08:00:00.000Z",
      completed_at: "2026-10-19T08:00:00.000Z",
    });
    expect(eq).toHaveBeenCalledWith("id", "run-1");
  });
});
