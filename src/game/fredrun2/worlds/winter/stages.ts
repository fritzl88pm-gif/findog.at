/** Christkindlmarkt – Stimmungsstufen: gemeinsame Tabellen für Weltsystem und Renderer. */

export const WINTER_STAGE_NAMES = ["Dämmerung am Rathausplatz", "Marktgetümmel", "Eistraum", "Schneesturm", "Krampuslauf"];

export const MAX_STAGE = 4;

/** Wind-Klangteppich je Stufe (Sturm = laut) */
export const WIND_LOOP = [0.14, 0.18, 0.22, 0.85, 0.42];
/** Marktgemurmel je Stufe */
export const CROWD_LOOP = [0.32, 0.5, 0.26, 0, 0];
/** Böen-Häufigkeit (Sek. zwischen zwei Böen: Mittelwert) */
export const GUST_EVERY = [14, 12, 10, 4.5, 8];
