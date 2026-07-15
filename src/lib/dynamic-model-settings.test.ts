import { randomBytes, randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isDynamicModelId } from "./config";
import {
  adminModelDtos,
  createOpenAICompatibleModel,
  deleteOpenAICompatibleModel,
  enabledModelSetting,
  normalizeOpenAICompatibleBaseUrl,
  parseCreateOpenAICompatibleModelBody,
  parseDeleteOpenAICompatibleModelBody,
  parseUpdateOpenAICompatibleModelBody,
  publicEnabledModelDtos,
  readModelSettings,
  updateOpenAICompatibleModel,
} from "./model-settings";
import { encryptOpenAICompatibleApiKey } from "./openai-compatible-credentials";

const originalCredentialsKey = process.env.OPENAI_COMPATIBLE_CREDENTIALS_KEY;

function builtins() {
  return [
    ["deepseek-v4-flash", "deepseek", true, true, "disabled", 1],
    ["deepseek-v4-pro", "deepseek", false, true, "high", 2],
    ["glm-5.2", "zai", false, false, "max", 3],
    ["glm-5-turbo", "zai", false, false, "enabled", 4],
  ].map(([modelId, provider, alwaysEnabled, enabled, reasoning, revision]) => ({
    model_id: modelId,
    display_name: null,
    provider,
    upstream_model: modelId,
    is_dynamic: false,
    always_enabled: alwaysEnabled,
    enabled,
    reasoning_setting: reasoning,
    base_url: null,
    access_scope: null,
    api_key_ciphertext: null,
    revision,
    updated_at: `2026-07-14T12:00:0${revision}.000Z`,
    updated_by: null,
  }));
}

function dynamicRow(overrides: Record<string, unknown> = {}) {
  return {
    model_id: "openai:00000000-0000-4000-8000-000000000001",
    display_name: null,
    provider: "openai_compatible",
    upstream_model: "vendor-model",
    is_dynamic: true,
    always_enabled: false,
    enabled: true,
    reasoning_setting: "disabled",
    base_url: "https://gateway.example.com/v1",
    access_scope: "all",
    api_key_ciphertext: encryptOpenAICompatibleApiKey("provider-secret"),
    revision: 5,
    updated_at: "2026-07-15T12:00:00.000Z",
    updated_by: null,
    ...overrides,
  };
}

function supabaseWithRows(rows: unknown[]) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  return {
    rpc,
    from: vi.fn(() => ({
      select: vi.fn().mockImplementation(async () => ({
        data: rows.map((row) => {
          if (!row || typeof row !== "object" || !(row as Record<string, unknown>).is_dynamic) return row;
          const generatedId = rpc.mock.calls[0]?.[1]?.p_model_id;
          return generatedId ? { ...(row as Record<string, unknown>), model_id: generatedId } : row;
        }),
        error: null,
      })),
    })),
  };
}

beforeEach(() => {
  process.env.OPENAI_COMPATIBLE_CREDENTIALS_KEY = randomBytes(32).toString("base64");
  process.env.DEEPSEEK_API_KEY = "deepseek-secret";
});

afterEach(() => {
  if (originalCredentialsKey === undefined) delete process.env.OPENAI_COMPATIBLE_CREDENTIALS_KEY;
  else process.env.OPENAI_COMPATIBLE_CREDENTIALS_KEY = originalCredentialsKey;
  delete process.env.DEEPSEEK_API_KEY;
});

describe("OpenAI-compatible model validation", () => {
  it("accepts openai UUID IDs and rejects legacy IDs", () => {
    expect(isDynamicModelId(`openai:${randomUUID()}`)).toBe(true);
    expect(isDynamicModelId(`openai:not-a-${randomUUID()}`)).toBe(false);
  });

  it("normalizes absolute base URLs and rejects credentials, query, hash, or non-http schemes", () => {
    expect(normalizeOpenAICompatibleBaseUrl("https://gateway.example.com/v1///")).toBe(
      "https://gateway.example.com/v1",
    );
    for (const value of [
      "ftp://gateway.example.com/v1",
      "https://user:pass@gateway.example.com/v1",
      "https://gateway.example.com/v1?x=1",
      "https://gateway.example.com/v1#x",
    ]) {
      expect(() => normalizeOpenAICompatibleBaseUrl(value)).toThrow("Basis-URL");
    }
  });

  it("requires a key on create but retains it for blank or omitted update keys", () => {
    expect(() => parseCreateOpenAICompatibleModelBody({
      upstreamModel: "vendor-model",
      baseUrl: "https://gateway.example.com/v1",
      accessScope: "all",
    })).toThrow("API-Key");

    const omitted = parseUpdateOpenAICompatibleModelBody({
      upstreamModel: "vendor-model",
      displayName: "Vendor",
      baseUrl: "https://gateway.example.com/v1",
      accessScope: "admins",
      revision: 5,
    });
    const blank = parseUpdateOpenAICompatibleModelBody({ ...omitted, apiKey: "" });
    expect(omitted.apiKey).toBeUndefined();
    expect(blank.apiKey).toBeUndefined();
  });

  it("requires an optimistic revision for delete", () => {
    expect(parseDeleteOpenAICompatibleModelBody({ revision: 5 })).toEqual({ revision: 5 });
    expect(() => parseDeleteOpenAICompatibleModelBody({})).toThrow("Revision");
  });
});

describe("OpenAI-compatible settings and DTOs", () => {
  it("falls back to upstream model and never exposes ciphertext", async () => {
    const snapshot = await readModelSettings(supabaseWithRows([...builtins(), dynamicRow()]) as never);
    const publicDto = publicEnabledModelDtos(snapshot).find((model) => model.id.startsWith("openai:"));
    const adminDto = adminModelDtos(snapshot).find((model) => model.provider === "openai_compatible");
    expect(publicDto).toEqual({
      id: "openai:00000000-0000-4000-8000-000000000001",
      label: "vendor-model",
    });
    expect(adminDto).toMatchObject({
      displayName: null,
      upstreamModel: "vendor-model",
      baseUrl: "https://gateway.example.com/v1",
      accessScope: "all",
    });
    expect(JSON.stringify({ publicDto, adminDto })).not.toContain("provider-secret");
    expect(JSON.stringify({ publicDto, adminDto })).not.toContain("apiKeyCiphertext");
  });

  it("filters admins-only models and independently rejects normal-user selection", async () => {
    const snapshot = await readModelSettings(supabaseWithRows([
      ...builtins(),
      dynamicRow({ access_scope: "admins" }),
    ]) as never);
    expect(publicEnabledModelDtos(snapshot, false).some((model) => model.id.startsWith("openai:"))).toBe(false);
    expect(publicEnabledModelDtos(snapshot, true).some((model) => model.id.startsWith("openai:"))).toBe(true);
    expect(() => enabledModelSetting(snapshot, dynamicRow().model_id, false)).toThrow("nicht verfügbar");
    expect(enabledModelSetting(snapshot, dynamicRow().model_id, true).isDynamic).toBe(true);
  });
});

describe("OpenAI-compatible CRUD wrappers", () => {
  it("encrypts create keys and uses an opaque ID", async () => {
    const rows = [...builtins(), dynamicRow()];
    const supabase = supabaseWithRows(rows);
    await createOpenAICompatibleModel({
      supabase: supabase as never,
      adminUserId: "admin-1",
      input: {
        upstreamModel: "vendor-model",
        displayName: null,
        baseUrl: "https://gateway.example.com/v1",
        apiKey: "provider-secret",
        accessScope: "all",
      },
    });
    const args = supabase.rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(supabase.rpc.mock.calls[0]?.[0]).toBe("create_openai_compatible_model");
    expect(args.p_model_id).toMatch(/^openai:/);
    expect(args.p_api_key_ciphertext).toMatch(/^v1\./);
    expect(JSON.stringify(args)).not.toContain("provider-secret");
  });

  it("passes null ciphertext to retain a key and nonblank ciphertext to replace it", async () => {
    const supabase = supabaseWithRows([...builtins(), dynamicRow()]);
    const baseInput = {
      upstreamModel: "vendor-model",
      displayName: "Vendor",
      baseUrl: "https://gateway.example.com/v1",
      accessScope: "admins" as const,
      revision: 5,
    };
    await updateOpenAICompatibleModel({
      supabase: supabase as never,
      adminUserId: "admin-1",
      modelId: dynamicRow().model_id,
      input: baseInput,
    });
    expect(supabase.rpc.mock.calls[0]?.[1]).toMatchObject({ p_api_key_ciphertext: null });

    await updateOpenAICompatibleModel({
      supabase: supabase as never,
      adminUserId: "admin-1",
      modelId: dynamicRow().model_id,
      input: { ...baseInput, apiKey: "replacement-secret" },
    });
    const replacement = supabase.rpc.mock.calls[1]?.[1] as Record<string, unknown>;
    expect(replacement.p_api_key_ciphertext).toMatch(/^v1\./);
    expect(JSON.stringify(replacement)).not.toContain("replacement-secret");
  });

  it("requires the expected revision when deleting", async () => {
    const supabase = supabaseWithRows([]);
    await deleteOpenAICompatibleModel({
      supabase: supabase as never,
      adminUserId: "admin-1",
      modelId: dynamicRow().model_id,
      revision: 5,
    });
    expect(supabase.rpc).toHaveBeenCalledWith("delete_openai_compatible_model", {
      p_model_id: dynamicRow().model_id,
      p_expected_revision: 5,
      p_admin_user_id: "admin-1",
    });
  });
});
