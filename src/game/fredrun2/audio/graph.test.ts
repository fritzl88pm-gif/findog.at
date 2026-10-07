import { describe, expect, it } from "vitest";

import {
  applyMusicVolume,
  buildGraph,
  clamp01,
  DEFAULT_VOLUMES,
  duckMusic,
  MUFFLE_DB,
  MUFFLE_HZ,
  muffleOpenHz,
  musicAudible,
  releaseDuck,
  setMuffle,
  sfxAudible,
  type AudioGraph,
} from "./graph";

// -----------------------------------------------------------------------------------------------------------------
// Kleiner Fake-AudioContext (kein Web Audio in Node): Knoten merken ihre Verbindungen, Parameter ihre Automationsereignisse
// -----------------------------------------------------------------------------------------------------------------
interface ParamEvent {
  op: "set" | "target" | "cancel" | "curve";
  v?: number;
  t: number;
  tc?: number;
}
class FakeParam {
  value = 0;
  events: ParamEvent[] = [];
  setValueAtTime(v: number, t: number): this {
    this.value = v;
    this.events.push({ op: "set", v, t });
    return this;
  }
  setTargetAtTime(v: number, t: number, tc: number): this {
    this.events.push({ op: "target", v, t, tc });
    return this;
  }
  setValueCurveAtTime(_c: Float32Array, t: number): this {
    this.events.push({ op: "curve", t });
    return this;
  }
  cancelScheduledValues(t: number): this {
    this.events.push({ op: "cancel", t });
    return this;
  }
  /** letztes setTargetAtTime-Ziel (undefined, wenn nie gesetzt) */
  get target(): number | undefined {
    for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i].op === "target") return this.events[i].v;
    return undefined;
  }
  /** Ereignisse seit dem letzten cancelScheduledValues */
  get active(): ParamEvent[] {
    const i = this.events.map((e) => e.op).lastIndexOf("cancel");
    return this.events.slice(i + 1);
  }
}
class FakeNode {
  readonly out: FakeNode[] = [];
  gain = new FakeParam();
  frequency = new FakeParam();
  Q = new FakeParam();
  detune = new FakeParam();
  threshold = new FakeParam();
  knee = new FakeParam();
  ratio = new FakeParam();
  attack = new FakeParam();
  release = new FakeParam();
  type = "";
  curve: unknown = null;
  oversample = "";
  buffer: unknown = null;
  constructor(readonly kind: string) {}
  connect(n: FakeNode): FakeNode {
    this.out.push(n);
    return n;
  }
  disconnect(): void {
    this.out.length = 0;
  }
}
class FakeBuffer {
  private readonly data: Float32Array;
  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {
    this.data = new Float32Array(length);
  }
  getChannelData(...ch: number[]): Float32Array {
    void ch;
    return this.data;
  }
}
class FakeCtx {
  currentTime = 0;
  constructor(readonly sampleRate = 48000) {}
  readonly destination = new FakeNode("destination");
  createGain = (): FakeNode => new FakeNode("gain");
  createDynamicsCompressor = (): FakeNode => new FakeNode("compressor");
  createWaveShaper = (): FakeNode => new FakeNode("shaper");
  createBiquadFilter = (): FakeNode => new FakeNode("biquad");
  createConvolver = (): FakeNode => new FakeNode("convolver");
  createBuffer = (ch: number, len: number, sr: number): FakeBuffer => new FakeBuffer(ch, len, sr);
}

function makeGraph(rate = 48000, vol?: Partial<typeof DEFAULT_VOLUMES>): { g: AudioGraph; ctx: FakeCtx } {
  const ctx = new FakeCtx(rate);
  return { g: buildGraph(ctx as unknown as BaseAudioContext, vol), ctx };
}
const node = (n: unknown): FakeNode => n as FakeNode;
/** Erreichbarkeit im Verbindungsgraphen (Breitensuche) */
function reaches(from: unknown, to: unknown): boolean {
  const seen = new Set<FakeNode>();
  const queue = [node(from)];
  while (queue.length) {
    const n = queue.shift()!;
    if (n === node(to)) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    queue.push(...n.out);
  }
  return false;
}

describe("Master-Graph: Verdrahtung", () => {
  it("Musik läuft über Tiefpass und Dämpfungs-Pegel, dann Duck, dann Mix (Trocken- und Hall-Pfad)", () => {
    const { g } = makeGraph();
    expect(node(g.musicDry).out).toEqual([node(g.musicLP)]);
    expect(node(g.musicLP).out).toEqual([node(g.muffleDry)]);
    expect(node(g.muffleDry).out).toEqual([node(g.duckDry)]);
    expect(node(g.duckDry).out).toEqual([node(g.mix)]);
    expect(node(g.musicWet).out).toEqual([node(g.musicWetLP)]);
    expect(node(g.musicWetLP).out).toEqual([node(g.muffleWet)]);
    expect(node(g.muffleWet).out).toEqual([node(g.duckWet)]);
    expect(node(g.duckWet).out).toEqual([node(g.reverbIn)]);
    expect(g.musicLP.type).toBe("lowpass");
    expect(g.musicWetLP.type).toBe("lowpass");
  });

  it("Stinger-Bus führt direkt in den Mix (am Duck vorbei), SFX bleibt getrennt", () => {
    const { g } = makeGraph();
    expect(node(g.stingerBus).out).toEqual([node(g.mix)]);
    expect(reaches(g.stingerBus, g.duckDry)).toBe(false);
    expect(reaches(g.sfxDry, g.stingerBus)).toBe(false);
    expect(reaches(g.stingerBus, g.master)).toBe(true); // über Mix → Kompressor → Clipper → Master
  });

  it("startet offen: Cutoff nahe Nyquist (höchstens 22 kHz), Pegel 1, keine Dämpfung", () => {
    const a = makeGraph(48000).g;
    expect(node(a.musicLP).frequency.value).toBe(22000);
    expect(node(a.muffleDry).gain.value).toBe(1);
    expect(a.muffle).toBe(0);
    const b = makeGraph(32000).g; // Nyquist 16 kHz < 22 kHz
    expect(node(b.musicLP).frequency.value).toBe(16000);
    expect(muffleOpenHz({ sampleRate: 0 } as BaseAudioContext)).toBe(22000); // unbekannte Rate → 44.1 kHz-Annahme
  });
});

describe("setMuffle", () => {
  const dryTargets = (g: AudioGraph): [number | undefined, number | undefined] => [node(g.musicLP).frequency.target, node(g.muffleDry).gain.target];

  it("amount 1: Tiefpass 900 Hz und -5 dB, beide Pfade, Zeitkonstante 0,12 s", () => {
    const { g, ctx } = makeGraph();
    ctx.currentTime = 2;
    expect(setMuffle(g, 1)).toBe(1);
    const lin = Math.pow(10, MUFFLE_DB / 20);
    for (const lp of [g.musicLP, g.musicWetLP]) {
      expect(node(lp).frequency.target).toBeCloseTo(MUFFLE_HZ, 6);
      const ev = node(lp).frequency.active[0];
      expect(ev).toMatchObject({ op: "target", t: 2, tc: 0.12 });
    }
    for (const gn of [g.muffleDry, g.muffleWet]) expect(node(gn).gain.target).toBeCloseTo(lin, 9);
    expect(lin).toBeCloseTo(0.5623, 3);
    expect(g.muffle).toBe(1);
  });

  it("amount 0 stellt offen und Pegel 1 wieder her", () => {
    const { g } = makeGraph();
    setMuffle(g, 1);
    setMuffle(g, 0, 0.3);
    expect(dryTargets(g)[0]).toBeCloseTo(22000, 6);
    expect(dryTargets(g)[1]).toBeCloseTo(1, 9);
    expect(node(g.musicLP).frequency.active[0].tc).toBe(0.3);
  });

  it("klemmt auf 0..1 (auch NaN, ±Infinity) und gibt den geklemmten Wert zurück", () => {
    const { g } = makeGraph();
    expect(setMuffle(g, 5)).toBe(1);
    expect(dryTargets(g)[0]).toBeCloseTo(900, 6);
    expect(setMuffle(g, -3)).toBe(0);
    expect(dryTargets(g)[0]).toBeCloseTo(22000, 6);
    expect(setMuffle(g, Number.NaN)).toBe(0);
    expect(setMuffle(g, Number.POSITIVE_INFINITY)).toBe(0); // clamp01: nicht endlich → 0 (wie überall in der Engine)
    expect(g.muffle).toBe(0);
  });

  it("Zielwerte hängen nur vom zuletzt gesetzten Wert ab, nicht von der Reihenfolge der Aufrufe", () => {
    const orders: number[][] = [[1, 0.5, 0, 1], [0, 1, 0.5, 1], [0.5, 0, 1, 0.25, 1], [1, 1, 1]];
    for (const order of orders) {
      const { g } = makeGraph();
      for (const a of order) setMuffle(g, a);
      expect(dryTargets(g)[0]).toBeCloseTo(900, 6);
      expect(node(g.musicWetLP).frequency.target).toBeCloseTo(900, 6);
      expect(dryTargets(g)[1]).toBeCloseTo(Math.pow(10, MUFFLE_DB / 20), 9);
      expect(g.muffle).toBe(1);
    }
    const { g } = makeGraph();
    for (const a of [1, 0.25, 0.75, 0.5]) setMuffle(g, a);
    expect(dryTargets(g)[0]).toBeCloseTo(Math.sqrt(22000 * 900), 6); // 0,5: geometrische Mitte (logarithmisch)
    expect(dryTargets(g)[1]).toBeCloseTo(Math.pow(10, (MUFFLE_DB * 0.5) / 20), 9);
  });

  it("jeder Aufruf verwirft Geplantes (cancelScheduledValues) – ein laufender Übergang bleibt stetig", () => {
    const { g } = makeGraph();
    setMuffle(g, 1);
    setMuffle(g, 0);
    const ops = node(g.musicLP).frequency.events.map((e) => e.op);
    expect(ops).toEqual(["cancel", "target", "cancel", "target"]);
  });

  it("ungültige Zeitkonstante fällt auf den Standard zurück, Mindestwert 5 ms", () => {
    const { g } = makeGraph();
    setMuffle(g, 1, Number.NaN);
    expect(node(g.musicLP).frequency.active[0].tc).toBe(0.12);
    setMuffle(g, 1, 0);
    expect(node(g.musicLP).frequency.active[0].tc).toBe(0.005);
  });
});

describe("Stinger-Bus und Lautstärke", () => {
  it("startet auf Musiklautstärke", () => {
    const { g } = makeGraph(48000, { music: 0.4 });
    expect(node(g.stingerBus).gain.value).toBeCloseTo(0.4, 9);
    expect(node(g.musicDry).gain.value).toBeCloseTo(0.4, 9);
  });

  it("applyMusicVolume führt stingerBus mit (wie musicDry/musicWet), sfx bleibt unberührt", () => {
    const { g } = makeGraph();
    g.volumes.music = 0.7;
    applyMusicVolume(g);
    for (const gn of [g.musicDry, g.musicWet, g.stingerBus]) expect(node(gn).gain.target).toBeCloseTo(0.7, 9);
    expect(node(g.sfxDry).gain.target).toBeUndefined();
    g.volumes.music = 0;
    applyMusicVolume(g);
    expect(node(g.stingerBus).gain.target).toBe(0);
  });

  it("Sichtbarkeitsprüfungen: Musik und SFX getrennt", () => {
    const { g } = makeGraph();
    g.volumes.music = 0;
    expect(musicAudible(g)).toBe(false);
    expect(sfxAudible(g)).toBe(true);
    g.volumes.music = 0.6;
    g.volumes.sfx = 0;
    expect(musicAudible(g)).toBe(true);
    expect(sfxAudible(g)).toBe(false);
  });
});

describe("releaseDuck", () => {
  it("hebt einen aktiven Duck auf: duckUntil 0, beide Stufen blenden mit τ 0,12 s auf 1", () => {
    const { g, ctx } = makeGraph();
    ctx.currentTime = 10;
    duckMusic(g, 0.85, 9);
    expect(g.duckUntil).toBe(19);
    expect(g.duckTarget).toBeCloseTo(0.15, 9);
    ctx.currentTime = 11;
    releaseDuck(g);
    expect(g.duckUntil).toBe(0);
    expect(g.duckTarget).toBe(1);
    for (const gn of [g.duckDry, g.duckWet]) {
      const a = node(gn).gain.active;
      // nach dem letzten cancel liegt nur noch das Zurückblenden, das spätere Ende des Ducks (t = 19) ist verworfen
      expect(a).toEqual([{ op: "target", v: 1, t: 11, tc: 0.12 }]);
    }
  });

  it("danach beginnt ein neuer Duck wieder frisch (nicht mit der alten Tiefe)", () => {
    const { g, ctx } = makeGraph();
    duckMusic(g, 0.85, 9);
    ctx.currentTime = 1;
    releaseDuck(g);
    ctx.currentTime = 2;
    duckMusic(g, 0.3, 1);
    expect(g.duckTarget).toBeCloseTo(0.7, 9);
    expect(g.duckUntil).toBe(3);
  });

  it("ohne aktiven Duck harmlos", () => {
    const { g } = makeGraph();
    expect(() => releaseDuck(g, 0.05)).not.toThrow();
    expect(g.duckUntil).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
  });
});
