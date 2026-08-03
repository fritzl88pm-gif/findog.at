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
    const mineru = vi.fn().mockResolvedValue(["Extracted PDF text"]);
    const preprocess = createAttachmentPreprocessor({
      mineru,
      gemini: vi.fn(),
      documentFallback: vi.fn(),
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
    expect(mineru).toHaveBeenCalledOnce();
  });
});