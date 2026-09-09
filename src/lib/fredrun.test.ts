import { URBAN_PATTERNS, urbanPackage } from "./fredrun-urban-event";
import { describe, expect, it } from "vitest";
import { originalObstacleFor, originalNextGap } from "./__fixtures__/fredrun-vienna-1da060f";

import {
  FREDRUN_ALPS_CRUMBLE_DURATION,
  FREDRUN_ALPS_FATAL_FALL_DEPTH,
  FREDRUN_ALPS_PLATFORM_Y,
  FREDRUN_COIN_SCORE,
  FREDRUN_COLLECTIBLE_SPAWN_CLEARANCE,
  FREDRUN_GROUND_Y,
  FREDRUN_HIGH_SCORE_KEY,
  FREDRUN_JUMP_BUFFER_SECONDS,
  FREDRUN_MAGNET_SECONDS,
  FREDRUN_LIGHTNING_WARNING_SECONDS,
  FREDRUN_LIGHTNING_WIDTH,
  FREDRUN_NEAR_MISS_COMBO_SECONDS,
  FREDRUN_PLAYER_X,
  FREDRUN_RESUME_COUNTDOWN_SECONDS,
  FREDRUN_SCORE_PULSE_POINTS,
  FREDRUN_STAMP_HEAD_IMPACT_Y,
  FREDRUN_STAMP_HEAD_REST_Y,
  FREDRUN_STAMP_HEIGHT,
  FREDRUN_STAMP_WIDTH,
  advanceFredRun,
  createFredRunState,
  fredRunContinuousScoreForDistance,
  fredRunEnvironmentForDistance,
  fredRunPowerUpDistanceMultiplierForScore,
  fredRunReactionTimeFactorForScore,
  fredRunShieldDurationForScore,
  fredRunShieldSpawnRateForScore,
  fredRunSpeedForDistance,
  fredRunSpeedForScore,
  jumpFredRun,
  pauseFredRun,
  readFredRunHighScore,
  restartFredRun,
  resumeFredRun,
  startFredRun,
  type FredRunChasm,
  type FredRunPlatform,
  type FredRunStampHazard,
  type FredRunState,
  writeFredRunHighScore,
} from "./fredrun";

const MAX_BEHAVIOR_STEPS = 2_000;

function advanceUntil(
  initial: FredRunState,
  shouldContinue: (state: FredRunState) => boolean,
  label: string,
): FredRunState {
  let state = initial;
  for (let step = 0; step < MAX_BEHAVIOR_STEPS; step += 1) {
    if (state.phase === "game-over") {
      throw new Error(`${label}: unexpected game-over at step ${step} (height=${state.playerHeight}, grounded=${state.grounded}, obstacles=${state.obstacles.map((obstacle) => `${obstacle.id}:${obstacle.x.toFixed(1)}`).join(",")})`);
    }
    if (!shouldContinue(state)) return state;
    state = advanceFredRun(state, 0.02);
  }
  throw new Error(`${label}: exceeded ${MAX_BEHAVIOR_STEPS} steps`);
}
import {
  FREDRUN_WORLDS,
  fredRunFluorescentFlicker,
  fredRunWorldBackgroundForScore,
} from "./fredrun-worlds";

describe("Fredrun world background progression", () => {
  it("keeps Vienna unchanged and crossfades four distinct Finanzamt rooms", () => {
    expect(FREDRUN_WORLDS.vienna.backgrounds).toEqual({
      stages: [
        { source: "/fredrun/backgrounds/vienna-ominous.webp", anchorScore: 0 },
        { source: "/fredrun/backgrounds/vienna-gathering-storm.webp", anchorScore: 500 },
        { source: "/fredrun/backgrounds/vienna-storm-damage.webp", anchorScore: 1_000 },
        { source: "/fredrun/backgrounds/vienna-heavy-smoke-emergency.webp", anchorScore: 1_500 },
        { source: "/fredrun/backgrounds/vienna-burning-collapse.webp", anchorScore: 2_000 },
        { source: "/fredrun/backgrounds/vienna-widespread-fire-collapse.webp", anchorScore: 2_500 },
        { source: "/fredrun/backgrounds/vienna-rubble-ashes.webp", anchorScore: 3_000 },
        { source: "/fredrun/backgrounds/vienna-cold-ash-aftermath.webp", anchorScore: 3_500 },
      ],
      fallbackSource: "/fredrun/vienna-panorama.webp",
      crossfadeScoreDuration: 40,
      renderStyle: "vienna-disaster",
    });
    const viennaCrossfade = fredRunWorldBackgroundForScore("vienna", 480);
    expect(viennaCrossfade).toMatchObject({
      fromStage: 0,
      toStage: 1,
    });
    expect(viennaCrossfade.blend).toBeCloseTo(0.5, 12);
    expect(fredRunWorldBackgroundForScore("vienna", 10_000)).toEqual({
      fromStage: 7,
      toStage: 7,
      blend: 0,
    });
    expect(FREDRUN_WORLDS["finanzamt-night"].backgrounds.stages).toEqual([
      {
        source: "/fredrun/levels/finanzamt-night/backgrounds/close-caseworker-office.webp",
        anchorScore: 0,
      },
      {
        source: "/fredrun/levels/finanzamt-night/backgrounds/close-records-room.webp",
        anchorScore: 500,
      },
      {
        source: "/fredrun/levels/finanzamt-night/backgrounds/close-glass-offices.webp",
        anchorScore: 1_000,
      },
      {
        source: "/fredrun/levels/finanzamt-night/backgrounds/close-archive.webp",
        anchorScore: 1_500,
      },
    ]);
    expect(FREDRUN_WORLDS["finanzamt-night"].backgrounds.crossfadeScoreDuration).toBe(40);
    expect(FREDRUN_WORLDS["finanzamt-night"].backgrounds.fallbackSource)
      .toBe("/fredrun/levels/finanzamt-night/backgrounds/close-office.webp");

    expect(fredRunWorldBackgroundForScore("finanzamt-night", -1))
      .toEqual({ fromStage: 0, toStage: 1, blend: 0 });
    expect(fredRunWorldBackgroundForScore("finanzamt-night", 459))
      .toEqual({ fromStage: 0, toStage: 1, blend: 0 });
    expect(fredRunWorldBackgroundForScore("finanzamt-night", 460))
      .toEqual({ fromStage: 0, toStage: 1, blend: 0 });
    expect(fredRunWorldBackgroundForScore("finanzamt-night", 470))
      .toMatchObject({ fromStage: 0, toStage: 1 });
    expect(fredRunWorldBackgroundForScore("finanzamt-night", 470).blend)
      .toBeCloseTo(0.15625, 12);
    expect(fredRunWorldBackgroundForScore("finanzamt-night", 480))
      .toMatchObject({ fromStage: 0, toStage: 1 });
    expect(fredRunWorldBackgroundForScore("finanzamt-night", 480).blend)
      .toBeCloseTo(0.5, 12);
    expect(fredRunWorldBackgroundForScore("finanzamt-night", 490))
      .toMatchObject({ fromStage: 0, toStage: 1 });
    expect(fredRunWorldBackgroundForScore("finanzamt-night", 490).blend)
      .toBeCloseTo(0.84375, 12);
    expect(fredRunWorldBackgroundForScore("finanzamt-night", 500))
      .toEqual({ fromStage: 1, toStage: 2, blend: 0 });
    expect(fredRunWorldBackgroundForScore("finanzamt-night", 980))
      .toMatchObject({ fromStage: 1, toStage: 2 });
    expect(fredRunWorldBackgroundForScore("finanzamt-night", 980).blend)
      .toBeCloseTo(0.5, 12);
    expect(fredRunWorldBackgroundForScore("finanzamt-night", 1_480))
      .toMatchObject({ fromStage: 2, toStage: 3 });
    expect(fredRunWorldBackgroundForScore("finanzamt-night", 1_480).blend)
      .toBeCloseTo(0.5, 12);
    for (const score of [1_500, 10_000, Number.MAX_SAFE_INTEGER]) {
      expect(fredRunWorldBackgroundForScore("finanzamt-night", score))
        .toEqual({ fromStage: 3, toStage: 3, blend: 0 });
    }
    expect(fredRunWorldBackgroundForScore("finanzamt-night", Number.POSITIVE_INFINITY))
      .toEqual({ fromStage: 0, toStage: 1, blend: 0 });

    for (const distance of [0, 480 * 34, 500 * 34, 1_475 * 34, 3_500 * 34, 10_000 * 34]) {
      const existingVienna = fredRunEnvironmentForDistance(distance);
      expect(fredRunWorldBackgroundForScore(
        "vienna",
        fredRunContinuousScoreForDistance(distance),
      )).toEqual({
        fromStage: existingVienna.fromStage,
        toStage: existingVienna.toStage,
        blend: existingVienna.blend,
      });
    }
  });

  it("selects a subtle deterministic fluorescent flicker only for Finanzamt", () => {
    const times = Array.from({ length: 241 }, (_, index) => index / 8);
    const samples = times.map((elapsed) => fredRunFluorescentFlicker(
      "finanzamt-night",
      elapsed,
      false,
    ));

    expect(samples.every((opacity) => opacity >= 0 && opacity <= 0.045)).toBe(true);
    expect(new Set(samples.map((opacity) => opacity.toFixed(6))).size).toBeGreaterThan(100);
    expect(fredRunFluorescentFlicker("finanzamt-night", 12.345, false))
      .toBe(fredRunFluorescentFlicker("finanzamt-night", 12.345, false));
    expect(Math.abs(
      fredRunFluorescentFlicker("finanzamt-night", 8 + 1 / 120, false)
      - fredRunFluorescentFlicker("finanzamt-night", 8, false),
    )).toBeLessThan(0.002);

    for (const elapsed of times) {
      expect(fredRunFluorescentFlicker("vienna", elapsed, false)).toBe(0);
      expect(fredRunFluorescentFlicker("alps", elapsed, false)).toBe(0);
      expect(fredRunFluorescentFlicker("finanzamt-night", elapsed, true)).toBe(0);
    }
  });

  it("configures the sunny Alps world with 4 daytime mountain stages and smooth crossfades", () => {
    expect(FREDRUN_WORLDS.alps.name).toBe("Alpenpanorama");
    expect(FREDRUN_WORLDS.alps.price).toBe(0);
    expect(FREDRUN_WORLDS.alps.backgrounds.renderStyle).toBe("alps-sunny");
    expect(FREDRUN_WORLDS.alps.backgrounds.stages).toEqual([
      { source: "/fredrun/levels/alps/backgrounds/meadow.webp", anchorScore: 0 },
      { source: "/fredrun/levels/alps/backgrounds/lake.webp", anchorScore: 500 },
      { source: "/fredrun/levels/alps/backgrounds/peaks.webp", anchorScore: 1_000 },
      { source: "/fredrun/levels/alps/backgrounds/plateau.webp", anchorScore: 1_500 },
    ]);
    expect(FREDRUN_WORLDS.alps.backgrounds.fallbackSource).toBe("/fredrun/levels/alps/backgrounds/fallback.webp");

    expect(fredRunWorldBackgroundForScore("alps", 0)).toEqual({ fromStage: 0, toStage: 1, blend: 0 });
    expect(fredRunWorldBackgroundForScore("alps", 250)).toEqual({ fromStage: 0, toStage: 1, blend: 0 });
    expect(fredRunWorldBackgroundForScore("alps", 375).blend).toBeCloseTo(0.5, 12);
    expect(fredRunWorldBackgroundForScore("alps", 500)).toEqual({ fromStage: 1, toStage: 2, blend: 0 });
    expect(fredRunWorldBackgroundForScore("alps", 875).blend).toBeCloseTo(0.5, 12);
    expect(fredRunWorldBackgroundForScore("alps", 1_000)).toEqual({ fromStage: 2, toStage: 3, blend: 0 });
    expect(fredRunWorldBackgroundForScore("alps", 1_375).blend).toBeCloseTo(0.5, 12);
    expect(fredRunWorldBackgroundForScore("alps", 2_000)).toEqual({ fromStage: 3, toStage: 3, blend: 0 });
  });
});

describe("Fredrun simulation", () => {
  it("uses the exact continuous and uncapped 120-per-250-points speed curve", () => {
    const samples = [
      { score: 0, speed: 300 },
      { score: 125, speed: 360 },
      { score: 250, speed: 420 },
      { score: 500, speed: 540 },
      { score: 1_000, speed: 780 },
      { score: 1_750, speed: 1_140 },
      { score: 2_750, speed: 1_620 },
    ];

    expect(samples.map(({ score }) => fredRunSpeedForScore(score)))
      .toEqual(samples.map(({ speed }) => speed));
    expect(fredRunSpeedForScore(10_000)).toBe(5_100);
    expect(fredRunSpeedForDistance(250 * 34)).toBe(420);
  });

  it("starts in a ready state and resets all round state", () => {
    const started = startFredRun(createFredRunState());
    expect(started.phase).toBe("running");
    expect(restartFredRun()).toEqual(createFredRunState());
  });

  it("jumps without allowing an immediate double jump and lands again", () => {
    const running = startFredRun(createFredRunState());
    const jumping = jumpFredRun(running);
    expect(jumping.grounded).toBe(false);
    expect(jumpFredRun(jumping)).toMatchObject({
      grounded: false,
      playerVelocity: jumping.playerVelocity,
      jumpBufferRemaining: FREDRUN_JUMP_BUFFER_SECONDS,
    });

    let landed = jumping;
    let peakHeight = 0;
    let airTime = 0;
    for (let step = 0; step < 240 && !landed.grounded; step += 1) {
      landed = advanceFredRun(landed, 1 / 120, () => 0.5);
      expect(landed.phase).toBe("running");
      peakHeight = Math.max(peakHeight, landed.playerHeight);
      airTime += 1 / 120;
    }
    expect(landed.grounded).toBe(true);
    expect(landed.playerHeight).toBe(0);
    expect(peakHeight).toBeGreaterThan(130);
    expect(peakHeight).toBeLessThan(140);
    expect(airTime).toBeGreaterThan(0.8);
    expect(airTime).toBeLessThan(0.85);
  });

  it("buffers a jump shortly before landing and launches immediately on touchdown", () => {
    let falling = jumpFredRun(startFredRun(createFredRunState()));
    falling = advanceUntil(falling, (next) => !(next.playerVelocity < 0 && next.playerHeight < 12), "jump buffer approach");
    let buffered = jumpFredRun(falling);
    expect(buffered.jumpBufferRemaining).toBe(FREDRUN_JUMP_BUFFER_SECONDS);

    let reboundDetected = false;
    for (let index = 0; index < 20; index += 1) {
      buffered = advanceFredRun(buffered, 1 / 120, () => 0.5);
      if (buffered.playerVelocity > 0) {
        reboundDetected = true;
        break;
      }
    }
    expect(reboundDetected).toBe(true);
    expect(buffered.grounded).toBe(false);
    expect(buffered.jumpBufferRemaining).toBe(0);
  });

  it("spawns only ground obstacles with a positive following distance", () => {
    let state = startFredRun(createFredRunState());
    for (let index = 0; index < 320; index += 1) {
      state = advanceFredRun(evadeGeneratedHazards(state), 0.05, () => 0, () => 0);
      expect(state.phase).toBe("running");
    }
    expect(state.nextObstacleId).toBeGreaterThan(2);
    expect(state.spawnDistance).toBeGreaterThan(0);
  });

  it("keeps at least 1.2 real-time seconds between spawns up to 3,000 points", () => {
    const distance = 2_500 * 34;
    const state = startFredRun({
      ...createFredRunState(),
      distance,
      score: 2_500,
      speed: fredRunSpeedForDistance(distance),
      spawnDistance: 0,
    });
    const advanced = advanceFredRun(state, 1 / 120, () => 0);
    expect(advanced.speed).toBeGreaterThan(1_400);
    expect(advanced.spawnDistance / advanced.speed).toBeCloseTo(1.2, 5);
  });

  it("progressively compresses the reaction time window above 3,000 points without a hard cap", () => {
    expect(fredRunReactionTimeFactorForScore(0)).toBe(1.2);
    expect(fredRunReactionTimeFactorForScore(3_000)).toBe(1.2);
    expect(fredRunReactionTimeFactorForScore(4_000)).toBeCloseTo(1.1409, 3);
    expect(fredRunReactionTimeFactorForScore(6_000)).toBeCloseTo(1.05, 3);
    expect(fredRunReactionTimeFactorForScore(8_000)).toBeCloseTo(0.9833, 3);
    expect(fredRunReactionTimeFactorForScore(13_000)).toBeCloseTo(0.875, 3);
    expect(fredRunReactionTimeFactorForScore(23_000)).toBeCloseTo(0.7667, 3);

    const distance = 8_000 * 34;
    const state = startFredRun({
      ...createFredRunState(),
      distance,
      score: 8_000,
      speed: fredRunSpeedForDistance(distance),
      spawnDistance: 0,
    });
    const advanced = advanceFredRun(state, 1 / 120, () => 0);
    const expectedFactor = fredRunReactionTimeFactorForScore(8_000);
    expect(advanced.spawnDistance / advanced.speed).toBeCloseTo(expectedFactor, 4);
  });

  it("spawns both animated opponents and keeps all collision boxes jumpable", () => {
    const cases = [
      { roll: 0, kind: "odo", width: 38, height: 78 },
      { roll: 0.125, kind: "madinger", width: 42, height: 82 },
      { roll: 0.25, kind: "jqa", width: 42, height: 84 },
      { roll: 0.375, kind: "luki", width: 46, height: 84 },
      { roll: 0.5, kind: "reihe100", width: 56, height: 60 },
      { roll: 0.7, kind: "steuerkodex", width: 45, height: 70 },
      { roll: 0.9, kind: "paragraph", width: 42, height: 68 },
    ] as const;

    for (const expected of cases) {
      const state = startFredRun({ ...createFredRunState(), spawnDistance: 0 });
      const stream = [expected.roll, 0.99];
      const advanced = advanceFredRun(state, 1 / 120, () => stream.shift() ?? expected.roll);
      expect(advanced.obstacles).toHaveLength(1);
      expect(advanced.obstacles[0]).toMatchObject({
        kind: expected.kind,
        width: expected.width,
        height: expected.height,
      });
    }
  });

  it("detects a collision with Fred's reduced hitbox", () => {
    const state = startFredRun({
      ...createFredRunState(),
      spawnDistance: 10_000,
      obstacles: [{ id: 1, kind: "odo", x: 112, width: 38, height: 78 }],
    });
    expect(advanceFredRun(state, 0.01, () => 0.5).phase).toBe("game-over");
  });

  it("does not tunnel through Fred at extreme uncapped speed", () => {
    const distance = 30_000 * 34;
    const state = startFredRun({
      ...createFredRunState(),
      distance,
      score: 30_000,
      speed: fredRunSpeedForDistance(distance),
      spawnDistance: 100_000,
      obstacles: [{ id: 1, kind: "paragraph", x: 300, width: 42, height: 68 }],
    });
    const advanced = advanceFredRun(state, 0.05, () => 0.5);
    expect(advanced.speed).toBeGreaterThan(14_000);
    expect(advanced.phase).toBe("game-over");
  });

  it("moves the running Odo faster than static obstacles", () => {
    const state = startFredRun({
      ...createFredRunState(),
      spawnDistance: 10_000,
      obstacles: [
        { id: 1, kind: "odo", x: 800, width: 38, height: 78 },
        { id: 2, kind: "paragraph", x: 800, width: 42, height: 68 },
      ],
    });
    const advanced = advanceFredRun(state, 0.1, () => 0.5);
    expect(advanced.obstacles[0].x).toBeLessThan(advanced.obstacles[1].x);
  });

  it("moves Madinger only from right to left", () => {
    const state = startFredRun({
      ...createFredRunState(),
      spawnDistance: 10_000,
      obstacles: [{ id: 1, kind: "madinger", x: 800, width: 42, height: 82 }],
    });
    const firstStep = advanceFredRun(state, 0.05, () => 0.5);
    const secondStep = advanceFredRun(firstStep, 0.05, () => 0.5);
    expect(firstStep.obstacles[0].x).toBeLessThan(800);
    expect(secondStep.obstacles[0].x).toBeLessThan(firstStep.obstacles[0].x);
  });

  it("keeps dancing JQA stationary relative to the scrolling world", () => {
    const state = startFredRun({
      ...createFredRunState(),
      spawnDistance: 10_000,
      obstacles: [
        { id: 1, kind: "jqa", x: 800, width: 42, height: 84 },
        { id: 2, kind: "paragraph", x: 900, width: 42, height: 68 },
      ],
    });
    const advanced = advanceFredRun(state, 0.05, () => 0.5);
    expect(800 - advanced.obstacles[0].x).toBeCloseTo(900 - advanced.obstacles[1].x, 8);
  });

  it("runs Luki toward Fred faster than the scrolling world", () => {
    const state = startFredRun({
      ...createFredRunState(),
      spawnDistance: 10_000,
      coinSpawnDistance: 10_000,
      obstacles: [
        { id: 1, kind: "luki", x: 800, width: 46, height: 84 },
        { id: 2, kind: "paragraph", x: 800, width: 42, height: 68 },
      ],
    });
    const advanced = advanceFredRun(state, 0.1, () => 0.5);
    expect(advanced.obstacles[0].x).toBeLessThan(advanced.obstacles[1].x);
  });

  it("spawns coins high enough to require a meaningful jump", () => {
    const state = startFredRun({
      ...createFredRunState(),
      spawnDistance: 10_000,
      coinSpawnDistance: 0,
    });
    const advanced = advanceFredRun(state, 1 / 120, () => 0);
    expect(advanced.coins).toHaveLength(1);
    expect(advanced.coins[0].y + advanced.coins[0].radius)
      .toBeLessThanOrEqual(300 - 76 - 50);
  });

  it("collects airborne coins and adds 25 points without changing distance speed", () => {
    const state = startFredRun({
      ...createFredRunState(),
      spawnDistance: 10_000,
      coinSpawnDistance: 10_000,
      playerHeight: 30,
      playerVelocity: -20,
      grounded: false,
      coins: [{ id: 1, x: 136, y: 200, radius: 11 }],
    });
    const advanced = advanceFredRun(state, 0.01, () => 0.5);
    expect(advanced.coins).toEqual([]);
    expect(advanced.coinsCollected).toBe(1);
    expect(advanced.score).toBe(FREDRUN_COIN_SCORE);
    expect(advanced.speed).toBeCloseTo(fredRunSpeedForDistance(advanced.distance), 8);
  });

  it("keeps the raised coin height reachable near Fred's jump apex", () => {
    const state = startFredRun({
      ...createFredRunState(),
      spawnDistance: 10_000,
      coinSpawnDistance: 10_000,
      playerHeight: 132,
      playerVelocity: 0,
      grounded: false,
      coins: [{ id: 1, x: 136, y: 162, radius: 11 }],
    });
    const advanced = advanceFredRun(state, 1 / 120, () => 0.5);
    expect(advanced.coinsCollected).toBe(1);
    expect(advanced.coins).toEqual([]);
  });

  it("awards escalating near-miss bonuses and expires the combo window", () => {
    const first = advanceFredRun(startFredRun({
      ...createFredRunState(),
      spawnDistance: 10_000,
      coinSpawnDistance: 10_000,
      powerUpSpawnDistance: 10_000,
      playerHeight: 81,
      playerVelocity: 0,
      grounded: false,
      obstacles: [{ id: 1, kind: "odo", x: 70, width: 38, height: 78 }],
    }), 0.01, () => 0.5);
    expect(first).toMatchObject({
      phase: "running",
      nearMisses: 1,
      nearMissScore: 50,
      lastNearMissBonus: 50,
      comboMultiplier: 2,
      comboRemaining: FREDRUN_NEAR_MISS_COMBO_SECONDS,
    });

    const second = advanceFredRun({
      ...first,
      obstacles: [{ id: 2, kind: "odo", x: 70, width: 38, height: 78 }],
    }, 0.01, () => 0.5);
    expect(second).toMatchObject({
      nearMisses: 2,
      nearMissScore: 125,
      lastNearMissBonus: 75,
      comboMultiplier: 3,
    });

    // This unit test isolates combo expiry; generated lightning is exercised below.
    let expired: FredRunState = { ...second, obstacles: [], spawnDistance: 10_000, lightningWait: 10 };
    for (let index = 0; index < 61; index += 1) {
      expired = advanceFredRun(expired, 0.05, () => 0.5);
    }
    expect(expired.comboMultiplier).toBe(0);
    expect(expired.comboRemaining).toBe(0);
  });

  it("spawns each rare power-up at a jump-reachable height", () => {
    const cases = [
      { roll: 0, kind: "magnet" },
      { roll: 0.8, kind: "shield" },
    ] as const;
    for (const expected of cases) {
      const values = [expected.roll, 0.5, 0.5];
      const state = advanceFredRun(startFredRun({
        ...createFredRunState(),
        spawnDistance: 10_000,
        coinSpawnDistance: 10_000,
        powerUpSpawnDistance: 0,
      }), 1 / 120, () => values.shift() ?? 0.5);
      expect(state.powerUps).toHaveLength(1);
      expect(state.powerUps[0].kind).toBe(expected.kind);
      expect(state.powerUps[0].y).toBeLessThan(FREDRUN_GROUND_Y - 110);
      expect(state.powerUpSpawnDistance / fredRunSpeedForDistance(state.distance)).toBeGreaterThanOrEqual(10);
    }
  });

  it("delays a power-up until it has clear space from a coin formation", () => {
    let state = advanceFredRun(startFredRun({
      ...createFredRunState(),
      spawnDistance: 10_000,
      coinSpawnDistance: 0,
      powerUpSpawnDistance: 0,
    }), 1 / 120, () => 0);

    expect(state.coins).toHaveLength(1);
    expect(state.powerUps).toHaveLength(0);
    expect(state.powerUpSpawnDistance).toBe(0);

    for (let index = 0; index < 120 && state.powerUps.length === 0; index += 1) {
      state = advanceFredRun(state, 1 / 120, () => 0);
    }

    expect(state.powerUps).toHaveLength(1);
    for (const coin of state.coins) {
      const powerUp = state.powerUps[0];
      expect(Math.hypot(powerUp.x - coin.x, powerUp.y - coin.y)).toBeGreaterThanOrEqual(
        powerUp.radius + coin.radius + FREDRUN_COLLECTIBLE_SPAWN_CLEARANCE,
      );
    }
  });

  it("delays a coin formation that would overlap an existing power-up", () => {
    const state = advanceFredRun(startFredRun({
      ...createFredRunState(),
      spawnDistance: 10_000,
      coinSpawnDistance: 0,
      powerUpSpawnDistance: 10_000,
      powerUps: [{
        id: 1,
        kind: "magnet",
        x: 1_000,
        y: FREDRUN_GROUND_Y - 138,
        radius: 15,
      }],
    }), 1 / 120, () => 0);

    expect(state.coins).toHaveLength(0);
    expect(state.coinSpawnDistance).toBe(0);
  });

  it("activates magnet and shield when collected", () => {
    const collect = (kind: "magnet" | "shield") => advanceFredRun(startFredRun({
      ...createFredRunState(),
      spawnDistance: 10_000,
      coinSpawnDistance: 10_000,
      powerUpSpawnDistance: 10_000,
      playerHeight: 30,
      playerVelocity: -20,
      grounded: false,
      powerUps: [{ id: 1, kind, x: 136, y: 200, radius: 15 }],
    }), 0.01, () => 0.5);

    expect(collect("magnet")).toMatchObject({
      powerUpsCollected: 1,
      magnetRemaining: FREDRUN_MAGNET_SECONDS,
      lastPowerUpKind: "magnet",
    });
    expect(collect("shield")).toMatchObject({
      powerUpsCollected: 1,
      shieldActive: true,
      lastPowerUpKind: "shield",
    });
  });

  it("pulls coins with the magnet without changing the speed curve", () => {
    const normal = advanceFredRun(startFredRun({
      ...createFredRunState(),
      spawnDistance: 10_000,
      coinSpawnDistance: 10_000,
      powerUpSpawnDistance: 10_000,
      coins: [{ id: 1, x: 300, y: 260, radius: 11 }],
    }), 0.05, () => 0.5);
    const powered = advanceFredRun(startFredRun({
      ...createFredRunState(),
      spawnDistance: 10_000,
      coinSpawnDistance: 10_000,
      powerUpSpawnDistance: 10_000,
      magnetRemaining: FREDRUN_MAGNET_SECONDS,
      coins: [{ id: 1, x: 300, y: 260, radius: 11 }],
    }), 0.05, () => 0.5);
    expect(powered.coins[0].x).toBeLessThan(normal.coins[0].x);
    expect(powered.distance).toBeCloseTo(normal.distance, 8);
    expect(powered.speed).toBeCloseTo(fredRunSpeedForDistance(powered.distance), 8);
  });

  it("consumes one shield instead of ending the run", () => {
    const protectedState = advanceFredRun(startFredRun({
      ...createFredRunState(),
      spawnDistance: 10_000,
      coinSpawnDistance: 10_000,
      powerUpSpawnDistance: 10_000,
      shieldActive: true,
      obstacles: [{ id: 1, kind: "odo", x: 112, width: 38, height: 78 }],
    }), 0.01, () => 0.5);
    expect(protectedState.phase).toBe("running");
    expect(protectedState.shieldActive).toBe(false);
    expect(protectedState.shieldImpactRemaining).toBeGreaterThan(0);
    expect(protectedState.obstacles).toEqual([]);
  });

  it("gives shields an expiring timer above 3,000 points and smoothly scales duration", () => {
    expect(fredRunShieldDurationForScore(0)).toBe(0);
    expect(fredRunShieldDurationForScore(3_000)).toBe(0);
    expect(fredRunShieldDurationForScore(4_000)).toBeCloseTo(18.286, 3);
    expect(fredRunShieldDurationForScore(6_000)).toBeCloseTo(15.765, 3);
    expect(fredRunShieldDurationForScore(10_000)).toBeCloseTo(12.696, 3);
    expect(fredRunShieldDurationForScore(20_000)).toBeCloseTo(9.263, 3);

    // Collecting shield at score 5,000 sets shieldRemaining to ~16.9s
    const collectedAt5k = advanceFredRun(startFredRun({
      ...createFredRunState(),
      distance: 5_000 * 34,
      score: 5_000,
      spawnDistance: 10_000,
      coinSpawnDistance: 10_000,
      powerUpSpawnDistance: 10_000,
      playerHeight: 30,
      playerVelocity: -20,
      grounded: false,
      powerUps: [{ id: 1, kind: "shield", x: 136, y: 200, radius: 15 }],
    }), 0.01, () => 0.5);

    expect(collectedAt5k.shieldActive).toBe(true);
    expect(collectedAt5k.shieldRemaining).toBeCloseTo(fredRunShieldDurationForScore(5_000), 1);

    // Advancing until shield expires
    let expiringState = collectedAt5k;
    const duration = collectedAt5k.shieldRemaining;
    const steps = Math.ceil(duration / 0.05) + 2;
    for (let step = 0; step < steps; step += 1) {
      expiringState = advanceFredRun(expiringState, 0.05, () => 0.5);
    }
    expect(expiringState.shieldActive).toBe(false);
    expect(expiringState.shieldRemaining).toBe(0);
  });

  it("initializes a shield timer when an active shield crosses the 3,000-point threshold", () => {
    const pre3kState = startFredRun({
      ...createFredRunState(),
      distance: 2_999 * 34,
      score: 2_999,
      spawnDistance: 10_000,
      coinSpawnDistance: 10_000,
      powerUpSpawnDistance: 10_000,
      shieldActive: true,
      shieldRemaining: 0,
    });
    const post3kState = advanceFredRun(pre3kState, 0.1, () => 0.5);
    expect(post3kState.score).toBeGreaterThan(3_000);
    expect(post3kState.shieldRemaining).toBeGreaterThan(0);
  });

  it("scales down shield drop probability and increases power-up distance above 3,000 points", () => {
    expect(fredRunShieldSpawnRateForScore(0)).toBe(0.5);
    expect(fredRunShieldSpawnRateForScore(3_000)).toBe(0.5);
    expect(fredRunShieldSpawnRateForScore(6_000)).toBeCloseTo(0.4074, 3);
    expect(fredRunShieldSpawnRateForScore(10_000)).toBeCloseTo(0.3402, 3);
    expect(fredRunShieldSpawnRateForScore(20_000)).toBeCloseTo(0.2651, 3);

    expect(fredRunPowerUpDistanceMultiplierForScore(0)).toBe(10);
    expect(fredRunPowerUpDistanceMultiplierForScore(3_000)).toBe(10);
    expect(fredRunPowerUpDistanceMultiplierForScore(6_000)).toBe(11.35);
    expect(fredRunPowerUpDistanceMultiplierForScore(10_000)).toBe(13.15);
  });

  it("crosses 250-point boundaries without pausing or clearing obstacles", () => {
    const nearBoundary = startFredRun({
      ...createFredRunState(),
      distance: 249 * 34 + 33,
      score: 249,
      speed: fredRunSpeedForScore(249),
      spawnDistance: 10_000,
      obstacles: [{ id: 1, kind: "steuerkodex", x: 800, width: 45, height: 70 }],
    });
    const advanced = advanceFredRun(nearBoundary, 0.01, () => 0.5);
    expect(advanced.phase).toBe("running");
    expect(advanced.score).toBe(250);
    expect(advanced.obstacles).toHaveLength(1);
    expect(advanced.obstacles[0].x).toBeLessThan(800);
    expect(advanced.speed).toBeGreaterThan(420);
  });

  it("holds the world during a three-second resume countdown", () => {
    const running = advanceFredRun(startFredRun(createFredRunState()), 0.05);
    const paused = pauseFredRun(running);
    expect(paused.phase).toBe("paused");
    expect(advanceFredRun(paused, 1)).toBe(paused);
    let countdown = resumeFredRun(paused);
    expect(countdown).toMatchObject({
      phase: "countdown",
      countdownRemaining: FREDRUN_RESUME_COUNTDOWN_SECONDS,
    });
    const frozenDistance = countdown.distance;
    for (let index = 0; index < FREDRUN_RESUME_COUNTDOWN_SECONDS * 20; index += 1) {
      countdown = advanceFredRun(countdown, 0.05);
    }
    expect(countdown.phase).toBe("running");
    expect(countdown.distance).toBe(frozenDistance);
  });
});

describe("Fredrun environment progression", () => {
  it("uses smooth 500-point anchors and holds the final scene from 3,500 points", () => {
    expect(fredRunEnvironmentForDistance(0)).toMatchObject({ fromStage: 0, toStage: 1, blend: 0 });
    expect(fredRunEnvironmentForDistance(250 * 34)).toMatchObject({ fromStage: 0, toStage: 1, blend: 0 });
    expect(fredRunEnvironmentForDistance(460 * 34)).toMatchObject({ fromStage: 0, toStage: 1, blend: 0 });
    expect(fredRunEnvironmentForDistance(480 * 34).blend).toBeCloseTo(0.5, 8);
    expect(fredRunEnvironmentForDistance(500 * 34)).toMatchObject({ fromStage: 1, toStage: 2, blend: 0 });
    expect(fredRunEnvironmentForDistance(750 * 34)).toMatchObject({ fromStage: 1, toStage: 2, blend: 0 });
    expect(fredRunEnvironmentForDistance(980 * 34).blend).toBeCloseTo(0.5, 8);
    expect(fredRunEnvironmentForDistance(3_500 * 34)).toMatchObject({ fromStage: 7, toStage: 7, blend: 0 });
    expect(fredRunEnvironmentForDistance(12_000 * 34)).toMatchObject({ fromStage: 7, toStage: 7, blend: 0 });
  });

  it("escalates from storm and rain to persistent ash", () => {
    const storm = fredRunEnvironmentForDistance(500 * 34);
    expect(storm.storm).toBeGreaterThan(0);
    expect(storm.rain).toBeGreaterThan(0);
    expect(fredRunEnvironmentForDistance(2_000 * 34).rain).toBeGreaterThan(0);
    const final = fredRunEnvironmentForDistance(3_500 * 34);
    expect(final.rain).toBe(0);
    expect(final.smoke).toBeGreaterThan(0);
    expect(final.ash).toBe(1);
    expect(final.darkness).toBe(0.125);
  });
});

describe("Fredrun local high score", () => {
  it("starts the endless runner on the v2 storage key", () => {
    expect(FREDRUN_HIGH_SCORE_KEY).toBe("findog.fredrun.highscore.v2");
  });

  it("validates stored values and only writes a higher score", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(readFredRunHighScore(storage)).toBe(0);
    expect(writeFredRunHighScore(storage, 42, 0)).toBe(42);
    expect(values.get(FREDRUN_HIGH_SCORE_KEY)).toBe("42");
    expect(writeFredRunHighScore(storage, 20, 42)).toBe(42);
    values.set(FREDRUN_HIGH_SCORE_KEY, "nicht-gültig");
    expect(readFredRunHighScore(storage)).toBe(0);
  });

  it("keeps the game usable when storage access fails", () => {
    const storage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    expect(readFredRunHighScore(storage)).toBe(0);
    expect(writeFredRunHighScore(storage, 12, 0)).toBe(12);
    expect(readFredRunHighScore(null)).toBe(0);
    expect(writeFredRunHighScore(null, 15, 12)).toBe(15);
  });
});

describe("Finanzamt-night stamp hazards", () => {
  it("initializes and cycles stamp phases: anticipation -> descend -> impact -> recover -> dormant", () => {
    const stamp: FredRunStampHazard = {
      id: 1,
      x: 600,
      width: FREDRUN_STAMP_WIDTH,
      height: FREDRUN_STAMP_HEIGHT,
      phase: "anticipation",
      timer: 0,
      y: FREDRUN_STAMP_HEAD_REST_Y,
      anticipationDuration: 0.5,
      descendDuration: 0.16,
      impactDuration: 0.55,
      recoverDuration: 0.50,
      behavior: "strike",
      stampText: "GEPRÜFT",
    };
    let state = startFredRun(createFredRunState("finanzamt-night"));
    state = { ...state, stamps: [stamp] };

    // Advance during anticipation
    state = advanceFredRun(state, 0.2);
    expect(state.stamps[0].phase).toBe("anticipation");
    expect(state.stamps[0].y).toBe(FREDRUN_STAMP_HEAD_REST_Y);

    // Transition to descending once anticipation done and in strike window (timeToPlayer in [0.25, 0.65])
    state = {
      ...state,
      grounded: true,
      playerHeight: 0,
      stamps: [{
        ...state.stamps[0],
        x: 250, // distToPlayer = 250 - 120 = 130, at speed 300, timeToPlayer = 0.43s
        timer: 0.6,
      }],
    };
    state = advanceFredRun(state, 0.05);
    expect(state.stamps[0].phase).toBe("descending");

    // Move stamp ahead to safely test full timer-driven phase progression without player collision
    state = {
      ...state,
      stamps: [{
        ...state.stamps[0],
        x: 600,
      }],
    };

    // Advance through descendDuration (0.16s)
    for (let i = 0; i < 4; i += 1) {
      state = advanceFredRun(state, 0.05);
    }
    expect(state.stamps[0].phase).toBe("impact");
    expect(state.stamps[0].y).toBe(FREDRUN_STAMP_HEAD_IMPACT_Y);

    // Advance through impactDuration (0.55s)
    for (let i = 0; i < 12; i += 1) {
      state = advanceFredRun(state, 0.05);
    }
    expect(state.stamps[0].phase).toBe("recovering");

    // Advance through recoverDuration (0.50s)
    for (let i = 0; i < 11; i += 1) {
      state = advanceFredRun(state, 0.05);
    }
    expect(state.stamps[0].phase).toBe("dormant");
    expect(state.stamps[0].y).toBe(FREDRUN_STAMP_HEAD_REST_Y);
  });

  it("protects jump commitment by delaying descending stroke while player is airborne", () => {
    let state = startFredRun(createFredRunState("finanzamt-night"));
    state = jumpFredRun(state);
    expect(state.grounded).toBe(false);

    const stamp: FredRunStampHazard = {
      id: 2,
      x: 250,
      width: FREDRUN_STAMP_WIDTH,
      height: FREDRUN_STAMP_HEIGHT,
      phase: "anticipation",
      timer: 1.0,
      y: FREDRUN_STAMP_HEAD_REST_Y,
      anticipationDuration: 0.5,
      descendDuration: 0.16,
      impactDuration: 0.55,
      recoverDuration: 0.50,
      behavior: "strike",
    };
    state = { ...state, stamps: [stamp] };

    // Stamp is in strike window but player is airborne -> must NOT enter descending!
    state = advanceFredRun(state, 0.05);
    expect(state.stamps[0].phase).toBe("anticipation");
  });

  it("reproduces issue 3 fix: shield absorbs stamp collision without repeat multi-frame damage", () => {
    let state = startFredRun(createFredRunState("finanzamt-night"));
    const stamp: FredRunStampHazard = {
      id: 7,
      x: 150,
      width: FREDRUN_STAMP_WIDTH,
      height: FREDRUN_STAMP_HEIGHT,
      phase: "impact",
      timer: 0.1,
      y: FREDRUN_STAMP_HEAD_IMPACT_Y, // 236
      anticipationDuration: 0.5,
      descendDuration: 0.16,
      impactDuration: 0.55,
      recoverDuration: 0.50,
      behavior: "strike",
    };
    state = {
      ...state,
      shieldActive: true,
      shieldRemaining: 5,
      playerHeight: 0,
      grounded: true,
      stamps: [stamp],
    };

    // Step 1 (dt = 0.01): shield breaks, phase running, stamp recovering with colliderDisabled = true
    state = advanceFredRun(state, 0.01);
    expect(state.phase).toBe("running");
    expect(state.shieldActive).toBe(false);
    expect(state.stamps[0].phase).toBe("recovering");
    expect(state.stamps[0].colliderDisabled).toBe(true);

    // Step 2 (dt = 0.01): advancing into recovering stamp does not cause repeat damage
    state = advanceFredRun(state, 0.01);
    expect(state.phase).toBe("running");

    // Step 3 (dt = 0.01): continues running safely
    state = advanceFredRun(state, 0.01);
    expect(state.phase).toBe("running");
  });

  it("proves complete safe action trajectory for stamp strike at low, mid, and high speeds", () => {
    for (const speed of [300, 540, 900]) {
      const score = ((speed - 300) / 120) * FREDRUN_SCORE_PULSE_POINTS;
      let state = startFredRun(createFredRunState("finanzamt-night"));
      state = {
        ...state,
        speed,
        score,
        distance: score * 34,
        stamps: [{
          id: 100,
          x: 450,
          width: FREDRUN_STAMP_WIDTH,
          height: FREDRUN_STAMP_HEIGHT,
          phase: "anticipation",
          timer: 0.5,
          y: FREDRUN_STAMP_HEAD_REST_Y,
          anticipationDuration: 0.2,
          descendDuration: 0.16,
          impactDuration: 0.55,
          recoverDuration: 0.50,
          behavior: "strike",
        }],
        spawnDistance: 10_000,
      };

      state = advanceUntil(state, (next) => {
        const stamp = next.stamps.find((candidate) => candidate.id === 100);
        expect(stamp).toBeDefined();
        return stamp?.phase !== "impact";
      }, `stamp strike ${speed} impact`);
      expect(state.stamps.find((stamp) => stamp.id === 100)?.y).toBe(FREDRUN_STAMP_HEAD_IMPACT_Y);

      state = advanceUntil(state, (next) => {
        const stamp = next.stamps.find((candidate) => candidate.id === 100);
        expect(stamp).toBeDefined();
        return (stamp?.x ?? -Infinity) - FREDRUN_PLAYER_X > Math.max(120, speed * 0.40);
      }, `stamp strike ${speed} approach`);
      state = jumpFredRun(state);
      expect(state.grounded).toBe(false);

      state = advanceUntil(state, (next) => {
        const stamp = next.stamps.find((candidate) => candidate.id === 100);
        expect(stamp).toBeDefined();
        return (stamp?.x ?? -Infinity) + (stamp?.width ?? 0) > FREDRUN_PLAYER_X - 24;
      }, `stamp strike ${speed} traversal`);
      expect(state.phase).toBe("running");
    }
  });

  it("proves complete safe action trajectory for stamp pass-under at low, mid, and high speeds", () => {
    for (const speed of [300, 540, 900]) {
      const score = ((speed - 300) / 120) * FREDRUN_SCORE_PULSE_POINTS;
      let state = startFredRun(createFredRunState("finanzamt-night"));
      state = {
        ...state,
        speed,
        score,
        distance: score * 34,
        stamps: [{
          id: 200,
          x: 350,
          width: FREDRUN_STAMP_WIDTH,
          height: FREDRUN_STAMP_HEIGHT,
          phase: "anticipation",
          timer: 0,
          y: FREDRUN_STAMP_HEAD_REST_Y,
          anticipationDuration: 1.5,
          descendDuration: 0.16,
          impactDuration: 0.55,
          recoverDuration: 0.50,
          behavior: "pass-under",
        }],
        spawnDistance: 10_000,
      };

      state = advanceUntil(state, (next) => {
        const stamp = next.stamps.find((candidate) => candidate.id === 200);
        expect(stamp).toBeDefined();
        expect(next.grounded).toBe(true);
        return (stamp?.x ?? -Infinity) + (stamp?.width ?? 0) > FREDRUN_PLAYER_X - 24;
      }, `stamp pass-under ${speed} traversal`);
      expect(state.phase).toBe("running");
    }
  });

  it("verifies stamp strike and pass-under failure trajectories are fatal", () => {
    // Failure 1: Running into strike head on ground without jumping
    {
      let state = startFredRun(createFredRunState("finanzamt-night"));
      state = {
        ...state,
        stamps: [{
          id: 301,
          x: 200,
          width: FREDRUN_STAMP_WIDTH,
          height: FREDRUN_STAMP_HEIGHT,
          phase: "impact",
          timer: 0.1,
          y: FREDRUN_STAMP_HEAD_IMPACT_Y,
          anticipationDuration: 0.2,
          descendDuration: 0.16,
          impactDuration: 0.55,
          recoverDuration: 0.50,
          behavior: "strike",
        }],
      };
      for (let step = 0; step < MAX_BEHAVIOR_STEPS && state.phase === "running"; step += 1) {
        state = advanceFredRun(state, 0.02);
      }
      expect(state.phase).toBe("game-over");
    }

    // Failure 2: Jumping into high overhead stamp during pass-under
    {
      let state = startFredRun(createFredRunState("finanzamt-night"));
      state = {
        ...state,
        stamps: [{
          id: 302,
          x: 220,
          width: FREDRUN_STAMP_WIDTH,
          height: FREDRUN_STAMP_HEIGHT,
          phase: "anticipation",
          timer: 0.2,
          y: FREDRUN_STAMP_HEAD_REST_Y,
          anticipationDuration: 1.5,
          descendDuration: 0.16,
          impactDuration: 0.55,
          recoverDuration: 0.50,
          behavior: "pass-under",
        }],
      };
      state = advanceUntil(state, (next) => {
        const stamp = next.stamps.find((candidate) => candidate.id === 302);
        expect(stamp).toBeDefined();
        return (stamp?.x ?? -Infinity) - FREDRUN_PLAYER_X > 30;
      }, "stamp pass-under jump approach");
      state = jumpFredRun(state);
      for (let step = 0; step < MAX_BEHAVIOR_STEPS && state.phase === "running"; step += 1) {
        const stamp = state.stamps.find((candidate) => candidate.id === 302);
        if (!stamp || stamp.x + stamp.width <= FREDRUN_PLAYER_X - 24) break;
        state = advanceFredRun(state, 0.02);
      }
      expect(state.phase).toBe("game-over");
    }
  });
});

describe("Alps platforms and chasms", () => {
  it("allows player to land and run on an elevated stable platform", () => {
    let state = startFredRun(createFredRunState("alps"));
    const platformElevation = FREDRUN_GROUND_Y - FREDRUN_ALPS_PLATFORM_Y; // 70px
    const platform: FredRunPlatform = {
      id: 1,
      x: 50,
      width: 200,
      y: FREDRUN_ALPS_PLATFORM_Y,
      height: 18,
      type: "stable",
      state: "intact",
      crumbleTimer: 0,
      crumbleDuration: FREDRUN_ALPS_CRUMBLE_DURATION,
      playerLanded: false,
    };
    state = {
      ...state,
      grounded: false,
      playerHeight: platformElevation + 1,
      playerVelocity: -50,
      platforms: [platform],
    };
    state = advanceFredRun(state, 0.05);
    expect(state.grounded).toBe(true);
    expect(state.playerHeight).toBe(platformElevation);
  });

  it("allows jumping while standing on a platform to reach higher elevation", () => {
    let state = startFredRun(createFredRunState("alps"));
    const platformElevation = FREDRUN_GROUND_Y - FREDRUN_ALPS_PLATFORM_Y;
    const platform: FredRunPlatform = {
      id: 2,
      x: 50,
      width: 200,
      y: FREDRUN_ALPS_PLATFORM_Y,
      height: 18,
      type: "stable",
      state: "intact",
      crumbleTimer: 0,
      crumbleDuration: FREDRUN_ALPS_CRUMBLE_DURATION,
      playerLanded: false,
    };
    state = {
      ...state,
      grounded: true,
      playerHeight: platformElevation,
      platforms: [platform],
    };
    state = jumpFredRun(state);
    expect(state.grounded).toBe(false);
    expect(state.playerVelocity).toBe(660);
  });

  it("walks off platform edge and falls under gravity", () => {
    let state = startFredRun(createFredRunState("alps"));
    const platformElevation = FREDRUN_GROUND_Y - FREDRUN_ALPS_PLATFORM_Y;
    const platform: FredRunPlatform = {
      id: 3,
      x: -100,
      width: 100,
      y: FREDRUN_ALPS_PLATFORM_Y,
      height: 18,
      type: "stable",
      state: "intact",
      crumbleTimer: 0,
      crumbleDuration: FREDRUN_ALPS_CRUMBLE_DURATION,
      playerLanded: true,
    };
    state = {
      ...state,
      grounded: true,
      playerHeight: platformElevation,
      platforms: [platform],
    };
    state = advanceFredRun(state, 0.05);
    expect(state.grounded).toBe(false);
    state = advanceFredRun(state, 0.05);
    expect(state.playerHeight).toBeLessThan(platformElevation);
  });

  it("triggers crumble timer on landing, maintains support, then collapses and removes support", () => {
    let state = startFredRun(createFredRunState("alps"));
    const platformElevation = FREDRUN_GROUND_Y - FREDRUN_ALPS_PLATFORM_Y;
    const platform: FredRunPlatform = {
      id: 4,
      x: 50,
      width: 400,
      y: FREDRUN_ALPS_PLATFORM_Y,
      height: 18,
      type: "crumbling",
      state: "intact",
      crumbleTimer: 0,
      crumbleDuration: FREDRUN_ALPS_CRUMBLE_DURATION,
      playerLanded: false,
    };
    state = {
      ...state,
      grounded: false,
      playerHeight: platformElevation + 1,
      playerVelocity: -30,
      platforms: [platform],
    };
    state = advanceFredRun(state, 0.05);
    expect(state.grounded).toBe(true);
    expect(state.platforms[0].state).toBe("crumbling");
    expect(state.platforms[0].playerLanded).toBe(true);

    // Advance during crumble duration (0.70s): support remains intact
    for (let i = 0; i < 10; i += 1) {
      state = advanceFredRun(state, 0.05);
      expect(state.grounded).toBe(true);
      expect(state.platforms[0].state).toBe("crumbling");
    }

    // Advance past crumbleDuration (0.70s) -> collapses
    for (let i = 0; i < 6; i += 1) {
      state = advanceFredRun(state, 0.05);
    }
    expect(state.platforms[0].state).toBe("collapsed");
    expect(state.grounded).toBe(false);
  });

  it("chasm prevents ground catch; falling past fatal depth causes game-over", () => {
    let state = startFredRun(createFredRunState("alps"));
    const chasm: FredRunChasm = {
      id: 1,
      x: 50,
      width: 200,
    };
    state = {
      ...state,
      grounded: false,
      playerHeight: 2,
      playerVelocity: -100,
      chasms: [chasm],
    };
    state = advanceFredRun(state, 0.05);
    expect(state.grounded).toBe(false);
    expect(state.fallingThroughChasm).toBe(true);
    expect(state.playerHeight).toBeLessThan(0);

    for (let step = 0; step < MAX_BEHAVIOR_STEPS && state.playerHeight > FREDRUN_ALPS_FATAL_FALL_DEPTH && state.phase === "running"; step += 1) {
      state = advanceFredRun(state, 0.05);
    }
    expect(state.phase).toBe("game-over");
  });

  it("shield does not save player from fatal fall into chasm", () => {
    let state = startFredRun(createFredRunState("alps"));
    const chasm: FredRunChasm = {
      id: 2,
      x: 50,
      width: 200,
    };
    state = {
      ...state,
      shieldActive: true,
      shieldRemaining: 5,
      grounded: false,
      fallingThroughChasm: true,
      playerHeight: FREDRUN_ALPS_FATAL_FALL_DEPTH - 1,
      chasms: [chasm],
    };
    state = advanceFredRun(state, 0.05);
    expect(state.phase).toBe("game-over");
  });

  it("landing on solid ground outside chasm safely catches the player", () => {
    let state = startFredRun(createFredRunState("alps"));
    const chasm: FredRunChasm = {
      id: 3,
      x: 250,
      width: 150,
    };
    state = {
      ...state,
      grounded: false,
      playerHeight: 5,
      playerVelocity: -200,
      chasms: [chasm],
    };
    state = advanceFredRun(state, 0.05);
    expect(state.grounded).toBe(true);
    expect(state.playerHeight).toBe(0);
    expect(state.phase).toBe("running");
  });

  it("reproduces issue 1 fix: grounded player at ground elevation stepping into chasm tests chasm support and falls", () => {
    let state = startFredRun(createFredRunState("alps"));
    state = {
      ...state,
      chasms: [{ id: 1, x: 100, width: 300 }],
    };
    const advanced = advanceFredRun(state, 0.05);
    expect(advanced.grounded).toBe(false);
    expect(advanced.fallingThroughChasm).toBe(true);
    expect(advanced.playerHeight).toBeLessThanOrEqual(0);
    expect(advanced.phase).toBe("running");

    let current = advanced;
    for (let step = 0; step < MAX_BEHAVIOR_STEPS && current.phase === "running" && current.playerHeight > FREDRUN_ALPS_FATAL_FALL_DEPTH; step += 1) {
      current = advanceFredRun(current, 0.05);
    }
    expect(current.phase).toBe("game-over");
  });

  it("prevents failed falls from teleporting onto ground when chasm scrolls past", () => {
    let state = startFredRun(createFredRunState("alps"));
    state = {
      ...state,
      grounded: false,
      fallingThroughChasm: true,
      playerHeight: -15,
      playerVelocity: -80,
      chasms: [{ id: 1, x: 80, width: 60 }],
    };

    let current = state;
    for (let step = 0; step < MAX_BEHAVIOR_STEPS && current.chasms.some((chasm) => chasm.id === 1 && chasm.x + chasm.width >= FREDRUN_PLAYER_X); step += 1) {
      current = advanceFredRun(current, 0.02);
      expect(current.grounded).toBe(false);
      expect(current.playerHeight).toBeLessThan(0);
    }

    expect(current.grounded).toBe(false);
    expect(current.fallingThroughChasm).toBe(true);
    expect(current.playerHeight).toBeLessThan(0);

    for (let step = 0; step < MAX_BEHAVIOR_STEPS && current.phase === "running"; step += 1) {
      current = advanceFredRun(current, 0.02);
    }
    expect(current.phase).toBe("game-over");
  });

  it("proves actual generated-encounter no-jump failure on Alps chasm", () => {
    let state = startFredRun(createFredRunState("alps"));
    state = {
      ...state,
      chasms: [{ id: 10, x: 300, width: 200 }],
      spawnDistance: 10_000,
    };

    for (let step = 0; step < MAX_BEHAVIOR_STEPS && state.phase === "running"; step += 1) {
      state = advanceFredRun(state, 0.02);
    }
    expect(state.phase).toBe("game-over");
    expect(state.fallingThroughChasm).toBe(true);
  });

  it("proves actual generated-encounter successful jump traversal over Alps chasm", () => {
    let state = startFredRun(createFredRunState("alps"));
    state = {
      ...state,
      chasms: [{ id: 11, x: 320, width: 160 }],
      spawnDistance: 10_000,
    };

    state = advanceUntil(state, (next) => {
      const chasm = next.chasms.find((candidate) => candidate.id === 11);
      expect(chasm).toBeDefined();
      return (chasm?.x ?? -Infinity) - FREDRUN_PLAYER_X > 40;
    }, "Alps successful traversal approach");
    state = jumpFredRun(state);
    expect(state.grounded).toBe(false);

    state = advanceUntil(state, (next) => !next.grounded, "Alps successful traversal landing");

    expect(state.grounded).toBe(true);
    expect(state.playerHeight).toBe(0);
    expect(state.fallingThroughChasm).toBe(false);
    expect(state.phase).toBe("running");
  });

  it("enforces crumble-triggered forced onward movement on platforms at speed >= 420", () => {
    const speed = 492;
    const platWidth = 418;
    const chasmWidth = 388;

    // Trajectory A: Passive runner (fails to jump onward, platform collapses, fatal fall)
    {
      const trajAPlatWidth = 600;
      const trajAChasmWidth = 1_000;
      let state = startFredRun(createFredRunState("alps"));
      state = {
        ...state,
        speed,
        score: 400,
        distance: 400 * 34,
        platforms: [{
          id: 50,
          x: 180,
          width: trajAPlatWidth,
          y: FREDRUN_ALPS_PLATFORM_Y,
          height: 18,
          type: "crumbling",
          state: "intact",
          crumbleTimer: 0,
          crumbleDuration: FREDRUN_ALPS_CRUMBLE_DURATION,
          playerLanded: false,
        }],
        chasms: [{ id: 51, x: 190, width: trajAChasmWidth }],
        spawnDistance: 10_000,
      };

      state = jumpFredRun(state);
      state = advanceUntil(state, (next) => !next.grounded, "crumbling platform landing");
      expect(state.grounded).toBe(true);
      expect(state.playerHeight).toBe(FREDRUN_GROUND_Y - FREDRUN_ALPS_PLATFORM_Y);
      expect(state.platforms.find((platform) => platform.id === 50)?.state).toBe("crumbling");

      for (let step = 0; step < MAX_BEHAVIOR_STEPS && state.phase === "running" && state.platforms.some((platform) => platform.id === 50 && platform.state === "crumbling"); step += 1) {
        state = advanceFredRun(state, 0.02);
      }

      expect(state.platforms.find((platform) => platform.id === 50)?.state).toBe("collapsed");
      expect(state.grounded).toBe(false);

      for (let step = 0; step < MAX_BEHAVIOR_STEPS && state.phase === "running"; step += 1) {
        state = advanceFredRun(state, 0.02);
      }
      expect(state.phase).toBe("game-over");
      expect(state.fallingThroughChasm).toBe(true);
    }

    // Trajectory B: Active runner (makes forced onward jump before collapse, lands safely)
    {
      let state = startFredRun(createFredRunState("alps"));
      state = {
        ...state,
        speed,
        score: 400,
        distance: 400 * 34,
        platforms: [{
          id: 60,
          x: 180,
          width: platWidth,
          y: FREDRUN_ALPS_PLATFORM_Y,
          height: 18,
          type: "crumbling",
          state: "intact",
          crumbleTimer: 0,
          crumbleDuration: FREDRUN_ALPS_CRUMBLE_DURATION,
          playerLanded: false,
        }],
        chasms: [{ id: 61, x: 190, width: chasmWidth }],
        spawnDistance: 10_000,
      };

      state = jumpFredRun(state);
      state = advanceUntil(state, (next) => !next.grounded, "active crumbling platform landing");
      expect(state.grounded).toBe(true);

      for (let i = 0; i < 3; i += 1) {
        state = advanceFredRun(state, 0.02);
        expect(state.grounded).toBe(true);
      }

      state = jumpFredRun(state);
      expect(state.grounded).toBe(false);

      state = advanceUntil(state, (next) => !next.grounded, "active crumbling platform onward jump");

      expect(state.grounded).toBe(true);
      expect(state.playerHeight).toBe(0);
      expect(state.phase).toBe("running");
    }
  });

  it("continues advancing collapsed platform crumbleTimer for falling rubble animation", () => {
    let state = startFredRun(createFredRunState("alps"));
    state = {
      ...state,
      platforms: [{
        id: 70,
        x: 100,
        width: 300,
        y: FREDRUN_ALPS_PLATFORM_Y,
        height: 18,
        type: "crumbling",
        state: "crumbling",
        crumbleTimer: 0.65,
        crumbleDuration: FREDRUN_ALPS_CRUMBLE_DURATION,
        playerLanded: true,
      }],
      spawnDistance: 10_000,
    };

    // Advance 0.10s (two 0.05s steps, respecting 0.05s delta clamp)
    state = advanceFredRun(state, 0.05);
    state = advanceFredRun(state, 0.05);
    expect(state.platforms[0].state).toBe("collapsed");
    expect(state.platforms[0].crumbleTimer).toBeCloseTo(0.75, 2);

    // Advance 0.20s (four 0.05s steps)
    state = advanceFredRun(state, 0.05);
    state = advanceFredRun(state, 0.05);
    state = advanceFredRun(state, 0.05);
    state = advanceFredRun(state, 0.05);
    expect(state.platforms[0].state).toBe("collapsed");
    expect(state.platforms[0].crumbleTimer).toBeCloseTo(0.95, 2);
  });
});

describe("World state lifecycle and reset", () => {
  it("initializes and resets with correct worldId and clean state", () => {
    const vienna = createFredRunState("vienna");
    expect(vienna.worldId).toBe("vienna");
    expect(vienna.stamps).toEqual([]);
    expect(vienna.platforms).toEqual([]);
    expect(vienna.chasms).toEqual([]);

    const alps = restartFredRun("alps");
    expect(alps.worldId).toBe("alps");
    expect(alps.stamps).toEqual([]);
    expect(alps.platforms).toEqual([]);

    const finanzamt = restartFredRun("finanzamt-night");
    expect(finanzamt.worldId).toBe("finanzamt-night");
  });

  it("freezes platforms and stamps during pause and countdown", () => {
    let state = startFredRun(createFredRunState("alps"));
    const platform: FredRunPlatform = {
      id: 5,
      x: 200,
      width: 100,
      y: FREDRUN_ALPS_PLATFORM_Y,
      height: 18,
      type: "crumbling",
      state: "crumbling",
      crumbleTimer: 0.2,
      crumbleDuration: FREDRUN_ALPS_CRUMBLE_DURATION,
      playerLanded: true,
    };
    state = { ...state, platforms: [platform] };

    const paused = pauseFredRun(state);
    const advancedPaused = advanceFredRun(paused, 0.1);
    expect(advancedPaused.platforms[0].x).toBe(200);
    expect(advancedPaused.platforms[0].crumbleTimer).toBe(0.2);

    const resuming = resumeFredRun(paused);
    const advancedResuming = advanceFredRun(resuming, 0.05);
    expect(advancedResuming.platforms[0].x).toBe(200);
    expect(advancedResuming.platforms[0].crumbleTimer).toBe(0.2);
  });
});

function seededRandom(seed: number): () => number {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

function lightningRun(speed = 300): FredRunState {
  const distance = (speed - 300) / 120 * 250 * 34;
  return startFredRun({ ...createFredRunState("vienna"), distance, score: Math.floor(distance / 34), speed });
}

function evadeGeneratedHazards(state: FredRunState): FredRunState {
  if (!state.grounded) return state;
  const playerRight = FREDRUN_PLAYER_X + 24;
  const obstacleDue = state.obstacles.some((obstacle) => {
    const multiplier = obstacle.kind === "odo" ? 1.18 : obstacle.kind === "madinger" ? 1.12 : obstacle.kind === "luki" ? 1.15 : 1;
    const arrival = (obstacle.x + 4 - playerRight) / (state.speed * multiplier);
    return obstacle.x + obstacle.width > FREDRUN_PLAYER_X - 24 && arrival <= 0.23;
  });
  const lightningDue = state.lightning.some((hazard) => (
    !hazard.absorbed && hazard.x + FREDRUN_LIGHTNING_WIDTH > FREDRUN_PLAYER_X - 24
    && (hazard.x - playerRight) / state.speed <= 0.3
  ));
  const event = state.urbanEvent;
  const stormDue = event?.phase === "action" && URBAN_PATTERNS[event.variant].releases.some((_, i) => {
    const b = urbanPackage(event, i);
    return b.age >= 0.7 && b.x > FREDRUN_PLAYER_X && (b.x - FREDRUN_PLAYER_X) / event.speed <= 0.36;
  });
  return obstacleDue || lightningDue || stormDue ? jumpFredRun(state) : state;
}

describe("Vienna original scheduling and jumpable lightning", () => {
  it("matches the pre-feature obstacleFor/nextGap with the same stream across all kinds and score tiers", () => {
    for (const score of [0, 400, 1200, 3000, 8000]) {
      for (const roll of [-1, 0, 0.125, 0.25, 0.375, 0.5, 0.7, 0.9, 1]) {
        const values = [roll, 0.37];
        let consumed = 0;
        const random = () => values[consumed++];
        const state = { ...lightningRun(fredRunSpeedForScore(score)), spawnDistance: 0 };
        const next = advanceFredRun(state, 0.01, random, () => 0);
        expect(consumed).toBe(2);
        expect(next.obstacles[0]).toEqual(originalObstacleFor(() => roll, 1));
        expect(next.spawnDistance).toBe(originalNextGap(next.speed, Math.floor(next.distance / 34), () => 0.37));
      }
    }
  });

  it("retains the original generated order and gaps through a surviving run with lightning and collectibles", () => {
    const random = seededRandom(17);
    let state = lightningRun();
    let scheduled = 0;
    const kinds = new Set<string>();
    const hazards = new Set<number>();
    // Include the authorized storm pause and resume while preserving every
    // original obstacle kind/gap assertion against the historical fixture.
    const eventPhases = new Set<string>();
    let resumedSpawns = 0;
    for (let step = 0; step < 2600; step += 1) {
      state = evadeGeneratedHazards(state);
      const before = state;
      const rolls: number[] = [];
      state = advanceFredRun(state, 0.02, () => { const value = random(); rolls.push(value); return value; }, () => 0, () => { throw Error("Alpine RNG"); }, () => 0);
      eventPhases.add(state.urbanEvent!.phase);
      expect(state.phase, `step ${step}`).toBe("running");
      expect(state.shieldImpactRemaining).toBe(0);
      expect(state.lightning.every((hazard) => !hazard.absorbed)).toBe(true);
      if (state.nextObstacleId > before.nextObstacleId) {
        const obstacle = state.obstacles.find((candidate) => candidate.id === before.nextObstacleId);
        expect(obstacle).toEqual(originalObstacleFor(() => rolls[0], before.nextObstacleId));
        const score = Math.max(before.score, Math.floor(state.distance / 34) + before.coinsCollected * FREDRUN_COIN_SCORE + before.nearMissScore);
        expect(state.spawnDistance).toBe(originalNextGap(state.speed, score, () => rolls[1]));
        kinds.add(obstacle!.kind);
        scheduled += 1;
        if (eventPhases.has("recovery")) resumedSpawns++;
      }
      state.lightning.forEach((hazard) => hazards.add(hazard.id));
    }
    expect(eventPhases).toEqual(new Set(["quiet", "clearance", "anticipation", "action", "recovery"]));
    expect(resumedSpawns).toBeGreaterThan(2);
    expect(scheduled).toBeGreaterThan(15);
    expect(kinds.size).toBe(7);
    expect(hazards.size).toBeGreaterThan(1);
    expect(state.nextCoinId).toBeGreaterThan(1);
    expect(state.nextPowerUpId).toBeGreaterThan(1);
  });

  for (const speed of [300, 540, 900]) {
    for (const delta of [0.01, 0.02, 0.05]) {
      it(`traverses a generated encounter and following old obstacles at ${speed} px/s, dt=${delta}`, () => {
        const random = seededRandom(12);
        let state = lightningRun(speed);
        const seen = new Set<number>();
        let jumped = false;
        let crossed = false;
        for (let step = 0; step < Math.ceil(6 / delta); step += 1) {
          // Fresh lookup on every step: never wait on a stale hazard object.
          const hazard = state.lightning.find((candidate) => candidate.id === 1);
          if (hazard) {
            seen.add(hazard.id);
            if (hazard.x + FREDRUN_LIGHTNING_WIDTH < FREDRUN_PLAYER_X - 24) crossed = true;
          }
          const next = evadeGeneratedHazards(state);
          if (hazard && next !== state) jumped = true;
          state = advanceFredRun(next, delta, random, () => 0);
          expect(state.phase, `step ${step}`).toBe("running");
          expect(state.shieldImpactRemaining).toBe(0);
          expect(state.lightning.every((candidate) => !candidate.absorbed)).toBe(true);
        }
        expect(seen.size).toBeGreaterThan(0);
        expect(jumped).toBe(true);
        expect(crossed).toBe(true);
        expect(state.nextObstacleId).toBeGreaterThan(2);
      });
    }
  }

  it("shows the first warning within a bounded wait for every initial random extreme", () => {
    const appearances: number[] = [];
    for (const roll of [0, 0.5, 1]) {
      let state = lightningRun();
      for (let step = 0; step < 20 && state.lightning.length === 0; step += 1) {
        state = advanceFredRun(state, 0.01, () => 0.5, () => roll);
        expect(state.phase).toBe("running");
      }
      expect(state.lightning).toHaveLength(1);
      expect(state.elapsed).toBeLessThanOrEqual(0.17);
      expect(state.lightning[0].age).toBe(0);
      appearances.push(state.elapsed);
    }
    expect(new Set(appearances).size).toBe(3);
  });

  it("warns before damage and kills a grounded player who takes no action", () => {
    for (const speed of [300, 540, 900]) {
      let state = lightningRun(speed);
      let warningSteps = 0;
      for (let step = 0; step < 150 && state.phase === "running"; step += 1) {
        state = advanceFredRun(state, 0.01, () => 0.5, () => 0);
        const hazard = state.lightning.find((candidate) => candidate.id === 1);
        if (hazard && hazard.age < FREDRUN_LIGHTNING_WARNING_SECONDS) {
          warningSteps += 1;
          expect(state.phase).toBe("running");
        }
      }
      expect(warningSteps).toBeGreaterThanOrEqual(29);
      expect(state.phase).toBe("game-over");
      expect(state.lightning.find((candidate) => candidate.id === 1)?.age).toBeGreaterThan(FREDRUN_LIGHTNING_WARNING_SECONDS);
      expect(state.obstacles.every((obstacle) => obstacle.x > FREDRUN_PLAYER_X + 24)).toBe(true);
    }
  });

  it("absorbs one entire generated strike with a shield, including later overlapping frames", () => {
    let state = { ...lightningRun(), shieldActive: true };
    let absorbedFrames = 0;
    for (let step = 0; step < 135; step += 1) {
      state = advanceFredRun(state, 0.01, () => 0.5, () => 0);
      const hazard = state.lightning.find((candidate) => candidate.id === 1);
      if (hazard?.absorbed) {
        absorbedFrames += 1;
        expect(state.shieldActive).toBe(false);
      }
      expect(state.phase).toBe("running");
    }
    expect(absorbedFrames).toBeGreaterThan(20);
    expect(state.lightning).toEqual([]);
  });

  it("never damages during warning or after expiry, including swept boundary steps", () => {
    const base = { ...lightningRun(), lightningWait: 10 };
    const hazard = { id: 1, x: FREDRUN_PLAYER_X, age: 0, absorbed: false };
    expect(advanceFredRun({ ...base, lightning: [hazard] }, 0.05).phase).toBe("running");
    expect(advanceFredRun({ ...base, lightning: [{ ...hazard, age: 1.16 }] }, 0.05).phase).toBe("running");
    expect(advanceFredRun({ ...base, lightning: [{ ...hazard, age: 1.14 }] }, 0.05).phase).toBe("game-over");
    expect(advanceFredRun({ ...base, lightning: [{ ...hazard, age: 0.29 }] }, 0.05).phase).toBe("game-over");
  });

  it("defers for airborne commitment, neighboring obstacles, and an unsafe future spawn without rescheduling obstacles", () => {
    const cases = [
      jumpFredRun(lightningRun()),
      { ...lightningRun(), obstacles: [{ id: 99, kind: "odo" as const, x: 400, width: 38, height: 78 }] },
      { ...lightningRun(900), spawnDistance: 0 },
      lightningRun(1600),
    ];
    for (const initial of cases) {
      const next = advanceFredRun({ ...initial, lightningWait: 0 }, 0.01, () => 0, () => 0);
      expect(next.lightning).toEqual([]);
      if (initial.spawnDistance === 0) {
        expect(next.obstacles[0]).toEqual(originalObstacleFor(() => 0, 1));
        expect(next.spawnDistance).toBe(originalNextGap(next.speed, Math.floor(next.distance / 34), () => 0));
      } else {
        expect(next.spawnDistance).toBeCloseTo(initial.spawnDistance - initial.speed * 0.01);
      }
    }
  });

  it("does not add lightning or consume its random stream in other worlds", () => {
    for (const worldId of ["alps", "finanzamt-night"] as const) {
      let state = startFredRun(createFredRunState(worldId));
      let frames = 0;
      for (let step = 0; step < 400 && state.phase === "running"; step += 1) {
        state = advanceFredRun(evadeGeneratedHazards(state), 0.02, () => 0.9, () => { throw new Error("unexpected lightning RNG"); });
        expect(state.lightning).toEqual([]);
        expect(state.lightningWait).toBeNull();
        frames += 1;
      }
      expect(frames).toBe(400);
      expect(state.nextObstacleId).toBeGreaterThan(2);
    }
  });

  it("freezes warning, active discharge and waiting timers during pause/countdown; reset and world switch clear them", () => {
    let state = lightningRun();
    for (let step = 0; step < 12; step += 1) state = advanceFredRun(state, 0.01, () => 0.5, () => 0);
    expect(state.lightning).toHaveLength(1);
    for (const age of [0.1, 0.4]) {
      const active = { ...state, lightning: state.lightning.map((hazard) => ({ ...hazard, age })) };
      const paused = pauseFredRun(active);
      expect(advanceFredRun(paused, 0.05)).toBe(paused);
      let countdown = resumeFredRun(paused);
      for (let step = 0; step < 60; step += 1) {
        countdown = advanceFredRun(countdown, 0.05);
        expect(countdown.lightning).toEqual(active.lightning);
        expect(countdown.lightningWait).toBe(active.lightningWait);
        expect(countdown.elapsed).toBe(active.elapsed);
      }
      expect(countdown.phase).toBe("running");
      expect(advanceFredRun(countdown, 0.01).lightning[0].age).toBeCloseTo(age + 0.01);
    }
    for (const worldId of ["vienna", "alps", "finanzamt-night"] as const) {
      expect(restartFredRun(worldId)).toMatchObject({ worldId, lightning: [], lightningWait: null, nextLightningId: 1 });
    }
  });
});
