import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  BfgProResultCard,
  normalizeBfgProResults,
  type BfgProResult,
} from "@/components/bfg-pro-result-card";

describe("BFG PRO UI normalizer", () => {
  const validResult: BfgProResult = {
    title: "Erkenntnis des BFG",
    gz: "RV/7100001/2025",
    documentType: "Erkenntnis",
    decisionDate: "2025-04-03",
    publicationDate: "2025-04-10",
    caseSummary: "Ein beruflich genutztes Arbeitszimmer im Wohnungsverband war strittig.",
    whyRelevant: "Behandelt dieselbe Rechtsfrage wie der Sachverhalt.",
    score: 88,
    htmlUrl: "https://findok.bmf.gv.at/findok/volltext?dokumentId=doc-1",
    pdfUrl: "https://findok.bmf.gv.at/findok/resources/pdf/decision.pdf",
    legalIssue: "Abzugsfähigkeit der Aufwendungen für ein häusliches Arbeitszimmer.",
    similarities: "Nutzung eines Raumes innerhalb der privaten Wohnung für berufliche Zwecke.",
    differences: "Im Streitfall lag kein anderer beruflicher Arbeitsplatz vor.",
    sourceQuote: "Ein Arbeitszimmer bildet den Mittelpunkt, wenn die Tätigkeit dort ausgeübt wird.",
    periodAssessment: "Veranlagungsjahr 2021; Rechtslage nach dem COVID-19-StMG anwendbar.",
    textTruncated: false,
  };

  it("accepts valid results containing all new evidence and period fields", () => {
    const normalized = normalizeBfgProResults({ results: [validResult] });
    expect(normalized).toEqual([validResult]);
  });

  it("accepts null sourceQuote when no verified quote is available", () => {
    const withoutQuote = { ...validResult, sourceQuote: null };
    const normalized = normalizeBfgProResults({ results: [withoutQuote] });
    expect(normalized).toEqual([withoutQuote]);
  });

  it("tracks textTruncated true when evidence was truncated", () => {
    const truncated = { ...validResult, textTruncated: true };
    const normalized = normalizeBfgProResults({ results: [truncated] });
    expect(normalized).toEqual([truncated]);
  });

  it.each([
    ["missing legalIssue", { ...validResult, legalIssue: undefined }],
    ["missing similarities", { ...validResult, similarities: undefined }],
    ["missing differences", { ...validResult, differences: undefined }],
    ["invalid sourceQuote type", { ...validResult, sourceQuote: 123 }],
    ["missing periodAssessment", { ...validResult, periodAssessment: undefined }],
    ["missing textTruncated", { ...validResult, textTruncated: undefined }],
    ["non-boolean textTruncated", { ...validResult, textTruncated: "true" }],
  ])("rejects malformed result payload: %s", (_label, invalid) => {
    expect(normalizeBfgProResults({ results: [invalid] })).toBeNull();
  });
});

describe("BFG PRO UI card rendering", () => {
  const baseResult: BfgProResult = {
    title: "Erkenntnis des BFG zum Arbeitszimmer",
    gz: "RV/7100001/2025",
    documentType: "Erkenntnis",
    decisionDate: "2025-04-03",
    publicationDate: "2025-04-10",
    caseSummary: "Arbeitszimmer im Wohnungsverband war steuerlich geltend gemacht worden.",
    whyRelevant: "Entscheidung befasst sich mit dem Mittelpunkt der Tätigkeit.",
    score: 92,
    htmlUrl: "https://findok.bmf.gv.at/findok/volltext?dokumentId=doc-1",
    pdfUrl: "https://findok.bmf.gv.at/findok/resources/pdf/decision.pdf",
    legalIssue: "Voraussetzungen für die Anerkennung des Arbeitszimmers als Mittelpunkt.",
    similarities: "Ausschließliche berufliche Nutzung des Zimmers.",
    differences: "Der Abgabepflichtige erzielte Einkünfte aus selbständiger Arbeit.",
    sourceQuote: "Der Mittelpunkt der gesamten betrieblichen Tätigkeit lag im Arbeitszimmer.",
    periodAssessment: "Betrifft das Veranlagungsjahr 2022; aktuelle Rechtslage unberührt.",
    textTruncated: false,
  };

  it("renders all new fields including blockquote for verified quote", () => {
    const markup = renderToStaticMarkup(createElement(BfgProResultCard, { result: baseResult }));

    expect(markup).toContain("Erkenntnis des BFG zum Arbeitszimmer");
    expect(markup).toContain("RV/7100001/2025");
    expect(markup).toContain("Relevanz 92/100");
    expect(markup).toContain("Rechtliche Kernfrage");
    expect(markup).toContain("Voraussetzungen für die Anerkennung des Arbeitszimmers als Mittelpunkt.");
    expect(markup).toContain("Sachverhalt");
    expect(markup).toContain("Arbeitszimmer im Wohnungsverband war steuerlich geltend gemacht worden.");
    expect(markup).toContain("Gemeinsamkeiten:");
    expect(markup).toContain("Ausschließliche berufliche Nutzung des Zimmers.");
    expect(markup).toContain("Unterschiede:");
    expect(markup).toContain("Der Abgabepflichtige erzielte Einkünfte aus selbständiger Arbeit.");
    expect(markup).toContain("Zeitliche Einordnung");
    expect(markup).toContain("Betrifft das Veranlagungsjahr 2022; aktuelle Rechtslage unberührt.");

    // Quote in blockquote
    expect(markup).toContain("Quellenzitat");
    expect(markup).toMatch(/<blockquote[^>]*>[\s\S]*?Der Mittelpunkt der gesamten betrieblichen Tätigkeit lag im Arbeitszimmer\.[\s\S]*?<\/blockquote>/u);

    // Truncation caveat should NOT be present
    expect(markup).not.toContain("Gekürzter Entscheidungstext");
    expect(markup).not.toContain("Teilnachweis");
    expect(markup).not.toContain("gekürzt");

    // Official links preserved
    expect(markup).toContain("https://findok.bmf.gv.at/findok/volltext?dokumentId=doc-1");
    expect(markup).toContain("https://findok.bmf.gv.at/findok/resources/pdf/decision.pdf");
  });

  it("renders explicit missing quote message when sourceQuote is null", () => {
    const markup = renderToStaticMarkup(createElement(BfgProResultCard, {
      result: { ...baseResult, sourceQuote: null },
    }));

    expect(markup).not.toContain("<blockquote");
    expect(markup).toContain("Quellenzitat");
    expect(markup).toContain("Kein verifiziertes Quellenzitat vorhanden.");
  });

  it("renders truncation caveat only when textTruncated is true", () => {
    const markup = renderToStaticMarkup(createElement(BfgProResultCard, {
      result: { ...baseResult, textTruncated: true },
    }));

    expect(markup).toContain("Hinweis:");
    expect(markup).toContain("Teilnachweis");
  });
});
