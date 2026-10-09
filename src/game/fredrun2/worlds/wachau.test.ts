import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXED_DT, METERS_PER_DIFFICULTY, PLAYER_SX } from "../constants";
import { Bot } from "../bot";
import { createPatternCtx } from "../patterns";
import { Rng } from "../rng";
import { Sim } from "../sim";
import type { EntSpec, PatternDef, PropLibrary, SpriteOpts } from "../types";
import { WORLDS } from "./index";
import { auditPatterns, botRuns } from "./shared-b/audit";
import { WORLD_WACHAU } from "./wachau";
import { LANDMARK_IDS, buildLandmark, type LandmarkSpec } from "./wachau/landmarks";
import { landT } from "./wachau/patterns";
import { SPLIT_PX, WACHAU_PROPS, WACHAU_STAGE_METERS, WachauRenderer, skyCache, tintedCache } from "./wachau/renderer";
import { MILKY, STARS, layerTint, tintCanvas, tintMask, tintMul, tintVeil, type Tint } from "./wachau/palette";
import { skyBase, skyCanvas, skyMilky, skyStars } from "./wachau/scenery";
import { primeProp } from "./wachau/propfit";
import { WACHAU_BARREL_SIZES, WACHAU_PRIME_PROPS } from "./wachau/skins";
import type { StageCache } from "./shared-b/layers";
import { paint } from "./shared-b/canvas";
import { assetsOf, installCanvasStub, installRecordingStub, manifestProps, stubView, type RecordingCanvas } from "./shared-b/test-kit";

/** Ein Muster isoliert (ohne Nachbarmuster) vom Bot spielen lassen; Rückgabe = Treffer. */
function playPattern(p: PatternDef, diff: number, seed: number): number {
  const sim = new Sim({ mode: "world", world: "wachau", character: "fred", seed, startMeters: diff * METERS_PER_DIFFICULTY }, WORLDS);
  sim.begin();
  sim.player.hearts = 3;
  sim.ents.length = 0;
  sim.noSpawn = true;
  sim.speed = sim.speedAtDiff(sim.diff);
  const out: EntSpec[] = [];
  const ctx = createPatternCtx({ speed: sim.speedAtDiff(diff), diff, groundY: sim.groundY, ceilY: sim.ceilY, rng: new Rng(seed * 31 + 7), worldId: "wachau", defaultSkin: (k) => k }, out);
  const len = p.build(ctx);
  const origin = sim.dist + PLAYER_SX + 1400 * (0.5 + (seed % 3) * 0.25);
  for (const s of out) sim.spawn(s, origin);
  const bot = new Bot();
  const secs = (origin + len + 1200 - sim.playerWorldX) / sim.speed + 1;
  let hurts = 0;
  for (let i = 0; i < secs / FIXED_DT && sim.phase === "running"; i += 1) {
    sim.step(FIXED_DT, bot.input(sim, FIXED_DT));
    for (const ev of sim.events) if (ev.type === "hurt") hurts += 1;
    sim.events.length = 0;
  }
  return hurts;
}

describe("Welt Wachau", () => {
  it("Metadaten vollständig", () => {
    expect(WORLD_WACHAU.id).toBe("wachau");
    expect(WORLD_WACHAU.stageCount).toBe(5);
    expect(WORLD_WACHAU.stageMeters).toBe(300);
    expect(WORLD_WACHAU.stageNames.length).toBe(WORLD_WACHAU.stageCount);
    expect(WORLD_WACHAU.mechanics.length).toBeLessThanOrEqual(4);
    expect(WORLD_WACHAU.patterns.length).toBeGreaterThanOrEqual(18);
    const ids = new Set(WORLD_WACHAU.patterns.map((p) => p.id));
    expect(ids.size).toBe(WORLD_WACHAU.patterns.length);
    // Setpieces vorhanden
    expect(ids.has("wa-donauueberfahrt")).toBe(true);
    expect(ids.has("wa-weinberg-treppe")).toBe(true);
    // Schwierigkeitsverteilung
    const easy = WORLD_WACHAU.patterns.filter((p) => p.minDiff <= 1.5).length;
    const hard = WORLD_WACHAU.patterns.filter((p) => p.minDiff >= 5).length;
    expect(easy).toBeGreaterThanOrEqual(3);
    expect(hard).toBeGreaterThanOrEqual(4);
  });

  it("Sprung-Landezeiten plausibel", () => {
    expect(landT(0)).toBeCloseTo(0.8, 2);
    expect(landT(90)).toBeLessThan(0.8);
    expect(landT(-90)).toBeGreaterThan(0.8);
  });

  it("alle Muster bauen regelkonform", () => {
    const issues = auditPatterns(WORLD_WACHAU, { forbid: ["portal"] });
    if (issues.length) console.log(issues.slice(0, 20));
    expect(issues).toEqual([]);
  });

  it("Fass-Markierungen werden zu rollenden Fässern", { timeout: 60_000 }, () => {
    const sim = new Sim({ mode: "world", world: "wachau", character: "fred", seed: 4, startMeters: 800 }, WORLDS);
    sim.begin();
    sim.player.hearts = 99;
    const bot = new Bot();
    let barrels = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 40 / FIXED_DT && sim.phase === "running"; i += 1) {
      sim.step(FIXED_DT, bot.input(sim, FIXED_DT));
      sim.events.length = 0;
      for (const e of sim.ents) {
        if (e.skin === "barrel" && !seen.has(e.id)) {
          seen.add(e.id);
          barrels += 1;
        }
      }
    }
    expect(barrels).toBeGreaterThan(0);
  });

  it("jedes Muster ist isoliert vom Bot lösbar (verschiedene Tempi)", { timeout: 240_000 }, () => {
    const fails: string[] = [];
    for (const p of WORLD_WACHAU.patterns) {
      for (const diff of [p.minDiff, Math.max(p.minDiff, 5), 9]) {
        for (const seed of [1, 2]) if (playPattern(p, diff, seed) > 0) fails.push(`${p.id}@${diff}/s${seed}`);
      }
    }
    if (fails.length) console.log(fails);
    expect(fails).toEqual([]);
  });

  it("Bot übersteht zusätzliche Seeds", { timeout: 180_000 }, () => {
    const runs = botRuns(WORLDS, "wachau", [
      { seed: 3, meters: 0, secs: 40 },
      { seed: 5, meters: 1200, secs: 35 },
      { seed: 9, meters: 2400, secs: 35 },
      { seed: 13, meters: 4000, secs: 30 },
    ]);
    for (const r of runs) if (r.log.length) console.log("wachau", r.seed, r.meters, r.log.join("\n  "));
    for (const r of runs) expect(r.hurts).toBeLessThanOrEqual(2);
  });
});

// --- Weltladen, Stufen-Backen, Aufwärmen, Skalenwechsel (Canvas-Attrappe, ohne DOM) ------------------------------------------

interface WachauInternals {
  staged: StageCache[];
  landmarks: Array<{ lm: { w: number; h: number; staged: StageCache; refl: StageCache } }>;
  warmInit: boolean;
  skins: { baked: number; pixelScale: number; sprite(key: string, make: () => unknown, x: number): unknown; cache: { has(k: string): boolean } };
}

const inner = (r: WachauRenderer): WachauInternals => r as unknown as WachauInternals;

async function loaded(): Promise<{ r: WachauRenderer; stub: ReturnType<typeof installCanvasStub> }> {
  const stub = installCanvasStub();
  const r = new WachauRenderer();
  await r.load(assetsOf(manifestProps()));
  return { r, stub };
}

describe("Wachau – Stufenlänge, Fass-Maße", () => {
  it("WACHAU_STAGE_METERS entspricht der Welt-Definition", () => {
    expect(WACHAU_STAGE_METERS).toBe(WORLD_WACHAU.stageMeters);
  });

  it("alle Fässer der Muster haben einen Durchmesser aus WACHAU_BARREL_SIZES (sonst entstünden sie erst im Lauf)", () => {
    const seen = new Set<number>();
    for (const p of WORLD_WACHAU.patterns) {
      for (let diff = 0.5; diff <= 14; diff += 0.5) {
        for (let seed = 1; seed <= 4; seed += 1) {
          const out: EntSpec[] = [];
          const speed = 470 + (1180 - 470) * (1 - Math.exp(-diff / 3.6));
          p.build(createPatternCtx({ speed, diff, groundY: 590, ceilY: 150, rng: new Rng(seed), worldId: "wachau", defaultSkin: (k) => k }, out));
          for (const e of out) if (e.skin === "barrel-cue") seen.add(Math.round(Math.min(e.w, e.h) / 2) * 2);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(0);
    for (const d of seen) expect(WACHAU_BARREL_SIZES as readonly number[], `Fass ${d}`).toContain(d);
  });
});

describe("Wachau – Weltladen, Stufen-Backen, Aufwärmen, Skalenwechsel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("load backt die Stufen 0 und 1 aller Caches (Ebenen, Himmel, Wahrzeichen)", async () => {
    const { r } = await loaded();
    const list = inner(r).staged;
    expect(list.length).toBeGreaterThanOrEqual(20);
    for (const c of list) {
      expect(c.has(0)).toBe(true);
      expect(c.has(1)).toBe(true);
      expect(c.has(2)).toBe(false);
    }
  });

  it("die Folgestufe wird erst ab ~28 % der Stufe und höchstens ein Cache je ~6 Frames gebacken", async () => {
    const { r } = await loaded();
    const list = inner(r).staged;
    let clock = 5000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const at = (progress: number): void => r.update(1 / 60, stubView({ stage: 1, worldMeters: 300 + progress * 300 }));
    at(0.02);
    at(0.25);
    expect(list.filter((c) => c.has(2)).length).toBe(0);
    at(0.3);
    expect(list.filter((c) => c.has(2)).length).toBe(1);
    at(0.31);
    expect(list.filter((c) => c.has(2)).length).toBe(1); // Lücke
    // große Ebenen backen in mehreren Schritten (je ein Schritt je Runde): höchstens 3 Runden je Cache
    for (let k = 0; k < list.length * 3 + 2; k += 1) {
      clock += 120;
      at(Math.min(0.99, 0.35 + k * 0.01));
    }
    expect(list.every((c) => c.has(2))).toBe(true);
  });

  it("Qualität 0: Folgestufe erst ab ~60 % der Stufe, und warm backt sie nicht im Leerlauf vor", async () => {
    const { r } = await loaded();
    const list = inner(r).staged;
    let clock = 5000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const at = (progress: number): void => r.update(1 / 60, stubView({ stage: 1, quality: 0, worldMeters: 300 + progress * 300 }));
    at(0.02);
    at(0.3);
    clock += 120;
    at(0.5);
    expect(list.filter((c) => c.has(2)).length).toBe(0);
    let rounds = 0;
    while (!r.warm(3) && rounds < 500) rounds += 1;
    expect(list.filter((c) => c.has(2)).length).toBe(0); // Leerlauf backt nur die aktuelle Stufe
    clock += 120;
    at(0.62);
    expect(list.filter((c) => c.has(2)).length).toBe(1);
  });

  it("beginnt die Überblendung, obwohl die Folgestufe fehlt, wird sie sofort nachgeholt", async () => {
    const { r } = await loaded();
    const list = inner(r).staged;
    r.update(1 / 60, stubView({ stage: 1, worldMeters: 300 + 5, stageBlend: 0 }));
    expect(list.some((c) => c.has(2))).toBe(false);
    r.update(1 / 60, stubView({ stage: 1, worldMeters: 300 + 20, stageBlend: 0.2 }));
    expect(list.every((c) => c.has(2))).toBe(true);
  });

  it("warm backt Stufen-Varianten (aktuelle + Folgestufe) und die Sprites mit festem Maß in Zeitscheiben; danach ist nichts mehr zu tun", async () => {
    const { r, stub } = await loaded();
    r.update(1 / 60, stubView({ stage: 1, worldMeters: 310 }));
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += 1));
    let rounds = 0;
    while (!r.warm(3) && rounds < 500) rounds += 1;
    expect(rounds).toBeLessThan(500);
    expect(rounds).toBeGreaterThanOrEqual(2); // mehrere Aufrufe, nicht am Stück
    const done = stub.created;
    expect(r.warm(3)).toBe(true);
    expect(stub.created).toBe(done);
    for (const d of WACHAU_BARREL_SIZES) {
      for (const k of [`barrel:${d}`, `barrel:${d}|sh`, `barrel:${d}|b`, `barrel:${d}|b|rim`]) expect(inner(r).skins.cache.has(k), k).toBe(true);
    }
    for (const c of inner(r).staged) expect(c.has(2)).toBe(true);
  });

  it("warm vor dem Laden hat nichts zu tun", () => {
    installCanvasStub();
    expect(new WachauRenderer().warm(3)).toBe(true);
  });

  it("ein ganzer Lauf durch alle 5 Stufen legt keine neuen großen Flächen an (verworfene Stufenflächen werden wiederverwendet)", async () => {
    const { r, stub } = await loaded();
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const base = stub.canvases.length;
    for (let st = 0; st <= 4; st += 1) {
      for (let p = 0; p < 1; p += 0.05) {
        clock += 120;
        r.update(1 / 60, stubView({ stage: st, stageBlend: st < 4 && p > 0.75 ? (p - 0.75) * 4 : 0, worldMeters: st * 300 + p * 300 }));
      }
    }
    const big = stub.canvases.slice(base).filter((c) => c.width * c.height >= 150_000);
    expect(big.map((c) => `${c.width}x${c.height}`)).toEqual([]);
    expect(inner(r).staged.every((c) => c.has(4))).toBe(true);
  });

  it("Qualität 0: verworfene Stufenflächen werden nicht aufgehoben (Speicher)", async () => {
    const { r } = await loaded();
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const spare = (c: StageCache): unknown => (c as unknown as { spare: unknown }).spare;
    for (let st = 0; st <= 2; st += 1) {
      for (let p = 0; p < 1; p += 0.1) {
        clock += 120;
        r.update(1 / 60, stubView({ stage: st, quality: 0, stageBlend: p > 0.75 ? (p - 0.75) * 4 : 0, worldMeters: st * 300 + p * 300 }));
      }
    }
    expect(inner(r).staged.every((c) => spare(c) === null)).toBe(true);
  });

  it("Sprite außerhalb des Bildes: höchstens ein Bake je Frame, sichtbare Sprites immer sofort", async () => {
    const { r, stub } = await loaded();
    const sk = inner(r).skins;
    const mk = (): HTMLCanvasElement => document.createElement("canvas");
    r.update(1 / 60, stubView()); // neuer Frame
    const a = sk.sprite("t:a", mk, 1400);
    expect(a).not.toBeNull();
    const n = stub.created;
    expect(sk.sprite("t:b", mk, 1400)).toBeNull(); // wartet
    expect(sk.sprite("t:c", mk, 1280)).toBeNull(); // wartet (knapp außerhalb)
    expect(stub.created).toBe(n);
    expect(sk.sprite("t:d", mk, 1279)).not.toBeNull(); // sichtbar → sofort
    expect(sk.sprite("t:a", mk, 1400)).toBe(a); // Treffer kostet nichts
    r.update(1 / 60, stubView()); // nächster Frame
    expect(sk.sprite("t:b", mk, 1400)).not.toBeNull();
  });

  it("resize ist idempotent; nur eine echte Änderung verwirft die Sprites und stellt das Vorbacken wieder in die Warteschlange", async () => {
    const { r, stub } = await loaded();
    while (!r.warm(50)) {
      /* aufwärmen */
    }
    const sk = inner(r).skins;
    expect(sk.cache.has("barrel:70")).toBe(true);
    const created = stub.created;
    r.resize(1);
    r.resize(1);
    r.resize(1.1);
    r.resize(1.19);
    expect(sk.pixelScale).toBe(1);
    expect(sk.cache.has("barrel:70")).toBe(true);
    expect(stub.created).toBe(created);
    r.resize(1.5);
    expect(sk.pixelScale).toBe(1.5);
    expect(sk.cache.has("barrel:70")).toBe(false); // verworfen
    r.resize(1.5);
    r.resize(1.45);
    expect(sk.pixelScale).toBe(1.5);
    while (!r.warm(50)) {
      /* erneut */
    }
    expect(sk.cache.has("barrel:70")).toBe(true);
    const rebuilt = stub.created - created;
    expect(rebuilt).toBeGreaterThan(0);
    r.resize(1.5); // nochmals dieselbe Skala: nichts Neues
    expect(r.warm(50)).toBe(true);
    expect(stub.created - created).toBe(rebuilt);
  });

  it("resize vor dem Laden merkt sich die Skala", async () => {
    installCanvasStub();
    const r = new WachauRenderer();
    r.resize(2);
    await r.load(assetsOf(manifestProps()));
    expect(inner(r).skins.pixelScale).toBe(2);
  });
});

describe("Wachau – Wahrzeichen-Bakes ohne Zwischenflächen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** nachts angestrahlt (flood · LIGHTS · 0,3 ≥ 0,03 ab Stufe 2) */
  const spec: LandmarkSpec = { id: "landmark-abbey", h: 226, fade: 0.3, haze: 0.4, flood: 1 };

  it("Stufen-Bake: Nacht-Variante legt nur Ergebnis und Lichtmaske an, danach mit Ersatz- und Arbeitsfläche nichts mehr", () => {
    const stub = installCanvasStub();
    const lm = buildLandmark(spec, null);
    lm.staged.get(0);
    lm.staged.get(1);
    const n0 = stub.created;
    lm.staged.get(2); // noch keine Ersatzfläche, keine Arbeitsfläche
    expect(stub.created - n0).toBe(2);
    lm.staged.keep(2, 3); // Stufe 0 und 1 fallen weg → Ersatzfläche
    const n1 = stub.created;
    lm.staged.get(3);
    expect(stub.created).toBe(n1);
    lm.staged.keep(3, 4);
    lm.staged.get(4);
    expect(stub.created).toBe(n1);
  });

  it("Spiegelung: das Rohbild entsteht auf einer Arbeitsfläche, mit Ersatzfläche entsteht nichts Neues", () => {
    const stub = installCanvasStub();
    const lm = buildLandmark(spec, null);
    for (const s of [0, 1, 2, 3, 4]) lm.staged.get(s);
    lm.refl.get(1);
    const n0 = stub.created;
    lm.refl.get(2); // Ergebnis neu (keine Ersatzfläche), Rohbild auf der Arbeitsfläche
    expect(stub.created - n0).toBe(1);
    lm.refl.keep(2, 3); // Stufe 1 fällt weg → Ersatzfläche
    const n1 = stub.created;
    lm.refl.get(3);
    expect(stub.created).toBe(n1);
  });

  it("warmWork legt die Arbeitsflächen einmal an; dropWork gibt sie frei", () => {
    const stub = installCanvasStub();
    const lm = buildLandmark(spec, null);
    lm.staged.get(0);
    const n0 = stub.created;
    lm.warmWork();
    expect(stub.created - n0).toBe(2); // Lichtmaske + Spiegel-Rohbild
    lm.warmWork();
    expect(stub.created - n0).toBe(2);
    const n1 = stub.created;
    lm.staged.get(2); // nur noch das Ergebnis
    expect(stub.created - n1).toBe(1);
    lm.dropWork();
    const n2 = stub.created;
    lm.staged.keep(2, 3);
    lm.staged.get(3); // Ersatzfläche vorhanden, die Lichtmaske entsteht neu
    expect(stub.created - n2).toBe(1);
  });

  it("Wahrzeichen ohne nächtliche Anstrahlung (Tag-Stufen) brauchen keine Lichtmaske", () => {
    const stub = installCanvasStub();
    const lm = buildLandmark({ ...spec, flood: 0.01 }, null);
    lm.staged.get(0);
    const n0 = stub.created;
    lm.warmWork();
    expect(stub.created - n0).toBe(1); // nur das Spiegel-Rohbild
  });

  it("warm legt die Arbeitsflächen aller Wahrzeichen an; auf Qualität 0 nicht (dort werden sie bei jedem Frame freigegeben)", async () => {
    const spied = async (quality: 0 | 2): Promise<{ warms: number[]; drops: number[] }> => {
      const { r } = await loaded();
      const lms = inner(r).landmarks.map((l) => l.lm as unknown as { warmWork(): void; dropWork(): void });
      expect(lms.length).toBe(5);
      const warms = lms.map((l) => vi.spyOn(l, "warmWork"));
      const drops = lms.map((l) => vi.spyOn(l, "dropWork"));
      r.update(1 / 60, stubView({ stage: 1, quality, worldMeters: 310 }));
      let rounds = 0;
      while (!r.warm(50) && rounds < 500) rounds += 1;
      return { warms: warms.map((w) => w.mock.calls.length), drops: drops.map((d) => d.mock.calls.length) };
    };
    const hi = await spied(2);
    expect(hi.warms).toEqual([1, 1, 1, 1, 1]);
    expect(hi.drops).toEqual([0, 0, 0, 0, 0]);
    const lo = await spied(0);
    expect(lo.warms).toEqual([0, 0, 0, 0, 0]);
    expect(lo.drops.every((n) => n >= 1)).toBe(true);
  });
});

// --- Tönung großer Ebenen in Schritten ------------------------------------------------------------------------------------

/** Die bisherige Tönung in einem Zug (Vorlage, gegen die `tintCanvas` und die Teilschritte dieselben Zeichenbefehle ergeben müssen) */
function referenceTint(src: HTMLCanvasElement, t: Tint, flipY: boolean, reuse?: HTMLCanvasElement | null): HTMLCanvasElement {
  const wa = (hex: string, a: number): string => {
    const n = parseInt(hex.replace("#", ""), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  };
  return paint(
    src.width,
    src.height,
    (g, w, h) => {
      if (flipY) {
        g.translate(0, h);
        g.scale(1, -1);
      }
      g.drawImage(src, 0, 0);
      g.setTransform(1, 0, 0, 1, 0, 0);
      if (t.mul && t.mul.toLowerCase() !== "#ffffff") {
        g.globalCompositeOperation = "multiply";
        g.fillStyle = t.mul;
        g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = "destination-in";
        if (flipY) {
          g.translate(0, h);
          g.scale(1, -1);
        }
        g.drawImage(src, 0, 0);
        g.setTransform(1, 0, 0, 1, 0, 0);
      }
      g.globalCompositeOperation = "source-atop";
      if (t.flat && t.flat.a > 0.001) {
        g.globalAlpha = Math.min(1, t.flat.a);
        g.fillStyle = t.flat.color;
        g.fillRect(0, 0, w, h);
        g.globalAlpha = 1;
      }
      if (t.haze && (t.haze.aTop > 0.001 || t.haze.aBottom > 0.001)) {
        const grd = g.createLinearGradient(0, 0, 0, h);
        grd.addColorStop(0, wa(t.haze.color, t.haze.aTop));
        grd.addColorStop(1, wa(t.haze.color, t.haze.aBottom));
        g.fillStyle = grd;
        g.fillRect(0, 0, w, h);
      }
      if (t.shade && t.shade.a > 0.001) {
        const y0 = h * t.shade.from;
        const grd = g.createLinearGradient(0, y0, 0, h);
        grd.addColorStop(0, wa(t.shade.color, 0));
        grd.addColorStop(1, wa(t.shade.color, t.shade.a));
        g.fillStyle = grd;
        g.fillRect(0, y0, w, h - y0);
      }
    },
    reuse,
  );
}

const logOf = (c: HTMLCanvasElement): string[] => (c as unknown as RecordingCanvas).log;

describe("Wachau – Tönung in Teilschritten (tintMul · tintMask · tintVeil)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const tints: Array<[string, Tint]> = [
    ["Licht + Dunst + Schatten", layerTint(2, 0.36, 0.5, 0.2)],
    ["Licht + flache Farbe (Spiegelung)", { mul: "#e0c8a0", flat: { color: "#406080", a: 0.25 } }],
    ["nur Dunst (Licht weiß)", { mul: "#ffffff", haze: { color: "#aabbcc", aTop: 0.1, aBottom: 0.4 } }],
    ["nur Licht", { mul: "#c0d0ff" }],
    ["leer", {}],
  ];

  for (const flipY of [false, true]) {
    for (const [name, t] of tints) {
      it(`${name}${flipY ? " (gespiegelt)" : ""}: tintCanvas und die drei Teilschritte malen dieselben Befehle wie die bisherige Tönung am Stück`, () => {
        const rec = installRecordingStub();
        const src = paint(40, 24, () => undefined);
        const ref = referenceTint(src, t, flipY);
        const whole = tintCanvas(src, t, flipY);
        const parts = tintMul(src, t, flipY);
        tintMask(parts, src, t, flipY);
        tintVeil(parts, t);
        expect(rec.canvases).toHaveLength(4);
        expect(logOf(whole)).toEqual(logOf(ref));
        expect(logOf(parts)).toEqual(logOf(ref));
      });
    }
  }

  it("tintMask und tintVeil melden, ob sie etwas getan haben (sonst bräuchte der Schritt kein Zeitfenster)", () => {
    installRecordingStub();
    const src = paint(8, 8, () => undefined);
    const c = tintMul(src, {});
    expect(tintMask(c, src, {})).toBe(false);
    expect(tintMask(c, src, { mul: "#ffffff" })).toBe(false);
    expect(tintMask(c, src, { mul: "#ffeedd" })).toBe(true);
    expect(tintVeil(c, {})).toBe(false);
    expect(tintVeil(c, { flat: { color: "#000", a: 0 } })).toBe(false);
    expect(tintVeil(c, { shade: { color: "#000", a: 0.3, from: 0.5 } })).toBe(true);
  });
});

describe("Wachau – Stufen-Cache großer Ebenen (tintedCache)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const tint = (s: number): Tint => layerTint(s, 0.36, 0.5, 0.2);

  it("eine große Ebene entsteht in drei Schritten und ergibt dieselben Befehle wie der Direktweg", () => {
    const rec = installRecordingStub();
    const src = paint(1000, Math.ceil(SPLIT_PX / 1000), () => undefined);
    const cache = tintedCache(src, tint);
    let steps = 0;
    while (!cache.has(2)) {
      expect(cache.step(2)).toBe(true);
      steps += 1;
      expect(steps).toBeLessThan(10);
    }
    expect(steps).toBe(3);
    expect(cache.step(2)).toBe(false);
    const stepped = rec.canvases[1];
    const direct = tintedCache(src, tint).get(2);
    expect(logOf(stepped as unknown as HTMLCanvasElement)).toEqual(logOf(direct));
    expect(logOf(direct).length).toBeGreaterThan(10);
  });

  it("Stufen ohne Lichtfarbe (weiß) lassen den Alpha-Schritt aus: zwei statt drei Schritte, gleiches Bild", () => {
    const rec = installRecordingStub();
    const src = paint(1000, Math.ceil(SPLIT_PX / 1000), () => undefined);
    const plain = (): Tint => ({ mul: "#ffffff", haze: { color: "#223344", aTop: 0.1, aBottom: 0.3 } });
    const cache = tintedCache(src, plain);
    let steps = 0;
    while (!cache.has(0)) {
      cache.step(0);
      steps += 1;
    }
    expect(steps).toBe(2);
    expect(logOf(rec.canvases[1] as unknown as HTMLCanvasElement)).toEqual(logOf(tintedCache(src, plain).get(0)));
  });

  it("eine kleine Ebene bleibt bei einem Schritt", () => {
    installRecordingStub();
    const src = paint(400, 100, () => undefined);
    expect(400 * 100).toBeLessThan(SPLIT_PX);
    const cache = tintedCache(src, tint);
    expect(cache.step(1)).toBe(true);
    expect(cache.has(1)).toBe(true);
    expect(cache.step(1)).toBe(false);
  });

  it("jeder Schritt rastert die Fläche (touchCanvas), und die Ersatzfläche der verworfenen Stufe wird wiederverwendet", () => {
    const stub = installCanvasStub();
    const src = paint(1000, Math.ceil(SPLIT_PX / 1000), () => undefined);
    const cache = tintedCache(src, tint);
    while (!cache.has(0)) cache.step(0);
    while (!cache.has(1)) cache.step(1);
    cache.keep(1, 2); // Stufe 0 fällt weg → Ersatzfläche
    const n = stub.created;
    while (!cache.has(2)) cache.step(2);
    expect(stub.created).toBe(n); // keine neue Fläche
  });

  it("im Renderer backen Höhenzug, Bank und Nahes Ufer in mehreren Schritten, die kleinen Ebenen in einem", async () => {
    const { r } = await loaded();
    const i = r as unknown as Record<string, { staged: StageCache } | undefined>;
    const stepsFor = (L: { staged: StageCache } | undefined, stage: number): number => {
      let n = 0;
      while (L && !L.staged.has(stage) && n < 10) {
        L.staged.step(stage);
        n += 1;
      }
      return n;
    };
    for (const big of ["ridge", "bank", "near"]) expect(stepsFor(i[big], 2), big).toBeGreaterThanOrEqual(2);
    for (const small of ["ground", "garland", "grass"]) expect(stepsFor(i[small], 2), small).toBe(1);
  });
});

describe("Wachau – Himmel in Teilschritten (skyBase · skyMilky · skyStars)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const count = (c: HTMLCanvasElement, name: string): number => logOf(c).filter((l) => l.startsWith(name + "(")).length;

  it("skyMilky und skyStars melden, ob die Stufe sie hat (nur die Nacht-Stufen); sonst bleibt die Fläche unberührt", () => {
    installRecordingStub();
    for (let stage = 0; stage < MILKY.length; stage += 1) {
      const c = skyBase(stage, 1280, 452);
      const before = logOf(c).length;
      expect(skyMilky(c, stage), `Milchstraße Stufe ${stage}`).toBe(MILKY[stage] > 0.01);
      expect(skyStars(c, stage), `Sterne Stufe ${stage}`).toBe(STARS[stage] > 0.01);
      if (MILKY[stage] <= 0.01 && STARS[stage] <= 0.01) expect(logOf(c)).toHaveLength(before);
    }
  });

  it("die drei Teile malen dieselben Befehle wie der Himmel am Stück, in jeder Stufe", () => {
    for (let stage = 0; stage < MILKY.length; stage += 1) {
      const rec = installRecordingStub();
      const whole = skyCanvas(stage, 1280, 452);
      const parts = skyBase(stage, 1280, 452);
      skyMilky(parts, stage);
      skyStars(parts, stage);
      expect(rec.canvases).toHaveLength(2);
      expect(logOf(parts), `Stufe ${stage}`).toEqual(logOf(whole));
      expect(logOf(whole).length).toBeGreaterThan(5);
    }
  });

  it("der Stufen-Cache backt Nacht-Stufen in drei Schritten (Verlauf · Milchstraße · Sterne), Tag-Stufen in einem, mit demselben Bild wie der Direktweg", () => {
    for (let stage = 0; stage < MILKY.length; stage += 1) {
      const rec = installRecordingStub();
      const cache = skyCache();
      const night = MILKY[stage] > 0.01 && STARS[stage] > 0.01;
      const snaps: Array<{ radial: number; arcs: number; rects: number }> = [];
      let steps = 0;
      while (!cache.has(stage)) {
        expect(cache.step(stage)).toBe(true);
        steps += 1;
        const c = rec.canvases[0] as unknown as HTMLCanvasElement;
        snaps.push({ radial: count(c, "createRadialGradient"), arcs: count(c, "arc"), rects: count(c, "fillRect") });
        expect(steps).toBeLessThan(6);
      }
      expect(steps, `Stufe ${stage}`).toBe(night ? 3 : 1);
      expect(cache.step(stage)).toBe(false);
      if (night) {
        // Schritt 1: nur Verlauf und Glühen · Schritt 2: Milchstraße (viele Füllungen, noch keine Kreise) · Schritt 3: Sterne
        expect(snaps[0].rects).toBeLessThan(10);
        expect(snaps[0].arcs).toBe(0);
        expect(snaps[1].rects).toBeGreaterThan(900);
        expect(snaps[1].arcs).toBe(0);
        expect(snaps[2].arcs).toBe(340);
      }
      const stepped = rec.canvases[0] as unknown as HTMLCanvasElement;
      const direct = skyCache().get(stage);
      expect(logOf(stepped), `Stufe ${stage}`).toEqual(logOf(direct));
    }
  });

  it("ein unfertiger Himmel lebt nur so lange wie seine Stufe: keep und clear verwerfen ihn, seine Fläche dient dem nächsten Bake als Ersatz", () => {
    const stub = installCanvasStub();
    const cache = skyCache();
    cache.step(4); // Verlauf der Stufe 4 steht, Milchstraße und Sterne fehlen noch
    expect(cache.has(4)).toBe(false);
    const n = stub.created;
    cache.keep(2, 3); // Stufe 4 gehört nicht mehr dazu
    while (!cache.has(3)) cache.step(3);
    expect(stub.created).toBe(n); // kein Rohbild in falscher Stufe fortgesetzt, keine neue Fläche
    cache.step(4);
    cache.clear(); // z. B. Skalenwechsel: auch der unfertige Himmel gehört zur alten Größe
    expect(cache.has(3)).toBe(false);
    const m = stub.created;
    while (!cache.has(4)) cache.step(4);
    expect(stub.created).toBe(m);
  });

  it("im Renderer backt der Himmel die Nacht-Stufe in mehreren Schritten", async () => {
    const { r } = await loaded();
    const sky = (r as unknown as { sky: StageCache }).sky;
    let n = 0;
    while (!sky.has(3) && n < 10) {
      sky.step(3);
      n += 1;
    }
    expect(n).toBe(3);
  });
});

// --- Erstkosten der Prop-Bilder (Dekodieren, Mip-Kette) im Leerlauf bzw. in eigenen Ladeschritten ------------------------------

interface DrawCall {
  id: string;
  o: SpriteOpts | undefined;
  /** Stand des Zählers `stamp` beim Aufruf (hier: Anzahl der Bauschritte) */
  at: number;
}

/** Prop-Bibliothek nach Manifest, die jeden `draw`-Aufruf mit Prop-ID, Optionen und Zählerstand merkt */
function spyProps(stamp: () => number = () => 0): { props: PropLibrary; calls: DrawCall[] } {
  const calls: DrawCall[] = [];
  const base = manifestProps();
  return {
    props: {
      ...base,
      draw: (_g, id, _x, _y, o) => {
        calls.push({ id, o, at: stamp() });
        return true;
      },
    },
    calls,
  };
}

/** Kantenlänge des winzigen Aufwärm-Draws (`primeProp`) */
const isPrime = (c: DrawCall): boolean => c.o?.w === 8;

describe("Wachau – Erstkosten der Prop-Bilder", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("WACHAU_PRIME_PROPS nennt genau die Props, die die Skins verkleinert backen (Fass, Kisten, Mauer, Fass-/Kistenstapel, Ast, Ranken)", () => {
    const src = readFileSync("src/game/fredrun2/worlds/wachau/skins.ts", "utf8");
    // Streifen (Marille, Traube) und der Schwarm werden beim Aufwärmen bzw. direkt gezeichnet, das Floß steht in der Uferkachel
    const elsewhere = new Set(["raft", "bee-swarm", "apricot", "grape-bunch"]);
    const landmarks = new Set<string>(LANDMARK_IDS);
    const used = WACHAU_PROPS.filter((id) => !landmarks.has(id) && !elsewhere.has(id) && src.includes(`"${id}"`));
    expect([...WACHAU_PRIME_PROPS].sort()).toEqual([...used].sort());
  });

  it("warm zahlt die Erstkosten jedes dieser Props genau einmal (winziger Draw), auch nach einem Skalenwechsel nicht erneut", async () => {
    installCanvasStub();
    const { props, calls } = spyProps();
    const r = new WachauRenderer();
    await r.load(assetsOf(props));
    calls.length = 0;
    let rounds = 0;
    while (!r.warm(50) && rounds < 500) rounds += 1;
    expect(rounds).toBeLessThan(500);
    const primes = calls.filter(isPrime);
    expect(primes.map((c) => c.id).sort()).toEqual([...WACHAU_PRIME_PROPS].sort());
    r.resize(1.5); // Sprites verworfen und neu bestellt – die Bilder bleiben aufgewärmt
    rounds = 0;
    while (!r.warm(50) && rounds < 500) rounds += 1;
    expect(calls.filter(isPrime).length).toBe(WACHAU_PRIME_PROPS.length);
  });

  it("warm zahlt die Erstkosten vor dem ersten Bake dieser Props (Fass-Bakes ziehen das Prop wine-barrel erst danach)", async () => {
    installCanvasStub();
    const { props, calls } = spyProps();
    const r = new WachauRenderer();
    await r.load(assetsOf(props));
    calls.length = 0;
    let rounds = 0;
    while (!r.warm(50) && rounds < 500) rounds += 1;
    const first = (id: string, pred: (c: DrawCall) => boolean): number => calls.findIndex((c) => c.id === id && pred(c));
    const prime = first("wine-barrel", isPrime);
    expect(prime).toBeGreaterThanOrEqual(0);
    const real = first("wine-barrel", (c) => !isPrime(c));
    if (real >= 0) expect(prime).toBeLessThan(real);
  });

  it("primeProp ist reine Optimierung: nicht zeichenbare Bilder werfen nicht, unbekannte Props und fehlende Bibliothek tun nichts", () => {
    installCanvasStub();
    const bad: PropLibrary = {
      ...manifestProps(),
      draw: () => {
        throw new Error("kaputtes Bild");
      },
    };
    expect(() => primeProp(bad, "wachau-wall")).not.toThrow();
    const sink = primeProp(bad, "wachau-wall");
    expect(sink).not.toBeNull();
    expect(primeProp(bad, "gibt-es-nicht", sink)).toBe(sink); // Prop unbekannt: Fläche unverändert zurück
    expect(primeProp(null, "wachau-wall")).toBeNull();
    const ok = spyProps();
    const again = primeProp(ok.props, "wachau-wall", sink);
    expect(again).toBe(sink); // Aufwärmfläche wird wiederverwendet
    expect(ok.calls.map((c) => c.id)).toEqual(["wachau-wall"]);
  });

  it("ohne Prop-Bilder (Rückfall) passiert beim Aufwärmen nichts Zusätzliches", async () => {
    installCanvasStub();
    const r = new WachauRenderer();
    const draw = vi.fn(() => false);
    await r.load(assetsOf({ has: () => false, preload: async () => undefined, draw, cell: () => null }));
    let rounds = 0;
    while (!r.warm(50) && rounds < 500) rounds += 1;
    expect(rounds).toBeLessThan(500);
    expect(draw).not.toHaveBeenCalled();
  });

  it("load: jedes Wahrzeichen-Bild wird in einem eigenen, früheren Bauschritt aufgewärmt als sein Bake (Dekodieren und Malen nicht im selben Task)", async () => {
    installCanvasStub();
    let steps = 0;
    const { props, calls } = spyProps(() => steps);
    const r = new WachauRenderer();
    const holder = r as unknown as { stepBuild: () => boolean };
    const orig = holder.stepBuild.bind(r);
    holder.stepBuild = () => {
      steps += 1;
      return orig();
    };
    await r.load(assetsOf(props));
    for (const id of LANDMARK_IDS) {
      const mine = calls.filter((c) => c.id === id);
      const prime = mine.find(isPrime);
      const full = mine.find((c) => c.o?.h !== undefined);
      expect(prime, `${id}: Aufwärm-Draw`).toBeDefined();
      expect(full, `${id}: Bake`).toBeDefined();
      expect(prime?.at, id).toBeLessThan(full?.at ?? 0);
    }
  });
});
