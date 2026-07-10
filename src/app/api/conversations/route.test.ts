import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { DELETE, GET } from "./route";

vi.mock("@/lib/auth/server", () => ({
  authenticateSupabaseRequest: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: vi.fn(),
}));

describe("GET /api/conversations", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      email: "harald@example.at",
    });
  });

  it("returns only the authenticated owner's safe summaries newest-first", async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          title: "Neu",
          created_at: "2026-07-09T09:00:00.000Z",
          updated_at: "2026-07-09T11:00:00.000Z",
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          title: "Alt",
          created_at: "2026-07-08T09:00:00.000Z",
          updated_at: "2026-07-08T10:00:00.000Z",
        },
      ],
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never);

    const response = await GET(
      new Request("http://localhost/api/conversations", {
        headers: { Authorization: "Bearer access-token" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      conversations: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          title: "Neu",
          createdAt: "2026-07-09T09:00:00.000Z",
          updatedAt: "2026-07-09T11:00:00.000Z",
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          title: "Alt",
          createdAt: "2026-07-08T09:00:00.000Z",
          updatedAt: "2026-07-08T10:00:00.000Z",
        },
      ],
    });
    expect(eq).toHaveBeenCalledWith("client_id", "11111111-1111-4111-8111-111111111111");
    expect(order).toHaveBeenCalledWith("updated_at", { ascending: false });
    expect(select).toHaveBeenCalledWith("id,title,created_at,updated_at");
  });
});

describe("DELETE /api/conversations", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
    });
  });

  it.each([
    { body: { ids: [] }, error: "Bitte mindestens eine Gespräch-ID zum Löschen auswählen." },
    { body: { ids: ["not-a-uuid"] }, error: "Eine oder mehrere Gespräch-IDs sind ungültig." },
    { body: { ids: Array.from({ length: 101 }, (_, index) => `invalid-${index}`) }, error: "Es können maximal 100 Unterhaltungen auf einmal gelöscht werden." },
  ])("rejects invalid or unbounded bulk IDs", async ({ body, error }) => {
    const from = vi.fn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never);

    const response = await DELETE(
      new Request("http://localhost/api/conversations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error });
    expect(from).not.toHaveBeenCalled();
  });

  it("de-duplicates IDs and bulk-deletes only rows owned by the authenticated user", async () => {
    const firstId = "22222222-2222-4222-8222-222222222222";
    const secondId = "33333333-3333-4333-8333-333333333333";
    const select = vi.fn().mockResolvedValue({
      data: [{ id: firstId }, { id: secondId }],
      error: null,
    });
    const deleteQuery = {
      in: vi.fn(() => deleteQuery),
      eq: vi.fn(() => deleteQuery),
      select,
    };
    const deleteRows = vi.fn(() => deleteQuery);
    const from = vi.fn().mockReturnValue({ delete: deleteRows });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never);

    const request = new Request("http://localhost/api/conversations", {
      method: "DELETE",
      headers: {
        Authorization: "Bearer access-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids: [firstId, secondId, firstId] }),
    });
    const response = await DELETE(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deletedIds: [firstId, secondId] });
    expect(authenticateSupabaseRequest).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ from }),
    );
    expect(deleteQuery.in).toHaveBeenCalledWith("id", [firstId, secondId]);
    expect(deleteQuery.eq).toHaveBeenCalledWith(
      "client_id",
      "11111111-1111-4111-8111-111111111111",
    );
    expect(select).toHaveBeenCalledWith("id");
  });
});
