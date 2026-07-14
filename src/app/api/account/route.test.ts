import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { DELETE } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

const USER_ID = "22222222-2222-4222-8222-222222222222";

function request() {
  return new Request("http://localhost/api/account", {
    method: "DELETE",
    headers: { Authorization: "Bearer access-token" },
  });
}

describe("DELETE /api/account", () => {
  const rpc = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({
      id: USER_ID,
      email: "user@example.com",
    });
  });

  it("authenticates before attempting account deletion", async () => {
    vi.mocked(authenticateSupabaseRequest).mockRejectedValue(
      new UserVisibleError("Bitte zuerst anmelden.", 401),
    );

    const response = await DELETE(request());

    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("deletes exactly the authenticated account through the atomic RPC", async () => {
    rpc.mockResolvedValue({ error: null });

    const response = await DELETE(request());

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("admin_delete_managed_user", {
      target_user_id: USER_ID,
    });
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it("does not expose service errors", async () => {
    rpc.mockResolvedValue({ error: new Error("private database details") });

    const response = await DELETE(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Das Benutzerkonto konnte nicht gelöscht werden.",
    });
  });

  it("fails safely when account services are unavailable", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValue(null);

    const response = await DELETE(request());

    expect(response.status).toBe(503);
    expect(authenticateSupabaseRequest).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
