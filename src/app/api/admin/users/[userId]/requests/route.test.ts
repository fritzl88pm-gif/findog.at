import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateAdminRequest } from "@/lib/admin-users";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { DELETE } from "./route";

vi.mock("@/lib/admin-users", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin-users")>("@/lib/admin-users");
  return { ...actual, authenticateAdminRequest: vi.fn() };
});
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

const USER_ID = "22222222-2222-4222-8222-222222222222";

describe("DELETE /api/admin/users/:userId/requests", () => {
  const eq = vi.fn();
  const deleteRows = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ delete: deleteRows }));

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never);
    vi.mocked(authenticateAdminRequest).mockResolvedValue({ id: "admin-1" });
    eq.mockResolvedValue({ error: null });
  });

  it("deletes only request audit rows for the selected user", async () => {
    const response = await DELETE(
      new Request(`http://localhost/api/admin/users/${USER_ID}/requests`, {
        method: "DELETE",
        headers: { Authorization: "Bearer access-token" },
      }),
      { params: Promise.resolve({ userId: USER_ID }) },
    );

    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("admin_request_history");
    expect(eq).toHaveBeenCalledWith("user_id", USER_ID);
  });

  it("surfaces audit deletion failures", async () => {
    eq.mockResolvedValue({ error: new Error("database unavailable") });

    const response = await DELETE(
      new Request(`http://localhost/api/admin/users/${USER_ID}/requests`, { method: "DELETE" }),
      { params: Promise.resolve({ userId: USER_ID }) },
    );

    expect(response.status).toBe(503);
  });
});
