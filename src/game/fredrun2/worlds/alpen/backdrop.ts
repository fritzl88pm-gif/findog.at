/**
 * Alpenpanorama – gemalte Fernkulisse (Original-Hintergründe aus Fredrun 1) + gemalte Wahrzeichen (Landmarks).
 *
 * Die Kulissenbilder (2172 × 665) zeigen oben Berge/Wälder, unten eine Wiese. Wir verwenden nur die obere Hälfte,
 * skalieren sie einmal auf Zielhöhe vor, färben sie pro Stimmungsstufe ein (Morgengold, Mittagsdunst, Wind,
 * Alpenglühen) und blenden die obere Kante weich in den Himmel aus (die Bilder sind oben hart beschnitten).
 * Gekachelt wird gespiegelt (Motive ohne Schrift) – pro Frame ein bis zwei 1:1-Blits.
 */
import { warmImage } from "../../assets";
import type { AssetLoader, PropLibrary } from "../../types";
import { paint } from "../shared-b/canvas";
import { StageCache, gradedCache } from "../shared-b/layers";
import { BACKDROP_OF_STAGE, BACKDROP_URLS, MAX_STAGE, STAGE_PAL } from "./stages";

export const BACKDROP_H = 440;
const CROP_H = 0.5;
const FADE_H = 110;

export class AlpBackdrop {
  private imgs: Array<HTMLImageElement | null> = [];
  private cache: StageCache | null = null;
  private tileW = 0;

  async load(assets: AssetLoader): Promise<void> {
    this.imgs = await Promise.all(BACKDROP_URLS.map((u) => assets.image(u).catch(() => null)));
    const any = this.imgs.find((i) => !!i);
    if (!any) return;
    this.tileW = Math.round(any.width * (BACKDROP_H / (any.height * CROP_H)));
    // Bild skalieren (Vorarbeit), Stimmung daraufmalen (Vorarbeit), Dunst daraufmalen (Vorarbeit) und weiche Oberkante (Bake)
    // sind vier kleine Schritte statt eines großen: jeder füllt/rastert die 2,8×0,44 Megapixel großen Flächen nur einmal
    this.cache = gradedCache(
      (s, reuse, grade) => this.bake(s, reuse, grade),
      [(c, s) => this.gradeMood(c, s), (c, s) => this.gradeHaze(c, s), (c, s) => this.gradeFade(c, s)],
    );
  }

  get ready(): boolean {
    return !!this.cache;
  }

  get stages(): StageCache | null {
    return this.cache;
  }

  private imageOf(stage: number): HTMLImageElement | null {
    return this.imgs[BACKDROP_OF_STAGE[stage]] ?? this.imgs.find((i) => !!i) ?? null;
  }

  /**
   * Kulissenbild der Stufe vordekodieren (der Browser dekodiert ein Bild erst beim ersten Zeichnen: 5-15 ms, die sonst
   * zusammen mit dem Skalieren im ersten Bake-Schritt anfielen). Aufruf kurz vor dem Vorbacken der Folgestufe (`StagePrep.onApproach`).
   */
  predecode(stage: number): void {
    const img = this.imageOf(stage);
    if (img) void warmImage(img);
  }

  /** Kulissenbild auf Kachelgröße skalieren (`grade` = Färbung gleich mit anwenden) */
  private bake(stage: number, reuse: HTMLCanvasElement | null, grade: boolean): HTMLCanvasElement {
    const img = this.imageOf(stage);
    const W = this.tileW;
    const H = BACKDROP_H;
    const c = paint(
      W,
      H,
      (g) => {
        if (!img) return;
        g.imageSmoothingQuality = "high";
        g.drawImage(img, 0, 0, img.width, img.height * CROP_H, 0, 0, W, H);
      },
      reuse,
    );
    if (grade) {
      this.gradeMood(c, stage);
      this.gradeHaze(c, stage);
      this.gradeFade(c, stage);
    }
    return c;
  }

  /** Stimmung (Mischmodi-Durchgänge) auf das skalierte Kulissenbild legen; false = diese Stufe hat keine */
  private gradeMood(c: HTMLCanvasElement, stage: number): boolean {
    if (!this.imageOf(stage)) return false;
    const g = c.getContext("2d");
    if (!g) return false;
    const W = c.width;
    const H = c.height;
    if (stage === 0) {
      g.globalCompositeOperation = "soft-light";
      g.globalAlpha = 0.4;
      g.fillStyle = "#ffcf7a";
      g.fillRect(0, 0, W, H);
    } else if (stage === 2) {
      g.globalCompositeOperation = "soft-light";
      g.globalAlpha = 0.18;
      g.fillStyle = "#9fd0ff";
      g.fillRect(0, 0, W, H);
    } else if (stage === 3) {
      g.globalCompositeOperation = "saturation";
      g.globalAlpha = 0.25;
      g.fillStyle = "#808080";
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = "soft-light";
      g.globalAlpha = 0.3;
      g.fillStyle = "#a8c0dc";
      g.fillRect(0, 0, W, H);
    } else if (stage === 4) {
      // Alpenglühen: Schnee glüht rosa-orange, Täler versinken im Violett
      g.globalCompositeOperation = "multiply";
      g.globalAlpha = 1;
      g.fillStyle = "#f2a88f";
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = "soft-light";
      g.globalAlpha = 0.55;
      g.fillStyle = "#ff7a4a";
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = "source-over";
      const low = g.createLinearGradient(0, H * 0.35, 0, H);
      low.addColorStop(0, "rgba(70,40,110,0)");
      low.addColorStop(1, "rgba(70,40,110,0.45)");
      g.globalAlpha = 1;
      g.fillStyle = low;
      g.fillRect(0, H * 0.35, W, H * 0.65);
    } else {
      return false;
    }
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    return true;
  }

  /** Luftperspektive: Dunst nach unten (Talboden) und oben (Gipfel im Himmelsblau) auf das skalierte Kulissenbild legen */
  private gradeHaze(c: HTMLCanvasElement, stage: number): boolean {
    if (!this.imageOf(stage)) return false;
    const g = c.getContext("2d");
    if (!g) return false;
    const W = c.width;
    const H = c.height;
    const P = STAGE_PAL[stage];
    const hz = g.createLinearGradient(0, 0, 0, H);
    hz.addColorStop(0, hexA(P.mid, stage === 4 ? 0.1 : 0.22));
    hz.addColorStop(0.45, hexA(P.haze, 0.05));
    hz.addColorStop(1, hexA(P.haze, stage === 3 ? 0.5 : 0.36));
    g.fillStyle = hz;
    g.fillRect(0, 0, W, H);
    return true;
  }

  /** Weich in den Himmel ausblenden (die Bilder sind oben hart beschnitten) */
  private gradeFade(c: HTMLCanvasElement, stage: number): boolean {
    if (!this.imageOf(stage)) return false;
    const g = c.getContext("2d");
    if (!g) return false;
    const W = c.width;
    const H = c.height;
    // destination-in löscht alles außerhalb der gefüllten Fläche → ganze Kachel füllen
    g.globalCompositeOperation = "destination-in";
    const fade = g.createLinearGradient(0, 0, 0, FADE_H);
    fade.addColorStop(0, "rgba(0,0,0,0)");
    fade.addColorStop(0.6, "rgba(0,0,0,0.75)");
    fade.addColorStop(1, "rgba(0,0,0,1)");
    g.fillStyle = fade;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = "source-over";
    return true;
  }

  /** Gespiegelt gekachelt zeichnen (1:1, ganzzahlig). */
  draw(g: CanvasRenderingContext2D, stage: number, scroll: number, y: number, alpha = 1): void {
    if (!this.cache) return;
    const tile = this.cache.get(Math.max(0, Math.min(MAX_STAGE, stage)));
    const w = this.tileW;
    const period = w * 2;
    const off = Math.round(((scroll % period) + period) % period);
    const yy = Math.round(y);
    const pa = g.globalAlpha;
    g.globalAlpha = pa * alpha;
    let x = -off;
    let n = 0;
    while (x < 1280) {
      if (x + w > 0) {
        if (n % 2 === 0) g.drawImage(tile, x, yy);
        else {
          g.save();
          g.translate(x + w, yy);
          g.scale(-1, 1);
          g.drawImage(tile, 0, 0);
          g.restore();
        }
      }
      x += w;
      n += 1;
    }
    g.globalAlpha = pa;
  }
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// --- Wahrzeichen ---------------------------------------------------------------------------------------

export interface LandmarkSet {
  /** Sprite je Stufe (getönt), unten-mittig verankert */
  stages: StageCache;
  w: number;
  h: number;
}

/**
 * Prop in ein Offscreen-Bild rendern und pro Stufe mit Dunst/Abendlicht tönen (source-atop).
 * `haze` = Tönungsstärke (0.25 … 0.55), `snowy` hellt in späten Stufen zusätzlich auf.
 */
export function bakeLandmark(props: PropLibrary, id: string, h: number, haze: number, flip = false): LandmarkSet | null {
  if (!props.has(id)) return null;
  const cell = props.cell(id);
  if (!cell) return null;
  const w = Math.ceil((cell.w * h) / cell.h);
  const base = paint(w, h, (g) => {
    props.draw(g, id, w / 2, h, { h, flipX: flip });
  });
  const stages = new StageCache(
    (s, reuse) =>
      paint(
        w,
        h,
        (g) => {
          g.drawImage(base, 0, 0);
          const P = STAGE_PAL[s];
          if (s === 4) {
            g.globalCompositeOperation = "source-atop";
            g.fillStyle = "rgba(120,60,110,0.35)";
            g.fillRect(0, 0, w, h);
          }
          g.globalCompositeOperation = "source-atop";
          const grd = g.createLinearGradient(0, 0, 0, h);
          grd.addColorStop(0, hexA(P.haze, haze * 0.8));
          grd.addColorStop(1, hexA(P.haze, Math.min(0.9, haze * 1.35)));
          g.fillStyle = grd;
          g.fillRect(0, 0, w, h);
          if (s === 4) {
            // Alpenglühen auf der Lichtseite
            g.globalCompositeOperation = "source-atop";
            const glow = g.createLinearGradient(w, 0, 0, h);
            glow.addColorStop(0, "rgba(255,150,100,0.35)");
            glow.addColorStop(1, "rgba(255,150,100,0)");
            g.fillStyle = glow;
            g.fillRect(0, 0, w, h);
          }
        },
        reuse,
      ),
    { recycle: true },
  );
  return { stages, w, h };
}

/** Kleines vorskaliertes Sprite eines Props (z.B. Gondel im Hintergrund, Edelweiß-Münze) */
export function propSprite(props: PropLibrary, id: string, h: number, opts: { flip?: boolean; cropTop?: number } = {}): HTMLCanvasElement | null {
  if (!props.has(id)) return null;
  const cell = props.cell(id);
  if (!cell) return null;
  const w = Math.ceil((cell.w * h) / cell.h);
  const top = Math.round((opts.cropTop ?? 0) * h);
  const c = paint(w, h - top, (g) => {
    g.imageSmoothingQuality = "high";
    props.draw(g, id, w / 2, h - top, { h, flipX: opts.flip, ay: 1 });
  });
  return c;
}
