/**
 * Wien – Entitäts-Skins: Straßenbahn, Fiaker, Tauben, Pfütze, Blitzeinschlag, Poller, Bauzaun, Gerüst, Trümmer,
 * Wirtshausschild, Dachziegel, Ziegel. Props werden genutzt, wenn vorhanden; sonst prozedurale Varianten.
 *
 * Hindernis-Props (Poller, Bauzaun, Schutt, Kranträger, Brezel-Schild) werden einmal in Zielgröße vorgerendert
 * (`PropSprites`, zweistufig verkleinert = flimmerfrei) und pro Frame nur noch geblittet.
 */
import { clamp, roundRect } from "../../draw-utils";
import type { Ent, PropLibrary, ViewState } from "../../types";
import { hash } from "../shared-a/gfx";

/** Props, die die Wien-Skins nutzen (werden vor dem Lauf geladen). */
export const WIEN_TRAM_PROPS = ["wien-tram-n0", "wien-tram-n1", "wien-tram-n2", "wien-tram-n3", "wien-tram-n4"];
export const WIEN_PROPS = ["wien-poller", "wien-bauzaun", "wien-rubble", "wien-crane-beam", "wien-sign", ...WIEN_TRAM_PROPS];

/** Alpha-Rand der zugeschnittenen Prop-Zellen (tools/fredrun2/pack_props.py) */
const PROP_PAD = 5;

/**
 * Vorgerendertes Prop (ggf. ausschnittweise). Koordinaten „Zelle“ = Pixel des Original-Bildes; `s` = logische px je
 * Zellpixel; (x0, y0) = Ursprung des gespeicherten Ausschnitts in Zellkoordinaten.
 */
export interface PropSprite {
  c: HTMLCanvasElement;
  s: number;
  x0: number;
  y0: number;
  /** logische Größe des Ausschnitts */
  w: number;
  h: number;
  /** Zellmaße */
  cw: number;
  ch: number;
}

export interface BakeOpts {
  /** Ausschnitt in Zellpixeln [x0, y0, x1, y1] (Standard: ganze Zelle) */
  crop?: [number, number, number, number];
  /** nur diese Rechtecke [x, y, w, h] (Zellpixel) sichtbar */
  clip?: Array<[number, number, number, number]>;
}

export class PropSprites {
  private readonly cache = new Map<string, PropSprite>();
  private k = 1;

  constructor(private props: PropLibrary | null = null) {}

  setProps(p: PropLibrary | null): void {
    this.props = p;
    this.cache.clear();
  }

  /** Pixelfaktor der Zeichenfläche (1 … 2); bei Änderung werden die Sprites neu gebacken. */
  setScale(k: number): void {
    const nk = clamp(k, 1, 2);
    if (Math.abs(nk - this.k) > 0.2) {
      this.k = nk;
      this.cache.clear();
    }
  }

  /** aktueller Pixelfaktor der Zeichenfläche */
  get scale(): number {
    return this.k;
  }

  has(id: string): boolean {
    return !!this.props?.has(id);
  }

  /** Logische px je Zellpixel, damit die sichtbare Silhouette `sw` breit ist. */
  scaleForWidth(id: string, sw: number): number {
    const cell = this.props?.cell(id);
    return cell ? sw / Math.max(1, cell.w - PROP_PAD * 2) : 1;
  }

  /** … damit die sichtbare Silhouette `sh` hoch ist. */
  scaleForHeight(id: string, sh: number): number {
    const cell = this.props?.cell(id);
    return cell ? sh / Math.max(1, cell.h - PROP_PAD * 2) : 1;
  }

  /** Prop `id` mit `s` logischen px je Zellpixel backen; null, wenn das Prop nicht geladen ist. */
  get(id: string, s: number, o: BakeOpts = {}): PropSprite | null {
    const props = this.props;
    if (!props?.has(id)) return null;
    const sq = Math.round(s * 1000) / 1000;
    const key = `${id}|${sq}|${o.crop ? o.crop.join(",") : ""}|${o.clip ? o.clip.map((r) => r.join(",")).join(";") : ""}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const cell = props.cell(id);
    if (!cell) return null;
    const spr = this.bake(props, id, cell.w, cell.h, sq, o);
    this.cache.set(key, spr);
    if (this.cache.size > 64) {
      const first = this.cache.keys().next().value;
      if (first !== undefined) this.cache.delete(first);
    }
    return spr;
  }

  private bake(props: PropLibrary, id: string, cw: number, ch: number, s: number, o: BakeOpts): PropSprite {
    const [x0, y0, x1, y1] = o.crop ?? [0, 0, cw, ch];
    const k = this.k;
    const w = (x1 - x0) * s;
    const h = (y1 - y0) * s;
    const W = Math.max(2, Math.round(w * k));
    const H = Math.max(2, Math.round(h * k));
    // Zielskala in Canvas-Pixeln je Zellpixel
    const t = (W / (x1 - x0));
    const paintTo = (g: CanvasRenderingContext2D, scale: number): void => {
      g.save();
      if (o.clip) {
        g.beginPath();
        for (const [rx, ry, rw, rh] of o.clip) g.rect((rx - x0) * scale, (ry - y0) * scale, rw * scale, rh * scale);
        g.clip();
      }
      props.draw(g, id, -x0 * scale, -y0 * scale, { scale, ax: 0, ay: 0 });
      g.restore();
    };
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d");
    if (g) {
      g.imageSmoothingQuality = "high";
      if (t < 0.55) {
        // starke Verkleinerung: erst auf die doppelte Zielgröße, dann herunter (kein Flimmern)
        const big = document.createElement("canvas");
        big.width = W * 2;
        big.height = H * 2;
        const bg = big.getContext("2d");
        if (bg) {
          bg.imageSmoothingQuality = "high";
          paintTo(bg, t * 2);
          g.drawImage(big, 0, 0, W, H);
        }
      } else {
        paintTo(g, t);
      }
    }
    return { c, s, x0, y0, w: W / k, h: H / k, cw, ch };
  }
}

/** Zeichnet den Sprite so, dass der Zellpunkt (cx, cy) auf (wx, wy) landet (ganzzahlig, wenn `snap`). */
export function blitSprite(g: CanvasRenderingContext2D, spr: PropSprite, cx: number, cy: number, wx: number, wy: number, snap = true): void {
  let dx = wx - (cx - spr.x0) * spr.s;
  let dy = wy - (cy - spr.y0) * spr.s;
  if (snap) {
    dx = Math.round(dx);
    dy = Math.round(dy);
  }
  g.drawImage(spr.c, dx, dy, spr.w, spr.h);
}

export interface SkinCtx {
  props: PropLibrary | null;
  /** vorgerenderte Hindernis-Props */
  sprites: PropSprites;
  /** Blitzhelligkeit 0..1 */
  flash: number;
  /** Stufe 0..7 (Brand/Asche beeinflusst Trümmer-Glut) */
  stage: number;
  reduced: boolean;
}

function shadow(g: CanvasRenderingContext2D, cx: number, groundY: number, rx: number, a = 0.35): void {
  g.fillStyle = `rgba(0,0,0,${a})`;
  g.beginPath();
  g.ellipse(cx, groundY + 3, rx, Math.max(3, rx * 0.12), 0, 0, Math.PI * 2);
  g.fill();
}

// ---------------------------------------------------------------------------------------------------
// Straßenbahn: der Wagenkasten wird pro Zug EINMAL vorgerendert (Breite variiert je Muster), pro Frame kommen nur
// Räder, Scheinwerfer, Funken und Glanz dazu.

const TRAM_OX = 4;
const TRAM_OY = 22;

interface TramFx {
  beam: HTMLCanvasElement;
  refl: HTMLCanvasElement;
  head: HTMLCanvasElement;
}
let tramFx: TramFx | null = null;

function makeCanvas2(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const g = c.getContext("2d");
  if (g) paint(g);
  return c;
}

let glowLamp: HTMLCanvasElement | null = null;
let glowEmber: HTMLCanvasElement | null = null;

/** Weicher Lichthof (vorgerendert): Warnleuchte bzw. Glut. */
function getGlow(kind: "lamp" | "ember"): HTMLCanvasElement {
  if (kind === "lamp" && glowLamp) return glowLamp;
  if (kind === "ember" && glowEmber) return glowEmber;
  const c = makeCanvas2(48, 48, (g) => {
    const grd = g.createRadialGradient(24, 24, 0, 24, 24, 24);
    if (kind === "lamp") {
      grd.addColorStop(0, "rgba(255,214,96,1)");
      grd.addColorStop(0.3, "rgba(255,176,44,0.55)");
      grd.addColorStop(1, "rgba(255,150,30,0)");
    } else {
      grd.addColorStop(0, "rgba(255,150,60,0.7)");
      grd.addColorStop(1, "rgba(255,90,30,0)");
    }
    g.fillStyle = grd;
    g.fillRect(0, 0, 48, 48);
  });
  if (kind === "lamp") glowLamp = c;
  else glowEmber = c;
  return c;
}

function getTramFx(): TramFx {
  if (tramFx) return tramFx;
  const beam = makeCanvas2(370, 86, (g) => {
    const grd = g.createLinearGradient(370, 0, 4, 0);
    grd.addColorStop(0, "rgba(255,236,180,0.32)");
    grd.addColorStop(1, "rgba(255,236,180,0)");
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(370, 2);
    g.lineTo(4, 14);
    g.lineTo(4, 84);
    g.lineTo(370, 18);
    g.closePath();
    g.fill();
  });
  const refl = makeCanvas2(320, 60, (g) => {
    const grd = g.createRadialGradient(160, 22, 4, 160, 22, 150);
    grd.addColorStop(0, "rgba(255,230,170,0.28)");
    grd.addColorStop(1, "rgba(255,230,170,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 320, 60);
  });
  const head = makeCanvas2(68, 68, (g) => {
    const grd = g.createRadialGradient(34, 34, 0, 34, 34, 34);
    grd.addColorStop(0, "rgba(255,250,220,1)");
    grd.addColorStop(0.3, "rgba(255,230,160,0.45)");
    grd.addColorStop(1, "rgba(255,230,160,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 68, 68);
  });
  tramFx = { beam, refl, head };
  return tramFx;
}

/** Statischer Wagenkasten (inkl. Drehgestelle, Stromabnehmer, Fenster, Fahrgäste, Türen, Zielanzeige). */
function paintTramBody(w: number, h: number, id: number): HTMLCanvasElement {
  return makeCanvas2(w + TRAM_OX * 2, h + TRAM_OY + 2, (g) => {
    const x = TRAM_OX;
    const y = TRAM_OY;
    const gy = y + h;
    const bodyB = y + h - 16;
    // Drehgestelle + Radscheiben
    const nBog = Math.max(2, Math.round(w / 230));
    for (let b = 0; b < nBog; b += 1) {
      const bx = x + 40 + (b * (w - 80)) / (nBog - 1);
      g.fillStyle = "#15171c";
      g.fillRect(bx - 38, bodyB - 4, 76, 14);
      for (const o of [-22, 22]) {
        g.fillStyle = "#23262d";
        g.beginPath();
        g.arc(bx + o, gy - 9, 10, 0, Math.PI * 2);
        g.fill();
      }
    }
    // Wagenkasten
    const nose = 26;
    g.beginPath();
    g.moveTo(x + nose, y + 4);
    g.lineTo(x + w - 10, y + 4);
    g.quadraticCurveTo(x + w, y + 4, x + w, y + 16);
    g.lineTo(x + w, bodyB);
    g.lineTo(x + 6, bodyB);
    g.quadraticCurveTo(x, bodyB, x + 1, bodyB - 12);
    g.lineTo(x + 6, y + 30);
    g.quadraticCurveTo(x + 10, y + 6, x + nose, y + 4);
    g.closePath();
    const bg = g.createLinearGradient(0, y, 0, bodyB);
    bg.addColorStop(0, "#e02a36");
    bg.addColorStop(0.55, "#b5121f");
    bg.addColorStop(1, "#6e0a13");
    g.fillStyle = bg;
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = "#2a0508";
    g.stroke();
    // Dach
    g.fillStyle = "#d9dce2";
    g.fillRect(x + nose - 4, y, w - nose - 4, 8);
    g.fillStyle = "#8e939d";
    g.fillRect(x + nose - 4, y + 7, w - nose - 4, 2);
    // Dachaufbauten (flach)
    g.fillStyle = "#aeb3bd";
    const nBox = Math.max(1, Math.floor(w / 260));
    for (let i = 0; i < nBox; i += 1) {
      const bx = x + 70 + i * ((w - 140) / Math.max(1, nBox - 1 || 1));
      roundRect(g, bx, y - 6, 60, 7, 3);
      g.fill();
    }
    // Stromabnehmer (eingeklappt)
    const px = x + w - 110;
    g.strokeStyle = "#3a3e47";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(px, y - 1);
    g.lineTo(px + 34, y - 16);
    g.lineTo(px + 62, y - 6);
    g.stroke();
    // Fensterband
    const winTop = y + 20;
    const winH = 46;
    const segs = Math.max(1, Math.round(w / 260));
    const segW = (w - nose) / segs;
    const wg = g.createLinearGradient(0, winTop, 0, winTop + winH);
    wg.addColorStop(0, "#f7d9a0");
    wg.addColorStop(1, "#b0763f");
    g.fillStyle = wg;
    g.fillRect(x + nose + 4, winTop, w - nose - 12, winH);
    // Fahrgäste
    g.fillStyle = "rgba(60,30,20,0.55)";
    for (let i = 0; i < Math.floor(w / 46); i += 1) {
      if (hash(id * 3 + i) < 0.45) continue;
      const hx = x + nose + 20 + i * 46 + hash(i + id) * 10;
      g.beginPath();
      g.arc(hx, winTop + winH - 16, 7, 0, Math.PI * 2);
      g.fill();
      g.fillRect(hx - 9, winTop + winH - 10, 18, 10);
    }
    // Fensterstege, Türen, Gelenke
    const dg = g.createLinearGradient(0, winTop, 0, bodyB);
    dg.addColorStop(0, "rgba(247,217,160,0.95)");
    dg.addColorStop(1, "rgba(120,70,40,0.9)");
    for (let sgi = 0; sgi < segs; sgi += 1) {
      const s0 = x + nose + sgi * segW;
      g.fillStyle = "#1c0e10";
      for (let p = s0 + 50; p < s0 + segW - 20; p += 50) g.fillRect(p, winTop, 5, winH);
      const dx = s0 + segW * 0.38;
      g.fillStyle = "#6b0a12";
      g.fillRect(dx, winTop - 6, 40, bodyB - winTop + 2);
      g.fillStyle = dg;
      g.fillRect(dx + 4, winTop - 2, 14, bodyB - winTop - 10);
      g.fillRect(dx + 22, winTop - 2, 14, bodyB - winTop - 10);
      if (sgi > 0) {
        g.fillStyle = "#1a1b20";
        g.fillRect(s0 - 6, y + 10, 12, bodyB - y - 12);
        g.fillStyle = "#34363d";
        for (let r = y + 14; r < bodyB - 4; r += 6) g.fillRect(s0 - 6, r, 12, 2);
      }
    }
    // Weißer Zierstreifen
    g.fillStyle = "#efe9dc";
    g.fillRect(x + 8, winTop + winH + 4, w - 12, 9);
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.fillRect(x + 8, winTop + winH + 12, w - 12, 2);
    // Front: Frontscheibe + Zielanzeige
    g.fillStyle = "#1b2430";
    g.beginPath();
    g.moveTo(x + nose + 2, winTop - 2);
    g.lineTo(x + 9, winTop + 10);
    g.lineTo(x + 6, winTop + winH);
    g.lineTo(x + nose + 2, winTop + winH);
    g.closePath();
    g.fill();
    g.fillStyle = "rgba(170,200,240,0.35)";
    g.beginPath();
    g.moveTo(x + nose - 2, winTop + 2);
    g.lineTo(x + 14, winTop + 12);
    g.lineTo(x + 13, winTop + 22);
    g.closePath();
    g.fill();
    g.fillStyle = "#111";
    g.fillRect(x + nose + 4, y + 8, 46, 11);
    g.fillStyle = "#ffae2b";
    g.font = "bold 9px system-ui, sans-serif";
    g.textBaseline = "middle";
    g.fillText("D  Ring", x + nose + 8, y + 14);
  });
}

/** logische px je Zellpixel der Straßenbahn-Sprites: Dachkante bis Radunterkante = TRAM_H (156) */
const TRAM_SPRITE_SCALE = 0.806;

/** Vorgerenderter Wagen aus einem Straßenbahn-Sprite (Front links), auf die Hitbox-Breite gestreckt. */
export interface TramSprite {
  c: HTMLCanvasElement;
  /** logische Größe */
  w: number;
  h: number;
  /** Ort der Radunterkante (Fußlinie) ab Oberkante, in logischen px */
  foot: number;
  /** Streckung gegenüber der natürlichen Länge (≈ 0.93 … 1.07) */
  sx: number;
}

/** Vorgerenderte Wagenkästen je Zug (kleiner LRU-Puffer). */
export class TramBodies {
  private readonly map = new Map<number, { c: HTMLCanvasElement; w: number; h: number }>();
  private readonly sprites = new Map<number, { key: string; s: TramSprite }>();

  get(e: Ent): HTMLCanvasElement {
    let hit = this.map.get(e.id);
    if (!hit || hit.w !== e.w || hit.h !== e.h) {
      hit = { c: paintTramBody(e.w, e.h, e.id), w: e.w, h: e.h };
      this.map.set(e.id, hit);
      if (this.map.size > 6) {
        const first = this.map.keys().next().value;
        if (first !== undefined) this.map.delete(first);
      }
    }
    return hit.c;
  }

  /** Sprite der passendsten Wagenlänge (kleinste Abweichung zur Hitbox-Breite); null ohne geladene Props. */
  sprite(e: Ent, props: PropLibrary | null, k: number): TramSprite | null {
    if (!props) return null;
    let id = "";
    let nat = 0;
    let best = Infinity;
    for (const pid of WIEN_TRAM_PROPS) {
      if (!props.has(pid)) continue;
      const cell = props.cell(pid);
      if (!cell) continue;
      const n = (cell.w - PROP_PAD * 2) * TRAM_SPRITE_SCALE;
      const d = Math.abs(n - e.w);
      if (d < best) {
        best = d;
        id = pid;
        nat = n;
      }
    }
    if (!id) return null;
    const key = `${id}|${e.w}|${k}`;
    const hit = this.sprites.get(e.id);
    if (hit && hit.key === key) return hit.s;
    const cell = props.cell(id);
    if (!cell) return null;
    const sx = e.w / nat;
    const W = Math.max(2, Math.round(cell.w * TRAM_SPRITE_SCALE * sx * k));
    const H = Math.max(2, Math.round(cell.h * TRAM_SPRITE_SCALE * k));
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d");
    if (g) {
      g.imageSmoothingQuality = "high";
      props.draw(g, id, W / 2, H / 2, { scale: TRAM_SPRITE_SCALE * k, sx, flipX: true, ax: 0.5, ay: 0.5 });
    }
    const s: TramSprite = { c, w: W / k, h: H / k, foot: (cell.h - PROP_PAD) * TRAM_SPRITE_SCALE, sx };
    this.sprites.set(e.id, { key, s });
    if (this.sprites.size > 6) {
      const first = this.sprites.keys().next().value;
      if (first !== undefined) this.sprites.delete(first);
    }
    return s;
  }
}

/** Scheinwerfer der Bim-Sprites (Front links): Abstand von der Vorderkante und Höhe über der Schiene, logische px */
const TRAM_LAMP = { front: 13, up: 55 };

function drawTramSprite(g: CanvasRenderingContext2D, e: Ent, sx: number, v: ViewState, c: SkinCtx, spr: TramSprite): void {
  const x = Math.round(sx);
  const gy = v.groundY;
  const fx = getTramFx();
  const lx = x + TRAM_LAMP.front;
  const ly = gy - TRAM_LAMP.up;
  g.save();
  shadow(g, x + e.w / 2, gy, e.w * 0.52, 0.45);
  // Scheinwerferkegel + Reflex auf nasser Straße
  g.globalCompositeOperation = "lighter";
  g.drawImage(fx.beam, lx - 372, ly - 8);
  g.drawImage(fx.refl, lx - 228, gy - 6);
  g.globalCompositeOperation = "source-over";
  const dx = Math.round(x + e.w / 2 - spr.w / 2);
  const dy = Math.round(gy - spr.foot);
  g.drawImage(spr.c, dx, dy, spr.w, spr.h);
  // Scheinwerfer + Blitz (nur bei Einschlag hellt der Wagen kurz auf)
  g.globalCompositeOperation = "lighter";
  g.drawImage(fx.head, lx - 34, ly - 34);
  if (c.flash > 0.04) {
    g.globalAlpha = Math.min(0.4, c.flash * 0.4);
    g.drawImage(spr.c, dx, dy, spr.w, spr.h);
  }
  g.restore();
}

export function drawTram(g: CanvasRenderingContext2D, e: Ent, sx: number, sy: number, v: ViewState, c: SkinCtx, bodies: TramBodies): void {
  const spr = bodies.sprite(e, c.props, c.sprites.scale);
  if (spr) {
    drawTramSprite(g, e, sx, v, c, spr);
    return;
  }
  const w = e.w;
  const h = e.h;
  const t = v.time;
  const x = Math.round(sx);
  const y = Math.round(sy);
  const gy = v.groundY;
  const bodyB = y + h - 16;
  const fx = getTramFx();
  g.save();
  shadow(g, x + w / 2, gy, w * 0.52, 0.45);
  // Scheinwerferkegel + Reflex auf nasser Straße
  g.globalCompositeOperation = "lighter";
  g.drawImage(fx.beam, x - 364, gy - 44);
  g.drawImage(fx.refl, x - 220, gy - 6);
  g.globalCompositeOperation = "source-over";
  // Wagenkasten (vorgerendert)
  g.drawImage(bodies.get(e), x - TRAM_OX, y - TRAM_OY);
  // Radspeichen (drehend)
  const nBog = Math.max(2, Math.round(w / 230));
  g.strokeStyle = "#5b606b";
  g.lineWidth = 2;
  g.beginPath();
  for (let b = 0; b < nBog; b += 1) {
    const bx = x + 40 + (b * (w - 80)) / (nBog - 1);
    const a = -t * 14 + b;
    const ca = Math.cos(a) * 7;
    const sa = Math.sin(a) * 7;
    for (const o of [-22, 22]) {
      g.moveTo(bx + o + ca, gy - 9 + sa);
      g.lineTo(bx + o - ca, gy - 9 - sa);
    }
  }
  g.stroke();
  // Funken am Stromabnehmer
  const px = x + w - 110;
  g.globalCompositeOperation = "lighter";
  if (!c.reduced && Math.sin(t * 9 + e.id) > 0.93) {
    g.fillStyle = "rgba(170,210,255,0.9)";
    for (let i = 0; i < 6; i += 1) {
      const a = hash(e.id + i + Math.floor(t * 20)) * Math.PI * 2;
      g.fillRect(px + 34 + Math.cos(a) * 10, y - 18 + Math.sin(a) * 8, 2, 2);
    }
    g.globalAlpha = 0.8;
    g.drawImage(fx.head, px + 8, y - 42, 52, 52);
    g.globalAlpha = 1;
  }
  // Scheinwerfer
  g.drawImage(fx.head, x + 8 - 34, bodyB - 20 - 34);
  // Nässe-Glanz / Blitzreflex
  g.fillStyle = `rgba(210,225,255,${(0.18 + c.flash * 0.6).toFixed(3)})`;
  g.fillRect(x + 26, y + 10, w - 34, 3);
  g.fillRect(x + 10, y + 82, w - 20, 2);
  g.globalCompositeOperation = "source-over";
  g.restore();
}

// ---------------------------------------------------------------------------------------------------
// Fiaker

export function drawFiaker(g: CanvasRenderingContext2D, e: Ent, sx: number, sy: number, v: ViewState, c: SkinCtx): void {
  const bob = Math.abs(Math.sin(v.time * 9 + e.id)) * 3;
  shadow(g, sx + e.w / 2, v.groundY, e.w * 0.5);
  if (c.props?.has("fiaker")) {
    c.props.draw(g, "fiaker", sx + e.w / 2, v.groundY + 2 - bob * 0.4, { h: e.h * 1.14, flipX: true });
    return;
  }
  // Fallback: Pferd + Kutsche
  const gy = v.groundY;
  g.save();
  g.lineWidth = 3;
  g.strokeStyle = "#1a1210";
  // Kutsche
  g.fillStyle = "#1e1e26";
  roundRect(g, sx + e.w * 0.46, sy + 26 - bob, e.w * 0.5, e.h * 0.52, 10);
  g.fill();
  g.stroke();
  g.fillStyle = "#e0b94a";
  for (const wx of [sx + e.w * 0.55, sx + e.w * 0.88]) {
    g.beginPath();
    g.arc(wx, gy - 24, 24, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(wx, gy - 24, 4, 0, Math.PI * 2);
    g.fill();
  }
  // Pferd
  g.fillStyle = "#6a3f22";
  g.beginPath();
  g.ellipse(sx + e.w * 0.25, sy + e.h * 0.42 - bob, e.w * 0.18, e.h * 0.14, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.beginPath();
  g.moveTo(sx + e.w * 0.12, sy + e.h * 0.38 - bob);
  g.lineTo(sx + e.w * 0.02, sy + e.h * 0.1 - bob);
  g.lineTo(sx + e.w * 0.1, sy + e.h * 0.06 - bob);
  g.lineTo(sx + e.w * 0.18, sy + e.h * 0.34 - bob);
  g.fill();
  g.stroke();
  const legT = v.time * 12;
  g.strokeStyle = "#4a2a16";
  g.lineWidth = 6;
  for (let l = 0; l < 4; l += 1) {
    const lx = sx + e.w * (0.12 + l * 0.08);
    g.beginPath();
    g.moveTo(lx, sy + e.h * 0.5 - bob);
    g.lineTo(lx + Math.sin(legT + l * 1.6) * 10, gy - 2);
    g.stroke();
  }
  g.restore();
}

// ---------------------------------------------------------------------------------------------------
// Taube

export function drawPigeon(g: CanvasRenderingContext2D, e: Ent, sx: number, sy: number, v: ViewState, c: SkinCtx, rim: HTMLCanvasElement | null): void {
  const cx = sx + e.w / 2;
  const cy = sy + e.h / 2;
  const defeated = e.state === "defeated";
  // helles Gegenlicht hinter jeder Taube: hebt die graue Taube vor grauen Fassaden ab
  if (rim && !defeated) {
    g.save();
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.5 + c.flash * 0.3;
    g.drawImage(rim, Math.round(cx - rim.width / 2), Math.round(cy - 2 - rim.height / 2));
    g.restore();
  }
  if (c.props?.has("pigeon-fly")) {
    g.save();
    if (defeated) {
      g.translate(cx, cy);
      g.rotate(e.stateT * 6);
      g.translate(-cx, -cy);
    }
    c.props.draw(g, "pigeon-fly", cx, cy - 3, { h: 58, flipX: true, t: v.time + e.id * 0.137 });
    g.restore();
    return;
  }
  const t = v.time * 16 + e.id * 1.3;
  const flap = Math.sin(t);
  g.save();
  g.translate(cx, cy);
  if (defeated) g.rotate(e.stateT * 6);
  // Körper
  g.fillStyle = "#8f95a3";
  g.strokeStyle = "#20232b";
  g.lineWidth = 2;
  g.beginPath();
  g.ellipse(2, 2, 17, 10, -0.15, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  // Schwanz
  g.fillStyle = "#5f6573";
  g.beginPath();
  g.moveTo(16, 2);
  g.lineTo(29, -2);
  g.lineTo(29, 8);
  g.closePath();
  g.fill();
  g.stroke();
  // Hals schillernd + Kopf
  g.fillStyle = "#4f7c68";
  g.beginPath();
  g.ellipse(-12, -3, 7, 7, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#7c5a8c";
  g.beginPath();
  g.ellipse(-11, 2, 5, 4, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#6f7584";
  g.beginPath();
  g.arc(-17, -7, 6, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = "#f39a3d";
  g.beginPath();
  g.moveTo(-22, -7);
  g.lineTo(-28, -5);
  g.lineTo(-22, -4);
  g.fill();
  g.fillStyle = "#ffcf5a";
  g.beginPath();
  g.arc(-18, -8, 1.8, 0, Math.PI * 2);
  g.fill();
  // Flügel
  g.fillStyle = "#b3b9c6";
  g.beginPath();
  g.moveTo(-4, -2);
  g.lineTo(10 + flap * 3, -4 - flap * 20);
  g.lineTo(18, -1 - flap * 10);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = "#3d414c";
  g.fillRect(8 + flap * 2, -3 - flap * 12, 6, 2.5);
  g.restore();
}

// ---------------------------------------------------------------------------------------------------
// Pfütze (Tempozone)

export function drawPuddle(g: CanvasRenderingContext2D, e: Ent, sx: number, v: ViewState, c: SkinCtx): void {
  const gy = v.groundY;
  const w = e.w;
  const cx = sx + w / 2;
  const h1 = hash(e.id * 1.7);
  const h2 = hash(e.id * 3.1);
  g.save();
  // unregelmäßige Wasserfläche aus drei Ellipsen
  g.beginPath();
  g.ellipse(cx, gy + 13, w * 0.5, 13, 0, 0, Math.PI * 2);
  g.ellipse(sx + w * (0.2 + h1 * 0.15), gy + 20, w * 0.22, 10, 0.05, 0, Math.PI * 2);
  g.ellipse(sx + w * (0.65 + h2 * 0.15), gy + 8, w * 0.25, 8, -0.05, 0, Math.PI * 2);
  const pg = g.createLinearGradient(0, gy, 0, gy + 30);
  pg.addColorStop(0, "#56668a");
  pg.addColorStop(0.3, "#1e2638");
  pg.addColorStop(1, "#0b0f18");
  g.fillStyle = pg;
  g.fill();
  g.clip();
  // Spiegelung: Himmel + Blitz + Lichter der Stadt
  g.globalCompositeOperation = "lighter";
  g.fillStyle = `rgba(150,175,230,${0.1 + c.flash * 0.75})`;
  g.fillRect(sx, gy, w, 6);
  for (let i = 0; i < Math.max(3, w / 70); i += 1) {
    const lx = sx + ((((hash(e.id + i * 2.3) * w + v.dist * 0.34) % w) + w) % w);
    const lg = g.createLinearGradient(0, gy, 0, gy + 28);
    lg.addColorStop(0, "rgba(255,200,120,0.4)");
    lg.addColorStop(1, "rgba(255,200,120,0)");
    g.fillStyle = lg;
    g.fillRect(lx, gy, 5 + hash(i) * 6, 28);
  }
  // Regenringe
  if (!c.reduced) {
    g.strokeStyle = "rgba(200,215,245,0.5)";
    g.lineWidth = 1.2;
    for (let i = 0; i < Math.max(3, w / 45); i += 1) {
      const ph = (v.time * 1.4 + hash(e.id + i * 3.1)) % 1;
      const rx = sx + hash(e.id * 7 + i) * w;
      const ry = gy + 5 + hash(e.id * 3 + i) * 16;
      g.globalAlpha = 1 - ph;
      g.beginPath();
      g.ellipse(rx, ry, 3 + ph * 16, 1 + ph * 4, 0, 0, Math.PI * 2);
      g.stroke();
    }
  }
  g.restore();
  // heller Rand hinten (nasse Kante)
  g.save();
  g.strokeStyle = "rgba(190,205,240,0.35)";
  g.lineWidth = 1.5;
  g.beginPath();
  g.ellipse(cx, gy + 13, w * 0.5, 13, 0, Math.PI * 1.05, Math.PI * 1.95);
  g.stroke();
  g.restore();
}

// ---------------------------------------------------------------------------------------------------
// Blitzeinschlag (Zone)

function boltPath(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, seed: number, rough: number): void {
  const n = 12;
  g.moveTo(x0, y0);
  for (let i = 1; i < n; i += 1) {
    const u = i / n;
    const jx = (hash(seed + i * 3.1) - 0.5) * rough * (1 - Math.abs(u - 0.5));
    g.lineTo(x0 + (x1 - x0) * u + jx, y0 + (y1 - y0) * u);
  }
  g.lineTo(x1, y1);
}

export function drawBolt(g: CanvasRenderingContext2D, e: Ent, sx: number, sy: number, v: ViewState, c: SkinCtx): void {
  const cx = sx + e.w / 2;
  const gy = v.groundY;
  const ph = e.fx.phaseT ?? 0;
  g.save();
  if (e.state === "warn") {
    // Bodenmarkierung: knisterndes Kreisfeld, wird schneller & heller
    const k = ph;
    const pulse = c.reduced ? 0.7 : 0.55 + 0.45 * Math.sin(v.time * (10 + k * 30));
    g.globalCompositeOperation = "lighter";
    const rg = g.createRadialGradient(cx, gy + 4, 2, cx, gy + 4, e.w * 0.9);
    rg.addColorStop(0, `rgba(160,200,255,${0.55 * pulse})`);
    rg.addColorStop(1, "rgba(120,160,255,0)");
    g.fillStyle = rg;
    g.beginPath();
    g.ellipse(cx, gy + 4, e.w * 0.9, 20, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = `rgba(210,230,255,${0.5 + 0.5 * pulse})`;
    g.lineWidth = 2.5;
    g.setLineDash([10, 8]);
    g.lineDashOffset = -v.time * 60;
    g.beginPath();
    g.ellipse(cx, gy + 4, e.w * 0.55, 11, 0, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    // Funken, die nach oben zucken
    if (!c.reduced) {
      g.strokeStyle = "rgba(200,225,255,0.85)";
      g.lineWidth = 1.6;
      g.beginPath();
      const n = 3 + Math.floor(k * 5);
      for (let i = 0; i < n; i += 1) {
        const s = Math.floor(v.time * 24) + i * 7 + e.id;
        const bx = cx + (hash(s) - 0.5) * e.w;
        boltPath(g, bx, gy, bx + (hash(s + 1) - 0.5) * 20, gy - 18 - hash(s + 2) * (30 + k * 60), s, 14);
      }
      g.stroke();
    }
    // Leitstrahl von oben (zeigt, wo es einschlägt)
    g.globalCompositeOperation = "lighter";
    const beam = g.createLinearGradient(0, 0, 0, gy);
    beam.addColorStop(0, "rgba(140,170,255,0)");
    beam.addColorStop(1, `rgba(160,190,255,${0.22 * k * pulse})`);
    g.fillStyle = beam;
    g.fillRect(cx - e.w * 0.35, 0, e.w * 0.7, gy);
    // Warnsymbol: Gefahrendreieck mit Blitz, darunter ein schrumpfender Countdown-Balken
    const iy = gy - 176 - (c.reduced ? 0 : Math.sin(v.time * 6) * 4);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 0.8 + 0.2 * pulse;
    g.lineJoin = "round";
    g.fillStyle = "#ffcc1f";
    g.strokeStyle = "#1a1300";
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(cx, iy - 30);
    g.lineTo(cx + 30, iy + 22);
    g.lineTo(cx - 30, iy + 22);
    g.closePath();
    g.fill();
    g.stroke();
    g.strokeStyle = `rgba(255,70,50,${0.55 + 0.45 * pulse})`;
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(cx, iy - 38);
    g.lineTo(cx + 37, iy + 26);
    g.lineTo(cx - 37, iy + 26);
    g.closePath();
    g.stroke();
    g.fillStyle = "#1a1300";
    g.beginPath();
    g.moveTo(cx + 3, iy - 16);
    g.lineTo(cx - 8, iy + 3);
    g.lineTo(cx - 1, iy + 3);
    g.lineTo(cx - 4, iy + 17);
    g.lineTo(cx + 8, iy - 2);
    g.lineTo(cx + 1, iy - 2);
    g.closePath();
    g.fill();
    // Countdown-Balken
    g.fillStyle = "rgba(20,24,40,0.85)";
    g.fillRect(cx - 30, iy + 32, 60, 6);
    g.fillStyle = "#ffffff";
    g.fillRect(cx - 29, iy + 33, 58 * (1 - k), 4);
    g.globalAlpha = 1;
  } else if (e.state === "active") {
    const flick = c.reduced ? 1 : 0.7 + 0.3 * Math.sin(v.time * 90);
    const seed = e.id * 17 + Math.floor(v.time * (c.reduced ? 4 : 30));
    g.globalCompositeOperation = "lighter";
    // Glühen
    const glow = g.createRadialGradient(cx, gy, 0, cx, gy, 220);
    glow.addColorStop(0, `rgba(200,225,255,${0.7 * flick})`);
    glow.addColorStop(1, "rgba(120,160,255,0)");
    g.fillStyle = glow;
    g.fillRect(cx - 220, gy - 220, 440, 300);
    // Hauptblitz + Äste
    g.lineCap = "round";
    g.lineJoin = "round";
    for (const [lw, col] of [
      [18, "rgba(120,160,255,0.25)"],
      [8, "rgba(170,205,255,0.6)"],
      [3.2, "rgba(255,255,255,1)"],
    ] as Array<[number, string]>) {
      g.strokeStyle = col;
      g.lineWidth = lw;
      g.beginPath();
      boltPath(g, cx + (hash(seed) - 0.5) * 140, -10, cx, gy, seed, 120);
      boltPath(g, cx + (hash(seed + 5) - 0.5) * 60, gy * 0.45, cx + (hash(seed + 9) - 0.5) * 220, gy * 0.8, seed + 50, 60);
      g.stroke();
    }
    // Aufprall
    g.fillStyle = `rgba(255,255,255,${0.9 * flick})`;
    g.beginPath();
    g.ellipse(cx, gy + 2, e.w * 0.7, 12, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(210,230,255,0.9)";
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < 7; i += 1) {
      const a = Math.PI + (i / 6) * Math.PI;
      boltPath(g, cx, gy, cx + Math.cos(a) * (60 + hash(seed + i) * 50), gy + Math.sin(a) * (40 + hash(seed + i + 3) * 60), seed + i * 9, 18);
    }
    g.stroke();
  } else if (e.age > 0.5) {
    // danach: Brandfleck + Rauch
    const k = clamp(1 - e.stateT / 1.2, 0, 1);
    if (k > 0 && e.cycle && e.cycle.phases[0].dur < e.age) {
      g.fillStyle = `rgba(10,10,12,${0.55 * k})`;
      g.beginPath();
      g.ellipse(cx, gy + 4, e.w * 0.6, 8, 0, 0, Math.PI * 2);
      g.fill();
      g.globalCompositeOperation = "lighter";
      g.fillStyle = `rgba(255,140,60,${0.35 * k})`;
      g.beginPath();
      g.ellipse(cx, gy + 3, e.w * 0.25, 4, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}

// ---------------------------------------------------------------------------------------------------
// Blöcke

export function drawPoller(g: CanvasRenderingContext2D, sx: number, sy: number, w: number, h: number, gy: number, c: SkinCtx): void {
  const spr = c.sprites.get("wien-poller", c.sprites.scaleForHeight("wien-poller", Math.round(h * 1.08)));
  if (spr) {
    // Stahlpoller: Fuß auf der Bodenlinie (3 px eingesunken), Trefferfläche liegt mittig hinter der Säule
    const cx = sx + w / 2;
    shadow(g, cx, gy, Math.max(11, (spr.cw - 10) * spr.s * 0.95));
    blitSprite(g, spr, spr.cw / 2, spr.ch - PROP_PAD, cx, gy + 3);
    return;
  }
  shadow(g, sx + w / 2, gy, w * 0.7);
  g.save();
  const grd = g.createLinearGradient(sx, 0, sx + w, 0);
  grd.addColorStop(0, "#1b1d22");
  grd.addColorStop(0.35, "#4b505b");
  grd.addColorStop(0.6, "#262930");
  grd.addColorStop(1, "#111216");
  g.fillStyle = grd;
  g.strokeStyle = "#07080a";
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(sx + 3, gy);
  g.lineTo(sx + 5, sy + 14);
  g.quadraticCurveTo(sx + w / 2, sy - 6, sx + w - 5, sy + 14);
  g.lineTo(sx + w - 3, gy);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = "#c9a13b";
  g.fillRect(sx + 4, sy + 18, w - 8, 5);
  g.fillStyle = "rgba(255,255,255,0.3)";
  g.fillRect(sx + w * 0.3, sy + 6, 2, h - 12);
  g.restore();
}

/** Warnleuchten des Bauzauns (Zellkoordinaten des Sprites, x von links, y von oben) */
const BAUZAUN_LAMPS: Array<[number, number]> = [
  [55, 43],
  [457, 43],
];

export function drawBauzaun(g: CanvasRenderingContext2D, sx: number, sy: number, w: number, h: number, gy: number, t: number, reduced: boolean, c: SkinCtx): void {
  const spr = c.sprites.get("wien-bauzaun", c.sprites.scaleForWidth("wien-bauzaun", Math.round(w * 1.08)));
  if (spr) {
    const cx = sx + w / 2;
    shadow(g, cx, gy, (spr.cw - 10) * spr.s * 0.56);
    blitSprite(g, spr, spr.cw / 2, spr.ch - PROP_PAD, cx, gy + 3);
    // Wechselblinker: die beiden Leuchten blinken abwechselnd (bei reduzierter Bewegung ruhig)
    const glow = getGlow("lamp");
    const phase = Math.sin(t * 7) > 0;
    const r = 21;
    g.save();
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < BAUZAUN_LAMPS.length; i += 1) {
      const lx = cx + (BAUZAUN_LAMPS[i][0] - spr.cw / 2) * spr.s;
      const ly = gy + 3 - (spr.ch - PROP_PAD - BAUZAUN_LAMPS[i][1]) * spr.s;
      g.globalAlpha = reduced ? 0.5 : (i === 0) === phase ? 0.95 : 0.15;
      g.drawImage(glow, lx - r, ly - r, r * 2, r * 2);
    }
    g.restore();
    return;
  }
  shadow(g, sx + w / 2, gy, w * 0.6);
  g.save();
  // Füße
  g.fillStyle = "#2b2d33";
  g.fillRect(sx - 4, gy - 8, 26, 8);
  g.fillRect(sx + w - 22, gy - 8, 26, 8);
  // Rahmen
  g.fillStyle = "#d8dbe0";
  g.fillRect(sx + 6, sy + 14, 5, h - 20);
  g.fillRect(sx + w - 11, sy + 14, 5, h - 20);
  // Warnbaken-Streifen
  const px = sx + 4;
  const pw = w - 8;
  const pyy = sy + 18;
  const ph = h * 0.46;
  g.save();
  roundRect(g, px, pyy, pw, ph, 4);
  g.clip();
  g.fillStyle = "#f4f4f2";
  g.fillRect(px, pyy, pw, ph);
  g.fillStyle = "#d3222e";
  for (let i = -2; i < pw / 14 + 2; i += 1) {
    g.beginPath();
    g.moveTo(px + i * 28, pyy + ph);
    g.lineTo(px + i * 28 + 14, pyy + ph);
    g.lineTo(px + i * 28 + 14 + ph, pyy);
    g.lineTo(px + i * 28 + ph, pyy);
    g.closePath();
    g.fill();
  }
  g.restore();
  g.strokeStyle = "#3a0b10";
  g.lineWidth = 2.5;
  roundRect(g, px, pyy, pw, ph, 4);
  g.stroke();
  // Blinklicht
  const on = reduced ? 0.7 : Math.sin(t * 7) > 0 ? 1 : 0.15;
  g.fillStyle = "#3b2f12";
  g.fillRect(sx + w / 2 - 6, sy + 4, 12, 12);
  g.globalCompositeOperation = "lighter";
  const lg = g.createRadialGradient(sx + w / 2, sy + 6, 0, sx + w / 2, sy + 6, 30);
  lg.addColorStop(0, `rgba(255,190,60,${on})`);
  lg.addColorStop(1, "rgba(255,190,60,0)");
  g.fillStyle = lg;
  g.fillRect(sx + w / 2 - 30, sy - 24, 60, 60);
  g.restore();
}

export function drawRubble(g: CanvasRenderingContext2D, e: Ent, sx: number, sy: number, gy: number, t: number, c: SkinCtx): void {
  const w = e.w;
  const h = e.h;
  const spr = c.sprites.get("wien-rubble", c.sprites.scaleForWidth("wien-rubble", Math.round(w * 1.06)));
  if (spr) {
    // Schutthaufen mit Bauhelm; späte Stufen: glimmende Glutnester dazwischen
    const cx = sx + w / 2;
    shadow(g, cx, gy, w * 0.6, 0.4);
    blitSprite(g, spr, spr.cw / 2, spr.ch - PROP_PAD, cx, gy + 3);
    if (c.stage >= 3) {
      const glow = getGlow("ember");
      const pulse = c.reduced ? 0.7 : 0.6 + 0.4 * Math.sin(t * 4 + e.id);
      g.save();
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = pulse;
      for (let i = 0; i < 4; i += 1) {
        const ex = sx + (0.2 + hash(e.id + i * 3) * 0.6) * w;
        const ey = gy - (0.2 + hash(e.id * 2 + i) * 0.4) * h;
        g.drawImage(glow, ex - 16, ey - 16, 32, 32);
      }
      g.restore();
    }
    return;
  }
  shadow(g, sx + w / 2, gy, w * 0.6, 0.4);
  g.save();
  // Balken
  g.fillStyle = "#2c1f17";
  g.save();
  g.translate(sx + w * 0.5, sy + h * 0.45);
  g.rotate(-0.35 + hash(e.id) * 0.2);
  g.fillRect(-w * 0.55, -7, w * 1.1, 14);
  g.fillStyle = "#1a120d";
  g.fillRect(-w * 0.55, 3, w * 1.1, 4);
  g.restore();
  // Ziegelhaufen
  const n = Math.round(w / 10);
  for (let i = 0; i < n; i += 1) {
    const u = hash(e.id * 3 + i * 1.7);
    const bx = sx + u * (w - 22);
    const top = gy - (1 - Math.abs(u - 0.5) * 2) * h * 0.95 * (0.5 + hash(i + e.id) * 0.5);
    const bh = 10 + hash(i * 2.1) * 8;
    g.fillStyle = i % 3 === 0 ? "#6d3a2a" : i % 3 === 1 ? "#834632" : "#57504a";
    g.save();
    g.translate(bx + 11, Math.max(top, sy) + bh / 2);
    g.rotate((hash(i * 5.5 + e.id) - 0.5) * 1.2);
    g.fillRect(-12, -bh / 2, 24, bh);
    g.strokeStyle = "rgba(0,0,0,0.5)";
    g.lineWidth = 1.5;
    g.strokeRect(-12, -bh / 2, 24, bh);
    g.restore();
  }
  // Grundhügel
  g.fillStyle = "#3a3431";
  g.beginPath();
  g.moveTo(sx - 6, gy);
  g.quadraticCurveTo(sx + w * 0.5, sy + h * 0.25, sx + w + 6, gy);
  g.closePath();
  g.fill();
  g.strokeStyle = "#141110";
  g.lineWidth = 2.5;
  g.stroke();
  // Glut (späte Stufen)
  if (c.stage >= 3) {
    g.globalCompositeOperation = "lighter";
    const pulse = c.reduced ? 0.7 : 0.6 + 0.4 * Math.sin(t * 4 + e.id);
    for (let i = 0; i < 4; i += 1) {
      const ex = sx + (0.2 + hash(e.id + i * 3) * 0.6) * w;
      const ey = gy - (0.2 + hash(e.id * 2 + i) * 0.4) * h;
      const eg = g.createRadialGradient(ex, ey, 0, ex, ey, 16);
      eg.addColorStop(0, `rgba(255,150,60,${0.7 * pulse})`);
      eg.addColorStop(1, "rgba(255,90,30,0)");
      g.fillStyle = eg;
      g.fillRect(ex - 16, ey - 16, 32, 32);
    }
  }
  // Randlicht (Lesbarkeit)
  g.globalCompositeOperation = "source-over";
  g.strokeStyle = "rgba(255,200,160,0.35)";
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(sx + w * 0.15, gy - h * 0.55);
  g.quadraticCurveTo(sx + w * 0.5, sy + h * 0.2, sx + w * 0.85, gy - h * 0.55);
  g.stroke();
  g.restore();
}

// ---------------------------------------------------------------------------------------------------
// Überhänge

export function drawScaffold(g: CanvasRenderingContext2D, e: Ent, sx: number, sy: number, v: ViewState): void {
  const w = e.w;
  const bottom = sy + e.h;
  g.save();
  // Netz (halbtransparent) + Rohre
  g.fillStyle = "rgba(40,90,60,0.35)";
  g.fillRect(sx, -10, w, bottom - 26 + 10);
  g.strokeStyle = "rgba(30,60,40,0.4)";
  g.lineWidth = 1;
  g.beginPath();
  for (let x = sx; x < sx + w; x += 12) {
    g.moveTo(x, -10);
    g.lineTo(x, bottom - 26);
  }
  g.stroke();
  g.strokeStyle = "#8d949e";
  g.lineWidth = 5;
  g.beginPath();
  for (const px of [sx + 6, sx + w - 6, ...(w > 280 ? [sx + w / 2] : [])]) {
    g.moveTo(px, -10);
    g.lineTo(px, bottom);
  }
  for (let y = bottom - 120; y > -10; y -= 110) {
    g.moveTo(sx, y);
    g.lineTo(sx + w, y);
  }
  g.stroke();
  // Bohlen
  const pg = g.createLinearGradient(0, bottom - 26, 0, bottom);
  pg.addColorStop(0, "#c28a4a");
  pg.addColorStop(1, "#7c5128");
  g.fillStyle = pg;
  g.fillRect(sx - 8, bottom - 26, w + 16, 22);
  g.strokeStyle = "#2e1c0c";
  g.lineWidth = 2.5;
  g.strokeRect(sx - 8, bottom - 26, w + 16, 22);
  g.fillStyle = "rgba(0,0,0,0.25)";
  for (let x = sx + 30; x < sx + w; x += 60) g.fillRect(x, bottom - 26, 2, 22);
  // Warnstreifen unten
  g.save();
  g.beginPath();
  g.rect(sx - 8, bottom - 6, w + 16, 8);
  g.clip();
  g.fillStyle = "#ffd23a";
  g.fillRect(sx - 8, bottom - 6, w + 16, 8);
  g.fillStyle = "#1c1c1c";
  for (let x = sx - 8; x < sx + w + 16; x += 20) {
    g.beginPath();
    g.moveTo(x, bottom + 2);
    g.lineTo(x + 10, bottom + 2);
    g.lineTo(x + 18, bottom - 6);
    g.lineTo(x + 8, bottom - 6);
    g.fill();
  }
  g.restore();
  // Warnlampe
  const on = v.reducedMotion ? 0.7 : Math.sin(v.time * 6 + e.id) > 0 ? 1 : 0.2;
  g.globalCompositeOperation = "lighter";
  const lg = g.createRadialGradient(sx + w / 2, bottom + 4, 0, sx + w / 2, bottom + 4, 26);
  lg.addColorStop(0, `rgba(255,170,40,${on})`);
  lg.addColorStop(1, "rgba(255,170,40,0)");
  g.fillStyle = lg;
  g.fillRect(sx + w / 2 - 26, bottom - 22, 52, 52);
  g.restore();
}

/** Kranseil-Enden am oberen Bildrand des Trägers (Zellkoordinaten: Mitte x, Breite) */
const BEAM_CABLES: Array<[number, number]> = [
  [294, 13],
  [337.5, 13],
];

/** Stahlseil (Kontur, Stahlkern, Litzen) von (x, y0) nach oben bis y1. */
function steelCable(g: CanvasRenderingContext2D, x: number, y0: number, y1: number, wd: number): void {
  g.lineCap = "butt";
  g.strokeStyle = "#0a0a0c";
  g.lineWidth = wd;
  g.beginPath();
  g.moveTo(x, y0);
  g.lineTo(x, y1);
  g.stroke();
  g.strokeStyle = "#7d8288";
  g.lineWidth = wd * 0.42;
  g.stroke();
  g.strokeStyle = "rgba(0,0,0,0.55)";
  g.setLineDash([2, 4]);
  g.stroke();
  g.setLineDash([]);
}

export function drawBurningBeam(g: CanvasRenderingContext2D, e: Ent, sx: number, sy: number, v: ViewState, c: SkinCtx): void {
  const w = e.w;
  const bottom = sy + e.h;
  const t = v.time;
  // Kranträger: Balken deckt die Trefferfläche, Ketten + Haken darüber, die Seile laufen aus dem Bild
  const beamW = Math.max(8, Math.round((w * 1.06) / 8) * 8);
  const spr = c.sprites.get("wien-crane-beam", c.sprites.scaleForWidth("wien-crane-beam", beamW));
  if (spr) {
    const cx = sx + w / 2;
    const by = bottom - 2;
    blitSprite(g, spr, spr.cw / 2, spr.ch - PROP_PAD, cx, by, false);
    const top = by - (spr.ch - PROP_PAD * 2) * spr.s;
    for (const [ccx, cw] of BEAM_CABLES) steelCable(g, cx + (ccx - spr.cw / 2) * spr.s, top + 2, -12, Math.max(3, cw * spr.s));
    return;
  }
  g.save();
  // Ketten nach oben
  g.strokeStyle = "#2a2522";
  g.lineWidth = 4;
  g.setLineDash([8, 4]);
  g.beginPath();
  g.moveTo(sx + 20, bottom - 40);
  g.lineTo(sx + 50, -10);
  g.moveTo(sx + w - 20, bottom - 40);
  g.lineTo(sx + w - 60, -10);
  g.stroke();
  g.setLineDash([]);
  // Balken (verkohlt)
  const bg = g.createLinearGradient(0, bottom - 44, 0, bottom);
  bg.addColorStop(0, "#4a2d1c");
  bg.addColorStop(0.5, "#2a1911");
  bg.addColorStop(1, "#140c08");
  g.fillStyle = bg;
  g.beginPath();
  g.moveTo(sx - 10, bottom - 40);
  g.lineTo(sx + w + 10, bottom - 46);
  g.lineTo(sx + w + 12, bottom - 2);
  g.lineTo(sx - 8, bottom);
  g.closePath();
  g.fill();
  g.strokeStyle = "#0b0604";
  g.lineWidth = 3;
  g.stroke();
  // Glutrisse
  g.globalCompositeOperation = "lighter";
  g.strokeStyle = "rgba(255,120,40,0.85)";
  g.lineWidth = 2;
  g.beginPath();
  for (let x = sx + 10; x < sx + w; x += 34) {
    g.moveTo(x, bottom - 30 + hash(x) * 10);
    g.lineTo(x + 14, bottom - 18 + hash(x + 1) * 10);
  }
  g.stroke();
  // Flammen oben
  const n = Math.max(3, Math.round(w / 40));
  for (let i = 0; i < n; i += 1) {
    const fx = sx + ((i + 0.5) / n) * w;
    const fh = 34 + 16 * Math.sin(t * 9 + i * 1.7) + hash(i + e.id) * 20;
    const fg = g.createLinearGradient(0, bottom - 44 - fh, 0, bottom - 40);
    fg.addColorStop(0, "rgba(255,90,20,0)");
    fg.addColorStop(0.4, "rgba(255,140,40,0.75)");
    fg.addColorStop(1, "rgba(255,230,140,0.95)");
    g.fillStyle = fg;
    g.beginPath();
    g.moveTo(fx - 16, bottom - 40);
    g.quadraticCurveTo(fx - 10 + Math.sin(t * 7 + i) * 6, bottom - 44 - fh * 0.6, fx + Math.sin(t * 5 + i) * 8, bottom - 44 - fh);
    g.quadraticCurveTo(fx + 12, bottom - 44 - fh * 0.5, fx + 16, bottom - 40);
    g.closePath();
    g.fill();
  }
  const glow = g.createRadialGradient(sx + w / 2, bottom - 30, 10, sx + w / 2, bottom - 30, w * 0.8);
  glow.addColorStop(0, "rgba(255,120,40,0.35)");
  glow.addColorStop(1, "rgba(255,120,40,0)");
  g.fillStyle = glow;
  g.fillRect(sx - w * 0.3, bottom - w * 0.8, w * 1.6, w * 1.2);
  g.restore();
}

// ---------------------------------------------------------------------------------------------------
// Wirtshausschild (Pendel)

/** Brezel-Schild (Zellkoordinaten): Schwerpunkt, Schnitt Ausleger/Schild, Aufhängeketten, Breite der Brezel */
const SIGN = { px: 218, py: 343, cut: 110, chainL: 137, chainR: 307, barY: 106, pretzelW: 308 };

/** Kettenstrang von (x0, y0) nach (x1, y1): dunkle Kontur, Stahlkern, Gliedernähte. */
function chainStroke(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, wd: number): void {
  g.lineCap = "round";
  g.strokeStyle = "#0b0b0d";
  g.lineWidth = wd + 2.4;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
  g.strokeStyle = "#8b919b";
  g.lineWidth = wd;
  g.stroke();
  g.strokeStyle = "rgba(11,11,13,0.75)";
  g.setLineDash([1.6, 6]);
  g.stroke();
  g.setLineDash([]);
}

export function drawSign(g: CanvasRenderingContext2D, e: Ent, sx: number, sy: number, v: ViewState, c: SkinCtx): void {
  const ax = e.p.ax - v.dist;
  const ay = e.p.ay;
  const cx = sx + e.w / 2;
  const cy = sy + e.h / 2;
  const r = e.w / 2;
  // Brezel-Schild: Eisenausleger (fest) + Kette + Schild (pendelt mit dem Winkel der Physik)
  const sb = (e.w * 0.97) / SIGN.pretzelW;
  const body = c.sprites.get("wien-sign", sb, {
    crop: [0, SIGN.cut, 404, 512],
    clip: [
      [100, SIGN.cut, 304, 402],
      [70, 174, 30, 338],
    ],
  });
  const bracket = c.sprites.get("wien-sign", sb * 1.3, {
    crop: [0, 0, 404, 254],
    clip: [
      [0, 0, 404, SIGN.cut],
      [0, SIGN.cut, 100, 64],
      [0, 174, 70, 80],
    ],
  });
  if (body && bracket) {
    blitSprite(g, bracket, (SIGN.chainL + SIGN.chainR) / 2, SIGN.barY, ax, ay, false);
    // Koordinaten mit Ursprung in der Schildmitte; die –y-Achse zeigt exakt zum Aufhängepunkt
    const len = Math.hypot(cx - ax, cy - ay);
    const yCut = (SIGN.cut - SIGN.py) * sb;
    const xl = (SIGN.chainL - SIGN.px) * sb;
    const xr = (SIGN.chainR - SIGN.px) * sb;
    const my = yCut - 12;
    g.save();
    g.translate(cx, cy);
    g.rotate(e.fx.angle ? -e.fx.angle : 0);
    chainStroke(g, 0, my, 0, -len + 1, 2.2);
    chainStroke(g, xl, yCut + 2, 0, my, 1.8);
    chainStroke(g, xr, yCut + 2, 0, my, 1.8);
    g.strokeStyle = "#0b0b0d";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(0, my, 3, 0, Math.PI * 2);
    g.stroke();
    g.drawImage(body.c, -(SIGN.px - body.x0) * body.s, -(SIGN.py - body.y0) * body.s, body.w, body.h);
    g.restore();
    return;
  }
  g.save();
  // Ausleger oben
  g.fillStyle = "#1c1b1d";
  g.fillRect(ax - 60, Math.max(-10, ay - 8), 120, 8);
  // Stange / Kette
  g.strokeStyle = "#2a2729";
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(ax, ay);
  g.lineTo(cx, cy - r);
  g.stroke();
  // Schild (Schmiedeeisen-Rahmen + Brezel)
  g.translate(cx, cy);
  g.rotate(e.fx.angle ? -e.fx.angle : 0);
  g.fillStyle = "#b8862e";
  g.strokeStyle = "#241604";
  g.lineWidth = 4;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = "#e9c46a";
  g.beginPath();
  g.arc(0, 0, r * 0.78, 0, Math.PI * 2);
  g.fill();
  // Brezel
  g.strokeStyle = "#7a3f12";
  g.lineWidth = 6;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(-r * 0.5, r * 0.25);
  g.bezierCurveTo(-r * 0.7, -r * 0.6, r * 0.1, -r * 0.5, r * 0.25, r * 0.3);
  g.moveTo(r * 0.5, r * 0.25);
  g.bezierCurveTo(r * 0.7, -r * 0.6, -r * 0.1, -r * 0.5, -r * 0.25, r * 0.3);
  g.stroke();
  // Schnörkel
  g.strokeStyle = "#241604";
  g.lineWidth = 2.5;
  g.beginPath();
  g.arc(0, 0, r + 6, Math.PI * 1.1, Math.PI * 1.9);
  g.stroke();
  g.restore();
}

// ---------------------------------------------------------------------------------------------------
// Geschosse

export function drawRoofTile(g: CanvasRenderingContext2D, e: Ent, sx: number, sy: number, v: ViewState): void {
  const cx = sx + e.w / 2;
  const cy = sy + e.h / 2;
  g.save();
  // Windspur
  g.strokeStyle = "rgba(210,220,240,0.35)";
  g.lineWidth = 2;
  g.beginPath();
  for (let i = 0; i < 3; i += 1) {
    g.moveTo(cx + 20, cy - 8 + i * 8);
    g.lineTo(cx + 70 + i * 14, cy - 8 + i * 8);
  }
  g.stroke();
  // Warnschein (Lesbarkeit vor dunklen Fassaden)
  g.globalCompositeOperation = "lighter";
  const rg = g.createRadialGradient(cx, cy, 2, cx, cy, e.w * 0.95);
  rg.addColorStop(0, "rgba(255,150,90,0.45)");
  rg.addColorStop(1, "rgba(255,120,60,0)");
  g.fillStyle = rg;
  g.fillRect(cx - e.w, cy - e.w, e.w * 2, e.w * 2);
  g.globalCompositeOperation = "source-over";
  g.translate(cx, cy);
  g.rotate(v.time * -9 + e.id);
  g.scale(1.25, 1.25);
  g.fillStyle = "#c9502e";
  g.strokeStyle = "#3a120a";
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(-e.w / 2, -e.h * 0.3);
  g.quadraticCurveTo(0, -e.h * 0.75, e.w / 2, -e.h * 0.3);
  g.lineTo(e.w / 2, e.h * 0.3);
  g.quadraticCurveTo(0, -e.h * 0.15, -e.w / 2, e.h * 0.3);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = "rgba(255,210,170,0.35)";
  g.fillRect(-e.w * 0.35, -e.h * 0.42, e.w * 0.5, 3);
  g.restore();
}

export function drawBrick(g: CanvasRenderingContext2D, e: Ent, sx: number, sy: number, v: ViewState): void {
  const cx = sx + e.w / 2;
  const cy = sy + e.h / 2;
  const gy = v.groundY;
  const land = e.p.landY ?? gy;
  g.save();
  if (sy + e.h >= land) {
    // Aufprall: Staubwolke + Splitter
    const over = (sy + e.h - land) / Math.max(200, Math.abs(e.vy));
    if (over < 0.5) {
      const k = over / 0.5;
      g.fillStyle = `rgba(150,130,115,${0.55 * (1 - k)})`;
      g.beginPath();
      g.ellipse(cx, land - 6, 20 + k * 60, 10 + k * 22, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = `rgba(140,62,40,${1 - k})`;
      for (let i = 0; i < 6; i += 1) {
        const a = Math.PI + (i / 5) * Math.PI;
        g.fillRect(cx + Math.cos(a) * (10 + k * 60), land - 8 + Math.sin(a) * (6 + k * 40) + k * k * 60, 7, 5);
      }
    }
  } else if (cy < gy) {
    // Schatten wächst, je näher der Ziegel dem Boden kommt
    const k = clamp(1 - (gy - cy) / 700, 0.15, 1);
    g.fillStyle = `rgba(0,0,0,${0.5 * k})`;
    g.beginPath();
    g.ellipse(cx, gy + 3, 10 + 30 * k, 4 + 3 * k, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = `rgba(255,90,60,${0.7 * k})`;
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(cx, gy + 3, 16 + 34 * k, 6 + 3 * k, 0, 0, Math.PI * 2);
    g.stroke();
    // Fallspur
    g.strokeStyle = "rgba(230,200,180,0.25)";
    g.lineWidth = e.w * 0.5;
    g.beginPath();
    g.moveTo(cx, cy - 10);
    g.lineTo(cx, cy - 10 - Math.min(160, Math.abs(e.vy) * 0.12));
    g.stroke();
    g.translate(cx, cy);
    g.rotate(e.age * 5 + e.id);
    g.fillStyle = "#8c3e28";
    g.strokeStyle = "#2a0d06";
    g.lineWidth = 2.5;
    g.fillRect(-e.w / 2, -e.h / 2, e.w, e.h);
    g.strokeRect(-e.w / 2, -e.h / 2, e.w, e.h);
    g.fillStyle = "rgba(255,200,170,0.3)";
    g.fillRect(-e.w / 2 + 3, -e.h / 2 + 3, e.w - 6, 3);
  }
  g.restore();
}
