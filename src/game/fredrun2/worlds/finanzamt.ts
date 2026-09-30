/**
 * Welt 3 – Finanzamt bei Nacht: vom Sachbearbeiter-Büro über Aktenraum, Glasbüros und Archiv bis in Serverkeller & Tresor.
 * Signatur: Riesenstempel mit Vorwarnung, Laser-Gitter im Takt (springen/rutschen), Förderbänder, Aktenlawinen,
 * Schredder-Lücken und Dunkelheit mit Taschenlampenkegel.
 */
import type { WorldDef } from "../types";
import { FINANZAMT_PATTERNS } from "./finanzamt/patterns";
import { FA_PROPS, FinanzamtRenderer } from "./finanzamt/renderer";
import { FA_STAGE_METERS, FA_STAGE_NAMES } from "./finanzamt/stages";
import { FinanzamtSystem } from "./finanzamt/system";
import { GUEST_PROP_IDS } from "./shared-a/guests";

export const WORLD_FINANZAMT: WorldDef = {
  id: "finanzamt",
  name: "Finanzamt bei Nacht",
  tagline: "Nach Dienstschluss wird's amtlich gefährlich.",
  description:
    "Mitternacht im Amt: Riesenstempel knallen von der Decke, Laser-Gitter sichern die Aktenflure im Takt, Förderbänder schieben Papierlawinen heran – und je tiefer du ins Archiv und bis zum Tresor vordringst, desto dunkler wird es. Nur deine Taschenlampe zeigt den Weg.",
  mechanics: ["Riesenstempel mit Warnschatten", "Laser-Gitter: springen oder rutschen", "Förderbänder & Aktenlawinen", "Dunkelheit & Taschenlampe"],
  accent: "#3aa0ff",
  accentDark: "#0b1a33",
  music: "finanzamt",
  stageMeters: FA_STAGE_METERS,
  stageCount: FA_STAGE_NAMES.length,
  stageNames: FA_STAGE_NAMES,
  patterns: FINANZAMT_PATTERNS,
  createSystems: () => [new FinanzamtSystem()],
  createRenderer: () => new FinanzamtRenderer(),
  propIds: [...FA_PROPS, ...GUEST_PROP_IDS],
};
