/**
 * Zerlegte Leuchtflächen: Eine (meist additive) Lichtkachel wird in Zellen mit engen Bounding-Boxen zerlegt, damit pro
 * Frame nur die Bereiche geblendet werden, die wirklich Licht enthalten (Software-Rendering: Füllrate ist der Engpass).
 */
import type { Ctx2D } from "../shared-b/canvas";

export class Chunked {
  /** je Box: x, y, w, h (Quellkoordinaten), nach x sortiert */
  private boxes: number[] = [];
  readonly w: number;
  readonly h: number;

  constructor(readonly src: HTMLCanvasElement, cellW = 128, alphaMin = 3, cellH = 64) {
    this.w = src.width;
    this.h = src.height;
    const g = src.getContext("2d");
    let data: Uint8ClampedArray | null = null;
    try {
      data = g ? g.getImageData(0, 0, this.w, this.h).data : null;
    } catch {
      data = null;
    }
    for (let x0 = 0; x0 < this.w; x0 += cellW) {
      const cw = Math.min(cellW, this.w - x0);
      if (!data) {
        this.boxes.push(x0, 0, cw, this.h);
        continue;
      }
      // Zellen einer Spalte; benachbarte belegte Zellen werden zu einem Streifen verschmolzen
      let runY0 = -1;
      let runY1 = -1;
      for (let y0 = 0; y0 < this.h; y0 += cellH) {
        const ch = Math.min(cellH, this.h - y0);
        let top = -1;
        let bot = -1;
        for (let y = y0; y < y0 + ch; y += 1) {
          const row = y * this.w * 4;
          let hit = false;
          for (let x = x0; x < x0 + cw; x += 1) {
            if (data[row + x * 4 + 3] >= alphaMin) {
              hit = true;
              break;
            }
          }
          if (hit) {
            if (top < 0) top = y;
            bot = y;
          }
        }
        if (top >= 0) {
          if (runY0 >= 0 && top <= runY1 + 1 + cellH / 4) runY1 = bot;
          else {
            if (runY0 >= 0) this.boxes.push(x0, runY0, cw, runY1 - runY0 + 1);
            runY0 = top;
            runY1 = bot;
          }
        }
      }
      if (runY0 >= 0) this.boxes.push(x0, runY0, cw, runY1 - runY0 + 1);
    }
  }

  /** Anteil der tatsächlich gezeichneten Fläche (Diagnose) */
  get coverage(): number {
    let a = 0;
    for (let i = 0; i < this.boxes.length; i += 4) a += this.boxes[i + 2] * this.boxes[i + 3];
    return a / (this.w * this.h);
  }

  /** Einmal an (dx, dy) zeichnen (ganzzahlig). */
  draw(g: Ctx2D, dx: number, dy: number, viewW = 1280): void {
    const b = this.boxes;
    const ox = Math.round(dx);
    const oy = Math.round(dy);
    for (let i = 0; i < b.length; i += 4) {
      const x = ox + b[i];
      if (x + b[i + 2] <= 0) continue;
      if (x >= viewW) break;
      g.drawImage(this.src, b[i], b[i + 1], b[i + 2], b[i + 3], x, oy + b[i + 1], b[i + 2], b[i + 3]);
    }
  }

  /** Horizontal gekachelt mit Parallax-Scroll (wie blitTiled), nur sichtbare Boxen. */
  drawTiled(g: Ctx2D, scroll: number, y: number, viewW = 1280): void {
    const off = Math.round(((scroll % this.w) + this.w) % this.w);
    let x = -off;
    if (x + this.w <= 0) x += this.w;
    while (x < viewW) {
      this.draw(g, x, y, viewW);
      x += this.w;
    }
  }
}
