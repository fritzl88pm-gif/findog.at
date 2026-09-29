/**
 * Dauerklänge (Regen, Wind, Brummen …). Jeder Loop besteht aus Rauschpuffern (loopbar) und Oszillatoren,
 * die mit langsamen LFOs bzw. gefiltertem Zufallsrauschen moduliert werden, damit nichts "pumpt" oder sich
 * hörbar wiederholt. Ein/Aus mit weichen Fades; ausgeschaltete Loops werden nach dem Fade komplett abgebaut.
 */
import { Bag, clamp, safeFreq } from "./dsp";
import { clamp01, smooth, type AudioGraph } from "./graph";
import type { NoiseKind } from "./noise";
import type { LoopName } from "./types";

interface L {
  g: AudioGraph;
  ctx: BaseAudioContext;
  bag: Bag;
  t: number;
  out: GainNode;
}

interface Band {
  src: AudioBufferSourceNode;
  filters: BiquadFilterNode[];
  gain: GainNode;
}

type FilterDef = { type: BiquadFilterType; f: number; q?: number };

/** Loop-Rauschen -> Filterkette -> Gain -> dest */
function band(l: L, kind: NoiseKind, defs: FilterDef[], level: number, dest?: AudioNode): Band {
  const src = l.ctx.createBufferSource();
  const buf = l.g.noise[kind];
  src.buffer = buf;
  src.loop = true;
  let node: AudioNode = src;
  const filters: BiquadFilterNode[] = [];
  for (const d of defs) {
    const f = l.bag.add(l.ctx.createBiquadFilter());
    f.type = d.type;
    f.frequency.value = safeFreq(l.ctx, d.f);
    f.Q.value = d.q ?? 0.707;
    node.connect(f);
    node = f;
    filters.push(f);
  }
  const gain = l.bag.add(l.ctx.createGain());
  gain.gain.value = level;
  node.connect(gain);
  gain.connect(dest ?? l.out);
  l.bag.run(src, l.t, undefined, Math.random() * buf.duration * 0.98);
  return { src, filters, gain };
}

function osc(l: L, type: OscillatorType, f: number, level: number, dest?: AudioNode, detune = 0): { osc: OscillatorNode; gain: GainNode } {
  const o = l.ctx.createOscillator();
  o.type = type;
  o.frequency.value = f;
  o.detune.value = detune;
  const gain = l.bag.add(l.ctx.createGain());
  gain.gain.value = level;
  o.connect(gain);
  gain.connect(dest ?? l.out);
  l.bag.run(o, l.t);
  return { osc: o, gain };
}

/** Langsamer Sinus-LFO, der `param` um `depth` bewegt. */
function lfo(l: L, rate: number, depth: number, param: AudioParam): void {
  const o = l.ctx.createOscillator();
  o.frequency.value = rate;
  const d = l.bag.add(l.ctx.createGain());
  d.gain.value = depth;
  o.connect(d);
  d.connect(param);
  l.bag.run(o, l.t);
}

/** Zufällige Modulation: braunes Rauschen -> Tiefpass -> Gain -> param (für "lebendige" Lautstärke). */
function randMod(l: L, param: AudioParam, depth: number, cutoff: number): void {
  const src = l.ctx.createBufferSource();
  const buf = l.g.noise.brown;
  src.buffer = buf;
  src.loop = true;
  const lp = l.bag.add(l.ctx.createBiquadFilter());
  lp.type = "lowpass";
  lp.frequency.value = cutoff;
  const d = l.bag.add(l.ctx.createGain());
  d.gain.value = depth;
  src.connect(lp);
  lp.connect(d);
  d.connect(param);
  l.bag.run(src, l.t, undefined, Math.random() * buf.duration * 0.98);
}

interface LoopSpec {
  /** Grundpegel bei level = 1 */
  base: number;
  fadeIn: number;
  fadeOut: number;
  /** Reverb-Send 0..1 */
  reverb: number;
  build(l: L): void;
}

const SPECS: Record<LoopName, LoopSpec> = {
  rain: {
    base: 0.55, fadeIn: 0.9, fadeOut: 1.4, reverb: 0.08,
    build(l) {
      band(l, "pink", [{ type: "highpass", f: 400, q: 0.5 }, { type: "lowpass", f: 8500, q: 0.5 }], 0.9);
      const drops = band(l, "white", [{ type: "bandpass", f: 5200, q: 0.7 }], 0.22);
      randMod(l, drops.gain.gain, 0.9, 22);
      band(l, "brown", [{ type: "lowpass", f: 250 }], 0.25);
    },
  },
  wind: {
    base: 0.6, fadeIn: 1.2, fadeOut: 1.6, reverb: 0.2,
    build(l) {
      const w1 = band(l, "pink", [{ type: "bandpass", f: 520, q: 1 }], 1.1);
      lfo(l, 0.083, 240, w1.filters[0].frequency);
      lfo(l, 0.117, 0.35, w1.gain.gain);
      const w2 = band(l, "pink", [{ type: "bandpass", f: 1500, q: 2.6 }], 0.3);
      lfo(l, 0.061, 500, w2.filters[0].frequency);
      lfo(l, 0.143, 0.14, w2.gain.gain);
      band(l, "brown", [{ type: "lowpass", f: 180 }], 0.5);
    },
  },
  avalanche: {
    base: 0.7, fadeIn: 0.6, fadeOut: 1.2, reverb: 0.15,
    build(l) {
      const rumble = band(l, "brown", [{ type: "lowpass", f: 230, q: 0.8 }], 1.6);
      lfo(l, 0.7, 0.25, rumble.gain.gain);
      const churn = band(l, "pink", [{ type: "bandpass", f: 700, q: 0.5 }], 0.7);
      randMod(l, churn.gain.gain, 1.2, 9);
      const crackle = band(l, "white", [{ type: "highpass", f: 3000 }], 0.05);
      randMod(l, crackle.gain.gain, 0.4, 14);
      const sub = osc(l, "sine", 38, 0.25);
      lfo(l, 7, 0.1, sub.gain.gain);
    },
  },
  magnet: {
    base: 0.5, fadeIn: 0.25, fadeOut: 0.35, reverb: 0.05,
    build(l) {
      const trem = l.bag.add(l.ctx.createGain());
      trem.gain.value = 0.65;
      trem.connect(l.out);
      lfo(l, 6.5, 0.35, trem.gain);
      const lp = l.bag.add(l.ctx.createBiquadFilter());
      lp.type = "lowpass";
      lp.frequency.value = 320;
      lp.Q.value = 1.5;
      lp.connect(trem);
      osc(l, "sawtooth", 52, 0.2, lp);
      osc(l, "sawtooth", 52.8, 0.2, lp);
      osc(l, "sine", 104, 0.1, trem);
      const shimmer = osc(l, "sine", 1800, 0.012, trem);
      lfo(l, 0.4, 0.006, shimmer.gain.gain);
    },
  },
  "laser-hum": {
    base: 0.35, fadeIn: 0.25, fadeOut: 0.35, reverb: 0.05,
    build(l) {
      const lp = l.bag.add(l.ctx.createBiquadFilter());
      lp.type = "lowpass";
      lp.frequency.value = 900;
      lp.Q.value = 2;
      lp.connect(l.out);
      osc(l, "sawtooth", 118, 0.14, lp);
      osc(l, "sawtooth", 119, 0.14, lp);
      const hi = osc(l, "sine", 880, 0.03);
      lfo(l, 9, 0.02, hi.gain.gain);
      band(l, "white", [{ type: "highpass", f: 6000 }], 0.02);
      osc(l, "sine", 60, 0.08);
    },
  },
  "crowd-fair": {
    base: 0.55, fadeIn: 1.5, fadeOut: 1.5, reverb: 0.25,
    build(l) {
      const defs: Array<[number, number, number, number]> = [[420, 1.2, 1.4, 4], [900, 1.5, 1.0, 5], [1800, 2, 0.5, 6.5]];
      for (const [f, q, lvl, cutoff] of defs) {
        const b = band(l, "pink", [{ type: "bandpass", f, q }], lvl);
        randMod(l, b.gain.gain, lvl * 0.9, cutoff);
      }
      band(l, "pink", [{ type: "lowpass", f: 250 }], 0.3);
    },
  },
  river: {
    base: 0.5, fadeIn: 1.2, fadeOut: 1.5, reverb: 0.15,
    build(l) {
      band(l, "pink", [{ type: "bandpass", f: 900, q: 0.6 }], 1.0);
      const bubbles = band(l, "white", [{ type: "bandpass", f: 3200, q: 0.7 }], 0.25);
      randMod(l, bubbles.gain.gain, 0.5, 10);
      const low = band(l, "pink", [{ type: "lowpass", f: 300 }], 0.5);
      lfo(l, 0.2, 0.12, low.gain.gain);
    },
  },
  "office-hum": {
    base: 0.35, fadeIn: 1.0, fadeOut: 1.2, reverb: 0.05,
    build(l) {
      const lp = l.bag.add(l.ctx.createBiquadFilter());
      lp.type = "lowpass";
      lp.frequency.value = 900;
      const hum = l.bag.add(l.ctx.createGain());
      hum.gain.value = 1;
      lp.connect(hum);
      hum.connect(l.out);
      randMod(l, hum.gain, 0.3, 3);
      osc(l, "sawtooth", 100, 0.09, lp);
      osc(l, "sawtooth", 100.3, 0.09, lp);
      osc(l, "sine", 150, 0.05, hum);
      osc(l, "sine", 300, 0.02, hum);
      band(l, "pink", [{ type: "lowpass", f: 700 }], 0.3);
    },
  },
  "cyber-hum": {
    base: 0.45, fadeIn: 1.0, fadeOut: 1.2, reverb: 0.2,
    build(l) {
      const lp = l.bag.add(l.ctx.createBiquadFilter());
      lp.type = "lowpass";
      lp.frequency.value = 280;
      lp.Q.value = 3;
      lp.connect(l.out);
      lfo(l, 0.07, 110, lp.frequency);
      osc(l, "sawtooth", 55, 0.15, lp);
      osc(l, "sawtooth", 55.4, 0.15, lp);
      osc(l, "sine", 110, 0.1);
      const whine = osc(l, "sine", 4400, 0.01);
      lfo(l, 0.4, 0.006, whine.gain.gain);
      band(l, "white", [{ type: "highpass", f: 7000 }], 0.02);
    },
  },
  "dash-whoosh": {
    base: 0.55, fadeIn: 0.05, fadeOut: 0.18, reverb: 0.05,
    build(l) {
      const w = band(l, "white", [{ type: "bandpass", f: 1400, q: 0.7 }], 0.7);
      lfo(l, 11, 250, w.filters[0].frequency);
      band(l, "pink", [{ type: "lowpass", f: 500 }], 0.5);
      band(l, "white", [{ type: "highpass", f: 4500 }], 0.1);
    },
  },
  "slide-scrape": {
    base: 0.5, fadeIn: 0.04, fadeOut: 0.12, reverb: 0.03,
    build(l) {
      const s = band(l, "pink", [{ type: "bandpass", f: 2000, q: 1.4 }], 0.8);
      lfo(l, 37, 0.25, s.gain.gain);
      band(l, "white", [{ type: "highpass", f: 4000 }], 0.12);
      band(l, "brown", [{ type: "lowpass", f: 150 }], 0.5);
    },
  },
};

export const LOOP_SPECS = SPECS;

export class LoopInstance {
  readonly bag = new Bag();
  readonly out: GainNode;
  private readonly spec: LoopSpec;
  private timer: ReturnType<typeof setTimeout> | null = null;
  fadingOut = false;
  level: number;
  /** wird aufgerufen, wenn alle Knoten abgebaut sind */
  onGone: (() => void) | null = null;

  constructor(private readonly g: AudioGraph, readonly name: LoopName, level: number) {
    const ctx = g.ctx;
    const spec = SPECS[name];
    this.spec = spec;
    this.level = level;
    const now = ctx.currentTime;
    this.out = this.bag.add(ctx.createGain());
    this.out.gain.value = 0;
    this.out.connect(g.sfxDry);
    if (spec.reverb > 0) {
      const send = this.bag.add(ctx.createGain());
      send.gain.value = spec.reverb;
      this.out.connect(send);
      send.connect(g.sfxWet);
    }
    this.bag.onDispose = () => {
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
      this.onGone?.();
    };
    spec.build({ g, ctx, bag: this.bag, t: now + 0.01, out: this.out });
    smooth(this.out.gain, spec.base * level, now, Math.max(0.01, spec.fadeIn / 3));
  }

  setLevel(level: number, now: number): void {
    this.level = level;
    smooth(this.out.gain, this.spec.base * level, now, 0.08);
  }

  fadeOut(now: number): void {
    if (this.fadingOut) return;
    this.fadingOut = true;
    smooth(this.out.gain, 0, now, Math.max(0.01, this.spec.fadeOut / 4));
    this.timer = setTimeout(() => {
      this.timer = null;
      this.kill();
    }, (this.spec.fadeOut * 1.4 + 0.1) * 1000);
    (this.timer as unknown as { unref?: () => void }).unref?.();
  }

  revive(level: number, now: number): void {
    if (!this.fadingOut) {
      this.setLevel(level, now);
      return;
    }
    this.fadingOut = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.level = level;
    smooth(this.out.gain, this.spec.base * level, now, Math.max(0.01, this.spec.fadeIn / 3));
  }

  kill(): void {
    this.bag.stopAll(this.g.ctx.currentTime);
    // Falls onended nie feuert (geschlossener Kontext): trotzdem abbauen
    if (this.g.ctx.state === "closed") this.bag.dispose();
  }
}

/** Alle laufenden Loops einer Engine. */
export class LoopBank {
  private map = new Map<LoopName, LoopInstance>();

  constructor(private readonly g: AudioGraph) {}

  get active(): LoopName[] {
    return [...this.map.entries()].filter(([, v]) => !v.fadingOut).map(([k]) => k);
  }

  get instanceCount(): number {
    return this.map.size;
  }

  set(name: LoopName, on: boolean, level = 1): void {
    const spec = SPECS[name];
    if (!spec) return;
    const now = this.g.ctx.currentTime;
    const lvl = clamp(clamp01(level), 0, 1);
    const inst = this.map.get(name);
    if (on && lvl > 0.001) {
      if (inst) {
        inst.revive(lvl, now);
      } else {
        const created = new LoopInstance(this.g, name, lvl);
        created.onGone = () => {
          if (this.map.get(name) === created) this.map.delete(name);
        };
        this.map.set(name, created);
      }
    } else if (inst) {
      inst.fadeOut(now);
    }
  }

  dispose(): void {
    for (const inst of this.map.values()) inst.bag.dispose();
    this.map.clear();
  }
}
