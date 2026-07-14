import { beforeEach, describe, expect, it, vi } from "vitest";

import { chatCompletion } from "@/lib/deepseek";
import { resolveLlmRuntime, type LlmRuntime } from "@/lib/llm/runtime";
import { fetchBfgProCandidates } from "./bfg-decisions";
import {
  BfgProModelError,
  buildDeterministicExcerpt,
  runBfgProSearch,
} from "./bfg-pro";

vi.mock("@/lib/deepseek", () => ({ chatCompletion: vi.fn() }));
vi.mock("@/lib/llm/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/runtime")>();
  return { ...actual, resolveLlmRuntime: vi.fn() };
});
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

const FIXED_RUNTIME = {
  model: "deepseek-v4-flash",
  provider: "deepseek",
  upstreamModel: "deepseek-v4-flash",
  baseUrl: "https://api.deepseek.com",
  apiKey: "server-only-key",
  reasoning: "disabled",
} satisfies LlmRuntime;

function candidate(number: number) {
  return {
    ...officialCandidate,
    candidateId: `candidate-${number}`,
    title: `Offizieller Treffer ${number}`,
    gz: `RV/710000${number}/2025`,
    htmlUrl: `https://findok.bmf.gv.at/findok/volltext?dokumentId=doc-${number}&segmentId=seg-${number}&indexName=findok`,
  };
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

describe("BFG PRO query generation and reranking", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(resolveLlmRuntime).mockReturnValue(FIXED_RUNTIME);
    vi.mocked(fetchBfgProCandidates).mockResolvedValue([officialCandidate]);
  });

  it("uses the server key and fixed Flash model for both model calls", async () => {
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce({
        content: '{"queries":["Arbeitszimmer Vorsteuer"],"norm":null}',
        toolCalls: [],
        finishReason: "stop",
      })
      .mockResolvedValueOnce({
        content: '{"selections":[{"candidateId":"candidate-1","score":87,"comment":"Behandelt ein Arbeitszimmer und den Vorsteuerabzug.","caseSummary":"Ein beruflich genutztes Arbeitszimmer im Wohnungsverband war zu beurteilen; das BFG entschied über den geltend gemachten Vorsteuerabzug."}]}',
        toolCalls: [],
        finishReason: "stop",
      });

    await runBfgProSearch("Ein Raum meiner Wohnung wird ausschließlich beruflich genutzt.");

    expect(resolveLlmRuntime).toHaveBeenCalledWith({
      model: "deepseek-v4-flash",
      reasoning: "disabled",
    });
    expect(chatCompletion).toHaveBeenCalledTimes(2);
    for (const [options] of vi.mocked(chatCompletion).mock.calls) {
      expect(options).toMatchObject({ runtime: FIXED_RUNTIME });
      expect(options.tools).toBeUndefined();
    }
    expect(fetchBfgProCandidates).toHaveBeenCalledWith({ query: "Arbeitszimmer Vorsteuer" });
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
    vi.mocked(chatCompletion).mockResolvedValueOnce({ content, toolCalls: [], finishReason: "stop" });

    await expect(runBfgProSearch("Sachverhalt")).rejects.toBeInstanceOf(BfgProModelError);
    expect(fetchBfgProCandidates).not.toHaveBeenCalled();
  });

  it("normalizes and deduplicates query-plan variants before fallback retrieval", async () => {
    vi.mocked(fetchBfgProCandidates).mockResolvedValue([]);
    vi.mocked(chatCompletion).mockResolvedValueOnce({
      content: JSON.stringify({
        queries: ["  Arbeitszimmer  ", "arbeitszimmer", "Vorsteuer"],
        norm: null,
      }),
      toolCalls: [],
      finishReason: "stop",
    });

    await expect(runBfgProSearch("Sachverhalt")).resolves.toEqual({ results: [] });
    expect(vi.mocked(fetchBfgProCandidates).mock.calls).toEqual([
      [{ query: "Arbeitszimmer" }],
      [{ query: "Vorsteuer" }],
    ]);
  });

  it("always adds a supplied norm-filtered precision source without running broader recall at five", async () => {
    vi.mocked(fetchBfgProCandidates)
      .mockResolvedValueOnce(Array.from({ length: 5 }, (_value, index) => candidate(index + 1)))
      .mockResolvedValueOnce([candidate(1)]);
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce({
        content: JSON.stringify({
          queries: ["Arbeitszimmer", "betrieblicher Raum"],
          norm: "  EStG 1988 § 20  ",
        }),
        toolCalls: [],
        finishReason: "stop",
      })
      .mockResolvedValueOnce({
        content: '{"selections":[{"candidateId":"candidate-1","score":80,"comment":"Passend.","caseSummary":"Ein Arbeitszimmer war strittig; das BFG entschied darüber."}]}',
        toolCalls: [],
        finishReason: "stop",
      });

    await runBfgProSearch("Sachverhalt");

    expect(vi.mocked(fetchBfgProCandidates).mock.calls).toEqual([
      [{ query: "Arbeitszimmer" }],
      [{ query: "Arbeitszimmer", norm: "EStG 1988 § 20" }],
    ]);
  });

  it("runs broader fallback queries only while merged candidate recall stays below five", async () => {
    vi.mocked(fetchBfgProCandidates)
      .mockResolvedValueOnce([candidate(1), candidate(2)])
      .mockResolvedValueOnce([candidate(3), candidate(4), candidate(5)]);
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce({
        content: JSON.stringify({
          queries: ["präzise Begriffe", "breitere Synonyme", "weitere Normbegriffe"],
          norm: null,
        }),
        toolCalls: [],
        finishReason: "stop",
      })
      .mockResolvedValueOnce({
        content: '{"selections":[{"candidateId":"candidate-1","score":80,"comment":"Passend.","caseSummary":"Der offizielle Fall war einschlägig; das BFG entschied darüber."}]}',
        toolCalls: [],
        finishReason: "stop",
      });

    await runBfgProSearch("Sachverhalt");

    expect(vi.mocked(fetchBfgProCandidates).mock.calls).toEqual([
      [{ query: "präzise Begriffe" }],
      [{ query: "breitere Synonyme" }],
    ]);
  });

  it("runs the third planned query when recall remains below five after the second", async () => {
    vi.mocked(fetchBfgProCandidates)
      .mockResolvedValueOnce([candidate(1)])
      .mockResolvedValueOnce([candidate(2)])
      .mockResolvedValueOnce([candidate(3), candidate(4), candidate(5)]);
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce({
        content: JSON.stringify({
          queries: ["präzise Begriffe", "breitere Synonyme", "weitere Normbegriffe"],
          norm: null,
        }),
        toolCalls: [],
        finishReason: "stop",
      })
      .mockResolvedValueOnce({
        content: '{"selections":[{"candidateId":"candidate-1","score":80,"comment":"Passend.","caseSummary":"Der offizielle Fall war einschlägig; das BFG entschied darüber."}]}',
        toolCalls: [],
        finishReason: "stop",
      });

    await runBfgProSearch("Sachverhalt");

    expect(vi.mocked(fetchBfgProCandidates).mock.calls).toEqual([
      [{ query: "präzise Begriffe" }],
      [{ query: "breitere Synonyme" }],
      [{ query: "weitere Normbegriffe" }],
    ]);
  });

  it.each([
    ["non-JSON reranking", "candidate-1"],
    ["missing comment", '{"selections":[{"candidateId":"candidate-1","score":50}]}'],
    ["missing case summary", '{"selections":[{"candidateId":"candidate-1","score":50,"comment":"Relevant"}]}'],
    ["blank case summary", '{"selections":[{"candidateId":"candidate-1","score":50,"comment":"Relevant","caseSummary":"  "}]}'],
    ["oversized case summary", JSON.stringify({ selections: [{ candidateId: "candidate-1", score: 50, comment: "Relevant", caseSummary: "x".repeat(401) }] })],
    ["unknown generated metadata", '{"selections":[{"candidateId":"candidate-1","score":50,"comment":"Relevant","gz":"FAKE/1","url":"https://evil.example"}]}'],
    ["more than 18 selections", JSON.stringify({
      selections: Array.from({ length: 19 }, (_value, index) => ({
        candidateId: `candidate-${index + 1}`,
        score: 50,
        comment: "Relevant",
        caseSummary: "Sachverhalt und Ergebnis.",
      })),
    })],
  ])("rejects malformed reranker output: %s", async (_label, content) => {
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce({
        content: '{"queries":["Arbeitszimmer"],"norm":null}',
        toolCalls: [],
        finishReason: "stop",
      })
      .mockResolvedValueOnce({ content, toolCalls: [], finishReason: "stop" });

    await expect(runBfgProSearch("Sachverhalt")).rejects.toBeInstanceOf(BfgProModelError);
  });

  it("requires Flash to score every supplied candidate and accepts all 18 scores", async () => {
    vi.mocked(fetchBfgProCandidates).mockResolvedValueOnce(
      Array.from({ length: 18 }, (_value, index) => candidate(index + 1)),
    );
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce({
        content: '{"queries":["Arbeitszimmer"],"norm":null}',
        toolCalls: [],
        finishReason: "stop",
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          selections: Array.from({ length: 18 }, (_value, index) => ({
            candidateId: `candidate-${index + 1}`,
            score: 80 - index,
            comment: `Begründung ${index + 1}.`,
            caseSummary: `Sachverhalt und Ergebnis ${index + 1}.`,
          })),
        }),
        toolCalls: [],
        finishReason: "stop",
      });

    const response = await runBfgProSearch("Arbeitszimmer im Wohnungsverband");
    const rerankSystemPrompt = vi.mocked(chatCompletion).mock.calls[1]?.[0].messages[0]?.content;

    expect(rerankSystemPrompt).toContain("jeden");
    expect(rerankSystemPrompt).toContain("18");
    expect(response.results).toHaveLength(10);
  });

  it("filters scores below 30 before selecting the final results", async () => {
    vi.mocked(fetchBfgProCandidates).mockResolvedValueOnce([candidate(1), candidate(2)]);
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce({
        content: '{"queries":["Arbeitszimmer"],"norm":null}',
        toolCalls: [],
        finishReason: "stop",
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          selections: [
            {
              candidateId: "candidate-1",
              score: 29,
              comment: "Zu wenig ähnlich.",
              caseSummary: "Der Fall war nur entfernt ähnlich; das BFG entschied dazu.",
            },
            {
              candidateId: "candidate-2",
              score: 30,
              comment: "Ausreichend ähnlich.",
              caseSummary: "Der Fall erreichte die Relevanzschwelle; das BFG entschied dazu.",
            },
          ],
        }),
        toolCalls: [],
        finishReason: "stop",
      });

    const response = await runBfgProSearch("Arbeitszimmer");

    expect(response.results).toHaveLength(1);
    expect(response.results[0]).toMatchObject({ gz: candidate(2).gz, score: 30 });
  });

  it("drops fabricated candidate IDs and returns an empty list when none remain", async () => {
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce({
        content: '{"queries":["Arbeitszimmer"],"norm":null}',
        toolCalls: [],
        finishReason: "stop",
      })
      .mockResolvedValueOnce({
        content: '{"selections":[{"candidateId":"invented","score":99,"comment":"Erfundener Treffer","caseSummary":"Erfundener Sachverhalt mit erfundenem Ergebnis."}]}',
        toolCalls: [],
        finishReason: "stop",
      });

    await expect(runBfgProSearch("Sachverhalt")).resolves.toEqual({ results: [] });
  });

  it("deduplicates selections, bounds generated values, and retains only official metadata and links", async () => {
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce({
        content: '{"queries":["Arbeitszimmer"],"norm":null}',
        toolCalls: [],
        finishReason: "stop",
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          selections: [
            {
              candidateId: "candidate-1",
              score: 999,
              comment: ` Passend. ${"lang ".repeat(100)}`,
              caseSummary: "Ein Arbeitszimmer im Wohnungsverband war Gegenstand des Verfahrens; das BFG entschied über den Vorsteuerabzug.",
            },
            {
              candidateId: "candidate-1",
              score: 1,
              comment: "Duplikat",
              caseSummary: "Duplikat.",
            },
          ],
        }),
        toolCalls: [],
        finishReason: "stop",
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
      caseSummary: "Ein Arbeitszimmer im Wohnungsverband war Gegenstand des Verfahrens; das BFG entschied über den Vorsteuerabzug.",
    });
    expect(response.results[0]?.whyRelevant.length).toBeLessThanOrEqual(240);
    expect(response.results[0]?.caseSummary.length).toBeLessThanOrEqual(400);
  });

  it("sends only the bounded excerpt to Flash and returns only the bounded generated summary", async () => {
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce({
        content: '{"queries":["Arbeitszimmer"],"norm":null}',
        toolCalls: [],
        finishReason: "stop",
      })
      .mockResolvedValueOnce({
        content: '{"selections":[{"candidateId":"candidate-1","score":70,"comment":"Thematisch passend.","caseSummary":"Ein Arbeitszimmer im Wohnungsverband war strittig; das BFG entschied über dessen steuerliche Behandlung."}]}',
        toolCalls: [],
        finishReason: "stop",
      });

    const response = await runBfgProSearch("Arbeitszimmer");
    const rerankPrompt = vi.mocked(chatCompletion).mock.calls[1]?.[0].messages
      .map((message) => message.content ?? "")
      .join(" ") ?? "";

    expect(rerankPrompt).not.toContain("FULL-CONTENT-SECRET");
    expect(JSON.stringify(response)).not.toContain("FULL-CONTENT-SECRET");
    expect(response.results[0]?.caseSummary.length).toBeLessThanOrEqual(400);
    expect(response.results[0]).not.toHaveProperty("excerpt");
    expect(response.results[0]).not.toHaveProperty("content");
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
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce({
        content: JSON.stringify({
          queries: ["Unterhaltsabsetzbetrag Drittstaat DBA"],
          norm: null,
        }),
        toolCalls: [],
        finishReason: "stop",
      })
      .mockResolvedValueOnce({
        content: '{"selections":[{"candidateId":"candidate-1","score":70,"comment":"Thematisch passend.","caseSummary":"Ein DBA war entscheidend; das BFG entschied den Fall."}]}',
        toolCalls: [],
        finishReason: "stop",
      });

    await runBfgProSearch("Unterhaltsabsetzbetrag Drittstaat DBA");
    const rerankPayload = JSON.parse(
      vi.mocked(chatCompletion).mock.calls[1]?.[0].messages[1]?.content ?? "{}",
    ) as { candidates?: Array<{ candidateId: string; excerpt: string }> };

    expect(rerankPayload.candidates?.find(({ candidateId }) => candidateId === "candidate-1")?.excerpt)
      .toContain("DBA war entscheidend");
  });

  it("returns an empty list without reranking when Findok has no candidates", async () => {
    vi.mocked(fetchBfgProCandidates).mockResolvedValueOnce([]);
    vi.mocked(chatCompletion).mockResolvedValueOnce({
      content: '{"queries":["Arbeitszimmer"],"norm":null}',
      toolCalls: [],
      finishReason: "stop",
    });

    await expect(runBfgProSearch("Sachverhalt")).resolves.toEqual({ results: [] });
    expect(chatCompletion).toHaveBeenCalledTimes(1);
  });
});
