import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateAdminRequest } from "@/lib/admin-users";
import { UserVisibleError } from "@/lib/errors";
import { clearOmniRouteUsageCacheForTests } from "@/lib/omniroute-usage";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GET } from "./route";

vi.mock("@/lib/admin-users", () => ({ authenticateAdminRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

function usagePayloads() {
  return {
    providerLimits: {
      caches: {
        "secret-codex-connection-id": {
          quotas: {
            session: {
              used: 10,
              total: 50,
              remaining: 40,
              resetAt: "2026-08-24T00:00:00.000Z",
              unlimited: false,
              displayName: "Weekly",
            },
          },
          plan: "Codex Pro",
          fetchedAt: "2026-08-20T09:00:00.000Z",
          source: "codex-oauth",
          email: "secret-account@example.at",
        },
        "secret-connection-id": {
          quotas: {
            "gemini-3.7-flash-high": {
              used: 20,
              total: 100,
              resetAt: "2026-08-21T00:00:00.000Z",
              quotaSource: "antigravity",
            },
          },
          plan: "Gemini Plan",
          fetchedAt: "2026-08-20T08:00:00.000Z",
        },
      },
      intervalMinutes: 15,
    },
    providers: {
      connections: [
        { id: "secret-codex-connection-id", provider: "codex", accessToken: "secret-access-token" },
        { id: "secret-connection-id", provider: "agy", apiKey: "secret-api-key" },
        { id: "secret-deepseek-connection-id", provider: "deepseek", apiKey: "secret-deepseek-key" },
        { id: "secret-or-connection-id", provider: "openrouter", apiKey: "secret-or-key" },
      ],
      byAccount: [{ email: "secret-account@example.at" }],
      byApiKey: [{ key: "secret-key" }],
    },
    analytics: {
      summary: {
        totalRequests: 20,
        promptTokens: 200,
        completionTokens: 400,
        totalTokens: 600,
        successfulRequests: 19,
        successRatePct: "95.00",
        avgLatencyMs: 800,
        totalCost: 0.2,
        fallbackCount: 1,
        lastRequest: "2026-08-20T09:00:00.000Z",
      },
      byModel: [
        { model: "gpt-5.6-luna", provider: "codex", requests: 10, totalTokens: 300, cost: 0.2, successRatePct: "100.00", avgLatencyMs: 750 },
        { model: "gemini-3.7-flash-high", provider: "antigravity", requests: 10, totalTokens: 300, cost: 0.2, successRatePct: 90, avgLatencyMs: 800 },
      ],
      byProvider: [
        { provider: "codex", requests: 10, totalTokens: 300, successRatePct: "100.00", avgLatencyMs: 750 },
        { provider: "openrouter", requests: 1, totalTokens: 30, cost: 0.02, successRatePct: 100, avgLatencyMs: 900 },
      ],
      dailyTrend: [{ date: "2026-08-20", requests: 20, tokens: 600, cost: 0.2 }],
      byAccount: [{ email: "secret-account@example.at" }],
      byApiKey: [{ secret: "secret-key-breakdown" }],
    },
    providerStats: {
      comboMetrics: {
        "omniroute-gpt-5.6-luna": {
          totalRequests: 20,
          totalSuccesses: 19,
          totalFailures: 1,
          totalFallbacks: 1,
          avgLatencyMs: 800,
          successRate: "95.00",
          fallbackRate: 10,
          lastUsedAt: "2026-08-20T09:00:00.000Z",
          productionTraffic: true,
          byModel: [
            { model: "codex/gpt-5.6-luna", requests: 10, successes: 10, failures: 0, avgLatencyMs: 750, lastStatus: "ok", targetId: "secret-target" },
            { model: "gemini-3.7-flash-high", requests: 10, successes: 9, failures: 1, avgLatencyMs: 800, lastStatus: "ok", targetId: "secret-target" },
          ],
        },
        "omniroute-gpt-5.6-luna-medium": {
          totalRequests: 15,
          totalSuccesses: 15,
          totalFailures: 0,
          totalFallbacks: 0,
          avgLatencyMs: 650,
          successRate: 100,
          fallbackRate: 0,
          lastUsedAt: "2026-08-20T08:30:00.000Z",
          productionTraffic: false,
          byModel: [
            { model: "codex/gpt-5.6-luna", requests: 15, successes: 15, failures: 0, avgLatencyMs: 650, lastStatus: "ok" },
          ],
        },
      },
    },
    healthMatrix: {
      providers: [
      {
        provider: "codex",
        state: "healthy",
        connections: 1,
        modelLockoutCount: 0,
        requests: 10,
        successRate: "100.00",
        avgLatencyMs: 750,
        accounts: [{
          id: "secret-codex-account-id",
          email: "secret-account@example.at",
          models: [{ model: "gpt-5.6-luna", status: "healthy", requests: 10, successes: 10, avgLatencyMs: 750 }],
        }],
      },
      {
        provider: "openrouter",
        state: "healthy",
        accounts: [{ models: [{ model: "openrouter/luna-pro", status: "healthy" }] }],
      },
      {
        provider: "antigravity",
        state: "healthy",
        connections: 1,
        modelLockoutCount: 0,
        requests: 10,
        successRate: 90,
        avgLatencyMs: 800,
        accounts: [{
          id: "secret-account-id",
          label: "secret-label",
          models: [{ model: "gemini-3.7-flash-high", status: "healthy", requests: 10, successes: 9, avgLatencyMs: 800 }],
        }],
      }],
    },
    combos: {
      combos: [
        {
          name: "omniroute-gpt-5.6-luna",
          strategy: "priority",
          models: [
            { model: "codex/gpt-5.6-luna", providerId: "secret-codex-connection-id" },
          ],
          version: 1,
          updatedAt: "2026-08-18T00:00:00.000Z",
        },
        {
          name: "omniroute-gpt-5.6-luna-medium",
          strategy: "priority",
          models: [
            { model: "codex/gpt-5.6-luna", providerId: "secret-codex-connection-id" },
          ],
          version: 1,
          updatedAt: "2026-08-19T00:00:00.000Z",
        },
        {
          name: "omniroute-gpt-5.6-luna-high",
          strategy: "priority",
          models: [
            { model: "codex/gpt-5.6-luna", providerId: "secret-codex-connection-id" },
          ],
          version: 1,
          updatedAt: "2026-08-20T00:00:00.000Z",
        },
        {
          name: "omniroute-gpt-5.6-luna-xhigh",
          strategy: "priority",
          models: [
            { model: "codex/gpt-5.6-luna", providerId: "secret-codex-connection-id" },
          ],
          version: 1,
          updatedAt: "2026-08-21T00:00:00.000Z",
        },
      ],
    },
  };
}

function jsonResponse(url: string): Response {
  const payloads = usagePayloads();
  if (url.endsWith("/api/usage/provider-limits")) return Response.json(payloads.providerLimits);
  if (url.includes("/api/usage/analytics?range=")) return Response.json(payloads.analytics);
  if (url.endsWith("/api/provider-stats")) return Response.json(payloads.providerStats);
  if (url.endsWith("/api/providers")) return Response.json(payloads.providers);
  if (url.endsWith("/api/providers/health-matrix")) return Response.json(payloads.healthMatrix);
  if (url === "https://api.frankfurter.app/latest?from=USD&to=EUR") {
    return Response.json({ base: "USD", rates: { EUR: 0.92 }, date: "2026-08-20" });
  }
  return Response.json(payloads.combos);
}

function request(query = "", authenticated = true): Request {
  return new Request(`https://findog.at/api/admin/omniroute-usage${query}`, {
    headers: authenticated ? { Authorization: "Bearer admin-access-token" } : {},
  });
}

const fredQuery = {
  select: vi.fn(),
  eq: vi.fn(),
  gte: vi.fn(),
  lt: vi.fn(),
  order: vi.fn(),
  range: vi.fn(),
};
const listUsers = vi.fn();

function mockFredMessages() {
  return [
    { client_id: "user-1", created_at: "2026-08-20T11:58:00.000Z" },
    { client_id: "user-1", created_at: "2026-08-20T11:59:00.000Z" },
    { client_id: "user-2", created_at: "2026-08-20T11:57:00.000Z" },
    { client_id: null, created_at: "2026-08-20T11:56:00.000Z" },
  ];
}

describe("GET /api/admin/omniroute-usage", () => {
  const originalEnv = { ...process.env };
  const fetchMock = vi.fn(async (input: URL | Request | string) => jsonResponse(String(input)));

  beforeEach(() => {
    clearOmniRouteUsageCacheForTests();
    vi.resetAllMocks();
    fetchMock.mockClear();
    fetchMock.mockImplementation(async (input: URL | Request | string) => jsonResponse(String(input)));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-08-20T12:00:00.000Z").getTime());
    process.env.OMNIROUTE_ADMIN_BASE_URL = "https://omniroute.example";
    process.env.OMNIROUTE_ADMIN_API_KEY = "secret-management-key";
    fredQuery.select.mockReturnValue(fredQuery);
    fredQuery.eq.mockReturnValue(fredQuery);
    fredQuery.gte.mockReturnValue(fredQuery);
    fredQuery.lt.mockReturnValue(fredQuery);
    fredQuery.order.mockReturnValue(fredQuery);
    fredQuery.range.mockImplementation((from: number, to: number) => Promise.resolve({
      data: mockFredMessages().slice(from, to + 1),
      error: null,
    }));
    listUsers.mockImplementation(({ page = 1, perPage = 1_000 } = {}) => {
      const firstPage = [
        { id: "user-1", email: "one@example.com", userMetadata: { upstreamId: "secret-upstream-id" } },
        { id: "user-2", email: "two@example.com" },
        ...Array.from({ length: 998 }, (_, index) => ({ id: `auth-user-${index}`, email: `auth-${index}@example.com` })),
      ];
      const pages = [firstPage, [{ id: "deleted-user", email: "deleted@example.com" }]];
      return Promise.resolve({ data: { users: pages[page - 1] ?? [] }, error: null, perPage });
    });
    vi.mocked(getSupabaseServerClient).mockReturnValue({
      auth: { admin: { listUsers } },
      from: vi.fn(() => fredQuery),
    } as never);
    vi.mocked(authenticateAdminRequest).mockResolvedValue({ id: "admin-1" });
  });

  afterEach(() => {
    clearOmniRouteUsageCacheForTests();
    vi.unstubAllGlobals();
    for (const key of ["OMNIROUTE_ADMIN_BASE_URL", "OMNIROUTE_ADMIN_API_KEY"] as const) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it("rejects unauthenticated requests before any upstream fetch", async () => {
    vi.mocked(authenticateAdminRequest).mockRejectedValueOnce(new UserVisibleError("Bitte zuerst anmelden.", 401));
    const response = await GET(request("?range=24h", false));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: "Bitte zuerst anmelden." });
  });

  it("rejects non-admin users before any upstream fetch", async () => {
    vi.mocked(authenticateAdminRequest).mockRejectedValueOnce(new UserVisibleError("Du hast keine Administrationsberechtigung.", 403));
    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(authenticateAdminRequest).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid range with 400", async () => {
    const response = await GET(request("?range=31d"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Der Zeitraum ist ungültig." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a strict no-store snapshot for admins with configured targets, exact per-user questions, and EUR conversion", async () => {
    const response = await GET(request("?range=7d"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://omniroute.example/api/usage/provider-limits");
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("https://omniroute.example/api/providers");
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("/api/usage/analytics?range=7d");
    expect(String(fetchMock.mock.calls[3]?.[0])).toBe("https://omniroute.example/api/provider-stats");
    expect(String(fetchMock.mock.calls[4]?.[0])).toBe("https://omniroute.example/api/providers/health-matrix");
    expect(String(fetchMock.mock.calls[5]?.[0])).toBe("https://omniroute.example/api/combos");
    expect(String(fetchMock.mock.calls[6]?.[0])).toBe("https://api.frankfurter.app/latest?from=USD&to=EUR");
    const fxCall = fetchMock.mock.calls[6] as unknown as [string, RequestInit];
    expect(fxCall[1].headers).toEqual({ Accept: "application/json" });
    expect(JSON.stringify(fxCall[1].headers)).not.toContain("Authorization");

    expect(payload).toMatchObject({
      stale: false,
      range: "7d",
      userQuestions: 4,
      userUsage: [
        {
          clientId: "user-1",
          email: "one@example.com",
          questionCount: 2,
          questionSharePct: expect.closeTo(50, 6),
          estimatedCostEur: expect.closeTo(0.0184, 8),
          lastQuestionAt: "2026-08-20T11:59:00.000Z",
        },
        {
          clientId: "user-2",
          email: "two@example.com",
          questionCount: 1,
          questionSharePct: expect.closeTo(25, 6),
          estimatedCostEur: expect.closeTo(0.0092, 8),
          lastQuestionAt: "2026-08-20T11:57:00.000Z",
        },
        {
          clientId: null,
          email: "System / nicht zugeordnet",
          questionCount: 1,
          questionSharePct: expect.closeTo(25, 6),
          estimatedCostEur: expect.closeTo(0.0092, 8),
          lastQuestionAt: "2026-08-20T11:56:00.000Z",
        },
      ],
      exchangeRate: { rate: 0.92, date: "2026-08-20", source: "Frankfurter" },
      costConversionWarning: null,
      quota: null,
      codexQuota: { used: 10, total: 50, remainingPercent: 80, quotaLabel: "Weekly" },
      usage: {
        summary: { totalRequests: 20, totalCostEur: expect.any(Number) },
        models: [{ model: "codex/gpt-5.6-luna", costEur: expect.any(Number) }],
        providers: [{ provider: "OpenAI Codex", costEur: null }],
        dailyTrend: [{ costEur: expect.any(Number) }],
      },
      providerHealth: [
        { provider: "codex", models: [{ model: "codex/gpt-5.6-luna" }] },
      ],
    });
    expect(fredQuery.select).toHaveBeenCalledWith("client_id, created_at");
    expect(fredQuery.eq).toHaveBeenCalledWith("role", "user");
    expect(fredQuery.gte).toHaveBeenCalledWith("created_at", "2026-08-13T12:00:00.000Z");
    expect(fredQuery.lt).toHaveBeenCalledWith("created_at", "2026-08-20T12:00:00.000Z");
    expect(fredQuery.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(fredQuery.range).toHaveBeenCalledWith(0, 999);
    expect(listUsers).toHaveBeenNthCalledWith(1, { page: 1, perPage: 1_000 });
    expect(listUsers).toHaveBeenNthCalledWith(2, { page: 2, perPage: 1_000 });
    expect(payload.usage.summary.totalCostEur).toBeCloseTo(0.184);
    expect(payload.usage.models[0].costEur).toBeCloseTo(0.184);
    expect(payload.usage.dailyTrend[0].costEur).toBeCloseTo(0.184);
    expect(JSON.stringify(payload)).not.toContain("costUsd");
    expect(JSON.stringify(payload)).not.toContain("totalCostUsd");
    expect(payload.routes).toHaveLength(4);
    expect(payload.routes[0]).toMatchObject({
      name: "omniroute-gpt-5.6-luna",
      strategy: "priority",
      targets: ["codex/gpt-5.6-luna"],
      version: 1,
      productionTraffic: true,
      requests: 20,
      successes: 19,
      failures: 1,
      fallbacks: 1,
      avgLatencyMs: 800,
      successRatePct: 95,
      fallbackRatePct: 10,
      lastUsedAt: "2026-08-20T09:00:00.000Z",
    });
    expect(payload.routes[0].models).toHaveLength(1);
    expect(payload.usage.models.map((model: { model: string }) => model.model)).toEqual(["codex/gpt-5.6-luna"]);
    expect(payload.routes[1]).toMatchObject({
      name: "omniroute-gpt-5.6-luna-medium",
      strategy: "priority",
      requests: 15,
      productionTraffic: false,
    });
    expect(payload.routes[2]).toMatchObject({
      name: "omniroute-gpt-5.6-luna-high",
      strategy: "priority",
      requests: null,
      productionTraffic: false,
    });
    expect(payload.routes[3]).toMatchObject({
      name: "omniroute-gpt-5.6-luna-xhigh",
      strategy: "priority",
      requests: null,
      productionTraffic: false,
    });
    expect(payload.usage.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "OpenAI Codex", model: "codex/gpt-5.6-luna", successRatePct: 100 }),
    ]));
    expect(Object.keys(payload).sort()).toEqual([
      "codexQuota", "costConversionWarning", "exchangeRate", "generatedAt", "providerHealth",
      "quota", "range", "routes", "stale", "usage", "userQuestions", "userUsage",
    ]);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("byAccount");
    expect(serialized).not.toContain("byApiKey");
    expect(serialized).not.toContain("providerId");
    expect(serialized).not.toContain("connection-id");
    expect(serialized).not.toContain("accessToken");
    expect(serialized).not.toContain("Fred V4");
    expect(serialized).not.toContain("fred-v4-stack");
    expect(serialized).not.toContain("call-logs");
    expect(payload.providerHealth.map((provider: { provider: string }) => provider.provider)).toEqual(["codex"]);
    expect(serialized).not.toContain("targetId");
    expect(payload.userUsage.map((user: Record<string, unknown>) => Object.keys(user).sort())).toEqual([
      ["clientId", "email", "estimatedCostEur", "lastQuestionAt", "questionCount", "questionSharePct"],
      ["clientId", "email", "estimatedCostEur", "lastQuestionAt", "questionCount", "questionSharePct"],
      ["clientId", "email", "estimatedCostEur", "lastQuestionAt", "questionCount", "questionSharePct"],
    ]);
  });

  it("returns a sanitized 503 when the upstream request fails and no cache exists", async () => {
    fetchMock.mockImplementationOnce(async () => new Response("secret upstream response", { status: 503 }));
    const response = await GET(request("?refresh=1"));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({ error: "OmniRoute ist derzeit nicht erreichbar." });
  });

  it("returns a sanitized 503 when server environment is missing", async () => {
    process.env.OMNIROUTE_ADMIN_API_KEY = "";
    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: "OmniRoute ist serverseitig nicht konfiguriert." });
  });

  it("returns a sanitized 503 when the exact question rows cannot be read", async () => {
    fredQuery.range.mockResolvedValueOnce({ data: null, error: { message: "secret database failure" } });
    const response = await GET(request("?range=24h"));

    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: "Die Findog-Fragen konnten nicht gezählt werden." });
  });

  it("returns a sanitized 503 when paginated email resolution fails", async () => {
    listUsers.mockResolvedValueOnce({ data: null, error: { message: "secret auth admin failure" } });
    const response = await GET(request("?range=24h"));

    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: "Die Findog-Fragen konnten nicht zugeordnet werden." });
  });

  it("keeps EUR unavailable when the reference rate is invalid", async () => {
    fetchMock.mockImplementation(async (input: URL | Request | string) => {
      const url = String(input);
      if (url.startsWith("https://api.frankfurter.app/")) {
        return Response.json({ base: "USD", rates: { EUR: 0 }, date: "2026-08-20" });
      }
      return jsonResponse(url);
    });
    const response = await GET(request("?refresh=1"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.exchangeRate).toBeNull();
    expect(payload.costConversionWarning).toContain("nicht verfügbar");
    expect(payload.usage.summary.totalCostEur).toBeNull();
    expect(payload.usage.models[0].costEur).toBeNull();
    expect(payload.userUsage.every((user: { estimatedCostEur: number | null }) => user.estimatedCostEur === null)).toBe(true);
  });
});
