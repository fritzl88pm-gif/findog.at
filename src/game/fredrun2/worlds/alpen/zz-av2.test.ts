import { it } from "vitest";
import { FIXED_DT } from "../../constants";
import { Sim } from "../../sim";
import { WORLDS } from "../index";
import { AlpenSystem } from "./system";

it("av2", () => {
  const sim = new Sim({ mode: "world", world: "alpen", character: "fred", seed: 8, startMeters: 1400, startWorldMeters: 900 }, WORLDS);
  sim.begin();
  sim.noSpawn = true;
  sim.ents = [];
  sim.player.hearts = 5;
  const sys = sim.systems.find((s): s is AlpenSystem => s instanceof AlpenSystem) as AlpenSystem;
  const idle = { jump: false, jumpPressed: false, slide: false, slidePressed: false, dashPressed: false };
  for (let i = 0; i < 60 / FIXED_DT && sys.state.phase !== "chase"; i += 1) sim.step(FIXED_DT, idle);
  const rows: string[] = [];
  for (let k = 0; k < 3; k += 1) {
    sim.player.invuln = 0;
    sim.hurt("test");
    for (let i = 0; i < 0.45 / FIXED_DT; i += 1) {
      sim.step(FIXED_DT, idle);
      if (i % 12 === 0) rows.push(`k${k} gap=${sys.state.gapT.toFixed(3)} spd=${sim.speed.toFixed(0)} hearts=${sim.player.hearts} inv=${sim.player.invuln.toFixed(2)}`);
    }
  }
  for (let i = 0; i < 3 / FIXED_DT; i += 1) {
    sim.step(FIXED_DT, idle);
    if (i % 24 === 0) rows.push(`after gap=${sys.state.gapT.toFixed(3)} spd=${sim.speed.toFixed(0)} hearts=${sim.player.hearts} inv=${sim.player.invuln.toFixed(2)} ph=${sys.state.phase}`);
  }
  console.log(rows.join("\n"));
});
