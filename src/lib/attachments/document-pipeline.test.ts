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
  it("uses OpenRouter exactly once and never MinerU in openrouter-only mode", async () => {
    const mineruProvider = vi.fn();
    const openrouterProvider = vi.fn().mockResolvedValue(["First", "Second"]);
    const signal = new AbortController().signal;

    await expect(extractDocumentsWithPipeline(files, {
      pipeline: "openrouter_only",
      mineruProvider,
      openrouterProvider,
      signal,
    })).resolves.toEqual(["First", "Second"]);

    expect(mineruProvider).not.toHaveBeenCalled();
    expect(openrouterProvider).toHaveBeenCalledTimes(1);
    expect(openrouterProvider).toHaveBeenCalledWith(files, { signal });
  });

  it("keeps MinerU as primary and calls OpenRouter only after MinerU throws", async () => {
    const mineruProvider = vi.fn()
      .mockRejectedValueOnce(new Error("MinerU unavailable"))
      .mockResolvedValueOnce(["MinerU result"]);
    const openrouterProvider = vi.fn().mockResolvedValue(["Fallback result"]);

    await expect(extractDocumentsWithPipeline([files[0]], {
      pipeline: "mineru_with_openrouter_fallback",
      mineruProvider,
      openrouterProvider,
    })).resolves.toEqual(["Fallback result"]);

    expect(mineruProvider).toHaveBeenCalledTimes(1);
    expect(openrouterProvider).toHaveBeenCalledTimes(1);
    expect(openrouterProvider).toHaveBeenCalledWith([files[0]], {});

    await expect(extractDocumentsWithPipeline([files[0]], {
      pipeline: "mineru_with_openrouter_fallback",
      mineruProvider,
      openrouterProvider,
    })).resolves.toEqual(["MinerU result"]);
    expect(openrouterProvider).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid runtime pipeline before selecting a provider", async () => {
    const mineruProvider = vi.fn();
    const openrouterProvider = vi.fn();

    await expect(extractDocumentsWithPipeline(files, {
      pipeline: "mineru_only",
      mineruProvider,
      openrouterProvider,
    })).rejects.toThrow(/Dokument-Pipeline/i);

    expect(mineruProvider).not.toHaveBeenCalled();
    expect(openrouterProvider).not.toHaveBeenCalled();
  });
});

describe("configured document provider", () => {
  it("reads settings for every document batch and passes the current model and signal onward", async () => {
    const getSettings = vi.fn()
      .mockResolvedValueOnce({
        documentPipeline: "openrouter_only",
        modelId: "vendor/model-one",
      })
      .mockResolvedValueOnce({
        documentPipeline: "mineru_with_openrouter_fallback",
        modelId: "vendor/model-two",
      });
    const mineruProvider = vi.fn().mockResolvedValue(["MinerU result"]);
    const openrouterProvider = vi.fn().mockResolvedValue(["OpenRouter result"]);
    const provider = createConfiguredDocumentProvider({
      getSettings,
      mineruProvider,
      openrouterProvider,
    });
    const signal = new AbortController().signal;

    await expect(provider(files, { signal })).resolves.toEqual(["OpenRouter result"]);
    await expect(provider([files[0]])).resolves.toEqual(["MinerU result"]);

    expect(getSettings).toHaveBeenCalledTimes(2);
    expect(openrouterProvider).toHaveBeenCalledWith(files, { model: "vendor/model-one", signal });
    expect(mineruProvider).toHaveBeenCalledWith([files[0]], { signal: undefined });
  });
});
