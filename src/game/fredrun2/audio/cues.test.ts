import { describe, expect, it } from "vitest";
import { VIEW_W } from "../constants";
import {
  COIN_LADDER,
  COIN_PITCH_MAX,
  COIN_TOP_PAIR,
  COMBO_LADDER,
  CUE_QUIET_SEC,
  CueTracker,
  HEARTBEAT_GAP_SEC,
  STOMP_CHAIN_LADDER,
  coinPitch,
  comboPitch,
  stompChainPitch,
  zoneCue,
  zoneGroup,
  type CueInput,
  type CueName,
} from "./cues";
import { COIN_STEPS, RECIPES, SFX_META } from "./sfx";
import type { SfxVoice } from "./voice";
import { SFX_NAMES } from "./types";

/** Halbtöne eines Tonhöhenfaktors (gleichstufig). */
const semis = (p: number): number => 12 * Math.log2(p);
/** Abstand zum nächsten Ton der Münz-Pentatonik (zwei Oktaven plus Reserve) in Halbtönen. */
const offScale = (p: number): number => {
  const s = semis(p);
  return Math.min(...COIN_STEPS.map((c) => Math.abs(c - s)));
};

describe("coinPitch", () => {
  it("steigt über die ganze Leiter streng und startet auf dem Grundton", () => {
    expect(coinPitch(0)).toBe(1);
    for (let n = 1; n < COIN_LADDER.length; n++) expect(coinPitch(n)).toBeGreaterThan(coinPitch(n - 1));
  });

  it("liegt nur auf Skalentönen (Halbtöne 0,2,4,7,9,12,14,16)", () => {
    for (let n = 0; n < 60; n++) {
      const p = coinPitch(n);
      // gleichstufig exakt; einzige Ausnahme ist der gekappte oberste Ton (reine Terz, 14 Cent darunter)
      expect(offScale(p), `streak ${n}: ${semis(p).toFixed(3)} Halbtöne`).toBeLessThan(p === COIN_PITCH_MAX ? 0.15 : 1e-9);
      expect(Math.min(...COIN_LADDER.map((c) => Math.abs(c - semis(p))))).toBeLessThan(0.15);
    }
  });

  it("wechselt nach dem Leiterende zwischen genau zwei Werten (Oktave / Terz) und plateauiert nicht", () => {
    const tail: number[] = [];
    for (let n = COIN_LADDER.length; n < COIN_LADDER.length + 24; n++) tail.push(coinPitch(n));
    expect(new Set(tail).size).toBe(2);
    for (let i = 1; i < tail.length; i++) expect(tail[i]).not.toBe(tail[i - 1]);
    expect(tail[0]).toBeCloseTo(2 ** (COIN_TOP_PAIR[0] / 12), 10);
    expect(tail[1]).toBeCloseTo(Math.min(COIN_PITCH_MAX, 2 ** (COIN_TOP_PAIR[1] / 12)), 10);
    // dieselbe Abfolge gilt ab der 12. Münze (dort stand der alte Pfad auf einem Ton)
    expect(coinPitch(12)).not.toBe(coinPitch(13));
  });

  it("überschreitet nie 2.5 und bleibt für kaputte Eingaben sinnvoll", () => {
    for (let n = 0; n < 200; n++) expect(coinPitch(n)).toBeLessThanOrEqual(2.5);
    expect(coinPitch(7)).toBe(2.5);
    for (const bad of [-3, Number.NaN, Number.POSITIVE_INFINITY]) expect(coinPitch(bad)).toBe(1);
    expect(coinPitch(2.9)).toBe(coinPitch(2));
  });
});

describe("comboPitch / stompChainPitch", () => {
  it("rasten auf Skalentöne und steigen mit der Stufe, oberhalb der Leiter bleibt der letzte Ton", () => {
    for (let level = 2; level < 2 + COMBO_LADDER.length; level++) {
      expect(offScale(comboPitch(level))).toBeLessThan(1e-9);
      if (level > 2) expect(comboPitch(level)).toBeGreaterThan(comboPitch(level - 1));
    }
    expect(comboPitch(2)).toBe(1);
    expect(comboPitch(8)).toBeCloseTo(2 ** (14 / 12), 10);
    expect(comboPitch(50)).toBe(comboPitch(8));
    expect(comboPitch(0)).toBe(1);
    for (let n = 1; n <= STOMP_CHAIN_LADDER.length; n++) {
      expect(offScale(stompChainPitch(n))).toBeLessThan(1e-9);
      if (n > 1) expect(stompChainPitch(n)).toBeGreaterThan(stompChainPitch(n - 1));
    }
    expect(stompChainPitch(1)).toBe(1);
    expect(stompChainPitch(6)).toBe(2);
    expect(stompChainPitch(99)).toBe(2);
    expect(stompChainPitch(Number.NaN)).toBe(1);
  });
});

describe("zoneCue", () => {
  it("Laser und Steinschlag: Warnung klingt anders als aktiv", () => {
    for (const skin of ["laser-low", "laser-high", "beam-fence", "rockfall"]) {
      const warn = zoneCue(skin, "warn", 600);
      const active = zoneCue(skin, "active", 600);
      expect(warn, skin).not.toBeNull();
      expect(active, skin).not.toBeNull();
      expect(warn).not.toEqual(active);
    }
  });

  it("Laser: Warnung tief und leise, aktiv voll; Steinschlag: Warnung leiser und höher", () => {
    expect(zoneCue("laser-low", "warn", 600)).toEqual({ name: "laser-zap", pitch: 0.6, volume: 0.5 });
    expect(zoneCue("laser-low", "active", 600)).toEqual({ name: "laser-zap", pitch: 1, volume: 1 });
    expect(zoneCue("beam-fence", "warn", 600)).toEqual({ name: "laser-zap", pitch: 0.6, volume: 0.5 });
    expect(zoneCue("rockfall", "warn", 600)).toEqual({ name: "rockfall", pitch: 1.15, volume: 0.55 });
    expect(zoneCue("rockfall", "active", 600)).toEqual({ name: "rockfall", volume: 1 });
  });

  it("Blitz und Stempel wie bisher", () => {
    expect(zoneCue("bolt", "warn", 600)).toEqual({ name: "lightning-warn", volume: 1 });
    expect(zoneCue("bolt", "active", 600)).toEqual({ name: "thunder", volume: 1 });
    expect(zoneCue("stamp", "warn", 600)).toEqual({ name: "paper-flutter", volume: 1 });
    expect(zoneCue("stamp", "active", 600)).toEqual({ name: "stamp-thud", volume: 1 });
  });

  it("Lautstärke fällt monoton mit wachsendem Abstand zum Bild, rechts wie links", () => {
    for (const skin of ["laser-low", "rockfall", "bolt", "stamp"]) {
      for (const phase of ["warn", "active"] as const) {
        let last = Infinity;
        for (let x = 600; x <= 2000; x += 20) {
          const v = zoneCue(skin, phase, x)!.volume;
          expect(v, `${skin} ${phase} x=${x}`).toBeLessThanOrEqual(last);
          last = v;
        }
        let lastL = Infinity;
        for (let x = 600; x >= -800; x -= 20) {
          const v = zoneCue(skin, phase, x)!.volume;
          expect(v, `${skin} ${phase} x=${x}`).toBeLessThanOrEqual(lastL);
          lastL = v;
        }
      }
    }
    const inView = zoneCue("laser-low", "active", 600)!.volume;
    expect(zoneCue("laser-low", "active", 1700)!.volume).toBeLessThan(0.3 * inView);
    expect(zoneCue("laser-low", "active", 1700)!.volume).toBeGreaterThanOrEqual(0.2 * inView);
    // Boden: weit außerhalb nie unter 20 % des Basiswerts, nie 0
    expect(zoneCue("laser-low", "active", 5000)!.volume).toBe(0.2);
    expect(zoneCue("laser-low", "warn", 5000)!.volume).toBeCloseTo(0.1, 10);
    // links symmetrisch zum rechten Rand
    expect(zoneCue("rockfall", "active", -300)!.volume).toBeCloseTo(zoneCue("rockfall", "active", VIEW_W + 300)!.volume, 10);
  });

  it("im Bild volle Lautstärke, direkt neben dem Bild noch (fast) voll", () => {
    expect(zoneCue("bolt", "active", 0)!.volume).toBe(1);
    expect(zoneCue("bolt", "active", VIEW_W)!.volume).toBe(1);
    expect(zoneCue("bolt", "active", VIEW_W + 50)!.volume).toBe(1);
    expect(zoneCue("bolt", "active", VIEW_W + 160)!.volume).toBeGreaterThan(0.79);
  });

  it("Cyber-Phasentore: Glitch nur aktiv und nur im Bild", () => {
    expect(zoneCue("phase-magenta", "active", 500)).toEqual({ name: "glitch", volume: 0.45 });
    expect(zoneCue("phase-cyan", "active", 500)).toEqual({ name: "glitch", volume: 0.45 });
    expect(zoneCue("phase-magenta", "active", 1700)).toBeNull();
    expect(zoneCue("phase-magenta", "active", -50)).toBeNull();
    expect(zoneCue("phase-magenta", "warn", 500)).toBeNull();
  });

  it("unbekannte Zonen und kaputte x-Werte", () => {
    expect(zoneCue("ice", "active", 500)).toBeNull();
    expect(zoneCue("glitch-cube", "active", 500)).toBeNull();
    expect(zoneCue("", "warn", 500)).toBeNull();
    expect(zoneCue("laser-low", "active", Number.NaN)!.volume).toBe(1);
  });

  it("Skin-Gruppen (Grundlage des Mindestabstands)", () => {
    expect(zoneGroup("Laser-Low")).toBe("laser");
    expect(zoneGroup("beam-fence")).toBe("laser");
    expect(zoneGroup("rockfall")).toBe("rock");
    expect(zoneGroup("lightning")).toBe("bolt");
    expect(zoneGroup("stempel")).toBe("stamp");
    expect(zoneGroup("phase-cyan")).toBe("phase");
    expect(zoneGroup("ice")).toBeNull();
  });

  it("alle gelieferten Namen sind echte SFX", () => {
    for (const skin of ["laser-low", "rockfall", "bolt", "stamp", "phase-cyan"]) {
      for (const phase of ["warn", "active"] as const) {
        const c = zoneCue(skin, phase, 600);
        if (c) expect(SFX_NAMES).toContain(c.name);
      }
    }
  });
});

describe("CueTracker", () => {
  const base: CueInput = { t: 10, energy: 100, dashCost: 34, dashCd: 0, hearts: 3, slowmo: 0, paused: false };
  /** Füttert eine Folge von Zuständen (t in 0.1-s-Schritten ab `t0`), liefert (t, Name)-Paare. */
  function run(tr: CueTracker, steps: Array<Partial<CueInput>>, t0 = 10, dt = 0.1): Array<[number, CueName]> {
    const out: Array<[number, CueName]> = [];
    steps.forEach((s, i) => {
      const t = Math.round((t0 + i * dt) * 1000) / 1000;
      for (const c of tr.update({ ...base, ...s, t })) out.push([t, c]);
    });
    return out;
  }
  const repeat = (n: number, s: Partial<CueInput>): Array<Partial<CueInput>> => Array.from({ length: n }, () => s);

  it("dash-ready genau beim Übergang auf bereit, nicht beim Start und nicht doppelt", () => {
    const tr = new CueTracker();
    const out = run(tr, [
      { energy: 20 }, // Start: nicht bereit, erster Frame meldet nichts
      { energy: 25 },
      { energy: 34 }, // Übergang
      { energy: 40 },
      { energy: 60 },
      { energy: 5 }, // Dash benutzt
      { energy: 5, dashCd: 0.5 },
      { energy: 20 },
      { energy: 50 }, // wieder bereit
    ]);
    expect(out).toEqual([
      [10.2, "dash-ready"],
      [10.8, "dash-ready"],
    ]);
  });

  it("dash-ready auch nach Ablauf der Abklingzeit bei genug Energie, nicht beim Start mit voller Energie", () => {
    const tr = new CueTracker();
    const out = run(tr, [{ energy: 100 }, { energy: 100 }, { energy: 66, dashCd: 0.7 }, { energy: 66, dashCd: 0.3 }, { energy: 66, dashCd: 0 }, { energy: 66 }]);
    expect(out).toEqual([[10.4, "dash-ready"]]);
  });

  it("keine Hinweise in den ersten 2 s, der Zustand wird trotzdem mitgeführt", () => {
    const tr = new CueTracker();
    const out = run(
      tr,
      [
        { energy: 10 },
        { energy: 40 }, // Übergang bei t = 0.6: still
        { energy: 40, hearts: 1, slowmo: 3 },
        { energy: 40, hearts: 1, slowmo: 0 }, // Zeitlupe vorbei bei t = 0.8: still
        ...repeat(14, { energy: 40, hearts: 1 }),
      ],
      0.5,
    );
    // dash-ready und slowmo-off kommen nicht nachträglich; der Herzschlag wartet bis 2.0 s
    expect(out.filter(([, c]) => c !== "heartbeat")).toEqual([]);
    expect(out.every(([t]) => t >= CUE_QUIET_SEC)).toBe(true);
    expect(out[0]).toEqual([2, "heartbeat"]);
  });

  it("heartbeat alle 1.3 s bei genau einem Herz, der erste einen Takt nach dem Wechsel", () => {
    const tr = new CueTracker();
    const out = run(tr, [...repeat(5, {}), ...repeat(41, { hearts: 1 })]);
    // Wechsel auf 1 Herz bei t = 10.5, erster Schlag bei 11.8, danach 13.1, 14.4
    expect(out.map(([, c]) => c)).toEqual(["heartbeat", "heartbeat", "heartbeat"]);
    expect(out[0][0]).toBeCloseTo(10.5 + HEARTBEAT_GAP_SEC, 6);
    expect(out[1][0] - out[0][0]).toBeCloseTo(HEARTBEAT_GAP_SEC, 6);
    expect(out[2][0] - out[1][0]).toBeCloseTo(HEARTBEAT_GAP_SEC, 6);
  });

  it("heartbeat schweigt bei Pause, bei 0, 2 und mehr Herzen", () => {
    const tr = new CueTracker();
    const out = run(tr, [...repeat(30, { hearts: 1, paused: true }), ...repeat(30, { hearts: 2 }), ...repeat(30, { hearts: 0 })]);
    expect(out).toEqual([]);
  });

  it("heartbeat setzt nach einem Herz-Pickup neu an", () => {
    const tr = new CueTracker();
    const out = run(tr, [...repeat(20, { hearts: 1 }), ...repeat(20, { hearts: 2 }), ...repeat(15, { hearts: 1 })]);
    // 1. Herz ab 10.0: Schlag bei 11.3; nach Pickup (ab 12.0) keiner; wieder 1 Herz ab 14.0: Schlag erst bei 15.3
    expect(out.map(([t]) => t)).toEqual([11.3, 15.3]);
  });

  it("Pause unterbricht den Herzschlag und läuft danach ohne Doppelschlag weiter", () => {
    const tr = new CueTracker();
    const out = run(tr, [...repeat(10, { hearts: 1 }), ...repeat(50, { hearts: 1, paused: true }), ...repeat(20, { hearts: 1 })]);
    // 1 Herz ab 10.0 (Schlag fällig 11.3); die Pause (11.0..15.9, t läuft hier absichtlich weiter) bleibt stumm, danach sofort ein
    // Schlag (16.0) und der nächste einen Takt später, kein Nachholen der verpassten
    expect(out.map(([t]) => t)).toEqual([16, 17.3]);
  });

  it("slowmo-off beim Übergang von an auf aus, genau einmal", () => {
    const tr = new CueTracker();
    const out = run(tr, [{}, { slowmo: 5.5 }, { slowmo: 3 }, { slowmo: 0.1 }, { slowmo: 0 }, { slowmo: 0 }, { slowmo: 5.5 }, { slowmo: 0 }]);
    expect(out).toEqual([
      [10.4, "slowmo-off"],
      [10.7, "slowmo-off"],
    ]);
  });

  it("Pause: keine Hinweise und kein Zustandswechsel", () => {
    const tr = new CueTracker();
    run(tr, [{ energy: 10 }]);
    // in der Pause ändert sich nichts (die Sim steht), der Übergang wird erst danach gemeldet
    expect(tr.update({ ...base, energy: 80, t: 11, paused: true })).toEqual([]);
    expect(tr.update({ ...base, energy: 80, t: 11.1 })).toEqual(["dash-ready"]);
  });

  it("reset: neuer Lauf meldet keinen Wechsel aus dem alten Zustand", () => {
    const tr = new CueTracker();
    run(tr, [{ energy: 5 }, { energy: 5, slowmo: 4 }]);
    tr.reset();
    const out = run(tr, [{ energy: 100 }, { energy: 100 }, { energy: 100, hearts: 3 }]);
    expect(out).toEqual([]);
  });

  it("ohne Hinweis kommt dasselbe leere Array (keine Allokation pro Frame)", () => {
    const tr = new CueTracker();
    const a = tr.update({ ...base });
    const b = tr.update({ ...base, t: 10.1 });
    expect(a).toBe(b);
    expect(a.length).toBe(0);
  });
});

/** Aufzeichnende Attrappe einer SfxVoice: sammelt die Schichten, die ein Rezept anlegt. */
function recordRecipe(name: (typeof SFX_NAMES)[number], p = 1, t = 0) {
  const tones: Array<{ t: number; f: number; f2?: number; dur: number; peak?: number; type?: string }> = [];
  const noises: Array<{ t: number; dur: number; peak?: number }> = [];
  const bells: Array<{ t: number; f: number; dur: number; peak?: number; partials?: readonly (readonly number[])[] }> = [];
  const param = { setValueAtTime() {}, setTargetAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} };
  const amp = { gain: param };
  const voice = {
    tone: (o: (typeof tones)[number]) => (tones.push(o), { osc: { frequency: param }, amp }),
    noise: (o: (typeof noises)[number]) => (noises.push(o), { src: {}, amp }),
    bell: (o: (typeof bells)[number]) => void bells.push(o),
    panSweep: () => {},
  };
  RECIPES[name](voice as unknown as SfxVoice, p, t);
  return { tones, noises, bells };
}

describe("SFX-Rezepte und Pegel", () => {
  it("jeder SFX-Name hat Rezept und Meta; alle Rezepte laufen und legen nur endliche Werte an", () => {
    for (const n of SFX_NAMES) {
      expect(typeof RECIPES[n], n).toBe("function");
      expect(SFX_META[n], n).toBeDefined();
      const r = recordRecipe(n);
      expect(r.tones.length + r.noises.length + r.bells.length, n).toBeGreaterThan(0);
      for (const o of [...r.tones, ...r.noises, ...r.bells]) {
        expect(Number.isFinite(o.t) && o.t >= 0, n).toBe(true);
        expect(o.dur, n).toBeGreaterThan(0);
        if (o.peak !== undefined) expect(o.peak, n).toBeLessThanOrEqual(1);
      }
      for (const o of [...r.tones, ...r.bells]) expect(o.f, n).toBeGreaterThan(20);
    }
  });

  it("dash-ready: zwei weiche Glockentöne (Quarte aufwärts), Peak ca. 0.2, kein Rauschen", () => {
    const r = recordRecipe("dash-ready");
    expect(r.bells.length).toBe(2);
    expect(r.tones.length).toBe(0);
    expect(r.noises.length).toBe(0);
    expect(r.bells[1].f).toBeGreaterThan(r.bells[0].f);
    expect(r.bells[1].t).toBeGreaterThan(r.bells[0].t);
    for (const b of r.bells) expect(b.peak).toBeCloseTo(0.2, 5);
    // weich: höchstens zwei Teiltöne, der zweite deutlich leiser
    for (const b of r.bells) {
      expect(b.partials!.length).toBeLessThanOrEqual(2);
      if (b.partials!.length > 1) expect(b.partials![1][1]).toBeLessThan(0.3);
    }
  });

  it("heartbeat enthält die beiden Sub-Töne des heart-Rezepts (Herzschlag lub-dub)", () => {
    const heart = recordRecipe("heart").tones.slice(0, 2);
    const beat = recordRecipe("heartbeat").tones;
    for (const sub of heart) {
      expect(beat.some((b) => b.t === sub.t && b.f === sub.f && b.f2 === sub.f2 && b.dur === sub.dur && b.peak === sub.peak), JSON.stringify(sub)).toBe(true);
    }
    // keine Glocken, endet nach ca. 0.3 s
    expect(recordRecipe("heartbeat").bells.length).toBe(0);
    for (const o of beat) expect(o.t + o.dur).toBeLessThan(0.35);
  });

  it("neue Hinweis-SFX: Priorität 0, nur eine Stimme, Mindestabstand", () => {
    for (const n of ["dash-ready", "heartbeat"] as const) {
      expect(SFX_NAMES).toContain(n);
      expect(SFX_META[n].pri).toBe(0);
      expect(SFX_META[n].max).toBe(1);
      expect(SFX_META[n].gap ?? 0).toBeGreaterThanOrEqual(0.3);
    }
  });

  it("Balance (audio-feel-03): Pegel der Basis-Rückmeldungen angehoben, Obergrenze eingehalten", () => {
    const g = (n: (typeof SFX_NAMES)[number]): number => SFX_META[n].gain;
    for (const n of ["jump", "doublejump", "slide", "dash", "stomp-chain", "coin", "gem", "countdown", "go"] as const) {
      expect(g(n), n).toBeGreaterThan(1);
      expect(g(n), n).toBeLessThanOrEqual(1.6); // SfxVoice klemmt die Stimme bei 1.5
    }
    expect(g("jump")).toBeLessThanOrEqual(1.5);
    // häufige Münze nur schwach angehoben (ca. 233/min), Countdown/Go am stärksten
    expect(g("coin")).toBeLessThan(g("jump"));
    expect(g("countdown")).toBeGreaterThanOrEqual(g("go"));
    // alles Übrige wurde nicht angehoben (1, ui-hover 0.8), außer dem Herzschlag (der Aufrufer spielt ihn leise)
    for (const n of SFX_NAMES) {
      if (["jump", "doublejump", "slide", "dash", "stomp-chain", "coin", "gem", "countdown", "go", "heartbeat"].includes(n)) continue;
      expect(g(n), n).toBeLessThanOrEqual(1);
    }
  });

  it("Mikro-Duck: Countdown/Go [0.3, 0.2], Near-Miss/Combo/Powerup/Herz [0.25, 0.25], nie bei der Münze; bestehende Ducks unverändert", () => {
    expect(SFX_META.countdown.duck).toEqual([0.3, 0.2]);
    expect(SFX_META.go.duck).toEqual([0.3, 0.2]);
    for (const n of ["near-miss", "combo-up", "powerup", "heart"] as const) expect(SFX_META[n].duck, n).toEqual([0.25, 0.25]);
    expect(SFX_META.coin.duck).toBeUndefined();
    expect(SFX_META.hurt.duck).toEqual([0.35, 0.5]);
    expect(SFX_META.death.duck).toEqual([0.8, 2.2]);
    for (const n of SFX_NAMES) {
      const d = SFX_META[n].duck;
      if (d) {
        expect(d[0], n).toBeGreaterThan(0);
        expect(d[0], n).toBeLessThanOrEqual(1);
        expect(d[1], n).toBeGreaterThan(0);
      }
    }
  });
});
