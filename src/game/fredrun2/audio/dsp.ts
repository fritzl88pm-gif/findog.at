/**
 * Kleine DSP-Bausteine, die von SFX, Loops und Musik gemeinsam genutzt werden:
 * Hüllkurven, Filter, Rausch-Quellen, PeriodicWaves und der Knoten-Sammler `Bag`
 * (räumt alle Knoten nach dem letzten `ended` per disconnect() wieder auf).
 */
import type { AudioGraph } from "./graph";
import type { NoiseKind } from "./noise";

export const FLOOR = 0.0001;
export const MIN_ATTACK = 0.003;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function semis(n: number): number {
  return Math.pow(2, n / 12);
}

/** Frequenz in einen sicheren Bereich zwingen (Filter/Oszillatoren/Exponential-Rampen brauchen > 0). */
export function safeFreq(ctx: BaseAudioContext, f: number): number {
  const nyq = ctx.sampleRate * 0.45;
  return clamp(Number.isFinite(f) ? f : 440, 12, nyq);
}

// ---------------------------------------------------------------------------------------------
// Knoten-Sammler
// ---------------------------------------------------------------------------------------------

export class Bag {
  private nodes: AudioNode[] = [];
  private sources: AudioScheduledSourceNode[] = [];
  private pending = 0;
  private disposed = false;
  /** Wird nach dem Aufräumen genau einmal aufgerufen. */
  onDispose: (() => void) | null = null;

  add<T extends AudioNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }

  /**
   * Registriert eine Quelle, startet sie und plant optional ihr Ende.
   * Ohne `stop` läuft sie, bis `stopAll` aufgerufen wird (Loops).
   */
  run(src: AudioScheduledSourceNode, start: number, stop?: number, offset?: number): void {
    if (this.disposed) return;
    this.nodes.push(src);
    this.sources.push(src);
    this.pending++;
    src.onended = () => {
      this.pending--;
      if (this.pending <= 0) this.dispose();
    };
    try {
      const s = Number.isFinite(start) ? Math.max(0, start) : 0;
      if (offset !== undefined && "loop" in src) (src as AudioBufferSourceNode).start(s, offset);
      else src.start(s);
      if (stop !== undefined) src.stop(Math.max(s + 0.005, stop));
    } catch {
      // ungültiger Zustand (z.B. Kontext geschlossen) -> sofort aufräumen statt zu lecken
      this.pending--;
      if (this.pending <= 0) this.dispose();
    }
  }

  /** Stoppt alle noch laufenden Quellen zum Zeitpunkt `when` (kein Aufräumen ohne `ended`). */
  stopAll(when: number): void {
    for (const s of this.sources) {
      try {
        s.stop(when);
      } catch {
        /* bereits gestoppt */
      }
    }
  }

  get active(): boolean {
    return !this.disposed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* schon getrennt */
      }
    }
    this.nodes.length = 0;
    this.sources.length = 0;
    const cb = this.onDispose;
    this.onDispose = null;
    cb?.();
  }
}

// ---------------------------------------------------------------------------------------------
// Hüllkurven
// ---------------------------------------------------------------------------------------------

/**
 * Perkussive Hüllkurve: 0 -> peak (linear, >= 3 ms) -> optional halten -> exponentiell nach ~-80 dB.
 * Liefert die Endzeit zurück.
 */
export function envPerc(p: AudioParam, t: number, peak: number, attack: number, dur: number, hold = 0): number {
  const a = Math.max(MIN_ATTACK, attack);
  const pk = Math.max(FLOOR * 2, peak);
  const tPeak = t + a;
  const tEnd = Math.max(tPeak + hold + 0.005, t + dur);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(pk, tPeak);
  if (hold > 0) p.setValueAtTime(pk, tPeak + hold);
  p.exponentialRampToValueAtTime(FLOOR, tEnd);
  return tEnd;
}

/**
 * ADSR mit Haltephase bis `dur` und exponentiellem Release. Der Release beginnt bei t+dur,
 * die Notenlänge (bis Stille) ist dur + release. Kurze Noten werden gestaucht, nie geknackt.
 */
export function envSustain(
  p: AudioParam,
  t: number,
  peak: number,
  attack: number,
  decay: number,
  sustain: number,
  dur: number,
  release: number,
): number {
  const a = Math.max(MIN_ATTACK, attack);
  const pk = Math.max(FLOOR * 2, peak);
  const sus = Math.max(FLOOR * 2, pk * clamp(sustain, 0, 1));
  const tHold = t + Math.max(a + 0.001, dur);
  const tDecayEnd = t + Math.max(a, Math.min(a + decay, dur));
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(pk, t + a);
  if (sus < pk) p.exponentialRampToValueAtTime(sus, tDecayEnd);
  p.setValueAtTime(sus < pk ? sus : pk, tHold);
  const tEnd = tHold + Math.max(0.02, release);
  p.exponentialRampToValueAtTime(FLOOR, tEnd);
  return tEnd;
}

// ---------------------------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------------------------

export interface FilterSpec {
  type: BiquadFilterType;
  /** Startfrequenz in Hz */
  f: number;
  /** optionale Endfrequenz (exponentieller Sweep) */
  f2?: number;
  /** Sweep-Dauer in s (Standard: Länge des Klangs) */
  T?: number;
  q?: number;
  /** nur für peaking/shelf */
  gain?: number;
}

export function addFilter(ctx: BaseAudioContext, bag: Bag, spec: FilterSpec, t: number, dur: number): BiquadFilterNode {
  const fl = bag.add(ctx.createBiquadFilter());
  fl.type = spec.type;
  fl.Q.value = spec.q ?? 0.707;
  if (spec.gain !== undefined) fl.gain.value = spec.gain;
  fl.frequency.setValueAtTime(safeFreq(ctx, spec.f), t);
  if (spec.f2 !== undefined && spec.f2 !== spec.f) {
    fl.frequency.exponentialRampToValueAtTime(safeFreq(ctx, spec.f2), t + Math.max(0.005, spec.T ?? dur));
  }
  return fl;
}

// ---------------------------------------------------------------------------------------------
// PeriodicWaves (Orgel/Kalliope), pro Kontext einmal
// ---------------------------------------------------------------------------------------------

export type CustomWave = "calliope" | "organ";

function harmonicsFor(id: CustomWave): number[] {
  const h: number[] = [0];
  if (id === "calliope") {
    // Dampf-Pfeifen: kräftige ungerade Obertöne, leichte gerade, sehr hell
    for (let n = 1; n <= 24; n++) h.push(n % 2 === 1 ? 1 / Math.pow(n, 0.8) : 0.16 / n);
  } else {
    // Drawbar-artig (8', 4', 2 2/3', 2', 1 3/5', 1')
    const bars = [1, 0.62, 0.42, 0.3, 0.16, 0.1, 0.05, 0.09];
    for (let n = 1; n <= 8; n++) h.push(bars[n - 1]);
  }
  return h;
}

export function getWave(g: AudioGraph, id: CustomWave): PeriodicWave | null {
  if (g.waves.has(id)) return g.waves.get(id) ?? null;
  let wave: PeriodicWave | null = null;
  try {
    const imag = new Float32Array(harmonicsFor(id));
    const real = new Float32Array(imag.length);
    wave = g.ctx.createPeriodicWave(real, imag);
  } catch {
    wave = null;
  }
  g.waves.set(id, wave);
  return wave;
}

// ---------------------------------------------------------------------------------------------
// Quellen
// ---------------------------------------------------------------------------------------------

export function makeNoiseSource(g: AudioGraph, kind: NoiseKind, dur: number, loop = false): { src: AudioBufferSourceNode; offset: number } {
  const src = g.ctx.createBufferSource();
  const buf = g.noise[kind];
  src.buffer = buf;
  const needLoop = loop || dur + 0.05 > buf.duration;
  src.loop = needLoop;
  const room = buf.duration - (dur + 0.05);
  const offset = needLoop ? Math.random() * buf.duration * 0.98 : Math.random() * Math.max(0, room);
  return { src, offset };
}

/** Panner, falls vom Browser unterstützt (Safari < 14.1 hat keinen StereoPannerNode). */
export function makePanner(ctx: BaseAudioContext, pan: number): StereoPannerNode | null {
  if (typeof ctx.createStereoPanner !== "function") return null;
  const p = ctx.createStereoPanner();
  p.pan.value = clamp(pan, -1, 1);
  return p;
}

/** Sinus-LFO, der `target` mit Amplitude `depth` moduliert (Verbindung wird vom Bag aufgeräumt). */
export function addLfo(
  ctx: BaseAudioContext,
  bag: Bag,
  rate: number,
  depth: number,
  target: AudioParam,
  start: number,
  stop?: number,
  type: OscillatorType = "sine",
): { lfo: OscillatorNode; depth: GainNode } {
  const lfo = ctx.createOscillator();
  lfo.type = type;
  lfo.frequency.value = rate;
  const d = bag.add(ctx.createGain());
  d.gain.value = depth;
  lfo.connect(d);
  d.connect(target);
  bag.run(lfo, start, stop);
  return { lfo, depth: d };
}
