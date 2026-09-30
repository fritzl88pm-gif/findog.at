/**
 * Christkindlmarkt – Zeichen-Helfer: vorgerenderte Props mit Lichtsaum (Halo), Glüh-Sprites, Schatten, Sterne.
 * Alles Teure entsteht einmal (lazy) auf Offscreen-Canvases; pro Frame bleiben ganzzahlige/leichte drawImage-Aufrufe.
 */
import { makeCanvas } from "../../draw-utils";
import type { PropLibrary } from "../../types";
import { glowSprite, paint, softSprite, type Ctx2D } from "../shared-b/canvas";
import { WINTER_FALLBACK } from "./fallback";

export const TAU = Math.PI * 2;

export function sat(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function fract(v: number): number {
  return v - Math.floor(v);
}

export function easeOut(u: number): number {
  const c = sat(u);
  return 1 - (1 - c) * (1 - c);
}

export function easeIn(u: number): number {
  const c = sat(u);
  return c * c;
}

export function smooth01(u: number): number {
  const c = sat(u);
  return c * c * (3 - 2 * c);
}

/** Vorgerenderte Leucht-Sprites (Farbe → weicher Fleck) */
export interface GlowSet {
  warm: HTMLCanvasElement;
  gold: HTMLCanvasElement;
  red: HTMLCanvasElement;
  orange: HTMLCanvasElement;
  cyan: HTMLCanvasElement;
  white: HTMLCanvasElement;
  green: HTMLCanvasElement;
  blue: HTMLCanvasElement;
  softWarm: HTMLCanvasElement;
  softCyan: HTMLCanvasElement;
  softWhite: HTMLCanvasElement;
  softRed: HTMLCanvasElement;
  puff: HTMLCanvasElement;
  puffPink: HTMLCanvasElement;
  cross: HTMLCanvasElement;
  shadow: HTMLCanvasElement;
  flake: HTMLCanvasElement;
  /** bläulich-graue Flocke: hebt sich im Whiteout vom hellen Grund ab */
  flakeCool: HTMLCanvasElement;
}

let glowCache: GlowSet | null = null;

export function makeGlows(): GlowSet {
  if (glowCache) return glowCache;
  const puff = (r: number, g: number, b: number): HTMLCanvasElement =>
    paint(64, 64, (c) => {
      const grd = c.createRadialGradient(32, 32, 2, 32, 32, 32);
      grd.addColorStop(0, `rgba(${r},${g},${b},0.85)`);
      grd.addColorStop(0.5, `rgba(${r},${g},${b},0.42)`);
      grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
      c.fillStyle = grd;
      c.fillRect(0, 0, 64, 64);
    });
  glowCache = {
    warm: glowSprite("#ffc266", 0.16),
    gold: glowSprite("#ffd86a", 0.16),
    red: glowSprite("#ff3a2a", 0.16),
    orange: glowSprite("#ff8a2a", 0.16),
    cyan: glowSprite("#7fe0ff", 0.16),
    white: glowSprite("#ffffff", 0.2),
    green: glowSprite("#7dff9a", 0.16),
    blue: glowSprite("#7aa8ff", 0.16),
    softWarm: softSprite("rgba(255,196,110,1)"),
    softCyan: softSprite("rgba(120,220,255,1)"),
    softWhite: softSprite("rgba(255,255,255,1)"),
    softRed: softSprite("rgba(255,60,40,1)"),
    puff: puff(255, 255, 255),
    puffPink: puff(255, 226, 218),
    // vierzackiger Glitzerstern (Kern + Strahlen)
    cross: paint(64, 64, (c) => {
      c.translate(32, 32);
      const grd = c.createRadialGradient(0, 0, 0, 0, 0, 30);
      grd.addColorStop(0, "rgba(255,255,255,1)");
      grd.addColorStop(0.25, "rgba(255,255,255,0.55)");
      grd.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = grd;
      c.beginPath();
      c.moveTo(0, -30);
      c.quadraticCurveTo(2.5, -2.5, 30, 0);
      c.quadraticCurveTo(2.5, 2.5, 0, 30);
      c.quadraticCurveTo(-2.5, 2.5, -30, 0);
      c.quadraticCurveTo(-2.5, -2.5, 0, -30);
      c.closePath();
      c.fill();
      const core = c.createRadialGradient(0, 0, 0, 0, 0, 9);
      core.addColorStop(0, "rgba(255,255,255,1)");
      core.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = core;
      c.fillRect(-9, -9, 18, 18);
    }),
    shadow: paint(64, 16, (c) => {
      const grd = c.createRadialGradient(32, 8, 0, 32, 8, 32);
      grd.addColorStop(0, "rgba(6,10,30,0.55)");
      grd.addColorStop(0.6, "rgba(6,10,30,0.22)");
      grd.addColorStop(1, "rgba(6,10,30,0)");
      c.save();
      c.scale(1, 0.25);
      c.translate(0, 24);
      c.fillStyle = grd;
      c.fillRect(0, -32, 64, 64);
      c.restore();
    }),
    flakeCool: paint(16, 16, (c) => {
      const grd = c.createRadialGradient(8, 8, 0, 8, 8, 8);
      grd.addColorStop(0, "rgba(255,255,255,1)");
      grd.addColorStop(0.32, "rgba(240,246,255,0.95)");
      grd.addColorStop(0.64, "rgba(140,164,208,0.6)");
      grd.addColorStop(1, "rgba(140,164,208,0)");
      c.fillStyle = grd;
      c.fillRect(0, 0, 16, 16);
    }),
    flake: paint(16, 16, (c) => {
      const grd = c.createRadialGradient(8, 8, 0, 8, 8, 8);
      grd.addColorStop(0, "rgba(255,255,255,0.95)");
      grd.addColorStop(0.45, "rgba(255,255,255,0.55)");
      grd.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = grd;
      c.fillRect(0, 0, 16, 16);
    }),
  };
  return glowCache;
}

/** Additiven Glühpunkt zeichnen (Aufrufer setzt `lighter`). */
export function glowAt(g: Ctx2D, spr: HTMLCanvasElement, x: number, y: number, r: number, ry = r): void {
  g.drawImage(spr, x - r, y - ry, r * 2, ry * 2);
}

/** Weicher Bodenschatten */
export function groundShadow(g: Ctx2D, glows: GlowSet, cx: number, groundY: number, rx: number, alpha = 1): void {
  const pa = g.globalAlpha;
  g.globalAlpha = pa * alpha;
  g.drawImage(glows.shadow, cx - rx, groundY - rx * 0.12, rx * 2, rx * 0.5);
  g.globalAlpha = pa;
}

// --- Props mit Halo ------------------------------------------------------------------------------

export interface Spr {
  c: HTMLCanvasElement;
  /** Pixelfaktor (Canvas-Pixel je logischem Pixel) */
  k: number;
  /** logische Maße des Bildes ohne Rand */
  w: number;
  h: number;
  /** Ankerpunkt in Canvas-Pixeln */
  ax: number;
  ay: number;
  /** Anker als Anteil der Bildhöhe von oben (Fuß = 1, Mitte = 0.5, oben = 0) */
  an: number;
  /** true = prozeduraler Ersatz (das gemalte Prop fehlt) */
  fb?: boolean;
  /** Lichtpunkte (Promille x, y, r) des Ersatzbildes */
  lights?: number[];
}

export type Anchor = "foot" | "center" | "top";

/**
 * Vorgerenderte Props: Bild + weicher Lichtsaum (damit Gefahren sich auch in dunklen/hellen Stufen klar abheben).
 * Schlüssel = Prop, Höhe, Halo-Farbe, Variante.
 * Fehlt das gemalte Prop (Netzfehler, Blocker, veralteter Manifest-Cache), backt der Cache stattdessen den prozeduralen
 * Ersatz aus `fallback.ts` – gleiche Maße, Blickrichtung und Ankerpunkte, sodass alle Animationen unverändert greifen.
 */
export class SpriteCache {
  dpr = 1;
  private cache = new Map<string, Spr | null>();
  /** Sprites beliebiger Breite (Eiszapfen-Balken): höchstens CUSTOM_MAX im Speicher */
  private custom = new Map<string, Spr | null>();
  constructor(public props: PropLibrary) {}

  reset(dpr: number): void {
    this.dpr = dpr;
    this.cache.clear();
    this.custom.clear();
  }

  /** Höhe `h` (logisch); `halo` = CSS-Farbe oder null; `variant` unterscheidet nachbearbeitete Kopien (z.B. Elf ohne Ball) */
  get(id: string, h: number, halo: string | null, anchor: Anchor = "foot", variant = "", post?: (g: Ctx2D, s: Spr) => void): Spr | null {
    const real = this.props.has(id);
    const fb = real ? null : (WINTER_FALLBACK[id] ?? null);
    const key = `${id}|${Math.round(h)}|${halo ?? ""}|${anchor}|${variant}${fb ? "|fb" : ""}`;
    if (this.cache.has(key)) return this.cache.get(key) ?? null;
    const cell = real ? this.props.cell(id) : fb;
    if (!cell) {
      // (noch) nicht geladen und kein Ersatz: nicht dauerhaft merken
      return null;
    }
    const spr = this.bake(h, halo, anchor, cell, (g, x, y, hPx, ayN) => this.props.draw(g, id, x, y, { h: hPx, ax: 0.5, ay: ayN }), fb, post);
    if (spr) this.cache.set(key, spr);
    return spr;
  }

  /** Ersatz-Sprite mit frei wählbarer Breite (`w` × `h` logisch), z. B. Eiszapfen-Balken; nur prozedural, pro Größe gemerkt */
  proc(key: string, w: number, h: number, halo: string | null, anchor: Anchor, paintFn: (g: Ctx2D, w: number, h: number) => void): Spr | null {
    const k = `${key}|${Math.round(w)}|${Math.round(h)}|${halo ?? ""}|${anchor}`;
    const hit = this.custom.get(k);
    if (hit !== undefined) return hit;
    const fb = { w, h, paint: paintFn };
    const spr = this.bake(h, halo, anchor, fb, () => undefined, fb, undefined);
    this.custom.set(k, spr);
    if (this.custom.size > CUSTOM_MAX) {
      const oldest = this.custom.keys().next().value;
      if (oldest !== undefined) this.custom.delete(oldest);
    }
    return spr;
  }

  private bake(
    h: number,
    halo: string | null,
    anchor: Anchor,
    cell: { w: number; h: number },
    drawReal: (g: Ctx2D, x: number, y: number, hPx: number, ayN: number) => boolean | void,
    fb: { w: number; h: number; paint: (g: Ctx2D, w: number, h: number) => void; lights?: number[] } | null,
    post?: (g: Ctx2D, s: Spr) => void,
  ): Spr | null {
    const k = Math.max(1, Math.min(2, this.dpr));
    const w = (h * cell.w) / cell.h;
    const m = Math.ceil((halo ? 14 : 2) * k);
    const cw = Math.ceil(w * k + m * 2);
    const ch = Math.ceil(h * k + m * 2);
    const c = makeCanvas(cw, ch);
    const g = c.getContext("2d");
    if (!g) return null;
    const ax = cw / 2;
    const ay = anchor === "foot" ? m + h * k : anchor === "center" ? ch / 2 : m;
    const ayN = anchor === "foot" ? 1 : anchor === "center" ? 0.5 : 0;
    g.imageSmoothingQuality = "high";
    let put: (x: number, y: number) => void = (x, y) => void drawReal(g, x, y, h * k, ayN);
    if (fb) {
      // Ersatzbild einmal in Zielgröße zeichnen; danach wie ein geladenes Prop behandeln (Halo, Nachbearbeitung)
      const bw = Math.max(1, Math.round(w * k));
      const bh = Math.max(1, Math.round(h * k));
      const body = makeCanvas(bw, bh);
      const bg = body.getContext("2d");
      if (!bg) return null;
      bg.imageSmoothingQuality = "high";
      bg.scale(bw / fb.w, bh / fb.h);
      try {
        fb.paint(bg, fb.w, fb.h);
      } catch {
        return null; // Ersatzbild nicht darstellbar → der Skin nutzt seinen einfachen Notbehelf
      }
      put = (x, y) => g.drawImage(body, x - bw / 2, y - ayN * bh);
    }
    if (halo) {
      const far = cw * 2;
      g.save();
      g.shadowColor = halo;
      g.shadowOffsetX = far;
      g.shadowOffsetY = 0;
      for (const blur of [5 * k, 12 * k]) {
        g.shadowBlur = blur;
        put(ax - far, ay);
      }
      g.restore();
    }
    put(ax, ay);
    const spr: Spr = { c, k, w, h, ax, ay, an: ayN };
    if (fb) {
      spr.fb = true;
      spr.lights = fb.lights;
    }
    post?.(g, spr);
    return spr;
  }
}

const CUSTOM_MAX = 24;

/**
 * Sprite an (cx, y) zeichnen; (cx, y) = Ankerpunkt. Optional Drehung um den Anker, Stauchung/Streckung, Spiegelung.
 */
export function blitSpr(g: Ctx2D, s: Spr, cx: number, y: number, o: { rot?: number; sx?: number; sy?: number; flip?: boolean; alpha?: number } = {}): void {
  const inv = 1 / s.k;
  const pa = g.globalAlpha;
  if (o.alpha !== undefined) g.globalAlpha = pa * o.alpha;
  if (o.rot || o.sx !== undefined || o.sy !== undefined || o.flip) {
    g.save();
    g.translate(cx, y);
    if (o.rot) g.rotate(o.rot);
    g.scale((o.sx ?? 1) * (o.flip ? -1 : 1), o.sy ?? 1);
    g.drawImage(s.c, -s.ax * inv, -s.ay * inv, s.c.width * inv, s.c.height * inv);
    g.restore();
  } else {
    g.drawImage(s.c, cx - s.ax * inv, y - s.ay * inv, s.c.width * inv, s.c.height * inv);
  }
  g.globalAlpha = pa;
}

/** Position eines Lichtpunkts (Promille des Bildes) innerhalb eines mit `blitSpr` gezeichneten, ggf. gespiegelten Sprites */
export function sprPoint(s: Spr, cx: number, y: number, px: number, py: number, flip: boolean): { x: number; y: number } {
  const dx = (px / 1000 - 0.5) * s.w * (flip ? -1 : 1);
  const top = y - s.an * s.h;
  return { x: cx + dx, y: top + (py / 1000) * s.h };
}
