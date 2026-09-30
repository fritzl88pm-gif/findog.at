import { describe, expect, it } from "vitest";
import { FIXED_DT, METERS_PER_DIFFICULTY, PLAYER_SX } from "../constants";
import { Bot } from "../bot";
import { createPatternCtx } from "../patterns";
import { Rng } from "../rng";
import { Sim } from "../sim";
import type { EntSpec, PatternDef } from "../types";
import { WORLDS } from "./index";
import { auditPatterns, botRuns } from "./shared-b/audit";
import { WORLD_WACHAU } from "./wachau";
import { landT } from "./wachau/patterns";

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
