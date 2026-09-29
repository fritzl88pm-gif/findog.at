/**
 * SfxVoice: eine "Stimme" = ein SFX-Aufruf. Bündelt alle Knoten eines Effekts (Oszillatoren,
 * Rauschquellen, Filter, Hüllkurven), hängt sie über Lautstärke/Pan/Reverb-Send an die Busse
 * und räumt sie am Ende komplett auf. Die Rezepte in sfx.ts benutzen nur diese kleine API.
 */
import {
  addFilter,
  addLfo,
  Bag,
  clamp,
  envPerc,
  getWave,
  makeNoiseSource,
  makePanner,
  safeFreq,
  type CustomWave,
  type FilterSpec,
} from "./dsp";
import type { AudioGraph } from "./graph";
import type { NoiseKind } from "./noise";

export interface ToneOpts {
  /** Startzeit (AudioContext-Zeit) */
  t: number;
  /** Frequenz in Hz (zu Beginn) */
  f: number;
  /** Zielfrequenz (exponentieller Sweep über fT) */
  f2?: number;
  fT?: number;
  type?: OscillatorType;
  wave?: CustomWave;
  /** Länge der Hüllkurve bis Stille */
  dur: number;
  a?: number;
  peak?: number;
  hold?: number;
  detune?: number;
  filters?: FilterSpec[];
  /** Vibrato in Cent */
  vib?: { rate: number; depth: number; delay?: number };
  /** Tremolo 0..1 */
  trem?: { rate: number; depth: number };
  /** einfache FM: Modulator = f * ratio, Hub in Hz, klingt mit der Hüllkurve ab */
  fm?: { ratio: number; depth: number };
  /** true: keine Standard-Hüllkurve, Aufrufer automatisiert amp.gain selbst */
  raw?: boolean;
  dest?: AudioNode;
}

export interface NoiseOpts {
  t: number;
  dur: number;
  kind?: NoiseKind;
  peak?: number;
  a?: number;
  hold?: number;
  filters?: FilterSpec[];
  raw?: boolean;
  dest?: AudioNode;
}

export interface VoiceInit {
  volume: number;
  pan: number;
  /** Reverb-Send 0..1 */
  reverb: number;
  /** erste mögliche Startzeit */
  t0: number;
  priority: number;
  name: string;
}

export type BellPartial = readonly [ratio: number, gain: number, decay: number];

/** Glocke/Metallophon (freie Stab-/Schalenmoden). */
export const PARTIALS_BELL: readonly BellPartial[] = [
  [1, 1, 1],
  [2.76, 0.5, 0.55],
  [5.4, 0.28, 0.32],
  [8.93, 0.14, 0.18],
];
/** Hellere, harmonischere Glocke (Glockenspiel/Coin). */
export const PARTIALS_CHIME: readonly BellPartial[] = [
  [1, 1, 1],
  [2, 0.42, 0.6],
  [3, 0.22, 0.4],
  [4.01, 0.12, 0.25],
];
/** Straßenbahnglocke/Blech: stark inharmonisch. */
export const PARTIALS_METAL: readonly BellPartial[] = [
  [1, 1, 1],
  [2.32, 0.7, 0.7],
  [4.25, 0.55, 0.5],
  [6.63, 0.35, 0.35],
  [9.38, 0.2, 0.22],
];

/**
 * Synth: Bag + Bequemlichkeits-Methoden für Oszillator-/Rausch-/Glocken-Schichten.
 * Basis für SFX-Stimmen (SfxVoice) und Schlagzeug-Treffer der Musik.
 */
export class Synth extends Bag {
  readonly ctx: BaseAudioContext;
  readonly g: AudioGraph;
  /** Standard-Ziel, wenn `dest` nicht angegeben ist */
  protected sink: AudioNode;
  /** Spätester geplanter Endzeitpunkt (für Aufräumen bei hängenden onended-Events) */
  endTime = 0;

  constructor(g: AudioGraph, sink: AudioNode) {
    super();
    this.g = g;
    this.ctx = g.ctx;
    this.sink = sink;
  }

  protected mark(t: number): void {
    if (t > this.endTime) this.endTime = t;
  }

  /** Oszillator mit Hüllkurve, optional Filter, Vibrato, Tremolo, FM. */
  tone(o: ToneOpts): { osc: OscillatorNode; amp: GainNode } {
    const { ctx } = this;
    const osc = ctx.createOscillator();
    const wave = o.wave ? getWave(this.g, o.wave) : null;
    if (wave) osc.setPeriodicWave(wave);
    else osc.type = o.wave === "calliope" || o.wave === "organ" ? "square" : (o.type ?? "sine");
    const f0 = safeFreq(ctx, o.f);
    osc.frequency.setValueAtTime(f0, o.t);
    if (o.f2 !== undefined && o.f2 !== o.f) {
      osc.frequency.exponentialRampToValueAtTime(safeFreq(ctx, o.f2), o.t + Math.max(0.005, o.fT ?? o.dur));
    }
    if (o.detune) osc.detune.value = o.detune;

    const amp = this.add(ctx.createGain());
    const end = o.raw ? o.t + o.dur : envPerc(amp.gain, o.t, o.peak ?? 0.3, o.a ?? 0.004, o.dur, o.hold ?? 0);
    const stop = end + 0.03;

    let node: AudioNode = osc;
    for (const spec of o.filters ?? []) {
      const fl = addFilter(ctx, this, spec, o.t, o.dur);
      node.connect(fl);
      node = fl;
    }
    node.connect(amp);

    let tail: AudioNode = amp;
    if (o.trem && o.trem.depth > 0) {
      const tg = this.add(ctx.createGain());
      const depth = clamp(o.trem.depth, 0, 1);
      tg.gain.value = 1 - depth / 2;
      addLfo(ctx, this, o.trem.rate, depth / 2, tg.gain, o.t, stop);
      amp.connect(tg);
      tail = tg;
    }
    tail.connect(o.dest ?? this.sink);

    if (o.vib) {
      const dg = addLfo(ctx, this, o.vib.rate, o.vib.depth, osc.detune, o.t, stop).depth;
      if (o.vib.delay) {
        dg.gain.setValueAtTime(0, o.t);
        dg.gain.linearRampToValueAtTime(o.vib.depth, o.t + o.vib.delay + 0.1);
      }
    }
    if (o.fm) {
      const mod = ctx.createOscillator();
      mod.frequency.value = safeFreq(ctx, o.f * o.fm.ratio);
      const mg = this.add(ctx.createGain());
      envPerc(mg.gain, o.t, o.fm.depth, 0.003, o.dur * 0.7);
      mod.connect(mg);
      mg.connect(osc.frequency);
      this.run(mod, o.t, stop);
    }
    this.run(osc, o.t, stop);
    this.mark(stop);
    return { osc, amp };
  }

  /** Gefiltertes Rauschen mit Hüllkurve. */
  noise(o: NoiseOpts): { src: AudioBufferSourceNode; amp: GainNode } {
    const { ctx } = this;
    const { src, offset } = makeNoiseSource(this.g, o.kind ?? "white", o.dur);
    const amp = this.add(ctx.createGain());
    const end = o.raw ? o.t + o.dur : envPerc(amp.gain, o.t, o.peak ?? 0.3, o.a ?? 0.004, o.dur, o.hold ?? 0);
    const stop = end + 0.03;
    let node: AudioNode = src;
    for (const spec of o.filters ?? []) {
      const fl = addFilter(ctx, this, spec, o.t, o.dur);
      node.connect(fl);
      node = fl;
    }
    node.connect(amp);
    amp.connect(o.dest ?? this.sink);
    this.run(src, o.t, stop, offset);
    this.mark(stop);
    return { src, amp };
  }

  /** Glocken-Anschlag aus mehreren Teiltönen mit unterschiedlicher Abklingzeit. */
  bell(o: {
    t: number;
    f: number;
    dur: number;
    peak?: number;
    partials?: readonly BellPartial[];
    a?: number;
    type?: OscillatorType;
    detune?: number;
    dest?: AudioNode;
  }): void {
    const partials = o.partials ?? PARTIALS_CHIME;
    const total = partials.reduce((s, p) => s + p[1], 0) || 1;
    const peak = o.peak ?? 0.3;
    for (const [ratio, gain, decay] of partials) {
      const f = o.f * ratio;
      if (f > this.ctx.sampleRate * 0.4) continue;
      this.tone({
        t: o.t,
        f,
        dur: Math.max(0.03, o.dur * decay),
        peak: (peak * gain * 1.3) / total,
        a: o.a ?? 0.002,
        type: o.type ?? "sine",
        detune: o.detune,
      });
    }
  }

}

export class SfxVoice extends Synth {
  readonly out: GainNode;
  readonly panner: StereoPannerNode | null;
  readonly name: string;
  readonly priority: number;
  readonly startedAt: number;

  constructor(g: AudioGraph, init: VoiceInit) {
    const out = g.ctx.createGain();
    super(g, out);
    this.name = init.name;
    this.priority = init.priority;
    this.startedAt = init.t0;
    this.endTime = init.t0;
    this.out = this.add(out);
    this.out.gain.value = clamp(init.volume, 0, 1.5);
    this.panner = makePanner(g.ctx, init.pan);
    if (this.panner) {
      this.add(this.panner);
      this.out.connect(this.panner);
      this.panner.connect(g.sfxDry);
    } else {
      this.out.connect(g.sfxDry);
    }
    if (init.reverb > 0.001) {
      const send = this.add(g.ctx.createGain());
      send.gain.value = clamp(init.reverb, 0, 1);
      this.out.connect(send);
      send.connect(g.sfxWet);
    }
  }

  /** Stereo-Sweep der Stimme (nur wenn StereoPanner vorhanden). */
  panSweep(from: number, to: number, t: number, dur: number): void {
    if (!this.panner) return;
    this.panner.pan.setValueAtTime(clamp(from, -1, 1), t);
    this.panner.pan.linearRampToValueAtTime(clamp(to, -1, 1), t + Math.max(0.01, dur));
  }

  /** Schnelles, klickfreies Ausblenden (Voice-Stealing). */
  kill(now: number): void {
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setTargetAtTime(0, now, 0.008);
    this.stopAll(now + 0.06);
  }
}
