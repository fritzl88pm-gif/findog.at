/**
 * Fredrun 2.0 – Bühne der Charakterauswahl.
 *
 * Framework-freie Canvas-Szene (Lichtkegel, Podest, Funken, animierte Figur mit Bewegungs-Vorschau) und ein
 * statischer Portrait-Zeichner für die Roster-Kacheln. Genau eine rAF-Schleife pro Bühne; sie läuft nur, solange
 * die Seite sichtbar ist, und wird mit `destroy()` vollständig abgebaut.
 */
import { loadCharacter, type AnimName, type CharacterSprites } from "@/game/fredrun2/assets";
import type { CharacterPerks } from "@/game/fredrun2/characters";
import { PLAYER_VISUAL_H } from "@/game/fredrun2/constants";
import type { CharacterId } from "@/game/fredrun2/types";

/** Abspielbare Bewegungen (Chips unter der Bühne). */
export type ActionId = "run" | "jump" | "dash" | "stomp" | "slide" | "victory" | "glide";

export const ACTION_ORDER: readonly ActionId[] = ["run", "jump", "dash", "stomp", "slide", "victory", "glide"];

export const ACTION_LABEL: Record<ActionId, string> = {
  run: "Laufen",
  jump: "Springen",
  dash: "Dash",
  stomp: "Stampfen",
  slide: "Rutschen",
  victory: "Sieg",
  glide: "Gleiten",
};

const ACTION_ANIM: Record<ActionId, AnimName> = {
  run: "run",
  jump: "jump",
  dash: "dash",
  stomp: "stomp",
  slide: "slide",
  victory: "victory",
  glide: "glide",
};

export function availableActions(s: CharacterSprites): ActionId[] {
  return ACTION_ORDER.filter((a) => s.has(ACTION_ANIM[a]));
}

export interface StageHero {
  id: CharacterId;
  color: string;
  colorDark: string;
  perks: CharacterPerks;
}

// --- kleine Helfer ---------------------------------------------------------------------------------

type RGB = [number, number, number];

const TAU = Math.PI * 2;
const WHITE: RGB = [255, 255, 255];
const GOLD: RGB = [255, 214, 90];
const NIGHT: RGB = [5, 7, 18];

function hexRgb(c: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  const n = m ? parseInt(m[1], 16) : 0x808080;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function rgba(c: RGB, a: number): string {
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const rand = (a: number, b: number): number => a + Math.random() * (b - a);

function makeGlow(c: RGB): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = 48;
  cv.height = 48;
  const g = cv.getContext("2d");
  if (g) {
    const gr = g.createRadialGradient(24, 24, 0, 24, 24, 24);
    gr.addColorStop(0, rgba(c, 1));
    gr.addColorStop(0.3, rgba(c, 0.45));
    gr.addColorStop(1, rgba(c, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, 48, 48);
  }
  return cv;
}

function osPrefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

// --- Szene ----------------------------------------------------------------------------------------

const ENTER = 0.62; // Sekunden: neue Figur läuft ein
const EXIT = 0.34; // Sekunden: alte Figur läuft ab
const MAX_PARTICLES = 170;

interface Actor {
  hero: StageHero;
  sprites: CharacterSprites | null;
  locked: boolean;
  enterAt: number;
  exitAt: number;
}

interface Action {
  id: ActionId;
  t0: number;
  dur: number;
  fired: boolean;
}

interface Pose {
  anim: AnimName;
  at: number;
  once: boolean;
  /** Versatz in Pixeln (rechts positiv) */
  x: number;
  /** Höhe über dem Boden in Figur-Einheiten (150 = Figurhöhe) */
  y: number;
  sx: number;
  sy: number;
  alpha: number;
  trail: number;
}

const Kind = { Spark: 0, Dust: 1, Confetti: 2, Burst: 3, Streak: 4 } as const;
type Kind = (typeof Kind)[keyof typeof Kind];

interface Particle {
  k: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  age: number;
  life: number;
  rot: number;
  vr: number;
  a: number;
  spr: HTMLCanvasElement | null;
  c: RGB;
}

interface Ring {
  t0: number;
  dur: number;
  r: number;
  x: number;
  y: number;
  w: number;
  c: RGB;
}

/** Sprung-Physik der Vorschau (Figur-Einheiten). */
const JUMP_G = 2300;
const JUMP_V1 = 400;
const JUMP_V2 = 470;
const JUMP_TDJ = 0.3;
const STOMP_H = 52;
const STOMP_IMPACT = 0.62;

export class CharacterStage {
  onAction: ((a: ActionId | null) => void) | null = null;
  onAvailable: ((id: CharacterId, actions: ActionId[]) => void) | null = null;

  private readonly g: CanvasRenderingContext2D | null;
  private readonly ro: ResizeObserver;
  private readonly mq: MediaQueryList | null;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private cx = 0;
  private feetY = 0;
  private figH = 0;
  private u = 1;
  private podRx = 0;
  private podRy = 0;
  private raf = 0;
  private lastMs = 0;
  private t = 0;
  private dead = false;
  private seeded = false;
  private colored = false;
  private reducedProp = false;
  private reducedOs = false;
  private cur: Actor | null = null;
  private prev: Actor | null = null;
  private action: Action | null = null;
  private colC: RGB = [42, 166, 201];
  private colD: RGB = [12, 74, 94];
  private tgtC: RGB = [42, 166, 201];
  private tgtD: RGB = [12, 74, 94];
  private glowTint: HTMLCanvasElement | null = null;
  private readonly glowWhite: HTMLCanvasElement;
  private readonly glowGold: HTMLCanvasElement;
  private parts: Particle[] = [];
  private rings: Ring[] = [];
  private shake = 0;
  private acc = { streak: 0, dust: 0, spark: 0 };
  private layer: HTMLCanvasElement | null = null;
  private layerG: CanvasRenderingContext2D | null = null;
  private readonly store = new Map<CharacterId, { s: CharacterSprites; full: boolean }>();
  private readonly pose: Pose = { anim: "idle", at: 0, once: false, x: 0, y: 0, sx: 1, sy: 1, alpha: 1, trail: 0 };

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.g = canvas.getContext("2d");
    this.glowWhite = makeGlow(WHITE);
    this.glowGold = makeGlow(GOLD);
    this.mq = typeof window !== "undefined" ? (window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null) : null;
    this.reducedOs = osPrefersReducedMotion();
    this.mq?.addEventListener?.("change", this.onMq);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.ro = new ResizeObserver((entries) => {
      const r = entries[entries.length - 1]?.contentRect;
      if (!r) return;
      this.w = r.width;
      this.h = r.height;
      this.applySize();
    });
    this.ro.observe(canvas);
  }

  // --- öffentliche Schnittstelle ---

  private get reduced(): boolean {
    return this.reducedProp || this.reducedOs;
  }

  setReducedMotion(v: boolean): void {
    this.reducedProp = v;
  }

  start(): void {
    if (this.dead || this.raf || document.visibilityState === "hidden") return;
    this.lastMs = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  destroy(): void {
    this.dead = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.ro.disconnect();
    this.mq?.removeEventListener?.("change", this.onMq);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.parts = [];
    this.rings = [];
    this.cur = null;
    this.prev = null;
    this.layer = null;
    this.layerG = null;
    this.store.clear();
    this.onAction = null;
    this.onAvailable = null;
  }

  /** Zeigt eine Figur. Neue Figur → Übergang (alte läuft ab, neue läuft ein); gleiche Figur → nur Sperr-Zustand. */
  setHero(hero: StageHero, locked: boolean): void {
    if (this.dead) return;
    if (this.cur && this.cur.hero.id === hero.id) {
      const wasLocked = this.cur.locked;
      this.cur.locked = locked;
      if (wasLocked && !locked) this.celebrate();
      return;
    }
    const cached = this.store.get(hero.id);
    const prev = this.cur;
    this.prev = prev && prev.sprites ? { ...prev, exitAt: this.t } : null;
    this.cur = { hero, sprites: cached?.s ?? null, locked, enterAt: cached ? this.t : -1, exitAt: 0 };
    this.stopAction();
    this.tgtC = hexRgb(hero.color);
    this.tgtD = hexRgb(hero.colorDark);
    this.glowTint = makeGlow(mix(this.tgtC, WHITE, 0.35));
    if (!this.colored) {
      this.colored = true;
      this.colC = [...this.tgtC];
      this.colD = [...this.tgtD];
    }
    if (cached?.full) {
      void Promise.resolve().then(() => {
        if (!this.dead) this.onAvailable?.(hero.id, availableActions(cached.s));
      });
    } else {
      this.loadSprites(hero.id);
    }
  }

  /** Spielt eine Bewegung ab (erneuter Klick auf dieselbe beendet sie). */
  play(id: ActionId): void {
    const a = this.cur;
    if (!a?.sprites || this.dead) return;
    if (this.action?.id === id) {
      this.stopAction();
      return;
    }
    const s = a.sprites;
    if (!s.has(ACTION_ANIM[id])) return;
    a.enterAt = Math.min(a.enterAt, this.t - ENTER - 1); // Einlauf überspringen
    this.prev = null;
    this.action = { id, t0: this.t, dur: this.actionDuration(id, s, a.hero.perks), fired: false };
    this.onAction?.(id);
    if (id === "victory") this.burst(0.55);
    if (id === "jump") this.dust(this.cx, this.feetY, 5);
  }

  stopAction(): void {
    if (!this.action) return;
    this.action = null;
    this.onAction?.(null);
  }

  /** Freischalt-Feier: Konfetti, Lichtring, Siegerpose. */
  celebrate(): void {
    this.burst(1);
    this.addRing(this.cx, this.feetY, this.w * 0.42, 0.9, GOLD, 5);
    this.shake = Math.max(this.shake, 0.5);
    if (this.cur?.sprites?.has("victory")) this.play("victory");
  }

  // --- Laden ---

  private loadSprites(id: CharacterId): void {
    void loadCharacter(id, ["idle", "run"])
      .then((s) => {
        if (this.dead) return;
        if (!this.store.has(id)) this.store.set(id, { s, full: false });
        this.attach(id, s, false);
        return loadCharacter(id);
      })
      .then((full) => {
        if (this.dead || !full) return;
        this.store.set(id, { s: full, full: true });
        this.attach(id, full, true);
      })
      .catch(() => undefined);
  }

  private attach(id: CharacterId, s: CharacterSprites, full: boolean): void {
    const cur = this.cur;
    if (cur && cur.hero.id === id) {
      cur.sprites = s;
      if (cur.enterAt < 0) cur.enterAt = this.t;
      if (full) this.onAvailable?.(id, availableActions(s));
    }
  }

  // --- Größe ---

  private onMq = (): void => {
    this.reducedOs = osPrefersReducedMotion();
  };

  private onVisibility = (): void => {
    if (document.visibilityState === "hidden") {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else {
      this.start();
    }
  };

  private applySize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    const pw = Math.max(1, Math.round(this.w * dpr));
    const ph = Math.max(1, Math.round(this.h * dpr));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    if (this.layer && (this.layer.width !== pw || this.layer.height !== ph)) {
      this.layer.width = pw;
      this.layer.height = ph;
    }
    this.cx = this.w * 0.5;
    this.feetY = this.h * 0.665;
    this.figH = Math.min(this.h * 0.55, this.w * 0.68);
    this.u = this.figH / PLAYER_VISUAL_H;
    this.podRx = Math.min(this.w * 0.37, this.figH * 0.9);
    this.podRy = this.podRx * 0.17;
    if (!this.seeded && this.w > 10) {
      this.seeded = true;
      const n = this.reduced ? 6 : 24;
      for (let i = 0; i < n; i++) this.spawnSpark(true);
    }
  }

  // --- Schleife ---

  private tick = (ms: number): void => {
    if (this.dead) return;
    const dt = Math.min(0.05, Math.max(0, (ms - this.lastMs) / 1000));
    this.lastMs = ms;
    if (Math.min(2, window.devicePixelRatio || 1) !== this.dpr) this.applySize();
    this.update(dt);
    this.draw();
    this.raf = requestAnimationFrame(this.tick);
  };

  // --- Aktionen ---

  private actionDuration(id: ActionId, s: CharacterSprites, perks: CharacterPerks): number {
    const loops = (anim: AnimName, n: number, min: number): number => {
      const a = s.resolve(anim);
      return a ? Math.max(min, (n * a.frames) / Math.max(1, a.fps)) : min;
    };
    switch (id) {
      case "run":
        return loops("run", 4, 2.4);
      case "slide":
        return loops("slide", 3, 2.2);
      case "victory":
        return loops("victory", 2, 3);
      case "glide":
        return 3.2;
      case "dash":
        return 1.7 * perks.dashTimeScale;
      case "jump":
        return this.jumpPlan(s).land + 0.32;
      case "stomp":
        return 1.4;
    }
  }

  private jumpPlan(s: CharacterSprites): { land: number; y0: number; double: boolean } {
    if (s.has("doublejump")) {
      const y0 = JUMP_V1 * JUMP_TDJ - 0.5 * JUMP_G * JUMP_TDJ * JUMP_TDJ;
      const land = JUMP_TDJ + (JUMP_V2 + Math.sqrt(JUMP_V2 * JUMP_V2 + 2 * JUMP_G * y0)) / JUMP_G;
      return { land, y0, double: true };
    }
    return { land: (2 * (JUMP_V1 + 90)) / JUMP_G, y0: 0, double: false };
  }

  // --- Update ---

  private update(dt: number): void {
    this.t += dt;
    const red = this.reduced;
    const k = 1 - Math.exp(-dt * 5);
    for (let i = 0; i < 3; i++) {
      this.colC[i] += (this.tgtC[i] - this.colC[i]) * k;
      this.colD[i] += (this.tgtD[i] - this.colD[i]) * k;
    }
    if (this.prev && this.t - this.prev.exitAt > EXIT) this.prev = null;
    this.shake = Math.max(0, this.shake - dt * 2.4);

    const cur = this.cur;
    const act = this.action;
    if (act && cur) {
      const e = this.t - act.t0;
      if (act.id === "stomp" && !act.fired && e >= STOMP_IMPACT) {
        act.fired = true;
        const scale = cur.hero.perks.stompRadius / 110;
        this.addRing(this.cx, this.feetY, this.w * 0.2 * scale, 0.75, mix(this.colC, WHITE, 0.4), 6);
        this.addRing(this.cx, this.feetY, this.w * 0.12 * scale, 0.5, WHITE, 3);
        if (!red) this.shake = 0.7;
        this.dust(this.cx - 20, this.feetY, 7);
        this.dust(this.cx + 20, this.feetY, 7);
      }
      if (e >= act.dur) this.stopAction();
      else if (!red) {
        const id = act.id;
        if (id === "run" || id === "dash") this.spawnStreaks(dt, id === "dash" ? 70 : 34, id === "dash" ? 1.5 : 1);
        if (id === "slide") this.spawnDust(dt, 26);
        if (id === "run") this.spawnDust(dt, 9);
        if (id === "glide") this.spawnGlideTrail(dt);
      }
    } else if (cur && cur.sprites && !red && this.t - cur.enterAt < ENTER && cur.enterAt >= 0) {
      const e = clamp01((this.t - cur.enterAt) / ENTER);
      const x = this.cx - this.w * 0.62 * Math.pow(1 - e, 3);
      this.acc.dust += dt * 46;
      while (this.acc.dust >= 1) {
        this.acc.dust -= 1;
        this.dust(x - 24, this.feetY, 1);
      }
    }
    if (this.prev && !red) {
      const e = clamp01((this.t - this.prev.exitAt) / EXIT);
      this.acc.dust += dt * 40;
      while (this.acc.dust >= 1) {
        this.acc.dust -= 1;
        this.dust(this.cx + e * e * this.w * 0.6 - 24, this.feetY, 1);
      }
    }

    // Umgebungs-Funken nachfüllen
    const want = red ? 6 : 24;
    let sparks = 0;
    for (const p of this.parts) if (p.k === Kind.Spark) sparks++;
    if (sparks < want && this.w > 10) {
      this.acc.spark += dt * 9;
      while (this.acc.spark >= 1 && sparks < want) {
        this.acc.spark -= 1;
        this.spawnSpark(false);
        sparks++;
      }
    }

    // Partikel bewegen
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.parts[i] = this.parts[this.parts.length - 1];
        this.parts.pop();
        continue;
      }
      switch (p.k) {
        case Kind.Spark:
          if (!red) {
            p.x += (p.vx + Math.sin(this.t * 0.9 + p.rot) * 7) * dt;
            p.y += p.vy * dt;
          }
          break;
        case Kind.Dust:
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.r += 16 * dt;
          break;
        case Kind.Confetti:
          p.vy += 560 * dt;
          p.vx *= 1 - 0.6 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.rot += p.vr * dt;
          break;
        case Kind.Burst:
          p.vy += 320 * dt;
          p.vx *= 1 - 1.4 * dt;
          p.vy *= 1 - 0.6 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          break;
        case Kind.Streak:
          p.x += p.vx * dt;
          break;
      }
    }
    this.rings = this.rings.filter((r) => this.t - r.t0 < r.dur);
  }

  // --- Partikel-Erzeuger ---

  private push(p: Particle): void {
    if (this.parts.length < MAX_PARTICLES) this.parts.push(p);
  }

  private spawnSpark(prewarm: boolean): void {
    const s = this.w / 552;
    const life = rand(4.5, 9);
    this.push({
      k: Kind.Spark,
      x: this.cx + rand(-1, 1) * this.podRx * 1.05,
      y: this.feetY + this.podRy * rand(-0.8, 1.2) - rand(0, 1) * this.figH * rand(0.4, 1.25),
      vx: rand(-4, 4),
      vy: -rand(9, 26) * s,
      r: rand(1.3, 3.6) * Math.max(0.6, s),
      age: prewarm ? rand(0, life * 0.9) : 0,
      life,
      rot: rand(0, TAU),
      vr: 0,
      a: rand(0.5, 1),
      spr: Math.random() < 0.28 ? this.glowWhite : this.glowTint,
      c: WHITE,
    });
  }

  private dust(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i++) {
      this.push({
        k: Kind.Dust,
        x: x + rand(-8, 8),
        y: y + rand(-3, 6),
        vx: rand(-70, -10),
        vy: rand(-26, -4),
        r: rand(2.5, 5.5),
        age: 0,
        life: rand(0.35, 0.65),
        rot: 0,
        vr: 0,
        a: rand(0.35, 0.6),
        spr: null,
        c: WHITE,
      });
    }
  }

  private spawnDust(dt: number, rate: number): void {
    this.acc.dust += dt * rate;
    while (this.acc.dust >= 1) {
      this.acc.dust -= 1;
      this.dust(this.cx - this.figH * 0.14, this.feetY, 1);
    }
  }

  private spawnStreaks(dt: number, rate: number, speed: number): void {
    this.acc.streak += dt * rate;
    const s = this.w / 552;
    while (this.acc.streak >= 1) {
      this.acc.streak -= 1;
      const len = rand(60, 170) * s;
      const vx = -rand(780, 1250) * speed * s;
      this.push({
        k: Kind.Streak,
        x: this.w + 12,
        y: rand(this.h * 0.18, this.feetY + this.podRy),
        vx,
        vy: 0,
        r: len,
        age: 0,
        life: (this.w + len + 24) / Math.abs(vx),
        rot: 0,
        vr: 0,
        a: rand(0.16, 0.42),
        spr: null,
        c: Math.random() < 0.5 ? mix(this.colC, WHITE, 0.55) : WHITE,
      });
    }
  }

  private spawnGlideTrail(dt: number): void {
    this.acc.dust += dt * 22;
    while (this.acc.dust >= 1) {
      this.acc.dust -= 1;
      this.push({
        k: Kind.Burst,
        x: this.cx - this.figH * 0.22 + rand(-10, 10),
        y: this.feetY - this.figH * 0.72 - rand(0, this.figH * 0.3),
        vx: rand(-90, -30),
        vy: rand(-12, 16),
        r: rand(1.4, 3),
        age: 0,
        life: rand(0.6, 1.1),
        rot: 0,
        vr: 0,
        a: rand(0.5, 0.9),
        spr: this.glowTint,
        c: WHITE,
      });
    }
  }

  private burst(strength: number): void {
    const s = Math.max(0.6, this.w / 552);
    const n = Math.round((this.reduced ? 14 : 46) * strength);
    const cx = this.cx;
    const cy = this.feetY - this.figH * 0.5;
    for (let i = 0; i < n; i++) {
      const ang = rand(0, TAU);
      const sp = rand(140, 440) * s * (0.6 + strength * 0.5);
      const pick = Math.random();
      this.push({
        k: Kind.Burst,
        x: cx,
        y: cy,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 120 * s,
        r: rand(2, 4.6) * s,
        age: 0,
        life: rand(0.8, 1.5),
        rot: 0,
        vr: 0,
        a: 1,
        spr: pick < 0.4 ? this.glowGold : pick < 0.75 ? this.glowTint : this.glowWhite,
        c: WHITE,
      });
    }
    const conf = this.reduced ? 0 : Math.round(36 * strength);
    const palette: RGB[] = [this.colC, mix(this.colC, WHITE, 0.55), GOLD, WHITE, mix(this.colD, WHITE, 0.4)];
    for (let i = 0; i < conf; i++) {
      this.push({
        k: Kind.Confetti,
        x: cx + rand(-30, 30),
        y: cy - rand(0, 60),
        vx: rand(-260, 260) * s,
        vy: -rand(180, 520) * s,
        r: rand(3, 6) * s,
        age: 0,
        life: rand(1.3, 2.3),
        rot: rand(0, TAU),
        vr: rand(-9, 9),
        a: 1,
        spr: null,
        c: palette[i % palette.length],
      });
    }
  }

  private addRing(x: number, y: number, r: number, dur: number, c: RGB, w: number): void {
    this.rings.push({ t0: this.t, dur, r, x, y, w, c });
  }

  // --- Pose ---

  private poseFor(a: Actor, exiting: boolean): Pose {
    const p = this.pose;
    const t = this.t;
    const red = this.reduced;
    p.anim = "idle";
    p.at = red ? 0 : t;
    p.once = false;
    p.x = 0;
    p.y = 0;
    p.sx = 1;
    p.sy = 1;
    p.alpha = 1;
    p.trail = 0;

    if (exiting) {
      const e = clamp01((t - a.exitAt) / EXIT);
      if (red) {
        p.alpha = 1 - e;
        return p;
      }
      p.anim = "run";
      p.at = t;
      p.x = e * e * this.w * 0.6;
      p.alpha = 1 - e * e * 0.9;
      return p;
    }

    const act = this.action;
    if (act) {
      this.poseAction(p, act, a);
      return p;
    }

    const e = (t - a.enterAt) / ENTER;
    if (e < 1) {
      if (red) {
        p.alpha = clamp01(e * 3);
        return p;
      }
      const ease = 1 - Math.pow(1 - e, 3);
      p.anim = "run";
      p.at = t - a.enterAt;
      p.x = -this.w * 0.62 * (1 - ease);
      return p;
    }
    const since = t - a.enterAt - ENTER;
    if (since < 0.34 && !red) {
      const env = Math.exp(-since * 13) * Math.cos(since * 22);
      p.sy = 1 - 0.07 * env;
      p.sx = 1 + 0.05 * env;
    }
    if (!red) p.at = t - a.enterAt;
    return p;
  }

  private poseAction(p: Pose, act: Action, a: Actor): void {
    const e = this.t - act.t0;
    const red = this.reduced;
    const perks = a.hero.perks;
    const env = Math.min(1, e / 0.18) * Math.min(1, Math.max(0, (act.dur - e) / 0.25));
    switch (act.id) {
      case "run":
        p.anim = "run";
        p.at = e;
        break;
      case "slide":
        p.anim = "slide";
        p.at = e;
        break;
      case "victory":
        p.anim = "victory";
        p.at = e;
        break;
      case "dash":
        p.anim = "dash";
        p.at = e;
        if (!red) {
          p.x = 12 * env;
          p.y = 11 * perks.dashHover * env;
          p.trail = Math.round(2 + perks.dashTimeScale * 1.5);
        }
        break;
      case "glide": {
        p.anim = "glide";
        p.at = e;
        if (!red) {
          p.y = 24 * env + Math.sin(e * 2.6) * 3 * env;
          p.x = Math.sin(e * 1.7) * 9 * env;
        }
        break;
      }
      case "jump": {
        const plan = this.jumpPlan(a.sprites as CharacterSprites);
        let y: number;
        if (plan.double) {
          if (e < JUMP_TDJ) {
            y = JUMP_V1 * e - 0.5 * JUMP_G * e * e;
            p.anim = "jump";
            p.at = e;
          } else {
            const s = e - JUMP_TDJ;
            y = plan.y0 + JUMP_V2 * s - 0.5 * JUMP_G * s * s;
            p.anim = "doublejump";
            p.at = s;
            p.once = true;
          }
        } else {
          const v = JUMP_V1 + 90;
          y = v * e - 0.5 * JUMP_G * e * e;
          p.anim = e < v / JUMP_G ? "jump" : "fall";
          p.at = e < v / JUMP_G ? e : e - v / JUMP_G;
        }
        if (e >= plan.land) {
          const since = e - plan.land;
          y = 0;
          p.anim = "idle";
          p.at = 0;
          if (!red) {
            const sq = Math.exp(-since * 11);
            p.sy = 1 - 0.13 * sq;
            p.sx = 1 + 0.09 * sq;
          }
          if (!act.fired) {
            act.fired = true;
            this.dust(this.cx, this.feetY, 6);
          }
        }
        p.y = red ? 0 : Math.max(0, y);
        break;
      }
      case "stomp": {
        const rise = 0.3;
        const hang = 0.46;
        if (e < rise) {
          const s = e / rise;
          p.anim = "jump";
          p.at = e;
          p.y = STOMP_H * Math.sin((s * Math.PI) / 2);
        } else if (e < hang) {
          p.anim = "stomp";
          p.at = e - rise;
          p.y = STOMP_H;
        } else if (e < STOMP_IMPACT) {
          const s = (e - hang) / (STOMP_IMPACT - hang);
          p.anim = "stomp";
          p.at = e - rise;
          p.y = STOMP_H * (1 - s * s);
        } else {
          const since = e - STOMP_IMPACT;
          p.anim = "stomp";
          p.at = e - rise;
          p.y = 0;
          const sq = Math.exp(-since * 9);
          p.sy = 1 - 0.15 * sq;
          p.sx = 1 + 0.1 * sq;
        }
        if (red) {
          p.y = 0;
          p.sx = 1;
          p.sy = 1;
        }
        break;
      }
    }
  }

  // --- Zeichnen ---

  private draw(): void {
    const g = this.g;
    if (!g || this.w < 4 || this.h < 4) return;
    const { w, h, dpr } = this;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";

    g.save();
    if (this.shake > 0.01 && !this.reduced) {
      const m = this.shake * this.shake * 9;
      g.translate(rand(-m, m), rand(-m, m));
    }
    this.drawBackground(g);
    this.drawBeam(g);
    this.drawPodium(g);
    this.drawRings(g);
    const prev = this.prev;
    if (prev?.sprites) this.drawActor(g, prev, true);
    const cur = this.cur;
    if (cur?.sprites && cur.enterAt >= 0) this.drawActor(g, cur, false);
    else this.drawLoading(g);
    this.drawParticles(g);
    g.restore();

    // Vignette
    const vg = g.createRadialGradient(w / 2, h * 0.46, Math.min(w, h) * 0.32, w / 2, h * 0.46, Math.max(w, h) * 0.78);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.6)");
    g.fillStyle = vg;
    g.fillRect(0, 0, w, h);
  }

  private drawBackground(g: CanvasRenderingContext2D): void {
    const { w, h, cx, feetY, figH } = this;
    const c = this.colC;
    const d = this.colD;
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, rgba(mix(d, NIGHT, 0.5), 1));
    bg.addColorStop(0.62, rgba(mix(d, NIGHT, 0.3), 1));
    bg.addColorStop(1, rgba(mix(d, NIGHT, 0.72), 1));
    g.fillStyle = bg;
    g.fillRect(-12, -12, w + 24, h + 24);

    // Farb-Aura hinter der Figur
    const ay = feetY - figH * 0.5;
    const aura = g.createRadialGradient(cx, ay, 0, cx, ay, w * 0.78);
    aura.addColorStop(0, rgba(c, 0.5));
    aura.addColorStop(0.45, rgba(c, 0.16));
    aura.addColorStop(1, rgba(c, 0));
    g.fillStyle = aura;
    g.fillRect(-12, -12, w + 24, h + 24);

    // sanftes Bokeh
    if (this.glowTint) {
      g.globalCompositeOperation = "lighter";
      const t = this.reduced ? 0 : this.t;
      for (let i = 0; i < 7; i++) {
        const fx = ((i * 0.377 + 0.11) % 1) * w;
        const fy = ((i * 0.529 + 0.07) % 0.62) * h;
        const r = (0.05 + ((i * 0.37) % 0.08)) * w * 2;
        g.globalAlpha = 0.09 + 0.05 * Math.sin(t * 0.3 + i * 1.7);
        g.drawImage(this.glowTint, fx + Math.sin(t * 0.11 + i) * 14 - r, fy + Math.cos(t * 0.09 + i * 2) * 10 - r, r * 2, r * 2);
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
  }

  private drawBeam(g: CanvasRenderingContext2D): void {
    const { cx, w, feetY, podRx } = this;
    const sway = this.reduced ? 0 : Math.sin(this.t * 0.45) * w * 0.014;
    const tint = mix(this.colC, WHITE, 0.6);
    g.globalCompositeOperation = "lighter";
    for (let l = 0; l < 3; l++) {
      const topW = w * (0.04 + 0.032 * l);
      const botW = podRx * (0.6 + 0.24 * l);
      const a = 0.095 - l * 0.024;
      const gr = g.createLinearGradient(0, 0, 0, feetY);
      gr.addColorStop(0, rgba(tint, a * 1.4));
      gr.addColorStop(0.6, rgba(tint, a * 0.55));
      gr.addColorStop(1, rgba(tint, a * 0.3));
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(cx - topW + sway, -8);
      g.lineTo(cx + topW + sway, -8);
      g.lineTo(cx + botW, feetY);
      g.lineTo(cx - botW, feetY);
      g.closePath();
      g.fill();
    }
    g.globalCompositeOperation = "source-over";
  }

  private drawPodium(g: CanvasRenderingContext2D): void {
    const { cx, feetY: cy, podRx: rx, podRy: ry } = this;
    const th = this.h * 0.034;
    const c = this.colC;
    const d = this.colD;

    // Boden-Glow
    g.save();
    g.translate(cx, cy + ry * 0.5);
    g.scale(1, 0.27);
    const fg = g.createRadialGradient(0, 0, 0, 0, 0, rx * 1.6);
    fg.addColorStop(0, rgba(c, 0.6));
    fg.addColorStop(0.5, rgba(c, 0.2));
    fg.addColorStop(1, rgba(c, 0));
    g.globalCompositeOperation = "lighter";
    g.fillStyle = fg;
    g.beginPath();
    g.arc(0, 0, rx * 1.6, 0, TAU);
    g.fill();
    g.restore();

    // Zylinderwand
    const side = g.createLinearGradient(cx - rx, 0, cx + rx, 0);
    side.addColorStop(0, rgba(mix(d, NIGHT, 0.6), 1));
    side.addColorStop(0.5, rgba(mix(d, c, 0.3), 1));
    side.addColorStop(1, rgba(mix(d, NIGHT, 0.6), 1));
    g.fillStyle = side;
    g.fillRect(cx - rx, cy, rx * 2, th);
    g.beginPath();
    g.ellipse(cx, cy + th, rx, ry, 0, 0, Math.PI);
    g.fill();
    // Leuchtkante unten
    g.strokeStyle = rgba(c, 0.55);
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(cx, cy + th, rx, ry, 0, 0.02, Math.PI - 0.02);
    g.stroke();

    // Deckfläche
    g.save();
    g.translate(cx, cy);
    g.scale(1, ry / rx);
    const top = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    top.addColorStop(0, rgba(mix(c, WHITE, 0.4), 0.96));
    top.addColorStop(0.5, rgba(mix(c, d, 0.55), 0.98));
    top.addColorStop(1, rgba(mix(d, NIGHT, 0.45), 1));
    g.fillStyle = top;
    g.beginPath();
    g.arc(0, 0, rx, 0, TAU);
    g.fill();
    g.restore();

    // Rand-Leuchten
    g.strokeStyle = rgba(mix(c, WHITE, 0.6), 0.95);
    g.lineWidth = 2.5;
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    g.stroke();
    g.globalCompositeOperation = "lighter";
    g.strokeStyle = rgba(c, 0.22);
    g.lineWidth = 9;
    g.stroke();
    g.globalCompositeOperation = "source-over";

    // rotierender Innenring
    g.save();
    g.strokeStyle = rgba(mix(c, WHITE, 0.7), 0.5);
    g.lineWidth = 1.6;
    g.setLineDash([9, 13]);
    const spin = this.action?.id === "run" || this.action?.id === "dash" ? 90 : 16;
    g.lineDashOffset = this.reduced ? 0 : -this.t * spin;
    g.beginPath();
    g.ellipse(cx, cy, rx * 0.78, ry * 0.78, 0, 0, TAU);
    g.stroke();
    g.restore();

    // Puls-Ring
    if (!this.reduced) {
      const e = (this.t % 2.8) / 2.8;
      g.strokeStyle = rgba(mix(c, WHITE, 0.5), (1 - e) * 0.5);
      g.lineWidth = 2;
      g.beginPath();
      g.ellipse(cx, cy, rx * (0.5 + 0.8 * e), ry * (0.5 + 0.8 * e), 0, 0, TAU);
      g.stroke();
    }
  }

  private drawRings(g: CanvasRenderingContext2D): void {
    for (const r of this.rings) {
      const e = clamp01((this.t - r.t0) / r.dur);
      const ease = 1 - Math.pow(1 - e, 2.4);
      const rad = r.r * (0.15 + 0.85 * ease);
      g.globalCompositeOperation = "lighter";
      g.strokeStyle = rgba(r.c, Math.pow(1 - e, 1.4) * 0.9);
      g.lineWidth = Math.max(0.5, r.w * (1 - e * 0.7));
      g.beginPath();
      g.ellipse(r.x, r.y, rad, rad * 0.2, 0, 0, TAU);
      g.stroke();
    }
    g.globalCompositeOperation = "source-over";
  }

  private drawLoading(g: CanvasRenderingContext2D): void {
    const y = this.feetY - this.figH * 0.4;
    g.save();
    g.translate(this.cx, y);
    g.rotate(this.t * 4);
    g.strokeStyle = rgba(mix(this.colC, WHITE, 0.6), 0.85);
    g.lineWidth = 4;
    g.lineCap = "round";
    g.beginPath();
    g.arc(0, 0, 20, 0, Math.PI * 1.4);
    g.stroke();
    g.restore();
  }

  private drawActor(g: CanvasRenderingContext2D, a: Actor, exiting: boolean): void {
    const s = a.sprites;
    if (!s) return;
    const p = this.poseFor(a, exiting);
    const u = this.u;
    const fx = this.cx + p.x;
    const fy = this.feetY - p.y * u;

    // Schatten
    const lift = 1 - Math.min(1, p.y / 110) * 0.55;
    g.fillStyle = `rgba(0,0,0,${(0.42 * lift * p.alpha).toFixed(3)})`;
    g.beginPath();
    g.ellipse(fx, this.feetY + 3, this.figH * 0.21 * lift, this.figH * 0.045 * lift, 0, 0, TAU);
    g.fill();

    // Nachbilder (Dash)
    for (let i = p.trail; i >= 1; i--) {
      const dx = this.figH * 0.13 * i;
      this.paintFigure(g, a, s, p, fx - dx, fy, p.at - i * 0.04, p.alpha * (0.34 / (i * 0.9 + 0.3)) * 0.8);
    }
    this.paintFigure(g, a, s, p, fx, fy, p.at, p.alpha);
  }

  private paintFigure(g: CanvasRenderingContext2D, a: Actor, s: CharacterSprites, p: Pose, x: number, y: number, at: number, alpha: number): void {
    const u = this.u;
    if (!a.locked) {
      g.save();
      g.translate(x, y);
      g.scale(u * p.sx, u * p.sy);
      g.imageSmoothingQuality = "high";
      s.draw(g, p.anim, Math.max(0, at), 0, 0, { once: p.once, alpha });
      g.restore();
      return;
    }
    // gesperrt: dunkle Silhouette über eine Zwischenebene
    const layer = this.ensureLayer();
    const lg = this.layerG;
    if (!layer || !lg) return;
    lg.setTransform(1, 0, 0, 1, 0, 0);
    lg.globalCompositeOperation = "source-over";
    lg.globalAlpha = 1;
    lg.clearRect(0, 0, layer.width, layer.height);
    lg.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    lg.save();
    lg.translate(x, y);
    lg.scale(u * p.sx, u * p.sy);
    lg.imageSmoothingQuality = "high";
    s.draw(lg, p.anim, Math.max(0, at), 0, 0, { once: p.once });
    lg.restore();
    lg.setTransform(1, 0, 0, 1, 0, 0);
    lg.globalCompositeOperation = "source-atop";
    const gr = lg.createLinearGradient(0, 0, 0, layer.height);
    gr.addColorStop(0, "rgba(58,72,128,0.93)");
    gr.addColorStop(0.7, "rgba(14,18,42,0.95)");
    gr.addColorStop(1, "rgba(6,8,22,0.97)");
    lg.fillStyle = gr;
    lg.fillRect(0, 0, layer.width, layer.height);
    lg.globalCompositeOperation = "source-over";
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = alpha;
    g.drawImage(layer, 0, 0);
    g.restore();
  }

  private ensureLayer(): HTMLCanvasElement | null {
    if (!this.layer) {
      this.layer = document.createElement("canvas");
      this.layer.width = this.canvas.width;
      this.layer.height = this.canvas.height;
      this.layerG = this.layer.getContext("2d");
    }
    return this.layer;
  }

  private drawParticles(g: CanvasRenderingContext2D): void {
    for (const p of this.parts) {
      const e = p.age / p.life;
      switch (p.k) {
        case Kind.Spark: {
          if (!p.spr) break;
          const env = Math.sin(Math.PI * e);
          const tw = this.reduced ? 0.75 + 0.25 * Math.sin(this.t * 1.4 + p.rot) : 1;
          g.globalCompositeOperation = "lighter";
          g.globalAlpha = p.a * env * tw;
          const s = p.r * 4;
          g.drawImage(p.spr, p.x - s, p.y - s, s * 2, s * 2);
          break;
        }
        case Kind.Burst: {
          if (!p.spr) break;
          g.globalCompositeOperation = "lighter";
          g.globalAlpha = p.a * (1 - e) * (1 - e);
          const s = p.r * (4 - e * 2);
          g.drawImage(p.spr, p.x - s, p.y - s, s * 2, s * 2);
          break;
        }
        case Kind.Dust: {
          g.globalCompositeOperation = "source-over";
          g.globalAlpha = p.a * (1 - e) * 0.55;
          g.fillStyle = "rgb(206,218,255)";
          g.beginPath();
          g.arc(p.x, p.y, p.r, 0, TAU);
          g.fill();
          break;
        }
        case Kind.Confetti: {
          g.globalCompositeOperation = "source-over";
          g.globalAlpha = Math.min(1, (1 - e) * 2.2);
          g.fillStyle = rgba(p.c, 1);
          g.save();
          g.translate(p.x, p.y);
          g.rotate(p.rot);
          g.scale(1, Math.cos(p.rot * 2.3));
          g.fillRect(-p.r * 0.8, -p.r * 0.45, p.r * 1.6, p.r * 0.9);
          g.restore();
          break;
        }
        case Kind.Streak: {
          g.globalCompositeOperation = "lighter";
          g.globalAlpha = p.a;
          const gr = g.createLinearGradient(p.x, 0, p.x + p.r, 0);
          gr.addColorStop(0, rgba(p.c, 0));
          gr.addColorStop(1, rgba(p.c, 0.9));
          g.fillStyle = gr;
          g.fillRect(p.x, p.y, p.r, 1.6);
          break;
        }
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
}

// --- Portrait (Roster-Kacheln) -----------------------------------------------------------------------

/** Zeichnet den ersten Idle-Frame als Brustbild (Kopf im Fokus). Gesperrte Helden als dunkle Silhouette. */
export function drawPortrait(canvas: HTMLCanvasElement, sprites: CharacterSprites | null, locked: boolean, cssW: number, cssH: number): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pw = Math.max(1, Math.round(cssW * dpr));
  const ph = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  const g = canvas.getContext("2d");
  if (!g) return;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = "source-over";
  g.clearRect(0, 0, pw, ph);
  if (!sprites || cssW < 2) return;
  const fig = cssH * 1.34; // Figurhöhe (Beine bleiben außerhalb der Kachel)
  const u = fig / PLAYER_VISUAL_H;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.save();
  g.translate(cssW * 0.5, cssH * 0.06 + fig);
  g.scale(u, u);
  g.imageSmoothingQuality = "high";
  sprites.draw(g, "idle", 0, 0, 0, { frame: 0 });
  g.restore();
  if (locked) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-atop";
    const gr = g.createLinearGradient(0, 0, 0, ph);
    gr.addColorStop(0, "rgba(58,72,128,0.93)");
    gr.addColorStop(1, "rgba(8,10,26,0.97)");
    g.fillStyle = gr;
    g.fillRect(0, 0, pw, ph);
    g.globalCompositeOperation = "source-over";
  }
}
