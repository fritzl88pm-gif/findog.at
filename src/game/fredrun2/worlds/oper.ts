/**
 * Welt 8 – Opernball: vom roten Teppich im Foyer bis zur Mitternachts-Polonaise. Signatur: Dreiertakt-Hindernisse,
 * Kronleuchter-Pendel, Champagner-Korken, Kellner und Tanzpaare zum Stampfen, Flügel-Sprungbrett zu Balkonbahnen,
 * Scheinwerfer-Kegel und Orchestergräben.
 */
import type { WorldDef } from "../types";
import { OPER_PATTERNS } from "./oper/patterns";
import { OPER_PROPS, OperRenderer } from "./oper/renderer";
import { STAGE_NAMES } from "./oper/stages";
import { OperSystem } from "./oper/system";
import { GUEST_PROP_IDS } from "./shared-a/guests";

export const WORLD_OPER: WorldDef = {
  id: "oper",
  name: "Opernball",
  tagline: "Im Dreivierteltakt zum Highscore.",
  description:
    "Der Wiener Opernball ruft: Vom roten Teppich im Foyer über den goldenen Ballsaal und die Logen bis zum Spiegelsaal und zur Mitternachts-Polonaise. Spring im Walzertakt, rutsch unter Kronleuchtern durch, duck dich vor Champagnerkorken und stampf auf Kellner und Tanzpaare – und lass dich vom Flügel auf die Balkone katapultieren.",
  mechanics: ["Walzertakt: Sprung – Sprung – Rutschen", "Kronleuchter, Korken & Scheinwerfer", "Kellner & Tanzpaare zum Stampfen", "Flügel-Sprungbrett zu Balkonbahnen"],
  accent: "#f2c14e",
  accentDark: "#3a0a12",
  music: "oper",
  stageMeters: 300,
  stageCount: 5,
  stageNames: STAGE_NAMES,
  patterns: OPER_PATTERNS,
  createSystems: () => [new OperSystem()],
  createRenderer: () => new OperRenderer(),
  propIds: [...OPER_PROPS, ...GUEST_PROP_IDS],
};
