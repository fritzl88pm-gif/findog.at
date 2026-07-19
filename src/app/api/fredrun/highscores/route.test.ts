import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GET, POST } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

const scoreRows = [
  { id: "score-1", score: 500, created_at: "2026-07-19T10:00:00Z", fredrun_player_profiles: { player_name: "Anna" } },
  { id: "score-2", score: 450, created_at: "2026-07-19T10:01:00Z", fredrun_player_profiles: { player_name: "Berta" } },
];

function createSupabaseMock(options: {
  scoresError?: unknown;
  profileError?: unknown;
  rpcError?: unknown;
  rpcData?: boolean;
} = {}) {
  const scoreBuilder = {
    select: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };
  scoreBuilder.select.mockReturnValue(scoreBuilder);
  scoreBuilder.order.mockReturnValue(scoreBuilder);
  scoreBuilder.limit.mockResolvedValue({ data: scoreRows, error: options.scoresError ?? null });

  const profileBuilder = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  };
  profileBuilder.select.mockReturnValue(profileBuilder);
  profileBuilder.eq.mockReturnValue(profileBuilder);
  profileBuilder.maybeSingle.mockResolvedValue({
    data: { player_name: "Fredi" },
    error: options.profileError ?? null,
  });

  const rpc = vi.fn().mockResolvedValue({ data: options.rpcData ?? true, error: options.rpcError ?? null });
  const from = vi.fn((table: string) => table === "fredrun_scores" ? scoreBuilder : profileBuilder);
  return { client: { auth: {}, from, rpc }, scoreBuilder, profileBuilder, rpc };
}

function request(method = "GET", body?: unknown) {
  return new Request("https://findog.at/api/fredrun/highscores", {
    method,
    headers: {
      Authorization: "Bearer token",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("/api/fredrun/highscores", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "user-1" });
  });

  it("returns the stored alias and deterministic top ten", async () => {
    const mock = createSupabaseMock();
    vi.mocked(getSupabaseServerClient).mockReturnValue(mock.client as never);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      playerName: "Fredi",
      entries: [
        { rank: 1, name: "Anna", score: 500 },
        { rank: 2, name: "Berta", score: 450 },
      ],
    });
    expect(mock.scoreBuilder.order).toHaveBeenNthCalledWith(1, "score", { ascending: false });
    expect(mock.scoreBuilder.order).toHaveBeenNthCalledWith(2, "created_at", { ascending: true });
    expect(mock.scoreBuilder.order).toHaveBeenNthCalledWith(3, "id", { ascending: true });
    expect(mock.scoreBuilder.limit).toHaveBeenCalledWith(10);
  });

  it("submits the authenticated user's exact round and refreshes the list", async () => {
    const mock = createSupabaseMock();
    vi.mocked(getSupabaseServerClient).mockReturnValue(mock.client as never);
    const response = await POST(request("POST", {
      runId: "123e4567-e89b-42d3-a456-426614174000",
      name: "  Fredi  ",
      score: 321,
    }));
    expect(response.status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith("submit_fredrun_score", {
      player_id: "user-1",
      submitted_run_id: "123e4567-e89b-42d3-a456-426614174000",
      submitted_name: "Fredi",
      submitted_score: 321,
    });
    await expect(response.json()).resolves.toMatchObject({ submitted: true, playerName: "Fredi" });
  });

  it("treats an idempotent retry as successful without claiming a new row", async () => {
    const mock = createSupabaseMock({ rpcData: false });
    vi.mocked(getSupabaseServerClient).mockReturnValue(mock.client as never);
    const response = await POST(request("POST", {
      runId: "123e4567-e89b-42d3-a456-426614174000",
      name: "Fredi",
      score: 321,
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ submitted: false });
  });

  it("rejects malformed names, scores, run IDs, and JSON", async () => {
    const mock = createSupabaseMock();
    vi.mocked(getSupabaseServerClient).mockReturnValue(mock.client as never);
    for (const body of [
      { runId: "invalid", name: "Fredi", score: 1 },
      { runId: "123e4567-e89b-42d3-a456-426614174000", name: "", score: 1 },
      { runId: "123e4567-e89b-42d3-a456-426614174000", name: "x".repeat(21), score: 1 },
      { runId: "123e4567-e89b-42d3-a456-426614174000", name: "Fredi", score: 1_000_001 },
    ]) {
      expect((await POST(request("POST", body))).status).toBe(400);
    }
    expect((await POST(new Request("https://findog.at/api/fredrun/highscores", {
      method: "POST",
      headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
      body: "not-json",
    }))).status).toBe(400);
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("maps database rate limits and unavailable persistence to safe errors", async () => {
    const limited = createSupabaseMock({ rpcError: { message: "fredrun submission rate limit exceeded" } });
    vi.mocked(getSupabaseServerClient).mockReturnValue(limited.client as never);
    expect((await POST(request("POST", {
      runId: "123e4567-e89b-42d3-a456-426614174000",
      name: "Fredi",
      score: 1,
    }))).status).toBe(429);

    vi.mocked(getSupabaseServerClient).mockReturnValue(null);
    expect((await GET(request())).status).toBe(503);
  });

  it("keeps leaderboard read failures non-diagnostic", async () => {
    const failed = createSupabaseMock({ scoresError: { message: "private database detail" } });
    vi.mocked(getSupabaseServerClient).mockReturnValue(failed.client as never);
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database detail");
  });
});
