import { createHash } from "node:crypto";

import type { ResearchSourceKey } from "./research-source-display";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export const AGENT_RUN_PHASES = [
  "resolve_question",
  "classify",
  "plan",
  "primary_research",
  "evidence_review",
  "supplementary_research",
  "synthesis",
  "validation",
  "complete",
] as const;

export type AgentRunPhase = (typeof AGENT_RUN_PHASES)[number];

export const AGENT_RUN_STATUSES = [
  "pending",
  "running",
  "degraded",
  "completed",
  "partial",
  "failed",
  "cancelled",
] as const;

export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export interface AgentRunState {
  phase: AgentRunPhase;
  status: AgentRunStatus;
  evidenceCount: number;
  recoverableFailureCount: number;
}

const TERMINAL_RUN_STATUSES = new Set<AgentRunStatus>([
  "completed",
  "partial",
  "failed",
  "cancelled",
]);

export function isTerminalAgentRunStatus(status: AgentRunStatus): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

export type EvidenceSourceKind =
  | "primary_law"
  | "administrative_guidance"
  | "case_law"
  | "internal_practice"
  | "descriptive_table"
  | "general_information"
  | "uploaded_document"
  | "other";

export type EvidenceFundType =
  | "norm"
  | "regulation"
  | "guideline"
  | "decree"
  | "rechtssatz"
  | "decision_chunk"
  | "decision_metadata"
  | "internal_practice"
  | "amount_entry"
  | "wiki_page"
  | "uploaded_document"
  | "other";

export type EvidenceValidityStatus =
  | "applicable"
  | "historical"
  | "future"
  | "unclear";

export interface EvidenceSource {
  /** Stable application-side source key. Never use a display name as an identifier. */
  key: ResearchSourceKey | "UPLOAD" | "OTHER";
  /** Human-readable source name for traces and final provenance. */
  name: string;
  kind: EvidenceSourceKind;
}

export interface EvidenceTemporalScope {
  /** Legal reference date, always an explicit ISO calendar date. */
  stichtag: string;
  /** Inclusive lower bound of the source version, if known. */
  validFrom?: string;
  /** Exclusive upper bound, matching the database daterange convention. */
  validToExclusive?: string;
  documentDate?: string;
  validityStatus: EvidenceValidityStatus;
}

export interface EvidenceProvenance {
  /**
   * Stable source-native locator. For example a RIS paragraph/version locator,
   * a Findok decision/chunk locator, or a knowledge/chunk id pair.
   */
  locator: string;
  knowledgeBaseId?: string;
  knowledgeId?: string;
  documentId?: string;
  chunkId?: string;
  externalId?: string;
  versionId?: string;
  sourceUri?: string;
  /** Optional digest supplied by the source pipeline. */
  contentHash?: string;
}

export interface EvidenceObservation {
  retrievedAt: string;
  toolName: string;
  toolCallId?: string;
  query?: string;
}

export interface EvidenceRawData {
  /** Complete authoritative text returned by the source adapter. */
  rawText: string;
  /** Exact matched passage, where the source distinguishes it from the full text. */
  matchedText?: string;
  /** Complete structured provider result retained server-side, never rendered by default. */
  rawPayload?: JsonValue;
}

export interface EvidenceInput {
  source: EvidenceSource;
  fundType: EvidenceFundType;
  temporal: EvidenceTemporalScope;
  provenance: EvidenceProvenance;
  raw: EvidenceRawData;
  observations: readonly EvidenceObservation[];
}

export interface EvidenceRecord extends EvidenceInput {
  evidenceId: string;
  provenanceFingerprint: string;
  rawContentDigest: string;
  /** Every distinct provider payload/matched passage observed for the stable source text. */
  rawVariants: readonly EvidenceRawData[];
}

export interface EvidenceAddResult {
  inserted: boolean;
  record: EvidenceRecord;
}

export interface EvidenceContextOptions {
  /** Hard character ceiling. Defaults to 12,000. */
  maxChars?: number;
  /** Optional second hard ceiling. Uses tokenCounter or a conservative character estimate. */
  maxTokens?: number;
  /** Approximation used when maxTokens is set without tokenCounter. Defaults to 4. */
  charsPerToken?: number;
  /** Provider-specific counter. It must return the token count of the complete candidate text. */
  tokenCounter?: (text: string) => number;
  /** Fairness ceiling for a single evidence item. */
  maxCharsPerRecord?: number;
  /** Records that should be considered first; unknown ids are ignored. */
  priorityEvidenceIds?: readonly string[];
  /** Do not include a truncated item unless at least this much source text fits. */
  minimumRawTextChars?: number;
}

export interface EvidenceContextRender {
  text: string;
  charCount: number;
  estimatedTokenCount: number;
  totalRecordCount: number;
  includedEvidenceIds: readonly string[];
  omittedEvidenceIds: readonly string[];
  truncatedEvidenceIds: readonly string[];
}

export interface EvidenceFullRender {
  text: string;
  charCount: number;
  recordCount: number;
  evidenceIds: readonly string[];
}

export interface EvidenceFullRenderOptions {
  /**
   * Optional synthesis allow-list. The underlying complete store is never
   * mutated; an empty list deliberately renders no evidence.
   */
  includeEvidenceIds?: readonly string[];
}

export interface EvidenceCandidateRequiringFullText {
  sourceKey: EvidenceSource["key"];
  knowledgeId: string;
  documentId?: string;
  title?: string;
  jsonPath: string;
}

export interface ToolResultIngestionOptions {
  source: EvidenceSource;
  fundType: EvidenceFundType;
  temporal: EvidenceTemporalScope;
  observation: EvidenceObservation;
  /** Stable tool-call/result locator used when the result has no source-native ids. */
  fallbackLocator: string;
  /** Known call-level provenance which leaf-level ids may refine. */
  provenance?: Omit<EvidenceProvenance, "locator">;
}

export interface ToolResultIngestionResult {
  parsedAsJson: boolean;
  records: readonly EvidenceAddResult[];
  candidatesRequiringFullText: readonly EvidenceCandidateRequiringFullText[];
  ignoredKnowledgeDescriptionCount: number;
}

export class EvidenceProvenanceConflictError extends Error {
  readonly evidenceId: string;

  constructor(evidenceId: string) {
    super(`Conflicting content or metadata for stable evidence provenance ${evidenceId}.`);
    this.name = "EvidenceProvenanceConflictError";
    this.evidenceId = evidenceId;
  }
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const DEFAULT_CONTEXT_CHAR_LIMIT = 12_000;
const DEFAULT_CHARS_PER_TOKEN = 4;
const DEFAULT_MINIMUM_RAW_TEXT_CHARS = 80;

function assertNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError(`${field} must not be empty.`);
  }
  return normalized;
}

function assertIsoDate(value: string, field: string): void {
  if (!ISO_DATE_PATTERN.test(value)) {
    throw new TypeError(`${field} must be an ISO date (YYYY-MM-DD).`);
  }

  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day ?? 0));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() + 1 !== month
    || parsed.getUTCDate() !== day
  ) {
    throw new TypeError(`${field} must be a valid calendar date.`);
  }
}

function assertIsoInstant(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${field} must be an ISO-compatible timestamp.`);
  }
}

function stableJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  const entries = Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`);
  return `{${entries.join(",")}}`;
}

function digest(value: JsonValue): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function optionalText(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  return assertNonEmpty(value, "optional provenance value");
}

/**
 * Only source-native identifiers participate in stable evidence identity.
 * `sourceUri` and `contentHash` are useful audit attributes, but both may vary
 * between otherwise identical retrievals and therefore must not split one
 * source chunk into multiple evidence records.
 */
function stableProvenanceValue(input: EvidenceInput): JsonObject {
  return {
    sourceKey: input.source.key,
    referenceDate: input.temporal.stichtag,
    locator: assertNonEmpty(input.provenance.locator, "provenance.locator"),
    knowledgeBaseId: optionalText(input.provenance.knowledgeBaseId),
    knowledgeId: optionalText(input.provenance.knowledgeId),
    documentId: optionalText(input.provenance.documentId),
    chunkId: optionalText(input.provenance.chunkId),
    externalId: optionalText(input.provenance.externalId),
    versionId: optionalText(input.provenance.versionId),
  };
}

function validateEvidenceInput(input: EvidenceInput): void {
  assertNonEmpty(input.source.name, "source.name");
  assertNonEmpty(input.provenance.locator, "provenance.locator");
  assertNonEmpty(input.raw.rawText, "raw.rawText");
  assertIsoDate(input.temporal.stichtag, "temporal.stichtag");

  for (const [field, value] of [
    ["temporal.validFrom", input.temporal.validFrom],
    ["temporal.validToExclusive", input.temporal.validToExclusive],
    ["temporal.documentDate", input.temporal.documentDate],
  ] as const) {
    if (value !== undefined) {
      assertIsoDate(value, field);
    }
  }

  if (
    input.temporal.validFrom
    && input.temporal.validToExclusive
    && input.temporal.validFrom >= input.temporal.validToExclusive
  ) {
    throw new TypeError("temporal.validToExclusive must be later than temporal.validFrom.");
  }

  if (input.observations.length === 0) {
    throw new TypeError("At least one evidence observation is required for auditability.");
  }
  for (const [index, observation] of input.observations.entries()) {
    assertIsoInstant(observation.retrievedAt, `observations[${index}].retrievedAt`);
    assertNonEmpty(observation.toolName, `observations[${index}].toolName`);
  }
}

function copyObservation(observation: EvidenceObservation): EvidenceObservation {
  return {
    retrievedAt: observation.retrievedAt,
    toolName: observation.toolName,
    ...(observation.toolCallId ? { toolCallId: observation.toolCallId } : {}),
    ...(observation.query ? { query: observation.query } : {}),
  };
}

function cloneJson<T extends JsonValue>(value: T): T {
  return structuredClone(value);
}

function copyRaw(raw: EvidenceRawData): EvidenceRawData {
  return {
    rawText: raw.rawText,
    ...(raw.matchedText !== undefined ? { matchedText: raw.matchedText } : {}),
    ...(raw.rawPayload !== undefined ? { rawPayload: cloneJson(raw.rawPayload) } : {}),
  };
}

function copyInput(input: EvidenceInput): EvidenceInput {
  return {
    source: { ...input.source },
    fundType: input.fundType,
    temporal: { ...input.temporal },
    provenance: { ...input.provenance },
    raw: copyRaw(input.raw),
    observations: input.observations.map(copyObservation),
  };
}

function rawVariantKey(raw: EvidenceRawData): string {
  return stableJson({
    rawText: raw.rawText,
    matchedText: raw.matchedText ?? null,
    rawPayload: raw.rawPayload ?? null,
  });
}

function mergeRawVariants(
  current: readonly EvidenceRawData[],
  incoming: EvidenceRawData,
): EvidenceRawData[] {
  const keys = new Set(current.map(rawVariantKey));
  const merged = current.map(copyRaw);
  const key = rawVariantKey(incoming);
  if (!keys.has(key)) {
    merged.push(copyRaw(incoming));
  }
  return merged;
}

function isMatchedOnlyRaw(raw: EvidenceRawData): boolean {
  return raw.matchedText !== undefined && raw.matchedText === raw.rawText;
}

function canonicalRawVariant(variants: readonly EvidenceRawData[]): EvidenceRawData {
  const fullTextVariants = variants.filter((variant) => !isMatchedOnlyRaw(variant));
  if (fullTextVariants.length > 0) {
    return copyRaw(fullTextVariants[0]!);
  }

  const matchedTexts = [...new Set(variants.map((variant) => variant.rawText.trim()).filter(Boolean))];
  const rawText = matchedTexts.join("\n\n");
  const first = variants[0]!;
  return {
    rawText,
    matchedText: rawText,
    ...(first.rawPayload !== undefined ? { rawPayload: cloneJson(first.rawPayload) } : {}),
  };
}

function mergeSpecificValue<T extends string>(
  existing: T,
  incoming: T,
  unknown: T,
  evidenceId: string,
): T {
  if (existing === incoming) return existing;
  if (existing === unknown) return incoming;
  if (incoming === unknown) return existing;
  throw new EvidenceProvenanceConflictError(evidenceId);
}

function mergeOptionalStableValue(
  existing: string | undefined,
  incoming: string | undefined,
  evidenceId: string,
): string | undefined {
  if (existing && incoming && existing !== incoming) {
    throw new EvidenceProvenanceConflictError(evidenceId);
  }
  return existing ?? incoming;
}

function mergeTemporalScope(
  existing: EvidenceTemporalScope,
  incoming: EvidenceTemporalScope,
  evidenceId: string,
): EvidenceTemporalScope {
  if (existing.stichtag !== incoming.stichtag) {
    throw new EvidenceProvenanceConflictError(evidenceId);
  }
  const validFrom = mergeOptionalStableValue(
    existing.validFrom,
    incoming.validFrom,
    evidenceId,
  );
  const validToExclusive = mergeOptionalStableValue(
    existing.validToExclusive,
    incoming.validToExclusive,
    evidenceId,
  );
  const documentDate = mergeOptionalStableValue(
    existing.documentDate,
    incoming.documentDate,
    evidenceId,
  );
  const validityStatus = mergeSpecificValue(
    existing.validityStatus,
    incoming.validityStatus,
    "unclear",
    evidenceId,
  );
  return {
    stichtag: existing.stichtag,
    ...(validFrom ? { validFrom } : {}),
    ...(validToExclusive ? { validToExclusive } : {}),
    ...(documentDate ? { documentDate } : {}),
    validityStatus,
  };
}

function observationKey(observation: EvidenceObservation): string {
  return stableJson({
    retrievedAt: observation.retrievedAt,
    toolName: observation.toolName,
    toolCallId: observation.toolCallId ?? null,
    query: observation.query ?? null,
  });
}

function mergeObservations(
  current: readonly EvidenceObservation[],
  incoming: readonly EvidenceObservation[],
): EvidenceObservation[] {
  const keys = new Set(current.map(observationKey));
  const merged = current.map(copyObservation);
  for (const observation of incoming) {
    const key = observationKey(observation);
    if (!keys.has(key)) {
      merged.push(copyObservation(observation));
      keys.add(key);
    }
  }
  return merged;
}

function escapeContextAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function evidenceContextEntry(
  record: EvidenceRecord,
  rawText: string,
  truncated: boolean,
): string {
  const validity = [
    record.temporal.validFrom ? `von ${record.temporal.validFrom}` : "von unbekannt",
    record.temporal.validToExclusive
      ? `bis ausschließlich ${record.temporal.validToExclusive}`
      : "ohne bekannte Obergrenze",
    `Status ${record.temporal.validityStatus}`,
  ].join(", ");
  const truncationNotice = truncated
    ? `\n[Auszug gekürzt; vollständiger Rohtext liegt serverseitig unter ${record.evidenceId}.]`
    : "";

  return [
    `<evidence id="${escapeContextAttribute(record.evidenceId)}">`,
    `Quelle: ${record.source.name} (${record.source.key}; ${record.source.kind})`,
    `Fundtyp: ${record.fundType}`,
    `Stichtag: ${record.temporal.stichtag}`,
    `Gültigkeit: ${validity}`,
    `Fundstelle: ${record.provenance.locator}`,
    "<source_text>",
    `${rawText}${truncationNotice}`,
    "</source_text>",
    "</evidence>",
  ].join("\n");
}

function orderedRecords(
  records: readonly EvidenceRecord[],
  priorityEvidenceIds: readonly string[],
): EvidenceRecord[] {
  const byId = new Map(records.map((record) => [record.evidenceId, record]));
  const ordered: EvidenceRecord[] = [];
  const seen = new Set<string>();
  for (const evidenceId of priorityEvidenceIds) {
    const record = byId.get(evidenceId);
    if (record && !seen.has(evidenceId)) {
      ordered.push(record);
      seen.add(evidenceId);
    }
  }
  for (const record of records) {
    if (!seen.has(record.evidenceId)) {
      ordered.push(record);
    }
  }
  return ordered;
}

interface ParsedEvidenceFragment {
  source: EvidenceSource;
  fundType: EvidenceFundType;
  temporal: EvidenceTemporalScope;
  raw: EvidenceRawData;
  provenance: EvidenceProvenance;
}

interface InheritedLeafMetadata {
  provenance: Omit<EvidenceProvenance, "locator">;
  documentType?: string;
  title?: string;
  validFrom?: string;
  validToExclusive?: string;
  documentDate?: string;
  /** Distinguishes an explicitly open upper bound (`null`) from absent metadata. */
  hasExplicitOpenValidTo?: boolean;
}

interface ToolResultParseAccumulator {
  fragments: ParsedEvidenceFragment[];
  candidates: EvidenceCandidateRequiringFullText[];
  candidateKeys: Set<string>;
  ignoredKnowledgeDescriptionCount: number;
}

function normalizeJsonValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (Array.isArray(value)) {
    const normalized: JsonValue[] = [];
    for (const item of value) {
      const child = normalizeJsonValue(item);
      if (child !== undefined) {
        normalized.push(child);
      }
    }
    return normalized;
  }
  if (typeof value === "object") {
    const normalized: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      const child = normalizeJsonValue(item);
      if (child !== undefined) {
        normalized[key] = child;
      }
    }
    return normalized;
  }
  return undefined;
}

function parseNestedJson(text: string): JsonValue | undefined {
  const trimmed = text.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return undefined;
  }
  try {
    return normalizeJsonValue(JSON.parse(trimmed));
  } catch {
    return undefined;
  }
}

function parseJsonTextBlocks(text: string): JsonValue | undefined {
  const direct = parseNestedJson(text);
  if (direct !== undefined) {
    return direct;
  }

  const fencedBlocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)];
  if (fencedBlocks.length > 0) {
    const parsedFencedBlocks = fencedBlocks
      .map((match) => parseNestedJson(match[1] ?? ""))
      .filter((block): block is JsonValue => block !== undefined);
    if (parsedFencedBlocks.length === fencedBlocks.length) {
      return parsedFencedBlocks.length === 1
        ? parsedFencedBlocks[0]
        : parsedFencedBlocks;
    }
  }

  const blocks = text
    .split(/\r?\n\s*\r?\n/gu)
    .map((block) => block.trim())
    .filter(Boolean);
  if (blocks.length < 2) {
    return undefined;
  }
  const parsedBlocks = blocks.map(parseNestedJson);
  return parsedBlocks.every((block): block is JsonValue => block !== undefined)
    ? parsedBlocks
    : undefined;
}

function ownString(object: JsonObject, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function normalizedMetadataDate(value: JsonValue | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const candidate = value.trim().slice(0, 10);
  if (!ISO_DATE_PATTERN.test(candidate)) return undefined;
  try {
    assertIsoDate(candidate, "source date metadata");
    return candidate;
  } catch {
    return undefined;
  }
}

function ownDate(object: JsonObject, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const date = normalizedMetadataDate(object[key]);
    if (date) return date;
  }
  return undefined;
}

function ownReferenceYear(object: JsonObject): number | undefined {
  for (const key of ["reference_year", "referenceYear", "veranlagungsjahr", "year"] as const) {
    const value = object[key];
    const normalized = typeof value === "number" ? String(value) : value;
    if (typeof normalized === "string" && /^(?:19|20)\d{2}$/u.test(normalized.trim())) {
      return Number(normalized.trim());
    }
  }
  return undefined;
}

function hasExplicitOpenUpperBound(object: JsonObject, keys: readonly string[]): boolean {
  return keys.some((key) => {
    if (!Object.hasOwn(object, key)) return false;
    const value = object[key];
    return value === null
      || (typeof value === "string" && /^(?:infinity|unbounded|open)$/iu.test(value.trim()));
  });
}

const VALID_FROM_KEYS = ["valid_from", "validFrom"] as const;
const VALID_TO_KEYS = [
  "valid_to",
  "validTo",
  "valid_to_exclusive",
  "validToExclusive",
] as const;
const DOCUMENT_DATE_KEYS = [
  "document_date",
  "documentDate",
  "decision_date",
  "decisionDate",
] as const;

function metadataForObject(
  object: JsonObject,
  inherited: InheritedLeafMetadata,
  sourceKey: EvidenceSource["key"],
): InheritedLeafMetadata {
  const ownType = ownString(object, ["document_type", "documentType", "doc_type", "docType"])
    ?? (() => {
      const type = ownString(object, ["type"]);
      return type && !/^(?:text|content|result|results)$/iu.test(type) ? type : undefined;
    })();
  const ownTitle = ownString(object, [
    "title",
    "document_title",
    "documentTitle",
    "filename",
    "file_name",
  ]);
  const referenceYear = sourceKey === "BETRAGSTABELLE"
    ? ownReferenceYear(object)
    : undefined;
  const ownValidFrom = ownDate(object, VALID_FROM_KEYS);
  const ownValidTo = ownDate(object, VALID_TO_KEYS);
  const ownDocumentDate = ownDate(object, DOCUMENT_DATE_KEYS);
  const ownOpenValidTo = hasExplicitOpenUpperBound(object, VALID_TO_KEYS);
  const validFrom = ownValidFrom
    ?? (referenceYear ? `${referenceYear}-01-01` : undefined)
    ?? inherited.validFrom;
  const validToExclusive = ownOpenValidTo
    ? undefined
    : ownValidTo
      ?? (referenceYear ? `${referenceYear + 1}-01-01` : undefined)
      ?? inherited.validToExclusive;
  const hasExplicitOpenValidTo = ownOpenValidTo
    || (!validToExclusive && Boolean(inherited.hasExplicitOpenValidTo));
  const knowledgeBaseId = ownString(object, ["knowledge_base_id", "knowledgeBaseId", "kb_id", "kbId"]);
  const knowledgeId = ownString(object, ["knowledge_id", "knowledgeId"]);
  const documentId = ownString(object, ["document_id", "documentId"]);
  const chunkId = ownString(object, ["chunk_id", "chunkId", "chunk_index", "chunkIndex"]);
  const externalId = ownString(object, ["external_id", "externalId", "ecli", "geschaeftszahl"]);
  const versionId = ownString(object, ["version_id", "versionId", "version"]);
  const sourceUri = ownString(object, ["source_uri", "sourceUri", "url", "uri"]);
  const contentHash = ownString(object, ["content_hash", "contentHash", "sha256"]);
  const ownProvenance: Omit<EvidenceProvenance, "locator"> = {
    ...inherited.provenance,
    ...(knowledgeBaseId ? { knowledgeBaseId } : {}),
    ...(knowledgeId ? { knowledgeId } : {}),
    ...(documentId ? { documentId } : {}),
    ...(chunkId ? { chunkId } : {}),
    ...(externalId ? { externalId } : {}),
    ...(versionId ? { versionId } : {}),
    ...(sourceUri ? { sourceUri } : {}),
    ...(contentHash ? { contentHash } : {}),
  };

  return {
    provenance: ownProvenance,
    ...(ownType ?? inherited.documentType
      ? { documentType: ownType ?? inherited.documentType }
      : {}),
    ...(ownTitle ?? inherited.title ? { title: ownTitle ?? inherited.title } : {}),
    ...(validFrom ? { validFrom } : {}),
    ...(validToExclusive ? { validToExclusive } : {}),
    ...(ownDocumentDate ?? inherited.documentDate
      ? { documentDate: ownDocumentDate ?? inherited.documentDate }
      : {}),
    ...(hasExplicitOpenValidTo ? { hasExplicitOpenValidTo: true } : {}),
  };
}

function classificationForDescriptor(descriptorInput: string | undefined): {
  sourceKind: EvidenceSourceKind;
  fundType: EvidenceFundType;
} {
  const descriptor = (descriptorInput ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("de-AT");
  if (!descriptor.trim()) return { sourceKind: "other", fundType: "other" };

  if (/(?:rechtssatz|headnote)/u.test(descriptor)) {
    return { sourceKind: "case_law", fundType: "rechtssatz" };
  }
  if (/(?:entscheidungsmetadaten|decision[_\s-]*metadata|fallmetadaten)/u.test(descriptor)) {
    return { sourceKind: "case_law", fundType: "decision_metadata" };
  }
  if (/(?:\bbfg\b|bundesfinanzgericht|entscheidung|erkenntnis|beschluss|urteil|decision[_\s-]*chunk)/u.test(descriptor)) {
    return { sourceKind: "case_law", fundType: "decision_chunk" };
  }
  if (/(?:richtlinie|guideline|\blstr\b|\bestr\b|\bustr\b|\bkstr\b|bmf[-\s]?information)/u.test(descriptor)) {
    return { sourceKind: "administrative_guidance", fundType: "guideline" };
  }
  if (/(?:erlass|decree)/u.test(descriptor)) {
    return { sourceKind: "administrative_guidance", fundType: "decree" };
  }
  if (/(?:verordnung|regulation)/u.test(descriptor)) {
    return { sourceKind: "primary_law", fundType: "regulation" };
  }
  if (/(?:\bnorm\b|gesetz|\bestg\b|\bustg\b|\bkstg\b|\bbao\b|\bflag\b|doppelbesteuerungsabkommen|\bdba\b)/u.test(descriptor)) {
    return { sourceKind: "primary_law", fundType: "norm" };
  }
  if (/(?:arbeitsbehelf|interne?\s+(?:praxis|dokument)|verwaltungspraxis|internal[_\s-]*practice)/u.test(descriptor)) {
    return { sourceKind: "internal_practice", fundType: "internal_practice" };
  }
  if (/(?:betragstabelle|amount[_\s-]*entry|faq[-\s]?betrag)/u.test(descriptor)) {
    return { sourceKind: "descriptive_table", fundType: "amount_entry" };
  }
  if (/(?:wiki(?:[_\s-]*page)?|lexikon)/u.test(descriptor)) {
    return { sourceKind: "general_information", fundType: "wiki_page" };
  }
  if (/(?:upload|hochgeladen)/u.test(descriptor)) {
    return { sourceKind: "uploaded_document", fundType: "uploaded_document" };
  }
  return { sourceKind: "other", fundType: "other" };
}

function classifyLeafMetadata(metadata: InheritedLeafMetadata): {
  sourceKind: EvidenceSourceKind;
  fundType: EvidenceFundType;
} {
  const explicitType = classificationForDescriptor(metadata.documentType);
  return explicitType.fundType !== "other"
    ? explicitType
    : classificationForDescriptor(metadata.title);
}

function temporalScopeForLeaf(
  metadata: InheritedLeafMetadata,
  stichtag: string,
): EvidenceTemporalScope {
  const { validFrom, validToExclusive, documentDate } = metadata;
  let validityStatus: EvidenceValidityStatus = "unclear";
  if (validFrom && stichtag < validFrom) {
    validityStatus = "future";
  } else if (validToExclusive && stichtag >= validToExclusive) {
    validityStatus = "historical";
  } else if (
    validFrom
    && stichtag >= validFrom
    && (Boolean(validToExclusive) || metadata.hasExplicitOpenValidTo)
  ) {
    validityStatus = "applicable";
  }

  return {
    stichtag,
    ...(validFrom ? { validFrom } : {}),
    ...(validToExclusive ? { validToExclusive } : {}),
    ...(documentDate ? { documentDate } : {}),
    validityStatus,
  };
}

function leafProvenance(
  metadata: InheritedLeafMetadata,
  rawText: string,
  onlyMatchedContent: boolean,
): EvidenceProvenance {
  const provenance = metadata.provenance;
  const nativeParts = [...new Set([
    provenance.knowledgeId,
    provenance.documentId,
    provenance.chunkId,
    provenance.externalId,
    provenance.versionId,
  ].filter((value): value is string => Boolean(value)))];
  const hasStableLeafId = Boolean(
    provenance.chunkId || provenance.externalId || provenance.versionId,
  );
  const needsContentFallback = nativeParts.length === 0
    || (onlyMatchedContent && !hasStableLeafId);
  const fallbackHash = needsContentFallback
    ? provenance.contentHash ?? digest(rawText)
    : undefined;
  const locator = nativeParts.length > 0
    ? `${nativeParts.join(":")}${fallbackHash ? `:content:${fallbackHash}` : ""}`
    : `content:${fallbackHash}`;

  return {
    ...provenance,
    locator,
    ...(!provenance.contentHash && fallbackHash ? { contentHash: fallbackHash } : {}),
  };
}

function addCandidate(
  accumulator: ToolResultParseAccumulator,
  metadata: InheritedLeafMetadata,
  path: string,
  sourceKey: EvidenceSource["key"],
): void {
  const knowledgeId = metadata.provenance.knowledgeId;
  if (!knowledgeId) {
    return;
  }
  const documentId = metadata.provenance.documentId;
  const title = metadata.title;
  const key = `${sourceKey}\u0000${knowledgeId}\u0000${documentId ?? ""}`;
  if (accumulator.candidateKeys.has(key)) {
    return;
  }
  accumulator.candidateKeys.add(key);
  accumulator.candidates.push({
    sourceKey,
    knowledgeId,
    ...(documentId ? { documentId } : {}),
    ...(title ? { title } : {}),
    jsonPath: path,
  });
}

const TOOL_RESULT_SCALAR_KEYS = new Set([
  "knowledge_description",
  "knowledgeDescription",
  "matched_content",
  "content",
  "text",
  "type",
  "document_type",
  "documentType",
  "doc_type",
  "docType",
  "title",
  "document_title",
  "documentTitle",
  "filename",
  "file_name",
  "valid_from",
  "validFrom",
  "valid_to",
  "validTo",
  "valid_to_exclusive",
  "validToExclusive",
  "document_date",
  "documentDate",
  "decision_date",
  "decisionDate",
  "reference_year",
  "referenceYear",
  "veranlagungsjahr",
  "year",
  "knowledge_id",
  "knowledgeId",
  "document_id",
  "documentId",
  "chunk_id",
  "chunkId",
  "chunk_index",
  "chunkIndex",
  "external_id",
  "externalId",
  "ecli",
  "geschaeftszahl",
  "version_id",
  "versionId",
  "version",
  "source_uri",
  "sourceUri",
  "url",
  "uri",
  "content_hash",
  "contentHash",
  "sha256",
]);

function collectToolResult(
  value: JsonValue,
  path: string,
  options: ToolResultIngestionOptions,
  inherited: InheritedLeafMetadata,
  accumulator: ToolResultParseAccumulator,
): boolean {
  if (Array.isArray(value)) {
    let containsEvidence = false;
    value.forEach((child, index) => {
      containsEvidence = collectToolResult(
        child,
        `${path}[${index}]`,
        options,
        inherited,
        accumulator,
      ) || containsEvidence;
    });
    return containsEvidence;
  }
  if (value === null || typeof value !== "object") {
    return false;
  }

  const object = value;
  const metadata = metadataForObject(object, inherited, options.source.key);
  if (
    (typeof object.knowledge_description === "string" && object.knowledge_description.trim())
    || (typeof object.knowledgeDescription === "string" && object.knowledgeDescription.trim())
  ) {
    accumulator.ignoredKnowledgeDescriptionCount += 1;
  }
  const classification = classifyLeafMetadata(metadata);
  const source: EvidenceSource = {
    ...options.source,
    kind: classification.sourceKind,
  };
  const temporal = temporalScopeForLeaf(metadata, options.temporal.stichtag);

  let containsEvidence = false;
  const matchedContent = ownString(object, ["matched_content"]);
  const content = ownString(object, ["content"]);
  const parsedContent = content ? parseJsonTextBlocks(content) : undefined;

  if (parsedContent !== undefined) {
    containsEvidence = collectToolResult(
      parsedContent,
      `${path}.content`,
      options,
      metadata,
      accumulator,
    ) || containsEvidence;
  }

  const rawText = parsedContent === undefined ? (content ?? matchedContent) : matchedContent;
  if (rawText) {
    const onlyMatchedContent = content === undefined || parsedContent !== undefined;
    accumulator.fragments.push({
      raw: {
        rawText,
        ...(matchedContent ? { matchedText: matchedContent } : {}),
        rawPayload: object,
      },
      source,
      fundType: classification.fundType,
      temporal,
      provenance: leafProvenance(metadata, rawText, onlyMatchedContent),
    });
    containsEvidence = true;
  }

  const text = ownString(object, ["text"]);
  if (text) {
    const parsedText = parseJsonTextBlocks(text);
    if (parsedText !== undefined) {
      containsEvidence = collectToolResult(
        parsedText,
        `${path}.text`,
        options,
        metadata,
        accumulator,
      ) || containsEvidence;
    } else if (object.type === "text" && !rawText) {
      accumulator.fragments.push({
        raw: { rawText: text, matchedText: text, rawPayload: object },
        source,
        fundType: classification.fundType,
        temporal,
        provenance: leafProvenance(metadata, text, true),
      });
      containsEvidence = true;
    }
  }

  for (const [key, child] of Object.entries(object)) {
    if (
      TOOL_RESULT_SCALAR_KEYS.has(key)
      && !(key === "content" && (Array.isArray(child) || (child !== null && typeof child === "object")))
    ) {
      continue;
    }
    if (Array.isArray(child) || (child !== null && typeof child === "object")) {
      containsEvidence = collectToolResult(
        child,
        `${path}.${key}`,
        options,
        metadata,
        accumulator,
      ) || containsEvidence;
    } else if (typeof child === "string") {
      const parsedChild = parseJsonTextBlocks(child);
      if (parsedChild !== undefined) {
        containsEvidence = collectToolResult(
          parsedChild,
          `${path}.${key}`,
          options,
          metadata,
          accumulator,
        ) || containsEvidence;
      }
    }
  }

  if (!containsEvidence) {
    addCandidate(accumulator, metadata, path, options.source.key);
  }
  return containsEvidence;
}

/**
 * Server-side in-memory evidence register. Rendering a bounded LLM context never
 * mutates or deletes the complete records held by this store.
 */
export class EvidenceStore {
  readonly #recordsByFingerprint = new Map<string, EvidenceRecord>();
  readonly #fingerprintByEvidenceId = new Map<string, string>();
  readonly #order: string[] = [];

  get size(): number {
    return this.#order.length;
  }

  add(input: EvidenceInput): EvidenceAddResult {
    validateEvidenceInput(input);
    const copied = copyInput(input);
    const provenanceFingerprint = digest(stableProvenanceValue(copied));
    const evidenceId = `ev_${provenanceFingerprint.slice(0, 24)}`;
    const rawContentDigest = digest(copied.raw.rawText);
    const existing = this.#recordsByFingerprint.get(provenanceFingerprint);

    if (existing) {
      const incomingIsMatchedOnly = isMatchedOnlyRaw(copied.raw);
      const conflictingFullText = !incomingIsMatchedOnly
        && existing.rawVariants.some((variant) => (
          !isMatchedOnlyRaw(variant) && variant.rawText !== copied.raw.rawText
        ));
      if (conflictingFullText) {
        throw new EvidenceProvenanceConflictError(existing.evidenceId);
      }

      const sourceKind = mergeSpecificValue(
        existing.source.kind,
        copied.source.kind,
        "other",
        existing.evidenceId,
      );
      const fundType = mergeSpecificValue(
        existing.fundType,
        copied.fundType,
        "other",
        existing.evidenceId,
      );
      const temporal = mergeTemporalScope(existing.temporal, copied.temporal, existing.evidenceId);
      const rawVariants = mergeRawVariants(existing.rawVariants, copied.raw);
      const raw = canonicalRawVariant(rawVariants);
      const merged: EvidenceRecord = {
        ...existing,
        source: { ...existing.source, kind: sourceKind },
        fundType,
        temporal,
        provenance: {
          ...existing.provenance,
          ...(!existing.provenance.sourceUri && copied.provenance.sourceUri
            ? { sourceUri: copied.provenance.sourceUri }
            : {}),
          ...(!existing.provenance.contentHash && copied.provenance.contentHash
            ? { contentHash: copied.provenance.contentHash }
            : {}),
        },
        raw,
        rawContentDigest: digest(raw.rawText),
        observations: mergeObservations(existing.observations, copied.observations),
        rawVariants,
      };
      this.#recordsByFingerprint.set(provenanceFingerprint, merged);
      return { inserted: false, record: merged };
    }

    const record: EvidenceRecord = {
      ...copied,
      evidenceId,
      provenanceFingerprint,
      rawContentDigest,
      rawVariants: [copyRaw(copied.raw)],
    };
    this.#recordsByFingerprint.set(provenanceFingerprint, record);
    this.#fingerprintByEvidenceId.set(evidenceId, provenanceFingerprint);
    this.#order.push(provenanceFingerprint);
    return { inserted: true, record };
  }

  addMany(inputs: readonly EvidenceInput[]): EvidenceAddResult[] {
    const recordsSnapshot = new Map(this.#recordsByFingerprint);
    const idsSnapshot = new Map(this.#fingerprintByEvidenceId);
    const orderSnapshot = [...this.#order];
    try {
      return inputs.map((input) => this.add(input));
    } catch (error) {
      this.#recordsByFingerprint.clear();
      recordsSnapshot.forEach((record, fingerprint) => {
        this.#recordsByFingerprint.set(fingerprint, record);
      });
      this.#fingerprintByEvidenceId.clear();
      idsSnapshot.forEach((fingerprint, evidenceId) => {
        this.#fingerprintByEvidenceId.set(evidenceId, fingerprint);
      });
      this.#order.splice(0, this.#order.length, ...orderSnapshot);
      throw error;
    }
  }

  get(evidenceId: string): EvidenceRecord | undefined {
    const fingerprint = this.#fingerprintByEvidenceId.get(evidenceId);
    return fingerprint ? this.#recordsByFingerprint.get(fingerprint) : undefined;
  }

  values(): readonly EvidenceRecord[] {
    return this.#order.flatMap((fingerprint) => {
      const record = this.#recordsByFingerprint.get(fingerprint);
      return record ? [record] : [];
    });
  }

  /**
   * Parse a raw MCP/tool result into evidence records. `knowledge_description`
   * is deliberately ignored; ids without content are returned as deep-read
   * candidates instead of being promoted to evidence.
   */
  ingestToolResult(
    toolResult: unknown,
    options: ToolResultIngestionOptions,
  ): ToolResultIngestionResult {
    assertNonEmpty(options.fallbackLocator, "fallbackLocator");
    validateEvidenceInput({
      source: options.source,
      fundType: options.fundType,
      temporal: options.temporal,
      provenance: { ...options.provenance, locator: options.fallbackLocator },
      raw: { rawText: "validation-placeholder" },
      observations: [options.observation],
    });

    let parsedAsJson = typeof toolResult !== "string";
    let normalized: JsonValue | undefined;
    if (typeof toolResult === "string") {
      normalized = parseJsonTextBlocks(toolResult);
      parsedAsJson = normalized !== undefined;
    } else {
      normalized = normalizeJsonValue(toolResult);
    }

    const accumulator: ToolResultParseAccumulator = {
      fragments: [],
      candidates: [],
      candidateKeys: new Set<string>(),
      ignoredKnowledgeDescriptionCount: 0,
    };

    if (normalized !== undefined) {
      collectToolResult(
        normalized,
        "$",
        options,
        {
          provenance: { ...options.provenance },
          ...(options.temporal.validFrom ? { validFrom: options.temporal.validFrom } : {}),
          ...(options.temporal.validToExclusive
            ? { validToExclusive: options.temporal.validToExclusive }
            : {}),
          ...(options.temporal.documentDate
            ? { documentDate: options.temporal.documentDate }
            : {}),
        },
        accumulator,
      );
    }

    if (
      accumulator.fragments.length === 0
      && typeof toolResult === "string"
      && toolResult.trim()
      && !parsedAsJson
      && !/\bknowledge[_ ]?description\b/iu.test(toolResult)
    ) {
      const rawText = toolResult.trim();
      const fallbackHash = digest(rawText);
      accumulator.fragments.push({
        source: { ...options.source, kind: "other" },
        fundType: "other",
        temporal: {
          stichtag: options.temporal.stichtag,
          validityStatus: "unclear",
        },
        raw: { rawText },
        provenance: {
          ...options.provenance,
          locator: `content:${fallbackHash}`,
          contentHash: fallbackHash,
        },
      });
    }

    const records = this.addMany(accumulator.fragments.map((fragment) => ({
      source: fragment.source,
      fundType: fragment.fundType,
      temporal: fragment.temporal,
      provenance: fragment.provenance,
      raw: fragment.raw,
      observations: [options.observation],
    })));

    return {
      parsedAsJson,
      records,
      candidatesRequiringFullText: accumulator.candidates,
      ignoredKnowledgeDescriptionCount: accumulator.ignoredKnowledgeDescriptionCount,
    };
  }

  /**
   * Bounded context for intermediate planning/iteration only. It may truncate or
   * omit rendered entries, but the complete records remain in this store.
   * Never use this method for the final legal-evidence context.
   */
  renderForIteration(options: EvidenceContextOptions = {}): EvidenceContextRender {
    const maxChars = options.maxChars ?? DEFAULT_CONTEXT_CHAR_LIMIT;
    const charsPerToken = options.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN;
    const minimumRawTextChars = options.minimumRawTextChars
      ?? DEFAULT_MINIMUM_RAW_TEXT_CHARS;
    const maxCharsPerRecord = options.maxCharsPerRecord ?? maxChars;

    for (const [field, value] of [
      ["maxChars", maxChars],
      ["charsPerToken", charsPerToken],
      ["minimumRawTextChars", minimumRawTextChars],
      ["maxCharsPerRecord", maxCharsPerRecord],
    ] as const) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`${field} must be a positive finite number.`);
      }
    }
    if (options.maxTokens !== undefined && (
      !Number.isFinite(options.maxTokens) || options.maxTokens <= 0
    )) {
      throw new RangeError("maxTokens must be a positive finite number.");
    }

    const countTokens = (text: string): number => {
      if (options.tokenCounter) {
        return Math.ceil(options.tokenCounter(text));
      }
      return Math.ceil(text.length / charsPerToken);
    };
    const fits = (text: string): boolean => (
      text.length <= maxChars
      && (options.maxTokens === undefined || countTokens(text) <= options.maxTokens)
    );

    const records = orderedRecords(this.values(), options.priorityEvidenceIds ?? []);
    const rendered: string[] = [];
    const includedEvidenceIds: string[] = [];
    const omittedEvidenceIds: string[] = [];
    const truncatedEvidenceIds: string[] = [];

    for (const record of records) {
      const separator = rendered.length > 0 ? "\n\n" : "";
      const fullEntry = evidenceContextEntry(record, record.raw.rawText, false);
      const fullCandidate = `${rendered.join("\n\n")}${separator}${fullEntry}`;
      if (fullEntry.length <= maxCharsPerRecord && fits(fullCandidate)) {
        rendered.push(fullEntry);
        includedEvidenceIds.push(record.evidenceId);
        continue;
      }

      let low = 0;
      let high = record.raw.rawText.length;
      let bestEntry: string | undefined;
      let bestRawLength = 0;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const entry = evidenceContextEntry(record, record.raw.rawText.slice(0, middle), true);
        const candidate = `${rendered.join("\n\n")}${separator}${entry}`;
        if (entry.length <= maxCharsPerRecord && fits(candidate)) {
          bestEntry = entry;
          bestRawLength = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }

      if (bestEntry && bestRawLength >= minimumRawTextChars) {
        rendered.push(bestEntry);
        includedEvidenceIds.push(record.evidenceId);
        truncatedEvidenceIds.push(record.evidenceId);
      } else {
        omittedEvidenceIds.push(record.evidenceId);
      }
    }

    const text = rendered.join("\n\n");
    return {
      text,
      charCount: text.length,
      estimatedTokenCount: countTokens(text),
      totalRecordCount: records.length,
      includedEvidenceIds,
      omittedEvidenceIds,
      truncatedEvidenceIds,
    };
  }

  /**
   * Final synthesis context. Every stored evidence text is rendered in full and
   * in insertion order. In particular, law and guideline hits are never capped,
   * truncated, or dropped here.
   */
  renderFullForFinal(options: EvidenceFullRenderOptions = {}): EvidenceFullRender {
    const includeIds = options.includeEvidenceIds
      ? new Set(options.includeEvidenceIds)
      : undefined;
    const records = includeIds
      ? this.values().filter((record) => includeIds.has(record.evidenceId))
      : this.values();
    const text = records
      .map((record) => evidenceContextEntry(record, record.raw.rawText, false))
      .join("\n\n");
    return {
      text,
      charCount: text.length,
      recordCount: records.length,
      evidenceIds: records.map((record) => record.evidenceId),
    };
  }
}
