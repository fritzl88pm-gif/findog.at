/**
 * Lauf-Zusammenfassung und -Buchung (rein, ohne DOM/Sim-Import): wird vom Hub sowohl nach dem Tod (finishRun) als auch beim
 * Beenden aus der Pause (quitRun) benutzt. Die Funktionen ändern weder die Sim noch das übergebene Profil.
 */
import { recordRun, type Profile, type RecordResult, type RunSummary, type ScoreEntry } from "./profile";
import type { CharacterId, RunMode, WorldId } from "./types";

/** Todesursache eines vom Spieler beendeten Laufs (siehe death-names.ts: „Lauf beendet“) */
export const QUIT_CAUSE = "quit";

/** Ergebnis-Karte nach einem Lauf (Tod oder „Lauf beenden“) */
export interface RunResult {
  score: number;
  meters: number;
  coins: number;
  gems: number;
  stomps: number;
  nearMisses: number;
  maxCombo: number;
  dashes: number;
  seconds: number;
  deathCause: string;
  world: WorldId;
  mode: RunMode;
  character: CharacterId;
  isNewBest: boolean;
  rank: number | null;
  previousBest: number;
  worldsVisited: WorldId[];
  top: ScoreEntry[];
  /** Board-Schlüssel (`world:<id>` | `tour` | `daily:<Datum>`) und eindeutige Lauf-ID für die globale Bestenliste */
  board: string;
  runId: string;
}

/** Was die Zusammenfassung von der Sim liest (strukturell: `Sim` passt, Tests brauchen keine echte Sim). */
export interface SimSummarySource {
  cfg: { mode: RunMode; world: WorldId; character: CharacterId };
  score: number;
  meters: number;
  /** Laufzeit in Sekunden */
  time: number;
  /** leer, solange die Figur nicht gestorben ist */
  deathCause: string;
  stats: {
    coins: number;
    gems: number;
    stomps: number;
    nearMisses: number;
    dashes: number;
    maxCombo: number;
    worldsVisited: WorldId[];
  };
}

export interface SummaryContext {
  /** Datumsschlüssel des Tageslaufs (leer in den anderen Modi) */
  dailyKey: string;
  /** Lauf vom Spieler beendet: Ursache „quit“, falls die Sim noch keine kennt */
  quit?: boolean;
}

/** Alles, was recordRun braucht, plus die Felder der Ergebnis-Karte. */
export interface FullRunSummary extends RunSummary {
  gems: number;
  maxCombo: number;
  dashes: number;
  deathCause: string;
  worldsVisited: WorldId[];
}

/** Liest den Stand der Sim in eine Zusammenfassung (rein, kopiert die Listen). */
export function summarizeRun(sim: SimSummarySource, ctx: SummaryContext): FullRunSummary {
  return {
    mode: sim.cfg.mode,
    world: sim.cfg.world,
    character: sim.cfg.character,
    score: sim.score,
    meters: sim.meters,
    coins: sim.stats.coins,
    stomps: sim.stats.stomps,
    nearMisses: sim.stats.nearMisses,
    seconds: sim.time,
    dailyKey: ctx.dailyKey,
    gems: sim.stats.gems,
    maxCombo: sim.stats.maxCombo,
    dashes: sim.stats.dashes,
    deathCause: sim.deathCause || (ctx.quit ? QUIT_CAUSE : ""),
    worldsVisited: [...sim.stats.worldsVisited],
  };
}

/**
 * Lohnt sich die Buchung eines abgebrochenen Laufs? Nur wenn etwas erreicht wurde (ganze Punkte oder Münzen):
 * wer in der ersten Sekunde „Neustart“ drückt, soll weder die Lauf-Zähler noch die Bestenliste füllen.
 * (Ein Tod wird immer gebucht, auch mit 0 Punkten, wie bisher.)
 */
export function isBankable(summary: Pick<RunSummary, "score" | "coins">): boolean {
  return Math.floor(summary.score) > 0 || Math.floor(summary.coins) > 0;
}

/** Bucht den Lauf ins Profil (Münzen, Lifetime, Bestwert, Top-Liste): dünner Mantel um recordRun, damit Tod und Abbruch denselben Weg gehen. */
export function bankRun(profile: Profile, summary: RunSummary, now = new Date()): RecordResult {
  return recordRun(profile, summary, now);
}

/** Ergebnis-Karte aus Zusammenfassung und Buchungsergebnis. */
export function toRunResult(summary: FullRunSummary, rec: RecordResult, runId: string): RunResult {
  return {
    score: summary.score,
    meters: summary.meters,
    coins: summary.coins,
    gems: summary.gems,
    stomps: summary.stomps,
    nearMisses: summary.nearMisses,
    maxCombo: summary.maxCombo,
    dashes: summary.dashes,
    seconds: summary.seconds,
    deathCause: summary.deathCause,
    world: summary.world,
    mode: summary.mode,
    character: summary.character,
    isNewBest: rec.isNewBest && summary.score > 0,
    rank: rec.rank,
    previousBest: rec.previousBest,
    worldsVisited: summary.worldsVisited,
    top: rec.profile.top[rec.key] ?? [],
    board: rec.key,
    runId,
  };
}

/** Dauer (s) des kurzen Countdowns bei Wiederholung: eine Zahl („1“) und „Los“ */
export const QUICK_COUNTDOWN_S = 1;
/** Aus dem Menü startet der kurze Countdown erst, wenn so viele Läufe gewertet sind (Neulinge sollen die Einführung sehen) */
export const QUICK_MENU_RUNS = 3;

/**
 * Bekommt dieser Start den kurzen Countdown? Nur eine Wiederholung desselben Laufs (Welt/Modus/Held wie der zuletzt gestartete),
 * wenn „Schneller Neustart“ an ist und schon Läufe gewertet sind: nach Game-Over/Pause ab dem 1., aus dem Menü erst ab dem 3. Lauf.
 */
export function wantsQuickCountdown(o: { quickRestart: boolean; runs: number; fromMenu: boolean; sameAsLast: boolean }): boolean {
  if (!o.quickRestart || !o.sameAsLast) return false;
  return o.runs >= (o.fromMenu ? QUICK_MENU_RUNS : 1);
}

/** Countdown-Zahl fürs UI aus der Restzeit: 3, 2, 1 (die ersten 0,2 s des 3,2-s-Countdowns zeigen schon „3“, nie „4“), sonst 0. */
export function countdownDisplay(remaining: number): number {
  return Math.min(3, Math.max(0, Math.ceil(remaining)));
}

/** Eindeutige Lauf-ID (UUID v4) – macht Einreichungen an die globale Bestenliste idempotent. */
export function newRunId(): string {
  const c = typeof globalThis.crypto !== "undefined" ? globalThis.crypto : null;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
