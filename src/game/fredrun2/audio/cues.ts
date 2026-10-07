/**
 * Ereignis -> Ton: reine Funktionen und ein kleiner Zustandsautomat für die Spiel-Hinweise.
 *
 * Nichts hier berührt Web Audio, eine Uhr oder den Zufall: `coinPitch`/`comboPitch`/`stompChainPitch` rasten die Tonhöhe auf Töne der
 * Münz-Pentatonik (C-Dur, siehe `COIN_STEPS` in sfx.ts), `zoneCue` entscheidet, welcher Zonen-Sound mit welcher Lautstärke zu einem
 * Zonen-Ereignis gehört, und `CueTracker` meldet Zustandswechsel (Dash bereit, letztes Herz, Ende der Zeitlupe). Die Zuordnung
 * Sim-Ereignis -> SFX-Aufruf steckt in `../game-audio.ts`; beide Dateien sind ohne Browser testbar (`cues.test.ts`).
 */
import { VIEW_W } from "../constants";
import type { SfxName } from "./types";

const semitone = (s: number): number => Math.pow(2, s / 12);
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
/** Ganzzahliger Index >= 0; NaN/Infinity zählen als 0 (kein Ton darf an einem kaputten Ereigniswert hängen). */
const idx = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);

// -----------------------------------------------------------------------------------------------
// Tonleitern
// -----------------------------------------------------------------------------------------------

/** Münzleiter in Halbtönen über C5 (C-Dur-Pentatonik, zwei Oktaven); danach wechselt die Kette zwischen den letzten Tönen. */
export const COIN_LADDER = [0, 2, 4, 7, 9, 12, 14, 16] as const;
/** Nach dem Leiterende abwechselnd (Oktave, Terz darüber), damit die Kette lebt statt auf einem Ton zu stehen. */
export const COIN_TOP_PAIR = [12, 16] as const;
/**
 * Obergrenze des Tonhöhenfaktors (nicht schrill). 2^(16/12) = 2.52 läge knapp darüber: der oberste Ton wird auf 2.5 gekappt, das ist die
 * reine große Terz (5/4 · 2) und liegt 14 Cent unter dem gleichstufigen Ton, also nach wie vor auf einem Skalenton.
 */
export const COIN_PITCH_MAX = 2.5;
/** Combo-Stufen 2..8 (COMBO_MAX) auf der Pentatonik. */
export const COMBO_LADDER = [0, 2, 4, 7, 9, 12, 14] as const;
/** Stampf-Kette (Gegner nacheinander abgesprungen): Länge 1.. */
export const STOMP_CHAIN_LADDER = [0, 2, 4, 7, 9, 12] as const;

/**
 * Tonhöhenfaktor der Münze. `streak` zählt ab 0 (0 = erste Münze der Kette, Sim-Wert minus 1): Leiter `COIN_LADDER`, ab dem Leiterende
 * abwechselnd `COIN_TOP_PAIR`. Streng steigend über die ganze Leiter, nie über `COIN_PITCH_MAX`.
 */
export function coinPitch(streak: number): number {
  const n = idx(streak);
  const s = n < COIN_LADDER.length ? COIN_LADDER[n] : COIN_TOP_PAIR[(n - COIN_LADDER.length) % 2];
  return Math.min(COIN_PITCH_MAX, semitone(s));
}

/** Tonhöhenfaktor des Combo-Aufstiegs (`level` = neue Combo-Stufe, die erste ist 2); oberhalb der Leiter bleibt der letzte Ton. */
export function comboPitch(level: number): number {
  return semitone(COMBO_LADDER[Math.min(COMBO_LADDER.length - 1, idx(level - 2))]);
}

/** Tonhöhenfaktor des Stampf-Kettenklangs (`n` = Kettenlänge, 1 = erster Absprung). */
export function stompChainPitch(n: number): number {
  return semitone(STOMP_CHAIN_LADDER[Math.min(STOMP_CHAIN_LADDER.length - 1, idx(n - 1))]);
}

// -----------------------------------------------------------------------------------------------
// Zonen-Sounds
// -----------------------------------------------------------------------------------------------

export type ZonePhase = "warn" | "active";
export type ZoneGroup = "bolt" | "stamp" | "laser" | "rock" | "phase";

/** Ein SFX-Aufruf: Name, optionale Tonhöhe, Lautstärke 0..1. */
export interface Cue {
  name: SfxName;
  pitch?: number;
  volume: number;
}

const ZONE_RULES: ReadonlyArray<readonly [RegExp, ZoneGroup]> = [
  [/bolt|lightning|blitz/, "bolt"],
  [/stamp|stempel/, "stamp"],
  [/laser|beam/, "laser"],
  [/rock|stein/, "rock"],
  [/phase/, "phase"],
];

/** Skin-Gruppe einer Zone (Grundlage für den Mindestabstand beim Aufrufer); null = Zone ohne generischen Sound. */
export function zoneGroup(skin: string): ZoneGroup | null {
  const s = skin.toLowerCase();
  for (const [re, group] of ZONE_RULES) if (re.test(s)) return group;
  return null;
}

/** Abstand (logische px) vom Bildrand, ab dem Zonen-Sounds leiser werden, und Länge der Abblende bis zum Boden. */
const ZONE_FADE_PX = 450;
const ZONE_FLOOR = 0.2;

/** Lautstärkefaktor nach Abstand zum sichtbaren Bild (1 im Bild und bis ca. 67 px daneben, Boden 0.2 ab ca. 430 px; links wie rechts). */
function nearFactor(x: number): number {
  const dist = Number.isFinite(x) ? Math.max(0, -x, x - VIEW_W) : 0;
  return clamp(1.15 - dist / ZONE_FADE_PX, ZONE_FLOOR, 1);
}

/**
 * Zonen-Sound zu einem Zonen-Ereignis (`skin` = Skin/Typ der Zone, `x` = Bildschirm-x der Zonenmitte) oder null (kein Sound).
 * Laser: Warnung leise und tief ("Aufladen"), aktiv voll; Steinschlag: Warnung leiser und höher; Blitz/Stempel wie bisher. Alles wird nach
 * dem Abstand zum Bild leiser. Cyber-Phasentore knistern ("glitch") nur im aktiven Takt und nur im Bild.
 * Den Mindestabstand je `zoneGroup` hält der Aufrufer (Zeitstempel), diese Funktion kennt keine Uhr.
 */
export function zoneCue(skin: string, phase: ZonePhase, x: number): Cue | null {
  const group = zoneGroup(skin);
  if (!group) return null;
  const near = nearFactor(x);
  const warn = phase === "warn";
  switch (group) {
    case "bolt":
      return { name: warn ? "lightning-warn" : "thunder", volume: near };
    case "stamp":
      return { name: warn ? "paper-flutter" : "stamp-thud", volume: near };
    case "laser":
      return warn ? { name: "laser-zap", pitch: 0.6, volume: 0.5 * near } : { name: "laser-zap", pitch: 1, volume: near };
    case "rock":
      return warn ? { name: "rockfall", pitch: 1.15, volume: 0.55 * near } : { name: "rockfall", volume: near };
    case "phase":
      return warn || !(x >= 0 && x <= VIEW_W) ? null : { name: "glitch", volume: 0.45 };
  }
}

// -----------------------------------------------------------------------------------------------
// Zustands-Hinweise
// -----------------------------------------------------------------------------------------------

export type CueName = "dash-ready" | "heartbeat" | "slowmo-off";

/** In den ersten Sekunden eines Laufs (Countdown-Ausklang, Einstieg) kommen keine Hinweise. */
export const CUE_QUIET_SEC = 2;
/** Abstand der Herzschläge beim letzten Herz. */
export const HEARTBEAT_GAP_SEC = 1.3;

export interface CueInput {
  /** Laufzeit in Sekunden (Sim-Zeit); steigt nur, solange der Lauf läuft */
  t: number;
  energy: number;
  dashCost: number;
  dashCd: number;
  hearts: number;
  slowmo: number;
  paused: boolean;
}

const NONE: readonly CueName[] = Object.freeze([]);

/**
 * Meldet Zustandswechsel als Hinweis-Namen: "dash-ready" (Dash wieder einsatzbereit: genug Energie und keine Abklingzeit), "heartbeat" (alle
 * `HEARTBEAT_GAP_SEC` beim letzten Herz, der erste einen Takt nach dem Wechsel) und "slowmo-off" (Zeitlupe vorbei). `update` wird jeden Frame
 * aufgerufen und liefert meist das leere, geteilte Array (keine Allokation); nur bei einem Hinweis kommt ein frisches. In der Pause und in
 * den ersten `CUE_QUIET_SEC` Sekunden kommt nichts; Wechsel in dieser Zeit lösen später keinen Hinweis nach (der Zustand wird mitgeführt).
 */
export class CueTracker {
  private ready: boolean | null = null;
  private slow = false;
  private lastHeart = false;
  private nextBeat = 0;

  /** Neuer Lauf: Zustand vergessen (sonst würde der erste Frame einen falschen Wechsel melden). */
  reset(): void {
    this.ready = null;
    this.slow = false;
    this.lastHeart = false;
    this.nextBeat = 0;
  }

  update(s: CueInput): readonly CueName[] {
    if (s.paused) return NONE;
    const quiet = s.t < CUE_QUIET_SEC;
    let out: CueName[] | null = null;

    const ready = s.energy >= s.dashCost && s.dashCd <= 0;
    if (this.ready === false && ready && !quiet) (out ??= []).push("dash-ready");
    this.ready = ready;

    const slow = s.slowmo > 0;
    if (this.slow && !slow && !quiet) (out ??= []).push("slowmo-off");
    this.slow = slow;

    if (s.hearts === 1) {
      if (!this.lastHeart) this.nextBeat = s.t + HEARTBEAT_GAP_SEC;
      else if (s.t >= this.nextBeat - 1e-6 && !quiet) {
        (out ??= []).push("heartbeat");
        this.nextBeat = s.t + HEARTBEAT_GAP_SEC;
      }
      this.lastHeart = true;
    } else {
      this.lastHeart = false;
    }
    return out ?? NONE;
  }
}
