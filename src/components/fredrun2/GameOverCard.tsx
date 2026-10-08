"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CHARACTERS } from "@/game/fredrun2/characters";
import { deathLabel } from "@/game/fredrun2/death-names";
import type { FredRunGame, RunResult } from "@/game/fredrun2/game";
import type { Profile } from "@/game/fredrun2/profile";
import { QUIT_CAUSE } from "@/game/fredrun2/run-summary";
import { ARM_DELAY_MS, armed, countUpValue, formatNumber, gameOverSummary } from "@/game/fredrun2/ui-logic";
import { WORLDS } from "@/game/fredrun2/worlds";

import styles from "./fredrun2.module.css";

// --- Eingabesperre (gemeinsam für Game-Over-Karte und Pause-Dialog) ----------------------------------

export interface ArmGate {
  /** Sperrzeit abgelaufen: die Schaltflächen sind aktiv (vorher gedimmt und deaktiviert) */
  ready: boolean;
  /**
   * Darf diese Taste jetzt auslösen? Nein während der Sperre, bei Auto-Repeat und bei einer Taste, die schon vor dem Einblenden
   * (oder während der Sperre) gedrückt wurde und noch gehalten wird – so löst weder gehaltenes Enter noch gehaltene Leertaste
   * (die Sprungtaste!) beim Tod oder beim Pausieren versehentlich „Nochmal“/„Weiter“ aus.
   */
  keyOk: (e: KeyboardEvent) => boolean;
  /** Hält der Spieler noch eine Taste, die nicht auslösen darf? Dann ist ein Tastatur-Klick (detail 0) auf einen Knopf wirkungslos. */
  heldBlocked: () => boolean;
}

/**
 * Sperrzeit nach dem Einblenden eines Overlays (`delayMs` ab Einhängen, siehe ARM_DELAY_MS/PAUSE_ARM_MS). Mausklick und Tippen
 * wirken danach sofort. Die Tasten-Buchführung läuft über window (Capture), damit sie vor jedem anderen Handler und auch dann
 * gilt, wenn der Fokus gerade auf einem Knopf liegt.
 */
export function useArmGate(delayMs: number): ArmGate {
  const [ready, setReady] = useState(false);
  const shownAt = useRef(0);
  /** Tasten, die nicht auslösen dürfen, solange sie gehalten werden */
  const [blocked] = useState(() => new Set<string>());
  /** Tasten, deren Druck nach der Sperre begann (ein Auto-Repeat davon ist erlaubt, der einer älteren Taste nicht) */
  const [fresh] = useState(() => new Set<string>());

  useEffect(() => {
    shownAt.current = performance.now();
    const timer = window.setTimeout(() => setReady(true), delayMs);
    const onDown = (e: KeyboardEvent): void => {
      if (!armed(performance.now(), shownAt.current, delayMs)) blocked.add(e.code);
      else if (!e.repeat) fresh.add(e.code);
      else if (!fresh.has(e.code)) blocked.add(e.code);
    };
    // Verzögert löschen: der Klick, den das Loslassen der Leertaste auslöst, folgt noch im selben Ereignis und soll die Taste sehen
    const onUp = (e: KeyboardEvent): void => {
      window.setTimeout(() => {
        blocked.delete(e.code);
        fresh.delete(e.code);
      }, 0);
    };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      blocked.clear();
      fresh.clear();
    };
  }, [delayMs, blocked, fresh]);

  const keyOk = useCallback(
    (e: KeyboardEvent): boolean => armed(performance.now(), shownAt.current, delayMs) && !e.repeat && !blocked.has(e.code),
    [delayMs, blocked],
  );
  const heldBlocked = useCallback((): boolean => blocked.size > 0, [blocked]);
  return useMemo(() => ({ ready, keyOk, heldBlocked }), [ready, keyOk, heldBlocked]);
}

/** Füllbalken unter den gesperrten Schaltflächen: läuft in der Sperrzeit von 0 auf 100 %, danach wird er entfernt. */
export function ArmBar({ ms }: { ms: number }): React.ReactElement {
  return <span className={styles.armBar} style={{ ["--arm-ms" as string]: `${ms}ms` }} aria-hidden="true" />;
}

/** Einzeiler für Spieler mit Controller (sobald ein Pad erkannt wurde): erklärt die Menü-Belegung. */
export function PadHint(): React.ReactElement {
  return <p className={styles.padHint}>A = Bestätigen, B = Zurück</p>;
}

// --- Hochzählen der Punktzahl --------------------------------------------------------------------------

const COUNT_UP_MS = 900;

/**
 * Anzeigewert, der in COUNT_UP_MS von 0 auf `target` hochzählt (easeOut); `instant` (Weniger Bewegung) zeigt sofort das Ergebnis.
 * `finish` springt ans Ende (Klick auf die Karte).
 */
function useCountUp(target: number, instant: boolean): { value: number; finish: () => void } {
  const [value, setValue] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    if (instant) return;
    const t0 = performance.now();
    const step = (now: number): void => {
      const t01 = (now - t0) / COUNT_UP_MS;
      setValue(countUpValue(t01, target));
      if (t01 < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, instant]);
  const finish = useCallback(() => {
    cancelAnimationFrame(raf.current);
    setValue(target);
  }, [target]);
  return { value: instant ? target : value, finish };
}

// --- Karte ---------------------------------------------------------------------------------------------

export interface GameOverCardProps {
  game: FredRunGame | null;
  result: RunResult;
  /** Profil NACH dem Lauf (Guthaben inklusive der Münzen dieses Laufs, freigeschaltete Helden) */
  profile: Profile;
  /** Zeile zur weltweiten Bestenliste (nur mit Anmeldung), sonst null */
  boardLine: string | null;
  /** Weniger Bewegung: Zahl nicht hochzählen */
  reduced: boolean;
  /** Controller erkannt: Bedienhinweis anzeigen */
  padHint: boolean;
  /** Gehört diese Taste dem Spiel? (eingebettet nur im Spielbereich, nie in Eingabefeldern) */
  acceptsKey: (e: KeyboardEvent) => boolean;
  /** Klickton und Audio-Entsperrung vor der Aktion (aus der Hauptkomponente) */
  click: (fn: () => void) => () => void;
}

/**
 * Ergebnis-Karte nach Tod oder „Lauf beenden“: große Punktzahl (zählt hoch), Rekord-Kontext mit Fortschrittsbalken, Platz,
 * Münzen samt nächstem Ziel und die sechs Lauf-Statistiken. Die ersten ARM_DELAY_MS ms nimmt sie keine Eingabe an
 * (Dauertippen und Tasten-Repeat beim Tod sollen die Karte nicht überspringen).
 */
export default function GameOverCard({ game, result, profile, boardLine, reduced, padHint, acceptsKey, click }: GameOverCardProps): React.ReactElement {
  const gate = useArmGate(ARM_DELAY_MS);
  const { keyOk, heldBlocked } = gate;
  const summary = useMemo(() => gameOverSummary(result, profile, CHARACTERS), [result, profile]);
  const score = Math.max(0, Math.floor(result.score));
  const count = useCountUp(score, reduced);
  const primaryRef = useRef<HTMLButtonElement | null>(null);

  // Fokus auf „Nochmal“ erst nach der Sperre (vorher sind die Knöpfe deaktiviert)
  useEffect(() => {
    if (gate.ready) primaryRef.current?.focus();
  }, [gate.ready]);

  // Tastatur: Enter/Leertaste = Nochmal, Esc = Menü (ohne Fokus auf einem Knopf; ein fokussierter Knopf löst selbst aus)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!acceptsKey(e)) return;
      if (e.code === "Enter" || e.code === "Space") {
        if ((e.target as HTMLElement | null)?.tagName === "BUTTON") return;
        e.preventDefault();
        if (keyOk(e)) game?.restart();
      } else if (e.code === "Escape" && keyOk(e)) {
        game?.toMenu();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [game, acceptsKey, keyOk]);

  /** Knopf-Klick: ein Tastatur-Klick (detail 0) zählt nicht, solange eine vor der Sperre gedrückte Taste noch gehalten wird */
  const act =
    (fn: () => void) =>
    (e: React.MouseEvent<HTMLButtonElement>): void => {
      if (e.detail === 0 && heldBlocked()) return;
      click(fn)();
    };

  const quit = result.deathCause === QUIT_CAUSE;
  const cause = deathLabel(result.deathCause);
  const title = result.isNewBest && !summary.firstRun ? "Neuer Rekord!" : "Geschafft!";
  const pill = result.isNewBest ? (summary.firstRun ? "Erster Lauf!" : "Persönliche Bestleistung") : null;
  const place = result.mode === "tour" ? "Weltreise" : result.mode === "daily" ? "Tageslauf" : WORLDS[result.world].name;
  const seconds = Math.floor(result.seconds);
  const stats: Array<[string, string]> = [
    [`${formatNumber(result.meters)} m`, "Strecke"],
    [`+${formatNumber(result.coins)}`, "Münzen"],
    [`×${result.maxCombo}`, "Kombo"],
    [formatNumber(result.stomps), "Stampfer"],
    [formatNumber(result.nearMisses), "Knapp"],
    [`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`, "Zeit"],
  ];

  return (
    <div className={`${styles.overlay} ${styles.veilFull} ${styles.modal} ${result.isNewBest ? styles.veilRecord : ""}`} data-nav-scope="gameover">
      {/* Ein Klick auf die Karte überspringt das Hochzählen */}
      <div className={`${styles.modalCard} ${styles.resultCard}`} role="dialog" aria-label="Ergebnis" onPointerDown={count.finish}>
        <div className={styles.resultHead}>
          <h2 className={styles.modalTitle}>{title}</h2>
          {pill ? <div className={styles.newBest}>{pill}</div> : null}
          <div className={styles.bigScore} aria-hidden="true">
            {formatNumber(count.value)}
          </div>
          <span className={styles.srOnly}>{`${formatNumber(score)} Punkte`}</span>
          <div className={`${styles.muted} ${styles.resultCause}`}>
            {place}
            {quit ? ` · ${cause}` : cause ? ` · gestoppt von: ${cause}` : ""}
          </div>
          {boardLine ? (
            <div className={`${styles.muted} ${styles.resultCause}`} aria-live="polite">
              {boardLine}
            </div>
          ) : null}
        </div>

        <div className={styles.resultInfo}>
          <div className={`${styles.recordLine} ${result.isNewBest ? styles.recordLineGold : ""}`}>{summary.recordLine}</div>
          <div className={styles.recordBar} aria-hidden="true">
            <span className={styles.recordBarFill} style={{ width: `${Math.round(summary.progress * 100)}%` }} />
          </div>
          {summary.rankLine ? <div className={styles.runMeta}>{summary.rankLine}</div> : null}
          <div className={styles.runMeta}>{summary.coinsLine}</div>
          {summary.nextGoalLine ? <div className={`${styles.runMeta} ${styles.runGoal}`}>{summary.nextGoalLine}</div> : null}
        </div>

        <div className={styles.stats}>
          {stats.map(([value, label], i) => (
            <div key={label} className={styles.stat} style={{ ["--i" as string]: i }}>
              <b>{value}</b>
              <span>{label}</span>
            </div>
          ))}
        </div>

        <div className={styles.resultActions}>
          <button ref={primaryRef} type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={!gate.ready} onClick={act(() => game?.restart())} data-nav-default>
            Nochmal
          </button>
          <button type="button" className={styles.btn} disabled={!gate.ready} onClick={act(() => game?.toMenu())} data-nav-back>
            Menü
          </button>
          {gate.ready ? null : <ArmBar ms={ARM_DELAY_MS} />}
        </div>
        {padHint ? <PadHint /> : null}
      </div>
    </div>
  );
}
