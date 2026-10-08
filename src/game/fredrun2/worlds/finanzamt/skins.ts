/**
 * Finanzamt – Entitäts-Skins. Statische Hindernisse werden je Größe EINMAL mit Rim-Light-Kontur vorgerendert
 * (SpriteCache) und pro Frame nur geblittet; bewegte Teile (Stempelkolben, Laserstrahlen, Förderband, Pendelleuchte)
 * werden prozedural gezeichnet. Props (Bürostuhl, Fledermaus, Schredder, Ordner, Kartons, Kopierer, Hängeregistratur,
 * Lüftungskanal, Bankierslampe …) mit prozeduralem Fallback.
 */
import { VIEW_W } from "../../constants";
import type { Ent, PropLibrary, ViewState } from "../../types";
import { glowAt, glowSprite, paint, rr, softSprite, spriteStrip, type Ctx2D } from "../shared-b/canvas";
import { h1 } from "../shared-b/color";
import { STAMP_PARK_Y } from "./geom";

const TAU = Math.PI * 2;
export const RIM = "rgba(165,215,255,0.9)";

// =================================================================================================
// Sprite-Cache mit Rim-Light

/**
 * Bake-Budget je Frame. Maße wie Kistengröße, Hängebreite oder Fledermausflügel variieren mit Muster und Tempo, die Sprites
 * lassen sich daher nicht vorbacken und entstehen beim ersten Zeichnen. Die Engine zeichnet eine Entität schon 260 px vor dem
 * rechten Bildrand; solange sie noch ganz außerhalb steht (`off`), darf pro Frame nur EIN Bake laufen (`n`), alle weiteren
 * warten einen Frame (die Caches liefern dann `EMPTY`, unsichtbar). Sichtbare Sprites werden immer sofort gebacken.
 */
export interface BakeBudget {
  /** Bakes im laufenden Frame */
  n: number;
  /** die gerade gezeichnete Entität steht noch ganz außerhalb des Bildes */
  off: boolean;
}

/** x ab dem eine Entität als „noch außerhalb“ gilt: Sprites reichen bis ca. 40 px links über die Trefferfläche hinaus */
export const OFFSCREEN_X = VIEW_W + 40;

let emptyCanvas: HTMLCanvasElement | null = null;
/** Durchsichtiger Platzhalter für einen wartenden Bake (1×1, wird nie gecacht) */
function EMPTY(): HTMLCanvasElement {
  return (emptyCanvas ??= paint(1, 1, () => undefined));
}

/** Soll der Bake auf den nächsten Frame warten? (außerhalb des Bildes und in diesem Frame ist schon einer gelaufen) */
function mustWait(b: BakeBudget | undefined): boolean {
  if (!b) return false;
  if (b.off && b.n > 0) return true;
  b.n += 1;
  return false;
}

export class SpriteCache {
  private map = new Map<string, HTMLCanvasElement>();
  /** Pixeldichte der Zeichenfläche (Sprites werden in Zielauflösung gerendert → scharf auf Hi-DPI) */
  k = 1;
  constructor(
    private readonly max = 90,
    private readonly budget?: BakeBudget,
  ) {}
  get(key: string, w: number, h: number, draw: (g: Ctx2D) => void, rim: string | null = RIM, rimW = 2): HTMLCanvasElement {
    let c = this.map.get(key);
    if (!c) {
      if (mustWait(this.budget)) return EMPTY();
      const k = this.k;
      const src = paint(Math.max(1, Math.ceil(w * k)), Math.max(1, Math.ceil(h * k)), (g) => {
        g.scale(k, k);
        draw(g);
      });
      c = rim ? withRim(src, rim, Math.max(1, Math.round(rimW * k))) : src;
      this.map.set(key, c);
      if (this.map.size > this.max) {
        const first = this.map.keys().next().value;
        if (first !== undefined) this.map.delete(first);
      }
    }
    return c;
  }
  clear(): void {
    this.map.clear();
  }
  /** Sprite in logischer Größe zeichnen (x, y = linke obere Ecke) */
  draw(g: Ctx2D, spr: HTMLCanvasElement, x: number, y: number): void {
    const k = this.k;
    if (k === 1) g.drawImage(spr, Math.round(x), Math.round(y));
    else g.drawImage(spr, Math.round(x * k) / k, Math.round(y * k) / k, spr.width / k, spr.height / k);
  }
  lw(spr: HTMLCanvasElement): number {
    return spr.width / this.k;
  }
  lh(spr: HTMLCanvasElement): number {
    return spr.height / this.k;
  }
}

/** Kontur (Rim-Light) um die Silhouette eines Sprites: 8 versetzte, eingefärbte Kopien hinter dem Original. */
export function withRim(src: HTMLCanvasElement, color: string, width = 2): HTMLCanvasElement {
  const sil = paint(src.width, src.height, (s) => {
    s.drawImage(src, 0, 0);
    s.globalCompositeOperation = "source-in";
    s.fillStyle = color;
    s.fillRect(0, 0, src.width, src.height);
  });
  return paint(src.width, src.height, (g) => {
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * TAU;
      g.drawImage(sil, Math.round(Math.cos(a) * width), Math.round(Math.sin(a) * width));
    }
    g.drawImage(src, 0, 0);
  });
}

/** Weicher, elliptischer Leuchtfleck in exakter Zielgröße (1:1 blitten statt kleine Sprites hochzuskalieren) */
export class GlowCache {
  private map = new Map<string, HTMLCanvasElement>();
  constructor(private readonly budget?: BakeBudget) {}
  get(color: string, rx: number, ry: number, core = 0.45): HTMLCanvasElement {
    const qx = Math.max(4, Math.round(rx / 4) * 4);
    const qy = Math.max(4, Math.round(ry / 4) * 4);
    const key = `${color}|${qx}|${qy}|${core}`;
    let c = this.map.get(key);
    if (!c) {
      if (mustWait(this.budget)) return EMPTY();
      c = paint(qx * 2, qy * 2, (g) => {
        g.translate(qx, qy);
        g.scale(1, qy / qx);
        const grd = g.createRadialGradient(0, 0, 0, 0, 0, qx);
        grd.addColorStop(0, color);
        grd.addColorStop(core, colorA(color, 0.45));
        grd.addColorStop(1, colorA(color, 0));
        g.fillStyle = grd;
        g.fillRect(-qx, -qx, qx * 2, qx * 2);
      });
      this.map.set(key, c);
      if (this.map.size > 120) {
        const first = this.map.keys().next().value;
        if (first !== undefined) this.map.delete(first);
      }
    }
    return c;
  }
}

function colorA(c: string, a: number): string {
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(",");
    return `rgba(${p[0]},${p[1]},${p[2]},${a})`;
  }
  const n = parseInt(c.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Sprite zentriert an ganzzahliger Position */
export function blitC(g: Ctx2D, spr: HTMLCanvasElement, cx: number, cy: number): void {
  g.drawImage(spr, Math.round(cx - spr.width / 2), Math.round(cy - spr.height / 2));
}

export interface FaAssets {
  props: PropLibrary | null;
  /** Bake-Budget des Frames (geteilt von Sprite- und Glow-Caches); der Renderer setzt es pro Frame/Entität */
  budget: BakeBudget;
  glow: GlowCache;
  coin: HTMLCanvasElement;
  coinSize: number;
  glowRed: HTMLCanvasElement;
  glowWarm: HTMLCanvasElement;
  glowWhite: HTMLCanvasElement;
  glowCyan: HTMLCanvasElement;
  glowAmber: HTMLCanvasElement;
  glowGreen: HTMLCanvasElement;
  softRed: HTMLCanvasElement;
  softWarm: HTMLCanvasElement;
  softCyan: HTMLCanvasElement;
  softGold: HTMLCanvasElement;
  cache: SpriteCache;
  /** Cache für gebackene Hindernis-Props (größere Sprites, daher kleineres Limit) */
  pcache: SpriteCache;
}

export interface SkinCtx {
  A: FaAssets;
  time: number;
  reduced: boolean;
  quality: 0 | 1 | 2;
  /** aktuelle Dunkelheit 0..1 */
  dark: number;
}

// =================================================================================================
// Euro-Münze (12 Drehphasen)

function euroSign(g: Ctx2D, r: number, color: string): void {
  g.strokeStyle = color;
  g.lineWidth = r * 0.16;
  g.lineCap = "butt";
  g.beginPath();
  g.arc(r * 0.08, 0, r * 0.5, 0.75, TAU - 0.75);
  g.stroke();
  g.lineWidth = r * 0.1;
  g.beginPath();
  g.moveTo(-r * 0.55, -r * 0.13);
  g.lineTo(r * 0.2, -r * 0.13);
  g.moveTo(-r * 0.55, r * 0.13);
  g.lineTo(r * 0.14, r * 0.13);
  g.stroke();
}

export const COIN_PX = 41;

export function makeCoinStrip(k: number): HTMLCanvasElement {
  const size = Math.round(COIN_PX * k);
  return spriteStrip(12, size, (g, f, s) => {
    const ang = (f / 12) * TAU;
    const c = Math.cos(ang);
    const sx = Math.max(0.1, Math.abs(c));
    const r = s * 0.43;
    g.translate(s / 2, s / 2);
    // Randdicke (Münzkante) bei Schrägsicht
    if (sx < 0.95) {
      g.fillStyle = "#9a6a12";
      g.beginPath();
      g.ellipse(c < 0 ? -2 : 2, 0, r * sx + 2, r, 0, 0, TAU);
      g.fill();
    }
    g.scale(sx, 1);
    // Silberring
    const ring = g.createLinearGradient(-r, -r, r, r);
    ring.addColorStop(0, "#ffffff");
    ring.addColorStop(0.45, "#cfd6e2");
    ring.addColorStop(1, "#7c8698");
    g.fillStyle = ring;
    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    g.fill();
    // Goldkern
    const core = g.createRadialGradient(-r * 0.25, -r * 0.3, 1, 0, 0, r * 0.72);
    core.addColorStop(0, "#fff4b0");
    core.addColorStop(0.55, "#ffcf3a");
    core.addColorStop(1, "#c9860e");
    g.fillStyle = core;
    g.beginPath();
    g.arc(0, 0, r * 0.7, 0, TAU);
    g.fill();
    g.strokeStyle = "rgba(120,70,0,0.55)";
    g.lineWidth = 1.5;
    g.stroke();
    // Sterne am Ring
    g.fillStyle = "rgba(120,130,150,0.8)";
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * TAU;
      g.beginPath();
      g.arc(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85, 1.3, 0, TAU);
      g.fill();
    }
    euroSign(g, r * 0.62, c >= 0 ? "#8a5200" : "#9a6200");
    g.strokeStyle = "rgba(60,64,80,0.7)";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    g.stroke();
    // Glanz
    g.fillStyle = "rgba(255,255,255,0.7)";
    g.beginPath();
    g.ellipse(-r * 0.4, -r * 0.45, r * 0.12, r * 0.24, -0.6, 0, TAU);
    g.fill();
  });
}

export function makeAssets(k = 1): FaAssets {
  const coin = makeCoinStrip(k);
  const budget: BakeBudget = { n: 0, off: false };
  return {
    props: null,
    budget,
    glow: new GlowCache(budget),
    coin,
    coinSize: coin.height,
    glowRed: glowSprite("#ff2a44", 0.2),
    glowWarm: glowSprite("#ffbe6a", 0.2),
    glowWhite: glowSprite("#e8f2ff", 0.2),
    glowCyan: glowSprite("#4fd8ff", 0.2),
    glowAmber: glowSprite("#ff9a2a", 0.2),
    glowGreen: glowSprite("#39ff9a", 0.2),
    softRed: softSprite("rgba(255,40,60,1)"),
    softWarm: softSprite("rgba(255,190,110,1)"),
    softCyan: softSprite("rgba(90,200,255,1)"),
    softGold: softSprite("rgba(255,210,90,1)"),
    cache: new SpriteCache(90, budget),
    pcache: new SpriteCache(40, budget),
  };
}

export function drawCoin(g: Ctx2D, K: SkinCtx, e: Ent, sx: number, sy: number, glow = true): void {
  const A = K.A;
  const f = Math.floor((K.time * 10 + e.id * 1.7) % 12);
  const cx = sx + e.w / 2;
  const cy = sy + e.h / 2 + (K.reduced ? 0 : Math.sin(K.time * 3 + e.id) * 2);
  const s = COIN_PX;
  const ss = A.coinSize;
  if (glow && K.quality > 0) {
    const op = g.globalCompositeOperation;
    const pa = g.globalAlpha;
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = pa * 0.32;
    blitC(g, A.glow.get("rgba(255,210,90,1)", 36, 36), cx, cy);
    g.globalAlpha = pa;
    g.globalCompositeOperation = op;
  }
  g.drawImage(A.coin, f * ss, 0, ss, ss, Math.round(cx - s / 2), Math.round(cy - s / 2), s, s);
}

// =================================================================================================
// Riesenstempel (Zone „stamp“)

function ease(u: number): number {
  const c = Math.max(0, Math.min(1, u));
  return c * c * (3 - 2 * c);
}

/** Stempelkörper mit Unterkante bei `bottom` (Bildschirm), Breite w, zentriert bei cx */
function stampBody(g: Ctx2D, cx: number, bottom: number, w: number, squash: number): void {
  const bw = w * (1 + squash * 0.08);
  const x0 = cx - bw / 2;
  // Gummiplatte (Stempelfarbe)
  g.fillStyle = "#c0141f";
  g.fillRect(x0 + 4, bottom - 9, bw - 8, 9);
  g.fillStyle = "rgba(255,120,120,0.5)";
  g.fillRect(x0 + 4, bottom - 9, bw - 8, 2);
  // Grundplatte
  const plate = g.createLinearGradient(0, bottom - 46, 0, bottom - 9);
  plate.addColorStop(0, "#3a3f4c");
  plate.addColorStop(0.4, "#23262f");
  plate.addColorStop(1, "#15171d");
  g.fillStyle = plate;
  g.beginPath();
  rr(g, x0, bottom - 46, bw, 38, 5);
  g.fill();
  g.fillStyle = "#9aa3b6";
  g.fillRect(x0 + 6, bottom - 40, bw - 12, 4);
  g.fillStyle = "rgba(255,255,255,0.35)";
  g.fillRect(x0 + 6, bottom - 40, bw - 12, 1);
  // Schild „GENEHMIGT“-Plakette (Andeutung)
  g.fillStyle = "#d8cfb8";
  g.fillRect(cx - 22, bottom - 31, 44, 12);
  g.fillStyle = "#8a1a20";
  g.fillRect(cx - 17, bottom - 27, 34, 2);
  g.fillRect(cx - 12, bottom - 23, 24, 2);
  // Hals
  const neck = g.createLinearGradient(cx - 18, 0, cx + 18, 0);
  neck.addColorStop(0, "#5a1016");
  neck.addColorStop(0.4, "#9e1a24");
  neck.addColorStop(1, "#4a0c12");
  g.fillStyle = neck;
  g.fillRect(cx - 17, bottom - 74, 34, 30);
  // Griffknauf
  const knob = g.createRadialGradient(cx - 14, bottom - 108, 4, cx, bottom - 96, 48);
  knob.addColorStop(0, "#ff6a6a");
  knob.addColorStop(0.35, "#d8202c");
  knob.addColorStop(1, "#6a0a12");
  g.fillStyle = knob;
  g.beginPath();
  g.ellipse(cx, bottom - 96, 44, 30, 0, 0, TAU);
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.55)";
  g.beginPath();
  g.ellipse(cx - 16, bottom - 110, 12, 6, -0.4, 0, TAU);
  g.fill();
  // Konturen (Comic-Look passend zu den Props)
  g.strokeStyle = "#140608";
  g.lineWidth = 2.5;
  g.beginPath();
  g.ellipse(cx, bottom - 96, 44, 30, 0, 0, TAU);
  g.stroke();
  g.beginPath();
  rr(g, x0, bottom - 46, bw, 38, 5);
  g.stroke();
}

export function drawStamp(g: Ctx2D, K: SkinCtx, e: Ent, sx: number, v: ViewState): void {
  const gy = v.groundY;
  const cx = sx + e.w / 2;
  const ph = e.fx.phaseT ?? 0;
  const park = STAMP_PARK_Y;
  const hover = gy - 150;
  let bottom = park;
  let shadow = 0;
  let squash = 0;
  let shake = 0;
  if (e.state === "warn") {
    bottom = park + (hover - park) * ease(ph / 0.7);
    if (ph > 0.78) bottom -= Math.sin(((ph - 0.78) / 0.22) * (Math.PI / 2)) * 26;
    shadow = 0.3 + 0.7 * ph;
    if (!K.reduced && ph > 0.45) shake = Math.sin(K.time * 70) * 2.2 * (ph - 0.45);
  } else if (e.state === "active") {
    bottom = gy;
    shadow = 1;
    squash = Math.max(0, 1 - e.stateT / 0.12);
  } else if (e.fx.slammed) {
    const u = Math.min(1, e.stateT / 0.55);
    bottom = gy - (gy - park) * u * u;
    shadow = (1 - u) * 0.4;
  }
  const bx = cx + shake;
  const pa = g.globalAlpha;
  // Bodenschatten / Zielmarkierung
  if (shadow > 0.01) {
    const k = shadow;
    const pulse = K.reduced ? 1 : 0.75 + 0.25 * Math.sin(K.time * (10 + 18 * k));
    g.globalAlpha = pa * (0.25 + 0.5 * k) * pulse;
    g.fillStyle = "#ff1f35";
    g.beginPath();
    g.ellipse(cx, gy + 3, e.w * (0.35 + 0.3 * k), 7 + 5 * k, 0, 0, TAU);
    g.fill();
    g.globalAlpha = pa * (0.5 + 0.5 * k);
    g.strokeStyle = "#ff5a6a";
    g.lineWidth = 2.5;
    g.setLineDash([9, 7]);
    g.lineDashOffset = K.reduced ? 0 : -K.time * 50;
    g.beginPath();
    g.ellipse(cx, gy + 3, e.w * 0.62, 13, 0, 0, TAU);
    g.stroke();
    g.setLineDash([]);
    // Zielstrahl von oben
    if (e.state === "warn") {
      const op = g.globalCompositeOperation;
      g.globalCompositeOperation = "lighter";
      const beam = g.createLinearGradient(0, bottom, 0, gy);
      beam.addColorStop(0, "rgba(255,40,60,0)");
      beam.addColorStop(1, `rgba(255,40,60,${(0.28 * k * pulse).toFixed(3)})`);
      g.globalAlpha = pa;
      g.fillStyle = beam;
      g.fillRect(cx - e.w * 0.4, bottom, e.w * 0.8, gy - bottom);
      g.globalCompositeOperation = op;
    }
    g.globalAlpha = pa;
  }
  // Kolbenstange + Gehäuse an der Decke
  const rodTop = 58;
  const rodBot = bottom - 120;
  if (rodBot > rodTop) {
    const rod = g.createLinearGradient(bx - 8, 0, bx + 8, 0);
    rod.addColorStop(0, "#5a6272");
    rod.addColorStop(0.35, "#e2e8f2");
    rod.addColorStop(1, "#4a505c");
    g.fillStyle = rod;
    g.fillRect(bx - 7, rodTop, 14, rodBot - rodTop + 6);
  }
  g.fillStyle = "#1b2130";
  g.beginPath();
  rr(g, cx - 34, -4, 68, 64, 6);
  g.fill();
  g.fillStyle = "#2e3648";
  g.fillRect(cx - 26, 8, 52, 40);
  // Warnstreifen am Gehäuse
  for (let i = 0; i < 6; i += 1) {
    g.fillStyle = i % 2 === 0 ? "#d9a520" : "#141414";
    g.fillRect(cx - 34 + i * 11.33, 54, 11.4, 7);
  }
  // Warnlampe
  const lampOn = e.state === "warn" ? (K.reduced ? 1 : Math.sin(K.time * 18) > 0 ? 1 : 0.3) : e.state === "active" ? 1 : 0.15;
  g.fillStyle = lampOn > 0.5 ? "#ff3044" : "#5a1016";
  g.beginPath();
  g.arc(cx + 22, 20, 5, 0, TAU);
  g.fill();
  if (lampOn > 0.5) {
    const op = g.globalCompositeOperation;
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = pa * 0.8 * lampOn;
    glowAt(g, K.A.glowRed, cx + 22, 20, 22);
    g.globalAlpha = pa;
    g.globalCompositeOperation = op;
  }
  // Körper
  stampBody(g, bx, bottom, e.w, squash);
  // Rim-Light (Kontur von hinten oben)
  g.strokeStyle = RIM;
  g.lineWidth = 1.5;
  g.globalAlpha = pa * 0.8;
  g.beginPath();
  g.ellipse(bx, bottom - 96, 46, 32, 0, Math.PI * 1.05, Math.PI * 1.95);
  g.stroke();
  g.globalAlpha = pa;
  // Aufprall
  if (e.state === "active" && e.stateT < 0.3) {
    const u = e.stateT / 0.3;
    const op = g.globalCompositeOperation;
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = pa * (1 - u) * 0.9;
    g.strokeStyle = "#ffe0e0";
    g.lineWidth = 4 * (1 - u) + 1;
    g.beginPath();
    g.ellipse(cx, gy + 2, e.w * (0.6 + u * 1.2), 10 + u * 12, 0, 0, TAU);
    g.stroke();
    blitC(g, K.A.glow.get("rgba(255,40,60,1)", 90, 30), cx, gy);
    g.globalAlpha = pa;
    g.globalCompositeOperation = op;
  }
}

/** Stempelabdruck am Boden (roter Rahmen + „Schrift“-Balken) */
export function drawImprint(g: Ctx2D, x: number, gy: number, a: number): void {
  g.globalAlpha = a;
  g.strokeStyle = "#b8141e";
  g.lineWidth = 3;
  g.beginPath();
  g.ellipse(x, gy + 22, 54, 12, 0, 0, TAU);
  g.stroke();
  g.fillStyle = "#b8141e";
  g.fillRect(x - 34, gy + 18, 68, 3);
  g.fillRect(x - 24, gy + 24, 48, 3);
  g.globalAlpha = 1;
}

// =================================================================================================
// Laser

function laserLines(g: Ctx2D, path: () => void, k: number, shimmer: number): void {
  const op = g.globalCompositeOperation;
  const pa = g.globalAlpha;
  g.globalCompositeOperation = "lighter";
  g.lineCap = "round";
  g.strokeStyle = `rgba(255,30,60,${(0.22 * k).toFixed(3)})`;
  g.lineWidth = 12;
  g.beginPath();
  path();
  g.stroke();
  g.strokeStyle = `rgba(255,50,80,${(0.75 * k * shimmer).toFixed(3)})`;
  g.lineWidth = 4;
  g.beginPath();
  path();
  g.stroke();
  g.strokeStyle = `rgba(255,235,240,${(0.95 * k).toFixed(3)})`;
  g.lineWidth = 1.4;
  g.beginPath();
  path();
  g.stroke();
  g.globalCompositeOperation = op;
  g.globalAlpha = pa;
}

function stateLevel(e: Ent, K: SkinCtx): { on: number; warn: number } {
  const ph = e.fx.phaseT ?? 0;
  if (e.state === "active") return { on: 1, warn: 0 };
  if (e.state === "warn") {
    const blink = K.reduced ? 0.6 : Math.sin(K.time * (16 + ph * 30)) > -0.2 ? 1 : 0.25;
    return { on: 0, warn: (0.35 + 0.65 * ph) * blink };
  }
  return { on: 0, warn: 0 };
}

function ledColor(e: Ent): string {
  return e.state === "active" ? "#ff2a44" : e.state === "warn" ? "#ffb02a" : "#2aff8a";
}

function emitterPost(g: Ctx2D, x: number, top: number, bottom: number, e: Ent, K: SkinCtx): void {
  g.fillStyle = "#2a3140";
  g.beginPath();
  rr(g, x, top, 12, bottom - top, 3);
  g.fill();
  g.fillStyle = "rgba(190,215,255,0.35)";
  g.fillRect(x, top + 3, 2, bottom - top - 6);
  g.fillStyle = "#141820";
  g.fillRect(x - 2, top - 6, 16, 7);
  const col = ledColor(e);
  g.fillStyle = col;
  g.fillRect(x + 3, top - 4, 6, 3);
  const pa = g.globalAlpha;
  const op = g.globalCompositeOperation;
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = pa * 0.7;
  glowAt(g, e.state === "active" ? K.A.glowRed : e.state === "warn" ? K.A.glowAmber : K.A.glowGreen, x + 6, top - 3, 10);
  g.globalAlpha = pa;
  g.globalCompositeOperation = op;
}

const LOW_BEAMS = [20, 46, 72];

export function drawLaserLow(g: Ctx2D, K: SkinCtx, e: Ent, sx: number, v: ViewState): void {
  const gy = v.groundY;
  const xa = sx + 10;
  const xb = sx + e.w - 10;
  // Schwelle mit Warnstreifen
  g.fillStyle = "#1a1e26";
  g.fillRect(sx - 4, gy - 7, e.w + 8, 9);
  g.save();
  g.beginPath();
  g.rect(sx - 4, gy - 6, e.w + 8, 6);
  g.clip();
  for (let x = sx - 16; x < sx + e.w + 8; x += 14) {
    g.fillStyle = "#d9a520";
    g.beginPath();
    g.moveTo(x, gy);
    g.lineTo(x + 6, gy - 6);
    g.lineTo(x + 13, gy - 6);
    g.lineTo(x + 7, gy);
    g.closePath();
    g.fill();
  }
  g.restore();
  const { on, warn } = stateLevel(e, K);
  const shimmer = K.reduced ? 1 : 0.8 + 0.2 * Math.sin(K.time * 47 + e.id);
  const path = (): void => {
    for (const hh of LOW_BEAMS) {
      g.moveTo(xa, gy - hh);
      g.lineTo(xb, gy - hh);
    }
  };
  if (on > 0) {
    laserLines(g, path, on, shimmer);
    // Glühen am Boden
    const pa = g.globalAlpha;
    const op = g.globalCompositeOperation;
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = pa * 0.5;
    blitC(g, K.A.glow.get("rgba(255,40,60,1)", e.w * 0.9, 60), sx + e.w / 2, gy - 40);
    g.globalAlpha = pa;
    g.globalCompositeOperation = op;
  } else if (warn > 0) {
    g.setLineDash([6, 6]);
    g.lineDashOffset = K.reduced ? 0 : -K.time * 80;
    g.strokeStyle = `rgba(255,90,100,${(0.75 * warn).toFixed(3)})`;
    g.lineWidth = 2;
    g.beginPath();
    path();
    g.stroke();
    g.setLineDash([]);
  } else {
    g.setLineDash([2, 7]);
    g.strokeStyle = "rgba(255,110,120,0.3)";
    g.lineWidth = 1.5;
    g.beginPath();
    path();
    g.stroke();
    g.setLineDash([]);
  }
  emitterPost(g, sx - 2, gy - 92, gy - 4, e, K);
  emitterPost(g, sx + e.w - 10, gy - 92, gy - 4, e, K);
  // Linsen
  for (const hh of LOW_BEAMS) {
    g.fillStyle = on > 0 ? "#ffd0d8" : warn > 0 ? "#ff8a90" : "#6a1a22";
    g.fillRect(sx + 7, gy - hh - 2, 4, 4);
    g.fillRect(sx + e.w - 11, gy - hh - 2, 4, 4);
  }
}

export function drawLaserHigh(g: Ctx2D, K: SkinCtx, e: Ent, sx: number, sy: number, v: ViewState): void {
  const bottom = sy + e.h;
  const x0 = sx + 6;
  const x1 = sx + e.w - 6;
  const { on, warn } = stateLevel(e, K);
  const shimmer = K.reduced ? 1 : 0.8 + 0.2 * Math.sin(K.time * 43 + e.id);
  const nV = Math.max(3, Math.round((x1 - x0) / 20));
  const path = (): void => {
    for (let i = 0; i <= nV; i += 1) {
      const x = x0 + ((x1 - x0) * i) / nV;
      g.moveTo(x, sy + 4);
      g.lineTo(x, bottom);
    }
    for (let y = sy + 70; y < bottom - 20; y += 70) {
      g.moveTo(x0, y);
      g.lineTo(x1, y);
    }
    g.moveTo(x0 - 4, bottom);
    g.lineTo(x1 + 4, bottom);
  };
  if (on > 0) {
    laserLines(g, path, on, shimmer);
    const pa = g.globalAlpha;
    const op = g.globalCompositeOperation;
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = pa * 0.55;
    blitC(g, K.A.glow.get("rgba(255,40,60,1)", e.w * 0.9, 50), sx + e.w / 2, bottom - 20);
    // Funken an der Unterkante
    if (!K.reduced && K.quality > 0) {
      g.fillStyle = "rgba(255,210,210,0.9)";
      for (let i = 0; i < 6; i += 1) {
        const s = Math.floor(K.time * 20) + i * 13 + e.id;
        g.fillRect(x0 + h1(s) * (x1 - x0), bottom + h1(s + 3) * 10, 2, 2);
      }
    }
    g.globalAlpha = pa;
    g.globalCompositeOperation = op;
  } else if (warn > 0) {
    g.setLineDash([8, 8]);
    g.lineDashOffset = K.reduced ? 0 : K.time * 90;
    g.strokeStyle = `rgba(255,90,100,${(0.7 * warn).toFixed(3)})`;
    g.lineWidth = 2;
    g.beginPath();
    path();
    g.stroke();
    g.setLineDash([]);
  } else {
    // Geister-Umriss: Unterkante deutlich (zeigt: drunter durchrutschen)
    g.setLineDash([3, 8]);
    g.strokeStyle = "rgba(255,110,120,0.22)";
    g.lineWidth = 1.2;
    g.beginPath();
    for (let i = 0; i <= nV; i += 1) {
      const x = x0 + ((x1 - x0) * i) / nV;
      g.moveTo(x, sy + 4);
      g.lineTo(x, bottom);
    }
    g.stroke();
    g.strokeStyle = "rgba(255,120,130,0.6)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x0 - 4, bottom);
    g.lineTo(x1 + 4, bottom);
    g.stroke();
    g.setLineDash([]);
  }
  // Emitter-Schiene unter der Decke
  g.fillStyle = "#1c222e";
  g.beginPath();
  rr(g, sx - 10, sy - 24, e.w + 20, 26, 5);
  g.fill();
  g.fillStyle = "rgba(190,215,255,0.3)";
  g.fillRect(sx - 8, sy - 23, e.w + 16, 1.5);
  g.strokeStyle = "rgba(90,100,120,0.8)";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(sx + 8, 0);
  g.lineTo(sx + 8, sy - 24);
  g.moveTo(sx + e.w - 8, 0);
  g.lineTo(sx + e.w - 8, sy - 24);
  g.stroke();
  const lens = on > 0 ? "#ffd0d8" : warn > 0 ? "#ff8a90" : "#5a1a22";
  g.fillStyle = lens;
  for (let i = 0; i <= nV; i += 1) {
    const x = x0 + ((x1 - x0) * i) / nV;
    g.fillRect(x - 2, sy - 3, 4, 4);
  }
  const col = ledColor(e);
  g.fillStyle = col;
  g.fillRect(sx + e.w / 2 - 4, sy - 18, 8, 4);
  // Bodenmarkierung: Rutsch-Pfeile
  const gy = v.groundY;
  g.fillStyle = on > 0 || warn > 0 ? "rgba(255,90,100,0.55)" : "rgba(255,120,130,0.25)";
  for (let i = 0; i < 2; i += 1) {
    const mx = sx + e.w / 2 - 12 + i * 16;
    g.beginPath();
    g.moveTo(mx, gy + 6);
    g.lineTo(mx + 10, gy + 11);
    g.lineTo(mx, gy + 16);
    g.closePath();
    g.fill();
  }
}

// =================================================================================================
// Statische Hindernisse (vorgerendert)

const PAD = 6;

function outline(g: Ctx2D, w = 2.2): void {
  g.strokeStyle = "#0c0e14";
  g.lineWidth = w;
  g.stroke();
}

function paintPaperStack(g: Ctx2D, w: number, h: number, seed: number): void {
  let y = h;
  let i = 0;
  while (y > 2) {
    const bh = Math.min(y, 11 + Math.floor(h1(seed + i) * 7));
    const off = (h1(seed + i * 3.1) - 0.5) * 8;
    const x = PAD + off;
    const top = PAD + y - bh;
    const folder = h1(seed + i * 7.7);
    g.fillStyle = folder < 0.2 ? "#d9b56a" : folder < 0.3 ? "#5a86c4" : folder < 0.36 ? "#c45a5a" : "#ece7d8";
    g.beginPath();
    g.rect(x, top, w, bh);
    g.fill();
    outline(g, 1.8);
    g.fillStyle = "rgba(90,80,70,0.35)";
    for (let yy = top + 3; yy < top + bh - 1; yy += 3) g.fillRect(x + 2, yy, w - 4, 0.8);
    g.fillStyle = "rgba(255,255,255,0.7)";
    g.fillRect(x + 1, top + 1, w - 2, 1.5);
    y -= bh;
    i += 1;
  }
  // Schnur
  g.fillStyle = "#a01a22";
  g.fillRect(PAD + w * 0.42, PAD, 3, h);
  // Aktenzeichen-Zettel
  g.fillStyle = "#fffbe8";
  g.fillRect(PAD + w * 0.18, PAD + h * 0.35, w * 0.3, h * 0.18);
  g.strokeStyle = "#0c0e14";
  g.lineWidth = 1;
  g.strokeRect(PAD + w * 0.18, PAD + h * 0.35, w * 0.3, h * 0.18);
}

function paintBinders(g: Ctx2D, w: number, h: number, seed: number): void {
  let x = PAD;
  let i = 0;
  const cols = ["#3a64b0", "#b83a3a", "#2f8a5c", "#d6b44a", "#6a4fa8", "#e0dccf"];
  while (x < PAD + w - 6) {
    const bw = Math.min(PAD + w - x, 16 + Math.floor(h1(seed + i) * 6));
    const bh = h - Math.floor(h1(seed + i * 2.3) * 6);
    const top = PAD + h - bh;
    g.fillStyle = cols[Math.floor(h1(seed + i * 5.1) * cols.length)];
    g.beginPath();
    g.rect(x, top, bw - 1, bh);
    g.fill();
    outline(g, 1.8);
    g.fillStyle = "rgba(255,255,255,0.25)";
    g.fillRect(x + 1, top + 1, 2, bh - 2);
    g.fillStyle = "#f4f0e2";
    g.fillRect(x + 3, top + 6, bw - 7, Math.min(16, bh * 0.3));
    g.fillStyle = "#0c0e14";
    g.beginPath();
    g.arc(x + bw / 2, top + bh * 0.72, 3, 0, TAU);
    g.fill();
    x += bw;
    i += 1;
  }
}

function paintBoxes(g: Ctx2D, w: number, h: number, seed: number): void {
  const n = h > 90 ? 2 : 1;
  const bh = h / n;
  for (let i = 0; i < n; i += 1) {
    const inset = i === n - 1 && n > 1 ? 6 + h1(seed) * 6 : 0;
    const x = PAD + inset;
    const y = PAD + h - (i + 1) * bh;
    const bw = w - inset * 2;
    const grd = g.createLinearGradient(0, y, 0, y + bh);
    grd.addColorStop(0, "#c49a60");
    grd.addColorStop(1, "#8e6a3c");
    g.fillStyle = grd;
    g.beginPath();
    g.rect(x, y, bw, bh);
    g.fill();
    outline(g);
    g.fillStyle = "rgba(255,240,210,0.35)";
    g.fillRect(x + 2, y + 2, bw - 4, 3);
    g.fillStyle = "rgba(230,210,160,0.55)";
    g.fillRect(x + bw * 0.44, y, bw * 0.12, bh);
    // Etikett
    g.fillStyle = "#f7f3e6";
    g.fillRect(x + bw * 0.12, y + bh * 0.3, bw * 0.28, bh * 0.28);
    g.strokeStyle = "#0c0e14";
    g.lineWidth = 1;
    g.strokeRect(x + bw * 0.12, y + bh * 0.3, bw * 0.28, bh * 0.28);
    g.fillStyle = "#333";
    g.fillRect(x + bw * 0.15, y + bh * 0.38, bw * 0.2, 1.5);
    g.fillRect(x + bw * 0.15, y + bh * 0.46, bw * 0.14, 1.5);
    // Griffloch
    g.fillStyle = "#2a1a0c";
    g.beginPath();
    g.ellipse(x + bw * 0.72, y + bh * 0.4, bw * 0.08, 3, 0, 0, TAU);
    g.fill();
  }
}

function paintCopier(g: Ctx2D, w: number, h: number): void {
  const x = PAD;
  const y = PAD;
  // Papierfach links
  g.fillStyle = "#e9e4d6";
  g.beginPath();
  g.rect(x - 2, y + h * 0.5, 18, 10);
  g.fill();
  outline(g, 1.5);
  const body = g.createLinearGradient(0, y, 0, y + h);
  body.addColorStop(0, "#d6dae2");
  body.addColorStop(1, "#8a909c");
  g.fillStyle = body;
  g.beginPath();
  rr(g, x + 8, y + 18, w - 8, h - 18, 6);
  g.fill();
  outline(g);
  // Deckel + Bedienfeld
  g.fillStyle = "#4a5060";
  g.beginPath();
  rr(g, x + 4, y + 6, w - 20, 14, 3);
  g.fill();
  outline(g, 1.8);
  g.fillStyle = "#2c3140";
  g.beginPath();
  rr(g, x + w - 44, y, 40, 20, 3);
  g.fill();
  outline(g, 1.8);
  g.fillStyle = "#6fd0ff";
  g.fillRect(x + w - 38, y + 5, 18, 9);
  g.fillStyle = "#39ff8a";
  g.fillRect(x + w - 15, y + 7, 5, 5);
  // Schubladen
  g.strokeStyle = "rgba(40,44,56,0.8)";
  g.lineWidth = 1.5;
  for (let i = 0; i < 3; i += 1) g.strokeRect(x + 16, y + 34 + i * ((h - 40) / 3), w - 24, (h - 44) / 3);
  g.fillStyle = "#3a4050";
  for (let i = 0; i < 3; i += 1) g.fillRect(x + w / 2 - 10, y + 40 + i * ((h - 40) / 3), 20, 3);
  // Ausgabefach mit Kopien
  g.fillStyle = "#f4f0e2";
  g.fillRect(x + w - 6, y + 26, 14, 4);
  g.fillRect(x + w - 4, y + 22, 12, 4);
}

function paintCart(g: Ctx2D, w: number, h: number, seed: number): void {
  const x = PAD;
  const y = PAD;
  // Ständer
  g.fillStyle = "#3c4456";
  g.fillRect(x + 4, y + 4, 7, h - 14);
  g.fillRect(x + w - 11, y + 4, 7, h - 14);
  // Obere Wanne (begehbar)
  const tray = g.createLinearGradient(0, y, 0, y + 16);
  tray.addColorStop(0, "#9aa6ba");
  tray.addColorStop(1, "#5a6478");
  g.fillStyle = tray;
  g.beginPath();
  rr(g, x, y, w, 14, 3);
  g.fill();
  outline(g);
  // Ordner in der oberen Etage
  const cols = ["#3a64b0", "#b83a3a", "#2f8a5c", "#d6b44a", "#e0dccf"];
  for (let i = 0; i < 6; i += 1) {
    const bx = x + 14 + i * ((w - 28) / 6);
    g.fillStyle = cols[Math.floor(h1(seed + i) * cols.length)];
    g.fillRect(bx, y + 16, (w - 28) / 6 - 2, 40);
    g.fillStyle = "#f4f0e2";
    g.fillRect(bx + 3, y + 22, (w - 28) / 6 - 8, 8);
  }
  // Mittlere Ablage
  g.fillStyle = "#5a6478";
  g.beginPath();
  g.rect(x + 2, y + 56, w - 4, 7);
  g.fill();
  outline(g, 1.6);
  // Kartons unten
  for (let i = 0; i < 2; i += 1) {
    const bx = x + 12 + i * ((w - 24) / 2);
    const bw = (w - 24) / 2 - 4;
    g.fillStyle = "#b08a58";
    g.beginPath();
    g.rect(bx, y + 66, bw, h - 90);
    g.fill();
    outline(g, 1.6);
    g.fillStyle = "#f4f0e2";
    g.fillRect(bx + bw * 0.25, y + 74, bw * 0.5, 9);
  }
  g.fillStyle = "#5a6478";
  g.fillRect(x + 2, y + h - 22, w - 4, 6);
  // Rollen
  for (const wx of [x + 14, x + w - 14]) {
    g.fillStyle = "#15181f";
    g.beginPath();
    g.arc(wx, y + h - 7, 7, 0, TAU);
    g.fill();
    g.fillStyle = "#6a7488";
    g.beginPath();
    g.arc(wx, y + h - 7, 2.5, 0, TAU);
    g.fill();
  }
  // Schiebegriff rechts
  g.strokeStyle = "#2a303c";
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(x + w - 8, y + 4);
  g.lineTo(x + w + 2, y - 2);
  g.stroke();
}

function paintBoxTower(g: Ctx2D, w: number, h: number, seed: number): void {
  // Kartonstapel als Insel im Schredder (reicht bis in die Tiefe)
  let y = PAD;
  let i = 0;
  while (y < PAD + h) {
    const bh = 44 + Math.floor(h1(seed + i) * 14);
    const inset = i === 0 ? 0 : (h1(seed + i * 3) - 0.5) * 10;
    const bx = PAD + 4 + inset;
    const bw = w - 8;
    const grd = g.createLinearGradient(0, y, 0, y + bh);
    grd.addColorStop(0, "#c49a60");
    grd.addColorStop(1, "#7e5c32");
    g.fillStyle = grd;
    g.beginPath();
    g.rect(bx, y, bw, bh);
    g.fill();
    outline(g, 1.8);
    g.fillStyle = "rgba(230,210,160,0.5)";
    g.fillRect(bx + bw * 0.46, y, bw * 0.08, bh);
    g.fillStyle = "#f7f3e6";
    g.fillRect(bx + bw * 0.14, y + bh * 0.3, bw * 0.24, bh * 0.3);
    y += bh;
    i += 1;
  }
  // Oberseite (Lauffläche)
  g.fillStyle = "#e0bd84";
  g.fillRect(PAD, PAD, w, 5);
  g.fillStyle = "rgba(255,245,220,0.6)";
  g.fillRect(PAD, PAD, w, 1.5);
  // nach unten ins Dunkel
  const fade = g.createLinearGradient(0, PAD + 60, 0, PAD + h);
  fade.addColorStop(0, "rgba(5,7,12,0)");
  fade.addColorStop(1, "rgba(5,7,12,0.92)");
  g.fillStyle = fade;
  g.fillRect(0, PAD + 60, w + PAD * 2, h - 60 + PAD);
}

function paintPlane(g: Ctx2D, w: number, h: number): void {
  const x = PAD;
  const y = PAD;
  g.fillStyle = "#f6f4ee";
  g.beginPath();
  g.moveTo(x, y + h * 0.55);
  g.lineTo(x + w, y);
  g.lineTo(x + w * 0.78, y + h);
  g.closePath();
  g.fill();
  outline(g, 1.8);
  g.fillStyle = "#cfcac0";
  g.beginPath();
  g.moveTo(x, y + h * 0.55);
  g.lineTo(x + w * 0.78, y + h);
  g.lineTo(x + w * 0.62, y + h * 0.62);
  g.closePath();
  g.fill();
  outline(g, 1.4);
  g.strokeStyle = "rgba(120,110,100,0.7)";
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x + 4, y + h * 0.55);
  g.lineTo(x + w - 4, y + 2);
  g.stroke();
}

function paintFileRack(g: Ctx2D, w: number, seed: number): void {
  // Hängeregister: Schiene + hängende Mappen, 120 px hoch (Unterkante = unten)
  const H = 120;
  g.fillStyle = "#3a4254";
  g.beginPath();
  rr(g, PAD, PAD, w, 12, 3);
  g.fill();
  outline(g, 1.8);
  g.fillStyle = "rgba(200,220,255,0.4)";
  g.fillRect(PAD + 2, PAD + 1, w - 4, 1.5);
  const cols = ["#6a8a4a", "#c9a45a", "#5a7aa8", "#b86a4a", "#8a8a7a"];
  let x = PAD + 4;
  let i = 0;
  while (x < PAD + w - 12) {
    const fw = 14 + Math.floor(h1(seed + i) * 8);
    const fh = H - 26 - Math.floor(h1(seed + i * 2.7) * 22);
    g.fillStyle = cols[Math.floor(h1(seed + i * 4.3) * cols.length)];
    g.beginPath();
    g.moveTo(x, PAD + 12);
    g.lineTo(x + fw, PAD + 12);
    g.lineTo(x + fw - 2, PAD + 12 + fh);
    g.lineTo(x + 2, PAD + 12 + fh);
    g.closePath();
    g.fill();
    outline(g, 1.4);
    // Papier schaut heraus
    if (h1(seed + i * 9) < 0.5) {
      g.fillStyle = "#f4f0e2";
      g.fillRect(x + 3, PAD + 12 + fh - 6, fw - 6, 9);
    }
    x += fw - 3;
    i += 1;
  }
  // Warnkante unten
  g.fillStyle = "#d9a520";
  g.fillRect(PAD, PAD + H - 6, w, 4);
}

function paintDuct(g: Ctx2D, w: number): void {
  const H = 76;
  const grd = g.createLinearGradient(0, PAD, 0, PAD + H);
  grd.addColorStop(0, "#8a93a4");
  grd.addColorStop(0.35, "#d0d6e0");
  grd.addColorStop(1, "#5a6272");
  g.fillStyle = grd;
  g.beginPath();
  rr(g, PAD, PAD, w, H, 20);
  g.fill();
  outline(g);
  g.strokeStyle = "rgba(40,46,58,0.6)";
  g.lineWidth = 1.5;
  for (let x = PAD + 40; x < PAD + w - 20; x += 48) {
    g.beginPath();
    g.moveTo(x, PAD + 2);
    g.lineTo(x, PAD + H - 2);
    g.stroke();
  }
  // Lüftungsgitter
  g.fillStyle = "#2a303c";
  g.fillRect(PAD + w * 0.4, PAD + H * 0.45, w * 0.2, H * 0.36);
  g.fillStyle = "#5a6272";
  for (let y = PAD + H * 0.5; y < PAD + H * 0.78; y += 5) g.fillRect(PAD + w * 0.42, y, w * 0.16, 2);
  // Warnkante unten
  g.fillStyle = "#d9a520";
  g.fillRect(PAD + 14, PAD + H - 5, w - 28, 3);
}

function paintChairFallback(g: Ctx2D, w: number, h: number): void {
  const cx = PAD + w / 2;
  const by = PAD + h;
  g.fillStyle = "#23304a";
  g.beginPath();
  rr(g, cx - 18, PAD + 4, 44, h * 0.46, 10);
  g.fill();
  outline(g);
  g.beginPath();
  rr(g, cx - 30, PAD + h * 0.48, 58, 14, 6);
  g.fill();
  outline(g);
  g.fillStyle = "#2a2f3a";
  g.fillRect(cx - 3, PAD + h * 0.6, 6, h * 0.26);
  g.strokeStyle = "#2a2f3a";
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(cx - 30, by - 8);
  g.lineTo(cx + 30, by - 8);
  g.stroke();
  g.fillStyle = "#101318";
  for (const wx of [cx - 30, cx, cx + 30]) {
    g.beginPath();
    g.arc(wx, by - 5, 5, 0, TAU);
    g.fill();
  }
}

function paintBatFallback(g: Ctx2D, w: number, h: number, up: boolean): void {
  const cx = PAD + w / 2;
  const cy = PAD + h / 2;
  g.fillStyle = "#5a3a86";
  g.beginPath();
  g.moveTo(cx, cy);
  g.quadraticCurveTo(cx - w * 0.3, up ? cy - h * 0.7 : cy + h * 0.1, cx - w * 0.5, up ? cy - h * 0.4 : cy + h * 0.35);
  g.quadraticCurveTo(cx - w * 0.25, cy + h * 0.1, cx, cy + 6);
  g.quadraticCurveTo(cx + w * 0.25, cy + h * 0.1, cx + w * 0.5, up ? cy - h * 0.4 : cy + h * 0.35);
  g.quadraticCurveTo(cx + w * 0.3, up ? cy - h * 0.7 : cy + h * 0.1, cx, cy);
  g.fill();
  outline(g, 1.8);
  g.fillStyle = "#7a5aa8";
  g.beginPath();
  g.ellipse(cx, cy + 4, 11, 13, 0, 0, TAU);
  g.fill();
  outline(g, 1.8);
}

// =================================================================================================
// Hindernis-Props (fal.ai-Sprites, dicke Konturen)
//
// Jedes Sprite wird je Zielgröße EINMAL gebacken (zweistufig verkleinert → kein Kantenflimmern, dazu der Rim-Light-Rand
// der übrigen Skins) und pro Frame nur noch geblittet. Hängende Hindernisse (Hängeregistratur, Lüftungskanal) bekommen
// ihre Ketten/Stangen bis zur Decke verlängert: ein Stück der Kette/Stange aus dem Sprite wird periodisch nach oben
// gekachelt und ebenfalls vorgebacken. Fehlt ein Prop (Manifest/Bild nicht ladbar), zeichnet der prozedurale Painter.

const P_BINDERS = "finanzamt-binders";
const P_BOXES = "finanzamt-boxes";
const P_COPIER = "finanzamt-copier";
const P_FILES = "finanzamt-hanging-files";
const P_DUCT = "finanzamt-duct";
const P_LAMP = "finanzamt-lamp";
export const FA_OBSTACLE_PROPS = [P_BINDERS, P_BOXES, P_COPIER, P_FILES, P_DUCT, P_LAMP];

/** Manifest-Zellen sind auf die Alpha-BBox zugeschnitten und haben ringsum 5 px Rand. */
const CELL_PAD = 5;
/** Platz für den Rim-Light-Rand um gebackene Props (logische px) */
const RP = 4;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Ganze Zelle in doppelter Zielauflösung (Zwischenstufe fürs saubere Verkleinern). sx/sy = Gerätepixel je Zellpixel. */
function bigCell(props: PropLibrary, id: string, cell: { w: number; h: number }, sx: number, sy: number): { c: HTMLCanvasElement; fx: number; fy: number } {
  const bw = Math.max(2, Math.round(cell.w * sx));
  const bh = Math.max(2, Math.round(cell.h * sy));
  const c = paint(bw, bh, (bg) => {
    bg.imageSmoothingQuality = "high";
    bg.scale(bw / cell.w, bh / cell.h);
    props.draw(bg, id, 0, 0, { ax: 0, ay: 0 });
  });
  return { c, fx: bw / cell.w, fy: bh / cell.h };
}

/** Zellausschnitt `src` in das logische Rechteck (dx, dy, dw, dh) zeichnen (optional gespiegelt). */
function blitRect(g: Ctx2D, big: { c: HTMLCanvasElement; fx: number; fy: number }, src: Rect, dx: number, dy: number, dw: number, dh: number, flipX = false): void {
  g.save();
  g.imageSmoothingQuality = "high";
  if (flipX) {
    g.translate(dx + dw / 2, 0);
    g.scale(-1, 1);
    g.translate(-(dx + dw / 2), 0);
  }
  g.drawImage(big.c, src.x * big.fx, src.y * big.fy, src.w * big.fx, src.h * big.fy, dx, dy, dw, dh);
  g.restore();
}

/** Bodenhindernisse: Skin → Prop */
const BLOCK_PROP: Record<string, string> = { binders: P_BINDERS, boxes: P_BOXES, copier: P_COPIER };
/** Archivkartons: Ausschnitte des 6er-Stapels (Zellpixel). Kürzere Stapel = untere 2 bzw. 3 Kartons. */
const BOX_CROPS: Rect[] = [
  { x: 25, y: 352, w: 213, h: 155 },
  { x: 25, y: 284, w: 213, h: 223 },
];

/**
 * Bodenhindernis als Prop zeichnen. Die sichtbare Silhouette deckt die Trefferfläche (`e.hb`) mit ~4 px Rand;
 * die Höhe stimmt exakt, die Breite darf leicht gestreckt werden (`tol`). Unterkante 2 px im Boden.
 */
function propBlock(g: Ctx2D, K: SkinCtx, e: Ent, sx: number, sy: number): boolean {
  const props = K.A.props;
  const id = BLOCK_PROP[e.skin];
  if (!props || !id || !props.has(id)) return false;
  const cell = props.cell(id);
  if (!cell) return false;
  const C = K.A.pcache;
  const k = C.k;
  const [hx, hy, hw] = e.hb;
  const targetW = hw + 8;
  const top = hy - 3;
  const H = Math.round(e.h + 2 - top);
  let src: Rect = { x: CELL_PAD, y: CELL_PAD, w: cell.w - CELL_PAD * 2, h: cell.h - CELL_PAD * 2 };
  let variant = 0;
  if (id === P_BOXES) {
    // Ausschnitt mit dem Seitenverhältnis, das der Zielfläche am nächsten kommt
    let best = Infinity;
    BOX_CROPS.forEach((c, i) => {
      const d = Math.abs(Math.log(c.w / c.h / (targetW / H)));
      if (d < best) {
        best = d;
        variant = i;
        src = c;
      }
    });
  }
  const tol = id === P_BINDERS ? 0.14 : 0.16;
  const scY = H / src.h;
  const scX = Math.min(scY * (1 + tol), Math.max(scY / (1 + tol), targetW / src.w));
  const dw = Math.round(src.w * scX);
  const flip = id !== P_COPIER && (e.id & 1) === 1;
  const spr = C.get(`pb|${id}|${dw}|${H}|${variant}|${flip ? 1 : 0}`, dw + RP * 2, H + RP * 2, (cg) => {
    const big = bigCell(props, id, cell, scX * k * 2, scY * k * 2);
    blitRect(cg, big, src, RP, RP, dw, H, flip);
    if (id === P_BOXES) {
      // Schnittkante des abgeschnittenen Stapels als dunkle Kontur schließen
      cg.globalCompositeOperation = "source-atop";
      cg.fillStyle = "#0c0e14";
      cg.fillRect(RP, RP, dw, 1.8);
      cg.globalCompositeOperation = "source-over";
    }
  });
  const x0 = sx + hx + hw / 2 - dw / 2 - RP;
  const y0 = sy + top - RP;
  C.draw(g, spr, x0, y0);
  if (id === P_COPIER && !K.reduced && K.quality > 0) {
    // Scanlicht pulsiert im Glas (das Sprite trägt den grünen Grundschein selbst)
    const u = 0.5 + 0.5 * Math.sin(K.time * 5 + e.id * 1.7);
    const pa = g.globalAlpha;
    const op = g.globalCompositeOperation;
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = pa * (0.18 + 0.32 * u);
    glowAt(g, K.A.glowGreen, x0 + RP + dw * 0.56, y0 + RP + H * 0.33, dw * 0.3, dw * 0.15);
    g.globalAlpha = pa;
    g.globalCompositeOperation = op;
  }
  return true;
}

/** Aufhängung (Kette/Stange), die aus dem Bild nach oben herausläuft */
interface Hanger {
  /** Ausschnitt eines Stücks direkt unter der Körper-Oberkante (Zellpixel); Höhe = Periode */
  src: Rect;
  /** Versatz des Musters je Periode nach oben (Zellpixel; Ketten hängen leicht schräg) */
  dx: number;
}

interface HangSpec {
  id: string;
  /** Körper-Ausschnitt (Zellpixel); Zeile body.y liegt an der Oberkante, wo die Aufhängungen aus dem Bild laufen */
  body: Rect;
  /** Zellspalten, die die Trefferbreite decken sollen */
  span: [number, number];
  /** Zellzeile, die auf die Unterkante der Trefferfläche fällt */
  baseRow: number;
  hangers: Hanger[];
  /** Körper blendet ab Zeile [0] bis [1] nach unten aus (herumfliegender Staub) */
  fade?: [number, number];
}

const HANG_FILES: HangSpec = {
  id: P_FILES,
  body: { x: CELL_PAD, y: 12, w: 630, h: 543 },
  span: [6, 630],
  baseRow: 545,
  hangers: [
    { src: { x: 66, y: 12, w: 76, h: 64 }, dx: 18 },
    { src: { x: 512, y: 12, w: 70, h: 73 }, dx: -4 },
  ],
};

const HANG_DUCT: HangSpec = {
  id: P_DUCT,
  body: { x: CELL_PAD, y: 12, w: 630, h: 549 },
  span: [5, 552],
  baseRow: 420,
  hangers: [
    { src: { x: 106, y: 12, w: 36, h: 21 }, dx: 0 },
    { src: { x: 484, y: 12, w: 34, h: 21 }, dx: 0 },
  ],
  fade: [462, 540],
};

/** Hängendes Hindernis (Hitbox reicht bis zur Decke): Korpus an der Unterkante, Ketten/Stangen bis nach oben verlängert. */
function propHang(g: Ctx2D, K: SkinCtx, e: Ent, sx: number, sy: number, S: HangSpec): boolean {
  const props = K.A.props;
  if (!props || !props.has(S.id)) return false;
  const cell = props.cell(S.id);
  if (!cell) return false;
  const C = K.A.pcache;
  const k = C.k;
  const [hx, hy, hw, hh] = e.hb;
  const wq = Math.ceil((hw + 6) / 8) * 8; // Breite quantisiert → wenige Cache-Einträge
  const ks = wq / (S.span[1] - S.span[0]);
  const b = S.body;
  const bw = Math.round(b.w * ks);
  const bh = Math.round(b.h * ks);
  const body = C.get(`hb|${S.id}|${wq}`, bw + RP * 2, bh + RP, (cg) => {
    const big = bigCell(props, S.id, cell, ks * k * 2, ks * k * 2);
    blitRect(cg, big, b, RP, 0, bw, bh);
    if (S.fade) {
      cg.globalCompositeOperation = "destination-in";
      const grd = cg.createLinearGradient(0, (S.fade[0] - b.y) * ks, 0, (S.fade[1] - b.y) * ks);
      grd.addColorStop(0, "#000");
      grd.addColorStop(1, "rgba(0,0,0,0)");
      cg.fillStyle = grd;
      cg.fillRect(0, 0, bw + RP * 2, bh + RP);
      cg.globalCompositeOperation = "source-over";
    }
  });
  // Lage des Körpers: mittig zur Trefferfläche, Zeile baseRow auf der Unterkante der Trefferfläche
  const X0 = Math.round((sx + hx + hw / 2 - ((S.span[0] + S.span[1]) / 2 - b.x) * ks - RP) * k) / k;
  const Y0 = Math.round((sy + hy + hh - (S.baseRow - b.y) * ks) * k) / k;
  // Ketten/Stangen bis über die Bildoberkante hinaus
  const need = Math.ceil(hy + hh - (S.baseRow - b.y) * ks) + 12;
  S.hangers.forEach((r, i) => {
    const period = r.src.h * ks;
    const n = Math.ceil(need / period) + 1;
    const xs = [r.src.x + r.dx, r.src.x + r.dx * n];
    const minX = Math.min(xs[0], xs[1]);
    const maxX = Math.max(xs[0], xs[1]) + r.src.w;
    const Hs = Math.ceil(n * period * k) / k;
    const Ws = (maxX - minX) * ks + RP * 2;
    const strip = C.get(`hr|${S.id}|${wq}|${i}|${need}`, Ws, Hs, (cg) => {
      const big = bigCell(props, S.id, cell, ks * k * 2, ks * k * 2);
      for (let j = 1; j <= n; j += 1) {
        // etwas überlappen (eine Zeile), damit zwischen den Kacheln keine Naht durchscheint
        blitRect(cg, big, { ...r.src, h: r.src.h + 1 }, RP + (r.src.x + r.dx * j - minX) * ks, Hs - j * period, r.src.w * ks, (r.src.h + 1) * ks);
      }
    });
    C.draw(g, strip, X0 + Math.round((minX - b.x) * ks * k) / k, Y0 - C.lh(strip));
  });
  C.draw(g, body, X0, Y0);
  return true;
}

/** Bankierslampe (Pendel): Sprite ohne Kabel-Stück; Aufhängepunkt = Lampenkappe, Mittelpunkt = Trefferzentrum. */
const LAMP_SRC: Rect = { x: CELL_PAD, y: 132, w: 367, h: 375 };
const LAMP_S = 0.2;
/** Kappe (Kabelansatz) und Lichtöffnung im Zellraster */
const LAMP_CAP = { x: 182, y: 132 };
const LAMP_LIGHT = { x: 265, y: 300 };

/** Backt die Lampe (Rim-Light); Rückgabe null ohne Prop. */
function lampSprite(K: SkinCtx): { spr: HTMLCanvasElement; w: number; h: number } | null {
  const props = K.A.props;
  if (!props || !props.has(P_LAMP)) return null;
  const cell = props.cell(P_LAMP);
  if (!cell) return null;
  const C = K.A.pcache;
  const k = C.k;
  const w = Math.round(LAMP_SRC.w * LAMP_S);
  const h = Math.round(LAMP_SRC.h * LAMP_S);
  const spr = C.get(`lamp|${w}`, w + RP * 2, h + RP * 2, (cg) => {
    blitRect(cg, bigCell(props, P_LAMP, cell, LAMP_S * k * 2, LAMP_S * k * 2), LAMP_SRC, RP, RP, w, h);
  });
  return { spr, w, h };
}

// =================================================================================================
// Öffentliche Zeichenfunktionen

export function drawBlock(g: Ctx2D, K: SkinCtx, e: Ent, sx: number, sy: number): void {
  if (propBlock(g, K, e, sx, sy)) return;
  const C = K.A.cache;
  const w = Math.round(e.w);
  const h = Math.round(e.h);
  const variant = e.id % 5;
  let spr: HTMLCanvasElement;
  switch (e.skin) {
    case "binders":
      spr = C.get(`bi|${w}|${h}|${variant}`, w + PAD * 2, h + PAD * 2, (cg) => paintBinders(cg, w, h, variant * 17));
      break;
    case "boxes":
      spr = C.get(`bo|${w}|${h}|${variant}`, w + PAD * 2, h + PAD * 2, (cg) => paintBoxes(cg, w, h, variant * 13));
      break;
    case "copier":
      spr = C.get(`co|${w}|${h}`, w + PAD * 2 + 12, h + PAD * 2, (cg) => paintCopier(cg, w, h));
      break;
    case "file-cart":
      spr = C.get(`ca|${w}|${h}|${variant}`, w + PAD * 2 + 10, h + PAD * 2 + 6, (cg) => {
        cg.translate(0, 6);
        paintCart(cg, w, h, variant * 7);
      });
      C.draw(g, spr, sx - PAD, sy - PAD - 6);
      return;
    default:
      spr = C.get(`ps|${w}|${h}|${variant}`, w + PAD * 2 + 10, h + PAD * 2, (cg) => paintPaperStack(cg, w, h, variant * 23 + 1));
      break;
  }
  C.draw(g, spr, sx - PAD, sy - PAD);
  if (e.skin === "paper-stack" && e.vx < 0 && !K.reduced) {
    // oberstes Blatt flattert im Fahrtwind
    const t = K.time * 9 + e.id;
    const lift = 6 + Math.sin(t) * 5;
    g.fillStyle = "#f6f2e6";
    g.beginPath();
    g.moveTo(sx + e.w * 0.2, sy + 1);
    g.lineTo(sx + e.w * 0.95, sy - lift);
    g.lineTo(sx + e.w * 0.98, sy + 3);
    g.closePath();
    g.fill();
    g.strokeStyle = "#0c0e14";
    g.lineWidth = 1.2;
    g.stroke();
  }
  if (e.skin === "copier" && !K.reduced && K.quality > 0) {
    // Scanlicht blitzt periodisch durch den Deckelspalt
    const u = (K.time * 0.6 + e.id * 0.37) % 1;
    if (u < 0.25) {
      const pa = g.globalAlpha;
      const op = g.globalCompositeOperation;
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = pa * Math.sin((u / 0.25) * Math.PI) * 0.8;
      glowAt(g, K.A.softCyan, sx + e.w * (0.15 + u * 2.4), sy + 18, 40, 8);
      g.globalAlpha = pa;
      g.globalCompositeOperation = op;
    }
  }
}

export function drawOverhead(g: Ctx2D, K: SkinCtx, e: Ent, sx: number, sy: number): void {
  if (propHang(g, K, e, sx, sy, e.skin === "duct" ? HANG_DUCT : HANG_FILES)) return;
  const w = Math.round(e.w);
  const bottom = sy + e.h;
  const C = K.A.cache;
  if (e.skin === "duct") {
    const spr = C.get(`du|${w}`, w + PAD * 2, 76 + PAD * 2, (cg) => paintDuct(cg, w));
    const top = bottom - 76;
    g.strokeStyle = "#2a303c";
    g.lineWidth = 3;
    g.beginPath();
    for (let x = sx + 30; x < sx + w - 20; x += 110) {
      g.moveTo(x, 0);
      g.lineTo(x, top + 6);
    }
    g.stroke();
    C.draw(g, spr, sx - PAD, top - PAD);
    return;
  }
  const spr = C.get(`hf|${w}|${e.id % 4}`, w + PAD * 2, 120 + PAD * 2, (cg) => paintFileRack(cg, w, (e.id % 4) * 11));
  const top = bottom - 120;
  g.strokeStyle = "#3a4254";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(sx + 16, 0);
  g.lineTo(sx + 16, top + 4);
  g.moveTo(sx + w - 16, 0);
  g.lineTo(sx + w - 16, top + 4);
  g.stroke();
  g.fillStyle = "rgba(190,215,255,0.25)";
  g.fillRect(sx + 15, 0, 1, top);
  g.fillRect(sx + w - 17, 0, 1, top);
  C.draw(g, spr, sx - PAD, top - PAD);
}

export function drawBoxPlatform(g: Ctx2D, K: SkinCtx, e: Ent, sx: number, sy: number, v: ViewState): void {
  const w = Math.round(e.w);
  const h = Math.max(40, Math.round(v.h - sy + 10));
  const hq = Math.ceil(h / 40) * 40;
  const spr = K.A.cache.get(`bp|${w}|${hq}|${e.id % 3}`, w + PAD * 2, hq + PAD * 2, (cg) => paintBoxTower(cg, w, hq, (e.id % 3) * 5), null);
  let ox = 0;
  let rot = 0;
  if (e.state === "crumbling" && !K.reduced) {
    ox = Math.sin(K.time * 60) * 2.5 * Math.min(1, e.stateT / Math.max(0.1, e.p.crumble));
  } else if (e.state === "fallen") rot = Math.min(0.5, e.stateT * 0.9);
  if (rot) {
    g.save();
    g.translate(sx + e.w / 2, sy);
    g.rotate(rot * (e.id % 2 ? 1 : -1));
    K.A.cache.draw(g, spr, -e.w / 2 - PAD, -PAD);
    g.restore();
  } else K.A.cache.draw(g, spr, sx - PAD + ox, sy - PAD);
  // Rim oben
  g.fillStyle = "rgba(190,225,255,0.55)";
  g.fillRect(sx + ox, sy - 1, e.w, 1.5);
}

export function drawCabin(g: Ctx2D, K: SkinCtx, e: Ent, sx: number, sy: number): void {
  const w = e.w;
  const pater = e.skin === "paternoster";
  const top = sy - 164;
  // Seile
  g.strokeStyle = "#5a6272";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(sx + w / 2 - 6, 0);
  g.lineTo(sx + w / 2 - 6, top);
  g.moveTo(sx + w / 2 + 6, 0);
  g.lineTo(sx + w / 2 + 6, top);
  g.stroke();
  // Rückwand (hinter der Figur)
  g.fillStyle = pater ? "rgba(70,44,28,0.5)" : "rgba(30,38,52,0.55)";
  g.fillRect(sx + 6, top + 8, w - 12, sy - top - 8);
  const shade = g.createLinearGradient(0, top + 8, 0, top + 60);
  shade.addColorStop(0, "rgba(0,0,0,0.45)");
  shade.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = shade;
  g.fillRect(sx + 6, top + 8, w - 12, 52);
  if (pater) {
    g.strokeStyle = "rgba(120,80,50,0.6)";
    g.lineWidth = 1.5;
    g.beginPath();
    for (let x = sx + 26; x < sx + w - 10; x += 26) {
      g.moveTo(x, top + 10);
      g.lineTo(x, sy);
    }
    g.stroke();
  } else {
    g.strokeStyle = "rgba(110,130,160,0.35)";
    g.lineWidth = 1;
    g.beginPath();
    for (let x = sx + 18; x < sx + w - 10; x += 16) {
      g.moveTo(x, top + 10);
      g.lineTo(x, sy);
    }
    g.stroke();
  }
  // Lampe innen
  const pa = g.globalAlpha;
  const op = g.globalCompositeOperation;
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = pa * 0.55;
  blitC(g, K.A.glow.get("rgba(255,190,110,1)", w * 0.55, 60), sx + w / 2, top + 20);
  g.globalAlpha = pa;
  g.globalCompositeOperation = op;
  // Rahmen: Seitenpfosten + Joch
  g.fillStyle = pater ? "#6a4428" : "#3a4254";
  g.fillRect(sx, top, 8, sy - top);
  g.fillRect(sx + w - 8, top, 8, sy - top);
  g.fillRect(sx, top, w, 10);
  g.strokeStyle = "#0c0e14";
  g.lineWidth = 2;
  g.strokeRect(sx, top, w, 10);
  // Boden (begehbar)
  const floor = g.createLinearGradient(0, sy, 0, sy + e.h);
  floor.addColorStop(0, pater ? "#c08a58" : "#9aa6ba");
  floor.addColorStop(1, pater ? "#6a4428" : "#4a5468");
  g.fillStyle = floor;
  g.beginPath();
  g.rect(sx - 2, sy, w + 4, e.h);
  g.fill();
  outline(g, 2);
  g.fillStyle = "rgba(255,245,220,0.7)";
  g.fillRect(sx - 2, sy, w + 4, 1.5);
  // Warnstreifen an der Bodenkante
  for (let i = 0; i < Math.floor(w / 16); i += 1) {
    g.fillStyle = i % 2 ? "#141414" : "#d9a520";
    g.fillRect(sx + i * 16, sy + e.h - 5, 16, 5);
  }
}

export function drawChair(g: Ctx2D, K: SkinCtx, e: Ent, sx: number, sy: number, v: ViewState): void {
  const props = K.A.props;
  const cx = sx + e.w / 2;
  const feet = sy + e.h;
  const H = Math.round(e.h * 1.3);
  const defeated = e.state === "defeated";
  let spr: HTMLCanvasElement;
  if (props?.has("office-chair")) {
    const cell = props.cell("office-chair");
    const W = cell ? Math.round((cell.w / cell.h) * H) : H;
    spr = K.A.cache.get(`ch|${H}`, W + PAD * 2, H + PAD * 2, (cg) => {
      props.draw(cg, "office-chair", PAD + W / 2, PAD + H, { h: H, ax: 0.5, ay: 1 });
    });
  } else spr = K.A.cache.get(`chf|${e.w}|${e.h}`, e.w + PAD * 2, e.h + PAD * 2, (cg) => paintChairFallback(cg, e.w, e.h));
  // Schatten
  const pa = g.globalAlpha;
  g.globalAlpha = pa * 0.35;
  g.fillStyle = "#000";
  g.beginPath();
  g.ellipse(cx, v.groundY + 4, e.w * 0.55, 6, 0, 0, TAU);
  g.fill();
  g.globalAlpha = pa;
  // Drehen um die Hochachse (Bürostuhl kreiselt beim Rollen)
  const spin = K.reduced ? 1 : Math.cos(K.time * 3.2 + e.id);
  const kx = Math.max(0.35, Math.abs(spin)) * (spin < 0 ? -1 : 1);
  g.save();
  g.translate(cx, feet);
  if (defeated) g.rotate(Math.min(1.4, e.stateT * 4));
  g.scale(kx, 1);
  const C = K.A.cache;
  g.drawImage(spr, -C.lw(spr) / 2, -C.lh(spr) + PAD, C.lw(spr), C.lh(spr));
  g.restore();
  // Fahrtstreifen
  if (!defeated && !K.reduced) {
    g.strokeStyle = "rgba(200,220,255,0.35)";
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < 3; i += 1) {
      const y = feet - 12 - i * 16;
      g.moveTo(sx + e.w + 4, y);
      g.lineTo(sx + e.w + 22 + i * 8, y);
    }
    g.stroke();
  }
}

export function drawBat(g: Ctx2D, K: SkinCtx, e: Ent, sx: number, sy: number): void {
  const props = K.A.props;
  const cx = sx + e.w / 2;
  const cy = sy + e.h / 2;
  const defeated = e.state === "defeated";
  let spr: HTMLCanvasElement;
  if (props?.has("bat-fly")) {
    const cell = props.cell("bat-fly");
    const frames = cell?.frames ?? 12;
    const f = Math.floor((K.time * 20 + e.id * 3) % frames);
    const W = Math.round(e.w * 1.6);
    const H = cell ? Math.round((cell.h / cell.w) * W) : W;
    spr = K.A.cache.get(`bat|${W}|${f}`, W + PAD * 2, H + PAD * 2, (cg) => {
      props.draw(cg, "bat-fly", PAD + W / 2, PAD + H / 2, { w: W, frame: f, flipX: true, ax: 0.5, ay: 0.5 });
    }, "rgba(255,180,230,0.85)");
  } else {
    const up = Math.sin(K.time * 14 + e.id) > 0;
    spr = K.A.cache.get(`batf|${up ? 1 : 0}`, e.w + PAD * 2, e.h + PAD * 2, (cg) => paintBatFallback(cg, e.w, e.h, up));
  }
  if (defeated) {
    g.save();
    g.translate(cx, cy);
    g.rotate(e.stateT * 8);
    g.globalAlpha *= Math.max(0, 1 - e.stateT);
    g.drawImage(spr, -K.A.cache.lw(spr) / 2, -K.A.cache.lh(spr) / 2, K.A.cache.lw(spr), K.A.cache.lh(spr));
    g.restore();
    return;
  }
  K.A.cache.draw(g, spr, cx - K.A.cache.lw(spr) / 2, cy - K.A.cache.lh(spr) / 2);
  // Glühende Augen (im Dunkeln gut erkennbar)
  const pa = g.globalAlpha;
  const op = g.globalCompositeOperation;
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = pa * (0.55 + 0.45 * K.dark);
  glowAt(g, K.A.glowRed, cx - e.w * 0.2, cy - e.h * 0.12, 8);
  g.globalAlpha = pa;
  g.globalCompositeOperation = op;
}

export function drawPlane(g: Ctx2D, K: SkinCtx, e: Ent, sx: number, sy: number): void {
  const w = Math.round(e.w);
  const h = Math.round(e.h);
  const spr = K.A.cache.get(`pl|${w}|${h}`, w + PAD * 2, h + PAD * 2, (cg) => paintPlane(cg, w, h));
  const bob = K.reduced ? 0 : Math.sin(K.time * 7 + e.id) * 2;
  if (e.state === "defeated") return;
  // Speedlines
  g.strokeStyle = "rgba(230,240,255,0.45)";
  g.lineWidth = 1.5;
  g.beginPath();
  for (let i = 0; i < 3; i += 1) {
    const y = sy + 6 + i * 6 + bob;
    g.moveTo(sx + e.w + 6, y);
    g.lineTo(sx + e.w + 26 + i * 10, y);
  }
  g.stroke();
  K.A.cache.draw(g, spr, sx - PAD, sy - PAD + bob);
}

export function drawLampSwing(g: Ctx2D, K: SkinCtx, e: Ent, sx: number, sy: number, v: ViewState): void {
  const ax = e.p.ax - v.dist;
  const ay = e.p.ay;
  const cx = sx + e.w / 2;
  const cy = sy + e.h / 2;
  const ang = e.fx.angle ?? 0;
  const lamp = lampSprite(K);
  // Kabelansatz: mit Prop die Lampenkappe (auf der Pendellinie, Abstand = halbe Lampenhöhe), sonst wie bisher
  const a = lamp ? lamp.h / 2 : 14;
  const capX = lamp ? cx - Math.sin(ang) * a : cx;
  const capY = lamp ? cy - Math.cos(ang) * a : cy - a;
  // Deckenhalter
  g.fillStyle = "#1b2130";
  g.fillRect(ax - 14, Math.max(0, ay - 10), 28, 12);
  // Kabel
  g.strokeStyle = "#1a1d24";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(ax, ay);
  g.lineTo(capX, capY);
  g.stroke();
  g.strokeStyle = "rgba(170,190,220,0.35)";
  g.lineWidth = 1;
  g.stroke();
  // Lichtkegel (additiv) in Pendelrichtung
  const pa = g.globalAlpha;
  const op = g.globalCompositeOperation;
  g.save();
  g.translate(cx, cy);
  g.rotate(-ang);
  g.globalCompositeOperation = "lighter";
  if (lamp) {
    // Lichtöffnung des Schirms (Lampe hängt schräg: Kegel weist nach rechts unten)
    const ox = (LAMP_LIGHT.x - LAMP_CAP.x) * LAMP_S;
    const oy = (LAMP_LIGHT.y - LAMP_CAP.y) * LAMP_S - a;
    g.translate(ox, oy);
    g.rotate(-0.4);
    const cone = g.createLinearGradient(0, 4, 0, 190);
    cone.addColorStop(0, "rgba(255,200,120,0.3)");
    cone.addColorStop(1, "rgba(255,200,120,0)");
    g.fillStyle = cone;
    g.beginPath();
    g.moveTo(-20, 4);
    g.lineTo(20, 4);
    g.lineTo(84, 190);
    g.lineTo(-84, 190);
    g.closePath();
    g.fill();
    g.rotate(0.4);
    g.translate(-ox, -oy);
  } else {
    const cone = g.createLinearGradient(0, 10, 0, 200);
    cone.addColorStop(0, "rgba(255,200,120,0.32)");
    cone.addColorStop(1, "rgba(255,200,120,0)");
    g.fillStyle = cone;
    g.beginPath();
    g.moveTo(-26, 10);
    g.lineTo(26, 10);
    g.lineTo(90, 200);
    g.lineTo(-90, 200);
    g.closePath();
    g.fill();
  }
  g.globalCompositeOperation = op;
  g.globalAlpha = pa;
  if (lamp) {
    const C = K.A.pcache;
    g.drawImage(lamp.spr, -(RP + (LAMP_CAP.x - CELL_PAD) * LAMP_S), -(RP + a), C.lw(lamp.spr), C.lh(lamp.spr));
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = pa * 0.75;
    glowAt(g, K.A.glowWarm, (LAMP_LIGHT.x - LAMP_CAP.x) * LAMP_S, (LAMP_LIGHT.y - LAMP_CAP.y) * LAMP_S - a, 15);
    g.globalAlpha = pa;
    g.globalCompositeOperation = op;
    g.restore();
    return;
  }
  // Emaille-Schirm
  const spr = K.A.cache.get("lampshade", 84 + PAD * 2, 50 + PAD * 2, (cg) => {
    const x = PAD;
    const y = PAD;
    const grd = cg.createLinearGradient(x, 0, x + 84, 0);
    grd.addColorStop(0, "#1e4a38");
    grd.addColorStop(0.4, "#3f8a66");
    grd.addColorStop(1, "#143428");
    cg.fillStyle = grd;
    cg.beginPath();
    cg.moveTo(x + 34, y);
    cg.lineTo(x + 50, y);
    cg.lineTo(x + 52, y + 12);
    cg.quadraticCurveTo(x + 84, y + 20, x + 84, y + 40);
    cg.lineTo(x, y + 40);
    cg.quadraticCurveTo(x, y + 20, x + 32, y + 12);
    cg.closePath();
    cg.fill();
    outline(cg, 2.2);
    cg.fillStyle = "#f2ead6";
    cg.fillRect(x + 4, y + 38, 76, 4);
  });
  g.drawImage(spr, -K.A.cache.lw(spr) / 2, -K.A.cache.lh(spr) / 2 - 6, K.A.cache.lw(spr), K.A.cache.lh(spr));
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = pa * 0.9;
  glowAt(g, K.A.glowWarm, 0, 16, 18);
  g.globalAlpha = pa;
  g.globalCompositeOperation = op;
  g.restore();
}

export function drawBelt(g: Ctx2D, K: SkinCtx, e: Ent, sx: number, v: ViewState): void {
  const gy = v.groundY;
  const fast = e.p.mult > 1;
  const w = e.w;
  const x0 = Math.max(-40, sx);
  const x1 = Math.min(v.w + 40, sx + w);
  if (x1 <= x0) return;
  // Wanne
  g.fillStyle = "#0b0e14";
  g.fillRect(x0, gy - 2, x1 - x0, 26);
  // Band
  g.fillStyle = "#1c1f27";
  g.fillRect(x0, gy, x1 - x0, 12);
  // Chevrons (laufen mit dem Band)
  const col = fast ? "#3ad8ff" : "#ffb02e";
  const speedPx = (fast ? 1 : -1) * 150;
  const off = K.reduced ? 0 : (K.time * speedPx) % 36;
  g.save();
  g.beginPath();
  g.rect(Math.max(x0, sx + 12), gy, Math.min(x1, sx + w - 12) - Math.max(x0, sx + 12), 12);
  g.clip();
  g.fillStyle = col;
  g.beginPath();
  const first = Math.floor((x0 - sx - off) / 36) - 1;
  for (let i = first; sx + off + i * 36 < x1 + 36; i += 1) {
    const x = sx + off + i * 36;
    if (fast) {
      g.moveTo(x, gy + 1);
      g.lineTo(x + 9, gy + 1);
      g.lineTo(x + 16, gy + 6);
      g.lineTo(x + 9, gy + 11);
      g.lineTo(x, gy + 11);
      g.lineTo(x + 7, gy + 6);
    } else {
      g.moveTo(x + 16, gy + 1);
      g.lineTo(x + 7, gy + 1);
      g.lineTo(x, gy + 6);
      g.lineTo(x + 7, gy + 11);
      g.lineTo(x + 16, gy + 11);
      g.lineTo(x + 9, gy + 6);
    }
    g.closePath();
  }
  g.fill();
  g.restore();
  // Leuchten der Pfeile
  if (K.quality > 0) {
    const pa = g.globalAlpha;
    const op = g.globalCompositeOperation;
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = pa * (0.12 + 0.14 * K.dark);
    g.fillStyle = fast ? "#3ad8ff" : "#ffb02e";
    g.fillRect(x0, gy - 6, x1 - x0, 20);
    g.globalAlpha = pa;
    g.globalCompositeOperation = op;
  }
  // Seitenblende mit Warnstreifen
  g.save();
  g.beginPath();
  g.rect(x0, gy + 13, x1 - x0, 9);
  g.clip();
  for (let x = Math.floor((x0 - sx) / 20) * 20 + sx - 20; x < x1 + 20; x += 20) {
    g.fillStyle = "#d9a520";
    g.beginPath();
    g.moveTo(x, gy + 22);
    g.lineTo(x + 9, gy + 13);
    g.lineTo(x + 18, gy + 13);
    g.lineTo(x + 9, gy + 22);
    g.closePath();
    g.fill();
  }
  g.restore();
  g.fillStyle = "rgba(210,230,255,0.4)";
  g.fillRect(x0, gy - 2, x1 - x0, 1.5);
  // Umlenkrollen
  const rot = K.reduced ? 0 : K.time * (fast ? 9 : -6);
  for (const rx of [sx + 10, sx + w - 10]) {
    if (rx < -20 || rx > v.w + 20) continue;
    g.fillStyle = "#3a4254";
    g.beginPath();
    g.arc(rx, gy + 8, 10, 0, TAU);
    g.fill();
    g.strokeStyle = "#8a93a4";
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < 3; i += 1) {
      const a = rot + (i / 3) * TAU;
      g.moveTo(rx, gy + 8);
      g.lineTo(rx + Math.cos(a) * 8, gy + 8 + Math.sin(a) * 8);
    }
    g.stroke();
  }
}

/** Gast-Gegner (Odo, Madinger, JQA, Luki) wie in der Engine – damit sie im Dunkeln nachgezeichnet werden können. */
export function drawGuest(g: Ctx2D, K: SkinCtx, e: Ent, sx: number, sy: number, gy: number): boolean {
  const props = K.A.props;
  if (!props) return false;
  const run = `${e.skin}-run`;
  if (!props.has(run) && !props.has(`${e.skin}-defeated`)) return false;
  const cx = sx + e.w / 2;
  const feet = sy + e.h;
  if (e.state === "defeated") {
    const id = props.has(`${e.skin}-defeated`) ? `${e.skin}-defeated` : run;
    const u = Math.min(1, e.stateT / 1.2);
    const pa = g.globalAlpha;
    g.globalAlpha = pa * (1 - Math.max(0, u - 0.55) / 0.45);
    props.draw(g, id, cx, feet, { h: e.h * 1.32, flipX: true, t: e.stateT, once: true });
    g.globalAlpha = pa;
    return true;
  }
  const isAir = e.y + e.h < gy - 4;
  const id = isAir && props.has(`${e.skin}-jump`) ? `${e.skin}-jump` : run;
  const pa = g.globalAlpha;
  g.globalAlpha = pa * 0.28;
  g.fillStyle = "#000";
  g.beginPath();
  g.ellipse(cx, gy + 6, e.w * 0.62, 8, 0, 0, TAU);
  g.fill();
  g.globalAlpha = pa;
  return props.draw(g, id, cx, feet, { h: e.h * 1.32, flipX: true, t: K.time + e.id * 0.31 });
}
