import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { describe, expect, it } from "vitest";
import { Bot } from "./bot";
import { FIXED_DT, GRAVITY, METERS_PER_DIFFICULTY, STOMP_BOUNCE_V } from "./constants";
import { createPatternCtx } from "./patterns";
import { Rng } from "./rng";
import { Sim } from "./sim";
import { ENEMY_PATTERNS } from "./spawner";
import { WORLDS } from "./worlds";
import type { EntSpec, RunConfig, WorldId } from "./types";

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

/** Zeit (Sek.), die ein Stampf-Bounce bis zur selben Höhe braucht (Formel aus Sim.bounce: v = STOMP_BOUNCE_V + min(4, Kette)·40). */
function bounceSeconds(chain: number): number {
  return (2 * (STOMP_BOUNCE_V + Math.min(4, chain) * 40)) / GRAVITY;
}

/** Baut das Muster „guest-stomp-chain“ bei Schwierigkeit `diff` und liefert die Specs (x relativ zum Musterstart). */
function buildChain(diff: number, speed: number, seed: number): EntSpec[] {
  const chain = ENEMY_PATTERNS.find((p) => p.id === "guest-stomp-chain");
  if (!chain) throw new Error("guest-stomp-chain fehlt");
  const specs: EntSpec[] = [];
  const ctx = createPatternCtx({ speed, diff, groundY: 600, ceilY: 80, rng: new Rng(seed), worldId: "wien", defaultSkin: (k) => k }, specs);
  chain.build(ctx);
  return specs;
}

describe("Muster: guest-stomp-chain (feel-core-08)", () => {
  it("Kettenabstand × Tempo ≥ Bounce-Strecke (ein Bounce passt zwischen zwei Gegner)", () => {
    for (const diff of [1.2, 2.5, 5, 5.1, 8, 14, 20]) {
      const speed = 480 + diff * 25; // beliebiges, steigendes Tempo – die Ungleichung ist tempo-unabhängig (beides ∝ v)
      const walkers = buildChain(diff, speed, 1).filter((e) => e.kind === "walker");
      expect(walkers.length).toBe(diff > 5 ? 4 : 3);
      for (let i = 1; i < walkers.length; i += 1) {
        const gapPx = walkers[i].x - walkers[i - 1].x;
        // Nach dem i-ten Stampfer (Kette i) muss der Bounce-Bogen kürzer sein als der Abstand zum nächsten Gegner
        expect(gapPx).toBeGreaterThanOrEqual(speed * bounceSeconds(i));
      }
    }
    // Gegenprobe: der alte Takt (0,58 s) lag unter der Bounce-Dauer – der Test hat also Biss
    expect(0.58).toBeLessThan(bounceSeconds(1));
  });

  /** Ein Bot mit 0,3 s Reaktion läuft auf eine einzelne Kette zu; Rückgabe: Treffer (Herzen), die er dabei verliert. */
  function chainTrial(specs: EntSpec[], seed: number, diff: number): number {
    const sim = new Sim({ mode: "world", world: "wien", character: "fred", seed, startMeters: diff * METERS_PER_DIFFICULTY }, WORLDS);
    sim.begin();
    sim.noSpawn = true;
    sim.ents = [];
    sim.player.hearts = 99;
    const origin = sim.playerWorldX + 1000;
    let last = 0;
    for (const sp of specs) {
      sim.spawn(sp, origin);
      last = Math.max(last, sp.x + sp.w);
    }
    const bot = new Bot({ reaction: 0.3, vision: 850 });
    const steps = Math.round(((1000 + last) / sim.speed + 2.5) / FIXED_DT);
    for (let i = 0; i < steps && sim.phase === "running"; i += 1) {
      sim.step(FIXED_DT, bot.input(sim, FIXED_DT));
      sim.events.length = 0;
    }
    return sim.stats.hurts;
  }

  it("Bot mit 0,3 s Reaktion scheitert an der Kette in unter 10 % der Fälle (vorher ≈ 40 %)", { timeout: 120_000 }, () => {
    let trials = 0;
    let failed = 0;
    for (const diff of [3, 6, 10]) {
      const sim = new Sim({ mode: "world", world: "wien", character: "fred", seed: 1, startMeters: diff * METERS_PER_DIFFICULTY }, WORLDS);
      const speed = sim.speedAtDiff(diff);
      for (let seed = 1; seed <= 10; seed += 1) {
        trials += 1;
        if (chainTrial(buildChain(diff, speed, seed), seed, diff) > 0) failed += 1;
      }
    }
    expect(failed / trials).toBeLessThan(0.1);
  });

  it("Gegenprobe: derselbe Bot scheitert am alten Takt (0,58 s) deutlich öfter – der Test misst also etwas", { timeout: 120_000 }, () => {
    let trials = 0;
    let failed = 0;
    for (const diff of [3, 6, 10]) {
      const sim = new Sim({ mode: "world", world: "wien", character: "fred", seed: 1, startMeters: diff * METERS_PER_DIFFICULTY }, WORLDS);
      const speed = sim.speedAtDiff(diff);
      for (let seed = 1; seed <= 10; seed += 1) {
        trials += 1;
        // alter Takt: Gegner im Abstand 0,58 s statt 0,8 s (nur Gegner, ohne Münzen)
        let k = 0;
        const old = buildChain(diff, speed, seed)
          .filter((e) => e.kind === "walker")
          .map((e) => ({ ...e, x: speed * 0.58 * k++ }));
        if (chainTrial(old, seed, diff) > 0) failed += 1;
      }
    }
    expect(failed / trials).toBeGreaterThan(0.2);
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
