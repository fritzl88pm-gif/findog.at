/**
 * Alpenpanorama – gebündeltes Schneetreiben: feste Flockenzahl in Float32Arrays, pro Frame zwei Pfade (fern/nah) statt
 * hunderter Einzel-Füllungen. Flocken driften mit dem Wind, scrollen je nach Tiefe mit der Welt und tanzen leicht.
 */
import type { Ctx2D } from "../shared-b/canvas";

const MAX = 240;

export class SnowField {
  private x = new Float32Array(MAX);
  private y = new Float32Array(MAX);
  private z = new Float32Array(MAX);
  private s = new Float32Array(MAX);
  private active = 0;

  constructor() {
    for (let i = 0; i < MAX; i += 1) this.reset(i, true);
  }

  private reset(i: number, anywhere: boolean): void {
    this.z[i] = Math.random();
    this.x[i] = Math.random() * 1400;
    this.y[i] = anywhere ? Math.random() * 720 : -10 - Math.random() * 60;
    this.s[i] = Math.random() * 100;
  }

  /** amount 0..1, wind 0..1 (nach links), scroll = Weltgeschwindigkeit px/s */
  update(dt: number, amount: number, wind: number, scroll: number, t: number, quality: 0 | 1 | 2): void {
    const cap = quality === 0 ? 70 : quality === 1 ? 150 : MAX;
    this.active = Math.round(cap * Math.min(1, amount));
    for (let i = 0; i < this.active; i += 1) {
      const z = this.z[i];
      const fall = 40 + z * 90;
      const vx = -(40 + wind * 260) * (0.5 + z) - scroll * (0.15 + 0.6 * z) + Math.sin(t * 1.3 + this.s[i]) * 18;
      this.x[i] += vx * dt;
      this.y[i] += fall * dt;
      if (this.y[i] > 740 || this.x[i] < -20) {
        this.reset(i, false);
        if (this.x[i] < 0) this.x[i] += 1400;
      }
    }
  }

  draw(g: Ctx2D, alpha: number): void {
    if (this.active <= 0 || alpha <= 0.01) return;
    const pa = g.globalAlpha;
    g.fillStyle = "#ffffff";
    // ferne Flocken: kleine Quadrate, ein Pfad
    g.globalAlpha = pa * alpha * 0.55;
    g.beginPath();
    for (let i = 0; i < this.active; i += 1) {
      const z = this.z[i];
      if (z > 0.6) continue;
      const r = 1.2 + z * 1.6;
      g.rect(this.x[i], this.y[i], r, r);
    }
    g.fill();
    // nahe Flocken: Kreise, ein Pfad
    g.globalAlpha = pa * alpha * 0.9;
    g.beginPath();
    for (let i = 0; i < this.active; i += 1) {
      const z = this.z[i];
      if (z <= 0.6) continue;
      const r = 1.6 + (z - 0.6) * 6;
      g.moveTo(this.x[i] + r, this.y[i]);
      g.arc(this.x[i], this.y[i], r, 0, Math.PI * 2);
    }
    g.fill();
    g.globalAlpha = pa;
  }
}
