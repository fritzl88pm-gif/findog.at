import { describe, expect, it, vi } from "vitest";

import type { MineruFileInput } from "./mineru-cloud";
import {
  createConfiguredDocumentProvider,
  extractDocumentsWithPipeline,
} from "./document-pipeline";

const files: MineruFileInput[] = [
  {
    kind: "pdf",
    name: "first.pdf",
    mimeType: "application/pdf",
    sizeBytes: 4,
    sha256: "first",
    bytes: new Uint8Array([1]),
  },
  {
    kind: "docx",
    name: "second.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: 4,
    sha256: "second",
    bytes: new Uint8Array([2]),
  },
];

describe("document provider dispatch", () => {
  it("uses OmniRoute Luna exactly once and never MinerU in Luna-only mode", async () => {
    const mineruProvider = vi.fn();
    const omnirouteProvider = vi.fn().mockResolvedValue(["First", "Second"]);
    const signal = new AbortController().signal;

    await expect(extractDocumentsWithPipeline(files, {
      pipeline: "omniroute_luna_only",
      mineruProvider,
      omnirouteProvider,
      signal,
    })).resolves.toEqual(["First", "Second"]);

    expect(mineruProvider).not.toHaveBeenCalled();
    expect(omnirouteProvider).toHaveBeenCalledTimes(1);
    expect(omnirouteProvider).toHaveBeenCalledWith(files, { signal });
  });

  it("keeps MinerU as primary and calls OmniRoute Luna only after MinerU throws", async () => {
    const mineruProvider = vi.fn()
      .mockRejectedValueOnce(new Error("MinerU unavailable"))
      .mockResolvedValueOnce(["MinerU result"]);
    const omnirouteProvider = vi.fn().mockResolvedValue(["Fallback result"]);

    await expect(extractDocumentsWithPipeline([files[0]], {
      pipeline: "mineru_with_omniroute_luna_fallback",
      mineruProvider,
      omnirouteProvider,
    })).resolves.toEqual(["Fallback result"]);

    expect(mineruProvider).toHaveBeenCalledTimes(1);
    expect(omnirouteProvider).toHaveBeenCalledTimes(1);
    expect(omnirouteProvider).toHaveBeenCalledWith([files[0]], {});

    await expect(extractDocumentsWithPipeline([files[0]], {
      pipeline: "mineru_with_omniroute_luna_fallback",
      mineruProvider,
      omnirouteProvider,
    })).resolves.toEqual(["MinerU result"]);
    expect(omnirouteProvider).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid runtime pipeline before selecting a provider", async () => {
    const mineruProvider = vi.fn();
    const omnirouteProvider = vi.fn();

    await expect(extractDocumentsWithPipeline(files, {
      pipeline: "mineru_only",
      mineruProvider,
      omnirouteProvider,
    })).rejects.toThrow(/Dokument-Pipeline/i);

    expect(mineruProvider).not.toHaveBeenCalled();
    expect(omnirouteProvider).not.toHaveBeenCalled();
  });
});

describe("configured document provider", () => {
  it("reads settings for every document batch and does not pass the OpenRouter model to document OCR", async () => {
    const getSettings = vi.fn()
      .mockResolvedValueOnce({
        documentPipeline: "omniroute_luna_only",
        modelId: "vendor/model-one",
      })
      .mockResolvedValueOnce({
        documentPipeline: "mineru_with_omniroute_luna_fallback",
        modelId: "vendor/model-two",
      });
    const mineruProvider = vi.fn().mockResolvedValue(["MinerU result"]);
    const omnirouteProvider = vi.fn().mockResolvedValue(["OmniRoute result"]);
    const provider = createConfiguredDocumentProvider({
      getSettings,
      mineruProvider,
      omnirouteProvider,
    });
    const signal = new AbortController().signal;

    await expect(provider(files, { signal })).resolves.toEqual(["OmniRoute result"]);
    await expect(provider([files[0]])).resolves.toEqual(["MinerU result"]);

    expect(getSettings).toHaveBeenCalledTimes(2);
    expect(omnirouteProvider).toHaveBeenCalledWith(files, { signal });
    expect(omnirouteProvider).not.toHaveBeenCalledWith(files, expect.objectContaining({ model: expect.any(String) }));
    expect(mineruProvider).toHaveBeenCalledWith([files[0]], { signal: undefined });
  });
});
