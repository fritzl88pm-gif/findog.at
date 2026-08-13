import { describe, expect, it } from "vitest";

import {
  FREDRUN_HIGH_SCORE_KEY,
  advanceFredRun,
  createFredRunState,
  fredRunEnvironmentForDistance,
  fredRunSpeedForDistance,
  fredRunSpeedForScore,
  jumpFredRun,
  pauseFredRun,
  readFredRunHighScore,
  restartFredRun,
  resumeFredRun,
  startFredRun,
  writeFredRunHighScore,
} from "./fredrun";

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

  it("jumps, rejects a double jump, and lands again", () => {
    const running = startFredRun(createFredRunState());
    const jumping = jumpFredRun(running);
    expect(jumping.grounded).toBe(false);
    expect(jumpFredRun(jumping)).toBe(jumping);

    let landed = jumping;
    let peakHeight = 0;
    let airTime = 0;
    while (!landed.grounded && airTime < 2) {
      landed = advanceFredRun(landed, 1 / 120, () => 0.5);
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

  it("spawns only ground obstacles with a positive following distance", () => {
    let state = startFredRun(createFredRunState());
    for (let index = 0; index < 320; index += 1) {
      state = advanceFredRun(state, 0.05, () => 0);
      if (state.phase === "game-over") {
        state = { ...state, phase: "running", obstacles: [] };
      }
    }
    expect(state.nextObstacleId).toBeGreaterThan(2);
    expect(state.spawnDistance).toBeGreaterThan(0);
  });

  it("keeps at least 1.2 real-time seconds between spawns at unbounded speed", () => {
    const distance = 8_000 * 34;
    const state = startFredRun({
      ...createFredRunState(),
      distance,
      score: 8_000,
      speed: fredRunSpeedForDistance(distance),
      spawnDistance: 0,
    });
    const advanced = advanceFredRun(state, 1 / 120, () => 0);
    expect(advanced.speed).toBeGreaterThan(4_000);
    expect(advanced.spawnDistance / advanced.speed).toBeCloseTo(1.2, 5);
  });

  it("spawns both animated opponents and keeps all collision boxes jumpable", () => {
    const cases = [
      { roll: 0, kind: "odo", width: 38, height: 78 },
      { roll: 0.125, kind: "madinger", width: 42, height: 82 },
      { roll: 0.25, kind: "jqa", width: 42, height: 84 },
      { roll: 0.375, kind: "reihe100", width: 56, height: 60 },
      { roll: 0.6, kind: "steuerkodex", width: 45, height: 70 },
      { roll: 0.85, kind: "paragraph", width: 42, height: 68 },
    ] as const;

    for (const expected of cases) {
      const state = startFredRun({ ...createFredRunState(), spawnDistance: 0 });
      const advanced = advanceFredRun(state, 1 / 120, () => expected.roll);
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

  it("pauses and resumes the same continuous run", () => {
    const running = advanceFredRun(startFredRun(createFredRunState()), 0.05);
    const paused = pauseFredRun(running);
    expect(paused.phase).toBe("paused");
    expect(advanceFredRun(paused, 1)).toBe(paused);
    expect(resumeFredRun(paused)).toEqual({ ...paused, phase: "running" });
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
