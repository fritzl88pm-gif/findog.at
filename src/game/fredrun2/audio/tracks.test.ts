import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { isJingle, JINGLES, type TrackManifest } from "./tracks";
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
