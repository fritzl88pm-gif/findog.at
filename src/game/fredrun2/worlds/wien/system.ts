/**
 * Wien – Weltsystem: Gewitter (Ambient-Blitze mit verzögertem Donner), Einschlag-Blitze vor dem Spieler (ab diff 1.2,
 * immer mit ≥ 0.8 s Vorwarnung und nie neben Muster-Gefahren), Straßenbahn-Klingel, Regen-/Wind-Klang.
 */
import { Rng } from "../../rng";
import type { Sim } from "../../sim";
import type { EntSpec, WorldSystem } from "../../types";
import { stageVal } from "../shared-a/gfx";
import { RAIN, STORM, WIND } from "./stages";

export const BOLT_W = 116;
export const BOLT_H = 104;

export function boltSpec(groundY: number, warn: number, active: number, lead = 0): EntSpec {
  const phases = [
    ...(lead > 0 ? [{ name: "idle" as const, dur: lead }] : []),
    { name: "warn" as const, dur: warn },
    { name: "active" as const, dur: active },
    { name: "idle" as const, dur: 0.6 },
  ];
  return {
    kind: "zone",
    skin: "bolt",
    x: 0,
    y: groundY - BOLT_H,
    w: BOLT_W,
    h: BOLT_H,
    harmful: false,
    hb: [8, 0, BOLT_W - 16, BOLT_H],
    cycle: { phases, loop: false, offset: 0 },
  };
}

export class WienSystem implements WorldSystem {
  private rng = new Rng(1);
  private flashT = 3;
  private thunder: number[] = [];
  private boltT = 6;
  private time = 0;

  reset(sim: Sim): void {
    this.rng = new Rng((sim.cfg.seed ^ 0x5a17) >>> 0);
    this.flashT = 2 + this.rng.range(0, 3);
    this.thunder = [];
    this.boltT = 5 + this.rng.range(0, 4);
    this.time = 0;
    sim.vars.lightning = 0;
  }

  update(sim: Sim, dt: number): void {
    this.time += dt;
    const { stage, blend } = sim.stageInfo();
    const v = sim.vars;
    // Klangteppich
    v["loop:rain"] = stageVal(RAIN, stage, blend) * 0.85;
    v["loop:wind"] = Math.min(1, Math.abs(stageVal(WIND, stage, blend)) / 600) * 0.7;
    // Abklingen
    v.lightning = Math.max(0, (v.lightning ?? 0) - dt * 2.6);
    v.farBolt = Math.max(0, (v.farBolt ?? 0) - dt * 5);

    // Ambient-Gewitter
    const storm = stageVal(STORM, stage, blend) * (0.7 + 0.3 * Math.min(1, sim.diff / 6));
    this.flashT -= dt;
    if (this.flashT <= 0) {
      const strength = this.rng.range(0.45, 1);
      v.lightning = Math.max(v.lightning, strength);
      v.boltX = this.rng.range(80, 1200);
      v.boltSeed = this.rng.int(1, 9999);
      if (strength > 0.7) v.farBolt = 1;
      this.thunder.push(this.time + 0.25 + (1 - strength) * 1.6);
      this.flashT = this.rng.range(0.6, 1.4) / Math.max(0.01, storm);
      // Doppelblitz
      if (this.rng.chance(0.3)) this.flashT = Math.min(this.flashT, 0.18);
    }
    for (let i = this.thunder.length - 1; i >= 0; i -= 1) {
      if (this.time >= this.thunder[i]) {
        this.thunder.splice(i, 1);
        sim.emit("custom", 640, 120, { tag: "sfx:thunder" });
      }
    }

    // Muster-Blitze: Himmel reagiert, Straßenbahn-Klingel
    for (const e of sim.ents) {
      if (e.dead) continue;
      if (e.skin === "bolt" && e.state === "active" && !e.fx.flashed) {
        e.fx.flashed = 1;
        v.lightning = 1;
        v.boltX = e.x - sim.dist + e.w / 2;
        sim.flash = Math.max(sim.flash, 0.28);
      } else if (e.skin === "tram" && !e.fx.bell && e.x - sim.dist < 1280 + 520) {
        e.fx.bell = 1;
        sim.emit("custom", Math.min(1280, e.x - sim.dist), e.y, { tag: "sfx:tram-bell" });
      }
    }

    // Zusätzliche Einschläge vor dem Spieler
    if (sim.phase !== "running" || sim.diff < 1.2) return;
    this.boltT -= dt;
    if (this.boltT > 0) return;
    const sp = Math.max(300, sim.speed);
    const lead = 1.05;
    const target = sim.playerWorldX + lead * sp;
    const before = 1.0 * sp;
    const after = 0.9 * sp;
    if (!this.clear(sim, target - before, target + after, lead)) {
      this.boltT = 0.3;
      return;
    }
    const spec = boltSpec(sim.groundY, 0.8, 0.3);
    sim.spawn(spec, target - BOLT_W / 2);
    // Muster dahinter nicht zu dicht nachrücken lassen
    if (sim.spawner.cursor < target + after) sim.spawner.cursor = target + after;
    const rate = 0.6 + Math.min(1, sim.diff / 8) * 0.8 + storm * 2;
    this.boltT = this.rng.range(6, 11) / rate;
  }

  private clear(sim: Sim, a: number, b: number, lead: number): boolean {
    for (const e of sim.ents) {
      if (e.dead) continue;
      if (e.kind === "pickup" || e.kind === "decor" || e.kind === "speedzone") continue;
      const fx = e.x + (e.vx || 0) * lead;
      let x0 = Math.min(e.x, fx);
      let x1 = Math.max(e.x, fx) + e.w;
      if (e.kind === "swinger") {
        x0 = e.p.ax - e.p.len - e.w;
        x1 = e.p.ax + e.p.len + e.w;
      }
      if (x1 > a && x0 < b) return false;
    }
    return true;
  }
}
