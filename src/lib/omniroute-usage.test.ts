import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearOmniRouteUsageCacheForTests,
  getOmniRouteUsageSnapshot,
  normalizeAnalyticsPayload,
  normalizeCombosConfiguration,
  normalizeOmniRouteUsagePayloads,
  normalizeProviderConnectionsPayload,
  normalizeProviderLimitsPayload,
  normalizeProviderQuotasPayload,
  normalizeRoutesPayload,
} from "./omniroute-usage";

function providerLimitsPayload() {
  return {
    caches: {
      "opaque-cache-codex": {
        quotas: {
          session: {
            used: 20,
            total: 100,
            remaining: 80,
            remainingPercentage: 80,
            resetAt: "2026-08-24T00:00:00.000Z",
            unlimited: false,
            displayName: "Weekly",
          },
        },
        plan: "Codex Pro",
        fetchedAt: "2026-08-20T09:00:00.000Z",
        source: "codex-oauth",
        account: "secret-codex-account@example.at",
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
        apiKey: "secret-gemini-key",
      },
      "unmapped-gemini": {
        quotas: { "gemini-3.7-flash-high": { used: 1, total: 2 } },
      },
    },
    intervalMinutes: 15,
    lastAutoSyncAt: "2026-08-20T09:00:00.000Z",
  };
}

function providersPayload() {
  return {
    connections: [
      {
        id: "opaque-cache-codex",
        provider: "codex",
        email: "secret-codex-account@example.at",
        accessToken: "secret-access-token",
      },
      { id: "antigravity", provider: "agy", label: "secret-account-label", apiKey: "secret-key" },
      { id: "another-gemini", provider: "gemini" },
      { id: "conn-deepseek-1", provider: "deepseek", apiKey: "secret-deepseek-key" },
      { id: "conn-openrouter-1", provider: "openrouter", apiKey: "secret-or-key" },
      { id: "conn-codex-1", provider: "codex", accessToken: "secret-codex-token" },
    ],
    byAccount: [{ email: "secret-account@example.at" }],
    byApiKey: [{ key: "secret-api-key" }],
  };
}

function analyticsPayload() {
  return {
    summary: {
      totalRequests: 130,
      promptTokens: 1_300,
      completionTokens: 2_600,
      totalTokens: 3_900,
      successfulRequests: 128,
      successRatePct: "98.46",
      avgLatencyMs: 812.5,
      totalCost: 1.5,
      fallbackCount: 12,
      lastRequest: "2026-08-20T10:00:00.000Z",
    },
    byModel: [
      {
        model: "gpt-5.6-luna",
        provider: "codex",
        rawModel: "secret-codex-raw-model",
        requests: 100,
        promptTokens: 1_000,
        completionTokens: 2_000,
        totalTokens: 3_000,
        avgLatencyMs: 750,
        successRatePct: "100.00",
        lastUsed: "2026-08-20T10:00:00.000Z",
        cost: 1,
      },
      {
        model: "gemini-3.7-flash-high",
        provider: "antigravity",
        requests: 20,
        promptTokens: 200,
        completionTokens: 400,
        totalTokens: 600,
        avgLatencyMs: 850,
        successRatePct: 95,
        lastUsed: "2026-08-20T09:00:00.000Z",
        cost: 0.25,
      },
      {
        model: "openrouter/luna-pro",
        provider: "openrouter",
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
        provider: "codex",
        requests: 100,
        promptTokens: 1_000,
        completionTokens: 2_000,
        totalTokens: 3_000,
        avgLatencyMs: 750,
        successRatePct: "100.00",
        lastUsed: "2026-08-20T10:00:00.000Z",
        cost: 1,
      },
      {
        provider: "antigravity",
        requests: 20,
        promptTokens: 200,
        completionTokens: 400,
        totalTokens: 600,
        avgLatencyMs: 850,
        successRatePct: 95,
        lastUsed: "2026-08-20T09:00:00.000Z",
        cost: 0.25,
      },
      { provider: "openrouter", requests: 10, totalTokens: 300, successRatePct: "90.00", avgLatencyMs: 900 },
      { provider: "secret-provider", requests: 99 },
    ],
    dailyTrend: [
      { date: "2026-08-19", requests: 40, tokens: 1_000, cost: 0.4, latency: 800 },
      { date: "2026-08-20", requests: 90, tokens: 2_900, cost: 1.1, latency: 820 },
    ],
    byAccount: [{ email: "secret@example.at", requests: 130 }],
    byApiKey: [{ key: "secret-api-key", requests: 130 }],
  };
}

function combosPayload() {
  return {
    combos: [
      {
        name: "omniroute-gpt-5.6-luna",
        strategy: "priority",
        models: [
          { model: "codex/gpt-5.6-luna", providerId: "opaque-cache-codex", execution: "secret-execution" },
          { model: "gemini-3.7-flash-high", providerId: "antigravity", execution: "secret-gemini-execution" },
        ],
        version: 8,
        updatedAt: "2026-08-19T10:00:00.000Z",
      },
      {
        name: "omniroute-gpt-5.6-luna-medium",
        strategy: "priority",
        models: [
          { model: "codex/gpt-5.6-luna", providerId: "conn-codex-1" },
          { model: "gemini-3.7-flash-high", providerId: "antigravity" },
        ],
        version: 3,
        updatedAt: "2026-08-20T00:00:00.000Z",
      },
      {
        name: "omniroute-gpt-5.6-luna-high",
        strategy: "priority",
        models: [
          { model: "codex/gpt-5.6-luna", providerId: "conn-codex-1" },
          { model: "gemini-3.7-flash-high", providerId: "antigravity" },
        ],
        version: 2,
        updatedAt: "2026-08-20T00:00:00.000Z",
      },
      {
        name: "omniroute-gpt-5.6-luna-xhigh",
        strategy: "fallback",
        models: [
          { model: "codex/gpt-5.6-luna", providerId: "conn-codex-1" },
          { model: "gemini-3.7-flash-high", providerId: "antigravity" },
        ],
        version: 1,
        updatedAt: "2026-08-21T00:00:00.000Z",
      },
    ],
  };
}

function providerStatsPayload() {
  return {
    comboMetrics: {
      "omniroute-gpt-5.6-luna": {
        totalRequests: 240,
        totalSuccesses: 230,
        totalFailures: 7,
        totalFallbacks: 10,
        strategy: "priority",
        lastUsedAt: "2026-08-20T10:30:00.000Z",
        byModel: {
          "codex/gpt-5.6-luna": {
            requests: 200,
            successes: 196,
            failures: 4,
            avgLatencyMs: 800,
            lastStatus: "ok",
            lastUsedAt: "2026-08-20T10:30:00.000Z",
            execution: "secret-execution",
            targetId: "secret-target",
          },
          "gemini-3.7-flash-high": {
            requests: 40,
            successes: 34,
            failures: 3,
            avgLatencyMs: 1_100,
            lastStatus: "fallback",
            lastUsedAt: "2026-08-20T10:00:00.000Z",
          },
          "openrouter/luna-pro": { requests: 999 },
        },
        productionTraffic: true,
        avgLatencyMs: 850,
        successRate: "95.83",
        fallbackRate: 2.5,
        byTarget: [{ targetId: "secret-target", label: "secret-label" }],
      },
      "omniroute-gpt-5.6-luna-medium": {
        totalRequests: 50,
        totalSuccesses: 49,
        totalFailures: 1,
        totalFallbacks: 2,
        strategy: "priority",
        lastUsedAt: "2026-08-20T09:00:00.000Z",
        productionTraffic: false,
        avgLatencyMs: 700,
        successRate: 98,
        fallbackRate: 4,
        byModel: [
          {
            model: "codex/gpt-5.6-luna",
            requests: 45,
            successes: 45,
            failures: 0,
            avgLatencyMs: 650,
            lastStatus: "ok",
            lastUsedAt: "2026-08-20T09:00:00.000Z",
          },
          {
            model: "gemini-3.7-flash-high",
            requests: 5,
            successes: 4,
            failures: 1,
            avgLatencyMs: 900,
            lastStatus: "ok",
            lastUsedAt: "2026-08-20T08:00:00.000Z",
          },
        ],
      },
    },
  };
}

function healthMatrixPayload() {
  return {
    checkedAt: "2026-08-20T11:00:00.000Z",
    range: "24h",
    summary: { secret: "secret" },
    providers: [
      {
        provider: "codex",
        state: "healthy",
        connections: { total: 1, active: 1, cooldown: 0 },
        modelLockoutCount: 1,
        requests: 200,
        successRate: "98.00",
        avgLatencyMs: 750,
        lastRequestAt: "2026-08-20T10:30:00.000Z",
        lastErrorAt: "2026-08-19T10:00:00.000Z",
        accounts: [
          {
            id: "secret-codex-account-id",
            email: "secret-codex-account@example.at",
            label: "secret-account-label",
            state: "healthy",
            rateLimitedUntil: "2026-08-20T12:00:00.000Z",
            cooldownRemainingMs: 1_800_000,
            lastErrorType: "RATE_LIMIT",
            errorCode: "429",
            lastErrorAt: "2026-08-20T11:00:00.000Z",
            models: [
              {
                model: "gpt-5.6-luna",
                status: "rate_limited",
                isLockedOut: true,
                lockoutReason: "secret reason",
                lockoutRemainingMs: 1_800_000,
                requests: 100,
                successes: 98,
                successRate: "98.00",
                avgLatencyMs: 750,
                lastStatus: "ok",
                lastErrorStatus: "429",
                lastRequestAt: "2026-08-20T10:30:00.000Z",
                lastErrorAt: "2026-08-20T11:00:00.000Z",
              },
              { model: "codex-secret-other", status: "healthy" },
            ],
          },
        ],
      },
      {
        provider: "openrouter",
        state: "healthy",
        connections: 1,
        accounts: [{ models: [{ model: "openrouter/luna-pro", status: "healthy" }] }],
      },
      {
        provider: "antigravity",
        state: "healthy",
        connections: { total: 2, active: 2, cooldown: 0 },
        modelLockoutCount: 1,
        requests: 100,
        successRate: 98,
        avgLatencyMs: 800,
        lastRequestAt: "2026-08-20T09:00:00.000Z",
        accounts: [
          {
            id: "secret-gemini-account-id",
            label: "secret-account-label",
            state: "healthy",
            rateLimitedUntil: "2026-08-20T13:00:00.000Z",
            cooldownRemainingMs: 3_600_000,
            lastErrorType: "RATE_LIMIT",
            errorCode: "429",
            lastErrorAt: "2026-08-20T10:00:00.000Z",
            models: [
              {
                model: "gemini-3.7-flash-high",
                status: "rate_limited",
                isLockedOut: true,
                lockoutRemainingMs: 3_600_000,
                requests: 20,
                successes: 19,
                successRate: 95,
                avgLatencyMs: 850,
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
        provider: "agy",
        state: "idle",
        connections: 1,
        accounts: [{ models: [{ model: "gemini-3.7-flash-high", status: "idle" }] }],
      },
      { provider: "secret-provider", state: "unknown", accounts: [] },
    ],
  };
}

describe("OmniRoute usage normalization", () => {
  it("maps caches only through sanitized provider relationships", () => {
    const quotas = normalizeProviderQuotasPayload(providerLimitsPayload(), providersPayload());

    expect(quotas.codexQuota).toEqual({
      used: 20,
      total: 100,
      remaining: 80,
      remainingPercent: 80,
      unlimited: false,
      resetAt: "2026-08-24T00:00:00.000Z",
      plan: "Codex Pro",
      source: "codex-oauth",
      quotaLabel: "Weekly",
      quotaFetchedAt: "2026-08-20T09:00:00.000Z",
      quotaSyncIntervalMinutes: 15,
    });
    expect(quotas.quota).toMatchObject({
      used: 25,
      total: 100,
      remainingPercent: 75,
      plan: "Gemini Plan",
      source: "normalized-pool",
    });
    expect(normalizeProviderLimitsPayload(providerLimitsPayload(), providersPayload())).toMatchObject({
      remainingPercent: 75,
    });
    expect(normalizeProviderQuotasPayload(providerLimitsPayload(), { connections: [] })).toEqual({
      quota: null,
      codexQuota: null,
    });
    expect(JSON.stringify(quotas)).not.toContain("opaque-cache");
    expect(JSON.stringify(quotas)).not.toContain("secret");
  });

  it("does not infer a Codex quota from a plan name or opaque cache ID", () => {
    const quotas = normalizeProviderQuotasPayload({
      intervalMinutes: 5,
      caches: {
        "codex-shaped-opaque-id": {
          plan: "Codex Pro",
          quotas: { session: { used: 1, total: 2 } },
        },
      },
    }, {
      connections: [{ id: "codex-shaped-opaque-id", provider: "gemini", apiKey: "secret" }],
    });
    expect(quotas.codexQuota).toBeNull();
  });

  it("normalizes bounded percentage strings and supported historical analytics", () => {
    const usage = normalizeAnalyticsPayload(analyticsPayload());

    expect(usage.summary?.successRatePct).toBe(98.46);
    expect(usage.models.map((model) => [model.provider, model.model, model.successRatePct])).toEqual([
      ["OpenAI Codex", "gpt-5.6-luna", 100],
      ["Gemini / Antigravity", "gemini-3.7-flash-high", 95],
      ["OpenRouter", "openrouter/luna-pro", 90],
    ]);
    expect(usage.providers.map((provider) => provider.provider)).toEqual([
      "OpenAI Codex",
      "Gemini / Antigravity",
      "OpenRouter",
    ]);
    expect(normalizeAnalyticsPayload({ summary: { successRatePct: "100.00" } })?.summary).toBeDefined();
    expect(normalizeAnalyticsPayload({ summary: { successRatePct: "100,00" } }).summary?.successRatePct).toBeNull();
    expect(JSON.stringify(usage)).not.toContain("byAccount");
    expect(JSON.stringify(usage)).not.toContain("secret");
  });

  it("normalizes dynamic configured routes from /api/combos and matching comboMetrics", () => {
    const snapshot = normalizeOmniRouteUsagePayloads({
      providerLimits: providerLimitsPayload(),
      providerConnections: providersPayload(),
      analytics: analyticsPayload(),
      providerStats: providerStatsPayload(),
      healthMatrix: healthMatrixPayload(),
      combos: combosPayload(),
      range: "7d",
      generatedAt: "2026-08-20T12:00:00.000Z",
    });

    expect(Object.keys(snapshot).sort()).toEqual([
      "codexQuota", "generatedAt", "providerHealth", "quota", "range", "routes", "usage", "userQuestions", "userUsage",
    ]);
    expect(snapshot.routes).toHaveLength(4);
    expect(snapshot.routes[0]).toMatchObject({
      name: "omniroute-gpt-5.6-luna",
      strategy: "priority",
      targets: ["codex/gpt-5.6-luna", "gemini-3.7-flash-high"],
      version: 8,
      productionTraffic: true,
      requests: 240,
      successes: 230,
      failures: 7,
      fallbacks: 10,
      successRatePct: 95.83,
      fallbackRatePct: 2.5,
      avgLatencyMs: 850,
      lastUsedAt: "2026-08-20T10:30:00.000Z",
      models: [
        expect.objectContaining({ model: "codex/gpt-5.6-luna", requests: 200 }),
        expect.objectContaining({ model: "gemini-3.7-flash-high", requests: 40 }),
      ],
    });
    expect(snapshot.routes[1]).toMatchObject({
      name: "omniroute-gpt-5.6-luna-medium",
      strategy: "priority",
      targets: ["codex/gpt-5.6-luna", "gemini-3.7-flash-high"],
      version: 3,
      productionTraffic: false,
      requests: 50,
      successes: 49,
      failures: 1,
      fallbacks: 2,
      successRatePct: 98,
      fallbackRatePct: 4,
      avgLatencyMs: 700,
      lastUsedAt: "2026-08-20T09:00:00.000Z",
      models: [
        expect.objectContaining({ model: "codex/gpt-5.6-luna", requests: 45 }),
        expect.objectContaining({ model: "gemini-3.7-flash-high", requests: 5 }),
      ],
    });
    expect(snapshot.routes[2]).toMatchObject({
      name: "omniroute-gpt-5.6-luna-high",
      strategy: "priority",
      targets: ["codex/gpt-5.6-luna", "gemini-3.7-flash-high"],
      version: 2,
      productionTraffic: false,
      requests: null,
      successes: null,
      failures: null,
      fallbacks: null,
      models: [],
    });
    expect(snapshot.routes[3]).toMatchObject({
      name: "omniroute-gpt-5.6-luna-xhigh",
      strategy: "fallback",
      targets: ["codex/gpt-5.6-luna", "gemini-3.7-flash-high"],
      version: 1,
      productionTraffic: false,
      requests: null,
      models: [],
    });

    expect(snapshot.providerHealth.map((provider) => provider.provider)).toEqual(["codex", "gemini"]);
    expect(snapshot.providerHealth[0]).toMatchObject({
      provider: "codex",
      state: "healthy",
      connections: 1,
      cooldownRemainingMs: 1_800_000,
      lastErrorType: "RATE_LIMIT",
      lastErrorCode: "429",
      successRatePct: 98,
      models: [expect.objectContaining({
        model: "codex/gpt-5.6-luna",
        isLockedOut: true,
        requests: 100,
      })],
    });
    expect(snapshot.providerHealth[1]?.models[0]?.model).toBe("gemini-3.7-flash-high");
    expect(snapshot.usage.models.map((model) => model.model)).toEqual([
      "codex/gpt-5.6-luna",
      "gemini-3.7-flash-high",
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
      "accessToken",
      "email",
      "correlationId",
      "comboExecutionKey",
      "comboStepId",
      "requestSummary",
      "Fred V4",
      "fred-v4-stack",
      "call-logs",
    ]) {
      expect(serializedSnapshot).not.toContain(forbidden);
    }
  });

  it("handles missing sections and rejects malformed containers", () => {
    const snapshot = normalizeOmniRouteUsagePayloads({
      providerLimits: {},
      providerConnections: {},
      analytics: {},
      providerStats: {},
      healthMatrix: {},
      combos: { combos: [] },
      range: "30d",
      generatedAt: "2026-08-20T12:00:00.000Z",
    });
    expect(snapshot.quota).toBeNull();
    expect(snapshot.codexQuota).toBeNull();
    expect(snapshot.usage).toEqual({ summary: null, models: [], providers: [], dailyTrend: [] });
    expect(snapshot.routes).toEqual([]);
    expect(snapshot.providerHealth).toEqual([]);

    expect(() => normalizeProviderLimitsPayload("invalid")).toThrow();
    expect(() => normalizeAnalyticsPayload({ byModel: "invalid" })).toThrow();
    expect(() => normalizeProviderConnectionsPayload({ connections: "invalid" })).toThrow();
    expect(() => normalizeProviderConnectionsPayload({ connections: [null, "invalid"] })).toThrow();
    expect(() => normalizeOmniRouteUsagePayloads({
      providerLimits: {},
      providerConnections: {},
      analytics: {},
      providerStats: {},
      healthMatrix: {},
      combos: { combos: "invalid" },
      range: "24h",
    })).toThrow();
  });

  it("normalizes combo configuration and routes payload correctly across diverse input shapes", () => {
    const configs = normalizeCombosConfiguration([
      { name: "custom-route-1", strategy: "priority", models: [{ model: "m1", providerId: "p1" }] },
      { name: "custom-route-2" },
    ]);
    expect(configs).toHaveLength(2);
    expect(configs[0]).toMatchObject({ name: "custom-route-1", targets: ["m1"] });
    expect(configs[1]).toMatchObject({ name: "custom-route-2", targets: [] });

    const routes = normalizeRoutesPayload({
      comboMetrics: {
        "custom-route-1": { totalRequests: 10, totalSuccesses: 10, avgLatencyMs: 100 },
      },
    }, configs);
    expect(routes).toHaveLength(2);
    expect(routes[0]?.requests).toBe(10);
    expect(routes[1]?.requests).toBeNull();
  });
});

  it("excludes historical Gemini analytics, quota, and health when only Codex targets are configured", () => {
    const combos = combosPayload();
    for (const combo of combos.combos) {
      combo.models = combo.models.filter((target) => target.model === "codex/gpt-5.6-luna");
    }
    const snapshot = normalizeOmniRouteUsagePayloads({
      providerLimits: providerLimitsPayload(),
      providerConnections: providersPayload(),
      analytics: analyticsPayload(),
      providerStats: providerStatsPayload(),
      healthMatrix: healthMatrixPayload(),
      combos,
      range: "24h",
    });

    expect(snapshot.usage.models.map((model) => model.model)).toEqual(["codex/gpt-5.6-luna"]);
    expect(snapshot.usage.providers.map((provider) => provider.provider)).toEqual(["OpenAI Codex"]);
    expect(snapshot.providerHealth.map((provider) => provider.provider)).toEqual(["codex"]);
    expect(snapshot.quota).toBeNull();
    expect(snapshot.codexQuota).not.toBeNull();
    expect(JSON.stringify(snapshot)).not.toContain("gemini-3.7-flash-high");
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
      if (url.endsWith("/api/providers")) return Response.json(providersPayload());
      if (url.includes("/api/usage/analytics?range=")) return Response.json(analyticsPayload());
      if (url.endsWith("/api/provider-stats")) return Response.json(providerStatsPayload());
      if (url.endsWith("/api/providers/health-matrix")) return Response.json(healthMatrixPayload());
      if (url.endsWith("/api/combos")) return Response.json(combosPayload());
      throw new Error(`Unexpected URL: ${url}`);
    });
  }

  function createPerUserSupabase(messages: Array<{ client_id: string | null; created_at: string }>): SupabaseClient {
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
    const listUsers = vi.fn().mockImplementation(({ page = 1, perPage = 1_000 }: { page?: number; perPage?: number }) => {
      const firstPage = [
        { id: "user-1", email: "one@example.com", userMetadata: { upstreamId: "secret-upstream-id" } },
        { id: "user-2", email: "two@example.com" },
        ...Array.from({ length: 998 }, (_, index) => ({ id: `auth-user-${index}`, email: `auth-${index}@example.com` })),
      ];
      const pages = [firstPage, [{ id: "user-3", email: "three@example.com" }]];
      return Promise.resolve({ data: { users: pages[page - 1] ?? [] }, error: null, perPage });
    });
    return {
      from: vi.fn(() => query),
      auth: { admin: { listUsers } },
    } as unknown as SupabaseClient;
  }

  it("loads exact paginated Fred questions and attributes only the EUR cost estimate proportionally", async () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-08-20T12:00:00.000Z").getTime());
    const baseMessage = (clientId: string | null, minute: number) => ({
      client_id: clientId,
      created_at: `2026-08-20T11:${String(minute).padStart(2, "0")}:00.000Z`,
    });
    const messages = [
      ...Array.from({ length: 1_000 }, (_, index) => baseMessage("user-1", index % 60)),
      { client_id: "user-2", created_at: "2026-08-20T11:58:00.000Z" },
      { client_id: "user-2", created_at: "2026-08-20T11:59:00.000Z" },
      { client_id: null, created_at: "2026-08-20T11:57:00.000Z" },
      { client_id: "user-unknown", created_at: "2026-08-20T11:56:00.000Z" },
    ];
    const supabase = createPerUserSupabase(messages);
    const fetcher = successfulFetcher();
    const fxFetcher = vi.fn<typeof fetch>(async () => Response.json({
      base: "USD",
      rates: { EUR: 0.92 },
      date: "2026-08-20",
    }));

    const snapshot = await getOmniRouteUsageSnapshot("24h", {
      fetcher: fetcher as unknown as typeof fetch,
      fxFetcher: fxFetcher as unknown as typeof fetch,
      supabase,
    });

    const query = (supabase.from as ReturnType<typeof vi.fn>).mock.results[0]?.value as {
      select: ReturnType<typeof vi.fn>;
      eq: ReturnType<typeof vi.fn>;
      gte: ReturnType<typeof vi.fn>;
      lt: ReturnType<typeof vi.fn>;
      order: ReturnType<typeof vi.fn>;
      range: ReturnType<typeof vi.fn>;
    };
    expect(query.select).toHaveBeenCalledWith("client_id, created_at");
    expect(query.eq).toHaveBeenCalledWith("role", "user");
    expect(query.gte).toHaveBeenCalledWith("created_at", "2026-08-19T12:00:00.000Z");
    expect(query.lt).toHaveBeenCalledWith("created_at", "2026-08-20T12:00:00.000Z");
    expect(query.order).toHaveBeenNthCalledWith(1, "created_at", { ascending: false });
    expect(query.order).toHaveBeenNthCalledWith(2, "id", { ascending: false });
    expect(query.range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(query.range).toHaveBeenNthCalledWith(2, 1_000, 1_999);
    expect(query.range).toHaveBeenCalledTimes(2);
    const listUsers = (supabase.auth.admin as unknown as { listUsers: ReturnType<typeof vi.fn> }).listUsers;
    expect(listUsers).toHaveBeenNthCalledWith(1, { page: 1, perPage: 1_000 });
    expect(listUsers).toHaveBeenNthCalledWith(2, { page: 2, perPage: 1_000 });
    expect(listUsers).toHaveBeenCalledTimes(2);

    expect(snapshot.userQuestions).toBe(1_004);
    expect(snapshot.userUsage.map((user) => [
      user.clientId,
      user.email,
      user.questionCount,
      user.questionSharePct,
      user.lastQuestionAt,
    ])).toEqual([
      ["user-1", "one@example.com", 1_000, expect.closeTo(99.602, 3), "2026-08-20T11:59:00.000Z"],
      ["user-2", "two@example.com", 2, expect.closeTo(0.199, 3), "2026-08-20T11:59:00.000Z"],
      ["user-unknown", "Unbekannter User", 1, expect.closeTo(0.0996, 3), "2026-08-20T11:56:00.000Z"],
      [null, "System / nicht zugeordnet", 1, expect.closeTo(0.0996, 3), "2026-08-20T11:57:00.000Z"],
    ]);
    expect(snapshot.userUsage.map((user) => user.estimatedCostEur)).toEqual([
      expect.closeTo((1.38 * 1_000) / 130, 8),
      expect.closeTo((1.38 * 2) / 130, 8),
      expect.closeTo(1.38 / 130, 8),
      expect.closeTo(1.38 / 130, 8),
    ]);
    for (const user of snapshot.userUsage) {
      expect(Object.keys(user).sort()).toEqual([
        "clientId", "email", "estimatedCostEur", "lastQuestionAt", "questionCount", "questionSharePct",
      ]);
    }
    const serialized = JSON.stringify(snapshot.userUsage);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("userMetadata");
    expect(serialized).not.toContain("upstreamId");
  });

  it("makes authenticated bounded OmniRoute requests and an isolated EUR reference fetch", async () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-08-20T12:00:00.000Z").getTime());
    const fetcher = successfulFetcher();
    const fxFetcher = vi.fn<typeof fetch>(async () => Response.json({
      base: "USD",
      rates: { EUR: 0.92 },
      date: "2026-08-20",
    }));
    const snapshot = await getOmniRouteUsageSnapshot("24h", {
      fetcher: fetcher as unknown as typeof fetch,
      fxFetcher: fxFetcher as unknown as typeof fetch,
    });

    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(fxFetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://omniroute.example/sub/api/usage/provider-limits");
    expect(String(fetcher.mock.calls[1]?.[0])).toBe("https://omniroute.example/sub/api/providers");
    expect(String(fetcher.mock.calls[2]?.[0])).toContain("/api/usage/analytics?range=24h");
    expect(String(fetcher.mock.calls[3]?.[0])).toBe("https://omniroute.example/sub/api/provider-stats");
    expect(String(fetcher.mock.calls[4]?.[0])).toBe("https://omniroute.example/sub/api/providers/health-matrix");
    expect(String(fetcher.mock.calls[5]?.[0])).toBe("https://omniroute.example/sub/api/combos");
    expect(String(fxFetcher.mock.calls[0]?.[0])).toBe("https://api.frankfurter.app/latest?from=USD&to=EUR");
    expect(fxFetcher.mock.calls[0]?.[1]?.headers).toEqual({ Accept: "application/json" });
    expect(JSON.stringify(fxFetcher.mock.calls[0]?.[1]?.headers)).not.toContain("Authorization");
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
    expect(snapshot.userQuestions).toBe(0);
    expect(snapshot.exchangeRate).toMatchObject({ rate: 0.92, date: "2026-08-20", source: "Frankfurter" });
    expect(snapshot.costConversionWarning).toBeNull();
    expect(snapshot.usage.summary?.totalCostEur).toBeCloseTo(1.38);
    expect(snapshot.usage.models[0]?.costEur).toBeCloseTo(0.92);
    expect(snapshot.usage.providers[0]?.costEur).toBeCloseTo(0.92);
    expect(snapshot.usage.dailyTrend[0]?.costEur).toBeCloseTo(0.368);
    expect(snapshot.codexQuota).toMatchObject({ quotaLabel: "Weekly", remainingPercent: 80 });
    expect(snapshot.routes).toHaveLength(4);
    expect(snapshot.routes[0]?.name).toBe("omniroute-gpt-5.6-luna");
    expect(JSON.stringify(snapshot)).not.toContain("opaque-cache");
    expect(JSON.stringify(snapshot)).not.toContain("secret-access-token");
  });

  it("serves a fresh snapshot and independently cached FX rate without another upstream call", async () => {
    const fetcher = successfulFetcher();
    const fxFetcher = vi.fn<typeof fetch>(async () => Response.json({ base: "USD", rates: { EUR: 0.92 }, date: "2026-08-20" }));
    await getOmniRouteUsageSnapshot("7d", {
      fetcher: fetcher as unknown as typeof fetch,
      fxFetcher: fxFetcher as unknown as typeof fetch,
    });
    const cached = await getOmniRouteUsageSnapshot("7d", {
      fetcher: fetcher as unknown as typeof fetch,
      fxFetcher: fxFetcher as unknown as typeof fetch,
    });

    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(fxFetcher).toHaveBeenCalledTimes(1);
    expect(cached.stale).toBe(false);
  });

  it("bypasses fresh cache for refresh and safely falls back to the last snapshot", async () => {
    const fetcher = successfulFetcher();
    const fxFetcher = vi.fn<typeof fetch>(async () => Response.json({ base: "USD", rates: { EUR: 0.92 }, date: "2026-08-20" }));
    const first = await getOmniRouteUsageSnapshot("30d", {
      fetcher: fetcher as unknown as typeof fetch,
      fxFetcher: fxFetcher as unknown as typeof fetch,
    });
    const failingFetcher = vi.fn(async () => new Response("secret upstream failure", { status: 503 }));
    const refreshed = await getOmniRouteUsageSnapshot("30d", {
      refresh: true,
      fetcher: failingFetcher as unknown as typeof fetch,
      fxFetcher: fxFetcher as unknown as typeof fetch,
    });

    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(failingFetcher).toHaveBeenCalled();
    expect(first.stale).toBe(false);
    expect(refreshed.stale).toBe(true);
    expect(refreshed.generatedAt).toBe(first.generatedAt);
    expect(refreshed.warning).toContain("vorübergehend");
    expect(refreshed.warning).not.toContain("secret");
  });

  it("keeps FX failure nonfatal, suppresses all EUR costs, and warns compactly", async () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-08-20T12:00:00.000Z").getTime());
    const fetcher = successfulFetcher();
    const fxFetcher = vi.fn<typeof fetch>(async () => new Response("invalid", { status: 500 }));
    const snapshot = await getOmniRouteUsageSnapshot("24h", {
      fetcher: fetcher as unknown as typeof fetch,
      fxFetcher: fxFetcher as unknown as typeof fetch,
    });

    expect(snapshot.exchangeRate).toBeNull();
    expect(snapshot.usage.summary?.totalCostEur).toBeNull();
    expect(snapshot.usage.models.map((model) => model.costEur)).toEqual([null, null]);
    expect(snapshot.usage.providers.map((provider) => provider.costEur)).toEqual([null, null]);
    expect(snapshot.usage.dailyTrend.map((day) => day.costEur)).toEqual([null, null]);
    expect(snapshot.costConversionWarning).toContain("EUR-Kosten");
    expect(snapshot.costConversionWarning).toContain("nicht als EUR");
    expect(JSON.stringify(snapshot)).not.toContain("1.5");
    expect(JSON.stringify(snapshot)).not.toContain("USD");
  });

  it("rejects a malformed FX response without caching or failing the dashboard", async () => {
    const fetcher = successfulFetcher();
    const fxFetcher = vi.fn<typeof fetch>(async () => Response.json({ base: "EUR", rates: { EUR: 0.92 }, date: "2026-08-20" }));
    const snapshot = await getOmniRouteUsageSnapshot("24h", {
      fetcher: fetcher as unknown as typeof fetch,
      fxFetcher: fxFetcher as unknown as typeof fetch,
    });

    expect(snapshot.exchangeRate).toBeNull();
    expect(snapshot.usage.summary?.totalCostEur).toBeNull();
    const second = await getOmniRouteUsageSnapshot("24h", {
      fetcher: fetcher as unknown as typeof fetch,
      fxFetcher: fxFetcher as unknown as typeof fetch,
    });
    expect(fxFetcher).toHaveBeenCalledTimes(2);
    expect(second.exchangeRate).toBeNull();
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
