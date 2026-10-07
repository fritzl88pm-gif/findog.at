/**
 * Auflösungs-Skala der Zeichenfläche (rein, tabellengetestet). Die Spielfläche ist logisch 1280 × 720; die Bitmap der Canvas
 * hat 1280·s × 720·s Pixel. s = 1 ist der schnelle Pfad der Welt-Caches (1:1-Blits), alles darüber kostet Füllrate und
 * (im Software-Raster) ein Vielfaches an Zeit – deshalb ist die Skala ein Hebel der Qualitätsleiter:
 *   Q0: exakt 1 (Notstufe, CSS skaliert hoch) · Q1: höchstens 1,25 (auf 1/8 gerastet) · Q2: bis 2 (volle Gerätepixel).
 * Zusätzlich nie mehr als `maxPixels` (Standard 3,7 MP ≈ 2560 × 1440) und nie < 1.
 */
import type { QualityLevel } from "./quality-governor";

/** Logische Breite der Spielfläche (entspricht VIEW_W in constants.ts). */
const LOGICAL_W = 1280;

/** Absolutes Pixelbudget der Bitmap (≈ 2560 × 1440). */
export const MAX_RENDER_PIXELS = 3_700_000;
/** Obergrenzen der Skala je Stufe (Q0 ist fest 1). */
export const Q1_MAX_SCALE = 1.25;
export const Q2_MAX_SCALE = 2;
/** Skalen nahe 1 rasten auf 1 (Schnellpfad statt minimal unscharfer 1,05-Skala). */
const SNAP_TO_ONE = 0.12;

export interface RenderScaleOpts {
  /** Pixelbudget der Bitmap (Standard 3,7 MP). */
  maxPixels?: number;
}

/**
 * Skala s für eine Zeichenfläche mit CSS-Größe cssW × cssH (CSS-Pixel) auf einem Gerät mit Pixeldichte dpr.
 * roh = cssW·dpr/1280 = Skala, bei der 1 Bitmap-Pixel genau 1 Geräte-Pixel ist.
 */
export function pickRenderScale(cssW: number, cssH: number, dpr: number, quality: QualityLevel, opts: RenderScaleOpts = {}): number {
  if (quality <= 0) return 1;
  if (!(cssW > 0) || !(dpr > 0) || !Number.isFinite(cssW) || !Number.isFinite(dpr)) return 1;
  const raw = (cssW * dpr) / LOGICAL_W;
  let s = Math.min(raw, quality === 1 ? Q1_MAX_SCALE : Q2_MAX_SCALE);
  // Pixelbudget: Bitmap = (cssW·e) × (cssH·e) mit e = effectiveDpr = s·1280/cssW → Fläche = 1280²·s²·cssH/cssW
  const maxPixels = opts.maxPixels ?? MAX_RENDER_PIXELS;
  if (cssH > 0 && Number.isFinite(cssH) && maxPixels > 0) {
    const byPixels = Math.sqrt((maxPixels * cssW) / (cssH * LOGICAL_W * LOGICAL_W));
    if (s > byPixels) s = byPixels;
  }
  if (Math.abs(s - 1) < SNAP_TO_ONE) return 1;
  if (quality === 1) s = Math.round(s * 8) / 8;
  return s < 1 ? 1 : s;
}

/**
 * Pixeldichte, mit der die Bitmap angelegt wird (bitmapW = cssW · effectiveDpr = scale · 1280). Die Welt-Renderer
 * bekommen diesen Wert über resize(dpr); er ist unabhängig von der echten devicePixelRatio.
 */
export function effectiveDpr(cssW: number, scale: number): number {
  if (!(cssW > 0) || !Number.isFinite(cssW) || !Number.isFinite(scale)) return 1;
  return (scale * LOGICAL_W) / cssW;
}
