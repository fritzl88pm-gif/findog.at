import { it } from "vitest";
import { Bot } from "../../bot";
import { FIXED_DT, PLAYER_SX } from "../../constants";
import { Sim } from "../../sim";
import { WORLDS } from "../index";
import type { WorldId } from "../../types";

const world = (process.env.W ?? "alpen") as WorldId;
const runs: Array<[number, number, number]> = (process.env.RUNS ?? "0:70:11").split(",").map((s) => s.split(":").map(Number) as [number, number, number]);
it("diag", { timeout: 600_000 }, () => {
  for (const [m, secs, seed] of runs) {
    const sim = new Sim({ mode: "world", world, character: (process.env.CH ?? "fred") as never, seed, startMeters: m, startWorldMeters: Number(process.env.WM ?? 0) }, WORLDS);
    sim.begin();
    sim.player.hearts = 3;
    const bot = new Bot();
    const hist: string[] = [];
    const log: string[] = [];
    for (let i = 0; i < secs / FIXED_DT && sim.phase === "running"; i += 1) {
      sim.step(FIXED_DT, bot.input(sim, FIXED_DT));
      if (i % 5 === 0) {
        const p = sim.player;
        const px = sim.playerWorldX;
        const pit = sim.ents.find((e) => e.kind === "pit" && px > e.x && px < e.x + e.w);
        hist.push(`t=${sim.time.toFixed(2)} x=${px.toFixed(0)} hgt=${p.hgt.toFixed(0)} vy=${p.vy.toFixed(0)} gr=${p.grounded ? 1 : 0} plat=${p.onPlatform ? p.onPlatform.skin + ":" + p.onPlatform.state : "-"} pit=${pit ? pit.pat + "@" + (px - pit.x).toFixed(0) + "/" + pit.w.toFixed(0) : "-"} plan=${bot.lastPlanName} spd=${sim.speed.toFixed(0)} av=${(sim.vars.avalancheT ?? 0).toFixed(2)}`);
        if (hist.length > 60) hist.shift();
      }
      for (const ev of sim.events) if (ev.type === "hurt" || ev.type === "pit-fall") {
        log.push(`${sim.meters.toFixed(0)}m ${ev.type}:${ev.tag ?? ""}\n    ` + hist.slice(-45).join("\n    "));
        const px = sim.playerWorldX;
        const near = sim.ents.filter((e) => e.kind !== "pickup" && Math.abs(e.x - px) < 1500).map((e) => `${e.kind}/${e.skin}/${e.pat} x=${(e.x - px).toFixed(0)} w=${e.w.toFixed(0)} y=${e.y.toFixed(0)} st=${e.state}`);
        log.push("    ents: " + near.join("\n          "));
      }
      sim.events.length = 0;
      if (sim.player.hearts < 3) sim.player.hearts = 3;
    }
    console.log(`[${world} start ${m}m seed ${seed}] reached ${sim.meters.toFixed(0)}m diff ${sim.diff.toFixed(2)} hurts ${sim.stats.hurts}\n  ${log.join("\n  ")}`);
    void PLAYER_SX;
  }
});
