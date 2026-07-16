import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDeadline } from "./deadline";
import {
  MAX_PDF_CONTEXT_CHARS,
  OPENROUTER_CONTEXT_TIMEOUT_MS,
  extractImageContext,
  extractPdfContext,
} from "./pdf-context";
import { UserVisibleError } from "./errors";

describe("extractPdfContext", () => {
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;

  it("allows Gemini document and image extraction up to 270 seconds", () => {
    expect(OPENROUTER_CONTEXT_TIMEOUT_MS).toBe(270_000);
  });

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "openrouter-test-key";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
    vi.unstubAllGlobals();
  });

  it("sends PDFs to the fixed OpenRouter Gemini model as a data URL", async () => {
    const deadline = createDeadline(240_000);
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "## Seite 1\nExtrahierter Kontext",
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const context = await extractPdfContext({
      filename: "Bescheid.pdf",
      mimeType: "application/pdf",
      bytes: new Uint8Array([37, 80, 68, 70]),
      deadline,
    });

    expect(context).toBe("## Seite 1\nExtrahierter Kontext");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer openrouter-test-key",
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as {
      model: string;
      messages: Array<{
        content: Array<{ type: string; text?: string; file?: { filename: string; file_data: string } }>;
      }>;
    };
    expect(body.model).toBe("google/gemini-3.5-flash");
    expect(body.messages[0]?.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Beantworte keine rechtliche Frage"),
    });
    expect(body.messages[0]?.content[1]).toEqual({
      type: "file",
      file: {
        filename: "Bescheid.pdf",
        file_data: "data:application/pdf;base64,JVBERg==",
      },
    });
    deadline.dispose();
  });

  it("sends images to the same fixed OpenRouter Gemini context model", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "Bildtext und sichtbarer Kontext",
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const context = await extractImageContext({
      filename: "Beleg.png",
      mimeType: "image/png",
      bytes: new Uint8Array([137, 80, 78, 71]),
    });

    expect(context).toBe("Bildtext und sichtbarer Kontext");
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as {
      model: string;
      messages: Array<{
        content: Array<{ type: string; text?: string; image_url?: { url: string } }>;
      }>;
    };
    expect(body.model).toBe("google/gemini-3.5-flash");
    expect(body.messages[0]?.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Extrahiere den vollständigen Kontext aus dem hochgeladenen Bild"),
    });
    expect(body.messages[0]?.content[1]).toEqual({
      type: "image_url",
      image_url: {
        url: "data:image/png;base64,iVBORw==",
      },
    });
  });

  it("extracts text from content arrays and bounds the returned context", async () => {
    const fetchMock = vi.mocked(fetch);
    const tooLong = "x".repeat(MAX_PDF_CONTEXT_CHARS + 500);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: [
                  { type: "text", text: tooLong },
                  { type: "text", text: "nachlauf" },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const context = await extractPdfContext({
      filename: "scan.pdf",
      mimeType: "application/pdf",
      bytes: new Uint8Array([1, 2, 3]),
    });

    expect(context.length).toBeLessThan(MAX_PDF_CONTEXT_CHARS + 120);
    expect(context).toContain("[PDF-Kontext gekürzt");
  });

  it("requires the server-side OpenRouter API key", async () => {
    delete process.env.OPENROUTER_API_KEY;

    await expect(
      extractPdfContext({
        filename: "scan.pdf",
        mimeType: "application/pdf",
        bytes: new Uint8Array([1, 2, 3]),
      }),
    ).rejects.toThrow(UserVisibleError);
    await expect(
      extractPdfContext({
        filename: "scan.pdf",
        mimeType: "application/pdf",
        bytes: new Uint8Array([1, 2, 3]),
      }),
    ).rejects.toThrow("PDF-Auswertung ist serverseitig nicht konfiguriert");
  });
});
