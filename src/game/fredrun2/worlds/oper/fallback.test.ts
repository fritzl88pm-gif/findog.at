import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetLoader, Ent, PropLibrary, ViewState } from "../../types";
import { DIM, SKIN } from "./dims";
import { OPER_FALLBACK } from "./fallback";
import { OperRenderer } from "./renderer";
import { OPER_PROPS, OperSkins } from "./skins";
import { SpriteBank } from "./sprites";

// --- Zeichenkontext-Attrappe: zählt Aufrufe und prüft, was ein echter Canvas mit einer Ausnahme quittieren würde ---------

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([0-9., ]+\))$/i;

interface Stats {
  fills: number;
  strokes: number;
  images: number;
  saves: number;
  restores: number;
  bad: string[];
}

function stubCtx(): { g: CanvasRenderingContext2D; stats: Stats } {
  const stats: Stats = { fills: 0, strokes: 0, images: 0, saves: 0, restores: 0, bad: [] };
  const state: Record<string, unknown> = { globalAlpha: 1, lineWidth: 1, globalCompositeOperation: "source-over", imageSmoothingQuality: "low", lineDashOffset: 0, shadowBlur: 0 };
  const finite = (name: string, args: unknown[]): void => {
    for (const a of args) if (typeof a === "number" && !Number.isFinite(a)) stats.bad.push(`${name}(${args.join(",")}) nicht endlich`);
  };
  const grad = {
    addColorStop(o: number, c: string): void {
      if (!(o >= 0 && o <= 1)) stats.bad.push(`Farbstopp ${o} außerhalb 0..1`);
      if (typeof c !== "string" || !COLOR.test(c)) stats.bad.push(`Farbe „${String(c)}“ ungültig`);
    },
  };
  const g = new Proxy(state, {
    get(t, prop: string) {
      if (prop in t) return t[prop];
      if (prop === "createLinearGradient" || prop === "createRadialGradient") {
        return (...a: number[]): unknown => {
          finite(prop, a);
          if (prop === "createRadialGradient" && (a[2] < 0 || a[5] < 0)) stats.bad.push(`negativer Radius in ${prop}`);
          return grad;
        };
      }
      return (...a: unknown[]): unknown => {
        finite(prop, a);
        if (prop === "fill") stats.fills += 1;
        else if (prop === "stroke") stats.strokes += 1;
        else if (prop === "drawImage") stats.images += 1;
        else if (prop === "save") stats.saves += 1;
        else if (prop === "restore") stats.restores += 1;
        else if (prop === "fillRect") stats.fills += 1;
        else if (prop === "ellipse" && ((a[2] as number) < 0 || (a[3] as number) < 0)) stats.bad.push(`negativer Ellipsenradius ${a[2]}/${a[3]}`);
        else if (prop === "arc" && (a[2] as number) < 0) stats.bad.push(`negativer Kreisradius ${a[2]}`);
        else if (prop === "arcTo" && (a[4] as number) < 0) stats.bad.push(`negativer arcTo-Radius ${a[4]}`);
        return undefined;
      };
    },
    set(t, prop: string, value: unknown) {
      if ((prop === "fillStyle" || prop === "strokeStyle") && typeof value === "string" && !COLOR.test(value)) stats.bad.push(`${prop} „${value}“ ungültig`);
      if ((prop === "fillStyle" || prop === "strokeStyle") && (value === undefined || value === null)) stats.bad.push(`${prop} leer`);
      if (prop === "lineWidth" && !(typeof value === "number" && value >= 0)) stats.bad.push(`lineWidth ${String(value)}`);
      t[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { g, stats };
}

beforeEach(() => {
  // makeCanvas() braucht ein document; jede Fläche bekommt eine eigene Attrappe
  vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0, getContext: () => stubCtx().g }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const NO_PROPS: PropLibrary = { has: () => false, preload: async () => undefined, draw: () => false, cell: () => null };

describe("Opernball – prozedurale Ersatz-Props", () => {
  it("deckt alle Props der Welt ab", () => {
    expect(Object.keys(OPER_FALLBACK).sort()).toEqual([...OPER_PROPS].sort());
  });

  it("Zellenmaße entsprechen dem Prop-Manifest (gleiches Seitenverhältnis wie die gemalten Props)", () => {
    const manifest = JSON.parse(readFileSync(new URL("../../../../../public/fredrun2/props/manifest.json", import.meta.url), "utf8")) as { props: Record<string, { cw: number; ch: number }> };
    for (const [id, fb] of Object.entries(OPER_FALLBACK)) {
      const cell = manifest.props[id];
      expect(cell, `${id} im Manifest`).toBeDefined();
      expect(fb.w / fb.h, id).toBeCloseTo(cell.cw / cell.ch, 1);
    }
  });

  it("jeder Painter zeichnet ohne Fehler: gültige Zahlen/Farben, ausgeglichenes save/restore, sichtbarer Inhalt", () => {
    for (const [id, fb] of Object.entries(OPER_FALLBACK)) {
      const { g, stats } = stubCtx();
      fb.paint(g, fb.w, fb.h);
      expect(stats.bad, id).toEqual([]);
      expect(stats.saves, id).toBe(stats.restores);
      expect(stats.fills + stats.strokes, id).toBeGreaterThanOrEqual(6);
    }
  });

  it("SpriteBank: ohne Prop entsteht der Ersatz mit den Maßen des Props, mit geladenem Prop bleibt alles wie zuvor", () => {
    const bank = new SpriteBank(NO_PROPS);
    const b = bank.get("oper-harp", 253, { rim: 2.6 });
    expect(b).not.toBeNull();
    // Körpermaße wie beim Prop: Höhe vorgegeben, Breite nach Seitenverhältnis 303:512
    expect(b?.bodyH).toBeCloseTo(253, 5);
    expect(b?.bodyW).toBeCloseTo((253 * 303) / 512, 5);
    expect(bank.get("oper-harp", 253, { rim: 2.6 })).toBe(b);
    // Vorhang: Breite vorgegeben, Höhe nach Seitenverhältnis 512:222
    const d = bank.get("oper-drape", 90, { rim: 2.6, ax: 0.5, ay: 0, w: 210 });
    expect(d?.bodyW).toBeCloseTo(210, 5);
    expect(d?.bodyH).toBeCloseTo((210 * 222) / 512, 5);
    // unbekannte Id → weiterhin null
    expect(bank.get("oper-gibtsnicht", 100)).toBeNull();

    // geladenes Prop: Zeichnen über props.draw, kein Ersatz
    const draw = vi.fn(() => true);
    const real: PropLibrary = { has: (id) => id === "oper-harp", preload: async () => undefined, draw, cell: () => ({ w: 303, h: 512, frames: 1 }) };
    const rb = new SpriteBank(real);
    expect(rb.get("oper-harp", 253, { rim: 2.6 })).not.toBeNull();
    expect(draw).toHaveBeenCalled();
    // ein anderes, fehlendes Prop bekommt trotzdem den Ersatz
    expect(rb.get("oper-piano", 150, { rim: 2.4 })).not.toBeNull();
  });

  it("letzter Notbehelf: ohne Prop UND ohne Ersatzbild zeichnen die Skins weiterhin (Tafel mit Verlauf, Kugel am Kettenpendel)", () => {
    const saved = { ...OPER_FALLBACK };
    for (const k of Object.keys(OPER_FALLBACK)) delete OPER_FALLBACK[k];
    try {
      const { g, stats } = stubCtx();
      const skins = new OperSkins();
      skins.setProps(NO_PROPS);
      const view = { w: 1280, h: 720, dist: 0, speed: 500, time: 3, dt: 0.016, groundY: 590, ceilY: 150, worldMeters: 0, stage: 0, stageBlend: 0, intensity: 0, gravDir: 1, playerX: 300, playerFeetY: 590, hurtGlow: 0, dashing: false, turbo: false, slowmo: 0, reducedMotion: false, quality: 2, vars: {}, flash: 0 } as ViewState;
      const mk = (kind: Ent["kind"], skin: string, w: number, h: number, extra: Partial<Ent> = {}): Ent => ({
        id: 1, kind, skin, x: 500, y: 590 - h, w, h, vx: -100, vy: 0, hb: [0, 0, w, h], harmful: true, stompable: false, breakable: false, ceil: false, warn: false, dead: false,
        age: 1, state: "idle", stateT: 0, p: {}, minClear: 9999, passed: false, fx: {}, pat: "", ...extra,
      });
      const cases: Ent[] = [
        mk("block", SKIN.cake, DIM.cake.w, DIM.cake.h),
        mk("walker", SKIN.waiter, DIM.waiter.w, DIM.waiter.h),
        mk("spring", SKIN.piano, DIM.piano.w, DIM.piano.h),
        mk("swinger", SKIN.swing, DIM.chandelierR * 2, DIM.chandelierR * 2, { p: { ax: 500, ay: -20, len: 510 }, fx: { angle: 0.3 } }),
      ];
      for (const e of cases) {
        const before = stats.fills;
        expect(skins.draw(g, e, 300, e.y, view), e.skin).toBe(true);
        expect(stats.fills, e.skin).toBeGreaterThan(before);
      }
      expect(stats.bad).toEqual([]);
      expect(stats.saves).toBe(stats.restores);
    } finally {
      Object.assign(OPER_FALLBACK, saved);
    }
  });

  it("Skins zeichnen ohne Props die Ersatzbilder (Hindernisse, Gegner, Sammelobjekte)", () => {
    const { g, stats } = stubCtx();
    const skins = new OperSkins();
    skins.setProps(NO_PROPS);
    const view = {
      w: 1280,
      h: 720,
      dist: 0,
      speed: 500,
      time: 3,
      dt: 0.016,
      groundY: 590,
      ceilY: 150,
      worldMeters: 100,
      stage: 1,
      stageBlend: 0,
      intensity: 0.5,
      gravDir: 1,
      playerX: 300,
      playerFeetY: 590,
      hurtGlow: 0,
      dashing: false,
      turbo: false,
      slowmo: 0,
      reducedMotion: false,
      quality: 2,
      vars: {},
      flash: 0,
    } as ViewState;
    let id = 1;
    const ent = (kind: Ent["kind"], skin: string, w: number, h: number, extra: Partial<Ent> = {}): Ent => ({
      id: id++,
      kind,
      skin,
      x: 500,
      y: 590 - h,
      w,
      h,
      vx: -100,
      vy: 0,
      hb: [0, 0, w, h],
      harmful: true,
      stompable: false,
      breakable: false,
      ceil: false,
      warn: false,
      dead: false,
      age: 1,
      state: "idle",
      stateT: 0,
      p: {},
      minClear: 9999,
      passed: false,
      fx: {},
      pat: "",
      ...extra,
    });
    const cases: Array<[string, Ent]> = [
      ["cake", ent("block", SKIN.cake, DIM.cake.w, DIM.cake.h)],
      ["harp", ent("block", SKIN.harp, DIM.harp.w, DIM.harp.h)],
      ["bouquet", ent("block", SKIN.bouquet, DIM.bouquet.w, DIM.bouquet.h)],
      ["champagne", ent("block", SKIN.tower, DIM.tower.w, DIM.tower.h)],
      ["rope", ent("block", SKIN.rope, DIM.rope.w, DIM.rope.h)],
      ["drape", ent("overhead", SKIN.drape, 210, 640 + DIM.drapeBottom, { y: 590 - DIM.drapeBottom - 640 })],
      ["lowlamp", ent("overhead", SKIN.lowlamp, 136, 520 + DIM.lowLampBottom, { y: 590 - DIM.lowLampBottom - 520 })],
      ["chandelier", ent("swinger", SKIN.swing, DIM.chandelierR * 2, DIM.chandelierR * 2, { p: { ax: 500, ay: -20, len: 510 }, fx: { angle: 0.3 } })],
      ["waiter", ent("walker", SKIN.waiter, DIM.waiter.w, DIM.waiter.h)],
      ["dancers", ent("walker", SKIN.dancers, DIM.dancers.w, DIM.dancers.h)],
      ["cork", ent("projectile", SKIN.cork, DIM.cork.w, DIM.cork.h, { p: { delay: 0, neck: DIM.bottleNeck } })],
      ["bottle", ent("decor", SKIN.bottle, DIM.bottle.w, DIM.bottle.h, { p: { popT: 1e9 } })],
      ["piano", ent("spring", SKIN.piano, DIM.piano.w, DIM.piano.h)],
      ["note", ent("pickup", "coin", 30, 30, { pickup: "coin" })],
      ["mask", ent("pickup", "gem", 30, 30, { pickup: "gem" })],
    ];
    for (const [name, e] of cases) {
      const before = stats.images;
      expect(skins.draw(g, e, 300, e.y, view), name).toBe(true);
      // Sprite aus dem Ersatzbild (die alte Notlösung zeichnete nur Pfade) → mindestens ein drawImage je Skin
      expect(stats.images - before, name).toBeGreaterThanOrEqual(1);
    }
    expect(stats.bad).toEqual([]);
    expect(stats.saves).toBe(stats.restores);
    expect(() => skins.warm()).not.toThrow();
  });
});

describe("Opernball – Laden", () => {
  it("load() wartet auf assets.props.preload (kein Lauf mit halb geladenen Props)", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const preload = vi.fn(() => gate);
    const assets: AssetLoader = { image: async () => null, props: { ...NO_PROPS, preload } };
    const r = new OperRenderer();
    let done = false;
    const p = r.load(assets).then(() => {
      done = true;
    });
    await new Promise((res) => setTimeout(res, 20));
    expect(preload).toHaveBeenCalledWith(OPER_PROPS);
    expect(done).toBe(false);
    release();
    await p;
    expect(done).toBe(true);
  });

  it("load() bleibt fehlertolerant, wenn preload scheitert (Ersatzbilder statt Abbruch)", async () => {
    const assets: AssetLoader = { image: async () => null, props: { ...NO_PROPS, preload: async () => Promise.reject(new Error("Netz")) } };
    await expect(new OperRenderer().load(assets)).resolves.toBeUndefined();
  });
});
