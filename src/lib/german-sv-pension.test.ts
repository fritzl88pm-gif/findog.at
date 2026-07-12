import { describe, expect, it } from "vitest";

import {
  calculateGermanSvPension,
  formatGermanSvEuro,
  formatGermanSvRate,
  getGermanSvPensionRate,
  parseGermanSvAmount,
  type GermanSvPensionMode,
  type GermanSvPensionYear,
} from "./german-sv-pension";

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
});
