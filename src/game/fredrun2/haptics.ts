/**
 * Haptik (Vibration) für Handys. Reine Hilfsfunktion ohne Zustand: ruft `navigator.vibrate` nur, wenn es die API gibt (Android;
 * iOS-Safari kennt sie nicht → ohne Wirkung), die Einstellung "Vibration" an ist und nicht die Demo läuft. Wirft nie.
 */

/** Vibrationsmuster in Millisekunden (Zahl = ein Impuls, Liste = Impuls/Pause/Impuls …). Bewusst kurz, damit sie nicht nerven. */
export const HAPTIC_PATTERNS = {
  hurt: 35,
  stomp: 15,
  death: [70, 40, 110],
  pit: 50,
  dash: 14,
  powerup: 10,
} as const satisfies Record<string, number | readonly number[]>;

export type HapticKind = keyof typeof HAPTIC_PATTERNS;

export interface HapticOpts {
  /** Einstellung `haptics` */
  enabled: boolean;
  /** Demo-/Menü-Hintergrundlauf: nie vibrieren */
  demo: boolean;
}

/** Gibt es die Vibrations-API in dieser Umgebung (für die Sichtbarkeit des Schalters)? */
export function hapticsSupported(): boolean {
  try {
    return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
  } catch {
    return false;
  }
}

/** Löst das Muster `kind` aus. Rückgabe: true, wenn die Vibration ausgelöst wurde (false: aus, Demo, keine API, abgelehnt oder Fehler). */
export function haptic(kind: HapticKind, opts: HapticOpts): boolean {
  if (!opts.enabled || opts.demo) return false;
  try {
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return false;
    const pattern = HAPTIC_PATTERNS[kind];
    // Der Browser liefert false, wenn er die Vibration ablehnt (z. B. noch keine Nutzergeste); veränderbare Kopie nur bei Listen nötig
    const fired = navigator.vibrate(typeof pattern === "number" ? pattern : [...pattern]);
    return fired !== false;
  } catch {
    return false;
  }
}
