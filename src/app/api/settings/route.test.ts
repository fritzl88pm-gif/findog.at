import { beforeEach, describe, expect, it, vi } from "vitest";

import { getGlobalSystemPrompt, isAdminUser } from "@/lib/admin-settings";
import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GET } from "./route";

vi.mock("@/lib/admin-settings", () => ({
  getGlobalSystemPrompt: vi.fn(),
  isAdminUser: vi.fn(),
}));
vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

describe("GET /api/settings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSupabaseServerClient).mockReturnValue({} as never);
    vi.mocked(getGlobalSystemPrompt).mockResolvedValue("Aktueller globaler Prompt");
    vi.mocked(isAdminUser).mockResolvedValue(false);
  });

  it("returns 401 without an authenticated bearer token", async () => {
    vi.mocked(authenticateSupabaseRequest).mockRejectedValue(
      new UserVisibleError("Bitte zuerst anmelden.", 401),
    );

    const response = await GET(new Request("http://localhost/api/settings"));

    expect(response.status).toBe(401);
    expect(getGlobalSystemPrompt).not.toHaveBeenCalled();
  });

  it("returns the global prompt and database-backed admin status to an authenticated user", async () => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "user-1" });
    vi.mocked(isAdminUser).mockResolvedValue(true);
    const request = new Request("http://localhost/api/settings", {
      headers: { Authorization: "Bearer access-token" },
    });

    const response = await GET(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      globalSystemPrompt: "Aktueller globaler Prompt",
      isAdmin: true,
    });
    expect(isAdminUser).toHaveBeenCalledWith(expect.anything(), "user-1");
  });
});
