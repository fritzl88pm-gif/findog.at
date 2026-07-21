import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MineruFileInput } from "./mineru-cloud";
import {
  DOCUMENT_FALLBACK_PROMPT,
  DocumentFallbackError,
  extractDocumentsWithConfiguredModel,
} from "./document-fallback";

const originalKey = process.env.OPENROUTER_API_KEY;

function document(name = "beleg.pdf", kind: MineruFileInput["kind"] = "pdf"): MineruFileInput {
  return {
    kind,
    name,
    mimeType: kind === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: 4,
    sha256: `hash-${name}`,
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
  };
}

function providerResponse(content: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    headers: { "Content-Type": "application/json" },
  });
}

describe("configured Gemini document fallback", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "fallback-test-key";
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  });

  it("uses the configured model and sends the document as a private base64 file", async () => {
    const fetch = vi.fn().mockResolvedValue(providerResponse("# Vollständiger Inhalt"));

    const result = await extractDocumentsWithConfiguredModel([document()], {
      model: "google/gemini-3.5-flash",
      fetch,
    });

    expect(result).toEqual(["# Vollständiger Inhalt"]);
    const request = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(String(request?.[1]?.body)) as Record<string, unknown>;
    expect(body.model).toBe("google/gemini-3.5-flash");
    expect(body.max_tokens).toBe(20_000);
    expect(body.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "system", content: DOCUMENT_FALLBACK_PROMPT }),
    ]));
    expect(JSON.stringify(body)).toContain("data:application/pdf;base64,JVBERg==");
    expect(JSON.stringify(body)).not.toContain("fallback-test-key");
    const headers = request?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer fallback-test-key");
  });

  it("preserves input order for multiple PDF and Office documents", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(providerResponse("First"))
      .mockResolvedValueOnce(providerResponse("Second"));

    await expect(extractDocumentsWithConfiguredModel(
      [document("first.pdf"), document("second.docx", "docx")],
      { model: "google/gemini-3.5-flash", fetch },
    )).resolves.toEqual(["First", "Second"]);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))))
      .toContain("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });

  it("accepts multipart text responses and strips hidden thinking", async () => {
    const fetch = vi.fn().mockResolvedValue(providerResponse([
      { type: "text", text: "<thinking>work notes</thinking>" },
      { type: "text", text: "Document content" },
    ]));

    const result = await extractDocumentsWithConfiguredModel([document()], {
      model: "google/gemini-3.5-flash",
      fetch,
    });
    expect(result).toEqual(["Document content"]);
  });

  it("rejects missing configuration, invalid models, provider errors and empty output", async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(extractDocumentsWithConfiguredModel([document()], {
      model: "google/gemini-3.5-flash",
      fetch: vi.fn(),
    })).rejects.toBeInstanceOf(DocumentFallbackError);

    process.env.OPENROUTER_API_KEY = "fallback-test-key";
    await expect(extractDocumentsWithConfiguredModel([document()], {
      model: "invalid model",
      fetch: vi.fn(),
    })).rejects.toMatchObject({ status: 503 });

    await expect(extractDocumentsWithConfiguredModel([document()], {
      model: "google/gemini-3.5-flash",
      fetch: vi.fn().mockResolvedValue(new Response("busy", { status: 429 })),
    })).rejects.toMatchObject({ status: 429 });

    await expect(extractDocumentsWithConfiguredModel([document()], {
      model: "google/gemini-3.5-flash",
      fetch: vi.fn().mockResolvedValue(providerResponse("   ")),
    })).rejects.toThrow("keinen Dokumentinhalt");
  });

  it("caps response bytes before parsing and never exposes provider details", async () => {
    const response = new Response("x".repeat(33), { status: 200 });
    response.text = vi.fn(() => { throw new Error("must not read an unbounded response"); });
    const fetch = vi.fn().mockResolvedValue(response);

    let error: unknown;
    try {
      await extractDocumentsWithConfiguredModel([document()], {
        model: "google/gemini-3.5-flash",
        fetch,
        maxResponseBytes: 32,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(DocumentFallbackError);
    expect((error as Error).message).not.toContain("fallback-test-key");
    expect(response.text).not.toHaveBeenCalled();
  });
});
