import { describe, expect, it } from "vitest";

import {
  mergeFredResearchStep,
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
});
