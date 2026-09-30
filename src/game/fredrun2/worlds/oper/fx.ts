/**
 * Opernball – Ambient-Effekte im Bildschirmraum ohne Allokationen pro Frame: Konfetti, Champagner-Perlen, Lichtstaub in den
 * Lichtkegeln, Funkeln, Feuerwerk hinter den Fenstern, Konfetti-Kanonen. Alle Pools sind Typed Arrays.
 */
import { glowSprite, paint } from "../shared-b/canvas";
import { mulberry } from "../shared-b/color";
import { CONFETTI_COLORS } from "./stages";

const TAU = Math.PI * 2;
type G = CanvasRenderingContext2D;

// --- Sprites ---------------------------------------------------------------------------------------------------------

const starCache = new Map<string, HTMLCanvasElement>();

/** Vierzackiger Glanzstern (64 px) in Farbe `color` – Kerzen-/Kristallfunkeln. */
export function starSprite(color = "#fff3c8"): HTMLCanvasElement {
  let c = starCache.get(color);
  if (c) return c;
  c = paint(64, 64, (g) => {
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 22);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.18, color);
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = color;
    for (const [w, h, rot, a] of [
      [62, 3.4, 0, 0.95],
      [3.4, 62, 0, 0.95],
      [30, 2, Math.PI / 4, 0.55],
      [30, 2, -Math.PI / 4, 0.55],
    ] as const) {
      g.save();
      g.translate(32, 32);
      g.rotate(rot);
      g.globalAlpha = a;
      const lg = g.createLinearGradient(-w / 2, 0, w / 2, 0);
      lg.addColorStop(0, "rgba(255,255,255,0)");
      lg.addColorStop(0.5, "rgba(255,255,255,1)");
      lg.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = lg;
      g.fillRect(-w / 2, -h / 2, w, h);
      g.restore();
    }
  });
  starCache.set(color, c);
  return c;
}

/** Weicher Lichtkegel (Spitze oben, nach unten breiter), 1:1-Blit-Fläche. */
export function coneSprite(w: number, h: number, color: string): HTMLCanvasElement {
  return paint(w, h, (g) => {
    const topW = w * 0.14;
    // Kegelfläche
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, `${color}`);
    grd.addColorStop(0.55, `${color}`);
    grd.addColorStop(1, `${color}`);
    g.save();
    g.beginPath();
    g.moveTo(w / 2 - topW / 2, 0);
    g.lineTo(w / 2 + topW / 2, 0);
    g.lineTo(w, h);
    g.lineTo(0, h);
    g.closePath();
    g.clip();
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    // Ausblendung: nach unten und zu den Seiten
    g.globalCompositeOperation = "destination-in";
    const v = g.createLinearGradient(0, 0, 0, h);
    v.addColorStop(0, "rgba(0,0,0,0.9)");
    v.addColorStop(0.5, "rgba(0,0,0,0.5)");
    v.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = v;
    g.fillRect(0, 0, w, h);
    const hgrd = g.createLinearGradient(0, 0, w, 0);
    hgrd.addColorStop(0, "rgba(0,0,0,0)");
    hgrd.addColorStop(0.28, "rgba(0,0,0,0.85)");
    hgrd.addColorStop(0.5, "rgba(0,0,0,1)");
    hgrd.addColorStop(0.72, "rgba(0,0,0,0.85)");
    hgrd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = hgrd;
    g.fillRect(0, 0, w, h);
    g.restore();
  });
}

// --- Konfetti ----------------------------------------------------------------------------------------------------------

/** Fallende Konfettistücke + Kanonen-Salven. Vorne (über der Figur) zeichnen, klein und locker verteilt. */
export class Confetti {
  private readonly max: number;
  private x: Float32Array;
  private y: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private rot: Float32Array;
  private vrot: Float32Array;
  private col: Uint8Array;
  private size: Float32Array;
  private life: Float32Array;
  private rng = mulberry(77);
  n = 0;

  constructor(max = 110) {
    this.max = max;
    this.x = new Float32Array(max);
    this.y = new Float32Array(max);
    this.vx = new Float32Array(max);
    this.vy = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.vrot = new Float32Array(max);
    this.col = new Uint8Array(max);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
  }

  private spawn(x: number, y: number, vx: number, vy: number, life: number, palette: number): void {
    if (this.n >= this.max) return;
    const i = this.n++;
    const r = this.rng;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.rot[i] = r() * TAU;
    this.vrot[i] = (r() - 0.5) * 14;
    this.col[i] = palette === 0 ? Math.floor(r() * 5) : Math.floor(r() * CONFETTI_COLORS.length);
    this.size[i] = 3.4 + r() * 3.6;
    this.life[i] = life;
  }

  /** Dauerhaftes Herabrieseln: `rate` Stück/s. */
  rain(dt: number, rate: number, palette: number, scroll: number): void {
    const r = this.rng;
    let acc = rate * dt;
    while (acc > 0) {
      if (acc < 1 && r() > acc) break;
      acc -= 1;
      this.spawn(-20 + r() * 1340, -14, (r() - 0.5) * 60 - scroll * 0.12, 60 + r() * 70, 11, palette);
    }
  }

  /** Kanonensalve von (x, y) nach oben/außen. */
  burst(x: number, y: number, dir: number, n: number, palette: number): void {
    const r = this.rng;
    for (let i = 0; i < n; i += 1) {
      const a = -Math.PI / 2 + dir * (0.25 + r() * 0.9) + (r() - 0.5) * 0.4;
      const sp = 300 + r() * 620;
      this.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 3.4 + r() * 1.6, palette);
    }
  }

  update(dt: number, scroll: number): void {
    let w = 0;
    for (let i = 0; i < this.n; i += 1) {
      const life = this.life[i] - dt;
      const y = this.y[i] + this.vy[i] * dt;
      if (life <= 0 || y > 760) continue;
      // Luftwiderstand, Segeln
      const t = this.life[i] * 5 + i;
      this.vx[i] += (Math.sin(t) * 40 - this.vx[i]) * Math.min(1, dt * 1.3) - scroll * 0.06 * dt;
      this.vy[i] += (95 - this.vy[i]) * Math.min(1, dt * 1.6);
      this.x[w] = this.x[i] + this.vx[i] * dt;
      this.y[w] = y;
      this.vx[w] = this.vx[i];
      this.vy[w] = this.vy[i];
      this.rot[w] = this.rot[i] + this.vrot[i] * dt;
      this.vrot[w] = this.vrot[i];
      this.col[w] = this.col[i];
      this.size[w] = this.size[i];
      this.life[w] = life;
      w += 1;
    }
    this.n = w;
  }

  draw(g: G, alpha: number): void {
    if (!this.n) return;
    const prev = g.globalAlpha;
    for (let i = 0; i < this.n; i += 1) {
      const x = this.x[i];
      if (x < -12 || x > 1292) continue;
      const cs = Math.cos(this.rot[i]);
      const w = this.size[i] * Math.abs(cs) + 0.8;
      g.globalAlpha = alpha * Math.min(1, this.life[i] * 2);
      g.fillStyle = CONFETTI_COLORS[this.col[i]];
      g.fillRect(x - w / 2, this.y[i], w, this.size[i] * 0.55);
    }
    g.globalAlpha = prev;
  }
}

// --- Champagner-Perlen ---------------------------------------------------------------------------------------------------

/** Aufsteigende Perlen (klein, halbtransparent) – ein Pool für den ganzen Saal. */
export class Bubbles {
  private x: Float32Array;
  private y: Float32Array;
  private vy: Float32Array;
  private r: Float32Array;
  private ph: Float32Array;
  private readonly max: number;
  private rng = mulberry(31);
  n = 0;

  constructor(max = 64) {
    this.max = max;
    this.x = new Float32Array(max);
    this.y = new Float32Array(max);
    this.vy = new Float32Array(max);
    this.r = new Float32Array(max);
    this.ph = new Float32Array(max);
  }

  add(x: number, y: number, r: number, vy: number): void {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.x[i] = x;
    this.y[i] = y;
    this.vy[i] = vy;
    this.r[i] = r;
    this.ph[i] = this.rng() * TAU;
  }

  /** Steigt aus dem Parkett: `rate` Stück/s, Höhe bis `top`. */
  update(dt: number, rate: number, groundY: number, scroll: number, t: number): void {
    const rr = this.rng;
    let acc = rate * dt;
    while (acc > 0) {
      if (acc < 1 && rr() > acc) break;
      acc -= 1;
      this.add(rr() * 1300, groundY + 14 + rr() * 90, 1.4 + rr() * 2.6, 34 + rr() * 60);
    }
    let w = 0;
    for (let i = 0; i < this.n; i += 1) {
      const y = this.y[i] - this.vy[i] * dt;
      if (y < 120) continue;
      this.x[w] = this.x[i] - scroll * 0.55 * dt + Math.sin(t * 2.2 + this.ph[i]) * 14 * dt;
      this.y[w] = y;
      this.vy[w] = this.vy[i] * (1 + dt * 0.25);
      this.r[w] = this.r[i];
      this.ph[w] = this.ph[i];
      if (this.x[w] < -10) continue;
      w += 1;
    }
    this.n = w;
  }

  draw(g: G, alpha: number, groundY: number): void {
    if (!this.n) return;
    const prev = g.globalAlpha;
    g.strokeStyle = "rgba(255,244,205,1)";
    g.fillStyle = "rgba(255,236,170,0.5)";
    g.lineWidth = 1;
    for (let i = 0; i < this.n; i += 1) {
      const u = Math.min(1, (groundY + 110 - this.y[i]) / 60) * Math.min(1, (this.y[i] - 120) / 140);
      g.globalAlpha = alpha * 0.7 * u;
      g.beginPath();
      g.arc(this.x[i], this.y[i], this.r[i], 0, TAU);
      g.fill();
      g.stroke();
    }
    g.globalAlpha = prev;
  }
}

// --- Feuerwerk in den Fenstern -----------------------------------------------------------------------------------------------

interface Burst {
  pane: number;
  x: number;
  y: number;
  t: number;
  life: number;
  ci: number;
  n: number;
  sp: number;
  seed: number;
  ring: boolean;
}

const FW_COLORS = ["#ffd24a", "#ff4fa3", "#5ef2ff", "#b98cff", "#ff8a5c", "#fff6e0", "#9dff6a"];

/** Feuerwerks-Salven in Fensterscheiben der Fernebene (Koordinaten der Kachel). */
export class WindowFireworks {
  private bursts: Burst[] = [];
  private timer = 0.4;
  private rng = mulberry(909);
  private sprites: HTMLCanvasElement[] = FW_COLORS.map((c) => glowSprite(c, 0.25));

  update(dt: number, amount: number, panes: Array<[number, number, number, number]>, quality: 0 | 1 | 2): void {
    this.timer -= dt * amount;
    if (amount > 0.02 && this.timer <= 0 && this.bursts.length < (quality === 2 ? 7 : 4)) {
      const r = this.rng;
      const pane = Math.floor(r() * panes.length);
      const p = panes[pane];
      this.timer = 0.35 + r() * 0.6;
      const w = p[1] - p[0];
      this.bursts.push({
        pane,
        x: p[0] + w * (0.28 + r() * 0.44),
        y: p[2] + (p[3] - p[2]) * (0.22 + r() * 0.3),
        t: 0,
        life: 1.1 + r() * 0.5,
        ci: Math.floor(r() * FW_COLORS.length),
        n: quality === 2 ? 26 : 16,
        sp: Math.min(70, w * 0.5) * (0.8 + r() * 0.35),
        seed: r() * 100,
        ring: r() < 0.3,
      });
    }
    for (let i = this.bursts.length - 1; i >= 0; i -= 1) {
      const b = this.bursts[i];
      b.t += dt;
      if (b.t >= b.life) this.bursts.splice(i, 1);
    }
  }

  /** Zeichnet alle Salven an Kachelversatz `ox` (Bildschirm-x der Kachel), auf die Fensterscheiben beschnitten. */
  draw(g: G, ox: number, oy: number, panes: Array<[number, number, number, number]>, alpha: number): void {
    if (!this.bursts.length || alpha < 0.02) return;
    g.save();
    g.globalCompositeOperation = "lighter";
    for (const b of this.bursts) {
      const p = panes[b.pane];
      const x0 = ox + p[0];
      if (x0 > 1280 || x0 + (p[1] - p[0]) < 0) continue;
      g.save();
      g.beginPath();
      g.rect(x0, oy + p[2], p[1] - p[0], p[3] - p[2]);
      g.clip();
      const k = b.t / b.life;
      const fade = (1 - k) * (1 - k);
      const drag = (1 - Math.exp(-2.6 * b.t)) / 2.6;
      const spr = this.sprites[b.ci];
      const cx = ox + b.x;
      const cy = oy + b.y;
      const tb = Math.max(0, b.t - 0.07);
      const d2 = (1 - Math.exp(-2.6 * tb)) / 2.6;
      for (let i = 0; i < b.n; i += 1) {
        const a = (i / b.n) * TAU + b.seed;
        const sp = b.sp * (b.ring ? 1 : 0.6 + 0.4 * Math.abs(Math.sin(i * 12.9898 + b.seed)));
        const tw = 0.75 + 0.25 * Math.sin(b.t * 28 + i);
        const ca = Math.cos(a) * sp * 3.2;
        const sa = Math.sin(a) * sp * 3.2;
        g.globalAlpha = alpha * fade * tw;
        const r = 3.6 + 2.6 * (1 - k);
        g.drawImage(spr, cx + ca * drag - r, cy + sa * drag + 26 * b.t * b.t - r, r * 2, r * 2);
        // Funkenschweif
        g.globalAlpha = alpha * fade * 0.4;
        const r2 = r * 0.7;
        g.drawImage(spr, cx + ca * d2 - r2, cy + sa * d2 + 26 * tb * tb - r2, r2 * 2, r2 * 2);
      }
      if (b.t < 0.3) {
        g.globalAlpha = alpha * (1 - b.t / 0.3) * 0.95;
        g.drawImage(spr, cx - 60, cy - 60, 120, 120);
      }
      g.restore();
    }
    g.restore();
  }

  get active(): boolean {
    return this.bursts.length > 0;
  }
}

// --- Effekt-Partikel (weltfest, Bildschirmkoordinaten) ---------------------------------------------------------------------------

export type PopKind = "foam" | "gold" | "note" | "star" | "drop" | "petal";

/** Kleine Effektpartikel für Skins (Schaum, Noten, Funken, Tropfen). Bewegen sich mit der Welt (scroll). */
export class Pops {
  private readonly max: number;
  private x: Float32Array;
  private y: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;
  private kind: Uint8Array;
  private rot: Float32Array;
  private grav: Float32Array;
  n = 0;
  private sprites: Record<PopKind, HTMLCanvasElement[]>;

  constructor(max = 140) {
    this.max = max;
    this.x = new Float32Array(max);
    this.y = new Float32Array(max);
    this.vx = new Float32Array(max);
    this.vy = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.kind = new Uint8Array(max);
    this.rot = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.sprites = {
      foam: [foamSprite()],
      gold: [glowSprite("#ffc94a", 0.22)],
      note: [noteSprite(false), noteSprite(true)],
      star: [starSprite("#fff3c8")],
      drop: [dropSprite()],
      petal: [petalSprite("#d81f3c"), petalSprite("#ffffff"), petalSprite("#ff8fb0")],
    };
  }

  static readonly KINDS: PopKind[] = ["foam", "gold", "note", "star", "drop", "petal"];

  emit(kind: PopKind, x: number, y: number, vx: number, vy: number, life: number, size: number, grav = 0): void {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.kind[i] = Pops.KINDS.indexOf(kind);
    this.rot[i] = (((x * 0.37 + y * 0.11) % 1) + 1) % 1;
    this.grav[i] = grav;
  }

  update(dt: number, scroll: number): void {
    let w = 0;
    for (let i = 0; i < this.n; i += 1) {
      const life = this.life[i] - dt;
      if (life <= 0) continue;
      this.vy[i] += this.grav[i] * dt;
      this.x[w] = this.x[i] + (this.vx[i] - scroll) * dt;
      this.y[w] = this.y[i] + this.vy[i] * dt;
      this.vx[w] = this.vx[i] * (1 - Math.min(1, dt * 0.8));
      this.vy[w] = this.vy[i];
      this.life[w] = life;
      this.maxLife[w] = this.maxLife[i];
      this.size[w] = this.size[i];
      this.kind[w] = this.kind[i];
      this.rot[w] = this.rot[i];
      this.grav[w] = this.grav[i];
      w += 1;
    }
    this.n = w;
  }

  draw(g: G): void {
    if (!this.n) return;
    const prevOp = g.globalCompositeOperation;
    const prevA = g.globalAlpha;
    for (let i = 0; i < this.n; i += 1) {
      const kind = Pops.KINDS[this.kind[i]];
      const u = this.life[i] / this.maxLife[i];
      const s = this.size[i];
      const list = this.sprites[kind];
      const spr = list[Math.min(list.length - 1, Math.floor(this.rot[i] * list.length))];
      const additive = kind === "gold" || kind === "star";
      g.globalCompositeOperation = additive ? "lighter" : "source-over";
      g.globalAlpha = Math.min(1, u * 2.2) * (kind === "foam" ? 0.92 : 1);
      if (kind === "petal") {
        const spin = (1 - u) * 9 + this.rot[i] * 6;
        g.save();
        g.translate(this.x[i], this.y[i]);
        g.rotate(spin);
        g.scale(1, 0.35 + 0.65 * Math.abs(Math.cos(spin * 1.3)));
        g.drawImage(spr, -s, -s * 0.6, s * 2, s * 1.2);
        g.restore();
      } else if (kind === "note") {
        const sway = Math.sin((1 - u) * 7 + this.rot[i] * 6) * 0.25;
        g.save();
        g.translate(this.x[i], this.y[i]);
        g.rotate(sway);
        g.drawImage(spr, -s * 0.5, -s * 0.75, s, s * 1.5);
        g.restore();
      } else {
        const ss = kind === "foam" ? s * (0.6 + 0.6 * (1 - u)) : s;
        g.drawImage(spr, this.x[i] - ss, this.y[i] - ss, ss * 2, ss * 2);
      }
    }
    g.globalCompositeOperation = prevOp;
    g.globalAlpha = prevA;
  }
}

function petalSprite(color: string): HTMLCanvasElement {
  return paint(32, 20, (g) => {
    g.fillStyle = color;
    g.strokeStyle = "rgba(60,10,20,0.55)";
    g.lineWidth = 1.6;
    g.beginPath();
    g.ellipse(16, 10, 13, 7, 0, 0, TAU);
    g.fill();
    g.stroke();
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.beginPath();
    g.ellipse(12, 8, 6, 2.6, -0.3, 0, TAU);
    g.fill();
  });
}

function foamSprite(): HTMLCanvasElement {
  return paint(48, 48, (g) => {
    const grd = g.createRadialGradient(20, 18, 2, 24, 24, 22);
    grd.addColorStop(0, "#ffffff");
    grd.addColorStop(0.7, "#fff4d6");
    grd.addColorStop(1, "rgba(255,226,150,0)");
    g.fillStyle = grd;
    g.beginPath();
    g.arc(24, 24, 22, 0, TAU);
    g.fill();
    g.strokeStyle = "rgba(190,140,40,0.55)";
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(24, 24, 18, 0, TAU);
    g.stroke();
  });
}

function dropSprite(): HTMLCanvasElement {
  return paint(32, 32, (g) => {
    const grd = g.createRadialGradient(13, 12, 1, 16, 16, 13);
    grd.addColorStop(0, "#fffbe0");
    grd.addColorStop(0.5, "#ffd65a");
    grd.addColorStop(1, "rgba(230,150,20,0)");
    g.fillStyle = grd;
    g.beginPath();
    g.arc(16, 16, 13, 0, TAU);
    g.fill();
  });
}

/** Goldene Viertelnote (♪ oder ♫) mit dunklem Rand. */
export function noteSprite(double: boolean): HTMLCanvasElement {
  return paint(40, 60, (g) => {
    const draw = (): void => {
      g.beginPath();
      g.ellipse(12, 46, 8.5, 6.4, -0.4, 0, TAU);
      g.moveTo(19, 44);
      g.lineTo(19, 10);
      if (double) {
        g.lineTo(34, 6);
        g.lineTo(34, 40);
        g.moveTo(34, 40);
        g.ellipse(27, 42, 8, 6, -0.4, 0, TAU);
      } else {
        g.bezierCurveTo(19, 22, 32, 24, 30, 36);
        g.bezierCurveTo(28, 28, 22, 26, 19, 24);
      }
    };
    g.lineJoin = "round";
    g.lineCap = "round";
    g.strokeStyle = "#5a2a00";
    g.lineWidth = 6.5;
    draw();
    g.stroke();
    const grd = g.createLinearGradient(0, 8, 0, 54);
    grd.addColorStop(0, "#fff3a6");
    grd.addColorStop(1, "#f2b31c");
    g.fillStyle = grd;
    g.strokeStyle = grd;
    g.lineWidth = 3.4;
    draw();
    g.fill();
    g.stroke();
  });
}
