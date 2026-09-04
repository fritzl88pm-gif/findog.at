import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateAdminRequest } from "@/lib/admin-users";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { DELETE } from "./route";
import { UserVisibleError } from "@/lib/errors";

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

  it("retires the endpoint without deleting messages or audit metadata", async () => {
    const response = await DELETE(
      new Request(`http://localhost/api/admin/users/${USER_ID}/requests`, {
        method: "DELETE",
        headers: { Authorization: "Bearer access-token" },
      }),
      { params: Promise.resolve({ userId: USER_ID }) },
    );

    expect(response.status).toBe(410);
    expect(authenticateAdminRequest).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects non-admin callers before returning retirement details", async () => {
    vi.mocked(authenticateAdminRequest).mockRejectedValue(new UserVisibleError("Nicht erlaubt", 403));

    const response = await DELETE(
      new Request(`http://localhost/api/admin/users/${USER_ID}/requests`, { method: "DELETE" }),
      { params: Promise.resolve({ userId: USER_ID }) },
    );

    expect(response.status).toBe(403);
    expect(from).not.toHaveBeenCalled();
  });
});
