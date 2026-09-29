/** Kleine Zeichenhelfer, die von Engine und Welten gemeinsam genutzt werden. */

export function rgba(hex: string, a: number): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function smoothstep(a: number, b: number, v: number): number {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Mischt zwei #rrggbb-Farben. */
export function mix(c1: string, c2: string, t: number): string {
  const p = (c: string) => {
    const h = c.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const a = p(c1);
  const b = p(c2);
  const r = a.map((v, i) => Math.round(lerp(v, b[i], t)));
  return `rgb(${r[0]}, ${r[1]}, ${r[2]})`;
}

/** Deterministische Pseudozufallszahl 0..1 aus Ganzzahl-Seed. */
export function hash1(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/**
 * Zeichnet eine horizontal wiederholte Ebene (Parallax). `tile` ist eine vorgerenderte Kachel (Canvas/Bild),
 * die nahtlos kachelbar sein muss. `scroll` in Pixeln der Ebene.
 */
export function drawTiled(
  g: CanvasRenderingContext2D,
  tile: CanvasImageSource,
  tileW: number,
  tileH: number,
  scroll: number,
  y: number,
  viewW: number,
  scaleX = 1,
): void {
  const w = tileW * scaleX;
  let x = -(((scroll % w) + w) % w);
  while (x < viewW) {
    g.drawImage(tile, x, y, w, tileH);
    x += w - 0.5; // 0.5 px Überlappung verhindert Nähte
  }
}

/** Erzeugt eine Offscreen-Zeichenfläche (OffscreenCanvas wenn möglich, sonst <canvas>). */
export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
