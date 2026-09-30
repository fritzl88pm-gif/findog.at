/**
 * Alpenpanorama – Stimmungsstufen (5 × 320 m): Almwiese am Morgen → Zirbenwald & Bergsee → Gipfelregion →
 * Hochplateau im Wind → Gletscher im Abendrot. Alle Tabellen werden mit `stageVal(tab, stage + blend)` gemischt.
 */

export const ALPEN_STAGE_NAMES = ["Almwiese am Morgen", "Zirbenwald & Bergsee", "Gipfelregion", "Hochplateau im Wind", "Gletscher im Abendrot"];

export const MAX_STAGE = 4;

/** Original-Kulissen (Fredrun 1) je Stufe */
export const BACKDROP_URLS = [
  "/fredrun/levels/alps/backgrounds/meadow.webp",
  "/fredrun/levels/alps/backgrounds/lake.webp",
  "/fredrun/levels/alps/backgrounds/peaks.webp",
  "/fredrun/levels/alps/backgrounds/plateau.webp",
];
/** Welches Bild je Stufe: Wiese, See, Gipfelkreuz-Alm, Hochgebirge, Hochgebirge im Alpenglühen */
export const BACKDROP_OF_STAGE = [0, 1, 3, 2, 2];

export interface AlpenStagePal {
  top: string;
  mid: string;
  low: string;
  haze: string;
  sun: string;
  light: string;
  shadow: string;
  grass: string;
  grassDark: string;
}

export const STAGE_PAL: AlpenStagePal[] = [
  // Almwiese am Morgen: frisch, golden-warm
  { top: "#3f86d4", mid: "#86bfea", low: "#eef3e6", haze: "#d3e6ee", sun: "#fff4c8", light: "#ffe3a0", shadow: "#2c4a6a", grass: "#7cc443", grassDark: "#3f7f2a" },
  // Bergsee: klarer Vormittag, kühl-türkis
  { top: "#347fd0", mid: "#7cbbe9", low: "#e2f2f4", haze: "#c7e2ec", sun: "#fffbe6", light: "#fff2c8", shadow: "#244a66", grass: "#6cbc49", grassDark: "#2f7433" },
  // Gipfelregion: tiefblauer Höhenhimmel, Mittagslicht
  { top: "#1f5fb8", mid: "#62a6e4", low: "#d8ecf7", haze: "#c3dbef", sun: "#ffffff", light: "#fffaf0", shadow: "#23405e", grass: "#8cbf4a", grassDark: "#4b7a33" },
  // Hochplateau: Wind, Schleierwolken, kühler Nachmittag
  { top: "#48719f", mid: "#94afc9", low: "#e3e6e6", haze: "#cfd9e1", sun: "#fff0d0", light: "#f4ead6", shadow: "#33445a", grass: "#98a86a", grassDark: "#56663f" },
  // Gletscher im Abendrot
  { top: "#28265c", mid: "#b85b7c", low: "#ffae6a", haze: "#e59c90", sun: "#ffc27a", light: "#ffb487", shadow: "#3b2754", grass: "#b08a7a", grassDark: "#5c4058" },
];

/** Sonnenposition (Bildschirm) */
export const SUN_X = [1010, 980, 860, 760, 640];
export const SUN_Y = [120, 92, 70, 120, 408];
export const SUN_R = [44, 42, 40, 44, 60];
/** Lichtstrahlen-Stärke */
export const RAYS = [0.85, 0.7, 0.4, 0, 0.6];
/** Wolkenmenge 0..1 und Drift (px/s) */
export const CLOUDS = [0.55, 0.45, 0.4, 0.95, 0.6];
export const CLOUD_DRIFT = [8, 10, 16, 34, 12];
/** Schmetterlinge / Pollen */
export const BUTTERFLIES = [1, 0.7, 0.2, 0, 0];
export const POLLEN = [1, 0.8, 0.5, 0.15, 0.2];
/** Schneefall / Wind */
export const SNOW = [0, 0, 0.08, 0.45, 0.85];
export const WIND = [0.1, 0.15, 0.35, 0.8, 0.55];
/** Schnee-Anteil auf Hügeln/Boden/Deko (0 grün … 1 verschneit) */
export const SNOWCOVER = [0, 0, 0.18, 0.55, 1];
/** Sterne am Abendhimmel */
export const STARS = [0, 0, 0, 0, 0.55];
/** Alpenglühen (Wärme) für Overlay/Skins */
export const GLOW = [0.12, 0.05, 0, 0.05, 1];
/** Seilbahn im Mittelgrund */
export const CABLEWAY = [0.3, 0.6, 1, 0.8, 0.6];
/** Nebelbänke vor den Bergen */
export const MIST = [0.5, 0.35, 0.3, 0.5, 0.4];
/** Wolkenschatten, die über das Land ziehen */
export const CLOUD_SHADOWS = [0.6, 0.5, 0.45, 0.8, 0];
/** Bergsee im Mittelgrund */
export const LAKE = [0, 1, 0.25, 0, 0];
