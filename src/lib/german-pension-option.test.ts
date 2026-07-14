import { describe, expect, it } from "vitest";

import {
  lookupExemptionRate,
  lookupBasicAllowance,
  calculateGermanPensionOption,
  parseGermanPensionAmount,
  formatGermanPensionEuro,
  type GermanPensionOptionAvailable,
  type GermanPensionOptionUnavailable,
} from "./german-pension-option";

describe("German pension option quick-check", () => {
  describe("exemption rate lookup", () => {
    it("returns 0.28 for first full pension year 2016", () => {
      expect(lookupExemptionRate(2016)).toBe(0.28);
    });

    it("returns 0.50 for first full pension year 2005", () => {
      expect(lookupExemptionRate(2005)).toBe(0.50);
    });

    it("returns 0.175 for first full pension year 2023", () => {
      expect(lookupExemptionRate(2023)).toBe(0.175);
    });

    it("returns 0.17 for first full pension year 2024", () => {
      expect(lookupExemptionRate(2024)).toBe(0.17);
    });

    it("returns 0.15 for first full pension year 2028", () => {
      expect(lookupExemptionRate(2028)).toBe(0.15);
    });

    it("returns null for unknown year 2004", () => {
      expect(lookupExemptionRate(2004)).toBeNull();
    });

    it("returns null for unknown year 2029", () => {
      expect(lookupExemptionRate(2029)).toBeNull();
    });
  });

  describe("basic allowance lookup", () => {
    it("returns 12348 for year 2026", () => {
      expect(lookupBasicAllowance(2026)).toBe(12348);
    });

    it("returns 11784 for year 2024", () => {
      expect(lookupBasicAllowance(2024)).toBe(11784);
    });

    it("returns 8652 for year 2016", () => {
      expect(lookupBasicAllowance(2016)).toBe(8652);
    });

    it("returns null for unknown year 2027", () => {
      expect(lookupBasicAllowance(2027)).toBeNull();
    });

    it("returns null for unknown year 2004", () => {
      expect(lookupBasicAllowance(2004)).toBeNull();
    });
  });

  describe("calculation", () => {
    it("computes fixed exemption, progression income, difference, and optionPossible correctly", () => {
      // firstFullYear: 2016 → rate 0.28
      // firstFullGrossPension: 12.000 €
      // currentAnnualPension: 14.000 €
      // currentYear: 2026 → basic allowance 12.348 €
      const result = calculateGermanPensionOption({
        currentYear: 2026,
        firstFullPensionYear: 2016,
        firstFullGrossPension: 12000,
        currentAnnualGrossPension: 14000,
      }) as GermanPensionOptionAvailable;

      expect(result.exemptionRate).toBe(0.28);
      expect(result.fixedPensionExemptionEur).toBe(3360);
      expect(result.progressionIncomeEur).toBe(10640);
      expect(result.basicAllowanceEur).toBe(12348);
      expect(result.differenceToBasicAllowanceEur).toBe(-1708);
      expect(result.optionPossible).toBe(true);
    });

    it("regression: currentYear 2023, firstFullPensionYear 2016, gross 12000 / 14000", () => {
      const result = calculateGermanPensionOption({
        currentYear: 2023,
        firstFullPensionYear: 2016,
        firstFullGrossPension: 12000,
        currentAnnualGrossPension: 14000,
      }) as GermanPensionOptionAvailable;

      expect(result.exemptionRate).toBe(0.28);
      expect(result.fixedPensionExemptionEur).toBe(3360);
      expect(result.progressionIncomeEur).toBe(10640);
      expect(result.basicAllowanceEur).toBe(10908);
      expect(result.differenceToBasicAllowanceEur).toBe(-268);
      expect(result.optionPossible).toBe(true);
    });

    it("keeps fixed pension exemption unchanged when only current annual pension changes", () => {
      // Same first-full-year inputs but different current pension
      const result1 = calculateGermanPensionOption({
        currentYear: 2026,
        firstFullPensionYear: 2016,
        firstFullGrossPension: 12000,
        currentAnnualGrossPension: 14000,
      }) as GermanPensionOptionAvailable;

      const result2 = calculateGermanPensionOption({
        currentYear: 2026,
        firstFullPensionYear: 2016,
        firstFullGrossPension: 12000,
        currentAnnualGrossPension: 50000,
      }) as GermanPensionOptionAvailable;

      expect(result1.fixedPensionExemptionEur).toBe(3360);
      expect(result2.fixedPensionExemptionEur).toBe(3360);
    });

    it("returns optionPossible === false when difference is positive", () => {
      // firstFullYear: 2005 → rate 0.50
      // firstFullGrossPension: 10.000 € → exemption 5.000 €
      // currentAnnualPension: 20.000 € → progression 15.000 €
      // currentYear: 2026 → basic allowance 12.348 €
      // difference = 15.000 - 12.348 = 2.652 > 0
      const result = calculateGermanPensionOption({
        currentYear: 2026,
        firstFullPensionYear: 2005,
        firstFullGrossPension: 10000,
        currentAnnualGrossPension: 20000,
      }) as GermanPensionOptionAvailable;

      expect(result.optionPossible).toBe(false);
      expect(result.differenceToBasicAllowanceEur).toBe(2652);
      expect(result.fixedPensionExemptionEur).toBe(5000);
    });

    it("returns unavailable when lookup year is absent with no extrapolation", () => {
      const result = calculateGermanPensionOption({
        currentYear: 2029,
        firstFullPensionYear: 2016,
        firstFullGrossPension: 12000,
        currentAnnualGrossPension: 14000,
      }) as GermanPensionOptionUnavailable;

      expect(result.available).toBe(false);
      expect(result.unavailableReason).toBe(
        "Für das Jahr 2029 ist kein Grundfreibetrag hinterlegt.",
      );
    });

    it("returns unavailable when first full pension year is unknown", () => {
      const result = calculateGermanPensionOption({
        currentYear: 2026,
        firstFullPensionYear: 2004,
        firstFullGrossPension: 12000,
        currentAnnualGrossPension: 14000,
      }) as GermanPensionOptionUnavailable;

      expect(result.available).toBe(false);
      expect(result.unavailableReason).toBe(
        "Für das erste volle Bezugsjahr 2004 ist kein Rentenfreibetragssatz hinterlegt.",
      );
    });

    it("returns unavailable when first full pension year is after current year", () => {
      const result = calculateGermanPensionOption({
        currentYear: 2024,
        firstFullPensionYear: 2025,
        firstFullGrossPension: 12000,
        currentAnnualGrossPension: 14000,
      }) as GermanPensionOptionUnavailable;

      expect(result.available).toBe(false);
      expect(result.unavailableReason).toBe(
        "Das erste volle Bezugsjahr (2025) darf nicht nach dem aktuellen Jahr (2024) liegen.",
      );
    });
  });

  describe("German amount parsing", () => {
    it("parses German notation 1.308,70", () => {
      expect(parseGermanPensionAmount("1.308,70")).toBe(1308.7);
    });

    it("parses 1308,70 €", () => {
      expect(parseGermanPensionAmount("1308,70 €")).toBe(1308.7);
    });

    it("returns null for empty string", () => {
      expect(parseGermanPensionAmount("")).toBeNull();
    });

    it("returns null for invalid input", () => {
      expect(parseGermanPensionAmount("abc")).toBeNull();
    });

    it("returns null for negative input", () => {
      expect(parseGermanPensionAmount("-1,00")).toBeNull();
    });

    it("parses integer without decimal", () => {
      expect(parseGermanPensionAmount("12000")).toBe(12000);
    });

    it("parses 12.000", () => {
      expect(parseGermanPensionAmount("12.000")).toBe(12000);
    });
  });

  describe("amount formatting", () => {
    it("formats 12348 as 12.348,00 €", () => {
      expect(formatGermanPensionEuro(12348)).toBe("12.348,00 €");
    });

    it("formats 3360 as 3.360,00 €", () => {
      expect(formatGermanPensionEuro(3360)).toBe("3.360,00 €");
    });
  });
});
