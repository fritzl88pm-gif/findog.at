/**
 * Welt „Alpenpanorama“ – Signatur: Lawine im Nacken + Aufwind über Schluchten + bröckelnde Felsplatten.
 * 5 Stimmungsstufen von der Almwiese am Morgen bis zum Gletscher im Abendrot.
 */
import type { WorldDef } from "../types";
import { ALPEN_PATTERNS } from "./alpen/patterns";
import { ALPEN_PROPS, AlpenRenderer } from "./alpen/renderer";
import { ALPEN_STAGE_NAMES } from "./alpen/stages";
import { AlpenSystem } from "./alpen/system";
import { GUEST_PROP_IDS } from "./shared-a/guests";

export const WORLD_ALPEN: WorldDef = {
  id: "alpen",
  name: "Alpenpanorama",
  tagline: "Frische Bergluft – und eine Lawine im Nacken.",
  description:
    "Von der blühenden Almwiese über den Bergsee bis zum Gletscher im Abendrot: Spring über Schluchten und bröckelnde Felsplatten, reite die Thermik, weich Steinböcken, Adlern und Steinschlag aus – und lass dich von der donnernden Lawine nicht einholen.",
  mechanics: ["Lawine im Nacken", "Aufwind über Schluchten", "Bröckelnde Felsen & Gondeln", "Steinböcke, Adler, Steinschlag"],
  accent: "#39b26b",
  accentDark: "#0f3b24",
  music: "alpen",
  stageMeters: 320,
  stageCount: 5,
  stageNames: ALPEN_STAGE_NAMES,
  patterns: ALPEN_PATTERNS,
  createSystems: () => [new AlpenSystem()],
  createRenderer: () => new AlpenRenderer(),
  propIds: [...ALPEN_PROPS, ...GUEST_PROP_IDS],
};
