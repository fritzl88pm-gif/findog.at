import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GET, POST } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

const USER_ID = "3ee4de5e-e847-485a-adcf-16c2e924332c";
const REASONING_ID = "7a77d890-175c-40d5-8af2-9a3141bfe63e";
const CATEGORY_ID = "4411bb00-4ee5-4acd-af3d-f982db70d877";
const PARENT_ID = "2c1f1ddf-1f2e-4cc9-9ee5-7d340006fc8d";

type QueryResult = { data: unknown; error: unknown };

function queryBuilder(result: QueryResult, scopes: Array<[string, unknown]>) {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn((field: string, value: unknown) => {
    scopes.push([field, value]);
    return builder;
  });
  builder.order = vi.fn(() => builder);
  builder.then = (
    resolve: (value: QueryResult) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

describe("reasonings API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: USER_ID });
  });

  it("loads all three datasets with the authenticated user scope and includes parentId", async () => {
    const scopes: Array<[string, unknown]> = [];
    const results: Record<string, QueryResult> = {
      user_reasoning_categories: {
        data: [{
          id: CATEGORY_ID,
          name: "Umsatzsteuer",
          parent_id: PARENT_ID,
          created_at: "2026-07-27T12:00:00.000Z",
          updated_at: "2026-07-27T12:00:00.000Z",
        }],
        error: null,
      },
      user_reasonings: {
        data: [{
          id: REASONING_ID,
          title: "Vorsteuerabzug",
          content: "Der Vorsteuerabzug setzt eine ordnungsgemäße Rechnung voraus.",
          created_at: "2026-07-27T12:00:00.000Z",
          updated_at: "2026-07-27T13:00:00.000Z",
        }],
        error: null,
      },
      user_reasoning_category_links: {
        data: [{ reasoning_id: REASONING_ID, category_id: CATEGORY_ID }],
        error: null,
      },
    };
    const from = vi.fn((table: string) => queryBuilder(results[table], scopes));
    vi.mocked(getSupabaseServerClient).mockReturnValue({ auth: {}, from } as never);

    const response = await GET(new Request("https://findog.at/api/reasonings"));

    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledTimes(3);
    expect(scopes).toEqual([
      ["client_id", USER_ID],
      ["client_id", USER_ID],
      ["client_id", USER_ID],
    ]);
    await expect(response.json()).resolves.toEqual({
      categories: [{
        id: CATEGORY_ID,
        name: "Umsatzsteuer",
        parentId: PARENT_ID,
        createdAt: "2026-07-27T12:00:00.000Z",
        updatedAt: "2026-07-27T12:00:00.000Z",
      }],
      reasonings: [{
        id: REASONING_ID,
        title: "Vorsteuerabzug",
        content: "Der Vorsteuerabzug setzt eine ordnungsgemäße Rechnung voraus.",
        categoryIds: [CATEGORY_ID],
        createdAt: "2026-07-27T12:00:00.000Z",
        updatedAt: "2026-07-27T13:00:00.000Z",
      }],
    });
  });

  it("saves through the atomic RPC with the authenticated user id", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: REASONING_ID, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ auth: {}, rpc } as never);

    const response = await POST(new Request("https://findog.at/api/reasonings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: " Vorsteuerabzug ",
        content: " Rechnung prüfen. ",
        categoryIds: [CATEGORY_ID],
      }),
    }));

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("save_user_reasoning", {
      p_client_id: USER_ID,
      p_reasoning_id: null,
      p_title: "Vorsteuerabzug",
      p_content: "Rechnung prüfen.",
      p_category_ids: [CATEGORY_ID],
    });
  });

  it("does not call the database for an invalid category id", async () => {
    const rpc = vi.fn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ auth: {}, rpc } as never);

    const response = await POST(new Request("https://findog.at/api/reasonings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Titel",
        content: "Inhalt",
        categoryIds: ["not-a-uuid"],
      }),
    }));

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps cross-user category assignments to a safe validation error", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "42501", message: "reasoning category ownership mismatch" },
    });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ auth: {}, rpc } as never);

    const response = await POST(new Request("https://findog.at/api/reasonings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Titel",
        content: "Inhalt",
        categoryIds: [CATEGORY_ID],
      }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Mindestens eine Kategorie ist nicht verfügbar.",
    });
  });
});
