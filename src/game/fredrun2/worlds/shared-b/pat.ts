/** Muster- und System-Helfer für die Agent-B-Welten. */
import { JUMP_AIR_TIME, SPRING_V, GRAVITY, PLAYER_SX } from "../../constants";
import type { Sim } from "../../sim";
import type { Ent, PatternCtx } from "../../types";

/** Sekunden → Pixel beim aktuellen Tempo. */
export const T = (c: PatternCtx, s: number): number => c.t(s);

/** Maximale Breite eines überspringbaren Hindernisses (Regel: ≤ 0.6 × jumpDist), mit Sicherheitsfaktor. */
export function hopMax(c: PatternCtx, k = 0.55): number {
  return c.jumpDist * k;
}

/** Breite begrenzen (überspringbar) */
export function hopW(c: PatternCtx, w: number, k = 0.55): number {
  return Math.min(w, hopMax(c, k));
}

/** Flugzeit eines Trampolin-Sprungs (hoch + runter) */
export const SPRING_AIR = (2 * SPRING_V) / GRAVITY;
/** Scheitelhöhe eines Trampolin-Sprungs */
export const SPRING_APEX = (SPRING_V * SPRING_V) / (2 * GRAVITY);

/** Münzkreis ("Ring-Bonus") um Mittelpunkt (dx, elev) */
export function coinRing(c: PatternCtx, dx: number, elev: number, r: number, n: number, withCenter: "gem" | "coin" | null = null): void {
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    c.coin(dx + Math.cos(a) * r, elev + Math.sin(a) * r);
  }
  if (withCenter === "gem") c.pickup("gem", dx, elev);
  else if (withCenter === "coin") c.coin(dx, elev);
}

/** Münzen entlang einer Trampolin-Flugbahn (Start dx = Federmitte), `n` Stück bis zur Landung */
export function coinSpringArc(c: PatternCtx, dx: number, n: number, uptoFrac = 1): void {
  const air = SPRING_AIR * uptoFrac;
  for (let i = 1; i <= n; i += 1) {
    const t = (i / n) * air;
    const h = SPRING_V * t - 0.5 * GRAVITY * t * t;
    c.coin(dx + c.t(t), 59 + h);
  }
}

/** Münzen entlang eines normalen Sprungbogens ab Absprung dx (Figurmitte), n Stück */
export function coinJumpArc(c: PatternCtx, dx: number, n: number): void {
  const air = JUMP_AIR_TIME;
  const v = (GRAVITY * air) / 2;
  for (let i = 1; i < n; i += 1) {
    const t = (i / n) * air;
    const h = v * t - 0.5 * GRAVITY * t * t;
    c.coin(dx + c.t(t), 59 + h);
  }
}

/** Nächste Entität eines Skins im Bereich vor dem Spieler (für Systeme). */
export function forEachAhead(sim: Sim, maxAhead: number, fn: (e: Ent, dx: number) => void): void {
  const px = sim.playerWorldX;
  for (const e of sim.ents) {
    if (e.dead) continue;
    const dx = e.x - px;
    if (dx < -400 || dx > maxAhead) continue;
    fn(e, dx);
  }
}

/** Bildschirm-x einer Weltposition */
export function screenX(sim: Sim, worldX: number): number {
  return worldX - sim.dist;
}

export { PLAYER_SX };
