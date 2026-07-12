import { describe, expect, it } from "vitest";

import {
  buildGermanSvPensionPdfDocument,
  calculateGermanSvPension,
  formatGermanSvEuro,
  formatGermanSvRate,
  getGermanSvPensionRate,
  parseGermanSvAmount,
  type GermanSvPensionMode,
  type GermanSvPensionYear,
} from "./german-sv-pension";
import { parsePdfContentBlocks } from "./documents/pdf";

describe("Deutsche SV Rente calculator", () => {
  it.each([
    [2024, 0.051, "5,10 %"],
    [2025, 0.0561395, "5,61395 %"],
    [2026, 0.06, "6,0 %"],
  ] as const)("uses the authorized %i rate", (year, rate, displayedRate) => {
    expect(getGermanSvPensionRate(year)).toMatchObject({ rate });
    expect(formatGermanSvRate(year)).toBe(displayedRate);
  });

  it.each([
    [2024, "kv", 1308.7, "25.006,43 €", "1.308,70 €"],
    [2024, "rentenbrutto", 25660.74, "25.006,39 €", "1.308,70 €"],
    [2025, "kv", 1654.43, "28.642,77 €", "1.654,43 €"],
    [2025, "rentenbrutto", 29470, "28.642,78 €", "1.654,43 €"],
    [2026, "rentenbrutto", 10000, "9.700,00 €", "600,00 €"],
  ] as const)(
    "%i %s mode calculates the accepted tax figures",
    (year, mode, amount, expectedKz453, expectedKz184) => {
      const result = calculateGermanSvPension(
        year as GermanSvPensionYear,
        mode as GermanSvPensionMode,
        amount,
      );

      expect(formatGermanSvEuro(result.kz453)).toBe(expectedKz453);
      expect(formatGermanSvEuro(result.kz184)).toBe(expectedKz184);
    },
  );

  it("parses common German amount notation and rejects invalid input", () => {
    expect(parseGermanSvAmount("1.308,70")).toBe(1308.7);
    expect(parseGermanSvAmount("1308,70 €")).toBe(1308.7);
    expect(parseGermanSvAmount("")).toBeNull();
    expect(parseGermanSvAmount("abc")).toBeNull();
    expect(parseGermanSvAmount("-1,00")).toBeNull();
  });

  it.each([
    {
      year: 2024 as const,
      mode: "kv" as const,
      amount: 1308.7,
      title: "Berechnungsblatt zur deutschen Sozialversicherungsrente 2024",
      foundations: [
        ["Veranlagungsjahr", "2024"],
        ["Eingabeart", "KV-Beitrag"],
        ["Eingabewert", "1.308,70 €"],
        ["KV-Beitragssatz (§ 73a ASVG)", "5,10 %"],
        ["Halber Beitragssatz", "2,55 %"],
        ["Kz-453-Faktor", "97,45 %"],
      ],
      calculations: [
        ["Österreichischer KV-Beitrag", "Eingabewert (KV-Beitrag)", "1.308,70 €"],
        ["Deutscher Zuschuss zur Krankenversicherung", "Österreichischer KV-Beitrag ÷ 2", "654,35 €"],
        [
          "Deutscher Jahresbetrag der Rente bzw. KV-Bemessungsgrundlage",
          "Österreichischer KV-Beitrag ÷ KV-Beitragssatz",
          "25.660,78 €",
        ],
        ["Kz 453", "KV-Bemessungsgrundlage × Kz-453-Faktor", "25.006,43 €"],
        ["Kz 184", "Österreichischer KV-Beitrag", "1.308,70 €"],
      ],
    },
    {
      year: 2025 as const,
      mode: "rentenbrutto" as const,
      amount: 29470,
      title: "Berechnungsblatt zur deutschen Sozialversicherungsrente 2025",
      foundations: [
        ["Veranlagungsjahr", "2025"],
        ["Eingabeart", "Rentenbrutto / AEOI-KM"],
        ["Eingabewert", "29.470,00 €"],
        ["KV-Beitragssatz (§ 73a ASVG)", "5,61395 %"],
        ["Halber Beitragssatz", "2,806975 %"],
        ["Kz-453-Faktor", "97,193025 %"],
      ],
      calculations: [
        [
          "Österreichischer KV-Beitrag",
          "Eingabewert (Rentenbrutto / AEOI-KM) × KV-Beitragssatz",
          "1.654,43 €",
        ],
        [
          "Deutscher Zuschuss zur Krankenversicherung",
          "Eingabewert (Rentenbrutto / AEOI-KM) × halber Beitragssatz",
          "827,22 €",
        ],
        [
          "Deutscher Jahresbetrag der Rente bzw. KV-Bemessungsgrundlage",
          "Eingabewert (Rentenbrutto / AEOI-KM)",
          "29.470,00 €",
        ],
        ["Kz 453", "KV-Bemessungsgrundlage × Kz-453-Faktor", "28.642,78 €"],
        ["Kz 184", "Österreichischer KV-Beitrag", "1.654,43 €"],
      ],
    },
  ])("builds neutral tabular PDF content for $mode mode", ({ year, mode, amount, title, foundations, calculations }) => {
    const document = buildGermanSvPensionPdfDocument(year, mode, amount);

    expect(document.title).toBe(title);
    expect(`${document.title}\n${document.content}`).not.toMatch(/Findog|Fred/i);
    expect(parsePdfContentBlocks(document.content)).toEqual([
      { type: "heading", level: 2, text: "Berechnungsgrundlagen" },
      {
        type: "table",
        headers: ["Grundlage", "Wert"],
        alignments: ["left", "right"],
        rows: foundations,
      },
      { type: "heading", level: 2, text: "Berechnung und Kennzahlen" },
      {
        type: "table",
        headers: ["Position", "Grundlage", "Betrag"],
        alignments: ["left", "left", "right"],
        rows: calculations,
      },
    ]);
  });
});
