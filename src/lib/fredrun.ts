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
export const FREDRUN_SLOW_MOTION_SECONDS = 5;
export const FREDRUN_SLOW_MOTION_MULTIPLIER = 0.68;
export const FREDRUN_COLLECTIBLE_SPAWN_CLEARANCE = 18;

const BASE_SPEED = 300;
const SPEED_INCREASE_PER_SCORE_STEP = 120;
const BACKGROUND_CROSSFADE_FRACTION = 40 / FREDRUN_BACKGROUND_SCORE_STEP;
const GRAVITY = 1600;
const JUMP_VELOCITY = 660;
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
export type FredRunPowerUpKind = "magnet" | "shield" | "slow-motion";

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
  slowMotionRemaining: number;
  shieldActive: boolean;
  shieldImpactRemaining: number;
  powerUpFeedbackRemaining: number;
  lastPowerUpKind: FredRunPowerUpKind | null;
  obstacles: FredRunObstacle[];
  coins: FredRunCoin[];
  powerUps: FredRunPowerUp[];
};

export type FredRunStorage = Pick<Storage, "getItem" | "setItem">;

export function createFredRunState(): FredRunState {
  return {
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
    slowMotionRemaining: 0,
    shieldActive: false,
    shieldImpactRemaining: 0,
    powerUpFeedbackRemaining: 0,
    lastPowerUpKind: null,
    obstacles: [],
    coins: [],
    powerUps: [],
  };
}

export function startFredRun(state: FredRunState): FredRunState {
  if (state.phase !== "ready") {
    return state;
  }
  return { ...state, phase: "running" };
}

export function restartFredRun(): FredRunState {
  return createFredRunState();
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

function nextGap(speed: number, random: () => number): number {
  const safeMinimum = Math.max(470, speed * 1.2);
  return safeMinimum + Math.min(1, Math.max(0, random())) * 190;
}

function nextCoinGap(speed: number, random: () => number): number {
  const safeMinimum = Math.max(520, speed * 1.35);
  return safeMinimum + Math.min(1, Math.max(0, random())) * 360;
}

function nextPowerUpGap(speed: number, random: () => number): number {
  const safeMinimum = Math.max(3_600, speed * 10);
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

function powerUpFor(random: () => number, id: number): FredRunPowerUp {
  const roll = Math.min(0.999999, Math.max(0, random()));
  const kind: FredRunPowerUpKind = roll < 1 / 3
    ? "magnet"
    : roll < 2 / 3 ? "shield" : "slow-motion";
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

export function advanceFredRun(
  state: FredRunState,
  deltaSeconds: number,
  random: () => number = Math.random,
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

  let playerHeight = state.playerHeight;
  let playerVelocity = state.playerVelocity;
  let jumpElapsed = state.jumpElapsed;
  let jumpBufferRemaining = Math.max(0, state.jumpBufferRemaining - delta);
  let grounded = state.grounded;
  if (!grounded) {
    jumpElapsed += delta;
    playerHeight += playerVelocity * delta;
    playerVelocity -= GRAVITY * delta;
    if (playerHeight <= 0) {
      playerHeight = 0;
      playerVelocity = 0;
      grounded = true;
    }
  }
  if (grounded && jumpBufferRemaining > 0) {
    grounded = false;
    playerVelocity = JUMP_VELOCITY;
    jumpElapsed = 0;
    jumpBufferRemaining = 0;
  }

  let comboRemaining = Math.max(0, state.comboRemaining - delta);
  let comboMultiplier = comboRemaining > 0 ? state.comboMultiplier : 0;
  let nearMissFeedbackRemaining = Math.max(0, state.nearMissFeedbackRemaining - delta);
  let magnetRemaining = Math.max(0, state.magnetRemaining - delta);
  let slowMotionRemaining = Math.max(0, state.slowMotionRemaining - delta);
  let shieldActive = state.shieldActive;
  let shieldImpactRemaining = Math.max(0, state.shieldImpactRemaining - delta);
  let powerUpFeedbackRemaining = Math.max(0, state.powerUpFeedbackRemaining - delta);
  let lastPowerUpKind = state.lastPowerUpKind;

  const baseCurrentSpeed = fredRunSpeedForDistance(state.distance);
  const currentSpeed = baseCurrentSpeed
    * (slowMotionRemaining > 0 ? FREDRUN_SLOW_MOTION_MULTIPLIER : 1);
  const distance = state.distance + currentSpeed * delta;
  const baseNextSpeed = fredRunSpeedForDistance(distance);
  let spawnDistance = state.spawnDistance - currentSpeed * delta;
  let coinSpawnDistance = state.coinSpawnDistance - currentSpeed * delta;
  let powerUpSpawnDistance = state.powerUpSpawnDistance - currentSpeed * delta;
  let nextObstacleId = state.nextObstacleId;
  let nextCoinId = state.nextCoinId;
  let nextPowerUpId = state.nextPowerUpId;
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

  if (spawnDistance <= 0) {
    const obstacle = obstacleFor(random, nextObstacleId);
    obstacles.push(obstacle);
    collisionObstacles.push(obstacle);
    nextObstacleId += 1;
    spawnDistance = nextGap(baseNextSpeed, random);
  }

  if (coinSpawnDistance <= 0) {
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

  if (powerUpSpawnDistance <= 0) {
    const powerUp = powerUpFor(random, nextPowerUpId);
    if (collectibleSpawnIsClear(powerUp, coins)) {
      powerUps.push(powerUp);
      collisionPowerUps.push(powerUp);
      nextPowerUpId += 1;
      powerUpSpawnDistance = nextPowerUpGap(baseNextSpeed, random);
    } else {
      powerUpSpawnDistance = 0;
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
    if (powerUp.kind === "shield") shieldActive = true;
    if (powerUp.kind === "slow-motion") slowMotionRemaining = FREDRUN_SLOW_MOTION_SECONDS;
  }
  if (collectedPowerUpIds.size > 0) {
    powerUps = powerUps.filter((powerUp) => !collectedPowerUpIds.has(powerUp.id));
  }

  const collisionIds = collidingObstacleIds(
    { ...state, playerHeight, obstacles: collisionObstacles },
    previousObstaclePositions,
  );
  let fatalCollision = collisionIds.size > 0;
  if (fatalCollision && shieldActive) {
    shieldActive = false;
    shieldImpactRemaining = 0.5;
    obstacles = obstacles.filter((obstacle) => !collisionIds.has(obstacle.id));
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
  const speed = baseNextSpeed
    * (slowMotionRemaining > 0 ? FREDRUN_SLOW_MOTION_MULTIPLIER : 1);

  const advanced: FredRunState = {
    ...state,
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
    coinsCollected,
    powerUpsCollected,
    nearMisses,
    nearMissScore,
    comboMultiplier,
    comboRemaining,
    nearMissFeedbackRemaining,
    lastNearMissBonus,
    magnetRemaining,
    slowMotionRemaining,
    shieldActive,
    shieldImpactRemaining,
    powerUpFeedbackRemaining,
    lastPowerUpKind,
    obstacles,
    coins,
    powerUps,
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
