import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GET } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

const USER_ID = "3ee4de5e-e847-485a-adcf-16c2e924332c";
const CATEGORY_ID = "4411bb00-4ee5-4acd-af3d-f982db70d877";

describe("reasoning categories API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: USER_ID });
  });

  it("returns only categories scoped to the authenticated user", async () => {
    const order = vi.fn().mockResolvedValue({
      data: [{
        id: CATEGORY_ID,
        name: "Umsatzsteuer",
        created_at: "2026-07-28T08:00:00.000Z",
        updated_at: "2026-07-28T08:00:00.000Z",
      }],
      error: null,
    });
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    vi.mocked(getSupabaseServerClient).mockReturnValue({ auth: {}, from } as never);

    const response = await GET(new Request("https://findog.at/api/reasoning-categories"));

    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledWith("user_reasoning_categories");
    expect(eq).toHaveBeenCalledWith("client_id", USER_ID);
    expect(order).toHaveBeenCalledWith("name", { ascending: true });
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    await expect(response.json()).resolves.toEqual({
      categories: [{
        id: CATEGORY_ID,
        name: "Umsatzsteuer",
        createdAt: "2026-07-28T08:00:00.000Z",
        updatedAt: "2026-07-28T08:00:00.000Z",
      }],
    });
  });

  it("fails closed when server-side Supabase is unavailable", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValue(null);

    const response = await GET(new Request("https://findog.at/api/reasoning-categories"));

    expect(response.status).toBe(503);
    expect(authenticateSupabaseRequest).not.toHaveBeenCalled();
  });
});
