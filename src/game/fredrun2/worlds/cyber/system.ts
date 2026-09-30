/**
 * Cyber-Wien 2099 – Weltsystem (keine zusätzlichen Gefahren):
 *  · Spielfeld-Anschlag: Die Figur kann das Feld zwischen Boden und Decke nicht verlassen (Kopf stößt an der Gegenfläche
 *    an). Ohne das schleudert z.B. ein Sprung direkt nach einem Portal (= Doppelsprung weg von der neuen Lauffläche) die
 *    Figur kurz durch den Boden aus dem Bild. (Engine-Wunsch „Kein Anschlag an der Gegenfläche“, bis dahin hier.)
 *  · Dauerklang `cyber-hum` (lauter in späteren Stufen), `laser-hum` in der Nähe aktiver Laserzäune
 *  · Glitch-Schübe im Glitch-Sturm (`sim.vars.glitch` 0..1 für den Renderer, Ton `glitch`)
 *  · Glitch-Würfel knistern beim Materialisieren in Sichtweite (Ton `glitch`, gedrosselt)
 * Eigener Zufallsgenerator → verändert die Level-Erzeugung (sim.rng) nicht.
 */
import { PLAYER_H } from "../../constants";
import type { Sim } from "../../sim";
import type { WorldSystem } from "../../types";
import { mulberry } from "../shared-b/color";

const GLITCH_STAGE = [0, 0, 0.1, 1, 0.3];

export class CyberSystem implements WorldSystem {
  private rnd = mulberry(4711);
  private burstCool = 3;
  private burst = 0;
  private sfxCool = 0;

  reset(sim: Sim): void {
    this.rnd = mulberry(4711);
    this.burstCool = 3;
    this.burst = 0;
    this.sfxCool = 0;
    sim.vars["loop:cyber-hum"] = 0.55;
    sim.vars.glitch = 0;
  }

  update(sim: Sim, dt: number): void {
    // Spielfeld-Anschlag (gilt für beide Schwerkraftrichtungen, hgt wird von der aktuellen Lauffläche gemessen)
    const p = sim.player;
    const maxH = sim.groundY - sim.ceilY - PLAYER_H;
    if (maxH > 0 && p.hgt > maxH) {
      p.hgt = maxH;
      if (p.vy > 0) p.vy = 0;
    }
    const st = sim.stageInfo();
    const s = st.stage + st.blend;
    sim.vars["loop:cyber-hum"] = Math.min(0.9, 0.5 + s * 0.08);
    this.sfxCool = Math.max(0, this.sfxCool - dt);

    // Glitch-Schübe
    const i0 = Math.min(4, st.stage);
    const i1 = Math.min(4, st.stage + 1);
    const g = GLITCH_STAGE[i0] + (GLITCH_STAGE[i1] - GLITCH_STAGE[i0]) * st.blend;
    this.burst = Math.max(0, this.burst - dt * 2.2);
    if (g > 0.05) {
      this.burstCool -= dt * g;
      if (this.burstCool <= 0) {
        this.burstCool = 2.2 + this.rnd() * 3.5;
        this.burst = 0.7 + this.rnd() * 0.3;
        if (this.sfxCool <= 0) {
          sim.emit("custom", 640, 360, { tag: "sfx:glitch" });
          this.sfxCool = 0.4;
        }
      }
    }
    sim.vars.glitch = this.burst;

    // Würfel & Laserzäune in Sichtweite
    const px = sim.playerWorldX;
    let fenceNear = 0;
    for (const e of sim.ents) {
      if (e.dead || e.kind !== "zone") continue;
      const dx = e.x - px;
      if (dx < -300 || dx > 900) continue;
      if (e.skin === "beam-fence") fenceNear = Math.max(fenceNear, 1 - Math.max(0, dx) / 900);
      if (e.skin === "glitch-cube") {
        const was = e.fx.sysState ?? 0;
        const now = e.state === "active" ? 1 : 0;
        if (now && !was && dx > 0 && this.sfxCool <= 0) {
          sim.emit("custom", e.x - sim.dist + e.w / 2, e.y + e.h / 2, { tag: "sfx:glitch" });
          this.sfxCool = 0.35;
        }
        e.fx.sysState = now;
      }
    }
    sim.vars["loop:laser-hum"] = fenceNear * 0.5;
  }
}
