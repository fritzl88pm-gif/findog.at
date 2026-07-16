import { describe, expect, it } from "vitest";

import { FORM_EXTRACTION_TIMEOUT_MS, parseStructuredFormFields } from "./extraction";

describe("structured Verf 5 extraction", () => {
  it("allows Gemini form extraction up to 270 seconds", () => {
    expect(FORM_EXTRACTION_TIMEOUT_MS).toBe(270_000);
  });

  it("retains only the expected string fields and excludes server/manual fields", () => {
    const result = parseStructuredFormFields(`\n\`\`\`json\n{
      "steuernummer": "12 345/6789",
      "vorname": " Anna ",
      "nachname": "Muster",
      "letzteadresse": "Hauptstraße 1, 1010 Wien",
      "sterbedatum": "03.04.2026",
      "datum": "01.01.1999",
      "saldo": "999999",
      "unknown": "ignored"
    }\n\`\`\`\n`);

    expect(result).toEqual({
      steuernummer: "12 345/6789",
      vorname: "Anna",
      nachname: "Muster",
      letzteadresse: "Hauptstraße 1, 1010 Wien",
      sterbedatum: "03.04.2026",
    });
    expect(result).not.toHaveProperty("datum");
    expect(result).not.toHaveProperty("saldo");
    expect(result).not.toHaveProperty("unknown");
  });

  it("normalizes missing and non-string expected fields to empty strings", () => {
    expect(parseStructuredFormFields({
      steuernummer: 123,
      vorname: null,
      nachname: "Muster",
      sterbedatum: false,
    })).toEqual({
      steuernummer: "",
      vorname: "",
      nachname: "Muster",
      letzteadresse: "",
      sterbedatum: "",
    });
  });

  it("rejects malformed model JSON instead of inventing field values", () => {
    expect(() => parseStructuredFormFields("not json")).toThrow("gültige");
  });
});
