/**
 * Finanzamt bei Nacht – Stimmungsstufen (5): Sachbearbeiter-Büro → Aktenraum → Glasbüros → Archiv → Serverkeller & Tresor.
 * Je tiefer ins Amt, desto kälter, dunkler und „sicherheitskritischer“ (mehr Laser, Notbeleuchtung, Alarm).
 */

export const FA_STAGE_NAMES = ["Sachbearbeiter-Büro", "Aktenraum", "Glasbüros", "Archiv", "Serverkeller & Tresor"];
export const FA_STAGE_METERS = 280;
export const MAX_STAGE = 4;

const BG = "/fredrun/levels/finanzamt-night/backgrounds/";
/** Gemalte Fernkulisse je Stufe (Originalspiel; Stufe 5 = Archiv, kalt umgefärbt). */
export const FA_BACKDROPS = [
  `${BG}close-caseworker-office.webp`,
  `${BG}close-records-room.webp`,
  `${BG}close-glass-offices.webp`,
  `${BG}close-archive.webp`,
  `${BG}close-archive.webp`,
];

/** Unspiegelbare Schrift-Stellen der Originalbilder (Manifest „mirroredTextTreatment“), in Quellpixeln. */
export const TEXT_PATCHES: ReadonlyArray<readonly [number, number, number, number]> = [
  [300, 176, 120, 68],
  [1160, 262, 53, 42],
  [1267, 326, 63, 18],
  [612, 326, 36, 29],
];

/** Dunkelheit außerhalb des Taschenlampenkegels (0..1) */
export const DARK = [0.2, 0.36, 0.48, 0.62, 0.68];
/** Deckenleuchten (Neon) – Helligkeit */
export const NEON = [1, 0.85, 0.75, 0.4, 0.28];
/** Anteil defekter (flackernder) Röhren */
export const FAULTY = [0.08, 0.18, 0.2, 0.34, 0.3];
/** warme Schreibtischlampen / Monitore */
export const LAMPS = [1, 0.75, 0.95, 0.4, 0.15];
/** Notbeleuchtung / Rundumleuchten */
export const EMERGENCY = [0, 0, 0.12, 0.75, 1];
/** Server-LEDs, kalte Akzente */
export const LEDS = [0.15, 0.2, 0.45, 0.35, 1];
/** Staub im Licht */
export const DUST = [0.3, 0.75, 0.35, 1, 0.45];
/** Papierfetzen im Luftzug */
export const PAPER = [0.55, 0.9, 0.45, 0.7, 0.25];
/** Luftzug (px/s, negativ = gegen die Laufrichtung) */
export const DRAFT = [-60, -90, -50, -110, -140];
/** Glas-Spiegelungen */
export const GLASS = [0.15, 0.1, 1, 0.1, 0.35];

/** Farbstimmung je Stufe (Hex) */
export const PALETTE = [
  // ceil: Decke, wall: Grundton, haze: Dunst, floorHi/floorLo: Boden, neon: Röhrenlicht, lamp: warmes Licht, grade: Kulissen-Tönung
  { ceil: "#0d1426", wall: "#1a2440", haze: "#34507e", floorHi: "#3a4658", floorLo: "#141a26", neon: "#dce8ff", lamp: "#ffc46e", grade: "#0e1a34", accent: "#6fb6ff" },
  { ceil: "#0c1322", wall: "#172233", haze: "#35606a", floorHi: "#384650", floorLo: "#121820", neon: "#d6f0ea", lamp: "#ffcf86", grade: "#0b1c26", accent: "#7fd8c4" },
  { ceil: "#0a1224", wall: "#12203a", haze: "#2e6690", floorHi: "#33455c", floorLo: "#0f1724", neon: "#cfeaff", lamp: "#ffd79a", grade: "#071a30", accent: "#6fe0ff" },
  { ceil: "#080d1a", wall: "#0f1628", haze: "#27406a", floorHi: "#2a3446", floorLo: "#0b0f18", neon: "#c9d8ff", lamp: "#ffae5a", grade: "#060d20", accent: "#ff9a3a" },
  { ceil: "#050b10", wall: "#08141a", haze: "#11505a", floorHi: "#26363c", floorLo: "#070c10", neon: "#b8fff0", lamp: "#ff6a5a", grade: "#021216", accent: "#39ffb0" },
];

/** Kulissen-Einfärbung je Stufe: Farbe, Deckkraft, Dunst unten */
export const BACK_GRADE = [
  { tint: "#0a1530", a: 0.14, haze: "#3a5c90", hazeA: 0.12 },
  { tint: "#0a1822", a: 0.24, haze: "#3c6c70", hazeA: 0.12 },
  { tint: "#061630", a: 0.28, haze: "#2f70a0", hazeA: 0.16 },
  { tint: "#050c1e", a: 0.42, haze: "#243e6e", hazeA: 0.1 },
  { tint: "#021418", a: 0.5, haze: "#0f6a66", hazeA: 0.2 },
];
