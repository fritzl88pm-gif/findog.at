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
      detail: "Parameter: code: import os; print(os.environ)",
    });
    expect(JSON.stringify(unknownCall)).not.toContain("run_arbitrary_python_script");

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
    expect(longThinking.step?.detail?.length).toBe(2000 + "\n…[gekürzt]".length);
    expect(longThinking.step?.detail?.endsWith("\n…[gekürzt]")).toBe(true);
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

  it("parses native WeKnora todo_write envelopes with direct data.steps and data.task", () => {
    const nativeCall = parseWeKnoraExecutionEvent({
      response_type: "tool_call",
      data: {
        tool_call_id: "native-todo-call-99",
        tool_name: "todo_write",
        arguments: {
          task: "Prüfung der Pendlerpauschale",
          steps: [
            { task: "Gesetzeslage in § 16 EStG analysieren", status: "completed" },
            { task: "VwGH-Rechtsprechung recherchieren", status: "in_progress" },
            { task: "Zusammenfassung formulieren", status: "pending" },
          ],
        },
      },
    });

    expect(nativeCall.step).toEqual({
      id: expect.stringMatching(/^planning:[a-z0-9]+$/u),
      kind: "planning",
      status: "running",
      label: "Rechercheplan wird aktualisiert",
      detail: "Aktuelle Aufgabe: Prüfung der Pendlerpauschale\n3 Aufgaben geplant · 1 abgeschlossen · 1 in Bearbeitung · 1 offen\n- [x] Gesetzeslage in § 16 EStG analysieren\n- [/] VwGH-Rechtsprechung recherchieren\n- [ ] Zusammenfassung formulieren",
      counts: {
        total: 3,
        completed: 1,
        inProgress: 1,
        open: 1,
      },
    });

    // Native tool_result with direct data.steps and data.task
    const nativeResult = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "native-todo-call-99",
        tool_name: "todo_write",
        success: true,
        duration_ms: 180,
        task: "Prüfung der Pendlerpauschale",
        steps: [
          { task: "Gesetzeslage in § 16 EStG analysieren", status: "completed" },
          { task: "VwGH-Rechtsprechung recherchieren", status: "completed" },
          { task: "Zusammenfassung formulieren", status: "completed" },
        ],
      },
    });

    expect(nativeResult.step).toEqual({
      id: nativeCall.step?.id,
      kind: "planning",
      status: "completed",
      label: "Rechercheplan aktualisiert",
      detail: "Aktuelle Aufgabe: Prüfung der Pendlerpauschale\n3 Aufgaben geplant · 3 abgeschlossen\n- [x] Gesetzeslage in § 16 EStG analysieren\n- [x] VwGH-Rechtsprechung recherchieren\n- [x] Zusammenfassung formulieren",
      durationMs: 180,
      counts: {
        total: 3,
        completed: 3,
        inProgress: 0,
        open: 0,
      },
    });

    let merged = mergeFredExecutionStep([], nativeCall.step!);
    merged = mergeFredExecutionStep(merged, nativeResult.step!);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(nativeResult.step);
  });

  it("parses native thinking tool as analysis with thought progress, redactions, and merge", () => {
    const thinkCall = parseWeKnoraExecutionEvent({
      response_type: "tool_call",
      data: {
        tool_call_id: "think-call-42",
        tool_name: "thinking",
        arguments: {
          thought: "Analysiere Voraussetzungen nach EStG § 16",
          thought_number: 1,
          total_thoughts: 3,
        },
      },
    });

    expect(thinkCall.step).toEqual({
      id: expect.stringMatching(/^analysis:[a-z0-9]+$/u),
      kind: "analysis",
      status: "running",
      label: "Anfrage wird analysiert (1/3)",
    });

    const thinkResult = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "think-call-42",
        tool_name: "thinking",
        thought: "Analysiere Voraussetzungen nach EStG § 16. Keine Ausnahme ersichtlich.",
        thought_number: 1,
        total_thoughts: 3,
        duration_ms: 320,
        success: true,
      },
    });

    expect(thinkResult.step).toEqual({
      id: thinkCall.step?.id,
      kind: "analysis",
      status: "completed",
      label: "Anfrage analysiert (1/3)",
      detail: "Analysiere Voraussetzungen nach EStG § 16. Keine Ausnahme ersichtlich.",
      durationMs: 320,
    });

    let merged = mergeFredExecutionStep([], thinkCall.step!);
    merged = mergeFredExecutionStep(merged, thinkResult.step!);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(thinkResult.step);
  });

  it("parses native direct result shapes for retrieval tools (data.results, data.chunk_results, data.total_matches, etc.)", () => {
    // 1. Direct data.results on knowledge_search
    const directResults = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "kb-direct-1",
        tool_name: "search_knowledge",
        success: true,
        duration_ms: 150,
        results: [
          { document_id: "doc-123", chunk_id: "chk-456", text: "Raw confidential chunk text" },
          { document_id: "doc-124", chunk_id: "chk-457", text: "Another chunk text" },
        ],
      },
    });

    expect(directResults.step).toEqual({
      id: expect.stringMatching(/^knowledge:[a-z0-9]+$/u),
      kind: "knowledge",
      status: "completed",
      label: "Wissensbasis durchsucht",
      detail: "2 Treffer",
      durationMs: 150,
    });
    expect(JSON.stringify(directResults)).not.toContain("Raw confidential");
    expect(JSON.stringify(directResults)).not.toContain("chk-456");
    expect(JSON.stringify(directResults)).not.toContain("doc-123");

    // 2. Direct data.total_matches and data.chunk_results on grep_chunks
    const grepResult = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "grep-1",
        tool_name: "grep_chunks",
        success: true,
        duration_ms: 220,
        total_matches: 7,
        chunk_results: [
          { chunk_id: "c1", matches: ["match 1", "match 2"] },
        ],
      },
    });

    expect(grepResult.step).toEqual({
      id: expect.stringMatching(/^knowledge:[a-z0-9]+$/u),
      kind: "knowledge",
      status: "completed",
      label: "Wissensbasis durchsucht",
      detail: "7 Treffer",
      durationMs: 220,
    });

    // 3. Direct data.knowledge_results
    const kbResults = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "kb-res-1",
        tool_name: "knowledge_search",
        success: true,
        knowledge_results: [{ id: "k1" }, { id: "k2" }, { id: "k3" }],
      },
    });
    expect(kbResults.step?.detail).toBe("3 Treffer");

    // 4. Direct data.chunks on list_knowledge_chunks
    const chunksResult = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "chunks-1",
        tool_name: "list_knowledge_chunks",
        success: true,
        chunks: [{ id: "ch1" }],
      },
    });
    expect(chunksResult.step?.detail).toBe("1 Treffer");

    // 5. Direct data.result_count
    const resultCountRes = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "count-1",
        tool_name: "web_search",
        success: true,
        result_count: 5,
      },
    });
    expect(resultCountRes.step?.detail).toBe("5 Treffer");

    // 6. Zero results with direct count 0
    const zeroResults = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "zero-1",
        tool_name: "knowledge_search",
        success: true,
        total_matches: 0,
      },
    });
    expect(zeroResults.step?.detail).toBe("0 Treffer");
  });

  it("preserves provider thinking and reflection lifecycle and parses completion duration_ms", () => {
    // 1. Streaming thinking chunks
    const chunk1 = parseWeKnoraExecutionEvent({
      response_type: "thinking",
      content: "Erster Gedanke: ",
      data: {
        event_id: "think-lifecycle-1",
      },
    });

    const chunk2 = parseWeKnoraExecutionEvent({
      response_type: "thinking",
      content: "Zweiter Gedanke.",
      data: {
        event_id: "think-lifecycle-1",
      },
    });

    let steps = mergeFredExecutionStep([], chunk1.step!);
    steps = mergeFredExecutionStep(steps, chunk2.step!);
    expect(steps[0]?.detail).toBe("Erster Gedanke: Zweiter Gedanke.");
    expect(steps[0]?.status).toBe("running");

    // Native completion event with duration_ms and no text content
    const thinkDone = parseWeKnoraExecutionEvent({
      response_type: "thinking",
      done: true,
      data: {
        event_id: "think-lifecycle-1",
        done: true,
        duration_ms: 1450,
      },
    });

    expect(thinkDone.step).toEqual({
      id: chunk1.step?.id,
      kind: "analysis",
      status: "completed",
      label: "Anfrage analysiert",
      durationMs: 1450,
    });

    steps = mergeFredExecutionStep(steps, thinkDone.step!);
    expect(steps[0]).toEqual({
      id: chunk1.step?.id,
      kind: "analysis",
      status: "completed",
      label: "Anfrage analysiert",
      detail: "Erster Gedanke: Zweiter Gedanke.",
      durationMs: 1450,
    });

    // 2. Reflection completion with duration_ms
    const reflectionDone = parseWeKnoraExecutionEvent({
      response_type: "reflection",
      data: {
        event_id: "refl-lifecycle-1",
        done: true,
        duration_ms: 680,
      },
    });

    expect(reflectionDone.step).toEqual({
      id: expect.stringMatching(/^evaluation:[a-z0-9]+$/u),
      kind: "evaluation",
      status: "completed",
      label: "Rechercheergebnisse bewertet",
      durationMs: 680,
    });
  });

  it("ensures secrets and raw payloads are absent from native thinking tool and direct result envelopes", () => {
    const sensitiveThinkingTool = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "think-secret-1",
        tool_name: "thinking",
        thought: "Verwende sk_live_1234567890abcdef und internen Pfad /etc/secrets/key.pem",
        duration_ms: 100,
        success: true,
      },
    });

    expect(sensitiveThinkingTool.step?.detail).not.toContain("sk_live_1234567890abcdef");
    expect(sensitiveThinkingTool.step?.detail).not.toContain("/etc/secrets");
    expect(sensitiveThinkingTool.step?.detail).toContain("[REDACTED_API_KEY]");
    expect(sensitiveThinkingTool.step?.detail).toContain("[REDACTED_PATH]");

    const sensitiveKbResult = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "kb-secret-1",
        tool_name: "search_knowledge",
        results: [
          { secret_content: "super-secret", raw_tokens: [1, 2, 3] },
        ],
        success: true,
      },
    });

    expect(sensitiveKbResult.step?.detail).toBe("1 Treffer");
    expect(JSON.stringify(sensitiveKbResult)).not.toContain("super-secret");
    expect(JSON.stringify(sensitiveKbResult)).not.toContain("raw_tokens");
  });

  it("strictly restricts thinking-tool detail to data.thought or data.output and rejects reasoning, content, or nested results", () => {
    // 1. data.reasoning must NOT be exposed
    const reasoningEvent = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "think-reasoning-1",
        tool_name: "thinking",
        reasoning: "private reasoning not shown natively",
        success: true,
      },
    });
    expect(reasoningEvent.step?.detail).toBeUndefined();

    // 2. nested result.content must NOT be exposed
    const nestedContentEvent = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "think-nested-1",
        tool_name: "thinking",
        result: {
          content: "nested arbitrary content not shown natively",
        },
        success: true,
      },
    });
    expect(nestedContentEvent.step?.detail).toBeUndefined();

    // 3. pending tool_call arguments must NOT be exposed as detail
    const pendingCall = parseWeKnoraExecutionEvent({
      response_type: "tool_call",
      data: {
        tool_call_id: "think-pending-1",
        tool_name: "thinking",
        arguments: {
          thought: "pending argument thought should not be exposed",
          reasoning: "pending argument reasoning",
        },
      },
    });
    expect(pendingCall.step?.detail).toBeUndefined();

    // 4. direct data.thought IS exposed
    const validThought = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "think-valid-1",
        tool_name: "thinking",
        thought: "Gültiger Analyseschritt für den Benutzer sichtbar",
        success: true,
      },
    });
    expect(validThought.step?.detail).toBe("Gültiger Analyseschritt für den Benutzer sichtbar");

    // 5. direct data.output IS exposed
    const validOutput = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "think-output-1",
        tool_name: "thinking",
        output: "Gültige Ausgabe des Analyse-Tools",
        success: true,
      },
    });
    expect(validOutput.step?.detail).toBe("Gültige Ausgabe des Analyse-Tools");
  });

  it("prioritizes results array length over numeric count when both exist ({count:5, results:[2]} => 2 Treffer)", () => {
    const conflictResult = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "web-conflict-1",
        tool_name: "web_search",
        count: 5,
        results: [
          { url: "https://example.com/1", title: "Result 1" },
          { url: "https://example.com/2", title: "Result 2" },
        ],
        success: true,
      },
    });

    expect(conflictResult.step?.detail).toBe("2 Treffer");
  });

  it("rejects or clamps huge thought numbers and bounds generated labels to MAX_EXECUTION_LABEL_CHARS", () => {
    const hugeNumberEvent = parseWeKnoraExecutionEvent({
      response_type: "tool_call",
      data: {
        tool_call_id: "think-huge-1",
        tool_name: "thinking",
        thought_number: 999999999999999,
        total_thoughts: 999999999999999,
      },
    });

    expect(hugeNumberEvent.step?.label).toBe("Anfrage wird analysiert");
    expect(hugeNumberEvent.step?.label.length).toBeLessThanOrEqual(200);

    const normalProgress = parseWeKnoraExecutionEvent({
      response_type: "tool_call",
      data: {
        tool_call_id: "think-progress-1",
        tool_name: "thinking",
        thought_number: 2,
        total_thoughts: 5,
      },
    });

    expect(normalProgress.step?.label).toBe("Anfrage wird analysiert (2/5)");
  });

  it("formats list_knowledge_chunks summary with German chunk range and paging", () => {
    const listResultWithPaging = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "list-kc-1",
        tool_name: "list_knowledge_chunks",
        fetched_chunks: 5,
        total_chunks: 12,
        page: 1,
        page_size: 5,
        chunks: [{ chunk_id: "c1" }, { chunk_id: "c2" }],
        success: true,
      },
    });

    expect(listResultWithPaging.step?.detail).toBe("5 von 12 Abschnitten geladen · Seite 1");

    const listResultNoPaging = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "list-kc-2",
        tool_name: "list_knowledge_chunks",
        fetched_chunks: 3,
        total_chunks: 3,
        chunks: [{ chunk_id: "c1" }],
        success: true,
      },
    });

    expect(listResultNoPaging.step?.detail).toBe("3 von 3 Abschnitten geladen");

    const listResultFallback = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "list-kc-3",
        tool_name: "list_knowledge_chunks",
        chunks: [{ chunk_id: "c1" }, { chunk_id: "c2" }],
        success: true,
      },
    });

    expect(listResultFallback.step?.detail).toBe("2 Treffer");
  });

  it("merges and deduplicates consecutive thinking and thinking-tool events", () => {
    // 1. Equal / contained content deduplication
    const sseThink = parseWeKnoraExecutionEvent({
      response_type: "thinking",
      content: "Analyse der Rechtslage nach EStG § 16.",
      done: true,
      data: { event_id: "think-sse-1" },
    });

    const toolThinkSame = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "think-tool-call-1",
        tool_name: "thinking",
        thought: "Analyse der Rechtslage nach EStG § 16.",
        success: true,
      },
    });

    let steps: FredExecutionStep[] = [];
    steps = mergeFredExecutionStep(steps, sseThink.step!);
    expect(steps).toHaveLength(1);

    // Consecutive tool thinking with same content merges into the single analysis step
    steps = mergeFredExecutionStep(steps, toolThinkSame.step!);
    expect(steps).toHaveLength(1);
    expect(steps[0].detail).toBe("Analyse der Rechtslage nach EStG § 16.");

    // 2. Contained content replacement
    const toolThinkExpanded = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "think-tool-call-2",
        tool_name: "thinking",
        thought: "Analyse der Rechtslage nach EStG § 16. Ergänzung: Prüfung der Ausnahmetatbestände.",
        success: true,
      },
    });

    steps = mergeFredExecutionStep(steps, toolThinkExpanded.step!);
    expect(steps).toHaveLength(1);
    expect(steps[0].detail).toBe("Analyse der Rechtslage nach EStG § 16. Ergänzung: Prüfung der Ausnahmetatbestände.");

    // 3. Non-overlapping content combining
    const toolThinkAdditional = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "think-tool-call-3",
        tool_name: "thinking",
        thought: "Zusätzliche Betrachtung der Judikatur des VwGH.",
        success: true,
      },
    });

    steps = mergeFredExecutionStep(steps, toolThinkAdditional.step!);
    expect(steps).toHaveLength(1);
    expect(steps[0].detail).toBe("Analyse der Rechtslage nach EStG § 16. Ergänzung: Prüfung der Ausnahmetatbestände.\n\nZusätzliche Betrachtung der Judikatur des VwGH.");
  });

  it("does not merge thinking events across an intervening non-analysis step", () => {
    const think1 = parseWeKnoraExecutionEvent({
      response_type: "thinking",
      content: "Erster Analyseschritt",
      done: true,
      data: { event_id: "think-first" },
    });

    const planStep = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "plan-1",
        tool_name: "todo_write",
        task: "Hauptaufgabe",
        steps: [{ task: "Schritt 1", status: "completed" }],
        success: true,
      },
    });

    const think2 = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "think-second",
        tool_name: "thinking",
        thought: "Zweiter Analyseschritt nach Planung",
        success: true,
      },
    });

    let steps: FredExecutionStep[] = [];
    steps = mergeFredExecutionStep(steps, think1.step!);
    expect(steps).toHaveLength(1);

    steps = mergeFredExecutionStep(steps, planStep.step!);
    expect(steps).toHaveLength(2);
    expect(steps[1].kind).toBe("planning");

    // think2 is separated from think1 by planStep, so it must NOT merge into think1
    steps = mergeFredExecutionStep(steps, think2.step!);
    expect(steps).toHaveLength(3);
    expect(steps[0].kind).toBe("analysis");
    expect(steps[0].detail).toBe("Erster Analyseschritt");
    expect(steps[1].kind).toBe("planning");
    expect(steps[2].kind).toBe("analysis");
    expect(steps[2].detail).toBe("Zweiter Analyseschritt nach Planung");
  });

  it("handles adjacent analysis merge lifecycle: completed -> running -> completed and failed -> running -> completed", () => {
    const think1Running = parseWeKnoraExecutionEvent({
      response_type: "tool_call",
      data: {
        tool_call_id: "think-1",
        tool_name: "thinking",
      },
    });
    const think1Done = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "think-1",
        tool_name: "thinking",
        thought: "Erste Analyse abgeschlossen.",
        success: true,
      },
    });

    let steps = mergeFredExecutionStep([], think1Running.step!);
    expect(steps).toHaveLength(1);
    expect(steps[0].status).toBe("running");

    steps = mergeFredExecutionStep(steps, think1Done.step!);
    expect(steps).toHaveLength(1);
    expect(steps[0].status).toBe("completed");
    expect(steps[0].label).toBe("Anfrage analysiert");

    // Second distinct analysis step immediately following completed first step
    const think2Running = parseWeKnoraExecutionEvent({
      response_type: "tool_call",
      data: {
        tool_call_id: "think-2",
        tool_name: "thinking",
      },
    });
    steps = mergeFredExecutionStep(steps, think2Running.step!);
    expect(steps).toHaveLength(1);
    expect(steps[0].status).toBe("running");
    expect(steps[0].label).toBe("Anfrage wird analysiert");

    // Second analysis step completes
    const think2Done = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "think-2",
        tool_name: "thinking",
        thought: "Zweite Analyse abgeschlossen.",
        success: true,
      },
    });
    steps = mergeFredExecutionStep(steps, think2Done.step!);
    expect(steps).toHaveLength(1);
    expect(steps[0].status).toBe("completed");
    expect(steps[0].label).toBe("Anfrage analysiert");

    // Failed analysis followed by new running analysis
    const think3Failed = parseWeKnoraExecutionEvent({
      response_type: "error",
      data: {
        tool_call_id: "think-3",
        tool_name: "thinking",
        success: false,
      },
    });
    let failedSteps = mergeFredExecutionStep([], think3Failed.step!);
    expect(failedSteps[0].status).toBe("failed");

    const think4Running = parseWeKnoraExecutionEvent({
      response_type: "tool_call",
      data: {
        tool_call_id: "think-4",
        tool_name: "thinking",
      },
    });
    failedSteps = mergeFredExecutionStep(failedSteps, think4Running.step!);
    expect(failedSteps).toHaveLength(1);
    expect(failedSteps[0].status).toBe("running");
  });

  it("redacts IPv6, trailing-dot internal URLs, and sensitive query keys in provider thinking while preserving German text and safe public URLs", () => {
    const rawThinking = [
      "Prüfe IPv6-URL http://[::1]/internal und http://[fe80::1]/service für interne Konfiguration.",
      "Prüfe trailing-dot URL http://localhost.:8080/admin sowie http://metadata.google.internal./computeMetadata.",
      "Prüfe API-Zugriff über https://example.com/oauth?accessToken=secret_tok_123.",
      "Prüfe Client-Secret über https://example.com/api?clientSecret=my_secret_key&page=1.",
      "Prüfe Nested-Auth über https://example.com/auth?auth[token]=nested_val.",
      "Sichere öffentliche Quelle: https://ris.bka.gv.at/Dokument.wxe?id=123.",
      "Die Pendlerpauschale steht Arbeitnehmern unter den Voraussetzungen des § 16 EStG 1988 zu.",
    ].join("\n");

    const thinkingEvent = parseWeKnoraExecutionEvent({
      response_type: "thinking",
      content: rawThinking,
      data: { event_id: "think-security-consolidated" },
    });

    const detail = thinkingEvent.step?.detail;
    expect(detail).toBeDefined();

    // Sensitive / internal URLs must be replaced with [REDACTED_URL]
    expect(detail).not.toContain("http://[::1]");
    expect(detail).not.toContain("http://[fe80::1]");
    expect(detail).not.toContain("http://localhost.");
    expect(detail).not.toContain("http://metadata.google.internal.");
    expect(detail).not.toContain("accessToken=");
    expect(detail).not.toContain("clientSecret=");
    expect(detail).not.toContain("auth[token]=");
    expect(detail).not.toContain("secret_tok_123");
    expect(detail).not.toContain("my_secret_key");
    expect(detail).not.toContain("nested_val");

    // Redacted markers present
    expect(detail).toContain("[REDACTED_URL]");

    // Safe public URL preserved
    expect(detail).toContain("https://ris.bka.gv.at/Dokument.wxe?id=123");

    // German text preserved
    expect(detail).toContain("Die Pendlerpauschale steht Arbeitnehmern unter den Voraussetzungen des § 16 EStG 1988 zu.");
  });

  it("redacts / suppresses search query details containing IPv6, trailing-dot internal URLs, or sensitive query keys while preserving German query and safe public URL", () => {
    // 1. IPv6 localhost / private URLs in query
    const ipv6Query = parseWeKnoraExecutionEvent({
      response_type: "tool_call",
      data: {
        tool_call_id: "search-ipv6",
        tool_name: "web_search",
        arguments: { query: "http://[::1]/api/v1" },
      },
    });
    expect(ipv6Query.step?.detail).toBeUndefined();

    // 2. Trailing-dot internal URL in query
    const trailingDotQuery = parseWeKnoraExecutionEvent({
      response_type: "tool_call",
      data: {
        tool_call_id: "search-trailing-dot",
        tool_name: "web_search",
        arguments: { query: "http://service.local./search?q=test" },
      },
    });
    expect(trailingDotQuery.step?.detail).toBeUndefined();

    // 3. Sensitive query parameters in URL query
    for (const url of [
      "https://example.com/oauth?accessToken=sec123",
      "https://example.com/api?clientSecret=sec456",
      "https://example.com/auth?auth[token]=sec789",
    ]) {
      const sensitiveQuery = parseWeKnoraExecutionEvent({
        response_type: "tool_call",
        data: {
          tool_call_id: "search-sensitive",
          tool_name: "web_search",
          arguments: { query: url },
        },
      });
      expect(sensitiveQuery.step?.detail).toBeUndefined();
    }

    // 4. Safe German search query preserved
    const germanQuery = parseWeKnoraExecutionEvent({
      response_type: "tool_call",
      data: {
        tool_call_id: "search-german",
        tool_name: "web_search",
        arguments: { query: "Pendlerpauschale Voraussetzungen 2025" },
      },
    });
    expect(germanQuery.step?.detail).toBe("Suche: Pendlerpauschale Voraussetzungen 2025");

    // 5. Safe public URL search query preserved
    const safeUrlQuery = parseWeKnoraExecutionEvent({
      response_type: "tool_call",
      data: {
        tool_call_id: "search-safe-url",
        tool_name: "web_search",
        arguments: { query: "https://ris.bka.gv.at/Dokument.wxe?id=123" },
      },
    });
    expect(safeUrlQuery.step?.detail).toBe("Suche: https://ris.bka.gv.at/Dokument.wxe?id=123");
  });

  it("Task 1: surfaces agent_query as initial trace step only when assistant_message_id is present", () => {
    const withId = parseWeKnoraExecutionEvent({
      response_type: "agent_query",
      assistant_message_id: "m1",
    });

    expect(withId.step).toEqual({
      id: expect.stringMatching(/^analysis:[a-z0-9]+$/u),
      kind: "analysis",
      status: "completed",
      label: "Anfrage an Fred übermittelt",
    });

    const withoutId = parseWeKnoraExecutionEvent({
      response_type: "agent_query",
    });
    expect(withoutId.step).toBeUndefined();

    const emptyId = parseWeKnoraExecutionEvent({
      response_type: "agent_query",
      assistant_message_id: "   ",
    });
    expect(emptyId.step).toBeUndefined();

    const nonStringId = parseWeKnoraExecutionEvent({
      response_type: "agent_query",
      assistant_message_id: 12345,
    });
    expect(nonStringId.step).toBeUndefined();
  });

  describe("Task 2: formatSafeToolArguments for generic tools in tool_call", () => {
    it("formats object arguments with scalar values and ellipsis for nested objects", () => {
      const call = parseWeKnoraExecutionEvent({
        response_type: "tool_call",
        data: {
          tool_call_id: "calc-1",
          tool_name: "calculate_tax",
          arguments: {
            year: 2024,
            category: "pendler",
            include_details: true,
            extra_options: { debug: false },
            nested_list: [1, 2, 3],
          },
        },
      });

      expect(call.step).toEqual({
        id: expect.stringMatching(/^tool:[a-z0-9]+$/u),
        kind: "tool",
        status: "running",
        label: "Recherchewerkzeug wird ausgeführt",
        detail: "Parameter: year: 2024; category: pendler; include_details: true; extra_options: …; nested_list: …",
      });
    });

    it("formats JSON-string arguments safely", () => {
      const call = parseWeKnoraExecutionEvent({
        response_type: "tool_call",
        data: {
          tool_call_id: "custom-json-1",
          tool_name: "custom_analyzer",
          arguments: JSON.stringify({ section: "§ 16 EStG", active: true }),
        },
      });

      expect(call.step?.detail).toBe("Parameter: section: § 16 EStG; active: true");
    });

    it("drops detail entirely when credentials / sensitive keys (e.g. api_key) are present", () => {
      const callWithApiKey = parseWeKnoraExecutionEvent({
        response_type: "tool_call",
        data: {
          tool_call_id: "sec-tool-1",
          tool_name: "external_service",
          arguments: {
            api_key: "sk-proj-super-secret-12345678",
            query: "tax info",
          },
        },
      });

      expect(callWithApiKey.step?.detail).toBeUndefined();

      const callWithSecretAssignment = parseWeKnoraExecutionEvent({
        response_type: "tool_call",
        data: {
          tool_call_id: "sec-tool-2",
          tool_name: "external_service",
          arguments: {
            password: "supersecretpassword",
            mode: "fast",
          },
        },
      });

      expect(callWithSecretAssignment.step?.detail).toBeUndefined();
    });

    it("truncates arguments detail longer than 300 chars", () => {
      const longText = "A".repeat(500);
      const call = parseWeKnoraExecutionEvent({
        response_type: "tool_call",
        data: {
          tool_call_id: "long-args-1",
          tool_name: "external_service",
          arguments: {
            description: longText,
          },
        },
      });

      expect(call.step?.detail).toBeDefined();
      expect(call.step?.detail?.startsWith("Parameter: description: ")).toBe(true);
      expect(call.step?.detail?.length).toBeLessThanOrEqual(315);
    });
  });

  describe("Task 3: extractGenericResultSummary for generic tools in tool_result", () => {
    it("extracts item names from results array (up to 3 items)", () => {
      const res = parseWeKnoraExecutionEvent({
        response_type: "tool_result",
        data: {
          tool_call_id: "tool-res-1",
          tool_name: "custom_analyzer",
          success: true,
          result: {
            results: [
              { name: "Bericht 2023" },
              { name: "Bericht 2024" },
              { name: "Bericht 2025" },
              { name: "Bericht 2026 (übersprungen)" },
            ],
          },
        },
      });

      expect(res.step).toEqual({
        id: expect.stringMatching(/^tool:[a-z0-9]+$/u),
        kind: "tool",
        status: "completed",
        label: "Recherchewerkzeug ausgeführt",
        detail: "Ergebnis: Bericht 2023; Bericht 2024; Bericht 2025",
      });
    });

    it("extracts scalar summary fields in order (status, ok, error, result_count, total, count)", () => {
      const res = parseWeKnoraExecutionEvent({
        response_type: "tool_result",
        data: {
          tool_call_id: "tool-res-2",
          tool_name: "custom_fetcher",
          success: true,
          result: {
            count: 5,
            status: "ready",
            total: 10,
            ok: true,
            ignore_me: "not in summary list",
          },
        },
      });

      expect(res.step?.detail).toBe("Ergebnis: status: ready; ok: true; total: 10; count: 5");
    });

    it("extracts error field from result object when present in successful response", () => {
      const res = parseWeKnoraExecutionEvent({
        response_type: "tool_result",
        data: {
          tool_call_id: "tool-res-3",
          tool_name: "custom_fetcher",
          success: true,
          result: {
            error: "Teilweise fehlgeschlagen",
            count: 0,
          },
        },
      });

      expect(res.step?.detail).toBe("Ergebnis: error: Teilweise fehlgeschlagen; count: 0");
    });

    it("parses JSON-string result payloads", () => {
      const res = parseWeKnoraExecutionEvent({
        response_type: "tool_result",
        data: {
          tool_call_id: "tool-res-json",
          tool_name: "custom_fetcher",
          success: true,
          result: JSON.stringify({
            status: "success",
            items: [{ title: "Item 1" }, { title: "Item 2" }],
          }),
        },
      });

      expect(res.step?.detail).toBe("Ergebnis: status: success; Item 1; Item 2");
    });

    it("drops detail when result contains credentials or sensitive data", () => {
      const res = parseWeKnoraExecutionEvent({
        response_type: "tool_result",
        data: {
          tool_call_id: "tool-res-sec",
          tool_name: "custom_fetcher",
          success: true,
          result: {
            status: "sk-proj-super-secret-key",
          },
        },
      });

      expect(res.step?.detail).toBeUndefined();

      const resInternalUrl = parseWeKnoraExecutionEvent({
        response_type: "tool_result",
        data: {
          tool_call_id: "tool-res-sec-url",
          tool_name: "custom_fetcher",
          success: true,
          result: {
            items: [{ name: "http://db.internal.corp/table" }],
          },
        },
      });

      expect(resInternalUrl.step?.detail).toBeUndefined();
    });
  });

  describe("Task 4: reference detail step on response_type references", () => {
    it("formats mixed web and knowledge references into multiline detail with short kb ids", () => {
      const refEvent = parseWeKnoraExecutionEvent({
        response_type: "references",
        data: {
          event_id: "ref-step-1",
          references: [
            { kind: "web", url: "https://ris.bka.gv.at/Dokument.wxe?id=123", title: "RIS Judikatur" },
            { kind: "web", url: "https://findok.bmf.gv.at/findok" },
            { kind: "knowledge", doc: "EStG § 16 Pendlerpauschale", knowledge_base_id: "kb-12345678-abcd" },
            { kind: "knowledge", doc: "BFG Richtlinien" },
          ],
        },
      });

      expect(refEvent.step).toEqual({
        id: expect.stringMatching(/^sources:[a-z0-9]+$/u),
        kind: "sources",
        status: "completed",
        label: "4 Quellen gefunden",
        detail: "RIS Judikatur (ris.bka.gv.at)\nfindok.bmf.gv.at\nEStG § 16 Pendlerpauschale (kb-12345)\nBFG Richtlinien",
      });
    });

    it("caps references detail to at most 10 lines when 12 references are present", () => {
      const twelveReferences = Array.from({ length: 12 }, (_, i) => ({
        kind: "knowledge",
        doc: `Dokument Nr. ${i + 1}`,
        knowledge_base_id: `kb-base-${i + 1}`,
      }));

      const refEvent = parseWeKnoraExecutionEvent({
        response_type: "references",
        data: {
          event_id: "ref-step-12",
          references: twelveReferences,
        },
      });

      expect(refEvent.step?.label).toBe("12 Quellen gefunden");
      expect(refEvent.step?.detail).toBeDefined();
      const lines = refEvent.step?.detail?.split("\n") ?? [];
      expect(lines).toHaveLength(10);
      expect(lines[0]).toBe("Dokument Nr. 1 (kb-base-)");
      expect(lines[9]).toBe("Dokument Nr. 10 (kb-base-)");
    });
  });
});