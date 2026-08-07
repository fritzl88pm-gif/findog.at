import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateAdminRequest } from "@/lib/admin-users";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GET, POST, PUT } from "./route";

vi.mock("@/lib/admin-users", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin-users")>("@/lib/admin-users");
  return { ...actual, authenticateAdminRequest: vi.fn() };
});

vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function getRequest() {
  return new Request("http://localhost/api/admin/fred-personalities", {
    method: "GET",
    headers: { Authorization: "Bearer admin-token" },
  });
}

function postRequest(body: unknown) {
  return new Request("http://localhost/api/admin/fred-personalities", {
    method: "POST",
    headers: { Authorization: "Bearer admin-token", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function putRequest(body: unknown) {
  return new Request("http://localhost/api/admin/fred-personalities", {
    method: "PUT",
    headers: { Authorization: "Bearer admin-token", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Creates a mock supabase client with a chainable .from().select().order().order()
// that terminates in a promise returning {data, error}.
function supabaseGetClient(rows: unknown[] = [], error: unknown = null) {
  const result = { data: rows, error };
  // Each order() returns an object that also has order()
  const order3 = vi.fn().mockResolvedValue(result);
  const order2 = vi.fn().mockReturnValue({ order: order3 });
  const order1 = vi.fn().mockReturnValue({ order: order2 });
  const select = vi.fn().mockReturnValue({ order: order1 });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as never, from, select, order1, order2, order3 };
}

// ── GET ────────────────────────────────────────────────────────────────────

describe("GET /api/admin/fred-personalities", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authenticateAdminRequest).mockResolvedValue({
      id: ADMIN_ID,
      email: "admin@example.at",
    });
  });

  it("returns personality list ordered builtin-first then by created_at/id", async () => {
    const rows = [
      { id: "standard", title: "Standard", prompt_text: "", is_builtin: true, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      { id: "friendly", title: "Freundlich", prompt_text: "Be friendly", is_builtin: true, created_at: "2026-01-01T00:00:01Z", updated_at: "2026-01-01T00:00:01Z" },
      { id: "custom-1", title: "Custom One", prompt_text: "Be custom", is_builtin: false, created_at: "2026-01-02T00:00:00Z", updated_at: "2026-01-02T00:00:00Z" },
    ];
    const supabase = supabaseGetClient(rows);
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(supabase.from).toHaveBeenCalledWith("fred_personality_profiles");
    await expect(response.json()).resolves.toEqual({
      personalities: [
        { id: "standard", title: "Standard", promptText: "", isBuiltin: true },
        { id: "friendly", title: "Freundlich", promptText: "Be friendly", isBuiltin: true },
        { id: "custom-1", title: "Custom One", promptText: "Be custom", isBuiltin: false },
      ],
    });
  });

  it("returns empty list when no profiles exist", async () => {
    const supabase = supabaseGetClient([]);
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ personalities: [] });
  });

  it("exposes promptText to admin users", async () => {
    const rows = [{ id: "secret", title: "Secret", prompt_text: "TOP SECRET PROMPT", is_builtin: false, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }];
    const supabase = supabaseGetClient(rows);
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client);

    const response = await GET(getRequest());
    const json = await response.json();

    expect(json.personalities[0].promptText).toBe("TOP SECRET PROMPT");
  });

  it("requires admin authentication", async () => {
    vi.mocked(authenticateAdminRequest).mockRejectedValue(
      new UserVisibleError("Du hast keine Administrationsberechtigung.", 403),
    );
    const supabase = supabaseGetClient();
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client);

    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("returns generic error on database failure", async () => {
    const supabase = supabaseGetClient([], { code: "XX000", message: "internal" });
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client);

    const response = await GET(getRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Persönlichkeitsprofile sind derzeit nicht verfügbar.",
    });
  });
});

// ── POST ───────────────────────────────────────────────────────────────────

describe("POST /api/admin/fred-personalities", () => {
  const single = vi.fn();
  const select = vi.fn();
  const insert = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authenticateAdminRequest).mockResolvedValue({
      id: ADMIN_ID,
      email: "admin@example.at",
    });
    select.mockReturnValue({ single } as never);
    insert.mockReturnValue({ select } as never);
    const from = vi.fn().mockReturnValue({ insert } as never);
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never);
  });

  it("creates a profile with server-generated UUID and returns it", async () => {
    single.mockResolvedValue({
      data: { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", title: "Custom", prompt_text: "Be nice", is_builtin: false, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      error: null,
    });

    const response = await POST(postRequest({ title: " Custom ", promptText: "Be nice" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      personality: {
        id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        title: "Custom",
        promptText: "Be nice",
        isBuiltin: false,
      },
    });
    const insertArgs = insert.mock.calls[0]?.[0];
    expect(insertArgs).toHaveProperty("id");
    expect(insertArgs.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(insertArgs.title).toBe("Custom");
    expect(insertArgs.prompt_text).toBe("Be nice");
    expect(insertArgs.is_builtin).toBe(false);
  });

  it("normalizes title (trim + collapse)", async () => {
    single.mockResolvedValue({
      data: { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", title: "My Title", prompt_text: "", is_builtin: false, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      error: null,
    });

    const response = await POST(postRequest({ title: "  My    Title  ", promptText: "" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      personality: { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", title: "My Title", promptText: "", isBuiltin: false },
    });
  });

  it("normalizes promptText (CRLF to LF, trim)", async () => {
    single.mockResolvedValue({
      data: { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", title: "X", prompt_text: "line1\nline2", is_builtin: false, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      error: null,
    });

    const response = await POST(postRequest({ title: "X", promptText: "  line1\r\nline2  " }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      personality: { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", title: "X", promptText: "line1\nline2", isBuiltin: false },
    });
  });

  it("rejects body with id field", async () => {
    const response = await POST(postRequest({ id: "my-id", title: "X", promptText: "Y" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Ungültiger Request-Body." });
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects missing title", async () => {
    const response = await POST(postRequest({ promptText: "Y" }));

    expect(response.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects title with control chars", async () => {
    const response = await POST(postRequest({ title: "Hello\u0000World", promptText: "" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Der Titel ist ungültig." });
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects title exceeding 80 code points", async () => {
    const response = await POST(postRequest({ title: "x".repeat(81), promptText: "" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Der Titel ist ungültig." });
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects promptText with NUL character", async () => {
    const response = await POST(postRequest({ title: "X", promptText: "Hello\u0000World" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Das Prompt-Textfeld ist ungültig." });
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects promptText exceeding 4000 code points", async () => {
    const response = await POST(postRequest({ title: "X", promptText: "x".repeat(4001) }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Das Prompt-Textfeld ist ungültig." });
    expect(insert).not.toHaveBeenCalled();
  });

  it("returns generic error on database insert failure", async () => {
    single.mockResolvedValue({ data: null, error: { code: "23505", message: "duplicate" } });

    const response = await POST(postRequest({ title: "X", promptText: "" }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Persönlichkeitsprofil konnte nicht erstellt werden.",
    });
  });
});

// ── PUT ────────────────────────────────────────────────────────────────────

describe("PUT /api/admin/fred-personalities", () => {
  const maybeSingle = vi.fn();
  const select = vi.fn();
  const eq = vi.fn();
  const update = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authenticateAdminRequest).mockResolvedValue({
      id: ADMIN_ID,
      email: "admin@example.at",
    });
    select.mockReturnValue({ maybeSingle } as never);
    eq.mockReturnValue({ select } as never);
    update.mockReturnValue({ eq } as never);
    const from = vi.fn().mockReturnValue({ update } as never);
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never);
  });

  it("updates an existing profile and returns it", async () => {
    maybeSingle.mockResolvedValue({
      data: { id: "custom-1", title: "Updated Title", prompt_text: "Be updated", is_builtin: false, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z" },
      error: null,
    });

    const response = await PUT(putRequest({ id: "custom-1", title: "  Updated Title  ", promptText: "Be updated" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      personality: { id: "custom-1", title: "Updated Title", promptText: "Be updated", isBuiltin: false },
    });
    expect(update).toHaveBeenCalledWith(
      { title: "Updated Title", prompt_text: "Be updated", updated_at: expect.any(String) },
    );
    expect(eq).toHaveBeenCalledWith("id", "custom-1");
  });

  it("returns 404 when profile does not exist", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });

    const response = await PUT(putRequest({ id: "nonexistent", title: "X", promptText: "" }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Persönlichkeitsprofil nicht gefunden." });
  });

  it("preserves the id (immutable) - does not update id", async () => {
    maybeSingle.mockResolvedValue({
      data: { id: "custom-1", title: "Still Custom", prompt_text: "X", is_builtin: false, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z" },
      error: null,
    });

    await PUT(putRequest({ id: "custom-1", title: "Still Custom", promptText: "" }));

    const updateArgs = update.mock.calls[0]?.[0];
    expect(updateArgs).not.toHaveProperty("id");
  });

  it("rejects body without id", async () => {
    const response = await PUT(putRequest({ title: "X" }));

    expect(response.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects title with control characters", async () => {
    const response = await PUT(putRequest({ id: "custom-1", title: "Hello\u0000World", promptText: "" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Der Titel ist ungültig." });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects promptText with NUL", async () => {
    const response = await PUT(putRequest({ id: "custom-1", title: "X", promptText: "Hello\u0000World" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Das Prompt-Textfeld ist ungültig." });
    expect(update).not.toHaveBeenCalled();
  });

  it("returns generic error on database update failure", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { code: "XX000", message: "internal" } });

    const response = await PUT(putRequest({ id: "custom-1", title: "X", promptText: "" }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Persönlichkeitsprofil konnte nicht aktualisiert werden.",
    });
  });
});
