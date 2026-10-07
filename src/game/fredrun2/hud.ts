import { clamp, mix, roundRect } from "./draw-utils";
import { drawCoinVector, drawHeartVector, drawPowerupVector, HUD_COIN_R, HUD_HEART_BAR, HUD_HEART_R, HUD_POWERUP_R, hudSprites, type HudSprite, type HudSpriteKind } from "./pickups";
import { FONT } from "./particles";
import { ENERGY_MAX, MAGNET_TIME, MAX_HEARTS, SHIELD_TIME, SLOWMO_TIME, TURBO_TIME, VIEW_H, VIEW_W } from "./constants";
import type { PickupType } from "./types";
import { fitText, formatNumber, type FitResult } from "./ui-logic";

export interface HudPowerup {
  kind: PickupType;
  /** verbleibende Zeit 0..1 */
  frac: number;
  /** verbleibende Zeit in Sekunden (Blinken unter 2 s); fehlt das Feld, gilt frac * Gesamtdauer des Power-ups */
  left?: number;
}

export interface HudToast {
  title: string;
  sub?: string;
  /** 0..1 Fortschritt */
  u: number;
  color: string;
}

export interface HudState {
  score: number;
  meters: number;
  hearts: number;
  coins: number;
  combo: number;
  comboFrac: number;
  energy: number;
  dashCost: number;
  powerups: HudPowerup[];
  toast: HudToast | null;
  worldName: string;
  accent: string;
  best: number;
  hint: string | null;
  tourFrac: number | null;
  time: number;
  chaseWarn: number;
  /** Touch-Modus: Energiering liegt um den Dash-Knopf (gemessen: HudDrawCtx.dashCenter, sonst TOUCH_DASH) unten rechts, Hinweis oben mittig */
  touch: boolean;
  /** "Weniger Bewegung": keine Bumps, Pops und kein Wackeln (Farben bleiben) */
  reduced?: boolean;
  /** Sekunden seit dem letzten abgelehnten Dash (fehlt = 99, also kein Effekt) */
  dashDeniedT?: number;
  /** Rekord in diesem Lauf bereits überholt: "Rekord" zeigt dann den eigenen laufenden Score */
  recordPassed?: boolean;
}

/** Mitte eines DOM-Knopfs in Logikeinheiten der Bühne (1280 x 720) */
export interface ButtonCenter {
  cx: number;
  cy: number;
}

/**
 * Optionaler Zusatz für drawHud: HudFx (Rückmeldung), CSS-Breite der Bühne / 1280 (kleine Bühnen) und die gemessene Lage der
 * Touch-Knöpfe. Ohne ctx wie bisher.
 */
export interface HudDrawCtx {
  fx?: HudFx | null;
  cssScale?: number;
  /**
   * Gemessene Mitte von .touchDash (siehe domButtonCenter). Der Knopf wird im CSS um die Safe-Area-Abstände verschoben
   * (--safe-b, --safe-r), die das Canvas nicht kennen kann; der Energiering folgt deshalb dieser Messung. Fehlt der Wert
   * (oder liegt er außerhalb der Bühne), gilt TOUCH_DASH.
   */
  dashCenter?: ButtonCenter | null;
  /** Gemessene Mitte von .touchSlide (wie dashCenter, --safe-l und --safe-b): die Power-up-Reihe hält Abstand dazu. Fehlt: TOUCH_SLIDE. */
  slideCenter?: ButtonCenter | null;
}

/**
 * Mittelpunkt und Radius des Dash-Knopfs in Logikeinheiten, wenn KEINE Safe-Area-Abstände wirken. Muss zu .touchDash im CSS
 * passen: 130*px groß, right 26*px, bottom 24*px -> Mitte (1280-26-65, 720-24-65). Im Touch-Modus liegt der Energiering
 * konzentrisch dazu (Radius r + 9).
 *
 * Achtung: Im CSS kommen zu right/bottom noch --safe-r und --safe-b hinzu (env(safe-area-inset-*) abzüglich Letterbox).
 * Auf einem Handy quer (höhenbegrenzte Bühne, Letterbox 0) sind das rund 21 CSS-px nach oben, bei Skala 0,54 also etwa 39
 * Logikeinheiten. Die Konstante ist daher nur der Rückfall; die tatsächliche Lage liefert HudDrawCtx.dashCenter.
 */
export const TOUCH_DASH = { cx: 1189, cy: 631, r: 65 } as const;
/** Rutschen-Knopf (.touchSlide: 130*px, left 26*px, bottom 26*px) ohne Safe-Area-Abstände; Rückfall für HudDrawCtx.slideCenter */
export const TOUCH_SLIDE = { cx: 91, cy: 629, r: 65 } as const;

interface DomRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Rechnet die Mitte eines DOM-Knopfs (getBoundingClientRect) in Logikeinheiten der Bühne um: (Mitte - Bühnen-Ecke) / (Bühnenbreite / 1280)
 * - gleichbedeutend mit Division durch --px. Liefert null bei unbrauchbaren Maßen (Knopf ausgeblendet, Bühne ohne Breite). Ruft man
 * bei Resize und Laufstart auf, nicht pro Frame (legt ein Objekt an).
 */
export function domButtonCenter(btn: DomRectLike, stage: DomRectLike): ButtonCenter | null {
  const k = stage.width / VIEW_W;
  if (!(k > 0) || !Number.isFinite(k) || !(btn.width > 0) || !(btn.height > 0)) return null;
  const cx = (btn.left + btn.width / 2 - stage.left) / k;
  const cy = (btn.top + btn.height / 2 - stage.top) / k;
  return Number.isFinite(cx) && Number.isFinite(cy) ? { cx, cy } : null;
}

/** Gemessene Mitte, wenn sie endlich ist und auf der Bühne liegt, sonst der Rückfall (kein neues Objekt). */
export function resolveButtonCenter(measured: ButtonCenter | null | undefined, fallback: ButtonCenter): ButtonCenter {
  if (!measured || !Number.isFinite(measured.cx) || !Number.isFinite(measured.cy)) return fallback;
  if (measured.cx < 0 || measured.cx > VIEW_W || measured.cy < 0 || measured.cy > VIEW_H) return fallback;
  return measured;
}

// --- Zeitfunktionen und Skalen (rein, ohne Canvas; per Vitest geprüft) --------------------------------------------

/** Dauer des Zahlen-Bumps (Münzen, Kombo, Score) in Sekunden und sein Zuwachs (Skala 1 + BUMP_GAIN beim Start) */
export const BUMP_TIME = 0.22;
export const BUMP_GAIN = 0.22;
/** Score-Anzeige folgt dem Score mit dieser Rate (1/s) und rastet bei kleinerem Abstand ein */
export const SCORE_EASE_RATE = 14;
export const SCORE_SNAP = 1.5;
/** Ein Score-Sprung ab dieser Größe in einem Schritt (Münze = 10 * Kombo, Stampfer 60, ...) löst den Bump aus; Strecke zählt nicht */
export const SCORE_BUMP_MIN = 8;
/** Herzverlust-Pop (Geist wächst 1 -> 1,5 und verblasst) und Herzgewinn-Pop-In in Sekunden */
export const HEART_LOSS_TIME = 0.5;
export const HEART_GAIN_TIME = 0.35;
export const HEART_LOSS_GROW = 0.5;
/** Power-up-Warnung: unter dieser Restzeit (s) blinkt der Ring mit BLINK_HZ zwischen BLINK_MIN und 1 */
export const BLINK_BELOW = 2;
export const BLINK_HZ = 5;
export const BLINK_MIN = 0.45;
/** Abgelehnter Dash: Ring wackelt und blinkt rot so lange (s); Auslenkung in Logikeinheiten */
export const DASH_DENIED_TIME = 0.25;
export const DASH_DENIED_SHAKE = 6;
/** Eck-Skalierung kleiner Bühnen: uiScale = clamp(UI_SCALE_TARGET / cssScale, 1, UI_SCALE_MAX) */
export const UI_SCALE_TARGET = 0.72;
export const UI_SCALE_MAX = 1.35;
/** Die Herz-/Score-Gruppe oben links wächst höchstens so weit (sonst kollidiert sie mit dem Hinweis oben mittig) */
export const UI_SCALE_TOP_LEFT_MAX = 1.2;

/** Skala der Eck-Gruppen aus cssScale = CSS-Breite der Bühne / 1280; ab 0,72 und bei fehlendem Wert 1. */
export function uiScaleFor(cssScale: number | undefined): number {
  if (cssScale === undefined || !(cssScale > 0) || !Number.isFinite(cssScale)) return 1;
  return clamp(UI_SCALE_TARGET / cssScale, 1, UI_SCALE_MAX);
}

/**
 * Ein Schritt des Score-Hochzählens: disp += (target - disp) * (1 - exp(-dt * 14)); unter 1,5 Abstand rastet die Anzeige ein.
 * Konvergiert monoton ohne Überschwingen (Faktor < 1); ein kleinerer Zielwert (neuer Lauf) gilt sofort.
 */
export function easeScore(disp: number, target: number, dt: number): number {
  if (!Number.isFinite(target)) return 0;
  if (!Number.isFinite(disp) || target < disp || Math.abs(target - disp) < SCORE_SNAP) return target;
  if (!(dt > 0)) return disp;
  return disp + (target - disp) * (1 - Math.exp(-dt * SCORE_EASE_RATE));
}

/** Bump-Kurve: 1 im Moment des Ereignisses `t0`, linear auf 0 nach BUMP_TIME (0 ohne Ereignis). */
export function bumpValue(clock: number, t0: number): number {
  if (!(clock >= t0)) return 0;
  return Math.max(0, 1 - (clock - t0) / BUMP_TIME);
}

/** Skala einer Zahl mit Bump: 1 + 0,22 * bump, bei "Weniger Bewegung" immer 1. */
export function bumpScale(bump: number, reduced: boolean): number {
  return reduced ? 1 : 1 + BUMP_GAIN * clamp(bump, 0, 1);
}

/** true, wenn der Power-up-Ring warnt (Restzeit bekannt und unter BLINK_BELOW). */
export function powerupWarning(left: number | undefined): boolean {
  return left !== undefined && left < BLINK_BELOW;
}

/**
 * Alpha des Power-up-Rings: ab BLINK_BELOW Restsekunden 5 Hz zwischen 0,45 und 1, sonst 1. Bei "Weniger Bewegung" bleibt es 1
 * (die weiße Ringkontur warnt trotzdem, nur das Flackern entfällt).
 */
export function blinkAlpha(left: number | undefined, t: number, reduced: boolean): number {
  if (reduced || !powerupWarning(left)) return 1;
  return BLINK_MIN + (1 - BLINK_MIN) * (0.5 + 0.5 * Math.cos(t * Math.PI * 2 * BLINK_HZ));
}

/** Seitlicher Wackel-Versatz des Energierings (Logikeinheiten): nur bei 0 <= dashDeniedT < 0,25 s und nie bei "Weniger Bewegung". */
export function dashWobble(dashDeniedT: number | undefined, reduced: boolean): number {
  if (reduced || dashDeniedT === undefined || !(dashDeniedT >= 0) || dashDeniedT >= DASH_DENIED_TIME) return 0;
  const u = dashDeniedT / DASH_DENIED_TIME;
  return Math.sin(u * Math.PI * 6) * DASH_DENIED_SHAKE * (1 - u);
}

/** Rot-Anteil 0..1 des abgelehnten Dashs (bleibt kurz voll, verblasst dann); 0 außerhalb von 0 <= dashDeniedT < 0,25 s. Gilt auch bei reduced. */
export function dashDeniedFlash(dashDeniedT: number | undefined): number {
  if (dashDeniedT === undefined || !(dashDeniedT >= 0) || dashDeniedT >= DASH_DENIED_TIME) return 0;
  const u = dashDeniedT / DASH_DENIED_TIME;
  return 1 - u * u;
}

/** easeOutBack (0 -> 1 mit kleinem Überschwinger) für das Herz-Pop-In. */
export function easeOutBack(u: number): number {
  const x = clamp(u, 0, 1) - 1;
  return 1 + 2.70158 * x * x * x + 1.70158 * x * x;
}

// --- HudFx: Rückmeldung (Hochzählen, Bumps, Herz-Pops) -----------------------------------------------------------------

const NEVER = Number.NEGATIVE_INFINITY;

/**
 * Hält die Vorwerte des HUDs und leitet daraus die Animationen ab. Der Renderer ruft pro Frame update(h, dt) und übergibt die
 * Instanz an drawHud. Ereignisse werden aus Wertwechseln erkannt (kein Signal vom Hub nötig): Münzen/Kombo steigen -> Bump,
 * Score springt um >= 8 -> Bump, Herzen sinken -> Verlust-Pop, steigen -> Pop-In. Ein neuer Lauf (Score oder Meter fallen) oder
 * der erste Aufruf setzt ohne Effekte zurück. Bei reduced entstehen keine Bumps/Pops. Allokationsfrei im Betrieb.
 */
export class HudFx {
  /** Eigene Uhr (s): läuft nur mit dem übergebenen dt, steht also in der Pause still */
  clock = 0;
  /** Gezeigter (gleitender) Score */
  displayScore = 0;
  private ready = false;
  private lastScore = 0;
  private lastMeters = 0;
  private lastCoins = 0;
  private lastCombo = 0;
  private lastHearts = 0;
  private scoreT0 = NEVER;
  private coinT0 = NEVER;
  private comboT0 = NEVER;
  private readonly heartT0: number[] = new Array<number>(MAX_HEARTS).fill(NEVER);
  /** 0 = nichts, 1 = Verlust, 2 = Gewinn */
  private readonly heartKind: number[] = new Array<number>(MAX_HEARTS).fill(0);

  /** Verwirft alle Animationen und übernimmt die nächsten Werte ohne Effekt (z. B. bei Laufstart). */
  reset(): void {
    this.ready = false;
  }

  update(h: HudState, dt: number): void {
    const step = dt > 0 && Number.isFinite(dt) ? Math.min(dt, 0.25) : 0;
    this.clock += step;
    const reduced = h.reduced === true;
    const hearts = clamp(Math.floor(Number.isFinite(h.hearts) ? h.hearts : 0), 0, MAX_HEARTS);
    if (!this.ready || h.score < this.lastScore || h.meters < this.lastMeters - 0.5) {
      this.ready = true;
      this.displayScore = h.score;
      this.scoreT0 = this.coinT0 = this.comboT0 = NEVER;
      for (let i = 0; i < MAX_HEARTS; i += 1) {
        this.heartT0[i] = NEVER;
        this.heartKind[i] = 0;
      }
    } else {
      if (!reduced) {
        if (h.score - this.lastScore >= SCORE_BUMP_MIN) this.scoreT0 = this.clock;
        if (h.coins > this.lastCoins) this.coinT0 = this.clock;
        if (h.combo > 1 && h.combo > this.lastCombo) this.comboT0 = this.clock;
        if (hearts < this.lastHearts) {
          for (let i = hearts; i < this.lastHearts; i += 1) {
            this.heartT0[i] = this.clock;
            this.heartKind[i] = 1;
          }
        } else if (hearts > this.lastHearts) {
          for (let i = this.lastHearts; i < hearts; i += 1) {
            this.heartT0[i] = this.clock;
            this.heartKind[i] = 2;
          }
        }
      }
      this.displayScore = easeScore(this.displayScore, h.score, step);
    }
    this.lastScore = h.score;
    this.lastMeters = h.meters;
    this.lastCoins = h.coins;
    this.lastCombo = h.combo;
    this.lastHearts = hearts;
  }

  /** Bump 1..0 (seit dem letzten Ereignis) für Score, Münzzahl und Kombo-Zahl */
  get scoreBump(): number {
    return bumpValue(this.clock, this.scoreT0);
  }
  get coinBump(): number {
    return bumpValue(this.clock, this.coinT0);
  }
  get comboBump(): number {
    return bumpValue(this.clock, this.comboT0);
  }

  /** Fortschritt 0..1 des Verlust-Pops an Herz-Platz `i`, -1 wenn keiner läuft */
  lossU(i: number): number {
    if (this.heartKind[i] !== 1) return -1;
    const u = (this.clock - this.heartT0[i]) / HEART_LOSS_TIME;
    return u >= 0 && u < 1 ? u : -1;
  }

  /** Fortschritt 0..1 des Pop-Ins an Herz-Platz `i`, -1 wenn keiner läuft */
  gainU(i: number): number {
    if (this.heartKind[i] !== 2) return -1;
    const u = (this.clock - this.heartT0[i]) / HEART_GAIN_TIME;
    return u >= 0 && u < 1 ? u : -1;
  }
}

// --- Zeichenhelfer -----------------------------------------------------------------------------------------------------

const POWER_COLOR: Record<string, string> = { magnet: "#ff6b6b", shield: "#67e8f9", slowmo: "#c4b5fd", turbo: "#fde047" };
const POWER_SPRITE: Record<string, HudSpriteKind> = { magnet: "pu-magnet", shield: "pu-shield", slowmo: "pu-slowmo", turbo: "pu-turbo" };
const POWER_TIME: Record<string, number> = { magnet: MAGNET_TIME, shield: SHIELD_TIME, slowmo: SLOWMO_TIME, turbo: TURBO_TIME };
const GOLD = "#ffd23f";

/** Ränder und Anker der Eck-Gruppen (Logikeinheiten) */
const TL_X = 22;
const TL_Y = 18;
const TR_X = VIEW_W - 22;
const BL_X = 22;
const BL_Y = 698;
/** Platz rechts von der Pause-Taste (DOM, rechter Rand bei x = 1084) bis zum rechten Eck-Rand: so breit darf die Münz-Gruppe werden */
const TR_ROOM = 166;
/** Start der Power-up-Reihe: Tastatur 148, Touch etwas weiter rechts (der Rutschen-Knopf reicht bis x = 156) */
const POWER_X = 148;
const POWER_X_TOUCH = 158;

function panel(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 18, fill = "rgba(14,18,34,0.55)"): void {
  roundRect(g, x, y, w, h, r);
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = "rgba(255,255,255,0.14)";
  g.stroke();
}

const fontCache: Record<number, string> = {};
/** Schrift-Strings je (Gewicht, Größe) einmalig bauen statt pro Aufruf */
function fontOf(weight: number, size: number): string {
  const k = weight * 1000 + size;
  return fontCache[k] ?? (fontCache[k] = `${weight} ${size}px ${FONT}`);
}

function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color = "#fff", align: CanvasTextAlign = "left", weight = 800): void {
  g.font = fontOf(weight, size);
  g.textAlign = align;
  g.textBaseline = "alphabetic";
  g.lineJoin = "round";
  g.lineWidth = Math.max(4, size * 0.16);
  g.strokeStyle = "rgba(12,16,32,0.8)";
  g.strokeText(s, x, y);
  g.fillStyle = color;
  g.fillText(s, x, y);
}

/** Skaliert um den Ankerpunkt (ax, ay): Eck-Gruppen wachsen von ihrer Ecke aus. */
function anchor(g: CanvasRenderingContext2D, ax: number, ay: number, k: number): void {
  g.translate(ax, ay);
  g.scale(k, k);
  g.translate(-ax, -ay);
}

/** Formatierter Zahlentext mit Zwischenspeicher: formatNumber läuft nur, wenn sich die Zahl ändert. */
interface NumText {
  n: number;
  s: string;
}
const numText = (): NumText => ({ n: Number.NaN, s: "" });
function cachedNum(c: NumText, n: number, prefix = "", suffix = ""): string {
  if (c.n !== n) {
    c.n = n;
    c.s = prefix + formatNumber(n) + suffix;
  }
  return c.s;
}
const scoreText = numText();
const metersText = numText();
const coinsText = numText();
const comboText = numText();
const bestText = numText();
const liveRecordText = numText();

/** Bitmap-Pixel je Logikeinheit der Zeichenfläche (Renderer-Skala); 1 ohne Canvas-Angabe */
function pixelScale(g: CanvasRenderingContext2D): number {
  const c = g.canvas as HTMLCanvasElement | undefined;
  return c && c.width > 0 ? c.width / VIEW_W : 1;
}

function drawSprite(g: CanvasRenderingContext2D, s: HudSprite, ox: number, oy: number): void {
  g.drawImage(s.canvas, ox + s.x, oy + s.y, s.w, s.h);
}

/** Herz bei (cx, cy): Sprite (kein shadowBlur, kein Verlauf im Frame) oder, ohne Canvas, Vektor. `k` = Zusatz-Skala (Pop). */
function drawHeart(g: CanvasRenderingContext2D, cx: number, cy: number, kind: HudSpriteKind, t: number, k: number, bake: number): void {
  const urgent = kind === "heart-urgent";
  const sprite = hudSprites.get(kind, bake);
  if (sprite) {
    // Herzschlag wie drawHeartVector: bei letztem Leben schneller und stärker
    const beat = (1 + Math.sin(t * (urgent ? 11 : 6)) * (urgent ? 0.11 : 0.05)) * k;
    g.save();
    g.translate(cx, cy);
    g.scale(beat, beat);
    drawSprite(g, sprite, 0, 0);
    g.restore();
  } else if (k === 1) {
    drawHeartVector(g, cx, cy, HUD_HEART_R, t, kind !== "heart-empty", urgent);
  } else {
    g.save();
    g.translate(cx, cy);
    g.scale(k, k);
    drawHeartVector(g, 0, 0, HUD_HEART_R, t, kind !== "heart-empty", urgent);
    g.restore();
  }
}

// --- Abschnitte --------------------------------------------------------------------------------------------------------

function drawTopLeft(g: CanvasRenderingContext2D, h: HudState, fx: HudFx | null, s: number, bake: number, score: number, reduced: boolean): void {
  const hasBest = h.best > 0;
  g.save();
  if (s !== 1) anchor(g, TL_X, TL_Y, s);
  panel(g, 22, 18, 292, hasBest ? 124 : 118);
  // rot hinterlegte Herz-Leiste (Verlauf als Sprite)
  const hx = 30;
  const hy = 25;
  const barSprite = hudSprites.get("heart-bar", bake);
  if (barSprite) {
    drawSprite(g, barSprite, hx, hy);
  } else {
    const bar = g.createLinearGradient(0, hy, 0, hy + HUD_HEART_BAR.h);
    bar.addColorStop(0, "rgba(150,14,28,0.75)");
    bar.addColorStop(1, "rgba(70,4,14,0.8)");
    roundRect(g, hx, hy, HUD_HEART_BAR.w, HUD_HEART_BAR.h, HUD_HEART_BAR.h / 2);
    g.fillStyle = bar;
    g.fill();
  }
  roundRect(g, hx, hy, HUD_HEART_BAR.w, HUD_HEART_BAR.h, HUD_HEART_BAR.h / 2);
  g.lineWidth = 2.5;
  if (h.hearts <= 1) {
    g.strokeStyle = "rgb(255,80,80)";
    g.globalAlpha = 0.65 + Math.sin(h.time * 11) * 0.3;
  } else {
    g.strokeStyle = "rgba(255,110,110,0.7)";
  }
  g.stroke();
  g.globalAlpha = 1;
  for (let i = 0; i < MAX_HEARTS; i += 1) {
    const x = 62 + i * 50;
    const filled = i < h.hearts;
    const t = h.time + i * 0.3;
    if (filled) {
      let k = 1;
      if (fx) {
        const gu = fx.gainU(i);
        if (gu >= 0) k = easeOutBack(gu);
      }
      if (k > 0.02) drawHeart(g, x, 51, h.hearts === 1 && i === 0 ? "heart-urgent" : "heart", t, k, bake);
    } else {
      drawHeart(g, x, 51, "heart-empty", t, 1, bake);
      if (fx) {
        // Verlust-Pop: gefülltes Herz wächst 1 -> 1,5 und verblasst, dazu ein kurzer roter Ring
        const lu = fx.lossU(i);
        if (lu >= 0) {
          const e = 1 - (1 - lu) * (1 - lu);
          g.globalAlpha = 1 - lu;
          drawHeart(g, x, 51, "heart", t, 1 + HEART_LOSS_GROW * e, bake);
          g.globalAlpha = 0.8 * (1 - lu);
          g.strokeStyle = "rgb(255,70,70)";
          g.lineWidth = 3;
          g.beginPath();
          g.arc(x, 51, HUD_HEART_R * (0.9 + 1.2 * e), 0, Math.PI * 2);
          g.stroke();
          g.globalAlpha = 1;
        }
      }
    }
  }
  // Score (mit Bump) und Meter
  const bump = bumpScale(fx ? fx.scoreBump : 0, reduced);
  if (bump !== 1) {
    g.save();
    anchor(g, 40, 104, bump);
  }
  text(g, cachedNum(scoreText, score), 40, 120, 46, "#fff");
  if (bump !== 1) g.restore();
  text(g, cachedNum(metersText, Math.floor(h.meters), "", " m"), 300, 120, 22, "rgba(255,255,255,0.75)", "right", 700);
  // Rekordjagd: Balken score/best unter dem Score (nur mit Rekord); ab 90 % in Gold
  if (hasBest) {
    const passed = h.recordPassed ?? score > h.best;
    const frac = passed ? 1 : clamp(score / h.best, 0, 1);
    g.fillStyle = "rgba(255,255,255,0.18)";
    roundRect(g, 40, 127, 260, 6, 3);
    g.fill();
    g.fillStyle = passed || frac >= 0.9 ? GOLD : "rgba(255,255,255,0.8)";
    roundRect(g, 40, 127, Math.max(6, 260 * frac), 6, 3);
    g.fill();
  }
  g.restore();
}

function drawTopRight(g: CanvasRenderingContext2D, h: HudState, fx: HudFx | null, u: number, ps: number, score: number, reduced: boolean): void {
  // Münzen: auf kleiner Bühne kompakt (Breite nach Ziffern) und höchstens so groß, dass die Pause-Taste frei bleibt
  const coins = cachedNum(coinsText, h.coins);
  const w = u > 1.0001 ? clamp(77 + coins.length * 17.5, 100, 156) : 156;
  const s = Math.max(1, Math.min(u, TR_ROOM / w));
  g.save();
  if (s !== 1) anchor(g, TR_X, TL_Y, s);
  const left = TR_X - w;
  panel(g, left, 18, w, 52);
  const iconX = left + 30;
  const sprite = hudSprites.get("coin", ps * s);
  {
    // Münz-Icon: wie drawCoinVector dreht es sich (Breite 0,28..1) und schwebt um 2 px
    const sx = 0.28 + 0.72 * Math.abs(Math.cos(h.time * 5));
    if (sprite) {
      g.save();
      g.translate(iconX, 44 + Math.sin(h.time * 3) * 2);
      g.scale(sx, 1);
      drawSprite(g, sprite, 0, 0);
      g.restore();
    } else {
      drawCoinVector(g, iconX, 44, HUD_COIN_R, h.time, 0);
    }
  }
  const bump = bumpScale(fx ? fx.coinBump : 0, reduced);
  if (bump !== 1) {
    g.save();
    anchor(g, VIEW_W - 44, 44, bump);
  }
  text(g, coins, VIEW_W - 44, 55, 30, GOLD, "right");
  if (bump !== 1) g.restore();
  g.restore();

  // Rekord-Zeile (eigene Skala u: kleinste HUD-Schrift bleibt auf kleiner Bühne >= 11 px)
  if (h.best > 0) {
    const passed = h.recordPassed ?? score > h.best;
    const gold = passed || score >= 0.9 * h.best;
    g.save();
    if (u !== 1) anchor(g, TR_X, TL_Y, u);
    const label = passed ? cachedNum(liveRecordText, score, "Rekord ") : cachedNum(bestText, h.best, "Rekord ");
    text(g, label, VIEW_W - 44, 96, 18, gold ? GOLD : "rgba(255,255,255,0.7)", "right", 700);
    g.restore();
  }
}

function drawCombo(g: CanvasRenderingContext2D, h: HudState, fx: HudFx | null, reduced: boolean): void {
  const cx = VIEW_W / 2;
  const w = 150;
  panel(g, cx - w / 2, 18, w, 58, 20);
  const bump = bumpScale(fx ? fx.comboBump : 0, reduced);
  if (bump !== 1) {
    g.save();
    anchor(g, cx, 46, bump);
  }
  text(g, cachedNum(comboText, h.combo, "×"), cx, 58, 40, "#ffe066", "center", 900);
  if (bump !== 1) g.restore();
  g.fillStyle = "rgba(255,255,255,0.18)";
  roundRect(g, cx - w / 2 + 14, 64, w - 28, 6, 3);
  g.fill();
  g.fillStyle = "#ffe066";
  roundRect(g, cx - w / 2 + 14, 64, Math.max(6, (w - 28) * clamp(h.comboFrac, 0, 1)), 6, 3);
  g.fill();
}

/**
 * Energie-/Dash-Ring. Tastatur: unten links (Eck-Gruppe). Touch: konzentrisch um den Dash-Knopf, direkt außerhalb seines Rands;
 * `dash` ist die gemessene Mitte des DOM-Knopfs (inkl. Safe-Area-Abstände), ohne gültigen Wert TOUCH_DASH.
 */
function drawEnergyRing(g: CanvasRenderingContext2D, h: HudState, reduced: boolean, dash: ButtonCenter | null | undefined): void {
  const touch = h.touch;
  const dt = h.dashDeniedT;
  const dc = touch ? resolveButtonCenter(dash, TOUCH_DASH) : TOUCH_DASH;
  const cx = (touch ? dc.cx : 74) + dashWobble(dt, reduced);
  const cy = touch ? dc.cy : 652;
  const r = touch ? TOUCH_DASH.r + 9 : 36;
  const ready = h.energy >= h.dashCost;
  if (touch) {
    // dunkle Unterlage als Ring um den Knopf (der Knopf selbst deckt die Mitte ab)
    g.lineWidth = 25;
    g.strokeStyle = "rgba(14,18,34,0.6)";
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
  } else {
    g.fillStyle = "rgba(14,18,34,0.6)";
    g.beginPath();
    g.arc(cx, cy, r + 8, 0, Math.PI * 2);
    g.fill();
  }
  g.lineWidth = 9;
  g.strokeStyle = "rgba(255,255,255,0.14)";
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = ready ? "#7ee8ff" : "#4aa8c8";
  g.lineCap = "round";
  g.beginPath();
  g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(h.energy / ENERGY_MAX, 0, 1));
  g.stroke();
  // abgelehnter Dash: roter Blitz über dem Ring
  const flash = dashDeniedFlash(dt);
  if (flash > 0) {
    g.globalAlpha = 0.9 * flash;
    g.strokeStyle = "#ff4d4d";
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = 1;
  }
  // Markierung Dash-Kosten
  const ang = -Math.PI / 2 + Math.PI * 2 * (h.dashCost / ENERGY_MAX);
  g.strokeStyle = "rgba(255,255,255,0.85)";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(cx + Math.cos(ang) * (r - 8), cy + Math.sin(ang) * (r - 8));
  g.lineTo(cx + Math.cos(ang) * (r + 8), cy + Math.sin(ang) * (r + 8));
  g.stroke();
  if (touch) {
    // der DOM-Knopf trägt Symbol und Aufleuchten; hier nur ein feiner Puls außen, wenn der Dash bereit ist
    if (ready) {
      g.globalAlpha = 0.5 + 0.3 * Math.sin(h.time * 7);
      g.strokeStyle = "#7ee8ff";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(cx, cy, r + 7, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
    }
    return;
  }
  if (ready) {
    g.globalAlpha = 0.2 + 0.15 * Math.sin(h.time * 7);
    g.fillStyle = "#7ee8ff";
    g.beginPath();
    g.arc(cx, cy, r - 6, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
  }
  g.fillStyle = ready ? "#fff" : "rgba(255,255,255,0.5)";
  g.beginPath();
  g.moveTo(cx - 12, cy - 13);
  g.lineTo(cx + 2, cy);
  g.lineTo(cx - 12, cy + 13);
  g.lineTo(cx - 12, cy + 6);
  g.lineTo(cx - 18, cy + 6);
  g.lineTo(cx - 18, cy - 6);
  g.lineTo(cx - 12, cy - 6);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(cx + 2, cy - 13);
  g.lineTo(cx + 16, cy);
  g.lineTo(cx + 2, cy + 13);
  g.closePath();
  g.fill();
}

/** Abstand zwischen Power-up-Ring (Platte r 30) und Rutschen-Knopf (r 65), der mindestens bleibt */
const POWER_SLIDE_GAP = 3;
const POWER_CY = 660;

/**
 * Startposition (linke Kante, vor der Eck-Skalierung) der Power-up-Reihe. Tastatur: 148. Touch: 158, bei verschobenem
 * Rutschen-Knopf (Safe-Area links) so weit rechts, dass der erste Ring den Knopf auch nach der Skalierung `u` um die Ecke
 * (BL_X, BL_Y) nicht berührt. Wandert der Knopf nach oben (Safe-Area unten), wächst nur der Abstand: es bleibt bei 158.
 */
export function powerupStartX(touch: boolean, slide: ButtonCenter | null | undefined, u = 1): number {
  if (!touch) return POWER_X;
  const sc = resolveButtonCenter(slide, TOUCH_SLIDE);
  const need = TOUCH_SLIDE.r + 30 * u + POWER_SLIDE_GAP;
  const dy = BL_Y + (POWER_CY - BL_Y) * u - sc.cy;
  const dx = need > Math.abs(dy) ? Math.sqrt(need * need - dy * dy) : 0;
  // gewünschte Ringmitte nach der Skalierung -> vor der Skalierung -> linke Kante des Rings (Mitte - 26)
  const cx = BL_X + (sc.cx + dx - BL_X) / u;
  return Math.max(POWER_X_TOUCH, Math.ceil(cx - 26));
}

function drawPowerups(g: CanvasRenderingContext2D, h: HudState, bake: number, reduced: boolean, startX: number): void {
  let px = startX;
  for (let i = 0; i < h.powerups.length; i += 1) {
    const p = h.powerups[i];
    const col = POWER_COLOR[p.kind] ?? "#fff";
    const cx = px + 26;
    const cy = POWER_CY;
    const left = p.left ?? p.frac * (POWER_TIME[p.kind] ?? 0);
    const warn = powerupWarning(left);
    g.globalAlpha = blinkAlpha(left, h.time, reduced);
    g.fillStyle = "rgba(14,18,34,0.6)";
    g.beginPath();
    g.arc(cx, cy, 30, 0, Math.PI * 2);
    g.fill();
    // Symbol: Blasen-Optik (vorgerendert), statt der Buchstaben/Sonderzeichen früher
    const sprite = hudSprites.get(POWER_SPRITE[p.kind] ?? "pu-magnet", bake);
    if (sprite) drawSprite(g, sprite, cx, cy);
    else drawPowerupVector(g, p.kind, cx, cy, HUD_POWERUP_R, 0);
    g.lineWidth = 6;
    g.strokeStyle = "rgba(255,255,255,0.14)";
    g.beginPath();
    g.arc(cx, cy, 24, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = col;
    g.lineCap = "round";
    g.beginPath();
    g.arc(cx, cy, 24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(p.frac, 0, 1));
    g.stroke();
    if (warn) {
      // weiße Ringkontur in den letzten Sekunden (auch bei "Weniger Bewegung", dort ohne Blinken)
      g.lineWidth = 2.5;
      g.strokeStyle = "rgba(255,255,255,0.9)";
      g.beginPath();
      g.arc(cx, cy, 29, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
    px += 70;
  }
}

// --- Hinweis-Pille -----------------------------------------------------------------------------------------------------

/** Schrift der Pille: 23 px, bei Platzmangel bis 17 px, dann zwei Zeilen */
const HINT_MAX_PX = 23;
const HINT_MIN_PX = 17;
const HINT_PAD = 22;
const HINT_MAX_W = 880;

let measureTarget: CanvasRenderingContext2D | null = null;
function measureHint(s: string, px: number): number {
  const g = measureTarget;
  if (!g) return s.length * px * 0.55;
  g.font = fontOf(700, px);
  return g.measureText(s).width;
}

/**
 * Höchstbreite der Hinweis-Pille in Bühnen-Logikeinheiten (nach Skalierung). Tastatur (unten): zwischen den Ringen unten links
 * (Energiering bzw. `powerCount` Power-up-Ringe) und der gespiegelten Gegenseite. Touch (oben mittig): zwischen Herz-/Score-Gruppe
 * (Rechtskante 22 + 292 * uTopLeft) und der gespiegelten Gegenseite. Nie mehr als 880.
 */
export function hintMaxWidth(touch: boolean, u: number, uTopLeft: number, powerCount: number): number {
  const edge = touch ? TL_X + 292 * uTopLeft : BL_X + (powerCount > 0 ? 182 + 70 * (powerCount - 1) : 96) * u;
  return clamp(2 * (VIEW_W / 2 - (edge + 14)), 200, HINT_MAX_W);
}

interface HintLayout {
  text: string;
  maxW: number;
  fit: FitResult;
  /** Breite der Pille in lokalen Einheiten */
  w: number;
}
let hintLayout: HintLayout | null = null;

/** Zeichnet die Hinweis-Pille und liefert ihre Unterkante (Bühnen-Y, nach Skalierung) – nur im Touch-Modus oben, sonst 0. */
function drawHint(g: CanvasRenderingContext2D, h: HudState, hint: string, u: number, uTopLeft: number): number {
  const touch = h.touch;
  const limit = hintMaxWidth(touch, u, uTopLeft, h.powerups.length) / u;
  let lay = hintLayout;
  if (!lay || lay.text !== hint || lay.maxW !== limit) {
    measureTarget = g;
    const fit = fitText(measureHint, hint, limit - HINT_PAD * 2, HINT_MAX_PX, HINT_MIN_PX);
    let tw = 0;
    for (let i = 0; i < fit.lines.length; i += 1) tw = Math.max(tw, measureHint(fit.lines[i], fit.px));
    measureTarget = null;
    lay = { text: hint, maxW: limit, fit, w: Math.min(limit, tw + HINT_PAD * 2) };
    hintLayout = lay;
  }
  const px = lay.fit.px;
  const two = lay.fit.lines.length > 1;
  const lineH = Math.round(px * 1.25);
  const ph = two ? lineH * 2 + 22 : 50;
  // Tastatur: Unterkante bei y = 682 (wie bisher); Touch: Oberkante bei y = 100 unter dem Kombo-Panel
  const ay = touch ? 100 : 682;
  g.save();
  g.translate(VIEW_W / 2, ay);
  g.scale(u, u);
  const top = touch ? 0 : -ph;
  panel(g, -lay.w / 2, top, lay.w, ph, two ? 22 : 25);
  if (two) {
    text(g, lay.fit.lines[0], 0, top + 11 + lineH * 0.82, px, "#fff", "center", 700);
    text(g, lay.fit.lines[1], 0, top + 11 + lineH * 1.82, px, "#fff", "center", 700);
  } else {
    text(g, lay.fit.lines[0], 0, top + ph / 2 + px * 0.4, px, "#fff", "center", 700);
  }
  g.restore();
  return touch ? ay + ph * u : 0;
}

// --- Banner ------------------------------------------------------------------------------------------------------------

interface ToastLayout {
  title: string;
  sub: string;
  w: number;
}
let toastLayout: ToastLayout | null = null;
let lightKey = "";
let lightVal = "";

/** Akzentfarbe um 35 % Richtung Weiß aufhellen (gecacht); Nicht-Hex-Farben bleiben unverändert. */
function lighten(color: string): string {
  if (color !== lightKey) {
    lightKey = color;
    lightVal = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? mix(color, "#ffffff", 0.35) : color;
  }
  return lightVal;
}

/**
 * Banner mit Platte. `minY` = früheste Grundlinie (unter der Hinweis-Pille); `tlRight`/`tlBottom` = Rechts-/Unterkante der Herz-Gruppe:
 * ragt die Platte hinein, rutscht das Banner darunter (auf kleinen Bühnen wächst die Gruppe).
 */
function drawToast(g: CanvasRenderingContext2D, toast: HudToast, minY: number, tlRight: number, tlBottom: number): void {
  const u = toast.u;
  const a = u < 0.15 ? u / 0.15 : u > 0.75 ? Math.max(0, (1 - u) / 0.25) : 1;
  g.globalAlpha = a;
  const sub = toast.sub ?? "";
  let lay = toastLayout;
  if (!lay || lay.title !== toast.title || lay.sub !== sub) {
    g.font = fontOf(900, 54);
    let w = g.measureText(toast.title).width;
    if (sub) {
      g.font = fontOf(700, 26);
      w = Math.max(w, g.measureText(sub).width);
    }
    lay = { title: toast.title, sub, w };
    toastLayout = lay;
  }
  // dunkle Platte hinter dem Banner: der Himmel hinter dem Text bleibt egal (Wien-Akzent hatte nur 2,6:1 Kontrast)
  const pw = Math.min(VIEW_W - 40, lay.w + 72);
  let base = Math.max(190, minY);
  if (VIEW_W / 2 - pw / 2 < tlRight && base - 64 < tlBottom) base = tlBottom + 72;
  const y = base + (1 - Math.min(1, u / 0.15)) * 16;
  const top = y - 64;
  panel(g, VIEW_W / 2 - pw / 2, top, pw, (sub ? y + 58 : y + 24) - top, 26, "rgba(14,18,34,0.72)");
  text(g, toast.title, VIEW_W / 2, y, 54, lighten(toast.color), "center", 900);
  if (sub) text(g, sub, VIEW_W / 2, y + 40, 26, "rgba(255,255,255,0.92)", "center", 700);
  g.globalAlpha = 1;
}

/**
 * Backt alle HUD-Sprites vorab (z. B. beim Laufstart oder nach einem Skalenwechsel), damit der erste HUD-Frame nicht backt.
 * `pixelScale` = Bitmap-Pixel je Logikeinheit (Bitmap-Breite / 1280), `cssScale` wie bei drawHud. Optional; ohne Aufruf backt
 * drawHud beim ersten Zeichnen (ca. 2 bis 3 ms einmalig). Liefert false ohne Canvas (Node).
 */
export function warmHudSprites(pixelScale: number, cssScale?: number): boolean {
  const u = uiScaleFor(cssScale);
  const uTL = Math.min(u, UI_SCALE_TOP_LEFT_MAX);
  let ok = true;
  for (const kind of ["heart", "heart-urgent", "heart-empty", "heart-bar"] as const) ok = hudSprites.get(kind, pixelScale * uTL) !== null && ok;
  ok = hudSprites.get("coin", pixelScale * u) !== null && ok;
  for (const kind of ["pu-magnet", "pu-shield", "pu-slowmo", "pu-turbo"] as const) ok = hudSprites.get(kind, pixelScale * u) !== null && ok;
  return ok;
}

// --- HUD ---------------------------------------------------------------------------------------------------------------

/**
 * Zeichnet das HUD in logischen 1280 x 720 Einheiten. Ohne `ctx` (und bei cssScale >= 0,72) bleibt das Layout wie bisher; mit
 * `ctx.fx` reagieren Score, Münzen, Kombo und Herzen, mit `ctx.cssScale` wachsen die Eck-Gruppen auf kleinen Bühnen.
 */
export function drawHud(g: CanvasRenderingContext2D, h: HudState, ctx?: HudDrawCtx): void {
  const fx = ctx?.fx ?? null;
  const u = uiScaleFor(ctx?.cssScale);
  const uTL = Math.min(u, UI_SCALE_TOP_LEFT_MAX);
  const reduced = h.reduced === true;
  const ps = pixelScale(g);
  const score = fx ? Math.round(fx.displayScore) : h.score;
  g.save();

  // --- Herzen + Punktestand + Rekordbalken (oben links), Münzen + Rekord (oben rechts) ---
  drawTopLeft(g, h, fx, uTL, ps * uTL, score, reduced);
  drawTopRight(g, h, fx, u, ps, score, reduced);

  // --- Combo (oben Mitte) ---
  if (h.combo > 1) drawCombo(g, h, fx, reduced);

  // --- Energie / Dash und aktive Power-ups ---
  if (h.touch) {
    // der Ring gehört zum Dash-Knopf (gemessene Lage, sonst TOUCH_DASH), die Power-ups wachsen unten links
    drawEnergyRing(g, h, reduced, ctx?.dashCenter);
    g.save();
    if (u !== 1) anchor(g, BL_X, BL_Y, u);
    drawPowerups(g, h, ps * u, reduced, powerupStartX(true, ctx?.slideCenter, u));
    g.restore();
  } else {
    g.save();
    if (u !== 1) anchor(g, BL_X, BL_Y, u);
    drawEnergyRing(g, h, reduced, null);
    drawPowerups(g, h, ps * u, reduced, POWER_X);
    g.restore();
  }

  // --- Tour-Fortschritt ---
  if (h.tourFrac !== null) {
    const w = 260;
    const x = VIEW_W / 2 - w / 2;
    const y = 700;
    g.fillStyle = "rgba(14,18,34,0.5)";
    roundRect(g, x, y, w, 8, 4);
    g.fill();
    g.fillStyle = h.accent;
    roundRect(g, x, y, Math.max(8, w * clamp(h.tourFrac, 0, 1)), 8, 4);
    g.fill();
  }

  // --- Hinweis (nur Anfangsphase) ---
  let hintBottom = 0;
  if (h.hint) hintBottom = drawHint(g, h, h.hint, u, uTL);

  // --- Toast (Welt / Stufe) ---
  // Banner-Grundlinie: unter der Hinweis-Pille oben (Touch), sonst bei y = 190 (Plattenoberkante = Grundlinie - 64)
  if (h.toast) drawToast(g, h.toast, hintBottom > 0 ? hintBottom + 72 : 0, TL_X + 292 * uTL, TL_Y + (h.best > 0 ? 124 : 118) * uTL);

  // --- Warnung (Lawine etc.) ---
  if (h.chaseWarn > 0.02) {
    g.globalAlpha = 0.18 * h.chaseWarn;
    g.fillStyle = "#ff3c3c";
    g.fillRect(0, 0, 160, 720);
    g.globalAlpha = 1;
  }
  g.restore();
}
