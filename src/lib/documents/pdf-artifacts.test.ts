import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createPdfArtifactDrafts } from "./pdf-artifacts";

function pdfCall(id: string, title: string, content: string) {
  return {
    id,
    name: "create_pdf_document",
    arguments: JSON.stringify({
      title,
      content_markdown: content,
      stichtag: "2024-12-31",
    }),
  };
}

describe("createPdfArtifactDrafts", () => {
  it("creates a separate durable draft with cutoff and auditable context hashes", () => {
    const conversation = [
      { role: "user" as const, content: "Erstelle diese Aufstellung als PDF." },
      { role: "assistant" as const, content: "Die belegte Ausgangsantwort." },
    ];
    const content = "# Aufstellung\n\nVollständiger und eigenständiger Dokumentinhalt.";

    const result = createPdfArtifactDrafts({
      toolCalls: [pdfCall("call-1", "Aufstellung für 2024", content)],
      conversation,
      researchTools: ["hybrid_search"],
      createdAt: "2026-07-18T10:00:00.000Z",
    });

    expect(result.errors).toEqual([]);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]).toEqual(expect.objectContaining({
      title: "Aufstellung für 2024",
      filename: "Aufstellung_fur_2024.pdf",
      contentMarkdown: content,
      contentSha256: createHash("sha256").update(content, "utf8").digest("hex"),
      stichtag: "2024-12-31",
      provenance: expect.objectContaining({
        basis: "mixed",
        researchTools: ["hybrid_search"],
      }),
    }));
    expect(result.drafts[0]?.provenance.contextMessages).toEqual([
      expect.objectContaining({
        ordinal: 0,
        role: "user",
        sha256: createHash("sha256").update(conversation[0].content, "utf8").digest("hex"),
      }),
      expect.objectContaining({ ordinal: 1, role: "assistant" }),
    ]);
  });

  it("limits a single turn to three PDFs", () => {
    const result = createPdfArtifactDrafts({
      toolCalls: [1, 2, 3, 4].map((number) => pdfCall(
        `call-${number}`,
        `Dokument ${number}`,
        `# Dokument ${number}\n\nInhalt`,
      )),
      conversation: [{ role: "user", content: "Erstelle vier PDFs." }],
      researchTools: [],
    });

    expect(result.drafts).toHaveLength(3);
    expect(result.errors).toEqual(["Pro Antwort sind höchstens 3 PDF-Dokumente möglich."]);
  });

  it("rejects malformed content and invalid cutoff dates", () => {
    const result = createPdfArtifactDrafts({
      toolCalls: [{
        id: "call-invalid",
        name: "create_pdf_document",
        arguments: JSON.stringify({
          title: "Ungültig",
          content_markdown: "Inhalt",
          stichtag: "2024-02-31",
        }),
      }],
      conversation: [],
      researchTools: [],
    });

    expect(result.drafts).toEqual([]);
    expect(result.errors).toEqual(["Der PDF-Stichtag ist ungültig."]);
  });
});
