import { FREDRUN_PLAYER_X, type FredRunState } from "./fredrun";

export const URBAN_WARNING = 1.8;
export const URBAN_RECOVERY = 3;
export const URBAN_FALL_TIME = 0.7;
export const URBAN_SOURCE_X = 814;
export const URBAN_IMPACT_X = 606;
// Groups are authored together: all pieces in a group share one jump window.
export const URBAN_PATTERNS = [
  { releases: [0, 1.55], widths: [58, 64], heights: [30, 34] },
  { releases: [0, 1.5, 3], widths: [62, 56, 66], heights: [34, 30, 36] },
  { releases: [0, 1.7, 3.4], widths: [66, 60, 58], heights: [36, 32, 30] },
] as const;
export type FredRunUrbanEvent = {
  kind: "stormfront" | "filefall";
  phase: "quiet" | "clearance" | "anticipation" | "action" | "recovery";
  timer: number;
  speed: number;
  variant: number;
  absorbed: number;
};

// Cabinet-local file centers and the same pivot/tilt used to draw their source.
// Group 0 is the upper top-stack file; groups 1/2 are the middle drawer files.
export function filefallCabinetGeometry(event: FredRunUrbanEvent, reduced = false) {
  const action = event.phase === "action" ? Math.max(0, Math.min(1, event.timer / 0.45)) : event.phase === "recovery" ? 1 : 0;
  const rocking = !reduced && event.phase === "anticipation" ? Math.sin(event.timer * 19) * 0.015 : 0;
  const drawers = Array.from({ length: 4 }, (_, row) => {
    const y = -173 + row * 42;
    const slide = row < 2 ? 15 + action * (27 - row * 7) : 5 + action * 3;
    return { y, slide, source: { x: -40 - slide, y: y - 12 } };
  });
  return { x: 922, y: 293, rotation: -0.13 - action * 0.1 + rocking,
    topSource: { x: -47.5, y: -216 }, drawers };
}

export function filefallReleaseOrigin(event: FredRunUrbanEvent, index: number) {
  // Freeze the transform at this release, not the current airborne frame.
  const cabinet = filefallCabinetGeometry({ ...event, phase: "action", timer: URBAN_PATTERNS[event.variant].releases[index] });
  const source = index === 0 ? cabinet.topSource : cabinet.drawers[index - 1].source;
  const cos = Math.cos(cabinet.rotation), sin = Math.sin(cabinet.rotation);
  return { x: cabinet.x + source.x * cos - source.y * sin,
    y: cabinet.y + source.x * sin + source.y * cos };
}

export function urbanBlocksSpawns(event: FredRunUrbanEvent | null) {
  return event !== null && event.phase !== "quiet";
}
export function advanceUrbanEvent(state: FredRunState, dt: number, random: () => number): FredRunUrbanEvent {
  const roll = () => Math.min(0.999999, Math.max(0, random()));
  const event = state.urbanEvent ?? {
    kind: state.worldId === "vienna" ? "stormfront" : "filefall",
    phase: "quiet", timer: 20 + roll() * 10, speed: 360, variant: 0, absorbed: 0,
  };
  if (event.phase === "quiet") {
    const timer = Math.max(0, event.timer - dt);
    return { ...event, timer, phase: timer === 0 ? "clearance" : "quiet" };
  }
  if (event.phase === "clearance") {
    const cleared = state.grounded && state.playerHeight === 0 && !state.fallingThroughChasm
      && state.lightning.length === 0 && state.stamps.length === 0
      && state.obstacles.every(h => h.x + h.width < FREDRUN_PLAYER_X - 60)
      && state.platforms.every(h => h.x + h.width < FREDRUN_PLAYER_X - 60)
      && state.chasms.every(h => h.x + h.width < FREDRUN_PLAYER_X - 60)
      && state.coins.every(h => h.x + h.radius < FREDRUN_PLAYER_X - 60)
      && state.powerUps.every(h => h.x + h.radius < FREDRUN_PLAYER_X - 60);
    return cleared ? { ...event, phase: "anticipation", timer: 0, variant: Math.floor(roll() * 3),
      speed: Math.min(580, Math.max(360, state.speed * 0.55 + 200)), absorbed: 0 } : event;
  }
  const timer = event.timer + dt;
  if (event.phase === "anticipation") return timer >= URBAN_WARNING ? { ...event, phase: "action", timer: 0 } : { ...event, timer };
  if (event.phase === "action") {
    const releases = URBAN_PATTERNS[event.variant].releases;
    const end = releases[releases.length - 1] + URBAN_FALL_TIME + (URBAN_IMPACT_X + 80) / event.speed;
    return timer >= end ? { ...event, phase: "recovery", timer: 0 } : { ...event, timer };
  }
  return timer >= URBAN_RECOVERY ? { ...event, phase: "quiet", timer: 28 + roll() * 16, absorbed: 0 } : { ...event, timer };
}

// Authoritative geometry: airborne packages stay >=606px, well beyond even
// the player's jump apex. Settled fragments travel at a bounded event speed.
export function urbanPackage(event: FredRunUrbanEvent, index: number, timer = event.timer) {
  const p = URBAN_PATTERNS[event.variant];
  const age = timer - p.releases[index];
  const fall = Math.max(0, Math.min(1, age / URBAN_FALL_TIME));
  const settled = Math.max(0, age - URBAN_FALL_TIME);
  const height = p.heights[index], width = p.widths[index];
  const bounce = settled < 0.24 ? Math.sin(settled / 0.24 * Math.PI) * 7 : 0;
  const source = event.kind === "filefall" ? filefallReleaseOrigin(event, index) : { x: URBAN_SOURCE_X, y: 108 };
  return { age, width, height,
    x: age < URBAN_FALL_TIME ? source.x + (URBAN_IMPACT_X - source.x) * fall : URBAN_IMPACT_X - event.speed * settled,
    y: age < URBAN_FALL_TIME ? source.y + (300 - height - source.y) * fall * fall : 300 - height - bounce,
    rotation: age < URBAN_FALL_TIME ? -0.28 * Math.sin(fall * Math.PI) : 0,
  };
}

// Slab sweep in relative player space, subdividing the curved fall/bounce.
// A narrow upper core and broad lower core follow the stepped aggregate
// silhouette. Empty upper corners and loose paper never become collision area.
export function urbanHitsPlayer(event: FredRunUrbanEvent, index: number, from: number, to: number, previousHeight: number, height: number) {
  const start = Math.max(from, URBAN_PATTERNS[event.variant].releases[index]);
  if (to <= start || event.absorbed & (1 << index)) return false;
  const first = urbanPackage(event, index, start), last = urbanPackage(event, index, to);
  if (last.x - last.width / 2 > 156 || first.x + first.width / 2 < 108) return false;
  const steps = Math.max(1, Math.ceil((to - start) * 240));
  const cores = [
    { halfWidth: first.width * 0.2, top: 8, bottom: first.height - 4 },
    { halfWidth: first.width * 0.4, top: first.height * 0.65, bottom: first.height - 4 },
  ];
  let a = first;
  let ay = a.y + previousHeight + (height - previousHeight) * (start - from) / (to - from);
  for (let i = 1; i <= steps; i++) {
    const t = start + (to - start) * i / steps, b = urbanPackage(event, index, t);
    const by = b.y + previousHeight + (height - previousHeight) * (t - from) / (to - from);
    for (const core of cores) {
      let low = 0, high = 1;
      for (const [position, delta, min, max] of [
        [a.x, b.x - a.x, 108 - core.halfWidth, 156 + core.halfWidth],
        [ay, by - ay, 224 - core.bottom, 296 - core.top],
      ]) {
        if (Math.abs(delta) < 1e-9) {
          if (position < min || position > max) { high = -1; break; }
        } else {
          const t1 = (min - position) / delta, t2 = (max - position) / delta;
          low = Math.max(low, Math.min(t1, t2)); high = Math.min(high, Math.max(t1, t2));
        }
      }
      if (low <= high) return true;
    }
    a = b; ay = by;
  }
  return false;
}
