import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { describe, expect, it } from "vitest";
import { Bot } from "./bot";
import { FIXED_DT, GRAVITY, METERS_PER_DIFFICULTY, PLAYER_W, STOMP_BOUNCE_V } from "./constants";
import { createPatternCtx } from "./patterns";
import { Rng } from "./rng";
import { NO_INPUT, Sim } from "./sim";
import { ENEMY_PATTERNS, REST_JITTER_MIN, restSeconds } from "./spawner";
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

/** Baut das Muster „guest-stomp-chain“ bei Schwierigkeit `diff`; liefert die Specs (x relativ zum Musterstart) und die Rückgabelänge. */
function buildChainWithLength(diff: number, speed: number, seed: number): { specs: EntSpec[]; length: number } {
  const chain = ENEMY_PATTERNS.find((p) => p.id === "guest-stomp-chain");
  if (!chain) throw new Error("guest-stomp-chain fehlt");
  const specs: EntSpec[] = [];
  const ctx = createPatternCtx({ speed, diff, groundY: 600, ceilY: 80, rng: new Rng(seed), worldId: "wien", defaultSkin: (k) => k }, specs);
  const length = chain.build(ctx);
  return { specs, length };
}

/** Wie buildChainWithLength, nur die Specs. */
function buildChain(diff: number, speed: number, seed: number): EntSpec[] {
  return buildChainWithLength(diff, speed, seed).specs;
}

/**
 * Misst im echten Sim, wie lange die Figur nach dem `chainNo`-ten (letzten) Stampfer bis zur Landung braucht.
 * Sprungtaste gehalten (Worst-Case: losgelassen wird der Bounce auf ≈ 0,4 s gekappt); die Stampfhöhe (Gegner-Oberkante
 * bis hgt ≈ 41) wird über alle Absprung-Zeitpunkte durchprobiert, gewertet wird der längste Bounce.
 */
function lastBounceSeconds(chainNo: number, walker: EntSpec): number {
  let worst = 0;
  for (let delay = 0; delay < 100; delay += 1) {
    const sim = new Sim({ mode: "world", world: "wien", character: "fred", seed: 1 }, WORLDS);
    sim.begin();
    sim.noSpawn = true;
    sim.ents = [];
    sim.player.hearts = 99;
    sim.spawn({ ...walker, x: 0 }, sim.playerWorldX + 500);
    let bouncedAt = -1;
    for (let i = 0; i < 400 && sim.phase === "running"; i += 1) {
      // Die Sim setzt stompChain am Boden zurück – vor dem Stampfer auf den Stand der Kette bringen
      if (bouncedAt < 0 && !sim.player.grounded) sim.player.stompChain = chainNo - 1;
      sim.step(FIXED_DT, { ...NO_INPUT, jump: i >= delay, jumpPressed: i === delay });
      let landed = false;
      for (const ev of sim.events) {
        if (ev.type === "bounce" && bouncedAt < 0) bouncedAt = i;
        else if (ev.type === "land" && bouncedAt >= 0) landed = true;
      }
      sim.events.length = 0;
      if (landed) {
        worst = Math.max(worst, (i - bouncedAt) * FIXED_DT);
        break;
      }
    }
  }
  return worst;
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

  /**
   * Landeraum (Fix-Runde 1): Der Bounce nach dem LETZTEN Stampfer landet ≈ 0,87–0,93 s später (gemessen, Taste gehalten –
   * mehr als die 2·v/g-Schätzung oben, weil der Stampfer ≈ 90 px über dem Boden geschieht und der Scheitel gedehnt wird).
   * Ohne Schwanz begann das Folgemuster nach restSeconds (ab Schwierigkeit 9: 0,45 s · 0,9) noch im Fallbogen.
   * Spätester Stampf-Punkt + Bounce-Strecke darf höchstens eine Körperbreite (0,06 s) hinter dem frühesten Folgemuster liegen.
   */
  const LAND_TOLERANCE_S = 0.06;
  /** Abstand (px) der Landung hinter dem frühesten Beginn des Folgemusters (> 0 = Figur ist beim Muster noch in der Luft) und gemessene Bounce-Dauer. */
  function landingOverrun(diff: number, speed: number, tailSeconds: number | null): { overrun: number; bounce: number; chainNo: number } {
    const { specs, length } = buildChainWithLength(diff, speed, 1);
    const walkers = specs.filter((e) => e.kind === "walker");
    const last = walkers[walkers.length - 1];
    const hb = last.hb ?? [0, 0, last.w, last.h];
    // spätester Stampf-Punkt: Figurenmitte am hinteren Rand der Gegner-Hitbox + halbe Körperbreite (px ab Gegner-x)
    const stompX = hb[0] + hb[2] + PLAYER_W / 2;
    const bounce = lastBounceSeconds(walkers.length, last);
    const landX = stompX + bounce * speed;
    // frühester Beginn des Folgemusters (px ab Gegner-x): Rückgabelänge (= rechter Rand + Schwanz; für die Gegenprobe
    // mit anderem Schwanz neu gerechnet) + kürzeste Pause
    const base = tailSeconds === null ? length - last.x : last.w + tailSeconds * speed;
    const nextX = base + REST_JITTER_MIN * restSeconds(diff) * speed;
    return { overrun: landX - nextX, bounce, chainNo: walkers.length };
  }

  it("Landeraum: nach dem letzten Stampfer landet die Figur (fast) vor dem frühesten Folgemuster", { timeout: 60_000 }, () => {
    for (const diff of [1.2, 2.5, 5, 5.1, 8, 14, 20]) {
      const speed = new Sim({ mode: "world", world: "wien", character: "fred", seed: 1, startMeters: diff * METERS_PER_DIFFICULTY }, WORLDS).speedAtDiff(diff);
      const r = landingOverrun(diff, speed, null);
      // Messung plausibel: länger als die 2·v/g-Schätzung (sonst hätte der Test nichts gemessen) und nicht absurd lang
      expect(r.bounce).toBeGreaterThan(bounceSeconds(r.chainNo));
      expect(r.bounce).toBeLessThan(1.2);
      expect(r.overrun).toBeLessThanOrEqual(LAND_TOLERANCE_S * speed);
    }
  });

  it("Gegenprobe: ohne Schwanz läge das Folgemuster ab mittlerer Schwierigkeit noch im Fallbogen", { timeout: 60_000 }, () => {
    for (const diff of [5.1, 8, 14, 20]) {
      const speed = new Sim({ mode: "world", world: "wien", character: "fred", seed: 1, startMeters: diff * METERS_PER_DIFFICULTY }, WORLDS).speedAtDiff(diff);
      expect(landingOverrun(diff, speed, 0).overrun).toBeGreaterThan(LAND_TOLERANCE_S * speed);
    }
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
