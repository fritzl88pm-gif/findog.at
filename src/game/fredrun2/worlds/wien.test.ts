import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXED_DT } from "../constants";
import { createPatternCtx } from "../patterns";
import { Rng } from "../rng";
import { Sim } from "../sim";
import type { EntSpec } from "../types";
import { WORLDS } from "./index";
import { auditPatterns, botRuns } from "./shared-b/audit";
import { FAKE_IMAGE, assetsOf, installCanvasStub, installTouchStub, manifestProps, stubView } from "./shared-b/test-kit";
import type { StageCache } from "./shared-b/layers";
import { WORLD_WIEN } from "./wien";
import { WIEN_STAGE_METERS, WienRenderer } from "./wien/renderer";
import { PropSprites, WIEN_PROP_SIZES, beamWidth, propBake, propBakeJobs } from "./wien/skins";
import type { SizedSprites } from "./wien/cache";
import { WIEN_BACKDROPS } from "./wien/stages";

function build(id: string, diff: number, seed = 1): EntSpec[] {
  const p = WORLD_WIEN.patterns.find((x) => x.id === id);
  if (!p) throw new Error(`Muster ${id} fehlt`);
  const out: EntSpec[] = [];
  const speed = 470 + (1180 - 470) * (1 - Math.exp(-diff / 3.6));
  p.build(createPatternCtx({ speed, diff, groundY: 590, ceilY: 150, rng: new Rng(seed), worldId: "wien", defaultSkin: (k) => k }, out));
  return out;
}

describe("Welt Wien im Sturm", () => {
  it("Metadaten vollständig (8 Katastrophen-Stufen, Originalkulissen)", () => {
    expect(WORLD_WIEN.stageCount).toBe(8);
    expect(WORLD_WIEN.stageMeters).toBe(260);
    expect(WORLD_WIEN.stageNames.length).toBe(WORLD_WIEN.stageCount);
    expect(WIEN_BACKDROPS.length).toBe(WORLD_WIEN.stageCount);
    expect(WORLD_WIEN.mechanics.length).toBeLessThanOrEqual(4);
    expect(WORLD_WIEN.patterns.length).toBeGreaterThanOrEqual(18);
    const ids = new Set(WORLD_WIEN.patterns.map((p) => p.id));
    expect(ids.size).toBe(WORLD_WIEN.patterns.length);
    expect(WORLD_WIEN.propIds).toContain("pigeon-fly");
  });

  it("Hindernis-Props (Poller, Bauzaun, Schutt, Kranträger, Brezel-Schild, Bim) sind in propIds und im Manifest", () => {
    const manifest = JSON.parse(readFileSync("public/fredrun2/props/manifest.json", "utf8")) as { props: Record<string, unknown> };
    const ids = ["wien-poller", "wien-bauzaun", "wien-rubble", "wien-crane-beam", "wien-sign", ...Array.from({ length: 7 }, (_, i) => `wien-tram-n${i}`)];
    for (const id of ids) {
      expect(WORLD_WIEN.propIds).toContain(id);
      expect(manifest.props[id], id).toBeDefined();
    }
  });

  it("Muster-Vielfalt: Einsteiger, schwere Muster und zwei Setpieces", () => {
    const P = WORLD_WIEN.patterns;
    expect(P.filter((p) => p.minDiff <= 1.5).length).toBeGreaterThanOrEqual(3);
    expect(P.filter((p) => p.minDiff >= 5).length).toBeGreaterThanOrEqual(3);
    for (const id of ["wien-ringstrassen-sprint", "wien-einsturz"]) {
      const p = P.find((x) => x.id === id);
      expect(p?.minDiff ?? 0).toBeGreaterThanOrEqual(3);
      expect(build(id, 7).some((s) => s.pickup === "gem")).toBe(true);
    }
  });

  it("alle Muster bauen regelkonform", () => {
    // Ausnahme von der Breitenregel: Straßenbahnen werden nicht übersprungen, sondern „besurft“ (Dach = Plattform).
    const trams = new Set(WORLD_WIEN.patterns.filter((p) => build(p.id, Math.max(p.minDiff, 3)).some((s) => s.skin === "tram-roof")).map((p) => p.id));
    const issues = auditPatterns(WORLD_WIEN, { forbid: ["portal"] }).filter((i) => !(i.msg.startsWith("Block zu breit") && trams.has(i.pattern)));
    if (issues.length) console.log(issues.slice(0, 20));
    expect(issues).toEqual([]);
    // … aber jeder zu breite Block in diesen Mustern MUSS eine Straßenbahn mit begehbarem Dach sein
    for (const id of trams) {
      for (const diff of [3, 6, 9, 12]) {
        for (let seed = 1; seed <= 4; seed += 1) {
          const out = build(id, diff, seed);
          const speed = 470 + (1180 - 470) * (1 - Math.exp(-diff / 3.6));
          const jumpDist = speed * ((2 * 1080) / 2700);
          for (const b of out) {
            if (b.kind !== "block" || b.w <= 0.6 * jumpDist) continue;
            expect(b.skin).toBe("tram");
            expect(b.h).toBeLessThan(216 - 30);
            expect(out.some((r) => r.skin === "tram-roof" && r.kind === "platform" && r.x === b.x && r.w === b.w && r.vx === b.vx)).toBe(true);
          }
        }
      }
    }
  });

  it("Signatur-Mechaniken sind korrekt verdrahtet", () => {
    // Straßenbahn = schädlicher Wagenkasten + begehbares Dach, gleiche Geschwindigkeit, mit Warnpfeil
    const bim = build("wien-bim", 3);
    const body = bim.find((s) => s.skin === "tram");
    const roof = bim.find((s) => s.skin === "tram-roof");
    expect(body?.kind).toBe("block");
    expect(body?.warn).toBe(true);
    expect(body?.vx ?? 0).toBeLessThan(0);
    expect(roof?.kind).toBe("platform");
    expect(roof?.vx).toBe(body?.vx);
    expect(roof?.x).toBe(body?.x);
    // Blitz = Zone mit Vorwarnung ≥ 0.6 s und kurzer aktiver Phase
    const bolt = build("wien-blitz", 3).find((s) => s.skin === "bolt");
    expect(bolt?.kind).toBe("zone");
    const warn = bolt?.cycle?.phases.find((ph) => ph.name === "warn")?.dur ?? 0;
    const active = bolt?.cycle?.phases.find((ph) => ph.name === "active")?.dur ?? 0;
    expect(warn).toBeGreaterThanOrEqual(0.6);
    expect(active).toBeGreaterThan(0.15);
    expect(active).toBeLessThanOrEqual(0.35);
    // Pfütze bremst, Tauben fliegen, Gully ist eine Lücke, späte Ziegel fallen mit Schwerkraft
    const puddle = build("wien-puddle", 1).find((s) => s.skin === "puddle");
    expect(puddle?.kind).toBe("speedzone");
    expect(puddle?.p?.mult).toBeCloseTo(0.72, 2);
    expect(build("wien-tauben", 2).filter((s) => s.skin === "pigeon" && s.kind === "flyer").length).toBeGreaterThanOrEqual(3);
    expect(build("wien-gully", 1).some((s) => s.kind === "pit" && s.skin === "manhole")).toBe(true);
    const brick = build("wien-ziegelregen", 6).find((s) => s.skin === "brick");
    expect(brick?.kind).toBe("projectile");
    expect(brick?.p?.gravity ?? 0).toBeGreaterThan(0);
  });

  it("Weltsystem: Regen-Loop, Gewitter und fair telegrafierte Einschläge", () => {
    const sim = new Sim({ mode: "world", world: "wien", character: "fred", seed: 4, startMeters: 900 }, WORLDS);
    sim.begin();
    sim.player.hearts = 99;
    let bolts = 0;
    let thunder = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 40 / FIXED_DT && sim.phase === "running"; i += 1) {
      sim.step(FIXED_DT, { jump: false, jumpPressed: false, slide: false, slidePressed: false, dashPressed: false });
      for (const ev of sim.events) if (ev.tag === "sfx:thunder") thunder += 1;
      sim.events.length = 0;
      for (const e of sim.ents) {
        if (e.skin !== "bolt" || seen.has(e.id)) continue;
        seen.add(e.id);
        bolts += 1;
        const warn = e.cycle?.phases.find((ph) => ph.name === "warn")?.dur ?? 0;
        expect(warn).toBeGreaterThanOrEqual(0.6);
      }
      if (sim.player.hearts < 50) sim.player.hearts = 99;
    }
    expect(sim.vars["loop:rain"]).toBeGreaterThan(0);
    expect(bolts).toBeGreaterThan(0);
    expect(thunder).toBeGreaterThan(0);
  });

  it("Bot übersteht zusätzliche Seeds", { timeout: 120_000 }, () => {
    const runs = botRuns(WORLDS, "wien", [
      { seed: 3, meters: 0, secs: 40 },
      { seed: 5, meters: 1200, secs: 35 },
      { seed: 9, meters: 2400, secs: 35 },
      { seed: 13, meters: 4000, secs: 30 },
    ]);
    for (const r of runs) if (r.log.length) console.log("wien", r.seed, r.meters, r.log.join("\n  "));
    for (const r of runs) expect(r.hurts).toBeLessThanOrEqual(2);
  });
});

// --- Stufen-Backen, Vorbacken, Skalenwechsel, Blitz-Regler (Canvas-Attrappe, ohne DOM) ----------------------------------

interface WienInternals {
  puffs: SizedSprites;
  steam: SizedSprites;
  reflections: StageCache;
  facades: StageCache;
  roofs: StageCache;
  backdrop: { cache: StageCache };
  skinCtx: { sprites: PropSprites };
  facadeVar: Map<number, unknown>;
  facadeSpares: unknown[];
}

const inner = (r: WienRenderer): WienInternals => r as unknown as WienInternals;

async function loaded(): Promise<{ r: WienRenderer; stub: ReturnType<typeof installCanvasStub> }> {
  const stub = installCanvasStub();
  const r = new WienRenderer();
  await r.load(assetsOf(manifestProps(), FAKE_IMAGE)); // mit Kulissenbild (die Stufen-Flächen werden dann gemalt und wiederverwendet)
  return { r, stub };
}

/** Maße der Hindernisse aus allen Mustern (Schwierigkeit 0,5 … 14, mehrere Seeds) */
function patternSizes(): Map<string, Set<string>> {
  const seen = new Map<string, Set<string>>();
  for (const p of WORLD_WIEN.patterns) {
    for (let diff = 0.5; diff <= 14; diff += 0.5) {
      for (let seed = 1; seed <= 4; seed += 1) {
        const out: EntSpec[] = [];
        const speed = 470 + (1180 - 470) * (1 - Math.exp(-diff / 3.6));
        p.build(createPatternCtx({ speed, diff, groundY: 590, ceilY: 150, rng: new Rng(seed), worldId: "wien", defaultSkin: (k) => k }, out));
        for (const e of out) {
          const key = `${e.kind}:${e.skin}`;
          if (!seen.has(key)) seen.set(key, new Set());
          seen.get(key)?.add(`${Math.round(e.w)}x${Math.round(e.h)}`);
        }
      }
    }
  }
  return seen;
}

describe("Wien – Stufenlänge, Hindernis-Maße", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("WIEN_STAGE_METERS entspricht der Welt-Definition", () => {
    expect(WIEN_STAGE_METERS).toBe(WORLD_WIEN.stageMeters);
  });

  it("alle Hindernis-Maße der Muster stehen in WIEN_PROP_SIZES (nichts wird mitten im Lauf erstmals gebacken)", () => {
    const seen = patternSizes();
    const dims = (key: string, idx: 0 | 1): number[] => [...(seen.get(key) ?? [])].map((x) => Number(x.split("x")[idx]));
    for (const h of dims("block:poller", 1)) expect(WIEN_PROP_SIZES.poller as readonly number[], `poller h=${h}`).toContain(h);
    for (const w of dims("block:bauzaun", 0)) expect(WIEN_PROP_SIZES.bauzaun as readonly number[], `bauzaun w=${w}`).toContain(w);
    for (const w of dims("block:rubble", 0)) expect(WIEN_PROP_SIZES.rubble as readonly number[], `rubble w=${w}`).toContain(w);
    // Kranträger: die Breite hängt vom Tempo ab, gebacken wird in 8-px-Rastern (beamWidth) – die Liste deckt alle Raster ab
    for (const w of dims("overhead:beam", 0)) expect(WIEN_PROP_SIZES.beam as readonly number[], `beam w=${w}`).toContain(beamWidth(w));
    for (const w of dims("swinger:sign", 0)) expect(WIEN_PROP_SIZES.sign as readonly number[], `sign w=${w}`).toContain(w);
  });

  it("PropSprites: Treffer ohne Neubacken, getrennte Ausschnitte, Verdrängung ab 64, Skalen-Hysterese", () => {
    const stub = installCanvasStub();
    const sp = new PropSprites(manifestProps());
    const a = sp.get("wien-poller", 0.1);
    expect(a).not.toBeNull();
    const n = stub.created;
    expect(sp.get("wien-poller", 0.1)).toBe(a);
    expect(sp.get("wien-poller", 0.1000001)).toBe(a); // auf 3 Stellen gerundet
    expect(stub.created).toBe(n);
    // gleiche Größe, anderer Ausschnitt → anderer Eintrag; derselbe Ausschnitt (auch als neues Array) → Treffer
    const crop = sp.get("wien-sign", 0.2, { crop: [0, 0, 100, 100] });
    const crop2 = sp.get("wien-sign", 0.2, { crop: [0, 50, 100, 100] });
    expect(crop).not.toBe(crop2);
    const m = stub.created;
    expect(sp.get("wien-sign", 0.2, { crop: [0, 0, 100, 100] })).toBe(crop);
    expect(sp.get("wien-sign", 0.2, { crop: [0, 0, 100, 100], clip: [[0, 0, 10, 10]] })).not.toBe(crop);
    expect(stub.created).toBeGreaterThan(m);
    // Verdrängung: höchstens 64 Sprites, die ältesten fliegen zuerst raus
    const fresh = new PropSprites(manifestProps());
    const first = fresh.get("wien-poller", 0.05);
    for (let i = 1; i <= 70; i += 1) fresh.get("wien-bauzaun", 0.05 + i * 0.001);
    expect(fresh.size).toBeLessThanOrEqual(64);
    const before = stub.created;
    expect(fresh.get("wien-poller", 0.05)).not.toBe(first); // war verdrängt → neu gebacken
    expect(stub.created).toBeGreaterThan(before);
    // Skala: Änderungen innerhalb von 0,2 ändern nichts, darüber wird neu gebacken
    const s1 = new PropSprites(manifestProps());
    const x = s1.get("wien-rubble", 0.3);
    s1.setScale(1.15);
    expect(s1.get("wien-rubble", 0.3)).toBe(x);
    s1.setScale(1.5);
    expect(s1.get("wien-rubble", 0.3)).not.toBe(x);
    expect(s1.scale).toBe(1.5);
  });

  it("propBakeJobs backt jedes bekannte Sprite genau einmal vor; die Skins finden danach nur Treffer", () => {
    const stub = installCanvasStub();
    const sp = new PropSprites(manifestProps());
    const jobs = propBakeJobs(sp);
    expect(jobs.length).toBeGreaterThan(10);
    for (const j of jobs) j();
    const after = stub.created;
    const size = sp.size;
    expect(size).toBeGreaterThanOrEqual(10);
    // zweiter Durchlauf und alle Maße aus den Mustern: keine neuen Flächen
    for (const j of jobs) j();
    for (const h of WIEN_PROP_SIZES.poller) propBake.poller(sp, h);
    for (const w of WIEN_PROP_SIZES.bauzaun) propBake.bauzaun(sp, w);
    for (const w of WIEN_PROP_SIZES.rubble) propBake.rubble(sp, w);
    for (const bw of WIEN_PROP_SIZES.beam) propBake.beamAt(sp, bw);
    for (let w = 196; w <= 262; w += 1) propBake.beam(sp, w); // jede Hitbox-Breite in diesem Bereich trifft ein vorgebackenes Raster
    for (const w of WIEN_PROP_SIZES.sign) {
      propBake.signBody(sp, w);
      propBake.signBracket(sp, w);
    }
    expect(stub.created).toBe(after);
    expect(sp.size).toBe(size);
  });
});

describe("Wien – Weltladen, Stufen-Backen, Aufwärmen, Skalenwechsel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("load backt die Stufen 0 und 1 aller Caches (Ergebnis-Caches wie zuvor)", async () => {
    const { r } = await loaded();
    const i = inner(r);
    for (const c of [i.backdrop.cache, i.facades, i.roofs, i.reflections]) {
      expect(c.has(0)).toBe(true);
      expect(c.has(1)).toBe(true);
      expect(c.has(2)).toBe(false);
    }
  });

  it("die Folgestufe wird erst ab ~28 % der Stufe und gedrosselt gebacken", async () => {
    const { r } = await loaded();
    const i = inner(r);
    let clock = 10_000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const at = (progress: number): void => r.update(1 / 60, stubView({ stage: 1, worldMeters: 260 + progress * 260 }));
    at(0.02);
    at(0.2);
    expect(i.backdrop.cache.has(2) || i.facades.has(2) || i.roofs.has(2)).toBe(false);
    at(0.3);
    const count = (): number => [i.backdrop.cache, i.facades, i.roofs, i.reflections].filter((c) => c.has(2)).length;
    expect(count()).toBe(1); // ein Schritt (Backdrop), nicht alle auf einmal
    at(0.31); // innerhalb der Lücke (< 100 ms): nichts Neues
    expect(count()).toBe(1);
    clock += 120;
    at(0.31);
    expect(i.facades.has(2)).toBe(false); // Fassade: erst die Vorarbeit (Rohvariante) …
    clock += 120;
    at(0.32);
    expect(i.facades.has(2)).toBe(true); // … dann der Bake
    for (let k = 0; k < 8; k += 1) {
      clock += 120;
      at(0.4 + k * 0.01);
    }
    for (const c of [i.backdrop.cache, i.facades, i.roofs, i.reflections]) expect(c.has(2)).toBe(true);
  });

  it("ein ganzer Lauf durch alle 8 Stufen legt kaum neue Flächen an (verworfene Stufen werden wiederverwendet)", async () => {
    const { r, stub } = await loaded();
    const i = inner(r);
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const base = stub.created;
    for (let st = 0; st <= 7; st += 1) {
      for (let p = 0; p < 1; p += 0.05) {
        clock += 120;
        r.update(1 / 60, stubView({ stage: st, stageBlend: p > 0.75 ? (p - 0.75) * 4 : 0, worldMeters: st * WIEN_STAGE_METERS + p * WIEN_STAGE_METERS }));
      }
    }
    // ohne `warm` backt der Lauf auch die Rauchgrößen (je eine pro ~100 ms, sobald Rauchsäulen bald erscheinen)
    expect(i.puffs.baked).toBe(i.puffs.count);
    // Rohvarianten: Fassade 1 und Dächer 1–2 gibt es je einmal neu; alle späteren Fassaden nutzen die verworfenen Flächen
    // (ohne Wiederverwendung wären es > 25)
    expect(stub.created - base - i.puffs.baked).toBeLessThanOrEqual(4);
    for (const c of [i.backdrop.cache, i.facades, i.roofs]) expect(c.has(7)).toBe(true);
  });

  it("nach dem Aufwärmen legt ein ganzer Lauf durch alle 8 Stufen nur die erstmaligen Roh-Varianten und die großen Rauchgrößen an", async () => {
    const { r, stub } = await loaded();
    const i = inner(r);
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    r.update(1 / 60, stubView());
    while (!r.warm(50)) {
      /* aufwärmen (Hub: Countdown/Menü-Demo) */
    }
    const warmed = i.puffs.baked;
    const base = stub.created;
    for (let st = 0; st <= 7; st += 1) {
      for (let p = 0; p < 1; p += 0.05) {
        clock += 120;
        r.update(1 / 60, stubView({ stage: st, stageBlend: p > 0.75 ? (p - 0.75) * 4 : 0, worldMeters: st * WIEN_STAGE_METERS + p * WIEN_STAGE_METERS }));
      }
    }
    // erstmals im Lauf: Roh-Fassade 1 sowie Roh-Dächer 1 und 2 (Fassaden 2–5 nutzen die verworfenen Flächen) …
    // … und die vier größten Rauchgrößen, die `warm` bewusst auslässt (Speicher)
    expect(i.puffs.baked - warmed).toBe(4);
    expect(stub.created - base - (i.puffs.baked - warmed)).toBeLessThanOrEqual(3);
  });

  it("die großen Rauchgrößen werden erst kurz vor den ersten Rauchsäulen gebacken, einzeln und gedrosselt", async () => {
    const { r } = await loaded();
    const i = inner(r);
    r.update(1 / 60, stubView());
    while (!r.warm(50)) {
      /* aufwärmen */
    }
    const warmed = i.puffs.baked;
    expect(warmed).toBe(10); // 48 … 336 px
    // Stufe 0, erste Hälfte: nichts
    for (let k = 0; k < 20; k += 1) r.update(0.05, stubView({ stage: 0, worldMeters: 100 }));
    expect(i.puffs.baked).toBe(warmed);
    // Stufe 0 ab der Hälfte: eine Größe je 0,1 s Spielzeit (hier 2 Aufrufe à 0,05 s)
    r.update(0.05, stubView({ stage: 0, worldMeters: 140 }));
    expect(i.puffs.baked).toBe(warmed + 1);
    r.update(0.05, stubView({ stage: 0, worldMeters: 140 }));
    expect(i.puffs.baked).toBe(warmed + 1);
    r.update(0.05, stubView({ stage: 0, worldMeters: 140 }));
    expect(i.puffs.baked).toBe(warmed + 2);
    for (let k = 0; k < 20; k += 1) r.update(0.05, stubView({ stage: 1, worldMeters: 300 }));
    expect(i.puffs.baked).toBe(i.puffs.count);
  });

  it("nicht mehr benötigte Roh-Fassaden werden schon beim Stufenwechsel freigegeben und stehen als Spare bereit", async () => {
    const { r } = await loaded();
    const i = inner(r);
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    // Stufe 0: Rohvariante 0 (Stufen 0 und 1 teilen sie)
    r.update(1 / 60, stubView({ stage: 0, worldMeters: 10 }));
    expect([...i.facadeVar.keys()]).toEqual([0]);
    // Stufe 1 ab 28 %: Vorarbeit der Fassade für Stufe 2 → Rohvariante 1 (neu)
    for (let k = 0; k < 6; k += 1) {
      clock += 120;
      r.update(1 / 60, stubView({ stage: 1, worldMeters: WIEN_STAGE_METERS * 1.4 }));
    }
    expect([...i.facadeVar.keys()].sort()).toEqual([0, 1]);
    expect(i.facadeSpares).toHaveLength(0);
    // Stufenwechsel auf 2: Variante 0 ist nicht mehr nötig (a = 1, b = 2) – sofort freigeben, nicht erst mit der dritten
    clock += 120;
    r.update(1 / 60, stubView({ stage: 2, worldMeters: WIEN_STAGE_METERS * 2 + 1 }));
    expect([...i.facadeVar.keys()]).toEqual([1]);
    expect(i.facadeSpares).toHaveLength(1);
  });

  it("die Stufen-Flächen und gemalten Roh-/Sprite-Flächen werden beim Backen gleich gerastert (touchCanvas)", async () => {
    const rec = installTouchStub();
    const { r } = await loaded();
    const i = inner(r);
    // load backt die Stufen 0 und 1 aller Caches (4 Caches × 2 Stufen = 8 Stufen-Flächen) und die Roh-Fassade 0
    expect(rec.touched.length).toBeGreaterThanOrEqual(8);
    const before = rec.touched.length;
    r.update(1 / 60, stubView());
    while (!r.warm(50)) {
      /* aufwärmen */
    }
    // warm: 10 Rauchgrößen, 12 Dampfgrößen und die Hindernis-Sprites kommen hinzu
    expect(rec.touched.length - before).toBeGreaterThanOrEqual(i.puffs.baked + i.steam.baked + 10);
  });

  it("warm backt Rauch-/Dampfgrößen, Hindernis-Sprites und Leuchtflächen vor – danach ist nichts mehr zu tun", async () => {
    const { r, stub } = await loaded();
    r.update(1 / 60, stubView());
    const i = inner(r);
    expect(i.puffs.baked).toBe(0);
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += 1)); // jeder Zeitabruf kostet 1 ms → Zeitscheiben
    let rounds = 0;
    while (!r.warm(3) && rounds < 500) rounds += 1;
    expect(rounds).toBeLessThan(500);
    expect(rounds).toBeGreaterThan(5); // in Zeitscheiben, nicht am Stück
    // Rauch bis 336 px (10 Größen), die vier größten (2,8 MB) folgen erst vor den Rauchsäulen; Dampf vollständig
    expect(i.puffs.baked).toBe(10);
    expect(i.steam.baked).toBe(i.steam.count);
    expect(i.skinCtx.sprites.size).toBeGreaterThanOrEqual(10);
    const done = stub.created;
    expect(r.warm(3)).toBe(true);
    expect(stub.created).toBe(done);
    // Rauch bis 336 px und Dampf in allen Größen zeichnen: keine neuen Flächen
    for (let s = 40; s <= 340; s += 9) i.puffs.get(s);
    for (let s = 20; s <= 240; s += 9) i.steam.get(s);
    expect(stub.created).toBe(done);
  });

  it("warm vor dem Laden hat nichts zu tun", () => {
    installCanvasStub();
    expect(new WienRenderer().warm(3)).toBe(true);
  });

  it("resize ist idempotent und baut bei echter Änderung genau einmal neu", async () => {
    const { r, stub } = await loaded();
    const run = (): void => r.update(1 / 60, stubView());
    run();
    const base = stub.created;
    r.resize(1);
    r.resize(1);
    r.resize(1.1); // innerhalb von 0,2 → keine Änderung
    r.resize(1.19);
    run();
    run();
    expect(stub.created).toBe(base);
    r.resize(1.5);
    run();
    const built = stub.created - base;
    expect(built).toBeGreaterThan(0); // Nah-Sprites (Laternen, Masten, Bäume …) in neuer Pixeldichte
    r.resize(1.5);
    r.resize(1.45);
    run();
    run();
    expect(stub.created - base).toBe(built);
    r.resize(2);
    run();
    expect(stub.created - base).toBe(built * 2);
    r.resize(2);
    run();
    expect(stub.created - base).toBe(built * 2);
  });

  it("Skalenwechsel mit Warteschlange: Hindernis-Sprites werden für die neue Skala wieder vorgebacken", async () => {
    const { r } = await loaded();
    r.update(1 / 60, stubView());
    while (!r.warm(50)) {
      /* aufwärmen */
    }
    const sp = inner(r).skinCtx.sprites;
    const n = sp.size;
    expect(n).toBeGreaterThanOrEqual(10);
    r.resize(1.5);
    expect(sp.size).toBe(0); // verworfen
    while (!r.warm(50)) {
      /* erneut */
    }
    expect(sp.size).toBe(n);
  });

  it("Q0: Spiegelungen werden weder vorgehalten noch gebacken, ab Q1 wieder", async () => {
    const { r } = await loaded();
    const i = inner(r);
    expect(i.reflections.has(0)).toBe(true);
    r.update(1 / 60, stubView({ quality: 0 }));
    expect(i.reflections.has(0)).toBe(false);
    r.update(1 / 60, stubView({ quality: 0, stage: 0, worldMeters: 200 }));
    expect(i.reflections.has(0)).toBe(false);
    expect(i.reflections.has(1)).toBe(false);
    r.update(1 / 60, stubView({ quality: 1 }));
    expect(i.reflections.has(0)).toBe(true);
  });
});

describe("Wien – Blitz-Regler (flashScale)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Alpha der Szenen-Aufhellung (Vordergrund) nach einem Frame mit vars.lightning = 1; null = keine Aufhellung */
  async function flashAlpha(over: Partial<ReturnType<typeof stubView>>): Promise<number | null> {
    const { r } = await loaded();
    const v = stubView({ vars: { lightning: 1 }, ...over });
    r.update(1 / 60, v);
    const g = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
    r.drawForeground(g, v);
    const m = /^rgba\(120,140,190,([0-9.]+)\)$/.exec(String(g.fillStyle));
    return m ? Number(m[1]) : null;
  }

  it("ohne Feld / Standard 1: wie bisher (0,12)", async () => {
    expect(await flashAlpha({})).toBeCloseTo(0.12, 6);
    expect(await flashAlpha({ flashScale: 1 })).toBeCloseTo(0.12, 6);
  });

  it("flashScale 0,3 dämpft auf 30 %", async () => {
    expect(await flashAlpha({ flashScale: 0.3 })).toBeCloseTo(0.036, 6);
  });

  it("flashScale 0: kein Blitz-Aufheller", async () => {
    expect(await flashAlpha({ flashScale: 0 })).toBeNull();
  });

  it("„Weniger Bewegung“ ohne flashScale: wie bisher 25 %; mit gekapptem flashScale ersetzt dieser Wert das Dämpfen (keine Doppel-Skalierung)", async () => {
    expect(await flashAlpha({ reducedMotion: true })).toBeCloseTo(0.03, 6);
    expect(await flashAlpha({ reducedMotion: true, flashScale: 0.3 })).toBeCloseTo(0.036, 6);
    expect(await flashAlpha({ reducedMotion: true, flashScale: 0.1 })).toBeCloseTo(0.012, 6);
    expect(await flashAlpha({ reducedMotion: true, flashScale: 0 })).toBeNull();
  });

  it("„Weniger Bewegung“: höchstens 0,3, auch wenn der Aufrufer flashScale nicht kappt (sim.view liefert Standard 1)", async () => {
    expect(await flashAlpha({ reducedMotion: true, flashScale: 1 })).toBeCloseTo(0.036, 6);
    expect(await flashAlpha({ reducedMotion: true, flashScale: 0.6 })).toBeCloseTo(0.036, 6);
  });

  it("Fernblitz: bei „Weniger Bewegung“ nie gezeichnet, sonst mit flashScale skaliert", async () => {
    const { r } = await loaded();
    const farBolt = vi.spyOn(r as unknown as { drawFarBolt: (...a: unknown[]) => void }, "drawFarBolt").mockImplementation(() => undefined);
    const g = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
    const draw = (over: Partial<ReturnType<typeof stubView>>): void => {
      const v = stubView({ vars: { farBolt: 1 }, ...over });
      r.update(1 / 60, v);
      r.drawBackground(g, v);
    };
    draw({});
    expect(farBolt).toHaveBeenCalledTimes(1);
    expect(farBolt.mock.calls[0][2]).toBeCloseTo(1, 6);
    draw({ flashScale: 0.3 });
    expect(farBolt.mock.calls[1][2]).toBeCloseTo(0.3, 6);
    draw({ flashScale: 0 });
    expect(farBolt).toHaveBeenCalledTimes(2);
    draw({ reducedMotion: true, flashScale: 1 });
    expect(farBolt).toHaveBeenCalledTimes(2);
  });
});
