import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GET } from "./route";

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
