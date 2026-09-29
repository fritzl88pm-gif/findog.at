import { it } from "vitest";
import { Bot } from "/home/user/findog.at/src/game/fredrun2/bot";
import { FIXED_DT } from "/home/user/findog.at/src/game/fredrun2/constants";
import { Sim } from "/home/user/findog.at/src/game/fredrun2/sim";
import { WORLDS } from "/home/user/findog.at/src/game/fredrun2/worlds";
import type { WorldId } from "/home/user/findog.at/src/game/fredrun2/types";

const world = (process.env.W ?? "wien") as WorldId;
const runs: Array<[number, number, number]> = (process.env.RUNS ?? "0:70:11,3000:45:23").split(",").map((s) => s.split(":").map(Number) as [number, number, number]);
it("diag", { timeout: 600_000 }, () => {
  for (const [m, secs, seed] of runs) {
    const sim = new Sim({ mode: "world", world, character: (process.env.CH ?? "fred") as never, seed, startMeters: m }, WORLDS);
    sim.begin();
    sim.player.hearts = 3;
    const bot = new Bot();
    const pats = new Map<string, number>();
    const seen = new Set<number>();
    const log: string[] = [];
    for (let i = 0; i < secs / FIXED_DT && sim.phase === "running"; i += 1) {
      sim.step(FIXED_DT, bot.input(sim, FIXED_DT));
      for (const e of sim.ents) if (!seen.has(e.id)) { seen.add(e.id); if (e.pat) pats.set(e.pat, (pats.get(e.pat) ?? 0) + (e.kind === "pickup" ? 0 : 1)); }
      for (const ev of sim.events) if (ev.type === "hurt" || ev.type === "pit-fall") {
        const near = sim.ents.filter((e) => e.harmful || e.kind === "pit").sort((a, b) => Math.abs(a.x + a.w / 2 - sim.playerWorldX) - Math.abs(b.x + b.w / 2 - sim.playerWorldX))[0];
        log.push(`${sim.meters.toFixed(0)}m ${ev.type}:${ev.tag ?? ""} pat=${near?.pat ?? "?"} skin=${near?.skin} plan=${bot.lastPlanName} spd=${sim.speed.toFixed(0)} hgt=${sim.player.hgt.toFixed(0)}`);
      }
      sim.events.length = 0;
      if (sim.player.hearts < 3) sim.player.hearts = 3;
    }
    console.log(`[${world} start ${m}m seed ${seed}] reached ${sim.meters.toFixed(0)}m diff ${sim.diff.toFixed(2)} hurts ${sim.stats.hurts} coins ${sim.stats.coins}\n  pats: ${[...pats.entries()].map(([k, v]) => `${k}:${v}`).join(" ")}\n  ${log.join("\n  ")}`);
  }
});
