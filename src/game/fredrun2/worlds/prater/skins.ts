/** Prater – Entitäts-Skins (prozedural; Props, wo sie besser aussehen, mit prozeduralem Fallback). */
import type { Ent, PropLibrary, ViewState } from "../../types";
import { colorWithAlpha, glowAt, glowSprite, paint, rr, softSprite, spriteStrip, drawStripFrame, type Ctx2D } from "../shared-b/canvas";
import { heartPath } from "./backdrop";
import { PropBank, fitBox, quant, type Baked, type PropCrop } from "./propfit";

const TAU = Math.PI * 2;

export interface PraterSkinAssets {
  props: PropLibrary | null;
  /** vorgerenderte Hindernis-Sprites (Buden, Kisten, Reifen, Behang, Geistertor, Kettenkarussell-Sitz) */
  bank: PropBank;
  jeton: HTMLCanvasElement;
  jetonSize: number;
  glowPink: HTMLCanvasElement;
  glowGold: HTMLCanvasElement;
  glowCyan: HTMLCanvasElement;
  glowWhite: HTMLCanvasElement;
  softGhost: HTMLCanvasElement;
  candy: HTMLCanvasElement;
  valance: HTMLCanvasElement;
}

export function makeSkinAssets(): PraterSkinAssets {
  const size = 64;
  const jeton = spriteStrip(12, size, (g, f, s) => {
    const ang = (f / 12) * TAU;
    const sx = Math.max(0.12, Math.abs(Math.cos(ang)));
    const back = Math.cos(ang) < 0;
    g.translate(s / 2, s / 2);
    g.scale(sx, 1);
    const r = s * 0.42;
    // Rand (Gold)
    const rim = g.createLinearGradient(-r, -r, r, r);
    rim.addColorStop(0, "#fff2a8");
    rim.addColorStop(0.5, "#ffc93a");
    rim.addColorStop(1, "#c77a10");
    g.fillStyle = rim;
    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    g.fill();
    // Kerben
    g.fillStyle = "rgba(140,70,10,0.55)";
    for (let i = 0; i < 16; i += 1) {
      const a = (i / 16) * TAU;
      g.save();
      g.rotate(a);
      g.fillRect(r - 5, -1.5, 5, 3);
      g.restore();
    }
    // Innenfläche Magenta
    const inner = g.createRadialGradient(-r * 0.25, -r * 0.3, 1, 0, 0, r * 0.75);
    inner.addColorStop(0, back ? "#ffb3d9" : "#ff9ccd");
    inner.addColorStop(1, back ? "#b0145e" : "#d81b78");
    g.fillStyle = inner;
    g.beginPath();
    g.arc(0, 0, r * 0.7, 0, TAU);
    g.fill();
    // Stern
    g.fillStyle = "#fff4c2";
    g.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const a = -Math.PI / 2 + (i / 10) * TAU;
      const rad = i % 2 === 0 ? r * 0.5 : r * 0.22;
      if (i === 0) g.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
      else g.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(120,40,10,0.6)";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    g.stroke();
    // Glanz
    g.fillStyle = "rgba(255,255,255,0.65)";
    g.beginPath();
    g.ellipse(-r * 0.35, -r * 0.45, r * 0.16, r * 0.28, -0.6, 0, TAU);
    g.fill();
  });
  const candy = paint(96, 96, (g) => {
    // Zuckerwatte-Wolke (Textur für Kisten-Füllung)
    const puffs = [
      [30, 50, 22, "#ffc0de"],
      [52, 42, 24, "#ffd6ea"],
      [70, 52, 20, "#c9e8ff"],
      [44, 60, 18, "#ffb0d6"],
      [62, 62, 18, "#ffc8e4"],
    ] as const;
    for (const [x, y, r, c] of puffs) {
      const grd = g.createRadialGradient(x - r * 0.3, y - r * 0.4, 2, x, y, r);
      grd.addColorStop(0, "#ffffff");
      grd.addColorStop(0.5, c);
      grd.addColorStop(1, colorWithAlpha(c, 0.85));
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
    }
  });
  return {
    props: null,
    bank: new PropBank(),
    jeton,
    jetonSize: size,
    glowPink: glowSprite("#ff4fa3"),
    glowGold: glowSprite("#ffc94a"),
    glowCyan: glowSprite("#5ef2ff"),
    glowWhite: glowSprite("#fff6e0"),
    softGhost: softSprite("rgba(170,255,240,0.9)"),
    candy,
    valance: valanceTexture(),
  };
}

// ------------------------------------------------------------------------------------------------

export interface SkinCtx {
  night: number;
  time: number;
  quality: 0 | 1 | 2;
  reduced: boolean;
}

export function drawJeton(g: Ctx2D, A: PraterSkinAssets, e: Ent, sx: number, sy: number, v: ViewState): void {
  const f = Math.floor((v.time * 9 + e.id * 1.7) % 12);
  const cx = sx + e.w / 2;
  const cy = sy + e.h / 2 + Math.sin(v.time * 3 + e.id) * 2;
  const s = e.w * 1.18;
  if (v.quality > 0) {
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.35;
    glowAt(g, A.glowPink, cx, cy, s * 0.85);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
  drawStripFrame(g, A.jeton, A.jetonSize, f, cx, cy, s);
}

// ------------------------------------------------------------------------------------------------
// Hindernis-Props (prater-*.webp): eng zugeschnittene Silhouetten, in Zielgröße vorgerendert (PropBank)

export const OBSTACLE_PROPS = {
  booth: "prater-booth",
  candy: "prater-candy-crate",
  tires: "prater-tires",
  valance: "prater-valance",
  gate: "prater-ghostgate",
  seat: "prater-swing-chair",
} as const;

/** Erlaubtes Verhältnis Ziel/Natur (Höhe zu Breite), siehe fitBox: [min, max] */
const FIT = {
  booth: [0.72, 1.4],
  candy: [0.72, 1.3],
  tires: [0.72, 1.4],
} as const;

/** Silhouette mit Fußmitte (cx, foot) zeichnen; auf das Pixelraster gerundet */
function blit(g: Ctx2D, A: PraterSkinAssets, b: Baked, cx: number, foot: number): void {
  g.drawImage(b.c, A.bank.snap(cx - b.w / 2), A.bank.snap(foot - b.h), b.w, b.h);
}

/** Block-Sprite für eine Hitbox w×h (Zeichnen und Vorbacken nutzen dieselbe Rechnung → derselbe Cache-Eintrag) */
function bakeBlock(A: PraterSkinAssets, id: string, w: number, h: number, lim: readonly [number, number]): Baked | null {
  const asp = A.bank.aspect(id);
  if (asp === null) return null;
  const f = fitBox(asp, w, h, lim[0], lim[1]);
  return A.bank.get(id, quant(f.w), quant(f.h));
}

/** Bodenblock: Prop in die Hitbox einpassen (Unterkante 2 px in den Boden). false = Prop fehlt → prozeduraler Fallback. */
function blockSprite(g: Ctx2D, A: PraterSkinAssets, id: string, e: Ent, sx: number, sy: number, lim: readonly [number, number]): boolean {
  const b = bakeBlock(A, id, e.w, e.h, lim);
  if (!b) return false;
  blit(g, A, b, sx + e.w / 2, sy + e.h + 2);
  return true;
}

/** Hängende Aufhängung (Seil/Kette) von der Sprite-Oberkante (x0, y0) aus dem Bild: nimmt die Neigung des Sprites auf und läuft oben senkrecht aus */
function hanger(g: Ctx2D, x0: number, y0: number, slope: number, width: number, kind: "rope" | "chain"): void {
  const top = -14;
  const dy = y0 - top;
  if (dy <= 2) return;
  const h1 = dy * 0.4;
  const c1x = x0 + slope * h1;
  g.beginPath();
  g.moveTo(x0 - slope * 4, y0 + 4);
  g.lineTo(x0, y0);
  g.quadraticCurveTo(c1x, y0 - h1, c1x, top);
  g.lineCap = "butt";
  g.lineJoin = "round";
  if (kind === "rope") {
    g.strokeStyle = "#1a0d05";
    g.lineWidth = width + 2.6;
    g.stroke();
    g.strokeStyle = "#e3a826";
    g.lineWidth = width;
    g.stroke();
    // Drehung des Seils: feine Querstriche
    g.setLineDash([1.6, 2.6]);
    g.strokeStyle = "#a8701a";
    g.lineWidth = width * 0.8;
    g.stroke();
    g.setLineDash([]);
    return;
  }
  // Kette: Umriss, große Glieder (Blick auf die Fläche, mit Loch) im Wechsel mit schmalen Gliedern (Kante)
  const p = width * 1.25;
  g.strokeStyle = "#100c14";
  g.lineWidth = width + 2.6;
  g.stroke();
  g.setLineDash([p * 0.66, p * 0.34]);
  g.strokeStyle = "#62647c";
  g.lineWidth = width;
  g.stroke();
  g.setLineDash([p * 0.34, p * 0.66]);
  g.lineDashOffset = -p * 0.16;
  g.strokeStyle = "#1c1822";
  g.lineWidth = width * 0.42;
  g.stroke();
  g.setLineDash([p * 0.26, p * 0.74]);
  g.lineDashOffset = -p * 0.67;
  g.strokeStyle = "#9b9fb8";
  g.lineWidth = width * 0.5;
  g.stroke();
  g.setLineDash([]);
  g.lineDashOffset = 0;
}

/** Sitz des Kettenkarussells: unterer Ausschnitt von prater-swing-chair (Sitzschale + Schäkel), die Ketten zeichnen wir selbst */
const SEAT_CROP: PropCrop = [0, 0.388, 1, 1];
/** Breite des Sitzes (logische px) – Hitbox-Kreis r = 34 (Ø 68), Silhouette knapp darüber */
const SEAT_W = 98;
/** Höhenanteil des Ausschnitts, der auf dem Pendel-Mittelpunkt liegt (Schwerpunkt der Sitzschale) */
const SEAT_CY = 0.6;
/** Ketten-Ansatz als Anteil der Sprite-Breite (nach Spiegelung) und ob golden (sonst Stahl) */
const SEAT_CHAINS: ReadonlyArray<readonly [number, boolean]> = [
  [0.054, false],
  [0.157, true],
  [0.806, false],
  [0.912, true],
];

function seatSprite(A: PraterSkinAssets, r: number): { b: Baked; w: number; h: number } | null {
  const asp = A.bank.aspect(OBSTACLE_PROPS.seat, SEAT_CROP);
  if (asp === null) return null;
  const w = SEAT_W * (r / 34);
  const h = w * asp;
  const b = A.bank.get(OBSTACLE_PROPS.seat, w, h, SEAT_CROP);
  return b ? { b, w: b.w, h: b.h } : null;
}

/**
 * Maße der Hindernisse mit FESTEM Maß (px): Reifen (Hitbox w×h) und Radius des Kettenkarussell-Sitzes. Buden, Kisten,
 * Behänge und Tore nehmen ihre Maße vom Tempo (35–75 verschiedene Größen je Art in echten Läufen) – sie lassen sich nicht
 * sinnvoll vorbacken (jede Größe wäre ein eigenes Sprite im Speicher) und entstehen weiter beim ersten Zeichnen
 * (klein, ca. 3–4 ms). Der Test in prater.test.ts prüft die Liste gegen alle Muster.
 */
export const PRATER_PROP_SIZES = {
  tires: [[88, 70], [88, 96]],
  /** Radius des Kettenkarussell-Sitzes */
  seat: [34],
} as const;

/** Ein Vorback-Auftrag je Sprite (Zeichnen und Vorbacken teilen die Rechnung → gleicher Cache-Eintrag); leer ohne Props. */
export function praterPropJobs(A: PraterSkinAssets): Array<() => unknown> {
  const jobs: Array<() => unknown> = [];
  for (const [w, h] of PRATER_PROP_SIZES.tires) jobs.push(() => bakeBlock(A, OBSTACLE_PROPS.tires, w, h, FIT.tires));
  for (const r of PRATER_PROP_SIZES.seat) jobs.push(() => seatSprite(A, r));
  return jobs;
}

/** Hängender Überhang: Sprite bündig auf der Hitbox-Unterkante, Breite = Hitbox-Breite */
function overheadSprite(A: PraterSkinAssets, id: string, e: Ent): Baked | null {
  const asp = A.bank.aspect(id);
  if (asp === null) return null;
  // Breite auf 8 px gerundet (aufwärts): wenige Größen im Cache, das Bild ist nie schmaler als die Hitbox
  const w = quant(e.w, 8);
  return A.bank.get(id, w, w * asp);
}

/** Kettenkarussell-Sitz inkl. Ketten und Baldachin am Ankerpunkt */
export function drawSwingChair(g: Ctx2D, A: PraterSkinAssets, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
  const ax = e.p.ax - v.dist;
  const ay = e.p.ay;
  const r = e.p.r || e.w / 2;
  const cx = sx + e.w / 2;
  const cy = sy + e.h / 2;
  const ang = e.fx.angle ?? 0;
  // Mast nach oben + Baldachin-Segment
  g.fillStyle = "#3a2338";
  g.fillRect(ax - 3, -10, 6, ay + 10);
  const cw = 120;
  const top = ay - 34;
  for (let i = 0; i < 8; i += 1) {
    g.fillStyle = i % 2 ? "#fff1f6" : "#e2366f";
    g.beginPath();
    g.moveTo(ax, top - 16);
    g.lineTo(ax - cw / 2 + (i / 8) * cw, top + 20);
    g.lineTo(ax - cw / 2 + ((i + 1) / 8) * cw, top + 20);
    g.closePath();
    g.fill();
  }
  for (let i = 0; i < 8; i += 1) {
    g.fillStyle = i % 2 ? "#ffd24a" : "#e2366f";
    g.beginPath();
    g.arc(ax - cw / 2 + (i + 0.5) * (cw / 8), top + 20, cw / 16, 0, Math.PI);
    g.fill();
  }
  g.fillStyle = "#ffd24a";
  g.fillRect(ax - 8, ay - 8, 16, 10);
  if (k.night > 0.2) {
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = k.night;
    for (let i = 0; i <= 8; i += 1) glowAt(g, i % 2 ? A.glowGold : A.glowPink, ax - cw / 2 + (i / 8) * cw, top + 22, 9);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  // Prop-Sitz (vier Ketten, Sitz aus prater-swing-chair); Ketten laufen prozedural zum Aufhängepunkt
  const seat = seatSprite(A, r);
  if (seat) {
    const { b, w, h } = seat;
    // Ketten: (Anteil an der Sprite-Breite, golden?) – gespiegelt, der Sitz schaut in Laufrichtung
    g.lineCap = "butt";
    g.lineJoin = "round";
    for (const [u, gold] of SEAT_CHAINS) {
      const lx = (u - 0.5) * w;
      const ly = -SEAT_CY * h + 3;
      const tx = cx + lx * ca + ly * sa;
      const ty = cy - lx * sa + ly * ca;
      const topX = ax + (u - 0.5) * 22;
      g.beginPath();
      g.moveTo(topX, ay);
      g.lineTo(tx, ty);
      g.strokeStyle = "#1a1218";
      g.lineWidth = 3.6;
      g.stroke();
      g.setLineDash([3.4, 1.6]);
      g.strokeStyle = gold ? "#f4c53a" : "#c3cad8";
      g.lineWidth = 2;
      g.stroke();
      g.setLineDash([]);
    }
    g.save();
    g.translate(cx, cy);
    g.rotate(-ang);
    // Warn-Rimlight (Gefahr lesbar auch nachts)
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.4 + 0.25 * k.night;
    glowAt(g, A.glowPink, 0, 4, r * 1.9);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    g.scale(-1, 1);
    g.drawImage(b.c, -w / 2, -SEAT_CY * h, w, h);
    g.restore();
    return;
  }
  // Ketten (zwei, zu den Sitz-Ecken)
  const seatTopX = cx - sa * r * 0.55;
  const seatTopY = cy - ca * r * 0.55;
  g.strokeStyle = "#cfc6d8";
  g.lineWidth = 2;
  g.setLineDash([5, 3]);
  g.beginPath();
  g.moveTo(ax - 4, ay);
  g.lineTo(seatTopX - ca * r * 0.7, seatTopY + sa * r * 0.7);
  g.moveTo(ax + 4, ay);
  g.lineTo(seatTopX + ca * r * 0.7, seatTopY - sa * r * 0.7);
  g.stroke();
  g.setLineDash([]);
  // Sitz (lokal rotiert)
  g.save();
  g.translate(cx, cy);
  g.rotate(-ang);
  // Warn-Rimlight (Gefahr lesbar auch nachts)
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = 0.45 + 0.25 * k.night;
  glowAt(g, A.glowPink, 0, 4, r * 1.9);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  g.scale(1.3, 1.3);
  // Rückenlehne
  g.fillStyle = "#b3124f";
  g.beginPath();
  rr(g, -r * 0.62, -r * 0.62, r * 0.28, r * 1.05, 6);
  g.fill();
  g.fillStyle = "#ffd24a";
  g.beginPath();
  g.arc(-r * 0.48, -r * 0.62, r * 0.14, 0, TAU);
  g.fill();
  // Sitzfläche (Schale)
  const grd = g.createLinearGradient(0, -r * 0.3, 0, r * 0.6);
  grd.addColorStop(0, "#ff5fa8");
  grd.addColorStop(1, "#b3124f");
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(-r * 0.7, -r * 0.1);
  g.lineTo(r * 0.72, -r * 0.1);
  g.quadraticCurveTo(r * 0.78, r * 0.5, r * 0.3, r * 0.52);
  g.lineTo(-r * 0.55, r * 0.52);
  g.quadraticCurveTo(-r * 0.78, r * 0.4, -r * 0.7, -r * 0.1);
  g.closePath();
  g.fill();
  g.strokeStyle = "#ffd24a";
  g.lineWidth = 3;
  g.stroke();
  // Fußstütze
  g.strokeStyle = "#cfc6d8";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(r * 0.45, r * 0.5);
  g.lineTo(r * 0.62, r * 0.86);
  g.lineTo(r * 0.95, r * 0.86);
  g.stroke();
  // Glanz
  g.fillStyle = "rgba(255,255,255,0.55)";
  g.fillRect(-r * 0.5, -r * 0.05, r * 0.9, 3);
  g.restore();
}

/** Trampolin (Feder) – federt beim Absprung sichtbar ein */
export function drawTrampoline(g: Ctx2D, A: PraterSkinAssets, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
  const w = e.w;
  const base = sy + e.h;
  const sprung = e.state === "sprung" ? Math.max(0, 1 - e.stateT / 0.35) : 0;
  const squash = sprung * Math.sin(e.stateT * 30) * 10 * sprung;
  const matY = sy + 10 + squash;
  // Hinweis-Pfeile (pulsierend)
  const pulse = k.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(v.time * 6 + e.id);
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = 0.35 + 0.35 * pulse;
  glowAt(g, A.glowCyan, sx + w / 2, matY - 6, w * 0.7, 26);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  g.strokeStyle = colorWithAlpha("#bff9ff", 0.5 + 0.4 * pulse);
  g.lineWidth = 3;
  g.lineCap = "round";
  for (let i = 0; i < 2; i += 1) {
    const yy = matY - 22 - i * 14 - pulse * 6;
    g.beginPath();
    g.moveTo(sx + w / 2 - 10, yy + 7);
    g.lineTo(sx + w / 2, yy);
    g.lineTo(sx + w / 2 + 10, yy + 7);
    g.stroke();
  }
  // Beine
  g.fillStyle = "#2a2440";
  g.fillRect(sx + 8, matY + 4, 5, base - matY - 4);
  g.fillRect(sx + w - 13, matY + 4, 5, base - matY - 4);
  g.fillRect(sx + w / 2 - 2, matY + 6, 4, base - matY - 6);
  // Rock (gestreift)
  const skirtH = Math.max(8, base - matY - 12);
  for (let i = 0; i < 8; i += 1) {
    g.fillStyle = i % 2 ? "#fff0f6" : "#ff4fa3";
    g.fillRect(sx + 4 + (i * (w - 8)) / 8, matY + 4, (w - 8) / 8 + 0.5, skirtH * 0.55);
  }
  // Rahmen + Matte
  g.fillStyle = "#1f6f8b";
  g.beginPath();
  g.ellipse(sx + w / 2, matY + 3, w / 2, 8, 0, 0, TAU);
  g.fill();
  g.fillStyle = "#28c6e0";
  g.beginPath();
  g.ellipse(sx + w / 2, matY + 1 + squash * 0.3, w / 2 - 6, 5 + Math.abs(squash) * 0.3, 0, 0, TAU);
  g.fill();
  g.strokeStyle = "#ffd24a";
  g.lineWidth = 2.5;
  g.beginPath();
  g.ellipse(sx + w / 2, matY + 3, w / 2, 8, 0, 0, TAU);
  g.stroke();
}

/** Riesenrad-Gondel als Plattform (Dach = Lauffläche), aufgehängt an zwei Stangen */
export function drawGondola(g: Ctx2D, A: PraterSkinAssets, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
  const w = e.w;
  const roofY = sy;
  // Aufhängung
  g.strokeStyle = "#3a2d4a";
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(sx + 12, roofY + 2);
  g.lineTo(sx + 12, -20);
  g.moveTo(sx + w - 12, roofY + 2);
  g.lineTo(sx + w - 12, -20);
  g.stroke();
  g.strokeStyle = "rgba(255,220,170,0.35)";
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(sx + 10.5, roofY);
  g.lineTo(sx + 10.5, -20);
  g.moveTo(sx + w - 13.5, roofY);
  g.lineTo(sx + w - 13.5, -20);
  g.stroke();
  // Kabine
  const bodyW = w - 16;
  const bodyH = 62;
  const bx = sx + 8;
  const by = roofY + 16;
  const body = g.createLinearGradient(0, by, 0, by + bodyH);
  body.addColorStop(0, "#d8303e");
  body.addColorStop(1, "#8e1426");
  g.fillStyle = body;
  g.beginPath();
  rr(g, bx, by, bodyW, bodyH, 8);
  g.fill();
  // Fenster
  const nWin = Math.max(2, Math.floor(bodyW / 44));
  const ww = (bodyW - 16) / nWin;
  for (let i = 0; i < nWin; i += 1) {
    const wx = bx + 8 + i * ww + 3;
    g.fillStyle = k.night > 0.3 ? "#ffd98a" : "#9fd6e8";
    g.beginPath();
    rr(g, wx, by + 10, ww - 6, 26, 4);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.fillRect(wx + 3, by + 12, 3, 20);
  }
  if (k.night > 0.3) {
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.45 * k.night;
    glowAt(g, A.glowGold, bx + bodyW / 2, by + 24, bodyW * 0.7, 40);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
  g.fillStyle = "#6f0f20";
  g.fillRect(bx, by + bodyH - 12, bodyW, 4);
  // Dach (Lauffläche) – gut lesbare Oberkante
  g.fillStyle = "#f4d58a";
  g.beginPath();
  rr(g, sx, roofY, w, 18, 7);
  g.fill();
  g.fillStyle = "#c98f2e";
  g.fillRect(sx + 4, roofY + 12, w - 8, 6);
  g.fillStyle = "#fff7da";
  g.fillRect(sx + 6, roofY + 2, w - 12, 3);
  // Lichterkante
  const n = Math.floor(w / 22);
  if (k.night > 0.15) {
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = Math.min(1, k.night * 1.2);
    for (let i = 0; i <= n; i += 1) glowAt(g, i % 2 ? A.glowGold : A.glowPink, sx + 6 + (i * (w - 12)) / n, roofY + 16, 8);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
}

/** Kanonenkugel / Konfettibombe (von rechts) inkl. Mündungsblitz am Bildrand */
export function drawCannonball(g: Ctx2D, A: PraterSkinAssets, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
  const r = e.w / 2;
  const cx = sx + r;
  const cy = sy + e.h / 2;
  // Mündungsblitz, solange die Kugel gerade ins Bild fliegt
  if (sx > 1150) {
    const u = Math.max(0, Math.min(1, (sx - 1150) / 260));
    const a = Math.sin(u * Math.PI);
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = a * (k.reduced ? 0.5 : 0.95);
    glowAt(g, A.glowGold, 1276, cy, 90, 70);
    glowAt(g, A.glowWhite, 1280, cy, 40);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
  // Rauch-/Konfettispur
  const trail = k.quality === 0 ? 2 : 5;
  for (let i = 1; i <= trail; i += 1) {
    const tx = cx + i * 20;
    const ty = cy + Math.sin(v.time * 20 + i) * 3;
    g.fillStyle = `rgba(230,220,240,${0.28 - i * 0.045})`;
    g.beginPath();
    g.arc(tx, ty, r * (0.55 + i * 0.12), 0, TAU);
    g.fill();
  }
  if (k.quality > 0) {
    const cols = ["#ff4fa3", "#ffd24a", "#5ef2ff", "#9dff6a"];
    for (let i = 0; i < 6; i += 1) {
      const t = (v.time * 3 + i * 0.37 + e.id * 0.1) % 1;
      g.fillStyle = cols[i % 4];
      g.fillRect(cx + 16 + t * 90, cy - 18 + ((i * 17) % 36) + t * 14, 5 * (1 - t) + 1, 3);
    }
  }
  // Gefahren-Aura
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = 0.55;
  glowAt(g, A.glowPink, cx, cy, r * 1.9);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  // Kugel
  const grd = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
  grd.addColorStop(0, "#8e7fa8");
  grd.addColorStop(0.5, "#3b2f52");
  grd.addColorStop(1, "#150e22");
  g.fillStyle = grd;
  g.beginPath();
  g.arc(cx, cy, r, 0, TAU);
  g.fill();
  g.strokeStyle = "#ff4fa3";
  g.lineWidth = 3;
  g.stroke();
  // Sterndekor (rotierend)
  g.save();
  g.translate(cx, cy);
  g.rotate(-v.time * 6);
  g.fillStyle = "#ffd24a";
  g.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const a = (i / 10) * TAU;
    const rad = i % 2 === 0 ? r * 0.55 : r * 0.24;
    if (i === 0) g.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
    else g.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  g.closePath();
  g.fill();
  g.restore();
  // Lunte mit Funken
  const fx = cx + r * 0.7;
  const fy = cy - r * 0.8;
  g.strokeStyle = "#caa46a";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(cx + r * 0.45, cy - r * 0.55);
  g.quadraticCurveTo(fx + 4, fy - 4, fx + 8, fy - 8);
  g.stroke();
  const fl = k.reduced ? 0.8 : 0.6 + 0.4 * Math.sin(v.time * 40 + e.id);
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = fl;
  glowAt(g, A.glowGold, fx + 8, fy - 8, 16);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  g.fillStyle = "rgba(255,255,255,0.5)";
  g.beginPath();
  g.ellipse(cx - r * 0.35, cy - r * 0.42, r * 0.22, r * 0.14, -0.6, 0, TAU);
  g.fill();
}

/** Geisterbahn-Geist */
export function drawGhost(g: Ctx2D, A: PraterSkinAssets, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
  const defeated = e.state === "defeated";
  const alpha = defeated ? Math.max(0, 1 - e.stateT * 2.2) : 1;
  if (alpha <= 0.01) return;
  const cx = sx + e.w / 2;
  const cy = sy + e.h / 2;
  const wob = k.reduced ? 0 : Math.sin(v.time * 4 + e.id) * 0.08;
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = (0.55 + 0.25 * k.night) * alpha;
  glowAt(g, A.softGhost, cx, cy + 6, e.w * 1.05, e.h * 0.95);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = alpha * 0.92;
  const props = A.props;
  const id = props?.has("ghost-float") ? "ghost-float" : "ghost";
  const drawn =
    !!props &&
    props.has(id) &&
    props.draw(g, id, cx, sy + e.h * 1.02, { h: e.h * 1.12, flipX: true, rotation: wob, ax: 0.5, ay: 0.98, t: v.time + e.id * 0.29 });
  if (!drawn) {
    // Prozeduraler Geist
    g.save();
    g.translate(cx, cy);
    g.rotate(wob);
    const w = e.w * 0.9;
    const h = e.h;
    g.fillStyle = "#f4fbff";
    g.beginPath();
    g.moveTo(-w / 2, 0);
    g.arc(0, -h * 0.12, w / 2, Math.PI, 0);
    g.lineTo(w / 2, h * 0.42);
    const waves = 4;
    for (let i = 0; i < waves; i += 1) {
      const x0 = w / 2 - (i * w) / waves;
      const x1 = w / 2 - ((i + 1) * w) / waves;
      g.quadraticCurveTo((x0 + x1) / 2, h * (0.52 + 0.08 * Math.sin(v.time * 6 + i)), x1, h * 0.42);
    }
    g.closePath();
    g.fill();
    g.strokeStyle = "#1b2a44";
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = "#1b2a44";
    g.beginPath();
    g.ellipse(-w * 0.2, -h * 0.14, 5, 8, 0, 0, TAU);
    g.ellipse(w * 0.12, -h * 0.14, 5, 8, 0, 0, TAU);
    g.fill();
    g.beginPath();
    g.ellipse(-w * 0.04, h * 0.06, 8, 6, 0, 0, TAU);
    g.fill();
    g.restore();
  }
  g.globalAlpha = 1;
}

/** Autoscooter mit Stromabnehmer-Funken */
export function drawScooter(g: Ctx2D, A: PraterSkinAssets, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
  const defeated = e.state === "defeated";
  const cx = sx + e.w / 2;
  const base = sy + e.h;
  g.save();
  if (defeated) {
    g.translate(cx, sy + e.h / 2);
    g.rotate(e.stateT * 7);
    g.translate(-cx, -(sy + e.h / 2));
  }
  // Stromabnehmer-Stange
  const poleX = sx + e.w * 0.72;
  g.strokeStyle = "#39314a";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(poleX, sy + 18);
  g.lineTo(poleX + 6, sy - 110);
  g.stroke();
  g.fillStyle = "#ff4fa3";
  g.beginPath();
  g.moveTo(poleX + 6, sy - 110);
  g.lineTo(poleX + 24, sy - 104);
  g.lineTo(poleX + 6, sy - 98);
  g.fill();
  if (!defeated) {
    const sp = k.reduced ? 0.6 : 0.4 + 0.6 * Math.abs(Math.sin(v.time * 23 + e.id));
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = sp;
    glowAt(g, A.glowCyan, poleX + 6, sy - 112, 18);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
  const props = A.props;
  const drawn = !!props && props.has("autoscooter") && props.draw(g, "autoscooter", cx, base + 2, { h: e.h * 1.18, flipX: true, ax: 0.5, ay: 0.98 });
  if (!drawn) {
    // Prozeduraler Autoscooter
    g.fillStyle = "#23263a";
    g.beginPath();
    rr(g, sx + 4, base - 22, e.w - 8, 20, 10);
    g.fill();
    const body = g.createLinearGradient(0, sy + 10, 0, base - 10);
    body.addColorStop(0, "#ff5fa8");
    body.addColorStop(1, "#b3124f");
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(sx + 6, base - 18);
    g.quadraticCurveTo(sx + 2, sy + 26, sx + e.w * 0.3, sy + 22);
    g.lineTo(sx + e.w - 10, sy + 16);
    g.quadraticCurveTo(sx + e.w, sy + 30, sx + e.w - 6, base - 18);
    g.closePath();
    g.fill();
    g.fillStyle = "#1b1b2a";
    g.fillRect(sx + e.w * 0.45, sy + 6, e.w * 0.36, 18);
    g.fillStyle = "#ffd24a";
    g.fillRect(sx + 10, sy + 36, e.w - 20, 5);
  }
  // Scheinwerfer (Gefahr lesbar)
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = 0.5 + 0.4 * k.night;
  glowAt(g, A.glowGold, sx + 8, base - 26, 22, 14);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  g.restore();
}

/** Zuckerwatte-Kiste (zerbrechlich) */
/** Süßigkeiten-Kiste aus dem Prop; sehr hohe Hitboxen (Kistenturm) werden aus mehreren überlappenden Kisten gestapelt */
function candyCrateSprite(g: Ctx2D, A: PraterSkinAssets, e: Ent, sx: number, sy: number): boolean {
  const id = OBSTACLE_PROPS.candy;
  const asp = A.bank.aspect(id);
  if (asp === null) return false;
  const rmax = FIT.candy[1];
  const r = e.h / (e.w * asp);
  if (r <= rmax) return blockSprite(g, A, id, e, sx, sy, FIT.candy);
  // Turm: obere Kisten überdecken die Füllung der unteren
  const ov = 0.62;
  const n = Math.max(2, Math.round(1 + (r - 1) / ov));
  const each = e.h / (1 + ov * (n - 1));
  const f = fitBox(asp, e.w, each, 0.8, 1.25);
  const b = A.bank.get(id, quant(f.w), quant(f.h));
  if (!b) return false;
  const cx = sx + e.w / 2;
  const foot = sy + e.h + 2;
  for (let i = 0; i < n; i += 1) blit(g, A, b, cx + (i % 2 ? -1 : 1) * e.w * 0.03, foot - i * each * ov);
  return true;
}

export function drawCandyCrate(g: Ctx2D, A: PraterSkinAssets, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
  const w = e.w;
  if (!candyCrateSprite(g, A, e, sx, sy)) drawCandyCrateFallback(g, A, e, sx, sy);
  // Zerbrechlich-Hinweis: Glitzern
  const tw = k.reduced ? 0.6 : 0.5 + 0.5 * Math.sin(v.time * 5 + e.id);
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = 0.35 + 0.4 * tw;
  glowAt(g, A.glowWhite, sx + w * 0.78, sy + 8, 12);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
}

function drawCandyCrateFallback(g: Ctx2D, A: PraterSkinAssets, e: Ent, sx: number, sy: number): void {
  const w = e.w;
  const h = e.h;
  const boxH = Math.max(30, h * 0.68);
  const by = sy + h - boxH;
  // Zuckerwatte oben (über den Kistenrand quellend)
  const puffH = h - boxH + 20;
  g.drawImage(A.candy, 10, 26, 78, 50, sx - 4, sy - 2, w + 8, puffH + 6);
  // Kiste
  g.fillStyle = "#f4d0a4";
  g.fillRect(sx, by, w, boxH);
  for (let i = 0; i < 5; i += 1) {
    g.fillStyle = i % 2 ? "#ff7fbf" : "#fff4f8";
    g.fillRect(sx + (i * w) / 5, by + 6, w / 5 + 0.5, boxH - 12);
  }
  g.strokeStyle = "#8a4b2a";
  g.lineWidth = 3;
  g.strokeRect(sx + 1.5, by + 1.5, w - 3, boxH - 3);
  g.fillStyle = "#8a4b2a";
  g.fillRect(sx, by + 4, w, 3);
  g.fillRect(sx, by + boxH - 7, w, 3);
  // Herz-Plakette
  g.fillStyle = "#d9483b";
  heartPath(g, sx + w / 2, by + boxH / 2, Math.min(12, boxH * 0.22));
  g.fill();
  g.strokeStyle = "#fff2e0";
  g.lineWidth = 1.5;
  heartPath(g, sx + w / 2, by + boxH / 2, Math.min(9, boxH * 0.16));
  g.stroke();
}

/** Schießbuden-Theke mit Dosenpyramide */
export function drawBooth(g: Ctx2D, A: PraterSkinAssets, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
  const w = e.w;
  const h = e.h;
  if (blockSprite(g, A, OBSTACLE_PROPS.booth, e, sx, sy, FIT.booth)) {
    // Lichterketten der Bude glimmen nachts
    if (k.night > 0.2) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.32 * k.night;
      glowAt(g, A.glowGold, sx + w / 2, sy + h * 0.4, w * 0.62, h * 0.55);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    return;
  }
  const counterY = sy + h * 0.42;
  // Theke
  const grd = g.createLinearGradient(0, counterY, 0, sy + h);
  grd.addColorStop(0, "#2bb3a8");
  grd.addColorStop(1, "#16655f");
  g.fillStyle = grd;
  g.fillRect(sx, counterY, w, sy + h - counterY);
  for (let i = 0; i < w; i += 20) {
    g.fillStyle = "rgba(255,255,255,0.22)";
    g.fillRect(sx + i, counterY + 8, 10, sy + h - counterY - 8);
  }
  g.fillStyle = "#e9d2b4";
  g.fillRect(sx - 4, counterY - 6, w + 8, 9);
  g.fillStyle = "#8a6a4a";
  g.fillRect(sx - 4, counterY + 2, w + 8, 3);
  // Dosenpyramiden
  const cols = ["#d9483b", "#f2b233", "#6b5bff", "#e8e8f0"];
  const can = Math.min(14, (counterY - sy - 4) / 3);
  const groups = Math.max(1, Math.floor(w / 56));
  for (let gi = 0; gi < groups; gi += 1) {
    const gx = sx + (gi + 0.5) * (w / groups);
    for (let row = 0; row < 3; row += 1) {
      const n = 3 - row;
      for (let i = 0; i < n; i += 1) {
        const x = gx - (n * can) / 2 + i * can;
        const y = counterY - 6 - (row + 1) * can;
        g.fillStyle = cols[(gi + row + i) % cols.length];
        g.fillRect(x + 1, y + 1, can - 2, can - 1);
        g.fillStyle = "rgba(255,255,255,0.45)";
        g.fillRect(x + 2, y + 2, 2, can - 3);
        g.fillStyle = "rgba(0,0,0,0.3)";
        g.fillRect(x + 1, y + 1, can - 2, 2);
      }
    }
  }
  // Randlicht
  if (k.night > 0.2) {
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.5 * k.night;
    glowAt(g, A.glowCyan, sx + w / 2, counterY, w * 0.7, 18);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
}

/** Reifenstapel (Autodrom-Bande): gestapelte Reifen, weiß-rot bemalt */
export function drawTires(g: Ctx2D, A: PraterSkinAssets, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
  const w = e.w;
  const h = e.h;
  const rows = Math.max(2, Math.round(h / 26));
  const rh = h / rows;
  // Rimlight hinter dem Stapel (lesbar vor dunklen Buden)
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = 0.35 + 0.3 * k.night;
  glowAt(g, A.glowPink, sx + w / 2, sy + h * 0.55, w * 0.85, h * 0.75);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  if (blockSprite(g, A, OBSTACLE_PROPS.tires, e, sx, sy, FIT.tires)) return;
  for (let r = 0; r < rows; r += 1) {
    const y = sy + h - (r + 1) * rh;
    const inset = (r % 2) * 3;
    // Reifen-Körper
    const grd = g.createLinearGradient(0, y, 0, y + rh);
    grd.addColorStop(0, "#4a4658");
    grd.addColorStop(0.45, "#26232f");
    grd.addColorStop(1, "#121019");
    g.fillStyle = grd;
    g.beginPath();
    rr(g, sx + inset, y + 1, w - inset * 2, rh - 1, rh * 0.45);
    g.fill();
    // Farbband (Bemalung)
    g.fillStyle = r % 2 ? "#f4f0f6" : "#e2366f";
    g.fillRect(sx + inset + 6, y + rh * 0.42, w - inset * 2 - 12, rh * 0.22);
    // Profilrillen
    g.fillStyle = "rgba(0,0,0,0.35)";
    for (let x = sx + inset + 10; x < sx + w - inset - 8; x += 9) g.fillRect(x, y + 3, 2, rh * 0.3);
    // Glanz
    g.fillStyle = "rgba(255,255,255,0.22)";
    g.fillRect(sx + inset + 8, y + 2, w - inset * 2 - 16, 2);
  }
  void v;
}

/** Stoffbahn-Textur (2 Streifen breit, mit Faltenschattierung) für den Budenvorhang */
export function valanceTexture(): HTMLCanvasElement {
  return paint(48, 256, (g) => {
    for (let i = 0; i < 2; i += 1) {
      g.fillStyle = i === 0 ? "#b8233f" : "#f1e2d2";
      g.fillRect(i * 24, 0, 24, 256);
      const grd = g.createLinearGradient(i * 24, 0, i * 24 + 24, 0);
      grd.addColorStop(0, "rgba(40,0,20,0.28)");
      grd.addColorStop(0.35, "rgba(255,255,255,0.10)");
      grd.addColorStop(0.7, "rgba(0,0,0,0)");
      grd.addColorStop(1, "rgba(40,0,20,0.32)");
      g.fillStyle = grd;
      g.fillRect(i * 24, 0, 24, 256);
    }
  });
}

/** Hängender Budenvorhang mit Entenparade (overhead → rutschen) */
export function drawValance(g: Ctx2D, A: PraterSkinAssets, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
  const w = e.w;
  const bottom = sy + e.h;
  const b = overheadSprite(A, OBSTACLE_PROPS.valance, e);
  if (b) {
    // Bild bündig auf der Hitbox-Unterkante; die Seile laufen vom Bildrand zum Sprite (Neigung wie im Bild)
    const x = A.bank.snap(sx + (w - b.w) / 2);
    const y = A.bank.snap(bottom - 3 - b.h);
    const kx = b.w / 630;
    for (const [u, dir] of [
      [0.148, 1],
      [0.848, -1],
    ] as const) {
      hanger(g, x + u * b.w, y + 2, 0.27 * dir, Math.max(2.6, 14 * kx), "rope");
    }
    g.drawImage(b.c, x, y, b.w, b.h);
    // Schein unter dem Saum → Rutschen-Höhe klar erkennbar
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.28 + 0.3 * k.night;
    glowAt(g, A.glowGold, sx + w / 2, bottom - 4, w * 0.55, 13);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    return;
  }
  const top = Math.max(-4, sy);
  const clothBottom = bottom - 30;
  // Stoff (gekachelte Textur)
  g.save();
  g.beginPath();
  g.rect(sx, top, w, clothBottom - top);
  g.clip();
  for (let x = sx; x < sx + w; x += 48) {
    for (let y = clothBottom - 256; y > top - 256; y -= 256) g.drawImage(A.valance, Math.round(x), Math.round(y));
  }
  // Tiefenverlauf + Nacht
  const shade = g.createLinearGradient(0, top, 0, clothBottom);
  shade.addColorStop(0, `rgba(20,8,30,${(0.45 + 0.25 * k.night).toFixed(3)})`);
  shade.addColorStop(1, `rgba(20,8,30,${(0.12 + 0.3 * k.night).toFixed(3)})`);
  g.fillStyle = shade;
  g.fillRect(sx, top, w, clothBottom - top);
  g.restore();
  // Seitenkanten
  g.fillStyle = "#5a1428";
  g.fillRect(sx - 3, top, 4, clothBottom - top);
  g.fillRect(sx + w - 1, top, 4, clothBottom - top);
  // Volant
  const vy = bottom - 34;
  g.fillStyle = "#e0a93a";
  g.fillRect(sx - 4, vy - 4, w + 8, 8);
  for (let i = 0; i < w; i += 20) {
    g.fillStyle = (i / 20) % 2 < 1 ? "#c42c5a" : "#e0a93a";
    g.beginPath();
    g.arc(sx + i + 10, vy + 4, 10, 0, Math.PI);
    g.fill();
  }
  // Schiene mit Blechenten
  g.fillStyle = "#3a2d4a";
  g.fillRect(sx - 6, bottom - 12, w + 12, 6);
  const speed = k.reduced ? 20 : 60;
  const spacing = 48;
  const off = (v.time * speed) % spacing;
  for (let x = -spacing + off; x < w; x += spacing) {
    const dx = sx + x + 10;
    if (dx < sx - 4 || dx > sx + w - 20) continue;
    g.fillStyle = "#f2b233";
    g.beginPath();
    g.ellipse(dx + 10, bottom - 18, 11, 6, 0, 0, TAU);
    g.fill();
    g.beginPath();
    g.arc(dx + 2, bottom - 26, 5, 0, TAU);
    g.fill();
    g.fillStyle = "#d9483b";
    g.beginPath();
    g.moveTo(dx - 3, bottom - 27);
    g.lineTo(dx - 9, bottom - 25);
    g.lineTo(dx - 3, bottom - 23);
    g.fill();
    g.fillStyle = "#1b1b2a";
    g.fillRect(dx, bottom - 28, 2, 2);
  }
  // Gefahrenkante unten (hell, klar lesbar)
  g.fillStyle = "#fff4c2";
  g.fillRect(sx - 6, bottom - 4, w + 12, 4);
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = 0.35 + 0.3 * k.night;
  glowAt(g, A.glowGold, sx + w / 2, bottom - 2, w * 0.6, 14);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
}

/** Geisterbahn-Portal (overhead): düstere Fassade mit glühenden Augen */
export function drawGhostGate(g: Ctx2D, A: PraterSkinAssets, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
  const w = e.w;
  const bottom = sy + e.h;
  const b = overheadSprite(A, OBSTACLE_PROPS.gate, e);
  if (b) {
    // Tor hängt an zwei Ketten von oben; der Bogen unten deckt die Hitbox
    const x = A.bank.snap(sx + (w - b.w) / 2);
    const y = A.bank.snap(bottom - 3 - b.h);
    const kx = b.w / 622;
    for (const [u, dir] of [
      [0.231, 1],
      [0.766, -1],
    ] as const) {
      hanger(g, x + u * b.w, y + 2, 0.15 * dir, Math.max(3, 18 * kx), "chain");
    }
    g.drawImage(b.c, x, y, b.w, b.h);
    // Totenkopf-Augen glimmen (nachts stärker), Schein unter dem Bogen
    g.globalCompositeOperation = "lighter";
    const pulse = k.reduced ? 0.7 : 0.6 + 0.4 * Math.sin(v.time * 3.2 + e.id * 1.7);
    g.globalAlpha = (0.3 + 0.4 * k.night) * pulse;
    glowAt(g, A.glowPink, x + b.w * 0.5, y + b.h * 0.27, b.w * 0.16, b.w * 0.1);
    g.globalAlpha = 0.28 + 0.3 * k.night;
    glowAt(g, A.glowPink, sx + w / 2, bottom - 4, w * 0.55, 13);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    return;
  }
  const top = Math.max(-10, sy);
  const grd = g.createLinearGradient(0, top, 0, bottom);
  grd.addColorStop(0, "#1d1430");
  grd.addColorStop(1, "#3a2458");
  g.fillStyle = grd;
  g.fillRect(sx, top, w, bottom - top);
  // Holzbretter
  g.strokeStyle = "rgba(0,0,0,0.35)";
  g.lineWidth = 2;
  g.beginPath();
  for (let x = sx + 22; x < sx + w; x += 22) {
    g.moveTo(x, top);
    g.lineTo(x, bottom - 20);
  }
  g.stroke();
  // Spinnennetz-Ecken
  g.strokeStyle = "rgba(220,220,255,0.35)";
  g.lineWidth = 1;
  for (const [cx, dir] of [
    [sx, 1],
    [sx + w, -1],
  ] as const) {
    for (let i = 1; i <= 3; i += 1) {
      g.beginPath();
      g.arc(cx, bottom - 20, i * 12, dir > 0 ? -Math.PI / 2 : Math.PI, dir > 0 ? 0 : -Math.PI / 2);
      g.stroke();
    }
  }
  // Augenpaare
  const n = Math.max(1, Math.floor(w / 90));
  for (let i = 0; i < n; i += 1) {
    const ex = sx + (i + 0.5) * (w / n);
    const ey = bottom - 60 - (i % 2) * 30;
    const blink = !k.reduced && Math.sin(v.time * 1.7 + i * 2.3 + e.id) > 0.93 ? 0.15 : 1;
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.8;
    glowAt(g, A.glowCyan, ex - 9, ey, 12, 12 * blink);
    glowAt(g, A.glowCyan, ex + 9, ey, 12, 12 * blink);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
  // Zackenkante (Zähne) als Unterkante
  g.fillStyle = "#e8e3f5";
  for (let x = sx; x < sx + w; x += 16) {
    g.beginPath();
    g.moveTo(x, bottom - 16);
    g.lineTo(x + 8, bottom);
    g.lineTo(x + 16, bottom - 16);
    g.fill();
  }
  g.fillStyle = "#5c3d86";
  g.fillRect(sx - 4, bottom - 20, w + 8, 6);
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = 0.5;
  glowAt(g, A.glowPink, sx + w / 2, bottom - 4, w * 0.6, 14);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
}
