import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  MAX_RESEARCH_ARGUMENT_JSON_BYTES,
  MAX_RESEARCH_EVIDENCE_CONTENT_CHARS,
  MAX_RESEARCH_STRUCTURED_CONTENT_JSON_BYTES,
  createResearchEvidenceDraft,
  isCompleteResearchEvidence,
} from "./research-evidence";

function baseOptions() {
  return {
    resultStepOrder: 6,
    evidenceOrder: 0,
    semanticToolName: "search_laws",
    semanticArguments: { query: "EStG 1988 section 16" },
    rawToolName: "hybrid_search",
    effectiveArguments: {
      query: "EStG 1988 section 16",
      kb_id: "laws-kb",
      nested: { limit: 8 },
    },
    source: {
      key: "GESETZE",
      name: "Gesetze und Verordnungen",
      kbId: "laws-kb",
      system: "evi" as const,
    },
    stichtag: {
      kind: "explicit" as const,
      stichtag: "2026-07-18",
      matchedText: "18.07.2026",
    },
    resultText: "Opaque result returned by the current MCP endpoint.",
    resultLimit: 8,
    retrievedAt: "2026-07-18T10:15:30.000Z",
  };
}

describe("createResearchEvidenceDraft", () => {
  it("captures opaque MCP text as immutable discovery evidence requiring a requery", () => {
    const options = baseOptions();
    const draft = createResearchEvidenceDraft(options);

    expect(draft.id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(draft).toMatchObject({
      semanticToolName: "search_laws",
      rawToolName: "hybrid_search",
      resultStepOrder: 6,
      evidenceOrder: 0,
      semanticArguments: { query: "EStG 1988 section 16" },
      effectiveArguments: {
        query: "EStG 1988 section 16",
        kb_id: "laws-kb",
        nested: { limit: 8 },
      },
      source: {
        key: "GESETZE",
        name: "Gesetze und Verordnungen",
        kbId: "laws-kb",
        system: "evi",
      },
      stichtag: options.stichtag,
      kind: "discovery",
      requeryRequired: true,
      content: options.resultText,
      originalContentChars: options.resultText.length,
      contentTruncated: false,
      resultLimit: 8,
      retrievedAt: "2026-07-18T10:15:30.000Z",
    });
    expect(draft.contentSha256).toBe(
      createHash("sha256").update(options.resultText, "utf8").digest("hex"),
    );
    expect(draft.originalContentSha256).toBe(draft.contentSha256);
    expect(isCompleteResearchEvidence(draft)).toBe(true);

    (options.effectiveArguments.nested as { limit: number }).limit = 99;
    options.stichtag.stichtag = "2025-01-01";
    expect(draft.effectiveArguments).toMatchObject({ nested: { limit: 8 } });
    expect(draft.stichtag).toMatchObject({ stichtag: "2026-07-18" });
  });

  it("hashes the full result before bounding its separately stored content", () => {
    const fullContent = "x".repeat(MAX_RESEARCH_EVIDENCE_CONTENT_CHARS + 25);
    const draft = createResearchEvidenceDraft({ ...baseOptions(), resultText: fullContent });

    expect(draft.content).toHaveLength(MAX_RESEARCH_EVIDENCE_CONTENT_CHARS);
    expect(draft.originalContentChars).toBe(fullContent.length);
    expect(draft.contentTruncated).toBe(true);
    expect(draft.contentSha256).toBe(
      createHash("sha256")
        .update(fullContent.slice(0, MAX_RESEARCH_EVIDENCE_CONTENT_CHARS), "utf8")
        .digest("hex"),
    );
    expect(draft.originalContentSha256).toBe(
      createHash("sha256").update(fullContent, "utf8").digest("hex"),
    );
    expect(draft.requeryRequired).toBe(true);
    expect(isCompleteResearchEvidence(draft)).toBe(false);
  });

  it("counts and bounds Unicode code points like PostgreSQL char_length", () => {
    const fullContent = "🐕".repeat(MAX_RESEARCH_EVIDENCE_CONTENT_CHARS + 1);
    const draft = createResearchEvidenceDraft({ ...baseOptions(), resultText: fullContent });

    expect(Array.from(draft.content)).toHaveLength(MAX_RESEARCH_EVIDENCE_CONTENT_CHARS);
    expect(draft.content.endsWith("🐕")).toBe(true);
    expect(draft.originalContentChars).toBe(MAX_RESEARCH_EVIDENCE_CONTENT_CHARS + 1);
    expect(draft.contentTruncated).toBe(true);
  });

  it("preserves structured content and deterministic classification metadata", () => {
    const structuredContent = {
      hits: [{ canonical_id: "EVI-NORM-1", valid_from: "2025-01-01" }],
    };
    const draft = createResearchEvidenceDraft({
      ...baseOptions(),
      structuredContent,
      classification: {
        kind: "norm",
        metadata: {
          canonicalId: "EVI-NORM-1",
          versionId: "EVI-NORM-1-v2",
          officialUri: "https://evi.gv.at/norm/EVI-NORM-1",
          validFrom: "2025-01-01",
          validTo: null,
        },
      },
    });

    expect(draft).toMatchObject({
      kind: "norm",
      requeryRequired: false,
      structuredContent,
      classificationMetadata: {
        canonicalId: "EVI-NORM-1",
        versionId: "EVI-NORM-1-v2",
      },
    });
    structuredContent.hits[0].canonical_id = "changed";
    expect(draft.structuredContent).toMatchObject({
      hits: [{ canonical_id: "EVI-NORM-1" }],
    });
  });

  it("keeps incomplete typed metadata as a requery-required hint", () => {
    const draft = createResearchEvidenceDraft({
      ...baseOptions(),
      structuredContent: { canonicalId: "EVI-NORM-1" },
      classification: {
        kind: "norm",
        metadata: { canonicalId: "EVI-NORM-1", versionId: "v1" },
      },
    });

    expect(draft.kind).toBe("norm");
    expect(draft.requeryRequired).toBe(true);
  });

  it("drops oversized structured data to discovery without losing the text evidence", () => {
    const draft = createResearchEvidenceDraft({
      ...baseOptions(),
      structuredContent: { payload: "x".repeat(MAX_RESEARCH_STRUCTURED_CONTENT_JSON_BYTES) },
      classification: {
        kind: "norm",
        metadata: {
          canonicalId: "EVI-NORM-1",
          versionId: "v1",
          officialUri: "https://evi.gv.at/norm/EVI-NORM-1",
          validFrom: "2025-01-01",
        },
      },
    });

    expect(draft.content).toBe(baseOptions().resultText);
    expect(draft).not.toHaveProperty("structuredContent");
    expect(draft.kind).toBe("discovery");
    expect(draft.requeryRequired).toBe(true);
  });

  it("rejects arguments that cannot be stored exactly inside the audit bound", () => {
    expect(() => createResearchEvidenceDraft({
      ...baseOptions(),
      semanticArguments: { query: "x".repeat(MAX_RESEARCH_ARGUMENT_JSON_BYTES) },
    })).toThrow(/semanticArguments/u);
  });

  it("does not allow an opaque text result to be upgraded by a bare kind label", () => {
    const draft = createResearchEvidenceDraft({
      ...baseOptions(),
      classification: {
        kind: "norm",
        metadata: { canonicalId: "unverified" },
      },
    });

    expect(draft.kind).toBe("discovery");
    expect(draft.requeryRequired).toBe(true);
    expect(draft).not.toHaveProperty("classificationMetadata");
  });

  it.each([
    { resultStepOrder: -1, evidenceOrder: 0 },
    { resultStepOrder: 0, evidenceOrder: 1.5 },
    { resultLimit: 0, retrievedAt: "2026-07-18T10:00:00Z" },
    { resultLimit: 51, retrievedAt: "2026-07-18T10:00:00Z" },
    { resultLimit: 1.5, retrievedAt: "2026-07-18T10:00:00Z" },
    { resultLimit: 8, retrievedAt: "not-a-date" },
  ])("rejects invalid audit metadata %#", (override) => {
    expect(() => createResearchEvidenceDraft({ ...baseOptions(), ...override })).toThrow();
  });
});
