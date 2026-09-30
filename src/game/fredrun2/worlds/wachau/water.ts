/**
 * Wachau – Donau-Lücken: Wasserquerschnitt mit Wellenkante, Himmelsreflex, Unterwasser-Lichtstreifen, Schaum an den
 * Ufermauern, treibendem Laub, Glitzern (Sonne/Mond) und Spritzern (Floß sinkt, Fass fällt ins Wasser, Sturz).
 */
import type { ViewState } from "../../types";
import { blitTiledRange, glowAt, paint, type Ctx2D } from "../shared-b/canvas";
import { h1, mulberry } from "../shared-b/color";
import { withA } from "./palette";

const TAU = Math.PI * 2;
const MAXP = 160;

export interface WaterLook {
  water: string;
  waterDeep: string;
  sky: string;
  /** 0..1 Glitzern (Sonne) */
  glint: number;
  /** 0..1 Mondglitzern */
  moon: number;
  night: number;
  waterY: number;
}

export class WaterFx {
  private caustic: HTMLCanvasElement;
  private surf: HTMLCanvasElement;
  // Tropfen: Weltposition x, y, vx, vy, life
  private px = new Float32Array(MAXP);
  private py = new Float32Array(MAXP);
  private pvx = new Float32Array(MAXP);
  private pvy = new Float32Array(MAXP);
  private pl = new Float32Array(MAXP);
  private pn = 0;
  // Ringe: Weltposition x, y, Alter, Größe
  private rings: Array<{ x: number; y: number; t: number; s: number }> = [];
  private grdCache: { key: string; grd: CanvasGradient | null } = { key: "", grd: null };

  constructor(private readonly glow: HTMLCanvasElement) {
    this.caustic = paint(512, 110, (g) => {
      const r = mulberry(333);
      for (let i = 0; i < 40; i += 1) {
        const x = r() * 512;
        const w = 6 + r() * 18;
        const a = 0.05 + r() * 0.08;
        for (const ox of [x, x - 512, x + 512]) {
          const grd = g.createLinearGradient(0, 0, 0, 110);
          grd.addColorStop(0, `rgba(255,255,255,${a.toFixed(3)})`);
          grd.addColorStop(1, "rgba(255,255,255,0)");
          g.fillStyle = grd;
          g.beginPath();
          g.moveTo(ox, 0);
          g.lineTo(ox + w, 0);
          g.lineTo(ox + w * 0.4 + 30, 110);
          g.lineTo(ox - w * 0.6 + 30, 110);
          g.closePath();
          g.fill();
        }
      }
      for (let i = 0; i < 30; i += 1) {
        const x = r() * 512;
        const y = 10 + r() * 90;
        g.fillStyle = "rgba(255,255,255,0.18)";
        g.beginPath();
        g.arc(x, y, 1 + r() * 1.5, 0, TAU);
        g.fill();
      }
    });
    this.surf = paint(512, 24, (g) => {
      const r = mulberry(444);
      for (let i = 0; i < 70; i += 1) {
        const x = r() * 512;
        const y = 2 + Math.pow(r(), 1.5) * 20;
        const len = 6 + r() * 20;
        for (const ox of [x, x - 512]) {
          g.fillStyle = `rgba(255,255,255,${(0.25 + r() * 0.35).toFixed(3)})`;
          g.fillRect(ox, y, len, 1.4);
        }
      }
    });
  }

  splash(worldX: number, y: number, strength: number, reduced: boolean): void {
    this.rings.push({ x: worldX, y, t: 0, s: strength });
    if (this.rings.length > 12) this.rings.shift();
    if (reduced) return;
    const n = Math.round(6 + strength * 14);
    for (let i = 0; i < n && this.pn < MAXP; i += 1) {
      const k = this.pn++;
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.8;
      const sp = (160 + Math.random() * 260) * (0.6 + strength * 0.6);
      this.px[k] = worldX + (Math.random() - 0.5) * 30 * strength;
      this.py[k] = y;
      this.pvx[k] = Math.cos(a) * sp;
      this.pvy[k] = Math.sin(a) * sp;
      this.pl[k] = 0.5 + Math.random() * 0.4;
    }
  }

  update(dt: number): void {
    let w = 0;
    for (let i = 0; i < this.pn; i += 1) {
      const l = this.pl[i] - dt;
      if (l <= 0) continue;
      this.pvy[i] += 1500 * dt;
      this.px[w] = this.px[i] + this.pvx[i] * dt;
      this.py[w] = this.py[i] + this.pvy[i] * dt;
      this.pvx[w] = this.pvx[i];
      this.pvy[w] = this.pvy[i];
      this.pl[w] = l;
      w += 1;
    }
    this.pn = w;
    for (const r of this.rings) r.t += dt;
    while (this.rings.length && this.rings[0].t > 1.4) this.rings.shift();
  }

  /** Wasser in allen Lücken zeichnen (vor den Bodensegmenten). */
  drawPits(g: Ctx2D, v: ViewState, pits: ReadonlyArray<{ x0: number; x1: number; skin: string }>, L: WaterLook): void {
    if (!pits.length) return;
    const gy = v.groundY;
    const wy = L.waterY;
    const t = v.reducedMotion ? 0 : v.time;
    const key = `${L.water}|${L.waterDeep}|${L.sky}`;
    if (this.grdCache.key !== key) {
      const grd = g.createLinearGradient(0, wy, 0, v.h);
      grd.addColorStop(0, mixCss(L.water, L.sky));
      grd.addColorStop(0.12, L.water);
      grd.addColorStop(1, L.waterDeep);
      this.grdCache = { key, grd };
    }
    for (const p of pits) {
      const x0 = Math.round(Math.max(-20, p.x0));
      const x1 = Math.round(Math.min(v.w + 20, p.x1));
      if (x1 <= x0) continue;
      // Hinteres Ufer (Böschung der Einbuchtung)
      const bank = g.createLinearGradient(0, gy - 4, 0, wy + 2);
      bank.addColorStop(0, "#5a4c38");
      bank.addColorStop(1, "#2a2420");
      g.fillStyle = bank;
      g.fillRect(x0, gy - 4, x1 - x0, wy - gy + 6);
      if (L.night > 0.05) {
        g.fillStyle = `rgba(10,14,34,${(0.55 * L.night).toFixed(3)})`;
        g.fillRect(x0, gy - 4, x1 - x0, wy - gy + 6);
      }
      // Schilf am hinteren Ufer
      g.strokeStyle = L.night > 0.5 ? "#1c2230" : "#4a4a2a";
      g.lineWidth = 1.5;
      g.beginPath();
      const step = 7;
      const wx0 = Math.ceil((x0 + v.dist) / step) * step;
      for (let wx = wx0; wx < x1 + v.dist; wx += step) {
        const hh = h1(wx * 0.37);
        if (hh < 0.35) continue;
        const sx = wx - v.dist;
        const len = 6 + hh * 16;
        const sway = Math.sin(t * 1.6 + wx * 0.05) * 2;
        g.moveTo(sx, wy);
        g.lineTo(sx + sway, wy - len);
      }
      g.stroke();
      // Wasserkörper mit Wellenkante
      g.fillStyle = this.grdCache.grd ?? L.water;
      g.beginPath();
      g.moveTo(x0, v.h);
      for (let x = x0; x <= x1; x += 12) {
        const wx = x + v.dist;
        g.lineTo(x, wy + Math.sin(wx * 0.045 + t * 2.6) * 2.4 + Math.sin(wx * 0.11 - t * 1.9) * 1.1);
      }
      g.lineTo(x1, wy + Math.sin((x1 + v.dist) * 0.045 + t * 2.6) * 2.4);
      g.lineTo(x1, v.h);
      g.closePath();
      g.fill();
      // Lichtstreifen unter Wasser + Oberflächenglanz (additiv)
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.55 * (1 - L.night * 0.6);
      blitTiledRange(g, this.caustic, 512, 110, v.dist + t * 18, x0, x1, wy + 10);
      g.globalAlpha = 0.5 + 0.3 * L.glint;
      blitTiledRange(g, this.surf, 512, 24, v.dist * 1.0 - t * 30, x0, x1, wy + 2);
      // Glitzern
      const gl = Math.max(L.glint, L.moon);
      if (gl > 0.05 && v.quality > 0) {
        const st = 46;
        const s0 = Math.ceil((x0 + v.dist) / st) * st;
        for (let wx = s0; wx < x1 + v.dist; wx += st) {
          const tw = Math.max(0, Math.sin(t * (3 + h1(wx) * 3) + wx));
          if (tw < 0.4) continue;
          g.globalAlpha = gl * (tw - 0.4) * 1.4;
          glowAt(g, this.glow, wx - v.dist + h1(wx + 1) * 20, wy + 6 + h1(wx + 2) * 18, 5 + tw * 5);
        }
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
      // Treibendes Laub
      const ls = 170;
      const l0 = Math.floor((x0 + v.dist - 40) / ls) * ls;
      for (let wx = l0; wx < x1 + v.dist + 40; wx += ls) {
        const drift = (t * 14 + h1(wx) * 90) % ls;
        const lx = wx + drift - v.dist;
        if (lx < x0 + 6 || lx > x1 - 6) continue;
        const ly = wy + 2 + Math.sin(t * 2 + wx) * 1.5;
        g.fillStyle = h1(wx + 3) < 0.5 ? "#d8942e" : "#b8502a";
        g.beginPath();
        g.ellipse(lx, ly, 5, 2, Math.sin(t + wx) * 0.4, 0, TAU);
        g.fill();
      }
      // Schaum an den Ufermauern
      g.fillStyle = "rgba(240,250,255,0.75)";
      for (const [ex, dir] of [
        [p.x0, 1],
        [p.x1, -1],
      ] as const) {
        if (ex < -30 || ex > v.w + 30) continue;
        for (let i = 0; i < 5; i += 1) {
          const ph = (t * 1.5 + i * 0.2) % 1;
          g.globalAlpha = 0.7 * (1 - ph);
          g.beginPath();
          g.ellipse(ex + dir * (3 + ph * 18 + i * 3), wy + 1 + Math.sin(t * 4 + i) * 1.2, 5 - ph * 2, 2, 0, 0, TAU);
          g.fill();
        }
        g.globalAlpha = 1;
      }
      // Tiefenschatten an den Wänden
      g.fillStyle = "rgba(0,0,20,0.28)";
      g.fillRect(Math.round(p.x0), wy, 12, v.h - wy);
      g.fillRect(Math.round(p.x1) - 12, wy, 12, v.h - wy);
    }
  }

  /** Spritzer & Ringe (Vordergrund) */
  drawSplashes(g: Ctx2D, v: ViewState, waterY: number): void {
    if (!this.pn && !this.rings.length) return;
    g.strokeStyle = "rgba(235,248,255,0.8)";
    for (const r of this.rings) {
      const u = r.t / 1.4;
      const sx = r.x - v.dist;
      g.globalAlpha = (1 - u) * 0.8;
      g.lineWidth = 2 - u;
      g.beginPath();
      g.ellipse(sx, waterY + 3, 10 + u * 70 * r.s, 2 + u * 7 * r.s, 0, 0, TAU);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.fillStyle = "rgba(235,248,255,0.9)";
    for (let i = 0; i < this.pn; i += 1) {
      const sx = this.px[i] - v.dist;
      if (this.py[i] > waterY + 6) continue;
      g.globalAlpha = Math.min(1, this.pl[i] * 2);
      g.beginPath();
      g.arc(sx, this.py[i], 2.2, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
  }
}

function mixCss(a: string, b: string): string {
  // a, b sind "rgb(r,g,b)"-Strings aus der StagePalette
  const pa = a.match(/\d+(\.\d+)?/g);
  const pb = b.match(/\d+(\.\d+)?/g);
  if (!pa || !pb) return a;
  const r = Math.round((+pa[0] * 0.6 + +pb[0] * 0.4));
  const gg = Math.round((+pa[1] * 0.6 + +pb[1] * 0.4));
  const bl = Math.round((+pa[2] * 0.6 + +pb[2] * 0.4));
  return `rgb(${r},${gg},${bl})`;
}

export { withA };
