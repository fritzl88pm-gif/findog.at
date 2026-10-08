/**
 * Blitz-Skalierung für Welten (Wetter-Aufheller, Himmelsblitze, Feuerwerk-Leuchten): eine Regel für alle Welten, damit
 * „Weniger Bewegung“ (Fotosensitivität) nicht davon abhängt, dass jeder Aufrufer von `sim.view()` den Wert `flashScale`
 * korrekt kappt. `ViewState.flashScale` kommt aus der Einstellung „Blitze“; fehlt das Feld (ältere Aufrufer, Debug,
 * Weltreise-Vorschau) oder steht es auf dem Standard 1, begrenzt diese Funktion bei „Weniger Bewegung“ selbst.
 */
import type { ViewState } from "../../types";

/** höchster Blitz-Faktor bei „Weniger Bewegung“ (wie die Einstellung „Blitze“ dort begrenzt) */
export const REDUCED_FLASH_MAX = 0.3;

/**
 * Faktor 0..1 für die Intensität von Blitzen/Aufhellern einer Welt.
 * - ohne „Weniger Bewegung“: `flashScale` (fehlt es: 1)
 * - mit „Weniger Bewegung“: `flashScale` (fehlt es: `reducedDefault`, das bisherige Dämpfen der Welt), höchstens
 *   `REDUCED_FLASH_MAX` – der Regler ersetzt das alte Dämpfen also, wird aber nie darüber hinaus angehoben (keine
 *   Doppel-Skalierung, kein ungedämpfter Blitz, wenn der Aufrufer den Wert nicht kappt)
 * Ungültige Werte (NaN, negativ) ergeben 0 (kein Blitz).
 */
export function flashFactor(v: Pick<ViewState, "reducedMotion" | "flashScale">, reducedDefault = 0.25): number {
  const s = v.reducedMotion ? Math.min(v.flashScale ?? reducedDefault, REDUCED_FLASH_MAX) : (v.flashScale ?? 1);
  return s > 0 ? Math.min(1, s) : 0;
}
