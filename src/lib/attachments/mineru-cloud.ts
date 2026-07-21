import { UserVisibleError } from "@/lib/errors";
import { Unzip, UnzipInflate } from "fflate";

export class MineruBatchError extends UserVisibleError {
  constructor(message: string, status = 502) {
    super(message, status);
    this.name = "MineruBatchError";
  }
}

export type MineruFileInput = {
  readonly kind: "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx";
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly bytes: Uint8Array;
};

export type MineruBatchOptions = {
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  maxPolls?: number;
  maxJsonBytes?: number;
  maxZipBytes?: number;
  maxMarkdownBytes?: number;
  signal?: AbortSignal;
};

const BASE_URL = "https://mineru.net/api/v4";
const MAX_BATCH_SIZE = 5;
const MAX_JSON_BYTES = 256 * 1024;
const MAX_ZIP_BYTES = 100 * 1024 * 1024;
// Large legal PDFs can produce substantially more than 100 KB of Markdown.
// The combined model context is capped separately, while this limit protects
// the server from unexpectedly large decompressed MinerU results.
export const MAX_MINERU_MARKDOWN_BYTES = 5 * 1024 * 1024;
const POLL_INTERVAL_MS = 5_000;
const MAX_POLLS = 45;
const RESULT_STATES = new Set(["waiting-file", "pending", "running", "converting", "done", "failed"]);

type ApiResponse<T> = {
  code: number;
  data: T;
  msg: string;
  trace_id?: string;
};

type BatchUrlResponse = {
  batch_id: string;
  file_urls: string[];
};

type BatchResult = {
  file_name: string;
  data_id: string;
  state: string;
  err_msg: string;
  full_zip_url?: string;
};

type BatchStatusResponse = {
  batch_id: string;
  extract_result: BatchResult[];
};

type RequestedFile = {
  input: MineruFileInput;
  dataId: string;
};

function apiKey(): string {
  const value = process.env.MINERU_API_TOKEN?.trim() ?? "";
  if (!value) {
    throw new MineruBatchError(
      "MinerU ist serverseitig nicht konfiguriert. Bitte Administrator kontaktieren.",
      503,
    );
  }
  return value;
}

function sanitizeFilename(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9.\-_\u00C0-\u024F ]/gu, "").trim();
  return sanitized || "Datei";
}

function fileError(name: string, category: string, status = 502): MineruBatchError {
  return new MineruBatchError(`${sanitizeFilename(name)}: ${category}.`, status);
}

function deterministicDataId(file: MineruFileInput, index: number): string {
  const prefix = `file-${index + 1}-`;
  const safeHash = file.sha256.replace(/[^a-zA-Z0-9_-]/g, "") || "hash";
  return prefix + safeHash.slice(0, 128 - prefix.length);
}

function requestedFiles(files: MineruFileInput[]): RequestedFile[] {
  return files.map((input, index) => ({ input, dataId: deterministicDataId(input, index) }));
}

function createPayload(files: RequestedFile[]) {
  return {
    files: files.map(({ input, dataId }) => ({
      name: input.name,
      data_id: dataId,
      ...(input.kind === "pdf" ? { is_ocr: true } : {}),
    })),
    model_version: "vlm",
    language: "latin",
    enable_table: true,
    enable_formula: true,
  };
}

async function readBytesCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new MineruBatchError("MinerU-Antwort überschreitet das Größenlimit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readJsonCapped<T>(response: Response, maxBytes: number): Promise<T> {
  const bytes = await readBytesCapped(response, maxBytes);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as T;
  } catch (error) {
    if (error instanceof MineruBatchError) throw error;
    throw new MineruBatchError("MinerU lieferte eine ungültige Antwort.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseApiData<T>(body: unknown): T {
  if (!isRecord(body) || body.code !== 0 || !isRecord(body.data)) {
    throw new MineruBatchError("MinerU-Verarbeitung wurde abgelehnt.");
  }
  return body.data as T;
}

async function obtainUploadUrls(
  files: RequestedFile[],
  key: string,
  fetcher: typeof globalThis.fetch,
  maxJsonBytes: number,
  signal?: AbortSignal,
): Promise<{ batchId: string; uploadUrls: string[] }> {
  const response = await fetcher(`${BASE_URL}/file-urls/batch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(createPayload(files)),
    signal,
  });
  if (!response.ok) throw new MineruBatchError("MinerU-Upload konnte nicht vorbereitet werden.");

  const body = await readJsonCapped<ApiResponse<BatchUrlResponse>>(response, maxJsonBytes);
  const data = parseApiData<BatchUrlResponse>(body);
  if (typeof data.batch_id !== "string" || !Array.isArray(data.file_urls)) {
    throw new MineruBatchError("MinerU lieferte eine ungültige Upload-Antwort.");
  }
  if (data.file_urls.length !== files.length || data.file_urls.some((url) => typeof url !== "string" || !url)) {
    throw new MineruBatchError("MinerU lieferte unvollständige Upload-Ziele.");
  }
  return { batchId: data.batch_id, uploadUrls: data.file_urls };
}

async function uploadFiles(
  files: RequestedFile[],
  uploadUrls: string[],
  fetcher: typeof globalThis.fetch,
  signal?: AbortSignal,
): Promise<void> {
  for (let index = 0; index < files.length; index++) {
    const response = await fetcher(uploadUrls[index], {
      method: "PUT",
      body: files[index].input.bytes as BodyInit,
      signal,
    });
    if (!response.ok) throw fileError(files[index].input.name, "Upload fehlgeschlagen");
  }
}

function validateResults(results: BatchResult[], files: RequestedFile[]): Map<string, BatchResult> {
  if (!Array.isArray(results)) throw new MineruBatchError("MinerU lieferte ungültige Ergebnisdaten.");
  const expected = new Map(files.map((file) => [file.dataId, file]));
  const found = new Map<string, BatchResult>();

  for (const result of results) {
    if (!isRecord(result) || typeof result.data_id !== "string" || typeof result.state !== "string") {
      throw new MineruBatchError("MinerU lieferte ungültige Ergebnisdaten.");
    }
    const requested = expected.get(result.data_id);
    if (!requested || found.has(result.data_id)) {
      throw new MineruBatchError("MinerU lieferte widersprüchliche Ergebnisdaten.");
    }
    if (!RESULT_STATES.has(result.state)) {
      throw fileError(requested.input.name, "unbekannter Verarbeitungsstatus");
    }
    if (result.state === "failed") {
      throw fileError(requested.input.name, "Verarbeitung fehlgeschlagen");
    }
    found.set(result.data_id, result);
  }

  if (found.size !== expected.size) {
    throw new MineruBatchError("MinerU lieferte unvollständige Ergebnisdaten.");
  }
  return found;
}

async function pollBatchResults(
  batchId: string,
  files: RequestedFile[],
  key: string,
  fetcher: typeof globalThis.fetch,
  sleep: (ms: number) => Promise<void>,
  pollIntervalMs: number,
  maxPolls: number,
  maxJsonBytes: number,
  signal?: AbortSignal,
): Promise<Map<string, BatchResult>> {
  for (let poll = 0; poll < maxPolls; poll++) {
    if (signal?.aborted) throw new MineruBatchError("Die Anfrage wurde abgebrochen.");
    const response = await fetcher(`${BASE_URL}/extract-results/batch/${batchId}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal,
    });
    if (!response.ok) throw new MineruBatchError("MinerU-Ergebnisse konnten nicht abgerufen werden.");

    const body = await readJsonCapped<ApiResponse<BatchStatusResponse>>(response, maxJsonBytes);
    const data = parseApiData<BatchStatusResponse>(body);
    const results = validateResults(data.extract_result, files);
    if ([...results.values()].every((result) => result.state === "done")) return results;
    if (poll + 1 < maxPolls) await sleep(pollIntervalMs);
  }
  throw new MineruBatchError("MinerU-Verarbeitung hat das Zeitlimit überschritten.", 504);
}

function validateResultUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MineruBatchError("MinerU lieferte ein ungültiges Download-Ziel.");
  }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || hostname !== "cdn-mineru.openxlab.org.cn") {
    throw new MineruBatchError("MinerU lieferte ein unzulässiges Download-Ziel.");
  }
  return url;
}

function isFullMarkdownPathVariant(name: string): boolean {
  if (name === "full.md") return false;
  const normalized = name.replace(/\\/g, "/").replace(/^(\.\/)+/, "").toLowerCase();
  return normalized === "full.md" || normalized.endsWith("/full.md");
}

async function downloadAndExtract(
  requested: RequestedFile,
  result: BatchResult,
  fetcher: typeof globalThis.fetch,
  maxZipBytes: number,
  maxMarkdownBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  if (typeof result.full_zip_url !== "string" || !result.full_zip_url) {
    throw fileError(requested.input.name, "Ergebnis fehlt");
  }
  const url = validateResultUrl(result.full_zip_url);
  const response = await fetcher(url, { signal });
  if (!response.ok || !response.body) throw fileError(requested.input.name, "Download fehlgeschlagen");

  let markdownFound = false;
  let pathVariantFound = false;
  let extractionError: Error | null = null;
  let markdownBytes = 0;
  const markdownChunks: Uint8Array[] = [];
  const unzip = new Unzip((entry) => {
    entry.ondata = (error, chunk, final) => {
      if (error && !extractionError) extractionError = error;
      if (entry.name !== "full.md" || extractionError) return;
      markdownBytes += chunk.byteLength;
      if (markdownBytes > maxMarkdownBytes) {
        extractionError = fileError(requested.input.name, "Markdown überschreitet das Größenlimit");
        return;
      }
      if (chunk.byteLength > 0) markdownChunks.push(chunk);
      if (final) markdownFound = true;
    };

    if (isFullMarkdownPathVariant(entry.name)) {
      pathVariantFound = true;
      return;
    }
    if (entry.name !== "full.md") return;
    if (markdownFound || markdownChunks.length > 0) {
      extractionError = fileError(requested.input.name, "mehrdeutiges Markdown-Ergebnis");
      return;
    }
    if (typeof entry.originalSize === "number" && entry.originalSize > maxMarkdownBytes) {
      extractionError = fileError(requested.input.name, "Markdown überschreitet das Größenlimit");
      return;
    }
    entry.start();
  });
  unzip.register(UnzipInflate);

  const reader = response.body.getReader();
  let compressedBytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      compressedBytes += value.byteLength;
      if (compressedBytes > maxZipBytes) {
        await reader.cancel();
        throw fileError(requested.input.name, "ZIP überschreitet das Größenlimit");
      }
      unzip.push(value, false);
      if (extractionError) throw extractionError;
    }
    unzip.push(new Uint8Array(), true);
  } catch (error) {
    if (error instanceof MineruBatchError) throw error;
    throw fileError(requested.input.name, "ungültiges ZIP-Ergebnis");
  } finally {
    reader.releaseLock();
  }

  const finalExtractionError = extractionError as Error | null;
  if (finalExtractionError) {
    if (finalExtractionError instanceof MineruBatchError) throw finalExtractionError;
    throw fileError(requested.input.name, "ungültiges ZIP-Ergebnis");
  }
  if (pathVariantFound) throw fileError(requested.input.name, "unzulässiger Markdown-Pfad");
  if (!markdownFound) throw fileError(requested.input.name, "vollständiges Markdown fehlt");

  const combined = new Uint8Array(markdownBytes);
  let offset = 0;
  for (const chunk of markdownChunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let markdown: string;
  try {
    markdown = new TextDecoder("utf-8", { fatal: true }).decode(combined);
  } catch {
    throw fileError(requested.input.name, "Markdown ist ungültig codiert");
  }
  if (!markdown.trim()) throw fileError(requested.input.name, "Markdown ist leer");
  return markdown;
}

export async function processMineruBatch(
  files: MineruFileInput[],
  options: MineruBatchOptions = {},
): Promise<string[]> {
  if (options.signal?.aborted) throw new MineruBatchError("Die Anfrage wurde abgebrochen.");
  if (files.length === 0) throw new MineruBatchError("Mindestens eine Datei erforderlich.", 400);
  if (files.length > MAX_BATCH_SIZE) throw new MineruBatchError("Maximal 5 Dateien pro Batch.", 400);

  const key = apiKey();
  const fetcher = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const maxPolls = options.maxPolls ?? MAX_POLLS;
  const maxJsonBytes = options.maxJsonBytes ?? MAX_JSON_BYTES;
  const maxZipBytes = options.maxZipBytes ?? MAX_ZIP_BYTES;
  const maxMarkdownBytes = options.maxMarkdownBytes ?? MAX_MINERU_MARKDOWN_BYTES;
  const requested = requestedFiles(files);

  const { batchId, uploadUrls } = await obtainUploadUrls(requested, key, fetcher, maxJsonBytes, options.signal);
  await uploadFiles(requested, uploadUrls, fetcher, options.signal);
  const results = await pollBatchResults(
    batchId,
    requested,
    key,
    fetcher,
    sleep,
    pollIntervalMs,
    maxPolls,
    maxJsonBytes,
    options.signal,
  );

  return Promise.all(requested.map((file) =>
    downloadAndExtract(file, results.get(file.dataId)!, fetcher, maxZipBytes, maxMarkdownBytes, options.signal),
  ));
}
