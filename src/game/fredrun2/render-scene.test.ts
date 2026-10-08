import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXED_DT } from "./constants";
import type { GameAssets } from "./assets";
import type { HudFx, HudState } from "./hud";
import { Renderer, type FrameData } from "./render";
import { Sim } from "./sim";
import type { ViewState, WorldRenderer } from "./types";
import { WORLDS } from "./worlds";

// Verdrahtung des Renderers (draw): "Weniger Bewegung" im HUD und Skalierungsqualität unter Shake-Zoom.
// Die Bausteine (HudFx, draw-utils) prüfen hud-fx.test.ts und render-logic.test.ts; hier läuft die echte Renderer.draw
// gegen eine aufzeichnende Zeichenfläche.

interface Draw {
  /** imageSmoothingQuality zum Zeitpunkt des drawImage-Aufrufs */
  quality: string;
  /** wer gezeichnet hat (Tag des Aufrufers: Hintergrund, Vordergrund, ...) */
  tag: string;
}

interface Fake {
  g: CanvasRenderingContext2D;
  draws: Draw[];
}

/** Aufzeichnender 2D-Kontext: alle Methoden sind No-ops; save/restore führen imageSmoothingQuality wie ein echter Kontext mit. */
function fakeCtx(): Fake {
  const state: Record<string, unknown> = {
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "low",
    lineWidth: 1,
    fillStyle: "#000",
    strokeStyle: "#000",
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    shadowBlur: 0,
    shadowColor: "rgba(0,0,0,0)",
    filter: "none",
  };
  const stack: string[] = [];
  const draws: Draw[] = [];
  const noop = (): void => {};
  const g = new Proxy(state, {
    get(t, k: string) {
      if (k === "save") return () => void stack.push(String(t.imageSmoothingQuality));
      if (k === "restore") return () => void (t.imageSmoothingQuality = stack.pop() ?? t.imageSmoothingQuality);
      if (k === "drawImage") {
        return (img: { tag?: string }) => void draws.push({ quality: String(t.imageSmoothingQuality), tag: img?.tag ?? "?" });
      }
      if (k === "createLinearGradient" || k === "createRadialGradient" || k === "createPattern") return () => ({ addColorStop: noop });
      if (k === "measureText") return () => ({ width: 10 });
      return k in t ? t[k] : noop;
    },
    set(t, k: string, v: unknown) {
      t[k] = v;
      return true;
    },
  });
  return { g: g as unknown as CanvasRenderingContext2D, draws };
}

/** Welt, die in Hintergrund und Vordergrund je ein Bild zeichnet (Tag = Aufrufer) und jede Entität selbst übernimmt. */
function fakeWorld(): WorldRenderer {
  const bg = { tag: "bg" } as unknown as CanvasImageSource;
  const fg = { tag: "fg" } as unknown as CanvasImageSource;
  return {
    load: async () => {},
    update: () => {},
    drawBackground: (g) => g.drawImage(bg, 0, 0),
    drawGround: () => {},
    drawEntity: () => true,
    drawForeground: (g) => g.drawImage(fg, 0, 0),
  };
}

function baseHud(over: Partial<HudState> = {}): HudState {
  return {
    score: 1000,
    meters: 120,
    hearts: 3,
    coins: 5,
    combo: 1,
    comboFrac: 0,
    energy: 100,
    dashCost: 34,
    powerups: [],
    toast: null,
    worldName: "Wien",
    accent: "#5b7cfa",
    best: 0,
    hint: null,
    tourFrac: null,
    time: 1,
    chaseWarn: 0,
    touch: false,
    ...over,
  };
}

interface Env {
  r: Renderer;
  main: Fake;
  sim: Sim;
  world: WorldRenderer;
  frame: (over?: Partial<FrameData>) => FrameData;
}

function setup(): Env {
  const main = fakeCtx();
  const canvas = { width: 1280, height: 720, getContext: () => main.g } as unknown as HTMLCanvasElement;
  const r = new Renderer(canvas, {} as unknown as GameAssets);
  r.resize(1280, 720, 1);
  const sim = new Sim({ mode: "world", world: "wien", character: "fred", seed: 7 }, WORLDS);
  sim.begin();
  sim.ents = [];
  const world = fakeWorld();
  const view: ViewState = sim.view(1, { dist: sim.dist, hgt: sim.player.hgt }, false, 2, FIXED_DT);
  const frame = (over: Partial<FrameData> = {}): FrameData => ({
    sim,
    view,
    current: world,
    next: null,
    nextView: view,
    rendererFor: () => world,
    hud: null,
    shakeX: 0,
    shakeY: 0,
    flash: 0,
    flashColor: "#ffffff",
    demo: false,
    time: 1,
    showPlayer: true,
    idle: false,
    victory: false,
    ...over,
  });
  return { r, main, sim, world, frame };
}

function fxOf(r: Renderer): HudFx {
  return (r as unknown as { hudFx: HudFx }).hudFx;
}

beforeEach(() => {
  // Offscreen-Flächen (Vignette, HUD-Sprites, Puffs) bekommen eigene aufzeichnende Kontexte
  vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx().g }) });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Renderer.draw: Weniger Bewegung im HUD", () => {
  it("reducedMotion setzt hud.reduced (sonst liest HudFx/drawHud das Feld nie)", () => {
    const e = setup();
    e.r.reducedMotion = true;
    const hud = baseHud();
    expect(hud.reduced).toBeUndefined();
    e.r.draw(e.frame({ hud }));
    expect(hud.reduced).toBe(true);
  });

  it("Herz-Verlust und Münzen lösen mit reducedMotion weder Pop noch Bump aus", () => {
    const e = setup();
    e.r.reducedMotion = true;
    e.r.draw(e.frame({ hud: baseHud() }));
    e.r.update(1 / 60, e.sim, 0);
    e.r.draw(e.frame({ hud: baseHud({ hearts: 2, coins: 8 }) }));
    const fx = fxOf(e.r);
    expect(fx.lossU(2)).toBeLessThan(0); // < 0 = kein laufender Pop
    expect(fx.coinBump).toBe(0);
  });

  it("Kontrolle: ohne reducedMotion läuft derselbe Verlust als Pop und Bump, hud.reduced bleibt ungesetzt", () => {
    const e = setup();
    e.r.reducedMotion = false;
    e.r.draw(e.frame({ hud: baseHud() }));
    e.r.update(1 / 60, e.sim, 0);
    const hud = baseHud({ hearts: 2, coins: 8 });
    e.r.draw(e.frame({ hud }));
    const fx = fxOf(e.r);
    expect(fx.lossU(2)).toBeGreaterThanOrEqual(0);
    expect(fx.coinBump).toBeGreaterThan(0);
    expect(hud.reduced).toBeUndefined();
  });

  it("ein vom Hub gesetztes reduced bleibt auch ohne reducedMotion des Renderers wirksam", () => {
    const e = setup();
    e.r.reducedMotion = false;
    const hud = baseHud({ reduced: true });
    e.r.draw(e.frame({ hud }));
    expect(hud.reduced).toBe(true);
  });

  it("ohne HUD (Menü) passiert nichts", () => {
    const e = setup();
    e.r.reducedMotion = true;
    expect(() => e.r.draw(e.frame({ hud: null }))).not.toThrow();
  });
});

describe("Renderer.draw: Skalierungsqualität unter Shake-Zoom", () => {
  const scene = (e: Env): Draw[] => e.main.draws.filter((d) => d.tag === "bg" || d.tag === "fg");

  it("ohne Shake bleibt es bei hoher Qualität (Hintergrund und Vordergrund)", () => {
    const e = setup();
    e.r.draw(e.frame());
    const d = scene(e);
    expect(d.map((x) => x.tag)).toEqual(["bg", "fg"]);
    expect(d.every((x) => x.quality === "high")).toBe(true);
  });

  it("mit Shake zeichnet die ganze Szene mit niedriger Qualität, auch der Vordergrund hinter dem Partikel-Block", () => {
    const e = setup();
    e.r.draw(e.frame({ shakeX: 3, shakeY: -2 }));
    const d = scene(e);
    expect(d.map((x) => x.tag)).toEqual(["bg", "fg"]);
    expect(d.every((x) => x.quality === "low")).toBe(true);
  });

  it("schon ein kleiner Shake nimmt den schnellen Pfad (jede Skalierung ungleich 1 wäre sonst teuer)", () => {
    const e = setup();
    e.r.draw(e.frame({ shakeX: 0.2, shakeY: 0 }));
    expect(scene(e).every((x) => x.quality === "low")).toBe(true);
  });

  it("nach dem Shake-Frame ist die Qualität zurückgesetzt (nächster Frame ohne Shake wieder hoch)", () => {
    const e = setup();
    e.r.draw(e.frame({ shakeX: 4, shakeY: 4 }));
    e.main.draws.length = 0;
    e.r.draw(e.frame());
    expect(scene(e).every((x) => x.quality === "high")).toBe(true);
  });
});
