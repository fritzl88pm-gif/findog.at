/**
 * Cyber-Wien 2099 – Stimmungsstufen und Farbtabellen.
 * Stufen: Neon-Dämmerung → Datenstadt → Serverherz → Glitch-Sturm → Singularität.
 */
import { StagePalette } from "../shared-b/color";

export const MAX_STAGE = 4;
export const TAU = Math.PI * 2;

export const CYAN = "#22e0ff";
export const MAGENTA = "#ff3ec8";
export const VIOLET = "#9a5bff";
export const HOT = "#ff2a6a";
export const MINT = "#3dffb0";

export const STAGE_NAMES = ["Neon-Dämmerung", "Datenstadt", "Serverherz", "Glitch-Sturm", "Singularität"];

export interface StageColors {
  top: string;
  mid: string;
  low: string;
  horizon: string;
  haze: string;
  /** Hauptfarbe Gitter/Neon */
  grid: string;
  /** Zweitfarbe Gitter/Neon */
  grid2: string;
  /** Silhouettenfarbe ferner Gebäude */
  night: string;
  /** Boden-/Deckengrund */
  floor: string;
}

export const STAGES: StageColors[] = [
  // 0 Neon-Dämmerung: violette Dämmerung, Synthwave-Sonne am Horizont
  { top: "#130a33", mid: "#4b1670", low: "#d8457e", horizon: "#ffae6b", haze: "#8a3a8e", grid: "#ff4fd8", grid2: "#22e0ff", night: "#1a0c35", floor: "#0e0624" },
  // 1 Datenstadt: tiefblaue Nacht, Cyan dominiert
  { top: "#02061a", mid: "#0a1747", low: "#1f3596", horizon: "#4aa0ff", haze: "#1c2c72", grid: "#22e0ff", grid2: "#b04dff", night: "#070d2c", floor: "#040a1e" },
  // 2 Serverherz: Petrol/Mint, Matrix-Datenregen
  { top: "#010b0e", mid: "#03282c", low: "#0b5550", horizon: "#3dffc4", haze: "#0e4444", grid: "#3dffb0", grid2: "#22e0ff", night: "#021618", floor: "#021013" },
  // 3 Glitch-Sturm: Magenta/Rot, Störungen
  { top: "#0e0108", mid: "#36051f", low: "#8c0d3e", horizon: "#ff4a78", haze: "#50102e", grid: "#ff2a6a", grid2: "#22e0ff", night: "#1a0310", floor: "#0e0209" },
  // 4 Singularität: Schwarz/Violett, Akkretionsring
  { top: "#000000", mid: "#0d0420", low: "#2a0d5c", horizon: "#caa4ff", haze: "#221050", grid: "#c9a0ff", grid2: "#ffffff", night: "#07031a", floor: "#05020f" },
];

export const PAL = new StagePalette<keyof StageColors>(STAGES as unknown as Array<Record<keyof StageColors, string>>);

/** Synthwave-Sonne (nur Dämmerung) */
export const SUN = [1, 0, 0, 0, 0];
/** Sterne */
export const STARS = [0.35, 1, 0.55, 0.3, 1];
/** Datenregen-Dichte */
export const RAIN = [0.25, 0.6, 1, 0.75, 0.35];
/** Glitch-Stärke */
export const GLITCH = [0, 0, 0.08, 1, 0.25];
/** Singularität im Himmel */
export const SING = [0, 0, 0, 0.12, 1];
/** Stadtlichter */
export const LIGHTS = [0.75, 1, 0.8, 0.9, 0.75];
/** Laserraster am Himmel */
export const RASTER = [0.35, 0.7, 0.45, 0.65, 0.9];
/** Server-Monolithen (Serverherz) */
export const SERVER = [0, 0.15, 1, 0.55, 0.15];
/** Hologramm-Dom Intensität */
export const DOME = [0.62, 1, 0.8, 0.9, 1];
/** Verkehr (Schwebeautos) */
export const TRAFFIC = [0.8, 1, 0.6, 0.5, 0.3];
