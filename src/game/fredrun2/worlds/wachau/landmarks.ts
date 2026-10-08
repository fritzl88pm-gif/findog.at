/**
 * Wachau – Wahrzeichen als Tiefenebenen: Stift (landmark-abbey), Burgruine Dürnstein (landmark-castle), Weinberg
 * (landmark-vineyard), Kirche (landmark-church), Raddampfer (landmark-steamship). Gemalte Props werden einmal auf
 * Zielgröße vorgerendert, pro Stimmungsstufe getönt (Licht + Dunst, nachts angestrahlt) und als Spiegelung auf der
 * Donau wiederverwendet. Ohne Props: prozedurale Silhouetten gleicher Größe.
 */
import { makeCanvas } from "../../draw-utils";
import type { PropLibrary } from "../../types";
import { paint, type Ctx2D } from "../shared-b/canvas";
import { mulberry } from "../shared-b/color";
import { StageCache } from "../shared-b/layers";
import { HAZE_K, LIGHTS, NIGHT, STAGES, mixHex, tintCanvas, withA } from "./palette";
import { baroqueTower, grapeLeaf, stoneWall } from "./scenery";

const TAU = Math.PI * 2;

export const LANDMARK_IDS = ["landmark-abbey", "landmark-castle", "landmark-vineyard", "landmark-church", "landmark-steamship"] as const;
type LandmarkId = (typeof LANDMARK_IDS)[number];

export interface LandmarkSpec {
  id: LandmarkId;
  /** Zielhöhe in px */
  h: number;
  /** Anteil der Unterkante, der weich ausgeblendet wird (verschmilzt mit dem Hang) */
  fade: number;
  flip?: boolean;
  /** Dunst-Stärke (0..1): weiter weg = mehr */
  haze: number;
  /** nachts angestrahlt */
  flood: number;
}

export interface Landmark {
  spec: LandmarkSpec;
  src: HTMLCanvasElement;
  staged: StageCache;
  refl: StageCache;
  w: number;
  h: number;
  /** Arbeitsflächen der Bakes freigeben (Speicher); sie entstehen beim nächsten Bake neu */
  dropWork(): void;
  /**
   * Arbeitsflächen im Leerlauf anlegen (statt beim ersten Nacht-Bake mitten im Lauf): die Lichtmaske nur, wenn das Wahrzeichen
   * nachts angestrahlt wird, dazu die Fläche für das Rohbild der Spiegelung. Mehrfach aufrufbar (legt nichts doppelt an).
   */
  warmWork(): void;
}

/**
 * Zwischenflächen der Stufen-Bakes (Lichtmaske, Rohbild der Spiegelung). Sie bleiben zwischen den Bakes erhalten und werden
 * neu bemalt, statt je Bake neue Bitmaps anzulegen (der Bake einer Landmarken-Stufe ist sonst ein Stoß aus vier Neuanlagen).
 */
interface Work {
  lit: HTMLCanvasElement | null;
  mirror: HTMLCanvasElement | null;
}

function fallback(id: LandmarkId, w: number, h: number): HTMLCanvasElement {
  return paint(w, h, (g) => {
    const r = mulberry(id.length * 31);
    switch (id) {
      case "landmark-abbey":
        drawAbbey(g, w, h, r);
        break;
      case "landmark-castle":
        drawCastle(g, w, h, r);
        break;
      case "landmark-vineyard":
        drawVineyardHill(g, w, h, r);
        break;
      case "landmark-church":
        drawChurch(g, w, h);
        break;
      case "landmark-steamship":
        drawSteamship(g, w, h);
        break;
    }
  });
}

/** Seitenverhältnis (B/H) der Props laut Manifest (für Fallbacks gleicher Größe) */
const ASPECT: Record<LandmarkId, number> = {
  "landmark-abbey": 739 / 760,
  "landmark-castle": 700 / 686,
  "landmark-vineyard": 640 / 624,
  "landmark-church": 436 / 520,
  "landmark-steamship": 720 / 361,
};

export function buildLandmark(spec: LandmarkSpec, props: PropLibrary | null): Landmark {
  const h = spec.h;
  const w = Math.round(h * ASPECT[spec.id]);
  let src: HTMLCanvasElement;
  if (props && props.has(spec.id)) {
    src = paint(w, h, (g) => {
      g.imageSmoothingQuality = "high";
      props.draw(g, spec.id, w / 2, h, { h, flipX: spec.flip, ax: 0.5, ay: 1 });
    });
  } else {
    src = fallback(spec.id, w, h);
    if (spec.flip) {
      const s = src;
      src = paint(w, h, (g) => {
        g.translate(w, 0);
        g.scale(-1, 1);
        g.drawImage(s, 0, 0);
      });
    }
  }
  if (spec.fade > 0) {
    const s = src;
    src = paint(w, h, (g) => {
      g.drawImage(s, 0, 0);
      g.globalCompositeOperation = "destination-out";
      const y0 = h * (1 - spec.fade);
      const grd = g.createLinearGradient(0, y0, 0, h);
      grd.addColorStop(0, "rgba(0,0,0,0)");
      grd.addColorStop(1, "rgba(0,0,0,1)");
      g.fillStyle = grd;
      g.fillRect(0, y0, w, h - y0);
    });
  }
  // Stufenflächen werden beim Verwerfen einer Stufe für den nächsten Bake wiederverwendet, ebenso die Arbeitsflächen
  const work: Work = { lit: null, mirror: null };
  const staged = new StageCache((stage, reuse) => stageVariant(src, spec, stage, reuse, work), { recycle: true });
  const refl = new StageCache((stage, reuse) => reflectSprite(staged.get(stage), stage, reuse, work), { recycle: true });
  return {
    spec,
    src,
    staged,
    refl,
    w,
    h,
    dropWork: () => {
      work.lit = null;
      work.mirror = null;
    },
    warmWork: () => {
      if (spec.flood >= 0.05) work.lit ??= makeCanvas(w, h);
      work.mirror ??= makeCanvas(w + 8, h);
    },
  };
}

function stageVariant(src: HTMLCanvasElement, spec: LandmarkSpec, stage: number, reuse: HTMLCanvasElement | null | undefined, work: Work): HTMLCanvasElement {
  const S = STAGES[stage];
  const hk = HAZE_K[stage];
  const tint = {
    mul: S.light,
    haze: { color: S.haze, aTop: Math.min(0.9, spec.haze * hk * 0.9), aBottom: Math.min(0.95, spec.haze * hk * 1.15) },
  };
  const flood = spec.flood * LIGHTS[stage] * (NIGHT[stage] > 0.5 ? 1 : 0.3);
  // die getönte Fläche wird gleich das Ergebnis (kein Zwischenbild, das danach nur kopiert würde)
  const out = tintCanvas(src, tint, false, reuse);
  if (flood < 0.03) return out;
  // Nachts: warm angestrahlt (von unten), leuchtet aus dem Dunkel heraus. Die Lichtmaske entsteht auf der Arbeitsfläche:
  // getönte Kopie, dann in derselben Fläche nach unten hin ausmaskiert.
  const lit = tintCanvas(src, { mul: "#ffd79a", haze: { color: mixHex(S.haze, "#ffb070", 0.4), aTop: 0.28, aBottom: 0.1 } }, false, work.lit);
  work.lit = lit;
  const lg = lit.getContext("2d");
  const g = out.getContext("2d");
  if (!lg || !g) return out;
  const w = src.width;
  const h = src.height;
  lg.globalCompositeOperation = "destination-in";
  lg.globalAlpha = 1;
  const grd = lg.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, "rgba(0,0,0,0.35)");
  grd.addColorStop(0.7, "rgba(0,0,0,0.9)");
  grd.addColorStop(1, "rgba(0,0,0,0.6)");
  lg.fillStyle = grd;
  lg.fillRect(0, 0, w, h);
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = Math.min(1, flood);
  g.drawImage(lit, 0, 0);
  g.globalAlpha = 1;
  return out;
}

/** Gespiegelte, gewellte und ausgeblendete Kopie für die Wasseroberfläche */
function reflectSprite(src: HTMLCanvasElement, stage: number, reuse: HTMLCanvasElement | null | undefined, work: Work): HTMLCanvasElement {
  const w = src.width;
  const h = src.height;
  const S = STAGES[stage];
  const mirror = paint(
    w + 8,
    h,
    (g) => {
      for (let y = 0; y < h; y += 2) {
        const sy = h - 1 - y;
        const dx = 4 + Math.sin(y * 0.8) * (1 + y * 0.03) + Math.sin(y * 0.21 + 2) * 1.2;
        g.globalAlpha = Math.max(0, 0.7 * (1 - y / (h * 0.8))) * (y % 6 === 4 ? 0.35 : 1);
        g.drawImage(src, 0, sy, w, 1, dx, y, w, 2);
      }
    },
    work.mirror,
  );
  work.mirror = mirror;
  return tintCanvas(mirror, { mul: mixHex(S.water, "#ffffff", 0.35), flat: { color: S.water, a: 0.22 } }, false, reuse);
}

// ------------------------------------------------------------------------------------------------
// Prozedurale Fallbacks

function rock(g: Ctx2D, x0: number, x1: number, top: number, bottom: number, r: () => number): void {
  g.fillStyle = "#8a8478";
  g.beginPath();
  g.moveTo(x0, bottom);
  const n = 14;
  for (let i = 0; i <= n; i += 1) {
    const u = i / n;
    const y = top + (bottom - top) * (1 - Math.sin(u * Math.PI)) * 0.8 + r() * 10;
    g.lineTo(x0 + (x1 - x0) * u, y);
  }
  g.lineTo(x1, bottom);
  g.closePath();
  g.fill();
  g.strokeStyle = "rgba(60,54,46,0.5)";
  g.lineWidth = 1.2;
  g.beginPath();
  for (let i = 0; i < 16; i += 1) {
    const x = x0 + r() * (x1 - x0);
    const y = top + 10 + r() * (bottom - top - 10);
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 12, y + 8 + r() * 12);
  }
  g.stroke();
  g.fillStyle = "#5e7034";
  for (let i = 0; i < 18; i += 1) {
    g.beginPath();
    g.arc(x0 + r() * (x1 - x0), top + 16 + r() * (bottom - top - 16), 3 + r() * 5, 0, TAU);
    g.fill();
  }
}

function drawAbbey(g: Ctx2D, w: number, h: number, r: () => number): void {
  rock(g, w * 0.02, w * 0.98, h * 0.55, h, r);
  const fy = h * 0.6;
  // Längstrakt
  g.fillStyle = "#f0d88e";
  g.fillRect(w * 0.12, fy - h * 0.16, w * 0.8, h * 0.16);
  g.fillStyle = "#b8502e";
  g.fillRect(w * 0.1, fy - h * 0.2, w * 0.84, h * 0.045);
  g.fillStyle = "rgba(70,60,50,0.55)";
  for (let x = w * 0.16; x < w * 0.9; x += w * 0.045) {
    g.fillRect(x, fy - h * 0.13, w * 0.018, h * 0.03);
    g.fillRect(x, fy - h * 0.07, w * 0.018, h * 0.03);
  }
  // Kirche mit Doppelturm
  for (const tx of [w * 0.2, w * 0.36]) {
    g.fillStyle = "#f4e2a6";
    g.fillRect(tx - w * 0.05, fy - h * 0.42, w * 0.1, h * 0.42);
    g.fillStyle = "#4e8a6a";
    g.beginPath();
    g.ellipse(tx, fy - h * 0.46, w * 0.055, h * 0.05, 0, 0, TAU);
    g.fill();
    g.beginPath();
    g.moveTo(tx - w * 0.03, fy - h * 0.49);
    g.lineTo(tx, fy - h * 0.58);
    g.lineTo(tx + w * 0.03, fy - h * 0.49);
    g.fill();
    g.fillStyle = "#e0b040";
    g.fillRect(tx - 0.8, fy - h * 0.63, 1.6, h * 0.05);
  }
  g.fillStyle = "#4e8a6a";
  g.beginPath();
  g.ellipse(w * 0.62, fy - h * 0.24, w * 0.07, h * 0.06, 0, Math.PI, 0);
  g.fill();
}

function drawCastle(g: Ctx2D, w: number, h: number, r: () => number): void {
  rock(g, w * 0.05, w * 0.95, h * 0.35, h, r);
  const top = h * 0.4;
  g.fillStyle = "#8f887c";
  // Mauern mit Zinnen und Löchern
  g.fillRect(w * 0.18, top - h * 0.12, w * 0.6, h * 0.14);
  for (let x = w * 0.18; x < w * 0.78; x += w * 0.06) g.fillRect(x, top - h * 0.16, w * 0.03, h * 0.05);
  // Bergfried
  g.fillRect(w * 0.52, top - h * 0.38, w * 0.14, h * 0.4);
  g.fillStyle = "#6a645a";
  g.fillRect(w * 0.55, top - h * 0.3, w * 0.03, h * 0.06);
  g.fillRect(w * 0.3, top - h * 0.08, w * 0.04, h * 0.05);
  g.fillRect(w * 0.42, top - h * 0.09, w * 0.03, h * 0.04);
  // ausgebrochene Kante
  g.globalCompositeOperation = "destination-out";
  g.beginPath();
  g.moveTo(w * 0.62, top - h * 0.38);
  g.lineTo(w * 0.67, top - h * 0.3);
  g.lineTo(w * 0.67, top - h * 0.39);
  g.fill();
  g.globalCompositeOperation = "source-over";
}

function drawVineyardHill(g: Ctx2D, w: number, h: number, r: () => number): void {
  g.fillStyle = "#7a7236";
  g.beginPath();
  g.moveTo(0, h);
  g.quadraticCurveTo(w * 0.2, h * 0.2, w * 0.45, h * 0.12);
  g.quadraticCurveTo(w * 0.8, h * 0.3, w, h);
  g.closePath();
  g.fill();
  g.save();
  g.clip();
  for (let y = h * 0.16; y < h; y += 9) {
    stoneWall(g, 0, y + 5, w, 3, r, 0.35);
    for (let x = 4; x < w; x += 7) {
      g.fillStyle = (Math.floor(x / 30) + Math.floor(y / 9)) % 3 === 0 ? "#c9782e" : "#d9a836";
      g.beginPath();
      g.arc(x, y + 2, 3, 0, TAU);
      g.fill();
    }
  }
  g.restore();
  // Presshaus
  g.fillStyle = "#efe4cc";
  g.fillRect(w * 0.6, h * 0.78, w * 0.22, h * 0.16);
  g.fillStyle = "#9c4a34";
  g.beginPath();
  g.moveTo(w * 0.58, h * 0.79);
  g.lineTo(w * 0.71, h * 0.7);
  g.lineTo(w * 0.84, h * 0.79);
  g.fill();
  grapeLeaf(g, w * 0.45, h * 0.12, 6, 0.3, "#5e7034", null);
}

function drawChurch(g: Ctx2D, w: number, h: number): void {
  g.fillStyle = "#f0ece2";
  g.fillRect(w * 0.35, h * 0.55, w * 0.6, h * 0.45);
  g.fillStyle = "#a8462e";
  g.beginPath();
  g.moveTo(w * 0.32, h * 0.56);
  g.lineTo(w * 0.64, h * 0.4);
  g.lineTo(w * 0.98, h * 0.56);
  g.closePath();
  g.fill();
  g.fillStyle = "rgba(70,70,90,0.6)";
  for (const x of [0.5, 0.65, 0.8]) g.fillRect(w * x, h * 0.66, w * 0.05, h * 0.14);
  baroqueTower(g, w * 0.22, h, h * 0.95);
}

function drawSteamship(g: Ctx2D, w: number, h: number): void {
  const wl = h * 0.92;
  g.fillStyle = "#f4f4f0";
  g.beginPath();
  g.moveTo(w * 0.02, wl - h * 0.22);
  g.lineTo(w * 0.98, wl - h * 0.24);
  g.quadraticCurveTo(w * 0.94, wl, w * 0.85, wl);
  g.lineTo(w * 0.1, wl);
  g.quadraticCurveTo(w * 0.03, wl - h * 0.05, w * 0.02, wl - h * 0.22);
  g.fill();
  g.fillStyle = "#1e2a44";
  g.fillRect(w * 0.08, wl - h * 0.06, w * 0.82, h * 0.05);
  g.fillStyle = "#e8e6de";
  g.fillRect(w * 0.18, wl - h * 0.4, w * 0.62, h * 0.18);
  g.fillStyle = "rgba(60,70,90,0.7)";
  for (let x = w * 0.2; x < w * 0.78; x += w * 0.04) g.fillRect(x, wl - h * 0.35, w * 0.022, h * 0.07);
  // Radkasten
  g.fillStyle = "#e6e2d6";
  g.beginPath();
  g.arc(w * 0.5, wl - h * 0.18, h * 0.22, Math.PI, 0);
  g.fill();
  g.strokeStyle = "#b09050";
  g.lineWidth = 2;
  g.stroke();
  // Schlot
  g.fillStyle = "#f2f0ea";
  g.fillRect(w * 0.44, wl - h * 0.78, w * 0.07, h * 0.4);
  g.fillStyle = "#1e2a44";
  g.fillRect(w * 0.44, wl - h * 0.8, w * 0.07, h * 0.06);
  // Flagge
  g.fillStyle = "#c8202c";
  g.fillRect(w * 0.9, wl - h * 0.62, w * 0.05, h * 0.04);
  g.fillStyle = "#ffffff";
  g.fillRect(w * 0.9, wl - h * 0.58, w * 0.05, h * 0.04);
  g.fillStyle = "#c8202c";
  g.fillRect(w * 0.9, wl - h * 0.54, w * 0.05, h * 0.04);
  g.fillStyle = "#555";
  g.fillRect(w * 0.895, wl - h * 0.62, 1.4, h * 0.4);
}

/** Lichter des Dampfers (Bullaugen, Positionslampen) als additive Fläche */
export function steamshipLights(w: number, h: number): HTMLCanvasElement {
  return paint(w, h, (g) => {
    const wl = h * 0.92;
    for (let x = w * 0.2; x < w * 0.78; x += w * 0.04) {
      g.fillStyle = "rgba(255,214,150,0.9)";
      g.fillRect(x, wl - h * 0.35, w * 0.022, h * 0.07);
    }
    for (let x = w * 0.12; x < w * 0.86; x += w * 0.05) {
      g.fillStyle = "rgba(255,230,180,0.85)";
      g.fillRect(x, wl - h * 0.16, 2, 2);
    }
    for (const [x, c] of [
      [w * 0.04, "rgba(255,80,80,0.95)"],
      [w * 0.95, "rgba(120,255,140,0.95)"],
      [w * 0.48, "rgba(255,250,230,1)"],
    ] as const) {
      const grd = g.createRadialGradient(x, wl - h * 0.5, 0, x, wl - h * 0.5, 9);
      grd.addColorStop(0, c);
      grd.addColorStop(1, withA("#ffffff", 0));
      g.fillStyle = grd;
      g.fillRect(x - 9, wl - h * 0.5 - 9, 18, 18);
    }
  });
}
