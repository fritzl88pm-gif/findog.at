/**
 * Cyber-Wien 2099 – vorgerenderte Kulissen (einmal auf Offscreen-Canvas gemalt, pro Frame nur geblittet).
 * Alle Kacheln sind horizontal nahtlos (wrapDraw / periodische Funktionen).
 */
import type { PropLibrary } from "../../types";
import { makeCanvas } from "../../draw-utils";
import { colorWithAlpha, ctxOf, paint, rr, wrapDraw, type Ctx2D } from "../shared-b/canvas";
import { hexRgb, mulberry, type RGB } from "../shared-b/color";
import { CYAN, MAGENTA, MINT, TAU, VIOLET } from "./palette";

/** Deckende Offscreen-Fläche (alpha:false) – wird im Software-Rendering ohne Mischen geblittet (schneller). */
export function paintOpaque(w: number, h: number, draw: (g: Ctx2D, w: number, h: number) => void): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const g = c.getContext("2d", { alpha: false });
  if (!g) return paint(w, h, draw);
  draw(g, w, h);
  return c;
}

// ------------------------------------------------------------------------------------------------
// Himmel-Elemente

/** Sternfeld (weiß, mit einigen farbigen Sternen) */
export function starField(W: number, H: number, seed = 7): HTMLCanvasElement {
  return paint(W, H, (g) => {
    const r = mulberry(seed);
    for (let i = 0; i < 360; i += 1) {
      const big = r() > 0.93;
      const s = big ? 1.3 + r() * 1.2 : 0.5 + r() * 0.8;
      const c = r();
      g.fillStyle = c < 0.75 ? "rgba(255,255,255,0.85)" : c < 0.88 ? "rgba(140,230,255,0.9)" : "rgba(255,160,230,0.9)";
      g.beginPath();
      g.arc(r() * W, Math.pow(r(), 1.3) * H, s, 0, TAU);
      g.fill();
    }
  });
}

/** Synthwave-Sonne mit Streifen-Aussparungen (Dämmerung) */
export function synthSun(R: number): HTMLCanvasElement {
  const S = R * 2 + 8;
  return paint(S, S, (g) => {
    const cx = S / 2;
    const cy = S / 2;
    const grd = g.createLinearGradient(0, cy - R, 0, cy + R);
    grd.addColorStop(0, "#fff3a8");
    grd.addColorStop(0.35, "#ffb35a");
    grd.addColorStop(0.7, "#ff4f9a");
    grd.addColorStop(1, "#c42bd8");
    g.fillStyle = grd;
    g.beginPath();
    g.arc(cx, cy, R, 0, TAU);
    g.fill();
    // Streifen im unteren Teil ausstanzen (werden nach unten dicker)
    g.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 9; i += 1) {
      const u = i / 8;
      const y = cy + R * (0.05 + u * 0.9);
      const h = 1.5 + u * 7;
      g.fillRect(0, y, S, h);
    }
  });
}

/** Singularität: schwarzes Loch mit Akkretionsring (additiv zu zeichnen, Scheibe separat schwarz) */
export function singularitySprite(R: number): HTMLCanvasElement {
  const S = Math.round(R * 5.2);
  return paint(S, S, (g) => {
    const c = S / 2;
    // weicher Halo
    const halo = g.createRadialGradient(c, c, R * 0.9, c, c, S / 2);
    halo.addColorStop(0, "rgba(200,160,255,0.55)");
    halo.addColorStop(0.3, "rgba(130,80,255,0.22)");
    halo.addColorStop(1, "rgba(60,20,160,0)");
    g.fillStyle = halo;
    g.fillRect(0, 0, S, S);
    // Photonenring
    g.lineWidth = R * 0.16;
    g.strokeStyle = "rgba(255,240,255,0.95)";
    g.beginPath();
    g.arc(c, c, R * 1.08, 0, TAU);
    g.stroke();
    g.lineWidth = R * 0.4;
    g.strokeStyle = "rgba(180,140,255,0.35)";
    g.beginPath();
    g.arc(c, c, R * 1.2, 0, TAU);
    g.stroke();
    // Akkretionsscheibe (flache Ellipse, vorne heller)
    g.save();
    g.translate(c, c);
    g.scale(1, 0.24);
    for (let i = 0; i < 5; i += 1) {
      const rr0 = R * (1.35 + i * 0.28);
      g.lineWidth = R * (0.22 - i * 0.03);
      g.strokeStyle = i % 2 ? "rgba(120,220,255,0.35)" : "rgba(255,190,250,0.5)";
      g.beginPath();
      g.arc(0, 0, rr0, 0, TAU);
      g.stroke();
    }
    g.restore();
  });
}

/** Laserraster am Himmel: perspektivische Linien, die zum Horizont laufen (additiv) */
export function laserRaster(W: number, H: number): HTMLCanvasElement {
  return paint(W, H, (g) => {
    g.lineWidth = 1;
    // waagrechte Linien, nach unten dichter
    for (let i = 0; i < 12; i += 1) {
      const u = i / 11;
      const y = H * Math.pow(u, 0.62);
      g.strokeStyle = `rgba(255,255,255,${(0.08 + u * 0.22).toFixed(3)})`;
      g.beginPath();
      g.moveTo(0, y + 0.5);
      g.lineTo(W, y + 0.5);
      g.stroke();
    }
    // senkrechte Linien (periodisch, Kachelbreite W)
    const n = 16;
    for (let i = 0; i < n; i += 1) {
      const x = (i / n) * W;
      const grd = g.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, "rgba(255,255,255,0)");
      grd.addColorStop(1, "rgba(255,255,255,0.28)");
      g.strokeStyle = grd;
      g.beginPath();
      g.moveTo(x + 0.5, 0);
      g.lineTo(x + 0.5, H);
      g.stroke();
    }
  });
}

// ------------------------------------------------------------------------------------------------
// Ferne Skyline: Donauturm, DC-Tower, Millennium Tower, Neon-Riesenrad

export interface LayerTiles {
  body: HTMLCanvasElement;
  lights: HTMLCanvasElement;
}

export function farSkyline(W: number, H: number): LayerTiles {
  const r = mulberry(21);
  // zwei Reihen: hintere (höher, schmaler) und vordere (niedriger, breiter)
  const towers: Array<{ x: number; w: number; h: number; kind: number; row: number }> = [];
  for (let row = 0; row < 2; row += 1) {
    let x = row * 17;
    while (x < W) {
      const w = row === 0 ? 22 + r() * 40 : 40 + r() * 70;
      const h = row === 0 ? 110 + r() * 150 + (r() > 0.8 ? 50 : 0) : 50 + r() * 110;
      towers.push({ x, w, h, kind: Math.floor(r() * 4), row });
      x += w + (row === 0 ? r() * 30 : 6 + r() * 40);
    }
  }
  const body = paint(W, H, (g) => {
    for (const t of towers) {
      g.fillStyle = t.row === 0 ? "rgba(255,255,255,0.72)" : "#ffffff";
      wrapDraw(W, t.x, t.w + 20, (xx) => {
        const top = H - t.h;
        g.fillRect(xx, top, t.w, t.h);
        if (t.kind === 1) {
          g.fillRect(xx + t.w * 0.2, top - 14, t.w * 0.6, 14);
          g.fillRect(xx + t.w * 0.45, top - 38, 3, 24);
        } else if (t.kind === 2) {
          g.beginPath();
          g.moveTo(xx, top);
          g.lineTo(xx + t.w, top - t.w * 0.5);
          g.lineTo(xx + t.w, top);
          g.fill();
        } else if (t.kind === 3) {
          g.fillRect(xx + t.w * 0.5 - 1, top - 34, 2, 34);
        }
      });
    }
    g.fillStyle = "#ffffff";
    // Donauturm
    const dx = 420;
    g.fillRect(dx - 5, H - 300, 10, 300);
    g.beginPath();
    g.ellipse(dx, H - 256, 28, 9, 0, 0, TAU);
    g.fill();
    g.fillRect(dx - 24, H - 264, 48, 12);
    g.beginPath();
    g.ellipse(dx, H - 272, 19, 6, 0, 0, TAU);
    g.fill();
    g.fillRect(dx - 1.5, H - 336, 3, 66);
    // DC-Tower (gefaltete Fassade)
    const tx = 1310;
    g.beginPath();
    g.moveTo(tx, H);
    g.lineTo(tx, H - 290);
    for (let i = 0; i <= 10; i += 1) g.lineTo(tx + 60 + (i % 2 ? 7 : 0), H - 290 + i * 29);
    g.lineTo(tx + 60, H);
    g.closePath();
    g.fill();
    g.fillRect(tx + 27, H - 312, 3, 22);
    // Millennium Tower
    const mx = 1720;
    g.fillRect(mx, H - 270, 42, 270);
    g.beginPath();
    g.ellipse(mx + 21, H - 270, 21, 6, 0, 0, TAU);
    g.fill();
    g.fillRect(mx + 20, H - 318, 2, 48);
  });
  const lights = paint(W, H, (g) => {
    for (const t of towers) {
      // wenige Fensterpunkte, eher in Bändern
      const rows = Math.floor(t.h / 9);
      for (let rI = 2; rI < rows; rI += 1) {
        if (r() > 0.28) continue;
        const c = r();
        g.fillStyle = c < 0.5 ? "rgba(140,230,255,0.55)" : c < 0.8 ? "rgba(255,140,230,0.5)" : "rgba(255,220,170,0.55)";
        const len = Math.max(2, t.w * (0.2 + r() * 0.5));
        const sx = t.x + r() * (t.w - len);
        wrapDraw(W, sx, len, (xx) => g.fillRect(xx, H - t.h + rI * 9, len, 1.5));
      }
      if (r() > 0.6) {
        g.fillStyle = r() > 0.5 ? "rgba(34,224,255,0.8)" : "rgba(255,62,200,0.8)";
        wrapDraw(W, t.x, t.w, (xx) => g.fillRect(xx, H - t.h, t.w, 1.2));
      }
      if (t.kind === 3 || t.kind === 1) {
        g.fillStyle = "rgba(255,60,60,0.95)";
        wrapDraw(W, t.x, t.w, (xx) => g.fillRect(xx + t.w * 0.5 - 1.5, H - t.h - (t.kind === 3 ? 35 : 39), 3, 3));
      }
    }
    // Donauturm-Ringe
    g.strokeStyle = "rgba(34,224,255,0.95)";
    g.lineWidth = 1.5;
    g.beginPath();
    g.ellipse(420, H - 256, 28, 9, 0, 0, TAU);
    g.stroke();
    g.strokeStyle = "rgba(255,62,200,0.9)";
    g.beginPath();
    g.ellipse(420, H - 272, 19, 6, 0, 0, TAU);
    g.stroke();
    g.fillStyle = "rgba(255,60,60,1)";
    g.fillRect(418.5, H - 338, 3, 3);
    // DC-Tower Kanten + Bänder
    g.strokeStyle = "rgba(160,120,255,0.8)";
    g.beginPath();
    g.moveTo(1310, H);
    g.lineTo(1310, H - 290);
    g.lineTo(1370, H - 290);
    g.stroke();
    g.fillStyle = "rgba(200,230,255,0.45)";
    for (let i = 0; i < 18; i += 1) g.fillRect(1314, H - 280 + i * 16, 52, 1.2);
    // Millennium-Tower Band
    g.fillStyle = "rgba(34,224,255,0.6)";
    for (let i = 0; i < 14; i += 1) g.fillRect(1720, H - 262 + i * 19, 42, 1.2);
    // Neon-Riesenrad (Drahtgitter)
    const wx = 880;
    const wy = H - 100;
    const R = 80;
    g.strokeStyle = "rgba(255,62,200,0.9)";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(wx, wy, R, 0, TAU);
    g.stroke();
    g.strokeStyle = "rgba(34,224,255,0.5)";
    g.lineWidth = 1;
    g.beginPath();
    g.arc(wx, wy, R - 8, 0, TAU);
    for (let i = 0; i < 15; i += 1) {
      const a = (i / 15) * TAU;
      g.moveTo(wx, wy);
      g.lineTo(wx + Math.cos(a) * R, wy + Math.sin(a) * R);
    }
    g.moveTo(wx - 42, H);
    g.lineTo(wx, wy);
    g.lineTo(wx + 42, H);
    g.stroke();
    for (let i = 0; i < 15; i += 1) {
      const a = (i / 15) * TAU;
      g.fillStyle = i % 2 ? "rgba(255,230,140,0.95)" : "rgba(140,240,255,0.95)";
      g.fillRect(wx + Math.cos(a) * R - 2.5, wy + Math.sin(a) * R - 1, 5, 4);
    }
  });
  return { body, lights };
}

// ------------------------------------------------------------------------------------------------
// Mittelgrund: Glas-Wolkenkratzer mit Hologramm-Reklamen

export interface Board {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: number;
}

export interface MidTiles extends LayerTiles {
  boards: Board[];
}

const SIGNS = ["CAFÉ", "WIEN", "U6", "MELANGE", "BÄCKEREI", "HEURIGER"];

export function midCity(W: number, H: number): MidTiles {
  const r = mulberry(77);
  const blds: Array<{ x: number; w: number; h: number; crown: number; hue: number; board: boolean }> = [];
  let x = 10;
  while (x < W - 60) {
    const w = 96 + r() * 110;
    const tall = r() > 0.7;
    const h = tall ? 250 + r() * 80 : 140 + r() * 110;
    blds.push({ x, w, h, crown: Math.floor(r() * 4), hue: r(), board: r() > 0.42 });
    x += w + 30 + r() * 120;
  }
  const boards: Board[] = [];
  const body = paint(W, H, (g) => {
    for (const b of blds) {
      wrapDraw(W, b.x, b.w + 40, (xx) => {
        const top = H - b.h;
        const grd = g.createLinearGradient(0, top, 0, H);
        grd.addColorStop(0, "#26306a");
        grd.addColorStop(0.5, "#161b46");
        grd.addColorStop(1, "#0a0c26");
        g.fillStyle = grd;
        g.fillRect(xx, top, b.w, b.h);
        // Seitenlicht / Schatten
        g.fillStyle = "rgba(120,150,255,0.18)";
        g.fillRect(xx, top, 4, b.h);
        g.fillStyle = "rgba(0,0,10,0.35)";
        g.fillRect(xx + b.w * 0.72, top, b.w * 0.28, b.h);
        // Glas-Reflexion (Diagonale)
        const refl = g.createLinearGradient(xx, top, xx + b.w, top + b.h * 0.7);
        refl.addColorStop(0, "rgba(170,210,255,0.14)");
        refl.addColorStop(0.3, "rgba(170,210,255,0)");
        refl.addColorStop(0.5, "rgba(170,210,255,0.07)");
        refl.addColorStop(0.62, "rgba(170,210,255,0)");
        g.fillStyle = refl;
        g.fillRect(xx, top, b.w, b.h);
        // Geschossbänder & Sprossen
        g.fillStyle = "rgba(4,5,18,0.45)";
        for (let my = top + 14; my < H; my += 14) g.fillRect(xx, my, b.w, 1);
        g.fillStyle = "rgba(4,5,18,0.25)";
        for (let mx = xx + 12; mx < xx + b.w - 4; mx += 16) g.fillRect(mx, top, 1, b.h);
        // Krone
        g.fillStyle = "#1a2152";
        if (b.crown === 0) {
          g.beginPath();
          g.moveTo(xx, top);
          g.lineTo(xx + b.w * 0.5, top - 44);
          g.lineTo(xx + b.w, top);
          g.fill();
        } else if (b.crown === 1) {
          g.fillRect(xx + b.w * 0.15, top - 20, b.w * 0.7, 20);
          g.fillRect(xx + b.w * 0.35, top - 36, b.w * 0.3, 16);
          g.fillRect(xx + b.w * 0.5 - 2, top - 80, 4, 44);
        } else if (b.crown === 2) {
          g.beginPath();
          g.moveTo(xx, top);
          g.lineTo(xx + b.w, top - 34);
          g.lineTo(xx + b.w, top);
          g.fill();
        } else {
          g.fillRect(xx + b.w * 0.2 - 1, top - 56, 3, 56);
          g.fillRect(xx + b.w * 0.75 - 1, top - 30, 3, 30);
        }
      });
      if (b.board) {
        const bw = Math.min(b.w - 24, 100 + r() * 40);
        const bh = Math.round(bw * 0.62);
        const bx = b.x + (b.w - bw) / 2;
        const by = H - b.h + 26 + r() * Math.max(6, Math.min(80, b.h - bh - 70));
        boards.push({ x: bx, y: by, w: bw, h: bh, kind: boards.length % 4 });
        wrapDraw(W, bx, bw, (xx) => {
          g.fillStyle = "#05061a";
          rrFill(g, xx - 5, by - 5, bw + 10, bh + 10, 4);
          g.fillStyle = "#0a0d2a";
          g.fillRect(xx, by, bw, bh);
        });
      }
    }
  });
  const lights = paint(W, H, (g) => {
    let si = 0;
    for (const b of blds) {
      const top = H - b.h;
      const col = b.hue < 0.5 ? "34,224,255" : b.hue < 0.8 ? "255,62,200" : "154,91,255";
      wrapDraw(W, b.x, b.w + 40, (xx) => {
        // Neon-Kanten
        g.fillStyle = `rgba(${col},0.9)`;
        g.fillRect(xx, top, 2, b.h);
        g.fillRect(xx, top, b.w, 2);
        g.fillStyle = `rgba(${col},0.35)`;
        g.fillRect(xx + b.w - 2, top, 2, b.h * 0.5);
        // beleuchtete Geschossbänder (teilweise)
        for (let my = top + 18; my < H - 6; my += 14) {
          const k = r();
          if (k > 0.3) continue;
          const len = b.w * (0.15 + r() * 0.55);
          const sx = xx + 6 + r() * Math.max(1, b.w - 12 - len);
          g.fillStyle = k < 0.12 ? "rgba(255,210,150,0.5)" : k < 0.22 ? `rgba(${col},0.45)` : "rgba(200,220,255,0.35)";
          g.fillRect(sx, my + 4, len, 5);
        }
        // senkrechter LED-Streifen
        if (b.hue > 0.6) {
          for (let my = top + 10; my < H - 10; my += 6) {
            g.fillStyle = `rgba(${col},${(0.35 + 0.4 * r()).toFixed(2)})`;
            g.fillRect(xx + b.w * 0.86, my, 2, 3);
          }
        }
        // Kronenlicht
        if (b.crown === 1 || b.crown === 3) {
          g.fillStyle = "rgba(255,70,70,1)";
          g.fillRect(xx + b.w * (b.crown === 1 ? 0.5 : 0.2) - 2, top - (b.crown === 1 ? 82 : 58), 4, 4);
        }
        if (b.crown === 0) {
          g.strokeStyle = `rgba(${col},0.95)`;
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(xx, top);
          g.lineTo(xx + b.w * 0.5, top - 44);
          g.lineTo(xx + b.w, top);
          g.stroke();
        } else if (b.crown === 2) {
          g.strokeStyle = `rgba(${col},0.95)`;
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(xx, top);
          g.lineTo(xx + b.w, top - 34);
          g.stroke();
        }
      });
      // kleine Schilder (deutsch, dezent)
      if (!b.board && r() > 0.35) {
        const word = SIGNS[si % SIGNS.length];
        si += 1;
        const sy = top + 24 + r() * Math.min(60, b.h - 60);
        wrapDraw(W, b.x, b.w, (xx) => {
          g.font = "700 12px system-ui, sans-serif";
          g.textAlign = "center";
          g.textBaseline = "middle";
          const tw = g.measureText(word).width + 12;
          g.fillStyle = `rgba(${col},0.18)`;
          g.fillRect(xx + b.w / 2 - tw / 2, sy - 9, tw, 18);
          g.strokeStyle = `rgba(${col},0.95)`;
          g.lineWidth = 1.5;
          g.strokeRect(xx + b.w / 2 - tw / 2, sy - 9, tw, 18);
          g.fillStyle = "rgba(255,255,255,0.95)";
          g.fillText(word, xx + b.w / 2, sy + 1);
        });
      }
    }
    // Reklame-Rahmen
    for (const bd of boards) {
      wrapDraw(W, bd.x, bd.w, (xx) => {
        g.strokeStyle = bd.kind % 2 ? "rgba(255,62,200,0.95)" : "rgba(34,224,255,0.95)";
        g.lineWidth = 2;
        g.strokeRect(xx - 3, bd.y - 3, bd.w + 6, bd.h + 6);
      });
    }
  });
  return { body, lights, boards };
}

// ------------------------------------------------------------------------------------------------
// Serverherz: Monolithen mit LED-Matrix

export function serverMonoliths(W: number, H: number): LayerTiles {
  const r = mulberry(303);
  const mons: Array<{ x: number; w: number; h: number }> = [];
  let x = 30;
  while (x < W - 60) {
    const w = 90 + r() * 90;
    mons.push({ x, w, h: 240 + r() * 170 });
    x += w + 60 + r() * 140;
  }
  const body = paint(W, H, (g) => {
    for (const m of mons) {
      wrapDraw(W, m.x, m.w + 10, (xx) => {
        const top = H - m.h;
        const grd = g.createLinearGradient(xx, 0, xx + m.w, 0);
        grd.addColorStop(0, "#0b2a2e");
        grd.addColorStop(0.5, "#07181c");
        grd.addColorStop(1, "#030a0c");
        g.fillStyle = grd;
        g.fillRect(xx, top, m.w, m.h);
        g.fillStyle = "#041012";
        for (let y = top + 18; y < H; y += 26) g.fillRect(xx + 6, y, m.w - 12, 3);
        g.fillStyle = "#0d3036";
        g.fillRect(xx - 6, top - 10, m.w + 12, 12);
      });
    }
  });
  const lights = paint(W, H, (g) => {
    for (const m of mons) {
      wrapDraw(W, m.x, m.w + 10, (xx) => {
        const top = H - m.h;
        for (let y = top + 8; y < H - 6; y += 26) {
          for (let lx = xx + 12; lx < xx + m.w - 12; lx += 7) {
            const k = r();
            if (k > 0.45) continue;
            g.fillStyle = k < 0.25 ? "rgba(61,255,176,0.85)" : k < 0.38 ? "rgba(34,224,255,0.8)" : "rgba(255,190,90,0.8)";
            g.fillRect(lx, y, 3, 3);
          }
        }
        g.fillStyle = "rgba(61,255,176,0.8)";
        g.fillRect(xx - 6, top - 10, m.w + 12, 2);
        g.fillRect(xx, top, 2, m.h);
      });
    }
  });
  return { body, lights };
}

// ------------------------------------------------------------------------------------------------
// Nahgrund: Magnetbahn-Pylonen, Kabel, senkrechte Neonstreifen (dunkel, dezent)

export interface Pylon {
  x: number;
  w: number;
  len: number;
}

export function nearPylons(W: number, H: number): LayerTiles & { pylons: Pylon[] } {
  const r = mulberry(909);
  const py: Pylon[] = [];
  let x = 60;
  while (x < W - 80) {
    py.push({ x, w: 12 + r() * 10, len: 170 + r() * 150 });
    x += 300 + r() * 280;
  }
  const fade = (g: Ctx2D): void => {
    g.globalCompositeOperation = "destination-in";
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, "rgba(0,0,0,1)");
    grd.addColorStop(0.45, "rgba(0,0,0,0.9)");
    grd.addColorStop(0.8, "rgba(0,0,0,0)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = "source-over";
  };
  const body = paint(W, H, (g) => {
    for (let i = 0; i < py.length; i += 1) {
      const p = py[i];
      const n = py[(i + 1) % py.length];
      wrapDraw(W, p.x, p.w + 30, (xx) => {
        // Gitterträger von der Decke
        g.fillStyle = "#0b0d24";
        g.fillRect(xx, 0, 3, p.len);
        g.fillRect(xx + p.w - 3, 0, 3, p.len);
        g.strokeStyle = "#0b0d24";
        g.lineWidth = 1.5;
        g.beginPath();
        for (let y = 0; y < p.len - 14; y += 16) {
          g.moveTo(xx, y);
          g.lineTo(xx + p.w, y + 16);
          g.moveTo(xx + p.w, y);
          g.lineTo(xx, y + 16);
        }
        g.stroke();
        g.fillStyle = "#070819";
        g.fillRect(xx - 8, 0, p.w + 16, 12);
        g.fillRect(xx - 5, p.len - 10, p.w + 10, 10);
      });
      // Kabel (Kettenlinie zur nächsten Säule)
      const x0 = p.x + p.w / 2;
      let x1 = n.x + n.w / 2;
      if (x1 < x0) x1 += W;
      g.strokeStyle = "rgba(6,7,20,0.85)";
      g.lineWidth = 2.5;
      for (const sag of [34, 70]) {
        for (const off of [0, -W]) {
          g.beginPath();
          g.moveTo(x0 + off, 16);
          g.quadraticCurveTo((x0 + x1) / 2 + off, 16 + sag * 2, x1 + off, 16);
          g.stroke();
        }
      }
    }
    fade(g);
  });
  const lights = paint(W, H, (g) => {
    for (const p of py) {
      wrapDraw(W, p.x, p.w + 30, (xx) => {
        const c = r() > 0.5 ? "34,224,255" : "255,62,200";
        for (let y = 20; y < p.len - 12; y += 26) {
          g.fillStyle = `rgba(${c},0.9)`;
          g.fillRect(xx + p.w / 2 - 1, y, 2, 8);
        }
        g.fillStyle = "rgba(255,70,70,0.95)";
        g.fillRect(xx + p.w / 2 - 2, p.len - 6, 4, 4);
      });
    }
    fade(g);
  });
  return { body, lights, pylons: py };
}

// ------------------------------------------------------------------------------------------------
// Datenregen: Glyphen-Säulen (heller Kopf unten, Schweif nach oben)

const GLYPHS = "0123456789ABCDEF#$%&*+<>=/";

export function rainStrips(color: string, n: number, H: number, seed: number): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  const r = mulberry(seed);
  const [cr, cg, cb] = hexRgb(color);
  for (let s = 0; s < n; s += 1) {
    out.push(
      paint(18, H, (g) => {
        g.font = "700 14px ui-monospace, Menlo, Consolas, monospace";
        g.textAlign = "center";
        g.textBaseline = "middle";
        const rows = Math.floor(H / 16);
        for (let i = 0; i < rows; i += 1) {
          const u = i / (rows - 1);
          const a = Math.pow(u, 1.6);
          const ch = GLYPHS[Math.floor(r() * GLYPHS.length)];
          if (i === rows - 1) g.fillStyle = "rgba(255,255,255,1)";
          else g.fillStyle = `rgba(${cr},${cg},${cb},${(a * 0.9).toFixed(3)})`;
          g.fillText(ch, 9, i * 16 + 8);
        }
      }),
    );
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// Hologramm-Verarbeitung (Stephansdom & Reklame-Motive)

/**
 * Macht aus einer farbigen Quelle ein Hologramm: Graustufen → Sobel-Kanten (Cyan/Weiß) + schwacher Körper (Violett) +
 * Scanlines + Ausblendung zum Sockel. Ergebnis ist für additives Zeichnen gedacht.
 */
export function holoFromSource(src: HTMLCanvasElement, edge: string, bodyCol: string, opts: { scan?: number; fadeBottom?: number; gain?: number } = {}): HTMLCanvasElement {
  const W = src.width;
  const H = src.height;
  const out = paint(W, H, () => undefined);
  const sg = ctxOf(src);
  const og = ctxOf(out);
  let data: ImageData;
  try {
    data = sg.getImageData(0, 0, W, H);
  } catch {
    return src;
  }
  const d = data.data;
  const lum = new Float32Array(W * H);
  const al = new Float32Array(W * H);
  for (let i = 0; i < W * H; i += 1) {
    const a = d[i * 4 + 3] / 255;
    al[i] = a;
    lum[i] = ((0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2]) / 255) * a;
  }
  const E = hexRgb(edge);
  const B = hexRgb(bodyCol);
  const res = og.createImageData(W, H);
  const o = res.data;
  const scan = opts.scan ?? 3;
  const fadeB = opts.fadeBottom ?? 0.18;
  const gain = opts.gain ?? 2.4;
  for (let y = 1; y < H - 1; y += 1) {
    const scanK = y % scan === 0 ? 0.35 : 1;
    const fy = y / H;
    const fade = fy > 1 - fadeB ? Math.max(0.15, (1 - fy) / fadeB) : 1;
    for (let x = 1; x < W - 1; x += 1) {
      const i = y * W + x;
      const a = al[i];
      if (a < 0.02 && al[i - 1] < 0.02 && al[i + 1] < 0.02 && al[i - W] < 0.02 && al[i + W] < 0.02) continue;
      const gx = -lum[i - W - 1] - 2 * lum[i - 1] - lum[i + W - 1] + lum[i - W + 1] + 2 * lum[i + 1] + lum[i + W + 1];
      const gy = -lum[i - W - 1] - 2 * lum[i - W] - lum[i - W + 1] + lum[i + W - 1] + 2 * lum[i + W] + lum[i + W + 1];
      const e = Math.min(1, Math.hypot(gx, gy) * gain);
      const b = a * (0.06 + 0.24 * lum[i]);
      const tot = e + b;
      if (tot < 0.01) continue;
      const wHot = e > 0.62 ? Math.min(1, (e - 0.62) * 1.6) : 0;
      let cr = (e * E[0] + b * B[0]) / tot;
      let cg = (e * E[1] + b * B[1]) / tot;
      let cb = (e * E[2] + b * B[2]) / tot;
      cr += (255 - cr) * wHot;
      cg += (255 - cg) * wHot;
      cb += (255 - cb) * wHot;
      const k = i * 4;
      o[k] = cr;
      o[k + 1] = cg;
      o[k + 2] = cb;
      o[k + 3] = Math.min(255, Math.min(1, tot) * 255 * scanK * fade);
    }
  }
  og.putImageData(res, 0, 0);
  return out;
}

/** Stephansdom-Quelle: gemaltes Landmark (falls geladen) oder prozedurale Silhouette. */
export function cathedralSource(props: PropLibrary | null, H: number): HTMLCanvasElement {
  const W = Math.round(H * 0.72);
  if (props && props.has("landmark-cathedral")) {
    return paint(W + 8, H + 4, (g) => {
      props.draw(g, "landmark-cathedral", (W + 8) / 2, H + 2, { h: H });
    });
  }
  return proceduralCathedral(W + 8, H + 4);
}

/** Prozeduraler Stephansdom (Graustufen mit Details; wird anschließend zum Hologramm verarbeitet). */
export function proceduralCathedral(W: number, H: number): HTMLCanvasElement {
  return paint(W, H, (g) => {
    const k = W / 320;
    g.scale(k, H / 444);
    const base = 444;
    g.lineJoin = "round";
    // Langhaus
    g.fillStyle = "#8c8680";
    g.fillRect(20, base - 150, 200, 150);
    // Dach (steil, Zickzack-Muster)
    g.fillStyle = "#5a7a78";
    g.beginPath();
    g.moveTo(24, base - 150);
    g.lineTo(58, base - 250);
    g.lineTo(196, base - 250);
    g.lineTo(222, base - 150);
    g.closePath();
    g.fill();
    g.strokeStyle = "#d8e8e0";
    g.lineWidth = 2;
    for (let row = 0; row < 5; row += 1) {
      const y = base - 160 - row * 18;
      g.beginPath();
      for (let x = 40 + row * 6; x < 210 - row * 4; x += 14) {
        g.lineTo(x, y);
        g.lineTo(x + 7, y - 9);
      }
      g.stroke();
    }
    // Heidentürme
    g.fillStyle = "#9a948c";
    for (const tx of [22, 58]) {
      g.fillRect(tx, base - 238, 26, 238);
      g.beginPath();
      g.moveTo(tx - 2, base - 238);
      g.lineTo(tx + 13, base - 290);
      g.lineTo(tx + 28, base - 238);
      g.fill();
    }
    // Südturm mit Spitze
    g.fillStyle = "#a49c92";
    g.beginPath();
    g.moveTo(222, base);
    g.lineTo(222, base - 150);
    g.lineTo(228, base - 280);
    g.lineTo(252, base - 440);
    g.lineTo(276, base - 280);
    g.lineTo(282, base - 150);
    g.lineTo(282, base);
    g.closePath();
    g.fill();
    // Details: Fenster, Bänder, Fialen
    g.strokeStyle = "#e8e2d8";
    g.lineWidth = 1.6;
    for (let y = base - 140; y > base - 400; y -= 26) {
      const u = (base - y) / 440;
      const hw = 30 - u * 26;
      g.beginPath();
      g.moveTo(252 - hw, y);
      g.lineTo(252 + hw, y);
      g.stroke();
    }
    g.fillStyle = "#2a2826";
    for (let i = 0; i < 6; i += 1) {
      const wx = 34 + i * 30;
      g.beginPath();
      g.moveTo(wx, base - 20);
      g.lineTo(wx, base - 100);
      g.quadraticCurveTo(wx + 8, base - 118, wx + 16, base - 100);
      g.lineTo(wx + 16, base - 20);
      g.fill();
    }
    g.beginPath();
    g.moveTo(244, base - 170);
    g.lineTo(244, base - 240);
    g.quadraticCurveTo(252, base - 256, 260, base - 240);
    g.lineTo(260, base - 170);
    g.fill();
    g.strokeStyle = "#f0ece4";
    for (let i = 0; i < 8; i += 1) {
      const y = base - 290 - i * 18;
      g.beginPath();
      g.moveTo(252, y - 12);
      g.lineTo(252, y + 4);
      g.stroke();
    }
  });
}

// ------------------------------------------------------------------------------------------------
// Hologramm-Reklamen (prozedurale Motive: Melange, Riesenrad, Sachertorte, Walzer-Noten)

export function adIcons(size: number): HTMLCanvasElement[] {
  const icons: HTMLCanvasElement[] = [];
  const W = size;
  const H = Math.round(size * 0.62);
  const draws: Array<(g: Ctx2D) => void> = [
    // Melange (Tasse mit Dampf)
    (g) => {
      g.strokeStyle = "#ffffff";
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(W * 0.3, H * 0.42);
      g.lineTo(W * 0.34, H * 0.82);
      g.lineTo(W * 0.62, H * 0.82);
      g.lineTo(W * 0.66, H * 0.42);
      g.closePath();
      g.stroke();
      g.beginPath();
      g.arc(W * 0.7, H * 0.58, H * 0.1, -1.4, 1.4);
      g.stroke();
      g.beginPath();
      g.ellipse(W * 0.48, H * 0.9, W * 0.22, H * 0.05, 0, 0, TAU);
      g.stroke();
      g.lineWidth = 2;
      for (let i = 0; i < 3; i += 1) {
        const x = W * (0.38 + i * 0.1);
        g.beginPath();
        g.moveTo(x, H * 0.36);
        g.bezierCurveTo(x - 8, H * 0.26, x + 8, H * 0.2, x, H * 0.08);
        g.stroke();
      }
    },
    // Riesenrad
    (g) => {
      const cx = W * 0.5;
      const cy = H * 0.46;
      const R = H * 0.36;
      g.strokeStyle = "#ffffff";
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(cx, cy, R, 0, TAU);
      g.stroke();
      g.lineWidth = 1.2;
      g.beginPath();
      for (let i = 0; i < 10; i += 1) {
        const a = (i / 10) * TAU;
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      }
      g.moveTo(cx - R * 0.6, H * 0.96);
      g.lineTo(cx, cy);
      g.lineTo(cx + R * 0.6, H * 0.96);
      g.stroke();
      g.fillStyle = "#ffffff";
      for (let i = 0; i < 10; i += 1) {
        const a = (i / 10) * TAU;
        g.fillRect(cx + Math.cos(a) * R - 3, cy + Math.sin(a) * R, 6, 5);
      }
    },
    // Sachertorte (Stück)
    (g) => {
      g.strokeStyle = "#ffffff";
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(W * 0.22, H * 0.78);
      g.lineTo(W * 0.72, H * 0.78);
      g.lineTo(W * 0.78, H * 0.52);
      g.lineTo(W * 0.3, H * 0.4);
      g.closePath();
      g.stroke();
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(W * 0.24, H * 0.62);
      g.lineTo(W * 0.75, H * 0.64);
      g.stroke();
      g.beginPath();
      g.ellipse(W * 0.66, H * 0.34, W * 0.08, H * 0.09, 0, 0, TAU);
      g.stroke();
      g.beginPath();
      g.moveTo(W * 0.66, H * 0.25);
      g.quadraticCurveTo(W * 0.7, H * 0.12, W * 0.64, H * 0.08);
      g.stroke();
    },
    // Walzer-Noten
    (g) => {
      g.strokeStyle = "#ffffff";
      g.fillStyle = "#ffffff";
      g.lineWidth = 3;
      for (const [nx, ny] of [
        [0.36, 0.74],
        [0.62, 0.64],
      ] as const) {
        g.beginPath();
        g.ellipse(W * nx, H * ny, W * 0.06, H * 0.07, -0.4, 0, TAU);
        g.fill();
        g.beginPath();
        g.moveTo(W * nx + W * 0.055, H * ny);
        g.lineTo(W * nx + W * 0.055, H * (ny - 0.5));
        g.stroke();
      }
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(W * 0.415, H * 0.24);
      g.lineTo(W * 0.675, H * 0.14);
      g.stroke();
    },
  ];
  for (let i = 0; i < draws.length; i += 1) {
    const col = i % 2 ? MAGENTA : CYAN;
    icons.push(
      paint(W, H, (g) => {
        // Grundfläche (Lichtschleier)
        const grd = g.createLinearGradient(0, 0, 0, H);
        grd.addColorStop(0, colorWithAlpha(col, 0.05));
        grd.addColorStop(1, colorWithAlpha(col, 0.22));
        g.fillStyle = grd;
        g.fillRect(0, 0, W, H);
        g.save();
        g.shadowColor = col;
        g.shadowBlur = 8;
        draws[i](g);
        g.restore();
        g.globalCompositeOperation = "source-atop";
        g.fillStyle = colorWithAlpha(col, 0.55);
        g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = "destination-out";
        g.fillStyle = "rgba(0,0,0,0.55)";
        for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
      }),
    );
  }
  return icons;
}

// ------------------------------------------------------------------------------------------------
// Boden & Decke

/** Bodengrund pro Stufe (Lauffläche von groundY nach unten): Verlauf + statische Tiefenlinien */
export function floorBase(W: number, H: number, floor: string, grid: string, haze: string): HTMLCanvasElement {
  return paintOpaque(W, H, (g) => {
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, colorWithAlpha(haze, 1));
    grd.addColorStop(0.06, floor);
    grd.addColorStop(1, "#010104");
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    // Tiefenlinien (perspektivisch, näher = weiter auseinander)
    for (let i = 1; i < 9; i += 1) {
      const u = i / 8;
      const y = Math.round(H * u * u);
      g.fillStyle = colorWithAlpha(grid, 0.18 + 0.3 * (1 - u));
      g.fillRect(0, y, W, 1 + u);
    }
    // Horizont-Glühen direkt unter der Kante
    const hg = g.createLinearGradient(0, 0, 0, 26);
    hg.addColorStop(0, colorWithAlpha(grid, 0.45));
    hg.addColorStop(1, colorWithAlpha(grid, 0));
    g.fillStyle = hg;
    g.fillRect(0, 0, W, 26);
  });
}

/** Deckengrund pro Stufe (0 … ceilY): dunkles Glas, Tiefenlinien, Glühen an der Unterkante */
export function ceilBase(W: number, H: number, floor: string, grid: string, haze: string): HTMLCanvasElement {
  return paintOpaque(W, H, (g) => {
    const grd = g.createLinearGradient(0, H, 0, 0);
    grd.addColorStop(0, colorWithAlpha(haze, 1));
    grd.addColorStop(0.06, floor);
    grd.addColorStop(1, "#010104");
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    for (let i = 1; i < 9; i += 1) {
      const u = i / 8;
      const y = Math.round(H - H * u * u);
      g.fillStyle = colorWithAlpha(grid, 0.16 + 0.28 * (1 - u));
      g.fillRect(0, y, W, 1 + u);
    }
    const hg = g.createLinearGradient(0, H, 0, H - 26);
    hg.addColorStop(0, colorWithAlpha(grid, 0.45));
    hg.addColorStop(1, colorWithAlpha(grid, 0));
    g.fillStyle = hg;
    g.fillRect(0, H - 26, W, 26);
  });
}

/** Leuchtkante (weißer Kern + farbiger Schein), 1:1 geblittet */
export function edgeGlow(W: number, color: string): HTMLCanvasElement {
  const H = 30;
  return paint(W, H, (g) => {
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, colorWithAlpha(color, 0));
    grd.addColorStop(0.4, colorWithAlpha(color, 0.35));
    grd.addColorStop(0.5, colorWithAlpha(color, 0.95));
    grd.addColorStop(0.6, colorWithAlpha(color, 0.35));
    grd.addColorStop(1, colorWithAlpha(color, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    g.fillStyle = "rgba(255,255,255,0.9)";
    g.fillRect(0, H / 2 - 1, W, 2);
  });
}

/** Spiegelung der Stadtlichter im Hochglanzboden (gestaucht, nach unten ausgeblendet) */
export function reflectionTile(lights: HTMLCanvasElement, H: number): HTMLCanvasElement {
  const W = lights.width;
  return paint(W, H, (g) => {
    g.save();
    g.translate(0, 0);
    g.scale(1, -H / lights.height * 1.25);
    g.drawImage(lights, 0, -lights.height);
    g.restore();
    g.globalCompositeOperation = "destination-in";
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, "rgba(0,0,0,0.9)");
    grd.addColorStop(0.5, "rgba(0,0,0,0.35)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    // horizontale Wellen-/Kratzer-Struktur
    g.globalCompositeOperation = "destination-out";
    g.fillStyle = "rgba(0,0,0,0.5)";
    for (let y = 1; y < H; y += 4) g.fillRect(0, y, W, 1);
  });
}

// ------------------------------------------------------------------------------------------------

function rrFill(g: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  rr(g, x, y, w, h, r);
  g.fill();
}

export const NEON = { CYAN, MAGENTA, MINT, VIOLET } as const;
export type { RGB };
