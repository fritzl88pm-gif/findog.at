import { afterEach, describe, expect, it, vi } from "vitest";
import { DASH_GRACE, FIXED_DT, HURT_INVULN, HURT_STUN, SLOWMO_FACTOR, SPEED_MAX, VIEW_H, VIEW_W } from "./constants";
import {
  DEATH_ORBIT_MAX,
  DEATH_SLIDE,
  DEATH_TIP_ANGLE,
  DEATH_TIP_TIME,
  HIT_FLASH_MAX,
  HIT_FLASH_TIME,
  HURT_CLOCK_SLACK,
  INVULN_PULSE_HZ,
  INVULN_PULSE_MIN,
  LIGHT_WORLDS,
  PLAYER_SHADOW,
  SPEED_LANE_MAX_LEN,
  SPEED_LANES,
  SPEED_LINE_FULL,
  SPEED_LINE_START,
  deathPose,
  landSquashAmplitude,
  overPit,
  playerAlpha,
  runRate,
  shadowRanges,
  shadowShape,
  speedLaneAt,
  speedLineIntensity,
  speedLineStyle,
  squashDuration,
  squashFor,
  stepRunPhase,
  type PlayerAlphaState,
  type SquashKind,
} from "./draw-utils";
import { MAX_FLYING, ORBIT_MAX, POPUP_ZONE, Particles, placePopup, popupWidth, puffSprite, warmPuffSprites, type PopupRect } from "./particles";
import { NO_INPUT, Sim } from "./sim";
import { WORLD_IDS } from "./types";
import { WORLDS } from "./worlds";

/** Deterministischer Zufall (LCG) für reproduzierbare Tempofolgen und Stresstests. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

// --- Lauf-Phase -----------------------------------------------------------------------------------------------------------

describe("stepRunPhase", () => {
  const LO = 0.7 * SLOWMO_FACTOR;
  const HI = 1.45;

  it("Kennlinie 0,7 … 1,45 über Tempo 0 … SPEED_MAX (geklemmt)", () => {
    expect(runRate(0)).toBeCloseTo(0.7, 12);
    expect(runRate(SPEED_MAX)).toBeCloseTo(1.45, 12);
    expect(runRate(SPEED_MAX * 3)).toBeCloseTo(1.45, 12);
    expect(runRate(-50)).toBeCloseTo(0.7, 12);
    expect(runRate(NaN)).toBeCloseTo(0.7, 12);
    expect(runRate(SPEED_MAX / 2)).toBeCloseTo(0.7 + 0.375, 12);
  });

  it("beliebige Tempofolgen: monoton nicht fallend, Ableitung in [0.7*0.62, 1.45]", () => {
    let bad = 0;
    let minRate = Infinity;
    let maxRate = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const rnd = lcg(seed);
      let phase = rnd() * 100;
      let speed = 470;
      let scale = 1;
      for (let i = 0; i < 2000; i += 1) {
        // Tempo springt (Treffer ×0,62, Dash ×1,85, Sprungfeder …), Slow-Mo schaltet um
        if (rnd() < 0.05) speed = rnd() * 1500;
        if (rnd() < 0.02) scale = scale === 1 ? SLOWMO_FACTOR : 1;
        const dt = 1 / 240 + rnd() * 0.05;
        const next = stepRunPhase(phase, dt, speed, scale);
        const rate = (next - phase) / dt;
        if (next < phase || rate < LO - 1e-9 || rate > HI + 1e-9) bad += 1;
        minRate = Math.min(minRate, rate);
        maxRate = Math.max(maxRate, rate);
        phase = next;
      }
    }
    expect(bad).toBe(0);
    // Die Grenzen werden tatsächlich ausgeschöpft (der Test ist nicht trivial)
    expect(minRate).toBeLessThan(LO + 0.05);
    expect(maxRate).toBeGreaterThan(HI - 0.05);
  });

  it("Tempowechsel ändert nur die Steigung, nie den Wert (kein Sprung wie bei time*rate)", () => {
    // bisher: t = time * rate(speed) -> Dash-Ende bei time = 300 s: Sprung um 300 * Δrate
    const old = (time: number, speed: number): number => time * runRate(speed);
    expect(old(300, 470) - old(300, 1180)).toBeLessThan(-100);
    let phase = 123.4;
    const before = phase;
    phase = stepRunPhase(phase, 1 / 60, 1180, 1);
    expect(phase - before).toBeCloseTo(runRate(1180) / 60, 12);
    const mid = phase;
    phase = stepRunPhase(phase, 1 / 60, 470, 1);
    expect(phase - mid).toBeCloseTo(runRate(470) / 60, 12);
  });

  it("Slow-Mo skaliert mit SLOWMO_FACTOR, timeScale 0 (Hitstop) friert ein, Phase läuft nie rückwärts", () => {
    expect(stepRunPhase(0, 1, 800, SLOWMO_FACTOR)).toBeCloseTo(runRate(800) * SLOWMO_FACTOR, 12);
    expect(stepRunPhase(5, 0.1, 800, 0)).toBe(5);
    expect(stepRunPhase(5, 0.1, 800, -3)).toBe(5);
    expect(stepRunPhase(5, 0.1, 800, 7)).toBeCloseTo(5 + 0.1 * runRate(800), 12);
  });

  it("ungültige Eingaben: dt <= 0, NaN, Infinity lassen die Phase unverändert", () => {
    expect(stepRunPhase(2, 0, 500)).toBe(2);
    expect(stepRunPhase(2, -1, 500)).toBe(2);
    expect(stepRunPhase(2, NaN, 500)).toBe(2);
    expect(stepRunPhase(2, Infinity, 500)).toBe(2);
    expect(stepRunPhase(NaN, 0.1, 500)).toBeCloseTo(0.1 * runRate(500), 12);
    expect(stepRunPhase(0, 0.1, NaN)).toBeCloseTo(0.07, 12);
  });
});

// --- Spieler-Transparenz --------------------------------------------------------------------------------------------------

describe("playerAlpha", () => {
  const base: PlayerAlphaState = { phase: "running", stun: 0, invuln: 0, dashT: 0, turbo: 0, time: 100, hurtT: -Infinity };

  /** Zustand t Sekunden nach einem Treffer bei hurtT = 100 (Stun HURT_STUN, Unverwundbarkeit HURT_INVULN). */
  const afterHit = (t: number, over: Partial<PlayerAlphaState> = {}): PlayerAlphaState => ({
    ...base,
    time: 100 + t,
    hurtT: 100,
    stun: Math.max(0, HURT_STUN - t),
    invuln: Math.max(0, HURT_INVULN - t),
    ...over,
  });

  it("während stun > 0 voll deckend plus weißer Flash 0,7 → 0 in 0,15 s", () => {
    const a0 = playerAlpha(afterHit(0));
    expect(a0.alpha).toBe(1);
    expect(a0.flash).toBeCloseTo(HIT_FLASH_MAX, 12);
    let last = a0.flash;
    for (let t = 0.005; t < HIT_FLASH_TIME; t += 0.005) {
      const a = playerAlpha(afterHit(t));
      expect(a.alpha).toBe(1);
      expect(a.flash).toBeLessThan(last);
      expect(a.flash).toBeGreaterThanOrEqual(0);
      last = a.flash;
    }
    expect(playerAlpha(afterHit(HIT_FLASH_TIME)).flash).toBe(0);
    for (let t = HIT_FLASH_TIME; t < HURT_STUN; t += 0.01) {
      const a = playerAlpha(afterHit(t));
      expect(a.alpha).toBe(1);
      expect(a.flash).toBe(0);
    }
  });

  it("in 'dying'/'over' immer deckend – auch mit eingefrorenem stun/invuln (kein Flackern)", () => {
    for (const phase of ["dying", "over"]) {
      for (let t = 0; t < 2; t += 0.013) {
        const a = playerAlpha(afterHit(t, { phase, stun: HURT_STUN, invuln: HURT_INVULN }));
        expect(a.alpha).toBe(1);
        expect(a.dashGlow).toBe(0);
      }
      const late = playerAlpha(afterHit(1, { phase, stun: HURT_STUN, invuln: 0.9 }));
      expect(late.flash).toBe(0);
    }
    // letzter, tödlicher Treffer: der Flash des Treffer-Frames bleibt erhalten
    expect(playerAlpha(afterHit(0, { phase: "dying", stun: HURT_STUN })).flash).toBeCloseTo(HIT_FLASH_MAX, 12);
  });

  it("Unverwundbarkeits-Phase nach Treffer: Puls in [0,6; 1], erreicht beide Enden, startet deckend", () => {
    const first = playerAlpha(afterHit(HURT_STUN + 1e-6));
    expect(first.alpha).toBeCloseTo(1, 4);
    let min = 1;
    let max = 0;
    for (let t = HURT_STUN + 1e-6; t < HURT_INVULN - 1e-6; t += 0.001) {
      const a = playerAlpha(afterHit(t));
      expect(a.alpha).toBeGreaterThanOrEqual(INVULN_PULSE_MIN - 1e-12);
      expect(a.alpha).toBeLessThanOrEqual(1);
      expect(a.dashGlow).toBe(0);
      expect(a.flash).toBe(0);
      min = Math.min(min, a.alpha);
      max = Math.max(max, a.alpha);
    }
    expect(min).toBeLessThan(0.65);
    expect(max).toBeGreaterThan(0.99);
  });

  it("Puls ca. 6 Hz (Periode 1/6 s) und klingt zum Ende der Frist auf deckend aus", () => {
    const t0 = HURT_STUN + 0.2;
    const a = playerAlpha(afterHit(t0)).alpha;
    const b = playerAlpha(afterHit(t0 + 1 / 6)).alpha;
    expect(b).toBeCloseTo(a, 6);
    expect(playerAlpha(afterHit(HURT_STUN + 1 / 12)).alpha).toBeCloseTo(INVULN_PULSE_MIN, 6); // Halbperiode = Minimum
    expect(playerAlpha(afterHit(HURT_INVULN - 0.001)).alpha).toBeGreaterThan(0.99);
  });

  it("Dash-Gnadenfrist ohne Treffer: alpha 1, dashGlow > 0 (kein Schaden-Blinken)", () => {
    for (const invuln of [DASH_GRACE, 0.3, 0.05]) {
      const a = playerAlpha({ ...base, invuln });
      expect(a.alpha).toBe(1);
      expect(a.dashGlow).toBeGreaterThan(0);
      expect(a.flash).toBe(0);
    }
    expect(playerAlpha({ ...base, invuln: DASH_GRACE }).dashGlow).toBe(1);
    expect(playerAlpha({ ...base, invuln: DASH_GRACE / 2 }).dashGlow).toBeCloseTo(0.5, 12);
    // Treffer liegt lange zurück (Zeitstempel veraltet): zählt nicht mehr als Schadensquelle
    expect(playerAlpha({ ...base, invuln: 0.3, hurtT: base.time - HURT_INVULN - 5 }).dashGlow).toBeGreaterThan(0);
  });

  it("Dash und Turbo: deckend mit vollem Randschein, auch wenn der Treffer noch läuft", () => {
    expect(playerAlpha({ ...base, dashT: 0.2, invuln: 0 })).toEqual({ alpha: 1, flash: 0, dashGlow: 1 });
    expect(playerAlpha({ ...base, turbo: 3, invuln: 3 })).toEqual({ alpha: 1, flash: 0, dashGlow: 1 });
    const hitThenDash = playerAlpha(afterHit(0.8, { dashT: 0.2 }));
    expect(hitThenDash.alpha).toBe(1);
    expect(hitThenDash.dashGlow).toBe(1);
  });

  it("ohne Unverwundbarkeit: alpha 1, kein Flash, kein Glow; unbekannter Treffer-Zeitstempel erzeugt kein NaN", () => {
    expect(playerAlpha(base)).toEqual({ alpha: 1, flash: 0, dashGlow: 0 });
    expect(playerAlpha({ ...base, hurtT: NaN, invuln: 1 }).alpha).toBe(1);
    const a = playerAlpha({ ...base, hurtT: -Infinity, stun: 0.3, invuln: 1 });
    expect(Number.isNaN(a.alpha) || Number.isNaN(a.flash) || Number.isNaN(a.dashGlow)).toBe(false);
  });

  it("wiederverwendbares Ergebnisobjekt (keine Allokation pro Frame)", () => {
    const out = { alpha: 0.2, flash: 0.9, dashGlow: 0.4 };
    expect(playerAlpha(base, out)).toBe(out);
    expect(out).toEqual({ alpha: 1, flash: 0, dashGlow: 0 });
  });
});

// --- Spieler-Transparenz in der echten Spielschleife -----------------------------------------------------------------------
// Die Uhr (Seitenzeit) und die Sim-Timer laufen nicht gleich: Nach dem Treffer steht die Sim 0,07 s (Hitstop, Uhr läuft),
// in Slow-Mo zählen stun/invuln nur mit SLOWMO_FACTOR herunter. Die Tests rechnen deshalb mit der echten Sim und der
// Schleife aus game.ts statt mit synchron berechneten Timern.

describe("playerAlpha: Treffer in der echten Spielschleife (Hitstop, Slow-Mo, Bildraten)", () => {
  interface HitFrame {
    /** Uhr seit dem Treffer. */
    since: number;
    stun: number;
    invuln: number;
    dashT: number;
    alpha: number;
    flash: number;
    dashGlow: number;
  }

  const CLOCK0 = 50;

  /** Frische Sim ohne Gegner/Spawns (isoliert den Treffer); `hurt()` setzt invuln/stun wie ein Hindernis-Treffer. */
  function isolatedSim(slowmo: boolean): Sim {
    const sim = new Sim({ mode: "world", world: "wien", character: "fred", seed: 1234 }, WORLDS);
    sim.begin();
    sim.ents = [];
    (sim.spawner as unknown as { cursor: number }).cursor = 1e9;
    if (slowmo) sim.player.slowmo = 60;
    return sim;
  }

  /**
   * Spielschleife wie game.ts: Uhr läuft pro Bild; nach "hurt" steht die Sim 0,07 s (Hitstop) ohne Timer-Abzug, danach feste
   * 120-Hz-Schritte. `onFrame` darf nach jedem Bild den Zustand verändern (z. B. Dash auslösen). Läuft, bis `until` wahr ist.
   */
  function playLoop(
    sim: Sim,
    frameDt: number,
    until: (f: HitFrame) => boolean,
    onFrame?: (f: HitFrame) => void,
    maxFrames = 900,
  ): { frames: HitFrame[]; hurts: number } {
    let time = CLOCK0;
    let acc = 0;
    let hitstop = 0;
    let hurtT = -Infinity;
    let hurts = 0;
    const frames: HitFrame[] = [];
    const consume = (): void => {
      for (const ev of sim.events) {
        if (ev.type === "hurt") {
          hurtT = time;
          hitstop = Math.max(hitstop, 0.07);
          hurts += 1;
        }
      }
      sim.events.length = 0;
    };
    const record = (): HitFrame => {
      const p = sim.player;
      const a = playerAlpha({ phase: sim.phase, stun: p.stun, invuln: p.invuln, dashT: p.dashT, turbo: p.turbo, time, hurtT });
      const f = { since: time - hurtT, stun: p.stun, invuln: p.invuln, dashT: p.dashT, alpha: a.alpha, flash: a.flash, dashGlow: a.dashGlow };
      frames.push(f);
      return f;
    };
    consume(); // Ereignisse von hurt()/begin() vor dem ersten Bild
    for (let i = 0; i < maxFrames; i += 1) {
      time += frameDt;
      if (hitstop > 0) {
        hitstop -= frameDt;
      } else {
        acc += frameDt;
        while (acc >= FIXED_DT) {
          acc -= FIXED_DT;
          sim.step(FIXED_DT, NO_INPUT);
          consume();
        }
      }
      const f = record();
      onFrame?.(f);
      if (until(f)) break;
    }
    return { frames, hurts };
  }

  /** Treffer, dann Bilder bis die Unverwundbarkeit abgelaufen ist. */
  function playHit(frameDt: number, slowmo: boolean): HitFrame[] {
    const sim = isolatedSim(slowmo);
    sim.hurt("test");
    const { frames, hurts } = playLoop(sim, frameDt, (f) => f.invuln <= 0);
    expect(hurts).toBe(1); // genau ein Treffer, keine Folge-Treffer oder Schildbrüche im Fenster
    expect(sim.phase).toBe("running");
    return frames;
  }

  const cases: Array<[string, number, boolean]> = [
    ["60 fps", 1 / 60, false],
    ["60 fps, Slow-Mo", 1 / 60, true],
    ["144 fps", 1 / 144, false],
    ["144 fps, Slow-Mo", 1 / 144, true],
    ["30 fps", 1 / 30, false],
    ["30 fps, Slow-Mo", 1 / 30, true],
  ];

  for (const [name, frameDt, slowmo] of cases) {
    it(`${name}: Puls startet deckend am Stun-Ende, nie Cyan-Glow, Alpha bleibt in [0,6; 1] bis zum Ende der Frist`, () => {
      const frames = playHit(frameDt, slowmo);
      const ts = slowmo ? SLOWMO_FACTOR : 1;
      // Treffer-Frame: deckend mit vollem Flash (Stun läuft)
      expect(frames[0].stun).toBeGreaterThan(0);
      // Stun-Ende: erster Frame ohne Stun
      const iEnd = frames.findIndex((f) => f.stun <= 0);
      expect(iEnd).toBeGreaterThan(0);
      const end = frames[iEnd];
      // Setup-Kontrolle: Uhr und Timer sind tatsächlich verschoben (Hitstop 0,07 s bzw. Slow-Mo 1/0,62)
      expect(end.since - HURT_STUN).toBeGreaterThan(0.05);
      expect(end.since).toBeGreaterThan(0.07 + HURT_STUN / ts - 2 * frameDt - 1e-9);
      // Während des Stuns: deckend. Beim Stun-Ende kein Sprung zum Puls-Minimum (vorher 1,0 → 0,6).
      for (let i = 0; i < iEnd; i += 1) expect(frames[i].alpha).toBe(1);
      const uMax = (frameDt + FIXED_DT) * ts; // Phase im ersten Frame ohne Stun höchstens ein Frame plus Überlauf
      const bound = 1 - (1 - INVULN_PULSE_MIN) * (1 - (0.5 + 0.5 * Math.cos(uMax * INVULN_PULSE_HZ * Math.PI * 2)));
      expect(end.alpha).toBeGreaterThanOrEqual(bound - 1e-9);
      expect(end.alpha).toBeGreaterThan(0.85);
      // bis zum Ende der Frist: nie Dash-Glow, Alpha im Pulsbereich, kein Flash nach 0,15 s
      let min = 1;
      for (let i = iEnd; i < frames.length; i += 1) {
        const f = frames[i];
        if (f.invuln <= 0) break;
        expect(f.dashGlow).toBe(0);
        expect(f.alpha).toBeGreaterThanOrEqual(INVULN_PULSE_MIN - 1e-9);
        expect(f.alpha).toBeLessThanOrEqual(1);
        expect(f.flash).toBe(0);
        min = Math.min(min, f.alpha);
      }
      expect(min).toBeLessThan(0.75); // der Puls ist wirklich da (bei 30 fps abgetastet, daher nicht exakt 0,6)
      // Frist abgelaufen: deckend, kein Glow
      const last = frames[frames.length - 1];
      expect(last.invuln).toBe(0);
      expect(last.alpha).toBe(1);
      expect(last.dashGlow).toBe(0);
    });
  }

  it("Flash nur in den ersten 0,15 s der Uhr, mit Stun, 0,7 → 0 (auch bei Hitstop)", () => {
    for (const slowmo of [false, true]) {
      const frames = playHit(1 / 60, slowmo);
      for (const f of frames) {
        if (f.since < HIT_FLASH_TIME) {
          expect(f.flash).toBeGreaterThan(0);
          expect(f.flash).toBeLessThanOrEqual(HIT_FLASH_MAX);
        } else {
          expect(f.flash).toBe(0);
        }
      }
    }
  });

  it("die Zuordnung 'Treffer' hält bis zum letzten Timer-Rest, auch mit 0,62-facher Timer-Rate über 0,07 s Hitstop hinaus", () => {
    // Zustand wie in der Schleife: Treffer, 0,07 s Hitstop ohne Abzug, dann Timer mit SLOWMO_FACTOR gegen die Uhr
    for (const factor of [1, SLOWMO_FACTOR]) {
      let worst = 0;
      for (let clock = 0.07; clock < 0.07 + HURT_INVULN / factor; clock += 0.003) {
        const invuln = Math.max(0, HURT_INVULN - (clock - 0.07) * factor);
        const stun = Math.max(0, HURT_STUN - (clock - 0.07) * factor);
        const a = playerAlpha({ phase: "running", stun, invuln, dashT: 0, turbo: 0, time: CLOCK0 + clock, hurtT: CLOCK0 });
        expect(a.dashGlow).toBe(0);
        if (stun <= 0 && invuln > 0) worst = Math.max(worst, 1 - a.alpha);
      }
      expect(worst).toBeLessThanOrEqual(1 - INVULN_PULSE_MIN + 1e-9);
    }
  });

  it("Dash-Ende nach einem älteren Treffer: Gnadenfrist zeigt Cyan statt Schaden-Puls", () => {
    const sim = isolatedSim(false);
    sim.hurt("test");
    let dashed = false;
    let dashStart = 0;
    let graceSeen = false;
    const { frames } = playLoop(
      sim,
      1 / 60,
      (f) => graceSeen && f.invuln <= 0,
      (f) => {
        // 1,0 s nach Ablauf der Treffer-Frist (Uhr ≈ 2,7 s nach dem Treffer) beginnt ein kurzer Dash
        if (!dashed && f.invuln <= 0 && f.since > HURT_INVULN + 1.0) {
          sim.player.dashT = 0.05;
          dashed = true;
          dashStart = f.since;
        } else if (dashed && f.dashT <= 0 && f.invuln > 0) {
          graceSeen = true;
        }
      },
    );
    expect(dashed).toBe(true);
    const grace = frames.filter((f) => f.since > dashStart && f.dashT <= 0 && f.invuln > 0);
    expect(grace.length).toBeGreaterThan(15); // 0,45 s Gnadenfrist bei 60 fps ≈ 27 Bilder
    for (const f of grace) {
      expect(f.alpha).toBe(1);
      expect(f.dashGlow).toBeGreaterThan(0);
    }
  });

  it("Zuordnung 'Treffer' endet spätestens nach HURT_INVULN / SLOWMO_FACTOR + Reserve (Gnadenfrist danach immer Cyan)", () => {
    const state = (since: number, invuln: number): PlayerAlphaState => ({
      phase: "running",
      stun: 0,
      invuln,
      dashT: 0,
      turbo: 0,
      time: CLOCK0 + since,
      hurtT: CLOCK0,
    });
    const limit = HURT_INVULN / SLOWMO_FACTOR + HURT_CLOCK_SLACK;
    for (const invuln of [DASH_GRACE, 0.2, 0.01]) {
      const late = playerAlpha(state(limit + 0.01, invuln));
      expect(late.alpha).toBe(1);
      expect(late.dashGlow).toBeGreaterThan(0);
    }
    // Dash-Gnadenfrist (0,45 s) deutlich nach dem Treffer, aber noch in der Slow-Mo-Reserve: Cyan statt Puls
    const dashLater = playerAlpha(state(2.4, DASH_GRACE));
    expect(dashLater.alpha).toBe(1);
    expect(dashLater.dashGlow).toBe(1);
    // Unverwundbarkeit über HURT_INVULN (Turbo-Rest) kann nie aus einem Treffer stammen
    const turboRest = playerAlpha(state(0.2, HURT_INVULN + 0.5));
    expect(turboRest.alpha).toBe(1);
    expect(turboRest.dashGlow).toBe(1);
    // Schild-Bruch (1,1 s) lange nach dem Treffer: Cyan
    expect(playerAlpha(state(2.2, 1.1)).dashGlow).toBe(1);
    // Zeitstempel aus der Zukunft (Uhr zurückgesetzt) ist kein Treffer
    const future = playerAlpha({ ...state(0, 0.3), hurtT: CLOCK0 + 40 });
    expect(future.alpha).toBe(1);
    expect(future.dashGlow).toBeGreaterThan(0);
  });
});

// --- Squash & Stretch -----------------------------------------------------------------------------------------------------

describe("squashFor", () => {
  const kinds: SquashKind[] = ["land", "stomp", "jump"];
  const impacts = [0, 200, 300, 600, 900, 1200, 1500, 2500];

  it("Landungs-Amplitude clamp(0,05 + (v-300)/1200*0,12, 0,05, 0,17), Dauer 0,12–0,18 s", () => {
    expect(landSquashAmplitude(0)).toBeCloseTo(0.05, 12);
    expect(landSquashAmplitude(300)).toBeCloseTo(0.05, 12);
    expect(landSquashAmplitude(900)).toBeCloseTo(0.11, 12);
    expect(landSquashAmplitude(1500)).toBeCloseTo(0.17, 12);
    expect(landSquashAmplitude(5000)).toBeCloseTo(0.17, 12);
    expect(squashDuration("land", 300)).toBeCloseTo(0.12, 12);
    expect(squashDuration("land", 1500)).toBeCloseTo(0.18, 12);
    for (const v of impacts) {
      expect(squashDuration("land", v)).toBeGreaterThanOrEqual(0.12 - 1e-12);
      expect(squashDuration("land", v)).toBeLessThanOrEqual(0.18 + 1e-12);
    }
    expect(squashDuration("jump", 0)).toBeCloseTo(0.09, 12);
  });

  it("Höhenfaktor in [0.78, 1.1], Breite in [0.9, 1.18] – für alle Arten, Aufpralle und Zeitpunkte", () => {
    let bad = 0;
    let minSy = 9;
    let maxSy = 0;
    for (const kind of kinds) {
      for (const v of impacts) {
        for (const reduced of [false, true]) {
          for (let t = -0.05; t < 0.3; t += 0.001) {
            const s = squashFor(t, kind, v, reduced);
            if (s.sy < 0.78 - 1e-12 || s.sy > 1.1 + 1e-12 || s.sx < 0.9 || s.sx > 1.18 + 1e-12) bad += 1;
            minSy = Math.min(minSy, s.sy);
            maxSy = Math.max(maxSy, s.sy);
          }
        }
      }
    }
    expect(bad).toBe(0);
    expect(minSy).toBeCloseTo(0.78, 2); // Stampfer schöpft die Untergrenze aus
    expect(maxSy).toBeCloseTo(1.07, 2); // Absprung die Obergrenze
  });

  it("stetig (Sprünge < 0,01 pro Millisekunde), startet und endet bei 1, davor/danach exakt 1", () => {
    for (const kind of kinds) {
      for (const v of [300, 1500]) {
        const dur = squashDuration(kind, v);
        let prev = squashFor(0, kind, v, false);
        expect(prev).toEqual({ sx: 1, sy: 1 });
        for (let t = 0.001; t <= dur + 0.01; t += 0.001) {
          const s = squashFor(t, kind, v, false);
          expect(Math.abs(s.sy - prev.sy)).toBeLessThan(0.01);
          expect(Math.abs(s.sx - prev.sx)).toBeLessThan(0.01);
          prev = { sx: s.sx, sy: s.sy };
        }
        expect(squashFor(dur, kind, v, false)).toEqual({ sx: 1, sy: 1 });
        expect(squashFor(dur + 1, kind, v, false)).toEqual({ sx: 1, sy: 1 });
        expect(squashFor(-0.1, kind, v, false)).toEqual({ sx: 1, sy: 1 });
        expect(squashFor(NaN, kind, v, false)).toEqual({ sx: 1, sy: 1 });
      }
    }
  });

  it("stärkerer Aufprall liefert stärkeren Squash; Stampfer am stärksten", () => {
    const peak = (kind: SquashKind, v: number): number => {
      let m = 1;
      for (let t = 0; t < 0.2; t += 0.001) m = Math.min(m, squashFor(t, kind, v, false).sy);
      return m;
    };
    let last = 2;
    for (const v of [300, 600, 900, 1200, 1500]) {
      const p = peak("land", v);
      expect(p).toBeLessThan(last);
      last = p;
    }
    expect(peak("land", 300)).toBeCloseTo(0.95, 2);
    expect(peak("land", 1500)).toBeCloseTo(0.83, 2);
    expect(peak("stomp", 0)).toBeCloseTo(0.78, 2);
    expect(peak("stomp", 0)).toBeLessThan(peak("land", 1500));
  });

  it("Absprung: kurzer Stretch (sy ≈ 1,07, sx ≈ 0,94) in 0,09 s", () => {
    let maxSy = 1;
    let minSx = 1;
    for (let t = 0; t < 0.09; t += 0.0005) {
      const s = squashFor(t, "jump", 0, false);
      maxSy = Math.max(maxSy, s.sy);
      minSx = Math.min(minSx, s.sx);
    }
    expect(maxSy).toBeCloseTo(1.07, 2);
    expect(minSx).toBeCloseTo(0.94, 2);
  });

  it("X-Änderung = 0,8 × Y-Änderung (Volumenerhalt), gegenläufig", () => {
    for (const kind of kinds) {
      for (let t = 0.002; t < 0.17; t += 0.007) {
        const s = squashFor(t, kind, 900, false);
        expect(s.sx - 1).toBeCloseTo(-0.8 * (s.sy - 1), 12);
      }
    }
  });

  it("'Weniger Bewegung': halbe Amplitude", () => {
    for (const kind of kinds) {
      for (let t = 0.002; t < 0.17; t += 0.007) {
        const full = squashFor(t, kind, 900, false);
        const half = squashFor(t, kind, 900, true);
        expect(half.sy - 1).toBeCloseTo((full.sy - 1) / 2, 12);
        expect(half.sx - 1).toBeCloseTo((full.sx - 1) / 2, 12);
      }
    }
  });

  it("wiederverwendbares Ergebnisobjekt", () => {
    const out = { sx: 5, sy: 5 };
    expect(squashFor(0.05, "land", 800, false, out)).toBe(out);
    expect(out.sy).toBeLessThan(1);
  });
});

// --- Schatten -------------------------------------------------------------------------------------------------------------

describe("shadowRanges", () => {
  const pit = (x0: number, x1: number) => ({ x0, x1 });

  it("ohne Gruben: das ganze Intervall; leeres/umgekehrtes Intervall: leer", () => {
    expect(shadowRanges(100, 200, [])).toEqual([100, 200]);
    expect(shadowRanges(100, 100, [])).toEqual([]);
    expect(shadowRanges(200, 100, [pit(0, 1000)])).toEqual([]);
  });

  it("Grube außerhalb oder nur berührend: keine Änderung", () => {
    expect(shadowRanges(100, 200, [pit(0, 100), pit(200, 300), pit(400, 500)])).toEqual([100, 200]);
  });

  it("Grube deckt alles ab: leer", () => {
    expect(shadowRanges(100, 200, [pit(50, 250)])).toEqual([]);
    expect(shadowRanges(100, 200, [pit(100, 200)])).toEqual([]);
  });

  it("Grube in der Mitte: geteilt", () => {
    expect(shadowRanges(100, 200, [pit(130, 160)])).toEqual([100, 130, 160, 200]);
  });

  it("Grube überdeckt eine Kante: verkürzt", () => {
    expect(shadowRanges(100, 200, [pit(50, 140)])).toEqual([140, 200]);
    expect(shadowRanges(100, 200, [pit(160, 300)])).toEqual([100, 160]);
  });

  it("mehrere Gruben (unsortiert, überlappend, direkt aneinander)", () => {
    expect(shadowRanges(0, 1000, [pit(600, 700), pit(100, 200), pit(150, 250), pit(300, 300), pit(250, 300)])).toEqual([0, 100, 300, 600, 700, 1000]);
    expect(shadowRanges(0, 100, [pit(10, 20), pit(20, 30), pit(40, 50)])).toEqual([0, 10, 30, 40, 50, 100]);
    expect(shadowRanges(0, 100, [pit(-5, 10), pit(90, 120), pit(40, 60)])).toEqual([10, 40, 60, 90]);
  });

  it("zufällige Gruben: Intervalle sortiert, disjunkt, innerhalb, nie über einer Grube; Fläche stimmt", () => {
    const rnd = lcg(7);
    const out: number[] = [];
    for (let n = 0; n < 300; n += 1) {
      const pits = Array.from({ length: Math.floor(rnd() * 6) }, () => {
        const a = rnd() * 600;
        return pit(a, a + rnd() * 120);
      });
      const x0 = rnd() * 200;
      const x1 = x0 + 20 + rnd() * 300;
      shadowRanges(x0, x1, pits, out);
      expect(out.length % 2).toBe(0);
      let prevEnd = -Infinity;
      for (let i = 0; i < out.length; i += 2) {
        expect(out[i]).toBeGreaterThanOrEqual(x0);
        expect(out[i + 1]).toBeLessThanOrEqual(x1);
        expect(out[i + 1]).toBeGreaterThan(out[i]);
        expect(out[i]).toBeGreaterThanOrEqual(prevEnd);
        prevEnd = out[i + 1];
      }
      // Stichprobe: ein Punkt liegt genau dann in einem Intervall, wenn er in [x0,x1] und in keiner Grube liegt
      for (let k = 0; k < 20; k += 1) {
        const x = x0 + ((k + 0.5) / 20) * (x1 - x0);
        const inRange = out.some((v, i) => i % 2 === 0 && x >= v && x <= out[i + 1]);
        const inPit = pits.some((p) => x > p.x0 && x < p.x1);
        expect(inRange).toBe(!inPit);
      }
    }
  });

  it("verwendet `out` wieder (wird geleert)", () => {
    const out = [9, 9, 9, 9, 9];
    expect(shadowRanges(0, 10, [], out)).toBe(out);
    expect(out).toEqual([0, 10]);
  });

  it("overPit", () => {
    expect(overPit(150, [pit(100, 200)])).toBe(true);
    expect(overPit(100, [pit(100, 200)])).toBe(false);
    expect(overPit(250, [pit(100, 200)])).toBe(false);
    expect(overPit(5, [])).toBe(false);
  });
});

describe("shadowShape", () => {
  const P = PLAYER_SHADOW;

  it("entspricht am Boden und in der Luft der bisherigen Spielerformel (46k+6, 9k+2, 0,32k)", () => {
    for (const h of [0, 60, 150, 250, 336, 400, 800]) {
      const k = Math.min(1, Math.max(0.2, 1 - h / 420));
      const s = shadowShape(h, P.alpha, P.rx, P.ry, P.reach);
      expect(s.rx).toBeCloseTo(46 * k + 6, 1);
      expect(s.ry).toBeCloseTo(9 * k + 2, 1);
      expect(s.alpha).toBeCloseTo(0.32 * k, 12);
    }
  });

  it("je höher, desto kleiner und blasser, nie unter dem Mindestfaktor; Gegner mit eigenen Maßen", () => {
    let last = shadowShape(0, 0.28, 40, 8, 320);
    for (let h = 20; h <= 600; h += 20) {
      const s = shadowShape(h, 0.28, 40, 8, 320);
      expect(s.alpha).toBeLessThanOrEqual(last.alpha);
      expect(s.rx).toBeLessThanOrEqual(last.rx);
      last = s;
    }
    expect(last.alpha).toBeCloseTo(0.28 * 0.2, 12);
    expect(shadowShape(0, 0.28, 40, 8, 320).rx).toBeCloseTo(40, 12);
    // negative Höhe (Decke/Gravitationswelt) und ungültige Werte
    expect(shadowShape(-100, 0.3, 50, 10, 400).alpha).toBeCloseTo(0.3 * 0.75, 12);
    expect(shadowShape(NaN, 0.3, 50, 10, 400).alpha).toBeCloseTo(0.3, 12);
  });
});

// --- Geschwindigkeits-Streifen --------------------------------------------------------------------------------------------

describe("Geschwindigkeits-Streifen", () => {
  it("Stärke 0 unter Tempo 520, 1 ab 1100, dazwischen monoton", () => {
    expect(speedLineIntensity(0)).toBe(0);
    expect(speedLineIntensity(470)).toBe(0);
    expect(speedLineIntensity(519.999)).toBe(0);
    expect(speedLineIntensity(SPEED_LINE_START)).toBe(0);
    expect(speedLineIntensity(SPEED_LINE_FULL)).toBe(1);
    expect(speedLineIntensity(1180)).toBe(1);
    expect(speedLineIntensity(5000)).toBe(1);
    expect(speedLineIntensity(NaN)).toBe(0);
    let last = 0;
    for (let v = 500; v <= 1200; v += 5) {
      const k = speedLineIntensity(v);
      expect(k).toBeGreaterThanOrEqual(last);
      last = k;
    }
  });

  it("y konstant zwischen zwei Umbrüchen, x stetig; Umbruch nur außerhalb des Bildes", () => {
    const dt = 1 / 120;
    let bad = 0;
    for (let i = 0; i < SPEED_LANES; i += 1) {
      let prev = speedLaneAt(i, 0, 900);
      let wraps = 0;
      for (let step = 1; step < 120 * 40; step += 1) {
        const cur = speedLaneAt(i, step * dt, 900);
        const dx = cur.x - prev.x;
        if (dx > 100) {
          // Umbruch (x springt nach rechts): davor links, danach rechts vollständig außerhalb des Bildes
          wraps += 1;
          if (prev.x + prev.len > 0 || cur.x < VIEW_W) bad += 1;
        } else if (cur.y !== prev.y || dx >= 0 || -dx > 2200 * dt) {
          bad += 1; // y ändert sich nur beim Umbruch; sonst stetig nach links, höchstens Bahngeschwindigkeit
        }
        prev = cur;
      }
      expect(wraps).toBeGreaterThan(5);
    }
    expect(bad).toBe(0);
  });

  it("y wechselt beim Umbruch (die Bahn bekommt eine neue Höhe), bleibt im Bild und ist deterministisch", () => {
    const ys = new Set<number>();
    let prev = speedLaneAt(3, 0, 900);
    for (let step = 1; step < 240 * 60; step += 1) {
      const cur = speedLaneAt(3, step / 240, 900);
      if (cur.x - prev.x > 100) ys.add(cur.y);
      expect(cur.y).toBeGreaterThanOrEqual(48);
      expect(cur.y).toBeLessThanOrEqual(VIEW_H - 48);
      prev = cur;
    }
    expect(ys.size).toBeGreaterThan(3);
    expect(speedLaneAt(5, 12.34, 900)).toEqual(speedLaneAt(5, 12.34, 900));
  });

  it("x hängt nicht vom Tempo ab (Tempowechsel erzeugen keinen Sprung); Länge wächst mit dem Tempo und bleibt <= Maximum", () => {
    for (let i = 0; i < SPEED_LANES; i += 1) {
      expect(speedLaneAt(i, 7.7, 600).x).toBe(speedLaneAt(i, 7.7, 1180).x);
      expect(speedLaneAt(i, 7.7, 600).y).toBe(speedLaneAt(i, 7.7, 1180).y);
      let last = 0;
      for (const v of [0, 300, 600, 900, 1100, 1400]) {
        const len = speedLaneAt(i, 1, v).len;
        expect(len).toBeGreaterThanOrEqual(last);
        expect(len).toBeLessThanOrEqual(SPEED_LANE_MAX_LEN);
        last = len;
      }
      expect(speedLaneAt(i, 1, 99999).len).toBeLessThanOrEqual(SPEED_LANE_MAX_LEN);
      expect(speedLaneAt(i, 1, 1180).len).toBeGreaterThan(speedLaneAt(i, 1, 600).len);
    }
  });

  it("Bahnen werden mit steigender Stärke nacheinander eingeblendet; unter Tempo 520 alle unsichtbar", () => {
    for (let i = 0; i < SPEED_LANES; i += 1) {
      expect(speedLaneAt(i, 3, 500).a).toBe(0);
      expect(speedLaneAt(i, 3, SPEED_LINE_FULL).a).toBe(1);
      expect(speedLaneAt(i, 3, 3000).a).toBe(1);
    }
    expect(speedLaneAt(SPEED_LANES, 3, 3000).a).toBe(0);
    expect(speedLaneAt(-1, 3, 3000).a).toBe(0);
    const visible = (v: number): number => {
      let n = 0;
      for (let i = 0; i < SPEED_LANES; i += 1) if (speedLaneAt(i, 3, v).a > 0) n += 1;
      return n;
    };
    expect(visible(600)).toBeLessThanOrEqual(visible(800));
    expect(visible(800)).toBeLessThanOrEqual(visible(1000));
    expect(visible(1100)).toBe(SPEED_LANES);
  });

  it("helle Welten (Oper, Prater, Wachau) bekommen dunkle Linien mit Gegenkontur, alle anderen weiße", () => {
    expect([...LIGHT_WORLDS].sort()).toEqual(["oper", "prater", "wachau"]);
    for (const id of WORLD_IDS) {
      const st = speedLineStyle(id);
      if (LIGHT_WORLDS.has(id)) {
        expect(st.color).not.toBe("#ffffff");
        expect(st.outline).toContain("255,255,255");
      } else {
        expect(st.color).toBe("#ffffff");
      }
      expect(st.alpha).toBeGreaterThan(0);
    }
    expect(speedLineStyle("oper")).toBe(speedLineStyle("prater"));
    expect(speedLineStyle("unbekannt").color).toBe("#ffffff");
  });
});

// --- Tod-Pose -------------------------------------------------------------------------------------------------------------

describe("deathPose", () => {
  it("Kippen: rot(0) = 0, rot(0,5) = -70°, monoton fallend, danach konstant", () => {
    expect(deathPose(0, false).rot).toBe(0);
    expect(deathPose(0, false).dx).toBe(0);
    expect((deathPose(DEATH_TIP_TIME, false).rot * 180) / Math.PI).toBeCloseTo(-70, 9);
    expect(deathPose(DEATH_TIP_TIME, false).rot).toBeCloseTo(DEATH_TIP_ANGLE, 12);
    let last = 0;
    for (let t = 0; t <= DEATH_TIP_TIME; t += 0.005) {
      const r = deathPose(t, false).rot;
      expect(r).toBeLessThanOrEqual(last);
      last = r;
    }
    expect(deathPose(3, false).rot).toBeCloseTo(DEATH_TIP_ANGLE, 12);
    expect(deathPose(-1, false).rot).toBe(0);
    // ease-out: die erste Hälfte der Zeit legt mehr als die Hälfte des Winkels zurück
    expect(deathPose(DEATH_TIP_TIME / 2, false).rot).toBeLessThan(DEATH_TIP_ANGLE / 2);
  });

  it("25 px Rutsch nach hinten (monoton)", () => {
    expect(deathPose(DEATH_TIP_TIME, false).dx).toBeCloseTo(DEATH_SLIDE, 12);
    expect(deathPose(2, false).dx).toBeCloseTo(-25, 12);
    let last = 0;
    for (let t = 0; t < 1; t += 0.01) {
      const d = deathPose(t, false).dx;
      expect(d).toBeLessThanOrEqual(last);
      last = d;
    }
  });

  it("höchstens 4 Orbit-Sternchen, erst wenn die Figur liegt, nie weniger als zuvor", () => {
    expect(DEATH_ORBIT_MAX).toBe(4);
    expect(ORBIT_MAX).toBe(4);
    expect(deathPose(0.1, false).orbit).toBe(0);
    let last = 0;
    let max = 0;
    for (let t = 0; t < 5; t += 0.01) {
      const o = deathPose(t, false).orbit;
      expect(Number.isInteger(o)).toBe(true);
      expect(o).toBeLessThanOrEqual(4);
      expect(o).toBeGreaterThanOrEqual(last);
      last = o;
      max = Math.max(max, o);
    }
    expect(max).toBe(4);
    expect(deathPose(1.25, false).orbit).toBe(4);
  });

  it("'Weniger Bewegung': nur Kippen – keine Sternchen, kein Rutsch", () => {
    for (let t = 0; t < 3; t += 0.01) {
      const r = deathPose(t, true);
      expect(r.orbit).toBe(0);
      expect(r.dx).toBe(0);
      expect(r.rot).toBeCloseTo(deathPose(t, false).rot, 12);
    }
    expect(deathPose(DEATH_TIP_TIME, true).rot).toBeCloseTo(DEATH_TIP_ANGLE, 12);
  });

  it("ungültige Zeit: neutrale Pose; wiederverwendbares Ergebnisobjekt", () => {
    expect(deathPose(NaN, false)).toEqual({ rot: 0, dx: 0, orbit: 0 });
    const out = { rot: 1, dx: 1, orbit: 1 };
    expect(deathPose(0.2, false, out)).toBe(out);
  });
});

// --- Popups ---------------------------------------------------------------------------------------------------------------

/** Ganze Textbox liegt in der sicheren Zone. */
function inZone(q: PopupRect): boolean {
  return q.x - q.w / 2 >= POPUP_ZONE.x0 - 1e-9 && q.x + q.w / 2 <= POPUP_ZONE.x1 + 1e-9 && q.y - q.h / 2 >= POPUP_ZONE.y0 - 1e-9 && q.y + q.h / 2 <= POPUP_ZONE.y1 + 1e-9;
}

function overlap(a: PopupRect, b: PopupRect): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 1e-9 && Math.abs(a.y - b.y) < (a.h + b.h) / 2 - 1e-9;
}

function rect(x: number, y: number, w: number, h: number, life = 0): PopupRect {
  return { active: true, x, y, w, h, life };
}

describe("placePopup", () => {
  it("klemmt die ganze Box in die sichere Zone (alle Ränder, HUD-Panel links oben bleibt frei)", () => {
    const w = 160;
    const h = 34;
    for (const [x, y] of [[-500, -500], [5000, 5000], [0, 0], [VIEW_W, VIEW_H], [640, 10], [640, 700], [150, 125], [NaN, NaN]]) {
      const p = placePopup([], x, y, w, h);
      const r = rect(p.x, p.y, w, h);
      expect(inZone(r)).toBe(true);
      expect(p.replace).toBe(-1);
      if (r.x - w / 2 < 330) expect(r.y - h / 2).toBeGreaterThanOrEqual(142 - 1e-9);
    }
    // schon gültige Position bleibt unverändert
    expect(placePopup([], 640, 300, w, h)).toEqual({ x: 640, y: 300, replace: -1 });
  });

  it("weicht aus: drei Stapelplätze (Wunschplatz, oben, unten), Abstand = Höhe × 1,1, nie überlappend", () => {
    const h = 34;
    const w = 160;
    const active: PopupRect[] = [];
    const first = placePopup(active, 640, 300, w, h);
    active.push(rect(first.x, first.y, w, h, 0.3));
    const second = placePopup(active, 640, 300, w, h);
    expect(second.y).toBeCloseTo(300 - h * 1.1, 9); // oberhalb des Stapels
    active.push(rect(second.x, second.y, w, h, 0.2));
    const third = placePopup(active, 640, 300, w, h);
    expect(third.y).toBeCloseTo(300 + h * 1.1, 9); // unterhalb
    active.push(rect(third.x, third.y, w, h, 0.1));
    for (let i = 0; i < active.length; i += 1) for (let j = i + 1; j < active.length; j += 1) expect(overlap(active[i], active[j])).toBe(false);
    for (const q of active) expect(inZone(q)).toBe(true);
  });

  it("vierter Platz am selben Ort: ältestes wird überschrieben, danach keine Überlappung", () => {
    const h = 34;
    const w = 160;
    const active: PopupRect[] = [rect(640, 300, w, h, 0.5)];
    for (const life of [0.4, 0.1]) {
      const p = placePopup(active, 640, 300, w, h);
      active.push(rect(p.x, p.y, w, h, life));
    }
    const p4 = placePopup(active, 640, 300, w, h);
    expect(p4.replace).toBe(0); // life 0.5 = ältestes
    const after = active.filter((_, i) => i !== p4.replace);
    const n = rect(p4.x, p4.y, w, h);
    for (const q of after) expect(overlap(q, n)).toBe(false);
    expect(inZone(n)).toBe(true);
  });

  it("an der Oberkante der Zone wird nach unten ausgewichen", () => {
    const h = 34;
    const w = 160;
    const top = POPUP_ZONE.y0 + h / 2;
    const active = [rect(640, top, w, h)];
    const p = placePopup(active, 640, 0, w, h);
    expect(p.y).toBeCloseTo(top + h * 1.1, 9);
    expect(overlap(active[0], rect(p.x, p.y, w, h))).toBe(false);
  });

  it("Popups an anderer Stelle (kein Überlapp in x) stören sich nicht; Inaktive werden ignoriert", () => {
    const w = 160;
    const h = 34;
    const active = [rect(300, 300, w, h), { ...rect(640, 300, w, h), active: false }];
    expect(placePopup(active, 640, 300, w, h)).toEqual({ x: 640, y: 300, replace: -1 });
    expect(placePopup(active, 300 + w + 1, 300, w, h).y).toBe(300);
  });

  it("deterministisch: gleiche Eingaben, gleiches Ergebnis", () => {
    const active = [rect(640, 300, 160, 34, 0.2), rect(640, 262, 160, 34, 0.1)];
    expect(placePopup(active, 640, 300, 150, 30)).toEqual(placePopup(active, 640, 300, 150, 30));
  });
});

describe("Particles.popup", () => {
  it("Stresstest: aktive Popups überlappen nie und liegen immer in der sicheren Zone (auch beim Steigen)", () => {
    const rnd = lcg(42);
    const texts = ["Autsch!", "Kombo ×3", "Knapp! +30", "+100", "+1 ♥", "1000 m!", "Zeitlupe", "Magnet"];
    const sizes = [30, 32, 34, 40, 56];
    const pt = new Particles();
    let zoneBad = 0;
    let overlapBad = 0;
    let maxActive = 0;
    for (let step = 0; step < 1200; step += 1) {
      const n = Math.floor(rnd() * 3);
      for (let i = 0; i < n; i += 1) {
        const t = Math.floor(rnd() * texts.length);
        // gleiche Texte behalten ihre Größe (Zusammenführung ändert sonst Maße absichtlich nicht an den Nachbarn)
        pt.popup(rnd() * VIEW_W * 1.2 - 100, rnd() * VIEW_H * 1.2 - 100, texts[t], "#fff", sizes[t % sizes.length]);
      }
      pt.update(1 / 60, 600);
      const act = pt.popupPool.filter((q) => q.active);
      maxActive = Math.max(maxActive, act.length);
      for (const q of act) if (!inZone(q)) zoneBad += 1;
      for (let i = 0; i < act.length; i += 1) for (let j = i + 1; j < act.length; j += 1) if (overlap(act[i], act[j])) overlapBad += 1;
    }
    expect(zoneBad).toBe(0);
    expect(overlapBad).toBe(0);
    expect(maxActive).toBeGreaterThan(3); // der Test erzeugt tatsächlich Gedränge
  });

  it("Ergebnis ist deterministisch (zwei Läufe mit gleicher Folge liefern gleiche Popups)", () => {
    const run = (): string => {
      const rnd = lcg(5);
      const pt = new Particles();
      for (let step = 0; step < 300; step += 1) {
        if (rnd() < 0.4) pt.popup(rnd() * VIEW_W, rnd() * VIEW_H, rnd() < 0.5 ? "Kombo ×2" : "Autsch!", "#fff", 34);
        pt.update(1 / 60, 0);
      }
      return JSON.stringify(pt.popupPool.filter((q) => q.active).map((q) => [q.x, q.y, q.text, q.life]));
    };
    expect(run()).toBe(run());
  });

  it("zweites 'Kombo ×N' aktualisiert das erste (ein Popup, neuer Text, Alter zurückgesetzt, gleiche Position)", () => {
    const pt = new Particles();
    pt.popup(300, 300, "Kombo ×2", "#ffe066", 34);
    pt.update(0.3, 0);
    const before = pt.popupPool.find((q) => q.active);
    expect(before?.life).toBeCloseTo(0.3, 9);
    const y0 = before?.y;
    pt.popup(310, 280, "Kombo ×3", "#ffcc00", 34);
    const act = pt.popupPool.filter((q) => q.active);
    expect(act).toHaveLength(1);
    expect(act[0].text).toBe("Kombo ×3");
    expect(act[0].color).toBe("#ffcc00");
    expect(act[0].life).toBe(0);
    expect(act[0].y).toBe(y0);
    // anderes Popup erzeugt ein neues, auch wenn ein Kombo aktiv ist
    pt.popup(300, 300, "Autsch!", "#ff8a8a", 34);
    expect(pt.popupPool.filter((q) => q.active)).toHaveLength(2);
    pt.popup(300, 300, "Autsch!", "#ff8a8a", 34);
    expect(pt.popupPool.filter((q) => q.active)).toHaveLength(2);
  });

  it("Lebensdauer: Kombo/Autsch 0,7 s, sonst 0,9 s, explizit gewinnt", () => {
    const pt = new Particles();
    pt.popup(200, 300, "Kombo ×2");
    pt.popup(500, 300, "Autsch!");
    pt.popup(800, 300, "Knapp! +30");
    pt.popup(1000, 300, "1000 m!", "#fff", 56, 1.6);
    const life = (t: string): number | undefined => pt.popupPool.find((q) => q.active && q.text === t)?.max;
    expect(life("Kombo ×2")).toBe(0.7);
    expect(life("Autsch!")).toBe(0.7);
    expect(life("Knapp! +30")).toBe(0.9);
    expect(life("1000 m!")).toBe(1.6);
    pt.update(0.71, 0);
    expect(pt.popupPool.filter((q) => q.active).map((q) => q.text).sort()).toEqual(["1000 m!", "Knapp! +30"]);
  });

  it("Popups steigen gleichmäßig und stoßen nicht an ihren Nachbarn an", () => {
    const pt = new Particles();
    pt.popup(640, 400, "Kombo ×2", "#fff", 34);
    pt.popup(640, 400, "Autsch!", "#fff", 34);
    const ys0 = pt.popupPool.filter((q) => q.active).map((q) => q.y);
    for (let i = 0; i < 12; i += 1) pt.update(1 / 60, 0);
    const ys1 = pt.popupPool.filter((q) => q.active).map((q) => q.y);
    expect(ys1[0]).toBeLessThan(ys0[0]);
    expect(ys1[1]).toBeLessThan(ys0[1]);
    expect(ys0[0] - ys1[0]).toBeCloseTo(ys0[1] - ys1[1], 9);
  });

  it("Breitenschätzung wächst mit Text und Größe", () => {
    expect(popupWidth("Kombo ×4", 34)).toBeGreaterThan(popupWidth("+1", 34));
    expect(popupWidth("Kombo ×4", 40)).toBeGreaterThan(popupWidth("Kombo ×4", 30));
  });
});

// --- Partikel: Münz-Feedback, Budget, Flug-Münze ---------------------------------------------------------------------------

describe("Münz-Feedback", () => {
  it("Budget-Faktor 0,35 reduziert Sterne, nie Flug-Münzen oder den Ring", () => {
    const pt = new Particles();
    pt.budget = 0.35;
    for (let i = 0; i < 100; i += 1) pt.emit({ x: 0, y: 0, shape: "star" });
    const stars = pt.count("star");
    expect(stars).toBeGreaterThanOrEqual(30);
    expect(stars).toBeLessThanOrEqual(40);
    pt.clear();
    pt.budget = 0;
    for (let i = 0; i < 20; i += 1) pt.emit({ x: 0, y: 0, shape: "star" });
    expect(pt.count()).toBe(0);
    for (let i = 0; i < 10; i += 1) pt.coinFx(100, 400, 1200, 40);
    expect(pt.flying).toBe(MAX_FLYING);
    expect(pt.count("ring")).toBe(10);
    expect(pt.count("star")).toBe(0);
    // Budget 1: nichts geht verloren
    const full = new Particles();
    for (let i = 0; i < 50; i += 1) full.emit({ x: 0, y: 0, shape: "star" });
    expect(full.count("star")).toBe(50);
  });

  it("Budget 0,35 bei coinFx: weniger Sterne als bei 1, Ring und Flug-Münze bleiben", () => {
    const full = new Particles();
    full.coinFx(100, 400, 1200, 40);
    const low = new Particles();
    low.budget = 0.35;
    for (let i = 0; i < 6; i += 1) {
      low.clear();
      low.budget = 0.35;
      low.coinFx(100, 400, 1200, 40);
    }
    // einzelne Aufrufe sind wegen des Sammlers nicht pro Aufruf gleich, aber deutlich unter 8
    expect(full.count("star")).toBe(8);
    expect(low.count("star")).toBeLessThan(8);
    expect(low.count("ring")).toBe(1);
    expect(low.flying).toBe(1);
  });

  it("Partikel je Münze <= 12 plus Flug-Münze (Ring 10 / grow 240 / 0,25 s, Sterne 5–6 mit dunklem Rand)", () => {
    const pt = new Particles();
    pt.coinFx(300, 400);
    expect(pt.count()).toBeLessThanOrEqual(12);
    expect(pt.flying).toBe(0);
    pt.coinFx(300, 400, 1200, 40);
    expect(pt.count() - 9).toBeLessThanOrEqual(12 + 1);
    expect(pt.flying).toBe(1);
    expect(pt.count("coin")).toBe(1);
    expect(pt.count("ring")).toBe(2);
    // Eigenschaften über die Momentaufnahme + einen Zeitschritt
    const ring = new Particles();
    ring.coinFx(300, 400);
    ring.update(0.1, 0);
    expect(ring.inspect().filter((p) => p.shape === "ring")[0].life).toBeCloseTo(0.1, 9);
    ring.update(0.16, 0);
    expect(ring.count("ring")).toBe(0); // 0,25 s Lebensdauer
  });

  it("höchstens 3 aktive Flug-Münzen gleichzeitig; neue werden verworfen, nicht der Flug unterbrochen", () => {
    const pt = new Particles();
    for (let i = 0; i < 8; i += 1) pt.coinFx(300 + i * 10, 400, 1200, 40);
    expect(pt.flying).toBe(3);
    expect(pt.count("coin")).toBe(3);
    // Ringpuffer-Druck überschreibt keine fliegende Münze
    for (let i = 0; i < 2000; i += 1) pt.emit({ x: 0, y: 0, shape: "circle", life: 5 });
    expect(pt.flying).toBe(3);
    // nach 0,4 s sind alle angekommen; danach geht es wieder
    pt.update(0.41, 0);
    expect(pt.flying).toBe(0);
    expect(pt.takeArrivals()).toBe(3);
    expect(pt.takeArrivals()).toBe(0);
    pt.coinFx(300, 400, 1200, 40);
    expect(pt.flying).toBe(1);
  });

  it("Flug-Münze: Ease-in zum Ziel über 0,4 s, bildschirmfest (kein Mitscrollen), kommt am Ziel an", () => {
    const pt = new Particles();
    pt.emit({ x: 100, y: 500, tx: 1200, ty: 40, life: 0.4, shape: "coin", world: true });
    let prevD = Infinity;
    let moved = 0;
    for (let t = 0; t < 0.39; t += 0.01) {
      pt.update(0.01, 900);
      const c = pt.inspect().find((p) => p.fly);
      expect(c).toBeDefined();
      const d = Math.hypot((c?.x ?? 0) - 1200, (c?.y ?? 0) - 40);
      expect(d).toBeLessThan(prevD + 30); // Bogen darf kurz abweichen, strebt aber zum Ziel
      prevD = Math.min(prevD, d);
      moved += 1;
    }
    expect(moved).toBeGreaterThan(30);
    // Ease-in: nach halber Zeit erst ein Viertel des Weges (x ohne Bogenanteil)
    const half = new Particles();
    half.emit({ x: 0, y: 0, tx: 1000, ty: 0, life: 0.4, shape: "coin" });
    half.update(0.2, 0);
    expect(half.inspect()[0].x).toBeCloseTo(250, 6);
    half.update(0.19, 0);
    expect(half.inspect()[0].x).toBeGreaterThan(900);
  });

  it("clear() setzt Flug-Münzen, Sammler und Ankünfte zurück", () => {
    const pt = new Particles();
    pt.coinFx(0, 0, 100, 100);
    pt.update(1, 0);
    pt.coinFx(0, 0, 100, 100);
    pt.clear();
    expect(pt.flying).toBe(0);
    expect(pt.count()).toBe(0);
    expect(pt.takeArrivals()).toBe(0);
  });
});

// --- Partikel: weltfest ----------------------------------------------------------------------------------------------------

describe("world-Flag", () => {
  it("Partikel mit world:true bewegen sich um -scroll*dt zusätzlich, ohne Flag nicht", () => {
    const pt = new Particles();
    pt.emit({ x: 500, y: 300, vx: -100, vy: 0, life: 5, world: true });
    pt.emit({ x: 500, y: 300, vx: -100, vy: 0, life: 5 });
    pt.update(0.1, 800);
    const [w, s] = pt.inspect();
    expect(w.x).toBeCloseTo(500 - 10 - 80, 9);
    expect(s.x).toBeCloseTo(500 - 10, 9);
    expect(w.world).toBe(true);
    expect(s.world).toBe(false);
  });

  it("weltfester Staub bleibt relativ zum Boden liegen (x(t) + zurückgelegte Weltstrecke konstant)", () => {
    const pt = new Particles();
    pt.emit({ x: 300, y: 590, vx: 0, life: 5, world: true, shape: "puff" });
    let dist = 0;
    for (let i = 0; i < 30; i += 1) {
      pt.update(1 / 60, 900);
      dist += 900 / 60;
    }
    expect(pt.inspect()[0].x + dist).toBeCloseTo(300, 6);
  });
});

// --- Puff-Sprites ----------------------------------------------------------------------------------------------------------

/** Aufzeichnender 2D-Kontext-Ersatz (Proxy). */
function fakeG(): { g: CanvasRenderingContext2D; calls: Array<[string, ...unknown[]]> } {
  const calls: Array<[string, ...unknown[]]> = [];
  const store: Record<string, unknown> = {};
  const g = new Proxy(store, {
    get: (t, k: string) =>
      k in t
        ? t[k]
        : (...a: unknown[]) => {
            calls.push([k, ...a]);
          },
    set: (t, k: string, v) => {
      t[k] = v;
      return true;
    },
  });
  return { g: g as unknown as CanvasRenderingContext2D, calls };
}

/** document-Ersatz mit zählbarer Canvas-Erzeugung. */
function stubDocument(): { created: unknown[] } {
  const created: unknown[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k: string) => (k === "createRadialGradient" ? () => ({ addColorStop() {} }) : k in t ? t[k] : () => undefined),
    set: (t, k: string, v) => {
      t[k] = v;
      return true;
    },
  });
  vi.stubGlobal("document", {
    createElement: () => {
      const c = { width: 0, height: 0, getContext: () => ctx };
      created.push(c);
      return c;
    },
  });
  return { created };
}

describe("Puff-Sprites", () => {
  it("genau zwei gecachte Sprites (Variante 0/1, 64×64), jeder weitere Aufruf liefert dieselben", async () => {
    vi.resetModules();
    const env = stubDocument();
    const mod = await import("./particles");
    const a = mod.puffSprite(0);
    const b = mod.puffSprite(1);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toBe(b);
    for (let i = 0; i < 20; i += 1) {
      expect(mod.puffSprite(0)).toBe(a);
      expect(mod.puffSprite(1)).toBe(b);
      expect(mod.puffSprite(2)).toBe(a); // gerade -> Variante 0
      expect(mod.puffSprite(3)).toBe(b);
    }
    expect(mod.warmPuffSprites()).toBe(true);
    expect(env.created).toHaveLength(2);
    expect((a as unknown as { width: number; height: number }).width).toBe(64);
    expect((a as unknown as { width: number; height: number }).height).toBe(64);
    expect(mod.PUFF_VARIANTS).toBe(2);
  });

  it("ohne Canvas (Node/SSR) werfen die Funktionen nicht und liefern null/false", () => {
    expect(typeof document).toBe("undefined");
    expect(() => puffSprite(0)).not.toThrow();
    expect(puffSprite(0)).toBeNull();
    expect(puffSprite(1)).toBeNull();
    expect(warmPuffSprites()).toBe(false);
  });

  it("fehlt der 2D-Kontext oder wirft die Erzeugung, bleibt es bei null (kein Wurf, kein erneuter Versuch)", async () => {
    vi.resetModules();
    let calls = 0;
    vi.stubGlobal("document", {
      createElement: () => {
        calls += 1;
        return { width: 0, height: 0, getContext: () => null };
      },
    });
    const mod = await import("./particles");
    expect(mod.puffSprite(0)).toBeNull();
    expect(mod.puffSprite(1)).toBeNull();
    expect(calls).toBe(1);
    vi.resetModules();
    vi.stubGlobal("document", {
      createElement: () => {
        throw new Error("kein Canvas");
      },
    });
    const mod2 = await import("./particles");
    expect(() => mod2.puffSprite(0)).not.toThrow();
    expect(mod2.puffSprite(0)).toBeNull();
  });

  it("Zeichnen: Puff per drawImage (Größe ×1,6 des früheren Kreises, Alpha wie bisher), ohne Canvas Kreis-Rückfall", async () => {
    vi.resetModules();
    stubDocument();
    const mod = await import("./particles");
    const pt = new mod.Particles();
    pt.emit({ x: 200, y: 300, life: 1, size: 10, shape: "puff", alpha: 0.75, variant: 1 });
    const rec = fakeG();
    pt.draw(rec.g);
    const draw = rec.calls.find((c) => c[0] === "drawImage");
    expect(draw).toBeDefined();
    expect(draw?.[1]).toBe(mod.puffSprite(1));
    expect(draw?.[4]).toBeCloseTo(32, 9); // 2 * 10 * 1,6
    expect(draw?.[2]).toBeCloseTo(200 - 16, 9);
    expect(rec.calls.some((c) => c[0] === "arc")).toBe(false);

    // Rückfall ohne Sprites (Modul frisch, kein document)
    vi.unstubAllGlobals();
    vi.resetModules();
    const bare = await import("./particles");
    const p2 = new bare.Particles();
    p2.emit({ x: 200, y: 300, life: 1, size: 10, shape: "puff" });
    const rec2 = fakeG();
    expect(() => p2.draw(rec2.g)).not.toThrow();
    expect(rec2.calls.some((c) => c[0] === "arc")).toBe(true);
    expect(rec2.calls.some((c) => c[0] === "drawImage")).toBe(false);
  });
});

// --- Orbit-Sternchen -------------------------------------------------------------------------------------------------------

describe("Orbit-Sternchen", () => {
  it("höchstens 4, kein Pool-Verbrauch, verschwinden ohne Aufruf nach 0,12 s", () => {
    const pt = new Particles();
    pt.orbit(300, 400, 9);
    expect(pt.orbiting).toBe(ORBIT_MAX);
    expect(pt.count()).toBe(0);
    pt.orbit(300, 400, 2);
    expect(pt.orbiting).toBe(2);
    pt.orbit(300, 400, 0);
    expect(pt.orbiting).toBe(0);
    pt.orbit(300, 400, -3);
    expect(pt.orbiting).toBe(0);
    pt.orbit(300, 400, 4);
    pt.update(0.05, 0);
    expect(pt.orbiting).toBe(4);
    pt.update(0.1, 0);
    expect(pt.orbiting).toBe(0);
    pt.orbit(300, 400, 4);
    pt.clear();
    expect(pt.orbiting).toBe(0);
  });

  it("zeichnet genau count Sterne (source-over, mit dunklem Rand) und wirft nicht", () => {
    const pt = new Particles();
    pt.orbit(300, 400, 3);
    const rec = fakeG();
    expect(() => pt.draw(rec.g)).not.toThrow();
    expect(rec.calls.filter((c) => c[0] === "fill")).toHaveLength(3);
    expect(rec.calls.filter((c) => c[0] === "stroke")).toHaveLength(3);
    const none = new Particles();
    const rec0 = fakeG();
    none.draw(rec0.g);
    expect(rec0.calls.some((c) => c[0] === "fill")).toBe(false);
  });

  it("Sterne laufen im Kreis (Position ändert sich mit der Zeit)", () => {
    const pt = new Particles();
    const pos = (): string => {
      const rec = fakeG();
      pt.orbit(300, 400, 1);
      pt.draw(rec.g);
      return JSON.stringify(rec.calls.find((c) => c[0] === "translate")?.slice(1));
    };
    const a = pos();
    pt.update(0.1, 0);
    const b = pos();
    expect(a).not.toBe(b);
  });
});

describe("Stern mit dunklem Rand", () => {
  it("Rand wird vor der Füllung gezeichnet, Sterne ohne outline bleiben unverändert", () => {
    const pt = new Particles();
    pt.emit({ x: 10, y: 10, shape: "star", size: 5, outline: "#7a4b00" });
    const rec = fakeG();
    pt.draw(rec.g);
    const names = rec.calls.map((c) => c[0]);
    expect(names.indexOf("stroke")).toBeGreaterThan(-1);
    expect(names.indexOf("stroke")).toBeLessThan(names.indexOf("fill"));
    const plain = new Particles();
    plain.emit({ x: 10, y: 10, shape: "star", size: 5 });
    const rec2 = fakeG();
    plain.draw(rec2.g);
    expect(rec2.calls.some((c) => c[0] === "stroke")).toBe(false);
  });
});
