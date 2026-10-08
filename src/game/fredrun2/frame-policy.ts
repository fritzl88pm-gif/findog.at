/**
 * Zeichen-Entscheidung der Live-Schleife (rein, ohne DOM): wann muss ein rAF-Frame wirklich gezeichnet werden?
 *
 * Pause, Game-Over-Karte und ein verdecktes Menü zeigen (fast) ein Standbild, trotzdem rechnete und zeichnete die Schleife
 * jeden Frame mit voller Last (Akku, Wärme, Kompositor). Die Regeln:
 *  - Pause (und das eingefrorene Ergebnis nach „Lauf beenden“): nur bei `dirty` – Phasenwechsel, Resize/Skalenwechsel,
 *    Qualitätswechsel, Wiederkehr in den Tab, auslaufendes Wackeln/Blitzen. Sonst steht das Bild.
 *  - Game-Over-Karte: ca. 30 fps; der Sieger-Tanz (neuer Rekord) bleibt flüssig.
 *  - Menü hinter einer verdeckenden Ebene (Charaktere, Bestenliste, Einstellungen, Anleitung): ca. 8 fps.
 *  - Countdown, Lauf, sichtbares Menü: jeder Frame.
 * Die Drosselung gilt nur für die Live-Schleife; Debug-/QA-Pfade (manual, debugAdvance, debugRender, debugSettle) zeichnen immer.
 *
 * Statt eines Frame-Zählers rechnet die Entscheidung mit der Zeit seit dem letzten gezeichneten Frame: „jeder zweite rAF“ wären
 * auf 120-Hz-Anzeigen 60 fps und auf 30-Hz-Geräten (iOS-Stromsparmodus) nur 15 fps; so bleibt die Rate geräteunabhängig.
 */

/** Phasen des Spiels (Spiegel von GamePhase in game.ts, damit diese Datei ohne Abhängigkeit testbar bleibt). */
export type DrawPhase = "loading" | "menu" | "countdown" | "running" | "paused" | "gameover";

/**
 * Mindestabstand zweier gezeichneter Frames der Game-Over-Karte (ms). 28 statt 33,3: rAF-Zeitstempel schwanken um ±0,5 ms, und
 * zwei 60-Hz-Frames (33,3 ms) müssen sicher durchkommen, ein einzelner (16,7 ms) nicht. Ergibt auf 60/90/120/144 Hz ca. 30 fps.
 */
export const GAMEOVER_INTERVAL_MS = 28;

/** Mindestabstand im verdeckten Menü (ms): ergibt auf 30/60/120 Hz je ca. 7,5 bis 8 fps. */
export const COVERED_INTERVAL_MS = 117;

/**
 * Kleinster erlaubter Abstand zwischen zwei gezeichneten Frames ohne Dirty-Anlass:
 * 0 = jeder Frame, Infinity = nie (nur bei `dirty`).
 */
export function drawIntervalMs(phase: DrawPhase, menuCovered: boolean, victory: boolean): number {
  switch (phase) {
    case "paused":
      return Number.POSITIVE_INFINITY;
    case "gameover":
      return victory ? 0 : GAMEOVER_INTERVAL_MS;
    case "menu":
      return menuCovered ? COVERED_INTERVAL_MS : 0;
    default:
      return 0;
  }
}

/** Läuft die Phase mit voller Frame-Rate (keine Drosselung)? Nur solche Frames sagen etwas über die Leistung des Geräts. */
export function isFullRate(phase: DrawPhase, menuCovered: boolean, victory: boolean): boolean {
  return drawIntervalMs(phase, menuCovered, victory) === 0;
}

/**
 * Soll dieser rAF-Frame gezeichnet werden?
 * @param phase         Spielphase; für das eingefrorene Ergebnis nach „Lauf beenden“ wird "paused" übergeben (die Szene steht)
 * @param dirty         etwas hat sich geändert, das das Bild verändert oder die Zeichenfläche geleert hat (Resize, Phasenwechsel, …)
 * @param menuCovered   das Menü liegt unter einer Vollbild-Ebene
 * @param victory       Sieger-Tanz auf der Ergebnis-Karte (neuer Rekord): volle Rate
 * @param sinceDrawMs   Zeit seit dem letzten gezeichneten Frame (ms); Infinity = noch nie gezeichnet
 */
export function shouldDraw(phase: DrawPhase, dirty: boolean, menuCovered: boolean, victory: boolean, sinceDrawMs: number): boolean {
  if (dirty) return true;
  const gap = drawIntervalMs(phase, menuCovered, victory);
  if (gap === 0) return true;
  if (gap === Number.POSITIVE_INFINITY) return false;
  // `!(a < b)` statt `a >= b`: ein kaputter Zeitwert (NaN) darf das Bild nie dauerhaft einfrieren
  return !(sinceDrawMs < gap);
}
