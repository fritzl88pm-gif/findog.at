import { describe, expect, it } from "vitest";

import { formatViennaDate, normalizeManualSaldo } from "./values";

describe("form values", () => {
  it("formats the server date in Europe/Vienna across a UTC day boundary", () => {
    expect(formatViennaDate(new Date("2026-01-01T23:30:00.000Z"))).toBe("02.01.2026");
    expect(formatViennaDate(new Date("2026-07-10T21:30:00.000Z"))).toBe("10.07.2026");
    expect(formatViennaDate(new Date("2026-07-10T22:30:00.000Z"))).toBe("11.07.2026");
  });

  it.each([
    ["", "— "],
    ["   ", "— "],
    ["1234", "1.234,00 "],
    ["1234,5", "1.234,50 "],
    ["1234.56", "1.234,56 "],
    ["0001,2", "1,20 "],
  ])("normalizes a valid manual saldo %j for the unchanged euro suffix", (input, expected) => {
    expect(normalizeManualSaldo(input)).toBe(expected);
  });

  it.each(["1,234", "1.234", "12.3.4", "-1", "+1", "1 000", "1,", "abc", 42, null])(
    "rejects an invalid manual saldo %j",
    (input) => {
      expect(() => normalizeManualSaldo(input)).toThrow("Saldo");
    },
  );
});
