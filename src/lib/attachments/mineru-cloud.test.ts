import PizZip from "pizzip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_MINERU_MARKDOWN_BYTES,
  MineruBatchError,
  processMineruBatch,
  type MineruFileInput,
} from "./mineru-cloud";

const BASE = "https://mineru.net/api/v4";
const CDN = "https://cdn-mineru.openxlab.org.cn/results";
const originalToken = process.env.MINERU_API_TOKEN;

function zipBuf(entries: Record<string, string>): Uint8Array {
  const zip = new PizZip();
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  return new Uint8Array(zip.generate({ type: "arraybuffer", compression: "DEFLATE" }));
}

function file(name: string, sha256 = `sha256-${name}`): MineruFileInput {
  return {
    kind: "pdf",
    name,
    mimeType: "application/pdf",
    sizeBytes: 4,
    sha256,
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function zipResponse(bytes: Uint8Array): Response {
  return new Response(bytes as BodyInit, {
    headers: { "Content-Type": "application/zip" },
  });
}

function headers(init?: RequestInit): Record<string, string> {
  return Object.fromEntries(new Headers(init?.headers).entries());
}

type FetchHandler = (init?: RequestInit) => Response | Promise<Response>;

function scriptedFetch(handlers: Record<string, FetchHandler>) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const handler = handlers[url];
    return handler ? handler(init) : new Response("not found", { status: 404 });
  });
}

function officialBatch(
  inputs: MineruFileInput[],
  markdown: string[],
  options: { resultUrls?: string[]; statusBodies?: unknown[]; uploadUrls?: string[] } = {},
) {
  const uploadUrls = options.uploadUrls ?? inputs.map((_, index) => `https://uploads.example.com/${index}`);
  const resultUrls = options.resultUrls ?? inputs.map((_, index) => `${CDN}/${index}/full.zip`);
  const handlers: Record<string, FetchHandler> = {
    [`${BASE}/file-urls/batch`]: () => jsonResponse({
      code: 0,
      data: { batch_id: "batch-1", file_urls: uploadUrls },
      msg: "ok",
      trace_id: "trace-secret",
    }),
  };
  uploadUrls.forEach((url) => {
    handlers[url] = () => new Response(null, { status: 200 });
  });
  const statuses = options.statusBodies ?? [{
    code: 0,
    data: {
      batch_id: "batch-1",
      extract_result: inputs.map((input, index) => ({
        file_name: input.name,
        data_id: `file-${index + 1}-${input.sha256}`,
        state: "done",
        err_msg: "",
        full_zip_url: resultUrls[index],
      })),
    },
    msg: "ok",
    trace_id: "trace-secret",
  }];
  let poll = 0;
  handlers[`${BASE}/extract-results/batch/batch-1`] = () =>
    jsonResponse(statuses[Math.min(poll++, statuses.length - 1)]);
  resultUrls.forEach((url, index) => {
    handlers[url] = () => zipResponse(zipBuf({ "full.md": markdown[index] ?? "" }));
  });
  return { fetch: scriptedFetch(handlers), handlers, uploadUrls, resultUrls };
}

describe("MinerU cloud adapter", () => {
  beforeEach(() => {
    process.env.MINERU_API_TOKEN = "test-mineru-token";
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.MINERU_API_TOKEN;
    else process.env.MINERU_API_TOKEN = originalToken;
  });

  it("uses the official positional upload contract and headerless signed PUTs", async () => {
    const inputs = [file("same.pdf", "duplicate-hash"), file("same.pdf", "duplicate-hash")];
    const { fetch, uploadUrls } = officialBatch(inputs, ["first", "second"]);

    await expect(processMineruBatch(inputs, { fetch, sleep: vi.fn(), maxPolls: 2 }))
      .resolves.toEqual(["first", "second"]);

    const post = vi.mocked(fetch).mock.calls.find(([url]) => url === `${BASE}/file-urls/batch`);
    const body = JSON.parse(String(post?.[1]?.body)) as {
      files: Array<{ name: string; data_id: string; is_ocr: boolean }>;
      model_version: string;
      language: string;
      enable_table: boolean;
      enable_formula: boolean;
    };
    expect(body).toMatchObject({
      model_version: "vlm",
      language: "latin",
      enable_table: true,
      enable_formula: true,
    });
    expect(body.files.map(({ name, is_ocr }) => ({ name, is_ocr }))).toEqual([
      { name: "same.pdf", is_ocr: true },
      { name: "same.pdf", is_ocr: true },
    ]);
    expect(new Set(body.files.map((entry) => entry.data_id)).size).toBe(2);
    expect(body.files.every((entry) => entry.data_id.length <= 128)).toBe(true);

    for (const uploadUrl of uploadUrls) {
      const put = vi.mocked(fetch).mock.calls.find(([url]) => url === uploadUrl);
      expect(put?.[1]?.method).toBe("PUT");
      expect(headers(put?.[1])).toEqual({});
    }
  });

  it("enables OCR only for PDFs", async () => {
    const pdf = file("scan.pdf", "pdf-hash");
    const docx: MineruFileInput = {
      ...file("letter.docx", "docx-hash"),
      kind: "docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    };
    const { fetch } = officialBatch([pdf, docx], ["pdf", "docx"]);

    await processMineruBatch([pdf, docx], { fetch, maxPolls: 1 });

    const post = vi.mocked(fetch).mock.calls.find(([url]) => url === `${BASE}/file-urls/batch`);
    const body = JSON.parse(String(post?.[1]?.body)) as {
      files: Array<{ name: string; is_ocr?: boolean }>;
    };
    expect(body.files).toEqual([
      expect.objectContaining({ name: "scan.pdf", is_ocr: true }),
      expect.not.objectContaining({ is_ocr: expect.anything() }),
    ]);
  });

  it("polls per-result states and restores input order by unique data_id", async () => {
    const inputs = [file("duplicate.pdf", "h"), file("duplicate.pdf", "h")];
    const ids = ["file-1-h", "file-2-h"];
    const statusBodies = [
      {
        code: 0,
        data: { batch_id: "batch-1", extract_result: [
          { file_name: "duplicate.pdf", data_id: ids[1], state: "running", err_msg: "" },
          { file_name: "duplicate.pdf", data_id: ids[0], state: "waiting-file", err_msg: "" },
        ] },
        msg: "ok",
        trace_id: "trace-secret",
      },
      {
        code: 0,
        data: { batch_id: "batch-1", extract_result: [
          { file_name: "duplicate.pdf", data_id: ids[1], state: "done", err_msg: "", full_zip_url: `${CDN}/1/full.zip` },
          { file_name: "duplicate.pdf", data_id: ids[0], state: "done", err_msg: "", full_zip_url: `${CDN}/0/full.zip` },
        ] },
        msg: "ok",
        trace_id: "trace-secret",
      },
    ];
    const { fetch } = officialBatch(inputs, ["first", "second"], { statusBodies });
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(processMineruBatch(inputs, { fetch, sleep, maxPolls: 3, pollIntervalMs: 7 }))
      .resolves.toEqual(["first", "second"]);
    expect(sleep).toHaveBeenCalledWith(7);
  });

  it.each([
    ["missing", [{ file_name: "a.pdf", data_id: "file-1-ha", state: "done", err_msg: "", full_zip_url: `${CDN}/0/full.zip` }]],
    ["duplicate", [
      { file_name: "a.pdf", data_id: "file-1-ha", state: "done", err_msg: "", full_zip_url: `${CDN}/0/full.zip` },
      { file_name: "b.pdf", data_id: "file-1-ha", state: "done", err_msg: "", full_zip_url: `${CDN}/1/full.zip` },
    ]],
    ["unknown", [
      { file_name: "a.pdf", data_id: "file-1-ha", state: "done", err_msg: "", full_zip_url: `${CDN}/0/full.zip` },
      { file_name: "b.pdf", data_id: "surprise", state: "done", err_msg: "", full_zip_url: `${CDN}/1/full.zip` },
    ]],
  ])("fails closed for %s result data_id", async (_case, extractResult) => {
    const inputs = [file("a.pdf", "ha"), file("b.pdf", "hb")];
    const statusBodies = [{ code: 0, data: { batch_id: "batch-1", extract_result: extractResult }, msg: "ok", trace_id: "trace-secret" }];
    const { fetch } = officialBatch(inputs, ["a", "b"], { statusBodies });
    await expect(processMineruBatch(inputs, { fetch, sleep: vi.fn(), maxPolls: 1 }))
      .rejects.toThrow(MineruBatchError);
  });

  it.each(["failed", "mystery-state"])("fails immediately for %s state without leaking provider details", async (state) => {
    const input = file("unsafe<script>.pdf", "hash");
    const statusBodies = [{
      code: 0,
      data: { batch_id: "batch-1", extract_result: [{
        file_name: input.name,
        data_id: "file-1-hash",
        state,
        err_msg: "secret provider diagnostic",
      }] },
      msg: "secret provider message",
      trace_id: "trace-secret",
    }];
    const { fetch } = officialBatch([input], ["unused"], { statusBodies });
    const error = (await processMineruBatch([input], { fetch, sleep: vi.fn(), maxPolls: 2 }).catch((caught) => caught as Error)) as Error;
    expect(error).toBeInstanceOf(MineruBatchError);
    expect(error.message).toContain("unsafescript.pdf");
    expect(error.message).not.toMatch(/secret|trace|https?:\/\//i);
  });

  it("stops polling at the intrinsic max-poll limit", async () => {
    const input = file("slow.pdf", "slow");
    const running = {
      code: 0,
      data: { batch_id: "batch-1", extract_result: [{ file_name: input.name, data_id: "file-1-slow", state: "pending", err_msg: "" }] },
      msg: "ok",
      trace_id: "trace-secret",
    };
    const { fetch } = officialBatch([input], ["unused"], { statusBodies: [running] });
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(processMineruBatch([input], { fetch, sleep, maxPolls: 2 }))
      .rejects.toThrow(/Zeitlimit/);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("caps MinerU JSON before parsing and never calls response.json", async () => {
    const input = file("large.pdf", "large");
    const oversized = new Response("x".repeat(33), { status: 200 });
    oversized.json = vi.fn(() => { throw new Error("unbounded json() must not run"); });
    const fetch = scriptedFetch({ [`${BASE}/file-urls/batch`]: () => oversized });

    await expect(processMineruBatch([input], { fetch, maxJsonBytes: 32 }))
      .rejects.toThrow(MineruBatchError);
    expect(oversized.json).not.toHaveBeenCalled();
  });

  it("caps ZIP downloads while streaming instead of calling arrayBuffer", async () => {
    const input = file("large.pdf", "large");
    const { fetch, handlers, resultUrls } = officialBatch([input], ["unused"]);
    const response = new Response(new Uint8Array(33) as BodyInit);
    response.arrayBuffer = vi.fn(() => { throw new Error("unbounded arrayBuffer() must not run"); });
    handlers[resultUrls[0]] = () => response;

    await expect(processMineruBatch([input], { fetch, maxZipBytes: 32, maxPolls: 1 }))
      .rejects.toThrow(MineruBatchError);
    expect(response.arrayBuffer).not.toHaveBeenCalled();
  });

  it.each([
    { "nested/full.md": "nested" },
    { "./full.md": "variant" },
    { "FULL.md": "variant" },
    { "other.md": "missing" },
    { "full.md": "   " },
  ] as Record<string, string>[])("rejects unsafe or unusable full.md: %s", async (entries) => {
    const input = file("archive.pdf", "archive");
    const { fetch, handlers, resultUrls } = officialBatch([input], ["unused"]);
    handlers[resultUrls[0]] = () => zipResponse(zipBuf(entries));
    await expect(processMineruBatch([input], { fetch, maxPolls: 1 }))
      .rejects.toThrow(MineruBatchError);
  });

  it("rejects decompressed full.md above the configured cap", async () => {
    const input = file("bomb.pdf", "bomb");
    const { fetch, handlers, resultUrls } = officialBatch([input], ["unused"]);
    handlers[resultUrls[0]] = () => zipResponse(zipBuf({ "full.md": "x".repeat(65) }));
    await expect(processMineruBatch([input], { fetch, maxMarkdownBytes: 64, maxPolls: 1 }))
      .rejects.toThrow(MineruBatchError);
  });

  it("accepts Markdown above the former 100 KB cap and keeps a 5 MB safety limit", async () => {
    const input = file("large.pdf", "large");
    const markdown = "x".repeat(100_001);
    const { fetch, handlers, resultUrls } = officialBatch([input], ["unused"]);
    handlers[resultUrls[0]] = () => zipResponse(zipBuf({ "full.md": markdown }));

    await expect(processMineruBatch([input], { fetch, maxPolls: 1 }))
      .resolves.toEqual([markdown]);
    expect(MAX_MINERU_MARKDOWN_BYTES).toBe(5 * 1024 * 1024);
  });

  it.each([
    "https://localhost/full.zip",
    "https://169.254.169.254/full.zip",
    "https://100.64.0.1/full.zip",
    "https://[fd00::1]/full.zip",
  ])("rejects unsafe result URL %s", async (resultUrl) => {
    const input = file("url.pdf", "url");
    const { fetch } = officialBatch([input], ["unused"], { resultUrls: [resultUrl] });
    await expect(processMineruBatch([input], { fetch, maxPolls: 1 }))
      .rejects.toThrow(MineruBatchError);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === resultUrl)).toBe(false);
  });

  it("rejects a lookalike cdn-mineru hostname", async () => {
    const input = file("lookalike.pdf", "lookalike");
    const resultUrl = "https://cdn-mineru.evil.example/full.zip";
    const { fetch } = officialBatch([input], ["unused"], { resultUrls: [resultUrl] });
    await expect(processMineruBatch([input], { fetch, maxPolls: 1 }))
      .rejects.toThrow(MineruBatchError);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === resultUrl)).toBe(false);
  });

  it("accepts a representative MinerU CDN HTTPS result URL", async () => {
    const input = file("valid.pdf", "valid");
    const { fetch } = officialBatch([input], ["valid markdown"]);
    await expect(processMineruBatch([input], { fetch, maxPolls: 1 }))
      .resolves.toEqual(["valid markdown"]);
  });
});
