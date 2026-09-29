import type { GameAssets, CharacterSprites, AnimName } from "./assets";
import { PLAYER_H, PLAYER_SX, PLAYER_VISUAL_H, SPEED_MAX, VIEW_H, VIEW_W } from "./constants";
import { clamp, rgba } from "./draw-utils";
import { drawHud, type HudState } from "./hud";
import { Particles } from "./particles";
import { drawPickup } from "./pickups";
import type { Sim } from "./sim";
import type { Ent, SimEvent, ViewState, WorldRenderer } from "./types";
import { drawEntFallback } from "./worlds/basic";

export interface FrameData {
  sim: Sim;
  view: ViewState;
  /** Renderer der aktuellen Welt und (beim Tor-Übergang) der nächsten */
  current: WorldRenderer | null;
  next: WorldRenderer | null;
  /** Renderer-Lookup für Entitäten anhand der Welt-ID */
  rendererFor: (e: Ent) => WorldRenderer | null;
  hud: HudState | null;
  shakeX: number;
  shakeY: number;
  /** Zusätzliche weiße/farbige Überblendung (Blitz, Portal) */
  flash: number;
  flashColor: string;
  demo: boolean;
  /** Zeit für Animationen (Sek.), auch im Menü */
  time: number;
  showPlayer: boolean;
  /** Menü/Bereit-Modus: Figur in Idle-Pose */
  idle: boolean;
  /** Neuer Highscore: Figur tanzt */
  victory: boolean;
}

interface Ghost {
  x: number;
  y: number;
  frame: number;
  anim: AnimName;
  life: number;
}

export class Renderer {
  readonly particles = new Particles();
  private g: CanvasRenderingContext2D;
  private scale = 1;
  private dpr = 1;
  sprites: CharacterSprites | null = null;
  private vignette: HTMLCanvasElement | null = null;
  private ghosts: Ghost[] = [];
  private ghostT = 0;
  private dustT = 0;
  private jumpT = 0;
  private dblT = -10;
  private hurtT = -10;
  private landT = -10;
  private slideT = -10;
  private victoryT = 0;
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
    this.vignette = null;
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
      case "jump":
        this.jumpT = time;
        this.dust(px, feet, 8, dir);
        break;
      case "doublejump":
        this.dblT = time;
        for (let i = 0; i < 14; i += 1) {
          const a = (i / 14) * Math.PI * 2;
          P.emit({ x: px, y: feet - 60 * dir, vx: Math.cos(a) * 260, vy: Math.sin(a) * 200, life: 0.4, size: 4, color: "#ffffff", shape: "spark", additive: true });
        }
        P.emit({ x: px, y: feet - 50 * dir, life: 0.4, size: 20, grow: 220, shape: "ring", color: "#bdf3ff", additive: true });
        break;
      case "land": {
        this.landT = time;
        const n = Math.min(14, 5 + Math.floor((ev.value ?? 400) / 200));
        this.dust(px, feet, n, dir);
        break;
      }
      case "stomp-land":
        this.landT = time;
        P.emit({ x: px, y: feet, life: 0.5, size: 20, grow: 700, shape: "ring", color: "#ffffff", additive: true });
        for (let i = 0; i < 22; i += 1) {
          const s = i % 2 ? 1 : -1;
          P.emit({ x: px + s * 10, y: feet - 6 * dir, vx: s * (200 + Math.random() * 520), vy: -(60 + Math.random() * 240) * dir, ay: 900 * dir, life: 0.55, size: 6 + Math.random() * 6, color: "#e8eef7", drag: 1.4 });
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
        const x = ev.x;
        const y = ev.y;
        for (let i = 0; i < 6; i += 1) {
          const a = Math.random() * Math.PI * 2;
          P.emit({ x, y, vx: Math.cos(a) * 190, vy: Math.sin(a) * 190 - 40, life: 0.42, size: 3.4, color: "#ffe066", shape: "star", vr: 8, additive: true });
        }
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
          P.emit({ x: ev.x, y: ev.y, vx: Math.cos(a) * 380, vy: Math.sin(a) * 380 - 140, ay: 1400, life: 0.7, size: 6, color: i % 2 ? "#d9b38c" : "#a67c52", shape: "square", vr: 10 });
        }
        break;
      case "spring":
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

  private dust(x: number, feet: number, n: number, dir: 1 | -1): void {
    for (let i = 0; i < n; i += 1) {
      this.particles.emit({
        x: x + (Math.random() - 0.5) * 30,
        y: feet - 4 * dir,
        vx: -120 - Math.random() * 260,
        vy: -(20 + Math.random() * 110) * dir,
        life: 0.42,
        size: 4 + Math.random() * 5,
        grow: 26,
        color: "rgba(230,230,235,0.75)",
        drag: 2.2,
      });
    }
  }

  /** Pro Frame: Partikel + Laufstaub + Geisterbilder. */
  update(dt: number, sim: Sim, scroll: number): void {
    this.particles.update(dt, scroll);
    const p = sim.player;
    if (sim.phase === "running" && p.grounded && !p.sliding && this.quality > 0) {
      this.dustT -= dt;
      if (this.dustT <= 0) {
        this.dustT = clamp(0.16 - sim.speed / 10000, 0.05, 0.16);
        this.particles.emit({
          x: PLAYER_SX - 22,
          y: sim.feetY() - 3 * p.gravDir,
          vx: -90 - Math.random() * 90,
          vy: -(6 + Math.random() * 40) * p.gravDir,
          life: 0.36,
          size: 3 + Math.random() * 3,
          grow: 14,
          color: "rgba(235,235,240,0.55)",
          drag: 2.4,
        });
      }
    }
    if (p.slideT > 0 && p.sliding && this.quality > 0) {
      this.particles.emit({ x: PLAYER_SX - 30, y: sim.feetY() - 4 * p.gravDir, vx: -160, vy: -60 * p.gravDir, life: 0.3, size: 3, shape: "spark", color: "#ffd166", additive: true });
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
    for (const gh of this.ghosts) gh.life += dt;
    this.ghosts = this.ghosts.filter((gh) => gh.life < 0.28);
  }

  private pickAnim(f: FrameData): { name: AnimName; t: number; once?: boolean; frame?: number } {
    const sim = f.sim;
    const p = sim.player;
    const time = f.time;
    if (f.idle || sim.phase === "ready") return { name: "idle", t: time };
    if (f.victory && sim.phase === "over") return { name: "victory", t: time };
    if (sim.phase === "dying" || sim.phase === "over") return { name: "hurt", t: sim.deathT, once: true };
    if (p.stun > 0.05) return { name: "hurt", t: Math.max(0, time - this.hurtT), once: true };
    if (p.dashT > 0 || p.turbo > 0) return { name: "dash", t: time };
    if (p.stomping) return { name: "stomp", t: time };
    if (p.sliding) return { name: "slide", t: time };
    if (!p.grounded) {
      if (p.gliding && this.sprites?.has("glide")) return { name: "glide", t: time };
      const sinceDbl = time - this.dblT;
      if (p.jumpsUsed >= 2 && sinceDbl < 0.62 && p.vy > -200) return { name: "doublejump", t: sinceDbl, once: true };
      const sinceJump = time - this.jumpT;
      if (p.vy > 60) return { name: "jump", t: Math.max(0, sinceJump), once: true };
      if (this.sprites?.has("fall")) return { name: "fall", t: time };
      const jumpAnim = this.sprites?.resolve("jump");
      return { name: "jump", t: 0, frame: jumpAnim ? Math.floor(jumpAnim.frames * 0.55) : 0 };
    }
    const rate = 0.7 + clamp(sim.speed / SPEED_MAX, 0, 1) * 0.75;
    return { name: "run", t: time * rate };
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
    if (f.shakeX || f.shakeY) g.translate(f.shakeX, f.shakeY);

    // --- Hintergrund + Boden ---
    const blend = sim.nextGate ? sim.gateBlend : 0;
    const pits = sim.pitsOnScreen(view.dist);
    if (f.current) {
      f.current.drawBackground(g, view);
      if (blend > 0.001 && f.next) {
        g.globalAlpha = blend;
        f.next.drawBackground(g, view);
        g.globalAlpha = 1;
      }
      f.current.drawGround(g, view, pits);
      if (blend > 0.001 && f.next) {
        g.globalAlpha = blend;
        f.next.drawGround(g, view, pits);
        g.globalAlpha = 1;
      }
    } else {
      g.fillStyle = "#0e1226";
      g.fillRect(0, 0, VIEW_W, VIEW_H);
    }

    // --- Entitäten (3 Durchgänge) ---
    const ents = sim.ents;
    const pass = (kinds: ReadonlySet<string>): void => {
      for (const e of ents) {
        if (e.dead || !kinds.has(e.kind)) continue;
        const sx = e.x - view.dist;
        if (sx > VIEW_W + 260 || sx + e.w < -260) continue;
        this.drawEnt(g, f, e, sx, e.y);
      }
    };
    pass(BACK);
    pass(MID);
    pass(PICK);
    if (f.showPlayer) this.drawPlayer(g, f);
    this.particles.draw(g);
    if (f.current) {
      f.current.drawForeground(g, view);
      if (blend > 0.001 && f.next) {
        g.globalAlpha = blend;
        f.next.drawForeground(g, view);
        g.globalAlpha = 1;
      }
    }
    this.drawWarnMarkers(g, f);
    g.restore();

    // --- Post ---
    if (f.current?.drawOverlay) f.current.drawOverlay(g, view);
    this.drawPost(g, f);
    this.particles.drawPopups(g);
    if (f.hud) drawHud(g, f.hud);
  }

  private drawEnt(g: CanvasRenderingContext2D, f: FrameData, e: Ent, sx: number, sy: number): void {
    const r = f.rendererFor(e);
    if (r?.drawEntity(g, e, sx, sy, f.view)) return;
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
      props.draw(g, id, cx, feet + (e.y + e.h - feet), { h: e.h * 1.32, flipX: true, t: e.stateT, once: true });
      g.restore();
      return true;
    }
    const isAir = e.kind === "walker" && e.y + e.h < this.lastGroundY - 4;
    const id = isAir && props.has(`${e.skin}-jump`) ? `${e.skin}-jump` : run;
    // Schatten
    g.save();
    g.globalAlpha = 0.28;
    g.fillStyle = "#000";
    g.beginPath();
    g.ellipse(cx, this.lastGroundY + 6, e.w * 0.62, 8, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
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
    for (const e of sim.ents) {
      if (!e.warn || e.dead || e.state === "defeated") continue;
      const sx = e.x - view.dist;
      if (sx < VIEW_W - 12 || sx > VIEW_W + 1300) continue;
      const near = 1 - clamp((sx - VIEW_W) / 1300, 0, 1);
      const blink = 0.55 + 0.45 * Math.sin(f.time * (8 + near * 10));
      const y = clamp(e.y + e.h / 2, 90, VIEW_H - 120);
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

  private drawPlayer(g: CanvasRenderingContext2D, f: FrameData): void {
    const { sim, view } = f;
    const p = sim.player;
    const x = PLAYER_SX;
    const feet = view.playerFeetY;
    const dir = view.gravDir;
    const spr = this.sprites;
    const heightAboveSurface = Math.abs(feet - (dir === 1 ? view.groundY : view.ceilY));

    // Schatten
    {
      const surface = dir === 1 ? view.groundY : view.ceilY;
      const k = clamp(1 - heightAboveSurface / 420, 0.2, 1);
      g.save();
      g.globalAlpha = 0.32 * k;
      g.fillStyle = "#000";
      g.beginPath();
      g.ellipse(x - 4, surface + (dir === 1 ? 6 : -6), 46 * k + 6, 9 * k + 2, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }

    // Geisterbilder (Dash)
    if (spr && this.ghosts.length) {
      const a = this.pickAnim(f);
      for (const gh of this.ghosts) {
        const u = gh.life / 0.28;
        const gx = gh.x - (gh.life * (view.speed * 0.9)) ;
        g.save();
        g.globalCompositeOperation = "lighter";
        spr.draw(g, a.name, a.t, gx, gh.y, { alpha: 0.32 * (1 - u), flipY: dir === -1, frame: a.frame });
        g.restore();
      }
    }

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
    const blink = p.invuln > 0 && p.dashT <= 0 && p.turbo <= 0 && Math.floor(f.time * 16) % 2 === 0;
    const anim = this.pickAnim(f);
    let drawn = false;
    if (spr) {
      // Landungs-Squash
      const sinceLand = f.time - this.landT;
      const sq = sinceLand >= 0 && sinceLand < 0.14 ? 1 - 0.09 * Math.sin((sinceLand / 0.14) * Math.PI) : 1;
      g.save();
      if (sq !== 1) {
        g.translate(x, feet);
        g.scale(1 + (1 - sq) * 0.6, sq);
        g.translate(-x, -feet);
      }
      drawn = spr.draw(g, anim.name, anim.t, x, feet, { flipY: dir === -1, alpha: blink ? 0.35 : 1, once: anim.once, frame: anim.frame });
      g.restore();
    }
    if (!drawn) this.drawPlaceholderPlayer(g, x, feet, dir, f.time, blink);

    // Treffer-Glimmen
    if (view.hurtGlow > 0.01 && spr) {
      g.save();
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.35 * view.hurtGlow;
      spr.draw(g, anim.name, anim.t, x, feet, { flipY: dir === -1, once: anim.once, frame: anim.frame });
      g.restore();
    }

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

  private drawPlaceholderPlayer(g: CanvasRenderingContext2D, x: number, feet: number, dir: 1 | -1, t: number, blink: boolean): void {
    g.save();
    g.globalAlpha = blink ? 0.4 : 1;
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

  private drawPost(g: CanvasRenderingContext2D, f: FrameData): void {
    const { view } = f;
    // Geschwindigkeits-Streifen
    const speedK = clamp((view.speed - 700) / 500, 0, 1);
    if ((speedK > 0 || view.dashing || view.turbo) && !this.reducedMotion && this.quality > 0) {
      const n = view.dashing || view.turbo ? 14 : Math.round(speedK * 8);
      g.save();
      g.globalAlpha = view.dashing || view.turbo ? 0.35 : 0.16 * speedK;
      g.fillStyle = "#ffffff";
      for (let i = 0; i < n; i += 1) {
        const y = ((i * 97 + Math.floor(f.time * 30) * 41) % 620) + 40;
        const x = (((i * 331 - f.time * 1600) % (VIEW_W + 400)) + VIEW_W + 400) % (VIEW_W + 400) - 200;
        g.fillRect(x, y, 180 + (i % 3) * 60, 2);
      }
      g.restore();
    }
    // Vignette
    if (!this.vignette) {
      const c = document.createElement("canvas");
      c.width = 256;
      c.height = 144;
      const cg = c.getContext("2d");
      if (cg) {
        const grd = cg.createRadialGradient(128, 72, 40, 128, 72, 150);
        grd.addColorStop(0, "rgba(0,0,0,0)");
        grd.addColorStop(1, "rgba(0,0,0,0.42)");
        cg.fillStyle = grd;
        cg.fillRect(0, 0, 256, 144);
      }
      this.vignette = c;
    }
    g.drawImage(this.vignette, 0, 0, VIEW_W, VIEW_H);
    // Slow-Mo-Tönung
    if (view.slowmo) {
      g.fillStyle = "rgba(120,110,255,0.10)";
      g.fillRect(0, 0, VIEW_W, VIEW_H);
    }
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

const GATE_COLORS = ["#5b7cfa", "#39b26b", "#3aa0ff", "#ff4fa3", "#f2a33a", "#22e0ff"];
const BACK = new Set(["decor", "wind", "speedzone", "zone", "portal"]);
const MID = new Set(["platform", "block", "overhead", "spring", "walker", "flyer", "projectile", "swinger"]);
const PICK = new Set(["pickup"]);

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
