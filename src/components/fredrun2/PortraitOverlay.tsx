"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import styles from "./fredrun2.module.css";

export interface PortraitOverlayProps {
  /**
   * `rotate`: Hochformat-Hinweis über dem ganzen Bildschirm (position: fixed; Geschwister der Bühne, damit er deren 16:9-Band
   * verlässt). `embed`: Karte „Zum Spielen Vollbild öffnen“ über der kleinen eingebetteten Spielfläche (Handy in der App-Ansicht).
   */
  variant: "rotate" | "embed";
  /** Vollbild-Schnittstelle vorhanden (document.fullscreenEnabled bzw. webkitFullscreenEnabled); sonst gibt es keinen toten Knopf */
  canFullscreen: boolean;
  /** Eingebettet ohne Vollbild: Ziel des Links „Eigenständig öffnen“ (die eigenständige Seite füllt den Bildschirm); sonst null */
  standaloneHref: string | null;
  /** „Vollbild & Querformat“: Vollbild anfordern (versucht dabei orientation.lock) */
  onFullscreen: () => void;
  /** „Trotzdem spielen“ bzw. „Hier spielen“ */
  onDismiss: () => void;
}

/** Aufforderung zum Drehen bzw. zum Vollbild. Eigene rem-/vmin-Maße: die Bühnen-Einheit --px gilt außerhalb der Bühne nicht. */
export default function PortraitOverlay({ variant, canFullscreen, standaloneHref, onFullscreen, onDismiss }: PortraitOverlayProps): React.ReactElement {
  const rotate = variant === "rotate";
  const primaryRef = useRef<HTMLElement | null>(null);

  // Fokus auf den Haupt-Knopf: Tastatur und Gamepad starten dort, der Bereich dahinter ist gesperrt (inert)
  useEffect(() => {
    primaryRef.current?.focus();
  }, []);

  const primary = canFullscreen ? (
    <button ref={(el) => void (primaryRef.current = el)} type="button" className={`${styles.portraitBtn} ${styles.portraitBtnMain}`} data-nav-default onClick={onFullscreen}>
      {rotate ? "Vollbild & Querformat" : "Vollbild öffnen"}
    </button>
  ) : standaloneHref ? (
    <Link ref={(el: HTMLAnchorElement | null) => void (primaryRef.current = el)} className={`${styles.portraitBtn} ${styles.portraitBtnMain}`} href={standaloneHref} data-nav-default>
      Eigenständig öffnen
    </Link>
  ) : null;

  return (
    <div
      className={`${styles.portrait} ${rotate ? "" : styles.portraitEmbed}`}
      role={rotate ? "alert" : "dialog"}
      aria-label={rotate ? undefined : "Vollbild empfohlen"}
      data-fr2-ui
      data-nav-scope={rotate ? "portrait" : "embed"}
    >
      <div className={styles.portraitInner}>
        {rotate ? (
          <div className={styles.portraitPhone} aria-hidden="true">
            <span />
          </div>
        ) : null}
        <p className={styles.portraitTitle}>{rotate ? "Bitte das Gerät ins Querformat drehen" : "Zum Spielen Vollbild öffnen"}</p>
        {rotate ? <p className={styles.portraitText}>Fredrun läuft quer am besten – dann ist das Spielfeld groß genug.</p> : null}
        <div className={styles.portraitActions}>
          {primary}
          <button type="button" className={styles.portraitBtn} onClick={onDismiss}>
            {rotate ? "Trotzdem spielen" : "Hier spielen"}
          </button>
        </div>
        {rotate ? <p className={styles.portraitTip}>Tipp: Dreht sich der Bildschirm nicht mit, ist die Bildschirmsperre deines Geräts aktiv – bitte ausschalten.</p> : null}
      </div>
    </div>
  );
}
