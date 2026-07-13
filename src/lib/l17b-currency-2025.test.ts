import { describe, expect, it } from "vitest";

import {
  L17B_CURRENCY_2025_ENTRIES,
  parseL17bGermanAmount,
  formatL17bEuro,
  formatL17bForeignAmount,
  convertL17bCurrency,
  lookupL17bEntry,
} from "./l17b-currency-2025";

describe("L17b 2025 currency calculator", () => {
  it("has exactly 30 selectable source entries", () => {
    expect(L17B_CURRENCY_2025_ENTRIES).toHaveLength(30);
  });

  it("does not contain excluded x-currency codes", () => {
    const codes = L17B_CURRENCY_2025_ENTRIES.map((e) => e.currencyCode);
    const excluded = ["CYP", "EEK", "GRD", "HRK", "LTL", "LVL", "MTL", "RUB", "SIT", "SKK"];
    for (const code of excluded) {
      expect(codes).not.toContain(code);
    }
  });

  it("preserves exact source Steuerwert strings for key entries", () => {
    const aud = lookupL17bEntry("AUD");
    expect(aud?.steuerwertRaw).toBe("0,562279");

    const chf = lookupL17bEntry("CHF");
    expect(chf?.steuerwertRaw).toBe("1,051227");

    const inr = lookupL17bEntry("INR");
    expect(inr?.steuerwertRaw).toBe("0,009998");

    const usd = lookupL17bEntry("USD");
    expect(usd?.steuerwertRaw).toBe("0,871681");
  });

  it("parses the Steuerwert correctly for calculation", () => {
    const aud = lookupL17bEntry("AUD")!;
    expect(aud.steuerwert).toBeCloseTo(0.562279, 6);

    const usd = lookupL17bEntry("USD")!;
    expect(usd.steuerwert).toBeCloseTo(0.871681, 6);

    const chf = lookupL17bEntry("CHF")!;
    expect(chf.steuerwert).toBeCloseTo(1.051227, 6);
  });

  it("converts 100 AUD to 56,23 €", () => {
    const result = convertL17bCurrency("AUD", 100);
    expect(result).not.toBeNull();
    expect(formatL17bEuro(result!)).toBe("56,23 €");
  });

  it("converts 100 CHF to 105,12 €", () => {
    const result = convertL17bCurrency("CHF", 100);
    expect(result).not.toBeNull();
    expect(formatL17bEuro(result!)).toBe("105,12 €");
  });

  it("converts 100 USD to 87,17 €", () => {
    const result = convertL17bCurrency("USD", 100);
    expect(result).not.toBeNull();
    expect(formatL17bEuro(result!)).toBe("87,17 €");
  });

  it("converts 0 amount to 0,00 €", () => {
    const result = convertL17bCurrency("USD", 0);
    expect(result).not.toBeNull();
    expect(formatL17bEuro(result!)).toBe("0,00 €");
  });

  it("returns null for unknown currency code", () => {
    expect(convertL17bCurrency("XYZ", 100)).toBeNull();
    expect(lookupL17bEntry("XYZ")).toBeUndefined();
  });

  describe("parseL17bGermanAmount", () => {
    it("parses common German notations", () => {
      expect(parseL17bGermanAmount("1.308,70")).toBe(1308.7);
      expect(parseL17bGermanAmount("1308,70 €")).toBe(1308.7);
      expect(parseL17bGermanAmount("1.234.567,89")).toBe(1234567.89);
      expect(parseL17bGermanAmount("100")).toBe(100);
      expect(parseL17bGermanAmount("0")).toBe(0);
      expect(parseL17bGermanAmount("0,50")).toBe(0.5);
    });

    it("rejects blank input", () => {
      expect(parseL17bGermanAmount("")).toBeNull();
      expect(parseL17bGermanAmount("   ")).toBeNull();
    });

    it("rejects negative amounts", () => {
      expect(parseL17bGermanAmount("-1,00")).toBeNull();
      expect(parseL17bGermanAmount("-100")).toBeNull();
    });

    it("rejects malformed input", () => {
      expect(parseL17bGermanAmount("abc")).toBeNull();
      expect(parseL17bGermanAmount("1.2.3,4")).toBeNull();
      expect(parseL17bGermanAmount("1,,2")).toBeNull();
    });

    it("rejects NaN and Infinity-like input", () => {
      expect(parseL17bGermanAmount("NaN")).toBeNull();
      expect(parseL17bGermanAmount("Infinity")).toBeNull();
    });
  });

  describe("formatL17bEuro", () => {
    it("formats with de-AT style and exactly two decimal places", () => {
      expect(formatL17bEuro(56.2279)).toBe("56,23 €");
      expect(formatL17bEuro(105.1227)).toBe("105,12 €");
      expect(formatL17bEuro(87.1681)).toBe("87,17 €");
      expect(formatL17bEuro(1234567.89)).toBe("1.234.567,89 €");
    });
  });

  describe("all 30 entries have valid structure", () => {
    it.each(L17B_CURRENCY_2025_ENTRIES)(
      "entry $country ($currencyCode) has a numeric steuerwert",
      (entry) => {
        expect(entry.country).toBeTruthy();
        expect(entry.currencyCode).toMatch(/^[A-Z]{3}$/);
        expect(entry.currencyName).toBeTruthy();
        expect(entry.steuerwertRaw).toMatch(/^\d+,\d+$/);
        expect(entry.steuerwert).toBeGreaterThan(0);
        expect(typeof entry.steuerwert).toBe("number");
      },
    );
  });
});

describe("formatL17bForeignAmount", () => {
  it("formats a foreign amount with de-AT style and appends the ISO code, not the Euro symbol", () => {
    expect(formatL17bForeignAmount(100, "USD")).toBe("100,00 USD");
    expect(formatL17bForeignAmount(1234.56, "JPY")).toBe("1.234,56 JPY");
    expect(formatL17bForeignAmount(87.1681, "CHF")).toBe("87,17 CHF");
    expect(formatL17bForeignAmount(0, "EUR")).toBe("0,00 EUR");
  });
});
