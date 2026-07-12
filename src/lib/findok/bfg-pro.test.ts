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
        content: '{"selections":[{"candidateId":"candidate-1","score":87,"comment":"Behandelt ein Arbeitszimmer und den Vorsteuerabzug."}]}',
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
    ["unknown generated metadata", '{"selections":[{"candidateId":"candidate-1","score":50,"comment":"Relevant","gz":"FAKE/1","url":"https://evil.example"}]}'],
  ])("rejects malformed reranker output: %s", async (_label, content) => {
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce({ content: '{"query":"Arbeitszimmer"}', toolCalls: [] })
      .mockResolvedValueOnce({ content, toolCalls: [] });

    await expect(runBfgProSearch("Sachverhalt")).rejects.toBeInstanceOf(BfgProModelError);
  });

  it("drops fabricated candidate IDs and returns an empty list when none remain", async () => {
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce({ content: '{"query":"Arbeitszimmer"}', toolCalls: [] })
      .mockResolvedValueOnce({
        content: '{"selections":[{"candidateId":"invented","score":99,"comment":"Erfundener Treffer"}]}',
        toolCalls: [],
      });

    await expect(runBfgProSearch("Sachverhalt")).resolves.toEqual({ results: [] });
  });

  it("deduplicates selections, bounds generated values, and retains only official metadata and links", async () => {
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce({ content: '{"query":"Arbeitszimmer"}', toolCalls: [] })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          selections: [
            { candidateId: "candidate-1", score: 999, comment: ` Passend. ${"lang ".repeat(100)}` },
            { candidateId: "candidate-1", score: 1, comment: "Duplikat" },
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
    });
    expect(response.results[0]?.whyRelevant.length).toBeLessThanOrEqual(240);
  });

  it("never sends or returns full detail content beyond the bounded excerpt", async () => {
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce({ content: '{"query":"Arbeitszimmer"}', toolCalls: [] })
      .mockResolvedValueOnce({
        content: '{"selections":[{"candidateId":"candidate-1","score":70,"comment":"Thematisch passend."}]}',
        toolCalls: [],
      });

    const response = await runBfgProSearch("Arbeitszimmer");
    const rerankPrompt = vi.mocked(chatCompletion).mock.calls[1]?.[0].messages
      .map((message) => message.content ?? "")
      .join(" ") ?? "";

    expect(rerankPrompt).not.toContain("FULL-CONTENT-SECRET");
    expect(JSON.stringify(response)).not.toContain("FULL-CONTENT-SECRET");
    expect(response.results[0]?.excerpt.length).toBeLessThanOrEqual(700);
    expect(response.results[0]).not.toHaveProperty("content");
  });

  it("returns an empty list without reranking when Findok has no candidates", async () => {
    vi.mocked(fetchBfgProCandidates).mockResolvedValueOnce([]);
    vi.mocked(chatCompletion).mockResolvedValueOnce({ content: '{"query":"Arbeitszimmer"}', toolCalls: [] });

    await expect(runBfgProSearch("Sachverhalt")).resolves.toEqual({ results: [] });
    expect(chatCompletion).toHaveBeenCalledTimes(1);
  });
});
