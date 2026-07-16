"use client";

import NextImage from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  FREDRUN_GROUND_Y,
  FREDRUN_MILESTONE_DURATION,
  FREDRUN_MILESTONE_POINTS,
  FREDRUN_PLAYER_X,
  FREDRUN_WORLD_HEIGHT,
  FREDRUN_WORLD_WIDTH,
  advanceFredRun,
  createFredRunState,
  jumpFredRun,
  pauseFredRun,
  readFredRunHighScore,
  restartFredRun,
  resumeFredRun,
  startFredRun,
  writeFredRunHighScore,
  type FredRunObstacle,
  type FredRunObstacleKind,
  type FredRunPhase,
  type FredRunState,
} from "@/lib/fredrun";

const SPRITE_CELL_SIZE = 192;
const SPRITE_DRAW_SIZE = 166;
const JUMP_ANIMATION_DURATION = 0.82;
const FIXED_STEP = 1 / 120;
const INTRO_SOURCE = "/fredrun/intro.webp";

const spriteLayouts = {
  walk: { source: "/fredrun/walk.png", columns: 8, frameCount: 64 },
  jump: { source: "/fredrun/jump.png", columns: 6, frameCount: 24 },
  victory: { source: "/fredrun/victory.png", columns: 8, frameCount: 64 },
} as const;

const obstacleLayouts: Record<
  FredRunObstacleKind,
  {
    source: string;
    drawWidth: number;
    drawHeight: number;
    offsetX: number;
    animation?: { columns: number; cellSize: number; frameCount: number; fps: number };
  }
> = {
  odo: {
    source: "/fredrun/odo-run.webp",
    drawWidth: 118,
    drawHeight: 118,
    offsetX: -40,
    animation: { columns: 8, cellSize: 192, frameCount: 64, fps: 22 },
  },
  reihe100: {
    source: "/fredrun/obstacles/reihe100.webp",
    drawWidth: 72,
    drawHeight: 72,
    offsetX: -8,
  },
  steuerkodex: {
    source: "/fredrun/obstacles/steuerkodex.webp",
    drawWidth: 61,
    drawHeight: 82,
    offsetX: -8,
  },
  paragraph: {
    source: "/fredrun/obstacles/paragraph.webp",
    drawWidth: 56,
    drawHeight: 78,
    offsetX: -7,
  },
};

type SpriteKey = keyof typeof spriteLayouts;
type SpriteImages = Record<SpriteKey, HTMLImageElement>;
type ObstacleImages = Record<FredRunObstacleKind, HTMLImageElement>;
type FredRunImages = { sprites: SpriteImages; obstacles: ObstacleImages };

type FredRunSnapshot = {
  phase: FredRunPhase;
  score: number;
  level: number;
};

function snapshotFrom(state: FredRunState): FredRunSnapshot {
  return { phase: state.phase, score: state.score, level: state.level };
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Sprite konnte nicht geladen werden: ${source}`));
    image.src = source;
  });
}

function drawBackground(context: CanvasRenderingContext2D, state: FredRunState, reducedMotion: boolean) {
  const sky = context.createLinearGradient(0, 0, 0, FREDRUN_GROUND_Y);
  sky.addColorStop(0, "#dff5ff");
  sky.addColorStop(0.64, "#f7fcff");
  sky.addColorStop(1, "#fff8df");
  context.fillStyle = sky;
  context.fillRect(0, 0, FREDRUN_WORLD_WIDTH, FREDRUN_WORLD_HEIGHT);

  const cloudOffset = reducedMotion ? 0 : (state.distance * 0.04) % 1120;
  context.fillStyle = "rgba(255, 255, 255, 0.82)";
  for (const cloud of [[180, 76, 1], [545, 110, 0.78], [890, 64, 0.9]] as const) {
    const x = ((cloud[0] - cloudOffset + 1120) % 1120) - 80;
    const y = cloud[1];
    const scale = cloud[2];
    context.beginPath();
    context.arc(x, y, 24 * scale, Math.PI, 0);
    context.arc(x + 28 * scale, y - 10 * scale, 31 * scale, Math.PI, 0);
    context.arc(x + 62 * scale, y, 23 * scale, Math.PI, 0);
    context.closePath();
    context.fill();
  }

  const skylineOffset = reducedMotion ? 0 : (state.distance * 0.12) % 124;
  context.fillStyle = "rgba(40, 111, 156, 0.14)";
  for (let index = -1; index < 10; index += 1) {
    const x = index * 124 - skylineOffset;
    const height = 34 + ((index + 12) % 3) * 13;
    context.fillRect(x, FREDRUN_GROUND_Y - height, 82, height);
    context.fillRect(x + 20, FREDRUN_GROUND_Y - height - 12, 42, 12);
    context.fillRect(x + 37, FREDRUN_GROUND_Y - height - 26, 7, 14);
  }

  context.fillStyle = "#d8e7dc";
  context.fillRect(0, FREDRUN_GROUND_Y, FREDRUN_WORLD_WIDTH, FREDRUN_WORLD_HEIGHT - FREDRUN_GROUND_Y);
  context.fillStyle = "#8eb59b";
  context.fillRect(0, FREDRUN_GROUND_Y, FREDRUN_WORLD_WIDTH, 6);
  context.strokeStyle = "rgba(30, 82, 116, 0.2)";
  context.lineWidth = 2;
  const groundOffset = reducedMotion ? 0 : state.distance % 76;
  for (let x = -groundOffset; x < FREDRUN_WORLD_WIDTH; x += 76) {
    context.beginPath();
    context.moveTo(x, FREDRUN_GROUND_Y + 35);
    context.lineTo(x + 28, FREDRUN_GROUND_Y + 35);
    context.stroke();
  }
}

function drawObstacle(
  context: CanvasRenderingContext2D,
  obstacle: FredRunObstacle,
  image: HTMLImageElement,
  elapsed: number,
  reducedMotion: boolean,
) {
  const layout = obstacleLayouts[obstacle.kind];
  const drawX = obstacle.x + layout.offsetX;
  const drawY = FREDRUN_GROUND_Y - layout.drawHeight;
  context.save();
  if (obstacle.kind === "odo") {
    const bubbleX = obstacle.x + 28;
    const bubbleY = drawY - 29;
    const bubbleWidth = 92;
    const bubbleHeight = 42;
    context.shadowColor = "rgba(19, 53, 75, 0.18)";
    context.shadowBlur = 6;
    context.shadowOffsetY = 3;
    context.fillStyle = "rgba(255, 255, 255, 0.97)";
    context.strokeStyle = "#17242d";
    context.lineWidth = 2;
    context.beginPath();
    context.roundRect(bubbleX, bubbleY, bubbleWidth, bubbleHeight, 14);
    context.moveTo(bubbleX + 15, bubbleY + bubbleHeight - 2);
    context.lineTo(bubbleX + 2, bubbleY + bubbleHeight + 11);
    context.lineTo(bubbleX + 27, bubbleY + bubbleHeight - 1);
    context.closePath();
    context.fill();
    context.stroke();
    context.shadowColor = "transparent";
    context.fillStyle = "#101820";
    context.font = "900 12px system-ui";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("Wo", bubbleX + bubbleWidth / 2, bubbleY + 13);
    context.fillText("Beschluss?", bubbleX + bubbleWidth / 2, bubbleY + 28);
  }
  context.shadowColor = "rgba(19, 53, 75, 0.2)";
  context.shadowBlur = 7;
  context.shadowOffsetY = 4;
  if (layout.animation) {
    const frame = reducedMotion
      ? 0
      : (Math.floor(elapsed * layout.animation.fps) + obstacle.id * 7) % layout.animation.frameCount;
    const sourceX = (frame % layout.animation.columns) * layout.animation.cellSize;
    const sourceY = Math.floor(frame / layout.animation.columns) * layout.animation.cellSize;
    context.drawImage(
      image,
      sourceX,
      sourceY,
      layout.animation.cellSize,
      layout.animation.cellSize,
      drawX,
      drawY,
      layout.drawWidth,
      layout.drawHeight,
    );
  } else {
    context.drawImage(image, drawX, drawY, layout.drawWidth, layout.drawHeight);
  }
  context.restore();
}

function activeSprite(state: FredRunState): { key: SpriteKey; frame: number } {
  const effectivePhase = state.phase === "paused" ? state.pausedFrom : state.phase;
  if (effectivePhase === "milestone") {
    const progress = 1 - state.milestoneRemaining / FREDRUN_MILESTONE_DURATION;
    return {
      key: "victory",
      frame: Math.min(
        spriteLayouts.victory.frameCount - 1,
        Math.max(0, Math.floor(progress * spriteLayouts.victory.frameCount)),
      ),
    };
  }
  if (!state.grounded) {
    const progress = state.jumpElapsed / JUMP_ANIMATION_DURATION;
    return {
      key: "jump",
      frame: Math.min(
        spriteLayouts.jump.frameCount - 1,
        Math.max(0, Math.floor(progress * spriteLayouts.jump.frameCount)),
      ),
    };
  }
  if (effectivePhase === "running") {
    return { key: "walk", frame: Math.floor(state.elapsed * 18) % spriteLayouts.walk.frameCount };
  }
  return { key: "walk", frame: 0 };
}

function renderFredRun(
  canvas: HTMLCanvasElement,
  state: FredRunState,
  images: FredRunImages | null,
  reducedMotion: boolean,
) {
  const context = canvas.getContext("2d");
  if (!context || canvas.width === 0 || canvas.height === 0) {
    return;
  }
  context.setTransform(canvas.width / FREDRUN_WORLD_WIDTH, 0, 0, canvas.height / FREDRUN_WORLD_HEIGHT, 0, 0);
  context.imageSmoothingEnabled = true;
  drawBackground(context, state, reducedMotion);
  if (images) {
    state.obstacles.forEach((obstacle) => drawObstacle(
      context,
      obstacle,
      images.obstacles[obstacle.kind],
      state.elapsed,
      reducedMotion,
    ));
  }

  if (images) {
    const sprite = activeSprite(state);
    const layout = spriteLayouts[sprite.key];
    const sourceX = (sprite.frame % layout.columns) * SPRITE_CELL_SIZE;
    const sourceY = Math.floor(sprite.frame / layout.columns) * SPRITE_CELL_SIZE;
    const footY = FREDRUN_GROUND_Y - state.playerHeight + 4;
    context.drawImage(
      images.sprites[sprite.key],
      sourceX,
      sourceY,
      SPRITE_CELL_SIZE,
      SPRITE_CELL_SIZE,
      FREDRUN_PLAYER_X - SPRITE_DRAW_SIZE / 2,
      footY - SPRITE_DRAW_SIZE,
      SPRITE_DRAW_SIZE,
      SPRITE_DRAW_SIZE,
    );
  }
}

function phaseStatus(snapshot: FredRunSnapshot): string {
  if (snapshot.phase === "ready") return "Fredrun ist bereit.";
  if (snapshot.phase === "running") return `Runde läuft. ${snapshot.score} Punkte, Stufe ${snapshot.level}.`;
  if (snapshot.phase === "milestone") return `${snapshot.score} Punkte erreicht. Fred feiert.`;
  if (snapshot.phase === "paused") return "Fredrun ist pausiert.";
  return `Runde beendet mit ${snapshot.score} Punkten.`;
}

function localHighScoreStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export default function FredRunView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number | null>(null);
  const gameRef = useRef<FredRunState>(createFredRunState());
  const imagesRef = useRef<FredRunImages | null>(null);
  const bestScoreRef = useRef(0);
  const reducedMotionRef = useRef(false);
  const [snapshot, setSnapshot] = useState<FredRunSnapshot>(() => snapshotFrom(createFredRunState()));
  const [bestScore, setBestScore] = useState(0);
  const [assetState, setAssetState] = useState<"loading" | "ready" | "error">("loading");
  const [assetAttempt, setAssetAttempt] = useState(0);

  const publish = useCallback((state: FredRunState) => {
    setSnapshot((current) => {
      if (current.phase === state.phase && current.score === state.score && current.level === state.level) {
        return current;
      }
      return snapshotFrom(state);
    });
  }, []);

  const replaceGame = useCallback((state: FredRunState) => {
    gameRef.current = state;
    publish(state);
    if (canvasRef.current) {
      renderFredRun(canvasRef.current, state, imagesRef.current, reducedMotionRef.current);
    }
  }, [publish]);

  const startOrJump = useCallback(() => {
    if (assetState !== "ready") return;
    let state = gameRef.current;
    if (state.phase === "ready") {
      state = startFredRun(state);
    } else if (state.phase === "paused") {
      state = resumeFredRun(state);
    } else if (state.phase === "game-over") {
      state = startFredRun(restartFredRun());
    }
    replaceGame(jumpFredRun(state));
  }, [assetState, replaceGame]);

  const startRound = useCallback(() => {
    if (assetState !== "ready") return;
    replaceGame(startFredRun(gameRef.current.phase === "ready" ? gameRef.current : restartFredRun()));
  }, [assetState, replaceGame]);

  const restartRound = useCallback(() => {
    replaceGame(restartFredRun());
  }, [replaceGame]);

  const togglePause = useCallback(() => {
    const state = gameRef.current.phase === "paused"
      ? resumeFredRun(gameRef.current)
      : pauseFredRun(gameRef.current);
    replaceGame(state);
  }, [replaceGame]);

  useEffect(() => {
    bestScoreRef.current = readFredRunHighScore(localHighScoreStorage());
    setBestScore(bestScoreRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      Promise.all((Object.keys(spriteLayouts) as SpriteKey[]).map(async (key) => (
        [key, await loadImage(spriteLayouts[key].source)] as const
      ))),
      Promise.all((Object.keys(obstacleLayouts) as FredRunObstacleKind[]).map(async (key) => (
        [key, await loadImage(obstacleLayouts[key].source)] as const
      ))),
      loadImage(INTRO_SOURCE),
    ])
      .then(([spriteEntries, obstacleEntries]) => {
        if (cancelled) return;
        imagesRef.current = {
          sprites: Object.fromEntries(spriteEntries) as SpriteImages,
          obstacles: Object.fromEntries(obstacleEntries) as ObstacleImages,
        };
        setAssetState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        imagesRef.current = null;
        setAssetState("error");
      });
    return () => { cancelled = true; };
  }, [assetAttempt]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => { reducedMotionRef.current = media.matches; };
    updatePreference();
    media.addEventListener("change", updatePreference);
    return () => media.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const density = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(bounds.width * density));
      const height = Math.max(1, Math.round(bounds.height * density));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      renderFredRun(canvas, gameRef.current, imagesRef.current, reducedMotionRef.current);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let previousTime = performance.now();
    let accumulator = 0;
    const tick = (time: number) => {
      const elapsed = Math.min(0.05, Math.max(0, (time - previousTime) / 1000));
      previousTime = time;
      accumulator += elapsed;
      let state = gameRef.current;
      while (accumulator >= FIXED_STEP) {
        state = advanceFredRun(state, FIXED_STEP);
        accumulator -= FIXED_STEP;
      }
      if (state !== gameRef.current) {
        const previousPhase = gameRef.current.phase;
        gameRef.current = state;
        publish(state);
        if (state.phase === "game-over" && previousPhase !== "game-over") {
          const nextBest = writeFredRunHighScore(localHighScoreStorage(), state.score, bestScoreRef.current);
          if (nextBest !== bestScoreRef.current) {
            bestScoreRef.current = nextBest;
            setBestScore(nextBest);
          }
        }
      }
      if (canvasRef.current) {
        renderFredRun(canvasRef.current, state, imagesRef.current, reducedMotionRef.current);
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [publish]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" && event.code !== "ArrowUp") return;
      event.preventDefault();
      if (!event.repeat) startOrJump();
    };
    const pauseForInterruption = () => {
      if (document.hidden || !document.hasFocus()) {
        replaceGame(pauseFredRun(gameRef.current));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", pauseForInterruption);
    document.addEventListener("visibilitychange", pauseForInterruption);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", pauseForInterruption);
      document.removeEventListener("visibilitychange", pauseForInterruption);
    };
  }, [replaceGame, startOrJump]);

  const isPaused = snapshot.phase === "paused";
  const showPauseButton = snapshot.phase === "running" || snapshot.phase === "milestone" || isPaused;
  const showIntro = assetState !== "error" && snapshot.phase === "ready";

  return (
    <section className="forms-panel fredrun-panel" aria-labelledby="fredrun-view-title">
      <div className="forms-view fredrun-view">
        <header className="forms-view-header fredrun-header">
          <div>
            <p className="eyebrow">Findog Spielpause</p>
            <h1 id="fredrun-view-title">Fredrun</h1>
            <p>Spring mit Fred über REIH 100, Steuerkodex, Paragraphen und unerwartete Hindernisse.</p>
          </div>
          <div className="fredrun-controls-copy" aria-label="Steuerung">
            <span><kbd>Leertaste</kbd> oder <kbd>↑</kbd></span>
            <small>Alternativ Spielfeld antippen</small>
          </div>
        </header>

        <div className={`fredrun-game-shell${showIntro ? " fredrun-game-shell--intro" : ""}`}>
          {!showIntro ? (
            <div className="fredrun-hud" aria-label="Spielstand">
              <div><span>Punkte</span><strong>{snapshot.score}</strong></div>
              <div><span>Stufe</span><strong>{snapshot.level}</strong></div>
              <div><span>Bestwert</span><strong>{bestScore}</strong></div>
              {showPauseButton ? (
                <button type="button" onClick={togglePause}>{isPaused ? "Weiter" : "Pause"}</button>
              ) : null}
            </div>
          ) : null}

          <div className={`fredrun-stage${showIntro ? " fredrun-stage--intro" : ""}`}>
            <canvas
              ref={canvasRef}
              className="fredrun-canvas"
              onPointerDown={(event) => {
                event.preventDefault();
                startOrJump();
              }}
              aria-label="Fredrun-Spielfeld. Leertaste, Pfeil nach oben oder Antippen zum Springen."
              aria-hidden={showIntro || undefined}
              tabIndex={showIntro ? -1 : 0}
            />

            {assetState === "error" ? (
              <div className="fredrun-overlay" role="alert">
                <h2>Die Spielgrafiken konnten nicht geladen werden</h2>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => {
                    setAssetState("loading");
                    setAssetAttempt((attempt) => attempt + 1);
                  }}
                >
                  Erneut versuchen
                </button>
              </div>
            ) : null}
            {showIntro ? (
              <div
                className="fredrun-intro"
                aria-label={assetState === "loading" ? "Fredrun wird geladen" : "Fredrun-Titelscreen"}
                aria-busy={assetState === "loading"}
              >
                <NextImage
                  className="fredrun-intro-image"
                  src={INTRO_SOURCE}
                  alt="Fred Runner: Fred läuft vor Akten, Gesetzbüchern und dem Ruf nach einem Beschluss davon."
                  fill
                  loading="eager"
                  sizes="(max-width: 760px) 100vw, 1040px"
                  unoptimized
                />
                {assetState === "ready" ? (
                  <div className="fredrun-intro-action">
                    <button className="primary-button" type="button" onClick={startRound}>Loslaufen</button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {snapshot.phase === "milestone" ? (
              <div className="fredrun-milestone-message">
                <p className="fredrun-overlay-kicker">Nächste Stufe</p>
                <h2>{snapshot.score} Punkte!</h2>
              </div>
            ) : null}
            {snapshot.phase === "paused" ? (
              <div className="fredrun-overlay">
                <p className="fredrun-overlay-kicker">Kurze Pause</p>
                <h2>Fred wartet auf dich</h2>
                <button className="primary-button" type="button" onClick={togglePause}>Weiterspielen</button>
              </div>
            ) : null}
            {snapshot.phase === "game-over" ? (
              <div className="fredrun-overlay">
                <p className="fredrun-overlay-kicker">Runde beendet</p>
                <h2>{snapshot.score} Punkte</h2>
                <p>Bestwert: {bestScore}</p>
                <button className="primary-button" type="button" onClick={restartRound}>Noch einmal</button>
              </div>
            ) : null}
          </div>

          {!showIntro ? (
            <>
              {snapshot.phase === "running" ? (
                <div className="fredrun-mobile-action">
                  <button className="primary-button" type="button" onClick={startOrJump}>Springen</button>
                </div>
              ) : null}
              <p className="fredrun-status" role="status" aria-live="polite">{phaseStatus(snapshot)}</p>
              <p className="fredrun-milestone-note">Alle {FREDRUN_MILESTONE_POINTS} Punkte feiert Fred – danach wird es schneller.</p>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
