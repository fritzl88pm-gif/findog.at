import { describe, expect, it } from "vitest";
import { createPatternCtx } from "../patterns";
import { Rng } from "../rng";
import type { EntSpec } from "../types";
import { WORLD_FINANZAMT } from "./finanzamt";
import { WORLDS } from "./index";
import { auditPatterns, botRuns } from "./shared-b/audit";

function build(id: string, diff: number, seed = 1): EntSpec[] {
  const p = WORLD_FINANZAMT.patterns.find((x) => x.id === id);
  if (!p) throw new Error(`Muster fehlt: ${id}`);
  const out: EntSpec[] = [];
  const speed = 470 + 710 * (1 - Math.exp(-diff / 3.6));
  const ctx = createPatternCtx({ speed, diff, groundY: 590, ceilY: 150, rng: new Rng(seed), worldId: "finanzamt", defaultSkin: (k) => k }, out);
  p.build(ctx);
  return out;
}

describe("Welt Finanzamt bei Nacht", () => {
  it("Metadaten vollständig", () => {
    expect(WORLD_FINANZAMT.name).toBe("Finanzamt bei Nacht");
    expect(WORLD_FINANZAMT.music).toBe("finanzamt");
    expect(WORLD_FINANZAMT.stageCount).toBe(5);
    expect(WORLD_FINANZAMT.stageMeters).toBe(280);
    expect(WORLD_FINANZAMT.stageNames.length).toBe(WORLD_FINANZAMT.stageCount);
    expect(WORLD_FINANZAMT.mechanics.length).toBeLessThanOrEqual(4);
    expect(WORLD_FINANZAMT.patterns.length).toBeGreaterThanOrEqual(18);
    const ids = new Set(WORLD_FINANZAMT.patterns.map((p) => p.id));
    expect(ids.size).toBe(WORLD_FINANZAMT.patterns.length);
  });

  it("Schwierigkeitsverteilung: Einsteiger, schwere Muster, Setpieces", () => {
    const ps = WORLD_FINANZAMT.patterns;
    expect(ps.filter((p) => p.minDiff <= 1.5).length).toBeGreaterThanOrEqual(3);
    expect(ps.filter((p) => p.minDiff >= 4.8).length).toBeGreaterThanOrEqual(4);
    expect(ps.find((p) => p.id === "fa-sicherheitsschleuse")?.minDiff).toBeGreaterThanOrEqual(3);
    expect(ps.find((p) => p.id === "fa-papierlawine")?.minDiff).toBeGreaterThanOrEqual(3);
  });

  it("alle Muster bauen regelkonform", () => {
    const issues = auditPatterns(WORLD_FINANZAMT, { forbid: ["portal", "spring"] });
    if (issues.length) console.log(issues.slice(0, 20));
    expect(issues).toEqual([]);
  });

  it("Signatur-Mechaniken sind vorhanden", () => {
    const skins = new Set<string>();
    for (const p of WORLD_FINANZAMT.patterns) for (const s of build(p.id, Math.max(p.minDiff, 6))) skins.add(`${s.kind}:${s.skin}`);
    for (const k of ["zone:stamp", "zone:laser-low", "zone:laser-high", "speedzone:belt-fast", "speedzone:belt-slow", "pit:shredder", "block:paper-stack", "walker:office-chair", "flyer:bat", "platform:paternoster"]) {
      expect(skins.has(k), k).toBe(true);
    }
  });

  it("Laser: niedrig ist überspringbar, hoch nur unterrutschbar", () => {
    for (const diff of [1.5, 5, 10]) {
      const low = build("fa-laser-tief", diff).find((s) => s.skin === "laser-low");
      const high = build("fa-laser-hoch", diff).find((s) => s.skin === "laser-high");
      expect(low && high).toBeTruthy();
      if (!low || !high || !low.hb || !high.hb) continue;
      // Oberkante niedriger Laser ≤ 90 px über Boden (Sprunghöhe 216)
      expect(590 - (low.y + low.hb[1])).toBeLessThanOrEqual(90);
      // Unterkante hoher Laser ≥ 72 px über Boden (Rutsch-Hitbox 45 px), Oberkante unerreichbar hoch
      const bottom = 590 - (high.y + high.hb[1] + high.hb[3]);
      expect(bottom).toBeGreaterThanOrEqual(72);
      expect(590 - high.y).toBeGreaterThan(420);
      expect(high.cycle?.loop).toBe(true);
    }
  });

  it("hoher Laser: unsichtbarer, harmloser Überhang hält die Figur im Rutschen", () => {
    for (const id of ["fa-laser-hoch", "fa-laser-wechsel", "fa-sicherheitsschleuse", "fa-nachtschicht"]) {
      const p = WORLD_FINANZAMT.patterns.find((x) => x.id === id);
      const specs = build(id, Math.max(8, p?.minDiff ?? 0), 3);
      const highs = specs.filter((s) => s.skin === "laser-high");
      const guards = specs.filter((s) => s.skin === "laser-guard");
      expect(highs.length, id).toBeGreaterThan(0);
      expect(guards.length, id).toBe(highs.length);
      for (const g of guards) {
        expect(g.kind).toBe("overhead");
        expect(g.harmful).toBe(false);
        // Unterkante auf Höhe der Laser-Unterkante (76 px) – Rutsch-Hitbox (45 px) passt drunter
        expect(590 - (g.y + g.h)).toBeGreaterThanOrEqual(72);
      }
    }
  });

  it("Stempel: Warnung ≥ 0.6 s vor dem Einschlag", () => {
    for (const diff of [1.2, 4, 9]) {
      const st = build("fa-stempel", diff).find((s) => s.skin === "stamp");
      const warn = st?.cycle?.phases.find((p) => p.name === "warn");
      expect(warn?.dur ?? 0).toBeGreaterThanOrEqual(0.6);
    }
  });

  it("Bot übersteht zusätzliche Seeds", { timeout: 180_000 }, () => {
    const runs = botRuns(WORLDS, "finanzamt", [
      { seed: 3, meters: 0, secs: 40 },
      { seed: 5, meters: 1200, secs: 35 },
      { seed: 9, meters: 2400, secs: 35 },
      { seed: 13, meters: 4000, secs: 30 },
    ]);
    for (const r of runs) if (r.log.length) console.log("finanzamt", r.seed, r.meters, r.log.join("\n  "));
    for (const r of runs) expect(r.hurts).toBeLessThanOrEqual(2);
  });
});
