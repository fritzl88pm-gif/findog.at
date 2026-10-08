/**
 * Wachau – vorgerenderte Kulissen-Kacheln (einmal beim Laden, horizontal nahtlos).
 * Ebenen: Himmel · ferne Waldviertel-Höhen · gegenüberliegendes Donauufer mit Weinterrassen, Dürnstein & Dörfern ·
 * nahes Ufer (Pappeln, Weiden, Marillenbäume, Weinberghang, Heurigen) · Weinzeilen am Wegrand · Uferweg ·
 * Weinlaub-Girlande (Vordergrund oben) · Gräser (Vordergrund unten) · Nebelbänder · Wolken · Lichtstrahlen.
 */
import { ctxOf, paint, wrapDraw, type Ctx2D } from "../shared-b/canvas";
import { mulberry } from "../shared-b/color";
import { MILKY, STAGES, STARS, withA, type StageColors } from "./palette";

const TAU = Math.PI * 2;

// ------------------------------------------------------------------------------------------------
// Grundformen

/** 2D-Wertrauschen 0..1, in x periodisch mit Periode px (Gitterzellen) → nahtlose Kacheln */
export function vnoise2(x: number, y: number, px: number, seed = 0): number {
  const P = Math.max(1, Math.round(px));
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const hh = (a: number, b: number): number => {
    const s = Math.sin((((a % P) + P) % P) * 127.1 + b * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hh(ix, iy);
  const b = hh(ix + 1, iy);
  const c = hh(ix, iy + 1);
  const d = hh(ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Periodische Distanz (für nahtlose Hügelprofile) */
function wrapDist(x: number, c: number, W: number): number {
  let d = (((x - c) % W) + W) % W;
  if (d > W / 2) d = W - d;
  return d;
}

type Bump = readonly [x: number, h: number, sigma: number];

/** Periodisches Hügelprofil: Summe von Gauß-Buckeln + Sinusrauschen (ganzzahlige Frequenzen → nahtlos). */
export function hillProfile(W: number, bumps: readonly Bump[], noise: ReadonlyArray<readonly [f: number, a: number, ph: number]>): (x: number) => number {
  return (x: number) => {
    let mx = 0;
    let sum = 0;
    for (const [bx, bh, s] of bumps) {
      const d = wrapDist(x, bx, W) / s;
      const v = bh * Math.exp(-d * d);
      if (v > mx) mx = v;
      sum += v * 0.12;
    }
    let h = mx + sum;
    for (const [f, a, ph] of noise) h += a * Math.sin((x / W) * TAU * f + ph);
    return h;
  };
}

function profilePath(g: Ctx2D, W: number, base: number, prof: (x: number) => number, step = 4): void {
  g.beginPath();
  g.moveTo(0, base + 40);
  for (let x = 0; x <= W; x += step) g.lineTo(x, base - prof(x));
  g.lineTo(W, base + 40);
  g.closePath();
}

/** Weinblatt (5 Lappen) */
export function grapeLeaf(g: Ctx2D, x: number, y: number, r: number, rot: number, fill: string, vein: string | null): void {
  g.beginPath();
  const n = 22;
  for (let i = 0; i <= n; i += 1) {
    const a = (i / n) * TAU;
    const lobe = 0.72 + 0.28 * Math.abs(Math.cos(a * 2.5));
    const notch = a > Math.PI * 0.42 && a < Math.PI * 0.58 ? 0.55 : 1;
    const rr = r * lobe * notch;
    const px = x + Math.cos(a + rot) * rr;
    const py = y + Math.sin(a + rot) * rr;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  if (vein) {
    g.strokeStyle = vein;
    g.lineWidth = Math.max(0.6, r * 0.08);
    g.beginPath();
    for (let k = 0; k < 5; k += 1) {
      const a = rot - Math.PI / 2 + (k - 2) * 0.62 + Math.PI;
      g.moveTo(x + Math.cos(rot + Math.PI / 2) * r * 0.35, y + Math.sin(rot + Math.PI / 2) * r * 0.35);
      g.lineTo(x + Math.cos(a) * r * 0.78, y + Math.sin(a) * r * 0.78);
    }
    g.stroke();
  }
}

/** Traube (Beeren im Dreieck) */
export function grapeBunch(g: Ctx2D, x: number, y: number, s: number, c1: string, c2: string, hi: string): void {
  const rows = [4, 4, 3, 3, 2, 1];
  const br = s * 0.13;
  g.strokeStyle = "#5a4020";
  g.lineWidth = Math.max(1, s * 0.05);
  g.beginPath();
  g.moveTo(x, y - br * 1.6);
  g.lineTo(x + s * 0.1, y - br * 3);
  g.stroke();
  for (let r = 0; r < rows.length; r += 1) {
    const n = rows[r];
    for (let i = 0; i < n; i += 1) {
      const bx = x + (i - (n - 1) / 2) * br * 1.7 + (r % 2 ? br * 0.3 : 0);
      const by = y + r * br * 1.45;
      g.fillStyle = (i + r) % 3 === 0 ? c2 : c1;
      g.beginPath();
      g.arc(bx, by, br, 0, TAU);
      g.fill();
      g.fillStyle = hi;
      g.beginPath();
      g.arc(bx - br * 0.35, by - br * 0.35, br * 0.32, 0, TAU);
      g.fill();
    }
  }
}

/** Marillenbaum: Stamm + Krone (grün/gold) mit orangen Früchten */
export function apricotTree(g: Ctx2D, x: number, base: number, s: number, rnd: () => number, fruit = true): void {
  // Stamm
  g.fillStyle = "#4a3424";
  g.beginPath();
  g.moveTo(x - s * 0.07, base);
  g.quadraticCurveTo(x - s * 0.02, base - s * 0.4, x - s * 0.18, base - s * 0.7);
  g.lineTo(x - s * 0.1, base - s * 0.72);
  g.quadraticCurveTo(x + s * 0.02, base - s * 0.5, x + s * 0.06, base - s * 0.62);
  g.quadraticCurveTo(x + s * 0.12, base - s * 0.72, x + s * 0.2, base - s * 0.74);
  g.lineTo(x + s * 0.22, base - s * 0.7);
  g.quadraticCurveTo(x + s * 0.08, base - s * 0.45, x + s * 0.07, base);
  g.closePath();
  g.fill();
  // Krone
  const blobs = 11;
  const cols = ["#4f6a2c", "#5f7a32", "#6f8a38", "#8a9a3e", "#a99a3a"];
  for (let i = 0; i < blobs; i += 1) {
    const a = (i / blobs) * Math.PI + Math.PI;
    const cx = x + Math.cos(a) * s * 0.36 * (0.6 + rnd() * 0.5);
    const cy = base - s * 0.78 + Math.sin(a) * s * 0.22 * (0.6 + rnd() * 0.5);
    const r = s * (0.16 + rnd() * 0.1);
    g.fillStyle = cols[Math.floor(rnd() * 3)];
    g.beginPath();
    g.arc(cx, cy, r, 0, TAU);
    g.fill();
  }
  for (let i = 0; i < 7; i += 1) {
    const cx = x + (rnd() - 0.5) * s * 0.6;
    const cy = base - s * 0.86 + (rnd() - 0.5) * s * 0.26;
    g.fillStyle = cols[2 + Math.floor(rnd() * 3)];
    g.beginPath();
    g.arc(cx, cy, s * (0.1 + rnd() * 0.08), 0, TAU);
    g.fill();
  }
  // Licht von oben
  g.fillStyle = "rgba(255,236,160,0.18)";
  g.beginPath();
  g.ellipse(x - s * 0.05, base - s * 0.98, s * 0.32, s * 0.12, 0, 0, TAU);
  g.fill();
  if (fruit) {
    for (let i = 0; i < 14; i += 1) {
      const fx = x + (rnd() - 0.5) * s * 0.78;
      const fy = base - s * 0.62 - rnd() * s * 0.38;
      g.fillStyle = rnd() < 0.3 ? "#e8752a" : "#f39a36";
      g.beginPath();
      g.arc(fx, fy, Math.max(1.2, s * 0.035), 0, TAU);
      g.fill();
    }
  }
}

/** Säulenpappel im Herbstgold */
export function poplar(g: Ctx2D, x: number, base: number, h: number, w: number, rnd: () => number): void {
  g.fillStyle = "#4a3a2a";
  g.fillRect(x - w * 0.05, base - h * 0.2, w * 0.1, h * 0.2);
  const n = 9;
  for (let i = 0; i < n; i += 1) {
    const u = i / (n - 1);
    const cy = base - h * 0.16 - u * h * 0.8;
    const rw = w * 0.5 * Math.sin(0.25 + u * 2.6) * (0.85 + rnd() * 0.25);
    g.fillStyle = i % 3 === 0 ? "#b89434" : i % 3 === 1 ? "#9c8a30" : "#c9a53c";
    g.beginPath();
    g.ellipse(x + (rnd() - 0.5) * w * 0.12, cy, Math.max(2, rw), h * 0.12, 0, 0, TAU);
    g.fill();
  }
  g.fillStyle = "rgba(255,240,170,0.22)";
  g.beginPath();
  g.ellipse(x - w * 0.12, base - h * 0.6, w * 0.16, h * 0.3, 0, 0, TAU);
  g.fill();
}

/** Silberweide (hängend) */
export function willow(g: Ctx2D, x: number, base: number, s: number, rnd: () => number): void {
  g.fillStyle = "#4b4232";
  g.fillRect(x - s * 0.05, base - s * 0.45, s * 0.1, s * 0.45);
  for (let i = 0; i < 9; i += 1) {
    const a = Math.PI + (i / 8) * Math.PI;
    g.fillStyle = i % 2 ? "#8a9a6a" : "#9aa878";
    g.beginPath();
    g.ellipse(x + Math.cos(a) * s * 0.34, base - s * 0.62 + Math.sin(a) * s * 0.2, s * 0.24, s * 0.2, 0, 0, TAU);
    g.fill();
  }
  g.strokeStyle = "rgba(90,110,70,0.7)";
  g.lineWidth = 1.2;
  g.beginPath();
  for (let i = 0; i < 26; i += 1) {
    const sx = x + (rnd() - 0.5) * s * 0.95;
    const sy = base - s * 0.72 + rnd() * s * 0.2;
    g.moveTo(sx, sy);
    g.quadraticCurveTo(sx + 2, sy + s * 0.2, sx - 1, sy + s * (0.3 + rnd() * 0.2));
  }
  g.stroke();
}

/** Schilf/Rohrkolben entlang eines Ufers */
export function reeds(g: Ctx2D, W: number, x0: number, x1: number, base: number, h: number, rnd: () => number): void {
  g.lineWidth = 1.4;
  for (let x = x0; x < x1; x += 3 + rnd() * 5) {
    const hh = h * (0.5 + rnd() * 0.6);
    const lean = (rnd() - 0.5) * 8;
    const col = rnd() < 0.5 ? "#8a8a4a" : "#a49452";
    wrapDraw(W, x, 12, (px) => {
      g.strokeStyle = col;
      g.beginPath();
      g.moveTo(px, base);
      g.quadraticCurveTo(px + lean * 0.3, base - hh * 0.6, px + lean, base - hh);
      g.stroke();
    });
    if (rnd() < 0.18) {
      wrapDraw(W, x, 12, (px) => {
        g.fillStyle = "#5a3a22";
        g.beginPath();
        g.ellipse(px + lean * 0.92, base - hh * 0.9, 2.2, 6, 0, 0, TAU);
        g.fill();
      });
    }
  }
}

/** Unregelmäßige Trockensteinmauer (Wachauer Gneis, flach geschichtet) */
export function stoneWall(g: Ctx2D, x: number, y: number, w: number, h: number, rnd: () => number, scale = 1): void {
  g.fillStyle = "#6d6457";
  g.fillRect(x, y, w, h);
  let yy = y;
  while (yy < y + h) {
    const rh = (5 + rnd() * 5) * scale;
    let xx = x - rnd() * 10 * scale;
    while (xx < x + w) {
      const sw = (12 + rnd() * 22) * scale;
      const v = rnd();
      g.fillStyle = v < 0.25 ? "#a39a88" : v < 0.5 ? "#8f8574" : v < 0.75 ? "#b0a48c" : "#998c78";
      g.beginPath();
      const x0 = Math.max(x, xx + 1);
      const x1 = Math.min(x + w, xx + sw - 1);
      if (x1 > x0) {
        const yb = Math.min(y + h, yy + rh - 1);
        g.moveTo(x0, yy + 1 + rnd() * 1.5);
        g.lineTo(x1, yy + 1 + rnd() * 1.5);
        g.lineTo(x1, yb);
        g.lineTo(x0, yb);
        g.closePath();
        g.fill();
        g.fillStyle = "rgba(255,248,230,0.16)";
        g.fillRect(x0, yy + 1, x1 - x0, Math.max(1, scale));
      }
      xx += sw;
    }
    yy += rh;
  }
}

// ------------------------------------------------------------------------------------------------
// Himmel

export function skyCanvas(stage: number, W: number, Hc: number, reuse?: HTMLCanvasElement | null): HTMLCanvasElement {
  const S = STAGES[stage];
  const H = 600;
  return paint(W, Hc, (g) => {
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, S.skyTop);
    grd.addColorStop(0.58, S.skyMid);
    grd.addColorStop(1, S.skyLow);
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    // Horizontglühen
    if (stage === 2 || stage === 3 || stage === 0) {
      const hg = g.createRadialGradient(W * 0.7, H, 20, W * 0.7, H, W * 0.75);
      hg.addColorStop(0, withA(stage === 3 ? "#ff9fb8" : stage === 0 ? "#ffe0c8" : "#ffc070", stage === 3 ? 0.35 : 0.45));
      hg.addColorStop(1, withA(S.skyMid, 0));
      g.fillStyle = hg;
      g.fillRect(0, 0, W, H);
    }
    // Milchstraße
    const mk = MILKY[stage];
    if (mk > 0.01) {
      const r = mulberry(91);
      g.save();
      g.translate(W * 0.55, H * 0.1);
      g.rotate(0.42);
      for (let i = 0; i < 60; i += 1) {
        const px = (r() - 0.5) * W * 1.3;
        const py = (r() - 0.5) * 90 * (1 + Math.cos((px / W) * 3) * 0.4);
        const rad = 30 + r() * 60;
        const mg = g.createRadialGradient(px, py, 0, px, py, rad);
        mg.addColorStop(0, `rgba(190,200,255,${(0.05 * mk).toFixed(3)})`);
        mg.addColorStop(1, "rgba(190,200,255,0)");
        g.fillStyle = mg;
        g.fillRect(px - rad, py - rad, rad * 2, rad * 2);
      }
      for (let i = 0; i < 900; i += 1) {
        const px = (r() - 0.5) * W * 1.3;
        const py = (r() + r() + r() - 1.5) * 60;
        g.fillStyle = `rgba(230,236,255,${(mk * (0.25 + r() * 0.5)).toFixed(3)})`;
        g.fillRect(px, py, r() < 0.9 ? 1 : 1.6, 1);
      }
      g.restore();
    }
    // Sterne
    const st = STARS[stage];
    if (st > 0.01) {
      const r = mulberry(5);
      for (let i = 0; i < 340; i += 1) {
        const x = r() * W;
        const y = r() * H * 0.78;
        const big = r() > 0.93;
        g.fillStyle = r() < 0.75 ? `rgba(255,255,255,${(st * (0.45 + r() * 0.5)).toFixed(3)})` : `rgba(255,226,190,${(st * 0.7).toFixed(3)})`;
        g.beginPath();
        g.arc(x, y, big ? 1.5 + r() * 0.6 : 0.6 + r() * 0.7, 0, TAU);
        g.fill();
      }
    }
  }, reuse);
}

/** Wolken-Atlas pro Stufe (4 Wolken übereinander, je 420×120) */
export const CLOUD_W = 420;
export const CLOUD_H = 120;
export function cloudAtlas(stage: number, reuse?: HTMLCanvasElement | null): HTMLCanvasElement {
  const tops = ["#fff4f0", "#ffffff", "#ffe2cf", "#8e86c0", "#2c3866"];
  const bots = ["#d9c2d4", "#dbe6f2", "#e86a6a", "#5a4a8e", "#141d3e"];
  const lits = ["#ffe9d0", "#fffaf0", "#ffcf7a", "#ffb0c0", "#8aa0d8"];
  return paint(CLOUD_W, CLOUD_H * 4, (g) => {
    for (let k = 0; k < 4; k += 1) {
      const r = mulberry(40 + k * 17);
      const oy = k * CLOUD_H;
      const flat = k === 3;
      const n = flat ? 14 : 10;
      const grd = g.createLinearGradient(0, oy + 10, 0, oy + CLOUD_H - 14);
      grd.addColorStop(0, tops[stage]);
      grd.addColorStop(0.55, withA(lits[stage], 0.95));
      grd.addColorStop(1, bots[stage]);
      g.fillStyle = grd;
      g.globalAlpha = stage === 4 ? 0.6 : stage === 0 ? 0.8 : 0.92;
      for (let i = 0; i < n; i += 1) {
        const u = i / (n - 1);
        const x = 40 + u * (CLOUD_W - 80) + (r() - 0.5) * 18;
        const env = Math.sin(u * Math.PI);
        const rad = (flat ? 10 + r() * 10 : 16 + r() * 22) * (0.5 + env) + 6;
        g.beginPath();
        g.ellipse(x, oy + CLOUD_H - 30 - rad * (flat ? 0.2 : 0.45), rad * 1.4, rad * (flat ? 0.5 : 0.85), 0, 0, TAU);
        g.fill();
      }
      g.globalAlpha = 1;
    }
  }, reuse);
}

// ------------------------------------------------------------------------------------------------
// Ferne Höhen (Waldviertel/Dunkelsteinerwald)

export function farRidge(W: number, H: number): HTMLCanvasElement {
  const back = hillProfile(W, [[300, 120, 420], [1100, 150, 380], [1700, 110, 340]], [[3, 16, 0.4], [7, 7, 1.1], [17, 3, 2.3]]);
  const front = hillProfile(W, [[700, 90, 380], [1450, 100, 300], [1950, 70, 260]], [[4, 10, 1.9], [11, 5, 0.3], [29, 2.2, 0.8]]);
  return paint(W, H, (g) => {
    g.fillStyle = "#9aa9c4";
    profilePath(g, W, H - 30, (x) => 40 + back(x));
    g.fill();
    // Waldkante (kleine Kronen)
    g.fillStyle = "#8e9dba";
    for (let x = 0; x < W; x += 5) {
      const y = H - 30 - 40 - back(x);
      g.beginPath();
      g.arc(x, y + 3, 3.4, 0, TAU);
      g.fill();
    }
    g.fillStyle = "#7d90ae";
    profilePath(g, W, H, (x) => 26 + front(x));
    g.fill();
    g.fillStyle = "#74879f";
    for (let x = 0; x < W; x += 4) {
      const y = H - 26 - front(x);
      g.beginPath();
      g.arc(x, y + 2.5, 2.8, 0, TAU);
      g.fill();
    }
    // entfernter Kirchturm
    wrapDraw(W, 1250, 20, (x) => {
      const y = H - 26 - front(1250) + 4;
      g.fillStyle = "#71849c";
      g.fillRect(x - 3, y - 26, 6, 26);
      g.beginPath();
      g.moveTo(x - 4, y - 26);
      g.lineTo(x, y - 40);
      g.lineTo(x + 4, y - 26);
      g.fill();
    });
  });
}

// ------------------------------------------------------------------------------------------------
// Gegenüberliegendes Ufer: Weinterrassen, Felsen, Wald, Dörfer (Landmarks werden separat darübergelegt)

export interface BankInfo {
  canvas: HTMLCanvasElement;
  lights: HTMLCanvasElement;
  W: number;
  H: number;
  /** Höhe des Hügelprofils (Pixel über Wasserlinie) an Kachel-x */
  prof: (x: number) => number;
}

/** Landmark-Plätze in der Ufer-Kachel (x in Kachelpixeln) */
export const BANK_SPOTS = {
  abbey: 640,
  castle: 1650,
  church: 2520,
  vineyardA: 1120,
  vineyardB: 2930,
  tower: 1540,
};

/**
 * Wie `bankTile`, aber in Schritten: nach jedem Teilstück (Terrassenzeilen, Weichzeichnen, …) gibt die Funktion die Kontrolle
 * ab (`yield`), damit der Aufrufer beim Laden den Hauptthread freigeben kann. Das Ergebnis ist bitgleich zum Durchlauf am Stück.
 */
export function* bankTileSteps(W: number, H: number): Generator<void, BankInfo, void> {
  const prof = hillProfile(
    W,
    [
      [300, 110, 240],
      [BANK_SPOTS.abbey, 118, 150],
      [1000, 128, 250],
      [BANK_SPOTS.castle, 196, 170],
      [1930, 150, 240],
      [2260, 104, 260],
      [BANK_SPOTS.church, 78, 150],
      [2840, 150, 250],
    ],
    [
      [5, 9, 0.2],
      [13, 5, 1.7],
      [31, 2.4, 0.9],
      [67, 1.2, 2.2],
    ],
  );
  const base = H - 4;
  const rnd = mulberry(1717);
  const houses: Array<{ x: number; w: number; h: number; roof: string; wall: string }> = [];
  const villages = [
    [1380, 1780],
    [2330, 2700],
    [480, 560],
  ];
  for (const [a, b] of villages) {
    let x = a;
    while (x < b) {
      const w = 12 + Math.floor(rnd() * 12);
      const h = 9 + Math.floor(rnd() * 9);
      houses.push({ x, w, h, roof: rnd() < 0.6 ? "#9c4a34" : rnd() < 0.5 ? "#7a4a3a" : "#6a5a52", wall: rnd() < 0.7 ? "#efe6d2" : "#e6d4a8" });
      x += w + 2 + Math.floor(rnd() * 8);
    }
  }
  const canvas = paint(W, H, () => undefined);
  const g = ctxOf(canvas);
  yield;
  {
    // Hügelkörper
    const body = g.createLinearGradient(0, 0, 0, H);
    body.addColorStop(0, "#5b6a38");
    body.addColorStop(0.5, "#7a7a3c");
    body.addColorStop(1, "#6c6a3a");
    g.fillStyle = body;
    profilePath(g, W, base, prof, 3);
    g.fill();
    g.save();
    profilePath(g, W, base, prof, 3);
    g.clip();
    yield;
    // Weinterrassen, Wald- und Wiesenflecken (2D-Rauschen → natürliche Parzellen)
    const vineCols = ["#d6a432", "#c8782c", "#b0502e", "#8f9234", "#e0b848", "#a88a30"];
    for (let y = base - 6; y > base - 215; y -= 6) {
      const row = Math.round((base - y) / 6);
      if (row > 0 && row % 3 === 0) yield; // ca. 5–8 ms je Teilstück
      for (let x = 0; x < W; x += 3) {
        const hh = prof(x);
        const up = base - y;
        const rel = up / Math.max(1, hh);
        if (rel > 0.97) continue;
        const zone = vnoise2(x / 128, row / 5, W / 128, 3);
        const patch = vnoise2(x / 48, row / 2.5, W / 48, 9);
        if (zone < 0.34 || rel > 0.78) {
          // Wald / Buschwerk
          if ((x + row * 2) % 6 !== 0) continue;
          g.fillStyle = patch < 0.3 ? "#4a5a2c" : patch < 0.6 ? "#5c6a30" : patch < 0.8 ? "#8a6a2a" : "#6e7234";
          g.beginPath();
          g.arc(x, y + 2, 3.2 + patch * 1.6, 0, TAU);
          g.fill();
        } else if (zone < 0.8) {
          // Rebzeile (Farbe je Parzelle), Trockenmauer darunter
          g.fillStyle = vineCols[Math.floor(patch * vineCols.length) % vineCols.length];
          g.fillRect(x, y, 3, 4.2);
          if (row % 3 === 0) {
            g.fillStyle = "rgba(214,202,170,0.28)";
            g.fillRect(x, y + 4.4, 3, 1);
          }
        } else if ((x + row) % 9 === 0) {
          // Wiese mit einzelnen Marillenbäumen
          g.fillStyle = patch < 0.5 ? "#8f8a3e" : "#c9892e";
          g.beginPath();
          g.arc(x, y + 1, 2.2, 0, TAU);
          g.fill();
        }
      }
    }
    // Fels (grau) unter Burg und Stift
    for (const [cx, w, top] of [
      [BANK_SPOTS.castle, 140, 200],
      [BANK_SPOTS.abbey, 120, 120],
    ] as const) {
      for (let i = 0; i < 40; i += 1) {
        const px = cx + (rnd() - 0.5) * w;
        const hh = prof(px);
        const py = base - hh + rnd() * Math.min(top, hh) * 0.8;
        const rc = rnd() < 0.5 ? "#8e8a82" : "#a19c92";
        wrapDraw(W, px, 20, (xx) => {
          g.fillStyle = rc;
          g.beginPath();
          g.moveTo(xx - 8, py + 8);
          g.lineTo(xx - 3, py - 6);
          g.lineTo(xx + 7, py - 2);
          g.lineTo(xx + 9, py + 9);
          g.closePath();
          g.fill();
        });
      }
    }
    yield;
    // Zeilen weich verwischen (aus der Ferne verschmelzen die Rebzeilen)
    const snap = paint(W, H, (tg) => tg.drawImage(g.canvas, 0, 0));
    g.globalAlpha = 0.34;
    g.drawImage(snap, 0, 2);
    g.drawImage(snap, 0, -2);
    g.globalAlpha = 1;
    // Wald auf den Kuppen
    for (let x = 0; x < W; x += 5) {
      const hh = prof(x);
      if (hh < 90) continue;
      const y = base - hh;
      const n = 1 + Math.floor((hh - 90) / 40);
      for (let k = 0; k < n; k += 1) {
        const fc = rnd() < 0.4 ? "#4a5a2c" : rnd() < 0.5 ? "#8a6a2a" : "#5c6a30";
        const fx = x + rnd() * 3;
        const fy = y + 4 + k * 7 + rnd() * 4;
        const fr = 4 + rnd() * 3;
        wrapDraw(W, fx, fr, (xx) => {
          g.fillStyle = fc;
          g.beginPath();
          g.arc(xx, fy, fr, 0, TAU);
          g.fill();
        });
      }
    }
    g.restore();
    // Uferbäume
    for (let x = 0; x < W; x += 9 + rnd() * 14) {
      const s = 8 + rnd() * 9;
      const col = rnd() < 0.5 ? "#566a34" : "#7a8440";
      wrapDraw(W, x, s, (xx) => {
        g.fillStyle = col;
        g.beginPath();
        g.ellipse(xx, base - s * 0.6, s * 0.55, s * 0.8, 0, 0, TAU);
        g.fill();
      });
    }
    // Dörfer am Ufer
    for (const h of houses) {
      wrapDraw(W, h.x, h.w + 4, (x) => {
        g.fillStyle = h.wall;
        g.fillRect(x, base - h.h - 2, h.w, h.h + 2);
        g.fillStyle = "rgba(0,0,0,0.12)";
        g.fillRect(x + h.w - 3, base - h.h - 2, 3, h.h + 2);
        g.fillStyle = h.roof;
        g.beginPath();
        g.moveTo(x - 2, base - h.h - 1);
        g.lineTo(x + h.w * 0.5, base - h.h - 8 - h.w * 0.12);
        g.lineTo(x + h.w + 2, base - h.h - 1);
        g.closePath();
        g.fill();
        g.fillStyle = "rgba(60,50,60,0.55)";
        for (let wx = x + 3; wx < x + h.w - 3; wx += 5) g.fillRect(wx, base - h.h + 2, 2, 2.5);
      });
    }
    // Dürnsteiner Stiftsturm (blau-weiß, barock)
    wrapDraw(W, BANK_SPOTS.tower, 20, (x) => baroqueTower(g, x, base - 2, 72));
  }
  yield;
  const lights = paint(W, H, (g) => {
    const r2 = mulberry(4242);
    for (const h of houses) {
      for (let wx = h.x + 3; wx < h.x + h.w - 3; wx += 5) {
        if (r2() < 0.45) continue;
        const col = r2() < 0.85 ? "rgba(255,206,130,0.95)" : "rgba(255,240,200,0.9)";
        wrapDraw(W, wx, 4, (x) => {
          g.fillStyle = col;
          g.fillRect(x, base - h.h + 2, 2, 2.5);
        });
      }
    }
    // Flutlicht Stiftsturm
    wrapDraw(W, BANK_SPOTS.tower, 40, (x) => {
      const grd = g.createRadialGradient(x, base - 40, 2, x, base - 40, 46);
      grd.addColorStop(0, "rgba(255,220,160,0.55)");
      grd.addColorStop(1, "rgba(255,200,140,0)");
      g.fillStyle = grd;
      g.fillRect(x - 46, base - 86, 92, 92);
    });
    // Uferpromenade: Laternenkette
    for (let x = 0; x < W; x += 34) {
      const hh = prof(x);
      if (hh > 150) continue;
      wrapDraw(W, x, 6, (xx) => {
        const grd = g.createRadialGradient(xx, base - 2, 0, xx, base - 2, 5);
        grd.addColorStop(0, "rgba(255,230,170,0.9)");
        grd.addColorStop(1, "rgba(255,200,120,0)");
        g.fillStyle = grd;
        g.fillRect(xx - 5, base - 7, 10, 10);
      });
    }
  });
  return { canvas, lights, W, H, prof };
}

/** Gegenüberliegendes Ufer am Stück (Tests, Fallback ohne `load`) */
export function bankTile(W: number, H: number): BankInfo {
  const it = bankTileSteps(W, H);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/** Barocker Kirchturm (Dürnstein: blau-weiß mit Zwiebelhelm) */
export function baroqueTower(g: Ctx2D, x: number, base: number, h: number): void {
  const w = h * 0.2;
  g.fillStyle = "#dfe6f2";
  g.fillRect(x - w / 2, base - h * 0.72, w, h * 0.72);
  g.fillStyle = "#6f8fc4";
  g.fillRect(x - w / 2, base - h * 0.72, w * 0.22, h * 0.72);
  g.fillRect(x + w / 2 - w * 0.22, base - h * 0.72, w * 0.22, h * 0.72);
  g.fillStyle = "#4e6ea8";
  g.fillRect(x - w / 2 - 1, base - h * 0.5, w + 2, 2);
  g.fillRect(x - w / 2 - 1, base - h * 0.72, w + 2, 2);
  // Uhr / Schallfenster
  g.fillStyle = "#3a4666";
  g.fillRect(x - 1.5, base - h * 0.66, 3, 5);
  // Zwiebelhelm
  g.fillStyle = "#e9eef8";
  g.beginPath();
  g.ellipse(x, base - h * 0.78, w * 0.62, h * 0.08, 0, 0, TAU);
  g.fill();
  g.fillStyle = "#5a78b4";
  g.beginPath();
  g.moveTo(x - w * 0.55, base - h * 0.78);
  g.quadraticCurveTo(x - w * 0.7, base - h * 0.92, x, base - h * 0.98);
  g.quadraticCurveTo(x + w * 0.7, base - h * 0.92, x + w * 0.55, base - h * 0.78);
  g.closePath();
  g.fill();
  g.fillStyle = "#e0b040";
  g.fillRect(x - 0.8, base - h * 1.06, 1.6, h * 0.09);
  g.fillRect(x - 2.5, base - h * 1.03, 5, 1.2);
}

/** Spiegelung einer Ufer-Kachel (unterer Teil, vertikal gespiegelt, mit Wellenversatz und Ausblendung) */
export function reflectionTile(src: HTMLCanvasElement, rows: number, outH: number): HTMLCanvasElement {
  const W = src.width;
  const H = src.height;
  return paint(W, outH, (g) => {
    for (let y = 0; y < outH; y += 2) {
      const sy = H - 1 - Math.min(rows - 1, Math.floor(y * (rows / outH)));
      const dx = Math.sin(y * 0.9) * (1 + y * 0.04) + Math.sin(y * 0.23 + 1) * 1.5;
      g.globalAlpha = 0.62 * (1 - y / outH) * (y % 6 === 4 ? 0.4 : 1);
      g.drawImage(src, 0, sy, W, 1, dx, y, W, 2);
      if (dx > 0) g.drawImage(src, W - Math.ceil(dx), sy, Math.ceil(dx), 1, 0, y, Math.ceil(dx), 2);
      else if (dx < 0) g.drawImage(src, 0, sy, Math.ceil(-dx), 1, W - Math.ceil(-dx), y, Math.ceil(-dx), 2);
    }
    g.globalAlpha = 1;
  });
}

/** Glitzer-/Wellenkachel für den Strom (weiß, additiv verwendbar) */
export function riverShimmer(W: number, H: number, seed: number): HTMLCanvasElement {
  return paint(W, H, (g) => {
    const r = mulberry(seed);
    for (let i = 0; i < 260; i += 1) {
      const y = Math.pow(r(), 1.4) * H;
      const k = 0.35 + (y / H) * 0.9;
      const len = (8 + r() * 26) * k;
      const x = r() * W;
      const a = 0.15 + r() * 0.4;
      wrapDraw(W, x, len, (xx) => {
        g.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
        g.fillRect(xx, y, len, Math.max(1, k * 1.2));
      });
    }
  });
}

// ------------------------------------------------------------------------------------------------
// Nahes Ufer (Parallax ~0.3)

export interface NearInfo {
  canvas: HTMLCanvasElement;
  lights: HTMLCanvasElement;
  W: number;
  H: number;
}

/** Optionale Zusatz-Zeichnung (z.B. Props) in die Kachel: (g, W, x → Uferlinie-y) */
export type NearExtra = (g: Ctx2D, W: number, shoreY: (x: number) => number) => void;

/** Wie `nearBankTile`, aber in Schritten (`yield` nach Teilstücken, damit der Aufrufer beim Laden den Hauptthread freigeben kann); bitgleich zum Durchlauf am Stück */
export function* nearBankTileSteps(W: number, H: number, extra?: NearExtra): Generator<void, NearInfo, void> {
  const rnd = mulberry(8080);
  const base = H - 2;
  const bankTop = (x: number): number => 46 + 8 * Math.sin((x / W) * TAU * 5 + 0.3) + 4 * Math.sin((x / W) * TAU * 13 + 1.2);
  // Weinberghang (Ried) auf unserer Seite: sanfter Anstieg, steile Terrassen, runde Kuppe
  const slopeRaw = hillProfile(
    W,
    [
      [960, 118, 200],
      [1150, 160, 170],
      [1330, 170, 170],
      [1520, 128, 170],
      [1700, 70, 150],
      [2150, 96, 130],
      [2300, 74, 120],
    ],
    [
      [10, 5, 0.4],
      [26, 2.5, 1.9],
      [61, 1.2, 0.3],
    ],
  );
  const slope = (x: number): number => Math.max(0, slopeRaw(x) - 14);
  const slopeMask = (x: number): number => (slope(x) > 30 ? 1 : 0);
  const heuriger = { x: 420, w: 120, h: 70 };
  const chapel = { x: 1300, w: 30, h: 34 };
  const canvas = paint(W, H, () => undefined);
  const g = ctxOf(canvas);
  {
    // Weinberghang (hinten)
    g.save();
    g.beginPath();
    g.moveTo(0, base + 10);
    for (let x = 0; x <= W; x += 3) g.lineTo(x, base - slope(x) - 34);
    g.lineTo(W, base + 10);
    g.closePath();
    const sg = g.createLinearGradient(0, base - 260, 0, base);
    sg.addColorStop(0, "#66703a");
    sg.addColorStop(1, "#58582e");
    g.fillStyle = sg;
    g.fill();
    g.clip();
    // Terrassen: gebrochene Trockenmauern + Rebzeilen in Parzellenfarben (2D-Rauschen)
    const cols = ["#c99c3a", "#b86c30", "#9a4c30", "#8a8c3a", "#d2ac4a", "#a8843a"];
    for (let y = base - 40; y > base - 290; y -= 12) {
      const row = Math.round((base - y) / 12);
      if (row > 0 && row % 7 === 0) yield; // ca. 5 ms je Teilstück
      for (let x = (row % 2) * 3; x < W; x += 6) {
        const h = slope(x);
        const up = base - 34 - y;
        if (h - up < 6) continue;
        const patch = vnoise2(x / 40, row / 3, W / 40, 5);
        const wall = vnoise2(x / 64, row, W / 64, 7);
        if (wall > 0.3) {
          g.fillStyle = "#a89a7e";
          g.fillRect(x, y + 8, 6, 3);
          g.fillStyle = "rgba(50,40,30,0.4)";
          g.fillRect(x, y + 11, 6, 1.5);
        }
        const bushy = vnoise2(x / 128, row / 6, W / 128, 11);
        if (bushy < 0.22) {
          // Buschwerk/Bäume zwischen den Rieden
          if (x % 12 === 0) {
            g.fillStyle = patch < 0.5 ? "#4f5e2c" : "#6a6a30";
            g.beginPath();
            g.arc(x, y + 3, 5.5, 0, TAU);
            g.fill();
          }
          continue;
        }
        g.fillStyle = "#4a3a2a";
        g.fillRect(x, y + 2, 1.2, 6);
        g.fillStyle = cols[Math.floor(patch * cols.length) % cols.length];
        g.beginPath();
        g.arc(x + 0.6, y + 2, 3.3, 0, TAU);
        g.fill();
      }
    }
    // Steinerne Stiegen durch den Hang
    for (const sx0 of [1130, 1400, 2200]) {
      g.strokeStyle = "rgba(200,188,160,0.75)";
      g.lineWidth = 3;
      g.beginPath();
      const top = slope(sx0 + 40);
      for (let k = 0; k < 18; k += 1) {
        const yy = base - 38 - k * 11;
        if (base - 34 - yy > top - 8) break;
        const xx = sx0 + k * 4;
        g.moveTo(xx, yy);
        g.lineTo(xx + 7, yy);
      }
      g.stroke();
    }
    // Wäldchen auf der Kuppe
    for (let x = 0; x < W; x += 7) {
      const h = slope(x);
      if (h < 120) continue;
      const y = base - 34 - h;
      const n = Math.floor((h - 110) / 30) + 1;
      for (let k = 0; k < n; k += 1) {
        const c = vnoise2(x / 20, k, W / 20, 2);
        g.fillStyle = c < 0.4 ? "#4a5a2a" : c < 0.7 ? "#76702e" : "#a86e2c";
        g.beginPath();
        g.arc(x, y + 6 + k * 8, 7 + c * 3, 0, TAU);
        g.fill();
      }
    }
    g.restore();
    // Kapelle auf dem Hang
    wrapDraw(W, chapel.x, 40, (x) => {
      const y = base - slope(chapel.x) - 34 + 6;
      g.fillStyle = "#f0e8d6";
      g.fillRect(x - chapel.w / 2, y - chapel.h, chapel.w, chapel.h);
      g.fillStyle = "#9c4a34";
      g.beginPath();
      g.moveTo(x - chapel.w / 2 - 3, y - chapel.h);
      g.lineTo(x, y - chapel.h - 16);
      g.lineTo(x + chapel.w / 2 + 3, y - chapel.h);
      g.closePath();
      g.fill();
      g.fillStyle = "#f0e8d6";
      g.fillRect(x + chapel.w / 2 - 12, y - chapel.h - 24, 10, 24);
      g.fillStyle = "#6b4a3a";
      g.beginPath();
      g.moveTo(x + chapel.w / 2 - 13, y - chapel.h - 24);
      g.lineTo(x + chapel.w / 2 - 7, y - chapel.h - 36);
      g.lineTo(x + chapel.w / 2 - 1, y - chapel.h - 24);
      g.fill();
      g.fillStyle = "#4a3a36";
      g.fillRect(x - 4, y - 16, 8, 16);
    });
    yield;
    // Pappeln & Weiden am Ufer (hinter der Böschung)
    for (let i = 0; i < 16; i += 1) {
      const x = (i / 16) * W + rnd() * 80;
      if (slopeMask(x) && rnd() < 0.7) continue;
      const kind = rnd();
      wrapDraw(W, x, 70, (xx) => {
        const rr = mulberry(i * 13 + 5);
        if (kind < 0.45) poplar(g, xx, base - bankTop(x) + 12, 170 + rr() * 110, 34 + rr() * 16, rr);
        else if (kind < 0.75) willow(g, xx, base - bankTop(x) + 14, 84 + rr() * 40, rr);
        else apricotTree(g, xx, base - bankTop(x) + 16, 78 + rr() * 30, rr);
      });
    }
    // Heuriger (Presshaus mit Buschen)
    wrapDraw(W, heuriger.x, heuriger.w, (x) => {
      const y = base - bankTop(heuriger.x) + 18;
      g.fillStyle = "#efe4cc";
      g.fillRect(x, y - heuriger.h, heuriger.w, heuriger.h);
      g.fillStyle = "rgba(120,90,60,0.25)";
      g.fillRect(x, y - 14, heuriger.w, 14);
      g.fillStyle = "#8e3e2c";
      g.beginPath();
      g.moveTo(x - 8, y - heuriger.h + 2);
      g.lineTo(x + heuriger.w * 0.5, y - heuriger.h - 34);
      g.lineTo(x + heuriger.w + 8, y - heuriger.h + 2);
      g.closePath();
      g.fill();
      g.fillStyle = "rgba(0,0,0,0.18)";
      for (let k = 0; k < 7; k += 1) g.fillRect(x - 4 + k * 19, y - heuriger.h - 6 - (k < 4 ? k : 6 - k) * 8, 1.5, 8);
      // Tor
      g.fillStyle = "#5a3a24";
      g.beginPath();
      g.moveTo(x + 44, y);
      g.lineTo(x + 44, y - 30);
      g.arc(x + 58, y - 30, 14, Math.PI, 0);
      g.lineTo(x + 72, y);
      g.closePath();
      g.fill();
      g.strokeStyle = "#3a2414";
      g.lineWidth = 1;
      g.beginPath();
      for (let k = 0; k < 4; k += 1) {
        g.moveTo(x + 47 + k * 7, y);
        g.lineTo(x + 47 + k * 7, y - 38);
      }
      g.stroke();
      // Fenster
      g.fillStyle = "#3e4450";
      g.fillRect(x + 12, y - 44, 14, 14);
      g.fillRect(x + 92, y - 44, 14, 14);
      g.fillStyle = "#f0e4cc";
      g.fillRect(x + 18, y - 44, 2, 14);
      g.fillRect(x + 98, y - 44, 2, 14);
      // Buschen (Föhrenzweige) über dem Tor
      g.fillStyle = "#2f5a2a";
      g.beginPath();
      g.arc(x + 58, y - 56, 9, 0, TAU);
      g.arc(x + 52, y - 52, 6, 0, TAU);
      g.arc(x + 64, y - 52, 6, 0, TAU);
      g.fill();
      g.strokeStyle = "#4a3424";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x + 58, y - 70);
      g.lineTo(x + 58, y - 64);
      g.stroke();
      // Weinfässer vor dem Haus
      for (let k = 0; k < 2; k += 1) {
        const bx = x + 8 + k * 22;
        g.fillStyle = "#7a4e2a";
        g.beginPath();
        g.ellipse(bx + 9, y - 10, 9, 11, 0, 0, TAU);
        g.fill();
        g.fillStyle = "#4a4a4a";
        g.fillRect(bx, y - 16, 18, 2);
        g.fillRect(bx, y - 6, 18, 2);
      }
    });
    // Zusätze (vertäutes Ruderboot als Prop) – vor der Böschung, damit das Gras den Rumpf teils verdeckt
    if (extra) extra(g, W, (x) => base - bankTop(x));
    // Uferböschung mit Gras und Schilf
    const bg = g.createLinearGradient(0, base - 60, 0, base);
    bg.addColorStop(0, "#8a8a44");
    bg.addColorStop(1, "#5a5a30");
    g.fillStyle = bg;
    g.beginPath();
    g.moveTo(0, base + 4);
    for (let x = 0; x <= W; x += 4) g.lineTo(x, base - bankTop(x));
    g.lineTo(W, base + 4);
    g.closePath();
    g.fill();
    reeds(g, W, 0, W, base - 30, 36, rnd);
    // Blumen/Herbstlaub in der Böschung
    for (let i = 0; i < 260; i += 1) {
      const x = rnd() * W;
      const y = base - bankTop(x) + 4 + rnd() * 40;
      const c = rnd();
      wrapDraw(W, x, 4, (xx) => {
        g.fillStyle = c < 0.3 ? "#d8a03a" : c < 0.5 ? "#c0602e" : c < 0.62 ? "#e8e0c8" : c < 0.7 ? "#7a8ac8" : "#9aa048";
        g.fillRect(xx, y, 2.2, 2.2);
      });
    }
  }
  yield;
  const lights = paint(W, H, (g) => {
    wrapDraw(W, heuriger.x, heuriger.w, (x) => {
      const y = base - bankTop(heuriger.x) + 18;
      for (const wx of [x + 19, x + 99]) {
        g.fillStyle = "rgba(255,200,120,0.95)";
        g.fillRect(wx - 7, y - 44, 14, 14);
        const grd = g.createRadialGradient(wx, y - 37, 2, wx, y - 37, 30);
        grd.addColorStop(0, "rgba(255,190,110,0.5)");
        grd.addColorStop(1, "rgba(255,170,90,0)");
        g.fillStyle = grd;
        g.fillRect(wx - 30, y - 67, 60, 60);
      }
      // Laterne über dem Tor
      const grd = g.createRadialGradient(x + 58, y - 44, 1, x + 58, y - 44, 40);
      grd.addColorStop(0, "rgba(255,236,190,0.95)");
      grd.addColorStop(0.2, "rgba(255,200,120,0.5)");
      grd.addColorStop(1, "rgba(255,170,90,0)");
      g.fillStyle = grd;
      g.fillRect(x + 18, y - 84, 80, 80);
    });
    wrapDraw(W, chapel.x, 40, (x) => {
      const y = base - slope(chapel.x) - 34 + 6;
      const grd = g.createRadialGradient(x, y - 10, 1, x, y - 10, 22);
      grd.addColorStop(0, "rgba(255,220,160,0.9)");
      grd.addColorStop(1, "rgba(255,200,140,0)");
      g.fillStyle = grd;
      g.fillRect(x - 22, y - 32, 44, 44);
    });
  });
  return { canvas, lights, W, H };
}

/** Nahes Ufer am Stück (Tests, Fallback ohne `load`) */
export function nearBankTile(W: number, H: number, extra?: NearExtra): NearInfo {
  const it = nearBankTileSteps(W, H, extra);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

// ------------------------------------------------------------------------------------------------
// Weinzeilen am Wegrand (Parallax ~0.62)

export function vineRowTile(W: number, H: number): { canvas: HTMLCanvasElement; lights: HTMLCanvasElement } {
  const rnd = mulberry(3131);
  const base = H - 4;
  type Seg = { a: number; b: number };
  const segs: Seg[] = [];
  let x = 40;
  while (x < W - 200) {
    const len = 260 + rnd() * 260;
    if (x + len > W - 60) break;
    segs.push({ a: x, b: x + len });
    x += len + 160 + rnd() * 200;
  }
  const lanterns: number[] = [];
  const canvas = paint(W, H, (g) => {
    // Grasband
    g.fillStyle = "#6a6a36";
    g.beginPath();
    g.moveTo(0, base + 4);
    for (let xx = 0; xx <= W; xx += 4) g.lineTo(xx, base - 10 - 4 * Math.sin((xx / W) * TAU * 9) - 2 * Math.sin((xx / W) * TAU * 31));
    g.lineTo(W, base + 4);
    g.closePath();
    g.fill();
    for (const s of segs) {
      const postGap = 72;
      // Drähte
      g.strokeStyle = "rgba(60,56,50,0.8)";
      g.lineWidth = 1;
      g.beginPath();
      for (const wy of [base - 58, base - 86]) {
        g.moveTo(s.a, wy);
        g.lineTo(s.b, wy);
      }
      g.stroke();
      // Pfähle
      for (let px = s.a; px <= s.b + 1; px += postGap) {
        g.fillStyle = "#6a5e50";
        g.fillRect(px - 2.5, base - 104, 5, 104);
        g.fillStyle = "#8a7e6e";
        g.fillRect(px - 2.5, base - 104, 1.5, 104);
      }
      // Rebstöcke mit Laub und Trauben
      for (let vx = s.a + 14; vx < s.b - 6; vx += 24) {
        g.strokeStyle = "#5a4230";
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(vx, base);
        g.quadraticCurveTo(vx - 4, base - 30, vx + 2, base - 56);
        g.stroke();
        for (let k = 0; k < 6; k += 1) {
          const lx = vx + (rnd() - 0.5) * 34;
          const ly = base - 56 - rnd() * 42;
          const c = rnd();
          const col = c < 0.3 ? "#b89a36" : c < 0.55 ? "#c9782e" : c < 0.72 ? "#9e4a2c" : "#7e8a34";
          grapeLeaf(g, lx, ly, 8 + rnd() * 5, rnd() * TAU, col, "rgba(60,40,20,0.35)");
        }
        if (rnd() < 0.55) grapeBunch(g, vx + (rnd() - 0.5) * 16, base - 52 + rnd() * 6, 16, "#4a2a5a", "#5e3a70", "rgba(220,200,255,0.5)");
      }
      if (rnd() < 0.8) lanterns.push(s.b + 40);
    }
    // Bildstock (Marterl) + Laternenpfähle in den Lücken
    for (const l0 of lanterns) {
      wrapDraw(W, l0, 20, (lx) => {
        g.fillStyle = "#3a3430";
        g.fillRect(lx - 2, base - 118, 4, 118);
        g.fillRect(lx - 10, base - 118, 20, 3);
        g.fillStyle = "#2a2622";
        g.fillRect(lx - 7, base - 134, 14, 16);
        g.fillStyle = "rgba(240,220,170,0.7)";
        g.fillRect(lx - 5, base - 132, 10, 12);
      });
    }
    wrapDraw(W, segs[0] ? segs[0].b + 110 : 600, 30, (mx) => {
      g.fillStyle = "#c8bca4";
      g.fillRect(mx - 6, base - 70, 12, 70);
      g.fillStyle = "#b0a48c";
      g.fillRect(mx - 12, base - 96, 24, 28);
      g.fillStyle = "#8a3a2a";
      g.beginPath();
      g.moveTo(mx - 15, base - 96);
      g.lineTo(mx, base - 110);
      g.lineTo(mx + 15, base - 96);
      g.closePath();
      g.fill();
      g.fillStyle = "#3a4a7a";
      g.fillRect(mx - 7, base - 92, 14, 18);
      g.fillStyle = "#e0c070";
      g.fillRect(mx - 1, base - 118, 2, 8);
      g.fillRect(mx - 3, base - 116, 6, 2);
    });
    // Gras-Halme
    g.strokeStyle = "#8a8a46";
    g.lineWidth = 1.2;
    g.beginPath();
    for (let i = 0; i < 700; i += 1) {
      const gx = rnd() * W;
      const hh = 6 + rnd() * 14;
      g.moveTo(gx, base + 2);
      g.lineTo(gx + (rnd() - 0.5) * 6, base + 2 - hh);
    }
    g.stroke();
  });
  const lights = paint(W, H, (g) => {
    for (const l0 of lanterns) {
      wrapDraw(W, l0, 60, (lx) => {
        const grd = g.createRadialGradient(lx, base - 126, 1, lx, base - 126, 48);
        grd.addColorStop(0, "rgba(255,240,200,1)");
        grd.addColorStop(0.15, "rgba(255,206,130,0.7)");
        grd.addColorStop(1, "rgba(255,170,90,0)");
        g.fillStyle = grd;
        g.fillRect(lx - 48, base - 174, 96, 96);
        const pool = g.createRadialGradient(lx, base, 1, lx, base, 60);
        pool.addColorStop(0, "rgba(255,200,120,0.35)");
        pool.addColorStop(1, "rgba(255,180,100,0)");
        g.fillStyle = pool;
        g.fillRect(lx - 60, base - 20, 120, 24);
      });
    }
  });
  return { canvas, lights };
}

// ------------------------------------------------------------------------------------------------
// Boden: Uferweg (Kies + Laub) über Trockensteinmauer. Kachel beginnt GRASS_LIP px über der Bodenlinie.

export const GRASS_LIP = 8;

export function groundTile(W: number, H: number): HTMLCanvasElement {
  return paint(W, H, (g) => {
    const rnd = mulberry(77);
    const top = GRASS_LIP;
    // Weg
    const pg = g.createLinearGradient(0, top, 0, top + 48);
    pg.addColorStop(0, "#c2a47a");
    pg.addColorStop(1, "#9c7e58");
    g.fillStyle = pg;
    g.fillRect(0, top, W, 48);
    // Fahrspuren
    g.fillStyle = "rgba(90,64,40,0.18)";
    g.fillRect(0, top + 14, W, 5);
    g.fillRect(0, top + 32, W, 6);
    // Kies
    for (let i = 0; i < 1400; i += 1) {
      const x = rnd() * W;
      const y = top + 3 + rnd() * 44;
      const s = 1 + rnd() * 2.2;
      const c = rnd();
      wrapDraw(W, x, 4, (xx) => {
        g.fillStyle = c < 0.4 ? "rgba(236,222,196,0.7)" : c < 0.8 ? "rgba(110,86,60,0.45)" : "rgba(160,150,140,0.6)";
        g.fillRect(xx, y, s, s * 0.7);
      });
    }
    // Herbstlaub auf dem Weg
    for (let i = 0; i < 90; i += 1) {
      const x = rnd() * W;
      const y = top + 4 + rnd() * 42;
      const c = rnd();
      const col = c < 0.35 ? "#d89a2e" : c < 0.6 ? "#c4622a" : c < 0.8 ? "#a8402a" : "#b8a040";
      const rot = rnd() * TAU;
      const s = 3 + rnd() * 3;
      wrapDraw(W, x, 8, (xx) => {
        g.fillStyle = col;
        g.beginPath();
        g.ellipse(xx, y, s, s * 0.55, rot, 0, TAU);
        g.fill();
      });
    }
    // Mauer
    const wy = top + 48;
    stoneWall(g, 0, wy, W, H - wy, rnd);
    // nahtlose Kanten: Steine in ersten/letzten 40px spiegeln wir nicht – kleine Fugen fallen nicht auf
    const wg = g.createLinearGradient(0, wy, 0, H);
    wg.addColorStop(0, "rgba(40,30,20,0.35)");
    wg.addColorStop(0.12, "rgba(40,30,20,0.05)");
    wg.addColorStop(1, "rgba(20,14,10,0.45)");
    g.fillStyle = wg;
    g.fillRect(0, wy, W, H - wy);
    // Moos/Efeu an der Mauer
    for (let i = 0; i < 26; i += 1) {
      const x = rnd() * W;
      const len = 10 + rnd() * 36;
      wrapDraw(W, x, 30, (xx) => {
        for (let k = 0; k < len; k += 4) {
          g.fillStyle = k % 8 ? "#5e7a30" : "#7a8e36";
          g.beginPath();
          g.arc(xx + Math.sin(k * 0.4) * 3, wy + 2 + k, 2.6, 0, TAU);
          g.fill();
        }
      });
    }
    // Wegkante mit Grasnarbe
    g.fillStyle = "#6e7a34";
    g.fillRect(0, top - 1, W, 4);
    g.strokeStyle = "#8a9440";
    g.lineWidth = 1.3;
    g.beginPath();
    for (let x = 0; x < W; x += 3) {
      const hh = 3 + rnd() * (GRASS_LIP + 2);
      g.moveTo(x, top + 2);
      g.lineTo(x + (rnd() - 0.5) * 4, top + 2 - hh);
    }
    g.stroke();
    g.fillStyle = "rgba(255,244,210,0.28)";
    g.fillRect(0, top + 3, W, 1.5);
    // Kante zur Mauer
    g.fillStyle = "#b8a684";
    g.fillRect(0, wy - 3, W, 4);
    g.fillStyle = "rgba(40,28,20,0.5)";
    g.fillRect(0, wy + 1, W, 2);
  });
}

// ------------------------------------------------------------------------------------------------
// Vordergrund: Weinlaub-Girlande oben (Parallax 1.25) + Gräser unten (1.4)

export function garlandTile(W: number, H: number): { canvas: HTMLCanvasElement; lights: HTMLCanvasElement; lanterns: number[] } {
  const rnd = mulberry(606);
  const spans: Array<[number, number]> = [];
  let x = 30;
  while (x < W - 320) {
    const len = 260 + rnd() * 220;
    spans.push([x, Math.min(W - 40, x + len)]);
    x += len + 120 + rnd() * 160;
  }
  const lanterns: number[] = [];
  const vineY = (xx: number): number => 8 + 10 * Math.sin((xx / W) * TAU * 3 + 0.5) + 5 * Math.sin((xx / W) * TAU * 7);
  const canvas = paint(W, H, (g) => {
    for (const [a, b] of spans) {
      // Hauptranke
      g.strokeStyle = "#4a3222";
      g.lineWidth = 5;
      g.lineCap = "round";
      g.beginPath();
      for (let xx = a; xx <= b; xx += 6) {
        const y = vineY(xx);
        if (xx === a) g.moveTo(xx, y - 14);
        else g.lineTo(xx, y);
      }
      g.stroke();
      // Blätter
      for (let xx = a + 10; xx < b; xx += 14 + rnd() * 10) {
        const y = vineY(xx) + 6 + rnd() * 30;
        const c = rnd();
        const col = c < 0.3 ? "#d4a434" : c < 0.55 ? "#c8702c" : c < 0.72 ? "#a8402c" : c < 0.88 ? "#8a9638" : "#e2bc4a";
        grapeLeaf(g, xx, y, 13 + rnd() * 9, rnd() * TAU, col, "rgba(60,30,10,0.4)");
      }
      // Ranken-Spiralen
      g.strokeStyle = "#6a5a2a";
      g.lineWidth = 1.2;
      for (let k = 0; k < 4; k += 1) {
        const sx = a + rnd() * (b - a);
        const sy = vineY(sx) + 20;
        g.beginPath();
        for (let t = 0; t < 14; t += 1) {
          const ang = t * 0.9;
          const r = 2 + t * 0.7;
          if (t === 0) g.moveTo(sx, sy);
          else g.lineTo(sx + Math.cos(ang) * r, sy + t * 2.2 + Math.sin(ang) * r);
        }
        g.stroke();
      }
      // Trauben
      const nb = 1 + Math.floor((b - a) / 150);
      for (let k = 0; k < nb; k += 1) {
        const bx = a + ((k + 0.5) / nb) * (b - a) + (rnd() - 0.5) * 30;
        const purple = rnd() < 0.6;
        grapeBunch(g, bx, vineY(bx) + 34 + rnd() * 16, 30, purple ? "#4a2660" : "#b8b83a", purple ? "#643a82" : "#d0cc54", "rgba(255,255,255,0.55)");
      }
      lanterns.push(a + (b - a) * (0.3 + rnd() * 0.4));
    }
    // Laternen (Heurigen-Lichterkette)
    for (const lx of lanterns) {
      const ly = vineY(lx) + 22;
      g.strokeStyle = "#2a2018";
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(lx, vineY(lx));
      g.lineTo(lx, ly);
      g.stroke();
      g.fillStyle = "#3a2a1a";
      g.fillRect(lx - 7, ly, 14, 3);
      g.fillStyle = "#e9d49a";
      g.fillRect(lx - 5, ly + 3, 10, 14);
      g.fillStyle = "#3a2a1a";
      g.fillRect(lx - 7, ly + 17, 14, 3);
    }
  });
  const lights = paint(W, H, (g) => {
    for (const lx of lanterns) {
      const ly = vineY(lx) + 32;
      const grd = g.createRadialGradient(lx, ly, 1, lx, ly, 46);
      grd.addColorStop(0, "rgba(255,244,210,1)");
      grd.addColorStop(0.18, "rgba(255,196,110,0.75)");
      grd.addColorStop(1, "rgba(255,160,80,0)");
      g.fillStyle = grd;
      g.fillRect(lx - 46, ly - 46, 92, 92);
    }
  });
  return { canvas, lights, lanterns };
}

export function grassTile(W: number, H: number): HTMLCanvasElement {
  return paint(W, H, (g) => {
    const rnd = mulberry(909);
    let x = 20;
    while (x < W - 40) {
      const w = 60 + rnd() * 120;
      const cx = x + w / 2;
      const n = Math.floor(w / 3);
      for (let i = 0; i < n; i += 1) {
        const bx = x + rnd() * w;
        const env = Math.sin(((bx - x) / w) * Math.PI);
        const hh = (18 + rnd() * 44) * (0.35 + env);
        const col = rnd() < 0.5 ? "#3a4220" : rnd() < 0.5 ? "#4a4a24" : "#5a4a26";
        g.strokeStyle = col;
        g.lineWidth = 2 + rnd() * 1.6;
        g.beginPath();
        g.moveTo(bx, H);
        g.quadraticCurveTo(bx + (rnd() - 0.5) * 10, H - hh * 0.6, bx + (rnd() - 0.5) * 22, H - hh);
        g.stroke();
      }
      // Wildblumen (Wegwarte, Schafgarbe)
      for (let i = 0; i < 4; i += 1) {
        const fx = x + rnd() * w;
        const fy = H - 24 - rnd() * 30;
        g.strokeStyle = "#3a4220";
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(fx, H);
        g.lineTo(fx, fy);
        g.stroke();
        g.fillStyle = rnd() < 0.5 ? "#8aa0e0" : "#f2ecd8";
        g.beginPath();
        g.arc(fx, fy, 3, 0, TAU);
        g.fill();
      }
      void cx;
      x += w + 120 + rnd() * 260;
    }
  });
}

// ------------------------------------------------------------------------------------------------
// Nebel / Licht

/** Weiche, nahtlose Nebelbank (weiß) */
export function fogTile(W: number, H: number, seed: number): HTMLCanvasElement {
  return paint(W, H, (g) => {
    const r = mulberry(seed);
    for (let i = 0; i < 46; i += 1) {
      const x = r() * W;
      const y = H * 0.35 + (r() - 0.5) * H * 0.4;
      const rx = 60 + r() * 140;
      const ry = 16 + r() * 26;
      const a = 0.14 + r() * 0.18;
      wrapDraw(W, x, rx, (xx) => {
        g.save();
        g.translate(xx, y);
        g.scale(rx / ry, 1);
        const grd = g.createRadialGradient(0, 0, 0, 0, 0, ry);
        grd.addColorStop(0, `rgba(255,255,255,${a.toFixed(3)})`);
        grd.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = grd;
        g.fillRect(-ry, -ry, ry * 2, ry * 2);
        g.restore();
      });
    }
    const band = g.createLinearGradient(0, 0, 0, H);
    band.addColorStop(0, "rgba(255,255,255,0)");
    band.addColorStop(0.55, "rgba(255,255,255,0.22)");
    band.addColorStop(1, "rgba(255,255,255,0.05)");
    g.fillStyle = band;
    g.fillRect(0, 0, W, H);
  });
}

/** Einfärben einer weißen Kachel (für Nebel in Stufenfarbe) */
export function colorize(src: HTMLCanvasElement, color: string, reuse?: HTMLCanvasElement | null): HTMLCanvasElement {
  return paint(src.width, src.height, (g, w, h) => {
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
  }, reuse);
}

/** Lichtstrahlen-Fächer (additiv), Ursprung (ox, oy) in der Fläche */
export function raysSprite(W: number, H: number, ox: number, oy: number, seed: number, warm: string): HTMLCanvasElement {
  return paint(W, H, (g) => {
    const r = mulberry(seed);
    for (let i = 0; i < 9; i += 1) {
      const a = Math.PI * 0.55 + (r() - 0.5) * 1.5;
      const spread = 0.03 + r() * 0.05;
      const len = 700 + r() * 500;
      const grd = g.createRadialGradient(ox, oy, 10, ox, oy, len);
      grd.addColorStop(0, withA(warm, 0.28 + r() * 0.2));
      grd.addColorStop(0.5, withA(warm, 0.08));
      grd.addColorStop(1, withA(warm, 0));
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(ox, oy);
      g.lineTo(ox + Math.cos(a - spread) * len, oy + Math.sin(a - spread) * len);
      g.lineTo(ox + Math.cos(a + spread) * len, oy + Math.sin(a + spread) * len);
      g.closePath();
      g.fill();
    }
  });
}

export function moonSprite(): HTMLCanvasElement {
  return paint(96, 96, (g) => {
    const grd = g.createRadialGradient(40, 40, 4, 48, 48, 30);
    grd.addColorStop(0, "#ffffff");
    grd.addColorStop(1, "#dfe6ff");
    g.fillStyle = grd;
    g.beginPath();
    g.arc(48, 48, 28, 0, TAU);
    g.fill();
    g.fillStyle = "rgba(150,165,210,0.35)";
    for (const [x, y, r] of [
      [38, 40, 6],
      [58, 54, 7],
      [50, 34, 3.5],
      [42, 60, 4],
    ] as const) {
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
    }
  });
}

/** Zugvögel (V-Formation), 8 Frames Flügelschlag nebeneinander, je 90×40 */
export function birdStrip(): HTMLCanvasElement {
  return paint(90 * 8, 40, (g) => {
    for (let f = 0; f < 8; f += 1) {
      const flap = Math.sin((f / 8) * TAU);
      g.save();
      g.translate(f * 90, 0);
      g.strokeStyle = "#2a2a36";
      g.lineWidth = 1.6;
      g.lineCap = "round";
      const pts = [
        [10, 10],
        [22, 16],
        [34, 22],
        [22, 28],
        [46, 28],
        [58, 34],
      ];
      for (let i = 0; i < pts.length; i += 1) {
        const [x, y] = pts[i];
        const fl = Math.sin((f / 8) * TAU + i * 0.9);
        g.beginPath();
        g.moveTo(x - 5, y - fl * 3.5);
        g.quadraticCurveTo(x - 2, y - 1, x, y);
        g.quadraticCurveTo(x + 2, y - 1, x + 5, y - fl * 3.5);
        g.stroke();
      }
      void flap;
      g.restore();
    }
  });
}

export type { StageColors };
