import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GET, DELETE } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONVO_ID_A = "11111111-1111-4111-8111-111111111111";
const CONVO_ID_B = "22222222-2222-4222-8222-222222222222";

describe("GET /api/fred/conversations — origin and user isolation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("includes origin and telegram_integration_id in each summary", async () => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: USER_A });
    const queryChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({
        data: [
          {
            id: CONVO_ID_A,
            title: "Web convo",
            created_at: "2026-07-31T10:00:00Z",
            updated_at: "2026-07-31T10:01:00Z",
            agent_key: "fred",
            origin: "web",
            telegram_integration_id: null,
          },
          {
            id: CONVO_ID_B,
            title: "Telegram convo",
            created_at: "2026-07-31T11:00:00Z",
            updated_at: "2026-07-31T11:05:00Z",
            agent_key: "fred",
            origin: "telegram",
            telegram_integration_id: "33333333-3333-4333-8333-333333333333",
          },
        ],
        error: null,
      }),
    };
    vi.mocked(getSupabaseServerClient).mockReturnValue({
      from: vi.fn().mockReturnValue(queryChain),
    } as never);

    const response = await GET(
      new Request("http://localhost/api/fred/conversations", {
        headers: { Authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.conversations).toHaveLength(2);
    expect(payload.conversations[0]).toMatchObject({
      id: CONVO_ID_A,
      origin: "web",
      telegramIntegrationId: null,
    });
    expect(payload.conversations[1]).toMatchObject({
      id: CONVO_ID_B,
      origin: "telegram",
      telegramIntegrationId: "33333333-3333-4333-8333-333333333333",
    });
  });

  it("isolates conversations by authenticated user only", async () => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: USER_A });
    const queryChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({
        data: [{ id: CONVO_ID_A, title: "A-only", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", agent_key: "fred", origin: "web", telegram_integration_id: null }],
        error: null,
      }),
    };
    vi.mocked(getSupabaseServerClient).mockReturnValue({
      from: vi.fn().mockReturnValue(queryChain),
    } as never);

    const response = await GET(
      new Request("http://localhost/api/fred/conversations", {
        headers: { Authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(200);
    expect(queryChain.eq).toHaveBeenCalledWith("client_id", USER_A);
  });

  it("preserves history when integration FK is null but origin is telegram", async () => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: USER_A });
    const queryChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({
        data: [
          {
            id: CONVO_ID_A,
            title: "Old Telegram convo",
            created_at: "2026-07-01T00:00:00Z",
            updated_at: "2026-07-01T00:00:00Z",
            agent_key: "fred",
            origin: "telegram",
            telegram_integration_id: null,
          },
        ],
        error: null,
      }),
    };
    vi.mocked(getSupabaseServerClient).mockReturnValue({
      from: vi.fn().mockReturnValue(queryChain),
    } as never);

    const response = await GET(
      new Request("http://localhost/api/fred/conversations", {
        headers: { Authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.conversations).toHaveLength(1);
    expect(payload.conversations[0]).toMatchObject({
      id: CONVO_ID_A,
      origin: "telegram",
      telegramIntegrationId: null,
    });
  });
});

describe("DELETE /api/fred/conversations — user isolation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("deletes only conversations owned by the authenticated user", async () => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: USER_A });
    const rpc = vi.fn().mockResolvedValue({ data: [{ id: CONVO_ID_A }], error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({
      rpc,
    } as never);

    const response = await DELETE(
      new Request("http://localhost/api/fred/conversations", {
        method: "DELETE",
        headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [CONVO_ID_A] }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.deletedIds).toEqual([CONVO_ID_A]);
    expect(rpc).toHaveBeenCalledWith("delete_owned_fred_conversations", {
      p_client_id: USER_A,
      p_conversation_ids: [CONVO_ID_A],
    });
  });

  it("prevents user A from deleting user B conversations", async () => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: USER_A });
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({
      rpc,
    } as never);

    const response = await DELETE(
      new Request("http://localhost/api/fred/conversations", {
        method: "DELETE",
        headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [CONVO_ID_B] }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.deletedIds).toEqual([]);
    expect(rpc).toHaveBeenCalledWith("delete_owned_fred_conversations", {
      p_client_id: USER_A,
      p_conversation_ids: [CONVO_ID_B],
    });
  });
});

// Hosted Supabase PostgREST returns at most this many rows per response.
const POSTGREST_MAX_ROWS = 1_000;

function cappedQuery(rows: unknown[]) {
  let from = 0;
  let to = Number.POSITIVE_INFINITY;
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.range = vi.fn((rangeFrom: number, rangeTo: number) => {
    from = rangeFrom;
    to = rangeTo;
    return builder;
  });
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve({
      data: rows.slice(from, Math.min(to + 1, from + POSTGREST_MAX_ROWS)),
      error: null,
    }).then(resolve, reject);
  return builder;
}

describe("GET /api/fred/conversations — paging", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: USER_A });
  });

  it("returns every conversation past the 1000-row response cap", async () => {
    const rows = Array.from({ length: 1_500 }, (_, index) => ({
      id: `11111111-0000-4000-8000-${String(index).padStart(12, "0")}`,
      title: `Unterhaltung ${index}`,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      agent_key: "fred",
      origin: "web",
      telegram_integration_id: null,
    }));
    const query = cappedQuery(rows);
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn(() => query) } as never);

    const response = await GET(
      new Request("http://localhost/api/fred/conversations", {
        headers: { Authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.conversations).toHaveLength(1_500);
    expect(payload.conversations[1_499].id).toBe(rows[1_499].id);
    expect(query.eq).toHaveBeenCalledWith("client_id", USER_A);
    expect(query.order).toHaveBeenLastCalledWith("id", { ascending: false });
  });

  it("drops a conversation repeated because the list shifted between pages", async () => {
    const rows = Array.from({ length: 1_500 }, (_, index) => ({
      id: `11111111-0000-4000-8000-${String(index).padStart(12, "0")}`,
      title: `Unterhaltung ${index}`,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      agent_key: "fred",
      origin: "web",
      telegram_integration_id: null,
    }));
    const query = cappedQuery(rows);
    // After the first page, conversation 1200 gets a new message and moves to the top,
    // so the second page starts with row 999 again.
    const range = query.range as (rangeFrom: number, rangeTo: number) => unknown;
    const movedId = rows[1_200].id;
    query.range = vi.fn((rangeFrom: number, rangeTo: number) => {
      if (rangeFrom > 0 && rows[0].id !== movedId) {
        const [moved] = rows.splice(1_200, 1);
        rows.unshift(moved);
      }
      return range(rangeFrom, rangeTo);
    });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn(() => query) } as never);

    const response = await GET(
      new Request("http://localhost/api/fred/conversations", {
        headers: { Authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(200);
    const ids = (await response.json()).conversations.map((conversation: { id: string }) => conversation.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(1_499);
  });
});
