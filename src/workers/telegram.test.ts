import { describe, expect, it, vi } from "vitest";

import { buildStorage } from "./telegram";

function fakeSupabase(overrides: Record<string, unknown> = {}) {
  return {
    from: vi.fn(),
    rpc: vi.fn(),
    ...overrides,
  };
}

const integrationId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("buildStorage.loadIntegration", () => {
  it("maps pro_mode_enabled and web_search_enabled from DB row", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: integrationId,
        client_id: "client-1",
        bot_user_id: 123,
        encrypted_token: "enc",
        status: "active",
        paired_telegram_user_id: 456,
        paired_telegram_chat_id: 789,
        pro_mode_enabled: true,
        web_search_enabled: false,
      },
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    const supabase = fakeSupabase({ from });

    const storage = buildStorage(supabase as never);
    const integration = await storage.loadIntegration(integrationId);

    expect(integration).not.toBeNull();
    expect(integration!.proModeEnabled).toBe(true);
    expect(integration!.webSearchEnabled).toBe(false);
    // Ensure specific columns are selected (the exact list)
    expect(select).toHaveBeenCalledWith(
      "id,client_id,bot_user_id,encrypted_token,status,paired_telegram_user_id,paired_telegram_chat_id,pro_mode_enabled,web_search_enabled",
    );
  });

  it("returns null when no row found", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    const supabase = fakeSupabase({ from });

    const storage = buildStorage(supabase as never);
    const integration = await storage.loadIntegration(integrationId);

    expect(integration).toBeNull();
  });

  it("throws on DB error", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: new Error("boom") });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    const supabase = fakeSupabase({ from });

    const storage = buildStorage(supabase as never);
    await expect(storage.loadIntegration(integrationId)).rejects.toThrow("TELEGRAM_INTEGRATION_READ_FAILED");
  });
});

describe("buildStorage.setMode", () => {
  it("updates pro_mode_enabled column and reads back both states", async () => {
    const eqUpdate = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: eqUpdate });

    const maybeSingle = vi.fn().mockResolvedValue({
      data: { pro_mode_enabled: true, web_search_enabled: false },
      error: null,
    });
    const eqSelect = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq: eqSelect });

    let tableName = "";
    const from = vi.fn().mockImplementation((table: string) => {
      tableName = table;
      return { update, select };
    });

    const supabase = fakeSupabase({ from });
    const storage = buildStorage(supabase as never);

    const result = await storage.setMode(integrationId, "pro", true);

    expect(result.proModeEnabled).toBe(true);
    expect(result.webSearchEnabled).toBe(false);
    // verify we used the correct column
    expect(from).toHaveBeenCalledWith("telegram_integrations");
    // update was called
    expect(update).toHaveBeenCalledWith({ pro_mode_enabled: true });
    expect(eqUpdate).toHaveBeenCalledWith("id", integrationId);
  });

  it("updates web_search_enabled column", async () => {
    const eqUpdate = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: eqUpdate });

    const maybeSingle = vi.fn().mockResolvedValue({
      data: { pro_mode_enabled: false, web_search_enabled: true },
      error: null,
    });
    const eqSelect = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq: eqSelect });

    const from = vi.fn().mockReturnValue({ update, select });

    const supabase = fakeSupabase({ from });
    const storage = buildStorage(supabase as never);

    const result = await storage.setMode(integrationId, "web", true);

    expect(result.webSearchEnabled).toBe(true);
    expect(result.proModeEnabled).toBe(false);
    expect(update).toHaveBeenCalledWith({ web_search_enabled: true });
  });

  it("throws when update fails", async () => {
    const eqUpdate = vi.fn().mockResolvedValue({ error: new Error("db down") });
    const update = vi.fn().mockReturnValue({ eq: eqUpdate });
    const from = vi.fn().mockReturnValue({ update, select: vi.fn() });

    const supabase = fakeSupabase({ from });
    const storage = buildStorage(supabase as never);

    await expect(storage.setMode(integrationId, "pro", true)).rejects.toThrow("TELEGRAM_MODE_UPDATE_FAILED");
  });

  it("throws when read-back fails", async () => {
    const eqUpdate = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: eqUpdate });

    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eqSelect = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq: eqSelect });

    const from = vi.fn().mockReturnValue({ update, select });
    const supabase = fakeSupabase({ from });
    const storage = buildStorage(supabase as never);

    await expect(storage.setMode(integrationId, "pro", true)).rejects.toThrow("TELEGRAM_MODE_READ_FAILED");
  });

});

describe("import safety", () => {
  it("importing buildStorage does not trigger main startup (direct-execution guard)", async () => {
    // The module is imported at the top of this file. If the guard were missing,
    // main() would run and emit telegram_worker_fatal to stderr.
    // Since buildStorage is successfully imported and usable, the guard works.
    // We also verify through a fresh dynamic import.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.resetModules();
      const mod = await import("./telegram");
      expect(mod.buildStorage).toBeDefined();
      expect(typeof mod.buildStorage).toBe("function");
      // No fatal error should have been logged during import
      const fatalCalls = errorSpy.mock.calls.filter(
        (call) => typeof call[0] === "string" && (call[0] as string).includes("telegram_worker_fatal"),
      );
      expect(fatalCalls).toHaveLength(0);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
