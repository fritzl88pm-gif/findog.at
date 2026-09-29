import { clamp, rgba, roundRect } from "./draw-utils";
import { drawCoinVector, drawHeartVector } from "./pickups";
import { FONT } from "./particles";
import { ENERGY_MAX, MAX_HEARTS, VIEW_W } from "./constants";
import type { PickupType } from "./types";

export interface HudPowerup {
  kind: PickupType;
  /** verbleibende Zeit 0..1 */
  frac: number;
}

export interface HudToast {
  title: string;
  sub?: string;
  /** 0..1 Fortschritt */
  u: number;
  color: string;
}

export interface HudState {
  score: number;
  meters: number;
  hearts: number;
  coins: number;
  combo: number;
  comboFrac: number;
  energy: number;
  dashCost: number;
  powerups: HudPowerup[];
  toast: HudToast | null;
  worldName: string;
  accent: string;
  best: number;
  hint: string | null;
  tourFrac: number | null;
  time: number;
  chaseWarn: number;
}

const POWER_COLOR: Record<string, string> = { magnet: "#ff6b6b", shield: "#67e8f9", slowmo: "#c4b5fd", turbo: "#fde047" };
const POWER_GLYPH: Record<string, string> = { magnet: "U", shield: "◈", slowmo: "⧗", turbo: "ϟ" };

function panel(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 18): void {
  roundRect(g, x, y, w, h, r);
  g.fillStyle = "rgba(14,18,34,0.55)";
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = "rgba(255,255,255,0.14)";
  g.stroke();
}

function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color = "#fff", align: CanvasTextAlign = "left", weight = 800): void {
  g.font = `${weight} ${size}px ${FONT}`;
  g.textAlign = align;
  g.textBaseline = "alphabetic";
  g.lineJoin = "round";
  g.lineWidth = Math.max(4, size * 0.16);
  g.strokeStyle = "rgba(12,16,32,0.8)";
  g.strokeText(s, x, y);
  g.fillStyle = color;
  g.fillText(s, x, y);
}

export function drawHud(g: CanvasRenderingContext2D, h: HudState): void {
  g.save();
  // --- Herzen + Punktestand (oben links) ---
  panel(g, 22, 18, 292, 108);
  for (let i = 0; i < MAX_HEARTS; i += 1) {
    drawHeartVector(g, 50 + i * 50, 48, 17, h.time + i * 0.3, i < h.hearts);
  }
  text(g, String(h.score).replace(/\B(?=(\d{3})+(?!\d))/g, "."), 40, 106, 46, "#fff");
  text(g, `${Math.floor(h.meters)} m`, 300, 106, 22, "rgba(255,255,255,0.75)", "right", 700);

  // --- Münzen (oben rechts) ---
  panel(g, VIEW_W - 178, 18, 156, 52);
  drawCoinVector(g, VIEW_W - 148, 44, 15, h.time, 0);
  text(g, String(h.coins), VIEW_W - 44, 55, 30, "#ffd23f", "right");

  // --- Weltname / Bestwert ---
  if (h.best > 0) {
    text(g, `Rekord ${String(h.best).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`, VIEW_W - 44, 96, 18, "rgba(255,255,255,0.7)", "right", 700);
  }

  // --- Combo (oben Mitte) ---
  if (h.combo > 1) {
    const cx = VIEW_W / 2;
    const w = 150;
    panel(g, cx - w / 2, 18, w, 58, 20);
    text(g, `×${h.combo}`, cx, 58, 40, "#ffe066", "center", 900);
    g.fillStyle = "rgba(255,255,255,0.18)";
    roundRect(g, cx - w / 2 + 14, 64, w - 28, 6, 3);
    g.fill();
    g.fillStyle = "#ffe066";
    roundRect(g, cx - w / 2 + 14, 64, Math.max(6, (w - 28) * clamp(h.comboFrac, 0, 1)), 6, 3);
    g.fill();
  }

  // --- Energie / Dash (unten links) ---
  {
    const cx = 74;
    const cy = 652;
    const r = 36;
    const ready = h.energy >= h.dashCost;
    g.fillStyle = "rgba(14,18,34,0.6)";
    g.beginPath();
    g.arc(cx, cy, r + 8, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 9;
    g.strokeStyle = "rgba(255,255,255,0.14)";
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = ready ? "#7ee8ff" : "#4aa8c8";
    g.lineCap = "round";
    g.beginPath();
    g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(h.energy / ENERGY_MAX, 0, 1));
    g.stroke();
    // Markierung Dash-Kosten
    const ang = -Math.PI / 2 + Math.PI * 2 * (h.dashCost / ENERGY_MAX);
    g.strokeStyle = "rgba(255,255,255,0.85)";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx + Math.cos(ang) * (r - 8), cy + Math.sin(ang) * (r - 8));
    g.lineTo(cx + Math.cos(ang) * (r + 8), cy + Math.sin(ang) * (r + 8));
    g.stroke();
    if (ready) {
      g.fillStyle = rgba("#7ee8ff", 0.2 + 0.15 * Math.sin(h.time * 7));
      g.beginPath();
      g.arc(cx, cy, r - 6, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = ready ? "#fff" : "rgba(255,255,255,0.5)";
    g.beginPath();
    g.moveTo(cx - 12, cy - 13);
    g.lineTo(cx + 2, cy);
    g.lineTo(cx - 12, cy + 13);
    g.lineTo(cx - 12, cy + 6);
    g.lineTo(cx - 18, cy + 6);
    g.lineTo(cx - 18, cy - 6);
    g.lineTo(cx - 12, cy - 6);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(cx + 2, cy - 13);
    g.lineTo(cx + 16, cy);
    g.lineTo(cx + 2, cy + 13);
    g.closePath();
    g.fill();
  }

  // --- Aktive Power-ups ---
  let px = 148;
  for (const p of h.powerups) {
    const col = POWER_COLOR[p.kind] ?? "#fff";
    const cx = px + 26;
    const cy = 660;
    g.fillStyle = "rgba(14,18,34,0.6)";
    g.beginPath();
    g.arc(cx, cy, 30, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = "rgba(255,255,255,0.14)";
    g.beginPath();
    g.arc(cx, cy, 24, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = col;
    g.lineCap = "round";
    g.beginPath();
    g.arc(cx, cy, 24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(p.frac, 0, 1));
    g.stroke();
    text(g, POWER_GLYPH[p.kind] ?? "?", cx, cy + 9, 26, col, "center", 900);
    px += 70;
  }

  // --- Tour-Fortschritt ---
  if (h.tourFrac !== null) {
    const w = 260;
    const x = VIEW_W / 2 - w / 2;
    const y = 700;
    g.fillStyle = "rgba(14,18,34,0.5)";
    roundRect(g, x, y, w, 8, 4);
    g.fill();
    g.fillStyle = h.accent;
    roundRect(g, x, y, Math.max(8, w * clamp(h.tourFrac, 0, 1)), 8, 4);
    g.fill();
  }

  // --- Hinweis (nur Anfangsphase) ---
  if (h.hint) {
    const w = Math.min(760, 40 + h.hint.length * 13);
    panel(g, VIEW_W / 2 - w / 2, 610, w, 56, 28);
    text(g, h.hint, VIEW_W / 2, 647, 26, "#fff", "center", 700);
  }

  // --- Toast (Welt / Stufe) ---
  if (h.toast) {
    const u = h.toast.u;
    const a = u < 0.15 ? u / 0.15 : u > 0.75 ? Math.max(0, (1 - u) / 0.25) : 1;
    g.globalAlpha = a;
    const y = 190 + (1 - Math.min(1, u / 0.15)) * 16;
    text(g, h.toast.title, VIEW_W / 2, y, 54, h.toast.color, "center", 900);
    if (h.toast.sub) text(g, h.toast.sub, VIEW_W / 2, y + 40, 26, "rgba(255,255,255,0.9)", "center", 700);
    g.globalAlpha = 1;
  }

  // --- Warnung (Lawine etc.) ---
  if (h.chaseWarn > 0.02) {
    g.fillStyle = `rgba(255,60,60,${0.18 * h.chaseWarn})`;
    g.fillRect(0, 0, 160, 720);
  }
  g.restore();
}
