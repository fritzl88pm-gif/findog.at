/**
 * Prater – Level-Muster. Signatur: Kettenkarussell-Pendel, Trampoline (Belohnung, nie Pflicht), Riesenrad-Gondeln
 * über dem Achterbahn-Graben, Konfetti-Kanonen, Geisterbahn-Geister, Autoscooter, Zuckerwatte-Kisten.
 */
import type { PatternCtx, PatternDef } from "../../types";
import { SPRING_AIR, SPRING_APEX, T, coinRing, coinSpringArc, hopW } from "../shared-b/pat";

const CRATE = { skin: "candy-crate", breakable: true } as const;

/** Tiefes Kettenkarussell (Sitz-Unterkante ~74 px über dem Boden → rutschen, oder in den Umkehrpunkten drunter durch). */
function lowSwing(c: PatternCtx, dx: number, ph: number, per = 2.6): void {
  // Anker 500 über Boden, Seil 400 → tiefster Sitzmittelpunkt 100 px über Boden
  c.swinger(dx, 500, 400, { skin: "swing-chair", amp: 0.55, per, ph, r: 34 });
}

/** Riesenrad-Gondel (bewegliche Plattform) */
function gondola(c: PatternCtx, dx: number, w: number, elev: number, ampY: number, per: number, ph: number): void {
  c.platform(dx, w, elev, { skin: "gondola", ampY, per, ph, thick: 22 });
}

function cannon(c: PatternCtx, dx: number, high: boolean, vx = -330): void {
  // tief: überspringen (Kugel 44 px, 16 px über Boden); hoch: drunter durchrutschen (Unterkante ≈ 86 px)
  c.projectile(dx, 44, 44, high ? 82 : 16, { skin: "cannonball", vx, warn: true });
  if (high) c.coinLine(dx - 40, 28, 4, 46);
}

export const PRATER_PATTERNS: PatternDef[] = [
  // --- Einsteiger -----------------------------------------------------------------------------
  {
    id: "pr-candy",
    minDiff: 0,
    weight: 3,
    tags: ["hop"],
    build(c) {
      const w = c.rng.int(66, 86);
      const h = c.rng.int(58, 82);
      c.block(0, w, h, CRATE);
      c.coinsOver(0, w, h + 90);
      return w;
    },
  },
  {
    id: "pr-booth",
    minDiff: 0.3,
    weight: 2,
    tags: ["hop"],
    build(c) {
      const w = hopW(c, c.rng.int(110, 150));
      const h = c.rng.int(62, 78);
      c.block(0, w, h, { skin: "booth" });
      c.coinsOver(0, w, h + 80);
      return w;
    },
  },
  {
    id: "pr-tramp-ring",
    minDiff: 0.2,
    weight: 1.4,
    tags: ["special", "reward"],
    build(c) {
      c.spring(0, 92, { skin: "trampoline" });
      coinSpringArc(c, 30, 4, 0.36);
      const apexX = 30 + T(c, SPRING_AIR / 2);
      coinRing(c, apexX, 59 + SPRING_APEX, 74, 10, "gem");
      return 92 + T(c, SPRING_AIR) - 40;
    },
  },
  {
    id: "pr-valance",
    minDiff: 0.7,
    weight: 1.6,
    tags: ["slide"],
    build(c) {
      const w = c.rng.int(170, 280);
      c.overhead(0, w, 72, { skin: "valance", thick: 640 });
      c.coinLine(16, 28, Math.max(3, Math.floor(w / 52)), 50);
      return w;
    },
  },
  {
    id: "pr-scooter",
    minDiff: 0.7,
    weight: 2,
    tags: ["enemy"],
    build(c) {
      c.walker(0, 118, 74, { skin: "scooter", vx: -180 });
      c.coinArc(-40, 300, 190, 7);
      return 120;
    },
  },
  {
    id: "pr-swing",
    minDiff: 1.0,
    weight: 1.8,
    tags: ["timing", "slide"],
    build(c) {
      lowSwing(c, 0, c.rng.range(0, Math.PI * 2));
      c.coinLine(-120, 26, 6, 48);
      return 240;
    },
  },
  {
    id: "pr-gondola",
    minDiff: 1.2,
    weight: 1.7,
    tags: ["gap"],
    build(c) {
      const pw = T(c, 1.45);
      const gw = Math.max(160, Math.min(250, T(c, 0.42)));
      const gx = T(c, 0.45);
      gondola(c, gx, gw, 100, c.rng.range(100, 125), c.rng.range(3.6, 4.4), c.rng.range(0, Math.PI * 2));
      c.pit(0, pw, { skin: "trench" });
      c.coinArc(-20, gx + gw / 2 + 20, 170, 5);
      c.coinArc(gx + gw - 10, pw - gx - gw + 60, 150, 5);
      return pw;
    },
  },
  {
    id: "pr-ghost",
    minDiff: 1.5,
    weight: 1.6,
    tags: ["enemy"],
    build(c) {
      c.flyer(0, 64, 78, 34, { skin: "ghost", amp: 24, per: 1.9, stompable: true });
      c.coinArc(-60, 260, 230, 7);
      return 64;
    },
  },
  {
    id: "pr-tires",
    minDiff: 1.6,
    weight: 1.4,
    tags: ["hop"],
    build(c) {
      const w1 = hopW(c, 88);
      c.block(0, w1, 70, { skin: "tires" });
      const gap = T(c, 1.05);
      c.block(gap, w1, 96, { skin: "tires" });
      c.coinsOver(0, w1, 150, 5);
      c.coinsOver(gap, w1, 180, 5);
      return gap + w1;
    },
  },
  {
    id: "pr-cannon",
    minDiff: 2.0,
    weight: 1.5,
    tags: ["enemy", "timing"],
    build(c) {
      const high = c.rng.chance(0.5);
      cannon(c, 0, high);
      if (!high) c.coinArc(-120, 280, 150, 6);
      return 60;
    },
  },
  {
    id: "pr-candy-tower",
    minDiff: 2.2,
    weight: 1.2,
    tags: ["hop", "special"],
    build(c) {
      const h = c.rng.int(138, 164);
      c.block(0, 84, h, CRATE);
      c.coinsOver(0, 84, h + 50, 7);
      return 84;
    },
  },
  {
    id: "pr-tramp-bridge",
    minDiff: 2.3,
    weight: 1.1,
    tags: ["special", "gap"],
    build(c) {
      c.spring(0, 92, { skin: "trampoline" });
      const px = T(c, 0.36);
      const pw = Math.min(c.jumpDist * 0.58, 330);
      c.pit(px, pw, { skin: "trench" });
      coinSpringArc(c, 30, 8, 0.95);
      c.pickup("gem", 30 + T(c, SPRING_AIR / 2), 59 + SPRING_APEX + 70);
      return Math.max(px + pw, 92 + T(c, SPRING_AIR) - 60);
    },
  },
  {
    id: "pr-swing-cross",
    minDiff: 2.6,
    weight: 1.3,
    tags: ["timing", "combo"],
    build(c) {
      lowSwing(c, 0, c.rng.range(0, Math.PI * 2), 2.4);
      const bx = 260 + T(c, 0.55);
      c.block(bx, 70, 66, CRATE);
      c.coinLine(-100, 26, 5, 46);
      c.coinsOver(bx, 70, 150, 5);
      return bx + 70;
    },
  },
  {
    id: "pr-ghostgate",
    minDiff: 2.4,
    weight: 1.3,
    tags: ["slide", "combo"],
    build(c) {
      const w = hopW(c, 76);
      c.block(0, w, 64, CRATE);
      const ox = w + T(c, 0.95);
      const ow = c.rng.int(180, 260);
      c.overhead(ox, ow, 72, { skin: "ghostgate", thick: 640 });
      c.coinsOver(0, w, 150, 5);
      c.coinLine(ox + 10, 28, Math.floor(ow / 52), 50);
      return ox + ow;
    },
  },
  {
    id: "pr-scooter-rush",
    minDiff: 2.8,
    weight: 1.3,
    tags: ["enemy"],
    build(c) {
      c.walker(0, 118, 74, { skin: "scooter", vx: -150 });
      c.walker(T(c, 1.25), 118, 74, { skin: "scooter", vx: -250 });
      c.coinArc(-40, 280, 200, 6);
      return T(c, 1.25) + 120;
    },
  },
  {
    id: "pr-gondola-duo",
    minDiff: 3.0,
    weight: 1.3,
    tags: ["gap", "timing"],
    build(c) {
      const gw = Math.max(160, Math.min(240, T(c, 0.4)));
      const g1 = T(c, 0.42);
      const g2 = g1 + gw + T(c, 0.42);
      const pw = g2 + gw + T(c, 0.5);
      const ph = c.rng.range(0, Math.PI * 2);
      gondola(c, g1, gw, 110, 115, 4.0, ph);
      gondola(c, g2, gw, 150, 115, 4.0, ph + Math.PI * 0.9);
      c.pit(0, pw, { skin: "trench" });
      c.coinLine(g1 + 20, 260, 3, 50);
      c.coinLine(g2 + 20, 300, 3, 50);
      return pw;
    },
  },
  {
    id: "pr-riesenrad",
    minDiff: 3.2,
    weight: 0.9,
    tags: ["special", "gap"],
    build(c) {
      // Setpiece: Gondel-Treppe nach oben (wie ein Riesenrad-Ausschnitt), Edelstein am Gipfel
      const gw = Math.max(170, Math.min(290, T(c, 0.5)));
      const gap = T(c, 0.26);
      const x0 = T(c, 0.36);
      const bases = [60, 140, 215, 285];
      const amp = 95;
      const ph0 = c.rng.range(0, Math.PI * 2);
      let x = x0;
      for (let i = 0; i < bases.length; i += 1) {
        gondola(c, x, gw, bases[i], amp, 4.6, ph0 + i * 0.45);
        c.coinLine(x + gw * 0.2, bases[i] + 70, 3, gw * 0.3);
        x += gw + gap;
      }
      const last = x - gap - gw;
      c.pickup("gem", last + gw / 2, 505);
      coinRing(c, last + gw / 2, 505, 52, 8);
      const pw = x - gap + T(c, 0.55);
      c.pit(0, pw, { skin: "trench" });
      return pw;
    },
  },
  {
    id: "pr-swing-row",
    minDiff: 3.4,
    weight: 1.2,
    tags: ["timing", "slide"],
    build(c) {
      const sp = T(c, 0.42);
      const ph = c.rng.range(0, Math.PI * 2);
      for (let i = 0; i < 3; i += 1) lowSwing(c, i * sp, ph + i * 1.9, 2.5);
      c.coinLine(-140, 26, Math.floor((2 * sp + 280) / 48), 48);
      return 2 * sp + 240;
    },
  },
  {
    id: "pr-ghost-train",
    minDiff: 3.6,
    weight: 1.2,
    tags: ["enemy", "combo"],
    build(c) {
      const sp = T(c, 0.85);
      c.flyer(0, 64, 78, 30, { skin: "ghost", amp: 20, per: 1.7, stompable: true });
      c.flyer(sp, 64, 78, 30, { skin: "ghost", amp: 26, per: 2.1, stompable: true });
      c.flyer(sp * 2, 64, 78, 36, { skin: "ghost", amp: 22, per: 1.9, stompable: true });
      c.coinLine(0, 250, 3 + Math.floor((sp * 2) / 90), 90);
      return sp * 2 + 64;
    },
  },
  {
    id: "pr-cannon-volley",
    minDiff: 4.2,
    weight: 1.2,
    tags: ["enemy", "combo"],
    build(c) {
      const first = c.rng.chance(0.5);
      const sp = T(c, 1.05);
      cannon(c, 0, first, -300);
      cannon(c, sp, !first, -300);
      if (c.diff > 6) cannon(c, sp * 2, first, -300);
      return (c.diff > 6 ? sp * 2 : sp) + 60;
    },
  },
  {
    id: "pr-achterbahn",
    minDiff: 4.5,
    weight: 0.9,
    tags: ["special", "combo"],
    build(c) {
      // Setpiece "Achterbahn": Trampolin-Bögen über zwei Grabenstücke, Münzbahn wie Schienen, Edelstein am 2. Gipfel,
      // danach eine rollende Konfettibombe.
      const air = T(c, SPRING_AIR);
      c.spring(0, 92, { skin: "trampoline" });
      coinSpringArc(c, 30, 9, 0.95);
      const p1 = T(c, 0.3);
      c.pit(p1, T(c, 0.55), { skin: "trench" });
      const s2 = air + T(c, 0.3);
      c.spring(s2, 92, { skin: "trampoline" });
      coinSpringArc(c, s2 + 30, 9, 0.95);
      const p2 = s2 + T(c, 0.3);
      c.pit(p2, T(c, 0.55), { skin: "trench" });
      const apex = s2 + 30 + T(c, SPRING_AIR / 2);
      coinRing(c, apex, 59 + SPRING_APEX, 74, 10, "gem");
      const end = s2 + air + T(c, 0.2);
      cannon(c, end + T(c, 0.9), false, -160);
      return end + T(c, 0.9) + 60;
    },
  },
  {
    id: "pr-late-mix",
    minDiff: 6.0,
    weight: 1.3,
    tags: ["combo"],
    build(c) {
      const w = hopW(c, 74);
      c.block(0, w, 70, CRATE);
      const sx = w + T(c, 0.9);
      lowSwing(c, sx + 120, c.rng.range(0, Math.PI * 2), 2.4);
      const wx = sx + 120 + T(c, 1.0);
      c.walker(wx, 118, 74, { skin: "scooter", vx: -140 });
      c.coinsOver(0, w, 150, 5);
      c.coinLine(sx, 26, 5, 48);
      return wx + 120;
    },
  },
  {
    id: "pr-late-gondola-cannon",
    minDiff: 6.5,
    weight: 1.0,
    tags: ["gap", "combo"],
    build(c) {
      const pw = T(c, 1.5);
      const gw = Math.max(170, Math.min(260, T(c, 0.45)));
      gondola(c, T(c, 0.45), gw, 110, 110, 3.8, c.rng.range(0, Math.PI * 2));
      c.pit(0, pw, { skin: "trench" });
      cannon(c, pw + T(c, 1.0), c.rng.chance(0.5), -220);
      return pw + T(c, 1.0) + 60;
    },
  },
  {
    id: "pr-late-ghost-slide",
    minDiff: 7.0,
    weight: 1.0,
    tags: ["combo", "enemy"],
    build(c) {
      const ow = c.rng.int(180, 240);
      c.overhead(0, ow, 72, { skin: "valance", thick: 640 });
      c.coinLine(10, 28, Math.floor(ow / 52), 50);
      const gx = ow + T(c, 0.85);
      c.flyer(gx, 64, 78, 32, { skin: "ghost", amp: 20, per: 1.8, stompable: true });
      return gx + 64;
    },
  },
];
