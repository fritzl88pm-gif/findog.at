/**
 * Kompositionsdaten der sieben Musikthemen – reine Daten, keine Audio-Abhängigkeit.
 * Synthese: synth.ts, Notation-Parser: notation.ts, Scheduler: music.ts.
 *
 * Notation (Strings pro Takt, Tokens durch Leerzeichen getrennt, `:n` = Dauer in Steps, Standard 1):
 *   kind "notes"  – absolute Noten:      "E5:2 G5 A5:3"   Pause "-", Bindung "~", Akkord "C4+E4+G4:2"
 *                   Suffix "!" = betont, "?" = leise.
 *   kind "chord"  – akkordbezogen:       "1:2 -:2 5:2"    1/3/5/7 = Akkordton, c = ganzer Akkord,
 *                   t = ohne Grundton, p = Grundton+Quinte, u/d = Oktave höher/tiefer ("1u", "5d").
 *                   Die Oktave der Grundtöne steht in `oct` (C3 = 3).
 *   kind "drums"  – pro Schlagzeug-Stimme ein Step-String: "x..o" (x normal, X betont, o Ghost, . Pause).
 * Jeder Takt muss genau `beatsPerBar * stepsPerBeat` Steps füllen (wird von den Tests geprüft).
 * Takt i eines Tracks ist `bars[i % bars.length]`, der Akkord von Takt i ist `chords[i % chords.length]`.
 */
import type { WorldMusicId } from "./types";

export type InstId =
  | "pad-warm" | "pad-strings" | "pad-air" | "pad-cold" | "pad-supersaw" | "drone"
  | "accordion" | "strings-lead" | "yodel" | "calliope" | "organ-chord" | "lead-synth"
  | "pizz" | "pluck-soft" | "pluck-bright" | "guitar" | "pluck-synth" | "pluck-cold"
  | "bell" | "bell-soft" | "chime-cold"
  | "bass-warm" | "bass-pizz" | "bass-tuba" | "bass-muted" | "bass-roll";

export type DrumId =
  | "kick" | "kick-soft" | "snare" | "snare-soft" | "rim" | "clap" | "hat" | "ohat" | "shaker"
  | "timpani" | "stamp" | "tick" | "tock" | "click" | "slap" | "cowbell" | "wood" | "crash" | "rumble" | "tom";

export type LayerIndex = 0 | 1 | 2 | 3;

interface TrackBase {
  name: string;
  /** 0 = Pad/Harmonie, 1 = Bass/Begleitung, 2 = Drums/Percussion, 3 = Lead/Arpeggio */
  layer: LayerIndex;
  /** relativer Pegel des Tracks */
  gain: number;
  /** -1..1 */
  pan?: number;
}
export interface NotesTrack extends TrackBase {
  kind: "notes";
  inst: InstId;
  bars: string[];
}
export interface ChordTrack extends TrackBase {
  kind: "chord";
  inst: InstId;
  /** Oktave des Grundtons (C3 = 3) */
  oct: number;
  bars: string[];
}
export interface DrumTrack extends TrackBase {
  kind: "drums";
  bars: Array<Partial<Record<DrumId, string>>>;
}
export type TrackData = NotesTrack | ChordTrack | DrumTrack;

export interface ThemeData {
  id: WorldMusicId;
  title: string;
  bpm: number;
  beatsPerBar: number;
  stepsPerBeat: number;
  /** Länge des Loops in Takten */
  bars: number;
  /** 0..0.4: verzögert jeden zweiten Step (nur bei gradem stepsPerBeat) */
  swing?: number;
  /** Intensität, wenn play() keine angibt */
  defaultIntensity: number;
  /** Akkord pro Takt (wird zyklisch wiederholt) */
  chords: string[];
  tracks: TrackData[];
  /** Reverb-Send pro Layer (0..1) */
  reverb: [number, number, number, number];
  /** Themen-Pegel (Feinabgleich der Gesamtlautstärke) */
  gain: number;
  /** Echo-Delay (Alpen-Echo, Synthwave-Delay …) */
  echo?: { beats: number; feedback: number; mix: number; layers: LayerIndex[]; tone: number };
  /** Sidechain-Pumpen: Layer werden bei jedem Auslöser-Schlag heruntergezogen */
  sidechain?: { layers: LayerIndex[]; depth: number; release: number; trigger: DrumId };
  /** Einblend-Bereiche der Layer 1..3 in der Intensität (Standard siehe LAYER_RANGES) */
  layerRanges?: [[number, number], [number, number], [number, number]];
}

/** Einblendbereiche der Layer 1..3 (Intensität von … bis voll hörbar). Layer 0 ist immer da. */
export const LAYER_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0.1, 0.32],
  [0.36, 0.58],
  [0.62, 0.86],
];

/** Pegel 0..1 eines Layers bei Intensität v (Hermite-Blend). */
export function layerLevel(layer: number, v: number, ranges: ReadonlyArray<readonly [number, number]> = LAYER_RANGES): number {
  if (layer <= 0) return 1;
  const r = ranges[layer - 1];
  if (!r) return 0;
  const x = Math.min(1, Math.max(0, (v - r[0]) / (r[1] - r[0])));
  return x * x * (3 - 2 * x);
}

const REST6 = "-:6";
const REST16 = "-:16";

// ------------------------------------------------------------------------------------------------
// MENU – warmer, einladender Walzer in G-Dur, 90 BPM, Glockenspiel + Pluck
// ------------------------------------------------------------------------------------------------
const MENU_LEAD = [
  "D6:3 B5:1 G5:1 B5:1", "E6:3 D6:1 C6:1 B5:1", "C6:3 E6:1 G6:1 E6:1", "A5:2 D6:2 F#6:2",
  "G6:3 D6:1 B5:1 D6:1", "F#6:3 D6:1 B5:1 D6:1", "E6:3 C6:1 A5:2", "F#5:2 A5:2 C6:2",
  "B5:3 E6:1 G6:1 E6:1", "E6:3 G6:1 E6:1 C6:1", "D6:3 B5:1 D6:1 G6:1", "F#6:4 D6:2",
  "C6:2 E6:2 G6:2", "E6:3 D6:1 C6:1 B5:1", "C6:2 A5:2 F#5:2", "B5:2 D6:2 G6:2",
];

const MENU: ThemeData = {
  id: "menu",
  title: "Fredruns Wanderlied",
  bpm: 90,
  beatsPerBar: 3,
  stepsPerBeat: 2,
  bars: 16,
  defaultIntensity: 0.8,
  chords: ["G", "Em", "C", "D7", "G", "Bm", "Am7", "D7", "Em", "C", "G", "D", "C", "Am7", "D7", "G"],
  reverb: [0.5, 0.3, 0.22, 0.45],
  gain: 1,
  tracks: [
    { name: "pad", layer: 0, kind: "chord", inst: "pad-warm", oct: 3, gain: 0.85, bars: ["c:6"] },
    { name: "hook", layer: 0, kind: "notes", inst: "bell-soft", gain: 0.5, pan: 0.2, bars: [MENU_LEAD[0], MENU_LEAD[1], REST6, REST6] },
    { name: "bass", layer: 1, kind: "chord", inst: "bass-warm", oct: 2, gain: 0.95, bars: ["1:2 -:4", "1:2 -:2 5:2"] },
    {
      name: "comp", layer: 1, kind: "chord", inst: "pluck-soft", oct: 3, gain: 0.7, pan: -0.25,
      bars: ["-:2 t:1 -:1 t:1 -:1", "-:2 t:1 -:1 t:1 -:1", "-:2 t:1 -:1 t:1 -:1", "3:1 5:1 1u:1 3u:1 5u:1 3u:1"],
    },
    {
      name: "perc", layer: 2, kind: "drums", gain: 0.7,
      bars: [{ "kick-soft": "x.....", "snare-soft": "..o.o.", shaker: "o.o.o." }],
    },
    { name: "lead", layer: 3, kind: "notes", inst: "bell", gain: 0.85, pan: 0.15, bars: MENU_LEAD },
  ],
};

// ------------------------------------------------------------------------------------------------
// WIEN – dramatisch-romantischer Sturm-Walzer in a-Moll, 136 BPM
// ------------------------------------------------------------------------------------------------
const WIEN_LEAD = [
  "E5:3 A5:2 C6:1", "B5:3 A5:2 G#5:1", "A5:3 F5:2 D5:1", "E5:2 G#5:2 B5:2",
  "C6:3 B5:1 A5:1 E5:1", "A5:3 F5:1 A5:1 C6:1", "D6:3 C6:1 A5:1 F5:1", "B5:3 G#5:1 E5:2",
  "G5:3 E5:1 G5:1 C6:1", "B5:3 D6:2 G6:1", "F6:3 E6:1 D6:1 A5:1", "G#5:2 B5:2 E6:2",
  "A6:3 G6:1 E6:1 C6:1", "F6:3 D6:1 A5:2", "G#5:2 B5:2 D6:1 B5:1", "E6:5 -:1",
];

const WIEN_PERC_A = { timpani: "x.....", "snare-soft": "..o.o." } as const;

const WIEN: ThemeData = {
  id: "wien",
  title: "Sturmwalzer an der Donau",
  bpm: 136,
  beatsPerBar: 3,
  stepsPerBeat: 2,
  bars: 16,
  defaultIntensity: 0.45,
  chords: ["Am", "Am", "Dm", "E7", "Am", "F", "Dm", "E7", "C", "G", "Dm", "E7", "Am", "Dm", "E7", "E7"],
  reverb: [0.55, 0.3, 0.2, 0.5],
  gain: 1,
  tracks: [
    { name: "strings", layer: 0, kind: "chord", inst: "pad-strings", oct: 3, gain: 0.85, bars: ["c:6"] },
    { name: "hook", layer: 0, kind: "notes", inst: "pizz", gain: 0.5, pan: 0.15, bars: [WIEN_LEAD[0], WIEN_LEAD[1], REST6, REST6] },
    { name: "bass", layer: 1, kind: "chord", inst: "bass-pizz", oct: 2, gain: 0.95, bars: ["1:2 -:4"] },
    { name: "pizz", layer: 1, kind: "chord", inst: "pizz", oct: 3, gain: 0.6, pan: -0.25, bars: ["-:2 t:1 -:1 t:1 -:1"] },
    {
      name: "storm", layer: 2, kind: "drums", gain: 0.8,
      bars: [
        WIEN_PERC_A, WIEN_PERC_A, WIEN_PERC_A, { ...WIEN_PERC_A, rumble: "x....." },
        WIEN_PERC_A, WIEN_PERC_A, WIEN_PERC_A, { timpani: "x.oxox", "snare-soft": "..xxxx", rumble: "x....." },
      ],
    },
    { name: "violin", layer: 3, kind: "notes", inst: "strings-lead", gain: 0.85, pan: 0.1, bars: WIEN_LEAD },
    { name: "swirl", layer: 3, kind: "chord", inst: "pizz", oct: 3, gain: 0.35, pan: -0.3, bars: ["1:1 3:1 5:1 3:1 5:1 3:1"] },
  ],
};

// ------------------------------------------------------------------------------------------------
// ALPEN – heller Ländler in C-Dur, 120 BPM, Jodel-Lead, Schuhplattler, Bergecho
// ------------------------------------------------------------------------------------------------
const ALPEN_LEAD = [
  "G4:1 C5:1 E5:1 C6:2 A5:1", "G5:1 B5:1 D6:2 B5:1 G5:1", "E6:2 C6:1 A5:1 G5:1 E5:1", "C6:3 -:3",
  "A4:1 C5:1 F5:1 A5:2 F5:1", "G4:1 C5:1 E5:1 G5:2 E5:1", "B4:1 D5:1 G5:1 B5:2 D6:1", "C6:4 G5:1 E5:1",
  "E5:1 G5:1 E5:1 C6:2 G5:1", "D5:1 G5:1 D5:1 B5:2 G5:1", "C6:1 E6:1 C6:1 G5:2 E5:1", "F5:1 A5:1 C6:1 F6:2 C6:1",
  "E6:2 G5:1 C6:2 E5:1", "D6:1 B5:1 G5:1 B5:1 D6:1 G5:1", "C6:3 G5:1 E5:1 G5:1", "B5:2 G5:2 D5:2",
];

const ALPEN: ThemeData = {
  id: "alpen",
  title: "Jodler überm Gipfel",
  bpm: 120,
  beatsPerBar: 3,
  stepsPerBeat: 2,
  bars: 16,
  defaultIntensity: 0.5,
  chords: ["C", "G7", "C", "C", "F", "C", "G7", "C", "C", "G7", "C", "F", "C", "G7", "C", "G7"],
  reverb: [0.6, 0.25, 0.2, 0.6],
  gain: 1,
  echo: { beats: 2, feedback: 0.32, mix: 0.3, layers: [3], tone: 3200 },
  tracks: [
    { name: "air", layer: 0, kind: "chord", inst: "pad-air", oct: 4, gain: 0.85, bars: ["c:6"] },
    {
      name: "glocken", layer: 0, kind: "notes", inst: "bell-soft", gain: 0.45, pan: 0.25,
      bars: ["G5:1 C6:1 E6:1 C7:2 A6:1", "G6:1 B6:1 D7:2 B6:1 G6:1", REST6, REST6],
    },
    { name: "bass", layer: 1, kind: "chord", inst: "bass-warm", oct: 2, gain: 0.95, bars: ["1:2 -:4", "1:2 -:2 5:2"] },
    { name: "zither", layer: 1, kind: "chord", inst: "pluck-bright", oct: 3, gain: 0.65, pan: -0.3, bars: ["-:2 t:1 -:1 t:1 -:1"] },
    {
      name: "plattler", layer: 2, kind: "drums", gain: 0.8,
      bars: [
        { "kick-soft": "x.....", slap: "..x.x." },
        { "kick-soft": "x.....", slap: "..o.xo", cowbell: "x....." },
      ],
    },
    { name: "jodel", layer: 3, kind: "notes", inst: "yodel", gain: 0.9, pan: 0.05, bars: ALPEN_LEAD },
  ],
};

// ------------------------------------------------------------------------------------------------
// FINANZAMT – nächtlich-kühl, minimalistisch, 110 BPM in d-Moll
// ------------------------------------------------------------------------------------------------
const FINANZAMT: ThemeData = {
  id: "finanzamt",
  title: "Nachtschicht im Finanzamt",
  bpm: 110,
  beatsPerBar: 4,
  stepsPerBeat: 4,
  bars: 16,
  defaultIntensity: 0.4,
  chords: ["Dm7", "Dm7", "Bbmaj7", "Bbmaj7", "Gm7", "Gm7", "A7sus4", "A7"],
  reverb: [0.35, 0.12, 0.15, 0.4],
  gain: 1,
  echo: { beats: 0.75, feedback: 0.34, mix: 0.28, layers: [3], tone: 2600 },
  tracks: [
    { name: "drone", layer: 0, kind: "chord", inst: "drone", oct: 2, gain: 0.85, bars: ["1:16"] },
    { name: "kalt", layer: 0, kind: "chord", inst: "pad-cold", oct: 3, gain: 0.7, bars: ["c:16"] },
    {
      name: "uhr", layer: 0, kind: "drums", gain: 0.5, pan: -0.2,
      bars: [{ tick: "x... .... x... ....", tock: ".... x... .... x..." }],
    },
    {
      name: "chime", layer: 0, kind: "notes", inst: "chime-cold", gain: 0.5, pan: 0.25,
      bars: ["D5:3 -:1 F5:3 -:1 A5:4 -:4", "G5:3 -:1 F5:3 -:1 E5:4 -:4", REST16, REST16],
    },
    {
      name: "bass", layer: 1, kind: "chord", inst: "bass-muted", oct: 2, gain: 0.95,
      bars: [
        "1:2 -:1 1:1 -:2 1:1 -:1 5:1 -:1 1:2 -:1 1:1 -:2",
        "1:2 -:1 1:1 -:2 1:1 -:1 5:1 -:1 1:2 -:1 1:1 -:2",
        "1:1 -:1 1:1 -:1 1u:1 -:1 1:1 -:1 1:1 -:1 5:1 -:1 1:2 -:2",
        "1:2 -:1 1:1 -:2 1:1 -:1 5:1 -:1 1:2 -:1 1:1 -:2",
      ],
    },
    {
      name: "buero", layer: 2, kind: "drums", gain: 0.75,
      bars: [
        { stamp: "x... .... x... ....", click: "..x. x... ..x. x.x.", hat: "o.x. o.x. o.x. o.x.", rim: ".... x... .... x..." },
        { stamp: "x... ..x. x... ....", click: "..x. x... .x.. x.x.", hat: "o.x. o.x. o.x. o.xo", rim: ".... x... .... x..." },
      ],
    },
    {
      name: "arp", layer: 3, kind: "chord", inst: "pluck-cold", oct: 4, gain: 0.85, pan: 0.2,
      bars: [
        "1 . 5 . 7 . 5 . 1u . 7 . 5 . 3 .",
        "1 . 5 . 7 . 5 . 1u . 7 . 5 . 3 .",
        "1 . 3 . 5 . 7 . 5 . 3 . 1u . 7 .",
        "1 . 5 . 7 . 5 . 1u . 7 . 5 . 3 .",
      ],
    },
  ],
};

// ------------------------------------------------------------------------------------------------
// PRATER – Jahrmarkt, Kalliope, Oompah, 150 BPM in C-Dur mit Moll-Ausflügen
// ------------------------------------------------------------------------------------------------
const PRATER_LEAD = [
  "E5:1 E5:1 C5:1 E5:1 G5:2 G4:2", "A5:1 A5:1 F5:1 A5:1 C6:2 C5:2", "E5:1 G5:1 E5:1 C5:1 G5:2 E5:2", "D5:1 F5:1 B4:1 D5:1 G5:2 -:2",
  "E5:1 E5:1 C5:1 E5:1 G5:2 C6:2", "E5:1 E5:1 C#5:1 E5:1 A5:2 G5:2", "F5:1 A5:1 F5:1 D5:1 A5:2 F5:2", "G5:1 F5:1 E5:1 D5:1 B4:2 D5:2",
  "C6:1 B5:1 C6:1 E6:1 G5:2 E5:2", "G#5:1 B5:1 E6:1 B5:1 G#5:2 E5:2", "A5:1 C6:1 E6:1 C6:1 A5:2 E5:2", "F5:1 Ab5:1 C6:1 Ab5:1 F5:2 C5:2",
  "E5:1 G5:1 C6:1 G5:1 E6:2 C6:2", "D6:1 B5:1 G5:1 B5:1 D6:2 F5:2", "E6:1 C6:1 G5:1 E5:1 C6:2 G5:2", "G5:1 A5:1 B5:1 D6:1 G6:2 -:2",
];
const PRATER_DRUMS = { kick: "x...x...", snare: "..x...x.", hat: ".o.o.o.o" } as const;

const PRATER: ThemeData = {
  id: "prater",
  title: "Karussell im Prater",
  bpm: 150,
  beatsPerBar: 4,
  stepsPerBeat: 2,
  bars: 16,
  swing: 0.1,
  defaultIntensity: 0.55,
  chords: ["C", "F", "C", "G7", "C", "A7", "Dm", "G7", "C", "E7", "Am", "Fm", "C", "G7", "C", "G7"],
  reverb: [0.35, 0.18, 0.15, 0.3],
  gain: 1,
  tracks: [
    { name: "orgel", layer: 0, kind: "chord", inst: "calliope", oct: 4, gain: 0.45, bars: ["c:8"] },
    { name: "hook", layer: 0, kind: "notes", inst: "bell-soft", gain: 0.5, pan: 0.25, bars: [PRATER_LEAD[0], PRATER_LEAD[1], "-:8", "-:8"] },
    { name: "tuba", layer: 1, kind: "chord", inst: "bass-tuba", oct: 2, gain: 0.95, bars: ["1:2 -:2 5:2 -:2"] },
    { name: "oompah", layer: 1, kind: "chord", inst: "organ-chord", oct: 4, gain: 0.7, pan: -0.2, bars: ["-:2 c:1 -:1 -:2 c:1 -:1"] },
    {
      name: "marsch", layer: 2, kind: "drums", gain: 0.8,
      bars: [
        { ...PRATER_DRUMS, crash: "x......." }, PRATER_DRUMS, PRATER_DRUMS, PRATER_DRUMS,
        PRATER_DRUMS, PRATER_DRUMS, PRATER_DRUMS, { kick: "x...x...", snare: "..x.xxxx", hat: ".o.o.o.o", crash: ".......x" },
      ],
    },
    { name: "kalliope", layer: 3, kind: "notes", inst: "calliope", gain: 0.85, bars: PRATER_LEAD },
    { name: "glocken", layer: 3, kind: "chord", inst: "bell", oct: 5, gain: 0.35, pan: 0.3, bars: ["1 3 5 3 1u 3 5 3"] },
  ],
};

// ------------------------------------------------------------------------------------------------
// WACHAU – pastorales Gold, Akkordeon, 3/4 ~112 BPM, d-Moll ↔ F-Dur
// ------------------------------------------------------------------------------------------------
const WACHAU_LEAD = [
  "A4:2 D5:2 F5:2", "E5:3 D5:1 C5:1 D5:1", "Bb4:2 D5:2 G5:2", "E5:3 C#5:1 A4:2",
  "D5:2 F5:2 A5:2", "C6:3 A5:2 F5:1", "D6:3 Bb5:1 D6:1 F5:1", "E5:2 G5:2 C#6:2",
  "A5:3 C6:2 F6:1", "E6:3 D6:1 C6:1 Bb5:1", "A5:2 C6:2 F6:2", "D6:3 C6:1 Bb5:2",
  "G5:2 Bb5:2 D6:2", "C#6:3 E6:1 A5:2", "D6:3 F6:1 A5:1 D6:1", "E6:4 C#6:2",
];

const WACHAU: ThemeData = {
  id: "wachau",
  title: "Herbstgold an der Donau",
  bpm: 112,
  beatsPerBar: 3,
  stepsPerBeat: 2,
  bars: 16,
  swing: 0.06,
  defaultIntensity: 0.45,
  chords: ["Dm", "Dm", "Gm", "A7", "Dm", "F", "Bb", "A7", "F", "C7", "F", "Bb", "Gm", "A7", "Dm", "A7"],
  reverb: [0.5, 0.25, 0.2, 0.45],
  gain: 1,
  tracks: [
    { name: "balg", layer: 0, kind: "chord", inst: "accordion", oct: 3, gain: 0.5, bars: ["c:6"] },
    { name: "hook", layer: 0, kind: "notes", inst: "guitar", gain: 0.55, pan: 0.2, bars: [WACHAU_LEAD[0], WACHAU_LEAD[1], REST6, REST6] },
    { name: "bass", layer: 1, kind: "chord", inst: "bass-warm", oct: 2, gain: 0.95, bars: ["1:2 -:4", "1:2 -:2 5:2"] },
    {
      name: "zupf", layer: 1, kind: "chord", inst: "guitar", oct: 3, gain: 0.7, pan: -0.3,
      bars: ["-:2 t:1 -:1 t:1 -:1", "-:2 t:1 -:1 t:1 -:1", "-:2 t:1 -:1 t:1 -:1", "1:1 5:1 3:1 5:1 3:1 5:1"],
    },
    { name: "perc", layer: 2, kind: "drums", gain: 0.7, bars: [{ "kick-soft": "x.....", shaker: "o.o.o.", rim: "..o.o." }] },
    { name: "akkordeon", layer: 3, kind: "notes", inst: "accordion", gain: 0.85, pan: 0.05, bars: WACHAU_LEAD },
  ],
};

// ------------------------------------------------------------------------------------------------
// CYBER – Synthwave, 4/4 128 BPM in a-Moll, Sidechain-Pumpen, Dotted-Delay
// ------------------------------------------------------------------------------------------------
const CYBER_LEAD = [
  "A5:4 -:2 C6:2 E6:4 D6:2 C6:2", "A5:4 -:2 C6:2 F6:4 E6:2 C6:2", "G5:4 -:2 C6:2 E6:4 G6:2 E6:2", "D6:4 -:2 B5:2 G5:4 -:4",
  "A5:4 -:2 C6:2 E6:4 G6:2 E6:2", "A5:2 C6:2 F6:4 A6:4 -:2 F6:2", "D6:4 -:2 F6:2 A6:4 F6:2 D6:2", "E6:6 D6:2 B5:4 G#5:4",
  "E6:4 -:2 C6:2 A5:4 C6:4", "F6:4 -:2 C6:2 A5:4 C6:4", "G6:4 -:2 E6:2 C6:4 E6:4", "D6:4 B5:2 D6:2 G6:6 -:2",
  "A5:2 C6:2 E6:2 A6:6 G6:2 E6:2", "F6:4 E6:2 C6:2 A5:4 C6:4", "D6:4 F6:2 A6:2 G6:4 F6:4", "E6:4 G#5:4 B5:4 E6:4",
];
const CYBER_A = { kick: "x...x...x...x...", clap: "....x.......x...", ohat: "..x...x...x...x.", hat: ".o.o.o.o.o.o.o.o" } as const;
const CYBER_FILL = { kick: "x...x...x...x.xx", clap: "....x.......x.x.", ohat: "..x...x...x.....", hat: ".o.o.o.oxxxxxxxx" } as const;

const CYBER: ThemeData = {
  id: "cyber",
  title: "Neon-Nachtfahrt",
  bpm: 128,
  beatsPerBar: 4,
  stepsPerBeat: 4,
  bars: 16,
  defaultIntensity: 0.5,
  chords: ["Am", "F", "C", "G", "Am", "F", "Dm", "E"],
  reverb: [0.5, 0.1, 0.12, 0.4],
  gain: 1,
  echo: { beats: 0.75, feedback: 0.38, mix: 0.3, layers: [3], tone: 3600 },
  sidechain: { layers: [0, 1, 3], depth: 0.55, release: 0.2, trigger: "kick" },
  tracks: [
    { name: "supersaw", layer: 0, kind: "chord", inst: "pad-supersaw", oct: 3, gain: 0.8, bars: ["c:16"] },
    { name: "hook", layer: 0, kind: "notes", inst: "lead-synth", gain: 0.4, pan: 0.2, bars: [CYBER_LEAD[0], CYBER_LEAD[1], REST16, REST16] },
    {
      name: "rolling", layer: 1, kind: "chord", inst: "bass-roll", oct: 2, gain: 0.95,
      bars: [
        "1 1 1u 1 1 1 1u 1 1 1 1u 1 1 5 1u 1",
        "1 1 1u 1 1 1 1u 1 1 1 1u 1 1 5 1u 1",
        "1 1 1u 1 1 1 1u 1 1 1 1u 1 1 5 1u 1",
        "1 1 1u 1 1 1 1u 1 1 5 1u 5 3 5 1u 5",
      ],
    },
    { name: "drums", layer: 2, kind: "drums", gain: 0.85, bars: [CYBER_A, CYBER_A, CYBER_A, CYBER_FILL] },
    { name: "arp", layer: 3, kind: "chord", inst: "pluck-synth", oct: 4, gain: 0.5, pan: -0.25, bars: ["1 3 5 1u 3u 1u 5 3 1 3 5 1u 3u 1u 5 3"] },
    { name: "lead", layer: 3, kind: "notes", inst: "lead-synth", gain: 0.8, pan: 0.15, bars: CYBER_LEAD },
  ],
};

export const THEMES: Record<WorldMusicId, ThemeData> = {
  menu: MENU,
  wien: WIEN,
  alpen: ALPEN,
  finanzamt: FINANZAMT,
  prater: PRATER,
  wachau: WACHAU,
  cyber: CYBER,
};
