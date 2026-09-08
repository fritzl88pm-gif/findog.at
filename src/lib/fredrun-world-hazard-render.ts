import {
  FREDRUN_GROUND_Y as GROUND, FREDRUN_WORLD_WIDTH, FREDRUN_WORLD_HEIGHT,
  type FredRunStampHazard, type FredRunObstacle, type FredRunPlatform, type FredRunChasm,
} from "./fredrun";

type Point = readonly [number, number];
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const grain = (id: number, i: number) => {
  let seed = Math.imul(id + 13, 374761393) ^ Math.imul(i + 7, 668265263);
  seed = Math.imul(seed ^ (seed >>> 13), 1274126177);
  return ((seed ^ (seed >>> 16)) >>> 0) / 4294967295;
};
function polygon(c: CanvasRenderingContext2D, points: readonly Point[], fill: string | CanvasGradient) {
  c.beginPath(); c.moveTo(...points[0]);
  for (let i = 1; i < points.length; i++) c.lineTo(...points[i]);
  c.closePath(); c.fillStyle = fill; c.fill();
}
function line(c: CanvasRenderingContext2D, points: readonly Point[], color: string, width = 1) {
  c.beginPath(); c.moveTo(...points[0]);
  for (let i = 1; i < points.length; i++) c.lineTo(...points[i]);
  c.strokeStyle = color; c.lineWidth = width; c.stroke();
}
function gradient(c: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, colors: readonly string[]) {
  const g = c.createLinearGradient(x, y, x + dx, y + dy);
  colors.forEach((color, i) => g.addColorStop(i / (colors.length - 1), color));
  return g;
}
function round(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string | CanvasGradient) {
  c.beginPath(); c.roundRect(x, y, w, h, r); c.fillStyle = fill; c.fill();
}
function ellipse(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string | CanvasGradient) {
  c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fillStyle = fill; c.fill();
}

export function drawStampHazard(c: CanvasRenderingContext2D, s: FredRunStampHazard, elapsed: number, reducedMotion: boolean) {
  if (s.x + s.width < 0 || s.x - s.width > FREDRUN_WORLD_WIDTH) return;
  const w = s.width, h = s.height, x = s.x - w / 2, y = s.y;
  const warning = s.phase === "anticipation" && s.behavior === "strike";
  const lit = warning || s.phase === "descending" || s.phase === "impact";
  const load = warning ? clamp(s.timer / s.anticipationDuration) : 0;
  const contact = clamp((y + h - 110) / (GROUND - 110));
  c.save(); c.lineJoin = "round"; c.lineCap = "round";
  // The shadow tightens towards the actual sole as the press descends.
  ellipse(c, s.x + 4, GROUND + 4, w * (0.75 - contact * 0.25), 5 - contact * 2,
    `rgba(2,8,13,${0.16 + contact * 0.4})`);
  if (lit) {
    // Housing lamps illuminate the strike footprint from the first warning frame.
    // Full static intensity in both motion modes: legibility never depends on a pulse.
    const lightY = Math.min(y + h - 8, GROUND - 1);
    polygon(c, [[x + 8, lightY], [x + w - 8, lightY], [x + w + 8, GROUND + 4], [x - 8, GROUND + 4]],
      gradient(c, s.x, lightY, 0, GROUND + 4 - lightY, ["#ffb84008", "#ff8b3028", "#ff923f70"]));
    ellipse(c, s.x, GROUND + 3, w * 0.72, 11, "#ff82334d");
    ellipse(c, s.x, GROUND + 2, w / 2, 6, "#ffae55d9");
    ellipse(c, s.x, GROUND + 1, w * 0.38, 2.5, "#ffe1a6");
  }
  if (s.phase === "impact" || s.phase === "recovering") {
    const fade = s.phase === "impact" ? 1 : 1 - clamp(s.timer / s.recoverDuration);
    c.save(); c.globalAlpha *= fade * 0.75;
    c.translate(s.x, GROUND + 3); c.scale(1, 0.24); c.rotate(-0.07);
    c.strokeStyle = "#b64e46"; c.lineWidth = 2;
    c.strokeRect(-w / 2 + 2, -12, w - 4, 24);
    // Printed ink is part of the floor surface, never floating instruction text.
    c.font = "bold 8px serif"; c.textAlign = "center"; c.fillStyle = "#cf6653";
    c.fillText(s.stampText ?? "GEPRÜFT", 0, 3, w - 9); c.restore();
  }
  // Chrome piston, fixed ceiling socket and compressed spring establish stored force.
  round(c, s.x - 13, -5, 26, 15, 3, "#19272e");
  round(c, s.x - 5, 8, 10, Math.max(1, y + 26), 2,
    gradient(c, s.x - 5, 0, 10, 0, ["#273b45", "#b8cdd0", "#617c87", "#263e4a"]));
  for (let i = 0; i < 5; i++) {
    const sy = y - 16 + i * (warning ? 2.1 : 3);
    line(c, [[s.x - 6, sy], [s.x + 6, sy + 2]], "#829da4", 1.6);
  }
  // All moving solid pieces remain inside the three collision sections in fredrun.ts.
  const squeeze = reducedMotion ? 0 : load * (0.6 + Math.sin(elapsed * 24) * 0.4);
  round(c, x + 4, y + squeeze, w - 8, 18, 8,
    gradient(c, x, y, w, 12, lit ? ["#6a281c", "#f5a54d", "#b74e26", "#482027"] : ["#25161a", "#975344", "#55242a", "#211a22"]));
  line(c, [[x + 12, y + 4], [x + w - 13, y + 4]], lit ? "#ffe4a4" : "#d59d79", 1.5);
  round(c, s.x - 9, y + 15, 18, 20, 4,
    gradient(c, s.x - 9, y, 18, 0, ["#3b2024", "#915345", "#352029"]));
  round(c, s.x - 12, y + 27, 24, 7, 2, "#c1a56e");
  round(c, x, y + 32, w, h - 32, 4, "#12232a");
  round(c, x + 1, y + 33, w - 2, h - 40, 3,
    gradient(c, x, y, w, 0, ["#526b72", "#d0d7c4", "#7f9595", "#304751"]));
  polygon(c, [[x + 3, y + 33], [x + 12, y + 29], [x + w - 10, y + 29], [x + w - 2, y + 33]], "#9eada2");
  line(c, [[x + 4, y + 35], [x + w - 5, y + 35]], "#edf0d4");
  round(c, x + 7, y + 39, w - 14, 10, 2, "#263c43");
  round(c, x + 10, y + 41, w - 20, 5, 1, "#938363");
  for (const bx of [x + 4, x + w - 5]) {
    ellipse(c, bx, y + 42, 1.6, 1.6, "#dbe1cc");
    line(c, [[bx - 0.7, y + 42], [bx + 0.7, y + 42]], "#36444a");
  }
  // Two recessed amber lenses occupy the sole's existing metal housing.
  // Their dark bezels and bright cores remain distinct at half-size mobile rendering.
  for (const lx of [x + 12, x + w - 12]) {
    ellipse(c, lx, y + 44, 7, 7, "#182c34");
    ellipse(c, lx, y + 44, 5.5, 5.5, lit ? "#ff9e35" : "#617b7e");
    ellipse(c, lx - 0.7, y + 43, 3.5, 3.5, lit ? "#fff0b0" : "#a4b6ac");
  }
  round(c, x + 1, y + h - 9, w - 2, 8, 1, "#612630");
  line(c, [[x + 3, y + h - 8], [x + w - 4, y + h - 8]], "#d6856b", 1.5);
  for (let i = 0; i < 7; i++) line(c, [[x + 6 + i * (w - 12) / 7, y + h - 5], [x + 6 + i * (w - 12) / 7, y + h - 2]], "#361f2b");
  if (s.phase === "descending" && !reducedMotion) {
    for (const side of [-1, 1]) line(c, [[s.x + side * (w / 2 + 4), y + 8], [s.x + side * (w / 2 + 4), y + 27]], "#cadbdd66", 1.5);
  }
  // Eight ballistic ink flecks and two low dust puffs, bounded and age-driven.
  if (s.phase === "impact" && s.timer < 0.28 && !reducedMotion) {
    const t = s.timer / 0.28;
    c.globalAlpha *= 1 - t;
    for (let i = 0; i < 8; i++) {
      const side = i % 2 ? 1 : -1;
      const px = s.x + side * (w / 2 + 2 + t * (12 + i * 3));
      const py = GROUND - Math.sin(t * Math.PI) * (3 + (i % 3) * 5);
      ellipse(c, px, py, 1.5, 0.8, i % 3 ? "#c17560" : "#e1d9b7");
    }
    for (const side of [-1, 1]) ellipse(c, s.x + side * (w / 2 + t * 19), GROUND + 1, 4 + t * 10, 1 + t * 2, "#c9c5ad55");
  }
  c.restore();
}

// Finanzamt's existing faster ground obstacles retain their exact movement and collision box.
export function isFredRunCabinet(obstacle: FredRunObstacle) {
  return obstacle.kind === "odo" || obstacle.kind === "madinger" || obstacle.kind === "luki";
}
export function drawFilingCabinet(c: CanvasRenderingContext2D, o: FredRunObstacle, elapsed: number, reducedMotion: boolean) {
  if (o.x + o.width < 0 || o.x > FREDRUN_WORLD_WIDTH) return;
  const x = o.x, y = GROUND - o.height, w = o.width, h = o.height;
  c.save(); c.lineJoin = "round";
  ellipse(c, x + w / 2 + 3, GROUND + 3, w * 0.66, 4, "#02090d88");
  round(c, x, y, w, h - 3, 3, "#152932");
  polygon(c, [[x + w - 9, y + 3], [x + w, y], [x + w, GROUND - 4], [x + w - 9, GROUND - 1]],
    gradient(c, x + w - 9, y, 9, 0, ["#415b65", "#263e49"]));
  round(c, x + 1, y + 2, w - 10, h - 7, 2,
    gradient(c, x, y, w - 10, h, ["#8eaaa9", "#526f79", "#304c58"]));
  polygon(c, [[x + 1, y + 2], [x + 8, y], [x + w, y], [x + w - 9, y + 5]], "#aec1b8");
  line(c, [[x + 2, y + 6], [x + 2, GROUND - 7]], "#acc4bf", 1);
  for (let i = 0; i < 3; i++) {
    const dy = y + 9 + i * (h - 17) / 3, dh = (h - 20) / 3;
    // Only perspective depth changes: drawers never extend outside the solid cabinet envelope.
    const cycle = reducedMotion ? 0.35 : Math.max(0, Math.sin(elapsed * 3.2 + o.id * 1.7 + i * 2));
    const depth = i === o.id % 3 ? 1 + cycle * 6 : 0;
    round(c, x + 4, dy, w - 16, dh, 1, "#122b36");
    if (depth > 0) {
      polygon(c, [[x + 5, dy + 2], [x + w - 13, dy + 2], [x + w - 13 + depth, dy + 5], [x + 5 + depth, dy + 5]], "#233c44");
      // Cream folders, tabs and rails are revealed as the drawer travels outward.
      for (let f = 0; f < 3; f++) line(c, [[x + 7 + f * 5, dy + 2], [x + 9 + f * 5 + depth, dy + 5]], f % 2 ? "#b4ad86" : "#e0d6ad", 2);
      line(c, [[x + w - 13, dy + dh - 2], [x + w - 13 + depth, dy + dh]], "#a6babc");
    }
    round(c, x + 4 + depth, dy + (depth ? 4 : 1), w - 17, dh - (depth ? 4 : 1), 1,
      gradient(c, x, dy, 0, dh, ["#8fa9a9", "#4b6874", "#3b5661"]));
    line(c, [[x + 5 + depth, dy + (depth ? 5 : 2)], [x + w - 14 + depth, dy + (depth ? 5 : 2)]], "#bdd1c6");
    const cx = x + (w - 9) / 2 + depth;
    round(c, cx - 5, dy + 7, 10, 5, 1, "#c1c6b3");
    round(c, cx - 3.7, dy + 8, 7.4, 2.5, 0.5, "#e3d9b9");
    line(c, [[cx - 5, dy + dh - 5], [cx - 5, dy + dh - 2], [cx + 5, dy + dh - 2], [cx + 5, dy + dh - 5]], "#172f3d", 2.6);
    line(c, [[cx - 4, dy + dh - 3], [cx + 4, dy + dh - 3]], "#d4dcd0", 1.2);
  }
  for (const fx of [x + 5, x + w - 6]) {
    round(c, fx - 2, GROUND - 5, 4, 5, 1, "#12202b");
    ellipse(c, fx, GROUND - 2, 2, 2, "#71838a");
  }
  for (let i = 0; i < 4; i++) {
    const sy = y + 17 + grain(o.id, i) * (h - 25);
    line(c, [[x + w - 6, sy], [x + w - 3, sy - 1]], "#9fb4ad66");
  }
  c.restore();
}

// A continuous outcrop has a flat landing edge and an asymmetric, tapered underside.
// All face detail is clipped to that silhouette; the seed is stable while scrolling.
function rockChunk(c: CanvasRenderingContext2D, x: number, y: number, w: number, depth: number, id: number, snow: number) {
  const count = 5 + Math.floor(grain(id, 0) * 4);
  const outline: Point[] = [[x, y], [x + w, y]];
  for (let i = count; i >= 0; i--) {
    const t = i === count ? 1 : i === 0 ? 0 : (i + (grain(id, i + 1) - 0.5) * 0.65) / count;
    const taper = i === count || i === 0 ? 0.35 : 0.65 + grain(id, i + 12) * 0.65;
    outline.push([x + w * t, y + depth * taper]);
  }
  c.save();
  polygon(c, outline, gradient(c, x, y, w * 0.12, depth, ["#a8ad98", "#78857a", "#506763", "#2d4349"]));
  c.clip();
  // Unequal, oblique fracture planes cross the face without repeated block seams.
  for (let i = 0; i < 4; i++) {
    const fx = x + w * grain(id, i + 30);
    const reach = w * (0.18 + grain(id, i + 40) * 0.35);
    const fy = y + depth * (0.12 + grain(id, i + 50) * 0.35);
    polygon(c, [[fx - reach, y + depth * 0.12], [fx + reach * 0.6, fy],
      [fx + reach, y + depth * 1.4], [fx - reach * 0.25, y + depth * 0.85]],
    i % 2 ? "#c6c8a933" : "#263f4a55");
    line(c, [[fx - reach, fy], [fx, fy + depth * 0.16], [fx + reach * 0.7, fy - depth * 0.08]], "#d0d0b444", 1.3);
  }
  for (let i = 0; i < 12; i++) {
    const fx = x + grain(id, i + 60) * w, fy = y + 8 + grain(id, i + 80) * depth;
    polygon(c, [[fx, fy], [fx + 3 + grain(id, i) * 9, fy - 2], [fx + 4, fy + 3]], i % 2 ? "#c9cbb344" : "#263f4538");
  }
  const turf: Point[] = [[x, y], [x + w, y]];
  for (let i = 8; i >= 0; i--) turf.push([x + w * i / 8, y + 3 + grain(id, i + 100) * 5]);
  polygon(c, turf, "#527d35");
  line(c, [[x, y + 0.8], [x + w, y + 0.8]], "#bfce78", 1.6);
  if (snow > 0) {
    c.save(); c.globalAlpha *= snow;
    const cap: Point[] = [[x, y], [x + w, y]];
    for (let i = 9; i >= 0; i--) cap.push([x + w * i / 9, y + 1 + grain(id, i + 110) * 5]);
    polygon(c, cap, "#edf3df");
    c.restore();
  }
  c.restore();
}
export function drawPlatform(c: CanvasRenderingContext2D, p: FredRunPlatform, _elapsed: number, reducedMotion: boolean, snow = 0) {
  if (p.x + p.width < -40 || p.x > FREDRUN_WORLD_WIDTH + 40) return;
  const collapsed = p.state === "collapsed", warning = p.state === "crumbling";
  const age = Math.max(0, p.crumbleTimer - p.crumbleDuration);
  if (collapsed && (reducedMotion || age >= 0.65)) return;
  const progress = warning ? clamp(p.crumbleTimer / p.crumbleDuration) : collapsed ? 1 : 0;
  const depth = p.height + 18;
  c.save(); c.lineJoin = "round"; c.lineCap = "round";
  if (collapsed) c.globalAlpha *= 1 - age / 0.65;
  else ellipse(c, p.x + p.width / 2, GROUND + 5, p.width * 0.48, 6, "#10272830");
  if (!collapsed) {
    rockChunk(c, p.x, p.y, p.width, depth, p.id, snow);
  } else {
    // Only a broken platform separates into fragments; intact rock has no tiled seams.
    const count = 3 + Math.floor(grain(p.id, 120) * 3);
    for (let i = 0; i < count; i++) {
      const start = i === 0 ? 0 : (i + (grain(p.id, i) - 0.5) * 0.7) / count;
      const end = i === count - 1 ? 1 : (i + 1 + (grain(p.id, i + 1) - 0.5) * 0.7) / count;
      const w = p.width * (end - start);
      const drift = (i - (count - 1) / 2) * age * 12;
      const fall = 8 + age * age * (310 + i % 3 * 85);
      c.save(); c.translate(p.x + start * p.width + w / 2 + drift, p.y + fall);
      c.rotate((i % 2 ? 1 : -1) * age * 0.55);
      rockChunk(c, -w / 2, 0, w - 2, depth + grain(p.id, i) * 10, p.id * 6 + i, snow);
      c.restore();
    }
  }
  // Hairline weaknesses remain visible on intact fragile rock; branches spread on landing.
  if (!collapsed && p.type === "crumbling") {
    for (let i = 1; i < 6; i++) {
      const x = p.x + p.width * (i + (grain(p.id, i) - 0.5) * 0.85) / 6;
      const length = 5 + progress * (depth - 5);
      const crack: Point[] = [[x - 3, p.y], [x + 2, p.y + length * 0.35], [x - 3, p.y + length * 0.66], [x + 2, p.y + length]];
      line(c, crack.map(([cx, cy]) => [cx + 1.2, cy]), "#e2dab988", 1.6 + progress);
      line(c, crack, "#253c3e", 0.7 + progress * 2.3);
      if (progress > 0.25) line(c, [[x + 1, p.y + length * 0.35], [x + 7 + progress * 8, p.y + length * 0.3]], "#253c3e", progress * 2);
    }
  }
  if ((warning || collapsed) && !reducedMotion) {
    // Twelve dust motes / chips maximum; no particle allocation or accumulation across frames.
    for (let i = 0; i < 12; i++) {
      const t = collapsed ? age : (p.crumbleTimer * 1.7 + grain(p.id, i)) % 1;
      const x = p.x + grain(p.id, i + 12) * p.width + (collapsed ? (i - 6) * age * 5 : 0);
      const y = p.y + depth + t * t * 80;
      c.save(); c.globalAlpha *= (1 - clamp(t)) * (collapsed ? 0.7 : progress * 0.65);
      if (i % 3 === 0) polygon(c, [[x, y], [x + 4, y + 1], [x + 2, y + 5], [x - 1, y + 3]], "#6d7c73");
      else ellipse(c, x, y, 2 + t * 5, 1 + t * 3, "#d2cdb0");
      c.restore();
    }
  }
  c.restore();
}

export function drawChasm(c: CanvasRenderingContext2D, chasm: FredRunChasm) {
  const left = Math.max(0, chasm.x), right = Math.min(FREDRUN_WORLD_WIDTH, chasm.x + chasm.width);
  if (right <= left) return;
  c.save();
  c.beginPath(); c.rect(left, GROUND, right - left, FREDRUN_WORLD_HEIGHT - GROUND); c.clip();
  c.fillStyle = gradient(c, 0, GROUND, 0, 60, ["#1a3439", "#122b37", "#23434d"]);
  c.fillRect(left, GROUND, right - left, 60);
  // Use world edges, not clipped screen edges: scrolling never creates a false landing bank.
  for (const side of [-1, 1]) {
    const x = side === 1 ? chasm.x : chasm.x + chasm.width;
    polygon(c, [[x, GROUND], [x + side * 10, GROUND + 9], [x + side * 6, GROUND + 21],
      [x + side * 15, GROUND + 38], [x + side * 10, GROUND + 60], [x, GROUND + 60]],
    gradient(c, x, GROUND, side * 15, 45, ["#879783", "#586b62", "#2a454b"]));
    for (let i = 0; i < 4; i++) line(c, [[x, GROUND + 11 + i * 12], [x + side * (6 + i), GROUND + 14 + i * 12]], "#bbc4a65c", 1.5);
    line(c, [[x, GROUND + 1], [x + side * 7, GROUND + 4]], "#98b76d", 2);
    line(c, [[x + side * 3, GROUND + 5], [x + side * 2, GROUND + 13], [x + side * 5, GROUND + 18]], "#423e2d", 1);
  }
  c.fillStyle = gradient(c, 0, GROUND + 30, 0, 30, ["#a9c6c900", "#a9c6c935"]);
  c.fillRect(left, GROUND + 30, right - left, 30);
  c.restore();
}
