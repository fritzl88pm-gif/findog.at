import { describe, expect, it } from "vitest";

import {
  EvidenceProvenanceConflictError,
  EvidenceStore,
  isTerminalAgentRunStatus,
  type EvidenceInput,
} from "./agent-evidence";

function evidenceInput(overrides: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    source: {
      key: "GESETZE",
      name: "Gesetze und Verordnungen",
      kind: "primary_law",
    },
    fundType: "norm",
    temporal: {
      stichtag: "2024-12-31",
      validFrom: "2024-01-01",
      validToExclusive: "2025-01-01",
      documentDate: "2024-01-01",
      validityStatus: "applicable",
    },
    provenance: {
      locator: "EStG:33:2024:chunk-1",
      knowledgeBaseId: "laws-kb",
      knowledgeId: "estg-2024",
      chunkId: "chunk-1",
      versionId: "2024",
    },
    raw: {
      rawText: "§ 33 EStG – vollständiger Normtext.",
      rawPayload: { content: "§ 33 EStG – vollständiger Normtext." },
    },
    observations: [{
      retrievedAt: "2026-07-16T10:00:00.000Z",
      toolName: "search_laws",
      toolCallId: "call-1",
      query: "Unterhaltsabsetzbetrag 2024",
    }],
    ...overrides,
  };
}

describe("EvidenceStore", () => {
  it("deduplicates stable provenance while preserving observations and raw payload variants", () => {
    const store = new EvidenceStore();
    const first = store.add(evidenceInput());
    const second = store.add(evidenceInput({
      raw: {
        rawText: "§ 33 EStG – vollständiger Normtext.",
        matchedText: "Unterhaltsabsetzbetrag",
        rawPayload: {
          content: "§ 33 EStG – vollständiger Normtext.",
          matched_content: "Unterhaltsabsetzbetrag",
        },
      },
      observations: [{
        retrievedAt: "2026-07-16T10:01:00.000Z",
        toolName: "inspect_research_document_chunks",
        toolCallId: "call-2",
      }],
    }));

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(second.record.evidenceId).toBe(first.record.evidenceId);
    expect(second.record.observations).toHaveLength(2);
    expect(second.record.rawVariants).toHaveLength(2);
    expect(store.size).toBe(1);
  });

  it("rejects changed authoritative text under the same provenance", () => {
    const store = new EvidenceStore();
    const first = store.add(evidenceInput());

    expect(() => store.add(evidenceInput({
      raw: { rawText: "Ein anderer Normtext." },
    }))).toThrowError(EvidenceProvenanceConflictError);
    expect(() => store.add(evidenceInput({
      raw: { rawText: "Ein anderer Normtext." },
    }))).toThrow(first.record.evidenceId);
    expect(store.size).toBe(1);
  });

  it("keeps the complete store while bounding only the intermediate LLM view", () => {
    const store = new EvidenceStore();
    store.add(evidenceInput({
      raw: { rawText: `${"A".repeat(1_000)}TAIL_A` },
    }));
    store.add(evidenceInput({
      provenance: { ...evidenceInput().provenance, locator: "EStG:34:2024:chunk-2", chunkId: "chunk-2" },
      raw: { rawText: `${"B".repeat(1_000)}TAIL_B` },
    }));

    const iteration = store.renderForIteration({
      maxChars: 700,
      maxCharsPerRecord: 450,
      minimumRawTextChars: 10,
    });
    const final = store.renderFullForFinal();

    expect(iteration.charCount).toBeLessThanOrEqual(700);
    expect(iteration.truncatedEvidenceIds.length + iteration.omittedEvidenceIds.length).toBeGreaterThan(0);
    expect(store.size).toBe(2);
    expect(final.recordCount).toBe(2);
    expect(final.text).toContain("TAIL_A");
    expect(final.text).toContain("TAIL_B");
    expect(final.text).not.toContain("Auszug gekürzt");
  });

  it("honors an injected token counter as an additional hard ceiling", () => {
    const store = new EvidenceStore();
    store.add(evidenceInput({ raw: { rawText: "X".repeat(2_000) } }));

    const rendered = store.renderForIteration({
      maxChars: 10_000,
      maxTokens: 280,
      tokenCounter: (text) => text.length / 2,
      minimumRawTextChars: 10,
    });

    expect(rendered.estimatedTokenCount).toBeLessThanOrEqual(280);
    expect(rendered.charCount).toBeLessThanOrEqual(560);
    expect(store.values()[0]?.raw.rawText).toHaveLength(2_000);
  });

  it("validates legal dates and retrieval provenance", () => {
    const store = new EvidenceStore();
    expect(() => store.add(evidenceInput({
      temporal: {
        stichtag: "2024-02-30",
        validityStatus: "unclear",
      },
    }))).toThrow("valid calendar date");
    expect(() => store.add(evidenceInput({ observations: [] }))).toThrow("auditability");
  });

  it("distinguishes terminal and non-terminal run statuses", () => {
    expect(isTerminalAgentRunStatus("running")).toBe(false);
    expect(isTerminalAgentRunStatus("degraded")).toBe(false);
    expect(isTerminalAgentRunStatus("partial")).toBe(true);
    expect(isTerminalAgentRunStatus("completed")).toBe(true);
  });
});

describe("EvidenceStore tool-result ingestion", () => {
  const options = {
    source: {
      key: "GESETZE" as const,
      name: "Gesetze und Verordnungen",
      kind: "primary_law" as const,
    },
    fundType: "norm" as const,
    temporal: {
      stichtag: "2024-12-31",
      validityStatus: "applicable" as const,
    },
    observation: {
      retrievedAt: "2026-07-16T10:00:00.000Z",
      toolName: "search_laws",
      toolCallId: "call-1",
    },
    fallbackLocator: "tool-call-1",
    provenance: { knowledgeBaseId: "laws-kb" },
  };

  it("recursively parses MCP JSON, ignores knowledge_description, and reports deep-read candidates", () => {
    const store = new EvidenceStore();
    const nested = JSON.stringify({
      results: [
        {
          knowledge_id: "estg-2024",
          chunk_id: "chunk-33",
          matched_content: "§ 33 Abs. 4 EStG: Unterhaltsabsetzbetrag ...",
          knowledge_description: "Wertlose generische Zusammenfassung zu § 69.",
        },
        {
          knowledge_id: "lstr-2024",
          title: "Lohnsteuerrichtlinien 2002",
          knowledge_description: "Nur eine generische Dokumentbeschreibung.",
        },
      ],
    });
    const result = store.ingestToolResult({
      content: [{ type: "text", text: nested }],
    }, options);

    expect(result.parsedAsJson).toBe(true);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.record.raw.rawText).toContain("Unterhaltsabsetzbetrag");
    expect(result.records[0]?.record.raw.rawText).not.toContain("§ 69");
    expect(result.ignoredKnowledgeDescriptionCount).toBe(2);
    expect(result.candidatesRequiringFullText).toEqual([expect.objectContaining({
      sourceKey: "GESETZE",
      knowledgeId: "lstr-2024",
      title: "Lohnsteuerrichtlinien 2002",
    })]);
  });

  it("prefers complete content and retains matched_content only as the matched passage", () => {
    const store = new EvidenceStore();
    const result = store.ingestToolResult(JSON.stringify({
      knowledge_id: "estg-2024",
      chunk_id: "chunk-33",
      content: "Der vollständige Text von § 33.",
      matched_content: "Text von § 33",
      knowledge_description: "Nicht verwenden",
    }), options);

    expect(result.records[0]?.record.raw).toMatchObject({
      rawText: "Der vollständige Text von § 33.",
      matchedText: "Text von § 33",
    });
    expect(store.renderFullForFinal().text).not.toContain("Nicht verwenden");
  });

  it("stores a non-JSON tool result as a fallback record", () => {
    const store = new EvidenceStore();
    const result = store.ingestToolResult("Amtlicher Volltext ohne JSON-Hülle.", options);

    expect(result.parsedAsJson).toBe(false);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.record.provenance.locator).toMatch(/^content:[a-f0-9]{64}$/u);
    expect(result.records[0]?.record.raw.rawText).toBe("Amtlicher Volltext ohne JSON-Hülle.");
    expect(result.records[0]?.record).toMatchObject({
      source: { kind: "other" },
      fundType: "other",
      temporal: { validityStatus: "unclear" },
    });
  });

  it("parses multiple JSON text blocks without promoting their descriptions", () => {
    const store = new EvidenceStore();
    const result = store.ingestToolResult([
      JSON.stringify({
        knowledge_id: "estg",
        chunk_id: "chunk-16",
        knowledge_description: "Falscher Dokumentüberblick zu § 69.",
        matched_content: "Belegter Treffer zu § 16.",
      }),
      JSON.stringify({
        knowledge_id: "lstr",
        chunk_id: "chunk-123",
        knowledge_description: "Noch ein wertloser Dokumentüberblick.",
        content: "Belegter Richtlinientext Rz 123.",
      }),
    ].join("\n\n"), options);

    expect(result.parsedAsJson).toBe(true);
    expect(result.records).toHaveLength(2);
    expect(store.renderFullForFinal().text).toContain("§ 16");
    expect(store.renderFullForFinal().text).toContain("Rz 123");
    expect(store.renderFullForFinal().text).not.toContain("§ 69");
    expect(store.renderFullForFinal().text).not.toContain("Dokumentüberblick");
  });

  it("does not promote an unparseable knowledge_description payload as fallback evidence", () => {
    const store = new EvidenceStore();
    const result = store.ingestToolResult(
      "knowledge_description: bloße generierte Zusammenfassung ohne Volltext {",
      options,
    );

    expect(result.parsedAsJson).toBe(false);
    expect(result.records).toHaveLength(0);
    expect(store.renderFullForFinal().text).toBe("");
  });

  it("classifies every leaf from explicit document metadata and leaves unknown types as other", () => {
    const store = new EvidenceStore();
    const result = store.ingestToolResult({
      results: [
        {
          knowledge_id: "estg",
          chunk_id: "p-33",
          title: "Einkommensteuergesetz 1988",
          matched_content: "Â§ 33 EStG",
        },
        {
          knowledge_id: "lstr",
          chunk_id: "rz-797",
          document_type: "BMF-Richtlinie",
          title: "Lohnsteuerrichtlinien 2002",
          matched_content: "LStR Rz 797",
        },
        {
          knowledge_id: "misc",
          chunk_id: "unknown-1",
          type: "Sammlung",
          title: "Unbekanntes Dokument",
          matched_content: "Nicht klassifizierter Inhalt",
        },
        {
          knowledge_id: "bfg-rs",
          chunk_id: "rs-1",
          type: "Rechtssatz",
          title: "BFG-Rechtssatz",
          matched_content: "Amtlicher Rechtssatz.",
        },
      ],
    }, options);

    expect(result.records.map(({ record }) => ({
      kind: record.source.kind,
      fundType: record.fundType,
    }))).toEqual([
      { kind: "primary_law", fundType: "norm" },
      { kind: "administrative_guidance", fundType: "guideline" },
      { kind: "other", fundType: "other" },
      { kind: "case_law", fundType: "rechtssatz" },
    ]);
  });

  it("inherits parent provenance and temporal metadata and computes applicability per leaf", () => {
    const store = new EvidenceStore();
    const result = store.ingestToolResult({
      knowledge_id: "estg-versions",
      document_id: "ris-estg",
      document_type: "Bundesgesetz",
      title: "Einkommensteuergesetz 1988",
      document_date: "2024-01-02T12:30:00Z",
      results: [
        {
          chunk_id: "applicable",
          valid_from: "2024-01-01",
          valid_to: "2025-01-01",
          matched_content: "Fassung 2024",
        },
        {
          chunk_id: "future",
          valid_from: "2025-01-01",
          valid_to: "2026-01-01",
          matched_content: "Fassung 2025",
        },
        {
          chunk_id: "historical",
          valid_from: "2023-01-01",
          valid_to: "2024-01-01",
          matched_content: "Fassung 2023",
        },
        {
          chunk_id: "undated",
          matched_content: "Fassung ohne Geltungsmetadaten",
        },
      ],
    }, options);
    const records = result.records.map(({ record }) => record);

    expect(records.map((record) => record.provenance.knowledgeId)).toEqual([
      "estg-versions",
      "estg-versions",
      "estg-versions",
      "estg-versions",
    ]);
    expect(records.map((record) => record.provenance.documentId)).toEqual([
      "ris-estg",
      "ris-estg",
      "ris-estg",
      "ris-estg",
    ]);
    expect(records.map((record) => record.temporal.validityStatus)).toEqual([
      "applicable",
      "future",
      "historical",
      "unclear",
    ]);
    expect(records[0]?.temporal).toMatchObject({
      validFrom: "2024-01-01",
      validToExclusive: "2025-01-01",
      documentDate: "2024-01-02",
    });
  });

  it("derives an amount-entry validity range only from explicit year metadata", () => {
    const store = new EvidenceStore();
    const result = store.ingestToolResult({
      knowledge_id: "amount-uab",
      chunk_id: "uab-2024",
      document_type: "amount_entry",
      reference_year: 2024,
      content: "Unterhaltsabsetzbetrag; im ErlÃ¤uterungstext wird auch 2025 erwÃ¤hnt.",
    }, {
      ...options,
      source: {
        key: "BETRAGSTABELLE",
        name: "Betragstabelle FAQ",
        kind: "descriptive_table",
      },
      fundType: "amount_entry",
      temporal: { stichtag: "2024-12-31", validityStatus: "unclear" },
    });

    expect(result.records[0]?.record).toMatchObject({
      source: { kind: "descriptive_table" },
      fundType: "amount_entry",
      temporal: {
        validFrom: "2024-01-01",
        validToExclusive: "2025-01-01",
        validityStatus: "applicable",
      },
    });
  });

  it("deduplicates one stable chunk across query-dependent excerpts and content hashes", () => {
    const store = new EvidenceStore();
    const first = store.ingestToolResult({
      knowledge_id: "lstr",
      chunk_id: "rz-797",
      document_type: "Richtlinie",
      content_hash: "provider-hash-a",
      matched_content: "Erster einschlÃ¤giger Satz.",
    }, options);
    const second = store.ingestToolResult({
      knowledge_id: "lstr",
      chunk_id: "rz-797",
      document_type: "Richtlinie",
      content_hash: "provider-hash-b",
      matched_content: "Zweiter einschlÃ¤giger Satz.",
    }, options);

    expect(store.size).toBe(1);
    expect(second.records[0]?.record.evidenceId).toBe(first.records[0]?.record.evidenceId);
    expect(second.records[0]?.record.rawVariants).toHaveLength(2);
    expect(second.records[0]?.record.raw.rawText).toContain("Erster einschlÃ¤giger Satz");
    expect(second.records[0]?.record.raw.rawText).toContain("Zweiter einschlÃ¤giger Satz");
  });

  it("rolls back every insert when one fragment in the ingestion batch conflicts", () => {
    const store = new EvidenceStore();
    store.ingestToolResult({
      knowledge_id: "existing-doc",
      chunk_id: "existing-chunk",
      document_type: "Bundesgesetz",
      content: "Bestehender vollstÃ¤ndiger Normtext.",
    }, options);

    expect(() => store.ingestToolResult({
      results: [
        {
          knowledge_id: "new-doc",
          chunk_id: "new-chunk",
          document_type: "Bundesgesetz",
          content: "Dieser Text darf nach dem Rollback nicht verbleiben.",
        },
        {
          knowledge_id: "existing-doc",
          chunk_id: "existing-chunk",
          document_type: "Bundesgesetz",
          content: "WidersprÃ¼chlicher vollstÃ¤ndiger Normtext.",
        },
      ],
    }, options)).toThrow(EvidenceProvenanceConflictError);

    expect(store.size).toBe(1);
    expect(store.renderFullForFinal().text).toContain("Bestehender vollstÃ¤ndiger Normtext");
    expect(store.renderFullForFinal().text).not.toContain("Rollback");
  });

  it("parses JSON in Markdown fences inside a realistic MCP text envelope", () => {
    const store = new EvidenceStore();
    const result = store.ingestToolResult([
      "Rechercheergebnis:",
      "```json",
      JSON.stringify({
        knowledge_id: "estg",
        chunk_id: "p-16",
        document_type: "Bundesgesetz",
        matched_content: "Â§ 16 EStG: Werbungskosten.",
      }),
      "```",
      "Ende des Ergebnisses.",
    ].join("\n"), options);

    expect(result.parsedAsJson).toBe(true);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.record.raw.rawText).toContain("Werbungskosten");
  });

  it("renders an allow-listed final subset without mutating the complete store", () => {
    const store = new EvidenceStore();
    const first = store.add(evidenceInput({
      raw: { rawText: "Fassung fÃ¼r 2024." },
    }));
    const second = store.add(evidenceInput({
      provenance: {
        ...evidenceInput().provenance,
        locator: "EStG:33:2025:chunk-2",
        chunkId: "chunk-2",
        versionId: "2025",
      },
      temporal: {
        stichtag: "2025-12-31",
        validFrom: "2025-01-01",
        validToExclusive: "2026-01-01",
        validityStatus: "applicable",
      },
      raw: { rawText: "Fassung fÃ¼r 2025." },
    }));

    const rendered = store.renderFullForFinal({
      includeEvidenceIds: [second.record.evidenceId],
    });
    expect(store.size).toBe(2);
    expect(rendered.evidenceIds).toEqual([second.record.evidenceId]);
    expect(rendered.text).toContain("Fassung fÃ¼r 2025");
    expect(rendered.text).not.toContain("Fassung fÃ¼r 2024");
    expect(store.get(first.record.evidenceId)).toBeDefined();
  });
});
