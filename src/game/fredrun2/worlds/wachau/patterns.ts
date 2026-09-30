/**
 * Wachau – Level-Muster. Signatur: Floß-Sprünge über die Donau (Flöße wippen und sinken nach dem Landen, Frachtflöße mit
 * höherem Deck, gleitende Zillen) + rollende Weinfässer. Dazu Bienenschwärme, Marillenäste/Weinlauben (rutschen),
 * Trockensteinmauern & Weinkisten, Weinberg-Terrassen als Plattform-Treppen und Blätterwirbel (Aufwind).
 *
 * Abstände in ZEIT (c.t). Floß-Ketten richten die Mittelpunkte nach der Flugzeit eines vollen Sprungs aus (inkl.
 * Höhenunterschied), damit jede Figur mit Einzelsprüngen durchkommt; Münzbögen zeigen die Sprünge an.
 */
import { GRAVITY, JUMP_V } from "../../constants";
import type { BuilderOpts, PatternCtx, PatternDef } from "../../types";
import { T, hopW } from "../shared-b/pat";

const WATER = { skin: "water" } as const;
const CRATE: BuilderOpts = { skin: "crate", breakable: true };
const CRATES: BuilderOpts = { skin: "crates", breakable: true };
const WALL: BuilderOpts = { skin: "wall" };
/** Münzvariante „Traube“ (Weinberg) */
const GRAPE: BuilderOpts = { skin: "grape" };
const CASK: BuilderOpts = { skin: "cask" };

const qw = (x: number): number => Math.round(x / 10) * 10;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/** Landezeit eines vollen Sprungs auf eine um dh höhere (dh > 0) oder tiefere Fläche */
export function landT(dh: number): number {
  const d = JUMP_V * JUMP_V - 2 * GRAVITY * dh;
  return (JUMP_V + Math.sqrt(Math.max(0, d))) / GRAVITY;
}

/** Überhang bis zum oberen Bildrand */
function overheadOpts(c: PatternCtx, skin: string): BuilderOpts & { thick: number } {
  return { skin, thick: c.groundY - 72 + 40 };
}

/**
 * Rollendes Weinfass, das die Figur bei Musterposition D erreicht. Das Muster legt nur eine unsichtbare Markierung
 * ("barrel-cue") an; das Weltsystem lässt das Fass ≈ 1.35 s vor dem Treffpunkt am rechten Rand (mit Warnpfeil und
 * Rollgeräusch) loskugeln – exakt getimt auf das AKTUELLE Tempo. Fässer sind immer das letzte Element eines Musters
 * (rechts davon liegt nur die Ruhezone) → sie rollen nie über Wasser oder durch Hindernisse.
 */
function barrel(c: PatternCtx, D: number, vx: number, size = 70, tumble = false): void {
  c.decor(D, size, size, 0, { skin: "barrel-cue", p: { vx, size, tumble: tumble ? 1 : 0 } });
}

function barrelVx(c: PatternCtx, lo = 280, hi = 380): number {
  const k = Math.min(1, c.diff / 9);
  return -(lo + (hi - lo) * k + c.rng.range(0, 60));
}

function bees(c: PatternCtx, dx: number, elev: number, track = 0.7): void {
  c.flyer(dx, 104, 66, elev, { skin: "bees", amp: 14, per: 1.3, track, stompable: false });
}

type HopKind = "raft" | "cargo" | "boat";
interface Hop {
  kind: HopKind;
  /** Breite in Sekunden (Laufzeit) */
  w: number;
  elev?: number;
  crumble?: number;
  /** Gleiten (Sekunden Amplitude) */
  glide?: number;
  per?: number;
}

const RAFT_ELEV = -2;

/**
 * Donau-Überfahrt: Lücke ab x0 mit einer Kette schwimmender Plattformen. Rückgabe: Ende der Lücke und
 * Plattform-Mittelpunkte/-höhen (für Münzen/Belohnungen).
 */
function crossing(c: PatternCtx, x0: number, hops: Hop[], coins = true, moored = false): { end: number; centers: number[]; elevs: number[]; widths: number[] } {
  const centers: number[] = [];
  const elevs: number[] = [];
  const widths: number[] = [];
  let prevElev = 0;
  let cx = x0 + T(c, 0.6);
  let prevCenter = x0 - T(c, 0.2);
  let prevLeft = -Infinity;
  for (let i = 0; i < hops.length; i += 1) {
    const h = hops[i];
    const elev = h.elev ?? (h.kind === "boat" ? 2 : RAFT_ELEV);
    if (i > 0) cx = prevCenter + T(c, landT(elev - prevElev) * 1.03);
    const minW = h.kind === "cargo" ? 130 : 140;
    // Erstes Floß am Ufer vertäut: man läuft einfach drauf (großzügig breit, sinkt langsam)
    const isMoored = moored && i === 0 && h.kind === "raft";
    const w = qw(clamp(T(c, isMoored ? Math.max(0.58, h.w) : h.w), minW, h.kind === "boat" ? 640 : isMoored ? 680 : 560));
    if (isMoored) cx = x0 - 12 + w / 2;
    const glideAmp = h.kind === "boat" ? Math.min(T(c, h.glide ?? 0.1), w * 0.28) : 0;
    // Abdeckungsregel: auch ein früher Sprung vom Anfang der vorigen Plattform erreicht diese hier (inkl. Gleiten)
    if (i > 0 && Number.isFinite(prevLeft)) {
      const reach = prevLeft + T(c, landT(elev - prevElev) - 0.05);
      cx = Math.min(cx, reach - glideAmp + w / 2);
    }
    const left = cx - w / 2;
    const ph = c.rng.range(0, Math.PI * 2);
    if (h.kind === "raft") {
      c.platform(left, w, elev, { skin: "raft", thick: 20, crumble: isMoored ? 1.2 : h.crumble ?? 1.1, ampY: isMoored ? 2 : 5, per: c.rng.range(2.1, 2.8), ph });
    } else if (h.kind === "cargo") {
      c.platform(left, w, elev, { skin: "cargo", thick: 24, crumble: h.crumble ?? 0, ampY: 3, per: c.rng.range(2.6, 3.2), ph });
    } else {
      c.platform(left, w, elev, { skin: "boat", thick: 22, ampX: glideAmp, per: h.per ?? 3.2, ph });
    }
    if (coins && isMoored) {
      c.coinLine(left + 30, 40, Math.max(2, Math.floor((w - 40) / 56)), 56);
    } else if (coins) {
      const from = i === 0 ? x0 - T(c, 0.2) : prevCenter;
      const span = cx - from;
      const apexEl = Math.max(prevElev, elev) + 150;
      for (let k = 1; k < 5; k += 1) {
        const u = k / 5;
        const base = prevElev + (elev - prevElev) * u;
        c.coin(from + span * u, Math.max(40, base + 44 + Math.sin(u * Math.PI) * (apexEl - Math.max(prevElev, elev) + 20)));
      }
    }
    centers.push(cx);
    elevs.push(elev);
    widths.push(w);
    prevCenter = cx;
    prevElev = elev;
    prevLeft = left + glideAmp;
  }
  const lastW = widths[widths.length - 1] ?? 0;
  const end = prevCenter + Math.max(lastW / 2 + T(c, 0.22), T(c, landT(-prevElev) * 0.72));
  c.pit(x0, end - x0, WATER);
  if (coins) {
    const span = end + T(c, 0.25) - prevCenter;
    for (let k = 1; k < 5; k += 1) {
      const u = k / 5;
      const base = prevElev * (1 - u);
      c.coin(prevCenter + span * u, Math.max(40, base + 44 + Math.sin(u * Math.PI) * 150));
    }
  }
  return { end, centers, elevs, widths };
}

/** Weinberg-Terrasse (steinerne Stufe) */
function terrace(c: PatternCtx, dx: number, w: number, elev: number): void {
  c.platform(dx, qw(w), elev, { skin: "terrace", thick: 26 });
}

export const WACHAU_PATTERNS: PatternDef[] = [
  // --- Einsteiger --------------------------------------------------------------------------------
  {
    id: "wa-crate",
    minDiff: 0,
    weight: 3,
    tags: ["hop"],
    build(c) {
      const w = c.rng.int(62, 76);
      const h = c.rng.int(54, 68);
      c.block(0, w, h, CRATE);
      c.coinsOver(0, w, h + 90);
      return w;
    },
  },
  {
    id: "wa-wall",
    minDiff: 0.2,
    weight: 2.2,
    tags: ["hop"],
    build(c) {
      const w = hopW(c, qw(c.rng.int(96, 150)));
      const h = c.rng.int(46, 66);
      c.block(0, w, h, WALL);
      c.coinsOver(0, w, h + 80);
      return w;
    },
  },
  {
    id: "wa-creek",
    minDiff: 0.4,
    weight: 2,
    tags: ["gap"],
    build(c) {
      const w = qw(clamp(c.jumpDist * 0.5, 150, 300));
      c.pit(0, w, WATER);
      c.coinArc(-30, w + 60, 140, 7);
      return w;
    },
  },
  {
    id: "wa-branch",
    minDiff: 0.6,
    weight: 1.8,
    tags: ["slide"],
    build(c) {
      const w = qw(c.rng.int(180, 280));
      c.overhead(0, w, 72, overheadOpts(c, "branch"));
      c.coinLine(16, 28, Math.max(3, Math.floor(w / 52)), 50);
      return w;
    },
  },
  {
    id: "wa-raft",
    minDiff: 0.9,
    weight: 2,
    tags: ["gap", "special"],
    build(c) {
      const r = crossing(c, 0, [{ kind: "raft", w: 0.55 }]);
      return r.end;
    },
  },
  {
    id: "wa-barrel",
    minDiff: 1.0,
    weight: 1.8,
    tags: ["enemy"],
    build(c) {
      const D = T(c, 0.3);
      barrel(c, D, barrelVx(c, 260, 340), 70);
      c.coinArc(D - T(c, 0.45), T(c, 0.8), 170, 7);
      return D + 70;
    },
  },
  // --- Mittel -----------------------------------------------------------------------------------
  {
    id: "wa-bees",
    minDiff: 1.6,
    weight: 1.6,
    tags: ["enemy"],
    build(c) {
      const elev = c.rng.range(80, 120);
      bees(c, 0, elev, 0.65);
      c.coinLine(-40, 30, 4, 50);
      return 110;
    },
  },
  {
    id: "wa-raft-row",
    minDiff: 1.8,
    weight: 1.6,
    tags: ["gap"],
    build(c) {
      const n = c.diff > 3.5 ? 3 : 2;
      const hops: Hop[] = [];
      for (let i = 0; i < n; i += 1) hops.push({ kind: "raft", w: 0.52 });
      return crossing(c, 0, hops, true, true).end;
    },
  },
  {
    id: "wa-vines",
    minDiff: 2.0,
    weight: 1.5,
    tags: ["slide"],
    build(c) {
      const w = qw(c.rng.int(220, 320));
      c.overhead(0, w, 72, overheadOpts(c, "vines"));
      c.coinLine(16, 28, Math.max(3, Math.floor(w / 52)), 50, GRAPE);
      return w;
    },
  },
  {
    id: "wa-boat",
    minDiff: 2.2,
    weight: 1.5,
    tags: ["gap", "timing"],
    build(c) {
      return crossing(c, 0, [{ kind: "boat", w: 0.62, glide: 0.12, per: c.rng.range(2.8, 3.6) }]).end;
    },
  },
  {
    id: "wa-cask-crate",
    minDiff: 2.2,
    weight: 1.4,
    tags: ["hop"],
    build(c) {
      const w1 = c.rng.int(56, 64);
      c.block(0, w1, c.rng.int(76, 88), CASK);
      const gap = T(c, 1.05);
      const w2 = c.rng.int(64, 76);
      c.block(gap, w2, c.rng.int(96, 116), CRATES);
      c.coinsOver(0, w1, 170, 5);
      c.coinsOver(gap, w2, 190, 5);
      return gap + w2;
    },
  },
  {
    id: "wa-barrel-duo",
    minDiff: 2.5,
    weight: 1.4,
    tags: ["enemy", "timing"],
    build(c) {
      const D1 = T(c, 0.3);
      const D2 = D1 + T(c, 1.1);
      // Das zweite Fass startet weiter rechts und rollt schneller – beide sind die letzten Elemente
      barrel(c, D1, barrelVx(c, 260, 330), 66);
      barrel(c, D2, barrelVx(c, 330, 420), 74);
      c.coinArc(D1 - T(c, 0.4), T(c, 0.8), 170, 6);
      c.coinArc(D2 - T(c, 0.4), T(c, 0.8), 170, 6);
      return D2 + 74;
    },
  },
  {
    id: "wa-gust",
    minDiff: 2.6,
    weight: 1.2,
    tags: ["special", "gap"],
    build(c) {
      // Blätterwirbel über einem Floß: Sprung vom Floß in den Aufwind → hohe Marillenbahn + Edelstein
      const r = crossing(c, 0, [{ kind: "raft", w: 0.5, crumble: 1.4 }], false);
      const cx = r.centers[0];
      const ww = qw(clamp(T(c, 0.62), 220, 440));
      c.wind(cx - ww / 2, ww, 330, 70, 1900, { skin: "gust" });
      c.coinArc(-T(c, 0.2), cx + T(c, 0.2), 150, 6);
      for (let k = 0; k < 6; k += 1) c.coin(cx - ww * 0.3 + k * (ww * 0.12), 250 + k * 22);
      c.pickup("gem", cx + ww * 0.45, 380);
      c.coinArc(cx + T(c, 0.1), r.end - cx + T(c, 0.3), 190, 6);
      return r.end;
    },
  },
  {
    id: "wa-cargo",
    minDiff: 3.0,
    weight: 1.4,
    tags: ["gap"],
    build(c) {
      const elev = c.rng.pick([76, 96, 112]);
      return crossing(
        c,
        0,
        [
          { kind: "raft", w: 0.5 },
          { kind: "cargo", w: 0.55, elev },
          { kind: "raft", w: 0.52 },
        ],
        true,
        true,
      ).end;
    },
  },
  {
    id: "wa-branch-bees",
    minDiff: 3.2,
    weight: 1.3,
    tags: ["slide", "combo"],
    build(c) {
      const w = qw(c.rng.int(180, 240));
      c.overhead(0, w, 72, overheadOpts(c, "branch"));
      c.coinLine(12, 28, Math.floor(w / 52), 50);
      const bx = w + T(c, 1.0);
      bees(c, bx, c.rng.range(90, 120), 0.6);
      return bx + 104;
    },
  },
  {
    id: "wa-wall-barrel",
    minDiff: 3.6,
    weight: 1.3,
    tags: ["combo", "enemy"],
    build(c) {
      const w = hopW(c, qw(c.rng.int(96, 130)));
      c.block(0, w, c.rng.int(50, 64), WALL);
      c.coinsOver(0, w, 150, 5);
      const D = w + T(c, 1.05);
      barrel(c, D, barrelVx(c, 290, 380), 70);
      return D + 70;
    },
  },
  // --- Setpieces ---------------------------------------------------------------------------------
  {
    id: "wa-weinberg-treppe",
    minDiff: 3.0,
    weight: 0.9,
    tags: ["special", "combo"],
    build(c) {
      // Setpiece „Weinberg-Treppe": Terrassenstufen hinauf (Trauben/Marillen, Edelstein am Gipfel) und wieder hinab.
      // Unten: Weinkisten und ein Fass am Ende – wer oben bleibt, ist sicher.
      const elevs = [84, 158, 232, 158];
      const tw = clamp(T(c, 0.5), 150, 320);
      let prevE = 0;
      let cx = T(c, 0.55);
      let prevC = 0;
      const centers: number[] = [];
      for (let i = 0; i < elevs.length; i += 1) {
        if (i > 0) cx = prevC + T(c, landT(elevs[i] - prevE)) * 0.92;
        terrace(c, cx - tw / 2, tw, elevs[i]);
        c.coinLine(cx - tw * 0.3, elevs[i] + 40, 3, tw * 0.3, GRAPE);
        centers.push(cx);
        prevC = cx;
        prevE = elevs[i];
      }
      c.pickup("gem", centers[2], elevs[2] + 120);
      // Bodenroute
      c.block(centers[0] + tw * 0.1, 64, 58, CRATE);
      c.block(centers[2] - 30, 66, 62, CRATE);
      const end = prevC + tw / 2 + T(c, 0.3);
      const D = end + T(c, 0.75);
      barrel(c, D, barrelVx(c, 280, 360), 70);
      return D + 70;
    },
  },
  {
    id: "wa-donauueberfahrt",
    minDiff: 3.5,
    weight: 0.9,
    tags: ["special", "gap"],
    build(c) {
      // Setpiece „Donauüberfahrt": Floß → Floß → Frachtfloß → gleitende Zille → hohes Frachtfloß → Floß.
      const hi = c.rng.pick([118, 132]);
      const r = crossing(
        c,
        0,
        [
          { kind: "raft", w: 0.5 },
          { kind: "raft", w: 0.5, crumble: 0.95 },
          { kind: "cargo", w: 0.52, elev: 84 },
          { kind: "boat", w: 0.62, glide: 0.1, per: 3.4 },
          { kind: "cargo", w: 0.52, elev: hi },
          { kind: "raft", w: 0.52 },
        ],
        true,
        true,
      );
      c.pickup("gem", r.centers[4], hi + 170);
      // Fässer rollen am anderen Ufer heran
      const D1 = r.end + T(c, 0.85);
      const D2 = D1 + T(c, 1.05);
      barrel(c, D1, barrelVx(c, 260, 330), 68);
      barrel(c, D2, barrelVx(c, 320, 400), 72);
      return D2 + 72;
    },
  },
  // --- Schwer -------------------------------------------------------------------------------------
  {
    id: "wa-raft-sprint",
    minDiff: 5.0,
    weight: 1.3,
    tags: ["gap", "timing"],
    build(c) {
      // Floß-Sprint: jedes nächste Floß fängt jeden vollen Sprung vom vorigen auf (Abdeckungsregel), die Flöße sinken
      // aber schneller, als man darüber läuft → früh weiterhüpfen!
      const n = c.diff > 7 ? 4 : 3;
      let left = -12;
      let right = left + qw(clamp(T(c, 0.38), 150, 460));
      const crumble = c.diff > 8 ? 0.55 : 0.62;
      const lefts: number[] = [];
      const rights: number[] = [];
      for (let i = 0; i < n; i += 1) {
        if (i > 0) {
          const l = left + T(c, 0.78);
          const r = Math.min(l + T(c, 0.7), Math.max(right + T(c, 0.9), l + T(c, 0.4)));
          left = l;
          right = qw(r - l) + l;
        }
        lefts.push(left);
        rights.push(right);
        c.platform(left, right - left, RAFT_ELEV, { skin: "raft", thick: 20, crumble: i === 0 ? 1.2 : crumble, ampY: i === 0 ? 2 : 4, per: c.rng.range(2.1, 2.8), ph: c.rng.range(0, Math.PI * 2) });
      }
      const end = right + T(c, 0.2);
      c.pit(0, end, WATER);
      c.coinLine(20, 40, Math.max(2, Math.floor((rights[0] - 40) / 56)), 56);
      for (let i = 1; i < n; i += 1) c.coinArc(lefts[i - 1] + T(c, 0.12), lefts[i] + T(c, 0.2) - lefts[i - 1] - T(c, 0.12), 150, 5);
      c.coinArc(rights[n - 1] - T(c, 0.3), T(c, 0.75), 150, 5);
      return end;
    },
  },
  {
    id: "wa-creek-barrel",
    minDiff: 5.0,
    weight: 1.2,
    tags: ["combo", "gap"],
    build(c) {
      const w = qw(clamp(c.jumpDist * 0.52, 180, 440));
      c.pit(0, w, WATER);
      c.coinArc(-30, w + 60, 150, 7);
      const D = w + T(c, 1.0);
      barrel(c, D, barrelVx(c, 300, 400), 70);
      return D + 70;
    },
  },
  {
    id: "wa-barrel-volley",
    minDiff: 5.5,
    weight: 1.2,
    tags: ["enemy", "combo"],
    build(c) {
      const sp = T(c, 0.95);
      const D0 = T(c, 0.3);
      const sizes = [66, 76, 70];
      for (let i = 0; i < 3; i += 1) barrel(c, D0 + i * sp, barrelVx(c, 280 + i * 30, 380 + i * 30), sizes[i]);
      return D0 + 2 * sp + 76;
    },
  },
  {
    id: "wa-bee-gauntlet",
    minDiff: 6.0,
    weight: 1.2,
    tags: ["combo", "enemy"],
    build(c) {
      c.block(0, 66, 60, CRATE);
      c.coinsOver(0, 66, 150, 5);
      const bx = 66 + T(c, 0.95);
      bees(c, bx, c.rng.range(80, 110), 0.7);
      const ox = bx + 104 + T(c, 0.95);
      const w = qw(c.rng.int(200, 260));
      c.overhead(ox, w, 72, overheadOpts(c, "vines"));
      c.coinLine(ox + 12, 28, Math.floor(w / 52), 50);
      return ox + w;
    },
  },
  {
    id: "wa-late-crossing",
    minDiff: 6.5,
    weight: 1.1,
    tags: ["gap", "combo"],
    build(c) {
      const r = crossing(
        c,
        0,
        [
          { kind: "raft", w: 0.46, crumble: 0.8 },
          { kind: "boat", w: 0.62, glide: 0.12, per: 2.8 },
          { kind: "raft", w: 0.48, crumble: 0.7 },
          { kind: "cargo", w: 0.52, elev: 96 },
        ],
        true,
        true,
      );
      const bx = r.end + T(c, 1.0);
      bees(c, bx, 96, 0.75);
      return bx + 104;
    },
  },
  {
    id: "wa-wall-branch",
    minDiff: 4.2,
    weight: 1.2,
    tags: ["combo", "slide"],
    build(c) {
      const w = hopW(c, qw(c.rng.int(96, 126)));
      c.block(0, w, c.rng.int(52, 66), WALL);
      c.coinsOver(0, w, 150, 5);
      const ox = w + T(c, 0.95);
      const ow = qw(c.rng.int(180, 240));
      c.overhead(ox, ow, 72, overheadOpts(c, "branch"));
      c.coinLine(ox + 10, 28, Math.floor(ow / 52), 50);
      return ox + ow;
    },
  },
];
