import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FindokUpstreamError,
  fetchBfgProCandidates,
  type BfgProCandidate,
} from "./bfg-decisions";
import type { BfgProProgress } from "./bfg-pro-stream";
import {
  BfgProAbortError,
  BfgProModelError,
  buildDeterministicExcerpt,
  runBfgProSearch,
  truncateAtWord,
  type BfgProResult,
} from "./bfg-pro";
import {
  BFG_PRO_LUNA_MODEL,
  BFG_PRO_LUNA_REASONING_EFFORT,
} from "./bfg-pro-omniroute";

vi.mock("./bfg-decisions", async (importOriginal) => {
  const original = await importOriginal<typeof import("./bfg-decisions")>();
  return { ...original, fetchBfgProCandidates: vi.fn() };
});

const officialCandidate: BfgProCandidate = {
  candidateId: "candidate-1",
  title: "Häusliches Arbeitszimmer",
  gz: "RV/7100001/2025",
  documentType: "Erkenntnis",
  decisionDate: "2025-04-03",
  publicationDate: "2025-04-10",
  htmlUrl: "https://findok.bmf.gv.at/findok/volltext?dokumentId=doc-1&segmentId=seg-1&indexName=findok",
  pdfUrl: "https://findok.bmf.gv.at/findok/resources/pdf/decision.pdf",
  content: `Arbeitszimmer im Wohnungsverband. ${"Unwichtiger Text. ".repeat(100)}FULL-CONTENT-SECRET`,
  contentTruncated: false,
};

function candidate(number: number, overrides: Partial<BfgProCandidate> = {}): BfgProCandidate {
  return {
    ...officialCandidate,
    candidateId: `candidate-${number}`,
    title: `Offizieller Treffer ${number}`,
    gz: `RV/710000${number}/2025`,
    htmlUrl: `https://findok.bmf.gv.at/findok/volltext?dokumentId=doc-${number}&segmentId=seg-${number}&indexName=findok`,
    content: `Entscheidungstext ${number}. Arbeitszimmer Nutzung im Streitjahr 2020.`,
    contentTruncated: false,
    ...overrides,
  };
}

function mockLunaResponse(content: string, finishReason: "stop" | "length" = "stop"): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: { role: "assistant", content },
          finish_reason: finishReason,
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("deterministic BFG PRO excerpts", () => {
  it("does not let the stopword der anchor the excerpt before distinctive later facts", () => {
    const content = [
      "IM NAMEN DER REPUBLIK",
      "Allgemeine Verfahrensangaben. ".repeat(90),
      "Der Unterhaltsabsetzbetrag für ein in einem Drittstaat lebendes Kind war strittig.",
      "Weitere rechtliche Würdigung. ".repeat(90),
    ].join(" ");

    const excerpt = buildDeterministicExcerpt(
      content,
      ["der", "Unterhaltsabsetzbetrag", "Drittstaat"],
      1_800,
    );

    expect(excerpt).toContain("Unterhaltsabsetzbetrag");
    expect(excerpt).toContain("Drittstaat");
    expect(excerpt).not.toContain("IM NAMEN DER REPUBLIK");
    expect(excerpt.length).toBeLessThanOrEqual(1_800);
  });

  it("renders two bounded non-overlapping windows around distinct strong matches", () => {
    const content = [
      "Vorspann. ".repeat(80),
      "Der Unterhaltsabsetzbetrag wurde beantragt.",
      "Getrennter Mittelteil. ".repeat(120),
      "Das Kind hatte seinen Wohnsitz in einem Drittstaat.",
      "Nachspann. ".repeat(80),
    ].join(" ");

    const excerpt = buildDeterministicExcerpt(
      content,
      ["Unterhaltsabsetzbetrag", "Drittstaat"],
      600,
    );

    expect(excerpt).toContain("Unterhaltsabsetzbetrag");
    expect(excerpt).toContain("Drittstaat");
    expect(excerpt).toMatch(/Unterhaltsabsetzbetrag.*….*Drittstaat/u);
    expect(excerpt.length).toBeLessThanOrEqual(600);
  });

  it("uses token boundaries while retaining the meaningful two-letter token GZ", () => {
    const content = [
      "Umsatzsteuerliche Vorbemerkung. ".repeat(80),
      "Neutraler Abstand. ".repeat(80),
      "Die GZ RV/7100001/2025 bezeichnet die einschlägige Entscheidung.",
    ].join(" ");

    const excerpt = buildDeterministicExcerpt(content, ["Steuer", "GZ"], 240);

    expect(excerpt).toContain("GZ RV/7100001/2025");
    expect(excerpt).not.toContain("Umsatzsteuerliche Vorbemerkung");
  });

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

describe("BFG PRO query generation and full-text Luna Medium evaluation", () => {
  const originalBaseUrl = process.env.OMNIROUTE_BASE_URL;
  const originalApiKey = process.env.OMNIROUTE_API_KEY;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.OMNIROUTE_BASE_URL = "https://omniroute.example/v1/";
    process.env.OMNIROUTE_API_KEY = "server-omniroute-key";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(fetchBfgProCandidates).mockResolvedValue([officialCandidate]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalBaseUrl !== undefined) {
      process.env.OMNIROUTE_BASE_URL = originalBaseUrl;
    } else {
      delete process.env.OMNIROUTE_BASE_URL;
    }
    if (originalApiKey !== undefined) {
      process.env.OMNIROUTE_API_KEY = originalApiKey;
    } else {
      delete process.env.OMNIROUTE_API_KEY;
    }
  });

  it("uses exact codex/gpt-5.6-luna and medium reasoning for both query planning and evaluation", async () => {
    fetchMock
      .mockResolvedValueOnce(mockLunaResponse('{"queries":["Arbeitszimmer Vorsteuer"],"norm":null}'))
      .mockResolvedValueOnce(mockLunaResponse(JSON.stringify({
        selections: [
          {
            candidateId: "candidate-1",
            score: 87,
            legalIssue: "Vorsteuerabzug bei häuslichem Arbeitszimmer.",
            caseSummary: "Ein beruflich genutztes Arbeitszimmer im Wohnungsverband war zu beurteilen.",
            whyRelevant: "Behandelt ein Arbeitszimmer und den Vorsteuerabzug.",
            similarities: "Arbeitszimmer in der Wohnung.",
            differences: "Vorsteuerabzug statt Einkommensteuer.",
            sourceQuote: "Arbeitszimmer im Wohnungsverband.",
            periodAssessment: "Veranlagungsjahr im Text nicht ersichtlich; allgemeine Rechtslage anwendbar.",
          },
        ],
      })));

    const response = await runBfgProSearch("Ein Raum meiner Wohnung wird ausschließlich beruflich genutzt.");

    expect(fetchMock).toHaveBeenCalledTimes(2);

    for (const call of fetchMock.mock.calls) {
      const [url, options] = call;
      expect(url).toBe("https://omniroute.example/v1/chat/completions");
      expect(options.headers).toMatchObject({
        Authorization: "Bearer server-omniroute-key",
        "Content-Type": "application/json",
      });
      const body = JSON.parse(options.body);
      expect(body.model).toBe(BFG_PRO_LUNA_MODEL);
      expect(body.reasoning_effort).toBe(BFG_PRO_LUNA_REASONING_EFFORT);
      expect(body.stream).toBe(false);
      expect(body.response_format).toEqual({ type: "json_object" });
    }

    expect(response.results).toHaveLength(1);
    expect(response.results[0]).toMatchObject({
      title: officialCandidate.title,
      gz: officialCandidate.gz,
      score: 87,
      legalIssue: "Vorsteuerabzug bei häuslichem Arbeitszimmer.",
      similarities: "Arbeitszimmer in der Wohnung.",
      differences: "Vorsteuerabzug statt Einkommensteuer.",
      sourceQuote: "Arbeitszimmer im Wohnungsverband.",
      periodAssessment: "Veranlagungsjahr im Text nicht ersichtlich; allgemeine Rechtslage anwendbar.",
      textTruncated: false,
    });
  });

  it.each([
    ["non-JSON query", "Arbeitszimmer"],
    ["unknown query field", '{"queries":["Arbeitszimmer"],"norm":null,"url":"https://evil.example"}'],
    ["empty query list", '{"queries":[],"norm":null}'],
    ["too many queries", JSON.stringify({ queries: ["a", "b", "c", "d"], norm: null })],
    ["non-string query", JSON.stringify({ queries: ["Arbeitszimmer", 16], norm: null })],
    ["oversized query", JSON.stringify({ queries: ["x".repeat(201)], norm: null })],
    ["blank norm", JSON.stringify({ queries: ["Arbeitszimmer"], norm: "  " })],
    ["oversized norm", JSON.stringify({ queries: ["Arbeitszimmer"], norm: "x".repeat(121) })],
  ])("rejects malformed query model output: %s", async (_label, content) => {
    fetchMock.mockResolvedValueOnce(mockLunaResponse(content));

    await expect(runBfgProSearch("Sachverhalt")).rejects.toBeInstanceOf(BfgProModelError);
    expect(fetchBfgProCandidates).not.toHaveBeenCalled();
  });

  it("accepts model JSON wrapped in a markdown code fence", async () => {
    fetchMock
      .mockResolvedValueOnce(mockLunaResponse('```json\n{"queries":["Arbeitszimmer Vorsteuer"],"norm":null}\n```'))
      .mockResolvedValueOnce(mockLunaResponse(
        '```\n{"selections":[{"candidateId":"candidate-1","score":80,"legalIssue":"Rechtsfrage","whyRelevant":"Passend.","caseSummary":"Ein Arbeitszimmer war strittig.","similarities":"Gleich","differences":"Anders","sourceQuote":null,"periodAssessment":"2020"}]}\n```',
      ));

    const response = await runBfgProSearch("Arbeitszimmer im Wohnungsverband");

    expect(fetchBfgProCandidates).toHaveBeenCalledWith({ query: "Arbeitszimmer Vorsteuer" });
    expect(response.results).toHaveLength(1);
    expect(response.results[0]).toMatchObject({ gz: officialCandidate.gz, score: 80 });
  });

  it("normalizes and deduplicates query-plan variants before retrieval", async () => {
    vi.mocked(fetchBfgProCandidates).mockResolvedValue([]);
    fetchMock.mockResolvedValueOnce(mockLunaResponse(JSON.stringify({
      queries: ["  Arbeitszimmer  ", "arbeitszimmer", "Vorsteuer"],
      norm: null,
    })));

    await expect(runBfgProSearch("Sachverhalt")).resolves.toEqual({ results: [] });
    expect(vi.mocked(fetchBfgProCandidates).mock.calls).toEqual([
      [{ query: "Arbeitszimmer" }],
      [{ query: "Vorsteuer" }],
    ]);
  });

  it("reports the real pipeline stages in order while the search runs", async () => {
    vi.mocked(fetchBfgProCandidates)
      .mockResolvedValueOnce(Array.from({ length: 5 }, (_value, index) => candidate(index + 1)))
      .mockResolvedValueOnce([candidate(6)]);

    fetchMock
      .mockResolvedValueOnce(mockLunaResponse(JSON.stringify({ queries: ["Arbeitszimmer", "betrieblicher Raum"], norm: null })))
      .mockResolvedValueOnce(mockLunaResponse(JSON.stringify({
        selections: [{
          candidateId: "candidate-1",
          score: 80,
          legalIssue: "Frage",
          whyRelevant: "Passend.",
          caseSummary: "Ein Arbeitszimmer war strittig.",
          similarities: "Gleich",
          differences: "Anders",
          sourceQuote: null,
          periodAssessment: "2020",
        }],
      })));

    const progress: BfgProProgress[] = [];

    await runBfgProSearch("Sachverhalt", { onProgress: (event) => progress.push(event) });

    expect(progress).toEqual([
      { stage: "queries" },
      { stage: "fetching" },
      { stage: "fetching", count: 5 },
      { stage: "fetching", count: 6 },
      { stage: "sorting", count: 6 },
      { stage: "summarizing", count: 6 },
    ]);
  });

  it("stops reporting progress once retrieval found no official candidate", async () => {
    vi.mocked(fetchBfgProCandidates).mockResolvedValue([]);
    fetchMock.mockResolvedValueOnce(mockLunaResponse('{"queries":["Arbeitszimmer"],"norm":null}'));
    const progress: BfgProProgress[] = [];

    await expect(runBfgProSearch("Sachverhalt", { onProgress: (event) => progress.push(event) }))
      .resolves.toEqual({ results: [] });

    expect(progress).toEqual([
      { stage: "queries" },
      { stage: "fetching" },
      { stage: "fetching", count: 0 },
    ]);
  });

  it("runs the norm-filtered precision source and every planned query variant", async () => {
    vi.mocked(fetchBfgProCandidates)
      .mockResolvedValueOnce(Array.from({ length: 5 }, (_value, index) => candidate(index + 1)))
      .mockResolvedValueOnce([candidate(1)])
      .mockResolvedValueOnce([candidate(6)]);

    fetchMock
      .mockResolvedValueOnce(mockLunaResponse(JSON.stringify({
        queries: ["Arbeitszimmer", "betrieblicher Raum"],
        norm: "  EStG 1988 § 20  ",
      })))
      .mockResolvedValueOnce(mockLunaResponse(JSON.stringify({
        selections: [{
          candidateId: "candidate-1",
          score: 80,
          legalIssue: "Frage",
          whyRelevant: "Passend.",
          caseSummary: "Ein Arbeitszimmer war strittig.",
          similarities: "Gleich",
          differences: "Anders",
          sourceQuote: null,
          periodAssessment: "2020",
        }],
      })));

    await runBfgProSearch("Sachverhalt");

    expect(vi.mocked(fetchBfgProCandidates).mock.calls).toEqual([
      [{ query: "Arbeitszimmer" }],
      [{ query: "Arbeitszimmer", norm: "EStG 1988 § 20" }],
      [{ query: "betrieblicher Raum" }],
    ]);
  });

  it("saturated first query still calls all variants and round robin fairly merges without starvation", async () => {
    const q1Results = Array.from({ length: 60 }, (_v, i) => candidate(i + 1));
    const normResults = [candidate(101), candidate(102), candidate(103)];
    const altResults = [candidate(201), candidate(202)];

    vi.mocked(fetchBfgProCandidates)
      .mockResolvedValueOnce(q1Results)
      .mockResolvedValueOnce(normResults)
      .mockResolvedValueOnce(altResults);

    fetchMock
      .mockResolvedValueOnce(mockLunaResponse(JSON.stringify({
        queries: ["Arbeitszimmer", "häusliches Büro"],
        norm: "EStG 1988 § 20",
      })))
      // Preliminary shortlist call (up to 18 candidates)
      .mockResolvedValueOnce(mockLunaResponse(JSON.stringify({
        selections: Array.from({ length: 18 }, (_v, i) => ({
          candidateId: `candidate-${i + 1}`,
          score: 80,
          comment: "Comment",
          caseSummary: "Summary",
        })),
      })))
      // Final evaluation
      .mockResolvedValueOnce(mockLunaResponse(JSON.stringify({
        selections: [
          {
            candidateId: "candidate-1",
            score: 85,
            legalIssue: "Frage",
            caseSummary: "Zusammenfassung",
            whyRelevant: "Relevant",
            similarities: "Gleich",
            differences: "Anders",
            sourceQuote: null,
            periodAssessment: "Unbekannt",
          },
        ],
      })));

    await runBfgProSearch("Arbeitszimmer");

    // All planned queries were called despite Q1 having 60 hits
    expect(vi.mocked(fetchBfgProCandidates).mock.calls).toEqual([
      [{ query: "Arbeitszimmer" }],
      [{ query: "Arbeitszimmer", norm: "EStG 1988 § 20" }],
      [{ query: "häusliches Büro" }],
    ]);

    // Check that round-robin candidates were merged into the pool of max 60
    const prelimPayload = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body);
    const candidateList = JSON.parse(prelimPayload.messages[1].content).candidates;
    expect(candidateList.length).toBeLessThanOrEqual(18);
  });

  it("skips preliminary excerpt LLM call when candidate count is <= 10 and evaluates all on full text", async () => {
    vi.mocked(fetchBfgProCandidates).mockResolvedValueOnce([candidate(1), candidate(2)]);

    fetchMock
      .mockResolvedValueOnce(mockLunaResponse('{"queries":["Arbeitszimmer"],"norm":null}'))
      .mockResolvedValueOnce(mockLunaResponse(JSON.stringify({
        selections: [
          {
            candidateId: "candidate-1",
            score: 85,
            legalIssue: "Kernfrage 1",
            caseSummary: "Zusammenfassung 1",
            whyRelevant: "Relevant 1",
            similarities: "Ähnlichkeit 1",
            differences: "Unterschied 1",
            sourceQuote: null,
            periodAssessment: "Jahr 2020",
          },
          {
            candidateId: "candidate-2",
            score: 75,
            legalIssue: "Kernfrage 2",
            caseSummary: "Zusammenfassung 2",
            whyRelevant: "Relevant 2",
            similarities: "Ähnlichkeit 2",
            differences: "Unterschied 2",
            sourceQuote: null,
            periodAssessment: "Jahr 2020",
          },
        ],
      })));

    const response = await runBfgProSearch("Arbeitszimmer");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.results).toHaveLength(2);
    expect(response.results[0]?.score).toBe(85);
  });

  it("shortlists using excerpts when > 10 candidates and sends only shortlisted candidates to final full-text evaluation", async () => {
    const pool = Array.from({ length: 15 }, (_v, i) => candidate(i + 1));
    vi.mocked(fetchBfgProCandidates).mockResolvedValueOnce(pool);

    fetchMock
      .mockResolvedValueOnce(mockLunaResponse('{"queries":["Arbeitszimmer"],"norm":null}'))
      .mockResolvedValueOnce(mockLunaResponse(JSON.stringify({
        selections: pool.map((c, i) => ({
          candidateId: c.candidateId,
          score: i < 5 ? 80 - i : 20, // Only first 5 score >= 30
          comment: `Vorläufige Notiz ${i + 1}`,
          caseSummary: `Vorläufige Zusammenfassung ${i + 1}`,
        })),
      })))
      .mockResolvedValueOnce(mockLunaResponse(JSON.stringify({
        selections: [
          {
            candidateId: "candidate-1",
            score: 95,
            legalIssue: "Endgültige Kernfrage",
            caseSummary: "Endgültige Volltext-Zusammenfassung",
            whyRelevant: "Endgültige Relevanzbegründung",
            similarities: "Endgültige Gemeinsamkeiten",
            differences: "Endgültige Unterschiede",
            sourceQuote: null,
            periodAssessment: "Streitjahr 2020",
          },
        ],
      })));

    const response = await runBfgProSearch("Arbeitszimmer");

    expect(fetchMock).toHaveBeenCalledTimes(3);

    const finalEvalPayload = JSON.parse(fetchMock.mock.calls[2]?.[1]?.body);
    const finalCandidatesInPrompt = JSON.parse(finalEvalPayload.messages[1].content).candidates;
    expect(finalCandidatesInPrompt).toHaveLength(5);
    expect(finalCandidatesInPrompt.map((c: { candidateId: string }) => c.candidateId)).toEqual([
      "candidate-1", "candidate-2", "candidate-3", "candidate-4", "candidate-5",
    ]);

    expect(response.results[0]?.caseSummary).toBe("Endgültige Volltext-Zusammenfassung");
    expect(response.results[0]?.whyRelevant).toBe("Endgültige Relevanzbegründung");
    expect(JSON.stringify(response.results)).not.toContain("Vorläufige Notiz");
    expect(JSON.stringify(response.results)).not.toContain("Vorläufige Zusammenfassung");
  });

  it("contains distinctive text beyond 1800 chars in final input while preliminary excerpt is bounded", async () => {
    const longTextCandidate = candidate(1, {
      content: `Vorspann Text. ${"Fülltext ".repeat(250)}DISTINCTIVE-PASSAGE-BEYOND-1800 Nachspann Text.`,
    });
    const pool = [longTextCandidate, ...Array.from({ length: 11 }, (_v, i) => candidate(i + 2))];
    vi.mocked(fetchBfgProCandidates).mockResolvedValueOnce(pool);

    fetchMock
      .mockResolvedValueOnce(mockLunaResponse('{"queries":["Arbeitszimmer"],"norm":null}'))
      .mockResolvedValueOnce(mockLunaResponse(JSON.stringify({
        selections: pool.map((c) => ({
          candidateId: c.candidateId,
          score: 80,
          comment: "Shortlist comment",
          caseSummary: "Shortlist summary",
        })),
      })))
      .mockResolvedValueOnce(mockLunaResponse(JSON.stringify({
        selections: [
          {
            candidateId: "candidate-1",
            score: 90,
            legalIssue: "Rechtsfrage",
            caseSummary: "Zusammenfassung",
            whyRelevant: "Relevanz",
            similarities: "Gemeinsamkeiten",
            differences: "Unterschiede",
            sourceQuote: null,
            periodAssessment: "Rechtslage 2020",
          },
        ],
      })));

    await runBfgProSearch("Arbeitszimmer");

    const prelimPayload = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body);
    const prelimExcerpt = JSON.parse(prelimPayload.messages[1].content).candidates[0].excerpt;
    expect(prelimExcerpt.length).toBeLessThanOrEqual(1_800);
    expect(prelimExcerpt).not.toContain("DISTINCTIVE-PASSAGE-BEYOND-1800");

    const finalPayload = JSON.parse(fetchMock.mock.calls[2]?.[1]?.body);
    const finalText = JSON.parse(finalPayload.messages[1].content).candidates[0].content;
    expect(finalText).toContain("DISTINCTIVE-PASSAGE-BEYOND-1800");
  });

  it("verifies verbatim source quote with case-sensitive whitespace-normalized matching and rejects counterfeits", async () => {
    const text = "Das häusliche Arbeitszimmer  bildet  den Mittelpunkt.\nEs wurde voll anerkannt.";
    const cand = candidate(1, { content: text });
    vi.mocked(fetchBfgProCandidates).mockResolvedValueOnce([cand]);

    // Valid quote with normalized whitespace
    fetchMock
      .mockResolvedValueOnce(mockLunaResponse('{"queries":["Arbeitszimmer"],"norm":null}'))
      .mockResolvedValueOnce(mockLunaResponse(JSON.stringify({
        selections: [
          {
            candidateId: "candidate-1",
            score: 90,
            legalIssue: "Frage",
            caseSummary: "Zusammenfassung",
            whyRelevant: "Relevant",
            similarities: "Gleich",
            differences: "Anders",
            sourceQuote: "Das häusliche Arbeitszimmer bildet den Mittelpunkt. Es wurde voll anerkannt.",
            periodAssessment: "2020",
          },
        ],
      })));

    const res1 = await runBfgProSearch("Arbeitszimmer");
    expect(res1.results[0]?.sourceQuote).toBe(
      "Das häusliche Arbeitszimmer bildet den Mittelpunkt. Es wurde voll anerkannt.",
    );

    // Case-changed quote -> must be null
    fetchMock
      .mockResolvedValueOnce(mockLunaResponse('{"queries":["Arbeitszimmer"],"norm":null}'))
      .mockResolvedValueOnce(mockLunaResponse(JSON.stringify({
        selections: [
          {
            candidateId: "candidate-1",
            score: 90,
            legalIssue: "Frage",
            caseSummary: "Zusammenfassung",
            whyRelevant: "Relevant",
            similarities: "Gleich",
            differences: "Anders",
            sourceQuote: "das häusliche arbeitszimmer bildet den mittelpunkt.",
            periodAssessment: "2020",
          },
        ],
      })));

    const res2 = await runBfgProSearch("Arbeitszimmer");
    expect(res2.results[0]?.sourceQuote).toBeNull();

    // Fabricated quote -> must be null
    fetchMock
      .mockResolvedValueOnce(mockLunaResponse('{"queries":["Arbeitszimmer"],"norm":null}'))
      .mockResolvedValueOnce(mockLunaResponse(JSON.stringify({
        selections: [
          {
            candidateId: "candidate-1",
            score: 90,
            legalIssue: "Frage",
            caseSummary: "Zusammenfassung",
            whyRelevant: "Relevant",
            similarities: "Gleich",
            differences: "Anders",
            sourceQuote: "Dieser Satz wurde frei erfunden.",
            periodAssessment: "2020",
          },
        ],
      })));

    const res3 = await runBfgProSearch("Arbeitszimmer");
    expect(res3.results[0]?.sourceQuote).toBeNull();
  });

  it("tracks single-decision truncation and aggregate 600000 char budget truncation accurately", async () => {
    const cand1 = candidate(1, {
      content: "x".repeat(100_000),
      contentTruncated: false,
    });
    const cand2 = candidate(2, {
      content: "y".repeat(100_000),
      contentTruncated: true,
    });

    vi.mocked(fetchBfgProCandidates).mockResolvedValueOnce([cand1, cand2]);

    fetchMock
      .mockResolvedValueOnce(mockLunaResponse('{"queries":["Arbeitszimmer"],"norm":null}'))
      .mockResolvedValueOnce(mockLunaResponse(JSON.stringify({
        selections: [
          {
            candidateId: "candidate-1",
            score: 85,
            legalIssue: "Frage 1",
            caseSummary: "Zusammenfassung 1",
            whyRelevant: "Relevant 1",
            similarities: "Gleich 1",
            differences: "Anders 1",
            sourceQuote: null,
            periodAssessment: "2020",
          },
          {
            candidateId: "candidate-2",
            score: 80,
            legalIssue: "Frage 2",
            caseSummary: "Zusammenfassung 2",
            whyRelevant: "Relevant 2",
            similarities: "Gleich 2",
            differences: "Anders 2",
            sourceQuote: null,
            periodAssessment: "2020",
          },
        ],
      })));

    const response = await runBfgProSearch("Arbeitszimmer");

    expect(response.results).toHaveLength(2);
    expect(response.results[0]?.textTruncated).toBe(false);
    expect(response.results[1]?.textTruncated).toBe(true);
  });

  it("fails closed when finish_reason is length or error response occurs", async () => {
    fetchMock.mockResolvedValueOnce(mockLunaResponse('{"queries":["Arbeitszimmer"],"norm":null}', "length"));

    await expect(runBfgProSearch("Sachverhalt")).rejects.toBeInstanceOf(BfgProModelError);
  });

  it("instructs model on decision date vs assessment year and unknown period/changes", async () => {
    vi.mocked(fetchBfgProCandidates).mockResolvedValueOnce([candidate(1)]);

    fetchMock
      .mockResolvedValueOnce(mockLunaResponse('{"queries":["Arbeitszimmer"],"norm":null}'))
      .mockResolvedValueOnce(mockLunaResponse(JSON.stringify({
        selections: [
          {
            candidateId: "candidate-1",
            score: 85,
            legalIssue: "Kernfrage",
            caseSummary: "Sachverhalt",
            whyRelevant: "Relevanz",
            similarities: "Gemeinsamkeiten",
            differences: "Unterschiede",
            sourceQuote: null,
            periodAssessment: "Veranlagungsjahr unbekannt; Gesetzesänderungen nicht ersichtlich.",
          },
        ],
      })));

    const response = await runBfgProSearch("Sachverhalt im Jahr 2024");

    const finalEvalSystemPrompt = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body).messages[0].content;
    expect(finalEvalSystemPrompt).toContain("Entscheidungsdatum");
    expect(finalEvalSystemPrompt).toContain("Veranlagungs");
    expect(finalEvalSystemPrompt).toContain("unbekannt");

    expect(response.results[0]?.periodAssessment).toBe(
      "Veranlagungsjahr unbekannt; Gesetzesänderungen nicht ersichtlich.",
    );
  });

  it("drops fabricated candidate IDs and filters selections with score below 30", async () => {
    vi.mocked(fetchBfgProCandidates).mockResolvedValueOnce([candidate(1), candidate(2)]);

    fetchMock
      .mockResolvedValueOnce(mockLunaResponse('{"queries":["Arbeitszimmer"],"norm":null}'))
      .mockResolvedValueOnce(mockLunaResponse(JSON.stringify({
        selections: [
          {
            candidateId: "invented-id",
            score: 99,
            legalIssue: "Erfunden",
            caseSummary: "Erfunden",
            whyRelevant: "Erfunden",
            similarities: "Erfunden",
            differences: "Erfunden",
            sourceQuote: null,
            periodAssessment: "2020",
          },
          {
            candidateId: "candidate-1",
            score: 25, // below 30
            legalIssue: "Zu gering",
            caseSummary: "Zu gering",
            whyRelevant: "Zu gering",
            similarities: "Zu gering",
            differences: "Zu gering",
            sourceQuote: null,
            periodAssessment: "2020",
          },
          {
            candidateId: "candidate-2",
            score: 75,
            legalIssue: "Passend",
            caseSummary: "Passend",
            whyRelevant: "Passend",
            similarities: "Passend",
            differences: "Passend",
            sourceQuote: null,
            periodAssessment: "2020",
          },
        ],
      })));

    const response = await runBfgProSearch("Arbeitszimmer");
    expect(response.results).toHaveLength(1);
    expect(response.results[0]?.gz).toBe(candidate(2).gz);
    expect(response.results[0]?.score).toBe(75);
  });

  it("preserves official metadata from Findok and returns valid fields", async () => {
    vi.mocked(fetchBfgProCandidates).mockResolvedValueOnce([officialCandidate]);

    fetchMock
      .mockResolvedValueOnce(mockLunaResponse('{"queries":["Arbeitszimmer"],"norm":null}'))
      .mockResolvedValueOnce(mockLunaResponse(JSON.stringify({
        selections: [
          {
            candidateId: "candidate-1",
            score: 95,
            legalIssue: "Gültige rechtliche Kernfrage",
            caseSummary: "Gültiger Sachverhalt und Ergebnis",
            whyRelevant: "Gültige Relevanzbegründung",
            similarities: "Gültige Ähnlichkeiten",
            differences: "Gültige Unterschiede",
            sourceQuote: null,
            periodAssessment: "Gültige Periodeneinordnung",
          },
        ],
      })));

    const response = await runBfgProSearch("Arbeitszimmer");
    expect(response.results).toHaveLength(1);
    const r = response.results[0]!;

    expect(r.score).toBe(95);
    // Official metadata must NOT be overwritten by model
    expect(r.title).toBe(officialCandidate.title);
    expect(r.gz).toBe(officialCandidate.gz);
    expect(r.htmlUrl).toBe(officialCandidate.htmlUrl);
    expect(r.pdfUrl).toBe(officialCandidate.pdfUrl);

    // Generated fields preserved
    expect(r.legalIssue).toBe("Gültige rechtliche Kernfrage");
    expect(r.caseSummary).toBe("Gültiger Sachverhalt und Ergebnis");
    expect(r.whyRelevant).toBe("Gültige Relevanzbegründung");
    expect(r.similarities).toBe("Gültige Ähnlichkeiten");
    expect(r.differences).toBe("Gültige Unterschiede");
    expect(r.periodAssessment).toBe("Gültige Periodeneinordnung");
  });

  it("prioritizes a short distinctive term across candidates over earlier common long terms", async () => {
    vi.mocked(fetchBfgProCandidates).mockResolvedValueOnce([
      {
        ...candidate(1),
        content: [
          "Unterhaltsabsetzbetrag.",
          "Erster Abstand. ".repeat(180),
          "Drittstaat.",
          "Zweiter Abstand. ".repeat(180),
          "DBA war entscheidend.",
        ].join(" "),
      },
      {
        ...candidate(2),
        content: "Unterhaltsabsetzbetrag und Drittstaat waren zu beurteilen.",
      },
    ]);

    fetchMock
      .mockResolvedValueOnce(mockLunaResponse(JSON.stringify({
        queries: ["Unterhaltsabsetzbetrag Drittstaat DBA"],
        norm: null,
      })))
      .mockResolvedValueOnce(mockLunaResponse(JSON.stringify({
        selections: [{
          candidateId: "candidate-1",
          score: 70,
          legalIssue: "Frage",
          whyRelevant: "Passend.",
          caseSummary: "Ein DBA war entscheidend.",
          similarities: "Gleich",
          differences: "Anders",
          sourceQuote: null,
          periodAssessment: "2020",
        }],
      })));

    await runBfgProSearch("Unterhaltsabsetzbetrag Drittstaat DBA");
    const evalPayload = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body);
    const candidate1 = JSON.parse(evalPayload.messages[1].content).candidates.find(
      (c: { candidateId: string }) => c.candidateId === "candidate-1",
    );

    expect(candidate1.content).toContain("DBA war entscheidend");
  });

  it("does not clip an untrusted overlong quote with fabricated suffix into validity", async () => {
    const sourceText = "A".repeat(300) + " This source has no invented suffix.";
    vi.mocked(fetchBfgProCandidates).mockResolvedValueOnce([
      candidate(1, { content: sourceText }),
    ]);

    fetchMock
      .mockResolvedValueOnce(mockLunaResponse('{"queries":["Arbeitszimmer"],"norm":null}'))
      .mockResolvedValueOnce(mockLunaResponse(JSON.stringify({
        selections: [
          {
            candidateId: "candidate-1",
            score: 85,
            legalIssue: "Synthetische Rechtsfrage.",
            caseSummary: "Synthetischer Sachverhalt.",
            whyRelevant: "Synthetische Relevanz.",
            similarities: "Synthetische Gemeinsamkeit.",
            differences: "Synthetischer Unterschied.",
            periodAssessment: "Im Test nicht ersichtlich.",
            sourceQuote: "A".repeat(300) + " FABRICATED CONTINUATION",
          },
        ],
      })));

    const response = await runBfgProSearch("Synthetischer Sachverhalt");
    expect(response.results[0]?.sourceQuote).toBeNull();
  });

  const validFinalItem = (id: string, overrides: Record<string, unknown> = {}) => ({
    candidateId: id,
    score: 85,
    legalIssue: "Kernfrage",
    caseSummary: "Zusammenfassung",
    whyRelevant: "Relevanz",
    similarities: "Gemeinsamkeiten",
    differences: "Unterschiede",
    sourceQuote: null,
    periodAssessment: "2020",
    ...overrides,
  });
  const queryPlanResponse = () => mockLunaResponse('{"queries":["Arbeitszimmer"],"norm":null}');
  const finalResponse = (...items: unknown[]) => mockLunaResponse(JSON.stringify({ selections: items }));

  it("ignores unknown top-level and item fields instead of rejecting the response", async () => {
    vi.mocked(fetchBfgProCandidates).mockResolvedValueOnce([candidate(1)]);
    fetchMock
      .mockResolvedValueOnce(queryPlanResponse())
      .mockResolvedValueOnce(mockLunaResponse(JSON.stringify({
        selections: [validFinalItem("candidate-1", { unexpectedField: "ignored" })],
        unexpectedTopLevelKey: "ignored",
      })));

    const response = await runBfgProSearch("Sachverhalt");

    expect(response.results).toHaveLength(1);
    expect(response.results[0]).not.toHaveProperty("unexpectedField");
    expect(response.results[0]?.unranked).toBeUndefined();
  });

  it("treats a wrongly typed quote as unverified instead of rejecting the selection", async () => {
    vi.mocked(fetchBfgProCandidates).mockResolvedValueOnce([candidate(1)]);
    fetchMock
      .mockResolvedValueOnce(queryPlanResponse())
      .mockResolvedValueOnce(finalResponse(validFinalItem("candidate-1", { sourceQuote: 12345 })));

    const response = await runBfgProSearch("Sachverhalt");

    expect(response.results).toHaveLength(1);
    expect(response.results[0]?.sourceQuote).toBeNull();
  });

  it("drops items lacking an essential field (legacy comment alias) and keeps the others", async () => {
    vi.mocked(fetchBfgProCandidates).mockResolvedValueOnce([candidate(1), candidate(2)]);
    const legacy: Record<string, unknown> = validFinalItem("candidate-1");
    delete legacy.whyRelevant;
    fetchMock
      .mockResolvedValueOnce(queryPlanResponse())
      .mockResolvedValueOnce(finalResponse(
        { ...legacy, comment: "Alte Bezeichnung statt whyRelevant" },
        validFinalItem("candidate-2", { score: 70 }),
      ));

    const response = await runBfgProSearch("Sachverhalt");

    expect(response.results.map((r) => r.gz)).toEqual([candidate(2).gz]);
  });

  it.each([
    ["legalIssue", 300],
    ["caseSummary", 500],
    ["whyRelevant", 300],
    ["similarities", 400],
    ["differences", 400],
    ["periodAssessment", 400],
  ])("truncates an over-long %s at a word boundary and keeps all selections", async (field, cap) => {
    vi.mocked(fetchBfgProCandidates).mockResolvedValueOnce([candidate(1), candidate(2)]);
    const longText = "Wort ".repeat(Math.ceil((cap * 2) / 5));
    fetchMock
      .mockResolvedValueOnce(queryPlanResponse())
      .mockResolvedValueOnce(finalResponse(
        validFinalItem("candidate-1", { [field]: longText }),
        validFinalItem("candidate-2", { score: 70 }),
      ));

    const response = await runBfgProSearch("Sachverhalt");

    expect(response.results).toHaveLength(2);
    const truncated = response.results[0]?.[field as keyof BfgProResult] as string;
    expect(truncated.length).toBeLessThanOrEqual(cap);
    expect(truncated.endsWith("…")).toBe(true);
    expect(truncated.slice(0, -1).endsWith("Wort")).toBe(true);
    expect(response.results[1]?.[field as keyof BfgProResult]).not.toMatch(/…$/u);
  });

  it("keeps the valid selections when one has an over-long field and one an unknown GZ", async () => {
    vi.mocked(fetchBfgProCandidates).mockResolvedValueOnce([candidate(1), candidate(2), candidate(3)]);
    fetchMock
      .mockResolvedValueOnce(queryPlanResponse())
      .mockResolvedValueOnce(finalResponse(
        validFinalItem("candidate-1", { caseSummary: "Sehr lang. ".repeat(100), score: 90 }),
        validFinalItem("candidate-99", { score: 99 }),
        validFinalItem("candidate-3", { score: 60 }),
      ));

    const response = await runBfgProSearch("Sachverhalt");

    expect(response.results.map((r) => r.gz)).toEqual([candidate(1).gz, candidate(3).gz]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("only keeps up to 10 selections when the model returns more", async () => {
    vi.mocked(fetchBfgProCandidates).mockResolvedValueOnce(
      Array.from({ length: 10 }, (_v, i) => candidate(i + 1)),
    );
    fetchMock
      .mockResolvedValueOnce(queryPlanResponse())
      .mockResolvedValueOnce(finalResponse(
        ...Array.from({ length: 12 }, (_v, i) => validFinalItem(`candidate-${(i % 10) + 1}`)),
      ));

    const response = await runBfgProSearch("Sachverhalt");

    expect(response.results).toHaveLength(10);
  });

  it("retries the final stage once and uses the second answer", async () => {
    vi.mocked(fetchBfgProCandidates).mockResolvedValueOnce([candidate(1)]);
    fetchMock
      .mockResolvedValueOnce(queryPlanResponse())
      .mockResolvedValueOnce(new Response("overloaded", { status: 503 }))
      .mockResolvedValueOnce(finalResponse(validFinalItem("candidate-1")));

    const response = await runBfgProSearch("Sachverhalt");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(response.results).toHaveLength(1);
    expect(response.results[0]?.unranked).toBeUndefined();
  });

  it("retries after finish_reason length with a larger token budget", async () => {
    vi.mocked(fetchBfgProCandidates).mockResolvedValueOnce([candidate(1)]);
    fetchMock
      .mockResolvedValueOnce(queryPlanResponse())
      .mockResolvedValueOnce(mockLunaResponse("{", "length"))
      .mockResolvedValueOnce(finalResponse(validFinalItem("candidate-1")));

    await runBfgProSearch("Sachverhalt");

    const budgets = fetchMock.mock.calls.slice(1).map(([, init]) => (
      JSON.parse(String((init as RequestInit).body)).max_tokens as number
    ));
    expect(budgets[1]).toBeGreaterThan(budgets[0]);
  });

  it("does not retry non-transient model failures such as an HTTP 401", async () => {
    vi.mocked(fetchBfgProCandidates).mockResolvedValueOnce([candidate(1)]);
    fetchMock
      .mockResolvedValueOnce(queryPlanResponse())
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));

    const warnings: unknown[] = [];
    const response = await runBfgProSearch("Sachverhalt", { onWarning: (w) => warnings.push(w) });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.results[0]?.unranked).toBe(true);
    expect(warnings).toHaveLength(1);
  });

  it("falls back to unranked candidates when the final stage fails twice", async () => {
    vi.mocked(fetchBfgProCandidates).mockResolvedValueOnce([candidate(1), candidate(2)]);
    fetchMock
      .mockResolvedValueOnce(queryPlanResponse())
      .mockResolvedValueOnce(mockLunaResponse("kein JSON"))
      .mockResolvedValueOnce(mockLunaResponse("immer noch kein JSON"));
    const warnings: unknown[] = [];
    const progress: BfgProProgress[] = [];

    const response = await runBfgProSearch("Sachverhalt", {
      onProgress: (p) => progress.push(p),
      onWarning: (w) => warnings.push(w),
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(response.results).toHaveLength(2);
    expect(response.results[0]).toMatchObject({
      title: candidate(1).title,
      gz: candidate(1).gz,
      htmlUrl: candidate(1).htmlUrl,
      pdfUrl: candidate(1).pdfUrl,
      unranked: true,
      score: 0,
      caseSummary: "",
      whyRelevant: "",
      legalIssue: "",
      similarities: "",
      differences: "",
      periodAssessment: "",
      sourceQuote: null,
    });
    expect(warnings).toEqual([{
      warning: "unranked",
      message: expect.stringContaining("ohne KI-Bewertung"),
    }]);
    expect(progress.at(-1)).toEqual({ stage: "summarizing", count: 2 });
  });

  it("falls back to unranked candidates when no selection survives validation twice", async () => {
    vi.mocked(fetchBfgProCandidates).mockResolvedValueOnce([candidate(1)]);
    fetchMock
      .mockResolvedValueOnce(queryPlanResponse())
      .mockResolvedValueOnce(finalResponse(validFinalItem("candidate-99")))
      .mockResolvedValueOnce(finalResponse(validFinalItem("candidate-98")));

    const response = await runBfgProSearch("Sachverhalt");

    expect(response.results).toHaveLength(1);
    expect(response.results[0]?.unranked).toBe(true);
  });

  it("limits the unranked fallback to 10 deterministically sorted candidates", async () => {
    vi.mocked(fetchBfgProCandidates).mockResolvedValueOnce(
      Array.from({ length: 30 }, (_v, i) => candidate(i + 1)),
    );
    const shortlist = mockLunaResponse(JSON.stringify({
      selections: Array.from({ length: 18 }, (_v, i) => ({
        candidateId: `candidate-${i + 1}`,
        score: 80,
        comment: "passt",
        caseSummary: "Sachverhalt",
      })),
    }));
    fetchMock
      .mockResolvedValueOnce(queryPlanResponse())
      .mockResolvedValueOnce(shortlist)
      .mockResolvedValueOnce(mockLunaResponse("", "stop"))
      .mockResolvedValueOnce(mockLunaResponse("{"));

    const response = await runBfgProSearch("Arbeitszimmer");

    expect(response.results).toHaveLength(10);
    expect(response.results.every((r) => r.unranked === true)).toBe(true);
  });

  it("still ranks the deterministic top 10 when the preliminary stage fails twice", async () => {
    vi.mocked(fetchBfgProCandidates).mockResolvedValueOnce(
      Array.from({ length: 30 }, (_v, i) => candidate(i + 1)),
    );
    fetchMock
      .mockResolvedValueOnce(queryPlanResponse())
      .mockResolvedValueOnce(mockLunaResponse("kaputt"))
      .mockResolvedValueOnce(mockLunaResponse("kaputt"))
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String((init as RequestInit).body)) as {
          messages: Array<{ content: string }>;
        };
        const sent = JSON.parse(body.messages[1].content) as { candidates: Array<{ candidateId: string }> };
        expect(sent.candidates).toHaveLength(10);
        return finalResponse(validFinalItem(sent.candidates[0].candidateId));
      });

    const response = await runBfgProSearch("Arbeitszimmer");

    expect(response.results).toHaveLength(1);
    expect(response.results[0]?.unranked).toBeUndefined();
  });

  it("keeps candidates from earlier queries when a later Findok query fails", async () => {
    fetchMock.mockResolvedValueOnce(mockLunaResponse(
      '{"queries":["Arbeitszimmer","Homeoffice"],"norm":null}',
    ));
    vi.mocked(fetchBfgProCandidates)
      .mockResolvedValueOnce([candidate(1)])
      .mockRejectedValueOnce(new FindokUpstreamError("down"));
    fetchMock.mockResolvedValueOnce(finalResponse(validFinalItem("candidate-1")));

    const response = await runBfgProSearch("Sachverhalt");

    expect(response.results).toHaveLength(1);
  });

  it("throws the Findok upstream error only when every query failed", async () => {
    fetchMock.mockResolvedValueOnce(mockLunaResponse(
      '{"queries":["Arbeitszimmer","Homeoffice"],"norm":null}',
    ));
    vi.mocked(fetchBfgProCandidates).mockRejectedValue(new FindokUpstreamError("down"));

    await expect(runBfgProSearch("Sachverhalt")).rejects.toBeInstanceOf(FindokUpstreamError);
  });

  it("hands the client signal to Findok and stops before any further model call once aborted", async () => {
    const controller = new AbortController();
    const modelSignals: AbortSignal[] = [];
    fetchMock.mockImplementation(async (_url: unknown, init?: RequestInit) => {
      if (init?.signal) modelSignals.push(init.signal);
      return queryPlanResponse();
    });
    vi.mocked(fetchBfgProCandidates).mockImplementation(async ({ signal }) => {
      expect(signal).toBe(controller.signal);
      controller.abort();
      return [candidate(1)];
    });

    await expect(runBfgProSearch("Sachverhalt", { signal: controller.signal }))
      .rejects.toBeInstanceOf(BfgProAbortError);

    // Only the query stage ran; the aborted run never reached a second model call.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(modelSignals).toHaveLength(1);
  });

  it("aborts an in-flight OmniRoute request when the client signal fires", async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: unknown, init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });

    const run = runBfgProSearch("Sachverhalt", { signal: controller.signal });
    await vi.waitFor(() => expect(seen).toBeDefined());
    controller.abort();

    await expect(run).rejects.toBeInstanceOf(BfgProAbortError);
    expect(seen?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("truncateAtWord cuts at a word boundary, appends an ellipsis and respects the cap", () => {
    expect(truncateAtWord("kurz", 10)).toBe("kurz");
    const cut = truncateAtWord("Eins zwei drei vier fünf sechs", 20);
    expect(cut).toBe("Eins zwei drei vier…");
    expect(cut.length).toBeLessThanOrEqual(20);
    expect(truncateAtWord("Unzerteilbareslangeswort", 10)).toBe("Unzerteil…");
  });

  it("includes explicit character caps for all seven substantive prose fields in final evaluation prompt", async () => {
    vi.mocked(fetchBfgProCandidates).mockResolvedValueOnce([candidate(1)]);
    fetchMock
      .mockResolvedValueOnce(mockLunaResponse('{"queries":["Arbeitszimmer"],"norm":null}'))
      .mockResolvedValueOnce(mockLunaResponse(JSON.stringify({
        selections: [{
          candidateId: "candidate-1",
          score: 85,
          legalIssue: "Kernfrage",
          caseSummary: "Zusammenfassung",
          whyRelevant: "Relevanz",
          similarities: "Gemeinsamkeiten",
          differences: "Unterschiede",
          sourceQuote: null,
          periodAssessment: "2020",
        }],
      })));

    await runBfgProSearch("Sachverhalt");
    const prompt = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body).messages[0].content;
    expect(prompt).toContain("legalIssue, höchstens 300 Zeichen");
    expect(prompt).toContain("caseSummary den Sachverhalt und das Ergebnis der Entscheidung kurz zusammen (höchstens 500 Zeichen)");
    expect(prompt).toContain("whyRelevant die Relevanz für den Sachverhalt (höchstens 300 Zeichen)");
    expect(prompt).toContain("similarities wesentliche sachverhaltliche Gemeinsamkeiten (höchstens 400 Zeichen)");
    expect(prompt).toContain("differences wesentliche Unterschiede (höchstens 400 Zeichen)");
    expect(prompt).toContain("periodAssessment die zeitliche Anwendbarkeit und die maßgebliche Rechtslage ausschließlich anhand der im Text vorliegenden Beweise (höchstens 400 Zeichen)");
    expect(prompt).toContain("sourceQuote ein kurzes, wörtliches Zitat (höchstens 300 Zeichen)");
  });

  it("ignores preliminary selection IDs that exist in official candidates but were not sent to the shortlist model", async () => {
    const pool = Array.from({ length: 25 }, (_v, i) => candidate(i + 1));
    vi.mocked(fetchBfgProCandidates).mockResolvedValueOnce(pool);

    fetchMock
      .mockResolvedValueOnce(mockLunaResponse('{"queries":["Arbeitszimmer"],"norm":null}'))
      .mockResolvedValueOnce(mockLunaResponse(JSON.stringify({
        selections: [
          {
            candidateId: "candidate-20",
            score: 98,
            comment: "Invented selection for unsent candidate",
            caseSummary: "Unsent candidate summary",
          },
          {
            candidateId: "candidate-1",
            score: 85,
            comment: "Sent candidate comment",
            caseSummary: "Sent candidate summary",
          },
        ],
      })))
      .mockResolvedValueOnce(mockLunaResponse(JSON.stringify({
        selections: [
          {
            candidateId: "candidate-1",
            score: 85,
            legalIssue: "Kernfrage",
            caseSummary: "Zusammenfassung",
            whyRelevant: "Relevanz",
            similarities: "Gemeinsamkeiten",
            differences: "Unterschiede",
            sourceQuote: null,
            periodAssessment: "2020",
          },
        ],
      })));

    const response = await runBfgProSearch("Arbeitszimmer");

    const finalEvalPayload = JSON.parse(fetchMock.mock.calls[2]?.[1]?.body);
    const finalCandidatesInPrompt = JSON.parse(finalEvalPayload.messages[1].content).candidates;
    expect(finalCandidatesInPrompt.map((c: { candidateId: string }) => c.candidateId)).toEqual(["candidate-1"]);

    expect(response.results).toHaveLength(1);
    expect(response.results[0]?.gz).toBe(candidate(1).gz);
  });
});
