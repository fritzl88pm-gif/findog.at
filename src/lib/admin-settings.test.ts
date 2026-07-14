import { describe, expect, it, vi } from "vitest";

import { DEFAULT_SYSTEM_PROMPT } from "./config";
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

  it("removes obsolete web and external-research references from a stored prompt", async () => {
    const storedPrompt = [
      "Bestehende Regel. Eine Live- oder Websuche steht auf findog.at nicht zur Verfügung – auch nicht auf ausdrücklichen Wunsch des Nutzers.",
      "- Eine Websuche/Live-Recherche steht auf findog.at nicht zur Verfügung – auch nicht auf ausdrücklichen Wunsch des Nutzers. Ist der Rechtsstand nicht ausreichend belegt, ist die Quellenlücke offenzulegen.",
      "Fehlt die Quelle, ist dies als Quellenlücke offenzulegen; es darf keine externe Recherche angekündigt und keine VwGH-Entscheidung oder kein Rechtssatz behauptet werden.",
    ].join("\n");
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { system_prompt: storedPrompt },
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });

    await expect(getGlobalSystemPrompt({ from: vi.fn().mockReturnValue({ select }) } as never))
      .resolves.toBe([
        "Bestehende Regel.",
        "- Ist der Rechtsstand nicht ausreichend belegt, ist die Quellenlücke offenzulegen.",
        "Fehlt die Quelle, ist dies als Quellenlücke offenzulegen; es darf keine VwGH-Entscheidung und kein Rechtssatz behauptet werden.",
      ].join("\n"));
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

  it("does not persist obsolete web-search references in an updated prompt", async () => {
    const sanitizedPrompt = "Regel.\n- Ist der Rechtsstand unklar, ist die Quellenlücke offenzulegen.";
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { system_prompt: sanitizedPrompt },
      error: null,
    });
    const select = vi.fn().mockReturnValue({ maybeSingle });
    const upsert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ upsert });

    await expect(updateGlobalSystemPrompt(
      { from } as never,
      "admin-1",
      "Regel.\n- Eine Websuche/Live-Recherche steht auf findog.at nicht zur Verfügung – auch nicht auf ausdrücklichen Wunsch des Nutzers. Ist der Rechtsstand unklar, ist die Quellenlücke offenzulegen.",
    )).resolves.toBe(sanitizedPrompt);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ system_prompt: sanitizedPrompt }),
      { onConflict: "id" },
    );
  });

  it.each(["", "   "])(
    "rejects an empty global prompt",
    async (prompt) => {
      await expect(updateGlobalSystemPrompt({ from: vi.fn() } as never, "admin-1", prompt))
        .rejects.toMatchObject({ status: 400 });
    },
  );

  it("accepts a global prompt far exceeding the former 40 000 character limit", async () => {
    const longPrompt = "x".repeat(100_000);
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { system_prompt: longPrompt },
      error: null,
    });
    const select = vi.fn().mockReturnValue({ maybeSingle });
    const upsert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ upsert });

    await expect(updateGlobalSystemPrompt(
      { from } as never,
      "admin-1",
      longPrompt,
    )).resolves.toBe(longPrompt);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: true, system_prompt: longPrompt, updated_by: "admin-1" }),
      { onConflict: "id" },
    );
  });
});
