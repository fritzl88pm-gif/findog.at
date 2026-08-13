"use client";

import NextImage from "next/image";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import {
  FREDRUN_COIN_SCORE,
  FREDRUN_GROUND_Y,
  FREDRUN_PLAYER_X,
  FREDRUN_SCORE_PULSE_POINTS,
  FREDRUN_WORLD_HEIGHT,
  FREDRUN_WORLD_WIDTH,
  advanceFredRun,
  createFredRunState,
  fredRunEnvironmentForDistance,
  jumpFredRun,
  pauseFredRun,
  readFredRunHighScore,
  restartFredRun,
  resumeFredRun,
  startFredRun,
  writeFredRunHighScore,
  type FredRunCoin,
  type FredRunObstacle,
  type FredRunObstacleKind,
  type FredRunEnvironment,
  type FredRunPhase,
  type FredRunState,
} from "@/lib/fredrun";
import {
  FREDRUN_PLAYER_NAME_MAX_LENGTH,
  normalizeFredRunPlayerName,
  parseFredRunHighscoresResponse,
  type FredRunLeaderboardEntry,
} from "@/lib/fredrun-highscores";

const SPRITE_CELL_SIZE = 192;
const SPRITE_DRAW_SIZE = 166;
const JUMP_ANIMATION_DURATION = 0.82;
const FIXED_STEP = 1 / 120;
const INTRO_SOURCE = "/fredrun/intro.webp";
const COIN_SOURCE = "/fredrun/coin-f.webp";
const BACKGROUND_FALLBACK_SOURCE = "/fredrun/vienna-panorama.webp";
const FREDRUN_BACKGROUND_SOURCES = [
  "/fredrun/backgrounds/vienna-ominous.webp",
  "/fredrun/backgrounds/vienna-gathering-storm.webp",
  "/fredrun/backgrounds/vienna-storm-damage.webp",
  "/fredrun/backgrounds/vienna-heavy-smoke-emergency.webp",
  "/fredrun/backgrounds/vienna-burning-collapse.webp",
  "/fredrun/backgrounds/vienna-widespread-fire-collapse.webp",
  "/fredrun/backgrounds/vienna-rubble-ashes.webp",
  "/fredrun/backgrounds/vienna-cold-ash-aftermath.webp",
] as const;
const BACKGROUND_DRAW_HEIGHT = 450;
const BACKGROUND_SCROLL_FACTOR = 0.12;

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
  madinger: {
    source: "/fredrun/madinger-walk.webp",
    drawWidth: 104,
    drawHeight: 104,
    offsetX: -31,
    animation: { columns: 7, cellSize: 192, frameCount: 49, fps: 18 },
  },
  jqa: {
    source: "/fredrun/jqa-dance-gangnam.webp",
    drawWidth: 108,
    drawHeight: 108,
    offsetX: -33,
    animation: { columns: 8, cellSize: 192, frameCount: 64, fps: 18 },
  },
  luki: {
    source: "/fredrun/luki-colombia-run.webp",
    drawWidth: 122,
    drawHeight: 122,
    offsetX: -38,
    animation: { columns: 7, cellSize: 192, frameCount: 49, fps: 20 },
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
type FredRunImages = {
  sprites: SpriteImages;
  obstacles: ObstacleImages;
  coin: HTMLImageElement;
  backgrounds: HTMLImageElement[];
};

type FredRunSnapshot = {
  phase: FredRunPhase;
  score: number;
  coinsCollected: number;
  countdown: number;
};

function snapshotFrom(state: FredRunState): FredRunSnapshot {
  return {
    phase: state.phase,
    score: state.score,
    coinsCollected: state.coinsCollected,
    countdown: Math.ceil(state.countdownRemaining),
  };
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

async function loadBackgrounds(): Promise<HTMLImageElement[]> {
  return Promise.all(FREDRUN_BACKGROUND_SOURCES.map(async (source) => {
    try {
      return await loadImage(source);
    } catch {
      return loadImage(BACKGROUND_FALLBACK_SOURCE);
    }
  }));
}

function drawFallbackBackground(
  context: CanvasRenderingContext2D,
  state: FredRunState,
  reducedMotion: boolean,
) {
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
}

function drawViennaBackground(
  context: CanvasRenderingContext2D,
  state: FredRunState,
  image: HTMLImageElement,
  reducedMotion: boolean,
  opacity = 1,
) {
  const tileWidth = BACKGROUND_DRAW_HEIGHT * image.naturalWidth / image.naturalHeight;
  const period = tileWidth * 2;
  const scroll = reducedMotion ? 0 : (state.distance * BACKGROUND_SCROLL_FACTOR) % period;
  let tileIndex = Math.floor(scroll / tileWidth);
  let drawX = -(scroll % tileWidth);
  const drawY = FREDRUN_GROUND_Y - BACKGROUND_DRAW_HEIGHT;

  context.save();
  context.globalAlpha *= Math.min(1, Math.max(0, opacity));
  while (drawX < FREDRUN_WORLD_WIDTH) {
    const tileLeft = Math.floor(drawX);
    const tileRight = Math.ceil(drawX + tileWidth);
    const seamSafeWidth = tileRight - tileLeft + 1;
    context.save();
    if (tileIndex % 2 === 1) {
      context.translate(tileLeft + seamSafeWidth, 0);
      context.scale(-1, 1);
      context.drawImage(image, 0, drawY, seamSafeWidth, BACKGROUND_DRAW_HEIGHT);
    } else {
      context.drawImage(image, tileLeft, drawY, seamSafeWidth, BACKGROUND_DRAW_HEIGHT);
    }
    context.restore();
    drawX += tileWidth;
    tileIndex += 1;
  }
  context.restore();
}

function seededUnit(index: number): number {
  const value = Math.sin(index * 91.733 + 17.17) * 43_758.5453;
  return value - Math.floor(value);
}

const LIGHTNING_SCHEDULES = [
  { cycleLength: 6.2, offset: 1.4, duration: 0.16, seed: 211 },
  { cycleLength: 9.1, offset: 4.7, duration: 0.13, seed: 367 },
] as const;

function drawLightningBolt(
  context: CanvasRenderingContext2D,
  x: number,
  flash: number,
  seed: number,
) {
  const direction = seededUnit(seed + 1) > 0.5 ? 1 : -1;
  const points = [
    { x, y: -4 },
    { x: x + direction * (10 + seededUnit(seed + 2) * 13), y: 34 },
    { x: x - direction * (5 + seededUnit(seed + 3) * 9), y: 69 },
    { x: x + direction * (12 + seededUnit(seed + 4) * 16), y: 105 },
    { x: x + direction * (4 + seededUnit(seed + 5) * 12), y: 148 },
  ];

  context.strokeStyle = `rgba(226, 240, 255, ${0.78 * flash})`;
  context.lineWidth = 1.5;
  context.shadowColor = `rgba(188, 217, 255, ${0.65 * flash})`;
  context.shadowBlur = 9;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.stroke();

  context.lineWidth = 0.8;
  context.beginPath();
  context.moveTo(points[2].x, points[2].y);
  context.lineTo(points[2].x - direction * 18, points[2].y + 18);
  context.lineTo(points[2].x - direction * 27, points[2].y + 39);
  context.stroke();
}

function drawStormAtmosphere(
  context: CanvasRenderingContext2D,
  state: FredRunState,
  environment: FredRunEnvironment,
  reducedMotion: boolean,
) {
  if (environment.storm <= 0.01 || reducedMotion) return;
  context.save();
  for (let index = 0; index < 7; index += 1) {
    const width = 250 + seededUnit(index + 10) * 205;
    const x = ((index * 218 - state.elapsed * (9 + index * 1.4) + 1_450) % 1_450) - 250;
    const opacity = (0.024 + seededUnit(index + 20) * 0.027) * environment.storm;
    context.fillStyle = `rgba(10, 18, 29, ${opacity})`;
    context.beginPath();
    context.ellipse(x, 42 + index * 15, width, 50 + index * 7, -0.08, 0, Math.PI * 2);
    context.fill();
  }

  for (const [index, schedule] of LIGHTNING_SCHEDULES.entries()) {
    const cycleTime = (state.elapsed + schedule.offset) % schedule.cycleLength;
    if (cycleTime >= schedule.duration) continue;
    const pulse = Math.sin(cycleTime / schedule.duration * Math.PI);
    const flash = pulse * environment.storm;
    const cycle = Math.floor((state.elapsed + schedule.offset) / schedule.cycleLength);
    const strikeSeed = schedule.seed + cycle * 17 + index * 101;
    const lightningX = 105 + seededUnit(strikeSeed) * 750;
    context.fillStyle = `rgba(214, 231, 255, ${0.095 * flash})`;
    context.fillRect(0, 0, FREDRUN_WORLD_WIDTH, FREDRUN_GROUND_Y);
    drawLightningBolt(context, lightningX, flash, strikeSeed);
  }
  context.restore();
}

function drawRainAtmosphere(
  context: CanvasRenderingContext2D,
  state: FredRunState,
  environment: FredRunEnvironment,
  reducedMotion: boolean,
) {
  if (environment.rain <= 0.01 || reducedMotion) return;
  context.save();
  const rainVeil = context.createLinearGradient(0, 0, 0, FREDRUN_GROUND_Y);
  rainVeil.addColorStop(0, `rgba(94, 120, 145, ${0.018 * environment.rain})`);
  rainVeil.addColorStop(1, `rgba(25, 43, 59, ${0.065 * environment.rain})`);
  context.fillStyle = rainVeil;
  context.fillRect(0, 0, FREDRUN_WORLD_WIDTH, FREDRUN_GROUND_Y);

  context.strokeStyle = `rgba(190, 216, 236, ${0.09 + 0.12 * environment.rain})`;
  context.lineWidth = 1;
  context.beginPath();
  for (let index = 0; index < 68; index += 1) {
    const speed = 235 + seededUnit(index + 410) * 190;
    const travel = (state.elapsed * speed + seededUnit(index + 430) * 530) % 530;
    const x = (seededUnit(index + 450) * (FREDRUN_WORLD_WIDTH + 120) - travel * 0.19
      + FREDRUN_WORLD_WIDTH + 120) % (FREDRUN_WORLD_WIDTH + 120) - 60;
    const y = travel - 54;
    const length = 9 + seededUnit(index + 470) * 16;
    context.moveTo(x, y);
    context.lineTo(x - 5 - environment.rain * 3, y + length);
  }
  context.stroke();
  context.restore();
}

function drawSmokeAtmosphere(
  context: CanvasRenderingContext2D,
  state: FredRunState,
  environment: FredRunEnvironment,
  reducedMotion: boolean,
) {
  if (environment.smoke <= 0.01 || reducedMotion) return;
  context.save();
  for (let index = 0; index < 9; index += 1) {
    const life = (state.elapsed * (0.025 + index * 0.0015) + index / 9) % 1;
    const baseX = 45 + seededUnit(index + 20) * 870;
    const drift = Math.sin(state.elapsed * 0.3 + index) * 22;
    const y = FREDRUN_GROUND_Y - 42 - life * 205;
    const radiusX = 23 + life * 38 + seededUnit(index + 40) * 12;
    const radiusY = radiusX * 0.55;
    const opacity = Math.sin(life * Math.PI) * 0.065 * environment.smoke;
    context.fillStyle = `rgba(36, 39, 43, ${opacity})`;
    context.beginPath();
    context.ellipse(baseX + drift, y, radiusX, radiusY, 0, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawAtmosphericParticles(
  context: CanvasRenderingContext2D,
  state: FredRunState,
  environment: FredRunEnvironment,
  reducedMotion: boolean,
) {
  if (reducedMotion) return;
  if (environment.embers > 0.01) {
    context.save();
    for (let index = 0; index < 22; index += 1) {
      const life = (state.elapsed * (0.12 + index * 0.0018) + seededUnit(index + 100)) % 1;
      const x = seededUnit(index + 120) * FREDRUN_WORLD_WIDTH
        + Math.sin(state.elapsed * 1.4 + index) * 12;
      const y = FREDRUN_GROUND_Y - 16 - life * 155;
      const opacity = Math.sin(life * Math.PI) * 0.72 * environment.embers;
      context.fillStyle = `rgba(255, ${125 + index % 3 * 36}, 38, ${opacity})`;
      context.fillRect(x, y, 1.4 + index % 2, 1.4 + index % 2);
    }
    context.restore();
  }

  if (environment.ash > 0.01) {
    context.save();
    for (let index = 0; index < 30; index += 1) {
      const life = (state.elapsed * (0.035 + index * 0.0007) + seededUnit(index + 150)) % 1;
      const x = (seededUnit(index + 180) * FREDRUN_WORLD_WIDTH
        + life * (35 + index % 5 * 8)) % FREDRUN_WORLD_WIDTH;
      const y = -12 + life * (FREDRUN_GROUND_Y + 28);
      const opacity = (0.18 + seededUnit(index + 210) * 0.28) * environment.ash;
      context.fillStyle = `rgba(214, 218, 220, ${opacity})`;
      context.fillRect(x, y, 1 + index % 2, 2 + index % 3);
    }
    context.restore();
  }
}

function drawBackground(
  context: CanvasRenderingContext2D,
  state: FredRunState,
  backgrounds: HTMLImageElement[],
  reducedMotion: boolean,
) {
  const environment = fredRunEnvironmentForDistance(state.distance);
  const fromBackground = backgrounds[environment.fromStage] ?? null;
  const toBackground = backgrounds[environment.toStage] ?? null;

  if (fromBackground) {
    drawViennaBackground(context, state, fromBackground, reducedMotion);
    if (toBackground && environment.toStage !== environment.fromStage && environment.blend > 0) {
      drawViennaBackground(context, state, toBackground, reducedMotion, environment.blend);
    }
  } else if (toBackground) {
    drawViennaBackground(context, state, toBackground, reducedMotion);
  } else {
    drawFallbackBackground(context, state, reducedMotion);
  }

  drawStormAtmosphere(context, state, environment, reducedMotion);
  drawRainAtmosphere(context, state, environment, reducedMotion);
  drawSmokeAtmosphere(context, state, environment, reducedMotion);
  drawAtmosphericParticles(context, state, environment, reducedMotion);

  const devastation = Math.min(1, environment.progress / 5);
  context.fillStyle = `rgb(${Math.round(184 - 111 * devastation)}, ${Math.round(192 - 121 * devastation)}, ${Math.round(182 - 114 * devastation)})`;
  context.fillRect(0, FREDRUN_GROUND_Y, FREDRUN_WORLD_WIDTH, FREDRUN_WORLD_HEIGHT - FREDRUN_GROUND_Y);
  context.fillStyle = `rgb(${Math.round(115 - 67 * devastation)}, ${Math.round(140 - 94 * devastation)}, ${Math.round(121 - 77 * devastation)})`;
  context.fillRect(0, FREDRUN_GROUND_Y, FREDRUN_WORLD_WIDTH, 6);
  context.strokeStyle = `rgba(32, 29, 27, ${0.2 + 0.22 * devastation})`;
  context.lineWidth = 2;
  const groundOffset = reducedMotion ? 0 : state.distance % 76;
  for (let x = -groundOffset; x < FREDRUN_WORLD_WIDTH; x += 76) {
    context.beginPath();
    context.moveTo(x, FREDRUN_GROUND_Y + 35);
    context.lineTo(x + 28, FREDRUN_GROUND_Y + 35);
    context.stroke();
  }

  if (environment.darkness > 0) {
    context.fillStyle = `rgba(9, 12, 18, ${environment.darkness})`;
    context.fillRect(0, 0, FREDRUN_WORLD_WIDTH, FREDRUN_WORLD_HEIGHT);
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

function FredRunCoinIcon({ className = "" }: { className?: string }) {
  return (
    <NextImage
      className={`fredrun-coin-icon${className ? ` ${className}` : ""}`}
      src={COIN_SOURCE}
      alt=""
      width={32}
      height={32}
      aria-hidden="true"
      unoptimized
    />
  );
}

function drawCoin(
  context: CanvasRenderingContext2D,
  coin: FredRunCoin,
  image: HTMLImageElement | null,
  elapsed: number,
  reducedMotion: boolean,
) {
  const spin = reducedMotion ? 1 : 0.24 + Math.abs(Math.cos(elapsed * 6.5 + coin.id)) * 0.76;
  context.save();
  context.translate(coin.x, coin.y);
  context.scale(spin, 1);
  if (image) {
    const diameter = coin.radius * 3;
    context.shadowColor = "rgba(55, 42, 10, 0.38)";
    context.shadowBlur = 6;
    context.drawImage(image, -diameter / 2, -diameter / 2, diameter, diameter);
  } else {
    context.fillStyle = "#ffd438";
    context.beginPath();
    context.arc(0, 0, coin.radius, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#704000";
    context.font = "900 11px system-ui";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("F", 0, 0.5);
  }
  context.restore();
}

function drawHitFeedback(
  context: CanvasRenderingContext2D,
  state: FredRunState,
) {
  if (state.phase !== "game-over") return;
  const centerX = FREDRUN_PLAYER_X + 13;
  const centerY = FREDRUN_GROUND_Y - state.playerHeight - 42;
  context.save();
  context.translate(centerX, centerY);
  context.strokeStyle = "rgba(255, 242, 132, 0.94)";
  context.lineWidth = 4;
  context.shadowColor = "rgba(220, 55, 15, 0.72)";
  context.shadowBlur = 10;
  for (let index = 0; index < 10; index += 1) {
    const angle = index / 10 * Math.PI * 2;
    context.beginPath();
    context.moveTo(Math.cos(angle) * 30, Math.sin(angle) * 30);
    context.lineTo(Math.cos(angle) * (43 + index % 2 * 9), Math.sin(angle) * (43 + index % 2 * 9));
    context.stroke();
  }
  context.restore();
}

function activeSprite(state: FredRunState): { key: SpriteKey; frame: number } {
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
  if (state.phase === "running") {
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
  context.clearRect(0, 0, FREDRUN_WORLD_WIDTH, FREDRUN_WORLD_HEIGHT);
  context.imageSmoothingEnabled = true;
  drawBackground(context, state, images?.backgrounds ?? [], reducedMotion);
  state.coins.forEach((coin) => drawCoin(context, coin, images?.coin ?? null, state.elapsed, reducedMotion));
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
  drawHitFeedback(context, state);
}

function FredRunVictoryDance() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadImage(spriteLayouts.victory.source).then((loadedImage) => {
      if (!cancelled) setImage(loadedImage);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(media.matches);
    updatePreference();
    media.addEventListener("change", updatePreference);
    return () => media.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !image) return;
    let animationFrame: number | null = null;
    const draw = (timestamp: number) => {
      const frame = reducedMotion
        ? 48
        : Math.floor(timestamp / 1_000 * 18) % spriteLayouts.victory.frameCount;
      const sourceX = (frame % spriteLayouts.victory.columns) * SPRITE_CELL_SIZE;
      const sourceY = Math.floor(frame / spriteLayouts.victory.columns) * SPRITE_CELL_SIZE;
      context.clearRect(0, 0, SPRITE_CELL_SIZE, SPRITE_CELL_SIZE);
      context.drawImage(
        image,
        sourceX,
        sourceY,
        SPRITE_CELL_SIZE,
        SPRITE_CELL_SIZE,
        0,
        0,
        SPRITE_CELL_SIZE,
        SPRITE_CELL_SIZE,
      );
      if (!reducedMotion) animationFrame = window.requestAnimationFrame(draw);
    };
    draw(performance.now());
    return () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
    };
  }, [image, reducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      className="fredrun-game-over-dance"
      width={SPRITE_CELL_SIZE}
      height={SPRITE_CELL_SIZE}
      role="img"
      aria-label="Fred tanzt"
    />
  );
}

function phaseStatus(snapshot: FredRunSnapshot): string {
  if (snapshot.phase === "ready") return "Fredrun ist bereit.";
  if (snapshot.phase === "running") return `Runde läuft. ${snapshot.score} Punkte.`;
  if (snapshot.phase === "paused") return "Fredrun ist pausiert.";
  if (snapshot.phase === "countdown") return `Weiter in ${snapshot.countdown}.`;
  return `Runde beendet mit ${snapshot.score} Punkten.`;
}

function localHighScoreStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function highscoreResponseError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return fallback;
  const error = (payload as Record<string, unknown>).error;
  return typeof error === "string" && error.length <= 240 ? error : fallback;
}

function createRunId(): string {
  return crypto.randomUUID();
}

export default function FredRunView({
  accessToken,
  standalone = false,
}: {
  accessToken: string;
  standalone?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number | null>(null);
  const gameRef = useRef<FredRunState>(createFredRunState());
  const imagesRef = useRef<FredRunImages | null>(null);
  const bestScoreRef = useRef(0);
  const reducedMotionRef = useRef(false);
  const scoreSubmissionAbortRef = useRef<AbortController | null>(null);
  const [snapshot, setSnapshot] = useState<FredRunSnapshot>(() => snapshotFrom(createFredRunState()));
  const [scorePulseToken, setScorePulseToken] = useState(0);
  const [coinPulseToken, setCoinPulseToken] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [assetState, setAssetState] = useState<"loading" | "ready" | "error">("loading");
  const [assetAttempt, setAssetAttempt] = useState(0);
  const [leaderboard, setLeaderboard] = useState<FredRunLeaderboardEntry[]>([]);
  const [leaderboardState, setLeaderboardState] = useState<"loading" | "ready" | "error">(
    accessToken ? "loading" : "error",
  );
  const [leaderboardError, setLeaderboardError] = useState(
    accessToken ? "" : "Die Topliste kann ohne aktive Anmeldung nicht geladen werden.",
  );
  const [leaderboardAttempt, setLeaderboardAttempt] = useState(0);
  const [playerName, setPlayerName] = useState("");
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [isSubmittingScore, setIsSubmittingScore] = useState(false);
  const [submittedRunId, setSubmittedRunId] = useState<string | null>(null);
  const [scoreSubmissionMessage, setScoreSubmissionMessage] = useState("");
  const [scoreSubmissionError, setScoreSubmissionError] = useState("");

  const publish = useCallback((state: FredRunState) => {
    setSnapshot((current) => {
      const next = snapshotFrom(state);
      if (
        current.phase === next.phase
        && current.score === next.score
        && current.coinsCollected === next.coinsCollected
        && current.countdown === next.countdown
      ) {
        return current;
      }
      return next;
    });
  }, []);

  const replaceGame = useCallback((state: FredRunState) => {
    gameRef.current = state;
    publish(state);
    if (canvasRef.current) {
      renderFredRun(canvasRef.current, state, imagesRef.current, reducedMotionRef.current);
    }
  }, [publish]);

  const prepareNewRun = useCallback(() => {
    setScorePulseToken(0);
    setCoinPulseToken(0);
    setCurrentRunId(createRunId());
    setSubmittedRunId(null);
    setScoreSubmissionMessage("");
    setScoreSubmissionError("");
  }, []);

  const startOrJump = useCallback(() => {
    if (assetState !== "ready") return;
    let state = gameRef.current;
    if (state.phase === "ready") {
      prepareNewRun();
      state = startFredRun(state);
    } else if (state.phase === "paused") {
      state = resumeFredRun(state);
    } else if (state.phase === "game-over") {
      prepareNewRun();
      state = startFredRun(restartFredRun());
    }
    replaceGame(jumpFredRun(state));
  }, [assetState, prepareNewRun, replaceGame]);

  const startRound = useCallback(() => {
    if (assetState !== "ready") return;
    prepareNewRun();
    replaceGame(startFredRun(gameRef.current.phase === "ready" ? gameRef.current : restartFredRun()));
  }, [assetState, prepareNewRun, replaceGame]);

  const restartRound = useCallback(() => {
    setScorePulseToken(0);
    setCoinPulseToken(0);
    setCurrentRunId(null);
    setSubmittedRunId(null);
    setScoreSubmissionMessage("");
    setScoreSubmissionError("");
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
    const controller = new AbortController();
    if (!accessToken) return () => controller.abort();
    void fetch("/api/fredrun/highscores", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    }).then(async (response) => {
      const payload = await response.json().catch(() => null) as unknown;
      if (!response.ok) {
        throw new Error(highscoreResponseError(payload, "Die Topliste konnte nicht geladen werden."));
      }
      const parsed = parseFredRunHighscoresResponse(payload);
      if (!parsed) throw new Error("Die Topliste lieferte ein ungültiges Antwortformat.");
      setLeaderboard(parsed.entries);
      setPlayerName((current) => current.trim() ? current : parsed.playerName);
      setLeaderboardState("ready");
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setLeaderboardState("error");
      setLeaderboardError(error instanceof Error ? error.message : "Die Topliste konnte nicht geladen werden.");
    });

    return () => controller.abort();
  }, [accessToken, leaderboardAttempt]);

  useEffect(() => () => scoreSubmissionAbortRef.current?.abort(), []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      Promise.all((Object.keys(spriteLayouts) as SpriteKey[]).map(async (key) => (
        [key, await loadImage(spriteLayouts[key].source)] as const
      ))),
      Promise.all((Object.keys(obstacleLayouts) as FredRunObstacleKind[]).map(async (key) => (
        [key, await loadImage(obstacleLayouts[key].source)] as const
      ))),
      loadImage(COIN_SOURCE),
      loadImage(INTRO_SOURCE),
      loadBackgrounds(),
    ])
      .then(([spriteEntries, obstacleEntries, coin, , backgrounds]) => {
        if (cancelled) return;
        imagesRef.current = {
          sprites: Object.fromEntries(spriteEntries) as SpriteImages,
          obstacles: Object.fromEntries(obstacleEntries) as ObstacleImages,
          coin,
          backgrounds,
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
        const previousState = gameRef.current;
        const previousPhase = previousState.phase;
        const previousPulse = Math.floor(previousState.score / FREDRUN_SCORE_PULSE_POINTS);
        const nextPulse = Math.floor(state.score / FREDRUN_SCORE_PULSE_POINTS);
        if (state.phase === "running" && nextPulse > previousPulse) {
          setScorePulseToken(nextPulse);
        }
        if (state.coinsCollected > previousState.coinsCollected) {
          setCoinPulseToken(state.coinsCollected);
        }
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
      if (
        event.target instanceof HTMLElement
        && event.target.closest("input, textarea, button, [contenteditable='true']")
      ) {
        return;
      }
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

  async function submitScore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = normalizeFredRunPlayerName(playerName);
    const runId = currentRunId;
    if (!normalizedName) {
      setScoreSubmissionError(`Bitte einen Namen mit höchstens ${FREDRUN_PLAYER_NAME_MAX_LENGTH} Zeichen eingeben.`);
      return;
    }
    if (!accessToken || !runId || snapshot.phase !== "game-over" || submittedRunId === runId) return;

    const controller = new AbortController();
    scoreSubmissionAbortRef.current?.abort();
    scoreSubmissionAbortRef.current = controller;
    setIsSubmittingScore(true);
    setScoreSubmissionMessage("");
    setScoreSubmissionError("");
    try {
      const response = await fetch("/api/fredrun/highscores", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ runId, name: normalizedName, score: snapshot.score }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as unknown;
      if (!response.ok) {
        throw new Error(highscoreResponseError(payload, "Der Score konnte nicht eingereicht werden."));
      }
      const parsed = parseFredRunHighscoresResponse(payload);
      if (!parsed) throw new Error("Die Topliste lieferte ein ungültiges Antwortformat.");
      setLeaderboard(parsed.entries);
      setLeaderboardState("ready");
      setLeaderboardError("");
      setPlayerName(parsed.playerName || normalizedName);
      setSubmittedRunId(runId);
      setScoreSubmissionMessage(
        parsed.submitted === false ? "Dieser Score wurde bereits eingereicht." : "Score eingereicht.",
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      setScoreSubmissionError(error instanceof Error ? error.message : "Der Score konnte nicht eingereicht werden.");
    } finally {
      if (scoreSubmissionAbortRef.current === controller) scoreSubmissionAbortRef.current = null;
      if (!controller.signal.aborted) setIsSubmittingScore(false);
    }
  }

  const isPaused = snapshot.phase === "paused";
  const showPauseButton = snapshot.phase === "running" || isPaused;
  const showIntro = assetState !== "error" && snapshot.phase === "ready";
  const normalizedPlayerName = normalizeFredRunPlayerName(playerName);
  const scoreWasSubmitted = Boolean(currentRunId && submittedRunId === currentRunId);

  return (
    <section className="forms-panel fredrun-panel" aria-labelledby="fredrun-view-title">
      <div className="forms-view fredrun-view">
        {standalone ? null : (
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
        )}

        <div className={`fredrun-game-shell${showIntro ? " fredrun-game-shell--intro" : ""}`}>
          {!showIntro ? (
            <div className="fredrun-hud" aria-label="Spielstand">
              <div>
                <span>Punkte</span>
                <strong
                  key={scorePulseToken}
                  className={scorePulseToken > 0 ? "fredrun-score--pulse" : undefined}
                >
                  {snapshot.score}
                </strong>
              </div>
              <div><span>Bestwert</span><strong>{bestScore}</strong></div>
              <div className="fredrun-coin-hud">
                <span>Münzen</span>
                <strong
                  key={coinPulseToken}
                  className={coinPulseToken > 0 ? "fredrun-coin--pulse" : undefined}
                >
                  <FredRunCoinIcon className="fredrun-coin-icon--hud" />
                  {snapshot.coinsCollected}
                </strong>
              </div>
              {showPauseButton ? (
                <button type="button" onClick={togglePause}>{isPaused ? "Weiter" : "Pause"}</button>
              ) : null}
            </div>
          ) : null}

          <div className={`fredrun-stage${showIntro ? " fredrun-stage--intro" : ""}${snapshot.phase === "game-over" ? " fredrun-stage--game-over fredrun-stage--hit" : ""}`}>
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
            {snapshot.phase === "paused" ? (
              <div className="fredrun-overlay">
                <p className="fredrun-overlay-kicker">Kurze Pause</p>
                <h2>Fred wartet auf dich</h2>
                <button className="primary-button" type="button" onClick={togglePause}>Weiterspielen</button>
              </div>
            ) : null}
            {snapshot.phase === "countdown" ? (
              <div className="fredrun-overlay fredrun-countdown-overlay" role="status" aria-live="assertive">
                <p className="fredrun-overlay-kicker">Weiter in</p>
                <strong key={snapshot.countdown}>{snapshot.countdown}</strong>
                <small>Bereit zum Springen?</small>
              </div>
            ) : null}
            {snapshot.phase === "game-over" ? (
              <div className="fredrun-overlay fredrun-game-over-overlay">
                <div className="fredrun-game-over-summary">
                  <p className="fredrun-overlay-kicker">Runde beendet</p>
                  <h2>{snapshot.score} Punkte</h2>
                  <p>Bestwert: {bestScore}</p>
                  <p className="fredrun-game-over-coins">
                    <FredRunCoinIcon className="fredrun-coin-icon--summary" />
                    <span>{snapshot.coinsCollected} Münzen · +{snapshot.coinsCollected * FREDRUN_COIN_SCORE} Punkte</span>
                  </p>
                  <button className="primary-button" type="button" onClick={restartRound}>Noch einmal</button>
                </div>
                <FredRunVictoryDance />
                <form className="fredrun-score-form" onSubmit={(event) => void submitScore(event)}>
                  <label htmlFor="fredrun-player-name">
                    Name für die Topliste
                    <span>{Array.from(playerName).length}/{FREDRUN_PLAYER_NAME_MAX_LENGTH}</span>
                  </label>
                  <div className="fredrun-score-form-row">
                    <input
                      id="fredrun-player-name"
                      type="text"
                      value={playerName}
                      maxLength={FREDRUN_PLAYER_NAME_MAX_LENGTH}
                      autoComplete="nickname"
                      spellCheck={false}
                      disabled={isSubmittingScore || scoreWasSubmitted}
                      onChange={(event) => {
                        setPlayerName(event.target.value);
                        setScoreSubmissionError("");
                      }}
                      placeholder="Dein Name"
                    />
                    <button
                      className="primary-button"
                      type="submit"
                      disabled={!accessToken || !normalizedPlayerName || isSubmittingScore || scoreWasSubmitted}
                    >
                      {isSubmittingScore ? "Wird eingereicht …" : "Score einreichen"}
                    </button>
                  </div>
                  {scoreSubmissionMessage ? (
                    <p className="fredrun-score-feedback fredrun-score-feedback--success" role="status">
                      {scoreSubmissionMessage}
                    </p>
                  ) : null}
                  {scoreSubmissionError ? (
                    <p className="fredrun-score-feedback fredrun-score-feedback--error" role="alert">
                      {scoreSubmissionError}
                    </p>
                  ) : null}
                </form>
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
              <p className="fredrun-endless-note">Das Tempo steigt kontinuierlich – wie weit kommst du?</p>
            </>
          ) : null}
        </div>

        {standalone ? null : (
          <section className="fredrun-leaderboard" aria-labelledby="fredrun-leaderboard-title">
          <div className="fredrun-leaderboard-header">
            <div>
              <p className="eyebrow">Beste Runden</p>
              <h2 id="fredrun-leaderboard-title">Top 10</h2>
            </div>
            <span>Global</span>
          </div>

          {leaderboardState === "loading" ? (
            <p className="fredrun-leaderboard-state" role="status">Topliste wird geladen …</p>
          ) : leaderboardState === "error" ? (
            <div className="fredrun-leaderboard-state" role="alert">
              <p>{leaderboardError}</p>
              <button
                className="secondary-button compact-button"
                type="button"
                onClick={() => {
                  setLeaderboardState("loading");
                  setLeaderboardError("");
                  setLeaderboardAttempt((attempt) => attempt + 1);
                }}
              >
                Erneut versuchen
              </button>
            </div>
          ) : leaderboard.length === 0 ? (
            <p className="fredrun-leaderboard-state">Noch kein Score eingereicht – hol dir Platz 1.</p>
          ) : (
            <ol className="fredrun-leaderboard-list">
              {leaderboard.map((entry) => (
                <li
                  className={`fredrun-leaderboard-entry${entry.rank <= 3 ? ` fredrun-leaderboard-entry--rank-${entry.rank}` : ""}`}
                  key={`${entry.rank}-${entry.name}-${entry.score}`}
                >
                  <span className="fredrun-leaderboard-rank" aria-label={`Platz ${entry.rank}`}>{entry.rank}</span>
                  <strong>{entry.name}</strong>
                  <span>{entry.score.toLocaleString("de-AT")} Punkte</span>
                </li>
              ))}
            </ol>
          )}
          </section>
        )}
      </div>
    </section>
  );
}
