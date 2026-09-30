/**
 * Finanzamt – Kulissen: gemalte Fernkulisse (Originalbilder, gespiegelt gekachelt mit unspiegelbaren Schrift-Stellen,
 * pro Stufe eingefärbt) und prozedurale, einmal vorgerenderte Ebenen: Decke mit Einbauleuchten, Mittelgrund je Stufe
 * (Schreibtisch-Inseln, Regale, Glasbüros, Archiv, Serverschränke & Tresortür) samt Lichtkacheln, Säulen, Hängeleuchten,
 * Boden (Linoleum/Riffelblech), Vordergrund-Deckenträger und die Taschenlampen-Maske.
 */
import { paint, rr, wrapDraw, type Ctx2D } from "../shared-b/canvas";
import { mulberry } from "../shared-b/color";
import { BACK_GRADE, PALETTE, TEXT_PATCHES } from "./stages";

const TAU = Math.PI * 2;

export function rgbaHex(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

// =================================================================================================
// Gemalte Fernkulisse

/** Deckende Offscreen-Fläche (alpha:false → schneller Kopier-Pfad beim Blitten) */
function paintOpaque(w: number, h: number, draw: (g: Ctx2D) => void): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const g = (c.getContext("2d", { alpha: false }) ?? c.getContext("2d")) as Ctx2D;
  draw(g);
  return c;
}

export const BACK_SCALE = 0.76;
/** Quellzeilen, die übernommen werden (Rest = dunkle Laufbahn des Originals) */
const BACK_CROP = 560;
export const BACK_TILE_W = Math.round(2172 * BACK_SCALE);
export const BACK_H = Math.round(BACK_CROP * BACK_SCALE);
/** Bildschirm-y der Oberkante / der gemalten Bodenlinie */
export const BACK_Y = 86;
export const BACK_FLOOR_Y = BACK_Y + Math.round(497 * BACK_SCALE);

export class FaBackdrop {
  private imgs = new Map<string, HTMLImageElement | null>();
  private cache = new Map<number, HTMLCanvasElement>();
  private order: number[] = [];

  constructor(private readonly urls: readonly string[]) {}

  async load(image: (url: string) => Promise<HTMLImageElement | null>): Promise<void> {
    const uniq = [...new Set(this.urls)];
    const res = await Promise.all(uniq.map((u) => image(u).catch(() => null)));
    uniq.forEach((u, i) => this.imgs.set(u, res[i]));
  }

  get ready(): boolean {
    for (const v of this.imgs.values()) if (v) return true;
    return false;
  }

  private img(stage: number): HTMLImageElement | null {
    const own = this.imgs.get(this.urls[stage]);
    if (own) return own;
    for (const v of this.imgs.values()) if (v) return v;
    return null;
  }

  has(stage: number): boolean {
    return this.cache.has(stage);
  }

  tile(stage: number): HTMLCanvasElement | null {
    const hit = this.cache.get(stage);
    if (hit) return hit;
    const img = this.img(stage);
    if (!img) return null;
    const W = BACK_TILE_W;
    const H = BACK_H;
    const sh = Math.min(img.height, Math.round((BACK_CROP / 665) * img.height));
    const k = W / img.width;
    const c = paintOpaque(W * 2, H, (g) => {
      g.imageSmoothingQuality = "high";
      g.drawImage(img, 0, 0, img.width, sh, 0, 0, W, H);
      g.save();
      g.translate(W * 2, 0);
      g.scale(-1, 1);
      g.drawImage(img, 0, 0, img.width, sh, 0, 0, W, H);
      g.restore();
      // Schrift (Schild, „BAO“, „31.12.“, „§“) in der gespiegelten Hälfte lesbar nachzeichnen
      const sx = img.width / 2172;
      for (const [L, T, PW, PH] of TEXT_PATCHES) {
        const dx = W * 2 - (L + PW) * k * sx;
        g.drawImage(img, L * sx, T * sx, PW * sx, PH * sx, dx, T * k * sx, PW * k * sx, PH * k * sx);
      }
      // Stufen-Einfärbung (atmosphärische Tiefe)
      const gr = BACK_GRADE[stage];
      g.globalCompositeOperation = "source-atop";
      g.fillStyle = rgbaHex(gr.tint, gr.a);
      g.fillRect(0, 0, W * 2, H);
      const hz = g.createLinearGradient(0, H * 0.35, 0, H);
      hz.addColorStop(0, rgbaHex(gr.haze, 0));
      hz.addColorStop(1, rgbaHex(gr.haze, gr.hazeA));
      g.fillStyle = hz;
      g.fillRect(0, 0, W * 2, H);
      if (stage === 4) {
        // Serverkeller: kalt-grünlich, schwere Schatten oben
        g.fillStyle = "rgba(0,40,36,0.28)";
        g.fillRect(0, 0, W * 2, H);
        const top = g.createLinearGradient(0, 0, 0, H * 0.5);
        top.addColorStop(0, "rgba(0,6,8,0.55)");
        top.addColorStop(1, "rgba(0,6,8,0)");
        g.fillStyle = top;
        g.fillRect(0, 0, W * 2, H * 0.5);
      }
      g.globalCompositeOperation = "source-over";
    });
    this.cache.set(stage, c);
    this.order.push(stage);
    while (this.order.length > 3) {
      const old = this.order.shift();
      if (old !== undefined && old !== stage) this.cache.delete(old);
    }
    return c;
  }

  /** Zeichnet die Kulisse ganzzahlig gekachelt (Periode = gespiegeltes Paar). */
  draw(g: Ctx2D, stage: number, scroll: number, y: number, viewW = 1280): boolean {
    const t = this.tile(stage);
    if (!t) return false;
    const P = t.width;
    let x = -Math.round(((scroll % P) + P) % P);
    while (x < viewW) {
      g.drawImage(t, x, y);
      x += P;
    }
    return true;
  }
}

// =================================================================================================
// Kleine Mal-Helfer

function vgrad(g: Ctx2D, y0: number, y1: number, stops: Array<[number, string]>): CanvasGradient {
  const grd = g.createLinearGradient(0, y0, 0, y1);
  for (const [o, c] of stops) grd.addColorStop(o, c);
  return grd;
}

function hgrad(g: Ctx2D, x0: number, x1: number, stops: Array<[number, string]>): CanvasGradient {
  const grd = g.createLinearGradient(x0, 0, x1, 0);
  for (const [o, c] of stops) grd.addColorStop(o, c);
  return grd;
}

/** Weicher Lichtfleck in eine Lichtkachel */
export function glowBlob(g: Ctx2D, x: number, y: number, r: number, color: string, a = 1, ry = r): void {
  g.save();
  g.translate(x, y);
  g.scale(1, ry / r);
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, r);
  grd.addColorStop(0, rgbaHex(color, a));
  grd.addColorStop(0.35, rgbaHex(color, a * 0.45));
  grd.addColorStop(1, rgbaHex(color, 0));
  g.fillStyle = grd;
  g.fillRect(-r, -r, r * 2, r * 2);
  g.restore();
}

/** Lichtkegel (Trapez mit vertikalem Verlauf) von (x, y0) nach unten */
export function lightCone(g: Ctx2D, x: number, y0: number, y1: number, topW: number, botW: number, color: string, a: number): void {
  const grd = g.createLinearGradient(0, y0, 0, y1);
  grd.addColorStop(0, rgbaHex(color, a));
  grd.addColorStop(0.6, rgbaHex(color, a * 0.35));
  grd.addColorStop(1, rgbaHex(color, 0));
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(x - topW / 2, y0);
  g.lineTo(x + topW / 2, y0);
  g.lineTo(x + botW / 2, y1);
  g.lineTo(x - botW / 2, y1);
  g.closePath();
  g.fill();
}

const BINDER_COLS = ["#2c4468", "#6a3232", "#2a5846", "#8a7c52", "#4c4468", "#9a9486", "#34586a", "#6e4c2c"];

function binderRow(g: Ctx2D, x: number, base: number, w: number, maxH: number, r: () => number, dim = 0): void {
  let bx = x;
  while (bx < x + w - 8) {
    const bw = 9 + Math.floor(r() * 6);
    if (bx + bw > x + w) break;
    const bh = maxH - Math.floor(r() * 8);
    const col = BINDER_COLS[Math.floor(r() * BINDER_COLS.length)];
    g.fillStyle = col;
    g.fillRect(bx, base - bh, bw - 1, bh);
    g.fillStyle = "rgba(255,255,255,0.12)";
    g.fillRect(bx, base - bh, 2, bh);
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.fillRect(bx + bw - 3, base - bh, 2, bh);
    // Rückenschild + Griffloch
    g.fillStyle = "rgba(235,230,215,0.75)";
    g.fillRect(bx + 2, base - bh + 6, bw - 5, Math.min(14, bh * 0.25));
    g.fillStyle = "rgba(10,10,16,0.55)";
    g.beginPath();
    g.arc(bx + bw / 2 - 0.5, base - bh * 0.28, Math.min(2.6, bw * 0.2), 0, TAU);
    g.fill();
    bx += bw;
    if (r() < 0.12) {
      // schräg lehnender Ordner / Lücke
      bx += 4 + Math.floor(r() * 8);
    }
  }
  if (dim > 0) {
    g.fillStyle = `rgba(6,10,20,${dim})`;
    g.fillRect(x, base - maxH, w, maxH);
  }
}

function archiveBox(g: Ctx2D, x: number, y: number, w: number, h: number, r: () => number): void {
  const tone = r();
  g.fillStyle = tone < 0.5 ? "#7d6242" : tone < 0.8 ? "#8c6f4a" : "#5f6a78";
  g.fillRect(x, y, w, h);
  g.fillStyle = "rgba(255,230,190,0.16)";
  g.fillRect(x, y, w, 3);
  g.fillStyle = "rgba(0,0,0,0.28)";
  g.fillRect(x + w - 4, y, 4, h);
  g.fillStyle = "rgba(240,236,224,0.8)";
  g.fillRect(x + w * 0.22, y + h * 0.3, w * 0.5, h * 0.28);
  g.fillStyle = "rgba(60,60,70,0.5)";
  g.fillRect(x + w * 0.26, y + h * 0.38, w * 0.36, 1.5);
  g.fillRect(x + w * 0.26, y + h * 0.46, w * 0.28, 1.5);
  g.fillStyle = "rgba(20,14,8,0.6)";
  g.beginPath();
  g.ellipse(x + w * 0.5, y + h * 0.78, w * 0.12, 2.5, 0, 0, TAU);
  g.fill();
}

function shelfUnit(g: Ctx2D, x: number, base: number, w: number, h: number, rows: number, fill: "binders" | "boxes" | "mixed", r: () => number): void {
  // Rückwand
  g.fillStyle = "#121a28";
  g.fillRect(x, base - h, w, h);
  const rowH = h / rows;
  for (let i = 0; i < rows; i += 1) {
    const sb = base - i * rowH;
    const kind = fill === "mixed" ? (r() < 0.5 ? "binders" : "boxes") : fill;
    if (kind === "binders") binderRow(g, x + 5, sb - 5, w - 10, rowH - 12, r);
    else {
      let bx = x + 5;
      while (bx < x + w - 30) {
        const bw = 30 + Math.floor(r() * 16);
        if (bx + bw > x + w - 5) break;
        const bh = rowH - 14 - Math.floor(r() * 8);
        archiveBox(g, bx, sb - 5 - bh, bw - 2, bh, r);
        bx += bw;
      }
    }
    // Fachboden
    g.fillStyle = "#4a5568";
    g.fillRect(x, sb - 5, w, 5);
    g.fillStyle = "rgba(190,210,240,0.25)";
    g.fillRect(x, sb - 5, w, 1);
  }
  // Seitenstreben
  g.fillStyle = "#2b3444";
  g.fillRect(x - 3, base - h - 4, 6, h + 4);
  g.fillRect(x + w - 3, base - h - 4, 6, h + 4);
  g.fillStyle = "rgba(180,200,235,0.18)";
  g.fillRect(x - 3, base - h - 4, 1.5, h + 4);
  g.fillRect(x + w - 3, base - h - 4, 1.5, h + 4);
  g.fillStyle = "#4a5568";
  g.fillRect(x - 4, base - h - 6, w + 8, 5);
}

function filingCabinet(g: Ctx2D, x: number, base: number, w: number, h: number, drawers: number): void {
  g.fillStyle = hgrad(g, x, x + w, [
    [0, "#3b4659"],
    [0.5, "#323c4e"],
    [1, "#232b39"],
  ]);
  g.fillRect(x, base - h, w, h);
  g.fillStyle = "rgba(200,220,255,0.22)";
  g.fillRect(x, base - h, w, 2);
  const dh = (h - 6) / drawers;
  for (let i = 0; i < drawers; i += 1) {
    const y = base - h + 4 + i * dh;
    g.strokeStyle = "rgba(10,14,22,0.7)";
    g.lineWidth = 1.5;
    g.strokeRect(x + 3, y, w - 6, dh - 3);
    g.fillStyle = "#8d98ad";
    g.fillRect(x + w / 2 - 8, y + 6, 16, 3);
    g.fillStyle = "rgba(235,232,220,0.6)";
    g.fillRect(x + w / 2 - 6, y + 12, 12, 5);
  }
}

function plant(g: Ctx2D, x: number, base: number, s: number, r: () => number): void {
  // Topf
  g.fillStyle = "#2c3140";
  g.beginPath();
  g.moveTo(x - 14 * s, base - 30 * s);
  g.lineTo(x + 14 * s, base - 30 * s);
  g.lineTo(x + 10 * s, base);
  g.lineTo(x - 10 * s, base);
  g.closePath();
  g.fill();
  g.fillStyle = "rgba(200,215,240,0.2)";
  g.fillRect(x - 14 * s, base - 30 * s, 28 * s, 3);
  // Blätter
  const greens = ["#1f4a3a", "#2a5e45", "#173a2e", "#35704f"];
  for (let i = 0; i < 16; i += 1) {
    const a = -Math.PI / 2 + (r() - 0.5) * 2.4;
    const len = (26 + r() * 36) * s;
    const bx = x + Math.cos(a) * len * 0.5;
    const by = base - 30 * s + Math.sin(a) * len * 0.9;
    g.fillStyle = greens[Math.floor(r() * greens.length)];
    g.save();
    g.translate(bx, by);
    g.rotate(a + Math.PI / 2);
    g.beginPath();
    g.ellipse(0, 0, 6 * s, 15 * s, 0, 0, TAU);
    g.fill();
    g.restore();
  }
}

function deskIsland(g: Ctx2D, L: Ctx2D, x: number, base: number, r: () => number, lamp: string, screen: string, withLamp = true): void {
  const w = 156;
  const top = base - 74;
  const variant = r();
  // Stuhl dahinter (Lehne mit Kante)
  g.fillStyle = "#1e2638";
  g.beginPath();
  rr(g, x + 46, top - 46, 38, 52, 9);
  g.fill();
  g.fillStyle = "rgba(170,195,235,0.22)";
  g.fillRect(x + 50, top - 45, 30, 1.5);
  // Sichtblende + Tischplatte
  g.fillStyle = "#222b3b";
  g.fillRect(x + 8, top + 8, w - 16, 66);
  g.fillStyle = "rgba(0,0,0,0.28)";
  g.fillRect(x + 8, top + 8, w - 16, 12);
  g.fillStyle = vgrad(g, top, top + 9, [
    [0, "#5c6a84"],
    [1, "#3a4558"],
  ]);
  g.fillRect(x, top, w, 9);
  g.fillStyle = "rgba(215,230,255,0.4)";
  g.fillRect(x, top, w, 1.5);
  // Rollcontainer
  filingCabinet(g, x + w - 52, base, 42, 60, 3);
  // Monitor (heller Rahmen, damit er nicht schwebt)
  const mx = x + 18;
  g.fillStyle = "#2e384c";
  g.fillRect(mx + 22, top - 14, 8, 14);
  g.fillRect(mx + 12, top - 3, 28, 3);
  g.beginPath();
  rr(g, mx - 3, top - 48, 58, 38, 3);
  g.fill();
  g.fillStyle = "rgba(190,210,245,0.35)";
  g.fillRect(mx - 2, top - 47, 56, 1.5);
  g.fillStyle = "#0b1522";
  g.fillRect(mx + 1, top - 44, 50, 30);
  if (variant < 0.35) {
    // zweiter Bildschirm
    g.fillStyle = "#2e384c";
    g.beginPath();
    rr(g, mx + 56, top - 42, 36, 30, 3);
    g.fill();
    g.fillStyle = "#0b1522";
    g.fillRect(mx + 59, top - 39, 30, 22);
    L.fillStyle = rgbaHex(screen, 0.4);
    L.fillRect(mx + 59, top - 39, 30, 22);
  }
  // Tastatur, Aktenstapel, Tasse, Telefon, Namensschild
  g.fillStyle = "#39435a";
  g.fillRect(mx + 4, top - 3, 36, 3);
  const pile = 3 + Math.floor(r() * 4);
  for (let i = 0; i < pile; i += 1) {
    g.fillStyle = i % 3 === 0 ? "#b89a5e" : i % 3 === 1 ? "#d2ccbc" : "#8a9ab8";
    g.fillRect(x + 96 + (r() - 0.5) * 3, top - 3 - i * 3, 30, 3);
  }
  g.fillStyle = "#d9d4c8";
  g.fillRect(x + 128, top - 10, 8, 10);
  g.fillStyle = "#1c2230";
  g.fillRect(x + 4, top - 6, 14, 6);
  g.fillStyle = "#c8b27a";
  g.fillRect(x + 60, top - 7, 20, 7);
  // Bildschirm-Licht
  L.fillStyle = rgbaHex(screen, 0.55);
  L.fillRect(mx + 1, top - 44, 50, 30);
  L.fillStyle = rgbaHex("#ffffff", 0.22);
  L.fillRect(mx + 5, top - 40, 22, 2);
  L.fillRect(mx + 5, top - 35, 34, 2);
  L.fillRect(mx + 5, top - 30, 16, 2);
  L.fillRect(mx + 5, top - 25, 28, 2);
  glowBlob(L, mx + 26, top - 30, 50, screen, 0.2, 34);
  if (!withLamp) return;
  // Gelenk-Schreibtischlampe
  const lx = x + w - 30;
  g.strokeStyle = "#6a7590";
  g.lineWidth = 3;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(lx, top - 2);
  g.lineTo(lx + 10, top - 36);
  g.lineTo(lx - 12, top - 56);
  g.stroke();
  g.lineCap = "butt";
  g.fillStyle = "#4a5470";
  g.fillRect(lx - 9, top - 3, 18, 3);
  // Schirm
  g.fillStyle = "#47536c";
  g.beginPath();
  g.moveTo(lx - 10, top - 62);
  g.lineTo(lx - 34, top - 44);
  g.lineTo(lx - 22, top - 38);
  g.lineTo(lx - 4, top - 54);
  g.closePath();
  g.fill();
  g.strokeStyle = "rgba(200,215,245,0.45)";
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(lx - 10, top - 62);
  g.lineTo(lx - 34, top - 44);
  g.stroke();
  // warmes Licht: Glühbirne, weicher Kegel, Lichtpfütze auf der Platte
  L.save();
  L.globalCompositeOperation = "lighter";
  glowBlob(L, lx - 27, top - 41, 9, "#fff2cf", 0.95);
  L.save();
  L.translate(lx - 27, top - 41);
  L.rotate(0.55);
  lightCone(L, 0, 0, 44, 10, 70, lamp, 0.16);
  L.restore();
  glowBlob(L, lx - 44, top + 1, 64, lamp, 0.42, 12);
  glowBlob(L, lx - 36, top - 26, 60, lamp, 0.12, 50);
  L.restore();
}

function blinds(g: Ctx2D, x: number, y: number, w: number, h: number, open: number): void {
  g.fillStyle = "rgba(170,190,215,0.18)";
  for (let yy = y; yy < y + h; yy += 7) g.fillRect(x, yy, w, 3 + open * 2);
  g.fillStyle = "rgba(120,135,160,0.35)";
  g.fillRect(x, y - 4, w, 4);
}

function glassBay(g: Ctx2D, L: Ctx2D, x: number, base: number, w: number, h: number, r: () => number, lamp: string, screen: string): void {
  // Innenraum (dunkler, bläulich) mit Rückwand-Details
  g.fillStyle = "#101b2e";
  g.fillRect(x, base - h, w, h);
  g.fillStyle = vgrad(g, base - h, base, [
    [0, "rgba(40,70,110,0.28)"],
    [1, "rgba(0,0,0,0.32)"],
  ]);
  g.fillRect(x, base - h, w, h);
  // Pinnwand + Kalender
  g.fillStyle = "#3a3024";
  g.fillRect(x + 22, base - h + 40, 50, 34);
  g.fillStyle = "#d8d2c0";
  g.fillRect(x + 26, base - h + 44, 12, 14);
  g.fillRect(x + 42, base - h + 46, 14, 10);
  g.fillStyle = "#c88a5a";
  g.fillRect(x + 58, base - h + 50, 10, 16);
  if (r() < 0.8) shelfUnit(g, x + w - 70, base - 20, 56, 110, 3, "binders", r);
  deskIsland(g, L, x + 8, base - 4, r, lamp, screen, true);
  if (r() < 0.5) plant(g, x + w - 24, base - 4, 0.8, r);
  // Glas: Tönung + Spiegelstreifen
  g.fillStyle = "rgba(120,190,240,0.11)";
  g.fillRect(x, base - h, w, h);
  g.save();
  g.beginPath();
  g.rect(x, base - h, w, h);
  g.clip();
  g.fillStyle = "rgba(200,235,255,0.1)";
  g.beginPath();
  g.moveTo(x + w * 0.1, base - h);
  g.lineTo(x + w * 0.35, base - h);
  g.lineTo(x + w * 0.05, base);
  g.lineTo(x - w * 0.2, base);
  g.closePath();
  g.fill();
  g.fillStyle = "rgba(200,235,255,0.06)";
  g.beginPath();
  g.moveTo(x + w * 0.55, base - h);
  g.lineTo(x + w * 0.62, base - h);
  g.lineTo(x + w * 0.42, base);
  g.lineTo(x + w * 0.35, base);
  g.closePath();
  g.fill();
  g.restore();
  // Jalousie (teilweise herabgelassen)
  const bl = r();
  if (bl < 0.55) blinds(g, x + 3, base - h + 4, w - 6, h * (0.25 + bl * 0.6), r());
  // Milchglas-Band mit Behördensymbol-Punkten
  g.fillStyle = "rgba(210,230,245,0.18)";
  g.fillRect(x, base - h * 0.5, w, 14);
  g.fillStyle = "rgba(230,240,250,0.25)";
  for (let xx = x + 8; xx < x + w - 6; xx += 12) g.fillRect(xx, base - h * 0.5 + 5, 4, 4);
  // Rahmen (Profile mit Glanzkante)
  g.fillStyle = "#1e2738";
  g.fillRect(x - 5, base - h - 10, w + 10, 10);
  g.fillRect(x - 5, base - h, 9, h);
  g.fillRect(x - 5, base - 7, w + 10, 7);
  g.fillStyle = "rgba(170,205,245,0.38)";
  g.fillRect(x - 5, base - h - 10, w + 10, 1.5);
  g.fillRect(x - 5, base - h, 1.5, h);
  // Türgriff
  g.fillStyle = "#8a96ae";
  g.fillRect(x + w - 10, base - h * 0.45, 3, 22);
}

function serverRack(g: Ctx2D, L: Ctx2D, L2: Ctx2D, x: number, base: number, w: number, h: number, r: () => number): void {
  g.fillStyle = vgrad(g, base - h, base, [
    [0, "#141c22"],
    [1, "#0a0f13"],
  ]);
  g.fillRect(x, base - h, w, h);
  g.fillStyle = "rgba(150,220,210,0.18)";
  g.fillRect(x, base - h, w, 2);
  g.fillRect(x, base - h, 2, h);
  const units = Math.floor((h - 16) / 14);
  for (let i = 0; i < units; i += 1) {
    const y = base - h + 8 + i * 14;
    g.fillStyle = i % 3 === 0 ? "#1e2a30" : "#172127";
    g.fillRect(x + 5, y, w - 10, 12);
    g.fillStyle = "rgba(0,0,0,0.5)";
    for (let k = 0; k < 6; k += 1) g.fillRect(x + 9 + k * 5, y + 4, 3, 4);
    // LEDs: meist fest eingebrannt (leuchtend im Grundbild), wenige blinken (Lichtkachel 2)
    const n = 1 + Math.floor(r() * 3);
    for (let k = 0; k < n; k += 1) {
      const lx = x + w - 10 - k * 7;
      const ly = y + 5;
      const col = r() < 0.6 ? "#39ffb0" : r() < 0.7 ? "#39c8ff" : "#ffb03a";
      if (r() < 0.14) {
        g.fillStyle = "#0a1a14";
        g.fillRect(lx, ly, 3, 3);
        L2.fillStyle = col;
        L2.fillRect(lx, ly, 3, 3);
        glowBlob(L2, lx + 1.5, ly + 1.5, 6, col, 0.55);
      } else {
        g.fillStyle = rgbaHex(col, 0.22);
        g.fillRect(lx - 2, ly - 2, 7, 7);
        g.fillStyle = col;
        g.fillRect(lx, ly, 3, 3);
      }
    }
  }
  g.fillStyle = "#0b1115";
  g.fillRect(x - 2, base - 6, w + 4, 6);
}

function vaultDoor(g: Ctx2D, L: Ctx2D, cx: number, base: number, R: number): void {
  const cy = base - R - 14;
  // Rahmen + Warnstreifen
  g.fillStyle = "#1a2126";
  g.fillRect(cx - R - 26, cy - R - 26, (R + 26) * 2, (R + 26) * 2 + 14);
  g.save();
  g.beginPath();
  g.rect(cx - R - 26, base - 14, (R + 26) * 2, 14);
  g.clip();
  for (let i = -2; i < (R + 26) * 2 / 14 + 2; i += 1) {
    g.fillStyle = i % 2 === 0 ? "#c9a22a" : "#161a1e";
    g.beginPath();
    const bx = cx - R - 26 + i * 14;
    g.moveTo(bx, base);
    g.lineTo(bx + 14, base - 14);
    g.lineTo(bx + 28, base - 14);
    g.lineTo(bx + 14, base);
    g.closePath();
    g.fill();
  }
  g.restore();
  // Tür
  const grd = g.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R);
  grd.addColorStop(0, "#8a98a4");
  grd.addColorStop(0.6, "#56626c");
  grd.addColorStop(1, "#2c343a");
  g.fillStyle = grd;
  g.beginPath();
  g.arc(cx, cy, R, 0, TAU);
  g.fill();
  g.strokeStyle = "#20272c";
  g.lineWidth = 6;
  g.stroke();
  g.strokeStyle = "rgba(200,230,240,0.35)";
  g.lineWidth = 2;
  g.beginPath();
  g.arc(cx, cy, R * 0.78, 0, TAU);
  g.stroke();
  // Bolzen
  for (let i = 0; i < 16; i += 1) {
    const a = (i / 16) * TAU;
    g.fillStyle = "#b8c4cc";
    g.beginPath();
    g.arc(cx + Math.cos(a) * R * 0.9, cy + Math.sin(a) * R * 0.9, 3.2, 0, TAU);
    g.fill();
  }
  // Handrad
  g.strokeStyle = "#c8d2d8";
  g.lineWidth = 5;
  g.beginPath();
  g.arc(cx, cy, R * 0.34, 0, TAU);
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * TAU + 0.3;
    g.moveTo(cx - Math.cos(a) * R * 0.34, cy - Math.sin(a) * R * 0.34);
    g.lineTo(cx + Math.cos(a) * R * 0.34, cy + Math.sin(a) * R * 0.34);
  }
  g.stroke();
  g.fillStyle = "#e0e8ec";
  g.beginPath();
  g.arc(cx, cy, 7, 0, TAU);
  g.fill();
  // Scharnierblock
  g.fillStyle = "#3a444b";
  g.fillRect(cx + R - 6, cy - R * 0.5, 24, R);
  // Statuslampe
  L.fillStyle = "#ff3344";
  L.beginPath();
  L.arc(cx + R + 14, cy - R - 8, 3.5, 0, TAU);
  L.fill();
  glowBlob(L, cx + R + 14, cy - R - 8, 18, "#ff3344", 0.7);
  glowBlob(L, cx, cy, R * 1.2, "#39ffb0", 0.06);
}

// =================================================================================================
// Mittelgrund je Stufe

export const MID_W = 2048;
export const MID_H = 320;
/** Bildschirm-y der Kachel-Oberkante; Standlinie = MID_Y + MID_BASE */
export const MID_Y = 262;
const MID_BASE = 308;
export const MID_PAR = 0.42;
/** Nachtfärbung des Mittelgrunds je Stufe (Wandfarbe, Deckkraft) */
const MID_NIGHT = [0.12, 0.26, 0.2, 0.42, 0.34];

export interface MidTiles {
  base: HTMLCanvasElement;
  lights: HTMLCanvasElement;
  /** blinkende LEDs (nur Serverkeller), sonst null */
  lights2: HTMLCanvasElement | null;
}

export function paintMid(stage: number, shredderProp: ((g: Ctx2D, x: number, base: number, h: number) => void) | null): MidTiles {
  const P = PALETTE[stage];
  const lights2 = paint(MID_W, MID_H, () => undefined);
  const L2 = lights2.getContext("2d") as Ctx2D;
  const lights = paint(MID_W, MID_H, () => undefined);
  const L = lights.getContext("2d") as Ctx2D;
  L.globalCompositeOperation = "lighter";
  L2.globalCompositeOperation = "lighter";
  const base = paint(MID_W, MID_H, (g) => {
    const r = mulberry(900 + stage * 77);
    const B = MID_BASE;
    // Kontaktschatten-Band
    g.fillStyle = vgrad(g, B - 6, B + 12, [
      [0, "rgba(0,0,0,0)"],
      [0.5, "rgba(0,0,0,0.35)"],
      [1, "rgba(0,0,0,0)"],
    ]);
    g.fillRect(0, B - 6, MID_W, 18);
    let x = 30;
    /** Objekt der Breite w an der Cursorposition (nahtlos gewickelt, beide Kopien mit identischem Zufall) */
    const put = (w: number, fn: (x: number, rs: () => number) => void): void => {
      const x0 = x;
      const seed = Math.floor(r() * 1e6);
      wrapDraw(MID_W, x0, w + 40, (xx) => fn(xx, mulberry(seed)));
      x += w + 26 + Math.floor(r() * 40);
    };
    if (stage === 0) {
      while (x < MID_W - 220) {
        const k = r();
        if (k < 0.5) put(156, (xx, rs) => deskIsland(g, L, xx, B, rs, P.lamp, "#7ab8ff"));
        else if (k < 0.65) put(60, (xx) => filingCabinet(g, xx, B, 60, 110, 4));
        else if (k < 0.8) put(40, (xx, rs) => plant(g, xx + 20, B, 1.1, rs));
        else if (k < 0.9) {
          // Wasserspender
          put(40, (xx) => {
            g.fillStyle = "#2a3346";
            g.fillRect(xx + 6, B - 70, 28, 70);
            g.fillStyle = "rgba(120,190,255,0.45)";
            g.beginPath();
            rr(g, xx + 8, B - 112, 24, 42, 8);
            g.fill();
            g.fillStyle = "rgba(220,240,255,0.35)";
            g.fillRect(xx + 12, B - 106, 4, 30);
            L.fillStyle = "rgba(90,170,255,0.4)";
            L.fillRect(xx + 18, B - 56, 4, 4);
          });
        } else {
          // Kaffeeküche: Theke + Kaffeemaschine
          put(110, (xx) => {
            g.fillStyle = "#2a3242";
            g.fillRect(xx, B - 80, 110, 80);
            g.fillStyle = "#4a566c";
            g.fillRect(xx - 4, B - 84, 118, 6);
            g.fillStyle = "#181c24";
            g.fillRect(xx + 14, B - 128, 40, 44);
            g.fillStyle = "#3a4152";
            g.fillRect(xx + 18, B - 124, 32, 10);
            g.fillStyle = "#d8d2c4";
            g.fillRect(xx + 28, B - 98, 10, 12);
            g.fillRect(xx + 70, B - 96, 9, 12);
            g.fillRect(xx + 84, B - 96, 9, 12);
            L.fillStyle = "#39ff8a";
            L.fillRect(xx + 44, B - 120, 3, 3);
            glowBlob(L, xx + 45, B - 119, 8, "#39ff8a", 0.6);
            L.fillStyle = "#ff8a2a";
            L.fillRect(xx + 22, B - 120, 3, 3);
          });
        }
      }
    } else if (stage === 1) {
      while (x < MID_W - 240) {
        const k = r();
        if (k < 0.55) {
          const w = 150 + Math.floor(r() * 70);
          const h = 170 + Math.floor(r() * 40);
          put(w, (xx, rs) => shelfUnit(g, xx, B, w, h, 4, "binders", rs));
        } else if (k < 0.72) {
          // Sortiertisch mit Papierbergen
          put(170, (xx, rs) => {
            g.fillStyle = "#4a3c2c";
            g.fillRect(xx, B - 70, 170, 8);
            g.fillStyle = "#2a2f3a";
            g.fillRect(xx + 6, B - 62, 6, 62);
            g.fillRect(xx + 158, B - 62, 6, 62);
            for (let i = 0; i < 5; i += 1) {
              const px = xx + 10 + i * 30;
              const ph = 8 + Math.floor(rs() * 26);
              g.fillStyle = i % 2 ? "#d6d0c0" : "#c4bca8";
              g.fillRect(px, B - 70 - ph, 26, ph);
              g.fillStyle = "rgba(0,0,0,0.15)";
              for (let yy = B - 70 - ph + 3; yy < B - 70; yy += 3) g.fillRect(px, yy, 26, 1);
            }
            archiveBox(g, xx + 30, B - 40, 44, 34, rs);
            archiveBox(g, xx + 90, B - 40, 44, 34, rs);
          });
        } else if (k < 0.86) {
          // Aktenwagen
          put(70, (xx, rs) => {
            g.fillStyle = "#3a4254";
            g.fillRect(xx, B - 94, 4, 88);
            g.fillRect(xx + 62, B - 94, 4, 88);
            g.fillRect(xx, B - 60, 66, 4);
            g.fillRect(xx, B - 14, 66, 4);
            binderRow(g, xx + 3, B - 60, 60, 30, rs);
            archiveBox(g, xx + 6, B - 44, 54, 30, rs);
            g.fillStyle = "#11141a";
            for (const wx of [xx + 6, xx + 60]) {
              g.beginPath();
              g.arc(wx, B - 4, 4, 0, TAU);
              g.fill();
            }
          });
        } else put(60, (xx) => filingCabinet(g, xx, B, 60, 120, 4));
      }
    } else if (stage === 2) {
      while (x < MID_W - 240) {
        const w = 170 + Math.floor(r() * 40);
        if (r() < 0.85) put(w, (xx, rs) => glassBay(g, L, xx, B, w, 232, rs, P.lamp, "#7ae0ff"));
        else put(40, (xx, rs) => plant(g, xx + 20, B, 1.2, rs));
      }
    } else if (stage === 3) {
      while (x < MID_W - 260) {
        const k = r();
        if (k < 0.72) {
          const w = 170 + Math.floor(r() * 80);
          const fill = r() < 0.5 ? "boxes" : "mixed";
          put(w, (xx, rs) => shelfUnit(g, xx, B, w, 292, 6, fill, rs));
        } else if (k < 0.86 && shredderProp) {
          put(80, (xx) => shredderProp(g, xx + 40, B, 128));
        } else {
          // Rollleiter vor einem Regal
          put(190, (xx, rs) => {
            shelfUnit(g, xx, B, 190, 292, 6, "boxes", rs);
            g.strokeStyle = "#6a7488";
            g.lineWidth = 4;
            g.beginPath();
            g.moveTo(xx + 60, B);
            g.lineTo(xx + 90, B - 250);
            g.moveTo(xx + 96, B);
            g.lineTo(xx + 122, B - 250);
            for (let i = 1; i < 10; i += 1) {
              const u = i / 10;
              g.moveTo(xx + 60 + 30 * u, B - 250 * u);
              g.lineTo(xx + 96 + 26 * u, B - 250 * u);
            }
            g.stroke();
          });
        }
      }
    } else {
      let vault = false;
      while (x < MID_W - 280) {
        const k = r();
        if (!vault && x > 700) {
          vault = true;
          put(270, (xx) => vaultDoor(g, L, xx + 135, B, 104));
        } else if (k < 0.8) {
          const n = 2 + Math.floor(r() * 3);
          put(n * 64, (xx, rs) => {
            for (let i = 0; i < n; i += 1) serverRack(g, L, L2, xx + i * 64, B, 60, 220 + (i % 2) * 20, rs);
          });
        } else {
          // Rohrleitungen + Sicherungskasten
          put(60, (xx) => {
            g.fillStyle = "#1c262c";
            g.fillRect(xx + 10, B - 280, 14, 280);
            g.fillRect(xx + 34, B - 260, 10, 260);
            g.fillStyle = "rgba(150,220,210,0.2)";
            g.fillRect(xx + 10, B - 280, 2, 280);
            g.fillStyle = "#2a3438";
            g.fillRect(xx + 4, B - 190, 46, 58);
            g.fillStyle = "rgba(150,220,210,0.22)";
            g.fillRect(xx + 4, B - 190, 46, 1.5);
            g.fillStyle = "#9a7c22";
            g.fillRect(xx + 8, B - 184, 38, 4);
            L.fillStyle = "#39ffb0";
            L.fillRect(xx + 12, B - 170, 3, 3);
            L.fillRect(xx + 20, B - 170, 3, 3);
            L.fillStyle = "#ffb03a";
            L.fillRect(xx + 28, B - 170, 3, 3);
          });
        }
      }
      // Kabeltrassen oben
      g.fillStyle = "#11181c";
      g.fillRect(0, 6, MID_W, 10);
      g.strokeStyle = "rgba(40,60,66,0.9)";
      g.lineWidth = 2;
      g.beginPath();
      for (let i = 0; i < 12; i += 1) {
        const y0 = 16 + (i % 4) * 3;
        g.moveTo(0, y0);
        for (let xx = 0; xx <= MID_W; xx += 128) g.lineTo(xx, y0 + 6 + 5 * Math.sin((xx / MID_W) * TAU * 4 + i));
      }
      g.stroke();
    }
    // Atmosphärische Tiefe: Nachtfärbung je Stufe, oben Dunst, unten Schatten
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = rgbaHex(P.wall, MID_NIGHT[stage]);
    g.fillRect(0, 0, MID_W, MID_H);
    g.fillStyle = vgrad(g, 0, MID_H, [
      [0, rgbaHex(P.haze, 0.3)],
      [0.55, rgbaHex(P.haze, 0.12)],
      [1, rgbaHex("#000000", 0.35)],
    ]);
    g.fillRect(0, 0, MID_W, MID_H);
    g.globalCompositeOperation = "source-over";
  });
  return { base, lights, lights2: stage === 4 ? lights2 : null };
}

// =================================================================================================
// Decke (Parallax 0.3) mit Einbauleuchten

export const CEIL_W = 2048;
export const CEIL_H = 112;
export const CEIL_PAR = 0.3;
export const CEIL_FIXTURE_STEP = 256;

export function paintCeiling(): { base: HTMLCanvasElement; lights: HTMLCanvasElement } {
  const base = paint(CEIL_W, CEIL_H, (g) => {
    g.fillStyle = vgrad(g, 0, CEIL_H, [
      [0, "#05080f"],
      [0.7, "#0e1524"],
      [1, "rgba(14,21,36,0)"],
    ]);
    g.fillRect(0, 0, CEIL_W, CEIL_H);
    // Rasterdecke
    g.strokeStyle = "rgba(90,110,150,0.16)";
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= CEIL_W; x += 64) {
      g.moveTo(x + 0.5, 30);
      g.lineTo(x + 0.5, 84);
    }
    g.moveTo(0, 56.5);
    g.lineTo(CEIL_W, 56.5);
    g.moveTo(0, 84.5);
    g.lineTo(CEIL_W, 84.5);
    g.stroke();
    // Unterzüge
    for (let x = 0; x < CEIL_W; x += 512) {
      g.fillStyle = "#070a12";
      g.fillRect(x, 0, 46, 96);
      g.fillStyle = "rgba(120,140,180,0.2)";
      g.fillRect(x, 94, 46, 2);
    }
    // Leuchtengehäuse
    for (let x = CEIL_FIXTURE_STEP / 2; x < CEIL_W; x += CEIL_FIXTURE_STEP) {
      g.fillStyle = "#1a2232";
      g.fillRect(x - 70, 72, 140, 12);
      g.fillStyle = "#2c3850";
      g.fillRect(x - 64, 80, 128, 5);
    }
  });
  const lights = paint(CEIL_W, CEIL_H + 30, (g) => {
    g.globalCompositeOperation = "lighter";
    for (let x = CEIL_FIXTURE_STEP / 2; x < CEIL_W; x += CEIL_FIXTURE_STEP) {
      g.fillStyle = "rgba(225,238,255,0.95)";
      g.fillRect(x - 62, 80, 124, 4);
      glowBlob(g, x, 84, 110, "#bcd4ff", 0.28, 30);
      glowBlob(g, x, 82, 50, "#e8f0ff", 0.5, 10);
    }
  });
  return { base, lights };
}

// =================================================================================================
// Nahe Ebene: Säule, Hängeleuchte, Lichtschacht

export const NEAR_PAR = 0.72;
export const COLUMN_STEP = 720;
export const FIXTURE_STEP = 360;
export const COLUMN_W = 84;

export function paintColumn(stage: number): HTMLCanvasElement {
  const P = PALETTE[stage];
  return paint(COLUMN_W + 20, 600, (g) => {
    const x0 = 10;
    const w = COLUMN_W;
    g.fillStyle = hgrad(g, x0, x0 + w, [
      [0, "#243049"],
      [0.18, "#1c263a"],
      [0.8, "#121a2a"],
      [1, "#0a0f1a"],
    ]);
    g.fillRect(x0, 0, w, 586);
    // Licht von oben
    g.fillStyle = vgrad(g, 0, 586, [
      [0, rgbaHex(P.neon, 0.12)],
      [0.4, rgbaHex(P.neon, 0.03)],
      [1, "rgba(0,0,0,0.25)"],
    ]);
    g.fillRect(x0, 0, w, 586);
    // Kante
    g.fillStyle = "rgba(180,205,245,0.22)";
    g.fillRect(x0, 0, 2, 586);
    // Kabelkanal
    g.fillStyle = "#0e1422";
    g.fillRect(x0 + w - 18, 0, 8, 586);
    g.fillStyle = "rgba(160,180,220,0.14)";
    g.fillRect(x0 + w - 18, 0, 1.5, 586);
    // Sockel
    g.fillStyle = "#0b1019";
    g.fillRect(x0 - 4, 560, w + 8, 26);
    g.fillStyle = "rgba(170,190,230,0.18)";
    g.fillRect(x0 - 4, 560, w + 8, 1.5);
    // Stufe 4: Rohrschellen / Leitungen
    if (stage === 4) {
      g.fillStyle = "#1b262c";
      g.fillRect(x0 + 50, 0, 12, 586);
      g.fillStyle = "rgba(120,220,200,0.18)";
      g.fillRect(x0 + 50, 0, 2, 586);
      for (let y = 60; y < 560; y += 90) {
        g.fillStyle = "#2c3a40";
        g.fillRect(x0 + 46, y, 20, 6);
      }
    }
  });
}

/** Säulen-Deko: 0 = Feuerlöscher mit Schild, 1 = Aushang mit Zetteln, 2 = Wanduhr */
export function paintColumnDeco(kind: number): HTMLCanvasElement {
  return paint(60, 110, (g) => {
    if (kind === 0) {
      g.fillStyle = "#5a1c1e";
      g.fillRect(17, 4, 26, 26);
      g.fillStyle = "rgba(255,230,230,0.5)";
      g.fillRect(28, 9, 4, 16);
      g.fillStyle = "#4a1618";
      g.beginPath();
      rr(g, 21, 46, 18, 44, 6);
      g.fill();
      g.fillStyle = "#1c1f26";
      g.fillRect(25, 38, 10, 9);
      g.fillStyle = "rgba(255,190,190,0.18)";
      g.fillRect(23, 50, 3, 34);
    } else if (kind === 1) {
      g.fillStyle = "#3a3024";
      g.fillRect(6, 10, 48, 56);
      g.strokeStyle = "rgba(200,180,140,0.35)";
      g.lineWidth = 1.5;
      g.strokeRect(6, 10, 48, 56);
      const notes: Array<[number, number, number, number, string]> = [
        [10, 14, 16, 20, "#d8d2c0"],
        [29, 16, 20, 14, "#cfd8e8"],
        [12, 38, 18, 22, "#e6ddb8"],
        [33, 34, 16, 24, "#d8d2c0"],
      ];
      for (const [x, y, w, h, c] of notes) {
        g.fillStyle = c;
        g.fillRect(x, y, w, h);
        g.fillStyle = "rgba(60,60,70,0.45)";
        for (let yy = y + 4; yy < y + h - 2; yy += 3) g.fillRect(x + 2, yy, w - 5, 1);
        g.fillStyle = "#b8333a";
        g.beginPath();
        g.arc(x + w / 2, y + 2, 1.8, 0, TAU);
        g.fill();
      }
    } else {
      g.fillStyle = "#d8dce4";
      g.beginPath();
      g.arc(30, 36, 18, 0, TAU);
      g.fill();
      g.strokeStyle = "#1a1d24";
      g.lineWidth = 3;
      g.stroke();
      g.strokeStyle = "#1a1d24";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(30, 36);
      g.lineTo(30, 24);
      g.moveTo(30, 36);
      g.lineTo(39, 38);
      g.stroke();
      g.fillStyle = "#1a1d24";
      for (let i = 0; i < 12; i += 1) {
        const a = (i / 12) * TAU;
        g.fillRect(30 + Math.cos(a) * 14 - 1, 36 + Math.sin(a) * 14 - 1, 2, 2);
      }
    }
  });
}

/** Notausgangsschild (grün, Piktogramm) – Grundbild + Leuchtbild */
export function paintExitSign(): { base: HTMLCanvasElement; glow: HTMLCanvasElement } {
  const draw = (g: Ctx2D, lit: boolean): void => {
    g.fillStyle = lit ? "#2aff8a" : "#0f5a36";
    g.beginPath();
    rr(g, 6, 6, 60, 26, 3);
    g.fill();
    g.fillStyle = lit ? "#eafff2" : "#cfeede";
    // laufendes Männchen
    g.beginPath();
    g.arc(22, 12, 3, 0, TAU);
    g.fill();
    g.strokeStyle = lit ? "#eafff2" : "#cfeede";
    g.lineWidth = 2.4;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(21, 15);
    g.lineTo(18, 22);
    g.lineTo(13, 27);
    g.moveTo(18, 22);
    g.lineTo(24, 27);
    g.moveTo(20, 17);
    g.lineTo(27, 19);
    g.moveTo(20, 17);
    g.lineTo(14, 18);
    g.stroke();
    // Tür + Pfeil
    g.fillRect(34, 10, 12, 18);
    g.beginPath();
    g.moveTo(50, 19);
    g.lineTo(60, 19);
    g.moveTo(56, 15);
    g.lineTo(60, 19);
    g.lineTo(56, 23);
    g.stroke();
  };
  const base = paint(72, 38, (g) => draw(g, false));
  const glow = paint(160, 110, (g) => {
    glowBlob(g, 80, 55, 78, "#2aff8a", 0.35, 50);
    g.translate(44, 36);
    draw(g, true);
  });
  return { base, glow };
}

/** Hängeleuchte (Gehäuse ohne Licht) – 200×70, Aufhängung oben */
export function paintFixture(): HTMLCanvasElement {
  return paint(200, 70, (g) => {
    g.strokeStyle = "rgba(90,100,120,0.8)";
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(30, 0);
    g.lineTo(30, 40);
    g.moveTo(170, 0);
    g.lineTo(170, 40);
    g.stroke();
    g.fillStyle = vgrad(g, 40, 56, [
      [0, "#3a4456"],
      [1, "#1a202c"],
    ]);
    g.beginPath();
    rr(g, 8, 40, 184, 14, 4);
    g.fill();
    g.fillStyle = "#565f72";
    g.fillRect(14, 54, 172, 5);
  });
}

/** Leuchtende Röhre + Lichthof einer Hängeleuchte (additiv) */
export function paintFixtureGlow(color: string): HTMLCanvasElement {
  return paint(360, 120, (g) => {
    glowBlob(g, 180, 58, 170, color, 0.22, 56);
    glowBlob(g, 180, 57, 100, color, 0.42, 18);
    g.fillStyle = "rgba(245,250,255,0.98)";
    g.fillRect(94, 54, 172, 5);
  });
}

/** Volumetrischer Lichtschacht unter einer Leuchte (additiv, 320×520) */
export const SHAFT_W = 260;
export const SHAFT_H = 440;
export function paintShaft(color: string): HTMLCanvasElement {
  const W = SHAFT_W;
  const H = SHAFT_H;
  return paint(W, H, (g) => {
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, rgbaHex(color, 0.24));
    grd.addColorStop(0.5, rgbaHex(color, 0.08));
    grd.addColorStop(1, rgbaHex(color, 0));
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(W * 0.3, 0);
    g.lineTo(W * 0.7, 0);
    g.lineTo(W, H);
    g.lineTo(0, H);
    g.closePath();
    g.fill();
    // weiche Kanten
    g.globalCompositeOperation = "destination-out";
    const e = g.createLinearGradient(0, 0, W, 0);
    e.addColorStop(0, "rgba(0,0,0,1)");
    e.addColorStop(0.3, "rgba(0,0,0,0)");
    e.addColorStop(0.7, "rgba(0,0,0,0)");
    e.addColorStop(1, "rgba(0,0,0,1)");
    g.fillStyle = e;
    g.fillRect(0, 0, W, H);
  });
}

// =================================================================================================
// Boden

export const FLOOR_W = 1024;
export const FLOOR_H = 130;

export function paintFloor(stage: number): HTMLCanvasElement {
  const P = PALETTE[stage];
  return paint(FLOOR_W, FLOOR_H, (g) => {
    const r = mulberry(333 + stage);
    g.fillStyle = vgrad(g, 0, FLOOR_H, [
      [0, P.floorHi],
      [0.35, P.floorLo],
      [1, "#05070b"],
    ]);
    g.fillRect(0, 0, FLOOR_W, FLOOR_H);
    if (stage === 4) {
      // Riffelblech
      g.fillStyle = "rgba(170,210,210,0.10)";
      for (let y = 14; y < FLOOR_H; y += 12) {
        for (let x = (y / 12) % 2 === 0 ? 0 : 12; x < FLOOR_W; x += 24) {
          g.save();
          g.translate(x, y);
          g.rotate(0.7);
          g.fillRect(-5, -1.2, 10, 2.4);
          g.restore();
        }
      }
      g.strokeStyle = "rgba(0,0,0,0.5)";
      g.lineWidth = 2;
      g.beginPath();
      for (let x = 0; x <= FLOOR_W; x += 256) {
        g.moveTo(x + 1, 8);
        g.lineTo(x + 1, FLOOR_H);
      }
      g.stroke();
      g.fillStyle = "rgba(200,230,230,0.25)";
      for (let x = 0; x < FLOOR_W; x += 256) {
        for (const y of [18, 60, 102]) {
          g.beginPath();
          g.arc(x + 12, y, 2.2, 0, TAU);
          g.arc(x + 244, y, 2.2, 0, TAU);
          g.fill();
        }
      }
      // Sicherheitsstreifen an der Kante
      g.save();
      g.beginPath();
      g.rect(0, 2, FLOOR_W, 9);
      g.clip();
      for (let x = -20; x < FLOOR_W + 20; x += 32) {
        g.fillStyle = "rgba(200,160,40,0.75)";
        g.beginPath();
        g.moveTo(x, 11);
        g.lineTo(x + 12, 2);
        g.lineTo(x + 28, 2);
        g.lineTo(x + 16, 11);
        g.closePath();
        g.fill();
      }
      g.restore();
    } else {
      // Linoleum: große Bahnen, Fugen, Sprenkel, Kratzer
      for (let i = 0; i < 700; i += 1) {
        const x = r() * FLOOR_W;
        const y = 8 + r() * (FLOOR_H - 8);
        g.fillStyle = r() < 0.5 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.09)";
        g.fillRect(x, y, 1 + r() * 3, 1 + r() * 1.5);
      }
      g.strokeStyle = "rgba(0,0,0,0.42)";
      g.lineWidth = 1.5;
      g.beginPath();
      for (let x = 0; x <= FLOOR_W; x += 256) {
        g.moveTo(x + 0.5, 8);
        g.lineTo(x - 30 + 0.5, FLOOR_H);
      }
      g.moveTo(0, 58.5);
      g.lineTo(FLOOR_W, 58.5);
      g.stroke();
      g.strokeStyle = "rgba(200,220,255,0.06)";
      g.beginPath();
      for (let x = 0; x <= FLOOR_W; x += 256) {
        g.moveTo(x + 2, 8);
        g.lineTo(x - 28, FLOOR_H);
      }
      g.stroke();
      // Abnutzung / Laufspur
      g.fillStyle = "rgba(255,255,255,0.025)";
      g.fillRect(0, 12, FLOOR_W, 30);
      if (stage === 3) {
        for (let i = 0; i < 18; i += 1) {
          g.fillStyle = "rgba(0,0,0,0.12)";
          g.beginPath();
          g.ellipse(r() * FLOOR_W, 30 + r() * 80, 20 + r() * 50, 4 + r() * 8, 0, 0, TAU);
          g.fill();
        }
      }
      for (let i = 0; i < 14; i += 1) {
        g.strokeStyle = "rgba(0,0,0,0.18)";
        g.lineWidth = 1;
        g.beginPath();
        const x = r() * FLOOR_W;
        const y = 14 + r() * 100;
        g.moveTo(x, y);
        g.lineTo(x + 20 + r() * 60, y + (r() - 0.5) * 6);
        g.stroke();
      }
    }
    // Kante: Sockelleiste/Lichtkante
    g.fillStyle = rgbaHex(P.neon, 0.34);
    g.fillRect(0, 0, FLOOR_W, 2);
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.fillRect(0, 2, FLOOR_W, 5);
    // Politur-Glanz (Linoleum spiegelt)
    const sh = g.createLinearGradient(0, 6, 0, 60);
    sh.addColorStop(0, rgbaHex(P.neon, 0.07));
    sh.addColorStop(1, rgbaHex(P.neon, 0));
    g.fillStyle = sh;
    g.fillRect(0, 6, FLOOR_W, 54);
  });
}

/** Ferner Boden zwischen gemalter Kulisse und Laufbahn (Stufenfarbe, 1280×(590-BACK_FLOOR_Y+8)) */
export function paintFarFloor(stage: number): HTMLCanvasElement {
  const P = PALETTE[stage];
  const H = 590 - BACK_FLOOR_Y + 8;
  return paint(1280, H, (g) => {
    g.fillStyle = vgrad(g, 0, H, [
      [0, rgbaHex(P.floorLo, 0.0)],
      [0.12, rgbaHex(P.floorLo, 0.85)],
      [1, rgbaHex(P.floorHi, 1)],
    ]);
    g.fillRect(0, 0, 1280, H);
    g.fillStyle = rgbaHex(P.haze, 0.08);
    g.fillRect(0, 0, 1280, H * 0.5);
  });
}

// =================================================================================================
// Vordergrund: Deckenträger/Kabeltrassen am oberen Rand (Parallax 1.25)

export const FG_W = 1800;
export const FG_H = 84;
export const FG_PAR = 1.25;

export function paintFgTop(): HTMLCanvasElement {
  return paint(FG_W, FG_H, (g) => {
    // Kabeltrasse über die ganze Breite (leicht durchhängend)
    g.strokeStyle = "#04060a";
    g.lineWidth = 3;
    g.beginPath();
    for (let i = 0; i < 3; i += 1) {
      g.moveTo(0, 10 + i * 5);
      for (let x = 0; x <= FG_W; x += 60) g.lineTo(x, 10 + i * 5 + 9 * Math.sin((x / FG_W) * TAU * 3 + i * 0.7) ** 2);
    }
    g.stroke();
    // Träger
    for (const bx of [140, 1040]) {
      g.fillStyle = "#03050a";
      g.fillRect(bx, 0, 120, 44);
      g.fillStyle = "#06090f";
      g.fillRect(bx + 8, 44, 104, 8);
      g.fillStyle = "rgba(140,170,220,0.16)";
      g.fillRect(bx, 43, 120, 1.5);
    }
    // Lüftungsrohr mit Hängern
    g.fillStyle = "#05070c";
    g.beginPath();
    rr(g, 520, 0, 360, 34, 14);
    g.fill();
    g.fillStyle = "rgba(140,170,220,0.14)";
    g.fillRect(530, 30, 340, 1.5);
    for (let x = 540; x < 880; x += 60) {
      g.fillStyle = "#020306";
      g.fillRect(x, 0, 6, 36);
    }
    // herabhängendes Kabel
    g.strokeStyle = "#04060a";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(1400, 18);
    g.quadraticCurveTo(1440, 78, 1500, 22);
    g.stroke();
  });
}

// =================================================================================================
// Taschenlampen-Maske (Dunkelheit mit Lichtkegel): 1280 × 960, Figurbrust bei (300, 500) im Stand

export const MASK_H = 960;

export function paintFlashlightMask(color: string): HTMLCanvasElement {
  return paint(1280, MASK_H, (g) => {
    g.fillStyle = color;
    g.fillRect(0, 0, 1280, MASK_H);
    g.globalCompositeOperation = "destination-out";
    const ox = 318;
    const oy = 492;
    // Lichthof um die Figur
    const halo = g.createRadialGradient(300, 520, 0, 300, 520, 270);
    halo.addColorStop(0, "rgba(0,0,0,0.92)");
    halo.addColorStop(0.45, "rgba(0,0,0,0.6)");
    halo.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = halo;
    g.fillRect(0, 200, 640, 640);
    // Kegel nach vorn (mehrere weiche Schichten, Kern heller)
    const dir = 0.1;
    const layers: Array<[number, number]> = [
      [0.44, 0.14],
      [0.36, 0.18],
      [0.28, 0.22],
      [0.2, 0.26],
    ];
    for (const [half, a] of layers) {
      const grd = g.createRadialGradient(ox, oy, 0, ox, oy, 1100);
      grd.addColorStop(0, `rgba(0,0,0,${a})`);
      grd.addColorStop(0.5, `rgba(0,0,0,${a * 0.8})`);
      grd.addColorStop(1, `rgba(0,0,0,${a * 0.45})`);
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(ox, oy);
      g.lineTo(ox + Math.cos(dir - half) * 1300, oy + Math.sin(dir - half) * 1300);
      g.lineTo(ox + Math.cos(dir + half) * 1300, oy + Math.sin(dir + half) * 1300);
      g.closePath();
      g.fill();
    }
    // Lichtfleck auf dem Boden vor der Figur
    g.save();
    g.translate(700, 606);
    g.scale(1, 0.16);
    const pool = g.createRadialGradient(0, 0, 0, 0, 0, 560);
    pool.addColorStop(0, "rgba(0,0,0,0.45)");
    pool.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = pool;
    g.fillRect(-560, -560, 1120, 1120);
    g.restore();
    // Laufbahn bleibt immer etwas erhellt (Gefahren-Lesbarkeit)
    const lane = g.createLinearGradient(0, 330, 0, 640);
    lane.addColorStop(0, "rgba(0,0,0,0)");
    lane.addColorStop(0.5, "rgba(0,0,0,0.16)");
    lane.addColorStop(0.82, "rgba(0,0,0,0.16)");
    lane.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = lane;
    g.fillRect(0, 330, 1280, 310);
  });
}

/** Sichtbarer Lichtstrahl der Taschenlampe (additiv), Ursprung bei (BEAM_OX, BEAM_OY) */
export const BEAM_OX = 20;
export const BEAM_OY = 140;
export function paintBeam(color: string): HTMLCanvasElement {
  return paint(880, 470, (g) => {
    const ox = BEAM_OX;
    const oy = BEAM_OY;
    const dir = 0.1;
    for (const [half, a] of [
      [0.34, 0.1],
      [0.26, 0.14],
      [0.18, 0.18],
      [0.1, 0.2],
    ] as const) {
      const grd = g.createRadialGradient(ox, oy, 0, ox, oy, 860);
      grd.addColorStop(0, rgbaHex(color, a));
      grd.addColorStop(0.35, rgbaHex(color, a * 0.6));
      grd.addColorStop(1, rgbaHex(color, 0));
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(ox, oy);
      g.lineTo(ox + Math.cos(dir - half) * 1100, oy + Math.sin(dir - half) * 1100);
      g.lineTo(ox + Math.cos(dir + half) * 1100, oy + Math.sin(dir + half) * 1100);
      g.closePath();
      g.fill();
    }
    // heller Kern an der Lampe
    const core = g.createRadialGradient(ox, oy, 0, ox, oy, 60);
    core.addColorStop(0, rgbaHex("#ffffff", 0.35));
    core.addColorStop(1, rgbaHex("#ffffff", 0));
    g.fillStyle = core;
    g.fillRect(ox - 60, oy - 60, 120, 120);
  });
}
