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
        { model: "gpt-5.6-luna-max", provider: "codex", requests: 10, totalTokens: 300, cost: 0.2, successRatePct: "100.00", avgLatencyMs: 750 },
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
        "omniroute-luna-max-gemini-3.7-flash-high": {
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
            { model: "codex/gpt-5.6-luna-max", requests: 10, successes: 10, failures: 0, avgLatencyMs: 750, lastStatus: "ok", targetId: "secret-target" },
            { model: "gemini-3.7-flash-high", requests: 10, successes: 9, failures: 1, avgLatencyMs: 800, lastStatus: "ok", targetId: "secret-target" },
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
          models: [{ model: "gpt-5.6-luna-max", status: "healthy", requests: 10, successes: 10, avgLatencyMs: 750 }],
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
      combos: [{
        name: "omniroute-luna-max-gemini-3.7-flash-high",
        strategy: "priority",
        models: [
          { model: "codex/gpt-5.6-luna-max", providerId: "codex" },
          { model: "gemini-3.7-flash-high", providerId: "agy" },
        ],
        version: 1,
        updatedAt: "2026-08-18T00:00:00.000Z",
      }],
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
  return Response.json(payloads.combos);
}

function request(query = "", authenticated = true): Request {
  return new Request(`https://findog.at/api/admin/omniroute-usage${query}`, {
    headers: authenticated ? { Authorization: "Bearer admin-access-token" } : {},
  });
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
    process.env.OMNIROUTE_ADMIN_BASE_URL = "https://omniroute.example";
    process.env.OMNIROUTE_ADMIN_API_KEY = "secret-management-key";
    vi.mocked(getSupabaseServerClient).mockReturnValue({ auth: {} } as never);
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

  it("returns a strict no-store snapshot for admins and sanitizes upstream data", async () => {
    const response = await GET(request("?range=7d"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("https://omniroute.example/api/providers");
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("/api/usage/analytics?range=7d");
    expect(payload).toMatchObject({
      stale: false,
      range: "7d",
      quota: { used: 20, total: 100, remainingPercent: 80 },
      codexQuota: { used: 10, total: 50, remainingPercent: 80, quotaLabel: "Weekly" },
      usage: { summary: { totalRequests: 20 } },
      combo: { name: "omniroute-luna-max-gemini-3.7-flash-high", productionTraffic: true },
      providerHealth: [
        { provider: "codex", models: [{ model: "codex/gpt-5.6-luna-max" }] },
        { provider: "gemini", models: [{ model: "gemini-3.7-flash-high" }] },
      ],
    });
    expect(payload.usage.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "OpenAI Codex", model: "gpt-5.6-luna-max", successRatePct: 100 }),
    ]));
    expect(Object.keys(payload).sort()).toEqual([
      "codexQuota", "combo", "generatedAt", "providerHealth", "quota", "range", "stale", "usage",
    ]);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("byAccount");
    expect(serialized).not.toContain("byApiKey");
    expect(serialized).not.toContain("providerId");
    expect(serialized).not.toContain("connection-id");
    expect(serialized).not.toContain("accessToken");
    expect(payload.providerHealth.map((provider: { provider: string }) => provider.provider)).toEqual(["codex", "gemini"]);
    expect(serialized).not.toContain("targetId");
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
});
