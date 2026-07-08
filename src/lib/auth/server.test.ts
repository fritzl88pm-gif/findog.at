import { describe, expect, it, vi } from "vitest";

import { UserVisibleError } from "../errors";

import { authenticateSupabaseRequest, getBearerToken } from "./server";

describe("getBearerToken", () => {
  it("returns the token from a Bearer authorization header", () => {
    const request = new Request("https://findog.at/api/chat", {
      headers: {
        authorization: "Bearer access-token",
      },
    });

    expect(getBearerToken(request)).toBe("access-token");
  });

  it("rejects missing or malformed authorization headers with a German 401 error", () => {
    const request = new Request("https://findog.at/api/chat", {
      headers: {
        authorization: "Basic abc",
      },
    });

    expect(() => getBearerToken(request)).toThrow(UserVisibleError);
    expect(() => getBearerToken(request)).toThrow("Bitte zuerst anmelden.");
  });
});

describe("authenticateSupabaseRequest", () => {
  it("validates the bearer token through Supabase Auth and returns the user id", async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: {
        user: {
          id: "11111111-1111-4111-8111-111111111111",
          email: "user@example.com",
        },
      },
      error: null,
    });
    const request = new Request("https://findog.at/api/chat", {
      headers: {
        authorization: "Bearer valid-token",
      },
    });

    await expect(authenticateSupabaseRequest(request, { auth: { getUser } })).resolves.toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      email: "user@example.com",
    });
    expect(getUser).toHaveBeenCalledWith("valid-token");
  });

  it("rejects invalid bearer tokens with a German 401 error", async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: {
        user: null,
      },
      error: new Error("invalid jwt"),
    });
    const request = new Request("https://findog.at/api/chat", {
      headers: {
        authorization: "Bearer invalid-token",
      },
    });

    await expect(authenticateSupabaseRequest(request, { auth: { getUser } })).rejects.toMatchObject({
      message: "Deine Anmeldung ist abgelaufen. Bitte erneut anmelden.",
      status: 401,
    });
  });
});
