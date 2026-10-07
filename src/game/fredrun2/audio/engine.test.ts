import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEngine, createNoopAudio, prefetchAudio, type EngineDebug } from "./engine";
import { MUFFLE_HZ } from "./graph";
import { createAudio, preloadAudio } from "./index";
import { MusicLibrary } from "./tracks";
import type { FredAudio } from "./types";

// -----------------------------------------------------------------------------------------------------------------
// Fake-AudioContext: kein Web Audio in Node. Knoten merken Verbindungen, Quellen ihre start()/stop()-Zeiten, der Zustand
// (suspended/running) und das Ende von resume() werden vom Test gesteuert.
// -----------------------------------------------------------------------------------------------------------------
class FakeParam {
  value = 0;
  targets: Array<{ v: number; t: number; tc: number }> = [];
  setValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(): this {
    return this;
  }
  setValueCurveAtTime(): this {
    return this;
  }
  setTargetAtTime(v: number, t: number, tc: number): this {
    this.targets.push({ v, t, tc });
    return this;
  }
  cancelScheduledValues(): this {
    return this;
  }
  get lastTarget(): { v: number; t: number; tc: number } | undefined {
    return this.targets[this.targets.length - 1];
  }
}
const PARAMS = ["gain", "frequency", "Q", "detune", "playbackRate", "pan", "threshold", "knee", "ratio", "attack", "release", "delayTime", "offset"] as const;
class FakeNode {
  readonly out: FakeNode[] = [];
  [key: string]: unknown;
  constructor() {
    for (const p of PARAMS) this[p] = new FakeParam();
  }
  connect(n: FakeNode): FakeNode {
    this.out.push(n);
    return n;
  }
  disconnect(): void {
    this.out.length = 0;
  }
  start(): void {}
  stop(): void {}
  setPeriodicWave(): void {}
}
class FakeBuffer {
  private readonly data: Float32Array;
  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {
    this.data = new Float32Array(length);
  }
  get duration(): number {
    return this.length / this.sampleRate;
  }
  getChannelData(...ch: number[]): Float32Array {
    void ch;
    return this.data;
  }
}
class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  onended: (() => void) | null = null;
  override start(t = 0): void {
    this.startedAt = t;
  }
  override stop(t = 0): void {
    this.stoppedAt = t;
  }
  /** Test: Quelle ist zu Ende (löst onended aus) */
  end(): void {
    this.onended?.();
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static initialState: "running" | "suspended" = "running";
  /** true: resume() schließt sofort ab; false: hängt bis Test.finishResume() */
  static immediateResume = true;
  static get last(): FakeAudioContext {
    return FakeAudioContext.instances[FakeAudioContext.instances.length - 1];
  }
  state: "running" | "suspended" | "closed" = FakeAudioContext.initialState;
  currentTime = 0;
  sampleRate = 48000;
  destination = new FakeNode();
  onstatechange: (() => void) | null = null;
  sources: FakeSource[] = [];
  resumeCalls = 0;
  private waiters: Array<() => void> = [];

  constructor() {
    FakeAudioContext.instances.push(this);
    // unbekannte create…-Methoden (Oszillator, Panner, Delay …) liefern generische Knoten
    return new Proxy(this, {
      get(t, p, r) {
        if (p in t) return Reflect.get(t, p, r);
        if (typeof p === "string" && p.startsWith("create")) return () => new FakeNode();
        return undefined;
      },
    });
  }
  createBuffer(ch: number, len: number, sr: number): FakeBuffer {
    return new FakeBuffer(ch, len, sr);
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  /** Dauer = Bytes / 1000 s (die Test-Dateien kodieren ihre Länge in der Größe) */
  decodeAudioData(data: ArrayBuffer): Promise<FakeBuffer> {
    return Promise.resolve(new FakeBuffer(1, Math.round((data.byteLength / 1000) * 8000), 8000));
  }
  setState(s: "running" | "suspended" | "closed"): void {
    this.state = s;
    this.onstatechange?.();
  }
  resume(): Promise<void> {
    this.resumeCalls++;
    if (FakeAudioContext.immediateResume) {
      this.setState("running");
      return Promise.resolve();
    }
    return new Promise<void>((res) => this.waiters.push(res));
  }
  /** Test: ein hängendes resume() läuft jetzt durch */
  finishResume(): void {
    this.setState("running");
    for (const w of this.waiters.splice(0)) w();
  }
  suspend(): Promise<void> {
    this.setState("suspended");
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.state = "closed";
    return Promise.resolve();
  }
}
type Ctor = Parameters<typeof createEngine>[0];
const Fake = FakeAudioContext as unknown as Ctor;

// ---- Fake-fetch: Musik-Manifest, Dateigrößen = Dauer in ms ----------------------------------------------------------
const info = (file: string) => ({ file, bpm: 120, period: 60, xfade: 1, length: 61 });
const MUSIC_MANIFEST = {
  menu: info("menu.mp3"),
  wien: info("wien.mp3"),
  "wien-2": info("wien-2.mp3"),
  alpen: info("alpen.mp3"),
  "alpen-2": info("alpen-2.mp3"),
};
const BANK_MANIFEST = { version: 1, file: "sfx-bank.mp3", rev: "r1" };
let requests: string[] = [];
function installFetch(): void {
  requests = [];
  vi.stubGlobal("fetch", async (url: string) => {
    requests.push(url);
    const path = url.split("?")[0];
    const reply = (json: unknown, bytes = 8): { ok: boolean; status: number; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> } => ({
      ok: true,
      status: 200,
      json: async () => json,
      arrayBuffer: async () => new ArrayBuffer(bytes),
    });
    if (path.endsWith("/music/music.json")) return reply(MUSIC_MANIFEST);
    if (path.endsWith("/sfx-bank.json")) return reply(BANK_MANIFEST);
    if (path.includes("/music/") && path.endsWith(".mp3")) return reply(null, 70_000); // 70 s
    if (path.includes("/jingles/") && path.endsWith(".mp3")) return reply(null, 8_400); // 8,4 s
    if (path.endsWith("/sfx-bank.mp3")) return reply(null, 5_000);
    return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  });
}
const mp3Requests = (kind: "music" | "jingles"): string[] => requests.filter((u) => u.includes(`/${kind}/`) && u.split("?")[0].endsWith(".mp3"));

async function flush(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}
const longSources = (ctx: FakeAudioContext): FakeSource[] => ctx.sources.filter((s) => s.buffer !== null && s.buffer.duration > 20);
const jingleSources = (ctx: FakeAudioContext): FakeSource[] => ctx.sources.filter((s) => s.buffer !== null && s.buffer.duration > 5 && s.buffer.duration < 20);

/** Engine mit laufendem Kontext und geladenen Jingles. */
async function startEngine(): Promise<{ audio: FredAudio; debug: EngineDebug; ctx: FakeAudioContext }> {
  const { audio, debug } = createEngine(Fake);
  await audio.unlock();
  const ctx = FakeAudioContext.last;
  debug.jingles!.prefetch();
  await flush();
  return { audio, debug, ctx };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeAudioContext.instances = [];
  FakeAudioContext.initialState = "running";
  FakeAudioContext.immediateResume = true;
  installFetch();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// -----------------------------------------------------------------------------------------------------------------
describe("Entsperren (audio-feel-02)", () => {
  /** Kontext startet suspendiert, resume() hängt (langsames Gerät/Safari): wie rt-slowresume.mjs */
  function slow(): void {
    FakeAudioContext.initialState = "suspended";
    FakeAudioContext.immediateResume = false;
  }

  it("läuft der Kontext erst nach dem Zeitlimit von unlock(), startet onstatechange die gemerkte Musik und die Dauerklänge", async () => {
    slow();
    const { audio, debug } = createEngine(Fake);
    audio.music.play("wien");
    audio.loop("rain", true, 0.5);
    const p = audio.unlock();
    const ctx = FakeAudioContext.last;
    const loopSet = vi.spyOn(debug.loops!, "set").mockImplementation(() => {});
    await flush(1300); // 1,2-s-Zeitlimit: nur das Promise schließt ab
    await p;
    expect(audio.unlocked).toBe(false);
    expect(ctx.state).toBe("suspended");
    expect(longSources(ctx)).toHaveLength(0);
    expect(audio.music.current).toBe("wien"); // gemerkt

    ctx.finishResume(); // Resume kommt 2,5 s nach dem Aufruf
    await flush(50);
    expect(audio.unlocked).toBe(true);
    expect(loopSet).toHaveBeenCalledWith("rain", true, 0.5);
    expect(mp3Requests("music")).toHaveLength(1);
    expect(longSources(ctx).length).toBeGreaterThan(0);
    expect(audio.music.current).toBe("wien");
  });

  it("statechange → running ohne everRunning startet pendingPlay auch ohne laufenden unlock()-Aufruf", async () => {
    slow();
    const { audio } = createEngine(Fake);
    void audio.unlock();
    const ctx = FakeAudioContext.last;
    audio.music.play("alpen", { intensity: 0.4 });
    expect(longSources(ctx)).toHaveLength(0);
    ctx.setState("running"); // der Browser meldet „running“, kein finish()/resume-Ergebnis abgewartet
    await flush(50);
    expect(longSources(ctx).length).toBeGreaterThan(0);
  });

  it("jeder weitere unlock() versucht es erneut (resume), solange nicht gelaufen; danach ist er ein No-Op", async () => {
    slow();
    const { audio } = createEngine(Fake);
    const p1 = audio.unlock();
    const ctx = FakeAudioContext.last;
    await flush(1300);
    await p1;
    expect(ctx.resumeCalls).toBe(1);
    const p2 = audio.unlock(); // nächste Geste
    expect(ctx.resumeCalls).toBe(2);
    ctx.finishResume();
    await p2;
    expect(audio.unlocked).toBe(true);
    await audio.unlock();
    expect(ctx.resumeCalls).toBe(2); // läuft schon: kein weiterer resume()
  });

  it("sfx() vor dem „running“ versucht ein erneutes resume (auch ohne everRunning), höchstens alle 500 ms", async () => {
    slow();
    const { audio } = createEngine(Fake);
    const p = audio.unlock();
    const ctx = FakeAudioContext.last;
    await flush(1300);
    await p;
    expect(ctx.resumeCalls).toBe(1);
    audio.sfx("coin");
    expect(ctx.resumeCalls).toBe(2);
    audio.sfx("coin");
    expect(ctx.resumeCalls).toBe(2); // gedrosselt
    await flush(600);
    audio.sfx("coin");
    expect(ctx.resumeCalls).toBe(3);
  });

  it("suspend() hält gemerktes zurück: ein „running“ im pausierten Zustand startet nichts", async () => {
    slow();
    const { audio } = createEngine(Fake);
    void audio.unlock();
    const ctx = FakeAudioContext.last;
    audio.music.play("wien");
    audio.suspend();
    ctx.setState("running");
    await flush(50);
    expect(longSources(ctx)).toHaveLength(0);
    audio.resume(); // Resume nach der Pause startet es
    ctx.finishResume();
    await flush(50);
    expect(longSources(ctx).length).toBeGreaterThan(0);
  });

  it("unlocked-Semantik bleibt: erst nach dem ersten „running“", async () => {
    const { audio } = createEngine(Fake);
    expect(audio.unlocked).toBe(false);
    await audio.unlock();
    expect(audio.unlocked).toBe(true);
    audio.suspend();
    expect(audio.unlocked).toBe(true); // „war einmal running“, auch während der Pause
    audio.dispose();
    expect(audio.unlocked).toBe(false);
  });
});

// -----------------------------------------------------------------------------------------------------------------
describe("Stinger stoppen (audio-feel-01)", () => {
  it("stopStingers blendet laufende Jingles aus, setzt duckUntil auf 0 und führt duckDry/duckWet auf 1 zurück", async () => {
    const { audio, debug, ctx } = await startEngine();
    ctx.currentTime = 5;
    audio.sfx("gameover");
    expect(debug.jingles!.playing).toBe(1);
    expect(debug.graph!.duckUntil).toBeGreaterThan(5);
    const [src] = jingleSources(ctx);
    expect(src.stoppedAt).toBeNull();

    ctx.currentTime = 6;
    audio.stopStingers(); // Standard 0,3 s
    expect(debug.graph!.duckUntil).toBe(0);
    expect(debug.graph!.duckTarget).toBe(1);
    for (const d of [debug.graph!.duckDry, debug.graph!.duckWet]) expect((d.gain as unknown as FakeParam).lastTarget).toEqual({ v: 1, t: 6, tc: 0.12 });
    expect(src.stoppedAt).toBeGreaterThan(6.3); // nach der Ausblendung …
    expect(src.stoppedAt).toBeLessThanOrEqual(6.5); // … aber deutlich vor 0,6 s
    const gain = src.out[0].gain as FakeParam;
    expect(gain.lastTarget).toEqual({ v: 0, t: 6, tc: 0.3 / 4 });

    expect(debug.jingles!.stopAll()).toBe(0); // schon im Ausklingen
    src.end();
    expect(debug.jingles!.playing).toBe(0);
  });

  it("stopAll beendet alle Handles (mehrere Jingles gleichzeitig)", async () => {
    const { audio, debug, ctx } = await startEngine();
    audio.sfx("gameover");
    audio.sfx("highscore"); // zwei Stinger parallel (z. B. Highscore direkt nach Game Over)
    expect(debug.jingles!.playing).toBe(2);
    expect(debug.jingles!.stopAll(0.2)).toBe(2);
    expect(jingleSources(ctx).every((s) => s.stoppedAt !== null)).toBe(true);
    for (const s of jingleSources(ctx)) s.end();
    expect(debug.jingles!.playing).toBe(0);
  });

  it("stopStingers ohne laufenden Jingle setzt trotzdem einen SFX-Duck zurück und wirft nicht", async () => {
    const { audio, debug } = await startEngine();
    audio.duck(0.6, 3);
    expect(debug.graph!.duckUntil).toBeGreaterThan(0);
    expect(() => audio.stopStingers()).not.toThrow();
    expect(debug.graph!.duckUntil).toBe(0);
  });

  it("gameover/highscore lösen einen noch laufenden Weltwechsel-Jingle ab, der neue Jingle bleibt", async () => {
    const { audio, debug, ctx } = await startEngine();
    audio.sfx("world-transition");
    expect(jingleSources(ctx)).toHaveLength(1);
    const [transition] = jingleSources(ctx);
    audio.sfx("gameover");
    expect(jingleSources(ctx)).toHaveLength(2);
    const gameover = jingleSources(ctx)[1];
    expect(transition.stoppedAt).not.toBeNull();
    expect(gameover.stoppedAt).toBeNull();
    expect(debug.jingles!.playing).toBe(2);
  });

  it("ein Weltwechsel löst keinen laufenden Game-Over-Jingle ab", async () => {
    const { audio, ctx } = await startEngine();
    audio.sfx("gameover");
    audio.sfx("world-transition");
    expect(jingleSources(ctx).every((s) => s.stoppedAt === null)).toBe(true);
  });

  it("No-Op vor dem Entsperren und nach dispose", async () => {
    const { audio } = createEngine(Fake);
    expect(() => audio.stopStingers()).not.toThrow();
    await audio.unlock();
    audio.dispose();
    expect(() => audio.stopStingers()).not.toThrow();
  });
});

// -----------------------------------------------------------------------------------------------------------------
describe("Stinger am Musik-Regler (audio-feel-06)", () => {
  it("Jingles laufen über den stingerBus (nicht über sfxDry)", async () => {
    const { audio, debug, ctx } = await startEngine();
    audio.sfx("gameover");
    const [src] = jingleSources(ctx);
    expect(src.out[0].out).toEqual([debug.graph!.stingerBus as unknown as FakeNode]);
    expect(src.out[0].out).not.toContain(debug.graph!.sfxDry as unknown as FakeNode);
  });

  it("Musik aus (0): kein Jingle, auch kein synthetischer Ersatz – trotz Effekten an", async () => {
    const { audio, debug, ctx } = await startEngine();
    const play = vi.spyOn(debug.sfxPlayer!, "play");
    audio.setMusicVolume(0);
    audio.sfx("gameover");
    audio.sfx("highscore");
    expect(jingleSources(ctx)).toHaveLength(0);
    expect(debug.jingles!.playing).toBe(0);
    expect(play).not.toHaveBeenCalled();
    expect(debug.graph!.duckUntil).toBe(0); // und die Musik wird nicht geduckt
  });

  it("Effekte aus (0), Musik an: der Jingle ist hörbar", async () => {
    const { audio, debug, ctx } = await startEngine();
    audio.setSfxVolume(0);
    audio.sfx("gameover");
    expect(jingleSources(ctx)).toHaveLength(1);
    expect(debug.jingles!.playing).toBe(1);
  });

  it("Weltwechsel bei Musik 0: kein Jingle, der Effekt-Anteil (Bank/Synth) läuft weiter am Effekt-Regler", async () => {
    const { audio, debug, ctx } = await startEngine();
    const play = vi.spyOn(debug.sfxPlayer!, "play");
    audio.setMusicVolume(0);
    audio.sfx("world-transition");
    expect(jingleSources(ctx)).toHaveLength(0);
    expect(play).toHaveBeenCalledTimes(1);
    expect(play.mock.calls[0][0]).toBe("world-transition");
    audio.setSfxVolume(0);
    audio.sfx("world-transition");
    expect(play).toHaveBeenCalledTimes(1); // Effekte aus: nichts
  });

  it("noch nicht geladener Jingle: synthetischer Ersatz wie bisher (am Effekt-Regler)", async () => {
    const { audio, debug } = createEngine(Fake);
    await audio.unlock();
    const play = vi.spyOn(debug.sfxPlayer!, "play");
    audio.sfx("gameover"); // Jingle noch nicht geladen → lädt jetzt, spielt den synthetischen Effekt
    expect(play).toHaveBeenCalledTimes(1);
    expect(play.mock.calls[0][0]).toBe("gameover");
    expect(debug.jingles!.playing).toBe(0);
    audio.setSfxVolume(0);
    audio.sfx("gameover");
    expect(play).toHaveBeenCalledTimes(1); // Effekte aus: auch der Ersatz schweigt
  });

  it("setMusicVolume führt den stingerBus mit", async () => {
    const { audio, debug } = await startEngine();
    audio.setMusicVolume(0.3);
    expect((debug.graph!.stingerBus.gain as unknown as FakeParam).lastTarget?.v).toBeCloseTo(0.3, 9);
  });
});

// -----------------------------------------------------------------------------------------------------------------
describe("Musik dämpfen (audio-feel-05)", () => {
  const lp = (d: EngineDebug): FakeParam => d.graph!.musicLP.frequency as unknown as FakeParam;

  it("setMuffle(1, 0.12): Cutoff 900 Hz, klemmt auf 0..1", async () => {
    const { audio, debug } = await startEngine();
    audio.music.setMuffle(1, 0.12);
    expect(lp(debug).lastTarget).toMatchObject({ tc: 0.12 });
    expect(lp(debug).lastTarget!.v).toBeCloseTo(MUFFLE_HZ, 6);
    audio.music.setMuffle(7);
    expect(debug.graph!.muffle).toBe(1);
    audio.music.setMuffle(-1);
    expect(debug.graph!.muffle).toBe(0);
    expect(lp(debug).lastTarget!.v).toBeCloseTo(22000, 6);
  });

  it("play() und stop() setzen die Dämpfung zurück (stop mit der Ausblendzeit)", async () => {
    const { audio, debug } = await startEngine();
    audio.music.setMuffle(1);
    audio.music.play("wien");
    expect(debug.graph!.muffle).toBe(0);
    expect(lp(debug).lastTarget).toMatchObject({ tc: 0.3 });
    audio.music.setMuffle(1);
    audio.music.stop(2);
    expect(debug.graph!.muffle).toBe(0);
    expect(lp(debug).lastTarget).toMatchObject({ tc: 2 });
  });

  it("vor dem Entsperren gesetzt: gilt, sobald der Graph existiert; play() davor setzt zurück", async () => {
    const a = createEngine(Fake);
    a.audio.music.setMuffle(1);
    await a.audio.unlock();
    expect(a.debug.graph!.muffle).toBe(1);
    expect(lp(a.debug).lastTarget!.v).toBeCloseTo(MUFFLE_HZ, 6);
    const b = createEngine(Fake);
    b.audio.music.setMuffle(1);
    b.audio.music.play("wien"); // vor dem Unlock: Dämpfung verfällt
    await b.audio.unlock();
    expect(b.debug.graph!.muffle).toBe(0);
  });

  it("No-Op nach dispose", async () => {
    const { audio } = await startEngine();
    audio.dispose();
    expect(() => audio.music.setMuffle(1)).not.toThrow();
  });
});

// -----------------------------------------------------------------------------------------------------------------
describe("Vorwärmen (audio-feel-10)", () => {
  it("ohne fetch (SSR) ein No-Op: kein Fehler, keine Anfrage", () => {
    vi.stubGlobal("fetch", undefined);
    const lib = new MusicLibrary();
    expect(() => prefetchAudio(lib, { music: ["wien"] })).not.toThrow();
    expect(() => preloadAudio({ music: ["wien"] })).not.toThrow();
    expect(() => createEngine(Fake).audio.prefetch({ music: ["wien"] })).not.toThrow();
    expect(() => createNoopAudio().prefetch({ music: ["wien"] })).not.toThrow();
    expect(requests).toHaveLength(0);
  });

  it("holt SFX-Bank (Manifest + MP3 mit Revision), Musik-Manifest und genau eine Variante je Stück – ohne Entsperren", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99); // Variante „-2“
    const { audio } = createEngine(Fake);
    audio.prefetch({ music: ["wien", "alpen"] });
    await flush(10);
    const paths = requests.map((u) => u.split("?")[0]);
    expect(paths.filter((p) => p.endsWith("/sfx-bank.json"))).toHaveLength(1);
    expect(requests.some((u) => /\/sfx-bank\.mp3\?v=r1$/.test(u))).toBe(true);
    expect(paths.filter((p) => p.endsWith("/music/music.json"))).toHaveLength(1);
    expect(mp3Requests("music").map((u) => u.split("?")[0].split("/").pop()).sort()).toEqual(["alpen-2.mp3", "wien-2.mp3"]);
    expect(FakeAudioContext.instances).toHaveLength(0); // kein AudioContext angelegt
    // wiederholt: nichts doppelt
    const n = requests.length;
    audio.prefetch({ music: ["wien", "alpen"] });
    await flush(10);
    expect(requests.length).toBe(n);
  });

  it("ohne Angabe nur das Menüstück; leere Liste nur Bank und Manifest", async () => {
    const { audio } = createEngine(Fake);
    audio.prefetch({});
    await flush(10);
    expect(mp3Requests("music").map((u) => u.split("?")[0].split("/").pop())).toEqual(["menu.mp3"]);
    const { audio: b } = createEngine(Fake);
    requests.length = 0;
    b.prefetch({ music: [] });
    await flush(10);
    expect(mp3Requests("music")).toHaveLength(0);
  });

  it("niedrige Priorität", async () => {
    const calls: unknown[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: { priority?: string }) => {
      calls.push([url.split("?")[0].split("/").pop(), init?.priority]);
      return { ok: true, status: 200, json: async () => (url.includes("music.json") ? MUSIC_MANIFEST : BANK_MANIFEST), arrayBuffer: async () => new ArrayBuffer(8) };
    });
    createEngine(Fake).audio.prefetch({ music: ["menu"] });
    await flush(10);
    expect(calls).toContainEqual(["sfx-bank.mp3", "low"]);
    expect(calls).toContainEqual(["menu.mp3", "low"]);
  });

  it("music.play spielt nach dem Vorwärmen dieselbe Variante: keine zweite Datei wird geladen", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const { audio, debug } = createEngine(Fake);
    audio.prefetch({ music: ["wien"] });
    await flush(10);
    const warmed = mp3Requests("music").map((u) => u.split("?")[0].split("/").pop());
    expect(warmed).toEqual(["wien-2.mp3"]);
    random.mockReturnValue(0); // würde jetzt „wien“ wählen – darf nicht passieren
    await audio.unlock();
    audio.music.play("wien");
    await flush(50);
    expect(mp3Requests("music").map((u) => u.split("?")[0].split("/").pop())).toEqual(["wien-2.mp3", "wien-2.mp3"]); // Warm-Anfrage + Abspielen (Cache-Treffer)
    expect(longSources(FakeAudioContext.last).length).toBeGreaterThan(0);
    expect(debug.tracks!.current).toBe("wien");
  });

  it("geteilte Bibliothek: preloadAudio vor createAudio-Entsperren legt die Variante fest", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    vi.stubGlobal("AudioContext", FakeAudioContext);
    preloadAudio({ music: ["alpen"] });
    await flush(10);
    random.mockReturnValue(0);
    const audio = createAudio();
    await audio.unlock();
    audio.music.play("alpen");
    await flush(50);
    const files = mp3Requests("music").map((u) => u.split("?")[0].split("/").pop());
    expect(files).not.toContain("alpen.mp3");
    expect(files.filter((f) => f === "alpen-2.mp3").length).toBeGreaterThanOrEqual(1);
    audio.dispose();
  });

  it("Fehler beim Vorwärmen werden still geschluckt und später erneut versucht", async () => {
    let fail = true;
    vi.stubGlobal("fetch", async (url: string) => {
      requests.push(url);
      if (fail) throw new Error("offline");
      return { ok: true, status: 200, json: async () => (url.includes("music.json") ? MUSIC_MANIFEST : BANK_MANIFEST), arrayBuffer: async () => new ArrayBuffer(8) };
    });
    const lib = new MusicLibrary();
    expect(() => prefetchAudio(lib, { music: ["wien"] })).not.toThrow();
    await flush(10);
    fail = false;
    prefetchAudio(lib, { music: ["wien"] });
    await flush(10);
    expect(requests.some((u) => u.split("?")[0].endsWith("/music/wien.mp3") || u.split("?")[0].endsWith("/music/wien-2.mp3"))).toBe(true);
  });
});

// -----------------------------------------------------------------------------------------------------------------
describe("audioSession (mobile-robust-12)", () => {
  type Session = { type: string };
  const stubSession = (session: Session): void => {
    vi.stubGlobal("navigator", { audioSession: session });
  };

  it("unlock() setzt type auf „playback“, Stummschalten/Pause/Entsorgen auf „auto“, Aufheben wieder auf „playback“", async () => {
    const session: Session = { type: "auto" };
    stubSession(session);
    const { audio } = createEngine(Fake);
    expect(session.type).toBe("auto"); // vor unlock() unberührt
    audio.setMuted(true);
    audio.setMuted(false);
    expect(session.type).toBe("auto");
    await audio.unlock();
    expect(session.type).toBe("playback");
    audio.setMuted(true);
    expect(session.type).toBe("auto");
    audio.setMuted(false);
    expect(session.type).toBe("playback");
    audio.suspend(); // verstecktes Tab
    expect(session.type).toBe("auto");
    audio.resume();
    expect(session.type).toBe("playback");
    audio.dispose();
    expect(session.type).toBe("auto");
  });

  it("stummgeschaltet entsperrt: bleibt „auto“ bis zum Einschalten", async () => {
    const session: Session = { type: "auto" };
    stubSession(session);
    const { audio } = createEngine(Fake);
    audio.setMuted(true);
    await audio.unlock();
    expect(session.type).toBe("auto");
    audio.setMuted(false);
    expect(session.type).toBe("playback");
  });

  it("ohne API (kein navigator.audioSession, kein navigator) passiert nichts und es wird nichts geworfen", async () => {
    vi.stubGlobal("navigator", {});
    const a = createEngine(Fake);
    await expect(a.audio.unlock()).resolves.toBeUndefined();
    a.audio.setMuted(true);
    a.audio.suspend();
    a.audio.resume();
    a.audio.dispose();
    vi.stubGlobal("navigator", undefined);
    const b = createEngine(Fake);
    await expect(b.audio.unlock()).resolves.toBeUndefined();
    expect(b.audio.unlocked).toBe(true);
  });

  it("werfende Getter/Setter (Browser-Eigenheiten) werden abgefangen", async () => {
    vi.stubGlobal("navigator", {
      get audioSession(): never {
        throw new Error("gesperrt");
      },
    });
    const a = createEngine(Fake);
    await expect(a.audio.unlock()).resolves.toBeUndefined();
    expect(a.audio.unlocked).toBe(true);
    const session = {
      get type(): string {
        return "auto";
      },
      set type(_v: string) {
        throw new Error("nicht erlaubt");
      },
    };
    vi.stubGlobal("navigator", { audioSession: session });
    const b = createEngine(Fake);
    await expect(b.audio.unlock()).resolves.toBeUndefined();
    b.audio.setMuted(true);
    expect(b.audio.unlocked).toBe(true);
  });
});

// -----------------------------------------------------------------------------------------------------------------
describe("createNoopAudio", () => {
  it("liefert alle neuen Mitglieder als No-Op", () => {
    const a = createNoopAudio();
    expect(() => {
      a.stopStingers();
      a.stopStingers(0.5);
      a.prefetch({ music: ["wien"] });
      a.music.setMuffle(1, 0.12);
    }).not.toThrow();
    expect(a.unlocked).toBe(false);
  });
});
