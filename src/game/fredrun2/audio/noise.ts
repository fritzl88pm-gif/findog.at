/**
 * Prozedural erzeugte Puffer: Rauschen (weiß/rosa/braun, nahtlos loopbar) und Hall-Impulsantwort.
 * Alles wird pro AudioContext genau einmal beim Unlock erzeugt und danach wiederverwendet.
 */

/** Kleiner deterministischer PRNG (mulberry32) – gleiche Puffer bei jedem Start, testbar. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type NoiseKind = "white" | "pink" | "brown";

export interface NoiseSet {
  white: AudioBuffer;
  pink: AudioBuffer;
  brown: AudioBuffer;
}

/** Ziel-RMS aller Rauschpuffer. Peak-Parameter der Synthese sind dadurch grob "Peak ≈ 3 × RMS". */
export const NOISE_RMS = 0.3;

/** Überblendet das Ende in den Anfang, sodass der Puffer beim Loopen ohne Sprung/Klick weiterläuft. */
export function makeLoopable(raw: Float32Array, length: number): Float32Array {
  const fade = raw.length - length;
  const out = raw.slice(0, length);
  for (let i = 0; i < fade; i++) {
    const x = (i + 0.5) / fade;
    const wIn = Math.sin((x * Math.PI) / 2); // gleichleistungs-Überblendung
    const wOut = Math.cos((x * Math.PI) / 2);
    out[i] = raw[i] * wIn + raw[length + i] * wOut;
  }
  return out;
}

function normalizeRms(data: Float32Array, target: number): void {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  const rms = Math.sqrt(sum / Math.max(1, data.length)) || 1;
  let k = target / rms;
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]) * k);
  if (peak > 0.98) k *= 0.98 / peak;
  for (let i = 0; i < data.length; i++) data[i] *= k;
}

function whiteRaw(n: number, rand: () => number): Float32Array {
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = rand() * 2 - 1;
  return d;
}

function pinkRaw(n: number, rand: () => number): Float32Array {
  // Paul Kellet, "economy" pink filter
  const d = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = rand() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    d[i] = b0 + b1 + b2 + w * 0.1848;
  }
  return d;
}

function brownRaw(n: number, rand: () => number): Float32Array {
  const d = new Float32Array(n);
  let b = 0;
  for (let i = 0; i < n; i++) {
    const w = rand() * 2 - 1;
    b = (b + 0.02 * w) / 1.02;
    d[i] = b;
  }
  return d;
}

function fillBuffer(ctx: BaseAudioContext, data: Float32Array): AudioBuffer {
  const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
  buf.getChannelData(0).set(data);
  return buf;
}

export function createNoiseSet(ctx: BaseAudioContext): NoiseSet {
  const sr = ctx.sampleRate;
  const make = (seconds: number, gen: (n: number, r: () => number) => Float32Array, seed: number): AudioBuffer => {
    const n = Math.max(64, Math.floor(seconds * sr));
    const fade = Math.floor(n * 0.12);
    const raw = gen(n + fade, mulberry32(seed));
    const loopable = makeLoopable(raw, n);
    normalizeRms(loopable, NOISE_RMS);
    return fillBuffer(ctx, loopable);
  };
  return {
    white: make(2.0, whiteRaw, 0x1234abcd),
    pink: make(4.0, pinkRaw, 0x9e3779b9),
    brown: make(4.0, brownRaw, 0x7f4a7c15),
  };
}

/**
 * Synthetische Hall-Impulsantwort (Stereo): dichtes exponentiell abklingendes Rauschen,
 * Höhen klingen schneller ab (One-Pole-Tiefpass, dessen Grenzfrequenz mit der Zeit sinkt),
 * kleine Vorverzögerung + ein paar frühe Reflexionen. Links/Rechts sind unkorreliert → breit.
 */
export function createImpulseResponse(ctx: BaseAudioContext, seconds = 1.6, rt60 = 1.45): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.max(256, Math.floor(seconds * sr));
  const buf = ctx.createBuffer(2, n, sr);
  const preDelay = Math.floor(0.011 * sr);
  const early = [0.019, 0.027, 0.036, 0.049, 0.063];
  for (let ch = 0; ch < 2; ch++) {
    const rand = mulberry32(0xc0ffee + ch * 7919);
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = preDelay; i < n; i++) {
      const t = (i - preDelay) / sr;
      const decay = Math.exp((-6.9078 * t) / rt60); // -60 dB nach rt60
      // Grenzfrequenz-Verlauf ~9 kHz -> ~1.4 kHz
      const k = 0.85 - 0.72 * Math.min(1, t / (rt60 * 0.9));
      const w = rand() * 2 - 1;
      lp += k * (w - lp);
      // sanftes Einblenden der ersten Millisekunden (kein Knacken)
      const fadeIn = Math.min(1, t / 0.004);
      d[i] = lp * decay * fadeIn * 1.6;
    }
    early.forEach((e, idx) => {
      const pos = Math.floor((e + ch * 0.0023) * sr);
      if (pos < n) d[pos] += (0.55 - idx * 0.07) * (rand() > 0.5 ? 1 : -1);
    });
  }
  return buf;
}
