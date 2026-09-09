import { describe, expect, it } from "vitest";
import { advanceFredRun, createFredRunState, fredRunSpeedForDistance, jumpFredRun, pauseFredRun, restartFredRun, resumeFredRun, startFredRun, type FredRunState } from "./fredrun";
import { ROCKFALL_PATTERNS, ROCKFALL_ANTICIPATION, ROCKFALL_RECOVERY, rockfallBoulder, rockfallHitsPlayer, type FredRunRockfall } from "./fredrun-rockfall";
import { drawFredRunRockfall } from "./fredrun-rockfall-render";

const quiet = (timer = 0): FredRunRockfall => ({ phase: "quiet", timer, speed: 360, variant: 0, absorbed: 0 });
function run(speed = 300): FredRunState {
  const distance = (speed - 300) / 0.48 * 34;
  return { ...startFredRun(createFredRunState("alps")), distance, score: Math.floor(distance / 34), speed,
    spawnDistance: 1e6, coinSpawnDistance: 1e6, powerUpSpawnDistance: 1e6, rockfall: quiet() };
}
function seeded(seed: number) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32); }
const step = (s: FredRunState, dt = 0.05, variant = 0) => advanceFredRun(s, dt, () => 0.9, () => 0.5, () => (variant + 0.1) / 3);

function play(speed: number, dt: number, variant: number, lead = 0.36) {
  let state = run(speed), jumps = 0, maxRocks = 0;
  const phases = new Set<string>();
  for (let frame = 0; frame < 1200; frame++) {
    const event = state.rockfall!;
    phases.add(event.phase);
    if (event.phase === "action") {
      const approaching = ROCKFALL_PATTERNS[event.variant].releases.map((_, i) => rockfallBoulder(event, i))
        .filter(b => b.age >= 0 && b.x > 132);
      maxRocks = Math.max(maxRocks, approaching.length);
      if (state.grounded && approaching.some(b => (b.x - 132) / event.speed <= lead)) { state = jumpFredRun(state); jumps++; }
    }
    state = step(state, dt, variant);
    expect(state.phase, `speed=${speed} dt=${dt} variant=${variant} phase=${state.rockfall?.phase} t=${state.rockfall?.timer}`).toBe("running");
    if (state.rockfall?.phase === "quiet" && phases.has("recovery")) return { state, jumps, phases, maxRocks };
  }
  throw Error("event failed to recover");
}

describe("Alpine rockfall runtime", () => {
  it("starts rarely, then waits for a landed player and complete existing hazard/collectible clearance", () => {
    const initial = startFredRun(createFredRunState("alps"));
    const first = step(initial);
    expect(first.rockfall!.timer).toBeGreaterThan(17);
    const platform = { id: 1, x: 600, width: 300, y: 230, height: 18, type: "stable" as const, state: "intact" as const, crumbleTimer: 0, crumbleDuration: 0.7, playerLanded: false };
    const cases: Partial<FredRunState>[] = [
      { obstacles: [{ id: 1, kind: "odo", x: 900, width: 38, height: 78 }] },
      { platforms: [platform] }, { chasms: [{ id: 1, x: 800, width: 300 }] },
      { coins: [{ id: 1, x: 700, y: 150, radius: 12 }] },
      { powerUps: [{ id: 1, kind: "magnet", x: 700, y: 150, radius: 12 }] },
      { grounded: false, playerHeight: 80, playerVelocity: 100 },
    ];
    for (const existing of cases) {
      const state = { ...run(), ...existing, rockfall: { ...quiet(), phase: "clearance" as const }, spawnDistance: 0, coinSpawnDistance: 0, powerUpSpawnDistance: 0 };
      const next = step(state);
      expect(next.rockfall?.phase).toBe("clearance");
      expect(next.nextObstacleId).toBe(state.nextObstacleId);
      expect(next.nextPlatformId).toBe(state.nextPlatformId);
      expect(next.nextCoinId).toBe(state.nextCoinId);
      expect(next.nextPowerUpId).toBe(state.nextPowerUpId);
    }
    let cleared = { ...run(), rockfall: { ...quiet(), phase: "clearance" as const }, obstacles: [{ id: 1, kind: "odo" as const, x: 30, width: 38, height: 78 }] };
    cleared = step(cleared) as typeof cleared;
    expect(cleared.rockfall.phase).toBe("anticipation");
  });

  it("advances harmless anticipation, action, recovery, then a full cooldown with clean ordinary resumption", () => {
    let state = step(step(run()));
    expect(state.rockfall?.phase).toBe("anticipation");
    for (let i = 0; i < 30; i++) state = step(state);
    expect(state.rockfall?.phase).toBe("anticipation");
    expect(state.rockfall?.timer).toBeCloseTo(1.5);
    const result = play(300, 0.05, 1);
    expect([...result.phases]).toEqual(["quiet", "clearance", "anticipation", "action", "recovery"]);
    expect(result.jumps).toBe(3);
    expect(result.state.rockfall?.timer).toBeGreaterThanOrEqual(22);
    state = { ...result.state, spawnDistance: 0, coinSpawnDistance: 0, powerUpSpawnDistance: 0 };
    state = step(state);
    expect(state.obstacles.length).toBe(1);
    expect(state.coins.length).toBeGreaterThan(0);
    // Existing collectible clearance may defer the power-up behind the coin formation.
    for (let i = 0; i < 20 && state.powerUps.length === 0; i++) state = step(state);
    expect(state.powerUps.length).toBeGreaterThan(0);
    expect(state.rockfall?.phase).toBe("quiet");
    expect(state.speed).toBe(fredRunSpeedForDistance(state.distance));
  });

  it("keeps the whole cooldown quiet and drains an existing encounter before anticipation", () => {
    let state = play(300, 0.05, 0).state;
    const cooldown = state.rockfall!.timer;
    for (let i = 0; i < Math.floor((cooldown - 0.1) / 0.05); i++) {
      state = step(state);
      expect(state.rockfall?.phase).toBe("quiet");
    }
    state = { ...run(), rockfall: { ...quiet(), phase: "clearance" },
      obstacles: [{ id: 9, kind: "reihe100", x: 240, width: 56, height: 60 }] };
    state = jumpFredRun(state);
    let clearanceFrames = 0;
    for (let i = 0; i < 100 && state.rockfall?.phase === "clearance"; i++) {
      state = step(state); clearanceFrames++;
      expect(state.phase).toBe("running");
    }
    expect(clearanceFrames).toBeGreaterThan(15);
    expect(state).toMatchObject({ grounded: true, playerHeight: 0, rockfall: { phase: "anticipation" } });
    expect(state.obstacles.every(o => o.x + o.width < 72)).toBe(true);
  });

  it("freezes spawning clocks through anticipation/action/recovery without deleting existing rewards", () => {
    for (const phase of ["anticipation", "action", "recovery"] as const) {
      const state = { ...run(), rockfall: { ...quiet(), phase }, spawnDistance: 0, coinSpawnDistance: 0, powerUpSpawnDistance: 0 };
      const next = step(state);
      expect([next.obstacles, next.platforms, next.chasms, next.coins, next.powerUps]).toEqual([[], [], [], [], []]);
      expect([next.spawnDistance, next.coinSpawnDistance, next.powerUpSpawnDistance]).toEqual([0, 0, 0]);
    }
  });

  it("replays seeded event timing and variants independently of the ordinary RNG", () => {
    function sequence(seed: number) {
      const rng = seeded(seed); let state = run(); const events = [];
      for (let i = 0; i < 12; i++) {
        state = advanceFredRun({ ...state, rockfall: null }, 0.05, () => { throw Error("ordinary RNG"); }, () => 0, rng);
        const wait = state.rockfall!.timer;
        state = advanceFredRun({ ...state, rockfall: { ...quiet(), phase: "clearance" } }, 0.05, () => { throw Error("ordinary RNG"); }, () => 0, rng);
        events.push([wait, state.rockfall!.variant]);
      }
      return events;
    }
    expect(sequence(42)).toEqual(sequence(42));
    expect(sequence(42)).not.toEqual(sequence(43));
    expect(new Set(sequence(42).map(e => e[1])).size).toBe(3);
    expect(new Set(sequence(42).map(e => e[0])).size).toBeGreaterThan(1);
  });

  it("offers ordinary jumps with timing tolerance across event speed bounds and capped large frames", () => {
    for (const speed of [300, 600, 950, 1740, 5000, 20000]) {
      for (const dt of [1 / 60, 0.05, 0.5]) for (const variant of [0, 1, 2]) {
        const result = play(speed, dt, variant);
        expect(result.jumps).toBe(ROCKFALL_PATTERNS[variant].releases.length);
        expect(result.state.shieldActive).toBe(false);
      }
    }
    for (const lead of [0.3, 0.42]) for (const variant of [0, 1, 2]) play(950, 0.05, variant, lead);
  });

  it("makes visible boulder contact fatal and consumes a shield once, removing only that rock", () => {
    const event: FredRunRockfall = { phase: "action", timer: (854 - 150) / 360, speed: 360, variant: 0, absorbed: 0 };
    const state = { ...run(), rockfall: event };
    expect(step(state).phase).toBe("game-over");
    const shielded = step({ ...state, shieldActive: true });
    expect(shielded).toMatchObject({ phase: "running", shieldActive: false, rockfall: { absorbed: 1 } });
    expect(step(shielded).phase).toBe("running");
    expect(step({ ...state, playerHeight: 110, grounded: false, playerVelocity: 0 }).phase).toBe("running");
  });

  it("sweeps contact between endpoints, respects the rounded silhouette corners, and keeps trajectories immutable", () => {
    const event: FredRunRockfall = { ...quiet(), phase: "action", speed: 580 };
    expect(rockfallHitsPlayer(event, 0, 1.12, 1.4, 0, 0)).toBe(true);
    expect(rockfallHitsPlayer(event, 0, 1.12, 1.4, 130, 130)).toBe(false);
    expect(rockfallHitsPlayer(event, 0, -0.05, 0, 0, 0)).toBe(false);
    const radius = 26 * 0.8;
    const cornerTime = (854 - (156 + radius * 0.75)) / 580;
    const b = rockfallBoulder(event, 0, cornerTime);
    const cornerHeight = 296 - b.y + radius * 0.75;
    // Both axes overlap the core's bounding square, but the rounded corner misses.
    expect(rockfallHitsPlayer(event, 0, cornerTime, cornerTime + 0.0001, cornerHeight, cornerHeight)).toBe(false);
    const state = { ...run(5000), rockfall: { ...event, timer: 0.8 } };
    expect(step(state).rockfall!.speed).toBe(580);
    expect(rockfallBoulder(event, 0, 0.65).y).toBe(274);
    expect(rockfallBoulder(event, 0, 0.89).y).toBeCloseTo(244);
  });

  it("freezes every lifecycle on pause/countdown/game over and resets on restart", () => {
    for (const phase of ["quiet", "clearance", "anticipation", "action", "recovery"] as const) {
      const state = { ...run(), rockfall: { ...quiet(0.4), phase } };
      const paused = pauseFredRun(state);
      expect(step(paused)).toBe(paused);
      let countdown = resumeFredRun(paused);
      for (let i = 0; i < 60; i++) { countdown = step(countdown); expect(countdown.rockfall).toEqual(state.rockfall); }
      expect(countdown.phase).toBe("running");
      const dead = { ...state, phase: "game-over" as const };
      expect(step(dead)).toBe(dead);
    }
    expect(restartFredRun("alps")).toMatchObject({ phase: "ready", rockfall: null });
  });

  it("leaves Vienna and Finanzamt simulation and RNG untouched", () => {
    for (const world of ["vienna", "finanzamt-night"] as const) {
      const state = { ...run(), worldId: world, rockfall: null };
      const next = advanceFredRun(state, 0.05, () => 0.9, () => 0.5, () => { throw Error("Alpine RNG outside Alps"); });
      expect(next.rockfall).toBeNull();
    }
  });
});

// A strict canvas recorder: browsers silently ignore invalid alpha assignments,
// so reject them at assignment time as well as recording the effective draw state.
function canvasRecorder(initialAlpha = 1) {
  const ops: unknown[][] = [];
  let properties: Record<string, unknown> = { globalAlpha: initialAlpha, fillStyle: "#000000", strokeStyle: "#000000", lineWidth: 1, lineCap: "butt", lineJoin: "miter" };
  const stack: Record<string, unknown>[] = [];
  function alpha(value: unknown) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw Error(`Invalid canvas alpha: ${value}`);
  }
  function color(value: unknown) {
    if (typeof value === "string" && value.startsWith("rgba(")) alpha(Number(value.slice(value.lastIndexOf(",") + 1, -1)));
  }
  const methods: Record<string, (...args: unknown[]) => unknown> = {
    save() { stack.push({ ...properties }); },
    restore() {
      if (!stack.length) throw Error("Unbalanced restore");
      properties = stack.pop()!;
    },
    createLinearGradient() {
      const gradient = { stops: [] as [number, string][] };
      // CanvasGradient methods are non-enumerable; compare recorded colors,
      // not closure identities when comparing independent static frames.
      return Object.defineProperty(gradient, "addColorStop", { value(offset: number, value: string) {
        alpha(offset); color(value); gradient.stops.push([offset, value]); ops.push(["addColorStop", offset, value]);
      } });
    },
  };
  for (const key of ["beginPath", "moveTo", "lineTo", "closePath", "fill", "stroke", "clip", "ellipse", "translate", "rotate", "scale", "fillRect"]) {
    methods[key] = () => undefined;
  }
  const context = new Proxy({}, {
    get: (_, key: string) => {
      if (key in properties) return properties[key];
      if (!(key in methods)) throw Error(`Untracked canvas property/method: ${key}`);
      return (...args: unknown[]) => {
        if (args.some(v => typeof v === "number" && !Number.isFinite(v))) throw Error(`Nonfinite ${key}`);
        ops.push([key, ...args, ...(["fill", "stroke", "fillRect"].includes(key) ? [{ ...properties }] : [])]);
        return methods[key](...args);
      };
    },
    set: (_, key: string, value: unknown) => {
      if (!(key in properties)) throw Error(`Untracked canvas property: ${key}`);
      if (key === "globalAlpha") alpha(value);
      if (key === "fillStyle" || key === "strokeStyle") color(value);
      if (key === "lineWidth" && (typeof value !== "number" || !Number.isFinite(value) || value <= 0)) throw Error("Invalid line width");
      properties[key] = value; ops.push(["set", key, value]); return true;
    },
  }) as CanvasRenderingContext2D;
  return { context, ops, depth: () => stack.length, properties: () => ({ ...properties }) };
}
function draw(event: FredRunRockfall, reduced: boolean, initialAlpha = 1) {
  const recorder = canvasRecorder(initialAlpha), before = recorder.properties();
  drawFredRunRockfall(recorder.context, event, reduced);
  expect(recorder.depth()).toBe(0);
  expect(recorder.properties()).toEqual(before);
  return recorder.ops;
}

describe("rockfall drawing contract", () => {
  it("retains static source warning and boulder trajectories while disabling decorative particles", () => {
    const event = { ...quiet(), phase: "anticipation" as const, timer: 0 };
    expect(draw(event, true)).toEqual(draw({ ...event, timer: ROCKFALL_ANTICIPATION - 0.1 }, true));
    expect(draw(event, false).length).toBeGreaterThan(draw(event, true).length);
    const action = { ...event, phase: "action" as const, timer: 1.5 };
    for (const key of ["translate", "rotate", "scale"]) {
      expect(draw(action, true).filter(o => o[0] === key)).toEqual(draw(action, false).filter(o => o[0] === key));
    }
  });
  it("keeps a substantial static mobile release and a source connected to the ground", () => {
    const warning = draw({ ...quiet(), phase: "anticipation" }, true);
    const sourceScale = warning.find(o => o[0] === "scale")!;
    expect(2 * (sourceScale[1] as number) * 390 / 960).toBeGreaterThanOrEqual(24);
    // The outcrop path after its gradient spans the release height to the ground.
    const start = warning.findIndex(o => o[0] === "createLinearGradient");
    const end = warning.findIndex((o, i) => i > start && o[0] === "closePath");
    const heights = warning.slice(start, end).filter(o => o[0] === "moveTo" || o[0] === "lineTo").map(o => o[2] as number);
    expect(Math.min(...heights)).toBeLessThan(104);
    expect(Math.max(...heights)).toBeGreaterThanOrEqual(300);
    // Static loosened stones disappear during recovery, not under reduced motion.
    expect(warning.filter(o => o[0] === "translate")).toHaveLength(2);
    expect(draw({ ...quiet(), phase: "recovery" }, true).filter(o => o[0] === "translate")).toHaveLength(0);
  });

  it("rejects invalid opacity writes and models nested property save/restore", () => {
    const { context, properties, depth } = canvasRecorder(0.6);
    for (const value of [NaN, Infinity, -Infinity, -0.01, 1.01]) {
      expect(() => { context.globalAlpha = value; }).toThrow("Invalid canvas alpha");
    }
    expect(() => { context.fillStyle = "rgba(1,2,3,NaN)"; }).toThrow("Invalid canvas alpha");
    const before = properties();
    context.save(); context.globalAlpha *= 0.5; context.fillStyle = "#123456";
    context.save(); context.globalAlpha *= 0.5; context.lineWidth = 4;
    expect(context.globalAlpha).toBeCloseTo(0.15);
    context.restore(); expect(context.globalAlpha).toBeCloseTo(0.3); expect(context.lineWidth).toBe(1);
    expect(context.fillStyle).toBe("#123456");
    context.restore(); expect(properties()).toEqual(before); expect(depth()).toBe(0);
  });

  it("keeps first-frame warning opaque and composes recovery/particle opacity with caller state", () => {
    const alphaWrites = (ops: unknown[][]) => ops.filter(o => o[0] === "set" && o[1] === "globalAlpha").map(o => o[2] as number);
    for (const reduced of [false, true]) {
      for (const timer of [0, 0.03, 0.4, ROCKFALL_ANTICIPATION - 0.001]) {
        const values = alphaWrites(draw({ ...quiet(), phase: "anticipation", timer }, reduced, 0.6));
        expect(values[0]).toBe(0.6);
        expect(values.every(v => v >= 0 && v <= 0.6)).toBe(true);
        if (!reduced) expect(values.some(v => v < 0.6)).toBe(true);
      }
      for (const [timer, expected] of [[0, 0.6], [ROCKFALL_RECOVERY - 0.325, 0.3], [ROCKFALL_RECOVERY, 0], [ROCKFALL_RECOVERY + 0.01, 0]]) {
        const ops = draw({ ...quiet(), phase: "recovery", timer }, reduced, 0.6);
        expect(alphaWrites(ops)[0]).toBeCloseTo(expected);
        const fills = ops.filter(o => o[0] === "fill");
        expect(fills.length).toBeGreaterThan(0);
        for (const fill of fills) expect((fill[1] as { globalAlpha: number }).globalAlpha).toBeCloseTo(expected);
      }
    }
  });

  it("varies geology while keeping all rotating silhouettes inside the original radius and around the collision core", () => {
    const outlines: number[][][] = [], materials: unknown[][][] = [];
    for (const variant of [0, 1, 2]) {
      const event = { ...quiet(), phase: "action" as const, timer: 0.3, variant };
      const ops = draw(event, true);
      // Last stone is the only released boulder at this time, following two source stones.
      const start = ops.findLastIndex(o => o[0] === "scale");
      const end = ops.findIndex((o, i) => i > start && o[0] === "closePath");
      const outline = ops.slice(start, end).filter(o => o[0] === "moveTo" || o[0] === "lineTo").map(o => [o[1] as number, o[2] as number]);
      outlines.push(outline);
      expect(outline.length).toBeGreaterThanOrEqual(6);
      const edges = outline.map((a, i) => {
        const b = outline[(i + 1) % outline.length];
        expect(Math.hypot(...a)).toBeLessThanOrEqual(1);
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const distance = (a[0] * b[1] - a[1] * b[0]) / length;
        expect(distance).toBeGreaterThanOrEqual(0.8);
        return length;
      });
      expect(Math.max(...edges) / Math.min(...edges)).toBeGreaterThan(1.3);
      materials.push(ops.slice(start).filter(o => o[0] === "addColorStop" || o[0] === "moveTo"));
      const b = rockfallBoulder(event, 0);
      expect(ops.filter(o => o[0] === "translate").at(-1)).toEqual(["translate", b.x, b.y]);
      const gradient = ops.slice(start).find(o => o[0] === "createLinearGradient")!;
      // Rotate the light vector back into world space: upper-left at every angle.
      const lx = gradient[1] as number, ly = gradient[2] as number;
      expect(lx * Math.cos(b.rotation) - ly * Math.sin(b.rotation)).toBeCloseTo(Math.cos(-2.2));
      expect(lx * Math.sin(b.rotation) + ly * Math.cos(b.rotation)).toBeCloseTo(Math.sin(-2.2));
      const absorbed = draw({ ...event, absorbed: 1 }, true);
      expect(absorbed.filter(o => o[0] === "translate")).toHaveLength(2);
    }
    expect(new Set(outlines.map(o => JSON.stringify(o))).size).toBe(3);
    expect(new Set(materials.map(o => JSON.stringify(o))).size).toBe(3);
  });

  it("culls expired rocks, draws bounded geometry, and avoids technical labels", () => {
    expect(draw(quiet(), false)).toEqual([]);
    for (const timer of [0, 0.65, 0.9, 1.5, 2.9, 4.5, 6]) {
      const event = { ...quiet(), phase: "action" as const, timer, variant: 1 };
      const ops = draw(event, false);
      expect(ops.length).toBeLessThan(1800);
      expect(ops.some(o => o[0] === "fillText" || o[0] === "strokeRect")).toBe(false);
    }
    expect(draw({ ...quiet(), phase: "action", timer: 20 }, false).filter(o => o[0] === "translate").length).toBe(2); // Only two harmless stones remain at source.
  });
});
