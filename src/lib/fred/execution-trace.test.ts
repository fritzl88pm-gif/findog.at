import { describe, expect, it } from "vitest";

import {
  mergeFredExecutionStep,
  mergeFredExecutionUpdate,
  parseStoredFredExecutionTrace,
  parseWeKnoraExecutionEvent,
  EXECUTION_CUT_MARKER,
  MAX_EXECUTION_COMMAND_CHARS,
  MAX_EXECUTION_OUTPUT_CHARS,
  EXECUTION_PHASE_STEP_ID,
  finalizeExecutionTrace,
  sanitizeStoredExecutionTrace,
  type FredExecutionStep,
  type FredExecutionUpdate,
} from "./execution-trace";

/** Detail-summary policy tests inspect the step without the (intentionally full) advanced payload fields. */
function withoutPayload(update: FredExecutionUpdate): FredExecutionUpdate {
  if (!update.step) return update;
  const step = { ...update.step };
  for (const key of ["callId", "toolName", "queries", "sources", "facts", "refs", "output", "command"] as const) delete step[key];
  return { ...update, step };
}

describe("WeKnora execution trace projection and parser", () => {


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

    expect(running.step).toMatchObject({
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

    expect(completed.step).toMatchObject({
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

    expect(kbCall.step).toMatchObject({
      id: expect.stringMatching(/^knowledge:[a-z0-9]+$/u),
      kind: "knowledge",
      status: "running",
      label: "Wissensbasis wird durchsucht",
      queries: ["Pendlerpauschale Voraussetzungen 2025"],
    });
    expect(kbCall.step?.detail).toBeUndefined();
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

    expect(kbResult.step).toMatchObject({
      id: kbCall.step?.id,
      kind: "knowledge",
      status: "completed",
      label: "Wissensbasis durchsucht",
      detail: "2 Treffer",
      durationMs: 450,
    });
    expect(JSON.stringify(withoutPayload(kbResult))).not.toContain("Secret excerpt");

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

    expect(webCall.step).toMatchObject({
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

    expect(unknownCall.step).toMatchObject({
      id: expect.stringMatching(/^tool:[a-z0-9]+$/u),
      kind: "tool",
      status: "running",
      label: "Recherchewerkzeug wird ausgeführt",
      facts: [{ label: "Code", value: "import os; print(os.environ)" }],
    });
    expect(unknownCall.step?.detail).toBeUndefined();
    expect(JSON.stringify(withoutPayload(unknownCall))).not.toContain("run_arbitrary_python_script");

    const unknownFail = parseWeKnoraExecutionEvent({
      response_type: "error",
      data: {
        tool_call_id: "custom-tool-42",
        tool_name: "run_arbitrary_python_script",
        error: "Fatal exception: Stack trace in /var/log/secret.log",
      },
    });

    expect(unknownFail.step).toMatchObject({
      id: unknownCall.step?.id,
      kind: "tool",
      status: "failed",
      label: "Recherchewerkzeug fehlgeschlagen",
    });
    expect(JSON.stringify(withoutPayload(unknownFail))).not.toContain("Stack trace");
    expect(JSON.stringify(unknownFail)).not.toContain("/var/log");
    expect(JSON.stringify(withoutPayload(unknownFail))).not.toContain("custom-tool-42");
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
    expect(webCall.step?.queries).toEqual(["Pendlerrechner BMF 2025"]);
    expect(webCall.step?.detail).toBeUndefined();

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
    expect(JSON.stringify(withoutPayload(webResult))).not.toContain("Raw snippet");

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
    expect(maliciousPayloads.map((p) => JSON.stringify(withoutPayload(parseWeKnoraExecutionEvent(p)))).join(" ")).not.toContain("custom_fetch");
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

    expect(nativeCall.step).toMatchObject({
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

    expect(nativeResult.step).toMatchObject({
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
    expect(merged[0]).toMatchObject(nativeResult.step!);
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

    expect(directResults.step).toMatchObject({
      id: expect.stringMatching(/^knowledge:[a-z0-9]+$/u),
      kind: "knowledge",
      status: "completed",
      label: "Wissensbasis durchsucht",
      detail: "2 Treffer",
      durationMs: 150,
    });
    expect(JSON.stringify(withoutPayload(directResults))).not.toContain("Raw confidential");
    expect(JSON.stringify(withoutPayload(directResults))).not.toContain("chk-456");
    expect(JSON.stringify(withoutPayload(directResults))).not.toContain("doc-123");

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

    expect(grepResult.step).toMatchObject({
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
    expect(ipv6Query.step?.queries).toBeUndefined();

    // 2. Trailing-dot internal URL in query
    const trailingDotQuery = parseWeKnoraExecutionEvent({
      response_type: "tool_call",
      data: {
        tool_call_id: "search-trailing-dot",
        tool_name: "web_search",
        arguments: { query: "http://service.local./search?q=test" },
      },
    });
    expect(trailingDotQuery.step?.queries).toBeUndefined();

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
      expect(sensitiveQuery.step?.queries).toBeUndefined();
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
    expect(germanQuery.step?.queries).toEqual(["Pendlerpauschale Voraussetzungen 2025"]);

    // 5. Safe public URL search query preserved
    const safeUrlQuery = parseWeKnoraExecutionEvent({
      response_type: "tool_call",
      data: {
        tool_call_id: "search-safe-url",
        tool_name: "web_search",
        arguments: { query: "https://ris.bka.gv.at/Dokument.wxe?id=123" },
      },
    });
    expect(safeUrlQuery.step?.queries).toEqual(["https://ris.bka.gv.at/Dokument.wxe?id=123"]);
  });

  it("Task 1: surfaces agent_query as initial trace step only when assistant_message_id is present", () => {
    const withId = parseWeKnoraExecutionEvent({
      response_type: "agent_query",
      assistant_message_id: "m1",
    });

    expect(withId.step).toEqual({
      id: EXECUTION_PHASE_STEP_ID,
      kind: "analysis",
      status: "running",
      label: "Analysiert die Anfrage",
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

      expect(res.step).toMatchObject({
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


  describe("Task 2: generic tools expose only harmless scalar arguments as facts", () => {
    it("lists up to six scalar arguments with friendly labels and skips nested values", () => {
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
            a: "1", b: "2", c: "3", d: "4",
          },
        },
      });

      expect(call.step).toMatchObject({ kind: "tool", status: "running", label: "Recherchewerkzeug wird ausgeführt" });
      expect(call.step?.facts).toEqual([
        { label: "Jahr", value: "2024" },
        { label: "Category", value: "pendler" },
        { label: "Include details", value: "Ja" },
        { label: "A", value: "1" },
        { label: "B", value: "2" },
        { label: "C", value: "3" },
      ]);
      expect(call.step?.detail).toBeUndefined();
      expect(JSON.stringify(call)).not.toContain("extra_options");
    });

    it("parses JSON-string arguments", () => {
      const call = parseWeKnoraExecutionEvent({
        response_type: "tool_call",
        data: { tool_call_id: "custom-json-1", tool_name: "custom_analyzer", arguments: JSON.stringify({ section: "§ 16 EStG", active: true }) },
      });
      expect(call.step?.facts).toEqual([{ label: "Section", value: "§ 16 EStG" }, { label: "Active", value: "Ja" }]);
    });

    it("drops credentials, ids, hosts and model names instead of showing them", () => {
      const call = parseWeKnoraExecutionEvent({
        response_type: "tool_call",
        data: {
          tool_call_id: "sec-tool-1",
          tool_name: "external_service",
          arguments: {
            api_key: "sk-proj-super-secret-12345678",
            password: "supersecretpassword",
            knowledge_base_id: "6f9619ff-8b86-d011-b42d-00c04fc964ff",
            tenant_id: 42,
            model: "gpt-4o",
            endpoint: "http://app:8080/v1",
            target: "http://app:8080/v1",
            note: "Chunk 6f9619ff-8b86-d011-b42d-00c04fc964ff via claude-3-5-sonnet",
            mode: "fast",
          },
        },
      });
      expect(call.step?.facts).toEqual([{ label: "Modus", value: "fast" }]);
      const json = JSON.stringify(call);
      for (const leaked of ["super-secret", "supersecret", "6f9619ff", "gpt-4o", "app:8080", "claude-3"]) {
        expect(json).not.toContain(leaked);
      }
    });

    it("truncates long values", () => {
      const call = parseWeKnoraExecutionEvent({
        response_type: "tool_call",
        data: { tool_call_id: "long-args-1", tool_name: "external_service", arguments: { description: "Lorem ipsum ".repeat(60) } },
      });
      expect(call.step?.facts?.[0].value.length).toBeLessThanOrEqual(121);
    });
  });

  describe("Task 4: references step carries structured sources, not id-laden detail lines", () => {
    it("projects mixed web and knowledge references into sources without ids", () => {
      const refEvent = parseWeKnoraExecutionEvent({
        response_type: "references",
        data: {
          event_id: "ref-step-1",
          references: [
            { kind: "web", url: "https://ris.bka.gv.at/Dokument.wxe?id=123", title: "RIS Judikatur" },
            { kind: "knowledge", doc: "EStG § 16 Pendlerpauschale", knowledge_base_id: "6f9619ff-8b86-d011-b42d-00c04fc964ff" },
            { knowledge_title: "LStR_2002_idF_2025-12-18_full_verified.md", content: "Rz 250 Pendlerpauschale", chunk_id: "6f9619ff-8b86-d011-b42d-00c04fc964aa", score: 0.8 },
          ],
        },
      });

      expect(refEvent.step).toMatchObject({
        id: expect.stringMatching(/^sources:[a-z0-9]+$/u),
        kind: "sources",
        status: "completed",
        label: "3 Quellen gefunden",
      });
      expect(refEvent.step?.detail).toBeUndefined();
      expect(refEvent.step?.sources?.map((source) => [source.title, source.kind])).toEqual([
        ["RIS Judikatur", "web"],
        ["EStG § 16 Pendlerpauschale", "law"],
        ["LStR_2002_idF_2025-12-18_full_verified.md", "guideline"],
      ]);
      expect(JSON.stringify(refEvent)).not.toContain("6f9619ff");
    });

    it("caps the number of projected references per step", () => {
      const refEvent = parseWeKnoraExecutionEvent({
        response_type: "references",
        data: { references: Array.from({ length: 30 }, (_, i) => ({ kind: "knowledge", doc: `Dokument Nr. ${i + 1}` })) },
      });
      expect(refEvent.step?.label).toBe("30 Quellen gefunden");
      expect(refEvent.step?.sources).toHaveLength(12);
    });
  });
});

describe("Advanced execution trace: structured tool views", () => {
  const toolCall = (data: Record<string, unknown>) =>
    parseWeKnoraExecutionEvent({ response_type: "tool_call", data: { tool_call_id: "call-1", tool_name: "shell_exec", ...data } });
  const toolResult = (data: Record<string, unknown>) =>
    parseWeKnoraExecutionEvent({ response_type: "tool_result", data: { tool_call_id: "call-1", tool_name: "shell_exec", success: true, ...data } });
  const merge = (steps: FredExecutionStep[], update: ReturnType<typeof parseWeKnoraExecutionEvent>) =>
    mergeFredExecutionUpdate(steps, update).trace;

  it("never stores the upstream tool_call_id, only an opaque hash", () => {
    const step = toolCall({ arguments: { command: "ls" } }).step!;
    expect(step.callId).toMatch(/^call:[0-9a-z]+$/u);
    expect(JSON.stringify(step)).not.toContain("call-1");
    // idempotent through the stored-trace sanitizer
    expect(sanitizeStoredExecutionTrace([step])[0].callId).toBe(step.callId);
  });

  it("shell tools keep command and output, mask paths and environment dumps, and never keep raw arguments/results", () => {
    const call = toolCall({ arguments: { command: "python /workspace/analyse.py --in /etc/secret/data.csv" } }).step!;
    expect(call).toMatchObject({ kind: "tool", label: "Sandbox-Befehl wird ausgeführt", command: "python ./analyse.py --in data.csv" });
    expect(call).not.toHaveProperty("arguments");

    const done = toolResult({
      output: "HOME=/root\nPATH=/usr/bin\nOPENAI_API_KEY=abc\nergebnis: 42 in /home/sandbox/out/result.txt",
    }).step!;
    expect(done.label).toBe("Sandbox-Befehl ausgeführt");
    expect(done.output).toContain("ergebnis: 42 in result.txt");
    expect(done.output).toContain("[Umgebungsvariablen ausgeblendet]");
    expect(done.output).not.toContain("OPENAI_API_KEY");
    expect(done.output).not.toContain("/home/sandbox");
    expect(done).not.toHaveProperty("result");
  });

  it("masks single secret-looking environment lines in output", () => {
    const done = toolResult({ output: "DATABASE_URL=postgres://u:p@db/x\nFOO=bar" }).step!;
    expect(done.output).not.toContain("postgres://");
    expect(done.output).toContain("FOO=bar");
  });

  it("caps command and output with a visible marker and keeps the end of output", () => {
    const out = parseWeKnoraExecutionEvent({
      response_type: "command_output",
      data: { tool_call_id: "call-1", command: "z".repeat(MAX_EXECUTION_COMMAND_CHARS + 50), output: `${"y".repeat(MAX_EXECUTION_OUTPUT_CHARS)}TAIL`, done: false },
    }).step!;
    expect(out.output!.startsWith(`${EXECUTION_CUT_MARKER}\n`)).toBe(true);
    expect(out.output!.endsWith("TAIL")).toBe(true);
    expect(out.output!.length).toBe(MAX_EXECUTION_OUTPUT_CHARS + EXECUTION_CUT_MARKER.length + 1);
    expect(out.command!.endsWith(EXECUTION_CUT_MARKER)).toBe(true);
  });

  it("merges command_output into the tool step by callId, before and after tool_result, replacing the tail", () => {
    const output = (text: string, done = false) => parseWeKnoraExecutionEvent({
      response_type: "command_output",
      data: { tool_call_id: "call-1", command: "ls -la", started_at: "2026-01-01T00:00:00Z", output: text, done },
    });

    let trace = merge([], toolCall({ arguments: { command: "ls -la" } }));
    trace = merge(trace, output("one\n"));
    trace = merge(trace, output("one\ntwo\n"));
    expect(trace).toHaveLength(1);
    expect(trace[0]).toMatchObject({ kind: "tool", status: "running", label: "Sandbox-Befehl wird ausgeführt", command: "ls -la", output: "one\ntwo\n" });

    // a finished tool step is never reverted to running, late output still lands
    trace = merge(trace, toolResult({ output: "final" }));
    trace = merge(trace, output("one\ntwo\nthree\n"));
    expect(trace).toHaveLength(1);
    expect(trace[0]).toMatchObject({ status: "completed", label: "Sandbox-Befehl ausgeführt", output: "one\ntwo\nthree\n" });

    // output arrives before any tool_call: placeholder step, later upgraded by the real events
    let early = merge([], output("boot\n"));
    expect(early).toHaveLength(1);
    expect(early[0]).toMatchObject({ kind: "tool", status: "running", label: "Befehl wird ausgeführt", output: "boot\n" });
    expect(early[0].callId).toBe(trace[0].callId);
    early = merge(early, output("boot\ndone\n", true));
    expect(early[0]).toMatchObject({ status: "completed", output: "boot\ndone\n" });
    early = merge(early, toolResult({ output: "ok" }));
    expect(early).toHaveLength(1);
    expect(early[0]).toMatchObject({ label: "Sandbox-Befehl ausgeführt", output: "ok" });
  });

  it("matches output to a step of another kind by callId", () => {
    const call = parseWeKnoraExecutionEvent({ response_type: "tool_call", data: { tool_call_id: "kb-1", tool_name: "knowledge_search" } });
    let trace = merge([], call);
    trace = merge(trace, parseWeKnoraExecutionEvent({ response_type: "command_output", data: { tool_call_id: "kb-1", output: "x" } }));
    expect(trace).toHaveLength(1);
    expect(trace[0]).toMatchObject({ kind: "knowledge", label: "Wissensbasis wird durchsucht", output: "x" });
  });

  it("unwraps work_event with an inner command_output", () => {
    const update = parseWeKnoraExecutionEvent({
      response_type: "work_event",
      data: {
        work_id: "w1",
        kind: "shell",
        inner: { response_type: "command_output", data: { tool_call_id: "call-1", command: "sleep 1", output: "bg out", done: true } },
      },
    });
    expect(update.step).toMatchObject({ command: "sleep 1", output: "bg out", status: "completed" });
    const other = parseWeKnoraExecutionEvent({ response_type: "work_event", data: { work_id: "w1", inner: { response_type: "progress", data: {} } } });
    expect(other.step).toBeUndefined();
    expect(other.steps).toBeUndefined();
  });

  it("projects collaboration_status into agent steps nested under spawn_agent and ignores older revisions", () => {
    const spawn = parseWeKnoraExecutionEvent({
      response_type: "tool_call",
      data: { tool_call_id: "sp-1", tool_name: "spawn_agent", arguments: { task_name: "Recherche BFG", prompt: "…" } },
    });
    const spawned = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: { tool_call_id: "sp-1", tool_name: "spawn_agent", success: true, member_id: "m-7", task_name: "Recherche BFG" },
    });
    expect(spawn.step).toMatchObject({ label: "Hilfs-Agent wird gestartet", facts: [{ label: "Aufgabe", value: "Recherche BFG" }] });
    let trace = merge(merge([], spawn), spawned);
    const spawnId = trace[0].id;
    expect(trace[0].refs).toContain("name:Recherche BFG");

    const status = (revision: number, state: string, extra: Record<string, unknown> = {}) => parseWeKnoraExecutionEvent({
      response_type: "collaboration_status",
      data: {
        group_id: "g1",
        revision,
        tasks: [
          { member_id: "m-7", task_name: "Recherche BFG", display_name: "Rechercheur", status: state, ...extra },
          { id: "other", name: "Zweiter", status: "queued" },
        ],
      },
    });

    const first = status(2, "running", { latest_message: { content: "Ich denke nach über X" }, progress: { iteration: 3, tool_name: "grep_chunks" } });
    expect(first.steps).toHaveLength(2);
    trace = merge(trace, first);
    const agent = trace.find((step) => step.kind === "agent" && step.label.includes("Rechercheur"))!;
    expect(agent).toMatchObject({
      id: expect.stringMatching(/^agent:[a-z0-9]+$/u),
      status: "running",
      label: "Hilfs-Agent Rechercheur: Läuft",
      detail: "Schritt 3",
      taskName: "Recherche BFG",
      parentId: spawnId,
    });
    // helper-agent messages (possible reasoning) and raw ids never reach the step
    const json = JSON.stringify(trace);
    expect(json).not.toContain("denke nach");
    expect(json).not.toContain("m-7");
    expect(json).not.toContain('"g1"');
    expect(trace.find((step) => step.label === "Hilfs-Agent Zweiter: Wartet")?.parentId).toBeUndefined();

    // older revision is ignored, newer one wins
    expect(merge(trace, status(1, "failed"))).toBe(trace);
    trace = merge(trace, status(3, "succeeded"));
    expect(trace.filter((step) => step.kind === "agent")).toHaveLength(2);
    expect(trace.find((step) => step.id === agent.id)).toMatchObject({ status: "completed", label: "Hilfs-Agent Rechercheur: Fertig", parentId: spawnId });
    expect(trace.find((step) => step.id === agent.id)?.detail).toBeUndefined();
    expect(trace.find((step) => step.id === agent.id)?.revision).toBe(3);

    const cancelling = merge([], status(1, "running", { cancel_requested: true }));
    expect(cancelling[0].label).toBe("Hilfs-Agent Rechercheur: Wird abgebrochen");
    expect(merge([], status(1, "interrupted"))[0]).toMatchObject({ status: "failed", label: "Hilfs-Agent Rechercheur: Unterbrochen" });
  });

  it("projects memory_recalled and context_compacted as one compact line without their content", () => {
    const memory = parseWeKnoraExecutionEvent({
      response_type: "memory_recalled",
      data: { memories: [{ id: "1", kind: "fact", content: "Nutzer pendelt 30 km" }, { id: "2", kind: "fact", content: "Wohnt in Wien" }] },
    });
    expect(memory.step).toMatchObject({ kind: "memory", status: "completed", label: "2 Erinnerungen abgerufen" });
    expect(memory.step?.detail).toBeUndefined();
    expect(JSON.stringify(memory)).not.toContain("pendelt");
    expect(parseWeKnoraExecutionEvent({ response_type: "memory_recalled", data: { memories: [{ id: "1", content: "x" }] } }).step?.label).toBe("1 Erinnerung abgerufen");
    expect(parseWeKnoraExecutionEvent({ response_type: "memory_recalled", data: { memories: [] } }).step).toBeUndefined();

    const compacted = parseWeKnoraExecutionEvent({
      response_type: "context_compacted",
      data: { reason: "limit", tokens_before: 12000, tokens_after: 3000, messages_before: 40, messages_after: 6, summary: "Kurzfassung des Gesprächs", degraded: false },
    });
    expect(compacted.step).toMatchObject({
      kind: "context",
      status: "completed",
      label: "Gesprächsverlauf komprimiert (12.000 → 3.000 Tokens)",
    });
    expect(compacted.step?.detail).toBeUndefined();
  });

  it("ignores non-step events", () => {
    for (const type of ["heartbeat", "session_title", "work_started", "work_finished", "steer", "user_message_injected", "artifacts_pending", "run_resumed", "progress", "install_output", "tool_approval_resolved"]) {
      const update = parseWeKnoraExecutionEvent({ response_type: type, data: { tool_call_id: "x" } });
      expect(update.step).toBeUndefined();
      expect(update.steps).toBeUndefined();
    }
  });

  it("reports only touched steps from mergeFredExecutionUpdate", () => {
    const a = merge([], toolCall({ tool_call_id: "a" }));
    const b = merge(a, toolCall({ tool_call_id: "b", tool_name: "web_search" }));
    const merged = mergeFredExecutionUpdate(b, toolResult({ tool_call_id: "a", output: "ok" }));
    expect(merged.touched).toHaveLength(1);
    expect(merged.touched[0]).toMatchObject({ status: "completed", label: "Sandbox-Befehl ausgeführt" });
    expect(mergeFredExecutionUpdate(b, { fatalError: false, unsupported: false }).touched).toEqual([]);
  });

  it("maps failures to a short German reason instead of the upstream error", () => {
    const failed = toolResult({ success: false, error: "dial tcp app:8080: i/o timeout (token=abc123)", output: "partial" }).step!;
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("Zeitüberschreitung");
    expect(JSON.stringify(failed)).not.toContain("app:8080");
    expect(parseWeKnoraExecutionEvent({ response_type: "error", data: { tool_name: "web_search", error: "429 Too Many Requests" } }).step?.error).toBe("Anfragelimit erreicht");
    expect(parseWeKnoraExecutionEvent({ response_type: "error", data: { tool_name: "web_search", error: "kaputt" } }).step?.error).toBe("Schritt fehlgeschlagen");
  });
});

describe("Advanced execution trace: thinking is never surfaced", () => {
  const secretThought = "Ich überlege geheim: der Nutzer pendelt, also Pendlerpauschale prüfen";

  it("turns thinking events of any shape into one text-free phase marker", () => {
    const events: unknown[] = [
      { response_type: "thinking", content: secretThought, data: { done: false } },
      { response_type: "thinking", data: { content: secretThought, reasoning_content: secretThought, thought: secretThought, done: true, duration_ms: 1200 } },
      { response_type: "thinking", reasoning_content: secretThought, thinking: { content: secretThought } },
      { response_type: "tool_result", data: { tool_name: "thinking", success: true, thought: secretThought, output: secretThought, thought_number: 1, total_thoughts: 3 } },
      { response_type: "tool_call", data: { tool_name: "thinking", arguments: { thought: secretThought, thought_number: 1 } } },
      { response_type: "agent_query", assistant_message_id: "m1" },
    ];
    for (const event of events) {
      const update = parseWeKnoraExecutionEvent(event);
      expect(update.step).toMatchObject({ id: EXECUTION_PHASE_STEP_ID, kind: "analysis" });
      expect(JSON.stringify(update)).not.toContain("geheim");
      expect(update.step).not.toHaveProperty("detail");
      expect(update.step).not.toHaveProperty("toolName");
    }
  });

  it("drops reflection events entirely", () => {
    const update = parseWeKnoraExecutionEvent({ response_type: "reflection", content: secretThought, data: { done: true } });
    expect(update.step).toBeUndefined();
    expect(JSON.stringify(update)).not.toContain("geheim");
  });

  it("coalesces every thinking event into a single marker that is closed by the next real step", () => {
    const events = [
      { response_type: "thinking", content: "a" },
      { response_type: "thinking", content: "b" },
      { response_type: "tool_call", data: { tool_call_id: "k1", tool_name: "knowledge_search", arguments: { query: "x y" } } },
      { response_type: "thinking", content: "c" },
      { response_type: "thinking", data: { done: true } },
      { response_type: "reflection", content: "d" },
    ];
    let trace: FredExecutionStep[] = [];
    for (const event of events) trace = mergeFredExecutionUpdate(trace, parseWeKnoraExecutionEvent(event)).trace;
    expect(trace.map((step) => step.kind)).toEqual(["analysis", "knowledge"]);
    expect(trace[0]).toMatchObject({ id: EXECUTION_PHASE_STEP_ID, status: "completed", label: "Anfrage analysiert" });
    expect(JSON.stringify(trace)).not.toMatch(/"detail"/u);
  });

  it("finalizes a marker that never saw a done event", () => {
    const trace = mergeFredExecutionUpdate([], parseWeKnoraExecutionEvent({ response_type: "thinking", content: "x" })).trace;
    expect(trace[0].status).toBe("running");
    expect(finalizeExecutionTrace(trace)[0].status).toBe("completed");
  });

  it("strips reasoning text from already stored analysis / evaluation steps and coalesces them", () => {
    const legacy = [
      { id: "analysis:1", kind: "analysis", status: "completed", label: "Anfrage analysiert", detail: secretThought, durationMs: 100 },
      { id: "analysis:2", kind: "analysis", status: "completed", label: "Anfrage analysiert (2/3)", detail: secretThought },
      { id: "evaluation:1", kind: "evaluation", status: "completed", label: "Rechercheergebnisse bewertet", detail: secretThought },
      { id: "knowledge:1", kind: "knowledge", status: "completed", label: "Wissensbasis durchsucht" },
      { id: "tool:thinking", kind: "analysis", status: "completed", label: "Anfrage analysiert", toolName: "thinking", detail: secretThought, arguments: JSON.stringify({ thought: secretThought }), result: secretThought },
    ];
    const clean = sanitizeStoredExecutionTrace(legacy);
    expect(JSON.stringify(clean)).not.toContain("geheim");
    // only the first text-free marker survives; later analysis / evaluation / thinking markers are dropped
    expect(clean.map((step) => step.id)).toEqual(["analysis:1", "knowledge:1"]);
    expect(clean.every((step) => step.detail === undefined)).toBe(true);
  });

  it("ignores reasoning fields smuggled into stored steps and closes running markers on read", () => {
    const clean = sanitizeStoredExecutionTrace([{ id: "x", kind: "analysis", status: "running", label: "Analysiert", reasoning_content: secretThought, thought: secretThought }]);
    expect(JSON.stringify(clean)).not.toContain("geheim");
    expect(clean[0].status).toBe("running");
    expect(sanitizeStoredExecutionTrace(clean, { finalize: true })[0].status).toBe("completed");
  });
});

describe("Advanced execution trace: internal data never reaches the browser", () => {
  const uuid = "6f9619ff-8b86-d011-b42d-00c04fc964ff";

  it("masks UUIDs, hosts, IPs, model names and paths in labels, details and free text", () => {
    const dirty = [{
      id: "tool:1",
      kind: "tool",
      status: "completed",
      label: `Fehler bei ${uuid} auf app:8080`,
      detail: "Antwort von mcp:8000 und fred.203.0.113.7.sslip.io, 10.0.0.12:5432, Modell gpt-4o-mini / claude-3-5-sonnet / text-embedding-3-large (OpenAI) in /var/lib/weknora/data/file.md",
      toolName: "custom_tool",
      callId: "upstream-call-id-123",
      groupId: "grp-raw-1",
    }];
    const [step] = sanitizeStoredExecutionTrace(dirty);
    const json = JSON.stringify(step);
    for (const leaked of [uuid, "app:8080", "mcp:8000", "sslip.io", "10.0.0.12", "gpt-4o", "claude-3", "text-embedding", "OpenAI", "/var/lib", "upstream-call-id-123", "grp-raw-1"]) {
      expect(json).not.toContain(leaked);
    }
    expect(step.detail).toContain("[intern]");
    expect(step.detail).toContain("[Modell]");
    expect(step.detail).toContain("file.md");
    expect(step.label).toContain("[ID]");
  });

  it("is idempotent", () => {
    const once = sanitizeStoredExecutionTrace([{ id: "t", kind: "tool", status: "completed", label: `x ${uuid}`, detail: "gpt-4o auf app:8080", command: "cat /etc/passwd", output: "FOO=1\nBAR=2\nBAZ=3\nhi /tmp/a/b.txt" }]);
    expect(sanitizeStoredExecutionTrace(once)).toEqual(once);
  });

  it("does not mangle ordinary German legal text", () => {
    const text = "Gemäß § 16 Abs 1 Z 6 EStG 1988 sind Aufwendungen von 1.234,56 Euro (Stand 12.07.2026) abzugsfähig; siehe Rz 250/2 und BGBl I Nr. 201/2024.";
    const [step] = sanitizeStoredExecutionTrace([{ id: "t", kind: "tool", status: "completed", label: "L", detail: text }]);
    expect(step.detail).toBe(text);
  });
});

describe("Advanced execution trace: knowledge search → source cards", () => {
  const searchRows = [
    {
      result_index: 1,
      content: "Pendlerpauschale gilt bei einer Wegstrecke von mehr als 20 km. ".repeat(40),
      chunk_type: "text",
      knowledge_id: "6f9619ff-8b86-d011-b42d-00c04fc964ff",
      knowledge_base_id: "7a9619ff-8b86-d011-b42d-00c04fc964ff",
      knowledge_title: "EStG_1988_Einkommensteuergesetz_1988_RIS_Fassung_2026-07-12_verified.md",
      knowledge_metadata: { tenant: 1 },
      match_type: "vector",
      match_snippet: "Das Pendlerpauschale steht zu, wenn ...",
      score: 0.8734,
      source_query: "Pendlerpauschale Voraussetzungen",
      query_type: "vector",
      knowledge_base_type: "document",
    },
    {
      result_index: 2,
      content: "Q: Wann steht das Pendlereuro zu? | A: Bei Anspruch auf Pendlerpauschale.",
      chunk_type: "faq",
      knowledge_id: "6f9619ff-8b86-d011-b42d-00c04fc964fe",
      knowledge_base_id: "7a9619ff-8b86-d011-b42d-00c04fc964fe",
      knowledge_title: "Pendler-FAQ",
      match_type: "keyword",
      match_snippet: "Q: Wann steht das Pendlereuro zu? | A: Bei Anspruch auf Pendlerpauschale.",
      score: 0.6,
      source_query: "Pendlereuro",
      knowledge_base_type: "faq",
      faq_id: "6f9619ff-8b86-d011-b42d-00c04fc964fd",
    },
    {
      result_index: 3,
      content: "Betrag 2025: 696 Euro",
      knowledge_title: "Betragstabelle",
      match_type: "vector",
      match_snippet: "Betrag 2025: 696 Euro",
      score: 87,
      source_query: "Pendlerpauschale Voraussetzungen",
    },
  ];

  const run = (result: Record<string, unknown>) => {
    const call = parseWeKnoraExecutionEvent({
      response_type: "tool_call",
      data: { tool_call_id: "s1", tool_name: "search_knowledge", arguments: { queries: ["Pendlerpauschale Voraussetzungen", "Pendlereuro"], knowledge_base_ids: ["7a9619ff-8b86-d011-b42d-00c04fc964ff"] } },
    });
    const done = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: { tool_call_id: "s1", tool_name: "search_knowledge", success: true, duration_ms: 900, ...result },
    });
    return mergeFredExecutionUpdate(mergeFredExecutionUpdate([], call).trace, done).trace[0];
  };

  it("turns result rows into capped, scored, classified source cards without ids", () => {
    const step = run({ result: searchRows });
    expect(step).toMatchObject({ kind: "knowledge", status: "completed", label: "Wissensbasis durchsucht", detail: "3 Treffer", durationMs: 900 });
    expect(step.queries).toEqual(["Pendlerpauschale Voraussetzungen", "Pendlereuro"]);
    expect(step.sources).toHaveLength(3);
    const [law, faq, table] = step.sources!;
    expect(law).toMatchObject({
      title: "EStG_1988_Einkommensteuergesetz_1988_RIS_Fassung_2026-07-12_verified.md",
      kind: "law",
      snippet: "Das Pendlerpauschale steht zu, wenn ...",
      score: 0.873,
      matchType: "vector",
      query: "Pendlerpauschale Voraussetzungen",
    });
    expect(law.excerpt!.length).toBeLessThanOrEqual(1501);
    expect(faq).toMatchObject({ kind: "faq", score: 0.6 });
    expect(table).toMatchObject({ title: "Betragstabelle", kind: "document", score: 0.87 });
    const json = JSON.stringify(step);
    expect(json).not.toContain("6f9619ff");
    expect(json).not.toContain("7a9619ff");
    expect(json).not.toContain("knowledge_metadata");
    expect(step).not.toHaveProperty("arguments");
    expect(step).not.toHaveProperty("result");
  });

  it("accepts rows wrapped as { results: [...], display_type }", () => {
    expect(run({ data: { display_type: "search_results", results: searchRows } }).sources).toHaveLength(3);
    expect(run({ result: JSON.stringify({ results: searchRows, display_type: "search_results" }) }).sources).toHaveLength(3);
    expect(run({ output: JSON.stringify({ results: searchRows }) }).sources).toHaveLength(3);
  });

  it("deduplicates identical hits inside one result and limits the number of cards", () => {
    expect(run({ result: [...searchRows, ...searchRows] }).sources).toHaveLength(3);
    const many = run({ result: Array.from({ length: 40 }, (_, index) => ({ knowledge_title: `Dok ${index}`, match_snippet: `Treffer ${index}`, score: 0.5 })) });
    expect(many.sources).toHaveLength(12);
  });

  it("unions queries when a step is updated", () => {
    const step = run({ result: searchRows });
    const merged = mergeFredExecutionStep([step], { ...step, queries: ["Pendlereuro", "Neu"] });
    expect(merged[0].queries).toEqual(["Pendlerpauschale Voraussetzungen", "Pendlereuro", "Neu"]);
  });

  it("document reads yield the title, position and excerpt", () => {
    const call = parseWeKnoraExecutionEvent({ response_type: "tool_call", data: { tool_call_id: "r1", tool_name: "read_document", arguments: { knowledge_id: "6f9619ff-8b86-d011-b42d-00c04fc964ff" } } });
    expect(call.step).toMatchObject({ kind: "knowledge", label: "Dokument wird gelesen" });
    expect(call.step).not.toHaveProperty("facts");
    const done = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: { tool_call_id: "r1", tool_name: "read_document", success: true, result: { knowledge_title: "LStR_2002_idF_2025-12-18_full_verified.md", chunk_index: 4, content: "Rz 250: Das Pendlerpauschale ..." } },
    });
    expect(done.step).toMatchObject({
      label: "Dokument gelesen",
      sources: [{ title: "LStR_2002_idF_2025-12-18_full_verified.md", kind: "guideline", snippet: "Rz 250: Das Pendlerpauschale ..." }],
    });
    // the internal chunk sequence is no section the reader could use
    expect(done.step?.sources?.[0]).not.toHaveProperty("section");
  });

  it("web search yields query chips and result cards with public links only", () => {
    const done = parseWeKnoraExecutionEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "w1",
        tool_name: "web_search",
        success: true,
        arguments: { query: "Pendlerrechner BMF" },
        result: { results: [
          { title: "BMF Pendlerrechner", url: "https://pendlerrechner.bmf.gv.at/x?a=1", snippet: "Berechnen Sie..." },
          { title: "Intern", url: "http://app:8080/secret", snippet: "nicht zeigen" },
        ] },
      },
    }).step!;
    expect(done.queries).toEqual(["Pendlerrechner BMF"]);
    expect(done.sources?.[0]).toMatchObject({ title: "BMF Pendlerrechner", kind: "web", url: "https://pendlerrechner.bmf.gv.at/x?a=1" });
    expect(done.sources?.[1].url).toBeUndefined();
    expect(JSON.stringify(done)).not.toContain("app:8080");
  });
});

describe("Advanced execution trace: legacy stored steps", () => {
  const rows = [{
    result_index: 1,
    content: "Langtext ".repeat(300),
    knowledge_id: "6f9619ff-8b86-d011-b42d-00c04fc964ff",
    knowledge_title: "UStG_1994_Umsatzsteuergesetz_1994_RIS_Fassung_2026-01-01_verified.md",
    match_snippet: "Kleinunternehmer ...",
    score: 0.7,
    source_query: "Kleinunternehmer",
  }];

  it("derives queries and sources from raw arguments/result strings and drops the raw strings", () => {
    const [step] = sanitizeStoredExecutionTrace([{
      id: "knowledge:1",
      kind: "knowledge",
      status: "completed",
      label: "Wissensbasis durchsucht",
      callId: "raw-call-id",
      toolName: "search_knowledge",
      detail: "Suche: Kleinunternehmer",
      arguments: JSON.stringify({ queries: ["Kleinunternehmer"], knowledge_base_ids: ["6f9619ff-8b86-d011-b42d-00c04fc964ff"] }, null, 2),
      result: JSON.stringify({ results: rows, display_type: "search_results" }, null, 2),
    }]);
    expect(step).not.toHaveProperty("arguments");
    expect(step).not.toHaveProperty("result");
    expect(step.queries).toEqual(["Kleinunternehmer"]);
    expect(step.sources?.[0]).toMatchObject({ kind: "law", score: 0.7 });
    expect(step.detail).toBeUndefined();
    expect(JSON.stringify(step)).not.toContain("6f9619ff");
    expect(JSON.stringify(step)).not.toContain("raw-call-id");
  });

  it("salvages hits from results that were cut in the middle of the JSON", () => {
    const full = JSON.stringify({ results: [...rows, { ...rows[0], knowledge_title: "Betragstabelle", match_snippet: "Zweiter Treffer" }] }, null, 2);
    const [step] = sanitizeStoredExecutionTrace([{
      id: "knowledge:2", kind: "knowledge", status: "completed", label: "Wissensbasis durchsucht", toolName: "search_knowledge",
      result: `${full.slice(0, Math.floor(full.length * 0.8))}\n…[gekürzt]`,
    }]);
    expect(step.sources?.length).toBeGreaterThanOrEqual(1);
    expect(step.sources?.[0].title).toContain("UStG_1994");
    expect(JSON.stringify(step)).not.toContain("result_index");
  });

  it("summarises unparseable plain-text results briefly and never dumps raw JSON", () => {
    const [text] = sanitizeStoredExecutionTrace([{
      id: "tool:3", kind: "tool", status: "completed", label: "Recherchewerkzeug ausgeführt", toolName: "custom_tool",
      result: `Alles erledigt. ${"x".repeat(2_000)}`, arguments: '{"limit": 5, "token": "abc"}',
    }]);
    expect(text.detail!.length).toBeLessThanOrEqual(281);
    expect(text.facts).toEqual([{ label: "Limit", value: "5" }]);
    expect(text).not.toHaveProperty("result");

    const [cutJson] = sanitizeStoredExecutionTrace([{
      id: "tool:4", kind: "tool", status: "completed", label: "Recherchewerkzeug ausgeführt", toolName: "custom_tool",
      result: '{"alpha": {"beta": [1, 2, 3], "gamma": "abc',
    }]);
    expect(cutJson.detail).toBeUndefined();
    expect(JSON.stringify(cutJson)).not.toContain("alpha");
  });

  it("keeps old shell steps usable: command and output, masked", () => {
    const [step] = sanitizeStoredExecutionTrace([{
      id: "tool:5", kind: "tool", status: "completed", label: "Recherchewerkzeug ausgeführt", toolName: "shell_exec",
      arguments: JSON.stringify({ command: "ls /home/app/data" }), result: "a.txt\nHOME=/root\nPATH=/bin\nUSER=x", output: "a.txt",
      command: "ls /home/app/data",
    }]);
    expect(step.command).toBe("ls data");
    expect(step.output).toBe("a.txt");
    expect(step).not.toHaveProperty("result");
  });

  it("parses old stored traces without the new fields unchanged", () => {
    const old = [{ id: "knowledge:1", kind: "knowledge", status: "completed", label: "Wissensbasis durchsucht", detail: "3 Treffer", durationMs: 10 }];
    expect(sanitizeStoredExecutionTrace(old)).toEqual(old);
  });

  it("filters malformed entries and enforces the step cap", () => {
    expect(sanitizeStoredExecutionTrace("nope")).toEqual([]);
    expect(sanitizeStoredExecutionTrace([null, 1, { id: "", kind: "tool", status: "running", label: "x" }, { id: "a", kind: "bogus", status: "running", label: "x" }])).toEqual([]);
    const many = Array.from({ length: 300 }, (_, index) => ({ id: `t${index}`, kind: "tool", status: "completed", label: `L${index}` }));
    expect(sanitizeStoredExecutionTrace(many)).toHaveLength(200);
  });

  it("round-trips new structured fields and re-caps them", () => {
    const steps: FredExecutionStep[] = [
      {
        id: "knowledge:1", kind: "knowledge", status: "completed", label: "Wissensbasis durchsucht", toolName: "search_knowledge",
        callId: "call:abc", queries: ["a", "b"], facts: [{ label: "Jahr", value: "2025" }], refs: ["name:X"],
        sources: [{ title: "Betragstabelle", kind: "document", snippet: "s", excerpt: "z".repeat(1_400), score: 0.5, matchType: "vector", query: "a", section: "Seite 2" }],
      },
      { id: "agent:1", kind: "agent", status: "running", label: "Hilfs-Agent X: Läuft", parentId: "knowledge:1", groupId: "grp:abc", revision: 4, taskName: "X", callId: "call:def", detail: "Schritt 2" },
    ];
    expect(sanitizeStoredExecutionTrace(JSON.parse(JSON.stringify(steps)))).toEqual(steps);

    const [capped] = sanitizeStoredExecutionTrace([{
      id: "t", kind: "tool", status: "running", label: "L",
      output: "o".repeat(20_000), command: "z".repeat(5_000),
      sources: [{ title: "T", excerpt: "x".repeat(5_000), snippet: "y".repeat(5_000), score: 7 }],
    }]);
    expect(capped.output!.startsWith(EXECUTION_CUT_MARKER)).toBe(true);
    expect(capped.command!.endsWith(EXECUTION_CUT_MARKER)).toBe(true);
    expect(capped.sources![0].excerpt!.length).toBeLessThanOrEqual(1_501);
    expect(capped.sources![0].snippet!.length).toBeLessThanOrEqual(401);
    expect(capped.sources![0].score).toBeUndefined();
    expect(sanitizeStoredExecutionTrace([capped])[0]).toEqual(capped);
  });
});

describe("Stored legacy traces: analysis markers and tool labels", () => {
  const legacy = [
    { id: "analysis:1", kind: "analysis", status: "completed", label: "Anfrage wird analysiert" },
    { id: "knowledge:1", kind: "knowledge", status: "completed", label: "Wissensbasis durchsucht", toolName: "search_knowledge" },
    { id: "analysis:2", kind: "analysis", status: "completed", label: "Anfrage wird analysiert" },
    { id: "knowledge:2", kind: "knowledge", status: "completed", label: "Wissensbasis durchsucht", toolName: "read_document" },
    { id: "evaluation:1", kind: "evaluation", status: "running", label: "Rechercheergebnisse werden bewertet" },
    { id: "analysis:3", kind: "analysis", status: "completed", label: "Anfrage analysiert" },
  ];

  it("keeps a single, completed 'Anfrage analysiert' marker (the first) in a finalized trace", () => {
    const trace = sanitizeStoredExecutionTrace(legacy, { finalize: true });
    expect(trace.map((step) => step.id)).toEqual(["analysis:1", "knowledge:1", "knowledge:2"]);
    expect(trace[0]).toMatchObject({ kind: "analysis", status: "completed", label: "Anfrage analysiert" });
    expect(trace.filter((step) => step.kind === "analysis" || step.kind === "evaluation")).toHaveLength(1);
  });

  it("closes a running first marker with the completed label, also without a later marker", () => {
    const running = [{ id: "analysis:1", kind: "analysis", status: "running", label: "Analysiert die Anfrage" }];
    expect(sanitizeStoredExecutionTrace(running)[0]).toMatchObject({ status: "running", label: "Analysiert die Anfrage" });
    expect(sanitizeStoredExecutionTrace(running, { finalize: true })[0]).toMatchObject({ status: "completed", label: "Anfrage analysiert" });
    expect(sanitizeStoredExecutionTrace(legacy.slice(0, 1))[0].label).toBe("Anfrage analysiert");
  });

  it("is idempotent", () => {
    const once = sanitizeStoredExecutionTrace(legacy, { finalize: true });
    expect(sanitizeStoredExecutionTrace(once, { finalize: true })).toEqual(once);
  });

  it("labels a legacy read_document step from its tool name", () => {
    const trace = sanitizeStoredExecutionTrace(legacy, { finalize: true });
    expect(trace.find((step) => step.id === "knowledge:2")).toMatchObject({ kind: "knowledge", label: "Dokument gelesen" });
    expect(trace.find((step) => step.id === "knowledge:1")?.label).toBe("Wissensbasis durchsucht");
    const failed = sanitizeStoredExecutionTrace([{ ...legacy[3], status: "failed" }]);
    expect(failed[0].label).toBe("Dokument konnte nicht gelesen werden");
  });
});
