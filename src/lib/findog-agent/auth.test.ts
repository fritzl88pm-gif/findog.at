import { describe, expect, it, vi } from "vitest";

import { authenticateFindogAgentAdmin } from "./auth";

vi.mock("@/lib/admin-auth", () => ({ isAdminUser: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));

import { isAdminUser } from "@/lib/admin-auth";
import { authenticateSupabaseRequest } from "@/lib/auth/server";

describe("findog agent admin boundary", () => {
  it("rejects a bearer-authenticated non-admin", async () => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "user-1" });
    vi.mocked(isAdminUser).mockResolvedValue(false);
    await expect(authenticateFindogAgentAdmin(
      new Request("https://findog.at/api/admin/findog-agent/settings"),
      {} as never,
    )).rejects.toMatchObject({ status: 403 });
  });

  it("returns the authenticated administrator", async () => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "admin-1", email: "a@findog.at" });
    vi.mocked(isAdminUser).mockResolvedValue(true);
    await expect(authenticateFindogAgentAdmin(
      new Request("https://findog.at/api/admin/findog-agent/settings"),
      {} as never,
    )).resolves.toEqual({ id: "admin-1", email: "a@findog.at" });
  });
});
