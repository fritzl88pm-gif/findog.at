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

function queryResult<T>(result: T) {
  const query = {
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    order: vi.fn(() => query),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (value: T) => unknown) => Promise.resolve(result).then(resolve),
  };
  return query;
}

describe("GET /api/conversations/:conversationId", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("returns chronological owned messages with persisted steps on their assistant response", async () => {
    const conversationQuery = queryResult({
      data: {
        id: "22222222-2222-4222-8222-222222222222",
        title: "Drittstaatenkinder",
        created_at: "2026-07-09T09:00:00.000Z",
        updated_at: "2026-07-09T10:00:00.000Z",
      },
      error: null,
    });
    const messagesQuery = queryResult({
      data: [
        {
          id: 10,
          role: "user",
          content: "Frage",
          created_at: "2026-07-09T09:01:00.000Z",
        },
        {
          id: 11,
          role: "assistant",
          content: "Antwort",
          created_at: "2026-07-09T09:02:00.000Z",
        },
      ],
      error: null,
    });
    const runsQuery = queryResult({
      data: [{ id: "44444444-4444-4444-8444-444444444444", assistant_message_id: 11 }],
      error: null,
    });
    const stepsQuery = queryResult({
      data: [
        {
          agent_run_id: "44444444-4444-4444-8444-444444444444",
          step_order: 0,
          step_type: "tool_result",
          title: "BFG-Vorabfrage",
          content: "3 Treffer",
          tool_name: "hybrid_search",
          success: true,
          arguments: null,
        },
      ],
      error: null,
    });
    const select = vi.fn((table: string) => {
      if (table === "conversations") return conversationQuery;
      if (table === "messages") return messagesQuery;
      if (table === "agent_runs") return runsQuery;
      return stepsQuery;
    });
    const from = vi.fn((table: string) => ({
      select: vi.fn(() => select(table)),
    }));
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never);

    const response = await GET(
      new Request("http://localhost/api/conversations/22222222-2222-4222-8222-222222222222", {
        headers: { Authorization: "Bearer access-token" },
      }),
      { params: Promise.resolve({ conversationId: "22222222-2222-4222-8222-222222222222" }) },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.messages.map((message: { role: string }) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(payload.messages[1].steps).toEqual([
      {
        type: "tool_result",
        title: "BFG-Vorabfrage",
        content: "3 Treffer",
        toolName: "hybrid_search",
        success: true,
      },
    ]);
    expect(conversationQuery.eq).toHaveBeenCalledWith(
      "client_id",
      "11111111-1111-4111-8111-111111111111",
    );
    expect(messagesQuery.order.mock.calls).toEqual([
      ["created_at", { ascending: true }],
      ["id", { ascending: true }],
    ]);
  });

  it("returns owned messages without steps when agent trace tables are not deployed yet", async () => {
    const conversationQuery = queryResult({
      data: {
        id: "22222222-2222-4222-8222-222222222222",
        title: "Drittstaatenkinder",
        created_at: "2026-07-09T09:00:00.000Z",
        updated_at: "2026-07-09T10:00:00.000Z",
      },
      error: null,
    });
    const messagesQuery = queryResult({
      data: [
        {
          id: 10,
          role: "user",
          content: "Frage",
          created_at: "2026-07-09T09:01:00.000Z",
        },
        {
          id: 11,
          role: "assistant",
          content: "Antwort",
          created_at: "2026-07-09T09:02:00.000Z",
        },
      ],
      error: null,
    });
    const runsQuery = queryResult({
      data: null,
      error: {
        code: "42P01",
        message: 'relation "public.agent_runs" does not exist',
      },
    });
    const from = vi.fn((table: string) => ({
      select: vi.fn(() => {
        if (table === "conversations") return conversationQuery;
        if (table === "messages") return messagesQuery;
        return runsQuery;
      }),
    }));
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never);

    const response = await GET(
      new Request("http://localhost/api/conversations/22222222-2222-4222-8222-222222222222", {
        headers: { Authorization: "Bearer access-token" },
      }),
      { params: Promise.resolve({ conversationId: "22222222-2222-4222-8222-222222222222" }) },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.messages).toEqual([
      {
        id: 10,
        role: "user",
        content: "Frage",
        createdAt: "2026-07-09T09:01:00.000Z",
      },
      {
        id: 11,
        role: "assistant",
        content: "Antwort",
        createdAt: "2026-07-09T09:02:00.000Z",
      },
    ]);
    expect(from).not.toHaveBeenCalledWith("agent_steps");
  });

  it("keeps unexpected agent trace errors fatal", async () => {
    const conversationQuery = queryResult({
      data: {
        id: "22222222-2222-4222-8222-222222222222",
        title: "Drittstaatenkinder",
        created_at: "2026-07-09T09:00:00.000Z",
        updated_at: "2026-07-09T10:00:00.000Z",
      },
      error: null,
    });
    const messagesQuery = queryResult({ data: [], error: null });
    const runsQuery = queryResult({
      data: null,
      error: { code: "42501", message: "permission denied for table agent_runs" },
    });
    const from = vi.fn((table: string) => ({
      select: vi.fn(() => {
        if (table === "conversations") return conversationQuery;
        if (table === "messages") return messagesQuery;
        return runsQuery;
      }),
    }));
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never);

    const response = await GET(
      new Request("http://localhost/api/conversations/22222222-2222-4222-8222-222222222222", {
        headers: { Authorization: "Bearer access-token" },
      }),
      { params: Promise.resolve({ conversationId: "22222222-2222-4222-8222-222222222222" }) },
    );

    expect(response.status).toBe(503);
  });

  it("does not reveal another owner's conversation", async () => {
    const conversationQuery = queryResult({ data: null, error: null });
    const from = vi.fn(() => ({ select: vi.fn(() => conversationQuery) }));
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never);

    const response = await GET(
      new Request("http://localhost/api/conversations/22222222-2222-4222-8222-222222222222", {
        headers: { Authorization: "Bearer access-token" },
      }),
      { params: Promise.resolve({ conversationId: "22222222-2222-4222-8222-222222222222" }) },
    );

    expect(response.status).toBe(404);
    expect(from).toHaveBeenCalledTimes(1);
  });
});
