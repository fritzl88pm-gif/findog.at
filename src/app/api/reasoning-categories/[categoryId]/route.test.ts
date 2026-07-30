import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { DELETE, PATCH } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

const USER_ID = "3ee4de5e-e847-485a-adcf-16c2e924332c";
const CATEGORY_ID = "4411bb00-4ee5-4acd-af3d-f982db70d877";

function routeContext(id: string): { params: Promise<{ categoryId: string }> } {
  return { params: Promise.resolve({ categoryId: id }) };
}

describe("reasoning category by ID API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: USER_ID });
  });

  describe("DELETE", () => {
    it("deletes the category when it has no children", async () => {
      const select = vi.fn().mockResolvedValue({
        data: [{ id: CATEGORY_ID }],
        error: null,
      });
      const eq2 = vi.fn(() => ({ select }));
      const eq1 = vi.fn(() => ({ eq: eq2 }));
      const del = vi.fn(() => ({ eq: eq1 }));
      const from = vi.fn(() => ({ delete: del }));
      vi.mocked(getSupabaseServerClient).mockReturnValue({ auth: {}, from } as never);

      const response = await DELETE(
        new Request("https://findog.at/api/reasoning-categories/" + CATEGORY_ID),
        routeContext(CATEGORY_ID),
      );

      expect(response.status).toBe(200);
      expect(from).toHaveBeenCalledWith("user_reasoning_categories");
      expect(del).toHaveBeenCalled();
      expect(eq1).toHaveBeenCalledWith("id", CATEGORY_ID);
      expect(eq2).toHaveBeenCalledWith("client_id", USER_ID);
    });

    it("returns 409 with Unterkategorien message on FK violation (23503)", async () => {
      const select = vi.fn().mockResolvedValue({
        data: null,
        error: { code: "23503", message: "foreign key violation" },
      });
      const eq2 = vi.fn(() => ({ select }));
      const eq1 = vi.fn(() => ({ eq: eq2 }));
      const del = vi.fn(() => ({ eq: eq1 }));
      const from = vi.fn(() => ({ delete: del }));
      vi.mocked(getSupabaseServerClient).mockReturnValue({ auth: {}, from } as never);

      const response = await DELETE(
        new Request("https://findog.at/api/reasoning-categories/" + CATEGORY_ID),
        routeContext(CATEGORY_ID),
      );

      expect(response.status).toBe(409);
      const payload = await response.json() as Record<string, unknown>;
      expect(payload.error).toBe(
        "Diese Kategorie enthält Unterkategorien und kann daher nicht gelöscht werden. Bitte lösche zuerst die Unterkategorien.",
      );
    });

    it("returns 404 when category is not found", async () => {
      const select = vi.fn().mockResolvedValue({
        data: [],
        error: null,
      });
      const eq2 = vi.fn(() => ({ select }));
      const eq1 = vi.fn(() => ({ eq: eq2 }));
      const del = vi.fn(() => ({ eq: eq1 }));
      const from = vi.fn(() => ({ delete: del }));
      vi.mocked(getSupabaseServerClient).mockReturnValue({ auth: {}, from } as never);

      const response = await DELETE(
        new Request("https://findog.at/api/reasoning-categories/" + CATEGORY_ID),
        routeContext(CATEGORY_ID),
      );

      expect(response.status).toBe(404);
    });
  });

  describe("PATCH", () => {
    it("renames a category scoped to the authenticated user", async () => {
      const maybeSingle = vi.fn().mockResolvedValue({
        data: {
          id: CATEGORY_ID,
          name: "Neuer Name",
          parent_id: null,
          created_at: "2026-07-28T08:00:00.000Z",
          updated_at: "2026-07-28T09:00:00.000Z",
        },
        error: null,
      });
      const select = vi.fn(() => ({ maybeSingle }));
      const eq2 = vi.fn(() => ({ select }));
      const eq1 = vi.fn(() => ({ eq: eq2 }));
      const update = vi.fn(() => ({ eq: eq1 }));
      const from = vi.fn(() => ({ update }));
      vi.mocked(getSupabaseServerClient).mockReturnValue({ auth: {}, from } as never);

      const response = await PATCH(
        new Request("https://findog.at/api/reasoning-categories/" + CATEGORY_ID, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Neuer Name" }),
        }),
        routeContext(CATEGORY_ID),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        category: {
          id: CATEGORY_ID,
          name: "Neuer Name",
          parentId: null,
          createdAt: "2026-07-28T08:00:00.000Z",
          updatedAt: "2026-07-28T09:00:00.000Z",
        },
      });
    });

    it("rejects invalid UUID in path parameter", async () => {
      const from = vi.fn();
      vi.mocked(getSupabaseServerClient).mockReturnValue({ auth: {}, from } as never);

      const response = await PATCH(
        new Request("https://findog.at/api/reasoning-categories/not-a-uuid", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Neuer Name" }),
        }),
        routeContext("not-a-uuid"),
      );

      expect(response.status).toBe(400);
    });
  });
});
