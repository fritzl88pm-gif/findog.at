/**
 * Alpenpanorama – vorgerenderte Kulissen-Kacheln (einmal pro Stimmungsstufe gebacken, pro Frame nur geblittet):
 * Himmel, ferne Hügel, Almhänge mit Wäldern, nahe Tannen, Boden (Almrasen → Fels → Gletscher), Schluchtwand,
 * Wolken, Nebelschwaden, Tannen-Sprites. Alle Kacheln sind horizontal periodisch (nahtlos).
 */
import { paint, type Ctx2D } from "../shared-b/canvas";
import type { GradeStep } from "../shared-b/layers";
import { hexRgb, mixRgb, css, h1, mulberry, type RGB } from "../shared-b/color";
import { STAGE_PAL, SNOWCOVER, STARS } from "./stages";

const TAU = Math.PI * 2;

// --- Farbhilfen -------------------------------------------------------------------------------------

export function mixHex(a: string, b: string, t: number): string {
  return css(mixRgb(hexRgb(a), hexRgb(b), t));
}

function shadeRgb(c: RGB, k: number): string {
  return css([Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)]);
}

/**
 * Mischmodus (multiply, soft-light, saturation …) nur dort anwenden, wo die Kachel bereits deckt – Canvas-Mischmodi
 * würden sonst auch transparente Bereiche einfärben.
 */
export function blendMasked(g: Ctx2D, w: number, h: number, mode: GlobalCompositeOperation, color: string, alpha: number): void {
  const src = g.canvas;
  const tmp = paint(w, h, (t) => {
    t.drawImage(src, 0, 0, w, h);
    t.globalCompositeOperation = mode;
    t.globalAlpha = alpha;
    t.fillStyle = color;
    t.fillRect(0, 0, w, h);
    t.globalAlpha = 1;
    t.globalCompositeOperation = "destination-in";
    t.drawImage(src, 0, 0, w, h);
  });
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = "copy";
  g.drawImage(tmp, 0, 0);
  g.restore();
}

/**
 * Stufen-Farbstimmung (Morgengold, Wind-Entsättigung, Alpenglühen) auf eine fertige Kachel legen: die Mischmodi-Durchgänge.
 * Rückgabe false = diese Stufe hat keine Stimmungsmischung (nichts zu tun).
 */
export function moodLayer(g: Ctx2D, w: number, h: number, stage: number): boolean {
  if (stage === 4) {
    blendMasked(g, w, h, "multiply", "#a99ccf", 1);
    blendMasked(g, w, h, "soft-light", "#ff9a70", 0.35);
  } else if (stage === 3) blendMasked(g, w, h, "saturation", "#808080", 0.3);
  else if (stage === 0) blendMasked(g, w, h, "soft-light", "#ffd98a", 0.35);
  else return false;
  return true;
}

/** Dunstverlauf der Stufe über die ganze Kachel (nur wo sie deckt) */
export function hazeLayer(g: Ctx2D, w: number, h: number, stage: number, hazeTop: number, hazeBottom: number): void {
  const P = STAGE_PAL[stage];
  g.save();
  g.globalCompositeOperation = "source-atop";
  const grd = g.createLinearGradient(0, 0, 0, h);
  const hz = hexRgb(P.haze);
  grd.addColorStop(0, css(hz, hazeTop));
  grd.addColorStop(1, css(hz, hazeBottom));
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  g.restore();
}

/** Stimmung + Dunst in einem Zug (`moodLayer` dann `hazeLayer`) */
export function gradeLayer(g: Ctx2D, w: number, h: number, stage: number, hazeTop: number, hazeBottom: number): void {
  moodLayer(g, w, h, stage);
  hazeLayer(g, w, h, stage, hazeTop, hazeBottom);
}

/**
 * Dunstverlauf (oben, unten) je Ebene; `paintX(…, grade = false)` + die Schritte `GRADE_FAR/MID/NEAR` (Stimmung, dann Dunst)
 * ergeben dasselbe Bild wie `paintX(…, true)` – in zwei kleinen statt einem großen Schritt.
 */
const FAR_GRADE = [0.45, 0.2] as const;
const MID_GRADE = [0.26, 0.08] as const;
const NEAR_GRADE = [0.14, 0.18] as const;

function gradeSteps(haze: readonly [number, number]): GradeStep[] {
  return [
    (c, stage) => {
      const g = c.getContext("2d");
      return g ? moodLayer(g, c.width, c.height, stage) : false;
    },
    (c, stage) => {
      const g = c.getContext("2d");
      if (g) hazeLayer(g, c.width, c.height, stage, haze[0], haze[1]);
    },
  ];
}

export const GRADE_FAR = gradeSteps(FAR_GRADE);
const midGrade = gradeSteps(MID_GRADE);
/** Rest des Rohbilds (zwei Teile), dann Stimmung und Dunst (Schritte wie bei den anderen Ebenen) */
export const GRADE_MID: GradeStep[] = [
  (c) => continueMid(c),
  (c) => continueMid(c),
  (c, stage) => {
    finishMid(c); // Schutz: sollte der Rest noch ausstehen, kommt er vor der Stimmung
    return midGrade[0](c, stage);
  },
  midGrade[1],
];
export const GRADE_NEAR = gradeSteps(NEAR_GRADE);

// --- Himmel -----------------------------------------------------------------------------------------

export function paintSky(stage: number, reuse?: HTMLCanvasElement | null): HTMLCanvasElement {
  const P = STAGE_PAL[stage];
  return paint(1280, 600, (g) => {
    const grd = g.createLinearGradient(0, 0, 0, 600);
    grd.addColorStop(0, P.top);
    grd.addColorStop(0.5, P.mid);
    grd.addColorStop(1, P.low);
    g.fillStyle = grd;
    g.fillRect(0, 0, 1280, 600);
    const st = STARS[stage];
    if (st > 0.01) {
      const r = mulberry(77);
      for (let i = 0; i < 160; i += 1) {
        const y = r() * 260;
        const a = st * (1 - y / 280) * (0.4 + r() * 0.6);
        g.fillStyle = `rgba(255,248,235,${a.toFixed(3)})`;
        const s = r() < 0.9 ? 0.8 + r() * 0.8 : 1.6 + r();
        g.beginPath();
        g.arc(r() * 1280, y, s, 0, TAU);
        g.fill();
      }
    }
  }, reuse);
}

// --- Wolken -----------------------------------------------------------------------------------------

/** Weiche Haufenwolke (sonnig beleuchtet von rechts oben). `warm` = Abendrot-Variante. */
export function paintCloud(seed: number, w: number, h: number, warm: boolean): HTMLCanvasElement {
  return paint(w, h, (g) => {
    const r = mulberry(seed * 31 + 7);
    const n = 14;
    const blobs: Array<[number, number, number]> = [];
    for (let i = 0; i < n; i += 1) {
      const u = i / (n - 1);
      const bump = Math.sin(u * Math.PI);
      const rad = (h * 0.18 + r() * h * 0.14) * (0.55 + bump * 0.7);
      const x = w * 0.12 + u * w * 0.76 + (r() - 0.5) * 30;
      const y = h * 0.72 - bump * h * 0.28 - r() * h * 0.12;
      blobs.push([x, y, rad]);
    }
    const shadow = warm ? "rgba(150,88,120,0.95)" : "rgba(170,190,215,0.95)";
    const body = warm ? "rgba(255,190,170,1)" : "rgba(246,249,252,1)";
    const light = warm ? "rgba(255,226,170,1)" : "rgba(255,255,255,1)";
    // Schattenseite (unten links) → Körper → Lichtkante (oben rechts)
    g.fillStyle = shadow;
    for (const [x, y, rad] of blobs) {
      g.beginPath();
      g.arc(x - rad * 0.12, y + rad * 0.18, rad, 0, TAU);
      g.fill();
    }
    g.fillStyle = body;
    for (const [x, y, rad] of blobs) {
      g.beginPath();
      g.arc(x, y, rad * 0.92, 0, TAU);
      g.fill();
    }
    g.fillStyle = light;
    for (const [x, y, rad] of blobs) {
      g.beginPath();
      g.arc(x + rad * 0.22, y - rad * 0.26, rad * 0.62, 0, TAU);
      g.fill();
    }
    // flache Unterkante
    g.globalCompositeOperation = "destination-out";
    const cut = g.createLinearGradient(0, h * 0.74, 0, h);
    cut.addColorStop(0, "rgba(0,0,0,0)");
    cut.addColorStop(0.35, "rgba(0,0,0,0.85)");
    cut.addColorStop(1, "rgba(0,0,0,1)");
    g.fillStyle = cut;
    g.fillRect(0, h * 0.74, w, h * 0.26);
    g.globalCompositeOperation = "source-over";
  });
}

/** Langgezogene Nebelschwade */
export function paintMist(w: number, h: number, color: string): HTMLCanvasElement {
  return paint(w, h, (g) => {
    const r = mulberry(4242);
    for (let i = 0; i < 26; i += 1) {
      const x = r() * w;
      const y = h * (0.35 + r() * 0.3);
      const rx = 60 + r() * 140;
      const ry = 16 + r() * 22;
      const grd = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      grd.addColorStop(0, color);
      grd.addColorStop(1, "rgba(255,255,255,0)");
      g.save();
      g.translate(x, y);
      g.scale(rx, ry);
      g.fillStyle = grd;
      g.globalAlpha = 0.35 + r() * 0.35;
      g.beginPath();
      g.arc(0, 0, 1, 0, TAU);
      g.fill();
      g.restore();
      // periodisch: Kopie über den Rand
      if (x + rx > w || x - rx < 0) {
        const xx = x + rx > w ? x - w : x + w;
        g.save();
        g.translate(xx, y);
        g.scale(rx, ry);
        g.fillStyle = grd;
        g.globalAlpha = 0.35;
        g.beginPath();
        g.arc(0, 0, 1, 0, TAU);
        g.fill();
        g.restore();
      }
    }
  });
}

// --- Tannen -----------------------------------------------------------------------------------------

export interface FirColors {
  dark: string;
  mid: string;
  light: string;
  trunk: string;
}

/**
 * Fichte mit hängenden Astkränzen (Licht von rechts oben): jede Etage ist links schattig, rechts sonnig, die
 * Unterkante nadelig gezackt; Schnee liegt als Band auf den Oberseiten der Äste.
 */
export function drawFir(g: Ctx2D, x: number, base: number, h: number, c: FirColors, snow: number, seed: number): void {
  const r = mulberry(seed);
  const maxHalf = h * (0.2 + r() * 0.05);
  const top = base - h;
  // Stamm
  g.fillStyle = c.trunk;
  g.fillRect(x - h * 0.022, base - h * 0.16, h * 0.044, h * 0.17);
  const tiers = Math.max(4, Math.min(11, Math.round(h / 17)));
  const crown = h * 0.88;
  const step = crown / tiers;
  const lean = (r() - 0.5) * h * 0.03;
  for (let i = 0; i < tiers; i += 1) {
    const u = (i + 1) / tiers;
    const yt = top + i * step * 0.92;
    const th = step * 1.7;
    const yb = yt + th;
    const half = maxHalf * (0.16 + 0.84 * Math.pow(u, 0.85)) * (0.9 + r() * 0.2);
    const droop = th * 0.18;
    const tx = x + lean * (1 - u);
    for (const side of [-1, 1] as const) {
      const tipX = tx + side * half;
      const tipY = yb + droop;
      g.fillStyle = side < 0 ? c.dark : c.mid;
      g.beginPath();
      g.moveTo(tx, yt);
      g.quadraticCurveTo(tx + side * half * 0.45, yt + th * 0.3, tipX, tipY);
      // nadelige Unterkante zurück zum Stamm
      const teeth = 3 + Math.floor(half / 14);
      for (let k = 1; k <= teeth; k += 1) {
        const v = k / teeth;
        const px = tipX - side * half * v;
        const py = tipY - th * 0.12 * v + (k % 2 ? th * 0.1 : -th * 0.02);
        g.lineTo(px, py);
      }
      g.lineTo(tx, yb - th * 0.1);
      g.closePath();
      g.fill();
    }
    // Streiflicht auf der Sonnenseite
    g.strokeStyle = c.light;
    g.globalAlpha = 0.55;
    g.lineWidth = Math.max(1, h * 0.007);
    g.beginPath();
    g.moveTo(tx + half * 0.12, yt + th * 0.12);
    g.quadraticCurveTo(tx + half * 0.5, yt + th * 0.36, tx + half * 0.95, yb + droop - 1);
    g.stroke();
    g.globalAlpha = 1;
    if (snow > 0.3 && r() < 0.3 + snow * 0.32) {
      const sh = th * (0.08 + snow * 0.1) * (0.6 + r() * 0.6);
      for (const side of [-1, 1] as const) {
        g.fillStyle = side < 0 ? `rgba(200,214,236,${Math.min(1, snow).toFixed(3)})` : `rgba(250,252,255,${Math.min(1, 0.3 + snow * 0.7).toFixed(3)})`;
        const ext = half * (0.4 + snow * 0.45) * (0.7 + r() * 0.3);
        g.beginPath();
        g.moveTo(tx, yt - 1);
        g.quadraticCurveTo(tx + side * ext * 0.45, yt + th * 0.25 - 1, tx + side * ext, yt + th * 0.62 + droop * 0.5);
        g.quadraticCurveTo(tx + side * ext * 0.45, yt + th * 0.25 + sh, tx, yt + sh);
        g.closePath();
        g.fill();
      }
    }
  }
  // Wipfel
  g.strokeStyle = c.dark;
  g.lineWidth = Math.max(1, h * 0.012);
  g.beginPath();
  g.moveTo(x + lean, top - h * 0.04);
  g.lineTo(x + lean, top + step);
  g.stroke();
}

/** Farbvarianten für Nadelbäume (sattgrün, bläulich, gelblich) */
export function firVariant(base: FirColors, k: number): FirColors {
  if (k < 0.34) return base;
  const tint = k < 0.67 ? "#3c6a78" : "#5f8a3a";
  return { dark: mixHex(base.dark, tint, 0.14), mid: mixHex(base.mid, tint, 0.16), light: mixHex(base.light, tint, 0.12), trunk: base.trunk };
}

// --- Hügel-Ebenen -------------------------------------------------------------------------------------

export interface RidgeSpec {
  W: number;
  base: number;
  terms: Array<[k: number, amp: number, ph: number]>;
}

/** Periodische Kammlinie (y in Kachelkoordinaten). */
export function ridgeY(R: RidgeSpec, x: number): number {
  let y = R.base;
  for (const [k, a, ph] of R.terms) y -= a * Math.sin((x / R.W) * TAU * k + ph);
  return y;
}

export const FAR_RIDGE: RidgeSpec = {
  W: 2048,
  base: 92,
  terms: [
    [1, 18, 0.4],
    [2, 22, 2.1],
    [5, 12, 0.9],
    [9, 6, 4.2],
    [17, 3, 1.3],
  ],
};

export const MID_RIDGE: RidgeSpec = {
  W: 2048,
  base: 108,
  terms: [
    [1, 14, 1.7],
    [3, 18, 0.2],
    [4, 9, 2.9],
    [7, 5, 1.1],
    [13, 2, 0.4],
  ],
};

export const NEAR_RIDGE: RidgeSpec = {
  W: 2048,
  base: 300,
  terms: [
    [1, 14, 0.9],
    [2, 18, 3.3],
    [5, 8, 1.9],
    [11, 3, 0.6],
  ],
};

/** Ferne Waldhügel (Parallax ~0.1), bläulich-grün im Dunst. H = 230. */
export function paintFarHills(stage: number, reuse?: HTMLCanvasElement | null, grade = true): HTMLCanvasElement {
  const R = FAR_RIDGE;
  const W = R.W;
  const H = 230;
  const snow = SNOWCOVER[stage];
  return paint(W, H, (g) => {
    const green = mixHex("#5f8f70", "#dfe8ee", snow * 0.85);
    const deep = mixHex("#3f6b58", "#9fb2c4", snow * 0.7);
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 4) g.lineTo(x, ridgeY(R, x));
    g.lineTo(W, H);
    g.closePath();
    const grd = g.createLinearGradient(0, 40, 0, H);
    grd.addColorStop(0, green);
    grd.addColorStop(1, deep);
    g.fillStyle = grd;
    g.fill();
    // Waldkronen entlang der Hänge
    const r = mulberry(11 + stage);
    const treeCol = mixHex("#2f5a48", "#8095a8", snow * 0.8);
    g.fillStyle = treeCol;
    for (let i = 0; i < 900; i += 1) {
      const x = r() * W;
      const ry = ridgeY(R, x);
      const y = ry + 6 + r() * (H - ry) * 0.9;
      if (r() < 0.35 + snow * 0.4) continue;
      const th = 7 + r() * 6;
      g.beginPath();
      g.moveTo(x, y - th);
      g.lineTo(x - th * 0.32, y);
      g.lineTo(x + th * 0.32, y);
      g.closePath();
      g.fill();
      if (x < 8) {
        g.beginPath();
        g.moveTo(x + W, y - th);
        g.lineTo(x + W - th * 0.32, y);
        g.lineTo(x + W + th * 0.32, y);
        g.fill();
      }
    }
    // Lichtkante auf dem Kamm
    g.strokeStyle = `rgba(255,250,235,${(0.35 - snow * 0.1).toFixed(3)})`;
    g.lineWidth = 1.5;
    g.beginPath();
    for (let x = 0; x <= W; x += 4) {
      const y = ridgeY(R, x) + 1;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    if (grade) gradeLayer(g, W, H, stage, FAR_GRADE[0], FAR_GRADE[1]);
  }, reuse);
}

/** Almhänge mit Wäldern, Wiesen, Felsen, Wegen, Zäunen und Kühen (Parallax ~0.2). H = 250. */
const MID_H = 250;

/**
 * Rohbild der Mittelhügel in drei Teilen (`yield` dazwischen): Hang, Flecken, Fels, Weg · erste Hälfte der Wälder ·
 * zweite Hälfte, Zäune/Kühe und Kammlicht. Die Zeichenbefehle sind dieselben wie am Stück (`r` läuft durch alle Teile).
 */
function* midSteps(g: Ctx2D, stage: number): Generator<void, void, void> {
  const R = MID_RIDGE;
  const W = R.W;
  const H = MID_H;
  const snow = SNOWCOVER[stage];
  const rock = [0.1, 0.12, 0.45, 0.6, 0.5][stage];
  const P = STAGE_PAL[stage];
  const meadowTop = mixHex(P.grass, "#f4f7fb", snow * 0.92);
  const meadowBot = mixHex(P.grassDark, "#b9c9da", snow * 0.8);
  // Hang
  g.beginPath();
  g.moveTo(0, H);
  for (let x = 0; x <= W; x += 4) g.lineTo(x, ridgeY(R, x));
  g.lineTo(W, H);
  g.closePath();
  const grd = g.createLinearGradient(0, 40, 0, H);
  grd.addColorStop(0, meadowTop);
  grd.addColorStop(1, meadowBot);
  g.fillStyle = grd;
  g.fill();
  g.save();
  g.clip();
  const r = mulberry(101 + stage * 7);
  // Wiesenflecken / Licht-Schatten-Mulden
  for (let i = 0; i < 70; i += 1) {
    const x = r() * W;
    const y = ridgeY(R, x) + 20 + r() * 150;
    const rx = 40 + r() * 120;
    g.fillStyle = r() < 0.5 ? `rgba(255,250,210,${(0.1 + r() * 0.08).toFixed(3)})` : `rgba(20,50,40,${(0.08 + r() * 0.06).toFixed(3)})`;
    g.beginPath();
    g.ellipse(x, y, rx, rx * 0.22, 0, 0, TAU);
    g.fill();
  }
  // Felsaufschlüsse
  const rockCol = mixHex("#8a8f96", "#aeb8c4", snow * 0.5);
  for (let i = 0; i < 26 * rock + 6; i += 1) {
    const x = r() * W;
    const y = ridgeY(R, x) + 10 + r() * 90;
    const s = 10 + r() * 26;
    g.fillStyle = rockCol;
    g.beginPath();
    g.moveTo(x - s, y + s * 0.4);
    g.lineTo(x - s * 0.4, y - s * 0.5);
    g.lineTo(x + s * 0.3, y - s * 0.3);
    g.lineTo(x + s, y + s * 0.4);
    g.closePath();
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.28)";
    g.beginPath();
    g.moveTo(x - s * 0.4, y - s * 0.5);
    g.lineTo(x + s * 0.3, y - s * 0.3);
    g.lineTo(x + s * 0.5, y);
    g.closePath();
    g.fill();
    if (snow > 0.2) {
      g.fillStyle = "rgba(250,252,255,0.9)";
      g.beginPath();
      g.moveTo(x - s * 0.6, y - s * 0.1);
      g.lineTo(x - s * 0.4, y - s * 0.5);
      g.lineTo(x + s * 0.3, y - s * 0.3);
      g.lineTo(x + s * 0.6, y);
      g.closePath();
      g.fill();
    }
  }
  // Serpentinenweg
  g.strokeStyle = snow > 0.6 ? "rgba(170,185,205,0.6)" : "rgba(214,196,150,0.75)";
  g.lineWidth = 2.2;
  g.beginPath();
  for (let x = 0; x <= W; x += 8) {
    const y = ridgeY(R, x) + 60 + Math.sin((x / W) * TAU * 6) * 34;
    if (x === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  yield; // Ende des ersten Teils (Hang, Flecken, Fels, Weg)
  // Waldstücke
  const fir: FirColors = {
    dark: mixHex("#1f4632", "#6c7f93", snow * 0.55),
    mid: mixHex("#2f6a42", "#7f94a8", snow * 0.5),
    light: mixHex("#5d9a55", "#c2d0de", snow * 0.5),
    trunk: "#3b2a1f",
  };
  const clusters = 14;
  for (let cI = 0; cI < clusters; cI += 1) {
    if (cI === clusters >> 1) yield; // Mitte der Wälder
    const cx = (cI + r() * 0.6) * (W / clusters);
    const spread = 50 + r() * 110;
    const n = 10 + Math.floor(r() * 16);
    for (let k = 0; k < n; k += 1) {
      let x = cx + (r() - 0.5) * spread * 2;
      x = ((x % W) + W) % W;
      const y = ridgeY(R, x) + 14 + r() * 110;
      const h = 20 + r() * 22 + (y - ridgeY(R, x)) * 0.12;
      const fv = firVariant(fir, r());
      drawFir(g, x, y, h, fv, snow, cI * 100 + k);
      if (x + h * 0.25 > W) drawFir(g, x - W, y, h, fv, snow, cI * 100 + k);
      if (x - h * 0.25 < 0) drawFir(g, x + W, y, h, fv, snow, cI * 100 + k);
    }
  }
  // Zäune & Kühe (nur grüne Stufen)
  if (snow < 0.5) {
    g.strokeStyle = "rgba(92,64,40,0.8)";
    g.lineWidth = 1.2;
    for (let f = 0; f < 5; f += 1) {
      const x0 = r() * (W - 240) + 20;
      const len = 80 + r() * 140;
      g.beginPath();
      for (let x = x0; x < x0 + len; x += 10) {
        const y = ridgeY(R, x) + 40 + (x - x0) * 0.08;
        g.moveTo(x, y);
        g.lineTo(x, y - 7);
      }
      const ys = ridgeY(R, x0) + 40;
      g.moveTo(x0, ys - 5);
      g.lineTo(x0 + len, ridgeY(R, x0 + len) + 40 + len * 0.08 - 5);
      g.stroke();
    }
    for (let k = 0; k < 16; k += 1) {
      const x = 20 + r() * (W - 40);
      const y = ridgeY(R, x) + 30 + r() * 80;
      const s = 0.8 + r() * 0.4;
      g.fillStyle = "#f7f3ea";
      g.fillRect(x - 5 * s, y - 4 * s, 10 * s, 5 * s);
      g.fillStyle = "#7a4a2a";
      g.fillRect(x - 2 * s, y - 4 * s, 4 * s, 3 * s);
      g.fillStyle = "#3a2a20";
      g.fillRect(x + (r() < 0.5 ? 4 : -7) * s, y - 4 * s, 3 * s, 3 * s);
      g.fillRect(x - 4 * s, y + 1 * s, 1.2, 2.5 * s);
      g.fillRect(x + 3 * s, y + 1 * s, 1.2, 2.5 * s);
    }
  }
  g.restore();
  // Kammlicht
  g.strokeStyle = `rgba(255,250,230,${(0.5 - snow * 0.2).toFixed(3)})`;
  g.lineWidth = 2;
  g.beginPath();
  for (let x = 0; x <= W; x += 4) {
    const y = ridgeY(R, x) + 1;
    if (x === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
}

/** Unfertig gemaltes Rohbild der Mittelhügel: `step()` malt den nächsten Teil, true = fertig */
export interface MidBuild {
  readonly canvas: HTMLCanvasElement;
  step(): boolean;
}

/** Rohbild der Mittelhügel in Teilschritten (Stimmung/Dunst folgen mit `GRADE_MID` bzw. `paintMidHills(…, true)`) */
export function startMidHills(stage: number, reuse?: HTMLCanvasElement | null): MidBuild {
  if (reuse) midPending.delete(reuse); // ein früher angefangener Bau dieser (wiederverwendeten) Fläche ist hinfällig
  let gen: Generator<void, void, void> | null = null;
  const canvas = paint(MID_RIDGE.W, MID_H, (g) => {
    gen = midSteps(g, stage);
  }, reuse);
  return {
    canvas,
    step(): boolean {
      if (!gen) return true;
      if (!gen.next().done) return false;
      gen = null;
      return true;
    },
  };
}

/** Almhänge am Stück (`grade`: Stimmung und Dunst gleich mit anwenden) */
export function paintMidHills(stage: number, reuse?: HTMLCanvasElement | null, grade = true): HTMLCanvasElement {
  const b = startMidHills(stage, reuse);
  while (!b.step()) {
    // weiter bis zum Ende
  }
  if (grade) {
    const g = b.canvas.getContext("2d");
    if (g) gradeLayer(g, MID_RIDGE.W, MID_H, stage, MID_GRADE[0], MID_GRADE[1]);
  }
  return b.canvas;
}

/** angefangene Rohbilder der Mittelhügel (Schlüssel: die Fläche; für `gradedCache`, siehe `paintMidBase`) */
const midPending = new WeakMap<HTMLCanvasElement, MidBuild>();

/** Rohbild für `gradedCache`: ohne `grade` nur der erste Teil, der Rest folgt in den ersten Schritten von `GRADE_MID` */
export function paintMidBase(stage: number, reuse: HTMLCanvasElement | null, grade: boolean): HTMLCanvasElement {
  if (grade) return paintMidHills(stage, reuse, true);
  const b = startMidHills(stage, reuse);
  if (!b.step()) midPending.set(b.canvas, b);
  return b.canvas;
}

/** nächsten Teil des angefangenen Rohbilds malen; false, wenn nichts (mehr) aussteht */
function continueMid(c: HTMLCanvasElement): boolean {
  const b = midPending.get(c);
  if (!b) return false;
  if (b.step()) midPending.delete(c);
  return true;
}

/** Rest des Rohbilds am Stück malen (bevor die Stimmung daraufgelegt wird) */
function finishMid(c: HTMLCanvasElement): void {
  const b = midPending.get(c);
  if (!b) return;
  midPending.delete(c);
  while (!b.step()) {
    // weiter bis zum Ende
  }
}

/** Nahe Tannen auf einem Hangrücken (Parallax ~0.5). H = 360, Kammlinie ≈ 300. */
export function paintNearTrees(stage: number, reuse?: HTMLCanvasElement | null, grade = true): HTMLCanvasElement {
  const R = NEAR_RIDGE;
  const W = R.W;
  const H = 360;
  const snow = SNOWCOVER[stage];
  return paint(W, H, (g) => {
    const P = STAGE_PAL[stage];
    const fir: FirColors = {
      dark: mixHex("#24503a", "#5a6b80", snow * 0.5),
      mid: mixHex("#356f47", "#6e8298", snow * 0.45),
      light: mixHex("#7fb866", "#c8d4e2", snow * 0.45),
      trunk: "#3a2618",
    };
    const r = mulberry(500 + stage);
    // Bäume in Gruppen, dazwischen Lichtungen (Blick auf die Berge frei)
    const groups = [
      [120, 5],
      [520, 3],
      [860, 6],
      [1310, 2],
      [1600, 5],
      [1930, 3],
    ] as const;
    const trees: Array<[number, number, number, number]> = [];
    for (const [gx, n] of groups) {
      for (let k = 0; k < n; k += 1) {
        const x = gx + (r() - 0.5) * 170;
        const h = 150 + r() * 170;
        trees.push([x, ridgeY(R, x) + 14 + r() * 20, h, Math.floor(r() * 9999)]);
      }
    }
    trees.sort((a, b) => a[2] - b[2]);
    for (const [x, y, h, sd] of trees) {
      const fv = firVariant(fir, h1(sd));
      for (const off of [0, -W, W]) {
        const xx = x + off;
        if (xx + h * 0.3 < 0 || xx - h * 0.3 > W) continue;
        drawFir(g, xx, y, h, fv, snow, sd);
      }
    }
    // Hangrücken
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 4) g.lineTo(x, ridgeY(R, x));
    g.lineTo(W, H);
    g.closePath();
    const grd = g.createLinearGradient(0, 270, 0, H);
    grd.addColorStop(0, mixHex(P.grassDark, "#e9eef5", snow * 0.9));
    grd.addColorStop(1, mixHex("#274a27", "#9fb0c4", snow * 0.7));
    g.fillStyle = grd;
    g.fill();
    // Felsbrocken & Grasbüschel am Kamm
    for (let i = 0; i < 40; i += 1) {
      const x = r() * W;
      const y = ridgeY(R, x) + 4;
      if (r() < 0.3) {
        const s = 8 + r() * 14;
        g.fillStyle = mixHex("#6d7278", "#c7d0dc", snow * 0.6);
        g.beginPath();
        g.ellipse(x, y, s, s * 0.55, 0, Math.PI, TAU);
        g.fill();
      } else {
        g.strokeStyle = mixHex("#3f7a35", "#dfe6ee", snow * 0.8);
        g.lineWidth = 1.5;
        g.beginPath();
        for (let b = -3; b <= 3; b += 1) {
          g.moveTo(x + b * 2, y + 2);
          g.lineTo(x + b * 3.2, y - 6 - Math.abs(b) * -1 - r() * 5);
        }
        g.stroke();
      }
    }
    if (grade) gradeLayer(g, W, H, stage, NEAR_GRADE[0], NEAR_GRADE[1]);
  }, reuse);
}

// --- Boden --------------------------------------------------------------------------------------------

export const GROUND_TOP = 22;
export const GROUND_TILE_W = 1024;
export const GROUND_TILE_H = 152;

/**
 * Bodenkachel (Almrasen → Bergwiese mit Steinen → Fels mit Schneeflecken → Schnee/Gletschereis).
 * Kachel wird bei groundY − GROUND_TOP gezeichnet; Grashalme ragen über die Kante.
 */
export function paintGround(stage: number, reuse?: HTMLCanvasElement | null): HTMLCanvasElement {
  const W = GROUND_TILE_W;
  const H = GROUND_TILE_H;
  const T = GROUND_TOP;
  const snow = SNOWCOVER[stage];
  return paint(W, H, (g) => {
    const P = STAGE_PAL[stage];
    const r = mulberry(900 + stage);
    // Erdreich / Fels / Eis im Querschnitt
    const soilTop = snow > 0.9 ? "#dfeaf6" : mixHex("#7a5a3c", "#8c8f98", Math.min(1, snow * 1.3));
    const soilBot = snow > 0.9 ? "#7fa3c8" : mixHex("#3b2a1e", "#4a4f5a", Math.min(1, snow * 1.3));
    const grd = g.createLinearGradient(0, T, 0, H);
    grd.addColorStop(0, soilTop);
    grd.addColorStop(1, soilBot);
    g.fillStyle = grd;
    g.fillRect(0, T + 6, W, H - T - 6);
    if (snow > 0.9) {
      // Gletschereis: Schichtbänder + Risse
      for (let i = 0; i < 7; i += 1) {
        const y = T + 22 + i * 17 + r() * 6;
        g.fillStyle = `rgba(${i % 2 ? "150,200,240" : "235,248,255"},${(0.3 + r() * 0.25).toFixed(3)})`;
        g.beginPath();
        g.moveTo(0, y);
        for (let x = 0; x <= W; x += 32) g.lineTo(x, y + Math.sin((x / W) * TAU * (3 + i) + i) * 4);
        g.lineTo(W, y + 5);
        g.lineTo(0, y + 5);
        g.closePath();
        g.fill();
      }
      g.strokeStyle = "rgba(60,110,170,0.45)";
      g.lineWidth = 1.2;
      for (let i = 0; i < 18; i += 1) {
        const x = r() * W;
        const y = T + 30 + r() * 80;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (r() - 0.5) * 20, y + 12 + r() * 18);
        g.lineTo(x + (r() - 0.5) * 30, y + 30 + r() * 20);
        g.stroke();
      }
    } else if (snow > 0.3) {
      // Hochgebirge: kantiger Fels/Geröll im Querschnitt, mit Schnee in den Fugen
      const bg = g.createLinearGradient(0, T, 0, H);
      bg.addColorStop(0, "#7d828d");
      bg.addColorStop(1, "#4a4e58");
      g.fillStyle = bg;
      g.fillRect(0, T + 6, W, H - T - 6);
      for (let i = 0; i < 110; i += 1) {
        const x = r() * W;
        const y = T + 14 + r() * (H - T - 10);
        const s = 10 + r() * 18;
        const tone = 118 + Math.floor(r() * 56);
        const pts: Array<[number, number]> = [];
        const n = 5 + Math.floor(r() * 3);
        for (let k = 0; k < n; k += 1) {
          const a = (k / n) * TAU + r() * 0.5;
          const rad = s * (0.7 + r() * 0.4);
          pts.push([Math.cos(a) * rad, Math.sin(a) * rad * 0.7]);
        }
        for (const off of x + s > W ? [0, -W] : x - s < 0 ? [0, W] : [0]) {
          g.fillStyle = `rgb(${tone},${tone + 2},${tone + 8})`;
          g.beginPath();
          pts.forEach(([px, py], k) => (k ? g.lineTo(x + off + px, y + py) : g.moveTo(x + off + px, y + py)));
          g.closePath();
          g.fill();
          g.fillStyle = "rgba(255,255,255,0.16)";
          g.beginPath();
          g.moveTo(x + off + pts[0][0], y + pts[0][1]);
          for (let k = 1; k < Math.ceil(n / 2); k += 1) g.lineTo(x + off + pts[n - k][0], y + pts[n - k][1]);
          g.lineTo(x + off, y);
          g.closePath();
          g.fill();
        }
      }
      // Schneereste zwischen den Steinen
      g.fillStyle = "rgba(240,246,255,0.8)";
      for (let i = 0; i < 40; i += 1) {
        const x = r() * W;
        const y = T + 16 + r() * (H - T - 30);
        g.beginPath();
        g.ellipse(x, y, 6 + r() * 12, 2 + r() * 2.5, (r() - 0.5) * 0.4, 0, TAU);
        g.fill();
      }
      const dk = g.createLinearGradient(0, T, 0, H);
      dk.addColorStop(0, "rgba(30,36,50,0)");
      dk.addColorStop(1, "rgba(30,36,50,0.35)");
      g.fillStyle = dk;
      g.fillRect(0, T, W, H - T);
    } else {
      // Steine im Erdreich
      for (let i = 0; i < 70; i += 1) {
        const x = r() * W;
        const y = T + 22 + r() * (H - T - 30);
        const s = 4 + r() * (8 + snow * 10);
        const base = mixRgb(hexRgb("#8d8278"), hexRgb("#9aa0aa"), snow);
        g.fillStyle = shadeRgb(base, 0.8 + r() * 0.35);
        g.beginPath();
        g.ellipse(x, y, s, s * 0.62, r() * 0.8, 0, TAU);
        g.fill();
        g.fillStyle = "rgba(255,255,255,0.18)";
        g.beginPath();
        g.ellipse(x + s * 0.2, y - s * 0.25, s * 0.5, s * 0.25, 0, 0, TAU);
        g.fill();
        if (x + s > W) {
          g.fillStyle = shadeRgb(base, 0.95);
          g.beginPath();
          g.ellipse(x - W, y, s, s * 0.62, 0, 0, TAU);
          g.fill();
        }
      }
      // Wurzeln (grüne Stufen)
      if (snow < 0.3) {
        g.strokeStyle = "rgba(60,38,22,0.55)";
        g.lineWidth = 1.4;
        for (let i = 0; i < 16; i += 1) {
          const x = r() * W;
          g.beginPath();
          g.moveTo(x, T + 8);
          g.quadraticCurveTo(x + (r() - 0.5) * 30, T + 20 + r() * 10, x + (r() - 0.5) * 40, T + 30 + r() * 26);
          g.stroke();
        }
      }
    }
    // Deckschicht: Rasenkante bzw. Schneedecke
    const top = snow > 0.4 ? "#f6fbff" : mixHex(P.grass, "#f2f6fa", 0);
    const topDark = snow > 0.4 ? "#bcd2ea" : P.grassDark;
    const lip = g.createLinearGradient(0, T - 2, 0, T + 16);
    lip.addColorStop(0, top);
    lip.addColorStop(1, topDark);
    g.fillStyle = lip;
    g.beginPath();
    g.moveTo(0, T - 1);
    for (let x = 0; x <= W; x += 8) g.lineTo(x, T - 1 + Math.sin((x / W) * TAU * 16) * 1.2);
    const lipD = snow > 0.4 ? 17 : 12;
    for (let x = W; x >= 0; x -= 8) g.lineTo(x, T + lipD + Math.sin((x / W) * TAU * 11 + 1) * 3 + Math.sin((x / W) * TAU * 37) * 2.5);
    g.closePath();
    g.fill();
    if (snow > 0.4) {
      // glitzernde Schneekante + blaue Schatten
      g.fillStyle = "rgba(255,255,255,0.9)";
      g.fillRect(0, T - 1, W, 2);
      g.fillStyle = "rgba(120,160,210,0.35)";
      for (let i = 0; i < 30; i += 1) {
        const x = r() * W;
        g.beginPath();
        g.ellipse(x, T + 8, 20 + r() * 40, 3, 0, 0, TAU);
        g.fill();
      }
      if (snow < 0.9) {
        // Grasbüschel und Steinspitzen schauen aus dem Schnee
        g.lineCap = "round";
        for (let i = 0; i < 70; i += 1) {
          const x = r() * W;
          g.strokeStyle = r() < 0.5 ? "#7d8a5a" : "#5c6a44";
          g.lineWidth = 1.4;
          g.beginPath();
          for (let b2 = -2; b2 <= 2; b2 += 1) {
            g.moveTo(x + b2 * 2, T + 1);
            g.lineTo(x + b2 * 3, T - 4 - r() * 6);
          }
          g.stroke();
        }
      }
      darkenBottom(g, W, H, T, snow);
      return;
    }
    // Grashalme über der Kante
    const blades = [mixHex(P.grass, "#e8eef4", snow * 0.4), P.grassDark, mixHex(P.grass, "#fff6c0", 0.3)];
    g.lineCap = "round";
    for (let i = 0; i < 520; i += 1) {
      const x = (i / 520) * W + r() * 3;
      const len = 5 + r() * (snow > 0.4 ? 6 : 13);
      const lean = (r() - 0.35) * 6;
      g.strokeStyle = blades[Math.floor(r() * blades.length)];
      g.lineWidth = 1.2 + r() * 1.2;
      g.beginPath();
      g.moveTo(x, T + 3);
      g.quadraticCurveTo(x + lean * 0.3, T - len * 0.5, x + lean, T - len);
      g.stroke();
    }
    // Blumen (Almwiese) bzw. Schneeflecken
    if (snow < 0.3) {
      const flowers = ["#ffffff", "#ffd84a", "#c28bff", "#ff6f8a", "#6fb4ff", "#ffffff"];
      for (let i = 0; i < 90 * (1 - snow * 2); i += 1) {
        const x = r() * W;
        const y = T - 2 - r() * 9;
        g.strokeStyle = "rgba(60,110,40,0.9)";
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x, T + 2);
        g.lineTo(x, y);
        g.stroke();
        g.fillStyle = flowers[Math.floor(r() * flowers.length)];
        g.beginPath();
        g.arc(x, y, 1.6 + r() * 1.4, 0, TAU);
        g.fill();
      }
    } else {
      for (let i = 0; i < 26 * snow; i += 1) {
        const x = r() * W;
        const w = 20 + r() * 60;
        g.fillStyle = "rgba(248,251,255,0.95)";
        g.beginPath();
        g.ellipse(x, T + 2, w, 5 + r() * 3, 0, Math.PI, TAU);
        g.fill();
        g.fillStyle = "rgba(160,190,225,0.5)";
        g.fillRect(x - w * 0.8, T + 2, w * 1.6, 2);
      }
    }
    // Sonnenlicht auf der Kante
    g.fillStyle = "rgba(255,248,210,0.25)";
    g.fillRect(0, T - 1, W, 2);
    darkenBottom(g, W, H, T, snow);
  }, reuse);
}

/** Tiefe: Bodenquerschnitt nach unten abdunkeln (vorgebacken statt pro Frame). */
function darkenBottom(g: Ctx2D, W: number, H: number, T: number, snow: number): void {
  const dg = g.createLinearGradient(0, T + 40, 0, H);
  dg.addColorStop(0, "rgba(10,14,20,0)");
  dg.addColorStop(1, `rgba(10,14,20,${(0.35 + 0.1 * snow).toFixed(3)})`);
  g.fillStyle = dg;
  g.fillRect(0, T + 40, W, H - T - 40);
}

/** Gegenüberliegende Schluchtwand (im Schatten, nach unten dunkler), Kachel 512 × 170; `ice` = Gletscherspalte. */
export function paintCanyon(ice: boolean): HTMLCanvasElement {
  const W = 512;
  const H = 170;
  return paint(W, H, (g) => {
    const r = mulberry(ice ? 5151 : 5150);
    const grd = g.createLinearGradient(0, 0, 0, H);
    if (ice) {
      grd.addColorStop(0, "#8fb6dc");
      grd.addColorStop(0.45, "#3f6fa6");
      grd.addColorStop(1, "#0f2240");
    } else {
      grd.addColorStop(0, "#5a5a62");
      grd.addColorStop(0.45, "#33343d");
      grd.addColorStop(1, "#0e0f15");
    }
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    // Felsbänder: beleuchtete Oberkante, dunkle Unterseite
    let y = 6;
    while (y < H) {
      const bandH = 16 + r() * 18;
      const ph = r() * TAU;
      const k = r() < 0.5 ? 2 : 3;
      const top = (x: number): number => y + Math.sin((x / W) * TAU * k + ph) * 4;
      g.fillStyle = ice ? "rgba(225,242,255,0.18)" : "rgba(255,236,210,0.1)";
      g.beginPath();
      g.moveTo(0, top(0));
      for (let x = 0; x <= W; x += 16) g.lineTo(x, top(x));
      g.lineTo(W, top(W) + 3);
      for (let x = W; x >= 0; x -= 16) g.lineTo(x, top(x) + 3);
      g.closePath();
      g.fill();
      g.fillStyle = "rgba(0,0,8,0.22)";
      g.beginPath();
      g.moveTo(0, top(0) + bandH - 5);
      for (let x = 0; x <= W; x += 16) g.lineTo(x, top(x) + bandH - 5);
      g.lineTo(W, top(W) + bandH);
      for (let x = W; x >= 0; x -= 16) g.lineTo(x, top(x) + bandH);
      g.closePath();
      g.fill();
      if (!ice && y < 70 && r() < 0.7) {
        g.fillStyle = "rgba(90,130,60,0.35)";
        for (let m = 0; m < 5; m += 1) {
          const mx = r() * W;
          g.beginPath();
          g.ellipse(mx, top(mx) + 2, 10 + r() * 16, 3, 0, 0, TAU);
          g.fill();
        }
      }
      y += bandH;
    }
    if (ice) {
      // Séracs: senkrechte Eisrippen mit hellen Kanten
      for (let x = 0; x < W; x += 18 + r() * 22) {
        const wv = 8 + r() * 14;
        const gg = g.createLinearGradient(x, 0, x + wv, 0);
        gg.addColorStop(0, "rgba(235,248,255,0.35)");
        gg.addColorStop(1, "rgba(20,60,110,0.25)");
        g.fillStyle = gg;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x + wv, 0);
        g.lineTo(x + wv * 0.6, H);
        g.lineTo(x - wv * 0.2, H);
        g.closePath();
        g.fill();
      }
    }
    // senkrechte Klüfte
    g.strokeStyle = ice ? "rgba(10,30,70,0.45)" : "rgba(0,0,0,0.4)";
    g.lineWidth = 1.6;
    for (let i = 0; i < 12; i += 1) {
      const x = r() * W;
      g.beginPath();
      let yy = r() * 30;
      let xx = x;
      g.moveTo(xx, yy);
      const end = yy + 40 + r() * 110;
      while (yy < end) {
        yy += 8 + r() * 12;
        xx += (r() - 0.5) * 8;
        g.lineTo(xx, yy);
      }
      g.stroke();
    }
  });
}

/**
 * Weiche Lichtstrahlen (additiv zu zeichnen), Ursprung bei (ox, oy) – der Ursprung selbst bleibt leer, die Bahnen
 * sind mehrfach mit wachsender Breite und sinkender Deckkraft überlagert (wirkt weichgezeichnet).
 */
export function paintRays(w: number, h: number, ox: number, oy: number, seed: number): HTMLCanvasElement {
  return paint(w, h, (g) => {
    const r = mulberry(seed);
    g.translate(ox, oy);
    const len = Math.hypot(w, h);
    for (let i = 0; i < 8; i += 1) {
      const a = Math.PI * 0.55 + (i / 7) * Math.PI * 0.5 + (r() - 0.5) * 0.1;
      const spread = 0.018 + r() * 0.03;
      const strength = 0.5 + r() * 0.5;
      for (let pass = 0; pass < 3; pass += 1) {
        const sp = spread * (1 + pass * 0.9);
        const al = (0.07 - pass * 0.018) * strength;
        const r0 = 90;
        const grd = g.createLinearGradient(Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * len, Math.sin(a) * len);
        grd.addColorStop(0, "rgba(255,246,214,0)");
        grd.addColorStop(0.08, `rgba(255,246,214,${al.toFixed(3)})`);
        grd.addColorStop(0.5, `rgba(255,240,200,${(al * 0.45).toFixed(3)})`);
        grd.addColorStop(1, "rgba(255,240,200,0)");
        g.fillStyle = grd;
        g.beginPath();
        g.moveTo(Math.cos(a - sp * 0.3) * r0, Math.sin(a - sp * 0.3) * r0);
        g.lineTo(Math.cos(a - sp) * len, Math.sin(a - sp) * len);
        g.lineTo(Math.cos(a + sp) * len, Math.sin(a + sp) * len);
        g.lineTo(Math.cos(a + sp * 0.3) * r0, Math.sin(a + sp * 0.3) * r0);
        g.closePath();
        g.fill();
      }
    }
  });
}

/** Grashorst für den Vordergrund (unscharf wirkend, dunkel) */
export function paintForeGrass(seed: number, snow: boolean): HTMLCanvasElement {
  const W = 220;
  const H = 120;
  return paint(W, H, (g) => {
    const r = mulberry(seed);
    g.lineCap = "round";
    for (let i = 0; i < 70; i += 1) {
      const x = W * 0.15 + r() * W * 0.7;
      const len = 40 + r() * 70;
      const lean = (r() - 0.5) * 60;
      const c = snow ? (r() < 0.5 ? "rgba(70,80,96,0.95)" : "rgba(110,120,140,0.9)") : r() < 0.5 ? "rgba(26,58,26,0.95)" : "rgba(46,86,34,0.92)";
      g.strokeStyle = c;
      g.lineWidth = 2 + r() * 3;
      g.beginPath();
      g.moveTo(x, H);
      g.quadraticCurveTo(x + lean * 0.2, H - len * 0.6, x + lean, H - len);
      g.stroke();
    }
    if (!snow) {
      for (let i = 0; i < 5; i += 1) {
        const x = W * 0.2 + r() * W * 0.6;
        const y = H - 50 - r() * 50;
        g.fillStyle = ["#fff7e0", "#ffd24a", "#c9a0ff"][i % 3];
        g.beginPath();
        g.arc(x, y, 4 + r() * 3, 0, TAU);
        g.fill();
      }
    }
  });
}

export { TAU };

/** Fallback-Fernkulisse ohne Bilder: gezackte Gebirgskette mit Schneekappen (H = 420). */
export function paintFarRange(stage: number, reuse?: HTMLCanvasElement | null): HTMLCanvasElement {
  const W = 2048;
  const H = 420;
  return paint(W, H, (g) => {
    const P = STAGE_PAL[stage];
    const R: RidgeSpec = {
      W,
      base: 170,
      terms: [
        [1, 30, 0.3],
        [3, 44, 1.9],
        [5, 26, 0.7],
        [8, 18, 2.4],
        [13, 10, 1.2],
        [21, 5, 0.2],
      ],
    };
    // zweite, fernere Kette
    g.fillStyle = mixHex(P.haze, "#8aa0bf", 0.35);
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 6) g.lineTo(x, ridgeY({ ...R, base: 130, terms: R.terms.map(([k, a, ph]) => [k, a * 0.8, ph + 1.3] as [number, number, number]) }, x));
    g.lineTo(W, H);
    g.closePath();
    g.fill();
    // Hauptkette
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 4) g.lineTo(x, ridgeY(R, x));
    g.lineTo(W, H);
    g.closePath();
    const grd = g.createLinearGradient(0, 60, 0, H);
    grd.addColorStop(0, "#9aa6b8");
    grd.addColorStop(0.5, "#6f7f92");
    grd.addColorStop(1, "#4c6a5c");
    g.fillStyle = grd;
    g.fill();
    // Schneekappen: oberhalb einer Schneegrenze aufhellen
    g.save();
    g.clip();
    const snowLine = 205;
    const sg = g.createLinearGradient(0, 60, 0, snowLine);
    sg.addColorStop(0, "rgba(255,255,255,0.95)");
    sg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = sg;
    g.fillRect(0, 0, W, snowLine);
    // Schattenflanken
    g.fillStyle = "rgba(40,60,90,0.18)";
    for (let x = 0; x < W; x += 64) {
      const y = ridgeY(R, x);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x - 50, H);
      g.lineTo(x - 10, H);
      g.closePath();
      g.fill();
    }
    g.restore();
    gradeLayer(g, W, H, stage, 0.3, 0.3);
    g.globalCompositeOperation = "destination-in";
    const fade = g.createLinearGradient(0, 0, 0, 90);
    fade.addColorStop(0, "rgba(0,0,0,0)");
    fade.addColorStop(1, "rgba(0,0,0,1)");
    g.fillStyle = fade;
    g.fillRect(0, 0, W, H);
  }, reuse);
}

/** Puderschnee-Ballen für die Lawine (Cartoon-Schattierung passend zu den Props: Kontur, blauer Eigenschatten), 128 px */
export function paintPuff(seed: number): HTMLCanvasElement {
  return paint(128, 128, (g) => {
    const r = mulberry(seed);
    const blobs: Array<[number, number, number]> = [];
    for (let i = 0; i < 6; i += 1) blobs.push([40 + r() * 48, 44 + r() * 40, 17 + r() * 16]);
    // Kontur
    g.fillStyle = "rgba(92,122,176,0.85)";
    for (const [x, y, rad] of blobs) {
      g.beginPath();
      g.arc(x, y, rad + 2.5, 0, TAU);
      g.fill();
    }
    // Schatten (bläulich)
    g.fillStyle = "#b9cbe6";
    for (const [x, y, rad] of blobs) {
      g.beginPath();
      g.arc(x, y, rad, 0, TAU);
      g.fill();
    }
    // Lichtseite (oben rechts)
    for (const [x, y, rad] of blobs) {
      const grd = g.createRadialGradient(x + rad * 0.35, y - rad * 0.4, rad * 0.1, x + rad * 0.15, y - rad * 0.15, rad * 0.88);
      grd.addColorStop(0, "#ffffff");
      grd.addColorStop(0.8, "#f6f9ff");
      grd.addColorStop(1, "rgba(246,249,255,0)");
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x + rad * 0.15, y - rad * 0.15, rad * 0.88, 0, TAU);
      g.fill();
    }
  });
}

/** Bergsee-Streifen (periodisch, 2048 × 56): ferner Uferwald mit Spiegelung, Wasser in Himmelsfarben. */
export function paintLake(): HTMLCanvasElement {
  const W = 2048;
  const H = 56;
  return paint(W, H, (g) => {
    const r = mulberry(333);
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, "#6fb6d8");
    grd.addColorStop(0.5, "#3f97b8");
    grd.addColorStop(1, "#2a7894");
    g.fillStyle = grd;
    g.fillRect(0, 6, W, H - 6);
    // ferner Uferwald + Spiegelung
    for (let i = 0; i < 260; i += 1) {
      const x = r() * W;
      const th = 5 + r() * 8;
      g.fillStyle = "#2f5a44";
      g.beginPath();
      g.moveTo(x, 7 - th);
      g.lineTo(x - th * 0.35, 8);
      g.lineTo(x + th * 0.35, 8);
      g.closePath();
      g.fill();
      g.fillStyle = "rgba(40,80,70,0.35)";
      g.beginPath();
      g.moveTo(x, 9 + th * 1.2);
      g.lineTo(x - th * 0.35, 8);
      g.lineTo(x + th * 0.35, 8);
      g.closePath();
      g.fill();
    }
    g.fillStyle = "#3d6b4a";
    g.fillRect(0, 5, W, 3);
    // Wellenlinien
    g.strokeStyle = "rgba(255,255,255,0.25)";
    g.lineWidth = 1;
    for (let i = 0; i < 90; i += 1) {
      const x = r() * W;
      const y = 14 + r() * (H - 18);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + 10 + r() * 26, y);
      g.stroke();
    }
  });
}
