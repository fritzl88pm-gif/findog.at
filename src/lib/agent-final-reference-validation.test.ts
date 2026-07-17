import { describe, expect, it } from "vitest";

import {
  extractFinalReferenceTokens,
  validateFinalAnswerReferences,
} from "./agent-final-reference-validation";

describe("final internal reference validation", () => {
  it("accepts BFG identifiers, source labels, legal locators, and amount/year pairs from evidence", () => {
    const evidence = [
      {
        evidenceId: "ev-law",
        citationLabels: ["Q1"],
        text: [
          "\u00A7 33 Abs. 4 Z 3 lit. b EStG 1988 regelt den Unterhaltsabsetzbetrag.",
          "LStR Rz 761 konkretisiert die Behandlung.",
          "Veranlagungsjahr 2024: EUR 35 je Monat.",
        ].join("\n"),
      },
      {
        evidenceId: "ev-bfg",
        citationLabels: ["[Q2]"],
        text: [
          "BFG RV/7103001/2014",
          "ECLI:AT:BFG:2024:RV.7103001.2014",
        ].join("\n"),
      },
    ];
    const answer = [
      "Nach \u00A7 33 Abs 4 Z 3 lit b EStG 1988 und LStR Rz 761 beträgt der Wert 2024 35,00 \u20AC [Q1].",
      "Siehe BFG RV/7103001/2014, ECLI:AT:BFG:2024:RV.7103001.2014 [Q2].",
    ].join("\n");

    const result = validateFinalAnswerReferences({ answer, evidence });

    expect(result.supported).toBe(true);
    expect(result.unsupportedTokens).toEqual([]);
    expect(result.checks.find((check) => check.token.kind === "bfg_gz")?.supportedByEvidenceIds)
      .toEqual(["ev-bfg"]);
    expect(result.checks.find((check) => check.token.kind === "amount_year")?.supportedByEvidenceIds)
      .toEqual(["ev-law"]);
  });

  it("returns every unsupported reference category without performing an external lookup", () => {
    const result = validateFinalAnswerReferences({
      answer: [
        "BFG RV/9999999/2025, ECLI:AT:BFG:2025:RV.9999999.2025 [Q9].",
        "\u00A7 99 Abs 7 EStG 1988; LStR Rz 999; im Jahr 2025 EUR 999,99.",
      ].join("\n"),
      evidence: [{
        evidenceId: "ev-existing",
        citationLabels: ["Q1"],
        text: "\u00A7 33 EStG 1988; LStR Rz 761; 2024: EUR 35.",
      }],
    });

    expect(result.supported).toBe(false);
    expect(new Set(result.unsupportedTokens.map((token) => token.kind))).toEqual(new Set([
      "bfg_gz",
      "ecli",
      "citation_label",
      "paragraph",
      "margin_number",
      "amount_year",
    ]));
  });

  it("allows evidence to be more specific than the paragraph cited in the answer", () => {
    const result = validateFinalAnswerReferences({
      answer: "Maßgeblich ist \u00A7 33 EStG 1988 [Q1].",
      evidence: [{
        evidenceId: "ev-specific",
        citationLabels: ["Q1"],
        text: "\u00A7 33 Abs. 4 Z 3 EStG 1988 enthält die konkrete Regelung.",
      }],
    });

    expect(result.supported).toBe(true);
  });

  it("normalizes Austrian and international EUR notation while keeping years distinct", () => {
    const result = validateFinalAnswerReferences({
      answer: "2023: 1.234,50 \u20AC. 2024: EUR 1,250.75.",
      evidence: [{
        evidenceId: "ev-amounts",
        text: "| 2023 | EUR 1234,50 |\n| 2024 | 1 250,75 Euro |",
      }],
    });

    expect(result.supported).toBe(true);
    expect(result.answerTokens.filter((token) => token.kind === "amount_year")).toEqual([
      expect.objectContaining({ amountCents: 123_450, year: "2023" }),
      expect.objectContaining({ amountCents: 125_075, year: "2024" }),
    ]);
  });

  it("rejects an amount that has no nearby reference year", () => {
    const result = validateFinalAnswerReferences({
      answer: "Der Betrag beträgt 35 \u20AC.",
      evidence: [{ evidenceId: "ev-unyear", text: "Der Betrag beträgt ebenfalls EUR 35." }],
    });

    expect(result.unsupportedTokens).toHaveLength(1);
    expect(result.unsupportedTokens[0]).toMatchObject({
      kind: "amount_year",
      amountCents: 3_500,
    });
    expect(result.unsupportedTokens[0]).not.toHaveProperty("year");
  });

  it("deduplicates repeated tokens and accepts citation labels supplied as evidence metadata", () => {
    const tokens = extractFinalReferenceTokens(
      "BFG RV/7103001/2014 und nochmals RV/7103001/2014; [Q4], [Q4].",
    );

    expect(tokens.filter((token) => token.kind === "bfg_gz")).toHaveLength(1);
    expect(tokens.filter((token) => token.kind === "citation_label")).toHaveLength(1);
    expect(validateFinalAnswerReferences({
      answer: "Fundstelle [Q4].",
      evidence: [{ evidenceId: "ev-4", text: "Belegtext", citationLabels: ["Q4"] }],
    }).supported).toBe(true);
  });
});
