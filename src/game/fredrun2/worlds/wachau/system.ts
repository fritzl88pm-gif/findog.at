/**
 * Wachau – Weltsystem:
 *  • Fass-Auslöser: Muster legen "barrel-cue"-Markierungen; ≈ 1.35 s bevor die Figur dort ist, kugelt ein Weinfass
 *    vom rechten Rand heran (Warnpfeil + Rollgeräusch, Tempo exakt auf den Treffpunkt abgestimmt).
 *  • Terrassen-Fässer (ab diff ≥ 1.8): zusätzliche Fässer springen im Bogen von den Weinterrassen auf den Weg –
 *    nur wenn rund um den Treffpunkt ≥ 1 s frei ist (keine Mustergefahren, keine Lücken); Vorwarnung ≥ 1.3 s.
 *  • Fässer, die ins Wasser rollen, gehen baden (harmlos, treiben). Weinkisten schütten beim Zerschlagen Marillen aus.
 *  • Klang: Donau-Rauschen je nach Wassernähe, Böen (Blätterwirbel, rein optisch), Bienensummen, Platschen.
 */
import { Rng } from "../../rng";
import type { Sim } from "../../sim";
import type { Ent, EntSpec, WorldSystem } from "../../types";

const FALL_G = 2700 * 0.9;
/** Vorlauf (Sekunden bis zum Treffpunkt), mit dem ein Fass am rechten Rand startet */
export const BARREL_LEAD = 1.35;

export function barrelSpec(sim: Sim, meetX: number, vx: number, size: number, tumble: boolean): { spec: EntSpec; x0: number } {
  const sp = Math.max(300, sim.speed);
  const Tm = Math.max(0.8, (meetX - sim.playerWorldX) / sp);
  const x0 = meetX - vx * Tm;
  const gy = sim.groundY;
  let y0 = gy - size;
  let vy0 = 0;
  if (tumble) {
    // Kracht ≈ 0.52 s vor dem Treffpunkt steil von den Terrassen oben rechts auf den Weg
    const tL = Math.max(0.35, Tm - 0.52);
    vy0 = 160;
    y0 = gy - size - vy0 * tL - 0.5 * FALL_G * tL * tL;
  }
  return {
    x0,
    spec: {
      kind: "walker",
      skin: "barrel",
      x: 0,
      y: y0,
      w: size,
      h: size,
      vx,
      vy: vy0,
      hb: [size * 0.16, size * 0.12, size * 0.68, size * 0.86],
      harmful: true,
      stompable: false,
      breakable: true,
      warn: true,
      // hopEvery groß → Schwerkraft aktiv, aber kein eigenes Hüpfen
      p: { hopEvery: 90, hopV: 0, tumble: tumble ? 1 : 0 },
    },
  };
}

export class WachauSystem implements WorldSystem {
  private rng = new Rng(1);
  private barrelT = 9;
  private gustT = 8;
  private gustPhase = 0;
  private time = 0;
  private crates = new Set<Ent>();
  private river = 0.3;

  reset(sim: Sim): void {
    this.rng = new Rng((sim.cfg.seed ^ 0x3a17c0) >>> 0);
    this.barrelT = 7 + this.rng.range(0, 5);
    this.gustT = 6 + this.rng.range(0, 6);
    this.gustPhase = 0;
    this.time = 0;
    this.crates.clear();
    this.river = 0.3;
    sim.vars.gust = 0;
    sim.vars["loop:river"] = 0.3;
    sim.vars["loop:wind"] = 0.08;
  }

  update(sim: Sim, dt: number): void {
    this.time += dt;
    const v = sim.vars;
    const px = sim.playerWorldX;
    const gy = sim.groundY;

    // --- Wasser in der Nähe?
    let waterNear = 0;
    for (const e of sim.ents) {
      if (e.kind !== "pit" || e.dead) continue;
      const d = e.x - px;
      if (d < 900 && e.x + e.w > px - 200) waterNear = 1;
    }
    this.river += ((0.28 + waterNear * 0.45) - this.river) * Math.min(1, dt * 1.5);
    v["loop:river"] = this.river;

    // --- Böen (optisch + Klang)
    this.gustT -= dt;
    if (this.gustT <= 0 && this.gustPhase === 0) {
      this.gustPhase = 0.0001;
      this.gustT = 9 + this.rng.range(0, 10);
    }
    if (this.gustPhase > 0) {
      this.gustPhase += dt;
      const p = this.gustPhase;
      v.gust = p < 0.6 ? p / 0.6 : p < 2.2 ? 1 : Math.max(0, 1 - (p - 2.2) / 1.2);
      if (p > 3.4) {
        this.gustPhase = 0;
        v.gust = 0;
      }
    }
    const st = sim.stageInfo();
    v["loop:wind"] = 0.06 + (v.gust ?? 0) * 0.5 + (st.stage === 0 ? 0.05 : 0);

    // --- Entitäten: Auslöser, Klänge, Baden, Kisten
    for (const e of sim.ents) {
      if (e.dead) continue;
      if (e.kind === "decor" && e.skin === "barrel-cue") {
        const sp = Math.max(300, sim.speed);
        if (e.x - px <= sp * BARREL_LEAD) {
          e.dead = true;
          if (sim.phase === "running") {
            const { spec, x0 } = barrelSpec(sim, e.x + e.w / 2, e.p.vx || -320, e.p.size || 70, !!e.p.tumble);
            sim.spawn(spec, x0);
          }
        }
        continue;
      }
      if (e.kind === "walker" && e.skin === "barrel") {
        const sx = e.x - sim.dist;
        if (!e.fx.snd && sx < 1280 + 260) {
          e.fx.snd = 1;
          sim.emit("custom", Math.min(1260, Math.max(20, sx)), gy - 40, { tag: "sfx:barrel-roll" });
        }
        const grounded = e.y + e.h >= gy - 0.5;
        // Hüpfer über die Wegkante beim Hereinrollen (nicht bei Terrassen-Fässern)
        if (!e.fx.hop && !e.p.tumble && grounded && sx < 1300 && sx > 700 && e.state !== "sunk") {
          e.fx.hop = 1;
          e.vy = -430;
          e.p.hopT = 90;
        }
        if (e.state !== "sunk" && grounded && this.overWater(sim, e.x + e.w / 2)) {
          e.state = "sunk";
          e.stateT = 0;
          e.harmful = false;
          e.vx = 0;
          e.warn = false;
          sim.emit("custom", Math.max(0, Math.min(1280, sx + e.w / 2)), gy, { tag: "sfx:splash" });
        }
        continue;
      }
      if (e.kind === "flyer" && e.skin === "bees" && !e.fx.snd && e.x - sim.dist < 1300) {
        e.fx.snd = 1;
        sim.emit("custom", Math.min(1260, e.x - sim.dist), e.y, { tag: "sfx:bee-buzz" });
        continue;
      }
      if (e.kind === "platform" && e.state === "crumbling" && !e.fx.snd) {
        e.fx.snd = 1;
        sim.emit("custom", e.x - sim.dist + e.w / 2, gy + 10, { tag: "sfx:splash" });
        continue;
      }
      if (e.kind === "block" && e.breakable && !e.fx.tracked) {
        e.fx.tracked = 1;
        this.crates.add(e);
      }
    }
    for (const e of this.crates) {
      if (e.dead) {
        this.crates.delete(e);
        if (Math.abs(e.x + e.w / 2 - px) < 420) this.burst(sim, e);
      } else if (e.x + e.w < sim.dist - 200) {
        this.crates.delete(e);
      }
    }

    // --- Terrassen-Fässer
    if (sim.phase !== "running" || sim.diff < 1.8) return;
    this.barrelT -= dt;
    if (this.barrelT > 0) return;
    const sp = Math.max(300, sim.speed);
    const Tm = 1.3 + this.rng.range(0, 0.15);
    const meet = px + sp * Tm;
    const vx = -(280 + Math.min(1, sim.diff / 9) * 140 + this.rng.range(0, 50));
    const x0 = meet - vx * Tm;
    const before = sp * 1.05;
    const after = sp * 1.0;
    if (!this.clear(sim, meet - before, Math.max(x0 + 80, meet + after))) {
      this.barrelT = 0.35;
      return;
    }
    const size = this.rng.int(66, 76);
    const { spec, x0: sx0 } = barrelSpec(sim, meet, vx, size, true);
    sim.spawn(spec, sx0);
    if (sim.spawner.cursor < meet + after) sim.spawner.cursor = meet + after;
    const rate = 0.55 + Math.min(1, sim.diff / 8) * 0.75;
    this.barrelT = this.rng.range(7, 12) / rate;
  }

  private overWater(sim: Sim, x: number): boolean {
    for (const e of sim.ents) {
      if (e.kind === "pit" && !e.dead && x > e.x + 18 && x < e.x + e.w - 18) return true;
    }
    return false;
  }

  /** Frei von Gefahren, Lücken, Plattformen, Aufwind und Fass-Markierungen im Weltbereich [a, b]? */
  private clear(sim: Sim, a: number, b: number): boolean {
    for (const e of sim.ents) {
      if (e.dead) continue;
      if (e.kind === "pickup" || e.kind === "speedzone") continue;
      if (e.kind === "decor" && e.skin !== "barrel-cue") continue;
      let x0 = e.x;
      let x1 = e.x + e.w;
      if (e.kind === "walker" || e.kind === "projectile") {
        x0 = Math.min(e.x, e.x + e.vx * 2);
        x1 = Math.max(e.x + e.w, e.x + e.w + e.vx * 2);
      }
      if (e.kind === "swinger") {
        x0 = e.p.ax - e.p.len - e.w;
        x1 = e.p.ax + e.p.len + e.w;
      }
      if (x1 > a && x0 < b) return false;
    }
    return true;
  }

  /** Marillen aus einer zerschlagenen Weinkiste */
  private burst(sim: Sim, e: Ent): void {
    const gy = sim.groundY;
    const base = Math.max(e.x + e.w / 2, sim.playerWorldX + 40);
    for (let i = 0; i < 5; i += 1) {
      const u = i / 4;
      const size = 34;
      sim.spawn(
        {
          kind: "pickup",
          skin: "coin",
          pickup: "coin",
          x: 30 + u * 240,
          y: gy - 70 - Math.sin(u * Math.PI) * 90 - size / 2,
          w: size,
          h: size,
          hb: [-size * 0.15, -size * 0.15, size * 1.3, size * 1.3],
          harmful: false,
        },
        base,
      );
    }
    sim.emit("custom", e.x - sim.dist + e.w / 2, e.y, { tag: "sfx:coin" });
  }
}
