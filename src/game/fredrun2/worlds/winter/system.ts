/**
 * Christkindlmarkt – Weltsystem.
 *
 *  • Klangteppich: Wind (im Schneesturm laut, Böen), Marktgemurmel (nur in den Marktstufen).
 *  • Böen (`vars.gust`) für Schneetreiben und Wind-Klang.
 *  • Eis: `vars.onIce`, damit der Renderer Eisspuren/Funken unter den Füßen zeichnen kann; in der Stufe „Eistraum“ schiebt das
 *    System zusätzlich „Eisrausch“-Abschnitte (lange Eisfläche + Sternenwellen) zwischen die Muster.
 *  • Lebkuchenmänner lassen beim Stampfen Sterne fallen; Schneebälle zerspringen (Treffer, Dash, Boden); Klänge für Wurf,
 *    Zapfen-Einschlag und Krampus-Glocken.
 *  • Krampus-Verfolgung (ab Stufe „Krampuslauf“): ein riesiger Krampus-Schatten holt von links auf. Vorwarnung: drei
 *    Glockenschläge + rote Augen am linken Rand (`vars.chaseWarn`), dann Verfolgung mit Gummiband: ungehindertes Laufen hält
 *    den Vorsprung, Treffer/Stolpern verkürzen ihn. Ist er aufgebraucht: `sim.hurt("krampus")` und der Krampus wird
 *    weit zurückgesetzt. Nie ohne Vorwarnung, nie direkt nach Betreten der Stufe, nie unausweichlich.
 */
import { SPAWN_AHEAD } from "../../constants";
import { createPatternCtx } from "../../patterns";
import { Rng } from "../../rng";
import type { Sim } from "../../sim";
import { restSeconds } from "../../spawner";
import type { Ent, EntSpec, SimEvent, WorldSystem } from "../../types";
import { stageVal } from "../shared-b/color";
import { ICE_RUN } from "./patterns";
import { CROWD_LOOP, GUST_EVERY, MAX_STAGE, WIND_LOOP } from "./stages";

type Phase = "idle" | "warn" | "chase" | "retreat";

/** Ab dieser Stufe (Krampuslauf) jagt der Krampus */
export const CHASE_MIN_STAGE = MAX_STAGE;
export const CHASE_MIN_DIFF = 2.6;
/** Soll-Vorsprung während der Jagd (Sekunden bei Normaltempo) */
export const CHASE_TARGET = 0.62;
const WARN_TIME = 2.6;
const START_GAP = 1.15;
const HURT_PENALTY = 0.12;
const RESET_GAP = 0.7;
const BURST_LIFE = 0.55;

export class WinterSystem implements WorldSystem {
  private rng = new Rng(1);
  private time = 0;
  private stageT = 0;
  private lastStage = -1;
  // Böen
  private gustNext = 6;
  private gustT = -1;
  private gustLen = 2.6;
  private gustPeak = 0.8;
  // Eisrausch
  private iceCooldown = 7;
  // Effekte
  private bursts: Ent[] = [];
  private seen = new WeakSet<SimEvent>();
  // Krampus-Verfolgung
  private phase: Phase = "idle";
  private phaseT = 0;
  private cooldown = 5;
  private chaseLen = 16;
  private gapT = START_GAP;
  private presence = 0;
  private grace = 0;
  private hit = 0;
  private count = 0;
  private bellsDone = 0;
  private onIce = 0;
  private iceRaw = false;

  reset(sim: Sim): void {
    this.rng = new Rng((sim.cfg.seed ^ 0x57e1) >>> 0);
    this.time = 0;
    this.stageT = 0;
    this.lastStage = -1;
    this.gustNext = 5 + this.rng.range(0, 4);
    this.gustT = -1;
    this.iceCooldown = 6 + this.rng.range(0, 4);
    this.bursts = [];
    this.phase = "idle";
    this.phaseT = 0;
    this.cooldown = 5 + this.rng.range(0, 3);
    this.gapT = START_GAP;
    this.presence = 0;
    this.grace = 0;
    this.hit = 0;
    this.count = 0;
    this.bellsDone = 0;
    this.onIce = 0;
    this.iceRaw = false;
    sim.vars.gust = 0;
    this.publish(sim);
  }

  /** Normaltempo (ohne Treffer-/Dash-/Eis-Effekte) */
  private refSpeed(sim: Sim): number {
    return Math.max(300, sim.speedAtDiff(sim.diff) * (sim.world.speedScale ?? 1));
  }

  update(sim: Sim, dt: number): void {
    this.time += dt;
    const { stage, blend } = sim.stageInfo();
    const s = stage + blend;
    const v = sim.vars;
    if (stage !== this.lastStage) {
      this.lastStage = stage;
      this.stageT = 0;
    }
    this.stageT += dt;
    const running = sim.phase === "running";

    this.updateGusts(sim, dt, stage);
    v["loop:wind"] = Math.min(1, stageVal(WIND_LOOP, s) + (v.gust ?? 0) * 0.28 + this.presence * 0.12);
    v["loop:crowd-fair"] = stageVal(CROWD_LOOP, s);

    this.scanEntities(sim);
    this.updateBursts(dt);
    this.updateIce(sim, dt);
    if (running) this.maybeIceRun(sim, dt, stage);
    this.updateChase(sim, dt, stage, running);
    this.publish(sim);
  }

  // --- Böen ---------------------------------------------------------------------------------------

  private updateGusts(sim: Sim, dt: number, stage: number): void {
    const v = sim.vars;
    if (this.gustT >= 0) {
      this.gustT += dt;
      const u = this.gustT / this.gustLen;
      if (u >= 1) {
        this.gustT = -1;
        v.gust = 0;
      } else {
        const b = Math.sin(u * Math.PI);
        v.gust = this.gustPeak * b * b;
      }
    } else {
      v.gust = 0;
      this.gustNext -= dt;
      if (this.gustNext <= 0) {
        this.gustT = 0;
        this.gustLen = this.rng.range(1.8, 3.2);
        this.gustPeak = stage === 3 ? this.rng.range(0.75, 1) : this.rng.range(0.25, 0.55);
        this.gustNext = GUST_EVERY[Math.min(stage, GUST_EVERY.length - 1)] * this.rng.range(0.7, 1.3);
      }
    }
  }

  // --- Entitäten ------------------------------------------------------------------------------------

  private scanEntities(sim: Sim): void {
    const px = sim.playerWorldX;
    const gy = sim.groundY;
    // Treffer durch Schneeball → Ball zerspringt
    for (const ev of sim.events) {
      if (this.seen.has(ev)) continue;
      this.seen.add(ev);
      if (ev.type === "hurt" && ev.tag === "snowball") {
        let best: Ent | null = null;
        for (const e of sim.ents) {
          if (e.dead || e.skin !== "snowball") continue;
          if (!best || Math.abs(e.x + e.w / 2 - px) < Math.abs(best.x + best.w / 2 - px)) best = e;
        }
        if (best && Math.abs(best.x + best.w / 2 - px) < 140) {
          this.burst(sim, best.x + best.w / 2, best.y + best.h / 2);
          best.dead = true;
        }
      } else if (ev.type === "enemy-defeat" && ev.skin === "snowball") {
        this.burst(sim, ev.x + sim.dist, ev.y);
      }
    }
    for (const e of sim.ents) {
      if (e.dead) continue;
      const sx = e.x - sim.dist;
      switch (e.skin) {
        case "gingerbread":
          if (e.state === "defeated" && !e.fx.stars) {
            e.fx.stars = 1;
            this.starBurst(sim, e);
          }
          break;
        case "snowball": {
          const rel = e.p.tRel ?? 0;
          if (e.age < rel) break;
          if (!e.fx.thrown) {
            e.fx.thrown = 1;
          }
          if (e.y + e.h / 2 > gy - 8) {
            this.burst(sim, e.x + e.w / 2, gy - 10);
            e.dead = true;
          }
          break;
        }
        case "elf": {
          const rel = e.p.tRel ?? 0;
          if (!e.fx.thrown && e.age >= rel && rel > 0) {
            e.fx.thrown = 1;
            if (sx < 1290 && sx > -100) sim.emit("custom", Math.min(1270, sx + e.w / 2), e.y, { tag: "sfx:paper-flutter" });
          }
          break;
        }
        case "icicle":
          if (e.state === "active" && !e.fx.hit) {
            e.fx.hit = 1;
            if (sx < 1300 && sx > -200) sim.emit("custom", Math.min(1270, Math.max(20, sx + e.w / 2)), e.y + e.h, { tag: "sfx:crumble" });
          }
          break;
        case "krampus":
          if (!e.fx.bell && e.kind === "walker" && sx < 1500) {
            e.fx.bell = 1;
            sim.emit("custom", 1250, e.y, { tag: "sfx:tram-bell" });
          }
          break;
        default:
          break;
      }
    }
  }

  private starBurst(sim: Sim, e: Ent): void {
    const gy = sim.groundY;
    const base = Math.max(e.x + e.w / 2, sim.playerWorldX + 60);
    const size = 34;
    for (let i = 0; i < 4; i += 1) {
      const u = i / 3;
      sim.spawn(
        {
          kind: "pickup",
          skin: "coin",
          pickup: "coin",
          x: 20 + u * 230,
          y: gy - 84 - Math.sin(u * Math.PI) * 96 - size / 2,
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

  /** Kurzlebige Deko: Schnee-Explosion an einer Weltposition (Mittelpunkt) */
  private burst(sim: Sim, cx: number, cy: number): void {
    if (this.bursts.length > 12) return;
    const e = sim.spawn({ kind: "decor", skin: "snow-burst", x: 0, y: cy - 34, w: 68, h: 68, harmful: false }, cx - 34);
    this.bursts.push(e);
  }

  private updateBursts(dt: number): void {
    void dt;
    for (let i = this.bursts.length - 1; i >= 0; i -= 1) {
      const e = this.bursts[i];
      if (e.dead || e.age > BURST_LIFE) {
        e.dead = true;
        this.bursts.splice(i, 1);
      }
    }
  }

  // --- Eis --------------------------------------------------------------------------------------------

  private updateIce(sim: Sim, dt: number): void {
    const px = sim.playerWorldX;
    let on = 0;
    if (sim.player.grounded) {
      for (const e of sim.ents) {
        if (e.dead || e.kind !== "speedzone" || e.skin !== "ice") continue;
        if (px > e.x && px < e.x + e.w) {
          on = 1;
          break;
        }
      }
    }
    if (on === 1 && !this.iceRaw) sim.emit("custom", 300, sim.feetY(), { tag: "sfx:slide" });
    this.iceRaw = on === 1;
    this.onIce += (on - this.onIce) * Math.min(1, dt * 10);
  }

  /** In der Stufe „Eistraum“ zusätzliche Eisrausch-Abschnitte an der Spawn-Kante. */
  private maybeIceRun(sim: Sim, dt: number, stage: number): void {
    this.iceCooldown -= dt;
    if (stage !== 2 || this.iceCooldown > 0) return;
    const sp = sim.spawner;
    if (sp.spawnWorld.id !== "winter") return;
    const origin = sp.cursor;
    if (origin >= sim.dist + SPAWN_AHEAD) return;
    if (sim.wantsGateway(origin)) return;
    const diff = sim.diffAt(origin);
    const speed = sim.speedAtDiff(diff) * (sim.world.speedScale ?? 1);
    const specs: EntSpec[] = [];
    const ctx = createPatternCtx({ speed, diff, groundY: sim.groundY, ceilY: sim.ceilY, rng: sim.rng, worldId: "winter", defaultSkin: (k) => k }, specs);
    const len = ICE_RUN.build(ctx);
    sim.curPattern = ICE_RUN.id;
    for (const sp2 of specs) sim.spawn(sp2, origin);
    sim.curPattern = "";
    sp.cursor = origin + Math.max(len, 60) + restSeconds(diff) * speed;
    this.iceCooldown = this.rng.range(7, 11);
  }

  // --- Krampus-Verfolgung -----------------------------------------------------------------------------

  private updateChase(sim: Sim, dt: number, stage: number, running: boolean): void {
    this.hit = Math.max(0, this.hit - dt * 1.6);
    this.grace = Math.max(0, this.grace - dt);
    const ref = this.refSpeed(sim);
    this.phaseT += dt;
    switch (this.phase) {
      case "idle": {
        this.presence = Math.max(0, this.presence - dt * 0.8);
        if (!running || sim.diff < CHASE_MIN_DIFF || stage < CHASE_MIN_STAGE) break;
        // erst ein paar Sekunden nach Betreten der Stufe
        if (this.stageT < 6) break;
        this.cooldown -= dt;
        if (this.cooldown <= 0) this.enter("warn", sim);
        break;
      }
      case "warn": {
        const u = Math.min(1, this.phaseT / WARN_TIME);
        this.presence = Math.max(this.presence, u);
        // Glockenschläge: drei Schläge, dazwischen je ≈ 0.9 s
        const due = Math.min(3, Math.floor((this.phaseT - 0.2) / 0.9) + 1);
        while (this.bellsDone < due) {
          this.bellsDone += 1;
          sim.emit("custom", 90, sim.groundY - 260, { tag: "sfx:tram-bell" });
        }
        this.gapT = START_GAP + (CHASE_TARGET + 0.08 - START_GAP) * u * u;
        if (this.phaseT >= WARN_TIME) this.enter("chase", sim);
        break;
      }
      case "chase": {
        this.presence = 1;
        const d = Math.max(-1, Math.min(1, (this.gapT - CHASE_TARGET) / 0.35));
        let k = 1 + (d > 0 ? 0.16 : 0.05) * d - 0.012;
        if (this.gapT < 0.12) k = Math.max(k, 1);
        if (this.grace > 0) k = Math.min(k, 0.86);
        const aSpeed = ref * k;
        this.gapT += ((sim.speed - aSpeed) * dt) / ref;
        this.gapT = Math.min(this.gapT, 1.6);
        if (this.gapT <= 0.02 && running) {
          const p = sim.player;
          if (p.invuln > 0 || p.dashT > 0 || p.turbo > 0) {
            this.gapT = 0.02;
          } else {
            sim.hurt("krampus");
            this.hit = 1;
            this.gapT = RESET_GAP;
            this.grace = 2.5;
            sim.emit("custom", 110, sim.groundY - 200, { tag: "sfx:tram-bell" });
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
  }

  private enter(p: Phase, sim: Sim): void {
    this.phase = p;
    this.phaseT = 0;
    if (p === "warn") {
      this.gapT = START_GAP;
      this.bellsDone = 0;
    } else if (p === "chase") {
      this.count += 1;
      const extra = Math.min(8, Math.max(0, sim.diff - CHASE_MIN_DIFF) * 1.2);
      this.chaseLen = (this.count === 1 ? 10 : 14) + this.rng.range(0, 6) + extra;
    } else if (p === "idle") {
      this.cooldown = this.rng.range(10, 17) - Math.min(4, sim.diff * 0.3);
      this.gapT = START_GAP;
    }
  }

  onHurt(sim: Sim, source: string): void {
    if (source === "krampus") return;
    if (this.phase === "chase" || this.phase === "warn") {
      this.gapT = Math.max(0.05, this.gapT - HURT_PENALTY);
      sim.vars.krampusSurge = 1;
    }
  }

  private publish(sim: Sim): void {
    const v = sim.vars;
    const ref = this.refSpeed(sim);
    const active = this.phase !== "idle" || this.presence > 0.001;
    v.krampus = this.presence;
    v.krampusT = active ? this.gapT : 9;
    v.krampusGap = active ? this.gapT * ref : 99999;
    v.krampusHit = this.hit;
    let warn = 0;
    if (this.phase === "warn") warn = 0.35 + 0.35 * Math.min(1, this.phaseT / WARN_TIME);
    else if (this.phase === "chase") warn = Math.max(0.15, Math.min(1, (CHASE_TARGET - this.gapT) / 0.42 + 0.3));
    else if (this.phase === "retreat") warn = 0.15 * this.presence;
    v.chaseWarn = warn;
    v.krampusSurge = Math.max(0, (v.krampusSurge ?? 0) - 0.02);
    // tiefes Grollen, je näher der Krampus ist
    const close = Math.max(0, Math.min(1, 1 - (this.gapT - 0.15) / 0.9));
    v["loop:avalanche"] = this.presence * (0.3 + 0.6 * close);
    v.onIce = this.onIce;
    v.pSlide = sim.player.sliding ? 1 : 0;
  }

  /** Test-/Debug-Zugriff */
  get state(): { phase: Phase; gapT: number; presence: number; stageT: number } {
    return { phase: this.phase, gapT: this.gapT, presence: this.presence, stageT: this.stageT };
  }
}
