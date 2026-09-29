/**
 * Die Engine: verdrahtet AudioContext, Master-Graph, SFX, Loops und Musik zur öffentlichen `FredAudio`-API.
 *
 * Lebenszyklus: Vor `unlock()` existiert kein AudioContext (Autoplay-Policy). `unlock()` erzeugt und resumed ihn
 * synchron innerhalb der Geste. Aufrufe wie `music.play()`/`loop(on)` VOR dem Unlock werden gemerkt und starten,
 * sobald der Kontext läuft. Ohne Web-Audio (SSR/Node/alte Browser) liefert `createNoopAudio()` ein stummes Objekt.
 */
import { clamp } from "./dsp";
import {
  applyMaster,
  applyMusicVolume,
  applySfxVolume,
  buildGraph,
  clamp01,
  DEFAULT_VOLUMES,
  duckMusic,
  sfxAudible,
  type AudioGraph,
  type Volumes,
} from "./graph";
import { LoopBank } from "./loops";
import { MusicDirector, TIMER_MS, type NoteLogEntry } from "./music";
import { SFX_META, SfxPlayer } from "./sfx";
import type { FredAudio, LoopName, SfxName, SfxOptions, WorldMusicId } from "./types";

type AudioCtor = new (options?: AudioContextOptions) => AudioContext;

export function resolveContextCtor(): AudioCtor | null {
  const gt = globalThis as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return gt.AudioContext ?? gt.webkitAudioContext ?? null;
}

/** Stummes Ersatzobjekt (SSR, Tests ohne AudioContext, Browser ohne Web Audio). Merkt sich nur trivialen Zustand. */
export function createNoopAudio(): FredAudio {
  let muted = false;
  let current: WorldMusicId | null = null;
  return {
    unlock: () => Promise.resolve(),
    get unlocked() {
      return false;
    },
    sfx: () => {},
    loop: () => {},
    music: {
      play(id) {
        current = id;
      },
      setIntensity: () => {},
      stop() {
        current = null;
      },
      get current() {
        return current;
      },
    },
    setMasterVolume: () => {},
    setMusicVolume: () => {},
    setSfxVolume: () => {},
    setMuted(m) {
      muted = !!m;
    },
    get muted() {
      return muted;
    },
    duck: () => {},
    suspend: () => {},
    resume: () => {},
    setTempoScale: () => {},
    dispose: () => {},
  };
}

export interface EngineDebug {
  readonly ctx: AudioContext | null;
  readonly graph: AudioGraph | null;
  readonly sfxPlayer: SfxPlayer | null;
  readonly director: MusicDirector | null;
  readonly loops: LoopBank | null;
  readonly timerActive: boolean;
  /** Ein Scheduler-Tick von Hand (Tests, ohne echten Timer). */
  tick(): void;
  /** true: alle vom Scheduler geplanten Noten werden in `noteLog` protokolliert. */
  recordNotes: boolean;
  noteLog: NoteLogEntry[];
}

const noop = (): void => {};

export function createEngine(Ctor: AudioCtor): { audio: FredAudio; debug: EngineDebug } {
  let ctx: AudioContext | null = null;
  let graph: AudioGraph | null = null;
  let sfxPlayer: SfxPlayer | null = null;
  let director: MusicDirector | null = null;
  let loops: LoopBank | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  let disposed = false;
  let suspended = false;
  let everRunning = false;
  let lastResumeTry = -Infinity;
  let tempo = 1;
  let volumes: Volumes = { ...DEFAULT_VOLUMES };
  let pendingPlay: { id: WorldMusicId; opts?: { crossfadeSec?: number; intensity?: number } } | null = null;
  const pendingLoops = new Map<LoopName, number | null>();

  const debugState = { recordNotes: false, noteLog: [] as NoteLogEntry[] };

  const ready = (): boolean => !disposed && ctx !== null && graph !== null && everRunning && !suspended && ctx.state === "running";

  function stopTimer(): void {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }

  function tick(): void {
    if (!director || !ready()) return;
    director.tick();
    if (!director.running) stopTimer();
  }

  function startTimer(): void {
    if (timer !== null || !director?.running || !ready()) return;
    timer = setInterval(tick, TIMER_MS);
    (timer as unknown as { unref?: () => void }).unref?.();
  }

  function ensureContext(): boolean {
    if (disposed) return false;
    if (ctx && graph) return true;
    try {
      try {
        ctx = new Ctor({ latencyHint: "interactive" });
      } catch {
        ctx = new Ctor();
      }
      graph = buildGraph(ctx, volumes);
      volumes = graph.volumes;
      sfxPlayer = new SfxPlayer(graph);
      director = new MusicDirector(graph);
      director.onNote = (e) => {
        if (debugState.recordNotes) debugState.noteLog.push(e);
      };
      director.setTempoScale(tempo);
      loops = new LoopBank(graph);
      ctx.onstatechange = () => {
        // Browser hat den Kontext (z.B. nach iOS-Unterbrechung) wieder gestartet
        if (ctx && ctx.state === "running" && everRunning && !suspended) {
          director?.resync();
          startTimer();
        }
      };
      return true;
    } catch {
      ctx = null;
      graph = null;
      sfxPlayer = null;
      director = null;
      loops = null;
      return false;
    }
  }

  function onRunning(): void {
    everRunning = true;
    if (!ready()) return;
    for (const [name, level] of pendingLoops) loops?.set(name, level !== null, level ?? 0);
    pendingLoops.clear();
    if (pendingPlay && director) {
      const p = pendingPlay;
      pendingPlay = null;
      director.play(p.id, p.opts);
    }
    startTimer();
  }

  function unlock(): Promise<void> {
    if (disposed || !ensureContext() || !ctx) return Promise.resolve();
    const c = ctx;
    if (everRunning && c.state === "running") return Promise.resolve();
    suspended = false;
    // iOS/Safari: einen (stillen) Puffer innerhalb der Geste starten schaltet die Ausgabe frei
    try {
      const b = c.createBuffer(1, 1, 22050);
      const s = c.createBufferSource();
      s.buffer = b;
      s.connect(c.destination);
      s.onended = () => s.disconnect();
      s.start(0);
    } catch {
      /* egal */
    }
    if (typeof c.resume !== "function") {
      onRunning();
      return Promise.resolve();
    }
    let p: Promise<void>;
    try {
      p = c.resume();
    } catch {
      p = Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimeout(t);
        if (!disposed && c.state === "running") onRunning();
        resolve();
      };
      // resume() kann in Safari ohne Geste ewig hängen -> nie länger als ~1.2 s warten
      const t = setTimeout(finish, 1200);
      (t as unknown as { unref?: () => void }).unref?.();
      p.then(finish, finish);
    });
  }

  function tryAutoResume(): void {
    if (!ctx || !everRunning || suspended || disposed || typeof ctx.resume !== "function") return;
    const now = Date.now();
    if (now - lastResumeTry < 500) return;
    lastResumeTry = now;
    try {
      ctx.resume().catch(noop);
    } catch {
      /* egal */
    }
  }

  function sfx(name: SfxName, opts?: SfxOptions): void {
    if (!graph || !sfxPlayer) return;
    if (!ready()) {
      tryAutoResume();
      return;
    }
    if (!sfxAudible(graph)) return;
    const voice = sfxPlayer.play(name, opts);
    if (voice) {
      const d = SFX_META[name].duck;
      if (d) duckMusic(graph, d[0], d[1]);
    }
  }

  function loop(name: LoopName, on: boolean, level = 1): void {
    if (disposed) return;
    if (!ready() || !loops) {
      pendingLoops.set(name, on ? clamp01(level) : null);
      return;
    }
    loops.set(name, on, level);
  }

  const music: FredAudio["music"] = {
    play(id, opts) {
      if (disposed) return;
      if (!ready() || !director) {
        pendingPlay = { id, opts };
        return;
      }
      pendingPlay = null;
      director.play(id, opts);
      startTimer();
    },
    setIntensity(v, rampSec) {
      if (disposed) return;
      director?.setIntensity(v, rampSec);
    },
    stop(fadeSec) {
      pendingPlay = null;
      if (disposed) return;
      director?.stop(fadeSec);
    },
    get current() {
      if (pendingPlay) return pendingPlay.id;
      return director?.current ?? null;
    },
  };

  const audio: FredAudio = {
    unlock,
    get unlocked() {
      return !disposed && ctx !== null && everRunning && (suspended || ctx.state === "running");
    },
    sfx,
    loop,
    music,
    setMasterVolume(v) {
      volumes.master = clamp01(v);
      if (graph) applyMaster(graph);
    },
    setMusicVolume(v) {
      volumes.music = clamp01(v);
      if (graph) applyMusicVolume(graph);
    },
    setSfxVolume(v) {
      volumes.sfx = clamp01(v);
      if (graph) applySfxVolume(graph);
    },
    setMuted(m) {
      volumes.muted = !!m;
      if (graph) applyMaster(graph);
    },
    get muted() {
      return volumes.muted;
    },
    duck(amount, sec) {
      if (graph && ready()) duckMusic(graph, amount, sec);
    },
    suspend() {
      if (disposed || !ctx) return;
      suspended = true;
      stopTimer();
      try {
        ctx.suspend().catch(noop);
      } catch {
        /* egal */
      }
    },
    resume() {
      if (disposed || !ctx) return;
      suspended = false;
      const c = ctx;
      const after = (): void => {
        if (disposed || suspended) return;
        if (c.state === "running") {
          everRunning = true;
          director?.resync();
          startTimer();
        }
      };
      try {
        c.resume().then(after, noop);
      } catch {
        after();
      }
    },
    setTempoScale(v) {
      tempo = clamp(Number.isFinite(v) ? v : 1, 1, 1.25);
      director?.setTempoScale(tempo);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopTimer();
      pendingPlay = null;
      pendingLoops.clear();
      try {
        loops?.dispose();
        director?.dispose();
        sfxPlayer?.dispose();
      } catch {
        /* egal */
      }
      const c = ctx;
      ctx = null;
      graph = null;
      sfxPlayer = null;
      director = null;
      loops = null;
      try {
        c?.close().catch(noop);
      } catch {
        /* egal */
      }
    },
  };

  const debug: EngineDebug = {
    get ctx() {
      return ctx;
    },
    get graph() {
      return graph;
    },
    get sfxPlayer() {
      return sfxPlayer;
    },
    get director() {
      return director;
    },
    get loops() {
      return loops;
    },
    get timerActive() {
      return timer !== null;
    },
    tick,
    get recordNotes() {
      return debugState.recordNotes;
    },
    set recordNotes(v: boolean) {
      debugState.recordNotes = v;
    },
    get noteLog() {
      return debugState.noteLog;
    },
    set noteLog(v: NoteLogEntry[]) {
      debugState.noteLog = v;
    },
  };

  return { audio, debug };
}
