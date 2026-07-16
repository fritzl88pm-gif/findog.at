import { describe, expect, it } from "vitest";

import {
  FREDRUN_HIGH_SCORE_KEY,
  FREDRUN_MILESTONE_DURATION,
  advanceFredRun,
  createFredRunState,
  jumpFredRun,
  pauseFredRun,
  readFredRunHighScore,
  restartFredRun,
  resumeFredRun,
  startFredRun,
  writeFredRunHighScore,
} from "./fredrun";

function advanceFor(seconds: number, initial = startFredRun(createFredRunState())) {
  let state = initial;
  for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 120) {
    state = advanceFredRun(state, 1 / 120, () => 0.5);
  }
  return state;
}

describe("Fredrun simulation", () => {
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

  it("spawns only ground obstacles with a safe following distance", () => {
    let state = startFredRun(createFredRunState());
    for (let index = 0; index < 320; index += 1) {
      state = advanceFredRun(state, 0.05, () => 0);
      if (state.phase === "game-over") {
        state = { ...state, phase: "running", obstacles: [] };
      }
    }
    expect(state.nextObstacleId).toBeGreaterThan(2);
    expect(state.spawnDistance).toBeGreaterThan(0);
    expect(state.spawnDistance).toBeLessThanOrEqual(470);
  });

  it("spawns Odo occasionally and keeps all collision boxes jumpable", () => {
    const cases = [
      { roll: 0, kind: "odo", width: 38, height: 78 },
      { roll: 0.125, kind: "reihe100", width: 56, height: 60 },
      { roll: 0.42, kind: "steuerkodex", width: 45, height: 70 },
      { roll: 0.71, kind: "paragraph", width: 42, height: 68 },
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

  it("celebrates every 250 points, clears danger, and resumes one level faster", () => {
    const nearMilestone = startFredRun({
      ...createFredRunState(),
      distance: 249 * 34 + 33,
      score: 249,
      spawnDistance: 10_000,
      obstacles: [{ id: 1, kind: "steuerkodex", x: 800, width: 45, height: 70 }],
    });
    const milestone = advanceFredRun(nearMilestone, 0.01, () => 0.5);
    expect(milestone.phase).toBe("milestone");
    expect(milestone.score).toBe(250);
    expect(milestone.obstacles).toEqual([]);
    expect(milestone.milestoneRemaining).toBe(FREDRUN_MILESTONE_DURATION);

    const resumed = advanceFor(FREDRUN_MILESTONE_DURATION + 0.1, milestone);
    expect(resumed.phase).toBe("running");
    expect(resumed.level).toBe(2);
    expect(resumed.speed).toBe(336);
    expect(resumed.spawnDistance).toBeGreaterThan(450);
  });

  it("pauses and resumes the exact active phase", () => {
    const running = startFredRun(createFredRunState());
    const paused = pauseFredRun(running);
    expect(paused.phase).toBe("paused");
    expect(advanceFredRun(paused, 1)).toBe(paused);
    expect(resumeFredRun(paused).phase).toBe("running");
  });
});

describe("Fredrun local high score", () => {
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
