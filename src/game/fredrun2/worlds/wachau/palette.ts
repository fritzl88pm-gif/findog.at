/**
 * Wachau – Stimmungsstufen (Morgennebel → Goldener Vormittag → Sonnenuntergang → Blaue Stunde → Sternennacht),
 * Farbtabellen und kleine Offscreen-Helfer (Multiplikations-Tönung, Sprite-Cache).
 */
import { StagePalette } from "../shared-b/color";
import { paint, type Ctx2D } from "../shared-b/canvas";

export const MAX_STAGE = 4;
/** Wasserspiegel der Donau-Lücken relativ zur Bodenlinie */
export const WATER_DY = 22;

export const STAGE_NAMES = ["Morgennebel", "Goldener Vormittag", "Sonnenuntergang", "Blaue Stunde", "Sternennacht"];

export interface StageColors {
  skyTop: string;
  skyMid: string;
  skyLow: string;
  /** Dunst (atmosphärische Perspektive) */
  haze: string;
  /** Lichtfarbe, mit der Ebenen multipliziert werden */
  light: string;
  sun: string;
  glow: string;
  water: string;
  waterDeep: string;
  fog: string;
  /** Streiflicht / Rimlight der Szene */
  rim: string;
}

export const STAGES: StageColors[] = [
  // 0 Morgennebel
  {
    skyTop: "#7c92b6",
    skyMid: "#c7c2d8",
    skyLow: "#f3d9c6",
    haze: "#dde1ea",
    light: "#e4e1ec",
    sun: "#fff3dc",
    glow: "#ffd9b8",
    water: "#b3c0d2",
    waterDeep: "#3f5470",
    fog: "#eef0f5",
    rim: "#ffe6cc",
  },
  // 1 Goldener Vormittag
  {
    skyTop: "#2c76c8",
    skyMid: "#7fb8e8",
    skyLow: "#f5e6bd",
    haze: "#c6d8ea",
    light: "#fff5e2",
    sun: "#fffbe8",
    glow: "#ffe6a4",
    water: "#5b9ccb",
    waterDeep: "#1a4868",
    fog: "#f6f0e0",
    rim: "#fff0c0",
  },
  // 2 Sonnenuntergang
  {
    skyTop: "#27306c",
    skyMid: "#c65f78",
    skyLow: "#ffb35a",
    haze: "#e79c7c",
    light: "#ffc69c",
    sun: "#ffd782",
    glow: "#ff8a48",
    water: "#d88a70",
    waterDeep: "#3a2a4c",
    fog: "#f2b394",
    rim: "#ffb070",
  },
  // 3 Blaue Stunde
  {
    skyTop: "#0b1540",
    skyMid: "#25388a",
    skyLow: "#c47a9e",
    haze: "#3f5094",
    light: "#6f7ec0",
    sun: "#ffe2c8",
    glow: "#ff9ab4",
    water: "#3c5298",
    waterDeep: "#0c1534",
    fog: "#5c6cac",
    rim: "#ffc0a0",
  },
  // 4 Sternennacht
  {
    skyTop: "#03060f",
    skyMid: "#0a1534",
    skyLow: "#1a2a56",
    haze: "#1c2952",
    light: "#3d4c80",
    sun: "#eef3ff",
    glow: "#8fb2ff",
    water: "#1c2c56",
    waterDeep: "#04081a",
    fog: "#2c3c6a",
    rim: "#a8c4ff",
  },
];

export const PAL = new StagePalette(STAGES as unknown as Array<Record<keyof StageColors, string>>);

/** 0 = Tag … 1 = tiefe Nacht */
export const NIGHT = [0.12, 0, 0.3, 0.74, 1];
/** Fensterlicht, Laternen, Flutlicht */
export const LIGHTS = [0.08, 0, 0.22, 0.92, 1];
export const STARS = [0, 0, 0, 0.5, 1];
export const MILKY = [0, 0, 0, 0.1, 1];
/** Nebelschwaden */
export const FOG = [1, 0.1, 0.12, 0.32, 0.42];
/** Lichtstrahlen der Sonne */
export const RAYS = [0.5, 0.85, 0.75, 0, 0];
export const FIREFLY = [0, 0, 0.08, 0.5, 1];
/** Warme Abendtönung für Entitäten */
export const WARM = [0.12, 0.05, 1, 0.35, 0];
/** Entitäts-Abdunkelung (bewusst schwächer als die Kulisse → Gefahren bleiben lesbar) */
export const ENT_NIGHT = [0.12, 0, 0.18, 0.6, 0.82];
/** Fallende Blätter */
export const LEAVES = [0.35, 0.75, 1, 0.45, 0.15];
export const SUN_X = [1010, 760, 900, 900, 900];
export const SUN_Y = [266, 118, 300, 760, 760];
export const SUN_R = [42, 34, 56, 56, 56];
export const MOON = [0, 0, 0, 0.35, 1];
/** Stärke des Dunstes je Stufe (Faktor auf die Ebenen-Dunstwerte) */
export const HAZE_K = [1.55, 0.8, 0.95, 0.85, 0.75];

export interface Tint {
  /** Multiplikationsfarbe (Beleuchtung) */
  mul?: string;
  /** Dunst-Verlauf */
  haze?: { color: string; aTop: number; aBottom: number };
  /** Kontaktschatten nach unten */
  shade?: { color: string; a: number; from: number };
  /** Flache Einfärbung (source-atop) */
  flat?: { color: string; a: number };
}

/** Hat die Tönung einen Multiplikationsschritt (Lichtfarbe ≠ Weiß)? */
function hasMul(t: Tint): t is Tint & { mul: string } {
  return !!t.mul && t.mul.toLowerCase() !== "#ffffff";
}

/** Hat die Tönung einen Schleier (flache Farbe, Dunst oder Schatten)? */
function hasVeil(t: Tint): boolean {
  return !!((t.flat && t.flat.a > 0.001) || (t.haze && (t.haze.aTop > 0.001 || t.haze.aBottom > 0.001)) || (t.shade && t.shade.a > 0.001));
}

/**
 * Teilschritt 1 der Tönung: Kopie der Quelle, mit der Lichtfarbe multipliziert (Alpha der Quelle geht dabei noch verloren,
 * siehe `tintMask`). Mit `reuse` (gleiche Größe) wird diese Fläche neu bemalt.
 */
export function tintMul(src: HTMLCanvasElement, t: Tint, flipY = false, reuse?: HTMLCanvasElement | null): HTMLCanvasElement {
  return paint(
    src.width,
    src.height,
    (g, w, h) => {
      if (flipY) {
        g.translate(0, h);
        g.scale(1, -1);
      }
      g.drawImage(src, 0, 0);
      g.setTransform(1, 0, 0, 1, 0, 0);
      if (hasMul(t)) {
        g.globalCompositeOperation = "multiply";
        g.fillStyle = t.mul;
        g.fillRect(0, 0, w, h);
      }
    },
    reuse,
  );
}

/** Teilschritt 2: das Alpha der Quelle wieder auflegen (nur nach einem Multiplikationsschritt nötig). false = nichts getan. */
export function tintMask(c: HTMLCanvasElement, src: HTMLCanvasElement, t: Tint, flipY = false): boolean {
  if (!hasMul(t)) return false;
  const g = c.getContext("2d");
  if (!g) return false;
  g.globalCompositeOperation = "destination-in";
  if (flipY) {
    g.translate(0, c.height);
    g.scale(1, -1);
  }
  g.drawImage(src, 0, 0);
  g.setTransform(1, 0, 0, 1, 0, 0);
  return true;
}

/** Teilschritt 3: flache Farbe, Dunst und Schatten (nur wo die Fläche deckt). false = nichts zu tun. */
export function tintVeil(c: HTMLCanvasElement, t: Tint): boolean {
  const g = c.getContext("2d");
  if (!g) return false;
  const w = c.width;
  const h = c.height;
  g.globalCompositeOperation = "source-atop";
  if (t.flat && t.flat.a > 0.001) {
    g.globalAlpha = Math.min(1, t.flat.a);
    g.fillStyle = t.flat.color;
    g.fillRect(0, 0, w, h);
    g.globalAlpha = 1;
  }
  if (t.haze && (t.haze.aTop > 0.001 || t.haze.aBottom > 0.001)) {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, withA(t.haze.color, t.haze.aTop));
    grd.addColorStop(1, withA(t.haze.color, t.haze.aBottom));
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  }
  if (t.shade && t.shade.a > 0.001) {
    const y0 = h * t.shade.from;
    const grd = g.createLinearGradient(0, y0, 0, h);
    grd.addColorStop(0, withA(t.shade.color, 0));
    grd.addColorStop(1, withA(t.shade.color, t.shade.a));
    g.fillStyle = grd;
    g.fillRect(0, y0, w, h - y0);
  }
  return hasVeil(t);
}

/**
 * Getönte Kopie (Alpha bleibt erhalten): Multiplizieren → Alpha → Dunst → Schatten, am Stück (`tintMul`, `tintMask`, `tintVeil`
 * nacheinander auf derselben Fläche; große Ebenen nehmen die Teilschritte einzeln, siehe `tintedCache` im Renderer).
 * Mit `reuse` (gleiche Größe) wird diese Fläche neu bemalt.
 */
export function tintCanvas(src: HTMLCanvasElement, t: Tint, flipY = false, reuse?: HTMLCanvasElement | null): HTMLCanvasElement {
  const c = tintMul(src, t, flipY, reuse);
  tintMask(c, src, t, flipY);
  tintVeil(c, t);
  return c;
}

export function withA(hex: string, a: number): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  const al = Math.max(0, Math.min(1, a));
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${al.toFixed(3)})`;
}

/** Mischt zwei #rrggbb-Farben → #rrggbb */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) + ((((pb >> 16) & 255) - ((pa >> 16) & 255)) * t));
  const gg = Math.round(((pa >> 8) & 255) + ((((pb >> 8) & 255) - ((pa >> 8) & 255)) * t));
  const bl = Math.round((pa & 255) + (((pb & 255) - (pa & 255)) * t));
  return `#${((1 << 24) | (r << 16) | (gg << 8) | bl).toString(16).slice(1)}`;
}

/** Stufen-Tönung für Kulissen-Ebenen: Licht multiplizieren + Dunst (stärker bei Nebel) + Kontaktschatten. */
export function layerTint(stage: number, hazeTop: number, hazeBottom: number, shade = 0, lightK = 1): Tint {
  const S = STAGES[stage];
  const hk = HAZE_K[stage];
  return {
    mul: lightK >= 1 ? S.light : mixHex("#ffffff", S.light, lightK),
    haze: { color: S.haze, aTop: Math.min(0.92, hazeTop * hk), aBottom: Math.min(0.92, hazeBottom * hk) },
    shade: shade > 0 ? { color: "#0a0c1c", a: shade * (0.7 + NIGHT[stage] * 0.3), from: 0.45 } : undefined,
  };
}

/** Kleiner LRU-Cache für vorgerenderte Sprites (Schlüssel = Skin + Maße + Variante). */
export class SpriteCache {
  private map = new Map<string, HTMLCanvasElement>();
  constructor(private readonly max = 48) {}

  /** Liegt der Eintrag vor? (ohne die LRU-Reihenfolge zu ändern) */
  has(key: string): boolean {
    return this.map.has(key);
  }

  get(key: string, make: () => HTMLCanvasElement): HTMLCanvasElement {
    let c = this.map.get(key);
    if (c) {
      // LRU: ans Ende verschieben
      this.map.delete(key);
      this.map.set(key, c);
      return c;
    }
    c = make();
    this.map.set(key, c);
    if (this.map.size > this.max) {
      const first = this.map.keys().next().value;
      if (first !== undefined) this.map.delete(first);
    }
    return c;
  }

  clear(): void {
    this.map.clear();
  }
}

/** Weicher Schein um eine Silhouette (für Rimlight/Gefahren-Lesbarkeit), einmalig vorgerendert. */
export function silhouetteGlow(src: HTMLCanvasElement, color: string, blur: number, pad: number): HTMLCanvasElement {
  return paint(src.width + pad * 2, src.height + pad * 2, (g) => {
    g.shadowColor = color;
    g.shadowBlur = blur;
    g.shadowOffsetX = 0;
    g.shadowOffsetY = 0;
    // Silhouette in Glühfarbe
    const sil = paint(src.width, src.height, (sg, w, h) => {
      sg.drawImage(src, 0, 0);
      sg.globalCompositeOperation = "source-in";
      sg.fillStyle = color;
      sg.fillRect(0, 0, w, h);
    });
    g.drawImage(sil, pad, pad);
    g.drawImage(sil, pad, pad);
    g.shadowBlur = 0;
    g.globalCompositeOperation = "destination-out";
    g.drawImage(src, pad, pad);
  });
}

export type { Ctx2D };
