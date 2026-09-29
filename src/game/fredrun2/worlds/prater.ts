/**
 * Welt 4 – Prater: Wiener Wurstelprater von der goldenen Stunde bis zum Mitternachtszauber.
 * Signatur: Kettenkarussell-Pendel, Trampoline, Riesenrad-Gondeln über dem Achterbahn-Graben.
 */
import type { WorldDef } from "../types";
import { PRATER_PATTERNS } from "./prater/patterns";
import { PRATER_PROPS, PraterRenderer } from "./prater/renderer";
import { PraterSystem } from "./prater/system";

export const WORLD_PRATER: WorldDef = {
  id: "prater",
  name: "Prater",
  tagline: "Einmal Riesenrad, bitte – aber im Laufschritt!",
  description:
    "Der Wurstelprater glüht: Riesenrad, Hochschaubahn und Lichterketten von der goldenen Stunde bis zum Mitternachtsfeuerwerk. Weich den Kettenkarussell-Sitzen aus, hüpf über Riesenrad-Gondeln und lass dich von Trampolinen zu den Sternen schleudern.",
  mechanics: ["Kettenkarussell-Pendel", "Trampoline & Ring-Bonus", "Riesenrad-Gondeln", "Konfetti-Kanonen"],
  accent: "#ff4fa3",
  accentDark: "#3a0b2a",
  music: "prater",
  stageMeters: 300,
  stageCount: 5,
  stageNames: ["Goldene Stunde", "Dämmerung im Wurstelprater", "Lichterzauber", "Feuerwerksnacht", "Mitternachtszauber"],
  patterns: PRATER_PATTERNS,
  createSystems: () => [new PraterSystem()],
  createRenderer: () => new PraterRenderer(),
  propIds: PRATER_PROPS,
};
