/**
 * Christkindlmarkt – Stimmungsstufen des Renderers: Farb-/Nebel-Einfärbungen der gemalten Ebenen und Zahlentabellen
 * (Lichtstärke, Schneedichte, Wind, Polarlicht, Glut …). Tabellen werden mit `stageVal(tab, stage + blend)` interpoliert.
 *
 *   0 Dämmerung am Rathausplatz  · Abendrot, leichter Schneefall
 *   1 Marktgetümmel              · Blaue Stunde, alle Lichter, dichter Fernblick
 *   2 Eistraum                   · kalt-türkis, Eiskristall-Glitzer, Polarlicht
 *   3 Schneesturm                · Whiteout: starker Schnee, Böen, Fernebenen verblassen
 *   4 Krampuslauf                · Nacht mit roter Glut, Fackeln, Funken
 */
import type { StageTint } from "../shared-b/layers";

export type TintFn = (stage: number) => StageTint;

/** Dunkelheit (Leuchten der Skins) */
export const NIGHT = [0.25, 0.85, 0.6, 0.4, 0.95];
/** Stärke der zusätzlichen Leuchtpunkte (Fenster, Laternen, Lichterketten) */
export const LIGHTS = [0.55, 1, 0.85, 0.42, 0.95];
/** Schneedichte 0..1 */
export const SNOW = [0.34, 0.5, 0.44, 1, 0.26];
/** Grundwind (px/s, negativ = weht gegen die Laufrichtung) */
export const WIND = [-50, -70, -60, -330, -130];
/** Polarlicht */
export const AURORA = [0, 0, 0.9, 0.12, 0.85];
/** Glut/Funken */
export const EMBERS = [0, 0, 0, 0, 1];
/** Eiskristall-Glitzer in der Luft */
export const SPARKLE = [0, 0.15, 1, 0.2, 0];
/** Whiteout-Schleier */
export const VEIL = [0, 0, 0, 1, 0];
/** rote Glut am Boden/Horizont */
export const REDGLOW = [0, 0, 0, 0, 1];
/** Himmelslaternen (steigen im Marktgetümmel auf) */
export const SKYLANTERN = [0.35, 1, 0.3, 0, 0.45];
/** Sterne am Himmel (Funkeln) */
export const STARS = [0.3, 0.9, 1, 0.15, 1];

const nt = (color: string, a: number): { color: string; a: number } => ({ color, a });

// --- Einfärbungen je Ebene (Index = Stufe) ----------------------------------------------------------

export const FAR_TINT: TintFn = (s) =>
  [
    { night: nt("#241a52", 0.06), haze: { color: "#9a86cc", aTop: 0.1, aBottom: 0.3 } },
    { night: nt("#0b1846", 0.4), haze: { color: "#2c3c88", aTop: 0.1, aBottom: 0.3 } },
    { night: nt("#0a2a5a", 0.2), haze: { color: "#7fd0ff", aTop: 0.2, aBottom: 0.38 } },
    { night: nt("#c6d2e0", 0.8), haze: { color: "#dde6f2", aTop: 0.12, aBottom: 0.3 } },
    { night: nt("#1e0810", 0.62), haze: { color: "#ff3a2a", aTop: 0.04, aBottom: 0.22 } },
  ][s];

const SHADE = [
  { color: "#231a48", a: 0.2, from: 0.5 },
  { color: "#050a26", a: 0.3, from: 0.5 },
  { color: "#04143a", a: 0.26, from: 0.5 },
  { color: "#b8c6d8", a: 0.22, from: 0.5 },
  { color: "#12040a", a: 0.3, from: 0.5 },
];

export const MARKET_TINT: TintFn = (s) =>
  [
    { haze: { color: "#a690d4", aTop: 0, aBottom: 0.1 } },
    { night: nt("#0c1440", 0.3), haze: { color: "#243a86", aTop: 0, aBottom: 0.18 } },
    { night: nt("#0c1c48", 0.2), haze: { color: "#7fd0ff", aTop: 0, aBottom: 0.2 } },
    { night: nt("#c2cedd", 0.55), haze: { color: "#e2eaf5", aTop: 0.08, aBottom: 0.26 } },
    { night: nt("#12040a", 0.3) },
  ].map((t, i) => ({ ...t, shade: SHADE[i] }))[s];

export const RINK_TINT: TintFn = (s) =>
  [
    { haze: { color: "#a690d4", aTop: 0, aBottom: 0.1 } },
    { night: nt("#0c1440", 0.3), haze: { color: "#243a86", aTop: 0, aBottom: 0.18 } },
    { night: nt("#0a1c48", 0.16), haze: { color: "#7fd0ff", aTop: 0.04, aBottom: 0.22 } },
    { night: nt("#b8c6d8", 0.54), haze: { color: "#e4ecf6", aTop: 0.1, aBottom: 0.28 } },
    { night: nt("#12040a", 0.3) },
  ].map((t, i) => ({ ...t, shade: SHADE[i] }))[s];

export const KRAMPUS_TINT: TintFn = (s) =>
  [
    { night: nt("#12040a", 0.3) },
    { night: nt("#12040a", 0.3) },
    { night: nt("#12040a", 0.3) },
    { night: nt("#12040a", 0.3) },
    { night: nt("#12040a", 0.08), haze: { color: "#ff4a2a", aTop: 0, aBottom: 0.1 }, shade: { color: "#12040a", a: 0.22, from: 0.5 } },
  ][s];

export const NEAR_TINT: TintFn = (s) =>
  [
    { night: nt("#1a1236", 0.3) },
    { night: nt("#070d24", 0.56) },
    { night: nt("#062046", 0.42), haze: { color: "#66c8ff", aTop: 0, aBottom: 0.14 } },
    { night: nt("#9db0c6", 0.44) },
    { night: nt("#14060a", 0.7) },
  ][s];

export const GROUND_TINT: TintFn = (s) =>
  [
    { haze: { color: "#7a6ac0", aTop: 0.1, aBottom: 0.05 } },
    { night: nt("#0a1030", 0.4) },
    { night: nt("#082040", 0.24), haze: { color: "#66c8ff", aTop: 0.1, aBottom: 0.1 } },
    { night: nt("#b0c0d4", 0.24) },
    { night: nt("#3a0c04", 0.42), haze: { color: "#ff5a2a", aTop: 0.16, aBottom: 0 } },
  ][s];

export const ICE_TINT: TintFn = (s) =>
  [
    { haze: { color: "#7a6ac0", aTop: 0.06, aBottom: 0.04 } },
    { night: nt("#0a1444", 0.3) },
    {},
    { night: nt("#c8d8ea", 0.25) },
    { night: nt("#3a0a10", 0.36), haze: { color: "#ff5a2a", aTop: 0.14, aBottom: 0 } },
  ][s];

/** Zeichenbereich für die Himmelsvarianten */
export const SKY_H = 600;

/** Ebenen-Sichtbarkeit je Stufe (Kreuzblende zwischen Marktstand, Eisbahn und Krampusmarkt) */
export const VIS_MARKET = [1, 1, 0, 0, 0];
export const VIS_RINK = [0, 0, 1, 1, 0];
export const VIS_KRAMPUS = [0, 0, 0, 0, 1];
