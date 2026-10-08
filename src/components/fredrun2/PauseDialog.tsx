"use client";

import { useEffect, useRef } from "react";

import type { FredRunGame } from "@/game/fredrun2/game";
import { PAUSE_ARM_MS, formatNumber } from "@/game/fredrun2/ui-logic";

import { ArmBar, PadHint, useArmGate } from "./GameOverCard";
import styles from "./fredrun2.module.css";

export interface PauseDialogProps {
  game: FredRunGame | null;
  /** Stand des laufenden Laufs (snap.live): Punkte und gesammelte Münzen */
  live: { score: number; coins?: number };
  muted: boolean;
  /** Controller erkannt: Bedienhinweis anzeigen */
  padHint: boolean;
  /** Gehört diese Taste dem Spiel? (eingebettet nur im Spielbereich, nie in Eingabefeldern) */
  acceptsKey: (e: KeyboardEvent) => boolean;
  /** Klickton und Audio-Entsperrung vor der Aktion (aus der Hauptkomponente) */
  click: (fn: () => void) => () => void;
  /** Ton ein/aus */
  onToggleMute: () => void;
}

/**
 * Pause-Dialog. „Lauf beenden“ bucht den Lauf und zeigt die Ergebnis-Karte (nichts geht verloren), „Neustart“ bucht und startet neu.
 * Die ersten PAUSE_ARM_MS ms nimmt er keine Eingabe an: ein Doppeltipp auf die Pause-Taste soll nicht sofort „Weiter“ oder
 * eine der Abbruch-Tasten treffen.
 */
export default function PauseDialog({ game, live, muted, padHint, acceptsKey, click, onToggleMute }: PauseDialogProps): React.ReactElement {
  const gate = useArmGate(PAUSE_ARM_MS);
  const { keyOk, heldBlocked } = gate;
  const resumeRef = useRef<HTMLButtonElement | null>(null);

  // Fokus auf „Weiter“ erst nach der Sperre (vorher sind die Knöpfe deaktiviert)
  useEffect(() => {
    if (gate.ready) resumeRef.current?.focus();
  }, [gate.ready]);

  // Tastatur: Enter/Leertaste = Weiter (ohne Fokus auf einem Knopf; ein fokussierter Knopf löst selbst aus). Esc/P setzt die Eingabe fort.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!acceptsKey(e) || (e.code !== "Enter" && e.code !== "Space")) return;
      if ((e.target as HTMLElement | null)?.tagName === "BUTTON") return;
      e.preventDefault();
      if (keyOk(e)) game?.resume();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [game, acceptsKey, keyOk]);

  const act =
    (fn: () => void) =>
    (e: React.MouseEvent<HTMLButtonElement>): void => {
      if (e.detail === 0 && heldBlocked()) return;
      click(fn)();
    };

  return (
    <div className={`${styles.overlay} ${styles.veilFull} ${styles.modal}`} data-nav-scope="pause">
      <div className={`${styles.modalCard} ${styles.pauseCard}`} role="dialog" aria-label="Pause">
        <h2 className={styles.modalTitle}>Pause</h2>
        <p className={`${styles.muted} ${styles.pauseRun}`}>
          Aktueller Lauf: {formatNumber(live.score)} Punkte · {formatNumber(live.coins ?? 0)} Münzen
        </p>
        <button ref={resumeRef} type="button" className={styles.playBtn} disabled={!gate.ready} onClick={act(() => game?.resume())} data-nav-default data-nav-back>
          Weiter
        </button>
        <div className={styles.pauseRow}>
          <button type="button" className={`${styles.btn} ${styles.pauseBtnLg}`} disabled={!gate.ready} onClick={act(() => game?.quitRun("restart"))}>
            Neustart
          </button>
          <button type="button" className={`${styles.btn} ${styles.pauseBtnLg}`} disabled={!gate.ready} onClick={act(() => game?.quitRun("result"))}>
            Lauf beenden
          </button>
        </div>
        <button type="button" className={`${styles.btn} ${styles.pauseMute}`} onClick={click(onToggleMute)}>
          {muted ? "🔇 Ton an" : "🔊 Ton aus"}
        </button>
        {gate.ready ? null : <ArmBar ms={PAUSE_ARM_MS} />}
        {padHint ? <PadHint /> : null}
      </div>
    </div>
  );
}
