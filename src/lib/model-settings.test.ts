import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { encryptOpenAICompatibleApiKey } from "./openai-compatible-credentials";

import {
  adminModelDtos,
  assertConfiguredModelsCanBeEnabled,
  parseModelSettingsPatch,
  publicEnabledModelDtos,
  readEffectiveModelSettings,
  readModelSettings,
  updateModelSettings,
  type ModelSettingMutation,
  type ModelSettingsSnapshot,
} from "./model-settings";

const originalDeepSeekKey = process.env.DEEPSEEK_API_KEY;
const originalGlobalDeepSeekKey = process.env.GLOBAL_DEEPSEEK_API_KEY;
const originalZaiKey = process.env.ZAI_API_KEY;
const originalOpenAICompatibleCredentialsKey = process.env.OPENAI_COMPATIBLE_CREDENTIALS_KEY;

function testCiphertext(): string {
  process.env.OPENAI_COMPATIBLE_CREDENTIALS_KEY = randomBytes(32).toString("base64");
  return encryptOpenAICompatibleApiKey("provider-secret");
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

afterEach(() => {
  restore("DEEPSEEK_API_KEY", originalDeepSeekKey);
  restore("GLOBAL_DEEPSEEK_API_KEY", originalGlobalDeepSeekKey);
  restore("ZAI_API_KEY", originalZaiKey);
  restore("OPENAI_COMPATIBLE_CREDENTIALS_KEY", originalOpenAICompatibleCredentialsKey);
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
        always_enabled: false,
        enabled: true,
        reasoning_setting: "disabled",
        revision: 1,
        updated_at: "2026-07-14T12:00:01.000Z",
        updated_by: null,
      },
    ];
  }

function requestedSettings(): ModelSettingMutation[] {
  return [
    { id: "deepseek-v4-flash", enabled: true, reasoning: "disabled", revision: 1 },
    { id: "deepseek-v4-pro", enabled: true, reasoning: "high", revision: 2 },
    { id: "glm-5.2", enabled: false, reasoning: "max", revision: 3 },
    { id: "glm-5-turbo", enabled: false, reasoning: "enabled", revision: 4 },
  ];
}

function readClient(result: { data: unknown; error: unknown }) {
  const select = vi.fn().mockResolvedValue(result);
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from }, from, select };
}

describe("model settings repository", () => {
  it("loads all fixed catalog rows in catalog order", async () => {
    const fake = readClient({ data: storedRows(), error: null });

    const snapshot = await readModelSettings(fake.client as never);

    expect(snapshot.source).toBe("database");
    expect(snapshot.models.map((setting) => setting.id)).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "glm-5.2",
      "glm-5-turbo",
    ]);
    expect(fake.from).toHaveBeenCalledWith("model_settings");
  });

  it("fails closed when the table read fails or is incomplete", async () => {
    const failed = readClient({ data: null, error: new Error("offline") });
    const incomplete = readClient({ data: storedRows().slice(0, 3), error: null });

    await expect(readEffectiveModelSettings(failed.client as never)).rejects.toMatchObject({ status: 503 });
    await expect(readEffectiveModelSettings(incomplete.client as never)).rejects.toMatchObject({ status: 503 });
    await expect(readModelSettings(failed.client as never)).rejects.toMatchObject({ status: 503 });
  });

  it("strictly parses one complete fixed-catalog patch", () => {
    expect(parseModelSettingsPatch({ models: requestedSettings() })).toEqual(requestedSettings());
    expect(() => parseModelSettingsPatch({ models: requestedSettings().slice(0, 3) }))
      .toThrow("vollständigen Katalog");
    expect(() => parseModelSettingsPatch({
      models: requestedSettings().map((setting) => setting.id === "deepseek-v4-flash"
        ? { ...setting, enabled: false }
        : setting),
    })).not.toThrow();
    expect(() => parseModelSettingsPatch({
      models: requestedSettings().map((setting) => setting.id === "glm-5-turbo"
        ? { ...setting, reasoning: "max" }
        : setting),
    })).toThrow("ungültige Werte");
  });

  it("blocks only a newly enabled model whose provider is not configured", async () => {
    const current = await readModelSettings(readClient({ data: storedRows(), error: null }).client as never);
    const enablingGlm = requestedSettings().map((setting) => setting.id === "glm-5.2"
      ? { ...setting, enabled: true }
      : setting);

    expect(() => assertConfiguredModelsCanBeEnabled(
      current,
      enablingGlm,
      (model) => model !== "glm-5.2",
    )).toThrow("ohne konfigurierten Provider");
    expect(() => assertConfiguredModelsCanBeEnabled(
      current,
      requestedSettings(),
      () => false,
    )).not.toThrow();
  });

  it("writes only changed rows with the administrator id and reloads revisions", async () => {
    const select = vi.fn().mockResolvedValue({ data: storedRows(), error: null });
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ select });
    const current = await readModelSettings(readClient({ data: storedRows(), error: null }).client as never);
    const requested = requestedSettings().map((setting) => setting.id === "glm-5-turbo"
      ? { ...setting, enabled: true }
      : setting);

    await updateModelSettings({
      supabase: { from, rpc } as never,
      adminUserId: "admin-1",
      current,
      requested,
    });

    expect(rpc).toHaveBeenCalledWith("update_model_settings", {
      p_admin_user_id: "admin-1",
      p_changes: [{
        model_id: "glm-5-turbo",
        enabled: true,
        reasoning_setting: "enabled",
        expected_revision: 4,
      }],
    });
  });

  it("surfaces optimistic revision conflicts without a partial retry", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { code: "40001" } });
    const current = await readModelSettings(readClient({ data: storedRows(), error: null }).client as never);
    const requested = requestedSettings().map((setting) => setting.id === "glm-5-turbo"
      ? { ...setting, enabled: true }
      : setting);

    await expect(updateModelSettings({
      supabase: { from: vi.fn(), rpc } as never,
      adminUserId: "admin-1",
      current,
      requested,
    })).rejects.toMatchObject({ status: 409 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("uses the client snapshot revision rather than the freshly read revision", async () => {
    const select = vi.fn().mockResolvedValue({ data: storedRows(), error: null });
    const rpc = vi.fn().mockResolvedValue({ error: { code: "40001" } });
    const current = await readModelSettings(readClient({ data: storedRows(), error: null }).client as never);
    const requested = requestedSettings().map((setting) => setting.id === "glm-5-turbo"
      ? { ...setting, enabled: true, revision: 2 }
      : setting);

    await expect(updateModelSettings({
      supabase: { from: vi.fn().mockReturnValue({ select }), rpc } as never,
      adminUserId: "admin-1",
      current,
      requested,
    })).rejects.toMatchObject({ status: 409 });
    expect(rpc).toHaveBeenCalledWith("update_model_settings", {
      p_admin_user_id: "admin-1",
      p_changes: [expect.objectContaining({
        model_id: "glm-5-turbo",
        expected_revision: 2,
      })],
    });
  });

  it("builds safe public/admin DTOs without exposing provider keys", async () => {
    process.env.DEEPSEEK_API_KEY = "deepseek-secret";
    process.env.ZAI_API_KEY = "zai-secret";
    const snapshot = await readModelSettings(readClient({ data: storedRows(), error: null }).client as never);

    expect(publicEnabledModelDtos(snapshot)).toEqual([
      { id: "deepseek-v4-flash", label: "DeepSeek v4 Flash", imageAssetId: null },
      { id: "deepseek-v4-pro", label: "DeepSeek v4 Pro", imageAssetId: null },
    ]);
    expect(adminModelDtos(snapshot)).toContainEqual(expect.objectContaining({
      id: "glm-5.2",
      enabled: false,
      reasoning: "max",
      revision: 3,
      providerConfigured: true,
      reasoningOptions: [
        { value: "disabled", label: "Deaktiviert" },
        { value: "high", label: "Hoch" },
        { value: "max", label: "Maximal" },
      ],
    }));
    expect(JSON.stringify(adminModelDtos(snapshot))).not.toContain("zai-secret");
  });

});

describe("admin model DTO separation", () => {
  it("publicEnabledModelDtos returns only model label for dynamic rows, no provider/upstream", () => {
    const snapshot: ModelSettingsSnapshot = {
      source: "database",
      models: [
        {
          id: "deepseek-v4-flash",
          displayName: null,
          provider: "deepseek",
          upstreamModel: "deepseek-v4-flash",
          isDynamic: false,
          alwaysEnabled: false,
          enabled: true,
          reasoning: "disabled",
          revision: 1,
          updatedAt: "2026-07-14T12:00:01Z",
          updatedBy: null,
        },
        {
          id: "deepseek-v4-pro",
          displayName: null,
          provider: "deepseek",
          upstreamModel: "deepseek-v4-pro",
          isDynamic: false,
          alwaysEnabled: false,
          enabled: true,
          reasoning: "high",
          revision: 2,
          updatedAt: "2026-07-14T12:00:02Z",
          updatedBy: null,
        },
        {
          id: "glm-5.2",
          displayName: null,
          provider: "zai",
          upstreamModel: "glm-5.2",
          isDynamic: false,
          alwaysEnabled: false,
          enabled: false,
          reasoning: "max",
          revision: 3,
          updatedAt: "2026-07-14T12:00:03Z",
          updatedBy: null,
        },
        {
          id: "glm-5-turbo",
          displayName: null,
          provider: "zai",
          upstreamModel: "glm-5-turbo",
          isDynamic: false,
          alwaysEnabled: false,
          enabled: false,
          reasoning: "enabled",
          revision: 4,
          updatedAt: "2026-07-14T12:00:04Z",
          updatedBy: null,
        },
        {
          id: "openai:00000000-0000-4000-8000-000000000002",
          displayName: "Qwen3 Gateway",
          provider: "openai_compatible",
          upstreamModel: "qwen3-72b",
          baseUrl: "https://gateway.example.com/v1",
          accessScope: "all",
          apiKeyCiphertext: testCiphertext(),
          isDynamic: true,
          alwaysEnabled: false,
          enabled: true,
          reasoning: "disabled",
          revision: 6,
          updatedAt: "2026-07-15T12:00:01Z",
          updatedBy: null,
        },
      ],
    };

    process.env.DEEPSEEK_API_KEY = "ds-secret";
    process.env.ZAI_API_KEY = "zai-secret";

    const dtos = publicEnabledModelDtos(snapshot);
    const dynamicDtos = dtos.filter((d) => d.id.startsWith("openai:"));
    expect(dynamicDtos).toHaveLength(1);
    expect(dynamicDtos[0]).toEqual({
      id: "openai:00000000-0000-4000-8000-000000000002",
      label: "Qwen3 Gateway",
      imageAssetId: null,
    });
    // The normal user menu receives only presentation fields, never provider credentials.
    expect(Object.keys(dynamicDtos[0])).toEqual(["id", "label", "imageAssetId"]);
  });

  it("adminModelDtos separates dynamic models with provider metadata", () => {
    const snapshot: ModelSettingsSnapshot = {
      source: "database",
      models: [
        {
          id: "deepseek-v4-flash",
          displayName: null,
          provider: "deepseek",
          upstreamModel: "deepseek-v4-flash",
          isDynamic: false,
          alwaysEnabled: false,
          enabled: true,
          reasoning: "disabled",
          revision: 1,
          updatedAt: "2026-07-14T12:00:01Z",
          updatedBy: null,
        },
        {
          id: "deepseek-v4-pro",
          displayName: null,
          provider: "deepseek",
          upstreamModel: "deepseek-v4-pro",
          isDynamic: false,
          alwaysEnabled: false,
          enabled: true,
          reasoning: "high",
          revision: 2,
          updatedAt: "2026-07-14T12:00:02Z",
          updatedBy: null,
        },
        {
          id: "glm-5.2",
          displayName: null,
          provider: "zai",
          upstreamModel: "glm-5.2",
          isDynamic: false,
          alwaysEnabled: false,
          enabled: false,
          reasoning: "max",
          revision: 3,
          updatedAt: "2026-07-14T12:00:03Z",
          updatedBy: null,
        },
        {
          id: "glm-5-turbo",
          displayName: null,
          provider: "zai",
          upstreamModel: "glm-5-turbo",
          isDynamic: false,
          alwaysEnabled: false,
          enabled: false,
          reasoning: "enabled",
          revision: 4,
          updatedAt: "2026-07-14T12:00:04Z",
          updatedBy: null,
        },
        {
          id: "openai:00000000-0000-4000-8000-000000000002",
          displayName: "Qwen3 Gateway",
          provider: "openai_compatible",
          upstreamModel: "qwen3-72b",
          baseUrl: "https://gateway.example.com/v1",
          accessScope: "all",
          apiKeyCiphertext: testCiphertext(),
          isDynamic: true,
          alwaysEnabled: false,
          enabled: true,
          reasoning: "disabled",
          revision: 6,
          updatedAt: "2026-07-15T12:00:01Z",
          updatedBy: null,
        },
      ],
    };

    process.env.DEEPSEEK_API_KEY = "ds-secret";
    process.env.ZAI_API_KEY = "zai-secret";

    const dtos = adminModelDtos(snapshot);
    const builtinDtos = dtos.filter((d) => !d.provider || d.provider !== "openai_compatible");
    const dynamicDtos = dtos.filter((d) => d.provider === "openai_compatible");

    expect(builtinDtos).toHaveLength(4);
    expect(dynamicDtos).toHaveLength(1);
    expect(dynamicDtos[0]).toMatchObject({
      id: "openai:00000000-0000-4000-8000-000000000002",
      label: "Qwen3 Gateway",
      alwaysEnabled: false,
      provider: "openai_compatible",
    });
  });
});
