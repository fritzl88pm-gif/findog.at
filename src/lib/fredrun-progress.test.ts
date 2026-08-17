import { describe, expect, it } from "vitest";

import {
  parseFredRunProgressAction,
  parseFredRunProgressApiResponse,
  parseFredRunServerProgress,
} from "./fredrun-progress";

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

describe("FredRun server progress", () => {
  it("parses a complete, user-owned server profile", () => {
    expect(parseFredRunServerProgress(storedProgress)).toEqual({
      profile: {
        coinBalance: 725,
        unlockedCharacters: ["fred", "frida", "superfred"],
        selectedCharacter: "superfred",
        unlockedWorlds: ["vienna", "finanzamt-night"],
        selectedWorld: "finanzamt-night",
        lastSettledRunId: "123e4567-e89b-42d3-a456-426614174000",
      },
      bestScore: 12_500,
      version: 7,
      updatedAt: "2026-08-17T08:00:00.000Z",
    });
  });

  it("rejects incomplete, duplicated, or internally inconsistent progress", () => {
    expect(parseFredRunServerProgress({ ...storedProgress, unlockedCharacters: ["fred"] })).toBeNull();
    expect(parseFredRunServerProgress({ ...storedProgress, unlockedWorlds: ["vienna", "vienna"] })).toBeNull();
    expect(parseFredRunServerProgress({ ...storedProgress, selectedWorld: "vienna", version: 0 })).toBeNull();
    expect(parseFredRunServerProgress({ ...storedProgress, bestScore: 1_000_001 })).toBeNull();
  });

  it("parses only bounded settlement, purchase, and selection actions", () => {
    expect(parseFredRunProgressAction({
      action: "settle_run",
      runId: "123e4567-e89b-42d3-a456-426614174000",
      collectedCoins: 14,
      score: 420,
    })).toMatchObject({ action: "settle_run", collectedCoins: 14, score: 420 });
    expect(parseFredRunProgressAction({
      action: "purchase",
      itemType: "character",
      itemId: "superfred",
    })).toEqual({ action: "purchase", itemType: "character", itemId: "superfred" });
    expect(parseFredRunProgressAction({
      action: "select",
      itemType: "world",
      itemId: "finanzamt-night",
    })).toEqual({ action: "select", itemType: "world", itemId: "finanzamt-night" });
    expect(parseFredRunProgressAction({
      action: "settle_run",
      runId: "not-a-uuid",
      collectedCoins: 1,
      score: 1,
    })).toBeNull();
    expect(parseFredRunProgressAction({
      action: "purchase",
      itemType: "world",
      itemId: "superfred",
    })).toBeNull();
  });

  it("validates the sanitized API envelope", () => {
    const progress = parseFredRunServerProgress(storedProgress);
    expect(parseFredRunProgressApiResponse({
      progress,
      status: "settled",
      awardedCoins: 14,
    })).toEqual({ progress, status: "settled", awardedCoins: 14 });
    expect(parseFredRunProgressApiResponse({
      progress,
      status: "invented",
      awardedCoins: 14,
    })).toBeNull();
  });
});
