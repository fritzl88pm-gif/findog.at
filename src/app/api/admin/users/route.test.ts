import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateAdminRequest } from "@/lib/admin-users";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GET, POST } from "./route";

vi.mock("@/lib/admin-users", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin-users")>("@/lib/admin-users");
  return { ...actual, authenticateAdminRequest: vi.fn() };
});
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

const listUsers = vi.fn();
const createUser = vi.fn();
const supabase = { auth: { admin: { listUsers, createUser } } };

function request(method: "GET" | "POST", body?: unknown) {
  return new Request("http://localhost/api/admin/users", {
    method,
    headers: {
      Authorization: "Bearer access-token",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("/api/admin/users", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase as never);
    vi.mocked(authenticateAdminRequest).mockResolvedValue({ id: "admin-1" });
  });

  it("does not call service-role Auth when admin authorization fails", async () => {
    vi.mocked(authenticateAdminRequest).mockRejectedValue(
      new UserVisibleError("Du hast keine Administrationsberechtigung.", 403),
    );

    const response = await GET(request("GET"));

    expect(response.status).toBe(403);
    expect(listUsers).not.toHaveBeenCalled();
  });

  it("lists only account id, email, creation time, and last login", async () => {
    listUsers.mockResolvedValue({
      data: {
        nextPage: null,
        users: [{
          id: "user-1",
          email: "user@example.com",
          created_at: "2026-01-01T00:00:00Z",
          last_sign_in_at: null,
          app_metadata: { secret: "not-returned" },
        }],
      },
      error: null,
    });

    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      users: [{
        id: "user-1",
        email: "user@example.com",
        createdAt: "2026-01-01T00:00:00Z",
        lastSignInAt: null,
      }],
    });
    expect(listUsers).toHaveBeenCalledWith({ page: 1, perPage: 1_000 });
  });

  it("creates an email-confirmed password user through service-role Auth", async () => {
    createUser.mockResolvedValue({
      data: { user: {
        id: "user-2",
        email: "new@example.com",
        created_at: "2026-01-03T00:00:00Z",
      } },
      error: null,
    });

    const response = await POST(request("POST", {
      email: " NEW@Example.COM ",
      password: "secret1",
    }));

    expect(response.status).toBe(201);
    expect(createUser).toHaveBeenCalledWith({
      email: "new@example.com",
      password: "secret1",
      email_confirm: true,
    });
  });

  it("rejects extra create fields before calling Auth", async () => {
    const response = await POST(request("POST", {
      email: "new@example.com",
      password: "secret1",
      role: "admin",
    }));

    expect(response.status).toBe(400);
    expect(createUser).not.toHaveBeenCalled();
  });

  it("reports service-role user creation failures without returning provider details", async () => {
    createUser.mockResolvedValue({
      data: { user: null },
      error: new Error("sensitive provider detail"),
    });

    const response = await POST(request("POST", {
      email: "new@example.com",
      password: "secret1",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Das Benutzerkonto konnte nicht erstellt werden.",
    });
  });
});
