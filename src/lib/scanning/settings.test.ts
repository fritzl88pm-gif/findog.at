import { beforeEach, describe, expect, it, vi } from "vitest";

import { getScanningSettings, updateScanningSettings, DEFAULT_SCANNING_MODEL_ID, DEFAULT_SCANNING_PROMPT, isValidModelId } from "./settings";

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
        prompt: "Custom prompt text",
        updated_at: "2026-07-19T10:00:00.000Z",
        updated_by: "admin-1",
      },
      error: null,
    });

    const result = await getScanningSettings(supabase as never);
    expect(result).toEqual({
      modelId: "openai/gpt-4o",
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
    expect(result.updatedBy).toBeNull();
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
    );
    expect(result.modelId).toBe("anthropic/claude-sonnet-4-20250514");
    expect(result.prompt).toBe("New scanning prompt");
  });

  it("rejects invalid model IDs on update", async () => {
    await expect(
      updateScanningSettings(supabase as never, "admin-1", "", "prompt"),
    ).rejects.toThrow("OpenRouter-Modell-ID ist ungültig.");
    await expect(
      updateScanningSettings(supabase as never, "admin-1", "bad model", "prompt"),
    ).rejects.toThrow("OpenRouter-Modell-ID ist ungültig.");
  });

  it("rejects empty or oversized prompts on update", async () => {
    await expect(
      updateScanningSettings(supabase as never, "admin-1", "model/x", ""),
    ).rejects.toThrow("Scanning-Prompt ist ungültig");
    await expect(
      updateScanningSettings(supabase as never, "admin-1", "model/x", "x".repeat(40001)),
    ).rejects.toThrow("Scanning-Prompt ist ungültig");
  });
});
