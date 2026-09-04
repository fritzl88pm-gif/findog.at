import { describe, expect, it, vi } from "vitest";

import { createConfiguredDocumentProvider } from "@/lib/attachments/document-pipeline";
import { getScanningSettings } from "@/lib/scanning/settings";
import { buildPreprocessorProviders, buildStorage, buildRpc, createHealthHandler } from "./telegram";

function fakeSupabase(overrides: Record<string, unknown> = {}) {
  return {
    from: vi.fn(),
    rpc: vi.fn(),
    ...overrides,
  };
}

vi.mock("@/lib/attachments/document-pipeline", () => ({
  createConfiguredDocumentProvider: vi.fn(),
}));
vi.mock("@/lib/scanning/settings", () => ({
  getScanningSettings: vi.fn(),
}));

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

describe("buildPreprocessorProviders", () => {
  it("wires Telegram documents to the shared configured provider", () => {
    const supabase = fakeSupabase();
    const documentProvider = vi.fn();
    vi.mocked(createConfiguredDocumentProvider).mockReturnValue(documentProvider);

    const providers = buildPreprocessorProviders(supabase as never);

    expect(createConfiguredDocumentProvider).toHaveBeenCalledWith(expect.objectContaining({
      getSettings: expect.any(Function),
      mineruProvider: expect.any(Function),
      omnirouteProvider: expect.any(Function),
    }));
    const dependencies = vi.mocked(createConfiguredDocumentProvider).mock.calls[0][0];
    expect(dependencies.getSettings).toBeDefined();
    expect(providers.document).toBe(documentProvider);
    expect(providers.gemini).toBeDefined();
  });

  it("reads current scanning settings without caching them at worker startup", async () => {
    vi.mocked(getScanningSettings).mockResolvedValue({
      documentPipeline: "omniroute_luna_only",
      fredAttachmentMode: "findog_preprocess",
      scanningProvider: "omniroute_luna",
      modelId: "vendor/model",
      prompt: "prompt",
      updatedAt: "2026-08-18T00:00:00.000Z",
      updatedBy: null,
    });
    const documentProvider = vi.fn().mockResolvedValue(["OCR"]);
    vi.mocked(createConfiguredDocumentProvider).mockReturnValue(documentProvider);
    const supabase = fakeSupabase();

    const providers = buildPreprocessorProviders(supabase as never);
    const dependencies = vi.mocked(createConfiguredDocumentProvider).mock.calls[0][0];
    await dependencies.getSettings();
    await dependencies.getSettings();

    expect(providers.document).toBe(documentProvider);
    expect(getScanningSettings).toHaveBeenCalledTimes(2);
    expect(vi.mocked(getScanningSettings).mock.calls).toHaveLength(2);
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


it("routes control claims to the dedicated RPC without changing normal claims", async () => {
  const supabase = fakeSupabase({ rpc: vi.fn().mockResolvedValue({ data: [], error: null }) });
  const rpc = buildRpc(supabase as never);
  const params = { p_lease_id: "lease", p_limit: 1, p_lease_seconds: 60 };
  await rpc.claimControls(params);
  await rpc.claimPending(params);
  expect(supabase.rpc).toHaveBeenCalledWith("claim_pending_telegram_control_updates", params);
  expect(supabase.rpc).toHaveBeenCalledWith("claim_pending_telegram_updates", params);
});

it.each(["/healthz", "/readyz"])("returns 503 on %s when the worker is unresponsive", (url) => {
  let healthy = false;
  const handler = createHealthHandler(() => healthy);
  const response = { writeHead: vi.fn(), end: vi.fn() };
  handler({ url } as never, response as never);
  expect(response.writeHead).toHaveBeenLastCalledWith(503, expect.any(Object));
  healthy = true;
  handler({ url } as never, response as never);
  expect(response.writeHead).toHaveBeenLastCalledWith(200, expect.any(Object));
});
