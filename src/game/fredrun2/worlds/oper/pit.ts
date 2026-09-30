/**
 * Opernball – Orchestergraben (Bodenlücke): dunkler Schacht mit warmem Lichtschein von unten, Musiker-Silhouetten mit
 * streichenden Bögen, Notenpult-Lämpchen. Die Musiker stehen weltfest (Raster 62 px) und wandern mit dem Boden.
 */
import { mod, h1 } from "../shared-b/color";
import type { Ctx2D } from "../shared-b/canvas";
import type { ViewState } from "../../types";

const TAU = Math.PI * 2;
const STEP = 62;

let gradCache: { h: number; g: CanvasGradient; ctx: CanvasRenderingContext2D } | null = null;

function shaftGradient(g: Ctx2D, gy: number, H: number): CanvasGradient {
  if (gradCache && gradCache.h === H && gradCache.ctx === g) return gradCache.g;
  const grd = g.createLinearGradient(0, gy, 0, gy + H);
  grd.addColorStop(0, "#5a1222");
  grd.addColorStop(0.35, "#2a0812");
  grd.addColorStop(1, "#080106");
  gradCache = { h: H, g: grd, ctx: g };
  return grd;
}

function musician(g: Ctx2D, x: number, baseY: number, seed: number, t: number, reduced: boolean): void {
  const kind = Math.floor(h1(seed * 3.7) * 4);
  const sway = reduced ? 0 : Math.sin(t * 2.2 + seed) * 2.2;
  const lean = reduced ? 0 : Math.sin(t * 2.2 + seed) * 0.06;
  g.save();
  g.translate(x + sway, baseY);
  g.rotate(lean);
  // Pult mit Lämpchen
  g.strokeStyle = "#0c0308";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(24, 0);
  g.lineTo(24, -44);
  g.stroke();
  g.fillStyle = "#1a0810";
  g.beginPath();
  g.moveTo(14, -44);
  g.lineTo(36, -50);
  g.lineTo(36, -38);
  g.lineTo(14, -34);
  g.closePath();
  g.fill();
  // Körper
  g.fillStyle = "#12050a";
  g.beginPath();
  g.ellipse(0, -30, 17, 26, 0, 0, TAU);
  g.fill();
  g.beginPath();
  g.arc(0, -64, 10, 0, TAU);
  g.fill();
  // Rim-Light (warmes Gegenlicht von rechts oben)
  g.strokeStyle = "rgba(255,170,90,0.55)";
  g.lineWidth = 1.6;
  g.beginPath();
  g.arc(0, -64, 10, -1.6, 0.5);
  g.stroke();
  g.beginPath();
  g.ellipse(0, -30, 17, 26, 0, -1.4, 0.2);
  g.stroke();
  // Instrument
  g.strokeStyle = "#3a1a10";
  g.fillStyle = "#3a1a10";
  if (kind === 0 || kind === 1) {
    // Geige/Cello + Bogen
    const big = kind === 1;
    g.beginPath();
    g.ellipse(big ? 12 : 8, big ? -22 : -44, big ? 11 : 6.5, big ? 17 : 9, 0.5, 0, TAU);
    g.fill();
    const bowA = reduced ? 0 : Math.sin(t * 5.5 + seed * 2) * 0.28;
    g.save();
    g.translate(big ? 14 : 12, big ? -22 : -44);
    g.rotate(-0.7 + bowA);
    g.strokeStyle = "rgba(255,190,120,0.75)";
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(-26, 0);
    g.lineTo(26, 0);
    g.stroke();
    g.restore();
  } else if (kind === 2) {
    // Trompete
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(6, -46);
    g.lineTo(36, -52);
    g.stroke();
    g.beginPath();
    g.moveTo(36, -52);
    g.lineTo(46, -60);
    g.lineTo(46, -44);
    g.closePath();
    g.fillStyle = "rgba(255,200,100,0.85)";
    g.fill();
  } else {
    // Flöte
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(4, -60);
    g.lineTo(38, -66);
    g.stroke();
  }
  g.restore();
}

/** Orchestergraben zeichnen (Bildschirm-x0…x1, Boden y = gy, Tiefe H). */
export function drawPit(g: Ctx2D, x0: number, x1: number, gy: number, H: number, v: ViewState, k: number): void {
  void k;
  const a = Math.round(Math.max(-20, x0));
  const b = Math.round(Math.min(v.w + 20, x1));
  if (b <= a) return;
  g.fillStyle = shaftGradient(g, gy, H);
  g.fillRect(a, gy, b - a, H);
  // Rückwand: Goldleiste + Zierstreifen
  g.fillStyle = "rgba(224,165,42,0.55)";
  g.fillRect(a, gy + 22, b - a, 3);
  g.fillStyle = "rgba(120,30,40,0.5)";
  g.fillRect(a, gy + 25, b - a, 12);
  g.save();
  g.beginPath();
  g.rect(a, gy, b - a, H);
  g.clip();
  // Musiker (weltfestes Raster)
  const base = gy + H - 6;
  const first = Math.floor((a + v.dist - 40) / STEP) * STEP;
  for (let wx = first; wx < b + v.dist + 40; wx += STEP) {
    const seed = Math.round(wx / STEP);
    if (h1(seed * 1.9) < 0.18) continue;
    const x = wx - v.dist + (h1(seed) - 0.5) * 12;
    musician(g, x, base - (h1(seed * 5) - 0.5) * 8, seed, v.time, v.reducedMotion);
    // Pultlämpchen
    if (v.quality > 0) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.55;
      g.fillStyle = "#ffcf7a";
      g.beginPath();
      g.arc(x + 24, base - 44, 4.5, 0, TAU);
      g.fill();
      g.globalAlpha = 0.22;
      g.beginPath();
      g.arc(x + 24, base - 44, 14, 0, TAU);
      g.fill();
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
  }
  // Seitenschatten
  g.fillStyle = "rgba(0,0,0,0.55)";
  g.fillRect(a, gy, 16, H);
  g.fillStyle = "rgba(0,0,0,0.3)";
  g.fillRect(a + 16, gy, 14, H);
  g.fillRect(b - 24, gy, 24, H);
  g.restore();
  // Lichtschein steigt aus dem Graben auf (Lücke schon von weitem lesbar)
  if (v.quality > 0) {
    const flick = v.reducedMotion ? 1 : 0.9 + 0.1 * Math.sin(v.time * 7 + mod(a, 13));
    const grd = g.createLinearGradient(0, gy - 70, 0, gy + 6);
    grd.addColorStop(0, "rgba(255,170,90,0)");
    grd.addColorStop(1, `rgba(255,170,90,${0.34 * flick})`);
    g.globalCompositeOperation = "lighter";
    g.fillStyle = grd;
    g.fillRect(a + 8, gy - 70, b - a - 16, 76);
    g.globalCompositeOperation = "source-over";
  }
}
