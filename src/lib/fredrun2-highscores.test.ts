import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  FREDRUN2_LEADERBOARD_LIMIT,
  isFredRun2Board,
  normalizeFredRun2Name,
  normalizeFredRun2Rows,
  parseFredRun2BoardResponse,
  parseFredRun2Submission,
  splitFredRun2Rows,
} from "./fredrun2-highscores";

const NOW = new Date("2026-09-30T12:00:00Z");
const RUN = "123e4567-e89b-42d3-a456-426614174000";

describe("Fredrun-2-Boards", () => {
  it("akzeptiert Welt-, Weltreise- und Tages-Boards von heute ±1 Tag", () => {
    for (const b of ["world:wien", "world:oper", "world:winter", "tour", "daily:2026-09-30", "daily:2026-09-29", "daily:2026-10-01"]) {
      expect(isFredRun2Board(b, NOW), b).toBe(true);
    }
  });
  it("lehnt alles andere ab", () => {
    for (const b of ["", "world:", "world:mars", "WORLD:wien", "daily:2026-09-27", "daily:2026-02-30", "daily:2026-9-30", "tour ", null, 5, undefined]) {
      expect(isFredRun2Board(b, NOW), String(b)).toBe(false);
    }
  });
});

describe("Namen und Einreichungen", () => {
  it("normalisiert Namen (16 Zeichen, keine Steuerzeichen)", () => {
    expect(normalizeFredRun2Name("  Fredi   der  Hund ")).toBe("Fredi der Hund");
    expect(normalizeFredRun2Name("x".repeat(17))).toBeNull();
    expect(normalizeFredRun2Name("a\u0007b")).toBeNull();
    expect(normalizeFredRun2Name("   ")).toBeNull();
  });
  const ok = { board: "world:wien", runId: RUN, name: "Fredi", score: 1234, meters: 300, character: "cyberfred" };
  it("parst gültige Einreichungen (Name optional)", () => {
    expect(parseFredRun2Submission(ok, NOW)).toEqual(ok);
    expect(parseFredRun2Submission({ ...ok, name: undefined }, NOW)?.name).toBe("");
  });
  it("lehnt ungültige Werte ab", () => {
    for (const bad of [{ ...ok, score: -1 }, { ...ok, score: 0.5 }, { ...ok, score: 100_000_001 }, { ...ok, meters: 1e9 }, { ...ok, runId: "nope" }, { ...ok, board: "world:x" }, { ...ok, character: "x" }, null, [], "s"]) {
      expect(parseFredRun2Submission(bad, NOW)).toBeNull();
    }
  });
});

describe("Zeilen und Antworten", () => {
  const row = (rank: number, name = "Anna", is_me = false) => ({ rank, player_name: name, score: 100 - rank, meters: 10, hero: "fred", is_me });
  it("übernimmt gültige Zeilen und verwirft kaputte", () => {
    const out = normalizeFredRun2Rows([row(1), { ...row(2), score: -4 }, { ...row(3), hero: "x" }, { ...row(4), player_name: "" }, row(5, "Zed", true)]);
    expect(out.map((e) => [e.rank, e.name, e.me])).toEqual([[1, "Anna", false], [5, "Zed", true]]);
  });
  it("trennt Top-Liste und eigenen Platz", () => {
    const rows = normalizeFredRun2Rows([row(1), row(FREDRUN2_LEADERBOARD_LIMIT + 6, "Ich", true)]);
    const { top, me } = splitFredRun2Rows(rows);
    expect(top).toHaveLength(1);
    expect(me).toEqual({ rank: FREDRUN2_LEADERBOARD_LIMIT + 6, score: 100 - (FREDRUN2_LEADERBOARD_LIMIT + 6) });
  });
  it("parst Antworten der API und lehnt Formfehler ab", () => {
    const body = { board: "tour", entries: [{ rank: 1, name: "Anna", score: 9, meters: 2, character: "fred", me: true }], me: { rank: 1, score: 9 }, playerName: "Anna", submitted: true };
    expect(parseFredRun2BoardResponse(body)?.entries[0]).toMatchObject({ name: "Anna", me: true });
    expect(parseFredRun2BoardResponse({ ...body, entries: [{ ...body.entries[0], score: "9" }] })).toBeNull();
    expect(parseFredRun2BoardResponse({ ...body, playerName: 5 })).toBeNull();
    expect(parseFredRun2BoardResponse(null)).toBeNull();
  });
});

describe("Migration", () => {
  const sql = readFileSync("supabase/migrations/20260930120000_fredrun2_global_scores.sql", "utf8");
  it("ist additiv und fasst die Original-Tabellen nicht an", () => {
    expect(sql).not.toMatch(/\b(delete from|truncate|drop (table|function|index)|disable trigger)\b/i);
    expect(sql).not.toMatch(/(update|alter table) public\.fredrun_(scores|user_progress|user_unlocks|user_blocks)/i);
    expect(sql).toMatch(/create table public\.fredrun2_scores/);
  });
  it("schränkt Zugriff auf service_role ein und aktiviert RLS", () => {
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/revoke all on table public\.fredrun2_scores from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.get_fredrun2_leaderboard\(text, uuid, integer\)\s+to service_role/);
    expect(sql).toMatch(/grant execute on function public\.submit_fredrun2_score\(uuid, uuid, text, text, integer, integer, text\)\s+to service_role/);
  });
});
