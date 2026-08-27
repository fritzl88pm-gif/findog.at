import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateAdminRequest } from "@/lib/admin-users";
import type { AuthenticatedUser } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { clearOpenRouterUsageCacheForTests } from "@/lib/openrouter-usage";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GET } from "./route";

vi.mock("@/lib/admin-users", () => ({ authenticateAdminRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

function mockCreditsPayload() {
  return {
    data: {
      total_credits: 170,
      total_usage: 148.97,
    },
  };
}

function mockKeysPayload() {
  return {
    data: [
      {
        id: "key-weknora-id",
        name: "WeKnora",
        label: "secret-key-label-hash",
        limit: 200,
        usage_daily: 3.5,
        usage_weekly: 18.2,
        usage_monthly: 45.0,
      },
    ],
  };
}

function mockSummaryPayload() {
  return {
    data: [
      {
        request_count: 50,
        total_usage: 1.25,
        tokens_prompt: 500000,
        tokens_completion: 10000,
        tokens_total: 510000,
        reasoning_tokens: 2000,
        cached_tokens: 50000,
        cache_hit_rate: 0.35,
        avg_latency: 0.85,
        p90_latency: 1.50,
      },
    ],
    metadata: { row_count: 1, truncated: false },
    warnings: [],
  };
}

function mockModelsPayload() {
  return {
    data: [
      {
        model: "openai/gpt-5.6-luna-pro-20260709",
        provider: "OpenAI",
        request_count: 50,
        total_usage: 1.25,
        tokens_prompt: 500000,
        tokens_completion: 10000,
        tokens_total: 510000,
        reasoning_tokens: 2000,
        avg_latency: 0.85,
      },
    ],
    metadata: { row_count: 1, truncated: false },
    warnings: [],
  };
}

function mockKeyAnalyticsPayload() {
  return {
    data: [
      {
        api_key_id: "key-weknora-id",
        request_count: 50,
        total_usage: 1.25,
        tokens_total: 510000,
      },
    ],
    metadata: { row_count: 1, truncated: false },
    warnings: [],
  };
}

function mockTrendPayload() {
  return {
    data: [
      {
        timestamp: "2026-08-27T14:00:00Z",
        request_count: 25,
        total_usage: 0.6,
        tokens_total: 250000,
      },
      {
        timestamp: "2026-08-27T15:00:00Z",
        request_count: 25,
        total_usage: 0.65,
        tokens_total: 260000,
      },
    ],
    metadata: { row_count: 2, truncated: false },
    warnings: [],
  };
}

function mockFetchResponse() {
  return vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (url.includes("/api/v1/credits")) {
      return Promise.resolve(new Response(JSON.stringify(mockCreditsPayload()), { status: 200 }));
    }
    if (url.includes("/api/v1/keys")) {
      return Promise.resolve(new Response(JSON.stringify(mockKeysPayload()), { status: 200 }));
    }
    if (url.includes("/api/v1/analytics/query") && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.dimensions?.includes("model")) {
        return Promise.resolve(new Response(JSON.stringify(mockModelsPayload()), { status: 200 }));
      }
      if (body.dimensions?.includes("api_key_id")) {
        return Promise.resolve(new Response(JSON.stringify(mockKeyAnalyticsPayload()), { status: 200 }));
      }
      if (body.granularity) {
        return Promise.resolve(new Response(JSON.stringify(mockTrendPayload()), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify(mockSummaryPayload()), { status: 200 }));
    }
    return Promise.resolve(new Response("Not found", { status: 404 }));
  });
}

function mockSupabaseClient(): SupabaseClient {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockImplementation((from: number) => Promise.resolve({
        data: from === 0
          ? [{ client_id: "user-123", created_at: "2026-08-27T14:00:00Z", role: "user" }]
          : [],
        error: null,
      })),
    }),
    auth: {
      admin: {
        listUsers: vi.fn().mockResolvedValue({
          data: { users: [{ id: "user-123", email: "admin-user@example.at" }] },
          error: null,
        }),
      },
    },
  } as unknown as SupabaseClient;
}

const mockAdminUser: AuthenticatedUser = {
  id: "admin-id",
  email: "admin@example.at",
};

describe("GET /api/admin/openrouter-usage", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, OPENROUTER_MANAGEMENT_KEY: "test-management-key" };
    clearOpenRouterUsageCacheForTests();
    vi.mocked(authenticateAdminRequest).mockReset();
    vi.mocked(getSupabaseServerClient).mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
    clearOpenRouterUsageCacheForTests();
    vi.restoreAllMocks();
  });

  it("rejects unauthorized callers with 401/403 status", async () => {
    const supabase = mockSupabaseClient();
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase);
    vi.mocked(authenticateAdminRequest).mockRejectedValueOnce(
      new UserVisibleError("Du hast keine Administrationsberechtigung.", 403),
    );

    const response = await GET(new Request("https://findog.example/api/admin/openrouter-usage"));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ error: "Du hast keine Administrationsberechtigung." });
  });

  it("returns 503 when Supabase is not configured", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValue(null);

    const response = await GET(new Request("https://findog.example/api/admin/openrouter-usage"));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ error: "Administration ist derzeit nicht verfügbar." });
  });

  it("returns 400 when range parameter is invalid", async () => {
    const supabase = mockSupabaseClient();
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase);
    vi.mocked(authenticateAdminRequest).mockResolvedValue(mockAdminUser);

    const response = await GET(new Request("https://findog.example/api/admin/openrouter-usage?range=invalid"));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: "Der Zeitraum ist ungültig." });
  });

  it("returns a strict no-store snapshot for admins and sanitizes upstream data", async () => {
    const supabase = mockSupabaseClient();
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase);
    vi.mocked(authenticateAdminRequest).mockResolvedValue(mockAdminUser);

    const fetchMock = mockFetchResponse();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("https://findog.example/api/admin/openrouter-usage?range=7d"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("Vary")).toBe("Authorization");

    const payload = await response.json();
    expect(payload).toMatchObject({
      stale: false,
      range: "7d",
      credits: {
        totalCredits: 170,
        totalUsage: 148.97,
      },
      summary: {
        requests: 50,
        totalCost: 1.25,
      },
      models: [
        {
          model: "openai/gpt-5.6-luna-pro-20260709",
          provider: "OpenAI",
          cost: 1.25,
        },
      ],
      fredUsers: {
        totalQuestions: 1,
        weKnoraCost: 1.25,
        costAttribution: "estimated_request_share",
        users: [
          {
            clientId: "user-123",
            email: "admin-user@example.at",
            questions: 1,
            questionSharePct: 100,
            estimatedCost: 1.25,
            costAttribution: "estimated_request_share",
          },
        ],
      },
    });

    // Ensure no management key, secrets or hashes leaked
    const jsonStr = JSON.stringify(payload);
    expect(jsonStr).not.toContain("test-management-key");
    expect(jsonStr).not.toContain("secret-key-label-hash");
  });

  it("passes refresh=1 to bypass cache", async () => {
    const supabase = mockSupabaseClient();
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase);
    vi.mocked(authenticateAdminRequest).mockResolvedValue(mockAdminUser);

    const fetchMock = mockFetchResponse();
    vi.stubGlobal("fetch", fetchMock);

    const res1 = await GET(new Request("https://findog.example/api/admin/openrouter-usage?range=24h"));
    expect(res1.status).toBe(200);
    const countAfterFirst = fetchMock.mock.calls.length;

    // Second call without refresh uses cache
    const res2 = await GET(new Request("https://findog.example/api/admin/openrouter-usage?range=24h"));
    expect(res2.status).toBe(200);
    expect(fetchMock.mock.calls.length).toBe(countAfterFirst);

    // Third call with refresh=1 bypasses cache
    const res3 = await GET(new Request("https://findog.example/api/admin/openrouter-usage?range=24h&refresh=1"));
    expect(res3.status).toBe(200);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(countAfterFirst);
  });
});
