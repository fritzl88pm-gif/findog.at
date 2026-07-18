import { createHash, randomUUID } from "node:crypto";

import type { StichtagResolution } from "./legal-stichtag";
import type { JsonObject } from "./mcp/tools";

/**
 * The persisted evidence payload is deliberately much larger than the
 * 1,200-character agent-step preview, but still bounded against unexpectedly
 * large MCP responses.
 */
export const MAX_RESEARCH_EVIDENCE_CONTENT_CHARS = 32_000;
// Kept below the SQL jsonb::text limits to leave room for PostgreSQL's
// normalized whitespace when it renders JSONB for the CHECK constraints.
export const MAX_RESEARCH_ARGUMENT_JSON_BYTES = 48_000;
export const MAX_RESEARCH_STRUCTURED_CONTENT_JSON_BYTES = 220_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type ResearchEvidenceKind =
  | "discovery"
  | "norm"
  | "rechtssatz"
  | "entscheidung_chunk"
  | "secondary";

export type ResearchEvidenceSource = {
  key: string | null;
  name: string | null;
  kbId: string | null;
  /** Deterministic upstream system identifier, never inferred by an LLM. */
  system?: "ris" | "evi" | "findok" | "internal" | "other" | null;
};

/**
 * A non-discovery classification may only be supplied by a deterministic
 * structured-result adapter. Opaque MCP text intentionally has no such
 * classification and therefore remains discovery-only.
 */
export type ResearchEvidenceClassification = {
  kind: Exclude<ResearchEvidenceKind, "discovery">;
  metadata: JsonObject;
  requeryRequired?: boolean;
};

export type ResearchEvidenceDraft = {
  id: string;
  /** Order of the persisted successful tool_result step in the agent trace. */
  resultStepOrder: number;
  /** Stable per-step order when a structured result yields multiple hits. */
  evidenceOrder: number;
  semanticToolName: string;
  semanticArguments: JsonObject;
  rawToolName: string;
  effectiveArguments: JsonObject;
  source: ResearchEvidenceSource;
  stichtag: StichtagResolution;
  structuredContent?: JsonObject;
  classificationMetadata?: JsonObject;
  content: string;
  /** Hash of exactly the bounded content field persisted in the database. */
  contentSha256: string;
  /** Hash of the complete MCP text before the storage bound is applied. */
  originalContentSha256: string;
  originalContentChars: number;
  contentTruncated: boolean;
  resultLimit: number | null;
  retrievedAt: string;
  kind: ResearchEvidenceKind;
  requeryRequired: boolean;
};

export type CreateResearchEvidenceDraftOptions = {
  resultStepOrder: number;
  evidenceOrder: number;
  semanticToolName: string;
  semanticArguments: JsonObject;
  rawToolName: string;
  effectiveArguments: JsonObject;
  source: ResearchEvidenceSource;
  stichtag: StichtagResolution;
  resultText: string;
  structuredContent?: JsonObject;
  classification?: ResearchEvidenceClassification;
  resultLimit?: number | null;
  retrievedAt?: string;
  id?: string;
};

function serializedJson(value: JsonObject): string {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string") throw new TypeError("JSON object is not serializable");
  return serialized;
}

function boundedRequiredJsonObject(
  value: JsonObject,
  maxBytes: number,
  label: string,
): JsonObject {
  const serialized = serializedJson(value);
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
    throw new TypeError(`${label} exceeds its auditable JSON storage bound`);
  }
  return JSON.parse(serialized) as JsonObject;
}

function boundedOptionalJsonObject(
  value: JsonObject | undefined,
  maxBytes: number,
): JsonObject | undefined {
  if (!value) return undefined;
  const serialized = serializedJson(value);
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) return undefined;
  return JSON.parse(serialized) as JsonObject;
}

function cloneStichtag(value: StichtagResolution): StichtagResolution {
  return JSON.parse(JSON.stringify(value)) as StichtagResolution;
}

function normalizedTimestamp(value: string | undefined): string {
  if (value === undefined) {
    return new Date().toISOString();
  }
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new TypeError("retrievedAt must be a valid timestamp");
  }
  return timestamp.toISOString();
}

function normalizedResultLimit(value: number | null | undefined): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!Number.isSafeInteger(value) || value < 1 || value > 50) {
    throw new TypeError("resultLimit must be an integer from 1 through 50 or null");
  }
  return value;
}

function normalizedOrder(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function boundedRequiredText(value: string, maxLength: number, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    throw new TypeError(`${label} must contain 1 through ${maxLength} characters`);
  }
  return trimmed;
}

function boundedOptionalText(
  value: string | null,
  maxLength: number,
  label: string,
): string | null {
  if (value === null) return null;
  return boundedRequiredText(value, maxLength, label);
}

function sourceSnapshot(source: ResearchEvidenceSource): ResearchEvidenceSource {
  return {
    key: boundedOptionalText(source.key, 80, "source.key"),
    name: boundedOptionalText(source.name, 200, "source.name"),
    kbId: boundedOptionalText(source.kbId, 200, "source.kbId"),
    ...(source.system !== undefined ? { system: source.system } : {}),
  };
}

function metadataText(metadata: JsonObject, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function isIsoDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() + 1 === month
    && parsed.getUTCDate() === day;
}

function isOfficialPrimaryUri(value: string | null): boolean {
  return Boolean(
    value
    && value.length <= 2_048
    && /^https:\/\/(?:www\.)?(?:ris\.bka\.gv\.at|evi\.gv\.at)\//iu.test(value),
  );
}

function isStableId(value: string | null): value is string {
  return Boolean(value && value.length <= 500);
}

function isReusableLegalClassification(options: {
  classification: ResearchEvidenceClassification;
  source: ResearchEvidenceSource;
  stichtag: StichtagResolution;
}): boolean {
  const { classification, source, stichtag } = options;
  if (
    stichtag.kind === "unknown"
    || (source.system !== "ris" && source.system !== "evi")
    || classification.kind === "secondary"
  ) {
    return false;
  }
  const metadata = classification.metadata;
  const officialUri = metadataText(metadata, "official_uri", "officialUri");
  if (!isOfficialPrimaryUri(officialUri)) return false;

  if (classification.kind === "norm") {
    const canonicalId = metadataText(metadata, "canonical_id", "canonicalId");
    const versionId = metadataText(metadata, "version_id", "versionId");
    const validFrom = metadataText(metadata, "valid_from", "validFrom");
    const validTo = metadataText(metadata, "valid_to", "validTo");
    return Boolean(
      isStableId(canonicalId)
      && isStableId(versionId)
      && isIsoDate(validFrom)
      && validFrom <= stichtag.stichtag
      && (!validTo || (isIsoDate(validTo) && stichtag.stichtag < validTo)),
    );
  }

  const decisionDate = metadataText(metadata, "decision_date", "decisionDate");
  if (!isIsoDate(decisionDate) || decisionDate > stichtag.stichtag) return false;
  if (classification.kind === "rechtssatz") {
    return isStableId(metadataText(metadata, "rechtssatz_id", "rechtssatzId"));
  }
  return isStableId(metadataText(metadata, "decision_id", "decisionId"))
    && isStableId(metadataText(metadata, "chunk_id", "chunkId"));
}

/**
 * Captures one tool result before any UI/trace summarisation occurs.
 *
 * Without a deterministic structured classification, the result is always a
 * discovery hint and must be requeried before it supports a legal claim.
 */
export function createResearchEvidenceDraft(
  options: CreateResearchEvidenceDraftOptions,
): ResearchEvidenceDraft {
  const fullContent = options.resultText;
  const fullContentCharacters = Array.from(fullContent);
  const contentTruncated = fullContentCharacters.length > MAX_RESEARCH_EVIDENCE_CONTENT_CHARS;
  const storedContent = fullContentCharacters
    .slice(0, MAX_RESEARCH_EVIDENCE_CONTENT_CHARS)
    .join("");
  const semanticArguments = boundedRequiredJsonObject(
    options.semanticArguments,
    MAX_RESEARCH_ARGUMENT_JSON_BYTES,
    "semanticArguments",
  );
  const effectiveArguments = boundedRequiredJsonObject(
    options.effectiveArguments,
    MAX_RESEARCH_ARGUMENT_JSON_BYTES,
    "effectiveArguments",
  );
  const structuredContent = boundedOptionalJsonObject(
    options.structuredContent,
    MAX_RESEARCH_STRUCTURED_CONTENT_JSON_BYTES,
  );
  // A caller cannot upgrade opaque text into legal evidence merely by naming
  // a kind. The deterministic classification must travel with structured data.
  const classificationMetadata = boundedOptionalJsonObject(
    options.classification?.metadata,
    MAX_RESEARCH_ARGUMENT_JSON_BYTES,
  );
  const classification = structuredContent && options.classification && classificationMetadata
    ? { ...options.classification, metadata: classificationMetadata }
    : undefined;
  const kind: ResearchEvidenceKind = classification?.kind ?? "discovery";
  const id = options.id ?? randomUUID();
  if (!UUID_PATTERN.test(id)) throw new TypeError("id must be a UUID");
  const evidenceOrder = normalizedOrder(options.evidenceOrder, "evidenceOrder");
  if (evidenceOrder > 99) throw new TypeError("evidenceOrder must not exceed 99");

  return {
    id,
    resultStepOrder: normalizedOrder(options.resultStepOrder, "resultStepOrder"),
    evidenceOrder,
    semanticToolName: boundedRequiredText(options.semanticToolName, 120, "semanticToolName"),
    semanticArguments,
    rawToolName: boundedRequiredText(options.rawToolName, 120, "rawToolName"),
    effectiveArguments,
    source: sourceSnapshot(options.source),
    stichtag: cloneStichtag(options.stichtag),
    ...(structuredContent
      ? { structuredContent }
      : {}),
    ...(classification
      ? { classificationMetadata: classification.metadata }
      : {}),
    content: storedContent,
    contentSha256: createHash("sha256").update(storedContent, "utf8").digest("hex"),
    originalContentSha256: createHash("sha256").update(fullContent, "utf8").digest("hex"),
    originalContentChars: fullContentCharacters.length,
    contentTruncated,
    resultLimit: normalizedResultLimit(options.resultLimit),
    retrievedAt: normalizedTimestamp(options.retrievedAt),
    kind,
    requeryRequired:
      kind === "discovery"
      || contentTruncated
      || classification?.requeryRequired === true
      || Boolean(classification && !isReusableLegalClassification({
        classification,
        source: options.source,
        stichtag: options.stichtag,
      })),
  };
}

/** Complete means the card model receives exactly the payload that was stored. */
export function isCompleteResearchEvidence(
  evidence: ResearchEvidenceDraft,
): boolean {
  return !evidence.contentTruncated && evidence.content.trim().length > 0;
}
