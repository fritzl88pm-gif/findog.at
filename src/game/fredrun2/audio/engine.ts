/**
 * Die Engine: verdrahtet AudioContext, Master-Graph, SFX, Loops und Musik zur öffentlichen `FredAudio`-API.
 *
 * Lebenszyklus: Vor `unlock()` existiert kein AudioContext (Autoplay-Policy). `unlock()` erzeugt und resumed ihn
 * synchron innerhalb der Geste. Aufrufe wie `music.play()`/`loop(on)` VOR dem Unlock werden gemerkt und starten,
 * sobald der Kontext läuft – auch wenn das „running“ erst Sekunden nach dem (1.2-s-)Ende von `unlock()` eintrifft
 * (langsames Gerät, Safari/iOS): die Entscheidung trifft `onstatechange`, nicht das Zeitlimit. Ohne Web-Audio
 * (SSR/Node/alte Browser) liefert `createNoopAudio()` ein stummes Objekt.
 */
import { withRev } from "../asset-rev";
import { BANK_BASE_URL, BANK_MANIFEST_FILE } from "./bank";
import { clamp } from "./dsp";
import {
  applyMaster,
  applyMusicVolume,
  applySfxVolume,
  buildGraph,
  clamp01,
  DEFAULT_VOLUMES,
  duckMusic,
  musicAudible,
  releaseDuck,
  setMuffle as applyMuffle,
  sfxAudible,
  type AudioGraph,
  type Volumes,
} from "./graph";
import { LoopBank } from "./loops";
import { MusicDirector, TIMER_MS, type NoteLogEntry } from "./music";
import { SFX_META, SfxPlayer } from "./sfx";
import { isJingle, JINGLES, JinglePlayer, MUSIC_BASE, MusicLibrary, TrackMusic } from "./tracks";
import type { FredAudio, LoopName, MusicTrackId, SfxName, SfxOptions, WorldMusicId } from "./types";

type AudioCtor = new (options?: AudioContextOptions) => AudioContext;

export function resolveContextCtor(): AudioCtor | null {
  const gt = globalThis as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return gt.AudioContext ?? gt.webkitAudioContext ?? null;
}

/** Stummes Ersatzobjekt (SSR, Tests ohne AudioContext, Browser ohne Web Audio). Merkt sich nur trivialen Zustand. */
export function createNoopAudio(): FredAudio {
  let muted = false;
  let current: MusicTrackId | null = null;
  return {
    unlock: () => Promise.resolve(),
    get unlocked() {
      return false;
    },
    sfx: () => {},
    stopStingers: () => {},
    prefetch: () => {},
    loop: () => {},
    music: {
      play(id) {
        current = id;
      },
      setIntensity: () => {},
      setMuffle: () => {},
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

/**
 * Wärmt den HTTP-Cache für Audiodateien vor: SFX-Bank (Manifest + MP3), Musik-Manifest und je angegebenem Stück genau eine
 * Variante (dieselbe, die `music.play` später wählt). Nur Download mit niedriger Priorität, kein Dekodieren (kein zusätzlicher
 * Speicher), kein AudioContext und keine Geste nötig; ohne fetch (SSR) wirkungslos. `music` fehlt → nur das Menüstück,
 * `music: []` → nur Bank und Manifest.
 */
export function prefetchAudio(library: MusicLibrary, opts: { music?: readonly string[] } = {}): void {
  if (typeof fetch !== "function") return;
  const manifestUrl = withRev(BANK_BASE_URL + BANK_MANIFEST_FILE);
  if (library.claim(manifestUrl)) {
    fetch(manifestUrl, { priority: "low" })
      .then((r) => {
        if (!r.ok) throw new Error(`${manifestUrl}: ${r.status}`);
        return r.json() as Promise<{ file?: unknown; rev?: unknown }>;
      })
      .then((m) => {
        if (typeof m.file !== "string") return undefined;
        // dieselbe URL wie SfxBank.load (bank.ts), damit der Browser-Cache trifft
        return library.warm(typeof m.rev === "string" && m.rev ? `${BANK_BASE_URL}${m.file}?v=${m.rev}` : withRev(BANK_BASE_URL + m.file));
      })
      .catch(() => library.release(manifestUrl));
  }
  library.prefetch(opts.music ?? ["menu"]);
}

export interface EngineDebug {
  readonly ctx: AudioContext | null;
  readonly graph: AudioGraph | null;
  readonly sfxPlayer: SfxPlayer | null;
  readonly director: MusicDirector | null;
  readonly loops: LoopBank | null;
  readonly tracks: TrackMusic | null;
  readonly jingles: JinglePlayer | null;
  readonly library: MusicLibrary;
  readonly timerActive: boolean;
  /** Ein Scheduler-Tick von Hand (Tests, ohne echten Timer). */
  tick(): void;
  /** true: alle vom Scheduler geplanten Noten werden in `noteLog` protokolliert. */
  recordNotes: boolean;
  noteLog: NoteLogEntry[];
}

const noop = (): void => {};

/** `library`: gemeinsame Musik-Bibliothek (Variantenwahl/Vorwärmen), z. B. mit `preloadAudio` aus index.ts geteilt. */
export function createEngine(Ctor: AudioCtor, opts: { library?: MusicLibrary } = {}): { audio: FredAudio; debug: EngineDebug } {
  const library = opts.library ?? new MusicLibrary();
  let ctx: AudioContext | null = null;
  let graph: AudioGraph | null = null;
  let sfxPlayer: SfxPlayer | null = null;
  let director: MusicDirector | null = null;
  /** aufgenommene Musik (Suno-Schleifen); die prozedurale `director`-Musik dient als Fallback */
  let tracks: TrackMusic | null = null;
  let jingles: JinglePlayer | null = null;
  let tracksFailed = false;
  let lastPlay: { id: MusicTrackId; opts?: { crossfadeSec?: number; intensity?: number } } | null = null;
  let loops: LoopBank | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  let disposed = false;
  let suspended = false;
  let everRunning = false;
  let jinglePrefetchTimer = false;
  let lastResumeTry = -Infinity;
  let tempo = 1;
  /** gewünschte Musikdämpfung (setMuffle), gilt auch für einen Kontext, der erst später entsteht */
  let muffleAmount = 0;
  /** unlock() wurde mindestens einmal aufgerufen: erst dann darf audioSession angefasst werden */
  let sessionWanted = false;
  let volumes: Volumes = { ...DEFAULT_VOLUMES };
  let pendingPlay: { id: MusicTrackId; opts?: { crossfadeSec?: number; intensity?: number } } | null = null;
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
      sfxPlayer.enableBank(); // Sample-Bank (bank.ts) lädt ab jetzt; bis dahin spielen die prozeduralen Stimmen
      director = new MusicDirector(graph);
      director.onNote = (e) => {
        if (debugState.recordNotes) debugState.noteLog.push(e);
      };
      director.setTempoScale(tempo);
      tracks = new TrackMusic(graph, MUSIC_BASE, library);
      tracks.onFail = (id) => {
        // Datei nicht ladbar (offline/fehlt): dauerhaft auf die prozedurale Musik zurückfallen
        tracksFailed = true;
        if (lastPlay && lastPlay.id === id && director && ready()) {
          director.play(proceduralId(id), lastPlay.opts);
          startTimer();
        }
      };
      jingles = new JinglePlayer(graph);
      loops = new LoopBank(graph);
      if (muffleAmount > 0) applyMuffle(graph, muffleAmount, 0.005);
      ctx.onstatechange = () => {
        // Der Kontext läuft: erstmals (Entsperren dauerte länger als das Zeitlimit von unlock(), z. B. Safari/iOS, Bluetooth,
        // langsames Gerät) oder wieder (nach einer Unterbrechung) – wartende Musik/Dauerklänge starten in beiden Fällen
        if (!ctx || disposed || suspended || ctx.state !== "running") return;
        onRunning();
      };
      return true;
    } catch {
      ctx = null;
      graph = null;
      sfxPlayer = null;
      director = null;
      tracks = null;
      jingles = null;
      loops = null;
      return false;
    }
  }

  const PROCEDURAL_FALLBACK: Partial<Record<MusicTrackId, WorldMusicId>> = { select: "menu", winter: "alpen", oper: "wien" };
  const proceduralId = (id: MusicTrackId): WorldMusicId => PROCEDURAL_FALLBACK[id] ?? (id as WorldMusicId);

  /** Startet ein Musikstück: aufgenommene Schleife, bei Ladefehler die prozedurale Komposition. */
  function startMusic(id: MusicTrackId, opts?: { crossfadeSec?: number; intensity?: number }): void {
    lastPlay = { id, opts };
    if (tracks && !tracksFailed) {
      director?.stop(opts?.crossfadeSec ?? 1);
      tracks.play(id, opts);
      return;
    }
    director?.play(proceduralId(id), opts);
    startTimer();
  }

  /** Startet gemerkte Dauerklänge und die gemerkte Musik (bei jedem Wechsel auf „running“). */
  function flushPending(): void {
    if (!ready()) return;
    for (const [name, level] of pendingLoops) loops?.set(name, level !== null, level ?? 0);
    pendingLoops.clear();
    if (pendingPlay && director) {
      const p = pendingPlay;
      pendingPlay = null;
      startMusic(p.id, p.opts);
    }
  }

  /** Der Kontext ist (wieder) „running“: gemerkte Aufrufe starten, Scheduler neu aufsetzen. Idempotent. */
  function onRunning(): void {
    everRunning = true;
    if (!ready()) return;
    director?.resync();
    flushPending();
    startTimer();
    // Stinger (Game Over/Highscore/Weltwechsel) erst nach dem ersten Stück laden, damit sich die Downloads nicht bremsen
    if (jingles && !jinglePrefetchTimer) {
      jinglePrefetchTimer = true;
      const j = jingles;
      const t = setTimeout(() => j.prefetch(), 2500);
      (t as unknown as { unref?: () => void }).unref?.();
    }
  }

  /**
   * iOS/Safari 16.4+: audioSession.type „playback“ lässt Web Audio auch bei aktivem Stummschalter klingen. Nur nach unlock(),
   * solange nicht stummgeschaltet, nicht pausiert (verstecktes Tab) und nicht entsorgt; sonst „auto“. Ohne API wirkungslos.
   */
  function syncAudioSession(): void {
    try {
      const nav = (globalThis as { navigator?: { audioSession?: { type?: string } } }).navigator;
      if (!nav || !("audioSession" in nav) || !nav.audioSession) return;
      const want = sessionWanted && !disposed && !volumes.muted && !suspended ? "playback" : "auto";
      if (nav.audioSession.type !== want) nav.audioSession.type = want;
    } catch {
      /* egal */
    }
  }

  function unlock(): Promise<void> {
    if (disposed || !ensureContext() || !ctx) return Promise.resolve();
    const c = ctx;
    sessionWanted = true;
    if (everRunning && c.state === "running") {
      syncAudioSession();
      return Promise.resolve();
    }
    suspended = false;
    syncAudioSession();
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
      // resume() kann in Safari ohne Geste ewig hängen -> nie länger als ~1.2 s warten. Das Zeitlimit beendet nur das Promise;
      // läuft der Kontext erst danach, startet onstatechange das Gemerkte (und jeder weitere unlock()-Aufruf versucht es erneut)
      const t = setTimeout(finish, 1200);
      (t as unknown as { unref?: () => void }).unref?.();
      p.then(finish, finish);
    });
  }

  function tryAutoResume(): void {
    if (!ctx || suspended || disposed || typeof ctx.resume !== "function") return;
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
    if (isJingle(name)) {
      // Jingles sind Musik-Stinger: Sichtbarkeit und Pegel folgen dem Musik-Regler (stingerBus), nicht dem Effekt-Regler
      if (musicAudible(graph) && jingles) {
        // Game Over/Highscore lösen einen noch klingenden Weltwechsel-Jingle ab (sonst liefen beide übereinander)
        if (name !== "world-transition") jingles.stopOf("world-transition", 0.25);
        if (jingles.play(name, graph.stingerBus, opts?.volume ?? 1)) {
          const [amount, sec] = JINGLES[name].duck;
          duckMusic(graph, amount, sec);
          // Game-Over/Highscore sind reine Musik-Stinger; der Weltwechsel bekommt zusätzlich den Effekt
          if (name !== "world-transition") return;
        }
      } else if (name !== "world-transition") {
        return; // Musik aus/leise gestellt: kein Stinger, auch kein synthetischer Ersatz
      }
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

  /** Dämpfung zurücknehmen (neues/beendetes Stück); ohne Dämpfung bleibt der Graph unberührt. */
  function resetMuffle(tau: number): void {
    if (muffleAmount === 0 && (!graph || graph.muffle === 0)) return;
    muffleAmount = 0;
    if (graph) applyMuffle(graph, 0, tau);
  }

  const music: FredAudio["music"] = {
    play(id, opts) {
      if (disposed) return;
      resetMuffle(0.3);
      if (!ready() || !director) {
        pendingPlay = { id, opts };
        return;
      }
      pendingPlay = null;
      startMusic(id, opts);
    },
    setIntensity(v, rampSec) {
      if (disposed) return;
      director?.setIntensity(v, rampSec);
      tracks?.setIntensity(v, rampSec);
    },
    setMuffle(amount, rampSec) {
      if (disposed) return;
      muffleAmount = clamp01(amount);
      if (graph) applyMuffle(graph, muffleAmount, rampSec);
    },
    stop(fadeSec) {
      pendingPlay = null;
      lastPlay = null;
      if (disposed) return;
      resetMuffle(Math.max(0.3, fadeSec ?? 0));
      director?.stop(fadeSec);
      tracks?.stop(fadeSec);
    },
    get current() {
      if (pendingPlay) return pendingPlay.id;
      return tracks?.current ?? director?.current ?? null;
    },
  };

  const audio: FredAudio = {
    unlock,
    get unlocked() {
      return !disposed && ctx !== null && everRunning && (suspended || ctx.state === "running");
    },
    sfx,
    stopStingers(fadeSec = 0.3) {
      if (disposed || !graph) return;
      jingles?.stopAll(fadeSec);
      releaseDuck(graph);
    },
    prefetch(opts) {
      if (disposed) return;
      prefetchAudio(library, opts);
    },
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
      syncAudioSession();
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
      syncAudioSession();
      try {
        ctx.suspend().catch(noop);
      } catch {
        /* egal */
      }
    },
    resume() {
      if (disposed || !ctx) return;
      suspended = false;
      syncAudioSession();
      const c = ctx;
      const after = (): void => {
        if (disposed || suspended) return;
        if (c.state === "running") onRunning();
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
      syncAudioSession();
      stopTimer();
      pendingPlay = null;
      pendingLoops.clear();
      try {
        loops?.dispose();
        tracks?.dispose();
        jingles?.dispose();
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
      tracks = null;
      jingles = null;
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
    get tracks() {
      return tracks;
    },
    get jingles() {
      return jingles;
    },
    library,
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
