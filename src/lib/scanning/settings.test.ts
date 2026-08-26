import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_DOCUMENT_PIPELINE,
  DEFAULT_FRED_ATTACHMENT_MODE,
  DEFAULT_SCANNING_MODEL_ID,
  DEFAULT_SCANNING_PROMPT,
  DEFAULT_SCANNING_PROVIDER,
  FRED_ATTACHMENT_MODES,
  SCANNING_PROVIDERS,
  getScanningSettings,
  isValidDocumentPipeline,
  isValidFredAttachmentMode,
  isValidModelId,
  isValidScanningProvider,
  updateScanningSettings,
} from "./settings";

describe("Scanning settings resolver", () => {
  let supabase: ReturnType<typeof createMockSupabase>;

  function createMockSupabase() {
    return {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(),
      upsert: vi.fn().mockReturnThis(),
    };
  }

  beforeEach(() => {
    supabase = createMockSupabase();
  });

  it("returns persisted settings when the scanning_settings table has a row", async () => {
    supabase.maybeSingle.mockResolvedValue({
      data: {
        model_id: "openai/gpt-4o",
        document_pipeline: "omniroute_luna_only",
        fred_attachment_mode: "weknora_native",
        scanning_provider: "openrouter",
        prompt: "Custom prompt text",
        updated_at: "2026-07-19T10:00:00.000Z",
        updated_by: "admin-1",
      },
      error: null,
    });

    const result = await getScanningSettings(supabase as never);
    expect(result).toEqual({
      modelId: "openai/gpt-4o",
      documentPipeline: "omniroute_luna_only",
      fredAttachmentMode: "weknora_native",
      scanningProvider: "openrouter",
      prompt: "Custom prompt text",
      updatedAt: "2026-07-19T10:00:00.000Z",
      updatedBy: "admin-1",
    });
  });

  it("returns safe defaults when the scanning_settings table is empty", async () => {
    supabase.maybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await getScanningSettings(supabase as never);
    expect(result.modelId).toBe(DEFAULT_SCANNING_MODEL_ID);
    expect(result.prompt).toBe(DEFAULT_SCANNING_PROMPT);
    expect(result.documentPipeline).toBe(DEFAULT_DOCUMENT_PIPELINE);
    expect(result.fredAttachmentMode).toBe(DEFAULT_FRED_ATTACHMENT_MODE);
    expect(result.scanningProvider).toBe(DEFAULT_SCANNING_PROVIDER);
    expect(result.updatedBy).toBeNull();
    expect(supabase.select).toHaveBeenCalledWith(
      "model_id,document_pipeline,fred_attachment_mode,scanning_provider,prompt,updated_at,updated_by",
    );
  });

  it("rejects a persisted pipeline outside the database allow-list", async () => {
    supabase.maybeSingle.mockResolvedValue({
      data: {
        model_id: "openai/gpt-4o",
        document_pipeline: "local_ocr",
        fred_attachment_mode: "findog_preprocess",
        prompt: "Custom prompt text",
        updated_at: "2026-07-19T10:00:00.000Z",
        updated_by: "admin-1",
      },
      error: null,
    });

    await expect(getScanningSettings(supabase as never)).rejects.toThrow(
      "Die Scanning-Konfiguration ist ungültig.",
    );
  });

  it("validates document pipeline values", () => {
    expect(isValidDocumentPipeline(DEFAULT_DOCUMENT_PIPELINE)).toBe(true);
    expect(isValidDocumentPipeline("omniroute_luna_only")).toBe(true);
    expect(isValidDocumentPipeline("mineru_with_openrouter_fallback")).toBe(false);
    expect(isValidDocumentPipeline("openrouter_only")).toBe(false);
    expect(isValidDocumentPipeline("local_ocr")).toBe(false);
    expect(isValidDocumentPipeline("")).toBe(false);
  });

  it("rejects a persisted Fred attachment mode outside the database allow-list", async () => {
    supabase.maybeSingle.mockResolvedValue({
      data: {
        model_id: "openai/gpt-4o",
        document_pipeline: "omniroute_luna_only",
        fred_attachment_mode: "browser_choice",
        prompt: "Custom prompt text",
        updated_at: "2026-07-19T10:00:00.000Z",
        updated_by: "admin-1",
      },
      error: null,
    });

    await expect(getScanningSettings(supabase as never)).rejects.toThrow(
      "Die Scanning-Konfiguration ist ungültig.",
    );
  });

  it("validates Fred attachment modes", () => {
    expect(FRED_ATTACHMENT_MODES).toEqual(["findog_preprocess", "weknora_native"]);
    expect(isValidFredAttachmentMode(DEFAULT_FRED_ATTACHMENT_MODE)).toBe(true);
    expect(isValidFredAttachmentMode("weknora_native")).toBe(true);
    expect(isValidFredAttachmentMode("browser_choice")).toBe(false);
    expect(isValidFredAttachmentMode("")).toBe(false);
  });


  it("validates scanning provider values", () => {
    expect(SCANNING_PROVIDERS).toEqual(["omniroute_luna", "openrouter"]);
    expect(isValidScanningProvider(DEFAULT_SCANNING_PROVIDER)).toBe(true);
    expect(isValidScanningProvider("openrouter")).toBe(true);
    expect(isValidScanningProvider("openrouter_only")).toBe(false);
    expect(isValidScanningProvider("")).toBe(false);
  });

  it("rejects a persisted scanning provider outside the database allow-list", async () => {
    supabase.maybeSingle.mockResolvedValue({
      data: {
        model_id: "openai/gpt-4o",
        document_pipeline: DEFAULT_DOCUMENT_PIPELINE,
        fred_attachment_mode: "findog_preprocess",
        scanning_provider: "browser_choice",
        prompt: "Custom prompt text",
        updated_at: "2026-07-19T10:00:00.000Z",
        updated_by: "admin-1",
      },
      error: null,
    });

    await expect(getScanningSettings(supabase as never)).rejects.toThrow(
      "Die Scanning-Konfiguration ist ungültig.",
    );
  });

  it("throws when the database query errors", async () => {
    supabase.maybeSingle.mockResolvedValue({ data: null, error: new Error("DB down") });

    await expect(getScanningSettings(supabase as never)).rejects.toThrow(
      "Die Scanning-Konfiguration ist derzeit nicht verfügbar.",
    );
  });

  it("validates OpenRouter model IDs correctly", () => {
    expect(isValidModelId("google/gemini-3.5-flash")).toBe(true);
    expect(isValidModelId("openai/gpt-4o")).toBe(true);
    expect(isValidModelId("anthropic/claude-sonnet-4-20250514")).toBe(true);
    expect(isValidModelId("")).toBe(false);
    expect(isValidModelId("model with space")).toBe(false);
    expect(isValidModelId("model\twith\ttab")).toBe(false);
  });

  it("persists and returns updated scanning settings", async () => {
    supabase.maybeSingle.mockResolvedValue({
      data: {
        model_id: "anthropic/claude-sonnet-4-20250514",
        document_pipeline: "omniroute_luna_only",
        fred_attachment_mode: "weknora_native",
        scanning_provider: "openrouter",
        prompt: "New scanning prompt",
        updated_at: "2026-07-19T12:00:00.000Z",
        updated_by: "admin-1",
      },
      error: null,
    });

    const result = await updateScanningSettings(
      supabase as never,
      "admin-1",
      "anthropic/claude-sonnet-4-20250514",
      "New scanning prompt",
      "omniroute_luna_only",
      "weknora_native",
      "openrouter",
    );
    expect(result.modelId).toBe("anthropic/claude-sonnet-4-20250514");
    expect(result.documentPipeline).toBe("omniroute_luna_only");
    expect(result.prompt).toBe("New scanning prompt");
    expect(result.scanningProvider).toBe("openrouter");
    expect(supabase.upsert).toHaveBeenCalledWith(expect.objectContaining({
      document_pipeline: "omniroute_luna_only",
      fred_attachment_mode: "weknora_native",
      scanning_provider: "openrouter",
    }), expect.anything());
  });

  it("rejects an invalid document pipeline on update", async () => {
    await expect(
      updateScanningSettings(
        supabase as never,
        "admin-1",
        "model/x",
        "prompt",
        "local_ocr" as unknown as Parameters<typeof updateScanningSettings>[4],
        "findog_preprocess",
        DEFAULT_SCANNING_PROVIDER,
      ),
    ).rejects.toThrow("Dokument-Pipeline ist ungültig.");
    expect(supabase.upsert).not.toHaveBeenCalled();
  });

  it("rejects invalid model IDs on update", async () => {
    await expect(
      updateScanningSettings(supabase as never, "admin-1", "", "prompt", DEFAULT_DOCUMENT_PIPELINE, DEFAULT_FRED_ATTACHMENT_MODE, DEFAULT_SCANNING_PROVIDER),
    ).rejects.toThrow("OpenRouter-Modell-ID ist ungültig.");
    await expect(
      updateScanningSettings(supabase as never, "admin-1", "bad model", "prompt", DEFAULT_DOCUMENT_PIPELINE, DEFAULT_FRED_ATTACHMENT_MODE, DEFAULT_SCANNING_PROVIDER),
    ).rejects.toThrow("OpenRouter-Modell-ID ist ungültig.");
  });

  it("rejects empty or oversized prompts on update", async () => {
    await expect(
      updateScanningSettings(supabase as never, "admin-1", "model/x", "", DEFAULT_DOCUMENT_PIPELINE, DEFAULT_FRED_ATTACHMENT_MODE, DEFAULT_SCANNING_PROVIDER),
    ).rejects.toThrow("Scanning-Prompt ist ungültig");
    await expect(
      updateScanningSettings(supabase as never, "admin-1", "model/x", "x".repeat(40001), DEFAULT_DOCUMENT_PIPELINE, DEFAULT_FRED_ATTACHMENT_MODE, DEFAULT_SCANNING_PROVIDER),
    ).rejects.toThrow("Scanning-Prompt ist ungültig");
  });

  it("rejects an invalid Fred attachment mode on update", async () => {
    await expect(
      updateScanningSettings(
        supabase as never,
        "admin-1",
        "model/x",
        "prompt",
        DEFAULT_DOCUMENT_PIPELINE,
        "browser_choice" as unknown as Parameters<typeof updateScanningSettings>[5],
        DEFAULT_SCANNING_PROVIDER,
      ),
    ).rejects.toThrow("Fred-Dateiverarbeitung ist ungültig.");
    expect(supabase.upsert).not.toHaveBeenCalled();
  });
});


// Contract guard: document OCR modes are intentionally distinct from Scanning provider values.
describe("OCR provider selection contract", () => {
  it("keeps document OCR modes separate from scanning providers", () => {
    expect(isValidDocumentPipeline("mineru_with_omniroute_luna_fallback")).toBe(true);
    expect(isValidDocumentPipeline("omniroute_luna_only")).toBe(true);
    expect(isValidDocumentPipeline("openrouter")).toBe(false);
    expect(isValidScanningProvider("omniroute_luna")).toBe(true);
    expect(isValidScanningProvider("openrouter")).toBe(true);
    expect(isValidScanningProvider("omniroute_luna_only")).toBe(false);
  });
});
