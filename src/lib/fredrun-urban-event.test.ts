import { describe, expect, it } from "vitest";
import { advanceFredRun, createFredRunState, startFredRun } from "./fredrun";

describe("urban event clearance", () => {
  it("schedules an independent rare event only in urban worlds", () => {
    for (const world of ["vienna", "finanzamt-night"] as const) {
      const state = advanceFredRun(startFredRun(createFredRunState(world)), 0.05, () => 0.9, () => 0.5, () => { throw Error("Alpine RNG"); }, () => 0);
      expect(state.urbanEvent).toMatchObject({ phase: "quiet", timer: 19.95 });
      expect(state.rockfall).toBeNull();
    }
  });
});

import { fredRunSpeedForDistance, jumpFredRun, pauseFredRun, restartFredRun, resumeFredRun, type FredRunState } from "./fredrun";
import { URBAN_PATTERNS, URBAN_FALL_TIME, urbanPackage, urbanHitsPlayer, type FredRunUrbanEvent } from "./fredrun-urban-event";
const quiet = (kind: FredRunUrbanEvent["kind"] = "stormfront"): FredRunUrbanEvent => ({ kind, phase: "quiet", timer: 0, speed: 360, variant: 0, absorbed: 0 });
it("starts every filefall release at its transformed top stack or emptied drawer", () => {
  for (const variant of [0, 1, 2]) {
    URBAN_PATTERNS[variant].releases.forEach((release, index) => {
      // Actual cabinet pivot, tilt and file centers; independent of trajectory helpers.
      const angle = index === 0 ? -0.13 : -0.23;
      const [localX, localY] = [[-47.5, -216], [-82, -185], [-75, -143]][index];
      const x = 922 + localX * Math.cos(angle) - localY * Math.sin(angle);
      const y = 293 + localX * Math.sin(angle) + localY * Math.cos(angle);
      const event = { ...quiet("filefall"), phase: "action" as const, variant };
      const first = urbanPackage(event, index, release);
      expect.soft(first.x, `variant ${variant} group ${index} source X`).toBeCloseTo(x, 10);
      expect.soft(first.y, `variant ${variant} group ${index} source Y`).toBeCloseTo(y, 10);
      const next = urbanPackage(event, index, release + 1e-6);
      expect.soft(Math.hypot(next.x - x, next.y - y)).toBeLessThan(0.001);
      for (let sample = 0; sample < 70; sample++) {
        const a = urbanPackage(event, index, release + sample / 100);
        const b = urbanPackage(event, index, release + (sample + 1) / 100);
        expect(a.x).toBeGreaterThan(606);
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(7);
      }
    });
  }
});
it("preserves Vienna flight and both worlds' settled geometry and bounce", () => {
  expect(URBAN_FALL_TIME).toBe(0.7);
  expect(URBAN_PATTERNS.map(p => [...p.releases])).toEqual([[0, 1.55], [0, 1.5, 3], [0, 1.7, 3.4]]);
  for (const variant of [0, 1, 2]) for (const speed of [360, 580]) {
    URBAN_PATTERNS[variant].releases.forEach((release, index) => {
      for (const kind of ["stormfront", "filefall"] as const) for (const age of [0, 0.1, 0.35, 0.699, 0.7, 0.71, 0.82, 0.94, 1.4, 2]) {
        if (kind === "filefall" && age < 0.7) continue;
        const event = { ...quiet(kind), phase: "action" as const, variant, speed };
        const p = urbanPackage(event, index, release + age);
        const elapsed = release + age - release, fall = elapsed / 0.7;
        const settled = Math.max(0, elapsed - 0.7);
        const height = URBAN_PATTERNS[variant].heights[index];
        expect(p.width).toBe(URBAN_PATTERNS[variant].widths[index]);
        expect(p.height).toBe(height);
        expect(p.x).toBeCloseTo(elapsed < 0.7 ? 814 + (606 - 814) * fall : 606 - speed * settled, 10);
        expect(p.y).toBeCloseTo(elapsed < 0.7 ? 108 + (300 - height - 108) * fall * fall : 300 - height - (settled < 0.24 ? Math.sin(settled / 0.24 * Math.PI) * 7 : 0), 10);
        expect(p.rotation).toBeCloseTo(elapsed < 0.7 ? -0.28 * Math.sin(fall * Math.PI) : 0, 10);
      }
    });
  }
});
function run(world: "vienna" | "finanzamt-night", speed = 300): FredRunState {
  return { ...startFredRun(createFredRunState(world)), distance: (speed - 300) / 120 * 250 * 34, speed,
    spawnDistance: 1e8, coinSpawnDistance: 1e8, powerUpSpawnDistance: 1e8, lightningWait: 1e8,
    urbanEvent: quiet(world === "vienna" ? "stormfront" : "filefall") };
}
const step = (s: FredRunState, dt = 0.05, variant = 0) => advanceFredRun(s, dt, () => 0.9, () => 0.5, () => { throw Error("Alpine RNG"); }, () => (variant + 0.1) / 3);
function steer(s: FredRunState, lead = 0.36) {
  const e = s.urbanEvent!;
  return e.phase === "action" && s.grounded && URBAN_PATTERNS[e.variant].releases.some((_, i) => {
    const b = urbanPackage(e, i); return b.age >= URBAN_FALL_TIME && b.x > 132 && (b.x - 132) / e.speed <= lead;
  }) ? jumpFredRun(s) : s;
}
function play(world: "vienna" | "finanzamt-night", speed: number, dt: number, variant: number, lead = 0.36) {
  let s = run(world, speed), jumps = 0; const phases = new Set<string>();
  for (let i = 0; i < 1600; i++) {
    phases.add(s.urbanEvent!.phase);
    const next = steer(s, lead); if (next !== s) jumps++; s = step(next, dt, variant);
    expect(s.phase, `${world}/${speed}/${dt}/${variant}/${s.urbanEvent?.phase}/${s.urbanEvent?.timer}`).toBe("running");
    if (s.urbanEvent?.phase === "quiet" && phases.has("recovery")) return { s, jumps, phases };
  }
  throw Error("No recovery");
}
it("completes each whole variant using only jumps, with clean landings and late-speed frame caps", () => {
  for (const world of ["vienna", "finanzamt-night"] as const) for (const speed of [300, 950, 1740, 5000, 20000]) {
    for (const dt of [1 / 60, 0.05, 0.5]) for (const variant of [0, 1, 2]) {
      const result = play(world, speed, dt, variant);
      expect(result.jumps).toBe(URBAN_PATTERNS[variant].releases.length);
      expect(result.s.grounded).toBe(true); expect(result.s.shieldActive).toBe(false);
      expect(result.s.speed).toBe(fredRunSpeedForDistance(result.s.distance));
      expect([...result.phases]).toEqual(["quiet", "clearance", "anticipation", "action", "recovery"]);
    }
    for (const lead of [0.30, 0.42]) for (const variant of [0, 1, 2]) play(world, speed, 0.05, variant, lead);
  }
});
it("punishes no-jump for every world/variant/speed and dt and absorbs the first visible group once", () => {
  for (const world of ["vienna", "finanzamt-night"] as const) for (const speed of [300, 950, 5000]) for (const dt of [1 / 60, 0.05]) for (const variant of [0, 1, 2]) {
    let s = run(world, speed);
    for (let i = 0; i < 500 && s.phase === "running"; i++) s = step(s, dt, variant);
    expect(s.phase).toBe("game-over");
    let shielded = run(world, speed); shielded.shieldActive = true;
    for (let i = 0; i < 500 && shielded.shieldActive; i++) shielded = step(shielded, dt, variant);
    expect(shielded).toMatchObject({ phase: "running", shieldActive: false, urbanEvent: { absorbed: 1 } });
    for (let i = 0; i < 10; i++) shielded = step(shielded, dt, variant);
    expect(shielded.phase).toBe("running"); expect(shielded.urbanEvent!.absorbed).toBe(1);
  }
});
it("sweeps between endpoints, retains immunity and lands airborne objects well ahead", () => {
  const event = { ...quiet(), phase: "action" as const, speed: 580 };
  expect(urbanHitsPlayer(event, 0, 1.35, 1.65, 0, 0)).toBe(true);
  expect(urbanHitsPlayer(event, 0, 1.35, 1.65, 120, 120)).toBe(false);
  expect(urbanHitsPlayer({ ...event, absorbed: 1 }, 0, 1.35, 1.65, 0, 0)).toBe(false);
  for (let t = 0; t < URBAN_FALL_TIME; t += 0.01) expect(urbanPackage(event, 0, t).x).toBeGreaterThan(606);
  const s = step({ ...run("vienna"), shieldImpactRemaining: 0.4, urbanEvent: { ...event, timer: 1.45 } });
  expect(s).toMatchObject({ phase: "running", urbanEvent: { absorbed: 1 } });
});
it("waits for queued lightning, stamps, cabinets, terrain, rewards and airborne players without deleting threats", () => {
  const platform = { id: 1, x: 600, width: 200, y: 230, height: 18, type: "stable" as const, state: "intact" as const, crumbleTimer: 0, crumbleDuration: 0.7, playerLanded: false };
  const stamp = { id: 1, x: 850, width: 54, height: 64, phase: "anticipation" as const, timer: 0, y: 46, anticipationDuration: 0.5, descendDuration: 0.16, impactDuration: 0.55, recoverDuration: 0.5, behavior: "strike" as const };
  for (const world of ["vienna", "finanzamt-night"] as const) {
    const cases: Partial<FredRunState>[] = [
      { obstacles: [{ id: 1, kind: "reihe100", x: 800, width: 56, height: 60 }] },
      { stamps: [stamp] }, { platforms: [platform] }, { chasms: [{ id: 1, x: 600, width: 200 }] },
      { coins: [{ id: 1, x: 700, y: 150, radius: 12 }] }, { powerUps: [{ id: 1, kind: "shield", x: 700, y: 150, radius: 12 }] },
      { grounded: false, playerHeight: 80, playerVelocity: 0 },
    ];
    if (world === "vienna") cases.push({ lightning: [{ id: 1, x: 800, age: 0, absorbed: false }] });
    for (const existing of cases) {
      const s = { ...run(world), ...existing, spawnDistance: 0, coinSpawnDistance: 0, powerUpSpawnDistance: 0, lightningWait: 0 };
      let next = step(s); next = step(next);
      expect(next.urbanEvent?.phase).toBe("clearance");
      for (const key of ["nextObstacleId", "nextStampId", "nextCoinId", "nextPowerUpId", "nextLightningId"] as const) expect(next[key]).toBe(s[key]);
      for (const key of ["obstacles", "stamps", "platforms", "chasms", "lightning", "coins", "powerUps"] as const) expect(next[key].length).toBe(s[key].length);
    }
  }
  let s: FredRunState = { ...run("vienna"), lightning: [{ id: 1, x: 800, age: 0, absorbed: false }], lightningWait: 0 };
  for (let i = 0; i < 30; i++) s = step(s);
  expect(s.urbanEvent?.phase).toBe("anticipation"); expect(s.lightning).toEqual([]); expect(s.nextLightningId).toBe(1);
});
it("freezes pause/countdown and restarts cleanly in every phase", () => {
  for (const world of ["vienna", "finanzamt-night"] as const) for (const phase of ["quiet", "clearance", "anticipation", "action", "recovery"] as const) {
    const s = { ...run(world), urbanEvent: { ...quiet(), phase, timer: 0.4 } };
    const paused = pauseFredRun(s); expect(step(paused)).toBe(paused);
    let resumed = resumeFredRun(paused);
    for (let i = 0; i < 60; i++) { resumed = step(resumed); expect(resumed.urbanEvent).toEqual(s.urbanEvent); }
    expect(resumed.phase).toBe("running"); expect(step(resumed).urbanEvent).not.toEqual(s.urbanEvent);
    expect(restartFredRun(world)).toMatchObject({ urbanEvent: null, rockfall: null, phase: "ready" });
  }
  expect(advanceFredRun(startFredRun(createFredRunState("alps")), 0.05, () => 0.9, () => 0.5, () => 0.5, () => { throw Error("Urban RNG"); }).urbanEvent).toBeNull();
});
it("plays ordinary spawning before and after each event, with full recovery and reserved resumption space", () => {
  for (const world of ["vienna", "finanzamt-night"] as const) {
    let s = startFredRun(createFredRunState(world)); let warningAt = 0, recoveredAt = 0, resumedAt = 0, before = 0, after = 0;
    for (let frame = 0; frame < 2200; frame++) {
      if (s.grounded) {
        const ordinary = s.obstacles.some(o => o.x + o.width > 108 && (o.x - 156) / s.speed < 0.25);
        const lightning = s.lightning.some(l => !l.absorbed && l.x + 48 > 108 && (l.x - 156) / s.speed < 0.3);
        if (ordinary || lightning) s = jumpFredRun(s); else if (s.urbanEvent) s = steer(s);
      }
      const prev = s; s = advanceFredRun(s, 0.02, () => 0.9, () => 0, () => { throw Error("Alpine RNG"); }, () => 0);
      expect(s.phase, `${world} at ${s.elapsed}`).toBe("running"); expect(s.shieldImpactRemaining).toBe(0);
      if (s.urbanEvent!.phase === "anticipation" && !warningAt) warningAt = s.elapsed;
      if (s.urbanEvent!.phase === "recovery" && !recoveredAt) recoveredAt = s.elapsed;
      if (prev.urbanEvent?.phase === "recovery" && s.urbanEvent!.phase === "quiet") {
        resumedAt = s.elapsed; expect(resumedAt - recoveredAt).toBeGreaterThanOrEqual(2.99);
        expect(s.spawnDistance).toBeGreaterThan(s.speed); expect(s.urbanEvent!.timer).toBeGreaterThanOrEqual(28);
      }
      if (s.nextObstacleId > prev.nextObstacleId) { if (warningAt) { after++; expect(s.elapsed - resumedAt).toBeGreaterThan(1); } else before++; }
      if (s.urbanEvent!.phase !== "quiet") {
        expect(s.nextObstacleId).toBe(prev.nextObstacleId); expect(s.nextStampId).toBe(prev.nextStampId); expect(s.nextLightningId).toBe(prev.nextLightningId);
        if (s.urbanEvent!.phase !== "clearance") expect(s.lightning).toHaveLength(0);
      }
    }
    expect(warningAt).toBeGreaterThanOrEqual(20); expect(warningAt).toBeLessThan(25);
    expect(before).toBeGreaterThan(5); expect(after).toBeGreaterThan(2);
  }
});
it("keeps due spawn clocks frozen throughout the event and chooses repeat delays/variants from its own stream", () => {
  for (const world of ["vienna", "finanzamt-night"] as const) for (const phase of ["clearance", "anticipation", "action", "recovery"] as const) {
    const s = { ...run(world), urbanEvent: { ...quiet(), phase, timer: 0 }, spawnDistance: 0, coinSpawnDistance: 0, powerUpSpawnDistance: 0, lightningWait: 0 };
    const next = step(s);
    expect([next.spawnDistance, next.coinSpawnDistance, next.powerUpSpawnDistance, next.lightningWait]).toEqual([0, 0, 0, 0]);
    expect([next.obstacles, next.stamps, next.coins, next.powerUps, next.lightning]).toEqual([[], [], [], [], []]);
  }
  const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  function sequence(seed: number) {
    const rng = seeded(seed), values = [];
    const tick = (s: FredRunState) => advanceFredRun(s, 0.05, () => { throw Error("Ordinary RNG"); }, () => { throw Error("Lightning RNG"); }, () => { throw Error("Alpine RNG"); }, rng);
    for (let i = 0; i < 20; i++) {
      const initial = tick({ ...run("vienna"), urbanEvent: null });
      const warning = tick({ ...initial, urbanEvent: { ...initial.urbanEvent!, phase: "clearance" } });
      const repeat = tick({ ...warning, urbanEvent: { ...warning.urbanEvent!, phase: "recovery", timer: 2.99 } });
      expect(initial.urbanEvent!.timer).toBeGreaterThanOrEqual(19.95); expect(initial.urbanEvent!.timer).toBeLessThan(30);
      expect(repeat.urbanEvent!.timer).toBeGreaterThanOrEqual(28); expect(repeat.urbanEvent!.timer).toBeLessThan(44);
      values.push([initial.urbanEvent!.timer, warning.urbanEvent!.variant, repeat.urbanEvent!.timer]);
    }
    return values;
  }
  expect(sequence(42)).toEqual(sequence(42)); expect(sequence(42)).not.toEqual(sequence(43));
  expect(new Set(sequence(42).map(v => v[1])).size).toBe(3);
});
it("does not collide with the empty upper corners of a debris silhouette during a low jump", () => {
  for (const world of ["vienna", "finanzamt-night"] as const) {
    const s = { ...run(world), grounded: false, playerHeight: 20, playerVelocity: 0,
      urbanEvent: { ...quiet(world === "vienna" ? "stormfront" : "filefall"), phase: "action" as const, timer: 0.7 + (606 - 180) / 360 } };
    expect(step(s, 0.001).phase).toBe("running");
  }
});
