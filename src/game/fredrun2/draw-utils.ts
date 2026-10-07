/** Kleine Zeichenhelfer, die von Engine und Welten gemeinsam genutzt werden. */
import { DASH_GRACE, HURT_INVULN, HURT_STUN, SLOWMO_FACTOR, SPEED_MAX, VIEW_H, VIEW_W } from "./constants";

export function rgba(hex: string, a: number): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function smoothstep(a: number, b: number, v: number): number {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Mischt zwei #rrggbb-Farben. */
export function mix(c1: string, c2: string, t: number): string {
  const p = (c: string) => {
    const h = c.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const a = p(c1);
  const b = p(c2);
  const r = a.map((v, i) => Math.round(lerp(v, b[i], t)));
  return `rgb(${r[0]}, ${r[1]}, ${r[2]})`;
}

/** Deterministische Pseudozufallszahl 0..1 aus Ganzzahl-Seed. */
export function hash1(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/**
 * Zeichnet eine horizontal wiederholte Ebene (Parallax). `tile` ist eine vorgerenderte Kachel (Canvas/Bild),
 * die nahtlos kachelbar sein muss. `scroll` in Pixeln der Ebene.
 */
export function drawTiled(
  g: CanvasRenderingContext2D,
  tile: CanvasImageSource,
  tileW: number,
  tileH: number,
  scroll: number,
  y: number,
  viewW: number,
  scaleX = 1,
): void {
  const w = tileW * scaleX;
  let x = -(((scroll % w) + w) % w);
  while (x < viewW) {
    g.drawImage(tile, x, y, w, tileH);
    x += w - 0.5; // 0.5 px Überlappung verhindert Nähte
  }
}

/** Erzeugt eine Offscreen-Zeichenfläche (OffscreenCanvas wenn möglich, sonst <canvas>). */
export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

// =====================================================================================================================
// Reine Darstellungs-Logik (keine Sim-Eingriffe, kein Canvas, kein Math.random). Der Renderer verdrahtet nur noch.
// Helfer mit Ergebnisobjekt/-array nehmen optional einen wiederverwendbaren `out` entgegen (keine Allokation pro Frame).
// =====================================================================================================================

// --- Lauf-Phase -------------------------------------------------------------------------------------------------------

/** Grundrate der Lauf-Animation bei Tempo 0 und Zuwachs bis SPEED_MAX (Kennlinie wie bisher: 0,7 … 1,45). */
export const RUN_RATE_MIN = 0.7;
export const RUN_RATE_SPAN = 0.75;

/** Abspielrate der Lauf-Animation (1 = Grundtempo) in Abhängigkeit vom Tempo. */
export function runRate(speed: number): number {
  const k = Number.isFinite(speed) ? clamp(speed / SPEED_MAX, 0, 1) : 0;
  return RUN_RATE_MIN + RUN_RATE_SPAN * k;
}

/**
 * Schreitet die Lauf-Phase (Animationszeit in "Grundtempo-Sekunden") um einen Frame fort. Die Phase ist ein Akkumulator:
 * Tempoänderungen ändern nur die Steigung, nie den Wert (kein Strobing/Rückwärtslaufen wie bei `time * rate`). Sie läuft
 * in der Luft weiter und wird nie zurückgesetzt. `timeScale` ist 1 oder SLOWMO_FACTOR (Slow-Mo), 0 friert ein (Hitstop);
 * Werte außerhalb 0..1 werden geklemmt. Nicht endliche oder nicht positive `dt` lassen die Phase unverändert.
 */
export function stepRunPhase(phase: number, dt: number, speed: number, timeScale = 1): number {
  const base = Number.isFinite(phase) ? phase : 0;
  if (!(dt > 0) || !Number.isFinite(dt)) return base;
  const ts = Number.isFinite(timeScale) ? clamp(timeScale, 0, 1) : 1;
  return base + dt * runRate(speed) * ts;
}

// --- Spieler-Transparenz / Treffer-Flash ------------------------------------------------------------------------------

/** Dauer und Stärke des weißen Treffer-Flashs (lighter-Überlagerung), 0,7 → 0 in 0,15 s. */
export const HIT_FLASH_TIME = 0.15;
export const HIT_FLASH_MAX = 0.7;
/** Unverwundbarkeits-Puls nach einem Treffer: ca. 6 Hz zwischen PULSE_MIN und 1. */
export const INVULN_PULSE_HZ = 6;
export const INVULN_PULSE_MIN = 0.6;
/**
 * Reserve in Sekunden für Uhrzeit, die nicht als Timer-Zeit läuft: Hitstop (0,07 s nach dem Treffer, dazu die kurzen
 * Hitstops von Stampfer/Bounce innerhalb der Frist) und Frame-Quantisierung. Nur für die grobe Zuordnung "Treffer".
 */
export const HURT_CLOCK_SLACK = 0.3;

export interface PlayerAlphaState {
  /** Sim-Phase; "dying"/"over" → immer deckend. */
  phase: string;
  stun: number;
  invuln: number;
  dashT: number;
  turbo: number;
  /**
   * Uhr in Sekunden, dieselbe wie bei `hurtT`. Der Puls hängt nicht von ihr ab (er folgt `invuln`), sie bestimmt nur die
   * Flash-Dauer und die grobe Zuordnung "Unverwundbarkeit stammt aus einem Treffer". Hitstop (Sim steht, Uhr läuft) und
   * Slow-Mo (Timer laufen langsamer) sind eingerechnet; eine Uhr, die während einer Pause weiterläuft, verliert die
   * Zuordnung für den Rest der Frist (dann Cyan statt Puls). Ideal ist daher die Sim-Zeit (steht in Hitstop und Pause).
   */
  time: number;
  /** Zeitstempel des letzten Treffers (Ereignis "hurt"); -Infinity = noch keiner. Schild-Treffer zählen nicht. */
  hurtT: number;
}

export interface PlayerAlpha {
  /** Deckkraft der Figur 0..1 (nie unter INVULN_PULSE_MIN). */
  alpha: number;
  /** Stärke der weißen Treffer-Überlagerung 0..HIT_FLASH_MAX. */
  flash: number;
  /** Cyan-Randschein 0..1 für Dash/Turbo und deren Gnadenfrist (keine Schaden-Anzeige). */
  dashGlow: number;
}

/**
 * Größte Treffer-Unverwundbarkeit, die `since` Sekunden (Uhr) nach einem Treffer noch übrig sein kann: Der Timer startet
 * bei HURT_INVULN und läuft frühestens mit SLOWMO_FACTOR der Uhr herunter (abzüglich der Hitstop-Reserve). Ein größerer
 * Wert stammt aus einer anderen Quelle (Dash-Gnadenfrist nach einem älteren Treffer, Schildbruch, Turbo-Rest).
 */
function hurtInvulnCeil(since: number): number {
  return HURT_INVULN - SLOWMO_FACTOR * Math.max(0, since - HURT_CLOCK_SLACK) + 1e-6;
}

/**
 * Darstellung der Figur bei Treffer/Unverwundbarkeit: während `stun` voll deckend plus Flash; danach weicher Puls
 * (startet deckend), aber nur wenn die Unverwundbarkeit aus einem Treffer stammt. Dash-Gnadenfrist, Dash und Turbo
 * liefern alpha 1 und `dashGlow`. In "dying"/"over" immer deckend.
 *
 * Die Pulsphase ergibt sich aus dem Fortschritt der Unverwundbarkeit (`invuln`, wie `stun` ein Sim-Timer): Beim Stun-Ende
 * ist `stun` 0 und `invuln` = HURT_INVULN - HURT_STUN, also Phase 0 (deckend) – unabhängig von Hitstop und Slow-Mo, die
 * Uhr und Timer gegeneinander verschieben. Ein Treffer-Zeitstempel in der Zukunft (Uhr zurückgesetzt) zählt nicht.
 */
export function playerAlpha(s: PlayerAlphaState, out: PlayerAlpha = { alpha: 1, flash: 0, dashGlow: 0 }): PlayerAlpha {
  out.alpha = 1;
  out.flash = 0;
  out.dashGlow = 0;
  const since = s.time - s.hurtT; // NaN (kein gültiger Stempel) → alle Vergleiche false; Infinity → keine Treffer-Quelle
  const down = s.phase === "dying" || s.phase === "over";
  if (since >= 0 && since < HIT_FLASH_TIME && (s.stun > 0 || down)) {
    out.flash = HIT_FLASH_MAX * (1 - since / HIT_FLASH_TIME);
  }
  if (down) return out;
  if (s.dashT > 0 || s.turbo > 0) {
    out.dashGlow = 1;
    return out;
  }
  if (s.stun > 0 || !(s.invuln > 0)) return out;
  if (since >= 0 && s.invuln <= hurtInvulnCeil(since)) {
    // Puls beginnt am Stun-Ende voll deckend (stetiger Übergang) und klingt in den letzten 0,25 s der Frist aus.
    const u = Math.max(0, HURT_INVULN - HURT_STUN - s.invuln);
    const wave = 0.5 + 0.5 * Math.cos(u * INVULN_PULSE_HZ * Math.PI * 2);
    const dip = (1 - INVULN_PULSE_MIN) * (1 - wave) * clamp(s.invuln / 0.25, 0, 1);
    out.alpha = 1 - dip;
  } else {
    out.dashGlow = clamp(s.invuln / DASH_GRACE, 0, 1);
  }
  return out;
}

// --- Squash & Stretch -------------------------------------------------------------------------------------------------

export type SquashKind = "land" | "stomp" | "jump";

export interface Squash {
  sx: number;
  sy: number;
}

/** Landungs-Squash: Amplitude 0,05 … 0,17 nach Aufprallgeschwindigkeit (300 … 1500 px/s), Stampfer 0,22. */
export const SQUASH_LAND_MIN = 0.05;
export const SQUASH_LAND_MAX = 0.17;
export const SQUASH_STOMP = 0.22;
/** Absprung-Stretch (Höhe +7 %, Dauer 0,09 s). */
export const SQUASH_JUMP_STRETCH = 0.07;
export const SQUASH_JUMP_TIME = 0.09;
/** Breitenänderung relativ zur Höhenänderung (Volumenerhalt). */
export const SQUASH_VOLUME = 0.8;
/** Anteil der Dauer bis zum Scheitel des Squash (schnell hinein, weich zurück). */
const SQUASH_ATTACK = 0.3;

/** Amplitude des Landungs-Squash (Höhenverlust 0..1) für eine Aufprallgeschwindigkeit in px/s. */
export function landSquashAmplitude(impact: number): number {
  const v = Number.isFinite(impact) ? impact : 300;
  return clamp(SQUASH_LAND_MIN + ((v - 300) / 1200) * 0.12, SQUASH_LAND_MIN, SQUASH_LAND_MAX);
}

/** Dauer des Squash in Sekunden: Landung 0,12 … 0,18 s (stärker = länger), Stampfer 0,18 s, Absprung 0,09 s. */
export function squashDuration(kind: SquashKind, impact: number): number {
  if (kind === "jump") return SQUASH_JUMP_TIME;
  if (kind === "stomp") return 0.18;
  return 0.12 + 0.06 * clamp((landSquashAmplitude(impact) - SQUASH_LAND_MIN) / (SQUASH_LAND_MAX - SQUASH_LAND_MIN), 0, 1);
}

/** Hüllkurve 0 → 1 → 0 über u = 0..1 (Scheitel bei SQUASH_ATTACK, an beiden Enden stetig mit Steigung ≈ 0 am Scheitel). */
function squashEnvelope(u: number): number {
  if (!(u > 0) || u >= 1) return 0;
  if (u < SQUASH_ATTACK) return Math.sin((u / SQUASH_ATTACK) * (Math.PI / 2));
  return Math.cos(((u - SQUASH_ATTACK) / (1 - SQUASH_ATTACK)) * (Math.PI / 2));
}

/**
 * Skalierung der Figur um den Fußpunkt `sinceEvent` Sekunden nach Landung/Stampfer-Landung/Absprung. `impact` ist die
 * Fallgeschwindigkeit (nur für "land"). Vor dem Ereignis und nach Ablauf: 1/1. `reduced` ("Weniger Bewegung") halbiert
 * die Amplitude. sx folgt sy mit SQUASH_VOLUME (Volumenerhalt); bei starken Aufprällen übersteigt sx daher 1,1 (max. 1,18).
 */
export function squashFor(sinceEvent: number, kind: SquashKind, impact: number, reduced: boolean, out: Squash = { sx: 1, sy: 1 }): Squash {
  out.sx = 1;
  out.sy = 1;
  const dur = squashDuration(kind, impact);
  if (!(sinceEvent > 0) || sinceEvent >= dur) return out;
  const e = squashEnvelope(sinceEvent / dur) * (reduced ? 0.5 : 1);
  if (kind === "jump") {
    out.sy = 1 + SQUASH_JUMP_STRETCH * e;
    out.sx = 1 - SQUASH_JUMP_STRETCH * SQUASH_VOLUME * e;
  } else {
    const amp = kind === "stomp" ? SQUASH_STOMP : landSquashAmplitude(impact);
    out.sy = 1 - amp * e;
    out.sx = 1 + amp * SQUASH_VOLUME * e;
  }
  return out;
}

// --- Schatten ---------------------------------------------------------------------------------------------------------

/** Flache Intervall-Liste: [von0, bis0, von1, bis1, …], aufsteigend, ohne Überlappung. */
export type RangeList = number[];

/**
 * Sichtbare Schatten-Intervalle von [x0, x1] ohne die Gruben `pits` (jeweils x0/x1 in derselben Koordinate, beliebige
 * Reihenfolge/Überlappung). Schreibt in `out` (wird geleert) und liefert es zurück: leer = komplett über einer Grube.
 */
export function shadowRanges(x0: number, x1: number, pits: ReadonlyArray<{ x0: number; x1: number }>, out: RangeList = []): RangeList {
  out.length = 0;
  if (!(x1 > x0)) return out;
  out.push(x0, x1);
  for (let k = 0; k < pits.length; k += 1) {
    const a = pits[k].x0;
    const b = pits[k].x1;
    if (!(b > a)) continue;
    for (let i = out.length - 2; i >= 0; i -= 2) {
      const s = out[i];
      const e = out[i + 1];
      if (b <= s || a >= e) continue;
      if (a > s && b < e) {
        out[i + 1] = a;
        out.push(b, e);
      } else if (a > s) {
        out[i + 1] = a;
      } else if (b < e) {
        out[i] = b;
      } else {
        const n = out.length;
        out[i] = out[n - 2];
        out[i + 1] = out[n - 1];
        out.length = n - 2;
      }
    }
  }
  // Einfügesortierung der (wenigen) Paare nach Anfang
  for (let i = 2; i < out.length; i += 2) {
    const s = out[i];
    const e = out[i + 1];
    let j = i - 2;
    while (j >= 0 && out[j] > s) {
      out[j + 2] = out[j];
      out[j + 3] = out[j + 1];
      j -= 2;
    }
    out[j + 2] = s;
    out[j + 3] = e;
  }
  return out;
}

/** true, wenn `x` über einer Grube liegt (dann entfällt der Schatten komplett). */
export function overPit(x: number, pits: ReadonlyArray<{ x0: number; x1: number }>): boolean {
  for (let i = 0; i < pits.length; i += 1) if (x > pits[i].x0 && x < pits[i].x1) return true;
  return false;
}

export interface ShadowShape {
  /** Deckkraft des Schattens */
  alpha: number;
  /** Halbachsen der Ellipse */
  rx: number;
  ry: number;
}

/** Referenzwerte des Spieler-Schattens am Boden (entsprechen dem bisherigen 46·k+6 / 9·k+2 / 0,32·k). */
export const PLAYER_SHADOW = { alpha: 0.32, rx: 52, ry: 11, reach: 420 } as const;
/** Anteil der Halbachsen, der auch in großer Höhe bleibt (6/52 bzw. 2/11 beim Spieler-Schatten). */
const SHADOW_PAD_X = 6 / 52;
const SHADOW_PAD_Y = 2 / 11;

/**
 * Schattenform in Abhängigkeit von der Flughöhe über der Fläche (px): je höher, desto kleiner und blasser (Mindestfaktor 0,2).
 * `alpha/rx/ry` sind die Werte am Boden, `reach` die Höhe, ab der der Mindestfaktor erreicht ist. Gilt für Spieler und Gegner.
 */
export function shadowShape(height: number, alpha: number, rx: number, ry: number, reach: number, out: ShadowShape = { alpha: 0, rx: 0, ry: 0 }): ShadowShape {
  const h = Number.isFinite(height) ? Math.abs(height) : 0;
  const k = clamp(1 - h / Math.max(1, reach), 0.2, 1);
  out.alpha = alpha * k;
  out.rx = rx * (SHADOW_PAD_X + (1 - SHADOW_PAD_X) * k);
  out.ry = ry * (SHADOW_PAD_Y + (1 - SHADOW_PAD_Y) * k);
  return out;
}

// --- Geschwindigkeits-Streifen ----------------------------------------------------------------------------------------

/** Ab diesem Tempo (px/s) erscheinen die Streifen, bei SPEED_LINE_FULL haben sie volle Stärke. */
export const SPEED_LINE_START = 520;
export const SPEED_LINE_FULL = 1100;
/** Anzahl Bahnen bei voller Stärke. */
export const SPEED_LANES = 12;
/** Feste Laufgeschwindigkeit der Streifen in px/s (unabhängig vom Tempo, daher stetig – Tempo bestimmt Länge und Anzahl). */
export const SPEED_LANE_BASE = 1500;
/** Maximale Länge eines Streifens (px); Bahnen werden außerhalb des Bildes umgebrochen. */
export const SPEED_LANE_MAX_LEN = 400;

/** Stärke der Streifen 0..1: 0 unter SPEED_LINE_START, 1 ab SPEED_LINE_FULL, dazwischen weich. */
export function speedLineIntensity(v: number): number {
  if (!(v > SPEED_LINE_START)) return 0;
  return smoothstep(SPEED_LINE_START, SPEED_LINE_FULL, v);
}

export interface SpeedLane {
  /** Linke Kante (Kopf) des Streifens; er reicht bis x + len. */
  x: number;
  y: number;
  len: number;
  /** Deckkraft 0..1 (Einblendung der Bahnen mit steigendem Tempo); 0 = nicht zeichnen. */
  a: number;
}

const LANE_PERIOD = VIEW_W + 2 * SPEED_LANE_MAX_LEN;

/**
 * Bahn `i` (0..SPEED_LANES-1) zur Zeit `time` (s) bei Tempo `v`. Jede Bahn hat ein festes Grundversatz und eine feste
 * Geschwindigkeit; x ist damit in `time` stetig (auch bei Tempowechseln), y ändert sich nur beim Umbruch außerhalb des
 * Bildes. Länge ~ Tempo, Einblendung der Bahnen nacheinander über die Stärke.
 */
export function speedLaneAt(i: number, time: number, v: number, out: SpeedLane = { x: 0, y: 0, len: 0, a: 0 }): SpeedLane {
  const k = speedLineIntensity(v);
  const lane = Math.floor(i);
  out.a = lane < 0 || lane >= SPEED_LANES ? 0 : clamp(k * SPEED_LANES - lane, 0, 1);
  const speed = SPEED_LANE_BASE * (0.8 + 0.5 * hash1(lane * 3.17 + 1));
  const raw = hash1(lane * 7.31 + 2) * LANE_PERIOD - time * speed;
  const cycle = Math.floor(raw / LANE_PERIOD);
  out.x = raw - cycle * LANE_PERIOD - SPEED_LANE_MAX_LEN;
  out.y = 48 + hash1(lane * 12.9898 + cycle * 78.233 + 5) * (VIEW_H - 96);
  const vv = Number.isFinite(v) ? clamp(v, 0, 1400) : 0;
  out.len = (50 + 0.2 * vv) * (0.8 + 0.4 * hash1(lane * 5.53 + 9));
  return out;
}

/** Welten mit hellem Hintergrund: dort dunkle Streifen mit heller Gegenkontur statt weißer Haarlinien. */
export const LIGHT_WORLDS: ReadonlySet<string> = new Set(["oper", "prater", "wachau"]);

export interface SpeedLineStyle {
  color: string;
  /** Gegenkontur (1 px, hinter/um die Linie) */
  outline: string;
  /** Deckkraft-Faktor bei voller Stärke */
  alpha: number;
}

const SPEED_LINE_DARK: SpeedLineStyle = { color: "#ffffff", outline: "rgba(20,24,40,0.35)", alpha: 0.5 };
const SPEED_LINE_LIGHT: SpeedLineStyle = { color: "#5b3a24", outline: "rgba(255,255,255,0.7)", alpha: 0.5 };

/** Farbschema der Streifen nach Welt-ID (statische Objekte, keine Allokation). */
export function speedLineStyle(worldId: string): SpeedLineStyle {
  return LIGHT_WORLDS.has(worldId) ? SPEED_LINE_LIGHT : SPEED_LINE_DARK;
}

// --- Tod-Pose ---------------------------------------------------------------------------------------------------------

/** Kippen 0 → -70° in 0,5 s (ease-out), 25 px Rutsch nach hinten, bis zu 4 kreisende Sternchen. */
export const DEATH_TIP_TIME = 0.5;
export const DEATH_TIP_ANGLE = (-70 * Math.PI) / 180;
export const DEATH_SLIDE = -25;
export const DEATH_ORBIT_MAX = 4;
/** Die Sternchen erscheinen, sobald die Figur liegt (ab hier eins pro DEATH_ORBIT_STEP Sekunden). */
export const DEATH_ORBIT_START = 0.45;
export const DEATH_ORBIT_STEP = 0.08;

export interface DeathPose {
  /** Drehung um die Körpermitte in Radiant (negativ = nach hinten kippen). */
  rot: number;
  /** Versatz in x in px (negativ = nach hinten). */
  dx: number;
  /** Anzahl kreisender Sternchen 0..DEATH_ORBIT_MAX. */
  orbit: number;
}

/** Pose `t` Sekunden nach Beginn der Sterbephase. Mit `reduced` nur Kippen – kein Rutsch, keine Sternchen. */
export function deathPose(t: number, reduced: boolean, out: DeathPose = { rot: 0, dx: 0, orbit: 0 }): DeathPose {
  const u = Number.isFinite(t) ? clamp(t / DEATH_TIP_TIME, 0, 1) : 0;
  const ease = 1 - (1 - u) * (1 - u) * (1 - u);
  out.rot = DEATH_TIP_ANGLE * ease + 0; // + 0 vermeidet -0
  out.dx = reduced ? 0 : DEATH_SLIDE * ease + 0;
  out.orbit = reduced || !Number.isFinite(t) || t < DEATH_ORBIT_START ? 0 : Math.min(DEATH_ORBIT_MAX, 1 + Math.floor((t - DEATH_ORBIT_START) / DEATH_ORBIT_STEP));
  return out;
}
