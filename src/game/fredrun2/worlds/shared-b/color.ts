/**
 * Farb- und Stufen-Helfer für die Welten Prater, Wachau, Cyber (Agent B).
 * Farben werden einmal geparst und pro Frame nur noch numerisch gemischt (keine Regex/Parse-Kosten im Frame).
 */

export type RGB = readonly [number, number, number];

export function hexRgb(hex: string): RGB {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function lerpN(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function mixRgb(a: RGB, b: RGB, t: number): [number, number, number] {
  return [lerpN(a[0], b[0], t), lerpN(a[1], b[1], t), lerpN(a[2], b[2], t)];
}

export function css(c: RGB, a = 1): string {
  const r = Math.round(c[0]);
  const g = Math.round(c[1]);
  const b = Math.round(c[2]);
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a < 0 ? 0 : a.toFixed(3)})`;
}

/** Linear über eine Stufenliste interpolieren (s = stage + stageBlend, Fließkomma). */
export function stageVal(arr: readonly number[], s: number): number {
  if (arr.length === 0) return 0;
  const i = Math.max(0, Math.min(arr.length - 1, Math.floor(s)));
  const j = Math.min(arr.length - 1, i + 1);
  const t = Math.max(0, Math.min(1, s - i));
  return lerpN(arr[i], arr[j], t);
}

/**
 * Stufen-Palette: pro Stufe ein Satz benannter Farben. `get(s)` mischt zwischen benachbarten Stufen.
 * Das Ergebnisobjekt wird wiederverwendet (keine Allokation pro Frame außer Strings).
 */
export class StagePalette<K extends string> {
  private readonly stages: Array<Record<K, RGB>>;
  private readonly keys: K[];
  private readonly outRgb = {} as Record<K, [number, number, number]>;
  private readonly outCss = {} as Record<K, string>;
  private lastS = -999;

  constructor(stages: Array<Record<K, string>>) {
    this.keys = Object.keys(stages[0]) as K[];
    this.stages = stages.map((st) => {
      const o = {} as Record<K, RGB>;
      for (const k of this.keys) o[k] = hexRgb(st[k]);
      return o;
    });
    for (const k of this.keys) this.outRgb[k] = [0, 0, 0];
  }

  private update(s: number): void {
    if (Math.abs(s - this.lastS) < 0.0005) return;
    this.lastS = s;
    const n = this.stages.length;
    const i = Math.max(0, Math.min(n - 1, Math.floor(s)));
    const j = Math.min(n - 1, i + 1);
    const t = Math.max(0, Math.min(1, s - i));
    for (const k of this.keys) {
      const a = this.stages[i][k];
      const b = this.stages[j][k];
      const o = this.outRgb[k];
      o[0] = lerpN(a[0], b[0], t);
      o[1] = lerpN(a[1], b[1], t);
      o[2] = lerpN(a[2], b[2], t);
      this.outCss[k] = css(o);
    }
  }

  css(s: number): Readonly<Record<K, string>> {
    this.update(s);
    return this.outCss;
  }

  rgb(s: number): Readonly<Record<K, RGB>> {
    this.update(s);
    return this.outRgb;
  }
}

/** Deterministische Pseudozufallszahl 0..1 (Ganzzahl-/Fließkomma-Seed). */
export function h1(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

export function h2(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 269.5 + 17.3) * 43758.5453123;
  return s - Math.floor(s);
}

/** Kleiner, schneller deterministischer Zufallsgenerator (Mulberry32) für Offscreen-Zeichnungen. */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}
