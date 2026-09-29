import { describe, expect, it } from "vitest";
import { chordTones, compileTheme, noteToMidi, parseChord, parseChordBar, parseDrumBar, parseNotesBar } from "./notation";
import { LAYER_RANGES, layerLevel, THEMES, type DrumId, type InstId } from "./themes";
import { WORLD_MUSIC_IDS } from "./types";

const pc = { label: "test", stepsPerBar: 6 };

describe("Notation", () => {
  it("wandelt Notennamen in MIDI um", () => {
    expect(noteToMidi("C4")).toBe(60);
    expect(noteToMidi("A4")).toBe(69);
    expect(noteToMidi("F#5")).toBe(78);
    expect(noteToMidi("Bb3")).toBe(58);
    expect(noteToMidi("H4")).toBeNull();
  });

  it("parst Akkorde und Akkordtöne", () => {
    expect(chordTones("Am", 3)).toEqual([57, 60, 64]);
    expect(chordTones("D7", 3)).toEqual([50, 54, 57, 60]);
    expect(parseChord("Bbmaj7").pc).toBe(10);
    expect(() => parseChord("Hm")).toThrow();
    expect(() => parseChord("Cxyz")).toThrow();
  });

  it("legt Noten auf Steps und summiert Dauern", () => {
    const bar = parseNotesBar("E5:2 G5 A5:3", pc);
    expect(bar[0]?.dur).toBe(2);
    expect(bar[2]?.midi).toEqual([79]);
    expect(bar[3]?.dur).toBe(3);
    expect(bar[1]).toBeNull();
  });

  it("unterstützt Pausen, Bindungen, Akzente und Akkorde", () => {
    const bar = parseNotesBar("C4+E4:2! -:1 G4:2? ~:1", pc);
    expect(bar[0]?.midi).toEqual([60, 64]);
    expect(bar[0]?.vel).toBeGreaterThan(1);
    expect(bar[2]).toBeNull();
    expect(bar[3]?.vel).toBeLessThan(1);
    expect(bar[3]?.dur).toBe(3);
    const tied = parseNotesBar("C4:2 ~:2 -:2", pc);
    expect(tied[0]?.dur).toBe(4);
  });

  it("meldet falsche Taktlängen und unbekannte Tokens", () => {
    expect(() => parseNotesBar("C4:2 D4:2", pc)).toThrow(/statt 6/);
    expect(() => parseNotesBar("C4:8", pc)).toThrow();
    expect(() => parseNotesBar("Q4:6", pc)).toThrow();
    expect(() => parseNotesBar("~:6", pc)).toThrow();
  });

  it("löst akkordbezogene Patterns auf", () => {
    const bar = parseChordBar("1:2 3:1 5:1 1u:1 c:1", "Am", 3, pc);
    expect(bar[0]?.midi).toEqual([57]);
    expect(bar[2]?.midi).toEqual([60]);
    expect(bar[3]?.midi).toEqual([64]);
    expect(bar[4]?.midi).toEqual([69]);
    expect(bar[5]?.midi).toEqual([57, 60, 64]);
    const t = parseChordBar("t:6", "G7", 3, pc);
    expect(t[0]?.midi).toEqual([59, 62, 65]);
  });

  it("parst Schlagzeugzeilen", () => {
    const bar = parseDrumBar({ kick: "x.....", hat: "o.o.o.", snare: "..X..." }, pc);
    expect(bar[0]?.map((h) => h.drum).sort()).toEqual(["hat", "kick"]);
    expect(bar[2]?.find((h) => h.drum === "snare")?.vel).toBeGreaterThan(1);
    expect(() => parseDrumBar({ kick: "x..." }, pc)).toThrow(/statt 6/);
    expect(() => parseDrumBar({ kick: "x?...." }, pc)).toThrow();
  });
});

describe("Themen-Daten", () => {
  const dummyInst = new Set<InstId>([
    "pad-warm", "pad-strings", "pad-air", "pad-cold", "pad-supersaw", "drone", "accordion", "strings-lead", "yodel",
    "calliope", "organ-chord", "lead-synth", "pizz", "pluck-soft", "pluck-bright", "guitar", "pluck-synth", "pluck-cold",
    "bell", "bell-soft", "chime-cold", "bass-warm", "bass-pizz", "bass-tuba", "bass-muted", "bass-roll",
  ]);
  const dummyDrums = new Set<DrumId>([
    "kick", "kick-soft", "snare", "snare-soft", "rim", "clap", "hat", "ohat", "shaker", "timpani", "stamp", "tick", "tock",
    "click", "slap", "cowbell", "wood", "crash", "rumble", "tom",
  ]);

  it("hat für jede Welt ein Thema", () => {
    expect(Object.keys(THEMES).sort()).toEqual([...WORLD_MUSIC_IDS].sort());
    for (const id of WORLD_MUSIC_IDS) expect(THEMES[id].id).toBe(id);
  });

  for (const id of WORLD_MUSIC_IDS) {
    describe(id, () => {
      const theme = THEMES[id];

      it("kompiliert fehlerfrei (alle Takte füllen genau ein Taktmaß)", () => {
        const compiled = compileTheme(theme);
        expect(compiled.tracks).toHaveLength(theme.tracks.length);
        for (const t of compiled.tracks) {
          const n = t.data.kind === "drums" ? t.drums.length : t.notes.length;
          expect(n).toBe(theme.bars);
        }
      });

      it("hat plausible Kopfdaten", () => {
        expect(theme.bpm).toBeGreaterThanOrEqual(80);
        expect(theme.bpm).toBeLessThanOrEqual(160);
        expect([3, 4]).toContain(theme.beatsPerBar);
        expect(theme.bars).toBeGreaterThanOrEqual(8);
        expect(theme.defaultIntensity).toBeGreaterThanOrEqual(0);
        expect(theme.defaultIntensity).toBeLessThanOrEqual(1);
        for (const c of theme.chords) expect(() => parseChord(c)).not.toThrow();
      });

      it("Takt-Patterns teilen die Loop-Länge (nahtloser Loop)", () => {
        expect(theme.bars % theme.chords.length).toBe(0);
        for (const t of theme.tracks) expect(theme.bars % t.bars.length).toBe(0);
      });

      it("hat alle vier Intensitäts-Layer belegt", () => {
        const layers = new Set(theme.tracks.map((t) => t.layer));
        expect([...layers].sort()).toEqual([0, 1, 2, 3]);
        expect(theme.tracks.some((t) => t.layer === 0 && t.kind === "chord")).toBe(true);
        expect(theme.tracks.some((t) => t.layer === 2 && t.kind === "drums")).toBe(true);
      });

      it("verwendet nur bekannte Instrumente und Schlagzeug-Stimmen", () => {
        for (const t of theme.tracks) {
          if (t.kind === "drums") {
            for (const bar of t.bars) for (const d of Object.keys(bar)) expect(dummyDrums.has(d as DrumId)).toBe(true);
          } else {
            expect(dummyInst.has(t.inst)).toBe(true);
          }
          expect(t.gain).toBeGreaterThan(0);
          expect(t.gain).toBeLessThanOrEqual(1.2);
        }
      });

      it("Melodien liegen in einem spielbaren Register (MIDI 36..100)", () => {
        const compiled = compileTheme(theme);
        for (const t of compiled.tracks) {
          for (const bar of t.notes) {
            for (const ev of bar) {
              if (!ev) continue;
              for (const n of ev.midi) {
                expect(n).toBeGreaterThanOrEqual(24);
                expect(n).toBeLessThanOrEqual(100);
              }
            }
          }
        }
      });
    });
  }

  it("Sidechain-Auslöser und Echo-Layer verweisen auf existierende Dinge", () => {
    for (const id of WORLD_MUSIC_IDS) {
      const th = THEMES[id];
      if (th.sidechain) {
        const drums = th.tracks.flatMap((t) => (t.kind === "drums" ? t.bars.flatMap((b) => Object.keys(b)) : []));
        expect(drums).toContain(th.sidechain.trigger);
      }
    }
  });

  it("Themen sind klanglich unterscheidbar (Tempo/Taktart/Tonart)", () => {
    const sig = WORLD_MUSIC_IDS.map((id) => `${THEMES[id].bpm}/${THEMES[id].beatsPerBar}/${THEMES[id].chords.join(",")}`);
    expect(new Set(sig).size).toBe(WORLD_MUSIC_IDS.length);
  });
});

describe("layerLevel", () => {
  it("Layer 0 ist immer voll, höhere Layer blenden monoton ein", () => {
    expect(layerLevel(0, 0)).toBe(1);
    for (let l = 1; l <= 3; l++) {
      let prev = -1;
      for (let v = 0; v <= 1.0001; v += 0.05) {
        const x = layerLevel(l, v);
        expect(x).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = x;
      }
      expect(layerLevel(l, 0)).toBe(0);
      expect(layerLevel(l, 1)).toBe(1);
    }
    expect(LAYER_RANGES).toHaveLength(3);
  });

  it("die Layer kommen in der Reihenfolge Bass -> Drums -> Lead", () => {
    const v = 0.5;
    expect(layerLevel(1, v)).toBeGreaterThan(layerLevel(2, v));
    expect(layerLevel(2, v)).toBeGreaterThan(layerLevel(3, v));
  });
});
