/**
 * Aufgenommene Musik: nahtlose, taktgenaue Schleifen (Suno, siehe tools/fredrun2/make_music.py) + Jingles.
 *
 * Jede Schleifendatei enthält `period + xfade` Sekunden. Der Spieler startet alle `period` Sekunden eine neue Kopie des
 * Puffers und blendet währenddessen die alte über `xfade` Sekunden mit Equal-Power-Kurven aus / die neue ein. Da `period`
 * ein Vielfaches ganzer Takte ist, bleibt der Beat exakt auf dem Raster – ohne Lücken (MP3-Encoder-Delay ist egal,
 * weil nur Abstände zwischen Startzeiten zählen).
 *
 * Es wird immer nur ein Stück (plus das ausblendende Vorgängerstück) dekodiert im Speicher gehalten (≈ 25–35 MB je Stück).
 * Schlägt das Laden fehl (offline, Datei fehlt), meldet `onFail` das an die Engine, die dann auf die prozedurale Musik zurückfällt.
 */
import { clamp } from "./dsp";
import { smooth, type AudioGraph } from "./graph";
import type { MusicTrackId } from "./types";

export const MUSIC_BASE = "/fredrun2/audio/music";
export const JINGLE_BASE = "/fredrun2/audio/jingles";

export interface TrackInfo {
  file: string;
  bpm: number;
  /** Abstand zwischen den Kopien (Sekunden, ganze Takte) */
  period: number;
  /** Überblendung am Nahtpunkt (Sekunden) */
  xfade: number;
  /** Länge der Datei = period + xfade */
  length: number;
}
export type TrackManifest = Record<string, TrackInfo>;

/** Jingle-Namen → Datei (SFX-Namen der Engine, die als Musik-Stinger gespielt werden). */
export const JINGLES = {
  gameover: { file: "gameover.mp3", gain: 0.95, duck: [0.75, 6.5] },
  highscore: { file: "highscore.mp3", gain: 1, duck: [0.85, 9] },
  "world-transition": { file: "transition.mp3", gain: 0.85, duck: [0.55, 4.5] },
} as const satisfies Record<string, { file: string; gain: number; duck: readonly [number, number] }>;
export type JingleName = keyof typeof JINGLES;

export function isJingle(name: string): name is JingleName {
  return Object.prototype.hasOwnProperty.call(JINGLES, name);
}

/** Angleichung an den Pegel der prozeduralen Musik/SFX-Kalibrierung (Messung im Browser: Track-RMS war ≈ 4 dB leiser). */
const TRACK_TRIM = 1.6;

const CURVE_N = 64;
function fadeCurve(out: boolean): Float32Array<ArrayBuffer> {
  const c = new Float32Array(CURVE_N);
  for (let i = 0; i < CURVE_N; i++) {
    const t = i / (CURVE_N - 1);
    c[i] = out ? Math.cos((t * Math.PI) / 2) : Math.sin((t * Math.PI) / 2);
  }
  return c;
}
const FADE_IN = fadeCurve(false);
const FADE_OUT = fadeCurve(true);

/** decodeAudioData mit Promise- und Callback-Form (ältere Safari-Versionen). */
export function decodeBuffer(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    try {
      const p = ctx.decodeAudioData(data, resolve, reject);
      if (p && typeof (p as Promise<AudioBuffer>).then === "function") (p as Promise<AudioBuffer>).then(resolve, reject);
    } catch (e) {
      reject(e);
    }
  });
}

async function fetchBuffer(ctx: BaseAudioContext, url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return decodeBuffer(ctx, await res.arrayBuffer());
}

/** Ein laufendes Stück (Schleife). */
class LoopPlayer {
  /** Ein-/Ausblend-Hüllkurve des ganzen Stücks (Stück-Wechsel) */
  readonly out: GainNode;
  private readonly level: GainNode;
  private readonly shelf: BiquadFilterNode;
  private sources: Array<{ src: AudioBufferSourceNode; env: GainNode }> = [];
  private nextStart: number;
  private started = false;
  private ended = false;
  fadingOut = false;
  endAt = Infinity;

  constructor(
    private readonly g: AudioGraph,
    readonly id: MusicTrackId,
    private readonly buf: AudioBuffer,
    private readonly info: TrackInfo,
    t0: number,
    fadeIn: number,
    intensity: number,
  ) {
    const ctx = g.ctx;
    this.out = ctx.createGain();
    this.level = ctx.createGain();
    this.shelf = ctx.createBiquadFilter();
    this.shelf.type = "highshelf";
    this.shelf.frequency.value = 3200;
    this.applyIntensity(intensity, 0);
    this.level.connect(this.shelf);
    this.shelf.connect(this.out);
    this.out.connect(g.musicDry);
    this.out.gain.setValueAtTime(0, t0);
    if (fadeIn > 0.02) this.out.gain.setValueCurveAtTime(FADE_IN, t0, fadeIn);
    else this.out.gain.setValueAtTime(1, t0);
    this.nextStart = t0;
    this.schedule(3);
  }

  applyIntensity(v: number, ramp: number): void {
    const iv = clamp(v, 0, 1);
    const now = this.g.ctx.currentTime;
    const gain = TRACK_TRIM * (0.88 + 0.12 * iv);
    const shelfDb = -1.8 + 3.8 * iv;
    if (ramp <= 0.01) {
      this.level.gain.value = gain;
      this.shelf.gain.value = shelfDb;
    } else {
      smooth(this.level.gain, gain, now, ramp / 3);
      smooth(this.shelf.gain, shelfDb, now, ramp / 3);
    }
  }

  /** Startet weitere Kopien, solange der nächste Start innerhalb des Vorlaufs liegt. */
  schedule(lookahead: number): void {
    if (this.ended || this.fadingOut) return;
    const ctx = this.g.ctx;
    let guard = 0;
    while (this.nextStart < ctx.currentTime + lookahead && guard++ < 4) {
      this.startPass(this.nextStart, !this.started);
      this.started = true;
      this.nextStart += this.info.period;
    }
  }

  private startPass(when: number, first: boolean): void {
    const ctx = this.g.ctx;
    const { period, xfade } = this.info;
    const env = ctx.createGain();
    const src = ctx.createBufferSource();
    src.buffer = this.buf;
    src.connect(env);
    env.connect(this.level);
    if (first) {
      env.gain.setValueAtTime(1, when);
    } else {
      env.gain.setValueAtTime(0, when);
      env.gain.setValueCurveAtTime(FADE_IN, when, Math.max(0.05, xfade));
    }
    // Ende der Kopie: über die Überblendung ausblenden (die nächste Kopie startet bei `when + period`)
    env.gain.setValueCurveAtTime(FADE_OUT, when + period, Math.max(0.05, xfade));
    const entry = { src, env };
    this.sources.push(entry);
    src.onended = () => {
      try {
        src.disconnect();
        env.disconnect();
      } catch {
        /* egal */
      }
      this.sources = this.sources.filter((s) => s !== entry);
    };
    src.start(when);
  }

  setIntensity(v: number, ramp: number): void {
    this.applyIntensity(v, ramp);
  }

  fadeOut(sec: number): void {
    if (this.fadingOut || this.ended) return;
    this.fadingOut = true;
    const now = this.g.ctx.currentTime;
    smooth(this.out.gain, 0, now, Math.max(0.03, sec / 4));
    const stopAt = now + Math.max(0.1, sec) * 1.6 + 0.1;
    for (const { src } of this.sources) {
      try {
        src.stop(stopAt);
      } catch {
        /* egal */
      }
    }
    this.endAt = stopAt;
  }

  /** true, wenn das Stück komplett verklungen ist und freigegeben werden kann. */
  get done(): boolean {
    return this.ended || (this.fadingOut && this.g.ctx.currentTime > this.endAt + 0.05);
  }

  dispose(): void {
    if (this.ended) return;
    this.ended = true;
    for (const { src, env } of this.sources) {
      try {
        src.stop();
        src.disconnect();
        env.disconnect();
      } catch {
        /* egal */
      }
    }
    this.sources = [];
    try {
      this.level.disconnect();
      this.shelf.disconnect();
      this.out.disconnect();
    } catch {
      /* egal */
    }
  }
}

export interface TrackPlayOptions {
  crossfadeSec?: number;
  intensity?: number;
}

/** Steuerung der aufgenommenen Musik (ein aktives Stück, ausblendende Vorgänger werden aufgeräumt). */
export class TrackMusic {
  private manifest: TrackManifest | null = null;
  private manifestPromise: Promise<TrackManifest> | null = null;
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private lastVariant = new Map<string, string>();
  private active: LoopPlayer | null = null;
  private fading: LoopPlayer[] = [];
  private wanted: MusicTrackId | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private intensity = 0.3;
  private disposed = false;
  /** wird gerufen, wenn ein Stück nicht geladen werden konnte (Engine fällt auf prozedurale Musik zurück) */
  onFail?: (id: MusicTrackId) => void;

  constructor(
    private readonly g: AudioGraph,
    private readonly base: string = MUSIC_BASE,
  ) {}

  get current(): MusicTrackId | null {
    return this.wanted;
  }

  get running(): boolean {
    return this.wanted !== null;
  }

  private loadManifest(): Promise<TrackManifest> {
    if (this.manifest) return Promise.resolve(this.manifest);
    if (!this.manifestPromise) {
      this.manifestPromise = fetch(`${this.base}/music.json`)
        .then((r) => {
          if (!r.ok) throw new Error(`music.json: ${r.status}`);
          return r.json() as Promise<TrackManifest>;
        })
        .then((m) => {
          this.manifest = m;
          return m;
        });
      this.manifestPromise.catch(() => {
        this.manifestPromise = null;
      });
    }
    return this.manifestPromise;
  }

  private loadBuffer(id: string, info: TrackInfo): Promise<AudioBuffer> {
    let p = this.buffers.get(id);
    if (!p) {
      p = fetchBuffer(this.g.ctx, `${this.base}/${info.file}`);
      this.buffers.set(id, p);
      p.catch(() => this.buffers.delete(id));
    }
    return p;
  }

  /** Lädt Manifest + Puffer vor (z. B. Menü direkt nach dem Entsperren). */
  prefetch(id: MusicTrackId): void {
    void this.loadManifest()
      .then((m) => {
        const key = this.pickVariant(m, id);
        return key ? this.loadBuffer(key, m[key]) : undefined;
      })
      .catch(() => {});
  }

  play(id: MusicTrackId, opts: TrackPlayOptions = {}): void {
    if (this.disposed) return;
    if (opts.intensity !== undefined) this.intensity = clamp(opts.intensity, 0, 1);
    if (this.active && this.active.id === id && !this.active.fadingOut) {
      this.wanted = id;
      if (opts.intensity !== undefined) this.active.setIntensity(this.intensity, 0.8);
      return;
    }
    this.wanted = id;
    const xf = clamp(opts.crossfadeSec ?? 1.5, 0.05, 12);
    void this.loadManifest()
      .then((m) => {
        const key = this.pickVariant(m, id);
        if (!key) throw new Error(`kein Stück für ${id}`);
        const info = m[key];
        return this.loadBuffer(key, info).then((buf) => ({ buf, info, key }));
      })
      .then(({ buf, info, key }) => {
        if (this.disposed || this.wanted !== id) return;
        if (this.active && this.active.id === id && !this.active.fadingOut) return;
        const ctx = this.g.ctx;
        const hadMusic = this.active !== null;
        if (this.active) {
          this.active.fadeOut(xf);
          this.fading.push(this.active);
        }
        this.lastVariant.set(id, key);
        this.active = new LoopPlayer(this.g, id, buf, info, ctx.currentTime + 0.06, hadMusic ? xf : Math.max(0.5, Math.min(xf, 2.5)), this.intensity);
        this.startTimer();
        this.trimBuffers(key);
      })
      .catch(() => {
        if (this.disposed || this.wanted !== id) return;
        this.wanted = null;
        this.onFail?.(id);
      });
  }

  /** Varianten eines Stücks heißen `<id>`, `<id>-2` … – gewählt wird zufällig, nie zweimal hintereinander dieselbe. */
  private pickVariant(m: TrackManifest, id: string): string | null {
    const keys = Object.keys(m).filter((k) => k === id || (k.startsWith(`${id}-`) && /^\d+$/.test(k.slice(id.length + 1))));
    if (keys.length === 0) return null;
    const last = this.lastVariant.get(id);
    const pool = keys.length > 1 ? keys.filter((k) => k !== last) : keys;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /** Nur den aktiven Puffer behalten, alle anderen dekodierten Stücke freigeben. */
  private trimBuffers(keep: string): void {
    for (const key of [...this.buffers.keys()]) if (key !== keep) this.buffers.delete(key);
  }

  setIntensity(v: number, ramp = 0.6): void {
    this.intensity = clamp(v, 0, 1);
    this.active?.setIntensity(this.intensity, ramp);
  }

  stop(fadeSec = 0.8): void {
    this.wanted = null;
    if (this.active) {
      this.active.fadeOut(fadeSec);
      this.fading.push(this.active);
      this.active = null;
    }
  }

  private startTimer(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.tick(), 200);
    (this.timer as unknown as { unref?: () => void }).unref?.();
  }

  /** Vorlauf-Scheduler (auch von Tests/Engine von Hand aufrufbar). */
  tick(): void {
    if (this.disposed) return;
    this.active?.schedule(3);
    if (this.fading.length) {
      this.fading = this.fading.filter((p) => {
        if (!p.done) return true;
        p.dispose();
        return false;
      });
    }
    if (!this.active && this.fading.length === 0 && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.active?.dispose();
    for (const p of this.fading) p.dispose();
    this.active = null;
    this.fading = [];
    this.buffers.clear();
  }
}

/** Kurze Musik-Stinger (Game Over, Highscore, Weltwechsel) als vorab geladene Puffer. */
export class JinglePlayer {
  private buffers = new Map<JingleName, Promise<AudioBuffer>>();
  private ready = new Map<JingleName, AudioBuffer>();
  private failed = new Set<JingleName>();

  constructor(
    private readonly g: AudioGraph,
    private readonly base: string = JINGLE_BASE,
  ) {}

  prefetch(): void {
    for (const name of Object.keys(JINGLES) as JingleName[]) this.load(name);
  }

  private load(name: JingleName): void {
    if (this.buffers.has(name) || this.failed.has(name)) return;
    const p = fetchBuffer(this.g.ctx, `${this.base}/${JINGLES[name].file}`);
    this.buffers.set(name, p);
    p.then(
      (b) => this.ready.set(name, b),
      () => {
        this.failed.add(name);
        this.buffers.delete(name);
      },
    );
  }

  /** Spielt den Jingle, wenn er bereits geladen ist (sonst false → Engine nimmt den synthetischen Effekt). */
  play(name: JingleName, dest: AudioNode, volume = 1): boolean {
    const buf = this.ready.get(name);
    if (!buf) {
      this.load(name);
      return false;
    }
    const ctx = this.g.ctx;
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = JINGLES[name].gain * clamp(volume, 0, 1.5);
    src.buffer = buf;
    src.connect(gain);
    gain.connect(dest);
    src.onended = () => {
      try {
        src.disconnect();
        gain.disconnect();
      } catch {
        /* egal */
      }
    };
    src.start(ctx.currentTime + 0.01);
    return true;
  }

  dispose(): void {
    this.buffers.clear();
    this.ready.clear();
  }
}
