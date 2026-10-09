import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXED_DT, PLAYER_H } from "../constants";
import { createPatternCtx } from "../patterns";
import { Rng } from "../rng";
import { NO_INPUT, Sim } from "../sim";
import type { Ent, EntSpec, PropLibrary, SpriteOpts } from "../types";
import { WORLD_CYBER } from "./cyber";
import { holoFromSource, primeProp } from "./cyber/backdrop";
import { FLIGHT } from "./cyber/patterns";
import { CYBER_RUN_PROPS, CYBER_STAGE_METERS, CyberRenderer, SPLIT_STRIPS, bakedLayer } from "./cyber/renderer";
import { drawHover, makeSkinAssets, makeSkinAssetsSteps, type SkinCtx } from "./cyber/skins";
import { WORLDS } from "./index";
import { auditPatterns, botRuns } from "./shared-b/audit";
import { paint } from "./shared-b/canvas";
import type { StageCache } from "./shared-b/layers";
import { assetsOf, installCanvasStub, installRecordingStub, manifestProps, stubView, type RecordingCanvas } from "./shared-b/test-kit";

const speedAt = (d: number): number => 470 + (1180 - 470) * (1 - Math.exp(-d / 3.6));

function build(id: string, diff: number, seed: number): { specs: EntSpec[]; len: number; speed: number } {
  const p = WORLD_CYBER.patterns.find((x) => x.id === id);
  if (!p) throw new Error(id);
  const specs: EntSpec[] = [];
  const speed = speedAt(diff);
  const ctx = createPatternCtx(
    { speed, diff, groundY: WORLD_CYBER.groundY ?? 600, ceilY: WORLD_CYBER.ceilY ?? 140, rng: new Rng(seed), worldId: "cyber", defaultSkin: (k) => k },
    specs,
  );
  const len = p.build(ctx);
  return { specs, len, speed };
}

describe("Welt Cyber-Wien 2099", () => {
  it("Schwebe-Plattform-Prop ist vorgeladen und im Manifest vorhanden", () => {
    const manifest = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../public/fredrun2/props/manifest.json"), "utf8")) as { props: Record<string, { cw: number; ch: number }> };
    expect(WORLD_CYBER.propIds).toContain("cyber-hover");
    // Skin skaliert auf Plattformbreite und verankert die begehbare Fläche in Zellzeile 17 (512×119)
    expect(manifest.props["cyber-hover"]).toMatchObject({ cw: 512, ch: 119 });
  });

  it("Metadaten vollständig", () => {
    expect(WORLD_CYBER.id).toBe("cyber");
    expect(WORLD_CYBER.gravityFlip).toBe(true);
    expect(WORLD_CYBER.groundY).toBe(600);
    expect(WORLD_CYBER.ceilY).toBe(140);
    expect(WORLD_CYBER.stageCount).toBe(5);
    expect(WORLD_CYBER.stageNames.length).toBe(WORLD_CYBER.stageCount);
    expect(WORLD_CYBER.mechanics.length).toBeLessThanOrEqual(4);
    expect(WORLD_CYBER.patterns.length).toBeGreaterThanOrEqual(18);
    const ids = new Set(WORLD_CYBER.patterns.map((p) => p.id));
    expect(ids.size).toBe(WORLD_CYBER.patterns.length);
    // Setpieces vorhanden
    expect(ids.has("cy-zickzack-schacht")).toBe(true);
    expect(ids.has("cy-serverkorridor")).toBe(true);
  });

  it("alle Muster bauen regelkonform und gravitationsneutral", () => {
    const issues = auditPatterns(WORLD_CYBER, { forbid: ["pit", "overhead"], evenPortals: true });
    if (issues.length) console.log(issues.slice(0, 20));
    expect(issues).toEqual([]);
  });

  it("erste Portale sind gnädig (diff 0.5–1.2): keine Gefahr im Flug, lange Reaktionszeit an der Decke", () => {
    for (const id of ["cy-portal-intro", "cy-portal-hop"]) {
      const p = WORLD_CYBER.patterns.find((x) => x.id === id);
      expect(p && p.minDiff <= 1.2).toBe(true);
      for (let seed = 1; seed <= 8; seed += 1) {
        const diff = p?.minDiff ?? 0;
        const { specs, speed } = build(id, diff, seed);
        const portals = specs.filter((s) => s.kind === "portal").map((s) => s.x + s.w / 2);
        const harmful = specs.filter((s) => s.harmful || s.kind === "zone");
        // Nach jedem Portal mind. Flugzeit + 0.8 s bis zur ersten Gefahr
        for (const px of portals) {
          for (const h of harmful) {
            if (h.x + h.w < px) continue;
            expect((h.x - px) / speed).toBeGreaterThan(FLIGHT + 0.8);
          }
        }
      }
    }
  });

  it("Portale: nach dem Flip bleibt der Flugkorridor frei", () => {
    for (const p of WORLD_CYBER.patterns) {
      for (const diff of [p.minDiff, 6, 11]) {
        if (diff < p.minDiff || (p.maxDiff !== undefined && diff > p.maxDiff)) continue;
        const { specs, speed } = build(p.id, diff, 3);
        const portals = specs.filter((s) => s.kind === "portal").map((s) => s.x + s.w / 2);
        const hazards = specs.filter((s) => s.harmful || (s.kind === "zone" && s.skin !== "decor"));
        for (const px of portals) {
          for (const h of hazards) {
            const hb = h.hb ?? [0, 0, h.w, h.h];
            const t0 = (h.x + hb[0] - px) / speed;
            const t1 = (h.x + hb[0] + hb[2] - px) / speed;
            // Gefahr darf nicht in das Zeitfenster [0, FLIGHT + 0.25] nach dem Portal fallen
            const overlaps = t1 > -0.05 && t0 < FLIGHT + 0.25;
            if (overlaps) console.log(p.id, diff, h.skin, t0.toFixed(2), t1.toFixed(2));
            expect(overlaps).toBe(false);
          }
        }
      }
    }
  });

  it("Spielfeld-Anschlag: Sprung direkt nach dem Portal schleudert die Figur nicht aus dem Feld", () => {
    const sim = new Sim({ mode: "world", world: "cyber", character: "fred", seed: 1 }, WORLDS);
    sim.begin();
    sim.noSpawn = true;
    sim.ents.length = 0;
    const gy = sim.groundY;
    const cy = sim.ceilY;
    sim.spawn({ kind: "portal", skin: "portal", x: 0, y: cy, w: 60, h: gy - cy, harmful: false, hb: [0, 0, 60, gy - cy], p: { dir: 1 } }, sim.playerWorldX + 120);
    let flippedAt = -1;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < Math.round(2.5 / FIXED_DT); i += 1) {
      const p = sim.player;
      if (flippedAt < 0 && p.gravDir === -1) flippedAt = i;
      const after = flippedAt >= 0 ? i - flippedAt : -1;
      const input = after >= 2 && after < 40 ? { ...NO_INPUT, jump: true, jumpPressed: after === 2 } : NO_INPUT;
      sim.step(FIXED_DT, input);
      const feet = sim.feetY();
      const top = sim.player.gravDir === 1 ? feet - PLAYER_H : feet;
      lo = Math.min(lo, top);
      hi = Math.max(hi, top + PLAYER_H);
    }
    expect(flippedAt).toBeGreaterThan(0);
    expect(lo).toBeGreaterThanOrEqual(cy - 1);
    expect(hi).toBeLessThanOrEqual(gy + 1);
    expect(sim.player.gravDir).toBe(-1);
  });

  it("Bot übersteht zusätzliche Seeds", { timeout: 240_000 }, () => {
    const runs = botRuns(WORLDS, "cyber", [
      { seed: 3, meters: 0, secs: 40 },
      { seed: 5, meters: 1200, secs: 35 },
      { seed: 9, meters: 2400, secs: 35 },
      { seed: 13, meters: 4000, secs: 30 },
    ]);
    for (const r of runs) if (r.log.length) console.log("cyber", r.seed, r.meters, r.log.join("\n  "));
    for (const r of runs) expect(r.hurts).toBeLessThanOrEqual(2);
  });
});

// --- Weltladen, Stufen-Backen, Aufwärmen, Skalenwechsel, Blitz-Regler (Canvas-Attrappe, ohne DOM) ----------------------------

interface CyberInternals {
  staged: StageCache[];
  A: ReturnType<typeof makeSkinAssets>;
  dome: { width: number } | null;
  domeFromProp: boolean;
  boltT: number;
  bolt: Float32Array;
  drawBolt(g: CanvasRenderingContext2D, v: ReturnType<typeof stubView>, color: string): void;
  ensureSplit(st: number): boolean;
  skin: { glitch: number };
  splitDone: number;
  splitBuilt: boolean;
  splitStage: number;
  splitR: unknown;
  splitC: unknown;
  splitReady(v: ReturnType<typeof stubView>, st: number): boolean;
  mid: { cache: StageCache };
  rain: HTMLCanvasElement[][];
}

const inner = (r: CyberRenderer): CyberInternals => r as unknown as CyberInternals;

/** Ergänzt die installierte Canvas-Attrappe um `measureText` und `getTransform` (dort ohne Rückgabewert) */
function addTextMeasure(): void {
  const doc = (globalThis as unknown as { document: { createElement: () => { getContext(k: string): CanvasRenderingContext2D } } }).document;
  const make = doc.createElement;
  doc.createElement = () => {
    const c = make();
    const orig = c.getContext.bind(c);
    let wrapped: CanvasRenderingContext2D | null = null;
    c.getContext = (k: string) =>
      (wrapped ??= new Proxy(orig(k), {
        get(t, p) {
          if (p === "measureText") return () => ({ width: 40 });
          if (p === "getTransform") return () => ({ a: 1 });
          return Reflect.get(t, p);
        },
      }));
    return c;
  };
}

/** Canvas-Attrappe der gemeinsamen Test-Hilfen, ergänzt um `measureText` und `getTransform` */
function installStub(): ReturnType<typeof installCanvasStub> {
  const stub = installCanvasStub();
  addTextMeasure();
  return stub;
}

async function loaded(): Promise<{ r: CyberRenderer; stub: ReturnType<typeof installCanvasStub> }> {
  const stub = installStub();
  const r = new CyberRenderer();
  await r.load(assetsOf(manifestProps()));
  return { r, stub };
}

describe("Cyber – Stufenlänge, Weltladen, Stufen-Backen, Aufwärmen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("CYBER_STAGE_METERS entspricht der Welt-Definition", () => {
    expect(CYBER_STAGE_METERS).toBe(WORLD_CYBER.stageMeters);
  });

  it("load backt die Stufen 0 und 1 aller Caches und baut das Hologramm einmal aus dem gemalten Dom", async () => {
    const { r } = await loaded();
    const i = inner(r);
    expect(i.staged.length).toBe(8);
    for (const c of i.staged) {
      expect(c.has(0)).toBe(true);
      expect(c.has(1)).toBe(true);
      expect(c.has(2)).toBe(false);
    }
    expect(i.dome).not.toBeNull();
    expect(i.domeFromProp).toBe(true);
  });

  it("ohne Prop-Bibliothek: prozeduraler Dom", async () => {
    installStub();
    const r = new CyberRenderer();
    await r.load(assetsOf({ has: () => false, preload: async () => undefined, draw: () => false, cell: () => null }));
    expect(inner(r).dome).not.toBeNull();
    expect(inner(r).domeFromProp).toBe(false);
  });

  it("die Folgestufe wird erst ab ~28 % der Stufe und höchstens ein Cache je ~6 Frames gebacken", async () => {
    const { r } = await loaded();
    const list = inner(r).staged;
    let clock = 5000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const at = (progress: number): void => r.update(1 / 60, stubView({ stage: 1, worldMeters: CYBER_STAGE_METERS + progress * CYBER_STAGE_METERS }));
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
    const at = (progress: number): void => r.update(1 / 60, stubView({ stage: 1, quality: 0, worldMeters: CYBER_STAGE_METERS + progress * CYBER_STAGE_METERS }));
    at(0.02);
    at(0.3);
    clock += 120;
    at(0.5);
    expect(list.filter((c) => c.has(2)).length).toBe(0);
    let rounds = 0;
    while (!r.warm(3) && rounds < 500) rounds += 1;
    expect(list.filter((c) => c.has(2)).length).toBe(0);
    clock += 120;
    at(0.62);
    expect(list.filter((c) => c.has(2)).length).toBe(1);
  });

  it("warm backt die Stufen-Varianten in Zeitscheiben; danach ist nichts mehr zu tun; vor dem Laden nichts", async () => {
    installCanvasStub();
    expect(new CyberRenderer().warm(3)).toBe(true);
    vi.unstubAllGlobals();
    const { r, stub } = await loaded();
    r.update(1 / 60, stubView({ stage: 1, worldMeters: CYBER_STAGE_METERS + 10 }));
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += 1));
    let rounds = 0;
    while (!r.warm(3) && rounds < 500) rounds += 1;
    expect(rounds).toBeGreaterThanOrEqual(2);
    expect(rounds).toBeLessThan(500);
    for (const c of inner(r).staged) expect(c.has(2)).toBe(true);
    const done = stub.created;
    expect(r.warm(3)).toBe(true);
    expect(stub.created).toBe(done);
  });

  it("ein ganzer Lauf durch alle 5 Stufen legt keine neuen großen Flächen an (Himmel und Ebenen werden wiederverwendet)", async () => {
    const { r, stub } = await loaded();
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const base = stub.canvases.length;
    for (let st = 0; st <= 4; st += 1) {
      for (let p = 0; p < 1; p += 0.05) {
        clock += 120;
        r.update(1 / 60, stubView({ stage: st, stageBlend: st < 4 && p > 0.75 ? (p - 0.75) * 4 : 0, time: clock / 1000, worldMeters: st * CYBER_STAGE_METERS + p * CYBER_STAGE_METERS }));
      }
    }
    // neu entstehen nur die beiden RGB-Split-Kopien (2048×360, einmal, rechtzeitig vor dem Glitch-Sturm); Himmel, Ebenen,
    // Boden, Decke und Kante werden aus verworfenen Stufenflächen neu gemalt
    const big = stub.canvases.slice(base).filter((c) => c.width * c.height >= 400_000);
    expect(big.map((c) => `${c.width}x${c.height}`)).toEqual(["2048x360", "2048x360"]);
    expect(inner(r).staged.every((c) => c.has(4))).toBe(true);
  });

  it("Boden, Decke und Leuchtkante: nach dem Laden entstehen für spätere Stufen keine neuen Flächen (Wiederverwendung)", async () => {
    const { r, stub } = await loaded();
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const count = (w: number, h: number): number => stub.canvases.filter((c) => c.width === w && c.height === h).length;
    const before = [count(1280, 120), count(1280, 140), count(1280, 30)];
    expect(before).toEqual([2, 2, 2]); // Stufe 0 und 1 aus dem Laden
    for (let st = 0; st <= 4; st += 1) {
      for (let p = 0; p < 1; p += 0.05) {
        clock += 120;
        r.update(1 / 60, stubView({ stage: st, stageBlend: st < 4 && p > 0.75 ? (p - 0.75) * 4 : 0, worldMeters: st * CYBER_STAGE_METERS + p * CYBER_STAGE_METERS }));
      }
    }
    expect([count(1280, 120), count(1280, 140), count(1280, 30)]).toEqual(before);
    expect(inner(r).staged.every((c) => c.has(4))).toBe(true);
  });

  it("RGB-Split-Kopien: höchstens ein Streifen je Aufruf, für dieselbe Stufe nur einmal, über Stufenwechsel dieselben Flächen", async () => {
    const { r, stub } = await loaded();
    const i = inner(r);
    const steps = SPLIT_STRIPS * 2;
    const n = stub.created;
    // erste Kopie (rot): SPLIT_STRIPS Schritte, die Fläche entsteht beim ersten
    for (let k = 1; k <= SPLIT_STRIPS; k += 1) {
      expect(i.ensureSplit(0)).toBe(false);
      expect(i.splitDone).toBe(k);
      expect(i.splitR).not.toBeNull();
      expect(i.splitC).toBeNull();
    }
    expect(stub.created).toBe(n + 1);
    // zweite Kopie (cyan)
    for (let k = SPLIT_STRIPS + 1; k < steps; k += 1) expect(i.ensureSplit(0)).toBe(false);
    expect(i.splitC).not.toBeNull();
    expect(i.ensureSplit(0)).toBe(true);
    expect(i.splitBuilt).toBe(true);
    const m = stub.created;
    expect(m).toBe(n + 2);
    const [rr, cc] = [i.splitR, i.splitC];
    expect(i.ensureSplit(0)).toBe(true);
    expect(stub.created).toBe(m);
    // neue Stufe: wieder von vorn, ein Streifen je Aufruf – aber auf denselben Flächen (keine Neuanlage)
    for (let k = 1; k < steps; k += 1) expect(i.ensureSplit(1)).toBe(false);
    expect(i.ensureSplit(1)).toBe(true);
    expect(i.splitR).toBe(rr);
    expect(i.splitC).toBe(cc);
    expect(stub.created).toBe(m);
  });

  it("RGB-Split-Streifen decken die ganze Fläche genau einmal ab (Farbe, Quelle 1:1) – Ergebnis wie die Kopie am Stück", () => {
    const stub = installRecordingStub();
    const tile = document.createElement("canvas");
    tile.width = 2048;
    tile.height = 360;
    const r = new CyberRenderer();
    const i = inner(r);
    i.mid = { cache: { get: () => tile } as unknown as StageCache }; // nur die Ebene, die der Split braucht
    const before = stub.canvases.length;
    for (let k = 0; k < SPLIT_STRIPS * 2; k += 1) i.ensureSplit(0);
    const fresh = stub.canvases.slice(before);
    expect(fresh.length).toBe(2);
    for (const [c, color] of [
      [fresh[0], "#ff2050"],
      [fresh[1], "#20e8ff"],
    ] as const) {
      expect(c.width).toBe(tile.width);
      expect(c.height).toBe(tile.height);
      const fills = c.log.filter((l) => l.startsWith("fillRect("));
      const copies = c.log.filter((l) => l.startsWith("drawImage("));
      expect(fills.length).toBe(SPLIT_STRIPS);
      expect(copies.length).toBe(SPLIT_STRIPS);
      expect(c.log.filter((l) => l.startsWith("fillStyle=")).every((l) => l === `fillStyle=${color}`)).toBe(true);
      // Streifen lückenlos von oben nach unten, volle Breite
      let y = 0;
      for (const f of fills) {
        const [x0, y0, w, h] = f.slice("fillRect(".length, -1).split(",").map(Number);
        expect([x0, y0, w]).toEqual([0, y, tile.width]);
        y += h;
      }
      expect(y).toBe(tile.height);
      // die Quelle wird 1:1 in denselben Streifen kopiert
      for (const d of copies) {
        const a = d.slice(d.indexOf(",") + 1, -1).split(",").map(Number);
        expect(a.slice(0, 4)).toEqual(a.slice(4, 8));
      }
    }
  });

  it("RGB-Split: einmal gebaut, wird weitergezeichnet, während ein Stufenwechsel sie streifenweise auffrischt", async () => {
    const { r } = await loaded();
    const i = inner(r);
    const v = stubView({ stage: 3, time: 5, worldMeters: 3 * CYBER_STAGE_METERS + 10 });
    for (let k = 0; k < SPLIT_STRIPS * 2; k += 1) i.ensureSplit(3);
    expect(i.splitBuilt).toBe(true);
    expect(i.splitReady(v, 3)).toBe(true);
    // Stufe 4 beginnt die Auffrischung: Schritt für Schritt, die Kopien bleiben zeichenbar (kein Aussetzen des Effekts)
    expect(i.ensureSplit(4)).toBe(false);
    expect(i.splitStage).toBe(4);
    expect(i.splitDone).toBe(1);
    expect(i.splitReady(v, 4)).toBe(true);
    expect(i.splitDone).toBe(1); // das Zeichnen backt dann nichts nach
  });

  it("RGB-Split-Kopien werden vor dem ersten Glitch-Sturm vorbereitet (ab Glitch-Stärke 0,3 der Stufe), nicht auf Qualität 0", async () => {
    const { r, stub } = await loaded();
    const i = inner(r);
    const at = (stage: number, time: number, over: Partial<ReturnType<typeof stubView>> = {}): void =>
      r.update(1 / 60, stubView({ stage, time, worldMeters: stage * CYBER_STAGE_METERS + 80, ...over }));
    const n = stub.created;
    at(1, 0.1);
    at(2, 0.2);
    expect(i.splitR).toBeNull(); // Stufe 2 beginnt mit Glitch-Stärke 0,08: noch zu früh
    at(2, 0.3, { stageBlend: 0.4 }); // 0,08 + 0,92 · 0,4 = 0,45
    expect(i.splitR).not.toBeNull();
    expect(i.splitDone).toBe(1); // höchstens ein Streifen je Aufruf
    at(2, 0.35, { stageBlend: 0.4 });
    expect(i.splitDone).toBe(1); // und höchstens einer je 0,1 s Spielzeit
    at(2, 0.41, { stageBlend: 0.4 });
    expect(i.splitDone).toBe(2);
    expect(i.splitC).toBeNull(); // die cyanfarbene Kopie beginnt erst nach der roten
    for (let k = 0; k < SPLIT_STRIPS * 2; k += 1) at(2, 0.6 + k * 0.2, { stageBlend: 0.4 });
    expect(i.splitC).not.toBeNull();
    expect(i.splitBuilt).toBe(true);
    expect(stub.created).toBeGreaterThan(n);
    // fertig: weitere Aufrufe legen nichts mehr an
    const m = stub.created;
    for (let k = 0; k < 5; k += 1) at(2, 3 + k * 0.2, { stageBlend: 0.4 });
    expect(stub.created).toBe(m);
    // Qualität 0: kein Split, nichts vorbereitet
    const { r: r0 } = await loaded();
    for (let k = 0; k < 6; k += 1) r0.update(1 / 60, stubView({ stage: 3, quality: 0, time: k, worldMeters: 3 * CYBER_STAGE_METERS + 10 }));
    expect(inner(r0).splitR).toBeNull();
  });

  it("RGB-Split: Vorbereitung im Update und Rückfall im Zeichnen machen im selben Frame zusammen höchstens einen Streifen", async () => {
    const { r } = await loaded();
    const i = inner(r);
    const g = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
    const v = stubView({ stage: 3, time: 5, worldMeters: 3 * CYBER_STAGE_METERS + 10 });
    r.update(1 / 60, v); // Vorbereitung: erster Streifen
    expect(i.splitDone).toBe(1);
    i.skin.glitch = 1; // Glitch-Sturm
    r.drawOverlay(g, v); // gleicher Frame (gleiche Spielzeit): kein zweiter Streifen
    expect(i.splitDone).toBe(1);
    r.drawOverlay(g, stubView({ ...v, time: 5.02 })); // nächster Frame: der Rückfall im Zeichnen backt den nächsten Streifen
    expect(i.splitDone).toBe(2);
    expect(i.splitBuilt).toBe(false); // bis zur ersten vollständigen Kopie wird nichts gezeichnet
    for (let k = 0; k < SPLIT_STRIPS * 2; k += 1) r.drawOverlay(g, stubView({ ...v, time: 5.1 + k * 0.02 }));
    expect(i.splitBuilt).toBe(true);
    expect(i.splitC).not.toBeNull();
  });

  it("holoFromSource: Pixel nicht lesbar → Quelle unverändert (kein Absturz)", () => {
    installCanvasStub();
    const src = document.createElement("canvas");
    src.width = 8;
    src.height = 8;
    expect(holoFromSource(src, "#22e0ff", "#9a5bff")).toBe(src);
  });
});

describe("Cyber – Schwebe-Plattformen: Bake außerhalb des Bildes, resize", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const ent = (w: number): Ent => ({ w, h: 28, state: "idle", id: 1 }) as unknown as Ent;
  const K: SkinCtx = { beat: 0, time: 0, quality: 0, reduced: true, groundY: 600, ceilY: 140, glitch: 0 };

  it("höchstens ein Bake je Frame, solange die Plattform ganz rechts außerhalb steht; sichtbare sofort", () => {
    const stub = installStub();
    const A = makeSkinAssets();
    A.props = manifestProps();
    const g = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
    const v = stubView();
    drawHover(g, A, ent(190), 1400, 300, v, K);
    expect(A.hover.size).toBe(1);
    const n = stub.created;
    drawHover(g, A, ent(200), 1400, 300, v, K); // gleicher Frame: wartet
    drawHover(g, A, ent(210), 1280, 300, v, K); // knapp außerhalb: wartet
    expect(A.hover.size).toBe(1);
    expect(stub.created).toBe(n);
    drawHover(g, A, ent(220), 1000, 300, v, K); // sichtbar: sofort
    expect(A.hover.size).toBe(2);
    A.baked = 0; // nächster Frame
    drawHover(g, A, ent(200), 1400, 300, v, K);
    expect(A.hover.size).toBe(3);
    const m = stub.created;
    drawHover(g, A, ent(200), 1400, 300, v, K); // Treffer
    expect(stub.created).toBe(m);
  });

  it("resize ist idempotent; nur eine echte Änderung der Dichte gibt die Plattformen frei", async () => {
    const { r } = await loaded();
    const A = inner(r).A;
    A.hover.set("190|1", document.createElement("canvas"));
    r.resize(1);
    r.resize(1.05); // rundet auf 1
    expect(A.hover.size).toBe(1);
    r.resize(2);
    expect(A.hover.size).toBe(0);
    A.hover.set("190|2", document.createElement("canvas"));
    r.resize(2);
    r.resize(1.9); // rundet auf 2
    expect(A.hover.size).toBe(1);
  });
});

describe("Cyber – Blitz-Regler (flashScale) im Glitch-Sturm", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Alle Alpha-Werte, mit denen drawBolt zeichnet (Reihenfolge des Aufzeichnens) und die Füllung des Himmelsaufleuchtens */
  async function boltAlphas(over: Partial<ReturnType<typeof stubView>>): Promise<{ sky: number; glow: number }> {
    const { r } = await loaded();
    const i = inner(r);
    i.boltT = 0.28;
    i.bolt.set([100, 140, 110, 170, 120, 200, 130, 230, 140, 260, 150, 290, 160, 320, 170, 350, 180, 380, 190, 410]);
    const rec = installRecordingStub();
    const c = document.createElement("canvas") as unknown as RecordingCanvas;
    const g = c.getContext("2d") as unknown as CanvasRenderingContext2D;
    i.drawBolt(g, stubView({ stage: 3, time: 1, ...over }), "#22e0ff");
    const log = (rec.canvases[rec.canvases.length - 1] as RecordingCanvas).log;
    const alphas = log.filter((l) => l.startsWith("globalAlpha=")).map((l) => Number(l.slice("globalAlpha=".length)));
    return { sky: alphas[0] ?? 0, glow: alphas[alphas.length - 2] ?? 0 };
  }

  it("ohne Feld und mit flashScale 1: identisch (Standard ändert nichts)", async () => {
    const a = await boltAlphas({});
    const b = await boltAlphas({ flashScale: 1 });
    expect(a.sky).toBeCloseTo(0.07, 9);
    expect(b).toEqual(a);
  });

  it("flashScale 0,3: Himmelsaufleuchten und Blitz höchstens 30 % des Standardwerts", async () => {
    const full = await boltAlphas({});
    const dim = await boltAlphas({ flashScale: 0.3 });
    expect(dim.sky).toBeLessThanOrEqual(full.sky * 0.3 + 1e-9);
    expect(dim.sky).toBeGreaterThan(0);
    expect(dim.glow).toBeLessThanOrEqual(full.glow * 0.3 + 1e-9);
  });

  it("flashScale 0: nichts gezeichnet", async () => {
    const z = await boltAlphas({ flashScale: 0 });
    expect(z.sky).toBe(0);
  });
});

describe("Cyber – Glitch-Balken folgen dem Blitze-Regler (flashScale)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /**
   * Deckkraft der additiven Glitch-Balken (volle Breite) aus `drawForeground` (Farb-Balken) bzw. `drawOverlay` (RGB-Balken der
   * Glitch-Schnitte); gesammelt über mehrere Zeitpunkte, weil die Balken mit 14-16 Hz neu gewürfelt werden.
   */
  async function barAlphas(which: "drawForeground" | "drawOverlay", over: Partial<ReturnType<typeof stubView>>): Promise<number[]> {
    const { r } = await loaded();
    inner(r).skin.glitch = 0.8;
    installRecordingStub();
    const c = document.createElement("canvas") as unknown as RecordingCanvas;
    const g = c.getContext("2d") as unknown as CanvasRenderingContext2D;
    const found: number[] = [];
    for (let t = 0; t < 4 && found.length < 3; t += 0.13) {
      c.log.length = 0;
      r[which](g, stubView({ stage: 3, time: t, ...over }));
      for (let k = 0; k < c.log.length; k += 1) {
        if (!/^fillRect\(-?[\d.]+,[\d.]+,1280,/.test(c.log[k])) continue;
        for (let j = k - 1; j >= 0; j -= 1) {
          if (c.log[j].startsWith("globalAlpha=")) {
            found.push(Number(c.log[j].slice("globalAlpha=".length)));
            break;
          }
        }
      }
    }
    return found;
  }

  for (const which of ["drawForeground", "drawOverlay"] as const) {
    it(`${which}: ohne Feld und mit flashScale 1 die bisherigen Balken, mit 0,3 auf 30 %, mit 0 keine additiven Balken`, async () => {
      const full = await barAlphas(which, {});
      expect(full.length).toBeGreaterThan(0);
      const base = which === "drawForeground" ? 0.18 * 0.8 : 0.16 * 0.8;
      for (const a of full) expect(a).toBeCloseTo(base, 3);
      expect(await barAlphas(which, { flashScale: 1 })).toEqual(full);
      const dim = await barAlphas(which, { flashScale: 0.3 });
      expect(dim.length).toBe(full.length);
      for (const a of dim) expect(a).toBeCloseTo(base * 0.3, 3);
      if (which === "drawForeground") expect(await barAlphas(which, { flashScale: 0 })).toEqual([]);
      else for (const a of await barAlphas(which, { flashScale: 0 })) expect(a).toBe(0);
    });

    it(`${which}: „Weniger Bewegung“ zeichnet keine Balken (unverändert)`, async () => {
      expect(await barAlphas(which, { reducedMotion: true })).toEqual([]);
    });
  }
});

// --- Weltladen und Stufen-Bakes in kleinen Schritten ---------------------------------------------------------------------

describe("Cyber – Stufen-Ebenen in zwei Schritten (bakedLayer)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const logOf = (c: HTMLCanvasElement): string[] => (c as unknown as RecordingCanvas).log;
  const tint = (): { night: { color: string; a: number }; haze: { color: string; aTop: number; aBottom: number }; shade: { color: string; a: number; from: number } } => ({
    night: { color: "#101030", a: 0.5 },
    haze: { color: "#123456", aTop: 0.1, aBottom: 0.3 },
    shade: { color: "#000000", a: 0.4, from: 0.5 },
  });

  it("zwei Schritte (Körper + Tönung | Lichter + Zusatz) ergeben dieselben Zeichenbefehle wie der Direktweg", () => {
    const rec = installRecordingStub();
    const body = paint(64, 32, () => undefined);
    const lights = paint(64, 32, () => undefined);
    const extra = (g: CanvasRenderingContext2D, s: number, w: number, h: number): void => {
      g.fillStyle = `#00000${s}`;
      g.fillRect(0, 0, w, h);
    };
    const L = bakedLayer(body, lights, 0, 1, tint, (s) => 0.4 + s * 0.1, extra);
    expect(L.cache.step(2)).toBe(true);
    expect(L.cache.has(2)).toBe(false); // erst Körper und Tönung
    expect(L.cache.step(2)).toBe(true);
    expect(L.cache.has(2)).toBe(true);
    expect(L.cache.step(2)).toBe(false);
    const stepped = rec.canvases[2]; // Körper, Lichter, dann die Stufenfläche
    const direct = bakedLayer(body, lights, 0, 1, tint, (s) => 0.4 + s * 0.1, extra).cache.get(2);
    expect(logOf(direct)).toEqual(logOf(stepped as unknown as HTMLCanvasElement));
    // Reihenfolge wie bisher: Körper, Tönung, Lichter (additiv, Alpha 0,6), Zusatz
    const log = logOf(direct);
    const iBody = log.findIndex((l) => l.startsWith("drawImage(<canvas 64x32>,0,0)"));
    const iLit = log.indexOf("globalCompositeOperation=lighter");
    const iLights = log.findIndex((l, i) => i > iLit && l.startsWith("drawImage("));
    expect(iBody).toBe(0);
    expect(iLit).toBeGreaterThan(iBody);
    expect(iLights).toBeGreaterThan(iLit);
    expect(log[log.indexOf("globalAlpha=0.6")]).toBe("globalAlpha=0.6");
    expect(log[log.length - 1]).toBe("fillRect(0,0,64,32)");
  });

  it("die Ebenen der geladenen Welt backen jede Stufe in zwei Schritten und legen dabei keine neue Fläche an", async () => {
    const { r, stub } = await loaded();
    const i = inner(r);
    const cache = i.mid.cache;
    cache.keep(1, 2);
    const n = stub.created;
    let steps = 0;
    while (!cache.has(2)) {
      cache.step(2);
      steps += 1;
    }
    expect(steps).toBe(2);
    expect(stub.created).toBe(n); // Ersatzfläche der verworfenen Stufe 0
  });
});

describe("Cyber – Weltladen in kleinen Schritten", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Anzahl `yield` eines Generators bis zum Ende */
  function yields<T>(it: Generator<void, T, void>): { n: number; value: T } {
    let n = 0;
    for (;;) {
      const r = it.next();
      if (r.done) return { n, value: r.value };
      n += 1;
    }
  }

  it("die prozeduralen Sprites entstehen in mindestens 6 Schritten und sind vollständig", () => {
    installStub();
    const { n, value } = yields(makeSkinAssetsSteps());
    expect(n).toBeGreaterThanOrEqual(6);
    const whole = makeSkinAssets();
    expect(Object.keys(value).sort()).toEqual(Object.keys(whole).sort());
    for (const k of ["chip", "coinStrip", "crystal", "portalUp", "portalDown", "colUp", "texCyan", "plasma", "hint", "corridor", "shaft", "cube", "cubeWire", "barrier"] as const) {
      expect(value[k], k).toBeTruthy();
      expect((value[k] as HTMLCanvasElement).width, k).toBe((whole[k] as HTMLCanvasElement).width);
    }
  });

  it("der Datenregen entsteht je Farbe in einem eigenen Schritt (die Schrift laden kostet beim ersten Text viel)", () => {
    installStub();
    const r = new CyberRenderer();
    const fx = (r as unknown as { buildFx(): Generator<void, void, void> }).buildFx();
    const { n } = yields(fx);
    expect(n).toBeGreaterThanOrEqual(6); // Werbe-Symbole + fünf Farben
    expect(inner(r).rain).toHaveLength(5);
    for (const strips of inner(r).rain) expect(strips).toHaveLength(5);
  });

  it("load trennt das Ende des Prop-Ladens vom ersten Bauschritt (eine Pause dazwischen) und backt am Ende beide Stufen", async () => {
    installStub();
    vi.stubGlobal("window", {}); // yieldToMain wartet dann wirklich (MessageChannel) statt sofort zu enden
    const r = new CyberRenderer();
    const i = r as unknown as { stepBuild(): boolean };
    const orig = i.stepBuild.bind(r);
    let builds = 0;
    i.stepBuild = (): boolean => {
      builds += 1;
      return orig();
    };
    const assets = assetsOf(manifestProps());
    vi.spyOn(assets.props, "preload").mockResolvedValue(undefined);
    const p = r.load(assets);
    for (let k = 0; k < 8; k += 1) await Promise.resolve(); // alle Mikroaufgaben nach dem Prop-Laden
    expect(builds).toBe(0);
    await p;
    expect(builds).toBeGreaterThan(7);
    for (const c of inner(r).staged) {
      expect(c.has(0)).toBe(true);
      expect(c.has(1)).toBe(true);
    }
  });
});

// --- Erstkosten der Prop-Bilder (Dekodieren) in eigenen Ladeschritten bzw. im Aufwärmen ------------------------------------------

interface DrawCall {
  id: string;
  o: SpriteOpts | undefined;
  /** Zählerstand (hier: Anzahl der Bauschritte) beim Aufruf */
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

/** winziger Aufwärm-Draw von `primeProp` */
const isPrime = (c: DrawCall): boolean => c.o?.w === 8;

describe("Cyber – Erstkosten der Prop-Bilder", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Renderer laden und dabei die Bauschritte zählen */
  async function loadCounting(): Promise<{ r: CyberRenderer; calls: DrawCall[] }> {
    installStub();
    let steps = 0;
    const { props, calls } = spyProps(() => steps);
    const r = new CyberRenderer();
    const holder = r as unknown as { stepBuild: () => boolean };
    const orig = holder.stepBuild.bind(r);
    holder.stepBuild = () => {
      steps += 1;
      return orig();
    };
    await r.load(assetsOf(props));
    return { r, calls };
  }

  it("load: Stephansdom-Bild, Münzstreifen, Würfel und Rack werden in je einem eigenen, früheren Bauschritt aufgewärmt als ihr Bake", async () => {
    const { calls } = await loadCounting();
    for (const id of ["landmark-cathedral", "data-coin", "glitch-cube", "server-rack"]) {
      const mine = calls.filter((c) => c.id === id);
      const prime = mine.find(isPrime);
      const real = mine.find((c) => !isPrime(c));
      expect(prime, `${id}: Aufwärm-Draw`).toBeDefined();
      expect(real, `${id}: Bake`).toBeDefined();
      expect(prime?.at, id).toBeLessThan(real?.at ?? 0);
    }
    // jedes Bild nur einmal aufgewärmt, und die Aufwärm-Draws liegen in verschiedenen Schritten (nie zwei im selben Task)
    const primes = calls.filter(isPrime);
    expect(new Set(primes.map((c) => c.id)).size).toBe(primes.length);
    expect(new Set(primes.map((c) => c.at)).size).toBe(primes.length);
  });

  it("warm zahlt die Erstkosten der erst im Lauf gezeichneten Props (Drohne, Schwebe-Plattform) einmal; ein zweites Aufwärmen nicht erneut", async () => {
    const { r, calls } = await loadCounting();
    expect(calls.filter(isPrime).some((c) => (CYBER_RUN_PROPS as readonly string[]).includes(c.id))).toBe(false); // nicht schon beim Laden
    let rounds = 0;
    while (!r.warm(50) && rounds < 500) rounds += 1;
    expect(rounds).toBeLessThan(500);
    const after = calls.filter(isPrime).filter((c) => (CYBER_RUN_PROPS as readonly string[]).includes(c.id));
    expect(after.map((c) => c.id).sort()).toEqual([...CYBER_RUN_PROPS].sort());
    const n = calls.filter(isPrime).length;
    expect(r.warm(50)).toBe(true);
    expect(calls.filter(isPrime).length).toBe(n);
  });

  it("primeProp ist reine Optimierung: nicht zeichenbare Bilder werfen nicht, unbekannte Props und fehlende Bibliothek tun nichts", () => {
    installStub();
    const bad: PropLibrary = {
      ...manifestProps(),
      draw: () => {
        throw new Error("kaputtes Bild");
      },
    };
    const sink = primeProp(bad, "landmark-cathedral");
    expect(sink).not.toBeNull();
    expect(primeProp(bad, "gibt-es-nicht", sink)).toBe(sink);
    expect(primeProp(null, "landmark-cathedral")).toBeNull();
    const ok = spyProps();
    expect(primeProp(ok.props, "landmark-cathedral", sink)).toBe(sink);
    expect(ok.calls.map((c) => c.id)).toEqual(["landmark-cathedral"]);
  });

  it("ohne Prop-Bilder (Rückfall) bleibt der Weltaufbau und das Aufwärmen ohne Draw-Aufrufe", async () => {
    installStub();
    const draw = vi.fn(() => false);
    const r = new CyberRenderer();
    await r.load(assetsOf({ has: () => false, preload: async () => undefined, draw, cell: () => null }));
    let rounds = 0;
    while (!r.warm(50) && rounds < 500) rounds += 1;
    expect(rounds).toBeLessThan(500);
    expect(draw).not.toHaveBeenCalled();
  });
});
