/**
 * Christkindlmarkt – prozedurale Ersatz-Props. Fehlen die gemalten Props (Netzfehler, Blocker, veralteter Manifest-Cache),
 * zeichnet `SpriteCache` stattdessen diese Vektor-Bilder: dieselben Maße wie die Prop-Zellen, dieselbe Blickrichtung und
 * dieselben Ankerpunkte (Augen, Schneeball-Hand, Glöckchen), damit alle Animationen des Skins unverändert greifen.
 * Alles entsteht EINMAL beim Backen des Sprites (Offscreen-Canvas); pro Frame bleibt ein einziges drawImage.
 */
import { makeCanvas, roundRect } from "../../draw-utils";
import type { Ctx2D } from "../shared-b/canvas";
import { mulberry } from "../shared-b/color";

const TAU = Math.PI * 2;
const INK = "#1a1030";

export interface Fallback {
  /** Zellenmaße (wie das Prop-Manifest) – bestimmen das Seitenverhältnis */
  w: number;
  h: number;
  paint: (g: Ctx2D, w: number, h: number) => void;
  /** Lichtpunkte (Promille x, y, r) für das Funkeln; fehlt → keins */
  lights?: number[];
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

function ell(g: Ctx2D, cx: number, cy: number, rx: number, ry: number, rot = 0): void {
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, rot, 0, TAU);
}

/** Aufkleber-Look: Umriss außen (lw px breit), Füllung darüber */
function sticker(g: Ctx2D, fill: string | CanvasGradient, lw = 8, ink = INK): void {
  g.lineJoin = "round";
  g.lineCap = "round";
  g.strokeStyle = ink;
  g.lineWidth = lw * 2;
  g.stroke();
  g.fillStyle = fill;
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

/** Kugel mit Lichtpunkt oben links */
function sphere(g: Ctx2D, cx: number, cy: number, r: number, s: Stop[], lw = 0): void {
  ell(g, cx, cy, r, r);
  const f = rad(g, cx - r * 0.35, cy - r * 0.4, r * 0.06, cx, cy, r * 1.05, s);
  if (lw > 0) sticker(g, f, lw);
  else fill(g, f);
}

/** Linienzug mit Umriss (Gliedmaßen, Äste) */
function limb(g: Ctx2D, pts: Array<[number, number]>, lw: number, color: string | CanvasGradient, ol = 8, ink = INK): void {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  stroke(g, ink, lw + ol * 2);
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  stroke(g, color, lw);
}

function star(g: Ctx2D, cx: number, cy: number, r: number, inner = 0.45, rot = -Math.PI / 2, n = 5): void {
  g.beginPath();
  for (let i = 0; i < n * 2; i += 1) {
    const a = rot + (i * Math.PI) / n;
    const rr2 = i % 2 ? r * inner : r;
    if (i === 0) g.moveTo(cx + Math.cos(a) * rr2, cy + Math.sin(a) * rr2);
    else g.lineTo(cx + Math.cos(a) * rr2, cy + Math.sin(a) * rr2);
  }
  g.closePath();
}

/** Schleife: zwei Schlaufen, Knoten, zwei Enden (Mitte = cx, cy; Größe s) */
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
    g.beginPath();
    g.moveTo(cx + d * s * 0.35, cy - s * 0.15);
    g.quadraticCurveTo(cx + d * s * 1.0, cy - s * 0.55, cx + d * s * 1.3, cy - s * 0.1);
    stroke(g, "rgba(255,255,255,0.4)", Math.max(1.5, s * 0.1));
  }
  ell(g, cx, cy + s * 0.1, s * 0.34, s * 0.34);
  sticker(g, lin(g, cx - s * 0.3, cy - s * 0.3, cx + s * 0.3, cy + s * 0.4, [c0, c1]), lw);
}

/** Schneehäubchen: weiche Kuppen entlang einer Linie (x0 … x1, Oberkante y) */
function snowCap(g: Ctx2D, x0: number, x1: number, y: number, bump: number, drip = 0, seed = 1): void {
  const r = mulberry(seed);
  g.beginPath();
  g.moveTo(x0, y + bump * 0.6);
  const n = Math.max(2, Math.round((x1 - x0) / (bump * 2.4)));
  const step = (x1 - x0) / n;
  for (let i = 0; i < n; i += 1) {
    const xa = x0 + i * step;
    g.bezierCurveTo(xa + step * 0.1, y - bump * (0.7 + r() * 0.5), xa + step * 0.9, y - bump * (0.7 + r() * 0.5), xa + step, y + bump * 0.5);
  }
  g.lineTo(x1, y + bump * 0.9 + drip);
  for (let i = n - 1; i >= 0; i -= 1) {
    const xa = x0 + i * step;
    const dv = drip * (0.3 + r() * 0.9);
    g.quadraticCurveTo(xa + step * 0.75, y + bump * 1.1 + dv, xa + step * 0.5, y + bump * 0.8 + dv * 0.4);
    g.quadraticCurveTo(xa + step * 0.25, y + bump * 0.8, xa, y + bump * 0.9);
  }
  g.closePath();
  sticker(g, lin(g, 0, y - bump, 0, y + bump * 1.4 + drip, ["#ffffff", "#e4eeff", "#b9cdf2"]), Math.max(3, bump * 0.22), "#3a4a86");
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

/** Schräg gestreifte Fläche: `shape` legt den Pfad an, Streifen (Farbe c) werden hineingeklippt */
function stripes(g: Ctx2D, shape: () => void, w: number, h: number, c: string, period: number, ang: number, width = period / 2): void {
  g.save();
  shape();
  g.clip();
  g.translate(w / 2, h / 2);
  g.rotate(ang);
  g.fillStyle = c;
  const span = Math.hypot(w, h);
  for (let x = -span; x < span; x += period) g.fillRect(x, -span, width, span * 2);
  g.restore();
}

// --- Schneemann -----------------------------------------------------------------------------------------------

function snowman(g: Ctx2D): void {
  const cx = 167;
  // Schneehaufen
  ell(g, cx, 498, 150, 22);
  fill(g, lin(g, 0, 478, 0, 520, ["#ffffff", "#c2d4f4"]));
  // Stockarme (hinter dem Körper)
  const twig = (pts: Array<[number, number]>, lw: number): void => limb(g, pts, lw, lin(g, 0, 150, 0, 300, ["#a06a36", "#6a4020"]), 5);
  twig([[95, 262], [50, 226], [14, 196]], 13);
  twig([[42, 218], [30, 176]], 9);
  twig([[36, 214], [8, 232]], 8);
  twig([[240, 262], [284, 232], [322, 214]], 13);
  twig([[292, 226], [312, 178]], 9);
  twig([[300, 224], [330, 248]], 8);
  // Körper
  const snowFill = (x: number, y: number, r: number): CanvasGradient => rad(g, x - r * 0.35, y - r * 0.42, r * 0.08, x, y, r * 1.08, [[0, "#ffffff"], [0.5, "#eef4ff"], [0.85, "#b9cdf2"], [1, "#94aadd"]]);
  const ball = (x: number, y: number, r: number): void => {
    ell(g, x, y, r, r);
    sticker(g, snowFill(x, y, r), 8);
    g.beginPath();
    g.arc(x, y, r - 13, Math.PI * 1.02, Math.PI * 1.46);
    stroke(g, "rgba(255,255,255,0.85)", 7);
    g.beginPath();
    g.arc(x, y, r - 10, -0.12 * Math.PI, 0.42 * Math.PI);
    stroke(g, "rgba(80,110,190,0.22)", 12);
  };
  ball(cx, 378, 128);
  ball(cx, 250, 96);
  // Knöpfe auf dem Bauch
  for (const by of [268, 308, 348]) {
    sphere(g, cx + 4, by, 10, ["#6a6a86", "#1c1830", "#0a0816"], 0);
    glint4(g, cx + 1, by - 3, 4, 0.9);
  }
  ball(cx, 148, 72);
  // Schal
  g.beginPath();
  g.moveTo(96, 204);
  g.quadraticCurveTo(cx, 250, 238, 204);
  stroke(g, INK, 52);
  g.beginPath();
  g.moveTo(96, 204);
  g.quadraticCurveTo(cx, 250, 238, 204);
  stroke(g, lin(g, 0, 190, 0, 240, ["#f05a5a", "#c81e2e", "#8a0e1c"]), 36);
  for (const u of [0.14, 0.34, 0.54, 0.74, 0.92]) {
    const x = 96 + 142 * u;
    const y = 204 + 2 * (1 - u) * u * 46 * 1.1;
    g.beginPath();
    g.moveTo(x - 4, y - 16);
    g.lineTo(x + 4, y + 16);
    stroke(g, "#fff4ea", 8, "butt");
  }
  g.beginPath();
  g.moveTo(206, 218);
  g.lineTo(250, 204);
  g.lineTo(272, 326);
  g.lineTo(232, 336);
  g.closePath();
  sticker(g, lin(g, 0, 210, 0, 336, ["#e23a48", "#a3121f"]), 6);
  for (const t of [0.3, 0.6]) {
    g.beginPath();
    g.moveTo(206 + 26 * t + 4, 218 + 118 * t - 10);
    g.lineTo(250 + 22 * t + 6, 204 + 122 * t - 4);
    stroke(g, "#fff4ea", 9, "butt");
  }
  for (let i = 0; i < 4; i += 1) {
    g.beginPath();
    g.moveTo(234 + i * 9, 336 - i * 2.4);
    g.lineTo(233 + i * 9, 350 - i * 2.4);
    stroke(g, "#c81e2e", 4);
  }
  // Zylinder
  ell(g, cx, 84, 76, 18);
  sticker(g, lin(g, 0, 70, 0, 100, ["#3c3a56", "#111020"]), 6);
  g.beginPath();
  g.moveTo(cx - 47, 24);
  g.lineTo(cx - 47, 84);
  g.quadraticCurveTo(cx, 100, cx + 47, 84);
  g.lineTo(cx + 47, 24);
  g.closePath();
  sticker(g, lin(g, cx - 47, 0, cx + 47, 0, ["#4a4868", "#1c1a2e", "#0c0b18"]), 6);
  g.beginPath();
  g.moveTo(cx - 47, 62);
  g.quadraticCurveTo(cx, 80, cx + 47, 62);
  g.lineTo(cx + 47, 84);
  g.quadraticCurveTo(cx, 100, cx - 47, 84);
  g.closePath();
  fill(g, lin(g, 0, 60, 0, 96, ["#e23a48", "#8a0e1c"]));
  ell(g, cx, 24, 47, 13);
  sticker(g, lin(g, cx - 47, 0, cx + 47, 0, ["#5a5878", "#2a2840"]), 6);
  g.beginPath();
  g.moveTo(cx - 32, 34);
  g.lineTo(cx - 32, 78);
  stroke(g, "rgba(255,255,255,0.28)", 7);
  // Gesicht (blickt nach links, zur Figur)
  for (const ex of [138, 180]) {
    ell(g, ex, 128, 8.5, 9.5);
    fill(g, INK);
    ell(g, ex - 2.5, 124, 2.6, 3);
    fill(g, "#ffffff");
  }
  ell(g, 124, 150, 12, 8);
  fill(g, "rgba(255,110,140,0.38)");
  ell(g, 190, 148, 12, 8);
  fill(g, "rgba(255,110,140,0.38)");
  g.beginPath();
  g.moveTo(154, 144);
  g.lineTo(88, 164);
  g.lineTo(154, 170);
  g.closePath();
  sticker(g, lin(g, 88, 140, 154, 175, ["#ffbd55", "#f27a1a", "#c94a08"]), 4);
  g.beginPath();
  g.moveTo(140, 152);
  g.lineTo(122, 160);
  g.moveTo(130, 160);
  g.lineTo(110, 165);
  stroke(g, "rgba(120,40,0,0.5)", 2.5);
  for (let i = 0; i < 5; i += 1) {
    const a = 0.24 * Math.PI + i * 0.15 * Math.PI;
    ell(g, 154 + Math.cos(a) * 40, 152 + Math.sin(a) * 34, 5.2, 5.2);
    fill(g, INK);
  }
}

// --- Geschenkstapel -------------------------------------------------------------------------------------------

function giftBox(g: Ctx2D, x: number, y: number, w: number, h: number, base: string, dark: string, light: string, rib: string, ribDark: string, pat: "dots" | "stripes" | "flakes", tilt: number): void {
  g.save();
  g.translate(x + w / 2, y + h);
  g.rotate(tilt);
  g.translate(-w / 2, -h);
  rr(g, 0, 0, w, h, 8);
  sticker(g, lin(g, 0, 0, w, h, [light, base, dark]), 7);
  g.save();
  rr(g, 0, 0, w, h, 8);
  g.clip();
  g.fillStyle = "rgba(255,255,255,0.5)";
  g.strokeStyle = "rgba(255,255,255,0.4)";
  if (pat === "dots") {
    for (let j = 0; j * 24 < h + 20; j += 1) for (let i = 0; i * 28 < w + 20; i += 1) {
      ell(g, i * 28 + (j % 2) * 14, j * 24 + 12, 4.2, 4.2);
      g.fill();
    }
  } else if (pat === "stripes") {
    g.lineWidth = 8;
    for (let k = -h; k < w; k += 26) {
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k + h, h);
      g.stroke();
    }
  } else {
    g.lineWidth = 3.4;
    g.lineCap = "round";
    for (let j = 0; j * 30 < h + 20; j += 1) for (let i = 0; i * 34 < w + 20; i += 1) {
      const cx = i * 34 + (j % 2) * 17 + 10;
      const cy = j * 30 + 14;
      g.beginPath();
      for (let a = 0; a < 3; a += 1) {
        g.moveTo(cx + Math.cos((a * Math.PI) / 3) * 7, cy + Math.sin((a * Math.PI) / 3) * 7);
        g.lineTo(cx - Math.cos((a * Math.PI) / 3) * 7, cy - Math.sin((a * Math.PI) / 3) * 7);
      }
      g.stroke();
    }
  }
  // Band
  g.fillStyle = lin(g, w / 2 - 15, 0, w / 2 + 15, 0, [ribDark, rib, rib, ribDark]);
  g.fillRect(w / 2 - 15, 0, 30, h);
  g.fillStyle = "rgba(255,255,255,0.32)";
  g.fillRect(8, 8, 6, h - 16);
  g.fillStyle = "rgba(0,0,0,0.18)";
  g.fillRect(w - 12, 6, 12, h);
  g.restore();
  // Deckel
  const lh = Math.max(20, h * 0.27);
  rr(g, -7, -7, w + 14, lh + 7, 7);
  sticker(g, lin(g, 0, 0, w, lh, [light, base, dark]), 6);
  g.fillStyle = lin(g, w / 2 - 17, 0, w / 2 + 17, 0, [ribDark, rib, rib, ribDark]);
  g.fillRect(w / 2 - 17, -7, 34, lh + 7);
  g.fillStyle = "rgba(255,255,255,0.4)";
  g.fillRect(2, -4, w - 4, 4);
  g.fillStyle = "rgba(0,0,0,0.22)";
  g.fillRect(-3, lh, w + 6, 5);
  g.restore();
}

function presents(g: Ctx2D): void {
  giftBox(g, 15, 388, 212, 124, "#d6303e", "#8f1424", "#ff6a70", "#fff6ea", "#d9c9b0", "dots", -0.012);
  bow(g, 121, 410, 13, "#fff6ea", "#cdbba0");
  giftBox(g, 30, 284, 184, 106, "#1f9a4d", "#0d5c2c", "#4fd47c", "#ffd24a", "#c48a10", "stripes", 0.02);
  giftBox(g, 44, 194, 158, 92, "#2f6fe0", "#173f95", "#6aa2ff", "#e23a48", "#8f1424", "flakes", -0.024);
  bow(g, 129, 211, 12, "#e23a48", "#8f1424");
  giftBox(g, 56, 118, 134, 78, "#8a3fc2", "#4b1a7c", "#c28aee", "#ffd24a", "#c48a10", "dots", 0.018);
  giftBox(g, 70, 56, 108, 64, "#e23a48", "#8f1424", "#ff8a8e", "#2fa14f", "#146a30", "stripes", -0.016);
  snowCap(g, 62, 186, 54, 11, 12, 5);
  bow(g, 124, 44, 24, "#39b866", "#146a30");
  // Stechpalmenzweig
  for (const d of [-1, 1]) {
    g.beginPath();
    g.moveTo(148, 50);
    g.quadraticCurveTo(148 + d * 20, 30, 148 + d * 36, 50);
    g.quadraticCurveTo(148 + d * 20, 58, 148, 50);
    sticker(g, "#2a8a44", 3);
  }
  for (const [bx, by] of [[150, 51], [158, 47], [154, 57]]) sphere(g, bx, by, 5.5, ["#ff8a8a", "#d81e2e", "#7a0a14"], 1.5);
}

// --- Christbaum -----------------------------------------------------------------------------------------------

function tree(g: Ctx2D): void {
  const cx = 145;
  // Fass
  g.beginPath();
  g.moveTo(84, 428);
  g.quadraticCurveTo(70, 470, 86, 510);
  g.lineTo(204, 510);
  g.quadraticCurveTo(220, 470, 206, 428);
  g.closePath();
  sticker(g, lin(g, 70, 0, 220, 0, ["#5a3016", "#b0743c", "#e0a468", "#a06430", "#4a2410"]), 7);
  g.save();
  g.clip();
  for (const x of [104, 125, 145, 165, 186]) {
    g.beginPath();
    g.moveTo(x, 428);
    g.lineTo(x, 512);
    stroke(g, "rgba(40,16,4,0.5)", 2.5, "butt");
  }
  for (const y of [446, 492]) {
    g.beginPath();
    g.moveTo(60, y);
    g.quadraticCurveTo(cx, y + 12, 230, y);
    stroke(g, "#2a1a24", 12, "butt");
    g.beginPath();
    g.moveTo(60, y);
    g.quadraticCurveTo(cx, y + 12, 230, y);
    stroke(g, "#e8b64a", 5, "butt");
  }
  g.restore();
  ell(g, cx, 430, 66, 12);
  sticker(g, lin(g, 0, 418, 0, 442, ["#ffffff", "#c9d9f6"]), 4, "#3a4a86");
  // Etagen (unten → oben)
  const tier = (apex: number, base: number, hw: number, sc: number): void => {
    g.beginPath();
    g.moveTo(cx, apex);
    g.quadraticCurveTo(cx + hw * 0.32, apex + (base - apex) * 0.5, cx + hw, base - 14);
    for (let i = 0; i < sc; i += 1) {
      const x0 = cx + hw - (i * 2 * hw) / sc;
      const x1 = cx + hw - ((i + 1) * 2 * hw) / sc;
      g.quadraticCurveTo((x0 + x1) / 2, base + 18, x1, base - 14);
    }
    g.quadraticCurveTo(cx - hw * 0.32, apex + (base - apex) * 0.5, cx, apex);
    g.closePath();
    sticker(g, lin(g, cx - hw, 0, cx + hw, 0, [[0, "#52c46a"], [0.4, "#238a48"], [1, "#0a4a26"]]), 7);
    // Zweige
    g.save();
    g.clip();
    for (let j = 0; j < 3; j += 1) {
      const y = apex + (base - apex) * (0.28 + j * 0.24);
      const hwj = hw * ((y - apex) / (base - apex));
      for (const d of [-1, 1]) {
        g.beginPath();
        g.moveTo(cx, y - 6);
        g.quadraticCurveTo(cx + d * hwj * 0.55, y - 2, cx + d * hwj * 1.02, y + 22);
        stroke(g, "rgba(10,60,30,0.45)", 7);
        g.beginPath();
        g.moveTo(cx, y - 11);
        g.quadraticCurveTo(cx + d * hwj * 0.55, y - 7, cx + d * hwj * 1.02, y + 16);
        stroke(g, "rgba(150,240,150,0.4)", 4);
      }
    }
    g.restore();
    // Schnee auf den Zacken
    for (let i = 0; i < sc; i += 1) {
      const x = cx - hw + ((i + 0.5) * 2 * hw) / sc;
      ell(g, x, base - 12, (hw / sc) * 0.62, 7);
      fill(g, "#f4f8ff");
    }
  };
  tier(258, 442, 138, 5);
  tier(178, 352, 118, 4);
  tier(102, 264, 94, 4);
  tier(34, 176, 68, 3);
  // Lichterkette
  g.setLineDash([1, 15]);
  for (const [y0, hw] of [[338, 100], [250, 78], [162, 54]] as const) {
    g.beginPath();
    g.moveTo(cx - hw, y0 - 8);
    g.quadraticCurveTo(cx, y0 + 34, cx + hw, y0 - 8);
    stroke(g, "#ffe27a", 8);
  }
  g.setLineDash([]);
  // Kugeln
  const balls: Array<[number, number, string, string]> = [
    [98, 396, "#ff6a70", "#a3121f"],
    [190, 410, "#ffe27a", "#c48a10"],
    [146, 330, "#7aa8ff", "#1f3f95"],
    [90, 312, "#ffe27a", "#c48a10"],
    [204, 314, "#ff6a70", "#a3121f"],
    [126, 246, "#ff9ad0", "#b0206a"],
    [176, 238, "#7aa8ff", "#1f3f95"],
    [104, 168, "#ffe27a", "#c48a10"],
    [160, 176, "#ff6a70", "#a3121f"],
    [146, 100, "#7aa8ff", "#1f3f95"],
  ];
  for (const [bx, by, c0, c1] of balls) {
    sphere(g, bx, by, 14, ["#ffffff", c0, c1], 3);
    g.fillStyle = "#e8b64a";
    g.fillRect(bx - 3.5, by - 19, 7, 6);
    ell(g, bx - 4.5, by - 5, 3.4, 4.4, -0.6);
    fill(g, "rgba(255,255,255,0.85)");
  }
  // Stern
  star(g, cx, 26, 32, 0.46);
  sticker(g, lin(g, cx - 30, 0, cx + 30, 60, ["#fff2a0", "#ffc21a", "#d88a0a"]), 4, "#5a3a08");
  star(g, cx - 3, 24, 13, 0.5);
  fill(g, "rgba(255,255,255,0.55)");
}

// --- Zuckerstangen-Zaun ---------------------------------------------------------------------------------------

function candycane(g: Ctx2D, w: number, h: number): void {
  const xs = [104, 256, 408];
  const path = (cx: number): void => {
    g.beginPath();
    g.moveTo(cx, 350);
    g.lineTo(cx, 112);
    g.arc(cx + 44, 112, 44, Math.PI, 0, false);
    g.lineTo(cx + 88, 146);
  };
  // Schneehaufen + Zaunlatte
  ell(g, w / 2, 378, 246, 20);
  fill(g, lin(g, 0, 356, 0, 400, ["#ffffff", "#bcd0f2"]));
  g.beginPath();
  rr(g, 30, 262, w - 60, 34, 8);
  sticker(g, lin(g, 0, 262, 0, 296, ["#b8824a", "#7a4a22"]), 6);
  g.beginPath();
  g.moveTo(44, 274);
  g.lineTo(w - 44, 274);
  stroke(g, "rgba(255,255,255,0.28)", 4);
  // Umrisse
  for (const x of xs) {
    path(x);
    stroke(g, INK, 62);
  }
  // Stangen auf Zwischenleinwand (rot-weiß gestreift)
  const t = makeCanvas(w, h);
  const tg = t.getContext("2d");
  if (tg) {
    tg.lineCap = "round";
    tg.lineJoin = "round";
    tg.strokeStyle = "#fffaf4";
    tg.lineWidth = 46;
    for (const x of xs) {
      tg.beginPath();
      tg.moveTo(x, 350);
      tg.lineTo(x, 112);
      tg.arc(x + 44, 112, 44, Math.PI, 0, false);
      tg.lineTo(x + 88, 146);
      tg.stroke();
    }
    tg.globalCompositeOperation = "source-atop";
    tg.save();
    tg.translate(w / 2, h / 2);
    tg.rotate(-0.62);
    tg.fillStyle = "#d8283a";
    for (let x = -600; x < 600; x += 50) tg.fillRect(x, -600, 25, 1200);
    tg.restore();
    // Schattierung rechts, Glanz links
    tg.fillStyle = "rgba(60,0,30,0.22)";
    for (const x of xs) tg.fillRect(x + 8, 100, 16, 260);
    tg.fillStyle = "rgba(255,255,255,0.32)";
    for (const x of xs) tg.fillRect(x - 17, 112, 8, 240);
    g.drawImage(t, 0, 0);
  }
  for (const x of xs) {
    g.beginPath();
    g.arc(x + 44, 112, 33, Math.PI * 1.08, Math.PI * 1.7);
    stroke(g, "rgba(255,255,255,0.7)", 6);
  }
  // Schleifen mit Beeren
  for (const x of xs) {
    bow(g, x, 236, 17, "#39b866", "#146a30");
    for (const [bx, by] of [[x - 6, 252], [x + 5, 254]]) sphere(g, bx, by, 6, ["#ff8a8a", "#d81e2e", "#7a0a14"], 2);
  }
  // Schnee am Fuß
  snowCap(g, 20, w - 20, 346, 12, 10, 9);
}

// --- Eisblock -------------------------------------------------------------------------------------------------

function iceblock(g: Ctx2D): void {
  ell(g, 230, 494, 214, 20);
  fill(g, lin(g, 0, 474, 0, 516, ["#ffffff", "#bcd0f2"]));
  const front: Array<[number, number]> = [[64, 226], [92, 200], [338, 200], [352, 214], [352, 470], [326, 486], [78, 486], [64, 470]];
  const top: Array<[number, number]> = [[92, 200], [170, 112], [420, 112], [446, 138], [352, 214], [338, 200]];
  const side: Array<[number, number]> = [[352, 214], [446, 138], [446, 400], [352, 470]];
  const poly = (p: Array<[number, number]>): void => {
    g.beginPath();
    p.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
  };
  for (const p of [front, top, side]) {
    poly(p);
    stroke(g, INK, 26);
  }
  poly(side);
  fill(g, lin(g, 352, 140, 446, 470, ["#4fb0ee", "#2a72bc", "#1c4f94"]));
  poly(top);
  fill(g, lin(g, 130, 112, 420, 214, ["#ffffff", "#d2f4ff", "#9ee0fa"]));
  poly(front);
  fill(g, lin(g, 64, 200, 340, 486, ["#e2f8ff", "#9fe0ff", "#4eb2ee", "#2f86cc"]));
  // Innenleben: Facetten, Streifen, Risse
  g.save();
  poly(front);
  g.clip();
  g.fillStyle = "rgba(255,255,255,0.34)";
  for (const [x, wd] of [[100, 26], [150, 12], [262, 18]]) {
    g.beginPath();
    g.moveTo(x, 200);
    g.lineTo(x + wd, 200);
    g.lineTo(x + wd - 90, 486);
    g.lineTo(x - 90, 486);
    g.closePath();
    g.fill();
  }
  g.beginPath();
  g.moveTo(64, 400);
  g.lineTo(200, 330);
  g.lineTo(352, 420);
  g.lineTo(352, 486);
  g.lineTo(64, 486);
  g.closePath();
  fill(g, "rgba(20,90,170,0.22)");
  g.restore();
  g.strokeStyle = "rgba(255,255,255,0.85)";
  g.lineWidth = 3.4;
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(250, 486);
  g.lineTo(236, 430);
  g.lineTo(262, 384);
  g.lineTo(244, 340);
  g.moveTo(236, 430);
  g.lineTo(200, 410);
  g.moveTo(262, 384);
  g.lineTo(300, 372);
  g.stroke();
  g.strokeStyle = "rgba(30,80,150,0.5)";
  g.lineWidth = 2.4;
  g.beginPath();
  g.moveTo(252, 486);
  g.lineTo(238, 430);
  g.lineTo(264, 384);
  g.stroke();
  for (const [bx, by, br] of [[130, 440, 11], [170, 458, 6], [112, 400, 5], [300, 300, 8], [318, 340, 5]]) {
    ell(g, bx, by, br, br);
    stroke(g, "rgba(255,255,255,0.7)", 2.6);
    ell(g, bx - br * 0.3, by - br * 0.3, br * 0.25, br * 0.25);
    fill(g, "rgba(255,255,255,0.8)");
  }
  // Kantenlicht
  g.strokeStyle = "rgba(255,255,255,0.9)";
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(96, 204);
  g.lineTo(338, 204);
  g.lineTo(350, 216);
  g.moveTo(74, 224);
  g.lineTo(74, 466);
  g.stroke();
  g.beginPath();
  g.moveTo(178, 118);
  g.lineTo(414, 118);
  stroke(g, "rgba(255,255,255,0.95)", 4);
  g.beginPath();
  g.moveTo(354, 226);
  g.lineTo(354, 464);
  stroke(g, "rgba(150,220,255,0.7)", 3);
  // Schnee + Glitzer
  snowCap(g, 170, 420, 116, 9, 9, 21);
  glint4(g, 296, 250, 26);
  glint4(g, 116, 270, 16, 0.9);
  glint4(g, 396, 190, 14, 0.8);
}

// --- Marktstand -----------------------------------------------------------------------------------------------

function stallGoods(g: Ctx2D): void {
  const r = mulberry(77);
  // Regale
  for (const y of [258, 338]) {
    g.beginPath();
    rr(g, 76, y, 360, 12, 3);
    sticker(g, lin(g, 0, y, 0, y + 12, ["#c48a50", "#7a4a22"]), 3);
  }
  const cols = BULBS;
  // obere Reihe: Kugeln, Lebkuchenherzen, Sterne
  for (let i = 0; i < 8; i += 1) {
    const x = 100 + i * 45;
    const k = i % 3;
    if (k === 0) sphere(g, x, 234, 15, ["#ffffff", cols[Math.floor(r() * 5)], "#3a1a30"], 2.4);
    else if (k === 1) {
      g.beginPath();
      g.moveTo(x, 252);
      g.bezierCurveTo(x - 24, 234, x - 14, 214, x, 226);
      g.bezierCurveTo(x + 14, 214, x + 24, 234, x, 252);
      sticker(g, "#b8692d", 2.6);
      g.beginPath();
      g.moveTo(x, 246);
      g.bezierCurveTo(x - 16, 232, x - 9, 220, x, 228);
      stroke(g, "rgba(255,255,255,0.8)", 2);
    } else {
      star(g, x, 234, 17, 0.5);
      sticker(g, lin(g, x - 14, 220, x + 14, 250, ["#fff2a0", "#e8a80c"]), 2.4, "#5a3a08");
    }
  }
  // untere Reihe: Tassen, Kerzen, Plätzchen
  for (let i = 0; i < 6; i += 1) {
    const x = 104 + i * 64;
    if (i % 2 === 0) {
      rr(g, x - 16, 300, 30, 38, 6);
      sticker(g, lin(g, x - 16, 0, x + 14, 0, ["#fff8ee", "#e2d2b8"]), 2.6);
      g.beginPath();
      g.arc(x + 14, 318, 9, -1.3, 1.3);
      stroke(g, INK, 6);
      ell(g, x - 1, 320, 6, 6);
      fill(g, "#d81e2e");
      ell(g, x - 1, 301, 14, 4);
      fill(g, "#7a1028");
    } else {
      rr(g, x - 8, 296, 16, 42, 4);
      sticker(g, lin(g, x - 8, 0, x + 8, 0, ["#fff4e0", "#e8d4a8"]), 2.6);
      g.beginPath();
      g.moveTo(x, 292);
      g.quadraticCurveTo(x - 7, 284, x, 274);
      g.quadraticCurveTo(x + 7, 284, x, 292);
      fill(g, "#ffb82e");
    }
  }
}

function stall(g: Ctx2D, w: number, h: number): void {
  ell(g, 256, 498, 254, 16);
  fill(g, lin(g, 0, 484, 0, 512, ["#ffffff", "#bcd0f2"]));
  // Rückwand
  g.beginPath();
  g.rect(70, 150, 372, 268);
  sticker(g, lin(g, 0, 150, 0, 418, ["#5a3016", "#2a1408"]), 6);
  g.save();
  g.beginPath();
  g.rect(70, 150, 372, 268);
  g.clip();
  fill(g, rad(g, 256, 300, 10, 256, 300, 230, ["rgba(255,190,90,0.6)", "rgba(255,150,60,0.18)", "rgba(255,150,60,0)"]));
  g.fillRect(70, 150, 372, 268);
  for (let x = 70; x < 442; x += 30) {
    g.beginPath();
    g.moveTo(x, 150);
    g.lineTo(x, 418);
    stroke(g, "rgba(20,8,2,0.35)", 2.5, "butt");
  }
  g.restore();
  stallGoods(g);
  // Vorhänge
  for (const d of [-1, 1]) {
    const x0 = d < 0 ? 70 : 442;
    g.beginPath();
    g.moveTo(x0, 150);
    g.lineTo(x0 - d * 64, 150);
    g.quadraticCurveTo(x0 - d * 12, 270, x0 - d * 26, 360);
    g.quadraticCurveTo(x0 + d * 6, 300, x0, 290);
    g.closePath();
    sticker(g, lin(g, x0, 0, x0 - d * 64, 0, ["#7a0a1c", "#d8283a", "#a3121f"]), 4);
    g.beginPath();
    g.moveTo(x0 - d * 22, 156);
    g.quadraticCurveTo(x0 - d * 12, 250, x0 - d * 20, 330);
    stroke(g, "rgba(255,150,150,0.35)", 3);
  }
  // Pfosten (Zuckerstangen)
  for (const x of [36, 450]) {
    const shape = (): void => {
      g.beginPath();
      rr(g, x, 136, 28, 358, 10);
    };
    shape();
    stroke(g, INK, 14);
    shape();
    fill(g, "#fffaf4");
    stripes(g, shape, w, h, "#d8283a", 44, -0.62, 22);
    shape();
    g.save();
    g.clip();
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.fillRect(x + 4, 140, 6, 350);
    g.fillStyle = "rgba(60,0,30,0.2)";
    g.fillRect(x + 20, 140, 8, 350);
    g.restore();
  }
  // Theke
  g.beginPath();
  g.moveTo(24, 372);
  g.lineTo(488, 372);
  g.lineTo(478, 496);
  g.lineTo(34, 496);
  g.closePath();
  sticker(g, lin(g, 0, 372, 0, 496, ["#b8824a", "#8a5a2a", "#5a3416"]), 6);
  g.save();
  g.clip();
  for (let y = 400; y < 496; y += 26) {
    g.beginPath();
    g.moveTo(24, y);
    g.lineTo(488, y);
    stroke(g, "rgba(30,12,2,0.35)", 3, "butt");
  }
  g.fillStyle = "rgba(255,255,255,0.12)";
  g.fillRect(24, 372, 464, 8);
  g.restore();
  // Platte + Herz-Schild
  g.beginPath();
  rr(g, 14, 358, 484, 22, 7);
  sticker(g, lin(g, 0, 358, 0, 380, ["#e0aa6a", "#a06a34"]), 5);
  g.beginPath();
  g.moveTo(256, 470);
  g.bezierCurveTo(206, 434, 228, 402, 256, 420);
  g.bezierCurveTo(284, 402, 306, 434, 256, 470);
  sticker(g, lin(g, 0, 404, 0, 470, ["#ff5a66", "#b3122a"]), 4, "#fff4ea");
  for (let i = 0; i < 9; i += 1) {
    sphere(g, 60 + i * 49, 486, 6, ["#ffffff", cols5(i), "#4a1a2a"], 0);
  }
  // Auslage auf der Theke: Lebkuchen, Stern, Tasse
  sphere(g, 96, 350, 13, ["#ffffff", "#ff6a70", "#a3121f"], 2.4);
  sphere(g, 122, 352, 11, ["#ffffff", "#ffd24a", "#c48a10"], 2.4);
  star(g, 400, 344, 22, 0.5);
  sticker(g, lin(g, 380, 322, 420, 366, ["#fff2a0", "#e8a80c"]), 3, "#5a3a08");
  rr(g, 430, 332, 30, 30, 7);
  sticker(g, lin(g, 430, 0, 460, 0, ["#fff8ee", "#e2d2b8"]), 3);
  ell(g, 445, 335, 13, 4);
  fill(g, "#7a1028");
  // Markise mit Zacken
  const awning = (): void => {
    g.beginPath();
    g.moveTo(26, 128);
    g.lineTo(486, 128);
    g.lineTo(486, 206);
    for (let i = 7; i >= 0; i -= 1) {
      const x1 = 26 + i * 57.5;
      g.arc(x1 + 28.75, 206, 28.75, 0, Math.PI, false);
    }
    g.closePath();
  };
  awning();
  stroke(g, INK, 16);
  awning();
  fill(g, "#fff4e6");
  stripes(g, awning, w, h, "#d8283a", 57.5, 0, 28.75);
  g.save();
  awning();
  g.clip();
  g.translate(-100, 0);
  fill(g, lin(g, 0, 128, 0, 236, ["rgba(255,255,255,0.2)", "rgba(0,0,0,0)", "rgba(40,0,30,0.32)"]));
  g.fillRect(0, 100, 900, 160);
  g.restore();
  // Dach
  g.beginPath();
  g.moveTo(8, 146);
  g.lineTo(74, 62);
  g.quadraticCurveTo(256, 40, 438, 62);
  g.lineTo(504, 146);
  g.closePath();
  sticker(g, lin(g, 0, 60, 0, 146, ["#8a3a24", "#5a1e14"]), 7);
  g.save();
  g.clip();
  for (let y = 78; y < 146; y += 18) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(512, y);
    stroke(g, "rgba(30,6,4,0.4)", 3, "butt");
  }
  g.restore();
  g.beginPath();
  rr(g, 2, 138, 508, 20, 6);
  sticker(g, lin(g, 0, 138, 0, 158, ["#6a4020", "#3a2010"]), 5);
  snowCap(g, 58, 454, 56, 16, 20, 31);
  snowCap(g, 4, 90, 112, 12, 26, 41);
  snowCap(g, 420, 508, 112, 12, 26, 43);
  // Girlande mit Lichtern
  for (let s = 0; s < 4; s += 1) {
    const x0 = 22 + s * 117;
    g.beginPath();
    g.moveTo(x0, 150);
    g.quadraticCurveTo(x0 + 58, 196, x0 + 116, 150);
    stroke(g, INK, 22);
    g.beginPath();
    g.moveTo(x0, 150);
    g.quadraticCurveTo(x0 + 58, 196, x0 + 116, 150);
    stroke(g, "#1f6b34", 16);
    g.beginPath();
    g.moveTo(x0, 150);
    g.quadraticCurveTo(x0 + 58, 196, x0 + 116, 150);
    stroke(g, "#39a856", 7);
    for (let i = 1; i < 5; i += 1) {
      const u = i / 5;
      const bx = x0 + u * 116;
      const by = 150 + 2 * u * (1 - u) * 46 * 1.0 + 7;
      sphere(g, bx, by, 6.5, ["#ffffff", BULBS[(i + s) % 5], "#3a1a30"], 1.8);
    }
  }
  for (const x of [22, 256, 490]) bow(g, x, 150, 16, "#e23a48", "#8f1424");
  void w;
  void h;
}

const BULBS = ["#e23a48", "#ffd24a", "#3fb56a", "#4a86f0", "#ff8ac0"];

function cols5(i: number): string {
  return BULBS[i % 5];
}

// --- Glühweinkessel -------------------------------------------------------------------------------------------

function kessel(g: Ctx2D): void {
  const cx = 222;
  // Feuer
  const flame = (x: number, hgt: number, wd: number, c0: string, c1: string): void => {
    g.beginPath();
    g.moveTo(x - wd, 484);
    g.bezierCurveTo(x - wd * 1.2, 484 - hgt * 0.5, x - wd * 0.2, 484 - hgt * 0.6, x, 484 - hgt);
    g.bezierCurveTo(x + wd * 0.3, 484 - hgt * 0.6, x + wd * 1.2, 484 - hgt * 0.5, x + wd, 484);
    g.closePath();
    fill(g, lin(g, 0, 484 - hgt, 0, 484, [c0, c1]));
  };
  flame(96, 110, 34, "#ffb02e", "#e2361a");
  flame(348, 116, 34, "#ffb02e", "#e2361a");
  flame(150, 150, 30, "#ffd45a", "#ee5a1a");
  flame(296, 146, 30, "#ffd45a", "#ee5a1a");
  flame(222, 130, 40, "#fff0a0", "#ff8a1e");
  // Beine
  for (const [x0, y0, x1, y1] of [[110, 396, 64, 506], [334, 396, 380, 506], [222, 420, 222, 504]]) {
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    stroke(g, INK, 22);
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    stroke(g, "#5a5670", 12);
  }
  // Holzscheite
  for (const [x, rot] of [[150, 0.14], [296, -0.14]]) {
    ell(g, x, 492, 96, 16, rot);
    sticker(g, lin(g, 0, 476, 0, 508, ["#8a5a30", "#4a2a12"]), 5);
    ell(g, x + (rot > 0 ? 88 : -88), 492 + (rot > 0 ? 12 : -12) * 0.4, 8, 12, rot);
    fill(g, "#ff8a2e");
  }
  // Henkel
  for (const d of [-1, 1]) {
    ell(g, cx + d * 196, 236, 24, 34);
    stroke(g, INK, 22);
    ell(g, cx + d * 196, 236, 24, 34);
    stroke(g, "#c8742e", 12);
  }
  // Körper
  const body = (): void => {
    g.beginPath();
    g.moveTo(50, 180);
    g.bezierCurveTo(6, 234, 2, 344, 108, 408);
    g.quadraticCurveTo(cx, 442, 336, 408);
    g.bezierCurveTo(442, 344, 438, 234, 394, 180);
    g.closePath();
  };
  body();
  sticker(g, lin(g, 6, 0, 438, 0, [[0, "#5a2408"], [0.16, "#b8642a"], [0.36, "#ffc890"], [0.56, "#e28a44"], [0.82, "#9a4a18"], [1, "#4a1c06"]]), 9);
  g.save();
  body();
  g.clip();
  for (const [y, a] of [[262, 0.4], [356, 0.3]]) {
    g.beginPath();
    g.ellipse(cx, y - 40, 214, 52, 0, 0.08 * Math.PI, 0.92 * Math.PI);
    stroke(g, `rgba(56,18,2,${a + 0.1})`, 7);
    g.beginPath();
    g.ellipse(cx, y - 47, 214, 52, 0, 0.08 * Math.PI, 0.92 * Math.PI);
    stroke(g, "rgba(255,225,170,0.4)", 4);
    for (let i = 0; i < 9; i += 1) {
      const t = 0.14 + i * 0.09;
      const a2 = t * Math.PI;
      sphere(g, cx + Math.cos(a2) * 214 * -1, y - 40 + Math.sin(a2) * 52, 5, ["#fff0d0", "#c8742e", "#4a1c06"], 0);
    }
  }
  g.beginPath();
  g.ellipse(cx - 92, 300, 36, 92, 0.2, 0, TAU);
  fill(g, "rgba(255,240,210,0.28)");
  g.restore();
  // Schild
  g.beginPath();
  rr(g, cx - 56, 288, 112, 76, 14);
  sticker(g, lin(g, 0, 288, 0, 364, ["#fff4de", "#e2cca0"]), 4, "#5a2a08");
  g.beginPath();
  g.moveTo(cx, 344);
  g.bezierCurveTo(cx - 34, 320, cx - 18, 304, cx, 314);
  g.bezierCurveTo(cx + 18, 304, cx + 34, 320, cx, 344);
  fill(g, "#c8102e");
  // Rand + Glühwein
  ell(g, cx, 180, 176, 38);
  sticker(g, lin(g, 44, 0, 400, 0, [[0, "#8a4a1e"], [0.35, "#ffd0a0"], [0.7, "#c8742e"], [1, "#6a2e0e"]]), 8);
  ell(g, cx, 182, 152, 27);
  fill(g, rad(g, cx - 30, 176, 6, cx, 182, 160, ["#d62a4c", "#8a1030", "#4a0618"]));
  ell(g, cx - 40, 176, 34, 6);
  fill(g, "rgba(255,180,190,0.4)");
  // Zutaten
  sphere(g, 166, 184, 16, ["#ffe0a0", "#ff9a2a", "#d05a0a"], 2.6);
  g.beginPath();
  g.moveTo(166, 168);
  g.lineTo(166, 200);
  g.moveTo(151, 184);
  g.lineTo(181, 184);
  stroke(g, "rgba(255,240,200,0.7)", 1.8);
  star(g, 268, 180, 15, 0.45, 0.2, 8);
  sticker(g, "#7a4420", 2.2);
  g.beginPath();
  g.moveTo(206, 196);
  g.lineTo(246, 190);
  stroke(g, INK, 11);
  g.beginPath();
  g.moveTo(206, 196);
  g.lineTo(246, 190);
  stroke(g, "#b26a34", 7);
  // Schöpflöffel
  limb(g, [[262, 170], [330, 90], [388, 30]], 11, lin(g, 262, 170, 388, 30, ["#c8905a", "#7a4a22"]), 4);
  sphere(g, 396, 26, 22, ["#ffffff", "#c8cede", "#6a7290"], 4);
  // Vorderkante des Randes
  g.beginPath();
  g.ellipse(cx, 180, 176, 38, 0, 0.06 * Math.PI, 0.94 * Math.PI);
  stroke(g, "rgba(255,240,210,0.7)", 5);
}

// --- Lebkuchenmann --------------------------------------------------------------------------------------------

function gingerbread(g: Ctx2D): void {
  const body = (): CanvasGradient => lin(g, 0, 20, 0, 500, ["#efb672", "#cf8a48", "#a5622a"]);
  // Schatten
  ell(g, 226, 504, 150, 10);
  fill(g, "rgba(20,10,30,0.25)");
  limb(g, [[176, 226], [96, 262], [50, 322]], 58, body(), 9);
  limb(g, [[186, 326], [140, 416], [98, 490]], 62, body(), 9);
  g.beginPath();
  rr(g, 138, 178, 156, 164, 62);
  sticker(g, body(), 9);
  limb(g, [[252, 334], [318, 410], [352, 490]], 62, body(), 9);
  limb(g, [[278, 224], [352, 186], [406, 122]], 58, body(), 9);
  ell(g, 217, 108, 90, 88);
  sticker(g, body(), 9);
  // Backtextur
  g.save();
  g.globalCompositeOperation = "source-atop";
  const r = mulberry(11);
  for (let i = 0; i < 90; i += 1) {
    ell(g, 40 + r() * 360, 30 + r() * 470, 1.8 + r() * 2.6, 1.2 + r() * 1.8, r() * 3);
    fill(g, r() < 0.5 ? "rgba(110,52,14,0.34)" : "rgba(255,225,170,0.3)");
  }
  g.restore();
  // Zuckerguss: Manschetten, Punktlinien
  for (const [x, y, a] of [[52, 318, 1.15], [104, 480, 1.0], [346, 482, 2.0], [402, 126, 0.6]] as const) {
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.beginPath();
    g.moveTo(-26, 0);
    for (let i = 0; i < 4; i += 1) g.quadraticCurveTo(-26 + i * 13 + 6.5, -9, -26 + (i + 1) * 13, 0);
    stroke(g, "#fffaf0", 8);
    g.restore();
  }
  g.save();
  g.setLineDash([1, 15]);
  g.beginPath();
  rr(g, 152, 192, 128, 136, 50);
  stroke(g, "rgba(255,250,240,0.9)", 6);
  g.restore();
  // Gesicht
  for (const ex of [188, 246]) {
    ell(g, ex, 96, 10, 11);
    fill(g, "#3a1c0c");
    ell(g, ex - 3, 92, 3.4, 3.6);
    fill(g, "#ffffff");
  }
  for (const ex of [168, 268]) {
    ell(g, ex, 128, 15, 10);
    fill(g, "rgba(255,110,130,0.4)");
  }
  g.beginPath();
  g.arc(217, 112, 36, 0.18 * Math.PI, 0.82 * Math.PI);
  stroke(g, "#fffaf0", 9);
  // Fliege + Knöpfe
  bow(g, 217, 196, 20, "#e23a48", "#8f1424");
  const gum: Array<[number, string, string]> = [[246, "#ff6a70", "#a3121f"], [284, "#5ad486", "#146a30"], [322, "#7aa8ff", "#1f3f95"]];
  for (const [by, c0, c1] of gum) sphere(g, 217, by, 14, ["#ffffff", c0, c1], 3);
}

// --- Krampus (Blickrichtung rechts; Auge (850|335), Mund (880|430), Glöckchen (560|530) in Promille) --------------

function krampus(g: Ctx2D): void {
  const fur = (): CanvasGradient => lin(g, 100, 100, 400, 480, ["#6a4830", "#3e281a", "#1c1210"]);
  ell(g, 240, 500, 190, 12);
  fill(g, "rgba(10,4,20,0.3)");
  // Schwanzbüschel
  g.beginPath();
  g.moveTo(140, 276);
  g.quadraticCurveTo(84, 258, 62, 296);
  g.quadraticCurveTo(100, 300, 146, 300);
  sticker(g, "#2a1a12", 5, "#0c0608");
  // Hinterbein
  limb(g, [[196, 320], [150, 392], [128, 470]], 62, fur(), 8, "#0c0608");
  ell(g, 122, 486, 30, 15, 0.1);
  sticker(g, lin(g, 0, 470, 0, 500, ["#3a3a4a", "#0e0c12"]), 5, "#0c0608");
  // Rücken-/Rumpfmasse
  g.beginPath();
  g.moveTo(132, 290);
  g.bezierCurveTo(120, 200, 200, 140, 300, 138);
  g.bezierCurveTo(350, 138, 390, 180, 380, 240);
  g.bezierCurveTo(372, 300, 330, 350, 250, 352);
  g.bezierCurveTo(190, 354, 140, 340, 132, 290);
  g.closePath();
  sticker(g, fur(), 8, "#0c0608");
  // Fellzotteln am Rücken
  g.fillStyle = "#3e281a";
  for (let i = 0; i < 9; i += 1) {
    const u = i / 8;
    const x = 150 + u * 170;
    const y = 214 - Math.sin(u * Math.PI) * 76 + 16 * (1 - u);
    g.beginPath();
    g.moveTo(x - 12, y + 18);
    g.lineTo(x - 4 - 12 * (1 - u), y - 20);
    g.lineTo(x + 12, y + 14);
    g.closePath();
    sticker(g, "#3e281a", 3, "#0c0608");
  }
  const r = mulberry(31);
  g.save();
  g.beginPath();
  g.moveTo(132, 290);
  g.bezierCurveTo(120, 200, 200, 140, 300, 138);
  g.bezierCurveTo(350, 138, 390, 180, 380, 240);
  g.bezierCurveTo(372, 300, 330, 350, 250, 352);
  g.bezierCurveTo(190, 354, 140, 340, 132, 290);
  g.closePath();
  g.clip();
  for (let i = 0; i < 150; i += 1) {
    const x = 120 + r() * 270;
    const y = 130 + r() * 230;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x - 7 - r() * 8, y + 16 + r() * 12);
    stroke(g, r() < 0.55 ? "rgba(180,130,90,0.4)" : "rgba(10,4,4,0.5)", 3.4);
  }
  g.restore();
  // Vorderbein
  limb(g, [[262, 336], [312, 396], [334, 470]], 60, fur(), 8, "#0c0608");
  ell(g, 342, 486, 30, 15, -0.1);
  sticker(g, lin(g, 0, 470, 0, 500, ["#3a3a4a", "#0e0c12"]), 5, "#0c0608");
  // Hinterer Arm mit Kette
  limb(g, [[250, 210], [214, 290], [232, 344]], 44, fur(), 7, "#0c0608");
  // Kette quer über die Brust
  g.beginPath();
  g.moveTo(230, 168);
  g.quadraticCurveTo(300, 250, 350, 296);
  g.setLineDash([12, 6]);
  stroke(g, INK, 13, "butt");
  g.beginPath();
  g.moveTo(230, 168);
  g.quadraticCurveTo(300, 250, 350, 296);
  stroke(g, "#c8ced8", 8, "butt");
  g.setLineDash([]);
  // Glöckchen
  g.beginPath();
  g.moveTo(262, 284);
  g.quadraticCurveTo(262, 246, 284, 246);
  g.quadraticCurveTo(306, 246, 306, 284);
  g.closePath();
  sticker(g, lin(g, 262, 0, 306, 0, ["#ffe27a", "#e8a80c", "#8a5a08"]), 4, "#3a2004");
  ell(g, 284, 288, 6, 6);
  fill(g, "#3a2004");
  // Hörner
  const horn = (x0: number, y0: number, tip: [number, number], c1: [number, number], c2: [number, number], wd: number): void => {
    g.beginPath();
    g.moveTo(x0 - wd, y0);
    g.bezierCurveTo(c1[0] - wd, c1[1], c2[0] - wd * 0.2, c2[1], tip[0], tip[1]);
    g.bezierCurveTo(c2[0] + wd * 0.5, c2[1] + 30, c1[0] + wd * 0.6, c1[1] + 20, x0 + wd, y0);
    g.closePath();
    sticker(g, lin(g, x0 - 60, 0, x0 + 60, 0, ["#f6ecd0", "#cdbb90", "#8a7448"]), 5, "#0c0608");
  };
  horn(348, 132, [270, 8], [330, 60], [300, 20], 22);
  horn(388, 128, [330, 4], [394, 60], [366, 16], 20);
  g.strokeStyle = "rgba(90,70,40,0.5)";
  g.lineWidth = 3;
  for (let i = 0; i < 4; i += 1) {
    g.beginPath();
    g.moveTo(338 - i * 12, 110 - i * 24);
    g.lineTo(354 - i * 12, 112 - i * 24);
    g.stroke();
  }
  // Kopf
  g.beginPath();
  g.ellipse(392, 178, 66, 58, -0.15, 0, TAU);
  sticker(g, lin(g, 340, 120, 450, 240, ["#6a4830", "#3e281a", "#1e1310"]), 7, "#0c0608");
  // Ohr
  g.beginPath();
  g.moveTo(342, 154);
  g.lineTo(300, 112);
  g.lineTo(360, 128);
  g.closePath();
  sticker(g, "#4a3020", 4, "#0c0608");
  // Schnauze + Unterkiefer + Zunge
  g.beginPath();
  g.ellipse(446, 202, 52, 30, 0.22, 0, TAU);
  sticker(g, lin(g, 400, 170, 490, 240, ["#5a3c28", "#2a1a12"]), 6, "#0c0608");
  g.beginPath();
  g.moveTo(420, 224);
  g.quadraticCurveTo(440, 300, 452, 322);
  g.quadraticCurveTo(466, 300, 470, 224);
  g.closePath();
  sticker(g, lin(g, 0, 224, 0, 322, ["#ff5a70", "#c4103a"]), 5, "#3a0410");
  g.beginPath();
  g.moveTo(452, 232);
  g.lineTo(452, 300);
  stroke(g, "rgba(120,0,30,0.5)", 3);
  g.beginPath();
  g.ellipse(444, 232, 42, 16, 0.3, 0, TAU);
  sticker(g, lin(g, 0, 216, 0, 250, ["#3a2418", "#1a100c"]), 5, "#0c0608");
  for (const fx of [426, 466]) {
    g.beginPath();
    g.moveTo(fx - 6, 222);
    g.lineTo(fx + 6, 222);
    g.lineTo(fx, 244);
    g.closePath();
    sticker(g, "#fffaf0", 2, "#3a3020");
  }
  // Bart
  g.beginPath();
  g.moveTo(410, 240);
  g.quadraticCurveTo(396, 292, 420, 312);
  g.quadraticCurveTo(428, 280, 446, 252);
  g.closePath();
  sticker(g, "#241610", 4, "#0c0608");
  // Auge (glühend) + Brauen
  ell(g, 431, 171, 15, 11, 0.2);
  sticker(g, rad(g, 431, 171, 1, 431, 171, 15, ["#fff6a0", "#ff9a1a", "#d81e1e"]), 3, "#0c0608");
  ell(g, 433, 171, 3.6, 8);
  fill(g, "#1a0408");
  g.beginPath();
  g.moveTo(404, 146);
  g.lineTo(452, 162);
  stroke(g, "#0c0608", 9);
  // Nasenlöcher
  ell(g, 481, 196, 4, 6, 0.4);
  fill(g, "#0c0608");
  // Hinterer Arm hebt die Rute über die Schulter
  limb(g, [[262, 206], [206, 166], [176, 118]], 44, fur(), 7, "#0c0608");
  for (let i = 0; i < 9; i += 1) {
    const a = -2.1 - i * 0.075;
    const len = 92 + ((i * 7) % 5) * 9;
    const x1 = 172 + Math.cos(a) * len;
    const y1 = 116 + Math.sin(a) * len;
    g.beginPath();
    g.moveTo(174, 124);
    g.quadraticCurveTo(174 + (x1 - 174) * 0.5 - 6, 124 + (y1 - 124) * 0.5, x1, y1);
    stroke(g, INK, 8);
    g.beginPath();
    g.moveTo(174, 124);
    g.quadraticCurveTo(174 + (x1 - 174) * 0.5 - 6, 124 + (y1 - 124) * 0.5, x1, y1);
    stroke(g, i % 2 ? "#c8a060" : "#a0703a", 4.6);
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x1 - 14, y1 - 6);
    g.moveTo(x1, y1);
    g.lineTo(x1 + 4, y1 - 16);
    stroke(g, i % 2 ? "#c8a060" : "#a0703a", 2.6);
  }
  ell(g, 176, 122, 20, 18);
  sticker(g, fur(), 5, "#0c0608");
  g.beginPath();
  g.moveTo(160, 100);
  g.lineTo(194, 108);
  stroke(g, INK, 14, "butt");
  g.beginPath();
  g.moveTo(160, 100);
  g.lineTo(194, 108);
  stroke(g, "#d81e2e", 8, "butt");
  // Vorderer Arm greift nach vorn-unten
  limb(g, [[316, 214], [358, 282], [398, 322]], 46, fur(), 7, "#0c0608");
  ell(g, 404, 330, 22, 20);
  sticker(g, fur(), 5, "#0c0608");
  for (const d of [-1, 0, 1]) {
    g.beginPath();
    g.moveTo(404 + d * 9, 340);
    g.lineTo(404 + d * 12 + 6, 362);
    stroke(g, "#f6ecd0", 5);
  }
}

// --- Rodelschlitten (Blickrichtung links; Kufenschnecke vorn links) --------------------------------------------

function sled(g: Ctx2D): void {
  const runner = (dx: number, dy: number, c0: string, c1: string): void => {
    const p = (): void => {
      g.beginPath();
      g.moveTo(490 + dx, 216 + dy);
      g.lineTo(104 + dx, 222 + dy);
      g.bezierCurveTo(44 + dx, 224 + dy, 16 + dx, 194 + dy, 22 + dx, 152 + dy);
      g.bezierCurveTo(26 + dx, 118 + dy, 56 + dx, 98 + dy, 86 + dx, 108 + dy);
    };
    p();
    stroke(g, INK, 26);
    p();
    stroke(g, lin(g, 0, 90 + dy, 0, 232 + dy, [c0, c1]), 14);
    p();
    stroke(g, "rgba(255,255,255,0.5)", 3.6);
  };
  ell(g, 270, 246, 232, 11);
  fill(g, "rgba(20,10,30,0.25)");
  runner(22, -22, "#8a92a8", "#4a5068");
  for (const x of [156, 268, 390]) limb(g, [[x, 126], [x, 216]], 15, lin(g, x - 8, 0, x + 8, 0, ["#a06a36", "#6a4020"]), 5);
  // Sitzbrett
  g.beginPath();
  rr(g, 62, 120, 424, 34, 9);
  sticker(g, lin(g, 0, 120, 0, 154, ["#d09a5a", "#a0683a", "#6a4020"]), 6);
  for (const x of [130, 220, 320, 410]) {
    g.beginPath();
    g.moveTo(x, 122);
    g.lineTo(x, 152);
    stroke(g, "rgba(40,16,4,0.45)", 3, "butt");
  }
  for (const x of [88, 462]) {
    ell(g, x, 137, 3.4, 3.4);
    fill(g, "#e8d8a8");
  }
  runner(0, 0, "#dfe4f2", "#7a829c");
  // Rückenlehne
  g.beginPath();
  g.moveTo(448, 128);
  g.lineTo(448, 44);
  g.quadraticCurveTo(478, 30, 490, 52);
  g.lineTo(486, 128);
  g.closePath();
  sticker(g, lin(g, 448, 0, 490, 0, ["#b8824a", "#7a4a22"]), 6);
  g.beginPath();
  g.moveTo(468, 100);
  g.bezierCurveTo(452, 88, 458, 72, 468, 78);
  g.bezierCurveTo(478, 72, 484, 88, 468, 100);
  fill(g, "#d8283a");
  // Kissen
  g.beginPath();
  rr(g, 112, 68, 330, 56, 26);
  sticker(g, lin(g, 0, 68, 0, 124, ["#f0505e", "#c81e2e", "#8a0e1c"]), 6);
  g.beginPath();
  rr(g, 124, 78, 306, 36, 18);
  stroke(g, "rgba(255,240,230,0.75)", 3.4);
  for (const x of [178, 278, 378]) {
    sphere(g, x, 96, 6.4, ["#ff9a9a", "#a3121f", "#5a0610"], 0);
    ell(g, x - 2, 94, 1.8, 1.8);
    fill(g, "rgba(255,255,255,0.8)");
  }
  g.beginPath();
  g.moveTo(130, 84);
  g.lineTo(420, 84);
  stroke(g, "rgba(255,255,255,0.28)", 5);
  // Zugseil + Stechpalme vorn
  g.beginPath();
  g.moveTo(80, 108);
  g.bezierCurveTo(20, 84, 6, 30, 46, 22);
  g.setLineDash([9, 5]);
  stroke(g, INK, 12, "butt");
  g.beginPath();
  g.moveTo(80, 108);
  g.bezierCurveTo(20, 84, 6, 30, 46, 22);
  stroke(g, "#e8d0a0", 7, "butt");
  g.setLineDash([]);
  for (const d of [-1, 1]) {
    g.beginPath();
    g.moveTo(124, 68);
    g.quadraticCurveTo(124 + d * 26, 42, 124 + d * 46, 66);
    g.quadraticCurveTo(124 + d * 22, 76, 124, 68);
    sticker(g, "#2a8a44", 3);
  }
  for (const [bx, by] of [[124, 66], [134, 70], [116, 70]]) sphere(g, bx, by, 6.5, ["#ff8a8a", "#d81e2e", "#7a0a14"], 1.8);
  snowCap(g, 240, 350, 62, 8, 0, 3);
}

// --- Elf (Blickrichtung rechts; Schneeball in der linken Hand bei (128|252) Promille) -----------------------

function elf(g: Ctx2D): void {
  const skin = lin(g, 0, 90, 0, 220, ["#ffd8b4", "#f0a878"]);
  ell(g, 250, 506, 160, 8);
  fill(g, "rgba(20,10,30,0.22)");
  // Hinterbein (gestreift) mit Schnabelschuh
  const stockings = (pts: Array<[number, number]>): void => {
    limb(g, pts, 40, "#fffaf0", 7);
    g.save();
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.setLineDash([12, 12]);
    stroke(g, "#d8283a", 40, "butt");
    g.restore();
  };
  stockings([[228, 332], [184, 402], [138, 452]]);
  g.beginPath();
  g.moveTo(112, 440);
  g.quadraticCurveTo(90, 470, 60, 458);
  g.quadraticCurveTo(84, 502, 150, 496);
  g.quadraticCurveTo(168, 474, 158, 440);
  g.closePath();
  sticker(g, lin(g, 0, 440, 0, 500, ["#3fb56a", "#146a30"]), 6);
  sphere(g, 60, 456, 9, ["#fff2a0", "#e8a80c", "#8a5a08"], 3);
  // Rumpf: Tunika
  g.beginPath();
  g.moveTo(232, 206);
  g.quadraticCurveTo(286, 200, 322, 226);
  g.lineTo(304, 340);
  for (let i = 0; i < 5; i += 1) g.lineTo(304 - (i + 0.5) * 20, 362 - (i % 2 ? 0 : 16));
  g.lineTo(206, 340);
  g.closePath();
  sticker(g, lin(g, 210, 0, 320, 0, ["#4ac878", "#1f9a4d", "#0d5c2c"]), 7);
  g.beginPath();
  rr(g, 208, 292, 100, 22, 6);
  sticker(g, lin(g, 0, 292, 0, 314, ["#e23a48", "#8f1424"]), 3);
  rr(g, 244, 291, 28, 24, 5);
  sticker(g, lin(g, 0, 291, 0, 315, ["#fff2a0", "#c48a10"]), 2.4, "#5a3a08");
  g.beginPath();
  g.moveTo(240, 210);
  g.lineTo(272, 236);
  g.lineTo(304, 212);
  stroke(g, "#fffaf0", 12);
  // Vorderbein
  stockings([[276, 340], [322, 404], [366, 452]]);
  g.beginPath();
  g.moveTo(348, 442);
  g.quadraticCurveTo(376, 424, 420, 440);
  g.quadraticCurveTo(452, 448, 462, 424);
  g.quadraticCurveTo(478, 490, 400, 498);
  g.quadraticCurveTo(360, 498, 342, 470);
  g.closePath();
  sticker(g, lin(g, 0, 430, 0, 500, ["#3fb56a", "#146a30"]), 6);
  sphere(g, 462, 428, 9, ["#fff2a0", "#e8a80c", "#8a5a08"], 3);
  // Vorderer Arm nach unten
  limb(g, [[300, 238], [340, 280], [366, 320]], 34, "#2fae5c", 6);
  ell(g, 372, 330, 17, 17);
  sticker(g, "#fffaf0", 4);
  // Hinterer Arm (Wurfarm) hoch, Ball in der Hand
  limb(g, [[248, 232], [170, 208], [100, 156]], 34, "#2fae5c", 6);
  ell(g, 96, 152, 22, 22);
  sticker(g, "#fffaf0", 4);
  // Kopf
  ell(g, 292, 146, 62, 58);
  sticker(g, skin, 7);
  // Spitzohr
  g.beginPath();
  g.moveTo(240, 150);
  g.lineTo(184, 118);
  g.lineTo(244, 176);
  g.closePath();
  sticker(g, skin, 5);
  g.beginPath();
  g.moveTo(230, 152);
  g.lineTo(200, 130);
  stroke(g, "rgba(230,110,90,0.55)", 4);
  // Gesicht
  ell(g, 320, 146, 13, 16);
  sticker(g, "#ffffff", 3);
  ell(g, 323, 148, 7, 9);
  fill(g, "#2a1a4a");
  ell(g, 325, 144, 2.6, 2.6);
  fill(g, "#ffffff");
  g.beginPath();
  g.moveTo(300, 132);
  g.quadraticCurveTo(320, 122, 342, 130);
  stroke(g, "#7a3a12", 4.5);
  ell(g, 342, 168, 7, 6);
  fill(g, "#f0906a");
  g.beginPath();
  g.arc(312, 178, 22, 0.15 * Math.PI, 0.72 * Math.PI);
  stroke(g, "#7a1c1c", 5);
  ell(g, 292, 176, 12, 8);
  fill(g, "rgba(255,110,130,0.4)");
  // Mütze
  g.beginPath();
  g.moveTo(232, 118);
  g.quadraticCurveTo(230, 52, 300, 40);
  g.quadraticCurveTo(220, 6, 150, 82);
  g.quadraticCurveTo(180, 64, 240, 76);
  g.lineTo(348, 114);
  g.quadraticCurveTo(336, 66, 300, 40);
  g.quadraticCurveTo(230, 52, 232, 118);
  g.closePath();
  sticker(g, lin(g, 150, 0, 350, 0, ["#4ac878", "#1f9a4d", "#0d5c2c"]), 6);
  g.beginPath();
  g.moveTo(236, 96);
  g.quadraticCurveTo(300, 124, 352, 96);
  g.lineTo(348, 112);
  g.quadraticCurveTo(300, 138, 240, 110);
  g.closePath();
  sticker(g, "#fffaf0", 4);
  sphere(g, 152, 82, 16, ["#ffffff", "#f0f4ff", "#a8b8e0"], 4);
  // Schneeball in der Wurfhand
  sphere(g, 62, 129, 38, [[0, "#ffffff"], [0.6, "#eaf2ff"], [1, "#9cb4e8"]], 5);
  glint4(g, 50, 116, 9, 0.9);
}

// --- Schneeball (fliegt nach rechts; Schweif links) -------------------------------------------------------------

function snowball(g: Ctx2D): void {
  const r = mulberry(5);
  for (let i = 0; i < 4; i += 1) {
    const y = 56 + i * 24;
    g.beginPath();
    g.moveTo(150, y - 8);
    g.quadraticCurveTo(100, y - 4 + (r() - 0.5) * 10, 6 + i * 6, y + (r() - 0.5) * 14);
    g.quadraticCurveTo(100, y + 6, 150, y + 10);
    g.closePath();
    fill(g, lin(g, 6, 0, 150, 0, ["rgba(190,235,255,0)", "rgba(190,235,255,0.75)"]));
  }
  for (let i = 0; i < 7; i += 1) {
    ell(g, 30 + r() * 100, 40 + r() * 100, 4 + r() * 5, 4 + r() * 5);
    fill(g, "rgba(240,250,255,0.75)");
  }
  sphere(g, 176, 92, 62, [[0, "#ffffff"], [0.55, "#eef5ff"], [0.85, "#b0c6f2"], [1, "#8aa4e0"]], 7);
  g.beginPath();
  g.arc(176, 92, 48, Math.PI * 1.05, Math.PI * 1.5);
  stroke(g, "rgba(255,255,255,0.9)", 7);
  glint4(g, 150, 62, 12, 0.9);
}

// --- Stern, Laterne, Lebkuchenherz ------------------------------------------------------------------------------

function starProp(g: Ctx2D): void {
  const cx = 128;
  const cy = 132;
  star(g, cx, cy, 116, 0.46);
  sticker(g, lin(g, 40, 20, 220, 240, ["#fff6b0", "#ffc21a", "#c8780a"]), 7, "#5a3a08");
  // Facetten: linke Hälfte jeder Zacke heller, rechte dunkler
  for (let i = 0; i < 5; i += 1) {
    const a = -Math.PI / 2 + (i * TAU) / 5;
    const tx = cx + Math.cos(a) * 112;
    const ty = cy + Math.sin(a) * 112;
    const la = a - Math.PI / 5;
    const ra = a + Math.PI / 5;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(la) * 52, cy + Math.sin(la) * 52);
    g.lineTo(tx, ty);
    g.closePath();
    fill(g, "rgba(255,255,220,0.5)");
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(ra) * 52, cy + Math.sin(ra) * 52);
    g.lineTo(tx, ty);
    g.closePath();
    fill(g, "rgba(150,70,0,0.32)");
  }
  glint4(g, 100, 96, 18, 0.9);
}

function lantern(g: Ctx2D): void {
  const cx = 64;
  g.beginPath();
  g.moveTo(cx, 0);
  g.lineTo(cx, 40);
  stroke(g, INK, 10);
  ell(g, cx, 44, 12, 8);
  stroke(g, "#c8a04a", 5);
  g.beginPath();
  g.moveTo(24, 96);
  g.quadraticCurveTo(cx, 40, 104, 96);
  g.closePath();
  sticker(g, lin(g, 0, 50, 0, 96, ["#ffe27a", "#b8781a"]), 5, "#3a2004");
  g.beginPath();
  g.moveTo(30, 100);
  g.lineTo(98, 100);
  g.lineTo(90, 380);
  g.lineTo(38, 380);
  g.closePath();
  sticker(g, lin(g, 0, 100, 0, 380, ["#fff6c0", "#ffc85a", "#ff9a2a"]), 5, "#3a2004");
  g.fillStyle = "#3a2004";
  g.fillRect(cx - 3, 100, 6, 280);
  ell(g, cx, 240, 20, 60);
  fill(g, "rgba(255,255,255,0.5)");
  g.beginPath();
  g.moveTo(30, 380);
  g.lineTo(98, 380);
  g.lineTo(108, 430);
  g.lineTo(20, 430);
  g.closePath();
  sticker(g, lin(g, 0, 380, 0, 430, ["#d8a83a", "#7a4a0a"]), 5, "#3a2004");
  g.beginPath();
  rr(g, 36, 430, 56, 30, 8);
  sticker(g, lin(g, 0, 430, 0, 460, ["#d8a83a", "#7a4a0a"]), 4, "#3a2004");
}

function heart(g: Ctx2D): void {
  const cx = 168;
  const path = (k: number): void => {
    g.beginPath();
    g.moveTo(cx, 292 - (1 - k) * 20);
    g.bezierCurveTo(cx - 190 * k, 170, cx - 120 * k, 24 + (1 - k) * 60, cx, 104 + (1 - k) * 30);
    g.bezierCurveTo(cx + 120 * k, 24 + (1 - k) * 60, cx + 190 * k, 170, cx, 292 - (1 - k) * 20);
    g.closePath();
  };
  path(1);
  sticker(g, lin(g, 0, 40, 0, 300, ["#c8823e", "#9a5a26", "#6a3810"]), 10, "#2a1208");
  g.save();
  path(1);
  g.clip();
  const r = mulberry(19);
  for (let i = 0; i < 60; i += 1) {
    ell(g, 30 + r() * 280, 40 + r() * 250, 2 + r() * 3, 1.4 + r() * 2, r() * 3);
    fill(g, r() < 0.5 ? "rgba(70,30,6,0.3)" : "rgba(255,220,160,0.25)");
  }
  g.restore();
  g.save();
  g.setLineDash([2, 14]);
  path(0.82);
  stroke(g, "rgba(255,250,240,0.95)", 8);
  g.restore();
  // Zuckerguss-Blume in der Mitte
  for (let i = 0; i < 6; i += 1) {
    const a = (i * TAU) / 6;
    ell(g, cx + Math.cos(a) * 26, 168 + Math.sin(a) * 26, 15, 15);
    fill(g, "#fffaf0");
  }
  sphere(g, cx, 168, 15, ["#ffe27a", "#e8a80c", "#8a5a08"], 0);
  glint4(g, 112, 96, 14, 0.85);
}

// --- Verzeichnis ----------------------------------------------------------------------------------------------

export const WINTER_FALLBACK: Record<string, Fallback> = {
  "winter-snowman": { w: 335, h: 512, paint: snowman },
  "winter-presents": {
    w: 245,
    h: 512,
    paint: presents,
    lights: [497, 92, 22, 490, 388, 20, 526, 590, 20, 508, 788, 20],
  },
  "winter-tree": {
    w: 291,
    h: 512,
    paint: tree,
    lights: [337, 773, 12, 655, 800, 12, 502, 645, 12, 310, 610, 12, 701, 613, 12, 433, 480, 12, 605, 465, 12, 357, 328, 12, 550, 344, 12, 502, 196, 12, 498, 50, 26],
  },
  "winter-candycane": { w: 512, h: 392, paint: candycane },
  "winter-iceblock": { w: 488, h: 512, paint: iceblock },
  "winter-stall": {
    w: 512,
    h: 511,
    paint: stall,
    lights: [100, 340, 9, 240, 360, 9, 470, 380, 9, 650, 380, 9, 800, 340, 9, 940, 330, 9, 300, 620, 9, 720, 620, 9],
  },
  "winter-kessel": { w: 444, h: 512, paint: kessel, lights: [500, 900, 60, 380, 355, 20, 500, 350, 20] },
  "winter-gingerbread": { w: 434, h: 512, paint: gingerbread },
  "winter-krampus": { w: 507, h: 512, paint: krampus },
  "winter-sled": { w: 512, h: 261, paint: sled },
  "winter-elf": { w: 484, h: 512, paint: elf },
  "winter-snowball": { w: 256, h: 183, paint: snowball },
  "winter-star": { w: 256, h: 256, paint: starProp },
  "winter-lantern": { w: 128, h: 512, paint: lantern, lights: [500, 240, 30] },
  lebkuchenherz: { w: 336, h: 314, paint: heart },
};

// --- Eiszapfen-Balken (beliebige Breite; wird in SpriteCache.custom pro Breitenstufe gebacken) --------------------

/** Vordach mit Eiszapfen: Schneeleiste oben, darunter Reihen gläserner Zapfen; w × h = logische Maße der Trefferfläche */
export function paintIcicleBar(g: Ctx2D, w: number, h: number): void {
  const r = mulberry(Math.round(w) * 7 + 3);
  const beamH = Math.max(24, h * 0.13);
  // Zapfen (hintere Reihe dunkler, vordere heller)
  const spikes: Array<{ x: number; len: number; bw: number; back: boolean }> = [];
  for (let x = 14; x < w - 10; x += 21 + r() * 10) spikes.push({ x, len: h * (0.5 + r() * 0.5), bw: 8 + r() * 6, back: r() < 0.4 });
  spikes.sort((a, b) => Number(b.back) - Number(a.back));
  for (const s of spikes) {
    const top = beamH - 4;
    const tip = Math.min(h - 2, top + s.len);
    g.beginPath();
    g.moveTo(s.x - s.bw, top);
    g.quadraticCurveTo(s.x - s.bw * 0.7, top + (tip - top) * 0.6, s.x + 0.6, tip);
    g.quadraticCurveTo(s.x + s.bw * 0.7, top + (tip - top) * 0.6, s.x + s.bw, top);
    g.closePath();
    const c = s.back ? ["#8ed2f4", "#5aaee0", "#3a80c0"] : ["#dff8ff", "#9ee2fa", "#54b2ec"];
    sticker(g, lin(g, s.x - s.bw, 0, s.x + s.bw, 0, c), 2.6, "#173a5c");
    g.beginPath();
    g.moveTo(s.x - s.bw * 0.42, top + 5);
    g.lineTo(s.x - s.bw * 0.06, tip - (tip - top) * 0.22);
    stroke(g, s.back ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.9)", 2);
  }
  // Balken
  g.beginPath();
  rr(g, 0, 6, w, beamH - 2, 6);
  sticker(g, lin(g, 0, 6, 0, beamH + 4, ["#8a5a30", "#4a2a12"]), 3, "#0f0a0c");
  g.beginPath();
  g.moveTo(6, beamH * 0.62 + 4);
  g.lineTo(w - 6, beamH * 0.62 + 4);
  stroke(g, "rgba(255,255,255,0.22)", 2);
  snowCap(g, -2, w + 2, 8, Math.max(5, beamH * 0.36), 3, Math.round(w));
  glint4(g, w * 0.3, beamH + 14, 9, 0.8);
  glint4(g, w * 0.72, beamH + 26, 7, 0.7);
}
