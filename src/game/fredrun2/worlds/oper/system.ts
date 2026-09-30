/**
 * Opernball – Weltsystem (nur Klang, Belohnungen und Takt – keine neuen Gefahren, damit der Bot alles vorausberechnen kann):
 *  · Saalgemurmel (`crowd-fair`, leise), wächst mit der Stufe
 *  · Tanzpaare bewegen sich im Walzerschritt: `vx` im 1-2-3-Rhythmus schnell – schnell – langsam (Mittel bleibt gleich)
 *  · gestampfter Kellner lässt Champagner-Münzen regnen
 *  · Klänge: Korkenknall, Scheinwerfer-Warnung/-Blitz
 *  · Polonaise (letzte Stufe): Konfetti-Kanonen (`vars.cannonN` zählt Salven, der Renderer schießt Konfetti)
 */
import { Rng } from "../../rng";
import type { Sim } from "../../sim";
import type { Ent, WorldSystem } from "../../types";
import { SKIN } from "./dims";
import { BEAT } from "./stages";

/** Skin → Trümmerart (0 Blütenblätter, 1 Glas, 2 Sahne/Torte, 3 Gold) für zerbrochene Hindernisse */
const DEBRIS: Record<string, number> = { [SKIN.bouquet]: 0, [SKIN.tower]: 1, [SKIN.cake]: 2, [SKIN.rope]: 3 };

/** Tempo-Faktoren der drei Schläge (Mittel 1.0): schnell – schnell – langsam */
const STEP = [1.2, 1.2, 0.6];

function smooth(u: number): number {
  const c = Math.min(1, Math.max(0, u));
  return c * c * (3 - 2 * c);
}

/** Walzer-Tempofaktor zur Taktphase `ph` (in Schlägen) */
export function waltzFactor(ph: number): number {
  const b = Math.floor(ph) % 3;
  const f = ph - Math.floor(ph);
  const cur = STEP[b];
  const prev = STEP[(b + 2) % 3];
  // die ersten 30 % jedes Schlags gleiten vom vorigen Wert zum neuen
  return prev + (cur - prev) * smooth(f / 0.3);
}

export class OperSystem implements WorldSystem {
  private rng = new Rng(1);
  private cannonT = 5;
  private cannonN = 0;
  private debrisN = 0;

  reset(sim: Sim): void {
    this.rng = new Rng((sim.cfg.seed ^ 0x0b3a) >>> 0);
    this.cannonT = 4 + this.rng.range(0, 3);
    this.cannonN = 0;
    this.debrisN = 0;
    sim.vars["loop:crowd-fair"] = 0.25;
    sim.vars.cannonN = 0;
    sim.vars.debrisN = 0;
  }

  update(sim: Sim, dt: number): void {
    const st = sim.stageInfo();
    const stage = st.stage + st.blend;
    sim.vars["loop:crowd-fair"] = Math.min(0.55, 0.22 + stage * 0.055);
    const px = sim.playerWorldX;
    for (const e of sim.ents) {
      if (e.dead) {
        // zerbrochenes Hindernis (Dash/Stampfen/Schild): Trümmer im Renderer (Blütenblätter, Glas, Sahne)
        const kind = DEBRIS[e.skin];
        if (kind !== undefined && !e.fx.broke && e.kind === "block" && e.x + e.w > sim.dist - 100) {
          e.fx.broke = 1;
          this.debrisN += 1;
          sim.vars.debrisN = this.debrisN;
          sim.vars.debrisX = e.x - sim.dist + e.w / 2;
          sim.vars.debrisY = e.y + e.h / 2;
          sim.vars.debrisK = kind;
        }
        continue;
      }
      switch (e.skin) {
        case SKIN.dancers:
          this.waltz(sim, e);
          break;
        case SKIN.waiter:
          if (e.state === "defeated" && !e.fx.paid) {
            e.fx.paid = 1;
            this.rain(sim, e, px);
          }
          break;
        case SKIN.bottle:
          if (!e.fx.sfx && e.p.popT !== undefined && e.age >= e.p.popT) {
            e.fx.sfx = 1;
            sim.emit("custom", Math.min(1240, e.x - sim.dist + e.w / 2), e.y, { tag: "sfx:splash" });
          }
          break;
        case SKIN.spot:
          if (e.state === "warn" && !e.fx.warnSfx) {
            e.fx.warnSfx = 1;
            sim.emit("custom", Math.min(1240, e.x - sim.dist + e.w / 2), e.y, { tag: "sfx:shield-on" });
          } else if (e.state === "active" && !e.fx.actSfx) {
            e.fx.actSfx = 1;
            sim.emit("custom", Math.min(1240, e.x - sim.dist + e.w / 2), e.y, { tag: "sfx:laser-zap" });
            // Blendlicht: kurzer Bildschirmblitz, solange der Kegel in der Nähe der Figur schlägt
            if (Math.abs(e.x + e.w / 2 - px) < 700) sim.flash = Math.max(sim.flash, 0.14);
          }
          break;
        default:
          break;
      }
    }
    // Konfetti-Kanonen in der Polonaise
    if (st.stage >= 4 && sim.phase === "running") {
      this.cannonT -= dt;
      if (this.cannonT <= 0) {
        this.cannonT = 5 + this.rng.range(0, 4);
        this.cannonN += 1;
        sim.vars.cannonN = this.cannonN;
        sim.emit("custom", 640, 200, { tag: "sfx:paper-flutter" });
      }
    }
  }

  /** Tanzpaar im Walzerschritt: die Geschwindigkeit pulsiert um den Ausgangswert */
  private waltz(sim: Sim, e: Ent): void {
    if (e.state === "defeated") return;
    if (e.p.vx0 === undefined) e.p.vx0 = e.vx;
    if (e.p.vx0 === 0) return;
    const ph = sim.time / BEAT + e.id * 0.9;
    e.vx = e.p.vx0 * waltzFactor(ph);
  }

  /** Champagner-Münzen: ein Bogen vor der Figur */
  private rain(sim: Sim, e: Ent, px: number): void {
    const gy = sim.groundY;
    const base = Math.max(e.x + e.w / 2, px + 80);
    const n = 7;
    for (let i = 0; i < n; i += 1) {
      const u = i / (n - 1);
      const size = 34;
      sim.spawn(
        {
          kind: "pickup",
          skin: "coin",
          pickup: "coin",
          x: u * 300,
          y: gy - 60 - Math.sin(u * Math.PI) * 120 - size / 2,
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
