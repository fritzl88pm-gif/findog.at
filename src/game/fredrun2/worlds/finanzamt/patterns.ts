/**
 * Finanzamt bei Nacht – Level-Muster (28). Signatur: Riesenstempel (Zeit-Sprung), Laser-Gitter im Takt (niedrig → springen,
 * hoch → rutschen), Förderbänder (schnell/bremsend), Aktenlawinen, Schredder-Lücken mit Karton-Inseln, Paternoster,
 * rollende Bürostühle, Fledermäuse, Papierflieger, Pendelleuchten. Setpieces: „Sicherheitsschleuse“ & „Papierlawine“.
 *
 * Alle zeitgesteuerten Gefahren (Stempel, Laser) sind unabhängig vom exakten Timing lösbar: Stempel werden übersprungen,
 * niedrige Laser übersprungen, hohe Laser unterrutscht. Das Timing entscheidet nur, OB man handeln muss.
 */
import { JUMP_HEIGHT } from "../../constants";
import type { PatternCtx, PatternDef, ZonePhase } from "../../types";
import { arriveT, coinRun, gapW, hopW, leadX, relWidth, strikePhases } from "../shared-a/pattern-kit";
import {
  BAT_H,
  BAT_W,
  CART_H,
  CART_HB,
  CART_W,
  CHAIR_H,
  CHAIR_W,
  COPIER_H,
  COPIER_W,
  HIGH_ELEV,
  HIGH_TOP,
  LOW_H,
  LOW_W,
  PLANE_H,
  PLANE_W,
  STAMP_H,
  STAMP_HB,
  STAMP_W,
} from "./geom";

const PAPER_VX = -300;

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

// --- Bausteine -----------------------------------------------------------------------------------

/** Riesenstempel, der schlägt, wenn die Figur ankommt (early > 0: früher; < 0: später, z.B. auf Bremsbändern). */
export function stamp(c: PatternCtx, dx: number, early = 0): void {
  const phases = strikePhases(c, dx + STAMP_W / 2, 0.85, 0.28, 0.75, 0.45, early);
  c.zone(dx, STAMP_W, STAMP_H, 0, phases, { skin: "stamp", hb: [...STAMP_HB] });
}

/** Laser-Takt: warn → aktiv → Pause (Periode ≈ 2.2 s → 2.0 s) */
export function laserPhases(c: PatternCtx): ZonePhase[] {
  const k = Math.min(1, c.diff / 9);
  return [
    { name: "warn", dur: 0.5 - 0.1 * k },
    { name: "active", dur: 0.95 + 0.35 * k },
    { name: "idle", dur: 0.75 - 0.25 * k },
  ];
}

/** Versatz, damit das Laser-Gitter bei Ankunft der Figur (Mitte bei xc) mitten in der aktiven Phase ist. */
function onOffset(c: PatternCtx, phases: ZonePhase[], xc: number, early: number): number {
  let total = 0;
  for (const p of phases) total += p.dur;
  const target = phases[0].dur + phases[1].dur * 0.5;
  return mod(target - (arriveT(c, xc) - early), total);
}

/** Niedriges Laser-Gitter (Schwelle am Boden, 84 px hoch) → springen. `on`: bei Ankunft sicher aktiv. */
export function laserLow(c: PatternCtx, dx: number, on = true, early = 0, w = LOW_W): void {
  const ph = laserPhases(c);
  const offset = on ? onOffset(c, ph, dx + w / 2, early) : c.rng.range(0, 2);
  c.zone(dx, w, LOW_H, 0, ph, { skin: "laser-low", loop: true, offset, hb: [6, 4, w - 12, LOW_H - 4] });
}

/** Breite eines hohen Laser-Vorhangs (in ≤ 0.3 s Rutschzeit durchquerbar, < Warnzeit) */
export function highW(c: PatternCtx): number {
  return Math.round(Math.max(84, Math.min(150, c.t(0.2))));
}

/** Hoher Laser-Vorhang von der Decke bis 76 px über dem Boden → rutschen. */
export function laserHigh(c: PatternCtx, dx: number, on = true, early = 0, w = highW(c)): void {
  const ph = laserPhases(c);
  const h = c.groundY - HIGH_ELEV - HIGH_TOP;
  const offset = on ? onOffset(c, ph, dx + w / 2, early) : c.rng.range(0, 2);
  c.zone(dx, w, h, HIGH_ELEV, ph, { skin: "laser-high", loop: true, offset, hb: [4, 0, w - 8, h] });
  // Unsichtbare, harmlose Deckenkante: wer unter dem Vorhang rutscht, bleibt unten (wie bei echten Überhängen)
  const guard = c.overhead(dx, w, HIGH_ELEV, { skin: "laser-guard", thick: 60, hb: [2, 0, w - 4, 56] });
  guard.harmful = false;
}

function paperStack(c: PatternCtx, dx: number, w: number, h: number, vx = 0, warn = false): void {
  c.block(dx, w, h, { skin: "paper-stack", breakable: true, vx: vx || undefined, warn, hb: [w * 0.1, h * 0.1, w * 0.8, h * 0.9] });
}

/** Aktenstapel, der mit PAPER_VX heranrutscht und die Figur bei der virtuellen Position D trifft. */
function slidingStack(c: PatternCtx, D: number, h: number, warn: boolean, arrive?: number): void {
  const w = 76;
  const t = arrive ?? arriveT(c, D);
  paperStack(c, D - PAPER_VX * t, w, h, PAPER_VX, warn);
  c.coinsOver(D, relWidth(c, w, PAPER_VX), h + 70, 5);
}

function chair(c: PatternCtx, D: number, vx: number): number {
  c.walker(leadX(c, D, vx), CHAIR_W, CHAIR_H, { skin: "office-chair", vx, stompable: false, warn: vx < -200 });
  return D + relWidth(c, CHAIR_W, vx);
}

function chairVx(c: PatternCtx): number {
  return -Math.round(Math.min(270, 170 + c.diff * 13));
}

function bat(c: PatternCtx, D: number, elev: number, ph = 0): number {
  const vx = -110;
  c.flyer(leadX(c, D, vx), BAT_W, BAT_H, elev, { skin: "bat", vx, amp: 16, per: 1.5, ph, stompable: true });
  return D + relWidth(c, BAT_W, vx);
}

function plane(c: PatternCtx, D: number, high: boolean): number {
  const vx = -Math.round(Math.min(460, 340 + c.diff * 12));
  c.projectile(leadX(c, D, vx), PLANE_W, PLANE_H, high ? 84 : 14, { skin: "paper-plane", vx, warn: true });
  if (high) c.coinLine(D - 60, 26, 3, 50);
  else c.coinsOver(D, relWidth(c, PLANE_W, vx), 130, 5);
  return D + relWidth(c, PLANE_W, vx);
}

/** Schredder-Lücke */
function shredder(c: PatternCtx, dx: number, w: number): void {
  c.pit(dx, w, { skin: "shredder" });
}

/** Aktenwagen (Körper schädlich, Oberseite begehbar); rollt optional mit vx. Rückgabe: virtuelles Ende. */
function cart(c: PatternCtx, D: number, vx = 0, coins = true): number {
  const x = vx ? leadX(c, D, vx) : D;
  c.block(x, CART_W, CART_H, { skin: "file-cart", vx: vx || undefined, warn: vx < 0, hb: [...CART_HB] });
  c.platform(x, CART_W, CART_H, { skin: "cart-top", thick: 14, vx: vx || undefined });
  const rel = vx ? relWidth(c, CART_W, vx) : CART_W;
  if (coins) {
    c.coin(D - c.t(0.16), 150);
    c.coin(D + 10, 196);
    c.coinLine(D + rel * 0.35, CART_H + 60, 2, rel * 0.3);
  }
  return D + rel;
}

/** Aufzugskabine / Paternoster als bewegliche Plattform */
function cabin(c: PatternCtx, dx: number, w: number, elev: number, amp: number, per: number, ph: number, skin = "elevator"): void {
  c.platform(dx, w, elev, { skin, thick: 20, ampY: amp, per, ph });
}

// --- Muster ---------------------------------------------------------------------------------------

export const FINANZAMT_PATTERNS: PatternDef[] = [
  // ================= Einsteiger (0 – 1.5)
  {
    id: "fa-akten",
    minDiff: 0,
    weight: 2.6,
    tags: ["hop"],
    build(c) {
      const w = c.rng.int(64, 86);
      const h = c.rng.int(56, 92);
      paperStack(c, 0, w, h);
      c.coinsOver(0, w, h + 90);
      return w;
    },
  },
  {
    id: "fa-ordner",
    minDiff: 0,
    weight: 2,
    tags: ["hop"],
    build(c) {
      const w = hopW(c, c.rng.int(96, 128));
      const h = c.rng.int(58, 66);
      c.block(0, w, h, { skin: "binders", hb: [6, 8, w - 12, h - 8] });
      c.coinsOver(0, w, h + 100, 6);
      return w;
    },
  },
  {
    id: "fa-kartons",
    minDiff: 0.3,
    weight: 1.8,
    tags: ["hop"],
    build(c) {
      const w = c.rng.int(86, 104);
      const h = c.diff < 1 ? 74 : c.rng.pick([74, 108, 120]);
      c.block(0, w, h, { skin: "boxes", breakable: true, hb: [8, 8, w - 16, h - 8] });
      c.coinsOver(0, w, Math.min(JUMP_HEIGHT - 10, h + 80), 6);
      return w;
    },
  },
  {
    id: "fa-band",
    minDiff: 0,
    weight: 1.5,
    tags: ["special"],
    build(c) {
      const w = Math.round(c.rng.range(380, 540));
      c.speedzone(0, w, 1.35, { skin: "belt-fast" });
      c.coinLine(30, 40, Math.floor((w - 40) / 58), 58);
      if (c.diff >= 1.2) {
        const bx = w + c.t(0.8);
        paperStack(c, bx, 70, 72);
        c.coinsOver(bx, 70, 160, 5);
        return bx + 70;
      }
      return w;
    },
  },
  {
    id: "fa-haengeregister",
    minDiff: 0.4,
    weight: 1.8,
    tags: ["slide"],
    build(c) {
      const w = c.rng.int(170, 300);
      c.overhead(0, w, 72, { skin: "hanging-files", thick: 520 });
      c.coinLine(18, 26, Math.max(3, Math.floor((w - 20) / 54)), 54);
      return w;
    },
  },
  {
    id: "fa-schredder",
    minDiff: 0.6,
    weight: 1.8,
    tags: ["gap"],
    build(c) {
      const w = Math.round(gapW(c, c.rng.int(170, 250)));
      shredder(c, 0, w);
      c.coinArc(-30, w + 60, 150, 6);
      return w;
    },
  },
  {
    id: "fa-buerostuhl",
    minDiff: 0.8,
    weight: 1.8,
    tags: ["enemy"],
    build(c) {
      const vx = chairVx(c);
      const end = chair(c, 0, vx);
      c.coinsOver(0, end, 190, 6);
      return end;
    },
  },
  // ================= Mittel
  {
    id: "fa-rollwagen",
    minDiff: 1.0,
    weight: 1.4,
    tags: ["hop", "special"],
    build(c) {
      const vx = c.diff >= 3 ? -Math.round(Math.min(160, 60 + c.diff * 12)) : 0;
      let end = cart(c, 0, vx);
      if (c.diff >= 2.5) end = cart(c, end + c.t(0.32), vx);
      return end;
    },
  },
  {
    id: "fa-stempel",
    minDiff: 1.1,
    weight: 1.8,
    tags: ["timing"],
    build(c) {
      stamp(c, 0);
      c.coinsOver(0, STAMP_W, 180, 6);
      return STAMP_W;
    },
  },
  {
    id: "fa-laser-tief",
    minDiff: 1.3,
    weight: 1.6,
    tags: ["timing", "hop"],
    build(c) {
      laserLow(c, 0, c.diff < 2.2 || c.rng.chance(0.7));
      c.coinsOver(0, LOW_W, 150, 5);
      return LOW_W;
    },
  },
  {
    id: "fa-kopierer",
    minDiff: 1.4,
    weight: 1.3,
    tags: ["hop", "combo"],
    build(c) {
      c.block(0, COPIER_W, COPIER_H, { skin: "copier", hb: [8, 10, COPIER_W - 16, COPIER_H - 10] });
      c.coinsOver(0, COPIER_W, 180, 6);
      if (c.diff < 2.5) return COPIER_W;
      const ox = COPIER_W + c.t(0.95);
      const ow = c.rng.int(180, 250);
      c.overhead(ox, ow, 72, { skin: c.rng.chance(0.5) ? "duct" : "hanging-files", thick: 520 });
      c.coinLine(ox + 12, 26, Math.floor(ow / 54), 54);
      return ox + ow;
    },
  },
  {
    id: "fa-laser-hoch",
    minDiff: 1.6,
    weight: 1.6,
    tags: ["slide", "timing"],
    build(c) {
      const w = highW(c);
      laserHigh(c, 0, c.diff < 2.4 || c.rng.chance(0.7), 0, w);
      c.coinLine(-40, 24, Math.max(3, Math.floor((w + 80) / 50)), 50);
      return w;
    },
  },
  {
    id: "fa-kartonbruecke",
    minDiff: 1.6,
    weight: 1.3,
    tags: ["gap"],
    build(c) {
      const side = Math.round(gapW(c, c.jumpDist * 0.42));
      const pw = Math.round(Math.max(140, Math.min(230, c.t(0.36))));
      const w = side * 2 + pw;
      const elev = c.rng.int(60, 92);
      shredder(c, 0, w);
      c.platform(side, pw, elev, { skin: "box-plat", thick: 22, crumble: c.diff >= 3.5 ? 0.7 : 0 });
      c.coinArc(-20, side + 60, elev + 90, 4);
      c.coinLine(side + 24, elev + 60, Math.max(2, Math.floor((pw - 30) / 56)), 56);
      c.coinArc(side + pw - 40, side + 70, elev + 80, 4);
      return w;
    },
  },
  {
    id: "fa-fledermaus",
    minDiff: 1.8,
    weight: 1.4,
    tags: ["enemy"],
    build(c) {
      const end = bat(c, 0, 66, c.rng.range(0, 6.28));
      c.coinArc(-c.t(0.3), c.t(0.6) + 60, 220, 6);
      return end;
    },
  },
  {
    id: "fa-pendelleuchte",
    minDiff: 2.0,
    weight: 1.3,
    tags: ["slide", "timing"],
    build(c) {
      c.swinger(0, 520, 420, { skin: "lamp-swing", amp: 0.55, per: 2.6, ph: c.rng.range(0, Math.PI * 2), r: 30 });
      c.coinLine(-150, 24, 7, 50);
      return 240;
    },
  },
  {
    id: "fa-bremsband",
    minDiff: 2.0,
    weight: 1.2,
    tags: ["special", "timing"],
    build(c) {
      // Rückwärts laufendes Band (0.7) – ein Laser-Gitter mitten drauf schlägt entsprechend später an
      const w = Math.round(c.t(2.0));
      c.speedzone(0, w, 0.7, { skin: "belt-slow" });
      const lx = Math.round(c.t(0.85));
      const late = (lx + LOW_W / 2) / c.speed * (1 / 0.7 - 1);
      laserLow(c, lx, true, -late);
      c.coinLine(24, 40, Math.floor((lx - 60) / 58), 58);
      c.coinsOver(lx, LOW_W, 150, 5);
      c.coinLine(lx + LOW_W + 90, 40, Math.max(2, Math.floor((w - lx - LOW_W - 110) / 58)), 58);
      return w;
    },
  },
  {
    id: "fa-papierflieger",
    minDiff: 2.2,
    weight: 1.2,
    tags: ["enemy", "timing"],
    build(c) {
      const first = c.rng.chance(0.5);
      let end = plane(c, 0, first);
      if (c.diff >= 4) end = plane(c, end + c.t(1.0), !first);
      return end;
    },
  },
  {
    id: "fa-paternoster",
    minDiff: 2.2,
    weight: 1.1,
    tags: ["gap", "special"],
    build(c) {
      const cw = Math.round(Math.max(150, Math.min(220, c.t(0.3))));
      const side = Math.round(gapW(c, c.jumpDist * 0.34));
      const mid = Math.round(Math.max(90, c.t(0.16)));
      const w = side * 2 + cw * 2 + mid;
      const ph = c.rng.range(0, Math.PI * 2);
      c.pit(0, w, { skin: "shaft" });
      cabin(c, side, cw, 92, 58, 3.0, ph, "paternoster");
      cabin(c, side + cw + mid, cw, 92, 58, 3.0, ph + Math.PI, "paternoster");
      c.coinArc(-20, side + 60, 170, 4);
      c.coinLine(side + 30, 200, 2, cw - 60);
      c.coinLine(side + cw + mid + 30, 200, 2, cw - 60);
      c.coinArc(side + cw * 2 + mid - 40, side + 80, 170, 4);
      return w;
    },
  },
  {
    id: "fa-aufzug",
    minDiff: 1.4,
    weight: 1.0,
    tags: ["gap", "special", "reward"],
    build(c) {
      // Lastenaufzug über einem Schacht: mitfahren lohnt sich (Münzen oben), rüberspringen geht auch
      const cw = Math.round(Math.max(170, Math.min(240, c.t(0.34))));
      const side = Math.round(gapW(c, c.jumpDist * 0.4));
      const w = side * 2 + cw;
      c.pit(0, w, { skin: "shaft" });
      cabin(c, side, cw, 120, 80, 3.4, c.rng.range(0, Math.PI * 2), "elevator");
      c.coinArc(-20, side + 60, 180, 4);
      c.coinLine(side + 24, 290, Math.max(2, Math.floor((cw - 30) / 56)), 56);
      c.coinArc(side + cw - 40, side + 70, 190, 4);
      return w;
    },
  },
  {
    id: "fa-aktenlawine",
    minDiff: 2.4,
    weight: 1.3,
    tags: ["enemy", "timing"],
    build(c) {
      const n = c.diff < 4 ? 2 : 3;
      const gap = c.t(1.1);
      for (let i = 0; i < n; i += 1) slidingStack(c, i * gap, c.rng.pick([70, 84, 98]), i === 0);
      return (n - 1) * gap + 90;
    },
  },
  {
    id: "fa-stempelstrasse",
    minDiff: 2.8,
    weight: 1.2,
    tags: ["timing", "combo"],
    build(c) {
      const n = c.diff < 5 ? 2 : 3;
      const gap = STAMP_W + c.t(1.0);
      for (let i = 0; i < n; i += 1) {
        stamp(c, i * gap);
        c.coinsOver(i * gap, STAMP_W, 175, 5);
      }
      return (n - 1) * gap + STAMP_W;
    },
  },
  {
    id: "fa-fledermaus-schwarm",
    minDiff: 4.2,
    weight: 1.1,
    tags: ["enemy", "combo"],
    build(c) {
      const sp = c.t(0.95);
      bat(c, 0, 66, 0.3);
      bat(c, sp, 150, 2.1);
      const end = bat(c, sp * 2, 64, 4.2);
      c.coinLine(0, 250, 3, Math.max(80, sp * 0.6));
      return end;
    },
  },
  // ================= Schwer (≥ 5)
  {
    id: "fa-laser-wechsel",
    minDiff: 4.8,
    weight: 1.2,
    tags: ["combo", "timing"],
    build(c) {
      laserLow(c, 0);
      c.coinsOver(0, LOW_W, 150, 5);
      const hw = highW(c);
      const hx = LOW_W + c.t(1.0);
      laserHigh(c, hx, true, 0, hw);
      c.coinLine(hx - 30, 24, Math.floor((hw + 60) / 50), 50);
      if (c.diff < 7) return hx + hw;
      const lx = hx + hw + c.t(0.9);
      laserLow(c, lx);
      c.coinsOver(lx, LOW_W, 150, 5);
      return lx + LOW_W;
    },
  },
  {
    id: "fa-stempel-schredder",
    minDiff: 5.2,
    weight: 1.1,
    tags: ["combo", "gap"],
    build(c) {
      stamp(c, 0);
      c.coinsOver(0, STAMP_W, 175, 5);
      const px = STAMP_W + c.t(1.0);
      const pw = Math.round(gapW(c, 230));
      shredder(c, px, pw);
      c.coinArc(px - 30, pw + 60, 150, 6);
      return px + pw;
    },
  },
  {
    id: "fa-stuhl-lawine",
    minDiff: 5.5,
    weight: 1.1,
    tags: ["enemy", "combo"],
    build(c) {
      const end = chair(c, 0, chairVx(c));
      c.coinsOver(0, end, 190, 5);
      const d1 = end + c.t(1.05);
      slidingStack(c, d1, 84, true);
      const d2 = d1 + c.t(1.1);
      slidingStack(c, d2, 98, false);
      return d2 + 90;
    },
  },
  {
    id: "fa-express",
    minDiff: 6.0,
    weight: 1.0,
    tags: ["combo", "special"],
    build(c) {
      // Schnellband → Laser-Schwelle am Bandende → Schredder
      const bw = Math.round(c.t(1.0));
      c.speedzone(0, bw, 1.35, { skin: "belt-fast" });
      c.coinLine(24, 40, Math.floor((bw - 60) / 58), 58);
      const lx = bw + Math.round(c.t(0.25));
      const early = (bw / c.speed) * (1 - 1 / 1.35);
      laserLow(c, lx, true, early);
      c.coinsOver(lx, LOW_W, 150, 5);
      const px = lx + LOW_W + c.t(1.0);
      const pw = Math.round(gapW(c, 220));
      shredder(c, px, pw);
      c.coinArc(px - 30, pw + 60, 150, 6);
      return px + pw;
    },
  },
  {
    id: "fa-nachtschicht",
    minDiff: 6.5,
    weight: 1.0,
    tags: ["combo"],
    build(c) {
      const hw = highW(c);
      laserHigh(c, 0, true, 0, hw);
      c.coinLine(-30, 24, Math.floor((hw + 60) / 50), 50);
      // Schredder mit Karton-Insel
      const p0 = hw + c.t(0.95);
      const side = Math.round(gapW(c, c.jumpDist * 0.4));
      const pw = Math.round(Math.max(140, Math.min(210, c.t(0.3))));
      shredder(c, p0, side * 2 + pw);
      c.platform(p0 + side, pw, 70, { skin: "box-plat", thick: 22 });
      c.coinArc(p0 - 20, side + 60, 160, 4);
      c.coinArc(p0 + side + pw - 40, side + 70, 150, 4);
      const sx = p0 + side * 2 + pw + c.t(1.0);
      stamp(c, sx);
      c.coinsOver(sx, STAMP_W, 175, 5);
      return sx + STAMP_W;
    },
  },
  // ================= Setpieces
  {
    id: "fa-sicherheitsschleuse",
    minDiff: 3.2,
    weight: 0.75,
    tags: ["special", "timing"],
    build(c) {
      // Laser-Schleuse: 4–6 Gitter schalten im Takt nacheinander scharf, genau wenn die Figur sie erreicht.
      const n = c.diff < 4.5 ? 4 : c.diff < 7 ? 5 : 6;
      const gapT = Math.max(0.95, 1.2 - c.diff * 0.025);
      let x = 0;
      let prev = false;
      let run = 0;
      for (let i = 0; i < n; i += 1) {
        let high = i === 0 ? false : c.rng.chance(0.5);
        if (i > 0 && high === prev && run >= 2) high = !high;
        run = i > 0 && high === prev ? run + 1 : 1;
        prev = high;
        if (high) {
          const w = highW(c);
          laserHigh(c, x, true, 0, w);
          c.coinLine(x - 30, 24, Math.floor((w + 60) / 50), 50);
          x += w;
        } else {
          laserLow(c, x);
          c.coinsOver(x, LOW_W, 150, 5);
          x += LOW_W;
        }
        x += c.t(gapT);
      }
      // Belohnung: Edelstein mit Münzkranz hinter der Schleuse
      const gx = x - c.t(gapT) + c.t(0.45);
      c.pickup("gem", gx, 150);
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2;
        c.coin(gx + Math.cos(a) * 58, 150 + Math.sin(a) * 58);
      }
      return gx + 70;
    },
  },
  {
    id: "fa-papierlawine",
    minDiff: 3.6,
    weight: 0.7,
    tags: ["special", "enemy"],
    build(c) {
      // Rückwärtsband, über das eine Lawine aus Aktenstapeln heranrutscht (Dash zerlegt sie → Punkte)
      const n = c.diff < 6 ? 4 : 5;
      const f = 0.7;
      const T = 1.1;
      const s = c.speed;
      const D0 = c.t(0.9);
      const tP0 = arriveT(c, 0) + D0 / (f * s);
      const x00 = D0 - PAPER_VX * tP0;
      const d = T * (0.9 * s - PAPER_VX);
      const w = 76;
      let lastD = D0;
      for (let i = 0; i < n; i += 1) {
        const h = i % 2 === 0 ? 76 : 100;
        paperStack(c, x00 + i * d, w, h, PAPER_VX, i === 0);
        const D = D0 + i * T * 0.9 * s;
        c.coinsOver(D, relWidth(c, w, PAPER_VX), h + 70, 5);
        lastD = D;
      }
      const bw = Math.round(lastD + c.t(0.7));
      c.speedzone(0, bw, f, { skin: "belt-slow" });
      const gx = bw + c.t(0.3);
      c.pickup("gem", gx, 150);
      coinRun(c, gx - 120, gx + 120, 60, 60, 60);
      return gx + 60;
    },
  },
];
