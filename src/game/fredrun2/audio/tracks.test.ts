import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AudioGraph } from "./graph";
import { downloadOnly, isJingle, JINGLES, JinglePlayer, MusicLibrary, TrackMusic, type TrackManifest } from "./tracks";
import { WORLD_MUSIC_IDS } from "./types";

const ROOT = path.resolve(__dirname, "../../../../public/fredrun2/audio");
const manifest = JSON.parse(readFileSync(path.join(ROOT, "music/music.json"), "utf8")) as TrackManifest;

describe("Musik-Manifest", () => {
  it("enthält alle Welt-Themen und die Heldenauswahl", () => {
    for (const id of [...WORLD_MUSIC_IDS, "select", "winter", "oper"]) expect(manifest[id], id).toBeDefined();
  });

  it("Varianten heißen <id>-<n> und gehören zu einem bekannten Stück", () => {
    const ids = new Set<string>([...WORLD_MUSIC_IDS, "select", "winter", "oper"]);
    for (const key of Object.keys(manifest)) {
      const m = /^([a-z]+)(?:-(\d+))?$/.exec(key);
      expect(m, key).not.toBeNull();
      expect(ids.has(m![1]), key).toBe(true);
    }
  });

  it("Dateien existieren, Längen passen zu period + xfade, Schleifen sind ganze Takte", () => {
    for (const [key, t] of Object.entries(manifest)) {
      const file = path.join(ROOT, "music", t.file);
      expect(existsSync(file), key).toBe(true);
      expect(statSync(file).size, key).toBeGreaterThan(200_000);
      expect(statSync(file).size, key).toBeLessThan(1_600_000);
      expect(t.length).toBeCloseTo(t.period + t.xfade, 1);
      expect(t.xfade).toBeGreaterThan(0.3);
      expect(t.xfade).toBeLessThan(2.5);
      expect(t.period).toBeGreaterThan(40);
      expect(t.period).toBeLessThan(90);
      expect(t.bpm).toBeGreaterThan(80);
      expect(t.bpm).toBeLessThan(190);
      // Periode ≈ ganze Takte (4 Schläge) innerhalb der ± 60-ms-Feinjustierung
      const bar = ((t.beats ?? 4) * 60) / t.bpm;
      const bars = t.period / bar;
      expect(Math.abs(bars - Math.round(bars)) * bar, key).toBeLessThan(0.08);
    }
  });
});

describe("Jingles", () => {
  it("alle Jingle-Dateien existieren und sind kurz", () => {
    for (const [name, j] of Object.entries(JINGLES)) {
      const file = path.join(ROOT, "jingles", j.file);
      expect(existsSync(file), name).toBe(true);
      expect(statSync(file).size, name).toBeLessThan(250_000);
      expect(isJingle(name)).toBe(true);
    }
    expect(isJingle("jump")).toBe(false);
  });
});

// -----------------------------------------------------------------------------------------------------------------
// Jingles abbrechen, Variantenwahl und Vorwärmen gegen einen kleinen Fake-AudioContext
// -----------------------------------------------------------------------------------------------------------------
class FakeParam {
  value = 0;
  targets: Array<{ v: number; t: number; tc: number }> = [];
  setValueAtTime(v: number): this {
    this.value = v;
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
}
class FakeNode {
  readonly out: FakeNode[] = [];
  gain = new FakeParam();
  frequency = new FakeParam();
  type = "";
  connect(n: FakeNode): FakeNode {
    this.out.push(n);
    return n;
  }
  disconnect(): void {
    this.out.length = 0;
  }
}
class FakeBuffer {
  constructor(readonly duration: number) {}
}
class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  onended: (() => void) | null = null;
  start(t = 0): void {
    this.startedAt = t;
  }
  stop(t = 0): void {
    this.stoppedAt = t;
  }
}
class FakeCtx {
  currentTime = 0;
  sources: FakeSource[] = [];
  createGain(): FakeNode {
    return new FakeNode();
  }
  createBiquadFilter(): FakeNode {
    return new FakeNode();
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  decodeAudioData(data: ArrayBuffer): Promise<FakeBuffer> {
    return Promise.resolve(new FakeBuffer(data.byteLength / 1000));
  }
}
function fakeGraph(): { g: AudioGraph; ctx: FakeCtx; dest: FakeNode } {
  const ctx = new FakeCtx();
  const dest = new FakeNode();
  return { g: { ctx, musicDry: dest } as unknown as AudioGraph, ctx, dest };
}
const tick = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

const trackInfo = { bpm: 120, period: 60, xfade: 1, length: 61 };
const MANIFEST: TrackManifest = {
  wien: { file: "wien.mp3", ...trackInfo },
  "wien-2": { file: "wien-2.mp3", ...trackInfo },
  solo: { file: "solo.mp3", ...trackInfo },
  "wien-extra": { file: "wien-extra.mp3", ...trackInfo }, // kein Variantenname (nach „-“ keine Zahl)
};
let requested: Array<{ url: string; priority?: string }> = [];
function stubFetch(opts: { failMp3?: boolean } = {}): void {
  requested = [];
  vi.stubGlobal("fetch", async (url: string, init?: { priority?: string }) => {
    requested.push({ url, priority: init?.priority });
    const path = url.split("?")[0];
    if (path.endsWith("music.json")) return { ok: true, status: 200, json: async () => MANIFEST };
    if (opts.failMp3) return { ok: false, status: 503 };
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(70_000) };
  });
}
const mp3Files = (): string[] => requested.map((r) => r.url.split("?")[0].split("/").pop()!).filter((f) => f.endsWith(".mp3"));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("JinglePlayer: Handles und stopAll", () => {
  async function loaded(name: "gameover" | "highscore" | "world-transition" = "gameover"): Promise<{ jp: JinglePlayer; ctx: FakeCtx; dest: FakeNode }> {
    stubFetch();
    const { g, ctx, dest } = fakeGraph();
    const jp = new JinglePlayer(g);
    expect(jp.play(name, dest as unknown as AudioNode)).toBeNull(); // noch nicht geladen
    await tick();
    return { jp, ctx, dest };
  }

  it("play liefert ein Handle (nach dem Laden) und hält die Quelle bis zum Ende", async () => {
    const { jp, ctx, dest } = await loaded();
    const h = jp.play("gameover", dest as unknown as AudioNode, 0.5);
    expect(h).not.toBeNull();
    expect(h).toMatchObject({ name: "gameover", stopping: false, ended: false });
    expect(jp.playing).toBe(1);
    expect(ctx.sources[0].out[0].gain.value).toBeCloseTo(JINGLES.gameover.gain * 0.5, 9);
    expect(ctx.sources[0].out[0].out).toEqual([dest]); // Ziel = übergebener Bus
    ctx.sources[0].onended!();
    expect(h).toMatchObject({ ended: true });
    expect(jp.playing).toBe(0);
  });

  it("stopAll beendet alle Handles: Ausblenden per setTargetAtTime (τ = fade/4), Quelle stoppt kurz danach", async () => {
    const { jp, ctx, dest } = await loaded();
    ctx.currentTime = 3;
    const a = jp.play("gameover", dest as unknown as AudioNode)!;
    const b = jp.play("highscore", dest as unknown as AudioNode); // noch nicht geladen → null
    expect(b).toBeNull();
    await tick();
    const c = jp.play("highscore", dest as unknown as AudioNode)!;
    expect(jp.playing).toBe(2);
    ctx.currentTime = 4;
    expect(jp.stopAll(0.4)).toBe(2);
    for (const h of [a, c]) expect(h.stopping).toBe(true);
    for (const s of ctx.sources) {
      expect(s.stoppedAt).toBeGreaterThan(4.4);
      expect(s.stoppedAt).toBeLessThan(4.6);
      expect(s.out[0].gain.targets.at(-1)).toEqual({ v: 0, t: 4, tc: 0.1 });
    }
    expect(jp.stopAll(0.4)).toBe(0); // idempotent
    for (const s of ctx.sources) s.onended!();
    expect(jp.playing).toBe(0);
    expect(a.ended && c.ended).toBe(true);
  });

  it("Handle.stop einzeln; Standard-Ausblendung 0,3 s; fade 0 = sofort (kurzer Klickschutz)", async () => {
    const { jp, ctx, dest } = await loaded();
    ctx.currentTime = 1;
    const h = jp.play("gameover", dest as unknown as AudioNode)!;
    h.stop();
    expect(ctx.sources[0].out[0].gain.targets.at(-1)).toEqual({ v: 0, t: 1, tc: 0.3 / 4 });
    expect(ctx.sources[0].stoppedAt).toBeCloseTo(1 + 0.3 * 1.25 + 0.03, 9);
    const h2 = jp.play("gameover", dest as unknown as AudioNode);
    expect(h2).not.toBeNull(); // der Gameover-Puffer ist geladen, ein zweiter Lauf ist möglich
    h2!.stop(0);
    expect(ctx.sources[1].out[0].gain.targets.at(-1)!.tc).toBe(0.005);
    expect(ctx.sources[1].stoppedAt).toBeCloseTo(1.03, 9);
    h2!.stop(5); // schon im Stopp: ignoriert
    expect(ctx.sources[1].stoppedAt).toBeCloseTo(1.03, 9);
    h.stop(Number.NaN); // schon im Stopp
  });

  it("stopOf trifft nur den genannten Jingle", async () => {
    const { jp, ctx, dest } = await loaded("world-transition");
    const t = jp.play("world-transition", dest as unknown as AudioNode)!;
    jp.prefetch();
    await tick();
    const g = jp.play("gameover", dest as unknown as AudioNode)!;
    expect(jp.stopOf("world-transition", 0.25)).toBe(1);
    expect(t.stopping).toBe(true);
    expect(g.stopping).toBe(false);
    expect(ctx.sources[0].stoppedAt).not.toBeNull();
    expect(ctx.sources[1].stoppedAt).toBeNull();
  });

  it("stopAll ohne laufende Jingles: 0, kein Fehler; dispose stoppt laufende", async () => {
    const { jp, ctx, dest } = await loaded();
    expect(jp.stopAll()).toBe(0);
    jp.play("gameover", dest as unknown as AudioNode);
    jp.dispose();
    expect(ctx.sources[0].stoppedAt).not.toBeNull();
    expect(jp.playing).toBe(0);
  });
});

describe("MusicLibrary: Variantenwahl", () => {
  it("wählt unter den Varianten <id>, <id>-<n>, nie den Titel mit anderem Suffix", () => {
    const lib = new MusicLibrary();
    const picks = new Set<string | null>();
    for (let i = 0; i < 40; i++) {
      const k = lib.choose(MANIFEST, "wien", true);
      picks.add(k);
      if (k) lib.played("wien", k);
    }
    expect([...picks].sort()).toEqual(["wien", "wien-2"]);
    expect(lib.choose(MANIFEST, "solo", true)).toBe("solo");
    expect(lib.choose(MANIFEST, "unbekannt", true)).toBeNull();
  });

  it("nie zweimal hintereinander dieselbe Variante (zuletzt gespielte wird ausgeschlossen)", () => {
    const lib = new MusicLibrary();
    lib.played("wien", "wien");
    for (let i = 0; i < 20; i++) expect(lib.choose(MANIFEST, "wien", true)).toBe("wien-2");
    lib.played("wien", "wien-2");
    for (let i = 0; i < 20; i++) expect(lib.choose(MANIFEST, "wien", true)).toBe("wien");
  });

  it("die beim Vorwärmen gemerkte Variante wird genau einmal gewählt: erst plan (consume=false, idempotent), dann play (consume=true)", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const lib = new MusicLibrary();
    expect(lib.choose(MANIFEST, "wien", false)).toBe("wien-2");
    random.mockReturnValue(0); // eine neue Zufallswahl würde „wien“ liefern
    expect(lib.choose(MANIFEST, "wien", false)).toBe("wien-2"); // unverändert gemerkt
    expect(lib.choose(MANIFEST, "wien", true)).toBe("wien-2"); // play verbraucht die Merkung
    expect(random).toHaveBeenCalledTimes(1); // genau eine Zufallswahl
    lib.played("wien", "wien-2");
    expect(lib.choose(MANIFEST, "wien", true)).toBe("wien"); // danach wieder frisch, ≠ letzte
  });

  it("eine gemerkte Variante, die das Manifest nicht mehr kennt, wird verworfen", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const lib = new MusicLibrary();
    expect(lib.choose(MANIFEST, "wien", false)).toBe("wien-2");
    random.mockReturnValue(0);
    const slim: TrackManifest = { wien: MANIFEST.wien };
    expect(lib.choose(slim, "wien", true)).toBe("wien");
  });
});

describe("Vorwärmen (Download ohne Dekodieren)", () => {
  it("downloadOnly: niedrige Priorität, Körper gelesen; ohne fetch No-Op; Fehlerstatus wirft", async () => {
    stubFetch();
    await downloadOnly("/fredrun2/audio/music/wien.mp3");
    expect(requested).toEqual([{ url: "/fredrun2/audio/music/wien.mp3", priority: "low" }]);
    stubFetch({ failMp3: true });
    await expect(downloadOnly("/x.mp3")).rejects.toThrow();
    vi.stubGlobal("fetch", undefined);
    await expect(downloadOnly("/x.mp3")).resolves.toBeUndefined();
  });

  it("ohne fetch (SSR) ist prefetch ein No-Op", async () => {
    vi.stubGlobal("fetch", undefined);
    const lib = new MusicLibrary();
    expect(() => lib.prefetch(["wien"])).not.toThrow();
    expect(lib.warm("/a.mp3")).toBeInstanceOf(Promise);
    await tick();
  });

  it("TrackMusic.prefetch lädt genau eine Variante (mit Revision), wiederholt nichts, und play nutzt dieselbe", async () => {
    stubFetch();
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const { g, ctx } = fakeGraph();
    const tm = new TrackMusic(g);
    tm.prefetch("wien");
    tm.prefetch("wien");
    await tick();
    expect(mp3Files()).toEqual(["wien-2.mp3"]); // eine Datei, einmal
    expect(requested.find((r) => r.url.includes("wien-2.mp3"))!.url).toMatch(/wien-2\.mp3(\?v=[0-9a-f]+)?$/);
    expect(requested.find((r) => r.url.includes("wien-2.mp3"))!.priority).toBe("low");
    expect(ctx.sources).toHaveLength(0); // nichts dekodiert, nichts gespielt

    random.mockReturnValue(0); // würde „wien“ wählen
    tm.play("wien");
    await tick();
    expect(mp3Files()).toEqual(["wien-2.mp3", "wien-2.mp3"]); // Abspielen: Cache-Treffer derselben Datei, nicht die andere Variante
    expect(ctx.sources.length).toBeGreaterThan(0);
    expect(ctx.sources[0].buffer!.duration).toBe(70);
    tm.dispose();
  });

  it("prefetch beeinflusst nicht, was gerade spielt: laufende Variante bleibt, die nächste ist die andere", async () => {
    stubFetch();
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const { g } = fakeGraph();
    const tm = new TrackMusic(g);
    tm.play("wien");
    await tick();
    expect(mp3Files()).toEqual(["wien.mp3"]);
    tm.prefetch("wien"); // nächste Runde vorwärmen: nur die andere Variante
    await tick();
    expect(mp3Files()).toEqual(["wien.mp3", "wien-2.mp3"]);
    random.mockReturnValue(0);
    tm.stop(0.1);
    tm.play("wien");
    await tick();
    expect(mp3Files()).toEqual(["wien.mp3", "wien-2.mp3", "wien-2.mp3"]);
    tm.dispose();
  });

  it("Fehler beim Vorwärmen werden geschluckt; ein späterer Versuch lädt erneut", async () => {
    stubFetch({ failMp3: true });
    const lib = new MusicLibrary();
    lib.prefetch(["wien"]);
    await tick();
    expect(mp3Files()).toHaveLength(1);
    stubFetch();
    lib.prefetch(["wien"]);
    await tick();
    expect(mp3Files()).toHaveLength(1); // frische stubFetch-Liste: ein erneuter Versuch
  });

  it("dasselbe Stück parallel vorwärmen lädt es nur einmal", async () => {
    stubFetch();
    const lib = new MusicLibrary();
    lib.prefetch(["wien", "wien", "solo"]);
    await tick();
    expect(mp3Files().sort()).toHaveLength(2);
  });
});
