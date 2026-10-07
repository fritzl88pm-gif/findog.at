/**
 * Wien – Offscreen-Caches für schnelles Zeichnen. Grundregel (Software-Rendering!): nur 1:1-Blits an GANZZAHLIGEN
 * Positionen sind billig; skalierte/subpixel-versetzte drawImage-Aufrufe und Verlaufsfüllungen kosten ~8× so viel.
 * Deshalb werden Fernkulisse (gespiegelt), Verläufe, Lichthöfe und Rauchwolken in fester Größe vorgerendert.
 */
import { makeCanvas } from "../../draw-utils";
import { recycled, touchCanvas } from "../shared-b/canvas";
import { StageCache } from "../shared-b/layers";

export type C2D = CanvasRenderingContext2D;

/** Neue Fläche w×h bemalen; mit `reuse` (gleiche Größe) wird diese gelöscht und neu bemalt statt eine neue anzulegen. */
export function canvas(w: number, h: number, paint: (g: C2D, w: number, h: number) => void, reuse?: HTMLCanvasElement | null): HTMLCanvasElement {
  const c = recycled(reuse, w, h) ?? makeCanvas(w, h);
  const g = c.getContext("2d");
  if (g) paint(g, c.width, c.height);
  return c;
}

export function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** Horizontal gekachelte Fläche 1:1 an ganzzahliger Position (schneller Pfad). */
export function blitRow(g: C2D, tile: HTMLCanvasElement, scroll: number, y: number, viewW = 1280): void {
  const w = tile.width;
  let x = -Math.round(mod(scroll, w));
  const yy = Math.round(y);
  while (x < viewW) {
    g.drawImage(tile, x, yy);
    x += w;
  }
}

/** Kachel nur im Bildschirmfenster [x0, x1) zeichnen (Quelle zugeschnitten, ganzzahlig). */
export function blitRange(g: C2D, tile: HTMLCanvasElement, scroll: number, x0: number, x1: number, y: number, h = tile.height, sy = 0): void {
  const a = Math.round(x0);
  const b = Math.round(x1);
  if (b <= a) return;
  const w = tile.width;
  const off = Math.round(mod(scroll, w));
  const yy = Math.round(y);
  let x = a;
  let guard = 0;
  while (x < b && guard < 16) {
    const u = mod(x + off, w);
    const ww = Math.min(w - u, b - x);
    if (ww > 0) g.drawImage(tile, u, sy, ww, h, x, yy, ww, h);
    x += ww;
    guard += 1;
  }
}

/** Nicht gekachelte Fläche (z.B. Verlaufsstreifen 1280 breit) nur im Fenster [x0, x1) zeichnen. */
export function blitSlice(g: C2D, src: HTMLCanvasElement, x0: number, x1: number, y: number): void {
  const a = Math.max(0, Math.round(x0));
  const b = Math.min(src.width, Math.round(x1));
  if (b > a) g.drawImage(src, a, 0, b - a, src.height, a, Math.round(y), b - a, src.height);
}

/** Sprite zentriert 1:1 an ganzzahliger Position. */
export function blitAt(g: C2D, spr: HTMLCanvasElement, cx: number, cy: number): void {
  g.drawImage(spr, Math.round(cx - spr.width / 2), Math.round(cy - spr.height / 2));
}

/** Senkrechter Verlauf als fertige Fläche (w×h), zum 1:1-Blitten mit globalAlpha. */
export function vGradient(w: number, h: number, stops: Array<[number, string]>): HTMLCanvasElement {
  return canvas(w, h, (g) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    for (const [o, c] of stops) grd.addColorStop(o, c);
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  });
}

/** Elliptischer weicher Lichthof (w×h) mit Farbstopps. */
export function ellipseGlow(w: number, h: number, stops: Array<[number, string]>, cx = w / 2, cy = h / 2, rx = w / 2, ry = h / 2): HTMLCanvasElement {
  return canvas(w, h, (g) => {
    g.translate(cx, cy);
    g.scale(1, ry / rx);
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    for (const [o, c] of stops) grd.addColorStop(o, c);
    g.fillStyle = grd;
    g.fillRect(-rx, -rx, rx * 2, rx * 2);
  });
}

/**
 * Sprite in mehreren festen Größen (z.B. wachsende Rauchwolke): statt pro Frame zu skalieren wird die nächstliegende
 * vorgerenderte Größe 1:1 geblittet. Größen werden bei Bedarf erzeugt oder im Leerlauf vorgebacken (`prewarm`).
 */
export class SizedSprites {
  private readonly cache = new Map<number, HTMLCanvasElement>();
  /** Zeiger für prewarm: alle Indizes davor sind schon gebacken */
  private warmIdx = 0;
  /** Anzahl erreichbarer Größen (min, min+step, … bis max) */
  readonly count: number;

  constructor(
    private readonly paint: (size: number) => HTMLCanvasElement,
    private readonly min: number,
    private readonly max: number,
    private readonly step: number,
  ) {
    this.count = Math.round((max - min) / step) + 1;
  }

  /** Größe der Stufe `i` (0 … count-1) */
  sizeAt(i: number): number {
    return i * this.step + this.min;
  }

  /** Anzahl bereits gebackener Größen */
  get baked(): number {
    return this.cache.size;
  }

  get(size: number): HTMLCanvasElement {
    const s = Math.round((Math.min(this.max, Math.max(this.min, size)) - this.min) / this.step) * this.step + this.min;
    let c = this.cache.get(s);
    if (!c) {
      c = this.paint(s);
      this.cache.set(s, c);
    }
    return c;
  }

  /**
   * Backt bis zu `n` noch fehlende Größen (aufsteigend, höchstens bis `maxSize`) vor; jede Größe entsteht dabei höchstens
   * einmal und wird sofort gerastert (siehe `touchCanvas`), damit das erste Zeichnen nur noch ein Blit ist. Mit einem
   * größeren `maxSize` setzt ein späterer Aufruf die Arbeit fort. Rückgabe true = alle Größen bis `maxSize` liegen vor.
   */
  prewarm(n = 1, maxSize = Infinity): boolean {
    let left = n;
    while (this.warmIdx < this.count) {
      const s = this.sizeAt(this.warmIdx);
      if (s > maxSize) return true;
      if (!this.cache.has(s)) {
        if (left <= 0) return false;
        const c = this.paint(s);
        touchCanvas(c);
        this.cache.set(s, c);
        left -= 1;
      }
      this.warmIdx += 1;
    }
    return true;
  }

  /** Zentriert zeichnen */
  draw(g: C2D, size: number, cx: number, cy: number): void {
    blitAt(g, this.get(size), cx, cy);
  }
}

// --- Gemalte Fernkulisse ---------------------------------------------------------------------------

export interface BackdropBake {
  /** Dunst-/Sockelfarbe, in die der untere Rand des Bildes ausläuft (CSS) */
  foot: string;
}

/**
 * Gemalte Panoramen je Stufe, auf Zielhöhe vorskaliert und mit gespiegelter Kopie in EINER Kachel (Breite 2·w) –
 * pro Frame genügen ein bis zwei 1:1-Blits. Nur der sichtbare Streifen (y 0 … visH) wird gespeichert; der untere
 * Rand läuft weich in die Stufen-Dunstfarbe aus. Es werden nur die aktuelle und die nächste Stufe gehalten.
 */
export class MirrorBackdrop {
  private imgs: Array<HTMLImageElement | null> = [];
  readonly cache: StageCache;

  constructor(
    private readonly urls: string[],
    /** Bildschirm-y der Bildoberkante (darf negativ sein) */
    private readonly top: number,
    /** Zielhöhe des ganzen Bildes */
    private readonly drawH: number,
    /** sichtbare Höhe ab y = 0 */
    readonly visH: number,
    private readonly bake: (stage: number) => BackdropBake,
  ) {
    this.cache = new StageCache((i, reuse) => this.make(i, reuse), { recycle: true });
  }

  async load(image: (url: string) => Promise<HTMLImageElement | null>): Promise<void> {
    this.imgs = await Promise.all(this.urls.map((u) => image(u).catch(() => null)));
  }

  get ready(): boolean {
    return this.imgs.some((i) => !!i);
  }

  private make(i: number, reuse: HTMLCanvasElement | null): HTMLCanvasElement {
    const img = this.imgs[i] ?? this.imgs.find((x) => !!x) ?? null;
    if (!img) return makeCanvas(1, 1);
    const scale = this.drawH / img.height;
    const w = Math.round(img.width * scale);
    const H = this.visH;
    const sy = -this.top / scale;
    const sh = H / scale;
    const foot = this.bake(i).foot;
    return canvas(w * 2, H, (g) => {
      g.imageSmoothingQuality = "high";
      g.drawImage(img, 0, sy, img.width, sh, 0, 0, w, H);
      g.save();
      g.translate(w * 2, 0);
      g.scale(-1, 1);
      g.drawImage(img, 0, sy, img.width, sh, 0, 0, w, H);
      g.restore();
      // weicher Übergang in den Dunst unterhalb der Kulisse
      const fade = g.createLinearGradient(0, H - 70, 0, H);
      fade.addColorStop(0, "rgba(0,0,0,0)");
      fade.addColorStop(1, foot);
      g.globalCompositeOperation = "source-atop";
      g.fillStyle = fade;
      g.fillRect(0, H - 70, w * 2, 70);
    }, reuse);
  }

  draw(g: C2D, i: number, scroll: number, alpha = 1): void {
    const tile = this.cache.get(Math.max(0, Math.min(this.urls.length - 1, i)));
    const prev = g.globalAlpha;
    g.globalAlpha = prev * alpha;
    blitRow(g, tile, scroll, 0);
    g.globalAlpha = prev;
  }
}
