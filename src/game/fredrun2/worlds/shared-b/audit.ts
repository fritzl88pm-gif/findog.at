/**
 * Test-Helfer (nur für *.test.ts): baut alle Muster einer Welt bei verschiedenen Schwierigkeiten/Seeds und prüft
 * Grundregeln (Längen endlich, Breitenlimits, erlaubte Archetypen, gravitationsneutrale Portale …).
 */
import { Bot } from "../../bot";
import { FIXED_DT, JUMP_AIR_TIME, METERS_PER_DIFFICULTY, PX_PER_METER } from "../../constants";
import { createPatternCtx } from "../../patterns";
import { Rng } from "../../rng";
import { Sim } from "../../sim";
import type { EntKind, EntSpec, WorldDef, WorldId } from "../../types";

export interface AuditIssue {
  pattern: string;
  diff: number;
  msg: string;
}

function speedAtDiff(d: number): number {
  return 470 + (1180 - 470) * (1 - Math.exp(-d / 3.6));
}

export function auditPatterns(world: WorldDef, opts: { forbid?: EntKind[]; evenPortals?: boolean } = {}): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const gy = world.groundY ?? 590;
  const cy = world.ceilY ?? 150;
  for (const p of world.patterns) {
    const diffs = [p.minDiff, p.minDiff + 0.7, 3, 5, 7, 9, 12].filter((d) => d >= p.minDiff && (p.maxDiff === undefined || d <= p.maxDiff));
    for (const diff of diffs) {
      for (let seed = 1; seed <= 6; seed += 1) {
        const out: EntSpec[] = [];
        const speed = speedAtDiff(diff) * (world.speedScale ?? 1);
        const ctx = createPatternCtx({ speed, diff, groundY: gy, ceilY: cy, rng: new Rng(seed * 97 + Math.round(diff * 10)), worldId: world.id, defaultSkin: (k) => k }, out);
        let len = 0;
        try {
          len = p.build(ctx);
        } catch (err) {
          issues.push({ pattern: p.id, diff, msg: `Ausnahme: ${String(err)}` });
          continue;
        }
        if (!Number.isFinite(len) || len <= 0) issues.push({ pattern: p.id, diff, msg: `Länge ungültig: ${len}` });
        const jumpDist = speed * JUMP_AIR_TIME;
        let portals = 0;
        for (const s of out) {
          for (const k of ["x", "y", "w", "h"] as const) if (!Number.isFinite(s[k])) issues.push({ pattern: p.id, diff, msg: `${s.kind}.${k} nicht endlich` });
          if (opts.forbid?.includes(s.kind)) issues.push({ pattern: p.id, diff, msg: `verbotener Archetyp ${s.kind}` });
          if (s.kind === "portal") portals += 1;
          if (s.kind === "block" && !s.ceil && s.h < 200 && s.w > 0.6 * jumpDist + 0.5) issues.push({ pattern: p.id, diff, msg: `Block zu breit (${s.w.toFixed(0)} > ${(0.6 * jumpDist).toFixed(0)})` });
          if (s.kind === "pickup" && (s.y < -20 || s.y > gy)) issues.push({ pattern: p.id, diff, msg: `Pickup außerhalb (${s.y.toFixed(0)})` });
          if (s.x > len + 2000) issues.push({ pattern: p.id, diff, msg: `Element weit hinter Musterende (${s.x.toFixed(0)} > ${len.toFixed(0)})` });
        }
        if (opts.evenPortals && portals % 2 !== 0) issues.push({ pattern: p.id, diff, msg: `ungerade Portalzahl (${portals})` });
      }
    }
  }
  return issues;
}

/** Zusätzliche Bot-Läufe (mehr Seeds/Startdistanzen). Rückgabe: Treffer je Lauf + Protokoll. */
export function botRuns(registry: Record<WorldId, WorldDef>, world: WorldId, runs: Array<{ seed: number; meters: number; secs: number }>): Array<{ seed: number; meters: number; hurts: number; log: string[] }> {
  const res: Array<{ seed: number; meters: number; hurts: number; log: string[] }> = [];
  for (const r of runs) {
    const sim = new Sim({ mode: "world", world, character: "fred", seed: r.seed, startMeters: r.meters }, registry);
    sim.begin();
    sim.player.hearts = 3;
    const bot = new Bot();
    const log: string[] = [];
    const steps = Math.round(r.secs / FIXED_DT);
    for (let i = 0; i < steps && sim.phase === "running"; i += 1) {
      sim.step(FIXED_DT, bot.input(sim, FIXED_DT));
      for (const ev of sim.events) {
        if (ev.type === "hurt" || ev.type === "pit-fall") {
          const near = sim.ents
            .filter((e) => e.harmful || e.kind === "pit")
            .sort((a, b) => Math.abs(a.x + a.w / 2 - sim.playerWorldX) - Math.abs(b.x + b.w / 2 - sim.playerWorldX))[0];
          log.push(`${sim.meters.toFixed(0)}m ${ev.type}:${ev.tag ?? ""} pat=${near?.pat ?? "?"} plan=${bot.lastPlanName}`);
        }
      }
      sim.events.length = 0;
      if (sim.player.hearts < 3) sim.player.hearts = 3;
    }
    res.push({ seed: r.seed, meters: r.meters, hurts: sim.stats.hurts, log });
  }
  return res;
}

export const DIFF_METERS = METERS_PER_DIFFICULTY;
export const PXM = PX_PER_METER;
