/**
 * Zeichen-Hilfen für die Welten von Agent A: Offscreen-Kacheln (hi-dpi-fähig), gemalte Fernkulissen mit nahtloser
 * Spiegel-/Überblend-Kachelung und Stufen-Überblendung, periodisches Rauschen, Boden-Segmente.
 */
import { clamp } from "../../draw-utils";

// --- Rauschen (periodisch → nahtlose Kacheln) ------------------------------------------------------

export function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

export function hash2(a: number, b: number): number {
  return hash(a * 57.31 + b * 113.97);
}

/** Wertrauschen 1D mit Periode `period` (ganzzahlig), glatt interpoliert. */
export function pnoise(x: number, period: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash((((i % period) + period) % period) + seed * 1013);
  const b = hash(((((i + 1) % period) + period) % period) + seed * 1013);
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}

/** Fraktales periodisches Rauschen 0..1; `x` in Kachel-Einheiten [0, period). */
export function pfbm(x: number, period: number, oct = 4, seed = 0): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < oct; o += 1) {
    sum += amp * pnoise(x * f, period * f, seed + o * 7);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

// --- Offscreen-Kacheln -------------------------------------------------------------------------------

export type Canvas2D = HTMLCanvasElement;

export function createCanvas(w: number, h: number): Canvas2D {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export interface Tile {
  canvas: Canvas2D;
  /** logische Größe */
  w: number;
  h: number;
}

/** Rendert eine logische Kachel w×h mit Pixelfaktor k (für scharfe Darstellung auf hochauflösenden Displays). */
export function renderTile(w: number, h: number, k: number, paint: (g: CanvasRenderingContext2D, w: number, h: number) => void): Tile {
  const c = createCanvas(w * k, h * k);
  const g = c.getContext("2d");
  if (g) {
    g.scale(k, k);
    paint(g, w, h);
  }
  return { canvas: c, w, h };
}

/**
 * Horizontale Wiederholung einer Kachel mit Parallax. `scroll` = Weltdistanz × Faktor.
 * Zeichnet nur sichtbare Kopien (inkl. halbe Pixel Überlappung gegen Nähte).
 */
export function blitTiled(g: CanvasRenderingContext2D, t: Tile, scroll: number, y: number, viewW = 1280, h = t.h): void {
  const w = t.w;
  let x = -(((scroll % w) + w) % w);
  while (x < viewW) {
    g.drawImage(t.canvas, x, y, w + 0.6, h);
    x += w;
  }
}

/** Wie blitTiled, aber zeichnet nur das Bildschirmfenster [sx0, sx1) (spart Füllrate). */
export function blitTiledClip(g: CanvasRenderingContext2D, t: Tile, scroll: number, y: number, sx0: number, sx1: number): void {
  const w = t.w;
  const kx = t.canvas.width / t.w;
  const ky = t.canvas.height / t.h;
  let x = -(((scroll % w) + w) % w);
  while (x < sx1) {
    const a = Math.max(x, sx0);
    const b = Math.min(x + w, sx1);
    if (b > a) g.drawImage(t.canvas, (a - x) * kx, 0, (b - a) * kx, t.h * ky, a, y, b - a + 0.6, t.h);
    x += w;
  }
}

// --- Gemalte Fernkulisse -----------------------------------------------------------------------------

export interface BackdropSpec {
  url: string;
  /** Ausschnitt im Quellbild (Anteile 0..1): obere Kante / Höhe */
  cropTop?: number;
  cropH?: number;
  /** Nahtlose Kachelung: "mirror" (gespiegelt, für Motive ohne Schrift) oder "fade" (Enden überblenden) */
  seam?: "mirror" | "fade";
}

/**
 * Hält pro Stimmungsstufe ein Bild und zeichnet es nahtlos gekachelt mit Parallax. Die Bilder werden bei Bedarf auf
 * Zielhöhe vorskaliert (billiges Blitten statt Skalieren pro Frame); höchstens `keep` Stufen bleiben im Speicher.
 */
export class PaintedBackdrop {
  private imgs: Array<HTMLImageElement | null> = [];
  private cache = new Map<number, { tile: Canvas2D; w: number }>();
  private order: number[] = [];
  private k = 1;

  constructor(
    private readonly specs: BackdropSpec[],
    /** logische Zielhöhe */
    readonly drawH: number,
    private readonly keep = 3,
  ) {}

  async load(image: (url: string) => Promise<HTMLImageElement | null>): Promise<void> {
    this.imgs = await Promise.all(this.specs.map((s) => image(s.url).catch(() => null)));
  }

  get ready(): boolean {
    return this.imgs.some((i) => !!i);
  }

  has(i: number): boolean {
    return !!this.imgs[i];
  }

  setScale(k: number): void {
    const nk = clamp(k, 1, 1.5);
    if (Math.abs(nk - this.k) > 0.01) {
      this.k = nk;
      this.cache.clear();
      this.order = [];
    }
  }

  private build(i: number): { tile: Canvas2D; w: number } | null {
    const hit = this.cache.get(i);
    if (hit) return hit;
    const img = this.imgs[i] ?? this.imgs.find((x) => !!x) ?? null;
    if (!img) return null;
    const s = this.specs[i] ?? this.specs[0];
    const sy = Math.round(img.height * (s.cropTop ?? 0));
    const sh = Math.round(img.height * (s.cropH ?? 1 - (s.cropTop ?? 0)));
    const scale = this.drawH / sh;
    const w = Math.round(img.width * scale);
    const k = this.k;
    let tile: Canvas2D;
    if ((s.seam ?? "mirror") === "mirror") {
      tile = createCanvas(w * 2 * k, this.drawH * k);
      const g = tile.getContext("2d");
      if (g) {
        g.imageSmoothingQuality = "high";
        g.drawImage(img, 0, sy, img.width, sh, 0, 0, w * k, this.drawH * k);
        g.save();
        g.translate(w * 2 * k, 0);
        g.scale(-1, 1);
        g.drawImage(img, 0, sy, img.width, sh, 0, 0, w * k, this.drawH * k);
        g.restore();
      }
      const entry = { tile, w: w * 2 };
      this.remember(i, entry);
      return entry;
    }
    // "fade": das Ende des Bildes weich über den Anfang blenden → Periode w - ov
    const ov = Math.round(w * 0.12);
    tile = createCanvas((w - ov) * k, this.drawH * k);
    const g = tile.getContext("2d");
    if (g) {
      g.imageSmoothingQuality = "high";
      g.drawImage(img, 0, sy, img.width, sh, 0, 0, w * k, this.drawH * k);
      // Überblendstreifen: Ende des Bildes (letzte ov px) mit Verlauf über den Anfang legen
      const strip = createCanvas(ov * k, this.drawH * k);
      const sg = strip.getContext("2d");
      if (sg) {
        sg.drawImage(img, img.width * ((w - ov) / w), sy, img.width * (ov / w), sh, 0, 0, ov * k, this.drawH * k);
        sg.globalCompositeOperation = "destination-in";
        const grd = sg.createLinearGradient(0, 0, ov * k, 0);
        grd.addColorStop(0, "rgba(0,0,0,1)");
        grd.addColorStop(1, "rgba(0,0,0,0)");
        sg.fillStyle = grd;
        sg.fillRect(0, 0, ov * k, this.drawH * k);
        g.drawImage(strip, 0, 0);
      }
    }
    const entry = { tile, w: w - ov };
    this.remember(i, entry);
    return entry;
  }

  private remember(i: number, e: { tile: Canvas2D; w: number }): void {
    this.cache.set(i, e);
    this.order.push(i);
    while (this.order.length > this.keep) {
      const old = this.order.shift();
      if (old !== undefined && old !== i) this.cache.delete(old);
    }
  }

  /** Vorab erzeugen (z.B. nächste Stufe), damit kein Ruckler beim Überblenden entsteht. */
  warm(i: number): void {
    if (i >= 0 && i < this.specs.length) this.build(i);
  }

  draw(g: CanvasRenderingContext2D, i: number, scroll: number, y: number, alpha = 1, viewW = 1280): boolean {
    const e = this.build(Math.max(0, Math.min(this.specs.length - 1, i)));
    if (!e) return false;
    const prev = g.globalAlpha;
    g.globalAlpha = prev * alpha;
    const w = e.w;
    let x = -(((scroll % w) + w) % w);
    while (x < viewW) {
      g.drawImage(e.tile, x, y, w + 0.6, this.drawH);
      x += w;
    }
    g.globalAlpha = prev;
    return true;
  }
}

// --- Boden --------------------------------------------------------------------------------------------

const SEG_BUF: number[] = [];
const PIT_BUF: Array<{ x0: number; x1: number; skin: string }> = [];

/**
 * Feste Bodenabschnitte (Bildschirm-x) zwischen den Lücken. Rückgabe: flaches Array [a0,b0,a1,b1,…] (wiederverwendet!).
 */
export function groundSegments(pits: ReadonlyArray<{ x0: number; x1: number; skin: string }>, viewW = 1280): number[] {
  SEG_BUF.length = 0;
  PIT_BUF.length = 0;
  for (const p of pits) PIT_BUF.push(p);
  PIT_BUF.sort((a, b) => a.x0 - b.x0);
  let x = -20;
  for (const p of PIT_BUF) {
    if (p.x0 > x) SEG_BUF.push(x, p.x0);
    x = Math.max(x, p.x1);
  }
  if (x < viewW + 20) SEG_BUF.push(x, viewW + 20);
  return SEG_BUF;
}

// --- Farben -------------------------------------------------------------------------------------------

export type RGB = [number, number, number];

export function hexRgb(hex: string): RGB {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function css(c: RGB, a = 1): string {
  return a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`;
}

/** Wert einer Stufen-Tabelle mit Überblendung (stage, blend). */
export function stageVal(tab: readonly number[], stage: number, blend: number): number {
  const a = tab[Math.min(tab.length - 1, stage)];
  const b = tab[Math.min(tab.length - 1, stage + 1)];
  return a + (b - a) * blend;
}

export function stageRgb(tab: readonly RGB[], stage: number, blend: number): RGB {
  const a = tab[Math.min(tab.length - 1, stage)];
  const b = tab[Math.min(tab.length - 1, stage + 1)];
  return lerpRgb(a, b, blend);
}
