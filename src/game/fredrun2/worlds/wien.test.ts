import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../constants";
import { createPatternCtx } from "../patterns";
import { Rng } from "../rng";
import { Sim } from "../sim";
import type { EntSpec } from "../types";
import { WORLDS } from "./index";
import { auditPatterns, botRuns } from "./shared-b/audit";
import { WORLD_WIEN } from "./wien";
import { WIEN_BACKDROPS } from "./wien/stages";

function build(id: string, diff: number, seed = 1): EntSpec[] {
  const p = WORLD_WIEN.patterns.find((x) => x.id === id);
  if (!p) throw new Error(`Muster ${id} fehlt`);
  const out: EntSpec[] = [];
  const speed = 470 + (1180 - 470) * (1 - Math.exp(-diff / 3.6));
  p.build(createPatternCtx({ speed, diff, groundY: 590, ceilY: 150, rng: new Rng(seed), worldId: "wien", defaultSkin: (k) => k }, out));
  return out;
}

describe("Welt Wien im Sturm", () => {
  it("Metadaten vollständig (8 Katastrophen-Stufen, Originalkulissen)", () => {
    expect(WORLD_WIEN.stageCount).toBe(8);
    expect(WORLD_WIEN.stageMeters).toBe(260);
    expect(WORLD_WIEN.stageNames.length).toBe(WORLD_WIEN.stageCount);
    expect(WIEN_BACKDROPS.length).toBe(WORLD_WIEN.stageCount);
    expect(WORLD_WIEN.mechanics.length).toBeLessThanOrEqual(4);
    expect(WORLD_WIEN.patterns.length).toBeGreaterThanOrEqual(18);
    const ids = new Set(WORLD_WIEN.patterns.map((p) => p.id));
    expect(ids.size).toBe(WORLD_WIEN.patterns.length);
    expect(WORLD_WIEN.propIds).toContain("pigeon-fly");
  });

  it("Hindernis-Props (Poller, Bauzaun, Schutt, Kranträger, Brezel-Schild, Bim) sind in propIds und im Manifest", () => {
    const manifest = JSON.parse(readFileSync("public/fredrun2/props/manifest.json", "utf8")) as { props: Record<string, unknown> };
    const ids = ["wien-poller", "wien-bauzaun", "wien-rubble", "wien-crane-beam", "wien-sign", ...Array.from({ length: 7 }, (_, i) => `wien-tram-n${i}`)];
    for (const id of ids) {
      expect(WORLD_WIEN.propIds).toContain(id);
      expect(manifest.props[id], id).toBeDefined();
    }
  });

  it("Muster-Vielfalt: Einsteiger, schwere Muster und zwei Setpieces", () => {
    const P = WORLD_WIEN.patterns;
    expect(P.filter((p) => p.minDiff <= 1.5).length).toBeGreaterThanOrEqual(3);
    expect(P.filter((p) => p.minDiff >= 5).length).toBeGreaterThanOrEqual(3);
    for (const id of ["wien-ringstrassen-sprint", "wien-einsturz"]) {
      const p = P.find((x) => x.id === id);
      expect(p?.minDiff ?? 0).toBeGreaterThanOrEqual(3);
      expect(build(id, 7).some((s) => s.pickup === "gem")).toBe(true);
    }
  });

  it("alle Muster bauen regelkonform", () => {
    // Ausnahme von der Breitenregel: Straßenbahnen werden nicht übersprungen, sondern „besurft“ (Dach = Plattform).
    const trams = new Set(WORLD_WIEN.patterns.filter((p) => build(p.id, Math.max(p.minDiff, 3)).some((s) => s.skin === "tram-roof")).map((p) => p.id));
    const issues = auditPatterns(WORLD_WIEN, { forbid: ["portal"] }).filter((i) => !(i.msg.startsWith("Block zu breit") && trams.has(i.pattern)));
    if (issues.length) console.log(issues.slice(0, 20));
    expect(issues).toEqual([]);
    // … aber jeder zu breite Block in diesen Mustern MUSS eine Straßenbahn mit begehbarem Dach sein
    for (const id of trams) {
      for (const diff of [3, 6, 9, 12]) {
        for (let seed = 1; seed <= 4; seed += 1) {
          const out = build(id, diff, seed);
          const speed = 470 + (1180 - 470) * (1 - Math.exp(-diff / 3.6));
          const jumpDist = speed * ((2 * 1080) / 2700);
          for (const b of out) {
            if (b.kind !== "block" || b.w <= 0.6 * jumpDist) continue;
            expect(b.skin).toBe("tram");
            expect(b.h).toBeLessThan(216 - 30);
            expect(out.some((r) => r.skin === "tram-roof" && r.kind === "platform" && r.x === b.x && r.w === b.w && r.vx === b.vx)).toBe(true);
          }
        }
      }
    }
  });

  it("Signatur-Mechaniken sind korrekt verdrahtet", () => {
    // Straßenbahn = schädlicher Wagenkasten + begehbares Dach, gleiche Geschwindigkeit, mit Warnpfeil
    const bim = build("wien-bim", 3);
    const body = bim.find((s) => s.skin === "tram");
    const roof = bim.find((s) => s.skin === "tram-roof");
    expect(body?.kind).toBe("block");
    expect(body?.warn).toBe(true);
    expect(body?.vx ?? 0).toBeLessThan(0);
    expect(roof?.kind).toBe("platform");
    expect(roof?.vx).toBe(body?.vx);
    expect(roof?.x).toBe(body?.x);
    // Blitz = Zone mit Vorwarnung ≥ 0.6 s und kurzer aktiver Phase
    const bolt = build("wien-blitz", 3).find((s) => s.skin === "bolt");
    expect(bolt?.kind).toBe("zone");
    const warn = bolt?.cycle?.phases.find((ph) => ph.name === "warn")?.dur ?? 0;
    const active = bolt?.cycle?.phases.find((ph) => ph.name === "active")?.dur ?? 0;
    expect(warn).toBeGreaterThanOrEqual(0.6);
    expect(active).toBeGreaterThan(0.15);
    expect(active).toBeLessThanOrEqual(0.35);
    // Pfütze bremst, Tauben fliegen, Gully ist eine Lücke, späte Ziegel fallen mit Schwerkraft
    const puddle = build("wien-puddle", 1).find((s) => s.skin === "puddle");
    expect(puddle?.kind).toBe("speedzone");
    expect(puddle?.p?.mult).toBeCloseTo(0.72, 2);
    expect(build("wien-tauben", 2).filter((s) => s.skin === "pigeon" && s.kind === "flyer").length).toBeGreaterThanOrEqual(3);
    expect(build("wien-gully", 1).some((s) => s.kind === "pit" && s.skin === "manhole")).toBe(true);
    const brick = build("wien-ziegelregen", 6).find((s) => s.skin === "brick");
    expect(brick?.kind).toBe("projectile");
    expect(brick?.p?.gravity ?? 0).toBeGreaterThan(0);
  });

  it("Weltsystem: Regen-Loop, Gewitter und fair telegrafierte Einschläge", () => {
    const sim = new Sim({ mode: "world", world: "wien", character: "fred", seed: 4, startMeters: 900 }, WORLDS);
    sim.begin();
    sim.player.hearts = 99;
    let bolts = 0;
    let thunder = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 40 / FIXED_DT && sim.phase === "running"; i += 1) {
      sim.step(FIXED_DT, { jump: false, jumpPressed: false, slide: false, slidePressed: false, dashPressed: false });
      for (const ev of sim.events) if (ev.tag === "sfx:thunder") thunder += 1;
      sim.events.length = 0;
      for (const e of sim.ents) {
        if (e.skin !== "bolt" || seen.has(e.id)) continue;
        seen.add(e.id);
        bolts += 1;
        const warn = e.cycle?.phases.find((ph) => ph.name === "warn")?.dur ?? 0;
        expect(warn).toBeGreaterThanOrEqual(0.6);
      }
      if (sim.player.hearts < 50) sim.player.hearts = 99;
    }
    expect(sim.vars["loop:rain"]).toBeGreaterThan(0);
    expect(bolts).toBeGreaterThan(0);
    expect(thunder).toBeGreaterThan(0);
  });

  it("Bot übersteht zusätzliche Seeds", { timeout: 120_000 }, () => {
    const runs = botRuns(WORLDS, "wien", [
      { seed: 3, meters: 0, secs: 40 },
      { seed: 5, meters: 1200, secs: 35 },
      { seed: 9, meters: 2400, secs: 35 },
      { seed: 13, meters: 4000, secs: 30 },
    ]);
    for (const r of runs) if (r.log.length) console.log("wien", r.seed, r.meters, r.log.join("\n  "));
    for (const r of runs) expect(r.hurts).toBeLessThanOrEqual(2);
  });
});
