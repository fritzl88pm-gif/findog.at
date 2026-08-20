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
        "secret-connection-id": {
          quotas: {
            "gemini-3.7-flash-high": {
              used: 20,
              total: 100,
              remainingPercentage: 80,
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
    analytics: {
      summary: {
        totalRequests: 10,
        promptTokens: 100,
        completionTokens: 200,
        totalTokens: 300,
        successfulRequests: 9,
        successRatePct: 90,
        avgLatencyMs: 800,
        totalCost: 0.2,
        fallbackCount: 1,
        lastRequest: "2026-08-20T09:00:00.000Z",
      },
      byModel: [{ model: "gemini-3.7-flash-high", provider: "antigravity", requests: 10, totalTokens: 300, cost: 0.2, successRatePct: 90, avgLatencyMs: 800 }],
      byProvider: [{ provider: "openrouter", requests: 1, totalTokens: 30, cost: 0.02, successRatePct: 100, avgLatencyMs: 900 }],
      dailyTrend: [{ date: "2026-08-20", requests: 10, tokens: 300, cost: 0.2 }],
      byAccount: [{ email: "secret-account@example.at" }],
      byApiKey: [{ secret: "secret-key-breakdown" }],
    },
    providerStats: {
      comboMetrics: {
        "omniroute-gemini-3.7-flash-high": {
          totalRequests: 10,
          totalSuccesses: 9,
          totalFailures: 1,
          totalFallbacks: 1,
          avgLatencyMs: 800,
          successRate: 90,
          fallbackRate: 10,
          lastUsedAt: "2026-08-20T09:00:00.000Z",
          productionTraffic: true,
          byModel: [{ model: "gemini-3.7-flash-high", requests: 10, successes: 9, failures: 1, avgLatencyMs: 800, lastStatus: "ok", targetId: "secret-target" }],
        },
      },
    },
    healthMatrix: {
      providers: [{
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
        name: "omniroute-gemini-3.7-flash-high",
        strategy: "priority",
        models: [
          { model: "gemini-3.7-flash-high", providerId: "agy" },
          { model: "openrouter/luna-pro", providerId: "openrouter" },
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
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/api/usage/analytics?range=7d");
    expect(payload).toMatchObject({
      stale: false,
      range: "7d",
      quota: { used: 20, total: 100, remainingPercent: 80 },
      usage: { summary: { totalRequests: 10 } },
      combo: { name: "omniroute-gemini-3.7-flash-high", productionTraffic: true },
      providerHealth: [{ provider: "gemini" }],
    });
    expect(Object.keys(payload).sort()).toEqual([
      "combo", "generatedAt", "providerHealth", "quota", "range", "stale", "usage",
    ]);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("byAccount");
    expect(serialized).not.toContain("byApiKey");
    expect(serialized).not.toContain("providerId");
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
