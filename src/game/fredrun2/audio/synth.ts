/**
 * Synthese der Musik-Instrumente und Schlagzeug-Stimmen. Die Kompositionsdaten (themes.ts) kennen nur
 * Instrument-IDs; hier stehen die Klänge dazu. Instrumente sind datengetriebene "Patches"
 * (Oszillatoren + Hüllkurve + Filter + Vibrato + Anblas-Rauschen), Schlagzeug ist handgebaut.
 */
import {
  addFilter,
  addLfo,
  Bag,
  clamp,
  envPerc,
  envSustain,
  FLOOR,
  getWave,
  makeNoiseSource,
  makePanner,
  midiToFreq,
  MIN_ATTACK,
  safeFreq,
  type CustomWave,
} from "./dsp";
import type { AudioGraph } from "./graph";
import type { DrumId, InstId } from "./themes";
import { Synth } from "./voice";

interface OscSpec {
  type: OscillatorType | CustomWave;
  /** Frequenzverhältnis zum Grundton (Standard 1) */
  ratio?: number;
  /** Cent */
  detune?: number;
  /** relativer Anteil (Standard 1) */
  gain?: number;
  /** Abklingfaktor dieses Teiltons (aktiviert den Teilton-Modus für Glocken) */
  decay?: number;
  /** Stereo-Position (Supersaw) */
  pan?: number;
}

interface LowpassSpec {
  /** Grenzfrequenz in Hz (oder Vielfaches der Tonhöhe, wenn `rel`) */
  f: number;
  rel?: boolean;
  f2?: number;
  /** Sweep-Zeit in s */
  T?: number;
  q?: number;
}

interface Patch {
  osc: OscSpec[];
  /** Attack / Decay / Sustain-Pegel (0 = perkussiv) / Release in s */
  a: number;
  d: number;
  s: number;
  r: number;
  /** perkussive Töne beim Notenende abdämpfen */
  damp?: boolean;
  lp?: LowpassSpec;
  hp?: number;
  vib?: { rate: number; depth: number; delay: number };
  /** Startet `semis` Halbtöne tiefer und gleitet in `time` s zum Ton (Jodel-Schleifer) */
  glide?: { semis: number; time: number };
  /** Anblasgeräusch */
  chiff?: { level: number; f: number; q: number; dur: number };
  /** Nenn-Spitzenpegel bei Anschlagstärke 1 */
  level: number;
}

const SAW = (detune: number, extra: Partial<OscSpec> = {}): OscSpec => ({ type: "sawtooth", detune, ...extra });

export const PATCHES: Record<InstId, Patch> = {
  // ---- Pads ----
  "pad-warm": {
    osc: [{ type: "triangle", detune: -7 }, { type: "triangle", detune: 7 }, { type: "sine", ratio: 0.5, gain: 0.7 }],
    a: 0.45, d: 0.5, s: 0.85, r: 0.9, lp: { f: 1500, q: 0.5 }, level: 0.17,
  },
  "pad-strings": {
    osc: [SAW(-11), SAW(0), SAW(11)],
    a: 0.3, d: 0.6, s: 0.85, r: 0.8, lp: { f: 2300, q: 0.6 }, vib: { rate: 5.2, depth: 6, delay: 0.3 }, level: 0.14,
  },
  "pad-air": {
    osc: [{ type: "triangle", detune: -5 }, { type: "triangle", detune: 5 }, { type: "sine", ratio: 2, gain: 0.35 }],
    a: 0.6, d: 0.6, s: 0.8, r: 1.0, lp: { f: 3600, q: 0.5 }, vib: { rate: 4.5, depth: 5, delay: 0.4 }, level: 0.13,
  },
  "pad-cold": {
    osc: [SAW(-8), { type: "square", detune: 8, gain: 0.6 }, { type: "sine", ratio: 0.5, gain: 0.8 }],
    a: 0.7, d: 0.7, s: 0.8, r: 1.3, lp: { f: 1300, q: 1.2 }, level: 0.11,
  },
  "pad-supersaw": {
    osc: [SAW(-14, { pan: -0.85 }), SAW(-7, { pan: -0.4 }), SAW(0, { pan: 0 }), SAW(7, { pan: 0.4 }), SAW(14, { pan: 0.85 })],
    a: 0.35, d: 0.6, s: 0.8, r: 0.9, lp: { f: 2100, q: 0.8 }, level: 0.14,
  },
  drone: {
    osc: [SAW(-6), SAW(6), { type: "sine", ratio: 0.5, gain: 1.2 }],
    a: 1.0, d: 1.0, s: 1, r: 1.2, lp: { f: 240, q: 0.7 }, level: 0.2,
  },
  // ---- Leads / Melodie ----
  accordion: {
    osc: [SAW(-13), SAW(0), SAW(13), { type: "square", detune: 5, gain: 0.4 }, { type: "square", ratio: 2, gain: 0.25 }],
    a: 0.05, d: 0.12, s: 0.88, r: 0.14, lp: { f: 2600, q: 0.9 }, hp: 150, vib: { rate: 5, depth: 4, delay: 0.25 }, level: 0.13,
  },
  "strings-lead": {
    osc: [SAW(-6), SAW(6)],
    a: 0.06, d: 0.15, s: 0.85, r: 0.2, lp: { f: 6, rel: true, q: 0.7 }, vib: { rate: 5.6, depth: 22, delay: 0.18 }, level: 0.12,
  },
  yodel: {
    osc: [{ type: "triangle" }, { type: "sine", ratio: 2, gain: 0.25 }, { type: "sine", detune: 7, gain: 0.5 }],
    a: 0.03, d: 0.08, s: 0.9, r: 0.12, lp: { f: 3400, q: 0.6 }, vib: { rate: 5.8, depth: 30, delay: 0.12 },
    glide: { semis: -1.3, time: 0.05 }, level: 0.2,
  },
  calliope: {
    osc: [{ type: "calliope" }, { type: "calliope", detune: 7, gain: 0.6 }, { type: "sine", ratio: 2, gain: 0.2 }],
    a: 0.012, d: 0.05, s: 0.9, r: 0.06, lp: { f: 4800, q: 0.6 }, vib: { rate: 5.2, depth: 8, delay: 0.12 },
    chiff: { level: 0.05, f: 2400, q: 1.5, dur: 0.03 }, level: 0.11,
  },
  "organ-chord": {
    osc: [{ type: "organ" }, { type: "organ", detune: 4, gain: 0.5 }],
    a: 0.015, d: 0.04, s: 0.8, r: 0.08, lp: { f: 2800 }, level: 0.1,
  },
  "lead-synth": {
    osc: [SAW(-9), SAW(9), { type: "square", gain: 0.4 }],
    a: 0.01, d: 0.25, s: 0.7, r: 0.25, lp: { f: 7, rel: true, f2: 3, T: 0.35, q: 3 }, level: 0.11,
  },
  // ---- Gezupftes ----
  pizz: {
    osc: [{ type: "triangle" }, { type: "sawtooth", gain: 0.5 }],
    a: 0.003, d: 0.35, s: 0, r: 0.05, damp: true, lp: { f: 10, rel: true, f2: 2, T: 0.2 }, level: 0.3,
  },
  "pluck-soft": {
    osc: [{ type: "triangle" }, { type: "sine", ratio: 2, gain: 0.3 }, { type: "sine", ratio: 3, gain: 0.1 }],
    a: 0.004, d: 0.9, s: 0, r: 0.08, damp: true, lp: { f: 5000 }, level: 0.22,
  },
  "pluck-bright": {
    osc: [SAW(0), { type: "square", detune: 4, gain: 0.6 }],
    a: 0.003, d: 0.45, s: 0, r: 0.05, damp: true, lp: { f: 9, rel: true, f2: 2.5, T: 0.25, q: 0.8 }, level: 0.17,
  },
  guitar: {
    osc: [{ type: "triangle" }, SAW(2, { gain: 0.4 }), { type: "sine", ratio: 2, gain: 0.15 }],
    a: 0.004, d: 0.7, s: 0, r: 0.06, damp: true, lp: { f: 7, rel: true, f2: 2.5, T: 0.3 },
    chiff: { level: 0.07, f: 1800, q: 1, dur: 0.02 }, level: 0.22,
  },
  "pluck-synth": {
    osc: [SAW(0), { type: "square", detune: 5, gain: 0.5 }],
    a: 0.002, d: 0.16, s: 0, r: 0.03, damp: true, lp: { f: 3600, f2: 500, T: 0.12, q: 6 }, level: 0.13,
  },
  "pluck-cold": {
    osc: [{ type: "triangle" }, { type: "square", gain: 0.3 }],
    a: 0.002, d: 0.14, s: 0, r: 0.03, damp: true, lp: { f: 2400, f2: 650, T: 0.08, q: 1.5 }, level: 0.17,
  },
  // ---- Glocken (Teilton-Modus: jeder Teilton klingt unterschiedlich lang aus) ----
  bell: {
    osc: [
      { type: "sine", ratio: 1, gain: 1, decay: 1 },
      { type: "sine", ratio: 2.76, gain: 0.5, decay: 0.55 },
      { type: "sine", ratio: 5.4, gain: 0.25, decay: 0.32 },
      { type: "sine", ratio: 8.93, gain: 0.12, decay: 0.18 },
    ],
    a: 0.002, d: 1.3, s: 0, r: 0.05, level: 0.2,
  },
  "bell-soft": {
    osc: [
      { type: "sine", ratio: 1, gain: 1, decay: 1 },
      { type: "sine", ratio: 2.76, gain: 0.4, decay: 0.5 },
      { type: "sine", ratio: 5.4, gain: 0.15, decay: 0.28 },
    ],
    a: 0.003, d: 0.9, s: 0, r: 0.05, level: 0.14,
  },
  "chime-cold": {
    osc: [
      { type: "sine", ratio: 1, gain: 1, decay: 1 },
      { type: "sine", ratio: 2.32, gain: 0.6, decay: 0.7 },
      { type: "sine", ratio: 4.25, gain: 0.35, decay: 0.5 },
      { type: "sine", ratio: 6.63, gain: 0.18, decay: 0.3 },
    ],
    a: 0.002, d: 1.6, s: 0, r: 0.05, level: 0.16,
  },
  // ---- Bässe ----
  "bass-warm": {
    osc: [{ type: "triangle" }, { type: "sine", gain: 0.6 }],
    a: 0.012, d: 0.55, s: 0, r: 0.06, damp: true, lp: { f: 520, q: 0.5 }, level: 0.32,
  },
  "bass-pizz": {
    osc: [SAW(0), { type: "triangle", gain: 0.8 }],
    a: 0.004, d: 0.5, s: 0, r: 0.05, damp: true, lp: { f: 6, rel: true, f2: 1.5, T: 0.15, q: 1 }, level: 0.3,
  },
  "bass-tuba": {
    osc: [{ type: "triangle" }, { type: "square", gain: 0.35 }],
    a: 0.02, d: 0.12, s: 0.7, r: 0.06, lp: { f: 750, f2: 450, T: 0.1 }, chiff: { level: 0.05, f: 400, q: 1, dur: 0.03 }, level: 0.3,
  },
  "bass-muted": {
    osc: [{ type: "square" }, SAW(0, { gain: 0.6 })],
    a: 0.004, d: 0.2, s: 0, r: 0.04, damp: true, lp: { f: 4, rel: true, f2: 1.3, T: 0.09, q: 2.2 }, level: 0.26,
  },
  "bass-roll": {
    osc: [SAW(0), SAW(9, { gain: 0.7 }), { type: "sine", ratio: 0.5, gain: 0.9 }],
    a: 0.003, d: 0.14, s: 0, r: 0.03, damp: true, lp: { f: 1100, f2: 260, T: 0.09, q: 4.5 }, level: 0.28,
  },
};

export interface NoteArgs {
  g: AudioGraph;
  dest: AudioNode;
  t: number;
  midi: number;
  /** Notenlänge in Sekunden */
  dur: number;
  /** Anschlagstärke ~0.3 .. 1.3 */
  vel: number;
}

/** Spielt eine Note des Instruments `inst`. Alle Knoten räumen sich selbst auf. */
export function playNote(inst: InstId, a: NoteArgs): void {
  const patch = PATCHES[inst];
  if (!patch) return;
  const { g, dest, t } = a;
  const ctx = g.ctx;
  const nyq = ctx.sampleRate * 0.45;
  const bag = new Bag();
  const freq = midiToFreq(a.midi);
  const oscs = patch.osc.filter((o) => freq * (o.ratio ?? 1) < nyq * 0.9);
  if (oscs.length === 0) return;
  const total = oscs.reduce((s, o) => s + (o.gain ?? 1), 0) || 1;
  const peak = patch.level * clamp(a.vel, 0.05, 1.6);
  const partialMode = patch.s === 0 && oscs.some((o) => o.decay !== undefined);

  // --- Signalweg: [Oszillatoren] -> first -> [hp] -> [lp] -> env -> dest
  const env = bag.add(ctx.createGain());
  let stopAt: number;
  if (partialMode) {
    env.gain.value = 1;
    stopAt = t + MIN_ATTACK + patch.d + 0.03;
  } else if (patch.s > 0) {
    stopAt = envSustain(env.gain, t, peak, patch.a, patch.d, patch.s, a.dur, patch.r) + 0.03;
  } else {
    stopAt = envPercussive(env.gain, t, peak, patch, a.dur) + 0.03;
  }
  env.connect(dest);

  let head: AudioNode = env;
  if (patch.lp) {
    const lp = patch.lp;
    const f0 = lp.rel ? freq * lp.f : lp.f;
    const f1 = lp.f2 === undefined ? undefined : lp.rel ? freq * lp.f2 : lp.f2;
    const fl = addFilter(ctx, bag, { type: "lowpass", f: clamp(f0, 80, nyq * 0.9), f2: f1 === undefined ? undefined : clamp(f1, 60, nyq * 0.9), T: lp.T, q: lp.q }, t, stopAt - t);
    fl.connect(head);
    head = fl;
  }
  if (patch.hp) {
    const hp = addFilter(ctx, bag, { type: "highpass", f: patch.hp, q: 0.7 }, t, 1);
    hp.connect(head);
    head = hp;
  }

  const oscNodes: OscillatorNode[] = [];
  for (const o of oscs) {
    const osc = ctx.createOscillator();
    const wave = o.type === "calliope" || o.type === "organ" ? getWave(g, o.type) : null;
    if (wave) osc.setPeriodicWave(wave);
    else osc.type = o.type === "calliope" || o.type === "organ" ? "square" : o.type;
    const f = safeFreq(ctx, freq * (o.ratio ?? 1));
    if (patch.glide) {
      osc.frequency.setValueAtTime(f * Math.pow(2, patch.glide.semis / 12), t);
      osc.frequency.exponentialRampToValueAtTime(f, t + patch.glide.time);
    } else {
      osc.frequency.setValueAtTime(f, t);
    }
    if (o.detune) osc.detune.value = o.detune;

    // Pfad zwischen Oszillator und head: optional Teilton-Hüllkurve, Anteil, Panner
    let node: AudioNode = osc;
    const share = (o.gain ?? 1) / total;
    if (partialMode) {
      const pg = bag.add(ctx.createGain());
      envPerc(pg.gain, t, peak * share * 1.3, patch.a, patch.d * (o.decay ?? 1));
      node.connect(pg);
      node = pg;
    } else if (Math.abs(share - 1 / oscs.length) > 0.01) {
      const pg = bag.add(ctx.createGain());
      pg.gain.value = share * oscs.length;
      node.connect(pg);
      node = pg;
    }
    if (o.pan !== undefined) {
      const pan = makePanner(ctx, o.pan);
      if (pan) {
        bag.add(pan);
        node.connect(pan);
        node = pan;
      }
    }
    node.connect(head);
    oscNodes.push(osc);
  }

  if (patch.vib) {
    const lfoDepth = patch.vib.depth;
    const { depth } = addLfo(ctx, bag, patch.vib.rate, lfoDepth, oscNodes[0].detune, t, stopAt);
    for (let i = 1; i < oscNodes.length; i++) depth.connect(oscNodes[i].detune);
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(lfoDepth, t + patch.vib.delay + 0.12);
  }

  for (const osc of oscNodes) bag.run(osc, t, stopAt);

  if (patch.chiff) {
    const c = patch.chiff;
    const { src, offset } = makeNoiseSource(g, "white", c.dur);
    const bp = addFilter(ctx, bag, { type: "bandpass", f: c.f, q: c.q }, t, c.dur);
    const cg = bag.add(ctx.createGain());
    envPerc(cg.gain, t, c.level * clamp(a.vel, 0.2, 1.4), 0.004, c.dur);
    src.connect(bp);
    bp.connect(cg);
    cg.connect(dest);
    bag.run(src, t, t + c.dur + 0.03, offset);
  }
}

/** Perkussive Hüllkurve mit optionalem Abdämpfen bei Notenende. Liefert die Endzeit. */
function envPercussive(p: AudioParam, t: number, peak: number, patch: Patch, dur: number): number {
  const a = Math.max(MIN_ATTACK, patch.a);
  if (patch.damp && dur < a + patch.d) {
    const pk = Math.max(FLOOR * 2, peak);
    const x = clamp((dur - a) / patch.d, 0, 1);
    const vc = Math.max(FLOOR * 2, pk * Math.pow(FLOOR / pk, x));
    const tc = t + Math.max(dur, a + 0.002);
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(pk, t + a);
    p.exponentialRampToValueAtTime(vc, tc);
    p.exponentialRampToValueAtTime(FLOOR, tc + Math.max(0.02, patch.r));
    return tc + Math.max(0.02, patch.r);
  }
  return envPerc(p, t, peak, a, a + patch.d);
}

// -----------------------------------------------------------------------------------------------
// Schlagzeug
// -----------------------------------------------------------------------------------------------

type DrumFn = (s: Synth, t: number, v: number) => void;

export const DRUMS: Record<DrumId, DrumFn> = {
  kick: (s, t, v) => {
    s.tone({ t, f: 165, f2: 46, fT: 0.09, dur: 0.38, peak: 0.95 * v });
    s.tone({ t, f: 55, dur: 0.3, peak: 0.28 * v, a: 0.004 });
    s.noise({ t, dur: 0.012, peak: 0.3 * v, filters: [{ type: "highpass", f: 2000 }] });
  },
  "kick-soft": (s, t, v) => {
    s.tone({ t, f: 120, f2: 58, fT: 0.1, dur: 0.3, peak: 0.6 * v, a: 0.005 });
    s.noise({ t, dur: 0.02, peak: 0.08 * v, filters: [{ type: "lowpass", f: 1800 }] });
  },
  snare: (s, t, v) => {
    s.noise({ t, dur: 0.18, peak: 0.55 * v, filters: [{ type: "bandpass", f: 1900, q: 0.7 }] });
    s.tone({ t, f: 190, f2: 140, fT: 0.08, dur: 0.13, peak: 0.36 * v, type: "triangle" });
    s.noise({ t, dur: 0.05, peak: 0.16 * v, filters: [{ type: "highpass", f: 6000 }] });
  },
  "snare-soft": (s, t, v) => {
    s.noise({ t, dur: 0.14, peak: 0.24 * v, a: 0.012, filters: [{ type: "bandpass", f: 3500, q: 0.5 }] });
    s.noise({ t, dur: 0.06, peak: 0.08 * v, filters: [{ type: "highpass", f: 7000 }] });
  },
  rim: (s, t, v) => {
    s.tone({ t, f: 1750, dur: 0.03, peak: 0.3 * v });
    s.tone({ t, f: 480, dur: 0.05, peak: 0.2 * v, type: "triangle" });
    s.noise({ t, dur: 0.02, peak: 0.2 * v, filters: [{ type: "bandpass", f: 3200, q: 2 }] });
  },
  clap: (s, t, v) => {
    for (let k = 0; k < 3; k++) {
      s.noise({ t: t + k * 0.011, dur: k === 2 ? 0.14 : 0.02, peak: 0.42 * v, filters: [{ type: "bandpass", f: 1500, q: 1.1 }] });
    }
    s.noise({ t, dur: 0.05, peak: 0.1 * v, filters: [{ type: "highpass", f: 4500 }] });
  },
  hat: (s, t, v) => {
    s.noise({ t, dur: 0.05, peak: 0.24 * v, filters: [{ type: "highpass", f: 7500 }] });
    s.noise({ t, dur: 0.03, peak: 0.1 * v, filters: [{ type: "bandpass", f: 10000, q: 1.5 }] });
  },
  ohat: (s, t, v) => {
    s.noise({ t, dur: 0.24, peak: 0.2 * v, filters: [{ type: "highpass", f: 6800 }] });
    s.noise({ t, dur: 0.16, peak: 0.08 * v, filters: [{ type: "bandpass", f: 9500, q: 1.2 }] });
  },
  shaker: (s, t, v) => {
    s.noise({ t, dur: 0.07, peak: 0.2 * v, a: 0.012, filters: [{ type: "bandpass", f: 6500, q: 0.8 }] });
  },
  timpani: (s, t, v) => {
    s.tone({ t, f: 122, f2: 108, fT: 0.07, dur: 0.95, peak: 0.7 * v, a: 0.004 });
    s.tone({ t, f: 162, dur: 0.55, peak: 0.24 * v, a: 0.004 });
    s.noise({ t, dur: 0.07, peak: 0.3 * v, kind: "pink", filters: [{ type: "lowpass", f: 420 }] });
  },
  stamp: (s, t, v) => {
    s.tone({ t, f: 110, f2: 55, fT: 0.08, dur: 0.18, peak: 0.65 * v });
    s.noise({ t, dur: 0.07, peak: 0.35 * v, kind: "pink", filters: [{ type: "lowpass", f: 800 }] });
    s.noise({ t, dur: 0.012, peak: 0.25 * v, filters: [{ type: "bandpass", f: 2200, q: 1.4 }] });
  },
  tick: (s, t, v) => {
    s.noise({ t, dur: 0.02, peak: 0.36 * v, filters: [{ type: "bandpass", f: 3200, q: 6 }] });
    s.tone({ t, f: 2800, dur: 0.012, peak: 0.12 * v });
  },
  tock: (s, t, v) => {
    s.noise({ t, dur: 0.025, peak: 0.36 * v, filters: [{ type: "bandpass", f: 1900, q: 5 }] });
    s.tone({ t, f: 1500, dur: 0.015, peak: 0.12 * v });
  },
  click: (s, t, v) => {
    s.tone({ t, f: 1300, f2: 800, fT: 0.006, dur: 0.012, peak: 0.12 * v, type: "square" });
    s.noise({ t, dur: 0.01, peak: 0.3 * v, filters: [{ type: "highpass", f: 4000 }] });
  },
  slap: (s, t, v) => {
    s.noise({ t, dur: 0.07, peak: 0.5 * v, filters: [{ type: "bandpass", f: 900, q: 1.2 }] });
    s.tone({ t, f: 220, f2: 110, fT: 0.04, dur: 0.06, peak: 0.35 * v });
    s.noise({ t, dur: 0.015, peak: 0.2 * v, filters: [{ type: "highpass", f: 3000 }] });
  },
  cowbell: (s, t, v) => {
    const bp = [{ type: "bandpass" as const, f: 800, q: 1.1 }];
    s.tone({ t, f: 545, dur: 0.26, peak: 0.16 * v, type: "square", filters: bp });
    s.tone({ t, f: 815, dur: 0.22, peak: 0.16 * v, type: "square", filters: bp });
  },
  wood: (s, t, v) => {
    s.tone({ t, f: 880, f2: 700, fT: 0.01, dur: 0.07, peak: 0.3 * v, type: "triangle" });
    s.noise({ t, dur: 0.02, peak: 0.2 * v, filters: [{ type: "bandpass", f: 2400, q: 3 }] });
  },
  crash: (s, t, v) => {
    s.noise({ t, dur: 1.0, peak: 0.28 * v, filters: [{ type: "highpass", f: 4500 }] });
    s.noise({ t, dur: 0.7, peak: 0.12 * v, filters: [{ type: "bandpass", f: 8000, q: 0.6 }] });
  },
  rumble: (s, t, v) => {
    s.noise({ t, dur: 1.9, peak: 0.85 * v, a: 0.6, kind: "brown", filters: [{ type: "lowpass", f: 140, f2: 230, T: 1.2, q: 0.8 }] });
  },
  tom: (s, t, v) => {
    s.tone({ t, f: 170, f2: 85, fT: 0.12, dur: 0.35, peak: 0.7 * v });
    s.noise({ t, dur: 0.04, peak: 0.2 * v, kind: "pink", filters: [{ type: "lowpass", f: 900 }] });
  },
};

/** Spielt einen Schlagzeug-Treffer. */
export function playDrum(drum: DrumId, g: AudioGraph, dest: AudioNode, t: number, vel: number): void {
  const fn = DRUMS[drum];
  if (!fn) return;
  const s = new Synth(g, dest);
  fn(s, t, clamp(vel, 0.1, 1.5));
}
