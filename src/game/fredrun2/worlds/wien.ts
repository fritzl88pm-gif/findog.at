/**
 * Welt „Wien im Sturm“ – Signatur: Blitzeinschläge + Straßenbahn-Surfen. 8 Stimmungsstufen erzählen die Katastrophe
 * vom unheilvollen Gewitterabend bis zur kalten Asche-Nachwelt.
 */
import type { WorldDef } from "../types";
import { WIEN_PATTERNS } from "./wien/patterns";
import { WienRenderer } from "./wien/renderer";
import { WIEN_PROPS } from "./wien/skins";
import { WIEN_STAGE_NAMES } from "./wien/stages";
import { WienSystem } from "./wien/system";
import { GUEST_PROP_IDS } from "./shared-a/guests";

export const WORLD_WIEN: WorldDef = {
  id: "wien",
  name: "Wien im Sturm",
  tagline: "Blitz, Donner, Bim – und du mittendrin.",
  description:
    "Ein Jahrhundertgewitter fegt über den Ring: Surf auf dem Dach der Bim, spring Blitzeinschlägen davon und flitz an Stephansdom, Rathaus und Riesenrad vorbei – während die Stadt Stufe um Stufe tiefer ins Chaos stürzt.",
  mechanics: ["Straßenbahn-Surfen auf dem Dach", "Blitzeinschläge mit Vorwarnung", "Tauben, Fiaker & Dachziegel", "Pfützen bremsen, Gullys verschlucken"],
  accent: "#5b7cfa",
  accentDark: "#141b3d",
  music: "wien",
  stageMeters: 260,
  stageCount: 8,
  stageNames: WIEN_STAGE_NAMES,
  patterns: WIEN_PATTERNS,
  createSystems: () => [new WienSystem()],
  createRenderer: () => new WienRenderer(),
  propIds: ["fiaker", "traffic-cone", "park-bench", "wuerstelstand", "pigeon-fly", ...WIEN_PROPS, ...GUEST_PROP_IDS],
};
