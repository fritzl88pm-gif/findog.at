import { describe, expect, it, vi } from "vitest";

import type { BotApi } from "./bot-api";
import { createAttachmentPreprocessor } from "./attachment-preprocessor";

describe("createAttachmentPreprocessor", () => {
  it("accepts an extensionless Telegram PDF using its supported MIME and signature", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7\ncontent");
    const botApi = {
      getFile: vi.fn().mockResolvedValue({
        file_id: "telegram-file",
        file_unique_id: "unique-file",
        file_size: bytes.length,
        file_path: "documents/file_1",
      }),
      downloadFile: vi.fn().mockResolvedValue(bytes),
    } as unknown as BotApi;
    const document = vi.fn().mockResolvedValue(["Extracted PDF text"]);
    const preprocess = createAttachmentPreprocessor({
      gemini: vi.fn(),
      document,
    });

    const result = await preprocess(
      botApi,
      "telegram-file",
      "rechnung_2026",
      "application/pdf",
      bytes.length,
      "Prüfe die Rechnung",
    );

    expect(result.metadata.name).toBe("rechnung_2026.pdf");
    expect(result.metadata.mime_type).toBe("application/pdf");
    expect(result.upstreamQuery).toContain("Extracted PDF text");
    expect(document).toHaveBeenCalledOnce();
  });

  it("routes documents through the shared provider while preserving Telegram's abort signal", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7\ncontent");
    const botApi = {
      getFile: vi.fn().mockResolvedValue({
        file_id: "telegram-file",
        file_unique_id: "unique-file",
        file_size: bytes.length,
        file_path: "documents/file_1",
      }),
      downloadFile: vi.fn().mockResolvedValue(bytes),
    } as unknown as BotApi;
    const document = vi.fn().mockResolvedValue(["Shared OCR result"]);
    const signal = new AbortController().signal;

    const result = await createAttachmentPreprocessor({
      gemini: vi.fn(),
      document,
    })(
      botApi,
      "telegram-file",
      "invoice.pdf",
      "application/pdf",
      bytes.length,
      "Prüfen",
      signal,
    );

    expect(document).toHaveBeenCalledWith([
      expect.objectContaining({ name: "invoice.pdf", kind: "pdf" }),
    ], { signal });
    expect(result.upstreamQuery).toContain("Shared OCR result");
  });

  it("continues to route image attachments through the image provider", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
    const botApi = {
      getFile: vi.fn().mockResolvedValue({
        file_id: "telegram-image",
        file_unique_id: "unique-image",
        file_size: bytes.length,
        file_path: "photos/file_1",
      }),
      downloadFile: vi.fn().mockResolvedValue(bytes),
    } as unknown as BotApi;
    const gemini = vi.fn().mockResolvedValue("Bildbeschreibung");
    const document = vi.fn();

    const result = await createAttachmentPreprocessor({
      gemini,
      document,
    })(
      botApi,
      "telegram-image",
      "foto.jpg",
      "image/jpeg",
      bytes.length,
      "Was ist zu sehen?",
    );

    expect(gemini).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/jpeg;base64,/));
    expect(document).not.toHaveBeenCalled();
    expect(result.upstreamQuery).toContain("Bildbeschreibung");
  });
});