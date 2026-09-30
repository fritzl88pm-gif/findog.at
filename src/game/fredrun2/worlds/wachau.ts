/**
 * Welt „Wachau" – goldener Herbst an der Donau: Weinterrassen, Marillenbäume, Burgruine Dürnstein, Stift, Raddampfer.
 * Signatur: Floß-Sprünge über die Donau (Flöße wippen und sinken nach dem Landen) + rollende Weinfässer.
 * 5 Stimmungsstufen: Morgennebel → Goldener Vormittag → Sonnenuntergang → Blaue Stunde → Sternennacht mit Glühwürmchen.
 */
import type { WorldDef } from "../types";
import { GUEST_PROP_IDS } from "./shared-a/guests";
import { STAGE_NAMES } from "./wachau/palette";
import { WACHAU_PATTERNS } from "./wachau/patterns";
import { WACHAU_PROPS, WachauRenderer } from "./wachau/renderer";
import { WachauSystem } from "./wachau/system";

export const WORLD_WACHAU: WorldDef = {
  id: "wachau",
  name: "Wachau",
  tagline: "Marillen, Wein und Donauwellen – spring von Floß zu Floß!",
  description:
    "Goldener Herbst in der Wachau: Vom Morgennebel über der Donau bis zur Sternennacht mit Glühwürmchen läufst du an Weinterrassen, Marillenbäumen, Burgruine und Stift vorbei. Hüpf über wippende Flöße, bevor sie versinken, weich rollenden Weinfässern und Bienenschwärmen aus und lass dich von Blätterwirbeln zu den Marillen tragen.",
  mechanics: ["Floß-Sprünge über die Donau", "Rollende Weinfässer von den Terrassen", "Bienenschwärme & Marillenäste", "Blätterwirbel & Weinberg-Treppen"],
  accent: "#f2a33a",
  accentDark: "#3a2408",
  music: "wachau",
  stageMeters: 300,
  stageCount: 5,
  stageNames: STAGE_NAMES,
  patterns: WACHAU_PATTERNS,
  createSystems: () => [new WachauSystem()],
  createRenderer: () => new WachauRenderer(),
  propIds: [...WACHAU_PROPS, ...GUEST_PROP_IDS],
};
