import { CHARACTERS, type CharacterPerks } from "./characters";
import {
  APEX_BAND,
  APEX_GRAVITY_SCALE,
  COMBO_MAX,
  COMBO_WINDOW,
  COYOTE_TIME,
  CULL_BEHIND,
  DASH_COOLDOWN,
  DASH_GRACE,
  DASH_SPEED_MULT,
  DASH_TIME,
  DEFAULT_CEIL_Y,
  DEFAULT_GROUND_Y,
  DIFFICULTY_SPEED_SCALE,
  DOUBLE_JUMP_V,
  ENERGY_MAX,
  GRAVITY,
  HURT_INVULN,
  HURT_SPEED_LOSS,
  HURT_STUN,
  JUMP_BUFFER,
  JUMP_CUT,
  JUMP_V,
  MAGNET_RADIUS,
  MAGNET_TIME,
  MAX_FALL,
  MAX_HEARTS,
  METERS_PER_DIFFICULTY,
  NEAR_MISS_CLEARANCE,
  PLAYER_H,
  PLAYER_SX,
  PLAYER_W,
  PX_PER_METER,
  SCORE_COIN,
  SCORE_DASH_KILL,
  SCORE_GEM,
  SCORE_NEAR_MISS,
  SCORE_STOMP,
  SHIELD_TIME,
  SLIDE_H,
  SLIDE_MAX_TIME,
  SLIDE_MIN_TIME,
  SLIDE_W,
  SLOWMO_FACTOR,
  SLOWMO_TIME,
  SPEED_BASE,
  SPEED_MAX,
  SPRING_V,
  START_HEARTS,
  STOMP_BOUNCE_V,
  STOMP_V,
  TURBO_SPEED_MULT,
  TURBO_TIME,
  VIEW_W,
} from "./constants";
import { defaultHitbox } from "./patterns";
import { Rng, dailySeed } from "./rng";
import { Spawner, type GateInfo } from "./spawner";
import type {
  Ent,
  EntSpec,
  PickupType,
  RunConfig,
  SimEvent,
  SimEventType,
  ViewState,
  WorldDef,
  WorldId,
  WorldSystem,
} from "./types";

export type SimPhase = "ready" | "running" | "dying" | "over";

export interface SimInput {
  /** Sprungtaste gehalten */
  jump: boolean;
  /** Flanke: gerade gedrückt */
  jumpPressed: boolean;
  /** Rutschen/Stampfen gehalten */
  slide: boolean;
  slidePressed: boolean;
  dashPressed: boolean;
}

export const NO_INPUT: SimInput = { jump: false, jumpPressed: false, slide: false, slidePressed: false, dashPressed: false };

export interface PlayerState {
  /** Höhe über der Lauffläche (Boden bzw. Decke), ≥ 0 auf festem Grund, < 0 in Lücken */
  hgt: number;
  /** vertikale Geschwindigkeit in Höhenrichtung (+ = weg von der Lauffläche) */
  vy: number;
  grounded: boolean;
  onPlatform: Ent | null;
  gravDir: 1 | -1;
  jumpsUsed: number;
  coyote: number;
  jumpBuf: number;
  sliding: boolean;
  slideT: number;
  dashT: number;
  dashCd: number;
  stomping: boolean;
  stompChain: number;
  gliding: boolean;
  glideUsed: number;
  invuln: number;
  stun: number;
  hearts: number;
  energy: number;
  shield: number;
  magnet: number;
  slowmo: number;
  turbo: number;
  animT: number;
  /** Zeit seit dem letzten Bodenkontakt (Sek.) für Animationsauswahl */
  airT: number;
}

export interface RunStats {
  coins: number;
  gems: number;
  stomps: number;
  nearMisses: number;
  dashes: number;
  kills: number;
  maxCombo: number;
  hurts: number;
  worldsVisited: WorldId[];
}

export const TOUR_ORDER: WorldId[] = ["wien", "alpen", "finanzamt", "prater", "wachau", "cyber"];
export const TOUR_METERS = 1300;

/** Welt des heutigen Tageslaufs (für alle Spieler gleich). */
export function dailyWorld(date = new Date()): WorldId {
  return TOUR_ORDER[dailySeed(date) % TOUR_ORDER.length];
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function overlap(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

function smooth(u: number): number {
  const c = Math.min(1, Math.max(0, u));
  return c * c * (3 - 2 * c);
}

export class Sim {
  readonly cfg: RunConfig;
  readonly registry: Record<WorldId, WorldDef>;
  readonly rng: Rng;
  readonly perks: CharacterPerks;

  world: WorldDef;
  phase: SimPhase = "ready";
  time = 0;
  dist: number;
  speed = SPEED_BASE;
  ents: Ent[] = [];
  player: PlayerState;
  events: SimEvent[] = [];
  vars: Record<string, number> = {};
  flash = 0;
  /** Multiplikator auf das Tempo, das Systeme setzen dürfen (z.B. 0.8 Schlamm) */
  speedMult = 1;
  systems: WorldSystem[] = [];
  spawner: Spawner;
  stats: RunStats;
  deathCause = "";
  deathT = 0;

  // Score
  bonus = 0;
  combo = 1;
  comboT = 0;
  coinStreak = 0;
  coinStreakT = 0;
  /** Bonus-Schwierigkeit (Tour-Durchläufe) */
  diffBonus = 0;
  private nextId = 1;
  /** Muster-ID für neu gespawnte Entitäten (Diagnose) */
  curPattern = "";
  /** Bot-Vorausschau: nichts nachspawnen, keine Weltsysteme */
  noSpawn = false;
  private speedZone = 1;
  private hurtSlow = 1;
  private lastMilestone = 0;
  private lastStage = 0;
  private worldStartDist = 0;
  private spawnWorldStartX = 0;
  /** Zukünftige Tore (Tour) */
  gates: GateInfo[] = [];
  /** Zuletzt überschrittenes Tor (für Zuordnung Welt ↔ Entität) */
  lastGate: GateInfo | null = null;
  tourLoops = 0;
  private tourIndex = 0;
  private startDist: number;

  constructor(cfg: RunConfig, registry: Record<WorldId, WorldDef>) {
    this.cfg = cfg;
    this.registry = registry;
    this.rng = new Rng(cfg.seed);
    this.perks = CHARACTERS[cfg.character].perks;
    this.tourIndex = cfg.mode === "tour" ? Math.max(0, TOUR_ORDER.indexOf(cfg.world)) : 0;
    this.world = registry[cfg.mode === "tour" ? TOUR_ORDER[this.tourIndex] : cfg.world];
    this.startDist = (cfg.startMeters ?? 0) * PX_PER_METER;
    this.dist = this.startDist;
    this.worldStartDist = this.startDist;
    this.spawnWorldStartX = this.startDist;
    this.player = this.freshPlayer();
    this.stats = { coins: 0, gems: 0, stomps: 0, nearMisses: 0, dashes: 0, kills: 0, maxCombo: 1, hurts: 0, worldsVisited: [this.world.id] };
    this.spawner = new Spawner(this, this.world, this.dist + PLAYER_SX + 1250);
    this.systems = this.world.createSystems?.() ?? [];
    for (const s of this.systems) s.reset?.(this);
    this.speed = SPEED_BASE * (this.world.speedScale ?? 1);
    this.spawner.fill();
    this.lastStage = 0;
  }

  private freshPlayer(): PlayerState {
    return {
      hgt: 0,
      vy: 0,
      grounded: true,
      onPlatform: null,
      gravDir: 1,
      jumpsUsed: 0,
      coyote: 0,
      jumpBuf: 0,
      sliding: false,
      slideT: 0,
      dashT: 0,
      dashCd: 0,
      stomping: false,
      stompChain: 0,
      gliding: false,
      glideUsed: 0,
      invuln: 0,
      stun: 0,
      hearts: START_HEARTS,
      energy: 40,
      shield: 0,
      magnet: 0,
      slowmo: 0,
      turbo: 0,
      animT: 0,
      airT: 0,
    };
  }

  // --- öffentliche Hilfen für Spawner / Welten / Renderer ------------------------------------

  groundYOf(w: WorldDef): number {
    return w.groundY ?? DEFAULT_GROUND_Y;
  }
  ceilYOf(w: WorldDef): number {
    return w.ceilY ?? DEFAULT_CEIL_Y;
  }
  get groundY(): number {
    return this.groundYOf(this.world);
  }
  get ceilY(): number {
    return this.ceilYOf(this.world);
  }
  get playerWorldX(): number {
    return this.dist + PLAYER_SX;
  }
  get meters(): number {
    return Math.max(0, this.dist / PX_PER_METER);
  }
  get score(): number {
    return Math.floor(this.meters + this.bonus);
  }
  get worldMeters(): number {
    return Math.max(0, (this.dist - this.worldStartDist) / PX_PER_METER);
  }
  get diff(): number {
    return this.diffAt(this.dist);
  }
  diffAt(x: number): number {
    return Math.max(0, x / PX_PER_METER) / METERS_PER_DIFFICULTY + this.diffBonus;
  }
  speedAtDiff(d: number): number {
    return SPEED_BASE + (SPEED_MAX - SPEED_BASE) * (1 - Math.exp(-d / DIFFICULTY_SPEED_SCALE));
  }
  /** Welt, zu der eine Weltkoordinate gehört (relevant im Tor-Übergang der Tour). */
  worldAtX(x: number): WorldDef {
    const up = this.gates[0];
    if (up && x >= up.x) return this.registry[up.to];
    if (this.lastGate && x < this.lastGate.x) return this.registry[this.lastGate.from];
    return this.world;
  }
  /** 0…1 Überblendung zur nächsten Welt beim Durchqueren eines Tores. */
  get gateBlend(): number {
    const g = this.gates[0];
    if (g) return smooth((this.playerWorldX - (g.x - 420)) / 840);
    return 0;
  }
  get nextGate(): GateInfo | null {
    return this.gates[0] ?? null;
  }

  wantsGateway(cursorX: number): boolean {
    if (this.cfg.mode !== "tour") return false;
    return (cursorX - this.spawnWorldStartX) / PX_PER_METER >= TOUR_METERS;
  }
  nextTourWorld(): WorldDef {
    const idx = TOUR_ORDER.indexOf(this.spawner.spawnWorld.id);
    return this.registry[TOUR_ORDER[(idx + 1) % TOUR_ORDER.length]];
  }
  registerGate(g: GateInfo): void {
    this.gates.push(g);
    this.spawnWorldStartX = g.x;
  }

  emit(type: SimEventType, x?: number, y?: number, extra?: Partial<SimEvent>): void {
    if (this.events.length > 96) return;
    const px = x ?? PLAYER_SX;
    this.events.push({ type, x: px, y: y ?? this.feetY(), ...extra });
  }

  spawn(spec: EntSpec, originX: number): Ent {
    const hb = spec.hb ?? defaultHitbox(spec.kind, spec.w, spec.h);
    const e: Ent = {
      id: this.nextId++,
      kind: spec.kind,
      skin: spec.skin,
      x: originX + spec.x,
      y: spec.y,
      w: spec.w,
      h: spec.h,
      vx: spec.vx ?? 0,
      vy: spec.vy ?? 0,
      hb,
      harmful: spec.harmful ?? false,
      stompable: spec.stompable ?? false,
      breakable: spec.breakable ?? false,
      ceil: spec.ceil ?? false,
      warn: spec.warn ?? false,
      dead: false,
      age: 0,
      state: spec.state ?? "idle",
      stateT: 0,
      cycle: spec.cycle ? { ...spec.cycle, phases: spec.cycle.phases.map((p) => ({ ...p })) } : undefined,
      pickup: spec.pickup,
      p: { ...(spec.p ?? {}) },
      minClear: 9999,
      passed: false,
      fx: {},
      pat: this.curPattern,
    };
    // Weltkoordinaten für bewegliche Elemente
    if (e.kind === "platform") {
      e.p.bx = e.x;
      e.p.by = e.y;
    } else if (e.kind === "swinger") {
      e.p.ax = originX + (spec.p?.ax ?? spec.x);
    } else if (e.kind === "flyer") {
      e.p.baseY = e.p.baseY ?? e.y;
    }
    if (e.kind === "walker" && e.p.hopEvery) e.p.hopT = e.p.hopEvery * (0.5 + this.rng.next());
    this.ents.push(e);
    return e;
  }

  /** Tiefe Kopie für Vorausschau (Bot): ohne Spawner, Systeme und Event-Historie. */
  clone(): Sim {
    const c = Object.create(Sim.prototype) as Sim;
    Object.assign(c, this);
    c.ents = this.ents.map((e) => ({ ...e, p: { ...e.p }, fx: { ...e.fx }, hb: [...e.hb] as Ent["hb"], cycle: e.cycle ? { ...e.cycle, phases: e.cycle.phases.map((ph) => ({ ...ph })) } : undefined }));
    const idMap = new Map<number, Ent>();
    for (const e of c.ents) idMap.set(e.id, e);
    c.player = { ...this.player, onPlatform: this.player.onPlatform ? idMap.get(this.player.onPlatform.id) ?? null : null };
    c.events = [];
    c.vars = { ...this.vars };
    c.systems = [];
    c.noSpawn = true;
    c.stats = { ...this.stats, worldsVisited: [...this.stats.worldsVisited] };
    c.gates = [...this.gates];
    (c as unknown as { rng: Rng }).rng = new Rng(this.rng.state);
    return c;
  }

  // --- Spielfigur-Geometrie ------------------------------------------------------------------

  feetY(): number {
    const p = this.player;
    return p.gravDir === 1 ? this.groundY - p.hgt : this.ceilY + p.hgt;
  }

  private playerBox(shrink = 0): Box {
    const p = this.player;
    const cx = this.playerWorldX;
    const w = p.sliding ? SLIDE_W : PLAYER_W;
    const h = p.sliding ? SLIDE_H : PLAYER_H;
    const feet = this.feetY();
    const top = p.gravDir === 1 ? feet - h : feet;
    return { x0: cx - w / 2 + shrink, x1: cx + w / 2 - shrink, y0: top + shrink, y1: top + h - shrink };
  }

  private entBox(e: Ent): Box {
    return { x0: e.x + e.hb[0], y0: e.y + e.hb[1], x1: e.x + e.hb[0] + e.hb[2], y1: e.y + e.hb[1] + e.hb[3] };
  }

  private canStand(): boolean {
    const p = this.player;
    const cx = this.playerWorldX;
    const feet = this.feetY();
    const top = p.gravDir === 1 ? feet - PLAYER_H : feet;
    const box: Box = { x0: cx - PLAYER_W / 2, x1: cx + PLAYER_W / 2, y0: top, y1: top + PLAYER_H };
    for (const e of this.ents) {
      if (e.kind !== "overhead" || e.dead) continue;
      if (e.x > cx + 200 || e.x + e.w < cx - 200) continue;
      if (overlap(box, this.entBox(e))) return false;
    }
    return true;
  }

  // --- Spiellogik ------------------------------------------------------------------------------

  begin(): void {
    if (this.phase !== "ready") return;
    this.phase = "running";
    this.emit("start");
  }

  private targetSpeed(): number {
    const p = this.player;
    let s = this.speedAtDiff(this.diff) * (this.world.speedScale ?? 1);
    if (p.turbo > 0) s *= TURBO_SPEED_MULT;
    if (p.dashT > 0) s *= DASH_SPEED_MULT;
    s *= this.hurtSlow * this.speedZone * this.speedMult;
    return s;
  }

  step(dt: number, input: SimInput): void {
    if (this.phase === "ready" || this.phase === "over") return;
    const p = this.player;
    const dying = this.phase === "dying";
    const timeScale = p.slowmo > 0 && !dying ? SLOWMO_FACTOR : 1;
    const dtw = dt * timeScale;
    this.time += dt;
    this.flash = Math.max(0, this.flash - dt * 2.4);

    if (dying) {
      this.deathT += dt;
      this.speed = Math.max(0, this.speed - this.speed * Math.min(1, dt * 3.2));
      this.dist += this.speed * dt;
      p.animT += dt;
      this.stepPlayerPhysics(dt, NO_INPUT, true);
      this.updateEntities(dt);
      if (this.deathT > 1.25) this.phase = "over";
      return;
    }

    // Timer
    p.animT += dtw;
    p.invuln = Math.max(0, p.invuln - dtw);
    p.stun = Math.max(0, p.stun - dtw);
    p.dashCd = Math.max(0, p.dashCd - dtw);
    p.magnet = Math.max(0, p.magnet - dt);
    p.shield = Math.max(0, p.shield - dt);
    p.slowmo = Math.max(0, p.slowmo - dt);
    p.turbo = Math.max(0, p.turbo - dt);
    this.comboT = Math.max(0, this.comboT - dtw);
    if (this.combo > 1 && this.comboT <= 0) {
      this.combo = 1;
      this.emit("combo-break");
    }
    this.coinStreakT = Math.max(0, this.coinStreakT - dtw);
    if (this.coinStreakT <= 0) this.coinStreak = 0;
    this.hurtSlow += (1 - this.hurtSlow) * Math.min(1, dtw * 1.6);
    p.energy = Math.min(ENERGY_MAX, p.energy + 1.6 * this.perks.energyGain * dtw);

    if (p.dashT > 0) {
      p.dashT -= dtw;
      if (p.dashT <= 0) {
        p.dashT = 0;
        p.invuln = Math.max(p.invuln, DASH_GRACE);
        this.emit("dash-end");
      }
    }
    if (p.turbo > 0 && p.turbo - dt <= 0) p.invuln = Math.max(p.invuln, DASH_GRACE);

    // Tempo
    const tgt = this.targetSpeed();
    const rate = p.dashT > 0 || p.turbo > 0 ? 14 : 5;
    this.speed += (tgt - this.speed) * Math.min(1, rate * dtw);
    this.dist += this.speed * dtw;

    // Eingabe → Aktionen
    this.handleInput(dtw, input);
    this.stepPlayerPhysics(dtw, input, false);
    this.updateEntities(dtw);
    this.collide(dtw);
    for (const s of this.systems) s.update(this, dtw);
    this.checkGates();
    if (!this.noSpawn) this.spawner.fill();
    this.cull();
    this.bookkeeping();
  }

  private handleInput(dt: number, input: SimInput): void {
    const p = this.player;
    if (input.jumpPressed) p.jumpBuf = JUMP_BUFFER;
    else p.jumpBuf = Math.max(0, p.jumpBuf - dt);

    if (p.stun > 0.25) {
      // kurz benommen: keine neuen Aktionen (Jump-Buffer bleibt erhalten)
      return;
    }

    // Dash
    if (input.dashPressed && p.dashT <= 0 && p.dashCd <= 0 && p.energy >= this.perks.dashCost && !p.stomping) {
      p.energy -= this.perks.dashCost;
      p.dashT = DASH_TIME * this.perks.dashTimeScale;
      p.dashCd = DASH_COOLDOWN + p.dashT;
      p.sliding = false;
      this.stats.dashes += 1;
      this.emit("dash");
    }

    // Slide / Stomp
    if (input.slidePressed) {
      if (p.grounded && !p.sliding && p.dashT <= 0) {
        p.sliding = true;
        p.slideT = 0;
        this.emit("slide");
      } else if (!p.grounded && !p.stomping && p.dashT <= 0 && p.turbo <= 0) {
        p.stomping = true;
        p.vy = -STOMP_V;
        p.gliding = false;
        this.emit("stomp-start");
      }
    }
    if (p.sliding) {
      p.slideT += dt;
      const wantsSlide = input.slide || p.slideT < SLIDE_MIN_TIME;
      if (!p.grounded) {
        this.endSlide();
      } else if ((!wantsSlide || p.slideT > SLIDE_MAX_TIME) && this.canStand()) {
        this.endSlide();
      }
    }

    // Jump
    if (p.jumpBuf > 0 && p.dashT <= 0) {
      if (p.sliding && !this.canStand()) {
        // unter Hindernis: Sprung nicht möglich
      } else if (p.grounded || (p.coyote > 0 && p.jumpsUsed === 0)) {
        this.startJump(JUMP_V, "jump");
        p.jumpBuf = 0;
      } else if (p.jumpsUsed < 2 && input.jumpPressed) {
        this.startJump(DOUBLE_JUMP_V, "doublejump");
        p.jumpBuf = 0;
      }
    }
    // Sprung abbrechen (variable Höhe)
    if (!input.jump && p.vy > 0 && p.jumpsUsed > 0 && !p.stomping && p.dashT <= 0 && p.vy < JUMP_V * 0.98) {
      p.vy *= 1 - (1 - JUMP_CUT) * Math.min(1, dt * 22);
    }
  }

  private endSlide(): void {
    if (this.player.sliding) {
      this.player.sliding = false;
      this.emit("slide-end");
    }
  }

  private startJump(v: number, ev: "jump" | "doublejump"): void {
    const p = this.player;
    p.vy = v;
    p.grounded = false;
    p.onPlatform = null;
    p.coyote = 0;
    p.stomping = false;
    p.sliding = false;
    p.jumpsUsed = ev === "jump" ? 1 : 2;
    p.gliding = false;
    this.emit(ev);
  }

  private stepPlayerPhysics(dt: number, input: SimInput, dying: boolean): void {
    const p = this.player;
    const px = this.playerWorldX;

    // Plattform-Halt prüfen
    if (p.onPlatform) {
      const e = p.onPlatform;
      if (e.dead || e.state === "fallen" || px < e.x + 4 || px > e.x + e.w - 4) {
        p.onPlatform = null;
        p.grounded = false;
        p.coyote = COYOTE_TIME;
      } else {
        p.hgt = this.groundY - e.y;
        p.vy = 0;
      }
    }

    const overPit = p.gravDir === 1 && this.pitAt(px);
    const supported = !!p.onPlatform || (!overPit && p.hgt <= 0.0001);

    if (!p.onPlatform) {
      // Gravitation
      let g = GRAVITY;
      if (p.turbo > 0 && !dying) {
        // Raketenflug: sanft auf Flughöhe steuern
        const target = 150;
        p.vy += (target - p.hgt) * 9 * dt - p.vy * 4 * dt;
        g = 0;
      } else if (p.dashT > 0) {
        g = GRAVITY * (1 - this.perks.dashHover);
        p.vy *= 1 - Math.min(1, dt * 10) * this.perks.dashHover;
      } else if (p.vy > 0 && p.vy < APEX_BAND && input.jump && p.jumpsUsed > 0) {
        g = GRAVITY * APEX_GRAVITY_SCALE;
      } else if (p.vy < 0 && p.vy > -APEX_BAND && input.jump && p.jumpsUsed > 0) {
        g = GRAVITY * APEX_GRAVITY_SCALE;
      }
      // Gleiten (Superfred)
      p.gliding = false;
      if (
        this.perks.glideTime > 0 &&
        !dying &&
        !p.grounded &&
        p.vy < 0 &&
        input.jump &&
        !p.stomping &&
        p.dashT <= 0 &&
        p.glideUsed < this.perks.glideTime &&
        p.jumpsUsed >= 1
      ) {
        p.gliding = true;
        p.glideUsed += dt;
        if (p.vy < -210) p.vy += (-210 - p.vy) * Math.min(1, dt * 14);
        g = GRAVITY * 0.25;
      }
      p.vy -= g * dt;
      if (p.vy < -MAX_FALL && !p.stomping) p.vy = -MAX_FALL;
      if (p.stomping && p.vy < -STOMP_V) p.vy = -STOMP_V;
      const prevHgt = p.hgt;
      p.hgt += p.vy * dt;

      // Plattform-Landung
      if (p.gravDir === 1 && p.vy <= 0 && !dying) {
        for (const e of this.ents) {
          if (e.kind !== "platform" || e.dead || e.state === "fallen") continue;
          if (px < e.x + 6 || px > e.x + e.w - 6) continue;
          const top = this.groundY - e.y;
          if (prevHgt >= top - 10 && p.hgt <= top) {
            p.hgt = top;
            this.land(e);
            break;
          }
        }
      }

      if (!p.onPlatform) {
        if (p.hgt <= 0 && !overPit && p.vy <= 0) {
          p.hgt = 0;
          this.land(null);
        } else if (p.hgt <= 0 && overPit) {
          // in der Lücke: kein Halt mehr – fällt weiter (Coyote-Time erlaubt noch kurz einen Sprung)
          p.grounded = false;
          if (p.hgt < -170 && !dying) this.pitFall();
        }
      }
      if (!p.grounded) {
        p.airT += dt;
      }
    } else {
      p.grounded = true;
    }

    // Coyote / Luftstatus
    if (p.grounded) {
      p.coyote = COYOTE_TIME;
      p.airT = 0;
    } else {
      p.coyote = Math.max(0, p.coyote - dt);
      if (p.coyote <= 0 && p.jumpsUsed === 0) p.jumpsUsed = 1;
    }
    void supported;
  }

  private land(plat: Ent | null): void {
    const p = this.player;
    const wasAir = !p.grounded;
    const impact = -p.vy;
    p.vy = 0;
    p.grounded = true;
    p.onPlatform = plat;
    p.jumpsUsed = 0;
    p.glideUsed = 0;
    p.gliding = false;
    p.airT = 0;
    p.coyote = COYOTE_TIME;
    if (plat && plat.p.crumble > 0 && plat.state === "idle") {
      plat.state = "crumbling";
      plat.stateT = 0;
    }
    if (p.stomping) {
      p.stomping = false;
      this.stompShockwave();
      this.emit("stomp-land", undefined, undefined, { value: p.stompChain });
    } else if (wasAir && impact > 260) {
      this.emit("land", undefined, undefined, { value: impact });
    }
    p.stompChain = 0;
    if (p.jumpBuf > 0 && p.stun <= 0.25) {
      this.startJump(JUMP_V, "jump");
      p.jumpBuf = 0;
    }
  }

  private stompShockwave(): void {
    const px = this.playerWorldX;
    const r = this.perks.stompRadius;
    for (const e of this.ents) {
      if (e.dead) continue;
      const cx = e.x + e.w / 2;
      if (Math.abs(cx - px) > r + e.w / 2) continue;
      if (e.kind === "walker" && e.stompable) this.defeat(e, "stomp");
      else if (e.breakable && e.harmful) this.breakEnt(e);
    }
    this.vars.shockwave = 1;
  }

  private pitAt(worldX: number): boolean {
    for (const e of this.ents) {
      if (e.kind !== "pit" || e.dead) continue;
      if (worldX > e.x + 10 && worldX < e.x + e.w - 10) return true;
    }
    return false;
  }

  private pitFall(): void {
    const p = this.player;
    const px = this.playerWorldX;
    let end = px + 80;
    for (const e of this.ents) {
      if (e.kind === "pit" && px >= e.x && px <= e.x + e.w) end = Math.max(end, e.x + e.w + 70);
    }
    this.emit("pit-fall");
    // Rettung: Figur taucht hinter der Lücke auf
    this.dist = end - PLAYER_SX;
    p.hgt = 0;
    p.vy = 0;
    p.grounded = true;
    p.onPlatform = null;
    p.jumpsUsed = 0;
    p.stomping = false;
    this.applyHurt("pit", true);
  }

  // --- Entitäten -------------------------------------------------------------------------------

  private updateEntities(dt: number): void {
    const p = this.player;
    const px = this.playerWorldX;
    const magnetR = Math.max(p.magnet > 0 ? MAGNET_RADIUS : 0, this.perks.passiveMagnet, p.turbo > 0 ? 420 : 0);
    const groundY = this.groundY;
    for (const e of this.ents) {
      if (e.dead) continue;
      e.age += dt;
      e.stateT += dt;
      switch (e.kind) {
        case "walker": {
          e.x += e.vx * dt;
          if (e.state === "defeated") {
            e.y += e.vy * dt;
            e.vy += 1800 * dt;
            break;
          }
          if (e.p.hopEvery) {
            e.p.hopT -= dt;
            const onGround = e.y + e.h >= groundY - 0.5;
            if (e.p.hopT <= 0 && onGround) {
              e.vy = -(e.p.hopV || 820);
              e.p.hopT = e.p.hopEvery;
            }
            if (!onGround || e.vy < 0) {
              e.vy += GRAVITY * 0.9 * dt;
              e.y += e.vy * dt;
              if (e.y + e.h >= groundY) {
                e.y = groundY - e.h;
                e.vy = 0;
              }
            }
          }
          break;
        }
        case "projectile": {
          e.x += e.vx * dt;
          if (e.p.gravity) {
            e.vy += e.p.gravity * dt;
            e.y += e.vy * dt;
          }
          if (e.state === "defeated") e.dead = true;
          break;
        }
        case "flyer": {
          if (e.state === "defeated") {
            e.x += e.vx * dt;
            e.y += e.vy * dt;
            e.vy += 1900 * dt;
            break;
          }
          e.x += e.vx * dt;
          const per = e.p.per || 1.8;
          if (e.p.track) {
            const feet = this.feetY();
            const target = feet - PLAYER_H * 0.5 - e.h / 2;
            if (e.x - px < 620 && e.x - px > 60) e.p.baseY += (target - e.p.baseY) * Math.min(1, e.p.track * dt);
          }
          e.y = e.p.baseY + (e.p.amp || 0) * Math.sin((e.age * Math.PI * 2) / per + (e.p.ph || 0));
          break;
        }
        case "platform": {
          const per = e.p.per || 3;
          if (e.vx) {
            e.p.bx += e.vx * dt;
            if (!e.p.ampX) e.x = e.p.bx;
          }
          const s = Math.sin((e.age * Math.PI * 2) / per + (e.p.ph || 0));
          if (e.p.ampX) e.x = e.p.bx + e.p.ampX * s;
          if (e.p.ampY) e.y = e.p.by + e.p.ampY * s;
          if (e.state === "crumbling" && e.stateT >= e.p.crumble) {
            e.state = "fallen";
            e.stateT = 0;
            e.vy = 0;
            this.emit("custom", e.x - this.dist + e.w / 2, e.y, { tag: "crumble", skin: e.skin });
          }
          if (e.state === "fallen") {
            e.vy += 1600 * dt;
            e.y += e.vy * dt;
            if (e.y > 900) e.dead = true;
          }
          break;
        }
        case "swinger": {
          const per = e.p.per || 2.6;
          const ang = (e.p.amp || 0.9) * Math.sin((e.age * Math.PI * 2) / per + (e.p.ph || 0));
          const bx = e.p.ax + Math.sin(ang) * e.p.len;
          const by = e.p.ay + Math.cos(ang) * e.p.len;
          const r = e.p.r || e.w / 2;
          e.x = bx - r;
          e.y = by - r;
          e.fx.angle = ang;
          break;
        }
        case "zone": {
          if (e.vx) e.x += e.vx * dt;
          const c = e.cycle;
          if (!c) break;
          let total = 0;
          for (const ph of c.phases) total += ph.dur;
          let t = e.age + c.offset;
          if (!c.loop && t >= total) {
            e.dead = true;
            break;
          }
          t = total > 0 ? t % total : 0;
          let name: string = "idle";
          let acc = 0;
          for (const ph of c.phases) {
            if (t < acc + ph.dur) {
              name = ph.name;
              e.fx.phaseT = (t - acc) / Math.max(0.0001, ph.dur);
              break;
            }
            acc += ph.dur;
          }
          if (name !== e.state) {
            e.state = name;
            e.stateT = 0;
            if (name === "warn") this.emit("custom", e.x - this.dist + e.w / 2, e.y, { tag: `zone-warn:${e.skin}`, skin: e.skin });
            if (name === "active") this.emit("custom", e.x - this.dist + e.w / 2, e.y, { tag: `zone-active:${e.skin}`, skin: e.skin });
          }
          e.harmful = name === "active";
          break;
        }
        case "pickup": {
          if (magnetR > 0 && (e.pickup === "coin" || e.pickup === "gem")) {
            const cx = e.x + e.w / 2;
            const cy = e.y + e.h / 2;
            const feet = this.feetY();
            const py = feet - (p.gravDir === 1 ? PLAYER_H : -PLAYER_H) / 2;
            const dx = px - cx;
            const dy = py - cy;
            const d = Math.hypot(dx, dy);
            if (d < magnetR && d > 1) {
              const pull = (1 - d / magnetR) * 1500 + 500;
              e.x += (dx / d) * pull * dt;
              e.y += (dy / d) * pull * dt;
              e.fx.pulled = 1;
            }
          }
          break;
        }
        case "block":
        case "overhead":
        case "spring":
        case "decor":
        case "wind":
        case "speedzone": {
          if (e.vx) e.x += e.vx * dt;
          break;
        }
        default:
          break;
      }
    }
  }

  private collide(dt: number): void {
    const p = this.player;
    const px = this.playerWorldX;
    const box = this.playerBox(5);
    const feet = this.feetY();
    const invulnerable = p.invuln > 0 || p.dashT > 0 || p.turbo > 0;
    const dashSmash = p.dashT > 0 || p.turbo > 0;
    let speedZone = 1;
    let wind = 0;

    for (const e of this.ents) {
      if (e.dead) continue;
      if (e.x > px + 260 || e.x + e.w < px - 260) {
        if (e.kind !== "decor") {
          // Nur Nähe-Prüfung für passierte Entitäten (Near-Miss-Bilanz)
          if (!e.passed && e.harmful && e.x + e.hb[0] + e.hb[2] < px - PLAYER_W) this.passEnt(e);
          continue;
        }
        continue;
      }
      switch (e.kind) {
        case "block":
        case "overhead":
        case "projectile":
        case "swinger":
        case "walker":
        case "flyer":
        case "zone": {
          if (!e.harmful) break;
          if (e.state === "defeated") break;
          const eb = this.entBox(e);
          if (!e.passed && eb.x1 < box.x0) {
            this.passEnt(e);
            break;
          }
          // Near-Miss-Tracking
          if (eb.x0 < box.x1 + 30 && eb.x1 > box.x0 - 30) {
            const gx = Math.max(0, Math.max(eb.x0 - box.x1, box.x0 - eb.x1));
            const gy = Math.max(0, Math.max(eb.y0 - box.y1, box.y0 - eb.y1));
            const clear = Math.hypot(gx, gy);
            if (clear < e.minClear) e.minClear = clear;
          }
          if (!overlap(box, eb)) break;
          // Stampfen auf Gegner
          if ((e.kind === "walker" || e.kind === "flyer") && e.stompable && this.isStompHit(e, feet)) {
            this.defeat(e, "stomp");
            this.bounce();
            break;
          }
          if (dashSmash) {
            if (e.breakable) this.breakEnt(e);
            else if (e.kind === "walker" || e.kind === "flyer") {
              if (e.stompable || e.kind === "walker") this.defeat(e, "dash");
            } else if (e.kind === "projectile") this.defeat(e, "dash");
            break;
          }
          if (p.stomping && e.breakable) {
            this.breakEnt(e);
            break;
          }
          if (invulnerable) break;
          this.applyHurt(e.skin || e.kind, false, e);
          break;
        }
        case "spring": {
          const eb = this.entBox(e);
          if (overlap(box, eb) && p.vy <= 0 && !p.onPlatform) {
            p.vy = SPRING_V;
            p.grounded = false;
            p.jumpsUsed = 1;
            p.stomping = false;
            p.sliding = false;
            p.glideUsed = 0;
            e.state = "sprung";
            e.stateT = 0;
            this.emit("spring", e.x - this.dist + e.w / 2, e.y);
          }
          break;
        }
        case "portal": {
          if (!e.passed && px >= e.x + e.w / 2) {
            e.passed = true;
            this.flipGravity();
            e.state = "used";
          }
          break;
        }
        case "wind": {
          const eb = this.entBox(e);
          if (overlap(this.playerBox(0), eb)) wind = Math.max(wind, e.p.lift || 0);
          break;
        }
        case "speedzone": {
          if (px > e.x && px < e.x + e.w && p.grounded) speedZone *= e.p.mult || 1;
          break;
        }
        case "pickup": {
          const cx = e.x + e.w / 2;
          const cy = e.y + e.h / 2;
          const r = Math.max(e.w, 40) / 2 + 26;
          const nearX = Math.max(box.x0, Math.min(cx, box.x1));
          const nearY = Math.max(box.y0, Math.min(cy, box.y1));
          if ((nearX - cx) ** 2 + (nearY - cy) ** 2 <= r * r) this.collect(e);
          break;
        }
        default:
          break;
      }
    }
    this.speedZone += (speedZone - this.speedZone) * Math.min(1, dt * 8);
    if (wind > 0 && !p.grounded) {
      p.vy += wind * dt;
      p.jumpsUsed = Math.min(p.jumpsUsed, 1);
    }
  }

  private isStompHit(e: Ent, feet: number): boolean {
    const p = this.player;
    if (p.gravDir !== 1) return false;
    if (p.vy > 0 && !p.stomping) return false;
    const top = e.y + e.hb[1];
    return feet <= top + Math.max(26, e.hb[3] * 0.5) && feet >= top - 30;
  }

  private bounce(): void {
    const p = this.player;
    p.stompChain += 1;
    p.vy = STOMP_BOUNCE_V + Math.min(4, p.stompChain) * 40;
    p.grounded = false;
    p.onPlatform = null;
    p.jumpsUsed = 1;
    p.stomping = false;
    p.glideUsed = 0;
    p.energy = Math.min(ENERGY_MAX, p.energy + 8 * this.perks.energyGain);
    this.emit("bounce", undefined, undefined, { value: p.stompChain });
  }

  private defeat(e: Ent, how: "stomp" | "dash"): void {
    if (e.state === "defeated") return;
    e.state = "defeated";
    e.stateT = 0;
    e.harmful = false;
    e.vy = how === "stomp" ? -240 : -520;
    if (e.kind === "walker" || e.kind === "flyer") e.vx = how === "dash" ? 700 : 40;
    this.stats.kills += 1;
    if (how === "stomp") this.stats.stomps += 1;
    this.bumpCombo(1);
    const pts = (how === "stomp" ? SCORE_STOMP : SCORE_DASH_KILL) * this.combo;
    this.bonus += pts;
    this.emit("enemy-defeat", e.x - this.dist + e.w / 2, e.y + e.h / 2, { value: pts, skin: e.skin, tag: how });
    if (e.kind === "projectile") e.dead = true;
  }

  private breakEnt(e: Ent): void {
    e.dead = true;
    e.harmful = false;
    this.bonus += 20 * this.combo;
    this.player.energy = Math.min(ENERGY_MAX, this.player.energy + 3);
    this.emit("wallbreak", e.x - this.dist + e.w / 2, e.y + e.h / 2, { skin: e.skin, value: 20 * this.combo });
  }

  private collect(e: Ent): void {
    if (e.dead) return;
    e.dead = true;
    const type: PickupType = e.pickup ?? "coin";
    const sx = e.x - this.dist + e.w / 2;
    const sy = e.y + e.h / 2;
    const p = this.player;
    switch (type) {
      case "coin": {
        this.stats.coins += 1;
        this.coinStreak += 1;
        this.coinStreakT = 0.9;
        if (this.coinStreak % 8 === 0) this.bumpCombo(1);
        this.bonus += SCORE_COIN * this.combo;
        p.energy = Math.min(ENERGY_MAX, p.energy + 2.4 * this.perks.energyGain);
        this.emit("coin", sx, sy, { value: this.coinStreak, skin: e.skin });
        break;
      }
      case "gem":
        this.stats.gems += 1;
        this.stats.coins += 5;
        this.bumpCombo(2);
        this.bonus += SCORE_GEM * this.combo;
        p.energy = Math.min(ENERGY_MAX, p.energy + 12);
        this.emit("gem", sx, sy, { value: SCORE_GEM * this.combo });
        break;
      case "heart":
        if (p.hearts < MAX_HEARTS) p.hearts += 1;
        else this.bonus += 250;
        this.emit("heart", sx, sy, { value: p.hearts });
        break;
      case "magnet":
        p.magnet = MAGNET_TIME;
        this.emit("powerup", sx, sy, { tag: "magnet" });
        break;
      case "shield":
        p.shield = SHIELD_TIME;
        this.emit("shield-on", sx, sy);
        this.emit("powerup", sx, sy, { tag: "shield" });
        break;
      case "slowmo":
        p.slowmo = SLOWMO_TIME;
        this.emit("powerup", sx, sy, { tag: "slowmo" });
        break;
      case "turbo":
        p.turbo = TURBO_TIME;
        p.invuln = Math.max(p.invuln, TURBO_TIME);
        p.stomping = false;
        p.sliding = false;
        this.emit("powerup", sx, sy, { tag: "turbo" });
        break;
    }
  }

  private bumpCombo(n: number): void {
    const before = this.combo;
    this.combo = Math.min(COMBO_MAX, this.combo + n);
    this.comboT = COMBO_WINDOW;
    if (this.combo > this.stats.maxCombo) this.stats.maxCombo = this.combo;
    if (this.combo > before) this.emit("combo-up", undefined, undefined, { value: this.combo });
  }

  private passEnt(e: Ent): void {
    e.passed = true;
    if (e.minClear < NEAR_MISS_CLEARANCE && e.state !== "defeated") {
      this.stats.nearMisses += 1;
      this.bumpCombo(1);
      const pts = SCORE_NEAR_MISS * this.combo;
      this.bonus += pts;
      this.player.energy = Math.min(ENERGY_MAX, this.player.energy + 9 * this.perks.energyGain);
      this.emit("near-miss", undefined, this.feetY() - 90, { value: pts, skin: e.skin });
    }
  }

  private flipGravity(): void {
    const p = this.player;
    const feet = this.feetY();
    const groundY = this.groundY;
    const ceilY = this.ceilY;
    if (p.gravDir === 1) {
      p.gravDir = -1;
      p.hgt = Math.max(0, feet - ceilY);
      p.vy = -p.vy;
    } else {
      p.gravDir = 1;
      p.hgt = Math.max(0, groundY - feet);
      p.vy = -p.vy;
    }
    p.grounded = false;
    p.onPlatform = null;
    p.sliding = false;
    p.jumpsUsed = 1;
    p.coyote = 0;
    this.emit("portal", undefined, feet);
  }

  /** Öffentlich für Weltsysteme (z.B. Lawine, Blitz). */
  hurt(source: string): void {
    if (this.phase !== "running") return;
    const p = this.player;
    if (p.invuln > 0 || p.dashT > 0 || p.turbo > 0) return;
    this.applyHurt(source, false);
  }

  private applyHurt(source: string, ignoreShield: boolean, e?: Ent): void {
    const p = this.player;
    if (!ignoreShield && p.shield > 0) {
      p.shield = 0;
      p.invuln = 1.1;
      this.emit("shield-hit", undefined, this.feetY() - 60);
      if (e?.breakable) this.breakEnt(e);
      else if (e && (e.kind === "projectile" || e.kind === "walker")) this.defeat(e, "dash");
      return;
    }
    p.hearts -= 1;
    this.stats.hurts += 1;
    p.invuln = HURT_INVULN;
    p.stun = HURT_STUN;
    p.sliding = false;
    p.stomping = false;
    p.dashT = 0;
    this.hurtSlow = HURT_SPEED_LOSS;
    this.combo = 1;
    this.comboT = 0;
    this.coinStreak = 0;
    this.speed *= HURT_SPEED_LOSS;
    this.emit("hurt", undefined, undefined, { tag: source, value: p.hearts });
    for (const s of this.systems) s.onHurt?.(this, source);
    if (p.hearts <= 0) this.die(source);
  }

  private die(source: string): void {
    this.deathCause = source;
    this.phase = "dying";
    this.deathT = 0;
    this.player.jumpBuf = 0;
    this.player.vy = 620;
    this.player.grounded = false;
    this.player.onPlatform = null;
    this.emit("death", undefined, undefined, { tag: source });
  }

  private checkGates(): void {
    const g = this.gates[0];
    if (!g) return;
    if (this.playerWorldX >= g.x) {
      this.gates.shift();
      this.lastGate = g;
      const idx = TOUR_ORDER.indexOf(g.to);
      if (idx <= this.tourIndex && g.to === TOUR_ORDER[0]) this.tourLoops += 1;
      if (g.to === TOUR_ORDER[0]) this.diffBonus += 1.2;
      this.tourIndex = idx;
      this.world = this.registry[g.to];
      this.worldStartDist = g.x - PLAYER_SX;
      this.systems = this.world.createSystems?.() ?? [];
      for (const s of this.systems) s.reset?.(this);
      this.vars = {};
      this.lastStage = 0;
      if (!this.stats.worldsVisited.includes(g.to)) this.stats.worldsVisited.push(g.to);
      this.emit("world-transition", undefined, undefined, { tag: g.to });
    }
  }

  private cull(): void {
    const limit = this.dist - CULL_BEHIND;
    let w = 0;
    for (let i = 0; i < this.ents.length; i += 1) {
      const e = this.ents[i];
      if (e.dead || e.x + e.w < limit) {
        if (this.player.onPlatform === e) this.player.onPlatform = null;
        continue;
      }
      this.ents[w++] = e;
    }
    this.ents.length = w;
    if (this.lastGate && this.dist - this.lastGate.x > VIEW_W + 600) this.lastGate = null;
  }

  private bookkeeping(): void {
    const m = Math.floor(this.meters);
    if (m - this.lastMilestone >= 500) {
      this.lastMilestone = Math.floor(m / 500) * 500;
      this.emit("milestone", undefined, undefined, { value: this.lastMilestone });
    }
    const st = this.stageInfo();
    if (st.stage !== this.lastStage) {
      this.lastStage = st.stage;
      this.emit("custom", undefined, undefined, { tag: "stage", value: st.stage });
    }
  }

  stageInfo(): { stage: number; blend: number } {
    const w = this.world;
    const wm = this.worldMeters;
    const stage = Math.min(w.stageCount - 1, Math.floor(wm / w.stageMeters));
    if (stage >= w.stageCount - 1) return { stage, blend: 0 };
    const into = wm - stage * w.stageMeters;
    const fadeLen = Math.min(140, w.stageMeters * 0.28);
    return { stage, blend: smooth((into - (w.stageMeters - fadeLen)) / fadeLen) };
  }

  /** Zustand für Renderer. */
  view(alpha: number, prev: { dist: number; hgt: number }, reducedMotion: boolean, quality: 0 | 1 | 2, dt: number): ViewState {
    const p = this.player;
    const st = this.stageInfo();
    const dist = prev.dist + (this.dist - prev.dist) * alpha;
    const hgt = prev.hgt + (p.hgt - prev.hgt) * alpha;
    const feet = p.gravDir === 1 ? this.groundY - hgt : this.ceilY + hgt;
    const intensity = Math.min(1, this.diff / 10);
    return {
      w: VIEW_W,
      h: 720,
      dist,
      speed: this.speed,
      time: this.time,
      dt,
      groundY: this.groundY,
      ceilY: this.ceilY,
      worldMeters: this.worldMeters,
      stage: st.stage,
      stageBlend: st.blend,
      intensity,
      gravDir: p.gravDir,
      playerX: PLAYER_SX,
      playerFeetY: feet,
      hurtGlow: Math.min(1, p.invuln > 0 && p.stun > 0 ? p.stun / HURT_STUN : 0),
      dashing: p.dashT > 0,
      turbo: p.turbo > 0,
      slowmo: p.slowmo > 0 ? 1 : 0,
      reducedMotion,
      quality,
      vars: this.vars,
      flash: this.flash,
    };
  }

  /** Pits als Bildschirm-Intervalle (für Boden-Renderer). */
  pitsOnScreen(dist: number): Array<{ x0: number; x1: number; skin: string }> {
    const out: Array<{ x0: number; x1: number; skin: string }> = [];
    for (const e of this.ents) {
      if (e.kind !== "pit" || e.dead) continue;
      const x0 = e.x - dist;
      const x1 = x0 + e.w;
      if (x1 < -20 || x0 > VIEW_W + 20) continue;
      out.push({ x0, x1, skin: e.skin });
    }
    return out;
  }

  /** Verbleibende Meter/Restzeit-Werte für HUD. */
  get tourWorldProgress(): number {
    return Math.min(1, this.worldMeters / TOUR_METERS);
  }
}

export { DEFAULT_GROUND_Y };
