/**
 * SFX-Rezepte. Jeder Effekt ist mehrschichtig aufgebaut (Oszillator-Hüllkurve mit Pitch-Sweep +
 * gefiltertes Rauschen + Glocken-/Oberton-Schicht) und läuft über eine `SfxVoice`
 * (Pan, Reverb-Send, Aufräumen). Frequenzen sind Basiswerte, `p` skaliert die Tonhöhe.
 *
 * Alle Amplituden sind "Peak-Nennwerte" vor der Bus-Lautstärke; die feine Balance steckt in `SFX_META.gain`.
 */
import { clamp } from "./dsp";
import type { AudioGraph } from "./graph";
import type { SfxName, SfxOptions } from "./types";
import { PARTIALS_BELL, PARTIALS_CHIME, PARTIALS_METAL, SfxVoice } from "./voice";

type Recipe = (v: SfxVoice, p: number, t: number) => void;

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

// Stimmung der Pickups: C-Dur-Pentatonik (Coin/Combo/Gem klingen zusammen harmonisch)
const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const C6 = 1046.5;
const E6 = 1318.5;
const G6 = 1568;
const C7 = 2093;

/** Coin-Tonleiter (Halbtöne über C5): pentatonisch über zwei Oktaven. */
export const COIN_STEPS = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21] as const;

/** Zufälliges "Flattern" der Verstärkung (Papier, Blitz-Knistern, Glitch). */
function flicker(
  amp: GainNode,
  t: number,
  dur: number,
  peak: number,
  gap: [number, number],
  shape: (x: number) => number = () => 1,
  soft = 0.004,
): void {
  amp.gain.setValueAtTime(0, t);
  let tt = t + 0.004;
  while (tt < t + dur) {
    const x = (tt - t) / dur;
    const val = peak * shape(x) * rnd(0.15, 1);
    amp.gain.setTargetAtTime(val, tt, soft);
    tt += rnd(gap[0], gap[1]);
  }
  amp.gain.setTargetAtTime(0, t + dur, 0.01);
}

/** Rollende Einhüllende (Donner, Lawine): Anschwellen, dann zufällige Buckel beim Abklingen. */
function rolling(amp: GainNode, t: number, dur: number, peak: number, attack: number): void {
  const g = amp.gain;
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(peak, t + attack);
  let tt = t + attack;
  while (tt < t + dur - 0.3) {
    tt += rnd(0.22, 0.5);
    const x = (tt - t - attack) / Math.max(0.1, dur - attack);
    g.linearRampToValueAtTime(peak * Math.pow(1 - x, 1.6) * rnd(0.45, 1), Math.min(tt, t + dur - 0.2));
  }
  g.linearRampToValueAtTime(0.0001, t + dur);
}

const RECIPES: Record<SfxName, Recipe> = {
  // -------------------------------------------------------------------------------- UI
  "ui-click": (v, p, t) => {
    v.tone({ t, f: 1600 * p, f2: 950 * p, fT: 0.035, dur: 0.07, peak: 0.34 });
    v.tone({ t, f: 3400 * p, dur: 0.025, peak: 0.1, type: "triangle" });
    v.noise({ t, dur: 0.02, peak: 0.16, filters: [{ type: "highpass", f: 3000 }] });
  },
  "ui-hover": (v, p, t) => {
    v.tone({ t, f: 2100 * p, f2: 2500 * p, fT: 0.04, dur: 0.055, peak: 0.1, a: 0.006 });
    v.tone({ t, f: 4200 * p, dur: 0.03, peak: 0.03, a: 0.005 });
  },
  "ui-back": (v, p, t) => {
    v.tone({ t, f: 700 * p, f2: 420 * p, fT: 0.09, dur: 0.15, peak: 0.28, type: "triangle", filters: [{ type: "lowpass", f: 2200 }] });
    v.tone({ t, f: 350 * p, f2: 210 * p, fT: 0.09, dur: 0.12, peak: 0.16 });
    v.noise({ t, dur: 0.015, peak: 0.1, filters: [{ type: "highpass", f: 2500 }] });
  },
  "ui-buy": (v, p, t) => {
    v.tone({ t, f: 240 * p, f2: 120 * p, fT: 0.06, dur: 0.1, peak: 0.28 });
    v.noise({ t, dur: 0.035, peak: 0.24, filters: [{ type: "bandpass", f: 5200, q: 3 }] });
    v.bell({ t: t + 0.03, f: 1568 * p, dur: 0.5, peak: 0.26, partials: PARTIALS_METAL });
    v.bell({ t: t + 0.1, f: C7 * p, dur: 0.95, peak: 0.3, partials: PARTIALS_CHIME });
    v.noise({ t: t + 0.1, dur: 0.4, peak: 0.1, a: 0.01, filters: [{ type: "highpass", f: 7500 }] });
  },
  "ui-denied": (v, p, t) => {
    for (let k = 0; k < 2; k++) {
      v.tone({ t: t + k * 0.1, f: 170 * p, f2: 138 * p, fT: 0.08, dur: 0.09, peak: 0.3, type: "square", filters: [{ type: "lowpass", f: 700, q: 1 }] });
    }
    v.tone({ t, f: 85 * p, dur: 0.18, peak: 0.2 });
  },

  // -------------------------------------------------------------------------------- Bewegung
  jump: (v, p, t) => {
    v.tone({ t, f: 330 * p, f2: 760 * p, fT: 0.13, dur: 0.17, peak: 0.28 });
    v.tone({ t, f: 660 * p, f2: 1520 * p, fT: 0.13, dur: 0.12, peak: 0.06, type: "triangle" });
    v.noise({ t, dur: 0.14, peak: 0.16, a: 0.03, filters: [{ type: "bandpass", f: 700 * p, f2: 2400 * p, q: 0.9 }] });
  },
  doublejump: (v, p, t) => {
    v.tone({ t, f: 520 * p, f2: 1240 * p, fT: 0.11, dur: 0.16, peak: 0.26, type: "triangle" });
    v.tone({ t: t + 0.045, f: 1040 * p, f2: 2200 * p, fT: 0.1, dur: 0.14, peak: 0.12 });
    v.bell({ t: t + 0.07, f: 2637 * p, dur: 0.24, peak: 0.12 });
    v.noise({ t, dur: 0.16, peak: 0.14, a: 0.02, filters: [{ type: "bandpass", f: 2000 * p, f2: 6000 * p, q: 1 }] });
  },
  land: (v, p, t) => {
    v.tone({ t, f: 135 * p, f2: 52 * p, fT: 0.09, dur: 0.16, peak: 0.55 });
    v.noise({ t, dur: 0.09, peak: 0.5, kind: "brown", filters: [{ type: "lowpass", f: 500 * p, f2: 200 * p, q: 0.7 }] });
    v.noise({ t, dur: 0.025, peak: 0.1, filters: [{ type: "bandpass", f: 1800, q: 1 }] });
  },
  slide: (v, p, t) => {
    v.noise({ t, dur: 0.32, peak: 0.34, a: 0.04, kind: "pink", filters: [{ type: "bandpass", f: 1100 * p, f2: 500 * p, q: 0.8 }] });
    v.noise({ t, dur: 0.2, peak: 0.08, a: 0.02, filters: [{ type: "highpass", f: 4000 }] });
    v.tone({ t, f: 90 * p, f2: 60 * p, dur: 0.22, peak: 0.14 });
  },
  dash: (v, p, t) => {
    v.tone({ t, f: 240 * p, f2: 1500 * p, fT: 0.16, dur: 0.24, peak: 0.16, type: "sawtooth", filters: [{ type: "lowpass", f: 500 * p, f2: 3600 * p, T: 0.16, q: 1.5 }] });
    v.noise({ t, dur: 0.28, peak: 0.34, a: 0.02, filters: [{ type: "bandpass", f: 500 * p, f2: 3800 * p, T: 0.18, q: 0.7 }] });
    v.tone({ t, f: 100 * p, f2: 50 * p, dur: 0.18, peak: 0.3 });
  },
  stomp: (v, p, t) => {
    v.tone({ t, f: 190 * p, f2: 42 * p, fT: 0.12, dur: 0.26, peak: 0.7 });
    v.tone({ t, f: 320 * p, f2: 140 * p, fT: 0.08, dur: 0.1, peak: 0.2, type: "square", filters: [{ type: "lowpass", f: 900 }] });
    v.noise({ t, dur: 0.1, peak: 0.4, kind: "pink", filters: [{ type: "lowpass", f: 1400, f2: 400, q: 0.8 }] });
    v.noise({ t, dur: 0.022, peak: 0.2, filters: [{ type: "bandpass", f: 3200, q: 1 }] });
  },
  "stomp-chain": (v, p, t) => {
    v.tone({ t, f: 200 * p, f2: 46 * p, fT: 0.11, dur: 0.22, peak: 0.55 });
    v.noise({ t, dur: 0.08, peak: 0.32, kind: "pink", filters: [{ type: "lowpass", f: 1500, f2: 450, q: 0.8 }] });
    v.noise({ t, dur: 0.02, peak: 0.16, filters: [{ type: "bandpass", f: 3400, q: 1 }] });
    [G5, 987.77, 1174.7, G6].forEach((f, i) => {
      v.bell({ t: t + 0.06 + i * 0.055, f: f * p, dur: 0.3 + i * 0.1, peak: 0.16 + i * 0.02, type: "triangle" });
    });
  },
  spring: (v, p, t) => {
    v.tone({ t, f: 240 * p, f2: 900 * p, fT: 0.3, dur: 0.42, peak: 0.28, type: "triangle", vib: { rate: 22, depth: 380 } });
    v.tone({ t, f: 480 * p, f2: 1800 * p, fT: 0.3, dur: 0.3, peak: 0.08, vib: { rate: 22, depth: 300 } });
    v.noise({ t: t + 0.02, dur: 0.07, peak: 0.12, filters: [{ type: "bandpass", f: 4000, q: 4 }] });
    v.bell({ t: t + 0.28, f: E6 * p, dur: 0.3, peak: 0.1 });
  },
  portal: (v, p, t) => {
    for (const d of [-12, 12]) {
      v.tone({
        t, f: 110 * p, f2: 440 * p, fT: 0.6, dur: 0.78, peak: 0.13, type: "sawtooth", detune: d, a: 0.12,
        filters: [{ type: "lowpass", f: 300, f2: 3200, T: 0.5, q: 3 }], trem: { rate: 14, depth: 0.5 },
      });
    }
    v.tone({ t: t + 0.05, f: 400 * p, f2: 1800 * p, fT: 0.6, dur: 0.7, peak: 0.1, vib: { rate: 9, depth: 60 } });
    v.noise({ t, dur: 0.85, peak: 0.16, a: 0.3, filters: [{ type: "bandpass", f: 900, f2: 3800, q: 2, T: 0.7 }] });
    v.bell({ t: t + 0.45, f: 1976 * p, dur: 0.6, peak: 0.12 });
    v.panSweep(-0.7, 0.7, t, 0.75);
  },
  wallbreak: (v, p, t) => {
    v.tone({ t, f: 110 * p, f2: 32 * p, fT: 0.3, dur: 0.55, peak: 0.7 });
    v.noise({ t, dur: 0.13, peak: 0.42, filters: [{ type: "bandpass", f: 1800, f2: 600, q: 0.9 }] });
    v.noise({ t, dur: 0.65, peak: 0.45, kind: "brown", filters: [{ type: "lowpass", f: 260 }] });
    for (let i = 0; i < 9; i++) {
      const dt = rnd(0.02, 0.42);
      v.noise({ t: t + dt, dur: rnd(0.03, 0.07), peak: 0.2 * (1 - dt), filters: [{ type: "bandpass", f: rnd(600, 3500) * p, q: 1.2 }] });
    }
  },

  // -------------------------------------------------------------------------------- Pickups
  coin: (v, p, t) => {
    v.bell({ t, f: C5 * p, dur: 0.2, peak: 0.24 });
    v.bell({ t: t + 0.06, f: G5 * p, dur: 0.55, peak: 0.3 });
    v.noise({ t: t + 0.06, dur: 0.05, peak: 0.05, filters: [{ type: "highpass", f: 6000 }] });
  },
  gem: (v, p, t) => {
    [E6, 1661.2, 1975.5, 2637].forEach((f, i) => {
      v.bell({ t: t + i * 0.045, f: f * p, dur: 0.55 + i * 0.12, peak: 0.2, partials: PARTIALS_BELL });
    });
    v.tone({ t, f: 659 * p, dur: 0.7, peak: 0.12, type: "triangle", a: 0.02 });
    v.noise({ t: t + 0.05, dur: 0.65, peak: 0.09, a: 0.05, filters: [{ type: "highpass", f: 8000 }] });
  },
  heart: (v, p, t) => {
    v.tone({ t, f: 78 * p, f2: 50 * p, dur: 0.13, peak: 0.5 });
    v.tone({ t: t + 0.14, f: 70 * p, f2: 46 * p, dur: 0.12, peak: 0.38 });
    [C5, E5, G5, C6].forEach((f, i) => {
      const at = t + 0.06 + i * 0.07;
      v.tone({ t: at, f: f * p, dur: 0.65, peak: 0.16, type: "triangle", a: 0.012 });
      v.tone({ t: at, f: f * 2 * p, dur: 0.4, peak: 0.05, a: 0.012 });
    });
  },
  powerup: (v, p, t) => {
    [C5, E5, G5, C6, E6].forEach((f, i) => {
      const at = t + i * 0.05;
      v.tone({ t: at, f: f * p, dur: 0.2, peak: 0.11, type: "square", filters: [{ type: "lowpass", f: 3000 }], vib: { rate: 9, depth: 15 } });
      v.tone({ t: at, f: f * p, dur: 0.24, peak: 0.14 });
    });
    v.noise({ t, dur: 0.4, peak: 0.13, a: 0.1, filters: [{ type: "bandpass", f: 800, f2: 5000, q: 1.2 }] });
    v.bell({ t: t + 0.25, f: C7 * p, dur: 0.55, peak: 0.14 });
  },
  "shield-on": (v, p, t) => {
    v.tone({ t, f: 280 * p, f2: 1100 * p, fT: 0.32, dur: 0.55, peak: 0.22, type: "triangle", trem: { rate: 16, depth: 0.4 } });
    v.tone({ t: t + 0.05, f: 560 * p, f2: 2200 * p, fT: 0.3, dur: 0.4, peak: 0.08, vib: { rate: 8, depth: 40 } });
    v.noise({ t, dur: 0.5, peak: 0.2, a: 0.12, filters: [{ type: "bandpass", f: 500, f2: 2600, q: 2.5 }] });
    v.bell({ t: t + 0.28, f: G6 * p, dur: 0.8, peak: 0.16, partials: PARTIALS_METAL });
  },
  "shield-hit": (v, p, t) => {
    v.noise({ t, dur: 0.07, peak: 0.36, filters: [{ type: "bandpass", f: 3500, q: 1.2 }] });
    v.tone({ t, f: 1240 * p, dur: 0.2, peak: 0.16, type: "square", filters: [{ type: "bandpass", f: 1240 * p, q: 4 }] });
    v.tone({ t, f: 1780 * p, dur: 0.16, peak: 0.12, type: "square", filters: [{ type: "bandpass", f: 1780 * p, q: 4 }] });
    v.tone({ t, f: 900 * p, f2: 260 * p, fT: 0.12, dur: 0.22, peak: 0.3, type: "triangle" });
    v.bell({ t, f: 2200 * p, dur: 0.32, peak: 0.13, partials: PARTIALS_METAL });
  },
  "slowmo-on": (v, p, t) => {
    v.tone({ t, f: 900 * p, f2: 70 * p, fT: 0.7, dur: 0.9, peak: 0.24, type: "sawtooth", filters: [{ type: "lowpass", f: 3000, f2: 200, T: 0.7, q: 2 }] });
    v.tone({ t, f: 300 * p, f2: 40 * p, fT: 0.8, dur: 0.95, peak: 0.32 });
    v.noise({ t, dur: 0.7, peak: 0.12, a: 0.05, filters: [{ type: "bandpass", f: 4000, f2: 300, q: 1 }] });
  },
  "slowmo-off": (v, p, t) => {
    v.tone({ t, f: 90 * p, f2: 900 * p, fT: 0.32, dur: 0.42, peak: 0.2, type: "sawtooth", a: 0.18, filters: [{ type: "lowpass", f: 200, f2: 4000, T: 0.32, q: 1.5 }] });
    v.tone({ t, f: 60 * p, f2: 240 * p, fT: 0.3, dur: 0.4, peak: 0.24, a: 0.15 });
    v.tone({ t: t + 0.3, f: 1400 * p, dur: 0.12, peak: 0.16, type: "triangle" });
    v.noise({ t, dur: 0.36, peak: 0.1, a: 0.2, filters: [{ type: "bandpass", f: 300, f2: 4000, q: 1 }] });
  },
  "magnet-on": (v, p, t) => {
    v.tone({ t, f: 55 * p, f2: 110 * p, fT: 0.3, dur: 0.5, peak: 0.3, type: "sawtooth", filters: [{ type: "lowpass", f: 400, q: 3 }], trem: { rate: 18, depth: 0.5 } });
    v.tone({ t, f: 220 * p, f2: 440 * p, fT: 0.3, dur: 0.4, peak: 0.12, vib: { rate: 20, depth: 80 } });
    v.noise({ t, dur: 0.3, peak: 0.12, a: 0.1, filters: [{ type: "bandpass", f: 2500, q: 3 }] });
    v.bell({ t: t + 0.28, f: 880 * p, dur: 0.3, peak: 0.13, partials: PARTIALS_METAL });
  },

  // -------------------------------------------------------------------------------- Treffer / Combo
  hurt: (v, p, t) => {
    v.tone({ t, f: 420 * p, f2: 110 * p, fT: 0.22, dur: 0.32, peak: 0.36, type: "square", filters: [{ type: "lowpass", f: 1400, q: 1 }] });
    v.tone({ t: t + 0.01, f: 590 * p, f2: 250 * p, fT: 0.2, dur: 0.22, peak: 0.14, type: "sawtooth", filters: [{ type: "lowpass", f: 1800 }] });
    v.tone({ t, f: 100 * p, f2: 48 * p, fT: 0.15, dur: 0.26, peak: 0.55 });
    v.noise({ t, dur: 0.14, peak: 0.36, kind: "pink", filters: [{ type: "lowpass", f: 1800, f2: 500 }] });
  },
  death: (v, p, t) => {
    v.tone({ t, f: 90 * p, f2: 28 * p, fT: 0.5, dur: 0.95, peak: 0.6 });
    for (const d of [0, -25]) {
      v.tone({
        t, f: 520 * p, f2: 60 * p, fT: 1.1, dur: 1.35, peak: 0.16, type: "sawtooth", detune: d,
        filters: [{ type: "lowpass", f: 2600, f2: 260, T: 1.1, q: 2 }], vib: { rate: 6.5, depth: 35, delay: 0.1 },
      });
    }
    v.noise({ t, dur: 0.55, peak: 0.4, kind: "pink", filters: [{ type: "lowpass", f: 3000, f2: 300, T: 0.5 }] });
    v.tone({ t: t + 0.05, f: 233 * p, f2: 116 * p, fT: 0.9, dur: 1.1, peak: 0.18, type: "triangle", a: 0.05 });
  },
  "near-miss": (v, p, t) => {
    v.noise({ t, dur: 0.24, peak: 0.36, a: 0.06, filters: [{ type: "bandpass", f: 3200, f2: 900, T: 0.22, q: 1.4 }] });
    v.tone({ t, f: 1300 * p, f2: 640 * p, fT: 0.22, dur: 0.24, peak: 0.06, a: 0.05 });
    const dir = Math.random() < 0.5 ? -1 : 1;
    v.panSweep(-0.8 * dir, 0.8 * dir, t, 0.24);
  },
  "combo-up": (v, p, t) => {
    [G5, C6, G6].forEach((f, i) => {
      v.bell({ t: t + i * 0.055, f: f * p, dur: 0.22 + i * 0.12, peak: 0.22, type: "triangle" });
    });
    v.noise({ t: t + 0.08, dur: 0.25, peak: 0.06, filters: [{ type: "highpass", f: 7000 }] });
  },
  "combo-break": (v, p, t) => {
    v.tone({ t, f: 620 * p, f2: 190 * p, fT: 0.22, dur: 0.28, peak: 0.25, type: "sawtooth", filters: [{ type: "lowpass", f: 2400, f2: 500, T: 0.22 }] });
    v.noise({ t, dur: 0.22, peak: 0.13, filters: [{ type: "highpass", f: 5000 }] });
    v.bell({ t: t + 0.02, f: E6 * p, dur: 0.18, peak: 0.1 });
    v.tone({ t: t + 0.03, f: 180 * p, f2: 90 * p, dur: 0.16, peak: 0.2 });
  },

  // -------------------------------------------------------------------------------- Ablauf / Stinger
  countdown: (v, p, t) => {
    v.tone({ t, f: 880 * p, dur: 0.2, peak: 0.32, type: "triangle", a: 0.005 });
    v.tone({ t, f: 1760 * p, dur: 0.1, peak: 0.1 });
    v.noise({ t, dur: 0.012, peak: 0.1, filters: [{ type: "highpass", f: 3000 }] });
  },
  go: (v, p, t) => {
    [C5, E5, G5, C6].forEach((f) => {
      v.tone({ t, f: f * p, dur: 0.55, peak: 0.1, type: "sawtooth", hold: 0.06, filters: [{ type: "lowpass", f: 3500, f2: 1200, T: 0.4, q: 1 }] });
    });
    v.bell({ t, f: C7 * p, dur: 0.85, peak: 0.2 });
    v.noise({ t, dur: 0.3, peak: 0.2, a: 0.04, filters: [{ type: "bandpass", f: 1200, f2: 7000, q: 1 }] });
    v.tone({ t, f: 100 * p, f2: 50 * p, dur: 0.2, peak: 0.5 });
  },
  checkpoint: (v, p, t) => {
    [G5, C6, E6, G6].forEach((f, i) => {
      v.bell({ t: t + i * 0.11, f: f * p, dur: i === 3 ? 1.0 : 0.5, peak: 0.24 });
    });
    v.noise({ t, dur: 0.32, peak: 0.1, a: 0.06, filters: [{ type: "bandpass", f: 1800, f2: 3400, q: 1 }] });
    v.tone({ t, f: 392 * p, dur: 0.5, peak: 0.1, type: "triangle", a: 0.02 });
  },
  "world-transition": (v, p, t) => {
    v.noise({ t, dur: 1.5, peak: 0.36, a: 1.1, filters: [{ type: "bandpass", f: 200, f2: 9000, q: 1.2, T: 1.3 }] });
    [261.6, 392, 523.25, 659.25].forEach((f) => {
      v.tone({ t, f: f * p, dur: 1.7, peak: 0.08, type: "sawtooth", a: 0.7, filters: [{ type: "lowpass", f: 800, f2: 2600, T: 1.1 }] });
    });
    v.tone({ t: t + 1.15, f: 92 * p, f2: 30 * p, dur: 0.9, peak: 0.6 });
    [C6, E6, G6, C7].forEach((f, i) => {
      v.bell({ t: t + 1.18 + i * 0.08, f: f * p, dur: 0.9, peak: 0.17 });
    });
    v.noise({ t: t + 1.15, dur: 0.7, peak: 0.24, kind: "pink", filters: [{ type: "lowpass", f: 3000, f2: 400 }] });
  },
  gameover: (v, p, t) => {
    const notes: Array<[number, number]> = [[440, 0], [392, 0.28], [329.6, 0.56], [220, 0.9]];
    for (const [f, dt] of notes) {
      v.tone({ t: t + dt, f: f * p, dur: 0.55, peak: 0.22, type: "triangle", a: 0.02 });
      v.tone({ t: t + dt, f: f * p, dur: 0.5, peak: 0.06, type: "sawtooth", filters: [{ type: "lowpass", f: 1200 }] });
    }
    for (const f of [220, 261.6, 329.6, 440]) {
      v.tone({ t: t + 0.9, f: f * p, dur: 1.7, peak: 0.075, type: "sawtooth", a: 0.06, filters: [{ type: "lowpass", f: 900, f2: 450, T: 1.6 }] });
    }
    v.tone({ t, f: 90 * p, f2: 50 * p, dur: 0.3, peak: 0.4 });
  },
  highscore: (v, p, t) => {
    [392, C5, E5, G5].forEach((f, i) => {
      const at = t + i * 0.13;
      v.tone({ t: at, f: f * p, dur: 0.2, peak: 0.1, type: "sawtooth", filters: [{ type: "lowpass", f: 2600 }] });
      v.tone({ t: at, f: f * p, dur: 0.2, peak: 0.13, type: "triangle" });
    });
    for (const f of [C5, E5, G5, C6]) {
      v.tone({ t: t + 0.55, f: f * p, dur: 1.35, peak: 0.09, type: "sawtooth", a: 0.02, hold: 0.5, filters: [{ type: "lowpass", f: 3200, f2: 1800, T: 1.2 }] });
    }
    v.tone({ t: t + 0.55, f: 110 * p, f2: 60 * p, dur: 0.6, peak: 0.5 });
    v.noise({ t: t + 0.55, dur: 1.2, peak: 0.16, a: 0.01, filters: [{ type: "highpass", f: 5000 }] });
    [C7, 2637, 3136].forEach((f, i) => {
      v.bell({ t: t + 0.7 + i * 0.1, f: f * p, dur: 0.9, peak: 0.13 });
    });
  },

  // -------------------------------------------------------------------------------- Weltspezifisch
  "lightning-warn": (v, p, t) => {
    const { amp } = v.noise({ t, dur: 0.75, raw: true, filters: [{ type: "highpass", f: 3500 }] });
    flicker(amp, t, 0.72, 0.28, [0.012, 0.03], (x) => 0.25 + x * 0.75);
    v.tone({ t, f: 90 * p, f2: 200 * p, fT: 0.6, dur: 0.75, peak: 0.16, type: "sawtooth", a: 0.3, filters: [{ type: "lowpass", f: 500, q: 2 }], trem: { rate: 40, depth: 0.5 } });
    v.tone({ t: t + 0.3, f: 3000 * p, f2: 5200 * p, fT: 0.4, dur: 0.45, peak: 0.05, type: "square", trem: { rate: 55, depth: 0.8 } });
  },
  thunder: (v, p, t) => {
    // sofort: scharfer Knall (Blitz), verzögert: rollendes Grollen
    v.noise({ t, dur: 0.2, peak: 0.55, a: 0.003, filters: [{ type: "highpass", f: 900 }, { type: "lowpass", f: 9000, f2: 2500, T: 0.2 }] });
    v.tone({ t, f: 180 * p, f2: 60 * p, fT: 0.12, dur: 0.16, peak: 0.34 });
    const rt = t + 0.32;
    const { amp } = v.noise({ t: rt, dur: 2.8, kind: "brown", raw: true, filters: [{ type: "lowpass", f: 380 * p, f2: 120 * p, T: 2.6, q: 0.8 }] });
    rolling(amp, rt, 2.8, 1.0, 0.25);
    const sub = v.tone({ t: rt, f: 46 * p, f2: 32 * p, dur: 2.2, peak: 0.3, raw: true });
    rolling(sub.amp, rt, 2.2, 0.32, 0.2);
  },
  "tram-bell": (v, p, t) => {
    for (let i = 0; i < 3; i++) {
      const at = t + i * 0.125;
      v.bell({ t: at, f: 1320 * p, dur: 0.55, peak: i === 2 ? 0.3 : 0.24, partials: PARTIALS_METAL, a: 0.001 });
      v.noise({ t: at, dur: 0.012, peak: 0.08, filters: [{ type: "highpass", f: 4000 }] });
    }
  },
  "stamp-thud": (v, p, t) => {
    v.noise({ t, dur: 0.012, peak: 0.2, filters: [{ type: "bandpass", f: 2600, q: 1.5 }] });
    v.tone({ t: t + 0.012, f: 120 * p, f2: 52 * p, fT: 0.09, dur: 0.22, peak: 0.8 });
    v.noise({ t: t + 0.012, dur: 0.09, peak: 0.45, kind: "pink", filters: [{ type: "lowpass", f: 900, f2: 300 }] });
    v.noise({ t: t + 0.04, dur: 0.05, peak: 0.1, filters: [{ type: "bandpass", f: 4500, q: 0.7 }] });
  },
  "laser-zap": (v, p, t) => {
    v.tone({ t, f: 2600 * p, f2: 200 * p, fT: 0.17, dur: 0.22, peak: 0.22, type: "sawtooth", filters: [{ type: "lowpass", f: 6000, f2: 900, T: 0.17, q: 2 }] });
    v.tone({ t, f: 2650 * p, f2: 190 * p, fT: 0.17, dur: 0.2, peak: 0.1, type: "square", detune: 35, filters: [{ type: "lowpass", f: 3000 }] });
    v.tone({ t, f: 110 * p, f2: 60 * p, dur: 0.12, peak: 0.22 });
    v.noise({ t, dur: 0.05, peak: 0.14, filters: [{ type: "highpass", f: 5000 }] });
  },
  "paper-flutter": (v, p, t) => {
    const { amp } = v.noise({ t, dur: 0.5, raw: true, filters: [{ type: "highpass", f: 1800 * p }, { type: "bandpass", f: 4200 * p, q: 0.6 }] });
    flicker(amp, t, 0.46, 0.5, [0.018, 0.04], (x) => Math.pow(1 - x, 0.8) * Math.min(1, x * 12 + 0.4), 0.003);
  },
  cannon: (v, p, t) => {
    v.tone({ t, f: 130 * p, f2: 28 * p, fT: 0.35, dur: 0.75, peak: 0.85 });
    v.noise({ t, dur: 0.3, peak: 0.55, kind: "pink", filters: [{ type: "bandpass", f: 700, f2: 180, T: 0.3, q: 0.7 }] });
    v.noise({ t, dur: 0.05, peak: 0.35, filters: [{ type: "highpass", f: 1500 }] });
    v.noise({ t, dur: 1.0, peak: 0.4, a: 0.05, kind: "brown", filters: [{ type: "lowpass", f: 260, f2: 120 }] });
  },
  splash: (v, p, t) => {
    v.noise({ t, dur: 0.4, peak: 0.34, a: 0.01, kind: "pink", filters: [{ type: "bandpass", f: 2600 * p, f2: 900 * p, T: 0.35, q: 0.7 }] });
    v.noise({ t, dur: 0.2, peak: 0.12, filters: [{ type: "highpass", f: 5000 }] });
    v.tone({ t, f: 240 * p, f2: 90 * p, fT: 0.18, dur: 0.26, peak: 0.35 });
    for (let i = 0; i < 4; i++) {
      const f = rnd(500, 1100) * p;
      v.tone({ t: t + 0.08 + rnd(0, 0.4), f, f2: f * 1.7, fT: 0.05, dur: 0.07, peak: 0.13 });
    }
  },
  "barrel-roll": (v, p, t) => {
    v.noise({ t, dur: 0.95, peak: 0.28, a: 0.2, kind: "brown", filters: [{ type: "lowpass", f: 380 }] });
    for (let i = 0; i < 8; i++) {
      const ti = t + i * 0.105 - i * i * 0.0012;
      const e = Math.sin((Math.PI * (i + 0.5)) / 8);
      v.tone({ t: ti, f: 120 * p * rnd(0.9, 1.15), f2: 70 * p, dur: 0.075, peak: 0.28 * e });
      v.noise({ t: ti, dur: 0.02, peak: 0.12 * e, filters: [{ type: "bandpass", f: 1800, q: 1.4 }] });
    }
    v.panSweep(-0.5, 0.5, t, 0.9);
  },
  glitch: (v, p, t) => {
    const dur = 0.38;
    const { osc, amp } = v.tone({ t, f: 800 * p, type: "square", dur, raw: true, filters: [{ type: "lowpass", f: 5000, q: 1 }] });
    amp.gain.setValueAtTime(0, t);
    for (let i = 0; i < 11; i++) {
      const tt = t + i * 0.033 + rnd(0, 0.01);
      osc.frequency.setValueAtTime(rnd(180, 3800) * p, tt);
      amp.gain.setValueAtTime(Math.random() > 0.3 ? rnd(0.08, 0.2) : 0, tt);
    }
    amp.gain.setValueAtTime(0, t + dur);
    const n = v.noise({ t, dur, raw: true, filters: [{ type: "highpass", f: 5000 }] });
    n.amp.gain.setValueAtTime(0, t);
    for (let i = 0; i < 8; i++) n.amp.gain.setValueAtTime(Math.random() > 0.5 ? rnd(0.06, 0.16) : 0, t + i * 0.045);
    n.amp.gain.setValueAtTime(0, t + dur);
    v.tone({ t, f: 1600 * p, f2: 100 * p, dur: 0.34, peak: 0.1, type: "sawtooth", filters: [{ type: "lowpass", f: 900 }] });
  },
  "avalanche-warn": (v, p, t) => {
    v.noise({ t, dur: 1.2, peak: 0.6, a: 0.7, kind: "brown", filters: [{ type: "lowpass", f: 180, f2: 420, T: 0.9, q: 1 }] });
    v.tone({ t, f: 40 * p, f2: 52 * p, dur: 1.1, peak: 0.3, a: 0.5, trem: { rate: 9, depth: 0.5 } });
    for (let i = 0; i < 5; i++) v.noise({ t: t + 0.2 + rnd(0, 0.7), dur: 0.03, peak: 0.16, filters: [{ type: "highpass", f: 2500 }] });
    // Alphorn-Signal
    v.tone({ t: t + 0.05, f: 174.6 * p, dur: 0.75, peak: 0.1, type: "sawtooth", a: 0.15, filters: [{ type: "lowpass", f: 650 }], vib: { rate: 4.5, depth: 12 } });
  },
  rockfall: (v, p, t) => {
    v.noise({ t, dur: 0.95, peak: 0.28, a: 0.2, kind: "brown", filters: [{ type: "lowpass", f: 320 }] });
    for (let i = 0; i < 11; i++) {
      const at = t + rnd(0, 0.7);
      const f = rnd(120, 420) * p;
      v.tone({ t: at, f, f2: f * 0.6, dur: 0.06, peak: rnd(0.1, 0.3) });
      v.noise({ t: at, dur: 0.03, peak: 0.12, filters: [{ type: "bandpass", f: rnd(900, 2600), q: 1.2 }] });
    }
    v.tone({ t: t + 0.72, f: 90 * p, f2: 45 * p, dur: 0.32, peak: 0.55 });
    v.noise({ t: t + 0.72, dur: 0.12, peak: 0.34, kind: "pink", filters: [{ type: "lowpass", f: 1200, f2: 300 }] });
  },
  crumble: (v, p, t) => {
    v.noise({ t, dur: 0.6, peak: 0.28, a: 0.08, kind: "brown", filters: [{ type: "lowpass", f: 400, f2: 150, T: 0.6 }] });
    v.noise({ t, dur: 0.04, peak: 0.2, filters: [{ type: "highpass", f: 2000 }] });
    for (let i = 0; i < 12; i++) {
      v.noise({
        t: t + i * 0.045 + rnd(0, 0.02), dur: rnd(0.03, 0.06), peak: 0.15 * (1 - i / 16),
        filters: [{ type: "bandpass", f: (3200 - i * 150) * p, q: 1.1 }],
      });
    }
  },
  "bee-buzz": (v, p, t) => {
    const f = 170 * p;
    v.tone({ t, f, f2: f * 1.26, fT: 0.5, dur: 0.58, peak: 0.16, type: "sawtooth", a: 0.12, vib: { rate: 32, depth: 70 }, filters: [{ type: "bandpass", f: 700, q: 2 }] });
    v.tone({ t, f: f * 1.05, f2: f * 1.33, fT: 0.5, dur: 0.58, peak: 0.12, type: "sawtooth", a: 0.12, vib: { rate: 29, depth: 60 }, filters: [{ type: "bandpass", f: 900, q: 2 }] });
    v.noise({ t, dur: 0.5, peak: 0.06, a: 0.1, filters: [{ type: "bandpass", f: 1800, q: 2 }] });
    v.panSweep(-0.6, 0.6, t, 0.58);
  },
  pigeon: (v, p, t) => {
    for (const dt of [0, 0.13]) {
      v.tone({ t: t + dt, f: 400 * p, f2: 340 * p, fT: 0.07, dur: 0.11, peak: 0.22, type: "triangle", a: 0.01, filters: [{ type: "lowpass", f: 900, q: 1 }] });
    }
    const at = t + 0.28;
    v.tone({ t: at, f: 330 * p, f2: 440 * p, fT: 0.12, dur: 0.32, peak: 0.26, type: "triangle", a: 0.03, filters: [{ type: "lowpass", f: 1000 }], trem: { rate: 33, depth: 0.55 } });
    v.tone({ t: at, f: 660 * p, f2: 880 * p, fT: 0.12, dur: 0.25, peak: 0.05, a: 0.03 });
  },
  "enemy-defeat": (v, p, t) => {
    v.noise({ t, dur: 0.16, peak: 0.36, kind: "pink", filters: [{ type: "bandpass", f: 1500, f2: 500, T: 0.15, q: 0.8 }] });
    v.tone({ t, f: 620 * p, f2: 140 * p, fT: 0.09, dur: 0.14, peak: 0.4, type: "triangle" });
    v.bell({ t: t + 0.06, f: G6 * p, dur: 0.3, peak: 0.16 });
    v.bell({ t: t + 0.12, f: 2349 * p, dur: 0.4, peak: 0.14 });
  },
};

// -----------------------------------------------------------------------------------------------
// Meta: Priorität, Pegel, Hall, Polyphonie-Grenze, Ducking der Musik
// -----------------------------------------------------------------------------------------------

export interface SfxMeta {
  /** 0 = kann jederzeit verworfen werden, 1 = normal, 2 = wichtig (darf Stimmen stehlen) */
  pri: 0 | 1 | 2;
  /** Pegel-Feinabgleich */
  gain: number;
  /** Reverb-Send 0..1 */
  reverb: number;
  /** max. gleichzeitige Stimmen dieses Effekts */
  max: number;
  /** Mindestabstand identischer Effekte in Sekunden (global mindestens MIN_REPEAT_GAP) */
  gap?: number;
  /** Musik beim Abspielen kurz absenken */
  duck?: readonly [amount: number, sec: number];
}

const m = (pri: 0 | 1 | 2, gain: number, reverb: number, max = 4, extra: Partial<SfxMeta> = {}): SfxMeta => ({ pri, gain, reverb, max, ...extra });

export const SFX_META: Record<SfxName, SfxMeta> = {
  "ui-click": m(1, 1, 0.05, 3),
  "ui-hover": m(0, 0.8, 0.03, 2, { gap: 0.05 }),
  "ui-back": m(1, 1, 0.05, 2),
  "ui-buy": m(1, 1, 0.3, 2),
  "ui-denied": m(1, 1, 0.05, 2, { gap: 0.1 }),
  jump: m(1, 1, 0.1, 3),
  doublejump: m(1, 1, 0.14, 3),
  land: m(1, 1, 0.08, 3, { gap: 0.06 }),
  slide: m(0, 1, 0.06, 2, { gap: 0.08 }),
  dash: m(1, 1, 0.12, 2),
  stomp: m(1, 1, 0.1, 3),
  "stomp-chain": m(1, 1, 0.22, 3),
  spring: m(1, 1, 0.15, 2),
  portal: m(1, 1, 0.4, 2),
  wallbreak: m(2, 1, 0.3, 2),
  coin: m(0, 1, 0.2, 5),
  gem: m(1, 1, 0.35, 3),
  heart: m(1, 1, 0.3, 2),
  powerup: m(1, 1, 0.3, 2),
  "shield-on": m(1, 1, 0.35, 2),
  "shield-hit": m(1, 1, 0.2, 2),
  "slowmo-on": m(1, 1, 0.4, 1),
  "slowmo-off": m(1, 1, 0.3, 1),
  "magnet-on": m(1, 1, 0.25, 1),
  hurt: m(2, 1, 0.12, 2, { duck: [0.35, 0.5] }),
  death: m(2, 1, 0.35, 1, { duck: [0.8, 2.2] }),
  "near-miss": m(0, 1, 0.1, 2, { gap: 0.1 }),
  "combo-up": m(1, 1, 0.25, 2),
  "combo-break": m(1, 1, 0.15, 1),
  countdown: m(2, 1, 0.12, 1),
  go: m(2, 1, 0.3, 1),
  checkpoint: m(2, 1, 0.4, 1, { duck: [0.3, 0.9] }),
  "world-transition": m(2, 1, 0.5, 1, { duck: [0.6, 2.0] }),
  gameover: m(2, 1, 0.55, 1, { duck: [0.9, 3.4] }),
  highscore: m(2, 1, 0.45, 1, { duck: [0.7, 2.8] }),
  "lightning-warn": m(1, 1, 0.15, 1),
  thunder: m(1, 1, 0.4, 2, { duck: [0.25, 1.2] }),
  "tram-bell": m(1, 1, 0.2, 2),
  "stamp-thud": m(1, 1, 0.08, 3),
  "laser-zap": m(1, 1, 0.15, 3),
  "paper-flutter": m(0, 1, 0.1, 2, { gap: 0.1 }),
  cannon: m(2, 1, 0.3, 2),
  splash: m(1, 1, 0.25, 2),
  "barrel-roll": m(1, 1, 0.1, 2),
  glitch: m(1, 1, 0.1, 2, { gap: 0.08 }),
  "avalanche-warn": m(1, 1, 0.3, 1),
  rockfall: m(1, 1, 0.2, 2),
  crumble: m(1, 1, 0.15, 3),
  "bee-buzz": m(0, 1, 0.1, 3, { gap: 0.15 }),
  pigeon: m(0, 1, 0.15, 2, { gap: 0.15 }),
  "enemy-defeat": m(1, 1, 0.2, 3),
};

/** Globale Grenzen (Mobilgeräte!) */
export const MAX_VOICES = 24;
/** Identische SFX innerhalb dieser Zeit werden verworfen. */
export const MIN_REPEAT_GAP = 0.03;
/** Vorlauf, damit Hüllkurven nicht in der Vergangenheit beginnen. */
export const START_LEAD = 0.008;
/** Coin-Kette: Reset nach dieser Pause. */
export const COIN_RESET_SEC = 0.7;

/**
 * Verwaltung der SFX-Stimmen: Drosselung, Polyphonie-Cap mit Prioritäten/Stealing,
 * Coin-Kette. `play` liefert die Stimme oder null, wenn der Effekt verworfen wurde.
 */
export class SfxPlayer {
  private voices: SfxVoice[] = [];
  private last = new Map<SfxName, number>();
  private coinIdx = -1;
  private coinLast = -Infinity;
  played = 0;
  dropped = 0;
  stolen = 0;

  constructor(private readonly g: AudioGraph) {}

  get activeVoices(): number {
    return this.voices.length;
  }

  private remove(v: SfxVoice): void {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
  }

  private steal(v: SfxVoice, now: number): void {
    this.remove(v);
    v.kill(now);
    this.stolen++;
  }

  play(name: SfxName, opts: SfxOptions = {}, when?: number): SfxVoice | null {
    const ctx = this.g.ctx;
    const now = when ?? ctx.currentTime;
    const meta = SFX_META[name];
    const recipe = RECIPES[name];
    if (!meta || !recipe) return null;

    // hängengebliebene Stimmen (onended blieb aus) freigeben
    for (const v of this.voices.slice()) {
      if (v.endTime + 1 < now) {
        this.remove(v);
        v.dispose();
      }
    }

    const lastT = this.last.get(name);
    if (lastT !== undefined && now - lastT < Math.max(MIN_REPEAT_GAP, meta.gap ?? 0)) {
      this.dropped++;
      return null;
    }

    // pro Effekt begrenzen
    let same = 0;
    let oldestSame: SfxVoice | null = null;
    for (const v of this.voices) {
      if (v.name === name) {
        same++;
        if (!oldestSame) oldestSame = v;
      }
    }
    if (same >= meta.max) {
      if (oldestSame && meta.pri >= 1) this.steal(oldestSame, now);
      else {
        this.dropped++;
        return null;
      }
    }

    // globaler Cap
    if (this.voices.length >= MAX_VOICES) {
      let victim: SfxVoice | null = null;
      if (meta.pri >= 1) {
        for (const v of this.voices) {
          if (v.priority < meta.pri && (!victim || v.priority < victim.priority)) victim = v;
        }
        if (!victim && meta.pri >= 2) victim = this.voices[0] ?? null;
      }
      if (!victim) {
        this.dropped++;
        return null;
      }
      this.steal(victim, now);
    }

    // Tonhöhe: Coin-Kette steigt pentatonisch, wenn der Aufrufer keine Tonhöhe vorgibt
    let pitch = clamp(opts.pitch ?? 1, 0.25, 4);
    if (name === "coin" && opts.pitch === undefined) {
      this.coinIdx = now - this.coinLast > COIN_RESET_SEC ? 0 : Math.min(this.coinIdx + 1, COIN_STEPS.length - 1);
      pitch = Math.pow(2, COIN_STEPS[this.coinIdx] / 12);
    }
    if (name === "coin") this.coinLast = now;

    const volume = clamp(opts.volume ?? 1, 0, 1) * meta.gain;
    if (volume <= 0.001) {
      this.dropped++;
      return null;
    }
    this.last.set(name, now);

    const t0 = now + START_LEAD;
    const voice = new SfxVoice(this.g, {
      volume,
      pan: clamp(opts.pan ?? 0, -1, 1),
      reverb: meta.reverb,
      t0,
      priority: meta.pri,
      name,
    });
    voice.onDispose = () => this.remove(voice);
    this.voices.push(voice);
    try {
      recipe(voice, pitch, t0);
    } catch {
      voice.dispose();
      this.remove(voice);
      return null;
    }
    this.played++;
    return voice;
  }

  dispose(): void {
    for (const v of this.voices.slice()) v.dispose();
    this.voices.length = 0;
  }
}
