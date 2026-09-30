/**
 * Wachau – Hilfen für die Hindernis-Sprites (wachau-cask, -crates, -wall, -branch, -vines).
 *
 * Die Bilder sind eng zugeschnitten (Alpha-Bounding-Box + 5 px transparenter Rand) und ca. 500 px groß. Sie werden einmal
 * pro Zielgröße (zweistufig, „high“-Glättung) auf ein Offscreen-Canvas gebacken; das Ergebnis läuft anschließend durch den
 * Sprite-Cache der Skins (Stufen-Tönung, Rimlight). Pro Frame kostet das Zeichnen nur `drawImage`.
 */
import { paint } from "../shared-b/canvas";
import type { PropLibrary } from "../../types";

/** Transparenter Rand um die Silhouette im Quellbild (px) */
export const PROP_PAD = 5;

export type PropCrop = readonly [number, number, number, number];

/** Natürliches Seitenverhältnis (Höhe/Breite) der sichtbaren Silhouette; null = Prop nicht geladen */
export function propAspect(props: PropLibrary | null, id: string): number | null {
  if (!props || !props.has(id)) return null;
  const cell = props.cell(id);
  if (!cell) return null;
  return (cell.h - PROP_PAD * 2) / (cell.w - PROP_PAD * 2);
}

/** Vergrößerungsfaktor Silhouette → Zielbreite w */
export function propScale(props: PropLibrary, id: string, w: number): number {
  const cell = props.cell(id);
  return cell ? w / (cell.w - PROP_PAD * 2) : 1;
}

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

/** Silhouette (bzw. Ausschnitt) in w×h logischen Pixeln backen; Canvas hat den Pixelfaktor k (Zeichnen: Größe / k) */
export function bakeProp(props: PropLibrary, id: string, w: number, h: number, k: number, crop?: PropCrop): HTMLCanvasElement {
  const cell = props.cell(id);
  const tw = Math.max(2, Math.round(w * k));
  const th = Math.max(2, Math.round(h * k));
  if (!cell) return paint(tw, th, () => undefined);
  const c = crop ?? [0, 0, 1, 1];
  const sw = cell.w - PROP_PAD * 2;
  const sh = cell.h - PROP_PAD * 2;
  const rx = PROP_PAD + c[0] * sw;
  const ry = PROP_PAD + c[1] * sh;
  const rw = (c[2] - c[0]) * sw;
  const rh = (c[3] - c[1]) * sh;
  const ratio = Math.max(rw / tw, rh / th);
  if (ratio > 2.2) {
    // zweistufig verkleinern: erst auf das Doppelte der Zielgröße
    const mid = paint(Math.round(tw * 2), Math.round(th * 2), (g, mw, mh) => {
      g.imageSmoothingQuality = "high";
      paintRegion(g, props, id, rx, ry, rw, rh, mw, mh);
    });
    return paint(tw, th, (g) => {
      g.imageSmoothingQuality = "high";
      g.drawImage(mid, 0, 0, tw, th);
    });
  }
  return paint(tw, th, (g) => {
    g.imageSmoothingQuality = "high";
    paintRegion(g, props, id, rx, ry, rw, rh, tw, th);
  });
}

/**
 * Verlängert einen am oberen Bildrand abgeschnittenen Ast nach oben: ein schmaler Streifen (Zellzeilen y0…y1, Spalten x0…x1)
 * wird in Ast-Richtung (Scherung `m` = Pixel nach rechts je Pixel nach oben) auf `extH` Höhe gezogen. Das Ergebnis ist
 * ein Canvas (1:1 logische Pixel) mit dem unteren Rand = Streifenzeile y0; `kx` = Vergrößerung Zelle → Bildschirm.
 */
export function bakeStretch(props: PropLibrary, id: string, x0: number, x1: number, y0: number, y1: number, kx: number, extH: number, m: number): HTMLCanvasElement {
  const rows = y1 - y0;
  const F = extH / rows;
  const W = Math.ceil((x1 - x0) * kx + m * extH) + 2;
  return paint(W, Math.ceil(extH), (g, _w, h) => {
    g.imageSmoothingQuality = "high";
    // Zellpixel (u, v) → Canvas: x = kx·(u − x0) + m·F·(v − y0), y = h − F·(v − y0) (Streifen von unten nach oben, gespiegelt)
    g.setTransform(kx, 0, m * F, -F, -x0 * kx - m * F * y0, h + F * y0);
    g.beginPath();
    g.rect(x0, y0, x1 - x0, rows);
    g.clip();
    props.draw(g, id, 0, 0, { ax: 0, ay: 0 });
  });
}
