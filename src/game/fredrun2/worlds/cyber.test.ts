import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIXED_DT, PLAYER_H } from "../constants";
import { createPatternCtx } from "../patterns";
import { Rng } from "../rng";
import { NO_INPUT, Sim } from "../sim";
import type { EntSpec } from "../types";
import { WORLD_CYBER } from "./cyber";
import { FLIGHT } from "./cyber/patterns";
import { WORLDS } from "./index";
import { auditPatterns, botRuns } from "./shared-b/audit";

const speedAt = (d: number): number => 470 + (1180 - 470) * (1 - Math.exp(-d / 3.6));

function build(id: string, diff: number, seed: number): { specs: EntSpec[]; len: number; speed: number } {
  const p = WORLD_CYBER.patterns.find((x) => x.id === id);
  if (!p) throw new Error(id);
  const specs: EntSpec[] = [];
  const speed = speedAt(diff);
  const ctx = createPatternCtx(
    { speed, diff, groundY: WORLD_CYBER.groundY ?? 600, ceilY: WORLD_CYBER.ceilY ?? 140, rng: new Rng(seed), worldId: "cyber", defaultSkin: (k) => k },
    specs,
  );
  const len = p.build(ctx);
  return { specs, len, speed };
}

describe("Welt Cyber-Wien 2099", () => {
  it("Schwebe-Plattform-Prop ist vorgeladen und im Manifest vorhanden", () => {
    const manifest = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../public/fredrun2/props/manifest.json"), "utf8")) as { props: Record<string, { cw: number; ch: number }> };
    expect(WORLD_CYBER.propIds).toContain("cyber-hover");
    // Skin skaliert auf Plattformbreite und verankert die begehbare Fläche in Zellzeile 17 (512×119)
    expect(manifest.props["cyber-hover"]).toMatchObject({ cw: 512, ch: 119 });
  });

  it("Metadaten vollständig", () => {
    expect(WORLD_CYBER.id).toBe("cyber");
    expect(WORLD_CYBER.gravityFlip).toBe(true);
    expect(WORLD_CYBER.groundY).toBe(600);
    expect(WORLD_CYBER.ceilY).toBe(140);
    expect(WORLD_CYBER.stageCount).toBe(5);
    expect(WORLD_CYBER.stageNames.length).toBe(WORLD_CYBER.stageCount);
    expect(WORLD_CYBER.mechanics.length).toBeLessThanOrEqual(4);
    expect(WORLD_CYBER.patterns.length).toBeGreaterThanOrEqual(18);
    const ids = new Set(WORLD_CYBER.patterns.map((p) => p.id));
    expect(ids.size).toBe(WORLD_CYBER.patterns.length);
    // Setpieces vorhanden
    expect(ids.has("cy-zickzack-schacht")).toBe(true);
    expect(ids.has("cy-serverkorridor")).toBe(true);
  });

  it("alle Muster bauen regelkonform und gravitationsneutral", () => {
    const issues = auditPatterns(WORLD_CYBER, { forbid: ["pit", "overhead"], evenPortals: true });
    if (issues.length) console.log(issues.slice(0, 20));
    expect(issues).toEqual([]);
  });

  it("erste Portale sind gnädig (diff 0.5–1.2): keine Gefahr im Flug, lange Reaktionszeit an der Decke", () => {
    for (const id of ["cy-portal-intro", "cy-portal-hop"]) {
      const p = WORLD_CYBER.patterns.find((x) => x.id === id);
      expect(p && p.minDiff <= 1.2).toBe(true);
      for (let seed = 1; seed <= 8; seed += 1) {
        const diff = p?.minDiff ?? 0;
        const { specs, speed } = build(id, diff, seed);
        const portals = specs.filter((s) => s.kind === "portal").map((s) => s.x + s.w / 2);
        const harmful = specs.filter((s) => s.harmful || s.kind === "zone");
        // Nach jedem Portal mind. Flugzeit + 0.8 s bis zur ersten Gefahr
        for (const px of portals) {
          for (const h of harmful) {
            if (h.x + h.w < px) continue;
            expect((h.x - px) / speed).toBeGreaterThan(FLIGHT + 0.8);
          }
        }
      }
    }
  });

  it("Portale: nach dem Flip bleibt der Flugkorridor frei", () => {
    for (const p of WORLD_CYBER.patterns) {
      for (const diff of [p.minDiff, 6, 11]) {
        if (diff < p.minDiff || (p.maxDiff !== undefined && diff > p.maxDiff)) continue;
        const { specs, speed } = build(p.id, diff, 3);
        const portals = specs.filter((s) => s.kind === "portal").map((s) => s.x + s.w / 2);
        const hazards = specs.filter((s) => s.harmful || (s.kind === "zone" && s.skin !== "decor"));
        for (const px of portals) {
          for (const h of hazards) {
            const hb = h.hb ?? [0, 0, h.w, h.h];
            const t0 = (h.x + hb[0] - px) / speed;
            const t1 = (h.x + hb[0] + hb[2] - px) / speed;
            // Gefahr darf nicht in das Zeitfenster [0, FLIGHT + 0.25] nach dem Portal fallen
            const overlaps = t1 > -0.05 && t0 < FLIGHT + 0.25;
            if (overlaps) console.log(p.id, diff, h.skin, t0.toFixed(2), t1.toFixed(2));
            expect(overlaps).toBe(false);
          }
        }
      }
    }
  });

  it("Spielfeld-Anschlag: Sprung direkt nach dem Portal schleudert die Figur nicht aus dem Feld", () => {
    const sim = new Sim({ mode: "world", world: "cyber", character: "fred", seed: 1 }, WORLDS);
    sim.begin();
    sim.noSpawn = true;
    sim.ents.length = 0;
    const gy = sim.groundY;
    const cy = sim.ceilY;
    sim.spawn({ kind: "portal", skin: "portal", x: 0, y: cy, w: 60, h: gy - cy, harmful: false, hb: [0, 0, 60, gy - cy], p: { dir: 1 } }, sim.playerWorldX + 120);
    let flippedAt = -1;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < Math.round(2.5 / FIXED_DT); i += 1) {
      const p = sim.player;
      if (flippedAt < 0 && p.gravDir === -1) flippedAt = i;
      const after = flippedAt >= 0 ? i - flippedAt : -1;
      const input = after >= 2 && after < 40 ? { ...NO_INPUT, jump: true, jumpPressed: after === 2 } : NO_INPUT;
      sim.step(FIXED_DT, input);
      const feet = sim.feetY();
      const top = sim.player.gravDir === 1 ? feet - PLAYER_H : feet;
      lo = Math.min(lo, top);
      hi = Math.max(hi, top + PLAYER_H);
    }
    expect(flippedAt).toBeGreaterThan(0);
    expect(lo).toBeGreaterThanOrEqual(cy - 1);
    expect(hi).toBeLessThanOrEqual(gy + 1);
    expect(sim.player.gravDir).toBe(-1);
  });

  it("Bot übersteht zusätzliche Seeds", { timeout: 240_000 }, () => {
    const runs = botRuns(WORLDS, "cyber", [
      { seed: 3, meters: 0, secs: 40 },
      { seed: 5, meters: 1200, secs: 35 },
      { seed: 9, meters: 2400, secs: 35 },
      { seed: 13, meters: 4000, secs: 30 },
    ]);
    for (const r of runs) if (r.log.length) console.log("cyber", r.seed, r.meters, r.log.join("\n  "));
    for (const r of runs) expect(r.hurts).toBeLessThanOrEqual(2);
  });
});
