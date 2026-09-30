/**
 * Christkindlmarkt – Level-Muster (30): Schneemann, Zuckerstangen-Zaun, Christbaum-Kiste, Eisflächen (Tempo ×1.3) mit
 * Sternenbahnen, Eisspalten, Lebkuchenmänner, Marktstände zum Überhüpfen, Eiszapfen (Vordach zum Unterrutschen und
 * fallende Zapfen mit Vorwarnung), Elfen mit Schneebällen (Bogenflug), Glühwein-Kessel mit Dampf-Aufwind,
 * Rodelschlitten (rutschende Plattformen), Krampus, Feuerkörbe und Glockenketten.
 * Setpieces: „Eisbahn-Slalom“, „Schlittenfahrt“ und „Krampuslauf“.
 *
 * Alle Abstände sind in ZEIT (`c.t`) angegeben. Auf Eis läuft die Figur ×1.3 schneller: innerhalb der Eisfläche sind
 * Abstände mit `iceT` skaliert, nach der Eisfläche folgt immer ≥ 1 s Auslauf (das Tempo braucht ≈ 0.4 s zum Normalisieren).
 */
import { PLAYER_SX, SPAWN_AHEAD } from "../../constants";
import type { PatternCtx, PatternDef, ZonePhase } from "../../types";
import { arriveT, coinRun, gapW, leadX, relWidth, strikePhases } from "../shared-a/pattern-kit";
import { DIM, HB, ICE_MULT, SKIN } from "./dims";

// --- Bausteine -----------------------------------------------------------------------------------

/** Zeit auf Eis: dieselbe Reaktionszeit bedeutet ×1.3 Weg. */
export const iceT = (c: PatternCtx, sec: number): number => c.t(sec) * ICE_MULT;

function snowman(c: PatternCtx, dx: number): number {
  const { w, h } = DIM.snowman;
  c.block(dx, w, h, { skin: SKIN.snowman, hb: HB.snowman(w, h) });
  return w;
}

function tree(c: PatternCtx, dx: number): number {
  const { w, h } = DIM.tree;
  c.block(dx, w, h, { skin: SKIN.tree, hb: HB.tree(w, h) });
  return w;
}

function cane(c: PatternCtx, dx: number): number {
  const { w, h } = DIM.cane;
  c.block(dx, w, h, { skin: SKIN.cane, hb: HB.cane(w, h) });
  return w;
}

function iceblock(c: PatternCtx, dx: number, breakable = true): number {
  const { w, h } = DIM.iceblock;
  c.block(dx, w, h, { skin: SKIN.iceblock, breakable, hb: HB.iceblock(w, h) });
  return w;
}

function presents(c: PatternCtx, dx: number): number {
  const { w, h } = DIM.presents;
  c.block(dx, w, h, { skin: SKIN.presents, hb: HB.presents(w, h) });
  return w;
}

function basket(c: PatternCtx, dx: number): number {
  const { w, h } = DIM.basket;
  c.block(dx, w, h, { skin: SKIN.basket, hb: HB.basket(w, h) });
  return w;
}

/** Marktstand als Block; mit `roof` zusätzlich begehbares Dach (Plattform) */
function stall(c: PatternCtx, dx: number, roof = false): number {
  const { w, h } = DIM.stall;
  c.block(dx, w, h, { skin: SKIN.stall, hb: HB.stall(w, h) });
  if (roof) c.platform(dx + 10, w - 20, h, { skin: SKIN.stallRoof, thick: 14 });
  return w;
}

/** Vordach mit Eiszapfen (Rutschen). Rückgabe: Breite. */
function awning(c: PatternCtx, dx: number, w: number, skin: string = SKIN.icicles): number {
  c.overhead(dx, w, 72, { skin, thick: 138 });
  return w;
}

function crevasse(c: PatternCtx, dx: number, w: number): void {
  c.pit(dx, w, { skin: SKIN.crevasse });
}

/** Lebkuchenmann (stampfbar, lässt Sterne fallen). */
function gingerbread(c: PatternCtx, dx: number, vx: number, hop = false): void {
  const { w, h } = DIM.gingerbread;
  c.walker(dx, w, h, { skin: SKIN.gingerbread, vx, stompable: true, hb: HB.gingerbread(w, h), p: hop ? { hopEvery: c.rng.range(1.1, 1.5), hopV: 640 } : {} });
}

/** Krampus: schnell, nicht stampfbar, Warnpfeil. Rückgabe: virtuelles Ende (relative Breite). */
function krampus(c: PatternCtx, D: number, vx: number, hop = false): number {
  const { w, h } = DIM.krampus;
  c.walker(leadX(c, D, vx), w, h, {
    skin: SKIN.krampus,
    vx,
    stompable: false,
    warn: true,
    hb: HB.krampus(w, h),
    p: hop ? { hopEvery: 1.3, hopV: 700 } : {},
  });
  return D + relWidth(c, w, vx);
}

function krampusVx(c: PatternCtx): number {
  return -Math.round(Math.min(340, 210 + c.diff * 12));
}

/** Rutschender Rodelschlitten als Hindernis (niedrig, kommt schnell entgegen). */
function sledHazard(c: PatternCtx, D: number, vx: number): number {
  const { w, h } = DIM.sled;
  c.walker(leadX(c, D, vx), w, h, { skin: SKIN.sled, vx, stompable: false, warn: true, hb: HB.sled(w, h) });
  return D + relWidth(c, w, vx);
}

/** Auftrieb der Dampfsäule (px/s²): knapp unter der Schwerkraft – die Figur schwebt hindurch */
export const STEAM_LIFT = 2450;

export interface SteamCol {
  x0: number;
  x1: number;
  lift: number;
  bottom: number;
  top: number;
}

/** Dampfsäule über einem Kessel bei `dx`: Breite ≈ 0.42 s Laufweg (bei jedem Tempo gleich lange Wirkung). */
export function steamCol(c: PatternCtx, dx: number): SteamCol {
  const cw = Math.min(480, Math.max(230, Math.round(c.t(0.42))));
  const x0 = Math.round(dx + DIM.kessel.w / 2 - cw / 2);
  return { x0, x1: x0 + cw, lift: STEAM_LIFT, bottom: 96, top: 380 };
}

/** Glühwein-Kessel: Block + Dampfsäule (Aufwind) darüber. */
function kessel(c: PatternCtx, dx: number): SteamCol {
  const { w, h } = DIM.kessel;
  c.block(dx, w, h, { skin: SKIN.kessel, hb: HB.kessel(w, h) });
  const col = steamCol(c, dx);
  c.wind(col.x0, col.x1 - col.x0, col.top - col.bottom, col.bottom, col.lift, { skin: SKIN.steam });
  return col;
}

/** Fallender Eiszapfen (Zone): Zapfen hängt am Vordach, Vorwarnung mit Tropfen/Glitzern, dann Einschlag am Boden. */
function icicleDrop(c: PatternCtx, dx: number, early = 0): number {
  const { w, h } = DIM.icicle;
  const phases: ZonePhase[] = strikePhases(c, dx + w / 2, 0.85, 0.32, 0.4, 0.45, early);
  c.zone(dx, w, h, 0, phases, { skin: SKIN.icicle, hb: HB.icicle(w, h) });
  return w;
}

/** Eisfläche (Tempozone ×1.3). Sternenbahn optional. */
function iceZone(c: PatternCtx, dx: number, len: number): void {
  c.speedzone(dx, len, ICE_MULT, { skin: SKIN.ice });
}

// --- Schneeball-Wurf ------------------------------------------------------------------------------

export interface ThrowOpts {
  /** Mittelpunkt des Elfen (Muster-x) */
  elfCx: number;
  /** Eigengeschwindigkeit des Elfen (Läufer) */
  elfVx?: number;
  /** Höhe der Wurfhand über dem Boden */
  hand: number;
  /** Höhe der Ballmitte, wenn er bei der Figur ankommt */
  target?: number;
  /** Ballgeschwindigkeit (negativ = der Figur entgegen) */
  vb?: number;
  /** Bildschirm-x des Elfen im Wurfmoment */
  relX?: number;
}

export interface ThrowInfo {
  /** Sekunden nach dem Spawn bis zum Wurf */
  tRel: number;
  /** Flugzeit bis zur Figur (Sekunden) */
  flight: number;
}

/**
 * Schneeball mit VORAUSBERECHNETER Flugbahn: Die Kugel startet schon beim Spawn (außerhalb des Bildes, unsichtbar bis
 * `p.tRel`) auf der rückwärts verlängerten Parabel und ist ab dem Wurfmoment genau in der Hand des Elfen. So sieht
 * der Bot (und jede Rechnung ohne Weltsystem) die Gefahr von Anfang an, und der Elf „wirft“ trotzdem sichtbar.
 */
export function throwBall(c: PatternCtx, o: ThrowOpts): ThrowInfo {
  const s = c.speed;
  const vxe = o.elfVx ?? 0;
  const relX = o.relX ?? 1150;
  const vb = o.vb ?? -Math.round(340 + Math.min(200, c.diff * 18));
  const tRel = Math.max(0.25, (SPAWN_AHEAD + o.elfCx - relX) / (s - vxe));
  const flight = (relX - PLAYER_SX) / (s - vb);
  const Hh = o.hand;
  const Ht = o.target ?? 100;
  let g: number;
  let u: number;
  if (Math.abs(Ht - Hh) < 12) {
    g = 240 / (flight * flight);
    u = (g * flight) / 2;
  } else {
    const a = Hh > Ht ? 0.18 : 0.82;
    g = (Ht - Hh) / ((a - 0.5) * flight * flight);
    u = a * g * flight;
  }
  const { w, h } = DIM.ball;
  const xh = o.elfCx + vxe * tRel - 8;
  const bx = xh - vb * tRel;
  const e0 = Hh - u * tRel - 0.5 * g * tRel * tRel;
  const spec = c.projectile(bx - w / 2, w, h, e0 - h / 2, { skin: SKIN.ball, vx: vb, gravity: g, hb: HB.ball(w, h) });
  spec.vy = -(u + g * tRel);
  spec.p = { ...spec.p, tRel, hand: Hh, flight };
  return { tRel, flight };
}

/** Elf auf dem Boden (Läufer): wirft, läuft dann weiter auf die Figur zu (stampfbar). */
function elfGround(c: PatternCtx, dx: number, vxe: number, o: Partial<ThrowOpts> = {}): ThrowInfo {
  const { w, h } = DIM.elf;
  const info = throwBall(c, { elfCx: dx + w / 2, elfVx: vxe, hand: h * 0.72, ...o });
  c.walker(dx, w, h, { skin: SKIN.elf, vx: vxe, stompable: true, warn: true, hb: HB.elf(w, h), p: { tRel: info.tRel } });
  return info;
}

/**
 * Elf auf dem Dach eines Marktstands im HINTERGRUND (Deko-Stand, nicht berührbar, dunkler gezeichnet): wirft schräg herab.
 * Stand und Ball sind entkoppelt: die Figur muss nur dem Ball ausweichen (kein zweites Hindernis im selben Moment).
 */
function elfRoof(c: PatternCtx, dx: number, o: Partial<ThrowOpts> = {}): ThrowInfo {
  const { w, h } = DIM.elf;
  const st = DIM.stallBg;
  const cx = dx + st.w / 2;
  const stand = st.h - 16;
  const info = throwBall(c, { elfCx: cx, hand: stand + h * 0.72, target: 104, ...o });
  c.decor(dx, st.w, st.h, 0, { skin: SKIN.stallBg });
  c.decor(cx - w / 2, w, h, stand, { skin: SKIN.elf, warn: true, p: { tRel: info.tRel } });
  return info;
}

// --- Rodelschlitten-Zug -----------------------------------------------------------------------------

export interface TrainInfo {
  /** Lückenbeginn (Muster-x) */
  P0: number;
  /** Lückenende */
  P1: number;
  /** Länge des Musters bis zum Lückenende */
  end: number;
  /** Schlittengeschwindigkeit */
  V: number;
  /** Relativtempo Figur ↔ Schlitten */
  rel: number;
}

/**
 * Kette rutschender Schlitten (Plattformen, alle mit gleicher Geschwindigkeit `V` in Laufrichtung) über einer
 * Eisspalte. Das Relativtempo `s − V` bleibt bei jedem Tempo ≈ 380–440 px/s, damit die Hüpfer zwischen den Schlitten
 * immer gleich fair sind. Der Zug erreicht die Spalte so, dass die Figur ihn mit einem normalen Sprung vor der
 * Kante trifft; er verlässt die Spalte erst, wenn die Figur den vorderen Rand erreicht hat (Rand hinter dem Spaltenende).
 */
function sledTrain(c: PatternCtx, elevs: number[], o: { gap?: number; width?: number; lead?: number } = {}): TrainInfo {
  const s = c.speed;
  const rel = Math.min(s - 120, 380 + 60 * Math.min(1, c.diff / 6));
  const V = Math.max(120, s - rel);
  const n = elevs.length;
  const ws = o.width ?? DIM.sledRide.w;
  const gap = o.gap ?? 86;
  const Wt = n * ws + (n - 1) * gap;
  // Anlauf: der Zug soll beim Spawn nicht links vom Musterbeginn liegen
  const P0 = Math.max(o.lead ?? 300, Math.ceil((1300 * V - 60 * s) / (s - V)));
  const Tc = arriveT(c, P0 - 100);
  const x1 = P0 + 60 - V * Tc;
  for (let i = 0; i < n; i += 1) {
    c.platform(x1 + i * (ws + gap), ws, elevs[i], {
      skin: SKIN.sledRide,
      vx: V,
      thick: 16,
      ampY: 3,
      per: 2.4,
      ph: i * 1.7,
    });
  }
  const P1 = Math.round(P0 - 100 + (s * (Wt + 160)) / rel - 240);
  crevasse(c, P0, P1 - P0);
  return { P0, P1, end: P1, V, rel };
}

/**
 * Flugbahn einer Figur, die vor `dx` abspringt und durch eine Dampfsäule steigt (Näherung ohne Apex-Verweilen).
 * Liefert Punkte (Muster-x, Höhe) im Abstand `step` px – für die Sternbahn und die Landeposition.
 */
export function boostPath(c: PatternCtx, takeoffX: number, col: SteamCol, step = 62): Array<{ x: number; h: number; vy: number }> {
  const dt = 1 / 120;
  const s = c.speed;
  let x = takeoffX;
  let h = 0;
  let vy = 1080;
  const out: Array<{ x: number; h: number; vy: number }> = [];
  let last = takeoffX - step;
  for (let i = 0; i < 480; i += 1) {
    vy -= 2700 * dt;
    if (x > col.x0 - 22 && x < col.x1 + 22 && h + 118 > col.bottom && h < col.top) vy += col.lift * dt;
    h += vy * dt;
    x += s * dt;
    if (x - last >= step) {
      out.push({ x, h, vy });
      last = x;
    }
    if (h <= 0 && vy < 0) break;
  }
  return out;
}

// --- Muster --------------------------------------------------------------------------------------

export const WINTER_PATTERNS: PatternDef[] = [
  // ------------------------------------------------------------------ Einsteiger
  {
    id: "win-schneemann",
    minDiff: 0,
    weight: 2.4,
    tags: ["hop"],
    build(c) {
      const n = c.diff < 0.7 ? 1 : c.rng.int(1, 2);
      const gap = c.t(0.68);
      const w = DIM.snowman.w;
      for (let i = 0; i < n; i += 1) {
        snowman(c, i * gap);
        c.coinsOver(i * gap, w, DIM.snowman.h + 60, 5);
      }
      return (n - 1) * gap + w;
    },
  },
  {
    id: "win-zuckerzaun",
    minDiff: 0,
    weight: 2.2,
    tags: ["hop"],
    build(c) {
      const n = c.diff < 0.8 ? 1 : c.rng.int(1, 2);
      const gap = c.t(0.62);
      const w = DIM.cane.w;
      for (let i = 0; i < n; i += 1) {
        cane(c, i * gap);
        c.coinsOver(i * gap, w, 130, 5);
      }
      return (n - 1) * gap + w;
    },
  },
  {
    id: "win-baumkiste",
    minDiff: 0.2,
    weight: 1.8,
    tags: ["hop"],
    build(c) {
      const w = tree(c, 0);
      c.coinsOver(0, w, DIM.tree.h + 40, 6);
      return w;
    },
  },
  {
    id: "win-eisspalte",
    minDiff: 0.5,
    weight: 1.6,
    tags: ["gap"],
    build(c) {
      const w = Math.round(gapW(c, c.rng.int(170, 230)));
      crevasse(c, 0, w);
      c.coinArc(-30, w + 60, 140, 6);
      return w;
    },
  },
  {
    id: "win-eisbahn",
    minDiff: 0.7,
    weight: 2.2,
    tags: ["special", "reward"],
    build(c) {
      // Erste Eisfläche: nur Tempo und Sterne, keine Hindernisse. Auslauf folgt durch die Ruhezone.
      const len = Math.round(iceT(c, 1.5));
      iceZone(c, 0, len);
      const n = Math.max(4, Math.floor(len / 66));
      c.coinLine(40, 84, n, 66);
      if (c.diff >= 1.6) c.pickup("gem", len - 60, 160);
      return len + c.t(0.5);
    },
  },
  {
    id: "win-lebkuchenmann",
    minDiff: 0.6,
    weight: 1.6,
    tags: ["enemy"],
    build(c) {
      const vx = -Math.round(120 + Math.min(80, c.diff * 14));
      gingerbread(c, 0, vx);
      c.coinArc(-40, 240, 160, 5);
      if (c.diff >= 1.8) {
        const d2 = c.t(1.1);
        gingerbread(c, d2, vx - 30);
        c.coinArc(d2 - 40, 240, 160, 5);
        return d2 + DIM.gingerbread.w;
      }
      return DIM.gingerbread.w;
    },
  },
  // ------------------------------------------------------------------ Mittel
  {
    id: "win-eisbloecke",
    minDiff: 1.0,
    weight: 1.6,
    tags: ["hop"],
    build(c) {
      const n = c.diff < 2 ? 1 : c.rng.int(1, 2);
      const gap = c.t(0.66);
      const w = DIM.iceblock.w;
      for (let i = 0; i < n; i += 1) {
        iceblock(c, i * gap);
        c.coinsOver(i * gap, w, DIM.iceblock.h + 60, 5);
      }
      return (n - 1) * gap + w;
    },
  },
  {
    id: "win-vordach",
    minDiff: 1.2,
    weight: 1.7,
    tags: ["slide"],
    build(c) {
      const w = c.rng.int(250, 360);
      awning(c, 0, w);
      c.coinLine(20, 26, Math.floor((w - 20) / 56), 56);
      return w;
    },
  },
  {
    id: "win-marktstand",
    minDiff: 1.4,
    weight: 1.6,
    tags: ["hop", "special"],
    build(c) {
      // Stand mit begehbarem Dach: hinaufhüpfen, Sterne auf dem Dach einsammeln
      const w = stall(c, 0, true);
      coinRun(c, 24, w - 20, DIM.stall.h + 52, DIM.stall.h + 52, 52);
      c.coinArc(-c.t(0.32), c.t(0.32) + 20, 120, 4);
      return w;
    },
  },
  {
    id: "win-elf-dach",
    minDiff: 1.8,
    weight: 1.4,
    tags: ["enemy", "timing"],
    build(c) {
      // Elf auf einem Marktdach im Hintergrund wirft herab: springen oder rutschen; danach ein Hindernis mit ≥ 1.2 s Luft
      elfRoof(c, 0);
      c.coinArc(-c.t(0.45), c.t(0.7) + 40, 190, 6);
      if (c.diff >= 3.6) {
        const bx = DIM.stallBg.w + c.t(1.9);
        cane(c, bx);
        c.coinsOver(bx, DIM.cane.w, 130, 5);
        return bx + DIM.cane.w;
      }
      return DIM.stallBg.w + 60;
    },
  },
  {
    id: "win-kessel",
    minDiff: 1.8,
    weight: 1.4,
    tags: ["special"],
    build(c) {
      // Kessel mit Dampfsäule: der Sprung darüber wird vom Aufwind getragen; Sternbahn folgt der Flugkurve
      const col = kessel(c, 0);
      const path = boostPath(c, -c.t(0.36), col);
      for (const p of path) if (p.h > 120 && p.x > -60) c.coin(p.x, Math.min(p.h + 30, 430));
      if (c.diff >= 3) c.pickup("gem", col.x1 + c.t(0.15), 300);
      return col.x1 + c.t(1.1);
    },
  },
  {
    id: "win-rodelschlitten",
    minDiff: 2.0,
    weight: 1.4,
    tags: ["enemy"],
    build(c) {
      const vx = -Math.round(250 + Math.min(110, c.diff * 14));
      const end = sledHazard(c, 0, vx);
      c.coinsOver(0, end, 130, 6);
      return end + 20;
    },
  },
  {
    id: "win-zapfen",
    minDiff: 2.2,
    weight: 1.3,
    tags: ["timing"],
    build(c) {
      const w = icicleDrop(c, 0);
      c.coinsOver(0, w, 150, 6);
      return w;
    },
  },
  {
    id: "win-geschenketurm",
    minDiff: 2.4,
    weight: 1.2,
    tags: ["hop"],
    build(c) {
      // Hoher Stapel: nur mit Doppelsprung, Sterne zeigen die Bahn
      const w = presents(c, 0);
      const top = DIM.presents.h;
      c.coinArc(-c.t(0.4), c.t(0.4) + w + c.t(0.4), top + 30, 9);
      if (c.diff >= 3.5) c.pickup("gem", w / 2, top + 100);
      return w;
    },
  },
  {
    id: "win-eis-hindernis",
    minDiff: 2.2,
    weight: 1.9,
    tags: ["special", "combo"],
    build(c) {
      // Eisfläche mit Sternenbogen, danach (mit Auslauf) ein einzelnes Hindernis
      const len = Math.round(iceT(c, 1.7));
      iceZone(c, 0, len);
      c.coinArc(40, len - 80, 150, 8);
      const bx = len + c.t(1.15);
      snowman(c, bx);
      c.coinsOver(bx, DIM.snowman.w, DIM.snowman.h + 50, 5);
      return bx + DIM.snowman.w;
    },
  },
  {
    id: "win-elf-boden",
    minDiff: 2.6,
    weight: 1.3,
    tags: ["enemy", "timing"],
    build(c) {
      // Elf am Boden: wirft und läuft dann heran – ein Sprung über den Ball landet auf dem Elfen (Stampf-Chance)
      elfGround(c, 0, -Math.round(70 + c.diff * 5));
      c.coinArc(-c.t(0.55), c.t(0.8), 200, 6);
      return DIM.elf.w + 40;
    },
  },
  {
    id: "win-schlittenbruecke",
    minDiff: 2.6,
    weight: 1.2,
    tags: ["gap", "special"],
    build(c) {
      // Zwei rutschende Schlitten tragen dich über die Eisspalte
      const t = sledTrain(c, [88, 88]);
      c.coinsOver(t.P0 - 120, 200, 100, 4);
      return t.end + 120;
    },
  },
  {
    id: "win-lebkuchen-kette",
    minDiff: 2.8,
    weight: 1.2,
    tags: ["enemy", "combo"],
    build(c) {
      // Stampf-Kette: aufeinanderfolgend draufspringen (Sterne über den Männchen zeigen die Bahn)
      const n = c.diff > 7 ? 4 : 3;
      const gap = c.t(0.74);
      for (let i = 0; i < n; i += 1) gingerbread(c, i * gap, -60);
      c.coinArc(c.t(0.1), gap * (n - 1), 230, 7);
      return (n - 1) * gap + DIM.gingerbread.w;
    },
  },
  {
    id: "win-krampus",
    minDiff: 3.2,
    weight: 1.5,
    tags: ["enemy"],
    build(c) {
      const vx = krampusVx(c);
      const end = krampus(c, 0, vx);
      c.coinsOver(0, end, 180, 7);
      return end + 30;
    },
  },
  {
    id: "win-ketten",
    minDiff: 3.4,
    weight: 1.2,
    tags: ["slide"],
    build(c) {
      const w = c.rng.int(260, 380);
      c.overhead(0, w, 72, { skin: SKIN.chains, thick: 150 });
      c.coinLine(20, 26, Math.floor((w - 20) / 56), 56);
      return w;
    },
  },
  {
    id: "win-feuerkoerbe",
    minDiff: 3.6,
    weight: 1.3,
    tags: ["hop", "combo"],
    build(c) {
      const n = c.diff < 5 ? 2 : 3;
      const gap = c.t(0.78);
      const w = DIM.basket.w;
      for (let i = 0; i < n; i += 1) {
        basket(c, i * gap);
        c.coinsOver(i * gap, w, DIM.basket.h + 60, 5);
      }
      return (n - 1) * gap + w;
    },
  },
  // ------------------------------------------------------------------ Schwer
  {
    id: "win-zapfengalerie",
    minDiff: 5.0,
    weight: 1.2,
    tags: ["slide", "timing", "combo"],
    build(c) {
      const w = c.rng.int(240, 320);
      awning(c, 0, w);
      c.coinLine(20, 26, Math.floor((w - 20) / 56), 56);
      const d2 = w + c.t(0.95);
      const iw = icicleDrop(c, d2);
      c.coinsOver(d2, iw, 150, 5);
      return d2 + iw;
    },
  },
  {
    id: "win-elf-duo",
    minDiff: 5.2,
    weight: 1.1,
    tags: ["enemy", "timing", "combo"],
    build(c) {
      // Zwei Elfen: der erste steht auf einem Dach im Hintergrund, der zweite läuft am Boden – Bälle mit ≥ 1 s Abstand
      elfRoof(c, 0);
      const d2 = DIM.stallBg.w + c.t(1.7);
      elfGround(c, d2, -90);
      c.coinArc(d2 - c.t(0.55), c.t(0.8), 200, 6);
      return d2 + DIM.elf.w + 40;
    },
  },
  {
    id: "win-krampus-hopser",
    minDiff: 5.4,
    weight: 1.1,
    tags: ["enemy", "combo"],
    build(c) {
      const vx = krampusVx(c) + 40;
      const end = krampus(c, 0, vx, true);
      const bx = end + c.t(1.05);
      basket(c, bx);
      c.coinsOver(bx, DIM.basket.w, DIM.basket.h + 60, 5);
      return bx + DIM.basket.w;
    },
  },
  {
    id: "win-kessel-flug",
    minDiff: 5.0,
    weight: 1.0,
    tags: ["special", "combo"],
    build(c) {
      // Kessel als Startrampe: der Aufwind trägt auf einen schwebenden Schlitten mit Sternen
      const col = kessel(c, 0);
      const path = boostPath(c, -c.t(0.36), col);
      for (const p of path) if (p.h > 120 && p.x > -60) c.coin(p.x, Math.min(p.h + 30, 430));
      // Landung: erste absteigende Kreuzung von 200 px Höhe hinter der Säule
      const elev = 200;
      const hit = path.find((p) => p.vy < 0 && p.h <= elev + 8 && p.x > col.x1 - 40) ?? path[path.length - 2];
      const vx = 130;
      const sw = DIM.sledRide.w;
      const D = hit.x - 110;
      c.platform(leadX(c, D, vx), sw, elev, { skin: SKIN.sledRide, vx, thick: 16, ampY: 3, per: 2.2 });
      c.coinLine(hit.x - 60, elev + 52, 3, 62);
      c.pickup("gem", hit.x + 160, elev + 90);
      return hit.x + sw + c.t(1.3);
    },
  },
  {
    id: "win-eisschanze",
    minDiff: 6.0,
    weight: 1.0,
    tags: ["combo", "special"],
    build(c) {
      // Lange Eisfläche, danach (mit Auslauf) hoher Geschenkestapel: Doppelsprung mit Tempo
      const len = Math.round(iceT(c, 1.9));
      iceZone(c, 0, len);
      c.coinArc(30, len - 60, 170, 8);
      const bx = len + c.t(1.25);
      const w = presents(c, bx);
      c.coinArc(bx - c.t(0.4), c.t(0.8) + w, DIM.presents.h + 30, 9);
      return bx + w;
    },
  },
  {
    id: "win-schneeballschlacht",
    minDiff: 6.5,
    weight: 0.9,
    tags: ["timing", "combo", "enemy"],
    build(c) {
      // Drei Elfen werfen nacheinander (Ankunft je ≈ 1.1 s Abstand)
      const gap = c.t(1.15);
      const x0 = 0;
      for (let i = 0; i < 3; i += 1) {
        const dx = x0 + i * gap * 1.1;
        elfGround(c, dx, -60, { target: 100, vb: -420 });
      }
      c.coinArc(0, gap * 2, 220, 9);
      return gap * 2.2 + DIM.elf.w + 40;
    },
  },
  {
    id: "win-krampus-lauf-vorspiel",
    minDiff: 6.2,
    weight: 0.9,
    tags: ["combo", "enemy"],
    build(c) {
      // Lebkuchen wird gestampft, dahinter kommt der Krampus
      gingerbread(c, 0, -80);
      c.coinArc(-40, 240, 170, 5);
      const D = c.t(1.6);
      const end = krampus(c, D, krampusVx(c) + 30);
      c.coinsOver(D, end - D, 180, 6);
      return end + 30;
    },
  },
  // ------------------------------------------------------------------ Setpieces
  {
    id: "win-set-eisbahn-slalom",
    minDiff: 3.2,
    weight: 0.9,
    tags: ["special", "combo"],
    build(c) {
      // Eisbahn-Slalom: Eisfläche + Sternenbahn + Vordach zum Unterrutschen + Schneemann zum Überspringen, am Ende ein Herz
      const len = Math.round(iceT(c, 4.0));
      iceZone(c, 0, len);
      const a0 = Math.round(iceT(c, 1.0));
      const aw = Math.round(iceT(c, 0.5)) + 180;
      awning(c, a0, aw);
      c.coinLine(a0 + 20, 26, Math.floor((aw - 20) / 58), 58);
      const s0 = a0 + aw + Math.round(iceT(c, 0.9));
      snowman(c, s0);
      c.coinsOver(s0, DIM.snowman.w, DIM.snowman.h + 60, 7);
      const i0 = s0 + DIM.snowman.w + Math.round(iceT(c, 0.85));
      const iw = iceblock(c, i0, false);
      c.coinsOver(i0, iw, DIM.iceblock.h + 60, 7);
      c.coinLine(i0 + iw + Math.round(iceT(c, 0.3)), 84, 5, 66);
      c.pickup("gem", len - 30, 170);
      return len + c.t(0.6);
    },
  },
  {
    id: "win-set-schlittenfahrt",
    minDiff: 3.4,
    weight: 0.8,
    tags: ["special", "gap"],
    build(c) {
      // Schlittenfahrt: drei Schlitten in verschiedenen Höhen über eine lange Eisspalte, Sterne auf jedem Schlitten
      const elevs = [88, 118, 88];
      const t = sledTrain(c, elevs, { lead: 340 });
      c.coinArc(t.P0 - 200, 200, 110, 4);
      c.pickup("gem", t.P0 + Math.round((t.P1 - t.P0) * 0.5), 210);
      return t.end + 160;
    },
  },
  {
    id: "win-set-krampuslauf",
    minDiff: 4.4,
    weight: 0.8,
    tags: ["special", "combo", "enemy"],
    build(c) {
      // Krampuslauf: Fackelgasse (Feuerkörbe), Glockenketten zum Unterrutschen, dann der Krampus in voller Fahrt
      const g1 = c.t(0.8);
      basket(c, 0);
      c.coinsOver(0, DIM.basket.w, DIM.basket.h + 60, 5);
      basket(c, g1);
      c.coinsOver(g1, DIM.basket.w, DIM.basket.h + 60, 5);
      const cx = g1 + DIM.basket.w + c.t(0.95);
      const cw = 260;
      c.overhead(cx, cw, 72, { skin: SKIN.chains, thick: 150 });
      c.coinLine(cx + 20, 26, Math.floor((cw - 20) / 56), 56);
      const D = cx + cw + c.t(1.7);
      const vx = krampusVx(c);
      const end = krampus(c, D, vx);
      c.coinsOver(D, end - D, 190, 7);
      c.pickup("gem", end + c.t(0.4), 150);
      return end + c.t(0.5);
    },
  },
];

/**
 * „Eisrausch“: wird vom Weltsystem in der Stufe „Eistraum“ zusätzlich zwischen die Muster geschoben (eine lange Eisfläche
 * mit Sternenwellen, ab diff 2 mit einem Zaun mittendrin und einem Herz am Ende). Kein Teil der normalen Musterliste.
 */
export const ICE_RUN: PatternDef = {
  id: "win-eisrausch",
  minDiff: 0,
  tags: ["special", "reward"],
  build(c) {
    const len = Math.round(iceT(c, c.diff < 2 ? 2.6 : 3.4));
    iceZone(c, 0, len);
    const n = Math.floor((len - 120) / 62);
    const fx = Math.round(len * 0.55);
    const fence = c.diff >= 2;
    for (let i = 0; i < n; i += 1) {
      const x = 70 + i * 62;
      if (fence && Math.abs(x - (fx + DIM.cane.w / 2)) < DIM.cane.w / 2 + 90) continue;
      c.coin(x, 84 + Math.sin(i * 0.55) * 46);
    }
    if (fence) {
      cane(c, fx);
      c.coinsOver(fx, DIM.cane.w, 140, 6);
    }
    c.pickup("gem", len - 40, 170);
    return len + c.t(0.7);
  },
};
