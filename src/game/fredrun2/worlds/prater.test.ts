import { afterEach, describe, expect, it, vi } from "vitest";
import { createPatternCtx } from "../patterns";
import { Rng } from "../rng";
import type { EntSpec } from "../types";
import { WORLDS } from "./index";
import { WORLD_PRATER } from "./prater";
import { PropBank } from "./prater/propfit";
import { PRATER_STAGE_METERS, PraterRenderer } from "./prater/renderer";
import { PRATER_PROP_SIZES, praterPropJobs } from "./prater/skins";
import { auditPatterns, botRuns } from "./shared-b/audit";
import type { StageCache } from "./shared-b/layers";
import { assetsOf, installCanvasStub, installTouchStub, manifestProps, stubView } from "./shared-b/test-kit";

describe("Welt Prater", () => {
  it("Metadaten vollständig", () => {
    expect(WORLD_PRATER.stageNames.length).toBe(WORLD_PRATER.stageCount);
    expect(WORLD_PRATER.mechanics.length).toBeLessThanOrEqual(4);
    expect(WORLD_PRATER.patterns.length).toBeGreaterThanOrEqual(18);
    const ids = new Set(WORLD_PRATER.patterns.map((p) => p.id));
    expect(ids.size).toBe(WORLD_PRATER.patterns.length);
  });

  it("alle Muster bauen regelkonform", () => {
    const issues = auditPatterns(WORLD_PRATER, { forbid: ["portal"] });
    if (issues.length) console.log(issues.slice(0, 20));
    expect(issues).toEqual([]);
  });

  it("Bot übersteht zusätzliche Seeds", { timeout: 120_000 }, () => {
    const runs = botRuns(WORLDS, "prater", [
      { seed: 3, meters: 0, secs: 40 },
      { seed: 5, meters: 1200, secs: 35 },
      { seed: 9, meters: 2400, secs: 35 },
      { seed: 13, meters: 4000, secs: 30 },
    ]);
    for (const r of runs) if (r.log.length) console.log("prater", r.seed, r.meters, r.log.join("\n  "));
    for (const r of runs) expect(r.hurts).toBeLessThanOrEqual(2);
  });
});

// --- Stufen-Backen, Vorbacken, Skalenwechsel, Blitz-Regler (Canvas-Attrappe, ohne DOM) ----------------------------------

interface PraterInternals {
  staged: StageCache[];
  A: { bank: PropBank };
  skyFlash: number;
  loaded: boolean;
}

const inner = (r: PraterRenderer): PraterInternals => r as unknown as PraterInternals;

async function loaded(): Promise<{ r: PraterRenderer; stub: ReturnType<typeof installCanvasStub> }> {
  const stub = installCanvasStub();
  const r = new PraterRenderer();
  await r.load(assetsOf(manifestProps()));
  return { r, stub };
}

describe("Prater – Stufenlänge, Hindernis-Maße, PropBank", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("PRATER_STAGE_METERS entspricht der Welt-Definition", () => {
    expect(PRATER_STAGE_METERS).toBe(WORLD_PRATER.stageMeters);
  });

  it("Hindernisse mit festem Maß (Reifen, Kettenkarussell-Sitz) stehen in PRATER_PROP_SIZES; Buden/Kisten/Behänge/Tore variieren mit dem Tempo", () => {
    const seen = new Map<string, Set<string>>();
    for (const p of WORLD_PRATER.patterns) {
      for (let diff = 0.5; diff <= 14; diff += 0.5) {
        for (let seed = 1; seed <= 4; seed += 1) {
          const out: EntSpec[] = [];
          const speed = 470 + (1180 - 470) * (1 - Math.exp(-diff / 3.6));
          p.build(createPatternCtx({ speed, diff, groundY: 590, ceilY: 150, rng: new Rng(seed), worldId: "prater", defaultSkin: (k) => k }, out));
          for (const e of out) {
            const key = `${e.kind}:${e.skin}`;
            if (!seen.has(key)) seen.set(key, new Set());
            seen.get(key)?.add(`${Math.round(e.w)}x${Math.round(e.h)}`);
          }
        }
      }
    }
    const pairs = (key: string): Array<[number, number]> => [...(seen.get(key) ?? [])].map((x) => [Number(x.split("x")[0]), Number(x.split("x")[1])]);
    const has = (list: ReadonlyArray<readonly [number, number]>, w: number, h: number): boolean => list.some(([a, b]) => a === w && b === h);
    expect(pairs("block:tires").length).toBeGreaterThan(0);
    for (const [w, h] of pairs("block:tires")) expect(has(PRATER_PROP_SIZES.tires, w, h), `tires ${w}x${h}`).toBe(true);
    expect(pairs("swinger:swing-chair").length).toBeGreaterThan(0);
    for (const [w] of pairs("swinger:swing-chair")) expect(PRATER_PROP_SIZES.seat as readonly number[], `seat w=${w}`).toContain(w / 2);
  });

  it("PropBank: Treffer ohne Neubacken (auch mit neuem Ausschnitts-Array), Verdrängung nach letzter Nutzung, Skalen-Hysterese", () => {
    const stub = installCanvasStub();
    const bank = new PropBank();
    bank.setProps(manifestProps());
    const a = bank.get("prater-booth", 140, 70);
    expect(a).not.toBeNull();
    const n = stub.created;
    expect(bank.get("prater-booth", 140, 70)).toBe(a);
    expect(stub.created).toBe(n);
    const c1 = bank.get("prater-swing-chair", 98, 50, [0, 0.388, 1, 1]);
    expect(bank.get("prater-swing-chair", 98, 50, [0, 0.388, 1, 1])).toBe(c1); // neues Array, gleicher Inhalt
    expect(bank.get("prater-swing-chair", 98, 50)).not.toBe(c1); // ohne Ausschnitt: anderer Eintrag
    expect(bank.size).toBe(3);
    // Skala: innerhalb von 0,2 nichts, darüber wird alles neu gebacken
    bank.setScale(1.1);
    expect(bank.get("prater-booth", 140, 70)).toBe(a);
    bank.setScale(1.5);
    expect(bank.size).toBe(0);
    expect(bank.scale).toBe(1.5);
  });

  it("PropBank: die am längsten ungenutzten Sprites werden zuerst verdrängt (Speicherbudget), das neueste bleibt", () => {
    installCanvasStub();
    const bank = new PropBank();
    bank.setProps(manifestProps());
    bank.setScale(2);
    const keep = bank.get("prater-booth", 400, 200); // wird immer wieder benutzt
    for (let i = 0; i < 60; i += 1) {
      bank.get("prater-valance", 600 + i, 600);
      expect(bank.get("prater-booth", 400, 200)).toBe(keep); // Nutzung hält es im Cache
    }
    expect(bank.size).toBeLessThan(61); // Budget 28 MB hat älteres verdrängt
    expect(bank.get("prater-booth", 400, 200)).toBe(keep);
  });

  it("PropBank rastert jedes frisch gebackene Sprite sofort (touchCanvas), Treffer berühren nichts mehr", () => {
    installCanvasStub();
    const rec = installTouchStub();
    const bank = new PropBank();
    bank.setProps(manifestProps());
    const a = bank.get("prater-booth", 140, 70);
    expect(a).not.toBeNull();
    expect(rec.touched).toEqual([a?.c]);
    bank.get("prater-booth", 140, 70);
    expect(rec.touched).toHaveLength(1);
    bank.get("prater-valance", 400, 100); // große Verkleinerung: Zwischenfläche, berührt wird nur das fertige Sprite
    expect(rec.touched).toHaveLength(2);
  });

  it("praterPropJobs backt jedes bekannte Sprite genau einmal vor; zweiter Durchlauf erzeugt nichts Neues", () => {
    const stub = installCanvasStub();
    const A = { bank: new PropBank() } as unknown as Parameters<typeof praterPropJobs>[0];
    A.bank.setProps(manifestProps());
    const jobs = praterPropJobs(A);
    expect(jobs.length).toBe(PRATER_PROP_SIZES.tires.length + PRATER_PROP_SIZES.seat.length);
    for (const j of jobs) j();
    const after = stub.created;
    const size = A.bank.size;
    expect(size).toBe(jobs.length);
    for (const j of jobs) j();
    expect(stub.created).toBe(after);
    expect(A.bank.size).toBe(size);
  });
});

describe("Prater – Weltladen, Stufen-Backen, Aufwärmen, Skalenwechsel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("load backt die Stufen 0 und 1 aller Caches", async () => {
    const { r } = await loaded();
    const list = inner(r).staged;
    expect(list.length).toBeGreaterThanOrEqual(9);
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

  it("ein ganzer Lauf durch alle 5 Stufen legt keine neuen Flächen an (Stufenflächen werden wiederverwendet)", async () => {
    const { r, stub } = await loaded();
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const base = stub.created;
    for (let st = 0; st <= 4; st += 1) {
      for (let p = 0; p < 1; p += 0.05) {
        clock += 120;
        r.update(1 / 60, stubView({ stage: st, stageBlend: p > 0.75 ? (p - 0.75) * 4 : 0, worldMeters: st * PRATER_STAGE_METERS + p * PRATER_STAGE_METERS }));
      }
    }
    expect(stub.created).toBe(base);
    expect(inner(r).staged.every((c) => c.has(4))).toBe(true);
  });

  it("warm backt die Hindernis-Sprites mit festem Maß in Zeitscheiben vor; danach ist nichts mehr zu tun", async () => {
    const { r, stub } = await loaded();
    r.update(1 / 60, stubView());
    const bank = inner(r).A.bank;
    expect(bank.size).toBe(0);
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += 1));
    let rounds = 0;
    while (!r.warm(3) && rounds < 500) rounds += 1;
    expect(rounds).toBeLessThan(500);
    expect(rounds).toBeGreaterThanOrEqual(2); // mehrere Aufrufe (ein Sprite je Schritt), nicht am Stück
    expect(bank.size).toBe(PRATER_PROP_SIZES.tires.length + PRATER_PROP_SIZES.seat.length);
    const done = stub.created;
    expect(r.warm(3)).toBe(true);
    expect(stub.created).toBe(done);
  });

  it("warm vor dem Laden hat nichts zu tun", () => {
    installCanvasStub();
    expect(new PraterRenderer().warm(3)).toBe(true);
  });

  it("resize ist idempotent; nur eine echte Änderung verwirft die Hindernis-Sprites (und stellt sie wieder in die Warteschlange)", async () => {
    const { r, stub } = await loaded();
    while (!r.warm(50)) {
      /* aufwärmen */
    }
    const bank = inner(r).A.bank;
    const n = bank.size;
    const created = stub.created;
    r.resize(1);
    r.resize(1.1);
    r.resize(1.19);
    r.resize(1);
    expect(bank.size).toBe(n);
    expect(stub.created).toBe(created);
    r.resize(1.5);
    expect(bank.scale).toBe(1.5);
    expect(bank.size).toBe(0);
    r.resize(1.5);
    r.resize(1.45);
    expect(bank.scale).toBe(1.5);
    while (!r.warm(50)) {
      /* erneut */
    }
    expect(bank.size).toBe(n);
  });

  it("resize vor dem Laden merkt sich die Skala (wirkt beim Bauen)", async () => {
    installCanvasStub();
    const r = new PraterRenderer();
    r.resize(2);
    await r.load(assetsOf(manifestProps()));
    expect(inner(r).A.bank.scale).toBe(2);
  });
});

describe("Prater – Blitz-Regler (flashScale)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** skyFlash nach einem Feuerwerk-Frame: Rakete platzt (Stufe 3 → Feuerwerk aktiv), Zuwachs 0,55 · Skala */
  async function skyFlashAfterBurst(over: Partial<ReturnType<typeof stubView>>): Promise<number> {
    const { r } = await loaded();
    const i = inner(r);
    let peak = 0;
    for (let k = 0; k < 400; k += 1) {
      r.update(1 / 20, stubView({ stage: 3, worldMeters: 3 * PRATER_STAGE_METERS + 10, time: k / 20, ...over }));
      peak = Math.max(peak, i.skyFlash);
      if (peak > 0) break;
    }
    return peak;
  }

  it("ohne Feld / Standard 1: Zuwachs 0,55 wie bisher", async () => {
    expect(await skyFlashAfterBurst({})).toBeCloseTo(0.55, 6);
    expect(await skyFlashAfterBurst({ flashScale: 1 })).toBeCloseTo(0.55, 6);
  });

  it("flashScale 0,3 dämpft den Zuwachs auf 30 %", async () => {
    expect(await skyFlashAfterBurst({ flashScale: 0.3 })).toBeCloseTo(0.165, 6);
  });

  it("flashScale 0: kein Himmelsblitz", async () => {
    expect(await skyFlashAfterBurst({ flashScale: 0 })).toBe(0);
  });

  it("„Weniger Bewegung“ ohne flashScale: kein Blitz wie bisher; mit gekapptem flashScale ersetzt dieser Wert das Verbot", async () => {
    expect(await skyFlashAfterBurst({ reducedMotion: true })).toBe(0);
    expect(await skyFlashAfterBurst({ reducedMotion: true, flashScale: 0.3 })).toBeCloseTo(0.165, 6);
    expect(await skyFlashAfterBurst({ reducedMotion: true, flashScale: 0.1 })).toBeCloseTo(0.055, 6);
    expect(await skyFlashAfterBurst({ reducedMotion: true, flashScale: 0 })).toBe(0);
  });

  it("„Weniger Bewegung“: höchstens 0,3, auch wenn der Aufrufer flashScale nicht kappt (sim.view liefert Standard 1)", async () => {
    expect(await skyFlashAfterBurst({ reducedMotion: true, flashScale: 1 })).toBeCloseTo(0.165, 6);
    expect(await skyFlashAfterBurst({ reducedMotion: true, flashScale: 0.6 })).toBeCloseTo(0.165, 6);
  });
});
