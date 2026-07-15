import { beforeEach, describe, expect, it, vi } from "vitest";

import { isAdminUser } from "@/lib/admin-auth";
import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import {
  globalDefaultModelSetting,
  publicEnabledModelDtos,
  readEffectiveModelSettings,
  readModelDefaultPolicy,
} from "@/lib/model-settings";
import { modelImageUrlMap, readModelImageAssets } from "@/lib/model-images";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GET } from "./route";

vi.mock("@/lib/admin-auth", () => ({
  isAdminUser: vi.fn(),
}));
vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/model-settings", () => ({
  globalDefaultModelSetting: vi.fn(),
  publicEnabledModelDtos: vi.fn(),
  readEffectiveModelSettings: vi.fn(),
  readModelDefaultPolicy: vi.fn(),
}));
vi.mock("@/lib/model-images", () => ({
  modelImageUrlMap: vi.fn(),
  readModelImageAssets: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

describe("GET /api/settings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSupabaseServerClient).mockReturnValue({} as never);
    vi.mocked(isAdminUser).mockResolvedValue(false);
    vi.mocked(readEffectiveModelSettings).mockResolvedValue({
      source: "database",
      models: [],
    });
    vi.mocked(readModelDefaultPolicy).mockResolvedValue({
      modelId: "deepseek-v4-flash", revision: 1, updatedAt: "2026-07-15T00:00:00Z", updatedBy: null,
    });
    vi.mocked(globalDefaultModelSetting).mockReturnValue({ id: "deepseek-v4-flash" } as never);
    vi.mocked(readModelImageAssets).mockResolvedValue([]);
    vi.mocked(modelImageUrlMap).mockReturnValue(new Map());
    vi.mocked(publicEnabledModelDtos).mockReturnValue([
      { id: "deepseek-v4-flash", label: "DeepSeek v4 Flash" },
    ]);
  });

  it("returns 401 without an authenticated bearer token", async () => {
    vi.mocked(authenticateSupabaseRequest).mockRejectedValue(
      new UserVisibleError("Bitte zuerst anmelden.", 401),
    );

    const response = await GET(new Request("http://localhost/api/settings"));

    expect(response.status).toBe(401);
  });

  it("returns the admin status and safe enabled model catalog to an authenticated user", async () => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "user-1" });
    vi.mocked(isAdminUser).mockResolvedValue(true);
    const request = new Request("http://localhost/api/settings", {
      headers: { Authorization: "Bearer access-token" },
    });

    const response = await GET(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      isAdmin: true,
      enabledModels: [{ id: "deepseek-v4-flash", label: "DeepSeek v4 Flash", imageUrl: null }],
      defaultModel: { id: "deepseek-v4-flash", label: "DeepSeek v4 Flash", imageUrl: null },
    });
    expect(isAdminUser).toHaveBeenCalledWith(expect.anything(), "user-1");
    expect(readEffectiveModelSettings).toHaveBeenCalledWith(expect.anything());
    expect(publicEnabledModelDtos).toHaveBeenCalledWith(expect.anything(), true);
  });
  it("passes normal-user status to model filtering", async () => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "user-1" });
    vi.mocked(isAdminUser).mockResolvedValue(false);
    const response = await GET(new Request("http://localhost/api/settings"));
    expect(response.status).toBe(200);
    expect(publicEnabledModelDtos).toHaveBeenCalledWith(expect.anything(), false);
  });

});
