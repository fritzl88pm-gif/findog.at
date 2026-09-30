/**
 * Christkindlmarkt – Wetter & Partikel (Bildschirmraum, ohne Allokationen pro Frame):
 * Schneefall in drei Tiefenebenen, Windstreifen (Böen/Sturm), Eiskristall-Glitzer, Glut/Funken der Fackeln,
 * Eisspur unter den Füßen und Atemwölkchen.
 */
import { PLAYER_SX } from "../../constants";
import type { ViewState } from "../../types";
import type { Ctx2D } from "../shared-b/canvas";
import { mulberry } from "../shared-b/color";
import { glowAt, sat, TAU, type GlowSet } from "./gfx";

/** Schnee in drei Tiefen: fern (klein, langsam), mittel, nah (groß, weich, schnell) */
export class SnowField {
  static readonly FAR = 110;
  static readonly MID = 80;
  static readonly NEAR = 32;
  private readonly n = SnowField.FAR + SnowField.MID + SnowField.NEAR;
  private readonly x = new Float32Array(this.n);
  private readonly y = new Float32Array(this.n);
  private readonly vy = new Float32Array(this.n);
  private readonly sz = new Float32Array(this.n);
  private readonly ph = new Float32Array(this.n);
  private aFar = 0;
  private aMid = 0;
  private aNear = 0;
  private t = 0;

  constructor() {
    const r = mulberry(77);
    for (let i = 0; i < this.n; i += 1) {
      this.x[i] = r() * 1400 - 60;
      this.y[i] = r() * 800 - 40;
      this.ph[i] = r() * TAU;
      const d = this.depth(i);
      this.vy[i] = d === 0 ? 40 + r() * 34 : d === 1 ? 95 + r() * 60 : 190 + r() * 100;
      this.sz[i] = d === 0 ? 0.9 + r() * 0.7 : d === 1 ? 1.6 + r() * 1.1 : 3 + r() * 2.6;
    }
  }

  private depth(i: number): 0 | 1 | 2 {
    return i < SnowField.FAR ? 0 : i < SnowField.FAR + SnowField.MID ? 1 : 2;
  }

  /** density 0..1 (Stufe), wind px/s (negativ = gegen die Laufrichtung), gust 0..1 */
  update(dt: number, v: ViewState, density: number, wind: number, gust: number): void {
    const q = v.quality === 0 ? 0.35 : v.quality === 1 ? 0.7 : 1;
    this.aFar = Math.round(SnowField.FAR * sat(density * 1.05) * q);
    this.aMid = Math.round(SnowField.MID * sat(density) * q);
    this.aNear = Math.round(SnowField.NEAR * sat(density * 0.95) * q);
    this.t += dt;
    const w = wind * (1 + gust * 0.9);
    const sp = v.speed;
    const idx = [0, SnowField.FAR, SnowField.FAR + SnowField.MID];
    const cnt = [this.aFar, this.aMid, this.aNear];
    const par = [0.12, 0.45, 1.05];
    for (let d = 0; d < 3; d += 1) {
      const p = par[d];
      for (let k = 0; k < cnt[d]; k += 1) {
        const i = idx[d] + k;
        let x = this.x[i] + (w * (0.35 + p * 0.65) - sp * p * 0.9 + Math.sin(this.t * 1.3 + this.ph[i]) * 16 * (1 - p * 0.4)) * dt;
        let y = this.y[i] + this.vy[i] * (1 + gust * 0.25) * dt;
        if (y > 740) {
          y = -20 - (i % 7) * 6;
          x = ((i * 977 + Math.floor(this.t * 60) * 131) % 1400) - 40;
        }
        if (x < -70) x += 1420;
        else if (x > 1350) x -= 1420;
        this.x[i] = x;
        this.y[i] = y;
      }
    }
  }

  /** Ebene 0 = fern, 1 = mittel: als Sammelpfad (billig) */
  drawFine(g: Ctx2D, layer: 0 | 1, alpha: number): void {
    const start = layer === 0 ? 0 : SnowField.FAR;
    const cnt = layer === 0 ? this.aFar : this.aMid;
    if (cnt <= 0 || alpha <= 0.01) return;
    g.globalAlpha = alpha * (layer === 0 ? 0.6 : 0.82);
    g.fillStyle = "#f4f8ff";
    g.beginPath();
    for (let k = 0; k < cnt; k += 1) {
      const i = start + k;
      const r = this.sz[i];
      g.moveTo(this.x[i] + r, this.y[i]);
      g.arc(this.x[i], this.y[i], r, 0, TAU);
    }
    g.fill();
    g.globalAlpha = 1;
  }

  /** nahe, weiche Flocken (Sprites) */
  drawNear(g: Ctx2D, glows: GlowSet, alpha: number): void {
    if (this.aNear <= 0 || alpha <= 0.01) return;
    const start = SnowField.FAR + SnowField.MID;
    g.globalAlpha = alpha * 0.78;
    for (let k = 0; k < this.aNear; k += 1) {
      const i = start + k;
      const r = this.sz[i] * 1.9;
      g.drawImage(glows.flake, this.x[i] - r, this.y[i] - r, r * 2, r * 2);
    }
    g.globalAlpha = 1;
  }
}

/** Horizontale Windstreifen (Böen, Sturm) */
export class WindStreaks {
  private readonly x = new Float32Array(28);
  private readonly y = new Float32Array(28);
  private readonly l = new Float32Array(28);
  private readonly s = new Float32Array(28);
  private active = 0;

  constructor() {
    const r = mulberry(31);
    for (let i = 0; i < 28; i += 1) {
      this.x[i] = r() * 1500 - 100;
      this.y[i] = 60 + r() * 520;
      this.l[i] = 60 + r() * 150;
      this.s[i] = 0.7 + r() * 0.8;
    }
  }

  update(dt: number, v: ViewState, k: number): void {
    this.active = Math.round(28 * sat(k) * (v.quality === 0 ? 0.4 : v.quality === 1 ? 0.75 : 1));
    for (let i = 0; i < this.active; i += 1) {
      this.x[i] -= (900 + v.speed * 0.6) * this.s[i] * dt;
      if (this.x[i] < -260) {
        this.x[i] = 1300 + ((i * 331) % 300);
        this.y[i] = 60 + ((i * 197 + Math.floor(v.time * 13)) % 520);
      }
    }
  }

  draw(g: Ctx2D, alpha: number): void {
    if (this.active <= 0 || alpha <= 0.01) return;
    g.globalAlpha = alpha * 0.34;
    g.strokeStyle = "#f2f7ff";
    g.lineWidth = 1.4;
    g.lineCap = "round";
    g.beginPath();
    for (let i = 0; i < this.active; i += 1) {
      g.moveTo(this.x[i], this.y[i]);
      g.lineTo(this.x[i] + this.l[i], this.y[i] + 4);
    }
    g.stroke();
    g.globalAlpha = 1;
  }
}

/** Kleiner allgemeiner Partikelpool für Funken/Glut/Eisspur/Atem */
export class Bits {
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly life: Float32Array;
  readonly max: Float32Array;
  readonly size: Float32Array;
  count = 0;

  constructor(readonly cap: number) {
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap);
    this.size = new Float32Array(cap);
  }

  add(x: number, y: number, vx: number, vy: number, life: number, size: number): void {
    if (this.count >= this.cap) return;
    const i = this.count++;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.max[i] = life;
    this.size[i] = size;
  }

  /** scroll = Weltscroll px/s (Parallaxfaktor `par`), grav = Beschleunigung nach unten (negativ = steigt) */
  step(dt: number, scroll: number, par: number, grav: number, drag = 0): void {
    let w = 0;
    for (let i = 0; i < this.count; i += 1) {
      const life = this.life[i] - dt;
      if (life <= 0) continue;
      const vy = this.vy[i] + grav * dt;
      const k = drag > 0 ? Math.max(0, 1 - drag * dt) : 1;
      const vx = this.vx[i] * k;
      const y = this.y[i] + vy * dt;
      const x = this.x[i] + (vx - scroll * par) * dt;
      if (x < -80 || y < -80 || y > 800) continue;
      this.x[w] = x;
      this.y[w] = y;
      this.vx[w] = vx;
      this.vy[w] = vy;
      this.life[w] = life;
      this.max[w] = this.max[i];
      this.size[w] = this.size[i];
      w += 1;
    }
    this.count = w;
  }
}

/** Glut/Funkenflug: additive Glüh-Sprites */
export function drawEmbers(g: Ctx2D, glows: GlowSet, b: Bits, alpha: number): void {
  if (!b.count || alpha <= 0.01) return;
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < b.count; i += 1) {
    const u = b.life[i] / b.max[i];
    g.globalAlpha = alpha * Math.min(1, u * 3) * (0.55 + 0.45 * Math.sin(b.life[i] * 22 + i));
    glowAt(g, u > 0.5 ? glows.gold : glows.orange, b.x[i], b.y[i], b.size[i] * (0.6 + 0.6 * u) + 2);
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
}

/** Eisspur: kurze helle Streifen entgegen der Laufrichtung */
export function drawIceSpray(g: Ctx2D, b: Bits): void {
  if (!b.count) return;
  g.globalCompositeOperation = "lighter";
  g.lineCap = "round";
  for (let i = 0; i < b.count; i += 1) {
    const u = b.life[i] / b.max[i];
    g.globalAlpha = Math.min(1, u * 2) * 0.85;
    g.strokeStyle = u > 0.5 ? "#e6fbff" : "#7fdcff";
    g.lineWidth = b.size[i];
    g.beginPath();
    g.moveTo(b.x[i], b.y[i]);
    g.lineTo(b.x[i] - b.vx[i] * 0.03, b.y[i] - b.vy[i] * 0.03);
    g.stroke();
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
}

/** Atemwölkchen (weiche Puffs, wachsen und verwehen) */
export function drawBreath(g: Ctx2D, glows: GlowSet, b: Bits, alpha: number): void {
  if (!b.count || alpha <= 0.01) return;
  for (let i = 0; i < b.count; i += 1) {
    const u = 1 - b.life[i] / b.max[i];
    const r = b.size[i] * (0.5 + u * 1.9);
    g.globalAlpha = alpha * 0.5 * Math.sin(Math.min(1, u * 1.15) * Math.PI);
    g.drawImage(glows.puff, b.x[i] - r, b.y[i] - r, r * 2, r * 2);
  }
  g.globalAlpha = 1;
}

/** Eiskristall-Glitzer in der Luft (Stufe „Eistraum“) */
export class Glitter {
  private readonly x = new Float32Array(30);
  private readonly y = new Float32Array(30);
  private readonly ph = new Float32Array(30);
  private readonly sz = new Float32Array(30);
  private n = 0;

  constructor() {
    const r = mulberry(909);
    for (let i = 0; i < 30; i += 1) {
      this.x[i] = r() * 1400;
      this.y[i] = 60 + r() * 500;
      this.ph[i] = r() * TAU;
      this.sz[i] = 6 + r() * 9;
    }
  }

  update(dt: number, v: ViewState, k: number): void {
    this.n = Math.round(30 * sat(k) * (v.quality === 0 ? 0.3 : v.quality === 1 ? 0.65 : 1));
    for (let i = 0; i < this.n; i += 1) {
      this.x[i] -= v.speed * 0.5 * dt;
      if (this.x[i] < -30) {
        this.x[i] += 1400;
        this.y[i] = 60 + ((i * 131 + Math.floor(v.time * 7)) % 500);
      }
    }
  }

  draw(g: Ctx2D, glows: GlowSet, time: number, reduced: boolean, alpha: number): void {
    if (this.n <= 0 || alpha <= 0.01) return;
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < this.n; i += 1) {
      const tw = reduced ? 0.5 : Math.max(0, Math.sin(time * (1.6 + (i % 4) * 0.5) + this.ph[i]));
      if (tw < 0.05) continue;
      g.globalAlpha = alpha * tw * 0.9;
      glowAt(g, glows.cross, this.x[i], this.y[i], this.sz[i] * (0.6 + 0.5 * tw));
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
}

export const PLAYER_HEAD_X = PLAYER_SX + 18;

/** Aufsteigende Himmelslaternen (warmes Glühen im Sternenhimmel, hinter der Stadt) */
export class SkyLanterns {
  private static readonly N = 14;
  private readonly x = new Float32Array(SkyLanterns.N);
  private readonly y = new Float32Array(SkyLanterns.N);
  private readonly sp = new Float32Array(SkyLanterns.N);
  private readonly ph = new Float32Array(SkyLanterns.N);
  private readonly sz = new Float32Array(SkyLanterns.N);
  private n = 0;

  constructor() {
    const r = mulberry(1701);
    for (let i = 0; i < SkyLanterns.N; i += 1) {
      this.x[i] = r() * 1400;
      this.y[i] = 60 + r() * 560;
      this.sp[i] = 16 + r() * 22;
      this.ph[i] = r() * TAU;
      this.sz[i] = 0.7 + r() * 0.6;
    }
  }

  update(dt: number, v: ViewState, k: number): void {
    this.n = Math.round(SkyLanterns.N * sat(k) * (v.quality === 0 ? 0.3 : v.quality === 1 ? 0.7 : 1));
    for (let i = 0; i < this.n; i += 1) {
      this.y[i] -= this.sp[i] * dt;
      this.x[i] += (Math.sin(v.time * 0.6 + this.ph[i]) * 8 - v.speed * 0.09) * dt;
      if (this.y[i] < -40) {
        this.y[i] = 560 + ((i * 97) % 90);
        this.x[i] = 100 + ((i * 331 + Math.floor(v.time)) % 1200);
      }
      if (this.x[i] < -40) this.x[i] += 1400;
    }
  }

  draw(g: Ctx2D, glows: GlowSet, time: number, reduced: boolean, alpha: number, fire: number): void {
    if (this.n <= 0 || alpha <= 0.02) return;
    for (let i = 0; i < this.n; i += 1) {
      const x = this.x[i];
      const y = this.y[i];
      if (x < -40 || x > 1320) continue;
      const s = this.sz[i];
      const fl = reduced ? 1 : 0.85 + 0.15 * Math.sin(time * 5 + this.ph[i] * 3);
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = alpha * 0.55 * fl;
      glowAt(g, fire > 0.5 ? glows.red : glows.orange, x, y, 30 * s);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = alpha * 0.92;
      g.fillStyle = fire > 0.5 ? "#c8321e" : "#ffb04a";
      g.beginPath();
      g.moveTo(x - 6 * s, y - 8 * s);
      g.lineTo(x + 6 * s, y - 8 * s);
      g.lineTo(x + 8 * s, y + 8 * s);
      g.lineTo(x - 8 * s, y + 8 * s);
      g.closePath();
      g.fill();
      g.fillStyle = "#fff0c0";
      g.globalAlpha = alpha * 0.85 * fl;
      g.beginPath();
      g.ellipse(x, y + 2 * s, 3.4 * s, 5.5 * s, 0, 0, TAU);
      g.fill();
      g.globalAlpha = 1;
    }
  }
}

/** Fußspuren im Schnee: an Weltpositionen verankert, verblassen hinter der Figur */
export class Footprints {
  private readonly wx = new Float32Array(12);
  private n = 0;
  private last = -1e9;
  private flip = 0;

  update(worldX: number, grounded: boolean, onIce: boolean, quality: number): void {
    if (worldX < this.last - 300) {
      this.n = 0;
      this.last = -1e9;
    }
    if (!grounded || onIce || quality === 0) return;
    if (worldX - this.last >= 58) {
      this.last = worldX;
      if (this.n >= this.wx.length) {
        this.wx.copyWithin(0, 1);
        this.n -= 1;
      }
      this.wx[this.n++] = worldX;
      this.flip += 1;
    }
  }

  draw(g: Ctx2D, dist: number, gy: number, pits: ReadonlyArray<{ x0: number; x1: number }>): void {
    if (!this.n) return;
    const head = dist + PLAYER_SX;
    for (let i = 0; i < this.n; i += 1) {
      const sx = this.wx[i] - dist;
      const age = (head - this.wx[i]) / 760;
      if (age > 1 || sx < -30 || sx > 1300) continue;
      let inPit = false;
      for (const p of pits) if (sx > p.x0 - 8 && sx < p.x1 + 8) inPit = true;
      if (inPit) continue;
      const a = sat(1 - age) * 0.34;
      const y = gy + 20 + ((i + this.flip) % 2) * 9;
      g.globalAlpha = a;
      g.fillStyle = "#1a2450";
      g.beginPath();
      g.ellipse(Math.round(sx), y, 9, 3.2, 0, 0, TAU);
      g.ellipse(Math.round(sx) - 11, y + 0.5, 4.4, 2.6, 0, 0, TAU);
      g.fill();
      g.globalAlpha = a * 0.9;
      g.fillStyle = "#f4f8ff";
      g.beginPath();
      g.ellipse(Math.round(sx), y + 3.4, 9, 1.4, 0, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
  }
}
