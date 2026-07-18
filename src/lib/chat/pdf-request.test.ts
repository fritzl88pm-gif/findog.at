import { describe, expect, it } from "vitest";

import {
  derivePdfOfferTitle,
  isExistingAnswerPdfRequest,
  isExplicitPdfCreationRequest,
  isReferentialPdfRequest,
} from "./pdf-request";

describe("PDF request intent", () => {
  it.each([
    "Bitte eine Stellungnahme als PDF erstellen.",
    "PDF erzeugen",
    "Kannst du die Antwort als PDF ausgeben?",
    "Gib den Entwurf als PDF aus.",
    "Den Entwurf bitte als PDF exportieren.",
    "PDF herunterladen",
    "PDF bitte",
    "PDF-Export bitte.",
    "Die Liste der Medikamente als PDF",
    "Gib mir diese Aufstellung samt Begründungen als PDF.",
    "Gib mir die drei von dir gefundenen Urteile als PDF.",
    "Kann ich diese Aufstellung als PDF herunterladen?",
    "Wie besprochen, gib mir die Aufstellung als PDF aus.",
    "Was steht in diesem PDF? Erstelle danach eine Zusammenfassung als PDF.",
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

  it.each([
    "Gib mir diese Aufstellung samt Begründungen als PDF.",
    "Gib mir die drei von dir gefundenen Urteile als PDF.",
    "Bitte die vorherige Antwort als PDF exportieren.",
    "Davon bitte ein PDF.",
    "Mach daraus ein PDF.",
    "Als PDF bitte.",
    "PDF bitte",
    "PDF-Export bitte.",
  ])("recognizes a PDF export of existing conversation content: %s", (request) => {
    expect(isExistingAnswerPdfRequest(request)).toBe(true);
  });

  it.each([
    "Erstelle eine neue Aufstellung zum UAB 2024 als PDF.",
    "Die Liste der Medikamente als PDF",
    "Bitte analysiere diesen Bescheid und erstelle ein PDF.",
    "Ergänze die obige Aufstellung um Begründungen und gib sie als PDF aus.",
    "Davon bitte ein PDF mit Stand 2026.",
  ])("does not mistake a new PDF content request for a follow-up export: %s", (request) => {
    expect(isExistingAnswerPdfRequest(request)).toBe(false);
  });

  it("keeps a requested substantive edit referential so research can retain conversation context", () => {
    expect(isReferentialPdfRequest(
      "Ergänze die obige Aufstellung um Begründungen und gib sie als PDF aus.",
    )).toBe(true);
    expect(isExistingAnswerPdfRequest(
      "Ergänze die obige Aufstellung um Begründungen und gib sie als PDF aus.",
    )).toBe(false);
  });

  it("derives a concise document title and skips generic overview headings", () => {
    expect(derivePdfOfferTitle(
      "# 📘 Überblick\n\n## Unterhaltsabsetzbetrag 2024\n\nInhalt",
      "Wie hoch ist der UAB 2024?",
    )).toBe("Unterhaltsabsetzbetrag 2024");
  });
});
