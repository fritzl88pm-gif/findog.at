import { type Deadline, runWithTimeout } from "../deadline";

const FINDOK_ORIGIN = "https://findok.bmf.gv.at";
const FINDOK_PDF_PATH_PREFIX = "/findok/resources/pdf/";
const SUPPORTED_GZ_PREFIXES = ["RV", "RS", "RM", "AW", "VH"] as const;
const MAX_CONCURRENT_FINDOK_REQUESTS = 4;
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

function createGzPattern(): RegExp {
  return new RegExp(
    `(^|[^A-Z0-9])((?:${SUPPORTED_GZ_PREFIXES.join("|")})\\/[A-Z0-9ÄÖÜ-]+\\/\\d{2,4})(?![A-Z0-9/])`,
    "giu",
  );
}

function normalizeBfgGz(value: string): string {
  return value.trim().replace(/[),.;:]+$/u, "").toUpperCase();
}

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
  options: { deadline?: Deadline; signal?: AbortSignal } = {},
): Promise<{ verified: VerifiedBfgCitation[]; rejected: RejectedBfgCitation[] }> {
  const seen = new Set<string>();
  const orderedGzs = gzs.flatMap((value) => {
    const gz = normalizeBfgGz(value);
    if (!gz || seen.has(gz)) {
      return [];
    }
    seen.add(gz);
    return [gz];
  });

  const cache = new Map<string, Promise<BfgCitationResolution>>();
  const results: BfgCitationResolution[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < orderedGzs.length) {
      const index = cursor;
      cursor += 1;
      const gz = orderedGzs[index] ?? "";
      let resolution = cache.get(gz);
      if (!resolution) {
        resolution = resolveBfgCitation(gz, fetchImpl, options);
        cache.set(gz, resolution);
      }
      results[index] = await resolution;
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(MAX_CONCURRENT_FINDOK_REQUESTS, orderedGzs.length) },
      () => worker(),
    ),
  );

  return {
    verified: results.filter((result): result is { status: "verified" } & VerifiedBfgCitation => result.status === "verified"),
    rejected: results.filter((result): result is RejectedBfgCitation => result.status !== "verified"),
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
