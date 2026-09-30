import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { assertFredRunAccessAllowed, FredRunAccessBlockedServerError } from "@/lib/fredrun-access-server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GET, POST } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/fredrun-access-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fredrun-access-server")>()),
  assertFredRunAccessAllowed: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

const RUN = "123e4567-e89b-42d3-a456-426614174000";
// Zeilen der Datenbankfunktion (Feld „hero“); die API liefert daraus „character“
const rpcRows = [
  { rank: 1, player_name: "Anna", score: 900, meters: 300, hero: "frida", is_me: false },
  { rank: 2, player_name: "Fredi", score: 700, meters: 200, hero: "fred", is_me: true },
];

function createMock(options: { rpcError?: unknown; boardError?: unknown; submitData?: boolean; profile?: string | null; boardRows?: unknown[] } = {}) {
  const profileBuilder = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
  profileBuilder.select.mockReturnValue(profileBuilder);
  profileBuilder.eq.mockReturnValue(profileBuilder);
  profileBuilder.maybeSingle.mockResolvedValue({ data: options.profile === null ? null : { player_name: options.profile ?? "Fredi" }, error: null });
  const rpc = vi.fn(async (name: string) => {
    if (name === "submit_fredrun2_score") return { data: options.submitData ?? true, error: options.rpcError ?? null };
    return { data: options.boardRows ?? rpcRows, error: options.boardError ?? null };
  });
  const from = vi.fn(() => profileBuilder);
  return { client: { auth: {}, from, rpc }, rpc, from };
}

const url = (board = "world:wien") => `https://findog.at/api/fredrun2/highscores?board=${encodeURIComponent(board)}`;
const get = (board?: string) => new Request(url(board), { headers: { Authorization: "Bearer token" } });
const post = (body: unknown) =>
  new Request(url(), { method: "POST", headers: { Authorization: "Bearer token", "Content-Type": "application/json" }, body: JSON.stringify(body) });
const validBody = { board: "world:wien", runId: RUN, name: "Fredi", score: 700, meters: 200, character: "fred" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "user-1" });
  vi.mocked(assertFredRunAccessAllowed).mockResolvedValue();
});

describe("/api/fredrun2/highscores", () => {
  it("verlangt Anmeldung vor jedem Lesen und Schreiben", async () => {
    const mock = createMock();
    vi.mocked(getSupabaseServerClient).mockReturnValue(mock.client as never);
    vi.mocked(authenticateSupabaseRequest).mockRejectedValue(new UserVisibleError("Bitte anmelden.", 401));
    expect((await GET(get())).status).toBe(401);
    expect((await POST(post(validBody))).status).toBe(401);
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("liefert die globale Liste mit eigenem Eintrag und Namen", async () => {
    const mock = createMock();
    vi.mocked(getSupabaseServerClient).mockReturnValue(mock.client as never);
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    const body = await res.json();
    expect(body.board).toBe("world:wien");
    expect(body.entries).toEqual([
      { rank: 1, name: "Anna", score: 900, meters: 300, character: "frida", me: false },
      { rank: 2, name: "Fredi", score: 700, meters: 200, character: "fred", me: true },
    ]);
    expect(body.me).toEqual({ rank: 2, score: 700 });
    expect(body.playerName).toBe("Fredi");
    expect(mock.rpc).toHaveBeenCalledWith("get_fredrun2_leaderboard", { requested_board: "world:wien", viewer_id: "user-1", max_rows: 25 });
  });

  it("trennt den eigenen Platz außerhalb der Top-Liste ab", async () => {
    const outside = [{ rank: 1, player_name: "Anna", score: 900, meters: 300, hero: "frida", is_me: false }, { rank: 31, player_name: "Fredi", score: 5, meters: 3, hero: "fred", is_me: true }];
    const mock = createMock({ boardRows: outside });
    vi.mocked(getSupabaseServerClient).mockReturnValue(mock.client as never);
    const body = await (await GET(get())).json();
    expect(body.entries).toHaveLength(1);
    expect(body.me).toEqual({ rank: 31, score: 5 });
  });

  it("weist ungültige Boards ab", async () => {
    const mock = createMock();
    vi.mocked(getSupabaseServerClient).mockReturnValue(mock.client as never);
    for (const board of ["world:mars", "", "daily:1999-01-01", "tour;drop"]) expect((await GET(get(board))).status).toBe(400);
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("reicht einen Lauf ein und liefert Liste + submitted", async () => {
    const mock = createMock();
    vi.mocked(getSupabaseServerClient).mockReturnValue(mock.client as never);
    const res = await POST(post(validBody));
    expect(res.status).toBe(200);
    expect((await res.json()).submitted).toBe(true);
    expect(mock.rpc).toHaveBeenCalledWith("submit_fredrun2_score", {
      player_id: "user-1", submitted_run_id: RUN, submitted_name: "Fredi", submitted_board: "world:wien",
      submitted_score: 700, submitted_meters: 200, submitted_hero: "fred",
    });
  });

  it("nutzt ohne Namen den vorhandenen Fredrun-Namen", async () => {
    const mock = createMock({ profile: "Vorhanden" });
    vi.mocked(getSupabaseServerClient).mockReturnValue(mock.client as never);
    await POST(post({ ...validBody, name: "" }));
    expect(mock.rpc).toHaveBeenCalledWith("submit_fredrun2_score", expect.objectContaining({ submitted_name: "Vorhanden" }));
  });

  it("weist ungültige Einreichungen ab, ohne zu schreiben", async () => {
    const mock = createMock();
    vi.mocked(getSupabaseServerClient).mockReturnValue(mock.client as never);
    for (const body of [
      { ...validBody, score: -1 }, { ...validBody, score: 1.5 }, { ...validBody, score: 1e12 }, { ...validBody, runId: "x" },
      { ...validBody, board: "world:mars" }, { ...validBody, character: "hacker" }, { ...validBody, name: "x".repeat(17) }, { ...validBody, meters: -3 }, "text",
    ]) {
      expect((await POST(post(body))).status).toBe(400);
    }
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("meldet Rate-Limit und Ausfälle verständlich", async () => {
    const limited = createMock({ rpcError: { message: "fredrun submission rate limit exceeded" } });
    vi.mocked(getSupabaseServerClient).mockReturnValue(limited.client as never);
    expect((await POST(post(validBody))).status).toBe(429);
    const broken = createMock({ rpcError: { message: "boom" } });
    vi.mocked(getSupabaseServerClient).mockReturnValue(broken.client as never);
    expect((await POST(post(validBody))).status).toBe(503);
    const noBoard = createMock({ boardError: { message: "boom" } });
    vi.mocked(getSupabaseServerClient).mockReturnValue(noBoard.client as never);
    expect((await GET(get())).status).toBe(503);
  });

  it("sperrt gesperrte Spieler", async () => {
    const mock = createMock();
    vi.mocked(getSupabaseServerClient).mockReturnValue(mock.client as never);
    vi.mocked(assertFredRunAccessAllowed).mockRejectedValue(new FredRunAccessBlockedServerError("Gesperrt"));
    const res = await POST(post(validBody));
    expect(res.status).toBe(403);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});
