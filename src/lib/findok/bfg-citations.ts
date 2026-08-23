import { type Deadline, runWithTimeout } from "../deadline";

const FINDOK_ORIGIN = "https://findok.bmf.gv.at";
const FINDOK_PDF_PATH_PREFIX = "/findok/resources/pdf/";
const SUPPORTED_GZ_PREFIXES = ["RV", "RS", "RM", "AW", "VH"] as const;
const MAX_CONCURRENT_FINDOK_REQUESTS = 4;
const DEFAULT_VERIFIED_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_CITATION_CACHE_ENTRIES = 1_000;
export const FINDOK_VERIFY_TIMEOUT_MS = 8_000;

export type BfgCitationStatus = "verified" | "not_found" | "not_bfg" | "missing_pdf" | "error";

export type VerifiedBfgCitation = {
  gz: string;
  title: string;
  documentTitle: string;
  dokumentId: string;
  segmentId: string;
  indexName: "findok-bfg";
  fullTextUrl: string;
  pdfUrl: string;
};

export type BfgCitationResolution =
  | ({ status: "verified" } & VerifiedBfgCitation)
  | { status: Exclude<BfgCitationStatus, "verified">; gz: string; reason: string };

export type RejectedBfgCitation = Exclude<BfgCitationResolution, { status: "verified" }>;

type FetchLike = typeof fetch;

export type BfgCitationCacheStatus = "hit" | "miss" | "coalesced";

export type BfgCitationBatchMetrics = {
  candidateCount: number;
  verifiedCount: number;
  cacheHits: number;
  cacheMisses: number;
  coalesced: number;
  durationMs: number;
  timeoutCount: number;
  errorCount: number;
};

type BfgCitationCacheOptions = {
  now?: () => number;
  verifiedTtlMs?: number;
  negativeTtlMs?: number;
  maxEntries?: number;
};

type BfgCitationCacheEntry = {
  promise: Promise<BfgCitationResolution>;
  resolution?: BfgCitationResolution;
  expiresAt?: number;
};

function createGzPattern(): RegExp {
  return new RegExp(
    `(^|[^A-Z0-9])((?:${SUPPORTED_GZ_PREFIXES.join("|")})\\/[A-Z0-9ÄÖÜ-]+\\/\\d{2,4})(?![A-Z0-9/])`,
    "giu",
  );
}

function normalizeBfgGz(value: string): string {
  return value.trim().replace(/[),.;:]+$/u, "").toUpperCase();
}

function callerAbortResolution(gz: string, signal: AbortSignal): BfgCitationResolution {
  return {
    status: "error",
    gz,
    reason: signal.reason instanceof Error
      ? signal.reason.message
      : "Findok-Verifizierung wurde abgebrochen.",
  };
}

function waitForCaller(
  promise: Promise<BfgCitationResolution>,
  gz: string,
  signal?: AbortSignal,
): Promise<BfgCitationResolution> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.resolve(callerAbortResolution(gz, signal));

  return new Promise((resolve) => {
    let settled = false;
    const finish = (resolution: BfgCitationResolution) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(resolution);
    };
    const onAbort = () => finish(callerAbortResolution(gz, signal));
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(finish);
  });
}

export class BfgCitationCache {
  private readonly entries = new Map<string, BfgCitationCacheEntry>();
  private readonly now: () => number;
  private readonly verifiedTtlMs: number;
  private readonly negativeTtlMs: number;
  private readonly maxEntries: number;

  constructor(options: BfgCitationCacheOptions = {}) {
    this.now = options.now ?? Date.now;
    this.verifiedTtlMs = options.verifiedTtlMs ?? DEFAULT_VERIFIED_CACHE_TTL_MS;
    this.negativeTtlMs = options.negativeTtlMs ?? DEFAULT_NEGATIVE_CACHE_TTL_MS;
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_CITATION_CACHE_ENTRIES);
  }

  get size(): number {
    return this.entries.size;
  }

  async resolve(
    rawGz: string,
    resolver: () => Promise<BfgCitationResolution>,
    options: { signal?: AbortSignal } = {},
  ): Promise<{ resolution: BfgCitationResolution; cacheStatus: BfgCitationCacheStatus }> {
    const gz = normalizeBfgGz(rawGz);
    const existing = this.entries.get(gz);
    if (existing?.resolution && (existing.expiresAt ?? 0) > this.now()) {
      return { resolution: existing.resolution, cacheStatus: "hit" };
    }
    if (existing?.resolution) {
      this.entries.delete(gz);
    } else if (existing) {
      return {
        resolution: await waitForCaller(existing.promise, gz, options.signal),
        cacheStatus: "coalesced",
      };
    }

    while (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }

    const entry: BfgCitationCacheEntry = {
      promise: Promise.resolve()
        .then(resolver)
        .catch((error: unknown): BfgCitationResolution => ({
          status: "error",
          gz,
          reason: error instanceof Error ? error.message : "Findok konnte nicht abgefragt werden.",
        })),
    };
    this.entries.set(gz, entry);
    void entry.promise.then((resolution) => {
      if (this.entries.get(gz) !== entry) return;
      if (resolution.status === "error") {
        this.entries.delete(gz);
        return;
      }
      entry.resolution = resolution;
      entry.expiresAt = this.now() + (
        resolution.status === "verified" ? this.verifiedTtlMs : this.negativeTtlMs
      );
    });

    return {
      resolution: await waitForCaller(entry.promise, gz, options.signal),
      cacheStatus: "miss",
    };
  }
}

const sharedBfgCitationCache = new BfgCitationCache();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function readDocumentTitle(record: Record<string, unknown>): string {
  const value = record.dokumentTitel;
  if (typeof value === "string") {
    return value.trim();
  }
  if (isRecord(value)) {
    return readString(value, "titel");
  }
  return "";
}

function fullTextUrlForGz(gz: string): string {
  const url = new URL("/findok/volltext", FINDOK_ORIGIN);
  url.searchParams.set("gz", gz);
  return url.toString();
}

function officialPdfUrl(value: string): string | null {
  if (!value.trim()) {
    return null;
  }

  try {
    const url = new URL(value, `${FINDOK_ORIGIN}/`);
    if (
      url.origin !== FINDOK_ORIGIN ||
      !url.pathname.startsWith(FINDOK_PDF_PATH_PREFIX) ||
      !url.pathname.toLowerCase().endsWith(".pdf")
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function markdownLinkForCitation(
  citation: VerifiedBfgCitation,
  target: "pdf" | "fullText",
): string {
  return `[${citation.gz}](${target === "fullText" ? citation.fullTextUrl : citation.pdfUrl})`;
}

function verifiedCitationMap(verified: VerifiedBfgCitation[]): Map<string, VerifiedBfgCitation> {
  const byGz = new Map<string, VerifiedBfgCitation>();
  for (const citation of verified) {
    byGz.set(normalizeBfgGz(citation.gz), citation);
  }
  return byGz;
}

function markdownLinkPattern(): RegExp {
  return /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
}

function replaceOutsideMarkdownLinks(text: string, transform: (chunk: string) => string): string {
  const pattern = markdownLinkPattern();
  let cursor = 0;
  let output = "";
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    output += transform(text.slice(cursor, match.index));
    output += match[0];
    cursor = match.index + match[0].length;
  }

  return output + transform(text.slice(cursor));
}

export function extractBfgGzCandidates(text: string): string[] {
  const pattern = createGzPattern();
  const seen = new Set<string>();
  const candidates: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const gz = normalizeBfgGz(match[2] ?? "");
    if (!gz || seen.has(gz)) {
      continue;
    }
    seen.add(gz);
    candidates.push(gz);
  }

  return candidates;
}

export function extractStreamStableBfgGzCandidates(
  text: string,
  streamComplete = false,
): string[] {
  const pattern = createGzPattern();
  const seen = new Set<string>();
  const candidates: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const prefixLength = (match[1] ?? "").length;
    const candidateEnd = match.index + prefixLength + (match[2] ?? "").length;
    if (!streamComplete && candidateEnd === text.length) continue;
    const gz = normalizeBfgGz(match[2] ?? "");
    if (!gz || seen.has(gz)) continue;
    seen.add(gz);
    candidates.push(gz);
  }

  return candidates;
}

export async function resolveBfgCitation(
  rawGz: string,
  fetchImpl: FetchLike = fetch,
  options: { deadline?: Deadline; signal?: AbortSignal } = {},
): Promise<BfgCitationResolution> {
  const gz = normalizeBfgGz(rawGz);
  if (!gz) {
    return { status: "error", gz, reason: "Leere BFG-Geschäftszahl." };
  }

  const endpoint = new URL("/findok/api/volltext/gz", FINDOK_ORIGIN);
  endpoint.searchParams.set("gz", gz);

  try {
    const { response, body } = await runWithTimeout(
      (signal) =>
        fetchImpl(endpoint.toString(), {
          headers: {
            Accept: "application/json",
          },
          cache: "no-store",
          signal,
        }).then(async (response) => ({
          response,
          body: await response.text(),
        })),
      {
        deadline: options.deadline,
        signal: options.signal,
        timeoutMs: FINDOK_VERIFY_TIMEOUT_MS,
        timeoutMessage: "Findok hat nicht rechtzeitig geantwortet.",
      },
    );

    if (response.status === 404) {
      return { status: "not_found", gz, reason: "Findok konnte diese Geschäftszahl nicht finden." };
    }
    if (!response.ok) {
      return { status: "error", gz, reason: `Findok antwortete mit HTTP ${response.status}.` };
    }

    const payload = JSON.parse(body) as unknown;
    if (!isRecord(payload)) {
      return { status: "error", gz, reason: "Findok lieferte keine verwertbare JSON-Antwort." };
    }

    const indexName = readString(payload, "indexName");
    if (indexName !== "findok-bfg") {
      return { status: "not_bfg", gz, reason: "Findok-Dokument gehört nicht zum BFG-Index." };
    }

    const pdfUrl = officialPdfUrl(readString(payload, "dokumentPdfMediaUrl"));
    if (!pdfUrl) {
      return { status: "missing_pdf", gz, reason: "Findok lieferte keinen offiziellen PDF-Link." };
    }

    const documentTitle = readDocumentTitle(payload);
    const title = readString(payload, "titel") || documentTitle || gz;

    return {
      status: "verified",
      gz,
      title,
      documentTitle,
      dokumentId: readString(payload, "dokumentId"),
      segmentId: readString(payload, "segmentId"),
      indexName: "findok-bfg",
      fullTextUrl: fullTextUrlForGz(gz),
      pdfUrl,
    };
  } catch (error) {
    return {
      status: "error",
      gz,
      reason: error instanceof Error ? error.message : "Findok konnte nicht abgefragt werden.",
    };
  }
}

export async function verifyBfgCitations(
  gzs: string[],
  fetchImpl: FetchLike = fetch,
  options: {
    deadline?: Deadline;
    signal?: AbortSignal;
    cache?: BfgCitationCache;
    metricsNow?: () => number;
    onMetrics?: (metrics: BfgCitationBatchMetrics) => void;
  } = {},
): Promise<{ verified: VerifiedBfgCitation[]; rejected: RejectedBfgCitation[] }> {
  const metricsNow = options.metricsNow ?? Date.now;
  const startedAt = metricsNow();
  const seen = new Set<string>();
  const orderedGzs = gzs.flatMap((value) => {
    const gz = normalizeBfgGz(value);
    if (!gz || seen.has(gz)) {
      return [];
    }
    seen.add(gz);
    return [gz];
  });

  const cache = options.cache ?? sharedBfgCitationCache;
  const results: BfgCitationResolution[] = [];
  const cacheStatuses: BfgCitationCacheStatus[] = [];
  let cursor = 0;
  const callerSignals = [options.deadline?.signal, options.signal].filter(
    (signal): signal is AbortSignal => signal !== undefined,
  );
  const callerSignal = callerSignals.length > 1
    ? AbortSignal.any(callerSignals)
    : callerSignals[0];

  async function worker(): Promise<void> {
    while (cursor < orderedGzs.length) {
      if (callerSignal?.aborted) return;
      const index = cursor;
      cursor += 1;
      const gz = orderedGzs[index] ?? "";
      const cached = await cache.resolve(
        gz,
        () => resolveBfgCitation(gz, fetchImpl),
        { signal: callerSignal },
      );
      results[index] = cached.resolution;
      cacheStatuses[index] = cached.cacheStatus;
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(MAX_CONCURRENT_FINDOK_REQUESTS, orderedGzs.length) },
      () => worker(),
    ),
  );

  const verified = results.filter(
    (result): result is { status: "verified" } & VerifiedBfgCitation => result.status === "verified",
  );
  const rejected = results.filter(
    (result): result is RejectedBfgCitation => result.status !== "verified",
  );
  const errors = rejected.filter((result) => result.status === "error");
  options.onMetrics?.({
    candidateCount: orderedGzs.length,
    verifiedCount: verified.length,
    cacheHits: cacheStatuses.filter((status) => status === "hit").length,
    cacheMisses: cacheStatuses.filter((status) => status === "miss").length,
    coalesced: cacheStatuses.filter((status) => status === "coalesced").length,
    durationMs: Math.max(0, metricsNow() - startedAt),
    timeoutCount: errors.filter((result) => /nicht rechtzeitig|zu lange|timeout/iu.test(result.reason)).length,
    errorCount: errors.length,
  });

  return {
    verified,
    rejected,
  };
}

export function linkVerifiedBfgCitations(
  answer: string,
  verified: VerifiedBfgCitation[],
  options: { target?: "pdf" | "fullText" } = {},
): string {
  const byGz = verifiedCitationMap(verified);
  const target = options.target ?? "pdf";
  if (byGz.size === 0) {
    return answer;
  }

  const relinked = answer.replace(markdownLinkPattern(), (full, label: string) => {
    const normalizedLabel = normalizeBfgGz(label);
    const citation = byGz.get(normalizedLabel);
    return citation && normalizedLabel === label.trim().toUpperCase()
      ? markdownLinkForCitation(citation, target)
      : full;
  });

  return replaceOutsideMarkdownLinks(relinked, (chunk) =>
    chunk.replace(createGzPattern(), (full, prefix: string, gz: string) => {
      const citation = byGz.get(normalizeBfgGz(gz));
      return citation ? `${prefix}${markdownLinkForCitation(citation, target)}` : full;
    }),
  );
}

export function findUnverifiedBfgCitations(answer: string, verified: VerifiedBfgCitation[]): string[] {
  const byGz = verifiedCitationMap(verified);
  return extractBfgGzCandidates(answer).filter((gz) => !byGz.has(normalizeBfgGz(gz)));
}
