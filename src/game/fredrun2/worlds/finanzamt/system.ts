/**
 * Finanzamt – Weltsystem:
 *  • Dunkelheit je Stufe (`vars.darkness`), Notbeleuchtung/Alarm (`vars.alarm`), gelegentlicher Stromausfall
 *    (`vars.blackout`, ab den Glasbüros; rein optisch, Taschenlampe bleibt).
 *  • „Stempel-Razzia“: zusätzliche Riesenstempel vor der Figur (ab diff 1.5), immer ≥ 1.2 s Vorlauf mit Warnschatten
 *    und nur in freien Abschnitten (±1 s ohne Muster-Gefahren).
 *  • Klangteppich: Büro-Brummen, Laser-Summen je nach nahen Laser-Gittern, Papierrascheln bei Aktenlawinen.
 *  • Tour: blendet die Dunkelheit am Ausgangstor aus (`vars["fa:exit"]`).
 */
import { Rng } from "../../rng";
import type { Sim } from "../../sim";
import type { EntSpec, WorldSystem } from "../../types";
import { stageVal } from "../shared-b/color";
import { STAMP_H, STAMP_HB, STAMP_W } from "./geom";
import { DARK, EMERGENCY } from "./stages";

/** Einmaliger Stempel-Einschlag (Zone) mit Vorlauf `lead` (Sekunden bis zum Beginn der Warnphase). */
export function stampSpec(groundY: number, lead: number, warn = 0.85, active = 0.28): EntSpec {
  return {
    kind: "zone",
    skin: "stamp",
    x: 0,
    y: groundY - STAMP_H,
    w: STAMP_W,
    h: STAMP_H,
    harmful: false,
    hb: [...STAMP_HB],
    cycle: {
      phases: [
        { name: "idle", dur: Math.max(0.05, lead) },
        { name: "warn", dur: warn },
        { name: "active", dur: active },
        { name: "idle", dur: 0.75 },
      ],
      loop: false,
      offset: 0,
    },
  };
}

export class FinanzamtSystem implements WorldSystem {
  private rng = new Rng(1);
  private stampT = 9;
  private blackT = 30;
  /** Zeit seit Beginn des Stromausfalls (< 0: keiner) */
  private blackPhase = -1;
  private laserHum = 0;

  reset(sim: Sim): void {
    this.rng = new Rng((sim.cfg.seed ^ 0xfa11) >>> 0);
    this.stampT = 8 + this.rng.range(0, 5);
    this.blackT = 20 + this.rng.range(0, 14);
    this.blackPhase = -1;
    this.laserHum = 0;
    sim.vars.darkness = DARK[0];
    sim.vars.blackout = 0;
  }

  update(sim: Sim, dt: number): void {
    const { stage, blend } = sim.stageInfo();
    const s = stage + blend;
    const v = sim.vars;

    // Tour: Ausgangstor naht → Dunkelheit ausblenden
    const gate = sim.nextGate;
    v["fa:exit"] = gate && gate.from === "finanzamt" ? sim.gateBlend : 0;

    // Stromausfall (ab Stufe 2): 0.6 s Flackern, ~2.8 s Notlicht, 0.8 s Wiederanlauf
    let black = 0;
    if (this.blackPhase >= 0) {
      this.blackPhase += dt;
      const t = this.blackPhase;
      if (t < 0.6) black = t / 0.6;
      else if (t < 3.4) black = 1;
      else if (t < 4.2) black = 1 - (t - 3.4) / 0.8;
      else {
        this.blackPhase = -1;
        this.blackT = 24 + this.rng.range(0, 18);
      }
    } else if (s >= 1.8 && sim.phase === "running") {
      this.blackT -= dt;
      if (this.blackT <= 0) this.blackPhase = 0;
    }
    v.blackout = black;
    v.darkness = Math.min(0.85, stageVal(DARK, s) + black * 0.12);
    v.alarm = stageVal(EMERGENCY, s);

    // Klang
    v["loop:office-hum"] = (0.5 - 0.22 * Math.min(1, s / 4)) * (1 - black * 0.85);
    let hum = 0;
    const px = sim.playerWorldX;
    for (const e of sim.ents) {
      if (e.dead) {
        // zerlegter Aktenstapel/Karton → Papier-Explosion (Renderer) + Rascheln
        if ((e.skin === "paper-stack" || e.skin === "boxes") && !e.fx.burst) {
          e.fx.burst = 1;
          v["fa:burst"] = (v["fa:burst"] ?? 0) + 1;
          v["fa:burstX"] = e.x - sim.dist + e.w / 2;
          v["fa:burstY"] = e.y + e.h / 2;
          sim.emit("custom", e.x - sim.dist + e.w / 2, e.y, { tag: "sfx:paper-flutter" });
        }
        continue;
      }
      const dx = e.x - px;
      if (dx < -300 || dx > 1150) continue;
      if (e.kind === "zone" && e.skin.startsWith("laser")) {
        const near = 1 - Math.max(0, dx) / 1400;
        hum = Math.max(hum, (e.state === "active" ? 0.8 : e.state === "warn" ? 0.5 : 0.22) * near);
      } else if (e.skin === "paper-stack" && e.vx < 0 && !e.fx.snd && e.x - sim.dist < 1300) {
        e.fx.snd = 1;
        sim.emit("custom", Math.min(1280, e.x - sim.dist), e.y, { tag: "sfx:paper-flutter" });
      }
    }
    this.laserHum += (hum - this.laserHum) * Math.min(1, dt * 6);
    v["loop:laser-hum"] = this.laserHum;

    // Stempel-Razzia
    if (sim.phase !== "running" || sim.diff < 1.5) return;
    this.stampT -= dt;
    if (this.stampT > 0) return;
    const sp = Math.max(320, sim.speed);
    const lead = 1.2;
    const target = px + lead * sp;
    if (!this.clear(sim, target - 1.0 * sp - STAMP_W, target + 1.0 * sp, lead)) {
      this.stampT = 0.35;
      return;
    }
    // Einschlag, wenn die Figur die Mitte erreicht (45 % ins aktive Fenster)
    const warnStart = lead - 0.85 - 0.28 * 0.45;
    sim.spawn(stampSpec(sim.groundY, warnStart), target - STAMP_W / 2);
    const after = target + 1.0 * sp;
    if (sim.spawner.cursor < after) sim.spawner.cursor = after;
    const rate = 0.5 + Math.min(1, sim.diff / 8) * 0.7 + s * 0.08;
    this.stampT = this.rng.range(7, 12) / rate;
  }

  private clear(sim: Sim, a: number, b: number, lead: number): boolean {
    for (const e of sim.ents) {
      if (e.dead) continue;
      if (e.kind === "pickup" || e.kind === "decor") continue;
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
