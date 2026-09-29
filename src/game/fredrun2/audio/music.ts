/**
 * Musik-Scheduler. Ein `MusicPlayer` spielt ein kompiliertes Thema (Look-ahead über die AudioContext-Uhr),
 * der `MusicDirector` verwaltet aktives Thema, Crossfades und Intensität.
 *
 * Zeitmodell: `nextTime` ist die Startzeit des nächsten Steps (AudioContext-Sekunden). `scheduleUntil(now, limit)`
 * plant alle Steps bis `limit` ein. Liegt ein Step deutlich in der Vergangenheit (Tab war gedrosselt, Hauptthread
 * blockiert), wird er ÜBERSPRUNGEN statt nachgeholt – die Musik bleibt taktgenau zur Uhr und klumpt nicht.
 */
import { Bag, clamp, makePanner } from "./dsp";
import { musicAudible, smooth, type AudioGraph } from "./graph";
import { getCompiledTheme, type CompiledTheme } from "./notation";
import { playDrum, playNote } from "./synth";
import { LAYER_RANGES, layerLevel, THEMES, type DrumId } from "./themes";
import type { WorldMusicId } from "./types";

/** Vorlauf in s (~100 ms wie gefordert, etwas Reserve für Timer-Jitter). */
export const LOOKAHEAD = 0.12;
/** Timer-Intervall der Engine in ms. */
export const TIMER_MS = 25;
/** Steps, die mehr als so viel Sekunden in der Vergangenheit liegen, werden übersprungen. */
export const LATE_DROP = 0.045;

export interface NoteLogEntry {
  time: number;
  track: number;
  layer: number;
  bar: number;
  step: number;
  kind: "note" | "drum";
  midi?: number[];
  drum?: DrumId;
}

export interface PlayerOptions {
  t0: number;
  intensity: number;
  fadeIn: number;
  tempo: number;
  onNote?: (e: NoteLogEntry) => void;
}

export class MusicPlayer {
  readonly id: WorldMusicId;
  readonly theme: CompiledTheme;
  readonly bus: GainNode;
  private readonly g: AudioGraph;
  private readonly bag = new Bag();
  private readonly layers: GainNode[] = [];
  private readonly trackNodes: GainNode[] = [];
  private readonly pump: GainNode | null = null;
  private readonly echoDelay: DelayNode | null = null;
  private readonly ranges: ReadonlyArray<readonly [number, number]>;
  private readonly layerOff: number[] = [Infinity, -Infinity, -Infinity, -Infinity];
  private readonly layerTarget: number[] = [1, 0, 0, 0];
  private readonly onNote?: (e: NoteLogEntry) => void;

  private bar = 0;
  private step = 0;
  nextTime: number;
  private tempo: number;
  private tempoTarget: number;
  private echoTempo: number;
  intensity: number;
  fadingOut = false;
  /** Zeitpunkt, ab dem der Player nach einem Fade-out entsorgt wird */
  stopAt = Infinity;
  finished = false;
  /** Zähler (Tests/Debug) */
  scheduledNotes = 0;

  constructor(g: AudioGraph, theme: CompiledTheme, opts: PlayerOptions) {
    this.g = g;
    this.id = theme.data.id;
    this.theme = theme;
    this.onNote = opts.onNote;
    const ctx = g.ctx;
    const th = theme.data;
    this.ranges = th.layerRanges ?? LAYER_RANGES;
    this.nextTime = opts.t0;
    this.tempo = opts.tempo;
    this.tempoTarget = opts.tempo;
    this.echoTempo = opts.tempo;
    this.intensity = opts.intensity;

    const bag = this.bag;
    this.bus = bag.add(ctx.createGain());
    this.bus.gain.setValueAtTime(0, opts.t0);
    this.bus.gain.setTargetAtTime(th.gain, opts.t0, Math.max(0.02, opts.fadeIn) / 3.5);
    this.bus.connect(g.musicDry);

    const pumped = new Set<number>(th.sidechain?.layers ?? []);
    if (th.sidechain) {
      this.pump = bag.add(ctx.createGain());
      this.pump.gain.value = 1;
      this.pump.connect(this.bus);
    }

    let echoIn: GainNode | null = null;
    if (th.echo) {
      echoIn = bag.add(ctx.createGain());
      const delay = bag.add(ctx.createDelay(2));
      delay.delayTime.value = clamp((th.echo.beats * 60) / (th.bpm * opts.tempo), 0.02, 1.9);
      const tone = addLowpass(ctx, bag, th.echo.tone);
      const fb = bag.add(ctx.createGain());
      fb.gain.value = clamp(th.echo.feedback, 0, 0.75);
      const out = bag.add(ctx.createGain());
      out.gain.value = th.echo.mix;
      echoIn.connect(delay);
      delay.connect(tone);
      tone.connect(fb);
      fb.connect(delay);
      tone.connect(out);
      out.connect(this.bus);
      out.connect(g.musicWet);
      this.echoDelay = delay;
    }

    for (let i = 0; i < 4; i++) {
      const layer = bag.add(ctx.createGain());
      layer.connect(pumped.has(i) && this.pump ? this.pump : this.bus);
      const send = bag.add(ctx.createGain());
      send.gain.value = th.reverb[i];
      layer.connect(send);
      send.connect(g.musicWet);
      if (echoIn && th.echo?.layers.includes(i as 0 | 1 | 2 | 3)) layer.connect(echoIn);
      this.layers.push(layer);
    }
    for (const tr of theme.tracks) {
      const node = bag.add(ctx.createGain());
      node.gain.value = tr.data.gain;
      const layer = this.layers[tr.data.layer];
      const pan = tr.data.pan ? makePanner(ctx, tr.data.pan) : null;
      if (pan) {
        bag.add(pan);
        node.connect(pan);
        pan.connect(layer);
      } else {
        node.connect(layer);
      }
      this.trackNodes.push(node);
    }
    // Anfangs-Layerpegel ohne Rampe
    for (let i = 0; i < 4; i++) {
      const lvl = layerLevel(i, opts.intensity, this.ranges);
      this.layers[i].gain.value = lvl;
      this.layerTarget[i] = lvl;
      this.layerOff[i] = i === 0 || lvl >= 0.01 ? Infinity : -Infinity;
    }
  }

  get stepDuration(): number {
    return 60 / (this.theme.data.bpm * this.tempo) / this.theme.data.stepsPerBeat;
  }

  setTempoTarget(v: number): void {
    this.tempoTarget = v;
  }

  setIntensity(v: number, rampSec: number, now: number): void {
    this.intensity = v;
    const ramp = Math.max(0.05, rampSec);
    for (let i = 0; i < 4; i++) {
      const lvl = layerLevel(i, v, this.ranges);
      if (Math.abs(lvl - this.layerTarget[i]) < 0.002) continue;
      smooth(this.layers[i].gain, lvl, now, ramp / 3);
      if (i > 0) {
        if (lvl < 0.01) {
          if (this.layerTarget[i] >= 0.01) this.layerOff[i] = now + ramp * 1.3 + 0.3;
        } else {
          this.layerOff[i] = Infinity;
        }
      }
      this.layerTarget[i] = lvl;
    }
  }

  private layerActive(layer: number, t: number): boolean {
    return t < this.layerOff[layer];
  }

  /** Nach Suspend/Resume: nicht in der Vergangenheit weiterspielen. */
  resync(now: number): void {
    if (this.nextTime < now + 0.04) this.nextTime = now + 0.04;
  }

  fadeOut(sec: number, now: number): void {
    if (this.fadingOut) return;
    this.fadingOut = true;
    const s = clamp(sec, 0.05, 20);
    this.bus.gain.cancelScheduledValues(now);
    this.bus.gain.setTargetAtTime(0, now, s / 5);
    this.stopAt = now + s * 1.25 + 0.1;
  }

  private advance(n: number): void {
    const spb = this.theme.stepsPerBar;
    this.step += n;
    if (this.step >= spb) {
      const bars = Math.floor(this.step / spb);
      this.step -= bars * spb;
      this.bar = (this.bar + bars) % this.theme.data.bars;
    }
  }

  /** Plant alle Steps mit Startzeit < limit ein. */
  scheduleUntil(now: number, limit: number, audible: boolean): void {
    if (this.finished) return;
    const th = this.theme.data;
    // lange Pause (gedrosselter Tab): Steps analytisch überspringen, Taktposition bleibt zur Uhr synchron
    const lag = now - this.nextTime;
    if (lag > 1.0) {
      const skip = Math.floor((lag - LATE_DROP) / this.stepDuration);
      if (skip > 0) {
        this.advance(skip);
        this.nextTime += skip * this.stepDuration;
      }
    }
    let guard = 0;
    while (this.nextTime < limit && guard++ < 512) {
      const sd = this.stepDuration;
      const t = this.nextTime;
      if (audible && t >= now - LATE_DROP) {
        const swing = th.swing && th.stepsPerBeat % 2 === 0 && this.step % 2 === 1 ? th.swing * sd : 0;
        this.playStep(t + swing, sd);
      }
      this.advance(1);
      this.nextTime += sd;
      // Tempo weich nachführen
      if (this.tempo !== this.tempoTarget) {
        this.tempo += (this.tempoTarget - this.tempo) * 0.06;
        if (Math.abs(this.tempo - this.tempoTarget) < 0.0005) this.tempo = this.tempoTarget;
      }
    }
    if (this.echoDelay && Math.abs(this.tempo - this.echoTempo) > 0.02 && th.echo) {
      this.echoTempo = this.tempo;
      this.echoDelay.delayTime.setTargetAtTime(clamp((th.echo.beats * 60) / (th.bpm * this.tempo), 0.02, 1.9), now, 0.4);
    }
  }

  private pumpAt(t: number): void {
    const sc = this.theme.data.sidechain;
    if (!sc || !this.pump) return;
    const p = this.pump.gain;
    p.setTargetAtTime(1 - clamp(sc.depth, 0, 0.9), t, 0.004);
    p.setTargetAtTime(1, t + 0.03, Math.max(0.03, sc.release / 3.2));
  }

  private playStep(t: number, sd: number): void {
    const tracks = this.theme.tracks;
    const sc = this.theme.data.sidechain;
    for (let ti = 0; ti < tracks.length; ti++) {
      const tr = tracks[ti];
      const layer = tr.data.layer;
      if (!this.layerActive(layer, t)) continue;
      const dest = this.trackNodes[ti];
      if (tr.data.kind === "drums") {
        const hits = tr.drums[this.bar]?.[this.step];
        if (!hits) continue;
        for (const h of hits) {
          playDrum(h.drum, this.g, dest, t, h.vel);
          this.scheduledNotes++;
          if (sc && h.drum === sc.trigger) this.pumpAt(t);
          this.onNote?.({ time: t, track: ti, layer, bar: this.bar, step: this.step, kind: "drum", drum: h.drum });
        }
      } else {
        const ev = tr.notes[this.bar]?.[this.step];
        if (!ev) continue;
        const inst = tr.data.inst;
        const vel = ev.vel * (0.94 + Math.random() * 0.12);
        for (const midi of ev.midi) {
          playNote(inst, { g: this.g, dest, t, midi, dur: ev.dur * sd, vel });
          this.scheduledNotes++;
        }
        this.onNote?.({ time: t, track: ti, layer, bar: this.bar, step: this.step, kind: "note", midi: ev.midi });
      }
    }
  }

  dispose(): void {
    if (this.finished) return;
    this.finished = true;
    this.bag.dispose();
  }
}

function addLowpass(ctx: BaseAudioContext, bag: Bag, f: number): BiquadFilterNode {
  const fl = bag.add(ctx.createBiquadFilter());
  fl.type = "lowpass";
  fl.frequency.value = f;
  fl.Q.value = 0.6;
  return fl;
}

/** Verwaltet aktives Thema, Crossfades, Intensität und Tempo. */
export class MusicDirector {
  private active: MusicPlayer | null = null;
  private fading: MusicPlayer[] = [];
  private currentId: WorldMusicId | null = null;
  private intensityValue: number | null = null;
  private tempoTarget = 1;
  onNote?: (e: NoteLogEntry) => void;

  constructor(private readonly g: AudioGraph) {}

  get current(): WorldMusicId | null {
    return this.currentId;
  }

  get running(): boolean {
    return this.active !== null || this.fading.length > 0;
  }

  get activePlayer(): MusicPlayer | null {
    return this.active;
  }

  /** Zuletzt gesetzte Intensität (oder null) */
  get intensity(): number | null {
    return this.intensityValue;
  }

  play(id: WorldMusicId, opts: { crossfadeSec?: number; intensity?: number } = {}): boolean {
    const g = this.g;
    const now = g.ctx.currentTime;
    if (this.active && this.active.id === id && !this.active.fadingOut) {
      this.currentId = id;
      if (opts.intensity !== undefined) this.setIntensity(opts.intensity, 0.8);
      return true;
    }
    const data = THEMES[id];
    if (!data) return false;
    let compiled: CompiledTheme;
    try {
      compiled = getCompiledTheme(data);
    } catch {
      return false;
    }
    const xf = clamp(opts.crossfadeSec ?? 1.5, 0.05, 12);
    const hadMusic = this.active !== null;
    if (this.active) {
      this.active.fadeOut(xf, now);
      this.fading.push(this.active);
      this.active = null;
    }
    let intensity = data.defaultIntensity;
    if (opts.intensity !== undefined) {
      intensity = clamp(opts.intensity, 0, 1);
      this.intensityValue = intensity;
    }
    const player = new MusicPlayer(g, compiled, {
      t0: now + 0.08,
      intensity,
      fadeIn: hadMusic ? xf : Math.max(0.6, Math.min(xf, 3)),
      tempo: this.tempoTarget,
      onNote: this.onNote,
    });
    this.active = player;
    this.currentId = id;
    return true;
  }

  setIntensity(v: number, rampSec = 1.0): void {
    if (!Number.isFinite(v)) return;
    const val = clamp(v, 0, 1);
    this.intensityValue = val;
    const p = this.active;
    if (!p || p.fadingOut) return;
    if (Math.abs(p.intensity - val) < 0.004) return;
    p.setIntensity(val, rampSec, this.g.ctx.currentTime);
  }

  stop(fadeSec = 1.0): void {
    if (!this.active) {
      this.currentId = null;
      return;
    }
    this.active.fadeOut(fadeSec, this.g.ctx.currentTime);
    this.fading.push(this.active);
    this.active = null;
    this.currentId = null;
  }

  setTempoScale(v: number): void {
    this.tempoTarget = clamp(Number.isFinite(v) ? v : 1, 1, 1.25);
    this.active?.setTempoTarget(this.tempoTarget);
    for (const p of this.fading) p.setTempoTarget(this.tempoTarget);
  }

  /** Vom Engine-Timer aufgerufen. */
  tick(): void {
    const g = this.g;
    const now = g.ctx.currentTime;
    const audible = musicAudible(g);
    const limit = now + LOOKAHEAD;
    this.active?.scheduleUntil(now, limit, audible);
    if (this.fading.length > 0) {
      const keep: MusicPlayer[] = [];
      for (const p of this.fading) {
        if (now >= p.stopAt) {
          p.dispose();
          continue;
        }
        p.scheduleUntil(now, limit, audible);
        keep.push(p);
      }
      this.fading = keep;
    }
  }

  resync(): void {
    const now = this.g.ctx.currentTime;
    this.active?.resync(now);
    for (const p of this.fading) p.resync(now);
  }

  dispose(): void {
    this.active?.dispose();
    for (const p of this.fading) p.dispose();
    this.active = null;
    this.fading = [];
    this.currentId = null;
  }
}
