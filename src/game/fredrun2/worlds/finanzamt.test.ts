import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPatternCtx } from "../patterns";
import { Rng } from "../rng";
import type { EntSpec } from "../types";
import { WORLD_FINANZAMT } from "./finanzamt";
import { Chunked } from "./finanzamt/chunked";
import { FA_STAGE_METERS, FinanzamtRenderer } from "./finanzamt/renderer";
import { GlowCache, OFFSCREEN_X, SpriteCache, type BakeBudget } from "./finanzamt/skins";
import { WORLDS } from "./index";
import { auditPatterns, botRuns } from "./shared-b/audit";
import { FAKE_IMAGE, assetsOf, installCanvasStub, manifestProps, stubView } from "./shared-b/test-kit";

function build(id: string, diff: number, seed = 1): EntSpec[] {
  const p = WORLD_FINANZAMT.patterns.find((x) => x.id === id);
  if (!p) throw new Error(`Muster fehlt: ${id}`);
  const out: EntSpec[] = [];
  const speed = 470 + 710 * (1 - Math.exp(-diff / 3.6));
  const ctx = createPatternCtx({ speed, diff, groundY: 590, ceilY: 150, rng: new Rng(seed), worldId: "finanzamt", defaultSkin: (k) => k }, out);
  p.build(ctx);
  return out;
}

const OBSTACLE_PROPS = ["finanzamt-binders", "finanzamt-boxes", "finanzamt-copier", "finanzamt-hanging-files", "finanzamt-duct", "finanzamt-lamp"];

describe("Welt Finanzamt bei Nacht", () => {
  it("Hindernis-Props sind vorgeladen und im Manifest vorhanden", () => {
    const manifest = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../public/fredrun2/props/manifest.json"), "utf8")) as { props: Record<string, { file: string; cw: number; ch: number }> };
    for (const id of OBSTACLE_PROPS) {
      expect(WORLD_FINANZAMT.propIds, id).toContain(id);
      expect(manifest.props[id], id).toBeTruthy();
    }
    // Skins zeichnen gegen diese Zellmaße (Ausschnitte/Ankerzeilen im Skin-Code)
    expect(manifest.props["finanzamt-boxes"]).toMatchObject({ cw: 249, ch: 512 });
    expect(manifest.props["finanzamt-hanging-files"]).toMatchObject({ cw: 640, ch: 559 });
    expect(manifest.props["finanzamt-duct"]).toMatchObject({ cw: 640, ch: 566 });
    expect(manifest.props["finanzamt-lamp"]).toMatchObject({ cw: 377, ch: 512 });
  });

  it("Metadaten vollständig", () => {
    expect(WORLD_FINANZAMT.name).toBe("Finanzamt bei Nacht");
    expect(WORLD_FINANZAMT.music).toBe("finanzamt");
    expect(WORLD_FINANZAMT.stageCount).toBe(5);
    expect(WORLD_FINANZAMT.stageMeters).toBe(280);
    expect(WORLD_FINANZAMT.stageNames.length).toBe(WORLD_FINANZAMT.stageCount);
    expect(WORLD_FINANZAMT.mechanics.length).toBeLessThanOrEqual(4);
    expect(WORLD_FINANZAMT.patterns.length).toBeGreaterThanOrEqual(18);
    const ids = new Set(WORLD_FINANZAMT.patterns.map((p) => p.id));
    expect(ids.size).toBe(WORLD_FINANZAMT.patterns.length);
  });

  it("Schwierigkeitsverteilung: Einsteiger, schwere Muster, Setpieces", () => {
    const ps = WORLD_FINANZAMT.patterns;
    expect(ps.filter((p) => p.minDiff <= 1.5).length).toBeGreaterThanOrEqual(3);
    expect(ps.filter((p) => p.minDiff >= 4.8).length).toBeGreaterThanOrEqual(4);
    expect(ps.find((p) => p.id === "fa-sicherheitsschleuse")?.minDiff).toBeGreaterThanOrEqual(3);
    expect(ps.find((p) => p.id === "fa-papierlawine")?.minDiff).toBeGreaterThanOrEqual(3);
  });

  it("alle Muster bauen regelkonform", () => {
    const issues = auditPatterns(WORLD_FINANZAMT, { forbid: ["portal", "spring"] });
    if (issues.length) console.log(issues.slice(0, 20));
    expect(issues).toEqual([]);
  });

  it("Signatur-Mechaniken sind vorhanden", () => {
    const skins = new Set<string>();
    for (const p of WORLD_FINANZAMT.patterns) for (const s of build(p.id, Math.max(p.minDiff, 6))) skins.add(`${s.kind}:${s.skin}`);
    for (const k of ["zone:stamp", "zone:laser-low", "zone:laser-high", "speedzone:belt-fast", "speedzone:belt-slow", "pit:shredder", "block:paper-stack", "walker:office-chair", "flyer:bat", "platform:paternoster"]) {
      expect(skins.has(k), k).toBe(true);
    }
  });

  it("Laser: niedrig ist überspringbar, hoch nur unterrutschbar", () => {
    for (const diff of [1.5, 5, 10]) {
      const low = build("fa-laser-tief", diff).find((s) => s.skin === "laser-low");
      const high = build("fa-laser-hoch", diff).find((s) => s.skin === "laser-high");
      expect(low && high).toBeTruthy();
      if (!low || !high || !low.hb || !high.hb) continue;
      // Oberkante niedriger Laser ≤ 90 px über Boden (Sprunghöhe 216)
      expect(590 - (low.y + low.hb[1])).toBeLessThanOrEqual(90);
      // Unterkante hoher Laser ≥ 72 px über Boden (Rutsch-Hitbox 45 px), Oberkante unerreichbar hoch
      const bottom = 590 - (high.y + high.hb[1] + high.hb[3]);
      expect(bottom).toBeGreaterThanOrEqual(72);
      expect(590 - high.y).toBeGreaterThan(420);
      expect(high.cycle?.loop).toBe(true);
    }
  });

  it("hoher Laser: unsichtbarer, harmloser Überhang hält die Figur im Rutschen", () => {
    for (const id of ["fa-laser-hoch", "fa-laser-wechsel", "fa-sicherheitsschleuse", "fa-nachtschicht"]) {
      const p = WORLD_FINANZAMT.patterns.find((x) => x.id === id);
      const specs = build(id, Math.max(8, p?.minDiff ?? 0), 3);
      const highs = specs.filter((s) => s.skin === "laser-high");
      const guards = specs.filter((s) => s.skin === "laser-guard");
      expect(highs.length, id).toBeGreaterThan(0);
      expect(guards.length, id).toBe(highs.length);
      for (const g of guards) {
        expect(g.kind).toBe("overhead");
        expect(g.harmful).toBe(false);
        // Unterkante auf Höhe der Laser-Unterkante (76 px) – Rutsch-Hitbox (45 px) passt drunter
        expect(590 - (g.y + g.h)).toBeGreaterThanOrEqual(72);
      }
    }
  });

  it("Stempel: Warnung ≥ 0.6 s vor dem Einschlag", () => {
    for (const diff of [1.2, 4, 9]) {
      const st = build("fa-stempel", diff).find((s) => s.skin === "stamp");
      const warn = st?.cycle?.phases.find((p) => p.name === "warn");
      expect(warn?.dur ?? 0).toBeGreaterThanOrEqual(0.6);
    }
  });

  it("Bot übersteht zusätzliche Seeds", { timeout: 180_000 }, () => {
    const runs = botRuns(WORLDS, "finanzamt", [
      { seed: 3, meters: 0, secs: 40 },
      { seed: 5, meters: 1200, secs: 35 },
      { seed: 9, meters: 2400, secs: 35 },
      { seed: 13, meters: 4000, secs: 30 },
    ]);
    for (const r of runs) if (r.log.length) console.log("finanzamt", r.seed, r.meters, r.log.join("\n  "));
    for (const r of runs) expect(r.hurts).toBeLessThanOrEqual(2);
  });
});

// --- Weltladen, Stufen-Vorbereitung, Skalenwechsel (Canvas-Attrappe, ohne DOM) -----------------------------------------------

interface FaInternals {
  A: { cache: { k: number; clear(): void }; pcache: { k: number }; coin: { height: number } };
  mids: Map<number, unknown>;
  backdrop: { has(stage: number): boolean };
  built: boolean;
  pixelK: number;
}

const inner = (r: FinanzamtRenderer): FaInternals => r as unknown as FaInternals;

/** Canvas-Attrappe der gemeinsamen Test-Hilfen, ergänzt um `measureText` und `getTransform` (dort ohne Rückgabewert) */
function installStub(): ReturnType<typeof installCanvasStub> {
  const stub = installCanvasStub();
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
  return stub;
}

async function loaded(dpr?: number): Promise<{ r: FinanzamtRenderer; stub: ReturnType<typeof installCanvasStub> }> {
  const stub = installStub();
  const r = new FinanzamtRenderer();
  if (dpr !== undefined) r.resize(dpr);
  await r.load(assetsOf(manifestProps(), FAKE_IMAGE));
  return { r, stub };
}

describe("Finanzamt – Stufenlänge, Weltladen, Folgestufe, Skalenwechsel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("FA_STAGE_METERS entspricht der Welt-Definition", () => {
    expect(FA_STAGE_METERS).toBe(WORLD_FINANZAMT.stageMeters);
  });

  it("load baut alles und legt Mittelgrund der Stufen 0 und 1 an", async () => {
    const { r } = await loaded();
    const i = inner(r);
    expect(i.built).toBe(true);
    expect(i.mids.has(0)).toBe(true);
    expect(i.mids.has(1)).toBe(true);
    expect(i.mids.has(2)).toBe(false);
  });

  it("Chunked.steps liefert dieselbe Zerlegung wie der Konstruktor (auch wenn die Pixel nicht lesbar sind)", () => {
    installStub();
    const src = document.createElement("canvas");
    src.width = 2048;
    src.height = 320;
    const a = new Chunked(src, 64, 3, 32);
    const it = Chunked.steps(src, 64, 3, 32);
    for (;;) {
      const r = it.next();
      if (r.done) {
        expect(r.value.coverage).toBeCloseTo(a.coverage, 12);
        break;
      }
    }
  });

  it("Chunked.steps gibt bei lesbaren Pixeln alle 640 Spalten die Kontrolle ab", () => {
    installStub();
    const src = document.createElement("canvas");
    src.width = 2048;
    src.height = 64;
    const data = new Uint8ClampedArray(2048 * 64 * 4);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    (src.getContext("2d") as unknown as { getImageData: () => { data: Uint8ClampedArray } }).getImageData = () => ({ data });
    const it = Chunked.steps(src, 64, 3, 32);
    let steps = 0;
    for (;;) {
      const r = it.next();
      if (r.done) {
        expect(r.value.coverage).toBe(1);
        break;
      }
      steps += 1;
    }
    expect(steps).toBeGreaterThanOrEqual(3); // Auslesen + ca. 2048/640 Zerlegungsschritte
  });

  it("die Folgestufe wird erst ab ~28 % der Stufe und höchstens ein Schritt je ~100 ms vorbereitet", async () => {
    const { r } = await loaded();
    const i = inner(r);
    let clock = 5000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const at = (progress: number): void => r.update(1 / 60, stubView({ stage: 1, worldMeters: FA_STAGE_METERS + progress * FA_STAGE_METERS }));
    at(0.02);
    at(0.25);
    expect(i.mids.has(2)).toBe(false);
    at(0.3);
    expect(i.mids.has(2)).toBe(true);
    at(0.31); // Lücke < 100 ms
    expect(i.backdrop.has(2)).toBe(false);
    clock += 120;
    at(0.35);
    expect(i.backdrop.has(2)).toBe(true);
  });

  it("beginnt die Überblendung, obwohl die Folgestufe fehlt, wird sie sofort nachgeholt", async () => {
    const { r } = await loaded();
    const i = inner(r);
    r.update(1 / 60, stubView({ stage: 1, worldMeters: FA_STAGE_METERS + 5, stageBlend: 0 }));
    expect(i.mids.has(2)).toBe(false);
    r.update(1 / 60, stubView({ stage: 1, worldMeters: FA_STAGE_METERS + 20, stageBlend: 0.2 }));
    expect(i.mids.has(2)).toBe(true);
  });

  it("resize ist idempotent; nur eine echte Änderung backt Münzstreifen und Sprite-Caches neu", async () => {
    const { r, stub } = await loaded();
    const i = inner(r);
    expect(i.A.cache.k).toBe(1);
    const coin0 = i.A.coin;
    const n = stub.created;
    r.resize(1);
    r.resize(1);
    r.resize(1.05); // rundet auf 1
    expect(stub.created).toBe(n);
    expect(i.A.coin).toBe(coin0);
    r.resize(1.5);
    expect(i.A.cache.k).toBe(1.5);
    expect(i.A.pcache.k).toBe(1.5);
    expect(i.A.coin).not.toBe(coin0);
    const m = stub.created;
    expect(m).toBeGreaterThan(n);
    r.resize(1.5);
    r.resize(1.45); // rundet auf 1,5
    expect(stub.created).toBe(m);
  });

  it("resize vor dem Laden: gleich in der richtigen Dichte bauen (keine zweite Münzstreifen-Erzeugung beim Zeichnen)", async () => {
    const { r } = await loaded(2);
    const i = inner(r);
    expect(i.A.cache.k).toBe(2);
    expect(i.A.pcache.k).toBe(2);
    expect(i.A.coin.height).toBe(Math.round(41 * 2));
  });
});

describe("Finanzamt – Sprite-Bake außerhalb des Bildes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const draw = (): void => undefined;

  it("SpriteCache: außerhalb höchstens ein Bake je Frame (Rest wartet mit durchsichtigem Platzhalter), sichtbar immer sofort", () => {
    const stub = installStub();
    const budget: BakeBudget = { n: 0, off: true };
    const C = new SpriteCache(90, budget);
    const a = C.get("a", 20, 20, draw);
    expect(a.width).toBeGreaterThan(1);
    const wait = C.get("b", 30, 30, draw); // gleicher Frame: wartet
    expect(wait.width).toBe(1);
    const n = stub.created; // der Platzhalter entsteht einmal
    expect(C.get("c", 30, 30, draw)).toBe(wait); // derselbe Platzhalter
    expect(stub.created).toBe(n);
    budget.off = false;
    const b = C.get("b", 30, 30, draw); // sichtbar: sofort
    expect(b.width).toBeGreaterThan(1);
    budget.off = true;
    budget.n = 0; // nächster Frame
    const c = C.get("c", 30, 30, draw);
    expect(c.width).toBeGreaterThan(1);
    expect(C.get("a", 20, 20, draw)).toBe(a); // Treffer kostet nichts und zählt nicht
    expect(budget.n).toBe(1);
  });

  it("GlowCache und SpriteCache teilen das Budget des Frames", () => {
    installStub();
    const budget: BakeBudget = { n: 0, off: true };
    const C = new SpriteCache(90, budget);
    const G = new GlowCache(budget);
    expect(G.get("rgba(255,0,0,1)", 40, 20).width).toBeGreaterThan(1);
    expect(C.get("x", 20, 20, draw).width).toBe(1); // das Budget ist verbraucht
    budget.n = 0;
    expect(C.get("x", 20, 20, draw).width).toBeGreaterThan(1);
    expect(G.get("rgba(0,255,0,1)", 40, 20).width).toBe(1);
  });

  it("ohne Budget (Tests, ältere Aufrufer) wird immer sofort gebacken", () => {
    installStub();
    const C = new SpriteCache(90);
    expect(C.get("a", 20, 20, draw).width).toBeGreaterThan(1);
    expect(C.get("b", 20, 20, draw).width).toBeGreaterThan(1);
  });

  it("OFFSCREEN_X liegt knapp hinter dem rechten Bildrand (die Engine zeichnet ab 260 px dahinter)", () => {
    expect(OFFSCREEN_X).toBeGreaterThan(1280);
    expect(OFFSCREEN_X).toBeLessThan(1280 + 260);
  });
});

describe("Finanzamt – Alarmlicht und Blitz-Regler (flashScale)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Deckkraft, mit der drawOverlay das Alarmlicht zeichnet (null = nicht gezeichnet) */
  async function alarmAlpha(over: Parameters<typeof stubView>[0]): Promise<number | null> {
    const { r } = await loaded();
    const wash = (r as unknown as { alarmWash: unknown }).alarmWash;
    let cur = 1;
    let hit: number | null = null;
    const g = new Proxy(
      {},
      {
        get(_t, p: string) {
          if (p === "globalAlpha") return cur;
          if (p === "drawImage") {
            return (img: unknown): void => {
              if (img === wash) hit = cur;
            };
          }
          return (): undefined => undefined;
        },
        set(_t, p: string, v: unknown) {
          if (p === "globalAlpha") cur = v as number;
          return true;
        },
      },
    ) as unknown as CanvasRenderingContext2D;
    // sin(time · 3,2) = 1 → volle Pulsstärke
    r.drawOverlay(g, stubView({ stage: 4, vars: { alarm: 1 }, time: Math.PI / 2 / 3.2, ...over }));
    return hit;
  }

  it("ohne Feld und mit flashScale 1: das Alarmlicht wie bisher (volle Pulsstärke)", async () => {
    expect(await alarmAlpha({})).toBeCloseTo(1, 9);
    expect(await alarmAlpha({ flashScale: 1 })).toBeCloseTo(1, 9);
  });

  it("flashScale 0,3 dämpft das Pulsieren auf 30 %, flashScale 0 schaltet es ab", async () => {
    expect(await alarmAlpha({ flashScale: 0.3 })).toBeCloseTo(0.3, 9);
    expect(await alarmAlpha({ flashScale: 0 })).toBeNull();
  });

  it("„Weniger Bewegung“: ruhiges Dauerlicht (0,4) wie bisher, unabhängig vom Regler", async () => {
    expect(await alarmAlpha({ reducedMotion: true })).toBeCloseTo(0.4, 9);
    expect(await alarmAlpha({ reducedMotion: true, flashScale: 0.3 })).toBeCloseTo(0.4, 9);
  });

  it("vor Stufe 5 gibt es kein Alarmlicht", async () => {
    expect(await alarmAlpha({ stage: 3 })).toBeNull();
  });
});
