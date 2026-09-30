/**
 * Opernball – Entitäts-Skins. Die Props sind Einzelbilder; alle Bewegung entsteht prozedural:
 * Walzer-Wiegen der Tanzpaare, Tablett-Wippen des Kellners, Pendeln + Funkeln der Kronleuchter, Schütteln und Schäumen der
 * Champagnerflasche, Korken mit Schaumspur, Flügel-Sprungbrett mit Notenschauer, Balkone mit Balustrade, Scheinwerfer-Kegel.
 * Gefahren tragen einen hellen Rim-Light-Rand (in der Sprite-Bank eingebacken) und werfen weiche Schatten/Spiegelungen auf das Parkett.
 */
import { clamp } from "../../draw-utils";
import type { Ent, PropLibrary, ViewState } from "../../types";
import { glowSprite, paint, rr, softSprite, type Ctx2D } from "../shared-b/canvas";
import { h1 } from "../shared-b/color";
import { DIM, SKIN } from "./dims";
import { Pops, starSprite } from "./fx";
import { SpriteBank, drawBaked, type Baked } from "./sprites";
import { BEAT } from "./stages";

const TAU = Math.PI * 2;
const SKIN_NAMES = new Set<string>(Object.values(SKIN));
const RIM = 2.6;
const RIM_ENEMY = 2.4;

export const OPER_PROPS = [
  "oper-piano",
  "oper-champagne",
  "oper-cakecart",
  "oper-harp",
  "oper-bouquet",
  "oper-rope",
  "oper-chandelier",
  "oper-spotlight",
  "oper-cork",
  "oper-waiter",
  "oper-dancers",
  "oper-note",
  "oper-mask",
  "oper-bottle",
  "oper-drape",
];

/** Zustand pro Frame, vom Renderer gesetzt */
export interface SkinFrame {
  time: number;
  /** Dauer des Frames (Sek.) für ratenbasierte Partikel */
  dt: number;
  dist: number;
  quality: 0 | 1 | 2;
  reduced: boolean;
  groundY: number;
  /** Stufe als Fließkommazahl (stage + blend) */
  stage: number;
  /** Lichtfarbe der Stufe (CSS) */
  glow: string;
}

export class OperSkins {
  readonly bank = new SpriteBank();
  readonly pops = new Pops();
  private props: PropLibrary | null = null;
  private glowGold = glowSprite("#ffc94a", 0.2);
  private glowWhite = glowSprite("#fff6e0", 0.2);
  private glowWarm = softSprite("rgba(255,190,110,1)");
  private star = starSprite("#fff3c8");
  private shadowSpr = paint(96, 24, (g) => {
    const grd = g.createRadialGradient(48, 12, 0, 48, 12, 48);
    grd.addColorStop(0, "rgba(0,0,0,0.75)");
    grd.addColorStop(0.55, "rgba(0,0,0,0.3)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.save();
    g.scale(1, 0.25);
    g.translate(0, 36);
    g.fillStyle = grd;
    g.fillRect(0, -48, 96, 96);
    g.restore();
  });
  private balconies = new Map<number, HTMLCanvasElement>();
  private drapeChain: HTMLCanvasElement | null = null;
  private links: HTMLCanvasElement[] = [
    paint(20, 12, (g) => {
      g.strokeStyle = "#4a2604";
      g.lineWidth = 4.6;
      g.beginPath();
      g.ellipse(10, 6, 6.6, 3.4, 0, 0, TAU);
      g.stroke();
      g.strokeStyle = "#ffd75e";
      g.lineWidth = 2.2;
      g.beginPath();
      g.ellipse(10, 6, 6.6, 3.4, 0, 0, TAU);
      g.stroke();
    }),
    paint(20, 12, (g) => {
      g.fillStyle = "#4a2604";
      g.fillRect(4, 2.6, 12, 6.8);
      g.fillStyle = "#ffcf4a";
      g.fillRect(5, 3.8, 10, 4.4);
    }),
  ];
  f: SkinFrame = { time: 0, dt: 0.016, dist: 0, quality: 2, reduced: false, groundY: 590, stage: 0, glow: "#ffd98a" };

  setProps(p: PropLibrary): void {
    this.props = p;
    this.bank.setProps(p);
  }

  private has(id: string): boolean {
    return !!this.props?.has(id);
  }

  // --- Hilfen ---------------------------------------------------------------------------------------------------------

  private shadow(g: Ctx2D, cx: number, w: number, a = 1): void {
    const gy = this.f.groundY;
    g.globalAlpha = a;
    g.drawImage(this.shadowSpr, cx - w * 0.62, gy - 5, w * 1.24, 16);
    g.globalAlpha = 1;
  }

  private reflect(g: Ctx2D, b: Baked, key: string, cx: number, alpha = 0.26, squash = 0.5): void {
    if (this.f.quality < 2) return;
    const r = this.bank.reflection(b, key, squash, alpha);
    const margin = b.h - b.ay;
    g.drawImage(r, cx - b.ax, this.f.groundY - margin + 2, b.w, b.h * squash);
  }

  private glint(g: Ctx2D, x: number, y: number, r: number, a: number): void {
    if (a < 0.04) return;
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = a;
    g.drawImage(this.star, x - r, y - r, r * 2, r * 2);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  /** Anzahl Partikel, die in diesem Frame bei `perSec` Stück/s fällig sind (Rest bleibt in `e.fx[key]`) */
  private due(e: Ent, key: string, perSec: number): number {
    const acc = (e.fx[key] ?? 0) + perSec * Math.min(0.1, this.f.dt);
    const n = Math.floor(acc);
    e.fx[key] = acc - n;
    return n;
  }

  /** Aufblitzen (0…1) mit Phase; bei reduzierter Bewegung dauerhaft schwach */
  private twinkle(ph: number, rate: number): number {
    if (this.f.reduced) return 0.35;
    const s = Math.sin(this.f.time * rate + ph);
    return s > 0.55 ? (s - 0.55) / 0.45 : 0;
  }

  // --- Zeichnen (Einstieg) ----------------------------------------------------------------------------------------------

  draw(g: Ctx2D, e: Ent, sx: number, sy: number, v: ViewState): boolean {
    return this.dispatch(g, e, sx, sy, v) || this.fallback(g, e, sx, sy);
  }

  /**
   * Letzter Notbehelf (nur wenn weder Prop noch Ersatzbild aus `fallback.ts` verfügbar sind, z. B. unbekannte Skins oder ein
   * Fehler beim Backen): Tafel mit Farbverlauf, Goldrahmen, Rautenmuster und Glanzkante – Gefahren bleiben klar lesbar.
   */
  private fallback(g: Ctx2D, e: Ent, sx: number, sy: number): boolean {
    if (!SKIN_NAMES.has(e.skin) || !["block", "overhead", "walker", "projectile", "swinger", "spring"].includes(e.kind)) return false;
    if (e.skin === SKIN.cork && e.age <= (e.p.delay ?? 0)) return true;
    const warm = e.kind === "walker";
    const dark = e.kind === "spring";
    g.save();
    if (e.kind === "swinger") {
      const cx = sx + e.w / 2;
      const cy = sy + e.h / 2;
      g.strokeStyle = "#e0a52a";
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(e.p.ax - this.f.dist, e.p.ay);
      g.lineTo(cx, cy);
      g.stroke();
      const r = e.w / 2;
      const grd = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
      grd.addColorStop(0, "#fff6c8");
      grd.addColorStop(0.55, "#f0c04a");
      grd.addColorStop(1, "#a86a10");
      g.fillStyle = grd;
      g.strokeStyle = "#fff1c9";
      g.lineWidth = 3;
      g.beginPath();
      g.arc(cx, cy, r, 0, TAU);
      g.fill();
      g.stroke();
      // Kristallglitzer
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * TAU + 0.4;
        g.fillStyle = "rgba(255,255,255,0.85)";
        g.beginPath();
        g.arc(cx + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6, 2.6, 0, TAU);
        g.fill();
      }
    } else {
      const x = sx + 2;
      const y = sy + 2;
      const w = e.w - 4;
      const h = e.h - 4;
      const grd = g.createLinearGradient(x, y, x + w * 0.4, y + h);
      if (warm) {
        grd.addColorStop(0, "#f0405a");
        grd.addColorStop(1, "#8a0e26");
      } else if (dark) {
        grd.addColorStop(0, "#3a2a34");
        grd.addColorStop(1, "#0e080c");
      } else {
        grd.addColorStop(0, "#ffe08a");
        grd.addColorStop(0.5, "#d9a32a");
        grd.addColorStop(1, "#8a5a0c");
      }
      g.fillStyle = grd;
      g.strokeStyle = "#fff1c9";
      g.lineWidth = 3;
      g.beginPath();
      rr(g, x, y, w, h, 12);
      g.fill();
      g.stroke();
      // Rautenmuster + Glanzkante
      g.save();
      g.beginPath();
      rr(g, x, y, w, h, 12);
      g.clip();
      g.strokeStyle = "rgba(255,241,201,0.28)";
      g.lineWidth = 2;
      for (let d = -h; d < w; d += 22) {
        g.beginPath();
        g.moveTo(x + d, y);
        g.lineTo(x + d + h, y + h);
        g.moveTo(x + d + h, y);
        g.lineTo(x + d, y + h);
        g.stroke();
      }
      g.fillStyle = "rgba(255,255,255,0.22)";
      g.fillRect(x + 4, y + 4, 5, Math.max(0, h - 8));
      g.restore();
    }
    g.restore();
    return true;
  }

  /**
   * Ersatzbilder vorab backen (Ladezeit statt erstem Auftritt mitten im Lauf). Der Renderer ruft das nur auf, wenn Props
   * fehlen. Maße/Ränder entsprechen den Zeichenfunktionen unten (Abweichungen kosten nur einen späteren Bake).
   */
  warm(): void {
    const b = this.bank;
    const D = DIM;
    const jobs: Array<() => unknown> = [
      () => b.get("oper-cakecart", D.cake.h * 1.08, { rim: RIM }),
      () => b.get("oper-harp", D.harp.h * 1.03, { rim: RIM }),
      () => b.get("oper-bouquet", D.bouquet.h * 1.06, { rim: RIM }),
      () => b.get("oper-champagne", D.tower.h * 1.05, { rim: RIM }),
      () => b.get("oper-rope", D.rope.h, { rim: RIM }),
      () => b.get("oper-rope", Math.round(D.rope.h * 1.25), { rim: RIM }),
      () => b.get("oper-chandelier", 138, { rim: RIM, ax: 0.5, ay: 0 }),
      () => b.get("oper-chandelier", 150, { rim: RIM, ax: 0.5, ay: 0 }),
      () => b.get("oper-waiter", D.waiter.h * 1.1, { rim: RIM_ENEMY }),
      () => b.get("oper-dancers", D.dancers.h * 1.08, { rim: RIM_ENEMY }),
      () => b.get("oper-cork", 84, { rim: RIM_ENEMY, ax: 0.62, ay: 0.5 }),
      () => b.get("oper-bottle", D.bottle.h * 1.06, { rim: RIM }),
      () => b.get("oper-spotlight", 190, { rim: 2.2 }),
      () => b.get("oper-piano", 150, { rim: 2.4, rimColor: "#ffe08a" }),
    ];
    for (const job of jobs) job();
  }

  private dispatch(g: Ctx2D, e: Ent, sx: number, sy: number, v: ViewState): boolean {
    switch (e.kind) {
      case "pit":
        return true;
      case "pickup":
        if (e.pickup === "coin") return this.drawNote(g, e, sx, sy);
        if (e.pickup === "gem") return this.drawMask(g, e, sx, sy);
        return false;
      case "block":
        switch (e.skin) {
          case SKIN.cake:
            return this.blockProp(g, e, sx, sy, "oper-cakecart", 1.08, "cake");
          case SKIN.harp:
            return this.blockProp(g, e, sx, sy, "oper-harp", 1.03, "harp");
          case SKIN.bouquet:
            return this.blockProp(g, e, sx, sy, "oper-bouquet", 1.06, "bouquet");
          case SKIN.tower:
            return this.blockProp(g, e, sx, sy, "oper-champagne", 1.05, "tower");
          case SKIN.rope:
            return this.blockProp(g, e, sx, sy, "oper-rope", 1.0, "rope");
          default:
            return false;
        }
      case "overhead":
        if (e.skin === SKIN.lowlamp) return this.drawLowLamp(g, e, sx, sy);
        return e.skin === SKIN.drape ? this.drawDrape(g, e, sx, sy) : false;
      case "swinger":
        return e.skin === SKIN.swing ? this.drawChandelier(g, e, sx, sy, v) : false;
      case "walker":
        // Gast-Gegner (Odo, Madinger, …) zeichnet die Engine selbst
        if (e.skin === SKIN.dancers) return this.drawDancers(g, e, sx, sy);
        return e.skin === SKIN.waiter ? this.drawWaiter(g, e, sx, sy) : false;
      case "projectile":
        return this.drawCork(g, e, sx, sy);
      case "zone":
        return this.drawSpot(g, e, sx);
      case "spring":
        return this.drawPiano(g, e, sx, sy);
      case "platform":
        return this.drawBalcony(g, e, sx, sy);
      case "decor":
        return e.skin === SKIN.bottle ? this.drawBottle(g, e, sx, sy) : false;
      default:
        return false;
    }
  }

  // --- Bodenhindernisse ---------------------------------------------------------------------------------------------------

  private blockProp(g: Ctx2D, e: Ent, sx: number, sy: number, id: string, hScale: number, kind: string): boolean {
    const b = this.bank.get(id, e.h * hScale, { rim: RIM });
    if (!b) return false;
    const cx = sx + e.w / 2;
    const foot = sy + e.h + 1;
    const t = this.f.time;
    this.shadow(g, cx, e.w * 0.95, 0.9);
    this.reflect(g, b, id, cx);
    let rot = 0;
    let sys = 1;
    if (!this.f.reduced) {
      const ph = e.id * 1.37;
      if (kind === "bouquet") rot = Math.sin(t * 1.6 + ph) * 0.018;
      else if (kind === "tower") {
        sys = 1 + Math.sin(t * 2.4 + ph) * 0.008;
        rot = Math.sin(t * 1.1 + ph) * 0.006;
      } else if (kind === "rope") rot = Math.sin(t * 1.3 + ph) * 0.012;
      else if (kind === "cake") sys = 1 + Math.sin(t * 3 + ph) * 0.006;
    }
    drawBaked(g, b, cx, foot, { rot, sy: sys });
    // Funkeln: Kuppeln der Torte, Gläser des Turms, Harfensaiten
    const q = this.f.quality;
    if (q > 0) {
      const ph = e.id * 2.1;
      if (kind === "tower") {
        this.glint(g, cx - e.w * 0.2, sy + e.h * 0.2, 11, this.twinkle(ph, 3.1));
        this.glint(g, cx + e.w * 0.18, sy + e.h * 0.42, 9, this.twinkle(ph + 2, 2.6));
        if (!this.f.reduced && q === 2 && this.due(e, "bub", 1.4) > 0) this.pops.emit("gold", cx + (h1(e.id + t) - 0.5) * 30, sy + e.h * 0.1, 0, -40, 0.7, 4);
      } else if (kind === "cake") {
        this.glint(g, cx - e.w * 0.26, sy + e.h * 0.15, 10, this.twinkle(ph, 2.7));
        this.glint(g, cx + e.w * 0.2, sy + e.h * 0.3, 8, this.twinkle(ph + 3, 3.3));
      } else if (kind === "harp") {
        // Lichtreflex wandert über die Saiten
        const u = (t * 0.7 + ph) % 2;
        if (u < 1 && !this.f.reduced) this.glint(g, cx + e.w * 0.02 + (u - 0.5) * e.w * 0.3, sy + e.h * (0.15 + u * 0.7), 12, Math.sin(u * Math.PI) * 0.9);
      } else if (kind === "bouquet") {
        this.glint(g, cx - e.w * 0.15, sy + e.h * 0.14, 8, this.twinkle(ph, 2.2));
      }
    }
    return true;
  }

  // --- Hängendes ------------------------------------------------------------------------------------------------------------

  /** Kette aus Gliedern (ab y=0 bis y1) als 1:1-Streifen */
  private chainStrip(): HTMLCanvasElement {
    if (!this.drapeChain) {
      this.drapeChain = paint(14, 32, (g) => {
        for (let y = 0; y < 32; y += 16) {
          g.strokeStyle = "#5a3400";
          g.lineWidth = 5;
          g.beginPath();
          g.ellipse(7, y + 8, 4, 7.5, 0, 0, TAU);
          g.stroke();
          g.strokeStyle = "#ffcf4a";
          g.lineWidth = 2.4;
          g.beginPath();
          g.ellipse(7, y + 8, 4, 7.5, 0, 0, TAU);
          g.stroke();
        }
      });
    }
    return this.drapeChain;
  }

  private drawChain(g: Ctx2D, x: number, y0: number, y1: number): void {
    const c = this.chainStrip();
    for (let y = y1 - 32; y > y0 - 32; y -= 32) g.drawImage(c, x - 7, y);
  }

  private drawDrape(g: Ctx2D, e: Ent, sx: number, sy: number): boolean {
    const bottomY = sy + e.h;
    const w = e.w;
    const b = this.bank.get("oper-drape", w * 0.42, { rim: RIM, ax: 0.5, ay: 0, w });
    if (!b) return false;
    const sway = this.f.reduced ? 0 : Math.sin(this.f.time * 1.7 + e.id) * 0.008;
    const topY = bottomY - b.bodyH;
    // Ketten bis zur Decke
    this.drawChain(g, sx + w * 0.097, -10, topY + 4);
    this.drawChain(g, sx + w * 0.903, -10, topY + 4);
    drawBaked(g, b, sx + w / 2, topY, { rot: sway });
    // Schein unter dem Saum → Rutschen-Höhe klar erkennbar
    if (this.f.quality > 0) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.16;
      g.drawImage(this.glowGold, sx - 10, bottomY - 16, w + 20, 46);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    return true;
  }

  private drawLowLamp(g: Ctx2D, e: Ent, sx: number, sy: number): boolean {
    const bottomY = sy + e.h;
    const h = 150;
    const b = this.bank.get("oper-chandelier", h, { rim: RIM, ax: 0.5, ay: 0 });
    if (!b) return false;
    const cx = sx + e.w / 2;
    const top = bottomY - h * 0.97;
    const sway = this.f.reduced ? 0 : Math.sin(this.f.time * 1.9 + e.id) * 0.02;
    this.drawChain(g, cx, -10, top + 6);
    drawBaked(g, b, cx, top, { rot: sway });
    this.candleGlow(g, cx, top + h * 0.42, h * 0.9, e.id);
    return true;
  }

  /** Kette entlang einer Strecke (Glieder wechseln zwischen Flach- und Kantenansicht) */
  private chainLine(g: Ctx2D, x0: number, y0: number, x1: number, y1: number): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const n = Math.max(2, Math.round(len / 11));
    const ang = Math.atan2(dy, dx);
    g.save();
    g.translate(x0, y0);
    g.rotate(ang);
    const step = len / n;
    for (let i = 0; i < n; i += 1) g.drawImage(this.links[i % 2], (i + 0.5) * step - 10, -6);
    g.restore();
  }

  private candleGlow(g: Ctx2D, cx: number, cy: number, r: number, id: number): void {
    if (this.f.quality === 0) return;
    const f = this.f.reduced ? 0.9 : 0.85 + 0.15 * Math.sin(this.f.time * 9 + id * 3.1) * Math.sin(this.f.time * 5.3 + id);
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.34 * f;
    g.drawImage(this.glowWarm, cx - r, cy - r * 0.8, r * 2, r * 1.6);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  private drawChandelier(g: Ctx2D, e: Ent, sx: number, sy: number, v: ViewState): boolean {
    const Hs = 138;
    const b = this.bank.get("oper-chandelier", Hs, { rim: RIM, ax: 0.5, ay: 0 });
    if (!b) return false;
    const ang = e.fx.angle ?? 0;
    const px = e.p.ax - v.dist;
    const py = e.p.ay;
    const len = e.p.len;
    const dirx = Math.sin(ang);
    const diry = Math.cos(ang);
    const bobx = px + dirx * len;
    const boby = py + diry * len;
    const attach = len - Hs * 0.5;
    const ax = px + dirx * attach;
    const ay = py + diry * attach;
    const gy = this.f.groundY;
    // Bodenwarnung: Schatten + Lichtfleck unter der Kugel, stärker je tiefer sie hängt
    const low = clamp((boby - (gy - 250)) / 170, 0, 1);
    g.globalAlpha = 0.16 + 0.5 * low;
    g.drawImage(this.shadowSpr, bobx - 40 - 40 * low, gy - 6, 80 + 80 * low, 18);
    g.globalAlpha = 1;
    if (this.f.quality > 0) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.10 + 0.2 * low;
      g.drawImage(this.glowWarm, bobx - 90, gy - 16, 180, 34);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    // Kette + Leuchter
    this.chainLine(g, px, Math.min(py, -6), ax, ay);
    drawBaked(g, b, ax, ay, { rot: -ang });
    // Kerzenschein + Kristallglitzer
    this.candleGlow(g, bobx, boby - 4, 96, e.id);
    if (this.f.quality > 0) {
      const t = this.f.time;
      const cos = Math.cos(-ang);
      const sin = Math.sin(-ang);
      const spots: Array<[number, number, number]> = [
        [0.09, 0.44, 0],
        [0.27, 0.37, 1.3],
        [0.72, 0.37, 2.1],
        [0.91, 0.45, 3.4],
        [0.5, 0.96, 4.2],
        [0.3, 0.8, 5.1],
        [0.7, 0.78, 6.2],
      ];
      const sw = b.bodyW;
      for (let i = 0; i < spots.length; i += 1) {
        // lokale Position im Bild (Ursprung = Anhängepunkt oben Mitte), dann mit dem Pendelwinkel drehen
        const lx = (spots[i][0] - 0.5) * sw;
        const ly = spots[i][1] * Hs;
        const wx = ax + lx * cos - ly * sin;
        const wy = ay + lx * sin + ly * cos;
        const tw = this.f.reduced ? 0.45 : Math.max(0, Math.sin(t * (3.2 + i * 0.37) + spots[i][2] + e.id));
        if (tw > 0.2) this.glint(g, wx, wy, 8 + tw * 9, tw * (i < 4 ? 0.65 : 1));
      }
    }
    return true;
  }

  // --- Gegner ---------------------------------------------------------------------------------------------------------------------

  private drawWaiter(g: Ctx2D, e: Ent, sx: number, sy: number): boolean {
    const H = e.h * 1.1;
    const b = this.bank.get("oper-waiter", H, { rim: RIM_ENEMY });
    if (!b) return false;
    const cx = sx + e.w / 2;
    const foot = sy + e.h;
    const t = this.f.time;
    const ph = e.id * 0.83;
    if (e.state === "defeated") {
      const u = Math.min(1, e.stateT / 1.1);
      g.save();
      g.globalAlpha = 1 - Math.max(0, u - 0.5) / 0.5;
      drawBaked(g, b, cx, foot, { flipX: true, rot: 0.3 + e.stateT * 7, sy: 1 - 0.1 * u });
      g.restore();
      if (!e.fx.splash) {
        e.fx.splash = 1;
        for (let i = 0; i < 16; i += 1) {
          const a = -Math.PI / 2 + (h1(e.id * 7 + i) - 0.5) * 2.6;
          const sp = 140 + h1(i * 3 + e.id) * 260;
          this.pops.emit(i % 3 === 0 ? "foam" : "drop", cx + 6, sy + e.h * 0.32, Math.cos(a) * sp, Math.sin(a) * sp, 0.9 + h1(i) * 0.5, i % 3 === 0 ? 6 : 4, 900);
        }
      }
      return true;
    }
    this.shadow(g, cx, e.w * 1.15, 0.85);
    this.reflect(g, b, "oper-waiter", cx, 0.22);
    // Laufzyklus: Hüpfen im Takt der Schritte, leichte Vorlage, Tablett wippt
    const run = t * 11.5 + ph;
    const bob = this.f.reduced ? 0 : -Math.abs(Math.sin(run)) * 8;
    const lean = this.f.reduced ? 0 : Math.sin(run) * 0.045 - 0.03;
    const squash = this.f.reduced ? 1 : 1 + Math.cos(run * 2) * 0.03;
    g.save();
    drawBaked(g, b, cx, foot + bob, { flipX: true, rot: lean, sy: squash, sx: 2 - squash });
    g.restore();
    // Gläser glitzern / Schaumperlen vom Tablett
    if (this.f.quality > 0) {
      const tx = cx - e.w * 0.62;
      const ty = sy + e.h * 0.02 + bob;
      this.glint(g, tx, ty, 9, this.twinkle(ph, 4.1));
      if (this.f.quality === 2 && !this.f.reduced && this.due(e, "drp", 3.5) > 0) this.pops.emit("drop", tx + (h1(e.id + t) - 0.5) * 20, ty + 6, 30, -90, 0.6, 3.4, 300);
    }
    return true;
  }

  private drawDancers(g: Ctx2D, e: Ent, sx: number, sy: number): boolean {
    const H = e.h * 1.08;
    const b = this.bank.get("oper-dancers", H, { rim: RIM_ENEMY });
    if (!b) return false;
    const cx = sx + e.w / 2;
    const foot = sy + e.h;
    if (e.state === "defeated") {
      const u = Math.min(1, e.stateT / 1.1);
      g.save();
      g.globalAlpha = 1 - Math.max(0, u - 0.5) / 0.5;
      drawBaked(g, b, cx, foot, { flipX: true, rot: -0.35 - e.stateT * 6 });
      g.restore();
      if (!e.fx.burst) {
        e.fx.burst = 1;
        for (let i = 0; i < 10; i += 1) {
          const a = -Math.PI / 2 + (h1(e.id + i) - 0.5) * 2.4;
          this.pops.emit("note", cx, sy + e.h * 0.3, Math.cos(a) * (90 + i * 14), Math.sin(a) * (150 + i * 12), 1.2, 16 + (i % 3) * 4, 260);
        }
      }
      return true;
    }
    const t = this.f.time;
    // Walzer: Takt 1-2-3, Aufschwung über Schlag 2–3, Drehung alle zwei Takte
    const ph = t / BEAT + e.id * 0.9;
    const bar = (ph % 3) / 3;
    const rise = 0.5 - 0.5 * Math.cos(bar * TAU);
    const twirl = Math.cos(((ph % 6) / 6) * TAU);
    const facing = this.f.reduced ? 1 : Math.sign(twirl || 1) * Math.max(0.34, Math.abs(twirl));
    const bob = this.f.reduced ? 0 : -rise * 10;
    const sway = this.f.reduced ? 0 : Math.sin(bar * TAU) * 0.06;
    this.shadow(g, cx, e.w * 1.2, 0.85 - rise * 0.2);
    this.reflect(g, b, "oper-dancers", cx, 0.22);
    drawBaked(g, b, cx, foot + bob, { flipX: true, sx: facing, rot: sway, sy: 1 + rise * 0.03 });
    if (this.f.quality > 0) {
      this.glint(g, cx + e.w * 0.05, sy + e.h * 0.35 + bob, 9, this.twinkle(e.id, 2.6));
      // Rocksaum wirbelt Funken auf beim Drehen
      if (this.f.quality === 2 && !this.f.reduced && Math.abs(twirl) < 0.3 && this.due(e, "spk", 14) > 0) {
        this.pops.emit("gold", cx + (h1(t + e.id) - 0.5) * 60, foot - 26, -20, -70, 0.6, 5);
      }
    }
    return true;
  }

  // --- Korken + Flasche ------------------------------------------------------------------------------------------------------------

  private drawCork(g: Ctx2D, e: Ent, sx: number, sy: number): boolean {
    if (e.skin !== SKIN.cork) return false;
    // Der Korken steckt noch in der Flasche, bis der Knall kommt (p.delay = Sekunden bis zum Start)
    const delay = e.p.delay ?? 0;
    if (e.age <= delay) return true;
    const flown = Math.abs(e.vx) * (e.age - delay);
    const b = this.bank.get("oper-cork", 84, { rim: RIM_ENEMY, ax: 0.62, ay: 0.5 });
    if (!b) return false;
    const cx = sx + e.w / 2;
    const t = this.f.time;
    const fresh = Math.min(1, flown / 260);
    // Der Korken startet am Flaschenhals und sinkt auf seine Trefferhöhe (Treffer-Box liegt darunter)
    const neck = e.p.neck ?? 0;
    const cy0 = sy + e.h / 2;
    const cy = neck > 0 ? cy0 - Math.max(0, this.f.groundY - neck - cy0) * (1 - fresh * fresh * (3 - 2 * fresh)) : cy0;
    const tumble = this.f.reduced ? 0 : Math.sin(t * 22 + e.id) * 0.08 + (1 - fresh) * 0.4;
    if (this.f.quality > 0) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.28;
      g.drawImage(this.glowGold, cx - 50, cy - 36, 100, 72);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    // Schaumspur hinter dem Korken (zieht nach rechts weg)
    if (this.f.quality > 0 && !this.f.reduced) {
      const k = e.id * 13;
      for (let i = 0; i < 5; i += 1) {
        const u = ((t * 3.4 + h1(k + i)) % 1);
        const x = cx + 26 + u * 90;
        const y = cy + (h1(k + i * 5) - 0.5) * 26 * (0.4 + u);
        g.globalAlpha = (1 - u) * 0.75;
        g.drawImage(this.glowWhite, x - 6, y - 6, 12 * (1 - u * 0.4), 12 * (1 - u * 0.4));
      }
      g.globalAlpha = 1;
    }
    drawBaked(g, b, cx + 4, cy, { flipX: true, rot: tumble });
    return true;
  }

  private drawBottle(g: Ctx2D, e: Ent, sx: number, sy: number): boolean {
    const b = this.bank.get("oper-bottle", e.h * 1.06, { rim: RIM });
    if (!b) return false;
    const cx = sx + e.w / 2;
    const foot = sy + e.h + 1;
    const t = this.f.time;
    const popT = e.p.popT ?? 1e9;
    const until = popT - e.age;
    // Schütteln: ab 0.9 s vor dem Knall immer stärker, Schaum quillt am Hals
    const warn = clamp(1 - until / 0.95, 0, 1);
    const popped = until <= 0;
    const since = -until;
    let rot = 0;
    let sxs = 1;
    let sys = 1;
    if (!popped && !this.f.reduced) {
      const amp = 0.03 + 0.1 * warn;
      rot = Math.sin(t * (30 + 20 * warn) + e.id) * amp;
      sys = 1 + Math.sin(t * 40) * 0.02 * warn;
    } else if (popped && since < 0.35 && !this.f.reduced) {
      // Rückstoß
      const u = since / 0.35;
      rot = Math.sin(u * Math.PI) * 0.12;
      sys = 1 - Math.sin(u * Math.PI) * 0.1;
      sxs = 1 + Math.sin(u * Math.PI) * 0.06;
    }
    this.shadow(g, cx, e.w * 1.1, 0.85);
    this.reflect(g, b, "oper-bottle", cx, 0.22);
    // gespiegelt: der Hals neigt sich nach links, dorthin fliegt der Korken
    drawBaked(g, b, cx, foot, { rot, sx: sxs, sy: sys, flipX: true });
    const px = -0.1 * b.bodyW;
    const py = -0.92 * b.bodyH * sys;
    const neckX = cx + px * Math.cos(rot) - py * Math.sin(rot);
    const neckY = foot + px * Math.sin(rot) + py * Math.cos(rot);
    if (this.f.quality > 0) {
      if (!popped && warn > 0.02) {
        // Schaum-Warnung: wachsende Blasenkrone + Warnring
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = 0.25 + 0.5 * warn;
        g.drawImage(this.glowWhite, neckX - 26 - 20 * warn, neckY - 26 - 20 * warn, 52 + 40 * warn, 52 + 40 * warn);
        g.globalAlpha = 1;
        g.globalCompositeOperation = "source-over";
        if (!this.f.reduced && ((t * 24 + e.id) % 1) < 0.5 && warn > 0.2) {
          this.pops.emit("foam", neckX + (h1(t) - 0.5) * 12, neckY, (h1(t * 3) - 0.5) * 60 - 20, -80 - 120 * warn, 0.55, 4 + 4 * warn, 260);
        }
      }
      if (popped && !e.fx.popped) {
        e.fx.popped = 1;
        for (let i = 0; i < 22; i += 1) {
          const a = -Math.PI * 0.9 + (h1(e.id * 5 + i) - 0.5) * 1.5;
          const sp = 120 + h1(i * 7 + e.id) * 420;
          this.pops.emit(i % 2 ? "foam" : "drop", neckX, neckY, Math.cos(a) * sp, Math.sin(a) * sp, 0.7 + h1(i) * 0.6, i % 2 ? 7 : 4, 700);
        }
        this.pops.emit("star", neckX, neckY, 0, 0, 0.35, 34);
      }
      if (popped && since < 1.4 && !this.f.reduced && ((t * 20 + e.id) % 1) < 0.4) {
        this.pops.emit("foam", neckX, neckY - 2, (h1(t * 7) - 0.5) * 50, -60 - 60 * h1(t), 0.6, 4, 320);
      }
    }
    return true;
  }

  // --- Scheinwerfer-Kegel (Zone) --------------------------------------------------------------------------------------------------------

  private drawSpot(g: Ctx2D, e: Ent, sx: number): boolean {
    if (e.skin !== SKIN.spot) return false;
    const gy = this.f.groundY;
    const st = e.state;
    const u = e.fx.phaseT ?? 0;
    const poolCx = sx + e.w * 0.5;
    const poolW = e.w;
    const standX = sx + e.w + 44;
    const lensX = standX - 22;
    const lensY = gy - 176;
    const t = this.f.time;
    // Intensität des Kegels
    let a = 0.14;
    if (st === "warn") a = 0.3 + 0.5 * u;
    else if (st === "active") a = 1;
    else a = 0.1 + 0.3 * Math.max(0, 1 - e.stateT / 0.4);
    if (this.f.reduced && st === "warn") a = 0.4;
    // Kegel: vom Objektiv schräg zur Lichtpfütze (mehrere Schichten → weiche Ränder)
    g.save();
    g.globalCompositeOperation = "lighter";
    const grd = g.createLinearGradient(lensX, lensY, poolCx, gy);
    grd.addColorStop(0, "rgba(255,244,205,0.9)");
    grd.addColorStop(1, "rgba(255,214,120,1)");
    g.fillStyle = grd;
    for (let i = 0; i < 4; i += 1) {
      const k = 1 - i * 0.24;
      const hw = (poolW * 0.5 + 6) * k;
      g.globalAlpha = 0.2 * a * (i === 0 ? 0.8 : 1);
      g.beginPath();
      g.moveTo(lensX, lensY - 14 * k);
      g.lineTo(lensX, lensY + 14 * k);
      g.lineTo(poolCx + hw, gy + 2);
      g.lineTo(poolCx - hw, gy + 2);
      g.closePath();
      g.fill();
    }
    // Lichtpfütze auf dem Parkett
    g.globalAlpha = a;
    const pool = 0.85 + (this.f.reduced ? 0 : 0.08 * Math.sin(t * 20));
    g.drawImage(this.glowWarm, poolCx - poolW * 0.62, gy - 26 * pool - 4, poolW * 1.24, 60 * pool);
    if (st === "active") {
      g.globalAlpha = 0.9;
      g.drawImage(this.glowWhite, poolCx - poolW * 0.44, gy - 46, poolW * 0.88, 92);
    }
    g.globalAlpha = 1;
    g.restore();
    // Rand der Trefferzone: ab "warn" sichtbar (gestrichelt + Zeitring, der sich bis zum Blendlicht schließt), im aktiven Zustand weiß
    if (st !== "idle" || e.stateT < 0.4) {
      g.save();
      const ry = 12 + (st === "active" ? 3 : 0);
      g.strokeStyle = st === "active" ? "rgba(255,255,255,0.95)" : `rgba(255,226,150,${0.55 + 0.4 * u})`;
      g.lineWidth = st === "active" ? 3.4 : 3;
      g.setLineDash([12, 9]);
      g.lineDashOffset = -t * 30;
      g.beginPath();
      g.ellipse(poolCx, gy + 1, poolW * 0.5, ry, 0, 0, TAU);
      g.stroke();
      if (st === "warn") {
        g.setLineDash([]);
        g.strokeStyle = "rgba(255,255,255,0.95)";
        g.lineWidth = 4;
        g.beginPath();
        g.ellipse(poolCx, gy + 1, poolW * 0.5, ry, 0, -Math.PI / 2, -Math.PI / 2 + u * TAU);
        g.stroke();
      }
      g.restore();
    }
    // Lichtstaub im Kegel
    if (this.f.quality > 0 && !this.f.reduced && a > 0.2) {
      for (let i = 0; i < 6; i += 1) {
        const s = (t * 0.35 + h1(e.id + i * 9)) % 1;
        const px = lensX + (poolCx - lensX) * s + (h1(i + e.id) - 0.5) * 40 * s;
        const py = lensY + (gy - lensY) * s + Math.sin(t * 2 + i) * 6;
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = a * 0.7 * Math.sin(s * Math.PI);
        g.drawImage(this.glowWhite, px - 3, py - 3, 6, 6);
        g.globalAlpha = 1;
        g.globalCompositeOperation = "source-over";
      }
    }
    // Ständer mit Scheinwerfer (Objektiv zeigt nach links, Blickrichtung Pfütze)
    const b = this.bank.get("oper-spotlight", 190, { rim: 2.2 });
    if (b) {
      this.shadow(g, standX, 70, 0.8);
      drawBaked(g, b, standX, gy + 1, { flipX: true });
      if (this.f.quality > 0) {
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = Math.min(1, 0.35 + a);
        g.drawImage(this.glowWhite, lensX - 30, lensY - 30, 60, 60);
        g.globalAlpha = 1;
        g.globalCompositeOperation = "source-over";
      }
    }
    return true;
  }

  // --- Flügel-Sprungbrett + Balkon ------------------------------------------------------------------------------------------------------

  private drawPiano(g: Ctx2D, e: Ent, sx: number, sy: number): boolean {
    if (e.skin !== SKIN.piano) return false;
    const H = 150;
    const b = this.bank.get("oper-piano", H, { rim: 2.4, rimColor: "#ffe08a" });
    if (!b) return false;
    const cx = sx + e.w / 2;
    const foot = sy + e.h + 1;
    const sprung = e.state === "sprung" ? e.stateT : 9;
    const kick = sprung < 0.45 ? Math.sin((sprung / 0.45) * Math.PI) : 0;
    if (!e.fx.notes && e.state === "sprung") {
      e.fx.notes = 1;
      for (let i = 0; i < 9; i += 1) {
        this.pops.emit("note", cx + (i - 4) * 12, sy - 20, (i - 4) * 30, -180 - (i % 3) * 60, 1.5, 18 + (i % 3) * 4, 120);
      }
      this.pops.emit("star", cx, sy - 30, 0, 0, 0.4, 40);
    }
    this.shadow(g, cx, e.w * 1.05, 0.9);
    this.reflect(g, b, "oper-piano", cx, 0.24);
    // Lockeneinladung: goldener Pulsring über dem Sprungbrett
    if (this.f.quality > 0) {
      const pulse = this.f.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(this.f.time * 4.5 + e.id);
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.16 + 0.14 * pulse + kick * 0.4;
      g.drawImage(this.glowGold, cx - 130, sy - 120, 260, 190);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    drawBaked(g, b, cx, foot, { sy: 1 - kick * 0.12, sx: 1 + kick * 0.05 });
    // Notensymbole schweben über dem Deckel
    if (this.f.quality > 0 && !this.f.reduced && sprung > 1) {
      const t = this.f.time;
      if (this.due(e, "nts", 0.6) > 0) this.pops.emit("note", cx + (h1(e.id + t) - 0.5) * 100, sy - 70, 0, -46, 1.6, 15, 0);
    }
    return true;
  }

  /** Balkon-Plattform: Balustrade dahinter, Marmorplatte, Samtdraperie mit Quasten darunter. */
  private balconySprite(w: number): HTMLCanvasElement {
    // Breiten in 32-px-Stufen (beim Zeichnen um ≤ 3 % gestreckt) und höchstens 8 Sprites im Speicher
    const key = Math.max(64, Math.round(w / 32) * 32);
    let c = this.balconies.get(key);
    if (c) {
      this.balconies.delete(key);
      this.balconies.set(key, c);
      return c;
    }
    const W = key + 20;
    const RAIL = 70; // Höhe der Balustrade über der Plattenoberkante
    const SLAB = 28;
    const DRAPE = 52;
    c = paint(W, RAIL + SLAB + DRAPE + 8, (g) => {
      const x0 = 10;
      const x1 = W - 10;
      const top = RAIL;
      // Balustrade (leicht abgedunkelt, damit die Figur davor lesbar bleibt)
      const gold = g.createLinearGradient(0, 0, 0, RAIL);
      gold.addColorStop(0, "#ffe89a");
      gold.addColorStop(1, "#b9770f");
      // Baluster
      for (let x = x0 + 22; x < x1 - 14; x += 24) {
        g.fillStyle = "rgba(60,30,4,0.9)";
        g.beginPath();
        g.moveTo(x - 6, top);
        g.quadraticCurveTo(x - 9, top - 14, x - 3, top - 24);
        g.quadraticCurveTo(x - 9, top - 34, x - 2, top - 44);
        g.lineTo(x + 2, top - 44);
        g.quadraticCurveTo(x + 9, top - 34, x + 3, top - 24);
        g.quadraticCurveTo(x + 9, top - 14, x + 6, top);
        g.closePath();
        g.fill();
        g.fillStyle = gold;
        g.beginPath();
        g.moveTo(x - 4.6, top);
        g.quadraticCurveTo(x - 7.4, top - 14, x - 2, top - 24);
        g.quadraticCurveTo(x - 7.4, top - 34, x - 1.4, top - 43);
        g.lineTo(x + 1.4, top - 43);
        g.quadraticCurveTo(x + 7.4, top - 34, x + 2, top - 24);
        g.quadraticCurveTo(x + 7.4, top - 14, x + 4.6, top);
        g.closePath();
        g.fill();
      }
      // Handlauf
      g.fillStyle = "#4a2604";
      g.beginPath();
      rr(g, x0, top - 56, x1 - x0, 13, 6);
      g.fill();
      g.fillStyle = gold;
      g.beginPath();
      rr(g, x0 + 1.5, top - 54.5, x1 - x0 - 3, 9.5, 4.5);
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.55)";
      g.fillRect(x0 + 8, top - 53.5, x1 - x0 - 16, 2);
      // Pfosten mit Kugeln
      for (const px of [x0 + 6, x1 - 6]) {
        g.fillStyle = "#4a2604";
        g.fillRect(px - 8, top - 64, 16, 66);
        g.fillStyle = gold;
        g.fillRect(px - 6, top - 62, 12, 62);
        g.fillStyle = "#4a2604";
        g.beginPath();
        g.arc(px, top - 70, 9, 0, TAU);
        g.fill();
        const ball = g.createRadialGradient(px - 3, top - 73, 1, px, top - 70, 8);
        ball.addColorStop(0, "#fff6c0");
        ball.addColorStop(1, "#d99518");
        g.fillStyle = ball;
        g.beginPath();
        g.arc(px, top - 70, 7.2, 0, TAU);
        g.fill();
      }
      // Marmorplatte
      g.fillStyle = "#3a2410";
      g.beginPath();
      rr(g, x0 - 6, top, x1 - x0 + 12, SLAB, 6);
      g.fill();
      const slab = g.createLinearGradient(0, top, 0, top + SLAB);
      slab.addColorStop(0, "#fff7e4");
      slab.addColorStop(0.28, "#f0dfbe");
      slab.addColorStop(1, "#c9ae7c");
      g.fillStyle = slab;
      g.beginPath();
      rr(g, x0 - 4, top + 1.5, x1 - x0 + 8, SLAB - 3.5, 5);
      g.fill();
      // Goldleiste + Zahnschnitt
      g.fillStyle = "#e0a52a";
      g.fillRect(x0 - 4, top + SLAB - 10, x1 - x0 + 8, 5);
      g.fillStyle = "rgba(90,50,8,0.55)";
      for (let x = x0; x < x1 - 4; x += 12) g.fillRect(x, top + SLAB - 20, 6, 7);
      g.fillStyle = "rgba(255,255,255,0.7)";
      g.fillRect(x0 - 2, top + 2, x1 - x0 + 4, 3);
      // Samtdraperie unter der Platte
      const dt = top + SLAB - 2;
      const red = g.createLinearGradient(0, dt, 0, dt + DRAPE);
      red.addColorStop(0, "#8c0f24");
      red.addColorStop(1, "#4a0612");
      g.fillStyle = red;
      g.beginPath();
      g.moveTo(x0, dt);
      g.lineTo(x1, dt);
      const swags = Math.max(2, Math.round((x1 - x0) / 92));
      const sw = (x1 - x0) / swags;
      for (let i = swags - 1; i >= 0; i -= 1) {
        const xr = x0 + (i + 1) * sw;
        const xl = x0 + i * sw;
        g.lineTo(xr, dt + DRAPE * 0.42);
        g.quadraticCurveTo((xl + xr) / 2, dt + DRAPE, xl, dt + DRAPE * 0.42);
      }
      g.closePath();
      g.fill();
      g.strokeStyle = "#ffcf4a";
      g.lineWidth = 3;
      g.beginPath();
      for (let i = 0; i < swags; i += 1) {
        const xl = x0 + i * sw;
        const xr = xl + sw;
        g.moveTo(xl, dt + DRAPE * 0.42);
        g.quadraticCurveTo((xl + xr) / 2, dt + DRAPE, xr, dt + DRAPE * 0.42);
      }
      g.stroke();
      g.strokeStyle = "rgba(255,120,120,0.28)";
      g.lineWidth = 2;
      for (let i = 0; i < swags; i += 1) {
        const xl = x0 + i * sw;
        g.beginPath();
        g.moveTo(xl + sw * 0.5, dt + 4);
        g.quadraticCurveTo(xl + sw * 0.52, dt + DRAPE * 0.5, xl + sw * 0.5, dt + DRAPE * 0.84);
        g.stroke();
      }
      // Quasten an den Raffpunkten
      for (let i = 0; i <= swags; i += 1) {
        const qx = x0 + i * sw;
        g.fillStyle = "#4a2604";
        g.fillRect(qx - 3, dt + DRAPE * 0.42, 6, 10);
        g.fillStyle = "#ffcf4a";
        g.fillRect(qx - 1.6, dt + DRAPE * 0.42, 3.2, 9);
        g.beginPath();
        g.ellipse(qx, dt + DRAPE * 0.42 + 15, 5.4, 6.6, 0, 0, TAU);
        g.fillStyle = "#4a2604";
        g.fill();
        g.beginPath();
        g.ellipse(qx, dt + DRAPE * 0.42 + 15, 3.8, 5.2, 0, 0, TAU);
        g.fillStyle = "#ffcf4a";
        g.fill();
      }
    });
    this.balconies.set(key, c);
    if (this.balconies.size > 8) {
      const oldest = this.balconies.keys().next().value;
      if (oldest !== undefined) this.balconies.delete(oldest);
    }
    return c;
  }

  private drawBalcony(g: Ctx2D, e: Ent, sx: number, sy: number): boolean {
    if (e.skin !== SKIN.balcony) return false;
    const spr = this.balconySprite(e.w);
    const RAIL = 70;
    const dw = e.w + 20;
    const x = sx - 10;
    const y = sy - RAIL;
    // weicher Schatten der Platte auf dem Saal
    g.globalAlpha = 0.28;
    g.fillStyle = "#000";
    g.beginPath();
    g.ellipse(sx + e.w / 2, this.f.groundY + 2, e.w * 0.5, 7, 0, 0, TAU);
    g.fill();
    g.globalAlpha = 1;
    g.drawImage(spr, x, y, dw, spr.height);
    // Lichtkante auf der Platte (Lauffläche gut sichtbar)
    if (this.f.quality > 0) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.22;
      g.fillStyle = "#ffe9b0";
      g.fillRect(sx + 3, sy - 1, e.w - 6, 3);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    return true;
  }

  // --- Sammelobjekte ----------------------------------------------------------------------------------------------------------------------

  private drawNote(g: Ctx2D, e: Ent, sx: number, sy: number): boolean {
    const b = this.bank.get("oper-note", e.w * 1.25, { ax: 0.5, ay: 0.5 });
    if (!b) return false;
    const cx = sx + e.w / 2;
    const t = this.f.time;
    const ph = e.id * 0.61;
    const cy = sy + e.h / 2 + (this.f.reduced ? 0 : Math.sin(t * 3 + ph) * 2.4);
    const spin = this.f.reduced ? 1 : Math.max(0.16, Math.abs(Math.cos(t * 3.4 + ph)));
    if (this.f.quality > 0) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.34;
      g.drawImage(this.glowGold, cx - e.w * 0.95, cy - e.w * 0.95, e.w * 1.9, e.w * 1.9);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    drawBaked(g, b, cx, cy, { sx: spin });
    if (this.f.quality === 2) this.glint(g, cx + e.w * 0.24, cy - e.w * 0.26, 8, this.twinkle(ph, 2.4));
    return true;
  }

  private drawMask(g: Ctx2D, e: Ent, sx: number, sy: number): boolean {
    const b = this.bank.get("oper-mask", e.w * 1.5, { ax: 0.5, ay: 0.5 });
    if (!b) return false;
    const cx = sx + e.w / 2;
    const t = this.f.time;
    const cy = sy + e.h / 2 + (this.f.reduced ? 0 : Math.sin(t * 2.6 + e.id) * 3.5);
    const rot = this.f.reduced ? 0 : Math.sin(t * 1.8 + e.id) * 0.14;
    if (this.f.quality > 0) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.4;
      g.drawImage(this.glowGold, cx - 44, cy - 44, 88, 88);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    drawBaked(g, b, cx, cy, { rot });
    this.glint(g, cx - 12, cy - 12, 12, this.twinkle(e.id, 2.9));
    return true;
  }
}
