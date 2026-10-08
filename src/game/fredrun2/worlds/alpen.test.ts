import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXED_DT } from "../constants";
import { Sim } from "../sim";
import { WORLD_ALPEN } from "./alpen";
import { AlpBackdrop } from "./alpen/backdrop";
import { ALPEN_STAGE_METERS, AlpenRenderer } from "./alpen/renderer";
import { blendMasked } from "./alpen/scenery";
import { PropBank, drawLedge, type SkinAssets, type SkinCtx } from "./alpen/skins";
import { AVALANCHE_MIN_DIFF, AVALANCHE_MIN_STAGE, AlpenSystem } from "./alpen/system";
import { paint } from "./shared-b/canvas";
import type { Ent } from "../types";
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
    // Seed 3 (0 m): Der Bot wird bei 66 m einmal getroffen und braucht bei 110 m den Dash, um aus einem langen Doppelsprung-Flug
    // über den nächsten Stamm zu kommen. Seit „Berührt = kein Knapp!“ (Sim.passEnt) bringt das Passieren des eben getroffenen Zauns keine
    // 9 Energie mehr, der Dash (Kosten 34) fehlt dann um 9: ein dritter Treffer, kein Lösbarkeitsfehler der Muster. Deshalb dort bis zu 3.
    for (const r of runs) expect(r.hurts).toBeLessThanOrEqual(r.seed === 3 ? 3 : 2);
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

  it("Qualität 0: die Folgestufe wird erst ab ~60 % der Stufe gebacken, im Leerlauf (warm) gar nicht", async () => {
    const { r } = await loaded();
    const list = inner(r).staged;
    vi.spyOn(performance, "now").mockImplementation(() => 7000);
    const at = (progress: number): void => r.update(1 / 60, stubView({ stage: 0, quality: 0, worldMeters: progress * ALPEN_STAGE_METERS }));
    const next = (): number => list.filter((c) => c.has(1)).length;
    const before = next(); // load backt für die Kulisse bereits Stufe 1
    at(0.02);
    at(0.3);
    at(0.5);
    expect(next()).toBe(before);
    r.warm(1000);
    expect(next()).toBe(before);
    at(0.62);
    expect(next()).toBeGreaterThan(before);
  });

  it("ein ganzer Lauf durch alle 5 Stufen: Stufenflächen werden wiederverwendet, es entsteht keine neue Fläche", async () => {
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
    // Ohne Wiederverwendung wären es ≥ 13 Caches × 3 Stufen; auch die Mischmodi-Durchgänge (Stufe 0, 3, 4) arbeiten in Streifen
    // auf einer einzigen, wiederverwendeten Arbeitsfläche – nach dem Aufwärmen entsteht in einem ganzen Lauf keine Fläche mehr
    expect(stub.created - base).toBe(0);
    expect(inner(r).staged.every((c) => c.has(4))).toBe(true);
  });

  it("Einfärben in Schritten (Rohbild, Stimmung, Dunst, Oberkante) ergibt dieselben Zeichenbefehle wie am Stück – Ebenen und Kulisse, alle Stufen", async () => {
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
        while (!A[k][1].has(stage) && steps < 6) {
          A[k][1].step(stage);
          steps += 1;
        }
        const maxSteps = A[k][0] === "backdrop" ? 4 : A[k][0] === "mid" ? 5 : 3; // Kulisse: Bild, Stimmung, Dunst, Oberkante; Mittelhügel: 3 Teile + Stimmung + Dunst
        expect(steps, `${A[k][0]} Stufe ${stage}: höchstens ${maxSteps} Schritte`).toBeLessThanOrEqual(maxSteps);
        if (A[k][0] === "mid") expect(steps, `mid Stufe ${stage} braucht mehr als einen Schritt für das Rohbild`).toBeGreaterThanOrEqual(stage === 1 || stage === 2 ? 4 : 5);
        const stepwise = (A[k][1].get(stage) as unknown as RecordingCanvas).log;
        const direct = (B[k][1].get(stage) as unknown as RecordingCanvas).log;
        expect(stepwise.length, `${A[k][0]} Stufe ${stage}`).toBeGreaterThan(0);
        expect(stepwise, `${A[k][0]} Stufe ${stage}`).toEqual(direct);
        compared += 1;
      }
    }
    expect(compared).toBe(20);
  });

  it("das Kulissenbild der Folgestufe wird kurz vor dem Vorbacken vordekodiert (einmal je Stufe, ab ~18 % der Stufe)", async () => {
    const { r } = await loaded();
    const spy = vi.spyOn(AlpBackdrop.prototype, "predecode");
    const at = (stage: number, progress: number): void => r.update(1 / 60, stubView({ stage, worldMeters: stage * ALPEN_STAGE_METERS + progress * ALPEN_STAGE_METERS }));
    at(0, 0.1);
    at(0, 0.17);
    expect(spy).not.toHaveBeenCalled();
    at(0, 0.2);
    at(0, 0.3);
    expect(spy.mock.calls).toEqual([[1]]);
    at(1, 0.25);
    expect(spy.mock.calls).toEqual([[1], [2]]);
    at(4, 0.9);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("load dekodiert die Kulissenbilder der Stufen 0 und 1 je in einem eigenen Schritt VOR ihrem ersten Bake", async () => {
    installCanvasStub();
    const r = new AlpenRenderer();
    const seen: string[] = [];
    vi.spyOn(AlpBackdrop.prototype, "predecode").mockImplementation((stage: number) => {
      const bs = inner(r).backdrop.stages;
      seen.push(`predecode${stage}: Stufe 0 ${bs?.has(0) ? "da" : "fehlt"}, Stufe 1 ${bs?.has(1) ? "da" : "fehlt"}`);
      return undefined;
    });
    await r.load(assetsOf(manifestProps(), FAKE_IMAGE));
    expect(seen).toEqual(["predecode0: Stufe 0 fehlt, Stufe 1 fehlt", "predecode1: Stufe 0 da, Stufe 1 fehlt"]);
    expect(inner(r).backdrop.stages?.has(1)).toBe(true);
  });

  it("Mittelhügel: ein angefangenes Rohbild wird bei clear() verworfen und die Stufe danach neu und vollständig aufgebaut", async () => {
    const { r } = await loaded();
    const mid = inner(r).mid;
    mid.clear();
    mid.dropSpare();
    mid.step(3); // erster Teil des Rohbilds
    expect(mid.has(3)).toBe(false);
    mid.clear(); // Skalenwechsel o.ä.: die angefangene Fläche geht als Ersatz an den nächsten Bake
    expect(mid.has(3)).toBe(false);
    let steps = 0;
    while (!mid.has(3) && steps < 8) {
      mid.step(3);
      steps += 1;
    }
    expect(mid.has(3)).toBe(true);
    expect(steps).toBe(5); // Rohbild in drei Teilen, Stimmung, Dunst – wieder von vorn
    // andere Stufe auf der wiederverwendeten Fläche: ebenfalls vollständig
    mid.keep(4, 4);
    for (let k = 0; k < 8 && !mid.has(4); k += 1) mid.step(4);
    expect(mid.has(4)).toBe(true);
    expect(mid.has(3)).toBe(false);
  });

  it("die Stufen-Schritte rastern gleich: Rohbild, Stimmung, Dunst und Bake werden einzeln berührt (touchCanvas)", async () => {
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
    bs.step(3); // Dunst
    expect(rec.touched.length - before).toBe(3);
    expect(bs.has(3)).toBe(false);
    bs.step(3); // weiche Oberkante = Bake
    expect(rec.touched.length - before).toBe(4);
    expect(bs.has(3)).toBe(true);
    // Stufe 1 hat keine Stimmung: Rohbild, dann gleich Dunst, dann der Bake
    bs.step(1);
    bs.step(1);
    expect(bs.has(1)).toBe(false);
    bs.step(1);
    expect(bs.has(1)).toBe(true);
    expect(rec.touched.length - before).toBe(7);
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

describe("Alpen – PropBank: Vorbestellung (early) für Entitäten vor dem Bildrand", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("bei early wird Fehlendes nicht gebacken, sondern vorbestellt (einmal je Sprite); die Warteschlange backt es, danach Treffer", () => {
    const stub = installCanvasStub();
    const bank = new PropBank(manifestProps());
    bank.early = true;
    const n = stub.created;
    const snow = { y0: 5, y1: 90, a0: 0.8 };
    expect(bank.get("alpen-logs", 0.2, { snow })).toBeNull();
    expect(bank.get("alpen-logs", 0.2, { snow: { ...snow } })).toBeNull(); // dieselbe Bestellung (neues Objekt) zählt einmal
    expect(bank.get("alpen-trunk", 0.2)).toBeNull();
    expect(bank.queued).toBe(2);
    expect(bank.ahead.pending).toBe(2);
    expect(stub.created).toBe(n); // im Zeichenpfad entsteht nichts
    expect(bank.size).toBe(0);
    while (!bank.ahead.run(100)) {
      /* abarbeiten */
    }
    expect(bank.queued).toBe(0);
    expect(bank.size).toBe(2);
    // sichtbar: Treffer ohne Neubacken (auch mit neuem Optionsobjekt)
    bank.early = false;
    const made = stub.created;
    expect(bank.get("alpen-logs", 0.2, { snow: { ...snow } })).not.toBeNull();
    expect(bank.get("alpen-trunk", 0.2)).not.toBeNull();
    expect(stub.created).toBe(made);
  });

  it("ohne early backt get am Stück (sichtbare Entität); Props ohne Bild werden auch bei early nicht bestellt", () => {
    const stub = installCanvasStub();
    const bank = new PropBank(manifestProps());
    const n = stub.created;
    expect(bank.get("alpen-cairn", 0.2)).not.toBeNull();
    expect(stub.created).toBeGreaterThan(n);
    bank.early = true;
    expect(bank.get("gibt-es-nicht", 0.2)).toBeNull();
    expect(bank.queued).toBe(0);
  });

  it("jedes frisch gebackene Sprite (auch die Schnee-Variante) wird gleich gerastert (touchCanvas)", () => {
    installCanvasStub();
    const rec = installTouchStub();
    const bank = new PropBank(manifestProps());
    const b = bank.get("alpen-logs", 0.2, { snow: { y0: 5, y1: 90, a0: 0.8 } });
    expect(rec.touched).toEqual([b?.c, b?.snowC]);
    bank.get("alpen-logs", 0.2, { snow: { y0: 5, y1: 90, a0: 0.8 } });
    expect(rec.touched).toHaveLength(2);
  });
});

describe("Alpen – Felsdach (drawLedge) in Teilschritten", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const ledge = (id: number): Ent => ({ id, kind: "overhead", skin: "ledge", x: 0, y: -30, w: 180, h: 420, hb: [0, 0, 180, 420], p: {}, fx: {} }) as unknown as Ent;
  const ctx = (snow = 0): SkinCtx => ({ s: 0, snow, glow: 0, time: 0, reduced: true, quality: 0, groundY: 590 });
  const assets = (): SkinAssets => ({ bank: new PropBank(manifestProps()) }) as unknown as SkinAssets;

  it("fern (early): nichts wird gezeichnet oder angelegt; die Warteschlange baut es in vier Teilschritten, dann liegt es vor", () => {
    const rec = installRecordingStub();
    const A = assets();
    const g = paint(1280, 720, () => undefined).getContext("2d") as CanvasRenderingContext2D;
    const gl = (rec.canvases[0] as RecordingCanvas).log;
    const e = ledge(11);
    A.bank.early = true;
    const n = rec.canvases.length;
    drawLedge(g, A, e, 1400, -30, ctx());
    drawLedge(g, A, e, 1390, -30, ctx()); // nochmal: keine zweite Bestellung
    expect(rec.canvases.length).toBe(n);
    expect(A.bank.ahead.pending).toBe(1);
    expect(gl.filter((l) => l.startsWith("drawImage"))).toHaveLength(0);
    let steps = 0;
    while (!A.bank.ahead.run(0.01)) steps += 1; // Budget 0: genau ein Schritt je Aufruf
    steps += 1;
    expect(steps).toBe(4);
    expect(rec.canvases.length).toBe(n + 1); // eine Fläche, vom ersten Teilschritt angelegt
    // jetzt (auch sichtbar) nur Treffer: gezeichnet wird das fertige Sprite
    A.bank.early = false;
    drawLedge(g, A, e, 600, -30, ctx());
    expect(rec.canvases.length).toBe(n + 1);
    expect(gl.filter((l) => l.startsWith("drawImage"))).toHaveLength(1);
  });

  it("sichtbar ohne Sprite: wird sofort am Stück gebaut und gezeichnet", () => {
    const rec = installRecordingStub();
    const A = assets();
    const g = paint(1280, 720, () => undefined).getContext("2d") as CanvasRenderingContext2D;
    const gl = (rec.canvases[0] as RecordingCanvas).log;
    const n = rec.canvases.length;
    drawLedge(g, A, ledge(12), 600, -30, ctx());
    expect(rec.canvases.length).toBe(n + 1);
    expect(gl.filter((l) => l.startsWith("drawImage"))).toHaveLength(1);
    expect(A.bank.ahead.pending).toBe(0);
  });

  it("Teilschritte und Stück ergeben dieselben Zeichenbefehle (gleiche Zufallsfolge)", () => {
    const rec = installRecordingStub();
    const g = paint(1280, 720, () => undefined).getContext("2d") as CanvasRenderingContext2D;
    const A1 = assets();
    A1.bank.early = true;
    const e1 = ledge(13);
    drawLedge(g, A1, e1, 1400, -30, ctx());
    while (!A1.bank.ahead.run(0.01)) {
      /* Schritte */
    }
    const A2 = assets();
    drawLedge(g, A2, ledge(13), 600, -30, ctx());
    const [, stepped, whole] = rec.canvases as RecordingCanvas[];
    expect(stepped.log.length).toBeGreaterThan(100);
    expect(stepped.log).toEqual(whole.log);
  });

  it("Eis-Wechsel: das alte Sprite bleibt sichtbar, bis das neue in Teilschritten fertig ist (nie ein Neubau im Zeichenpfad)", () => {
    const rec = installRecordingStub();
    const A = assets();
    const g = paint(1280, 720, () => undefined).getContext("2d") as CanvasRenderingContext2D;
    const gl = (rec.canvases[0] as RecordingCanvas).log;
    const e = ledge(14);
    drawLedge(g, A, e, 600, -30, ctx(0)); // Fels, sofort
    const n = rec.canvases.length;
    const drawn = (): number => gl.filter((l) => l.startsWith("drawImage")).length;
    expect(drawn()).toBe(1);
    drawLedge(g, A, e, 600, -30, ctx(1)); // Eis: neu bestellen, das alte Sprite zeichnen
    expect(drawn()).toBe(2);
    expect(A.bank.ahead.pending).toBe(1);
    expect(rec.canvases.length).toBe(n); // noch nichts angelegt
    drawLedge(g, A, e, 600, -30, ctx(1)); // keine zweite Bestellung
    expect(A.bank.ahead.pending).toBe(1);
    while (!A.bank.ahead.run(0.01)) {
      /* Schritte */
    }
    expect(rec.canvases.length).toBe(n + 1);
    drawLedge(g, A, e, 600, -30, ctx(1));
    expect(rec.canvases.length).toBe(n + 1);
    expect(A.bank.ahead.pending).toBe(0);
    // zurück zu Fels (Schneeschmelze/neuer Lauf): wieder in Teilschritten
    drawLedge(g, A, e, 600, -30, ctx(0));
    expect(A.bank.ahead.pending).toBe(1);
  });

  it("Renderer: ein Felsdach kurz vor dem Bildrand bestellt nur vor, `update` baut es, danach nur Treffer", async () => {
    const { r, stub } = await loaded();
    r.update(1 / 60, stubView());
    while (!r.warm(50)) {
      /* aufwärmen */
    }
    const g = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
    const v = stubView();
    const e = ledge(15);
    const n = stub.created;
    expect(r.drawEntity(g, e, v.w + 120, -30, v)).toBe(true);
    expect(stub.created).toBe(n);
    for (let k = 0; k < 8; k += 1) r.update(1 / 60, stubView());
    expect(stub.created).toBe(n + 1);
    expect(r.drawEntity(g, e, 900, -30, v)).toBe(true);
    expect(stub.created).toBe(n + 1);
  });
});

describe("Alpen – ferne Entitäten (early) und Zeichenzustand", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("eine ferne Entität zeichnet ihren Ersatz in save/restore (kein Zustand bleibt für die nächste Entität zurück); eine sichtbare nicht gekapselt", async () => {
    const rec = installRecordingStub();
    const r = new AlpenRenderer();
    await r.load(assetsOf(manifestProps(), FAKE_IMAGE));
    const g = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
    const log = (g.canvas as unknown as RecordingCanvas).log;
    const v = stubView();
    const logs = { id: 21, kind: "block", skin: "logs", x: 0, y: 0, w: 120, h: 90, hb: [0, 0, 120, 90], p: {}, fx: {}, vx: 0 } as unknown as Ent;
    r.update(1 / 60, stubView());
    log.length = 0;
    r.drawEntity(g, logs, v.w + 100, 500, v); // fern: das Sprite fehlt noch (vorbestellt), der Ersatz wird außerhalb gezeichnet
    expect(log[0]).toBe("save()");
    expect(log[log.length - 1]).toBe("restore()");
    expect(log.filter((l) => l === "save()").length).toBe(log.filter((l) => l === "restore()").length);
    log.length = 0;
    r.drawEntity(g, logs, 600, 500, v); // sichtbar: keine zusätzliche Klammer
    expect(log[0]).not.toBe("save()");
    void rec;
  });
});

describe("Alpen – blendMasked in Streifen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("die Streifen decken die ganze Kachel ab; jeder ist maskiert kopiert; wiederholte Aufrufe legen keine Fläche an", () => {
    const rec = installRecordingStub();
    const tile = paint(2048, 150, () => undefined);
    const g = tile.getContext("2d") as CanvasRenderingContext2D;
    blendMasked(g, 2048, 150, "multiply", "#a99ccf", 1); // legt die Arbeitsfläche an (falls noch keine da ist)
    const n = rec.canvases.length;
    const log = (tile as unknown as RecordingCanvas).log;
    log.length = 0;
    blendMasked(g, 2048, 150, "soft-light", "#ff9a70", 0.35);
    blendMasked(g, 2048, 250, "saturation", "#808080", 0.3);
    blendMasked(g, 2048, 360, "multiply", "#a99ccf", 1);
    expect(rec.canvases.length).toBe(n);
    // 150 px = Streifen 0–64, 64–128, 128–150
    const clips = log.filter((l) => l.startsWith("rect(0,"));
    expect(clips.slice(0, 3)).toEqual(["rect(0,0,2048,64)", "rect(0,64,2048,64)", "rect(0,128,2048,22)"]);
    // jeder Streifen kopiert genau seinen Ausschnitt an dieselbe Stelle zurück
    expect(log.filter((l) => l.startsWith("drawImage")).slice(0, 3)).toEqual([
      "drawImage(<canvas 2048x64>,0,0,2048,64,0,0,2048,64)",
      "drawImage(<canvas 2048x64>,0,0,2048,64,0,64,2048,64)",
      "drawImage(<canvas 2048x64>,0,0,2048,22,0,128,2048,22)",
    ]);
    // 150 + 250 + 360 px = 3 + 4 + 6 Streifen
    expect(clips).toHaveLength(13);
  });
});
