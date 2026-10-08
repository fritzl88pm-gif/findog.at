import { afterEach, describe, expect, it, vi } from "vitest";
import { Bot } from "../bot";
import { FIXED_DT, METERS_PER_DIFFICULTY, PLAYER_SX } from "../constants";
import { deathLabel } from "../death-names";
import { createPatternCtx } from "../patterns";
import { Rng } from "../rng";
import { NO_INPUT, Sim } from "../sim";
import type { Ent, EntSpec, PatternDef } from "../types";
import { WORLDS } from "./index";
import { WORLD_OPER } from "./oper";
import { SKIN } from "./oper/dims";
import { OPER_DEATH_NAMES } from "./oper/death-names";
import { OPER_STAGE_METERS, OperRenderer } from "./oper/renderer";
import { FarLayers, bakeFar, bakeFarSteps, bakeMid, bakeMidSteps, loadPlain } from "./oper/backdrop";
import { SpriteBank } from "./oper/sprites";
import { waltzFactor } from "./oper/system";
import { auditPatterns, botRuns } from "./shared-b/audit";
import type { StageCache } from "./shared-b/layers";
import { assetsOf, installCanvasStub, installRecordingStub, manifestProps, stubView } from "./shared-b/test-kit";

/** Baut ein Muster isoliert in einer leeren Sim (Rückgabe: Sim, Musterlänge, Ursprung). */
function isolate(p: PatternDef, diff: number, seed: number): { sim: Sim; len: number; origin: number; specs: EntSpec[] } {
  const sim = new Sim({ mode: "world", world: "oper", character: "fred", seed, startMeters: diff * METERS_PER_DIFFICULTY }, WORLDS);
  sim.begin();
  sim.player.hearts = 3;
  sim.ents.length = 0;
  sim.noSpawn = true;
  sim.speed = sim.speedAtDiff(sim.diff);
  const specs: EntSpec[] = [];
  const ctx = createPatternCtx({ speed: sim.speedAtDiff(diff), diff, groundY: sim.groundY, ceilY: sim.ceilY, rng: new Rng(seed * 31 + 7), worldId: "oper", defaultSkin: (k) => k }, specs);
  const len = p.build(ctx);
  // wie der Spawner: Ursprung ≈ SPAWN_AHEAD − PLAYER_SX vor der Figur (Zeitvorhersagen der Muster stimmen dann)
  const origin = sim.dist + PLAYER_SX + 1400;
  sim.curPattern = p.id;
  for (const s of specs) sim.spawn(s, origin);
  sim.curPattern = "";
  return { sim, len, origin, specs };
}

/** Ein Muster isoliert vom Bot spielen lassen; Rückgabe = Treffer. */
function playPattern(p: PatternDef, diff: number, seed: number, opts: { reaction?: number; vision?: number } = {}): number {
  const { sim, len, origin } = isolate(p, diff, seed);
  const bot = new Bot(opts);
  const secs = (origin + len + 1200 - sim.playerWorldX) / sim.speed + 1;
  let hurts = 0;
  for (let i = 0; i < secs / FIXED_DT && sim.phase === "running"; i += 1) {
    sim.step(FIXED_DT, bot.input(sim, FIXED_DT));
    for (const ev of sim.events) if (ev.type === "hurt" || ev.type === "pit-fall") hurts += 1;
    sim.events.length = 0;
  }
  return hurts;
}

const byId = (id: string): PatternDef => {
  const p = WORLD_OPER.patterns.find((x) => x.id === id);
  if (!p) throw new Error(`Muster ${id} fehlt`);
  return p;
};

describe("Welt Opernball", () => {
  it("Metadaten vollständig", () => {
    expect(WORLD_OPER.id).toBe("oper");
    expect(WORLD_OPER.name).toBe("Opernball");
    expect(WORLD_OPER.stageCount).toBe(5);
    expect(WORLD_OPER.stageMeters).toBe(300);
    expect(WORLD_OPER.stageNames.length).toBe(WORLD_OPER.stageCount);
    expect(WORLD_OPER.mechanics.length).toBeLessThanOrEqual(4);
    expect(WORLD_OPER.music).toBe("oper");
    expect(WORLD_OPER.accent).toBe("#f2c14e");
    expect(WORLD_OPER.accentDark).toBe("#3a0a12");
    expect(WORLD_OPER.propIds).toContain("oper-piano");
    expect(WORLD_OPER.propIds).toContain("oper-bottle");
    expect(WORLD_OPER.patterns.length).toBeGreaterThanOrEqual(24);
    const ids = new Set(WORLD_OPER.patterns.map((p) => p.id));
    expect(ids.size).toBe(WORLD_OPER.patterns.length);
    for (const id of ["op-eroeffnung", "op-klavierkonzert", "op-mitternachtswalzer"]) expect(ids.has(id)).toBe(true);
    const easy = WORLD_OPER.patterns.filter((p) => p.minDiff <= 1.5).length;
    const hard = WORLD_OPER.patterns.filter((p) => p.minDiff >= 5).length;
    expect(easy).toBeGreaterThanOrEqual(4);
    expect(hard).toBeGreaterThanOrEqual(6);
    // Einsteiger-Muster ohne Zeitdruck-Systeme
    for (const p of WORLD_OPER.patterns.filter((x) => x.minDiff < 1)) expect(p.tags ?? []).not.toContain("special-hard");
  });

  it("alle Muster bauen regelkonform", () => {
    const issues = auditPatterns(WORLD_OPER, { forbid: ["portal"] });
    if (issues.length) console.log(issues.slice(0, 20));
    expect(issues).toEqual([]);
  });

  it("jede Gefahr hat einen deutschen Todesnamen", () => {
    const skins = new Set<string>();
    for (const p of WORLD_OPER.patterns) {
      for (const diff of [p.minDiff, 4, 9]) {
        const specs: EntSpec[] = [];
        const ctx = createPatternCtx({ speed: 700, diff, groundY: 590, ceilY: 150, rng: new Rng(3), worldId: "oper", defaultSkin: (k) => k }, specs);
        p.build(ctx);
        for (const s of specs) if (s.harmful || ["zone", "walker", "flyer", "projectile"].includes(s.kind)) skins.add(s.skin);
      }
    }
    expect(skins.size).toBeGreaterThanOrEqual(10);
    for (const s of skins) expect(deathLabel(s), s).not.toBe("");
    expect(deathLabel("chandelier")).toBe("Kronleuchter");
    expect(deathLabel("cork")).toBe("Korken");
    expect(deathLabel("waiter")).toBe("Kellner");
    expect(OPER_DEATH_NAMES.some(([re]) => re.test("cakecart"))).toBe(true);
  });

  it("Walzerschritt: schnell – schnell – langsam, im Mittel unverändert", () => {
    let sum = 0;
    const n = 3000;
    for (let i = 0; i < n; i += 1) sum += waltzFactor((i / n) * 3);
    expect(sum / n).toBeGreaterThan(0.94);
    expect(sum / n).toBeLessThan(1.06);
    expect(waltzFactor(0.6)).toBeGreaterThan(waltzFactor(2.6));
  });

  it("Korken: sitzt bis zum Knall im Flaschenhals (p.delay) und trifft die Figur zum vorhergesagten Zeitpunkt", () => {
    for (const diff of [2, 5, 8]) {
      for (const id of ["op-cork-low", "op-cork-high"]) {
        const { sim } = isolate(byId(id), Math.max(diff, byId(id).minDiff), 1);
        const cork = sim.ents.find((e) => e.skin === SKIN.cork) as Ent;
        const bottle = sim.ents.find((e) => e.skin === SKIN.bottle) as Ent;
        expect(cork).toBeTruthy();
        expect(bottle).toBeTruthy();
        // Die Startverzögerung des Korkens ist der Knall der Flasche …
        expect(cork.p.delay).toBeCloseTo(bottle.p.popT, 5);
        // … und der Korken sitzt bis dahin (Mitte) am Flaschenhals
        expect(cork.x + cork.w / 2).toBeCloseTo(bottle.x + bottle.w / 2, 0);
      }
    }
  });

  it("Flügel trägt auf die Balkonbahn – mit und ohne gehaltene Sprungtaste", { timeout: 60_000 }, () => {
    for (const id of ["op-piano-lift", "op-klavierkonzert"]) {
      for (const hold of [false, true]) {
        for (const diff of [Math.max(0.3, byId(id).minDiff), 4, 9]) {
          const { sim } = isolate(byId(id), diff, 1);
          const platforms = sim.ents.filter((e) => e.kind === "platform");
          expect(platforms.length).toBeGreaterThan(0);
          let landed = 0;
          const seen = new Set<number>();
          const stopAt = platforms[0].x + platforms[0].w + 200;
          for (let i = 0; i < 20 / FIXED_DT && sim.phase === "running" && sim.playerWorldX < stopAt; i += 1) {
            // gehaltene Sprungtaste nur in der Luft nach dem Bounce (ohne neue Sprünge auszulösen)
            const inAir = !sim.player.grounded && sim.player.vy > 0;
            sim.step(FIXED_DT, { ...NO_INPUT, jump: hold && inAir });
            sim.events.length = 0;
            const op = sim.player.onPlatform;
            if (op && op.skin === SKIN.balcony && !seen.has(op.id)) {
              seen.add(op.id);
              landed += 1;
            }
          }
          expect(landed, `${id}@${diff} hold=${hold}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("gestampfter Kellner lässt Champagner-Münzen regnen", { timeout: 60_000 }, () => {
    const sim = new Sim({ mode: "world", world: "oper", character: "fred", seed: 2, startMeters: 200 }, WORLDS);
    sim.begin();
    sim.player.hearts = 99;
    sim.ents.length = 0;
    sim.noSpawn = true;
    // Kellner steht dort, wo ein voller Sprung landet
    const waiter = sim.spawn({ kind: "walker", skin: SKIN.waiter, x: 0, y: sim.groundY - 116, w: 90, h: 116, stompable: true, harmful: true, vx: 0 }, sim.playerWorldX + sim.speed * 0.8 - 45);
    const before = sim.ents.filter((e) => e.kind === "pickup").length;
    sim.step(FIXED_DT, { jump: true, jumpPressed: true, slide: false, slidePressed: false, dashPressed: false });
    for (let i = 0; i < 3 / FIXED_DT && waiter.state !== "defeated"; i += 1) {
      sim.step(FIXED_DT, { jump: true, jumpPressed: false, slide: false, slidePressed: false, dashPressed: false });
      sim.events.length = 0;
    }
    expect(waiter.state).toBe("defeated");
    sim.step(FIXED_DT, NO_INPUT);
    expect(sim.ents.filter((e) => e.kind === "pickup").length).toBeGreaterThan(before);
  });

  it("Hindernisse sind zerbrechlich (Harfe nicht) und melden Trümmer an den Renderer", { timeout: 60_000 }, () => {
    const fragile = new Set<string>();
    const solid = new Set<string>();
    for (const p of WORLD_OPER.patterns) {
      const specs: EntSpec[] = [];
      p.build(createPatternCtx({ speed: 700, diff: 6, groundY: 590, ceilY: 150, rng: new Rng(4), worldId: "oper", defaultSkin: (k) => k }, specs));
      for (const s of specs) if (s.kind === "block") (s.breakable ? fragile : solid).add(s.skin);
    }
    expect([...fragile].sort()).toEqual([SKIN.bouquet, SKIN.cake, SKIN.rope, SKIN.tower].sort());
    expect([...solid]).toEqual([SKIN.harp]);
    // Dash zerlegt einen Blumenstrauß → Weltsystem setzt die Trümmer-Meldung
    const sim = new Sim({ mode: "world", world: "oper", character: "fred", seed: 5, startMeters: 100 }, WORLDS);
    sim.begin();
    sim.player.hearts = 99;
    sim.player.energy = 100;
    sim.ents.length = 0;
    sim.noSpawn = true;
    const b = sim.spawn({ kind: "block", skin: SKIN.bouquet, x: 0, y: sim.groundY - 100, w: 90, h: 100, harmful: true, breakable: true }, sim.playerWorldX + 170);
    sim.step(FIXED_DT, { ...NO_INPUT, dashPressed: true });
    for (let i = 0; i < 3 / FIXED_DT && !b.dead; i += 1) sim.step(FIXED_DT, NO_INPUT);
    expect(b.dead).toBe(true);
    expect(sim.vars.debrisN).toBeGreaterThan(0);
    expect(sim.vars.debrisK).toBe(0);
  });

  it("jedes Muster ist isoliert vom Bot lösbar (verschiedene Tempi und Seeds)", { timeout: 600_000 }, () => {
    const fails: string[] = [];
    for (const p of WORLD_OPER.patterns) {
      for (const diff of [p.minDiff, Math.max(p.minDiff, 3), Math.max(p.minDiff, 6), 9, 16, 24]) {
        for (const seed of [1, 2, 3]) {
          const hurts = playPattern(p, diff, seed);
          if (hurts > 0) fails.push(`${p.id}@${diff}/s${seed}:${hurts}`);
        }
      }
    }
    if (fails.length) console.log(fails.join("\n"));
    expect(fails).toEqual([]);
  });

  it("Bot übersteht zusätzliche Seeds", { timeout: 240_000 }, () => {
    const runs = botRuns(WORLDS, "oper", [
      { seed: 3, meters: 0, secs: 40 },
      { seed: 5, meters: 1200, secs: 35 },
      { seed: 9, meters: 2400, secs: 35 },
      { seed: 13, meters: 4000, secs: 30 },
    ]);
    for (const r of runs) if (r.log.length) console.log("oper", r.seed, r.meters, r.log.join("\n  "));
    for (const r of runs) expect(r.hurts).toBeLessThanOrEqual(2);
  });
});

// --- Weltladen, Stufen-Vorbereitung, Skalenwechsel (Canvas- und Bild-Attrappe, ohne DOM) --------------------------------------

interface OperInternals {
  ground: StageCache | null;
  far: { has(stage: number): boolean };
  k: number;
  skins: { bank: { size?: number; setScale(k: number): void } };
}

const inner = (r: OperRenderer): OperInternals => r as unknown as OperInternals;

/** Bild-Attrappe: meldet jede geladene URL und löst `onload` in einem Mikrotask aus (Größe wie die Originale) */
function stubImages(): string[] {
  const loads: string[] = [];
  class FakeImage {
    decoding = "";
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    width = 2240;
    height = 768;
    private url = "";
    set src(v: string) {
      this.url = v;
      if (v) {
        loads.push(v);
        queueMicrotask(() => this.onload?.());
      }
    }
    get src(): string {
      return this.url;
    }
  }
  vi.stubGlobal("Image", FakeImage);
  return loads;
}

async function loaded(): Promise<{ r: OperRenderer; stub: ReturnType<typeof installCanvasStub>; loads: string[] }> {
  const stub = installCanvasStub();
  const loads = stubImages();
  const r = new OperRenderer();
  await r.load(assetsOf(manifestProps()));
  return { r, stub, loads };
}

describe("Oper – Stufenlänge, Weltladen, Vorbereitung der Folgestufe, Skalenwechsel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("OPER_STAGE_METERS entspricht der Welt-Definition", () => {
    expect(OPER_STAGE_METERS).toBe(WORLD_OPER.stageMeters);
  });

  it("load backt Fernebenen der Stufen 0 und 1 und die Bodenkacheln der Stufe 0", async () => {
    const { r } = await loaded();
    const i = inner(r);
    expect(i.far.has(0)).toBe(true);
    expect(i.far.has(1)).toBe(true);
    expect(i.far.has(2)).toBe(false);
    r.update(1 / 60, stubView({ stage: 0, worldMeters: 5 }));
    expect(i.ground?.has(0)).toBe(true);
  });

  it("Folgestufe: Fernebene und Bodenkachel erst ab ~28 % der Stufe (Boden höchstens ein Schritt je ~100 ms)", async () => {
    const { r, loads } = await loaded();
    const i = inner(r);
    const clock = 5000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const at = (progress: number): void => r.update(1 / 60, stubView({ stage: 1, worldMeters: OPER_STAGE_METERS + progress * OPER_STAGE_METERS }));
    at(0.02);
    await Promise.resolve();
    const before = loads.length;
    at(0.25);
    await Promise.resolve();
    expect(i.far.has(2)).toBe(false);
    expect(i.ground?.has(2)).toBe(false);
    expect(loads.length).toBe(before); // nichts Neues geladen
    at(0.3);
    await new Promise((res) => setTimeout(res, 0));
    expect(loads.length).toBeGreaterThan(before);
    expect(i.far.has(2)).toBe(true);
    expect(i.ground?.has(2)).toBe(true);
  });

  it("beginnt die Überblendung, wird die Folgestufe (Boden) sofort nachgeholt", async () => {
    const { r } = await loaded();
    const i = inner(r);
    r.update(1 / 60, stubView({ stage: 1, worldMeters: OPER_STAGE_METERS + 3 }));
    expect(i.ground?.has(2)).toBe(false);
    r.update(1 / 60, stubView({ stage: 1, worldMeters: OPER_STAGE_METERS + 250, stageBlend: 0.1 }));
    expect(i.ground?.has(2)).toBe(true);
  });

  it("resize ist idempotent; nur eine echte Änderung ersetzt die Bodenkacheln (und verwirft die Sprites)", async () => {
    const { r, stub } = await loaded();
    const i = inner(r);
    r.update(1 / 60, stubView({ stage: 0, worldMeters: 5 }));
    const g0 = i.ground;
    const n = stub.created;
    r.resize(1);
    r.resize(1.1);
    r.resize(1.19);
    r.resize(1);
    expect(i.ground).toBe(g0);
    expect(stub.created).toBe(n);
    r.resize(1.5);
    expect(i.k).toBe(1.5);
    expect(i.ground).not.toBe(g0);
    r.update(1 / 60, stubView({ stage: 0, worldMeters: 6 }));
    const m = stub.created;
    expect(m).toBeGreaterThan(n); // Bodenkachel der Stufe 0 in neuer Dichte, genau einmal
    r.resize(1.5);
    r.resize(1.45);
    r.update(1 / 60, stubView({ stage: 0, worldMeters: 7 }));
    expect(stub.created).toBe(m);
  });

  it("resize vor dem Laden merkt die Skala", async () => {
    installCanvasStub();
    stubImages();
    const r = new OperRenderer();
    r.resize(2);
    await r.load(assetsOf(manifestProps()));
    expect(inner(r).k).toBe(2);
    expect(inner(r).ground).not.toBeNull();
  });
});

describe("Oper – Sprite-Bake außerhalb des Bildes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("SpriteBank: außerhalb höchstens ein Bake je Frame (get liefert null und merkt nichts), sichtbar immer sofort", () => {
    const stub = installCanvasStub();
    const bank = new SpriteBank(manifestProps());
    bank.off = true;
    const a = bank.get("oper-waiter", 140);
    expect(a).not.toBeNull();
    const n = stub.created;
    expect(bank.get("oper-dancers", 140)).toBeNull(); // wartet
    expect(stub.created).toBe(n);
    bank.off = false;
    expect(bank.get("oper-dancers", 140)).not.toBeNull(); // sichtbar → sofort
    bank.off = true;
    bank.baked = 0; // nächster Frame
    expect(bank.get("oper-cork", 84)).not.toBeNull();
    const m = stub.created;
    expect(bank.get("oper-waiter", 140)).toBe(a); // Treffer
    expect(stub.created).toBe(m);
  });

  it("FarLayers.ensure: gleichzeitige Aufrufe laden und backen eine Stufe nur einmal", async () => {
    installCanvasStub();
    const loads = stubImages();
    const far = new FarLayers();
    await Promise.all([far.ensure(2), far.ensure(2), far.ensure(2)]);
    expect(loads.length).toBe(1);
    expect(far.has(2)).toBe(true);
    await far.ensure(2); // vorhanden: nichts mehr
    expect(loads.length).toBe(1);
  });

  it("bakeFarSteps gibt mehrfach die Kontrolle ab und liefert dieselbe Fläche wie bakeFar am Stück", () => {
    installCanvasStub();
    const img = { width: 2240, height: 768 } as unknown as HTMLImageElement;
    const it = bakeFarSteps(img, 1);
    let steps = 0;
    for (;;) {
      const r = it.next();
      if (r.done) {
        expect(r.value.width).toBe(bakeFar(img, 1).width);
        expect(r.value.height).toBe(bakeFar(img, 1).height);
        break;
      }
      steps += 1;
    }
    expect(steps).toBeGreaterThanOrEqual(5); // vier Bildbänder + Verläufe (+ Kegel)
  });

  it("SpriteBank: unbekannte Ids ohne Prop bleiben null", () => {
    installCanvasStub();
    const bank = new SpriteBank(manifestProps());
    expect(bank.get("unbekannt", 100)).toBeNull();
  });
});

describe("Oper – Bilder laden und Mittelgrund backen ohne Long Task", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const URL0 = "/fredrun2/worlds/oper/far-foyer.webp";

  /** fetch + createImageBitmap als Attrappen; `closed` zählt die freigegebenen Bitmaps */
  function stubBitmaps(opts: { ok?: boolean; reject?: boolean } = {}): { fetched: string[]; closed: number[] } {
    const fetched: string[] = [];
    const closed: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string) => {
        fetched.push(u);
        return { ok: opts.ok ?? true, blob: async () => ({}) };
      }),
    );
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        if (opts.reject) throw new Error("nicht dekodierbar");
        return { width: 2240, height: 768, close: () => closed.push(1) };
      }),
    );
    return { fetched, closed };
  }

  it("loadPlain bevorzugt ImageBitmap (Abruf und Dekodierung außerhalb des Hauptthreads) und lädt dann kein <img>", async () => {
    const { fetched } = stubBitmaps();
    const loads = stubImages();
    const pic = await loadPlain(URL0);
    expect(pic).not.toBeNull();
    expect("close" in (pic as object)).toBe(true);
    expect(fetched.length).toBe(1);
    expect(fetched[0].startsWith(URL0)).toBe(true); // mit Revisionsparameter wie das <img>
    expect(loads.length).toBe(0);
  });

  it("loadPlain: Abruf nicht ok, Dekodierung scheitert oder keine Bitmap-Unterstützung → Rückfall auf <img>", async () => {
    for (const mode of ["notOk", "reject", "none"] as const) {
      vi.unstubAllGlobals();
      if (mode === "notOk") stubBitmaps({ ok: false });
      else if (mode === "reject") stubBitmaps({ reject: true });
      else {
        vi.stubGlobal("fetch", undefined);
        vi.stubGlobal("createImageBitmap", undefined);
      }
      const loads = stubImages();
      const pic = await loadPlain(URL0);
      expect(pic, mode).not.toBeNull();
      expect("close" in (pic as object), mode).toBe(false);
      expect(loads.length, mode).toBe(1);
    }
  });

  it("FarLayers.ensure gibt das Bitmap nach dem Backen frei (auch wenn die Ebenen inzwischen verworfen wurden)", async () => {
    installCanvasStub();
    const { closed } = stubBitmaps();
    stubImages();
    const far = new FarLayers();
    await far.ensure(2);
    expect(far.has(2)).toBe(true);
    expect(closed.length).toBe(1);
    const late = far.ensure(3);
    far.dispose();
    await late;
    expect(far.has(3)).toBe(false);
    expect(closed.length).toBe(2);
  });

  it("bakeMidSteps: Nahtbereinigung in 3 waagerechten Bändern, Weichzeichner in 4 beschnittenen Teilstücken, Ergebnis wie am Stück", () => {
    const { canvases } = installRecordingStub();
    const src = { width: 2240, height: 768 } as unknown as HTMLImageElement;
    const it = bakeMidSteps(src, 742, "56,20,24", 0.34);
    let steps = 0;
    let layer: ReturnType<typeof bakeMid> | null = null;
    for (;;) {
      const r = it.next();
      if (r.done) {
        layer = r.value;
        break;
      }
      steps += 1;
    }
    expect(steps).toBeGreaterThanOrEqual(8);
    const rects = (c: { log: string[] }): string[] => c.log.filter((l) => l.startsWith("rect("));
    // Quellbild 1:1 in drei waagerechten Bändern (je Band ein Schritt): lückenlos, ohne Überlappung
    const seam = rects(canvases[0]);
    expect(seam).toEqual([0, 256, 512].map((y) => `rect(0,${y},2240,256)`));
    // Weichzeichner: Seitenkopien nur auf ihren Randstreifen (PAD 24 + 8), die mittlere Kopie in zwei waagerechten Hälften
    expect(canvases[1].width).toBe(1437);
    expect(rects(canvases[1])).toEqual(["rect(0,0,32,476)", "rect(0,0,1437,238)", "rect(0,238,1437,238)", "rect(1405,0,32,476)"]);
    expect(canvases[1].log.filter((l) => l.startsWith("drawImage(")).length).toBe(4);
    expect(canvases[1].log.filter((l) => l === "clip()").length).toBe(4);
    const whole = bakeMid(src, 742, "56,20,24", 0.34);
    expect(layer).not.toBeNull();
    expect(layer?.w).toBe(whole.w);
    expect(layer?.h).toBe(whole.h);
    expect(layer?.footY).toBe(whole.footY);
  });
});

