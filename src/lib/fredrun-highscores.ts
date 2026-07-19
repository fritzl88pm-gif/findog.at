export const FREDRUN_PLAYER_NAME_MAX_LENGTH = 20;
export const FREDRUN_SCORE_MAX = 1_000_000;
export const FREDRUN_LEADERBOARD_LIMIT = 10;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export type FredRunLeaderboardEntry = {
  rank: number;
  name: string;
  score: number;
};

export type FredRunHighscoresResponse = {
  entries: FredRunLeaderboardEntry[];
  playerName: string;
  submitted?: boolean;
};

export type FredRunScoreSubmission = {
  runId: string;
  name: string;
  score: number;
};

export function normalizeFredRunPlayerName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (
    !normalized
    || Array.from(normalized).length > FREDRUN_PLAYER_NAME_MAX_LENGTH
    || CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function parseFredRunScoreSubmission(value: unknown): FredRunScoreSubmission | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const name = normalizeFredRunPlayerName(candidate.name);
  if (
    !name
    || typeof candidate.runId !== "string"
    || !UUID_PATTERN.test(candidate.runId)
    || typeof candidate.score !== "number"
    || !Number.isSafeInteger(candidate.score)
    || candidate.score < 0
    || candidate.score > FREDRUN_SCORE_MAX
  ) {
    return null;
  }
  return { runId: candidate.runId, name, score: candidate.score };
}

type FredRunScoreRow = {
  id?: unknown;
  score?: unknown;
  fredrun_player_profiles?: unknown;
};

export function normalizeFredRunLeaderboardRows(value: unknown): FredRunLeaderboardEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((rowValue) => {
    if (!rowValue || typeof rowValue !== "object" || Array.isArray(rowValue)) return [];
    const row = rowValue as FredRunScoreRow;
    const relation = Array.isArray(row.fredrun_player_profiles)
      ? row.fredrun_player_profiles[0]
      : row.fredrun_player_profiles;
    const rawName = relation && typeof relation === "object" && !Array.isArray(relation)
      ? (relation as Record<string, unknown>).player_name
      : null;
    const name = normalizeFredRunPlayerName(rawName);
    if (
      !name
      || typeof row.score !== "number"
      || !Number.isSafeInteger(row.score)
      || row.score < 0
      || row.score > FREDRUN_SCORE_MAX
    ) {
      return [];
    }
    return [{ name, score: row.score }];
  }).slice(0, FREDRUN_LEADERBOARD_LIMIT).map((entry, index) => ({
    rank: index + 1,
    ...entry,
  }));
}

export function parseFredRunHighscoresResponse(value: unknown): FredRunHighscoresResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.entries) || candidate.entries.length > FREDRUN_LEADERBOARD_LIMIT) return null;

  const entries: FredRunLeaderboardEntry[] = [];
  for (const [index, entryValue] of candidate.entries.entries()) {
    if (!entryValue || typeof entryValue !== "object" || Array.isArray(entryValue)) return null;
    const entry = entryValue as Record<string, unknown>;
    const name = normalizeFredRunPlayerName(entry.name);
    if (
      !name
      || name !== entry.name
      || entry.rank !== index + 1
      || typeof entry.score !== "number"
      || !Number.isSafeInteger(entry.score)
      || entry.score < 0
      || entry.score > FREDRUN_SCORE_MAX
    ) {
      return null;
    }
    entries.push({ rank: index + 1, name, score: entry.score });
  }

  const playerName = candidate.playerName === ""
    ? ""
    : normalizeFredRunPlayerName(candidate.playerName);
  if (playerName === null) return null;
  if (candidate.submitted !== undefined && typeof candidate.submitted !== "boolean") return null;

  return {
    entries,
    playerName,
    ...(typeof candidate.submitted === "boolean" ? { submitted: candidate.submitted } : {}),
  };
}
