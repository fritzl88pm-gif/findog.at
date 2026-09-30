import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetLoader, Ent, PropLibrary, ViewState } from "../../types";
import { DIM, SKIN } from "./dims";
import { paintIcicleBar, WINTER_FALLBACK } from "./fallback";
import { makeGlows, SpriteCache } from "./gfx";
import { WINTER_PROPS, WinterRenderer } from "./renderer";
import { drawWinterSkin, warmFallbacks, type SkinEnv } from "./skins";

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
    createElement: () => {
      const c = { width: 0, height: 0, getContext: () => stubCtx().g };
      return c;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const NO_PROPS: PropLibrary = { has: () => false, preload: async () => undefined, draw: () => false, cell: () => null };

describe("Christkindlmarkt – prozedurale Ersatz-Props", () => {
  it("deckt alle Props der Welt ab (außer dem Eiszapfen-Balken, der eigens gebacken wird)", () => {
    for (const id of WINTER_PROPS) {
      if (id === "winter-icicles") continue;
      expect(WINTER_FALLBACK[id], id).toBeDefined();
    }
    expect(Object.keys(WINTER_FALLBACK).sort()).toEqual([...WINTER_PROPS].filter((id) => id !== "winter-icicles").sort());
  });

  it("Zellenmaße entsprechen dem Prop-Manifest (gleiches Seitenverhältnis wie die gemalten Props)", () => {
    const manifest = JSON.parse(readFileSync(new URL("../../../../../public/fredrun2/props/manifest.json", import.meta.url), "utf8")) as { props: Record<string, { cw: number; ch: number }> };
    for (const [id, fb] of Object.entries(WINTER_FALLBACK)) {
      const cell = manifest.props[id];
      expect(cell, `${id} im Manifest`).toBeDefined();
      expect(fb.w / fb.h, id).toBeCloseTo(cell.cw / cell.ch, 1);
    }
  });

  it("jeder Painter zeichnet ohne Fehler: gültige Zahlen/Farben, ausgeglichenes save/restore, sichtbarer Inhalt", () => {
    for (const [id, fb] of Object.entries(WINTER_FALLBACK)) {
      const { g, stats } = stubCtx();
      fb.paint(g, fb.w, fb.h);
      expect(stats.bad, id).toEqual([]);
      expect(stats.saves, id).toBe(stats.restores);
      expect(stats.fills + stats.strokes, id).toBeGreaterThanOrEqual(6);
      // Lichtpunkte: Tripel im Bild
      if (fb.lights) {
        expect(fb.lights.length % 3, id).toBe(0);
        for (let i = 0; i < fb.lights.length; i += 3) {
          expect(fb.lights[i], id).toBeGreaterThanOrEqual(0);
          expect(fb.lights[i], id).toBeLessThanOrEqual(1000);
          expect(fb.lights[i + 1], id).toBeGreaterThanOrEqual(0);
          expect(fb.lights[i + 1], id).toBeLessThanOrEqual(1000);
        }
      }
    }
    for (const w of [120, 260, 331, 600]) {
      const { g, stats } = stubCtx();
      paintIcicleBar(g, w, 214);
      expect(stats.bad, `Balken ${w}`).toEqual([]);
      expect(stats.fills + stats.strokes).toBeGreaterThan(8);
    }
  });

  it("SpriteCache: ohne Prop entsteht der Ersatz (mit Maßen/Anker des Props), mit geladenem Prop bleibt alles wie zuvor", () => {
    const cache = new SpriteCache(NO_PROPS);
    cache.reset(1);
    const spr = cache.get("winter-snowman", 136, "rgba(255,236,196,0.95)");
    expect(spr?.fb).toBe(true);
    expect(spr?.h).toBe(136);
    expect(spr?.w).toBeCloseTo((136 * 335) / 512, 5);
    expect(spr?.an).toBe(1);
    // gleiche Anfrage → derselbe gebackene Sprite
    expect(cache.get("winter-snowman", 136, "rgba(255,236,196,0.95)")).toBe(spr);
    // Lichtpunkte des Ersatzes
    expect(cache.get("winter-tree", 180, null)?.lights?.length).toBeGreaterThan(0);
    // unbekannte Id ohne Prop und ohne Ersatz: null
    expect(cache.get("winter-icicles", 200, null, "top")).toBeNull();
    // Balken beliebiger Breite
    const bar = cache.proc("icicle-bar", 288, 214, "rgba(150,232,255,0.95)", "top", paintIcicleBar);
    expect(bar?.fb).toBe(true);
    expect(bar?.w).toBeCloseTo(288, 5);
    expect(cache.proc("icicle-bar", 288, 214, "rgba(150,232,255,0.95)", "top", paintIcicleBar)).toBe(bar);

    // geladenes Prop: kein Ersatz, Zeichnen über props.draw wie bisher
    const draw = vi.fn(() => true);
    const real: PropLibrary = { has: (id) => id === "winter-snowman", preload: async () => undefined, draw, cell: () => ({ w: 335, h: 512, frames: 1 }) };
    const c2 = new SpriteCache(real);
    c2.reset(1);
    const s2 = c2.get("winter-snowman", 136, null);
    expect(s2?.fb).toBeUndefined();
    expect(draw).toHaveBeenCalled();
    // ein anderes, fehlendes Prop bekommt trotzdem den Ersatz
    expect(c2.get("winter-presents", 260, null)?.fb).toBe(true);
  });

  it("SpriteCache: Balken-Sprites bleiben begrenzt (kein unbegrenztes Wachstum bei vielen Breiten)", () => {
    const cache = new SpriteCache(NO_PROPS);
    cache.reset(1);
    const first = cache.proc("icicle-bar", 240, 214, null, "top", paintIcicleBar);
    for (let w = 264; w < 264 + 24 * 14; w += 24) cache.proc("icicle-bar", w, 214, null, "top", paintIcicleBar);
    // die älteste Breite wurde verdrängt → neu gebacken
    expect(cache.proc("icicle-bar", 240, 214, null, "top", paintIcicleBar)).not.toBe(first);
    // eine kürzlich benutzte Breite bleibt erhalten
    const recent = cache.proc("icicle-bar", 264 + 24 * 13, 214, null, "top", paintIcicleBar);
    expect(cache.proc("icicle-bar", 264 + 24 * 13, 214, null, "top", paintIcicleBar)).toBe(recent);
  });

  it("SpriteCache: Nachbearbeitung (Variante) und dpr-Wechsel", () => {
    const cache = new SpriteCache(NO_PROPS);
    cache.reset(2);
    const post = vi.fn();
    const a = cache.get("winter-elf", 127, null, "foot", "thrown", post);
    expect(a?.fb).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
    expect(a?.k).toBe(2);
    cache.reset(1);
    expect(cache.get("winter-elf", 127, null, "foot", "thrown", post)).not.toBe(a);
  });

  it("letzter Notbehelf: ohne Prop UND ohne Ersatzbild zeichnen die Skins weiterhin (Kasten mit Verlauf, Schneemann aus Kugeln)", () => {
    const saved = { ...WINTER_FALLBACK };
    for (const k of Object.keys(WINTER_FALLBACK)) delete WINTER_FALLBACK[k];
    try {
      const { g, stats } = stubCtx();
      const spr = new SpriteCache(NO_PROPS);
      spr.reset(1);
      const env: SkinEnv = { props: NO_PROPS, spr, glows: makeGlows(), s: 0, night: 0.5 };
      const view = { w: 1280, h: 720, dist: 0, speed: 500, time: 3, dt: 0.016, groundY: 590, ceilY: 150, worldMeters: 0, stage: 0, stageBlend: 0, intensity: 0, gravDir: 1, playerX: 300, playerFeetY: 590, hurtGlow: 0, dashing: false, turbo: false, slowmo: 0, reducedMotion: false, quality: 2, vars: {}, flash: 0 } as ViewState;
      const mk = (skin: string, w: number, h: number): Ent => ({
        id: 1, kind: "block", skin, x: 500, y: 590 - h, w, h, vx: 0, vy: 0, hb: [0, 0, w, h], harmful: true, stompable: false, breakable: false, ceil: false, warn: false, dead: false,
        age: 1, state: "idle", stateT: 0, p: {}, minClear: 9999, passed: false, fx: {}, pat: "",
      });
      for (const [skin, d] of [[SKIN.snowman, DIM.snowman], [SKIN.presents, DIM.presents], [SKIN.tree, DIM.tree], [SKIN.cane, DIM.cane], [SKIN.iceblock, DIM.iceblock], [SKIN.stall, DIM.stall], [SKIN.kessel, DIM.kessel]] as const) {
        const before = stats.fills;
        expect(drawWinterSkin(g, env, mk(skin, d.w, d.h), 300, 590 - d.h, view), skin).toBe(true);
        expect(stats.fills, skin).toBeGreaterThan(before);
      }
      expect(stats.bad).toEqual([]);
      expect(stats.saves).toBe(stats.restores);
    } finally {
      Object.assign(WINTER_FALLBACK, saved);
    }
  });

  it("Skins zeichnen ohne Props die Ersatzbilder (Hindernisse, Gegner, Sammelobjekte)", () => {
    const { g, stats } = stubCtx();
    const spr = new SpriteCache(NO_PROPS);
    spr.reset(1);
    const env: SkinEnv = { props: NO_PROPS, spr, glows: makeGlows(), s: 0, night: 0.5 };
    const view: ViewState = {
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
    };
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
      ["snowman", ent("block", SKIN.snowman, DIM.snowman.w, DIM.snowman.h)],
      ["presents", ent("block", SKIN.presents, DIM.presents.w, DIM.presents.h)],
      ["tree", ent("block", SKIN.tree, DIM.tree.w, DIM.tree.h)],
      ["cane", ent("block", SKIN.cane, DIM.cane.w, DIM.cane.h)],
      ["iceblock", ent("block", SKIN.iceblock, DIM.iceblock.w, DIM.iceblock.h)],
      ["stall", ent("block", SKIN.stall, DIM.stall.w, DIM.stall.h)],
      ["kessel", ent("block", SKIN.kessel, DIM.kessel.w, DIM.kessel.h)],
      ["icicles", ent("overhead", SKIN.icicles, 330, 210, { y: 590 - 72 - 210 })],
      ["gingerbread", ent("walker", SKIN.gingerbread, DIM.gingerbread.w, DIM.gingerbread.h)],
      ["krampus", ent("walker", SKIN.krampus, DIM.krampus.w, DIM.krampus.h)],
      ["sled", ent("walker", SKIN.sled, DIM.sled.w, DIM.sled.h)],
      ["elf", ent("walker", SKIN.elf, DIM.elf.w, DIM.elf.h, { p: { tRel: 0.5 } })],
      ["snowball", ent("projectile", SKIN.ball, DIM.ball.w, DIM.ball.h, { p: { tRel: 0 } })],
      ["sled-ride", ent("platform", SKIN.sledRide, DIM.sledRide.w, 16, { y: 590 - 160 })],
      ["coin", ent("pickup", "coin", 30, 30, { pickup: "coin" })],
      ["gem", ent("pickup", "gem", 30, 30, { pickup: "gem" })],
    ];
    for (const [name, e] of cases) {
      const before = stats.images;
      expect(drawWinterSkin(g, env, e, 300, e.y, view), name).toBe(true);
      // Schatten + Sprite (Ersatzbild) → mindestens zwei drawImage-Aufrufe je Skin
      expect(stats.images - before, name).toBeGreaterThanOrEqual(2);
    }
    expect(stats.bad).toEqual([]);
    expect(stats.saves).toBe(stats.restores);
    // Vorab-Backen kostet nichts Unerwartetes
    expect(() => warmFallbacks(env)).not.toThrow();
  });
});

describe("Christkindlmarkt – Laden", () => {
  it("load() wartet auf assets.props.preload (kein Lauf mit halb geladenen Props)", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const preload = vi.fn(() => gate);
    const assets: AssetLoader = { image: async () => null, props: { ...NO_PROPS, preload } };
    const r = new WinterRenderer();
    let done = false;
    const p = r.load(assets).then(() => {
      done = true;
    });
    await new Promise((res) => setTimeout(res, 20));
    expect(preload).toHaveBeenCalledWith(WINTER_PROPS);
    expect(done).toBe(false);
    release();
    await p;
    expect(done).toBe(true);
  });

  it("load() bleibt fehlertolerant, wenn preload scheitert (Ersatzbilder statt Abbruch)", async () => {
    const assets: AssetLoader = { image: async () => null, props: { ...NO_PROPS, preload: async () => Promise.reject(new Error("Netz")) } };
    await expect(new WinterRenderer().load(assets)).resolves.toBeUndefined();
  });
});
