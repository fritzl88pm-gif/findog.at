/**
 * Opernball – gemalte Ebenen: Laden, Vorrendern (1:1-Kacheln in logischer Größe) und Speicherverwaltung.
 *  · Fernebenen (`far-*`, opak, 2240×768 → 2100×720): je Stimmungsstufe ein Bild; nur aktuelle + nächste Stufe im Speicher,
 *    das Quellbild wird nach dem Vorrendern verworfen.
 *  · Mittelgrund (`mid-columns` / `mid-tables`, RGBA): einmal verkleinert und gedämpft (Dunst), damit nichts wie ein Hindernis wirkt.
 *  · Nahgrund (`near-curtain`): nur der obere Vorhangsaum.
 *  · Boden (`ground-carpet` / `ground-parquet`): pro Stufe eingefärbt (lazy, aktuelle + nächste Stufe).
 */
import { makeCanvas } from "../../draw-utils";
import { paint, type Ctx2D } from "../shared-b/canvas";
import { CHANDELIERS, FAR_H, FAR_W } from "./glints";
import { coneSprite } from "./fx";
import { COLORS, DARK, FAR_URLS, GROUND_KIND, GROUND_URLS, MAX_STAGE, MID_COLUMNS_URL, MID_TABLES_URL, NEAR_URL } from "./stages";

export const MID_SCALE = 0.62;
export const NEAR_H = 200;
export const GROUND_TILE_W = 736;
export const GROUND_TILE_H = 130;

/** Bild ohne globalen Cache laden (Referenz kann nach dem Vorrendern verworfen werden). */
export function loadPlain(url: string): Promise<HTMLImageElement | null> {
  if (typeof Image === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      // Dekodieren außerhalb des Hauptthreads abschließen, damit das Vorrendern keinen Ruckler verursacht
      const done = (): void => resolve(img);
      if (typeof img.decode === "function") img.decode().then(done, done);
      else done();
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function release(img: HTMLImageElement | null): void {
  if (img) img.src = "";
}

// --- Fernebene -------------------------------------------------------------------------------------------------------------

/**
 * Fernebene auf 2100×720 vorrendern: leicht gedämpft, unten (Bodenspiegelung) ruhiger, in den Logen/der Polonaise abgedunkelt,
 * mit Lichtkegeln unter den Kronleuchtern (statisch eingebacken – spart Füllrate pro Frame).
 */
export function bakeFar(img: HTMLImageElement, stage: number): HTMLCanvasElement {
  const st = Math.min(stage, MAX_STAGE);
  return paint(FAR_W, FAR_H, (g, w, h) => {
    g.imageSmoothingQuality = "high";
    g.drawImage(img, 0, 0, w, h);
    // Dunst: die Wand tritt zurück
    const haze = g.createLinearGradient(0, 0, 0, h);
    const c = HAZE[st];
    haze.addColorStop(0, `rgba(${c},0.05)`);
    haze.addColorStop(0.55, `rgba(${c},0.10)`);
    haze.addColorStop(1, `rgba(${c},0.22)`);
    g.fillStyle = haze;
    g.fillRect(0, 0, w, h);
    // Saalabdunklung der Stufe (Logen dramatisch, Polonaise dämmrig)
    if (DARK[st] > 0.02) {
      g.fillStyle = `rgba(8,0,4,${Math.min(0.6, DARK[st] * 1.5)})`;
      g.fillRect(0, 0, w, h);
    }
    // Laufbereich beruhigen (Boden dunkler, Hindernisse heben sich ab)
    const floor = g.createLinearGradient(0, 470, 0, 640);
    floor.addColorStop(0, "rgba(12,4,4,0)");
    floor.addColorStop(1, "rgba(12,4,4,0.36)");
    g.fillStyle = floor;
    g.fillRect(0, 470, w, 250);
    // Lichtkegel unter den Kronleuchtern
    const cone = coneSprite(300, 540, COLORS.css(st).cone);
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.2;
    for (const [cx, cy] of CHANDELIERS[st]) {
      for (const off of [0, -w, w]) {
        const x = cx + off - 150;
        if (x > w || x + 300 < 0) continue;
        g.drawImage(cone, x, cy + 24);
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  });
}
const HAZE = ["255,236,205", "255,205,130", "150,20,20", "205,222,255", "60,30,110"];

/** Lazy geladene Fernebenen mit Speicherbegrenzung (aktuelle + nächste Stufe). */
export class FarLayers {
  private tiles: Array<HTMLCanvasElement | null> = [null, null, null, null, null];
  private loading = new Set<number>();
  private disposed = false;

  has(stage: number): boolean {
    return !!this.tiles[stage];
  }

  tile(stage: number): HTMLCanvasElement | null {
    return this.tiles[Math.max(0, Math.min(MAX_STAGE, stage))];
  }

  /** Nächstbeste bereite Kachel (für Übergänge, solange die Zielstufe noch lädt). */
  best(stage: number): HTMLCanvasElement | null {
    for (let d = 0; d <= MAX_STAGE; d += 1) {
      const a = this.tiles[stage - d];
      if (a) return a;
      const b = this.tiles[stage + d];
      if (b) return b;
    }
    return null;
  }

  async ensure(stage: number): Promise<void> {
    if (stage < 0 || stage > MAX_STAGE || this.tiles[stage] || this.loading.has(stage) || this.disposed) return;
    this.loading.add(stage);
    const img = await loadPlain(FAR_URLS[stage]);
    this.loading.delete(stage);
    if (!img || this.disposed) return;
    this.tiles[stage] = bakeFar(img, stage);
    release(img);
  }

  /** Nur Stufen `a` und `b` behalten, den Rest freigeben. */
  keep(a: number, b: number): void {
    for (let i = 0; i <= MAX_STAGE; i += 1) if (i !== a && i !== b && this.tiles[i]) this.tiles[i] = null;
  }

  dispose(): void {
    this.disposed = true;
    this.tiles = [null, null, null, null, null];
  }
}

// --- Mittelgrund ------------------------------------------------------------------------------------------------------------------

export interface MidLayer {
  /** oben auf die Objekte zugeschnittene Kachel */
  c: HTMLCanvasElement;
  w: number;
  h: number;
  /** y-Position der Unterkante der Objekte in der zugeschnittenen Kachel */
  footY: number;
  /** belegte x-Bereiche (leere Lücken werden nicht geblittet – spart Füllrate im Software-Rendering) */
  spans: Array<[number, number]>;
}

/** Zeilen-/Spaltenbelegung (Alpha) einer Kachel: Bereich oberhalb des ersten Objekts und belegte Spalten in 8-px-Blöcken. */
function occupancy(c: HTMLCanvasElement): { top: number; spans: Array<[number, number]> } {
  const B = 8;
  try {
    const sw = Math.ceil(c.width / B);
    const sh = Math.ceil(c.height / B);
    const small = makeCanvas(sw, sh);
    const sg = small.getContext("2d", { willReadFrequently: true });
    if (!sg) throw new Error("kein Kontext");
    sg.imageSmoothingQuality = "high";
    sg.drawImage(c, 0, 0, sw, sh);
    const d = sg.getImageData(0, 0, sw, sh).data;
    let top = sh;
    const col = new Uint8Array(sw);
    for (let y = 0; y < sh; y += 1) {
      for (let x = 0; x < sw; x += 1) {
        if (d[(y * sw + x) * 4 + 3] > 10) {
          if (y < top) top = y;
          col[x] = 1;
        }
      }
    }
    const spans: Array<[number, number]> = [];
    let x = 0;
    while (x < sw) {
      if (!col[x]) {
        x += 1;
        continue;
      }
      const a = x;
      while (x < sw && col[x]) x += 1;
      // Lücken bis 2 Blöcke schließen
      if (spans.length && a - spans[spans.length - 1][1] / B <= 2) spans[spans.length - 1][1] = Math.min(c.width, x * B + B);
      else spans.push([Math.max(0, (a - 1) * B), Math.min(c.width, x * B + B)]);
    }
    return { top: Math.max(0, (top - 1) * B), spans: spans.length ? spans : [[0, c.width]] };
  } catch {
    return { top: 0, spans: [[0, c.width]] };
  }
}

/**
 * Die gemalten Kacheln haben an der Naht halbtransparente „Geister“ (Säulen-/Stuhlreste vom Überblenden). Am linken Rand
 * werden alle Pixel mit Alpha < 200 gelöscht; die volldeckenden Objekte bleiben unberührt.
 */
function cleanSeam(img: HTMLImageElement): HTMLImageElement | HTMLCanvasElement {
  try {
    const c = makeCanvas(img.width, img.height);
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!g) return img;
    g.drawImage(img, 0, 0);
    const W = 72;
    const d = g.getImageData(0, 0, W, img.height);
    for (let i = 3; i < d.data.length; i += 4) if (d.data[i] < 200) d.data[i] = 0;
    g.putImageData(d, 0, 0);
    return c;
  } catch {
    return img;
  }
}

/**
 * Mittelgrund verkleinern und in Dunst tauchen (`tone` = Dunstfarbe, `a` = Stärke). Leichte Unschärfe (Tiefenschärfe),
 * gedämpfte Farben und ein Schleier über dem Fußbereich sorgen dafür, dass Vasen, Seile und Tafeln im Hintergrund nie mit den
 * scharfen, hell gerandeten Hindernissen verwechselt werden.
 */
export function bakeMid(src: HTMLImageElement, contentBottom: number, tone: string, a: number): MidLayer {
  const img = cleanSeam(src);
  const w = Math.round(img.width * MID_SCALE);
  const h = Math.round(img.height * MID_SCALE);
  const PAD = 24;
  // nahtlos unscharf: Bild dreimal nebeneinander, Mitte ausschneiden
  const wide = makeCanvas(w + PAD * 2, h);
  const wg = wide.getContext("2d");
  if (wg) {
    wg.imageSmoothingQuality = "high";
    try {
      wg.filter = "blur(1.6px) saturate(0.8) brightness(0.9)";
    } catch {
      /* Filter nicht unterstützt: ohne Unschärfe weiter */
    }
    for (const dx of [-w, 0, w]) wg.drawImage(img, dx + PAD, 0, w, h);
    wg.filter = "none";
  }
  const c = paint(w, h, (g) => {
    g.drawImage(wide, PAD, 0, w, h, 0, 0, w, h);
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = `rgba(${tone},${a})`;
    g.fillRect(0, 0, w, h);
    // nach unten tiefer im Schatten (Boden liegt im Halbdunkel)
    const sh = g.createLinearGradient(0, h * 0.45, 0, h);
    sh.addColorStop(0, "rgba(20,6,8,0)");
    sh.addColorStop(1, "rgba(20,6,8,0.34)");
    g.fillStyle = sh;
    g.fillRect(0, h * 0.45, w, h * 0.55);
    // Fußbereich verschwimmt im Bodendunst
    g.globalCompositeOperation = "destination-out";
    const foot = contentBottom * MID_SCALE;
    const fade = g.createLinearGradient(0, foot - 110, 0, foot + 4);
    fade.addColorStop(0, "rgba(0,0,0,0)");
    fade.addColorStop(1, "rgba(0,0,0,0.42)");
    g.fillStyle = fade;
    g.fillRect(0, foot - 110, w, h - foot + 114);
  });
  const occ = occupancy(c);
  const top = Math.min(occ.top, Math.floor(contentBottom * MID_SCALE) - 8);
  const crop = makeCanvas(w, h - top);
  crop.getContext("2d")?.drawImage(c, 0, top, w, h - top, 0, 0, w, h - top);
  return { c: crop, w, h: h - top, footY: contentBottom * MID_SCALE - top, spans: occ.spans };
}

export const COLUMNS_BOTTOM = 742;
export const TABLES_BOTTOM = 735;

export async function loadMids(): Promise<{ cols: MidLayer | null; tabs: MidLayer | null }> {
  const [ci, ti] = await Promise.all([loadPlain(MID_COLUMNS_URL), loadPlain(MID_TABLES_URL)]);
  const cols = ci ? bakeMid(ci, COLUMNS_BOTTOM, "56,20,24", 0.34) : null;
  const tabs = ti ? bakeMid(ti, TABLES_BOTTOM, "56,20,24", 0.3) : null;
  release(ci);
  release(ti);
  return { cols, tabs };
}

// --- Nahgrund ---------------------------------------------------------------------------------------------------------------------

export interface NearLayer {
  c: HTMLCanvasElement;
  w: number;
  h: number;
  spans: Array<[number, number]>;
}

export async function loadNear(): Promise<NearLayer | null> {
  const img = await loadPlain(NEAR_URL);
  if (!img) return null;
  const k = FAR_H / img.height;
  const w = Math.round(img.width * k);
  const srcH = Math.round(NEAR_H / k);
  const c = paint(w, NEAR_H, (g, ww, hh) => {
    g.imageSmoothingQuality = "high";
    g.drawImage(img, 0, 0, img.width, srcH, 0, 0, ww, hh);
    // unterer Rand blendet aus (Seitenvorhänge enden weich)
    g.globalCompositeOperation = "destination-out";
    const fade = g.createLinearGradient(0, hh * 0.55, 0, hh);
    fade.addColorStop(0, "rgba(0,0,0,0)");
    fade.addColorStop(1, "rgba(0,0,0,1)");
    g.fillStyle = fade;
    g.fillRect(0, hh * 0.55, ww, hh * 0.45);
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = "rgba(40,6,10,0.16)";
    g.fillRect(0, 0, ww, hh);
  });
  const layer = { c, w: c.width, h: c.height, spans: occupancy(c).spans };
  release(img);
  return layer;
}

// --- Boden --------------------------------------------------------------------------------------------------------------------------

export interface GroundBase {
  carpet: HTMLCanvasElement | null;
  parquet: HTMLCanvasElement | null;
}

/** Oberen Streifen (260 Quellzeilen ≙ 130 logische px bei Maßstab 0,5) beider Bodenbilder vorhalten. */
export async function loadGroundBase(): Promise<GroundBase> {
  const [ci, pi] = await Promise.all([loadPlain(GROUND_URLS.carpet), loadPlain(GROUND_URLS.parquet)]);
  const crop = (img: HTMLImageElement | null): HTMLCanvasElement | null => {
    if (!img) return null;
    const rows = Math.min(img.height, 300);
    const c = makeCanvas(img.width, rows);
    c.getContext("2d")?.drawImage(img, 0, 0, img.width, rows, 0, 0, img.width, rows);
    return c;
  };
  const base = { carpet: crop(ci), parquet: crop(pi) };
  release(ci);
  release(pi);
  return base;
}

interface GroundTint {
  /** Farbmischung über den Boden ("color"-Modus färbt um, behält die Helligkeit) */
  color?: [string, number];
  /** Abdunkeln (0..1) */
  dark: number;
  /** Aufhellen mit Farbe (source-over, schwach) */
  lift?: [string, number];
  /** Aufhellen im "screen"-Modus (kühles Marmorlicht) */
  screen?: [string, number];
}

const GROUND_TINT: GroundTint[] = [
  { dark: 0.1, lift: ["255,236,200", 0.05] },
  { dark: 0.24, lift: ["255,190,110", 0.02] },
  { dark: 0.34, color: ["#8a1020", 0.22] },
  { dark: 0.06, color: ["#9db4e4", 0.62], screen: ["#6f86b4", 0.42] },
  { dark: 0.3, color: ["#6a2aa8", 0.55], lift: ["255,110,215", 0.05] },
];

/** Bodenkachel (736×130 logisch, mit Pixelfaktor k) für Stufe `stage` erzeugen. */
export function bakeGround(base: GroundBase, stage: number, k: number): HTMLCanvasElement {
  const kind = GROUND_KIND[Math.min(stage, MAX_STAGE)];
  const src = base[kind] ?? base.parquet ?? base.carpet;
  const W = Math.round(GROUND_TILE_W * k);
  const H = Math.round(GROUND_TILE_H * k);
  const c = makeCanvas(W, H);
  const g = c.getContext("2d");
  if (!g) return c;
  g.imageSmoothingQuality = "high";
  if (src) {
    // Quelle: 1472 breit ≙ 736 logisch (Maßstab 0,5), 260 Zeilen ≙ 130 logisch
    g.drawImage(src, 0, 0, src.width, Math.min(src.height, 260), 0, 0, W, H);
  } else {
    g.fillStyle = "#6a2a14";
    g.fillRect(0, 0, W, H);
  }
  const t = GROUND_TINT[Math.min(stage, MAX_STAGE)];
  if (t.color) {
    g.globalCompositeOperation = "color";
    g.globalAlpha = t.color[1];
    g.fillStyle = t.color[0];
    g.fillRect(0, 0, W, H);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
  if (t.screen) {
    g.globalCompositeOperation = "screen";
    g.globalAlpha = t.screen[1];
    g.fillStyle = t.screen[0];
    g.fillRect(0, 0, W, H);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
  if (t.lift) {
    g.fillStyle = `rgba(${t.lift[0]},${t.lift[1]})`;
    g.fillRect(0, 0, W, H);
  }
  // Tiefe: unten dunkler, die vorderste Kante fast schwarz-weinrot
  const shade = g.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, `rgba(20,6,6,${t.dark * 0.35})`);
  shade.addColorStop(0.5, `rgba(20,6,6,${t.dark})`);
  shade.addColorStop(1, `rgba(12,2,4,${Math.min(0.85, t.dark + 0.42)})`);
  g.fillStyle = shade;
  g.fillRect(0, 0, W, H);
  return c;
}

export type { Ctx2D };
