import { URBAN_FALL_TIME, URBAN_IMPACT_X, URBAN_PATTERNS, URBAN_RECOVERY, filefallCabinetGeometry, urbanPackage, type FredRunUrbanEvent } from "./fredrun-urban-event";

type Point = readonly [number, number];
const clamp = (n: number) => Math.max(0, Math.min(1, n));
function poly(c: CanvasRenderingContext2D, points: readonly Point[], color: string | CanvasGradient) {
  c.beginPath(); c.moveTo(...points[0]);
  for (let i = 1; i < points.length; i++) c.lineTo(...points[i]);
  c.closePath(); c.fillStyle = color; c.fill();
}
function line(c: CanvasRenderingContext2D, points: readonly Point[], color: string, width = 1) {
  c.beginPath(); c.moveTo(...points[0]);
  for (let i = 1; i < points.length; i++) c.lineTo(...points[i]);
  c.strokeStyle = color; c.lineWidth = width; c.stroke();
}
function gradient(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, colors: readonly string[]) {
  const g = c.createLinearGradient(x, y, x + w, y + h);
  for (let i = 0; i < colors.length; i++) g.addColorStop(i / (colors.length - 1), colors[i]);
  return g;
}
function oval(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string | CanvasGradient) {
  c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fillStyle = color; c.fill();
}
function box(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string | CanvasGradient, radius = 2) {
  c.beginPath(); c.roundRect(x, y, w, h, radius); c.fillStyle = color; c.fill();
}

// The broken tile has a curved crown, chipped right lip and dark ceramic body.
// Small masonry wedges use different fracture planes, not recolored boxes.
function tile(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, stone = false) {
  const light = stone ? "#e1d2ad" : "#efb186", mid = stone ? "#b2a18b" : "#b85f40", dark = stone ? "#5e635e" : "#653b32";
  poly(c, [[x, y + h * 0.3], [x + w * 0.19, y], [x + w * 0.7, y + h * 0.05], [x + w, y + h * 0.32], [x + w * 0.9, y + h * 0.65], [x + w * 0.96, y + h], [x + w * 0.12, y + h]], dark);
  poly(c, [[x + 1, y + h * 0.28], [x + w * 0.2, y], [x + w * 0.69, y + 1], [x + w * 0.96, y + h * 0.32], [x + w * 0.81, y + h * 0.66], [x + w * 0.1, y + h * 0.72]], gradient(c, x, y, w * 0.7, h, [light, mid, dark]));
  line(c, [[x + 2, y + h * 0.3], [x + w * 0.23, y + 2], [x + w * 0.68, y + 3]], light, 1.5);
  if (!stone) {
    c.beginPath(); c.moveTo(x + w * 0.22, y + h * 0.62);
    c.quadraticCurveTo(x + w * 0.4, y - h * 0.02, x + w * 0.63, y + h * 0.24);
    c.strokeStyle = "#efb487a0"; c.lineWidth = 2; c.stroke();
  }
  line(c, [[x + w * 0.76, y + h * 0.24], [x + w * 0.57, y + h * 0.46], [x + w * 0.61, y + h * 0.75]], "#553c36", 1.2);
  poly(c, [[x + w * 0.89, y + h * 0.49], [x + w * 0.8, y + h * 0.67], [x + w * 0.91, y + h * 0.84]], "#dfbd91");
}

// Layered paper block, cloth spine, cover overhang, page ruling and real ties/rings.
function file(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, index: number, open = false) {
  const colors = ["#9b5748", "#517e7f", "#a38a53"];
  const cover = colors[index % colors.length];
  box(c, x, y + h - 5, w, 5, "#152a32", 1);
  poly(c, [[x, y + 5], [x + w - 7, y], [x + w, y + 5], [x + w, y + h - 4], [x + 4, y + h - 1]], "#263b40");
  poly(c, [[x + 5, y + 5], [x + w - 4, y + 5], [x + w - 3, y + h - 5], [x + 5, y + h - 3]], gradient(c, x, y, w, h, ["#fff0ce", "#d6c6a4", "#a1917c"]));
  for (let row = 8; row < h - 5; row += 3) line(c, [[x + 7, y + row], [x + w - 5, y + row - 1]], "#8d857561", 0.7);
  poly(c, [[x - 1, y + 3], [x + w - 8, y - 2], [x + w + 1, y + 4], [x + 5, y + 7]], cover);
  line(c, [[x, y + 2], [x + w - 8, y - 2]], "#ead7af", 1.3);
  box(c, x, y + 5, 6, Math.max(3, h - 6), cover, 1);
  if (index % 2 === 0) {
    line(c, [[x + w * 0.54, y + 2], [x + w * 0.58, y + h - 3]], "#433e35", 2.8);
    line(c, [[x + w * 0.54 - 1, y + 2], [x + w * 0.58 - 1, y + h - 3]], "#ccb688", 1);
    line(c, [[x + w * 0.53, y + 2], [x + w * 0.43, y - 3], [x + w * 0.49, y - 5], [x + w * 0.59, y + 2], [x + w * 0.68, y - 3]], "#cfb98c", 1.3);
  } else {
    for (const offset of [0.3, 0.7]) {
      oval(c, x + w * offset, y + 5, 3.3, 2.5, "#152c37");
      c.beginPath(); c.ellipse(x + w * offset, y + 4, 2.3, 3.5, -0.3, Math.PI * 0.85, Math.PI * 2.4);
      c.strokeStyle = "#d4e1d7"; c.lineWidth = 1.3; c.stroke();
    }
  }
  box(c, x + w * 0.72, y + 7, Math.max(4, w * 0.14), 5, "#efdab0", 0.5);
  if (open) {
    poly(c, [[x + 6, y + 5], [x + 9, y - 8], [x + w * 0.52, y - 2], [x + w - 2, y - 7], [x + w - 4, y + 4], [x + w * 0.52, y + 8]], "#e8d9b8");
    line(c, [[x + w * 0.52, y - 2], [x + w * 0.52, y + 7]], "#8e8876", 1.2);
    for (let i = 0; i < 3; i++) line(c, [[x + 13, y - 4 + i * 2.5], [x + w * 0.44, y + i * 2]], "#a79f8b", 0.7);
  }
}

function facade(c: CanvasRenderingContext2D, e: FredRunUrbanEvent, reduced: boolean) {
  const shake = !reduced && e.phase === "anticipation" ? Math.sin(e.timer * 29) * 1.3 : 0;
  oval(c, 896, 300, 93, 9, "#15242a70");
  // A cropped near facade connects the roof to the pavement; ochre plaster,
  // dressed limestone bands and recessed windows match the Vienna palette.
  poly(c, [[817, 108], [972, 75], [972, 298], [817, 298]], gradient(c, 816, 110, 160, 130, ["#bdaf94", "#8b8b7e", "#4e6263"]));
  poly(c, [[817, 108], [832, 116], [832, 299], [817, 298]], "#657575");
  for (let row = 0; row < 8; row++) line(c, [[834, 127 + row * 22], [974, 104 + row * 22]], "#e0d0ab35", 1);
  for (const x of [846, 911]) {
    box(c, x - 5, 140, 41, 59, "#b1ac92", 1);
    box(c, x, 144, 31, 49, gradient(c, x, 143, 30, 50, ["#162d38", "#344b53", "#8b9180"]), 1);
    line(c, [[x + 3, 187], [x + 3, 147], [x + 27, 147]], "#102b35", 3);
    line(c, [[x + 15, 146], [x + 15, 191]], "#aaa98d", 2);
    line(c, [[x + 1, 164], [x + 30, 164]], "#aaa98d", 2);
    poly(c, [[x - 7, 197], [x + 36, 194], [x + 40, 200], [x - 4, 204]], "#d0bea0");
    box(c, x, 231, 31, 61, "#273d43", 1);
    line(c, [[x + 4, 289], [x + 4, 235], [x + 27, 235]], "#0c2831", 3);
  }
  for (const x of [833, 890, 957]) {
    poly(c, [[x, 119], [x + 8, 117], [x + 8, 298], [x, 298]], "#bdb198");
    line(c, [[x + 8, 127], [x + 8, 292]], "#4c6161", 2);
    box(c, x - 2, 283, 13, 15, "#92988a", 1);
  }
  // Stretched canvas awnings: the outer hem curls upwards in the gust.
  const flap = reduced ? -5 : Math.sin(e.timer * 12) * 4 - 4;
  for (const x of [834, 905]) {
    poly(c, [[x, 208], [x + 53, 203], [x + 61, 221 + flap], [x - 13, 224 + flap]], "#273f43");
    for (let i = 0; i < 5; i++) poly(c, [[x + i * 10, 207 - i], [x + i * 10 + 8, 206 - i], [x + i * 13 + 1, 223 + flap], [x + i * 13 - 10, 224 + flap]], i % 2 ? "#bcaa88" : "#4b6d68");
    line(c, [[x - 13, 224 + flap], [x + 61, 221 + flap]], "#dfc9a1", 1.5);
    line(c, [[x, 226], [x - 8, 240]], "#324d50", 2);
  }
  box(c, 816, 292, 157, 8, "#566965", 1);
  c.save(); c.translate(shake, 0);
  poly(c, [[804, 105], [971, 68], [975, 99], [813, 131]], "#3a494b");
  poly(c, [[800, 98], [971, 61], [978, 82], [807, 120]], gradient(c, 811, 79, 120, 55, ["#edcaa3", "#ba9c7e", "#536461"]));
  // Broken cornice notch and fissure directly beneath the lifted source tiles.
  poly(c, [[803, 102], [834, 96], [828, 112], [821, 109], [816, 120], [810, 113]], "#233f48");
  line(c, [[847, 113], [850, 131], [840, 147], [843, 158]], "#3e5353", 1.7);
  for (let row = 0; row < 2; row++) for (let i = 0; i < 7; i++) {
    const x = 817 + i * 24 + row * 6, y = 80 - i * 5 + row * 12;
    tile(c, x, y, 25, 16);
  }
  if (e.phase === "anticipation") {
    // A lifted slab exposes a dark separation even in a single still frame.
    poly(c, [[790, 103], [819, 89], [849, 91], [835, 116], [815, 111], [807, 126]], "#172e36");
    line(c, [[808, 125], [820, 114], [828, 120], [843, 107]], "#e7ce9f", 2.5);
    c.save(); c.translate(809, 100); c.rotate(-0.38);
    tile(c, -30, -22, 53, 29); tile(c, 5, -28, 33, 21, true); c.restore();
    line(c, [[790, 111], [796, 121], [791, 129]], "#d1b993", 2);
  }
  c.restore();
}

function cabinet(c: CanvasRenderingContext2D, e: FredRunUrbanEvent, reduced: boolean) {
  const geometry = filefallCabinetGeometry(e, reduced);
  // Damaged pendant: one warm end remains lit. No flashing or screen shake.
  line(c, [[767, 0], [767, 34], [788, 45]], "#354951", 3);
  line(c, [[905, 0], [905, 36]], "#20323d", 3);
  poly(c, [[760, 31], [909, 41], [904, 53], [756, 43]], "#1a2f39");
  poly(c, [[762, 35], [846, 41], [843, 46], [761, 41]], "#f2ddb0");
  poly(c, [[850, 41], [902, 45], [900, 49], [849, 46]], "#677977");
  line(c, [[846, 40], [849, 45], [844, 49]], "#111f2a", 2);
  poly(c, [[764, 43], [842, 47], [918, 297], [571, 298]], gradient(c, 790, 44, 0, 250, ["#f6d69710", "#ffcf7520", "#e5bd7929"]));
  oval(c, 887, 299, 81, 10, "#06121bc0");
  c.save(); c.translate(geometry.x, geometry.y); c.rotate(geometry.rotation);
  // Side face, folded sheet-metal seam, rolled rim, grounded pivot foot.
  poly(c, [[-76, -182], [8, -195], [27, -180], [27, -4], [7, 5], [-76, 0]], "#0b202c");
  poly(c, [[7, -181], [26, -180], [26, -4], [7, 3]], gradient(c, 7, -175, 20, 130, ["#6c8585", "#344f59", "#152e3c"]));
  poly(c, [[-76, -182], [7, -195], [27, -180], [-54, -165]], "#81938c");
  box(c, -76, -182, 84, 182, gradient(c, -76, -175, 83, 145, ["#80938c", "#4b6770", "#253e4c"]), 3);
  line(c, [[-73, -4], [-73, -178], [3, -178]], "#bdc1a3", 2);
  line(c, [[12, -173], [12, -10], [23, -14]], "#78918b50", 1);
  for (let row = 0; row < 4; row++) {
    const { y, slide, source } = geometry.drawers[row];
    box(c, -69, y, 69, 37, "#0b202b", 2);
    // Exposed dark cavity stays visible behind the extended drawer, with rails.
    poly(c, [[-69, y + 3], [-69 - slide, y + 8], [-6 - slide, y + 8], [-2, y + 2]], "#a2a795");
    poly(c, [[-68, y + 7], [-68 - slide, y + 13], [-68 - slide, y + 34], [-68, y + 31]], "#1d3542");
    line(c, [[-64, y + 28], [-64 - slide, y + 32]], "#c0c4ac", 1.5);
    const release = URBAN_PATTERNS[e.variant].releases[row + 1];
    if (row < 2 && release !== undefined && (e.phase === "anticipation" || (e.phase === "action" && e.timer < release))) {
      for (let j = 0; j < 3; j++) file(c, source.x - 26 + j * 15, source.y + 5 - (j % 2) * 5, 22, 16, j + row);
    }
    box(c, -70 - slide, y + 13, 69, 23, gradient(c, -68 - slide, y + 12, 64, 25, ["#91a397", "#526e75", "#263f4c"]), 2);
    line(c, [[-68 - slide, y + 14], [-4 - slide, y + 14]], "#c8c7a7", 1.2);
    box(c, -49 - slide, y + 17, 25, 13, "#233d48", 2);
    box(c, -46 - slide, y + 18, 19, 5, "#c6baa0", 1);
    line(c, [[-45 - slide, y + 28], [-45 - slide, y + 25], [-29 - slide, y + 25], [-29 - slide, y + 28]], "#c2c9b6", 2);
    oval(c, -9 - slide, y + 26, 1.5, 1.5, "#b7c6b5");
  }
  if (e.phase === "anticipation") {
    const source = geometry.topSource;
    file(c, source.x - 39.5, source.y + 17, 66, 18, 0); file(c, source.x - 29.5, source.y, 59, 17, 1, true);
  }
  line(c, [[-49, -155], [-39, -147], [-43, -138]], "#c4c7a13b", 1);
  box(c, -70, -2, 10, 8, "#0c2632", 1); box(c, -4, -2, 12, 8, "#132d38", 1);
  c.restore();
}

function impactCue(c: CanvasRenderingContext2D, e: FredRunUrbanEvent) {
  const office = e.kind === "filefall";
  // Projected source shadow, split light and grit sit on the actual impact plane.
  poly(c, [[788, 274], [837, 280], [635, 303], [556, 303]], gradient(c, 803, 277, -196, 26, ["#081c2410", "#071c244c", "#081b278f"]));
  poly(c, [[539, 304], [567, 300], [596, 299], [622, 297], [652, 301], [669, 305], [635, 313], [587, 311]],
    gradient(c, 599, 297, 0, 17, office ? ["#e7bf7900", "#e7bf7970", "#e7bf7900"] : ["#ead0a400", "#ead0a4a0", "#ead0a400"]));
  oval(c, URBAN_IMPACT_X, 303, 42, 5, "#10252cc7");
  line(c, [[558, 306], [576, 307], [590, 306]], office ? "#e3c296" : "#edd2a5", 2.2);
  line(c, [[617, 308], [632, 306], [646, 305]], office ? "#d3b183a0" : "#d6b389a0", 1.3);
  for (let i = 0; i < 7; i++) oval(c, 570 + i * 12, 299 + i % 3 * 2, 1.7, 0.9, "#dcc8a0");
}

function atmosphere(c: CanvasRenderingContext2D, e: FredRunUrbanEvent) {
  const storm = e.kind === "stormfront", t = e.timer;
  const strength = e.phase === "recovery" ? (1 - clamp(t / URBAN_RECOVERY)) * 0.45 : 1;
  c.save(); c.globalAlpha *= strength;
  if (storm) {
    // Fixed-count deterministic slanted rain and broad, low-contrast wind threads.
    for (let i = 0; i < 36; i++) {
      const x = ((i * 137 - t * 490) % 1080 + 1080) % 1080;
      const y = (i * 47 + t * 280) % 285;
      line(c, [[x, y], [x - 19, y + 12]], "#d5e1d439", 1);
    }
    for (let i = 0; i < 3; i++) {
      const x = ((740 - t * 270 + i * 280) % 1050 + 1050) % 1050;
      c.beginPath(); c.moveTo(x, 178 + i * 28);
      c.bezierCurveTo(x - 55, 150 + i * 28, x - 101, 191 + i * 28, x - 151, 169 + i * 28);
      c.strokeStyle = "#d7dec629"; c.lineWidth = 1.5; c.stroke();
    }
  }
  // Papers stay behind packages and above their top edge; bounded fixed slots.
  for (let i = 0; i < (storm ? 7 : 11); i++) {
    const age = (t * 0.65 + i * 0.173) % 1;
    const x = 837 - age * (storm ? 610 : 355), y = 127 + age * 112 + Math.sin(age * 9 + i) * 22;
    c.save(); c.translate(x, y); c.rotate(Math.sin(age * 12 + i) * 0.9);
    const w = 9 + i % 3 * 3, curl = Math.sin(age * 18 + i) * 3;
    poly(c, [[-w / 2, -4], [w / 2, -3 + curl], [w / 2 - 2, 5], [-w / 2 + 1, 4 - curl]], i % 3 ? "#d9d0af9c" : "#e7dbbfc9");
    line(c, [[-w / 2 + 2, -1], [w / 2 - 2, curl * 0.3]], "#787f7680", 0.8); c.restore();
  }
  if (storm && e.phase === "anticipation") {
    for (let i = 0; i < 12; i++) {
      const a = (t * 0.8 + i / 12) % 1;
      oval(c, 808 - a * 58 + Math.sin(i * 8) * 10, 115 + a * 157, 1 + a * 1.8, 1.4, "#d2b38c80");
    }
  }
  c.restore();
}

function burst(c: CanvasRenderingContext2D, e: FredRunUrbanEvent, index: number) {
  const age = e.timer - URBAN_PATTERNS[e.variant].releases[index] - URBAN_FALL_TIME;
  if (age < 0 || age > 0.65) return;
  c.save(); c.globalAlpha *= (1 - age / 0.65) * 0.65;
  const x = URBAN_IMPACT_X - age * e.speed * 0.3;
  for (let i = 0; i < 10; i++) {
    const side = i % 2 ? 1 : -1, vx = side * (24 + i * 13);
    const px = x + vx * age, py = 297 - (34 + i % 4 * 18) * age + 135 * age * age;
    if (e.kind === "stormfront") {
      oval(c, px, Math.min(301, py + 5), 5 + age * 15, 2 + age * 7, "#bcaa8a45");
      poly(c, [[px - 2, py], [px, py - 3], [px + 4, py + 1], [px + 1, py + 3]], i % 3 ? "#bd815a" : "#d8c5a0");
    } else poly(c, [[px - 4, py], [px + 5, py - 2], [px + 6, py + 2], [px - 3, py + 4]], "#d6ceb5");
  }
  c.restore();
}

export function drawFredRunUrbanEvent(c: CanvasRenderingContext2D, e: FredRunUrbanEvent | null, reducedMotion: boolean, decorations = true) {
  if (!e || e.phase === "quiet" || e.phase === "clearance") return;
  c.save(); c.lineJoin = "round"; c.lineCap = "round";
  c.globalAlpha *= e.phase === "recovery" ? clamp((URBAN_RECOVERY - e.timer) / 0.8) : 1;
  if (e.kind === "stormfront") facade(c, e, reducedMotion); else cabinet(c, e, reducedMotion);
  if (e.phase === "anticipation" || (e.phase === "action" && e.timer < URBAN_PATTERNS[e.variant].releases.at(-1)! + URBAN_FALL_TIME)) impactCue(c, e);
  if (decorations && !reducedMotion) atmosphere(c, e);
  if (e.phase === "action") {
    for (let i = 0; i < URBAN_PATTERNS[e.variant].releases.length; i++) {
      if (e.absorbed & (1 << i)) continue;
      const p = urbanPackage(e, i);
      if (p.age < 0 || p.x + p.width < -30) continue;
      const contact = clamp(p.age / URBAN_FALL_TIME);
      oval(c, p.x + 5, 301, p.width * (0.6 - contact * 0.13), 3 + (1 - contact) * 3, `rgba(6,22,29,${0.14 + contact * 0.5})`);
      if (decorations && !reducedMotion) burst(c, e, i);
      c.save(); c.translate(p.x, p.y); c.rotate(p.rotation);
      if (e.kind === "stormfront") {
        tile(c, -p.width / 2, p.height * 0.35, p.width * 0.6, p.height * 0.65, i % 2 === 1);
        tile(c, -p.width * 0.09, p.height * 0.38, p.width * 0.6, p.height * 0.62, i % 2 === 0);
        tile(c, -p.width * 0.33, 0, p.width * 0.67, p.height * 0.67);
      } else {
        file(c, -p.width / 2, p.height * 0.46, p.width, p.height * 0.54, i);
        file(c, -p.width * 0.4, 4, p.width * 0.77, p.height * 0.53, i + 1, p.age > URBAN_FALL_TIME && i % 2 === 1);
      }
      c.restore();
    }
  }
  if (e.phase === "recovery") {
    // Spent source, a few settled scraps and a restrained dust veil linger.
    for (let i = 0; i < 5; i++) {
      const x = 706 + i * 36;
      oval(c, x, 302, 8, 2, "#132b3545");
      if (e.kind === "filefall") poly(c, [[x - 5, 300], [x + 7, 298], [x + 10, 301], [x - 3, 303]], "#cec5a67a");
      else poly(c, [[x - 3, 300], [x, 297], [x + 4, 301]], "#b29b7b80");
    }
  }
  c.restore();
}
