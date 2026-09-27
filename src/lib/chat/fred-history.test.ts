import { describe, expect, it } from "vitest";

import { normalizeFredMessages } from "./fred-history";

const researchTrace = [
  { id: "kb-1", kind: "knowledge", status: "completed", label: "Wissensdatenbank durchsucht", detail: "EStR 2000" },
];
const executionTrace = [
  { id: "plan-1", kind: "planning", status: "completed", label: "Recherche geplant", durationMs: 120 },
];
const sourceReferences = [
  { kind: "web", url: "https://findok.bmf.gv.at/findok/volltext?gz=RV%2F7100001%2F2024", title: "BFG RV/7100001/2024" },
  { kind: "knowledge", doc: "EStR 2000 Rz 1234", chunkId: "chunk-1", knowledgeBaseId: "kb-estr" },
];

describe("normalizeFredMessages", () => {
  it("keeps the stored research trace, execution trace and sources of assistant answers", () => {
    const [assistant] = normalizeFredMessages([{
      id: 7,
      role: "assistant",
      content: "Antwort",
      createdAt: "2026-09-01T10:00:00.000Z",
      agentKey: "fred",
      researchTrace,
      executionTrace,
      sourceReferences,
    }]);

    expect(assistant.researchTrace).toEqual(researchTrace);
    expect(assistant.executionTrace).toEqual(executionTrace);
    expect(assistant.sourceReferences).toEqual(sourceReferences);
  });

  it("drops malformed trace and source entries and adds none to questions", () => {
    const [question, assistant] = normalizeFredMessages([
      {
        role: "user",
        content: "Frage",
        createdAt: "2026-09-01T09:59:00.000Z",
        researchTrace,
        sourceReferences,
        attachments: [{ kind: "file", name: "Bescheid.pdf", mimeType: "application/pdf", sizeBytes: 12 }],
      },
      {
        role: "assistant",
        content: "Antwort",
        researchTrace: [{ id: "x", kind: "unknown", status: "completed", label: "?" }],
        executionTrace: "kaputt",
        sourceReferences: [{ kind: "web", url: "javascript:alert(1)" }, null],
      },
    ]);

    expect(question).toEqual({
      role: "user",
      content: "Frage",
      createdAt: "2026-09-01T09:59:00.000Z",
      agentKey: "fred",
      attachments: [{ kind: "file", name: "Bescheid.pdf", mimeType: "application/pdf", sizeBytes: 12 }],
    });
    expect(assistant.researchTrace).toEqual([]);
    expect(assistant.executionTrace).toEqual([]);
    expect(assistant.sourceReferences).toEqual([]);
  });
});
