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

export function createDefaultFredRunProfile(): FredRunProfile {
  return {
    coinBalance: 0,
    unlockedCharacters: [...DEFAULT_UNLOCKED_CHARACTERS],
    selectedCharacter: "fred",
    lastSettledRunId: null,
  };
}

function isFredRunCharacterId(value: unknown): value is FredRunCharacterId {
  return typeof value === "string" && FREDRUN_CHARACTER_IDS.includes(value as FredRunCharacterId);
}

export function isFredRunCharacterUnlocked(
  profile: FredRunProfile,
  characterId: FredRunCharacterId,
): boolean {
  return profile.unlockedCharacters.includes(characterId);
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
  const lastSettledRunId = typeof candidate.lastSettledRunId === "string"
    && candidate.lastSettledRunId.length > 0
    && candidate.lastSettledRunId.length <= 128
    ? candidate.lastSettledRunId
    : null;

  return {
    coinBalance,
    unlockedCharacters,
    selectedCharacter,
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
    return {
      profile: stored ? normalizeFredRunProfile(JSON.parse(stored) as unknown) : createDefaultFredRunProfile(),
      storageAvailable: true,
    };
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
