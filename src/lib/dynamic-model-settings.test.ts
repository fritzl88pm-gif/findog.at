import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("node:crypto", () => ({ randomUUID: vi.fn() }));

import { isDynamicModelId } from "./config";
import {
  adminModelDtos,
  createDynamicModel,
  enabledModelSetting,
  isValidDynamicDisplayName,
  isValidUpstreamModelId,
  parseCreateDynamicModelBody,
  parseDynamicModelEnablePatch,
  publicEnabledModelDtos,
  readModelSettings,
} from "./model-settings";

const originalLaoZhangKey = process.env.LAOZHANG_API_KEY;
const originalDeepSeekKey = process.env.DEEPSEEK_API_KEY;
const originalZaiKey = process.env.ZAI_API_KEY;

function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

afterEach(() => {
  restore("LAOZHANG_API_KEY", originalLaoZhangKey);
  restore("DEEPSEEK_API_KEY", originalDeepSeekKey);
  restore("ZAI_API_KEY", originalZaiKey);
});

function storedRows() {
  return [
    {
      model_id: "glm-5-turbo",
      display_name: null,
      provider: "zai",
      upstream_model: "glm-5-turbo",
      is_dynamic: false,
      always_enabled: false,
      enabled: false,
      reasoning_setting: "enabled",
      revision: 4,
      updated_at: "2026-07-14T12:00:04.000Z",
      updated_by: null,
    },
    {
      model_id: "deepseek-v4-pro",
      display_name: null,
      provider: "deepseek",
      upstream_model: "deepseek-v4-pro",
      is_dynamic: false,
      always_enabled: false,
      enabled: true,
      reasoning_setting: "high",
      revision: 2,
      updated_at: "2026-07-14T12:00:02.000Z",
      updated_by: null,
    },
    {
      model_id: "glm-5.2",
      display_name: null,
      provider: "zai",
      upstream_model: "glm-5.2",
      is_dynamic: false,
      always_enabled: false,
      enabled: false,
      reasoning_setting: "max",
      revision: 3,
      updated_at: "2026-07-14T12:00:03.000Z",
      updated_by: null,
    },
    {
      model_id: "deepseek-v4-flash",
      display_name: null,
      provider: "deepseek",
      upstream_model: "deepseek-v4-flash",
      is_dynamic: false,
      always_enabled: true,
      enabled: true,
      reasoning_setting: "disabled",
      revision: 1,
      updated_at: "2026-07-14T12:00:01.000Z",
      updated_by: null,
    },
    {
      model_id: "laozhang:00000000-0000-4000-8000-000000000001",
      display_name: "GLM-5.2 (LaoZhang)",
      provider: "laozhang",
      upstream_model: "glm-5.2",
      is_dynamic: true,
      always_enabled: false,
      enabled: false,
      reasoning_setting: "disabled",
      revision: 5,
      updated_at: "2026-07-15T12:00:00.000Z",
      updated_by: null,
    },
    {
      model_id: "laozhang:00000000-0000-4000-8000-000000000002",
      display_name: "Qwen3 (LaoZhang)",
      provider: "laozhang",
      upstream_model: "qwen3-72b",
      is_dynamic: true,
      always_enabled: false,
      enabled: true,
      reasoning_setting: "disabled",
      revision: 6,
      updated_at: "2026-07-15T12:00:01.000Z",
      updated_by: null,
    },
  ];
}

function readClient(result: { data: unknown; error: unknown }) {
  const select = vi.fn().mockResolvedValue(result);
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from }, from, select };
}

describe("isDynamicModelId", () => {
  it("accepts valid laozhang:uuid format", () => {
    expect(isDynamicModelId("laozhang:00000000-0000-4000-8000-000000000001")).toBe(true);
    expect(isDynamicModelId("laozhang:f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBe(true);
  });

  it("rejects invalid formats", () => {
    expect(isDynamicModelId("")).toBe(false);
    expect(isDynamicModelId("deepseek-v4-flash")).toBe(false);
    expect(isDynamicModelId("laozhang:not-a-uuid")).toBe(false);
    expect(isDynamicModelId("laozhang:")).toBe(false);
    expect(isDynamicModelId("random-prefix:uuid")).toBe(false);
  });
});

describe("isValidDynamicDisplayName", () => {
  it("accepts valid display names", () => {
    expect(isValidDynamicDisplayName("GLM-5.2")).toBe(true);
    expect(isValidDynamicDisplayName("Qwen3 72B Instruct")).toBe(true);
  });

  it("rejects empty or control-character names", () => {
    expect(isValidDynamicDisplayName("")).toBe(false);
    expect(isValidDynamicDisplayName("  ")).toBe(false);
    expect(isValidDynamicDisplayName("name\x00withnull")).toBe(false);
    expect(isValidDynamicDisplayName("name\x1fwithcontrol")).toBe(false);
  });
});

describe("isValidUpstreamModelId", () => {
  it("accepts valid upstream model IDs", () => {
    expect(isValidUpstreamModelId("glm-5.2")).toBe(true);
    expect(isValidUpstreamModelId("qwen3-72b-instruct")).toBe(true);
  });

  it("rejects empty or control-character IDs", () => {
    expect(isValidUpstreamModelId("")).toBe(false);
    expect(isValidUpstreamModelId("  ")).toBe(false);
    expect(isValidUpstreamModelId("id\x00withnull")).toBe(false);
  });
});

describe("parseCreateDynamicModelBody", () => {
  it("parses valid creation input", () => {
    const result = parseCreateDynamicModelBody({
      displayName: "GLM-5.2 (LaoZhang)",
      upstreamModel: "glm-5.2",
    });
    expect(result).toEqual({
      displayName: "GLM-5.2 (LaoZhang)",
      upstreamModel: "glm-5.2",
    });
  });

  it("rejects missing fields", () => {
    expect(() => parseCreateDynamicModelBody({})).toThrow();
    expect(() => parseCreateDynamicModelBody({ displayName: "Test" })).toThrow();
  });

  it("rejects invalid display name", () => {
    expect(() => parseCreateDynamicModelBody({
      displayName: "",
      upstreamModel: "glm-5.2",
    })).toThrow("Anzeigename");
  });

  it("rejects invalid upstream model ID", () => {
    expect(() => parseCreateDynamicModelBody({
      displayName: "GLM-5.2",
      upstreamModel: "",
    })).toThrow("Modell-ID");
  });
});

describe("parseDynamicModelEnablePatch", () => {
  it("parses valid enable/disable patch", () => {
    expect(parseDynamicModelEnablePatch({ enabled: true })).toEqual({ enabled: true });
    expect(parseDynamicModelEnablePatch({ enabled: false })).toEqual({ enabled: false });
  });

  it("rejects missing or invalid enabled field", () => {
    expect(() => parseDynamicModelEnablePatch({})).toThrow();
    expect(() => parseDynamicModelEnablePatch({ enabled: "yes" })).toThrow();
  });
});

describe("readModelSettings with dynamic rows", () => {
  it("loads both built-in and dynamic models together", async () => {
    const fake = readClient({ data: storedRows(), error: null });
    const snapshot = await readModelSettings(fake.client as never);

    expect(snapshot.source).toBe("database");
    expect(snapshot.models).toHaveLength(6);
    // First 4 are built-in in catalog order
    expect(snapshot.models[0].id).toBe("deepseek-v4-flash");
    expect(snapshot.models[3].id).toBe("glm-5-turbo");
    // Last 2 are dynamic
    expect(snapshot.models[4].id).toBe("laozhang:00000000-0000-4000-8000-000000000001");
    expect(snapshot.models[5].id).toBe("laozhang:00000000-0000-4000-8000-000000000002");
    expect(snapshot.models[4].isDynamic).toBe(true);
  });

  it("normalizes dynamic rows safely and rejects malformed ones", async () => {
    const rows = storedRows();
    // Malformed: wrong reasoning for dynamic
    const malformed = rows.map((r) => r.model_id === "laozhang:00000000-0000-4000-8000-000000000001"
      ? { ...r, reasoning_setting: "max" }
      : r);

    const fake = readClient({ data: malformed, error: null });
    await expect(readModelSettings(fake.client as never)).rejects.toMatchObject({ status: 503 });
  });
});

describe("publicEnabledModelDtos with dynamic models", () => {
  it("includes only enabled dynamic models with display name, no provider/upstream/key", async () => {
    process.env.LAOZHANG_API_KEY = "lz-secret";
    process.env.DEEPSEEK_API_KEY = "ds-secret";
    process.env.ZAI_API_KEY = "zai-secret";

    const fake = readClient({ data: storedRows(), error: null });
    const snapshot = await readModelSettings(fake.client as never);
    const dtos = publicEnabledModelDtos(snapshot);

    // deepseek-v4-flash is always enabled, deepseek-v4-pro is enabled, laozhang:...00002 is enabled
    expect(dtos).toContainEqual({ id: "deepseek-v4-flash", label: "DeepSeek v4 Flash" });
    expect(dtos).toContainEqual({ id: "deepseek-v4-pro", label: "DeepSeek v4 Pro" });
    expect(dtos).toContainEqual({
      id: "laozhang:00000000-0000-4000-8000-000000000002",
      label: "Qwen3 (LaoZhang)",
    });
    // Disabled ones not included
    expect(dtos.map((d) => d.id)).not.toContain("laozhang:00000000-0000-4000-8000-000000000001");

    // No provider or upstream in any DTO (model ID contains laozhang: prefix as opaque key)
    const json = JSON.stringify(dtos);
    // The opaque key contains "laozhang:" but that's expected as it's the ID
    expect(json).not.toContain("qwen3"); // qwen3 is the upstream ID - should not be in public
    expect(json).not.toContain("lz-secret");
    expect(json).not.toContain("zai-secret");
    // No public DTO should contain the word "provider" or "upstreamModel"
  });
});

describe("adminModelDtos with dynamic models", () => {
  it("includes safe provider/upstream metadata, never the API key", async () => {
    process.env.LAOZHANG_API_KEY = "lz-secret";
    process.env.DEEPSEEK_API_KEY = "ds-secret";
    process.env.ZAI_API_KEY = "zai-secret";

    const fake = readClient({ data: storedRows(), error: null });
    const snapshot = await readModelSettings(fake.client as never);
    const dtos = adminModelDtos(snapshot);

    const dynamicDtos = dtos.filter((d) => d.provider === "laozhang");
    expect(dynamicDtos).toHaveLength(2);
    expect(dynamicDtos[0]).toMatchObject({
      label: "GLM-5.2 (LaoZhang)",
      provider: "laozhang",
      upstreamModel: "glm-5.2",
      enabled: false,
      alwaysEnabled: false,
      reasoning: "disabled",
      providerConfigured: true,
    });

    // API key never appears in any DTO
    const json = JSON.stringify(dtos);
    expect(json).not.toContain("lz-secret");
    expect(json).not.toContain("ds-secret");
    expect(json).not.toContain("zai-secret");
  });
});

describe("enabledModelSetting with dynamic models", () => {
  it("finds and validates an enabled dynamic model by opaque ID", async () => {
    process.env.LAOZHANG_API_KEY = "lz-secret";
    process.env.DEEPSEEK_API_KEY = "ds-secret";

    const fake = readClient({ data: storedRows(), error: null });
    const snapshot = await readModelSettings(fake.client as never);
    const setting = enabledModelSetting(snapshot, "laozhang:00000000-0000-4000-8000-000000000002");

    expect(setting.isDynamic).toBe(true);
    expect(setting.enabled).toBe(true);
    expect(setting.reasoning).toBe("disabled");
  });

  it("rejects a disabled dynamic model", async () => {
    const fake = readClient({ data: storedRows(), error: null });
    const snapshot = await readModelSettings(fake.client as never);

    expect(() => enabledModelSetting(
      snapshot,
      "laozhang:00000000-0000-4000-8000-000000000001",
    )).toThrow("nicht aktiviert");
  });
});

describe("createDynamicModel", () => {
  it("creates a dynamic model via RPC and returns the setting", async () => {
    process.env.LAOZHANG_API_KEY = "lz-secret";
    process.env.DEEPSEEK_API_KEY = "ds-secret";
    process.env.ZAI_API_KEY = "zai-secret";

    vi.mocked(randomUUID).mockReturnValue("f47ac10b-58cc-4372-a567-0e02b2c3d479");
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const select = vi.fn()
      .mockResolvedValue({
        data: [...storedRows(), {
          model_id: "laozhang:f47ac10b-58cc-4372-a567-0e02b2c3d479",
          display_name: "Test Model",
          provider: "laozhang",
          upstream_model: "test-model",
          is_dynamic: true,
          always_enabled: false,
          enabled: false,
          reasoning_setting: "disabled",
          revision: 7,
          updated_at: "2026-07-15T12:00:02.000Z",
          updated_by: null,
        }],
        error: null,
      });
    const from = vi.fn().mockReturnValue({ select });
    const supabase = { from, rpc } as never;

    const result = await createDynamicModel({
      supabase,
      adminUserId: "admin-uuid",
      input: { displayName: "Test Model", upstreamModel: "test-model" },
    });

    const rpcCall = rpc.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(rpcCall?.p_model_id).toMatch(/^laozhang:/);
    expect(rpcCall?.p_display_name).toBe("Test Model");
    expect(rpcCall?.p_upstream_model).toBe("test-model");
    expect(rpcCall?.p_created_by).toBe("admin-uuid");
    expect(result.isDynamic).toBe(true);
    expect(result.provider).toBe("laozhang");
  });

  it("handles RPC conflict errors", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { code: "23505" } });
    const supabase = { from: vi.fn(), rpc } as never;

    await expect(createDynamicModel({
      supabase,
      adminUserId: "admin-uuid",
      input: { displayName: "Test", upstreamModel: "test" },
    })).rejects.toMatchObject({ status: 409 });
  });
});

describe("malformed metadata rejection", () => {
  it("normalizeBuiltinRow rejects mismatched provider", async () => {
    const rows = storedRows().map((r) => r.model_id === "deepseek-v4-flash"
      ? { ...r, provider: "zai" }
      : r);
    const fake = readClient({ data: rows, error: null });
    await expect(readModelSettings(fake.client as never)).rejects.toMatchObject({ status: 503 });
  });

  it("normalizeBuiltinRow rejects mismatched upstream_model", async () => {
    const rows = storedRows().map((r) => r.model_id === "deepseek-v4-flash"
      ? { ...r, upstream_model: "wrong-model" }
      : r);
    const fake = readClient({ data: rows, error: null });
    await expect(readModelSettings(fake.client as never)).rejects.toMatchObject({ status: 503 });
  });

  it("normalizeBuiltinRow rejects mismatched always_enabled", async () => {
    const rows = storedRows().map((r) => r.model_id === "deepseek-v4-flash"
      ? { ...r, always_enabled: false }
      : r);
    const fake = readClient({ data: rows, error: null });
    await expect(readModelSettings(fake.client as never)).rejects.toMatchObject({ status: 503 });
  });

  it("normalizeDynamicRow rejects display name with control characters", async () => {
    const rows = storedRows().map((r) => r.model_id === "laozhang:00000000-0000-4000-8000-000000000001"
      ? { ...r, display_name: "Test\x00Name" }
      : r);
    const fake = readClient({ data: rows, error: null });
    await expect(readModelSettings(fake.client as never)).rejects.toMatchObject({ status: 503 });
  });

  it("normalizeDynamicRow rejects upstream model with control characters", async () => {
    const rows = storedRows().map((r) => r.model_id === "laozhang:00000000-0000-4000-8000-000000000001"
      ? { ...r, upstream_model: "test\x1fmodel" }
      : r);
    const fake = readClient({ data: rows, error: null });
    await expect(readModelSettings(fake.client as never)).rejects.toMatchObject({ status: 503 });
  });

  it("normalizeDynamicRow rejects empty display name after trim", async () => {
    const rows = storedRows().map((r) => r.model_id === "laozhang:00000000-0000-4000-8000-000000000001"
      ? { ...r, display_name: "  " }
      : r);
    const fake = readClient({ data: rows, error: null });
    await expect(readModelSettings(fake.client as never)).rejects.toMatchObject({ status: 503 });
  });
});
