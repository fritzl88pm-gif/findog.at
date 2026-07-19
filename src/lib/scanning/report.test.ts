import { describe, expect, it } from "vitest";

import { buildScanningReport } from "./report";
import type { ScanningDocument, ScanningFileStatus } from "./types";

function document(overrides: Partial<ScanningDocument>): ScanningDocument {
  return {
    documentId: "file-1:1",
    fileId: "file-1",
    fileName: "Beleg.pdf",
    documentType: "Rechnung",
    date: "2026-01-01",
    issuer: "Lieferant",
    documentNumber: "R-1",
    description: "Büromaterial",
    category: "Büro",
    currency: "EUR",
    net: "10.10",
    tax: "2.02",
    gross: "12.12",
    vatBreakdown: [],
    warnings: [],
    confidence: "high",
    ...overrides,
  };
}

describe("buildScanningReport", () => {
  it("sorts dated rows before unknown dates and sums exact cents per currency", () => {
    const documents = [
      document({ fileId: "late", fileName: "z.pdf", description: "Unbekanntes Datum", date: null, net: "0.10", tax: null, gross: "0.10" }),
      document({ fileId: "usd", fileName: "usd.pdf", description: "Dritter Beleg", date: "2026-01-03", currency: "USD", net: "5.00", tax: "1.00", gross: "6.00" }),
      document({ fileId: "early", fileName: "a.pdf", description: "Erster Beleg", date: "2025-12-31", net: "0.20", tax: "0.04", gross: "0.24" }),
    ];
    const files: ScanningFileStatus[] = documents.map((item) => ({
      id: item.fileId,
      name: item.fileName,
      kind: "pdf",
      status: "completed",
    }));

    const report = buildScanningReport({ documents, files, summary: "Drei Belege." });

    expect(report.indexOf("2025-12-31")).toBeLessThan(report.indexOf("2026-01-03"));
    expect(report.indexOf("2026-01-03")).toBeLessThan(report.indexOf("Unbekanntes Datum"));
    expect(report).toContain("**EUR:** Netto 0,30, USt 0,04, Brutto 0,34");
    expect(report).toContain("**USD:** Netto 5,00, USt 1,00, Brutto 6,00");
  });

  it("reports warnings, failures and byte-identical duplicates without inventing amounts", () => {
    const report = buildScanningReport({
      documents: [document({ net: null, tax: null, gross: null, warnings: ["Betrag unlesbar"] })],
      files: [
        { id: "file-1", name: "Beleg.pdf", kind: "pdf", status: "completed" },
        { id: "file-2", name: "kaputt.pdf", kind: "pdf", status: "failed", detail: "Nicht lesbar" },
        { id: "file-3", name: "Kopie.pdf", kind: "pdf", status: "duplicate" },
      ],
    });

    expect(report).toContain("Betrag unlesbar");
    expect(report).toContain("kaputt.pdf");
    expect(report).toContain("Kopie.pdf wurde nur einmal berücksichtigt");
    expect(report).toContain("Keine eindeutig summierbaren Beträge erkannt.");
  });
});
