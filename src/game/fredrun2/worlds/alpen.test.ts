import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../constants";
import { Sim } from "../sim";
import { WORLD_ALPEN } from "./alpen";
import { AVALANCHE_MIN_DIFF, AVALANCHE_MIN_STAGE, AlpenSystem } from "./alpen/system";
import { WORLDS } from "./index";
import { auditPatterns, botRuns } from "./shared-b/audit";

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
