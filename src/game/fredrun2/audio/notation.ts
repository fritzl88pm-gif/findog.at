/**
 * Parser/Compiler für die Notations-Strings aus themes.ts. Reine Funktionen ohne Audio-Abhängigkeit.
 * Kompiliert ein Thema einmal zu Step-Tabellen: pro Track und Takt ein Array je Step.
 */
import type { ChordTrack, DrumId, DrumTrack, NotesTrack, ThemeData, TrackData } from "./themes";

export interface StepNote {
  /** MIDI-Noten (Akkord = mehrere) */
  midi: number[];
  /** Dauer in Steps */
  dur: number;
  vel: number;
}

export interface DrumHit {
  drum: DrumId;
  vel: number;
}

export interface CompiledTrack {
  data: TrackData;
  /** [Takt][Step] – nur bei notes/chord */
  notes: Array<Array<StepNote | null>>;
  /** [Takt][Step] – nur bei drums */
  drums: Array<Array<DrumHit[] | null>>;
}

export interface CompiledTheme {
  data: ThemeData;
  stepsPerBar: number;
  tracks: CompiledTrack[];
}

const PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C4" = 60, "A4" = 69, "F#5", "Bb3". */
export function noteToMidi(name: string): number | null {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) return null;
  const acc = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  return 12 * (parseInt(m[3], 10) + 1) + PITCH_CLASS[m[1]] + acc;
}

const CHORD_QUALITIES: Record<string, number[]> = {
  "": [0, 4, 7],
  m: [0, 3, 7],
  "7": [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  dim: [0, 3, 6],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  "7sus4": [0, 5, 7, 10],
  m6: [0, 3, 7, 9],
  "6": [0, 4, 7, 9],
  "5": [0, 7],
};

export interface ChordInfo {
  /** Tonhöhenklasse des Grundtons 0..11 */
  pc: number;
  intervals: number[];
}

export function parseChord(symbol: string): ChordInfo {
  const m = /^([A-G])([#b]?)(.*)$/.exec(symbol);
  if (!m) throw new Error(`Ungültiger Akkord "${symbol}"`);
  const quality = CHORD_QUALITIES[m[3]];
  if (!quality) throw new Error(`Unbekannte Akkordqualität "${m[3]}" in "${symbol}"`);
  const acc = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  return { pc: (PITCH_CLASS[m[1]] + acc + 12) % 12, intervals: quality };
}

/** Akkordtöne als MIDI; der Grundton liegt in Oktave `oct` (C3 = 3 -> C3 = 48). */
export function chordTones(symbol: string, oct: number): number[] {
  const c = parseChord(symbol);
  const root = 12 * (oct + 1) + c.pc;
  return c.intervals.map((i) => root + i);
}

const VEL_ACCENT = 1.2;
const VEL_SOFT = 0.65;

function velOf(mark: string): number {
  return mark === "!" ? VEL_ACCENT : mark === "?" ? VEL_SOFT : 1;
}

function fail(ctx: string, token: string, why: string): never {
  throw new Error(`${ctx}: Token "${token}" – ${why}`);
}

function parseDur(raw: string | undefined, ctx: string, token: string): number {
  if (raw === undefined || raw === "") return 1;
  const d = parseFloat(raw);
  if (!Number.isFinite(d) || d <= 0) fail(ctx, token, "ungültige Dauer");
  return d;
}

interface ParseCtx {
  label: string;
  stepsPerBar: number;
}

/** Gemeinsame Token-Schleife: `resolve` liefert die MIDI-Noten (leer = Pause) oder null für Bindung. */
function parseTokens(
  str: string,
  pc: ParseCtx,
  resolve: (pitch: string, mods: string, token: string) => number[] | "rest" | "tie",
  pattern: RegExp,
): Array<StepNote | null> {
  const out: Array<StepNote | null> = new Array<StepNote | null>(pc.stepsPerBar).fill(null);
  let cursor = 0;
  let last: StepNote | null = null;
  for (const token of str.trim().split(/\s+/)) {
    if (token === "") continue;
    const m = pattern.exec(token);
    if (!m) fail(pc.label, token, "unlesbar");
    const dur = parseDur(m[3], pc.label, token);
    const r = resolve(m[1], m[2] ?? "", token);
    if (r === "tie") {
      if (!last) fail(pc.label, token, "Bindung ohne vorherige Note");
      last.dur += dur;
    } else if (r === "rest") {
      last = null;
    } else {
      if (cursor >= pc.stepsPerBar) fail(pc.label, token, "Takt ist schon voll");
      const note: StepNote = { midi: r, dur, vel: velOf(m[4] ?? "") };
      out[Math.floor(cursor + 1e-9)] = note;
      last = note;
    }
    cursor += dur;
  }
  if (Math.abs(cursor - pc.stepsPerBar) > 1e-6) {
    throw new Error(`${pc.label}: Takt hat ${cursor} statt ${pc.stepsPerBar} Steps ("${str}")`);
  }
  return out;
}

const ABS_PATTERN = /^(-|~|[A-G][#b]?-?\d(?:\+[A-G][#b]?-?\d)*)()(?::(\d+(?:\.\d+)?))?([!?]?)$/;
const REL_PATTERN = /^(-|\.|~|[1-9]|c|t|p)([ud]*)(?::(\d+(?:\.\d+)?))?([!?]?)$/;

export function parseNotesBar(str: string, pc: ParseCtx): Array<StepNote | null> {
  return parseTokens(
    str,
    pc,
    (pitch, _mods, token) => {
      if (pitch === "-") return "rest";
      if (pitch === "~") return "tie";
      const midi: number[] = [];
      for (const part of pitch.split("+")) {
        const n = noteToMidi(part);
        if (n === null) fail(pc.label, token, `unbekannte Note ${part}`);
        midi.push(n);
      }
      return midi;
    },
    ABS_PATTERN,
  );
}

export function parseChordBar(str: string, symbol: string, oct: number, pc: ParseCtx): Array<StepNote | null> {
  const tones = chordTones(symbol, oct);
  return parseTokens(
    str,
    pc,
    (pitch, mods, token) => {
      if (pitch === "-" || pitch === ".") return "rest";
      if (pitch === "~") return "tie";
      let shift = 0;
      for (const ch of mods) shift += ch === "u" ? 12 : -12;
      let midi: number[];
      switch (pitch) {
        case "c":
          midi = tones.slice();
          break;
        case "t":
          midi = tones.slice(1);
          break;
        case "p":
          midi = [tones[0], tones[2] ?? tones[0] + 7];
          break;
        case "1":
          midi = [tones[0]];
          break;
        case "3":
          midi = [tones[1]];
          break;
        case "5":
          midi = [tones[2] ?? tones[0] + 7];
          break;
        case "7":
          midi = [tones[3] ?? tones[0] + 12];
          break;
        default:
          return fail(pc.label, token, `Akkordton ${pitch} nicht unterstützt`);
      }
      return midi.map((n) => n + shift);
    },
    REL_PATTERN,
  );
}

const DRUM_VEL: Record<string, number> = { x: 0.9, X: 1.2, o: 0.5 };

export function parseDrumBar(map: Partial<Record<DrumId, string>>, pc: ParseCtx): Array<DrumHit[] | null> {
  const out: Array<DrumHit[] | null> = new Array<DrumHit[] | null>(pc.stepsPerBar).fill(null);
  for (const [drum, raw] of Object.entries(map) as Array<[DrumId, string]>) {
    const line = raw.replace(/\s+/g, "");
    if (line.length !== pc.stepsPerBar) {
      throw new Error(`${pc.label}: Schlagzeugzeile "${drum}" hat ${line.length} statt ${pc.stepsPerBar} Steps`);
    }
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === ".") continue;
      const vel = DRUM_VEL[c];
      if (vel === undefined) fail(`${pc.label}/${drum}`, c, "unbekanntes Zeichen");
      (out[i] ??= []).push({ drum, vel });
    }
  }
  return out;
}

export function compileTheme(theme: ThemeData): CompiledTheme {
  const stepsPerBar = theme.beatsPerBar * theme.stepsPerBeat;
  if (!Number.isInteger(stepsPerBar) || stepsPerBar <= 0) throw new Error(`${theme.id}: ungültiges Taktmaß`);
  if (theme.chords.length === 0) throw new Error(`${theme.id}: keine Akkorde`);
  const tracks = theme.tracks.map((data): CompiledTrack => {
    const notes: CompiledTrack["notes"] = [];
    const drums: CompiledTrack["drums"] = [];
    for (let b = 0; b < theme.bars; b++) {
      const pc: ParseCtx = { label: `${theme.id}/${data.name} Takt ${b + 1}`, stepsPerBar };
      const pattern = data.bars[b % data.bars.length];
      if (data.kind === "drums") {
        drums.push(parseDrumBar(pattern as DrumTrack["bars"][number], pc));
      } else if (data.kind === "notes") {
        notes.push(parseNotesBar(pattern as NotesTrack["bars"][number], pc));
      } else {
        const chord = theme.chords[b % theme.chords.length];
        notes.push(parseChordBar(pattern as ChordTrack["bars"][number], chord, data.oct, pc));
      }
    }
    return { data, notes, drums };
  });
  return { data: theme, stepsPerBar, tracks };
}

const compiled = new Map<string, CompiledTheme>();

/** Kompiliert ein Thema einmal und merkt es sich. */
export function getCompiledTheme(theme: ThemeData): CompiledTheme {
  let c = compiled.get(theme.id);
  if (!c || c.data !== theme) {
    c = compileTheme(theme);
    compiled.set(theme.id, c);
  }
  return c;
}
