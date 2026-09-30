/**
 * Opernball – prozedurale Ersatz-Props. Fehlen die gemalten Props (Netzfehler, Blocker, veralteter Manifest-Cache), backt die
 * `SpriteBank` stattdessen diese Vektor-Bilder: dieselben Zellenmaße, dieselbe Blickrichtung (Kellner, Tanzpaar, Korken, Flasche
 * und Scheinwerfer werden gespiegelt gezeichnet) und dieselben Ankerpunkte (Korken-Mitte, Flaschenhals, Kronleuchter-Kristalle)
 * wie die Props – der Skin animiert sie unverändert (Wiegen, Schütteln, Pendeln, Rim-Light, Spiegelung).
 * Alles entsteht EINMAL beim Backen (Offscreen-Canvas); pro Frame bleibt ein einziges drawImage.
 */
import { roundRect } from "../../draw-utils";
import type { Ctx2D } from "../shared-b/canvas";
import { mulberry } from "../shared-b/color";

const TAU = Math.PI * 2;
const INK = "#2a1206";

export interface Fallback {
  /** Zellenmaße (wie das Prop-Manifest) – bestimmen das Seitenverhältnis */
  w: number;
  h: number;
  paint: (g: Ctx2D, w: number, h: number) => void;
}

// --- Bausteine --------------------------------------------------------------------------------------------

type Stop = string | [number, string];

function stops(gr: CanvasGradient, s: Stop[]): CanvasGradient {
  s.forEach((st, i) => {
    if (typeof st === "string") gr.addColorStop(s.length === 1 ? 0 : i / (s.length - 1), st);
    else gr.addColorStop(st[0], st[1]);
  });
  return gr;
}

const lin = (g: Ctx2D, x0: number, y0: number, x1: number, y1: number, s: Stop[]): CanvasGradient => stops(g.createLinearGradient(x0, y0, x1, y1), s);
const rad = (g: Ctx2D, x0: number, y0: number, r0: number, x1: number, y1: number, r1: number, s: Stop[]): CanvasGradient =>
  stops(g.createRadialGradient(x0, y0, r0, x1, y1, r1), s);

const GOLD: Stop[] = ["#fff4b8", "#f4c94e", "#c48a14", "#7a4a08"];
const GOLD_H: Stop[] = [[0, "#8a5208"], [0.25, "#ffe27a"], [0.5, "#f4c94e"], [0.8, "#b9770f"], [1, "#6a3c04"]];
const RED: Stop[] = ["#e23a52", "#b0102e", "#6a0618"];

function ell(g: Ctx2D, cx: number, cy: number, rx: number, ry: number, rot = 0): void {
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, rot, 0, TAU);
}

/** Aufkleber-Look: Umriss außen (lw px breit), Füllung darüber */
function sticker(g: Ctx2D, fillStyle: string | CanvasGradient, lw = 7, ink = INK): void {
  g.lineJoin = "round";
  g.lineCap = "round";
  g.strokeStyle = ink;
  g.lineWidth = lw * 2;
  g.stroke();
  g.fillStyle = fillStyle;
  g.fill();
}

function fill(g: Ctx2D, f: string | CanvasGradient): void {
  g.fillStyle = f;
  g.fill();
}

function stroke(g: Ctx2D, c: string | CanvasGradient, lw: number, cap: CanvasLineCap = "round"): void {
  g.strokeStyle = c;
  g.lineWidth = lw;
  g.lineCap = cap;
  g.lineJoin = "round";
  g.stroke();
}

function rr(g: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  roundRect(g, x, y, w, h, r);
}

function sphere(g: Ctx2D, cx: number, cy: number, r: number, s: Stop[], lw = 0): void {
  ell(g, cx, cy, r, r);
  const f = rad(g, cx - r * 0.35, cy - r * 0.4, r * 0.06, cx, cy, r * 1.05, s);
  if (lw > 0) sticker(g, f, lw);
  else fill(g, f);
}

function limb(g: Ctx2D, pts: Array<[number, number]>, lw: number, color: string | CanvasGradient, ol = 7, ink = INK): void {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  stroke(g, ink, lw + ol * 2);
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  stroke(g, color, lw);
}

function poly(g: Ctx2D, p: Array<[number, number]>): void {
  g.beginPath();
  p.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
}

function glint4(g: Ctx2D, cx: number, cy: number, r: number, a = 1): void {
  g.save();
  g.globalAlpha = a;
  g.beginPath();
  g.moveTo(cx, cy - r);
  g.quadraticCurveTo(cx + r * 0.1, cy - r * 0.1, cx + r, cy);
  g.quadraticCurveTo(cx + r * 0.1, cy + r * 0.1, cx, cy + r);
  g.quadraticCurveTo(cx - r * 0.1, cy + r * 0.1, cx - r, cy);
  g.quadraticCurveTo(cx - r * 0.1, cy - r * 0.1, cx, cy - r);
  g.closePath();
  fill(g, "#ffffff");
  g.restore();
}

function shadowUnder(g: Ctx2D, cx: number, y: number, rx: number): void {
  ell(g, cx, y, rx, rx * 0.06);
  fill(g, "rgba(20,6,10,0.28)");
}

/** Schleife (zwei Schlaufen, Knoten, zwei Enden) */
function bow(g: Ctx2D, cx: number, cy: number, s: number, c0: string, c1: string): void {
  const lw = Math.max(2, s * 0.14);
  for (const d of [-1, 1]) {
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + d * s * 0.7, cy + s * 1.25);
    g.lineTo(cx + d * s * 0.28, cy + s * 1.05);
    g.lineTo(cx + d * s * 0.02, cy + s * 0.4);
    g.closePath();
    sticker(g, lin(g, cx, cy, cx, cy + s * 1.2, [c0, c1]), lw);
  }
  for (const d of [-1, 1]) {
    g.beginPath();
    g.moveTo(cx, cy);
    g.bezierCurveTo(cx + d * s * 0.5, cy - s * 1.15, cx + d * s * 1.75, cy - s * 0.7, cx + d * s * 1.55, cy + s * 0.15);
    g.bezierCurveTo(cx + d * s * 1.35, cy + s * 0.75, cx + d * s * 0.5, cy + s * 0.4, cx, cy);
    g.closePath();
    sticker(g, lin(g, cx, cy - s, cx + d * s, cy + s * 0.6, [c0, c1]), lw);
  }
  ell(g, cx, cy + s * 0.1, s * 0.34, s * 0.34);
  sticker(g, lin(g, cx - s * 0.3, cy - s * 0.3, cx + s * 0.3, cy + s * 0.4, [c0, c1]), lw);
}

/** Kerzenflamme */
function flame(g: Ctx2D, x: number, y: number, s: number): void {
  g.beginPath();
  g.moveTo(x, y - s * 1.5);
  g.bezierCurveTo(x + s * 0.9, y - s * 0.6, x + s * 0.7, y + s * 0.3, x, y + s * 0.3);
  g.bezierCurveTo(x - s * 0.7, y + s * 0.3, x - s * 0.9, y - s * 0.6, x, y - s * 1.5);
  g.closePath();
  fill(g, rad(g, x, y, 0, x, y - s * 0.4, s * 1.2, ["#ffffff", "#ffe27a", "#ff9a2a"]));
}

// --- Kuchenwagen ------------------------------------------------------------------------------------------

function cakecart(g: Ctx2D): void {
  shadowUnder(g, 254, 508, 236);
  // Räder
  for (const [x, r] of [[128, 46], [394, 46]] as const) {
    ell(g, x, 464, r, r);
    sticker(g, lin(g, 0, 418, 0, 510, ["#4a4054", "#141018"]), 5);
    sphere(g, x, 464, 20, ["#fff4b8", "#c48a14", "#6a3c04"], 3);
    for (let i = 0; i < 6; i += 1) {
      const a = (i * TAU) / 6;
      g.beginPath();
      g.moveTo(x + Math.cos(a) * 20, 464 + Math.sin(a) * 20);
      g.lineTo(x + Math.cos(a) * 38, 464 + Math.sin(a) * 38);
      stroke(g, "#c8ced8", 3);
    }
  }
  // Rahmen: Pfosten + Rungen
  for (const x of [70, 430]) {
    g.beginPath();
    rr(g, x - 8, 96, 16, 372, 6);
    sticker(g, lin(g, x - 8, 0, x + 8, 0, GOLD_H), 4);
  }
  g.beginPath();
  g.moveTo(438, 118);
  g.lineTo(438, 78);
  g.quadraticCurveTo(438, 50, 476, 50);
  g.lineTo(502, 50);
  stroke(g, INK, 30);
  g.beginPath();
  g.moveTo(438, 118);
  g.lineTo(438, 78);
  g.quadraticCurveTo(438, 50, 476, 50);
  g.lineTo(502, 50);
  stroke(g, lin(g, 0, 40, 0, 120, GOLD), 16);
  // Ablagen (Tablett mit Rand)
  for (const y of [222, 344]) {
    g.beginPath();
    rr(g, 30, y, 452, 24, 8);
    sticker(g, lin(g, 0, y, 0, y + 24, GOLD), 4);
    g.beginPath();
    g.moveTo(40, y + 6);
    g.lineTo(472, y + 6);
    stroke(g, "rgba(255,255,255,0.6)", 3);
    for (let x = 52; x < 470; x += 24) {
      ell(g, x, y + 17, 3.6, 3.6);
      fill(g, "rgba(90,50,8,0.6)");
    }
  }
  g.beginPath();
  rr(g, 46, 430, 420, 16, 6);
  sticker(g, lin(g, 0, 430, 0, 446, GOLD), 4);
  // Torte (oben links)
  const cx = 168;
  const layer = (x: number, y: number, w: number, h: number, c0: string, c1: string): void => {
    g.beginPath();
    rr(g, x, y, w, h, 12);
    sticker(g, lin(g, 0, y, 0, y + h, [c0, c1]), 5);
    g.save();
    rr(g, x, y, w, h, 12);
    g.clip();
    g.beginPath();
    g.moveTo(x, y + 4);
    for (let i = 0; i < 6; i += 1) {
      const xa = x + (i * w) / 6;
      g.quadraticCurveTo(xa + w / 12, y + 30 + (i % 2) * 12, xa + w / 6, y + 4);
    }
    g.lineTo(x + w, y - 10);
    g.lineTo(x, y - 10);
    g.closePath();
    fill(g, "#ffffff");
    g.restore();
    g.fillStyle = "rgba(255,255,255,0.7)";
    for (let i = 0; i < 7; i += 1) {
      ell(g, x + 10 + (i * (w - 20)) / 6, y + h - 8, 5, 4);
      g.fill();
    }
  };
  layer(94, 158, 150, 64, "#ffb8d0", "#e2708f");
  layer(114, 108, 110, 52, "#fff4dc", "#e8cfa0");
  layer(132, 66, 74, 44, "#ffb8d0", "#e2708f");
  sphere(g, cx, 52, 16, ["#ffb0b0", "#d81e3a", "#7a0a14"], 3);
  g.beginPath();
  g.moveTo(cx + 2, 38);
  g.quadraticCurveTo(cx + 14, 20, cx + 28, 16);
  stroke(g, "#2f7a3a", 4);
  for (const x of [104, 136, 200, 232]) sphere(g, x, 152, 11, ["#ffb0b0", "#d81e3a", "#7a0a14"], 2.4);
  // Silberne Haube (oben rechts)
  ell(g, 350, 220, 96, 12);
  sticker(g, lin(g, 0, 208, 0, 232, ["#f4f6fa", "#8a92a6"]), 4);
  g.beginPath();
  g.moveTo(266, 216);
  g.bezierCurveTo(262, 120, 310, 96, 350, 96);
  g.bezierCurveTo(390, 96, 438, 120, 434, 216);
  g.closePath();
  sticker(g, lin(g, 266, 0, 434, 0, [[0, "#7a8298"], [0.3, "#f8fafc"], [0.6, "#c4cad8"], [1, "#6a728a"]]), 6);
  g.beginPath();
  g.moveTo(292, 196);
  g.bezierCurveTo(288, 140, 312, 116, 338, 112);
  stroke(g, "rgba(255,255,255,0.75)", 6);
  sphere(g, 350, 84, 16, ["#ffffff", "#c4cad8", "#6a728a"], 4);
  // Untere Ablage: Petits Fours + Teekanne
  const cols: Array<[string, string]> = [["#ffb8d0", "#e2708f"], ["#c8f0d8", "#5abf88"], ["#ffe8a0", "#e0a82a"], ["#d8c8ff", "#8a6ad8"], ["#ffb8d0", "#e2708f"]];
  cols.forEach(([c0, c1], i) => {
    const x = 60 + i * 58;
    g.beginPath();
    rr(g, x, 304, 46, 40, 8);
    sticker(g, lin(g, 0, 304, 0, 344, [c0, c1]), 4);
    g.beginPath();
    g.moveTo(x + 6, 316);
    g.quadraticCurveTo(x + 23, 330, x + 40, 316);
    stroke(g, "rgba(255,255,255,0.85)", 4);
    sphere(g, x + 23, 310, 5, ["#fff0f0", "#d81e3a", "#7a0a14"], 0);
  });
  ell(g, 396, 316, 46, 34);
  sticker(g, lin(g, 0, 282, 0, 350, ["#ffffff", "#d6d0e8"]), 5);
  g.beginPath();
  g.moveTo(348, 306);
  g.quadraticCurveTo(320, 290, 314, 262);
  g.quadraticCurveTo(342, 274, 356, 296);
  sticker(g, "#f2eeff", 4);
  g.beginPath();
  g.moveTo(438, 306);
  g.quadraticCurveTo(478, 290, 462, 330);
  stroke(g, INK, 14);
  g.beginPath();
  g.moveTo(438, 306);
  g.quadraticCurveTo(478, 290, 462, 330);
  stroke(g, "#ffffff", 7);
  ell(g, 396, 284, 24, 8);
  sticker(g, "#ffffff", 3);
  sphere(g, 396, 272, 6, ["#fff4b8", "#c48a14", "#6a3c04"], 2);
  g.beginPath();
  g.moveTo(354, 316);
  g.quadraticCurveTo(396, 332, 438, 316);
  stroke(g, "#c81e3a", 8);
  glint4(g, 292, 132, 12, 0.9);
}

// --- Harfe -------------------------------------------------------------------------------------------------

function harp(g: Ctx2D): void {
  shadowUnder(g, 152, 508, 130);
  // Saiten (Hals-Bogen → Resonanzkörper-Diagonale)
  const neckY = (x: number): number => 54 + Math.pow((x - 66) / 190, 1.6) * 74;
  const boxY = (x: number): number => 470 - ((x - 78) * 344) / 184;
  const strings: number[] = [];
  for (let x = 92; x < 246; x += 11) strings.push(x);
  // Resonanzkörper (Diagonale)
  const P0: [number, number] = [78, 476];
  const P1: [number, number] = [258, 130];
  const dl = Math.hypot(P1[0] - P0[0], P1[1] - P0[1]);
  const ux = (P1[0] - P0[0]) / dl;
  const uy = (P1[1] - P0[1]) / dl;
  const nx = -uy;
  const ny = ux;
  const bw = 40;
  poly(g, [
    [P0[0] - nx * 6, P0[1] - ny * 6],
    [P1[0] - nx * 6, P1[1] - ny * 6],
    [P1[0] + nx * bw + ux * 10, P1[1] + ny * bw + uy * 10],
    [P0[0] + nx * (bw + 14), P0[1] + ny * (bw + 14)],
  ]);
  sticker(g, lin(g, 70, 0, 300, 0, GOLD_H), 6);
  poly(g, [
    [P0[0] + nx * 8, P0[1] + ny * 8 - 20],
    [P1[0] + nx * 8, P1[1] + ny * 8 + 8],
    [P1[0] + nx * (bw - 8), P1[1] + ny * (bw - 8) + 8],
    [P0[0] + nx * (bw + 4), P0[1] + ny * (bw + 4) - 20],
  ]);
  fill(g, lin(g, 0, 130, 0, 476, ["#a8321a", "#6a1408", "#3a0a04"]));
  for (let i = 0; i < 9; i += 1) {
    const t = 0.08 + i * 0.1;
    sphere(g, P0[0] + ux * dl * t + nx * (bw * 0.5 + 4), P0[1] + uy * dl * t + ny * (bw * 0.5 + 4) - 14, 4.6, ["#fff4b8", "#c48a14", "#6a3c04"], 0);
  }
  // Saiten
  const cols = ["#d8283a", "#f4f4f8", "#3a6ee0", "#f4f4f8", "#f4f4f8", "#2a2a3a", "#f4f4f8"];
  strings.forEach((x, i) => {
    g.beginPath();
    g.moveTo(x, neckY(x) + 8);
    g.lineTo(x, boxY(x) - 4);
    stroke(g, "rgba(40,16,4,0.6)", 5, "butt");
    g.beginPath();
    g.moveTo(x, neckY(x) + 8);
    g.lineTo(x, boxY(x) - 4);
    stroke(g, cols[i % cols.length], 2.4, "butt");
  });
  // Hals (Bogen)
  g.beginPath();
  g.moveTo(52, 44);
  g.bezierCurveTo(120, 30, 210, 60, 262, 128);
  stroke(g, INK, 44);
  g.beginPath();
  g.moveTo(52, 44);
  g.bezierCurveTo(120, 30, 210, 60, 262, 128);
  stroke(g, lin(g, 0, 20, 0, 140, GOLD), 30);
  g.beginPath();
  g.moveTo(54, 36);
  g.bezierCurveTo(120, 22, 208, 52, 258, 116);
  stroke(g, "rgba(255,255,255,0.6)", 5);
  for (let i = 0; i < 7; i += 1) {
    const x = 96 + i * 22;
    sphere(g, x, neckY(x) - 3, 4.4, ["#ffffff", "#c8ced8", "#6a728a"], 0);
  }
  // Säule mit Kapitell und Sockel
  g.beginPath();
  rr(g, 30, 52, 42, 430, 12);
  sticker(g, lin(g, 30, 0, 72, 0, GOLD_H), 6);
  for (const y of [120, 170, 220, 270, 320, 370, 420]) {
    g.beginPath();
    g.moveTo(34, y);
    g.lineTo(68, y);
    stroke(g, "rgba(90,50,8,0.45)", 3, "butt");
  }
  g.beginPath();
  g.moveTo(24, 44);
  g.quadraticCurveTo(26, 8, 52, 8);
  g.quadraticCurveTo(84, 8, 84, 44);
  g.quadraticCurveTo(52, 30, 24, 44);
  g.closePath();
  sticker(g, lin(g, 0, 8, 0, 44, GOLD), 5);
  ell(g, 34, 40, 12, 12);
  sticker(g, lin(g, 0, 28, 0, 52, GOLD), 4);
  g.beginPath();
  rr(g, 12, 476, 290, 30, 10);
  sticker(g, lin(g, 0, 476, 0, 506, GOLD), 6);
  g.beginPath();
  rr(g, 24, 456, 60, 26, 8);
  sticker(g, lin(g, 0, 456, 0, 482, GOLD), 5);
  glint4(g, 62, 200, 14, 0.9);
  glint4(g, 232, 240, 12, 0.8);
}

// --- Blumenstrauß -------------------------------------------------------------------------------------------

function bouquet(g: Ctx2D): void {
  const r = mulberry(21);
  shadowUnder(g, 240, 510, 190);
  // Blätter am Rand
  for (let i = 0; i < 16; i += 1) {
    const a = (i / 16) * TAU;
    const x = 240 + Math.cos(a) * 196;
    const y = 200 + Math.sin(a) * 150;
    g.save();
    g.translate(x, y);
    g.rotate(a);
    ell(g, 0, 0, 58, 22);
    sticker(g, lin(g, -58, 0, 58, 0, ["#1f7a3a", "#3fb56a", "#166a30"]), 4);
    g.beginPath();
    g.moveTo(-46, 0);
    g.lineTo(46, 0);
    stroke(g, "rgba(200,255,200,0.4)", 2.4);
    g.restore();
  }
  const blooms: Array<{ x: number; y: number; k: number; kind: number }> = [];
  for (let i = 0; i < 26; i += 1) {
    const a = r() * TAU;
    const d = Math.sqrt(r());
    blooms.push({ x: 240 + Math.cos(a) * d * 176, y: 196 + Math.sin(a) * d * 128, k: 0.8 + r() * 0.4, kind: r() < 0.22 ? 1 : 0 });
  }
  blooms.sort((p, q) => p.y - q.y);
  for (const b of blooms) {
    if (b.kind === 0) {
      const rr0 = 40 * b.k;
      sphere(g, b.x, b.y, rr0, ["#ff6a78", "#d0142e", "#6a0618"], 4);
      for (let j = 1; j <= 3; j += 1) {
        g.beginPath();
        g.arc(b.x, b.y, rr0 * (0.25 + j * 0.2), j * 1.6, j * 1.6 + 4.2);
        stroke(g, j % 2 ? "rgba(90,0,20,0.55)" : "rgba(255,170,180,0.5)", 3.2);
      }
    } else {
      const pr = 34 * b.k;
      for (let j = 0; j < 6; j += 1) {
        g.save();
        g.translate(b.x, b.y);
        g.rotate((j * TAU) / 6 + 0.3);
        ell(g, pr * 0.6, 0, pr * 0.62, pr * 0.24);
        sticker(g, lin(g, 0, 0, pr, 0, ["#ffffff", "#f0eaf8"]), 3, "#5a4a6a");
        g.restore();
      }
      ell(g, b.x, b.y, pr * 0.2, pr * 0.2);
      fill(g, "#f4c020");
      for (let j = 0; j < 5; j += 1) {
        ell(g, b.x + Math.cos(j * 1.3) * pr * 0.3, b.y + Math.sin(j * 1.3) * pr * 0.3, 3, 3);
        fill(g, "#b8780a");
      }
    }
  }
  for (let i = 0; i < 40; i += 1) {
    const a = r() * TAU;
    const d = 0.85 + r() * 0.3;
    sphere(g, 240 + Math.cos(a) * 200 * d, 196 + Math.sin(a) * 152 * d, 4 + r() * 3, ["#ffffff", "#f0f0ff", "#b8b8d8"], 0);
  }
  // Vase
  g.beginPath();
  g.moveTo(176, 384);
  g.bezierCurveTo(126, 408, 126, 470, 172, 490);
  g.lineTo(308, 490);
  g.bezierCurveTo(354, 470, 354, 408, 304, 384);
  g.closePath();
  sticker(g, lin(g, 126, 0, 354, 0, GOLD_H), 6);
  g.beginPath();
  g.moveTo(140, 432);
  g.quadraticCurveTo(240, 452, 340, 432);
  stroke(g, "rgba(90,50,8,0.6)", 5);
  sphere(g, 240, 444, 11, ["#ff9aa8", "#c8102e", "#5a0410"], 3);
  ell(g, 240, 386, 70, 14);
  sticker(g, lin(g, 0, 372, 0, 400, GOLD), 5);
  g.beginPath();
  rr(g, 168, 486, 144, 22, 8);
  sticker(g, lin(g, 0, 486, 0, 508, GOLD), 5);
  bow(g, 240, 406, 26, "#e23a52", "#8a0a1e");
  glint4(g, 128, 130, 16, 0.9);
}

// --- Champagnerturm --------------------------------------------------------------------------------------------

function coupe(g: Ctx2D, cx: number, cy: number, s: number): void {
  // Fuß + Stiel
  ell(g, cx, cy + s * 0.72, s * 0.24, s * 0.06);
  sticker(g, lin(g, 0, cy + s * 0.66, 0, cy + s * 0.78, ["#fff8e0", "#c8b880"]), 3);
  g.beginPath();
  rr(g, cx - s * 0.05, cy + s * 0.34, s * 0.1, s * 0.4, 3);
  sticker(g, lin(g, cx - s * 0.05, 0, cx + s * 0.05, 0, ["#fff8e0", "#c8b880"]), 2.6);
  // Schale
  g.beginPath();
  g.moveTo(cx - s * 0.5, cy);
  g.quadraticCurveTo(cx - s * 0.46, cy + s * 0.44, cx, cy + s * 0.44);
  g.quadraticCurveTo(cx + s * 0.46, cy + s * 0.44, cx + s * 0.5, cy);
  g.closePath();
  sticker(g, lin(g, 0, cy, 0, cy + s * 0.44, ["#fff2b0", "#f0b83a", "#c48a14"]), 3.2, "#5a3a08");
  g.beginPath();
  g.moveTo(cx - s * 0.36, cy + s * 0.08);
  g.quadraticCurveTo(cx - s * 0.3, cy + s * 0.28, cx - s * 0.1, cy + s * 0.36);
  stroke(g, "rgba(255,255,255,0.7)", s * 0.05);
  ell(g, cx, cy, s * 0.5, s * 0.09);
  sticker(g, lin(g, 0, cy - s * 0.09, 0, cy + s * 0.09, ["#fffbe0", "#ffe27a"]), 3, "#5a3a08");
  for (const [dx, dy, br] of [[-0.18, 0.18, 0.045], [0.12, 0.22, 0.035], [0.02, 0.3, 0.04]]) {
    ell(g, cx + dx * s, cy + dy * s, br * s, br * s);
    stroke(g, "rgba(255,255,255,0.8)", 1.6);
  }
}

function champagne(g: Ctx2D): void {
  shadowUnder(g, 155, 510, 148);
  // Tischdecke
  g.beginPath();
  g.moveTo(40, 412);
  g.lineTo(270, 412);
  g.lineTo(296, 500);
  for (let i = 0; i < 6; i += 1) g.quadraticCurveTo(296 - (i + 0.5) * 47, 516 - (i % 2) * 6, 296 - (i + 1) * 47, 500);
  g.lineTo(40, 412);
  g.closePath();
  sticker(g, lin(g, 14, 0, 296, 0, [[0, "#c8cee0"], [0.3, "#ffffff"], [0.7, "#e4e8f4"], [1, "#a8b0c8"]]), 5, "#5a4a6a");
  for (const x of [72, 112, 152, 194, 236]) {
    g.beginPath();
    g.moveTo(x + (x - 155) * 0.08, 414);
    g.quadraticCurveTo(x + (x - 155) * 0.25, 460, x + (x - 155) * 0.34, 506);
    stroke(g, "rgba(120,130,170,0.35)", 4);
  }
  g.beginPath();
  g.moveTo(44, 428);
  g.quadraticCurveTo(155, 446, 266, 428);
  stroke(g, "#e0a52a", 7);
  ell(g, 155, 410, 116, 14);
  sticker(g, lin(g, 0, 396, 0, 424, ["#ffffff", "#dde2f0"]), 4, "#5a4a6a");
  // Türmchen: obere Reihen zuerst
  const rows: Array<[number, number[]]> = [
    [126, [155]],
    [206, [120, 190]],
    [286, [85, 155, 225]],
    [366, [50, 120, 190, 260]],
  ];
  for (const [y, xs] of rows) for (const x of xs) coupe(g, x, y, 78);
  sphere(g, 155, 96, 11, ["#fff4b8", "#c48a14", "#6a3c04"], 3);
  glint4(g, 122, 112, 22);
  glint4(g, 216, 210, 15, 0.9);
  glint4(g, 62, 350, 13, 0.8);
}

// --- Absperrseil -------------------------------------------------------------------------------------------------

function rope(g: Ctx2D): void {
  shadowUnder(g, 256, 392, 240);
  // Seil (hinter den Pfosten)
  const rp = (): void => {
    g.beginPath();
    g.moveTo(74, 122);
    g.bezierCurveTo(130, 290, 382, 290, 438, 122);
  };
  rp();
  stroke(g, INK, 50);
  rp();
  stroke(g, lin(g, 0, 110, 0, 260, ["#e23a52", "#b0102e", "#6a0618"]), 36);
  g.save();
  g.setLineDash([3, 11]);
  rp();
  stroke(g, "rgba(255,150,170,0.5)", 30, "butt");
  g.restore();
  g.beginPath();
  g.moveTo(80, 108);
  g.bezierCurveTo(134, 268, 380, 268, 432, 108);
  stroke(g, "rgba(255,210,220,0.55)", 6);
  // Pfosten
  for (const x of [70, 442]) {
    ell(g, x, 372, 60, 16);
    sticker(g, lin(g, x - 60, 0, x + 60, 0, GOLD_H), 5);
    ell(g, x, 366, 44, 10);
    fill(g, "rgba(255,255,255,0.35)");
    g.beginPath();
    g.moveTo(x - 14, 366);
    g.lineTo(x - 11, 120);
    g.lineTo(x + 11, 120);
    g.lineTo(x + 14, 366);
    g.closePath();
    sticker(g, lin(g, x - 14, 0, x + 14, 0, GOLD_H), 5);
    for (const y of [150, 330]) {
      ell(g, x, y, 22, 8);
      sticker(g, lin(g, 0, y - 8, 0, y + 8, GOLD), 3.4);
    }
    sphere(g, x, 92, 32, ["#fffbe0", "#f4c94e", "#b9770f", "#6a3c04"], 6);
    g.beginPath();
    g.arc(x, 92, 22, Math.PI * 1.1, Math.PI * 1.6);
    stroke(g, "rgba(255,255,255,0.8)", 5);
    ell(g, x, 130, 20, 9);
    sticker(g, lin(g, 0, 121, 0, 139, GOLD), 3.4);
  }
}

// --- Vorhang (Volant) ---------------------------------------------------------------------------------------------

function drape(g: Ctx2D, w: number, h: number): void {
  // Gestänge
  g.beginPath();
  rr(g, 10, 2, w - 20, 28, 12);
  sticker(g, lin(g, 0, 2, 0, 30, GOLD), 5);
  for (const x of [50, 462]) {
    ell(g, x, 16, 15, 15);
    sticker(g, lin(g, x - 12, 0, x + 12, 0, GOLD_H), 3.6);
  }
  // Samt mit drei Raffungen
  const xs = [26, 170, 342, 486];
  const body = (): void => {
    g.beginPath();
    g.moveTo(xs[0], 22);
    g.lineTo(xs[3], 22);
    g.lineTo(xs[3], 118);
    for (let i = 2; i >= 0; i -= 1) g.quadraticCurveTo((xs[i] + xs[i + 1]) / 2, 214, xs[i], 118);
    g.closePath();
  };
  body();
  sticker(g, lin(g, 0, 22, 0, 200, ["#d8284a", "#a00e2c", "#5a0616"]), 6);
  g.save();
  body();
  g.clip();
  for (let i = 0; i < 3; i += 1) {
    const xa = xs[i];
    const xb = xs[i + 1];
    for (let j = 0; j < 7; j += 1) {
      const u = (j + 0.5) / 7;
      g.beginPath();
      g.moveTo(xa + (xb - xa) * u * 0.5 + (xb - xa) * 0.25, 22);
      g.quadraticCurveTo(xa + (xb - xa) * u, 110 + Math.sin(u * Math.PI) * 30, xa + (xb - xa) * u, 150 + Math.sin(u * Math.PI) * 60);
      stroke(g, j % 2 ? "rgba(255,150,170,0.32)" : "rgba(50,0,12,0.38)", 5);
    }
  }
  g.restore();
  // Goldborte + Fransen
  g.beginPath();
  g.moveTo(xs[3], 118);
  for (let i = 2; i >= 0; i -= 1) g.quadraticCurveTo((xs[i] + xs[i + 1]) / 2, 214, xs[i], 118);
  stroke(g, INK, 12);
  g.beginPath();
  g.moveTo(xs[3], 118);
  for (let i = 2; i >= 0; i -= 1) g.quadraticCurveTo((xs[i] + xs[i + 1]) / 2, 214, xs[i], 118);
  stroke(g, "#ffd75e", 7);
  for (let i = 0; i < 3; i += 1) {
    const xa = xs[i];
    const xb = xs[i + 1];
    for (let j = 0; j <= 24; j += 1) {
      const u = j / 24;
      const x = xa + (xb - xa) * u;
      const y = 118 + 2 * u * (1 - u) * 96;
      g.beginPath();
      g.moveTo(x, y + 3);
      g.lineTo(x, y + 13);
      stroke(g, "#ffd75e", 3);
    }
  }
  // Quasten an den Raffpunkten
  for (const x of [xs[1], xs[2]]) {
    g.beginPath();
    g.moveTo(x - 5, 118);
    g.lineTo(x + 5, 118);
    g.lineTo(x + 3, 138);
    g.lineTo(x - 3, 138);
    g.closePath();
    sticker(g, lin(g, 0, 118, 0, 138, GOLD), 3);
    ell(g, x, 150, 11, 13);
    sticker(g, lin(g, x - 10, 0, x + 10, 0, GOLD_H), 3.4);
    for (let j = -3; j <= 3; j += 1) {
      g.beginPath();
      g.moveTo(x + j * 3, 158);
      g.lineTo(x + j * 4, 190);
      stroke(g, j % 2 ? "#ffd75e" : "#c48a14", 3);
    }
  }
  void h;
}

// --- Kronleuchter (Aufhängung oben Mitte; Kristalle bei den Glitzerpunkten des Skins) -------------------------------

function chandelier(g: Ctx2D): void {
  const cx = 216;
  // Kettenglied + Schaft
  ell(g, cx, 12, 11, 12);
  stroke(g, INK, 12);
  ell(g, cx, 12, 11, 12);
  stroke(g, "#ffd75e", 6);
  g.beginPath();
  g.moveTo(cx, 22);
  g.lineTo(cx, 392);
  stroke(g, INK, 22);
  g.beginPath();
  g.moveTo(cx, 22);
  g.lineTo(cx, 392);
  stroke(g, lin(g, cx - 8, 0, cx + 8, 0, GOLD_H), 12);
  for (const y of [70, 190, 300]) {
    sphere(g, cx, y, 22, ["#fffbe0", "#f4c94e", "#b9770f", "#6a3c04"], 5);
  }
  const tier = (y: number, hw: number, drop: number, n: number): void => {
    // Arme: Bogen links/rechts, Kerzentüllen
    for (const d of [-1, 1]) {
      g.beginPath();
      g.moveTo(cx, y);
      g.bezierCurveTo(cx + d * hw * 0.35, y + drop * 0.2, cx + d * hw * 0.85, y + drop * 0.1, cx + d * hw, y - drop * 0.5);
      stroke(g, INK, 18);
      g.beginPath();
      g.moveTo(cx, y);
      g.bezierCurveTo(cx + d * hw * 0.35, y + drop * 0.2, cx + d * hw * 0.85, y + drop * 0.1, cx + d * hw, y - drop * 0.5);
      stroke(g, lin(g, 0, y - 20, 0, y + 30, GOLD), 10);
    }
    // Kristallgehänge
    for (let i = 0; i < n; i += 1) {
      const u = (i + 0.5) / n;
      for (const d of [-1, 1]) {
        const x = cx + d * hw * u;
        const yy = y + Math.sin(u * 2.4) * drop * 0.16 - drop * 0.5 * u * u;
        g.beginPath();
        g.moveTo(x, yy);
        g.quadraticCurveTo(x + 9, yy + 26, x, yy + 52 + (i % 2) * 18);
        g.quadraticCurveTo(x - 9, yy + 26, x, yy);
        sticker(g, lin(g, x - 8, yy, x + 8, yy + 60, ["#ffffff", "#bfe4ff", "#7ab8f0"]), 2.6, "#3a4a8a");
      }
    }
    for (const d of [-1, 1]) {
      const x = cx + d * hw;
      const yy = y - drop * 0.5;
      g.beginPath();
      rr(g, x - 14, yy - 6, 28, 18, 5);
      sticker(g, lin(g, 0, yy - 6, 0, yy + 12, GOLD), 3.4);
      g.beginPath();
      rr(g, x - 6, yy - 46, 12, 42, 4);
      sticker(g, lin(g, x - 6, 0, x + 6, 0, ["#fffaf0", "#e8dcc0"]), 2.6, "#5a4a2a");
      flame(g, x, yy - 54, 9);
    }
  };
  tier(126, 96, 60, 3);
  tier(236, 170, 80, 4);
  tier(344, 206, 90, 5);
  // Krönung unten
  g.beginPath();
  g.moveTo(cx, 392);
  g.quadraticCurveTo(cx + 56, 420, cx + 22, 468);
  g.lineTo(cx, 508);
  g.lineTo(cx - 22, 468);
  g.quadraticCurveTo(cx - 56, 420, cx, 392);
  g.closePath();
  sticker(g, lin(g, cx - 50, 0, cx + 50, 0, ["#ffffff", "#bfe4ff", "#6aa8e8", "#c8ecff"]), 4, "#3a4a8a");
  g.beginPath();
  g.moveTo(cx - 18, 410);
  g.lineTo(cx - 6, 480);
  stroke(g, "rgba(255,255,255,0.85)", 4);
  // Glitzerpunkte
  for (const [px, py, r] of [[0.09, 0.44, 14], [0.27, 0.37, 14], [0.72, 0.37, 14], [0.91, 0.45, 14], [0.3, 0.8, 11], [0.7, 0.78, 11]] as const) glint4(g, px * 432, py * 512, r, 0.85);
}

// --- Kellner (Blick rechts, Tablett rechts; wird gespiegelt gezeichnet) ---------------------------------------------

function waiter(g: Ctx2D): void {
  const black = (): CanvasGradient => lin(g, 0, 140, 0, 480, ["#3a3a50", "#16161f", "#0a0a12"]);
  shadowUnder(g, 260, 496, 190);
  // Frackschöße + Hinterbein
  poly(g, [[214, 280], [122, 344], [172, 356], [146, 396], [240, 340]]);
  sticker(g, lin(g, 0, 280, 0, 396, ["#2a2a3a", "#0a0a12"]), 5);
  limb(g, [[222, 312], [172, 388], [126, 462]], 46, black(), 6);
  ell(g, 108, 476, 38, 15, -0.12);
  sticker(g, lin(g, 0, 462, 0, 490, ["#4a4a5e", "#0a0a12"]), 4);
  // Rumpf
  g.beginPath();
  g.moveTo(222, 160);
  g.quadraticCurveTo(270, 140, 318, 162);
  g.lineTo(308, 306);
  g.lineTo(224, 306);
  g.closePath();
  sticker(g, lin(g, 222, 0, 318, 0, ["#3a3a50", "#16161f", "#0a0a12"]), 6);
  poly(g, [[252, 158], [292, 158], [278, 280], [268, 280]]);
  fill(g, "#fafaff");
  poly(g, [[236, 250], [304, 250], [300, 296], [240, 296]]);
  fill(g, lin(g, 0, 250, 0, 296, ["#ffd75e", "#b9770f"]));
  for (const y of [204, 232]) {
    sphere(g, 272, y, 5, ["#fff4b8", "#c48a14", "#6a3c04"], 0);
  }
  bow(g, 272, 172, 13, "#e23a52", "#8a0a1e");
  // Vorderbein
  limb(g, [[282, 316], [332, 382], [382, 448]], 46, black(), 6);
  ell(g, 404, 468, 40, 16, 0.1);
  sticker(g, lin(g, 0, 452, 0, 484, ["#4a4a5e", "#0a0a12"]), 4);
  // Hinterer Arm mit Serviette
  limb(g, [[238, 176], [200, 232], [156, 262]], 34, black(), 6);
  poly(g, [[164, 236], [226, 226], [236, 282], [176, 296]]);
  sticker(g, lin(g, 0, 226, 0, 296, ["#ffffff", "#d8dcec"]), 4, "#5a4a6a");
  ell(g, 150, 268, 17, 15);
  sticker(g, "#f0b088", 4);
  // Kopf
  ell(g, 278, 92, 50, 52);
  sticker(g, lin(g, 0, 40, 0, 144, ["#ffe0c0", "#ecac84"]), 6);
  g.beginPath();
  g.moveTo(228, 84);
  g.quadraticCurveTo(232, 36, 282, 38);
  g.quadraticCurveTo(326, 40, 326, 80);
  g.quadraticCurveTo(290, 62, 252, 80);
  g.quadraticCurveTo(240, 96, 232, 116);
  g.closePath();
  sticker(g, lin(g, 0, 36, 0, 116, ["#3a2a20", "#0a0806"]), 5);
  ell(g, 300, 96, 10, 12);
  sticker(g, "#ffffff", 2.6);
  ell(g, 303, 98, 5, 6);
  fill(g, "#1a1030");
  g.beginPath();
  g.moveTo(290, 80);
  g.quadraticCurveTo(302, 72, 318, 80);
  stroke(g, "#0a0806", 4);
  ell(g, 326, 110, 7, 6);
  fill(g, "#ec9a70");
  g.beginPath();
  g.moveTo(296, 126);
  g.quadraticCurveTo(318, 122, 336, 124);
  g.quadraticCurveTo(318, 136, 296, 126);
  fill(g, "#0a0806");
  g.beginPath();
  g.arc(310, 130, 14, 0.15 * Math.PI, 0.75 * Math.PI);
  stroke(g, "#8a2a2a", 3.4);
  // Vorderer Arm mit Tablett
  limb(g, [[308, 176], [362, 168], [410, 128]], 34, black(), 6);
  ell(g, 420, 122, 15, 15);
  sticker(g, "#f0b088", 4);
  ell(g, 416, 104, 84, 12);
  sticker(g, lin(g, 0, 92, 0, 116, ["#ffffff", "#8a92a6"]), 4);
  for (const x of [366, 400, 434, 468]) {
    g.beginPath();
    g.moveTo(x - 11, 24);
    g.lineTo(x + 11, 24);
    g.lineTo(x + 5, 76);
    g.lineTo(x - 5, 76);
    g.closePath();
    sticker(g, lin(g, x - 11, 0, x + 11, 0, ["rgba(255,255,255,0.85)", "rgba(200,220,240,0.6)"]), 2.6, "#5a4a6a");
    g.beginPath();
    g.moveTo(x - 9, 36);
    g.lineTo(x + 9, 36);
    g.lineTo(x + 4.6, 74);
    g.lineTo(x - 4.6, 74);
    g.closePath();
    fill(g, lin(g, 0, 36, 0, 74, ["#ffe27a", "#e0a82a"]));
    g.beginPath();
    g.moveTo(x - 1.6, 76);
    g.lineTo(x - 1.6, 92);
    g.moveTo(x + 1.6, 76);
    g.lineTo(x + 1.6, 92);
    stroke(g, "#c8d0e0", 3, "butt");
    ell(g, x - 3, 44, 2, 2);
    fill(g, "rgba(255,255,255,0.85)");
  }
  glint4(g, 384, 40, 12, 0.9);
}

// --- Tanzpaar ------------------------------------------------------------------------------------------------------

function dancers(g: Ctx2D): void {
  shadowUnder(g, 246, 506, 218);
  const skin = (): CanvasGradient => lin(g, 0, 90, 0, 220, ["#ffe0c0", "#ecac84"]);
  // Rock (Glocke) der Dame
  g.beginPath();
  g.moveTo(190, 290);
  g.bezierCurveTo(140, 330, 22, 400, 14, 470);
  g.quadraticCurveTo(90, 512, 200, 494);
  g.quadraticCurveTo(310, 512, 386, 470);
  g.bezierCurveTo(376, 400, 260, 330, 214, 290);
  g.closePath();
  sticker(g, rad(g, 200, 300, 10, 200, 420, 230, ["#ff5a72", "#c8102e", "#7a0a1e"]), 7);
  g.save();
  g.clip();
  for (let i = 0; i < 10; i += 1) {
    const u = i / 9;
    g.beginPath();
    g.moveTo(200, 300);
    g.quadraticCurveTo(200 + (u - 0.5) * 240, 400, 14 + u * 372, 500);
    stroke(g, i % 2 ? "rgba(255,170,190,0.28)" : "rgba(70,0,16,0.36)", 9);
  }
  for (let j = 0; j < 3; j += 1) {
    g.beginPath();
    g.moveTo(40 + j * 20, 410 + j * 22);
    g.quadraticCurveTo(200, 450 + j * 28, 360 - j * 20, 410 + j * 22);
    stroke(g, "rgba(255,200,210,0.4)", 4);
  }
  g.restore();
  g.beginPath();
  g.moveTo(16, 472);
  g.quadraticCurveTo(90, 512, 200, 496);
  g.quadraticCurveTo(310, 512, 384, 472);
  stroke(g, "#ffd75e", 7);
  for (const [x, y] of [[70, 480], [140, 494], [250, 494], [326, 482]]) sphere(g, x, y, 5, ["#ffffff", "#ffe27a", "#c48a14"], 0);
  // Beine des Herrn
  limb(g, [[334, 296], [316, 400], [304, 480]], 42, lin(g, 0, 290, 0, 490, ["#2a2a3a", "#0a0a12"]), 6);
  limb(g, [[378, 296], [386, 400], [396, 480]], 42, lin(g, 0, 290, 0, 490, ["#2a2a3a", "#0a0a12"]), 6);
  for (const [x, rot] of [[296, -0.08], [408, 0.1]] as const) {
    ell(g, x, 490, 34, 14, rot);
    sticker(g, lin(g, 0, 476, 0, 504, ["#4a4a5e", "#0a0a12"]), 4);
  }
  ell(g, 168, 500, 22, 10);
  sticker(g, "#ffb0c0", 3);
  // Herr: Frack
  poly(g, [[326, 250], [284, 330], [318, 322], [304, 372], [372, 302]]);
  sticker(g, lin(g, 0, 250, 0, 372, ["#2a2a3a", "#0a0a12"]), 4);
  g.beginPath();
  g.moveTo(318, 178);
  g.quadraticCurveTo(352, 160, 394, 180);
  g.lineTo(398, 308);
  g.lineTo(322, 308);
  g.closePath();
  sticker(g, lin(g, 318, 0, 398, 0, ["#3a3a50", "#16161f", "#0a0a12"]), 6);
  poly(g, [[344, 178], [378, 178], [366, 290], [356, 290]]);
  fill(g, "#fafaff");
  bow(g, 361, 190, 11, "#e23a52", "#8a0a1e");
  ell(g, 386, 214, 8, 5);
  fill(g, "#e23a52");
  // Dame: Oberkörper
  g.beginPath();
  g.moveTo(166, 200);
  g.quadraticCurveTo(206, 188, 250, 204);
  g.lineTo(240, 296);
  g.lineTo(178, 296);
  g.closePath();
  sticker(g, lin(g, 166, 0, 250, 0, ["#ff5a72", "#c8102e", "#8a0a1e"]), 6);
  ell(g, 208, 206, 42, 16);
  sticker(g, skin(), 4);
  g.beginPath();
  g.moveTo(178, 208);
  g.quadraticCurveTo(208, 240, 240, 208);
  stroke(g, "rgba(255,255,255,0.8)", 4);
  for (let i = 0; i < 5; i += 1) sphere(g, 182 + i * 14, 216 + Math.sin((i / 4) * Math.PI) * 14, 3.6, ["#ffffff", "#e8f0ff", "#8ab0e8"], 0);
  // Arme: Hände oben verbunden
  limb(g, [[236, 214], [268, 168], [276, 126]], 26, skin(), 5);
  limb(g, [[344, 196], [312, 160], [284, 126]], 32, lin(g, 0, 120, 0, 200, ["#3a3a50", "#0a0a12"]), 5);
  ell(g, 280, 122, 16, 14);
  sticker(g, skin(), 4);
  limb(g, [[344, 244], [300, 262], [246, 270]], 30, lin(g, 0, 240, 0, 280, ["#3a3a50", "#0a0a12"]), 5);
  // Köpfe
  ell(g, 194, 132, 42, 44);
  sticker(g, skin(), 6);
  g.beginPath();
  g.moveTo(152, 132);
  g.quadraticCurveTo(150, 82, 200, 82);
  g.quadraticCurveTo(244, 84, 240, 128);
  g.quadraticCurveTo(220, 100, 190, 104);
  g.quadraticCurveTo(160, 108, 152, 132);
  g.closePath();
  sticker(g, lin(g, 0, 80, 0, 132, ["#8a5a30", "#4a2a12"]), 5);
  sphere(g, 196, 78, 22, ["#a8703c", "#6a4020", "#3a2010"], 4);
  g.beginPath();
  g.moveTo(166, 90);
  g.lineTo(178, 66);
  g.lineTo(190, 84);
  g.lineTo(202, 60);
  g.lineTo(214, 84);
  g.lineTo(226, 66);
  g.lineTo(236, 92);
  g.closePath();
  sticker(g, lin(g, 0, 60, 0, 92, GOLD), 3);
  sphere(g, 202, 62, 4.4, ["#ffffff", "#c8f0ff", "#5aa8e8"], 0);
  ell(g, 214, 132, 6, 8);
  fill(g, "#2a1a4a");
  ell(g, 216, 129, 2, 2);
  fill(g, "#ffffff");
  ell(g, 178, 150, 9, 6);
  fill(g, "rgba(255,110,130,0.45)");
  g.beginPath();
  g.arc(206, 146, 14, 0.2 * Math.PI, 0.8 * Math.PI);
  stroke(g, "#b0102e", 4);
  ell(g, 348, 116, 42, 44);
  sticker(g, skin(), 6);
  g.beginPath();
  g.moveTo(308, 116);
  g.quadraticCurveTo(306, 68, 352, 70);
  g.quadraticCurveTo(394, 72, 392, 110);
  g.quadraticCurveTo(376, 90, 344, 88);
  g.quadraticCurveTo(318, 94, 308, 116);
  g.closePath();
  sticker(g, lin(g, 0, 68, 0, 116, ["#3a2a20", "#0a0806"]), 5);
  ell(g, 326, 118, 6, 8);
  fill(g, "#2a1a4a");
  ell(g, 324, 115, 2, 2);
  fill(g, "#ffffff");
  ell(g, 306, 128, 5, 4);
  fill(g, "#ec9a70");
  g.beginPath();
  g.moveTo(312, 138);
  g.quadraticCurveTo(326, 134, 338, 138);
  stroke(g, "#0a0806", 4);
  g.beginPath();
  g.arc(328, 132, 12, 0.2 * Math.PI, 0.8 * Math.PI);
  stroke(g, "#8a2a2a", 3.4);
  glint4(g, 282, 104, 13, 0.9);
}

// --- Korken mit Schaum (fliegt nach rechts, Schweif links; Korken-Mitte bei (0.62|0.5)) ----------------------------------

function cork(g: Ctx2D): void {
  const r = mulberry(8);
  // Schaumwolke + Tropfen
  for (let i = 0; i < 16; i += 1) {
    const u = i / 15;
    const x = 12 + u * 110;
    const y = 88 + (r() - 0.5) * 84 * (0.4 + u);
    const rr0 = 8 + (1 - u) * 6 + r() * 14 * (0.5 + u);
    sphere(g, x, y, rr0, ["#ffffff", "#fff8e0", "#f0dca0"], 0);
    g.beginPath();
    g.arc(x, y, rr0, 0, TAU);
    stroke(g, "rgba(200,160,60,0.4)", 1.6);
  }
  for (let i = 0; i < 12; i += 1) {
    ell(g, 20 + r() * 110, 30 + r() * 116, 2.4 + r() * 3, 2.4 + r() * 3);
    fill(g, r() < 0.5 ? "#ffe27a" : "#fff8e0");
  }
  for (let i = 0; i < 3; i += 1) {
    g.beginPath();
    g.moveTo(112, 74 + i * 14);
    g.lineTo(30 - i * 6, 66 + i * 22);
    stroke(g, "rgba(255,240,190,0.7)", 3);
  }
  g.save();
  g.translate(159, 88);
  g.rotate(-0.18);
  // Korken (spitzes Ende vorn rechts, Kopf mit Drahtkorb links)
  g.beginPath();
  g.moveTo(-52, -34);
  g.lineTo(38, -28);
  g.quadraticCurveTo(56, -28, 56, 0);
  g.quadraticCurveTo(56, 28, 38, 28);
  g.lineTo(-52, 34);
  g.quadraticCurveTo(-64, 34, -64, 0);
  g.quadraticCurveTo(-64, -34, -52, -34);
  g.closePath();
  sticker(g, lin(g, 0, -34, 0, 34, ["#f4d8a0", "#d8a464", "#a8743a"]), 5);
  g.save();
  g.clip();
  const r2 = mulberry(4);
  for (let i = 0; i < 34; i += 1) {
    ell(g, -60 + r2() * 118, -32 + r2() * 64, 1.8 + r2() * 2.4, 1.2 + r2() * 1.6, r2() * 3);
    fill(g, r2() < 0.5 ? "rgba(110,60,20,0.4)" : "rgba(255,240,200,0.4)");
  }
  g.restore();
  g.beginPath();
  g.moveTo(-34, -33);
  g.lineTo(-34, 33);
  stroke(g, "rgba(90,50,10,0.5)", 3);
  // Drahtkorb + Folie
  g.beginPath();
  rr(g, -66, -36, 26, 72, 8);
  sticker(g, lin(g, -66, 0, -40, 0, GOLD_H), 4);
  g.beginPath();
  g.moveTo(-64, -20);
  g.lineTo(-42, 20);
  g.moveTo(-64, 20);
  g.lineTo(-42, -20);
  stroke(g, "rgba(90,50,8,0.55)", 2.4);
  g.restore();
  glint4(g, 178, 60, 11, 0.9);
}

// --- Champagnerflasche im Eiskübel (Hals neigt sich nach rechts → gespiegelt nach links; Hals bei (0.65|0.08)) -------------

function bottle(g: Ctx2D): void {
  shadowUnder(g, 138, 508, 116);
  g.save();
  g.translate(140, 400);
  g.rotate(0.07);
  g.translate(-140, -400);
  // Flasche
  g.beginPath();
  g.moveTo(88, 380);
  g.lineTo(88, 232);
  g.quadraticCurveTo(88, 170, 120, 130);
  g.lineTo(122, 74);
  g.lineTo(158, 74);
  g.lineTo(160, 130);
  g.quadraticCurveTo(192, 170, 192, 232);
  g.lineTo(192, 380);
  g.closePath();
  sticker(g, lin(g, 88, 0, 192, 0, [[0, "#0a2a14"], [0.3, "#2a8a48"], [0.55, "#1a5a2c"], [1, "#04140a"]]), 6);
  // Folie
  g.beginPath();
  g.moveTo(116, 130);
  g.lineTo(120, 72);
  g.lineTo(160, 72);
  g.lineTo(164, 130);
  g.quadraticCurveTo(140, 146, 116, 130);
  g.closePath();
  sticker(g, lin(g, 116, 0, 164, 0, GOLD_H), 4);
  g.beginPath();
  rr(g, 116, 42, 48, 34, 8);
  sticker(g, lin(g, 116, 0, 164, 0, GOLD_H), 4);
  for (let i = 0; i < 5; i += 1) {
    g.beginPath();
    g.moveTo(122 + i * 9, 44);
    g.lineTo(122 + i * 9, 74);
    stroke(g, "rgba(90,50,8,0.45)", 2, "butt");
  }
  // Etikett
  g.beginPath();
  rr(g, 96, 250, 88, 86, 10);
  sticker(g, lin(g, 0, 250, 0, 336, ["#fffaf0", "#e8dcc0"]), 4, "#5a4a2a");
  sphere(g, 140, 288, 22, ["#fff4b8", "#c48a14", "#6a3c04"], 3);
  g.beginPath();
  g.moveTo(112, 322);
  g.lineTo(168, 322);
  stroke(g, "#c48a14", 4);
  g.beginPath();
  g.moveTo(102, 168);
  g.quadraticCurveTo(100, 210, 102, 240);
  stroke(g, "rgba(255,255,255,0.55)", 8);
  g.restore();
  // Eiskübel
  g.beginPath();
  g.moveTo(24, 352);
  g.lineTo(254, 352);
  g.lineTo(224, 506);
  g.lineTo(54, 506);
  g.closePath();
  sticker(g, lin(g, 24, 0, 254, 0, [[0, "#7a829a"], [0.3, "#f8fafc"], [0.6, "#c4cad8"], [1, "#6a728a"]]), 6);
  g.beginPath();
  g.moveTo(40, 400);
  g.quadraticCurveTo(139, 420, 240, 400);
  stroke(g, "#e0a52a", 8);
  ell(g, 139, 352, 116, 18);
  sticker(g, lin(g, 0, 334, 0, 370, ["#eef4ff", "#9aa4bc"]), 5);
  for (const [x, y, s] of [[64, 344, 28], [100, 334, 32], [148, 338, 30], [196, 344, 30], [230, 350, 22], [124, 350, 24]] as const) {
    g.beginPath();
    rr(g, x - s / 2, y - s / 2, s, s, 7);
    sticker(g, lin(g, x - s / 2, y - s / 2, x + s / 2, y + s / 2, ["#ffffff", "#bfe4ff", "#7ab8f0"]), 2.6, "#3a4a8a");
    g.beginPath();
    g.moveTo(x - s * 0.3, y - s * 0.1);
    g.lineTo(x - s * 0.1, y - s * 0.3);
    stroke(g, "rgba(255,255,255,0.9)", 2.4);
  }
  for (const d of [-1, 1]) {
    ell(g, 139 + d * 122, 380, 12, 18);
    stroke(g, INK, 12);
    ell(g, 139 + d * 122, 380, 12, 18);
    stroke(g, "#e0a52a", 6);
  }
  glint4(g, 84, 420, 13, 0.8);
}

// --- Scheinwerfer (Objektiv rechts; wird gespiegelt → zeigt im Spiel nach links) ---------------------------------------------

function spotlight(g: Ctx2D): void {
  const cx = 158;
  shadowUnder(g, cx, 508, 130);
  // Stativ
  for (const [x1, w] of [[26, 14], [290, 14], [cx, 12]] as const) {
    g.beginPath();
    g.moveTo(cx, 396);
    g.lineTo(x1, 504);
    stroke(g, INK, w + 12);
    g.beginPath();
    g.moveTo(cx, 396);
    g.lineTo(x1, 504);
    stroke(g, lin(g, 0, 396, 0, 504, ["#8a92a8", "#2a2a3a"]), w);
  }
  g.beginPath();
  g.moveTo(52, 462);
  g.lineTo(264, 462);
  stroke(g, "#5a5a70", 6);
  // Mast
  g.beginPath();
  rr(g, cx - 12, 84, 24, 320, 8);
  sticker(g, lin(g, cx - 12, 0, cx + 12, 0, ["#4a4a5e", "#c8ced8", "#3a3a4e"]), 5);
  for (const y of [200, 300]) {
    g.beginPath();
    rr(g, cx - 18, y, 36, 14, 5);
    sticker(g, lin(g, 0, y, 0, y + 14, GOLD), 3);
  }
  // Lampengehäuse
  g.save();
  g.translate(cx, 52);
  g.rotate(0.08);
  g.beginPath();
  rr(g, -104, -40, 196, 86, 16);
  sticker(g, lin(g, 0, -40, 0, 46, ["#5a5a72", "#2a2a3a", "#12121c"]), 6);
  g.beginPath();
  g.moveTo(80, -46);
  g.lineTo(130, -62);
  g.lineTo(130, 68);
  g.lineTo(80, 52);
  g.closePath();
  sticker(g, lin(g, 80, 0, 130, 0, ["#3a3a4e", "#1a1a26"]), 5);
  ell(g, 128, 3, 22, 58);
  sticker(g, rad(g, 128, 3, 2, 128, 3, 58, ["#ffffff", "#fff4c0", "#ffd75e"]), 4);
  g.beginPath();
  g.moveTo(-96, -14);
  g.lineTo(60, -14);
  g.moveTo(-96, 6);
  g.lineTo(60, 6);
  g.moveTo(-96, 26);
  g.lineTo(60, 26);
  stroke(g, "rgba(0,0,0,0.45)", 4, "butt");
  g.beginPath();
  g.moveTo(-96, -30);
  g.lineTo(72, -30);
  stroke(g, "rgba(255,255,255,0.35)", 4);
  sphere(g, -96, 3, 18, ["#e8ecf4", "#8a92a6", "#3a3a4e"], 4);
  g.restore();
  ell(g, cx, 84, 18, 18);
  sticker(g, lin(g, 0, 66, 0, 102, GOLD), 4);
}

// --- Flügel (Tastatur links, Bank links; sitzt am Fuß der Zelle) ---------------------------------------------------------------

function piano(g: Ctx2D): void {
  shadowUnder(g, 300, 326, 210);
  // Beine des Flügels
  for (const x of [156, 306, 464]) {
    g.beginPath();
    g.moveTo(x - 10, 214);
    g.lineTo(x + 10, 214);
    g.lineTo(x + 7, 306);
    g.lineTo(x - 7, 306);
    g.closePath();
    sticker(g, lin(g, x - 10, 0, x + 10, 0, ["#3a3a50", "#0a0a12"]), 4);
    ell(g, x, 314, 12, 8);
    sticker(g, lin(g, 0, 306, 0, 322, GOLD), 3);
  }
  // Pedallyra
  g.beginPath();
  g.moveTo(216, 214);
  g.lineTo(216, 280);
  g.moveTo(260, 214);
  g.lineTo(260, 280);
  stroke(g, "#c48a14", 6);
  g.beginPath();
  rr(g, 208, 278, 60, 12, 5);
  sticker(g, lin(g, 0, 278, 0, 290, GOLD), 3);
  // Hocker links
  for (const x of [26, 88]) {
    g.beginPath();
    g.moveTo(x - 5, 250);
    g.lineTo(x + 5, 250);
    g.lineTo(x + 3, 316);
    g.lineTo(x - 3, 316);
    g.closePath();
    sticker(g, lin(g, x - 5, 0, x + 5, 0, GOLD_H), 3);
  }
  g.beginPath();
  rr(g, 6, 216, 104, 38, 14);
  sticker(g, lin(g, 0, 216, 0, 254, ["#ff5a72", "#c8102e", "#7a0a1e"]), 5);
  g.beginPath();
  g.moveTo(20, 226);
  g.lineTo(96, 226);
  stroke(g, "rgba(255,255,255,0.4)", 4);
  for (const x of [34, 58, 82]) sphere(g, x, 238, 4, ["#fff4b8", "#c48a14", "#6a3c04"], 0);
  // Deckel (aufgestellt) + Stütze
  g.beginPath();
  g.moveTo(148, 96);
  g.lineTo(440, 12);
  g.quadraticCurveTo(494, 8, 498, 60);
  g.lineTo(500, 110);
  g.lineTo(160, 118);
  g.closePath();
  sticker(g, lin(g, 0, 10, 0, 118, ["#5a5a72", "#22222e", "#0a0a12"]), 6);
  g.beginPath();
  g.moveTo(176, 100);
  g.lineTo(440, 24);
  stroke(g, "rgba(255,255,255,0.4)", 5);
  g.beginPath();
  g.moveTo(330, 116);
  g.lineTo(390, 174);
  stroke(g, INK, 14);
  g.beginPath();
  g.moveTo(330, 116);
  g.lineTo(390, 174);
  stroke(g, "#f4c94e", 7);
  // Korpus
  g.beginPath();
  g.moveTo(124, 120);
  g.lineTo(470, 108);
  g.quadraticCurveTo(508, 110, 506, 148);
  g.quadraticCurveTo(504, 190, 440, 202);
  g.lineTo(226, 214);
  g.lineTo(124, 214);
  g.closePath();
  sticker(g, lin(g, 0, 108, 0, 214, ["#4a4a62", "#1a1a26", "#0a0a12"]), 6);
  g.beginPath();
  g.moveTo(140, 130);
  g.lineTo(450, 122);
  stroke(g, "rgba(255,255,255,0.35)", 5);
  g.beginPath();
  g.moveTo(130, 208);
  g.lineTo(226, 208);
  g.lineTo(440, 196);
  stroke(g, "#e0a52a", 4);
  // Tastatur
  g.beginPath();
  rr(g, 60, 168, 96, 30, 6);
  sticker(g, lin(g, 0, 168, 0, 198, ["#fafaff", "#c8ccdc"]), 4);
  for (let i = 0; i < 9; i += 1) {
    g.beginPath();
    g.moveTo(72 + i * 10, 170);
    g.lineTo(72 + i * 10, 196);
    stroke(g, "rgba(0,0,0,0.3)", 1.6, "butt");
  }
  for (let i = 0; i < 7; i += 1) {
    if (i === 2 || i === 5) continue;
    g.beginPath();
    rr(g, 68 + i * 10 + 4, 168, 7, 17, 2);
    fill(g, "#0a0a12");
  }
  g.beginPath();
  rr(g, 124, 150, 40, 62, 8);
  sticker(g, lin(g, 0, 150, 0, 212, ["#4a4a62", "#0a0a12"]), 4);
  glint4(g, 420, 60, 18, 0.9);
  glint4(g, 200, 100, 12, 0.7);
}

// --- Notenmünze, Maske ----------------------------------------------------------------------------------------------------------

function note(g: Ctx2D): void {
  sphere(g, 128, 128, 118, ["#fff4b8", "#f4c94e", "#c48a14", "#8a5208"], 8);
  ell(g, 128, 128, 92, 92);
  stroke(g, "rgba(90,50,8,0.5)", 6);
  g.beginPath();
  g.arc(128, 128, 104, Math.PI * 1.05, Math.PI * 1.55);
  stroke(g, "rgba(255,255,255,0.7)", 8);
  // Achtelnote
  ell(g, 100, 166, 24, 18, -0.4);
  fill(g, "#3a1a04");
  g.beginPath();
  g.moveTo(120, 160);
  g.lineTo(120, 70);
  g.quadraticCurveTo(150, 84, 166, 110);
  stroke(g, "#3a1a04", 10, "butt");
  g.beginPath();
  g.moveTo(120, 160);
  g.lineTo(120, 72);
  stroke(g, "#3a1a04", 10, "butt");
  glint4(g, 84, 84, 16, 0.9);
}

function mask(g: Ctx2D): void {
  // Federn
  for (const [a, len, c0] of [[-0.9, 110, "#ffd75e"], [-0.6, 128, "#e23a52"], [-0.3, 104, "#ffd75e"]] as const) {
    g.save();
    g.translate(196, 92);
    g.rotate(a - 0.5);
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(len * 0.5, -22, len, 0);
    g.quadraticCurveTo(len * 0.5, 22, 0, 0);
    g.closePath();
    sticker(g, lin(g, 0, 0, len, 0, [c0, "#ffffff"]), 3);
    g.restore();
  }
  // Maske
  g.beginPath();
  g.moveTo(14, 128);
  g.quadraticCurveTo(30, 70, 100, 84);
  g.quadraticCurveTo(128, 100, 156, 84);
  g.quadraticCurveTo(226, 70, 240, 128);
  g.quadraticCurveTo(226, 190, 170, 178);
  g.quadraticCurveTo(140, 168, 128, 150);
  g.quadraticCurveTo(116, 168, 86, 178);
  g.quadraticCurveTo(30, 190, 14, 128);
  g.closePath();
  sticker(g, lin(g, 0, 70, 0, 190, ["#f0405a", "#b0102e", "#6a0618"]), 7);
  for (const x of [72, 184]) {
    ell(g, x, 126, 26, 18, x < 128 ? 0.25 : -0.25);
    sticker(g, "#12060a", 4, "#ffd75e");
  }
  g.beginPath();
  g.moveTo(34, 108);
  g.quadraticCurveTo(60, 92, 96, 100);
  g.moveTo(220, 108);
  g.quadraticCurveTo(194, 92, 158, 100);
  stroke(g, "#ffd75e", 5);
  for (const [x, y] of [[44, 140], [58, 158], [212, 140], [198, 158], [128, 106]]) sphere(g, x, y, 5, ["#fffbe0", "#f4c94e", "#8a5208"], 0);
  g.beginPath();
  g.moveTo(112, 118);
  g.quadraticCurveTo(128, 132, 144, 118);
  stroke(g, "#ffd75e", 5);
  glint4(g, 60, 96, 14, 0.9);
}

// --- Verzeichnis -----------------------------------------------------------------------------------------------------------------

export const OPER_FALLBACK: Record<string, Fallback> = {
  "oper-cakecart": { w: 507, h: 512, paint: cakecart },
  "oper-harp": { w: 303, h: 512, paint: harp },
  "oper-bouquet": { w: 479, h: 512, paint: bouquet },
  "oper-champagne": { w: 310, h: 512, paint: champagne },
  "oper-rope": { w: 512, h: 397, paint: rope },
  "oper-drape": { w: 512, h: 222, paint: drape },
  "oper-chandelier": { w: 432, h: 512, paint: chandelier },
  "oper-waiter": { w: 512, h: 498, paint: waiter },
  "oper-dancers": { w: 491, h: 512, paint: dancers },
  "oper-cork": { w: 256, h: 175, paint: cork },
  "oper-bottle": { w: 276, h: 512, paint: bottle },
  "oper-spotlight": { w: 317, h: 512, paint: spotlight },
  "oper-piano": { w: 512, h: 330, paint: piano },
  "oper-note": { w: 255, h: 256, paint: note },
  "oper-mask": { w: 253, h: 256, paint: mask },
};
