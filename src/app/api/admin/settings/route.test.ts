import { beforeEach, describe, expect, it, vi } from "vitest";

import { isAdminUser } from "@/lib/admin-auth";
import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { getGlobalSystemPromptRecord, updateGlobalSystemPrompt } from "@/lib/global-system-prompt";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GET, PUT } from "./route";

vi.mock("@/lib/admin-auth", () => ({ isAdminUser: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/global-system-prompt", () => ({
  getGlobalSystemPromptRecord: vi.fn(),
  updateGlobalSystemPrompt: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

describe("BFG PRO system prompt settings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ auth: {} } as never);
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "admin-1" });
    vi.mocked(isAdminUser).mockResolvedValue(true);
    vi.mocked(getGlobalSystemPromptRecord).mockResolvedValue({
      systemPrompt: "Prompt",
      updatedAt: "2026-07-19T08:00:00.000Z",
      updatedBy: "admin-1",
    });
  });

  it("returns no retired research or model settings", async () => {
    const response = await GET(new Request("https://findog.at/api/admin/settings"));
    await expect(response.json()).resolves.toEqual({
      systemPrompt: "Prompt",
      updatedAt: "2026-07-19T08:00:00.000Z",
      updatedBy: "admin-1",
    });
  });

  it("updates only the BFG PRO system prompt", async () => {
    const response = await PUT(new Request("https://findog.at/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemPrompt: "Neu" }),
    }));
    expect(response.status).toBe(200);
    expect(updateGlobalSystemPrompt).toHaveBeenCalledWith(expect.anything(), "admin-1", "Neu");
  });

  it("rejects the retired result limit", async () => {
    const response = await PUT(new Request("https://findog.at/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ researchResultLimit: 10 }),
    }));
    expect(response.status).toBe(400);
  });
});
