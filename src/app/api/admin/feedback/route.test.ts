import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateAdminRequest } from "@/lib/admin-users";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GET } from "./route";

vi.mock("@/lib/admin-users", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin-users")>("@/lib/admin-users");
  return { ...actual, authenticateAdminRequest: vi.fn() };
});

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: vi.fn(),
}));

function supabaseClient(data: unknown[] = [], error: unknown = null) {
  const limit = vi.fn().mockResolvedValue({ data, error });
  const query = {
    select: vi.fn(),
    order: vi.fn(),
    limit,
  };
  query.select.mockReturnValue(query);
  query.order.mockReturnValue(query);
  const from = vi.fn().mockReturnValue(query);
  return { client: { from }, from, query, limit };
}

describe("GET /api/admin/feedback", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authenticateAdminRequest).mockResolvedValue({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      email: "admin@example.at",
    });
  });

  it("returns newest negative feedback with bounded private output", async () => {
    const supabase = supabaseClient([{
      id: 7,
      user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      conversation_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      user_request: "Frage",
      assistant_response: "Antwort",
      user_feedback: "Falsche Rechtsfolge",
      created_at: "2026-07-28T10:00:00.000Z",
    }]);
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client as never);

    const response = await GET(new Request("http://localhost/api/admin/feedback"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(supabase.from).toHaveBeenCalledWith("agent_feedback");
    expect(supabase.query.order).toHaveBeenCalledWith("id", { ascending: false });
    expect(supabase.limit).toHaveBeenCalledWith(250);
    await expect(response.json()).resolves.toEqual({
      feedback: [{
        id: 7,
        userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        conversationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        userRequest: "Frage",
        assistantResponse: "Antwort",
        feedback: "Falsche Rechtsfolge",
        createdAt: "2026-07-28T10:00:00.000Z",
      }],
      limit: 250,
    });
  });

  it("does not query feedback when admin authorization fails", async () => {
    const supabase = supabaseClient();
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client as never);
    vi.mocked(authenticateAdminRequest).mockRejectedValue(
      new UserVisibleError("Du hast keine Administrationsberechtigung.", 403),
    );

    const response = await GET(new Request("http://localhost/api/admin/feedback"));

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("returns a generic error when the database query fails", async () => {
    const supabase = supabaseClient([], { code: "XX000", message: "sensitive detail" });
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client as never);

    const response = await GET(new Request("http://localhost/api/admin/feedback"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Rückmeldungen konnten nicht geladen werden.",
    });
  });
});
