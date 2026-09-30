/** Eingebaute Vektor-Icons für Pickups (Fallback, falls keine Props-Sprites vorhanden). Zentrum = (cx, cy). */
import { rgba, roundRect } from "./draw-utils";
import type { PickupType, PropLibrary } from "./types";

const PROP_IDS: Record<PickupType, string> = {
  coin: "coin",
  gem: "gem",
  heart: "heart",
  magnet: "powerup-magnet",
  shield: "powerup-shield",
  slowmo: "powerup-slowmo",
  turbo: "powerup-turbo",
};

export function propIdForPickup(t: PickupType): string {
  return PROP_IDS[t];
}

export function drawCoinVector(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, t: number, seed: number): void {
  const spin = Math.cos(t * 5 + seed * 1.7);
  const sx = 0.28 + 0.72 * Math.abs(spin);
  g.save();
  g.translate(cx, cy + Math.sin(t * 3 + seed) * 2);
  g.scale(sx, 1);
  const grd = g.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
  grd.addColorStop(0, "#fff3a6");
  grd.addColorStop(0.5, "#ffd23f");
  grd.addColorStop(1, "#e59a0e");
  g.fillStyle = grd;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = Math.max(2, r * 0.16);
  g.strokeStyle = "#c27808";
  g.stroke();
  g.lineWidth = Math.max(1, r * 0.08);
  g.strokeStyle = "rgba(255,255,255,0.55)";
  g.beginPath();
  g.arc(0, 0, r * 0.66, 0, Math.PI * 2);
  g.stroke();
  // Pfotenabdruck / F
  g.fillStyle = "#c27808";
  g.font = `900 ${Math.round(r * 1.15)}px system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("F", 0, r * 0.06);
  g.restore();
}

export function drawGemVector(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, t: number): void {
  g.save();
  g.translate(cx, cy + Math.sin(t * 2.6) * 3);
  g.rotate(Math.sin(t * 1.8) * 0.12);
  const grd = g.createLinearGradient(-r, -r, r, r);
  grd.addColorStop(0, "#ff9ab3");
  grd.addColorStop(0.5, "#ff2d6f");
  grd.addColorStop(1, "#a3103d");
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(0, -r);
  g.lineTo(r * 0.9, -r * 0.2);
  g.lineTo(0, r);
  g.lineTo(-r * 0.9, -r * 0.2);
  g.closePath();
  g.fill();
  g.strokeStyle = "rgba(255,255,255,0.75)";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(-r * 0.9, -r * 0.2);
  g.lineTo(r * 0.9, -r * 0.2);
  g.moveTo(-r * 0.35, -r * 0.2);
  g.lineTo(0, -r);
  g.lineTo(r * 0.35, -r * 0.2);
  g.stroke();
  g.fillStyle = "rgba(255,255,255,0.7)";
  g.beginPath();
  g.ellipse(-r * 0.3, -r * 0.5, r * 0.12, r * 0.22, -0.6, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function heartPath(g: CanvasRenderingContext2D, r: number): void {
  g.beginPath();
  g.moveTo(0, r * 0.85);
  g.bezierCurveTo(-r * 1.5, -r * 0.1, -r * 0.9, -r * 1.05, 0, -r * 0.45);
  g.bezierCurveTo(r * 0.9, -r * 1.05, r * 1.5, -r * 0.1, 0, r * 0.85);
  g.closePath();
}

export function drawHeartVector(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, t = 0, filled = true, urgent = false): void {
  g.save();
  g.translate(cx, cy);
  // Herzschlag: bei der letzten Leben schneller und stärker
  const beat = 1 + Math.sin(t * (urgent ? 11 : 6)) * (urgent ? 0.11 : 0.05);
  g.scale(beat, beat);
  heartPath(g, r);
  if (filled) {
    // leuchtendes, gesättigtes Rot mit hellem Rand: hebt sich von jedem Hintergrund ab
    g.shadowColor = urgent ? "rgba(255,40,40,0.95)" : "rgba(255,50,50,0.75)";
    g.shadowBlur = r * (urgent ? 1.1 : 0.8);
    g.lineWidth = Math.max(4, r * 0.34);
    g.strokeStyle = "rgba(255,255,255,0.95)";
    g.lineJoin = "round";
    g.stroke();
    g.shadowBlur = 0;
    const grd = g.createLinearGradient(0, -r, 0, r);
    grd.addColorStop(0, "#ff5252");
    grd.addColorStop(0.45, "#f0141e");
    grd.addColorStop(1, "#b00012");
    g.fillStyle = grd;
    g.fill();
    g.lineWidth = Math.max(2, r * 0.16);
    g.strokeStyle = "#5c0010";
    g.stroke();
    g.fillStyle = "rgba(255,255,255,0.7)";
    g.beginPath();
    g.ellipse(-r * 0.5, -r * 0.42, r * 0.24, r * 0.14, -0.6, 0, Math.PI * 2);
    g.fill();
  } else {
    // verlorenes Herz: dunkler Rahmen mit roter Kontur – der Platz bleibt lesbar
    g.fillStyle = "rgba(48,6,14,0.7)";
    g.fill();
    g.lineWidth = Math.max(2, r * 0.16);
    g.strokeStyle = "rgba(255,70,70,0.6)";
    g.stroke();
  }
  g.restore();
}

/** Power-up in Blasen-Optik. */
export function drawPowerupVector(g: CanvasRenderingContext2D, type: PickupType, cx: number, cy: number, r: number, t: number): void {
  const colors: Record<string, [string, string]> = {
    magnet: ["#ff6b6b", "#7f1d1d"],
    shield: ["#67e8f9", "#0e7490"],
    slowmo: ["#c4b5fd", "#5b21b6"],
    turbo: ["#fde047", "#b45309"],
  };
  const [c1, c2] = colors[type] ?? ["#fff", "#888"];
  g.save();
  g.translate(cx, cy + Math.sin(t * 3) * 4);
  // Glow
  const glow = g.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 1.9);
  glow.addColorStop(0, rgba(c1, 0.55));
  glow.addColorStop(1, rgba(c1, 0));
  g.fillStyle = glow;
  g.fillRect(-r * 2, -r * 2, r * 4, r * 4);
  // Blase
  const grd = g.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
  grd.addColorStop(0, "rgba(255,255,255,0.95)");
  grd.addColorStop(0.35, rgba(c1, 0.95));
  grd.addColorStop(1, c2);
  g.fillStyle = grd;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = "rgba(255,255,255,0.85)";
  g.stroke();
  // Icon
  g.fillStyle = "#fff";
  g.strokeStyle = "#fff";
  g.lineWidth = 4;
  g.lineCap = "round";
  g.lineJoin = "round";
  switch (type) {
    case "magnet":
      g.beginPath();
      g.arc(0, 2, r * 0.42, Math.PI, 0);
      g.lineTo(r * 0.42, r * 0.5);
      g.moveTo(-r * 0.42, 2);
      g.lineTo(-r * 0.42, r * 0.5);
      g.stroke();
      g.fillStyle = "#e5e7eb";
      g.fillRect(-r * 0.55, r * 0.42, r * 0.26, r * 0.22);
      g.fillRect(r * 0.29, r * 0.42, r * 0.26, r * 0.22);
      break;
    case "shield":
      g.beginPath();
      g.moveTo(0, -r * 0.55);
      g.lineTo(r * 0.5, -r * 0.3);
      g.quadraticCurveTo(r * 0.5, r * 0.4, 0, r * 0.62);
      g.quadraticCurveTo(-r * 0.5, r * 0.4, -r * 0.5, -r * 0.3);
      g.closePath();
      g.fill();
      break;
    case "slowmo":
      g.beginPath();
      g.moveTo(-r * 0.36, -r * 0.5);
      g.lineTo(r * 0.36, -r * 0.5);
      g.lineTo(0, 0);
      g.lineTo(r * 0.36, r * 0.5);
      g.lineTo(-r * 0.36, r * 0.5);
      g.lineTo(0, 0);
      g.closePath();
      g.fill();
      break;
    case "turbo":
      g.beginPath();
      g.moveTo(r * 0.1, -r * 0.62);
      g.lineTo(-r * 0.4, r * 0.1);
      g.lineTo(-r * 0.02, r * 0.1);
      g.lineTo(-r * 0.12, r * 0.62);
      g.lineTo(r * 0.42, -r * 0.14);
      g.lineTo(r * 0.04, -r * 0.14);
      g.closePath();
      g.fill();
      break;
    default:
      break;
  }
  // Glanzpunkt
  g.fillStyle = "rgba(255,255,255,0.9)";
  g.beginPath();
  g.arc(-r * 0.4, -r * 0.45, r * 0.13, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

export function drawPickup(
  g: CanvasRenderingContext2D,
  props: PropLibrary,
  type: PickupType,
  skin: string,
  cx: number,
  cy: number,
  size: number,
  t: number,
  seed: number,
): void {
  const id = propIdForPickup(type);
  const skinId = skin && skin !== type ? skin : null;
  const r = size / 2;
  if (skinId && props.has(skinId) && props.draw(g, skinId, cx, cy + Math.sin(t * 3 + seed) * 2, { h: size * 1.15, t: t + seed, ax: 0.5, ay: 0.5 })) return;
  const drawn = props.has(id) && props.draw(g, id, cx, cy + (type === "coin" ? 0 : Math.sin(t * 3) * 4), { h: type === "coin" ? size * 1.1 : size * 1.45, t: t + seed * 0.3, ax: 0.5, ay: 0.5 });
  if (drawn) return;
  if (type === "coin") drawCoinVector(g, cx, cy, r * 1.05, t, seed);
  else if (type === "gem") drawGemVector(g, cx, cy, r * 1.05, t);
  else if (type === "heart") drawHeartVector(g, cx, cy + Math.sin(t * 3) * 3, r * 0.8, t);
  else drawPowerupVector(g, type, cx, cy, r * 0.62, t);
}

export { roundRect };
