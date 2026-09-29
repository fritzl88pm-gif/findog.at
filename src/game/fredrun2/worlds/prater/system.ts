/**
 * Prater – Weltsystem: Jahrmarkt-Geräuschkulisse, Kanonendonner beim Anflug, Zuckerwatte-Kisten
 * schütten beim Zerschlagen (Dash/Stampfen) Jetons aus.
 */
import type { Sim } from "../../sim";
import type { Ent, WorldSystem } from "../../types";

export class PraterSystem implements WorldSystem {
  private crates = new Set<Ent>();

  reset(sim: Sim): void {
    this.crates.clear();
    sim.vars["loop:crowd-fair"] = 0.5;
  }

  update(sim: Sim, dt: number): void {
    void dt;
    const st = sim.stageInfo();
    sim.vars["loop:crowd-fair"] = Math.min(0.85, 0.45 + st.stage * 0.08 + Math.min(0.15, sim.diff * 0.02));
    const px = sim.playerWorldX;
    for (const e of sim.ents) {
      if (e.dead) continue;
      if (e.skin === "candy-crate" && !e.fx.tracked) {
        e.fx.tracked = 1;
        this.crates.add(e);
      } else if (e.kind === "projectile" && e.skin === "cannonball" && !e.fx.boom && e.x - px < 1250) {
        e.fx.boom = 1;
        sim.emit("custom", 1240, e.y + e.h / 2, { tag: "sfx:cannon" });
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
  }

  /** Jetons in einem kleinen Bogen vor der Figur ausschütten */
  private burst(sim: Sim, e: Ent): void {
    const gy = sim.groundY;
    const base = Math.max(e.x + e.w / 2, sim.playerWorldX + 40);
    for (let i = 0; i < 6; i += 1) {
      const u = i / 5;
      const size = 34;
      sim.spawn(
        {
          kind: "pickup",
          skin: "coin",
          pickup: "coin",
          x: 30 + u * 260,
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
