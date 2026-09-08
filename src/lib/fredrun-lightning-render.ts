import {
  FREDRUN_GROUND_Y,
  FREDRUN_LIGHTNING_ACTIVE_SECONDS,
  FREDRUN_LIGHTNING_HEIGHT,
  FREDRUN_LIGHTNING_WARNING_SECONDS,
  FREDRUN_LIGHTNING_WIDTH,
  FREDRUN_PLAYER_X,
  type FredRunLightning,
} from "./fredrun";

type Point = readonly [number, number];

export function drawFredRunLightning(
  context: CanvasRenderingContext2D,
  hazard: FredRunLightning,
  reducedMotion: boolean,
): void {
  const warning = hazard.age < FREDRUN_LIGHTNING_WARNING_SECONDS;
  const elapsed = Math.max(0, hazard.age - FREDRUN_LIGHTNING_WARNING_SECONDS);
  const remaining = Math.max(0, 1 - elapsed / FREDRUN_LIGHTNING_ACTIVE_SECONDS);
  if (hazard.age >= FREDRUN_LIGHTNING_WARNING_SECONDS + FREDRUN_LIGHTNING_ACTIVE_SECONDS) return;

  const center = hazard.x + FREDRUN_LIGHTNING_WIDTH / 2;
  const ground = FREDRUN_GROUND_Y;
  // Stable per-hazard geometry; animation depends only on simulation age.
  const noise = (index: number) => {
    let seed = Math.imul(hazard.id + 1, 374761393) ^ Math.imul(index + 1, 668265263);
    seed = Math.imul(seed ^ (seed >>> 13), 1274126177);
    return ((seed ^ (seed >>> 16)) >>> 0) / 4294967295;
  };
  const motion = reducedMotion || hazard.absorbed ? 0 : Math.sin(hazard.age * 32) * 1.2;
  const strength = hazard.absorbed
    ? 0.24 * remaining
    : warning ? 0.78 : Math.min(1, remaining / 0.12) * (reducedMotion ? 1 : 0.65 + 0.35 * remaining);

  context.save();
  context.globalAlpha *= strength;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.shadowBlur = 0;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 0;

  const arc = (points: readonly Point[], width: number) => {
    context.beginPath();
    context.moveTo(...points[0]);
    for (const point of points.slice(1)) context.lineTo(...point);
    // A narrow dark edge gives the same electrical shape contrast on pale ground.
    context.strokeStyle = "#163e50";
    context.lineWidth = width + 2.2;
    context.stroke();
    context.strokeStyle = "#62dfff";
    context.lineWidth = width + 0.9;
    context.shadowColor = "#36cfff";
    context.shadowBlur = warning ? 5 : 8;
    context.stroke();
    context.shadowBlur = 0;
    context.strokeStyle = "#edfdff";
    context.lineWidth = width;
    context.stroke();
  };

  // Low, irregular arcs span the real collider, rising to its full height when active.
  const discharge: Point[] = [];
  for (let index = 0; index <= 8; index += 1) {
    const height = warning
      ? 3 + noise(index) * 5
      : index === 4 ? FREDRUN_LIGHTNING_HEIGHT
        : index % 2 ? 9 + noise(index) * 9 + motion : 3 + noise(index) * 4;
    discharge.push([hazard.x + index * FREDRUN_LIGHTNING_WIDTH / 8, ground - height]);
  }
  arc(discharge, warning ? 0.8 : 1.3);

  // Short branching veins settle into the ground, without outlining a hazard box.
  for (let index = 0; index < 3; index += 1) {
    const root = discharge[2 + index * 2];
    const direction = index === 1 ? 1 : -1;
    arc([
      root,
      [root[0] + direction * (3 + noise(12 + index) * 4), ground - 2],
      [root[0] - direction * 2, ground + 1 + noise(16 + index) * 2],
      [root[0] + direction * (5 + noise(20 + index) * 4), ground + 4 + noise(24 + index) * 3],
    ], warning ? 0.45 : 0.65);
  }

  // Only the short ground discharge collides. Keep the brief decorative strike ahead.
  const tallBolt = !warning && !hazard.absorbed && !reducedMotion
    && elapsed < 0.12 && hazard.x > FREDRUN_PLAYER_X + 64;
  if (tallBolt) {
    const bolt: Point[] = [];
    for (let index = 0; index <= 9; index += 1) {
      bolt.push([
        index === 9 ? center : center + (noise(30 + index) - 0.5) * 31,
        8 + (ground - 8) * index / 9,
      ]);
    }
    for (const index of [3, 6]) {
      const root = bolt[index];
      const direction = index === 3 ? -1 : 1;
      arc([
        root,
        [root[0] + direction * 14, root[1] + 13],
        [root[0] + direction * 9, root[1] + 22],
        [root[0] + direction * (26 + noise(45 + index) * 12), root[1] + 39],
      ], 0.65);
    }
    arc(bolt, 1.8);
  }

  // Sparse, short-lived sparks; reduced motion and absorption retain only static arcs.
  if (!warning && !hazard.absorbed && !reducedMotion && elapsed < 0.48) {
    for (let index = 0; index < 3; index += 1) {
      const life = elapsed / 0.48;
      const x = hazard.x + 7 + noise(50 + index) * (FREDRUN_LIGHTNING_WIDTH - 14)
        + (noise(54 + index) - 0.5) * life * 14;
      const y = ground - 5 - Math.sin(life * Math.PI) * (8 + noise(58 + index) * 17);
      context.save();
      context.globalAlpha *= 1 - life;
      arc([[x, y], [x + (noise(62 + index) - 0.5) * 3, y - 2]], 0.7);
      context.restore();
    }
  }
  context.restore();
}
