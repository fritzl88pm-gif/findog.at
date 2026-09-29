/** Wien – Stimmungsstufen (8): unheilvoll → Sturm → Schäden → Rauch → Kollaps → Flächenbrand → Trümmer → kalte Asche. */
import type { RGB } from "../shared-a/gfx";

export const WIEN_STAGE_NAMES = [
  "Unheilvolle Dämmerung",
  "Der Sturm zieht auf",
  "Sturmschäden am Ring",
  "Dichter Rauch",
  "Brennender Kollaps",
  "Flächenbrand",
  "Trümmer & Asche",
  "Kalte Asche-Nachwelt",
];

export const WIEN_BACKDROPS = [
  "/fredrun/backgrounds/vienna-ominous.webp",
  "/fredrun/backgrounds/vienna-gathering-storm.webp",
  "/fredrun/backgrounds/vienna-storm-damage.webp",
  "/fredrun/backgrounds/vienna-heavy-smoke-emergency.webp",
  "/fredrun/backgrounds/vienna-burning-collapse.webp",
  "/fredrun/backgrounds/vienna-widespread-fire-collapse.webp",
  "/fredrun/backgrounds/vienna-rubble-ashes.webp",
  "/fredrun/backgrounds/vienna-cold-ash-aftermath.webp",
];

export const RAIN = [0.32, 0.78, 1, 0.42, 0.14, 0, 0, 0];
export const WIND = [-150, -320, -560, -280, -170, -120, -80, -40];
/** Gewitter-Häufigkeit (Blitze pro Sekunde, ungefähr) */
export const STORM = [0.06, 0.2, 0.24, 0.1, 0.05, 0.03, 0.02, 0.01];
export const FIRE = [0, 0, 0.05, 0.3, 0.72, 1, 0.35, 0.06];
export const SMOKE = [0, 0.08, 0.18, 0.75, 0.62, 0.55, 0.45, 0.3];
export const ASH = [0, 0, 0, 0.1, 0.25, 0.4, 0.85, 1];
export const LAMPS = [1, 1, 0.55, 0.15, 0, 0, 0, 0];
export const CLOUDS = [0.35, 0.6, 0.7, 0.55, 0.45, 0.4, 0.45, 0.5];

export const HAZE: RGB[] = [
  [72, 84, 110],
  [54, 62, 84],
  [46, 52, 70],
  [74, 64, 58],
  [78, 48, 36],
  [96, 46, 28],
  [60, 58, 60],
  [78, 84, 96],
];

export const SKY_TOP: RGB[] = [
  [26, 32, 48],
  [18, 22, 34],
  [14, 17, 26],
  [30, 26, 26],
  [34, 20, 16],
  [44, 18, 12],
  [26, 25, 27],
  [40, 44, 52],
];

export const SKY_BOT: RGB[] = [
  [120, 116, 120],
  [84, 86, 98],
  [64, 66, 78],
  [120, 96, 72],
  [150, 80, 44],
  [170, 70, 34],
  [88, 80, 76],
  [104, 108, 116],
];

/** Fassaden-Variante je Stufe (Index in FACADE_VARIANTS) */
export const FACADE_OF_STAGE = [0, 0, 1, 2, 3, 3, 4, 4];
export const ROOF_OF_STAGE = [0, 0, 1, 1, 1, 1, 2, 2];
