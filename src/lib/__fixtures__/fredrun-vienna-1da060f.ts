// Verbatim scheduling functions and constants from 1da060f:src/lib/fredrun.ts.
// Keep independent of the current implementation as a regression oracle.
import type { FredRunObstacle } from "../fredrun";

export const FREDRUN_WORLD_WIDTH = 960;

const ODO_SPAWN_RATE = 0.125;

const MADINGER_SPAWN_RATE = 0.125;

const JQA_SPAWN_RATE = 0.125;

const LUKI_SPAWN_RATE = 0.125;

const FREDRUN_ODO_SPEC = { kind: "odo", width: 38, height: 78 } as const;

const FREDRUN_MADINGER_SPEC = { kind: "madinger", width: 42, height: 82 } as const;

const FREDRUN_JQA_SPEC = { kind: "jqa", width: 42, height: 84 } as const;

const FREDRUN_LUKI_SPEC = { kind: "luki", width: 46, height: 84 } as const;

const FREDRUN_STATIC_OBSTACLE_SPECS = [
  { kind: "reihe100", width: 56, height: 60 },
  { kind: "steuerkodex", width: 45, height: 70 },
  { kind: "paragraph", width: 42, height: 68 },
] as const satisfies readonly Omit<FredRunObstacle, "id" | "x">[];

function normalizedPositive(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function fredRunReactionTimeFactorForScore(score: number): number {
  const normalized = normalizedPositive(score);
  if (normalized <= 3_000) {
    return 1.2;
  }
  const excess = (normalized - 3_000) / 1_000;
  return 0.55 + 0.65 / (1 + 0.1 * excess);
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

export { obstacleFor as originalObstacleFor, nextGap as originalNextGap };
