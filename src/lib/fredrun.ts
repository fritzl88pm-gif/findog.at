export const FREDRUN_WORLD_WIDTH = 960;
export const FREDRUN_WORLD_HEIGHT = 360;
export const FREDRUN_GROUND_Y = 300;
export const FREDRUN_PLAYER_X = 132;
export const FREDRUN_SCORE_PULSE_POINTS = 250;
export const FREDRUN_BACKGROUND_SCORE_STEP = 500;
export const FREDRUN_HIGH_SCORE_KEY = "findog.fredrun.highscore.v2";

const BASE_SPEED = 300;
const SPEED_INCREASE_PER_SCORE_STEP = 120;
const BACKGROUND_CROSSFADE_FRACTION = 40 / FREDRUN_BACKGROUND_SCORE_STEP;
const GRAVITY = 1600;
const JUMP_VELOCITY = 660;
const SCORE_DISTANCE = 34;
const INITIAL_SPAWN_DISTANCE = 650;
const ODO_SPAWN_RATE = 0.125;
const MADINGER_SPAWN_RATE = 0.125;
const JQA_SPAWN_RATE = 0.125;
const ODO_SPEED_MULTIPLIER = 1.18;
const MADINGER_SPEED_MULTIPLIER = 1.12;

export type FredRunPhase = "ready" | "running" | "paused" | "game-over";
export type FredRunObstacleKind = "odo" | "madinger" | "jqa" | "reihe100" | "steuerkodex" | "paragraph";

export type FredRunObstacle = {
  id: number;
  kind: FredRunObstacleKind;
  x: number;
  width: number;
  height: number;
};

const FREDRUN_ODO_SPEC = { kind: "odo", width: 38, height: 78 } as const;
const FREDRUN_MADINGER_SPEC = { kind: "madinger", width: 42, height: 82 } as const;
const FREDRUN_JQA_SPEC = { kind: "jqa", width: 42, height: 84 } as const;
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
  spawnDistance: number;
  nextObstacleId: number;
  playerHeight: number;
  playerVelocity: number;
  jumpElapsed: number;
  grounded: boolean;
  obstacles: FredRunObstacle[];
};

export type FredRunStorage = Pick<Storage, "getItem" | "setItem">;

export function createFredRunState(): FredRunState {
  return {
    phase: "ready",
    elapsed: 0,
    distance: 0,
    score: 0,
    speed: BASE_SPEED,
    spawnDistance: INITIAL_SPAWN_DISTANCE,
    nextObstacleId: 1,
    playerHeight: 0,
    playerVelocity: 0,
    jumpElapsed: 0,
    grounded: true,
    obstacles: [],
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
  if (state.phase !== "running" || !state.grounded) {
    return state;
  }
  return {
    ...state,
    grounded: false,
    playerVelocity: JUMP_VELOCITY,
    jumpElapsed: 0,
  };
}

export function pauseFredRun(state: FredRunState): FredRunState {
  if (state.phase !== "running") {
    return state;
  }
  return { ...state, phase: "paused" };
}

export function resumeFredRun(state: FredRunState): FredRunState {
  if (state.phase !== "paused") {
    return state;
  }
  return { ...state, phase: "running" };
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
  const animatedSpawnRate = ODO_SPAWN_RATE + MADINGER_SPAWN_RATE + JQA_SPAWN_RATE;
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

function obstacleSpeedMultiplier(kind: FredRunObstacleKind): number {
  if (kind === "odo") return ODO_SPEED_MULTIPLIER;
  if (kind === "madinger") return MADINGER_SPEED_MULTIPLIER;
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

function collidesWithPlayer(
  state: FredRunState,
  previousObstaclePositions: ReadonlyMap<number, number> = new Map(),
): boolean {
  const player = {
    x: FREDRUN_PLAYER_X - 24,
    y: FREDRUN_GROUND_Y - state.playerHeight - 76,
    width: 48,
    height: 72,
  };
  return state.obstacles.some((obstacle) => {
    const previousX = previousObstaclePositions.get(obstacle.id) ?? obstacle.x;
    const sweptX = Math.min(obstacle.x, previousX) + 4;
    const sweptWidth = Math.abs(previousX - obstacle.x) + obstacle.width - 8;
    return rectanglesOverlap(player, {
      x: sweptX,
      y: FREDRUN_GROUND_Y - obstacle.height + 3,
      width: sweptWidth,
      height: obstacle.height - 3,
    });
  });
}

export function advanceFredRun(
  state: FredRunState,
  deltaSeconds: number,
  random: () => number = Math.random,
): FredRunState {
  const delta = Math.min(0.05, Math.max(0, deltaSeconds));
  if (delta === 0 || state.phase !== "running") {
    return state;
  }

  let playerHeight = state.playerHeight;
  let playerVelocity = state.playerVelocity;
  let jumpElapsed = state.jumpElapsed;
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

  const currentSpeed = fredRunSpeedForDistance(state.distance);
  const distance = state.distance + currentSpeed * delta;
  const score = Math.floor(distance / SCORE_DISTANCE);
  const speed = fredRunSpeedForDistance(distance);
  let spawnDistance = state.spawnDistance - currentSpeed * delta;
  let nextObstacleId = state.nextObstacleId;
  const previousObstaclePositions = new Map(
    state.obstacles.map((obstacle) => [obstacle.id, obstacle.x]),
  );
  const movedObstacles = state.obstacles.map((obstacle) => ({
    ...obstacle,
    x: obstacle.x - currentSpeed * obstacleSpeedMultiplier(obstacle.kind) * delta,
  }));
  const obstacles = movedObstacles.filter((obstacle) => obstacle.x + obstacle.width > -20);
  const collisionObstacles = [...movedObstacles];

  if (spawnDistance <= 0) {
    const obstacle = obstacleFor(random, nextObstacleId);
    obstacles.push(obstacle);
    collisionObstacles.push(obstacle);
    nextObstacleId += 1;
    spawnDistance = nextGap(speed, random);
  }

  const advanced: FredRunState = {
    ...state,
    elapsed: state.elapsed + delta,
    distance,
    score,
    speed,
    playerHeight,
    playerVelocity,
    jumpElapsed,
    grounded,
    spawnDistance,
    nextObstacleId,
    obstacles,
  };

  if (collidesWithPlayer(
    { ...advanced, obstacles: collisionObstacles },
    previousObstaclePositions,
  )) {
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
