import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UserVisibleError } from "./errors";
import {
  clearOpenRouterUsageCacheForTests,
  formatOpenRouterUtcTimestamp,
  getOpenRouterUsageSnapshot,
  normalizeCreditsPayload,
  normalizeKeysPayload,
  normalizeOpenRouterUsagePayloads,
  rangeWindow,
} from "./openrouter-usage";

function mockCreditsResponse() {
  return {
    data: {
      total_credits: 170,
      total_usage: 148.97,
    },
  };
}

function mockKeysResponse() {
  return {
    data: [
      {
        id: "key-uuid-weknora",
        name: "WeKnora",
        label: "secret-key-hash-123456",
        limit: 200,
        limit_remaining: 177,
        usage_daily: 3.5,
        usage_weekly: 18.2,
        usage_monthly: 45.0,
      },
      {
        id: "key-uuid-hermes",
        name: "hermes",
        label: "secret-label-hermes-hash",
        limit: null,
        usage_daily: 0.8,
        usage_weekly: 4.1,
        usage_monthly: 12.0,
      },
    ],
  };
}

function mockSummaryQueryResponse() {
  return {
    data: [
      {
        request_count: "350",
        total_usage: "4.8520",
        tokens_prompt: "15000000",
        tokens_completion: "250000",
        tokens_total: "15250000",
        reasoning_tokens: "80000",
        cached_tokens: "1200000",
        cache_hit_rate: "0.45",
        avg_latency: "1250",
        p90_latency: "2800",
      },
    ],
    metadata: {
      row_count: 1,
      truncated: false,
    },
    warnings: [],
  };
}

function mockModelsQueryResponse() {
  return {
    data: [
      {
        model: "openai/gpt-5.6-luna-pro-20260709",
        provider: "OpenAI",
        request_count: 120,
        total_usage: 3.25,
        tokens_prompt: 12000000,
        tokens_completion: 180000,
        tokens_total: 12180000,
        reasoning_tokens: 65000,
        avg_latency: 1450,
      },
      {
        model: "cohere/rerank-4-pro",
        provider: "Cohere",
        request_count: 200,
        total_usage: 1.20,
        tokens_prompt: 0,
        tokens_completion: 0,
        tokens_total: 0,
        reasoning_tokens: 0,
        avg_latency: 350,
      },
      {
        model: "google/gemini-3.7-flash",
        provider: "Google",
        request_count: 30,
        total_usage: 0.402,
        tokens_prompt: 3000000,
        tokens_completion: 70000,
        tokens_total: 3070000,
        reasoning_tokens: 15000,
        avg_latency: 850,
      },
    ],
    metadata: {
      row_count: 3,
      truncated: false,
    },
    warnings: [],
  };
}

function mockKeyAnalyticsQueryResponse() {
  return {
    data: [
      {
        api_key_id: "key-uuid-weknora",
        request_count: 310,
        total_usage: 4.25,
        tokens_total: 14500000,
      },
      {
        api_key_id: "key-uuid-hermes",
        request_count: 40,
        total_usage: 0.602,
        tokens_total: 750000,
      },
    ],
    metadata: {
      row_count: 2,
      truncated: false,
    },
    warnings: [],
  };
}

function mockTrendQueryResponse(granularity: "hour" | "day") {
  if (granularity === "hour") {
    return {
      data: [
        {
          timestamp: "2026-08-27T14:00:00Z",
          request_count: 25,
          total_usage: 0.35,
          tokens_total: 1200000,
        },
        {
          timestamp: "2026-08-27T15:00:00Z",
          request_count: 30,
          total_usage: 0.42,
          tokens_total: 1500000,
        },
      ],
      metadata: {
        row_count: 2,
        truncated: false,
      },
      warnings: [],
    };
  }
  return {
    data: [
      {
        timestamp: "2026-08-26T00:00:00Z",
        request_count: 150,
        total_usage: 2.15,
        tokens_total: 7000000,
      },
      {
        timestamp: "2026-08-27T00:00:00Z",
        request_count: 200,
        total_usage: 2.702,
        tokens_total: 8250000,
      },
    ],
    metadata: {
      row_count: 2,
      truncated: false,
    },
    warnings: [],
  };
}

function mockFredMessages() {
  return [
    { client_id: "user-1-uuid", created_at: "2026-08-27T14:30:00.000Z", role: "user" },
    { client_id: "user-1-uuid", created_at: "2026-08-27T15:10:00.000Z", role: "user" },
    { client_id: "user-2-uuid", created_at: "2026-08-27T13:00:00.000Z", role: "user" },
  ];
}

function createMockSupabase(messages = mockFredMessages(), authUsers: Array<{ id: string; email: string }> = [
  { id: "user-1-uuid", email: "user1@example.com" },
  { id: "user-2-uuid", email: "user2@example.com" },
]): SupabaseClient {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockImplementation((from: number, to: number) => Promise.resolve({
      data: messages.slice(from, to + 1),
      error: null,
    })),
  };

  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "fred_messages") {
        return query;
      }
      throw new Error(`Unexpected table ${table}`);
    }),
    auth: {
      admin: {
        listUsers: vi.fn().mockImplementation(({ page = 1 } = {}) => {
          if (page === 1) {
            return Promise.resolve({
              data: { users: authUsers },
              error: null,
            });
          }
          return Promise.resolve({
            data: { users: [] },
            error: null,
          });
        }),
      },
    },
  } as unknown as SupabaseClient;
}

describe("OpenRouter UTC timestamp and range formatting", () => {
  it("formats dates strictly as YYYY-MM-DDTHH:mm:ssZ without microseconds or +00:00", () => {
    const d = new Date("2026-08-27T15:29:12.456Z");
    const formatted = formatOpenRouterUtcTimestamp(d);
    expect(formatted).toBe("2026-08-27T15:29:12Z");
    expect(formatted).not.toContain("+00:00");
    expect(formatted).not.toContain(".");
    expect(formatted.endsWith("Z")).toBe(true);
  });

  it("calculates exact rolling ranges with hour granularity for 24h and day for 7d/30d", () => {
    const fixedNow = new Date("2026-08-27T15:30:00.000Z").getTime();

    const range24h = rangeWindow("24h", fixedNow);
    expect(range24h.granularity).toBe("hour");
    expect(range24h.timeRange.start).toBe("2026-08-26T15:30:00Z");
    expect(range24h.timeRange.end).toBe("2026-08-27T15:30:00Z");

    const range7d = rangeWindow("7d", fixedNow);
    expect(range7d.granularity).toBe("day");
    expect(range7d.timeRange.start).toBe("2026-08-20T15:30:00Z");
    expect(range7d.timeRange.end).toBe("2026-08-27T15:30:00Z");

    const range30d = rangeWindow("30d", fixedNow);
    expect(range30d.granularity).toBe("day");
    expect(range30d.timeRange.start).toBe("2026-07-28T15:30:00Z");
    expect(range30d.timeRange.end).toBe("2026-08-27T15:30:00Z");
  });
});

describe("OpenRouter payload normalizers", () => {
  it("normalizes credits payload and computes remaining credits and percentage", () => {
    const credits = normalizeCreditsPayload({
      data: {
        total_credits: 200,
        total_usage: 50,
      },
    });
    expect(credits).toEqual({
      totalCredits: 200,
      totalUsage: 50,
      remaining: 150,
      remainingPercent: 75,
    });
  });

  it("handles string numbers in credits payload safely", () => {
    const credits = normalizeCreditsPayload({
      data: {
        total_credits: "170.50",
        total_usage: "148.97",
      },
    });
    expect(credits?.totalCredits).toBe(170.5);
    expect(credits?.totalUsage).toBe(148.97);
    expect(credits?.remaining).toBeCloseTo(21.53, 2);
  });

  it("never exposes key hashes, secrets or raw labels in normalized keys", () => {
    const keys = normalizeKeysPayload(mockKeysResponse());
    expect(keys).toHaveLength(2);
    expect(keys[0]).toEqual({
      id: "key-uuid-weknora",
      name: "WeKnora",
      limit: 200,
      remainingLimit: 177,
      usageDaily: 3.5,
      usageWeekly: 18.2,
      usageMonthly: 45,
      cost: null,
      requests: null,
    });
    // Ensure no secrets or labels leaked
    const jsonStr = JSON.stringify(keys);
    expect(jsonStr).not.toContain("secret-key-hash");
    expect(jsonStr).not.toContain("secret-label");
  });

  it("safely parses numeric string counts from Beta Analytics", () => {
    const snapshot = normalizeOpenRouterUsagePayloads({
      credits: mockCreditsResponse(),
      keys: mockKeysResponse(),
      summaryQuery: mockSummaryQueryResponse(),
      modelsQuery: mockModelsQueryResponse(),
      keyAnalyticsQuery: mockKeyAnalyticsQueryResponse(),
      trendQuery: mockTrendQueryResponse("hour"),
      fredMessages: mockFredMessages(),
      userMap: new Map([
        ["user-1-uuid", "user1@example.com"],
        ["user-2-uuid", "user2@example.com"],
      ]),
      range: "24h",
      generatedAt: "2026-08-27T15:30:00.000Z",
    });

    expect(snapshot.summary).toMatchObject({
      requests: 350,
      totalCost: 4.852,
      promptTokens: 15000000,
      completionTokens: 250000,
      totalTokens: 15250000,
      reasoningTokens: 80000,
      cachedTokens: 1200000,
      cacheHitRate: 45, // 0.45 normalized to 45%
      avgLatencyMs: 1250, // legacy flat fixture
      p90LatencyMs: 2800,
    });
  });

  it("normalizes the live nested Beta Analytics envelope, trend keys, and millisecond latency", () => {
    const analytics = (rows: Array<Record<string, unknown>>) => ({
      data: {
        data: rows,
        metadata: { row_count: rows.length, truncated: false },
      },
    });
    const snapshot = normalizeOpenRouterUsagePayloads({
      credits: mockCreditsResponse(),
      keys: mockKeysResponse(),
      summaryQuery: analytics([{
        request_count: "721",
        total_usage: 1.445897,
        avg_latency: 42,
        p90_latency: 3845,
      }]),
      modelsQuery: analytics([]),
      keyAnalyticsQuery: analytics([]),
      trendQuery: analytics([{
        date__hour: "2026-08-27 15:00:00",
        request_count: "75",
        total_usage: 0.000049,
        tokens_total: "3552",
      }]),
      fredMessages: [],
      userMap: new Map(),
      range: "24h",
      generatedAt: "2026-08-27T15:30:00.000Z",
    });

    expect(snapshot.summary).toMatchObject({
      requests: 721,
      totalCost: 1.445897,
      avgLatencyMs: 42,
      p90LatencyMs: 3845,
    });
    expect(snapshot.dailyTrend).toEqual([{
      date: "2026-08-27 15:00:00",
      requests: 75,
      tokens: 3552,
      cost: 0.000049,
    }]);
  });

  it("sorts models descending by cost", () => {
    const snapshot = normalizeOpenRouterUsagePayloads({
      credits: mockCreditsResponse(),
      keys: mockKeysResponse(),
      summaryQuery: mockSummaryQueryResponse(),
      modelsQuery: mockModelsQueryResponse(),
      keyAnalyticsQuery: mockKeyAnalyticsQueryResponse(),
      trendQuery: mockTrendQueryResponse("hour"),
      fredMessages: [],
      userMap: new Map(),
      range: "24h",
      generatedAt: "2026-08-27T15:30:00.000Z",
    });

    expect(snapshot.models[0].model).toBe("openai/gpt-5.6-luna-pro-20260709");
    expect(snapshot.models[0].cost).toBe(3.25);
    expect(snapshot.models[1].model).toBe("cohere/rerank-4-pro");
    expect(snapshot.models[1].cost).toBe(1.2);
    expect(snapshot.models[2].model).toBe("google/gemini-3.7-flash");
    expect(snapshot.models[2].cost).toBe(0.402);
  });

  it("propagates truncated flag and warnings from analytics query", () => {
    const summaryWithWarnings = {
      data: [{ request_count: 10, total_usage: 0.1 }],
      metadata: { row_count: 1, truncated: true },
      warnings: ["Unresolvable filter: hash-abc"],
    };

    const snapshot = normalizeOpenRouterUsagePayloads({
      credits: mockCreditsResponse(),
      keys: mockKeysResponse(),
      summaryQuery: summaryWithWarnings,
      modelsQuery: mockModelsQueryResponse(),
      keyAnalyticsQuery: mockKeyAnalyticsQueryResponse(),
      trendQuery: mockTrendQueryResponse("hour"),
      fredMessages: [],
      userMap: new Map(),
      range: "24h",
      generatedAt: "2026-08-27T15:30:00.000Z",
    });

    expect(snapshot.truncated).toBe(true);
    expect(snapshot.warnings).toContain("Unresolvable filter: hash-abc");
  });
});

describe("Fred per-user stats and estimated cost formula", () => {
  it("calculates estimated user cost proportionally from WeKnora key spend with exact question counts", () => {
    const userMap = new Map([
      ["user-1-uuid", "user1@example.com"],
      ["user-2-uuid", "user2@example.com"],
    ]);
    const fredMessages = [
      { client_id: "user-1-uuid", created_at: "2026-08-27T14:00:00.000Z", role: "user" },
      { client_id: "user-1-uuid", created_at: "2026-08-27T15:00:00.000Z", role: "user" },
      { client_id: "user-2-uuid", created_at: "2026-08-27T13:00:00.000Z", role: "user" },
    ];
    // WeKnora key cost in analytics is 4.25 (from mockKeyAnalyticsQueryResponse)
    const snapshot = normalizeOpenRouterUsagePayloads({
      credits: mockCreditsResponse(),
      keys: mockKeysResponse(),
      summaryQuery: mockSummaryQueryResponse(),
      modelsQuery: mockModelsQueryResponse(),
      keyAnalyticsQuery: mockKeyAnalyticsQueryResponse(),
      trendQuery: mockTrendQueryResponse("hour"),
      fredMessages,
      userMap,
      range: "24h",
      generatedAt: "2026-08-27T15:30:00.000Z",
    });

    expect(snapshot.fredUsers.totalQuestions).toBe(3);
    expect(snapshot.fredUsers.weKnoraCost).toBe(4.25);
    expect(snapshot.fredUsers.costAttribution).toBe("estimated_request_share");

    // user 1 has 2 questions out of 3 -> 2/3 of 4.25 = 2.8333333333333335
    const user1 = snapshot.fredUsers.users.find((u) => u.email === "user1@example.com");
    expect(user1).toBeDefined();
    expect(user1?.questions).toBe(2);
    expect(user1?.questionSharePct).toBeCloseTo(66.67, 1);
    expect(user1?.estimatedCost).toBeCloseTo(4.25 * (2 / 3), 4);
    expect(user1?.costAttribution).toBe("estimated_request_share");
    expect(user1?.lastQuestionAt).toBe("2026-08-27T15:00:00.000Z");

    // user 2 has 1 question out of 3 -> 1/3 of 4.25 = 1.4166666666666667
    const user2 = snapshot.fredUsers.users.find((u) => u.email === "user2@example.com");
    expect(user2).toBeDefined();
    expect(user2?.questions).toBe(1);
    expect(user2?.questionSharePct).toBeCloseTo(33.33, 1);
    expect(user2?.estimatedCost).toBeCloseTo(4.25 * (1 / 3), 4);
    expect(user2?.costAttribution).toBe("estimated_request_share");
  });

  it("handles unknown user gracefully when not in auth.users", () => {
    const userMap = new Map<string, string>(); // empty user map
    const fredMessages = [
      { client_id: "unknown-uuid", created_at: "2026-08-27T14:00:00.000Z", role: "user" },
    ];

    const snapshot = normalizeOpenRouterUsagePayloads({
      credits: mockCreditsResponse(),
      keys: mockKeysResponse(),
      summaryQuery: mockSummaryQueryResponse(),
      modelsQuery: mockModelsQueryResponse(),
      keyAnalyticsQuery: mockKeyAnalyticsQueryResponse(),
      trendQuery: mockTrendQueryResponse("hour"),
      fredMessages,
      userMap,
      range: "24h",
      generatedAt: "2026-08-27T15:30:00.000Z",
    });

    expect(snapshot.fredUsers.users).toHaveLength(1);
    expect(snapshot.fredUsers.users[0].email).toBe("Unbekannter User");
    expect(snapshot.fredUsers.users[0].questions).toBe(1);
    expect(snapshot.fredUsers.users[0].estimatedCost).toBe(4.25);
  });

  it("allocates WeKnora cost to 'System / nicht zugeordnet' when there are 0 Fred questions", () => {
    const snapshot = normalizeOpenRouterUsagePayloads({
      credits: mockCreditsResponse(),
      keys: mockKeysResponse(),
      summaryQuery: mockSummaryQueryResponse(),
      modelsQuery: mockModelsQueryResponse(),
      keyAnalyticsQuery: mockKeyAnalyticsQueryResponse(),
      trendQuery: mockTrendQueryResponse("hour"),
      fredMessages: [],
      userMap: new Map(),
      range: "24h",
      generatedAt: "2026-08-27T15:30:00.000Z",
    });

    expect(snapshot.fredUsers.totalQuestions).toBe(0);
    expect(snapshot.fredUsers.users).toHaveLength(0);
    expect(snapshot.fredUsers.systemRemainder).toEqual({
      clientId: null,
      email: "System / nicht zugeordnet",
      questions: 0,
      questionSharePct: 0,
      estimatedCost: 4.25,
      costAttribution: "estimated_request_share",
      lastQuestionAt: null,
    });
  });
});

describe("getOpenRouterUsageSnapshot client lifecycle, caching and error handling", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, OPENROUTER_MANAGEMENT_KEY: "test-management-key" };
    clearOpenRouterUsageCacheForTests();
  });

  afterEach(() => {
    process.env = originalEnv;
    clearOpenRouterUsageCacheForTests();
    vi.restoreAllMocks();
  });

  function setupMockFetch() {
    return vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.includes("/api/v1/credits")) {
        return Promise.resolve(new Response(JSON.stringify(mockCreditsResponse()), { status: 200 }));
      }
      if (url.includes("/api/v1/keys")) {
        return Promise.resolve(new Response(JSON.stringify(mockKeysResponse()), { status: 200 }));
      }
      if (url.includes("/api/v1/analytics/query") && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}"));
        if (body.dimensions?.includes("model")) {
          return Promise.resolve(new Response(JSON.stringify(mockModelsQueryResponse()), { status: 200 }));
        }
        if (body.dimensions?.includes("api_key_id")) {
          return Promise.resolve(new Response(JSON.stringify(mockKeyAnalyticsQueryResponse()), { status: 200 }));
        }
        if (body.granularity) {
          return Promise.resolve(new Response(JSON.stringify(mockTrendQueryResponse(body.granularity)), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify(mockSummaryQueryResponse()), { status: 200 }));
      }
      return Promise.resolve(new Response("Not found", { status: 404 }));
    });
  }

  it("throws 503 when OPENROUTER_MANAGEMENT_KEY is missing", async () => {
    delete process.env.OPENROUTER_MANAGEMENT_KEY;
    const fetcher = setupMockFetch();
    const supabase = createMockSupabase();

    await expect(getOpenRouterUsageSnapshot("24h", { fetcher, supabase })).rejects.toThrow(
      new UserVisibleError("OpenRouter ist serverseitig nicht konfiguriert.", 503),
    );
  });

  it("fetches OpenRouter endpoints with management key authorization header", async () => {
    const fetcher = setupMockFetch();
    const supabase = createMockSupabase();

    const snapshot = await getOpenRouterUsageSnapshot("24h", { fetcher, supabase });
    expect(snapshot.stale).toBe(false);
    expect(snapshot.range).toBe("24h");
    expect(snapshot.credits?.totalCredits).toBe(170);

    // Verify auth header on calls
    for (const call of fetcher.mock.calls) {
      const headers = (call[1] as RequestInit)?.headers as Record<string, string>;
      expect(headers?.Authorization).toBe("Bearer test-management-key");
    }
  });

  it("paginates fred_messages so user question counts remain exact above 1000 rows", async () => {
    const messages = Array.from({ length: 1001 }, (_, index) => ({
      client_id: "user-1-uuid",
      created_at: `2026-08-27T14:${String(index % 60).padStart(2, "0")}:00.000Z`,
      role: "user",
    }));
    const fetcher = setupMockFetch();
    const supabase = createMockSupabase(messages);

    const snapshot = await getOpenRouterUsageSnapshot("24h", { fetcher, supabase });

    expect(snapshot.fredUsers.totalQuestions).toBe(1001);
    expect(snapshot.fredUsers.users[0]).toMatchObject({
      email: "user1@example.com",
      questions: 1001,
    });
  });

  it("serves from 5-minute cache on second call unless refresh=true", async () => {
    const fetcher = setupMockFetch();
    const supabase = createMockSupabase();

    const first = await getOpenRouterUsageSnapshot("24h", { fetcher, supabase });
    expect(fetcher).toHaveBeenCalledTimes(6); // credits, keys, summary, models, key analytics, trend

    const second = await getOpenRouterUsageSnapshot("24h", { fetcher, supabase });
    expect(fetcher).toHaveBeenCalledTimes(6); // Cached, no new calls
    expect(second.generatedAt).toBe(first.generatedAt);

    const refreshed = await getOpenRouterUsageSnapshot("24h", { refresh: true, fetcher, supabase });
    expect(fetcher).toHaveBeenCalledTimes(12); // Refreshed, new calls made
    expect(refreshed.stale).toBe(false);
  });

  it("returns stale cached snapshot with warning on temporary upstream failure", async () => {
    const fetcher = setupMockFetch();
    const supabase = createMockSupabase();

    // First call populates cache
    await getOpenRouterUsageSnapshot("24h", { fetcher, supabase });

    // Subsequent call with failing upstream and refresh=true
    const failingFetcher = vi.fn().mockRejectedValue(new Error("Network connection error"));
    const staleSnapshot = await getOpenRouterUsageSnapshot("24h", {
      refresh: true,
      fetcher: failingFetcher,
      supabase,
    });

    expect(staleSnapshot.stale).toBe(true);
    expect(staleSnapshot.warning).toContain("OpenRouter ist vorübergehend nicht erreichbar");
  });

  it("throws 503 when upstream fails and no cached snapshot exists", async () => {
    const failingFetcher = vi.fn().mockRejectedValue(new Error("Network connection error"));
    const supabase = createMockSupabase();

    await expect(
      getOpenRouterUsageSnapshot("24h", { fetcher: failingFetcher, supabase }),
    ).rejects.toThrow(new UserVisibleError("OpenRouter ist derzeit nicht erreichbar.", 503));
  });

  it("enforces 2MB body size cap on OpenRouter responses", async () => {
    const hugePayload = "x".repeat(2 * 1024 * 1024 + 10);
    const fetcher = vi.fn().mockResolvedValue(
      new Response(hugePayload, {
        status: 200,
        headers: { "Content-Length": String(hugePayload.length) },
      }),
    );
    const supabase = createMockSupabase();

    await expect(
      getOpenRouterUsageSnapshot("24h", { fetcher, supabase }),
    ).rejects.toThrow();
  });
});
