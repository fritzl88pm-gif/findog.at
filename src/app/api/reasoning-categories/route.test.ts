import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GET, POST } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

const USER_ID = "3ee4de5e-e847-485a-adcf-16c2e924332c";
const CATEGORY_ID = "4411bb00-4ee5-4acd-af3d-f982db70d877";
const PARENT_ID = "2c1f1ddf-1f2e-4cc9-9ee5-7d340006fc8d";

describe("reasoning categories API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: USER_ID });
  });

  it("returns only categories scoped to the authenticated user with parentId", async () => {
    const order = vi.fn().mockResolvedValue({
      data: [{
        id: CATEGORY_ID,
        name: "Umsatzsteuer",
        parent_id: PARENT_ID,
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
        parentId: PARENT_ID,
        createdAt: "2026-07-28T08:00:00.000Z",
        updatedAt: "2026-07-28T08:00:00.000Z",
      }],
    });
  });

  it("maps missing parent_id to parentId null", async () => {
    const order = vi.fn().mockResolvedValue({
      data: [{
        id: CATEGORY_ID,
        name: "Betriebsausgaben",
        parent_id: null,
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

    await expect(response.json()).resolves.toEqual({
      categories: [{
        id: CATEGORY_ID,
        name: "Betriebsausgaben",
        parentId: null,
        createdAt: "2026-07-28T08:00:00.000Z",
        updatedAt: "2026-07-28T08:00:00.000Z",
      }],
    });
  });

  it("creates category with owner-scoped parent_id", async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        id: CATEGORY_ID,
        name: "Vorsteuer",
        parent_id: PARENT_ID,
        created_at: "2026-07-28T08:00:00.000Z",
        updated_at: "2026-07-28T08:00:00.000Z",
      },
      error: null,
    });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const from = vi.fn(() => ({ insert }));
    vi.mocked(getSupabaseServerClient).mockReturnValue({ auth: {}, from } as never);

    const response = await POST(new Request("https://findog.at/api/reasoning-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Vorsteuer", parentId: PARENT_ID }),
    }));

    expect(response.status).toBe(201);
    expect(insert).toHaveBeenCalledWith({
      client_id: USER_ID,
      name: "Vorsteuer",
      parent_id: PARENT_ID,
    });
    await expect(response.json()).resolves.toEqual({
      category: {
        id: CATEGORY_ID,
        name: "Vorsteuer",
        parentId: PARENT_ID,
        createdAt: "2026-07-28T08:00:00.000Z",
        updatedAt: "2026-07-28T08:00:00.000Z",
      },
    });
  });

  it("creates top-level category when parentId is omitted", async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        id: CATEGORY_ID,
        name: "Allgemein",
        parent_id: null,
        created_at: "2026-07-28T08:00:00.000Z",
        updated_at: "2026-07-28T08:00:00.000Z",
      },
      error: null,
    });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const from = vi.fn(() => ({ insert }));
    vi.mocked(getSupabaseServerClient).mockReturnValue({ auth: {}, from } as never);

    const response = await POST(new Request("https://findog.at/api/reasoning-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Allgemein" }),
    }));

    expect(response.status).toBe(201);
    expect(insert).toHaveBeenCalledWith({
      client_id: USER_ID,
      name: "Allgemein",
    });
  });

  it("rejects malformed parentId", async () => {
    const from = vi.fn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ auth: {}, from } as never);

    const response = await POST(new Request("https://findog.at/api/reasoning-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "X", parentId: "not-a-uuid" }),
    }));

    expect(response.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it("maps unavailable parent category to safe 400 response", async () => {
    const single = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "23503", message: "foreign key violation" },
    });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const from = vi.fn(() => ({ insert }));
    vi.mocked(getSupabaseServerClient).mockReturnValue({ auth: {}, from } as never);

    const response = await POST(new Request("https://findog.at/api/reasoning-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test", parentId: PARENT_ID }),
    }));

    expect(response.status).toBe(400);
    const payload = await response.json() as Record<string, unknown>;
    expect(payload.error).toBe("Die übergeordnete Kategorie ist nicht verfügbar.");
    // Must not leak ownership info
    const payloadStr = JSON.stringify(payload);
    expect(payloadStr).not.toMatch(/owner|client_id|existiert nicht/iu);
  });

  it("fails closed when server-side Supabase is unavailable", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValue(null);

    const response = await GET(new Request("https://findog.at/api/reasoning-categories"));

    expect(response.status).toBe(503);
    expect(authenticateSupabaseRequest).not.toHaveBeenCalled();
  });
});
