import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateAdminRequest } from "@/lib/admin-users";
import { UserVisibleError } from "@/lib/errors";
import {
  deleteOpenAICompatibleModel,
  parseDeleteOpenAICompatibleModelBody,
  parseUpdateOpenAICompatibleModelBody,
  updateOpenAICompatibleModel,
} from "@/lib/model-settings";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { DELETE, PATCH } from "./route";

vi.mock("@/lib/admin-users", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin-users")>("@/lib/admin-users");
  return { ...actual, authenticateAdminRequest: vi.fn() };
});
vi.mock("@/lib/model-settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/model-settings")>("@/lib/model-settings");
  return {
    ...actual,
    adminModelDtos: vi.fn(() => [{ id: "openai:1", label: "Vendor" }]),
    deleteOpenAICompatibleModel: vi.fn(),
    parseDeleteOpenAICompatibleModelBody: vi.fn(),
    parseUpdateOpenAICompatibleModelBody: vi.fn(),
    updateOpenAICompatibleModel: vi.fn(),
  };
});
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

const modelId = "openai:00000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ modelId }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSupabaseServerClient).mockReturnValue({} as never);
  vi.mocked(authenticateAdminRequest).mockResolvedValue({ id: "admin-1" } as never);
});

describe("admin OpenAI-compatible item route", () => {
  it("updates metadata while allowing an omitted replacement key", async () => {
    const input = { upstreamModel: "vendor", displayName: null, baseUrl: "https://example.com/v1", accessScope: "admins" as const, revision: 7 };
    vi.mocked(parseUpdateOpenAICompatibleModelBody).mockReturnValue(input);
    vi.mocked(updateOpenAICompatibleModel).mockResolvedValue({ id: modelId } as never);
    const response = await PATCH(new Request("http://localhost", { method: "PATCH", body: "{}" }), context);
    expect(response.status).toBe(200);
    expect(updateOpenAICompatibleModel).toHaveBeenCalledWith({ supabase: expect.anything(), adminUserId: "admin-1", modelId, input });
  });

  it("deletes only with the optimistic revision", async () => {
    vi.mocked(parseDeleteOpenAICompatibleModelBody).mockReturnValue({ revision: 7 });
    const response = await DELETE(new Request("http://localhost", { method: "DELETE", body: "{}" }), context);
    expect(response.status).toBe(204);
    expect(deleteOpenAICompatibleModel).toHaveBeenCalledWith({ supabase: expect.anything(), adminUserId: "admin-1", modelId, revision: 7 });
  });

  it("maps optimistic update conflicts to 409 without returning sensitive input", async () => {
    const input = { upstreamModel: "vendor", displayName: null, baseUrl: "https://example.com/v1", apiKey: "replacement-secret", accessScope: "all" as const, revision: 7 };
    vi.mocked(parseUpdateOpenAICompatibleModelBody).mockReturnValue(input);
    vi.mocked(updateOpenAICompatibleModel).mockRejectedValueOnce(new UserVisibleError("Die Modellkonfiguration wurde zwischenzeitlich geändert. Bitte neu laden.", 409));
    const response = await PATCH(new Request("http://localhost", { method: "PATCH", body: "{}" }), context);
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain("replacement-secret");
  });

  it("maps optimistic delete conflicts to 409", async () => {
    vi.mocked(parseDeleteOpenAICompatibleModelBody).mockReturnValue({ revision: 7 });
    vi.mocked(deleteOpenAICompatibleModel).mockRejectedValueOnce(new UserVisibleError("Die Modellkonfiguration wurde zwischenzeitlich geändert. Bitte neu laden.", 409));
    const response = await DELETE(new Request("http://localhost", { method: "DELETE", body: "{}" }), context);
    expect(response.status).toBe(409);
  });
});
