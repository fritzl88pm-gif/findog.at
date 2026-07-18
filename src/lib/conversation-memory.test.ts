import { describe, expect, it, vi } from "vitest";

import type { StichtagResolution } from "./legal-stichtag";
import {
  formatResearchMemory,
  loadConversationResearchMemory,
  MAX_MEMORY_CARDS,
  MAX_MEMORY_CHARS,
  MAX_MEMORY_ROWS,
  scopeResearchMemoryForQuestion,
  type ResearchMemoryEntry,
} from "./conversation-memory";

type QueryResult = { data: unknown; error: unknown };

type EvidenceRow = {
  id: string;
  source_key: string;
  source_name: string;
  evidence_kind: "discovery" | "norm" | "rechtssatz" | "entscheidung_chunk" | "secondary";
  requery_required: boolean;
  card_summary: string;
  card_topics: string[];
  canonical_id: string | null;
  version_id: string | null;
  official_uri: string | null;
  valid_from: string | null;
  valid_to: string | null;
  rechtssatz_id: string | null;
  decision_id: string | null;
  chunk_id: string | null;
  decision_date: string | null;
};

function evidenceRow(overrides: Partial<EvidenceRow> = {}): EvidenceRow {
  return {
    id: "evidence-1",
    source_key: "ris_bundesrecht",
    source_name: "RIS Bundesrecht",
    evidence_kind: "discovery",
    requery_required: true,
    card_summary: "§ 33 EStG könnte für die Frage relevant sein.",
    card_topics: ["Einkommensteuer"],
    canonical_id: null,
    version_id: null,
    official_uri: null,
    valid_from: null,
    valid_to: null,
    rechtssatz_id: null,
    decision_id: null,
    chunk_id: null,
    decision_date: null,
    ...overrides,
  };
}

function explicitStichtag(stichtag = "2025-06-15"): StichtagResolution {
  return { kind: "explicit", stichtag, matchedText: stichtag };
}

function queryClient(result: QueryResult) {
  const query: Record<string, ReturnType<typeof vi.fn> | unknown> = {};
  for (const method of ["select", "eq", "order", "limit"] as const) {
    query[method] = vi.fn().mockReturnValue(query);
  }
  query.then = (
    resolve: (value: QueryResult) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);

  const from = vi.fn().mockReturnValue(query);
  return {
    supabase: { from } as never,
    from,
    select: query.select as ReturnType<typeof vi.fn>,
    eq: query.eq as ReturnType<typeof vi.fn>,
    order: query.order as ReturnType<typeof vi.fn>,
    limit: query.limit as ReturnType<typeof vi.fn>,
  };
}

describe("loadConversationResearchMemory", () => {
  it("does not query memory when the legal cutoff is unknown", async () => {
    const { supabase, from } = queryClient({ data: [evidenceRow()], error: null });

    await expect(
      loadConversationResearchMemory({
        supabase,
        conversationId: "conversation-1",
        clientId: "client-1",
        stichtag: { kind: "unknown", stichtag: null, reason: "anaphoric" },
      }),
    ).resolves.toEqual([]);

    expect(from).not.toHaveBeenCalled();
  });

  it("queries the candidate view with exact conversation, client, and cutoff scope", async () => {
    const { supabase, from, select, eq, order, limit } = queryClient({
      data: [evidenceRow()],
      error: null,
    });

    const entries = await loadConversationResearchMemory({
      supabase,
      conversationId: "conversation-1",
      clientId: "client-1",
      stichtag: explicitStichtag("2025-06-15"),
    });

    expect(from).toHaveBeenCalledOnce();
    expect(from).toHaveBeenCalledWith("research_memory_candidates");
    expect(select).toHaveBeenCalledOnce();
    expect(select.mock.calls[0]?.[0]).toContain("card_summary");
    expect(eq.mock.calls).toEqual([
      ["conversation_id", "conversation-1"],
      ["client_id", "client-1"],
      ["retrieval_stichtag", "2025-06-15"],
    ]);
    expect(order.mock.calls).toEqual([
      ["created_at", { ascending: false }],
      ["retrieved_at", { ascending: false }],
      ["result_step_order", { ascending: false }],
      ["evidence_order", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(limit).toHaveBeenCalledWith(MAX_MEMORY_ROWS);
    expect(entries).toHaveLength(1);
  });

  it("keeps discovery cards as requery-required hints but rejects secondary cards as evidence", async () => {
    const { supabase } = queryClient({
      data: [
        evidenceRow({ id: "discovery", evidence_kind: "discovery", requery_required: true }),
        evidenceRow({
          id: "secondary",
          evidence_kind: "secondary",
          requery_required: false,
          source_key: "secondary_source",
        }),
      ],
      error: null,
    });

    const entries = await loadConversationResearchMemory({
      supabase,
      conversationId: "conversation-1",
      clientId: "client-1",
      stichtag: explicitStichtag(),
    });

    expect(entries.map((entry) => entry.evidenceId)).toEqual(["discovery"]);
  });

  it("only admits a norm version whose half-open validity interval contains the cutoff", async () => {
    const norm = (id: string, validFrom: string, validTo: string | null) =>
      evidenceRow({
        id,
        evidence_kind: "norm",
        requery_required: false,
        canonical_id: id,
        version_id: `${id}-version`,
        official_uri: `https://ris.bka.gv.at/${id}`,
        valid_from: validFrom,
        valid_to: validTo,
      });
    const { supabase } = queryClient({
      data: [
        norm("valid", "2025-01-01", "2026-01-01"),
        norm("future", "2025-06-16", null),
        norm("expired", "2024-01-01", "2025-06-15"),
      ],
      error: null,
    });

    const entries = await loadConversationResearchMemory({
      supabase,
      conversationId: "conversation-1",
      clientId: "client-1",
      stichtag: explicitStichtag("2025-06-15"),
    });

    expect(entries.map((entry) => entry.evidenceId)).toEqual(["valid"]);
  });

  it("drops every visible version when two norm versions conflict at the same cutoff", async () => {
    const { supabase } = queryClient({
      data: [
        evidenceRow({
          id: "version-a",
          evidence_kind: "norm",
          requery_required: false,
          canonical_id: "estg-33",
          version_id: "estg-33-v1",
          official_uri: "https://ris.bka.gv.at/estg-33-v1",
          valid_from: "2025-01-01",
          valid_to: null,
        }),
        evidenceRow({
          id: "version-b",
          evidence_kind: "norm",
          requery_required: false,
          canonical_id: "estg-33",
          version_id: "estg-33-v2",
          official_uri: "https://ris.bka.gv.at/estg-33-v2",
          valid_from: "2025-05-01",
          valid_to: null,
        }),
        evidenceRow({ id: "hint", evidence_kind: "discovery", requery_required: true }),
      ],
      error: null,
    });

    const entries = await loadConversationResearchMemory({
      supabase,
      conversationId: "conversation-1",
      clientId: "client-1",
      stichtag: explicitStichtag(),
    });

    expect(entries.map((entry) => entry.evidenceId)).toEqual(["hint"]);
  });

  it("keeps a requery norm hint separate from a verified version of the same norm", async () => {
    const { supabase } = queryClient({
      data: [
        evidenceRow({
          id: "norm-hint",
          evidence_kind: "norm",
          requery_required: true,
          canonical_id: "estg-33",
          version_id: "estg-33-v1",
        }),
        evidenceRow({
          id: "norm-verified",
          evidence_kind: "norm",
          requery_required: false,
          canonical_id: "estg-33",
          version_id: "estg-33-v1",
          official_uri: "https://ris.bka.gv.at/estg-33-v1",
          valid_from: "2025-01-01",
          valid_to: null,
        }),
      ],
      error: null,
    });

    const entries = await loadConversationResearchMemory({
      supabase,
      conversationId: "conversation-1",
      clientId: "client-1",
      stichtag: explicitStichtag(),
    });

    expect(entries.map((entry) => entry.evidenceId)).toEqual([
      "norm-hint",
      "norm-verified",
    ]);
  });

  it("enforces both the card-count and character budgets", async () => {
    const manyShortRows = Array.from({ length: MAX_MEMORY_CARDS + 4 }, (_, index) =>
      evidenceRow({ id: `short-${index}`, card_summary: `Hinweis ${index}` }),
    );
    const shortClient = queryClient({ data: manyShortRows, error: null });
    const countBounded = await loadConversationResearchMemory({
      supabase: shortClient.supabase,
      conversationId: "conversation-1",
      clientId: "client-1",
      stichtag: explicitStichtag(),
    });
    expect(countBounded).toHaveLength(MAX_MEMORY_CARDS);

    const manyLongRows = Array.from({ length: MAX_MEMORY_CARDS }, (_, index) =>
      evidenceRow({ id: `long-${index}`, card_summary: String(index).repeat(1_500) }),
    );
    const longClient = queryClient({ data: manyLongRows, error: null });
    const charBounded = await loadConversationResearchMemory({
      supabase: longClient.supabase,
      conversationId: "conversation-1",
      clientId: "client-1",
      stichtag: explicitStichtag(),
    });
    const totalChars = charBounded.reduce((sum, entry) => sum + entry.summary.length, 0);

    expect(totalChars).toBeLessThanOrEqual(MAX_MEMORY_CHARS);
    expect(charBounded).toHaveLength(Math.floor(MAX_MEMORY_CHARS / 1_500));
  });

  it("returns empty memory when the view query fails", async () => {
    const { supabase } = queryClient({ data: null, error: { code: "42P01" } });
    await expect(
      loadConversationResearchMemory({
        supabase,
        conversationId: "conversation-1",
        clientId: "client-1",
        stichtag: explicitStichtag(),
      }),
    ).resolves.toEqual([]);
  });
});

describe("formatResearchMemory", () => {
  it("returns undefined without entries or with an unknown cutoff", () => {
    expect(formatResearchMemory([], explicitStichtag())).toBeUndefined();
    expect(
      formatResearchMemory(
        [
          {
            evidenceId: "discovery",
            sourceKey: "ris_bundesrecht",
            sourceName: "RIS Bundesrecht",
            kind: "discovery",
            summary: "Recherchehinweis",
            topics: [],
            requeryRequired: true,
            canonicalId: null,
            versionId: null,
            officialUri: null,
            validFrom: null,
            validTo: null,
            rechtssatzId: null,
            decisionId: null,
            chunkId: null,
            decisionDate: null,
          },
        ],
        { kind: "unknown", stichtag: null, reason: "year_only", referenceYear: 2024 },
      ),
    ).toBeUndefined();
  });

  it("renders discovery memory explicitly as a non-authoritative RECHERCHEHINWEIS", () => {
    const entries: ResearchMemoryEntry[] = [
      {
        evidenceId: "evidence-discovery",
        sourceKey: "ris_bundesrecht",
        sourceName: "RIS Bundesrecht",
        kind: "discovery",
        summary: "§ 33 EStG könnte relevant sein.",
        topics: ["Einkommensteuer", "Absetzbetrag"],
        requeryRequired: true,
        canonicalId: null,
        versionId: null,
        officialUri: null,
        validFrom: null,
        validTo: null,
        rechtssatzId: null,
        decisionId: null,
        chunkId: null,
        decisionDate: null,
      },
    ];

    const block = formatResearchMemory(entries, explicitStichtag("2025-06-15"));

    expect(block).toContain("nicht autoritativ");
    expect(block).toContain("Stichtag dieser Auswahl: 2025-06-15");
    expect(block).toContain("[RECHERCHEHINWEIS · RIS Bundesrecht]");
    expect(block).toContain("muss vor rechtlicher Verwendung erneut");
    expect(block).toContain("§ 33 EStG könnte relevant sein.");
    expect(block).toContain("Evidenz-ID: evidence-discovery");
  });

  it("keeps a reusable norm version and its primary-source provenance explicit", () => {
    const entries: ResearchMemoryEntry[] = [
      {
        evidenceId: "evidence-norm",
        sourceKey: "ris_bundesrecht",
        sourceName: "RIS Bundesrecht",
        kind: "norm",
        summary: "§ 33 EStG regelt Absetzbeträge.",
        topics: ["EStG"],
        requeryRequired: false,
        canonicalId: "EStG-33",
        versionId: "EStG-33-v2025",
        officialUri: "https://www.ris.bka.gv.at/example",
        validFrom: "2025-01-01",
        validTo: null,
        rechtssatzId: null,
        decisionId: null,
        chunkId: null,
        decisionDate: null,
      },
    ];

    const block = formatResearchMemory(entries, explicitStichtag("2025-06-15"));

    expect(block).toContain("[NORM · RIS Bundesrecht]");
    expect(block).toContain("Norm-ID: EStG-33");
    expect(block).toContain("Fassung: EStG-33-v2025");
    expect(block).toContain("Gültig: 2025-01-01 bis offen");
    expect(block).toContain("Primärquelle: https://www.ris.bka.gv.at/example");
  });
});

describe("scopeResearchMemoryForQuestion", () => {
  const discovery = (overrides: Partial<ResearchMemoryEntry> = {}): ResearchMemoryEntry => ({
    evidenceId: "discovery-werbungskosten",
    sourceKey: "BFG",
    sourceName: "BFG Entscheidungen",
    kind: "discovery",
    summary: "Ein BFG-Treffer behandelt Werbungskosten für ein Arbeitszimmer.",
    topics: ["Werbungskosten", "Arbeitszimmer"],
    requeryRequired: true,
    canonicalId: null,
    versionId: null,
    officialUri: null,
    validFrom: null,
    validTo: null,
    rechtssatzId: null,
    decisionId: null,
    chunkId: null,
    decisionDate: null,
    ...overrides,
  });

  it("keeps only discovery hints relevant to the latest question", () => {
    const relevant = discovery();
    const unrelated = discovery({
      evidenceId: "discovery-familienbonus",
      sourceKey: "GESETZE",
      sourceName: "Gesetze",
      summary: "§ 33 EStG behandelt den Familienbonus Plus.",
      topics: ["Familienbonus"],
    });

    const scoped = scopeResearchMemoryForQuestion(
      [relevant, unrelated],
      "Welche Werbungskosten sind für mein Arbeitszimmer abzugsfähig?",
    );

    expect(scoped.entries).toEqual([relevant]);
    expect(scoped.requeryRequirements).toEqual([{
      evidenceId: relevant.evidenceId,
      sourceKey: "BFG",
      matchTerms: expect.arrayContaining(["werbungskosten", "arbeitszimmer"]),
    }]);
  });

  it.each([
    "Danke!",
    "Bitte formuliere das kürzer.",
    "Wie hoch ist der Familienbonus Plus?",
  ])("does not let unrelated same-date discovery memory block %s", (question) => {
    const verified = discovery({
      evidenceId: "verified-norm",
      kind: "norm",
      requeryRequired: false,
      canonicalId: "EStG-16",
      versionId: "EStG-16-v1",
      officialUri: "https://www.ris.bka.gv.at/example",
      validFrom: "2025-01-01",
    });

    const scoped = scopeResearchMemoryForQuestion([discovery(), verified], question);

    expect(scoped.entries).toEqual([verified]);
    expect(scoped.requeryRequirements).toEqual([]);
  });

  it("does not confuse an explicitly named source with the card subject", () => {
    const hint = discovery();

    const scoped = scopeResearchMemoryForQuestion(
      [hint],
      "Was sagt das BFG zum Familienbonus?",
    );

    expect(scoped.entries).toEqual([]);
    expect(scoped.requeryRequirements).toEqual([]);
  });

  it("keeps specific terms separate for two same-source discovery cards", () => {
    const arbeitszimmer = discovery();
    const fortbildung = discovery({
      evidenceId: "discovery-fortbildung",
      summary: "Ein BFG-Treffer behandelt Werbungskosten für eine Fortbildung.",
      topics: ["Werbungskosten", "Fortbildung"],
    });

    const scoped = scopeResearchMemoryForQuestion(
      [arbeitszimmer, fortbildung],
      "Was gilt bei Werbungskosten für Arbeitszimmer und Fortbildung?",
    );

    expect(scoped.requeryRequirements).toEqual([
      {
        evidenceId: arbeitszimmer.evidenceId,
        sourceKey: "BFG",
        matchTerms: ["werbungskosten", "arbeitszimmer"],
      },
      {
        evidenceId: fortbildung.evidenceId,
        sourceKey: "BFG",
        matchTerms: ["werbungskosten", "fortbildung"],
      },
    ]);
  });
});
