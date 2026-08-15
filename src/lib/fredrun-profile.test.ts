import { describe, expect, it } from "vitest";

import {
  FREDRUN_PROFILE_KEY,
  FREDRUN_SUPERFRED_PRICE,
  createDefaultFredRunProfile,
  normalizeFredRunProfile,
  purchaseFredRunCharacter,
  readFredRunProfile,
  selectFredRunCharacter,
  settleFredRunCoins,
  writeFredRunProfile,
} from "./fredrun-profile";

describe("Fredrun local profile", () => {
  it("starts with Fred and Frida unlocked and no coins", () => {
    expect(createDefaultFredRunProfile()).toEqual({
      coinBalance: 0,
      unlockedCharacters: ["fred", "frida"],
      selectedCharacter: "fred",
      lastSettledRunId: null,
    });
  });

  it("repairs malformed data and never locks the free characters", () => {
    expect(normalizeFredRunProfile({
      coinBalance: -20,
      unlockedCharacters: ["superfred", "unknown", "superfred"],
      selectedCharacter: "unknown",
      lastSettledRunId: 42,
    })).toEqual({
      coinBalance: 0,
      unlockedCharacters: ["fred", "frida", "superfred"],
      selectedCharacter: "fred",
      lastSettledRunId: null,
    });
  });

  it("loads and writes a validated v1 profile", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const profile = { ...createDefaultFredRunProfile(), coinBalance: 250, selectedCharacter: "frida" as const };
    expect(writeFredRunProfile(storage, profile)).toBe(true);
    expect(readFredRunProfile(storage)).toEqual({ profile, storageAvailable: true });
    expect(JSON.parse(values.get(FREDRUN_PROFILE_KEY) ?? "{}")).toMatchObject({ coinBalance: 250 });
  });

  it("falls back safely when local storage is blocked or corrupt", () => {
    const blocked = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    expect(readFredRunProfile(blocked)).toEqual({
      profile: createDefaultFredRunProfile(),
      storageAvailable: false,
    });
    expect(writeFredRunProfile(blocked, createDefaultFredRunProfile())).toBe(false);
    expect(readFredRunProfile({ getItem: () => "not-json", setItem: () => undefined }).storageAvailable).toBe(false);
  });
});

describe("Fredrun character economy", () => {
  it("does not select a locked character", () => {
    const profile = createDefaultFredRunProfile();
    expect(selectFredRunCharacter(profile, "superfred")).toBe(profile);
    expect(selectFredRunCharacter(profile, "frida").selectedCharacter).toBe("frida");
  });

  it("requires 1000 coins and buys Superfred exactly once", () => {
    const insufficient = purchaseFredRunCharacter({
      ...createDefaultFredRunProfile(),
      coinBalance: FREDRUN_SUPERFRED_PRICE - 1,
    }, "superfred");
    expect(insufficient.status).toBe("insufficient-funds");

    const purchased = purchaseFredRunCharacter({
      ...createDefaultFredRunProfile(),
      coinBalance: FREDRUN_SUPERFRED_PRICE,
    }, "superfred");
    expect(purchased).toMatchObject({
      status: "purchased",
      profile: {
        coinBalance: 0,
        unlockedCharacters: ["fred", "frida", "superfred"],
        selectedCharacter: "superfred",
      },
    });
    expect(purchaseFredRunCharacter(purchased.profile, "superfred")).toEqual({
      status: "already-owned",
      profile: purchased.profile,
    });
  });

  it("settles a completed run once and ignores invalid rewards", () => {
    const first = settleFredRunCoins(createDefaultFredRunProfile(), "run-1", 14);
    expect(first).toMatchObject({ awardedCoins: 14, profile: { coinBalance: 14, lastSettledRunId: "run-1" } });
    expect(settleFredRunCoins(first.profile, "run-1", 14)).toEqual({ profile: first.profile, awardedCoins: 0 });
    expect(settleFredRunCoins(first.profile, "run-2", -5)).toMatchObject({
      awardedCoins: 0,
      profile: { coinBalance: 14, lastSettledRunId: "run-2" },
    });
    expect(settleFredRunCoins(first.profile, null, 99)).toEqual({ profile: first.profile, awardedCoins: 0 });
  });
});
