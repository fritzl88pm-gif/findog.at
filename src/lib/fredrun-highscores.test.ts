import { describe, expect, it } from "vitest";

import {
  FREDRUN_PLAYER_NAME_MAX_LENGTH,
  normalizeFredRunLeaderboardRows,
  normalizeFredRunPlayerName,
  parseFredRunHighscoresResponse,
  parseFredRunScoreSubmission,
} from "./fredrun-highscores";

describe("Fredrun highscore validation", () => {
  it("normalizes bounded public player names", () => {
    expect(normalizeFredRunPlayerName("  Fred   Runner  ")).toBe("Fred Runner");
    expect(normalizeFredRunPlayerName("x".repeat(FREDRUN_PLAYER_NAME_MAX_LENGTH))).toHaveLength(20);
    expect(normalizeFredRunPlayerName("x".repeat(FREDRUN_PLAYER_NAME_MAX_LENGTH + 1))).toBeNull();
    expect(normalizeFredRunPlayerName("Fred\u0000Runner")).toBeNull();
    expect(normalizeFredRunPlayerName("   ")).toBeNull();
  });

  it("accepts only complete, bounded score submissions", () => {
    expect(parseFredRunScoreSubmission({
      runId: "123e4567-e89b-42d3-a456-426614174000",
      name: "  Fredi  ",
      score: 250,
    })).toEqual({
      runId: "123e4567-e89b-42d3-a456-426614174000",
      name: "Fredi",
      score: 250,
    });
    expect(parseFredRunScoreSubmission({ runId: "invalid", name: "Fredi", score: 2 })).toBeNull();
    expect(parseFredRunScoreSubmission({
      runId: "123e4567-e89b-42d3-a456-426614174000",
      name: "Fredi",
      score: 1_000_001,
    })).toBeNull();
  });

  it("maps only valid rows to ten ranked public entries", () => {
    const rows = [
      { score: 500, fredrun_player_profiles: { player_name: "Anna" } },
      { score: 450, fredrun_player_profiles: [{ player_name: "Berta" }] },
      { score: -1, fredrun_player_profiles: { player_name: "Ungültig" } },
      ...Array.from({ length: 12 }, (_, index) => ({
        score: 400 - index,
        fredrun_player_profiles: { player_name: `Spieler ${index}` },
      })),
    ];
    const entries = normalizeFredRunLeaderboardRows(rows);
    expect(entries).toHaveLength(10);
    expect(entries[0]).toEqual({ rank: 1, name: "Anna", score: 500 });
    expect(entries[1]).toEqual({ rank: 2, name: "Berta", score: 450 });
    expect(entries.at(-1)?.rank).toBe(10);
  });

  it("accepts the public API response and preserves an empty optional alias", () => {
    expect(parseFredRunHighscoresResponse({
      entries: [
        { rank: 1, name: "Fred", score: 120 },
        { rank: 2, name: "Odo", score: 95 },
      ],
      playerName: "",
      submitted: true,
    })).toEqual({
      entries: [
        { rank: 1, name: "Fred", score: 120 },
        { rank: 2, name: "Odo", score: 95 },
      ],
      playerName: "",
      submitted: true,
    });
  });

  it("rejects malformed public API responses", () => {
    expect(parseFredRunHighscoresResponse({
      entries: [{ rank: 2, name: "Fred", score: 120 }],
      playerName: "Fred",
    })).toBeNull();
    expect(parseFredRunHighscoresResponse({
      entries: [{ rank: 1, name: " Fred ", score: 120 }],
      playerName: "Fred",
    })).toBeNull();
    expect(parseFredRunHighscoresResponse({
      entries: [{ rank: 1, name: "Fred", score: 1_000_001 }],
      playerName: "Fred",
    })).toBeNull();
    expect(parseFredRunHighscoresResponse({
      entries: Array.from({ length: 11 }, (_, index) => ({ rank: index + 1, name: "Fred", score: 1 })),
      playerName: "Fred",
    })).toBeNull();
  });
});
