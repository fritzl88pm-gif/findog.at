import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BANK_FORMAT_VERSION,
  detectSync,
  jitterRate,
  MIN_SLICE_GAP,
  parseManifest,
  SfxBank,
  sliceFrames,
  syncShift,
  VariantPicker,
  type BankManifest,
} from "./bank";
import type { AudioGraph } from "./graph";
import { SfxPlayer } from "./sfx";
import { SFX_NAMES } from "./types";

/** Zufallsquelle mit festem Startwert (mulberry32), damit die Tests reproduzierbar sind. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const goodRaw = (): Record<string, unknown> => ({
  version: BANK_FORMAT_VERSION,
  file: "sfx-bank.mp3",
  rev: "abc123",
  sampleRate: 44100,
  duration: 10,
  sync: { at: 0.06 },
  effects: {
    jump: { variants: [{ start: 0.25, dur: 0.2 }, { start: 0.6, dur: 0.2 }], pitchJitter: 0.04, reverb: 0.05 },
    coin: { variants: [{ start: 1, dur: 0.3, gain: 0.9 }], gain: 1.2 },
    "near-miss": { variants: [{ start: 2, dur: 0.35 }], sweep: { from: -0.8, to: 0.8, flip: true } },
  },
});

describe("Manifest-Validierung", () => {
  it("akzeptiert ein gültiges Manifest und übernimmt alle Felder", () => {
    const r = parseManifest(goodRaw());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.manifest.effects)).toEqual(["jump", "coin", "near-miss"]);
    expect(r.manifest.effects.jump?.pitchJitter).toBe(0.04);
    expect(r.manifest.effects.coin?.variants[0]?.gain).toBe(0.9);
    expect(r.manifest.effects["near-miss"]?.sweep).toEqual({ from: -0.8, to: 0.8, flip: true });
    expect(r.manifest.sync?.at).toBe(0.06);
  });

  it("lehnt unbekannte Effekt-Namen, falsche Version und schlechte Dateinamen ab", () => {
    const raw = goodRaw();
    (raw.effects as Record<string, unknown>).nonsense = { variants: [{ start: 3, dur: 0.1 }] };
    let r = parseManifest(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/nonsense/);
    r = parseManifest({ ...goodRaw(), version: 2 });
    expect(r.ok).toBe(false);
    r = parseManifest({ ...goodRaw(), file: "../evil.mp3" });
    expect(r.ok).toBe(false);
    r = parseManifest({ ...goodRaw(), file: "a/b.mp3" });
    expect(r.ok).toBe(false);
    expect(parseManifest(null).ok).toBe(false);
    expect(parseManifest([]).ok).toBe(false);
  });

  it("prüft Zeiten: negativ, zu lang, über das Sprite hinaus", () => {
    for (const bad of [{ start: -1, dur: 0.2 }, { start: 1, dur: 0 }, { start: 1, dur: 11 }, { start: 9.95, dur: 0.2 }, { start: "x", dur: 1 }]) {
      const raw = goodRaw();
      raw.effects = { jump: { variants: [bad] } };
      expect(parseManifest(raw).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("erkennt überlappende bzw. zu dicht liegende Slices, auch effektübergreifend", () => {
    const raw = goodRaw();
    raw.effects = { jump: { variants: [{ start: 1, dur: 0.5 }] }, coin: { variants: [{ start: 1.5 + MIN_SLICE_GAP / 2, dur: 0.2 }] } };
    const r = parseManifest(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/überlappen/);
    raw.effects = { jump: { variants: [{ start: 1, dur: 0.5 }] }, coin: { variants: [{ start: 1.5 + MIN_SLICE_GAP * 2, dur: 0.2 }] } };
    expect(parseManifest(raw).ok).toBe(true);
  });

  it("prüft Wertebereiche (gain, pitchJitter, pan, reverb, sweep)", () => {
    for (const patch of [{ gain: 0 }, { gain: 9 }, { pitchJitter: 0.9 }, { pan: 2 }, { reverb: -1 }, { sweep: { from: -2, to: 1 } }, { sweep: 3 }]) {
      const raw = goodRaw();
      raw.effects = { jump: { variants: [{ start: 1, dur: 0.2 }], ...patch } };
      expect(parseManifest(raw).ok, JSON.stringify(patch)).toBe(false);
    }
  });

  it("verlangt mindestens einen Effekt mit mindestens einer Variante", () => {
    expect(parseManifest({ ...goodRaw(), effects: {} }).ok).toBe(false);
    expect(parseManifest({ ...goodRaw(), effects: { jump: { variants: [] } } }).ok).toBe(false);
  });
});

describe("Variantenwahl", () => {
  it("wiederholt nie unmittelbar dieselbe Variante", () => {
    for (let count = 2; count <= 6; count++) {
      const p = new VariantPicker(seeded(count));
      let last = -1;
      for (let i = 0; i < 2000; i++) {
        const v = p.next("jump", count);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(count);
        expect(v).not.toBe(last);
        last = v;
      }
    }
  });

  it("nutzt in jeder Runde jede Variante genau einmal", () => {
    const p = new VariantPicker(seeded(7));
    for (let round = 0; round < 50; round++) {
      const seen = new Set<number>();
      for (let i = 0; i < 4; i++) seen.add(p.next("land", 4));
      expect(seen.size).toBe(4);
    }
  });

  it("führt Buch je Effekt und liefert bei einer Variante immer 0", () => {
    const p = new VariantPicker(seeded(3));
    for (let i = 0; i < 10; i++) expect(p.next("thunder", 1)).toBe(0);
    const a = Array.from({ length: 6 }, () => p.next("a", 3));
    const b = Array.from({ length: 6 }, () => p.next("b", 3));
    expect(new Set(a.slice(0, 3)).size).toBe(3);
    expect(new Set(b.slice(0, 3)).size).toBe(3);
  });

  it("bleibt bei degenerierter Zufallsquelle (immer 0 oder immer ~1) gültig und wiederholungsfrei", () => {
    for (const r of [() => 0, () => 0.999999]) {
      const p = new VariantPicker(r);
      let last = -1;
      for (let i = 0; i < 100; i++) {
        const v = p.next("x", 3);
        expect(v).not.toBe(last);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(3);
        last = v;
      }
    }
  });

  it("wendet Tonhöhen-Jitter begrenzt an", () => {
    expect(jitterRate(1, 0, () => 0.9)).toBe(1);
    expect(jitterRate(1, 0.04, () => 0)).toBeCloseTo(0.96, 6);
    expect(jitterRate(1, 0.04, () => 1)).toBeCloseTo(1.04, 6);
    expect(jitterRate(1.5, 0.04, () => 0.5)).toBeCloseTo(1.5, 6);
    expect(jitterRate(100, 0, () => 0.5)).toBe(3);
    expect(jitterRate(0.001, 0, () => 0.5)).toBe(0.25);
    expect(jitterRate(NaN, 0.03, () => 0.5)).toBe(1);
  });
});

describe("Encoder-Delay-Ausgleich und Slices", () => {
  const sr = 44100;
  const pcmWithPulseAt = (t: number, len = sr): Float32Array => {
    const d = new Float32Array(len);
    const i = Math.round(t * sr);
    for (let k = 0; k < 66; k++) d[i + k] = 0.9 * Math.sin((Math.PI * k) / 66) * (k % 2 ? 1 : -1);
    return d;
  };

  it("findet den Sync-Puls und leitet die Verschiebung ab", () => {
    const at = 0.06;
    expect(detectSync(pcmWithPulseAt(at), sr, at)).toBeCloseTo(at + 9 / sr, 4);
    const shifted = detectSync(pcmWithPulseAt(at + 0.025), sr, at);
    expect(syncShift(shifted, detectSync(pcmWithPulseAt(at), sr, at)!)).toBeCloseTo(0.025, 3);
    expect(detectSync(new Float32Array(sr), sr, at)).toBeNull();
  });

  it("ignoriert kleine (< 3 ms) und unplausible (> 80 ms) Abweichungen", () => {
    expect(syncShift(null, 0.06)).toBe(0);
    expect(syncShift(0.061, 0.06)).toBe(0);
    expect(syncShift(0.0625, 0.06)).toBe(0);
    expect(syncShift(0.0855, 0.06)).toBeCloseTo(0.0255, 6);
    expect(syncShift(0.2, 0.06)).toBe(0);
    expect(syncShift(0.03, 0.06)).toBeCloseTo(-0.03, 6);
  });

  it("schneidet Slices auf Sample-Grenzen und begrenzt sie am Pufferrand", () => {
    expect(sliceFrames({ start: 1, dur: 0.5 }, 0, 1000, 10000)).toEqual([1000, 1500]);
    expect(sliceFrames({ start: 1, dur: 0.5 }, 0.025, 1000, 10000)).toEqual([1025, 1525]);
    expect(sliceFrames({ start: 9.9, dur: 0.5 }, 0, 1000, 10000)).toEqual([9900, 10000]);
    expect(sliceFrames({ start: 0.001, dur: 0.5 }, -0.05, 1000, 10000)).toEqual([0, 451]);
    expect(sliceFrames({ start: 12, dur: 0.5 }, 0, 1000, 10000)).toBeNull();
    expect(sliceFrames({ start: 1, dur: 0.004 }, 0, 1000, 10000)).toBeNull();
  });
});

// -----------------------------------------------------------------------------------------------------------------
// SfxBank gegen einen kleinen Fake-AudioContext (kein echtes Web Audio in Node)
// -----------------------------------------------------------------------------------------------------------------
class FakeParam {
  value = 0;
  calls: Array<[string, number, number?]> = [];
  setValueAtTime(v: number, t: number): void {
    this.calls.push(["set", v, t]);
  }
  linearRampToValueAtTime(v: number, t: number): void {
    this.calls.push(["ramp", v, t]);
  }
  setTargetAtTime(v: number, t: number): void {
    this.calls.push(["target", v, t]);
  }
  cancelScheduledValues(): void {}
}
class FakeNode {
  out: FakeNode[] = [];
  disconnected = false;
  connect(n: FakeNode): FakeNode {
    this.out.push(n);
    return n;
  }
  disconnect(): void {
    this.disconnected = true;
  }
}
class FakeGain extends FakeNode {
  gain = new FakeParam();
}
class FakePanner extends FakeNode {
  pan = new FakeParam();
}
class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  playbackRate = new FakeParam();
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  start(t: number): void {
    this.startedAt = t;
  }
  stop(t: number): void {
    this.stoppedAt = t;
  }
}
class FakeBuffer {
  private data: Float32Array;
  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {
    this.data = new Float32Array(length);
  }
  get duration(): number {
    return this.length / this.sampleRate;
  }
  getChannelData(...channel: number[]): Float32Array {
    void channel; // wie das echte API: Kanalnummer, hier immer mono
    return this.data;
  }
}
class FakeCtx {
  currentTime = 0;
  sources: FakeSource[] = [];
  panners: FakePanner[] = [];
  gains: FakeGain[] = [];
  constructor(private readonly decoded: () => FakeBuffer) {}
  createBuffer(ch: number, len: number, sr: number): FakeBuffer {
    return new FakeBuffer(ch, len, sr);
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createStereoPanner(): FakePanner {
    const p = new FakePanner();
    this.panners.push(p);
    return p;
  }
  decodeAudioData(_d: ArrayBuffer, ok?: (b: FakeBuffer) => void): Promise<FakeBuffer> | undefined {
    const b = this.decoded();
    ok?.(b);
    return undefined; // wie ältere Safari-Versionen: nur Callback, kein Promise
  }
}

const SR = 8000;
/** Sprite mit 3 Slices (je 0.2 s), die je einen eindeutigen Wert tragen; Sync-Puls bei 0.06 s (um `delay` verspätet). */
function makeSprite(delay: number): FakeBuffer {
  const b = new FakeBuffer(1, 4 * SR, SR);
  const d = b.getChannelData(0);
  const put = (t: number, len: number, val: number): void => {
    for (let i = Math.round((t + delay) * SR); i < Math.round((t + delay + len) * SR); i++) d[i] = val;
  };
  put(0.06, 0.004, 0.9);
  put(0.25, 0.2, 0.11); // jump#0
  put(0.6, 0.2, 0.22); // jump#1
  put(1.0, 0.3, 0.33); // coin#0
  return b;
}
const bankManifest = (): BankManifest => ({
  version: 1,
  file: "sfx-bank.mp3",
  rev: "r1",
  sampleRate: SR,
  duration: 4,
  sync: { at: 0.06 },
  effects: {
    jump: { variants: [{ start: 0.25, dur: 0.2 }, { start: 0.6, dur: 0.2 }], pitchJitter: 0.04 },
    coin: { variants: [{ start: 1, dur: 0.3 }], gain: 0.5, pan: 0.25 },
    "near-miss": { variants: [{ start: 2, dur: 0.35 }], sweep: { from: -0.8, to: 0.8, flip: true } },
  },
});
const fakeFetch = (m: unknown, urls: string[] = []) => async (url: string) => {
  urls.push(url);
  return {
    ok: true,
    json: async () => m,
    arrayBuffer: async () => new ArrayBuffer(8),
  };
};
const asCtx = (c: FakeCtx): BaseAudioContext => c as unknown as BaseAudioContext;
const asNode = (n: FakeNode): AudioNode => n as unknown as AudioNode;

describe("SfxBank", () => {
  it("lädt, zerlegt den Sprite in mono Slices und gleicht einen Encoder-Delay aus", async () => {
    for (const delay of [0, 0.025]) {
      const ctx = new FakeCtx(() => makeSprite(delay));
      const urls: string[] = [];
      const bank = new SfxBank(asCtx(ctx), { fetch: fakeFetch(bankManifest(), urls), rnd: seeded(1), baseUrl: "/x/" });
      expect(bank.has("jump")).toBe(false);
      expect(await bank.load()).toBe(true);
      expect(urls).toEqual(["/x/sfx-bank.json", "/x/sfx-bank.mp3?v=r1"]);
      expect(bank.ready).toBe(true);
      expect(bank.appliedShift).toBeCloseTo(delay, 3);
      const j = bank.variants("jump");
      expect(j).toHaveLength(2);
      expect(j[0]!.numberOfChannels).toBe(1);
      expect(j[0]!.length).toBe(1600);
      // Der Slice enthält genau seinen Wert – auch mit verspätetem Sprite
      expect(j[0]!.getChannelData(0)[0]).toBeCloseTo(0.11, 6);
      expect(j[0]!.getChannelData(0)[1599]).toBeCloseTo(0.11, 6);
      expect(j[1]!.getChannelData(0)[800]).toBeCloseTo(0.22, 6);
      expect(bank.variants("coin")[0]!.getChannelData(0)[1200]).toBeCloseTo(0.33, 6);
      expect(bank.names().sort()).toEqual(["coin", "jump", "near-miss"]);
    }
  });

  it("schluckt Ladefehler still und bleibt leer (Fallback auf prozedurale Stimmen)", async () => {
    const ctx = new FakeCtx(() => makeSprite(0));
    const bad = new SfxBank(asCtx(ctx), { fetch: async () => ({ ok: false, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }) });
    expect(await bad.load()).toBe(false);
    expect(bad.error).toMatch(/Manifest/);
    expect(bad.has("jump")).toBe(false);
    expect(bad.play("jump", asNode(new FakeNode()))).toBeNull();
    const invalid = new SfxBank(asCtx(ctx), { fetch: fakeFetch({ version: 9 }) });
    expect(await invalid.load()).toBe(false);
    expect(invalid.error).toMatch(/ungültig/);
    const boom = new SfxBank(asCtx(ctx), { fetch: async () => { throw new Error("offline"); } });
    expect(await boom.load()).toBe(false);
    expect(boom.error).toBe("offline");
  });

  it("spielt Varianten ohne unmittelbare Wiederholung mit Jitter, Gain und Pan", async () => {
    const ctx = new FakeCtx(() => makeSprite(0));
    const bank = new SfxBank(asCtx(ctx), { fetch: fakeFetch(bankManifest()), rnd: seeded(5) });
    await bank.load();
    const dest = new FakeNode();
    const lens: number[] = [];
    for (let i = 0; i < 20; i++) {
      const v = bank.play("jump", asNode(dest), { pitch: 1, volume: 0.5, when: 1 + i });
      expect(v).not.toBeNull();
      const src = ctx.sources[ctx.sources.length - 1]!;
      lens.push(src.buffer!.getChannelData(0)[0]! > 0.15 ? 1 : 0);
      expect(src.startedAt).toBe(1 + i);
      expect(src.playbackRate.value).toBeGreaterThanOrEqual(0.96);
      expect(src.playbackRate.value).toBeLessThanOrEqual(1.04);
      expect(v!.endTime).toBeCloseTo(1 + i + 0.2 / src.playbackRate.value, 6);
      src.onended?.();
    }
    for (let i = 1; i < lens.length; i++) expect(lens[i]).not.toBe(lens[i - 1]);
    // Lautstärke * Manifest-Gain, Standard-Pan aus dem Manifest
    bank.play("coin", asNode(dest), { volume: 0.8 });
    const g = ctx.gains[ctx.gains.length - 1]!;
    expect(g.gain.value).toBeCloseTo(0.4, 6);
    expect(ctx.panners[ctx.panners.length - 1]!.pan.value).toBeCloseTo(0.25, 6);
    // Aufrufer-Pan hat Vorrang, autoPan:false schaltet Manifest-Pan aus (kein Panner-Knoten)
    const before = ctx.panners.length;
    bank.play("coin", asNode(dest), { pan: -0.5 });
    expect(ctx.panners[before]!.pan.value).toBeCloseTo(-0.5, 6);
    bank.play("coin", asNode(dest), { autoPan: false });
    expect(ctx.panners.length).toBe(before + 1);
  });

  it("fährt Sweeps (mit zufälliger Richtung) nur ohne Aufrufer-Pan", async () => {
    const ctx = new FakeCtx(() => makeSprite(0));
    const bank = new SfxBank(asCtx(ctx), { fetch: fakeFetch(bankManifest()), rnd: seeded(11) });
    await bank.load();
    const dirs = new Set<number>();
    for (let i = 0; i < 30; i++) {
      bank.play("near-miss", asNode(new FakeNode()), { when: 2 });
      const p = ctx.panners[ctx.panners.length - 1]!;
      const ramp = p.pan.calls.find((c) => c[0] === "ramp")!;
      const set = p.pan.calls.find((c) => c[0] === "set")!;
      expect(Math.abs(set[1])).toBeCloseTo(0.8, 6);
      expect(ramp[1]).toBeCloseTo(-set[1], 6);
      dirs.add(Math.sign(set[1]));
    }
    expect(dirs.size).toBe(2);
    const n = ctx.panners.length;
    bank.play("near-miss", asNode(new FakeNode()), { pan: 0 });
    expect(ctx.panners.length).toBe(n);
  });

  it("räumt Knoten nach `ended` auf, meldet das Ende und begrenzt Stimmen pro Effekt", async () => {
    const ctx = new FakeCtx(() => makeSprite(0));
    const bank = new SfxBank(asCtx(ctx), { fetch: fakeFetch(bankManifest()), rnd: seeded(2), maxVoices: 3 });
    await bank.load();
    let ended = 0;
    const voices = [];
    for (let i = 0; i < 5; i++) voices.push(bank.play("coin", asNode(new FakeNode()), { onEnded: () => ended++ }));
    // die beiden ältesten wurden weich ausgeblendet (Stimmen-Cap 3)
    const stopped = ctx.sources.filter((s) => s.stoppedAt !== null).length;
    expect(stopped).toBe(2);
    const first = ctx.sources[0]!;
    first.onended?.();
    expect(first.disconnected).toBe(true);
    expect(ended).toBe(1);
    voices[0]!.stop(); // nach dem Ende wirkungslos
    bank.dispose();
    expect(bank.ready).toBe(false);
    expect(bank.play("coin", asNode(new FakeNode()))).toBeNull();
    expect(bank.has("coin")).toBe(false);
  });

  it("wird von dispose() während des Ladens nicht mehr befüllt", async () => {
    const ctx = new FakeCtx(() => makeSprite(0));
    const bank = new SfxBank(asCtx(ctx), { fetch: fakeFetch(bankManifest()) });
    const p = bank.load();
    bank.dispose();
    expect(await p).toBe(false);
    expect(bank.has("jump")).toBe(false);
  });
});

describe("SfxPlayer mit Sample-Bank", () => {
  function graphFor(ctx: FakeCtx): AudioGraph {
    return { ctx: asCtx(ctx), sfxDry: new FakeGain(), sfxWet: new FakeGain() } as unknown as AudioGraph;
  }

  it("spielt Sample-Effekte über die Voice (Pan, Reverb-Send, Stealing) und respektiert die Drosselung", async () => {
    const ctx = new FakeCtx(() => makeSprite(0));
    const player = new SfxPlayer(graphFor(ctx));
    const bank = player.enableBank(new SfxBank(asCtx(ctx), { fetch: fakeFetch(bankManifest()), rnd: seeded(4) }));
    expect(player.bank).toBe(bank);
    await bank.load();
    ctx.currentTime = 1;
    const v = player.play("jump", { pan: 0.3 });
    expect(v).not.toBeNull();
    expect(bank.played).toBe(1);
    const src = ctx.sources[ctx.sources.length - 1]!;
    expect(src.startedAt).toBeGreaterThanOrEqual(1);
    expect(v!.endTime).toBeGreaterThan(1);
    // Cooldown: sofortiger zweiter Aufruf wird verworfen
    expect(player.play("jump")).toBeNull();
    // Stimme wird beim Stealing ausgeblendet, Ende räumt die Voice auf
    v!.kill(1.5);
    expect(src.stoppedAt).not.toBeNull();
    src.onended?.();
    expect(player.activeVoices).toBe(0);
    // Sweep-Effekt: Voice-Panner fährt von/bis
    ctx.currentTime = 5;
    const nm = player.play("near-miss");
    expect(nm).not.toBeNull();
    const pan = ctx.panners[ctx.panners.length - 1]!.pan.calls;
    expect(pan.some((c) => c[0] === "ramp")).toBe(true);
    player.dispose();
    expect(player.bank).toBeNull();
  });
});

// -----------------------------------------------------------------------------------------------------------------
// Die ausgelieferte Bank (public/fredrun2/audio) muss zum Code passen
// -----------------------------------------------------------------------------------------------------------------
describe("ausgelieferte Bank", () => {
  const dir = new URL("../../../../public/fredrun2/audio/", import.meta.url);
  const jsonPath = new URL("sfx-bank.json", dir);
  const present = existsSync(jsonPath);

  it.skipIf(!present)("Manifest ist gültig, kennt nur SFX_NAMES und lässt die Jingle-Namen aus", () => {
    const raw = JSON.parse(readFileSync(jsonPath, "utf8")) as unknown;
    const r = parseManifest(raw, SFX_NAMES);
    expect(r.ok, r.ok ? "" : r.errors.join("\n")).toBe(true);
    if (!r.ok) return;
    const names = Object.keys(r.manifest.effects);
    expect(names).not.toContain("gameover");
    expect(names).not.toContain("highscore");
    for (const n of ["jump", "land", "coin", "slide", "stomp", "hurt", "ui-click"]) {
      expect(names, n).toContain(n);
      expect(r.manifest.effects[n]!.variants.length, `${n}: mehrere Varianten`).toBeGreaterThanOrEqual(2);
    }
    expect(r.manifest.duration).toBeLessThan(60);
    expect(r.manifest.sampleRate).toBe(44100);
    // Sprite beginnt mit Stille (Sync-Puls + Vorlauf) und Slices liegen mit Abstand nacheinander
    const all = names.flatMap((n) => r.manifest.effects[n]!.variants).sort((a, b) => a.start - b.start);
    expect(all[0]!.start).toBeGreaterThanOrEqual(0.2);
    for (let i = 1; i < all.length; i++) expect(all[i]!.start - (all[i - 1]!.start + all[i - 1]!.dur)).toBeGreaterThanOrEqual(0.1);
  });

  it.skipIf(!present)("MP3 gehört zum Manifest (Größe, Cache-Buster-Hash) und bleibt klein", () => {
    const m = JSON.parse(readFileSync(jsonPath, "utf8")) as BankManifest;
    const mp3 = new URL(m.file, dir);
    expect(existsSync(mp3)).toBe(true);
    const buf = readFileSync(mp3);
    expect(statSync(mp3).size).toBeLessThan(900 * 1024);
    expect(createHash("sha1").update(buf).digest("hex").slice(0, 10)).toBe(m.rev);
    // grob: CBR 112 kbps => Bytes ≈ Dauer * 14000
    expect(buf.length / m.duration).toBeGreaterThan(12000);
    expect(buf.length / m.duration).toBeLessThan(16000);
  });
});
