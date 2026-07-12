const FINDOK_ORIGIN = "https://findok.bmf.gv.at";
const FINDOK_BASE_PATH = "/findok";
const FINDOK_API_BASE = `${FINDOK_ORIGIN}${FINDOK_BASE_PATH}/api`;
const MAX_SNIPPET_CHARS = 500;
const MAX_PRO_CONTENT_CHARS = 100_000;
const BFG_PRO_RAW_PAGE_SIZE = 20;
const BFG_PRO_MAX_PAGES = 2;

export type BfgSort = "1" | "2" | "3" | "4" | "7" | "10";

export type BfgSearchFilters = {
  materie?: string;
  documentType?: string;
  norm?: string;
  withHeadnote?: "true";
  timeframe?: "1" | "2" | "3" | "4" | "5" | "6" | "7";
};

export type BfgFacetOption = {
  value: string;
  label: string;
  count: number;
};

export type BfgFilterFacets = {
  materie: BfgFacetOption[];
  documentType: BfgFacetOption[];
  norm: BfgFacetOption[];
  timeframe: BfgFacetOption[];
  withHeadnote: BfgFacetOption[];
};

const FILTER_AGGREGATIONS = [
  ["materie", "konseh.materien.bezeichnungAgg.keyword"],
  ["documentType", "konseh.dokumenttypAgg.keyword"],
  ["norm", "indexable.normenAgg.keyword"],
  ["withHeadnote", "dokument.bfg.mitRechtssaetzen.boolean"],
  ["timeframe", "dokument.appdatVon.date"],
] as const satisfies ReadonlyArray<readonly [keyof BfgSearchFilters, string]>;

type FetchLike = typeof fetch;

type FindokSearchHit = {
  dokumentId: string;
  segmentId: string;
  indexName: string;
  title: string;
  dokumenttyp: string;
  snippet: string;
};

export type BfgDecision = {
  title: string;
  gz: string;
  documentType: string;
  publicationDate: string;
  snippet: string;
  htmlUrl: string | null;
  pdfUrl: string | null;
};

export type BfgDecisionPage = {
  results: BfgDecision[];
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  facets: BfgFilterFacets;
};

export type BfgProCandidate = {
  candidateId: string;
  title: string;
  gz: string;
  documentType: string;
  decisionDate: string;
  publicationDate: string;
  content: string;
  htmlUrl: string | null;
  pdfUrl: string | null;
};

export class FindokUpstreamError extends Error {
  constructor(message = "Findok lieferte keine verwertbare Antwort.") {
    super(message);
    this.name = "FindokUpstreamError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function integerValue(record: Record<string, unknown>, key: string, fallback: number): number {
  const value = record[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function emptyFacets(): BfgFilterFacets {
  return {
    materie: [],
    documentType: [],
    norm: [],
    timeframe: [],
    withHeadnote: [],
  };
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => {
      const value = Number(code);
      return Number.isInteger(value) && value >= 0 && value <= 0x10ffff
        ? String.fromCodePoint(value)
        : "";
    });
}

function plainTextWithLimit(value: string, maximum: number): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function plainText(value: string): string {
  return plainTextWithLimit(value, MAX_SNIPPET_CHARS);
}

export function normalizeFindokQuery(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function detectExactFindokGz(value: string): string | null {
  const normalized = normalizeFindokQuery(value)
    .replace(/\s*\/\s*/g, "/")
    .toUpperCase();
  return /^R[VM]\/[A-Z0-9ÄÖÜ.-]+(?:\/[A-Z0-9ÄÖÜ.-]+)*\/\d{4}$/u.test(normalized)
    ? normalized
    : null;
}

export function parseFindokSseData(source: string): unknown {
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  for (const event of normalized.split(/\n\n+/)) {
    const dataLines = event
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""));
    if (dataLines.length === 0) {
      continue;
    }
    const data = dataLines.join("\n").trim();
    if (!data || data === "[DONE]") {
      continue;
    }
    try {
      return JSON.parse(data) as unknown;
    } catch {
      throw new FindokUpstreamError("Findok lieferte ein ungültiges SSE-Datenereignis.");
    }
  }
  throw new FindokUpstreamError("Findok lieferte kein SSE-Datenereignis.");
}

function fixedApiUrl(path: string): URL {
  return new URL(`${FINDOK_API_BASE}${path}`);
}

function officialHtmlUrl(record: Record<string, unknown>): string | null {
  const dokumentId = stringValue(record, "dokumentId");
  const segmentId = stringValue(record, "segmentId");
  const indexName = stringValue(record, "indexName");
  if (!dokumentId || !segmentId || !indexName) {
    return null;
  }
  const url = new URL(`${FINDOK_BASE_PATH}/volltext`, FINDOK_ORIGIN);
  url.searchParams.set("dokumentId", dokumentId);
  url.searchParams.set("segmentId", segmentId);
  url.searchParams.set("indexName", indexName);
  return url.toString();
}

function officialPdfUrl(value: string): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value, `${FINDOK_ORIGIN}/`);
    return url.origin === FINDOK_ORIGIN && url.pathname.startsWith(`${FINDOK_BASE_PATH}/`)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function documentTitle(record: Record<string, unknown>): { title: string; gz: string } {
  const value = record.dokumentTitel;
  if (typeof value === "string") {
    return { title: value.trim(), gz: "" };
  }
  if (isRecord(value)) {
    return {
      title: stringValue(value, "titel"),
      gz: stringValue(value, "geschaeftszahl") || stringValue(value, "gz"),
    };
  }
  return { title: "", gz: "" };
}

function gzFromTitle(value: string): string {
  const match = /\b(R[VM]\/[A-Z0-9ÄÖÜ.-]+(?:\/[A-Z0-9ÄÖÜ.-]+)*\/\d{4})\b/iu.exec(value);
  return match?.[1]?.toUpperCase() ?? "";
}

function decisionDateFromDetail(detail: Record<string, unknown>, title: string): string {
  for (const key of ["entscheidungsdatum", "genehmigungsdatum", "dokumentDatum", "datum"]) {
    const value = stringValue(detail, key);
    if (value) {
      return plainText(value);
    }
  }
  return /\bvom\s+(\d{1,2}\.\d{1,2}\.\d{4})\b/iu.exec(title)?.[1] ?? "";
}

function mapDetail(
  detail: Record<string, unknown>,
  fallback?: FindokSearchHit,
  exactGz = "",
): BfgDecision | null {
  if (detail.bfg !== true) {
    return null;
  }
  const heading = documentTitle(detail);
  const title = stringValue(detail, "titel") || fallback?.title || heading.title || exactGz;
  const gz = heading.gz
    || stringValue(detail, "geschaeftszahl")
    || stringValue(detail, "gz")
    || gzFromTitle(heading.title)
    || gzFromTitle(title)
    || exactGz;
  const publication = detail.zusatzinformationen;
  const publicationDate = isRecord(publication)
    ? stringValue(publication, "inFindokVeroeffentlichtAm")
    : "";
  const snippetSource = fallback?.snippet
    || stringValue(detail, "snippet")
    || stringValue(detail, "content");

  return {
    title: plainText(title),
    gz: plainText(gz),
    documentType: plainText(stringValue(detail, "dokumenttyp") || fallback?.dokumenttyp || "BFG"),
    publicationDate: plainText(publicationDate),
    snippet: plainText(snippetSource),
    htmlUrl: officialHtmlUrl(detail) || (fallback ? officialHtmlUrl(fallback as unknown as Record<string, unknown>) : null),
    pdfUrl: officialPdfUrl(stringValue(detail, "dokumentPdfMediaUrl")),
  };
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) {
    throw new FindokUpstreamError(`Findok antwortete mit HTTP ${response.status}.`);
  }
  try {
    const payload = await response.json() as unknown;
    if (!isRecord(payload)) {
      throw new FindokUpstreamError();
    }
    return payload;
  } catch (error) {
    if (error instanceof FindokUpstreamError) {
      throw error;
    }
    throw new FindokUpstreamError("Findok lieferte ungültiges JSON.");
  }
}

function requestOptions(accept: string): RequestInit {
  return {
    headers: { Accept: accept },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  };
}

async function fetchExactGz(
  gz: string,
  pageSize: number,
  fetchImpl: FetchLike,
): Promise<BfgDecisionPage> {
  const url = fixedApiUrl("/volltext/gz");
  url.searchParams.set("gz", gz);
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), requestOptions("application/json"));
  } catch (error) {
    throw new FindokUpstreamError(error instanceof Error ? error.message : undefined);
  }
  if (response.status === 404) {
    return { results: [], page: 1, pageSize, totalPages: 0, totalCount: 0, facets: emptyFacets() };
  }
  const detail = await readJsonResponse(response);
  const decision = mapDetail(detail, undefined, gz);
  return {
    results: decision ? [decision] : [],
    page: 1,
    pageSize,
    totalPages: decision ? 1 : 0,
    totalCount: decision ? 1 : 0,
    facets: emptyFacets(),
  };
}

function primitiveString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  return typeof value === "number" || typeof value === "boolean" ? String(value) : "";
}

function firstPrimitiveString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = primitiveString(record[key]);
    if (value) {
      return value;
    }
  }
  return "";
}

function aggregationSource(aggregations: unknown, name: string): unknown {
  if (isRecord(aggregations)) {
    return aggregations[name];
  }
  if (!Array.isArray(aggregations)) {
    return undefined;
  }
  const matches = aggregations.filter((entry) => isRecord(entry)
    && firstPrimitiveString(
      entry,
      ["aggregationsName", "aggregationName", "name", "field", "key"],
    ) === name);
  return matches.length === 1 ? matches[0] : matches;
}

function aggregationBuckets(source: unknown): unknown[] {
  if (Array.isArray(source)) {
    return source;
  }
  if (!isRecord(source)) {
    return [];
  }
  for (const key of ["buckets", "values", "items", "entries", "options", "aggregationValues"]) {
    if (Array.isArray(source[key])) {
      return source[key];
    }
  }
  return typeof source.count === "number"
    || typeof source.doc_count === "number"
    || typeof source.docCount === "number"
    || typeof source.anzahl === "number"
    ? [source]
    : [];
}

function facetOption(value: unknown): BfgFacetOption | null {
  if (!isRecord(value)) {
    return null;
  }
  const optionValue = firstPrimitiveString(value, ["key", "value", "id", "name"]);
  if (!optionValue) {
    return null;
  }
  const rawCount = value.count ?? value.doc_count ?? value.docCount ?? value.anzahl;
  if (typeof rawCount !== "number" || !Number.isSafeInteger(rawCount) || rawCount < 0) {
    return null;
  }
  const explicitLabel = firstPrimitiveString(
    value,
    ["viewName", "label", "name", "bezeichnung", "key_as_string", "keyAsString", "displayValue"],
  );
  const valueAsLabel = typeof value.key !== "undefined" ? primitiveString(value.value) : "";
  return {
    value: optionValue,
    label: explicitLabel || valueAsLabel || optionValue,
    count: rawCount,
  };
}

function facetOptions(aggregations: unknown, name: string): BfgFacetOption[] {
  return aggregationBuckets(aggregationSource(aggregations, name))
    .map(facetOption)
    .filter((option): option is BfgFacetOption => option !== null);
}

function mapFilterFacets(aggregations: unknown): BfgFilterFacets {
  const facets = emptyFacets();
  for (const [key, aggregationName] of FILTER_AGGREGATIONS) {
    const options = facetOptions(aggregations, aggregationName);
    if (key === "withHeadnote") {
      facets.withHeadnote = options.filter((option) => option.value.toLowerCase() === "true");
    } else if (key === "timeframe") {
      facets.timeframe = options.filter((option) => /^[1-7]$/.test(option.value));
    } else {
      facets[key] = options;
    }
  }
  return facets;
}

function searchHits(value: unknown): FindokSearchHit[] {
  if (!Array.isArray(value)) {
    throw new FindokUpstreamError();
  }
  return value.flatMap((item): FindokSearchHit[] => {
    if (!isRecord(item)) {
      return [];
    }
    const hit = {
      dokumentId: stringValue(item, "dokumentId"),
      segmentId: stringValue(item, "segmentId"),
      indexName: stringValue(item, "indexName"),
      title: stringValue(item, "title"),
      dokumenttyp: stringValue(item, "dokumenttyp"),
      snippet: stringValue(item, "snippet"),
    };
    return hit.dokumentId && hit.segmentId && hit.indexName ? [hit] : [];
  });
}

async function fetchSearchDetail(hit: FindokSearchHit, fetchImpl: FetchLike): Promise<BfgDecision | null> {
  const url = fixedApiUrl("/volltext");
  url.searchParams.set("documentId", hit.dokumentId);
  url.searchParams.set("segmentId", hit.segmentId);
  url.searchParams.set("indexName", hit.indexName);
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), requestOptions("application/json"));
  } catch (error) {
    throw new FindokUpstreamError(error instanceof Error ? error.message : undefined);
  }
  return mapDetail(await readJsonResponse(response), hit);
}

function mapProDetail(
  detail: Record<string, unknown>,
  hit: FindokSearchHit,
): Omit<BfgProCandidate, "candidateId"> | null {
  if (detail.bfg !== true) {
    return null;
  }
  const heading = documentTitle(detail);
  const title = stringValue(detail, "titel") || hit.title || heading.title;
  const publication = detail.zusatzinformationen;
  return {
    title: plainText(title),
    gz: plainText(
      heading.gz
      || stringValue(detail, "geschaeftszahl")
      || stringValue(detail, "gz")
      || gzFromTitle(heading.title)
      || gzFromTitle(title),
    ),
    documentType: plainText(stringValue(detail, "dokumenttyp") || hit.dokumenttyp || "BFG"),
    decisionDate: decisionDateFromDetail(detail, heading.title || title),
    publicationDate: isRecord(publication)
      ? plainText(stringValue(publication, "inFindokVeroeffentlichtAm"))
      : "",
    content: plainTextWithLimit(stringValue(detail, "content"), MAX_PRO_CONTENT_CHARS),
    htmlUrl: officialHtmlUrl(detail)
      || officialHtmlUrl(hit as unknown as Record<string, unknown>),
    pdfUrl: officialPdfUrl(stringValue(detail, "dokumentPdfMediaUrl")),
  };
}

async function fetchProSearchPage(
  query: string,
  page: number,
  fetchImpl: FetchLike,
): Promise<{ hits: FindokSearchHit[]; totalPages: number }> {
  const url = fixedApiUrl("/dokumente");
  url.searchParams.set("page", String(page));
  url.searchParams.set("size", String(BFG_PRO_RAW_PAGE_SIZE));
  url.searchParams.set("suchbegriff", query);
  url.searchParams.set("typen", "BFG");
  url.searchParams.set("sort.value", "1");

  let response: Response;
  try {
    response = await fetchImpl(url.toString(), requestOptions("text/event-stream"));
  } catch (error) {
    throw new FindokUpstreamError(error instanceof Error ? error.message : undefined);
  }
  if (!response.ok) {
    throw new FindokUpstreamError(`Findok antwortete mit HTTP ${response.status}.`);
  }
  const payload = parseFindokSseData(await response.text());
  if (!isRecord(payload) || !isRecord(payload.pageResults)) {
    throw new FindokUpstreamError();
  }
  return {
    hits: searchHits(payload.pageResults.searchResults).slice(0, BFG_PRO_RAW_PAGE_SIZE),
    totalPages: integerValue(payload.pageResults, "totalPages", 0),
  };
}

async function fetchProDetails(
  hits: FindokSearchHit[],
  fetchImpl: FetchLike,
): Promise<Array<Omit<BfgProCandidate, "candidateId"> | null>> {
  return Promise.all(hits.map(async (hit) => {
    const url = fixedApiUrl("/volltext");
    url.searchParams.set("documentId", hit.dokumentId);
    url.searchParams.set("segmentId", hit.segmentId);
    url.searchParams.set("indexName", hit.indexName);
    let response: Response;
    try {
      response = await fetchImpl(url.toString(), requestOptions("application/json"));
    } catch (error) {
      throw new FindokUpstreamError(error instanceof Error ? error.message : undefined);
    }
    return mapProDetail(await readJsonResponse(response), hit);
  }));
}

export async function fetchBfgProCandidates({
  query,
  fetchImpl = fetch,
}: {
  query: string;
  fetchImpl?: FetchLike;
}): Promise<BfgProCandidate[]> {
  const normalizedQuery = normalizeFindokQuery(query);
  const candidates: Array<Omit<BfgProCandidate, "candidateId">> = [];
  let totalPages = 1;

  for (let page = 1; page <= BFG_PRO_MAX_PAGES && page <= totalPages; page += 1) {
    const searchPage = await fetchProSearchPage(normalizedQuery, page, fetchImpl);
    totalPages = Math.max(1, searchPage.totalPages);
    const details = await fetchProDetails(searchPage.hits, fetchImpl);
    candidates.push(...details.filter(
      (candidate): candidate is Omit<BfgProCandidate, "candidateId"> => candidate !== null,
    ));
  }

  const seen = new Set<string>();
  return candidates.flatMap((candidate): BfgProCandidate[] => {
    const identity = candidate.htmlUrl || `${candidate.gz}\u0000${candidate.title}`;
    if (seen.has(identity)) {
      return [];
    }
    seen.add(identity);
    return [{ ...candidate, candidateId: `candidate-${seen.size}` }];
  });
}

async function fetchSearch(
  query: string,
  page: number,
  pageSize: number,
  sort: BfgSort,
  filters: BfgSearchFilters,
  fetchImpl: FetchLike,
): Promise<BfgDecisionPage> {
  const url = fixedApiUrl("/dokumente");
  url.searchParams.set("page", String(page));
  url.searchParams.set("size", String(pageSize));
  url.searchParams.set("suchbegriff", query);
  url.searchParams.set("typen", "BFG");
  url.searchParams.set("sort.value", sort);
  const activeFilters = FILTER_AGGREGATIONS.flatMap(([key, aggregationName]) => {
    const value = filters[key];
    return value ? [{ aggregationName: `1.${aggregationName}`, value }] : [];
  });
  if (activeFilters.length > 0) {
    url.searchParams.set(
      "filter.aggregationsName",
      activeFilters.map((filter) => filter.aggregationName).join(","),
    );
    url.searchParams.set(
      "filter.aggregationsValues",
      activeFilters.map((filter) => filter.value).join(","),
    );
  }

  let response: Response;
  try {
    response = await fetchImpl(url.toString(), requestOptions("text/event-stream"));
  } catch (error) {
    throw new FindokUpstreamError(error instanceof Error ? error.message : undefined);
  }
  if (!response.ok) {
    throw new FindokUpstreamError(`Findok antwortete mit HTTP ${response.status}.`);
  }
  const payload = parseFindokSseData(await response.text());
  if (!isRecord(payload) || !isRecord(payload.pageResults)) {
    throw new FindokUpstreamError();
  }
  const pageResults = payload.pageResults;
  const details = await Promise.all(
    searchHits(pageResults.searchResults).map((hit) => fetchSearchDetail(hit, fetchImpl)),
  );

  return {
    results: details.filter((item): item is BfgDecision => item !== null),
    page: Math.max(1, integerValue(pageResults, "currentPage", page - 1) + 1),
    pageSize: integerValue(pageResults, "pageSize", pageSize),
    totalPages: integerValue(pageResults, "totalPages", 0),
    totalCount: integerValue(pageResults, "totalSize", 0),
    facets: mapFilterFacets(payload.aggregations),
  };
}

export async function fetchBfgDecisions({
  query,
  page,
  pageSize,
  sort = "1",
  filters = {},
  fetchImpl = fetch,
}: {
  query: string;
  page: number;
  pageSize: number;
  sort?: BfgSort;
  filters?: BfgSearchFilters;
  fetchImpl?: FetchLike;
}): Promise<BfgDecisionPage> {
  const normalizedQuery = normalizeFindokQuery(query);
  const exactGz = detectExactFindokGz(normalizedQuery);
  return exactGz
    ? fetchExactGz(exactGz, pageSize, fetchImpl)
    : fetchSearch(normalizedQuery, page, pageSize, sort, filters, fetchImpl);
}
