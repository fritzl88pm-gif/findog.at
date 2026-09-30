/**
 * Alpenpanorama – Weltsystem „Lawine“.
 *
 * Ab Schwierigkeit 2.5 bricht in Abständen eine Schneewalze los und jagt die Figur von links:
 *   idle → rumble (≈2.4 s Vorwarnung: Grollen, Pulverschnee am linken Rand, HUD-Warnrand) → chase (14–28 s) → retreat.
 * Der Abstand wird in ZEIT gemessen (Sekunden Vorsprung bei Normaltempo), damit die Lawine bei jedem Tempo gleich
 * bedrohlich wirkt. Sie ist leicht „gummibandartig“: ungehindertes Laufen hält den Vorsprung bei ≈0.62 s; Treffer
 * (Tempoverlust + Strafe in `onHurt`), Tiefschnee und Stolpern lassen sie aufholen, Dash/Turbo bringen Luft.
 * Erst wenn der Vorsprung aufgebraucht ist (zwei schnelle oder drei gehäufte Fehler), trifft sie: `sim.hurt("lawine")`
 * und sie wird weit zurückgesetzt. Ist die Figur gerade unverwundbar, bleibt die Walze an den Fersen und trifft erst,
 * wenn der Schutz endet – ein Dash rettet. Fair: nie ohne Vorwarnung (Grollen ≥ 2 s, Warnrand), nie direkt nach dem
 * Betreten der Welt, nur in den verschneiten Höhenlagen (ab Stufe 2), nie unausweichlich.
 *
 * Außerdem: Wind-Klangteppich je Höhenstufe.
 */
import { Rng } from "../../rng";
import type { Sim } from "../../sim";
import type { WorldSystem } from "../../types";
import { stageVal } from "../shared-b/color";
import { WIND } from "./stages";

type Phase = "idle" | "rumble" | "chase" | "retreat";

/** Mindest-Schwierigkeit für Lawinen */
export const AVALANCHE_MIN_DIFF = 2.5;
/** Mindest-Stimmungsstufe (verschneite Höhenlagen) */
export const AVALANCHE_MIN_STAGE = 2;
/** Soll-Vorsprung während der Jagd (Sekunden) */
export const AVALANCHE_TARGET = 0.62;
const RUMBLE_TIME = 2.4;
const START_GAP = 1.15;
const HURT_PENALTY = 0.12;
const RESET_GAP = 0.7;

export class AlpenSystem implements WorldSystem {
  private rng = new Rng(1);
  private phase: Phase = "idle";
  private phaseT = 0;
  private worldT = 0;
  private cooldown = 5;
  private chaseLen = 16;
  /** Vorsprung in Sekunden */
  private gapT = START_GAP;
  private presence = 0;
  private grace = 0;
  private hit = 0;
  /** Anzahl bisheriger Lawinen (die erste ist kürzer) */
  private count = 0;

  reset(sim: Sim): void {
    this.rng = new Rng((sim.cfg.seed ^ 0xa1be) >>> 0);
    this.phase = "idle";
    this.phaseT = 0;
    this.worldT = 0;
    this.cooldown = 5 + this.rng.range(0, 3);
    this.gapT = START_GAP;
    this.presence = 0;
    this.grace = 0;
    this.hit = 0;
    this.count = 0;
    this.publish(sim);
  }

  /** Normaltempo (ohne Treffer-/Dash-Effekte) */
  private refSpeed(sim: Sim): number {
    return Math.max(300, sim.speedAtDiff(sim.diff) * (sim.world.speedScale ?? 1));
  }

  update(sim: Sim, dt: number): void {
    this.worldT += dt;
    const { stage, blend } = sim.stageInfo();
    const s = stage + blend;
    const v = sim.vars;
    v["loop:wind"] = Math.min(1, stageVal(WIND, s) * 0.75 + this.presence * 0.15);
    this.hit = Math.max(0, this.hit - dt * 1.6);
    this.grace = Math.max(0, this.grace - dt);

    const running = sim.phase === "running";
    const ref = this.refSpeed(sim);
    this.phaseT += dt;
    switch (this.phase) {
      case "idle": {
        this.presence = Math.max(0, this.presence - dt * 0.8);
        // erst in den verschneiten Höhenlagen (ab Stufe „Gipfelregion“) – in der Welt-Reihenfolge fällt das mit
        // diff ≥ 2.5 (≈ 950 m) zusammen, in der Tour verhindert es Lawinen auf der Blumenwiese
        if (!running || sim.diff < AVALANCHE_MIN_DIFF || stage < AVALANCHE_MIN_STAGE) break;
        // In der Tour erst ein paar Sekunden nach dem Betreten
        if (this.worldT < 6) break;
        this.cooldown -= dt;
        if (this.cooldown <= 0) this.enter("rumble", sim);
        break;
      }
      case "rumble": {
        const u = Math.min(1, this.phaseT / RUMBLE_TIME);
        this.presence = Math.max(this.presence, u);
        // Die Walze rast heran: Vorsprung schrumpft auf den Sollwert
        this.gapT = START_GAP + (AVALANCHE_TARGET + 0.08 - START_GAP) * u * u;
        if (this.phaseT >= RUMBLE_TIME) this.enter("chase", sim);
        break;
      }
      case "chase": {
        this.presence = 1;
        // Gummiband: weit weg → etwas schneller, nah dran → langsamer (Luft zum Erholen)
        const d = Math.max(-1, Math.min(1, (this.gapT - AVALANCHE_TARGET) / 0.35));
        let k = 1 + (d > 0 ? 0.16 : 0.05) * d - 0.012;
        // an den Fersen gibt es keine Gnade mehr: nur Tempo (Dash/Turbo) bringt Luft
        if (this.gapT < 0.12) k = Math.max(k, 1);
        if (this.grace > 0) k = Math.min(k, 0.86);
        const aSpeed = ref * k;
        this.gapT += ((sim.speed - aSpeed) * dt) / ref;
        this.gapT = Math.min(this.gapT, 1.6);
        if (this.gapT <= 0.02 && running) {
          const p = sim.player;
          if (p.invuln > 0 || p.dashT > 0 || p.turbo > 0) {
            // unverwundbar: die Walze bleibt dicht dran und trifft, sobald der Schutz endet (Dash rettet)
            this.gapT = 0.02;
          } else {
            sim.hurt("lawine");
            this.hit = 1;
            this.gapT = RESET_GAP;
            this.grace = 2.5;
            sim.emit("custom", 120, sim.groundY - 120, { tag: "sfx:avalanche-warn" });
          }
        }
        if (this.phaseT >= this.chaseLen) this.enter("retreat", sim);
        break;
      }
      case "retreat": {
        this.gapT += ((sim.speed - ref * 0.72) * dt) / ref;
        this.presence = Math.max(0, 1 - this.phaseT / 3.2);
        if (this.presence <= 0) this.enter("idle", sim);
        break;
      }
    }
    if (!running && this.phase !== "idle") this.gapT = Math.max(this.gapT, 0.3);
    this.publish(sim);
  }

  private enter(p: Phase, sim: Sim): void {
    this.phase = p;
    this.phaseT = 0;
    const diff = sim.diff;
    if (p === "rumble") {
      this.gapT = START_GAP;
      sim.emit("custom", 40, sim.groundY - 200, { tag: "sfx:avalanche-warn" });
    } else if (p === "chase") {
      this.count += 1;
      const extra = Math.min(8, Math.max(0, diff - AVALANCHE_MIN_DIFF) * 1.2);
      this.chaseLen = (this.count === 1 ? 10 : 14) + this.rng.range(0, 6) + extra;
    } else if (p === "idle") {
      this.cooldown = this.rng.range(10, 17) - Math.min(4, diff * 0.35);
      this.gapT = START_GAP;
    }
  }

  onHurt(sim: Sim, source: string): void {
    if (source === "lawine") return;
    if (this.phase === "chase" || this.phase === "rumble") {
      this.gapT = Math.max(0.05, this.gapT - HURT_PENALTY);
      sim.vars.avalancheSurge = 1;
    }
  }

  private publish(sim: Sim): void {
    const v = sim.vars;
    const ref = this.refSpeed(sim);
    const active = this.phase !== "idle" || this.presence > 0.001;
    v.avalanche = this.presence;
    v.avalancheT = active ? this.gapT : 9;
    v.avalancheGap = active ? this.gapT * ref : 99999;
    v.avalancheHit = this.hit;
    v.avalancheRumble = this.phase === "rumble" ? Math.min(1, this.phaseT / RUMBLE_TIME) : this.phase === "chase" ? 0.55 + 0.45 * Math.max(0, 1 - this.gapT / 0.8) : this.presence * 0.4;
    let warn = 0;
    if (this.phase === "rumble") warn = 0.35 + 0.35 * Math.min(1, this.phaseT / RUMBLE_TIME);
    else if (this.phase === "chase") warn = Math.max(0.15, Math.min(1, (0.62 - this.gapT) / 0.42 + 0.3));
    else if (this.phase === "retreat") warn = 0.15 * this.presence;
    v.chaseWarn = warn;
    const close = Math.max(0, Math.min(1, 1 - (this.gapT - 0.15) / 0.9));
    v["loop:avalanche"] = this.presence * (0.35 + 0.65 * close);
    v.avalancheSurge = Math.max(0, (v.avalancheSurge ?? 0) - 0.02);
  }

  /** Test-/Debug-Zugriff */
  get state(): { phase: Phase; gapT: number; presence: number } {
    return { phase: this.phase, gapT: this.gapT, presence: this.presence };
  }
}
