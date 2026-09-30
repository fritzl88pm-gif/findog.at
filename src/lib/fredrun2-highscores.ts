/**
 * Fredrun 2.0 – globale Bestenliste („jeder gegen jeden“): gemeinsame Typen, Validierung und Antwort-Parser für Server und Client.
 * Boards: `world:<welt>` (Endlos je Welt), `tour` (Weltreise), `daily:<JJJJ-MM-TT>` (Tageslauf, für alle derselbe Kurs).
 * Je Board zählt pro Spieler der beste Lauf.
 */
import { CHARACTER_IDS, WORLD_IDS } from "@/game/fredrun2/types";

export const FREDRUN2_NAME_MAX = 16;
export const FREDRUN2_SCORE_MAX = 100_000_000;
export const FREDRUN2_METERS_MAX = 10_000_000;
export const FREDRUN2_LEADERBOARD_LIMIT = 25;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const DAILY_PATTERN = /^daily:(\d{4})-(\d{2})-(\d{2})$/u;

export type FredRun2Entry = {
  rank: number;
  name: string;
  score: number;
  meters: number;
  character: string;
  /** Eintrag gehört der anfragenden Person */
  me: boolean;
};

export type FredRun2BoardResponse = {
  board: string;
  entries: FredRun2Entry[];
  /** eigener Platz/Bestwert, auch außerhalb der Top-Liste (null = noch kein Eintrag) */
  me: { rank: number; score: number } | null;
  playerName: string;
  submitted?: boolean;
};

export type FredRun2Submission = {
  board: string;
  runId: string;
  name: string;
  score: number;
  meters: number;
  character: string;
};

export function isFredRun2Board(value: unknown, now: Date = new Date()): value is string {
  if (typeof value !== "string") return false;
  if (value === "tour") return true;
  if (value.startsWith("world:")) return WORLD_IDS.some((id) => value === `world:${id}`);
  const m = DAILY_PATTERN.exec(value);
  if (!m) return false;
  const day = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== value.slice(6)) return false;
  // Zeitzonen-Toleranz: heute ± 1 Tag (UTC)
  return Math.abs(day - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) <= 86_400_000;
}

export function normalizeFredRun2Name(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (!normalized || Array.from(normalized).length > FREDRUN2_NAME_MAX || CONTROL_CHARACTER_PATTERN.test(normalized)) return null;
  return normalized;
}

function isCharacter(value: unknown): value is string {
  return typeof value === "string" && CHARACTER_IDS.some((id) => id === value);
}

export function parseFredRun2Submission(value: unknown, now: Date = new Date()): FredRun2Submission | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const c = value as Record<string, unknown>;
  const name = c.name === undefined || c.name === "" ? "" : normalizeFredRun2Name(c.name);
  if (
    name === null
    || !isFredRun2Board(c.board, now)
    || typeof c.runId !== "string"
    || !UUID_PATTERN.test(c.runId)
    || typeof c.score !== "number"
    || !Number.isSafeInteger(c.score)
    || c.score < 0
    || c.score > FREDRUN2_SCORE_MAX
    || typeof c.meters !== "number"
    || !Number.isSafeInteger(c.meters)
    || c.meters < 0
    || c.meters > FREDRUN2_METERS_MAX
    || !isCharacter(c.character)
  ) {
    return null;
  }
  return { board: c.board, runId: c.runId, name, score: c.score, meters: c.meters, character: c.character };
}

/** Zeilen der Datenbankfunktion `get_fredrun2_leaderboard` (rank, player_name, score, meters, hero, is_me) → geprüfte Einträge. */
export function normalizeFredRun2Rows(value: unknown): FredRun2Entry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((rowValue) => {
    if (!rowValue || typeof rowValue !== "object" || Array.isArray(rowValue)) return [];
    const row = rowValue as Record<string, unknown>;
    const name = normalizeFredRun2Name(row.player_name);
    if (
      !name
      || typeof row.rank !== "number" || !Number.isSafeInteger(row.rank) || row.rank < 1
      || typeof row.score !== "number" || !Number.isSafeInteger(row.score) || row.score < 0 || row.score > FREDRUN2_SCORE_MAX
      || typeof row.meters !== "number" || !Number.isSafeInteger(row.meters) || row.meters < 0
      || !isCharacter(row.hero)
    ) {
      return [];
    }
    return [{ rank: row.rank, name, score: row.score, meters: row.meters, character: row.hero, me: row.is_me === true }];
  });
}

/** Top-Liste (ohne Einträge außerhalb des Limits) und der eigene Platz getrennt. */
export function splitFredRun2Rows(entries: FredRun2Entry[]): { top: FredRun2Entry[]; me: { rank: number; score: number } | null } {
  const mine = entries.find((e) => e.me);
  return {
    top: entries.filter((e) => e.rank <= FREDRUN2_LEADERBOARD_LIMIT),
    me: mine ? { rank: mine.rank, score: mine.score } : null,
  };
}

export function parseFredRun2BoardResponse(value: unknown): FredRun2BoardResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const c = value as Record<string, unknown>;
  if (typeof c.board !== "string" || !Array.isArray(c.entries) || c.entries.length > FREDRUN2_LEADERBOARD_LIMIT + 1) return null;
  const entries = normalizeFredRun2Rows(
    c.entries.map((e) => (e && typeof e === "object" ? { ...(e as Record<string, unknown>), player_name: (e as Record<string, unknown>).name, hero: (e as Record<string, unknown>).character, is_me: (e as Record<string, unknown>).me } : e)),
  );
  if (entries.length !== c.entries.length) return null;
  let me: FredRun2BoardResponse["me"] = null;
  if (c.me !== null && c.me !== undefined) {
    const m = c.me as Record<string, unknown>;
    if (!m || typeof m !== "object" || typeof m.rank !== "number" || typeof m.score !== "number" || !Number.isSafeInteger(m.rank) || !Number.isSafeInteger(m.score)) return null;
    me = { rank: m.rank, score: m.score };
  }
  const playerName = c.playerName === "" ? "" : normalizeFredRun2Name(c.playerName);
  if (playerName === null) return null;
  if (c.submitted !== undefined && typeof c.submitted !== "boolean") return null;
  return { board: c.board, entries, me, playerName, ...(typeof c.submitted === "boolean" ? { submitted: c.submitted } : {}) };
}
