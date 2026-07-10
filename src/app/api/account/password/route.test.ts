import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import {
  getSupabasePasswordVerifierClient,
  getSupabaseServerClient,
} from "@/lib/supabase/server";
import { PUT } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabasePasswordVerifierClient: vi.fn(),
  getSupabaseServerClient: vi.fn(),
}));

const signInWithPassword = vi.fn();
const updateUserById = vi.fn();
const serviceClient = {
  auth: {
    admin: { updateUserById },
  },
};
const verifierClient = {
  auth: { signInWithPassword },
};

function request(body?: unknown, authorization = "Bearer access-token") {
  return new Request("http://localhost/api/account/password", {
    method: "PUT",
    headers: {
      ...(authorization ? { Authorization: authorization } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const validBody = {
  currentPassword: "altes-passwort",
  newPassword: "neues-passwort",
  confirmation: "neues-passwort",
};

describe("PUT /api/account/password", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSupabaseServerClient).mockReturnValue(serviceClient as never);
    vi.mocked(getSupabasePasswordVerifierClient).mockReturnValue(verifierClient as never);
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({
      id: "authenticated-user",
      email: "user@findog.at",
    });
    signInWithPassword.mockResolvedValue({ data: { user: { id: "authenticated-user" } }, error: null });
    updateUserById.mockResolvedValue({ data: { user: { id: "authenticated-user" } }, error: null });
  });

  it.each([
    ["missing", ""],
    ["invalid", "Bearer invalid-token"],
  ])("returns 401 for a %s bearer token", async (_label, authorization) => {
    vi.mocked(authenticateSupabaseRequest).mockRejectedValueOnce(
      new UserVisibleError("Bitte zuerst anmelden.", 401),
    );

    const response = await PUT(request(validBody, authorization));

    expect(response.status).toBe(401);
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("returns a user-visible service error when server configuration is missing", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValueOnce(null);

    const response = await PUT(request(validBody));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Die Passwortänderung ist derzeit nicht verfügbar.",
    });
    expect(authenticateSupabaseRequest).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON and extra fields with 400", async () => {
    const malformedRequest = new Request("http://localhost/api/account/password", {
      method: "PUT",
      headers: {
        Authorization: "Bearer access-token",
        "Content-Type": "application/json",
      },
      body: "{",
    });
    const malformedResponse = await PUT(malformedRequest);
    const extraFieldResponse = await PUT(request({ ...validBody, userId: "other-user" }));

    expect(malformedResponse.status).toBe(400);
    await expect(malformedResponse.json()).resolves.toEqual({
      error: "Die Anfrage enthält kein gültiges JSON.",
    });
    expect(extraFieldResponse.status).toBe(400);
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it.each([
    [
      { ...validBody, newPassword: "kurz", confirmation: "kurz" },
      "Das neue Passwort muss mindestens 6 Zeichen lang sein.",
    ],
    [
      { ...validBody, confirmation: "anderes-passwort" },
      "Die neuen Passwörter stimmen nicht überein.",
    ],
  ])("rejects invalid new passwords", async (body, message) => {
    const response = await PUT(request(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: message });
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("returns a normal 400 without provider details for a wrong current password", async () => {
    signInWithPassword.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "Invalid login credentials", status: 400 },
    });

    const response = await PUT(request(validBody));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Das aktuelle Passwort ist falsch." });
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("verifies anonymously and updates only the authenticated user", async () => {
    const response = await PUT(request(validBody));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(authenticateSupabaseRequest).toHaveBeenCalledWith(expect.any(Request), serviceClient);
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "user@findog.at",
      password: "altes-passwort",
    });
    expect(updateUserById).toHaveBeenCalledTimes(1);
    expect(updateUserById).toHaveBeenCalledWith("authenticated-user", {
      password: "neues-passwort",
    });
  });
});
