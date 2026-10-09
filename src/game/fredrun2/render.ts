import type { GameAssets, CharacterSprites, AnimName } from "./assets";
import { PLAYER_H, PLAYER_SX, PLAYER_VISUAL_H, VIEW_H, VIEW_W } from "./constants";
import {
  DEATH_ORBIT_MAX,
  DEATH_TIP_ANGLE,
  PLAYER_SHADOW,
  SPEED_LANES,
  clamp,
  deathPose,
  playerAlpha,
  rgba,
  shadowRanges,
  shadowShape,
  smoothstep,
  speedLaneAt,
  speedLineStyle,
  squashFor,
  stepRunPhase,
  type DeathPose,
  type PlayerAlpha,
  type PlayerAlphaState,
  type RangeList,
  type ShadowShape,
  type SpeedLane,
  type Squash,
  type SquashKind,
} from "./draw-utils";
import { HudFx, drawHud, uiScaleFor, warmHudSprites, type ButtonCenter, type HudDrawCtx, type HudState } from "./hud";
import { Particles } from "./particles";
import { drawPickup } from "./pickups";
import type { Sim } from "./sim";
import type { Ent, SimEvent, ViewState, WorldRenderer } from "./types";
import { formatNumber } from "./ui-logic";
import { drawEntFallback } from "./worlds/basic";

export interface FrameData {
  sim: Sim;
  view: ViewState;
  /** Renderer der aktuellen Welt und (beim Tor-Übergang) der nächsten */
  current: WorldRenderer | null;
  next: WorldRenderer | null;
  /** Sicht für den Renderer der Zielwelt (Stufe 0, Weltmeter 0) beim Tor-Übergang */
  nextView: ViewState;
  /** Renderer-Lookup für Entitäten anhand der Welt-ID */
  rendererFor: (e: Ent) => WorldRenderer | null;
  hud: HudState | null;
  shakeX: number;
  shakeY: number;
  /** Zusätzliche weiße/farbige Überblendung (Blitz, Portal) */
  flash: number;
  flashColor: string;
  demo: boolean;
  /**
   * Visuelle Zeit für Animationen (Sek.), auch im Menü. Ab pkg-hub-feedback steht sie in Pause und Wiederaufnahme-Countdown
   * (der Renderer rechnet damit: Treffer-Flash, Dash-Schein, Blinken, Sprite-Animationen); dieselbe Uhr gehört an
   * `handleEvent(..., time)`.
   */
  time: number;
  showPlayer: boolean;
  /** Menü/Bereit-Modus: Figur in Idle-Pose */
  idle: boolean;
  /** Neuer Highscore: Figur tanzt */
  victory: boolean;
  /** Optional: gemessene Mitten der Touch-Knöpfe (Hub, DOM) für den Energiering bzw. die Power-up-Reihe des HUDs */
  hudDashCenter?: ButtonCenter | null;
  hudSlideCenter?: ButtonCenter | null;
}

interface Ghost {
  x: number;
  y: number;
  frame: number;
  anim: AnimName;
  life: number;
}

/** Weiche Ein-/Austrittsrampe der Zeitlupen-Inszenierung (Sekunden) */
const SLOW_RAMP = 0.2;
/** Verstärkung der Streifen-Deckkraft (Stil-Alpha der Welten ist auf blassen Hintergründen sonst kaum zu sehen) */
const SPEED_LINE_GAIN = 2.2;
/** Höhe des Körpermittelpunkts über dem Boden, wenn die Figur nach dem Tod liegt (px) */
const DEATH_LIE_H = 26;

/** Ziel der Flug-Münzen: Mitte des Münz-Symbols im HUD (Spiegel von drawTopRight in hud.ts, Logikeinheiten) */
const COIN_TARGET = { x: 1132, y: 44 } as const;

export class Renderer {
  readonly particles = new Particles();
  private g: CanvasRenderingContext2D;
  private scale = 1;
  private dpr = 1;
  /** CSS-Breite der Bühne / 1280 (für die HUD-Skalierung auf kleinen Bühnen) */
  private cssScale = 1;
  sprites: CharacterSprites | null = null;
  private vignette: HTMLCanvasElement | null = null;
  private ghosts: Ghost[] = [];
  private ghostT = 0;
  private dustT = 0;
  private jumpT = 0;
  private dblT = -10;
  private hurtT = Number.NEGATIVE_INFINITY;
  private slideT = -10;
  private victoryT = 0;
  /** Lauf-Phase (Animationszeit in Grundtempo-Sekunden): Akkumulator, nie zurückgesetzt außer beim Start */
  private runPhase = 0;
  /** true im Hitstop (laufender Lauf, Welt steht: scroll = 0) */
  private frozen = false;
  /** Squash & Stretch: Art, Aufprallstärke und Alter (s) seit dem Ereignis; Infinity = keiner */
  private squashKind: SquashKind = "land";
  private squashImpact = 0;
  private squashT = Number.POSITIVE_INFINITY;
  private slowK = 0;
  private slowEdge: HTMLCanvasElement | null = null;
  private glow: HTMLCanvasElement | null = null;
  /** HUD-Rückmeldung (Hochzählen, Bumps, Pops); dt sammelt update() und verbraucht draw() */
  private readonly hudFx = new HudFx();
  private readonly hudCtx: HudDrawCtx = { fx: this.hudFx, cssScale: 1, dashCenter: null, slideCenter: null };
  private hudDt = 0;
  /** HUD im letzten Bild sichtbar (Flug-Münzen gibt es nur dann) */
  private hudShown = false;
  /** Zähler bis zur nächsten Flug-Münze (alle 2 bis 3 Münzen eine) */
  private coinFlyIn = 2;
  private coinSeq = 0;
  private readonly target: { x: number; y: number } = { x: COIN_TARGET.x, y: COIN_TARGET.y };
  private pits: ReadonlyArray<{ x0: number; x1: number }> = [];
  // Wiederverwendete Zwischenobjekte (keine Allokation pro Frame)
  private readonly sq: Squash = { sx: 1, sy: 1 };
  private readonly pa: PlayerAlpha = { alpha: 1, flash: 0, dashGlow: 0 };
  private readonly paState: PlayerAlphaState = { phase: "ready", stun: 0, invuln: 0, dashT: 0, turbo: 0, time: 0, hurtT: Number.NEGATIVE_INFINITY };
  private readonly pose: DeathPose = { rot: 0, dx: 0, orbit: 0 };
  private readonly shadow: ShadowShape = { alpha: 0, rx: 0, ry: 0 };
  private readonly ranges: RangeList = [];
  private readonly lane: SpeedLane = { x: 0, y: 0, len: 0, a: 0 };
  /** Sichtbare Streifen-Bahnen des Frames: x, y, Länge, Deckkraft je Bahn */
  private readonly lanes = new Float64Array(SPEED_LANES * 4);
  private readonly anim: { name: AnimName; t: number; once: boolean; frame: number | undefined } = { name: "run", t: 0, once: false, frame: undefined };
  private readonly spriteOpts: { flipY: boolean; alpha: number; once: boolean; frame: number | undefined } = { flipY: false, alpha: 1, once: false, frame: undefined };
  /** Hilfsvariable für Bildqualität (0..2) */
  quality: 0 | 1 | 2 = 2;
  reducedMotion = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    readonly assets: GameAssets,
  ) {
    const g = canvas.getContext("2d", { alpha: false });
    if (!g) throw new Error("Canvas 2D nicht verfügbar");
    this.g = g;
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.dpr = dpr;
    const w = Math.max(320, Math.round(cssW * dpr));
    const h = Math.max(180, Math.round(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.scale = w / VIEW_W;
    this.cssScale = cssW > 0 && Number.isFinite(cssW) ? cssW / VIEW_W : 1;
    this.hudCtx.cssScale = this.cssScale;
    this.vignette = null;
    this.slowEdge = null;
    // HUD-Sprites in der neuen Skala vorab backen (sonst bäckt der erste HUD-Frame; bei gleicher Skala ein Property-Lookup)
    warmHudSprites(this.scale, this.cssScale);
  }

  get pixelScale(): number {
    return this.scale;
  }

  setCharacter(s: CharacterSprites | null): void {
    this.sprites = s;
  }

  /** Reagiert visuell auf Sim-Ereignisse (Partikel, Popups, Animationszeiten). */
  handleEvent(ev: SimEvent, sim: Sim, time: number): void {
    const P = this.particles;
    const floorY = sim.groundY;
    const px = PLAYER_SX;
    const feet = sim.feetY();
    const dir = sim.player.gravDir;
    switch (ev.type) {
      case "start":
        // Neuer Lauf: Lauf-Phase, HUD-Rückmeldung und Zustände zurücksetzen; Start-Staubstoß hinter den Füßen
        // (der Sim-Anlauf bleibt zurückgestellt, die Figur läuft sofort mit Grundtempo)
        this.runPhase = 0;
        this.squashT = Number.POSITIVE_INFINITY;
        this.hurtT = Number.NEGATIVE_INFINITY;
        this.slowK = 0;
        this.hudFx.reset();
        this.startBurst(px, feet, dir);
        break;
      case "jump":
        this.jumpT = time;
        this.startSquash("jump", 0);
        this.dust(px, feet, 8, dir);
        break;
      case "doublejump":
        this.dblT = time;
        this.startSquash("jump", 0);
        for (let i = 0; i < 14; i += 1) {
          const a = (i / 14) * Math.PI * 2;
          P.emit({ x: px, y: feet - 60 * dir, vx: Math.cos(a) * 260, vy: Math.sin(a) * 200, life: 0.4, size: 4, color: "#ffffff", shape: "spark", additive: true });
        }
        P.emit({ x: px, y: feet - 50 * dir, life: 0.4, size: 20, grow: 220, shape: "ring", color: "#bdf3ff", additive: true });
        break;
      case "land": {
        const impact = ev.value ?? 400;
        this.startSquash("land", impact);
        this.dust(px, feet, Math.min(14, 5 + Math.floor(impact / 200)), dir);
        break;
      }
      case "stomp-land":
        this.startSquash("stomp", 0);
        P.emit({ x: px, y: feet, life: 0.5, size: 20, grow: 700, shape: "ring", color: "#ffffff", additive: true });
        for (let i = 0; i < 22; i += 1) {
          const s = i % 2 ? 1 : -1;
          // Staubring ist weltfest (bleibt am Aufprallort liegen), weiche Puffs statt harter Kreise
          P.emit({ x: px + s * 10, y: feet - 6 * dir, vx: s * (200 + Math.random() * 520), vy: -(60 + Math.random() * 240) * dir, ay: 900 * dir, life: 0.55, size: 6 + Math.random() * 6, shape: "puff", alpha: 0.85, drag: 1.4, world: true });
        }
        break;
      case "slide":
        this.slideT = time;
        break;
      case "dash":
        for (let i = 0; i < 18; i += 1) {
          P.emit({ x: px - 40, y: feet - 30 - Math.random() * 80 * dir, vx: -500 - Math.random() * 700, life: 0.35, size: 3 + Math.random() * 3, shape: "streak", color: "#bdf3ff", additive: true });
        }
        break;
      case "coin": {
        // Gold-Ring + 8 Sterne mit Rand; alle 2 bis 3 Münzen fliegt eine Münze zum HUD-Zähler (nur mit sichtbarem HUD, nicht bei
        // "Weniger Bewegung"). Die Obergrenze (3 gleichzeitig) und das Qualitätsbudget regelt Particles.
        let tx = Number.NaN;
        let ty = Number.NaN;
        this.coinFlyIn -= 1;
        if (this.coinFlyIn <= 0) {
          this.coinFlyIn = 2 + (this.coinSeq++ & 1);
          if (this.hudShown && !this.reducedMotion) {
            const t = this.coinTarget(sim.stats.coins);
            tx = t.x;
            ty = t.y;
          }
        }
        P.coinFx(ev.x, ev.y, tx, ty);
        break;
      }
      case "gem":
        for (let i = 0; i < 18; i += 1) {
          const a = Math.random() * Math.PI * 2;
          P.emit({ x: ev.x, y: ev.y, vx: Math.cos(a) * 340, vy: Math.sin(a) * 340, life: 0.6, size: 5, color: i % 2 ? "#ff8fb1" : "#ffffff", shape: "star", vr: 6, additive: true });
        }
        P.popup(ev.x, ev.y - 30, `+${ev.value ?? 100}`, "#ff8fb1", 34);
        break;
      case "heart":
        for (let i = 0; i < 14; i += 1) {
          const a = Math.random() * Math.PI * 2;
          P.emit({ x: ev.x, y: ev.y, vx: Math.cos(a) * 240, vy: Math.sin(a) * 240 - 60, life: 0.7, size: 5, color: "#ff5c7a", shape: "circle", additive: true });
        }
        P.popup(ev.x, ev.y - 34, "+1 ♥", "#ff8a9f", 40);
        break;
      case "powerup":
        P.emit({ x: ev.x, y: ev.y, life: 0.5, size: 20, grow: 500, shape: "ring", color: "#ffffff", additive: true });
        P.popup(ev.x, ev.y - 40, powerupLabel(ev.tag), "#ffffff", 34, 1.2);
        break;
      case "hurt":
        this.hurtT = time;
        for (let i = 0; i < 18; i += 1) {
          const a = Math.random() * Math.PI * 2;
          P.emit({ x: px, y: feet - 60 * dir, vx: Math.cos(a) * 320, vy: Math.sin(a) * 320 - 80, life: 0.5, size: 4, color: i % 3 ? "#ff5c5c" : "#ffffff", shape: "spark", additive: true });
        }
        P.popup(px, feet - 190 * dir, "Autsch!", "#ff8a8a", 34);
        break;
      case "shield-hit":
        P.emit({ x: px, y: feet - 60 * dir, life: 0.5, size: 60, grow: 400, shape: "ring", color: "#67e8f9", additive: true });
        break;
      case "shield-on":
        P.emit({ x: px, y: feet - 60 * dir, life: 0.6, size: 40, grow: 300, shape: "ring", color: "#67e8f9", additive: true });
        break;
      case "near-miss":
        P.popup(px + 46, ev.y, `Knapp! +${ev.value ?? 30}`, "#ffe066", 30);
        break;
      case "combo-up":
        P.popup(px, feet - 200 * dir, `Kombo ×${ev.value ?? 2}`, "#ffe066", 34);
        break;
      case "enemy-defeat":
        P.emit({ x: ev.x, y: ev.y, life: 0.4, size: 16, grow: 400, shape: "ring", color: "#ffffff", additive: true });
        for (let i = 0; i < 12; i += 1) {
          const a = Math.random() * Math.PI * 2;
          P.emit({ x: ev.x, y: ev.y, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300 - 100, life: 0.5, size: 5, color: "#ffd166", shape: "star", vr: 7, additive: true });
        }
        P.popup(ev.x, ev.y - 40, `+${ev.value ?? 60}`, "#ffffff", 32);
        break;
      case "wallbreak":
        for (let i = 0; i < 16; i += 1) {
          const a = Math.random() * Math.PI * 2;
          // Trümmer gehören zur Wand, nicht zum Bildschirm: weltfest mitscrollen
          P.emit({ x: ev.x, y: ev.y, vx: Math.cos(a) * 380, vy: Math.sin(a) * 380 - 140, ay: 1400, life: 0.7, size: 6, color: i % 2 ? "#d9b38c" : "#a67c52", shape: "square", vr: 10, world: true });
        }
        break;
      case "spring":
        this.startSquash("jump", 0);
        P.emit({ x: ev.x, y: ev.y, life: 0.4, size: 20, grow: 420, shape: "ring", color: "#a5f3fc", additive: true });
        break;
      case "portal":
        P.emit({ x: px, y: ev.y, life: 0.6, size: 30, grow: 700, shape: "ring", color: "#c4b5fd", additive: true });
        break;
      case "pit-fall":
        P.emit({ x: px, y: floorY, life: 0.6, size: 20, grow: 500, shape: "ring", color: "#ffffff", additive: true });
        break;
      case "death":
        for (let i = 0; i < 28; i += 1) {
          const a = Math.random() * Math.PI * 2;
          P.emit({ x: px, y: feet - 60 * dir, vx: Math.cos(a) * 480, vy: Math.sin(a) * 480, life: 0.9, size: 6, color: i % 3 ? "#ff5c5c" : "#ffd166", shape: "star", vr: 8, additive: true });
        }
        break;
      case "milestone":
        P.popup(VIEW_W / 2, 250, `${ev.value} m!`, "#ffffff", 56, 1.6);
        break;
      default:
        break;
    }
  }

  /**
   * Lande-/Absprung-Staub. Weltfest (`world`): bleibt am Boden liegen und scrollt mit, statt an der Figur zu kleben; die
   * Geschwindigkeit ist relativ zum Boden und klingt per Reibung rasch ab (Staub steht nach dem Aufwirbeln im Raum).
   */
  private dust(x: number, feet: number, n: number, dir: 1 | -1): void {
    for (let i = 0; i < n; i += 1) {
      this.particles.emit({
        x: x + (Math.random() - 0.5) * 30,
        y: feet - 4 * dir,
        vx: -20 + Math.random() * 34,
        vy: -(40 + Math.random() * 120) * dir,
        life: 0.42,
        size: 4 + Math.random() * 5,
        grow: 26,
        shape: "puff",
        alpha: 0.7,
        drag: 6,
        world: true,
      });
    }
  }

  /** Start-Staubstoß (10 Puffs) hinter den Füßen nach dem Countdown. */
  private startBurst(x: number, feet: number, dir: 1 | -1): void {
    for (let i = 0; i < 10; i += 1) {
      this.particles.emit({
        x: x - 6 - Math.random() * 34,
        y: feet - 4 * dir,
        vx: -(20 + Math.random() * 60),
        vy: -(30 + Math.random() * 110) * dir,
        life: 0.55,
        size: 5 + Math.random() * 6,
        grow: 34,
        shape: "puff",
        alpha: 0.65,
        drag: 4.5,
        world: true,
      });
    }
  }

  private startSquash(kind: SquashKind, impact: number): void {
    this.squashKind = kind;
    this.squashImpact = impact;
    this.squashT = 0;
  }

  /** Bildschirmposition des Münz-Symbols im HUD (hud.ts: drawTopRight, auf kleinen Bühnen wächst die Gruppe von der Ecke aus). */
  private coinTarget(coins: number): { x: number; y: number } {
    const u = uiScaleFor(this.cssScale);
    const t = this.target;
    if (u <= 1.0001) {
      t.x = COIN_TARGET.x;
      t.y = COIN_TARGET.y;
      return t;
    }
    // Spiegel von drawTopRight: Plattenbreite nach Ziffern (85 + 17,5 je Zeichen, 108..156), Skala höchstens so groß, dass die
    // Pause-Taste frei bleibt (TR_ROOM 166); das Symbol sitzt 30 px rechts vom linken Rand der Platte, Anker ist die Ecke (1258, 18)
    const w = clamp(85 + formatNumber(coins).length * 17.5, 108, 156);
    const k = Math.max(1, Math.min(u, 166 / w));
    t.x = VIEW_W - 22 + (30 - w) * k;
    t.y = 18 + (COIN_TARGET.y - 18) * k;
    return t;
  }

  /**
   * Pro Frame: Partikel + Laufstaub + Geisterbilder + Animationsuhren. `scroll` * `dt` ist die Verschiebung des Bodens in
   * diesem Schritt (px; weltfeste Partikel wandern damit mit), `scroll` = 0 bedeutet Hitstop: Lauf-Phase und Squash stehen.
   */
  update(dt: number, sim: Sim, scroll: number): void {
    this.particles.update(dt, scroll);
    this.hudDt += dt;
    const p = sim.player;
    const running = sim.phase === "running";
    this.frozen = running && !(scroll > 0);
    if (running) this.runPhase = stepRunPhase(this.runPhase, dt, sim.speed, this.frozen ? 0 : 1);
    if (!this.frozen) this.squashT += dt;
    // Zeitlupen-Rampe (weicher Ein-/Austritt statt hartem Sprung)
    const slowTarget = running && p.slowmo > 0 ? 1 : 0;
    const slowStep = dt / SLOW_RAMP;
    this.slowK = slowTarget > this.slowK ? Math.min(slowTarget, this.slowK + slowStep) : Math.max(slowTarget, this.slowK - slowStep);
    if (running && p.grounded && !p.sliding && this.quality > 0) {
      this.dustT -= dt;
      if (this.dustT <= 0) {
        this.dustT = clamp(0.16 - sim.speed / 10000, 0.05, 0.16);
        this.particles.emit({
          x: PLAYER_SX - 22,
          y: sim.feetY() - 3 * p.gravDir,
          vx: -40 + Math.random() * 50,
          vy: -(6 + Math.random() * 40) * p.gravDir,
          life: 0.36,
          size: 3 + Math.random() * 3,
          grow: 14,
          shape: "puff",
          alpha: 0.5,
          drag: 4,
          world: true,
        });
      }
    }
    if (p.slideT > 0 && p.sliding && this.quality > 0) {
      this.particles.emit({ x: PLAYER_SX - 30, y: sim.feetY() - 4 * p.gravDir, vx: -20 - Math.random() * 50, vy: -(30 + Math.random() * 40) * p.gravDir, life: 0.3, size: 3, shape: "spark", color: "#ffd166", additive: true, world: true });
    }
    if (p.turbo > 0 || p.dashT > 0) {
      this.ghostT -= dt;
      if (this.ghostT <= 0) {
        this.ghostT = 0.035;
        this.ghosts.push({ x: PLAYER_SX, y: sim.feetY(), frame: -1, anim: "dash", life: 0 });
        if (this.ghosts.length > 8) this.ghosts.shift();
      }
      if (p.turbo > 0) {
        this.particles.emit({ x: PLAYER_SX - 40, y: sim.feetY() - 40 * p.gravDir, vx: -400 - Math.random() * 300, vy: (Math.random() - 0.5) * 120, life: 0.35, size: 7, color: Math.random() < 0.5 ? "#ffb703" : "#ff5d3a", additive: true, drag: 1 });
      }
    }
    // Altern und abgelaufene Geisterbilder an Ort und Stelle entfernen (kein neues Array/keine Closure pro Frame)
    const gs = this.ghosts;
    let keep = 0;
    for (let i = 0; i < gs.length; i += 1) {
      const gh = gs[i];
      gh.life += dt;
      if (gh.life < 0.28) gs[keep++] = gh;
    }
    gs.length = keep;
  }

  /** Wählt Animation und Zeit für diesen Frame; das Ergebnis liegt in `this.anim` (wiederverwendet). */
  private pickAnim(f: FrameData): { name: AnimName; t: number; once: boolean; frame: number | undefined } {
    const sim = f.sim;
    const p = sim.player;
    const time = f.time;
    const a = this.anim;
    a.once = false;
    a.frame = undefined;
    if (f.idle || sim.phase === "ready") {
      a.name = "idle";
      a.t = time;
    } else if (f.victory && sim.phase === "over") {
      a.name = "victory";
      a.t = time;
    } else if (sim.phase === "dying" || sim.phase === "over") {
      a.name = "hurt";
      a.t = sim.deathT;
      a.once = true;
    } else if (p.stun > 0.05) {
      a.name = "hurt";
      a.t = Math.max(0, time - this.hurtT);
      a.once = true;
    } else if (p.dashT > 0 || p.turbo > 0) {
      a.name = "dash";
      a.t = time;
    } else if (p.stomping) {
      a.name = "stomp";
      a.t = time;
    } else if (p.sliding) {
      a.name = "slide";
      a.t = time;
    } else if (!p.grounded) {
      const sinceDbl = time - this.dblT;
      if (p.gliding && this.sprites?.has("glide")) {
        a.name = "glide";
        a.t = time;
      } else if (p.jumpsUsed >= 2 && sinceDbl < 0.62 && p.vy > -200) {
        a.name = "doublejump";
        a.t = sinceDbl;
        a.once = true;
      } else if (p.vy > 60) {
        a.name = "jump";
        a.t = Math.max(0, time - this.jumpT);
        a.once = true;
      } else if (this.sprites?.has("fall")) {
        a.name = "fall";
        a.t = time;
      } else {
        const jumpAnim = this.sprites?.resolve("jump");
        a.name = "jump";
        a.t = 0;
        a.frame = jumpAnim ? Math.floor(jumpAnim.frames * 0.55) : 0;
      }
    } else {
      // Akkumulierte Phase statt Seitenzeit x Rate: Tempowechsel ändern nur die Steigung, nie den Wert (kein Strobing)
      a.name = "run";
      a.t = this.runPhase;
    }
    return a;
  }

  draw(f: FrameData): void {
    const g = this.g;
    const { sim, view } = f;
    const s = this.scale;
    this.lastGroundY = view.groundY;
    g.setTransform(s, 0, 0, s, 0, 0);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";

    g.save();
    // Skalierungsqualität der Szene; mit Shake-Zoom "low", sonst bleibt "high" (siehe unten)
    let smooth: ImageSmoothingQuality = "high";
    if (f.shakeX || f.shakeY) {
      // Statt die Ränder zu füllen (dunkle Streifen in hellen Welten) die Szene um die Mitte so weit vergrößern, wie sie
      // verschoben wird: der Rand wird nie frei. Ohne Shake bleibt das Bild unverändert.
      const zoom = 1 + Math.max(Math.abs(f.shakeX) / (VIEW_W / 2), Math.abs(f.shakeY) / (VIEW_H / 2));
      g.translate(f.shakeX, f.shakeY);
      g.translate(VIEW_W / 2, VIEW_H / 2);
      g.scale(zoom, zoom);
      g.translate(-VIEW_W / 2, -VIEW_H / 2);
      // Jede Skalierung ungleich 1 nähme sonst den "high"-Filter für alle Sprites und Hintergründe: im Software-Raster
      // 25-46 % Frame-Zeit pro Shake-Frame (Wien, 1280x720, DPR 1). Bilinear reicht, das Bild bebt ohnehin (mittlere
      // Abweichung 0,8/255). Das g.restore() am Ende des Szenen-Durchgangs stellt die Qualität wieder her.
      smooth = "low";
      g.imageSmoothingQuality = smooth;
    }

    // --- Hintergrund + Boden ---
    const blend = sim.nextGate ? sim.gateBlend : 0;
    const pits = sim.pitsOnScreen(view.dist);
    this.pits = pits;
    const crossfade = blend > 0.001 && !!f.next;
    if (f.current) {
      f.current.drawBackground(g, view);
      f.current.drawGround(g, view, pits);
      if (crossfade && f.next) {
        // Zielwelt in Zwischenfläche rendern und mit Deckkraft überblenden (unabhängig davon, ob Welten globalAlpha zurücksetzen)
        this.compositeWorld(g, blend, (xg) => {
          f.next?.drawBackground(xg, f.nextView);
          f.next?.drawGround(xg, f.nextView, pits);
        });
      }
    } else {
      g.fillStyle = "#0e1226";
      g.fillRect(0, 0, VIEW_W, VIEW_H);
    }

    // --- Entitäten (3 Durchgänge), zwischen den beiden letzten Sim-Schritten interpoliert ---
    const alpha = viewAlpha(view);
    this.pass(g, f, BACK, alpha);
    this.pass(g, f, MID, alpha);
    this.pass(g, f, PICK, alpha);
    if (f.showPlayer) this.drawPlayer(g, f);
    // Weiche Puff-Sprites brauchen keine hochwertige Skalierung (im Software-Raster deutlich teurer)
    g.imageSmoothingQuality = "low";
    this.particles.draw(g);
    g.imageSmoothingQuality = smooth;
    if (f.current) {
      f.current.drawForeground(g, view);
      if (crossfade && f.next) {
        this.compositeWorld(g, blend, (xg) => f.next?.drawForeground(xg, f.nextView));
      }
    }
    g.restore();

    // --- Post ---
    if (f.current?.drawOverlay) f.current.drawOverlay(g, view);
    // Warnpfeile liegen über dem Licht-/Dunkelheits-Overlay (bleiben in dunklen Welten voll sichtbar)
    this.drawWarnMarkers(g, f);
    this.drawPost(g, f);
    // HUD mit Rückmeldung (Hochzählen, Bumps, Herz-Pops) und Skalierung kleiner Bühnen; dt kommt aus update() (0 in der Pause)
    const hudDt = this.hudDt;
    this.hudDt = 0;
    this.hudShown = !!f.hud;
    if (f.hud) {
      // "Weniger Bewegung" gilt fürs HUD wie für die Szene: kein Herz-Pop, kein Münz-/Score-/Kombo-Bump, kein Wackeln.
      // buildHud() liefert pro Frame ein neues Objekt (keine Allokation); ein vom Hub gesetztes reduced bleibt wirksam.
      if (this.reducedMotion) f.hud.reduced = true;
      this.hudFx.update(f.hud, hudDt);
      const ctx = this.hudCtx;
      ctx.dashCenter = f.hudDashCenter ?? null;
      ctx.slideCenter = f.hudSlideCenter ?? null;
      drawHud(g, f.hud, ctx);
    }
    // Popups über dem HUD (nichts verschwindet dahinter); im Demo-Hintergrund gibt es keine (sie schienen durch die Menü-Panels)
    if (!f.demo) this.particles.drawPopups(g);
  }

  /** Ein Zeichendurchgang über die Entitäten der Art `kinds` (Position zwischen px/py und x/y bei `alpha` interpoliert). */
  private pass(g: CanvasRenderingContext2D, f: FrameData, kinds: ReadonlySet<string>, alpha: number): void {
    const dist = f.view.dist;
    for (const e of f.sim.ents) {
      if (e.dead || !kinds.has(e.kind)) continue;
      const sx = lerpPos(e.px, e.x, alpha) - dist;
      if (sx > VIEW_W + 260 || sx + e.w < -260) continue;
      this.drawEnt(g, f, e, sx, lerpPos(e.py, e.y, alpha));
    }
  }

  private xfade: HTMLCanvasElement | null = null;

  /** Zeichnet `paint` in eine Zwischenfläche (gleiche Transformation wie die Hauptfläche) und blendet sie mit `alpha` ein. */
  private compositeWorld(g: CanvasRenderingContext2D, alpha: number, paint: (xg: CanvasRenderingContext2D) => void): void {
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    if (!this.xfade || this.xfade.width !== cw || this.xfade.height !== ch) {
      this.xfade = document.createElement("canvas");
      this.xfade.width = cw;
      this.xfade.height = ch;
    }
    const xg = this.xfade.getContext("2d");
    if (!xg) return;
    xg.setTransform(1, 0, 0, 1, 0, 0);
    xg.clearRect(0, 0, cw, ch);
    xg.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    xg.imageSmoothingEnabled = true;
    xg.imageSmoothingQuality = "high";
    xg.globalAlpha = 1;
    xg.globalCompositeOperation = "source-over";
    paint(xg);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = Math.min(1, Math.max(0, alpha));
    g.drawImage(this.xfade, 0, 0);
    g.restore();
  }

  private drawEnt(g: CanvasRenderingContext2D, f: FrameData, e: Ent, sx: number, sy: number): void {
    const r = f.rendererFor(e);
    if (r?.drawEntity(g, e, sx, sy, r === f.next ? f.nextView : f.view)) return;
    if ((e.kind === "walker" || e.kind === "flyer") && this.drawGuest(g, e, sx, sy, f.time)) return;
    if (e.kind === "pickup" && e.pickup) {
      drawPickup(g, this.assets.props, e.pickup, e.skin, sx + e.w / 2, sy + e.h / 2, e.w, f.time, e.id * 0.37);
      return;
    }
    if (e.skin === "gateway" && e.kind === "decor") {
      this.drawGateway(g, e, sx, sy, f.time);
      return;
    }
    if (e.kind === "swinger") {
      g.strokeStyle = "rgba(60,50,70,0.8)";
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(e.p.ax - f.view.dist, e.p.ay);
      g.lineTo(sx + e.w / 2, sy + e.h / 2);
      g.stroke();
    }
    drawEntFallback(g, e, sx, sy);
  }

  /** Gast-Gegner (Odo, Madinger, JQA, Luki) mit Sprites aus props/manifest.json. */
  private drawGuest(g: CanvasRenderingContext2D, e: Ent, sx: number, sy: number, time: number): boolean {
    const props = this.assets.props;
    const run = `${e.skin}-run`;
    if (!props.has(run) && !props.has(`${e.skin}-defeated`)) return false;
    const cx = sx + e.w / 2;
    const feet = sy + e.h;
    if (e.state === "defeated") {
      const id = props.has(`${e.skin}-defeated`) ? `${e.skin}-defeated` : run;
      const u = Math.min(1, e.stateT / 1.2);
      g.save();
      g.globalAlpha = 1 - Math.max(0, u - 0.55) / 0.45;
      props.draw(g, id, cx, feet, { h: e.h * 1.32, flipX: true, t: e.stateT, once: true });
      g.restore();
      return true;
    }
    const isAir = e.kind === "walker" && feet < this.lastGroundY - 4;
    const id = isAir && props.has(`${e.skin}-jump`) ? `${e.skin}-jump` : run;
    // Schatten: wie beim Spieler mit der Flughöhe kleiner und blasser, nie über Gruben; Deckengänger (Cyber) haben keinen
    if (!e.ceil) {
      shadowShape(this.lastGroundY - feet, 0.28, e.w * 0.62, 8, PLAYER_SHADOW.reach, this.shadow);
      this.drawShadow(g, cx, this.lastGroundY + 6, this.shadow, true);
    }
    return props.draw(g, id, cx, feet, { h: e.h * 1.32, flipX: true, t: time + e.id * 0.31 });
  }

  private lastGroundY = 590;

  private drawGateway(g: CanvasRenderingContext2D, e: Ent, sx: number, sy: number, time: number): void {
    const color = GATE_COLORS[Math.max(0, Math.min(GATE_COLORS.length - 1, Math.round(e.p.to ?? 0)))];
    const cx = sx + e.w / 2;
    const cy = sy + e.h / 2;
    const ry = e.h * 0.5;
    const rx = e.w * 0.62;
    g.save();
    // Sog-Glühen
    const glow = g.createRadialGradient(cx, cy, 10, cx, cy, ry * 1.25);
    glow.addColorStop(0, rgba(color, 0.55));
    glow.addColorStop(0.55, rgba(color, 0.18));
    glow.addColorStop(1, rgba(color, 0));
    g.fillStyle = glow;
    g.fillRect(cx - ry * 1.3, cy - ry * 1.3, ry * 2.6, ry * 2.6);
    // Innenfläche mit Wirbel
    g.save();
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    g.clip();
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < 9; i += 1) {
      const a = time * (0.8 + i * 0.09) + i * 1.3;
      const yy = cy + Math.sin(a) * ry * 0.85;
      g.fillStyle = rgba(color, 0.16);
      g.fillRect(cx - rx, yy - 6 - (i % 3) * 3, rx * 2, 12 + (i % 3) * 6);
    }
    g.restore();
    // Ring
    g.lineWidth = 9;
    g.strokeStyle = rgba("#ffffff", 0.9);
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 4;
    g.strokeStyle = rgba(color, 0.95);
    g.beginPath();
    g.ellipse(cx, cy, rx + 8, ry + 8, 0, 0, Math.PI * 2);
    g.stroke();
    // Funken
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < 14; i += 1) {
      const a = time * 1.6 + i * 0.9;
      const px = cx + Math.cos(a) * (rx + 10 + (i % 4) * 5);
      const py = cy + Math.sin(a) * (ry + 10 + (i % 4) * 5);
      g.fillStyle = rgba("#ffffff", 0.7);
      g.beginPath();
      g.arc(px, py, 3 + (i % 3), 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  private drawWarnMarkers(g: CanvasRenderingContext2D, f: FrameData): void {
    const { sim, view } = f;
    const alpha = viewAlpha(view);
    for (const e of sim.ents) {
      if (!e.warn || e.dead || e.state === "defeated") continue;
      const sx = lerpPos(e.px, e.x, alpha) - view.dist;
      if (sx < VIEW_W - 12 || sx > VIEW_W + 1300) continue;
      const near = 1 - clamp((sx - VIEW_W) / 1300, 0, 1);
      const blink = 0.55 + 0.45 * Math.sin(f.time * (8 + near * 10));
      const y = clamp(lerpPos(e.py, e.y, alpha) + e.h / 2, 90, VIEW_H - 120);
      g.save();
      g.globalAlpha = (0.55 + near * 0.45) * blink;
      g.translate(VIEW_W - 52, y);
      g.fillStyle = "#ffcc33";
      g.strokeStyle = "#5a3b00";
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(0, -30);
      g.lineTo(32, 26);
      g.lineTo(-32, 26);
      g.closePath();
      g.stroke();
      g.fill();
      g.fillStyle = "#3b2600";
      g.font = "900 34px system-ui, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("!", 0, 8);
      g.restore();
    }
  }

  /**
   * Bodenschatten (Ellipse): auf dem Boden ohne die Gruben-Intervalle (`onFloor`), sonst als ganze Ellipse. `sh` aus shadowShape.
   * Liegt die ganze Ellipse über einer Grube, entfällt der Schatten; ragt sie hinein, wird sie an der Kante abgeschnitten.
   */
  private drawShadow(g: CanvasRenderingContext2D, cx: number, y: number, sh: ShadowShape, onFloor: boolean): void {
    if (sh.alpha < 0.004) return;
    g.save();
    g.globalAlpha = sh.alpha;
    g.fillStyle = "#000";
    if (onFloor && this.pits.length > 0) {
      const r = shadowRanges(cx - sh.rx, cx + sh.rx, this.pits, this.ranges);
      if (r.length === 0) {
        g.restore();
        return;
      }
      if (r.length > 2 || r[0] > cx - sh.rx || r[1] < cx + sh.rx) {
        g.beginPath();
        for (let i = 0; i < r.length; i += 2) g.rect(r[i], y - sh.ry - 2, r[i + 1] - r[i], sh.ry * 2 + 4);
        g.clip();
      }
    }
    g.beginPath();
    g.ellipse(cx, y, sh.rx, sh.ry, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  /** Cyan-Randschein um den Körper bei Dash/Turbo und in der Dash-Gnadenfrist (statt Blinken); weiches Sprite, einmal gebacken. */
  private drawDashGlow(g: CanvasRenderingContext2D, x: number, feet: number, dir: 1 | -1, k: number): void {
    if (!this.glow) {
      const c = document.createElement("canvas");
      c.width = 96;
      c.height = 96;
      const cg = c.getContext("2d");
      if (cg) {
        const grd = cg.createRadialGradient(48, 48, 6, 48, 48, 48);
        grd.addColorStop(0, "rgba(150,240,255,0.55)");
        grd.addColorStop(0.55, "rgba(90,215,255,0.3)");
        grd.addColorStop(1, "rgba(60,190,255,0)");
        cg.fillStyle = grd;
        cg.fillRect(0, 0, 96, 96);
      }
      this.glow = c;
    }
    g.save();
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.85 * clamp(k, 0, 1);
    g.drawImage(this.glow, x - 78, feet - dir * (PLAYER_VISUAL_H / 2) - 112, 156, 224);
    g.restore();
  }

  private drawPlayer(g: CanvasRenderingContext2D, f: FrameData): void {
    const { sim, view } = f;
    const p = sim.player;
    const x = PLAYER_SX;
    const feet = view.playerFeetY;
    const dir = view.gravDir;
    const spr = this.sprites;
    const surface = dir === 1 ? view.groundY : view.ceilY;
    // Liegende Tod-Pose in der Sterbephase und auf der Game-Over-Karte (außer beim Siegestanz nach neuem Rekord)
    const lying = sim.phase === "dying" || (sim.phase === "over" && !f.victory);

    // Schatten: mit der Höhe kleiner und blasser, nicht über Gruben
    shadowShape(Math.abs(feet - surface), PLAYER_SHADOW.alpha, PLAYER_SHADOW.rx, PLAYER_SHADOW.ry, PLAYER_SHADOW.reach, this.shadow);
    this.drawShadow(g, x - 4, surface + (dir === 1 ? 6 : -6), this.shadow, dir === 1);

    // Deckkraft, Treffer-Flash und Dash-Schein (reine Funktion, siehe draw-utils)
    const st = this.paState;
    st.phase = sim.phase;
    st.stun = p.stun;
    st.invuln = p.invuln;
    st.dashT = p.dashT;
    st.turbo = p.turbo;
    st.time = f.time;
    st.hurtT = this.hurtT;
    const pa = playerAlpha(st, this.pa);
    const anim = this.pickAnim(f);
    const o = this.spriteOpts;

    // Geisterbilder (Dash)
    if (spr && this.ghosts.length) {
      o.flipY = dir === -1;
      o.once = false;
      o.frame = anim.frame;
      for (const gh of this.ghosts) {
        const u = gh.life / 0.28;
        const gx = gh.x - gh.life * (view.speed * 0.9);
        g.save();
        g.globalCompositeOperation = "lighter";
        o.alpha = 0.32 * (1 - u);
        spr.draw(g, anim.name, anim.t, gx, gh.y, o);
        g.restore();
      }
    }

    // Dash-/Turbo-Schein hinter der Figur
    if (pa.dashGlow > 0.02 && !lying) this.drawDashGlow(g, x, feet, dir, pa.dashGlow);

    // Schild-Blase (hinter der Figur)
    if (p.shield > 0) {
      const cy = feet - (PLAYER_VISUAL_H / 2) * dir;
      const pulse = 1 + Math.sin(f.time * 6) * 0.03;
      const low = p.shield < 3 && Math.floor(f.time * 8) % 2 === 0;
      g.save();
      g.globalAlpha = low ? 0.35 : 0.9;
      const grd = g.createRadialGradient(x, cy, 30, x, cy, 104 * pulse);
      grd.addColorStop(0, "rgba(103,232,249,0.02)");
      grd.addColorStop(0.75, "rgba(103,232,249,0.16)");
      grd.addColorStop(1, "rgba(180,250,255,0.55)");
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, cy, 104 * pulse, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = "rgba(220,255,255,0.8)";
      g.stroke();
      g.restore();
    }

    // Figur
    let drawn = false;
    if (spr) {
      g.save();
      // Zeichenposition des Fußpunkts: in der Tod-Pose relativ zur Körpermitte (Drehpunkt), sonst absolut mit Squash um den Fuß
      let fx = x;
      let fy = feet;
      if (lying) {
        // Um die Körpermitte nach hinten kippen, dabei auf Liegehöhe absinken und etwas nach hinten rutschen
        const pose = deathPose(sim.deathT, this.reducedMotion, this.pose);
        const k = pose.rot / DEATH_TIP_ANGLE;
        const half = PLAYER_VISUAL_H / 2;
        const cx = x + pose.dx;
        const cy = feet - dir * (half * (1 - k) + DEATH_LIE_H * k);
        const rot = pose.rot * dir;
        g.translate(cx, cy);
        g.rotate(rot);
        fx = 0;
        fy = dir * half;
        if (sim.phase === "dying" && pose.orbit > 0) {
          // Sternchen kreisen über dem Kopf (Kopf = Körpermitte um -dir*half gedreht)
          const hy = -dir * half;
          this.particles.orbit(cx - hy * Math.sin(rot), cy + hy * Math.cos(rot) - 28 * dir, Math.min(DEATH_ORBIT_MAX, pose.orbit), 30);
        }
      } else {
        const sq = squashFor(this.squashT, this.squashKind, this.squashImpact, this.reducedMotion, this.sq);
        if (sq.sx !== 1 || sq.sy !== 1) {
          g.translate(x, feet);
          g.scale(sq.sx, sq.sy);
          g.translate(-x, -feet);
        }
      }
      o.flipY = dir === -1;
      o.alpha = pa.alpha;
      o.once = anim.once;
      o.frame = anim.frame;
      drawn = spr.draw(g, anim.name, anim.t, fx, fy, o);
      // Treffer-Flash (weiß, klingt in 0,15 s ab; folgt dem Regler "Blitze") und Nachglimmen während des Stuns (langsam, kein
      // Blitz), gleiche Transformation wie die Figur
      const flash = pa.flash * viewFlash(view);
      const ov = lying ? flash : Math.max(flash, view.hurtGlow > 0.01 ? 0.35 * view.hurtGlow : 0);
      if (drawn && ov > 0.01) {
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = Math.min(1, ov);
        o.alpha = 1;
        spr.draw(g, anim.name, anim.t, fx, fy, o);
      }
      g.restore();
    }
    if (!drawn) this.drawPlaceholderPlayer(g, x, feet, dir, f.time, pa.alpha);

    // Magnet-Aura
    if (p.magnet > 0) {
      g.save();
      g.globalAlpha = p.magnet < 2 ? 0.4 : 0.7;
      g.strokeStyle = "#ff8f8f";
      g.lineWidth = 3;
      g.setLineDash([10, 16]);
      g.lineDashOffset = -f.time * 60;
      g.beginPath();
      g.arc(x, feet - (PLAYER_VISUAL_H / 2) * dir, 96 + Math.sin(f.time * 5) * 3, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
  }

  private drawPlaceholderPlayer(g: CanvasRenderingContext2D, x: number, feet: number, dir: 1 | -1, t: number, alpha: number): void {
    g.save();
    g.globalAlpha = alpha;
    const bob = Math.sin(t * 14) * 3;
    g.fillStyle = "#2aa6c9";
    roundedRectPath(g, x - 22, feet - PLAYER_H - bob * dir, 44, PLAYER_H, 16);
    g.fill();
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(x + 6, feet - PLAYER_H + 30, 5, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  /** Streifen-Bahnen (siehe speedLaneAt); Tempo bei Dash/Turbo mindestens auf voller Stärke. */
  private drawSpeedLines(g: CanvasRenderingContext2D, f: FrameData): void {
    const { view } = f;
    const v = view.dashing || view.turbo ? Math.max(view.speed, 1100) : view.speed;
    if (!(v > 520)) return;
    const style = speedLineStyle(f.sim.world.id);
    const lane = this.lane;
    const L = this.lanes;
    // Bahnen einmal berechnen (x, y, Länge, Deckkraft); unsichtbare und Bahnen außerhalb des Bildes entfallen
    let n = 0;
    for (let i = 0; i < SPEED_LANES; i += 1) {
      speedLaneAt(i, f.time, v, lane);
      const a = Math.min(1, lane.a * style.alpha * SPEED_LINE_GAIN);
      if (a <= 0.01 || lane.x > VIEW_W + 2 || lane.x + lane.len < -2) continue;
      L[n] = lane.x;
      L[n + 1] = lane.y;
      L[n + 2] = lane.len;
      L[n + 3] = a;
      n += 4;
    }
    if (n === 0) return;
    g.save();
    // Bahnen in voller Stärke (fast alle) pro Stufe in einem Pfad: Gegenkontur (1 px über/unter dem Streifen), dann der Streifen
    // in drei Stufen (Schweif transparent -> Kopf voll). Die eine Bahn, die gerade eingeblendet wird, zeichnet einzeln.
    for (let step = 0; step < 4; step += 1) {
      g.fillStyle = step === 0 ? style.outline : style.color;
      g.globalAlpha = step === 1 ? 0.45 : step === 2 ? 0.75 : 1;
      g.beginPath();
      for (let i = 0; i < n; i += 4) {
        if (L[i + 3] < 1) continue;
        const x = L[i];
        const y = L[i + 1];
        const third = L[i + 2] / 3;
        if (step === 0) g.rect(x - 1, y - 2, L[i + 2] + 2, 5);
        else g.rect(x + (3 - step) * third, y - 1, third, 3);
      }
      g.fill();
    }
    for (let i = 0; i < n; i += 4) {
      const a = L[i + 3];
      if (a >= 1) continue;
      const x = L[i];
      const y = L[i + 1];
      const third = L[i + 2] / 3;
      g.fillStyle = style.outline;
      g.globalAlpha = a;
      g.fillRect(x - 1, y - 2, L[i + 2] + 2, 5);
      g.fillStyle = style.color;
      g.globalAlpha = a * 0.45;
      g.fillRect(x + third * 2, y - 1, third, 3);
      g.globalAlpha = a * 0.75;
      g.fillRect(x + third, y - 1, third, 3);
      g.globalAlpha = a;
      g.fillRect(x, y - 1, third, 3);
    }
    g.restore();
  }

  /** Zeitlupen-Inszenierung mit Stärke `k` 0..1: Tönung (Alpha 0,18), Vignette +15 % und entsättigte Ränder in einem Overlay. */
  private drawSlowmo(g: CanvasRenderingContext2D, k: number): void {
    // Ein vorgerendertes Overlay (einmal in Zielgröße, dann 1:1 geblittet wie die Vignette): in der Mitte die violette Tönung
    // (Alpha 0,18, vorher 0,10), zum Rand hin ein graublauer Verlauf mit 45 % Deckkraft, der die Ränder zu Grau zieht
    // (Entsättigung) und abdunkelt (Vignette +15 %). Ein Mischmodus ("saturation") über die ganze Fläche kostet im
    // Software-Raster rund 7 ms pro Frame und ist deshalb nicht im Spiel.
    if (!this.slowEdge || this.slowEdge.width !== this.canvas.width || this.slowEdge.height !== this.canvas.height) {
      const c = document.createElement("canvas");
      c.width = this.canvas.width;
      c.height = this.canvas.height;
      const cg = c.getContext("2d");
      if (cg) {
        const cx = c.width / 2;
        const cy = c.height / 2;
        const rad = Math.hypot(cx, cy) * 1.02;
        const grd = cg.createRadialGradient(cx, cy, rad * 0.25, cx, cy, rad);
        grd.addColorStop(0, "rgba(120,110,255,0.18)");
        grd.addColorStop(1, "rgba(88,92,120,0.45)");
        cg.fillStyle = grd;
        cg.fillRect(0, 0, c.width, c.height);
      }
      this.slowEdge = c;
    }
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = k;
    g.drawImage(this.slowEdge, 0, 0);
    g.restore();
  }

  private drawPost(g: CanvasRenderingContext2D, f: FrameData): void {
    const { view } = f;
    // Geschwindigkeits-Streifen: feste Bahnen (y ändert sich nur beim Umbruch außerhalb des Bildes), ab Tempo 520, Länge und
    // Anzahl wachsen mit dem Tempo; in hellen Welten dunkle Linien mit heller Gegenkontur
    if (!this.reducedMotion && this.quality > 0) this.drawSpeedLines(g, f);
    // Vignette (einmal in Zielgröße vorgerendert und 1:1 geblittet – spart Skalierung pro Frame)
    if (!this.vignette || this.vignette.width !== this.canvas.width || this.vignette.height !== this.canvas.height) {
      const c = document.createElement("canvas");
      c.width = this.canvas.width;
      c.height = this.canvas.height;
      const cg = c.getContext("2d");
      if (cg) {
        const cx = c.width / 2;
        const cy = c.height / 2;
        const rad = Math.hypot(cx, cy) * 1.02;
        const grd = cg.createRadialGradient(cx, cy, rad * 0.32, cx, cy, rad);
        grd.addColorStop(0, "rgba(0,0,0,0)");
        grd.addColorStop(1, "rgba(0,0,0,0.42)");
        cg.fillStyle = grd;
        cg.fillRect(0, 0, c.width, c.height);
      }
      this.vignette = c;
    }
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.vignette, 0, 0);
    g.restore();
    // Zeitlupe: Tönung, stärkere Vignette und entsättigte Ränder, weich ein- und ausgeblendet (Rampe in update())
    if (this.slowK > 0.002) this.drawSlowmo(g, smoothstep(0, 1, this.slowK));
    // Treffer-Rand
    if (view.hurtGlow > 0.01) {
      const grd = g.createRadialGradient(VIEW_W / 2, VIEW_H / 2, 260, VIEW_W / 2, VIEW_H / 2, 760);
      grd.addColorStop(0, "rgba(255,0,0,0)");
      grd.addColorStop(1, `rgba(255,30,30,${0.55 * view.hurtGlow})`);
      g.fillStyle = grd;
      g.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    if (f.flash > 0.01) {
      g.fillStyle = rgba(f.flashColor, clamp(f.flash, 0, 1) * 0.85);
      g.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  }
}

const GATE_COLORS = ["#5b7cfa", "#39b26b", "#3aa0ff", "#ff4fa3", "#f2a33a", "#22e0ff", "#8fd3ff", "#f2c14e"];
const BACK = new Set(["decor", "wind", "speedzone", "zone", "portal"]);
const MID = new Set(["platform", "block", "overhead", "spring", "walker", "flyer", "projectile", "swinger"]);
const PICK = new Set(["pickup"]);

/** Interpolationsanteil 0..1 der Sicht (fehlt er oder ist er ungültig: 1 = aktueller Sim-Schritt, nicht interpolieren). */
export function viewAlpha(view: ViewState): number {
  const a = view.alpha;
  return a === undefined || !Number.isFinite(a) ? 1 : a < 0 ? 0 : a > 1 ? 1 : a;
}

/** Blitz-Stärke 0..1 der Sicht (Regler "Blitze", bei "Weniger Bewegung" höchstens 0,3); fehlt sie oder ist sie ungültig: 1. */
export function viewFlash(view: ViewState): number {
  const s = view.flashScale;
  return s === undefined || !Number.isFinite(s) ? 1 : s < 0 ? 0 : s > 1 ? 1 : s;
}

/** Position zwischen der vorigen (`prev`, fehlt = keine Interpolation) und der aktuellen Schrittposition; an den Enden exakt. */
export function lerpPos(prev: number | undefined, cur: number, alpha: number): number {
  return prev === undefined || alpha >= 1 ? cur : prev * (1 - alpha) + cur * alpha;
}

function powerupLabel(tag?: string): string {
  switch (tag) {
    case "magnet":
      return "Magnet!";
    case "shield":
      return "Schutzschild!";
    case "slowmo":
      return "Zeitlupe!";
    case "turbo":
      return "Turbo!";
    default:
      return "Power-up!";
  }
}

function roundedRectPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
