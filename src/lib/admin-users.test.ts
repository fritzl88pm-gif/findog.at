import { beforeEach, describe, expect, it, vi } from "vitest";

import { isAdminUser } from "./admin-auth";
import { authenticateSupabaseRequest } from "./auth/server";
import {
  authenticateAdminRequest,
  managedUserSummary,
  parseManagedUserId,
  parseManagedUserInput,
} from "./admin-users";

vi.mock("./admin-auth", () => ({ isAdminUser: vi.fn() }));
vi.mock("./auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));

describe("admin user management helpers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("authenticates the bearer token and checks admin_users server-side", async () => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "admin-1" });
    vi.mocked(isAdminUser).mockResolvedValue(true);
    const request = new Request("http://localhost/api/admin/users", {
      headers: { Authorization: "Bearer access-token" },
    });
    const supabase = {} as never;

    await expect(authenticateAdminRequest(request, supabase)).resolves.toEqual({ id: "admin-1" });
    expect(authenticateSupabaseRequest).toHaveBeenCalledWith(request, supabase);
    expect(isAdminUser).toHaveBeenCalledWith(supabase, "admin-1");
  });

  it("rejects an authenticated non-admin", async () => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "user-1" });
    vi.mocked(isAdminUser).mockResolvedValue(false);

    await expect(authenticateAdminRequest(new Request("http://localhost"), {} as never))
      .rejects.toMatchObject({ status: 403 });
  });

  it("strictly parses and normalizes create-user input", () => {
    expect(parseManagedUserInput({ email: "  USER@Example.COM ", password: "secret1" }))
      .toEqual({ email: "user@example.com", password: "secret1" });

    expect(() => parseManagedUserInput({
      email: "user@example.com",
      password: "secret1",
      isAdmin: true,
    })).toThrow("ungültige Felder");
    expect(() => parseManagedUserInput({ email: "user@example.com", password: "short" }))
      .toThrow("mindestens 6 Zeichen");
    expect(() => parseManagedUserInput({ email: "not-an-email", password: "secret1" }))
      .toThrow("gültige E-Mail-Adresse");
  });

  it("accepts only canonical UUID user ids", () => {
    expect(parseManagedUserId("11111111-1111-4111-8111-111111111111"))
      .toBe("11111111-1111-4111-8111-111111111111");
    expect(() => parseManagedUserId("../admin")).toThrow("Benutzer-ID ist ungültig");
  });

  it("exposes only the allowed auth profile fields", () => {
    const summary = managedUserSummary({
      id: "user-1",
      email: "user@example.com",
      created_at: "2026-01-01T00:00:00Z",
      last_sign_in_at: "2026-01-02T00:00:00Z",
      app_metadata: { provider: "email", secret: "must-not-leak" },
      user_metadata: { private: "must-not-leak" },
      aud: "authenticated",
    } as never);

    expect(summary).toEqual({
      id: "user-1",
      email: "user@example.com",
      createdAt: "2026-01-01T00:00:00Z",
      lastSignInAt: "2026-01-02T00:00:00Z",
    });
  });
});
