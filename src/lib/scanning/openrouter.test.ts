import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  extractScanningDocuments,
  organizeScanningDocuments,
  parseScanningDocument,
  parseScanningDocuments,
  parseScanningOrganization,
  ScanningProviderError,
} from "./openrouter";
import type { ScanningUpload } from "./types";

const originalKey = process.env.OPENROUTER_API_KEY;

function providerResponse(content: unknown, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function rawDocument(): Record<string, unknown> {
  return {
    documentType: "Rechnung",
    date: "2026-02-30",
    issuer: "Muster GmbH",
    documentNumber: "R-7",
    description: "Leistung",
    category: "Büro",
    currency: "eur",
    net: "1,20",
    tax: "ungelesen",
    gross: "1.44",
    vatBreakdown: [],
    warnings: ["Steuer nicht eindeutig"],
    confidence: "medium",
  };
}

describe("OpenRouter scanning adapter", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  });

  it("normalizes structured values without estimating invalid fields", () => {
    const parsed = parseScanningDocument(rawDocument(), { id: "file-1", name: "Beleg.pdf" });
    expect(parsed).toMatchObject({
      documentId: "file-1:1",
      fileId: "file-1",
      date: null,
      currency: "EUR",
      net: "1.20",
      tax: null,
      gross: "1.44",
    });
  });

  it("sends private PDFs inline as Base64 to Gemini with a strict JSON schema", async () => {
    vi.mocked(fetch).mockResolvedValue(providerResponse({ documents: [rawDocument(), {
      ...rawDocument(),
      documentNumber: "R-8",
    }] }));
    const upload: ScanningUpload = {
      id: "file-1",
      name: "Beleg.pdf",
      kind: "pdf",
      mimeType: "application/pdf",
      sizeBytes: 5,
      sha256: "hash",
      bytes: new TextEncoder().encode("%PDF-"),
    };

    await expect(extractScanningDocuments(upload)).resolves.toMatchObject([
      { documentId: "file-1:1", fileId: "file-1", issuer: "Muster GmbH", documentNumber: "R-7" },
      { documentId: "file-1:2", fileId: "file-1", issuer: "Muster GmbH", documentNumber: "R-8" },
    ]);
    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.model).toBe("google/gemini-3.5-flash");
    expect(JSON.stringify(body)).toContain("data:application/pdf;base64,");
    expect(JSON.stringify(body)).toContain('"strict":true');
    expect(JSON.stringify(body)).not.toContain('"file-parser"');
    expect(JSON.stringify(body)).toContain("Untersuche bei PDFs ausnahmslos alle Seiten");
    expect(JSON.stringify(body)).toContain("jeden eigenständigen Beleg genau einen Eintrag");
    expect(body.reasoning).toEqual({ effort: "minimal", exclude: true });
    expect(JSON.stringify(body)).toContain("fremdsprachige Sachtexte sinngemäß und sachlich ins Deutsche");
    expect(JSON.stringify(body)).toContain("Belegnummern, Aktenzeichen, Artikelnummern, Beträge");
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("https://openrouter.ai/api/v1/chat/completions");
  });

  it("falls back to validated JSON mode when a provider rejects the strict schema", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("invalid schema", { status: 400 }))
      .mockResolvedValueOnce(providerResponse({ documents: [rawDocument()] }));
    const upload: ScanningUpload = {
      id: "fallback-file",
      name: "Sammel.pdf",
      kind: "pdf",
      mimeType: "application/pdf",
      sizeBytes: 5,
      sha256: "hash",
      bytes: new TextEncoder().encode("%PDF-"),
    };

    await expect(extractScanningDocuments(upload)).resolves.toMatchObject([
      { documentId: "fallback-file:1", documentNumber: "R-7" },
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
    const fallbackBody = JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body)) as Record<string, unknown>;
    expect(fallbackBody.response_format).toBeUndefined();
    expect(fallbackBody.plugins).toBeUndefined();
    expect(JSON.stringify(fallbackBody)).toContain("neue seitenweise Prüfung der gesamten Datei");
  });

  it("also retries when the strict response contains unusable structured data", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(providerResponse({ documents: [] }))
      .mockResolvedValueOnce(providerResponse({ documents: [rawDocument()] }));
    const upload: ScanningUpload = {
      id: "empty-first-result",
      name: "Sammel.pdf",
      kind: "pdf",
      mimeType: "application/pdf",
      sizeBytes: 5,
      sha256: "hash",
      bytes: new TextEncoder().encode("%PDF-"),
    };

    await expect(extractScanningDocuments(upload)).resolves.toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("accepts Gemini document arrays, aliases and single legacy objects", () => {
    const upload = { id: "shape-file", name: "Formen.pdf" };
    expect(parseScanningDocuments([rawDocument(), rawDocument()], upload)).toHaveLength(2);
    expect(parseScanningDocuments({ invoices: [rawDocument(), rawDocument()] }, upload)).toHaveLength(2);
    expect(parseScanningDocuments(rawDocument(), upload)).toHaveLength(1);
  });

  it("reads already parsed structured output returned by the provider", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { parsed: { documents: [rawDocument()] }, content: null } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const upload: ScanningUpload = {
      id: "parsed-file",
      name: "Parsed.pdf",
      kind: "pdf",
      mimeType: "application/pdf",
      sizeBytes: 5,
      sha256: "hash",
      bytes: new TextEncoder().encode("%PDF-"),
    };

    await expect(extractScanningDocuments(upload)).resolves.toMatchObject([
      { documentId: "parsed-file:1", documentNumber: "R-7" },
    ]);
  });

  it("extracts JSON from explanatory text and fenced provider content", async () => {
    const embedded = `Die Auswertung ist abgeschlossen.\n\n\`\`\`json\n${JSON.stringify({ documents: [rawDocument()] })}\n\`\`\``;
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: embedded } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const upload: ScanningUpload = {
      id: "fenced-file",
      name: "Fenced.pdf",
      kind: "pdf",
      mimeType: "application/pdf",
      sizeBytes: 5,
      sha256: "hash",
      bytes: new TextEncoder().encode("%PDF-"),
    };

    await expect(extractScanningDocuments(upload)).resolves.toMatchObject([
      { documentId: "fenced-file:1", documentNumber: "R-7" },
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("accepts structured documents returned directly as content parts", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: [rawDocument(), { ...rawDocument(), documentNumber: "R-8" }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const upload: ScanningUpload = {
      id: "parts-file",
      name: "Parts.pdf",
      kind: "pdf",
      mimeType: "application/pdf",
      sizeBytes: 5,
      sha256: "hash",
      bytes: new TextEncoder().encode("%PDF-"),
    };

    await expect(extractScanningDocuments(upload)).resolves.toMatchObject([
      { documentId: "parts-file:1", documentNumber: "R-7" },
      { documentId: "parts-file:2", documentNumber: "R-8" },
    ]);
  });

  it("uses only known document ids when harmonizing categories", async () => {
    const document = parseScanningDocument(rawDocument(), { id: "file-1", name: "Beleg.pdf" });
    vi.mocked(fetch).mockResolvedValue(providerResponse({
      summary: "Ein Beleg wurde erfasst.",
      categories: [
        { documentId: "file-1:1", category: "Bürobedarf" },
        { documentId: "foreign", category: "Ignorieren" },
      ],
    }));

    await expect(organizeScanningDocuments([document])).resolves.toEqual({
      summary: "Ein Beleg wurde erfasst.",
      categories: [{ documentId: "file-1:1", category: "Bürobedarf" }],
    });
    const organizationBody = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(JSON.stringify(organizationBody)).toContain("alle von dir formulierten Texte müssen auf Deutsch sein");
    expect(JSON.stringify(organizationBody)).toContain("Eigennamen, Aussteller, Belegnummern");
    expect(parseScanningOrganization({ summary: "x", categories: [] }, [document])).toEqual({ summary: "x", categories: [] });
  });

  it("rejects an empty multi-document result", () => {
    expect(() => parseScanningDocuments({ documents: [] }, { id: "file-1", name: "Leer.pdf" }))
      .toThrowError("Die Datei lieferte keine verwertbaren Belege.");
  });

  it("treats missing configuration and provider authentication as fatal", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const upload = {
      id: "file-1",
      name: "Bild.png",
      kind: "image",
      mimeType: "image/png",
      sizeBytes: 8,
      sha256: "hash",
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    } satisfies ScanningUpload;
    await expect(extractScanningDocuments(upload)).rejects.toMatchObject({ fatal: true, status: 503 });

    process.env.OPENROUTER_API_KEY = "test-key";
    vi.mocked(fetch).mockResolvedValue(new Response("unauthorized", { status: 401 }));
    const failure = extractScanningDocuments(upload);
    await expect(failure).rejects.toBeInstanceOf(ScanningProviderError);
    await expect(failure).rejects.toMatchObject({ fatal: true, status: 503 });
  });
});
