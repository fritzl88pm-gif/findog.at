/**
 * Hauptthread kurz freigeben (Eingaben, rAF und Rendering dürfen dazwischen laufen).
 * Gedacht für lange synchrone Bakes (Welt-Laden, Weltreise-Nachladen): zwischen zwei Ebenen/Kacheln `await yieldToMain()`.
 * Reihenfolge der Wege: scheduler.yield (Chrome/Firefox, behält die Priorität der Fortsetzung) → MessageChannel
 * (ohne die 4-ms-Klemmung und Hintergrund-Drosselung von setTimeout) → setTimeout 0.
 * Ohne Fenster (SSR, Vitest „node“) ist das Versprechen sofort erfüllt – so hängen Tests mit Fake-Timern nicht.
 */

interface SchedulerLike {
  yield?: () => Promise<void>;
}

export function yieldToMain(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  try {
    const s = (window as unknown as { scheduler?: SchedulerLike }).scheduler;
    if (s && typeof s.yield === "function") return s.yield();
  } catch {
    // scheduler.yield nicht nutzbar → Fallbacks
  }
  return new Promise<void>((resolve) => {
    if (typeof MessageChannel !== "undefined") {
      try {
        const ch = new MessageChannel();
        ch.port1.onmessage = () => {
          ch.port1.onmessage = null;
          ch.port1.close();
          resolve();
        };
        ch.port2.postMessage(0);
        return;
      } catch {
        // MessageChannel gesperrt → setTimeout
      }
    }
    setTimeout(resolve, 0);
  });
}
