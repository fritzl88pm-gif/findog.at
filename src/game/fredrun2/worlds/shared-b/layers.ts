/**
 * Parallax-Ebene mit Tag-/Nacht-Variante und Leucht-Kacheln. Die Nacht-Variante wird automatisch aus der Tag-Kachel
 * erzeugt (Silhouette), Leuchtkacheln werden additiv gezeichnet.
 */
import { blitTiled, tintCopy, type Ctx2D } from "./canvas";

export interface ParallaxLayer {
  tile: HTMLCanvasElement;
  night: HTMLCanvasElement | null;
  lights: HTMLCanvasElement | null;
  /** zweite Leuchtkachel (Lauflicht-Effekt: gegenphasig blenden) */
  lights2: HTMLCanvasElement | null;
  w: number;
  h: number;
  /** Bildschirm-y der Kacheloberkante */
  y: number;
  /** Scrollfaktor relativ zu view.dist */
  factor: number;
}

export function makeLayer(
  tile: HTMLCanvasElement,
  y: number,
  factor: number,
  opts: { nightColor?: string; nightAlpha?: number; lights?: HTMLCanvasElement | null; lights2?: HTMLCanvasElement | null } = {},
): ParallaxLayer {
  return {
    tile,
    night: opts.nightColor ? tintCopy(tile, opts.nightColor, opts.nightAlpha ?? 0.82) : null,
    lights: opts.lights ?? null,
    lights2: opts.lights2 ?? null,
    w: tile.width,
    h: tile.height,
    y,
    factor,
  };
}

/**
 * Zeichnet die Ebene: Tag → (Nacht darüber mit Alpha `night`) → Lichter additiv.
 * `lightA`/`lights2A` = Deckkraft der Leuchtkacheln. `dy` verschiebt vertikal (z.B. Wippen).
 */
export function drawLayer(g: Ctx2D, L: ParallaxLayer, dist: number, night: number, lightA: number, lights2A = lightA, dy = 0): void {
  const scroll = dist * L.factor;
  const y = L.y + dy;
  if (!L.night || night < 0.985) blitTiled(g, L.tile, L.w, L.h, scroll, y);
  if (L.night && night > 0.015) {
    const pa = g.globalAlpha;
    g.globalAlpha = pa * Math.min(1, night);
    blitTiled(g, L.night, L.w, L.h, scroll, y);
    g.globalAlpha = pa;
  }
  if ((L.lights && lightA > 0.01) || (L.lights2 && lights2A > 0.01)) {
    const pa = g.globalAlpha;
    const op = g.globalCompositeOperation;
    g.globalCompositeOperation = "lighter";
    if (L.lights && lightA > 0.01) {
      g.globalAlpha = pa * Math.min(1, lightA);
      blitTiled(g, L.lights, L.lights.width, L.lights.height, scroll, y);
    }
    if (L.lights2 && lights2A > 0.01) {
      g.globalAlpha = pa * Math.min(1, lights2A);
      blitTiled(g, L.lights2, L.lights2.width, L.lights2.height, scroll, y);
    }
    g.globalAlpha = pa;
    g.globalCompositeOperation = op;
  }
}

/** Dunst über einer Ebene: vertikaler Verlauf von transparent (oben) zu `color` mit Alpha `a` (unten). */
export function haze(g: Ctx2D, y0: number, y1: number, color: string, aTop: number, aBottom: number, cache: { grd?: CanvasGradient; key?: string }): void {
  const key = `${color}|${aTop.toFixed(3)}|${aBottom.toFixed(3)}|${y0}|${y1}`;
  if (cache.key !== key || !cache.grd) {
    const grd = g.createLinearGradient(0, y0, 0, y1);
    grd.addColorStop(0, withA(color, aTop));
    grd.addColorStop(1, withA(color, aBottom));
    cache.grd = grd;
    cache.key = key;
  }
  g.fillStyle = cache.grd;
  g.fillRect(0, y0, 1280, y1 - y0);
}

function withA(color: string, a: number): string {
  if (color.startsWith("rgb(")) return color.replace("rgb(", "rgba(").replace(")", `,${a.toFixed(3)})`);
  if (color.startsWith("#")) {
    const n = parseInt(color.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
  }
  return color;
}
