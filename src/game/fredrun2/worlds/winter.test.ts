import { describe, expect, it } from "vitest";
import { Bot } from "../bot";
import { FIXED_DT, METERS_PER_DIFFICULTY, PLAYER_SX } from "../constants";
import { deathLabel } from "../death-names";
import { createPatternCtx } from "../patterns";
import { Rng } from "../rng";
import { Sim } from "../sim";
import type { EntSpec, PatternDef } from "../types";
import { WORLDS } from "./index";
import { auditPatterns, botRuns } from "./shared-b/audit";
import { WORLD_WINTER } from "./winter";
import { ICE_MULT } from "./winter/dims";
import { boostPath, ICE_RUN, steamCol, throwBall } from "./winter/patterns";
import { CHASE_MIN_STAGE, WinterSystem } from "./winter/system";

const IDLE = { jump: false, jumpPressed: false, slide: false, slidePressed: false, dashPressed: false };

function speedAt(diff: number): number {
  return 470 + (1180 - 470) * (1 - Math.exp(-diff / 3.6));
}

function build(id: string, diff: number, seed = 1): EntSpec[] {
  const p = WORLD_WINTER.patterns.find((x) => x.id === id);
  if (!p) throw new Error(`Muster ${id} fehlt`);
  const out: EntSpec[] = [];
  p.build(createPatternCtx({ speed: speedAt(diff), diff, groundY: 590, ceilY: 150, rng: new Rng(seed), worldId: "winter", defaultSkin: (k) => k }, out));
  return out;
}

/** Baut ein Muster isoliert in einer leeren Sim (Ursprung ≈ Spawn-Kante, damit die Zeitvorhersagen der Muster stimmen). */
function isolate(p: PatternDef, diff: number, seed: number): { sim: Sim; len: number; origin: number; specs: EntSpec[] } {
  const sim = new Sim({ mode: "world", world: "winter", character: "fred", seed, startMeters: diff * METERS_PER_DIFFICULTY }, WORLDS);
  sim.begin();
  sim.player.hearts = 3;
  sim.ents.length = 0;
  sim.noSpawn = true;
  sim.speed = sim.speedAtDiff(sim.diff);
  const specs: EntSpec[] = [];
  const ctx = createPatternCtx({ speed: sim.speedAtDiff(diff), diff, groundY: sim.groundY, ceilY: sim.ceilY, rng: new Rng(seed * 31 + 7), worldId: "winter", defaultSkin: (k) => k }, specs);
  const len = p.build(ctx);
  const origin = sim.dist + PLAYER_SX + 1400;
  sim.curPattern = p.id;
  for (const sp of specs) sim.spawn(sp, origin);
  sim.curPattern = "";
  return { sim, len, origin, specs };
}

/** Ein Muster isoliert vom Bot spielen lassen; Rückgabe = Treffer + Stürze. */
function playPattern(p: PatternDef, diff: number, seed: number): number {
  const { sim, len, origin } = isolate(p, diff, seed);
  const bot = new Bot();
  const secs = (origin + len + 1200 - sim.playerWorldX) / sim.speed + 1;
  let hurts = 0;
  for (let i = 0; i < secs / FIXED_DT && sim.phase === "running"; i += 1) {
    sim.step(FIXED_DT, bot.input(sim, FIXED_DT));
    for (const ev of sim.events) if (ev.type === "hurt" || ev.type === "pit-fall") hurts += 1;
    sim.events.length = 0;
  }
  return hurts;
}

const byId = (id: string): PatternDef => {
  const p = WORLD_WINTER.patterns.find((x) => x.id === id);
  if (!p) throw new Error(`Muster ${id} fehlt`);
  return p;
};

describe("Welt Christkindlmarkt", () => {
  it("Metadaten vollständig", () => {
    expect(WORLD_WINTER.id).toBe("winter");
    expect(WORLD_WINTER.name).toBe("Christkindlmarkt");
    expect(WORLD_WINTER.stageCount).toBe(5);
    expect(WORLD_WINTER.stageMeters).toBe(300);
    expect(WORLD_WINTER.stageNames.length).toBe(WORLD_WINTER.stageCount);
    expect(WORLD_WINTER.mechanics.length).toBeLessThanOrEqual(4);
    expect(WORLD_WINTER.music).toBe("winter");
    expect(WORLD_WINTER.accent).toBe("#8fd3ff");
    expect(WORLD_WINTER.accentDark).toBe("#0b1f3a");
    expect(WORLD_WINTER.patterns.length).toBeGreaterThanOrEqual(24);
    const ids = new Set(WORLD_WINTER.patterns.map((p) => p.id));
    expect(ids.size).toBe(WORLD_WINTER.patterns.length);
    expect(WORLD_WINTER.propIds).toContain("winter-krampus");
    expect(WORLD_WINTER.propIds).toContain("winter-snowball");
  });

  it("Muster-Vielfalt: Einsteiger, mittlere, schwere und drei Setpieces mit Belohnung", () => {
    const P = WORLD_WINTER.patterns;
    expect(P.filter((p) => p.minDiff <= 1.5).length).toBeGreaterThanOrEqual(4);
    expect(P.filter((p) => p.minDiff > 1.5 && p.minDiff < 5).length).toBeGreaterThanOrEqual(6);
    expect(P.filter((p) => p.minDiff >= 5).length).toBeGreaterThanOrEqual(6);
    for (const id of ["win-set-eisbahn-slalom", "win-set-schlittenfahrt", "win-set-krampuslauf"]) {
      const p = P.find((x) => x.id === id);
      expect(p?.minDiff ?? 0).toBeGreaterThanOrEqual(3);
      expect(build(id, 7).some((s) => s.pickup === "gem")).toBe(true);
    }
    const tags = new Set(P.flatMap((p) => p.tags ?? []));
    for (const t of ["hop", "slide", "gap", "enemy", "timing", "combo", "special"]) expect(tags.has(t as never)).toBe(true);
  });

  it("alle Muster bauen regelkonform", () => {
    const issues = auditPatterns(WORLD_WINTER, { forbid: ["portal", "swinger"] });
    if (issues.length) console.log(issues.slice(0, 20));
    expect(issues).toEqual([]);
    const ice = auditPatterns({ ...WORLD_WINTER, patterns: [ICE_RUN] }, {});
    expect(ice).toEqual([]);
  });

  it("jede Gefahr hat einen deutschen Todesnamen", () => {
    const skins = new Set<string>();
    for (const p of WORLD_WINTER.patterns) {
      for (const diff of [p.minDiff, 4, 9]) {
        for (const s of build(p.id, Math.max(diff, p.minDiff))) {
          if (s.harmful || s.kind === "zone" || s.kind === "walker" || s.kind === "projectile") skins.add(s.skin);
        }
      }
    }
    for (const skin of skins) expect(deathLabel(skin), skin).not.toBe("");
    expect(deathLabel("krampus")).toBe("Krampus");
    expect(deathLabel("snowball")).toBe("Schneeball");
    expect(deathLabel("icicles")).toBe("Eiszapfen");
    expect(deathLabel("kessel")).toBe("Glühwein-Kessel");
  });

  it("Signatur: Eisfläche = Tempozone ×1.3, Zapfen mit Vorwarnung, Kessel mit Aufwind, Schlitten als Plattformen", () => {
    const ice = build("win-eisbahn", 2).find((s) => s.skin === "ice");
    expect(ice?.kind).toBe("speedzone");
    expect(ice?.p?.mult).toBeCloseTo(ICE_MULT, 2);
    const drop = build("win-zapfen", 3).find((s) => s.skin === "icicle");
    expect(drop?.kind).toBe("zone");
    const warn = drop?.cycle?.phases.find((ph) => ph.name === "warn")?.dur ?? 0;
    expect(warn).toBeGreaterThanOrEqual(0.7);
    const kessel = build("win-kessel", 3);
    expect(kessel.some((s) => s.skin === "kessel" && s.kind === "block")).toBe(true);
    const steam = kessel.find((s) => s.kind === "wind");
    expect(steam?.p?.lift ?? 0).toBeGreaterThan(1000);
    const sleds = build("win-schlittenbruecke", 4).filter((s) => s.kind === "platform");
    expect(sleds.length).toBeGreaterThanOrEqual(2);
    for (const s of sleds) expect(s.vx ?? 0).toBeGreaterThan(0);
    expect(build("win-krampus", 4).some((s) => s.skin === "krampus" && s.kind === "walker" && !s.stompable && s.warn)).toBe(true);
    expect(build("win-lebkuchenmann", 2).some((s) => s.skin === "gingerbread" && s.stompable)).toBe(true);
  });

  it("Schneeball: vorausberechnete Bogenflug-Bahn trifft im Wurfmoment die Hand und kommt auf Zielhöhe an", () => {
    for (const diff of [2, 5, 9]) {
      const out: EntSpec[] = [];
      const speed = speedAt(diff);
      const c = createPatternCtx({ speed, diff, groundY: 590, ceilY: 150, rng: new Rng(3), worldId: "winter", defaultSkin: (k) => k }, out);
      const info = throwBall(c, { elfCx: 100, hand: 86, target: 100 });
      const b = out.find((s) => s.skin === "snowball");
      expect(b?.kind).toBe("projectile");
      expect(b?.p?.gravity ?? 0).toBeGreaterThan(0);
      expect(info.tRel).toBeGreaterThan(0.2);
      // Wurfmoment: Ballmitte in Handhöhe
      const g = b?.p?.gravity ?? 0;
      const vy0 = b?.vy ?? 0;
      const y = (t: number): number => (b?.y ?? 0) + vy0 * t + 0.5 * g * t * t + (b?.h ?? 0) / 2;
      expect(590 - y(info.tRel)).toBeCloseTo(86, 0);
      // Ankunft an der Figur nach `flight`: Zielhöhe
      expect(590 - y(info.tRel + info.flight)).toBeCloseTo(100, 0);
      // Flugzeit sichtbar ≥ 0.45 s (Vorwarnung)
      expect(info.flight).toBeGreaterThan(0.45);
    }
  });

  it("Aufwind-Bahn: der Sprung über den Kessel wird vom Dampf höher getragen", () => {
    const out: EntSpec[] = [];
    const c = createPatternCtx({ speed: speedAt(3), diff: 3, groundY: 590, ceilY: 150, rng: new Rng(3), worldId: "winter", defaultSkin: (k) => k }, out);
    const col = steamCol(c, 0);
    const plain = boostPath(c, -c.t(0.36), { ...col, lift: 0 });
    const lifted = boostPath(c, -c.t(0.36), col);
    expect(Math.max(...lifted.map((p) => p.h))).toBeGreaterThan(Math.max(...plain.map((p) => p.h)) + 60);
  });

  it("Weltsystem: Wind-/Marktklang, Böen, Eis-Sicht und Schneeball-Zerplatzen", () => {
    const sim = new Sim({ mode: "world", world: "winter", character: "fred", seed: 4, startMeters: 200 }, WORLDS);
    sim.begin();
    sim.player.hearts = 99;
    let gust = 0;
    for (let i = 0; i < 30 / FIXED_DT && sim.phase === "running"; i += 1) {
      sim.step(FIXED_DT, IDLE);
      sim.events.length = 0;
      gust = Math.max(gust, sim.vars.gust ?? 0);
      if (sim.player.hearts < 50) sim.player.hearts = 99;
    }
    expect(sim.vars["loop:wind"]).toBeGreaterThan(0);
    expect(sim.vars["loop:crowd-fair"]).toBeGreaterThan(0);
    expect(gust).toBeGreaterThan(0);
  });

  it("Krampus-Verfolgung: nur im Krampuslauf, mit Vorwarnung, ohne Treffer bei ungehindertem Lauf", () => {
    const sim = new Sim({ mode: "world", world: "winter", character: "fred", seed: 4, startMeters: 1300, startWorldMeters: 1250 }, WORLDS);
    sim.begin();
    sim.noSpawn = true;
    sim.ents = [];
    const sys = sim.systems.find((s): s is WinterSystem => s instanceof WinterSystem);
    expect(sys).toBeDefined();
    expect(sim.stageInfo().stage).toBeGreaterThanOrEqual(CHASE_MIN_STAGE);
    let warnSeen = false;
    let chaseSeen = false;
    let bells = 0;
    for (let i = 0; i < 45 / FIXED_DT; i += 1) {
      sim.step(FIXED_DT, IDLE);
      for (const ev of sim.events) if (ev.tag === "sfx:tram-bell") bells += 1;
      sim.events.length = 0;
      const st = sys?.state;
      if (st?.phase === "warn" && (sim.vars.chaseWarn ?? 0) > 0.3) warnSeen = true;
      if (st?.phase === "chase") chaseSeen = true;
    }
    expect(warnSeen).toBe(true);
    expect(chaseSeen).toBe(true);
    expect(bells).toBeGreaterThanOrEqual(3);
    expect(sim.stats.hurts).toBe(0);
  });

  it("Krampus-Verfolgung: Treffer verkürzen den Vorsprung; sie holt erst nach mehreren Fehlern auf", () => {
    const mk = (): { sim: Sim; sys: WinterSystem } => {
      const sim = new Sim({ mode: "world", world: "winter", character: "fred", seed: 8, startMeters: 1400, startWorldMeters: 1250 }, WORLDS);
      sim.begin();
      sim.noSpawn = true;
      sim.ents = [];
      sim.player.hearts = 5;
      const sys = sim.systems.find((s): s is WinterSystem => s instanceof WinterSystem) as WinterSystem;
      for (let i = 0; i < 60 / FIXED_DT && sys.state.phase !== "chase"; i += 1) sim.step(FIXED_DT, IDLE);
      return { sim, sys };
    };
    {
      const { sim, sys } = mk();
      expect(sys.state.phase).toBe("chase");
      const before = sys.state.gapT;
      sim.hurt("test");
      for (let i = 0; i < 0.6 / FIXED_DT; i += 1) sim.step(FIXED_DT, IDLE);
      expect(sys.state.gapT).toBeLessThan(before - 0.1);
      expect(sim.vars.chaseWarn ?? 0).toBeGreaterThan(0.4);
    }
    {
      const { sim } = mk();
      let hits = 0;
      for (let k = 0; k < 3; k += 1) {
        sim.player.invuln = 0;
        sim.hurt("test");
        for (let i = 0; i < 0.45 / FIXED_DT; i += 1) {
          sim.step(FIXED_DT, IDLE);
          for (const ev of sim.events) if (ev.type === "hurt" && ev.tag === "krampus") hits += 1;
          sim.events.length = 0;
        }
      }
      for (let i = 0; i < 3 / FIXED_DT; i += 1) {
        sim.step(FIXED_DT, IDLE);
        for (const ev of sim.events) if (ev.type === "hurt" && ev.tag === "krampus") hits += 1;
        sim.events.length = 0;
      }
      expect(hits).toBe(1);
    }
  });

  it("Eis: Tempozone ×1.3 macht die Figur auf der Eisfläche schneller", () => {
    const measure = (ice: boolean): number => {
      const { sim } = isolate(byId(ice ? "win-eisbahn" : "win-zuckerzaun"), 2, 1);
      sim.ents = sim.ents.filter((e) => e.kind === "speedzone" || e.kind === "pickup" || e.kind === "decor");
      let top = 0;
      for (let i = 0; i < 6 / FIXED_DT && sim.phase === "running"; i += 1) {
        sim.step(FIXED_DT, IDLE);
        sim.events.length = 0;
        if (sim.player.grounded) top = Math.max(top, sim.speed);
      }
      return top;
    };
    expect(measure(true)).toBeGreaterThan(measure(false) * 1.15);
  });

  it("Eisrausch: in der Stufe Eistraum schiebt das System zusätzliche Eisflächen ein", { timeout: 60_000 }, () => {
    const sim = new Sim({ mode: "world", world: "winter", character: "fred", seed: 6, startMeters: 610, startWorldMeters: 605 }, WORLDS);
    sim.begin();
    sim.player.hearts = 99;
    const bot = new Bot();
    let runs = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 40 / FIXED_DT && sim.phase === "running" && sim.stageInfo().stage === 2; i += 1) {
      sim.step(FIXED_DT, bot.input(sim, FIXED_DT));
      sim.events.length = 0;
      sim.player.hearts = 99;
      for (const e of sim.ents) {
        if (e.pat === ICE_RUN.id && e.kind === "speedzone" && !seen.has(e.id)) {
          seen.add(e.id);
          runs += 1;
        }
      }
    }
    expect(runs).toBeGreaterThanOrEqual(1);
  });

  it("Schneeball zerspringt beim Treffer; Lebkuchenmann lässt beim Stampfen Sterne fallen", () => {
    const sim = new Sim({ mode: "world", world: "winter", character: "fred", seed: 4, startMeters: 200 }, WORLDS);
    sim.begin();
    sim.noSpawn = true;
    sim.ents = [];
    sim.player.hearts = 5;
    const ball = sim.spawn(
      { kind: "projectile", skin: "snowball", x: 0, y: sim.groundY - 60, w: 46, h: 40, harmful: true, p: { gravity: 0 }, vx: -10, vy: 0 } as EntSpec,
      sim.playerWorldX - 10,
    );
    let burst = false;
    for (let i = 0; i < 1 / FIXED_DT; i += 1) {
      sim.step(FIXED_DT, IDLE);
      if (sim.ents.some((e) => e.skin === "snow-burst")) burst = true;
      sim.events.length = 0;
    }
    expect(sim.stats.hurts).toBeGreaterThanOrEqual(1);
    expect(ball.dead).toBe(true);
    expect(burst).toBe(true);

    const sim2 = new Sim({ mode: "world", world: "winter", character: "fred", seed: 4, startMeters: 200 }, WORLDS);
    sim2.begin();
    sim2.noSpawn = true;
    sim2.ents = [];
    const g = sim2.spawn({ kind: "walker", skin: "gingerbread", x: 400, y: sim2.groundY - 92, w: 78, h: 92, harmful: true, stompable: true } as EntSpec, sim2.dist);
    const coins = (): number => sim2.ents.filter((e) => e.kind === "pickup" && !e.dead).length;
    const before = coins();
    g.state = "defeated";
    sim2.step(FIXED_DT, IDLE);
    sim2.step(FIXED_DT, IDLE);
    expect(coins()).toBeGreaterThanOrEqual(before + 4);
  });

  it("Isoliert gespielt: der Bot kommt durch jedes Muster (drei Schwierigkeiten)", { timeout: 240_000 }, () => {
    const bad: string[] = [];
    for (const p of WORLD_WINTER.patterns) {
      for (const d of [1, 4, 9]) {
        const diff = Math.max(d, p.minDiff);
        const hits = playPattern(p, diff, 3);
        if (hits > 0) bad.push(`${p.id}@${diff}:${hits}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("Bot übersteht zusätzliche Seeds", { timeout: 240_000 }, () => {
    const runs = botRuns(WORLDS, "winter", [
      { seed: 3, meters: 0, secs: 40 },
      { seed: 5, meters: 900, secs: 35 },
      { seed: 9, meters: 2200, secs: 35 },
      { seed: 13, meters: 4000, secs: 30 },
    ]);
    for (const r of runs) if (r.log.length) console.log("winter", r.seed, r.meters, r.log.join("\n  "));
    for (const r of runs) expect(r.hurts).toBeLessThanOrEqual(2);
  });
});
