/**
 * Muster-Hilfen für die Welten Wien, Alpen und Finanzamt (Welten-Agent A).
 *
 * Kernidee: Muster werden gespawnt, sobald ihr Startpunkt SPAWN_AHEAD px vor `dist` liegt – also ≈ SPAWN_LEAD px vor der
 * Figur. Damit lässt sich (bei konstantem Tempo) vorhersagen, WANN die Figur eine Muster-Position erreicht. Das nutzen wir
 * für (a) bewegte Elemente (Straßenbahn, Fiaker, Steinbock …), die genau an einer „virtuellen“ Muster-Position auf die
 * Figur treffen sollen, und (b) einmalige Zonen (Blitz, Stempel), die im richtigen Moment zuschlagen.
 *
 * Fairness hängt NIE an dieser Vorhersage: alle so getimten Gefahren sind zusätzlich per Sprung/Rutschen lösbar.
 */
import { JUMP_AIR_TIME, PLAYER_SX, SPAWN_AHEAD } from "../../constants";
import type { EntSpec, PatternCtx, ZonePhase } from "../../types";

/** Abstand Muster-Start ↔ Figur im Moment des Spawns (px). */
export const SPAWN_LEAD = SPAWN_AHEAD - PLAYER_SX;

/** Sekunden ab Spawn, bis die Figur die Muster-Position `dx` erreicht. */
export function arriveT(c: PatternCtx, dx: number): number {
  return Math.max(0, (SPAWN_LEAD + dx) / c.speed);
}

/**
 * Startposition (relativ zum Muster) für ein Element mit Eigengeschwindigkeit `vx`, damit es genau dann bei der
 * virtuellen Position `D` ist, wenn die Figur dort ankommt.
 */
export function leadX(c: PatternCtx, D: number, vx: number): number {
  return D - vx * arriveT(c, D);
}

/** Relative Breite, die die Figur über einem Objekt der Breite w zurücklegt, das ihr mit vx entgegenkommt. */
export function relWidth(c: PatternCtx, w: number, vx: number): number {
  return (w * c.speed) / (c.speed - vx);
}

/**
 * Phasen einer einmaligen Zone (idle → warn → active → idle), so dass die Figur bei `xCenter` etwa beim Anteil `bias`
 * des aktiven Fensters ankommt. `early` verschiebt den Einschlag nach vorn (Sekunden).
 */
export function strikePhases(c: PatternCtx, xCenter: number, warn: number, active: number, after = 0.35, bias = 0.45, early = 0): ZonePhase[] {
  const t = arriveT(c, xCenter) - early;
  const lead = Math.max(0.05, t - warn - active * bias);
  return [
    { name: "idle", dur: lead },
    { name: "warn", dur: warn },
    { name: "active", dur: active },
    { name: "idle", dur: after },
  ];
}

/** Maximale sichere Breite eines Einzelsprung-Hindernisses (engine-Regel: ≤ 0.6 × jumpDist). */
export function hopW(c: PatternCtx, want: number): number {
  return Math.min(want, c.jumpDist * 0.6);
}

/** Maximale sichere Lückenbreite (Einzelsprung, mit Reserve). */
export function gapW(c: PatternCtx, want: number): number {
  return Math.min(want, c.jumpDist * 0.62);
}

/** Pixel für einen vollen Einzelsprung (Luftzeit). */
export function airPx(c: PatternCtx): number {
  return c.speed * JUMP_AIR_TIME;
}

/** Setzt nachträglich Felder an einem Spec (z.B. vy, hb), typ-sicher. */
export function tweak(spec: EntSpec, patch: Partial<EntSpec>): EntSpec {
  Object.assign(spec, patch);
  return spec;
}

/** Münzen entlang einer Geraden (für Dach-Surf-Bahnen, Aufwind-Säulen …). */
export function coinRun(c: PatternCtx, x0: number, x1: number, elev0: number, elev1: number, gap = 58, skin?: string): void {
  const n = Math.max(1, Math.floor((x1 - x0) / gap) + 1);
  for (let i = 0; i < n; i += 1) {
    const u = n === 1 ? 0 : i / (n - 1);
    c.coin(x0 + (x1 - x0) * u, elev0 + (elev1 - elev0) * u, skin ? { skin } : undefined);
  }
}
