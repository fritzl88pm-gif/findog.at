import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateAdminRequest } from "@/lib/admin-users";
import { UserVisibleError } from "@/lib/errors";
import {
  adminModelDtos,
  assertConfiguredModelsCanBeEnabled,
  createDynamicModel,
  parseCreateDynamicModelBody,
  readModelSettings,
  updateModelSettings,
  type ModelSettingsSnapshot,
} from "@/lib/model-settings";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GET, PATCH, POST } from "./route";

vi.mock("@/lib/admin-users", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin-users")>("@/lib/admin-users");
  return { ...actual, authenticateAdminRequest: vi.fn() };
});
vi.mock("@/lib/model-settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/model-settings")>("@/lib/model-settings");
  return {
    ...actual,
    adminModelDtos: vi.fn(),
    assertConfiguredModelsCanBeEnabled: vi.fn(),
    createDynamicModel: vi.fn(),
    parseCreateDynamicModelBody: vi.fn(),
    readModelSettings: vi.fn(),
    updateModelSettings: vi.fn(),
  };
});
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/laozhang-key", () => ({ isLaoZhangApiKeyConfigured: vi.fn() }));
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual };
});

const snapshot: ModelSettingsSnapshot = {
  source: "database",
  models: [
    {
      id: "deepseek-v4-flash",
      displayName: null,
      provider: "deepseek",
      upstreamModel: "deepseek-v4-flash",
      isDynamic: false as const,
      alwaysEnabled: true,
      enabled: true,
      reasoning: "disabled",
      revision: 1,
      updatedAt: "2026-07-14T12:00:00Z",
      updatedBy: null,
    },
  ],
};
const dto = [{
  id: "deepseek-v4-flash",
  label: "DeepSeek v4 Flash",
  enabled: true,
  alwaysEnabled: true,
  reasoning: "disabled",
  reasoningOptions: [{ value: "disabled", label: "Deaktiviert" }],
  providerConfigured: true,
  revision: 1,
  updatedAt: "2026-07-14T12:00:00Z",
}];
const requested = [
  { id: "deepseek-v4-flash", enabled: true, reasoning: "disabled", revision: 1 },
  { id: "deepseek-v4-pro", enabled: true, reasoning: "high", revision: 2 },
  { id: "glm-5.2", enabled: false, reasoning: "max", revision: 3 },
  { id: "glm-5-turbo", enabled: false, reasoning: "enabled", revision: 4 },
];

function request(method: "GET" | "PATCH" | "POST", body?: unknown): Request {
  return new Request("http://localhost/api/admin/models", {
    method,
    headers: {
      Authorization: "Bearer access-token",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("/api/admin/models", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.mocked(getSupabaseServerClient).mockReturnValue({} as never);
    vi.mocked(authenticateAdminRequest).mockResolvedValue({ id: "admin-1" });
    vi.mocked(readModelSettings).mockResolvedValue(snapshot);
    vi.mocked(updateModelSettings).mockResolvedValue(snapshot);
    vi.mocked(adminModelDtos).mockReturnValue(dto as never);
    const { isLaoZhangApiKeyConfigured } = await import("@/lib/laozhang-key");
    vi.mocked(isLaoZhangApiKeyConfigured).mockReturnValue(true);
  });

  describe("GET", () => {
    it("requires administrator authorization before reading settings", async () => {
      vi.mocked(authenticateAdminRequest).mockRejectedValue(
        new UserVisibleError("Du hast keine Administrationsberechtigung.", 403),
      );

      const response = await GET(request("GET"));

      expect(response.status).toBe(403);
      expect(readModelSettings).not.toHaveBeenCalled();
    });

    it("returns only the safe fixed-catalog administration DTO", async () => {
      const response = await GET(request("GET"));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ models: dto });
      expect(adminModelDtos).toHaveBeenCalledWith(snapshot);
    });
  });

  describe("PATCH", () => {
    it("persists a validated full-catalog patch under the administrator id", async () => {
      const response = await PATCH(request("PATCH", { models: requested }));

      expect(response.status).toBe(200);
      expect(assertConfiguredModelsCanBeEnabled).toHaveBeenCalledWith(snapshot, requested);
      expect(updateModelSettings).toHaveBeenCalledWith({
        supabase: expect.anything(),
        adminUserId: "admin-1",
        current: snapshot,
        requested,
      });
    });

    it("blocks enabling a provider that has no server-side key", async () => {
      vi.mocked(assertConfiguredModelsCanBeEnabled).mockImplementationOnce(() => {
        throw new UserVisibleError("Provider nicht konfiguriert.", 400);
      });

      const response = await PATCH(request("PATCH", { models: requested }));

      expect(response.status).toBe(400);
      expect(updateModelSettings).not.toHaveBeenCalled();
    });

    it("rejects malformed JSON without reading or writing settings", async () => {
      const malformed = new Request("http://localhost/api/admin/models", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{",
      });

      const response = await PATCH(malformed);

      expect(response.status).toBe(400);
      expect(readModelSettings).not.toHaveBeenCalled();
      expect(updateModelSettings).not.toHaveBeenCalled();
    });
  });

  describe("POST", () => {
    beforeEach(() => {
      vi.mocked(createDynamicModel).mockResolvedValue({
        id: "laozhang:00000000-0000-4000-8000-000000000001",
        displayName: "GLM-5.2 (LaoZhang)",
        provider: "laozhang",
        upstreamModel: "glm-5.2",
        isDynamic: true as const,
        alwaysEnabled: false as const,
        enabled: false,
        reasoning: "disabled" as const,
        revision: 5,
        updatedAt: "2026-07-15T12:00:00Z",
        updatedBy: null,
      });
      vi.mocked(parseCreateDynamicModelBody).mockReturnValue({
        displayName: "GLM-5.2 (LaoZhang)",
        upstreamModel: "glm-5.2",
      });
    });

    it("requires administrator authorization before body handling", async () => {
      vi.mocked(authenticateAdminRequest).mockRejectedValue(
        new UserVisibleError("Du hast keine Administrationsberechtigung.", 403),
      );

      const response = await POST(request("POST", {
        displayName: "Test",
        upstreamModel: "test-model",
      }));

      expect(response.status).toBe(403);
      expect(createDynamicModel).not.toHaveBeenCalled();
    });

    it("succeeds without LAOZHANG_API_KEY configured (creation starts disabled)", async () => {
      vi.mocked(adminModelDtos).mockReturnValue([{
        id: "laozhang:00000000-0000-4000-8000-000000000001",
        label: "GLM-5.2 (LaoZhang)",
        enabled: false,
        alwaysEnabled: false,
        reasoning: "disabled",
        reasoningOptions: [{ value: "disabled", label: "Deaktiviert" }],
        providerConfigured: false,
        revision: 5,
        updatedAt: null,
        provider: "laozhang",
        upstreamModel: "glm-5.2",
      }] as never);

      const response = await POST(request("POST", {
        displayName: "GLM-5.2 (LaoZhang)",
        upstreamModel: "glm-5.2",
      }));

      expect(response.status).toBe(201);
      expect(parseCreateDynamicModelBody).toHaveBeenCalled();
      expect(createDynamicModel).toHaveBeenCalledWith({
        supabase: expect.anything(),
        adminUserId: "admin-1",
        input: { displayName: "GLM-5.2 (LaoZhang)", upstreamModel: "glm-5.2" },
      });
    });

    it("rejects duplicate/conflict and maps to 409 safely", async () => {
      vi.mocked(createDynamicModel).mockRejectedValueOnce(
        new UserVisibleError(
          "Ein Modell mit derselben LaoZhang-Modell-ID ist bereits konfiguriert.",
          409,
        ),
      );

      const response = await POST(request("POST", {
        displayName: "Duplicate",
        upstreamModel: "glm-5.2",
      }));

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: "Ein Modell mit derselben LaoZhang-Modell-ID ist bereits konfiguriert.",
      });
    });

    it("rejects malformed JSON body", async () => {
      const malformed = new Request("http://localhost/api/admin/models", {
        method: "POST",
        headers: {
          Authorization: "Bearer access-token",
          "Content-Type": "application/json",
        },
        body: "not-json",
      });

      const response = await POST(malformed);

      expect(response.status).toBe(400);
      expect(createDynamicModel).not.toHaveBeenCalled();
    });
  });
});
