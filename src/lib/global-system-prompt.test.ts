import { describe, expect, it, vi } from "vitest";

import {
  getGlobalSystemPrompt,
  getGlobalSystemPromptRecord,
  updateGlobalSystemPrompt,
} from "./global-system-prompt";

function readClient(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as never, from, select, eq };
}

describe("global system prompt repository", () => {
  it("returns the singleton prompt exactly without trimming or fallback", async () => {
    const storedPrompt = "  # Global\n\nPrompt mit Randzeichen.  ";
    const { client, from, select, eq } = readClient({
      data: {
        system_prompt: storedPrompt,
        updated_at: "2026-07-18T08:00:00.000Z",
        updated_by: "admin-1",
      },
      error: null,
    });

    await expect(getGlobalSystemPrompt(client)).resolves.toBe(storedPrompt);
    expect(from).toHaveBeenCalledWith("global_settings");
    expect(select).toHaveBeenCalledWith("system_prompt,updated_at,updated_by");
    expect(eq).toHaveBeenCalledWith("id", true);
  });

  it.each([
    { data: null, error: null },
    { data: { system_prompt: "   ", updated_at: "2026-07-18", updated_by: null }, error: null },
    { data: null, error: { code: "PGRST205" } },
  ])("fails closed when no valid database prompt exists", async (result) => {
    const { client } = readClient(result);
    await expect(getGlobalSystemPromptRecord(client)).rejects.toMatchObject({ status: 503 });
  });

  it("stores an arbitrarily long prompt exactly and records the administrator", async () => {
    const prompt = `  ${"x".repeat(120_000)}\n`;
    const stored = {
      system_prompt: prompt,
      updated_at: "2026-07-18T08:00:00.000Z",
      updated_by: "admin-1",
    };
    const maybeSingle = vi.fn().mockResolvedValue({ data: stored, error: null });
    const select = vi.fn().mockReturnValue({ maybeSingle });
    const upsert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ upsert });

    await expect(updateGlobalSystemPrompt(
      { from } as never,
      "admin-1",
      prompt,
    )).resolves.toEqual({
      systemPrompt: prompt,
      updatedAt: stored.updated_at,
      updatedBy: "admin-1",
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: true, system_prompt: prompt, updated_by: "admin-1" }),
      { onConflict: "id" },
    );
  });

  it.each([undefined, null, "", "   "])("rejects an empty prompt: %s", async (prompt) => {
    await expect(updateGlobalSystemPrompt({ from: vi.fn() } as never, "admin-1", prompt))
      .rejects.toMatchObject({ status: 400 });
  });
});
