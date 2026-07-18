import { describe, expect, it } from "vitest";

import { UserVisibleError } from "./errors";
import { isKnownStichtag, resolveLegalStichtag } from "./legal-stichtag";

const NOW = new Date("2026-07-18T10:00:00.000Z");

describe("legal stichtag resolution", () => {
  it.each([
    ["Welche Rechtslage galt am 31.12.2024?", "2024-12-31", "31.12.2024"],
    ["Bitte mit Stand vom 2025-01-02 prüfen.", "2025-01-02", "2025-01-02"],
    ["Welche Fassung galt zum 1. Jänner 2023?", "2023-01-01", "1. Jänner 2023"],
    ["Nach der am 15/6/2022 geltenden Fassung?", "2022-06-15", "15/6/2022"],
  ])("resolves one marked legal date in %j", (question, stichtag, matchedText) => {
    expect(resolveLegalStichtag(question, NOW)).toEqual({
      kind: "explicit",
      stichtag,
      matchedText,
    });
  });

  it.each(["heute", "nach aktueller Rechtslage", "derzeit", "nach geltendem Recht"])(
    "uses the Vienna current date for %j",
    (wording) => {
      expect(resolveLegalStichtag(`Was gilt ${wording}?`, NOW)).toEqual({
        kind: "implicit",
        stichtag: "2026-07-18",
        reason: "current_word",
      });
    },
  );

  it("uses the Vienna calendar day across UTC boundaries", () => {
    expect(resolveLegalStichtag("Was gilt?", new Date("2026-01-01T23:30:00.000Z"))).toEqual({
      kind: "implicit",
      stichtag: "2026-01-02",
      reason: "default_current",
    });
    expect(resolveLegalStichtag("Was gilt?", new Date("2026-07-18T22:30:00.000Z"))).toEqual({
      kind: "implicit",
      stichtag: "2026-07-19",
      reason: "default_current",
    });
  });

  it("defaults to the Vienna current date when the question has no legal time signal", () => {
    expect(resolveLegalStichtag("Kann ich diese Ausgabe absetzen?", NOW)).toEqual({
      kind: "implicit",
      stichtag: "2026-07-18",
      reason: "default_current",
    });
  });

  it("does not mistake factual dates or statute names for a legal stichtag", () => {
    expect(
      resolveLegalStichtag(
        "Der Bescheid wurde am 31.03.2022 zugestellt. Was regelt § 33 EStG 1988?",
        NOW,
      ),
    ).toEqual({
      kind: "implicit",
      stichtag: "2026-07-18",
      reason: "default_current",
    });
  });

  it("recognizes a daily cutoff attached to a legal amount question", () => {
    expect(
      resolveLegalStichtag(
        "Wie hoch war der Unterhaltsabsetzbetrag am 1.7.2024?",
        NOW,
      ),
    ).toEqual({ kind: "explicit", stichtag: "2024-07-01", matchedText: "1.7.2024" });
  });

  it("recognizes plural legal predicates before a cutoff", () => {
    expect(
      resolveLegalStichtag("Welche Vorschriften galten am 31.12.2020?", NOW),
    ).toEqual({ kind: "explicit", stichtag: "2020-12-31", matchedText: "31.12.2020" });
  });

  it("does not turn a child's birth date into an amount-law cutoff", () => {
    expect(
      resolveLegalStichtag(
        "Wie hoch ist die Familienbeihilfe für ein am 1.7.2010 geborenes Kind?",
        NOW,
      ),
    ).toEqual({
      kind: "implicit",
      stichtag: "2026-07-18",
      reason: "default_current",
    });
  });

  it("ignores factual dates while retaining a separately marked legal date", () => {
    expect(
      resolveLegalStichtag(
        "Der Vertrag stammt vom 03.04.2020. Bitte nach der Rechtslage am 15.05.2021 prüfen.",
        NOW,
      ),
    ).toEqual({ kind: "explicit", stichtag: "2021-05-15", matchedText: "15.05.2021" });
  });

  it("returns unknown for a marked standalone year", () => {
    expect(resolveLegalStichtag("Welche Rechtslage galt im Jahr 2024?", NOW)).toEqual({
      kind: "unknown",
      stichtag: null,
      reason: "year_only",
      referenceYear: 2024,
    });
  });

  it("treats an annual legal-amount year as year-only, not as today's cutoff", () => {
    expect(
      resolveLegalStichtag(
        "Wie hoch ist die Familienbeihilfe 2024 für ein am 1.7.2010 geborenes Kind?",
        NOW,
      ),
    ).toEqual({
      kind: "unknown",
      stichtag: null,
      reason: "year_only",
      referenceYear: 2024,
    });
  });

  it("returns unknown for multiple marked dates", () => {
    expect(
      resolveLegalStichtag(
        "Vergleiche die Rechtslage am 31.12.2023 mit dem Stand vom 01.01.2024.",
        NOW,
      ),
    ).toEqual({ kind: "unknown", stichtag: null, reason: "ambiguous" });
  });

  it.each(["Was galt damals?", "Was war zu diesem Zeitpunkt erlaubt?"])(
    "returns unknown for the anaphoric wording %j",
    (question) => {
      expect(resolveLegalStichtag(question, NOW)).toEqual({
        kind: "unknown",
        stichtag: null,
        reason: "anaphoric",
      });
    },
  );

  it.each([
    "Stichtag: 31.02.2024",
    "Rechtslage am 2023-13-01",
    "Stand vom 31. Februar 2024",
  ])(
    "rejects the invalid marked date in %j",
    (question) => {
      try {
        resolveLegalStichtag(question, NOW);
        throw new Error("Expected resolveLegalStichtag to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(UserVisibleError);
        expect((error as UserVisibleError).status).toBe(400);
        expect((error as Error).message).toContain("Stichtag");
      }
    },
  );

  it("does not reject an invalid date when it is merely factual", () => {
    expect(resolveLegalStichtag("Der Vertrag nennt den 31.02.2024. Was gilt?", NOW)).toEqual({
      kind: "implicit",
      stichtag: "2026-07-18",
      reason: "default_current",
    });
  });

  it("narrows known resolutions with a type guard", () => {
    expect(isKnownStichtag(resolveLegalStichtag("Was gilt heute?", NOW))).toBe(true);
    expect(isKnownStichtag(resolveLegalStichtag("Was galt damals?", NOW))).toBe(false);
  });
});
