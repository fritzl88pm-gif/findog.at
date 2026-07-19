import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import {
  extractScanningDocuments,
  organizeScanningDocuments,
  ScanningProviderError,
} from "@/lib/scanning/openrouter";
import { parseScanningStreamLine } from "@/lib/scanning/stream";
import type { ScanningDocument, ScanningUpload } from "@/lib/scanning/types";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { POST } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/scanning/openrouter", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/scanning/openrouter")>();
  return {
    ...original,
    extractScanningDocuments: vi.fn(),
    organizeScanningDocuments: vi.fn(),
  };
});

function pngBytes(marker = 0): Uint8Array<ArrayBuffer> {
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, marker]);
}

function pdfBytes(marker = 0): Uint8Array<ArrayBuffer> {
  return Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, marker]);
}

function multipart(files: Array<{ field: string; file: File }>, userToken = "token"): Request {
  const body = new FormData();
  for (const item of files) body.append(item.field, item.file, item.file.name);
  return new Request("https://findog.at/api/scanning", {
    method: "POST",
    headers: { Authorization: `Bearer ${userToken}`, "Sec-Fetch-Site": "same-origin" },
    body,
  });
}

function image(name: string, marker = 0): File {
  return new File([pngBytes(marker)], name, { type: "image/png" });
}

function pdf(name: string, marker = 0): File {
  return new File([pdfBytes(marker)], name, { type: "application/pdf" });
}

function extracted(upload: ScanningUpload): ScanningDocument {
  return {
    documentId: `${upload.id}:1`,
    fileId: upload.id,
    fileName: upload.name,
    documentType: "Rechnung",
    date: "2026-07-19",
    issuer: "Muster GmbH",
    documentNumber: `R-${upload.name}`,
    description: "Leistung",
    category: "Büro",
    currency: "EUR",
    net: "10.00",
    tax: "2.00",
    gross: "12.00",
    vatBreakdown: [],
    warnings: [],
    confidence: "high",
  };
}

async function events(response: Response) {
  return (await response.text()).split("\n").map(parseScanningStreamLine).filter(Boolean);
}

describe("POST /api/scanning", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ auth: {} } as never);
    vi.mocked(authenticateSupabaseRequest).mockImplementation(async (request) => ({
      id: request.headers.get("authorization")?.replace("Bearer ", "") || "user",
    }));
    vi.mocked(extractScanningDocuments).mockImplementation(async (upload) => [extracted(upload)]);
    vi.mocked(organizeScanningDocuments).mockImplementation(async (documents) => ({
      summary: `${documents.length} Dokumente ausgewertet.`,
      categories: documents.map((document) => ({ documentId: document.documentId, category: document.category })),
    }));
  });

  it("streams a report for five images and five PDFs without a persistence client call", async () => {
    const files = [
      ...Array.from({ length: 5 }, (_, index) => ({ field: "image", file: image(`bild-${index}.png`, index) })),
      ...Array.from({ length: 5 }, (_, index) => ({ field: "pdf", file: pdf(`beleg-${index}.pdf`, index) })),
    ];
    const response = await POST(multipart(files, "ten-files-user"));
    const streamed = await events(response);
    const final = streamed.find((event) => event?.type === "final");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(extractScanningDocuments).toHaveBeenCalledTimes(10);
    expect(final).toMatchObject({ type: "final", model: "google/gemini-3.5-flash" });
    if (final?.type === "final") expect(final.files).toHaveLength(10);
    expect(getSupabaseServerClient).toHaveBeenCalledTimes(1);
  });

  it("includes every independent invoice found across a multi-page PDF", async () => {
    vi.mocked(extractScanningDocuments).mockImplementationOnce(async (upload) => [
      { ...extracted(upload), documentId: `${upload.id}:1`, documentNumber: "RE-100", date: "2026-01-10" },
      { ...extracted(upload), documentId: `${upload.id}:2`, documentNumber: "RE-200", date: "2026-02-10" },
      { ...extracted(upload), documentId: `${upload.id}:3`, documentNumber: "RE-300", date: "2026-03-10" },
    ]);
    const response = await POST(multipart([{ field: "pdf", file: pdf("Sammelrechnungen.pdf") }], "multipage-user"));
    const final = (await events(response)).find((event) => event?.type === "final");

    expect(final).toMatchObject({
      type: "final",
      report: expect.stringContaining("RE-100"),
    });
    if (final?.type === "final") {
      expect(final.report).toContain("RE-200");
      expect(final.report).toContain("RE-300");
      expect(final.report).toContain("Netto 30,00, USt 6,00, Brutto 36,00");
    }
    expect(organizeScanningDocuments).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ documentId: expect.stringContaining(":1") }),
        expect.objectContaining({ documentId: expect.stringContaining(":2") }),
        expect.objectContaining({ documentId: expect.stringContaining(":3") }),
      ]),
      expect.any(AbortSignal),
    );
  });

  it("rejects empty batches, a sixth file and unknown form fields", async () => {
    const empty = await POST(multipart([], "empty-user"));
    expect(empty.status).toBe(400);

    const six = await POST(multipart(
      Array.from({ length: 6 }, (_, index) => ({ field: "image", file: image(`bild-${index}.png`, index) })),
      "six-user",
    ));
    expect(six.status).toBe(400);

    const unknown = await POST(multipart([{ field: "attachment", file: pdf("beleg.pdf") }], "unknown-user"));
    expect(unknown.status).toBe(400);
    expect(extractScanningDocuments).not.toHaveBeenCalled();
  });

  it("accepts files exactly at 5 and 10 MiB and rejects one byte above", async () => {
    const exactImage = new Uint8Array(5 * 1_024 * 1_024);
    exactImage.set(pngBytes());
    const exactPdf = new Uint8Array(10 * 1_024 * 1_024);
    exactPdf.set(pdfBytes());
    const accepted = await POST(multipart([
      { field: "image", file: new File([exactImage], "max.png", { type: "image/png" }) },
      { field: "pdf", file: new File([exactPdf], "max.pdf", { type: "application/pdf" }) },
    ], "exact-size-user"));
    expect(accepted.status).toBe(200);
    expect((await events(accepted)).some((event) => event?.type === "final")).toBe(true);

    const tooLarge = new Uint8Array(5 * 1_024 * 1_024 + 1);
    tooLarge.set(pngBytes());
    const rejected = await POST(multipart([
      { field: "image", file: new File([tooLarge], "too-large.png", { type: "image/png" }) },
    ], "large-user"));
    expect(rejected.status).toBe(413);
  });

  it("rejects MIME/signature mismatches and cross-site submissions", async () => {
    const mismatch = await POST(multipart([
      { field: "pdf", file: new File([pngBytes()], "fake.pdf", { type: "application/pdf" }) },
    ], "mismatch-user"));
    expect(mismatch.status).toBe(400);

    const crossSite = multipart([{ field: "pdf", file: pdf("beleg.pdf") }], "cross-user");
    const headers = new Headers(crossSite.headers);
    headers.set("Sec-Fetch-Site", "cross-site");
    const authCalls = vi.mocked(authenticateSupabaseRequest).mock.calls.length;
    const blocked = await POST(new Request(crossSite, { headers }));
    expect(blocked.status).toBe(403);
    expect(authenticateSupabaseRequest).toHaveBeenCalledTimes(authCalls);
  });

  it("evaluates exact duplicates once and marks the copy", async () => {
    const response = await POST(multipart([
      { field: "image", file: image("Original.png", 4) },
      { field: "image", file: image("Kopie.png", 4) },
    ], "duplicate-user"));
    const final = (await events(response)).find((event) => event?.type === "final");

    expect(extractScanningDocuments).toHaveBeenCalledTimes(1);
    expect(final).toMatchObject({
      type: "final",
      files: expect.arrayContaining([expect.objectContaining({ name: "Kopie.png", status: "duplicate" })]),
    });
  });

  it("keeps a partial result and falls back if category organization fails", async () => {
    vi.mocked(extractScanningDocuments)
      .mockImplementationOnce(async (upload) => [extracted(upload)])
      .mockRejectedValueOnce(new ScanningProviderError("Datei nicht lesbar", 502));
    vi.mocked(organizeScanningDocuments).mockRejectedValueOnce(new ScanningProviderError("Ausgelastet", 429));
    const response = await POST(multipart([
      { field: "pdf", file: pdf("gut.pdf", 1) },
      { field: "pdf", file: pdf("kaputt.pdf", 2) },
    ], "partial-user"));
    const final = (await events(response)).find((event) => event?.type === "final");

    expect(final).toMatchObject({
      type: "final",
      report: expect.stringContaining("Nicht ausgewertete Dateien"),
      files: expect.arrayContaining([expect.objectContaining({ name: "kaputt.pdf", status: "failed" })]),
    });
  });

  it("emits a friendly error for complete and fatal provider failures", async () => {
    vi.mocked(extractScanningDocuments).mockRejectedValueOnce(new ScanningProviderError("Nicht lesbar", 502));
    const completeFailure = await POST(multipart([{ field: "pdf", file: pdf("a.pdf") }], "failed-user"));
    expect(await events(completeFailure)).toContainEqual({ type: "error", error: "Nicht lesbar" });

    vi.mocked(extractScanningDocuments).mockRejectedValueOnce(
      new ScanningProviderError("Scanning ist serverseitig nicht konfiguriert.", 503, true),
    );
    const fatalFailure = await POST(multipart([{ field: "pdf", file: pdf("b.pdf") }], "fatal-user"));
    expect(await events(fatalFailure)).toContainEqual({
      type: "error",
      error: "Scanning ist serverseitig nicht konfiguriert.",
    });
  });

  it("enforces five batches per user in five minutes", async () => {
    for (let index = 0; index < 5; index += 1) {
      const response = await POST(multipart([{ field: "pdf", file: pdf(`beleg-${index}.pdf`, index) }], "rate-user"));
      expect(response.status).toBe(200);
      await response.text();
    }
    const blocked = await POST(multipart([{ field: "pdf", file: pdf("sechs.pdf", 9) }], "rate-user"));
    expect(blocked.status).toBe(429);
  });
});
