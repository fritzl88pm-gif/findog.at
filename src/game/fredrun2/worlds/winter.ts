/**
 * Welt 7 – Christkindlmarkt: Glühwein, Glitzer – und der Krampus ist los. Bildgestützte Welt (gemalte Kulissen aus
 * `public/fredrun2/worlds/winter/`), Signatur: Eisflächen (Tempo ×1.3), Elfen mit Schneebällen, Eiszapfen,
 * Glühwein-Aufwind, Rodelschlitten-Plattformen, Krampus und Krampus-Verfolgung.
 */
import type { WorldDef } from "../types";
import { GUEST_PROP_IDS } from "./shared-a/guests";
import { WINTER_PATTERNS } from "./winter/patterns";
import { WINTER_PROPS, WinterRenderer } from "./winter/renderer";
import { WINTER_STAGE_NAMES } from "./winter/stages";
import { WinterSystem } from "./winter/system";

export const WORLD_WINTER: WorldDef = {
  id: "winter",
  name: "Christkindlmarkt",
  tagline: "Glühwein, Glitzer – und der Krampus ist los.",
  description:
    "Der Rathausplatz glitzert im Lichterglanz: Flitz über spiegelglatte Eisflächen, duck dich unter Eiszapfen, weich den Schneebällen der Elfen aus und lass dich vom Dampf des Glühweinkessels in die Höhe tragen. Doch später, wenn die Fackeln brennen, ist der Krampus hinter dir her!",
  mechanics: ["Eisflächen: schneller & rutschig", "Elfen-Schneebälle & Eiszapfen", "Glühwein-Aufwind & Rodelschlitten", "Krampus-Verfolgung"],
  accent: "#8fd3ff",
  accentDark: "#0b1f3a",
  music: "winter",
  stageMeters: 300,
  stageCount: 5,
  stageNames: WINTER_STAGE_NAMES,
  patterns: WINTER_PATTERNS,
  createSystems: () => [new WinterSystem()],
  createRenderer: () => new WinterRenderer(),
  propIds: [...WINTER_PROPS, ...GUEST_PROP_IDS],
};
