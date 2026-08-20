import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearOmniRouteUsageCacheForTests,
  getOmniRouteUsageSnapshot,
  normalizeAnalyticsPayload,
  normalizeOmniRouteUsagePayloads,
  normalizeProviderLimitsPayload,
  OMNIROUTE_GEMINI_COMBO_NAME,
} from "./omniroute-usage";

function providerLimitsPayload() {
  return {
    caches: {
      "secret-cache-connection": {
        quotas: {
          "gemini-3.6-flash-high": {
            used: 1,
            total: 2,
            resetAt: "2026-08-19T00:00:00.000Z",
            remainingPercentage: 50,
            unlimited: false,
            fractionReported: 1,
            quotaSource: "legacy-secret",
          },
        },
        plan: "Legacy Plan",
        message: "secret cache message",
        fetchedAt: "2026-08-18T08:00:00.000Z",
        source: "legacy",
      },
      antigravity: {
        quotas: {
          "gemini-3.7-flash-high": {
            used: 25,
            total: 100,
            resetAt: "2026-08-21T00:00:00.000Z",
            remainingPercentage: 75,
            unlimited: false,
            fractionReported: 0.99,
            quotaSource: "normalized-pool",
          },
          "gemini-3.7-pro": { used: 5, total: 10 },
        },
        plan: "Gemini Plan",
        fetchedAt: "2026-08-20T08:00:00.000Z",
        source: "antigravity",
      },
    },
    intervalMinutes: 15,
    lastAutoSyncAt: "2026-08-20T08:00:00.000Z",
  };
}

function analyticsPayload() {
  return {
    summary: {
      totalRequests: 100,
      promptTokens: 1_000,
      completionTokens: 2_000,
      totalTokens: 3_000,
      successfulRequests: 98,
      successRatePct: 98,
      avgLatencyMs: 812.5,
      totalCost: 1.25,
      fallbackCount: 2,
      lastRequest: "2026-08-20T09:00:00.000Z",
    },
    byModel: [
      {
        model: "gemini-3.7-flash-high",
        provider: "antigravity",
        rawModel: "secret-raw-model",
        requests: 90,
        promptTokens: 900,
        completionTokens: 1_800,
        totalTokens: 2_700,
        avgLatencyMs: 800,
        successRatePct: 99,
        lastUsed: "2026-08-20T09:00:00.000Z",
        cost: 1,
      },
      {
        model: "luna-pro",
        provider: "openrouter",
        rawModel: "secret-luna",
        requests: 10,
        promptTokens: 100,
        completionTokens: 200,
        totalTokens: 300,
        avgLatencyMs: 900,
        successRatePct: 90,
        lastUsed: "2026-08-20T08:00:00.000Z",
        cost: 0.25,
      },
      { model: "secret-model", provider: "secret-provider", requests: 99 },
    ],
    byProvider: [
      {
        provider: "antigravity",
        requests: 90,
        promptTokens: 900,
        completionTokens: 1_800,
        totalTokens: 2_700,
        avgLatencyMs: 800,
        successRatePct: 99,
        lastUsed: "2026-08-20T09:00:00.000Z",
        cost: 1,
      },
      { provider: "secret-provider", requests: 99 },
    ],
    dailyTrend: [
      { date: "2026-08-19", requests: 40, tokens: 1_000, cost: 0.4, latency: 800 },
      { date: "2026-08-20", requests: 60, tokens: 2_000, cost: 0.85, latency: 820 },
    ],
    byAccount: [{ email: "secret@example.at", requests: 100 }],
    byApiKey: [{ key: "secret-api-key", requests: 100 }],
  };
}

function combosPayload() {
  return {
    combos: [
      { name: "other-combo", strategy: "priority", models: [], version: 1, updatedAt: "2026-08-01T00:00:00.000Z" },
      {
        name: OMNIROUTE_GEMINI_COMBO_NAME,
        strategy: "priority",
        models: [
          { model: "gemini-3.7-flash-high", providerId: "secret-gemini-execution" },
          { model: "openrouter/luna-pro", providerId: "secret-openrouter-execution" },
        ],
        version: 7,
        updatedAt: "2026-08-18T10:00:00.000Z",
      },
    ],
  };
}

function providerStatsPayload() {
  return {
    comboMetrics: {
      [OMNIROUTE_GEMINI_COMBO_NAME]: {
        totalRequests: 200,
        totalSuccesses: 190,
        totalFailures: 5,
        totalFallbacks: 5,
        totalLatencyMs: 200_000,
        strategy: "priority",
        lastUsedAt: "2026-08-20T09:30:00.000Z",
        byModel: {
          "gemini-3.7-flash-high": {
            requests: 180,
            successes: 176,
            failures: 4,
            avgLatencyMs: 900,
            lastStatus: "ok",
            lastUsedAt: "2026-08-20T09:30:00.000Z",
            execution: "secret-execution",
            targetId: "secret-target",
          },
          "openrouter/luna-pro": {
            requests: 20,
            successes: 14,
            failures: 1,
            avgLatencyMs: 1_100,
            lastStatus: "fallback",
            lastUsedAt: "2026-08-20T09:00:00.000Z",
          },
        },
        productionTraffic: true,
        avgLatencyMs: 1_000,
        successRate: 95,
        fallbackRate: 2.5,
        byTarget: [{ targetId: "secret-target", label: "secret-label" }],
      },
    },
  };
}

function healthMatrixPayload() {
  return {
    checkedAt: "2026-08-20T10:00:00.000Z",
    range: "24h",
    summary: { secret: "secret" },
    providers: [
      {
        provider: "antigravity",
        state: "healthy",
        connections: { total: 2, active: 2, cooldown: 0 },
        modelLockoutCount: 1,
        requests: 100,
        successRate: 98,
        avgLatencyMs: 800,
        lastRequestAt: "2026-08-20T09:00:00.000Z",
        lastErrorAt: "2026-08-19T09:00:00.000Z",
        accounts: [
          {
            id: "secret-account-id",
            label: "secret-account-label",
            state: "healthy",
            rateLimitedUntil: "2026-08-20T11:00:00.000Z",
            cooldownRemainingMs: 3_600_000,
            lastErrorType: "RATE_LIMIT",
            errorCode: "429",
            lastErrorAt: "2026-08-20T10:00:00.000Z",
            models: [
              {
                model: "gemini-3.7-flash-high",
                status: "rate_limited",
                isLockedOut: true,
                lockoutReason: "secret reason",
                lockoutRemainingMs: 3_600_000,
                requests: 90,
                successes: 88,
                successRate: 97.8,
                avgLatencyMs: 800,
                lastStatus: "ok",
                lastErrorStatus: "429",
                lastRequestAt: "2026-08-20T09:00:00.000Z",
                lastErrorAt: "2026-08-20T10:00:00.000Z",
              },
              { model: "gemini-secret-other", status: "healthy" },
            ],
          },
        ],
      },
      {
        provider: "openrouter",
        state: "healthy",
        connections: { total: 1, active: 1, cooldown: 0 },
        modelLockoutCount: 0,
        requests: 10,
        successRate: 100,
        avgLatencyMs: 900,
        accounts: [{
          id: "secret-openrouter-id",
          label: "secret-label",
          models: [{
            model: "openrouter/luna-pro",
            status: "healthy",
            requests: 10,
            successes: 10,
            avgLatencyMs: 900,
            lastStatus: "ok",
            lastRequestAt: "2026-08-20T08:00:00.000Z",
          }],
        }],
      },
      {
        provider: "agy",
        state: "healthy",
        connections: { total: 1, active: 1, cooldown: 0 },
        accounts: [{ models: [{ model: "gemini-3.7-flash-high", status: "idle" }] }],
      },
      { provider: "secret-provider", state: "unknown", accounts: [] },
    ],
  };
}

describe("OmniRoute usage normalization", () => {
  it("selects the preferred antigravity cache and Gemini Flash quota", () => {
    expect(normalizeProviderLimitsPayload(providerLimitsPayload())).toEqual({
      used: 25,
      total: 100,
      remainingPercent: 75,
      resetAt: "2026-08-21T00:00:00.000Z",
      plan: "Gemini Plan",
      source: "normalized-pool",
      quotaFetchedAt: "2026-08-20T08:00:00.000Z",
      quotaSyncIntervalMinutes: 15,
    });
  });

  it("prefers the representative quota version before choosing an equivalent cache", () => {
    const quota = normalizeProviderLimitsPayload({
      intervalMinutes: 10,
      caches: {
        agy: {
          fetchedAt: "2026-08-20T07:00:00.000Z",
          quotas: { "gemini-3.6-flash-high": { used: 1, total: 4, remainingPercentage: 75 } },
        },
        "opaque-connection": {
          fetchedAt: "2026-08-20T08:00:00.000Z",
          quotas: { "gemini-3.7-flash-high": { used: 2, total: 4, remainingPercentage: 50 } },
        },
      },
    });
    expect(quota).toMatchObject({ used: 2, total: 4, remainingPercent: 50 });
  });

  it("returns null for missing quota data", () => {
    expect(normalizeProviderLimitsPayload({ caches: {} })).toBeNull();
    expect(normalizeProviderLimitsPayload(null)).toBeNull();
  });

  it("normalizes analytics strictly and strips unsupported provider data", () => {
    const usage = normalizeAnalyticsPayload(analyticsPayload());
    expect(usage.summary).toEqual(analyticsPayload().summary);
    expect(usage.models).toHaveLength(2);
    expect(usage.providers).toHaveLength(1);
    expect(usage.dailyTrend).toEqual([
      { date: "2026-08-19", requests: 40, tokens: 1_000, cost: 0.4 },
      { date: "2026-08-20", requests: 60, tokens: 2_000, cost: 0.85 },
    ]);
    expect(JSON.stringify(usage)).not.toContain("byAccount");
    expect(JSON.stringify(usage)).not.toContain("secret");
  });

  it("normalizes only the configured combo and target health", () => {
    const snapshot = normalizeOmniRouteUsagePayloads({
      providerLimits: providerLimitsPayload(),
      analytics: analyticsPayload(),
      providerStats: providerStatsPayload(),
      healthMatrix: healthMatrixPayload(),
      combos: combosPayload(),
      range: "7d",
      generatedAt: "2026-08-20T12:00:00.000Z",
    });

    expect(Object.keys(snapshot).sort()).toEqual([
      "combo", "generatedAt", "providerHealth", "quota", "range", "usage",
    ]);
    expect(snapshot.combo).toMatchObject({
      name: OMNIROUTE_GEMINI_COMBO_NAME,
      strategy: "priority",
      targets: ["gemini-3.7-flash-high", "openrouter/luna-pro"],
      version: 7,
      productionTraffic: true,
      requests: 200,
      successes: 190,
      failures: 5,
      fallbacks: 5,
      models: [
        expect.objectContaining({ model: "gemini-3.7-flash-high", requests: 180 }),
        expect.objectContaining({ model: "openrouter/luna-pro", requests: 20 }),
      ],
    });
    expect(snapshot.providerHealth).toHaveLength(2);
    expect(snapshot.providerHealth[0]).toMatchObject({
      provider: "gemini",
      state: "healthy",
      connections: 2,
      cooldownRemainingMs: 3_600_000,
      lastErrorType: "RATE_LIMIT",
      lastErrorCode: "429",
      models: [expect.objectContaining({
        model: "gemini-3.7-flash-high",
        isLockedOut: true,
        requests: 90,
      })],
    });
    expect(snapshot.providerHealth[1]?.models[0]?.model).toBe("openrouter/luna-pro");
    expect(snapshot.usage.models.map((model) => model.model)).toEqual([
      "gemini-3.7-flash-high",
      "luna-pro",
    ]);

    const serializedSnapshot = JSON.stringify(snapshot);
    for (const forbidden of [
      "secret",
      "connectionId",
      "providerId",
      "byAccount",
      "byApiKey",
      "rawModel",
      "byTarget",
      "lockoutReason",
      "apiKey",
    ]) {
      expect(serializedSnapshot).not.toContain(forbidden);
    }
  });

  it("handles missing sections without spreading upstream objects and rejects malformed containers", () => {
    const snapshot = normalizeOmniRouteUsagePayloads({
      providerLimits: {},
      analytics: {},
      providerStats: {},
      healthMatrix: {},
      combos: { combos: [] },
      range: "30d",
      generatedAt: "2026-08-20T12:00:00.000Z",
    });
    expect(snapshot.quota).toBeNull();
    expect(snapshot.usage).toEqual({ summary: null, models: [], providers: [], dailyTrend: [] });
    expect(snapshot.combo).toBeNull();
    expect(snapshot.providerHealth).toEqual([]);

    expect(() => normalizeProviderLimitsPayload("invalid")).toThrow();
    expect(() => normalizeAnalyticsPayload({ byModel: "invalid" })).toThrow();
    expect(() => normalizeOmniRouteUsagePayloads({
      providerLimits: {},
      analytics: {},
      providerStats: {},
      healthMatrix: {},
      combos: { combos: "invalid" },
      range: "24h",
    })).toThrow();
  });
});

describe("OmniRoute usage cache", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    clearOmniRouteUsageCacheForTests();
    process.env.OMNIROUTE_ADMIN_BASE_URL = "https://omniroute.example/sub/";
    process.env.OMNIROUTE_ADMIN_API_KEY = "secret-management-key";
  });

  afterEach(() => {
    for (const key of ["OMNIROUTE_ADMIN_BASE_URL", "OMNIROUTE_ADMIN_API_KEY"] as const) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    vi.restoreAllMocks();
  });

  function successfulFetcher() {
    return vi.fn(async (input: URL | Request | string, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url.endsWith("/api/usage/provider-limits")) return Response.json(providerLimitsPayload());
      if (url.includes("/api/usage/analytics?range=")) return Response.json(analyticsPayload());
      if (url.endsWith("/api/provider-stats")) return Response.json(providerStatsPayload());
      if (url.endsWith("/api/providers/health-matrix")) return Response.json(healthMatrixPayload());
      if (url.endsWith("/api/combos")) return Response.json(combosPayload());
      throw new Error(`Unexpected URL: ${url}`);
    });
  }

  it("uses a normalized base URL, bearer authentication and bounded abort signals", async () => {
    const fetcher = successfulFetcher();
    const snapshot = await getOmniRouteUsageSnapshot("24h", { fetcher: fetcher as unknown as typeof fetch });

    expect(fetcher).toHaveBeenCalledTimes(5);
    for (const call of fetcher.mock.calls) {
      const url = String(call[0]);
      expect(url.startsWith("https://omniroute.example/sub/api/")).toBe(true);
      expect(url.endsWith("/")).toBe(false);
      expect(call[1]?.headers).toMatchObject({
        Accept: "application/json",
        Authorization: "Bearer secret-management-key",
      });
      expect(call[1]?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(snapshot.stale).toBe(false);
    expect(snapshot.range).toBe("24h");
  });

  it("serves a fresh snapshot without another upstream call", async () => {
    const fetcher = successfulFetcher();
    await getOmniRouteUsageSnapshot("7d", { fetcher: fetcher as unknown as typeof fetch });
    const cached = await getOmniRouteUsageSnapshot("7d", { fetcher: fetcher as unknown as typeof fetch });

    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(cached.stale).toBe(false);
  });

  it("bypasses fresh cache for refresh and safely falls back to the last snapshot", async () => {
    const fetcher = successfulFetcher();
    const first = await getOmniRouteUsageSnapshot("30d", { fetcher: fetcher as unknown as typeof fetch });
    const failingFetcher = vi.fn(async () => new Response("secret upstream failure", { status: 503 }));
    const refreshed = await getOmniRouteUsageSnapshot("30d", {
      refresh: true,
      fetcher: failingFetcher as unknown as typeof fetch,
    });

    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(failingFetcher).toHaveBeenCalledTimes(5);
    expect(first.stale).toBe(false);
    expect(refreshed.stale).toBe(true);
    expect(refreshed.generatedAt).toBe(first.generatedAt);
    expect(refreshed.warning).toContain("vorübergehend");
    expect(refreshed.warning).not.toContain("secret");
  });

  it("returns a sanitized 503 when no cached snapshot exists", async () => {
    const failingFetcher = vi.fn(async () => new Response("secret upstream failure", { status: 500 }));
    await expect(getOmniRouteUsageSnapshot("24h", {
      fetcher: failingFetcher as unknown as typeof fetch,
    })).rejects.toMatchObject({
      message: "OmniRoute ist derzeit nicht erreichbar.",
      status: 503,
    });
  });

  it("falls back to a stale snapshot after the five-minute TTL", async () => {
    const fetcher = successfulFetcher();
    const first = await getOmniRouteUsageSnapshot("24h", { fetcher: fetcher as unknown as typeof fetch });
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 5 * 60 * 1_000);
    const failingFetcher = vi.fn(async () => { throw new Error("temporary upstream failure"); });
    const stale = await getOmniRouteUsageSnapshot("24h", {
      fetcher: failingFetcher as unknown as typeof fetch,
    });

    expect(nowSpy).toHaveBeenCalled();
    expect(stale.generatedAt).toBe(first.generatedAt);
    expect(stale.stale).toBe(true);
  });
});
