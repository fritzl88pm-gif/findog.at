"use client";

import NextImage from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import type { WoBeschlussSceneHandle } from "@/components/wo-beschluss-scene";
import {
  createWoBeschlussState,
  woBeschlussDamageStageForHits,
  type WoBeschlussCondition,
  type WoBeschlussState,
} from "@/lib/wo-beschluss";

const conditionLabels: Record<WoBeschlussCondition, string> = {
  ready: "Kampfbereit",
  shaken: "Angeschlagen",
  dazed: "Benommen",
  critical: "Kurz vor K. o.",
  down: "K. o.",
};
const LOADING_SCREEN_SOURCE = "/wo-beschluss/loading.jpg";

export default function WoBeschlussView() {
  const gameContainerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<WoBeschlussSceneHandle | null>(null);
  const [snapshot, setSnapshot] = useState<WoBeschlussState>(createWoBeschlussState);
  const [sceneAssetsReady, setSceneAssetsReady] = useState(false);
  const [loadingScreenReady, setLoadingScreenReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const isReady = sceneAssetsReady && loadingScreenReady;

  useEffect(() => {
    let isDisposed = false;
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      void image.decode()
        .then(() => {
          if (!isDisposed) setLoadingScreenReady(true);
        })
        .catch(() => {
          if (!isDisposed) setLoadError("Der Ladebildschirm konnte nicht geladen werden.");
        });
    };
    image.onerror = () => {
      if (!isDisposed) setLoadError("Der Ladebildschirm konnte nicht geladen werden.");
    };
    image.src = LOADING_SCREEN_SOURCE;

    return () => { isDisposed = true; };
  }, []);

  useEffect(() => {
    let isDisposed = false;
    let game: { destroy(removeCanvas?: boolean): void } | null = null;

    async function mountGame() {
      try {
        const [{ default: Phaser }, { createWoBeschlussScene }] = await Promise.all([
          import("phaser"),
          import("@/components/wo-beschluss-scene"),
        ]);
        if (isDisposed || !gameContainerRef.current) return;

        const scene = createWoBeschlussScene(Phaser, (state) => {
          if (!isDisposed) setSnapshot(state);
        }, () => {
          if (!isDisposed) setSceneAssetsReady(true);
        }, () => {
          if (!isDisposed) setLoadError("Die Spielgrafiken konnten nicht geladen werden.");
        });
        sceneRef.current = scene;
        game = new Phaser.Game({
          type: Phaser.AUTO,
          parent: gameContainerRef.current,
          backgroundColor: "#eef4f7",
          scale: {
            mode: Phaser.Scale.RESIZE,
            width: "100%",
            height: "100%",
          },
          render: { antialias: true, pixelArt: false },
          loader: { imageLoadType: "HTMLImageElement" },
          scene: [scene],
        });
      } catch {
        if (!isDisposed) setLoadError("Das Spiel konnte nicht geladen werden.");
      }
    }

    void mountGame();
    return () => {
      isDisposed = true;
      sceneRef.current = null;
      game?.destroy(true);
    };
  }, []);

  const resetRound = useCallback(() => {
    sceneRef.current?.resetRound();
  }, []);

  return (
    <section className="forms-panel wo-beschluss-panel" aria-labelledby="wo-beschluss-title">
      <div className="wo-beschluss-view">
        <header className="wo-beschluss-header">
          <div>
            <p className="eyebrow">TRAININGS-MVP</p>
            <h1 id="wo-beschluss-title">Wo Beschluss?</h1>
          </div>
          <button
            className="wo-beschluss-reset"
            type="button"
            onClick={resetRound}
            disabled={!isReady}
            aria-label="Spiel neu starten"
          >
            Neu starten
          </button>
        </header>

        <section className="wo-beschluss-hud" aria-label="Spielstatus">
          <div className="wo-beschluss-status-row">
            <span>Zustand</span>
            <strong>{conditionLabels[snapshot.condition]}</strong>
          </div>
          <div
            className="wo-beschluss-meter"
            data-level={snapshot.condition}
            role="progressbar"
            aria-label="Zustand der Figur"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={snapshot.health}
          >
            <div className="wo-beschluss-meter-fill" style={{ width: `${snapshot.health}%` }} />
          </div>
          <div className="wo-beschluss-stats" aria-live="polite">
            <span><strong>{snapshot.hits}</strong> Treffer</span>
            <span>Stufe <strong>{woBeschlussDamageStageForHits(snapshot.hits) + 1}</strong>/8</span>
            <span><strong>{snapshot.health}</strong>%</span>
          </div>
        </section>

        <section className="wo-beschluss-stage" aria-label="Spielfeld" aria-busy={!isReady && !loadError}>
          <div
            ref={gameContainerRef}
            className={`wo-beschluss-canvas${isReady ? "" : " wo-beschluss-canvas--loading"}`}
            aria-hidden={!isReady || undefined}
          />
          {!isReady && !loadError ? (
            <div className="wo-beschluss-loading-screen" role="status" aria-live="polite">
              <NextImage
                className="wo-beschluss-loading-image"
                src={LOADING_SCREEN_SOURCE}
                alt="Wo Beschluss wird geladen."
                fill
                loading="eager"
                sizes="(max-width: 600px) 100vw, 980px"
                unoptimized
              />
            </div>
          ) : null}
          {loadError ? <p className="wo-beschluss-error" role="alert">{loadError}</p> : null}
          {!snapshot.finished && snapshot.hits === 0 && isReady ? (
            <p className="wo-beschluss-hint">Klicke oder tippe auf das Gesicht</p>
          ) : null}
          {snapshot.finished ? (
            <div className="wo-beschluss-end-card">
              <h2>Auszahlung erfolgt! Endlich...</h2>
              <button type="button" onClick={resetRound}>Nochmal</button>
            </div>
          ) : null}
        </section>

        <footer className="wo-beschluss-footer">Nur eine stilisierte, fiktive Figur · keine realen Personen</footer>
      </div>
    </section>
  );
}
