/**
 * Cyber-Wien 2099 – Level-Muster. Signatur: Gravitationsportale (immer paarweise → gravitationsneutral), Phasen-Tore
 * (Cyan = niedrig → springen, Magenta = hoch → rutschen), Laser an Boden & Decke, Laserzäune, Glitch-Würfel, Drohnen,
 * Neon-Barrieren, Server-Racks (auch hängend), Plasma-Geschosse, Schwebeplatten.
 *
 * Physik beim Portal (sim.flipGravity + Spielfeld-Anschlag im CyberSystem): Der Körper bleibt beim Flip stehen und fliegt ohne
 * Eingabe in ≈ 0.5 s zur Gegenfläche (ohne Anschlag ≈ 0.585 s, Körper klappt dabei kurz hinter die verlassene Fläche). Die
 * Muster rechnen konservativ mit FLIGHT = 0.6 s: direkt hinter einem Portal bleibt die verlassene Fläche frei, auf der Zielfläche
 * kommt das erste Hindernis erst nach Flugzeit + Reaktionszeit.
 */
import { GRAVITY, PLAYER_H } from "../../constants";
import type { BuilderOpts, PatternCtx, PatternDef, ZonePhase } from "../../types";

/** Flugzeit Boden ↔ Decke (mit Reserve) */
export const FLIGHT = 0.6;
const PORTAL_W = 60;

const field = (c: PatternCtx): number => c.groundY - c.ceilY;
/** Reaktionszeit nach der Landung – früh großzügig, spät knapper */
const react = (c: PatternCtx): number => 0.55 - 0.25 * Math.min(1, c.diff / 8);
const hop = (c: PatternCtx, w: number, k = 0.5): number => Math.min(w, c.jumpDist * k);

type Surf = "floor" | "ceil";

/** Portal mit Flip-Richtung (+1 = zur Decke, −1 = zum Boden) für die Optik. Rückgabe: Kreuzungspunkt (Portalmitte). */
function portal(c: PatternCtx, dx: number, dir: 1 | -1): number {
  c.portal(dx, { skin: "portal", p: { dir } });
  return dx + PORTAL_W / 2;
}

/**
 * Münzen entlang der natürlichen Flugbahn nach einem Portal (Kreuzungspunkt px). Der Körper bleibt beim Flip an Ort und
 * Stelle (Spielfeld-Anschlag im CyberSystem: Start 342 px vor der Zielfläche) und fliegt dann ≈ 0.5 s zur Gegenfläche.
 */
function flightCoins(c: PatternCtx, px: number, dir: 1 | -1, n: number, gem = false): void {
  const F = field(c);
  const start = F - PLAYER_H;
  for (let i = 0; i < n; i += 1) {
    const t = 0.12 + (n === 1 ? 0.16 : (i / (n - 1)) * 0.32);
    const d = Math.min(start, 0.5 * GRAVITY * t * t);
    // Körpermitte über dem Boden: zur Decke hin 59 + d, zum Boden hin (F − 59) − d
    const elev = dir === 1 ? 59 + d : F - 59 - d;
    const el = Math.max(40, Math.min(F - 40, elev));
    if (gem && i === Math.floor(n / 2)) c.pickup("gem", px + c.t(t), el);
    else c.coin(px + c.t(t), el);
  }
}

// --- Decken-Bausteine (Abstände „d“ = von der Decke nach unten gemessen) -----------------------------------------

function ceilCoin(c: PatternCtx, dx: number, d: number): void {
  c.coin(dx, field(c) - d);
}

function ceilCoinLine(c: PatternCtx, dx: number, d: number, n: number, gap = 58): void {
  for (let i = 0; i < n; i += 1) ceilCoin(c, dx + i * gap, d);
}

function ceilCoinsOver(c: PatternCtx, dx: number, w: number, clear: number, n = 5): void {
  const span = Math.max(w + 140, 240);
  const apex = Math.min(clear, 200);
  for (let i = 0; i < n; i += 1) {
    const u = n === 1 ? 0.5 : i / (n - 1);
    ceilCoin(c, dx + w / 2 - span / 2 + u * span, 44 + Math.sin(u * Math.PI) * apex);
  }
}

function ceilBlock(c: PatternCtx, dx: number, w: number, h: number, o: BuilderOpts): void {
  c.block(dx, w, h, { ...o, ceil: true, hb: [w * 0.1, 0, w * 0.8, h * 0.92] });
}

/** Zone, die an der Decke hängt (Höhe h nach unten) */
function ceilZone(c: PatternCtx, dx: number, w: number, h: number, phases: ZonePhase[], o: BuilderOpts & { loop?: boolean; offset?: number }): void {
  c.zone(dx, w, h, field(c) - h, phases, { ...o, ceil: true });
}

// --- Rhythmen -----------------------------------------------------------------------------------------------------

const LASER_PH: ZonePhase[] = [
  { name: "idle", dur: 0.75 },
  { name: "warn", dur: 0.55 },
  { name: "active", dur: 0.85 },
];
const GATE_PH: ZonePhase[] = [
  { name: "idle", dur: 0.8 },
  { name: "warn", dur: 0.45 },
  { name: "active", dur: 0.9 },
];
const CUBE_PH: ZonePhase[] = [
  { name: "warn", dur: 0.4 },
  { name: "active", dur: 1.1 },
  { name: "idle", dur: 0.9 },
];
const FENCE_PH: ZonePhase[] = [
  { name: "idle", dur: 0.7 },
  { name: "warn", dur: 0.5 },
  { name: "active", dur: 1.0 },
];
const period = (ph: ZonePhase[]): number => ph.reduce((s, p) => s + p.dur, 0);

// --- Hindernis-Bausteine (Boden oder Decke) -------------------------------------------------------------------------

function barrier(c: PatternCtx, dx: number, s: Surf, h = c.rng.int(58, 80)): number {
  const w = hop(c, c.rng.int(62, 80));
  if (s === "floor") {
    c.block(dx, w, h, { skin: "barrier-neon", breakable: true });
    c.coinsOver(dx, w, h + 90, 5);
  } else {
    ceilBlock(c, dx, w, h, { skin: "barrier-neon", breakable: true });
    ceilCoinsOver(c, dx, w, h + 90, 5);
  }
  return w;
}

function rack(c: PatternCtx, dx: number, s: Surf, h = c.rng.int(94, 116)): number {
  const w = hop(c, c.rng.int(74, 88));
  if (s === "floor") {
    c.block(dx, w, h, { skin: "server-rack" });
    c.coinsOver(dx, w, h + 70, 5);
  } else {
    ceilBlock(c, dx, w, h, { skin: "server-rack" });
    ceilCoinsOver(c, dx, w, h + 70, 5);
  }
  return w;
}

function laser(c: PatternCtx, dx: number, s: Surf, want = 200): number {
  const w = hop(c, want, 0.42);
  const offset = c.rng.range(0, period(LASER_PH));
  if (s === "floor") {
    c.zone(dx, w, 28, 0, LASER_PH, { skin: "laser-floor", loop: true, offset });
    c.coinsOver(dx, w, 120, 5);
  } else {
    ceilZone(c, dx, w, 28, LASER_PH, { skin: "laser-ceil", loop: true, offset });
    ceilCoinsOver(c, dx, w, 120, 5);
  }
  return w;
}

/** Cyan-Tor: niedrig (von der Lauffläche aus, Höhe h) → im aktiven Takt drüberspringen */
function gateLow(c: PatternCtx, dx: number, s: Surf, h = c.rng.int(118, 146), offset = c.rng.range(0, period(GATE_PH))): number {
  if (s === "floor") {
    c.zone(dx, 40, h, 0, GATE_PH, { skin: "phase-cyan", loop: true, offset });
    c.coinsOver(dx, 40, h + 60, 5);
  } else {
    ceilZone(c, dx, 40, h, GATE_PH, { skin: "phase-cyan", loop: true, offset });
    ceilCoinsOver(c, dx, 40, h + 60, 5);
  }
  return 40;
}

/** Magenta-Tor: hoch (lässt 76 px über der Lauffläche frei) → im aktiven Takt drunter durchrutschen */
function gateHigh(c: PatternCtx, dx: number, s: Surf, offset = c.rng.range(0, period(GATE_PH))): number {
  const F = field(c);
  if (s === "floor") {
    c.zone(dx, 40, F - 76, 76, GATE_PH, { skin: "phase-magenta", loop: true, offset });
    c.coinLine(dx - 60, 28, 4, 50);
  } else {
    c.zone(dx, 40, F - 76, 0, GATE_PH, { skin: "phase-magenta", loop: true, offset });
    ceilCoinLine(c, dx - 60, 28, 4, 50);
  }
  return 40;
}

/**
 * Laser-Lichtschranke: waagrechte Strahlen 74 … 190 px vor der Lauffläche, im Takt (Warnung → aktiv → Pause).
 * Aktiv: drunter durchrutschen oder drüberspringen; in der Pause einfach durchlaufen.
 */
function fence(c: PatternCtx, dx: number, s: Surf, offset = c.rng.range(0, period(FENCE_PH))): number {
  const w = 40;
  const F = field(c);
  if (s === "floor") {
    c.zone(dx, w, 116, 74, FENCE_PH, { skin: "beam-fence", loop: true, offset });
    c.coinLine(dx - 40, 28, 4, 46);
  } else {
    c.zone(dx, w, 116, F - 190, FENCE_PH, { skin: "beam-fence", loop: true, offset });
    ceilCoinLine(c, dx - 40, 28, 4, 46);
  }
  return w;
}

function cube(c: PatternCtx, dx: number, s: Surf, offset = c.rng.range(0, period(CUBE_PH))): number {
  if (s === "floor") {
    c.zone(dx, 86, 86, 0, CUBE_PH, { skin: "glitch-cube", loop: true, offset });
    c.coinsOver(dx, 86, 160, 5);
  } else {
    ceilZone(c, dx, 86, 86, CUBE_PH, { skin: "glitch-cube", loop: true, offset });
    ceilCoinsOver(c, dx, 86, 160, 5);
  }
  return 86;
}

/**
 * Drohne knapp über der Lauffläche → drüberspringen (am Boden auch Stampfen möglich). `track` (sanftes Nachführen auf
 * Körperhöhe) nur in Mustern ohne Portal – die Engine-Verfolgung zielt bei gekippter Schwerkraft falsch.
 */
function drone(c: PatternCtx, dx: number, s: Surf, high = false, track = 0): number {
  const F = field(c);
  const h = 56;
  if (s === "floor") {
    c.flyer(dx, 72, h, high ? 72 : 34, { skin: "drone", amp: high ? 12 : 14, per: 1.7, stompable: !high, track: high ? 0 : track });
    if (high) c.coinLine(dx - 50, 28, 4, 48);
    else c.coinsOver(dx, 72, 170, 5);
  } else {
    const elev = high ? F - 72 - h : F - 34 - h;
    c.flyer(dx, 72, h, elev, { skin: "drone", amp: high ? 12 : 14, per: 1.7 });
    if (high) ceilCoinLine(c, dx - 50, 28, 4, 48);
    else ceilCoinsOver(c, dx, 72, 170, 5);
  }
  return 72;
}

type Seg = (c: PatternCtx, x: number, s: Surf) => number;

/**
 * Zickzack: Portal → (Segment an der Decke) → Portal → (Segment am Boden) → … Anzahl Segmente ungerade ⇒ gerade Portalzahl,
 * Ende immer am Boden. Rückgabe: Musterlänge.
 */
function flipRun(c: PatternCtx, x0: number, segs: Seg[], gapAfter = 0.9, coinsPerFlight = 3, gemInLast = false): number {
  if (segs.length % 2 === 0) throw new Error("flipRun braucht eine ungerade Segmentzahl");
  let cross = portal(c, x0, 1);
  flightCoins(c, cross, 1, coinsPerFlight);
  for (let i = 0; i < segs.length; i += 1) {
    const s: Surf = i % 2 === 0 ? "ceil" : "floor";
    const start = cross + c.t(FLIGHT + react(c));
    const used = segs[i](c, start, s);
    const next = start + used + c.t(gapAfter);
    const dir: 1 | -1 = s === "ceil" ? -1 : 1;
    cross = portal(c, next - PORTAL_W / 2, dir);
    flightCoins(c, cross, dir, coinsPerFlight, gemInLast && i === segs.length - 1);
  }
  return cross + c.t(FLIGHT);
}

// ------------------------------------------------------------------------------------------------------------------

export const CYBER_PATTERNS: PatternDef[] = [
  // --- Einsteiger -------------------------------------------------------------------------------------------------
  {
    id: "cy-barrier",
    minDiff: 0,
    weight: 3,
    tags: ["hop"],
    build(c) {
      return barrier(c, 0, "floor");
    },
  },
  {
    id: "cy-rack",
    minDiff: 0.3,
    weight: 2.2,
    tags: ["hop"],
    build(c) {
      return rack(c, 0, "floor");
    },
  },
  {
    id: "cy-portal-intro",
    minDiff: 0.5,
    maxDiff: 5,
    weight: 2.2,
    tags: ["flip", "special"],
    build(c) {
      // Erstes Portal: Holo-Schild, Münzspur in den Flug, lange freie Deckenstrecke voller Datenchips, Rückportal.
      c.decor(0, 190, 104, 196, { skin: "flip-hint" });
      c.coinLine(60, 44, 4, 60);
      const p1 = portal(c, c.t(1.25), 1);
      flightCoins(c, p1, 1, 4);
      const n = Math.max(5, Math.floor(c.t(1.5) / 60));
      ceilCoinLine(c, p1 + c.t(0.8), 46, n, 60);
      const p2 = portal(c, p1 + c.t(0.8) + n * 60 + c.t(0.6) - PORTAL_W / 2, -1);
      flightCoins(c, p2, -1, 4);
      return p2 + c.t(FLIGHT + 0.3);
    },
  },
  {
    id: "cy-drone",
    minDiff: 0.8,
    weight: 1.8,
    tags: ["enemy"],
    build(c) {
      const high = c.diff > 2 && c.rng.chance(0.4);
      return drone(c, 0, "floor", high, c.diff > 1.5 ? 0.5 : 0);
    },
  },
  {
    id: "cy-fence",
    minDiff: 1.8,
    weight: 1.7,
    tags: ["slide"],
    build(c) {
      return fence(c, 0, "floor");
    },
  },
  {
    id: "cy-portal-hop",
    minDiff: 1.0,
    weight: 1.8,
    tags: ["flip", "hop"],
    build(c) {
      const p1 = portal(c, 0, 1);
      flightCoins(c, p1, 1, 3);
      const bx = p1 + c.t(FLIGHT + react(c) + 0.35);
      const w = barrier(c, bx, "ceil", c.rng.int(56, 72));
      const p2 = portal(c, bx + w + c.t(1.0) - PORTAL_W / 2, -1);
      flightCoins(c, p2, -1, 3);
      return p2 + c.t(FLIGHT);
    },
  },
  {
    id: "cy-laser-floor",
    minDiff: 1.2,
    weight: 1.6,
    tags: ["timing"],
    build(c) {
      return laser(c, 0, "floor", c.rng.int(150, 220));
    },
  },
  // --- Mittel -------------------------------------------------------------------------------------------------------
  {
    id: "cy-phase-low",
    minDiff: 1.6,
    weight: 1.6,
    tags: ["timing", "hop"],
    build(c) {
      return gateLow(c, 0, "floor");
    },
  },
  {
    id: "cy-rack-row",
    minDiff: 1.8,
    weight: 1.4,
    tags: ["hop", "combo"],
    build(c) {
      const w1 = barrier(c, 0, "floor");
      const x2 = w1 + c.t(1.05);
      const w2 = rack(c, x2, "floor");
      return x2 + w2;
    },
  },
  {
    id: "cy-phase-high",
    minDiff: 2.0,
    weight: 1.5,
    tags: ["slide", "timing"],
    build(c) {
      return gateHigh(c, 0, "floor");
    },
  },
  {
    id: "cy-ceil-racks",
    minDiff: 2.2,
    weight: 1.5,
    tags: ["flip", "hop"],
    build(c) {
      const p1 = portal(c, 0, 1);
      flightCoins(c, p1, 1, 3);
      const x1 = p1 + c.t(FLIGHT + react(c));
      const w1 = rack(c, x1, "ceil");
      const x2 = x1 + w1 + c.t(1.1);
      const w2 = c.rng.chance(0.5) ? rack(c, x2, "ceil") : barrier(c, x2, "ceil");
      const p2 = portal(c, x2 + w2 + c.t(0.95) - PORTAL_W / 2, -1);
      flightCoins(c, p2, -1, 3);
      return p2 + c.t(FLIGHT);
    },
  },
  {
    id: "cy-glitch-cubes",
    minDiff: 2.4,
    weight: 1.4,
    tags: ["timing", "hop"],
    build(c) {
      const off = c.rng.range(0, period(CUBE_PH));
      cube(c, 0, "floor", off);
      const x2 = 86 + c.t(1.0);
      cube(c, x2, "floor", off + period(CUBE_PH) / 2);
      return x2 + 86;
    },
  },
  {
    id: "cy-drone-duo",
    minDiff: 2.6,
    weight: 1.3,
    tags: ["enemy", "combo"],
    build(c) {
      drone(c, 0, "floor", false, 0.5);
      const x2 = 72 + c.t(1.1);
      drone(c, x2, "floor", true);
      return x2 + 72;
    },
  },
  {
    id: "cy-hover",
    minDiff: 2.8,
    weight: 1.1,
    tags: ["special", "reward"],
    build(c) {
      // Schwebeplatten über einem Bodenlaser: unten drüberspringen oder oben Datenchips + Kristall abgreifen.
      const lw = laser(c, c.t(0.35), "floor", 220);
      const pw = Math.max(150, Math.min(230, c.t(0.3)));
      c.platform(0, pw, 118, { skin: "hover", ampY: 8, per: 2.6 });
      c.coinLine(20, 190, Math.floor(pw / 56), 56);
      const x2 = pw + c.t(0.32);
      c.platform(x2, pw, 196, { skin: "hover", ampY: 8, per: 2.6, ph: 1.4 });
      c.coinLine(x2 + 20, 268, Math.floor(pw / 56) - 1, 56);
      c.pickup("gem", x2 + pw - 30, 290);
      return Math.max(x2 + pw, c.t(0.35) + lw);
    },
  },
  {
    id: "cy-plasma",
    minDiff: 3.0,
    weight: 1.3,
    tags: ["enemy", "timing"],
    build(c) {
      const high = c.rng.chance(0.5);
      c.projectile(0, 56, 26, high ? 84 : 18, { skin: "plasma", vx: -320, warn: true });
      if (high) c.coinLine(-60, 28, 4, 46);
      else c.coinArc(-120, 280, 150, 6);
      if (c.diff > 5) {
        c.projectile(c.t(1.05), 56, 26, high ? 18 : 84, { skin: "plasma", vx: -320, warn: true });
        return c.t(1.05) + 56;
      }
      return 56;
    },
  },
  {
    id: "cy-laser-ceil",
    minDiff: 3.2,
    weight: 1.3,
    tags: ["flip", "timing"],
    build(c) {
      const p1 = portal(c, 0, 1);
      flightCoins(c, p1, 1, 3);
      const x1 = p1 + c.t(FLIGHT + react(c));
      const w1 = laser(c, x1, "ceil", 200);
      let end = x1 + w1;
      if (c.diff > 5) {
        const x2 = end + c.t(1.0);
        end = x2 + gateLow(c, x2, "ceil");
      }
      const p2 = portal(c, end + c.t(0.95) - PORTAL_W / 2, -1);
      flightCoins(c, p2, -1, 3);
      return p2 + c.t(FLIGHT);
    },
  },
  {
    id: "cy-serverkorridor",
    minDiff: 3.4,
    weight: 1.0,
    tags: ["special", "combo"],
    build(c) {
      // Setpiece: Serverkorridor – Racks & Bodenlaser, Portal an die Decke, hängende Racks & Laserzaun (an der Decke
      // rutschen), zurück zum Boden, Schwebeplatten mit Kristall als Belohnung.
      // Kulisse ZUERST erzeugen (gleicher Zeichendurchgang wie Portale/Zonen → sonst würde sie diese verdecken).
      const hall = c.decor(0, 10, field(c), 0, { skin: "corridor" });
      let x = c.t(0.5);
      x += rack(c, x, "floor", 104) + c.t(1.0);
      x += laser(c, x, "floor", 190) + c.t(0.95);
      let cross = portal(c, x, 1);
      flightCoins(c, cross, 1, 3);
      x = cross + c.t(FLIGHT + react(c));
      x += rack(c, x, "ceil", 100) + c.t(1.0);
      x += fence(c, x, "ceil") + c.t(0.95);
      cross = portal(c, x - PORTAL_W / 2, -1);
      flightCoins(c, cross, -1, 3);
      x = cross + c.t(FLIGHT + react(c) + 0.1);
      const pw = Math.max(150, Math.min(220, c.t(0.28)));
      c.platform(x, pw, 118, { skin: "hover", ampY: 8, per: 2.4 });
      c.coinLine(x + 20, 190, Math.floor(pw / 56), 56);
      const x2 = x + pw + c.t(0.3);
      c.platform(x2, pw, 190, { skin: "hover", ampY: 8, per: 2.4, ph: 1.2 });
      c.coinLine(x2 + 20, 262, Math.floor(pw / 56), 56);
      c.pickup("gem", x2 + pw / 2, 330);
      c.coinLine(x, 44, Math.floor((x2 + pw - x) / 60), 60);
      const end = x2 + pw + c.t(0.4);
      hall.w = end;
      hall.hb = [0, 0, end, field(c)];
      return end;
    },
  },
  {
    id: "cy-zigzag",
    minDiff: 3.5,
    weight: 1.3,
    tags: ["flip", "combo"],
    build(c) {
      const pool: Seg[] = [(cc, x, s) => barrier(cc, x, s), (cc, x, s) => rack(cc, x, s), (cc, x, s) => laser(cc, x, s, 170), (cc, x, s) => cube(cc, x, s)];
      const segs: Seg[] = [];
      for (let i = 0; i < 3; i += 1) segs.push(c.rng.pick(pool));
      return flipRun(c, 0, segs, 0.9, 3);
    },
  },
  {
    id: "cy-zickzack-schacht",
    minDiff: 4.0,
    weight: 1.0,
    tags: ["special", "flip"],
    build(c) {
      // Setpiece: Zickzack-Schacht – sechs Portale, auf jeder Fläche ein anderes Hindernis, Datenchips im Flug,
      // Kristall mitten im letzten Flug.
      const segs: Seg[] = [
        (cc, x, s) => barrier(cc, x, s),
        (cc, x, s) => cube(cc, x, s),
        (cc, x, s) => rack(cc, x, s),
        (cc, x, s) => (cc.diff > 6 ? gateLow(cc, x, s) : laser(cc, x, s, 170)),
        (cc, x, s) => drone(cc, x, s, false),
      ];
      const shaft = c.decor(0, 10, field(c), 0, { skin: "shaft" });
      const x0 = c.t(0.35);
      const end = flipRun(c, x0, segs, c.diff > 7 ? 0.75 : 0.85, 4, true);
      shaft.w = end;
      shaft.hb = [0, 0, end, field(c)];
      return end;
    },
  },
  // --- Schwer -------------------------------------------------------------------------------------------------------
  {
    id: "cy-flip-gauntlet",
    minDiff: 5.0,
    weight: 1.2,
    tags: ["flip", "combo"],
    build(c) {
      const w0 = barrier(c, 0, "floor");
      const p1 = portal(c, w0 + c.t(0.95), 1);
      flightCoins(c, p1, 1, 3);
      let x = p1 + c.t(FLIGHT + react(c));
      x += gateLow(c, x, "ceil") + c.t(0.95);
      x += cube(c, x, "ceil") + c.t(0.9);
      const p2 = portal(c, x - PORTAL_W / 2, -1);
      flightCoins(c, p2, -1, 3);
      const dx = p2 + c.t(FLIGHT + react(c));
      return dx + drone(c, dx, "floor", c.rng.chance(0.5));
    },
  },
  {
    id: "cy-phase-double",
    minDiff: 5.5,
    weight: 1.2,
    tags: ["timing", "combo"],
    build(c) {
      const off = c.rng.range(0, period(GATE_PH));
      gateLow(c, 0, "floor", c.rng.int(120, 140), off);
      const x2 = 40 + c.t(1.0);
      gateHigh(c, x2, "floor", off + 0.9);
      if (c.diff > 7.5) {
        const x3 = x2 + 40 + c.t(1.0);
        gateLow(c, x3, "floor", 130, off + 1.6);
        return x3 + 40;
      }
      return x2 + 40;
    },
  },
  {
    id: "cy-drone-swarm",
    minDiff: 6.0,
    weight: 1.1,
    tags: ["enemy", "combo"],
    build(c) {
      const sp = c.t(0.85);
      drone(c, 0, "floor", false, 0.5);
      drone(c, 72 + sp, "floor", true);
      drone(c, 2 * (72 + sp), "floor", false, 0.5);
      return 2 * (72 + sp) + 72;
    },
  },
  {
    id: "cy-glitch-flip",
    minDiff: 6.5,
    weight: 1.1,
    tags: ["flip", "timing"],
    build(c) {
      const p1 = portal(c, 0, 1);
      flightCoins(c, p1, 1, 3);
      const off = c.rng.range(0, period(CUBE_PH));
      let x = p1 + c.t(FLIGHT + react(c));
      x += cube(c, x, "ceil", off) + c.t(0.9);
      x += cube(c, x, "ceil", off + period(CUBE_PH) / 2) + c.t(0.9);
      const p2 = portal(c, x - PORTAL_W / 2, -1);
      flightCoins(c, p2, -1, 3);
      const x3 = p2 + c.t(FLIGHT + react(c));
      return x3 + cube(c, x3, "floor");
    },
  },
  {
    id: "cy-late-zigzag",
    minDiff: 7.5,
    weight: 1.2,
    tags: ["flip", "combo"],
    build(c) {
      const pair = (a: Seg, b: Seg): Seg => (cc, x, s) => {
        const w1 = a(cc, x, s);
        const x2 = x + w1 + cc.t(0.8);
        return x2 - x + b(cc, x2, s);
      };
      const B: Seg = (cc, x, s) => barrier(cc, x, s);
      const R: Seg = (cc, x, s) => rack(cc, x, s);
      const L: Seg = (cc, x, s) => laser(cc, x, s, 160);
      const G: Seg = (cc, x, s) => gateLow(cc, x, s);
      const F: Seg = (cc, x, s) => fence(cc, x, s);
      const segs = [pair(B, c.rng.pick([L, G])), pair(R, c.rng.pick([B, F])), pair(c.rng.pick([G, L]), R)];
      return flipRun(c, 0, segs, 0.8, 3);
    },
  },
];
