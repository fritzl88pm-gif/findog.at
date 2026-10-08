import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXED_DT, METERS_PER_DIFFICULTY, PLAYER_SX } from "../constants";
import { Bot } from "../bot";
import { createPatternCtx } from "../patterns";
import { Rng } from "../rng";
import { Sim } from "../sim";
import type { EntSpec, PatternDef } from "../types";
import { WORLDS } from "./index";
import { auditPatterns, botRuns } from "./shared-b/audit";
import { WORLD_WACHAU } from "./wachau";
import { buildLandmark, type LandmarkSpec } from "./wachau/landmarks";
import { landT } from "./wachau/patterns";
import { WACHAU_STAGE_METERS, WachauRenderer } from "./wachau/renderer";
import { WACHAU_BARREL_SIZES } from "./wachau/skins";
import type { StageCache } from "./shared-b/layers";
import { assetsOf, installCanvasStub, manifestProps, stubView } from "./shared-b/test-kit";

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
    for (let k = 0; k < list.length + 2; k += 1) {
      clock += 120;
      at(0.35 + k * 0.01);
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
