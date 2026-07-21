import { describe, expect, it } from "vitest";

import {
  MAX_FRED_PDF_EXPORT_CHARS,
  buildFredConversationPdfContent,
  pdfFilenameFromHeader,
  precedingUserMessage,
  type FredActionMessage,
} from "./fred-actions";

const messages: FredActionMessage[] = [
  {
    role: "user",
    content: "Wie ist die Rechtslage?",
    createdAt: "2026-07-21T12:30:00.000Z",
    webSearchEnabled: true,
    attachments: [{ name: "Urteil\n2025.pdf" }],
  },
  {
    role: "assistant",
    content: "## Ergebnis\n\n| Punkt | Wert |\n| --- | --- |\n| A | B |",
    createdAt: "2026-07-21T12:31:00.000Z",
  },
];

describe("Fred message actions", () => {
  it("finds the user question belonging to a completed assistant answer", () => {
    expect(precedingUserMessage(messages, 1)?.content).toBe("Wie ist die Rechtslage?");
    expect(precedingUserMessage(messages, 0)).toBeUndefined();
  });

  it("creates a structured full-conversation PDF source with metadata", () => {
    const content = buildFredConversationPdfContent(messages);
    expect(content).toContain("## Du · 21.07.26, 14:30");
    expect(content).toContain("Websuche: aktiviert");
    expect(content).toContain("Anhänge: Urteil 2025.pdf");
    expect(content).toContain("## Fred · 21.07.26, 14:31");
    expect(content).toContain("| Punkt | Wert |");
    expect(MAX_FRED_PDF_EXPORT_CHARS).toBe(500_000);
  });

  it("accepts only the server's safe quoted PDF filename", () => {
    expect(pdfFilenameFromHeader('attachment; filename="Fred_2026.pdf"', "fallback.pdf"))
      .toBe("Fred_2026.pdf");
    expect(pdfFilenameFromHeader('attachment; filename="../unsafe.pdf"', "fallback.pdf"))
      .toBe("fallback.pdf");
  });
});
