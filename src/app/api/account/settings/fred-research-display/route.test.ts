import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GET, PUT } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

const USER_ID = "22222222-2222-4222-8222-222222222222";
const ROUTE_URL = "http://localhost/api/account/settings/fred-research-display";

function getRequest() {
  return new Request(ROUTE_URL, {
    headers: { Authorization: "Bearer access-token" },
  });
}

function putRequest(body: unknown) {
  return new Request(ROUTE_URL, {
    method: "PUT",
    headers: {
      Authorization: "Bearer access-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function supabaseClient(prefRow: unknown = null, prefError: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: prefRow, error: prefError });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn().mockReturnValue({ select, upsert });

  return {
    client: { from } as never,
    from,
    select,
    eq,
    maybeSingle,
    upsert,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authenticateSupabaseRequest).mockResolvedValue({
    id: USER_ID,
    email: "user@example.com",
  });
});

describe("GET /api/account/settings/fred-research-display", () => {
  it("returns simple when no preference row exists", async () => {
    const supabase = supabaseClient();
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ researchDisplayMode: "simple" });
    expect(supabase.from).toHaveBeenCalledExactlyOnceWith("fred_user_preferences");
    expect(supabase.select).toHaveBeenCalledExactlyOnceWith("research_display_mode");
  });

  it("returns the stored advanced mode and no retired fields", async () => {
    const supabase = supabaseClient({ research_display_mode: "advanced" });
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client);

    const response = await GET(getRequest());

    await expect(response.json()).resolves.toEqual({ researchDisplayMode: "advanced" });
  });

  it("requires authentication before reading preferences", async () => {
    vi.mocked(authenticateSupabaseRequest).mockRejectedValue(
      new UserVisibleError("Bitte zuerst anmelden.", 401),
    );
    const supabase = supabaseClient();
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client);

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("fails safely on database read errors", async () => {
    const supabase = supabaseClient(null, new Error("db-down"));
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client);

    const response = await GET(getRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Die Rechercheanzeige ist derzeit nicht verfügbar.",
    });
  });
});

describe("PUT /api/account/settings/fred-research-display", () => {
  it("upserts only the research display preference", async () => {
    const supabase = supabaseClient();
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client);

    const response = await PUT(putRequest({ researchDisplayMode: "advanced" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ researchDisplayMode: "advanced" });
    expect(supabase.upsert).toHaveBeenCalledExactlyOnceWith(
      {
        user_id: USER_ID,
        research_display_mode: "advanced",
        updated_at: expect.any(String),
      },
      { onConflict: "user_id" },
    );
    const payload = supabase.upsert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("preferred_name");
    expect(payload).not.toHaveProperty("personality");
  });

  it.each(["verbose", 123, null])("rejects invalid mode %j", async (mode) => {
    const supabase = supabaseClient();
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client);

    const response = await PUT(putRequest({ researchDisplayMode: mode }));

    expect(response.status).toBe(400);
    expect(supabase.upsert).not.toHaveBeenCalled();
  });

  it("rejects missing and additional fields", async () => {
    const supabase = supabaseClient();
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client);

    const missing = await PUT(putRequest({}));
    const additional = await PUT(putRequest({
      researchDisplayMode: "simple",
      preferredName: "Alina",
    }));

    expect(missing.status).toBe(400);
    expect(additional.status).toBe(400);
    expect(supabase.upsert).not.toHaveBeenCalled();
  });

  it("fails safely when Supabase is unavailable", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValue(null);

    const response = await PUT(putRequest({ researchDisplayMode: "simple" }));

    expect(response.status).toBe(503);
  });
});
