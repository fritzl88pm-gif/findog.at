import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GET, POST } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

const storedProgress = {
  coinBalance: 725,
  bestScore: 12_500,
  unlockedCharacters: ["fred", "frida", "superfred"],
  selectedCharacter: "superfred",
  unlockedWorlds: ["vienna", "finanzamt-night"],
  selectedWorld: "finanzamt-night",
  lastSettledRunId: "123e4567-e89b-42d3-a456-426614174000",
  version: 7,
  updatedAt: "2026-08-17T08:00:00.000Z",
};

function createSupabaseMock(results: Array<{ data: unknown; error: unknown }>) {
  const rpc = vi.fn();
  for (const result of results) rpc.mockResolvedValueOnce(result);
  return { client: { auth: {}, rpc }, rpc };
}

function request(method = "GET", body?: unknown) {
  return new Request("https://findog.at/api/fredrun/progress", {
    method,
    headers: {
      Authorization: "Bearer token",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("/api/fredrun/progress", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "user-1" });
  });

  it("creates or loads only the authenticated user's progress", async () => {
    const mock = createSupabaseMock([{ data: storedProgress, error: null }]);
    vi.mocked(getSupabaseServerClient).mockReturnValue(mock.client as never);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mock.rpc).toHaveBeenCalledWith("ensure_fredrun_user_progress", {
      player_id: "user-1",
    });
    await expect(response.json()).resolves.toMatchObject({
      progress: { profile: { coinBalance: 725 }, bestScore: 12_500, version: 7 },
      awardedCoins: 0,
    });
  });

  it("settles an authenticated run with server-derived ownership", async () => {
    const mock = createSupabaseMock([{
      data: { ...storedProgress, status: "settled", awardedCoins: 14 },
      error: null,
    }]);
    vi.mocked(getSupabaseServerClient).mockReturnValue(mock.client as never);
    const response = await POST(request("POST", {
      action: "settle_run",
      runId: "123e4567-e89b-42d3-a456-426614174000",
      collectedCoins: 14,
      score: 420,
      playerId: "attacker-controlled-user",
    }));
    expect(response.status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith("apply_fredrun_progress_action", {
      player_id: "user-1",
      requested_action: "settle_run",
      submitted_run_id: "123e4567-e89b-42d3-a456-426614174000",
      submitted_coins: 14,
      submitted_score: 420,
      target_type: null,
      target_id: null,
    });
    await expect(response.json()).resolves.toMatchObject({ status: "settled", awardedCoins: 14 });
  });

  it("rejects malformed actions before calling the database", async () => {
    const mock = createSupabaseMock([]);
    vi.mocked(getSupabaseServerClient).mockReturnValue(mock.client as never);
    expect((await POST(request("POST", {
      action: "purchase",
      itemType: "world",
      itemId: "superfred",
    }))).status).toBe(400);
    expect((await POST(new Request("https://findog.at/api/fredrun/progress", {
      method: "POST",
      headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
      body: "not-json",
    }))).status).toBe(400);
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("keeps database failures private and fails closed without Supabase", async () => {
    const failed = createSupabaseMock([{ data: null, error: { message: "private database detail" } }]);
    vi.mocked(getSupabaseServerClient).mockReturnValue(failed.client as never);
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database detail");

    vi.mocked(getSupabaseServerClient).mockReturnValue(null);
    expect((await GET(request())).status).toBe(503);
  });
});
