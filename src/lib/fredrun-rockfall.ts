import { FREDRUN_GROUND_Y, FREDRUN_PLAYER_X, type FredRunState } from "./fredrun";

export const ROCKFALL_ANTICIPATION = 1.6;
export const ROCKFALL_RECOVERY = 2.4;
export const ROCKFALL_SOURCE_X = 854;
export const ROCKFALL_SOURCE_Y = 104;
export const ROCKFALL_PATTERNS = [
  { releases: [0, 1.5], radii: [26, 23] },
  { releases: [0, 1.4, 2.8], radii: [23, 27, 24] },
  { releases: [0, 1.75], radii: [28, 26] },
] as const;

export type FredRunRockfall = {
  phase: "quiet" | "clearance" | "anticipation" | "action" | "recovery";
  timer: number;
  variant: number;
  speed: number;
  absorbed: number; // At most three rocks; shield removes the struck rock visibly.
};

export function rockfallBlocksSpawns(event: FredRunRockfall | null) {
  return event !== null && event.phase !== "quiet";
}

export function advanceRockfall(state: FredRunState, dt: number, random: () => number): FredRunRockfall {
  const roll = () => Math.min(0.999999, Math.max(0, random()));
  const event = state.rockfall ?? { phase: "quiet", timer: 18 + roll() * 12, variant: 0, speed: 360, absorbed: 0 };
  if (event.phase === "quiet") {
    const timer = Math.max(0, event.timer - dt);
    return { ...event, timer, phase: timer === 0 ? "clearance" : "quiet" };
  }
  if (event.phase === "clearance") {
    // Stop scheduling first; let every existing hazard and collectible pass naturally.
    // A landed player and an empty approach avoid forced platform/jump combinations.
    const cleared = state.grounded && state.playerHeight === 0 && !state.fallingThroughChasm
      && [...state.obstacles, ...state.platforms, ...state.chasms].every(h => h.x + h.width < FREDRUN_PLAYER_X - 60)
      && state.stamps.length === 0
      && [...state.coins, ...state.powerUps].every(c => c.x + c.radius < FREDRUN_PLAYER_X - 60);
    return cleared ? {
      phase: "anticipation", timer: 0, variant: Math.floor(roll() * ROCKFALL_PATTERNS.length),
      // Screen-space downhill velocity is locked for the encounter. World speed still grows normally.
      speed: Math.min(580, Math.max(360, state.speed * 0.55 + 200)), absorbed: 0,
    } : event;
  }
  const timer = event.timer + dt;
  if (event.phase === "anticipation") {
    return timer >= ROCKFALL_ANTICIPATION ? { ...event, phase: "action", timer: 0 } : { ...event, timer };
  }
  if (event.phase === "action") {
    const releases = ROCKFALL_PATTERNS[event.variant].releases;
    const exit = releases[releases.length - 1] + (ROCKFALL_SOURCE_X + 60) / event.speed;
    return timer >= exit ? { ...event, phase: "recovery", timer: 0 } : { ...event, timer };
  }
  return timer >= ROCKFALL_RECOVERY
    ? { ...event, phase: "quiet", timer: 22 + roll() * 14, absorbed: 0 }
    : { ...event, timer };
}

// The renderer and collision sweep use this same ballistic fall, low bounce, then roll.
// All impacts happen well to the right of the player, including at maximum event speed.
export function rockfallBoulder(event: FredRunRockfall, index: number, timer = event.timer) {
  const pattern = ROCKFALL_PATTERNS[event.variant];
  const age = timer - pattern.releases[index];
  const radius = pattern.radii[index];
  const floor = FREDRUN_GROUND_Y - radius;
  let y: number;
  if (age < 0.65) y = ROCKFALL_SOURCE_Y + (floor - ROCKFALL_SOURCE_Y) * (Math.max(0, age) / 0.65) ** 2;
  else if (age < 1.13) {
    const t = (age - 0.65) / 0.48;
    y = floor - 30 * 4 * t * (1 - t);
  } else y = floor - 2 * Math.abs(Math.sin((age - 1.13) * 12));
  return { x: ROCKFALL_SOURCE_X - event.speed * age, y, radius, age, rotation: -age * event.speed / radius * 0.65 };
}

// Inscribed circular core: the asymmetric rotating silhouette always encloses it.
// Sweep the relative motion against the player's rounded expanded rectangle. Small
// time slices follow the curved bounce; each slice is swept, not point-sampled.
export function rockfallHitsPlayer(event: FredRunRockfall, index: number, from: number, to: number,
  previousHeight: number, height: number): boolean {
  const start = Math.max(from, ROCKFALL_PATTERNS[event.variant].releases[index]);
  if (to <= start || event.absorbed & (1 << index)) return false;
  const first = rockfallBoulder(event, index, start), last = rockfallBoulder(event, index, to);
  if (last.x - last.radius > FREDRUN_PLAYER_X + 24 || first.x + first.radius < FREDRUN_PLAYER_X - 24) return false;
  const steps = Math.max(1, Math.ceil((to - start) * 240));
  const point = (t: number) => {
    const b = rockfallBoulder(event, index, t);
    return { x: b.x - FREDRUN_PLAYER_X, y: b.y + previousHeight + (height - previousHeight) * ((t - from) / (to - from)) };
  };
  const radius = first.radius * 0.8;
  let a = point(start);
  for (let step = 1; step <= steps; step++) {
    const b = point(start + (to - start) * step / steps);
    // Segment vs rectangle using slab intersection.
    const rect = (left: number, top: number, right: number, bottom: number) => {
      let low = 0, high = 1;
      for (const [p, d, min, max] of [[a.x, b.x - a.x, left, right], [a.y, b.y - a.y, top, bottom]]) {
        if (Math.abs(d) < 1e-9) { if (p < min || p > max) return false; }
        else { const t1 = (min - p) / d, t2 = (max - p) / d; low = Math.max(low, Math.min(t1, t2)); high = Math.min(high, Math.max(t1, t2)); }
      }
      return low <= high;
    };
    if (rect(-24 - radius, 224, 24 + radius, 296) || rect(-24, 224 - radius, 24, 296 + radius)) return true;
    for (const x of [-24, 24]) for (const y of [224, 296]) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      if (Math.hypot(a.x + t * dx - x, a.y + t * dy - y) <= radius) return true;
    }
    a = b;
  }
  return false;
}
