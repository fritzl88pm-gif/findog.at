import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GET, PUT } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

const USER_ID = "22222222-2222-4222-8222-222222222222";

function getRequest() {
  return new Request("http://localhost/api/account/settings/fred-personalization", {
    method: "GET",
    headers: { Authorization: "Bearer access-token" },
  });
}

function putRequest(body: unknown) {
  return new Request("http://localhost/api/account/settings/fred-personalization", {
    method: "PUT",
    headers: {
      Authorization: "Bearer access-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("GET /api/account/settings/fred-personalization", () => {
  const from = vi.fn();
  const select = vi.fn();
  const eq = vi.fn();
  const maybeSingle = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({
      id: USER_ID,
      email: "user@example.com",
    });
    select.mockReturnValue({ eq, maybeSingle } as never);
    eq.mockReturnValue({ maybeSingle } as never);
    from.mockReturnValue({ select } as never);
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never);
  });

  it("returns normalized defaults when no row exists", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      preferredName: "",
      personality: "standard",
    });
    expect(from).toHaveBeenCalledWith("fred_user_preferences");
    expect(select).toHaveBeenCalledWith("preferred_name,personality");
    expect(eq).toHaveBeenCalledWith("user_id", USER_ID);
  });

  it("returns stored preferences when a row exists", async () => {
    maybeSingle.mockResolvedValue({
      data: { preferred_name: "Alina", personality: "friendly" },
      error: null,
    });

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      preferredName: "Alina",
      personality: "friendly",
    });
  });

  it("returns empty preferredName when stored name is null", async () => {
    maybeSingle.mockResolvedValue({
      data: { preferred_name: null, personality: "standard" },
      error: null,
    });

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      preferredName: "",
      personality: "standard",
    });
  });

  it("requires authentication", async () => {
    vi.mocked(authenticateSupabaseRequest).mockRejectedValue(
      new UserVisibleError("Bitte zuerst anmelden.", 401),
    );

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });

  it("fails safely when Supabase is unavailable", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValue(null);

    const response = await GET(getRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Persönliche Fred-Einstellungen sind derzeit nicht verfügbar.",
    });
  });

  it("fails safely on database read error", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: new Error("db error") });

    const response = await GET(getRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Persönliche Fred-Einstellungen sind derzeit nicht verfügbar.",
    });
  });
});

describe("PUT /api/account/settings/fred-personalization", () => {
  const upsert = vi.fn();
  const from = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({
      id: USER_ID,
      email: "user@example.com",
    });
    from.mockReturnValue({ upsert } as never);
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never);
  });

  // ── Happy path ─────────────────────────────────────────────────────────
  it("upserts preferences and returns them", async () => {
    upsert.mockResolvedValue({ error: null });

    const response = await PUT(putRequest({ preferredName: "Alina", personality: "friendly" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      preferredName: "Alina",
      personality: "friendly",
    });
    expect(from).toHaveBeenCalledWith("fred_user_preferences");
    expect(upsert).toHaveBeenCalledWith(
      {
        user_id: USER_ID,
        preferred_name: "Alina",
        personality: "friendly",
        updated_at: expect.any(String),
      },
      { onConflict: "user_id" },
    );
  });

  it("normalizes whitespace in preferredName", async () => {
    upsert.mockResolvedValue({ error: null });

    const response = await PUT(putRequest({ preferredName: "  Alina   Marie  ", personality: "standard" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      preferredName: "Alina Marie",
      personality: "standard",
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ preferred_name: "Alina Marie" }),
      expect.anything(),
    );
  });

  it("converts empty preferredName to null in storage but returns ''", async () => {
    upsert.mockResolvedValue({ error: null });

    const response = await PUT(putRequest({ preferredName: "   ", personality: "friendly" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      preferredName: "",
      personality: "friendly",
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ preferred_name: null }),
      expect.anything(),
    );
  });

  it("accepts Unicode names including combining marks, apostrophes, periods, hyphens", async () => {
    upsert.mockResolvedValue({ error: null });

    const response = await PUT(putRequest({ preferredName: "Élise O'Neill-von der Mühle", personality: "standard" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      preferredName: "Élise O'Neill-von der Mühle",
      personality: "standard",
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ preferred_name: "Élise O'Neill-von der Mühle" }),
      expect.anything(),
    );
  });

  // ── Rejections ─────────────────────────────────────────────────────────
  it("rejects preferredName with line breaks", async () => {
    const response = await PUT(putRequest({ preferredName: "Alina\nDanger", personality: "standard" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Der Anzeigename enthält ungültige Zeichen.",
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects preferredName with angle brackets", async () => {
    const response = await PUT(putRequest({ preferredName: "Alina<Danger>", personality: "standard" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Der Anzeigename enthält ungültige Zeichen.",
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects preferredName with control characters", async () => {
    const response = await PUT(putRequest({ preferredName: "Alina\u0000Null", personality: "standard" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Der Anzeigename enthält ungültige Zeichen.",
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects preferredName exceeding 80 code points (after trim and collapse)", async () => {
    const response = await PUT(putRequest({ preferredName: "A".repeat(81), personality: "standard" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Der Anzeigename ist zu lang.",
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects unknown personality values", async () => {
    const response = await PUT(putRequest({ preferredName: "Alina", personality: "evil" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Ungültige Persönlichkeit.",
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  // ── Strict PUT contract ────────────────────────────────────────────────
  it("rejects missing preferredName field", async () => {
    const response = await PUT(putRequest({ personality: "friendly" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Ungültiger Request-Body.",
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects missing personality field", async () => {
    const response = await PUT(putRequest({ preferredName: "Alina" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Ungültiger Request-Body.",
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects unknown extra field", async () => {
    const response = await PUT(putRequest({ preferredName: "Alina", personality: "friendly", hacker: "yes" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Ungültiger Request-Body.",
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects non-string preferredName (number)", async () => {
    const response = await PUT(putRequest({ preferredName: 123, personality: "friendly" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Der Anzeigename ist ungültig.",
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects non-string preferredName (null)", async () => {
    const response = await PUT(putRequest({ preferredName: null, personality: "friendly" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Der Anzeigename ist ungültig.",
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects non-string preferredName (array)", async () => {
    const response = await PUT(putRequest({ preferredName: ["Alina"], personality: "friendly" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Der Anzeigename ist ungültig.",
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects non-string preferredName (object)", async () => {
    const response = await PUT(putRequest({ preferredName: { name: "Alina" }, personality: "friendly" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Der Anzeigename ist ungültig.",
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects free-form personality text", async () => {
    const response = await PUT(putRequest({ preferredName: "Alina", personality: "be very friendly and use lots of emoji" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Ungültige Persönlichkeit.",
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  // ── Auth / safety ──────────────────────────────────────────────────────
  it("requires authentication", async () => {
    vi.mocked(authenticateSupabaseRequest).mockRejectedValue(
      new UserVisibleError("Bitte zuerst anmelden.", 401),
    );

    const response = await PUT(putRequest({ preferredName: "Alina", personality: "friendly" }));

    expect(response.status).toBe(401);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("never trusts a browser-provided userId — rejects unknown fields", async () => {
    const response = await PUT(putRequest({ preferredName: "X", personality: "standard", userId: "hacker-id" }));

    expect(response.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("fails safely when Supabase is unavailable", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValue(null);

    const response = await PUT(putRequest({ preferredName: "Alina", personality: "friendly" }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Persönliche Fred-Einstellungen sind derzeit nicht verfügbar.",
    });
  });

  it("fails safely on database write error", async () => {
    upsert.mockResolvedValue({ error: new Error("db write error") });

    const response = await PUT(putRequest({ preferredName: "Alina", personality: "friendly" }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Persönliche Fred-Einstellungen konnten nicht gespeichert werden.",
    });
  });

  // ── Body validation ────────────────────────────────────────────────────
  it("rejects non-object body", async () => {
    const response = await PUT(new Request(
      "http://localhost/api/account/settings/fred-personalization",
      {
        method: "PUT",
        headers: { Authorization: "Bearer access-token", "Content-Type": "application/json" },
        body: '"just a string"',
      },
    ));

    expect(response.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });
});
