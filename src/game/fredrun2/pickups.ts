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

/**
 * Herz mit Herzschlag. `glowScale` skaliert nur den Schein (shadowBlur rechnet in Bitmap-Pixeln, nicht in Logikeinheiten): 1 = wie
 * bisher; beim Vorrendern der HUD-Sprites steht hier die Bake-Skala, damit der Schein in jeder Auflösung gleich groß aussieht.
 */
export function drawHeartVector(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, t = 0, filled = true, urgent = false, glowScale = 1): void {
  g.save();
  g.translate(cx, cy);
  // Herzschlag: bei der letzten Leben schneller und stärker
  const beat = 1 + Math.sin(t * (urgent ? 11 : 6)) * (urgent ? 0.11 : 0.05);
  g.scale(beat, beat);
  heartPath(g, r);
  if (filled) {
    // leuchtendes, gesättigtes Rot mit hellem Rand: hebt sich von jedem Hintergrund ab
    g.shadowColor = urgent ? "rgba(255,40,40,0.95)" : "rgba(255,50,50,0.75)";
    g.shadowBlur = r * (urgent ? 1.1 : 0.8) * glowScale;
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

// =====================================================================================================================
// HUD-Sprites: Herzen, Herzleiste, Münz-Icon und Power-up-Blasen werden einmalig in Renderer-Skala vorgerendert (Schein als
// fertiger Halo statt shadowBlur, Verläufe und "F" ohne Gradient/fillText im Frame) und per drawImage gezeichnet. Der Cache hält je
// Variante genau eine Canvas und backt bei Skalenwechsel (cssScale/dpr) neu. Ohne Canvas (Node, Tests) liefert er null: die
// Aufrufer zeichnen dann mit den Vektor-Funktionen oben.
// =====================================================================================================================

export type HudSpriteKind = "heart" | "heart-urgent" | "heart-empty" | "heart-bar" | "coin" | "pu-magnet" | "pu-shield" | "pu-slowmo" | "pu-turbo";

/** Radien der HUD-Symbole in Logikeinheiten (Herz und Münze wie bisher im HUD, Power-up-Blase r≈14) */
export const HUD_HEART_R = 19;
export const HUD_COIN_R = 15;
export const HUD_POWERUP_R = 14;
/** Maße der Herz-Leiste (Logikeinheiten) */
export const HUD_HEART_BAR = { w: 276, h: 52 } as const;

/**
 * Halbe Kantenlänge der Sprites (Symbol plus Schein bzw. Glow) in Logikeinheiten, knapp um das Sichtbare gelegt (weniger
 * Überzeichnung beim drawImage): Herz-Umriss etwa 25, dazu der Schein (0,8 bzw. 1,1 * r) beim gefüllten und dringenden Herz.
 */
const HEART_HALF: Record<"heart" | "heart-urgent" | "heart-empty", number> = { heart: 44, "heart-urgent": 48, "heart-empty": 28 };
const COIN_HALF = 21;
const POWERUP_HALF = 30;
/** Rand um die Herz-Leiste (Antialiasing der Kante) */
const BAR_PAD = 1;

export interface HudSprite {
  canvas: CanvasImageSource;
  /** Zielrechteck in Logikeinheiten: relativ zum Mittelpunkt (Herz, Münze, Power-up) bzw. zur linken oberen Ecke (Leiste) */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Bitmap-Pixel je Logikeinheit, in der gebacken wurde */
  px: number;
}

/** Das Minimum, das der Cache von einer Zeichenfläche braucht (HTMLCanvasElement erfüllt es) */
export interface SpriteCanvas {
  width: number;
  height: number;
  getContext(type: "2d"): CanvasRenderingContext2D | null;
}
export type SpriteCanvasFactory = () => SpriteCanvas | null;

function defaultSpriteCanvas(): SpriteCanvas | null {
  if (typeof document === "undefined") return null;
  return document.createElement("canvas");
}

/** Rastet die Bake-Skala auf 1/8 (weniger Neubacken bei krummen Skalen) und nie unter 0,5. */
export function quantizeBakeScale(px: number): number {
  if (!(px > 0) || !Number.isFinite(px)) return 1;
  return Math.max(0.5, Math.round(px * 8) / 8);
}

interface SpriteSlot {
  surface: SpriteCanvas | null;
  sprite: HudSprite | null;
  px: number;
}

const POWERUP_SPRITE: Partial<Record<HudSpriteKind, PickupType>> = { "pu-magnet": "magnet", "pu-shield": "shield", "pu-slowmo": "slowmo", "pu-turbo": "turbo" };

export class HudSpriteCache {
  private slots: Partial<Record<HudSpriteKind, SpriteSlot>> = {};
  /** Anzahl der Bake-Vorgänge (Diagnose/Tests) */
  bakes = 0;
  /** Anzahl erzeugter Canvases: je Variante höchstens eine, auch über Skalenwechsel hinweg */
  canvases = 0;

  constructor(private make: SpriteCanvasFactory = defaultSpriteCanvas) {}

  /** Tauscht die Canvas-Fabrik (Tests, andere Backends) und verwirft alle Sprites. */
  setFactory(make: SpriteCanvasFactory): void {
    this.make = make;
    this.clear();
  }

  clear(): void {
    this.slots = {};
    this.bakes = 0;
    this.canvases = 0;
  }

  /**
   * Sprite der Variante `kind` bei `px` Bitmap-Pixeln je Logikeinheit (Renderer-Skala mal HUD-Skalierung); null, wenn keine
   * Canvas verfügbar ist (Aufrufer zeichnen dann vektoriell). Im Normalfall ein Property-Lookup, gebacken wird nur bei neuer Skala.
   */
  get(kind: HudSpriteKind, px: number): HudSprite | null {
    const q = quantizeBakeScale(px);
    let slot = this.slots[kind];
    if (slot && slot.px === q) return slot.sprite;
    if (!slot) {
      slot = { surface: null, sprite: null, px: q };
      this.slots[kind] = slot;
    }
    slot.px = q;
    slot.sprite = this.bake(kind, q, slot);
    return slot.sprite;
  }

  private bake(kind: HudSpriteKind, q: number, slot: SpriteSlot): HudSprite | null {
    // Zielrechteck in Logikeinheiten (Mittelpunkt-bezogen; die Leiste misst ab ihrer linken oberen Ecke)
    let x: number;
    let y: number;
    let w: number;
    let h: number;
    if (kind === "heart-bar") {
      x = -BAR_PAD;
      y = -BAR_PAD;
      w = HUD_HEART_BAR.w + BAR_PAD * 2;
      h = HUD_HEART_BAR.h + BAR_PAD * 2;
    } else {
      const half = kind === "coin" ? COIN_HALF : kind in POWERUP_SPRITE ? POWERUP_HALF : HEART_HALF[kind as keyof typeof HEART_HALF];
      x = -half;
      y = -half;
      w = half * 2;
      h = half * 2;
    }
    const cw = Math.max(1, Math.ceil(w * q));
    const ch = Math.max(1, Math.ceil(h * q));
    if (!slot.surface) {
      slot.surface = this.make();
      if (slot.surface) this.canvases += 1;
    }
    const surface = slot.surface;
    if (!surface) return null;
    // Größe setzen leert die Fläche (auch bei gleichem Wert)
    surface.width = cw;
    surface.height = ch;
    const sg = surface.getContext("2d");
    if (!sg) return null;
    this.bakes += 1;
    // Logikeinheiten -> Bitmap; der Ursprung (0,0) liegt im Mittelpunkt des Symbols bzw. in der Ecke der Leiste
    sg.setTransform(q, 0, 0, q, -x * q, -y * q);
    if (kind === "heart-bar") {
      const grd = sg.createLinearGradient(0, 0, 0, HUD_HEART_BAR.h);
      grd.addColorStop(0, "rgba(150,14,28,0.75)");
      grd.addColorStop(1, "rgba(70,4,14,0.8)");
      roundRect(sg, 0, 0, HUD_HEART_BAR.w, HUD_HEART_BAR.h, HUD_HEART_BAR.h / 2);
      sg.fillStyle = grd;
      sg.fill();
    } else if (kind === "coin") {
      drawCoinVector(sg, 0, 0, HUD_COIN_R, 0, 0);
    } else if (kind in POWERUP_SPRITE) {
      drawPowerupVector(sg, POWERUP_SPRITE[kind] ?? "magnet", 0, 0, HUD_POWERUP_R, 0);
    } else {
      // Herzschlag t = 0 -> Skala 1; der Schein wird in Bitmap-Pixeln gerechnet, daher mit der Bake-Skala
      drawHeartVector(sg, 0, 0, HUD_HEART_R, 0, kind !== "heart-empty", kind === "heart-urgent", q);
    }
    return { canvas: surface as unknown as CanvasImageSource, x, y, w: cw / q, h: ch / q, px: q };
  }
}

/** Gemeinsamer Cache für das HUD (eine Renderer-Skala zur Zeit; bei zwei Spielflächen mit verschiedener Skala wird neu gebacken). */
export const hudSprites = new HudSpriteCache();

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
