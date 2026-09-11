import { describe, expect, it } from "vitest";

import { FindogAgentEvidenceRegistry } from "./evidence";
import { createFindogAgentToolRegistry } from "./tools";

function createRegistry(limits = { maxToolCalls: 2, maxToolResultCharacters: 500 }) {
  const evidence = new FindogAgentEvidenceRegistry();
  const registry = createFindogAgentToolRegistry({
    knowledge: null,
    web: null,
    mcpClients: [],
    evidence,
    limits,
  });
  return { registry, evidence };
}

describe("findog agent tool registry", () => {
  it("exposes only planning and calculator when no sources are configured", () => {
    const { registry } = createRegistry();
    expect(registry.definitions().map((tool) => tool.name).sort()).toEqual([
      "calculator",
      "update_plan",
    ]);
    expect(registry.definitions().every((tool) => tool.readOnly)).toBe(true);
    // There is deliberately no shell, eval, HTTP or write tool.
    for (const forbidden of ["shell", "eval", "exec", "http_request", "write_file", "browser"]) {
      expect(registry.has(forbidden)).toBe(false);
    }
  });

  it("refuses unknown tools without executing anything", async () => {
    const { registry } = createRegistry();
    const outcome = await registry.execute("shell", JSON.stringify({ command: "ls" }), {
      signal: new AbortController().signal,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.errorCode).toBe("unknown_tool");
    expect(registry.callsUsed()).toBe(0);
  });

  it("rejects malformed JSON and schema violations before the handler runs", async () => {
    const { registry } = createRegistry();
    const signal = new AbortController().signal;

    const malformed = await registry.execute("calculator", "{not json", { signal });
    expect(malformed.errorCode).toBe("invalid_arguments");

    const wrongType = await registry.execute("calculator", JSON.stringify({ expression: 5 }), { signal });
    expect(wrongType.errorCode).toBe("invalid_arguments");

    const missing = await registry.execute("update_plan", JSON.stringify({}), { signal });
    expect(missing.errorCode).toBe("invalid_arguments");

    const unknownField = await registry.execute(
      "calculator",
      JSON.stringify({ expression: "1+1", extra: true }),
      { signal },
    );
    expect(unknownField.errorCode).toBe("invalid_arguments");

    expect(registry.callsUsed()).toBe(0);
  });

  it("counts successful calls and enforces the tool call limit", async () => {
    const { registry } = createRegistry({ maxToolCalls: 1, maxToolResultCharacters: 500 });
    const signal = new AbortController().signal;

    const first = await registry.execute("calculator", JSON.stringify({ expression: "2*3" }), { signal });
    expect(first.ok).toBe(true);
    expect(first.content).toContain("6");

    const second = await registry.execute("calculator", JSON.stringify({ expression: "1+1" }), { signal });
    expect(second.ok).toBe(false);
    expect(second.errorCode).toBe("tool_call_limit");
    expect(registry.callsUsed()).toBe(1);
  });

  it("reports calculator failures as tool errors without evidence", async () => {
    const { registry, evidence } = createRegistry();
    const signal = new AbortController().signal;
    const outcome = await registry.execute("calculator", JSON.stringify({ expression: "5 / 0" }), { signal });
    expect(outcome.ok).toBe(false);
    expect(outcome.errorCode).toBe("division_by_zero");
    expect(outcome.sources).toEqual([]);
    expect(evidence.list()).toEqual([]);
  });

  it("records the plan and bounds tool result text", async () => {
    const { registry } = createRegistry({ maxToolCalls: 5, maxToolResultCharacters: 60 });
    const signal = new AbortController().signal;
    const plan = await registry.execute(
      "update_plan",
      JSON.stringify({ steps: ["Erster Schritt", "Zweiter Schritt"], notes: "Notiz" }),
      { signal },
    );
    expect(plan.ok).toBe(true);
    expect(plan.meta.plan).toEqual({
      steps: ["Erster Schritt", "Zweiter Schritt"],
      notes: "Notiz",
    });

    const bounded = await registry.execute(
      "update_plan",
      JSON.stringify({ steps: ["x".repeat(200)] }),
      { signal },
    );
    expect(bounded.content).toContain("[Werkzeugergebnis gekürzt]");
    expect(bounded.content.length).toBeLessThan(120);
  });
});
