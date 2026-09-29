/**
 * Wetter & Ambient-Partikel (Bildschirmraum, ohne Allokationen pro Frame): Regen, Schnee, Glut, Asche, Staub, Papier.
 */
import type { ViewState } from "../../types";

/** Regen in zwei Tiefenebenen, als gebündelte Linienpfade (billig). */
export class Rain {
  private readonly max: number;
  private x: Float32Array;
  private y: Float32Array;
  private s: Float32Array;
  private z: Float32Array;
  private splX: Float32Array;
  private splT: Float32Array;
  private splN = 0;
  private active = 0;
  wind = -260;

  constructor(max = 360) {
    this.max = max;
    this.x = new Float32Array(max);
    this.y = new Float32Array(max);
    this.s = new Float32Array(max);
    this.z = new Float32Array(max);
    this.splX = new Float32Array(48);
    this.splT = new Float32Array(48).fill(1);
    for (let i = 0; i < max; i += 1) this.reset(i, true);
  }

  private reset(i: number, anyY: boolean): void {
    this.z[i] = Math.random();
    this.x[i] = Math.random() * 1500 - 60;
    this.y[i] = anyY ? Math.random() * 760 - 40 : -40 - Math.random() * 80;
    this.s[i] = 0.75 + Math.random() * 0.5;
  }

  /** intensity 0..1 */
  update(dt: number, v: ViewState, intensity: number, groundY: number): void {
    const q = v.quality === 0 ? 0.35 : v.quality === 1 ? 0.65 : 1;
    this.active = Math.round(this.max * Math.min(1, intensity) * q);
    const scroll = v.speed * 0.9;
    for (let i = 0; i < this.active; i += 1) {
      const z = this.z[i];
      const vy = (1300 + 900 * z) * this.s[i];
      this.y[i] += vy * dt;
      this.x[i] += (this.wind * (0.6 + z) - scroll * (0.25 + 0.75 * z)) * dt;
      const floor = z > 0.55 ? groundY + 4 + (z - 0.55) * 250 : groundY - 20 - (1 - z) * 160;
      if (this.y[i] > floor || this.x[i] < -80) {
        if (z > 0.55 && this.y[i] > floor && this.splN < 48 && v.quality > 0 && Math.random() < 0.5) {
          const k = this.splN++;
          this.splX[k] = this.x[i];
          this.splT[k] = 0;
        }
        this.reset(i, false);
        if (this.x[i] < -80) this.x[i] += 1500;
      }
    }
    // Spritzer
    let w = 0;
    for (let k = 0; k < this.splN; k += 1) {
      const t = this.splT[k] + dt * 5;
      if (t < 1) {
        this.splX[w] = this.splX[k] - scroll * dt;
        this.splT[w] = t;
        w += 1;
      }
    }
    this.splN = w;
  }

  draw(g: CanvasRenderingContext2D, color: string, alpha: number, groundY: number): void {
    if (this.active <= 0 || alpha <= 0.01) return;
    const k = 0.018;
    g.save();
    g.strokeStyle = color;
    g.lineCap = "round";
    // ferne Tropfen
    g.globalAlpha = alpha * 0.35;
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < this.active; i += 1) {
      const z = this.z[i];
      if (z > 0.55) continue;
      const vy = (1300 + 900 * z) * this.s[i];
      const x = this.x[i];
      const y = this.y[i];
      g.moveTo(x, y);
      g.lineTo(x - this.wind * k * 0.6, y - vy * k * 0.7);
    }
    g.stroke();
    // nahe Tropfen
    g.globalAlpha = alpha * 0.55;
    g.lineWidth = 1.8;
    g.beginPath();
    for (let i = 0; i < this.active; i += 1) {
      const z = this.z[i];
      if (z <= 0.55) continue;
      const vy = (1300 + 900 * z) * this.s[i];
      const x = this.x[i];
      const y = this.y[i];
      g.moveTo(x, y);
      g.lineTo(x - this.wind * k, y - vy * k);
    }
    g.stroke();
    // Spritzer am Boden
    if (this.splN) {
      g.globalAlpha = alpha * 0.6;
      g.lineWidth = 1.2;
      g.beginPath();
      for (let k2 = 0; k2 < this.splN; k2 += 1) {
        const t = this.splT[k2];
        const r = 3 + t * 9;
        const x = this.splX[k2];
        const y = groundY + 6 + (k2 % 5) * 9;
        g.moveTo(x - r, y);
        g.quadraticCurveTo(x, y - r * 0.9 * (1 - t), x + r, y);
      }
      g.stroke();
    }
    g.restore();
  }
}

export type MoteKind = "ember" | "ash" | "snow" | "dust" | "paper" | "leaf" | "spark" | "petal" | "firefly";

/**
 * Allgemeiner Partikel-Pool (Bildschirmraum). `par` = Parallax-Faktor (wie stark das Partikel mit der Welt scrollt).
 */
export class Motes {
  readonly max: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  readonly size: Float32Array;
  readonly seed: Float32Array;
  readonly par: Float32Array;
  readonly kind: Uint8Array;
  count = 0;

  static readonly KINDS: MoteKind[] = ["ember", "ash", "snow", "dust", "paper", "leaf", "spark", "petal", "firefly"];

  constructor(max = 200) {
    this.max = max;
    this.x = new Float32Array(max);
    this.y = new Float32Array(max);
    this.vx = new Float32Array(max);
    this.vy = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.seed = new Float32Array(max);
    this.par = new Float32Array(max);
    this.kind = new Uint8Array(max);
  }

  spawn(kind: MoteKind, x: number, y: number, vx: number, vy: number, life: number, size: number, par = 1): void {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.seed[i] = Math.random() * 100;
    this.par[i] = par;
    this.kind[i] = Motes.KINDS.indexOf(kind);
  }

  countOf(kind: MoteKind): number {
    const k = Motes.KINDS.indexOf(kind);
    let n = 0;
    for (let i = 0; i < this.count; i += 1) if (this.kind[i] === k) n += 1;
    return n;
  }

  /** scroll = Welt-Scrollgeschwindigkeit (px/s); wind = zusätzliche x-Drift; t = Zeit */
  update(dt: number, scroll: number, wind: number, t: number): void {
    let w = 0;
    for (let i = 0; i < this.count; i += 1) {
      const life = this.life[i] - dt;
      if (life <= 0) continue;
      const kind = Motes.KINDS[this.kind[i]];
      const s = this.seed[i];
      let vx = this.vx[i];
      let vy = this.vy[i];
      switch (kind) {
        case "snow":
        case "ash":
        case "petal":
          vx += Math.sin(t * 1.7 + s) * 40 * dt;
          break;
        case "paper":
        case "leaf":
          vx += Math.sin(t * 2.3 + s) * 120 * dt;
          vy += Math.cos(t * 3.1 + s) * 120 * dt;
          break;
        case "ember":
          vx += Math.sin(t * 3 + s) * 60 * dt;
          vy -= 30 * dt;
          break;
        case "spark":
          vy += 900 * dt;
          break;
        case "firefly":
          vx = Math.sin(t * 0.9 + s) * 30;
          vy = Math.cos(t * 1.3 + s * 2) * 24;
          break;
        default:
          break;
      }
      const x = this.x[i] + (vx + wind - scroll * this.par[i]) * dt;
      const y = this.y[i] + vy * dt;
      if (x < -60 || x > 1400 || y > 780 || y < -120) continue;
      this.x[w] = x;
      this.y[w] = y;
      this.vx[w] = vx;
      this.vy[w] = vy;
      this.life[w] = life;
      this.maxLife[w] = this.maxLife[i];
      this.size[w] = this.size[i];
      this.seed[w] = s;
      this.par[w] = this.par[i];
      this.kind[w] = this.kind[i];
      w += 1;
    }
    this.count = w;
  }

  draw(g: CanvasRenderingContext2D, t: number, alpha = 1): void {
    if (!this.count) return;
    g.save();
    for (let i = 0; i < this.count; i += 1) {
      const kind = Motes.KINDS[this.kind[i]];
      const u = this.life[i] / this.maxLife[i];
      const fade = Math.min(1, u * 4) * Math.min(1, (1 - u) * 6 + 0.2);
      const x = this.x[i];
      const y = this.y[i];
      const r = this.size[i];
      const s = this.seed[i];
      switch (kind) {
        case "ember": {
          g.globalCompositeOperation = "lighter";
          g.globalAlpha = alpha * fade * (0.6 + 0.4 * Math.sin(t * 12 + s));
          g.strokeStyle = u > 0.5 ? "#ffd27a" : "#ff7a2a";
          g.lineWidth = r;
          g.lineCap = "round";
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x - this.vx[i] * 0.03, y - this.vy[i] * 0.03);
          g.stroke();
          g.globalCompositeOperation = "source-over";
          break;
        }
        case "spark": {
          g.globalCompositeOperation = "lighter";
          g.globalAlpha = alpha * fade;
          g.strokeStyle = "#cfe6ff";
          g.lineWidth = r;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x - this.vx[i] * 0.02, y - this.vy[i] * 0.02);
          g.stroke();
          g.globalCompositeOperation = "source-over";
          break;
        }
        case "ash":
          g.globalAlpha = alpha * fade * 0.75;
          g.fillStyle = s % 2 > 1 ? "#a2a2aa" : "#6a6a72";
          g.beginPath();
          g.ellipse(x, y, r, r * 0.55, Math.sin(t + s) * 1.2, 0, Math.PI * 2);
          g.fill();
          break;
        case "snow":
          g.globalAlpha = alpha * fade * 0.9;
          g.fillStyle = "#ffffff";
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
          break;
        case "dust":
          g.globalAlpha = alpha * fade * 0.5;
          g.fillStyle = "#fff6d8";
          g.fillRect(x - r * 0.5, y - r * 0.5, r, r);
          break;
        case "firefly": {
          g.globalCompositeOperation = "lighter";
          const pulse = 0.4 + 0.6 * Math.max(0, Math.sin(t * 2.2 + s));
          g.globalAlpha = alpha * fade * pulse;
          g.fillStyle = "#e9ff9a";
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
          g.globalAlpha *= 0.3;
          g.beginPath();
          g.arc(x, y, r * 3.2, 0, Math.PI * 2);
          g.fill();
          g.globalCompositeOperation = "source-over";
          break;
        }
        case "paper":
        case "leaf":
        case "petal": {
          const rot = t * (2 + (s % 3)) + s;
          const sq = Math.cos(rot);
          g.globalAlpha = alpha * fade;
          g.fillStyle = kind === "paper" ? (s % 2 > 1 ? "#f4f1e6" : "#e8e2cf") : kind === "leaf" ? (s % 2 > 1 ? "#b8752b" : "#8a5a24") : s % 2 > 1 ? "#ffd1e6" : "#ffffff";
          g.save();
          g.translate(x, y);
          g.rotate(rot * 0.5);
          g.scale(1, Math.abs(sq) * 0.9 + 0.1);
          if (kind === "paper") g.fillRect(-r, -r * 0.7, r * 2, r * 1.4);
          else {
            g.beginPath();
            g.ellipse(0, 0, r, r * 0.5, 0, 0, Math.PI * 2);
            g.fill();
          }
          g.restore();
          break;
        }
        default:
          break;
      }
    }
    g.restore();
  }
}
