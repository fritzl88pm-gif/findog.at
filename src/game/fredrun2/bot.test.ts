import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { describe, expect, it } from "vitest";
import { Bot } from "./bot";
import { FIXED_DT } from "./constants";
import { Sim } from "./sim";
import { WORLDS } from "./worlds";
import type { RunConfig, WorldId } from "./types";

export interface BotReport {
  survivedSeconds: number;
  meters: number;
  hurts: number;
  hurtLog: string[];
  phase: string;
  coins: number;
}

export function playWithBot(cfg: Partial<RunConfig>, seconds: number, hearts = 3): BotReport {
  const sim = new Sim({ mode: "world", world: "wien", character: "fred", seed: 7, ...cfg }, WORLDS);
  sim.begin();
  sim.player.hearts = hearts;
  const bot = new Bot();
  const hurtLog: string[] = [];
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps && sim.phase === "running"; i += 1) {
    const input = bot.input(sim, FIXED_DT);
    sim.step(FIXED_DT, input);
    for (const ev of sim.events) {
      if (ev.type === "hurt" || ev.type === "pit-fall") {
        // Muster-ID der nächstliegenden schädlichen Entität ermitteln
        const near = sim.ents
          .filter((e) => e.harmful || e.kind === "pit")
          .sort((a, b) => Math.abs(a.x + a.w / 2 - sim.playerWorldX) - Math.abs(b.x + b.w / 2 - sim.playerWorldX))[0];
        hurtLog.push(`${sim.meters.toFixed(0)}m ${ev.type}:${ev.tag ?? ""} pat=${near?.pat ?? "?"} skin=${near?.skin ?? "?"} plan=${bot.lastPlanName}`);
      }
    }
    sim.events.length = 0;
    // Bot spielt "perfekt": Herzen auffüllen, damit alle Muster getestet werden
    if (sim.player.hearts < hearts) sim.player.hearts = hearts;
  }
  return {
    survivedSeconds: sim.time,
    meters: sim.meters,
    hurts: sim.stats.hurts,
    hurtLog,
    phase: sim.phase,
    coins: sim.stats.coins,
  };
}

const WORLDS_TO_TEST = (process.env.BOT_WORLDS?.split(",") as WorldId[] | undefined) ?? (Object.keys(WORLDS) as WorldId[]);

describe("Bot: Level-Generator ist lösbar", () => {
  for (const world of WORLDS_TO_TEST) {
    it(`${world}: früh (0–800 m)`, { timeout: 120_000 }, () => {
      const r = playWithBot({ world, seed: 11 }, 70);
      if (r.hurtLog.length) console.log(world, "early", r.hurtLog.join("\n  "));
      expect(r.hurts).toBeLessThanOrEqual(1);
    });
    it(`${world}: schwer (3000 m)`, { timeout: 120_000 }, () => {
      const r = playWithBot({ world, seed: 23, startMeters: 3000 }, 45);
      if (r.hurtLog.length) console.log(world, "hard", r.hurtLog.join("\n  "));
      expect(r.hurts).toBeLessThanOrEqual(2);
    });
  }
});

describe("Bot: Weltreise (Tour)", () => {
  it("durchquert Tore und wechselt die Welten", { timeout: 240_000 }, () => {
    const sim = new Sim({ mode: "tour", world: "wien", character: "fred", seed: 5 }, WORLDS);
    sim.begin();
    sim.player.hearts = 99;
    const bot = new Bot();
    const visited = new Set<string>();
    for (let i = 0; i < 400 / FIXED_DT && sim.phase === "running"; i += 1) {
      sim.step(FIXED_DT, bot.input(sim, FIXED_DT));
      sim.events.length = 0;
      visited.add(sim.world.id);
      if (visited.size >= 3) break;
    }
    expect(visited.size).toBeGreaterThanOrEqual(3);
    expect(sim.stats.worldsVisited.length).toBeGreaterThanOrEqual(3);
  });
});

/** Kein Pass/Fail-Kriterium, sondern Fairness-Audit: schafft ein „menschlicher“ Bot (0.2 s Reaktion, begrenzte Sicht) die Welten? */
describe.skipIf(!process.env.BOT_AUDIT)("Bot: menschlicher Fairness-Audit", () => {
  for (const world of WORLDS_TO_TEST) {
    it(`${world}`, { timeout: 300_000 }, () => {
      const rows: string[] = [];
      for (const [meters, secs] of [[0, 60], [1500, 45], [3500, 45], [6000, 40]] as const) {
        const sim = new Sim({ mode: "world", world, character: "fred", seed: 99, startMeters: meters }, WORLDS);
        sim.begin();
        sim.player.hearts = 3;
        const bot = new Bot({ reaction: 0.2, vision: 900 });
        const start = sim.meters;
        let lost = 0;
        for (let i = 0; i < secs / FIXED_DT && sim.phase === "running"; i += 1) {
          sim.step(FIXED_DT, bot.input(sim, FIXED_DT));
          for (const ev of sim.events) if (ev.type === "hurt" || ev.type === "pit-fall") lost += 1;
          sim.events.length = 0;
          if (sim.player.hearts < 3 && sim.player.hearts > 0 && sim.time % 20 < 0.01) sim.player.hearts = 3;
        }
        rows.push(`${meters}m: ${(sim.meters - start).toFixed(0)}m in ${sim.time.toFixed(0)}s, Treffer ${lost}, Phase ${sim.phase}`);
      }
      console.log(`[audit ${world}]\n  ${rows.join("\n  ")}`);
      require("node:fs").appendFileSync("/tmp/fr2-audit.txt", `[${world}] ${rows.join(" | ")}\n`);
    });
  }
});
