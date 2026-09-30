"use client";

import FredRun2 from "./FredRun2";

/**
 * Fredrun 2.0 als Ansicht der App – aufgebaut wie die Ansicht des Original-Fredrun (`FredRunView`):
 * gleiches Panel, gleiche Kopfzeile („Findog Spielpause“), Spielrahmen mit Vollbild-Schaltfläche.
 */
export default function FredRun2View({ accessToken }: { accessToken: string }): React.ReactElement {
  return (
    <section className="forms-panel fredrun-panel" aria-labelledby="fredrun2-view-title">
      <div className="forms-view fredrun-view" style={{ width: "min(1180px, 100%)" }}>
        <header className="forms-view-header fredrun-header">
          <div>
            <p className="eyebrow">Findog Spielpause</p>
            <h1 id="fredrun2-view-title">Fredrun 2.0</h1>
            <p>Acht Welten, fünf Helden, Weltreise und Tageslauf: sammle Münzen, stampfe auf Gegner und jage den Highscore.</p>
          </div>
          <div className="fredrun-controls-copy" aria-label="Steuerung">
            <span>
              <kbd>Leertaste</kbd> oder <kbd>↑</kbd> springen · <kbd>↓</kbd> rutschen
            </span>
            <small>Shift = Dash · Esc = Pause · Spielfeld antippen geht auch</small>
          </div>
        </header>
        <FredRun2 embedded accessToken={accessToken} />
      </div>
    </section>
  );
}
