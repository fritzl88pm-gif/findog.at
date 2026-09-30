import { it } from "vitest";
import { Bot } from "../../bot";
import { FIXED_DT } from "../../constants";
import { Sim } from "../../sim";
import { WORLDS } from "../index";

it("find", () => {
  const m = Number(process.env.M ?? 1500);
  const wm = Number(process.env.WM ?? 0);
  const seed = Number(process.env.SEED ?? 1);
  const want = (process.env.SKINS ?? "rockfall,updraft,summit-cross,gondola,snowball,deepsnow,cargo,eagle").split(",");
  const sim = new Sim({ mode: "world", world: "alpen", character: "fred", seed, startMeters: m, startWorldMeters: wm }, WORLDS);
  sim.player.hearts = 99;
  sim.begin();
  const bot = new Bot();
  const found = new Map<string, number[]>();
  for (let i = 0; i < 40 / FIXED_DT; i += 1) {
    sim.step(FIXED_DT, bot.input(sim, FIXED_DT));
    sim.events.length = 0;
    if (i % 12 !== 0) continue;
    for (const e of sim.ents) {
      const sx = e.x - sim.dist;
      if (!want.includes(e.skin) || sx < 350 || sx > 900) continue;
      const arr = found.get(e.skin) ?? [];
      if (!arr.length || sim.time - arr[arr.length - 1] > 2) arr.push(Number(sim.time.toFixed(1)));
      found.set(e.skin, arr);
    }
  }
  console.log([...found.entries()].map(([k, v]) => `${k}: ${v.join(",")}`).join("\n"));
});
