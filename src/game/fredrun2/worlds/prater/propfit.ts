/**
 * Prater – Prop-Bank für die Hindernis-Sprites (prater-booth, -candy-crate, -tires, -valance, -ghostgate, -swing-chair).
 *
 * Die Bilder sind eng zugeschnitten (Alpha-Bounding-Box + 5 px transparenter Rand) und ca. 500 px groß. Damit sie nach dem
 * Verkleinern nicht flimmern, werden sie einmal pro Zielgröße (zweistufig, „high“-Glättung) auf ein kleines Offscreen-Canvas
 * gebacken; pro Frame kostet das Zeichnen danach genau ein `drawImage`. Der Cache ist ein kleiner LRU.
 */
import { makeCanvas } from "../../draw-utils";
import type { PropLibrary } from "../../types";
import { touchCanvas } from "../shared-b/canvas";

/** Transparenter Rand um die Silhouette im Quellbild (px) */
export const PROP_PAD = 5;

/** Ausschnitt der Silhouette in Anteilen [x0, y0, x1, y1] (0…1) */
export type PropCrop = readonly [number, number, number, number];

export interface Baked {
  c: HTMLCanvasElement;
  /** logische Größe (Canvas-Pixel / Pixelfaktor) */
  w: number;
  h: number;
}

/** Speicherbudget des Caches (Bytes, RGBA) – die großen Überhang-Sprites sind bei Pixelfaktor 2 mehrere MB schwer */
const MAX_BYTES = 28 * 1024 * 1024;

/**
 * Silhouette (Höhe/Breite = `aspect`) so in ein Zielrechteck w×h einpassen, dass die Hitbox überdeckt bleibt:
 * Das Verhältnis Ziel/Natur darf zwischen `rmin` und `rmax` gestaucht/gestreckt werden; darüber hinaus wird das Bild größer
 * (flache Hitbox → höher als die Hitbox, hohe Hitbox → breiter), nie kleiner – der Spieler sieht so nie „Luft-Kollisionen“.
 */
export function fitBox(aspect: number, w: number, h: number, rmin: number, rmax: number): { w: number; h: number } {
  const r = h / w / aspect;
  if (r < rmin) return { w, h: w * aspect * rmin };
  if (r > rmax) return { w: h / (aspect * rmax), h };
  return { w, h };
}

/** Auf ein Vielfaches von q aufrunden (weniger verschiedene Sprite-Größen im Cache, Bild nie kleiner als die Hitbox) */
export function quant(v: number, q = 4): number {
  return Math.ceil(v / q - 0.001) * q;
}

function sameCrop(a: PropCrop | undefined, b: PropCrop | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

interface BankEntry {
  b: Baked;
  crop: PropCrop | undefined;
  /** Zähler der letzten Verwendung (kleinster wird zuerst verdrängt) */
  use: number;
  bytes: number;
  id: string;
  size: number;
}

export class PropBank {
  private props: PropLibrary | null = null;
  private k = 1;
  /** id → Zielgröße (tw·16384 + th) → Varianten (Ausschnitt): Treffer ohne String-Schlüssel und ohne Allokation */
  private cache = new Map<string, Map<number, BankEntry[]>>();
  private entries: BankEntry[] = [];
  private tick = 0;
  private bytes = 0;

  setProps(p: PropLibrary | null): void {
    this.props = p;
    this.clear();
  }

  private clear(): void {
    this.cache.clear();
    this.entries.length = 0;
    this.bytes = 0;
  }

  /** Anzahl gebackener Sprites */
  get size(): number {
    return this.entries.length;
  }

  /** Pixelfaktor der Zeichenfläche (1 … 2); bei Änderung (> 0,2) werden die Sprites neu gebacken. */
  setScale(k: number): void {
    const nk = Math.min(2, Math.max(1, k));
    if (Math.abs(nk - this.k) > 0.2) {
      this.k = nk;
      this.clear();
    }
  }

  get scale(): number {
    return this.k;
  }

  has(id: string): boolean {
    return !!this.props && this.props.has(id) && !!this.props.cell(id);
  }

  /** Natürliches Seitenverhältnis (Höhe/Breite) der sichtbaren Silhouette bzw. des Ausschnitts; null = Prop nicht geladen */
  aspect(id: string, crop?: PropCrop): number | null {
    const cell = this.has(id) ? this.props?.cell(id) : null;
    if (!cell) return null;
    const sw = cell.w - PROP_PAD * 2;
    const sh = cell.h - PROP_PAD * 2;
    const c = crop ?? [0, 0, 1, 1];
    return (sh * (c[3] - c[1])) / (sw * (c[2] - c[0]));
  }

  /** Silhouette (bzw. Ausschnitt) in w×h logischen Pixeln; null, wenn das Prop nicht geladen ist. */
  get(id: string, w: number, h: number, crop?: PropCrop): Baked | null {
    const props = this.props;
    if (!props || !props.has(id)) return null;
    const k = this.k;
    const tw = Math.max(2, Math.round(w * k));
    const th = Math.max(2, Math.round(h * k));
    const size = tw * 16384 + th;
    const byId = this.cache.get(id);
    const list = byId?.get(size);
    if (list) {
      for (let i = 0; i < list.length; i += 1) {
        const e = list[i];
        if (sameCrop(e.crop, crop)) {
          e.use = ++this.tick; // zuletzt benutzt (Verdrängung nach Alter der Nutzung)
          return e.b;
        }
      }
    }
    const cell = props.cell(id);
    if (!cell) return null;
    const c = crop ?? [0, 0, 1, 1];
    const sw = cell.w - PROP_PAD * 2;
    const sh = cell.h - PROP_PAD * 2;
    const rx = PROP_PAD + c[0] * sw;
    const ry = PROP_PAD + c[1] * sh;
    const rw = (c[2] - c[0]) * sw;
    const rh = (c[3] - c[1]) * sh;
    // Zweistufig verkleinern (bessere Kanten bei starker Verkleinerung)
    const ratio = Math.max(rw / tw, rh / th);
    let src: HTMLCanvasElement | null = null;
    if (ratio > 2.2) {
      const mw = Math.round(tw * 2);
      const mh = Math.round(th * 2);
      const mid = makeCanvas(mw, mh);
      const mg = mid.getContext("2d");
      if (!mg) return null;
      mg.imageSmoothingQuality = "high";
      paintRegion(mg, props, id, rx, ry, rw, rh, mw, mh);
      src = mid;
    }
    const out = makeCanvas(tw, th);
    const og = out.getContext("2d");
    if (!og) return null;
    og.imageSmoothingQuality = "high";
    if (src) og.drawImage(src, 0, 0, tw, th);
    else paintRegion(og, props, id, rx, ry, rw, rh, tw, th);
    // Rasterkosten jetzt zahlen (beim Vorbacken im Leerlauf), nicht im Frame, in dem das Hindernis zuerst erscheint
    touchCanvas(out);
    const b: Baked = { c: out, w: tw / k, h: th / k };
    const entry: BankEntry = { b, crop: crop ? [crop[0], crop[1], crop[2], crop[3]] : undefined, use: ++this.tick, bytes: tw * th * 4, id, size };
    let m = byId;
    if (!m) {
      m = new Map();
      this.cache.set(id, m);
    }
    const l = m.get(size);
    if (l) l.push(entry);
    else m.set(size, [entry]);
    this.entries.push(entry);
    this.bytes += entry.bytes;
    // LRU über das Speicherbudget: am längsten ungenutzte zuerst; das eben gebackene Sprite bleibt immer
    while (this.bytes > MAX_BYTES && this.entries.length > 1) this.evictLeastUsed(entry);
    return b;
  }

  private evictLeastUsed(keep: BankEntry): void {
    let at = -1;
    for (let i = 0; i < this.entries.length; i += 1) {
      const e = this.entries[i];
      if (e !== keep && (at < 0 || e.use < this.entries[at].use)) at = i;
    }
    if (at < 0) return;
    const old = this.entries[at];
    this.entries.splice(at, 1);
    this.bytes -= old.bytes;
    const m = this.cache.get(old.id);
    const l = m?.get(old.size);
    if (!m || !l) return;
    const i = l.indexOf(old);
    if (i >= 0) l.splice(i, 1);
    if (!l.length) m.delete(old.size);
    if (!m.size) this.cache.delete(old.id);
  }

  /** Auf das Pixelraster der Zeichenfläche runden (scharfe Kanten, kein Flimmern) */
  snap(v: number): number {
    return Math.round(v * this.k) / this.k;
  }
}

/** Quell-Rechteck (rx, ry, rw, rh in Zellpixeln) auf (0, 0, dw, dh) zeichnen */
function paintRegion(g: CanvasRenderingContext2D, props: PropLibrary, id: string, rx: number, ry: number, rw: number, rh: number, dw: number, dh: number): void {
  g.save();
  g.beginPath();
  g.rect(0, 0, dw, dh);
  g.clip();
  g.scale(dw / rw, dh / rh);
  g.translate(-rx, -ry);
  props.draw(g, id, 0, 0, { ax: 0, ay: 0 });
  g.restore();
}
