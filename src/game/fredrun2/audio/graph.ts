/**
 * Master-Graph der Engine:
 *
 *   SFX-Stimmen ─► sfxDry ───────────────────────────────┐
 *   SFX-Sends   ─► sfxWet ─► reverbIn ─► HP ─► Convolver ─► reverbReturn ─┤
 *   Musik-Layer ─► musicDry ─► duckDry ──────────────────┤
 *   Musik-Sends ─► musicWet ─► duckWet ─► reverbIn       │
 *                                                        ▼
 *                                   mix ─► Kompressor ─► Soft-Clipper ─► master ─► destination
 *
 * Der Kompressor glättet Spitzen, der Soft-Clipper (linear bis ±0.8, danach tanh-Knie) garantiert,
 * dass nichts hart clippt. `master` sitzt hinter der Begrenzung: Lautstärke-Regler ändern die
 * Dynamik-Balance nicht, Mute setzt genau diesen Knoten auf 0.
 */
import { createImpulseResponse, createNoiseSet, type NoiseSet } from "./noise";

export interface Volumes {
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
}

export const DEFAULT_VOLUMES: Readonly<Volumes> = { master: 0.8, music: 0.55, sfx: 0.9, muted: false };

/** Interne Kalibrierung (aus Offline-Render-Messungen abgeleitet, siehe README). */
export const MUSIC_TRIM = 1.0;
export const SFX_TRIM = 1.0;
/** Rückführungspegel des Halls. */
export const REVERB_RETURN = 0.9;

export interface AudioGraph {
  ctx: BaseAudioContext;
  noise: NoiseSet;
  master: GainNode;
  limiter: DynamicsCompressorNode;
  clip: WaveShaperNode;
  mix: GainNode;
  sfxDry: GainNode;
  sfxWet: GainNode;
  musicDry: GainNode;
  musicWet: GainNode;
  duckDry: GainNode;
  duckWet: GainNode;
  reverbIn: GainNode;
  reverbReturn: GainNode;
  /** Cache für PeriodicWaves (pro Kontext einmal erzeugt). */
  waves: Map<string, PeriodicWave | null>;
  volumes: Volumes;
  duckUntil: number;
  duckTarget: number;
}

export function clamp01(v: number): number {
  return Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0;
}

/**
 * Weiche Parameter-Änderung ohne Klick. Nutzt ausschließlich setTargetAtTime (keine Rampen),
 * dadurch bleibt ein eventuell laufender Übergang stetig, auch bei häufigen Aufrufen.
 */
export function smooth(p: AudioParam, target: number, at: number, timeConstant: number): void {
  p.cancelScheduledValues(at);
  p.setTargetAtTime(target, at, Math.max(0.001, timeConstant));
}

function softClipCurve(): Float32Array<ArrayBuffer> {
  const n = 2049;
  const curve = new Float32Array(n);
  const knee = 0.8;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee));
    curve[i] = x < 0 ? -y : y;
  }
  return curve;
}

export function buildGraph(ctx: BaseAudioContext, initial?: Partial<Volumes>): AudioGraph {
  const volumes: Volumes = { ...DEFAULT_VOLUMES, ...initial };
  const gain = (v: number): GainNode => {
    const g = ctx.createGain();
    g.gain.value = v;
    return g;
  };

  const master = gain(volumes.muted ? 0 : volumes.master);
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -14;
  limiter.knee.value = 12;
  limiter.ratio.value = 6;
  limiter.attack.value = 0.005;
  limiter.release.value = 0.16;
  const clip = ctx.createWaveShaper();
  clip.curve = softClipCurve();
  clip.oversample = "2x";
  const mix = gain(1);
  mix.connect(limiter);
  limiter.connect(clip);
  clip.connect(master);
  master.connect(ctx.destination);

  const sfxDry = gain(volumes.sfx * SFX_TRIM);
  const sfxWet = gain(volumes.sfx * SFX_TRIM);
  const musicDry = gain(volumes.music * MUSIC_TRIM);
  const musicWet = gain(volumes.music * MUSIC_TRIM);
  const duckDry = gain(1);
  const duckWet = gain(1);
  sfxDry.connect(mix);
  musicDry.connect(duckDry);
  duckDry.connect(mix);

  // Hall: Send-Bus -> Hochpass (Bässe nicht verwaschen) -> Convolver -> Rückführung
  const reverbIn = gain(1);
  const reverbHp = ctx.createBiquadFilter();
  reverbHp.type = "highpass";
  reverbHp.frequency.value = 180;
  reverbHp.Q.value = 0.5;
  const convolver = ctx.createConvolver();
  convolver.buffer = createImpulseResponse(ctx);
  const reverbReturn = gain(REVERB_RETURN);
  sfxWet.connect(reverbIn);
  musicWet.connect(duckWet);
  duckWet.connect(reverbIn);
  reverbIn.connect(reverbHp);
  reverbHp.connect(convolver);
  convolver.connect(reverbReturn);
  reverbReturn.connect(mix);

  return {
    ctx,
    noise: createNoiseSet(ctx),
    master,
    limiter,
    clip,
    mix,
    sfxDry,
    sfxWet,
    musicDry,
    musicWet,
    duckDry,
    duckWet,
    reverbIn,
    reverbReturn,
    waves: new Map(),
    volumes,
    duckUntil: 0,
    duckTarget: 1,
  };
}

export function applyMaster(g: AudioGraph): void {
  const target = g.volumes.muted ? 0 : g.volumes.master;
  smooth(g.master.gain, target, g.ctx.currentTime, 0.015);
}

export function applyMusicVolume(g: AudioGraph): void {
  const now = g.ctx.currentTime;
  const target = g.volumes.music * MUSIC_TRIM;
  smooth(g.musicDry.gain, target, now, 0.03);
  smooth(g.musicWet.gain, target, now, 0.03);
}

export function applySfxVolume(g: AudioGraph): void {
  const now = g.ctx.currentTime;
  const target = g.volumes.sfx * SFX_TRIM;
  smooth(g.sfxDry.gain, target, now, 0.03);
  smooth(g.sfxWet.gain, target, now, 0.03);
}

/** Duckt die Musik (Trocken + Hall) um `amount` (0..1) für `sec` Sekunden und blendet dann weich zurück. */
export function duckMusic(g: AudioGraph, amount: number, sec: number): void {
  const a = clamp01(amount);
  if (a <= 0 || !Number.isFinite(sec) || sec <= 0) return;
  const now = g.ctx.currentTime;
  const dur = Math.min(30, Math.max(0.05, sec));
  const target = Math.max(0.03, 1 - a);
  const active = g.duckUntil > now;
  const depth = active ? Math.min(g.duckTarget, target) : target;
  g.duckTarget = depth;
  g.duckUntil = Math.max(active ? g.duckUntil : 0, now + dur);
  for (const p of [g.duckDry.gain, g.duckWet.gain]) {
    p.cancelScheduledValues(now);
    p.setTargetAtTime(depth, now, 0.03);
    p.setTargetAtTime(1, g.duckUntil, 0.28);
  }
}

/** Wird true, wenn Musik hörbar sein könnte (spart CPU beim Stummschalten). */
export function musicAudible(g: AudioGraph): boolean {
  return !g.volumes.muted && g.volumes.master > 0.001 && g.volumes.music > 0.001;
}

export function sfxAudible(g: AudioGraph): boolean {
  return !g.volumes.muted && g.volumes.master > 0.001 && g.volumes.sfx > 0.001;
}
