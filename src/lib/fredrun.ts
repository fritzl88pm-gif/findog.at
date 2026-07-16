export const FREDRUN_WORLD_WIDTH = 960;
export const FREDRUN_WORLD_HEIGHT = 360;
export const FREDRUN_GROUND_Y = 300;
export const FREDRUN_PLAYER_X = 132;
export const FREDRUN_MILESTONE_POINTS = 250;
export const FREDRUN_MILESTONE_DURATION = 1.6;
export const FREDRUN_HIGH_SCORE_KEY = "findog.fredrun.highscore.v1";

const BASE_SPEED = 300;
const MAX_SPEED = 516;
const SPEED_PER_LEVEL = 24;
const GRAVITY = 1600;
const JUMP_VELOCITY = 660;
const SCORE_DISTANCE = 34;
const INITIAL_SPAWN_DISTANCE = 650;
const RESUME_SPAWN_DISTANCE = 520;

export type FredRunPhase = "ready" | "running" | "milestone" | "paused" | "game-over";
export type FredRunObstacleKind = "beschluss" | "reihe100" | "steuerkodex" | "paragraph";

export type FredRunObstacle = {
  id: number;
  kind: FredRunObstacleKind;
  x: number;
  width: number;
  height: number;
};

const FREDRUN_OBSTACLE_SPECS = [
  { kind: "beschluss", width: 36, height: 66 },
  { kind: "reihe100", width: 56, height: 60 },
  { kind: "steuerkodex", width: 45, height: 70 },
  { kind: "paragraph", width: 42, height: 68 },
] as const satisfies readonly Omit<FredRunObstacle, "id" | "x">[];

export type FredRunState = {
  phase: FredRunPhase;
  pausedFrom: "running" | "milestone" | null;
  elapsed: number;
  distance: number;
  score: number;
  level: number;
  speed: number;
  nextMilestone: number;
  milestoneRemaining: number;
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
    pausedFrom: null,
    elapsed: 0,
    distance: 0,
    score: 0,
    level: 1,
    speed: BASE_SPEED,
    nextMilestone: FREDRUN_MILESTONE_POINTS,
    milestoneRemaining: 0,
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
  if (state.phase !== "running" && state.phase !== "milestone") {
    return state;
  }
  return { ...state, pausedFrom: state.phase, phase: "paused" };
}

export function resumeFredRun(state: FredRunState): FredRunState {
  if (state.phase !== "paused" || !state.pausedFrom) {
    return state;
  }
  return { ...state, phase: state.pausedFrom, pausedFrom: null };
}

function speedForLevel(level: number): number {
  return Math.min(MAX_SPEED, BASE_SPEED + (level - 1) * SPEED_PER_LEVEL);
}

function obstacleFor(random: () => number, id: number): FredRunObstacle {
  const roll = Math.min(0.999999, Math.max(0, random()));
  const spec = FREDRUN_OBSTACLE_SPECS[Math.floor(roll * FREDRUN_OBSTACLE_SPECS.length)];
  return { id, ...spec, x: FREDRUN_WORLD_WIDTH + 40 };
}

function nextGap(speed: number, random: () => number): number {
  const safeMinimum = Math.max(470, speed * 1.2);
  return safeMinimum + Math.min(1, Math.max(0, random())) * 190;
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

function collidesWithPlayer(state: FredRunState): boolean {
  const player = {
    x: FREDRUN_PLAYER_X - 24,
    y: FREDRUN_GROUND_Y - state.playerHeight - 76,
    width: 48,
    height: 72,
  };
  return state.obstacles.some((obstacle) => rectanglesOverlap(player, {
    x: obstacle.x + 4,
    y: FREDRUN_GROUND_Y - obstacle.height + 3,
    width: obstacle.width - 8,
    height: obstacle.height - 3,
  }));
}

export function advanceFredRun(
  state: FredRunState,
  deltaSeconds: number,
  random: () => number = Math.random,
): FredRunState {
  const delta = Math.min(0.05, Math.max(0, deltaSeconds));
  if (delta === 0 || (state.phase !== "running" && state.phase !== "milestone")) {
    return state;
  }

  if (state.phase === "milestone") {
    const milestoneRemaining = Math.max(0, state.milestoneRemaining - delta);
    if (milestoneRemaining > 0) {
      return { ...state, milestoneRemaining, elapsed: state.elapsed + delta };
    }
    const level = state.level + 1;
    return {
      ...state,
      phase: "running",
      level,
      speed: speedForLevel(level),
      milestoneRemaining: 0,
      spawnDistance: RESUME_SPAWN_DISTANCE,
      elapsed: state.elapsed + delta,
    };
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

  const distance = state.distance + state.speed * delta;
  const score = Math.floor(distance / SCORE_DISTANCE);
  let spawnDistance = state.spawnDistance - state.speed * delta;
  let nextObstacleId = state.nextObstacleId;
  const obstacles = state.obstacles
    .map((obstacle) => ({ ...obstacle, x: obstacle.x - state.speed * delta }))
    .filter((obstacle) => obstacle.x + obstacle.width > -20);

  if (spawnDistance <= 0) {
    obstacles.push(obstacleFor(random, nextObstacleId));
    nextObstacleId += 1;
    spawnDistance = nextGap(state.speed, random);
  }

  const advanced: FredRunState = {
    ...state,
    elapsed: state.elapsed + delta,
    distance,
    score,
    playerHeight,
    playerVelocity,
    jumpElapsed,
    grounded,
    spawnDistance,
    nextObstacleId,
    obstacles,
  };

  if (collidesWithPlayer(advanced)) {
    return { ...advanced, phase: "game-over" };
  }

  if (score >= state.nextMilestone) {
    return {
      ...advanced,
      phase: "milestone",
      milestoneRemaining: FREDRUN_MILESTONE_DURATION,
      nextMilestone: state.nextMilestone + FREDRUN_MILESTONE_POINTS,
      playerHeight: 0,
      playerVelocity: 0,
      jumpElapsed: 0,
      grounded: true,
      obstacles: [],
    };
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
