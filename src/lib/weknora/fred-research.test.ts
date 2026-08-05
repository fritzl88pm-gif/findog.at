import { describe, expect, it } from "vitest";

import {
  mergeFredResearchStep,
  parseStoredFredResearchTrace,
  parseWeKnoraResearchEvent,
  transformWeKnoraAnswer,
} from "./fred-research";

describe("WeKnora research presentation", () => {
  it("removes complete and split citation tags while retaining their provenance", () => {
    const raw = 'Gemäß § 1 gilt das. <kb doc="LStR_2002.md" chunk_id="chunk-1" kb_id="kb-1" /> Danach.';

    expect(transformWeKnoraAnswer(raw)).toEqual({
      text: "Gemäß § 1 gilt das.  Danach.",
      sources: [{
        kind: "knowledge",
        doc: "LStR_2002.md",
        chunkId: "chunk-1",
        knowledgeBaseId: "kb-1",
      }],
    });
    expect(transformWeKnoraAnswer("Antwort <k", { streaming: true }).text).toBe("Antwort ");
    expect(transformWeKnoraAnswer('Antwort <kb doc="LStR', { streaming: true }).text).toBe("Antwort ");
  });

  it("removes web tags and only accepts safe web source URLs", () => {
    expect(transformWeKnoraAnswer(
      'Quelle <web url="https://ris.bka.gv.at/Dokument.wxe?id=1" title="RIS" />',
    )).toEqual({
      text: "Quelle ",
      sources: [{
        kind: "web",
        url: "https://ris.bka.gv.at/Dokument.wxe?id=1",
        title: "RIS",
      }],
    });
    expect(transformWeKnoraAnswer('<web url="javascript:alert(1)" title="X" />').sources).toEqual([]);
  });

  it("maps structured WeKnora tool events to German display text without exposing reasoning", () => {
    const update = parseWeKnoraResearchEvent({
      response_type: "tool_call",
      content: "Calling tool: knowledge_search with hidden arguments",
      data: {
        tool_call_id: "call-1",
        tool_name: "knowledge_search",
        arguments: { secret_query: "raw reasoning" },
      },
    });

    expect(update.step).toEqual({
      id: "call-1",
      kind: "knowledge",
      status: "running",
      label: "Wissensbasis wird durchsucht",
    });
    expect(JSON.stringify(update)).not.toContain("raw reasoning");
    expect(JSON.stringify(update)).not.toContain("Calling tool");
  });

  it("updates a running tool step with its result and does not treat tool failures as fatal", () => {
    const running = parseWeKnoraResearchEvent({
      response_type: "tool_call",
      data: { tool_call_id: "call-1", tool_name: "web_search" },
    }).step!;
    const completed = parseWeKnoraResearchEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "call-1",
        tool_name: "web_search",
        success: true,
        duration_ms: 1240,
      },
    });

    expect(mergeFredResearchStep([running], completed.step!)).toEqual([{
      id: "call-1",
      kind: "web",
      status: "completed",
      label: "Websuche durchgeführt",
      durationMs: 1240,
    }]);
    expect(parseWeKnoraResearchEvent({
      response_type: "error",
      data: { tool_call_id: "call-2", tool_name: "web_search" },
    })).toMatchObject({ fatalError: false, step: { status: "failed" } });
  });

  it("turns reference events into a source summary", () => {
    const update = parseWeKnoraResearchEvent({
      response_type: "references",
      data: {
        event_id: "refs-1",
        references: [{
          document_name: "EStG_1988.md",
          chunk_id: "chunk-2",
          kb_id: "kb-2",
        }],
      },
    });

    expect(update.step).toMatchObject({
      id: "refs-1",
      kind: "sources",
      status: "completed",
      label: "1 Quelle gefunden",
    });
    expect(update.sources).toEqual([{
      kind: "knowledge",
      doc: "EStG_1988.md",
      chunkId: "chunk-2",
      knowledgeBaseId: "kb-2",
    }]);
  });

  describe("reasoning extraction from thinking events", () => {
    it("parses a thinking event as a reasoning step with German label and the raw content", () => {
      const update = parseWeKnoraResearchEvent({
        response_type: "thinking",
        data: {
          event_id: "think-1",
          content: "Der Nutzer fragt nach § 42 EStG – ich muss zuerst die Rechtsgrundlage prüfen.",
        },
      });

      expect(update.step).toEqual({
        id: "think-1",
        kind: "reasoning",
        status: "running",
        label: "Überlegung",
        detail: "Der Nutzer fragt nach § 42 EStG – ich muss zuerst die Rechtsgrundlage prüfen.",
      });
      expect(update.sources).toEqual([]);
      expect(update.fatalError).toBe(false);
    });

    it("accumulates repeated thinking chunks with the same event ID by appending content", () => {
      const first = parseWeKnoraResearchEvent({
        response_type: "thinking",
        data: { event_id: "think-1", content: "Schritt 1: Wissensbasis durchsuchen." },
      });
      const second = parseWeKnoraResearchEvent({
        response_type: "thinking",
        data: { event_id: "think-1", content: " Schritt 2: Websuche starten." },
      });

      const merged = mergeFredResearchStep(
        [first.step!],
        second.step!,
      );

      expect(merged).toEqual([{
        id: "think-1",
        kind: "reasoning",
        status: "running",
        label: "Überlegung",
        detail: "Schritt 1: Wissensbasis durchsuchen. Schritt 2: Websuche starten.",
      }]);
    });

    it("marks a thinking event as completed when done is true without erasing accumulated content", () => {
      const running = parseWeKnoraResearchEvent({
        response_type: "thinking",
        data: { event_id: "think-1", content: "Erste Überlegung." },
      });
      const done = parseWeKnoraResearchEvent({
        response_type: "thinking",
        data: { event_id: "think-1", done: true },
      });

      const merged = mergeFredResearchStep(
        [running.step!],
        done.step!,
      );

      expect(merged).toEqual([{
        id: "think-1",
        kind: "reasoning",
        status: "completed",
        label: "Überlegung",
        detail: "Erste Überlegung.",
      }]);
    });

    it("caps reasoning detail at 100000 characters so malformed streams cannot grow indefinitely", () => {
      const big = "A".repeat(150_000);
      const update = parseWeKnoraResearchEvent({
        response_type: "thinking",
        data: { event_id: "think-1", content: big },
      });

      expect(update.step?.detail?.length).toBe(100_000);
    });

    it("does not produce a step for an empty thinking content chunk", () => {
      const update = parseWeKnoraResearchEvent({
        response_type: "thinking",
        data: { event_id: "think-1", content: "" },
      });

      expect(update.step).toBeUndefined();
    });

    it("accepts thinking content at the event level as well", () => {
      const update = parseWeKnoraResearchEvent({
        response_type: "thinking",
        event_id: "think-top",
        content: "Top-level reasoning.",
      });

      expect(update.step).toMatchObject({
        id: "think-top",
        kind: "reasoning",
        detail: "Top-level reasoning.",
      });
    });
  });

  describe("tool_call query detail", () => {
    it("includes a non-empty arguments.query as a bounded detail", () => {
      const update = parseWeKnoraResearchEvent({
        response_type: "tool_call",
        data: {
          tool_call_id: "call-1",
          tool_name: "knowledge_search",
          arguments: { query: "EStG § 42 Betriebsausgaben" },
        },
      });

      expect(update.step).toMatchObject({
        id: "call-1",
        kind: "knowledge",
        status: "running",
        label: "Wissensbasis wird durchsucht",
        detail: "EStG § 42 Betriebsausgaben",
      });
    });

    it("caps the arguments.query detail at 500 characters", () => {
      const long = "Q".repeat(1_000);
      const update = parseWeKnoraResearchEvent({
        response_type: "tool_call",
        data: {
          tool_call_id: "call-1",
          tool_name: "web_search",
          arguments: { query: long },
        },
      });

      expect(update.step?.detail?.length).toBeLessThanOrEqual(500);
    });

    it("does not include detail when arguments.query is absent or empty", () => {
      const noQuery = parseWeKnoraResearchEvent({
        response_type: "tool_call",
        data: { tool_call_id: "call-1", tool_name: "knowledge_search", arguments: {} },
      });
      expect(noQuery.step?.detail).toBeUndefined();

      const emptyQuery = parseWeKnoraResearchEvent({
        response_type: "tool_call",
        data: { tool_call_id: "call-1", tool_name: "knowledge_search", arguments: { query: "" } },
      });
      expect(emptyQuery.step?.detail).toBeUndefined();
    });

    it("does not store raw tool results or arbitrary argument objects", () => {
      const update = parseWeKnoraResearchEvent({
        response_type: "tool_call",
        data: {
          tool_call_id: "call-1",
          tool_name: "knowledge_search",
          arguments: { query: "legit", secret: "hidden-key", nested: { deep: "leak" } },
        },
      });

      expect(update.step?.detail).toBe("legit");
      expect(JSON.stringify(update)).not.toContain("hidden-key");
      expect(JSON.stringify(update)).not.toContain("deep");
      expect(JSON.stringify(update)).not.toContain("leak");
    });

    it("does not add detail for tool_result events even when arguments.query is present", () => {
      const update = parseWeKnoraResearchEvent({
        response_type: "tool_result",
        data: {
          tool_call_id: "call-1",
          tool_name: "knowledge_search",
          success: true,
          arguments: { query: "should not appear" },
        },
      });

      expect(update.step?.detail).toBeUndefined();
    });
  });

  describe("parseStoredFredResearchTrace reasoning", () => {
    it("round-trips a stored reasoning step with its full detail", () => {
      const stored = [{
        id: "think-1",
        kind: "reasoning",
        status: "completed",
        label: "Überlegung",
        detail: "Some reasoning detail here.".repeat(50),
      }];

      const parsed = parseStoredFredResearchTrace(stored);
      expect(parsed).toEqual(stored);
    });

    it("rejects unknown step kinds", () => {
      const parsed = parseStoredFredResearchTrace([{
        id: "x-1",
        kind: "unknown",
        status: "completed",
        label: "Bad",
      }]);
      expect(parsed).toEqual([]);
    });
  });
});
