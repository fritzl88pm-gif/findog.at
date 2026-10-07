/** Persistenz (localStorage): Münzen, Freischaltungen, Highscores, Einstellungen. Alles defensiv (try/catch, Validierung). */
import { CHARACTERS, isCharacterId } from "./characters";
import { CHARACTER_IDS, WORLD_IDS, type CharacterId, type RunMode, type WorldId } from "./types";

export const PROFILE_KEY = "findog.fredrun2.profile.v1";
/** Sicherungsschlüssel für defekte Roh-Daten (JSON-Parsefehler), bevor sie überschrieben werden */
export const PROFILE_BACKUP_KEY = `${PROFILE_KEY}.bak`;
export const TOP_LIMIT = 10;
export const NAME_MAX = 16;
/**
 * Bestenlisten-Generation: Highscores sind ab Generation 2 global (Server, jeder gegen jeden). Profile ohne diese Generation
 * (alte, nur lokale Bestenlisten) werden beim Laden zurückgesetzt – Münzen, Helden, Einstellungen bleiben erhalten.
 */
export const SCORE_EPOCH = 2;

export interface ScoreEntry {
  name: string;
  score: number;
  meters: number;
  character: CharacterId;
  /** ISO-Datum */
  date: string;
}

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
  reducedMotion: boolean;
  /** "auto" passt Bildqualität dynamisch an */
  quality: "auto" | "low" | "medium" | "high";
  showFps: boolean;
  hints: boolean;
  /** Verkürzter Countdown bei Wiederholung desselben Laufs (ab dem zweiten Lauf) */
  quickRestart: boolean;
  /** Vibration (Android) und Controller-Rumble bei Treffer/Tod; wirkt nie in der Demo */
  haptics: boolean;
  /** Stärke des Screen-Shakes 0..1 (1 = bisher); "Weniger Bewegung" überstimmt mit 0 */
  shake: number;
  /** Intensität von Vollbild-Blitzen/Wetter-Aufhellern 0..1 (1 = bisher); "Weniger Bewegung" begrenzt auf 0,3 */
  flashes: number;
  /** Sprung-Assistent: Tippen führt zu einem vollen Sprung (wirkt im InputManager, die Sim bleibt unverändert) */
  jumpAssist: boolean;
  /** Akustische Signale (Dash bereit, letztes Herz, Ende der Zeitlupe) */
  cues: boolean;
}

export interface Lifetime {
  runs: number;
  meters: number;
  coins: number;
  stomps: number;
  nearMisses: number;
  playSeconds: number;
}

export interface Profile {
  version: 1;
  name: string;
  coins: number;
  unlocked: CharacterId[];
  character: CharacterId;
  world: WorldId;
  mode: RunMode;
  /** Bestwerte je "<mode>:<world|tour|daily>" */
  best: Record<string, number>;
  top: Record<string, ScoreEntry[]>;
  settings: Settings;
  lifetime: Lifetime;
  seenIntro: boolean;
  dailyKey: string;
  scoreEpoch: number;
}

export function boardKey(mode: RunMode, world: WorldId, dateKey = ""): string {
  if (mode === "tour") return "tour";
  if (mode === "daily") return `daily:${dateKey}`;
  return `world:${world}`;
}

export function defaultProfile(): Profile {
  return {
    version: 1,
    name: "",
    coins: 0,
    unlocked: CHARACTER_IDS.filter((id) => CHARACTERS[id].price === 0),
    character: "fred",
    world: "wien",
    mode: "world",
    best: {},
    top: {},
    settings: {
      master: 0.85,
      music: 0.6,
      sfx: 0.9,
      muted: false,
      reducedMotion: false,
      quality: "auto",
      showFps: false,
      hints: true,
      quickRestart: true,
      haptics: true,
      shake: 1,
      flashes: 1,
      jumpAssist: false,
      cues: true,
    },
    lifetime: { runs: 0, meters: 0, coins: 0, stomps: 0, nearMisses: 0, playSeconds: 0 },
    seenIntro: false,
    dailyKey: "",
    scoreEpoch: SCORE_EPOCH,
  };
}

function num(v: unknown, fallback: number, lo = 0, hi = Number.MAX_SAFE_INTEGER): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

function isWorldId(v: unknown): v is WorldId {
  return typeof v === "string" && (WORLD_IDS as readonly string[]).includes(v);
}

export function cleanName(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
}

export function normalizeProfile(raw: unknown): Profile {
  const d = defaultProfile();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  const unlocked = new Set<CharacterId>(d.unlocked);
  if (Array.isArray(r.unlocked)) for (const id of r.unlocked) if (isCharacterId(id)) unlocked.add(id);
  const character = isCharacterId(r.character) && unlocked.has(r.character) ? r.character : d.character;
  const best: Record<string, number> = {};
  // Alte (lokale) Bestenlisten verfallen: ohne aktuelle Generation nichts übernehmen
  const keepScores = r.scoreEpoch === SCORE_EPOCH;
  if (keepScores && r.best && typeof r.best === "object") {
    for (const [k, v] of Object.entries(r.best as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v) && v >= 0 && k.length < 40) best[k] = Math.floor(v);
    }
  }
  const top: Record<string, ScoreEntry[]> = {};
  if (keepScores && r.top && typeof r.top === "object") {
    for (const [k, list] of Object.entries(r.top as Record<string, unknown>)) {
      if (!Array.isArray(list) || k.length > 40) continue;
      const entries: ScoreEntry[] = [];
      for (const it of list) {
        if (!it || typeof it !== "object") continue;
        const e = it as Record<string, unknown>;
        const score = num(e.score, -1);
        if (score < 0) continue;
        entries.push({
          name: cleanName(e.name) || "Fred",
          score: Math.floor(score),
          meters: Math.floor(num(e.meters, 0)),
          character: isCharacterId(e.character) ? e.character : "fred",
          date: typeof e.date === "string" ? e.date.slice(0, 32) : "",
        });
      }
      entries.sort((a, b) => b.score - a.score);
      top[k] = entries.slice(0, TOP_LIMIT);
    }
  }
  const s = (r.settings && typeof r.settings === "object" ? r.settings : {}) as Record<string, unknown>;
  const l = (r.lifetime && typeof r.lifetime === "object" ? r.lifetime : {}) as Record<string, unknown>;
  const mode = r.mode === "tour" || r.mode === "daily" || r.mode === "world" ? r.mode : "world";
  return {
    version: 1,
    name: cleanName(r.name),
    coins: Math.floor(num(r.coins, 0)),
    unlocked: [...unlocked],
    character,
    world: isWorldId(r.world) ? r.world : d.world,
    mode,
    best,
    top,
    settings: {
      master: num(s.master, d.settings.master, 0, 1),
      music: num(s.music, d.settings.music, 0, 1),
      sfx: num(s.sfx, d.settings.sfx, 0, 1),
      muted: s.muted === true,
      reducedMotion: s.reducedMotion === true,
      quality: s.quality === "low" || s.quality === "medium" || s.quality === "high" || s.quality === "auto" ? s.quality : "auto",
      showFps: s.showFps === true,
      hints: s.hints !== false,
      quickRestart: s.quickRestart !== false,
      haptics: s.haptics !== false,
      shake: num(s.shake, d.settings.shake, 0, 1),
      flashes: num(s.flashes, d.settings.flashes, 0, 1),
      jumpAssist: s.jumpAssist === true,
      cues: s.cues !== false,
    },
    lifetime: {
      runs: Math.floor(num(l.runs, 0)),
      meters: Math.floor(num(l.meters, 0)),
      coins: Math.floor(num(l.coins, 0)),
      stomps: Math.floor(num(l.stomps, 0)),
      nearMisses: Math.floor(num(l.nearMisses, 0)),
      playSeconds: Math.floor(num(l.playSeconds, 0)),
    },
    seenIntro: r.seenIntro === true,
    dailyKey: typeof r.dailyKey === "string" ? r.dailyKey.slice(0, 16) : "",
    scoreEpoch: SCORE_EPOCH,
  };
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function storage(): StorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Sichert defekte Roh-Daten einmalig unter dem Backup-Schlüssel; ein vorhandenes Backup bleibt unangetastet. Wirft nie. */
function backupBrokenProfile(store: StorageLike, raw: string): void {
  try {
    if (store.getItem(PROFILE_BACKUP_KEY)) return;
    store.setItem(PROFILE_BACKUP_KEY, raw);
  } catch {
    /* Backup ist nur ein Zusatz (Storage voll/gesperrt) */
  }
}

export function loadProfile(store: StorageLike | null = storage()): Profile {
  if (!store) return defaultProfile();
  let raw: string | null = null;
  try {
    raw = store.getItem(PROFILE_KEY);
    return raw ? normalizeProfile(JSON.parse(raw)) : defaultProfile();
  } catch {
    // JSON-Parsefehler bei vorhandenen Daten: vor dem späteren Überschreiben sichern (kein Backup, wenn schon der Zugriff scheiterte)
    if (raw) backupBrokenProfile(store, raw);
    return defaultProfile();
  }
}

/** Speichert das Profil. `false` bei fehlendem, gesperrtem oder vollem Speicher (wirft nie) – der Hub leitet daraus `storageOk` ab. */
export function saveProfile(p: Profile, store: StorageLike | null = storage()): boolean {
  if (!store) return false;
  try {
    store.setItem(PROFILE_KEY, JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}

export interface RunSummary {
  mode: RunMode;
  world: WorldId;
  character: CharacterId;
  score: number;
  meters: number;
  coins: number;
  stomps: number;
  nearMisses: number;
  seconds: number;
  dailyKey?: string;
}

export interface RecordResult {
  profile: Profile;
  isNewBest: boolean;
  /** 1-basiert, null = nicht in Top-Liste */
  rank: number | null;
  previousBest: number;
  key: string;
}

/** Trägt einen Lauf ein (Münzen, Lifetime, Bestenliste). Reine Funktion. */
export function recordRun(profile: Profile, run: RunSummary, now = new Date()): RecordResult {
  const key = boardKey(run.mode, run.world, run.dailyKey ?? "");
  const previousBest = profile.best[key] ?? 0;
  const isNewBest = run.score > previousBest;
  const list = [...(profile.top[key] ?? [])];
  const entry: ScoreEntry = {
    name: profile.name || "Fred",
    score: Math.max(0, Math.floor(run.score)),
    meters: Math.floor(run.meters),
    character: run.character,
    date: now.toISOString(),
  };
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  const idx = list.indexOf(entry);
  const rank = idx >= 0 && idx < TOP_LIMIT && entry.score > 0 ? idx + 1 : null;
  const next: Profile = {
    ...profile,
    coins: profile.coins + Math.max(0, Math.floor(run.coins)),
    best: { ...profile.best, [key]: Math.max(previousBest, entry.score) },
    top: { ...profile.top, [key]: list.slice(0, TOP_LIMIT) },
    lifetime: {
      runs: profile.lifetime.runs + 1,
      meters: profile.lifetime.meters + Math.floor(run.meters),
      coins: profile.lifetime.coins + Math.floor(run.coins),
      stomps: profile.lifetime.stomps + run.stomps,
      nearMisses: profile.lifetime.nearMisses + run.nearMisses,
      playSeconds: profile.lifetime.playSeconds + Math.floor(run.seconds),
    },
  };
  return { profile: next, isNewBest, rank, previousBest, key };
}

export type PurchaseStatus = "purchased" | "owned" | "insufficient";

export function purchaseCharacter(profile: Profile, id: CharacterId): { profile: Profile; status: PurchaseStatus } {
  if (profile.unlocked.includes(id)) return { profile, status: "owned" };
  const price = CHARACTERS[id].price;
  if (profile.coins < price) return { profile, status: "insufficient" };
  return { profile: { ...profile, coins: profile.coins - price, unlocked: [...profile.unlocked, id] }, status: "purchased" };
}

export function unlockAll(profile: Profile): Profile {
  return { ...profile, unlocked: [...CHARACTER_IDS] };
}
