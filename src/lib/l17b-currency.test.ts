import { describe, expect, it } from "vitest";

import {
  L17B_FREQUENT_CURRENCY_CODES,
  L17B_YEARS,
  getL17bYearEntries,
  getL17bCountryCode,
  lookupL17bEntry,
  convertL17bCurrency,
  getL17bSourceNote,
  parseL17bGermanAmount,
  formatL17bEuro,
  formatL17bForeignAmount,
} from "./l17b-currency";

describe("L17b currency calculator – country dropdown", () => {
  it("keeps the requested frequently used countries in a fixed order", () => {
    expect(L17B_FREQUENT_CURRENCY_CODES).toEqual(["HUF", "PLN", "CZK", "CHF", "RON"]);
    expect(L17B_FREQUENT_CURRENCY_CODES.map((code) => lookupL17bEntry("2025", code)?.country)).toEqual([
      "Ungarn",
      "Polen",
      "Tschechische Republik",
      "Schweiz",
      "Rumänien",
    ]);
  });

  it("provides a country code for every selectable entry", () => {
    for (const year of L17B_YEARS) {
      for (const entry of getL17bYearEntries(year) ?? []) {
        expect(getL17bCountryCode(entry.currencyCode)).toMatch(/^[A-Z]{2}$/);
      }
    }
    expect(getL17bCountryCode("HUF")).toBe("HU");
    expect(getL17bCountryCode("PLN")).toBe("PL");
  });
});

describe("L17b currency calculator – year availability", () => {
  it("has exactly six selectable years in descending order", () => {
    expect(L17B_YEARS).toEqual(["2025", "2024", "2023", "2022", "2021", "2020"]);
  });

  it("provides entries for every year", () => {
    for (const year of L17B_YEARS) {
      expect(getL17bYearEntries(year)).toBeDefined();
    }
  });
});

describe("L17b currency calculator – selectable entry counts", () => {
  it("2020–2022 have exactly 32 selectable entries", () => {
    expect(getL17bYearEntries("2020")).toHaveLength(32);
    expect(getL17bYearEntries("2021")).toHaveLength(32);
    expect(getL17bYearEntries("2022")).toHaveLength(32);
  });

  it("2023–2025 have exactly 30 selectable entries", () => {
    expect(getL17bYearEntries("2023")).toHaveLength(30);
    expect(getL17bYearEntries("2024")).toHaveLength(30);
    expect(getL17bYearEntries("2025")).toHaveLength(30);
  });

  it("HRK and RUB are available in 2022 but unavailable in 2023", () => {
    const codes2022 = getL17bYearEntries("2022")!.map((e) => e.currencyCode);
    expect(codes2022).toContain("HRK");
    expect(codes2022).toContain("RUB");

    const codes2023 = getL17bYearEntries("2023")!.map((e) => e.currencyCode);
    expect(codes2023).not.toContain("HRK");
    expect(codes2023).not.toContain("RUB");
  });

  it("does not contain excluded x-currency codes in any year", () => {
    const excluded = ["CYP", "EEK", "GRD", "LTL", "LVL", "MTL", "SIT", "SKK"];
    for (const year of L17B_YEARS) {
      const codes = getL17bYearEntries(year)!.map((e) => e.currencyCode);
      for (const code of excluded) {
        expect(codes).not.toContain(code);
      }
    }
  });
});

describe("L17b currency calculator – exact Steuerwert values from source", () => {
  it("preserves 2020 USD Steuerwert", () => {
    const entry = lookupL17bEntry("2020", "USD")!;
    expect(entry.steuerwertRaw).toBe("0,862371");
    expect(entry.steuerwert).toBeCloseTo(0.862371, 6);
  });

  it("preserves 2022 HRK Steuerwert", () => {
    const entry = lookupL17bEntry("2022", "HRK")!;
    expect(entry.steuerwertRaw).toBe("0,130725");
    expect(entry.steuerwert).toBeCloseTo(0.130725, 6);
  });

  it("preserves 2023 USD Steuerwert", () => {
    const entry = lookupL17bEntry("2023", "USD")!;
    expect(entry.steuerwertRaw).toBe("0,910941");
    expect(entry.steuerwert).toBeCloseTo(0.910941, 6);
  });

  it("preserves 2024 CHF Steuerwert", () => {
    const entry = lookupL17bEntry("2024", "CHF")!;
    expect(entry.steuerwertRaw).toBe("1,034012");
    expect(entry.steuerwert).toBeCloseTo(1.034012, 6);
  });

  it("preserves 2025 existing authoritative Steuerwert values", () => {
    const aud = lookupL17bEntry("2025", "AUD")!;
    expect(aud.steuerwertRaw).toBe("0,562279");

    const chf = lookupL17bEntry("2025", "CHF")!;
    expect(chf.steuerwertRaw).toBe("1,051227");

    const inr = lookupL17bEntry("2025", "INR")!;
    expect(inr.steuerwertRaw).toBe("0,009998");

    const usd = lookupL17bEntry("2025", "USD")!;
    expect(usd.steuerwertRaw).toBe("0,871681");
  });
});

describe("L17b currency calculator – year-specific conversion", () => {
  it("converts 100 USD in 2020 using the 2020 rate", () => {
    const result = convertL17bCurrency("2020", "USD", 100);
    expect(result).not.toBeNull();
    expect(formatL17bEuro(result!)).toBe("86,24 €");
  });

  it("converts 100 USD in 2023 using the 2023 rate", () => {
    const result = convertL17bCurrency("2023", "USD", 100);
    expect(result).not.toBeNull();
    expect(formatL17bEuro(result!)).toBe("91,09 €");
  });

  it("converts 100 USD in 2025 using the 2025 rate", () => {
    const result = convertL17bCurrency("2025", "USD", 100);
    expect(result).not.toBeNull();
    expect(formatL17bEuro(result!)).toBe("87,17 €");
  });

  it("converts 100 CHF differently across years", () => {
    const r2020 = convertL17bCurrency("2020", "CHF", 100)!;
    const r2024 = convertL17bCurrency("2024", "CHF", 100)!;
    const r2025 = convertL17bCurrency("2025", "CHF", 100)!;
    // 2020: 0.920131, 2024: 1.034012, 2025: 1.051227
    expect(r2020).toBeCloseTo(92.0131, 4);
    expect(r2024).toBeCloseTo(103.4012, 4);
    expect(r2025).toBeCloseTo(105.1227, 4);
  });

  it("converts 0 amount to 0,00 € regardless of year", () => {
    for (const year of L17B_YEARS) {
      const result = convertL17bCurrency(year, "USD", 0)!;
      expect(formatL17bEuro(result)).toBe("0,00 €");
    }
  });

  it("returns null for unknown year", () => {
    expect(convertL17bCurrency("2019", "USD", 100)).toBeNull();
    expect(lookupL17bEntry("2019", "USD")).toBeUndefined();
  });

  it("returns null for unknown currency code in a known year", () => {
    expect(convertL17bCurrency("2025", "XYZ", 100)).toBeNull();
    expect(lookupL17bEntry("2025", "XYZ")).toBeUndefined();
  });

  it("returns null for a currency available in one year but not another", () => {
    // HRK exists in 2022 but not 2023
    expect(convertL17bCurrency("2022", "HRK", 100)).not.toBeNull();
    expect(convertL17bCurrency("2023", "HRK", 100)).toBeNull();
    expect(lookupL17bEntry("2023", "HRK")).toBeUndefined();
  });
});

describe("L17b currency calculator – source notes", () => {
  it("returns correct source notes for all six years", () => {
    expect(getL17bSourceNote("2020")).toBe("L 17b-2020, Version vom 05.01.2021");
    expect(getL17bSourceNote("2021")).toBe("L 17b-2021, Version vom 05.01.2022");
    expect(getL17bSourceNote("2022")).toBe("L 17b-2022, Version vom 13.01.2023");
    expect(getL17bSourceNote("2023")).toBe("L 17b-2023, Version vom 05.01.2024");
    expect(getL17bSourceNote("2024")).toBe("L 17b-2024, Version vom 08.01.2025");
    expect(getL17bSourceNote("2025")).toBe("L 17b-2025, Version vom 28.01.2026");
  });

  it("returns undefined for unknown year", () => {
    expect(getL17bSourceNote("2019")).toBeUndefined();
  });
});

describe("L17b currency calculator – all entries valid structure", () => {
  for (const year of L17B_YEARS) {
    it(`all ${year} entries have valid structure`, () => {
      const entries = getL17bYearEntries(year)!;
      for (const entry of entries) {
        expect(entry.country).toBeTruthy();
        expect(entry.currencyCode).toMatch(/^[A-Z]{3}$/);
        expect(entry.currencyName).toBeTruthy();
        expect(entry.steuerwertRaw).toMatch(/^\d+,\d+$/);
        expect(entry.steuerwert).toBeGreaterThan(0);
        expect(typeof entry.steuerwert).toBe("number");
      }
    });
  }
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

describe("formatL17bForeignAmount", () => {
  it("formats a foreign amount with de-AT style and appends the ISO code", () => {
    expect(formatL17bForeignAmount(100, "USD")).toBe("100,00 USD");
    expect(formatL17bForeignAmount(1234.56, "JPY")).toBe("1.234,56 JPY");
    expect(formatL17bForeignAmount(87.1681, "CHF")).toBe("87,17 CHF");
    expect(formatL17bForeignAmount(0, "EUR")).toBe("0,00 EUR");
  });
});
