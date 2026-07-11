import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateAdminRequest } from "@/lib/admin-users";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { DELETE, GET } from "./route";

vi.mock("@/lib/admin-users", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin-users")>("@/lib/admin-users");
  return { ...actual, authenticateAdminRequest: vi.fn() };
});
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

function context(userId = USER_ID) {
  return { params: Promise.resolve({ userId }) };
}

function request(method: "GET" | "DELETE") {
  return new Request(`http://localhost/api/admin/users/${USER_ID}`, {
    method,
    headers: { Authorization: "Bearer access-token" },
  });
}

describe("/api/admin/users/:userId", () => {
  const getUserById = vi.fn();
  const rpc = vi.fn();
  const orderId = vi.fn();
  const orderCreated = vi.fn(() => ({ order: orderId }));
  const eq = vi.fn(() => ({ order: orderCreated }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const supabase = { auth: { admin: { getUserById } }, from, rpc };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase as never);
    vi.mocked(authenticateAdminRequest).mockResolvedValue({ id: ADMIN_ID });
    orderId.mockResolvedValue({ data: [], error: null });
  });

  it("returns auth metadata and request-only audit history", async () => {
    getUserById.mockResolvedValue({
      data: { user: {
        id: USER_ID,
        email: "user@example.com",
        created_at: "2026-01-01T00:00:00Z",
        last_sign_in_at: "2026-01-02T00:00:00Z",
        user_metadata: { private: "not-returned" },
      } },
      error: null,
    });
    orderId.mockResolvedValue({
      data: [{
        id: 7,
        conversation_id: "33333333-3333-4333-8333-333333333333",
        content: "Nur die Benutzerfrage",
        created_at: "2026-01-03T00:00:00Z",
        assistant_reply: "must never be returned",
        trace: "must never be returned",
      }],
      error: null,
    });

    const response = await GET(request("GET"), context());

    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("admin_request_history");
    expect(select).toHaveBeenCalledWith("id,conversation_id,content,created_at");
    await expect(response.json()).resolves.toEqual({
      user: {
        id: USER_ID,
        email: "user@example.com",
        createdAt: "2026-01-01T00:00:00Z",
        lastSignInAt: "2026-01-02T00:00:00Z",
      },
      requestCount: 1,
      requests: [{
        id: 7,
        conversationId: "33333333-3333-4333-8333-333333333333",
        content: "Nur die Benutzerfrage",
        createdAt: "2026-01-03T00:00:00Z",
      }],
    });
  });

  it("rejects self-deletion without invoking the atomic RPC", async () => {
    const response = await DELETE(request("DELETE"), context(ADMIN_ID));

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("deletes a managed account only through the atomic database RPC", async () => {
    rpc.mockResolvedValue({ error: null });

    const response = await DELETE(request("DELETE"), context());

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("admin_delete_managed_user", {
      target_user_id: USER_ID,
    });
  });

  it("reports atomic deletion failures", async () => {
    rpc.mockResolvedValue({ error: new Error("database unavailable") });

    const response = await DELETE(request("DELETE"), context());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Das Benutzerkonto konnte nicht gelöscht werden.",
    });
  });
});
