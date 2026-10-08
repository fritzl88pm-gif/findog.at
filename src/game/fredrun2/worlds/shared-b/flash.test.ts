import { describe, expect, it } from "vitest";
import { REDUCED_FLASH_MAX, flashFactor } from "./flash";

type V = Parameters<typeof flashFactor>[0];
const view = (reducedMotion: boolean, flashScale?: number): V => ({ reducedMotion, flashScale });

describe("flashFactor", () => {
  it("ohne „Weniger Bewegung“: flashScale, fehlt es 1 (Standard unverändert)", () => {
    expect(flashFactor(view(false))).toBe(1);
    expect(flashFactor(view(false, 1))).toBe(1);
    expect(flashFactor(view(false, 0.6))).toBe(0.6);
    expect(flashFactor(view(false, 0))).toBe(0);
  });

  it("„Weniger Bewegung“ ohne flashScale: das bisherige Dämpfen der Welt (Vorgabe, höchstens 0,3)", () => {
    expect(flashFactor(view(true))).toBe(0.25);
    expect(flashFactor(view(true), 0)).toBe(0);
    expect(flashFactor(view(true), 1)).toBe(REDUCED_FLASH_MAX);
  });

  it("„Weniger Bewegung“ mit flashScale 1 (Aufrufer kappt nicht): 0,3 statt ungedämpft", () => {
    expect(flashFactor(view(true, 1))).toBe(REDUCED_FLASH_MAX);
    expect(flashFactor(view(true, 1), 0)).toBe(REDUCED_FLASH_MAX);
    expect(flashFactor(view(true, 0.5))).toBe(REDUCED_FLASH_MAX);
  });

  it("„Weniger Bewegung“ mit gekapptem Regler: der Wert ersetzt das Dämpfen (keine Doppel-Skalierung, keine Anhebung)", () => {
    expect(flashFactor(view(true, 0.3))).toBe(0.3);
    expect(flashFactor(view(true, 0.1), 0.25)).toBe(0.1);
    expect(flashFactor(view(true, 0), 0.25)).toBe(0);
  });

  it("ungültige Werte ergeben keinen Blitz bzw. werden auf 1 begrenzt", () => {
    expect(flashFactor(view(false, Number.NaN))).toBe(0);
    expect(flashFactor(view(true, Number.NaN))).toBe(0);
    expect(flashFactor(view(false, -0.5))).toBe(0);
    expect(flashFactor(view(false, 7))).toBe(1);
  });
});
