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

// Builds a mock supabase client that supports both fred_user_preferences
// and fred_personality_profiles queries with chainable .order()
// and .select().eq().maybeSingle() for existence checks.
function supabaseClient(
  prefRow: unknown = null,
  prefError: unknown = null,
  profileRows: unknown[] = [],
  singleProfileRow: unknown | null = undefined,
) {
  const calls: string[] = [];

  // Profiles table: .select().order().order() (for list queries)
  const profileOrder3 = vi.fn().mockResolvedValue({ data: profileRows, error: null });
  const profileOrder2 = vi.fn().mockReturnValue({ order: profileOrder3 });
  const profileOrder1 = vi.fn().mockReturnValue({ order: profileOrder2 });

  // Profiles table: .select().eq().maybeSingle() (for existence check)
  const profileMaybeSingle = vi.fn().mockResolvedValue({
    data: singleProfileRow !== undefined ? singleProfileRow : { id: "standard" },
    error: null,
  });
  const profileEq = vi.fn().mockReturnValue({ maybeSingle: profileMaybeSingle });

  // A profileSelect that returns EITHER {order} or {eq} based on how it's used
  const profileSelect = vi.fn().mockReturnValue({ order: profileOrder1, eq: profileEq });

  // Preferences table: .select().eq().maybeSingle()
  const prefMaybeSingle = vi.fn().mockResolvedValue({ data: prefRow, error: prefError });
  const prefEq = vi.fn().mockReturnValue({ maybeSingle: prefMaybeSingle });
  const prefSelect = vi.fn().mockReturnValue({ eq: prefEq });

  // Upsert
  const prefUpsert = vi.fn().mockResolvedValue({ error: null });

  const from = vi.fn((table: string) => {
    calls.push(table);
    if (table === "fred_user_preferences") {
      return { select: prefSelect, upsert: prefUpsert };
    }
    if (table === "fred_personality_profiles") {
      return { select: profileSelect };
    }
    return {};
  });

  return {
    client: { from } as never,
    from,
    calls,
    prefMaybeSingle,
    prefUpsert,
    prefSelect,
    prefEq,
    profileSelect,
    profileOrder1,
    profileEq,
    profileMaybeSingle,
  };
}

// ── GET ────────────────────────────────────────────────────────────────────

describe("GET /api/account/settings/fred-personalization", () => {
  const BUILTIN_PROFILES = [
    { id: "standard", title: "Standard" },
    { id: "friendly", title: "Freundlich" },
    { id: "efficient", title: "Effizient" },
    { id: "cynical", title: "Zynisch" },
  ];

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({
      id: USER_ID,
      email: "user@example.com",
    });
  });

  it("returns normalized defaults when no row exists", async () => {
    const supabase = supabaseClient(null, null, BUILTIN_PROFILES);
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      preferredName: "",
      personality: "standard",
      personalities: [
        { id: "standard", title: "Standard" },
        { id: "friendly", title: "Freundlich" },
        { id: "efficient", title: "Effizient" },
        { id: "cynical", title: "Zynisch" },
      ],
    });
    expect(supabase.from).toHaveBeenCalledWith("fred_user_preferences");
    expect(supabase.from).toHaveBeenCalledWith("fred_personality_profiles");
  });

  it("returns stored preferences when a row exists", async () => {
    const supabase = supabaseClient(
      { preferred_name: "Alina", personality: "friendly" },
      null,
      BUILTIN_PROFILES,
    );
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      preferredName: "Alina",
      personality: "friendly",
      personalities: [
        { id: "standard", title: "Standard" },
        { id: "friendly", title: "Freundlich" },
        { id: "efficient", title: "Effizient" },
        { id: "cynical", title: "Zynisch" },
      ],
    });
  });

  it("never exposes promptText in the personalities list", async () => {
    const supabase = supabaseClient(null, null, BUILTIN_PROFILES);
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client);

    const response = await GET(getRequest());
    const json = await response.json();

    expect(response.status).toBe(200);
    for (const p of json.personalities) {
      expect(p).not.toHaveProperty("promptText");
      expect(p).not.toHaveProperty("prompt_text");
    }
  });

  it("requires authentication", async () => {
    vi.mocked(authenticateSupabaseRequest).mockRejectedValue(
      new UserVisibleError("Bitte zuerst anmelden.", 401),
    );
    const supabase = supabaseClient();
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client);

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(supabase.from).not.toHaveBeenCalled();
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
    const supabase = supabaseClient(null, new Error("db error"), BUILTIN_PROFILES);
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client);

    const response = await GET(getRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Persönliche Fred-Einstellungen sind derzeit nicht verfügbar.",
    });
  });
});

// ── PUT ────────────────────────────────────────────────────────────────────

describe("PUT /api/account/settings/fred-personalization", () => {
  const BUILTIN_PROFILES = [
    { id: "standard", title: "Standard" },
    { id: "friendly", title: "Freundlich" },
    { id: "efficient", title: "Effizient" },
    { id: "cynical", title: "Zynisch" },
  ];

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({
      id: USER_ID,
      email: "user@example.com",
    });
  });

  it("upserts preferences and returns them with the personality list", async () => {
    const supabase = supabaseClient(null, null, BUILTIN_PROFILES);
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client);

    const response = await PUT(putRequest({ preferredName: "Alina", personality: "friendly" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      preferredName: "Alina",
      personality: "friendly",
      personalities: [
        { id: "standard", title: "Standard" },
        { id: "friendly", title: "Freundlich" },
        { id: "efficient", title: "Effizient" },
        { id: "cynical", title: "Zynisch" },
      ],
    });
    expect(supabase.from).toHaveBeenCalledWith("fred_user_preferences");
    expect(supabase.from).toHaveBeenCalledWith("fred_personality_profiles");
    expect(supabase.prefUpsert).toHaveBeenCalledWith(
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
    const supabase = supabaseClient(null, null, BUILTIN_PROFILES);
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client);

    const response = await PUT(putRequest({ preferredName: "  Alina   Marie  ", personality: "standard" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      preferredName: "Alina Marie",
      personality: "standard",
      personalities: BUILTIN_PROFILES,
    });
    expect(supabase.prefUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ preferred_name: "Alina Marie" }),
      expect.anything(),
    );
  });

  it("converts empty preferredName to null in storage but returns ''", async () => {
    const supabase = supabaseClient(null, null, BUILTIN_PROFILES);
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client);

    const response = await PUT(putRequest({ preferredName: "   ", personality: "friendly" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      preferredName: "",
      personality: "friendly",
      personalities: BUILTIN_PROFILES,
    });
    expect(supabase.prefUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ preferred_name: null }),
      expect.anything(),
    );
  });

  it("rejects unknown personality IDs", async () => {
    const supabase = supabaseClient(null, null, BUILTIN_PROFILES);
    // Simulate profile existence check returning null (not found)
    supabase.profileMaybeSingle.mockResolvedValue({ data: null, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client);

    const response = await PUT(putRequest({ preferredName: "Alina", personality: "evil" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Ungültige Persönlichkeit.",
    });
    expect(supabase.prefUpsert).not.toHaveBeenCalled();
  });

  // ── Strict PUT contract ────────────────────────────────────────────────
  it("rejects missing preferredName field", async () => {
    const supabase = supabaseClient(null, null, BUILTIN_PROFILES);
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client);

    const response = await PUT(putRequest({ personality: "friendly" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Ungültiger Request-Body.",
    });
    expect(supabase.prefUpsert).not.toHaveBeenCalled();
  });

  it("rejects missing personality field", async () => {
    const supabase = supabaseClient(null, null, BUILTIN_PROFILES);
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client);

    const response = await PUT(putRequest({ preferredName: "Alina" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Ungültiger Request-Body.",
    });
    expect(supabase.prefUpsert).not.toHaveBeenCalled();
  });

  it("rejects unknown extra field", async () => {
    const supabase = supabaseClient(null, null, BUILTIN_PROFILES);
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client);

    const response = await PUT(putRequest({ preferredName: "Alina", personality: "friendly", hacker: "yes" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Ungültiger Request-Body.",
    });
    expect(supabase.prefUpsert).not.toHaveBeenCalled();
  });

  it("rejects non-string preferredName (number)", async () => {
    const supabase = supabaseClient(null, null, BUILTIN_PROFILES);
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client);

    const response = await PUT(putRequest({ preferredName: 123, personality: "friendly" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Der Anzeigename ist ungültig.",
    });
    expect(supabase.prefUpsert).not.toHaveBeenCalled();
  });

  it("rejects non-string personality (number)", async () => {
    const supabase = supabaseClient(null, null, BUILTIN_PROFILES);
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client);

    const response = await PUT(putRequest({ preferredName: "Alina", personality: 123 }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Ungültige Persönlichkeit.",
    });
    expect(supabase.prefUpsert).not.toHaveBeenCalled();
  });

  // ── Auth / safety ──────────────────────────────────────────────────────
  it("requires authentication", async () => {
    vi.mocked(authenticateSupabaseRequest).mockRejectedValue(
      new UserVisibleError("Bitte zuerst anmelden.", 401),
    );
    const supabase = supabaseClient(null, null, BUILTIN_PROFILES);
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client);

    const response = await PUT(putRequest({ preferredName: "Alina", personality: "friendly" }));

    expect(response.status).toBe(401);
    expect(supabase.prefUpsert).not.toHaveBeenCalled();
  });

  it("fails safely when Supabase is unavailable", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValue(null);

    const response = await PUT(putRequest({ preferredName: "Alina", personality: "friendly" }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Persönliche Fred-Einstellungen sind derzeit nicht verfügbar.",
    });
  });

  it("fails safely on personality lookup error", async () => {
    // Simulate profile existence check returning error
    const supabase = supabaseClient(null, null, BUILTIN_PROFILES);
    supabase.profileMaybeSingle.mockResolvedValue({ data: null, error: new Error("db-down") });
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client);

    const response = await PUT(putRequest({ preferredName: "Alina", personality: "friendly" }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Persönliche Fred-Einstellungen sind derzeit nicht verfügbar.",
    });
    expect(supabase.prefUpsert).not.toHaveBeenCalled();
  });
});
