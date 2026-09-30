/**
 * Alpenpanorama – Level-Muster (28): Zäune, Findlinge, Holzstöße, Baumstämme, Kühe, Murmeltiere, Felsdächer, Lastenseilbahn, Schluchten mit
 * Holzstegen, bröckelnden Felsplatten und Seilbahn-Gondeln, Aufwind-Thermik mit Edelweiß-Bahn, Steinböcke, Adler,
 * Steinschlag (telegrafiert), rollende Felsen & Schneebälle, Tiefschnee/Blankeis, Setpieces „Gipfelgrat“ und
 * „Seilbahn-Talfahrt“.
 *
 * Maße: alle Abstände in Zeit (`c.t`), Lückenbreiten ≤ 0.62 × Sprungweite, überspringbare Hindernisse ≤ 0.6 × Sprungweite.
 */
import { GRAVITY, JUMP_HEIGHT, JUMP_V } from "../../constants";
import type { PatternCtx, PatternDef } from "../../types";
import { coinRun, gapW, hopW, strikePhases } from "../shared-a/pattern-kit";

// --- Maße ---------------------------------------------------------------------------------------------

export const ROCK_W = 104;
export const ROCK_H = 112;
export const GONDOLA_THICK = 22;
/** Seil-Steigung der Seilbahn (px Höhe pro px Weg, positiv = steigt nach rechts) */
export const CABLE_SLOPE = 0.16;

// --- Bausteine ----------------------------------------------------------------------------------------

/**
 * Horizontale Weite eines vollen Sprungs, der `dh` px höher (negativ = tiefer) wieder aufsetzt. Damit werden
 * Plattform-Treppen so gebaut, dass ein voller Sprung aus der Plattformmitte die Mitte der nächsten trifft.
 */
export function landDist(c: PatternCtx, dh: number): number {
  const up = JUMP_V / GRAVITY;
  const down = Math.sqrt((2 * Math.max(20, JUMP_HEIGHT - dh)) / GRAVITY);
  return c.speed * (up + down);
}

function fence(c: PatternCtx, dx: number): number {
  const w = Math.round(hopW(c, 112));
  const h = Math.round(w * 0.5);
  c.block(dx, w, h, { skin: "fence", hb: [8, 8, w - 16, h - 8] });
  return w;
}

function boulder(c: PatternCtx, dx: number, w0: number): number {
  const w = Math.round(hopW(c, w0));
  const h = Math.round(w * 0.78);
  c.block(dx, w, h, { skin: "boulder", hb: [w * 0.13, h * 0.16, w * 0.74, h * 0.84] });
  return w;
}

function logs(c: PatternCtx, dx: number, w0: number, h: number): number {
  const w = Math.round(hopW(c, w0));
  c.block(dx, w, h, { skin: "logs", hb: [6, 8, w - 12, h - 8] });
  return w;
}

function cow(c: PatternCtx, dx: number): number {
  const w = Math.round(hopW(c, 150));
  const h = Math.round(w * 0.68);
  c.block(dx, w, h, { skin: "cow", hb: [w * 0.12, h * 0.2, w * 0.76, h * 0.8] });
  return w;
}

/** Umgestürzter Baumstamm quer über dem Weg (flacher Sprung) */
function trunk(c: PatternCtx, dx: number): number {
  const w = Math.round(hopW(c, c.rng.int(140, 178)));
  const h = c.rng.int(44, 54);
  c.block(dx, w, h, { skin: "trunk", hb: [6, 8, w - 12, h - 8] });
  return w;
}

/** Murmeltier: klein, langsam, draufspringen erlaubt */
function marmot(c: PatternCtx, dx: number, vx = -70): void {
  c.walker(dx, 54, 46, { skin: "marmot", vx, stompable: true, hb: [10, 6, 34, 40] });
}

function cairn(c: PatternCtx, dx: number): number {
  const w = 62;
  const h = c.rng.int(96, 118);
  c.block(dx, w, h, { skin: "cairn", hb: [8, 10, w - 16, h - 10] });
  return w;
}

function ledge(c: PatternCtx, dx: number, w: number): void {
  c.overhead(dx, w, 72, { skin: "ledge", thick: 700 });
}

/** Lastenseilbahn-Kiste, hängt tief am Seil (drunter durchrutschen) */
function cargo(c: PatternCtx, dx: number): number {
  const w = c.rng.int(118, 146);
  const bottom = 72;
  const thick = c.groundY - bottom - 70;
  c.overhead(dx, w, bottom, { skin: "cargo", thick });
  return w;
}

function gorge(c: PatternCtx, dx: number, w: number): void {
  c.pit(dx, w, { skin: "gorge" });
}

function ibex(c: PatternCtx, dx: number, vx = -240, hop = true): void {
  c.walker(dx, 96, 84, {
    skin: "ibex",
    vx,
    stompable: true,
    hb: [20, 10, 58, 72],
    p: hop ? { hopEvery: c.rng.range(1.0, 1.35), hopV: 640 } : {},
  });
}

function eagle(c: PatternCtx, dx: number, elev: number, vx = -110): void {
  c.flyer(dx, 112, 70, elev, { skin: "eagle", vx, amp: 12, per: 1.5, stompable: true, hb: [20, 14, 72, 44] });
}

/** Steinschlag: Schatten + fallender Fels (warn), Einschlag (active). Die Figur erreicht die Stelle etwa mittig im aktiven Fenster. */
function rockfall(c: PatternCtx, dx: number, early = 0): void {
  const phases = strikePhases(c, dx + ROCK_W / 2, 0.95, 0.34, 0.9, 0.5, early);
  c.zone(dx, ROCK_W, ROCK_H, 0, phases, { skin: "rockfall", hb: [14, 18, ROCK_W - 28, ROCK_H - 18] });
}

function rollstone(c: PatternCtx, dx: number, vx: number, size = 78): void {
  c.walker(dx, size, size, { skin: "rollstone", vx, stompable: false, breakable: true, warn: true, hb: [size * 0.14, size * 0.14, size * 0.72, size * 0.86] });
}

function snowball(c: PatternCtx, dx: number, vx: number, size = 74): void {
  c.walker(dx, size, size, { skin: "snowball", vx, stompable: false, breakable: true, warn: true, hb: [size * 0.14, size * 0.14, size * 0.72, size * 0.86] });
}

/** Seilbahn-Gondel (Plattform = Kabinendach), fährt entlang des Seils (Steigung CABLE_SLOPE). */
function gondola(c: PatternCtx, dx: number, w: number, elev: number, ampX: number, per: number, ph: number): void {
  c.platform(dx, w, elev, { skin: "gondola", ampX, ampY: -ampX * CABLE_SLOPE, per, ph, thick: GONDOLA_THICK });
}

/** Aufwind-Säule (Thermik). Hält man die Sprungtaste, steigt man langsam; Doppelsprung wird im Aufwind erneuert. */
function updraft(c: PatternCtx, dx: number, w: number, h: number, elev = 0, lift = 1900): void {
  c.wind(dx, w, h, elev, lift, { skin: "updraft" });
}

/**
 * Rettungs-Thermik tief in der Schlucht (unterhalb der Plattformen): wer abstürzt, wird gebremst und bekommt den
 * Doppelsprung zurück – ein zweiter Versuch statt sofortigem Absturz.
 */
function gorgeThermal(c: PatternCtx, x0: number, x1: number): void {
  if (x1 - x0 < 60) return;
  c.wind(x0, x1 - x0, 190, -160, 1900, { skin: "updraft", p: { low: 1 } });
}

/** Edelweiß-Bogen durch die Thermik */
function thermalArc(c: PatternCtx, x0: number, span: number, apex: number, n: number, base = 70): void {
  for (let i = 0; i < n; i += 1) {
    const u = n === 1 ? 0.5 : i / (n - 1);
    c.coin(x0 + span * u, base + Math.sin(u * Math.PI) * apex);
  }
}


/** Muster-Kontext, dessen Bausteine um `ox` px nach rechts versetzt sind (Anlauf vor Schluchten). */
function shifted(c: PatternCtx, ox: number): PatternCtx {
  const k: PatternCtx = {
    speed: c.speed,
    diff: c.diff,
    groundY: c.groundY,
    ceilY: c.ceilY,
    rng: c.rng,
    jumpDist: c.jumpDist,
    worldId: c.worldId,
    t: (sec) => c.t(sec),
    add: (spec) => c.add({ ...spec, x: spec.x + ox }),
    block: (dx, w, h, o) => c.block(dx + ox, w, h, o),
    overhead: (dx, w, bottom, o) => c.overhead(dx + ox, w, bottom, o),
    pit: (dx, w, o) => c.pit(dx + ox, w, o),
    platform: (dx, w, elev, o) => c.platform(dx + ox, w, elev, o),
    walker: (dx, w, h, o) => c.walker(dx + ox, w, h, o),
    flyer: (dx, w, h, elev, o) => c.flyer(dx + ox, w, h, elev, o),
    projectile: (dx, w, h, elev, o) => c.projectile(dx + ox, w, h, elev, o),
    swinger: (dx, anchorElev, len, o) => c.swinger(dx + ox, anchorElev, len, o),
    zone: (dx, w, h, elev, phases, o) => c.zone(dx + ox, w, h, elev, phases, o),
    spring: (dx, w, o) => c.spring(dx + ox, w, o),
    portal: (dx, o) => c.portal(dx + ox, o),
    wind: (dx, w, h, elev, lift, o) => c.wind(dx + ox, w, h, elev, lift, o),
    speedzone: (dx, w, mult, o) => c.speedzone(dx + ox, w, mult, o),
    decor: (dx, w, h, elev, o) => c.decor(dx + ox, w, h, elev, o),
    pickup: (type, dx, elev, o) => c.pickup(type, dx + ox, elev, o),
    coin: (dx, elev, o) => c.coin(dx + ox, elev, o),
    coinLine: (dx, elev, n, gap, o) => c.coinLine(dx + ox, elev, n, gap, o),
    coinArc: (dx, span, apex, n, o) => c.coinArc(dx + ox, span, apex, n, o),
    coinsOver: (dx, w, clear, n, o) => c.coinsOver(dx + ox, w, clear, n, o),
  };
  return k;
}

/** Schlucht-Muster mit kurzem Anlauf: die Figur landet sicher, bevor die erste Plattform angesprungen wird. */
function withRunUp(build: (c: PatternCtx) => number, sec = 0.3): (c: PatternCtx) => number {
  return (c) => {
    const lead = Math.round(c.t(sec));
    return lead + build(shifted(c, lead));
  };
}

// --- Muster -------------------------------------------------------------------------------------------

export const ALPEN_PATTERNS: PatternDef[] = [
  // ------------------------------------------------------------------ Einsteiger
  {
    id: "alp-zaun",
    minDiff: 0,
    weight: 2.4,
    tags: ["hop"],
    build(c) {
      const n = c.diff < 0.7 ? 1 : c.rng.int(1, 2);
      const gap = c.t(0.72);
      let end = 0;
      for (let i = 0; i < n; i += 1) {
        const w = fence(c, i * gap);
        c.coinsOver(i * gap, w, 120, 5);
        end = i * gap + w;
      }
      return end;
    },
  },
  {
    id: "alp-findling",
    minDiff: 0,
    weight: 2.2,
    tags: ["hop"],
    build(c) {
      const w = boulder(c, 0, c.rng.int(88, 116));
      c.coinsOver(0, w, w * 0.78 + 100, 6);
      return w;
    },
  },
  {
    id: "alp-holzstoss",
    minDiff: 0.3,
    weight: 1.8,
    tags: ["hop"],
    build(c) {
      const w = logs(c, 0, c.rng.int(104, 132), c.rng.int(62, 84));
      c.coinsOver(0, w, 170, 6);
      return w;
    },
  },
  {
    id: "alp-baumstamm",
    minDiff: 0.2,
    weight: 1.8,
    tags: ["hop"],
    build(c) {
      const w = trunk(c, 0);
      c.coinsOver(0, w, 140, 6);
      if (c.diff >= 1.2) {
        const d2 = w + c.t(0.8);
        const w2 = fence(c, d2);
        c.coinsOver(d2, w2, 120, 5);
        return d2 + w2;
      }
      return w;
    },
  },
  {
    id: "alp-murmeltier",
    minDiff: 0.9,
    weight: 1.4,
    tags: ["enemy"],
    build(c) {
      marmot(c, 0, -60);
      c.coinArc(-40, 240, 170, 5);
      if (c.diff >= 1.6) {
        marmot(c, c.t(0.85), -90);
        c.coinArc(c.t(0.85) - 40, 240, 170, 5);
        return c.t(0.85) + 54;
      }
      return 54;
    },
  },
  {
    id: "alp-kuh",
    minDiff: 0.5,
    weight: 1.6,
    tags: ["hop"],
    build(c) {
      const w = cow(c, 0);
      c.coinsOver(0, w, JUMP_HEIGHT - 16, 7);
      return w;
    },
  },
  {
    id: "alp-bachspalte",
    minDiff: 0.6,
    weight: 1.7,
    tags: ["gap"],
    build(c) {
      const w = Math.round(gapW(c, c.rng.int(160, 230)));
      gorge(c, 0, w);
      c.coinArc(-30, w + 60, 140, 6);
      return w;
    },
  },
  {
    id: "alp-felsdach",
    minDiff: 0.8,
    weight: 1.6,
    tags: ["slide"],
    build(c) {
      const w = c.rng.int(210, 320);
      ledge(c, 0, w);
      c.coinLine(18, 26, Math.floor((w - 10) / 56), 56);
      return w;
    },
  },
  {
    id: "alp-aufwind",
    minDiff: 1.0,
    weight: 1.5,
    tags: ["special", "gap"],
    build: withRunUp((c) => {
      // Breite Schlucht mit Thermik: Sprung hinein, Taste halten → man schwebt hinüber (Doppelsprung im Aufwind erneuert)
      const W = Math.round(Math.max(420, c.jumpDist * (c.diff < 3 ? 1.35 : 1.6)));
      gorge(c, 0, W);
      updraft(c, -40, W + 40, 380, 0);
      thermalArc(c, 10, W - 20, 250, 9, 80);
      if (c.diff >= 2) c.pickup("gem", W * 0.5, 360);
      return W;
    }),
  },
  // ------------------------------------------------------------------ Mittel
  {
    id: "alp-steinbock",
    minDiff: 1.2,
    weight: 1.6,
    tags: ["enemy"],
    build(c) {
      ibex(c, 0, -Math.round(200 + Math.min(80, c.diff * 12)), c.diff >= 1.8);
      c.coinArc(-60, 300, 200, 6);
      return 100;
    },
  },
  {
    id: "alp-schluchtsteg",
    minDiff: 1.3,
    weight: 1.5,
    tags: ["gap"],
    build: withRunUp((c) => {
      const side = Math.round(gapW(c, c.jumpDist * 0.42));
      const pw = Math.round(Math.max(Math.min(230, c.jumpDist * 0.5), c.t(0.3)));
      const W = side * 2 + pw;
      gorge(c, 0, W);
      c.platform(side, pw, 52, { skin: "plank", thick: 18 });
      c.coinArc(-20, side + 50, 130, 4);
      c.coinLine(side + 24, 104, Math.max(2, Math.floor((pw - 30) / 58)), 58);
      c.coinArc(side + pw - 30, side + 70, 140, 4);
      return W;
    }),
  },
  {
    id: "alp-adler",
    minDiff: 1.5,
    weight: 1.5,
    tags: ["enemy", "slide"],
    build(c) {
      eagle(c, 0, c.rng.int(58, 70), -Math.round(90 + c.diff * 10));
      c.coinLine(-150, 26, 6, 52);
      return 120;
    },
  },
  {
    id: "alp-steinschlag",
    minDiff: 1.8,
    weight: 1.4,
    tags: ["timing"],
    build(c) {
      rockfall(c, 0);
      c.coinsOver(0, ROCK_W, 170, 6);
      return ROCK_W;
    },
  },
  {
    id: "alp-seilbahn",
    minDiff: 2.0,
    weight: 1.5,
    tags: ["gap", "special"],
    build: withRunUp((c) => {
      const W = Math.round(c.t(1.45));
      const gw = Math.round(Math.max(170, Math.min(320, c.t(0.4))));
      const gx = Math.round(c.t(0.45));
      gondola(c, gx, gw, 96, c.rng.range(40, 62), c.rng.range(3.4, 4.2), c.rng.range(0, Math.PI * 2));
      gorge(c, 0, W);
      c.coinArc(-20, gx + gw / 2 + 20, 180, 5);
      c.coinArc(gx + gw - 10, W - gx - gw + 60, 150, 5);
      return W;
    }),
  },
  {
    id: "alp-lastenseil",
    minDiff: 2.2,
    weight: 1.3,
    tags: ["slide", "combo"],
    build(c) {
      const w = fence(c, 0);
      c.coinsOver(0, w, 120, 5);
      const ox = w + c.t(0.95);
      const ow = cargo(c, ox);
      c.coinLine(ox - 30, 26, Math.floor((ow + 60) / 52), 52);
      return ox + ow;
    },
  },
  {
    id: "alp-broeckelsteg",
    minDiff: 2.4,
    weight: 1.4,
    tags: ["gap", "timing"],
    build: withRunUp((c) => {
      const jd = c.jumpDist;
      // breite erste Platte (jeder vernünftige Absprung trifft), zweite höher und schmaler
      const pw1 = Math.round(Math.max(jd * 0.58, c.t(0.36)));
      const pw = Math.round(Math.max(Math.min(190, jd * 0.38), c.t(0.3)));
      const x1 = Math.round(jd * 0.32);
      const c2 = x1 + pw1 * 0.5 + landDist(c, 32);
      const x2 = Math.round(c2 - pw / 2);
      const tail = Math.round(gapW(c, jd * 0.42));
      const W = x2 + pw + tail;
      gorge(c, 0, W);
      c.platform(x1, pw1, 60, { skin: "crumble", thick: 26, crumble: 0.7 });
      c.platform(x2, pw, 92, { skin: "crumble", thick: 26, crumble: 0.52 });
      c.coinArc(-20, x1 + pw1 * 0.4 + 20, 150, 4);
      c.coinLine(x1 + 24, 114, 3, (pw1 - 48) / 2);
      c.coinArc(x1 + pw1 * 0.5, c2 - x1 - pw1 * 0.5, 200, 5);
      c.coinArc(x2 + pw * 0.5, tail + pw * 0.5 + 40, 150, 4);
      return W;
    }),
  },
  {
    id: "alp-rollstein",
    minDiff: 2.6,
    weight: 1.3,
    tags: ["enemy", "hop"],
    build(c) {
      rollstone(c, 0, -Math.round(260 + Math.min(120, c.diff * 14)));
      c.coinArc(-80, 300, 190, 6);
      return 80;
    },
  },
  {
    id: "alp-tiefschnee",
    minDiff: 2.8,
    weight: 1.1,
    tags: ["special", "hop"],
    build(c) {
      const w = c.rng.int(360, 480);
      c.speedzone(0, w, 0.8, { skin: "deepsnow" });
      coinRun(c, 30, w - 30, 40, 40, 58);
      const bx = w + c.t(0.75);
      const bw = boulder(c, bx, 96);
      c.coinsOver(bx, bw, 170, 5);
      return bx + bw;
    },
  },
  {
    id: "alp-steinmandl",
    minDiff: 3.0,
    weight: 1.2,
    tags: ["hop", "timing"],
    build(c) {
      const w1 = cairn(c, 0);
      c.coinsOver(0, w1, 190, 5);
      const d2 = w1 + c.t(1.0);
      const w2 = logs(c, d2, 118, 66);
      c.coinsOver(d2, w2, 160, 5);
      return d2 + w2;
    },
  },
  {
    id: "alp-eisplatte",
    minDiff: 3.2,
    weight: 1.1,
    tags: ["special", "gap"],
    build(c) {
      const w = c.rng.int(380, 480);
      c.speedzone(0, w, 1.25, { skin: "ice" });
      coinRun(c, 20, w - 20, 30, 30, 62);
      const px = w + c.t(0.55);
      const pw = Math.round(gapW(c, c.jumpDist * 0.55));
      gorge(c, px, pw);
      c.coinArc(px - 40, pw + 80, 160, 6);
      return px + pw;
    },
  },
  {
    id: "alp-steinbock-duo",
    minDiff: 3.8,
    weight: 1.2,
    tags: ["enemy", "combo"],
    build(c) {
      ibex(c, 0, -220, false);
      ibex(c, c.t(1.15), -280, true);
      c.coinArc(-40, 280, 210, 6);
      c.coinArc(c.t(1.15) - 40, 280, 210, 6);
      return c.t(1.15) + 100;
    },
  },
  {
    id: "alp-schneeball",
    minDiff: 4.2,
    weight: 1.2,
    tags: ["enemy", "timing"],
    build(c) {
      snowball(c, 0, -340, 70);
      snowball(c, c.t(1.2), -440, 86);
      c.coinArc(-60, 300, 190, 5);
      return c.t(1.2) + 90;
    },
  },
  // ------------------------------------------------------------------ Schwer
  {
    id: "alp-adler-schlucht",
    minDiff: 4.6,
    weight: 1.1,
    tags: ["combo", "gap"],
    build(c) {
      const pw = Math.round(gapW(c, c.jumpDist * 0.55));
      gorge(c, 0, pw);
      c.coinArc(-30, pw + 60, 150, 6);
      const ex = pw + c.t(1.05);
      eagle(c, ex, 60, -100);
      c.coinLine(ex - 120, 26, 5, 52);
      return ex + 112;
    },
  },
  {
    id: "alp-steinschlag-kaskade",
    minDiff: 5.2,
    weight: 1.1,
    tags: ["timing", "combo"],
    build(c) {
      const sp = c.t(1.0);
      const n = c.diff > 7 ? 3 : 2;
      for (let i = 0; i < n; i += 1) {
        rockfall(c, i * sp);
        c.coinsOver(i * sp, ROCK_W, 170, 5);
      }
      return (n - 1) * sp + ROCK_W;
    },
  },
  {
    id: "alp-broeckelgrat",
    minDiff: 5.5,
    weight: 1.0,
    tags: ["gap", "combo"],
    build: withRunUp((c) => {
      // aufsteigende, bröckelnde Felsstufen über der Schlucht; ein voller Sprung aus der Mitte trifft die nächste Mitte
      const jd = c.jumpDist;
      const pw = Math.round(Math.max(Math.min(180, jd * 0.34), c.t(0.28)));
      const elevs = [98, 150, 200];
      // stabiler Einstiegs-Felsvorsprung
      const ex = Math.round(jd * 0.05);
      const ew = Math.round(Math.max(jd * 0.72, c.t(0.5)));
      c.platform(ex, ew, 44, { skin: "crag", thick: 30 });
      c.coinLine(ex + 30, 100, 3, (ew - 60) / 2);
      let cx = ex + ew * 0.55;
      let prev = 44;
      for (let i = 0; i < elevs.length; i += 1) {
        cx += landDist(c, elevs[i] - prev);
        const x = Math.round(cx - pw / 2);
        c.platform(x, pw, elevs[i], { skin: "crumble", thick: 26, crumble: 0.52 - i * 0.03 });
        c.coinLine(x + 24, elevs[i] + 54, 2, Math.max(40, pw - 64));
        prev = elevs[i];
      }
      const end = Math.round(cx + pw / 2);
      const tail = Math.round(gapW(c, jd * 0.5));
      const W = end + tail;
      gorge(c, 0, W);
      gorgeThermal(c, ex + ew, W - 30);
      c.pickup("gem", end + tail * 0.5, 330);
      return W;
    }),
  },
  {
    id: "alp-schneeball-felsdach",
    minDiff: 6.2,
    weight: 1.0,
    tags: ["combo", "slide"],
    build(c) {
      snowball(c, 0, -360, 76);
      c.coinArc(-60, 280, 190, 5);
      const lx = c.t(1.25);
      const lw = c.rng.int(200, 260);
      ledge(c, lx, lw);
      c.coinLine(lx + 14, 26, Math.floor(lw / 56), 56);
      return lx + lw;
    },
  },
  {
    id: "alp-spaet-mix",
    minDiff: 6.8,
    weight: 1.1,
    tags: ["combo"],
    build(c) {
      const w = boulder(c, 0, 100);
      c.coinsOver(0, w, 170, 5);
      const cx = w + c.t(0.95);
      const cw = cargo(c, cx);
      c.coinLine(cx, 26, Math.floor(cw / 52) + 1, 52);
      const ix = cx + cw + c.t(1.0);
      ibex(c, ix, -240, false);
      return ix + 100;
    },
  },
  {
    id: "alp-spaet-steg-steinschlag",
    minDiff: 7.2,
    weight: 1.0,
    tags: ["gap", "timing"],
    build: withRunUp((c) => {
      const side = Math.round(gapW(c, c.jumpDist * 0.42));
      const pw = Math.round(Math.max(Math.min(200, c.jumpDist * 0.4), c.t(0.3)));
      const W = side * 2 + pw;
      gorge(c, 0, W);
      c.platform(side, pw, 60, { skin: "crumble", thick: 26, crumble: 0.55 });
      c.coinArc(-20, side + 40, 130, 4);
      c.coinArc(side + pw - 30, side + 70, 150, 4);
      const rx = W + c.t(0.95);
      rockfall(c, rx);
      c.coinsOver(rx, ROCK_W, 170, 5);
      return rx + ROCK_W;
    }),
  },
  // ------------------------------------------------------------------ Setpieces
  {
    id: "alp-gipfelgrat",
    minDiff: 3.5,
    weight: 0.8,
    tags: ["special", "gap"],
    build: withRunUp((c) => {
      // Setpiece „Gipfelgrat“: Felsstufen (teils bröckelnd) hinauf zum Gipfelplateau mit Gipfelkreuz und Edelstein.
      // Unter der letzten Scharte trägt eine Rettungs-Thermik (erneuert den Doppelsprung). Danach Absprung ins Tal.
      const jd = c.jumpDist;
      const pA = Math.round(Math.max(jd * 0.6, c.t(0.4)));
      const pB = Math.round(Math.max(Math.min(170, jd * 0.34), c.t(0.28)));
      const pD = Math.round(Math.max(250, jd * 0.6));
      const steps: Array<[number, number, string, number]> = [
        [76, pA, "crag", 0],
        [134, pB, "crumble", 0.6],
        [190, pB, "crumble", 0.55],
      ];
      const firstX = jd * 0.05;
      let cx = firstX + pA / 2;
      let prev = 0;
      let lastEnd = 0;
      for (let i = 0; i < steps.length; i += 1) {
        const [elev, w, skin, crumble] = steps[i];
        if (i > 0) cx += landDist(c, elev - prev);
        const x = Math.round(cx - w / 2);
        c.platform(x, w, elev, { skin, thick: 30, crumble });
        c.coinLine(x + 22, elev + 56, 2, Math.max(40, w - 60));
        prev = elev;
        lastEnd = x + w;
      }
      // Scharte + Gipfelplateau
      const dElev = 172;
      const dCx = cx + landDist(c, dElev - prev);
      const dx = Math.round(Math.max(lastEnd + jd * 0.3, dCx - pD * 0.35));
      updraft(c, lastEnd + 10, dx - lastEnd - 20, 150, 0, 1900);
      thermalArc(c, lastEnd + 20, dx - lastEnd - 40, 60, 4, 60);
      c.platform(dx, pD, dElev, { skin: "crag", thick: 30 });
      c.decor(dx + pD * 0.5 - 45, 90, 150, dElev, { skin: "summit-cross" });
      c.pickup("gem", dx + pD * 0.62, dElev + 190);
      c.coinArc(lastEnd - 20, dx - lastEnd + 60, dElev + 40, 5);
      const end = dx + pD;
      const tail = Math.round(gapW(c, jd * 0.5));
      const W = end + tail;
      gorge(c, 0, W);
      gorgeThermal(c, firstX + pA, lastEnd);
      c.coinArc(end - 30, tail + 70, 110, 4);
      return W;
    }),
  },
  {
    id: "alp-seilbahnfahrt",
    minDiff: 4.2,
    weight: 0.8,
    tags: ["special", "gap"],
    build: withRunUp((c) => {
      // Setpiece „Seilbahn-Talfahrt“: drei Gondeln am selben Seil, dazwischen Aufwind, am Ende Edelstein.
      const gw = Math.round(Math.max(170, Math.min(320, c.t(0.4))));
      const step = gw + Math.round(c.t(0.34));
      // Einstieg: Bergstation-Steg, dann drei Gondeln
      const jd = c.jumpDist;
      const ex = Math.round(jd * 0.05);
      const ew = Math.round(Math.max(jd * 0.72, c.t(0.5)));
      c.platform(ex, ew, 40, { skin: "plank", thick: 18 });
      c.coinLine(ex + 30, 96, 3, (ew - 60) / 2);
      const e0 = 110;
      const x0 = Math.round(ex + ew * 0.55 + landDist(c, e0 - 40) - gw / 2);
      const ph0 = c.rng.range(0, Math.PI * 2);
      for (let i = 0; i < 3; i += 1) {
        const gx = x0 + i * step;
        const elev = e0 + i * step * CABLE_SLOPE;
        gondola(c, gx, gw, elev, 46, 3.8, ph0 + i * 0.35);
        c.coinLine(gx + gw * 0.2, elev + 64, 3, gw * 0.3);
      }
      const lastX = x0 + 2 * step;
      const lastE = e0 + 2 * step * CABLE_SLOPE;
      c.pickup("gem", lastX + gw * 0.5 + c.t(0.3), lastE + 170);
      const W = lastX + gw + Math.round(c.t(0.5));
      updraft(c, lastX + gw - 20, W - lastX - gw + 40, 260, 40, 1500);
      gorge(c, 0, W);
      gorgeThermal(c, ex + ew, lastX + gw);
      c.coinArc(ex + ew * 0.5, x0 + gw / 2 - ex - ew * 0.5, 200, 5);
      return W;
    }),
  },
];
