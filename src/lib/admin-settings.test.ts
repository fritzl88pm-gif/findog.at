import { describe, expect, it, vi } from "vitest";

import { DEFAULT_SYSTEM_PROMPT, MAX_SYSTEM_PROMPT_CHARS } from "./config";
import {
  getGlobalSystemPrompt,
  isAdminUser,
  updateGlobalSystemPrompt,
} from "./admin-settings";

describe("admin settings helper", () => {
  it("checks administrator status in admin_users", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { user_id: "admin-1" }, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });

    await expect(isAdminUser({ from } as never, "admin-1")).resolves.toBe(true);
    expect(from).toHaveBeenCalledWith("admin_users");
    expect(eq).toHaveBeenCalledWith("user_id", "admin-1");
  });

  it("uses the built-in prompt when the singleton has no row", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });

    await expect(getGlobalSystemPrompt({ from: vi.fn().mockReturnValue({ select }) } as never))
      .resolves.toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it("updates only the singleton row and records the administrator", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { system_prompt: "Globaler Prompt" },
      error: null,
    });
    const select = vi.fn().mockReturnValue({ maybeSingle });
    const upsert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ upsert });

    await expect(updateGlobalSystemPrompt(
      { from } as never,
      "admin-1",
      "  Globaler Prompt  ",
    )).resolves.toBe("Globaler Prompt");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: true, system_prompt: "Globaler Prompt", updated_by: "admin-1" }),
      { onConflict: "id" },
    );
  });

  it.each(["", "   ", "x".repeat(MAX_SYSTEM_PROMPT_CHARS + 1)])(
    "rejects an empty or overlong global prompt",
    async (prompt) => {
      await expect(updateGlobalSystemPrompt({ from: vi.fn() } as never, "admin-1", prompt))
        .rejects.toMatchObject({ status: 400 });
    },
  );
});
