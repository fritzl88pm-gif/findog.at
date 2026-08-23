import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearOmniRouteUsageCacheForTests,
  getOmniRouteUsageSnapshot,
  normalizeAnalyticsPayload,
  normalizeOmniRouteUsagePayloads,
  normalizeProviderConnectionsPayload,
  normalizeProviderLimitsPayload,
  normalizeProviderQuotasPayload,
  OMNIROUTE_FRED_V4_STACK_COMBO_NAME,
  OMNIROUTE_LUNA_MAX_COMBO_NAME,
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
        model: "gpt-5.6-luna-max",
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
      { name: "other-combo", strategy: "priority", models: [], version: 1, updatedAt: "2026-08-01T00:00:00.000Z" },
      {
        name: OMNIROUTE_LUNA_MAX_COMBO_NAME,
        strategy: "priority",
        models: [
          { model: "codex/gpt-5.6-luna-max", providerId: "codex", execution: "secret-execution" },
          { model: "gemini-3.7-flash-high", providerId: "agy", execution: "secret-gemini-execution" },
        ],
        version: 8,
        updatedAt: "2026-08-19T10:00:00.000Z",
      },
      {
        name: OMNIROUTE_FRED_V4_STACK_COMBO_NAME,
        strategy: "priority",
        models: [
          { model: "deepseek/deepseek-v4-flash", providerId: "conn-deepseek-1" },
          { model: "openai/gpt-5.6-luna-pro", providerId: "conn-openrouter-1" },
          { model: "google/gemini-3.7-flash", providerId: "conn-openrouter-1" },
          { model: "codex/gpt-5.6-luna", providerId: "conn-codex-1" },
        ],
        version: 4,
        updatedAt: "2026-08-20T00:00:00.000Z",
      },
      { name: "omniroute-gemini-3.7-flash-high", models: [] },
    ],
  };
}

function callLogsPayload() {
  return [
    {
      timestamp: "2026-08-20T11:50:00.000Z",
      status: 200,
      model: "deepseek/deepseek-v4-flash",
      requestedModel: "deepseek/deepseek-v4-flash",
      provider: "deepseek",
      duration: 400,
      tokens: { in: 100, out: 200, cacheRead: 50, cacheWrite: 0, reasoning: 10, compressed: 0 },
      comboName: "fred-v4-stack",
      comboStepId: "model-1",
      correlationId: "secret-corr-1",
      comboExecutionKey: "secret-exec-1",
      account: "secret-acc",
      apiKeyId: "secret-key-id",
    },
    {
      timestamp: "2026-08-20T11:45:00.000Z",
      status: 500,
      model: "deepseek/deepseek-v4-flash",
      requestedModel: "deepseek/deepseek-v4-flash",
      provider: "deepseek",
      duration: 1000,
      tokens: { in: 50, out: 0 },
      comboName: "fred-v4-stack",
      comboStepId: "model-1",
      correlationId: "secret-corr-2",
      error: "secret error text",
    },
    {
      timestamp: "2026-08-20T11:45:01.000Z",
      status: 200,
      model: "openai/gpt-5.6-luna-pro",
      requestedModel: "openai/gpt-5.6-luna-pro",
      provider: "openrouter",
      duration: 600,
      tokens: { in: 50, out: 150 },
      comboName: "fred-v4-stack",
      comboStepId: "model-2",
      correlationId: "secret-corr-2",
      requestSummary: "secret summary",
    },
    {
      timestamp: "2026-08-20T11:40:00.000Z",
      status: 200,
      model: "gpt-5.6-luna-max",
      comboName: "omniroute-luna-max-gemini-3.7-flash-high",
      comboStepId: "model-1",
    },
  ];
}

function providerStatsPayload() {
  return {
    comboMetrics: {
      [OMNIROUTE_LUNA_MAX_COMBO_NAME]: {
        totalRequests: 240,
        totalSuccesses: 230,
        totalFailures: 7,
        totalFallbacks: 10,
        strategy: "priority",
        lastUsedAt: "2026-08-20T10:30:00.000Z",
        byModel: {
          "codex/gpt-5.6-luna-max": {
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
      "omniroute-gemini-3.7-flash-high": { totalRequests: 999 },
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
                model: "gpt-5.6-luna-max",
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
      ["OpenAI Codex", "gpt-5.6-luna-max", 100],
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

  it("normalizes the live combo, active health and historical usage breakdown", () => {
    const snapshot = normalizeOmniRouteUsagePayloads({
      providerLimits: providerLimitsPayload(),
      providerConnections: providersPayload(),
      analytics: analyticsPayload(),
      providerStats: providerStatsPayload(),
      healthMatrix: healthMatrixPayload(),
      combos: combosPayload(),
      callLogs: callLogsPayload(),
      range: "7d",
      generatedAt: "2026-08-20T12:00:00.000Z",
    });

    expect(Object.keys(snapshot).sort()).toEqual([
      "codexQuota", "combo", "generatedAt", "providerHealth", "quota", "range", "routeStack", "usage",
    ]);
    expect(snapshot.combo).toMatchObject({
      name: OMNIROUTE_LUNA_MAX_COMBO_NAME,
      strategy: "priority",
      targets: ["codex/gpt-5.6-luna-max", "gemini-3.7-flash-high"],
      version: 8,
      productionTraffic: true,
      requests: 240,
      successes: 230,
      failures: 7,
      fallbacks: 10,
      successRatePct: 95.83,
      models: [
        expect.objectContaining({ model: "codex/gpt-5.6-luna-max", requests: 200 }),
        expect.objectContaining({ model: "gemini-3.7-flash-high", requests: 40 }),
      ],
    });
    expect(snapshot.routeStack).toMatchObject({
      name: OMNIROUTE_FRED_V4_STACK_COMBO_NAME,
      strategy: "priority",
      modelCalls: 3,
      successes: 2,
      failures: 1,
      fallbackCalls: 1,
      promptTokens: 200,
      completionTokens: 350,
      totalTokens: 550,
      lastUsedAt: "2026-08-20T11:50:00.000Z",
      historyTruncated: false,
    });
    expect(snapshot.routeStack?.targets).toHaveLength(4);
    expect(snapshot.routeStack?.targets[0]).toEqual({
      position: 1,
      model: "deepseek/deepseek-v4-flash",
      provider: "DeepSeek",
      modelCalls: 2,
      successes: 1,
      failures: 1,
      promptTokens: 150,
      completionTokens: 200,
      totalTokens: 350,
      avgLatencyMs: 700,
      successRatePct: 50,
      lastStatus: "200",
      lastUsedAt: "2026-08-20T11:50:00.000Z",
    });
    expect(snapshot.routeStack?.targets[1]).toEqual({
      position: 2,
      model: "openai/gpt-5.6-luna-pro",
      provider: "OpenRouter",
      modelCalls: 1,
      successes: 1,
      failures: 0,
      promptTokens: 50,
      completionTokens: 150,
      totalTokens: 200,
      avgLatencyMs: 600,
      successRatePct: 100,
      lastStatus: "200",
      lastUsedAt: "2026-08-20T11:45:01.000Z",
    });
    expect(snapshot.routeStack?.targets[2]).toEqual({
      position: 3,
      model: "google/gemini-3.7-flash",
      provider: "OpenRouter",
      modelCalls: 0,
      successes: 0,
      failures: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      avgLatencyMs: null,
      successRatePct: null,
      lastStatus: null,
      lastUsedAt: null,
    });
    expect(snapshot.routeStack?.targets[3]).toEqual({
      position: 4,
      model: "codex/gpt-5.6-luna",
      provider: "OpenAI Codex",
      modelCalls: 0,
      successes: 0,
      failures: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      avgLatencyMs: null,
      successRatePct: null,
      lastStatus: null,
      lastUsedAt: null,
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
        model: "codex/gpt-5.6-luna-max",
        isLockedOut: true,
        requests: 100,
      })],
    });
    expect(snapshot.providerHealth[1]?.models[0]?.model).toBe("gemini-3.7-flash-high");
    expect(snapshot.usage.models.map((model) => model.model)).toEqual([
      "gpt-5.6-luna-max",
      "gemini-3.7-flash-high",
      "openrouter/luna-pro",
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
    expect(snapshot.combo).toBeNull();
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

  it("matches targets by basename and comboStepId ordinal and handles malformed row data safely", () => {
    const logs = [
      {
        timestamp: "2026-08-20T11:55:00.000Z",
        status: 201,
        requestedModel: "deepseek-v4-flash", // basename match for target 1
        duration: 250,
        tokens: null, // missing tokens
        comboName: "fred-v4-stack",
        comboStepId: "model-1",
      },
      {
        timestamp: "2026-08-20T11:50:00.000Z",
        status: "502 Bad Gateway", // string status
        requestedModel: "unmatched-model",
        comboStepId: "prefix-model-3-suffix", // ordinal fallback -> target 3 (gemini-3.7-flash)
        duration: -50, // negative duration -> ignored for avgLatencyMs
        tokens: { in: 30, out: 5, total: 999 }, // total must be recomputed from input and output
        comboName: "fred-v4-stack",
      },
      {
        timestamp: "2026-08-20T11:40:00.000Z",
        status: 200,
        requestedModel: "unmatched-model",
        comboStepId: "model-99", // out of bounds ordinal -> ignored
        comboName: "fred-v4-stack",
      },
    ];

    const snapshot = normalizeOmniRouteUsagePayloads({
      providerLimits: {},
      providerConnections: providersPayload(),
      analytics: {},
      providerStats: {},
      healthMatrix: {},
      combos: combosPayload(),
      callLogs: logs,
      range: "7d",
      generatedAt: "2026-08-20T12:00:00.000Z",
    });

    expect(snapshot.routeStack).toMatchObject({
      name: "fred-v4-stack",
      modelCalls: 2,
      successes: 1,
      failures: 1,
      fallbackCalls: 1, // target 3 is pos > 1
      promptTokens: 30,
      completionTokens: 5,
      totalTokens: 35,
      avgLatencyMs: 250,
      successRatePct: 50,
      fallbackRatePct: 50,
    });
    expect(snapshot.routeStack?.targets[0]).toMatchObject({
      position: 1,
      model: "deepseek/deepseek-v4-flash",
      modelCalls: 1,
      successes: 1,
      failures: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      avgLatencyMs: 250,
      lastStatus: "201",
    });
    expect(snapshot.routeStack?.targets[2]).toMatchObject({
      position: 3,
      model: "google/gemini-3.7-flash",
      modelCalls: 1,
      successes: 0,
      failures: 1,
      promptTokens: 30,
      completionTokens: 5,
      totalTokens: 35,
      avgLatencyMs: null,
      lastStatus: "502",
    });
  });

  it("ignores malformed token containers without failing the route-stack snapshot", () => {
    const snapshot = normalizeOmniRouteUsagePayloads({
      providerLimits: {},
      providerConnections: providersPayload(),
      analytics: {},
      providerStats: {},
      healthMatrix: {},
      combos: combosPayload(),
      callLogs: [{
        timestamp: "2026-08-20T11:55:00.000Z",
        status: 200,
        requestedModel: "deepseek/deepseek-v4-flash",
        tokens: "invalid-sensitive-container",
        comboName: "fred-v4-stack",
      }],
      range: "24h",
      generatedAt: "2026-08-20T12:00:00.000Z",
    });

    expect(snapshot.routeStack).toMatchObject({
      modelCalls: 1,
      successes: 1,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
    expect(JSON.stringify(snapshot)).not.toContain("invalid-sensitive-container");
  });

  it("preserves all configured targets even when zero calls exist in the period", () => {
    const snapshot = normalizeOmniRouteUsagePayloads({
      providerLimits: {},
      providerConnections: providersPayload(),
      analytics: {},
      providerStats: {},
      healthMatrix: {},
      combos: combosPayload(),
      callLogs: [],
      range: "24h",
      generatedAt: "2026-08-20T12:00:00.000Z",
    });

    expect(snapshot.routeStack).toMatchObject({
      name: "fred-v4-stack",
      modelCalls: 0,
      successes: 0,
      failures: 0,
      fallbackCalls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      avgLatencyMs: null,
      successRatePct: null,
      fallbackRatePct: null,
      lastUsedAt: null,
      historyTruncated: false,
    });
    expect(snapshot.routeStack?.targets).toHaveLength(4);
    for (const target of snapshot.routeStack?.targets ?? []) {
      expect(target).toMatchObject({
        modelCalls: 0,
        successes: 0,
        failures: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        avgLatencyMs: null,
        successRatePct: null,
        lastStatus: null,
        lastUsedAt: null,
      });
    }
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

  function successfulFetcher(callLogs: unknown[] = callLogsPayload()) {
    return vi.fn(async (input: URL | Request | string, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url.endsWith("/api/usage/provider-limits")) return Response.json(providerLimitsPayload());
      if (url.endsWith("/api/providers")) return Response.json(providersPayload());
      if (url.includes("/api/usage/analytics?range=")) return Response.json(analyticsPayload());
      if (url.endsWith("/api/provider-stats")) return Response.json(providerStatsPayload());
      if (url.endsWith("/api/providers/health-matrix")) return Response.json(healthMatrixPayload());
      if (url.endsWith("/api/combos")) return Response.json(combosPayload());
      if (url.includes("/api/usage/call-logs")) {
        const parsed = new URL(url);
        const offset = Number(parsed.searchParams.get("offset") ?? "0");
        if (offset === 0) return Response.json(callLogs);
        return Response.json([]);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
  }

  it("makes authenticated bounded requests including call logs and never emits the provider payload", async () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-08-20T12:00:00.000Z").getTime());
    const fetcher = successfulFetcher();
    const snapshot = await getOmniRouteUsageSnapshot("24h", { fetcher: fetcher as unknown as typeof fetch });

    expect(fetcher).toHaveBeenCalledTimes(7);
    expect(String(fetcher.mock.calls[1]?.[0])).toBe("https://omniroute.example/sub/api/providers");
    expect(String(fetcher.mock.calls[6]?.[0])).toContain("/api/usage/call-logs?limit=1000&offset=0");
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
    expect(snapshot.codexQuota).toMatchObject({ quotaLabel: "Weekly", remainingPercent: 80 });
    expect(snapshot.routeStack).toMatchObject({
      name: "fred-v4-stack",
      modelCalls: 3,
      historyTruncated: false,
    });
    expect(JSON.stringify(snapshot)).not.toContain("opaque-cache");
    expect(JSON.stringify(snapshot)).not.toContain("secret-access-token");
  });

  it("paginates call logs and stops when oldest row in a page is before range start", async () => {
    const now = new Date("2026-08-20T12:00:00.000Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(now);

    const page1 = Array.from({ length: 1000 }, (_, i) => ({
      timestamp: new Date(now - i * 60 * 1000).toISOString(),
      status: 200,
      comboName: "fred-v4-stack",
      model: "deepseek/deepseek-v4-flash",
      duration: 100,
      tokens: { in: 10, out: 20 },
    }));
    // Page 2 crosses the 24h boundary (24 * 60 = 1440 minutes)
    const page2 = Array.from({ length: 1000 }, (_, i) => ({
      timestamp: new Date(now - (1000 + i) * 60 * 1000).toISOString(),
      status: 200,
      comboName: "fred-v4-stack",
      model: "deepseek/deepseek-v4-flash",
      duration: 100,
      tokens: { in: 10, out: 20 },
    }));

    const fetcher = vi.fn(async (input: URL | Request | string) => {
      const url = String(input);
      if (url.endsWith("/api/usage/provider-limits")) return Response.json(providerLimitsPayload());
      if (url.endsWith("/api/providers")) return Response.json(providersPayload());
      if (url.includes("/api/usage/analytics?range=")) return Response.json(analyticsPayload());
      if (url.endsWith("/api/provider-stats")) return Response.json(providerStatsPayload());
      if (url.endsWith("/api/providers/health-matrix")) return Response.json(healthMatrixPayload());
      if (url.endsWith("/api/combos")) return Response.json(combosPayload());
      if (url.includes("/api/usage/call-logs")) {
        const parsed = new URL(url);
        const offset = Number(parsed.searchParams.get("offset") ?? "0");
        if (offset === 0) return Response.json(page1);
        if (offset === 1000) return Response.json(page2);
        return Response.json([]);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const snapshot = await getOmniRouteUsageSnapshot("24h", { fetcher: fetcher as unknown as typeof fetch });
    // 6 base fetches + 2 call-log pages (page 1 full, page 2 crosses boundary -> stops)
    expect(fetcher).toHaveBeenCalledTimes(8);
    expect(snapshot.routeStack?.historyTruncated).toBe(false);
    // Exactly 1441 items within 24 hours (0..1440 minutes)
    expect(snapshot.routeStack?.modelCalls).toBe(1441);
  });

  it("sets historyTruncated to true when reaching 10,000 rows before range boundary", async () => {
    const now = new Date("2026-08-20T12:00:00.000Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(now);

    const makeFullPage = (pageIndex: number) => Array.from({ length: 1000 }, (_, i) => ({
      // All within 7d range (10,000 minutes = ~6.94 days < 7 days)
      timestamp: new Date(now - (pageIndex * 1000 + i) * 60 * 1000).toISOString(),
      status: 200,
      comboName: "fred-v4-stack",
      model: "deepseek/deepseek-v4-flash",
      duration: 100,
      tokens: { in: 10, out: 20 },
    }));

    const fetcher = vi.fn(async (input: URL | Request | string) => {
      const url = String(input);
      if (url.endsWith("/api/usage/provider-limits")) return Response.json(providerLimitsPayload());
      if (url.endsWith("/api/providers")) return Response.json(providersPayload());
      if (url.includes("/api/usage/analytics?range=")) return Response.json(analyticsPayload());
      if (url.endsWith("/api/provider-stats")) return Response.json(providerStatsPayload());
      if (url.endsWith("/api/providers/health-matrix")) return Response.json(healthMatrixPayload());
      if (url.endsWith("/api/combos")) return Response.json(combosPayload());
      if (url.includes("/api/usage/call-logs")) {
        const parsed = new URL(url);
        const offset = Number(parsed.searchParams.get("offset") ?? "0");
        const pageIndex = offset / 1000;
        if (pageIndex < 10) return Response.json(makeFullPage(pageIndex));
        return Response.json([]);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const snapshot = await getOmniRouteUsageSnapshot("7d", { fetcher: fetcher as unknown as typeof fetch });
    // 6 base fetches + 10 call-log pages
    expect(fetcher).toHaveBeenCalledTimes(16);
    expect(snapshot.routeStack?.historyTruncated).toBe(true);
    expect(snapshot.routeStack?.modelCalls).toBe(10_000);
  });

  it("serves a fresh snapshot without another upstream call", async () => {
    const fetcher = successfulFetcher();
    await getOmniRouteUsageSnapshot("7d", { fetcher: fetcher as unknown as typeof fetch });
    const cached = await getOmniRouteUsageSnapshot("7d", { fetcher: fetcher as unknown as typeof fetch });

    expect(fetcher).toHaveBeenCalledTimes(7);
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

    expect(fetcher).toHaveBeenCalledTimes(7);
    expect(failingFetcher).toHaveBeenCalled();
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
