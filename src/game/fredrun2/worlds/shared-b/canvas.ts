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

/**
 * Wiederverwendbare Fläche: gibt `c` gelöscht und mit Standard-Zeichenzustand zurück, wenn sie genau w×h (gerundet wie
 * `makeCanvas`) groß ist; sonst null (der Aufrufer legt dann eine neue an). Spart bei Stufen-Bakes die Neuanlage der
 * großen Bitmaps (Allokation + Speicherdruck); der volle Reset verhindert, dass Zustand (Transform, Clip, Alpha,
 * Glättung) vom vorigen Inhalt in den neuen Bake wandert.
 */
export function recycled(c: HTMLCanvasElement | null | undefined, w: number, h: number): HTMLCanvasElement | null {
  if (!c) return null;
  const W = Math.max(1, Math.round(w));
  const H = Math.max(1, Math.round(h));
  if (c.width !== W || c.height !== H) return null;
  const g = c.getContext("2d");
  if (!g) return null;
  const reset = (g as CanvasRenderingContext2D & { reset?: () => void }).reset;
  if (typeof reset === "function") reset.call(g);
  else c.width = W; // setzt Bitmap und Zustand zurück (Spezifikation)
  return c;
}

// --- Rastern erzwingen -----------------------------------------------------------------------------

/** Das Nötigste vom Zeichenkontext der Berührungsfläche (2D-Kontext einer OffscreenCanvas) */
interface TouchSink {
  drawImage(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
}

/**
 * Kantenlänge der Berührungsfläche: knapp über der Größe, ab der Browser 2D-Flächen beschleunigen (Chromium: ca. 128×129 px).
 * So gehört sie zur selben Klasse wie die großen Kulissen-Kacheln und die Quelle muss nicht auf die CPU zurückgelesen werden.
 */
const TOUCH_SIZE = 160;

/** Konstruktor, mit dem `touchSink` angelegt wurde (undefined = noch nie geprüft; ändert sich nur in Tests mit Attrappen) */
let touchCtor: unknown;
let touchSink: TouchSink | null = null;

function touchTarget(): TouchSink | null {
  const ctor = typeof OffscreenCanvas === "undefined" ? null : OffscreenCanvas;
  if (ctor !== touchCtor) {
    touchCtor = ctor;
    touchSink = null;
    if (ctor) {
      try {
        touchSink = new ctor(TOUCH_SIZE, TOUCH_SIZE).getContext("2d");
      } catch {
        touchSink = null;
      }
    }
  }
  return touchSink;
}

/**
 * Zwingt den Browser, eine eben bemalte Fläche JETZT zu rastern. Der Zeichenkontext zeichnet nämlich nur auf (das kostet
 * die JS-Zeit des Malens); die eigentliche Rasterung der Fläche passiert erst beim ersten Lesen – also im ersten Frame,
 * in dem sie gezeichnet wird, bei großen Kulissen-Kacheln 10 bis 50 ms (Chromium, Software-Raster) mitten in einer
 * Überblendung. Ein 1×1-Ausschnitt in eine kleine Fläche genügt, damit die Quelle gerastert wird; danach kostet das
 * erste echte Zeichnen nur noch den Blit. Die Rasterkosten fallen so in den (gedrosselten) Bake-Schritt, ihr Anteil steckt
 * in `StageCache.costMs` und den Zeitscheiben von `WarmQueue`. Das anschließende `clearRect` lässt die Berührungsfläche
 * den Verweis auf die Quelle wieder los (sonst hielte sie verworfene Stufen-Bitmaps fest). Ohne OffscreenCanvas (alte
 * Browser, Vitest „node“) passiert nichts; das Bild bleibt in jedem Fall identisch.
 */
export function touchCanvas(c: HTMLCanvasElement): void {
  const sink = touchTarget();
  if (!sink || c.width < 1 || c.height < 1) return;
  try {
    sink.drawImage(c, 0, 0, 1, 1, 0, 0, 1, 1);
    sink.clearRect(0, 0, TOUCH_SIZE, TOUCH_SIZE);
  } catch {
    // Quelle nicht lesbar (verlorener Kontext o.ä.) → bleibt beim Lazy-Raster
  }
}

/** Erzeugt eine Offscreen-Fläche und zeichnet einmal hinein. Mit `reuse` (gleiche Größe) wird diese Fläche neu bemalt. */
export function paint(w: number, h: number, draw: (g: Ctx2D, w: number, h: number) => void, reuse?: HTMLCanvasElement | null): HTMLCanvasElement {
  const c = recycled(reuse, w, h) ?? makeCanvas(w, h);
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
 * Zeichnet eine horizontal gekachelte Ebene 1:1 an GANZZAHLIGEN Positionen (schneller Blit-Pfad; Subpixel-/skalierte
 * drawImage-Aufrufe sind in Software-Rendering ~10× teurer). `scroll` = Ebenen-Scroll in px.
 */
export function blitTiled(g: Ctx2D, tile: CanvasImageSource, tileW: number, tileH: number, scroll: number, y: number, viewW = 1280): void {
  void tileH;
  const off = Math.round(((scroll % tileW) + tileW) % tileW);
  const yy = Math.round(y);
  let x = -off;
  if (x + tileW <= 0) x += tileW;
  while (x < viewW) {
    g.drawImage(tile, x, yy);
    x += tileW;
  }
}

/**
 * Kachel nur im Bildschirmbereich [x0, x1) zeichnen (Bodensegmente zwischen Lücken). `scroll` wie oben.
 * Quelle wird zugeschnitten → keine Überzeichnung in die Lücke. Ganzzahlige Koordinaten.
 */
export function blitTiledRange(g: Ctx2D, tile: CanvasImageSource, tileW: number, tileH: number, scroll: number, x0: number, x1: number, y: number): void {
  const a = Math.round(x0);
  const b = Math.round(x1);
  if (b <= a) return;
  const off = Math.round(((scroll % tileW) + tileW) % tileW);
  const yy = Math.round(y);
  let x = a;
  let guard = 0;
  while (x < b && guard < 16) {
    const u = (((x + off) % tileW) + tileW) % tileW;
    const w = Math.min(tileW - u, b - x);
    if (w > 0) g.drawImage(tile, u, 0, w, tileH, x, yy, w, tileH);
    x += w;
    guard += 1;
  }
}

/** Großen vorgerenderten Sprite 1:1 an ganzzahliger Position zentriert zeichnen (schnell). */
export function blitCentered(g: Ctx2D, spr: HTMLCanvasElement, cx: number, cy: number): void {
  g.drawImage(spr, Math.round(cx - spr.width / 2), Math.round(cy - spr.height / 2));
}

/** Weicher, großer Leuchtfleck als fertige Fläche (w×h, elliptisch), zum 1:1-Blitten. */
export function bigGlow(w: number, h: number, stops: Array<[number, string]>): HTMLCanvasElement {
  return paint(w, h, (g) => {
    const r = Math.max(w, h) / 2;
    g.translate(w / 2, h / 2);
    g.scale(w / (2 * r), h / (2 * r));
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, r);
    for (const [o, c] of stops) grd.addColorStop(o, c);
    g.fillStyle = grd;
    g.fillRect(-r, -r, 2 * r, 2 * r);
  });
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
