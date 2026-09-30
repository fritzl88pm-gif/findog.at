/**
 * Opernball – Sprite-Bank: rendert Props einmal in Zielgröße auf kleine Canvases (gute Verkleinerung ohne Flimmern),
 * legt bei Bedarf einen hellen Rim-Light-Rand (Sticker-Look) darunter und liefert Spiegelbilder für den Parkettboden.
 * Zeichnen kostet danach ein einziges `drawImage`.
 */
import { makeCanvas } from "../../draw-utils";
import type { PropLibrary } from "../../types";
import { OPER_FALLBACK } from "./fallback";

export interface Baked {
  c: HTMLCanvasElement;
  /** logische Größe der Fläche (inkl. Rand) */
  w: number;
  h: number;
  /** Ankerpunkt in logischen Pixeln ab der linken oberen Ecke */
  ax: number;
  ay: number;
  /** Höhe des eigentlichen Bildes (ohne Rand) */
  bodyH: number;
  bodyW: number;
}

export interface BakeOpts {
  /** Anker relativ zum Bild (0..1); Standard Mitte unten */
  ax?: number;
  ay?: number;
  /** Rim-Light-Stärke in logischen px (0 = keiner) */
  rim?: number;
  rimColor?: string;
  /** Zielbreite statt Zielhöhe */
  w?: number;
}

const ctxOf = (c: HTMLCanvasElement): CanvasRenderingContext2D => {
  const g = c.getContext("2d");
  if (!g) throw new Error("2D-Kontext nicht verfügbar");
  return g;
};

export class SpriteBank {
  private k = 1;
  private cache = new Map<string, Baked | null>();
  private reflCache = new Map<string, HTMLCanvasElement>();

  constructor(private props: PropLibrary | null = null) {}

  setProps(p: PropLibrary): void {
    this.props = p;
    this.cache.clear();
    this.reflCache.clear();
  }

  /** Pixelfaktor der Zeichenfläche (1 … 2); bei Änderung werden die Sprites neu gebacken. */
  setScale(k: number): void {
    const nk = Math.min(2, Math.max(1, k));
    if (Math.abs(nk - this.k) > 0.2) {
      this.k = nk;
      this.cache.clear();
      this.reflCache.clear();
    }
  }

  has(id: string): boolean {
    return !!this.props?.has(id);
  }

  /**
   * Bild `id` mit der Höhe `h` (logisch) backen. Fehlt das gemalte Prop (Netzfehler, Blocker, veralteter Manifest-Cache),
   * entsteht stattdessen der prozedurale Ersatz aus `fallback.ts` (gleiche Maße, Ausrichtung und Ankerpunkte);
   * null nur für unbekannte Ids ohne Prop.
   */
  get(id: string, h: number, o: BakeOpts = {}): Baked | null {
    const real = !!this.props && this.props.has(id);
    const fb = real ? null : (OPER_FALLBACK[id] ?? null);
    const key = `${id}|${Math.round(h)}|${o.ax ?? 0.5}|${o.ay ?? 1}|${o.rim ?? 0}|${o.w ?? 0}|${o.rimColor ?? ""}${fb ? "|fb" : ""}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const b = this.bake(id, h, o, fb);
    // fehlende Props nicht dauerhaft als „nicht vorhanden“ merken (könnten später noch eintreffen)
    if (b || real) this.cache.set(key, b);
    return b;
  }

  private bake(id: string, h: number, o: BakeOpts, fb: { w: number; h: number; paint: (g: CanvasRenderingContext2D, w: number, h: number) => void } | null): Baked | null {
    const props = this.props;
    let cell: { w: number; h: number } | null = null;
    if (fb) cell = fb;
    else if (props?.has(id)) cell = props.cell(id);
    if (!cell) return null;
    const k = this.k;
    const ax = o.ax ?? 0.5;
    const ay = o.ay ?? 1;
    const scale = o.w !== undefined ? o.w / cell.w : h / cell.h;
    const bodyHL = cell.h * scale;
    const bodyWL = cell.w * scale;
    const rim = o.rim ?? 0;
    const padL = Math.ceil(rim + 2);
    const bw = Math.max(2, Math.round(bodyWL * k));
    const bh = Math.max(2, Math.round(bodyHL * k));
    const pad = Math.round(padL * k);
    // zweistufig verkleinern (bessere Kantenqualität bei starker Verkleinerung)
    const big = makeCanvas(bw * 2, bh * 2);
    const bg = ctxOf(big);
    bg.imageSmoothingQuality = "high";
    if (fb) {
      bg.save();
      bg.scale((bw * 2) / fb.w, (bh * 2) / fb.h);
      try {
        fb.paint(bg, fb.w, fb.h);
      } catch {
        return null; // Ersatzbild nicht darstellbar → der Skin nutzt seinen einfachen Notbehelf
      }
      bg.restore();
    } else props?.draw(bg, id, ax * bw * 2, ay * bh * 2, { w: bw * 2, ax, ay });
    const body = makeCanvas(bw + pad * 2, bh + pad * 2);
    const g = ctxOf(body);
    g.imageSmoothingQuality = "high";
    g.drawImage(big, pad, pad, bw, bh);
    let out = body;
    if (rim > 0) {
      out = makeCanvas(body.width, body.height);
      const og = ctxOf(out);
      const sil = makeCanvas(body.width, body.height);
      const sg = ctxOf(sil);
      sg.drawImage(body, 0, 0);
      sg.globalCompositeOperation = "source-in";
      sg.fillStyle = o.rimColor ?? "#fff1c9";
      sg.fillRect(0, 0, sil.width, sil.height);
      const r = rim * k;
      for (const rr of [r, r * 0.55]) {
        const n = 14;
        for (let i = 0; i < n; i += 1) {
          const a = (i / n) * Math.PI * 2;
          og.drawImage(sil, Math.cos(a) * rr, Math.sin(a) * rr);
        }
      }
      og.drawImage(body, 0, 0);
    }
    return { c: out, w: out.width / k, h: out.height / k, ax: (pad + ax * bw) / k, ay: (pad + ay * bh) / k, bodyH: bodyHL, bodyW: bodyWL };
  }

  /** Spiegelbild (Boden-Reflexion): auf `squash` der Höhe gestaucht, nach unten ausgeblendet. Nur für Sprites mit Anker unten. */
  reflection(b: Baked, key: string, squash = 0.5, alpha = 0.3): HTMLCanvasElement {
    const ck = `${key}|${squash}|${alpha}`;
    let r = this.reflCache.get(ck);
    if (r) return r;
    const w = b.c.width;
    const h = Math.max(2, Math.round(b.c.height * squash));
    r = makeCanvas(w, h);
    const g = ctxOf(r);
    g.save();
    g.translate(0, h);
    g.scale(1, -squash);
    g.drawImage(b.c, 0, 0);
    g.restore();
    g.globalCompositeOperation = "destination-in";
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, `rgba(0,0,0,${alpha})`);
    grd.addColorStop(0.55, `rgba(0,0,0,${alpha * 0.35})`);
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    this.reflCache.set(ck, r);
    return r;
  }
}

/** Baked-Sprite mit Anker (x, y) zeichnen; optional Drehung/Skalierung/Spiegelung um den Anker. */
export function drawBaked(
  g: CanvasRenderingContext2D,
  b: Baked,
  x: number,
  y: number,
  o: { sx?: number; sy?: number; rot?: number; alpha?: number; flipX?: boolean } = {},
): void {
  const sx = (o.sx ?? 1) * (o.flipX ? -1 : 1);
  const sy = o.sy ?? 1;
  const prev = g.globalAlpha;
  if (o.alpha !== undefined) g.globalAlpha = prev * o.alpha;
  if (sx === 1 && sy === 1 && !o.rot) {
    g.drawImage(b.c, x - b.ax, y - b.ay, b.w, b.h);
  } else {
    g.save();
    g.translate(x, y);
    if (o.rot) g.rotate(o.rot);
    g.scale(sx, sy);
    g.drawImage(b.c, -b.ax, -b.ay, b.w, b.h);
    g.restore();
  }
  g.globalAlpha = prev;
}
