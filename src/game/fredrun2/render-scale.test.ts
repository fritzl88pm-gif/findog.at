import { describe, expect, it } from "vitest";
import { effectiveDpr, MAX_RENDER_PIXELS, pickRenderScale } from "./render-scale";
import type { QualityLevel } from "./quality-governor";

/** Bitmap-Pixel einer Zeichenfläche mit CSS-Größe cssW × cssH bei Skala s (Breite = 1280·s, Höhe über die CSS-Proportion). */
function pixels(cssW: number, cssH: number, s: number): number {
  const e = effectiveDpr(cssW, s);
  return Math.round(cssW * e) * Math.round(cssH * e);
}

describe("pickRenderScale", () => {
  it("Q0 ist immer exakt 1", () => {
    for (const [w, h, d] of [
      [844, 390, 2],
      [1920, 1080, 1],
      [5120, 2880, 2],
      [390, 844, 3],
      [320, 180, 0.5],
    ] as const) {
      expect(pickRenderScale(w, h, d, 0)).toBe(1);
    }
  });

  it("Handy quer 844x390@2: Q2 bis 2, Q1 1,25, Q0 1", () => {
    const q2 = pickRenderScale(844, 390, 2, 2);
    expect(q2).toBeLessThanOrEqual(2);
    expect(q2).toBeCloseTo((844 * 2) / 1280, 10); // volle Gerätepixel
    expect(pickRenderScale(844, 390, 2, 1)).toBe(1.25);
    expect(pickRenderScale(844, 390, 2, 0)).toBe(1);
  });

  it("1920x1080@1: Q2 1,5, Q1 1,25", () => {
    expect(pickRenderScale(1920, 1080, 1, 2)).toBe(1.5);
    expect(pickRenderScale(1920, 1080, 1, 1)).toBe(1.25);
  });

  it("4K/5K-Vollbild bleibt unter 3,7 MP", () => {
    for (const [w, h, d] of [
      [5120, 2880, 2],
      [3840, 2160, 1],
      [2560, 1440, 2],
    ] as const) {
      const s = pickRenderScale(w, h, d, 2);
      expect(s).toBeLessThanOrEqual(2);
      expect(pixels(w, h, s)).toBeLessThanOrEqual(3_700_000);
    }
    expect(pickRenderScale(5120, 2880, 2, 2)).toBe(2);
  });

  it("eigenes Pixelbudget wird eingehalten, aber nie unter 1", () => {
    const s = pickRenderScale(1920, 1080, 2, 2, { maxPixels: 2_000_000 });
    expect(s).toBeLessThan(2);
    expect(s).toBeGreaterThanOrEqual(1);
    expect(pixels(1920, 1080, s)).toBeLessThanOrEqual(2_000_000 + 2000);
    expect(pickRenderScale(1920, 1080, 2, 2, { maxPixels: 100 })).toBe(1);
  });

  it("nie < 1 (kleine Flächen, Hochkant-Handy)", () => {
    for (const q of [0, 1, 2] as QualityLevel[]) {
      expect(pickRenderScale(390, 844, 3, q)).toBeGreaterThanOrEqual(1);
      expect(pickRenderScale(390, 219, 3, q)).toBeGreaterThanOrEqual(1);
      expect(pickRenderScale(640, 360, 1, q)).toBe(1);
      expect(pickRenderScale(200, 112, 1, q)).toBe(1);
    }
  });

  it("Skalen nahe 1 rasten auf 1", () => {
    expect(pickRenderScale(1366, 768, 1, 2)).toBe(1); // 1,067
    expect(pickRenderScale(1408, 792, 1, 2)).toBe(1); // 1,1
    expect(pickRenderScale(1408, 792, 1, 1)).toBe(1);
    expect(pickRenderScale(1440, 810, 1, 2)).toBeCloseTo(1.125, 10); // 0,125 Abstand: bleibt
  });

  it("Q1 rastet auf 1/8-Schritte", () => {
    for (let w = 1100; w <= 2600; w += 37) {
      const s = pickRenderScale(w, (w * 9) / 16, 1, 1);
      expect(s * 8).toBeCloseTo(Math.round(s * 8), 10);
      expect(s).toBeLessThanOrEqual(1.25);
    }
    expect(pickRenderScale(1500, 844, 1, 1)).toBe(1.125); // roh 1,17 → 1,125
  });

  it("Q1 ist nie höher als Q2, Q0 nie höher als Q1", () => {
    for (const [w, h, d] of [
      [844, 390, 2],
      [1280, 720, 1],
      [1920, 1080, 1],
      [2560, 1440, 2],
      [412, 915, 2.625],
    ] as const) {
      const [a, b, c] = [0, 1, 2].map((q) => pickRenderScale(w, h, d, q as QualityLevel));
      expect(a).toBeLessThanOrEqual(b);
      expect(b).toBeLessThanOrEqual(c);
    }
  });

  it("robust gegen Unsinn (0, NaN, Infinity)", () => {
    expect(pickRenderScale(0, 0, 2, 2)).toBe(1);
    expect(pickRenderScale(NaN, 100, 2, 2)).toBe(1);
    expect(pickRenderScale(800, 450, 0, 2)).toBe(1);
    expect(pickRenderScale(800, 450, Infinity, 2)).toBe(1);
    expect(pickRenderScale(1920, 0, 1, 2)).toBe(1.5); // ohne Höhe kein Pixelbudget-Abgleich
  });

  it("MAX_RENDER_PIXELS ist 3,7 MP", () => {
    expect(MAX_RENDER_PIXELS).toBe(3_700_000);
  });
});

describe("effectiveDpr", () => {
  it("effectiveDpr(cssW, s)·cssW = s·1280", () => {
    for (const cssW of [320, 390, 640, 844, 1280, 1366, 1920, 2560, 5120]) {
      for (const s of [1, 1.125, 1.25, 1.5, 2, 1.3199]) {
        expect(effectiveDpr(cssW, s) * cssW).toBeCloseTo(s * 1280, 9);
      }
    }
  });

  it("Q0 auf 844 px breiter Fläche: dpr < 1 (CSS skaliert hoch)", () => {
    expect(effectiveDpr(844, 1)).toBeCloseTo(1280 / 844, 10);
  });

  it("robust bei cssW <= 0", () => {
    expect(effectiveDpr(0, 1.5)).toBe(1);
    expect(effectiveDpr(-5, 1.5)).toBe(1);
    expect(effectiveDpr(NaN, 1.5)).toBe(1);
  });
});
