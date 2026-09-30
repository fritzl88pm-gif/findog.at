/**
 * Welt 6 – Cyber-Wien 2099: neonfarbenes Wien der Zukunft mit Hologramm-Stephansdom, Datenregen und Tron-Gitter in Boden
 * UND Decke. Signatur: Schwerkraft-Umkehr durch Portale (immer paarweise), Phasen-Tore im Takt, Laser, Drohnen,
 * Glitch-Würfel. Fünf Stufen: Neon-Dämmerung → Datenstadt → Serverherz → Glitch-Sturm → Singularität.
 */
import type { WorldDef } from "../types";
import { STAGE_NAMES } from "./cyber/palette";
import { CYBER_PATTERNS } from "./cyber/patterns";
import { CYBER_PROPS, CyberRenderer } from "./cyber/renderer";
import { CyberSystem } from "./cyber/system";

export const WORLD_CYBER: WorldDef = {
  id: "cyber",
  name: "Cyber-Wien 2099",
  tagline: "Oben ist das neue Unten.",
  description:
    "Wien im Jahr 2099: Über dem Ring schwebt ein Hologramm-Stephansdom, Datenregen fällt zwischen Glastürmen und Neon-Reklamen. Spring durch Schwerkraft-Portale, lauf kopfüber an der Decke, tanz im Takt der Phasen-Tore und weich Drohnen, Lasern und Glitch-Würfeln aus – bis in die Singularität.",
  mechanics: ["Schwerkraft-Portale & Deckenlauf", "Phasen-Tore im Takt", "Laser, Drohnen & Glitch-Würfel", "Datenchips & Kristalle"],
  accent: "#22e0ff",
  accentDark: "#0a0f2e",
  music: "cyber",
  groundY: 600,
  ceilY: 140,
  gravityFlip: true,
  stageMeters: 280,
  stageCount: 5,
  stageNames: STAGE_NAMES,
  patterns: CYBER_PATTERNS,
  createSystems: () => [new CyberSystem()],
  createRenderer: () => new CyberRenderer(),
  propIds: CYBER_PROPS,
};
