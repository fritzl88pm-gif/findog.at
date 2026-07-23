import { describe, expect, it } from "vitest";

import {
  MAX_FRED_PDF_EXPORT_CHARS,
  buildFredConversationPdfContent,
  messagesBeforeRegeneratedAnswer,
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

  it("builds a regeneration base without the answered question and stale answer", () => {
    const transcript: FredActionMessage[] = [
      { role: "user", content: "Erste Frage", createdAt: "" },
      { role: "assistant", content: "Erste Antwort", createdAt: "" },
      { role: "user", content: "Zweite Frage", createdAt: "" },
      { role: "assistant", content: "Veraltete Antwort", createdAt: "" },
    ];
    expect(messagesBeforeRegeneratedAnswer(transcript, 3)).toEqual(transcript.slice(0, 2));
  });

  it("creates a structured full-conversation PDF source with metadata", () => {
    const content = buildFredConversationPdfContent(messages);
    expect(content).toContain("## Du · 21.07.26, 14:30");
    expect(content).toContain("Websuche: aktiviert");
    expect(content).toContain("Agent: Fred");
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

  it("includes Pro-Modus: aktiviert in PDF metadata for Pro user turns", () => {
    const proMessages: FredActionMessage[] = [
      {
        role: "user",
        content: "Steuerfrage",
        createdAt: "2026-07-21T12:30:00.000Z",
        proModeEnabled: true,
      },
      {
        role: "assistant",
        content: "Antwort",
        createdAt: "2026-07-21T12:31:00.000Z",
      },
    ];
    const content = buildFredConversationPdfContent(proMessages);
    expect(content).toContain("Pro-Modus: aktiviert");
  });

  it("does not include Pro-Modus metadata for non-Pro user turns", () => {
    const content = buildFredConversationPdfContent(messages);
    expect(content).not.toContain("Pro-Modus");
  });

  it("attributes QuickFred user turns and answers in the PDF source", () => {
    const content = buildFredConversationPdfContent([
      {
        role: "user",
        content: "Kurzfrage",
        createdAt: "2026-07-21T12:30:00.000Z",
        agentKey: "quickfred",
      },
      {
        role: "assistant",
        content: "Kurzantwort",
        createdAt: "2026-07-21T12:31:00.000Z",
        agentKey: "quickfred",
      },
    ]);
    expect(content).toContain("Agent: QuickFred");
    expect(content).toContain("## QuickFred");
  });

  it("precedingUserMessage returns proModeEnabled when set", () => {
    const msgs: FredActionMessage[] = [
      { role: "user", content: "Pro Frage", createdAt: "", proModeEnabled: true },
      { role: "assistant", content: "Antwort", createdAt: "" },
    ];
    expect(precedingUserMessage(msgs, 1)?.proModeEnabled).toBe(true);
  });
});
