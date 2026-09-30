/**
 * Opernball – Tour-Tor: vergoldetes Portal mit Samtvorhängen („Vorhang auf!“), Sog in der Farbe der Zielwelt.
 * `e.p.to` = Index der Zielwelt in TOUR_ORDER.
 */
import type { Ent, ViewState } from "../../types";
import { rgba } from "../../draw-utils";
import type { Ctx2D } from "../shared-b/canvas";

const TAU = Math.PI * 2;
const GATE_COLORS = ["#5b7cfa", "#39b26b", "#3aa0ff", "#ff4fa3", "#f2a33a", "#22e0ff", "#8fd3ff", "#f2c14e"];

export function drawGateway(g: Ctx2D, e: Ent, sx: number, sy: number, v: ViewState, time: number): void {
  const color = GATE_COLORS[Math.max(0, Math.min(GATE_COLORS.length - 1, Math.round(e.p.to ?? 0)))];
  const cx = sx + e.w / 2;
  const cy = sy + e.h / 2;
  const ry = e.h * 0.5;
  const rx = e.w * 0.62;
  const reduced = v.reducedMotion;
  g.save();
  // Sog-Glühen
  const glow = g.createRadialGradient(cx, cy, 10, cx, cy, ry * 1.25);
  glow.addColorStop(0, rgba(color, 0.55));
  glow.addColorStop(0.55, rgba(color, 0.18));
  glow.addColorStop(1, rgba(color, 0));
  g.fillStyle = glow;
  g.fillRect(cx - ry * 1.3, cy - ry * 1.3, ry * 2.6, ry * 2.6);
  // Innenfläche: warmes Leuchten mit kreisenden Lichtbögen (Vorhang auf!)
  g.save();
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  g.clip();
  const inner = g.createRadialGradient(cx, cy, 6, cx, cy, ry);
  inner.addColorStop(0, "rgba(255,246,214,0.85)");
  inner.addColorStop(0.45, rgba(color, 0.5));
  inner.addColorStop(1, "rgba(50,8,26,0.72)");
  g.fillStyle = inner;
  g.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
  g.globalCompositeOperation = "lighter";
  g.lineCap = "round";
  for (let i = 0; i < 6; i += 1) {
    const a0 = (reduced ? 0 : time) * (0.9 + i * 0.22) * (i % 2 ? -1 : 1) + i * 1.1;
    const k = 0.22 + i * 0.13;
    g.strokeStyle = rgba("#fff1c0", 0.42 - i * 0.04);
    g.lineWidth = 5 - i * 0.5;
    g.beginPath();
    g.ellipse(cx, cy, rx * k, ry * k, 0, a0, a0 + 1.7);
    g.stroke();
  }
  g.restore();
  // vergoldeter Rahmen
  const gold = g.createLinearGradient(cx - rx, cy - ry, cx + rx, cy + ry);
  gold.addColorStop(0, "#fff2a8");
  gold.addColorStop(0.5, "#e0a52a");
  gold.addColorStop(1, "#8a5408");
  g.lineWidth = 15;
  g.strokeStyle = "#4a2604";
  g.beginPath();
  g.ellipse(cx, cy, rx + 3, ry + 3, 0, 0, TAU);
  g.stroke();
  g.lineWidth = 10;
  g.strokeStyle = gold;
  g.beginPath();
  g.ellipse(cx, cy, rx + 3, ry + 3, 0, 0, TAU);
  g.stroke();
  g.lineWidth = 3;
  g.strokeStyle = rgba(color, 0.95);
  g.beginPath();
  g.ellipse(cx, cy, rx - 5, ry - 5, 0, 0, TAU);
  g.stroke();
  // Zierperlen im Rahmen
  g.fillStyle = "#fff6d0";
  for (let i = 0; i < 26; i += 1) {
    const a = (i / 26) * TAU;
    g.beginPath();
    g.arc(cx + Math.cos(a) * (rx + 3), cy + Math.sin(a) * (ry + 3), 2.4, 0, TAU);
    g.fill();
  }
  // Samtvorhänge links/rechts, Raffung mit Quaste
  const sway = reduced ? 0 : Math.sin(time * 1.4) * 4;
  for (const side of [-1, 1]) {
    const bx = cx + side * (rx + 16);
    g.fillStyle = "#7a0c1e";
    g.beginPath();
    g.moveTo(bx, cy - ry - 8);
    g.quadraticCurveTo(bx + side * (34 + sway), cy - ry * 0.4, bx + side * 6, cy + ry * 0.1);
    g.quadraticCurveTo(bx + side * (30 - sway), cy + ry * 0.55, bx + side * 4, cy + ry + 6);
    g.lineTo(bx - side * 14, cy + ry + 6);
    g.quadraticCurveTo(bx - side * 8, cy, bx - side * 14, cy - ry - 8);
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(255,110,120,0.35)";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(bx + side * 2, cy - ry * 0.9);
    g.quadraticCurveTo(bx + side * (16 + sway), cy - ry * 0.3, bx + side * 4, cy + ry * 0.05);
    g.stroke();
    g.strokeStyle = "#ffcf4a";
    g.lineWidth = 3.5;
    g.beginPath();
    g.moveTo(bx - side * 10, cy + ry * 0.05);
    g.lineTo(bx + side * 8, cy + ry * 0.12);
    g.stroke();
    g.fillStyle = "#ffcf4a";
    g.beginPath();
    g.ellipse(bx + side * 8, cy + ry * 0.12 + 11, 5, 8, 0, 0, TAU);
    g.fill();
  }
  // Schlussstein mit Krone
  g.fillStyle = gold;
  g.strokeStyle = "#4a2604";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(cx - 20, cy - ry - 4);
  g.lineTo(cx - 14, cy - ry - 26);
  g.lineTo(cx - 6, cy - ry - 14);
  g.lineTo(cx, cy - ry - 32);
  g.lineTo(cx + 6, cy - ry - 14);
  g.lineTo(cx + 14, cy - ry - 26);
  g.lineTo(cx + 20, cy - ry - 4);
  g.closePath();
  g.fill();
  g.stroke();
  // Funken
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < 14; i += 1) {
    const a = time * 1.6 + i * 0.9;
    g.fillStyle = rgba("#fff6d0", 0.75);
    g.beginPath();
    g.arc(cx + Math.cos(a) * (rx + 12 + (i % 4) * 5), cy + Math.sin(a) * (ry + 12 + (i % 4) * 5), 2.6 + (i % 3), 0, TAU);
    g.fill();
  }
  g.restore();
}
