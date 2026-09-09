import { type FredRunRockfall, ROCKFALL_PATTERNS, ROCKFALL_RECOVERY, rockfallBoulder } from "./fredrun-rockfall";

type Point = readonly [number, number];
// Unequal fracture planes, cached per stone. Every outline encloses the collision
// core (0.8 radius) and stays inside the existing visual/culling radius.
const shapes: { outline: readonly Point[]; face: readonly Point[]; seam: readonly Point[]; branch: readonly Point[]; colors: readonly string[] }[] = [
  {
    outline: [[-0.7322, -0.6101], [-0.0487, -0.8863], [0.77, -0.5721], [0.8801, 0.1229], [0.3868, 0.8824], [-0.5247, 0.7543], [-0.8377, 0.1402]],
    face: [[-0.74, -0.62], [-0.05, -0.89], [0.77, -0.58], [0.18, -0.12], [-0.48, 0.2]],
    seam: [[-0.7, 0.58], [-0.34, 0.17], [0.06, 0.08], [0.27, -0.21], [0.73, -0.37]],
    branch: [[0.06, 0.08], [0.16, 0.37], [0.57, 0.66]],
    colors: ["#d4c6a4", "#99917c", "#3b4a43"],
  },
  {
    outline: [[-0.6685, -0.5315], [0.0605, -0.987], [0.81, -0.4014], [0.81, 0.5271], [-0.0462, 0.9263], [-0.7119, 0.5103], [-0.8599, -0.0057]],
    face: [[0.06, -0.99], [0.81, -0.4], [0.81, 0.53], [0.22, 0.28], [-0.12, -0.23]],
    seam: [[-0.54, -0.7], [-0.37, -0.17], [-0.02, 0.04], [0.18, 0.76]],
    branch: [[-0.02, 0.04], [0.36, -0.12], [0.72, 0.04]],
    colors: ["#c6cbbd", "#7c8d86", "#304748"],
  },
  {
    outline: [[-0.5284, -0.7834], [0.283, -0.8259], [0.9092, -0.3189], [0.683, 0.5882], [0.0285, 0.9362], [-0.7024, 0.5311], [-0.8553, -0.0824]],
    face: [[-0.86, -0.08], [-0.53, -0.78], [0.28, -0.83], [0.01, -0.24], [-0.16, 0.39], [-0.7, 0.53]],
    seam: [[-0.67, -0.42], [-0.24, -0.3], [0.07, -0.44], [0.6, -0.52]],
    branch: [[-0.24, -0.3], [-0.07, 0.1], [-0.22, 0.43], [0.03, 0.84]],
    colors: ["#dbd2b3", "#a6a48d", "#47564b"],
  },
];
function path(c: CanvasRenderingContext2D, points: readonly Point[]) {
  c.beginPath(); c.moveTo(...points[0]);
  for (let i = 1; i < points.length; i++) c.lineTo(...points[i]);
  c.closePath();
}
function polygon(c: CanvasRenderingContext2D, points: readonly Point[], fill: string) {
  path(c, points); c.fillStyle = fill; c.fill();
}
function ellipse(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string) {
  c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fillStyle = fill; c.fill();
}

function boulder(c: CanvasRenderingContext2D, x: number, y: number, radius: number, rotation: number, seed: number) {
  const shape = shapes[seed % shapes.length];
  c.save(); c.translate(x, y); c.rotate(rotation); c.scale(radius, radius);
  // Light direction stays upper-left in world space while the stone rotates.
  const lx = Math.cos(-rotation - 2.2), ly = Math.sin(-rotation - 2.2);
  const fill = c.createLinearGradient(lx, ly, -lx, -ly);
  fill.addColorStop(0, shape.colors[0]); fill.addColorStop(0.48, shape.colors[1]); fill.addColorStop(1, shape.colors[2]);
  path(c, shape.outline); c.fillStyle = fill; c.fill();
  c.strokeStyle = "#30453f"; c.lineWidth = 1.4 / radius; c.stroke();
  c.clip();
  // A broad split face and narrow edge bevels replace the radial fan / stripes.
  const faceLight = lx * (seed % 3 === 1 ? 0.8 : -0.6) + ly * -0.6;
  polygon(c, shape.face, faceLight > 0 ? `rgba(245,233,200,${faceLight * 0.28})` : `rgba(21,40,39,${-faceLight * 0.24})`);
  for (let i = 0; i < shape.outline.length; i++) {
    const a = shape.outline[i], b = shape.outline[(i + 1) % shape.outline.length];
    const nx = b[1] - a[1], ny = a[0] - b[0];
    const light = (nx * lx + ny * ly) / Math.hypot(nx, ny);
    polygon(c, [a, b, [b[0] * 0.77, b[1] * 0.77], [a[0] * 0.77, a[1] * 0.77]],
      light > 0 ? `rgba(247,236,208,${light * 0.32})` : `rgba(15,35,37,${-light * 0.35})`);
  }
  // Different branching faults, a quartz vein, and an ochre inclusion survive
  // downsampling better than repeated fine bands or random surface flecks.
  if (seed % 3 === 2) polygon(c, [[0.2, 0.12], [0.55, 0.03], [0.67, 0.29], [0.42, 0.55], [0.13, 0.39]], "#ad845e80");
  for (const [i, seam] of [shape.seam, shape.branch].entries()) {
    c.beginPath(); c.moveTo(seam[0][0], seam[0][1]);
    for (const point of seam.slice(1)) c.lineTo(point[0], point[1]);
    c.strokeStyle = seed % 3 === 1 && i === 0 ? "#e5ddbeac" : "#263e3c9c";
    c.lineWidth = (seed % 3 === 1 && i === 0 ? 2.5 : 1.4) / radius; c.stroke();
  }
  c.restore();
}

// The source is an outcrop with a continuous buttress down to the meadow,
// then talus and grass at its foot. Its left lip meets the existing release point.
const ledge: readonly Point[] = [[972, 25], [947, 32], [925, 47], [914, 48], [902, 62], [882, 67], [875, 80], [877, 107], [866, 126], [884, 151], [891, 172], [906, 188], [901, 216], [888, 240], [866, 267], [845, 281], [825, 295], [856, 301], [891, 295], [921, 302], [972, 297]];

export function drawFredRunRockfall(c: CanvasRenderingContext2D, event: FredRunRockfall | null, reducedMotion: boolean) {
  if (!event || event.phase === "quiet" || event.phase === "clearance") return;
  c.save(); c.lineJoin = "round"; c.lineCap = "round";
  // The warning is fully readable from the first frame, also in reduced motion.
  const fade = event.phase === "recovery" ? Math.max(0, Math.min(1, (ROCKFALL_RECOVERY - event.timer) / 0.65)) : 1;
  c.globalAlpha *= fade;
  ellipse(c, 922, 295, 86, 8, "#263d3540");
  const stone = c.createLinearGradient(857, 70, 981, 239);
  stone.addColorStop(0, "#b8b69c"); stone.addColorStop(0.45, "#7d8a78"); stone.addColorStop(1, "#445e50");
  path(c, ledge); c.fillStyle = stone; c.fill();
  c.save(); path(c, ledge); c.clip();
  polygon(c, [[869, 63], [945, 35], [923, 92], [898, 109], [882, 153], [862, 125]], "#d7ccaa70");
  polygon(c, [[898, 109], [925, 95], [914, 145], [934, 170], [908, 226], [878, 264], [895, 201], [877, 145]], "#283e3f8c");
  polygon(c, [[945, 35], [923, 92], [925, 135], [955, 165], [971, 130], [975, 27]], "#c1b99938");
  polygon(c, [[915, 201], [948, 222], [921, 267], [862, 299], [843, 285], [891, 244]], "#afa98a59");
  for (const seam of [
    [[916, 52], [927, 68], [921, 96], [937, 118], [970, 129]],
    [[880, 149], [912, 158], [934, 170], [946, 205], [974, 223]],
    [[894, 238], [917, 246], [941, 239], [962, 261]],
  ] as const) {
    c.beginPath(); c.moveTo(seam[0][0], seam[0][1]);
    for (const point of seam.slice(1)) c.lineTo(point[0], point[1]);
    c.strokeStyle = "#273f4266"; c.lineWidth = 2; c.stroke();
  }
  for (let i = 0; i < 65; i++) {
    const x = 867 + (i * 73.71) % 106, y = 38 + (i * 39.33) % 263;
    polygon(c, [[x, y], [x + 3 + i % 7, y - 2], [x + 4, y + 2 + i % 4]], i % 3 ? "#dfd0aa30" : "#243e4140");
  }
  c.restore();
  // Broken turf follows the upper ridge and overlaps the scree foot; no floating edge.
  polygon(c, [[878, 69], [901, 58], [914, 43], [926, 42], [947, 26], [972, 22], [972, 38], [944, 42], [924, 55], [911, 55], [901, 69], [888, 72]], "#71904e");
  polygon(c, [[868, 269], [882, 265], [896, 274], [911, 269], [928, 280], [947, 271], [973, 281], [973, 302], [922, 299], [900, 295], [879, 301], [844, 299], [824, 295], [848, 289]], "#577644");
  for (let i = 0; i < 14; i++) {
    const x = 838 + i * 10, y = 292 + Math.sin(i * 4) * 5;
    polygon(c, [[x, y + 4], [x - 3, y - 4 - i % 6], [x + 3, y], [x + 6, y - 6], [x + 7, y + 4]], i % 2 ? "#73914e" : "#355638");
  }
  if (event.phase !== "recovery") {
    // A ~28px mobile release silhouette: dark open joint, fresh pale fracture,
    // and a large tilted slab with a detached toe, independent of animated dust.
    polygon(c, [[839, 71], [860, 63], [877, 74], [872, 94], [886, 109], [879, 130], [858, 143], [828, 135], [817, 117], [828, 102]], "#243b36");
    polygon(c, [[862, 66], [878, 74], [872, 94], [883, 109], [875, 124], [862, 129], [866, 109], [858, 94], [867, 80]], "#ebd7aa");
    boulder(c, 845, 103, 33, -0.24, 0);
    boulder(c, 833, 135, 11, 0.55, 2);
  }
  if (!reducedMotion && event.phase === "anticipation") {
    // Six harmless chips and three diffuse dust puffs; no persistent particle list.
    for (let i = 0; i < 6; i++) {
      const t = (event.timer * 1.15 + i / 6) % 1;
      c.save(); c.globalAlpha *= 1 - t;
      boulder(c, 836 - t * (35 + i * 5), 141 + t * t * 92, 2.5 + i % 3, t * 3, i);
      c.restore();
    }
    for (let i = 0; i < 3; i++) {
      const t = (event.timer * 0.8 + i / 3) % 1;
      ellipse(c, 833 - t * 47, 145 + t * 57, 9 + t * 12, 5 + t * 8, `rgba(222,206,163,${(1 - t) * 0.25})`);
    }
  }
  if (event.phase === "action") {
    const pattern = ROCKFALL_PATTERNS[event.variant];
    for (let i = 0; i < pattern.releases.length; i++) {
      const b = rockfallBoulder(event, i);
      if (b.age < 0 || b.x + b.radius < 0 || b.x - b.radius > 960 || event.absorbed & (1 << i)) continue;
      const contact = Math.max(0, 1 - (300 - b.y - b.radius) / 180);
      ellipse(c, b.x + 5, 302, b.radius * (1.25 - contact * 0.35), 3 + contact * 2, `rgba(31,52,39,${0.08 + contact * 0.27})`);
      if (!reducedMotion && b.age > 0.65) {
        for (let j = 0; j < 4; j++) {
          const t = (b.age * 2 + j / 4) % 1;
          ellipse(c, b.x + b.radius + t * 35, 297 - t * 9, 4 + t * 9, 2 + t * 3, `rgba(206,192,149,${(1 - t) * 0.22})`);
        }
      }
      boulder(c, b.x, b.y, b.radius, b.rotation, i + event.variant);
    }
  }
  c.restore();
}
