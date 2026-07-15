import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateAdminRequest } from "@/lib/admin-users";
import { UserVisibleError } from "@/lib/errors";
import {
  adminModelDtos,
  assertConfiguredModelsCanBeEnabled,
  createOpenAICompatibleModel,
  parseCreateOpenAICompatibleModelBody,
  parseModelSettingsPatch,
  readModelSettings,
  updateModelSettings,
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
    createOpenAICompatibleModel: vi.fn(),
    parseCreateOpenAICompatibleModelBody: vi.fn(),
    parseModelSettingsPatch: vi.fn(),
    readModelSettings: vi.fn(),
    updateModelSettings: vi.fn(),
  };
});
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

const input = {
  upstreamModel: "vendor-model",
  displayName: null,
  baseUrl: "https://gateway.example.com/v1",
  apiKey: "provider-secret",
  accessScope: "all" as const,
};

function request(method: string, body?: unknown) {
  return new Request("http://localhost/api/admin/models", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSupabaseServerClient).mockReturnValue({} as never);
  vi.mocked(authenticateAdminRequest).mockResolvedValue({ id: "admin-1" } as never);
  vi.mocked(parseCreateOpenAICompatibleModelBody).mockReturnValue(input);
  vi.mocked(createOpenAICompatibleModel).mockResolvedValue({ id: "openai:00000000-0000-4000-8000-000000000001" } as never);
  vi.mocked(adminModelDtos).mockReturnValue([{ id: "openai:1", label: "vendor-model" }] as never);
});

describe("admin OpenAI-compatible model collection route", () => {
  it("requires admin authentication for listing", async () => {
    vi.mocked(readModelSettings).mockResolvedValue({ source: "database", models: [] });
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect(authenticateAdminRequest).toHaveBeenCalled();
  });

  it("creates with a required API key without returning it", async () => {
    const response = await POST(request("POST", input));
    expect(response.status).toBe(201);
    expect(createOpenAICompatibleModel).toHaveBeenCalledWith({
      supabase: expect.anything(),
      adminUserId: "admin-1",
      input,
    });
    expect(JSON.stringify(await response.json())).not.toContain("provider-secret");
  });

  it("rejects non-admin creation before parsing provider credentials", async () => {
    vi.mocked(authenticateAdminRequest).mockRejectedValueOnce(new UserVisibleError("Keine Berechtigung.", 403));
    const response = await POST(request("POST", input));
    expect(response.status).toBe(403);
    expect(createOpenAICompatibleModel).not.toHaveBeenCalled();
  });

  it("keeps the built-in catalog PATCH path unchanged", async () => {
    const requested = [{ id: "deepseek-v4-flash", enabled: true, reasoning: "disabled", revision: 1 }] as never;
    vi.mocked(parseModelSettingsPatch).mockReturnValue(requested);
    vi.mocked(readModelSettings).mockResolvedValue({ source: "database", models: [] });
    vi.mocked(updateModelSettings).mockResolvedValue({ source: "database", models: [] });
    const response = await PATCH(request("PATCH", { models: [] }));
    expect(response.status).toBe(200);
    expect(assertConfiguredModelsCanBeEnabled).toHaveBeenCalled();
    expect(updateModelSettings).toHaveBeenCalled();
  });
});
