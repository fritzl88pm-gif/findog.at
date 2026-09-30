/**
 * Alpenpanorama – Entitäts-Skins: Zaun, Findling, Holzstoß, Kuh (mit Glocke), Steinmandl, Felsdach, Lastenseilbahn-Kiste,
 * Holzsteg, bröckelnde Felsplatte, Felspfeiler, Seilbahn-Gondel, Steinbock, Adler, Steinschlag, rollender Fels, Schneeball,
 * Aufwind-Thermik, Tiefschnee, Blankeis, Gipfelkreuz, Edelweiß-Münze. Props werden genutzt, wenn vorhanden; sonst
 * prozedurale Varianten. Gefahren bekommen dunkle Kontur + helle Kante, damit sie sich immer vom Hintergrund abheben.
 */
import type { Ent, PropLibrary, ViewState } from "../../types";
import { paint, rr, type Ctx2D } from "../shared-b/canvas";
import { h1, mulberry } from "../shared-b/color";
import { CABLE_SLOPE } from "./patterns";

const TAU = Math.PI * 2;

// --- Hindernis-Props (Steinmandl, Holzstoß, Stamm, Murmeltier, Seilbahn-Kiste, Rollfels, Schneeball) --------------

/** Alpha-Rand der zugeschnittenen Prop-Zellen (tools/fredrun2/pack_props.py) */
const PROP_PAD = 5;
/** Sprites werden in doppelter Auflösung gebacken (scharf auch auf hochauflösenden Displays) */
const BAKE_K = 2;

/** Schneepuder-Verlauf (Zellkoordinaten): weiß bei y0 mit Stärke a0, ausklingend bis y1; wirkt nur, wo das Prop deckt. */
export interface SnowSpec {
  y0: number;
  y1: number;
  a0: number;
  /** Anlauf oberhalb von y0 (Zellpixel), damit darüberliegende Teile unberührt bleiben */
  ramp?: number;
}

export interface BakeOpts {
  /** Ausschnitt in Zellpixeln [x0, y0, x1, y1] (Standard: ganze Zelle) */
  crop?: [number, number, number, number];
  /** nur diese Rechtecke [x, y, w, h] (Zellpixel) sichtbar */
  clip?: Array<[number, number, number, number]>;
  /** nur diese Kreisfläche [cx, cy, r] (Zellpixel) sichtbar */
  circle?: [number, number, number];
  flip?: boolean;
  snow?: SnowSpec;
}

/**
 * Vorgerendertes Prop. Koordinaten „Zelle“ = Pixel des Original-Bildes (bei `flip` gespiegelt); `s` = logische px je
 * Zellpixel; (x0, y0) = Ursprung des Ausschnitts in Zellkoordinaten.
 */
export interface Baked {
  c: HTMLCanvasElement;
  /** Variante mit Schneepuder (nur wenn `snow` angefordert) */
  snowC: HTMLCanvasElement | null;
  s: number;
  x0: number;
  y0: number;
  w: number;
  h: number;
  cw: number;
  ch: number;
}

export class PropBank {
  private readonly cache = new Map<string, Baked>();

  constructor(private readonly props: PropLibrary | null) {}

  has(id: string): boolean {
    return !!this.props?.has(id);
  }

  cell(id: string): { w: number; h: number } | null {
    return this.props?.has(id) ? this.props.cell(id) : null;
  }

  /** Sichtbare Silhouette (Zelle ohne Alpha-Rand) */
  bbox(id: string): { w: number; h: number } | null {
    const c = this.cell(id);
    return c ? { w: c.w - PROP_PAD * 2, h: c.h - PROP_PAD * 2 } : null;
  }

  /**
   * Skalierung (logische px je Zellpixel), die die Trefferfläche der Entität deckt, aber höchstens `over`× so groß wie
   * die Entität wird. `boost` vergrößert das Deckungsmaß leicht (Spieler beurteilen Kollisionen optisch).
   */
  coverScale(id: string, e: Ent, over: number, boost = 1): number {
    const b = this.bbox(id);
    if (!b) return 1;
    const [, , hw, hh] = e.hb;
    const need = Math.max(hw / b.w, hh / b.h) * boost;
    const cap = Math.min((e.w * over) / b.w, (e.h * over) / b.h);
    return Math.round(Math.min(need, cap) * 200) / 200;
  }

  get(id: string, s: number, o: BakeOpts = {}): Baked | null {
    const props = this.props;
    if (!props?.has(id)) return null;
    const sq = Math.round(s * 1000) / 1000;
    const key = `${id}|${sq}|${o.crop?.join(",") ?? ""}|${o.clip?.map((r) => r.join(",")).join(";") ?? ""}|${o.circle?.join(",") ?? ""}|${o.flip ? 1 : 0}|${o.snow ? `${o.snow.y0},${o.snow.y1},${o.snow.a0}` : ""}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const cell = props.cell(id);
    if (!cell) return null;
    const b = this.bake(props, id, cell.w, cell.h, sq, o);
    this.cache.set(key, b);
    if (this.cache.size > 80) {
      const first = this.cache.keys().next().value;
      if (first !== undefined) this.cache.delete(first);
    }
    return b;
  }

  private bake(props: PropLibrary, id: string, cw: number, ch: number, s: number, o: BakeOpts): Baked {
    const [x0, y0, x1, y1] = o.crop ?? [0, 0, cw, ch];
    const W = Math.max(2, Math.round((x1 - x0) * s * BAKE_K));
    const H = Math.max(2, Math.round((y1 - y0) * s * BAKE_K));
    const t = W / (x1 - x0);
    const paintTo = (g: Ctx2D, scale: number): void => {
      g.save();
      if (o.clip) {
        g.beginPath();
        for (const [rx, ry, rw, rh] of o.clip) g.rect((rx - x0) * scale, (ry - y0) * scale, rw * scale, rh * scale);
        g.clip();
      }
      if (o.circle) {
        g.beginPath();
        g.arc((o.circle[0] - x0) * scale, (o.circle[1] - y0) * scale, o.circle[2] * scale, 0, TAU);
        g.clip();
      }
      // linke obere Zellecke (im ggf. gespiegelten Bild) liegt bei (-x0, -y0); gespiegelt zeichnet der Anker ax = 1
      props.draw(g, id, -x0 * scale, -y0 * scale, { scale, ax: o.flip ? 1 : 0, ay: 0, flipX: o.flip });
      g.restore();
    };
    const render = (): HTMLCanvasElement => {
      const c = paint(W, H, (g) => {
        g.imageSmoothingQuality = "high";
        if (t < 0.55) {
          // starke Verkleinerung: erst auf die doppelte Zielgröße, dann herunter (kein Flimmern)
          const big = paint(W * 2, H * 2, (bg) => {
            bg.imageSmoothingQuality = "high";
            paintTo(bg, t * 2);
          });
          g.drawImage(big, 0, 0, W, H);
        } else {
          paintTo(g, t);
        }
      });
      return c;
    };
    const c = render();
    let snowC: HTMLCanvasElement | null = null;
    if (o.snow) {
      const sn = o.snow;
      snowC = paint(W, H, (g) => {
        g.drawImage(c, 0, 0);
        g.globalCompositeOperation = "source-atop";
        const ya = (sn.y0 - y0) * t;
        const yb = (sn.y1 - y0) * t;
        const ramp = (sn.ramp ?? 0) * t;
        const grd = g.createLinearGradient(0, ya - ramp, 0, yb);
        const r0 = ramp > 0 ? ramp / (yb - ya + ramp) : 0;
        if (ramp > 0) grd.addColorStop(0, "rgba(250,253,255,0)");
        grd.addColorStop(r0, `rgba(250,253,255,${sn.a0})`);
        grd.addColorStop(r0 + (1 - r0) * 0.45, `rgba(240,247,255,${sn.a0 * 0.6})`);
        grd.addColorStop(1, "rgba(225,236,252,0)");
        g.fillStyle = grd;
        g.fillRect(0, 0, W, H);
      });
    }
    return { c, snowC, s, x0, y0, w: W / BAKE_K, h: H / BAKE_K, cw, ch };
  }
}

/** Zeichnet den Sprite (mit Schneepuder-Überblendung), sodass der Zellpunkt (cx, cy) auf (wx, wy) landet. */
function blitBaked(g: Ctx2D, b: Baked, snow: number, cx: number, cy: number, wx: number, wy: number, snap = true): void {
  let dx = wx - (cx - b.x0) * b.s;
  let dy = wy - (cy - b.y0) * b.s;
  if (snap) {
    dx = Math.round(dx);
    dy = Math.round(dy);
  }
  if (!b.snowC || snow < 0.98) g.drawImage(b.c, dx, dy, b.w, b.h);
  if (b.snowC && snow > 0.02) {
    const pa = g.globalAlpha;
    g.globalAlpha = pa * Math.min(1, snow);
    g.drawImage(b.snowC, dx, dy, b.w, b.h);
    g.globalAlpha = pa;
  }
}

/** Standard-Schneepuder für Bodenhindernisse: oberes Drittel bis knapp die Hälfte der sichtbaren Silhouette */
function topSnow(cell: { w: number; h: number }, a0 = 0.85): SnowSpec {
  const h = cell.h - PROP_PAD * 2;
  return { y0: PROP_PAD, y1: PROP_PAD + h * 0.5, a0 };
}

export interface SkinAssets {
  props: PropLibrary | null;
  /** Hindernis-Props (vorgerendert); leer, solange die Props nicht geladen sind */
  bank: PropBank;
  edelweiss: HTMLCanvasElement;
  coinGlow: HTMLCanvasElement;
  rock: HTMLCanvasElement;
  snowball: HTMLCanvasElement;
  boulderSnow: HTMLCanvasElement | null;
  boulder: HTMLCanvasElement | null;
  fence: HTMLCanvasElement | null;
  fenceSnow: HTMLCanvasElement | null;
  cow: HTMLCanvasElement | null;
  dust: HTMLCanvasElement;
  spark: HTMLCanvasElement;
}

export interface SkinCtx {
  /** Stufe + Überblendung (Fließkomma) */
  s: number;
  /** Schneeanteil 0..1 */
  snow: number;
  /** Alpenglühen 0..1 */
  glow: number;
  time: number;
  reduced: boolean;
  quality: 0 | 1 | 2;
  groundY: number;
}

// --- Vorberechnete Sprites ----------------------------------------------------------------------------

function soft(color: string, size = 64): HTMLCanvasElement {
  return paint(size, size, (g) => {
    const r = size / 2;
    const grd = g.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0, color);
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
  });
}

function edelweissVector(size: number): HTMLCanvasElement {
  return paint(size, size, (g) => {
    const c = size / 2;
    g.translate(c, c);
    // Hochblätter (grün-grau, filzig)
    for (let i = 0; i < 5; i += 1) {
      g.save();
      g.rotate((i / 5) * TAU + 0.3);
      g.fillStyle = "#6f8f5a";
      g.beginPath();
      g.ellipse(0, -size * 0.3, size * 0.09, size * 0.2, 0, 0, TAU);
      g.fill();
      g.restore();
    }
    // Sternblätter (weiß-filzig)
    for (let i = 0; i < 8; i += 1) {
      g.save();
      g.rotate((i / 8) * TAU);
      const grd = g.createLinearGradient(0, 0, 0, -size * 0.44);
      grd.addColorStop(0, "#e9ecef");
      grd.addColorStop(1, "#ffffff");
      g.fillStyle = grd;
      g.strokeStyle = "rgba(90,100,90,0.8)";
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(size * 0.11, -size * 0.22, 0, -size * 0.44);
      g.quadraticCurveTo(-size * 0.11, -size * 0.22, 0, 0);
      g.fill();
      g.stroke();
      g.restore();
    }
    // Blütenköpfchen
    g.fillStyle = "#f1c84b";
    g.beginPath();
    g.arc(0, 0, size * 0.11, 0, TAU);
    g.fill();
    g.fillStyle = "#e0a52a";
    for (let i = 0; i < 6; i += 1) {
      g.beginPath();
      g.arc(Math.cos(i) * size * 0.06, Math.sin(i) * size * 0.06, size * 0.03, 0, TAU);
      g.fill();
    }
  });
}

function rockSprite(size: number, seed: number): HTMLCanvasElement {
  return paint(size, size, (g) => {
    const r = mulberry(seed);
    const c = size / 2;
    const R = size * 0.46;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < 11; i += 1) {
      const a = (i / 11) * TAU;
      const rad = R * (0.84 + r() * 0.16);
      pts.push([c + Math.cos(a) * rad, c + Math.sin(a) * rad]);
    }
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    const grd = g.createRadialGradient(c + R * 0.35, c - R * 0.4, R * 0.1, c, c, R * 1.1);
    grd.addColorStop(0, "#b9b3ab");
    grd.addColorStop(0.55, "#7d7770");
    grd.addColorStop(1, "#4a4540");
    g.fillStyle = grd;
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = "#231f1c";
    g.stroke();
    g.save();
    g.clip();
    // Facetten & Moos
    for (let i = 0; i < 7; i += 1) {
      const x = c + (r() - 0.5) * R * 1.4;
      const y = c + (r() - 0.5) * R * 1.4;
      g.fillStyle = r() < 0.5 ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.16)";
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + R * 0.4, y + R * 0.1);
      g.lineTo(x + R * 0.1, y + R * 0.45);
      g.closePath();
      g.fill();
    }
    g.fillStyle = "rgba(96,140,60,0.55)";
    g.beginPath();
    g.ellipse(c - R * 0.3, c - R * 0.5, R * 0.35, R * 0.18, -0.4, 0, TAU);
    g.fill();
    g.strokeStyle = "rgba(20,16,14,0.55)";
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(c - R * 0.2, c - R * 0.1);
    g.lineTo(c + R * 0.1, c + R * 0.2);
    g.lineTo(c + R * 0.05, c + R * 0.5);
    g.stroke();
    g.restore();
  });
}

function snowballSprite(size: number): HTMLCanvasElement {
  return paint(size, size, (g) => {
    const r = mulberry(77);
    const c = size / 2;
    const R = size * 0.46;
    const grd = g.createRadialGradient(c + R * 0.35, c - R * 0.35, R * 0.1, c, c, R);
    grd.addColorStop(0, "#ffffff");
    grd.addColorStop(0.6, "#e3eef9");
    grd.addColorStop(1, "#9db8d6");
    g.fillStyle = grd;
    g.beginPath();
    for (let i = 0; i <= 20; i += 1) {
      const a = (i / 20) * TAU;
      const rad = R * (0.93 + r() * 0.07);
      if (i) g.lineTo(c + Math.cos(a) * rad, c + Math.sin(a) * rad);
      else g.moveTo(c + Math.cos(a) * rad, c + Math.sin(a) * rad);
    }
    g.closePath();
    g.fill();
    g.lineWidth = 2.5;
    g.strokeStyle = "#48607e";
    g.stroke();
    // eingeschlossene Steine/Äste + Schneeklumpen
    for (let i = 0; i < 9; i += 1) {
      const a = r() * TAU;
      const d = r() * R * 0.75;
      g.fillStyle = i < 3 ? "rgba(90,80,70,0.8)" : "rgba(150,180,215,0.55)";
      g.beginPath();
      g.ellipse(c + Math.cos(a) * d, c + Math.sin(a) * d, 3 + r() * 6, 2 + r() * 4, a, 0, TAU);
      g.fill();
    }
    g.strokeStyle = "rgba(80,56,40,0.8)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(c - R * 0.3, c + R * 0.1);
    g.lineTo(c + R * 0.15, c + R * 0.3);
    g.stroke();
  });
}

/** Prop in feste Auflösung backen; `snowy` pudert die Oberseite mit Schnee (nur wo das Prop deckt). */
function bakeProp(props: PropLibrary, id: string, h: number, snowy: boolean, flip = false): HTMLCanvasElement | null {
  if (!props.has(id)) return null;
  const cell = props.cell(id);
  if (!cell) return null;
  const w = Math.ceil((cell.w * h) / cell.h);
  return paint(w, h, (g) => {
    g.imageSmoothingQuality = "high";
    props.draw(g, id, w / 2, h, { h, flipX: flip, ay: 1 });
    if (snowy) {
      g.globalCompositeOperation = "source-atop";
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, "rgba(250,253,255,0.95)");
      grd.addColorStop(0.3, "rgba(245,250,255,0.75)");
      grd.addColorStop(0.46, "rgba(230,240,255,0.1)");
      grd.addColorStop(1, "rgba(180,200,230,0.15)");
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    }
  });
}

export function makeSkinAssets(props: PropLibrary | null): SkinAssets {
  let edel: HTMLCanvasElement | null = null;
  if (props?.has("edelweiss")) {
    const cell = props.cell("edelweiss");
    if (cell) {
      const s = 64;
      edel = paint(s, s, (g) => {
        g.imageSmoothingQuality = "high";
        props.draw(g, "edelweiss", s / 2, s / 2, { w: s * 0.98 });
      });
    }
  }
  return {
    props,
    bank: new PropBank(props),
    edelweiss: edel ?? edelweissVector(64),
    coinGlow: soft("rgba(255,236,160,0.9)"),
    rock: rockSprite(128, 7),
    snowball: snowballSprite(128),
    boulder: props ? bakeProp(props, "boulder", 150, false) : null,
    boulderSnow: props ? bakeProp(props, "boulder", 150, true) : null,
    fence: props ? bakeProp(props, "wood-fence", 90, false) : null,
    fenceSnow: props ? bakeProp(props, "wood-fence", 90, true) : null,
    cow: props ? bakeProp(props, "cow", 150, false, true) : null,
    dust: soft("rgba(236,230,220,0.85)"),
    spark: soft("rgba(255,255,240,1)", 32),
  };
}

// --- Hilfen -------------------------------------------------------------------------------------------

function shadow(g: Ctx2D, cx: number, gy: number, rx: number, a = 0.3): void {
  g.fillStyle = `rgba(20,30,40,${a})`;
  g.beginPath();
  g.ellipse(cx, gy + 3, rx, Math.max(3, rx * 0.13), 0, 0, TAU);
  g.fill();
}

/** Sprite mit Schnee-Überblendung zeichnen (unten-mittig verankert). */
function drawBaked(g: Ctx2D, a: HTMLCanvasElement, b: HTMLCanvasElement | null, snow: number, cx: number, bottom: number, h: number): void {
  const w = (a.width * h) / a.height;
  const x = cx - w / 2;
  const y = bottom - h;
  if (snow < 0.98 || !b) g.drawImage(a, x, y, w, h);
  if (b && snow > 0.02) {
    const pa = g.globalAlpha;
    g.globalAlpha = pa * Math.min(1, snow);
    g.drawImage(b, x, y, w, h);
    g.globalAlpha = pa;
  }
}

function snowCap(g: Ctx2D, x: number, y: number, w: number, snow: number, thick = 7): void {
  if (snow < 0.05) return;
  g.fillStyle = `rgba(250,253,255,${Math.min(1, snow * 1.2).toFixed(3)})`;
  g.beginPath();
  g.moveTo(x, y + 2);
  g.quadraticCurveTo(x + w * 0.1, y - thick, x + w * 0.3, y - thick * 0.8);
  g.quadraticCurveTo(x + w * 0.55, y - thick * 1.2, x + w * 0.75, y - thick * 0.7);
  g.quadraticCurveTo(x + w * 0.95, y - thick * 0.9, x + w, y + 2);
  g.closePath();
  g.fill();
}

// --- Bodenhindernisse ----------------------------------------------------------------------------------

export function drawFence(g: Ctx2D, A: SkinAssets, e: Ent, sx: number, k: SkinCtx): void {
  const gy = k.groundY;
  shadow(g, sx + e.w / 2, gy, e.w * 0.55, 0.22);
  if (A.fence) {
    const h = e.h * 1.12;
    drawBaked(g, A.fence, A.fenceSnow, k.snow, sx + e.w / 2, gy + 3, h);
    return;
  }
  const n = Math.max(3, Math.round(e.w / 34));
  g.fillStyle = "#7a4e2a";
  g.strokeStyle = "#2b1a0e";
  g.lineWidth = 2.5;
  for (let i = 0; i < n; i += 1) {
    const x = sx + 4 + (i * (e.w - 16)) / (n - 1);
    g.beginPath();
    rr(g, x, gy - e.h, 9, e.h, 2);
    g.fill();
    g.stroke();
  }
  for (const yy of [0.3, 0.65]) {
    g.beginPath();
    rr(g, sx, gy - e.h * (1 - yy) - 5, e.w, 10, 3);
    g.fill();
    g.stroke();
  }
  snowCap(g, sx, gy - e.h, e.w, k.snow, 5);
}

export function drawBoulder(g: Ctx2D, A: SkinAssets, e: Ent, sx: number, k: SkinCtx): void {
  const gy = k.groundY;
  shadow(g, sx + e.w / 2, gy, e.w * 0.58, 0.32);
  if (A.boulder) {
    drawBaked(g, A.boulder, A.boulderSnow, k.snow, sx + e.w / 2, gy + 5, e.h * 1.12);
    return;
  }
  const s = Math.max(e.w, e.h) * 1.08;
  g.drawImage(A.rock, sx + e.w / 2 - s / 2, gy + 6 - s * 0.94, s, s);
  snowCap(g, sx + e.w * 0.15, gy - e.h * 0.95, e.w * 0.7, k.snow, 10);
}

export function drawLogs(g: Ctx2D, A: SkinAssets, e: Ent, sx: number, sy: number, k: SkinCtx): void {
  const gy = k.groundY;
  shadow(g, sx + e.w / 2, gy, e.w * 0.56, 0.3);
  const cell = A.bank.cell("alpen-logs");
  const b = cell ? A.bank.get("alpen-logs", A.bank.coverScale("alpen-logs", e, 1.1), { snow: topSnow(cell, 0.9) }) : null;
  if (b) {
    blitBaked(g, b, k.snow, b.cw / 2, b.ch - PROP_PAD, sx + e.w / 2, gy + 3);
    return;
  }
  const rows = Math.max(2, Math.round(e.h / 26));
  const rH = e.h / rows;
  const r = rH * 0.52;
  // Rinde (Seitenansicht) als Band hinter den Stirnflächen
  for (let row = 0; row < rows; row += 1) {
    const y = gy - rH * (row + 0.5);
    const inset = row * r * 0.55;
    const x0 = sx + inset;
    const x1 = sx + e.w - inset;
    g.fillStyle = "#5a3b22";
    g.beginPath();
    rr(g, x0, y - r, x1 - x0, r * 2, r);
    g.fill();
    g.fillStyle = "rgba(255,220,160,0.12)";
    g.fillRect(x0 + r, y - r * 0.8, x1 - x0 - 2 * r, 3);
    const n = Math.max(1, Math.floor((x1 - x0) / (r * 2.05)));
    for (let i = 0; i < n; i += 1) {
      const cx = x0 + r + i * ((x1 - x0 - 2 * r) / Math.max(1, n - 1 || 1));
      const cxx = n === 1 ? (x0 + x1) / 2 : cx;
      const grd = g.createRadialGradient(cxx - r * 0.2, y - r * 0.2, 1, cxx, y, r);
      grd.addColorStop(0, "#f2cf94");
      grd.addColorStop(0.8, "#cf9a5a");
      grd.addColorStop(1, "#8a5a2c");
      g.fillStyle = grd;
      g.beginPath();
      g.arc(cxx, y, r * 0.92, 0, TAU);
      g.fill();
      g.strokeStyle = "#3a2412";
      g.lineWidth = 2;
      g.stroke();
      g.strokeStyle = "rgba(120,74,34,0.6)";
      g.lineWidth = 1;
      g.beginPath();
      g.arc(cxx, y, r * 0.55, 0, TAU);
      g.moveTo(cxx + r * 0.25, y);
      g.arc(cxx, y, r * 0.25, 0, TAU);
      g.stroke();
    }
  }
  snowCap(g, sx + (rows - 1) * r * 0.55, sy + 2, e.w - (rows - 1) * r * 1.1, k.snow, 8);
}

export function drawCow(g: Ctx2D, A: SkinAssets, e: Ent, sx: number, sy: number, k: SkinCtx): void {
  const gy = k.groundY;
  shadow(g, sx + e.w / 2, gy, e.w * 0.52, 0.3);
  const t = k.reduced ? 0 : k.time + e.id;
  const breathe = 1 + Math.sin(t * 2.2) * 0.012;
  if (A.cow) {
    const h = e.h * 1.08 * breathe;
    const w = (A.cow.width * h) / A.cow.height;
    g.drawImage(A.cow, sx + e.w / 2 - w / 2, gy + 4 - h, w, h);
  } else {
    // prozedurale Kuh
    g.fillStyle = "#f5f1ea";
    g.strokeStyle = "#2a1d14";
    g.lineWidth = 3;
    g.beginPath();
    rr(g, sx + e.w * 0.2, sy + e.h * 0.2, e.w * 0.7, e.h * 0.5, 16);
    g.fill();
    g.stroke();
    g.fillStyle = "#7a4a28";
    g.beginPath();
    g.ellipse(sx + e.w * 0.55, sy + e.h * 0.4, e.w * 0.14, e.h * 0.12, 0.3, 0, TAU);
    g.fill();
    g.fillStyle = "#f5f1ea";
    g.beginPath();
    rr(g, sx, sy + e.h * 0.12, e.w * 0.26, e.h * 0.34, 10);
    g.fill();
    g.stroke();
    g.fillStyle = "#f2a0a8";
    g.beginPath();
    rr(g, sx + 2, sy + e.h * 0.3, e.w * 0.14, e.h * 0.14, 6);
    g.fill();
    g.fillStyle = "#f5f1ea";
    for (const lx of [0.25, 0.38, 0.72, 0.84]) {
      g.beginPath();
      rr(g, sx + e.w * lx, sy + e.h * 0.62, 10, e.h * 0.38, 3);
      g.fill();
      g.stroke();
    }
  }
  // Kuhglocke am Hals (schwingt)
  const bx = sx + e.w * 0.2;
  const by = sy + e.h * 0.46;
  const ang = Math.sin(t * 3.4) * 0.35;
  g.save();
  g.translate(bx, by);
  g.rotate(ang);
  g.strokeStyle = "#5a2c1a";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(-7, -8);
  g.lineTo(0, 0);
  g.lineTo(7, -8);
  g.stroke();
  const bg = g.createLinearGradient(-8, 0, 8, 0);
  bg.addColorStop(0, "#9a6a1a");
  bg.addColorStop(0.45, "#ffd766");
  bg.addColorStop(1, "#8a5a10");
  g.fillStyle = bg;
  g.beginPath();
  g.moveTo(-5, 0);
  g.lineTo(5, 0);
  g.lineTo(8, 13);
  g.lineTo(-8, 13);
  g.closePath();
  g.fill();
  g.strokeStyle = "#3a2408";
  g.lineWidth = 1.5;
  g.stroke();
  g.restore();
}

/** Umgestürzter Fichtenstamm: Rinde, Astlöcher, Stirnfläche mit Jahresringen, Moos/Schnee obenauf. */
export function drawTrunk(g: Ctx2D, A: SkinAssets, e: Ent, sx: number, sy: number, k: SkinCtx): void {
  const gy = k.groundY;
  shadow(g, sx + e.w / 2, gy, e.w * 0.55, 0.32);
  const cell = A.bank.cell("alpen-trunk");
  const b = cell ? A.bank.get("alpen-trunk", A.bank.coverScale("alpen-trunk", e, 1.06), { snow: topSnow(cell, 0.9) }) : null;
  if (b) {
    blitBaked(g, b, k.snow, b.cw / 2, b.ch - PROP_PAD, sx + e.w / 2, gy + 3);
    return;
  }
  const r = e.h / 2;
  const x0 = sx + 4;
  const x1 = sx + e.w - r;
  const cy = sy + r;
  // Aststummel
  g.strokeStyle = "#4a3020";
  g.lineWidth = 6;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(sx + e.w * 0.3, sy + 6);
  g.lineTo(sx + e.w * 0.24, sy - 12);
  g.moveTo(sx + e.w * 0.62, sy + 6);
  g.lineTo(sx + e.w * 0.7, sy - 8);
  g.stroke();
  // Stamm
  const grd = g.createLinearGradient(0, sy, 0, sy + e.h);
  grd.addColorStop(0, "#8a6040");
  grd.addColorStop(0.45, "#6a4428");
  grd.addColorStop(1, "#3e2616");
  g.fillStyle = grd;
  g.strokeStyle = "#1f1209";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(x0 + r * 0.4, sy + 2);
  g.lineTo(x1, sy);
  g.arc(x1, cy, r, -Math.PI / 2, Math.PI / 2);
  g.lineTo(x0 + r * 0.4, sy + e.h - 1);
  g.quadraticCurveTo(x0 - 4, cy, x0 + r * 0.4, sy + 2);
  g.closePath();
  g.fill();
  g.stroke();
  // Rindenstruktur
  g.strokeStyle = "rgba(30,18,8,0.45)";
  g.lineWidth = 1.5;
  g.beginPath();
  for (let i = 0; i < e.w / 16; i += 1) {
    const x = x0 + 10 + i * 16 + h1(e.id + i) * 6;
    if (x > x1 - 6) break;
    g.moveTo(x, sy + 5 + h1(e.id * 2 + i) * 6);
    g.lineTo(x + 10, sy + e.h * 0.55 + h1(e.id * 3 + i) * 8);
  }
  g.stroke();
  g.fillStyle = "rgba(255,230,190,0.18)";
  g.fillRect(x0 + r * 0.5, sy + 4, x1 - x0 - r * 0.5, 3);
  // Stirnfläche
  const face = g.createRadialGradient(x1 - 2, cy - 2, 1, x1, cy, r);
  face.addColorStop(0, "#f0cf98");
  face.addColorStop(0.8, "#d29c5c");
  face.addColorStop(1, "#8a5a2c");
  g.fillStyle = face;
  g.beginPath();
  g.ellipse(x1, cy, r * 0.62, r - 2, 0, 0, TAU);
  g.fill();
  g.strokeStyle = "#2a180a";
  g.lineWidth = 2;
  g.stroke();
  g.strokeStyle = "rgba(120,74,34,0.6)";
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(x1, cy, r * 0.38, r * 0.62, 0, 0, TAU);
  g.moveTo(x1 + r * 0.18, cy);
  g.ellipse(x1, cy, r * 0.18, r * 0.3, 0, 0, TAU);
  g.stroke();
  // Moos bzw. Schnee obenauf
  if (k.snow > 0.2) snowCap(g, x0 + 6, sy + 3, x1 - x0 - 4, k.snow, 7);
  else {
    g.fillStyle = "rgba(96,150,58,0.9)";
    for (let i = 0; i < 3; i += 1) {
      const x = x0 + 20 + i * ((x1 - x0 - 40) / 2);
      g.beginPath();
      g.ellipse(x, sy + 4, 12 + h1(e.id + i * 5) * 10, 4, 0, Math.PI, TAU);
      g.fill();
    }
  }
}

/** Murmeltier: stellt sich auf und pfeift (Männchen machen), wenn es nicht läuft; flieht nach Sprung-Treffer. */
export function drawMarmot(g: Ctx2D, A: SkinAssets, e: Ent, sx: number, sy: number, k: SkinCtx): void {
  const gy = k.groundY;
  const cx = sx + e.w / 2;
  // Sprite blickt nach rechts, das Murmeltier läuft nach links → gespiegelt
  const mb = A.bank.has("alpen-marmot") ? A.bank.get("alpen-marmot", A.bank.coverScale("alpen-marmot", e, 1.1, 1.08), { flip: e.vx <= 0 }) : null;
  if (mb) {
    const fx = mb.cw / 2 - mb.x0;
    const fy = mb.ch - PROP_PAD - mb.y0;
    if (e.state === "defeated") {
      // Sprung-Treffer: purzelt davon und blendet aus
      g.save();
      g.globalAlpha = Math.max(0, 1 - e.stateT * 1.5);
      g.translate(cx, sy + e.h * 0.6);
      g.rotate(e.stateT * 8);
      g.drawImage(mb.c, -mb.w / 2, -mb.h / 2, mb.w, mb.h);
      g.restore();
      return;
    }
    shadow(g, cx, gy, 20, 0.28);
    // leichtes Wippen im Laufrhythmus (bei reduzierter Bewegung ruhig)
    const tt = k.reduced ? 0 : k.time + e.id;
    const bob = Math.abs(Math.sin(tt * 9)) * 3;
    g.save();
    g.translate(cx, gy + 2 - bob);
    g.rotate(Math.sin(tt * 9) * 0.05);
    g.drawImage(mb.c, -fx * mb.s, -fy * mb.s, mb.w, mb.h);
    g.restore();
    return;
  }
  if (e.state === "defeated") {
    g.save();
    g.globalAlpha = Math.max(0, 1 - e.stateT * 1.5);
    g.translate(cx, sy + e.h * 0.6);
    g.rotate(e.stateT * 8);
    g.fillStyle = "#9a6a3a";
    g.beginPath();
    g.ellipse(0, 0, 18, 12, 0, 0, TAU);
    g.fill();
    g.restore();
    return;
  }
  shadow(g, cx, gy, 20, 0.28);
  const t = k.reduced ? 0 : k.time + e.id;
  const bob = Math.abs(Math.sin(t * 9)) * 3;
  const fur = g.createLinearGradient(0, sy, 0, gy);
  fur.addColorStop(0, "#b98450");
  fur.addColorStop(1, "#7a5230");
  g.fillStyle = fur;
  g.strokeStyle = "#2a1a0c";
  g.lineWidth = 2.5;
  // Körper (aufrecht, leicht nach links geneigt)
  g.beginPath();
  g.ellipse(cx + 2, gy - 18 - bob, 17, 20, -0.15, 0, TAU);
  g.fill();
  g.stroke();
  // Kopf
  g.beginPath();
  g.ellipse(cx - 6, gy - 40 - bob, 12, 10, -0.2, 0, TAU);
  g.fill();
  g.stroke();
  // Bauch
  g.fillStyle = "#e3c392";
  g.beginPath();
  g.ellipse(cx - 2, gy - 14 - bob, 9, 13, -0.15, 0, TAU);
  g.fill();
  // Schnauze, Auge, Ohr, Zähne
  g.fillStyle = "#e8d2ac";
  g.beginPath();
  g.ellipse(cx - 15, gy - 38 - bob, 5, 4, 0, 0, TAU);
  g.fill();
  g.fillStyle = "#1a1008";
  g.beginPath();
  g.arc(cx - 9, gy - 43 - bob, 2, 0, TAU);
  g.arc(cx - 19, gy - 39 - bob, 1.6, 0, TAU);
  g.fill();
  g.fillStyle = "#fff";
  g.fillRect(cx - 17, gy - 35 - bob, 3, 3);
  g.fillStyle = "#8a5a30";
  g.beginPath();
  g.arc(cx - 1, gy - 48 - bob, 3.5, 0, TAU);
  g.fill();
  // Pfötchen + Schwanz
  g.strokeStyle = "#5a3a1e";
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(cx - 12, gy - 24 - bob);
  g.lineTo(cx - 16, gy - 20 - bob);
  g.moveTo(cx + 14, gy - 8);
  g.quadraticCurveTo(cx + 26, gy - 6, cx + 24, gy - 16 + Math.sin(t * 5) * 3);
  g.stroke();
}

/** Holzkiste (Standard-Hindernis der Engine-Muster): Almkiste mit Eisenbeschlägen und gemaltem Edelweiß. */
export function drawCrate(g: Ctx2D, e: Ent, sx: number, sy: number, k: SkinCtx): void {
  const gy = k.groundY;
  shadow(g, sx + e.w / 2, gy, e.w * 0.6, 0.3);
  const grd = g.createLinearGradient(sx, sy, sx + e.w, sy + e.h);
  grd.addColorStop(0, "#c9965a");
  grd.addColorStop(1, "#7c5028");
  g.fillStyle = grd;
  g.strokeStyle = "#2a180a";
  g.lineWidth = 3;
  g.beginPath();
  rr(g, sx, sy, e.w, e.h, 4);
  g.fill();
  g.stroke();
  g.strokeStyle = "rgba(60,34,14,0.6)";
  g.lineWidth = 1.5;
  g.beginPath();
  for (let y = sy + 14; y < sy + e.h - 4; y += 14) {
    g.moveTo(sx + 3, y);
    g.lineTo(sx + e.w - 3, y);
  }
  g.stroke();
  g.strokeStyle = "#3c3f46";
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(sx + 4, sy + 4);
  g.lineTo(sx + e.w - 4, sy + e.h - 4);
  g.moveTo(sx + e.w - 4, sy + 4);
  g.lineTo(sx + 4, sy + e.h - 4);
  g.stroke();
  // Edelweiß-Emblem
  const cx = sx + e.w / 2;
  const cy = sy + e.h / 2;
  g.fillStyle = "#f4f1e8";
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * TAU;
    g.beginPath();
    g.ellipse(cx + Math.cos(a) * 6, cy + Math.sin(a) * 6, 5, 2.4, a, 0, TAU);
    g.fill();
  }
  g.fillStyle = "#e8b83a";
  g.beginPath();
  g.arc(cx, cy, 3, 0, TAU);
  g.fill();
  g.fillStyle = "rgba(255,240,210,0.4)";
  g.fillRect(sx + 3, sy + 3, e.w - 6, 2);
  snowCap(g, sx, sy, e.w, k.snow, 6);
}

export function drawCairn(g: Ctx2D, A: SkinAssets, e: Ent, sx: number, k: SkinCtx): void {
  const gy = k.groundY;
  shadow(g, sx + e.w / 2, gy, e.w * 0.7, 0.3);
  const cell = A.bank.cell("alpen-cairn");
  const b = cell ? A.bank.get("alpen-cairn", A.bank.coverScale("alpen-cairn", e, 1.1), { snow: topSnow(cell, 0.8) }) : null;
  if (b) {
    blitBaked(g, b, k.snow, b.cw / 2, b.ch - PROP_PAD, sx + e.w / 2, gy + 3);
    return;
  }
  const n = Math.max(4, Math.round(e.h / 20));
  let y = gy + 2;
  const r = mulberry(e.id * 13 + 1);
  for (let i = 0; i < n; i += 1) {
    const u = i / (n - 1);
    const w = e.w * (1.05 - u * 0.55) * (0.9 + r() * 0.2);
    const h = (e.h / n) * (1.15 - u * 0.25);
    const cx = sx + e.w / 2 + (r() - 0.5) * 8;
    const col = 110 + Math.floor(r() * 40);
    g.fillStyle = `rgb(${col},${col - 4},${col - 10})`;
    g.strokeStyle = "#221d1a";
    g.lineWidth = 2.5;
    g.beginPath();
    g.ellipse(cx, y - h / 2, w / 2, h / 2, (r() - 0.5) * 0.15, 0, TAU);
    g.fill();
    g.stroke();
    g.fillStyle = "rgba(255,255,255,0.22)";
    g.beginPath();
    g.ellipse(cx + w * 0.1, y - h * 0.72, w * 0.28, h * 0.16, 0, 0, TAU);
    g.fill();
    if (k.snow > 0.1) {
      g.fillStyle = `rgba(250,253,255,${Math.min(1, k.snow * 1.1).toFixed(3)})`;
      g.beginPath();
      g.ellipse(cx, y - h * 0.86, w * 0.4, h * 0.2, 0, Math.PI, TAU);
      g.fill();
    }
    y -= h * 0.86;
  }
}

// --- Überhänge ------------------------------------------------------------------------------------------

const ledgeCache = new WeakMap<Ent, { c: HTMLCanvasElement; ice: boolean; top: number; ox: number }>();
const LEDGE_PAD = 44;

/** Felsdach-Sprite einmal pro Entität backen (Form, Facetten, Schichtung, Moos/Eis). */
function bakeLedge(e: Ent, top: number, bottom: number, ice: boolean): HTMLCanvasElement {
  const lip = bottom - top;
  // Felszunge hängt von einer mächtigen Felsdecke herab (oben im Bild, breit auslaufend); darunter leicht verjüngt
  const flare = Math.min(360, lip * 0.8);
  const pad = LEDGE_PAD + flare;
  const W = e.w + pad * 2;
  const H = Math.max(40, lip + 36);
  const r = mulberry(e.id * 7 + 3);
  const ph1 = r() * 6;
  const ph2 = r() * 6;
  const ceil = Math.min(110, lip * 0.3);
  const out = (y: number): number => flare * Math.pow(Math.max(0, 1 - y / ceil), 2) + 26 * Math.max(0, 1 - y / lip);
  const leftX = (y: number): number => pad - 16 - out(y) + 12 * Math.sin(y * 0.02 + ph1) + 7 * Math.sin(y * 0.05 + ph2);
  const rightX = (y: number): number => pad + e.w + 16 + out(y) - 12 * Math.sin(y * 0.023 + ph2) - 7 * Math.sin(y * 0.047 + ph1);
  return paint(W, H, (g) => {
    const pts: Array<[number, number]> = [];
    for (let y = 0; y <= lip - 26; y += y < ceil ? 12 : 24) pts.push([leftX(y), y]);
    pts.push([pad + 2, lip - 10]);
    const nB = Math.max(4, Math.round(e.w / 34));
    for (let i = 0; i <= nB; i += 1) {
      const u = i / nB;
      pts.push([pad + 6 + u * (e.w - 12), lip + (i === 0 || i === nB ? -2 : r() * 7)]);
    }
    pts.push([pad + e.w - 2, lip - 10]);
    const ys: number[] = [];
    for (let y = 0; y <= lip - 26; y += y < ceil ? 12 : 24) ys.push(y);
    for (let i = ys.length - 1; i >= 0; i -= 1) pts.push([rightX(ys[i]), ys[i]]);
    const path = (): void => {
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
    };
    path();
    const grd = g.createLinearGradient(0, 0, 0, lip);
    if (ice) {
      grd.addColorStop(0, "#6f8fb8");
      grd.addColorStop(0.6, "#a8c6e6");
      grd.addColorStop(1, "#5b7fb0");
    } else {
      grd.addColorStop(0, "#4d4843");
      grd.addColorStop(0.55, "#8a8279");
      grd.addColorStop(1, "#5a524b");
    }
    g.fillStyle = grd;
    g.fill();
    g.save();
    path();
    g.clip();
    // Facetten (Licht von rechts oben)
    for (let i = 0; i < 34; i += 1) {
      const y = r() * lip;
      const x = leftX(y) + r() * (rightX(y) - leftX(y));
      const s = 18 + r() * 40;
      g.fillStyle = r() < 0.55 ? (ice ? "rgba(235,248,255,0.22)" : "rgba(255,240,220,0.13)") : "rgba(10,10,20,0.16)";
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + s, y + s * 0.3);
      g.lineTo(x + s * 0.6, y + s * 0.9);
      g.lineTo(x - s * 0.2, y + s * 0.6);
      g.closePath();
      g.fill();
    }
    // Schichtung (leicht schräg)
    g.strokeStyle = ice ? "rgba(240,250,255,0.35)" : "rgba(30,24,20,0.35)";
    g.lineWidth = 2;
    for (let y = lip - 34; y > -40; y -= 30 + r() * 16) {
      g.beginPath();
      g.moveTo(0, y + 12);
      for (let x = 0; x <= W; x += 30) g.lineTo(x, y - x * 0.06 + (r() - 0.5) * 6);
      g.stroke();
    }
    // Lichtkante rechts, Schatten links
    const side = g.createLinearGradient(0, 0, W, 0);
    side.addColorStop(0, "rgba(0,0,0,0.3)");
    side.addColorStop(0.3, "rgba(0,0,0,0)");
    side.addColorStop(0.85, "rgba(255,245,225,0)");
    side.addColorStop(1, "rgba(255,245,225,0.22)");
    g.fillStyle = side;
    g.fillRect(0, 0, W, H);
    // dunkle Unterseite
    const under = g.createLinearGradient(0, lip - 26, 0, lip + 8);
    under.addColorStop(0, "rgba(15,12,10,0)");
    under.addColorStop(1, "rgba(15,12,10,0.6)");
    g.fillStyle = under;
    g.fillRect(0, lip - 26, W, 40);
    // oben im Dunkel verlieren
    const fade = g.createLinearGradient(0, 0, 0, Math.min(160, lip * 0.5));
    fade.addColorStop(0, "rgba(20,22,30,0.55)");
    fade.addColorStop(1, "rgba(20,22,30,0)");
    g.fillStyle = fade;
    g.fillRect(0, 0, W, 160);
    g.restore();
    // Kontur
    path();
    g.lineWidth = 3.5;
    g.strokeStyle = "#17130f";
    g.stroke();
    // helle Unterkante (Lesbarkeit der Gefahr)
    g.strokeStyle = ice ? "rgba(235,250,255,0.95)" : "rgba(255,226,170,0.7)";
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(pad + 8, lip - 4);
    for (let i = 1; i < nB; i += 1) g.lineTo(pad + 6 + (i / nB) * (e.w - 12), lip - 3);
    g.lineTo(pad + e.w - 8, lip - 4);
    g.stroke();
    // Behang: Moos & Wurzeln bzw. Eiszapfen
    for (let i = 0; i < nB + 2; i += 1) {
      const x = pad + 10 + ((i + 0.5) * (e.w - 20)) / (nB + 2);
      const y = lip - 2;
      const L = 8 + r() * 16;
      if (ice) {
        g.fillStyle = "rgba(225,244,255,0.95)";
        g.strokeStyle = "rgba(60,100,160,0.85)";
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(x - 4, y);
        g.lineTo(x + 4, y);
        g.lineTo(x + 0.5, y + L + 6);
        g.closePath();
        g.fill();
        g.stroke();
      } else {
        g.fillStyle = "#5f9a3a";
        g.beginPath();
        g.ellipse(x, y + 2, 8 + r() * 6, 4, 0, 0, TAU);
        g.fill();
        g.strokeStyle = r() < 0.5 ? "#4f8a2e" : "#6b4a2a";
        g.lineWidth = 1.8;
        g.beginPath();
        g.moveTo(x, y + 3);
        g.quadraticCurveTo(x + 3, y + L * 0.6, x - 1, y + L);
        g.stroke();
      }
    }
  });
}

/** Felsdach von oben (Unterkante = e.y + e.h): drunter durchrutschen. Stufe 4: Eis mit Eiszapfen. */
export function drawLedge(g: Ctx2D, e: Ent, sx: number, sy: number, k: SkinCtx): void {
  const bottom = sy + e.h;
  const top = Math.max(-30, sy);
  const ice = k.snow > 0.9;
  let hit = ledgeCache.get(e);
  if (!hit || hit.ice !== ice || hit.top !== top) {
    const c = bakeLedge(e, top, bottom, ice);
    hit = { c, ice, top, ox: (c.width - e.w) / 2 };
    ledgeCache.set(e, hit);
  }
  // Schatten am Boden
  g.fillStyle = "rgba(10,20,30,0.3)";
  g.beginPath();
  g.ellipse(sx + e.w / 2, k.groundY + 4, e.w * 0.62, 9, 0, 0, TAU);
  g.fill();
  g.drawImage(hit.c, Math.round(sx - hit.ox), Math.round(top));
  // Tropfwasser
  if (!k.reduced && k.quality > 0 && !ice) {
    const t = k.time;
    for (let i = 0; i < 2; i += 1) {
      const u = (t * 0.9 + i * 0.5 + h1(e.id)) % 1;
      const x = sx + e.w * (0.3 + i * 0.4);
      g.fillStyle = `rgba(200,230,255,${(0.8 * (1 - u)).toFixed(3)})`;
      g.beginPath();
      g.ellipse(x, bottom + 14 + u * (k.groundY - bottom - 14), 2, 3.5, 0, 0, TAU);
      g.fill();
    }
  }
}

/**
 * Seilbahn-Kiste (Zellkoordinaten): Laufwerk auf dem Seil (Radachse), Schnitt durch das einzelne Tragseil zwischen den
 * Knoten, Seilmitte/-breite, Neigung des Tragseils im Bild und Breite der Kiste. Das Bild ist zu kurz für die
 * Trefferfläche (bis zum Seil hinauf): Laufwerk und Kiste werden getrennt gezeichnet, dazwischen hängt ein verlängertes Seil.
 */
const CARGO = { wheelX: 181, wheelY: 54, cut: 196, ropeX: 183, ropeW: 20, slope: 0.307, crateW: 296, flagX: 198, flagY: 170 };

let ropeTile: HTMLCanvasElement | null = null;

/** Gedrehtes Hanfseil als wiederholbare Kachel (Breite 10, Höhe 7) */
function getRopeTile(): HTMLCanvasElement {
  if (ropeTile) return ropeTile;
  ropeTile = paint(10, 7, (g) => {
    const grd = g.createLinearGradient(0, 0, 10, 0);
    grd.addColorStop(0, "#8e5f22");
    grd.addColorStop(0.4, "#e2b45a");
    grd.addColorStop(1, "#a06d28");
    g.fillStyle = grd;
    g.fillRect(0, 0, 10, 7);
    // Litzen: schräge Kerben (setzen sich über die Kachelgrenze fort)
    g.lineWidth = 1.7;
    for (const oy of [0, 7]) {
      g.strokeStyle = "rgba(58,32,8,0.75)";
      g.beginPath();
      g.moveTo(0.5, 6.5 + oy - 7);
      g.lineTo(9.5, 1.5 + oy - 7);
      g.stroke();
      g.strokeStyle = "rgba(255,226,150,0.55)";
      g.beginPath();
      g.moveTo(0.5, 4.5 + oy - 7);
      g.lineTo(9.5, -0.5 + oy - 7);
      g.stroke();
    }
    g.fillStyle = "#24140a";
    g.fillRect(0, 0, 1.6, 7);
    g.fillRect(8.4, 0, 1.6, 7);
  });
  return ropeTile;
}

/** Lastenseilbahn-Kiste: Tragseil oben, Gehänge, tief hängende Holzkiste (drunter durchrutschen). */
export function drawCargo(g: Ctx2D, A: SkinAssets, e: Ent, sx: number, sy: number, k: SkinCtx): void {
  const bottom = sy + e.h;
  const cx = sx + e.w / 2;
  const cableY = sy + 8;
  const t = k.reduced ? 0 : k.time;
  const sway = Math.sin(t * 1.6 + e.id) * 0.03;
  const bb = A.bank.bbox("alpen-cargo");
  const cell = A.bank.cell("alpen-cargo");
  if (bb && cell) {
    const s = Math.round(((e.w * 0.95) / CARGO.crateW) * 200) / 200;
    const cw = cell.w;
    const ch = cell.h;
    const top = A.bank.get("alpen-cargo", s, {
      crop: [0, 0, cw, CARGO.cut],
      clip: [
        [0, 0, cw, CARGO.flagY],
        [0, CARGO.flagY, CARGO.flagX, CARGO.cut - CARGO.flagY],
      ],
    });
    const low = A.bank.get("alpen-cargo", s, {
      crop: [0, CARGO.flagY, cw, ch],
      clip: [
        [0, CARGO.cut, cw, ch - CARGO.cut],
        [CARGO.flagX, CARGO.flagY, cw - CARGO.flagX, CARGO.cut - CARGO.flagY],
      ],
      snow: { y0: 338, y1: 445, a0: 0.9, ramp: 8 },
    });
    if (top && low) {
      const wy = sy + 12;
      const yCut = wy + (CARGO.cut - CARGO.wheelY) * s;
      const yLow = bottom - 2 - (ch - PROP_PAD - CARGO.cut) * s;
      const len = Math.max(0, yLow - yCut);
      // Tragseil: läuft mit der Neigung des Seils im Bild von oben links nach unten rechts durch das Laufwerk
      const slope = CARGO.slope;
      const x0 = -20;
      const x1 = 1300;
      const wc = 17 * s;
      g.save();
      g.lineCap = "butt";
      g.strokeStyle = "#0c0c0f";
      g.lineWidth = wc + 0.6;
      g.beginPath();
      g.moveTo(x0, wy + slope * (x0 - cx));
      g.lineTo(x1, wy + slope * (x1 - cx));
      g.stroke();
      g.strokeStyle = "#9a9ea8";
      g.lineWidth = Math.max(2, wc - 3.4);
      g.stroke();
      g.strokeStyle = "rgba(40,42,50,0.55)";
      g.setLineDash([2, 4.5]);
      g.stroke();
      g.setLineDash([]);
      // Kiste + Seil pendeln leicht um die Aufhängung
      const rx = cx + (CARGO.ropeX - CARGO.wheelX) * s;
      g.save();
      g.translate(rx, yCut);
      g.rotate(sway);
      const rw = Math.max(4, Math.round(CARGO.ropeW * s));
      const rope = getRopeTile();
      const pat = g.createPattern(rope, "repeat-y");
      if (pat) {
        g.save();
        g.translate(-rw / 2, -3);
        g.scale(rw / 10, 1);
        g.fillStyle = pat;
        g.fillRect(0, 0, 10, len + 6);
        g.restore();
      }
      g.drawImage(low.c, -(CARGO.ropeX - low.x0) * low.s, len - (CARGO.cut - low.y0) * low.s, low.w, low.h);
      if (low.snowC && k.snow > 0.02) {
        g.globalAlpha = Math.min(1, k.snow);
        g.drawImage(low.snowC, -(CARGO.ropeX - low.x0) * low.s, len - (CARGO.cut - low.y0) * low.s, low.w, low.h);
        g.globalAlpha = 1;
      }
      g.restore();
      // Laufwerk + Ring + Knoten (fest am Seil)
      blitBaked(g, top, 0, CARGO.wheelX, CARGO.wheelY, cx, wy, false);
      g.restore();
      // Schatten
      g.fillStyle = "rgba(10,20,30,0.25)";
      g.beginPath();
      g.ellipse(cx, k.groundY + 4, e.w * 0.5, 7, 0, 0, TAU);
      g.fill();
      return;
    }
  }
  // Tragseil (ganze Breite)
  g.strokeStyle = "#1c1c20";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(-10, cableY - (cx + 10) * 0.05);
  g.lineTo(1290, cableY + (1290 - cx) * 0.05);
  g.stroke();
  g.strokeStyle = "rgba(255,255,255,0.25)";
  g.lineWidth = 1;
  g.stroke();
  // Laufwerk
  g.fillStyle = "#2c2e34";
  g.beginPath();
  rr(g, cx - 18, cableY - 8, 36, 12, 4);
  g.fill();
  for (const o of [-10, 10]) {
    g.fillStyle = "#6a6e78";
    g.beginPath();
    g.arc(cx + o, cableY - 1, 5, 0, TAU);
    g.fill();
  }
  g.save();
  g.translate(cx, cableY + 4);
  g.rotate(sway);
  const boxH = 66;
  const hang = bottom - boxH - (cableY + 4);
  // Gehänge
  g.strokeStyle = "#2a2a2e";
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(0, hang - 20);
  g.moveTo(0, hang - 20);
  g.lineTo(-e.w * 0.42, hang);
  g.moveTo(0, hang - 20);
  g.lineTo(e.w * 0.42, hang);
  g.stroke();
  // Kiste
  const bx = -e.w / 2;
  const by = hang;
  const grd = g.createLinearGradient(0, by, 0, by + boxH);
  grd.addColorStop(0, "#c08a4e");
  grd.addColorStop(1, "#7a4f28");
  g.fillStyle = grd;
  g.strokeStyle = "#24160b";
  g.lineWidth = 3.5;
  g.beginPath();
  rr(g, bx, by, e.w, boxH, 5);
  g.fill();
  g.stroke();
  g.strokeStyle = "rgba(40,22,10,0.55)";
  g.lineWidth = 1.5;
  g.beginPath();
  for (let y = by + 16; y < by + boxH - 4; y += 16) {
    g.moveTo(bx + 3, y);
    g.lineTo(bx + e.w - 3, y);
  }
  g.stroke();
  // Metallecken
  g.fillStyle = "#3c3f46";
  for (const [ox, oy] of [
    [0, 0],
    [e.w - 12, 0],
    [0, boxH - 12],
    [e.w - 12, boxH - 12],
  ]) g.fillRect(bx + ox, by + oy, 12, 12);
  // Ladung (Milchkannen / Heu)
  g.fillStyle = "#cfd4da";
  for (let i = 0; i < 3; i += 1) {
    const x = bx + 16 + i * ((e.w - 32) / 2) - 8;
    g.beginPath();
    rr(g, x, by - 14, 16, 18, 4);
    g.fill();
    g.strokeStyle = "#4a4e56";
    g.lineWidth = 1.5;
    g.stroke();
  }
  g.fillStyle = "rgba(255,240,200,0.45)";
  g.fillRect(bx + 4, by + 3, e.w - 8, 2);
  if (k.snow > 0.2) {
    g.fillStyle = `rgba(250,253,255,${Math.min(1, k.snow).toFixed(3)})`;
    g.beginPath();
    rr(g, bx - 2, by - 5, e.w + 4, 7, 3);
    g.fill();
  }
  g.restore();
  // Schatten
  g.fillStyle = "rgba(10,20,30,0.25)";
  g.beginPath();
  g.ellipse(cx, k.groundY + 4, e.w * 0.5, 7, 0, 0, TAU);
  g.fill();
}

// --- Plattformen -----------------------------------------------------------------------------------------

export function drawPlank(g: Ctx2D, e: Ent, sx: number, sy: number, k: SkinCtx): void {
  const gy = k.groundY;
  // Stützpfosten bis tief in die Schlucht
  for (const px of [sx + 14, sx + e.w - 26]) {
    const grd = g.createLinearGradient(px, 0, px + 12, 0);
    grd.addColorStop(0, "#4a3020");
    grd.addColorStop(1, "#7a5232");
    g.fillStyle = grd;
    g.fillRect(px, sy + e.h, 12, 720 - sy);
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.fillRect(px, gy + 40, 12, 720 - gy);
  }
  // Querstrebe
  g.strokeStyle = "#5a3a22";
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(sx + 20, sy + e.h + 6);
  g.lineTo(sx + e.w - 20, sy + e.h + 80);
  g.stroke();
  // Bohlen
  const n = Math.max(3, Math.round(e.w / 30));
  const pw = e.w / n;
  for (let i = 0; i < n; i += 1) {
    const x = sx + i * pw;
    const tone = 0.9 + h1(e.id * 3 + i) * 0.2;
    g.fillStyle = `rgb(${Math.round(190 * tone)},${Math.round(142 * tone)},${Math.round(88 * tone)})`;
    g.fillRect(x + 1, sy, pw - 2, e.h);
  }
  g.strokeStyle = "#2b1a0c";
  g.lineWidth = 2.5;
  g.strokeRect(sx, sy, e.w, e.h);
  g.fillStyle = "rgba(255,240,200,0.4)";
  g.fillRect(sx + 2, sy + 2, e.w - 4, 2);
  // Seilgeländer
  g.strokeStyle = "#caa46a";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(sx, sy - 26);
  g.quadraticCurveTo(sx + e.w / 2, sy - 16, sx + e.w, sy - 26);
  g.stroke();
  g.fillStyle = "#5a3a22";
  g.fillRect(sx - 2, sy - 30, 5, 30);
  g.fillRect(sx + e.w - 3, sy - 30, 5, 30);
  snowCap(g, sx, sy, e.w, k.snow * 0.9, 5);
}

/** Bröckelnde Felsplatte: schwebt über der Schlucht; zittert, reißt auf und zerbricht. */
export function drawCrumble(g: Ctx2D, e: Ent, sx: number, sy: number, k: SkinCtx): void {
  const crumbling = e.state === "crumbling";
  const fallen = e.state === "fallen";
  const u = crumbling ? Math.min(1, e.stateT / Math.max(0.05, e.p.crumble || 0.5)) : fallen ? 1 : 0;
  const shake = crumbling && !k.reduced ? Math.sin(k.time * 60 + e.id) * (1 + u * 2.5) : 0;
  const x = sx + shake;
  const y = sy;
  const w = e.w;
  const r = mulberry(e.id * 11 + 5);
  const depth = 20 + Math.min(24, w * 0.07);
  g.save();
  if (fallen) {
    g.translate(x + w / 2, y + 10);
    g.rotate(Math.min(0.5, e.stateT * 1.4) * (e.id % 2 ? 1 : -1));
    g.translate(-(x + w / 2), -(y + 10));
    g.globalAlpha = Math.max(0, 1 - e.stateT * 1.2);
  }
  // Körper: flache Oberseite, spitz zulaufende Unterseite
  g.beginPath();
  g.moveTo(x, y + 4);
  g.lineTo(x + w, y + 4);
  g.lineTo(x + w - 6, y + e.h);
  const nB = Math.max(5, Math.round(w / 26));
  for (let i = nB; i >= 0; i -= 1) {
    const v = i / nB;
    const dd = (0.35 + 0.65 * Math.sin(v * Math.PI)) * depth * (i % 2 ? 0.55 + r() * 0.3 : 0.85 + r() * 0.3);
    g.lineTo(x + 6 + v * (w - 12), y + e.h + dd);
  }
  g.lineTo(x + 6, y + e.h);
  g.closePath();
  const grd = g.createLinearGradient(0, y, 0, y + e.h + depth);
  grd.addColorStop(0, "#a49a8e");
  grd.addColorStop(0.35, "#7b7166");
  grd.addColorStop(1, "#453d36");
  g.fillStyle = grd;
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = "#1f1a16";
  g.stroke();
  // Risse (wachsen beim Bröckeln)
  g.strokeStyle = `rgba(30,20,14,${(0.45 + u * 0.5).toFixed(3)})`;
  g.lineWidth = 1.6 + u * 1.6;
  g.beginPath();
  const cracks = 3;
  for (let c2 = 0; c2 < cracks; c2 += 1) {
    const cx = x + w * (0.22 + c2 * 0.28) + (r() - 0.5) * 16;
    g.moveTo(cx, y + 5);
    let yy = y + 5;
    let xx = cx;
    const len = 12 + u * (e.h + depth * 0.6);
    while (yy < y + 5 + len) {
      yy += 7;
      xx += (r() - 0.5) * 9;
      g.lineTo(xx, yy);
    }
  }
  g.stroke();
  // Oberseite: Moos/Gras bzw. Schnee + Lichtkante
  const topCol = k.snow > 0.5 ? "rgba(248,252,255,0.95)" : k.snow > 0.15 ? "#9fa86f" : "#6fae45";
  g.fillStyle = topCol;
  g.beginPath();
  rr(g, x - 1, y, w + 2, 8, 3);
  g.fill();
  g.fillStyle = "rgba(255,250,220,0.5)";
  g.fillRect(x + 2, y + 1, w - 4, 2);
  // Warnfarbe beim Bröckeln
  if (crumbling) {
    g.globalCompositeOperation = "lighter";
    g.fillStyle = `rgba(255,120,60,${(0.12 + 0.2 * u * (k.reduced ? 1 : 0.6 + 0.4 * Math.sin(k.time * 30))).toFixed(3)})`;
    g.fillRect(x, y + 4, w, e.h);
    g.globalCompositeOperation = "source-over";
  }
  g.restore();
  // Bröckelnde Steinchen
  if ((crumbling || fallen) && k.quality > 0) {
    g.fillStyle = "#6e645a";
    const tt = e.stateT;
    for (let i = 0; i < 8; i += 1) {
      const t0 = (i / 8) * 0.5;
      const lt = tt - t0;
      if (lt < 0) continue;
      const px = sx + w * (0.1 + 0.8 * h1(e.id + i * 7));
      const py = y + e.h + 10 + lt * lt * 900;
      if (py > 740) continue;
      g.fillRect(px, py, 4 + (i % 3), 4 + (i % 2));
    }
  }
}

const cragCache = new WeakMap<Ent, { c: HTMLCanvasElement; key: number; top: number }>();
const CRAG_PAD = 30;

/** Felspfeiler-Sprite backen: begehbare Oberseite, zerklüftete Flanken, Bänder, Moos/Schnee, Tiefendunkel. */
function bakeCrag(e: Ent, top: number, snowKey: number): HTMLCanvasElement {
  const w = e.w;
  const H = 730 - top;
  const W = w + CRAG_PAD * 2;
  const r = mulberry(e.id * 5 + 9);
  return paint(W, Math.max(40, H), (g) => {
    const x0 = CRAG_PAD;
    const pts: Array<[number, number]> = [];
    // rechte Flanke (Licht), dann linke Flanke (Schatten) – leicht verjüngt, mit Vorsprüngen
    pts.push([x0 - 6, 6]);
    pts.push([x0 + w + 6, 6]);
    for (let y = 26; y < H + 20; y += 30 + r() * 20) {
      const taper = Math.min(0.22, (y / 700) * 0.22) * w;
      pts.push([x0 + w - taper - r() * 14 + (r() < 0.25 ? 10 : 0), y]);
    }
    const left: Array<[number, number]> = [];
    for (let y = 26; y < H + 20; y += 28 + r() * 22) {
      const taper = Math.min(0.18, (y / 700) * 0.18) * w;
      left.push([x0 + taper + r() * 14 - (r() < 0.25 ? 10 : 0), y]);
    }
    pts.push([x0 + w * 0.6, H + 20]);
    pts.push([x0 + w * 0.3, H + 20]);
    for (let i = left.length - 1; i >= 0; i -= 1) pts.push(left[i]);
    const path = (): void => {
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
    };
    path();
    const grd = g.createLinearGradient(x0, 0, x0 + w, 0);
    grd.addColorStop(0, "#4a443e");
    grd.addColorStop(0.5, "#756c63");
    grd.addColorStop(1, "#a0968a");
    g.fillStyle = grd;
    g.fill();
    g.save();
    path();
    g.clip();
    // Facetten
    for (let i = 0; i < Math.round(w / 8); i += 1) {
      const x = x0 + r() * w;
      const y = 10 + r() * Math.min(H, 420);
      const s = 14 + r() * 30;
      g.fillStyle = r() < 0.5 ? "rgba(255,240,220,0.14)" : "rgba(10,8,6,0.18)";
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + s, y + s * 0.25);
      g.lineTo(x + s * 0.7, y + s);
      g.lineTo(x - s * 0.1, y + s * 0.7);
      g.closePath();
      g.fill();
    }
    // Bänder mit heller Oberkante + Moos/Schnee auf den Absätzen
    for (let y = 40; y < H; y += 34 + r() * 22) {
      const yy = y + (r() - 0.5) * 6;
      g.fillStyle = "rgba(20,16,12,0.35)";
      g.fillRect(x0 - 10, yy, w + 20, 3);
      g.fillStyle = "rgba(255,240,215,0.16)";
      g.fillRect(x0 - 10, yy - 2, w + 20, 2);
      if (y < 260 && r() < 0.7) {
        g.fillStyle = snowKey === 2 ? "rgba(245,250,255,0.9)" : snowKey === 1 ? "rgba(160,170,120,0.8)" : "rgba(98,150,60,0.85)";
        const mx = x0 + r() * w * 0.8;
        g.beginPath();
        g.ellipse(mx, yy - 2, 10 + r() * 18, 3.5, 0, 0, TAU);
        g.fill();
      }
    }
    // Klüfte
    g.strokeStyle = "rgba(15,12,10,0.55)";
    g.lineWidth = 1.8;
    for (let i = 0; i < Math.max(2, Math.round(w / 90)); i += 1) {
      let x = x0 + w * (0.2 + r() * 0.6);
      let y = 16 + r() * 60;
      g.beginPath();
      g.moveTo(x, y);
      const end = y + 80 + r() * 160;
      while (y < end) {
        y += 10 + r() * 12;
        x += (r() - 0.5) * 10;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // Tiefe: nach unten ins Dunkel
    const dg = g.createLinearGradient(0, 60, 0, H);
    dg.addColorStop(0, "rgba(16,20,32,0)");
    dg.addColorStop(1, "rgba(16,20,32,0.8)");
    g.fillStyle = dg;
    g.fillRect(0, 0, W, H);
    g.restore();
    path();
    g.lineWidth = 3;
    g.strokeStyle = "#1a1612";
    g.stroke();
    // Deckschicht oben
    const cap = snowKey === 2 ? "#f5f9ff" : snowKey === 1 ? "#9aa878" : "#64a841";
    const capDark = snowKey === 2 ? "#bcd0e8" : snowKey === 1 ? "#6f7d55" : "#3f7a2a";
    g.fillStyle = capDark;
    g.beginPath();
    g.moveTo(x0 - 10, 4);
    g.quadraticCurveTo(x0 + w / 2, -2, x0 + w + 10, 4);
    g.lineTo(x0 + w + 6, 14);
    for (let x = x0 + w + 6; x > x0 - 6; x -= 12) g.lineTo(x, 13 + r() * 6);
    g.closePath();
    g.fill();
    g.fillStyle = cap;
    g.beginPath();
    g.moveTo(x0 - 8, 3);
    g.quadraticCurveTo(x0 + w / 2, -3, x0 + w + 8, 3);
    g.lineTo(x0 + w + 6, 9);
    g.lineTo(x0 - 6, 9);
    g.closePath();
    g.fill();
    if (snowKey < 2) {
      g.strokeStyle = snowKey === 1 ? "#7d8a5a" : "#4f8f30";
      g.lineWidth = 1.5;
      g.beginPath();
      for (let x = x0 - 4; x < x0 + w + 4; x += 6) {
        g.moveTo(x, 4);
        g.lineTo(x + 2, -3 - r() * 5);
      }
      g.stroke();
    }
    g.fillStyle = "rgba(255,252,230,0.5)";
    g.fillRect(x0, 1, w, 2);
  });
}

/** Stabiler Felspfeiler (Gipfelgrat/Einstieg): Oberseite begehbar, Pfeiler reicht in die Tiefe. */
export function drawCrag(g: Ctx2D, e: Ent, sx: number, sy: number, k: SkinCtx): void {
  const key = k.snow > 0.5 ? 2 : k.snow > 0.15 ? 1 : 0;
  const top = Math.round(sy);
  let hit = cragCache.get(e);
  if (!hit || hit.key !== key || hit.top !== top) {
    hit = { c: bakeCrag(e, top, key), key, top };
    cragCache.set(e, hit);
  }
  g.drawImage(hit.c, Math.round(sx - CRAG_PAD), top - 6);
}

/** Seilbahn-Gondel: flaches Dach = Plattform; Gehänge bis zum Tragseil, das durchs Bild läuft. */
export function drawGondola(g: Ctx2D, e: Ent, sx: number, sy: number, k: SkinCtx): void {
  const w = e.w;
  const cx = sx + w / 2;
  const hang = 92;
  const gripY = sy - hang;
  // Tragseil (Gerade durch den Griffpunkt, Steigung wie die Fahrbahn)
  const yAt = (x: number): number => gripY - (x - cx) * CABLE_SLOPE;
  g.strokeStyle = "#16171b";
  g.lineWidth = 3.5;
  g.beginPath();
  g.moveTo(-10, yAt(-10));
  g.lineTo(1290, yAt(1290));
  g.stroke();
  g.strokeStyle = "rgba(255,255,255,0.3)";
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(-10, yAt(-10) - 1);
  g.lineTo(1290, yAt(1290) - 1);
  g.stroke();
  // Laufwerk mit drehenden Rollen
  const roll = (e.x - (e.p.bx ?? e.x)) * 0.12;
  g.save();
  g.translate(cx, gripY);
  g.rotate(-Math.atan(CABLE_SLOPE));
  g.fillStyle = "#3a3d45";
  g.beginPath();
  rr(g, -22, -6, 44, 14, 5);
  g.fill();
  for (const o of [-12, 12]) {
    g.fillStyle = "#1d1f24";
    g.beginPath();
    g.arc(o, -4, 6, 0, TAU);
    g.fill();
    g.strokeStyle = "#8a8f9a";
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(o + Math.cos(roll) * 5, -4 + Math.sin(roll) * 5);
    g.lineTo(o - Math.cos(roll) * 5, -4 - Math.sin(roll) * 5);
    g.stroke();
  }
  g.restore();
  // Gehänge: A-Rahmen vom Laufwerk zu zwei Dachpunkten (Großkabinen-Pendelbahn)
  const ax0 = sx + w * 0.26;
  const ax1 = sx + w * 0.74;
  g.strokeStyle = "#2c2f36";
  g.lineWidth = 6;
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(cx, gripY + 6);
  g.lineTo(cx, gripY + 26);
  g.lineTo(ax0, sy - 4);
  g.moveTo(cx, gripY + 26);
  g.lineTo(ax1, sy - 4);
  g.moveTo(ax0 + 10, sy - 14);
  g.lineTo(ax1 - 10, sy - 14);
  g.stroke();
  g.strokeStyle = "rgba(255,255,255,0.28)";
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(cx + 2, gripY + 8);
  g.lineTo(cx + 2, gripY + 26);
  g.lineTo(ax1 + 1, sy - 5);
  g.stroke();
  // Kabine: trapezförmig (oben breiter), rot mit weißem Band
  const cabH = Math.max(86, Math.min(126, w * 0.5));
  const top = sy + 6;
  const inset = Math.min(26, w * 0.09);
  const body = g.createLinearGradient(0, top, 0, top + cabH);
  body.addColorStop(0, "#f0443a");
  body.addColorStop(0.6, "#c8261e");
  body.addColorStop(1, "#8a1410");
  g.fillStyle = body;
  g.strokeStyle = "#2a0806";
  g.lineWidth = 3.5;
  g.beginPath();
  g.moveTo(sx + 2, top);
  g.lineTo(sx + w - 2, top);
  g.lineTo(sx + w - inset, top + cabH - 8);
  g.quadraticCurveTo(sx + w - inset - 2, top + cabH, sx + w - inset - 12, top + cabH);
  g.lineTo(sx + inset + 12, top + cabH);
  g.quadraticCurveTo(sx + inset + 2, top + cabH, sx + inset, top + cabH - 8);
  g.closePath();
  g.fill();
  g.stroke();
  // Fensterband (folgt der Schräge)
  const wy = top + 12;
  const wh = cabH * 0.44;
  const k0 = inset * (12 / cabH);
  const k1 = inset * ((12 + wh) / cabH);
  const wg = g.createLinearGradient(0, wy, 0, wy + wh);
  wg.addColorStop(0, "#cdeeff");
  wg.addColorStop(1, "#4d8cc0");
  g.fillStyle = wg;
  g.beginPath();
  g.moveTo(sx + 10 + k0, wy);
  g.lineTo(sx + w - 10 - k0, wy);
  g.lineTo(sx + w - 10 - k1, wy + wh);
  g.lineTo(sx + 10 + k1, wy + wh);
  g.closePath();
  g.fill();
  g.strokeStyle = "#1c2a36";
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = "#1c2a36";
  const nw = Math.max(2, Math.round(w / 64));
  for (let i = 1; i < nw; i += 1) g.fillRect(sx + 10 + k0 + (i * (w - 20 - 2 * k0)) / nw - 2, wy, 4, wh);
  // Fahrgäste als Silhouetten
  g.fillStyle = "rgba(30,40,60,0.45)";
  for (let i = 0; i < nw * 2; i += 1) {
    if (h1(e.id * 5 + i) < 0.45) continue;
    const px = sx + 18 + k1 + (i + 0.5) * ((w - 36 - 2 * k1) / (nw * 2));
    g.beginPath();
    g.arc(px, wy + wh - 12, 5, 0, TAU);
    g.fill();
    g.fillRect(px - 6, wy + wh - 8, 12, 8);
  }
  g.fillStyle = "rgba(255,255,255,0.5)";
  g.beginPath();
  g.moveTo(sx + 20 + k0, wy + 3);
  g.lineTo(sx + 46 + k0, wy + 3);
  g.lineTo(sx + 30 + k1, wy + wh - 3);
  g.lineTo(sx + 18 + k1, wy + wh - 3);
  g.closePath();
  g.fill();
  // weißes Zierband + Scheinwerfer
  g.fillStyle = "#fbf3e6";
  g.beginPath();
  g.moveTo(sx + 8 + k1, wy + wh + 8);
  g.lineTo(sx + w - 8 - k1, wy + wh + 8);
  g.lineTo(sx + w - 9 - k1 - 1, wy + wh + 15);
  g.lineTo(sx + 9 + k1 + 1, wy + wh + 15);
  g.closePath();
  g.fill();
  g.fillStyle = "#ffe9a0";
  g.beginPath();
  g.arc(sx + inset + 8, top + cabH - 14, 4, 0, TAU);
  g.fill();
  // Dach (Plattform) – klar lesbare Lauffläche
  const roof = g.createLinearGradient(0, sy, 0, sy + e.h);
  roof.addColorStop(0, "#d9dde4");
  roof.addColorStop(1, "#7d838e");
  g.fillStyle = roof;
  g.beginPath();
  rr(g, sx - 2, sy, w + 4, e.h - 6, 5);
  g.fill();
  g.strokeStyle = "#20232a";
  g.lineWidth = 2.5;
  g.stroke();
  g.fillStyle = "rgba(255,255,255,0.6)";
  g.fillRect(sx + 3, sy + 2, w - 6, 2);
  snowCap(g, sx, sy, w, k.snow * 0.7, 4);
}

// --- Tiere -------------------------------------------------------------------------------------------------

export function drawIbex(g: Ctx2D, A: SkinAssets, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
  const gy = k.groundY;
  const cx = sx + e.w / 2;
  const air = gy - (sy + e.h);
  if (e.state !== "defeated") {
    const sk = Math.max(0.35, 1 - air / 260);
    shadow(g, cx, gy, e.w * 0.46 * sk, 0.3 * sk);
  }
  const P = A.props;
  const h = e.h * 1.32;
  if (e.state === "defeated") {
    g.save();
    g.translate(cx, sy + e.h * 0.5);
    g.rotate(Math.min(Math.PI, e.stateT * 6));
    g.globalAlpha = Math.max(0, 1 - e.stateT * 0.9);
    if (!P?.draw(g, "ibex-run", 0, h * 0.45, { h, flipX: true, frame: 3 })) {
      g.fillStyle = "#a8743e";
      g.fillRect(-e.w / 2, -e.h / 2, e.w, e.h * 0.6);
    }
    g.restore();
    return;
  }
  const t = air > 3 ? 0.18 : v.time * 1.1 + e.id * 0.13;
  if (P?.draw(g, "ibex-run", cx, sy + e.h + 3, { h, flipX: true, t, frame: air > 3 ? 5 : undefined })) return;
  // Fallback: stilisierter Steinbock
  g.fillStyle = "#a8743e";
  g.strokeStyle = "#2a1a0c";
  g.lineWidth = 2.5;
  g.beginPath();
  rr(g, sx + e.w * 0.2, sy + e.h * 0.3, e.w * 0.62, e.h * 0.36, 12);
  g.fill();
  g.stroke();
  g.beginPath();
  rr(g, sx + e.w * 0.02, sy + e.h * 0.14, e.w * 0.26, e.h * 0.26, 8);
  g.fill();
  g.stroke();
  g.strokeStyle = "#5a4630";
  g.lineWidth = 5;
  g.beginPath();
  g.arc(sx + e.w * 0.24, sy + e.h * 0.1, e.h * 0.2, Math.PI * 1.1, Math.PI * 1.9);
  g.stroke();
  const ph = v.time * 14;
  g.strokeStyle = "#2a1a0c";
  g.lineWidth = 4;
  for (const [lx, o] of [
    [0.3, 0],
    [0.45, 1.5],
    [0.66, 3],
    [0.78, 4.5],
  ] as const) {
    g.beginPath();
    g.moveTo(sx + e.w * lx, sy + e.h * 0.64);
    g.lineTo(sx + e.w * lx + Math.sin(ph + o) * 8, sy + e.h);
    g.stroke();
  }
}

export function drawEagle(g: Ctx2D, A: SkinAssets, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
  const cx = sx + e.w / 2;
  const cy = sy + e.h / 2;
  const P = A.props;
  const h = e.h * 1.95;
  if (e.state === "defeated") {
    g.save();
    g.translate(cx, cy);
    g.rotate(e.stateT * 5);
    g.globalAlpha = Math.max(0, 1 - e.stateT);
    P?.draw(g, "eagle-fly", 0, 0, { h, flipX: true, frame: 7 });
    g.restore();
    return;
  }
  // Schatten am Boden (weit unten, schwach)
  const alt = k.groundY - (sy + e.h);
  g.fillStyle = `rgba(20,30,40,${Math.max(0.06, 0.24 - alt / 1600).toFixed(3)})`;
  g.beginPath();
  g.ellipse(cx, k.groundY + 4, e.w * 0.45, 5, 0, 0, TAU);
  g.fill();
  if (P?.draw(g, "eagle-fly", cx, cy + 4, { h, flipX: true, t: v.time + e.id * 0.21 })) return;
  // Fallback-Adler
  const flap = Math.sin(v.time * 9 + e.id) * 0.8;
  g.fillStyle = "#5a3a1e";
  g.strokeStyle = "#1c1008";
  g.lineWidth = 2;
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(cx, cy);
    g.quadraticCurveTo(cx + s * e.w * 0.3, cy - 30 * flap, cx + s * e.w * 0.62, cy - 10 * flap);
    g.lineTo(cx + s * e.w * 0.2, cy + 8);
    g.closePath();
    g.fill();
    g.stroke();
  }
  g.beginPath();
  g.ellipse(cx, cy + 4, e.w * 0.22, e.h * 0.2, 0, 0, TAU);
  g.fill();
  g.fillStyle = "#f8f4ea";
  g.beginPath();
  g.arc(cx - e.w * 0.24, cy, e.h * 0.13, 0, TAU);
  g.fill();
  g.fillStyle = "#f0b020";
  g.beginPath();
  g.moveTo(cx - e.w * 0.34, cy - 2);
  g.lineTo(cx - e.w * 0.44, cy + 3);
  g.lineTo(cx - e.w * 0.33, cy + 5);
  g.fill();
}

// --- Steinschlag, rollende Gefahren ---------------------------------------------------------------------

/**
 * Steinschlag (Zone): idle → warn (Schatten wächst, Fels stürzt sichtbar von oben) → active (Einschlag, Splitter) → idle
 * (Staub legt sich). Treffer nur in "active".
 */
export function drawRockfall(g: Ctx2D, A: SkinAssets, e: Ent, sx: number, sy: number, k: SkinCtx): void {
  const gy = k.groundY;
  const cx = sx + e.w / 2;
  const u = e.fx.phaseT ?? 0;
  if (e.state === "warn") e.fx.warned = 1;
  if (e.state === "active") e.fx.hit = 1;
  const size = e.w * 1.05;
  if (e.state === "warn") {
    // Schatten + Warnschimmer
    const sa = 0.12 + 0.45 * u;
    g.fillStyle = `rgba(30,20,20,${sa.toFixed(3)})`;
    g.beginPath();
    g.ellipse(cx, gy + 3, e.w * (0.3 + 0.35 * u), 7 + 5 * u, 0, 0, TAU);
    g.fill();
    const pulse = k.reduced ? 0.7 : 0.5 + 0.5 * Math.sin(k.time * 18);
    g.strokeStyle = `rgba(255,110,50,${(0.45 + 0.5 * u * pulse).toFixed(3)})`;
    g.lineWidth = 3.5;
    g.setLineDash([10, 7]);
    g.beginPath();
    g.ellipse(cx, gy + 3, e.w * (0.5 + 0.1 * u), 12 + 3 * u, 0, 0, TAU);
    g.stroke();
    g.setLineDash([]);
    g.lineWidth = 3;
    g.beginPath();
    g.ellipse(cx, gy + 3, e.w * (0.36 + 0.3 * u), 9 + 4 * u, 0, 0, TAU);
    g.stroke();
    // fallender Fels (beschleunigt)
    const y0 = -size - 20;
    const y1 = gy - size * 0.92;
    const y = y0 + (y1 - y0) * u * u;
    g.save();
    g.translate(cx, y + size / 2);
    g.rotate(u * 3.5 + e.id);
    g.drawImage(A.rock, -size / 2, -size / 2, size, size);
    g.restore();
    // Bewegungsschlieren + Steinchen
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.fillRect(cx - size * 0.25, y - 40 * u, 3, 34 * u);
    g.fillRect(cx + size * 0.2, y - 30 * u, 2, 26 * u);
    g.fillStyle = "#6a625a";
    for (let i = 0; i < 4; i += 1) {
      const py = y - 30 - i * 40 + u * 60;
      if (py > -10) g.fillRect(cx + (h1(e.id + i) - 0.5) * size, py, 5, 5);
    }
    return;
  }
  if (e.state === "active") {
    const t = e.stateT;
    // Einschlag: Fels am Boden, Staubring, Splitter
    g.fillStyle = "rgba(30,20,20,0.5)";
    g.beginPath();
    g.ellipse(cx, gy + 3, e.w * 0.62, 10, 0, 0, TAU);
    g.fill();
    g.save();
    g.translate(cx, gy - size * 0.42 + Math.min(1, t * 20) * 6);
    g.drawImage(A.rock, -size / 2, -size / 2, size, size);
    g.restore();
    const ring = 30 + t * 380;
    g.globalAlpha = Math.max(0, 0.7 - t * 1.6);
    g.drawImage(A.dust, cx - ring, gy - ring * 0.45, ring * 2, ring * 0.7);
    g.globalAlpha = 1;
    g.fillStyle = "#5e554d";
    for (let i = 0; i < 10; i += 1) {
      const a = Math.PI + (i / 9) * Math.PI;
      const d = t * (260 + h1(i + e.id) * 200);
      g.fillRect(cx + Math.cos(a) * d, gy - 20 + Math.sin(a) * d * 0.7 + t * t * 900, 6, 5);
    }
    return;
  }
  if (e.fx.hit) {
    // Nachher: Staub legt sich, Trümmer
    const t = e.stateT;
    if (t < 1.2) {
      g.globalAlpha = Math.max(0, 0.55 - t * 0.45);
      const s = 90 + t * 120;
      g.drawImage(A.dust, cx - s, gy - s * 0.5, s * 2, s * 0.8);
      g.globalAlpha = 1;
    }
    g.fillStyle = "#6a625a";
    for (let i = 0; i < 6; i += 1) {
      g.beginPath();
      g.ellipse(cx + (h1(e.id * 3 + i) - 0.5) * e.w * 1.3, gy + 1, 5 + (i % 3) * 3, 4, 0, Math.PI, TAU);
      g.fill();
    }
  }
}

/** Rollfels/Schneeball: gespiegelt gebackenes Sprite + Kugelmittelpunkt (Zellkoordinaten des gespiegelten Bildes) */
const ROLLER = {
  "alpen-rollstone": { cx: 300, cy: 250, d: 410 },
  "alpen-snowball": { cx: -1, cy: -1, d: 502 },
} as const;

function rollerSprite(A: SkinAssets, e: Ent, snowball: boolean): { b: Baked; disc: Baked | null; cx: number; cy: number } | null {
  const id = snowball ? "alpen-snowball" : "alpen-rollstone";
  const cell = A.bank.cell(id);
  if (!cell) return null;
  const R = ROLLER[id];
  const s = Math.round(((e.w * 1.1) / R.d) * 400) / 400;
  const b = A.bank.get(id, s, { flip: true });
  if (!b) return null;
  const cx = R.cx < 0 ? cell.w / 2 : cell.w - R.cx;
  const cy = R.cy < 0 ? cell.h / 2 : R.cy;
  // Rollfels: Staubfahne + Splitter stehen still, nur das Innere des Felsens dreht sich
  const disc = snowball ? null : A.bank.get(id, s, { flip: true, circle: [cx, cy, R.d * 0.46] });
  return { b, disc, cx, cy };
}

export function drawRoller(g: Ctx2D, A: SkinAssets, e: Ent, sx: number, sy: number, k: SkinCtx, snowball: boolean): void {
  const gy = k.groundY;
  const s = e.w * 1.12;
  const cx = sx + e.w / 2;
  const cy = sy + e.h / 2 - 2;
  if (e.state === "defeated") {
    g.globalAlpha = Math.max(0, 1 - e.stateT * 2);
    g.drawImage(A.dust, cx - s, cy - s * 0.6, s * 2, s * 1.2);
    g.globalAlpha = 1;
    return;
  }
  shadow(g, cx, gy, e.w * 0.5, 0.35);
  // Staub-/Schneefahne (rechts hinter dem Roller)
  if (k.quality > 0) {
    for (let i = 0; i < 4; i += 1) {
      const u = ((k.time * 3 + i / 4) % 1);
      const px = cx + e.w * 0.4 + u * 90;
      const ps = 20 + u * 40;
      g.globalAlpha = (1 - u) * 0.45;
      g.drawImage(A.dust, px - ps / 2, gy - ps * 0.7, ps, ps * 0.7);
    }
    g.globalAlpha = 1;
  }
  const ang = e.x / (e.w * 0.5);
  const hop = k.reduced ? 0 : Math.abs(Math.sin(e.x * 0.02)) * 4;
  const rb = rollerSprite(A, e, snowball);
  if (rb) {
    // Rollt nach links: Sprite gespiegelt (Staubfahne hinten), dreht sich um den Kugelmittelpunkt
    g.save();
    g.translate(cx, cy - hop);
    if (rb.disc) {
      g.drawImage(rb.b.c, -(rb.cx - rb.b.x0) * rb.b.s, -(rb.cy - rb.b.y0) * rb.b.s, rb.b.w, rb.b.h);
      g.rotate(ang);
      g.drawImage(rb.disc.c, -(rb.cx - rb.disc.x0) * rb.disc.s, -(rb.cy - rb.disc.y0) * rb.disc.s, rb.disc.w, rb.disc.h);
    } else {
      g.rotate(ang);
      g.drawImage(rb.b.c, -(rb.cx - rb.b.x0) * rb.b.s, -(rb.cy - rb.b.y0) * rb.b.s, rb.b.w, rb.b.h);
    }
    g.restore();
    return;
  }
  g.save();
  g.translate(cx, cy - hop);
  g.rotate(ang);
  g.drawImage(snowball ? A.snowball : A.rock, -s / 2, -s / 2, s, s);
  g.restore();
}

// --- Zonen / Bodenbeläge --------------------------------------------------------------------------------

/**
 * Aufwind-Thermik: Lichtsäule, aufsteigende Luftwirbel (Spiralbögen), Aufwärts-Chevrons, wirbelnde Blütenblätter und
 * Funkeln – klar als „hier trägt es dich nach oben“ lesbar. `p.low` = Rettungsthermik tief in der Schlucht.
 */
export function drawUpdraft(g: Ctx2D, A: SkinAssets, e: Ent, sx: number, sy: number, k: SkinCtx): void {
  const low = !!e.p.low;
  const w = e.w;
  const t = k.reduced ? k.time * 0.3 : k.time;
  const top = low ? sy + 30 : sy;
  const bottom = low ? Math.min(730, sy + e.h + 60) : sy + e.h;
  const span = Math.max(40, bottom - top);
  const cx = sx + w / 2;
  g.save();
  g.globalCompositeOperation = "lighter";
  // Lichtsäule (unten kräftiger)
  const grd = g.createLinearGradient(0, bottom, 0, top);
  grd.addColorStop(0, low ? "rgba(170,220,255,0.22)" : "rgba(200,238,255,0.24)");
  grd.addColorStop(0.7, "rgba(200,238,255,0.08)");
  grd.addColorStop(1, "rgba(200,238,255,0)");
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(sx + 4, bottom);
  g.lineTo(sx + w - 4, bottom);
  g.lineTo(sx + w - w * 0.1, top);
  g.lineTo(sx + w * 0.1, top);
  g.closePath();
  g.fill();
  // Aufwärts-Chevrons
  const nC = Math.max(2, Math.round(w / 110));
  g.strokeStyle = "rgba(255,255,255,0.4)";
  g.lineWidth = 3;
  g.lineCap = "round";
  g.beginPath();
  for (let i = 0; i < nC; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      const u = (((t * 0.55 + j / 3 + i * 0.37) % 1) + 1) % 1;
      const y = bottom - 20 - u * (span - 40);
      const x = sx + ((i + 0.5) * w) / nC;
      g.moveTo(x - 12, y + 9);
      g.lineTo(x, y);
      g.lineTo(x + 12, y + 9);
    }
  }
  g.stroke();
  // Spiralwirbel
  const n = Math.min(16, Math.max(4, Math.round((w / 60) * (k.quality === 0 ? 0.5 : 1))));
  g.strokeStyle = "rgba(255,255,255,0.62)";
  g.lineWidth = 2.2;
  g.beginPath();
  for (let i = 0; i < n; i += 1) {
    const ph = h1(e.id * 17 + i);
    const u = (((t * (0.32 + ph * 0.25) + ph) % 1) + 1) % 1;
    const yy = bottom - 10 - u * (span - 20);
    const xx = sx + 16 + ph * (w - 32) + Math.sin(t * 2 + i) * 10;
    const r = 7 + ph * 8;
    const a0 = t * 4 + i;
    g.moveTo(xx + Math.cos(a0) * r, yy + Math.sin(a0) * r * 0.6);
    g.arc(xx, yy, r, a0, a0 + Math.PI * 1.3);
  }
  g.stroke();
  g.globalCompositeOperation = "source-over";
  // wirbelnde Blütenblätter (Almwiese) bzw. Schneeflocken
  if (k.quality > 0) {
    const cols = k.snow > 0.4 ? ["#ffffff", "#e6f0ff"] : ["#ffffff", "#ffd6e8", "#fff2a8"];
    for (let i = 0; i < n; i += 1) {
      const ph = h1(e.id * 29 + i * 1.7);
      const u = (((t * (0.4 + ph * 0.3) + ph * 1.3) % 1) + 1) % 1;
      const yy = bottom - u * span;
      const xx = cx + Math.sin(t * 1.7 + i * 2.1) * w * 0.35;
      const a = Math.min(1, (bottom - yy) / 50) * Math.min(1, (yy - top) / 50);
      g.globalAlpha = 0.9 * a;
      g.fillStyle = cols[i % cols.length];
      g.beginPath();
      g.ellipse(xx, yy, 3.2, 1.6, t * 3 + i, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < n * 0.6; i += 1) {
      const ph = h1(e.id * 31 + i * 3.1);
      const yy = bottom - ((t * (60 + ph * 50) + ph * span) % span);
      const xx = sx + ph * w + Math.sin(t * 1.3 + i * 2) * 14;
      const a = Math.min(1, (bottom - yy) / 60) * Math.min(1, (yy - top) / 60);
      g.globalAlpha = 0.8 * a;
      g.drawImage(A.spark, xx - 5, yy - 5, 10, 10);
    }
    g.globalAlpha = 1;
  }
  g.restore();
}

/** Morast (grüne Stufen): bremst wie Tiefschnee */
function drawMud(g: Ctx2D, e: Ent, sx: number, k: SkinCtx): void {
  const gy = k.groundY;
  const w = e.w;
  g.fillStyle = "#5a3e24";
  g.strokeStyle = "rgba(40,26,12,0.8)";
  g.lineWidth = 2;
  g.beginPath();
  g.ellipse(sx + w / 2, gy + 3, w / 2 + 10, 9, 0, 0, TAU);
  g.fill();
  g.stroke();
  g.fillStyle = "rgba(120,160,200,0.45)";
  for (let i = 0; i < w / 70; i += 1) {
    const x = sx + 20 + h1(e.id + i) * (w - 40);
    g.beginPath();
    g.ellipse(x, gy + 2, 14 + h1(e.id * 2 + i) * 14, 3, 0, 0, TAU);
    g.fill();
  }
  const t = k.reduced ? 0 : k.time;
  g.fillStyle = "rgba(255,255,255,0.5)";
  for (let i = 0; i < 3; i += 1) {
    const u = (t * 0.7 + i / 3) % 1;
    const x = sx + w * (0.2 + 0.3 * i);
    g.globalAlpha = 1 - u;
    g.beginPath();
    g.arc(x, gy - u * 6, 2 + u * 2, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;
  // Grasbüschel am Rand
  g.strokeStyle = "#4f8a30";
  g.lineWidth = 1.5;
  g.beginPath();
  for (const x of [sx - 6, sx + w + 4]) {
    for (let b = -2; b <= 2; b += 1) {
      g.moveTo(x + b * 2, gy + 2);
      g.lineTo(x + b * 3, gy - 8);
    }
  }
  g.stroke();
}

export function drawDeepSnow(g: Ctx2D, A: SkinAssets, e: Ent, sx: number, k: SkinCtx): void {
  if (k.snow < 0.3) {
    drawMud(g, e, sx, k);
    return;
  }
  const gy = k.groundY;
  const w = e.w;
  g.fillStyle = "#f7fbff";
  g.strokeStyle = "rgba(90,130,180,0.55)";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(sx - 14, gy + 4);
  for (let i = 0; i <= 12; i += 1) {
    const u = i / 12;
    const bump = Math.sin(u * Math.PI) * 18 + Math.sin(u * 17 + e.id) * 3;
    g.lineTo(sx - 14 + u * (w + 28), gy - bump);
  }
  g.lineTo(sx + w + 14, gy + 4);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = "rgba(140,175,220,0.35)";
  g.beginPath();
  g.ellipse(sx + w * 0.5, gy - 2, w * 0.45, 5, 0, 0, TAU);
  g.fill();
  if (k.quality > 0 && !k.reduced) {
    g.save();
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < w / 40; i += 1) {
      const tw = 0.5 + 0.5 * Math.sin(k.time * 5 + i * 2.3 + e.id);
      g.globalAlpha = tw * 0.8;
      g.drawImage(A.spark, sx + h1(e.id + i) * w - 4, gy - 6 - h1(e.id * 2 + i) * 12, 8, 8);
    }
    g.restore();
  }
}

export function drawIce(g: Ctx2D, e: Ent, sx: number, k: SkinCtx): void {
  const gy = k.groundY;
  const w = e.w;
  const green = k.snow < 0.3;
  const grd = g.createLinearGradient(0, gy - 6, 0, gy + 14);
  if (green) {
    // nasse, glatte Felsplatte (Bachüberlauf)
    grd.addColorStop(0, "#d6e6ee");
    grd.addColorStop(0.4, "#8fa3b0");
    grd.addColorStop(1, "#5d6f7c");
  } else {
    grd.addColorStop(0, "#e9f7ff");
    grd.addColorStop(0.4, "#9fd0f2");
    grd.addColorStop(1, "#5a93c8");
  }
  g.fillStyle = grd;
  g.beginPath();
  rr(g, sx, gy - 5, w, 18, 6);
  g.fill();
  g.strokeStyle = "rgba(40,90,150,0.7)";
  g.lineWidth = 2;
  g.stroke();
  // wandernde Glanzlichter
  const t = k.reduced ? 0 : k.time;
  g.save();
  g.beginPath();
  rr(g, sx, gy - 5, w, 18, 6);
  g.clip();
  g.globalCompositeOperation = "lighter";
  g.fillStyle = "rgba(255,255,255,0.55)";
  for (let i = 0; i < 3; i += 1) {
    const x = sx + ((t * 260 + i * (w / 3)) % (w + 60)) - 30;
    g.beginPath();
    g.moveTo(x, gy - 5);
    g.lineTo(x + 18, gy - 5);
    g.lineTo(x + 6, gy + 13);
    g.lineTo(x - 12, gy + 13);
    g.closePath();
    g.fill();
  }
  g.restore();
  g.strokeStyle = "rgba(255,255,255,0.7)";
  g.lineWidth = 1;
  g.beginPath();
  for (let i = 0; i < w / 60; i += 1) {
    const x = sx + h1(e.id + i) * w;
    g.moveTo(x, gy - 3);
    g.lineTo(x + 12, gy + 5);
    g.lineTo(x + 6, gy + 11);
  }
  g.stroke();
}

export function drawSummitCross(g: Ctx2D, e: Ent, sx: number, sy: number, k: SkinCtx): void {
  const cx = sx + e.w / 2;
  const bot = sy + e.h;
  const h = e.h;
  // Steinsockel
  g.fillStyle = "#77706a";
  g.strokeStyle = "#221c18";
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(cx - 26, bot);
  g.lineTo(cx - 18, bot - 16);
  g.lineTo(cx + 16, bot - 18);
  g.lineTo(cx + 26, bot);
  g.closePath();
  g.fill();
  g.stroke();
  // Kreuz (Holz) mit Strahlenkranz
  const wood = g.createLinearGradient(cx - 6, 0, cx + 6, 0);
  wood.addColorStop(0, "#5a3a1e");
  wood.addColorStop(0.5, "#9a6a3a");
  wood.addColorStop(1, "#4a2e16");
  g.fillStyle = wood;
  g.fillRect(cx - 5, bot - h, 10, h - 12);
  g.fillRect(cx - 34, bot - h * 0.78, 68, 9);
  g.strokeStyle = "#1e120a";
  g.lineWidth = 2;
  g.strokeRect(cx - 5, bot - h, 10, h - 12);
  g.strokeRect(cx - 34, bot - h * 0.78, 68, 9);
  const t = k.reduced ? 0 : k.time;
  g.save();
  g.translate(cx, bot - h * 0.74);
  g.strokeStyle = `rgba(255,214,110,${(0.75 + 0.2 * Math.sin(t * 2)).toFixed(3)})`;
  g.lineWidth = 2;
  g.beginPath();
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * TAU + t * 0.2;
    g.moveTo(Math.cos(a) * 12, Math.sin(a) * 12);
    g.lineTo(Math.cos(a) * 22, Math.sin(a) * 22);
  }
  g.stroke();
  g.restore();
  // Gipfelbuch-Kästchen + Wimpel
  g.fillStyle = "#3c4048";
  g.fillRect(cx + 5, bot - h * 0.5, 12, 10);
  const flutter = Math.sin(t * 7) * 4;
  g.fillStyle = "#e0303a";
  g.beginPath();
  g.moveTo(cx + 5, bot - h + 4);
  g.lineTo(cx + 34, bot - h + 10 + flutter);
  g.lineTo(cx + 5, bot - h + 18);
  g.closePath();
  g.fill();
  g.fillStyle = "#ffffff";
  g.fillRect(cx + 5, bot - h + 9, 18, 4);
  if (k.snow > 0.3) snowCap(g, cx - 34, bot - h * 0.78, 68, k.snow, 4);
}

// --- Edelweiß-Münze -------------------------------------------------------------------------------------

export function drawEdelweiss(g: Ctx2D, A: SkinAssets, e: Ent, sx: number, sy: number, k: SkinCtx): void {
  const cx = sx + e.w / 2;
  const t = k.reduced ? 0 : k.time;
  const bob = Math.sin(t * 3 + e.id * 0.7) * 2.5;
  const cy = sy + e.h / 2 + bob;
  const s = e.w * 1.3;
  g.save();
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = 0.55 + 0.15 * Math.sin(t * 4 + e.id);
  g.drawImage(A.coinGlow, cx - s * 0.62, cy - s * 0.62, s * 1.24, s * 1.24);
  g.restore();
  g.save();
  g.translate(cx, cy);
  g.rotate(Math.sin(t * 1.6 + e.id) * 0.28);
  g.drawImage(A.edelweiss, -s / 2, -s / 2, s, s);
  g.restore();
  // Glitzer
  const tw = Math.sin(t * 5 + e.id * 1.3);
  if (tw > 0.6 && k.quality > 0) {
    g.save();
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = (tw - 0.6) * 2.5;
    g.drawImage(A.spark, cx + s * 0.18 - 6, cy - s * 0.32 - 6, 12, 12);
    g.restore();
  }
}
