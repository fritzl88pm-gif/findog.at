/**
 * Parallax-Ebenen mit pro Stimmungsstufe VORGEBACKENER Einfärbung (Nacht-Silhouette + atmosphärischer Dunst +
 * Bodenschatten). Pro Frame kostet eine Ebene damit nur einen ganzzahligen Blit (zwei während einer Überblendung)
 * plus optionale additive Leuchtkacheln. Varianten werden lazy erzeugt (max. eine pro Frame in `prepare`).
 */
import { blitTiled, paint, type Ctx2D } from "./canvas";

export interface StageTint {
  /** Flache Einfärbung (z.B. Nacht-Silhouette) */
  night?: { color: string; a: number };
  /** Vertikaler Dunst-Verlauf über die Höhe der Quelle */
  haze?: { color: string; aTop: number; aBottom: number };
  /** Abdunkeln zum unteren Rand hin (Kontakt-/Bodenschatten), ab Anteil `from` der Höhe */
  shade?: { color: string; a: number; from: number };
}

/** Lazy erzeugte Zeichenflächen pro Stufe (z.B. Himmel), mit Verwerfen alter Stufen. */
export class StageCache {
  private cache = new Map<number, HTMLCanvasElement>();
  constructor(private readonly make: (stage: number) => HTMLCanvasElement) {}

  has(stage: number): boolean {
    return this.cache.has(stage);
  }

  get(stage: number): HTMLCanvasElement {
    let c = this.cache.get(stage);
    if (!c) {
      c = this.make(stage);
      this.cache.set(stage, c);
    }
    return c;
  }

  /** Nur die Stufen a und b im Cache behalten */
  keep(a: number, b: number): void {
    for (const k of [...this.cache.keys()]) if (k !== a && k !== b) this.cache.delete(k);
  }
}

/** Quelle + lazy erzeugte, pro Stufe eingefärbte Varianten */
export class Staged extends StageCache {
  constructor(
    readonly src: HTMLCanvasElement,
    tint: (stage: number) => StageTint,
  ) {
    super((stage) => tinted(src, tint(stage)));
  }
}

export function tinted(src: HTMLCanvasElement, t: StageTint): HTMLCanvasElement {
  return paint(src.width, src.height, (g, w, h) => {
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = "source-atop";
    if (t.night && t.night.a > 0.001) {
      g.globalAlpha = Math.min(1, t.night.a);
      g.fillStyle = t.night.color;
      g.fillRect(0, 0, w, h);
      g.globalAlpha = 1;
    }
    if (t.haze && (t.haze.aTop > 0.001 || t.haze.aBottom > 0.001)) {
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, rgbaOf(t.haze.color, t.haze.aTop));
      grd.addColorStop(1, rgbaOf(t.haze.color, t.haze.aBottom));
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    }
    if (t.shade && t.shade.a > 0.001) {
      const grd = g.createLinearGradient(0, h * t.shade.from, 0, h);
      grd.addColorStop(0, rgbaOf(t.shade.color, 0));
      grd.addColorStop(1, rgbaOf(t.shade.color, t.shade.a));
      g.fillStyle = grd;
      g.fillRect(0, h * t.shade.from, w, h * (1 - t.shade.from));
    }
  });
}

export interface StagedLayer {
  staged: Staged;
  lights: HTMLCanvasElement | null;
  lights2: HTMLCanvasElement | null;
  /** vertikaler Versatz der Leuchtkacheln relativ zur Ebene (zugeschnittene Lichtbänder) */
  lightsDy: number;
  w: number;
  h: number;
  y: number;
  factor: number;
}

export function stagedLayer(
  tile: HTMLCanvasElement,
  y: number,
  factor: number,
  tint: (stage: number) => StageTint,
  opts: { lights?: HTMLCanvasElement | null; lights2?: HTMLCanvasElement | null; lightsDy?: number } = {},
): StagedLayer {
  return {
    staged: new Staged(tile, tint),
    lights: opts.lights ?? null,
    lights2: opts.lights2 ?? null,
    lightsDy: opts.lightsDy ?? 0,
    w: tile.width,
    h: tile.height,
    y,
    factor,
  };
}

/** Zeichnet Stufe `stage` (und blendet `blend` in stage+1). */
export function drawStaged(g: Ctx2D, L: StagedLayer, dist: number, stage: number, blend: number, maxStage: number, lightA = 0, lights2A = lightA, dy = 0): void {
  const scroll = dist * L.factor;
  const y = L.y + dy;
  const a = L.staged.get(stage);
  blitTiled(g, a, L.w, L.h, scroll, y);
  if (blend > 0.004 && stage + 1 <= maxStage) {
    const pa = g.globalAlpha;
    g.globalAlpha = pa * blend;
    blitTiled(g, L.staged.get(stage + 1), L.w, L.h, scroll, y);
    g.globalAlpha = pa;
  }
  drawLights(g, L, scroll, y, lightA, lights2A);
}

export function drawLights(g: Ctx2D, L: StagedLayer, scroll: number, y: number, lightA: number, lights2A: number): void {
  if (!((L.lights && lightA > 0.03) || (L.lights2 && lights2A > 0.03))) return;
  const pa = g.globalAlpha;
  const op = g.globalCompositeOperation;
  g.globalCompositeOperation = "lighter";
  if (L.lights && lightA > 0.03) {
    g.globalAlpha = pa * Math.min(1, lightA);
    blitTiled(g, L.lights, L.lights.width, L.lights.height, scroll, y + L.lightsDy);
  }
  if (L.lights2 && lights2A > 0.03) {
    g.globalAlpha = pa * Math.min(1, lights2A);
    blitTiled(g, L.lights2, L.lights2.width, L.lights2.height, scroll, y + L.lightsDy);
  }
  g.globalAlpha = pa;
  g.globalCompositeOperation = op;
}

/**
 * Hält für alle Staged-Objekte die Varianten `stage` und `stage+1` bereit; erzeugt pro Aufruf höchstens `budget`
 * fehlende Varianten (Verteilung der Kosten über mehrere Frames) und verwirft alte.
 */
export function prepareStaged(list: StageCache[], stage: number, maxStage: number, budget = 1): void {
  let made = 0;
  const next = Math.min(maxStage, stage + 1);
  for (const s of list) {
    s.keep(stage, next);
    if (made < budget && !s.has(stage)) {
      s.get(stage);
      made += 1;
    }
    if (made < budget && !s.has(next)) {
      s.get(next);
      made += 1;
    }
  }
}

export function rgbaOf(color: string, a: number): string {
  const al = Math.max(0, Math.min(1, a)).toFixed(3);
  if (color.startsWith("#")) {
    let h = color.slice(1);
    if (h.length === 3) h = h.split("").map((x) => x + x).join("");
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${al})`;
  }
  if (color.startsWith("rgb(")) return color.replace("rgb(", "rgba(").replace(")", `,${al})`);
  return color;
}
