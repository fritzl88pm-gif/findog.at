/**
 * Wien – Level-Muster (23): Poller, Hütchen, Bank, Pfützen, Gullys, Würstelstand, Tauben, Straßenbahn-Surfen,
 * Fiaker, Baugerüst, Blitzeinschläge, Baugrube, Dachziegel im Sturm, Wirtshausschild, herabstürzende Ziegel,
 * brennende Balken, Setpieces „Ringstraßen-Sprint“ und „Einsturz“.
 */
import { JUMP_HEIGHT } from "../../constants";
import type { PatternCtx, PatternDef } from "../../types";
import { arriveT, coinRun, gapW, hopW, leadX, relWidth, strikePhases } from "../shared-a/pattern-kit";
import { BOLT_H, BOLT_W } from "./system";

export const TRAM_H = 156;

// --- Bausteine -----------------------------------------------------------------------------------

/** Straßenbahn (Wagenkasten schädlich + Dach als Plattform). Rückgabe: virtuelles Ende (Figur verlässt das Dach). */
function tram(c: PatternCtx, D: number, W: number, vx: number, coins = true): number {
  const x0 = leadX(c, D, vx);
  c.block(x0, W, TRAM_H, { skin: "tram", vx, warn: true, hb: [14, 12, W - 28, TRAM_H - 12] });
  c.platform(x0, W, TRAM_H, { skin: "tram-roof", vx, thick: 16 });
  const rel = relWidth(c, W, vx);
  if (coins) {
    // Aufstiegsbogen + Dachbahn
    c.coin(D - c.t(0.21), 180);
    c.coin(D - c.t(0.07), 245);
    c.coin(D + c.t(0.06), 262);
    coinRun(c, D + c.t(0.3), D + rel - 60, TRAM_H + 56, TRAM_H + 56, 62);
  }
  return D + rel;
}

/** Zweiteiliger Zug mit Lücke: Rückgabe virtuelles Ende. */
function tramPair(c: PatternCtx, D: number, W1: number, gap: number, W2: number, vx: number): number {
  const x0 = leadX(c, D, vx);
  const hb1: [number, number, number, number] = [14, 12, W1 - 28, TRAM_H - 12];
  const hb2: [number, number, number, number] = [14, 12, W2 - 28, TRAM_H - 12];
  c.block(x0, W1, TRAM_H, { skin: "tram", vx, warn: true, hb: hb1 });
  c.platform(x0, W1, TRAM_H, { skin: "tram-roof", vx, thick: 16 });
  c.block(x0 + W1 + gap, W2, TRAM_H, { skin: "tram", vx, hb: hb2 });
  c.platform(x0 + W1 + gap, W2, TRAM_H, { skin: "tram-roof", vx, thick: 16 });
  const r1 = relWidth(c, W1, vx);
  const rg = relWidth(c, gap, vx);
  const r2 = relWidth(c, W2, vx);
  c.coin(D - c.t(0.21), 180);
  c.coin(D - c.t(0.07), 245);
  c.coin(D + c.t(0.06), 262);
  coinRun(c, D + c.t(0.3), D + r1 - 80, TRAM_H + 56, TRAM_H + 56, 62);
  // Bogen über die Lücke
  c.coinArc(D + r1 - 90, rg + 180, TRAM_H + 110, 5);
  coinRun(c, D + r1 + rg + 80, D + r1 + rg + r2 - 60, TRAM_H + 56, TRAM_H + 56, 62);
  return D + r1 + rg + r2;
}

function tramWidth(c: PatternCtx, vx: number, k = 1.15): number {
  return Math.round(Math.min(860, Math.max(520, c.jumpDist * k * ((c.speed - vx) / c.speed))));
}

function tramVx(c: PatternCtx): number {
  return -Math.round(Math.min(230, 130 + c.diff * 14));
}

function bolt(c: PatternCtx, dx: number, early = 0): void {
  const phases = strikePhases(c, dx + BOLT_W / 2, 0.9, 0.3, 0.6, 0.5, early);
  c.zone(dx, BOLT_W, BOLT_H, 0, phases, { skin: "bolt", hb: [8, 0, BOLT_W - 16, BOLT_H] });
}

function pigeons(c: PatternCtx, D: number, n: number, elev: number): number {
  const vx = -90;
  const x0 = leadX(c, D, vx);
  for (let i = 0; i < n; i += 1) {
    c.flyer(x0 + i * 64, 46, 34, elev + (i % 2) * 8, { skin: "pigeon", vx, amp: 7, per: 0.8, ph: i * 1.3, stompable: false });
  }
  return D + relWidth(c, (n - 1) * 64 + 46, vx);
}

function fiaker(c: PatternCtx, D: number): number {
  const vx = -Math.round(100 + Math.min(60, c.diff * 8));
  const w = 206;
  c.walker(leadX(c, D, vx), w, 148, { skin: "fiaker", vx, stompable: false, hb: [30, 14, w - 60, 134] });
  const rel = relWidth(c, w, vx);
  c.coinsOver(D, rel, 200, 7);
  return D + rel;
}

function rubble(c: PatternCtx, dx: number, w = 104, h = 62): void {
  c.block(dx, w, h, { skin: "rubble", hb: [10, 10, w - 20, h - 10] });
}

/** Herabstürzender Ziegel, der kurz vor Ankunft der Figur auf den Trümmerhaufen bei D kracht (sichtbarer Fall ≈ 0.7 s). */
function fallingBrick(c: PatternCtx, D: number, landElev: number): void {
  const g = 620;
  const T = Math.max(0.9, arriveT(c, D) - 0.65);
  const vx = -30;
  const h = 20;
  const y0 = -70;
  const landY = c.groundY - landElev;
  const vy0 = (landY - (y0 + h) - (g * T * T) / 2) / T;
  const spec = c.projectile(D - vx * T, 30, h, c.groundY - y0 - h, { skin: "brick", vx, gravity: g });
  spec.vy = vy0;
  spec.p = { ...spec.p, landY };
}

// --- Muster ---------------------------------------------------------------------------------------

export const WIEN_PATTERNS: PatternDef[] = [
  // ---------------- Einsteiger
  {
    id: "wien-poller",
    minDiff: 0,
    weight: 2.2,
    tags: ["hop"],
    build(c) {
      const n = c.diff < 0.6 ? 1 : c.rng.int(1, 2);
      const gap = c.t(0.62);
      for (let i = 0; i < n; i += 1) {
        c.block(i * gap, 34, 58, { skin: "poller", hb: [5, 6, 24, 52] });
        c.coinsOver(i * gap, 34, 120, 5);
      }
      return (n - 1) * gap + 34;
    },
  },
  {
    id: "wien-cones",
    minDiff: 0,
    weight: 1.8,
    tags: ["hop"],
    build(c) {
      const w = hopW(c, 118);
      c.block(0, w, 64, { skin: "cone", hb: [10, 8, w - 20, 56] });
      c.coinsOver(0, w, 150, 6);
      return w;
    },
  },
  {
    id: "wien-bench",
    minDiff: 0.2,
    weight: 1.6,
    tags: ["hop"],
    build(c) {
      const w = hopW(c, 132);
      c.block(0, w, 70, { skin: "bench", hb: [8, 12, w - 16, 58] });
      c.coinsOver(0, w, 170, 7);
      return w;
    },
  },
  {
    id: "wien-puddle",
    minDiff: 0,
    weight: 1.4,
    tags: ["special"],
    build(c) {
      const w = c.rng.int(300, 440);
      c.speedzone(0, w, 0.72, { skin: "puddle" });
      c.coinLine(30, 40, Math.floor((w - 40) / 56), 56);
      if (c.diff >= 1.5) {
        const bx = w + c.t(0.7);
        c.block(bx, 34, 58, { skin: "poller", hb: [5, 6, 24, 52] });
        return bx + 34;
      }
      return w;
    },
  },
  {
    id: "wien-gully",
    minDiff: 0.5,
    weight: 1.6,
    tags: ["gap"],
    build(c) {
      const w = gapW(c, c.rng.int(170, 240));
      c.pit(0, w, { skin: "manhole" });
      c.coinArc(-30, w + 60, 140, 6);
      return w;
    },
  },
  {
    id: "wien-wurstelstand",
    minDiff: 0.6,
    weight: 1.3,
    tags: ["hop"],
    build(c) {
      const w = hopW(c, 124);
      c.block(0, w, 124, { skin: "wurstel", hb: [10, 14, w - 20, 110] });
      c.coinsOver(0, w, JUMP_HEIGHT - 12, 7);
      return w;
    },
  },
  {
    id: "wien-tauben",
    minDiff: 0.9,
    weight: 1.5,
    tags: ["slide", "enemy"],
    build(c) {
      const n = c.diff < 2 ? 3 : 4;
      const end = pigeons(c, 0, n, 64);
      c.coinLine(0, 24, Math.max(3, Math.floor(end / 60)), 60);
      return end;
    },
  },
  // ---------------- Mittel
  {
    id: "wien-bim",
    minDiff: 1.2,
    weight: 1.7,
    tags: ["special"],
    build(c) {
      const vx = tramVx(c);
      return tram(c, 0, tramWidth(c, vx), vx);
    },
  },
  {
    id: "wien-fiaker",
    minDiff: 1.4,
    weight: 1.4,
    tags: ["enemy", "hop"],
    build(c) {
      return fiaker(c, 0);
    },
  },
  {
    id: "wien-geruest",
    minDiff: 1.3,
    weight: 1.4,
    tags: ["slide"],
    build(c) {
      const w = c.rng.int(260, 420);
      c.overhead(0, w, 72, { skin: "scaffold", thick: 760 });
      c.coinLine(20, 24, Math.floor((w - 20) / 56), 56);
      return w;
    },
  },
  {
    id: "wien-blitz",
    minDiff: 1.6,
    weight: 1.4,
    tags: ["timing"],
    build(c) {
      bolt(c, 0);
      c.coinsOver(0, BOLT_W, 170, 6);
      return BOLT_W;
    },
  },
  {
    id: "wien-baugrube",
    minDiff: 2.0,
    weight: 1.2,
    tags: ["gap"],
    build(c) {
      const pw = Math.round(Math.min(220, c.jumpDist * 0.4));
      const side = Math.round(gapW(c, c.jumpDist * 0.42));
      const w = side * 2 + pw;
      c.block(0, 100, 88, { skin: "bauzaun", hb: [8, 16, 84, 72] });
      c.coinsOver(0, 100, 170, 5);
      const p0 = 100 + c.t(0.6);
      c.pit(p0, w, { skin: "manhole" });
      c.platform(p0 + side, pw, 64, { skin: "plank", thick: 18 });
      c.coinArc(p0 - 20, side + 60, 120, 4);
      c.coinLine(p0 + side + 20, 110, Math.max(2, Math.floor(pw / 60)), 60);
      c.coinArc(p0 + side + pw - 40, side + 80, 120, 4);
      return p0 + w;
    },
  },
  {
    id: "wien-dachziegel",
    minDiff: 2.4,
    weight: 1.2,
    tags: ["enemy", "timing"],
    build(c) {
      const vx = -420;
      const D2 = c.t(1.15);
      c.projectile(leadX(c, 0, vx), 44, 22, 24, { skin: "rooftile", vx, warn: true });
      c.projectile(leadX(c, D2, vx), 44, 22, 80, { skin: "rooftile", vx, warn: true });
      c.coinArc(-c.t(0.25), c.t(0.6), 150, 5);
      c.coinLine(D2 - 40, 24, 3, 50);
      return D2 + 44;
    },
  },
  {
    id: "wien-wirtshausschild",
    minDiff: 2.6,
    weight: 1.1,
    tags: ["slide", "timing"],
    build(c) {
      c.swinger(0, 520, 400, { skin: "sign", amp: 0.72, per: 2.2, ph: c.rng.range(0, 6.28), r: 34 });
      c.coinLine(-120, 24, 5, 56);
      return 120;
    },
  },
  {
    id: "wien-doppelbim",
    minDiff: 3.0,
    weight: 1.2,
    tags: ["special", "combo"],
    build(c) {
      const vx = tramVx(c);
      const W1 = Math.round(Math.max(420, tramWidth(c, vx, 0.8)));
      const W2 = Math.round(Math.max(420, tramWidth(c, vx, 0.9)));
      const gap = Math.round(Math.min(260, 150 + c.diff * 12));
      return tramPair(c, 0, W1, gap, W2, vx);
    },
  },
  {
    id: "wien-blitz-duo",
    minDiff: 3.2,
    weight: 1.1,
    tags: ["timing", "combo"],
    build(c) {
      const d2 = c.t(1.0);
      bolt(c, 0);
      bolt(c, d2);
      c.coinsOver(0, BOLT_W, 160, 5);
      c.coinsOver(d2, BOLT_W, 160, 5);
      return d2 + BOLT_W;
    },
  },
  {
    id: "wien-tauben-fiaker",
    minDiff: 4.2,
    weight: 1,
    tags: ["combo", "enemy"],
    build(c) {
      const e1 = pigeons(c, 0, 3, 66);
      return fiaker(c, e1 + c.t(1.0));
    },
  },
  // ---------------- Schwer
  {
    id: "wien-ziegelregen",
    minDiff: 4.5,
    weight: 1.1,
    tags: ["combo", "hop"],
    build(c) {
      const d2 = c.t(1.05);
      rubble(c, 0, 104, 60);
      fallingBrick(c, 30, 40);
      rubble(c, d2, 120, 70);
      fallingBrick(c, d2 + 40, 46);
      c.coinsOver(0, 104, 170, 5);
      c.coinsOver(d2, 120, 180, 5);
      return d2 + 120;
    },
  },
  {
    id: "wien-brennender-balken",
    minDiff: 4.8,
    weight: 1.1,
    tags: ["slide", "combo"],
    build(c) {
      const w = c.rng.int(200, 260);
      c.overhead(0, w, 72, { skin: "beam", thick: 96 });
      const d2 = w + c.t(0.9);
      rubble(c, d2, 96, 58);
      c.coinLine(10, 24, Math.floor(w / 56), 56);
      c.coinsOver(d2, 96, 160, 5);
      return d2 + 96;
    },
  },
  {
    id: "wien-sturmfront",
    minDiff: 5.5,
    weight: 1,
    tags: ["combo"],
    build(c) {
      bolt(c, 0);
      const d1 = BOLT_W + c.t(0.95);
      const e1 = pigeons(c, d1, 3, 64);
      const d3 = e1 + c.t(0.95);
      const pw = gapW(c, 230);
      c.pit(d3, pw, { skin: "manhole" });
      c.coinsOver(0, BOLT_W, 160, 5);
      c.coinArc(d3 - 30, pw + 60, 140, 5);
      return d3 + pw;
    },
  },
  {
    id: "wien-bim-blitz",
    minDiff: 6,
    weight: 0.9,
    tags: ["combo", "special"],
    build(c) {
      const vx = tramVx(c);
      const end = tram(c, 0, tramWidth(c, vx), vx);
      const bx = end + c.t(0.55);
      bolt(c, bx);
      c.coinsOver(bx, BOLT_W, 180, 5);
      return bx + BOLT_W;
    },
  },
  // ---------------- Setpieces
  {
    id: "wien-ringstrassen-sprint",
    minDiff: 3.5,
    weight: 0.7,
    tags: ["special"],
    build(c) {
      const vx = tramVx(c);
      const e1 = tram(c, 0, tramWidth(c, vx, 1.0), vx);
      const b1 = e1 + c.t(0.7);
      bolt(c, b1);
      c.coinsOver(b1, BOLT_W, 170, 5);
      const d2 = b1 + BOLT_W + c.t(1.0);
      const W1 = Math.round(Math.max(420, tramWidth(c, vx, 0.75)));
      const e2 = tramPair(c, d2, W1, Math.round(Math.min(240, 160 + c.diff * 8)), W1, vx);
      c.pickup("gem", e2 + c.t(0.35), 150);
      return e2 + c.t(0.5);
    },
  },
  {
    id: "wien-einsturz",
    minDiff: 5.8,
    weight: 0.6,
    tags: ["special"],
    build(c) {
      // Baugrube mit Trümmer-Inseln, herabstürzende Ziegel, dann brennender Balken
      const side = Math.round(gapW(c, c.jumpDist * 0.4));
      const pw = Math.round(Math.min(200, c.jumpDist * 0.32));
      const w = side * 3 + pw * 2;
      c.pit(0, w, { skin: "manhole" });
      c.platform(side, pw, 70, { skin: "plank", thick: 18 });
      c.platform(side * 2 + pw, pw, 110, { skin: "plank", thick: 18, crumble: 0.55 });
      c.coinArc(-20, side + 40, 120, 4);
      c.coinLine(side + 20, 120, 2, 60);
      c.coinArc(side + pw - 30, side + 70, 170, 4);
      c.coinLine(side * 2 + pw + 20, 160, 2, 60);
      const d2 = w + c.t(0.8);
      rubble(c, d2, 100, 62);
      fallingBrick(c, d2 + 30, 42);
      const d3 = d2 + 100 + c.t(0.95);
      const bw = 220;
      c.overhead(d3, bw, 72, { skin: "beam", thick: 96 });
      c.coinLine(d3 + 10, 24, 4, 56);
      c.pickup("gem", d3 + bw + c.t(0.3), 120);
      return d3 + bw + c.t(0.4);
    },
  },
];
