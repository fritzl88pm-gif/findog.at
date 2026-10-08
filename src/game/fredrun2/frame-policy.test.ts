import { describe, expect, it } from "vitest";
import { COVERED_INTERVAL_MS, GAMEOVER_INTERVAL_MS, drawIntervalMs, isFullRate, shouldDraw, type DrawPhase } from "./frame-policy";

const PHASES: DrawPhase[] = ["loading", "menu", "countdown", "running", "paused", "gameover"];

/** Zählt, wie viele von `seconds` Sekunden rAF-Frames bei `hz` gezeichnet werden (Entscheidung wie in game.ts: lastDraw = Zeit des letzten Zeichnens). */
function drawsPerSecond(phase: DrawPhase, menuCovered: boolean, victory: boolean, hz: number, seconds = 10, dirtyFirst = true): number {
  const step = 1000 / hz;
  let last = Number.NEGATIVE_INFINITY;
  let drawn = 0;
  let dirty = dirtyFirst;
  for (let t = 0; t < seconds * 1000; t += step) {
    if (shouldDraw(phase, dirty, menuCovered, victory, t - last)) {
      drawn += 1;
      last = t;
      dirty = false;
    }
  }
  return drawn / seconds;
}

describe("shouldDraw – Entscheidungstabelle", () => {
  it("Countdown, Lauf, Laden und sichtbares Menü zeichnen immer", () => {
    for (const phase of ["loading", "countdown", "running"] as DrawPhase[]) {
      for (const dirty of [false, true]) {
        for (const since of [0, 5, 16.7, 1e6]) expect(shouldDraw(phase, dirty, false, false, since)).toBe(true);
      }
    }
    expect(shouldDraw("menu", false, false, false, 0)).toBe(true);
    expect(shouldDraw("menu", false, false, false, 16.7)).toBe(true);
  });

  it("Countdown und Lauf ignorieren menuCovered (nur das Menü wird verdeckt)", () => {
    for (const phase of ["countdown", "running"] as DrawPhase[]) expect(shouldDraw(phase, false, true, false, 0)).toBe(true);
  });

  it("Pause zeichnet nur bei dirty", () => {
    expect(shouldDraw("paused", false, false, false, 16.7)).toBe(false);
    expect(shouldDraw("paused", false, false, false, 60_000)).toBe(false);
    expect(shouldDraw("paused", true, false, false, 0)).toBe(true);
    expect(shouldDraw("paused", false, true, false, 1e9)).toBe(false); // menuCovered ändert an der Pause nichts
  });

  it("Pause: noch nie gezeichnet (Infinity) zeichnet erst mit dirty – die Phase meldet sich über dirty an", () => {
    expect(shouldDraw("paused", true, false, false, Number.POSITIVE_INFINITY)).toBe(true);
    expect(shouldDraw("paused", false, false, false, Number.NaN)).toBe(false);
  });

  it("Game-Over-Karte: 30 fps, Sieger-Tanz voll, dirty zeichnet sofort", () => {
    expect(shouldDraw("gameover", false, false, false, 16.7)).toBe(false);
    expect(shouldDraw("gameover", false, false, false, 1000 / 30)).toBe(true);
    expect(shouldDraw("gameover", false, false, false, GAMEOVER_INTERVAL_MS)).toBe(true);
    expect(shouldDraw("gameover", false, false, false, GAMEOVER_INTERVAL_MS - 0.1)).toBe(false);
    expect(shouldDraw("gameover", false, false, true, 0)).toBe(true);
    expect(shouldDraw("gameover", true, false, false, 0)).toBe(true);
  });

  it("verdecktes Menü: ca. 8 fps, dirty (Verlassen, Resize) zeichnet sofort", () => {
    expect(shouldDraw("menu", false, true, false, 16.7)).toBe(false);
    expect(shouldDraw("menu", false, true, false, 100)).toBe(false);
    expect(shouldDraw("menu", false, true, false, COVERED_INTERVAL_MS)).toBe(true);
    expect(shouldDraw("menu", false, true, false, 500)).toBe(true);
    expect(shouldDraw("menu", true, true, false, 0)).toBe(true);
    // Menü ohne Verdeckung bleibt voll – auch wenn gerade erst gezeichnet wurde
    expect(shouldDraw("menu", false, false, false, 0)).toBe(true);
  });

  it("verdecktes Menü: ein kaputter Zeitwert friert das Bild nicht ein", () => {
    expect(shouldDraw("menu", false, true, false, Number.NaN)).toBe(true);
    expect(shouldDraw("gameover", false, false, false, Number.NaN)).toBe(true);
  });

  it("victory wirkt nur in der Game-Over-Phase", () => {
    for (const phase of PHASES) {
      if (phase === "gameover") continue;
      expect(drawIntervalMs(phase, false, true)).toBe(drawIntervalMs(phase, false, false));
    }
    expect(drawIntervalMs("gameover", false, true)).toBe(0);
    expect(drawIntervalMs("gameover", false, false)).toBe(GAMEOVER_INTERVAL_MS);
  });
});

describe("drawIntervalMs / isFullRate", () => {
  it("Tabelle der Mindestabstände", () => {
    expect(drawIntervalMs("running", false, false)).toBe(0);
    expect(drawIntervalMs("countdown", true, false)).toBe(0);
    expect(drawIntervalMs("loading", false, false)).toBe(0);
    expect(drawIntervalMs("menu", false, false)).toBe(0);
    expect(drawIntervalMs("menu", true, false)).toBe(COVERED_INTERVAL_MS);
    expect(drawIntervalMs("paused", false, false)).toBe(Number.POSITIVE_INFINITY);
    expect(drawIntervalMs("gameover", false, false)).toBe(GAMEOVER_INTERVAL_MS);
    expect(drawIntervalMs("gameover", false, true)).toBe(0);
  });

  it("isFullRate nur ohne Drosselung", () => {
    expect(isFullRate("running", false, false)).toBe(true);
    expect(isFullRate("menu", false, false)).toBe(true);
    expect(isFullRate("menu", true, false)).toBe(false);
    expect(isFullRate("paused", false, false)).toBe(false);
    expect(isFullRate("gameover", false, false)).toBe(false);
    expect(isFullRate("gameover", false, true)).toBe(true);
  });
});

describe("Zeichenrate je Anzeige-Frequenz (Simulation der Schleife)", () => {
  it("Game-Over-Karte liefert auf 30/60/90/120/144 Hz zwischen 20 und 36 fps (30 Hz: alles, es gibt nicht mehr)", () => {
    expect(drawsPerSecond("gameover", false, false, 30)).toBeCloseTo(30, 0);
    for (const hz of [60, 90, 120, 144]) {
      const fps = drawsPerSecond("gameover", false, false, hz);
      expect(fps).toBeGreaterThanOrEqual(20);
      expect(fps).toBeLessThanOrEqual(36);
    }
  });

  it("Game-Over-Sieger-Tanz zeichnet jeden Frame", () => {
    for (const hz of [30, 60, 120]) expect(drawsPerSecond("gameover", false, true, hz)).toBeCloseTo(hz, 0);
  });

  it("verdecktes Menü: höchstens 10 Zeichnungen pro Sekunde auf 30/60/90/120/144 Hz, mindestens 6", () => {
    for (const hz of [30, 60, 90, 120, 144]) {
      const fps = drawsPerSecond("menu", true, false, hz);
      expect(fps).toBeLessThanOrEqual(10);
      expect(fps).toBeGreaterThanOrEqual(6);
    }
  });

  it("Pause: nach dem ersten (dirty) Frame wird nichts mehr gezeichnet", () => {
    for (const hz of [30, 60, 120]) expect(drawsPerSecond("paused", false, false, hz, 10)).toBeCloseTo(0.1, 5); // genau 1 Zeichnung in 10 s
  });

  it("sichtbares Menü und Lauf: volle Rate", () => {
    expect(drawsPerSecond("menu", false, false, 60)).toBeCloseTo(60, 0);
    expect(drawsPerSecond("running", false, false, 144)).toBeCloseTo(144, 0);
  });

  it("jitternde rAF-Zeitstempel (±0,7 ms) halten die Game-Over-Rate bei 60 Hz stabil bei ca. 30 fps", () => {
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    let t = 0;
    let last = Number.NEGATIVE_INFINITY;
    let drawn = 0;
    for (let i = 0; i < 6000; i += 1) {
      t += 16.667 + (rnd() - 0.5) * 1.4;
      if (shouldDraw("gameover", false, false, false, t - last)) {
        drawn += 1;
        last = t;
      }
    }
    const fps = drawn / (t / 1000);
    expect(fps).toBeGreaterThan(28);
    expect(fps).toBeLessThan(32);
  });
});
