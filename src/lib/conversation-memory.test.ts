import { describe, expect, it, vi } from "vitest";

import {
  formatResearchMemory,
  loadConversationResearchMemory,
  MAX_MEMORY_CHARS,
  MAX_MEMORY_STEPS,
  type ResearchMemoryEntry,
} from "./conversation-memory";

type QueryResult = { data: unknown; error: unknown };

function builder(result: QueryResult) {
  const b: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit"]) {
    b[method] = vi.fn().mockReturnValue(b);
  }
  b.then = (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return b;
}

function client(runs: QueryResult, steps: QueryResult) {
  const from = vi.fn((table: string) => (table === "agent_runs" ? builder(runs) : builder(steps)));
  return { client: { from } as never, from };
}

function toolResult(agentRunId: string, stepOrder: number, content: string, toolName = "search_bfg") {
  return {
    agent_run_id: agentRunId,
    step_order: stepOrder,
    step_type: "tool_result",
    title: "Rechercheergebnis",
    content,
    tool_name: toolName,
    success: true,
  };
}

describe("loadConversationResearchMemory", () => {
  it("carries forward successful tool results, newest run first", async () => {
    const { client: supabase, from } = client(
      { data: [{ id: "run-new" }, { id: "run-old" }], error: null },
      {
        data: [
          toolResult("run-old", 0, "alter Treffer"),
          toolResult("run-new", 0, "neuer Treffer", "search_laws"),
        ],
        error: null,
      },
    );

    const entries = await loadConversationResearchMemory({
      supabase,
      conversationId: "c1",
      clientId: "u1",
    });

    expect(from).toHaveBeenCalledWith("agent_runs");
    expect(from).toHaveBeenCalledWith("agent_steps");
    expect(entries).toEqual([
      { toolName: "search_laws", title: "Rechercheergebnis", content: "neuer Treffer" },
      { toolName: "search_bfg", title: "Rechercheergebnis", content: "alter Treffer" },
    ]);
  });

  it.each([
    { label: "no prior runs", runs: { data: [], error: null }, steps: { data: [], error: null } },
    { label: "runs error", runs: { data: null, error: { code: "PGRST205" } }, steps: { data: [], error: null } },
    { label: "steps error", runs: { data: [{ id: "r1" }], error: null }, steps: { data: null, error: { code: "42P01" } } },
  ])("returns empty memory on $label", async ({ runs, steps }) => {
    const { client: supabase } = client(runs, steps);
    await expect(
      loadConversationResearchMemory({ supabase, conversationId: "c1", clientId: "u1" }),
    ).resolves.toEqual([]);
  });

  it("caps the number of carried steps", async () => {
    const steps = Array.from({ length: MAX_MEMORY_STEPS + 5 }, (_, index) =>
      toolResult("r1", index, `Treffer ${index}`),
    );
    const { client: supabase } = client({ data: [{ id: "r1" }], error: null }, { data: steps, error: null });
    const entries = await loadConversationResearchMemory({
      supabase,
      conversationId: "c1",
      clientId: "u1",
    });
    expect(entries).toHaveLength(MAX_MEMORY_STEPS);
  });

  it("respects the character budget", async () => {
    const big = "x".repeat(4_000);
    const steps = Array.from({ length: 5 }, (_, index) => toolResult("r1", index, big));
    const { client: supabase } = client({ data: [{ id: "r1" }], error: null }, { data: steps, error: null });
    const entries = await loadConversationResearchMemory({
      supabase,
      conversationId: "c1",
      clientId: "u1",
    });
    const totalChars = entries.reduce((sum, entry) => sum + entry.content.length, 0);
    expect(totalChars).toBeLessThanOrEqual(MAX_MEMORY_CHARS);
    expect(entries.length).toBeGreaterThan(0);
  });
});

describe("formatResearchMemory", () => {
  it("returns undefined when there is nothing to carry forward", () => {
    expect(formatResearchMemory([])).toBeUndefined();
  });

  it("renders a labelled, lower-authority block", () => {
    const entries: ResearchMemoryEntry[] = [
      { toolName: "search_bfg", title: "BFG-Treffer", content: "RV/1234/2020 …" },
    ];
    const block = formatResearchMemory(entries);
    expect(block).toContain("Bekannte Fundstellen aus früheren Runden");
    expect(block).toContain("können veraltet sein");
    expect(block).toContain("[search_bfg]");
    expect(block).toContain("RV/1234/2020 …");
  });
});
