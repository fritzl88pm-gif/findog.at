import {
  FREDRUN_FINANZAMT_NIGHT_PRICE,
  FREDRUN_WORLDS,
  FREDRUN_WORLD_IDS,
  type FredRunWorldId,
} from "./fredrun-worlds";

export { FREDRUN_FINANZAMT_NIGHT_PRICE } from "./fredrun-worlds";

export const FREDRUN_PROFILE_KEY = "findog.fredrun.profile.v1";
export const FREDRUN_SUPERFRED_PRICE = 1_000;

export const FREDRUN_CHARACTER_IDS = ["fred", "frida", "superfred"] as const;

export type FredRunCharacterId = (typeof FREDRUN_CHARACTER_IDS)[number];

export type FredRunCharacterDefinition = {
  name: string;
  description: string;
  price: number;
};

export const FREDRUN_CHARACTERS: Record<FredRunCharacterId, FredRunCharacterDefinition> = {
  fred: { name: "Fred", description: "Der blaue Findog-Klassiker", price: 0 },
  frida: { name: "Frida", description: "Pink, klug und voller Energie", price: 0 },
  superfred: { name: "Superfred", description: "Mit Cape und Extrapower", price: FREDRUN_SUPERFRED_PRICE },
};

export type FredRunProfile = {
  coinBalance: number;
  unlockedCharacters: FredRunCharacterId[];
  selectedCharacter: FredRunCharacterId;
  unlockedWorlds: FredRunWorldId[];
  selectedWorld: FredRunWorldId;
  lastSettledRunId: string | null;
};

export type FredRunProfileStorage = Pick<Storage, "getItem" | "setItem">;

export type FredRunProfileReadResult = {
  profile: FredRunProfile;
  storageAvailable: boolean;
};

export type FredRunPurchaseStatus = "purchased" | "already-owned" | "insufficient-funds";

export type FredRunPurchaseResult = {
  profile: FredRunProfile;
  status: FredRunPurchaseStatus;
};

export type FredRunSettlementResult = {
  profile: FredRunProfile;
  awardedCoins: number;
};

const DEFAULT_UNLOCKED_CHARACTERS: FredRunCharacterId[] = ["fred", "frida"];
const DEFAULT_UNLOCKED_WORLDS: FredRunWorldId[] = ["vienna"];

export function createDefaultFredRunProfile(): FredRunProfile {
  return {
    coinBalance: 0,
    unlockedCharacters: [...DEFAULT_UNLOCKED_CHARACTERS],
    selectedCharacter: "fred",
    unlockedWorlds: [...DEFAULT_UNLOCKED_WORLDS],
    selectedWorld: "vienna",
    lastSettledRunId: null,
  };
}

function isFredRunCharacterId(value: unknown): value is FredRunCharacterId {
  return typeof value === "string" && FREDRUN_CHARACTER_IDS.includes(value as FredRunCharacterId);
}

function isFredRunWorldId(value: unknown): value is FredRunWorldId {
  return typeof value === "string" && FREDRUN_WORLD_IDS.includes(value as FredRunWorldId);
}

export function isFredRunCharacterUnlocked(
  profile: FredRunProfile,
  characterId: FredRunCharacterId,
): boolean {
  return profile.unlockedCharacters.includes(characterId);
}

export function isFredRunWorldUnlocked(
  profile: FredRunProfile,
  worldId: FredRunWorldId,
): boolean {
  return profile.unlockedWorlds.includes(worldId);
}

export function normalizeFredRunProfile(value: unknown): FredRunProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createDefaultFredRunProfile();
  }

  const candidate = value as Record<string, unknown>;
  const coinBalance = Number.isSafeInteger(candidate.coinBalance) && Number(candidate.coinBalance) >= 0
    ? Number(candidate.coinBalance)
    : 0;
  const storedUnlocked = Array.isArray(candidate.unlockedCharacters)
    ? candidate.unlockedCharacters.filter(isFredRunCharacterId)
    : [];
  const unlockedCharacters = FREDRUN_CHARACTER_IDS.filter((characterId) => (
    DEFAULT_UNLOCKED_CHARACTERS.includes(characterId) || storedUnlocked.includes(characterId)
  ));
  const selectedCharacter = isFredRunCharacterId(candidate.selectedCharacter)
    && unlockedCharacters.includes(candidate.selectedCharacter)
    ? candidate.selectedCharacter
    : "fred";
  const storedUnlockedWorlds = Array.isArray(candidate.unlockedWorlds)
    ? candidate.unlockedWorlds.filter(isFredRunWorldId)
    : [];
  const unlockedWorlds = FREDRUN_WORLD_IDS.filter((worldId) => (
    DEFAULT_UNLOCKED_WORLDS.includes(worldId) || storedUnlockedWorlds.includes(worldId)
  ));
  const selectedWorld = isFredRunWorldId(candidate.selectedWorld)
    && unlockedWorlds.includes(candidate.selectedWorld)
    ? candidate.selectedWorld
    : "vienna";
  const lastSettledRunId = typeof candidate.lastSettledRunId === "string"
    && candidate.lastSettledRunId.length > 0
    && candidate.lastSettledRunId.length <= 128
    ? candidate.lastSettledRunId
    : null;

  return {
    coinBalance,
    unlockedCharacters,
    selectedCharacter,
    unlockedWorlds,
    selectedWorld,
    lastSettledRunId,
  };
}

export function readFredRunProfile(
  storage: FredRunProfileStorage | null | undefined,
): FredRunProfileReadResult {
  if (!storage) {
    return { profile: createDefaultFredRunProfile(), storageAvailable: false };
  }
  try {
    const stored = storage.getItem(FREDRUN_PROFILE_KEY);
    const profile = stored
      ? normalizeFredRunProfile(JSON.parse(stored) as unknown)
      : createDefaultFredRunProfile();
    if (stored) {
      try {
        storage.setItem(FREDRUN_PROFILE_KEY, JSON.stringify(profile));
      } catch {
        return { profile, storageAvailable: false };
      }
    }
    return { profile, storageAvailable: true };
  } catch {
    return { profile: createDefaultFredRunProfile(), storageAvailable: false };
  }
}

export function writeFredRunProfile(
  storage: FredRunProfileStorage | null | undefined,
  profile: FredRunProfile,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(FREDRUN_PROFILE_KEY, JSON.stringify(normalizeFredRunProfile(profile)));
    return true;
  } catch {
    return false;
  }
}

export function selectFredRunCharacter(
  profile: FredRunProfile,
  characterId: FredRunCharacterId,
): FredRunProfile {
  if (!isFredRunCharacterUnlocked(profile, characterId) || profile.selectedCharacter === characterId) {
    return profile;
  }
  return { ...profile, selectedCharacter: characterId };
}

export function selectFredRunWorld(
  profile: FredRunProfile,
  worldId: FredRunWorldId,
): FredRunProfile {
  if (!isFredRunWorldUnlocked(profile, worldId) || profile.selectedWorld === worldId) {
    return profile;
  }
  return { ...profile, selectedWorld: worldId };
}

export function purchaseFredRunCharacter(
  profile: FredRunProfile,
  characterId: FredRunCharacterId,
): FredRunPurchaseResult {
  if (isFredRunCharacterUnlocked(profile, characterId)) {
    return { profile, status: "already-owned" };
  }
  const price = FREDRUN_CHARACTERS[characterId].price;
  if (profile.coinBalance < price) {
    return { profile, status: "insufficient-funds" };
  }
  return {
    status: "purchased",
    profile: {
      ...profile,
      coinBalance: profile.coinBalance - price,
      unlockedCharacters: FREDRUN_CHARACTER_IDS.filter((id) => (
        profile.unlockedCharacters.includes(id) || id === characterId
      )),
      selectedCharacter: characterId,
    },
  };
}

export function purchaseFredRunWorld(
  profile: FredRunProfile,
  worldId: FredRunWorldId,
): FredRunPurchaseResult {
  if (isFredRunWorldUnlocked(profile, worldId)) {
    return { profile, status: "already-owned" };
  }
  const price = FREDRUN_WORLDS[worldId].price;
  if (profile.coinBalance < price) {
    return { profile, status: "insufficient-funds" };
  }
  return {
    status: "purchased",
    profile: {
      ...profile,
      coinBalance: profile.coinBalance - price,
      unlockedWorlds: FREDRUN_WORLD_IDS.filter((id) => (
        profile.unlockedWorlds.includes(id) || id === worldId
      )),
      selectedWorld: worldId,
    },
  };
}

export function settleFredRunCoins(
  profile: FredRunProfile,
  runId: string | null | undefined,
  collectedCoins: number,
): FredRunSettlementResult {
  if (!runId || profile.lastSettledRunId === runId) {
    return { profile, awardedCoins: 0 };
  }
  const requestedCoins = Number.isSafeInteger(collectedCoins) && collectedCoins >= 0 ? collectedCoins : 0;
  const nextBalance = Math.min(Number.MAX_SAFE_INTEGER, profile.coinBalance + requestedCoins);
  return {
    awardedCoins: nextBalance - profile.coinBalance,
    profile: {
      ...profile,
      coinBalance: nextBalance,
      lastSettledRunId: runId,
    },
  };
}
