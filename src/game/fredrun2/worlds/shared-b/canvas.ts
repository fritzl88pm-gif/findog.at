/**
 * Offscreen-/Kachel-Helfer (Agent-B-Welten). Alles, was teuer ist, wird einmal auf Kacheln vorgerendert und pro
 * Frame nur noch geblittet.
 */
import { makeCanvas } from "../../draw-utils";

export type Ctx2D = CanvasRenderingContext2D;

export function ctxOf(c: HTMLCanvasElement): Ctx2D {
  const g = c.getContext("2d");
  if (!g) throw new Error("2D-Kontext nicht verfügbar");
  return g;
}

/** Erzeugt eine Offscreen-Fläche und zeichnet einmal hinein. */
export function paint(w: number, h: number, draw: (g: Ctx2D, w: number, h: number) => void): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const g = ctxOf(c);
  draw(g, w, h);
  return c;
}

/**
 * Nahtlos kachelbare Zeichnung: ruft `fn(x)` für ein Element bei x auf und – falls es über den Rand
 * (Breite `span`) hinausragt – zusätzlich um ±W verschoben.
 */
export function wrapDraw(W: number, x: number, span: number, fn: (x: number) => void): void {
  fn(x);
  if (x + span > W) fn(x - W);
  if (x - span < 0) fn(x + W);
}

/**
 * Kopie einer Kachel, eingefärbt mit `color` (Alpha `a`) – nur wo die Quelle deckt (Alpha bleibt erhalten).
 * Ideal für Nacht-/Silhouetten-Varianten.
 */
export function tintCopy(src: HTMLCanvasElement, color: string, a: number): HTMLCanvasElement {
  return paint(src.width, src.height, (g, w, h) => {
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = "source-atop";
    g.globalAlpha = a;
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
  });
}

/**
 * Zeichnet eine horizontal gekachelte Ebene. `scroll` = Ebenen-Scroll in px. Unterstützt Alpha/Composite
 * über den aktuellen Kontextzustand. `scale` skaliert die Kachel (Breite und Höhe).
 */
export function blitTiled(g: Ctx2D, tile: CanvasImageSource, tileW: number, tileH: number, scroll: number, y: number, viewW = 1280, scale = 1): void {
  const w = tileW * scale;
  const h = tileH * scale;
  let x = -(((scroll % w) + w) % w);
  while (x < viewW) {
    g.drawImage(tile, x, y, w + 0.6, h);
    x += w;
  }
}

/**
 * Kachel nur im Bildschirmbereich [x0, x1) zeichnen (Bodensegmente zwischen Lücken). `scroll` wie oben.
 * Quelle wird zugeschnitten → keine Überzeichnung in die Lücke.
 */
export function blitTiledRange(g: Ctx2D, tile: CanvasImageSource, tileW: number, tileH: number, scroll: number, x0: number, x1: number, y: number): void {
  if (x1 <= x0) return;
  const off = ((scroll % tileW) + tileW) % tileW;
  // Bildschirm-x → Kachel-x: u = (x + off) mod tileW
  let x = x0;
  let guard = 0;
  while (x < x1 && guard < 16) {
    const u = (((x + off) % tileW) + tileW) % tileW;
    const w = Math.min(tileW - u, x1 - x);
    if (w > 0.01) g.drawImage(tile, u, 0, w, tileH, x, y, w, tileH);
    x += w;
    guard += 1;
  }
}

export interface Seg {
  x0: number;
  x1: number;
}

const segBuf: Seg[] = [];
const pitBuf: Array<{ x0: number; x1: number; skin: string }> = [];

/** Feste Bodensegmente zwischen den Lücken (wiederverwendeter Puffer; Ergebnis sofort verwenden). */
export function solidSegments(pits: ReadonlyArray<{ x0: number; x1: number; skin: string }>, viewW = 1280): Seg[] {
  pitBuf.length = 0;
  for (const p of pits) pitBuf.push(p);
  pitBuf.sort((a, b) => a.x0 - b.x0);
  let n = 0;
  let x = -40;
  for (const p of pitBuf) {
    if (p.x0 > x) {
      if (!segBuf[n]) segBuf[n] = { x0: 0, x1: 0 };
      segBuf[n].x0 = x;
      segBuf[n].x1 = p.x0;
      n += 1;
    }
    x = Math.max(x, p.x1);
  }
  if (x < viewW + 40) {
    if (!segBuf[n]) segBuf[n] = { x0: 0, x1: 0 };
    segBuf[n].x0 = x;
    segBuf[n].x1 = viewW + 40;
    n += 1;
  }
  segBuf.length = Math.max(n, 0);
  return segBuf;
}

// --- Glow-Sprites --------------------------------------------------------------------------------

const glowCache = new Map<string, HTMLCanvasElement>();

/**
 * Vorgerenderter weicher Leuchtpunkt (radialer Verlauf, Zentrum hell). Größe 64 px; beim Zeichnen skalieren.
 * `core` = Anteil des hellen Kerns (0..1).
 */
export function glowSprite(color: string, core = 0.18): HTMLCanvasElement {
  const key = `${color}|${core}`;
  let c = glowCache.get(key);
  if (!c) {
    c = paint(64, 64, (g) => {
      const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, "rgba(255,255,255,1)");
      grd.addColorStop(core, color);
      grd.addColorStop(Math.min(0.95, core + 0.3), colorWithAlpha(color, 0.35));
      grd.addColorStop(1, colorWithAlpha(color, 0));
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 64);
    });
    glowCache.set(key, c);
  }
  return c;
}

/** Weicher Farbfleck ohne weißen Kern (für Lichtpfützen, Nebel, Bloom). */
export function softSprite(color: string): HTMLCanvasElement {
  const key = `soft|${color}`;
  let c = glowCache.get(key);
  if (!c) {
    c = paint(64, 64, (g) => {
      const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, color);
      grd.addColorStop(0.45, colorWithAlpha(color, 0.45));
      grd.addColorStop(1, colorWithAlpha(color, 0));
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 64);
    });
    glowCache.set(key, c);
  }
  return c;
}

/** Zeichnet einen Glow-Sprite zentriert bei (x, y) mit Radius r (Composite-Modus setzt der Aufrufer). */
export function glowAt(g: Ctx2D, spr: CanvasImageSource, x: number, y: number, r: number, ry = r): void {
  g.drawImage(spr, x - r, y - ry, r * 2, ry * 2);
}

/** #rrggbb / rgb() → rgba mit Alpha */
export function colorWithAlpha(color: string, a: number): string {
  if (color.startsWith("#")) {
    let h = color.slice(1);
    if (h.length === 3) h = h.split("").map((x) => x + x).join("");
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(",").map((s) => s.trim());
    return `rgba(${parts[0]},${parts[1]},${parts[2]},${a})`;
  }
  return color;
}

/** Sprite-Streifen: `frames` Bilder à size×size nebeneinander (für Münzen etc.). */
export function spriteStrip(frames: number, size: number, draw: (g: Ctx2D, frame: number, size: number) => void): HTMLCanvasElement {
  return paint(frames * size, size, (g) => {
    for (let f = 0; f < frames; f += 1) {
      g.save();
      g.translate(f * size, 0);
      g.beginPath();
      g.rect(0, 0, size, size);
      g.clip();
      draw(g, f, size);
      g.restore();
    }
  });
}

export function drawStripFrame(g: Ctx2D, strip: HTMLCanvasElement, size: number, frame: number, cx: number, cy: number, drawSize: number): void {
  g.drawImage(strip, frame * size, 0, size, size, cx - drawSize / 2, cy - drawSize / 2, drawSize, drawSize);
}

/** Pfad eines abgerundeten Rechtecks (ohne beginPath-Zwang). */
export function rr(g: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  g.moveTo(x + k, y);
  g.arcTo(x + w, y, x + w, y + h, k);
  g.arcTo(x + w, y + h, x, y + h, k);
  g.arcTo(x, y + h, x, y, k);
  g.arcTo(x, y, x + w, y, k);
  g.closePath();
}
