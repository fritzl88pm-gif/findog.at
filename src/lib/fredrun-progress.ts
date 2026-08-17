import {
  FREDRUN_CHARACTER_IDS,
  normalizeFredRunProfile,
  type FredRunCharacterId,
  type FredRunProfile,
} from "./fredrun-profile";
import { FREDRUN_WORLD_IDS, type FredRunWorldId } from "./fredrun-worlds";

export const FREDRUN_PROGRESS_MAX_COINS_PER_RUN = 1_000_000;
export const FREDRUN_PROGRESS_MAX_SCORE = 1_000_000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type FredRunProgressItemType = "character" | "world";

export type FredRunProgressAction =
  | {
    action: "settle_run";
    runId: string;
    collectedCoins: number;
    score: number;
  }
  | {
    action: "purchase" | "select";
    itemType: "character";
    itemId: FredRunCharacterId;
  }
  | {
    action: "purchase" | "select";
    itemType: "world";
    itemId: FredRunWorldId;
  };

export type FredRunProgressMutationStatus =
  | "settled"
  | "already-settled"
  | "purchased"
  | "already-owned"
  | "insufficient-funds"
  | "selected"
  | "locked"
  | "unchanged";

export type FredRunServerProgress = {
  profile: FredRunProfile;
  bestScore: number;
  version: number;
  updatedAt: string;
};

export type FredRunProgressApiResponse = {
  progress: FredRunServerProgress;
  status?: FredRunProgressMutationStatus;
  awardedCoins: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isCharacterId(value: unknown): value is FredRunCharacterId {
  return typeof value === "string"
    && FREDRUN_CHARACTER_IDS.includes(value as FredRunCharacterId);
}

function isWorldId(value: unknown): value is FredRunWorldId {
  return typeof value === "string"
    && FREDRUN_WORLD_IDS.includes(value as FredRunWorldId);
}

function uniqueArray<T extends string>(
  value: unknown,
  guard: (entry: unknown) => entry is T,
): T[] | null {
  if (!Array.isArray(value) || !value.every(guard)) return null;
  const unique = [...new Set(value)];
  return unique.length === value.length ? unique : null;
}

function isBoundedInteger(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
}

export function parseFredRunProgressAction(value: unknown): FredRunProgressAction | null {
  const candidate = record(value);
  if (!candidate) return null;

  if (candidate.action === "settle_run") {
    return typeof candidate.runId === "string"
      && UUID_PATTERN.test(candidate.runId)
      && isBoundedInteger(candidate.collectedCoins, FREDRUN_PROGRESS_MAX_COINS_PER_RUN)
      && isBoundedInteger(candidate.score, FREDRUN_PROGRESS_MAX_SCORE)
      ? {
        action: "settle_run",
        runId: candidate.runId,
        collectedCoins: candidate.collectedCoins,
        score: candidate.score,
      }
      : null;
  }

  if (candidate.action !== "purchase" && candidate.action !== "select") return null;
  if (candidate.itemType === "character" && isCharacterId(candidate.itemId)) {
    return {
      action: candidate.action,
      itemType: "character",
      itemId: candidate.itemId,
    };
  }
  if (candidate.itemType === "world" && isWorldId(candidate.itemId)) {
    return {
      action: candidate.action,
      itemType: "world",
      itemId: candidate.itemId,
    };
  }
  return null;
}

export function parseFredRunServerProgress(value: unknown): FredRunServerProgress | null {
  const candidate = record(value);
  if (!candidate) return null;

  const unlockedCharacters = uniqueArray(candidate.unlockedCharacters, isCharacterId);
  const unlockedWorlds = uniqueArray(candidate.unlockedWorlds, isWorldId);
  if (
    !isBoundedInteger(candidate.coinBalance, 1_000_000_000)
    || !isBoundedInteger(candidate.bestScore, FREDRUN_PROGRESS_MAX_SCORE)
    || !unlockedCharacters
    || !unlockedCharacters.includes("fred")
    || !unlockedCharacters.includes("frida")
    || !unlockedWorlds
    || !unlockedWorlds.includes("vienna")
    || !isCharacterId(candidate.selectedCharacter)
    || !unlockedCharacters.includes(candidate.selectedCharacter)
    || !isWorldId(candidate.selectedWorld)
    || !unlockedWorlds.includes(candidate.selectedWorld)
    || !(candidate.lastSettledRunId === null
      || (typeof candidate.lastSettledRunId === "string" && UUID_PATTERN.test(candidate.lastSettledRunId)))
    || !Number.isSafeInteger(candidate.version)
    || Number(candidate.version) < 1
    || typeof candidate.updatedAt !== "string"
    || Number.isNaN(Date.parse(candidate.updatedAt))
  ) {
    return null;
  }

  return {
    profile: normalizeFredRunProfile({
      coinBalance: candidate.coinBalance,
      unlockedCharacters,
      selectedCharacter: candidate.selectedCharacter,
      unlockedWorlds,
      selectedWorld: candidate.selectedWorld,
      lastSettledRunId: candidate.lastSettledRunId,
    }),
    bestScore: candidate.bestScore,
    version: Number(candidate.version),
    updatedAt: candidate.updatedAt,
  };
}

export function parseFredRunProgressApiResponse(value: unknown): FredRunProgressApiResponse | null {
  const candidate = record(value);
  if (!candidate) return null;
  const progressCandidate = record(candidate.progress);
  const profileCandidate = record(progressCandidate?.profile);
  const progress = progressCandidate && profileCandidate
    ? parseFredRunServerProgress({
      ...profileCandidate,
      bestScore: progressCandidate.bestScore,
      version: progressCandidate.version,
      updatedAt: progressCandidate.updatedAt,
    })
    : null;
  const statuses: FredRunProgressMutationStatus[] = [
    "settled",
    "already-settled",
    "purchased",
    "already-owned",
    "insufficient-funds",
    "selected",
    "locked",
    "unchanged",
  ];
  const status = candidate.status === undefined
    ? undefined
    : typeof candidate.status === "string"
      && statuses.includes(candidate.status as FredRunProgressMutationStatus)
      ? candidate.status as FredRunProgressMutationStatus
      : null;
  if (
    !progress
    || status === null
    || !isBoundedInteger(candidate.awardedCoins, FREDRUN_PROGRESS_MAX_COINS_PER_RUN)
  ) {
    return null;
  }
  return { progress, status, awardedCoins: candidate.awardedCoins };
}
