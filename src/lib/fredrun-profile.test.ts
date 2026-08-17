import { describe, expect, it } from "vitest";

import {
  FREDRUN_FINANZAMT_NIGHT_PRICE,
  FREDRUN_CYBERFRED_PRICE,
  FREDRUN_PROFILE_KEY,
  FREDRUN_SUPERFRED_PRICE,
  createDefaultFredRunProfile,
  normalizeFredRunProfile,
  purchaseFredRunCharacter,
  purchaseFredRunWorld,
  readFredRunProfile,
  selectFredRunCharacter,
  selectFredRunWorld,
  settleFredRunCoins,
  writeFredRunProfile,
  type FredRunProfile,
} from "./fredrun-profile";

describe("Fredrun local profile", () => {
  it("starts with Fred and Frida unlocked and no coins", () => {
    expect(createDefaultFredRunProfile()).toEqual({
      coinBalance: 0,
      unlockedCharacters: ["fred", "frida"],
      selectedCharacter: "fred",
      unlockedWorlds: ["vienna"],
      selectedWorld: "vienna",
      lastSettledRunId: null,
    });
  });

  it("normalizes an old v1 profile to Vienna without losing existing progress", () => {
    expect(normalizeFredRunProfile({
      coinBalance: 725,
      unlockedCharacters: ["fred", "frida", "superfred"],
      selectedCharacter: "superfred",
      lastSettledRunId: "settled-v1-run",
    })).toEqual({
      coinBalance: 725,
      unlockedCharacters: ["fred", "frida", "superfred"],
      selectedCharacter: "superfred",
      unlockedWorlds: ["vienna"],
      selectedWorld: "vienna",
      lastSettledRunId: "settled-v1-run",
    });
  });

  it("migrates a stored old v1 profile in place on read", () => {
    const values = new Map<string, string>([[FREDRUN_PROFILE_KEY, JSON.stringify({
      coinBalance: 725,
      unlockedCharacters: ["fred", "frida", "superfred"],
      selectedCharacter: "superfred",
      lastSettledRunId: "settled-v1-run",
    })]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    const result = readFredRunProfile(storage);
    expect(result.storageAvailable).toBe(true);
    expect(JSON.parse(values.get(FREDRUN_PROFILE_KEY) ?? "{}")).toEqual(result.profile);
    expect(result.profile).toMatchObject({
      coinBalance: 725,
      unlockedCharacters: ["fred", "frida", "superfred"],
      selectedCharacter: "superfred",
      unlockedWorlds: ["vienna"],
      selectedWorld: "vienna",
      lastSettledRunId: "settled-v1-run",
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
      unlockedWorlds: ["vienna"],
      selectedWorld: "vienna",
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

describe("Fredrun world economy", () => {
  it("rejects insufficient funds without changing the profile", () => {
    const profile = {
      ...createDefaultFredRunProfile(),
      coinBalance: FREDRUN_FINANZAMT_NIGHT_PRICE - 1,
    };
    expect(purchaseFredRunWorld(profile, "finanzamt-night")).toEqual({
      status: "insufficient-funds",
      profile,
    });
  });

  it("deducts exactly 500 coins, unlocks, and selects Finanzamt exactly once", () => {
    const purchased = purchaseFredRunWorld({
      ...createDefaultFredRunProfile(),
      coinBalance: 725,
    }, "finanzamt-night");

    expect(FREDRUN_FINANZAMT_NIGHT_PRICE).toBe(500);
    expect(purchased).toMatchObject({
      status: "purchased",
      profile: {
        coinBalance: 225,
        unlockedWorlds: ["vienna", "finanzamt-night"],
        selectedWorld: "finanzamt-night",
      },
    });
    expect(purchaseFredRunWorld(purchased.profile, "finanzamt-night")).toEqual({
      status: "already-owned",
      profile: purchased.profile,
    });
  });

  it("cannot select a locked world and can select an unlocked world", () => {
    const locked = createDefaultFredRunProfile();
    expect(selectFredRunWorld(locked, "finanzamt-night")).toBe(locked);

    const unlocked: FredRunProfile = {
      ...locked,
      unlockedWorlds: ["vienna", "finanzamt-night"],
    };
    expect(selectFredRunWorld(unlocked, "finanzamt-night")).toMatchObject({
      selectedWorld: "finanzamt-night",
      coinBalance: 0,
    });
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

  it("requires 2000 coins and buys Cyberfred exactly once", () => {
    const insufficient = purchaseFredRunCharacter({
      ...createDefaultFredRunProfile(),
      coinBalance: FREDRUN_CYBERFRED_PRICE - 1,
    }, "cyberfred");
    expect(insufficient.status).toBe("insufficient-funds");

    const purchased = purchaseFredRunCharacter({
      ...createDefaultFredRunProfile(),
      coinBalance: FREDRUN_CYBERFRED_PRICE,
    }, "cyberfred");
    expect(purchased).toMatchObject({
      status: "purchased",
      profile: {
        coinBalance: 0,
        unlockedCharacters: ["fred", "frida", "cyberfred"],
        selectedCharacter: "cyberfred",
      },
    });
    expect(purchaseFredRunCharacter(purchased.profile, "cyberfred")).toEqual({
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
