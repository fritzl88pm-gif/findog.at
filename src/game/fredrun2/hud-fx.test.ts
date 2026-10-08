import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_HEARTS, VIEW_H, VIEW_W } from "./constants";
import {
  BLINK_BELOW,
  BLINK_MIN,
  BUMP_GAIN,
  BUMP_TIME,
  DASH_DENIED_TIME,
  HEART_GAIN_TIME,
  HEART_LOSS_TIME,
  HudFx,
  SCORE_SNAP,
  TOUCH_DASH,
  TOUCH_SLIDE,
  UI_SCALE_MAX,
  blinkAlpha,
  bumpScale,
  bumpValue,
  dashDeniedFlash,
  dashWobble,
  domButtonCenter,
  drawHud,
  easeOutBack,
  easeScore,
  hintMaxWidth,
  powerupStartX,
  powerupWarning,
  resolveButtonCenter,
  uiScaleFor,
  warmHudSprites,
  type ButtonCenter,
  type HudState,
} from "./hud";
import { HUD_PANELS, HudSpriteCache, hudSprites, quantizeBakeScale, type HudSpriteKind, type SpriteCanvas } from "./pickups";
import { formatNumber } from "./ui-logic";

// --- Hilfen ---------------------------------------------------------------------------------------------------------

function baseState(over: Partial<HudState> = {}): HudState {
  return {
    score: 1234,
    meters: 321,
    hearts: 3,
    coins: 12,
    combo: 1,
    comboFrac: 0.5,
    energy: 10,
    dashCost: 34,
    powerups: [],
    toast: null,
    worldName: "Wien",
    accent: "#5b7cfa",
    best: 0,
    hint: null,
    tourFrac: null,
    time: 1.5,
    chaseWarn: 0,
    touch: false,
    ...over,
  };
}

interface FakeCall {
  name: string;
  args: unknown[];
}

/** Aufzeichnender 2D-Kontext (ohne Pixel): zählt Aufrufe, merkt sich gesetzte Eigenschaften und den fillStyle beim Textzeichnen. */
function fakeCtx(canvasWidth = 1280): { g: CanvasRenderingContext2D; calls: FakeCall[]; sets: Array<[string, unknown]>; texts: Array<{ s: string; fill: unknown }> } {
  const calls: FakeCall[] = [];
  const sets: Array<[string, unknown]> = [];
  const texts: Array<{ s: string; fill: unknown }> = [];
  const state: Record<string, unknown> = { font: "700 20px sans-serif", fillStyle: "#000", globalAlpha: 1, canvas: { width: canvasWidth, height: (canvasWidth * 9) / 16 } };
  const proxy: unknown = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        calls.push({ name: prop, args });
        if (prop === "measureText") {
          const size = Number(/(\d+(?:\.\d+)?)px/.exec(String(target.font))?.[1] ?? 20);
          return { width: String(args[0]).length * size * 0.55 };
        }
        if (prop === "fillText") texts.push({ s: String(args[0]), fill: target.fillStyle });
        if (prop === "createLinearGradient" || prop === "createRadialGradient") return { addColorStop: () => undefined };
        return undefined;
      };
    },
    set(target, prop: string, value: unknown) {
      target[prop] = value;
      sets.push([prop, value]);
      return true;
    },
  });
  return { g: proxy as CanvasRenderingContext2D, calls, sets, texts };
}

/** Canvas-Fabrik für den Sprite-Cache: zeichnet in einen aufzeichnenden Kontext, zählt die erzeugten Flächen */
function fakeFactory(): { make: () => SpriteCanvas; created: SpriteCanvas[] } {
  const created: SpriteCanvas[] = [];
  const make = (): SpriteCanvas => {
    const ctx = fakeCtx();
    const c: SpriteCanvas = { width: 0, height: 0, getContext: () => ctx.g };
    created.push(c);
    return c;
  };
  return { make, created };
}

function arcs(calls: FakeCall[]): Array<{ x: number; y: number; r: number }> {
  return calls.filter((c) => c.name === "arc").map((c) => ({ x: Number(c.args[0]), y: Number(c.args[1]), r: Number(c.args[2]) }));
}

// --- Zeitfunktionen -------------------------------------------------------------------------------------------------

describe("easeScore", () => {
  it("folgt der Formel disp += (score - disp) * (1 - exp(-dt * 14))", () => {
    const dt = 1 / 60;
    expect(easeScore(0, 100, dt)).toBeCloseTo(100 * (1 - Math.exp(-dt * 14)), 10);
    expect(easeScore(400, 1000, 0.05)).toBeCloseTo(400 + 600 * (1 - Math.exp(-0.05 * 14)), 10);
  });

  it("konvergiert monoton ohne Überschwingen und rastet exakt auf den Zielwert ein", () => {
    let disp = 0;
    let prev = 0;
    const target = 2500;
    let frames = 0;
    while (disp !== target && frames < 600) {
      disp = easeScore(disp, target, 1 / 60);
      expect(disp).toBeGreaterThanOrEqual(prev);
      expect(disp).toBeLessThanOrEqual(target);
      prev = disp;
      frames += 1;
    }
    expect(disp).toBe(target);
    // etwa 0,5 s bis zum Einrasten (Abstand < 1,5 bei Rate 14)
    expect(frames).toBeLessThan(60);
  });

  it("überschwingt auch bei riesigem dt nicht (Faktor < 1)", () => {
    expect(easeScore(0, 100, 100)).toBeLessThanOrEqual(100);
    expect(easeScore(0, 100, 100)).toBeGreaterThan(99.99);
  });

  it("rastet unter 1,5 Abstand ein und folgt einem kleineren Zielwert (neuer Lauf) sofort", () => {
    expect(easeScore(99, 100, 1 / 60)).toBe(100);
    expect(easeScore(100 - SCORE_SNAP + 0.01, 100, 1 / 60)).toBe(100);
    expect(easeScore(5000, 0, 1 / 60)).toBe(0);
  });

  it("dt = 0 (Pause) ändert nichts; ungültige Werte werfen nicht", () => {
    expect(easeScore(10, 500, 0)).toBe(10);
    expect(easeScore(10, 500, Number.NaN)).toBe(10);
    expect(easeScore(Number.NaN, 500, 0.016)).toBe(500);
    expect(easeScore(10, Number.NaN, 0.016)).toBe(0);
  });
});

describe("Bump-Kurve", () => {
  it("startet bei 1 und endet nach 0,22 s bei 0", () => {
    expect(BUMP_TIME).toBe(0.22);
    expect(bumpValue(5, 5)).toBe(1);
    expect(bumpValue(5.11, 5)).toBeCloseTo(0.5, 10);
    expect(bumpValue(5 + BUMP_TIME, 5)).toBeCloseTo(0, 10);
    expect(bumpValue(5.5, 5)).toBe(0);
  });

  it("ist ohne Ereignis (oder vor dem Ereignis) 0", () => {
    expect(bumpValue(1, Number.NEGATIVE_INFINITY)).toBe(0);
    expect(bumpValue(1, 2)).toBe(0);
  });

  it("skaliert 1 + 0,22 * Bump, bei reduced immer 1", () => {
    expect(bumpScale(1, false)).toBeCloseTo(1 + BUMP_GAIN, 10);
    expect(bumpScale(0, false)).toBe(1);
    expect(bumpScale(0.5, false)).toBeCloseTo(1.11, 10);
    for (const b of [0, 0.3, 1]) expect(bumpScale(b, true)).toBe(1);
    expect(bumpScale(7, false)).toBeCloseTo(1 + BUMP_GAIN, 10);
  });
});

describe("Power-up-Blinken", () => {
  it("blinkt nur bei Restzeit < 2 s", () => {
    expect(BLINK_BELOW).toBe(2);
    expect(powerupWarning(1.99)).toBe(true);
    expect(powerupWarning(2)).toBe(false);
    expect(powerupWarning(10)).toBe(false);
    expect(powerupWarning(undefined)).toBe(false);
    for (let t = 0; t < 1; t += 0.013) {
      expect(blinkAlpha(2, t, false)).toBe(1);
      expect(blinkAlpha(8, t, false)).toBe(1);
      expect(blinkAlpha(undefined, t, false)).toBe(1);
    }
  });

  it("pendelt mit 5 Hz zwischen 0,45 und 1", () => {
    let lo = 1;
    let hi = 0;
    for (let t = 0; t < 1; t += 0.002) {
      const a = blinkAlpha(1.5, t, false);
      lo = Math.min(lo, a);
      hi = Math.max(hi, a);
      expect(a).toBeGreaterThanOrEqual(BLINK_MIN - 1e-9);
      expect(a).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(lo).toBeCloseTo(BLINK_MIN, 2);
    expect(hi).toBeCloseTo(1, 2);
    // halbe Periode bei 5 Hz = 0,1 s: von hell zu dunkel
    expect(blinkAlpha(1, 0, false)).toBeCloseTo(1, 10);
    expect(blinkAlpha(1, 0.1, false)).toBeCloseTo(BLINK_MIN, 10);
    expect(blinkAlpha(1, 0.2, false)).toBeCloseTo(1, 10);
  });

  it("bei reduced bleibt der Ring ruhig (Alpha 1), die Warnung selbst bleibt", () => {
    for (let t = 0; t < 1; t += 0.05) expect(blinkAlpha(1, t, true)).toBe(1);
    expect(powerupWarning(1)).toBe(true);
  });
});

describe("abgelehnter Dash: Wackeln und Blitz", () => {
  it("wackelt nur bei 0 <= dashDeniedT < 0,25 s", () => {
    expect(DASH_DENIED_TIME).toBe(0.25);
    let moved = 0;
    for (let t = 0.01; t < 0.25; t += 0.01) if (dashWobble(t, false) !== 0) moved += 1;
    expect(moved).toBeGreaterThan(15);
    expect(dashWobble(0.25, false)).toBe(0);
    expect(dashWobble(0.3, false)).toBe(0);
    expect(dashWobble(99, false)).toBe(0);
    expect(dashWobble(-1, false)).toBe(0);
    expect(dashWobble(Number.NaN, false)).toBe(0);
    expect(dashWobble(undefined, false)).toBe(0);
  });

  it("wackelt nie bei reduced", () => {
    for (let t = 0; t < 0.5; t += 0.005) expect(dashWobble(t, true)).toBe(0);
  });

  it("der Wackel-Versatz klingt ab und bleibt in der Auslenkung", () => {
    let maxEarly = 0;
    let maxLate = 0;
    for (let t = 0; t < 0.08; t += 0.002) maxEarly = Math.max(maxEarly, Math.abs(dashWobble(t, false)));
    for (let t = 0.17; t < 0.25; t += 0.002) maxLate = Math.max(maxLate, Math.abs(dashWobble(t, false)));
    expect(maxEarly).toBeGreaterThan(maxLate);
    expect(maxEarly).toBeLessThanOrEqual(6);
  });

  it("rotes Blinken: 1 am Anfang, 0 nach 0,25 s und ohne Feld; auch bei reduced gilt die Farbe (nur Wackeln entfällt)", () => {
    expect(dashDeniedFlash(0)).toBe(1);
    expect(dashDeniedFlash(0.125)).toBeGreaterThan(0.5);
    expect(dashDeniedFlash(0.2499)).toBeLessThan(0.05);
    expect(dashDeniedFlash(0.25)).toBe(0);
    expect(dashDeniedFlash(99)).toBe(0);
    expect(dashDeniedFlash(undefined)).toBe(0);
    expect(dashDeniedFlash(-0.1)).toBe(0);
  });
});

describe("Skalen", () => {
  it("uiScale = clamp(0,72 / cssScale, 1, 1,35); bei fehlendem Wert 1", () => {
    expect(uiScaleFor(undefined)).toBe(1);
    expect(uiScaleFor(Number.NaN)).toBe(1);
    expect(uiScaleFor(0)).toBe(1);
    expect(uiScaleFor(1)).toBe(1);
    expect(uiScaleFor(0.72)).toBe(1);
    expect(uiScaleFor(0.9)).toBe(1);
    expect(uiScaleFor(0.6)).toBeCloseTo(1.2, 10);
    expect(uiScaleFor(0.5422)).toBeCloseTo(0.72 / 0.5422, 10);
    expect(uiScaleFor(0.3)).toBe(UI_SCALE_MAX);
  });

  it("kleinste Schrift (18 px) bleibt auf den Ziel-Bühnen >= 11 px effektiv", () => {
    for (const css of [667 / 1280, 694 / 1280, 0.6, 0.72]) expect(18 * css * uiScaleFor(css)).toBeGreaterThanOrEqual(11);
  });

  it("TOUCH_DASH ist die Mitte des 130-px-Knopfs (right 26, bottom 24)", () => {
    expect(TOUCH_DASH.r).toBe(65);
    expect(TOUCH_DASH.cx).toBe(1280 - 26 - 65);
    expect(TOUCH_DASH.cy).toBe(720 - 24 - 65);
  });

  it("easeOutBack: 0 -> 1 mit kleinem Überschwinger", () => {
    expect(easeOutBack(0)).toBeCloseTo(0, 10);
    expect(easeOutBack(1)).toBeCloseTo(1, 10);
    let max = 0;
    for (let u = 0; u <= 1; u += 0.01) max = Math.max(max, easeOutBack(u));
    expect(max).toBeGreaterThan(1.05);
    expect(max).toBeLessThan(1.15);
  });

  it("Hinweis-Pille: Breitenlimit je Gerät und Skala", () => {
    // Tastatur ohne Ringe: Deckel 880; mit zwei Power-ups schmaler (Ringe unten links)
    expect(hintMaxWidth(false, 1, 1, 0)).toBe(880);
    expect(hintMaxWidth(false, 1, 1, 2)).toBeLessThan(hintMaxWidth(false, 1, 1, 1));
    expect(hintMaxWidth(false, 1, 1, 2)).toBe(704);
    // Touch (oben): begrenzt durch die Herz-Gruppe, wächst die Gruppe, wird die Pille schmaler
    expect(hintMaxWidth(true, 1, 1, 0)).toBe(624);
    expect(hintMaxWidth(true, 1.35, 1.2, 0)).toBeLessThan(hintMaxWidth(true, 1, 1, 0));
    for (const n of [0, 1, 4]) for (const touch of [false, true]) expect(hintMaxWidth(touch, 1.35, 1.2, n)).toBeGreaterThanOrEqual(200);
  });
});

// --- HudFx --------------------------------------------------------------------------------------------------------

describe("HudFx", () => {
  it("der erste Aufruf übernimmt die Werte ohne Effekt", () => {
    const fx = new HudFx();
    fx.update(baseState({ score: 5000, coins: 40, hearts: 2, combo: 5 }), 0.016);
    expect(fx.displayScore).toBe(5000);
    expect(fx.coinBump).toBe(0);
    expect(fx.comboBump).toBe(0);
    expect(fx.scoreBump).toBe(0);
    for (let i = 0; i < MAX_HEARTS; i += 1) {
      expect(fx.lossU(i)).toBe(-1);
      expect(fx.gainU(i)).toBe(-1);
    }
  });

  it("Münz-Zuwachs aus dem Wertwechsel: Bump startet bei 1, ist nach 0,22 s bei 0", () => {
    const fx = new HudFx();
    fx.update(baseState({ coins: 5 }), 0.016);
    fx.update(baseState({ coins: 5 }), 0.016);
    expect(fx.coinBump).toBe(0);
    fx.update(baseState({ coins: 6 }), 0.016);
    expect(fx.coinBump).toBe(1);
    fx.update(baseState({ coins: 6 }), 0.11);
    expect(fx.coinBump).toBeCloseTo(0.5, 10);
    fx.update(baseState({ coins: 6 }), 0.11);
    expect(fx.coinBump).toBeCloseTo(0, 10);
    fx.update(baseState({ coins: 6 }), 0.3);
    expect(fx.coinBump).toBe(0);
  });

  it("jeder weitere Münz-Zuwachs startet den Bump neu", () => {
    const fx = new HudFx();
    fx.update(baseState({ coins: 5 }), 0.016);
    fx.update(baseState({ coins: 6 }), 0.016);
    fx.update(baseState({ coins: 6 }), 0.15);
    expect(fx.coinBump).toBeLessThan(0.4);
    fx.update(baseState({ coins: 7 }), 0.016);
    expect(fx.coinBump).toBe(1);
  });

  it("Kombo-Anstieg ab x2 bumpt (auch beim Erscheinen), ein Abfall und Combo 1 nicht", () => {
    const fx = new HudFx();
    fx.update(baseState({ combo: 1 }), 0.016);
    fx.update(baseState({ combo: 1 }), 0.016);
    expect(fx.comboBump).toBe(0);
    fx.update(baseState({ combo: 2 }), 0.016);
    expect(fx.comboBump).toBe(1);
    fx.update(baseState({ combo: 2 }), 0.3);
    expect(fx.comboBump).toBe(0);
    fx.update(baseState({ combo: 3 }), 0.016);
    expect(fx.comboBump).toBe(1);
    fx.update(baseState({ combo: 1 }), 0.3);
    fx.update(baseState({ combo: 1 }), 0.016);
    expect(fx.comboBump).toBe(0);
  });

  it("Score: Strecken-Schritte (+1) bumpen nicht, Sprünge (Münze, Stampfer) schon, und die Anzeige gleitet hoch", () => {
    const fx = new HudFx();
    let s = 100;
    fx.update(baseState({ score: s }), 1 / 60);
    for (let i = 0; i < 30; i += 1) {
      s += 1;
      fx.update(baseState({ score: s }), 1 / 60);
      expect(fx.scoreBump).toBe(0);
      expect(fx.displayScore).toBe(s);
    }
    fx.update(baseState({ score: s + 60 }), 1 / 60);
    expect(fx.scoreBump).toBe(1);
    expect(fx.displayScore).toBeGreaterThan(s);
    expect(fx.displayScore).toBeLessThan(s + 60);
    for (let i = 0; i < 40; i += 1) fx.update(baseState({ score: s + 60 }), 1 / 60);
    expect(fx.displayScore).toBe(s + 60);
  });

  it("neuer Lauf (Score/Meter fallen) setzt ohne Pops und Bumps zurück", () => {
    const fx = new HudFx();
    fx.update(baseState({ score: 900, meters: 800, hearts: 1, coins: 30 }), 0.016);
    fx.update(baseState({ score: 0, meters: 0, hearts: 3, coins: 0 }), 0.016);
    expect(fx.displayScore).toBe(0);
    expect(fx.coinBump).toBe(0);
    for (let i = 0; i < MAX_HEARTS; i += 1) {
      expect(fx.gainU(i)).toBe(-1);
      expect(fx.lossU(i)).toBe(-1);
    }
    // reset() erzwingt es auch ohne fallende Werte
    fx.update(baseState({ score: 5, meters: 5, hearts: 3 }), 0.016);
    fx.reset();
    fx.update(baseState({ score: 400, meters: 300, hearts: 5, coins: 9 }), 0.016);
    expect(fx.displayScore).toBe(400);
    expect(fx.gainU(4)).toBe(-1);
  });

  it("Herzverlust: Pop läuft 0,5 s ab dem Verlust, nur am verlorenen Platz", () => {
    const fx = new HudFx();
    fx.update(baseState({ hearts: 3 }), 0.016);
    fx.update(baseState({ hearts: 2 }), 0.016);
    expect(fx.lossU(2)).toBe(0);
    expect(fx.lossU(1)).toBe(-1);
    expect(fx.lossU(3)).toBe(-1);
    fx.update(baseState({ hearts: 2 }), HEART_LOSS_TIME / 2);
    expect(fx.lossU(2)).toBeCloseTo(0.5, 10);
    fx.update(baseState({ hearts: 2 }), HEART_LOSS_TIME / 2 + 0.001);
    expect(fx.lossU(2)).toBe(-1);
  });

  it("zwei Herzen auf einmal verloren: beide Plätze poppen", () => {
    const fx = new HudFx();
    fx.update(baseState({ hearts: 4 }), 0.016);
    fx.update(baseState({ hearts: 2 }), 0.016);
    expect(fx.lossU(2)).toBe(0);
    expect(fx.lossU(3)).toBe(0);
    expect(fx.lossU(1)).toBe(-1);
  });

  it("Herzgewinn: Pop-In am neuen Platz", () => {
    const fx = new HudFx();
    fx.update(baseState({ hearts: 2 }), 0.016);
    fx.update(baseState({ hearts: 3 }), 0.016);
    expect(fx.gainU(2)).toBe(0);
    expect(fx.lossU(2)).toBe(-1);
    fx.update(baseState({ hearts: 3 }), HEART_GAIN_TIME * 0.5);
    expect(fx.gainU(2)).toBeCloseTo(0.5, 10);
    fx.update(baseState({ hearts: 3 }), HEART_GAIN_TIME);
    expect(fx.gainU(2)).toBe(-1);
  });

  it("reduced: keine Bumps und Pops (Skala 1), der Score gleitet aber weiter", () => {
    const fx = new HudFx();
    const r = { reduced: true };
    fx.update(baseState({ ...r, coins: 1, hearts: 3, combo: 1, score: 100 }), 0.016);
    fx.update(baseState({ ...r, coins: 2, hearts: 2, combo: 3, score: 400 }), 0.016);
    expect(fx.coinBump).toBe(0);
    expect(fx.comboBump).toBe(0);
    expect(fx.scoreBump).toBe(0);
    expect(fx.lossU(2)).toBe(-1);
    expect(bumpScale(fx.coinBump, true)).toBe(1);
    fx.update(baseState({ ...r, coins: 3, hearts: 3 }), 0.016);
    expect(fx.gainU(2)).toBe(-1);
    expect(fx.displayScore).toBeGreaterThan(100);
  });

  it("die Uhr läuft nur mit dt: in der Pause (dt = 0) stehen Bump und Pop still", () => {
    const fx = new HudFx();
    fx.update(baseState({ coins: 1 }), 0.016);
    fx.update(baseState({ coins: 2 }), 0.016);
    for (let i = 0; i < 100; i += 1) fx.update(baseState({ coins: 2 }), 0);
    expect(fx.coinBump).toBe(1);
    fx.update(baseState({ coins: 2 }), Number.NaN);
    expect(fx.coinBump).toBe(1);
  });

  it("Herzzahl außerhalb 0..5 wirft nicht", () => {
    const fx = new HudFx();
    fx.update(baseState({ hearts: 99 }), 0.016);
    fx.update(baseState({ hearts: -3 }), 0.016);
    fx.update(baseState({ hearts: Number.NaN }), 0.016);
    expect(fx.lossU(0)).toBeGreaterThanOrEqual(-1);
  });
});

// --- Sprite-Cache -----------------------------------------------------------------------------------------------------

describe("HudSpriteCache", () => {
  const KINDS: HudSpriteKind[] = ["heart", "heart-urgent", "heart-empty", "heart-bar", "coin", "pu-magnet", "pu-shield", "pu-slowmo", "pu-turbo", "panel-tl", "panel-tl-best", "panel-coin", "panel-combo"];

  it("liefert je Variante genau eine Canvas und backt nur einmal je Skala", () => {
    const f = fakeFactory();
    const cache = new HudSpriteCache(f.make);
    for (const k of KINDS) {
      const a = cache.get(k, 1);
      const b = cache.get(k, 1);
      expect(a).not.toBeNull();
      expect(b).toBe(a);
    }
    expect(f.created).toHaveLength(KINDS.length);
    expect(cache.canvases).toBe(KINDS.length);
    expect(cache.bakes).toBe(KINDS.length);
  });

  it("backt bei Skalenwechsel neu, nutzt aber dieselbe Canvas weiter (kein Müll pro Wechsel)", () => {
    const f = fakeFactory();
    const cache = new HudSpriteCache(f.make);
    const a = cache.get("heart", 1);
    const w1 = f.created[0].width;
    const b = cache.get("heart", 2);
    expect(b).not.toBe(a);
    expect(f.created).toHaveLength(1);
    expect(cache.bakes).toBe(2);
    // doppelte Skala -> doppelt so viele Pixel für dasselbe Logikrechteck
    expect(f.created[0].width).toBeGreaterThanOrEqual(w1 * 2 - 1);
    expect(b?.px).toBe(2);
    expect(a?.px).toBe(1);
    // Rückkehr zur alten Skala backt wieder (es wird nur eine Skala je Variante gehalten)
    cache.get("heart", 1);
    expect(f.created).toHaveLength(1);
  });

  it("rastet die Skala auf 1/8: kleine Abweichungen backen nicht neu", () => {
    const f = fakeFactory();
    const cache = new HudSpriteCache(f.make);
    cache.get("coin", 1.25);
    cache.get("coin", 1.26);
    cache.get("coin", 1.2);
    expect(cache.bakes).toBe(1);
    expect(quantizeBakeScale(1.26)).toBe(1.25);
    expect(quantizeBakeScale(0)).toBe(1);
    expect(quantizeBakeScale(Number.NaN)).toBe(1);
    expect(quantizeBakeScale(0.2)).toBe(0.5);
  });

  it("das Zielrechteck deckt die Bitmap 1:1 (Pixel je Logikeinheit = Skala)", () => {
    const f = fakeFactory();
    const cache = new HudSpriteCache(f.make);
    const s = cache.get("heart", 1.5);
    expect(s).not.toBeNull();
    if (!s) return;
    expect(s.w * 1.5).toBeCloseTo(f.created[0].width, 6);
    expect(s.h * 1.5).toBeCloseTo(f.created[0].height, 6);
    // Herz-Sprites sind um den Mittelpunkt zentriert
    expect(s.x).toBeCloseTo(-s.w / 2, 0);
  });

  it("ohne Canvas (Node) ein No-Op: null, kein Wurf, kein erneuter Versuch je Frame", () => {
    expect(new HudSpriteCache().get("heart", 1)).toBeNull();
    let tries = 0;
    const cache = new HudSpriteCache(() => {
      tries += 1;
      return null;
    });
    expect(cache.get("coin", 1)).toBeNull();
    expect(cache.get("coin", 1)).toBeNull();
    expect(tries).toBe(1);
    expect(cache.canvases).toBe(0);
  });

  it("getContext liefert null: ebenfalls null statt Wurf", () => {
    const cache = new HudSpriteCache(() => ({ width: 0, height: 0, getContext: () => null }));
    expect(cache.get("heart", 1)).toBeNull();
  });

  it("backt Herzen ohne ihren Schein doppelt zu zeichnen: shadowBlur nur im Bake, mit Bake-Skala", () => {
    const blur: number[] = [];
    const cache = new HudSpriteCache(() => {
      const ctx = fakeCtx();
      const g = new Proxy(ctx.g as unknown as Record<string, unknown>, {
        set(t, p: string, v: unknown) {
          if (p === "shadowBlur") blur.push(Number(v));
          return Reflect.set(t, p, v);
        },
      });
      return { width: 0, height: 0, getContext: () => g as unknown as CanvasRenderingContext2D };
    });
    cache.get("heart", 1);
    cache.get("heart-urgent", 2);
    const nonZero = blur.filter((b) => b > 0);
    expect(nonZero.length).toBeGreaterThanOrEqual(2);
    // gefülltes Herz bei Skala 1: 0,8 * r; dringendes bei Skala 2: 1,1 * r * 2
    expect(nonZero[0]).toBeCloseTo(0.8 * 19, 6);
    expect(nonZero[1]).toBeCloseTo(1.1 * 19 * 2, 6);
  });
});

// --- drawHud (aufzeichnender Kontext) --------------------------------------------------------------------------------

describe("drawHud", () => {
  beforeEach(() => {
    hudSprites.setFactory(fakeFactory().make);
  });
  afterEach(() => {
    hudSprites.setFactory(() => null);
  });

  const alphaSets = (sets: Array<[string, unknown]>): number[] => sets.filter(([k]) => k === "globalAlpha").map(([, v]) => Number(v));

  it("mit Sprites: kein shadowBlur und kein Gradient im Frame", () => {
    const { g, calls, sets } = fakeCtx();
    drawHud(g, baseState({ hearts: 1, powerups: [{ kind: "shield", frac: 0.5 }, { kind: "magnet", frac: 0.2, left: 1 }], combo: 3, best: 500, score: 480 }));
    expect(sets.filter(([k, v]) => k === "shadowBlur" && Number(v) > 0)).toHaveLength(0);
    expect(calls.filter((c) => c.name === "createLinearGradient")).toHaveLength(0);
    expect(calls.filter((c) => c.name === "createRadialGradient")).toHaveLength(0);
    // Herzen, Münze, Leiste, Power-up-Blasen und die drei festen Platten (Herz/Score, Münzen, Kombo) laufen über drawImage
    expect(calls.filter((c) => c.name === "drawImage").length).toBeGreaterThanOrEqual(5 + 1 + 1 + 2 + 3);
  });

  it("feste Platten als Sprites: je Platte ein drawImage statt Rundrechteck-Pfad (4 arcTo)", () => {
    const st = baseState({ combo: 3, best: 500, score: 200 });
    const withSprites = fakeCtx();
    drawHud(withSprites.g, st);
    hudSprites.setFactory(() => null);
    const vector = fakeCtx();
    drawHud(vector.g, st);
    const arcTos = (c: FakeCall[]): number => c.filter((x) => x.name === "arcTo").length;
    // Herz-Score-Platte, Münz-Platte, Kombo-Platte und die Füllung der Herz-Leiste (vektoriell mit Verlauf): 4 Pfade weniger
    expect(arcTos(vector.calls) - arcTos(withSprites.calls)).toBe(4 * 4);
    expect(withSprites.calls.filter((x) => x.name === "drawImage").length - vector.calls.filter((x) => x.name === "drawImage").length).toBeGreaterThanOrEqual(3);
  });

  it("Platten-Sprites decken Platte plus Rand (Ecke links oben, Rand ragt 2 Einheiten hinaus)", () => {
    const cache = new HudSpriteCache(fakeFactory().make);
    for (const kind of ["panel-tl", "panel-tl-best", "panel-coin", "panel-combo"] as const) {
      const sp = cache.get(kind, 1);
      expect(sp).not.toBeNull();
      if (!sp) continue;
      expect(sp.x).toBe(-2);
      expect(sp.y).toBe(-2);
      expect(sp.w).toBe(HUD_PANELS[kind].w + 4);
      expect(sp.h).toBe(HUD_PANELS[kind].h + 4);
    }
  });

  it("ohne Canvas fällt es auf Vektor-Zeichnung zurück und wirft nicht", () => {
    hudSprites.setFactory(() => null);
    const { g, calls } = fakeCtx();
    expect(() => drawHud(g, baseState({ powerups: [{ kind: "turbo", frac: 0.3 }] }))).not.toThrow();
    expect(calls.filter((c) => c.name === "drawImage")).toHaveLength(0);
  });

  it("warmHudSprites backt alle Varianten vorab; danach backt drawHud nichts mehr", () => {
    expect(warmHudSprites(1)).toBe(true);
    const bakes = hudSprites.bakes;
    expect(bakes).toBe(13);
    const { g } = fakeCtx();
    drawHud(g, baseState({ hearts: 1, powerups: [{ kind: "magnet", frac: 0.5 }, { kind: "shield", frac: 0.5 }, { kind: "slowmo", frac: 0.5 }, { kind: "turbo", frac: 0.5 }] }));
    expect(hudSprites.bakes).toBe(bakes);
    // ohne Canvas: false statt Wurf
    hudSprites.setFactory(() => null);
    expect(warmHudSprites(1)).toBe(false);
  });

  it("save und restore sind in jedem Zustand ausgeglichen", () => {
    const fx = new HudFx();
    const states: Array<Partial<HudState>> = [
      {},
      { touch: true, hint: "Tippen = springen · halten = höher · nochmal = Doppelsprung", toast: { title: "Wien im Sturm", sub: "Blitz", u: 0.4, color: "#5b7cfa" } },
      { best: 900, score: 1000, recordPassed: true, combo: 4, tourFrac: 0.4, chaseWarn: 0.5, hint: "Springen" },
      { reduced: true, dashDeniedT: 0.1, powerups: [{ kind: "slowmo", frac: 1 }, { kind: "turbo", frac: 0.1 }], energy: 80 },
    ];
    for (const css of [undefined, 1, 0.52, 0.3]) {
      for (const st of states) {
        const { g, calls } = fakeCtx();
        const h = baseState(st);
        fx.update(h, 0.016);
        drawHud(g, h, { fx, cssScale: css });
        const saves = calls.filter((c) => c.name === "save").length;
        const restores = calls.filter((c) => c.name === "restore").length;
        expect(saves).toBe(restores);
      }
    }
  });

  it("Tastatur: Energiering unten links, Power-ups ab x = 148", () => {
    const { g, calls } = fakeCtx();
    drawHud(g, baseState({ powerups: [{ kind: "shield", frac: 0.5 }] }));
    const a = arcs(calls);
    expect(a.some((c) => c.x === 74 && c.y === 652 && c.r === 36)).toBe(true);
    expect(a.some((c) => c.x === 148 + 26 && c.y === 660 && c.r === 24)).toBe(true);
    expect(a.some((c) => c.x === TOUCH_DASH.cx)).toBe(false);
  });

  it("Touch: Energiering konzentrisch um den Dash-Knopf (Radius r + 9), nichts unter dem Rutschen-Knopf", () => {
    const { g, calls } = fakeCtx();
    drawHud(g, baseState({ touch: true, powerups: [{ kind: "shield", frac: 0.5 }] }));
    const a = arcs(calls);
    expect(a.some((c) => c.x === TOUCH_DASH.cx && c.y === TOUCH_DASH.cy && c.r === TOUCH_DASH.r + 9)).toBe(true);
    // nichts mehr am alten Ort (226, 652) und kein Ring links neben dem Rutschen-Knopf
    expect(a.some((c) => c.x === 226 && c.y === 652)).toBe(false);
    expect(a.some((c) => c.x === 74 && c.y === 652)).toBe(false);
    // Power-ups beginnen wieder links: rechts vom Rutschen-Knopf (Mitte 91/629, r 65) ohne Überdeckung
    const pu = a.find((c) => c.y === 660 && c.r === 30);
    expect(pu).toBeDefined();
    if (pu) {
      expect(Math.hypot(pu.x - 91, pu.y - 629)).toBeGreaterThan(65 + 30);
      expect(pu.x).toBeLessThan(300);
    }
    // Ring samt Strichstärke bleibt im Bild
    expect(TOUCH_DASH.cx + TOUCH_DASH.r + 9 + 8).toBeLessThanOrEqual(VIEW_W);
    expect(TOUCH_DASH.cy + TOUCH_DASH.r + 9 + 8).toBeLessThanOrEqual(720);
  });

  it("abgelehnter Dash: Ring wackelt nur bei dashDeniedT < 0,25 und nie bei reduced; ohne Feld nie", () => {
    const centerX = (st: Partial<HudState>): number[] => {
      const { g, calls } = fakeCtx();
      drawHud(g, baseState({ touch: true, ...st }));
      return arcs(calls)
        .filter((c) => c.r === TOUCH_DASH.r + 9 && c.y === TOUCH_DASH.cy)
        .map((c) => c.x);
    };
    expect(centerX({}).every((x) => x === TOUCH_DASH.cx)).toBe(true);
    expect(centerX({ dashDeniedT: 0.3 }).every((x) => x === TOUCH_DASH.cx)).toBe(true);
    expect(centerX({ dashDeniedT: 99 }).every((x) => x === TOUCH_DASH.cx)).toBe(true);
    expect(centerX({ dashDeniedT: 0.05 }).some((x) => x !== TOUCH_DASH.cx)).toBe(true);
    expect(centerX({ dashDeniedT: 0.05, reduced: true }).every((x) => x === TOUCH_DASH.cx)).toBe(true);
  });

  it("abgelehnter Dash: roter Blitz auch bei reduced, sonst keiner", () => {
    const hasRed = (st: Partial<HudState>): boolean => {
      const { g, sets } = fakeCtx();
      drawHud(g, baseState(st));
      return sets.some(([k, v]) => k === "strokeStyle" && v === "#ff4d4d");
    };
    expect(hasRed({ dashDeniedT: 0.05 })).toBe(true);
    expect(hasRed({ dashDeniedT: 0.05, reduced: true })).toBe(true);
    expect(hasRed({ dashDeniedT: 0.25 })).toBe(false);
    expect(hasRed({})).toBe(false);
  });

  it("Power-ups: Icons als Sprites statt Buchstaben, Blinken nur unter 2 s", () => {
    const run = (left: number | undefined, reduced = false) => {
      const { g, sets, texts } = fakeCtx();
      drawHud(g, baseState({ reduced, powerups: [{ kind: "magnet", frac: 0.1, left }] }));
      return { alphas: alphaSets(sets), texts, sets };
    };
    const calm = run(8);
    expect(calm.alphas.every((a) => a === 1)).toBe(true);
    const warn = run(1.5);
    expect(warn.alphas.some((a) => a < 1 && a >= BLINK_MIN - 1e-9)).toBe(true);
    // ohne left: frac * Gesamtdauer (0,1 * 10 s = 1 s -> Warnung)
    expect(run(undefined).alphas.some((a) => a < 1)).toBe(true);
    // reduced: ruhig, dafür die weiße Kontur
    const still = run(1.5, true);
    expect(still.alphas.every((a) => a === 1)).toBe(true);
    for (const r of [calm, warn, still]) for (const glyph of ["U", "◈", "⧗", "ϟ"]) expect(r.texts.some((t) => t.s === glyph)).toBe(false);
    expect(warn.sets.some(([k, v]) => k === "strokeStyle" && v === "rgba(255,255,255,0.9)")).toBe(true);
    expect(calm.sets.some(([k, v]) => k === "strokeStyle" && v === "rgba(255,255,255,0.9)")).toBe(false);
  });

  it("Zahlen mit Punkt-Gruppierung über formatNumber, Score folgt dem HudFx", () => {
    const fx = new HudFx();
    const h0 = baseState({ score: 1000, meters: 1500, coins: 1234 });
    fx.update(h0, 0.016);
    const { g, texts } = fakeCtx();
    drawHud(g, h0, { fx });
    const strs = texts.map((t) => t.s);
    expect(strs).toContain(formatNumber(1000));
    expect(strs).toContain("1.500 m");
    expect(strs).toContain("1.234");
    // Score springt um 400: nach einem Frame ist die Anzeige noch dazwischen
    const h1 = baseState({ score: 1400, meters: 1500, coins: 1234 });
    fx.update(h1, 1 / 60);
    const r = fakeCtx();
    drawHud(r.g, h1, { fx });
    const shown = r.texts.map((t) => t.s).find((s) => /^\d/.test(s) && !s.endsWith("m") && s !== "1.234");
    expect(shown).toBeDefined();
    const n = Number(String(shown).replace(/\./g, ""));
    expect(n).toBeGreaterThan(1000);
    expect(n).toBeLessThan(1400);
  });

  it("HudFx ohne update (oder nach reset) zeigt den echten Score statt 0", () => {
    const fx = new HudFx();
    expect(fx.started).toBe(false);
    const h = baseState({ score: 2750 });
    const first = fakeCtx();
    drawHud(first.g, h, { fx });
    expect(first.texts.map((t) => t.s)).toContain(formatNumber(2750));
    fx.update(h, 0.016);
    expect(fx.started).toBe(true);
    fx.reset();
    expect(fx.started).toBe(false);
    const again = fakeCtx();
    drawHud(again.g, h, { fx });
    expect(again.texts.map((t) => t.s)).toContain(formatNumber(2750));
  });

  it("Rekordjagd: Text gold ab 90 %, nach Überholen zeigt er den eigenen Score, ohne Rekord keine Zeile", () => {
    const record = (st: Partial<HudState>): { s: string; fill: unknown } | undefined => {
      const { g, texts } = fakeCtx();
      drawHud(g, baseState(st));
      return texts.find((t) => t.s.startsWith("Rekord"));
    };
    expect(record({ best: 0, score: 100 })).toBeUndefined();
    const low = record({ best: 4210, score: 1000 });
    expect(low?.s).toBe("Rekord 4.210");
    expect(low?.fill).not.toBe("#ffd23f");
    const near = record({ best: 1000, score: 900 });
    expect(near?.s).toBe("Rekord 1.000");
    expect(near?.fill).toBe("#ffd23f");
    const under = record({ best: 1000, score: 899 });
    expect(under?.fill).not.toBe("#ffd23f");
    const passed = record({ best: 1000, score: 1337, recordPassed: true });
    expect(passed?.s).toBe("Rekord 1.337");
    expect(passed?.fill).toBe("#ffd23f");
    // ohne Flag gilt score > best ebenfalls als überholt
    expect(record({ best: 1000, score: 1100 })?.s).toBe("Rekord 1.100");
  });

  it("Rekordbalken: nur mit Rekord (Spur und Füllung als zusätzliche Rundrechtecke unter dem Score)", () => {
    const roundRects = (st: Partial<HudState>): number => {
      const { g, calls } = fakeCtx();
      drawHud(g, baseState(st));
      return calls.filter((c) => c.name === "arcTo").length / 4;
    };
    expect(roundRects({ best: 800, score: 400 }) - roundRects({ best: 0 })).toBe(2);
  });

  it("Hinweis: höchstens zwei Zeilen, jede Zeile innerhalb der Pillenbreite (Touch/Tastatur, kleine Bühne)", () => {
    const hint = "Tippen = springen · halten = höher · nochmal = Doppelsprung";
    for (const touch of [false, true]) {
      for (const css of [undefined, 0.52]) {
        const { g, texts } = fakeCtx();
        drawHud(g, baseState({ touch, hint, powerups: touch ? [] : [{ kind: "shield", frac: 0.5 }, { kind: "magnet", frac: 0.5 }] }), { cssScale: css });
        const lines = texts.filter((t) => hint.startsWith(t.s.replace(/…$/, "").slice(0, 5)) || hint.includes(t.s.replace(/…$/, "")));
        expect(lines.length).toBeGreaterThanOrEqual(1);
        expect(lines.length).toBeLessThanOrEqual(2);
        const u = uiScaleFor(css);
        const limit = hintMaxWidth(touch, u, Math.min(u, 1.2), touch ? 0 : 2) / u;
        for (const l of lines) {
          // Fake-Messung: Zeichen * Größe * 0,55; kleinste Schrift 17 px
          expect(l.s.length * 17 * 0.55).toBeLessThanOrEqual(limit);
        }
      }
    }
  });

  it("Hinweis im Touch-Modus oben (unter dem Kombo-Panel), sonst am Boden", () => {
    const hintY = (touch: boolean): number => {
      const { g, calls } = fakeCtx();
      drawHud(g, baseState({ touch, hint: "Springen" }));
      const tr = calls.filter((c) => c.name === "translate").find((c) => c.args[0] === VIEW_W / 2);
      return Number(tr?.args[1]);
    };
    expect(hintY(true)).toBe(100);
    expect(hintY(false)).toBe(682);
  });

  it("Banner mit dunkler Platte und aufgehellter Akzentfarbe (+35 % Weiß)", () => {
    const { g, texts, sets } = fakeCtx();
    drawHud(g, baseState({ toast: { title: "Wien im Sturm", sub: "Blitz, Donner", u: 0.5, color: "#5b7cfa" } }));
    const title = texts.find((t) => t.s === "Wien im Sturm");
    expect(title).toBeDefined();
    // #5b7cfa (91,124,250) -> 35 % Richtung Weiß = (148, 170, 252)
    expect(title?.fill).toBe("rgb(148, 170, 252)");
    expect(sets.some(([k, v]) => k === "fillStyle" && v === "rgba(14,18,34,0.72)")).toBe(true);
    // Nicht-Hex-Farbe bleibt unverändert
    const r = fakeCtx();
    drawHud(r.g, baseState({ toast: { title: "Neuer Rekord!", u: 0.5, color: "gold" } }));
    expect(r.texts.find((t) => t.s === "Neuer Rekord!")?.fill).toBe("gold");
  });

  it("Layout bei cssScale >= 0,72 unverändert: gleiche Aufrufe wie ohne ctx", () => {
    const h = baseState({ best: 700, score: 300, powerups: [{ kind: "shield", frac: 0.5 }] });
    const names = (css: number | undefined): string => {
      const { g, calls } = fakeCtx();
      drawHud(g, h, css === undefined ? undefined : { cssScale: css });
      return calls.map((c) => `${c.name}:${c.args.map((a) => (typeof a === "number" ? a.toFixed(3) : typeof a)).join(",")}`).join("|");
    };
    const base = names(undefined);
    expect(names(1)).toBe(base);
    expect(names(0.72)).toBe(base);
    expect(names(0.6)).not.toBe(base);
  });

  it("Herzverlust zeichnet den Geist und den roten Ring; reduced und ohne HudFx nicht", () => {
    const ringCount = (reduced: boolean, useFx: boolean): number => {
      const fx = new HudFx();
      const h3 = baseState({ hearts: 3, reduced });
      const h2 = baseState({ hearts: 2, reduced });
      fx.update(h3, 0.016);
      fx.update(h2, 0.1);
      const { g, sets } = fakeCtx();
      drawHud(g, h2, { fx: useFx ? fx : null });
      return sets.filter(([k, v]) => k === "strokeStyle" && v === "rgb(255,70,70)").length;
    };
    expect(ringCount(false, true)).toBe(1);
    expect(ringCount(true, true)).toBe(0);
    expect(ringCount(false, false)).toBe(0);
  });

  it("Bump skaliert die Zahl um ihren Ankerpunkt, reduced und ohne Bump nicht", () => {
    const scales = (reduced: boolean): number[] => {
      const fx = new HudFx();
      fx.update(baseState({ coins: 1, reduced }), 0.016);
      const h = baseState({ coins: 2, reduced });
      fx.update(h, 0.016);
      const { g, calls } = fakeCtx();
      drawHud(g, h, { fx });
      return calls.filter((c) => c.name === "scale" && Number(c.args[0]) > 1.15 && Number(c.args[0]) < 1.3 && c.args[0] === c.args[1]).map((c) => Number(c.args[0]));
    };
    expect(scales(false).some((s) => Math.abs(s - (1 + BUMP_GAIN)) < 1e-9)).toBe(true);
    expect(scales(true)).toHaveLength(0);
  });
});

// --- Touch-Knöpfe mit Safe-Area --------------------------------------------------------------------------------------

/** Rechteck (wie getBoundingClientRect) eines Bühnen-Elements im Browser-Fenster */
interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Bildet das CSS von .touchDash/.touchSlide nach: 130*px groß, Abstand zur Bühnenecke 26*px (rechts bzw. links) und
 * 24*px bzw. 26*px (unten) plus --safe-r/--safe-l/--safe-b in CSS-px. Die Bühne liegt bei (stageLeft, stageTop).
 */
function cssButtonRect(side: "dash" | "slide", stageW: number, stageLeft: number, stageTop: number, safe: { l?: number; r?: number; b?: number }): { stage: Rect; btn: Rect } {
  const px = stageW / VIEW_W;
  const stage: Rect = { left: stageLeft, top: stageTop, width: stageW, height: (stageW * 9) / 16 };
  const size = 130 * px;
  const bottom = (side === "dash" ? 24 : 26) * px + (safe.b ?? 0);
  const top = stage.top + stage.height - bottom - size;
  const left = side === "dash" ? stage.left + stage.width - (26 * px + (safe.r ?? 0)) - size : stage.left + 26 * px + (safe.l ?? 0);
  return { stage, btn: { left, top, width: size, height: size } };
}

describe("Touch-Knöpfe und Safe-Area (Befund: Ring konzentrisch zum DOM-Knopf)", () => {
  it("TOUCH_SLIDE ist die Mitte des 130-px-Knopfs (left 26, bottom 26)", () => {
    expect(TOUCH_SLIDE.r).toBe(65);
    expect(TOUCH_SLIDE.cx).toBe(26 + 65);
    expect(TOUCH_SLIDE.cy).toBe(720 - 26 - 65);
  });

  it("domButtonCenter: ohne Safe-Area liegt die gemessene Mitte auf TOUCH_DASH/TOUCH_SLIDE (jede Bühnengröße, mit Letterbox-Versatz)", () => {
    for (const [w, l, t] of [
      [1280, 0, 0],
      [693.3, 75.4, 0],
      [667, 0, 12.5],
      [1920, 0, 0],
    ] as const) {
      const d = cssButtonRect("dash", w, l, t, {});
      const dc = domButtonCenter(d.btn, d.stage);
      expect(dc).not.toBeNull();
      expect(Math.abs((dc?.cx ?? 0) - TOUCH_DASH.cx)).toBeLessThan(0.01);
      expect(Math.abs((dc?.cy ?? 0) - TOUCH_DASH.cy)).toBeLessThan(0.01);
      const s = cssButtonRect("slide", w, l, t, {});
      const sc = domButtonCenter(s.btn, s.stage);
      expect(Math.abs((sc?.cx ?? 0) - TOUCH_SLIDE.cx)).toBeLessThan(0.01);
      expect(Math.abs((sc?.cy ?? 0) - TOUCH_SLIDE.cy)).toBeLessThan(0.01);
    }
  });

  it("domButtonCenter: iPhone quer (Bühne höhenbegrenzt, --safe-b = 21 px) verschiebt die Mitte um rund 39 Einheiten nach oben", () => {
    const w = 693.33;
    const { stage, btn } = cssButtonRect("dash", w, 75.3, 0, { b: 21 });
    const c = domButtonCenter(btn, stage);
    expect(c).not.toBeNull();
    const shift = 21 / (w / VIEW_W);
    expect(shift).toBeGreaterThan(38);
    expect(shift).toBeLessThan(40);
    expect(Math.abs((c?.cy ?? 0) - (TOUCH_DASH.cy - shift))).toBeLessThan(0.01);
    expect(Math.abs((c?.cx ?? 0) - TOUCH_DASH.cx)).toBeLessThan(0.01);
  });

  it("domButtonCenter: unbrauchbare Maße ergeben null (Knopf ausgeblendet, Bühne ohne Breite, NaN)", () => {
    const stage: Rect = { left: 0, top: 0, width: 800, height: 450 };
    expect(domButtonCenter({ left: 0, top: 0, width: 0, height: 0 }, stage)).toBeNull();
    expect(domButtonCenter({ left: 10, top: 10, width: 80, height: 0 }, stage)).toBeNull();
    expect(domButtonCenter({ left: 10, top: 10, width: 80, height: 80 }, { ...stage, width: 0 })).toBeNull();
    expect(domButtonCenter({ left: Number.NaN, top: 10, width: 80, height: 80 }, stage)).toBeNull();
  });

  it("resolveButtonCenter: gültige Messung unverändert (dasselbe Objekt), sonst der Rückfall", () => {
    const ok: ButtonCenter = { cx: 1100, cy: 590 };
    expect(resolveButtonCenter(ok, TOUCH_DASH)).toBe(ok);
    expect(resolveButtonCenter(undefined, TOUCH_DASH)).toBe(TOUCH_DASH);
    expect(resolveButtonCenter(null, TOUCH_DASH)).toBe(TOUCH_DASH);
    expect(resolveButtonCenter({ cx: Number.NaN, cy: 300 }, TOUCH_DASH)).toBe(TOUCH_DASH);
    expect(resolveButtonCenter({ cx: 300, cy: Number.POSITIVE_INFINITY }, TOUCH_DASH)).toBe(TOUCH_DASH);
    expect(resolveButtonCenter({ cx: -5, cy: 300 }, TOUCH_DASH)).toBe(TOUCH_DASH);
    expect(resolveButtonCenter({ cx: 300, cy: VIEW_H + 1 }, TOUCH_DASH)).toBe(TOUCH_DASH);
  });

  it("drawHud: der Touch-Ring folgt dashCenter, nicht der festen Konstante (Ring, Kosten-Marke, Puls, Blitz)", () => {
    const measured: ButtonCenter = { cx: TOUCH_DASH.cx, cy: TOUCH_DASH.cy - 39 };
    const { g, calls } = fakeCtx();
    drawHud(g, baseState({ touch: true, energy: 80, dashDeniedT: 0.1, reduced: true }), { dashCenter: measured });
    // Ringradius 74; der Puls außen liegt bei 81
    const rings = arcs(calls).filter((c) => c.r === TOUCH_DASH.r + 9 || c.r === TOUCH_DASH.r + 9 + 7);
    // Unterlage, Spur, Füllung, roter Blitz, Puls: alle konzentrisch um die gemessene Mitte
    expect(rings.length).toBeGreaterThanOrEqual(5);
    for (const c of rings) {
      expect(c.x).toBe(measured.cx);
      expect(c.y).toBe(measured.cy);
    }
    // nichts mehr an der festen Lage
    expect(arcs(calls).some((c) => c.x === TOUCH_DASH.cx && c.y === TOUCH_DASH.cy)).toBe(false);
    // die Marke der Dash-Kosten (moveTo/lineTo) sitzt am Ring um die gemessene Mitte
    const mt = calls.filter((c) => c.name === "moveTo").map((c) => ({ x: Number(c.args[0]), y: Number(c.args[1]) }));
    const onRing = mt.filter((p) => Math.abs(Math.hypot(p.x - measured.cx, p.y - measured.cy) - (TOUCH_DASH.r + 9 - 8)) < 1e-6);
    expect(onRing.length).toBe(1);
  });

  it("drawHud: Ring und Knopf bleiben bei Safe-Area-Versatz konzentrisch, der Knopf ragt nirgends über den Ring", () => {
    // gerechnet wie die DOM-Prüfung in pkg-e2e, aber mit Insets: Bühne 693 x 390, --safe-b 21 px, --safe-r 0 (Letterbox deckt ab)
    const { stage, btn } = cssButtonRect("dash", 693.33, 75.3, 0, { b: 21 });
    const measured = domButtonCenter(btn, stage);
    expect(measured).not.toBeNull();
    const { g, calls } = fakeCtx();
    drawHud(g, baseState({ touch: true }), { dashCenter: measured, cssScale: stage.width / VIEW_W });
    const ring = arcs(calls).find((c) => c.r === TOUCH_DASH.r + 9);
    expect(ring).toBeDefined();
    if (ring && measured) {
      expect(Math.hypot(ring.x - measured.cx, ring.y - measured.cy)).toBeLessThan(0.01);
      // Spaltbreite zwischen Knopfrand (r 65) und Ringmitte (r 74) rundum gleich: die Mitten fallen zusammen
      expect(ring.r - TOUCH_DASH.r).toBe(9);
    }
    // ohne Messung bliebe der Ring an der Konstante (Rückfall) und läge dann ca. 39 Einheiten neben dem Knopf
    const fallback = fakeCtx();
    drawHud(fallback.g, baseState({ touch: true }), { cssScale: stage.width / VIEW_W });
    const fb = arcs(fallback.calls).find((c) => c.r === TOUCH_DASH.r + 9);
    expect(fb?.x).toBe(TOUCH_DASH.cx);
    expect(fb?.y).toBe(TOUCH_DASH.cy);
    if (fb && measured) expect(Math.hypot(fb.x - measured.cx, fb.y - measured.cy)).toBeGreaterThan(30);
  });

  it("drawHud: ungültiges dashCenter fällt auf TOUCH_DASH zurück; die Tastatur ignoriert es", () => {
    for (const bad of [null, { cx: Number.NaN, cy: 600 }, { cx: 5000, cy: 600 }, { cx: 1100, cy: -20 }]) {
      const { g, calls } = fakeCtx();
      drawHud(g, baseState({ touch: true }), { dashCenter: bad });
      expect(arcs(calls).some((c) => c.x === TOUCH_DASH.cx && c.y === TOUCH_DASH.cy && c.r === TOUCH_DASH.r + 9)).toBe(true);
    }
    const kb = fakeCtx();
    drawHud(kb.g, baseState({ touch: false }), { dashCenter: { cx: 1100, cy: 590 }, slideCenter: { cx: 300, cy: 500 } });
    const a = arcs(kb.calls);
    expect(a.some((c) => c.x === 74 && c.y === 652 && c.r === 36)).toBe(true);
    expect(a.some((c) => c.x === 1100)).toBe(false);
  });

  it("drawHud: das Wackeln bei abgelehntem Dash bezieht sich auf die gemessene Mitte", () => {
    const measured: ButtonCenter = { cx: 1150, cy: 600 };
    const xs = (st: Partial<HudState>): number[] => {
      const { g, calls } = fakeCtx();
      drawHud(g, baseState({ touch: true, ...st }), { dashCenter: measured });
      return arcs(calls)
        .filter((c) => c.r === TOUCH_DASH.r + 9 && c.y === measured.cy)
        .map((c) => c.x);
    };
    expect(xs({}).every((x) => x === measured.cx)).toBe(true);
    expect(xs({ dashDeniedT: 0.05 }).some((x) => x !== measured.cx)).toBe(true);
    expect(xs({ dashDeniedT: 0.05, reduced: true }).every((x) => x === measured.cx)).toBe(true);
  });

  it("powerupStartX: Tastatur 148, Touch 158 und weiter rechts nur, wenn der Rutschen-Knopf nach rechts wandert", () => {
    expect(powerupStartX(false, undefined)).toBe(148);
    expect(powerupStartX(false, { cx: 300, cy: 600 })).toBe(148);
    expect(powerupStartX(true, undefined)).toBe(158);
    expect(powerupStartX(true, null, 1)).toBe(158);
    expect(powerupStartX(true, TOUCH_SLIDE)).toBe(158);
    // Safe-Area unten: der Knopf wandert nach oben, der Abstand wächst nur
    expect(powerupStartX(true, { cx: TOUCH_SLIDE.cx, cy: TOUCH_SLIDE.cy - 39 })).toBe(158);
    // Safe-Area links: der Knopf wandert nach rechts, die Reihe folgt
    expect(powerupStartX(true, { cx: TOUCH_SLIDE.cx + 60, cy: TOUCH_SLIDE.cy })).toBeGreaterThan(200);
    // ungültige Messung: Rückfall
    expect(powerupStartX(true, { cx: Number.NaN, cy: 0 })).toBe(158);
  });

  it("powerupStartX: der erste Ring hält nach der Eck-Skalierung Abstand zum (verschobenen) Rutschen-Knopf", () => {
    // Ringmitte nach anchor(BL_X, BL_Y, u): 22 + (cx - 22) * u, 698 + (660 - 698) * u; Platte r 30 * u
    for (const u of [1, 1.1, 1.2, 1.35]) {
      for (const dx of [0, 25, 60, 90]) {
        for (const dy of [0, -39, -80]) {
          const slide: ButtonCenter = { cx: TOUCH_SLIDE.cx + dx, cy: TOUCH_SLIDE.cy + dy };
          const start = powerupStartX(true, slide, u);
          const cx = 22 + (start + 26 - 22) * u;
          const cy = 698 + (660 - 698) * u;
          expect(Math.hypot(cx - slide.cx, cy - slide.cy)).toBeGreaterThanOrEqual(TOUCH_SLIDE.r + 30 * u);
        }
      }
    }
  });

  it("drawHud: slideCenter verschiebt die Touch-Power-ups (u = 1), ohne Messung bleibt es bei x = 158", () => {
    const first = (slide?: ButtonCenter): { x: number; y: number } | undefined => {
      const { g, calls } = fakeCtx();
      drawHud(g, baseState({ touch: true, powerups: [{ kind: "shield", frac: 0.5 }] }), slide ? { slideCenter: slide } : undefined);
      return arcs(calls).find((c) => c.y === 660 && c.r === 30);
    };
    expect(first()?.x).toBe(158 + 26);
    const moved: ButtonCenter = { cx: TOUCH_SLIDE.cx + 70, cy: TOUCH_SLIDE.cy };
    const p = first(moved);
    expect(p).toBeDefined();
    if (p) {
      expect(p.x).toBeGreaterThan(184);
      expect(Math.hypot(p.x - moved.cx, p.y - moved.cy)).toBeGreaterThan(TOUCH_SLIDE.r + 30);
    }
  });
});
