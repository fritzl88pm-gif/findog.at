import { describe, expect, it } from "vitest";

import {
  isExplicitPdfCreationRequest,
  shouldOfferChatPdfDownload,
} from "./pdf-request";

describe("PDF request intent", () => {
  it.each([
    "Bitte eine Stellungnahme als PDF erstellen.",
    "PDF erzeugen",
    "Kannst du die Antwort als PDF ausgeben?",
    "Gib den Entwurf als PDF aus.",
    "Den Entwurf bitte als PDF exportieren.",
    "PDF herunterladen",
    "Die Liste der Medikamente als PDF",
  ])("recognizes an explicit creation or export request: %s", (request) => {
    expect(isExplicitPdfCreationRequest(request)).toBe(true);
  });

  it.each([
    "Was steht in diesem PDF?",
    "Wie kann ich ein PDF erstellen?",
    "Welche Programme können ein PDF erstellen?",
    "Kann man ein PDF erzeugen?",
    "Kannst du mir erklären, wie ich ein PDF erstellen kann?",
    "Bitte analysiere den Anhang.\n\nPDF-Anhang: bescheid.pdf",
    "Ich habe das PDF erstellt und hochgeladen. Bitte prüfe es.",
    "Bitte erstelle eine kurze Stellungnahme.",
  ])("does not recognize information, upload, or non-PDF requests: %s", (request) => {
    expect(isExplicitPdfCreationRequest(request)).toBe(false);
  });

  it("requires an assistant answer before offering a download", () => {
    expect(shouldOfferChatPdfDownload("Bitte als PDF erstellen", "Ausformulierte Antwort")).toBe(true);
    expect(shouldOfferChatPdfDownload("Bitte als PDF erstellen", "   ")).toBe(false);
  });
});
