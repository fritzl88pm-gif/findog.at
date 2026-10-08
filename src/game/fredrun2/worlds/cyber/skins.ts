/**
 * Cyber-Wien 2099 – Entitäts-Skins. Leuchteffekte ausschließlich über vorgerenderte Glow-Sprites (kein shadowBlur im
 * Frame). Props (drone-hover, glitch-cube, server-rack, data-coin, cyber-hover) werden genutzt, wenn geladen; sonst prozedurale
 * Fallbacks. Neon-Barriere und Laser-Emitter sind bewusst prozedural (bei Spielgröße klarer lesbar als die Props).
 */
import { VIEW_W } from "../../constants";
import type { Ent, PropLibrary, ViewState } from "../../types";
import { colorWithAlpha, drawStripFrame, glowAt, glowSprite, paint, rr, softSprite, spriteStrip, type Ctx2D } from "../shared-b/canvas";
import { h1, mod } from "../shared-b/color";
import { paintOpaque } from "./backdrop";
import { CYAN, HOT, MAGENTA, MINT, TAU, VIOLET } from "./palette";

export interface CyberSkinAssets {
  props: PropLibrary | null;
  chip: HTMLCanvasElement;
  /** Münz-Streifen inkl. Glow in Zielgröße (1:1 geblittet) */
  coinStrip: HTMLCanvasElement;
  crystal: HTMLCanvasElement;
  portalUp: HTMLCanvasElement;
  portalDown: HTMLCanvasElement;
  glowCyan: HTMLCanvasElement;
  glowMagenta: HTMLCanvasElement;
  glowRed: HTMLCanvasElement;
  glowWhite: HTMLCanvasElement;
  glowMint: HTMLCanvasElement;
  glowViolet: HTMLCanvasElement;
  softCyan: HTMLCanvasElement;
  softMagenta: HTMLCanvasElement;
  softRed: HTMLCanvasElement;
  softViolet: HTMLCanvasElement;
  colUp: HTMLCanvasElement;
  colDown: HTMLCanvasElement;
  chevUp: HTMLCanvasElement;
  chevDown: HTMLCanvasElement;
  texCyan: HTMLCanvasElement;
  texMagenta: HTMLCanvasElement;
  plasma: HTMLCanvasElement;
  hint: HTMLCanvasElement;
  corridor: HTMLCanvasElement;
  shaft: HTMLCanvasElement;
  cube: HTMLCanvasElement;
  cubeWire: HTMLCanvasElement;
  rack: HTMLCanvasElement | null;
  barrier: HTMLCanvasElement;
  /** Gebackene Schwebe-Plattformen (Prop cyber-hover) je Breite × Pixeldichte */
  hover: Map<string, HTMLCanvasElement>;
  /** Bakes im laufenden Frame (siehe `hoverSprite`); der Renderer setzt sie in `update` zurück */
  baked: number;
}

const CHIP = 64;
const CRYSTAL = 80;

export function makeSkinAssets(): CyberSkinAssets {
  const chip = spriteStrip(12, CHIP, (g, f, s) => {
    const ang = (f / 12) * TAU;
    const sx = Math.max(0.1, Math.abs(Math.cos(ang)));
    g.translate(s / 2, s / 2);
    g.scale(sx, 1);
    const r = s * 0.4;
    // Sechseck-Chip
    g.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const a = Math.PI / 6 + (i / 6) * TAU;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    const grd = g.createLinearGradient(-r, -r, r, r);
    grd.addColorStop(0, "#b8fbff");
    grd.addColorStop(0.5, "#22c8e8");
    grd.addColorStop(1, "#0a5a8a");
    g.fillStyle = grd;
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = "#e8ffff";
    g.stroke();
    g.strokeStyle = "rgba(4,40,70,0.8)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-r * 0.5, 0);
    g.lineTo(-r * 0.15, 0);
    g.lineTo(0, -r * 0.3);
    g.moveTo(r * 0.5, r * 0.2);
    g.lineTo(r * 0.1, r * 0.2);
    g.moveTo(0, r * 0.55);
    g.lineTo(0, r * 0.3);
    g.stroke();
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(0, 0, r * 0.18, 0, TAU);
    g.fill();
  });
  const crystal = spriteStrip(16, CRYSTAL, (g, f, s) => {
    const ang = (f / 16) * TAU;
    g.translate(s / 2, s / 2);
    const top = -s * 0.44;
    const bot = s * 0.44;
    const mid = -s * 0.06;
    const R = s * 0.26;
    // 6 Facetten, sichtbar = vorne
    const pts: Array<[number, number, number]> = [];
    for (let i = 0; i < 6; i += 1) {
      const a = ang + (i / 6) * TAU;
      pts.push([Math.sin(a) * R, Math.cos(a), i]);
    }
    const cols = ["#7af2ff", "#ff7ae0", "#b58cff", "#4ad8ff", "#ff9af0", "#8ea8ff"];
    const order = [...pts].sort((a, b) => a[1] - b[1]);
    for (const [x0, z0, i] of order) {
      const j = (i + 1) % 6;
      const x1 = pts[j][0];
      const z1 = pts[j][1];
      if (z0 + z1 < -0.2) continue;
      const light = 0.55 + 0.45 * ((z0 + z1) / 2);
      g.fillStyle = cols[i];
      g.globalAlpha = 0.55 + 0.45 * light;
      g.beginPath();
      g.moveTo(0, top);
      g.lineTo(x0, mid);
      g.lineTo(x1, mid);
      g.closePath();
      g.fill();
      g.globalAlpha = 0.4 + 0.4 * light;
      g.beginPath();
      g.moveTo(0, bot);
      g.lineTo(x0, mid);
      g.lineTo(x1, mid);
      g.closePath();
      g.fill();
      g.globalAlpha = 1;
      g.strokeStyle = "rgba(255,255,255,0.8)";
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(0, top);
      g.lineTo(x0, mid);
      g.lineTo(0, bot);
      g.stroke();
    }
    g.fillStyle = "rgba(255,255,255,0.85)";
    g.beginPath();
    g.ellipse(-s * 0.06, -s * 0.2, s * 0.03, s * 0.09, 0.3, 0, TAU);
    g.fill();
  });
  const col = (c: string): HTMLCanvasElement =>
    paint(64, 460, (g) => {
      const grd = g.createLinearGradient(0, 0, 64, 0);
      grd.addColorStop(0, colorWithAlpha(c, 0));
      grd.addColorStop(0.3, colorWithAlpha(c, 0.35));
      grd.addColorStop(0.5, "rgba(255,255,255,0.85)");
      grd.addColorStop(0.7, colorWithAlpha(c, 0.35));
      grd.addColorStop(1, colorWithAlpha(c, 0));
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 460);
      g.globalCompositeOperation = "destination-out";
      for (let y = 0; y < 460; y += 5) {
        g.fillStyle = `rgba(0,0,0,${(0.25 + 0.35 * h1(y)).toFixed(3)})`;
        g.fillRect(0, y, 64, 2);
      }
    });
  const chev = (c: string, up: boolean): HTMLCanvasElement =>
    paint(48, 30, (g) => {
      g.strokeStyle = c;
      g.lineWidth = 6;
      g.lineCap = "round";
      g.lineJoin = "round";
      g.beginPath();
      if (up) {
        g.moveTo(6, 24);
        g.lineTo(24, 8);
        g.lineTo(42, 24);
      } else {
        g.moveTo(6, 6);
        g.lineTo(24, 22);
        g.lineTo(42, 6);
      }
      g.stroke();
      g.strokeStyle = "rgba(255,255,255,0.95)";
      g.lineWidth = 2;
      g.stroke();
    });
  const tex = (c: string): HTMLCanvasElement =>
    paint(64, 256, (g) => {
      const grd = g.createLinearGradient(0, 0, 64, 0);
      grd.addColorStop(0, colorWithAlpha(c, 0.15));
      grd.addColorStop(0.5, colorWithAlpha(c, 0.7));
      grd.addColorStop(1, colorWithAlpha(c, 0.15));
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 256);
      // Wabenmuster (periodisch in y: 256 = 16 Reihen)
      g.strokeStyle = "rgba(255,255,255,0.55)";
      g.lineWidth = 1;
      const R = 8;
      for (let row = -1; row < 18; row += 1) {
        for (let cI = -1; cI < 6; cI += 1) {
          const cx = cI * R * 1.5 * 1.15 + (row % 2 ? R * 0.86 : 0);
          const cy = row * 16;
          g.beginPath();
          for (let i = 0; i < 6; i += 1) {
            const a = (i / 6) * TAU;
            g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
          }
          g.closePath();
          g.stroke();
        }
      }
    });
  const plasma = paint(140, 48, (g) => {
    const trail = g.createLinearGradient(0, 0, 140, 0);
    trail.addColorStop(0, "rgba(255,62,200,0)");
    trail.addColorStop(0.55, "rgba(255,62,200,0.55)");
    trail.addColorStop(1, "rgba(255,120,90,0.9)");
    g.fillStyle = trail;
    g.beginPath();
    g.moveTo(10, 24);
    g.quadraticCurveTo(80, 8, 118, 12);
    g.lineTo(118, 36);
    g.quadraticCurveTo(80, 40, 10, 24);
    g.fill();
    const core = g.createRadialGradient(112, 24, 2, 112, 24, 22);
    core.addColorStop(0, "rgba(255,255,255,1)");
    core.addColorStop(0.35, "rgba(255,200,120,0.95)");
    core.addColorStop(0.7, "rgba(255,62,160,0.6)");
    core.addColorStop(1, "rgba(255,62,160,0)");
    g.fillStyle = core;
    g.fillRect(88, 0, 52, 48);
  });
  const hint = paint(200, 110, (g) => {
    g.fillStyle = "rgba(34,224,255,0.12)";
    g.beginPath();
    rr(g, 4, 4, 192, 102, 12);
    g.fill();
    g.strokeStyle = "rgba(34,224,255,0.95)";
    g.lineWidth = 2.5;
    g.stroke();
    // Figur-Pfeil nach oben (Cyan) und nach unten (Magenta)
    const arrow = (x: number, up: boolean, c: string): void => {
      g.strokeStyle = c;
      g.fillStyle = c;
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(x, up ? 76 : 22);
      g.lineTo(x, up ? 30 : 68);
      g.stroke();
      g.beginPath();
      if (up) {
        g.moveTo(x - 11, 34);
        g.lineTo(x, 18);
        g.lineTo(x + 11, 34);
      } else {
        g.moveTo(x - 11, 64);
        g.lineTo(x, 80);
        g.lineTo(x + 11, 64);
      }
      g.closePath();
      g.fill();
    };
    arrow(76, true, "#22e0ff");
    arrow(124, false, "#ff3ec8");
    g.fillStyle = "rgba(255,255,255,0.95)";
    g.font = "800 13px system-ui, sans-serif";
    g.textAlign = "center";
    g.fillText("SCHWERKRAFT", 100, 99);
    g.globalCompositeOperation = "destination-out";
    g.fillStyle = "rgba(0,0,0,0.35)";
    for (let y = 0; y < 110; y += 3) g.fillRect(0, y, 200, 1);
  });
  const corridor = paintOpaque(512, 460, (g) => {
    g.fillStyle = "#050c13";
    g.fillRect(0, 0, 512, 460);
    for (let i = 0; i < 4; i += 1) {
      const x = i * 128 + 10;
      const grd = g.createLinearGradient(x, 0, x + 108, 0);
      grd.addColorStop(0, "#10262c");
      grd.addColorStop(1, "#060f14");
      g.fillStyle = grd;
      g.fillRect(x, 30, 108, 400);
      g.fillStyle = "#03080b";
      for (let y = 44; y < 420; y += 22) g.fillRect(x + 6, y, 96, 3);
      for (let y = 38; y < 420; y += 22) {
        for (let k = 0; k < 8; k += 1) {
          const q = h1(i * 131 + y * 7 + k);
          if (q > 0.5) continue;
          g.fillStyle = q < 0.3 ? "rgba(61,255,176,0.9)" : q < 0.42 ? "rgba(34,224,255,0.9)" : "rgba(255,170,60,0.9)";
          g.fillRect(x + 12 + k * 11, y, 4, 3);
        }
      }
    }
    g.fillStyle = "rgba(61,255,176,0.35)";
    g.fillRect(0, 12, 512, 2);
    g.fillRect(0, 446, 512, 2);
  });
  const shaft = paintOpaque(512, 460, (g) => {
    const bg = g.createLinearGradient(0, 0, 0, 460);
    bg.addColorStop(0, "#12072a");
    bg.addColorStop(0.5, "#08031a");
    bg.addColorStop(1, "#12072a");
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 460);
    // Zickzack-Leuchtbahnen (Hinweis auf den Weg Boden ↔ Decke), periodisch in x (512)
    for (const [col, off, wid] of [
      ["rgba(34,224,255,0.22)", 0, 10],
      ["rgba(255,62,200,0.2)", 128, 10],
      ["rgba(34,224,255,0.55)", 0, 2],
      ["rgba(255,62,200,0.5)", 128, 2],
    ] as const) {
      g.strokeStyle = col;
      g.lineWidth = wid;
      g.beginPath();
      for (let x = -256 + off; x <= 768; x += 256) {
        g.moveTo(x, 440);
        g.lineTo(x + 128, 20);
        g.lineTo(x + 256, 440);
      }
      g.stroke();
    }
    // Leitungen
    for (let i = 0; i < 8; i += 1) {
      const x = i * 64 + 20;
      g.fillStyle = i % 2 ? "rgba(40,20,80,0.9)" : "rgba(28,12,60,0.9)";
      g.fillRect(x, 0, 14, 460);
      g.fillStyle = i % 2 ? "rgba(255,62,200,0.55)" : "rgba(34,224,255,0.55)";
      g.fillRect(x + 6, 0, 2, 460);
      for (let y = 30; y < 460; y += 60) {
        g.fillStyle = "rgba(10,4,22,1)";
        g.fillRect(x - 3, y, 20, 6);
      }
    }
    // Ringsegmente an Boden & Decke
    g.fillStyle = "rgba(154,91,255,0.5)";
    for (let x = 0; x < 512; x += 32) {
      g.fillRect(x, 8, 18, 3);
      g.fillRect(x, 449, 18, 3);
    }
  });
  const cubeWire = paint(120, 120, (g) => {
    g.strokeStyle = "rgba(255,255,255,0.9)";
    g.lineWidth = 2;
    g.setLineDash([6, 5]);
    cubePath(g, 60, 64, 44);
    g.stroke();
  });
  const cube = paint(120, 120, (g) => {
    drawProcCube(g, 60, 64, 44);
  });
  const softC = softSprite("rgba(34,224,255,1)");
  return {
    props: null,
    chip,
    coinStrip: coinStripOf(null, chip, softC),
    crystal,
    portalUp: portalSprite(col(CYAN), glowSprite(CYAN), softC, CYAN),
    portalDown: portalSprite(col(MAGENTA), glowSprite(MAGENTA), softSprite("rgba(255,62,200,1)"), MAGENTA),
    glowCyan: glowSprite(CYAN),
    glowMagenta: glowSprite(MAGENTA),
    glowRed: glowSprite("#ff3a3a"),
    glowWhite: glowSprite("#f4f8ff"),
    glowMint: glowSprite(MINT),
    glowViolet: glowSprite(VIOLET),
    softCyan: softSprite("rgba(34,224,255,1)"),
    softMagenta: softSprite("rgba(255,62,200,1)"),
    softRed: softSprite("rgba(255,50,80,1)"),
    softViolet: softSprite("rgba(154,91,255,1)"),
    colUp: col(CYAN),
    colDown: col(MAGENTA),
    chevUp: chev(CYAN, true),
    chevDown: chev(MAGENTA, false),
    texCyan: tex(CYAN),
    texMagenta: tex(MAGENTA),
    plasma,
    hint,
    corridor,
    shaft,
    cube,
    cubeWire,
    rack: null,
    barrier: barrierSprite(),
    hover: new Map(),
    baked: 0,
  };
}

/** Nach dem Laden der Props: Würfel/Rack/Barriere als eigene Canvas vorrendern (für Glitch-Schnitte & Spiegelung). */
export function bakePropSprites(A: CyberSkinAssets): void {
  const P = A.props;
  if (!P) return;
  A.hover.clear();
  if (P.has("data-coin")) A.coinStrip = coinStripOf(P, A.chip, A.softCyan);
  if (P.has("glitch-cube")) {
    A.cube = paint(120, 120, (g) => {
      P.draw(g, "glitch-cube", 60, 116, { h: 112 });
    });
  }
  if (P.has("server-rack")) {
    A.rack = paint(110, 124, (g) => {
      P.draw(g, "server-rack", 55, 122, { h: 124 });
    });
  }
}

const COIN_S = 64;

/** 12 Münz-Frames (Datenchip) inkl. weichem Glow in Spielgröße → pro Münze ein unskalierter Blit */
function coinStripOf(P: PropLibrary | null, chip: HTMLCanvasElement, soft: HTMLCanvasElement): HTMLCanvasElement {
  return spriteStrip(12, COIN_S, (g, f, s) => {
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.42;
    g.drawImage(soft, 0, 0, s, s);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    if (!(P && P.draw(g, "data-coin", s / 2, s / 2, { h: 45, frame: f }))) {
      g.drawImage(chip, f * CHIP, 0, CHIP, CHIP, s / 2 - 20, s / 2 - 20, 40, 40);
    }
  });
}

/** Portal-Grundkörper (Säule, Schienen, Ringe, Glühen) für additives 1:1-Blitten; Breite 180, Höhe 500 (Ringe ragen 20 px über). */
function portalSprite(column: HTMLCanvasElement, glow: HTMLCanvasElement, soft: HTMLCanvasElement, colC: string): HTMLCanvasElement {
  return paint(180, 500, (g) => {
    const cx = 90;
    const top = 20;
    const bot = 480;
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.3;
    g.drawImage(soft, cx - 78, top + 10, 156, bot - top - 20);
    g.globalAlpha = 0.85;
    g.drawImage(column, cx - 30, top, 60, bot - top);
    g.globalAlpha = 0.55;
    g.fillStyle = colC;
    g.fillRect(cx - 31, top, 2, bot - top);
    g.fillRect(cx + 29, top, 2, bot - top);
    g.globalAlpha = 1;
    for (const y of [top, bot]) {
      g.strokeStyle = colC;
      g.lineWidth = 5;
      g.beginPath();
      g.ellipse(cx, y, 44, 11, 0, 0, TAU);
      g.stroke();
      g.strokeStyle = "rgba(255,255,255,0.9)";
      g.lineWidth = 1.6;
      g.beginPath();
      g.ellipse(cx, y, 44, 11, 0, 0, TAU);
      g.stroke();
      g.globalAlpha = 0.8;
      g.drawImage(glow, cx - 58, y - 20, 116, 40);
      g.globalAlpha = 1;
    }
  });
}

function barrierSprite(): HTMLCanvasElement {
  return paint(120, 100, (g) => {
    const body = g.createLinearGradient(0, 20, 0, 100);
    body.addColorStop(0, "#2c3262");
    body.addColorStop(1, "#0d0f26");
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(6, 100);
    g.lineTo(16, 30);
    g.lineTo(104, 30);
    g.lineTo(114, 100);
    g.closePath();
    g.fill();
    g.save();
    g.beginPath();
    g.moveTo(15, 92);
    g.lineTo(21, 40);
    g.lineTo(99, 40);
    g.lineTo(105, 92);
    g.closePath();
    g.clip();
    g.fillStyle = "#14071f";
    g.fillRect(0, 40, 120, 52);
    g.fillStyle = "#ff3ec8";
    for (let x = -60; x < 140; x += 26) {
      g.beginPath();
      g.moveTo(x, 92);
      g.lineTo(x + 12, 92);
      g.lineTo(x + 12 + 52, 40);
      g.lineTo(x + 52, 40);
      g.closePath();
      g.fill();
    }
    const shade = g.createLinearGradient(0, 40, 0, 92);
    shade.addColorStop(0, "rgba(255,255,255,0.18)");
    shade.addColorStop(1, "rgba(0,0,0,0.35)");
    g.fillStyle = shade;
    g.fillRect(0, 40, 120, 52);
    g.restore();
    g.strokeStyle = "rgba(200,220,255,0.35)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(6, 100);
    g.lineTo(16, 30);
    g.lineTo(104, 30);
    g.lineTo(114, 100);
    g.stroke();
    g.fillStyle = "#1a1d3a";
    g.fillRect(9, 12, 10, 20);
    g.fillRect(101, 12, 10, 20);
    g.fillStyle = "#22e0ff";
    g.fillRect(12, 22, 96, 8);
    g.fillStyle = "#ffffff";
    g.fillRect(14, 24, 92, 3);
  });
}

function cubePath(g: Ctx2D, cx: number, cy: number, s: number): void {
  const dx = s * 0.86;
  const dy = s * 0.5;
  g.beginPath();
  g.moveTo(cx, cy - s);
  g.lineTo(cx + dx, cy - s + dy);
  g.lineTo(cx + dx, cy + dy);
  g.lineTo(cx, cy + s);
  g.lineTo(cx - dx, cy + dy);
  g.lineTo(cx - dx, cy - s + dy);
  g.closePath();
  g.moveTo(cx, cy);
  g.lineTo(cx, cy + s);
  g.moveTo(cx, cy);
  g.lineTo(cx + dx, cy - s + dy);
  g.moveTo(cx, cy);
  g.lineTo(cx - dx, cy - s + dy);
}

function drawProcCube(g: Ctx2D, cx: number, cy: number, s: number): void {
  const dx = s * 0.86;
  const dy = s * 0.5;
  const face = (pts: number[], c0: string, c1: string): void => {
    const grd = g.createLinearGradient(pts[0], pts[1], pts[4], pts[5]);
    grd.addColorStop(0, c0);
    grd.addColorStop(1, c1);
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.closePath();
    g.fill();
  };
  face([cx, cy - s, cx + dx, cy - s + dy, cx, cy, cx - dx, cy - s + dy], "#7af7ff", "#6a4cff");
  face([cx - dx, cy - s + dy, cx, cy, cx, cy + s, cx - dx, cy + dy], "#3ab8ff", "#b04dff");
  face([cx, cy, cx + dx, cy - s + dy, cx + dx, cy + dy, cx, cy + s], "#ff5ad8", "#6a1aa8");
  g.strokeStyle = "rgba(255,255,255,0.9)";
  g.lineWidth = 2.5;
  cubePath(g, cx, cy, s);
  g.stroke();
  g.strokeStyle = "rgba(255,62,200,0.8)";
  g.lineWidth = 1;
  for (let i = 1; i < 4; i += 1) {
    g.beginPath();
    g.moveTo(cx - dx + 6, cy - s + dy + i * 16);
    g.lineTo(cx - 6, cy + i * 16 - 6);
    g.stroke();
  }
}

// ------------------------------------------------------------------------------------------------

export interface SkinCtx {
  beat: number;
  time: number;
  quality: 0 | 1 | 2;
  reduced: boolean;
  groundY: number;
  ceilY: number;
  glitch: number;
}

function add(g: Ctx2D): void {
  g.globalCompositeOperation = "lighter";
}
function norm(g: Ctx2D): void {
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;
}

/** Datenchip-Münze (vorgebackener Streifen inkl. Glow, 1:1) */
export function drawChip(g: Ctx2D, A: CyberSkinAssets, e: Ent, sx: number, sy: number, k: SkinCtx): void {
  const cx = Math.round(sx + e.w / 2);
  const cy = Math.round(sy + e.h / 2 + (k.reduced ? 0 : Math.sin(k.time * 3 + e.id) * 2));
  const f = Math.floor(mod(k.time * 12 + e.id * 1.7, 12));
  g.drawImage(A.coinStrip, f * COIN_S, 0, COIN_S, COIN_S, cx - COIN_S / 2, cy - COIN_S / 2, COIN_S, COIN_S);
}

/** Kristall (Edelstein) */
export function drawCrystal(g: Ctx2D, A: CyberSkinAssets, e: Ent, sx: number, sy: number, k: SkinCtx): void {
  const cx = sx + e.w / 2;
  const cy = sy + e.h / 2 + (k.reduced ? 0 : Math.sin(k.time * 2.2 + e.id) * 4);
  add(g);
  g.globalAlpha = 0.55;
  glowAt(g, A.softMagenta, cx, cy, e.w * 1.3);
  g.globalAlpha = 0.45;
  glowAt(g, A.softCyan, cx, cy, e.w * 0.9);
  norm(g);
  const f = Math.floor(mod(k.time * 8 + e.id, 16));
  drawStripFrame(g, A.crystal, CRYSTAL, f, cx, cy, e.w * 1.55);
  if (!k.reduced) {
    const tw = 0.5 + 0.5 * Math.sin(k.time * 7 + e.id);
    add(g);
    g.globalAlpha = tw;
    glowAt(g, A.glowWhite, cx + e.w * 0.28, cy - e.h * 0.3, 7 + tw * 5);
    norm(g);
  }
}

/** Schwerkraft-Portal: Ringe an Boden & Decke, Energiesäule (vorgebacken), Chevrons in Flip-Richtung, Sog-Partikel. */
export function drawPortal(g: Ctx2D, A: CyberSkinAssets, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
  const dir = e.p.dir === -1 || e.p.dir === 1 ? e.p.dir : v.gravDir === 1 ? 1 : -1;
  const used = e.state === "used";
  const a = used ? Math.max(0, 1 - e.stateT / 0.55) : 1;
  if (a <= 0.01) return;
  const grow = used ? 1 + e.stateT * 2.2 : 1;
  const cx = Math.round(sx + e.w / 2);
  const top = sy;
  const bot = sy + e.h;
  const up = dir === 1;
  const glow = up ? A.glowCyan : A.glowMagenta;
  const pulse = k.reduced ? 0.85 : 0.75 + 0.25 * k.beat;
  // Sockel (Emitter) an Boden und Decke
  g.fillStyle = "#0a0b1c";
  g.beginPath();
  rr(g, cx - 40, bot - 8, 80, 16, 6);
  rr(g, cx - 40, top - 8, 80, 16, 6);
  g.fill();
  add(g);
  g.globalAlpha = a * pulse;
  const spr = up ? A.portalUp : A.portalDown;
  if (grow === 1 && e.h === 460) g.drawImage(spr, cx - 90, top - 20);
  else g.drawImage(spr, cx - 90 * grow, top - 20, 180 * grow, e.h + 40);
  // Chevrons wandern in Flip-Richtung
  if (!used) {
    const chev = up ? A.chevUp : A.chevDown;
    const sp = 96;
    const span = e.h - 60;
    const off = k.reduced ? 0 : v.time * 260;
    const n = Math.floor(span / sp);
    for (let i = 0; i < n; i += 1) {
      const d = mod(i * sp + off, span);
      const yy = up ? bot - 30 - d : top + 30 + d;
      const edge = Math.min(1, Math.min(yy - top, bot - yy) / 60);
      g.globalAlpha = 0.9 * edge;
      g.drawImage(chev, cx - 24, Math.round(yy - 15));
    }
  }
  // Sog-Partikel
  if (k.quality > 0 && !used) {
    const n = k.quality === 2 ? 12 : 6;
    for (let i = 0; i < n; i += 1) {
      const ph = mod(v.time * 0.8 + h1(i + e.id * 7), 1);
      const rad = (1 - ph) * 110;
      const ang = i * 2.39 + v.time * (k.reduced ? 0.3 : 2.2);
      const py = top + 30 + h1(i * 3 + e.id) * (e.h - 60);
      g.globalAlpha = Math.sin(ph * Math.PI) * 0.9;
      glowAt(g, i % 3 ? glow : A.glowWhite, cx + Math.cos(ang) * rad, py + Math.sin(ang) * rad * 0.3, 5);
    }
  }
  norm(g);
}

function zoneAnchor(e: Ent, k: SkinCtx): "floor" | "ceil" | "free" {
  if (e.ceil || e.y <= k.ceilY + 1) return "ceil";
  if (e.y + e.h >= k.groundY - 1) return "floor";
  return "free";
}

/** Phasen-Tor (Energievorhang), rhythmisch aktiv */
export function drawPhaseGate(g: Ctx2D, A: CyberSkinAssets, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
  const cyan = e.skin === "phase-cyan";
  const colC = cyan ? CYAN : MAGENTA;
  const tex = cyan ? A.texCyan : A.texMagenta;
  const glow = cyan ? A.glowCyan : A.glowMagenta;
  const soft = cyan ? A.softCyan : A.softMagenta;
  const anchor = zoneAnchor(e, k);
  const cx = sx + e.w / 2;
  const st = e.state;
  const pt = e.fx.phaseT ?? 0;
  // Emitter-Knoten an beiden Enden
  const nodeW = e.w + 16;
  g.fillStyle = "#0b0c1e";
  g.beginPath();
  rr(g, cx - nodeW / 2, sy - 8, nodeW, 14, 5);
  rr(g, cx - nodeW / 2, sy + e.h - 6, nodeW, 14, 5);
  g.fill();
  if (anchor !== "free") {
    // Verankerung (Sockel am Boden bzw. an der Decke)
    g.fillStyle = "#15173a";
    if (anchor === "floor") g.fillRect(cx - nodeW / 2 - 4, sy + e.h - 4, nodeW + 8, 6);
    else g.fillRect(cx - nodeW / 2 - 4, sy - 2, nodeW + 8, 6);
  }
  g.fillStyle = colC;
  g.fillRect(cx - nodeW / 2 + 4, sy - 3, nodeW - 8, 3);
  g.fillRect(cx - nodeW / 2 + 4, sy + e.h, nodeW - 8, 3);
  add(g);
  if (st === "active") {
    const flick = k.reduced ? 1 : 0.85 + 0.15 * Math.sin(v.time * 40 + e.id);
    if (k.quality === 2 && e.h < 200) {
      g.globalAlpha = 0.5 * flick;
      glowAt(g, soft, cx, sy + e.h / 2, e.w * 1.6, e.h * 0.62);
    }
    g.globalAlpha = 0.95 * flick;
    const scroll = k.reduced ? 0 : mod(v.time * 140 * (cyan ? -1 : 1), 256);
    drawTexV(g, tex, sx, sy, e.w, e.h, scroll);
    g.globalAlpha = 0.9;
    g.fillStyle = "#ffffff";
    g.fillRect(cx - 1.5, sy, 3, e.h);
    g.globalAlpha = 1;
    glowAt(g, glow, cx, sy, 26, 14);
    glowAt(g, glow, cx, sy + e.h, 26, 14);
  } else if (st === "warn") {
    const blink = k.reduced ? 0.5 : Math.floor(v.time * 14) % 2 ? 0.65 : 0.25;
    g.globalAlpha = (0.25 + 0.45 * pt) * blink;
    drawTexV(g, tex, sx, sy, e.w, e.h, 0);
    g.globalAlpha = 0.5 + 0.5 * pt;
    g.fillStyle = colC;
    for (let y = sy; y < sy + e.h; y += 14) g.fillRect(cx - 1, y, 2, 7);
    glowAt(g, glow, cx, sy, 18 + 10 * pt, 10);
    glowAt(g, glow, cx, sy + e.h, 18 + 10 * pt, 10);
  } else {
    g.globalAlpha = 0.35;
    g.fillStyle = colC;
    for (let y = sy; y < sy + e.h; y += 22) g.fillRect(cx - 1, y, 2, 4);
    g.globalAlpha = 0.5;
    glowAt(g, glow, cx, sy, 12, 8);
    glowAt(g, glow, cx, sy + e.h, 12, 8);
  }
  norm(g);
}

function drawTexV(g: Ctx2D, tex: HTMLCanvasElement, x: number, y: number, w: number, h: number, scroll: number): void {
  // vertikal kacheln (Textur 64×256), in die Breite w gestreckt
  let yy = 0;
  let src = scroll;
  let guard = 0;
  while (yy < h && guard < 8) {
    const take = Math.min(256 - src, h - yy);
    g.drawImage(tex, 0, src, 64, take, x, y + yy, w, take);
    yy += take;
    src = 0;
    guard += 1;
  }
}

/** Laser am Boden bzw. an der Decke (Zone, rhythmisch): Emitter an beiden Enden, Strahl im aktiven Takt. */
export function drawLaser(g: Ctx2D, A: CyberSkinAssets, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
  const anchor = zoneAnchor(e, k);
  const ceil = anchor === "ceil";
  const cy = sy + e.h / 2;
  const x0 = sx;
  const x1 = sx + e.w;
  const st = e.state;
  const pt = e.fx.phaseT ?? 0;
  // Bodenplatte / Deckenplatte mit Warnstreifen
  const plateY = ceil ? sy - 2 : sy + e.h - 4;
  g.fillStyle = "#12050d";
  g.fillRect(x0, plateY, e.w, 6);
  g.fillStyle = st === "idle" ? "rgba(255,60,90,0.35)" : "rgba(255,60,90,0.8)";
  for (let x = x0 + 4; x < x1 - 8; x += 16) g.fillRect(x, plateY + 1, 8, 3);
  // Emitter (sechseckige Pylonen mit Linse)
  for (const ex of [x0 - 9, x1 + 9]) {
    g.fillStyle = "#15172e";
    g.beginPath();
    g.moveTo(ex - 9, cy - 20);
    g.lineTo(ex + 9, cy - 20);
    g.lineTo(ex + 12, cy - 8);
    g.lineTo(ex + 12, cy + 8);
    g.lineTo(ex + 9, cy + 20);
    g.lineTo(ex - 9, cy + 20);
    g.lineTo(ex - 12, cy + 8);
    g.lineTo(ex - 12, cy - 8);
    g.closePath();
    g.fill();
    g.fillStyle = "#2a2e58";
    g.fillRect(ex - 9, cy - 20, 18, 3);
    g.fillStyle = st === "idle" ? "#5a1020" : "#ff3a5a";
    g.fillRect(ex - 4, cy - 4, 8, 8);
  }
  add(g);
  const lensA = st === "active" ? 1 : st === "warn" ? 0.3 + 0.7 * pt : 0.25;
  g.globalAlpha = lensA;
  glowAt(g, A.glowRed, x0 - 2, cy, 14 + 8 * lensA);
  glowAt(g, A.glowRed, x1 + 2, cy, 14 + 8 * lensA);
  if (st === "active") {
    const crack = k.reduced ? 1 : 0.8 + 0.2 * Math.sin(v.time * 55 + e.id);
    g.globalAlpha = 0.6 * crack;
    g.drawImage(A.softRed, x0, cy - 22, e.w, 44);
    g.globalAlpha = 1;
    g.fillStyle = "rgba(255,60,90,0.95)";
    g.fillRect(x0, cy - 4, e.w, 8);
    g.fillStyle = "#ffffff";
    g.fillRect(x0, cy - 1.5, e.w, 3);
    if (k.quality > 0 && !k.reduced) {
      for (let i = 0; i < 5; i += 1) {
        const px = x0 + mod(h1(i + e.id) * e.w + v.time * 420, e.w);
        g.globalAlpha = 0.8;
        glowAt(g, A.glowWhite, px, cy + Math.sin(v.time * 30 + i) * 3, 6);
      }
    }
  } else if (st === "warn") {
    g.globalAlpha = 0.35 + 0.5 * pt;
    g.fillStyle = "rgba(255,60,90,0.9)";
    for (let x = x0; x < x1; x += 18) g.fillRect(x, cy - 1, 9, 2);
  }
  norm(g);
}

/** Laser-Lichtschranke (rhythmisch): Hover-Emitter links/rechts, mehrere waagrechte Strahlen → drunter durchrutschen. */
export function drawBeamFence(g: Ctx2D, A: CyberSkinAssets, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
  const n = Math.max(2, Math.round(e.h / 38));
  const x0 = sx;
  const x1 = sx + e.w;
  const st = e.state;
  const pt = e.fx.phaseT ?? 0;
  for (const ex of [x0 - 7, x1 + 7]) {
    g.fillStyle = "#16182e";
    g.beginPath();
    rr(g, ex - 8, sy - 12, 16, e.h + 24, 7);
    g.fill();
    g.fillStyle = "#2c2f55";
    g.fillRect(ex - 8, sy - 12, 16, 4);
    g.fillRect(ex - 8, sy + e.h + 8, 16, 4);
  }
  add(g);
  if (st === "active") {
    const flick = k.reduced ? 1 : 0.85 + 0.15 * Math.sin(v.time * 33 + e.id);
    g.globalAlpha = 0.4 * flick;
    g.drawImage(A.softMagenta, x0 - 14, sy - 16, e.w + 28, e.h + 32);
    for (let i = 0; i < n; i += 1) {
      const y = sy + 5 + (i / (n - 1)) * (e.h - 10);
      g.globalAlpha = 0.95 * flick;
      g.fillStyle = "rgba(255,62,200,0.95)";
      g.fillRect(x0 - 4, y - 3, e.w + 8, 6);
      g.fillStyle = "#ffffff";
      g.fillRect(x0 - 4, y - 1, e.w + 8, 2);
      g.globalAlpha = 1;
      glowAt(g, A.glowMagenta, x0 - 7, y, 11);
      glowAt(g, A.glowMagenta, x1 + 7, y, 11);
    }
  } else {
    const warn = st === "warn";
    for (let i = 0; i < n; i += 1) {
      const y = sy + 5 + (i / (n - 1)) * (e.h - 10);
      const blink = k.reduced ? 0.6 : Math.floor(v.time * 12 + i) % 2 ? 1 : 0.35;
      g.globalAlpha = warn ? (0.3 + 0.6 * pt) * blink : 0.35;
      glowAt(g, A.glowMagenta, x0 - 7, y, warn ? 7 + 5 * pt : 5);
      glowAt(g, A.glowMagenta, x1 + 7, y, warn ? 7 + 5 * pt : 5);
      if (warn) {
        g.fillStyle = "rgba(255,62,200,0.8)";
        for (let x = x0; x < x1; x += 10) g.fillRect(x, y - 1, 5, 2);
      }
    }
  }
  norm(g);
}

/** Glitch-Würfel: aktiv = massiv (mit RGB-Versatz), Warnung = flackernd, Leerlauf = gestrichelter Drahtrahmen. */
export function drawGlitchCube(g: Ctx2D, A: CyberSkinAssets, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
  const st = e.state;
  const pt = e.fx.phaseT ?? 0;
  const cx = sx + e.w / 2;
  const cy = sy + e.h / 2;
  const S = e.w * 1.3;
  const x = cx - S / 2;
  const y = cy - S / 2;
  const solid = st === "active" || (st === "warn" && !k.reduced && Math.floor(v.time * (10 + pt * 16) + e.id) % 2 === 0);
  if (solid) {
    const jit = k.reduced ? 0 : st === "warn" ? 4 : 2 + k.glitch * 4;
    if (k.quality > 0) {
      add(g);
      g.globalAlpha = 0.55;
      glowAt(g, A.softViolet, cx, cy, e.w * 1.05);
      g.globalAlpha = 0.4;
      g.drawImage(A.cubeWire, x - jit * 1.5, y, S, S);
      norm(g);
    }
    // In Scheiben mit Versatz zeichnen (Glitch)
    const slices = k.reduced || k.quality === 0 ? 1 : 4;
    const sh = 120 / slices;
    for (let i = 0; i < slices; i += 1) {
      const off = slices === 1 ? 0 : (h1(Math.floor(v.time * 9) + i * 7 + e.id) - 0.5) * jit * 2;
      g.drawImage(A.cube, 0, i * sh, 120, sh, x + off, y + (i * sh * S) / 120, S, (sh * S) / 120 + 0.5);
    }
    if (k.quality > 0) {
      add(g);
      g.globalAlpha = 0.35;
      g.fillStyle = CYAN;
      g.fillRect(x + S * 0.2 - jit, cy - 2, S * 0.6, 2);
      g.fillStyle = MAGENTA;
      g.fillRect(x + S * 0.2 + jit, cy + 8, S * 0.6, 2);
      norm(g);
    }
  } else {
    g.globalAlpha = st === "warn" ? 0.55 : 0.32;
    g.drawImage(A.cubeWire, x, y, S, S);
    g.globalAlpha = 1;
    if (st === "warn") {
      add(g);
      g.globalAlpha = 0.5 * pt;
      glowAt(g, A.softViolet, cx, cy, e.w * 0.8);
      norm(g);
    }
  }
}

/** Drohne (Flieger) */
export function drawDrone(g: Ctx2D, A: CyberSkinAssets, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
  const cx = sx + e.w / 2;
  const cy = sy + e.h / 2;
  const defeated = e.state === "defeated";
  const rot = defeated ? e.stateT * 7 : Math.sin(v.time * 3 + e.id) * 0.08;
  add(g);
  if (k.quality === 2) {
    g.globalAlpha = defeated ? 0.3 : 0.5;
    glowAt(g, A.softCyan, cx, cy, e.w * 0.95, e.h * 0.9);
  }
  g.globalAlpha = 0.65 + 0.35 * k.beat;
  glowAt(g, A.softRed, cx - e.w * 0.08, cy + e.h * 0.08, e.w * 0.45);
  norm(g);
  if (A.props && A.props.draw(g, "drone-hover", cx, cy, { h: e.h * 1.75, t: v.time + e.id * 0.21, rotation: rot })) {
    add(g);
    g.globalAlpha = 0.9;
    glowAt(g, A.glowRed, cx - e.w * 0.1, cy + e.h * 0.06, 10 + 4 * k.beat);
    norm(g);
    return;
  }
  g.save();
  g.translate(cx, cy);
  g.rotate(rot);
  g.fillStyle = "#1c1f38";
  g.beginPath();
  g.ellipse(0, 4, e.w * 0.32, e.h * 0.34, 0, 0, TAU);
  g.fill();
  g.fillStyle = "#2c3058";
  g.fillRect(-e.w * 0.5, -e.h * 0.16, e.w, 8);
  for (const s of [-1, 1]) {
    g.fillStyle = "#101226";
    g.fillRect(s * e.w * 0.46 - 8, -e.h * 0.3, 16, 8);
    g.fillStyle = "rgba(200,220,255,0.35)";
    const blade = k.reduced ? 16 : 10 + 8 * Math.abs(Math.sin(v.time * 40 + s));
    g.fillRect(s * e.w * 0.46 - blade, -e.h * 0.34, blade * 2, 3);
  }
  g.fillStyle = "#ff2a3a";
  g.beginPath();
  g.arc(-e.w * 0.06, 6, e.h * 0.16, 0, TAU);
  g.fill();
  g.fillStyle = "#ffd0d0";
  g.beginPath();
  g.arc(-e.w * 0.09, 3, e.h * 0.05, 0, TAU);
  g.fill();
  g.restore();
}

/** Neon-Barriere (Block, zerstörbar): Straßensperre mit Warnstreifen und Neon-Oberkante */
export function drawBarrier(g: Ctx2D, A: CyberSkinAssets, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
  const ceil = e.ceil;
  const cx = sx + e.w / 2;
  add(g);
  g.globalAlpha = 0.4 + 0.2 * k.beat;
  glowAt(g, A.softMagenta, cx, sy + e.h / 2, e.w * 0.95, e.h * 0.85);
  norm(g);
  const W = e.w * 1.14;
  const H = e.h * 1.1;
  if (ceil) {
    g.save();
    g.translate(cx, sy);
    g.scale(1, -1);
    g.drawImage(A.barrier, -W / 2, -H, W, H);
    g.restore();
  } else g.drawImage(A.barrier, cx - W / 2, sy + e.h - H, W, H);
  add(g);
  g.globalAlpha = 0.55 + 0.45 * k.beat;
  const ty = ceil ? sy + e.h - e.h * 0.2 : sy + e.h * 0.2;
  glowAt(g, A.glowCyan, sx + e.w * 0.1, ty, 9);
  glowAt(g, A.glowCyan, sx + e.w * 0.9, ty, 9);
  norm(g);
}

/** Server-Rack (Block) mit blinkenden LEDs */
export function drawRack(g: Ctx2D, A: CyberSkinAssets, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
  const ceil = e.ceil;
  const cx = sx + e.w / 2;
  add(g);
  g.globalAlpha = 0.4;
  glowAt(g, A.softCyan, cx, sy + e.h / 2, e.w * 0.9, e.h * 0.75);
  norm(g);
  if (A.rack) {
    const H = e.h * 1.12;
    const W = H * (110 / 124);
    if (ceil) {
      g.save();
      g.translate(cx, sy);
      g.scale(1, -1);
      g.drawImage(A.rack, -W / 2, -H, W, H);
      g.restore();
    } else g.drawImage(A.rack, cx - W / 2, sy + e.h - H, W, H);
  } else {
    g.fillStyle = "#1a1d33";
    g.beginPath();
    rr(g, sx + 2, sy, e.w - 4, e.h, 6);
    g.fill();
    g.fillStyle = "#0b0c18";
    for (let y = sy + 10; y < sy + e.h - 8; y += 16) g.fillRect(sx + 8, y, e.w - 16, 10);
    g.strokeStyle = "rgba(34,224,255,0.8)";
    g.lineWidth = 2;
    g.strokeRect(sx + 3, sy + 1, e.w - 6, e.h - 2);
  }
  // LED-Blinken
  if (k.quality > 0) {
    add(g);
    const rows = Math.max(3, Math.floor(e.h / 22));
    for (let i = 0; i < rows; i += 1) {
      const on = k.reduced ? 1 : h1(Math.floor(v.time * 6) + i * 13 + e.id) > 0.4 ? 1 : 0.25;
      const ly = ceil ? sy + e.h - 14 - i * (e.h - 24) / rows : sy + 14 + i * ((e.h - 24) / rows);
      g.globalAlpha = 0.8 * on;
      glowAt(g, i % 3 === 0 ? A.glowRed : i % 3 === 1 ? A.glowMint : A.glowCyan, sx + e.w * 0.28, ly, 5);
    }
    norm(g);
  }
}

/** Plasma-Geschoss */
export function drawPlasma(g: Ctx2D, A: CyberSkinAssets, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
  const cx = sx + e.w / 2;
  const cy = sy + e.h / 2;
  add(g);
  const fl = k.reduced ? 1 : 0.85 + 0.15 * Math.sin(v.time * 50 + e.id);
  g.globalAlpha = fl;
  const W = e.w * 2.4;
  const H = e.h * 1.5;
  g.save();
  g.translate(cx, cy);
  g.scale(-1, 1);
  g.drawImage(A.plasma, -W * 0.82, -H / 2, W, H);
  g.restore();
  glowAt(g, A.glowMagenta, cx - e.w * 0.2, cy, e.h * 0.9);
  norm(g);
}

/** Prop der Schwebe-Plattform (Seitenansicht, 512×119-Zelle mit 5 px Rand) */
export const HOVER_PROP = "cyber-hover";
/** Zellzeile der begehbaren Fläche (Mitte der Oberseite): dort steht die Figur, sie liegt auf `e.y` */
const HOVER_SURF = 17;
/** Düsenmitten im Zellraster (x, y) */
const HOVER_NOZZLES: Array<[number, number]> = [
  [75, 68],
  [255, 72],
  [435, 68],
];

/**
 * Pixeldichte, in der die Schwebe-Plattformen gebacken werden: Skala des Zeichenkontexts, auf Viertel gerundet, 1 … 2
 * (beim Zeichnen aus der Transformation, in `resize` aus der gemeldeten Skala – dieselbe Rechnung).
 */
export function hoverDensity(scale: number): number {
  if (!(scale > 0)) return 1;
  return Math.max(1, Math.min(2, Math.round(scale * 4) / 4));
}

/** `hoverSprite` wartet noch auf den Bake (im nächsten Frame) */
const HOVER_WAIT = false;

/**
 * Schwebe-Plattform aus dem Prop backen (zweistufig verkleinert, 1:1 geblittet). Breite = Trefferbreite (Plattenkante
 * bis Plattenkante), Höhe folgt dem Seitenverhältnis. Rückgabe null, wenn das Prop fehlt.
 * Die Breite variiert mit dem Tempo (150 … 230 px), die Plattformen lassen sich also nicht vorbacken. Steht die Plattform noch
 * ganz rechts außerhalb des Bildes (`x` ≥ VIEW_W; die Engine zeichnet sie schon 260 px davor), wird höchstens EIN Bake je Frame
 * ausgeführt – die übrigen warten (Rückgabe false, unsichtbar) –, sichtbare Plattformen werden immer sofort gebacken.
 */
function hoverSprite(A: CyberSkinAssets, w: number, kd: number, x: number): { c: HTMLCanvasElement; s: number } | null | typeof HOVER_WAIT {
  const P = A.props;
  if (!P || !P.has(HOVER_PROP)) return null;
  const cell = P.cell(HOVER_PROP);
  if (!cell) return null;
  const s = w / (cell.w - 10);
  const key = `${Math.round(w)}|${kd}`;
  let c = A.hover.get(key);
  if (!c) {
    if (x >= VIEW_W && A.baked > 0) return HOVER_WAIT;
    A.baked += 1;
    const dw = Math.max(2, Math.round(cell.w * s * kd));
    const dh = Math.max(2, Math.round(cell.h * s * kd));
    const big = paint(dw * 2, dh * 2, (bg) => {
      bg.imageSmoothingQuality = "high";
      P.draw(bg, HOVER_PROP, 0, 0, { w: dw * 2, ax: 0, ay: 0 });
    });
    c = paint(dw, dh, (cg) => {
      cg.imageSmoothingQuality = "high";
      cg.drawImage(big, 0, 0, dw, dh);
    });
    if (A.hover.size > 48) A.hover.clear();
    A.hover.set(key, c);
  }
  return { c, s };
}

/** Schwebe-Plattform: Glasplatte mit Neonkante, Metallkiel und drei Schubdüsen (Prop; sonst prozedural) */
export function drawHover(g: Ctx2D, A: CyberSkinAssets, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
  const falling = e.state === "fallen";
  const warn = e.state === "crumbling";
  const tk = typeof g.getTransform === "function" ? g.getTransform().a : 1;
  const kd = hoverDensity(tk);
  const spr = hoverSprite(A, e.w, kd, sx);
  if (spr === HOVER_WAIT) return; // noch außerhalb des Bildes: der Bake folgt im nächsten Frame
  if (spr) {
    const s = spr.s;
    const cell = A.props?.cell(HOVER_PROP);
    const jit = warn && !k.reduced ? Math.sin(v.time * 60 + e.id) * 1.5 : 0;
    const X = Math.round((sx - 5 * s + jit) * kd) / kd;
    const Y = Math.round((sy - HOVER_SURF * s) * kd) / kd;
    const dw = spr.c.width / kd;
    const dh = spr.c.height / kd;
    // Unterseiten-Leuchten (hinter dem Körper)
    add(g);
    g.globalAlpha = falling ? 0.12 : 0.32 + 0.2 * k.beat;
    g.drawImage(A.softCyan, sx - 10, sy - 4, e.w + 20, dh - HOVER_SURF * s + 14);
    norm(g);
    if (falling) g.globalAlpha = 0.55;
    g.drawImage(spr.c, X, Y, dw, dh);
    norm(g);
    if (warn) {
      // Absturz-Warnung: Platte glüht magenta
      add(g);
      g.globalAlpha = k.reduced ? 0.35 : 0.25 + 0.25 * Math.sin(v.time * 22);
      glowAt(g, A.softMagenta, sx + e.w / 2, sy + 4, e.w * 0.62, 16);
      norm(g);
    }
    // Schubdüsen: Glimmen im Takt (die Kegel selbst sind im Sprite)
    if (k.quality > 0 && !falling) {
      const cw = cell?.w ?? 512;
      add(g);
      for (const [nx, ny] of HOVER_NOZZLES) {
        const px = X + (nx / cw) * dw;
        const py = Y + ((ny + 6) / (cell?.h ?? 119)) * dh;
        g.globalAlpha = 0.3 + 0.25 * k.beat;
        glowAt(g, A.glowMagenta, px, py, 13 * Math.max(0.8, s * 3.2), 9 * Math.max(0.8, s * 3.2));
        if (!k.reduced) {
          g.globalAlpha = 0.28;
          g.drawImage(A.softMagenta, px - 6, py + 4, 12, 20 + 6 * Math.sin(v.time * 20 + nx * 0.09));
        }
      }
      norm(g);
    }
    return;
  }
  // Unterseiten-Leuchten (hinter dem Körper)
  add(g);
  g.globalAlpha = falling ? 0.15 : 0.45 + 0.25 * k.beat;
  g.drawImage(A.softCyan, sx - 10, sy - 6, e.w + 20, e.h + 34);
  norm(g);
  // Kiel (Metall)
  g.fillStyle = "#141833";
  g.beginPath();
  g.moveTo(sx + 10, sy + 10);
  g.lineTo(sx + e.w - 10, sy + 10);
  g.lineTo(sx + e.w - 26, sy + e.h);
  g.lineTo(sx + 26, sy + e.h);
  g.closePath();
  g.fill();
  g.fillStyle = "#262c5a";
  g.fillRect(sx + 18, sy + 12, e.w - 36, 3);
  // Glasplatte
  g.fillStyle = warn ? "rgba(255,120,200,0.55)" : "rgba(120,220,255,0.5)";
  g.beginPath();
  rr(g, sx, sy, e.w, 11, 5);
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.55)";
  g.fillRect(sx + 8, sy + 2, e.w * 0.4, 2);
  add(g);
  g.fillStyle = warn ? MAGENTA : CYAN;
  g.fillRect(sx + 2, sy, e.w - 4, 2);
  g.fillRect(sx + 2, sy + 10, e.w - 4, 2);
  g.fillStyle = MAGENTA;
  g.fillRect(sx + 28, sy + e.h - 2, e.w - 56, 2);
  // Schubdüsen
  g.globalAlpha = falling ? 0.2 : 0.8 + 0.2 * k.beat;
  for (const f of [0.22, 0.5, 0.78]) glowAt(g, A.glowCyan, sx + e.w * f, sy + e.h + 2, 12, 8);
  if (k.quality > 0 && !k.reduced && !falling) {
    g.globalAlpha = 0.4;
    for (const f of [0.22, 0.5, 0.78]) g.drawImage(A.softCyan, sx + e.w * f - 7, sy + e.h, 14, 26 + 6 * Math.sin(v.time * 20 + f * 9));
  }
  norm(g);
}

/** Holo-Schild „Schwerkraft“ vor den ersten Portalen */
export function drawHint(g: Ctx2D, A: CyberSkinAssets, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
  const fl = k.reduced ? 0.9 : 0.78 + 0.22 * Math.sin(v.time * 9 + e.id) * (h1(Math.floor(v.time * 5)) > 0.85 ? 1 : 0.2);
  add(g);
  g.globalAlpha = 0.3;
  glowAt(g, A.softCyan, sx + e.w / 2, sy + e.h / 2, e.w * 0.7, e.h * 0.8);
  g.globalAlpha = fl;
  g.drawImage(A.hint, sx, sy, e.w, e.h);
  // Projektorstrahl nach unten
  g.globalAlpha = 0.18;
  g.drawImage(A.softCyan, sx + e.w * 0.3, sy + e.h, e.w * 0.4, k.groundY - sy - e.h);
  norm(g);
}

/** Setpiece-Kulisse (Serverkorridor bzw. Zickzack-Schacht) hinter dem Spielfeld, mit Schott-Rahmen an den Enden */
export function drawHall(g: Ctx2D, A: CyberSkinAssets, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
  void k;
  const shaft = e.skin === "shaft";
  const tile = shaft ? A.shaft : A.corridor;
  const x0 = Math.max(-10, Math.round(sx));
  const x1 = Math.min(v.w + 10, Math.round(sx + e.w));
  if (x1 > x0) {
    const scroll = v.dist * 0.82;
    const off = Math.round(mod(scroll, 512));
    let x = x0;
    let guard = 0;
    while (x < x1 && guard < 8) {
      const u = mod(x + off, 512);
      const w = Math.min(512 - u, x1 - x);
      g.drawImage(tile, u, 0, w, 460, x, sy, w, e.h);
      x += w;
      guard += 1;
    }

  }
  // Schott-Rahmen an Ein- und Ausgang
  const col = shaft ? VIOLET : MINT;
  for (const fx of [sx, sx + e.w]) {
    if (fx < -60 || fx > v.w + 60) continue;
    g.fillStyle = "rgba(8,10,24,0.92)";
    g.fillRect(fx - 10, sy, 20, e.h);
    add(g);
    g.globalAlpha = 0.9;
    g.fillStyle = col;
    g.fillRect(fx - 2, sy, 4, e.h);
    g.globalAlpha = 0.6;
    glowAt(g, shaft ? A.glowViolet : A.glowMint, fx, sy + 10, 24, 14);
    glowAt(g, shaft ? A.glowViolet : A.glowMint, fx, sy + e.h - 10, 24, 14);
    norm(g);
  }
}

export const SKIN_COLORS = { CYAN, MAGENTA, HOT, MINT, VIOLET };
