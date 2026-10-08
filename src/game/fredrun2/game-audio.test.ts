import { describe, expect, it } from "vitest";
import type { FredAudio } from "./audio";
import { COIN_LADDER, COIN_PITCH_MAX, coinPitch, comboPitch, stompChainPitch } from "./audio/cues";
import { COIN_STEPS } from "./audio/sfx";
import { SFX_NAMES } from "./audio/types";
import { VIEW_W } from "./constants";
import type { AudioLike } from "./game";
import { ZONE_AUDIBLE_VOLUME, ZONE_MIN_GAP_SEC, ZONE_WINDOW_SEC, createGameAudio, type AudioSink, type GameAudioEvent, type SimLike } from "./game-audio";
import type { Sim } from "./sim";
import type { SimEvent } from "./types";

// Übersetzungszeit-Prüfung der Schnittstelle: das Audio-Objekt des Hubs, die echte Engine und ein SimEvent passen strukturell
const _hubAudio = (a: AudioLike): AudioSink => a;
const _engineAudio = (a: FredAudio): AudioSink => a;
const _simEvent = (e: SimEvent): GameAudioEvent => e;
const _sim = (s: Sim): SimLike => s;
void [_hubAudio, _engineAudio, _simEvent, _sim];

interface Call {
  name: string;
  opts?: { pitch?: number; volume?: number; pan?: number };
}

/** Attrappe des Audio-Objekts: zeichnet alle Aufrufe auf. */
function fakeSink() {
  const calls: Call[] = [];
  const ducks: Array<[number, number]> = [];
  const plays: Array<{ id: string; opts?: unknown }> = [];
  return {
    calls,
    ducks,
    plays,
    sink: {
      sfx: (name: string, opts?: Call["opts"]) => void calls.push({ name, opts }),
      duck: (a: number, s: number) => void ducks.push([a, s]),
      music: { play: (id: string, opts?: unknown) => void plays.push({ id, opts }) },
    },
    names: () => calls.map((c) => c.name),
    clear: () => {
      calls.length = 0;
    },
  };
}

function fakeSim(over: Partial<{ time: number; energy: number; dashCd: number; hearts: number; slowmo: number; dashCost: number; music: string }> = {}): SimLike & { player: { energy: number; dashCd: number; hearts: number; slowmo: number } } {
  return {
    time: over.time ?? 10,
    world: { music: over.music ?? "wien" },
    perks: { dashCost: over.dashCost ?? 34 },
    player: { energy: over.energy ?? 100, dashCd: over.dashCd ?? 0, hearts: over.hearts ?? 3, slowmo: over.slowmo ?? 0 },
  };
}

const ev = (type: string, x = 640, extra: Partial<GameAudioEvent> = {}): GameAudioEvent => ({ type, x, y: 300, ...extra });
const semis = (p: number): number => 12 * Math.log2(p);
const offScale = (p: number): number => Math.min(...COIN_STEPS.map((c) => Math.abs(c - semis(p))));
const ON = (): boolean => true;

describe("onEvent: unveränderte Zuordnung", () => {
  it("einfache Ereignisse spielen ihren Effekt", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    const sim = fakeSim();
    const table: Array<[string, string]> = [
      ["jump", "jump"], ["doublejump", "doublejump"], ["slide", "slide"], ["dash", "dash"], ["stomp-land", "stomp"], ["portal", "portal"],
      ["heart", "heart"], ["shield-on", "shield-on"], ["shield-hit", "shield-hit"], ["near-miss", "near-miss"], ["combo-break", "combo-break"],
      ["pit-fall", "splash"], ["milestone", "checkpoint"],
    ];
    for (const [type, name] of table) {
      f.clear();
      ga.onEvent(ev(type), sim);
      expect(f.names(), type).toEqual([name]);
    }
  });

  it("Ereignisse ohne Ton bleiben still", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    for (const type of ["start", "slide-end", "dash-end", "custom", "unbekannt"]) ga.onEvent(ev(type), fakeSim());
    expect(f.calls).toEqual([]);
  });

  it("land: Lautstärke aus dem Aufprall (Standard 0.4, höchstens 1)", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    ga.onEvent(ev("land", 300, { value: 250 }), fakeSim());
    ga.onEvent(ev("land", 300), fakeSim());
    ga.onEvent(ev("land", 300, { value: 5000 }), fakeSim());
    expect(f.calls.map((c) => c.opts?.volume)).toEqual([0.25, 0.4, 1]);
  });

  it("Pan folgt dem Bildschirm-x (±0.6) bei spring, gem, enemy-defeat, wallbreak", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    for (const type of ["spring", "gem", "enemy-defeat", "wallbreak"]) {
      f.clear();
      ga.onEvent(ev(type, 0), fakeSim());
      ga.onEvent(ev(type, VIEW_W / 2), fakeSim());
      ga.onEvent(ev(type, 5000), fakeSim());
      expect(f.calls.map((c) => c.opts?.pan), type).toEqual([-0.6, 0, 0.6]);
    }
  });

  it("powerup: Zusatzton je Typ (Zeitlupe, Magnet)", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    ga.onEvent(ev("powerup", 0, { tag: "slowmo" }), fakeSim());
    ga.onEvent(ev("powerup", 0, { tag: "magnet" }), fakeSim());
    ga.onEvent(ev("powerup", 0, { tag: "turbo" }), fakeSim());
    expect(f.names()).toEqual(["powerup", "slowmo-on", "powerup", "magnet-on", "powerup"]);
  });

  it("hurt/death ducken die Musik, Weltwechsel startet das neue Stück", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    ga.onEvent(ev("hurt"), fakeSim());
    ga.onEvent(ev("death"), fakeSim());
    expect(f.ducks).toEqual([[0.5, 0.25], [0.9, 1.2]]);
    ga.onEvent(ev("world-transition"), fakeSim({ music: "alpen" }));
    expect(f.names()).toEqual(["hurt", "death", "world-transition"]);
    expect(f.plays).toEqual([{ id: "alpen", opts: { crossfadeSec: 2 } }]);
  });

  it("ohne duck/music im Audio-Objekt wirft nichts", () => {
    const calls: string[] = [];
    const ga = createGameAudio({ sfx: (n) => void calls.push(n) }, { cuesEnabled: ON });
    expect(() => {
      ga.onEvent(ev("hurt"), fakeSim());
      ga.onEvent(ev("death"), fakeSim());
      ga.onEvent(ev("world-transition"), fakeSim());
    }).not.toThrow();
    expect(calls).toEqual(["hurt", "death", "world-transition"]);
  });

  it("custom: sfx:-Tags der Welten und crumble", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    ga.onEvent(ev("custom", 0, { tag: "sfx:bee-buzz" }), fakeSim());
    ga.onEvent(ev("custom", VIEW_W, { tag: "sfx:coin" }), fakeSim());
    ga.onEvent(ev("custom", 640, { tag: "crumble" }), fakeSim());
    ga.onEvent(ev("custom", 640, { tag: "stage" }), fakeSim());
    expect(f.calls).toEqual([
      { name: "bee-buzz", opts: { pan: -0.6 } },
      { name: "coin", opts: { pan: 0.6 } }, // weltspezifische Münzen: kein pitch -> pentatonische Kette im SfxPlayer
      { name: "crumble", opts: { pan: 0 } },
    ]);
    expect(f.calls[1].opts?.pitch).toBeUndefined();
  });

  it("alle gespielten Namen sind echte SFX-Namen", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    const types = ["jump", "doublejump", "land", "slide", "dash", "dash-denied", "stomp-start", "stomp-land", "bounce", "spring", "portal", "coin", "gem", "heart", "powerup", "shield-on", "shield-hit", "hurt", "death", "near-miss", "combo-up", "combo-break", "enemy-defeat", "wallbreak", "pit-fall", "world-transition", "milestone"];
    for (const t of types) ga.onEvent(ev(t), fakeSim());
    for (const c of f.calls) expect(SFX_NAMES, c.name).toContain(c.name);
  });
});

describe("onEvent: neue Zuordnung", () => {
  it("Münzkette: Tonhöhe auf der Leiter, steigt bis zum Ende, wechselt danach, nie über 2.5", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    for (let v = 1; v <= 40; v++) ga.onEvent(ev("coin", 700, { value: v }), fakeSim());
    const pitches = f.calls.map((c) => c.opts!.pitch!);
    expect(pitches[0]).toBe(1);
    for (let i = 0; i < pitches.length; i++) {
      expect(pitches[i]).toBe(coinPitch(i));
      expect(offScale(pitches[i])).toBeLessThan(pitches[i] === COIN_PITCH_MAX ? 0.15 : 1e-9);
      expect(pitches[i]).toBeLessThanOrEqual(2.5);
    }
    for (let i = 1; i < COIN_LADDER.length; i++) expect(pitches[i]).toBeGreaterThan(pitches[i - 1]);
    // ab dem Leiterende kein Plateau (früher ab der 12. Münze ein Ton)
    for (let i = COIN_LADDER.length; i < pitches.length; i++) expect(pitches[i]).not.toBe(pitches[i - 1]);
    expect(new Set(pitches.slice(COIN_LADDER.length)).size).toBe(2);
    expect(f.calls.every((c) => c.name === "coin")).toBe(true);
  });

  it("combo-up und stomp-chain rasten auf Skalentöne", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    for (let level = 2; level <= 8; level++) ga.onEvent(ev("combo-up", 0, { value: level }), fakeSim());
    for (let n = 1; n <= 8; n++) ga.onEvent(ev("bounce", 0, { value: n }), fakeSim());
    const combo = f.calls.filter((c) => c.name === "combo-up").map((c) => c.opts!.pitch!);
    const chain = f.calls.filter((c) => c.name === "stomp-chain").map((c) => c.opts!.pitch!);
    expect(combo).toEqual([2, 3, 4, 5, 6, 7, 8].map(comboPitch));
    expect(chain).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map(stompChainPitch));
    for (const p of [...combo, ...chain]) expect(offScale(p)).toBeLessThan(1e-9);
    // ohne Wert: Standard (Combo-Stufe 2, Kettenlänge 1)
    f.clear();
    ga.onEvent(ev("combo-up"), fakeSim());
    ga.onEvent(ev("bounce"), fakeSim());
    expect(f.calls.map((c) => c.opts!.pitch)).toEqual([1, 1]);
  });

  it("stomp-start: leiser, tiefer Whoosh; dash-denied: leises ui-denied", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    ga.onEvent(ev("stomp-start"), fakeSim());
    ga.onEvent(ev("dash-denied"), fakeSim());
    expect(f.calls).toEqual([
      { name: "dash", opts: { pitch: 0.75, volume: 0.45 } },
      { name: "ui-denied", opts: { volume: 0.5 } },
    ]);
  });
});

describe("Zonen-Sounds", () => {
  const zone = (phase: "warn" | "active", skin: string, x: number): GameAudioEvent => ({ type: "custom", x, y: 400, tag: `zone-${phase}:${skin}`, skin });

  it("Laser und Steinschlag: Warnen und Aktivieren klingen verschieden", () => {
    for (const skin of ["laser-low", "beam-fence", "rockfall"]) {
      const f = fakeSink();
      const ga = createGameAudio(f.sink, { cuesEnabled: ON });
      ga.onEvent(zone("warn", skin, 640), fakeSim());
      ga.tick(1, fakeSim(), false);
      ga.onEvent(zone("active", skin, 640), fakeSim());
      expect(f.calls.length, skin).toBe(2);
      expect(f.calls[0].opts).not.toEqual(f.calls[1].opts);
      expect(f.calls[0].opts!.volume, skin).toBeLessThan(f.calls[1].opts!.volume!);
    }
  });

  it("Laser: Warnung pitch 0.6 / 0.5, aktiv pitch 1 / 1; Pan nach x", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    ga.onEvent(zone("warn", "laser-low", 640), fakeSim());
    ga.tick(1, fakeSim(), false);
    ga.onEvent(zone("active", "laser-low", 1280), fakeSim());
    expect(f.calls).toEqual([
      { name: "laser-zap", opts: { pitch: 0.6, volume: 0.5, pan: 0 } },
      { name: "laser-zap", opts: { pitch: 1, volume: 1, pan: 0.6 } },
    ]);
  });

  it("Zonen neben dem Bild sind leiser; weit draußen (unter ZONE_AUDIBLE_VOLUME) bleiben sie stumm", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    const vols: number[] = [];
    for (const x of [640, 1300, 1500, 1650]) {
      f.clear();
      ga.onEvent(zone("active", "bolt", x), fakeSim());
      vols.push(f.calls[0].opts!.volume!);
      ga.tick(1.1, fakeSim(), false);
    }
    expect(vols[0]).toBe(1);
    for (let i = 1; i < vols.length; i++) expect(vols[i]).toBeLessThanOrEqual(vols[i - 1]); // dicht am Bild (x = 1300) noch voll
    expect(vols[2]).toBeLessThan(vols[0]);
    expect(vols[3]).toBeLessThan(vols[2]);
    expect(vols[3]).toBeGreaterThanOrEqual(ZONE_AUDIBLE_VOLUME);
    expect(vols[3]).toBeLessThan(0.4);
    // darüber hinaus (x = 1700 wäre Boden 0.2): kein Ton, links wie rechts
    f.clear();
    for (const x of [1700, -420, 3000, -2000]) {
      ga.onEvent(zone("active", "bolt", x), fakeSim());
      ga.tick(1.1, fakeSim(), false);
    }
    expect(f.calls).toEqual([]);
  });

  it("jeder gespielte Zonen-Ton ist mindestens ZONE_AUDIBLE_VOLUME laut (Weite über das ganze Feld, alle Gruppen)", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    let played = 0;
    for (const skin of ["bolt", "stamp", "laser-low", "rockfall", "phase-cyan"]) {
      for (const phase of ["warn", "active"] as const) {
        for (let x = -900; x <= 2200; x += 25) {
          ga.tick(1.1, fakeSim(), false); // jeder Versuch in einer freien Sekunde
          ga.onEvent(zone(phase, skin, x), fakeSim());
          played = f.calls.length;
        }
      }
    }
    expect(played).toBeGreaterThan(100);
    for (const c of f.calls) expect(c.opts!.volume, c.name).toBeGreaterThanOrEqual(ZONE_AUDIBLE_VOLUME);
  });

  it("Mindestabstand 0.35 s je Skin-Gruppe", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    const sim = fakeSim();
    ga.onEvent(zone("active", "laser-low", 640), sim);
    ga.onEvent(zone("active", "laser-high", 700), sim); // gleiche Gruppe, gleicher Moment: verworfen
    ga.tick(0.3, sim, false);
    ga.onEvent(zone("active", "beam-fence", 640), sim); // 0.3 s später: noch gesperrt
    expect(f.names()).toEqual(["laser-zap"]);
    ga.tick(ZONE_MIN_GAP_SEC - 0.3 + 0.01, sim, false);
    ga.onEvent(zone("active", "beam-fence", 640), sim);
    expect(f.names()).toEqual(["laser-zap", "laser-zap"]);
  });

  it("andere Skin-Gruppen sind vom Mindestabstand unabhängig", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    ga.onEvent(zone("active", "laser-low", 640), fakeSim());
    ga.onEvent(zone("active", "rockfall", 700), fakeSim());
    expect(f.names()).toEqual(["laser-zap", "rockfall"]);
  });

  it("Gesamtdeckel: höchstens zwei Zonen-Töne je Sekunde über alle Gruppen", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    const sim = fakeSim();
    ga.onEvent(zone("active", "laser-low", 640), sim);
    ga.tick(0.2, sim, false);
    ga.onEvent(zone("active", "rockfall", 640), sim);
    ga.tick(0.2, sim, false);
    ga.onEvent(zone("active", "stamp", 640), sim); // dritter innerhalb einer Sekunde: verworfen
    expect(f.names()).toEqual(["laser-zap", "rockfall"]);
    ga.tick(0.6, sim, false); // 1.0 s nach dem ersten: Fenster ist strikt größer als 1 s noch nicht erreicht
    ga.onEvent(zone("active", "stamp", 640), sim);
    expect(f.names().length).toBe(2);
    ga.tick(0.02, sim, false);
    ga.onEvent(zone("active", "stamp", 640), sim);
    expect(f.names()).toEqual(["laser-zap", "rockfall", "stamp-thud"]);
  });

  it("Signal schlägt Warnung: eine Warnung braucht eine freie Sekunde, der aktive Ton nur einen freien Platz", () => {
    // Finanzamt Seed 32 (Prüfbericht): Stempel aktiv, 0.26 s später Laser-Warnung, 0.45 s darauf Laser aktiv im Bild. Früher belegten
    // Stempel und Warnung beide Plätze, das Feuern blieb stumm.
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    const sim = fakeSim();
    ga.onEvent(zone("active", "stamp", 640), sim);
    ga.tick(0.26, sim, false);
    ga.onEvent(zone("warn", "laser-high", 900), sim); // Warnung: kein freies Fenster -> verworfen
    ga.tick(0.45, sim, false);
    ga.onEvent(zone("active", "laser-high", 755), sim);
    expect(f.names()).toEqual(["stamp-thud", "laser-zap"]);
    expect(f.calls[1].opts).toEqual({ pitch: 1, volume: 1, pan: expect.any(Number) });
  });

  it("eine gespielte Warnung nimmt dem aktiven Ton danach nicht den Platz und nicht die Gruppe", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    const sim = fakeSim();
    ga.onEvent(zone("warn", "laser-low", 640), sim); // freie Sekunde -> spielt
    ga.tick(0.2, sim, false);
    ga.onEvent(zone("active", "laser-low", 640), sim); // gleiche Gruppe, 0.2 s später: die Warnung sperrt die Gruppe nicht
    expect(f.calls.map((c) => c.opts!.pitch)).toEqual([0.6, 1]);
    // beide Plätze belegt: weder Warnung noch weiteres Signal in diesem Fenster
    ga.tick(0.2, sim, false);
    ga.onEvent(zone("warn", "rockfall", 640), sim);
    ga.onEvent(zone("active", "stamp", 640), sim);
    expect(f.calls.length).toBe(2);
  });

  it("Warnungen kommen auch nach einem einzelnen aktiven Ton erst nach einer ganz freien Sekunde", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    const sim = fakeSim();
    ga.onEvent(zone("active", "stamp", 640), sim);
    ga.tick(ZONE_WINDOW_SEC, sim, false); // genau ein Fenster: noch nicht frei (strikt "größer")
    ga.onEvent(zone("warn", "rockfall", 640), sim);
    expect(f.names()).toEqual(["stamp-thud"]);
    ga.tick(0.01, sim, false);
    ga.onEvent(zone("warn", "rockfall", 640), sim);
    expect(f.names()).toEqual(["stamp-thud", "rockfall"]);
  });

  it("zwei Signale binnen einer Sekunde spielen immer, auch wenn davor weit entfernte Zonen feuern", () => {
    // Weit draußen (Boden 0.2: Cyber Seed 31 / x = 2954) und unhörbare Warnungen belegten früher beide Plätze.
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    const sim = fakeSim();
    ga.onEvent(zone("active", "beam-fence", 1708), sim);
    ga.tick(0.1, sim, false);
    ga.onEvent(zone("warn", "laser-floor", 3455), sim);
    ga.onEvent(zone("active", "laser-floor", 2954), sim);
    ga.onEvent(zone("warn", "rockfall", 2200), sim);
    ga.tick(0.1, sim, false);
    expect(f.calls).toEqual([]); // nichts davon ist hörbar
    ga.onEvent(zone("active", "laser-low", 293), sim); // gleiche Gruppe wie die stummen: nicht gesperrt
    ga.tick(0.3, sim, false);
    ga.onEvent(zone("active", "stamp", 700), sim);
    expect(f.names()).toEqual(["laser-zap", "stamp-thud"]);
    expect(f.calls[0].opts!.volume).toBe(1);
  });

  it("ein Ton an der Hörbarkeitsgrenze spielt allein, zählt aber wie jeder andere (Signal: ein Platz)", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    const sim = fakeSim();
    ga.onEvent(zone("active", "rockfall", 1680), sim); // 400 px neben dem Bild: Volume ca. 0.26
    expect(f.names()).toEqual(["rockfall"]);
    expect(f.calls[0].opts!.volume).toBeGreaterThanOrEqual(ZONE_AUDIBLE_VOLUME);
    expect(f.calls[0].opts!.volume).toBeLessThan(0.3);
    ga.tick(0.1, sim, false);
    ga.onEvent(zone("active", "laser-low", 640), sim);
    ga.tick(0.1, sim, false);
    ga.onEvent(zone("active", "stamp", 640), sim); // dritter binnen einer Sekunde
    expect(f.names()).toEqual(["rockfall", "laser-zap"]);
  });

  it("ein verworfener oder stummer Zonen-Ton sperrt die Gruppe nicht", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    ga.onEvent(zone("active", "phase-cyan", 1700), fakeSim()); // Phasentor außerhalb des Bildes: kein Ton
    ga.onEvent(zone("active", "phase-cyan", 500), fakeSim());
    expect(f.calls).toEqual([{ name: "glitch", opts: { volume: 0.45, pan: -0.6 * (140 / 640) } }]);
    // auch ein unhörbarer Ton (Zone weit neben dem Bild) sperrt weder Gruppe noch Deckel
    f.clear();
    ga.tick(2, fakeSim(), false);
    ga.onEvent(zone("active", "laser-low", 2900), fakeSim());
    ga.onEvent(zone("active", "laser-low", 640), fakeSim());
    expect(f.calls.map((c) => c.opts!.volume)).toEqual([1]);
  });

  it("Phasentore: nur aktiver Takt, Warnung still; Zonen ohne Sound (Eis, Würfel) bleiben still", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    ga.onEvent(zone("warn", "phase-magenta", 500), fakeSim());
    ga.onEvent(zone("active", "ice", 500), fakeSim());
    ga.onEvent(zone("active", "glitch-cube", 500), fakeSim());
    expect(f.calls).toEqual([]);
    ga.onEvent(zone("active", "phase-magenta", 500), fakeSim());
    expect(f.names()).toEqual(["glitch"]);
  });

  it("Skin aus dem Tag, wenn das Ereignis keinen skin trägt", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    ga.onEvent({ type: "custom", x: 640, y: 0, tag: "zone-active:Stamp" }, fakeSim());
    expect(f.names()).toEqual(["stamp-thud"]);
  });

  it("Salve von Zonen-Ereignissen: Mindestabstand eingehalten und nie mehr als 2 Töne in einer Sekunde (statt bis zu 10)", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    const sim = fakeSim();
    // ein Ereignis alle 0.1 s (im Cyber-Bot-Lauf kamen bis zu 4 Zonen-Sounds je Sekunde), 6 s lang
    const times: number[] = [];
    let t = 0;
    for (let i = 0; i < 60; i++) {
      const before = f.calls.length;
      ga.onEvent(zone(i % 2 ? "warn" : "active", "laser-low", 640), sim);
      if (f.calls.length > before) times.push(t);
      ga.tick(0.1, sim, false);
      t += 0.1;
    }
    expect(times.length).toBeGreaterThan(7);
    expect(times.length).toBeLessThanOrEqual(13); // 60 Ereignisse in 6 s -> höchstens 2 je Sekunde
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(ZONE_MIN_GAP_SEC - 1e-9);
    for (let i = 2; i < times.length; i++) expect(times[i] - times[i - 2]).toBeGreaterThan(1);
  });
});

describe("Zonen-Sounds unter Zufallslast", () => {
  const zone = (phase: "warn" | "active", skin: string, x: number): GameAudioEvent => ({ type: "custom", x, y: 400, tag: `zone-${phase}:${skin}`, skin });

  it("Deckel 2 je Sekunde, Warnungen nur in freier Sekunde, nichts unter ZONE_AUDIBLE_VOLUME", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    const sim = fakeSim();
    let state = 20260508; // lineare Kongruenz: deterministisch, kein Math.random im Test
    const rnd = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const skins = ["bolt", "stamp", "laser-low", "beam-fence", "rockfall", "phase-cyan"];
    const played: Array<{ t: number; warn: boolean }> = [];
    let t = 0;
    for (let i = 0; i < 6000; i++) {
      for (let k = rnd() < 0.3 ? 2 : 1; k > 0; k--) {
        const warn = rnd() < 0.5;
        const x = -300 + rnd() * 2100;
        const before = f.calls.length;
        ga.onEvent(zone(warn ? "warn" : "active", skins[Math.floor(rnd() * skins.length)], x), sim);
        const did = f.calls.length > before;
        if (did) played.push({ t, warn });
      }
      const dt = rnd() * 0.25;
      ga.tick(dt, sim, false);
      t += dt;
    }
    expect(played.length).toBeGreaterThan(400);
    for (let i = 2; i < played.length; i++) expect(played[i].t - played[i - 2].t, `Ton ${i}`).toBeGreaterThan(ZONE_WINDOW_SEC);
    for (let i = 1; i < played.length; i++) if (played[i].warn) expect(played[i].t - played[i - 1].t, `Warnung ${i}`).toBeGreaterThan(ZONE_WINDOW_SEC);
    for (const c of f.calls) expect(c.opts!.volume, c.name).toBeGreaterThanOrEqual(ZONE_AUDIBLE_VOLUME);
  });
});

describe("tick: Zustands-Hinweise", () => {
  it("Dash bereit: genau ein Ton beim Übergang, nicht doppelt", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    const sim = fakeSim({ time: 10, energy: 10 });
    ga.tick(0.016, sim, false);
    sim.time += 0.016;
    sim.player.energy = 40;
    ga.tick(0.016, sim, false);
    for (let i = 0; i < 20; i++) {
      sim.time += 0.016;
      ga.tick(0.016, sim, false);
    }
    expect(f.calls).toEqual([{ name: "dash-ready", opts: undefined }]);
  });

  it("letztes Herz: Herzschlag leise alle 1.3 s, Stopp bei Pause und beim Herz-Pickup", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    const sim = fakeSim({ time: 10, hearts: 1 });
    const step = (n: number, paused = false): void => {
      for (let i = 0; i < n; i++) {
        sim.time += 0.1;
        ga.tick(0.1, sim, paused);
      }
    };
    ga.tick(0.1, sim, false);
    step(40); // 4 s -> Schläge bei ca. 11.3, 12.6, 13.9
    expect(f.calls.map((c) => c.name)).toEqual(["heartbeat", "heartbeat", "heartbeat"]);
    expect(f.calls.every((c) => c.opts?.volume === 0.4)).toBe(true);
    f.clear();
    step(30, true); // Pause
    expect(f.calls).toEqual([]);
    sim.player.hearts = 2; // Herz-Pickup
    step(30);
    expect(f.calls).toEqual([]);
  });

  it("Zeitlupe vorbei: ein Ton beim Übergang", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    const sim = fakeSim({ time: 10, slowmo: 5.5 });
    ga.tick(0.016, sim, false);
    sim.time += 3;
    sim.player.slowmo = 2.5;
    ga.tick(0.016, sim, false);
    expect(f.calls).toEqual([]);
    sim.time += 2.5;
    sim.player.slowmo = 0;
    ga.tick(0.016, sim, false);
    ga.tick(0.016, sim, false);
    expect(f.calls).toEqual([{ name: "slowmo-off", opts: undefined }]);
  });

  it("keine Hinweise in den ersten 2 s eines Laufs", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    const sim = fakeSim({ time: 0, energy: 5, hearts: 3 });
    ga.tick(0.016, sim, false);
    sim.time = 0.5;
    sim.player.energy = 90; // Dash wird bereit, noch in der Stille
    sim.player.slowmo = 0;
    ga.tick(0.016, sim, false);
    expect(f.calls).toEqual([]);
  });

  it("cuesEnabled = false: alle Hinweise stumm, beim Einschalten kein Nachholen", () => {
    const f = fakeSink();
    let on = false;
    const ga = createGameAudio(f.sink, { cuesEnabled: () => on });
    const sim = fakeSim({ time: 10, energy: 10, hearts: 1, slowmo: 4 });
    ga.tick(0.016, sim, false);
    for (let i = 0; i < 60; i++) {
      sim.time += 0.1;
      if (i === 5) sim.player.energy = 80; // Dash bereit
      if (i === 8) sim.player.slowmo = 0; // Zeitlupe vorbei
      ga.tick(0.1, sim, false);
    }
    expect(f.calls).toEqual([]);
    on = true;
    sim.time += 0.1;
    ga.tick(0.1, sim, false);
    expect(f.calls).toEqual([]);
    // ab jetzt zählt wieder: nächster Herzschlag
    for (let i = 0; i < 14; i++) {
      sim.time += 0.1;
      ga.tick(0.1, sim, false);
    }
    expect(f.names()).toEqual(["heartbeat"]);
  });

  it("Zonen- und Ereignistöne bleiben bei cuesEnabled = false", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: () => false });
    ga.onEvent({ type: "custom", x: 640, y: 0, tag: "zone-active:laser-low", skin: "laser-low" }, fakeSim());
    ga.onEvent(ev("stomp-start"), fakeSim());
    ga.onEvent(ev("dash-denied"), fakeSim());
    expect(f.names()).toEqual(["laser-zap", "dash", "ui-denied"]);
  });

  it("neue Sim (neuer Lauf) setzt Hinweise und Zonen-Sperre zurück", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    const a = fakeSim({ time: 30, energy: 5 });
    ga.tick(0.016, a, false);
    ga.onEvent({ type: "custom", x: 640, y: 0, tag: "zone-active:rockfall", skin: "rockfall" }, a);
    f.clear();
    // neuer Lauf: volle Energie von Anfang an darf keinen "bereit"-Wechsel aus dem alten Zustand auslösen, die Zonen-Sperre ist weg
    const b = fakeSim({ time: 0, energy: 100 });
    ga.tick(0.016, b, false);
    b.time = 3;
    ga.tick(0.016, b, false);
    ga.onEvent({ type: "custom", x: 640, y: 0, tag: "zone-active:rockfall", skin: "rockfall" }, b);
    expect(f.names()).toEqual(["rockfall"]);
  });

  it("start-Ereignis setzt Hinweise und Zonen-Sperren zurück (gleiche Sim-Instanz)", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    const sim = fakeSim({ time: 30, energy: 5 });
    ga.tick(0.016, sim, false);
    ga.onEvent({ type: "custom", x: 640, y: 0, tag: "zone-active:rockfall", skin: "rockfall" }, sim);
    ga.onEvent(ev("start"), sim);
    f.clear();
    sim.player.energy = 100; // Energie springt mit dem neuen Lauf nach oben: kein "bereit"-Wechsel aus dem alten Zustand
    sim.time = 3;
    ga.tick(0.016, sim, false);
    ga.onEvent({ type: "custom", x: 640, y: 0, tag: "zone-active:rockfall", skin: "rockfall" }, sim);
    expect(f.names()).toEqual(["rockfall"]);
  });

  it("tick ohne Hinweis läuft ohne Aufrufe an das Audio-Objekt", () => {
    const f = fakeSink();
    const ga = createGameAudio(f.sink, { cuesEnabled: ON });
    const sim = fakeSim();
    for (let i = 0; i < 100; i++) {
      sim.time += 0.016;
      ga.tick(0.016, sim, false);
    }
    expect(f.calls).toEqual([]);
  });
});
