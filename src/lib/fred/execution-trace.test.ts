import { describe, expect, it } from "vitest";

import {
  mergeFredExecutionStep,
  parseStoredFredExecutionTrace,
  parseWeKnoraExecutionEvent,
  type FredExecutionStep,
} from "./execution-trace";

describe("WeKnora execution trace projection and parser", () => {
  it("shows bounded provider-exposed thinking text in advanced mode", () => {
    const running = parseWeKnoraExecutionEvent({
      response_type: "thinking",
      content: "Zuerst prüfe ich die einschlägige Bestimmung und danach die Rechtsprechung.",
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
      detail: "Zuerst prüfe ich die einschlägige Bestimmung und danach die Rechtsprechung.",
    });
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

  it("shows bounded provider-exposed reflection text in advanced mode", () => {
    const running = parseWeKnoraExecutionEvent({
      response_type: "reflection",
      content: "Die Fundstellen stimmen überein; als Nächstes prüfe ich die Ausnahme.",
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
      detail: "Die Fundstellen stimmen überein; als Nächstes prüfe ich die Ausnahme.",
    });
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

  it("shows the bounded todo_write plan together with structured counts", () => {
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
      detail: "3 Aufgaben geplant · 1 abgeschlossen · 1 in Bearbeitung · 1 offen\n- [x] Search BFG rulings regarding pendlerpauschale in English\n- [/] Compare with EStG § 16 Abs 1 Z 6\n- [ ] Formulate final recommendation",
      counts: {
        total: 3,
        completed: 1,
        inProgress: 1,
        open: 1,
      },
    });
    expect(running.step?.detail).toContain("Search BFG rulings regarding pendlerpauschale in English");
    expect(running.step?.detail).toContain("Compare with EStG § 16 Abs 1 Z 6");
    expect(running.step?.detail).toContain("Formulate final recommendation");

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
      detail: "3 Aufgaben geplant · 3 abgeschlossen\n- [x] Search BFG rulings\n- [x] Compare with EStG\n- [x] Formulate final recommendation",
      durationMs: 120,
      counts: {
        total: 3,
        completed: 3,
        inProgress: 0,
        open: 0,
      },
    });
    expect(completed.step?.detail).toContain("Search BFG rulings");
  });

  it("shows bounded search queries and result summaries while redacting sensitive fields", () => {
    const kbCall = parseWeKnoraExecutionEvent({
      response_type: "tool_call",
      data: {
        tool_call_id: "call-kb-1",
        tool_name: "knowledge_search",
        arguments: {
          query: "Pendlerpauschale Voraussetzungen 2025",
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
      detail: "Suche: Pendlerpauschale Voraussetzungen 2025",
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
      detail: "2 Treffer",
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

  it("handles thinking fallbacks, incremental merge, truncation, and redaction", () => {
    // Fallback from reasoning_content when content is absent
    const fallbackEvent = parseWeKnoraExecutionEvent({
      response_type: "thinking",
      reasoning_content: "Erster Schritt: Gesetzeslage prüfen.",
      data: { event_id: "think-fallback-1" },
    });
    expect(fallbackEvent.step?.detail).toBe("Erster Schritt: Gesetzeslage prüfen.");

    // Fallback from data.thinking.content
    const nestedFallback = parseWeKnoraExecutionEvent({
      response_type: "thinking",
      data: {
        event_id: "think-nested-1",
        thinking: { content: "Zweiter Schritt: Rechtsprechung analysieren." },
      },
    });
    expect(nestedFallback.step?.detail).toBe("Zweiter Schritt: Rechtsprechung analysieren.");

    // Incremental chunks accumulation
    const chunk1 = parseWeKnoraExecutionEvent({
      response_type: "thinking",
      content: "Teil 1 der Analyse. ",
      data: { event_id: "think-stream-1" },
    });
    const chunk2 = parseWeKnoraExecutionEvent({
      response_type: "thinking",
      content: "Teil 2 der Analyse.",
      data: { event_id: "think-stream-1" },
    });

    let steps = mergeFredExecutionStep([], chunk1.step!);
    expect(steps[0]?.detail).toBe("Teil 1 der Analyse. ");
    steps = mergeFredExecutionStep(steps, chunk2.step!);
    expect(steps[0]?.detail).toBe("Teil 1 der Analyse. Teil 2 der Analyse.");

    // Completion preserves accumulated detail
    const doneEvent = parseWeKnoraExecutionEvent({
      response_type: "thinking",
      data: { event_id: "think-stream-1", done: true },
    });
    steps = mergeFredExecutionStep(steps, doneEvent.step!);
    expect(steps[0]?.status).toBe("completed");
    expect(steps[0]?.detail).toBe("Teil 1 der Analyse. Teil 2 der Analyse.");

    // Redaction of credentials and URIs in thinking content
    const sensitiveThinking = parseWeKnoraExecutionEvent({
      response_type: "thinking",
      content: "Prüfe Token Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-ID und Pfad /var/log/app.log sowie s3://my-bucket/doc.pdf",
      data: { event_id: "think-sens-1" },
    });
    expect(sensitiveThinking.step?.detail).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(sensitiveThinking.step?.detail).not.toContain("/var/log/app.log");
    expect(sensitiveThinking.step?.detail).not.toContain("s3://my-bucket");
    expect(sensitiveThinking.step?.detail).toContain("Bearer [REDACTED]");
    expect(sensitiveThinking.step?.detail).toContain("[REDACTED_PATH]");
    expect(sensitiveThinking.step?.detail).toContain("[REDACTED_STORAGE_URI]");

    // Truncation at MAX_EXECUTION_DETAIL_CHARS
    const longContent = "A".repeat(3000);
    const longThinking = parseWeKnoraExecutionEvent({
      response_type: "thinking",
      content: longContent,
      data: { event_id: "think-long-1" },
    });
    expect(longThinking.step?.detail?.length).toBe(2000);
  });

  it("redacts real GitHub and Google token formats from reasoning and search queries", () => {
    const githubToken = "ghp_1234567890abcdefghijklmnopqrstuvwxyzAB";
    const googleToken = "AIzaSyA1234567890abcdefghijklmnopqrstuv";
    const thinking = parseWeKnoraExecutionEvent({
      response_type: "thinking",
      content: `Prüfe ${githubToken} und ${googleToken}`,
      data: { event_id: "think-token-formats" },
    });

    expect(thinking.step?.detail).not.toContain(githubToken);
    expect(thinking.step?.detail).not.toContain(googleToken);
    expect(thinking.step?.detail).toContain("[REDACTED_API_KEY]");

    for (const query of [githubToken, googleToken]) {
      const search = parseWeKnoraExecutionEvent({
        response_type: "tool_call",
        data: {
          tool_call_id: `search-${query.slice(0, 5)}`,
          tool_name: "web_search",
          arguments: { query },
        },
      });
      expect(search.step?.detail).toBeUndefined();
    }
  });

  it("handles reflection fallback content and lifecycle", () => {
    const fallbackReflection = parseWeKnoraExecutionEvent({
      response_type: "reflection",
      data: {
        event_id: "refl-fallback",
        reflection: { content: "Bewertung der Zwischenergebnisse abgeschlossen." },
      },
    });
    expect(fallbackReflection.step?.detail).toBe("Bewertung der Zwischenergebnisse abgeschlossen.");
    expect(fallbackReflection.step?.kind).toBe("evaluation");
  });

  it("handles todo JSON strings, status formatting, caps, and item redaction", () => {
    const jsonStringPayload = parseWeKnoraExecutionEvent({
      response_type: "tool_call",
      data: {
        tool_call_id: "todo-json-call",
        tool_name: "todo_write",
        arguments: JSON.stringify({
          todos: [
            { id: "1", task: "Berechne Pendlerpauschale für /home/user/tax.csv", status: "completed" },
            { id: "2", task: "Prüfe Datenbank postgres://user:pass@db.local:5432/tax", status: "in_progress" },
            { id: "3", task: "Abschlussbericht verfassen", status: "pending" },
          ],
        }),
      },
    });

    expect(jsonStringPayload.step?.counts).toEqual({
      total: 3,
      completed: 1,
      inProgress: 1,
      open: 1,
    });
    expect(jsonStringPayload.step?.detail).toContain("3 Aufgaben geplant · 1 abgeschlossen · 1 in Bearbeitung · 1 offen");
    expect(jsonStringPayload.step?.detail).toContain("- [x] Berechne Pendlerpauschale für [REDACTED_PATH]");
    expect(jsonStringPayload.step?.detail).toContain("- [/] Prüfe Datenbank [REDACTED_CONNECTION]");
    expect(jsonStringPayload.step?.detail).toContain("- [ ] Abschlussbericht verfassen");
    expect(jsonStringPayload.step?.detail).not.toContain("/home/user");
    expect(jsonStringPayload.step?.detail).not.toContain("postgres://");

    // Caps item count and individual task lengths
    const manyTodos = Array.from({ length: 70 }, (_, i) => ({
      id: String(i),
      task: `Aufgabe ${i}: ${"X".repeat(300)}`,
      status: "pending",
    }));
    const cappedPayload = parseWeKnoraExecutionEvent({
      response_type: "tool_call",
      data: {
        tool_call_id: "todo-capped",
        tool_name: "todo_write",
        arguments: { todos: manyTodos },
      },
    });
    const lines = cappedPayload.step?.detail?.split("\n") ?? [];
    // 1 summary line + at most 50 item lines, still bounded by the per-step storage limit.
    expect(lines.length).toBeLessThanOrEqual(51);
    expect(cappedPayload.step?.detail?.length).toBeLessThanOrEqual(2000);
  });

  it("handles known search queries, result summaries, and suppresses raw payloads", () => {
    // Web search call with clean query
    const webCall = parseWeKnoraExecutionEvent({
      response_type: "tool_call",
      data: {
        tool_call_id: "web-search-1",
        tool_name: "web_search",
        arguments: { query: "Pendlerrechner BMF 2025" },
      },
    });
    expect(webCall.step?.detail).toBe("Suche: Pendlerrechner BMF 2025");

    // Web search result with result count
    const webResult = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "web-search-1",
        tool_name: "web_search",
        success: true,
        duration_ms: 250,
        result: {
          results: [
            { title: "BMF Pendlerrechner", url: "https://bmf.gv.at", snippet: "Raw snippet" },
            { title: "WKO Pendlerpauschale", url: "https://wko.at", snippet: "Raw snippet 2" },
            { title: "Arbeiterkammer Infos", url: "https://ak.at", snippet: "Raw snippet 3" },
          ],
        },
      },
    });
    expect(webResult.step?.detail).toBe("3 Treffer");
    expect(webResult.step?.durationMs).toBe(250);
    expect(JSON.stringify(webResult)).not.toContain("Raw snippet");

    // Single result
    const singleResult = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "web-search-2",
        tool_name: "web_search",
        success: true,
        result: { results: [{ title: "Item" }] },
      },
    });
    expect(singleResult.step?.detail).toBe("1 Treffer");
  });

  it("handles malformed and oversized payloads gracefully", () => {
    expect(parseWeKnoraExecutionEvent(null).step).toBeUndefined();
    expect(parseWeKnoraExecutionEvent(123).step).toBeUndefined();
    expect(parseWeKnoraExecutionEvent("string").step).toBeUndefined();
    expect(parseWeKnoraExecutionEvent({}).step).toBeUndefined();

    // Oversized string in arguments (> 100,000 chars)
    const giantPayload = parseWeKnoraExecutionEvent({
      response_type: "tool_call",
      data: {
        tool_call_id: "giant-call",
        tool_name: "todo_write",
        arguments: "X".repeat(150_000),
      },
    });
    expect(giantPayload.step?.counts).toBeUndefined();
    expect(giantPayload.step?.detail).toBeUndefined();
  });

  it("preserves sanitized multiline details in stored trace parser", () => {
    const multilineDetail = "3 Aufgaben geplant · 1 abgeschlossen\n- [x] Recherche BFG\n- [ ] Analyse EStG § 16";
    const stored = [
      {
        id: "step-multi",
        kind: "planning",
        status: "completed",
        label: "Rechercheplan aktualisiert",
        detail: multilineDetail,
        durationMs: 200,
        counts: { total: 3, completed: 1, inProgress: 0, open: 2 },
      },
    ];

    const parsed = parseStoredFredExecutionTrace(stored);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.detail).toBe(multilineDetail);
    expect(parsed[0]?.detail).toContain("\n- [x] Recherche BFG");
  });

  // Explicit regressions test
  it("regression: ensures credentials, storage URIs, paths, and unknown-tool details are strictly absent while preserving sanitized text", () => {
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
    expect(serializedResults).toContain("CONFIDENTIAL_TASK");
    expect(serializedResults).not.toContain("gs://finance-bucket");
    expect(serializedResults).toContain("[REDACTED_STORAGE_URI]");
    expect(serializedResults).not.toContain("TOP_SECRET_PASSWORD");
    expect(serializedResults).not.toContain("auth.internal.corp");
    expect(serializedResults).not.toContain("custom_fetch");
  });
});
