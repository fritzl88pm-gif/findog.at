/**
 * Game-Controller: verbindet Sim, Renderer, Eingabe, Audio und Persistenz und stellt der UI (React) einen
 * einfachen, abonnierbaren Zustand bereit. Enthält Spielschleife (fester Zeitschritt + Interpolation),
 * Countdown, Pause, Game-Over, Demo-Modus (Bot spielt hinter dem Menü) und adaptive Bildqualität
 * (QualityGovernor + Render-Skala, siehe quality-governor.ts / render-scale.ts; Zeichen-Drosselung: frame-policy.ts).
 */
import { createAssetLoader, loadCharacter, type AnimName, type GameAssets } from "./assets";
import { Bot } from "./bot";
import { CHARACTERS } from "./characters";
import { FIXED_DT, MAGNET_TIME, PLAYER_SX, SHIELD_TIME, SLOWMO_FACTOR, SLOWMO_TIME, TURBO_TIME, VIEW_H, VIEW_W } from "./constants";
import { isFullRate, shouldDraw, type DrawPhase } from "./frame-policy";
import { createGameAudio, type GameAudio } from "./game-audio";
import { haptic, type HapticOpts } from "./haptics";
import { HINT_MAX_RUNS, HintScheduler, type HintContext } from "./hints";
import { InputManager } from "./input";
import { boardKey, defaultProfile, loadProfile, purchaseCharacter, saveProfile, type Profile, type PurchaseStatus, type RecordResult, type Settings } from "./profile";
import { QUALITY_STORAGE_KEY, QualityGovernor, type DeviceHints, type QualityLevel } from "./quality-governor";
import { Renderer, type FrameData } from "./render";
import { effectiveDpr, pickRenderScale } from "./render-scale";
import { dailySeed, dateKey } from "./rng";
import { bankRun, countdownDisplay, isBankable, newRunId, QUICK_COUNTDOWN_S, summarizeRun, toRunResult, wantsQuickCountdown, type FullRunSummary, type RunResult } from "./run-summary";
import { NO_INPUT, Sim, TOUR_METERS, TOUR_ORDER, dailyWorld, type SimInput } from "./sim";
import type { HudState, HudToast } from "./hud";
import type { CharacterId, Ent, RunConfig, RunMode, SimEvent, ViewState, WorldDef, WorldId, WorldRenderer } from "./types";
import { formatNumber } from "./ui-logic";
import { WORLDS } from "./worlds";
import { BasicRenderer } from "./worlds/basic";
import { yieldToMain } from "./yield";

/** Strukturelle Schnittstelle des Audio-Moduls (siehe ./audio). */
export interface AudioLike {
  unlock(): Promise<void>;
  /** Kontext lief einmal (FredAudio); fehlt bei Attrappen: dann gilt der erste unlock() als erledigt */
  readonly unlocked?: boolean;
  sfx(name: string, opts?: { pitch?: number; volume?: number; pan?: number }): void;
  /** Blendet laufende Jingles (Game Over, Highscore, Weltwechsel) aus und hebt die Musik-Absenkung auf; optional wie die übrigen Neuerungen */
  stopStingers?(fadeSec?: number): void;
  /** Lädt Audiodateien vor (HTTP-Cache), ohne zu dekodieren */
  prefetch?(opts: { music?: string[] }): void;
  loop(name: string, on: boolean, level?: number): void;
  music: {
    play(id: string, opts?: { crossfadeSec?: number; intensity?: number }): void;
    setIntensity(v: number, rampSec?: number): void;
    stop(fadeSec?: number): void;
    /** Dämpft die Musik (Pause, Zeitlupe): 0..1 */
    setMuffle?(amount: number, rampSec?: number): void;
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

// Die Ergebnis-Karte lebt in run-summary.ts (Tod und „Lauf beenden“ teilen sie); die UI importiert sie weiter von hier.
export type { RunResult };

export interface GameSnapshot {
  phase: GamePhase;
  loadProgress: number;
  countdown: number;
  profile: Profile;
  result: RunResult | null;
  /** Live-Werte fürs UI (Touch-Buttons etc.); `coins` = Münzen des laufenden Laufs */
  live: { dashReady: boolean; hearts: number; score: number; coins?: number };
  fps: number;
  quality: 0 | 1 | 2;
  audioUnlocked: boolean;
  demoWorld: WorldId;
  error: string | null;
  /**
   * Es wird per Touch gespielt (Startwert: grober Zeiger oder ontouchstart, danach folgt es der zuletzt benutzten Zeigerart).
   * `touch`, `storageOk`, `loadingWorld` und `live.coins` setzt getSnapshot() immer; optional typisiert, solange
   * der feste Ladezustand (LOADING) in FredRun2.tsx sie noch nicht trägt.
   */
  touch?: boolean;
  /** false, sobald das Profil nicht gespeichert werden konnte (Privatmodus, Speicher voll); nach erfolgreichem Schreiben wieder true */
  storageOk?: boolean;
  /** Welt, die gerade (nach)geladen wird und deren Laden den Spieler aufhält (Menü-Weltwahl, Laufstart); null = keine */
  loadingWorld?: WorldId | null;
}

/** Zeitlupen-Rampe der visuellen Zeit (Welt, Partikel, Geister, Lauf-Phase): Sekunden von 1 bis SLOWMO_FACTOR und zurück */
const SLOW_RAMP_S = 0.2;
const SLOW_RAMP_RATE = (1 - SLOWMO_FACTOR) / SLOW_RAMP_S;
/** Musikdämpfung: Pause/Wiederaufnahme 1, Zeitlupe 0,6 (siehe syncMuffle) */
const MUFFLE_PAUSE = 1;
const MUFFLE_SLOW = 0.6;
/** Entsperr-Versuche (unlockAudio) frühestens in diesem Abstand */
const UNLOCK_RETRY_MS = 300;
/** Ein abgelehnter Dash meldet dem Ton höchstens in diesem Abstand (die Sim sendet ohnehin höchstens alle 0,4 s) */
const DASH_DENIED_GAP_S = 0.3;
/** Blitz-Stärke des Grubensturzes (vor dem Regler "Blitze") und des Rekord-Moments */
const PIT_FLASH = 0.35;
const RECORD_FLASH = 0.25;
const RECORD_COLOR = "#ffd23f";
/** Controller-Rumble (stark 0..1, ms) bei Treffer und Tod */
const RUMBLE_HURT: readonly [number, number] = [0.6, 150];
const RUMBLE_DEATH: readonly [number, number] = [1, 320];
/** Kern-Animationen des Helden (Menü-Demo, erste Sekunden); der Rest lädt danach im Hintergrund (Warmup-Vertrag in assets.ts) */
const CORE_ANIMS: AnimName[] = ["run", "jump", "fall", "idle"];
/** Zeitscheibe je Frame (ms) für WorldRenderer.warm() der aktuellen Welt (Countdown, Menü-Demo, Lauf-Anfang) */
const WARM_SLICE_MS = 3;
/** So lange (s der Logik-Uhr) nach Lauf- bzw. Weltbeginn wird die aktuelle Welt im laufenden Lauf noch aufgewärmt */
const WARM_RUN_S = 20;
/** Der Countdown hält höchstens so lange (s) bei „1“, bis das Dekodier-Warmup der Sprites durch ist */
const WARM_WAIT_S = 1.5;
/** Lädt eine Welt länger (ms) nicht fertig (hängendes Bild), startet sie mit dem Basis-Renderer; das echte Laden läuft weiter */
const WORLD_LOAD_TIMEOUT_MS = 15_000;
/** Spätestens nach so vielen ms erscheint das Menü, auch wenn Manifest/Figur/Welt noch laden */
const INIT_CAP_MS = 20_000;
/** Skalenwechsel der Zeichenfläche werden so lange (ms) gesammelt, bevor die Welt-Renderer sie nachziehen */
const WORLD_RESIZE_DEBOUNCE_MS = 120;
/** Skalenunterschied, ab dem die Welt-Renderer ein resize() bekommen */
const WORLD_SCALE_EPS = 0.02;
/** Nach einem Zeichen-Anlass (Phasenwechsel, Resize …) zeichnet auch die gedrosselte Phase noch so lange (ms) jeden Frame: asynchron fertig werdende Welt-Caches sollen im Standbild ankommen */
const DRAW_SETTLE_MS = 300;
/** Nach einem Kontextwechsel (neue Szene, Welt geladen, Größenwechsel …) wertet der Governor so lange (ms) nichts: die ersten Frames hängen durch Bakes */
const GOVERNOR_SETTLE_MS = 2000;
/** Geladene Welt bzw. ihr Ladevorgang; die Identität des Eintrags erkennt verworfene (pruneWorlds) Ladevorgänge */
interface WorldLoad {
  promise: Promise<void>;
}

/** Erfüllt mit true, sobald p erfüllt ist, mit false bei Ablehnung oder wenn `ms` vorher ablaufen (der Timer wird immer aufgeräumt) */
function settledWithin(p: Promise<void>, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    p.then(
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      () => {
        clearTimeout(timer);
        resolve(false);
      },
    );
  });
}

/** Gemerkte Qualitätsstufe vergessen (feste Qualität in den Einstellungen); Speicher gesperrt: egal */
function forgetStoredQuality(): void {
  try {
    localStorage.removeItem(QUALITY_STORAGE_KEY);
  } catch {
    // gesperrt (Privatmodus): nichts zu vergessen
  }
}

const TITLE_CASE: Record<WorldId, string> = { wien: "Wien", alpen: "Alpen", finanzamt: "Finanzamt", prater: "Prater", wachau: "Wachau", cyber: "Cyber-Wien", winter: "Christkindlmarkt", oper: "Opernball" };

/** Wie ein Lauf endet, den der Spieler abbricht (siehe quitRun) */
export type QuitMode = "result" | "menu" | "restart";

/** Regler-Wert auf 0..1 begrenzen (fehlender oder kaputter Wert = 1, also die bisherige Wirkung) */
function unit(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
}

/** Schlüssel „Welt/Modus/Held“ eines Laufs: gleicher Schlüssel = Wiederholung */
function runKey(cfg: Pick<RunConfig, "mode" | "world" | "character">): string {
  return `${cfg.mode}|${cfg.world}|${cfg.character}`;
}

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
  private readonly worldLoading = new Map<WorldId, WorldLoad>();
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
  /** Logik-Uhr (läuft immer; pruneAt u. Ä.) */
  private time = 0;
  /** Visuelle Uhr: steht in Pause und Wiederaufnahme-Countdown (Figur, Münzen, Herzschlag frieren mit der Welt ein); Menü, Start-Countdown und Demo laufen weiter */
  private visTime = 0;
  /** Zeitlupen-Faktor der visuellen Zeit (1 normal, SLOWMO_FACTOR in der Zeitlupe, weiche Rampe); nie 0 */
  private slowK = 1;
  /** Zustand vor dem letzten Sim-Schritt für die Interpolation (wird in capturePrev überschrieben, kein Objekt je Schritt) */
  private readonly prev: { dist: number; hgt: number; gravDir: 1 | -1 } = { dist: 0, hgt: 0, gravDir: 1 };
  private hitstop = 0;
  private shake = 0;
  private shakeSeed = 0;
  private flashV = 0;
  private flashColor = "#ffffff";
  private toast: { title: string; sub?: string; color: string; t: number; dur: number } | null = null;
  private readonly hints = new HintScheduler();
  /** wiederverwendeter Kontext für den Hinweis-Planer (kein Objekt je Frame) */
  private readonly hintCtx: HintContext = { time: 0, touch: false, runs: 0, hintsEnabled: true, overheadDist: null, pitDist: null, stompDist: null, energyReady: false };
  private hintText: string | null = null;
  /** Echte Läufe zeigen Einsteiger-Hinweise; Debug-Läufe (debugRun) nur auf Wunsch, sonst läge die Pille in jedem QA-Bild frischer Profile */
  private hintsAllowed = true;
  /** Rekord in diesem Lauf schon überholt (Toast/Ton/Blitz einmal je Lauf) */
  private recordPassed = false;
  /** Bestenlisten-Schlüssel des laufenden Laufs (einmal je Lauf gebildet, nicht je Frame) */
  private runBoardKey = "";
  /** visTime des letzten abgelehnten Dashs (HUD-Wackeln/Rückmeldung) und des letzten dafür gespielten Tons */
  private dashDeniedAt = Number.NEGATIVE_INFINITY;
  private dashDeniedSfxAt = Number.NEGATIVE_INFINITY;
  private readonly gameAudio: GameAudio;
  private readonly hapOpts: HapticOpts = { enabled: true, demo: false };
  /** zuletzt an die Musik gesendete Dämpfung (-1 = unbekannt, erzwingt das nächste Senden) und Zeitlupen-Dämpfung aktiv */
  private muffleSent = 0;
  private slowMuffle = false;
  private lastUnlockTry = Number.NEGATIVE_INFINITY;
  private fps = 60;
  private fpsAcc = 0;
  private fpsN = 0;
  private quality: QualityLevel = 2;
  private autoQuality = true;
  /** Adaptive Qualität (nur bei Einstellung "auto"); feed() je voll gezeichnetem Frame, Wechsel greifen am Anfang des nächsten Frames */
  private governor: QualityGovernor | null = null;
  private pendingQuality: QualityLevel | null = null;
  /** Kontext des letzten Governor-Frames (Phase, Szene, Welt, Verdeckung): ein Wechsel startet die Einschwingzeit ohne Wertung */
  private feedPhase: GamePhase | null = null;
  private feedSim: Sim | null = null;
  private feedWorld: WorldId | null = null;
  private feedCovered = false;
  private settlePending = true;
  private settleUntil = 0;
  /** "auto" bzw. "manual" nach der letzten Einstellung (erkennt den Wechsel, der den Governor ein-/ausschaltet) */
  private qualityMode: "auto" | "manual" | null = null;
  /** zuletzt angewandte Größe der Zeichenfläche (CSS-Pixel, Bitmap-Pixeldichte): gleiche Werte lösen nichts aus */
  private sizeW = -1;
  private sizeH = -1;
  private sizeDpr = -1;
  /** Skala, die den Welt-Renderern zuletzt gemeldet wurde (0 = noch keine), und der Timer des gedrosselten Nachziehens */
  private worldScale = 0;
  private worldScaleTimer: ReturnType<typeof setTimeout> | null = null;
  private dprQuery: MediaQueryList | null = null;
  /** Zeichen-Drosselung (frame-policy.ts): etwas hat das Bild verändert oder die Zeichenfläche geleert */
  private drawDirty = true;
  private dirtyUntil = 0;
  /** Phase des zuletzt gezeichneten Frames (ein Wechsel ist immer ein Zeichen-Anlass) und Zeitpunkt (rAF-Uhr) davon */
  private drawnPhase: DrawPhase | null = null;
  private lastDrawAt = Number.NEGATIVE_INFINITY;
  /** Zeit (s) übersprungener Frames, die der nächste gezeichnete Frame nachholt (nur gedrosselte Phasen) */
  private skipDt = 0;
  /** Aufwärmen: Welt-Renderer, deren warm() fertig meldete; Logik-Zeit, bis zu der die aktuelle Welt im Lauf noch gewärmt wird */
  private readonly warmedWorlds = new WeakSet<WorldRenderer>();
  private warmUntil = 0;
  /** Dekodier-Warmup der Sprites vor dem Start (assets.warmed): Token gegen veraltete Antworten, Fertig-Flag, Wartezeit am Countdown-Ende (s) */
  private warmToken = 0;
  private warmDone = true;
  private warmWaitT = 0;
  /** Ein Laufstart läuft schon (Welt/Figur laden): weitere startRun() werden ignoriert; neueste Weltwahl im Menü */
  private starting = false;
  private selectTicket = 0;
  /** Held, dessen vollständiger Satz Animationen geladen ist (ein später eintreffender Kern-Satz darf ihn nicht ersetzen) */
  private fullCharacter: CharacterId | null = null;
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
  /** Profil ließ sich zuletzt speichern (false: localStorage gesperrt/voll) */
  private storageOk = true;
  /** Welt, die den Spieler gerade aufhält (Menü-Weltwahl, Laufstart, Rückkehr ins Menü); null = keine */
  private loadingWorld: WorldId | null = null;
  /** Hochformat-Hinweis der UI liegt über dem Spiel */
  private portraitBlocked = false;
  /** Menü liegt unter einer Vollbild-Ebene (Einstellungen o. Ä.): Demo und Zeichnen sparen (siehe frame-policy.ts) */
  private menuCovered = false;
  /** Fenster hat Fokus / Seite ist sichtbar – nur aus focus/blur/visibilitychange gepflegt (kein document.hasFocus()-Polling) */
  private winFocused = true;
  private winVisible = true;
  /** Der aktuelle Lauf ist schon ins Profil gebucht (Tod oder „Lauf beenden“): höchstens einmal je Lauf */
  private runBanked = false;
  /** Welt/Modus/Held des zuletzt gestarteten Laufs (nur diese Sitzung): nur eine Wiederholung bekommt den kurzen Countdown */
  private lastRunKey = "";
  /** zuletzt dem UI gemeldete Countdown-Zahl */
  private shownCount = -1;
  /** Ergebnis-Karte nach „Lauf beenden“: Szene bleibt eingefroren wie in der Pause */
  private frozen = false;
  /** Harness/Tests: Frames werden nur manuell (debugAdvance) berechnet. */
  manual = false;

  constructor(opts: GameOptions) {
    this.canvas = opts.canvas;
    this.container = opts.container;
    this.audio = opts.audio;
    this.onChange = opts.onChange;
    this.gameAudio = createGameAudio(opts.audio, { cuesEnabled: () => this.profile.settings.cues });
  }

  // ------------------------------------------------------------------------------------------
  // Lebenszyklus

  async init(): Promise<void> {
    try {
      this.profile = loadProfile();
      if (typeof window !== "undefined") {
        this.touchMode = window.matchMedia?.("(pointer: coarse)").matches === true || "ontouchstart" in window;
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
      // Eingabe an der ganzen Spielfläche (Wurzel) statt nur an der 16:9-Bühne: auch die Seitenbalken springen. Die Bühne bleibt fürs Messen (observeSize).
      this.input.attach(this.container.parentElement ?? this.container);
      this.input.listener = {
        onPause: () => this.togglePause(),
        onMute: () => {
          const muted = !this.profile.settings.muted;
          this.setSettings({ muted });
          // Im Lauf gibt es sonst keine Rückmeldung (die Menü-Oberfläche zeigt den Schalter selbst)
          if (this.phase === "running" && !this.demo) this.showToast(muted ? "Ton aus" : "Ton an", undefined, "#b8c1ff");
        },
        onAnyInput: () => {
          this.unlockAudio();
          // Eingabe im Spiel beweist, dass das Fenster aktiv ist: heilt ein verpasstes focus-Ereignis (sonst bliebe der Countdown stehen)
          this.winFocused = true;
        },
      };
      this.input.onPointerKind = (kind) => {
        if (kind === "pen") return;
        const touch = kind === "touch";
        if (touch === this.touchMode) return;
        this.touchMode = touch;
        this.emitChange();
      };
      this.setProgress(0.05);
      this.demoWorld = this.profile.world;
      // Manifest, Kern der Figur und Demo-Welt starten gleichzeitig (die Requests überlappen statt sich zu staffeln); der Balken
      // wächst mit jedem fertigen Teil, gewichtet nach Dateizahl und Bytes: Manifest ~1 Datei, Figur-Kern 5 Dateien (0,5 MB),
      // Welt-Props ~28 Dateien (2,6 MB)
      const part = (p: Promise<unknown>, weight: number): Promise<void> =>
        p.then(() => {
          if (this.phase === "loading") this.setProgress(Math.min(0.95, this.loadProgress + weight));
        });
      const parts = Promise.all([
        part(this.assets.props.ensureManifest(), 0.08),
        part(this.ensureCharacter(this.profile.character, true), 0.3),
        part(this.ensureWorld(this.demoWorld), 0.55),
      ]);
      // Hängt eine Anfrage (Funknetz), kommt das Menü trotzdem: Demo startet, sobald die Welt da ist (installWorld)
      let capTimer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([parts, new Promise<void>((resolve) => (capTimer = setTimeout(resolve, INIT_CAP_MS)))]).finally(() => clearTimeout(capTimer));
      this.startDemo();
      this.phase = "menu";
      this.drawDirty = true;
      this.setProgress(1);
      this.prefetchAudio(["menu", WORLDS[this.profile.world].music], true);
      // Übrige Animationen (slide, dash, stomp, …) laden jetzt im Hintergrund; vor dem Countdown-Ende wartet startRun auf das Warmup
      void this.ensureCharacter(this.profile.character);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.phase = "menu";
    }
    if (this.destroyed) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
    document.addEventListener("visibilitychange", this.onVisibility);
    document.addEventListener("fullscreenchange", this.onFullscreenChange);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("focus", this.onFocus);
    this.canvas.addEventListener("contextrestored", this.markDirty);
    this.emitChange();
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.input.detach();
    this.ro?.disconnect();
    this.dprQuery?.removeEventListener?.("change", this.onDprChange);
    this.dprQuery = null;
    if (this.worldScaleTimer !== null) clearTimeout(this.worldScaleTimer);
    this.worldScaleTimer = null;
    document.removeEventListener("visibilitychange", this.onVisibility);
    document.removeEventListener("fullscreenchange", this.onFullscreenChange);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("focus", this.onFocus);
    this.canvas.removeEventListener("contextrestored", this.markDirty);
    this.audio.music.stop(0.2);
    for (const l of this.activeLoops) this.audio.loop(l, false);
    this.audio.dispose();
  }

  private setProgress(v: number): void {
    this.loadProgress = v;
    this.emitChange();
  }

  private onBlur = (): void => {
    this.winFocused = false;
    if (this.phase === "running") this.pause();
  };

  private onFocus = (): void => {
    this.winFocused = true;
  };

  private onVisibility = (): void => {
    this.winVisible = !document.hidden;
    if (document.hidden) {
      if (this.phase === "running") this.pause();
      this.audio.suspend();
    } else {
      this.audio.resume();
      this.last = performance.now();
      this.markDirty(); // der Browser darf die Zeichenfläche im Hintergrund verworfen haben
    }
  };

  /** Beim VERLASSEN des Vollbilds (Esc gehört dem Browser, erreicht das Spiel nicht) pausiert der Lauf; Betreten pausiert nie. */
  private onFullscreenChange = (): void => {
    if (document.fullscreenElement === null && this.phase === "running") this.pause();
  };

  /**
   * Zeichenfläche an Bühne, Geräte-Pixeldichte und Qualitätsstufe anpassen. Die Bitmap ist 1280·s × 720·s groß (s aus
   * pickRenderScale: Q0 exakt 1, Q1 bis 1,25, Q2 bis 2, nie über 3,7 MP), nicht mehr cssBreite·dpr – so bleibt der 1:1-Schnellpfad der
   * Welt-Caches auf den meisten Geräten erreichbar und die Stufe hat einen echten Auflösungshebel.
   * `sync`: aus dem ResizeObserver (läuft NACH den rAF-Callbacks, die geleerte Zeichenfläche würde ein leeres Bild zeigen) sofort neu zeichnen.
   */
  private observeSize(): void {
    const apply = (sync: boolean): void => {
      const r = this.renderer;
      if (!r) return;
      const box = this.container.getBoundingClientRect();
      const s = pickRenderScale(box.width, box.height, window.devicePixelRatio || 1, this.quality);
      const eff = effectiveDpr(box.width, s);
      if (box.width === this.sizeW && box.height === this.sizeH && eff === this.sizeDpr) return; // nichts geändert: kein Neuaufbau von Vignette/Schnellpfaden
      this.sizeW = box.width;
      this.sizeH = box.height;
      this.sizeDpr = eff;
      r.resize(box.width, box.height, eff);
      this.drawDirty = true; // canvas.width zu setzen löscht den Inhalt
      this.settlePending = true;
      this.syncWorldScale(box.width >= 64 && box.height >= 36);
      if (sync) this.drawNow();
    };
    apply(false);
    this.ro = new ResizeObserver(() => apply(true));
    this.ro.observe(this.container);
    this.applySize = () => apply(false);
    this.watchDpr();
  }
  private applySize: () => void = () => {};

  /** Geräte-Pixeldichte ändert sich ohne Größenänderung (Fenster auf anderen Monitor, Browser-Zoom): matchMedia meldet es, der ResizeObserver nicht */
  private watchDpr(): void {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    this.dprQuery?.removeEventListener?.("change", this.onDprChange);
    try {
      const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      mq.addEventListener?.("change", this.onDprChange); // Safari < 14 kennt nur addListener: dort bleibt es beim ResizeObserver
      this.dprQuery = mq;
    } catch {
      this.dprQuery = null;
    }
  }

  private onDprChange = (): void => {
    if (this.destroyed) return;
    this.applySize();
    this.watchDpr(); // die Abfrage gilt nur für die bisherige Dichte: neu auf die aktuelle ansetzen
  };

  /**
   * Meldet eine geänderte Skala den geladenen Welt-Renderern (deren Sprites/Caches hängen an der Pixeldichte). Gedrosselt: während
   * eines Fenster-Zugs kommen viele kleine Änderungen, die Welten bekommen nur die letzte. Gültige Boxen nur (nicht im ausgeblendeten Zustand).
   */
  private syncWorldScale(valid: boolean): void {
    const r = this.renderer;
    if (!valid || !r) return;
    const s = r.pixelScale;
    if (this.worldScale === 0) {
      this.worldScale = s; // erste Messung: Welten werden beim Erzeugen (ensureWorld) mit dieser Skala angelegt
      return;
    }
    if (Math.abs(s - this.worldScale) < WORLD_SCALE_EPS) return;
    if (this.worldScaleTimer !== null) clearTimeout(this.worldScaleTimer);
    this.worldScaleTimer = setTimeout(() => {
      this.worldScaleTimer = null;
      const ps = this.renderer?.pixelScale ?? 0;
      if (this.destroyed || !(ps > 0)) return;
      this.worldScale = ps;
      for (const [id, w] of this.worldRenderers) {
        try {
          w.resize?.(ps);
        } catch (err) {
          this.renderFailed(id, err);
        }
        this.warmedWorlds.delete(w); // der Neuaufbau nach einem Skalenwechsel reiht neue Backschritte in warm() ein
      }
      this.warmUntil = Math.max(this.warmUntil, this.time + WARM_RUN_S);
      this.drawDirty = true;
    }, WORLD_RESIZE_DEBOUNCE_MS);
  }

  /** Das Bild hat sich (womöglich) verändert oder wurde geleert: der nächste Frame zeichnet auch in gedrosselten Phasen */
  private markDirty = (): void => {
    this.drawDirty = true;
  };

  /** Sofort zeichnen (nach Resize: die geleerte Zeichenfläche darf nie als leeres Bild sichtbar werden). QA-Modus zeichnet nur auf Befehl. */
  private drawNow(): void {
    if (this.manual || this.destroyed || this.phase === "loading") return;
    this.frame(0.0001);
  }

  // ------------------------------------------------------------------------------------------
  // Assets

  private fallbackRenderer: WorldRenderer | null = null;
  private pruneAt = 0;

  /** Gibt Welt-Renderer frei (deren Offscreen-Canvases können vom Browser zurückgewonnen werden) – wichtig für Mobilgeräte. */
  private pruneWorlds(keep: WorldId[]): void {
    for (const id of [...this.worldRenderers.keys()]) {
      if (!keep.includes(id)) {
        this.worldRenderers.delete(id);
        this.worldLoading.delete(id);
      }
    }
  }

  /**
   * Lädt den gespielten bzw. gewählten Helden und fordert das Dekodier-Warmup an (assets.ts: nur dieser Held, nie die Menü-Vorschauen).
   * `core`: nur Kern-Animationen (run/jump/fall/idle) für Menü und erste Sekunden – der vollständige Satz folgt mit einem zweiten Aufruf.
   */
  private async ensureCharacter(id: CharacterId, core = false): Promise<void> {
    const sprites = await loadCharacter(id, core ? CORE_ANIMS : undefined, { warm: true });
    if (!core) this.fullCharacter = id;
    else if (this.fullCharacter === id) return; // der vollständige Satz war schneller: nicht durch den Kern ersetzen
    if (this.profile.character === id) {
      this.renderer?.setCharacter(sprites);
      this.markDirty();
    }
  }

  /**
   * Lädt eine Welt (idempotent). Nach dem Laden gibt yieldToMain() den Hauptthread frei, bevor die Welt im Frame zum ersten Mal
   * aktualisiert wird (Bakes). Hängt das Laden (Funkloch, hängendes Bild) über WORLD_LOAD_TIMEOUT_MS, ist die Zusage trotzdem erfüllt:
   * die Welt startet mit dem Basis-Renderer und wird durch den echten ersetzt, sobald er fertig ist.
   */
  private ensureWorld(id: WorldId): Promise<void> {
    const known = this.worldLoading.get(id);
    if (known) return known.promise;
    const entry: WorldLoad = { promise: Promise.resolve() };
    this.worldLoading.set(id, entry);
    entry.promise = this.loadWorld(id, entry);
    return entry.promise;
  }

  private async loadWorld(id: WorldId, entry: WorldLoad): Promise<void> {
    const def = WORLDS[id];
    const r = def.createRenderer();
    const usedScale = this.renderer?.pixelScale ?? 0;
    if (usedScale > 0) r.resize?.(usedScale);
    const real = (async () => {
      await Promise.all([r.load(this.assets).catch(() => undefined), this.assets.props.preload(def.propIds ?? [])]);
      await yieldToMain();
      this.installWorld(id, entry, r, usedScale);
    })();
    if (await settledWithin(real, WORLD_LOAD_TIMEOUT_MS)) return;
    // Zu langsam: sofort mit dem Basis-Renderer weiter (Menü-Demo, Laufstart); `real` ersetzt ihn später
    if (this.worldLoading.get(id) === entry && !this.worldRenderers.has(id)) {
      this.worldRenderers.set(id, new BasicRenderer(220));
      this.markDirty();
    }
  }

  /** Fertig geladene Welt einsetzen – außer sie wurde inzwischen verworfen (pruneWorlds) */
  private installWorld(id: WorldId, entry: WorldLoad, r: WorldRenderer, usedScale: number): void {
    if (this.destroyed || this.worldLoading.get(id) !== entry) return;
    const ps = this.renderer?.pixelScale ?? 0;
    if (ps > 0 && Math.abs(ps - usedScale) >= WORLD_SCALE_EPS) r.resize?.(ps); // die Skala hat sich während des Ladens geändert
    this.worldRenderers.set(id, r);
    this.markDirty();
    this.settlePending = true;
    // Menü ohne Demo (Welt kam erst nach der Wartegrenze): jetzt starten
    if (this.phase === "menu" && !this.sim && this.demoWorld === id) this.startDemo();
  }

  /**
   * Wartet auf eine Welt, die den Spieler aufhält (Menü-Weltwahl, Laufstart, Rückkehr ins Menü); solange läuft `loadingWorld`,
   * damit die UI "Welt wird geladen" zeigt statt stumm zu hängen. Bereits geladene Welten setzen nichts (kein Flackern).
   */
  private async awaitWorld(id: WorldId): Promise<void> {
    if (this.worldRenderers.has(id)) return;
    this.loadingWorld = id;
    this.emitChange();
    try {
      await this.ensureWorld(id);
    } finally {
      if (this.loadingWorld === id) {
        this.loadingWorld = null;
        this.emitChange();
      }
    }
  }

  // ------------------------------------------------------------------------------------------
  // Öffentliche Steuerung

  /**
   * Entsperrt den Ton (aus einer Nutzergeste). Der erste Versuch gilt fürs UI als erledigt; meldet die Engine danach weiter
   * `unlocked === false` (Kontext lief nicht an, z. B. iOS verlangt eine weitere Geste), versucht es jede Geste erneut, höchstens alle 300 ms.
   */
  unlockAudio(): void {
    const a = this.audio;
    if (this.audioUnlocked && a.unlocked !== false) return;
    const now = performance.now();
    if (now - this.lastUnlockTry < UNLOCK_RETRY_MS) return;
    this.lastUnlockTry = now;
    const first = !this.audioUnlocked;
    this.audioUnlocked = true;
    void a
      .unlock()
      .then(() => {
        this.applySettings();
        // Menümusik nur beim ersten Mal anfordern: die Engine startet wartende Musik selbst, sobald der Kontext läuft
        if (first && this.phase === "menu") a.music.play("menu", { crossfadeSec: 0.5 });
        this.emitChange();
      })
      .catch(() => {
        if (first) this.audioUnlocked = false;
      });
  }

  /** Lädt Musik vorab in den HTTP-Cache (Engine ohne prefetch: nichts); `idle` wartet auf Leerlauf, damit es das Laden nicht stört. */
  private prefetchAudio(music: string[], idle = false): void {
    const run = (): void => {
      if (this.destroyed) return;
      try {
        this.audio.prefetch?.({ music });
      } catch {
        /* Vorladen ist nur ein Hinweis an den Browser */
      }
    };
    if (!idle || typeof window === "undefined") run();
    else if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(run, { timeout: 4000 });
    else window.setTimeout(run, 1500);
  }

  /**
   * Musik-Dämpfung nach Lage: Pause und Wiederaufnahme-Countdown voll, Zeitlupe leicht, sonst 0. Sendet nur bei Änderung;
   * `muffleSent = -1` erzwingt das Senden (play()/stop() setzen die Dämpfung in der Engine selbst auf 0 zurück).
   */
  private syncMuffle(rampSec: number): void {
    const want = this.phase === "paused" || this.resumeCountdown > 0 ? MUFFLE_PAUSE : this.slowMuffle ? MUFFLE_SLOW : 0;
    if (want === this.muffleSent) return;
    this.muffleSent = want;
    this.audio.music.setMuffle?.(want, rampSec);
  }

  /** Lauf-/Menüwechsel: Dämpfung und Zeitlupen-Zustand zurücksetzen und die Aufhebung immer senden */
  private releaseMuffle(): void {
    this.slowMuffle = false;
    this.muffleSent = -1;
    this.syncMuffle(0.3);
  }

  getSnapshot(): GameSnapshot {
    const sim = this.sim;
    const key = [
      this.phase,
      this.loadProgress,
      this.countdownShown(),
      this.result ? 1 : 0,
      this.profileVersion,
      this.audioUnlocked ? 1 : 0,
      this.quality,
      Math.round(this.fps / 5),
      sim ? sim.player.hearts : 0,
      sim ? Math.floor(sim.score / 10) : 0,
      sim ? sim.stats.coins : 0,
      sim && sim.player.energy >= sim.perks.dashCost ? 1 : 0,
      this.demoWorld,
      this.error ?? "",
      this.touchMode ? 1 : 0,
      this.storageOk ? 1 : 0,
      this.loadingWorld ?? "",
    ].join("|");
    if (this.snapshotCache && key === this.lastSnapshotKey) return this.snapshotCache;
    this.lastSnapshotKey = key;
    this.snapshotCache = {
      phase: this.phase,
      loadProgress: this.loadProgress,
      countdown: this.countdownShown(),
      profile: this.profile,
      result: this.result,
      live: {
        dashReady: !!sim && sim.player.energy >= sim.perks.dashCost,
        hearts: sim?.player.hearts ?? 0,
        score: sim?.score ?? 0,
        coins: sim?.stats.coins ?? 0,
      },
      fps: this.fps,
      quality: this.quality,
      audioUnlocked: this.audioUnlocked,
      demoWorld: this.demoWorld,
      error: this.error,
      touch: this.touchMode,
      storageOk: this.storageOk,
      loadingWorld: this.loadingWorld,
    };
    return this.snapshotCache;
  }
  private profileVersion = 0;
  private emitChange(): void {
    this.snapshotCache = null;
    this.onChange();
  }

  /** Countdown-Zahl fürs UI (nie 4, siehe countdownDisplay) */
  private countdownShown(): number {
    return countdownDisplay(this.countdownT);
  }

  private commitProfile(p: Profile): void {
    this.profile = p;
    this.profileVersion += 1;
    const ok = saveProfile(p);
    if (ok !== this.storageOk) {
      this.storageOk = ok;
      this.emitChange();
    }
  }

  /** Hochformat-Hinweis der UI: sichtbar = das Spiel ist verdeckt. Ein laufender Lauf wird dabei pausiert (nicht beim „Trotzdem spielen“, das meldet false). */
  setPortraitBlocked(blocked: boolean): void {
    if (blocked === this.portraitBlocked) return;
    this.portraitBlocked = blocked;
    if (blocked && this.phase === "running") this.pause();
  }

  /**
   * Menü liegt verdeckt (Einstellungen, Heldenauswahl …): die Demo dahinter rechnet und zeichnet nur noch ca. 8 Bilder pro Sekunde
   * (frame-policy.ts). Beim Verlassen wird sofort neu gezeichnet (kein Stehenbleiben auf einem alten Bild). Idempotent.
   */
  setMenuCovered(covered: boolean): void {
    if (covered === this.menuCovered) return;
    this.menuCovered = covered;
    this.markDirty();
  }

  get isMenuCovered(): boolean {
    return this.menuCovered;
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
    this.input.setJumpAssist(s.jumpAssist);
    this.syncQualityMode();
    this.markDirty(); // Weniger Bewegung, Blitze, Wackeln o. Ä. ändern das Bild auch in der Pause
  }

  /**
   * Qualität nach Einstellung. "auto": der QualityGovernor entscheidet (Startstufe: gemerkte bzw. aus Geräte-Hinweisen);
   * feste Stufe ("low"/"medium"/"high"): kein Governor, und die gemerkte Stufe wird vergessen, damit ein späteres "auto" neu beginnt.
   * Mehrfach aufrufbar (jede Einstellungsänderung): nur ein Wechsel des Modus baut den Governor um.
   */
  private syncQualityMode(): void {
    const q = this.profile.settings.quality;
    const mode = q === "auto" ? "auto" : "manual";
    if (mode === "auto") {
      if (mode !== this.qualityMode || !this.governor) {
        this.governor = new QualityGovernor({ initial: QualityGovernor.initialLevel(this.deviceHints()) });
        this.pendingQuality = null;
        this.setQuality(this.governor.level);
      }
    } else {
      if (mode !== this.qualityMode) forgetStoredQuality();
      this.governor = null;
      this.pendingQuality = null;
      this.setQuality(q === "low" ? 0 : q === "medium" ? 1 : 2);
    }
    this.qualityMode = mode;
    this.autoQuality = mode === "auto";
  }

  /** Geräte-Hinweise für die Startstufe (fehlende Werte, etwa deviceMemory in Safari/Firefox, zählen nicht als schwach) */
  private deviceHints(): DeviceHints {
    if (typeof navigator === "undefined" || typeof window === "undefined") return {};
    const nav = navigator as Navigator & { deviceMemory?: number };
    return {
      deviceMemory: nav.deviceMemory,
      hardwareConcurrency: nav.hardwareConcurrency,
      coarse: window.matchMedia?.("(pointer: coarse)").matches === true,
      dpr: window.devicePixelRatio || 1,
    };
  }

  private setQuality(q: QualityLevel): void {
    if (q === this.quality) return;
    this.quality = q;
    if (this.renderer) {
      this.renderer.quality = q;
      this.renderer.particles.budget = q === 0 ? 0.35 : q === 1 ? 0.7 : 1;
    }
    this.applySize(); // die Stufe bestimmt die Auflösung (pickRenderScale)
    this.markDirty();
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
    this.prefetchAudio([WORLDS[id].music]);
    // Mehrfaches Antippen: die neueste Auswahl gewinnt; eine ältere, später fertige Welt ersetzt die Demo nicht mehr
    const ticket = ++this.selectTicket;
    await this.awaitWorld(id);
    if (ticket !== this.selectTicket) return;
    if (this.phase === "menu") this.pruneWorlds([id]);
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

  /**
   * Startet einen echten Lauf (mit Countdown). `opts.quick` erzwingt (true) oder verbietet (false) den kurzen Countdown;
   * ohne Angabe entscheidet quickStartWanted() (Einstellung, Lauf-Zähler, gleiche Welt/Modus/Held wie zuletzt).
   */
  async startRun(over: Partial<RunConfig> = {}, opts: { quick?: boolean } = {}): Promise<void> {
    // Reentrancy-Sperre: solange Welt/Figur laden, löst ein zweiter Aufruf (Doppeltipp, Enter + Klick) nichts mehr aus
    if (this.phase === "loading" || this.starting) return;
    this.starting = true;
    try {
      await this.beginRun(over, opts);
    } finally {
      this.starting = false;
    }
  }

  private async beginRun(over: Partial<RunConfig>, opts: { quick?: boolean }): Promise<void> {
    this.unlockAudio();
    const p = this.profile;
    const mode = over.mode ?? p.mode;
    const world = mode === "daily" ? dailyWorld() : over.world ?? p.world;
    const dailyKey = mode === "daily" ? dateKey() : "";
    this.dailyKey = dailyKey;
    const seed = over.seed ?? (mode === "daily" ? dailySeed() : (Math.random() * 0xffffffff) >>> 0);
    const cfg: RunConfig = { mode, world, character: over.character ?? p.character, seed, startMeters: over.startMeters };
    this.cfg = cfg;
    // Vor dem Laden entscheiden: danach hat sich die Phase (Menü/Game-Over) womöglich schon geändert
    const quick = opts.quick ?? this.quickStartWanted(cfg);
    // Nur die Startwelt laden – in der Weltreise wird die nächste Welt rechtzeitig vor dem Tor nachgeladen.
    await Promise.all([this.ensureCharacter(cfg.character), this.awaitWorld(world)]);
    this.pruneWorlds([world]);
    const sprites = await loadCharacter(cfg.character, undefined, { warm: true });
    this.renderer?.setCharacter(sprites);
    this.sim = new Sim(cfg, WORLDS);
    this.capturePrev(this.sim);
    this.bot = null;
    this.demo = false;
    this.result = null;
    this.victory = false;
    this.runBanked = false;
    this.frozen = false;
    this.resumeCountdown = 0;
    this.lastRunKey = runKey(cfg);
    this.acc = 0;
    this.hitstop = 0;
    this.shake = 0;
    this.flashV = 0;
    this.renderer?.particles.clear();
    this.resetRunFeedback(cfg, dailyKey);
    this.hintsAllowed = true;
    this.toast = null;
    this.stageToastShown = false;
    // Kurzer Countdown: eine Sekunde, ein Zähl-Ton („1“) und „Los“; der Schwarz-Blitz ist nur halb so lang
    this.flashV = quick ? 0.5 : 1;
    this.flashColor = "#000000";
    this.phase = "countdown";
    this.countdownT = quick ? QUICK_COUNTDOWN_S : 3.2;
    this.countdownSfx = quick ? 2 : 4;
    this.shownCount = this.countdownShown();
    this.input.enabled = true;
    this.input.releaseAll();
    this.beginWarmWait();
    this.warmUntil = Number.POSITIVE_INFINITY; // Countdown und Lauf-Anfang: aktuelle Welt aufwärmen (Zeitfenster startet mit "Los")
    // Ein noch laufender Game-Over-/Highscore-Jingle darf nicht in den neuen Lauf hineinklingen (und die Musik nicht geduckt bleiben)
    this.audio.stopStingers?.(0.3);
    this.audio.music.play(WORLDS[TOUR_ORDER.includes(this.sim.world.id) ? this.sim.world.id : world].music, { crossfadeSec: 0.6, intensity: 0.15 });
    this.releaseMuffle();
    this.emitChange();
  }

  /** Zustand der Rückmeldungen eines neuen Laufs: Hinweise, Rekordjagd, Zeitlupe, Dash-Rückmeldung */
  private resetRunFeedback(cfg: RunConfig, dailyKey: string): void {
    this.hints.reset();
    this.hintText = null;
    this.recordPassed = false;
    this.runBoardKey = boardKey(cfg.mode, cfg.world, dailyKey);
    this.slowK = 1;
    this.dashDeniedAt = Number.NEGATIVE_INFINITY;
    this.dashDeniedSfxAt = Number.NEGATIVE_INFINITY;
  }

  /** Merkt Distanz, Höhe und Schwerkraftrichtung vor einem Sim-Schritt (Grundlage der Darstellungs-Interpolation, siehe Sim.view) */
  private capturePrev(sim: Sim): void {
    const pv = this.prev;
    pv.dist = sim.dist;
    pv.hgt = sim.player.hgt;
    pv.gravDir = sim.player.gravDir;
  }

  /** Kurzer Countdown für diesen Start? (Regel in wantsQuickCountdown; „zuletzt“ = zuletzt gestarteter Lauf dieser Sitzung) */
  private quickStartWanted(cfg: RunConfig): boolean {
    return wantsQuickCountdown({
      quickRestart: this.profile.settings.quickRestart,
      runs: this.profile.lifetime.runs,
      fromMenu: this.phase === "menu",
      sameAsLast: this.lastRunKey === runKey(cfg),
    });
  }

  /** Läuft ein echter (kein Demo-)Lauf, der noch nicht gebucht ist? (Countdown und Pause zählen dazu) */
  private runInProgress(): boolean {
    return !this.demo && !this.runBanked && !!this.sim && !!this.cfg && (this.phase === "running" || this.phase === "paused" || this.phase === "countdown");
  }

  /** Dauerklänge beenden (Dash, Rutschen, Weltschleifen). */
  private stopLoops(): void {
    for (const l of this.activeLoops) this.audio.loop(l, false);
    this.activeLoops.clear();
  }

  /**
   * Bucht den laufenden Lauf, höchstens einmal je Lauf und nur wenn etwas erreicht wurde (siehe isBankable).
   * Gibt Zusammenfassung und Ergebnis der Buchung zurück oder null, wenn nichts gebucht wurde.
   */
  private bankRunning(): { summary: FullRunSummary; rec: RecordResult } | null {
    const sim = this.sim;
    if (!sim || !this.runInProgress()) return null;
    const summary = summarizeRun(sim, { dailyKey: this.dailyKey, quit: true });
    if (!isBankable(summary)) return null;
    return this.commitRun(summary);
  }

  private commitRun(summary: FullRunSummary): { summary: FullRunSummary; rec: RecordResult } {
    this.runBanked = true;
    const rec = bankRun(this.profile, summary);
    this.commitProfile(rec.profile);
    return { summary, rec };
  }

  /**
   * Lauf aus der Pause (oder mitten im Lauf) beenden, ohne dass er verloren geht:
   * `result` bucht und zeigt die normale Ergebnis-Karte (Ursache „quit“, ohne Todes-Jingle; nichts erreicht: zurück ins Menü),
   * `restart` bucht still und startet neu, `menu` bucht still und geht ins Menü. Demo-Läufe und bereits gebuchte Läufe zählen nie doppelt.
   */
  quitRun(mode: QuitMode): void {
    if (mode === "menu") {
      this.toMenu();
      return;
    }
    if (mode === "restart") {
      this.restart();
      return;
    }
    const sim = this.sim;
    if (!sim || !this.runInProgress()) return;
    const banked = this.bankRunning();
    if (!banked) {
      this.toMenu();
      return;
    }
    this.frozen = true;
    this.resumeCountdown = 0;
    this.showResult(toRunResult(banked.summary, banked.rec, newRunId()), true);
  }

  /** Ergebnis-Karte anzeigen: Phase, Eingabe, Dauerklänge und Musik aufräumen (Tod und „Lauf beenden“). Beim Abbruch kein Todes-Jingle. */
  private showResult(result: RunResult, quit: boolean): void {
    this.result = result;
    this.victory = result.isNewBest;
    this.phase = "gameover";
    this.input.enabled = false;
    this.input.releaseAll();
    this.stopLoops();
    if (result.isNewBest) this.audio.sfx("highscore");
    else if (!quit) this.audio.sfx("gameover");
    this.audio.music.stop(1.4);
    this.releaseMuffle();
    this.emitChange();
  }

  restart(): void {
    if (!this.cfg) return;
    if (this.runInProgress()) {
      // Pause → Neustart: der laufende Lauf zählt (Münzen, Rekord), dann sofort anhalten – das Laden der Welt ist asynchron
      this.bankRunning();
      if (this.phase === "running" || this.phase === "countdown") this.phase = "paused";
      this.resumeCountdown = 0;
      this.input.enabled = false;
      this.input.releaseAll();
      this.stopLoops();
    }
    void this.startRun({ ...this.cfg, seed: this.cfg.mode === "daily" ? this.cfg.seed : undefined });
  }

  pause(): void {
    if (this.phase !== "running") return;
    this.phase = "paused";
    this.input.enabled = false;
    this.input.releaseAll();
    this.audio.duck(0.6, 0.2);
    this.syncMuffle(0.12);
    this.stopLoops();
    this.audio.sfx("ui-back");
    this.emitChange();
  }

  resume(): void {
    if (this.phase !== "paused") return;
    this.phase = "countdown";
    this.countdownT = 1.6;
    this.countdownSfx = 2;
    this.shownCount = this.countdownShown();
    this.resumeCountdown = 1;
    this.input.enabled = true;
    this.input.releaseAll();
    this.emitChange();
  }

  togglePause(): void {
    if (this.phase === "running") this.pause();
    else if (this.phase === "paused") this.resume();
    else if (this.phase === "countdown" && this.resumeCountdown === 0) this.toMenu();
  }

  toMenu(): void {
    // Pause → Hauptmenü darf den Lauf nicht verwerfen: still buchen (die Ergebnis-Karte zeigt quitRun("result"))
    if (this.runInProgress()) this.bankRunning();
    this.input.enabled = false;
    this.input.releaseAll();
    this.result = null;
    this.phase = "menu";
    this.victory = false;
    this.frozen = false;
    this.resumeCountdown = 0;
    this.stopLoops();
    this.audio.stopStingers?.(0.3);
    this.audio.music.play("menu", { crossfadeSec: 0.8 });
    this.releaseMuffle();
    this.demoWorld = this.profile.world;
    void this.awaitWorld(this.demoWorld).then(() => {
      if (this.phase === "menu") {
        this.pruneWorlds([this.demoWorld]);
        this.startDemo();
      }
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
    this.capturePrev(sim);
    this.slowK = 1;
    this.demo = true;
    this.acc = 0;
    this.renderer?.particles.clear();
    this.markDirty();
  }

  // ------------------------------------------------------------------------------------------
  // Spielschleife

  private tick = (now: number): void => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.tick);
    if (this.manual) return;
    // Ein Qualitätswechsel des Governors greift am Anfang des nächsten Frames: die neu angelegte Zeichenfläche wird im selben Frame gefüllt
    if (this.pendingQuality !== null) {
      const q = this.pendingQuality;
      this.pendingQuality = null;
      if (this.autoQuality) this.setQuality(q);
    }
    const rawDt = Math.max(0.0001, (now - this.last) / 1000);
    this.last = now;
    const dt = Math.min(0.1, rawDt);
    this.time += dt;
    this.trackFps(rawDt);
    const t0 = performance.now();
    const fullRate = this.frame(dt, now);
    // Nur Frames mit voller Rate sagen etwas über das Gerät: Pause, Game-Over-Karte, verdecktes Menü und Countdown (Dekodier-Warmup
    // belegt dort absichtlich den Hauptthread) werden nicht gewertet. busy = Arbeitszeit des Frames (ohne Wartezeit auf die Anzeige).
    if (fullRate && this.governor !== null && this.autoQuality && this.feedsGovernor() && this.settled(now)) {
      const next = this.governor.feed(rawDt * 1000, performance.now() - t0, now);
      if (next !== null) this.pendingQuality = next;
    }
  };

  /**
   * false in der Einschwingzeit nach einem Kontextwechsel: die ersten Frames einer neuen Szene/Welt/Größe hängen durch Bakes,
   * Dekodieren und Canvas-Neuanlage und sagen nichts über den Dauerbetrieb (sie würden den Governor fälschlich senken lassen).
   */
  private settled(now: number): boolean {
    const sim = this.sim;
    const wid = sim ? sim.world.id : null;
    if (this.phase !== this.feedPhase || sim !== this.feedSim || wid !== this.feedWorld || this.menuCovered !== this.feedCovered) {
      this.feedPhase = this.phase;
      this.feedSim = sim;
      this.feedWorld = wid;
      this.feedCovered = this.menuCovered;
      this.settlePending = true;
    }
    if (this.settlePending) {
      this.settlePending = false;
      this.settleUntil = now + GOVERNOR_SETTLE_MS;
    }
    return now >= this.settleUntil;
  }

  /** Wertet die aktuelle Lage für den Governor? Lauf und sichtbares Menü ja; Laden einer Welt (Hänger durch Bakes) und eingefrorene Szene nein */
  private feedsGovernor(): boolean {
    if (this.frozen || this.loadingWorld !== null) return false;
    return this.phase === "running" || (this.phase === "menu" && !this.menuCovered);
  }

  /** Phase für die Zeichen-Entscheidung: das eingefrorene Ergebnis nach „Lauf beenden“ steht wie die Pause */
  private drawPhase(): DrawPhase {
    return this.frozen && this.phase === "gameover" ? "paused" : this.phase;
  }

  /**
   * Ein Frame. `liveNow` (rAF-Zeitstempel) nur aus der Live-Schleife: dort kann die Zeichen-Drosselung (frame-policy.ts) den Frame
   * nach input.poll() überspringen. Ohne `liveNow` (debugAdvance/debugRender/debugSettle, Größenwechsel) wird immer gezeichnet.
   * Rückgabe: true = voll gezeichneter Frame (zählt für den Governor), false = übersprungen oder gedrosselt gezeichnet.
   */
  private frame(dt: number, liveNow?: number): boolean {
    const sim = this.sim;
    const r = this.renderer;
    if (!sim || !r) return false;
    this.input.poll();

    // Zeichen-Drosselung: Pause steht, Game-Over-Karte ca. 30 fps, verdecktes Menü ca. 8 fps
    const live = liveNow !== undefined;
    let fullRate = true;
    if (live) {
      const pp = this.drawPhase();
      if (pp !== this.drawnPhase) this.drawDirty = true;
      if (this.drawDirty) this.dirtyUntil = liveNow + DRAW_SETTLE_MS;
      if (!shouldDraw(pp, liveNow < this.dirtyUntil, this.menuCovered, this.victory, liveNow - this.lastDrawAt)) {
        this.skipDt = Math.min(0.5, this.skipDt + dt);
        return false;
      }
      fullRate = isFullRate(pp, this.menuCovered, this.victory);
      // Gedrosselte Phasen holen die übersprungene Zeit nach (Wolken, Partikel, Demo-Sim laufen in Echtzeit); volle Rate nie
      dt = fullRate ? dt : Math.min(0.1, dt + this.skipDt);
      this.skipDt = 0;
      this.drawnPhase = pp;
      this.lastDrawAt = liveNow;
    }

    // Countdown
    if (this.phase === "countdown") {
      // Eingaben aus Pause/Countdown dürfen nie in den Lauf rutschen (sonst springt die Figur bei „Los“ von allein)
      this.input.discardEdges();
      // Der Countdown läuft nur, solange das Spiel zu sehen und das Fenster aktiv ist (Fokusverlust, Hochformat-Hinweis halten ihn an)
      if (this.winFocused && this.winVisible && !this.portraitBlocked) {
        this.countdownT -= dt;
        const shown = Math.ceil(this.countdownT);
        if (shown < this.countdownSfx && shown >= 1) {
          this.countdownSfx = shown;
          this.audio.sfx("countdown");
        }
        const count = this.countdownShown();
        if (count !== this.shownCount) {
          // Zahl genau beim Wechsel melden, nicht erst mit dem nächsten FPS-Tick
          this.shownCount = count;
          this.emitChange();
        }
        if (this.countdownT <= 0 && !this.resumeCountdown && !this.warmDone && this.warmWaitT < WARM_WAIT_S) {
          // Dekodier-Warmup der Sprites noch nicht durch: „1“ bleibt kurz stehen (höchstens WARM_WAIT_S) statt mit dem ersten
          // Rutschen/Dash/Stampfer zu ruckeln
          this.warmWaitT += dt;
          this.countdownT = 0.02;
        } else if (this.countdownT <= 0) {
          this.phase = "running";
          this.input.discardEdges();
          this.audio.sfx("go");
          if (this.resumeCountdown) {
            this.resumeCountdown = 0;
            // Ende der Wiederaufnahme: Musik wieder voll (während des Countdowns blieb sie gedämpft wie in der Pause)
            this.syncMuffle(0.3);
          } else {
            sim.begin();
            this.runStartMs = performance.now();
            this.warmUntil = this.time + WARM_RUN_S;
            this.showToast(sim.world.name, sim.world.tagline, sim.world.accent);
          }
          this.emitChange();
        }
      }
    }

    // Visuelle Zeit: steht in Pause, nach „Lauf beenden“ und im Wiederaufnahme-Countdown (die Szene ist dann eingefroren);
    // Menü, Start-Countdown (Idle-Pose atmet) und Demo laufen weiter. this.time bleibt die Logik-Uhr.
    const still = this.phase === "paused" || this.frozen || (this.phase === "countdown" && this.resumeCountdown > 0);
    const visDt = still ? 0 : dt;
    this.visTime += visDt;

    const active = this.phase === "running" || this.demo;
    const simRunning = active && (sim.phase === "running" || sim.phase === "dying");
    if (simRunning) {
      if (this.hitstop > 0) {
        this.hitstop -= dt;
      } else {
        this.acc += dt;
        let n = 0;
        while (this.acc >= FIXED_DT && n < 16) {
          this.capturePrev(sim);
          const input: SimInput = this.demo && this.bot ? this.bot.input(sim, FIXED_DT) : this.input.consume(FIXED_DT);
          sim.step(FIXED_DT, input);
          this.acc -= FIXED_DT;
          n += 1;
          if (sim.events.length) this.consumeEvents(sim, r);
          if (sim.phase === "over") break;
        }
        if (n >= 16) this.acc = 0;
      }
    }

    if (sim.phase === "over" && !this.demo && this.phase === "running") this.finishRun(sim);
    if (sim.phase === "over" && this.demo) this.startDemo();

    // Weltsteuerung (Stimmung, Musik, Loops, Toasts)
    if (active && sim.phase === "running") this.worldTick(sim, dt);

    // Zeitlupe: weiche Rampe (0,2 s) der visuellen Zeit; die Sim bremst nur die Weltbewegung, hart
    const slowNow = sim.phase === "running" && sim.player.slowmo > 0;
    const slowStep = visDt * SLOW_RAMP_RATE;
    this.slowK = slowNow ? Math.max(SLOWMO_FACTOR, this.slowK - slowStep) : Math.min(1, this.slowK + slowStep);
    // Welt, Partikel, Geister und Lauf-Phase laufen mit fxDt: in der Zeitlupe nicht schneller als der Boden
    const fxDt = visDt * this.slowK;
    const effFlashes = this.effFlashes();
    const rawView = sim.view(this.hitstop > 0 || !simRunning ? 1 : Math.min(1, this.acc / FIXED_DT), this.prev, this.reducedMotion, this.quality, fxDt, effFlashes);
    // Jede Welt bekommt nur Stufen im eigenen Bereich; die Zielwelt eines Tores beginnt bei Stufe 0.
    const view: ViewState = { ...rawView, stage: Math.min(rawView.stage, sim.world.stageCount - 1) };
    let cur = this.worldRenderers.get(sim.world.id) ?? null;
    if (!cur) {
      // Welt (noch) nicht geladen, z.B. langsames Nachladen in der Weltreise: neutraler Ersatz, bis sie bereit ist
      void this.ensureWorld(sim.world.id);
      this.fallbackRenderer ??= new BasicRenderer(220);
      cur = this.fallbackRenderer;
    }
    const gate = sim.nextGate;
    const nxt = gate ? this.worldRenderers.get(gate.to) ?? null : null;
    // Vorwärmen in 3-ms-Scheiben (WorldRenderer.warm): aktuelle Welt im Countdown, in der Menü-Demo und in den ersten 20 s des Laufs,
    // die Zielwelt eines Tores, sobald sie geladen ist. Nur in der Live-Schleife (QA-Aufnahmen backen wie bisher lazy).
    if (live && !still) {
      if (this.phase !== "running" || this.time < this.warmUntil) this.warmSlice(sim.world.id, cur);
      if (nxt && gate) this.warmSlice(gate.to, nxt);
    }
    const nextView: ViewState = { ...rawView, stage: 0, stageBlend: 0, worldMeters: 0 };
    if (!still) {
      this.guard(sim.world.id, () => cur?.update(fxDt, view));
      if (nxt && gate && sim.gateBlend > 0.001) this.guard(gate.to, () => nxt.update(fxDt, nextView));
      // Boden-Geschwindigkeit in Partikelzeit: weltfester Staub bewegt sich um scroll * fxDt = Boden-Weg des Frames (Sim-Zeitskala 0,62
      // in der Zeitlupe, bei harter Sim-Stufe und weicher fxDt-Rampe); im Hitstop steht der Boden (0)
      const ground = sim.phase === "running" && this.hitstop <= 0 ? sim.speed * (slowNow ? SLOWMO_FACTOR : 1) / this.slowK : 0;
      r.update(fxDt, sim, ground);
    }

    // Shake / Flash
    this.shake = Math.max(0, this.shake - dt * 2.8);
    this.flashV = Math.max(0, this.flashV - dt * 3.2);
    this.shakeSeed += dt * 60;
    const sh = this.shake * this.shake * 14 * this.effShake();
    const flashTotal = Math.max(this.flashV, sim.flash) * effFlashes;

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
      time: this.visTime,
      showPlayer: true,
      idle: this.phase === "countdown" && !this.resumeCountdown && sim.phase === "ready",
      victory: this.victory,
    };
    try {
      r.draw(frame);
    } catch (err) {
      this.renderFailed(sim.world.id, err);
    }
    // Pause/Ergebnis stehen erst, wenn Wackeln und Blitz ausgelaufen sind; bis dahin zeichnet auch die gedrosselte Phase weiter
    this.drawDirty = this.shake > 0 || this.flashV > 0;
    return fullRate;
  }

  /** Ruft warm() eines Welt-Renderers auf, bis er „fertig“ meldet (danach nie wieder); ein Fehler beendet das Aufwärmen dieser Welt */
  private warmSlice(id: WorldId, w: WorldRenderer): void {
    if (!w.warm || this.warmedWorlds.has(w)) return;
    try {
      if (w.warm(WARM_SLICE_MS)) this.warmedWorlds.add(w);
    } catch (err) {
      this.warmedWorlds.add(w);
      this.renderFailed(id, err);
    }
  }

  /**
   * Beginnt das Warten auf das Dekodier-Warmup der Sprites (assets.warmed): „dringend“, weil Ladebildschirm/Countdown ein Ruckeln
   * vertragen; der Countdown hält höchstens WARM_WAIT_S bei „1“, bis es fertig ist.
   */
  private beginWarmWait(): void {
    const token = ++this.warmToken;
    this.warmDone = false;
    this.warmWaitT = 0;
    void this.assets.warmed(true).then(
      () => {
        if (token === this.warmToken) this.warmDone = true;
      },
      () => {
        if (token === this.warmToken) this.warmDone = true;
      },
    );
  }

  /** Wirksames Wackeln 0..1 (Regler „Wackeln“; „Weniger Bewegung“ schaltet es ab) */
  private effShake(): number {
    return this.reducedMotion ? 0 : unit(this.profile.settings.shake);
  }

  /** Wirksame Blitz-Stärke 0..1 (Regler „Blitze“; „Weniger Bewegung“ begrenzt auf 0,3) */
  private effFlashes(): number {
    const f = unit(this.profile.settings.flashes);
    return this.reducedMotion ? Math.min(f, 0.3) : f;
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
    const live = !this.demo;
    const hap = this.hapOpts;
    hap.enabled = this.profile.settings.haptics;
    hap.demo = this.demo;
    for (const ev of sim.events) {
      r.handleEvent(ev, sim, this.visTime);
      if (live) this.feedbackFor(ev, sim);
      switch (ev.type) {
        case "hurt":
          this.hitstop = Math.max(this.hitstop, 0.07);
          this.shake = Math.max(this.shake, 1);
          // Ein tödlicher Treffer vibriert nur als Tod (kein doppelter Impuls); reducedMotion beeinflusst die Haptik nicht
          if ((ev.value ?? 1) > 0) this.vibrate("hurt", RUMBLE_HURT);
          break;
        case "stomp-land":
          this.shake = Math.max(this.shake, 0.55);
          this.hitstop = Math.max(this.hitstop, 0.035);
          haptic("stomp", hap);
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
          this.vibrate("death", RUMBLE_DEATH);
          break;
        case "portal":
          this.flashV = Math.max(this.flashV, 0.22);
          this.flashColor = "#c4b5fd";
          break;
        case "world-transition":
          this.warmUntil = this.time + WARM_RUN_S; // neue aktuelle Welt: noch einmal 20 s aufwärmen
          this.flashV = 0.7;
          this.flashColor = "#c4b5fd";
          this.pruneAt = this.time + 3;
          // music.play() der Audio-Zuordnung setzt die Engine-Dämpfung auf 0: eine laufende Zeitlupen-Dämpfung neu senden
          if (this.slowMuffle) {
            this.muffleSent = -1;
            this.syncMuffle(0.3);
          }
          break;
        case "pit-fall":
          this.flashV = PIT_FLASH;
          this.flashColor = "#ffffff";
          haptic("pit", hap);
          break;
        case "dash":
          haptic("dash", hap);
          break;
        case "powerup":
          haptic("powerup", hap);
          break;
        case "dash-denied":
          this.dashDeniedAt = this.visTime;
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
    sim.events.length = 0;
  }

  /** Vibration (Handy) und Controller-Rumble; nur mit Einstellung „Vibration“ und nie in der Demo. Wirft nie. */
  private vibrate(kind: "hurt" | "death", rumble: readonly [number, number]): void {
    if (!this.hapOpts.enabled || this.hapOpts.demo) return;
    haptic(kind, this.hapOpts);
    this.input.rumble(rumble[0], rumble[1]);
  }

  /** Alles, was ein Sim-Ereignis außerhalb der Demo auslöst, ohne die Szene zu ändern: Ton, Hinweis-Planer (benutzte Mechaniken). */
  private feedbackFor(ev: SimEvent, sim: Sim): void {
    switch (ev.type) {
      case "jump":
        this.hints.markUsed("jump");
        break;
      case "doublejump":
        this.hints.markUsed("jump");
        this.hints.markUsed("doublejump");
        break;
      case "slide":
        this.hints.markUsed("slide");
        break;
      case "dash":
        this.hints.markUsed("dash");
        break;
      case "stomp-start":
      case "stomp-land":
      case "bounce":
      case "enemy-defeat":
        this.hints.markUsed("stomp");
        break;
      case "dash-denied":
        // Die Sim begrenzt auf alle 0,4 s; hier zusätzlich, falls Ereignisse gebündelt eintreffen (Ton nur einmal)
        if (this.visTime - this.dashDeniedSfxAt < DASH_DENIED_GAP_S) return;
        this.dashDeniedSfxAt = this.visTime;
        break;
      default:
        break;
    }
    this.gameAudio.onEvent(ev, sim);
  }

  private worldTick(sim: Sim, dt: number): void {
    const a = this.audio;
    if (sim.cfg.mode === "tour") {
      const idx = TOUR_ORDER.indexOf(sim.world.id);
      const next = TOUR_ORDER[(idx + 1) % TOUR_ORDER.length];
      if (sim.worldMeters >= TOUR_METERS - 500 && !this.worldRenderers.has(next) && !this.worldLoading.has(next)) {
        void this.ensureWorld(next);
        this.prefetchAudio([WORLDS[next].music]);
      }
      if (this.pruneAt > 0 && this.time > this.pruneAt) {
        this.pruneAt = 0;
        this.pruneWorlds([sim.world.id, ...(sim.nextGate ? [sim.nextGate.to] : []), ...(this.worldLoading.has(next) && sim.worldMeters >= TOUR_METERS - 500 ? [next] : [])]);
      }
    }
    if (!this.demo) {
      // Zustands-Hinweise (Dash bereit, letztes Herz, Ende der Zeitlupe) und Zonen-Sperren laufen auf der Frame-Zeit
      this.gameAudio.tick(dt, sim, false);
      // Zeitlupe dämpft die Musik leicht
      const slow = sim.player.slowmo > 0;
      if (slow !== this.slowMuffle) {
        this.slowMuffle = slow;
        this.syncMuffle(0.2);
      }
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
      // Einsteiger-Hinweise und Rekordjagd (nur echte Läufe)
      this.updateHints(sim, dt);
      if (!this.recordPassed) this.checkRecord(sim);
    }
    if (this.toast) {
      this.toast.t += dt;
      if (this.toast.t >= this.toast.dur) this.toast = null;
    }
  }

  private showToast(title: string, sub: string | undefined, color: string): void {
    this.toast = { title, sub, color, t: 0, dur: 3 };
  }

  /**
   * Einsteiger-Hinweise (erste Läufe, Einstellung „Hinweise“): der Planer wählt nach Lage statt nach Uhrzeit – sobald das erste passende
   * Element (Überhang, Gegner, Grube) weniger als HINT_LOOKAHEAD_PX vor der Figur steht und die Mechanik in diesem Lauf noch nicht benutzt wurde.
   */
  private updateHints(sim: Sim, dt: number): void {
    const s = this.profile.settings;
    const runs = this.profile.lifetime.runs;
    if (this.demo || !this.hintsAllowed || !s.hints || runs >= HINT_MAX_RUNS) {
      this.hintText = null;
      return;
    }
    const ctx = this.hintCtx;
    const px = sim.playerWorldX;
    let over = Number.POSITIVE_INFINITY;
    let pit = Number.POSITIVE_INFINITY;
    let stomp = Number.POSITIVE_INFINITY;
    const ents = sim.ents;
    for (let i = 0; i < ents.length; i += 1) {
      const e = ents[i];
      const dx = e.x - px;
      if (e.dead || dx < 0) continue;
      if (e.kind === "overhead") {
        if (dx < over) over = dx;
      } else if (e.kind === "pit") {
        if (dx < pit) pit = dx;
      } else if ((e.kind === "walker" || e.kind === "flyer") && e.stompable) {
        if (dx < stomp) stomp = dx;
      }
    }
    const p = sim.player;
    ctx.time = sim.time;
    ctx.touch = this.touchMode;
    ctx.runs = runs;
    ctx.hintsEnabled = true;
    ctx.overheadDist = over;
    ctx.pitDist = pit;
    ctx.stompDist = stomp;
    ctx.energyReady = p.energy >= sim.perks.dashCost && p.dashCd <= 0;
    const h = this.hints.update(dt, ctx);
    this.hintText = h ? h.text : null;
  }

  /** Rekordjagd: einmal je Lauf, sobald der Score den bisherigen Rekord dieser Bestenliste übersteigt (nie bei Rekord 0 und nie in der Demo). */
  private checkRecord(sim: Sim): void {
    const best = this.profile.best[this.runBoardKey] ?? 0;
    if (!(best > 0) || sim.score <= best) return;
    this.recordPassed = true;
    this.showToast("Neuer Rekord!", `${formatNumber(best)} geknackt`, RECORD_COLOR);
    this.audio.sfx("checkpoint");
    this.flashV = Math.max(this.flashV, RECORD_FLASH);
    this.flashColor = RECORD_COLOR;
  }

  private buildHud(sim: Sim): HudState {
    const p = sim.player;
    const powerups = [] as HudState["powerups"];
    // left = Restzeit in Sekunden (die Ringe blinken unter 2 s)
    if (p.magnet > 0) powerups.push({ kind: "magnet", frac: p.magnet / MAGNET_TIME, left: p.magnet });
    if (p.shield > 0) powerups.push({ kind: "shield", frac: p.shield / SHIELD_TIME, left: p.shield });
    if (p.slowmo > 0) powerups.push({ kind: "slowmo", frac: p.slowmo / SLOWMO_TIME, left: p.slowmo });
    if (p.turbo > 0) powerups.push({ kind: "turbo", frac: p.turbo / TURBO_TIME, left: p.turbo });
    const toast: HudToast | null = this.toast ? { title: this.toast.title, sub: this.toast.sub, color: this.toast.color, u: this.toast.t / this.toast.dur } : null;
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
      best: this.profile.best[this.runBoardKey] ?? 0,
      hint: this.hintText,
      tourFrac: sim.cfg.mode === "tour" ? Math.min(1, sim.worldMeters / TOUR_METERS) : null,
      time: this.visTime,
      chaseWarn: sim.vars.chaseWarn ?? 0,
      touch: this.touchMode,
      reduced: this.reducedMotion,
      dashDeniedT: Math.min(99, this.visTime - this.dashDeniedAt),
      recordPassed: this.recordPassed,
    };
  }

  /** Tod: Lauf buchen und die Ergebnis-Karte zeigen (ein schon gebuchter Lauf, z. B. durch „Lauf beenden“, zählt nicht doppelt). */
  private finishRun(sim: Sim): void {
    if (this.runBanked) return;
    const { summary, rec } = this.commitRun(summarizeRun(sim, { dailyKey: this.dailyKey }));
    this.showResult(toRunResult(summary, rec, newRunId()), false);
  }

  /** Bildrate fürs UI (rAF-Takt, auch wenn ein Frame wegen der Zeichen-Drosselung nicht gezeichnet wird) */
  private trackFps(rawDt: number): void {
    this.fpsAcc += rawDt;
    this.fpsN += 1;
    if (this.fpsAcc >= 0.5) {
      this.fps = Math.round(this.fpsN / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsN = 0;
      this.emitChange();
    }
  }

  // ------------------------------------------------------------------------------------------
  // Debug / QA (Screenshot-Werkzeug, Tests)

  /** Startet sofort einen Lauf ohne Countdown; Bot-gesteuert. Für QA-Screenshots. */
  setManual(v: boolean): void {
    this.manual = v;
    this.last = performance.now();
    this.acc = 0;
    this.skipDt = 0;
    this.markDirty();
  }

  async debugRun(cfg: Partial<RunConfig> & { bot?: boolean; hearts?: number; live?: boolean; hints?: boolean }): Promise<void> {
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
    this.runBanked = false;
    this.frozen = false;
    this.resumeCountdown = 0;
    this.result = null;
    this.capturePrev(sim);
    this.dailyKey = sim.cfg.mode === "daily" ? dateKey() : "";
    this.resetRunFeedback(sim.cfg, this.dailyKey);
    this.hintsAllowed = cfg.hints === true;
    this.renderer?.particles.clear();
    this.input.enabled = true;
    this.warmUntil = this.time + WARM_RUN_S;
    this.markDirty();
  }

  /** Simuliert `seconds` deterministisch (mit Bot) und zeichnet einen Frame. */
  debugAdvance(seconds: number, opts: { botOff?: boolean; input?: SimInput } = {}): { score: number; meters: number; hearts: number; phase: string; worldId: string } {
    const sim = this.sim;
    const r = this.renderer;
    if (!sim || !r) throw new Error("kein Lauf");
    const steps = Math.round(seconds / FIXED_DT);
    for (let i = 0; i < steps; i += 1) {
      this.capturePrev(sim);
      const input = opts.input ?? (this.bot && !opts.botOff ? this.bot.input(sim, FIXED_DT) : NO_INPUT);
      sim.step(FIXED_DT, input);
      if (sim.events.length) this.consumeEvents(sim, r);
      if (sim.phase === "running" && i % 6 === 0) {
        const raw = sim.view(1, this.prev, this.reducedMotion, this.quality, FIXED_DT * 6, this.effFlashes());
        const view: ViewState = { ...raw, stage: Math.min(raw.stage, sim.world.stageCount - 1) };
        this.guard(sim.world.id, () => this.worldRenderers.get(sim.world.id)?.update(FIXED_DT * 6, view));
        const gate = sim.nextGate;
        if (gate) this.guard(gate.to, () => this.worldRenderers.get(gate.to)?.update(FIXED_DT * 6, { ...raw, stage: 0, stageBlend: 0, worldMeters: 0 }));
        r.update(FIXED_DT * 6, sim, sim.speed);
      }
      this.time += FIXED_DT;
      this.visTime += FIXED_DT;
      if (sim.phase === "over") break;
    }
    this.hitstop = 0;
    this.flashV = Math.max(0, this.flashV - seconds * 3.2);
    this.shake = 0;
    this.frame(0.0001);
    return { score: sim.score, meters: sim.meters, hearts: sim.player.hearts, phase: sim.phase, worldId: sim.world.id };
  }

  /** QA: läuft weiter, bis die Figur am Boden steht, entfernt Partikel/Popups und zeichnet neu (saubere Vorschaubilder). */
  debugSettle(maxSeconds = 2.5): void {
    const sim = this.sim;
    if (!sim) return;
    let t = 0;
    while (t < maxSeconds && !(sim.player.grounded && sim.player.hgt <= 0.5 && sim.phase === "running")) {
      this.debugAdvance(0.05);
      t += 0.05;
    }
    this.renderer?.particles.clear();
    this.frame(0.0001);
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
