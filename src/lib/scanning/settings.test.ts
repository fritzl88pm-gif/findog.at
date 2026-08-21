import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_DOCUMENT_PIPELINE,
  DEFAULT_FRED_ATTACHMENT_MODE,
  DEFAULT_SCANNING_MODEL_ID,
  DEFAULT_SCANNING_PROMPT,
  FRED_ATTACHMENT_MODES,
  getScanningSettings,
  isValidDocumentPipeline,
  isValidFredAttachmentMode,
  isValidModelId,
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
        document_pipeline: "openrouter_only",
        fred_attachment_mode: "weknora_native",
        prompt: "Custom prompt text",
        updated_at: "2026-07-19T10:00:00.000Z",
        updated_by: "admin-1",
      },
      error: null,
    });

    const result = await getScanningSettings(supabase as never);
    expect(result).toEqual({
      modelId: "openai/gpt-4o",
      documentPipeline: "openrouter_only",
      fredAttachmentMode: "weknora_native",
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
    expect(result.updatedBy).toBeNull();
    expect(supabase.select).toHaveBeenCalledWith(
      "model_id,document_pipeline,fred_attachment_mode,prompt,updated_at,updated_by",
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
    expect(isValidDocumentPipeline("openrouter_only")).toBe(true);
    expect(isValidDocumentPipeline("local_ocr")).toBe(false);
    expect(isValidDocumentPipeline("")).toBe(false);
  });

  it("rejects a persisted Fred attachment mode outside the database allow-list", async () => {
    supabase.maybeSingle.mockResolvedValue({
      data: {
        model_id: "openai/gpt-4o",
        document_pipeline: "openrouter_only",
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
        document_pipeline: "openrouter_only",
        fred_attachment_mode: "weknora_native",
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
      "openrouter_only",
      "weknora_native",
    );
    expect(result.modelId).toBe("anthropic/claude-sonnet-4-20250514");
    expect(result.documentPipeline).toBe("openrouter_only");
    expect(result.prompt).toBe("New scanning prompt");
    expect(supabase.upsert).toHaveBeenCalledWith(expect.objectContaining({
      document_pipeline: "openrouter_only",
      fred_attachment_mode: "weknora_native",
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
      ),
    ).rejects.toThrow("Dokument-Pipeline ist ungültig.");
    expect(supabase.upsert).not.toHaveBeenCalled();
  });

  it("rejects invalid model IDs on update", async () => {
    await expect(
      updateScanningSettings(supabase as never, "admin-1", "", "prompt", DEFAULT_DOCUMENT_PIPELINE, DEFAULT_FRED_ATTACHMENT_MODE),
    ).rejects.toThrow("OpenRouter-Modell-ID ist ungültig.");
    await expect(
      updateScanningSettings(supabase as never, "admin-1", "bad model", "prompt", DEFAULT_DOCUMENT_PIPELINE, DEFAULT_FRED_ATTACHMENT_MODE),
    ).rejects.toThrow("OpenRouter-Modell-ID ist ungültig.");
  });

  it("rejects empty or oversized prompts on update", async () => {
    await expect(
      updateScanningSettings(supabase as never, "admin-1", "model/x", "", DEFAULT_DOCUMENT_PIPELINE, DEFAULT_FRED_ATTACHMENT_MODE),
    ).rejects.toThrow("Scanning-Prompt ist ungültig");
    await expect(
      updateScanningSettings(supabase as never, "admin-1", "model/x", "x".repeat(40001), DEFAULT_DOCUMENT_PIPELINE, DEFAULT_FRED_ATTACHMENT_MODE),
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
      ),
    ).rejects.toThrow("Fred-Dateiverarbeitung ist ungültig.");
    expect(supabase.upsert).not.toHaveBeenCalled();
  });
});
