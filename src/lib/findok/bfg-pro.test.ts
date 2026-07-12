import { beforeEach, describe, expect, it, vi } from "vitest";

import { chatCompletion } from "@/lib/deepseek";
import { resolveDeepSeekApiKey } from "@/lib/deepseek-key";
import { fetchBfgProCandidates } from "./bfg-decisions";
import {
  BfgProModelError,
  buildDeterministicExcerpt,
  runBfgProSearch,
} from "./bfg-pro";

vi.mock("@/lib/deepseek", () => ({ chatCompletion: vi.fn() }));
vi.mock("@/lib/deepseek-key", () => ({ resolveDeepSeekApiKey: vi.fn() }));
vi.mock("./bfg-decisions", async (importOriginal) => {
  const original = await importOriginal<typeof import("./bfg-decisions")>();
  return { ...original, fetchBfgProCandidates: vi.fn() };
});

const officialCandidate = {
  candidateId: "candidate-1",
  title: "Häusliches Arbeitszimmer",
  gz: "RV/7100001/2025",
  documentType: "Erkenntnis",
  decisionDate: "2025-04-03",
  publicationDate: "2025-04-10",
  htmlUrl: "https://findok.bmf.gv.at/findok/volltext?dokumentId=doc-1&segmentId=seg-1&indexName=findok",
  pdfUrl: "https://findok.bmf.gv.at/findok/resources/pdf/decision.pdf",
  content: `Arbeitszimmer im Wohnungsverband. ${"Unwichtiger Text. ".repeat(100)}FULL-CONTENT-SECRET`,
};

describe("deterministic BFG PRO excerpts", () => {
  it("selects a bounded plain-text window around matching terms deterministically", () => {
    const content = `<p>${"Vorlauf ".repeat(80)}</p><p>Vorsteuer für Arbeitszimmer wurde strittig.</p>${"Nachlauf ".repeat(80)}`;

    const first = buildDeterministicExcerpt(content, ["Arbeitszimmer", "Vorsteuer"], 180);
    const second = buildDeterministicExcerpt(content, ["Arbeitszimmer", "Vorsteuer"], 180);

    expect(first).toBe(second);
    expect(first).toContain("Vorsteuer für Arbeitszimmer");
    expect(first.length).toBeLessThanOrEqual(180);
    expect(first).not.toContain("<p>");
  });
});

describe("BFG PRO query generation and reranking", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(resolveDeepSeekApiKey).mockReturnValue("server-only-key");
    vi.mocked(fetchBfgProCandidates).mockResolvedValue([officialCandidate]);
  });

  it("uses the server key and fixed Flash model for both model calls", async () => {
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce({ content: '{"query":"Arbeitszimmer Vorsteuer"}', toolCalls: [] })
      .mockResolvedValueOnce({
        content: '{"selections":[{"candidateId":"candidate-1","score":87,"comment":"Behandelt ein Arbeitszimmer und den Vorsteuerabzug.","caseFacts":"Ein beruflich genutztes Arbeitszimmer im Wohnungsverband war zu beurteilen.","outcome":"Das BFG entschied über den geltend gemachten Vorsteuerabzug."}]}',
        toolCalls: [],
      });

    await runBfgProSearch("Ein Raum meiner Wohnung wird ausschließlich beruflich genutzt.");

    expect(resolveDeepSeekApiKey).toHaveBeenCalledTimes(1);
    expect(chatCompletion).toHaveBeenCalledTimes(2);
    for (const [options] of vi.mocked(chatCompletion).mock.calls) {
      expect(options).toMatchObject({ apiKey: "server-only-key", model: "deepseek-v4-flash" });
      expect(options.tools).toBeUndefined();
    }
    expect(fetchBfgProCandidates).toHaveBeenCalledWith({ query: "Arbeitszimmer Vorsteuer" });
  });

  it.each([
    ["non-JSON query", "Arbeitszimmer"],
    ["unknown query field", '{"query":"Arbeitszimmer","url":"https://evil.example"}'],
    ["oversized query", JSON.stringify({ query: "x".repeat(201) })],
  ])("rejects malformed query model output: %s", async (_label, content) => {
    vi.mocked(chatCompletion).mockResolvedValueOnce({ content, toolCalls: [] });

    await expect(runBfgProSearch("Sachverhalt")).rejects.toBeInstanceOf(BfgProModelError);
    expect(fetchBfgProCandidates).not.toHaveBeenCalled();
  });

  it.each([
    ["non-JSON reranking", "candidate-1"],
    ["missing comment", '{"selections":[{"candidateId":"candidate-1","score":50}]}'],
    ["missing case facts", '{"selections":[{"candidateId":"candidate-1","score":50,"comment":"Relevant","outcome":"Stattgegeben."}]}'],
    ["missing outcome", '{"selections":[{"candidateId":"candidate-1","score":50,"comment":"Relevant","caseFacts":"Ein Arbeitszimmer war strittig."}]}'],
    ["blank comment", '{"selections":[{"candidateId":"candidate-1","score":50,"comment":"  ","caseFacts":"Ein Arbeitszimmer war strittig.","outcome":"Stattgegeben."}]}'],
    ["blank case facts", '{"selections":[{"candidateId":"candidate-1","score":50,"comment":"Relevant","caseFacts":"  ","outcome":"Stattgegeben."}]}'],
    ["blank outcome", '{"selections":[{"candidateId":"candidate-1","score":50,"comment":"Relevant","caseFacts":"Ein Arbeitszimmer war strittig.","outcome":"  "}]}'],
    ["oversized case facts", JSON.stringify({ selections: [{ candidateId: "candidate-1", score: 50, comment: "Relevant", caseFacts: "x".repeat(701), outcome: "Stattgegeben." }] })],
    ["oversized outcome", JSON.stringify({ selections: [{ candidateId: "candidate-1", score: 50, comment: "Relevant", caseFacts: "Ein Arbeitszimmer war strittig.", outcome: "x".repeat(281) }] })],
    ["malformed score", '{"selections":[{"candidateId":"candidate-1","score":"50","comment":"Relevant","caseFacts":"Ein Arbeitszimmer war strittig.","outcome":"Stattgegeben."}]}'],
    ["legacy case summary", '{"selections":[{"candidateId":"candidate-1","score":50,"comment":"Relevant","caseSummary":"Alter Kombinationswert.","caseFacts":"Ein Arbeitszimmer war strittig.","outcome":"Stattgegeben."}]}'],
    ["unknown generated metadata", '{"selections":[{"candidateId":"candidate-1","score":50,"comment":"Relevant","caseFacts":"Ein Arbeitszimmer war strittig.","outcome":"Stattgegeben.","gz":"FAKE/1"}]}'],
  ])("rejects malformed reranker output: %s", async (_label, content) => {
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce({ content: '{"query":"Arbeitszimmer"}', toolCalls: [] })
      .mockResolvedValueOnce({ content, toolCalls: [] });

    await expect(runBfgProSearch("Sachverhalt")).rejects.toBeInstanceOf(BfgProModelError);
  });

  it("bounds a finite score and caps a non-empty comment", async () => {
    const longComment = ` Passend. ${"lang ".repeat(100)}`;
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce({ content: '{"query":"Arbeitszimmer"}', toolCalls: [] })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          selections: [{
            candidateId: "candidate-1",
            score: 999,
            comment: longComment,
            caseFacts: "Ein Arbeitszimmer war strittig.",
            outcome: "Das BFG entschied über den Vorsteuerabzug.",
          }],
        }),
        toolCalls: [],
      });

    const response = await runBfgProSearch("Sachverhalt");

    expect(response.results[0]?.score).toBe(100);
    expect(response.results[0]?.whyRelevant).toBe(
      longComment.replace(/\s+/g, " ").trim().slice(0, 240),
    );
    expect(response.results[0]?.whyRelevant).toHaveLength(240);
  });

  it("drops fabricated candidate IDs and returns an empty list when none remain", async () => {
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce({ content: '{"query":"Arbeitszimmer"}', toolCalls: [] })
      .mockResolvedValueOnce({
        content: '{"selections":[{"candidateId":"invented","score":99,"comment":"Erfundener Treffer","caseFacts":"Erfundener Sachverhalt.","outcome":"Erfundenes Ergebnis."}]}',
        toolCalls: [],
      });

    await expect(runBfgProSearch("Sachverhalt")).resolves.toEqual({ results: [] });
  });

  it("deduplicates selections and retains only validated generated fields plus official metadata and links", async () => {
    const longCaseFacts = `Ein Arbeitszimmer war Gegenstand des Verfahrens. ${"Weitere offizielle Einzelheit. ".repeat(18)}`.trim();
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce({ content: '{"query":"Arbeitszimmer"}', toolCalls: [] })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          selections: [
            {
              candidateId: "candidate-1",
              score: 100,
              comment: "Passend.",
              caseFacts: longCaseFacts,
              outcome: "Das BFG entschied über den Vorsteuerabzug.",
            },
            {
              candidateId: "candidate-1",
              score: 1,
              comment: "Duplikat",
              caseFacts: "Duplikat.",
              outcome: "Duplikat verworfen.",
            },
          ],
        }),
        toolCalls: [],
      });

    const response = await runBfgProSearch("Arbeitszimmer im Wohnungsverband");

    expect(response.results).toHaveLength(1);
    expect(response.results[0]).toMatchObject({
      title: officialCandidate.title,
      gz: officialCandidate.gz,
      documentType: officialCandidate.documentType,
      decisionDate: officialCandidate.decisionDate,
      publicationDate: officialCandidate.publicationDate,
      htmlUrl: officialCandidate.htmlUrl,
      pdfUrl: officialCandidate.pdfUrl,
      score: 100,
      caseFacts: longCaseFacts,
      outcome: "Das BFG entschied über den Vorsteuerabzug.",
    });
    expect(response.results[0]?.whyRelevant.length).toBeLessThanOrEqual(240);
    expect(response.results[0]?.caseFacts.length).toBeGreaterThan(400);
    expect(response.results[0]?.caseFacts.length).toBeLessThanOrEqual(700);
    expect(response.results[0]?.outcome.length).toBeLessThanOrEqual(280);
    expect(response.results[0]).not.toHaveProperty("caseSummary");
  });

  it("sends only bounded official excerpts to Flash and returns no source or legacy fields", async () => {
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce({ content: '{"query":"Arbeitszimmer"}', toolCalls: [] })
      .mockResolvedValueOnce({
        content: '{"selections":[{"candidateId":"candidate-1","score":70,"comment":"Thematisch passend.","caseFacts":"Ein Arbeitszimmer im Wohnungsverband war strittig.","outcome":"Das BFG entschied über dessen steuerliche Behandlung."}]}',
        toolCalls: [],
      });

    const response = await runBfgProSearch("Arbeitszimmer");
    const rerankPrompt = vi.mocked(chatCompletion).mock.calls[1]?.[0].messages
      .map((message) => message.content ?? "")
      .join(" ") ?? "";

    expect(rerankPrompt).not.toContain("FULL-CONTENT-SECRET");
    expect(rerankPrompt).toContain('"caseFacts"');
    expect(rerankPrompt).toContain('"outcome"');
    expect(rerankPrompt).toContain("höchstens 700 Zeichen");
    expect(rerankPrompt).toContain("höchstens 280 Zeichen");
    expect(rerankPrompt).not.toContain("caseSummary");
    expect(JSON.stringify(response)).not.toContain("FULL-CONTENT-SECRET");
    expect(response.results[0]?.caseFacts.length).toBeLessThanOrEqual(700);
    expect(response.results[0]?.outcome.length).toBeLessThanOrEqual(280);
    expect(response.results[0]).not.toHaveProperty("caseSummary");
    expect(response.results[0]).not.toHaveProperty("excerpt");
    expect(response.results[0]).not.toHaveProperty("content");
  });

  it("returns an empty list without reranking when Findok has no candidates", async () => {
    vi.mocked(fetchBfgProCandidates).mockResolvedValueOnce([]);
    vi.mocked(chatCompletion).mockResolvedValueOnce({ content: '{"query":"Arbeitszimmer"}', toolCalls: [] });

    await expect(runBfgProSearch("Sachverhalt")).resolves.toEqual({ results: [] });
    expect(chatCompletion).toHaveBeenCalledTimes(1);
  });
});
