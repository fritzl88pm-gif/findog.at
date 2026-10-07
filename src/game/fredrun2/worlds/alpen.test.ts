import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXED_DT } from "../constants";
import { Sim } from "../sim";
import { WORLD_ALPEN } from "./alpen";
import { ALPEN_STAGE_METERS, AlpenRenderer } from "./alpen/renderer";
import { PropBank } from "./alpen/skins";
import { AVALANCHE_MIN_DIFF, AVALANCHE_MIN_STAGE, AlpenSystem } from "./alpen/system";
import { WORLDS } from "./index";
import { auditPatterns, botRuns } from "./shared-b/audit";
import type { StageCache } from "./shared-b/layers";
import { FAKE_IMAGE, assetsOf, installCanvasStub, installRecordingStub, installTouchStub, manifestProps, stubView, type RecordingCanvas } from "./shared-b/test-kit";

describe("Welt Alpenpanorama", () => {
  it("Metadaten vollständig", () => {
    expect(WORLD_ALPEN.id).toBe("alpen");
    expect(WORLD_ALPEN.stageCount).toBe(5);
    expect(WORLD_ALPEN.stageMeters).toBe(320);
    expect(WORLD_ALPEN.stageNames.length).toBe(WORLD_ALPEN.stageCount);
    expect(WORLD_ALPEN.mechanics.length).toBeLessThanOrEqual(4);
    expect(WORLD_ALPEN.patterns.length).toBeGreaterThanOrEqual(18);
    const ids = new Set(WORLD_ALPEN.patterns.map((p) => p.id));
    expect(ids.size).toBe(WORLD_ALPEN.patterns.length);
    const specials = WORLD_ALPEN.patterns.filter((p) => p.id === "alp-gipfelgrat" || p.id === "alp-seilbahnfahrt");
    expect(specials.length).toBe(2);
    for (const p of specials) expect(p.minDiff).toBeGreaterThanOrEqual(3);
    expect(WORLD_ALPEN.patterns.filter((p) => p.minDiff <= 1.5).length).toBeGreaterThanOrEqual(3);
    expect(WORLD_ALPEN.patterns.filter((p) => p.minDiff >= 5).length).toBeGreaterThanOrEqual(4);
  });

  it("Hindernis-Props (Steinmandl, Holzstoß, Stamm, Murmeltier, Seilbahn-Kiste, Rollfels, Schneeball) sind in propIds und im Manifest", () => {
    const manifest = JSON.parse(readFileSync("public/fredrun2/props/manifest.json", "utf8")) as { props: Record<string, unknown> };
    for (const id of ["alpen-cairn", "alpen-logs", "alpen-trunk", "alpen-marmot", "alpen-cargo", "alpen-rollstone", "alpen-snowball"]) {
      expect(WORLD_ALPEN.propIds).toContain(id);
      expect(manifest.props[id], id).toBeDefined();
    }
  });

  it("alle Muster bauen regelkonform", () => {
    const issues = auditPatterns(WORLD_ALPEN, { forbid: ["portal", "spring"] });
    if (issues.length) console.log(issues.slice(0, 20));
    expect(issues).toEqual([]);
  });

  it("Lawine: telegrafiert, holt nur nach Fehlern auf, trifft dann fair", () => {
    const sim = new Sim({ mode: "world", world: "alpen", character: "fred", seed: 4, startMeters: 1200, startWorldMeters: 900 }, WORLDS);
    sim.begin();
    sim.noSpawn = true;
    sim.ents = [];
    const sys = sim.systems.find((s): s is AlpenSystem => s instanceof AlpenSystem);
    expect(sys).toBeDefined();
    expect(sim.diff).toBeGreaterThanOrEqual(AVALANCHE_MIN_DIFF);
    expect(sim.stageInfo().stage).toBeGreaterThanOrEqual(AVALANCHE_MIN_STAGE);
    let rumbleSeen = false;
    let warnBeforeChase = false;
    let chaseSeen = false;
    for (let i = 0; i < 40 / FIXED_DT; i += 1) {
      sim.step(FIXED_DT, { jump: false, jumpPressed: false, slide: false, slidePressed: false, dashPressed: false });
      const st = sys?.state;
      if (st?.phase === "rumble") {
        rumbleSeen = true;
        if ((sim.vars.chaseWarn ?? 0) > 0.3) warnBeforeChase = true;
      }
      if (st?.phase === "chase") chaseSeen = true;
    }
    expect(rumbleSeen).toBe(true);
    expect(warnBeforeChase).toBe(true);
    expect(chaseSeen).toBe(true);
    // ungehindert laufen → kein Treffer durch die Lawine
    expect(sim.stats.hurts).toBe(0);
  });

  it("Lawine: ein einzelner Treffer kostet Vorsprung, aber kein zweites Herz; mehrere Fehler kurz hintereinander schon", () => {
    const mk = (): { sim: Sim; sys: AlpenSystem } => {
      const sim = new Sim({ mode: "world", world: "alpen", character: "fred", seed: 8, startMeters: 1400, startWorldMeters: 900 }, WORLDS);
      sim.begin();
      sim.noSpawn = true;
      sim.ents = [];
      sim.player.hearts = 5;
      const sys = sim.systems.find((s): s is AlpenSystem => s instanceof AlpenSystem) as AlpenSystem;
      const idle = { jump: false, jumpPressed: false, slide: false, slidePressed: false, dashPressed: false };
      for (let i = 0; i < 60 / FIXED_DT && sys.state.phase !== "chase"; i += 1) sim.step(FIXED_DT, idle);
      return { sim, sys };
    };
    const idle = { jump: false, jumpPressed: false, slide: false, slidePressed: false, dashPressed: false };
    // (a) ein Treffer: Vorsprung schrumpft, Warnung steigt – aber keine Lawinen-Verletzung
    {
      const { sim, sys } = mk();
      expect(sys.state.phase).toBe("chase");
      const before = sys.state.gapT;
      sim.hurt("test");
      for (let i = 0; i < 0.6 / FIXED_DT; i += 1) sim.step(FIXED_DT, idle);
      expect(sys.state.gapT).toBeLessThan(before - 0.15);
      expect(sim.vars.chaseWarn ?? 0).toBeGreaterThan(0.5);
      for (let i = 0; i < 6 / FIXED_DT; i += 1) sim.step(FIXED_DT, idle);
      expect(sim.stats.hurts).toBe(1);
    }
    // (b) drei Treffer kurz hintereinander: die Lawine holt auf, trifft einmal und wird zurückgesetzt
    {
      const { sim, sys } = mk();
      let lawine = 0;
      for (let k = 0; k < 3; k += 1) {
        sim.player.invuln = 0;
        sim.hurt("test");
        for (let i = 0; i < 0.45 / FIXED_DT; i += 1) {
          sim.step(FIXED_DT, idle);
          for (const ev of sim.events) if (ev.type === "hurt" && ev.tag === "lawine") lawine += 1;
          sim.events.length = 0;
        }
      }
      for (let i = 0; i < 3 / FIXED_DT; i += 1) {
        sim.step(FIXED_DT, idle);
        for (const ev of sim.events) if (ev.type === "hurt" && ev.tag === "lawine") lawine += 1;
        sim.events.length = 0;
      }
      expect(lawine).toBe(1);
      expect(sys.state.gapT).toBeGreaterThan(0.3);
    }
  });

  it("Bot übersteht zusätzliche Seeds", { timeout: 180_000 }, () => {
    const runs = botRuns(WORLDS, "alpen", [
      { seed: 3, meters: 0, secs: 40 },
      { seed: 5, meters: 1000, secs: 35 },
      { seed: 9, meters: 2200, secs: 35 },
      { seed: 13, meters: 4000, secs: 30 },
    ]);
    for (const r of runs) if (r.log.length) console.log("alpen", r.seed, r.meters, r.log.join("\n  "));
    for (const r of runs) expect(r.hurts).toBeLessThanOrEqual(2);
  });
});

// --- Weltladen, Stufen-Backen, Aufwärmen, Skalenwechsel (Canvas-Attrappe, ohne DOM) -------------------------------------

interface AlpenInternals {
  staged: StageCache[];
  far: StageCache;
  mid: StageCache;
  near: StageCache;
  backdrop: { stages: StageCache | null };
  loaded: boolean;
  buf: unknown;
}

const inner = (r: AlpenRenderer): AlpenInternals => r as unknown as AlpenInternals;

async function loaded(): Promise<{ r: AlpenRenderer; stub: ReturnType<typeof installCanvasStub> }> {
  const stub = installCanvasStub();
  const r = new AlpenRenderer();
  await r.load(assetsOf(manifestProps(), FAKE_IMAGE)); // mit Kulissenbild: zweiteilige Kulisse wird gebaut und wiederverwendet
  return { r, stub };
}

describe("Alpen – Weltladen, Stufen-Backen, Aufwärmen, Skalenwechsel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("ALPEN_STAGE_METERS entspricht der Welt-Definition", () => {
    expect(ALPEN_STAGE_METERS).toBe(WORLD_ALPEN.stageMeters);
  });

  it("load backt die Stufe 0 aller Caches (zweiteilige Ebenen in beiden Schritten); update backt die Folgestufe erst ab ~28 %", async () => {
    const { r } = await loaded();
    const list = inner(r).staged;
    expect(list.length).toBeGreaterThanOrEqual(11);
    for (const c of list) expect(c.has(0)).toBe(true);
    let clock = 3000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const at = (progress: number): void => r.update(1 / 60, stubView({ stage: 0, worldMeters: progress * ALPEN_STAGE_METERS }));
    const next = (): number => list.filter((c) => c.has(1)).length;
    const before = next(); // load backt für die Kulisse bereits Stufe 1
    at(0.02);
    at(0.2);
    expect(next()).toBe(before);
    for (let k = 0; k < 40; k += 1) {
      clock += 120;
      at(0.3 + k * 0.005);
    }
    expect(list.every((c) => c.has(1))).toBe(true);
  });

  it("ein ganzer Lauf durch alle 5 Stufen: Stufenflächen werden wiederverwendet (nur die Farbmasken der Einfärbung legen Zwischenflächen an)", async () => {
    const { r, stub } = await loaded();
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    // Leerlauf-Aufwärmen (Hub: Countdown/Menü-Demo): Stufe 0 und 1 aller Caches liegen vor
    r.update(1 / 60, stubView());
    while (!r.warm(50)) {
      /* aufwärmen */
    }
    const base = stub.created;
    for (let st = 0; st <= 4; st += 1) {
      for (let p = 0; p < 1; p += 0.05) {
        clock += 120;
        r.update(1 / 60, stubView({ stage: st, stageBlend: p > 0.75 ? (p - 0.75) * 4 : 0, worldMeters: st * ALPEN_STAGE_METERS + p * ALPEN_STAGE_METERS }));
      }
    }
    // Ohne Wiederverwendung wären es ≥ 13 Caches × 3 Stufen; übrig bleiben die Maskier-Zwischenflächen (Stufe 3: 1, Stufe 4: 2 je Ebene)
    expect(stub.created - base).toBeLessThanOrEqual(12);
    expect(inner(r).staged.every((c) => c.has(4))).toBe(true);
  });

  it("Einfärben in Schritten (Rohbild, Stimmung, Abschluss) ergibt dieselben Zeichenbefehle wie am Stück – Ebenen und Kulisse, alle Stufen", async () => {
    installRecordingStub();
    const a = new AlpenRenderer();
    const b = new AlpenRenderer();
    await a.load(assetsOf(manifestProps(), FAKE_IMAGE));
    await b.load(assetsOf(manifestProps(), FAKE_IMAGE));
    const pick = (r: AlpenRenderer): Array<[string, StageCache]> => {
      const i = inner(r);
      const bs = i.backdrop.stages;
      if (!bs) throw new Error("Kulisse nicht gebaut");
      return [
        ["far", i.far],
        ["mid", i.mid],
        ["near", i.near],
        ["backdrop", bs],
      ];
    };
    const fresh = (c: StageCache): void => {
      c.clear();
      c.dropSpare(); // kein recycelter Reset im Protokoll
    };
    const A = pick(a);
    const B = pick(b);
    let compared = 0;
    for (let k = 0; k < A.length; k += 1) {
      for (let stage = 0; stage <= 4; stage += 1) {
        fresh(A[k][1]);
        fresh(B[k][1]);
        let steps = 0;
        while (!A[k][1].has(stage) && steps < 4) {
          A[k][1].step(stage);
          steps += 1;
        }
        expect(steps, `${A[k][0]} Stufe ${stage}: höchstens 3 Schritte`).toBeLessThanOrEqual(3);
        const stepwise = (A[k][1].get(stage) as unknown as RecordingCanvas).log;
        const direct = (B[k][1].get(stage) as unknown as RecordingCanvas).log;
        expect(stepwise.length, `${A[k][0]} Stufe ${stage}`).toBeGreaterThan(0);
        expect(stepwise, `${A[k][0]} Stufe ${stage}`).toEqual(direct);
        compared += 1;
      }
    }
    expect(compared).toBe(20);
  });

  it("die Stufen-Schritte rastern gleich: Rohbild, Stimmung und Bake werden einzeln berührt (touchCanvas)", async () => {
    const rec = installTouchStub();
    const { r } = await loaded();
    const bs = inner(r).backdrop.stages;
    if (!bs) throw new Error("Kulisse nicht gebaut");
    bs.clear();
    bs.dropSpare();
    const before = rec.touched.length;
    bs.step(3); // Rohbild
    expect(rec.touched.length - before).toBe(1);
    bs.step(3); // Stimmung (Stufe 3: Sättigung + Weichlicht)
    expect(rec.touched.length - before).toBe(2);
    bs.step(3); // Abschluss (Dunst, Ausblendung) = Bake
    expect(rec.touched.length - before).toBe(3);
    expect(bs.has(3)).toBe(true);
    // Stufe 1 hat keine Stimmung: Rohbild, dann gleich der Abschluss
    bs.step(1);
    bs.step(1);
    expect(bs.has(1)).toBe(true);
    expect(rec.touched.length - before).toBe(5);
  });

  it("warm legt den Zwischenpuffer des Tor-Übergangs an und meldet danach, dass nichts mehr zu tun ist", async () => {
    const { r, stub } = await loaded();
    r.update(1 / 60, stubView());
    expect(inner(r).buf).toBeNull();
    let rounds = 0;
    while (!r.warm(3) && rounds < 100) rounds += 1;
    expect(rounds).toBeLessThan(100);
    expect(inner(r).buf).not.toBeNull();
    const done = stub.created;
    expect(r.warm(3)).toBe(true);
    expect(stub.created).toBe(done);
  });

  it("warm vor dem Laden hat nichts zu tun", () => {
    installCanvasStub();
    expect(new AlpenRenderer().warm(3)).toBe(true);
  });

  it("resize ist idempotent: Alpen backt unabhängig von der Pixeldichte, es entstehen keine neuen Flächen", async () => {
    const { r, stub } = await loaded();
    r.update(1 / 60, stubView());
    const base = stub.created;
    for (const k of [1, 1, 1.5, 1.5, 2, 1, 1.25]) {
      r.resize();
      r.update(1 / 60, stubView());
      void k;
    }
    expect(stub.created).toBe(base);
  });
});

describe("Alpen – PropBank (Cache ohne String-Schlüssel)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gleiche Angaben (auch als neues Objekt) treffen; Spiegelung, Schnee, Ausschnitt, Maske trennen die Einträge", () => {
    const stub = installCanvasStub();
    const bank = new PropBank(manifestProps());
    const a = bank.get("alpen-cairn", 0.2, { snow: { y0: 5, y1: 90, a0: 0.8 } });
    expect(a).not.toBeNull();
    const n = stub.created;
    expect(bank.get("alpen-cairn", 0.2, { snow: { y0: 5, y1: 90, a0: 0.8 } })).toBe(a);
    expect(bank.get("alpen-cairn", 0.2000001, { snow: { y0: 5, y1: 90, a0: 0.8, ramp: 3 } })).toBe(a); // ramp zählt nicht (wie bisher)
    expect(stub.created).toBe(n);
    const flipped = bank.get("alpen-cairn", 0.2, { flip: true, snow: { y0: 5, y1: 90, a0: 0.8 } });
    expect(flipped).not.toBe(a);
    expect(bank.get("alpen-cairn", 0.2)).not.toBe(a);
    expect(bank.get("alpen-cairn", 0.2, { crop: [0, 0, 100, 100] })).not.toBe(bank.get("alpen-cairn", 0.2, { crop: [0, 10, 100, 100] }));
    expect(bank.get("alpen-cairn", 0.2, { circle: [10, 10, 5] })).not.toBe(bank.get("alpen-cairn", 0.2, { circle: [10, 10, 6] }));
    expect(bank.size).toBe(7);
  });

  it("höchstens 80 Sprites, die ältesten fliegen zuerst raus", () => {
    installCanvasStub();
    const bank = new PropBank(manifestProps());
    const first = bank.get("alpen-logs", 0.1);
    for (let i = 1; i <= 85; i += 1) bank.get("alpen-trunk", 0.1 + i * 0.001);
    expect(bank.size).toBeLessThanOrEqual(80);
    expect(bank.get("alpen-logs", 0.1)).not.toBe(first); // war verdrängt → neu gebacken
  });
});
