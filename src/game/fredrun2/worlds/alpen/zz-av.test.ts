import { it } from "vitest";
import { Bot } from "../../bot";
import { FIXED_DT } from "../../constants";
import { Sim } from "../../sim";
import { WORLDS } from "../index";

it("av", () => {
  const sim = new Sim({ mode: "world", world: "alpen", character: "fred", seed: 1, startMeters: 1000 }, WORLDS);
  sim.player.hearts = 99;
  sim.begin();
  const bot = new Bot();
  const rows: string[] = [];
  for (let i = 0; i < 30 / FIXED_DT; i += 1) {
    sim.step(FIXED_DT, bot.input(sim, FIXED_DT));
    sim.events.length = 0;
    if (i % 60 === 0) {
      const st = (sim.systems[0] as unknown as { state: { phase: string; gapT: number; presence: number } }).state;
      rows.push(`t=${sim.time.toFixed(1)} ${st.phase} gap=${st.gapT.toFixed(2)} pres=${st.presence.toFixed(2)} spd=${sim.speed.toFixed(0)} ref=${sim.speedAtDiff(sim.diff).toFixed(0)} warn=${(sim.vars.chaseWarn ?? 0).toFixed(2)} dash=${sim.player.dashT.toFixed(2)} turbo=${sim.player.turbo.toFixed(1)}`);
    }
  }
  console.log(rows.join("\n"));
});
