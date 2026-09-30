/**
 * Opernball – Stimmungsstufen (Tabellen). Index = Stufe: 0 Foyer & roter Teppich · 1 Ballsaal · 2 Logen · 3 Spiegelsaal ·
 * 4 Mitternachts-Polonaise. Alle Werte sind pro Stufe angegeben und werden über `stage + stageBlend` überblendet.
 */
import { StagePalette } from "../shared-b/color";

export const MAX_STAGE = 4;
export const STAGE_NAMES = ["Foyer & roter Teppich", "Ballsaal", "Logen", "Spiegelsaal", "Mitternachts-Polonaise"];

const BASE = "/fredrun2/worlds/oper";
export const FAR_URLS = [`${BASE}/far-foyer.webp`, `${BASE}/far-ballroom.webp`, `${BASE}/far-boxes.webp`, `${BASE}/far-mirror.webp`, `${BASE}/far-midnight.webp`];
export const MID_COLUMNS_URL = `${BASE}/mid-columns.webp`;
export const MID_TABLES_URL = `${BASE}/mid-tables.webp`;
export const NEAR_URL = `${BASE}/near-curtain.webp`;
export const GROUND_URLS = { carpet: `${BASE}/ground-carpet.webp`, parquet: `${BASE}/ground-parquet.webp` } as const;

/** Bodenart pro Stufe */
export const GROUND_KIND: Array<"carpet" | "parquet"> = ["carpet", "parquet", "carpet", "parquet", "parquet"];

/** Ambient-Stärken (0…1) */
export const CONE = [0.5, 0.78, 0.5, 0.95, 0.8];
export const GLINT = [0.75, 1, 0.65, 1, 1];
export const CONFETTI = [0.05, 0.12, 0.06, 0.28, 1];
export const BUBBLES = [0.3, 0.9, 0.3, 1, 0.7];
export const FIREWORKS = [0, 0, 0, 0, 1];
/** Verdunkelung des Saals (Logen dramatischer) */
export const DARK = [0.03, 0.06, 0.3, 0.0, 0.18];
/** Sichtbarkeit der Mittelgrund-Reihen */
export const MID_COLUMNS = [1, 0, 1, 0, 0];
export const MID_TABLES = [0, 1, 0, 1, 1];
/** Anteil der Tanz-Lichtpfützen auf dem Boden */
export const FLOOR_LIGHT = [0.55, 0.85, 0.5, 1, 0.9];

export interface StageColors {
  /** Licht-/Funkelfarbe (additiv) */
  glow: string;
  /** Lichtkegel */
  cone: string;
  /** Farbstich über allem (Overlay, sehr schwach) */
  grade: string;
  /** Vignette-Farbe */
  vignette: string;
  /** Bodenlicht */
  floor: string;
}

export const COLORS = new StagePalette<keyof StageColors>([
  { glow: "#ffd98a", cone: "#ffe8b8", grade: "#ffe9c8", vignette: "#3a0a12", floor: "#ffd9a0" },
  { glow: "#ffc457", cone: "#ffd88a", grade: "#ffc25e", vignette: "#3a0a08", floor: "#ffc46a" },
  { glow: "#ff8a5c", cone: "#ff9a70", grade: "#ff3a2c", vignette: "#1c0208", floor: "#ff7a50" },
  { glow: "#dfeaff", cone: "#e6efff", grade: "#cfe0ff", vignette: "#1a2440", floor: "#dbe8ff" },
  { glow: "#ff7ad8", cone: "#ffb0ee", grade: "#ff4fc8", vignette: "#150a30", floor: "#ff8ae0" },
]);

/** Konfetti-Farben (Stufe 4: bunter, sonst Gold/Rot/Creme) */
export const CONFETTI_COLORS = ["#ffd24a", "#e2264d", "#ffb347", "#c81e3c", "#fff1c9", "#ff9ab8", "#ff4fa3", "#5ef2ff", "#9dff6a", "#b98cff", "#ffffff"];

/** Sekunden pro Walzer-Schlag (Dreivierteltakt); ein Takt = 3 Schläge. */
export const BEAT = 0.52;
