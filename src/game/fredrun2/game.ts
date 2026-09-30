/**
 * Game-Controller: verbindet Sim, Renderer, Eingabe, Audio und Persistenz und stellt der UI (React) einen
 * einfachen, abonnierbaren Zustand bereit. Enthält Spielschleife (fester Zeitschritt + Interpolation),
 * Countdown, Pause, Game-Over, Demo-Modus (Bot spielt hinter dem Menü) und adaptive Bildqualität.
 */
import { createAssetLoader, loadCharacter, type GameAssets } from "./assets";
import { Bot } from "./bot";
import { CHARACTERS } from "./characters";
import { FIXED_DT, MAGNET_TIME, PLAYER_SX, SHIELD_TIME, SLOWMO_TIME, TURBO_TIME, VIEW_H, VIEW_W } from "./constants";
import { InputManager } from "./input";
import {
  boardKey,
  defaultProfile,
  loadProfile,
  purchaseCharacter,
  recordRun,
  saveProfile,
  type Profile,
  type PurchaseStatus,
  type RecordResult,
  type ScoreEntry,
  type Settings,
} from "./profile";
import { Renderer, type FrameData } from "./render";
import { dailySeed, dateKey } from "./rng";
import { NO_INPUT, Sim, TOUR_METERS, TOUR_ORDER, dailyWorld, type SimInput } from "./sim";
import type { HudState, HudToast } from "./hud";
import type { CharacterId, Ent, RunConfig, RunMode, SimEvent, ViewState, WorldDef, WorldId, WorldRenderer } from "./types";
import { WORLDS } from "./worlds";
import { BasicRenderer } from "./worlds/basic";

/** Strukturelle Schnittstelle des Audio-Moduls (siehe ./audio). */
export interface AudioLike {
  unlock(): Promise<void>;
  sfx(name: string, opts?: { pitch?: number; volume?: number; pan?: number }): void;
  loop(name: string, on: boolean, level?: number): void;
  music: {
    play(id: string, opts?: { crossfadeSec?: number; intensity?: number }): void;
    setIntensity(v: number, rampSec?: number): void;
    stop(fadeSec?: number): void;
  };
  setMasterVolume(v: number): void;
  setMusicVolume(v: number): void;
  setSfxVolume(v: number): void;
  setMuted(m: boolean): void;
  duck(amount: number, sec: number): void;
  suspend(): void;
  resume(): void;
  setTempoScale(v: number): void;
  dispose(): void;
}

export type GamePhase = "loading" | "menu" | "countdown" | "running" | "paused" | "gameover";

export interface RunResult {
  score: number;
  meters: number;
  coins: number;
  gems: number;
  stomps: number;
  nearMisses: number;
  maxCombo: number;
  dashes: number;
  seconds: number;
  deathCause: string;
  world: WorldId;
  mode: RunMode;
  character: CharacterId;
  isNewBest: boolean;
  rank: number | null;
  previousBest: number;
  worldsVisited: WorldId[];
  top: ScoreEntry[];
}

export interface GameSnapshot {
  phase: GamePhase;
  loadProgress: number;
  countdown: number;
  profile: Profile;
  result: RunResult | null;
  /** Live-Werte fürs UI (Touch-Buttons etc.) */
  live: { dashReady: boolean; hearts: number; score: number };
  fps: number;
  quality: 0 | 1 | 2;
  audioUnlocked: boolean;
  demoWorld: WorldId;
  error: string | null;
}

const HINTS: Array<{ at: number; text: string }> = [
  { at: 0.2, text: "Springen: Leertaste / Tippen · halten = höher · nochmal = Doppelsprung" },
  { at: 6.5, text: "Rutschen: ↓ / nach unten wischen · in der Luft: Stampfen" },
  { at: 13, text: "Dash: Shift / ⚡-Taste – unverwundbar, wenn der Energiering voll genug ist" },
];

const ZONE_SFX: Array<[RegExp, { warn?: string; active?: string }]> = [
  [/bolt|lightning|blitz/, { warn: "lightning-warn", active: "thunder" }],
  [/stamp|stempel/, { warn: "paper-flutter", active: "stamp-thud" }],
  [/laser|beam/, { warn: "laser-zap", active: "laser-zap" }],
  [/rock|stein/, { warn: "rockfall", active: "rockfall" }],
];

const TITLE_CASE: Record<WorldId, string> = { wien: "Wien", alpen: "Alpen", finanzamt: "Finanzamt", prater: "Prater", wachau: "Wachau", cyber: "Cyber-Wien" };

export interface GameOptions {
  canvas: HTMLCanvasElement;
  container: HTMLElement;
  audio: AudioLike;
  onChange: () => void;
}

export class FredRunGame {
  private readonly canvas: HTMLCanvasElement;
  private readonly container: HTMLElement;
  readonly audio: AudioLike;
  readonly input = new InputManager();
  readonly assets: GameAssets = createAssetLoader();
  private renderer: Renderer | null = null;
  private readonly worldRenderers = new Map<WorldId, WorldRenderer>();
  private readonly worldLoading = new Map<WorldId, Promise<void>>();
  private profile: Profile = defaultProfile();
  private sim: Sim | null = null;
  private bot: Bot | null = null;
  private demo = true;
  private phase: GamePhase = "loading";
  private loadProgress = 0;
  private result: RunResult | null = null;
  private countdownT = 0;
  private countdownSfx = 4;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private time = 0;
  private prev = { dist: 0, hgt: 0 };
  private hitstop = 0;
  private shake = 0;
  private shakeSeed = 0;
  private flashV = 0;
  private flashColor = "#ffffff";
  private toast: { title: string; sub?: string; color: string; t: number; dur: number } | null = null;
  private hintIdx = 0;
  private hintT = 0;
  private hintShow = 0;
  private hintText: string | null = null;
  private fps = 60;
  private fpsAcc = 0;
  private fpsN = 0;
  private slowFrames = 0;
  private fastFrames = 0;
  private quality: 0 | 1 | 2 = 2;
  private autoQuality = true;
  private destroyed = false;
  private audioUnlocked = false;
  private error: string | null = null;
  private lastMusicUpdate = 0;
  private demoWorld: WorldId = "wien";
  private ro: ResizeObserver | null = null;
  private readonly onChange: () => void;
  private lastSnapshotKey = "";
  private snapshotCache: GameSnapshot | null = null;
  private resumeCountdown = 0;
  private victory = false;
  private activeLoops = new Set<string>();
  private cfg: RunConfig | null = null;
  private dailyKey = "";
  private runStartMs = 0;
  private stageToastShown = false;
  reducedMotion = false;
  private touchMode = false;
  /** Harness/Tests: Frames werden nur manuell (debugAdvance) berechnet. */
  manual = false;

  constructor(opts: GameOptions) {
    this.canvas = opts.canvas;
    this.container = opts.container;
    this.audio = opts.audio;
    this.onChange = opts.onChange;
  }

  // ------------------------------------------------------------------------------------------
  // Lebenszyklus

  async init(): Promise<void> {
    try {
      this.profile = loadProfile();
      if (typeof window !== "undefined") {
        this.touchMode = window.matchMedia?.("(pointer: coarse)").matches === true;
        const q = new URLSearchParams(window.location.search);
        if (q.has("unlockall")) this.profile = { ...this.profile, unlocked: [...Object.keys(CHARACTERS)] as CharacterId[] };
        const w = q.get("world");
        if (w && (TOUR_ORDER as string[]).includes(w)) this.profile = { ...this.profile, world: w as WorldId };
      }
      this.reducedMotion =
        this.profile.settings.reducedMotion ||
        (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true);
      this.renderer = new Renderer(this.canvas, this.assets);
      this.renderer.reducedMotion = this.reducedMotion;
      this.applySettings();
      this.observeSize();
      this.input.attach(this.container);
      this.input.listener = {
        onPause: () => this.togglePause(),
        onMute: () => this.setSettings({ muted: !this.profile.settings.muted }),
        onAnyInput: () => this.unlockAudio(),
      };
      this.setProgress(0.05);
      await this.assets.props.ensureManifest();
      this.setProgress(0.15);
      await this.ensureCharacter(this.profile.character);
      this.setProgress(0.5);
      this.demoWorld = this.profile.world;
      await this.ensureWorld(this.demoWorld);
      this.setProgress(0.9);
      this.startDemo();
      this.phase = "menu";
      this.setProgress(1);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.phase = "menu";
    }
    if (this.destroyed) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("blur", this.onBlur);
    this.emitChange();
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.input.detach();
    this.ro?.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("blur", this.onBlur);
    this.audio.music.stop(0.2);
    for (const l of this.activeLoops) this.audio.loop(l, false);
    this.audio.dispose();
  }

  private setProgress(v: number): void {
    this.loadProgress = v;
    this.emitChange();
  }

  private onBlur = (): void => {
    if (this.phase === "running") this.pause();
  };

  private onVisibility = (): void => {
    if (document.hidden) {
      if (this.phase === "running") this.pause();
      this.audio.suspend();
    } else {
      this.audio.resume();
      this.last = performance.now();
    }
  };

  private observeSize(): void {
    const apply = (): void => {
      const box = this.container.getBoundingClientRect();
      const dprCap = this.quality === 0 ? 1 : this.quality === 1 ? 1.5 : 2;
      const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
      this.renderer?.resize(box.width, box.height, dpr);
    };
    apply();
    this.ro = new ResizeObserver(apply);
    this.ro.observe(this.container);
    this.applySize = apply;
  }
  private applySize: () => void = () => {};

  // ------------------------------------------------------------------------------------------
  // Assets

  private async ensureCharacter(id: CharacterId): Promise<void> {
    const sprites = await loadCharacter(id);
    if (this.profile.character === id) this.renderer?.setCharacter(sprites);
  }

  private ensureWorld(id: WorldId): Promise<void> {
    let p = this.worldLoading.get(id);
    if (!p) {
      p = (async () => {
        const def = WORLDS[id];
        const r = def.createRenderer();
        if (this.renderer) r.resize?.(this.renderer.pixelScale);
        await Promise.all([r.load(this.assets).catch(() => undefined), this.assets.props.preload(def.propIds ?? [])]);
        this.worldRenderers.set(id, r);
      })();
      this.worldLoading.set(id, p);
    }
    return p;
  }

  // ------------------------------------------------------------------------------------------
  // Öffentliche Steuerung

  unlockAudio(): void {
    if (this.audioUnlocked) return;
    this.audioUnlocked = true;
    void this.audio
      .unlock()
      .then(() => {
        this.applySettings();
        if (this.phase === "menu") this.audio.music.play("menu", { crossfadeSec: 0.5 });
        this.emitChange();
      })
      .catch(() => {
        this.audioUnlocked = false;
      });
  }

  getSnapshot(): GameSnapshot {
    const sim = this.sim;
    const key = [
      this.phase,
      this.loadProgress,
      Math.ceil(this.countdownT),
      this.result ? 1 : 0,
      this.profileVersion,
      this.audioUnlocked ? 1 : 0,
      this.quality,
      Math.round(this.fps / 5),
      sim ? sim.player.hearts : 0,
      sim ? Math.floor(sim.score / 10) : 0,
      sim && sim.player.energy >= sim.perks.dashCost ? 1 : 0,
      this.demoWorld,
      this.error ?? "",
    ].join("|");
    if (this.snapshotCache && key === this.lastSnapshotKey) return this.snapshotCache;
    this.lastSnapshotKey = key;
    this.snapshotCache = {
      phase: this.phase,
      loadProgress: this.loadProgress,
      countdown: Math.max(0, Math.ceil(this.countdownT)),
      profile: this.profile,
      result: this.result,
      live: {
        dashReady: !!sim && sim.player.energy >= sim.perks.dashCost,
        hearts: sim?.player.hearts ?? 0,
        score: sim?.score ?? 0,
      },
      fps: this.fps,
      quality: this.quality,
      audioUnlocked: this.audioUnlocked,
      demoWorld: this.demoWorld,
      error: this.error,
    };
    return this.snapshotCache;
  }
  private profileVersion = 0;
  private emitChange(): void {
    this.snapshotCache = null;
    this.onChange();
  }

  private commitProfile(p: Profile): void {
    this.profile = p;
    this.profileVersion += 1;
    saveProfile(p);
  }

  setSettings(patch: Partial<Settings>): void {
    this.commitProfile({ ...this.profile, settings: { ...this.profile.settings, ...patch } });
    this.applySettings();
    this.emitChange();
  }

  setName(name: string): void {
    this.commitProfile({ ...this.profile, name });
    this.emitChange();
  }

  markIntroSeen(): void {
    if (this.profile.seenIntro) return;
    this.commitProfile({ ...this.profile, seenIntro: true });
    this.emitChange();
  }

  private applySettings(): void {
    const s = this.profile.settings;
    this.audio.setMasterVolume(s.master);
    this.audio.setMusicVolume(s.music);
    this.audio.setSfxVolume(s.sfx);
    this.audio.setMuted(s.muted);
    this.reducedMotion =
      s.reducedMotion || (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true);
    if (this.renderer) this.renderer.reducedMotion = this.reducedMotion;
    this.autoQuality = s.quality === "auto";
    if (!this.autoQuality) this.setQuality(s.quality === "low" ? 0 : s.quality === "medium" ? 1 : 2);
  }

  private setQuality(q: 0 | 1 | 2): void {
    if (q === this.quality) return;
    this.quality = q;
    if (this.renderer) {
      this.renderer.quality = q;
      this.renderer.particles.budget = q === 0 ? 0.35 : q === 1 ? 0.7 : 1;
    }
    this.applySize();
    this.emitChange();
  }

  async selectCharacter(id: CharacterId): Promise<void> {
    if (!this.profile.unlocked.includes(id)) return;
    this.commitProfile({ ...this.profile, character: id });
    await this.ensureCharacter(id);
    this.emitChange();
  }

  buyCharacter(id: CharacterId): PurchaseStatus {
    const r = purchaseCharacter(this.profile, id);
    if (r.status === "purchased") {
      this.commitProfile(r.profile);
      this.audio.sfx("ui-buy");
      this.emitChange();
      void this.selectCharacter(id);
    } else if (r.status === "insufficient") {
      this.audio.sfx("ui-denied");
    }
    return r.status;
  }

  async selectWorld(id: WorldId, mode: RunMode = this.profile.mode): Promise<void> {
    this.commitProfile({ ...this.profile, world: id, mode });
    await this.ensureWorld(id);
    if (this.phase === "menu") {
      this.demoWorld = id;
      this.startDemo();
    }
    this.emitChange();
  }

  setMode(mode: RunMode): void {
    this.commitProfile({ ...this.profile, mode });
    if (this.phase === "menu") this.startDemo();
    this.emitChange();
  }

  /** Startet einen echten Lauf (mit Countdown). */
  async startRun(over: Partial<RunConfig> = {}): Promise<void> {
    if (this.phase === "loading") return;
    this.unlockAudio();
    const p = this.profile;
    const mode = over.mode ?? p.mode;
    const world = mode === "daily" ? dailyWorld() : over.world ?? p.world;
    const dailyKey = mode === "daily" ? dateKey() : "";
    this.dailyKey = dailyKey;
    const seed = over.seed ?? (mode === "daily" ? dailySeed() : (Math.random() * 0xffffffff) >>> 0);
    const cfg: RunConfig = { mode, world, character: over.character ?? p.character, seed, startMeters: over.startMeters };
    this.cfg = cfg;
    await Promise.all([this.ensureCharacter(cfg.character), mode === "tour" ? Promise.all(TOUR_ORDER.map((w) => this.ensureWorld(w))) : this.ensureWorld(world)]);
    const sprites = await loadCharacter(cfg.character);
    this.renderer?.setCharacter(sprites);
    this.sim = new Sim(cfg, WORLDS);
    this.prev = { dist: this.sim.dist, hgt: 0 };
    this.bot = null;
    this.demo = false;
    this.result = null;
    this.victory = false;
    this.acc = 0;
    this.hitstop = 0;
    this.shake = 0;
    this.flashV = 0;
    this.renderer?.particles.clear();
    this.hintIdx = 0;
    this.hintT = 0;
    this.hintText = null;
    this.hintShow = 0;
    this.toast = null;
    this.stageToastShown = false;
    this.flashV = 1;
    this.flashColor = "#000000";
    this.phase = "countdown";
    this.countdownT = 3.2;
    this.countdownSfx = 4;
    this.input.enabled = true;
    this.input.releaseAll();
    this.audio.music.play(WORLDS[TOUR_ORDER.includes(this.sim.world.id) ? this.sim.world.id : world].music, { crossfadeSec: 0.6, intensity: 0.15 });
    this.emitChange();
  }

  restart(): void {
    if (!this.cfg) return;
    void this.startRun({ ...this.cfg, seed: this.cfg.mode === "daily" ? this.cfg.seed : undefined });
  }

  pause(): void {
    if (this.phase !== "running") return;
    this.phase = "paused";
    this.input.releaseAll();
    this.audio.duck(0.6, 0.2);
    for (const l of this.activeLoops) this.audio.loop(l, false);
    this.activeLoops.clear();
    this.audio.sfx("ui-back");
    this.emitChange();
  }

  resume(): void {
    if (this.phase !== "paused") return;
    this.phase = "countdown";
    this.countdownT = 1.6;
    this.countdownSfx = 2;
    this.resumeCountdown = 1;
    this.input.releaseAll();
    this.emitChange();
  }

  togglePause(): void {
    if (this.phase === "running") this.pause();
    else if (this.phase === "paused") this.resume();
    else if (this.phase === "countdown" && this.resumeCountdown === 0) this.toMenu();
  }

  toMenu(): void {
    this.input.enabled = false;
    this.input.releaseAll();
    this.result = null;
    this.phase = "menu";
    this.victory = false;
    for (const l of this.activeLoops) this.audio.loop(l, false);
    this.activeLoops.clear();
    this.audio.music.play("menu", { crossfadeSec: 0.8 });
    this.demoWorld = this.profile.world;
    void this.ensureWorld(this.demoWorld).then(() => {
      if (this.phase === "menu") this.startDemo();
    });
    this.emitChange();
  }

  // ------------------------------------------------------------------------------------------
  // Demo (Attract-Modus)

  private startDemo(): void {
    const w = this.demoWorld;
    if (!this.worldRenderers.has(w)) return;
    const sim = new Sim({ mode: "world", world: w, character: this.profile.character, seed: (Math.random() * 0xffffffff) >>> 0, startMeters: Math.random() * 60 }, WORLDS);
    sim.player.hearts = 99;
    sim.begin();
    this.sim = sim;
    this.bot = new Bot({ horizon: 1.25, decisionHz: 7 });
    this.prev = { dist: sim.dist, hgt: 0 };
    this.demo = true;
    this.acc = 0;
    this.renderer?.particles.clear();
  }

  // ------------------------------------------------------------------------------------------
  // Spielschleife

  private tick = (now: number): void => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.tick);
    if (this.manual) return;
    const rawDt = Math.max(0.0001, (now - this.last) / 1000);
    this.last = now;
    const dt = Math.min(0.1, rawDt);
    this.time += dt;
    this.trackPerformance(rawDt);
    this.frame(dt);
  };

  private frame(dt: number): void {
    const sim = this.sim;
    const r = this.renderer;
    if (!sim || !r) return;
    this.input.poll();

    // Countdown
    if (this.phase === "countdown") {
      this.countdownT -= dt;
      const shown = Math.ceil(this.countdownT);
      if (shown < this.countdownSfx && shown >= 1) {
        this.countdownSfx = shown;
        this.audio.sfx("countdown");
      }
      if (this.countdownT <= 0) {
        this.phase = "running";
        this.audio.sfx("go");
        if (this.resumeCountdown) {
          this.resumeCountdown = 0;
        } else {
          sim.begin();
          this.runStartMs = performance.now();
          this.showToast(sim.world.name, sim.world.tagline, sim.world.accent);
        }
        this.emitChange();
      }
    }

    const active = this.phase === "running" || this.demo;
    const simRunning = active && (sim.phase === "running" || sim.phase === "dying");
    let stepped = false;
    if (simRunning) {
      if (this.hitstop > 0) {
        this.hitstop -= dt;
      } else {
        this.acc += dt;
        let n = 0;
        while (this.acc >= FIXED_DT && n < 16) {
          this.prev = { dist: sim.dist, hgt: sim.player.hgt };
          const input: SimInput = this.demo && this.bot ? this.bot.input(sim, FIXED_DT) : this.input.consume(FIXED_DT);
          sim.step(FIXED_DT, input);
          this.acc -= FIXED_DT;
          n += 1;
          stepped = true;
          if (sim.events.length) this.consumeEvents(sim, r);
          if (sim.phase === "over") break;
        }
        if (n >= 16) this.acc = 0;
      }
    }
    void stepped;

    if (sim.phase === "over" && !this.demo && this.phase === "running") this.finishRun(sim);
    if (sim.phase === "over" && this.demo) this.startDemo();

    // Weltsteuerung (Stimmung, Musik, Loops, Toasts)
    if (active && sim.phase === "running") this.worldTick(sim, dt);

    // Visuelle Zeit
    const visDt = this.phase === "paused" ? 0 : dt;
    const rawView = sim.view(this.hitstop > 0 || !simRunning ? 1 : Math.min(1, this.acc / FIXED_DT), this.prev, this.reducedMotion, this.quality, visDt);
    // Jede Welt bekommt nur Stufen im eigenen Bereich; die Zielwelt eines Tores beginnt bei Stufe 0.
    const view: ViewState = { ...rawView, stage: Math.min(rawView.stage, sim.world.stageCount - 1) };
    const cur = this.worldRenderers.get(sim.world.id) ?? null;
    const gate = sim.nextGate;
    const nxt = gate ? this.worldRenderers.get(gate.to) ?? null : null;
    const nextView: ViewState = { ...rawView, stage: 0, stageBlend: 0, worldMeters: 0 };
    if (this.phase !== "paused") {
      this.guard(sim.world.id, () => cur?.update(visDt, view));
      if (nxt && gate && sim.gateBlend > 0.001) this.guard(gate.to, () => nxt.update(visDt, nextView));
      r.update(visDt, sim, sim.phase === "running" ? sim.speed : 0);
    }

    // Shake / Flash
    this.shake = Math.max(0, this.shake - dt * 2.8);
    this.flashV = Math.max(0, this.flashV - dt * 3.2);
    this.shakeSeed += dt * 60;
    const sh = this.reducedMotion ? 0 : this.shake * this.shake * 14;
    const flashTotal = Math.max(this.flashV, sim.flash * (this.reducedMotion ? 0.3 : 1));

    const frame: FrameData = {
      sim,
      view,
      current: cur,
      next: nxt && sim.gateBlend > 0.001 ? nxt : null,
      nextView,
      rendererFor: (e: Ent) => this.worldRenderers.get(sim.worldAtX(e.x).id) ?? cur,
      hud: this.phase === "menu" || (this.demo && this.phase !== "running") ? null : this.buildHud(sim),
      shakeX: sh ? Math.sin(this.shakeSeed * 1.7) * sh : 0,
      shakeY: sh ? Math.cos(this.shakeSeed * 2.3) * sh * 0.7 : 0,
      flash: flashTotal,
      flashColor: this.flashV > sim.flash ? this.flashColor : "#ffffff",
      demo: this.demo,
      time: this.time,
      showPlayer: true,
      idle: this.phase === "countdown" && !this.resumeCountdown && sim.phase === "ready",
      victory: this.victory,
    };
    try {
      r.draw(frame);
    } catch (err) {
      this.renderFailed(sim.world.id, err);
    }
  }

  private renderErrors = new Map<WorldId, number>();

  /** Fehler in einem Welt-Renderer dürfen das Spiel nie einfrieren: nach 3 Fehlern fällt die Welt auf den Basis-Renderer zurück. */
  private renderFailed(id: WorldId, err: unknown): void {
    const n = (this.renderErrors.get(id) ?? 0) + 1;
    this.renderErrors.set(id, n);
    if (n === 1) console.error(`[fredrun2] Renderfehler in Welt "${id}"`, err);
    if (n === 3) {
      const fallback = new BasicRenderer(220);
      this.worldRenderers.set(id, fallback);
    }
  }

  private guard(id: WorldId, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.renderFailed(id, err);
    }
  }

  private consumeEvents(sim: Sim, r: Renderer): void {
    const audio = this.audio;
    for (const ev of sim.events) {
      r.handleEvent(ev, sim, this.time);
      if (!this.demo) this.audioFor(ev, sim);
      switch (ev.type) {
        case "hurt":
          this.hitstop = Math.max(this.hitstop, 0.07);
          this.shake = Math.max(this.shake, 1);
          break;
        case "stomp-land":
          this.shake = Math.max(this.shake, 0.55);
          this.hitstop = Math.max(this.hitstop, 0.035);
          break;
        case "bounce":
        case "enemy-defeat":
          this.shake = Math.max(this.shake, 0.3);
          this.hitstop = Math.max(this.hitstop, 0.03);
          break;
        case "wallbreak":
          this.shake = Math.max(this.shake, 0.4);
          break;
        case "death":
          this.shake = 1.2;
          this.hitstop = 0.12;
          this.flashV = 0.6;
          this.flashColor = "#ff4d4d";
          break;
        case "portal":
        case "world-transition":
          this.flashV = 0.7;
          this.flashColor = "#c4b5fd";
          break;
        case "pit-fall":
          this.flashV = 0.6;
          this.flashColor = "#ffffff";
          break;
        case "custom":
          if (ev.tag === "stage" && !this.demo) {
            const st = sim.world.stageNames[ev.value ?? 0];
            if (st && (ev.value ?? 0) > 0) this.showToast(st, sim.world.name, sim.world.accent);
          }
          break;
        default:
          break;
      }
    }
    void audio;
    sim.events.length = 0;
  }

  private audioFor(ev: SimEvent, sim: Sim): void {
    const a = this.audio;
    const pan = Math.max(-1, Math.min(1, (ev.x - VIEW_W / 2) / (VIEW_W / 2))) * 0.6;
    switch (ev.type) {
      case "jump":
        a.sfx("jump");
        break;
      case "doublejump":
        a.sfx("doublejump");
        break;
      case "land":
        a.sfx("land", { volume: Math.min(1, (ev.value ?? 400) / 1000) });
        break;
      case "slide":
        a.sfx("slide");
        break;
      case "dash":
        a.sfx("dash");
        break;
      case "stomp-land":
        a.sfx("stomp");
        break;
      case "bounce":
        a.sfx("stomp-chain", { pitch: 1 + Math.min(6, ev.value ?? 1) * 0.06 });
        break;
      case "spring":
        a.sfx("spring", { pan });
        break;
      case "portal":
        a.sfx("portal");
        break;
      case "coin":
        a.sfx("coin", { pitch: 1 + Math.min(12, ev.value ?? 0) * 0.045, pan });
        break;
      case "gem":
        a.sfx("gem", { pan });
        break;
      case "heart":
        a.sfx("heart");
        break;
      case "powerup":
        a.sfx("powerup");
        if (ev.tag === "slowmo") a.sfx("slowmo-on");
        if (ev.tag === "magnet") a.sfx("magnet-on");
        break;
      case "shield-on":
        a.sfx("shield-on");
        break;
      case "shield-hit":
        a.sfx("shield-hit");
        break;
      case "hurt":
        a.sfx("hurt");
        a.duck(0.5, 0.25);
        break;
      case "death":
        a.sfx("death");
        a.duck(0.9, 1.2);
        break;
      case "near-miss":
        a.sfx("near-miss");
        break;
      case "combo-up":
        a.sfx("combo-up", { pitch: 1 + (ev.value ?? 2) * 0.05 });
        break;
      case "combo-break":
        a.sfx("combo-break");
        break;
      case "enemy-defeat":
        a.sfx("enemy-defeat", { pan });
        break;
      case "wallbreak":
        a.sfx("wallbreak", { pan });
        break;
      case "pit-fall":
        a.sfx("splash");
        break;
      case "world-transition":
        a.sfx("world-transition");
        a.music.play(sim.world.music, { crossfadeSec: 2 });
        break;
      case "milestone":
        a.sfx("checkpoint");
        break;
      case "custom": {
        const tag = ev.tag ?? "";
        if (tag.startsWith("sfx:")) {
          a.sfx(tag.slice(4), { pan });
        } else if (tag.startsWith("zone-")) {
          const active = tag.startsWith("zone-active:");
          const skin = (ev.skin ?? tag.split(":")[1] ?? "").toLowerCase();
          for (const [re, s] of ZONE_SFX) {
            if (re.test(skin)) {
              const name = active ? s.active : s.warn;
              if (name) a.sfx(name, { pan });
              break;
            }
          }
        } else if (tag === "crumble") {
          a.sfx("crumble", { pan });
        }
        break;
      }
      default:
        break;
    }
  }

  private worldTick(sim: Sim, dt: number): void {
    const a = this.audio;
    if (!this.demo) {
      // Musik-Intensität & Tempo
      this.lastMusicUpdate += dt;
      if (this.lastMusicUpdate > 0.5) {
        this.lastMusicUpdate = 0;
        a.music.setIntensity(0.15 + 0.85 * Math.min(1, sim.diff / 9) + (sim.player.turbo > 0 ? 0.2 : 0), 0.6);
        a.setTempoScale(1 + Math.min(0.22, (sim.speed - 470) / 3200));
      }
      // Dauerklänge
      const want = new Map<string, number>();
      if (sim.player.dashT > 0 || sim.player.turbo > 0) want.set("dash-whoosh", 0.8);
      if (sim.player.sliding) want.set("slide-scrape", 0.7);
      if (sim.player.magnet > 0) want.set("magnet", 0.5);
      for (const [k, v] of Object.entries(sim.vars)) {
        if (k.startsWith("loop:") && v > 0.01) want.set(k.slice(5), Math.min(1, v));
      }
      for (const l of [...this.activeLoops]) {
        if (!want.has(l)) {
          a.loop(l, false);
          this.activeLoops.delete(l);
        }
      }
      for (const [l, lvl] of want) {
        a.loop(l, true, lvl);
        this.activeLoops.add(l);
      }
    }
    // Hinweise (nur erste Läufe)
    if (!this.demo && this.profile.settings.hints && this.profile.lifetime.runs < 3) {
      this.hintT += dt;
      const h = HINTS[this.hintIdx];
      if (h && this.hintT >= h.at) {
        this.hintText = h.text;
        this.hintShow = 5;
        this.hintIdx += 1;
      }
      if (this.hintShow > 0) {
        this.hintShow -= dt;
        if (this.hintShow <= 0) this.hintText = null;
      }
    }
    if (this.toast) {
      this.toast.t += dt;
      if (this.toast.t >= this.toast.dur) this.toast = null;
    }
  }

  private showToast(title: string, sub: string | undefined, color: string): void {
    this.toast = { title, sub, color, t: 0, dur: 3 };
  }

  private buildHud(sim: Sim): HudState {
    const p = sim.player;
    const powerups = [] as HudState["powerups"];
    if (p.magnet > 0) powerups.push({ kind: "magnet", frac: p.magnet / MAGNET_TIME });
    if (p.shield > 0) powerups.push({ kind: "shield", frac: p.shield / SHIELD_TIME });
    if (p.slowmo > 0) powerups.push({ kind: "slowmo", frac: p.slowmo / SLOWMO_TIME });
    if (p.turbo > 0) powerups.push({ kind: "turbo", frac: p.turbo / TURBO_TIME });
    const toast: HudToast | null = this.toast ? { title: this.toast.title, sub: this.toast.sub, color: this.toast.color, u: this.toast.t / this.toast.dur } : null;
    const key = boardKey(sim.cfg.mode, sim.cfg.world, this.dailyKey);
    return {
      score: sim.score,
      meters: sim.meters,
      hearts: p.hearts,
      coins: sim.stats.coins,
      combo: sim.combo,
      comboFrac: sim.comboT / 3.2,
      energy: p.energy,
      dashCost: sim.perks.dashCost,
      powerups,
      toast,
      worldName: sim.world.name,
      accent: sim.world.accent,
      best: this.profile.best[key] ?? 0,
      hint: this.hintText,
      tourFrac: sim.cfg.mode === "tour" ? Math.min(1, sim.worldMeters / TOUR_METERS) : null,
      time: this.time,
      chaseWarn: sim.vars.chaseWarn ?? 0,
      touch: this.touchMode,
    };
  }

  private finishRun(sim: Sim): void {
    const summary = {
      mode: sim.cfg.mode,
      world: sim.cfg.world,
      character: sim.cfg.character,
      score: sim.score,
      meters: sim.meters,
      coins: sim.stats.coins,
      stomps: sim.stats.stomps,
      nearMisses: sim.stats.nearMisses,
      seconds: sim.time,
      dailyKey: this.dailyKey,
    };
    const rec: RecordResult = recordRun(this.profile, summary);
    this.commitProfile(rec.profile);
    this.result = {
      score: sim.score,
      meters: sim.meters,
      coins: sim.stats.coins,
      gems: sim.stats.gems,
      stomps: sim.stats.stomps,
      nearMisses: sim.stats.nearMisses,
      maxCombo: sim.stats.maxCombo,
      dashes: sim.stats.dashes,
      seconds: sim.time,
      deathCause: sim.deathCause,
      world: sim.cfg.world,
      mode: sim.cfg.mode,
      character: sim.cfg.character,
      isNewBest: rec.isNewBest && sim.score > 0,
      rank: rec.rank,
      previousBest: rec.previousBest,
      worldsVisited: sim.stats.worldsVisited,
      top: rec.profile.top[rec.key] ?? [],
    };
    this.victory = this.result.isNewBest;
    this.phase = "gameover";
    this.input.enabled = false;
    this.input.releaseAll();
    for (const l of this.activeLoops) this.audio.loop(l, false);
    this.activeLoops.clear();
    this.audio.sfx(this.result.isNewBest ? "highscore" : "gameover");
    this.audio.music.stop(1.4);
    this.emitChange();
  }

  private trackPerformance(rawDt: number): void {
    this.fpsAcc += rawDt;
    this.fpsN += 1;
    if (this.fpsAcc >= 0.5) {
      this.fps = Math.round(this.fpsN / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsN = 0;
      this.emitChange();
    }
    if (!this.autoQuality || this.phase === "loading") return;
    if (rawDt > 0.026) {
      this.slowFrames += 1;
      this.fastFrames = 0;
    } else if (rawDt < 0.019) {
      this.fastFrames += 1;
      this.slowFrames = Math.max(0, this.slowFrames - 0.5);
    }
    if (this.slowFrames > 50 && this.quality > 0) {
      this.slowFrames = 0;
      this.setQuality((this.quality - 1) as 0 | 1 | 2);
    } else if (this.fastFrames > 1500 && this.quality < 2) {
      this.fastFrames = 0;
      this.setQuality((this.quality + 1) as 0 | 1 | 2);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Debug / QA (Screenshot-Werkzeug, Tests)

  /** Startet sofort einen Lauf ohne Countdown; Bot-gesteuert. Für QA-Screenshots. */
  setManual(v: boolean): void {
    this.manual = v;
    this.last = performance.now();
    this.acc = 0;
  }

  async debugRun(cfg: Partial<RunConfig> & { bot?: boolean; hearts?: number; live?: boolean }): Promise<void> {
    const world = cfg.world ?? "wien";
    await this.ensureCharacter(cfg.character ?? this.profile.character);
    if (cfg.mode === "tour") await Promise.all(TOUR_ORDER.map((w) => this.ensureWorld(w)));
    else await this.ensureWorld(world);
    const character = cfg.character ?? this.profile.character;
    this.renderer?.setCharacter(await loadCharacter(character));
    const sim = new Sim({ mode: cfg.mode ?? "world", world, character, seed: cfg.seed ?? 1, startMeters: cfg.startMeters, startWorldMeters: cfg.startWorldMeters }, WORLDS);
    sim.player.hearts = cfg.hearts ?? 99;
    sim.begin();
    this.sim = sim;
    this.cfg = sim.cfg;
    this.bot = cfg.bot === false ? null : new Bot();
    this.demo = cfg.live === true;
    this.phase = "running";
    this.prev = { dist: sim.dist, hgt: 0 };
    this.renderer?.particles.clear();
    this.input.enabled = true;
  }

  /** Simuliert `seconds` deterministisch (mit Bot) und zeichnet einen Frame. */
  debugAdvance(seconds: number, opts: { botOff?: boolean; input?: SimInput } = {}): { score: number; meters: number; hearts: number; phase: string; worldId: string } {
    const sim = this.sim;
    const r = this.renderer;
    if (!sim || !r) throw new Error("kein Lauf");
    const steps = Math.round(seconds / FIXED_DT);
    for (let i = 0; i < steps; i += 1) {
      this.prev = { dist: sim.dist, hgt: sim.player.hgt };
      const input = opts.input ?? (this.bot && !opts.botOff ? this.bot.input(sim, FIXED_DT) : NO_INPUT);
      sim.step(FIXED_DT, input);
      if (sim.events.length) this.consumeEvents(sim, r);
      if (sim.phase === "running" && i % 6 === 0) {
        const raw = sim.view(1, this.prev, this.reducedMotion, this.quality, FIXED_DT * 6);
        const view: ViewState = { ...raw, stage: Math.min(raw.stage, sim.world.stageCount - 1) };
        this.guard(sim.world.id, () => this.worldRenderers.get(sim.world.id)?.update(FIXED_DT * 6, view));
        const gate = sim.nextGate;
        if (gate) this.guard(gate.to, () => this.worldRenderers.get(gate.to)?.update(FIXED_DT * 6, { ...raw, stage: 0, stageBlend: 0, worldMeters: 0 }));
        r.update(FIXED_DT * 6, sim, sim.speed);
      }
      this.time += FIXED_DT;
      if (sim.phase === "over") break;
    }
    this.hitstop = 0;
    this.flashV = Math.max(0, this.flashV - seconds * 3.2);
    this.shake = 0;
    this.frame(0.0001);
    return { score: sim.score, meters: sim.meters, hearts: sim.player.hearts, phase: sim.phase, worldId: sim.world.id };
  }

  /** Nur zeichnen (z.B. nach Größenänderung). */
  debugRender(): void {
    this.frame(0.0001);
  }

  get debugSim(): Sim | null {
    return this.sim;
  }

  worldDef(id: WorldId): WorldDef {
    return WORLDS[id];
  }

  worldName(id: WorldId): string {
    return WORLDS[id]?.name ?? TITLE_CASE[id];
  }

  get logicalSize(): { w: number; h: number; playerX: number } {
    return { w: VIEW_W, h: VIEW_H, playerX: PLAYER_SX };
  }
}
