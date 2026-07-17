import type { EvidenceRecord } from "./agent-evidence";

export interface EvidenceBatchSegment {
  segmentId: string;
  evidenceId: string;
  part: number;
  totalParts: number;
  rawText: string;
  rendered: string;
}

export interface EvidenceBatch {
  index: number;
  text: string;
  charCount: number;
  evidenceIds: readonly string[];
  segmentIds: readonly string[];
  segments: readonly EvidenceBatchSegment[];
}

export interface EvidenceBatchOptions {
  maxChars?: number;
}

const DEFAULT_FINAL_BATCH_MAX_CHARS = 48_000;
const MIN_FINAL_BATCH_MAX_CHARS = 4_000;
const SEGMENT_METADATA_RESERVE = 2_000;

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function renderSegment(
  record: EvidenceRecord,
  rawText: string,
  part: number,
  totalParts: number,
): EvidenceBatchSegment {
  const segmentId = `${record.evidenceId}#segment-${part}-of-${totalParts}`;
  const rendered = [
    `<evidence_segment id="${escapeAttribute(segmentId)}" evidence_id="${escapeAttribute(record.evidenceId)}">`,
    `Segment: ${part}/${totalParts}`,
    `Quelle: ${record.source.name} (${record.source.key}; ${record.source.kind})`,
    `Fundtyp: ${record.fundType}`,
    `Prüfstichtag: ${record.temporal.stichtag}`,
    `Gültigkeitsstatus: ${record.temporal.validityStatus}`,
    record.temporal.validFrom ? `Gültig ab: ${record.temporal.validFrom}` : "Gültig ab: unbekannt",
    record.temporal.validToExclusive
      ? `Gültig bis ausschließlich: ${record.temporal.validToExclusive}`
      : "Gültig bis ausschließlich: unbekannt",
    `Fundstelle: ${record.provenance.locator}`,
    "<source_text>",
    rawText,
    "</source_text>",
    "</evidence_segment>",
  ].join("\n");
  return {
    segmentId,
    evidenceId: record.evidenceId,
    part,
    totalParts,
    rawText,
    rendered,
  };
}

function segmentRecord(record: EvidenceRecord, maxChars: number): EvidenceBatchSegment[] {
  let rawCharsPerSegment = Math.max(1, maxChars - SEGMENT_METADATA_RESERVE);
  for (;;) {
    const rawParts: string[] = [];
    for (let offset = 0; offset < record.raw.rawText.length; offset += rawCharsPerSegment) {
      rawParts.push(record.raw.rawText.slice(offset, offset + rawCharsPerSegment));
    }
    const segments = rawParts.map((rawText, index) => (
      renderSegment(record, rawText, index + 1, rawParts.length)
    ));
    const overflow = Math.max(0, ...segments.map((segment) => segment.rendered.length - maxChars));
    if (overflow === 0) {
      return segments;
    }
    if (rawCharsPerSegment === 1) {
      throw new RangeError(`Evidence metadata for ${record.evidenceId} exceeds the batch budget.`);
    }
    rawCharsPerSegment = Math.max(1, rawCharsPerSegment - overflow - 32);
  }
}

/**
 * Losslessly partitions every selected evidence text into bounded LLM batches.
 * No record is dropped or summarized here; oversized records are exact character
 * slices whose concatenation equals the stored raw text.
 */
export function buildEvidenceBatches(
  records: readonly EvidenceRecord[],
  options: EvidenceBatchOptions = {},
): EvidenceBatch[] {
  const maxChars = options.maxChars ?? DEFAULT_FINAL_BATCH_MAX_CHARS;
  if (!Number.isFinite(maxChars) || maxChars < MIN_FINAL_BATCH_MAX_CHARS) {
    throw new RangeError(`maxChars must be at least ${MIN_FINAL_BATCH_MAX_CHARS}.`);
  }

  const allSegments = records.flatMap((record) => segmentRecord(record, maxChars));
  const grouped: EvidenceBatchSegment[][] = [];
  let current: EvidenceBatchSegment[] = [];
  let currentLength = 0;
  for (const segment of allSegments) {
    const separatorLength = current.length > 0 ? 2 : 0;
    if (current.length > 0 && currentLength + separatorLength + segment.rendered.length > maxChars) {
      grouped.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(segment);
    currentLength += (current.length > 1 ? 2 : 0) + segment.rendered.length;
  }
  if (current.length > 0) {
    grouped.push(current);
  }

  return grouped.map((segments, index) => {
    const text = segments.map((segment) => segment.rendered).join("\n\n");
    return {
      index,
      text,
      charCount: text.length,
      evidenceIds: [...new Set(segments.map((segment) => segment.evidenceId))],
      segmentIds: segments.map((segment) => segment.segmentId),
      segments,
    };
  });
}

export function missingEvidenceSegmentIds(
  ledger: string,
  batch: EvidenceBatch,
): string[] {
  return batch.segmentIds.filter((segmentId) => !ledger.includes(segmentId));
}
