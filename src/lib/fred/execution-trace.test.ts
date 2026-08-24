import { describe, expect, it } from "vitest";

import {
  mergeFredExecutionStep,
  parseStoredFredExecutionTrace,
  parseWeKnoraExecutionEvent,
  type FredExecutionStep,
} from "./execution-trace";

describe("WeKnora execution trace projection and parser", () => {
  it("maps thinking events to deterministic German labels and strips raw thinking/reasoning content", () => {
    const running = parseWeKnoraExecutionEvent({
      response_type: "thinking",
      content: "I need to look up tax code section 33 and evaluate secret details",
      reasoning_content: "Internal reasoning hidden from users",
      data: {
        event_id: "think-1",
        content: "Raw reflection and thinking string",
        thinking: { content: "Internal reasoning tree" },
      },
    });

    expect(running.step).toEqual({
      id: expect.stringMatching(/^analysis:[a-z0-9]+$/u),
      kind: "analysis",
      status: "running",
      label: "Anfrage wird analysiert",
    });
    expect(JSON.stringify(running)).not.toContain("tax code");
    expect(JSON.stringify(running)).not.toContain("Internal reasoning");
    expect(JSON.stringify(running)).not.toContain("Raw reflection");

    const completed = parseWeKnoraExecutionEvent({
      response_type: "thinking",
      data: {
        event_id: "think-1",
        done: true,
      },
    });

    expect(completed.step).toEqual({
      id: running.step?.id,
      kind: "analysis",
      status: "completed",
      label: "Anfrage analysiert",
    });
  });

  it("maps reflection events to deterministic German labels and strips raw reflection text", () => {
    const running = parseWeKnoraExecutionEvent({
      response_type: "reflection",
      content: "Evaluating previous tool output for consistency",
      data: {
        event_id: "refl-1",
        reflection: "Secret model reflection text",
      },
    });

    expect(running.step).toEqual({
      id: expect.stringMatching(/^evaluation:[a-z0-9]+$/u),
      kind: "evaluation",
      status: "running",
      label: "Rechercheergebnisse werden bewertet",
    });
    expect(JSON.stringify(running)).not.toContain("Evaluating previous");
    expect(JSON.stringify(running)).not.toContain("Secret model");

    const completed = parseWeKnoraExecutionEvent({
      response_type: "reflection",
      data: {
        event_id: "refl-1",
        done: true,
      },
    });

    expect(completed.step).toEqual({
      id: running.step?.id,
      kind: "evaluation",
      status: "completed",
      label: "Rechercheergebnisse bewertet",
    });
  });

  it("transforms todo_write planning into structured German counts without leaking raw step text", () => {
    const running = parseWeKnoraExecutionEvent({
      response_type: "tool_call",
      data: {
        tool_call_id: "todo-call-1",
        tool_name: "todo_write",
        arguments: {
          todos: [
            { id: "1", task: "Search BFG rulings regarding pendlerpauschale in English", status: "completed" },
            { id: "2", task: "Compare with EStG § 16 Abs 1 Z 6", status: "in_progress" },
            { id: "3", task: "Formulate final recommendation", status: "pending" },
          ],
        },
      },
    });

    expect(running.step).toEqual({
      id: expect.stringMatching(/^planning:[a-z0-9]+$/u),
      kind: "planning",
      status: "running",
      label: "Rechercheplan wird aktualisiert",
      detail: "3 Aufgaben geplant · 1 abgeschlossen · 1 in Bearbeitung · 1 offen",
      counts: {
        total: 3,
        completed: 1,
        inProgress: 1,
        open: 1,
      },
    });
    expect(JSON.stringify(running)).not.toContain("pendlerpauschale");
    expect(JSON.stringify(running)).not.toContain("EStG");
    expect(JSON.stringify(running)).not.toContain("Search BFG");

    const completed = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "todo-call-1",
        tool_name: "todo_write",
        success: true,
        duration_ms: 120,
        result: {
          todos: [
            { id: "1", task: "Search BFG rulings", status: "completed" },
            { id: "2", task: "Compare with EStG", status: "completed" },
            { id: "3", task: "Formulate final recommendation", status: "completed" },
          ],
        },
      },
    });

    expect(completed.step).toEqual({
      id: running.step?.id,
      kind: "planning",
      status: "completed",
      label: "Rechercheplan aktualisiert",
      detail: "3 Aufgaben geplant · 3 abgeschlossen",
      durationMs: 120,
      counts: {
        total: 3,
        completed: 3,
        inProgress: 0,
        open: 0,
      },
    });
    expect(JSON.stringify(completed)).not.toContain("Search BFG");
  });

  it("maps known tools to German labels and bounded structured summaries without leaking args or outputs", () => {
    const kbCall = parseWeKnoraExecutionEvent({
      response_type: "tool_call",
      data: {
        tool_call_id: "call-kb-1",
        tool_name: "knowledge_search",
        arguments: {
          query: "secret tax evasion scheme query",
          filter: "internal_doc_id = 999",
          api_key: "sk-proj-secret-key",
          storage_uri: "s3://internal-bucket/raw/secret.pdf",
        },
      },
    });

    expect(kbCall.step).toEqual({
      id: expect.stringMatching(/^knowledge:[a-z0-9]+$/u),
      kind: "knowledge",
      status: "running",
      label: "Wissensbasis wird durchsucht",
    });
    expect(JSON.stringify(kbCall)).not.toContain("secret");
    expect(JSON.stringify(kbCall)).not.toContain("sk-proj");
    expect(JSON.stringify(kbCall)).not.toContain("s3://");

    const kbResult = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "call-kb-1",
        tool_name: "knowledge_search",
        success: true,
        duration_ms: 450,
        result: {
          matches: [
            { text: "Secret excerpt from document", score: 0.99 },
            { text: "Another excerpt", score: 0.85 },
          ],
        },
      },
    });

    expect(kbResult.step).toEqual({
      id: kbCall.step?.id,
      kind: "knowledge",
      status: "completed",
      label: "Wissensbasis durchsucht",
      durationMs: 450,
    });
    expect(JSON.stringify(kbResult)).not.toContain("Secret excerpt");

    const webCall = parseWeKnoraExecutionEvent({
      response_type: "tool_call",
      data: {
        tool_call_id: "call-web-1",
        tool_name: "web_search",
        arguments: {
          query: "https://internal-api.service.local/search?q=classified",
        },
      },
    });

    expect(webCall.step).toEqual({
      id: expect.stringMatching(/^web:[a-z0-9]+$/u),
      kind: "web",
      status: "running",
      label: "Websuche wird durchgeführt",
    });
    expect(JSON.stringify(webCall)).not.toContain("classified");
    expect(JSON.stringify(webCall)).not.toContain("internal-api");
  });

  it("handles unknown tools with generic German label and no arbitrary details", () => {
    const unknownCall = parseWeKnoraExecutionEvent({
      response_type: "tool_call",
      data: {
        tool_call_id: "custom-tool-42",
        tool_name: "run_arbitrary_python_script",
        arguments: { code: "import os; print(os.environ)" },
      },
    });

    expect(unknownCall.step).toEqual({
      id: expect.stringMatching(/^tool:[a-z0-9]+$/u),
      kind: "tool",
      status: "running",
      label: "Recherchewerkzeug wird ausgeführt",
    });
    expect(JSON.stringify(unknownCall)).not.toContain("run_arbitrary_python_script");
    expect(JSON.stringify(unknownCall)).not.toContain("os.environ");

    const unknownFail = parseWeKnoraExecutionEvent({
      response_type: "error",
      data: {
        tool_call_id: "custom-tool-42",
        tool_name: "run_arbitrary_python_script",
        error: "Fatal exception: Stack trace in /var/log/secret.log",
      },
    });

    expect(unknownFail.step).toEqual({
      id: unknownCall.step?.id,
      kind: "tool",
      status: "failed",
      label: "Recherchewerkzeug fehlgeschlagen",
    });
    expect(JSON.stringify(unknownFail)).not.toContain("Stack trace");
    expect(JSON.stringify(unknownFail)).not.toContain("/var/log");
    expect(JSON.stringify(unknownFail)).not.toContain("custom-tool-42");
  });

  it("merges and updates execution steps chronologically and enforces size bounds", () => {
    const step1: FredExecutionStep = {
      id: "step-1",
      kind: "analysis",
      status: "running",
      label: "Anfrage wird analysiert",
    };
    const step1Done: FredExecutionStep = {
      id: "step-1",
      kind: "analysis",
      status: "completed",
      label: "Anfrage analysiert",
      durationMs: 300,
    };
    const step2: FredExecutionStep = {
      id: "step-2",
      kind: "web",
      status: "running",
      label: "Websuche wird durchgeführt",
    };

    let steps = mergeFredExecutionStep([], step1);
    expect(steps).toEqual([step1]);

    steps = mergeFredExecutionStep(steps, step1Done);
    expect(steps).toEqual([step1Done]);

    steps = mergeFredExecutionStep(steps, step2);
    expect(steps).toEqual([step1Done, step2]);

    // Cap array at 200 items
    for (let i = 3; i <= 250; i += 1) {
      steps = mergeFredExecutionStep(steps, {
        id: `step-${i}`,
        kind: "tool",
        status: "completed",
        label: "Recherchewerkzeug ausgeführt",
      });
    }
    expect(steps.length).toBe(200);
    expect(steps[steps.length - 1]?.id).toBe("step-250");
  });

  it("parses stored execution traces and filters out malformed or oversized entries", () => {
    const raw = [
      {
        id: "s1",
        kind: "planning",
        status: "completed",
        label: "Rechercheplan aktualisiert",
        detail: "3 Aufgaben geplant",
        durationMs: 150,
        counts: { total: 3, completed: 3, inProgress: 0, open: 0 },
      },
      {
        id: "invalid-kind",
        kind: "hacker_kind",
        status: "completed",
        label: "test",
      },
      {
        id: "missing-label",
        kind: "web",
        status: "completed",
      },
      null,
      123,
    ];

    const parsed = parseStoredFredExecutionTrace(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      id: "s1",
      kind: "planning",
      status: "completed",
      label: "Rechercheplan aktualisiert",
      detail: "3 Aufgaben geplant",
      durationMs: 150,
      counts: { total: 3, completed: 3, inProgress: 0, open: 0 },
    });
  });

  // Explicit regressions test
  it("regression: ensures hidden reasoning, English planning text, raw queries, storage URIs, and secrets are strictly absent", () => {
    const maliciousPayloads = [
      {
        response_type: "thinking",
        thinking: { content: "SECRET_KEY_12345: hidden reasoning content in English" },
      },
      {
        response_type: "tool_call",
        data: {
          tool_call_id: "plan-1",
          tool_name: "todo_write",
          arguments: {
            todos: [{ id: "1", task: "CONFIDENTIAL_TASK: Download internal database from gs://finance-bucket/v1" }],
          },
        },
      },
      {
        response_type: "tool_call",
        data: {
          tool_call_id: "tool-1",
          tool_name: "custom_fetch",
          arguments: { url: "https://auth.internal.corp/oauth/token?secret=TOP_SECRET_PASSWORD" },
        },
      },
    ];

    const serializedResults = maliciousPayloads
      .map((p) => JSON.stringify(parseWeKnoraExecutionEvent(p)))
      .join(" ");

    expect(serializedResults).not.toContain("SECRET_KEY_12345");
    expect(serializedResults).not.toContain("CONFIDENTIAL_TASK");
    expect(serializedResults).not.toContain("gs://finance-bucket");
    expect(serializedResults).not.toContain("TOP_SECRET_PASSWORD");
    expect(serializedResults).not.toContain("auth.internal.corp");
    expect(serializedResults).not.toContain("custom_fetch");
  });
});
