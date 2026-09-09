import {
  type FredRunWorldId,
} from "./fredrun-worlds";
import { advanceRockfall, rockfallBlocksSpawns, rockfallHitsPlayer, ROCKFALL_PATTERNS, type FredRunRockfall } from "./fredrun-rockfall";

export const FREDRUN_WORLD_WIDTH = 960;
export const FREDRUN_WORLD_HEIGHT = 360;
export const FREDRUN_GROUND_Y = 300;
export const FREDRUN_PLAYER_X = 132;
export const FREDRUN_SCORE_PULSE_POINTS = 250;
export const FREDRUN_BACKGROUND_SCORE_STEP = 500;
export const FREDRUN_HIGH_SCORE_KEY = "findog.fredrun.highscore.v2";
export const FREDRUN_COIN_SCORE = 25;
export const FREDRUN_JUMP_BUFFER_SECONDS = 0.12;
export const FREDRUN_RESUME_COUNTDOWN_SECONDS = 3;
export const FREDRUN_NEAR_MISS_BASE_SCORE = 25;
export const FREDRUN_NEAR_MISS_COMBO_SECONDS = 3;
export const FREDRUN_MAX_COMBO_MULTIPLIER = 5;
export const FREDRUN_MAGNET_SECONDS = 8;
export const FREDRUN_COLLECTIBLE_SPAWN_CLEARANCE = 18;

// Jump physics constants
export const FREDRUN_GRAVITY = 1600;
export const FREDRUN_JUMP_VELOCITY = 660;
export const FREDRUN_JUMP_AIR_TIME = 2 * FREDRUN_JUMP_VELOCITY / FREDRUN_GRAVITY; // 0.825 s
export const FREDRUN_JUMP_APEX_HEIGHT = (FREDRUN_JUMP_VELOCITY * FREDRUN_JUMP_VELOCITY) / (2 * FREDRUN_GRAVITY); // 136.125 px

// Alps platform & chasm constants
export const FREDRUN_ALPS_PLATFORM_Y = 230; // 70px above ground Y (300)
export const FREDRUN_ALPS_PLATFORM_ELEVATION = FREDRUN_GROUND_Y - FREDRUN_ALPS_PLATFORM_Y; // 70 px
export const FREDRUN_ALPS_CRUMBLE_DURATION = 0.70; // seconds before crumbling platform collapses
export const FREDRUN_ALPS_FATAL_FALL_DEPTH = -45; // playerHeight threshold below ground for chasm fall

// Finanzamt stamp constants
export const FREDRUN_STAMP_WIDTH = 54;
export const FREDRUN_STAMP_HEIGHT = 64;
export const FREDRUN_STAMP_HEAD_REST_Y = 46;
export const FREDRUN_STAMP_HEAD_IMPACT_Y = FREDRUN_GROUND_Y - FREDRUN_STAMP_HEIGHT; // 236 px

const BASE_SPEED = 300;
const SPEED_INCREASE_PER_SCORE_STEP = 120;
const BACKGROUND_CROSSFADE_FRACTION = 40 / FREDRUN_BACKGROUND_SCORE_STEP;
const GRAVITY = FREDRUN_GRAVITY;
const JUMP_VELOCITY = FREDRUN_JUMP_VELOCITY;
const SCORE_DISTANCE = 34;
const INITIAL_SPAWN_DISTANCE = 650;
const INITIAL_COIN_SPAWN_DISTANCE = 420;
const INITIAL_POWER_UP_SPAWN_DISTANCE = 1_200;
const NEAR_MISS_CLEARANCE = 28;
const MAGNET_RADIUS = 280;
const ODO_SPAWN_RATE = 0.125;
const MADINGER_SPAWN_RATE = 0.125;
const JQA_SPAWN_RATE = 0.125;
const LUKI_SPAWN_RATE = 0.125;
const ODO_SPEED_MULTIPLIER = 1.18;
const MADINGER_SPEED_MULTIPLIER = 1.12;
const LUKI_SPEED_MULTIPLIER = 1.15;

export type FredRunPhase = "ready" | "running" | "paused" | "countdown" | "game-over";
export type FredRunObstacleKind = "odo" | "madinger" | "jqa" | "luki" | "reihe100" | "steuerkodex" | "paragraph";
export type FredRunPowerUpKind = "magnet" | "shield";

export type FredRunObstacle = {
  id: number;
  kind: FredRunObstacleKind;
  x: number;
  width: number;
  height: number;
  nearMissChecked?: boolean;
};

export type FredRunCoin = {
  id: number;
  x: number;
  y: number;
  radius: number;
};

export type FredRunPowerUp = {
  id: number;
  kind: FredRunPowerUpKind;
  x: number;
  y: number;
  radius: number;
};

// Vienna lightning strikes ahead, leaving a jumpable ground discharge.
export const FREDRUN_LIGHTNING_WARNING_SECONDS = 0.3;
export const FREDRUN_LIGHTNING_ACTIVE_SECONDS = 0.85;
export const FREDRUN_LIGHTNING_WIDTH = 48;
export const FREDRUN_LIGHTNING_HEIGHT = 22;
const LIGHTNING_APPROACH_SECONDS = 0.6;
const LIGHTNING_CLEAR_SECONDS = 1.35;
const LIGHTNING_MAX_SPEED = 950;

export type FredRunLightning = {
  id: number;
  x: number;
  age: number;
  absorbed: boolean;
};

// --- Finanzamt-night Stamp Hazards ---
export type FredRunStampPhase =
  | "anticipation"
  | "descending"
  | "impact"
  | "recovering"
  | "dormant";

export type FredRunStampHazard = {
  id: number;
  x: number;
  width: number;
  height: number;
  phase: FredRunStampPhase;
  timer: number;
  y: number;
  anticipationDuration: number;
  descendDuration: number;
  impactDuration: number;
  recoverDuration: number;
  behavior: "strike" | "pass-under";
  stampText?: string;
  colliderDisabled?: boolean;
};

// --- Alps Platforms & Chasms ---
export type FredRunPlatformType = "stable" | "crumbling";
export type FredRunPlatformState = "intact" | "crumbling" | "collapsed";

export type FredRunPlatform = {
  id: number;
  x: number;
  width: number;
  y: number;
  height: number;
  type: FredRunPlatformType;
  state: FredRunPlatformState;
  crumbleTimer: number;
  crumbleDuration: number;
  playerLanded: boolean;
};

export type FredRunChasm = {
  id: number;
  x: number;
  width: number;
};

const FREDRUN_ODO_SPEC = { kind: "odo", width: 38, height: 78 } as const;
const FREDRUN_MADINGER_SPEC = { kind: "madinger", width: 42, height: 82 } as const;
const FREDRUN_JQA_SPEC = { kind: "jqa", width: 42, height: 84 } as const;
const FREDRUN_LUKI_SPEC = { kind: "luki", width: 46, height: 84 } as const;
const FREDRUN_STATIC_OBSTACLE_SPECS = [
  { kind: "reihe100", width: 56, height: 60 },
  { kind: "steuerkodex", width: 45, height: 70 },
  { kind: "paragraph", width: 42, height: 68 },
] as const satisfies readonly Omit<FredRunObstacle, "id" | "x">[];

export type FredRunState = {
  worldId: FredRunWorldId;
  phase: FredRunPhase;
  elapsed: number;
  distance: number;
  score: number;
  speed: number;
  countdownRemaining: number;
  spawnDistance: number;
  coinSpawnDistance: number;
  powerUpSpawnDistance: number;
  nextObstacleId: number;
  nextCoinId: number;
  nextPowerUpId: number;
  playerHeight: number;
  playerVelocity: number;
  jumpElapsed: number;
  jumpBufferRemaining: number;
  grounded: boolean;
  coinsCollected: number;
  powerUpsCollected: number;
  nearMisses: number;
  nearMissScore: number;
  comboMultiplier: number;
  comboRemaining: number;
  nearMissFeedbackRemaining: number;
  lastNearMissBonus: number;
  magnetRemaining: number;
  shieldActive: boolean;
  shieldRemaining: number;
  shieldImpactRemaining: number;
  powerUpFeedbackRemaining: number;
  lastPowerUpKind: FredRunPowerUpKind | null;
  obstacles: FredRunObstacle[];
  coins: FredRunCoin[];
  powerUps: FredRunPowerUp[];
  // World challenge mechanics
  lightning: FredRunLightning[];
  lightningWait: number | null;
  nextLightningId: number;
  stamps: FredRunStampHazard[];
  platforms: FredRunPlatform[];
  chasms: FredRunChasm[];
  nextStampId: number;
  nextPlatformId: number;
  nextChasmId: number;
  fallingThroughChasm?: boolean;
  rockfall: FredRunRockfall | null;
};

export type FredRunStorage = Pick<Storage, "getItem" | "setItem">;

export function createFredRunState(worldId: FredRunWorldId = "vienna"): FredRunState {
  return {
    worldId,
    phase: "ready",
    elapsed: 0,
    distance: 0,
    score: 0,
    speed: BASE_SPEED,
    countdownRemaining: 0,
    spawnDistance: INITIAL_SPAWN_DISTANCE,
    coinSpawnDistance: INITIAL_COIN_SPAWN_DISTANCE,
    powerUpSpawnDistance: INITIAL_POWER_UP_SPAWN_DISTANCE,
    nextObstacleId: 1,
    nextCoinId: 1,
    nextPowerUpId: 1,
    playerHeight: 0,
    playerVelocity: 0,
    jumpElapsed: 0,
    jumpBufferRemaining: 0,
    grounded: true,
    coinsCollected: 0,
    powerUpsCollected: 0,
    nearMisses: 0,
    nearMissScore: 0,
    comboMultiplier: 0,
    comboRemaining: 0,
    nearMissFeedbackRemaining: 0,
    lastNearMissBonus: 0,
    magnetRemaining: 0,
    shieldActive: false,
    shieldRemaining: 0,
    shieldImpactRemaining: 0,
    powerUpFeedbackRemaining: 0,
    lastPowerUpKind: null,
    obstacles: [],
    coins: [],
    powerUps: [],
    lightning: [],
    lightningWait: null,
    nextLightningId: 1,
    stamps: [],
    platforms: [],
    chasms: [],
    nextStampId: 1,
    nextPlatformId: 1,
    nextChasmId: 1,
    fallingThroughChasm: false,
    rockfall: null,
  };
}

export function startFredRun(state: FredRunState): FredRunState {
  if (state.phase !== "ready") {
    return state;
  }
  return { ...state, phase: "running" };
}

export function restartFredRun(worldId: FredRunWorldId = "vienna"): FredRunState {
  return createFredRunState(worldId);
}

export function jumpFredRun(state: FredRunState): FredRunState {
  if (state.phase !== "running") {
    return state;
  }
  if (!state.grounded) {
    return { ...state, jumpBufferRemaining: FREDRUN_JUMP_BUFFER_SECONDS };
  }
  return {
    ...state,
    grounded: false,
    playerVelocity: JUMP_VELOCITY,
    jumpElapsed: 0,
    jumpBufferRemaining: 0,
  };
}

export function pauseFredRun(state: FredRunState): FredRunState {
  if (state.phase !== "running" && state.phase !== "countdown") {
    return state;
  }
  return { ...state, phase: "paused", countdownRemaining: 0 };
}

export function resumeFredRun(state: FredRunState): FredRunState {
  if (state.phase !== "paused") {
    return state;
  }
  return {
    ...state,
    phase: "countdown",
    countdownRemaining: FREDRUN_RESUME_COUNTDOWN_SECONDS,
  };
}

function normalizedPositive(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function smoothstep(value: number): number {
  const normalized = Math.min(1, Math.max(0, value));
  return normalized * normalized * (3 - 2 * normalized);
}

function ramp(value: number, start: number, end: number): number {
  if (end <= start) return value >= end ? 1 : 0;
  return smoothstep((value - start) / (end - start));
}

export function fredRunContinuousScoreForDistance(distance: number): number {
  return normalizedPositive(distance) / SCORE_DISTANCE;
}

export function fredRunSpeedForScore(score: number): number {
  return BASE_SPEED
    + normalizedPositive(score) / FREDRUN_SCORE_PULSE_POINTS * SPEED_INCREASE_PER_SCORE_STEP;
}

export function fredRunSpeedForDistance(distance: number): number {
  return fredRunSpeedForScore(fredRunContinuousScoreForDistance(distance));
}

export function fredRunReactionTimeFactorForScore(score: number): number {
  const normalized = normalizedPositive(score);
  if (normalized <= 3_000) {
    return 1.2;
  }
  const excess = (normalized - 3_000) / 1_000;
  return 0.55 + 0.65 / (1 + 0.1 * excess);
}

export function fredRunShieldDurationForScore(score: number): number {
  const normalized = normalizedPositive(score);
  if (normalized <= 3_000) {
    return 0;
  }
  const excess = (normalized - 3_000) / 1_000;
  return 4.0 + 16.0 / (1 + 0.12 * excess);
}

export function fredRunShieldSpawnRateForScore(score: number): number {
  const normalized = normalizedPositive(score);
  if (normalized <= 3_000) {
    return 0.5;
  }
  const excess = (normalized - 3_000) / 1_000;
  return 0.15 + 0.35 / (1 + 0.12 * excess);
}

export function fredRunPowerUpDistanceMultiplierForScore(score: number): number {
  const normalized = normalizedPositive(score);
  if (normalized <= 3_000) {
    return 10;
  }
  const excess = (normalized - 3_000) / 1_000;
  return 10 + 0.45 * excess;
}

export type FredRunEnvironment = {
  fromStage: number;
  toStage: number;
  blend: number;
  progress: number;
  darkness: number;
  storm: number;
  rain: number;
  smoke: number;
  embers: number;
  ash: number;
};

export function fredRunEnvironmentForDistance(distance: number): FredRunEnvironment {
  const score = fredRunContinuousScoreForDistance(distance);
  const progress = Math.min(7, score / FREDRUN_BACKGROUND_SCORE_STEP);
  const fromStage = Math.floor(progress);
  const toStage = Math.min(7, fromStage + 1);
  const segmentProgress = progress - fromStage;
  const crossfadeStart = 1 - BACKGROUND_CROSSFADE_FRACTION;
  const blend = fromStage === toStage
    ? 0
    : smoothstep((segmentProgress - crossfadeStart) / BACKGROUND_CROSSFADE_FRACTION);
  const darkness = Math.min(0.125, Number((progress * 0.025).toFixed(4)));
  const storm = ramp(progress, 0.1, 1.1) * (1 - ramp(progress, 4.8, 6.4));
  const rain = ramp(progress, 0.35, 1.35) * (1 - ramp(progress, 4.6, 6.2));
  const smoke = ramp(progress, 1, 3) * (1 - 0.45 * ramp(progress, 6, 7));
  const embers = ramp(progress, 3.2, 4.8) * (1 - 0.75 * ramp(progress, 6, 7));
  const ash = ramp(progress, 5.2, 7);
  return { fromStage, toStage, blend, progress, darkness, storm, rain, smoke, embers, ash };
}

function obstacleFor(random: () => number, id: number): FredRunObstacle {
  const roll = Math.min(0.999999, Math.max(0, random()));
  if (roll < ODO_SPAWN_RATE) {
    return { id, ...FREDRUN_ODO_SPEC, x: FREDRUN_WORLD_WIDTH + 40 };
  }
  if (roll < ODO_SPAWN_RATE + MADINGER_SPAWN_RATE) {
    return { id, ...FREDRUN_MADINGER_SPEC, x: FREDRUN_WORLD_WIDTH + 40 };
  }
  if (roll < ODO_SPAWN_RATE + MADINGER_SPAWN_RATE + JQA_SPAWN_RATE) {
    return { id, ...FREDRUN_JQA_SPEC, x: FREDRUN_WORLD_WIDTH + 40 };
  }
  if (roll < ODO_SPAWN_RATE + MADINGER_SPAWN_RATE + JQA_SPAWN_RATE + LUKI_SPAWN_RATE) {
    return { id, ...FREDRUN_LUKI_SPEC, x: FREDRUN_WORLD_WIDTH + 40 };
  }
  const animatedSpawnRate = ODO_SPAWN_RATE + MADINGER_SPAWN_RATE + JQA_SPAWN_RATE
    + LUKI_SPAWN_RATE;
  const regularRoll = (roll - animatedSpawnRate) / (1 - animatedSpawnRate);
  const regularIndex = Math.min(
    FREDRUN_STATIC_OBSTACLE_SPECS.length - 1,
    Math.floor(regularRoll * FREDRUN_STATIC_OBSTACLE_SPECS.length),
  );
  const spec = FREDRUN_STATIC_OBSTACLE_SPECS[regularIndex];
  return { id, ...spec, x: FREDRUN_WORLD_WIDTH + 40 };
}

function nextGap(speed: number, score: number, random: () => number): number {
  const timeFactor = fredRunReactionTimeFactorForScore(score);
  const baseFloor = 470 * (timeFactor / 1.2);
  const safeMinimum = Math.max(baseFloor, speed * timeFactor);
  const variance = 190 * (timeFactor / 1.2);
  return safeMinimum + Math.min(1, Math.max(0, random())) * variance;
}

function nextCoinGap(speed: number, random: () => number): number {
  const safeMinimum = Math.max(520, speed * 1.35);
  return safeMinimum + Math.min(1, Math.max(0, random())) * 360;
}

function nextPowerUpGap(speed: number, score: number, random: () => number): number {
  const multiplier = fredRunPowerUpDistanceMultiplierForScore(score);
  const safeMinimum = Math.max(3_600, speed * multiplier);
  return safeMinimum + Math.min(1, Math.max(0, random())) * 1_800;
}

function coinFormation(random: () => number, firstId: number): FredRunCoin[] {
  const count = 1 + Math.floor(Math.min(0.999999, Math.max(0, random())) * 3);
  const height = 138 + Math.min(1, Math.max(0, random())) * 24;
  return Array.from({ length: count }, (_, index) => ({
    id: firstId + index,
    x: FREDRUN_WORLD_WIDTH + 40 + index * 46,
    y: FREDRUN_GROUND_Y - height - Math.sin(index / Math.max(1, count - 1) * Math.PI) * 18,
    radius: 11,
  }));
}

function powerUpFor(random: () => number, id: number, score: number = 0): FredRunPowerUp {
  const roll = Math.min(0.999999, Math.max(0, random()));
  const shieldThreshold = 1 - fredRunShieldSpawnRateForScore(score);
  const kind: FredRunPowerUpKind = roll < shieldThreshold ? "magnet" : "shield";
  const height = 128 + Math.min(1, Math.max(0, random())) * 24;
  return {
    id,
    kind,
    x: FREDRUN_WORLD_WIDTH + 48,
    y: FREDRUN_GROUND_Y - height,
    radius: 15,
  };
}

function collectibleSpawnIsClear(
  collectible: { x: number; y: number; radius: number },
  others: ReadonlyArray<{ x: number; y: number; radius: number }>,
): boolean {
  return others.every((other) => Math.hypot(
    collectible.x - other.x,
    collectible.y - other.y,
  ) >= collectible.radius + other.radius + FREDRUN_COLLECTIBLE_SPAWN_CLEARANCE);
}

function obstacleSpeedMultiplier(kind: FredRunObstacleKind): number {
  if (kind === "odo") return ODO_SPEED_MULTIPLIER;
  if (kind === "madinger") return MADINGER_SPEED_MULTIPLIER;
  if (kind === "luki") return LUKI_SPEED_MULTIPLIER;
  return 1;
}

function rectanglesOverlap(
  first: { x: number; y: number; width: number; height: number },
  second: { x: number; y: number; width: number; height: number },
): boolean {
  return first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y;
}

function collidingObstacleIds(
  state: FredRunState,
  previousObstaclePositions: ReadonlyMap<number, number> = new Map(),
): Set<number> {
  const player = {
    x: FREDRUN_PLAYER_X - 24,
    y: FREDRUN_GROUND_Y - state.playerHeight - 76,
    width: 48,
    height: 72,
  };
  const ids = new Set<number>();
  for (const obstacle of state.obstacles) {
    const previousX = previousObstaclePositions.get(obstacle.id) ?? obstacle.x;
    const sweptX = Math.min(obstacle.x, previousX) + 4;
    const sweptWidth = Math.abs(previousX - obstacle.x) + obstacle.width - 8;
    if (rectanglesOverlap(player, {
      x: sweptX,
      y: FREDRUN_GROUND_Y - obstacle.height + 3,
      width: sweptWidth,
      height: obstacle.height - 3,
    })) {
      ids.add(obstacle.id);
    }
  }
  return ids;
}

// Match the press silhouette: broad grip, narrow neck, and metal/rubber sole.
// Insets retain the existing four-pixel horizontal collision forgiveness.
export function fredRunStampCollisionBoxes(stamp: Pick<FredRunStampHazard, "x" | "y" | "width" | "height">) {
  return [
    { x: stamp.x - stamp.width / 2 + 4, y: stamp.y + 3, width: stamp.width - 8, height: 15 },
    { x: stamp.x - 9, y: stamp.y + 18, width: 18, height: 14 },
    { x: stamp.x - stamp.width / 2 + 4, y: stamp.y + 32, width: stamp.width - 8, height: stamp.height - 32 },
  ];
}

function collidingStampIds(
  state: FredRunState,
  stamps: FredRunStampHazard[],
  previousStampPositions: ReadonlyMap<number, { x: number; y: number }> = new Map(),
): Set<number> {
  const player = {
    x: FREDRUN_PLAYER_X - 24,
    y: FREDRUN_GROUND_Y - state.playerHeight - 76,
    width: 48,
    height: 72,
  };
  const ids = new Set<number>();
  for (const stamp of stamps) {
    if (stamp.phase === "dormant" || stamp.phase === "recovering" || stamp.colliderDisabled) continue;
    const prev = previousStampPositions.get(stamp.id) ?? { x: stamp.x, y: stamp.y };
    const boxes = fredRunStampCollisionBoxes(stamp);
    const previousBoxes = fredRunStampCollisionBoxes({ ...stamp, ...prev });
    if (boxes.some((box, index) => {
      const previous = previousBoxes[index];
      return rectanglesOverlap(player, {
        x: Math.min(box.x, previous.x),
        y: Math.min(box.y, previous.y),
        width: box.width + Math.abs(box.x - previous.x),
        height: box.height + Math.abs(box.y - previous.y),
      });
    })) ids.add(stamp.id);
  }
  return ids;
}

function collectibleTouchesPlayer(
  collectible: { x: number; y: number; radius: number },
  playerHeight: number,
  previousX: number,
): boolean {
  const player = {
    x: FREDRUN_PLAYER_X - 24,
    y: FREDRUN_GROUND_Y - playerHeight - 76,
    width: 48,
    height: 72,
  };
  const sweptX = Math.min(collectible.x, previousX) - collectible.radius;
  return rectanglesOverlap(player, {
    x: sweptX,
    y: collectible.y - collectible.radius,
    width: Math.abs(previousX - collectible.x) + collectible.radius * 2,
    height: collectible.radius * 2,
  });
}

function lightningHasSafeSpace(
  speed: number,
  grounded: boolean,
  obstacles: FredRunObstacle[],
  spawnDistance: number,
): boolean {
  if (!grounded || speed > LIGHTNING_MAX_SPEED) return false;
  // Speed grows by less than 2% over this horizon. Include that growth and a
  // full 50 ms step; reserve time for a 0.3 s reaction, jump, landing and exit.
  const travel = speed * 1.03 * LIGHTNING_CLEAR_SECONDS;
  const playerRight = FREDRUN_PLAYER_X + 24;
  const playerLeft = FREDRUN_PLAYER_X - 24;
  if (obstacles.some((obstacle) => (
    obstacle.x + obstacle.width >= playerLeft
    && obstacle.x - travel * obstacleSpeedMultiplier(obstacle.kind) <= playerRight
  ))) return false;
  // The next unscheduled obstacle could be Odo. Never move its spawn to make space.
  const futureTravel = Math.max(0, travel - Math.max(0, spawnDistance));
  return FREDRUN_WORLD_WIDTH + 40 - futureTravel * ODO_SPEED_MULTIPLIER > playerRight;
}

export function advanceFredRun(
  state: FredRunState,
  deltaSeconds: number,
  random: () => number = Math.random,
  lightningRandom: () => number = Math.random,
  rockfallRandom: () => number = Math.random,
): FredRunState {
  const delta = Math.min(0.05, Math.max(0, deltaSeconds));
  if (delta === 0) {
    return state;
  }
  if (state.phase === "countdown") {
    const nextCountdown = Math.max(0, state.countdownRemaining - delta);
    const countdownRemaining = nextCountdown < 0.0001 ? 0 : nextCountdown;
    return {
      ...state,
      phase: countdownRemaining === 0 ? "running" : "countdown",
      countdownRemaining,
    };
  }
  if (state.phase !== "running") return state;

  const baseCurrentSpeed = fredRunSpeedForDistance(state.distance);
  const currentSpeed = baseCurrentSpeed;
  const distance = state.distance + currentSpeed * delta;
  const baseNextSpeed = fredRunSpeedForDistance(distance);
  const currentScore = Math.max(
    state.score,
    Math.floor(distance / SCORE_DISTANCE) + state.coinsCollected * FREDRUN_COIN_SCORE + state.nearMissScore,
  );

  let playerHeight = state.playerHeight;
  let playerVelocity = state.playerVelocity;
  let jumpElapsed = state.jumpElapsed;
  let jumpBufferRemaining = Math.max(0, state.jumpBufferRemaining - delta);
  let grounded = state.grounded;
  let fallingThroughChasm = state.fallingThroughChasm ?? false;

  const worldId = state.worldId ?? "vienna";
  const statePlatforms = state.platforms ?? [];
  const stateChasms = state.chasms ?? [];
  const stateStamps = state.stamps ?? [];

  // Move platforms & update crumbling state
  const platforms = statePlatforms.map((platform) => {
    let crumbleTimer = platform.crumbleTimer;
    let platformState = platform.state;
    if (platform.type === "crumbling" && platform.playerLanded) {
      crumbleTimer += delta;
      if (crumbleTimer >= platform.crumbleDuration) {
        platformState = "collapsed";
      }
    }
    return {
      ...platform,
      x: platform.x - currentSpeed * delta,
      crumbleTimer,
      state: platformState,
    };
  }).filter((p) => p.x + p.width > -60);

  // Move chasms
  const chasms = stateChasms.map((chasm) => ({
    ...chasm,
    x: chasm.x - currentSpeed * delta,
  })).filter((c) => c.x + c.width > -60);

  // Update stamps and preserve previous positions for swept collision
  const previousStampPositions = new Map(stateStamps.map((s) => [s.id, { x: s.x, y: s.y }]));
  let stamps = stateStamps.map((stamp) => {
    const nextX = stamp.x - currentSpeed * delta;
    let phase = stamp.phase;
    let timer = stamp.timer + delta;
    let y = stamp.y;

    const distToPlayer = nextX - FREDRUN_PLAYER_X;
    const timeToPlayer = currentSpeed > 0 ? distToPlayer / currentSpeed : 999;

    // Safety rule: Never activate an unavoidable hazard after the player commits to a jump.
    // If the player is airborne (!grounded), do not trigger a downward stroke that would land on the player.
    const playerCommittedAirborne = !grounded;

    if (phase === "anticipation") {
      if (stamp.behavior === "strike") {
        const inStrikeWindow = timeToPlayer <= 0.65 && timeToPlayer >= 0.25;
        const readyToDescend = timer >= stamp.anticipationDuration && inStrikeWindow;
        if (readyToDescend) {
          if (!playerCommittedAirborne) {
            phase = "descending";
            timer = 0;
          }
        }
      } else {
        if (distToPlayer < -stamp.width - 24) {
          phase = "descending";
          timer = 0;
        }
      }
    } else if (phase === "descending") {
      const progress = Math.min(1, timer / stamp.descendDuration);
      y = FREDRUN_STAMP_HEAD_REST_Y + (FREDRUN_STAMP_HEAD_IMPACT_Y - FREDRUN_STAMP_HEAD_REST_Y) * (progress * progress);
      if (progress >= 1) {
        phase = "impact";
        timer = 0;
        y = FREDRUN_STAMP_HEAD_IMPACT_Y;
      }
    } else if (phase === "impact") {
      y = FREDRUN_STAMP_HEAD_IMPACT_Y;
      if (timer >= stamp.impactDuration) {
        phase = "recovering";
        timer = 0;
      }
    } else if (phase === "recovering") {
      const progress = Math.min(1, timer / stamp.recoverDuration);
      y = FREDRUN_STAMP_HEAD_IMPACT_Y - (FREDRUN_STAMP_HEAD_IMPACT_Y - FREDRUN_STAMP_HEAD_REST_Y) * progress;
      if (progress >= 1) {
        phase = "dormant";
        timer = 0;
        y = FREDRUN_STAMP_HEAD_REST_Y;
      }
    } else if (phase === "dormant") {
      y = FREDRUN_STAMP_HEAD_REST_Y;
    }

    return {
      ...stamp,
      x: nextX,
      y,
      phase,
      timer,
    };
  }).filter((s) => s.x + s.width > -50);

  // Platform support check for grounded player
  const playerFootX = FREDRUN_PLAYER_X;
  let supportingPlatform: FredRunPlatform | null = null;
  for (const p of platforms) {
    const elevation = FREDRUN_GROUND_Y - p.y;
    const spansPlayer = playerFootX >= p.x - 12 && playerFootX <= p.x + p.width + 12;
    if (spansPlayer && Math.abs(playerHeight - elevation) <= 4 && p.state !== "collapsed") {
      supportingPlatform = p;
      break;
    }
  }

  const overChasm = chasms.some((c) => playerFootX >= c.x && playerFootX <= c.x + c.width);

  if (grounded) {
    if (playerHeight > 0) {
      if (!supportingPlatform) {
        // Walked off platform edge or platform collapsed under player
        grounded = false;
        playerVelocity = 0;
      } else if (supportingPlatform.type === "crumbling" && !supportingPlatform.playerLanded) {
        supportingPlatform.playerLanded = true;
        supportingPlatform.state = "crumbling";
      }
    } else {
      if (overChasm) {
        // Ground elevation player stepped into chasm: ground is missing!
        grounded = false;
        fallingThroughChasm = true;
        playerVelocity = 0;
      }
    }
  }

  // Airborne physics and collision support
  if (!grounded) {
    jumpElapsed += delta;
    playerHeight += playerVelocity * delta;
    playerVelocity -= GRAVITY * delta;

    // Check landing on elevated platforms while falling down
    if (playerVelocity <= 0) {
      for (const p of platforms) {
        if (p.state === "collapsed") continue;
        const elevation = FREDRUN_GROUND_Y - p.y;
        const spansPlayer = playerFootX >= p.x - 14 && playerFootX <= p.x + p.width + 14;
        if (spansPlayer && state.playerHeight >= elevation - 4 && playerHeight <= elevation) {
          playerHeight = elevation;
          playerVelocity = 0;
          grounded = true;
          if (p.type === "crumbling" && !p.playerLanded) {
            p.playerLanded = true;
            p.state = "crumbling";
          }
          supportingPlatform = p;
          break;
        }
      }
    }

    // Ground collision check
    if (!grounded && playerHeight <= 0) {
      if (fallingThroughChasm || overChasm || state.playerHeight < 0) {
        // Gorge under player: ground cannot catch player, and failed falls cannot teleport onto ground
        grounded = false;
        fallingThroughChasm = true;
      } else {
        playerHeight = 0;
        playerVelocity = 0;
        grounded = true;
        fallingThroughChasm = false;
      }
    }
  }

  if (grounded && jumpBufferRemaining > 0) {
    grounded = false;
    playerVelocity = JUMP_VELOCITY;
    jumpElapsed = 0;
    jumpBufferRemaining = 0;
  }

  // Fatal fall into chasm
  const fatalFall = fallingThroughChasm && playerHeight <= FREDRUN_ALPS_FATAL_FALL_DEPTH;

  let comboRemaining = Math.max(0, state.comboRemaining - delta);
  let comboMultiplier = comboRemaining > 0 ? state.comboMultiplier : 0;
  let nearMissFeedbackRemaining = Math.max(0, state.nearMissFeedbackRemaining - delta);
  let magnetRemaining = Math.max(0, state.magnetRemaining - delta);
  let shieldActive = state.shieldActive;
  let shieldRemaining = state.shieldRemaining;
  let shieldImpactRemaining = Math.max(0, state.shieldImpactRemaining - delta);
  let powerUpFeedbackRemaining = Math.max(0, state.powerUpFeedbackRemaining - delta);
  let lastPowerUpKind = state.lastPowerUpKind;

  if (shieldActive && currentScore > 3_000) {
    if (shieldRemaining <= 0) {
      shieldRemaining = fredRunShieldDurationForScore(currentScore);
    }
    shieldRemaining = Math.max(0, shieldRemaining - delta);
    if (shieldRemaining === 0) {
      shieldActive = false;
    }
  }

  let rockfall = worldId === "alps" ? advanceRockfall(state, delta, rockfallRandom) : null;
  const rockfallOwnsSpawning = rockfallBlocksSpawns(rockfall);
  const spawnTravel = rockfallOwnsSpawning ? 0 : currentSpeed * delta;
  let spawnDistance = state.spawnDistance - spawnTravel;
  let coinSpawnDistance = state.coinSpawnDistance - spawnTravel;
  let powerUpSpawnDistance = state.powerUpSpawnDistance - spawnTravel;
  let nextObstacleId = state.nextObstacleId;
  let nextCoinId = state.nextCoinId;
  let nextPowerUpId = state.nextPowerUpId;
  let nextStampId = state.nextStampId ?? 1;
  let nextPlatformId = state.nextPlatformId ?? 1;
  let nextChasmId = state.nextChasmId ?? 1;

  const previousObstaclePositions = new Map(
    state.obstacles.map((obstacle) => [obstacle.id, obstacle.x]),
  );
  const movedObstacles = state.obstacles.map((obstacle) => ({
    ...obstacle,
    x: obstacle.x - currentSpeed * obstacleSpeedMultiplier(obstacle.kind) * delta,
  }));
  let obstacles = movedObstacles.filter((obstacle) => obstacle.x + obstacle.width > -20);
  const collisionObstacles = [...movedObstacles];

  const previousCoinPositions = new Map(state.coins.map((coin) => [coin.id, coin.x]));
  const playerCenterY = FREDRUN_GROUND_Y - playerHeight - 40;
  const movedCoins = state.coins.map((coin) => {
    const moved = { ...coin, x: coin.x - currentSpeed * delta };
    const distanceToPlayer = Math.hypot(moved.x - FREDRUN_PLAYER_X, moved.y - playerCenterY);
    if (magnetRemaining <= 0 || distanceToPlayer > MAGNET_RADIUS) return moved;
    const pull = Math.min(1, delta * 7);
    return {
      ...moved,
      x: moved.x + (FREDRUN_PLAYER_X - moved.x) * pull,
      y: moved.y + (playerCenterY - moved.y) * pull,
    };
  });
  let coins = movedCoins.filter((coin) => coin.x + coin.radius > -20);
  const collisionCoins = [...movedCoins];

  const previousPowerUpPositions = new Map(state.powerUps.map((powerUp) => [powerUp.id, powerUp.x]));
  const movedPowerUps = state.powerUps.map((powerUp) => ({
    ...powerUp,
    x: powerUp.x - currentSpeed * delta,
  }));
  let powerUps = movedPowerUps.filter((powerUp) => powerUp.x + powerUp.radius > -20);
  const collisionPowerUps = [...movedPowerUps];

  // Challenge and obstacle scheduling
  if (spawnDistance <= 0 && !rockfallOwnsSpawning) {
    if (worldId === "vienna") {
      const obstacle = obstacleFor(random, nextObstacleId);
      obstacles.push(obstacle);
      collisionObstacles.push(obstacle);
      nextObstacleId += 1;
      spawnDistance = nextGap(baseNextSpeed, currentScore, random);
    } else if (worldId === "finanzamt-night") {
      const stampRoll = Math.min(0.999999, Math.max(0, random()));
      if (stampRoll < 0.38) {
        const behavior: "strike" | "pass-under" = random() > 0.45 ? "strike" : "pass-under";
        const stampText = random() > 0.5 ? "GEPRÜFT" : "ABGELEHNT";
        const stamp: FredRunStampHazard = {
          id: nextStampId++,
          x: FREDRUN_WORLD_WIDTH + 50,
          width: FREDRUN_STAMP_WIDTH,
          height: FREDRUN_STAMP_HEIGHT,
          phase: "anticipation",
          timer: 0,
          y: FREDRUN_STAMP_HEAD_REST_Y,
          anticipationDuration: Math.min(0.60, Math.max(0.20, 260 / baseNextSpeed)),
          descendDuration: 0.16,
          impactDuration: 0.55,
          recoverDuration: 0.50,
          behavior,
          stampText,
        };
        stamps.push(stamp);
        spawnDistance = Math.max(520, baseNextSpeed * 1.35);
      } else {
        const obstacle = obstacleFor(random, nextObstacleId++);
        obstacles.push(obstacle);
        collisionObstacles.push(obstacle);
        spawnDistance = nextGap(baseNextSpeed, currentScore, random);
      }
    } else if (worldId === "alps") {
      const alpsRoll = Math.min(0.999999, Math.max(0, random()));
      if (alpsRoll < 0.42) {
        if (currentScore < 400) {
          const platWidth = 240;
          const chasmWidth = 180;
          const platX = FREDRUN_WORLD_WIDTH + 60;
          const chasmX = platX + 30;
          platforms.push({
            id: nextPlatformId++,
            x: platX,
            width: platWidth,
            y: FREDRUN_ALPS_PLATFORM_Y,
            height: 18,
            type: "stable",
            state: "intact",
            crumbleTimer: 0,
            crumbleDuration: FREDRUN_ALPS_CRUMBLE_DURATION,
            playerLanded: false,
          });
          chasms.push({ id: nextChasmId++, x: chasmX, width: chasmWidth });
          spawnDistance = Math.max(560, baseNextSpeed * 1.5);
        } else if (currentScore < 1200) {
          const platWidth = Math.max(340, Math.round(baseNextSpeed * 0.85));
          const chasmWidth = platWidth - 30;
          const platX = FREDRUN_WORLD_WIDTH + 60;
          const chasmX = platX + 10;
          platforms.push({
            id: nextPlatformId++,
            x: platX,
            width: platWidth,
            y: FREDRUN_ALPS_PLATFORM_Y,
            height: 18,
            type: "crumbling",
            state: "intact",
            crumbleTimer: 0,
            crumbleDuration: FREDRUN_ALPS_CRUMBLE_DURATION,
            playerLanded: false,
          });
          chasms.push({ id: nextChasmId++, x: chasmX, width: chasmWidth });
          spawnDistance = Math.max(580, baseNextSpeed * 1.55);
        } else {
          const plat1Width = 170;
          const plat2Width = Math.max(320, Math.round(baseNextSpeed * 0.85));
          const gap = 50;
          const plat1X = FREDRUN_WORLD_WIDTH + 60;
          const plat2X = plat1X + plat1Width + gap;
          const chasmX = plat1X + 20;
          const chasmWidth = (plat2X + plat2Width - 10) - chasmX;
          platforms.push({
            id: nextPlatformId++,
            x: plat1X,
            width: plat1Width,
            y: FREDRUN_ALPS_PLATFORM_Y,
            height: 18,
            type: "stable",
            state: "intact",
            crumbleTimer: 0,
            crumbleDuration: FREDRUN_ALPS_CRUMBLE_DURATION,
            playerLanded: false,
          });
          platforms.push({
            id: nextPlatformId++,
            x: plat2X,
            width: plat2Width,
            y: FREDRUN_ALPS_PLATFORM_Y,
            height: 18,
            type: "crumbling",
            state: "intact",
            crumbleTimer: 0,
            crumbleDuration: FREDRUN_ALPS_CRUMBLE_DURATION,
            playerLanded: false,
          });
          chasms.push({ id: nextChasmId++, x: chasmX, width: chasmWidth });
          spawnDistance = Math.max(650, baseNextSpeed * 1.8);
        }
      } else {
        const obstacle = obstacleFor(random, nextObstacleId++);
        obstacles.push(obstacle);
        collisionObstacles.push(obstacle);
        spawnDistance = nextGap(baseNextSpeed, currentScore, random);
      }
    } else {
      const obstacle = obstacleFor(random, nextObstacleId++);
      obstacles.push(obstacle);
      collisionObstacles.push(obstacle);
      spawnDistance = nextGap(baseNextSpeed, currentScore, random);
    }
  }

  // Collectibles
  if (coinSpawnDistance <= 0 && !rockfallOwnsSpawning) {
    const formation = coinFormation(random, nextCoinId);
    if (formation.every((coin) => collectibleSpawnIsClear(coin, powerUps))) {
      coins.push(...formation);
      collisionCoins.push(...formation);
      nextCoinId += formation.length;
      coinSpawnDistance = nextCoinGap(baseNextSpeed, random);
    } else {
      coinSpawnDistance = 0;
    }
  }

  if (powerUpSpawnDistance <= 0 && !rockfallOwnsSpawning) {
    const powerUp = powerUpFor(random, nextPowerUpId, currentScore);
    if (collectibleSpawnIsClear(powerUp, coins)) {
      powerUps.push(powerUp);
      collisionPowerUps.push(powerUp);
      nextPowerUpId += 1;
      powerUpSpawnDistance = nextPowerUpGap(baseNextSpeed, currentScore, random);
    } else {
      powerUpSpawnDistance = 0;
    }
  }

  // Keep lightning randomness separate from the original obstacle/collectible stream.
  const previousLightning = new Map(state.lightning.map((hazard) => [hazard.id, hazard]));
  let lightning = worldId === "vienna" ? state.lightning.map((hazard) => ({
    ...hazard,
    x: hazard.x - currentSpeed * delta,
    age: hazard.age + delta,
  })) : [];
  let lightningWait = state.lightningWait;
  let nextLightningId = state.nextLightningId;
  if (worldId === "vienna") {
    const roll = () => Math.min(1, Math.max(0, lightningRandom()));
    lightningWait = Math.max(0, (lightningWait ?? (0.1 + roll() * 0.05)) - delta);
    if (lightningWait === 0 && lightning.length === 0
      && state.grounded && lightningHasSafeSpace(baseNextSpeed, grounded, obstacles, spawnDistance)) {
      lightning.push({
        id: nextLightningId++,
        x: FREDRUN_PLAYER_X + 24 + baseNextSpeed * LIGHTNING_APPROACH_SECONDS,
        age: 0,
        absorbed: false,
      });
      lightningWait = 2.5 + roll() * 2;
    }
  }

  const collectedCoinIds = new Set<number>();
  for (const coin of collisionCoins) {
    if (collectibleTouchesPlayer(
      coin,
      playerHeight,
      previousCoinPositions.get(coin.id) ?? coin.x,
    )) {
      collectedCoinIds.add(coin.id);
    }
  }
  if (collectedCoinIds.size > 0) {
    coins = coins.filter((coin) => !collectedCoinIds.has(coin.id));
  }
  const coinsCollected = state.coinsCollected + collectedCoinIds.size;

  const collectedPowerUpIds = new Set<number>();
  let powerUpsCollected = state.powerUpsCollected;
  for (const powerUp of collisionPowerUps) {
    if (!collectibleTouchesPlayer(
      powerUp,
      playerHeight,
      previousPowerUpPositions.get(powerUp.id) ?? powerUp.x,
    )) continue;
    collectedPowerUpIds.add(powerUp.id);
    powerUpsCollected += 1;
    lastPowerUpKind = powerUp.kind;
    powerUpFeedbackRemaining = 1.2;
    if (powerUp.kind === "magnet") magnetRemaining = FREDRUN_MAGNET_SECONDS;
    if (powerUp.kind === "shield") {
      shieldActive = true;
      shieldRemaining = currentScore > 3_000 ? fredRunShieldDurationForScore(currentScore) : 0;
    }
  }
  if (collectedPowerUpIds.size > 0) {
    powerUps = powerUps.filter((powerUp) => !collectedPowerUpIds.has(powerUp.id));
  }

  // Obstacle collision check
  const collisionIds = collidingObstacleIds(
    { ...state, playerHeight, obstacles: collisionObstacles },
    previousObstaclePositions,
  );

  // Stamp collision check
  const stampCollisionIds = collidingStampIds(
    { ...state, playerHeight },
    stamps,
    previousStampPositions,
  );

  const lightningCollisionIds = new Set<number>();
  for (const hazard of lightning) {
    const previous = previousLightning.get(hazard.id);
    if (!previous || hazard.absorbed) continue;
    // Clip the swept segment to active time, including a step crossing expiry.
    const activeStart = Math.max(previous.age, FREDRUN_LIGHTNING_WARNING_SECONDS);
    const activeEnd = Math.min(hazard.age, FREDRUN_LIGHTNING_WARNING_SECONDS + FREDRUN_LIGHTNING_ACTIVE_SECONDS);
    if (activeEnd <= activeStart) continue;
    const startX = previous.x - currentSpeed * (activeStart - previous.age);
    const endX = previous.x - currentSpeed * (activeEnd - previous.age);
    if (rectanglesOverlap({
      x: FREDRUN_PLAYER_X - 24,
      y: FREDRUN_GROUND_Y - playerHeight - 76,
      width: 48,
      height: 72,
    }, {
      x: endX,
      y: FREDRUN_GROUND_Y - FREDRUN_LIGHTNING_HEIGHT,
      width: startX - endX + FREDRUN_LIGHTNING_WIDTH,
      height: FREDRUN_LIGHTNING_HEIGHT,
    })) lightningCollisionIds.add(hazard.id);
  }

  let rockfallCollisionMask = 0;
  if (rockfall?.phase === "action" && state.rockfall?.phase === "action") {
    for (let index = 0; index < ROCKFALL_PATTERNS[rockfall.variant].releases.length; index++) {
      if (rockfallHitsPlayer(rockfall, index, state.rockfall.timer, rockfall.timer, state.playerHeight, playerHeight)) {
        rockfallCollisionMask |= 1 << index;
      }
    }
  }
  let fatalCollision = collisionIds.size > 0 || stampCollisionIds.size > 0 || lightningCollisionIds.size > 0 || rockfallCollisionMask !== 0 || fatalFall;
  if (fatalCollision && shieldActive && !fatalFall) {
    shieldActive = false;
    shieldRemaining = 0;
    shieldImpactRemaining = 0.5;
    if (collisionIds.size > 0) {
      obstacles = obstacles.filter((obstacle) => !collisionIds.has(obstacle.id));
    }
    if (stampCollisionIds.size > 0) {
      stamps = stamps.map((s) => (
        stampCollisionIds.has(s.id) ? { ...s, phase: "recovering", timer: 0, colliderDisabled: true } : s
      ));
    }
    lightning = lightning.map((hazard) => (
      lightningCollisionIds.has(hazard.id) ? { ...hazard, absorbed: true } : hazard
    ));
    if (rockfall && rockfallCollisionMask) rockfall = { ...rockfall, absorbed: rockfall.absorbed | rockfallCollisionMask };
    fatalCollision = false;
  }

  let nearMisses = state.nearMisses;
  let nearMissScore = state.nearMissScore;
  let lastNearMissBonus = state.lastNearMissBonus;
  if (!fatalCollision) {
    const playerLeft = FREDRUN_PLAYER_X - 24;
    obstacles = obstacles.map((obstacle) => {
      if (obstacle.nearMissChecked) return obstacle;
      const previousX = previousObstaclePositions.get(obstacle.id) ?? obstacle.x;
      const crossedPlayer = previousX + obstacle.width >= playerLeft
        && obstacle.x + obstacle.width < playerLeft;
      if (!crossedPlayer) return obstacle;
      const clearance = playerHeight - obstacle.height + 7;
      if (clearance > 0 && clearance <= NEAR_MISS_CLEARANCE) {
        comboMultiplier = Math.min(
          FREDRUN_MAX_COMBO_MULTIPLIER,
          (comboRemaining > 0 ? Math.max(1, comboMultiplier) : 1) + 1,
        );
        comboRemaining = FREDRUN_NEAR_MISS_COMBO_SECONDS;
        lastNearMissBonus = FREDRUN_NEAR_MISS_BASE_SCORE * comboMultiplier;
        nearMissScore += lastNearMissBonus;
        nearMisses += 1;
        nearMissFeedbackRemaining = 1;
      }
      return { ...obstacle, nearMissChecked: true };
    });
  }

  const score = Math.floor(distance / SCORE_DISTANCE)
    + coinsCollected * FREDRUN_COIN_SCORE
    + nearMissScore;
  const speed = baseNextSpeed;

  const advanced: FredRunState = {
    ...state,
    worldId,
    elapsed: state.elapsed + delta,
    distance,
    score,
    speed,
    countdownRemaining: 0,
    playerHeight,
    playerVelocity,
    jumpElapsed,
    jumpBufferRemaining,
    grounded,
    spawnDistance,
    coinSpawnDistance,
    powerUpSpawnDistance,
    nextObstacleId,
    nextCoinId,
    nextPowerUpId,
    nextStampId,
    nextPlatformId,
    nextChasmId,
    coinsCollected,
    powerUpsCollected,
    nearMisses,
    nearMissScore,
    comboMultiplier,
    comboRemaining,
    nearMissFeedbackRemaining,
    lastNearMissBonus,
    magnetRemaining,
    shieldActive,
    shieldRemaining,
    shieldImpactRemaining,
    powerUpFeedbackRemaining,
    lastPowerUpKind,
    obstacles,
    coins,
    powerUps,
    lightning: lightning.filter((hazard) => (
      hazard.age < FREDRUN_LIGHTNING_WARNING_SECONDS + FREDRUN_LIGHTNING_ACTIVE_SECONDS
      && hazard.x + FREDRUN_LIGHTNING_WIDTH > -20
    )),
    lightningWait,
    nextLightningId,
    stamps,
    platforms,
    chasms,
    fallingThroughChasm,
    rockfall,
  };

  if (fatalCollision) {
    return { ...advanced, phase: "game-over" };
  }

  return advanced;
}

export function readFredRunHighScore(storage: FredRunStorage | null | undefined): number {
  if (!storage) {
    return 0;
  }
  try {
    const value = storage.getItem(FREDRUN_HIGH_SCORE_KEY);
    if (!value || !/^\d+$/.test(value)) {
      return 0;
    }
    const score = Number(value);
    return Number.isSafeInteger(score) && score >= 0 ? score : 0;
  } catch {
    return 0;
  }
}

export function writeFredRunHighScore(
  storage: FredRunStorage | null | undefined,
  score: number,
  previousBest: number,
): number {
  const normalizedScore = Number.isSafeInteger(score) && score >= 0 ? score : 0;
  const nextBest = Math.max(previousBest, normalizedScore);
  if (nextBest === previousBest) {
    return previousBest;
  }
  if (storage) {
    try {
      storage.setItem(FREDRUN_HIGH_SCORE_KEY, String(nextBest));
    } catch {
      // The game remains usable when local storage is blocked or full.
    }
  }
  return nextBest;
}
