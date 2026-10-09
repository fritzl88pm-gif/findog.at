/**
 * Pause zwischen den Bake-Schritten von `WorldRenderer.load()` (Wien, Prater, Alpen): gibt dem Browser Gelegenheit zu
 * Eingaben, rAF und Rendering, damit das Weltladen den Hauptthread nicht am Stück blockiert.
 *
 * Bewusst NICHT `yieldToMain` (../../yield): das nimmt `scheduler.yield()` zuerst, und in Chromium setzt dieses die
 * Fortsetzung mit der Priorität des laufenden Tasks vorn in die Warteschlange. Messung (30 Brocken je 4 ms, ca. 120 ms):
 * `scheduler.yield` lässt 1 rAF-Frame zu (größte Lücke 92-96 ms), MessageChannel 7-8 Frames (Lücke 17-20 ms), setTimeout(0)
 * 14-15 Frames. Beim Weltladen (1x) war die längste rAF-Lücke mit `scheduler.yield` 95-118 ms, mit MessageChannel
 * Wien 21-26, Prater 34-38, Alpen 45-48 ms – die Ladedauer steigt dafür um etwa 10-20 %.
 *
 * Reihenfolge: MessageChannel (kein 4-ms-Klemmen und keine Hintergrund-Drosselung wie bei setTimeout) → setTimeout 0.
 * Ohne Fenster (SSR, Vitest „node“) ist das Versprechen sofort erfüllt – so hängen Tests mit Fake-Timern nicht.
 */
export function yieldBetweenBakes(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
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
