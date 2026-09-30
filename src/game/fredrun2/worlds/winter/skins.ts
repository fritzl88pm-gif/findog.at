/**
 * Christkindlmarkt – Entitäts-Skins. Die fertigen Props (Einzelbilder) werden prozedural belebt: Wippen, Squash & Stretch,
 * Lichterfunkeln, Dampf, Funken, Wurf-Animation des Elfen, Eiszapfen-Einschlag, Feuerkorb-Flammen …
 * Jeder Skin hat eine prozedurale Rückfallvariante (ohne Props sieht die Welt trotzdem gut aus).
 * Alle Gefahren bekommen über `SpriteCache` einen Lichtsaum (Halo), damit sie sich in jeder Stimmungsstufe klar abheben.
 */
import { roundRect } from "../../draw-utils";
import type { Ent, PropLibrary, ViewState } from "../../types";
import type { Ctx2D } from "../shared-b/canvas";
import { h1 } from "../shared-b/color";
import { DIM } from "./dims";
import { blitSpr, easeIn, easeOut, fract, glowAt, groundShadow, sat, smooth01, SpriteCache, sprPoint, TAU, type GlowSet, type Spr } from "./gfx";
import { PROP_LIGHTS } from "./lights";

export const HALO_WARM = "rgba(255,236,196,0.95)";
export const HALO_RED = "rgba(255,196,112,0.95)";
export const HALO_ICE = "rgba(150,232,255,0.95)";

export interface SkinEnv {
  props: PropLibrary | null;
  spr: SpriteCache;
  glows: GlowSet;
  /** Stimmungsstufe als Fließkommazahl (stage + blend) */
  s: number;
  /** 0..1 Dunkelheit (Leuchten stärker) */
  night: number;
}

// --- Bausteine ----------------------------------------------------------------------------------------

const LIGHT_COLORS: Array<keyof GlowSet> = ["warm", "red", "gold", "green", "cyan", "white"];

/** Lichter im Prop funkeln lassen (Positionen aus der Bildanalyse) */
function twinkle(g: Ctx2D, env: SkinEnv, spr: Spr, cx: number, foot: number, key: string, flip: boolean, e: Ent, t: number, v: ViewState, size: number, multi: boolean, strength = 1): void {
  const L = PROP_LIGHTS[key];
  if (!L || v.quality === 0) return;
  g.globalCompositeOperation = "lighter";
  const n = Math.floor(L.length / 3);
  for (let i = 0; i < n; i += 1) {
    const p = sprPoint(spr, cx, foot, L[i * 3], L[i * 3 + 1], flip);
    const tw = v.reducedMotion ? 0.7 : 0.45 + 0.55 * Math.max(0, Math.sin(t * (2.2 + (i % 3) * 0.9) + i * 1.9 + e.id * 0.7));
    g.globalAlpha = tw * (0.5 + 0.5 * env.night) * strength;
    glowAt(g, env.glows[multi ? LIGHT_COLORS[i % LIGHT_COLORS.length] : "warm"], p.x, p.y, size + (L[i * 3 + 2] / 1000) * 90);
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
}

/** Fallback: abgerundeter, umrandeter Kasten */
function fallbackBox(g: Ctx2D, sx: number, sy: number, w: number, h: number, fill: string, label = ""): void {
  g.save();
  g.fillStyle = fill;
  g.strokeStyle = "#1a1020";
  g.lineWidth = 4;
  roundRect(g, sx + 2, sy + 2, w - 4, h - 4, 10);
  g.fill();
  g.stroke();
  if (label) {
    g.fillStyle = "rgba(255,255,255,0.85)";
    g.font = "700 14px system-ui, sans-serif";
    g.textAlign = "center";
    g.fillText(label, sx + w / 2, sy + h / 2 + 5);
  }
  g.restore();
}

function starPath(g: Ctx2D, cx: number, cy: number, r: number, inner = 0.45, rot = -Math.PI / 2): void {
  g.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const a = rot + (i * Math.PI) / 5;
    const rr = i % 2 ? r * inner : r;
    if (i === 0) g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    else g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.closePath();
}

/** Warn-Zeichen „!“ über einem Gegner */
function warnBubble(g: Ctx2D, cx: number, y: number, u: number, t: number): void {
  const a = sat(u * 3) * (0.75 + 0.25 * Math.sin(t * 16));
  if (a <= 0.02) return;
  g.save();
  g.globalAlpha = a;
  g.translate(cx, y - Math.sin(t * 9) * 2);
  g.fillStyle = "#ffcc33";
  g.strokeStyle = "#4a2a00";
  g.lineWidth = 3.5;
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(0, -17);
  g.lineTo(16, 12);
  g.lineTo(-16, 12);
  g.closePath();
  g.stroke();
  g.fill();
  g.fillStyle = "#3b2600";
  g.fillRect(-2, -6, 4, 11);
  g.fillRect(-2, 7, 4, 3.4);
  g.restore();
}

/** Besiegte Läufer: wirbelnd davon, ausblendend */
function defeatedFx(e: Ent): { rot: number; alpha: number; squash: number } {
  const u = e.stateT;
  return { rot: (e.vx >= 0 ? 1 : -1) * u * 9, alpha: 1 - smooth01((u - 0.45) / 0.45), squash: 1 };
}

// --- Blöcke -------------------------------------------------------------------------------------------

function drawSwayProp(g: Ctx2D, env: SkinEnv, e: Ent, sx: number, sy: number, v: ViewState, id: string, k: number, halo: string, amp = 0.018): { spr: Spr | null; cx: number; foot: number } {
  const cx = sx + e.w / 2;
  const foot = sy + e.h + 2;
  groundShadow(g, env.glows, cx, sy + e.h, e.w * 0.62, 0.9);
  const spr = env.spr.get(id, e.h * k, halo);
  if (!spr) return { spr: null, cx, foot };
  const t = v.time;
  const ph = e.id * 1.37;
  blitSpr(g, spr, cx, foot, { rot: v.reducedMotion ? 0 : Math.sin(t * 1.7 + ph) * amp, sy: v.reducedMotion ? 1 : 1 + 0.012 * Math.sin(t * 3.1 + ph) });
  return { spr, cx, foot };
}

function drawSnowman(g: Ctx2D, env: SkinEnv, e: Ent, sx: number, sy: number, v: ViewState): void {
  const r = drawSwayProp(g, env, e, sx, sy, v, "winter-snowman", 1.06, HALO_WARM, 0.024);
  if (!r.spr) {
    g.fillStyle = "#f4f8ff";
    g.strokeStyle = "#1a2444";
    g.lineWidth = 4;
    for (const [dy, rad] of [
      [0.72, 0.36],
      [0.38, 0.28],
      [0.1, 0.2],
    ]) {
      g.beginPath();
      g.arc(sx + e.w / 2, sy + e.h * dy + e.h * 0.1, e.h * rad * 0.62, 0, TAU);
      g.fill();
      g.stroke();
    }
  }
}

function drawPresents(g: Ctx2D, env: SkinEnv, e: Ent, sx: number, sy: number, v: ViewState): void {
  const r = drawSwayProp(g, env, e, sx, sy, v, "winter-presents", 1.05, HALO_WARM, 0.012);
  if (r.spr) twinkle(g, env, r.spr, r.cx, r.foot, "winter-presents", false, e, v.time, v, 9, true, 0.9);
  else fallbackBox(g, sx, sy, e.w, e.h, "#c9303d", "🎁");
}

function drawTree(g: Ctx2D, env: SkinEnv, e: Ent, sx: number, sy: number, v: ViewState): void {
  const r = drawSwayProp(g, env, e, sx, sy, v, "winter-tree", 1.05, HALO_WARM, 0.014);
  if (r.spr) twinkle(g, env, r.spr, r.cx, r.foot, "winter-tree", false, e, v.time, v, 6, true, 1);
  else fallbackBox(g, sx, sy, e.w, e.h, "#1f7a3a");
}

function drawCane(g: Ctx2D, env: SkinEnv, e: Ent, sx: number, sy: number, v: ViewState): void {
  const r = drawSwayProp(g, env, e, sx, sy, v, "winter-candycane", 1.05, HALO_WARM, 0);
  if (r.spr && v.quality > 0) {
    // Glanz wandert über die Zuckerstangen
    const u = fract(v.time * 0.45 + e.id * 0.3);
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.85 * Math.sin(u * Math.PI);
    glowAt(g, env.glows.cross, sx + 8 + u * (e.w - 16), sy + e.h * 0.28, 14);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  } else if (!r.spr) fallbackBox(g, sx, sy, e.w, e.h, "#e23a48");
}

function drawIceblock(g: Ctx2D, env: SkinEnv, e: Ent, sx: number, sy: number, v: ViewState): void {
  const cx = sx + e.w / 2;
  if (v.quality > 0) {
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.28 + 0.08 * Math.sin(v.time * 2 + e.id);
    glowAt(g, env.glows.softCyan, cx, sy + e.h * 0.55, e.w * 0.95, e.h * 0.85);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
  const r = drawSwayProp(g, env, e, sx, sy, v, "winter-iceblock", 1.05, HALO_ICE, 0);
  if (r.spr) {
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < 3; i += 1) {
      const tw = v.reducedMotion ? 0.6 : Math.max(0, Math.sin(v.time * (2.4 + i * 0.7) + i * 2.1 + e.id));
      g.globalAlpha = tw;
      glowAt(g, env.glows.cross, sx + e.w * (0.22 + 0.28 * i), sy + e.h * (0.28 + 0.18 * ((i + 1) % 3)), 11 + 4 * i);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  } else fallbackBox(g, sx, sy, e.w, e.h, "#8fe0ff");
}

function drawStall(g: Ctx2D, env: SkinEnv, e: Ent, sx: number, sy: number, v: ViewState): void {
  const cx = sx + e.w / 2;
  if (v.quality > 0 && env.night > 0.2) {
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.22 * env.night;
    glowAt(g, env.glows.softWarm, cx, sy + e.h * 0.55, e.w * 0.95, e.h * 0.75);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
  const r = drawSwayProp(g, env, e, sx, sy, v, "winter-stall", 1.03, HALO_WARM, 0);
  if (r.spr) twinkle(g, env, r.spr, r.cx, r.foot, "winter-stall", false, e, v.time, v, 6, false, 1);
  else fallbackBox(g, sx, sy, e.w, e.h, "#8a5a2a");
}

/** Deko-Marktstand im Hintergrund (Elfen-Dach): dunkler und ohne Lichtsaum – wirkt wie Teil der Kulisse, nicht wie ein Hindernis */
function drawStallBg(g: Ctx2D, env: SkinEnv, e: Ent, sx: number, sy: number, v: ViewState): void {
  const cx = sx + e.w / 2;
  const foot = sy + e.h + 2;
  const spr = env.spr.get("winter-stall", e.h * 1.04, null, "foot", "bg", (c, s) => {
    c.globalCompositeOperation = "source-atop";
    c.fillStyle = "rgba(10,16,44,0.34)";
    c.fillRect(0, 0, s.c.width, s.c.height);
  });
  if (spr) {
    blitSpr(g, spr, cx, foot);
    twinkle(g, env, spr, cx, foot, "winter-stall", false, e, v.time, v, 5, false, 0.7);
  } else fallbackBox(g, sx, sy, e.w, e.h, "#5a3a20");
}

function drawKessel(g: Ctx2D, env: SkinEnv, e: Ent, sx: number, sy: number, v: ViewState): void {
  const cx = sx + e.w / 2;
  const t = v.time;
  // Feuerschein unter dem Kessel
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = (0.32 + 0.12 * Math.sin(t * 11 + e.id)) * (0.6 + 0.4 * env.night);
  glowAt(g, env.glows.orange, cx, sy + e.h * 0.86, e.w * 0.9, e.h * 0.5);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  const r = drawSwayProp(g, env, e, sx, sy, v, "winter-kessel", 1.05, HALO_WARM, 0);
  if (!r.spr) fallbackBox(g, sx, sy, e.w, e.h, "#b8632a");
  if (v.quality > 0) {
    // Dampfwölkchen aus dem Kessel
    for (let i = 0; i < 4; i += 1) {
      const u = fract(t * 0.5 + i * 0.25 + e.id * 0.13);
      g.globalAlpha = 0.55 * Math.sin(u * Math.PI);
      const rr = 7 + u * 13;
      g.drawImage(env.glows.puffPink, cx - 14 + Math.sin(u * 5 + i) * 14 - rr, sy + 8 - u * 46 - rr, rr * 2, rr * 2);
    }
    g.globalAlpha = 1;
    // Blubbern
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < 3; i += 1) {
      const u = fract(t * 1.6 + i * 0.37);
      g.globalAlpha = 0.6 * (1 - u);
      glowAt(g, env.glows.softWhite, cx - 24 + i * 22 + Math.sin(t * 3 + i) * 3, sy + 22 - u * 6, 4);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
}

/** Feuerkorb mit lebendigen Flammen (rein prozedural) */
function drawBasket(g: Ctx2D, env: SkinEnv, e: Ent, sx: number, sy: number, v: ViewState): void {
  const cx = sx + e.w / 2;
  const gy = sy + e.h;
  const t = v.time;
  const ph = e.id * 2.1;
  groundShadow(g, env.glows, cx, gy, e.w * 0.6, 0.9);
  // Schein
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = 0.5 + 0.14 * Math.sin(t * 13 + ph);
  glowAt(g, env.glows.orange, cx, sy + e.h * 0.4, e.w * 1.5, e.h * 0.95);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  // Beine + Stiel
  g.strokeStyle = "#18101a";
  g.lineWidth = 5;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(cx - 20, gy);
  g.lineTo(cx - 10, gy - 34);
  g.moveTo(cx + 20, gy);
  g.lineTo(cx + 10, gy - 34);
  g.moveTo(cx, gy);
  g.lineTo(cx, gy - 34);
  g.stroke();
  // Korb (Eisenstäbe, glühende Kohlen)
  const top = sy + e.h * 0.5;
  const bw = e.w * 0.86;
  g.fillStyle = "#3a1206";
  g.beginPath();
  g.moveTo(cx - bw / 2, top);
  g.lineTo(cx + bw / 2, top);
  g.lineTo(cx + bw * 0.32, gy - 30);
  g.lineTo(cx - bw * 0.32, gy - 30);
  g.closePath();
  g.fill();
  const coal = g.createLinearGradient(0, top, 0, gy - 30);
  coal.addColorStop(0, "#ffcf5a");
  coal.addColorStop(0.5, "#ff6a1a");
  coal.addColorStop(1, "#7a1a08");
  g.fillStyle = coal;
  g.globalAlpha = 0.85;
  g.beginPath();
  g.moveTo(cx - bw / 2 + 5, top + 3);
  g.lineTo(cx + bw / 2 - 5, top + 3);
  g.lineTo(cx + bw * 0.28, gy - 34);
  g.lineTo(cx - bw * 0.28, gy - 34);
  g.closePath();
  g.fill();
  g.globalAlpha = 1;
  g.strokeStyle = "#140a12";
  g.lineWidth = 3.4;
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(cx - bw / 2, top);
  g.lineTo(cx + bw / 2, top);
  g.lineTo(cx + bw * 0.32, gy - 30);
  g.lineTo(cx - bw * 0.32, gy - 30);
  g.closePath();
  for (let i = 1; i < 5; i += 1) {
    const u = i / 5;
    g.moveTo(cx - bw / 2 + bw * u, top);
    g.lineTo(cx - bw * 0.32 + bw * 0.64 * u, gy - 30);
  }
  g.stroke();
  g.strokeStyle = "#ffb04a";
  g.lineWidth = 2.4;
  g.beginPath();
  g.moveTo(cx - bw / 2 - 1, top);
  g.lineTo(cx + bw / 2 + 1, top);
  g.stroke();
  // Flammen: drei Zungen + Kern
  for (let i = 0; i < 3; i += 1) {
    const k = [-0.3, 0.05, 0.32][i];
    const hgt = (40 + 12 * Math.sin(t * 9 + ph + i * 2.2) + (i === 1 ? 12 : 0)) * (v.reducedMotion ? 0.9 : 1);
    const sway = (v.reducedMotion ? 0 : Math.sin(t * 6.5 + ph + i * 1.7)) * 5;
    const bx = cx + k * bw;
    const wdt = 15 + (i === 1 ? 5 : 0);
    for (let layer = 0; layer < 3; layer += 1) {
      const sc = 1 - layer * 0.28;
      g.fillStyle = layer === 0 ? "#ff5a14" : layer === 1 ? "#ffab2e" : "#fff2a8";
      g.beginPath();
      g.moveTo(bx - wdt * sc, top + 2);
      g.quadraticCurveTo(bx - wdt * sc * 1.05, top - hgt * 0.5 * sc, bx + sway * sc, top - hgt * sc);
      g.quadraticCurveTo(bx + wdt * sc * 1.05, top - hgt * 0.5 * sc, bx + wdt * sc, top + 2);
      g.closePath();
      g.fill();
    }
  }
  // Funken
  if (v.quality > 0) {
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < 5; i += 1) {
      const u = fract(t * (0.8 + (i % 3) * 0.25) + i * 0.21 + ph);
      g.globalAlpha = (1 - u) * 0.9;
      glowAt(g, env.glows.gold, cx + Math.sin(u * 6 + i * 2) * 16 + (i - 2) * 6, top - 20 - u * 70, 3.2);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
}

// --- Hängende Hindernisse ---------------------------------------------------------------------------

function ropesUp(g: Ctx2D, x0: number, x1: number, yTop: number, sway: number): void {
  g.strokeStyle = "rgba(24,20,30,0.85)";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(x0 + 8, yTop);
  g.lineTo(x0 + 8 + sway, -10);
  g.moveTo(x1 - 8, yTop);
  g.lineTo(x1 - 8 + sway, -10);
  g.stroke();
}

function drawIcicles(g: Ctx2D, env: SkinEnv, e: Ent, sx: number, sy: number, v: ViewState): void {
  const t = v.time;
  ropesUp(g, sx, sx + e.w, sy + 6, v.reducedMotion ? 0 : Math.sin(t * 1.3 + e.id) * 2);
  const spr = env.spr.get("winter-icicles", e.h * 1.02, HALO_ICE, "top");
  if (spr) {
    // Durchgehender Balken: linke Kappe + rechte Kappe + wiederholte Mittelstücke des Props
    const k = spr.k;
    const cw = spr.c.width;
    const ch = spr.c.height;
    const cW = spr.w * k;
    const x0 = (cw - cW) / 2;
    const capSrc = cW * 0.3;
    const capDst = capSrc / k;
    const top = sy - 2 - spr.ay / k;
    const hDst = ch / k;
    if (e.w < capDst * 2 + 20) {
      g.drawImage(spr.c, x0, 0, cW, ch, sx, top, e.w, hDst);
    } else {
      g.drawImage(spr.c, x0, 0, capSrc, ch, sx, top, capDst, hDst);
      g.drawImage(spr.c, x0 + cW - capSrc, 0, capSrc, ch, sx + e.w - capDst, top, capDst, hDst);
      const midSrc = cW * 0.28;
      const midDst = midSrc / k;
      const from = sx + capDst;
      const to = sx + e.w - capDst;
      let i = 0;
      for (let x = from; x < to - 0.5; x += midDst, i += 1) {
        const wDst = Math.min(midDst, to - x);
        const srcX = x0 + cW * (i % 2 === 0 ? 0.36 : 0.46);
        g.drawImage(spr.c, srcX, 0, (wDst / midDst) * midSrc, ch, x, top, wDst + 0.6, hDst);
      }
    }
  } else {
    g.fillStyle = "#bfeaff";
    g.strokeStyle = "#1c3a5a";
    g.lineWidth = 3;
    const n = Math.max(2, Math.floor(e.w / 34));
    for (let k = 0; k < n; k += 1) {
      const x = sx + ((k + 0.5) * e.w) / n;
      g.beginPath();
      g.moveTo(x - 9, sy + 12);
      g.lineTo(x + 9, sy + 12);
      g.lineTo(x, sy + e.h * (0.6 + 0.35 * h1(k * 7 + e.id)));
      g.closePath();
      g.fill();
      g.stroke();
    }
  }
  if (v.quality > 0) {
    // Tropfen + Glitzern an den Spitzen
    const n = Math.max(1, Math.round(e.w / 130));
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < n; i += 1) {
      const cx = sx + ((i + 0.5) * e.w) / n;
      const tw = e.w / n;
      for (let k = 0; k < 3; k += 1) {
        const u = fract(t * 0.65 + i * 0.29 + k * 0.34 + e.id * 0.11);
        const x = cx - tw / 2 + tw * (0.2 + 0.3 * k + 0.05 * Math.sin(i + k));
        g.globalAlpha = 0.9 * (1 - u);
        glowAt(g, env.glows.cyan, x, sy + e.h * 0.78 + u * 40, 3.4);
      }
      const gl = v.reducedMotion ? 0.6 : Math.max(0, Math.sin(t * 2.6 + i * 1.9 + e.id));
      g.globalAlpha = gl;
      glowAt(g, env.glows.cross, cx + Math.sin(i * 3.1) * tw * 0.25, sy + e.h * 0.7, 13);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
}

function drawChains(g: Ctx2D, env: SkinEnv, e: Ent, sx: number, sy: number, v: ViewState): void {
  const t = v.time;
  ropesUp(g, sx, sx + e.w, sy + 4, v.reducedMotion ? 0 : Math.sin(t * 1.1 + e.id) * 3);
  // Balken: dunkles Holz, roter Stoffstreifen, Schnee
  g.fillStyle = "#3a2216";
  g.strokeStyle = "#0f0a0c";
  g.lineWidth = 3;
  roundRect(g, sx, sy, e.w, 26, 6);
  g.fill();
  g.stroke();
  g.fillStyle = "#b31626";
  g.fillRect(sx + 6, sy + 14, e.w - 12, 7);
  g.fillStyle = "#f4f8ff";
  g.beginPath();
  g.moveTo(sx - 2, sy + 2);
  for (let x = 0; x <= e.w + 2; x += 18) g.quadraticCurveTo(sx + x + 4, sy - 9, sx + x + 9, sy + 1);
  g.lineTo(sx + e.w + 2, sy + 4);
  g.lineTo(sx - 2, sy + 4);
  g.closePath();
  g.fill();
  // Ketten mit Glocken
  const n = Math.max(3, Math.floor(e.w / 46));
  g.lineCap = "round";
  for (let i = 0; i < n; i += 1) {
    const x = sx + 24 + (i * (e.w - 48)) / (n - 1);
    const len = 52 + 58 * h1(i * 5.3 + e.id);
    const ang = v.reducedMotion ? 0 : Math.sin(t * 2.2 + i * 1.4 + e.id) * 0.09;
    const ex = x + Math.sin(ang) * len;
    const ey = sy + 24 + Math.cos(ang) * len;
    g.strokeStyle = "#0f0a0c";
    g.lineWidth = 6.5;
    g.setLineDash([]);
    g.beginPath();
    g.moveTo(x, sy + 24);
    g.lineTo(ex, ey - 8);
    g.stroke();
    g.strokeStyle = "#b8bfc8";
    g.lineWidth = 3.4;
    g.setLineDash([6, 5]);
    g.beginPath();
    g.moveTo(x, sy + 24);
    g.lineTo(ex, ey - 8);
    g.stroke();
    g.setLineDash([]);
    // Glocke
    g.fillStyle = "#e9b53a";
    g.strokeStyle = "#4a3208";
    g.lineWidth = 2.6;
    g.beginPath();
    g.moveTo(ex - 10, ey + 6);
    g.quadraticCurveTo(ex - 10, ey - 12, ex, ey - 12);
    g.quadraticCurveTo(ex + 10, ey - 12, ex + 10, ey + 6);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = "#4a3208";
    g.beginPath();
    g.arc(ex, ey + 6, 2.6, 0, TAU);
    g.fill();
    if (v.quality > 0) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.55 + 0.35 * Math.sin(t * 5 + i);
      glowAt(g, env.glows.gold, ex - 3, ey - 5, 9);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
  }
}

// --- Plattformen ---------------------------------------------------------------------------------------

function drawSledRide(g: Ctx2D, env: SkinEnv, e: Ent, sx: number, sy: number, v: ViewState): void {
  const t = v.time;
  const cx = sx + e.w / 2;
  const elev = v.groundY - sy;
  // Schatten am Boden (je höher, desto schwächer und größer); Zauberglühen darunter, wenn er schwebt
  groundShadow(g, env.glows, cx, v.groundY, e.w * 0.55 + elev * 0.1, sat(0.9 - elev / 300));
  const rideH = DIM.sledRide.h;
  const foot = sy - 0.135 * rideH + rideH;
  if (elev > 100 && v.quality > 0) {
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.4 + 0.1 * Math.sin(t * 4 + e.id);
    glowAt(g, env.glows.softCyan, cx, foot + 6, e.w * 0.62, 20);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
  const spr = env.spr.get("winter-sled", rideH, HALO_WARM);
  if (spr) {
    blitSpr(g, spr, cx, foot, { flip: true, rot: v.reducedMotion ? 0 : Math.sin(t * 2.6 + e.id) * 0.012 });
  } else {
    fallbackBox(g, sx, sy - 10, e.w, 30, "#b3282f");
  }
  // Schneefahne hinter dem Schlitten
  if (v.quality > 0) {
    for (let i = 0; i < 7; i += 1) {
      const u = fract(t * 1.4 + i * 0.143 + e.id * 0.17);
      g.globalAlpha = 0.6 * (1 - u);
      const r = 4 + u * 9;
      g.drawImage(env.glows.flake, sx + 6 - u * 60 - r, sy + 74 - u * 8 - r + Math.sin(i * 2.7) * 4, r * 2, r * 2);
    }
    g.globalAlpha = 1;
  }
}

// --- Gegner --------------------------------------------------------------------------------------------

function drawGingerbread(g: Ctx2D, env: SkinEnv, e: Ent, sx: number, sy: number, v: ViewState): void {
  const cx = sx + e.w / 2;
  const foot = sy + e.h + 2;
  const t = v.time;
  if (e.state === "defeated") {
    const f = defeatedFx(e);
    const spr = env.spr.get("winter-gingerbread", e.h * 1.06, HALO_WARM);
    g.save();
    g.globalAlpha = f.alpha;
    if (spr) blitSpr(g, spr, cx, sy + e.h * 0.55, { rot: f.rot, flip: true, sy: Math.max(0.35, 1 - e.stateT * 2.6), sx: 1 + Math.min(0.5, e.stateT * 1.2) });
    // Krümel
    for (let i = 0; i < 9; i += 1) {
      const a = (i / 9) * TAU + e.id;
      const r = 24 + 120 * easeOut(e.stateT / 0.6);
      g.fillStyle = i % 2 ? "#b4692a" : "#e7a35a";
      g.fillRect(cx + Math.cos(a) * r - 3, sy + e.h * 0.5 + Math.sin(a) * r * 0.8 + 260 * e.stateT * e.stateT - 3, 6, 6);
    }
    g.restore();
    return;
  }
  groundShadow(g, env.glows, cx, sy + e.h, e.w * 0.62, 0.9);
  const ph = e.age * 11 + e.id;
  const bob = v.reducedMotion ? 0 : -Math.abs(Math.sin(ph)) * 6;
  const spr = env.spr.get("winter-gingerbread", e.h * 1.06, HALO_WARM);
  if (spr) blitSpr(g, spr, cx, foot + bob, { flip: e.vx <= 0, rot: v.reducedMotion ? 0 : Math.sin(ph) * 0.09, sx: 1 + 0.05 * Math.sin(ph * 2), sy: 1 - 0.04 * Math.sin(ph * 2) });
  else fallbackBox(g, sx, sy, e.w, e.h, "#c9803a");
  void t;
}

function drawKrampus(g: Ctx2D, env: SkinEnv, e: Ent, sx: number, sy: number, v: ViewState): void {
  const cx = sx + e.w / 2;
  const foot = sy + e.h + 2;
  const t = v.time;
  const flip = e.vx <= 0;
  if (e.state === "defeated") {
    const f = defeatedFx(e);
    const spr = env.spr.get("winter-krampus", e.h * 1.07, HALO_RED);
    g.save();
    g.globalAlpha = f.alpha;
    if (spr) blitSpr(g, spr, cx, sy + e.h * 0.6, { rot: f.rot, flip });
    g.restore();
    return;
  }
  groundShadow(g, env.glows, cx, sy + e.h, e.w * 0.7, 1);
  const ph = e.age * 9 + e.id;
  const air = e.y + e.h < v.groundY - 6;
  const bob = v.reducedMotion || air ? 0 : -Math.abs(Math.sin(ph)) * 8;
  // Warnglut hinter dem Krampus
  if (v.quality > 0) {
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.3 + 0.1 * Math.sin(t * 8 + e.id);
    glowAt(g, env.glows.red, cx, sy + e.h * 0.5, e.w * 1.15, e.h * 0.85);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
  const spr = env.spr.get("winter-krampus", e.h * 1.07, HALO_RED);
  if (!spr) {
    fallbackBox(g, sx, sy, e.w, e.h, "#5a2a18");
    return;
  }
  blitSpr(g, spr, cx, foot + bob, { flip, rot: v.reducedMotion ? 0 : Math.sin(ph) * 0.06 * (flip ? -1 : 1), sx: 1 + 0.03 * Math.sin(ph * 2), sy: 1 - 0.03 * Math.sin(ph * 2) });
  if (v.quality > 0) {
    // Glühende Augen, Atem, Glöckchen
    const eye = sprPoint(spr, cx, foot + bob, 850, 335, flip);
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.85 + 0.15 * Math.sin(t * 12);
    glowAt(g, env.glows.red, eye.x, eye.y, 13);
    glowAt(g, env.glows.gold, eye.x, eye.y, 6);
    const bell = sprPoint(spr, cx, foot + bob, 560, 530, flip);
    g.globalAlpha = 0.5 + 0.5 * Math.max(0, Math.sin(ph * 2));
    glowAt(g, env.glows.gold, bell.x, bell.y, 8);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    const mouth = sprPoint(spr, cx, foot + bob, 880, 430, flip);
    for (let i = 0; i < 3; i += 1) {
      const u = fract(t * 1.4 + i * 0.33 + e.id * 0.2);
      g.globalAlpha = 0.5 * (1 - u);
      const r = 5 + u * 14;
      g.drawImage(env.glows.puff, mouth.x + (flip ? -1 : 1) * u * 42 - r, mouth.y - u * 22 - r, r * 2, r * 2);
    }
    g.globalAlpha = 1;
  }
}

function drawSledHazard(g: Ctx2D, env: SkinEnv, e: Ent, sx: number, sy: number, v: ViewState): void {
  const cx = sx + e.w / 2;
  const t = v.time;
  groundShadow(g, env.glows, cx, sy + e.h, e.w * 0.6, 0.9);
  const spr = env.spr.get("winter-sled", e.h * 1.0, HALO_WARM);
  if (e.state === "defeated") {
    const f = defeatedFx(e);
    g.save();
    g.globalAlpha = f.alpha;
    if (spr) blitSpr(g, spr, cx, sy + e.h * 0.6, { rot: f.rot });
    g.restore();
    return;
  }
  const pitch = v.reducedMotion ? 0 : Math.sin(e.age * 9 + e.id) * 0.035;
  if (spr) blitSpr(g, spr, cx, sy + e.h + 2, { rot: pitch, flip: e.vx > 0 });
  else fallbackBox(g, sx, sy, e.w, e.h, "#b3282f");
  if (v.quality > 0) {
    // Schneefontäne hinten
    const dir = e.vx <= 0 ? 1 : -1;
    for (let i = 0; i < 6; i += 1) {
      const u = fract(t * 2.2 + i * 0.167 + e.id * 0.3);
      g.globalAlpha = 0.65 * (1 - u);
      const r = 4 + u * 9;
      g.drawImage(env.glows.flake, cx + dir * (e.w * 0.5 + u * 46) - r, sy + e.h - 8 - u * 26 - r, r * 2, r * 2);
    }
    g.globalAlpha = 1;
  }
}

/** Elf: Wurf-Animation (Ausholen → Wurf → Rückschwung); mit Ball in der Hand vor dem Wurf */
function drawElf(g: Ctx2D, env: SkinEnv, e: Ent, sx: number, sy: number, v: ViewState): void {
  const cx = sx + e.w / 2;
  const foot = sy + e.h + 2;
  const t = v.time;
  const rel = e.p.tRel ?? 0;
  const dt = e.age - rel;
  const cocked = env.spr.get("winter-elf", e.h * 1.06, HALO_WARM, "foot", "cocked");
  const thrown = env.spr.get("winter-elf", e.h * 1.06, HALO_WARM, "foot", "thrown", (c, s) => {
    // Schneeball aus der Hand entfernen (Position aus der Bildanalyse: x 0.128, y 0.252, r 0.07)
    const bx = s.ax - (s.w * s.k) / 2 + 0.128 * s.w * s.k;
    const by = s.ay - s.h * s.k + 0.252 * s.h * s.k;
    c.save();
    c.globalCompositeOperation = "destination-out";
    const r = 0.078 * s.h * s.k;
    const grd = c.createRadialGradient(bx, by, r * 0.6, bx, by, r);
    grd.addColorStop(0, "rgba(0,0,0,1)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = grd;
    c.fillRect(bx - r, by - r, r * 2, r * 2);
    c.restore();
  });
  if (e.state === "defeated") {
    const f = defeatedFx(e);
    g.save();
    g.globalAlpha = f.alpha;
    const s = thrown ?? cocked;
    if (s) blitSpr(g, s, cx, sy + e.h * 0.6, { rot: f.rot, flip: true });
    g.restore();
    return;
  }
  const ground = e.kind === "walker";
  if (ground) groundShadow(g, env.glows, cx, sy + e.h, e.w * 0.6, 0.9);
  let rot = 0;
  let squash = 1;
  let hand = false;
  if (rel > 0) {
    if (dt < -0.55) {
      rot = 0;
    } else if (dt < 0) {
      const u = (dt + 0.55) / 0.55;
      rot = 0.17 * easeIn(u);
      squash = 1 - 0.05 * easeIn(u);
    } else if (dt < 0.6) {
      const u = dt / 0.14;
      rot = dt < 0.14 ? 0.17 + (-0.24 - 0.17) * easeOut(u) : -0.24 * (1 - smooth01((dt - 0.14) / 0.46));
      squash = 1 + 0.06 * Math.sin(smooth01(dt / 0.2) * Math.PI);
      hand = dt < 0.32;
    }
  }
  const useThrown = rel > 0 && dt >= 0.02;
  const s = useThrown ? thrown : cocked;
  const walkBob = ground && e.vx !== 0 && !v.reducedMotion ? -Math.abs(Math.sin(e.age * 8 + e.id)) * 3 : 0;
  const idle = v.reducedMotion ? 0 : Math.sin(t * 3 + e.id) * 0.012;
  if (s) blitSpr(g, s, cx, foot + walkBob, { flip: true, rot: rot + idle, sy: squash });
  else fallbackBox(g, sx, sy, e.w, e.h, "#2f9a44");
  // Warnzeichen während des Ausholens
  if (rel > 0 && dt > -0.9 && dt < 0.15) warnBubble(g, cx + 6, sy - 14, sat((dt + 0.9) / 0.35) * (1 - sat((dt - 0.05) / 0.1)), t);
  // Wurf: Schneepuff an der Hand
  if (hand && v.quality > 0) {
    const u = dt / 0.32;
    g.globalAlpha = 0.85 * (1 - u);
    const r = 9 + u * 18;
    g.drawImage(env.glows.puff, cx - e.w * 0.18 - u * 26 - r, sy + e.h * 0.2 - u * 6 - r, r * 2, r * 2);
    g.globalAlpha = 1;
  }
}

// --- Geschoss / Zonen ----------------------------------------------------------------------------------

function drawSnowball(g: Ctx2D, env: SkinEnv, e: Ent, sx: number, sy: number, v: ViewState): void {
  const rel = e.p.tRel ?? 0;
  if (e.age < rel) return;
  const cx = sx + e.w / 2;
  const cy = sy + e.h / 2;
  const t = v.time;
  const dir = e.vx < 0 ? 1 : -1;
  // Flugspur
  if (v.quality > 0) {
    const age = e.age - rel;
    for (let i = 0; i < 6; i += 1) {
      const u = i / 6;
      g.globalAlpha = 0.5 * (1 - u) * sat(age * 6);
      const r = 8 - u * 4;
      g.drawImage(env.glows.flake, cx + dir * (14 + i * 11) - r, cy + i * 1.6 + Math.sin(t * 20 + i) * 1.2 - r, r * 2, r * 2);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.4;
    glowAt(g, env.glows.softCyan, cx, cy, 34, 24);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
  const spr = env.spr.get("winter-snowball", e.h * 1.15, HALO_ICE, "center");
  if (spr) blitSpr(g, spr, cx, cy, { flip: e.vx < 0 });
  else {
    g.fillStyle = "#f4f8ff";
    g.strokeStyle = "#1a2444";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy, e.h * 0.55, 0, TAU);
    g.fill();
    g.stroke();
  }
}

/** Fallender Eiszapfen: hängt am Vordach, zittert/tropft (warn), fällt, Eis-Eruption am Boden (active), zerfällt. */
function drawIcicleZone(g: Ctx2D, env: SkinEnv, e: Ent, sx: number, sy: number, v: ViewState): void {
  const gy = v.groundY;
  const cx = sx + e.w / 2;
  const t = v.time;
  const eaveY = gy - 330;
  const restTip = gy - 206;
  const ph = e.fx.phaseT ?? 0;
  const st = e.state;
  const wob = v.reducedMotion ? 0 : 1;
  const lead = e.cycle?.phases[0]?.name === "idle" ? e.cycle.phases[0].dur : 0;
  const beforeWarn = st === "idle" && e.age <= lead + 0.001;
  // Vordach-Balken mit Seilen (bleibt stehen)
  ropesUp(g, cx - 66, cx + 66, eaveY, wob * Math.sin(t * 1.2 + e.id) * 2);
  g.fillStyle = "#3a2216";
  g.strokeStyle = "#0f0a0c";
  g.lineWidth = 3;
  roundRect(g, cx - 70, eaveY, 140, 20, 6);
  g.fill();
  g.stroke();
  g.fillStyle = "#f4f8ff";
  g.beginPath();
  g.moveTo(cx - 74, eaveY + 3);
  for (let x = -74; x < 72; x += 16) g.quadraticCurveTo(cx + x + 4, eaveY - 9, cx + x + 8, eaveY + 1);
  g.lineTo(cx + 72, eaveY + 4);
  g.closePath();
  g.fill();

  const hanging = beforeWarn || st === "warn";
  if (hanging) {
    let dy = 0;
    let shake = 0;
    if (st === "warn") {
      shake = wob * Math.sin(ph * 60) * (0.8 + ph * 2.4);
      dy = easeIn(sat((ph - 0.68) / 0.32)) * (gy - restTip);
      // Bodenwarnung: wachsender Ring
      g.globalAlpha = 0.3 + 0.45 * ph;
      g.fillStyle = "rgba(120,220,255,0.35)";
      g.beginPath();
      g.ellipse(cx, gy + 5, 16 + 30 * ph, 4 + 6 * ph, 0, 0, TAU);
      g.fill();
      g.strokeStyle = `rgba(190,245,255,${0.45 + 0.4 * Math.sin(ph * 28) * wob})`;
      g.lineWidth = 2;
      g.stroke();
      g.globalAlpha = 1;
    }
    const base = eaveY + 16 + dy;
    for (const [dxk, len, bw] of [
      [0, 108, 15],
      [-22, 68, 10],
      [22, 54, 9],
    ] as const) {
      const bx = cx + shake + dxk;
      const grd = g.createLinearGradient(bx - bw, 0, bx + bw, 0);
      grd.addColorStop(0, "#9fe4ff");
      grd.addColorStop(0.45, "#f2fcff");
      grd.addColorStop(1, "#69b8ea");
      g.fillStyle = grd;
      g.strokeStyle = "#173a5c";
      g.lineWidth = 3;
      g.lineJoin = "round";
      g.beginPath();
      g.moveTo(bx - bw, base);
      g.lineTo(bx + bw, base);
      g.lineTo(bx + 1, base + len);
      g.closePath();
      g.fill();
      g.stroke();
      g.strokeStyle = "rgba(255,255,255,0.9)";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(bx - bw * 0.35, base + 4);
      g.lineTo(bx - 1, base + len - 10);
      g.stroke();
    }
    if (v.quality > 0) {
      const tip = base + 108;
      g.globalCompositeOperation = "lighter";
      const gl = st === "warn" ? 0.5 + 0.5 * Math.sin(ph * 42) : Math.max(0, Math.sin(t * 2.4 + e.id * 1.3));
      g.globalAlpha = gl * (v.reducedMotion ? 0.5 : 1);
      glowAt(g, env.glows.cross, cx + shake, tip - 26, 20);
      for (let i = 0; i < 3; i += 1) {
        const u = fract(t * (st === "warn" ? 2.4 : 0.7) + i * 0.33 + e.id * 0.3);
        g.globalAlpha = 0.9 * (1 - u);
        glowAt(g, env.glows.cyan, cx + shake + (i - 1) * 9, tip + 2 + u * 52, 3.2);
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
  }
  // Einschlag: Eis-Eruption (Stacheln wachsen und zerfallen), Splitter
  if (st === "active") {
    const u = ph;
    const grow = easeOut(u / 0.28);
    const fade = 1 - smooth01((u - 0.62) / 0.38);
    g.save();
    g.globalAlpha = fade;
    const spikes = [
      [-24, 0.55, 12],
      [-9, 1.0, 15],
      [9, 0.86, 14],
      [25, 0.5, 11],
    ] as const;
    for (const [dx, hk, bw] of spikes) {
      const h = e.h * hk * grow;
      const grd = g.createLinearGradient(cx + dx - bw, 0, cx + dx + bw, 0);
      grd.addColorStop(0, "#8fdcff");
      grd.addColorStop(0.5, "#f4fdff");
      grd.addColorStop(1, "#5aaee6");
      g.fillStyle = grd;
      g.strokeStyle = "#173a5c";
      g.lineWidth = 3;
      g.lineJoin = "round";
      g.beginPath();
      g.moveTo(cx + dx - bw, gy);
      g.lineTo(cx + dx + bw, gy);
      g.lineTo(cx + dx + 1, gy - h);
      g.closePath();
      g.fill();
      g.stroke();
    }
    g.fillStyle = "#e8fbff";
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI + Math.PI;
      const r = 20 + 110 * easeOut(u * 1.3);
      g.fillRect(cx + Math.cos(a) * r * (0.6 + 0.4 * h1(i + e.id)) - 2.5, gy - 8 + Math.sin(a) * r * 0.9 + 160 * u * u - 2.5, 5, 5);
    }
    g.restore();
    if (v.quality > 0) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.6 * (1 - u);
      glowAt(g, env.glows.cyan, cx, gy - 40, 70, 60);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
  }
  void sy;
}

/** Dampfsäule des Glühwein-Kessels (Aufwind): weiche Schwaden steigen auf, Chevrons zeigen die Steigrichtung */
function drawSteam(g: Ctx2D, env: SkinEnv, e: Ent, sx: number, sy: number, v: ViewState): void {
  const t = v.time;
  const cx = sx + e.w / 2;
  const bottom = sy + e.h;
  const n = v.quality === 0 ? 9 : 20;
  const rise = e.h;
  for (let i = 0; i < n; i += 1) {
    const u = fract(t * 0.42 + i / n + e.id * 0.07);
    const wob = Math.sin(u * 7 + i * 1.9 + t * 0.9) * (14 + u * 26);
    const half = e.w * 0.5;
    const x = cx + wob * (half / 100) * 1.6 + (h1(i * 3.3 + e.id) - 0.5) * half * 0.5;
    const y = bottom - u * rise;
    const r = 22 + u * 44;
    g.globalAlpha = Math.sin(Math.min(1, u * 1.1) * Math.PI) * 0.9;
    g.drawImage(env.glows.puffPink, x - r, y - r, r * 2, r * 2);
  }
  g.globalAlpha = 1;
  // Chevrons: „hier geht es hinauf“
  const ck = v.quality === 0 ? 2 : 3;
  g.lineJoin = "round";
  g.lineCap = "round";
  for (let i = 0; i < ck; i += 1) {
    const u = fract(t * 0.55 + i / ck + e.id * 0.11);
    const y = bottom - 20 - u * (rise - 40);
    const a = Math.sin(u * Math.PI) * 0.75;
    if (a < 0.03) continue;
    const w = Math.min(46, e.w * 0.22);
    g.globalAlpha = a;
    g.strokeStyle = "rgba(90,20,30,0.85)";
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(cx - w, y + 12);
    g.lineTo(cx, y - 8);
    g.lineTo(cx + w, y + 12);
    g.stroke();
    g.strokeStyle = "#fff4e6";
    g.lineWidth = 4.5;
    g.stroke();
  }
  g.globalAlpha = 1;
  // warmer Schein am Fuß der Säule + leuchtende Mitte (Hitzeflimmern)
  if (v.quality > 0) {
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.2;
    glowAt(g, env.glows.softWarm, cx, bottom - 20, e.w * 0.55, 70);
    g.globalAlpha = 0.09 + 0.03 * Math.sin(t * 2.2 + e.id);
    glowAt(g, env.glows.softWhite, cx, bottom - rise * 0.5, e.w * 0.36, rise * 0.55);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
}

/** Schnee-Explosion (kurzlebige Deko) */
function drawSnowBurst(g: Ctx2D, env: SkinEnv, e: Ent, sx: number, sy: number, v: ViewState): void {
  const u = sat(e.age / 0.5);
  const cx = sx + e.w / 2;
  const cy = sy + e.h / 2;
  g.save();
  g.globalAlpha = 1 - u * u;
  const n = v.quality === 0 ? 8 : 14;
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * TAU + e.id;
    const r = 8 + 78 * easeOut(u) * (0.55 + 0.45 * h1(i + e.id));
    const s = (7 - 4 * u) * (0.7 + 0.5 * h1(i * 3 + 1));
    g.fillStyle = i % 3 === 0 ? "#bfeaff" : "#ffffff";
    g.beginPath();
    g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8 + 70 * u * u, s, 0, TAU);
    g.fill();
  }
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = 0.6 * (1 - u);
  glowAt(g, env.glows.cross, cx, cy, 28 + 30 * u);
  g.restore();
}

// --- Sammelobjekte -------------------------------------------------------------------------------------

function drawStarCoin(g: Ctx2D, env: SkinEnv, e: Ent, sx: number, sy: number, v: ViewState): void {
  const cx = sx + e.w / 2;
  const cy = sy + e.h / 2 + (v.reducedMotion ? 0 : Math.sin(v.time * 3 + e.id) * 2.5);
  const size = e.w * 1.5;
  const t = v.time;
  if (v.quality > 0) {
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.45 + 0.1 * Math.sin(t * 4 + e.id);
    glowAt(g, env.glows.gold, cx, cy, size * 0.85);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
  const spr = env.spr.get("winter-star", size, null, "center");
  if (spr) {
    const spin = v.reducedMotion ? 1 : 0.38 + 0.62 * Math.abs(Math.cos(t * 2.6 + e.id * 1.7));
    blitSpr(g, spr, cx, cy, { sx: spin, rot: v.reducedMotion ? 0 : Math.sin(t * 2 + e.id) * 0.1 });
  } else {
    g.fillStyle = "#ffd23f";
    g.strokeStyle = "#a86a00";
    g.lineWidth = 2.5;
    starPath(g, cx, cy, e.w * 0.68, 0.5, t * 0.8);
    g.fill();
    g.stroke();
  }
  if (v.quality > 0 && !v.reducedMotion) {
    const gl = Math.max(0, Math.sin(t * 3.4 + e.id * 2.3));
    if (gl > 0.05) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = gl;
      glowAt(g, env.glows.cross, cx + 7, cy - 8, 10);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
  }
}

function drawGingerHeart(g: Ctx2D, env: SkinEnv, e: Ent, sx: number, sy: number, v: ViewState): void {
  const cx = sx + e.w / 2;
  const t = v.time;
  const cy = sy + e.h / 2 + (v.reducedMotion ? 0 : Math.sin(t * 2.6 + e.id) * 3);
  const size = e.w * 1.6;
  if (v.quality > 0) {
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.5 + 0.15 * Math.sin(t * 5 + e.id);
    glowAt(g, env.glows.warm, cx, cy, size * 0.95);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
  const spr = env.spr.get("lebkuchenherz", size, null, "center");
  const pulse = v.reducedMotion ? 1 : 1 + 0.06 * Math.sin(t * 5 + e.id);
  if (spr) blitSpr(g, spr, cx, cy, { sx: pulse, sy: pulse, rot: v.reducedMotion ? 0 : Math.sin(t * 1.9 + e.id) * 0.1 });
  else {
    g.fillStyle = "#b8692d";
    g.strokeStyle = "#4a2408";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx, cy + size * 0.36);
    g.bezierCurveTo(cx - size * 0.7, cy - size * 0.05, cx - size * 0.35, cy - size * 0.5, cx, cy - size * 0.18);
    g.bezierCurveTo(cx + size * 0.35, cy - size * 0.5, cx + size * 0.7, cy - size * 0.05, cx, cy + size * 0.36);
    g.fill();
    g.stroke();
  }
  if (v.quality > 0 && !v.reducedMotion) {
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = Math.max(0, Math.sin(t * 3 + e.id * 1.3));
    glowAt(g, env.glows.cross, cx - 10, cy - 12, 12);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
}

// --- Tor (Tour) ---------------------------------------------------------------------------------------

/** Eingang zum Christkindlmarkt: Zuckerstangen-Pfosten, Lichterbogen, Stern, glitzerndes Portal */
function drawGateway(g: Ctx2D, env: SkinEnv, e: Ent, sx: number, sy: number, v: ViewState): void {
  const t = v.time;
  const cx = sx + e.w / 2;
  const gy = v.groundY;
  const top = sy + 24;
  const hw = 150;
  // Portal-Glühen (Sog in den Markt)
  const rx = hw - 20;
  const ry = (gy - top) * 0.5;
  const cy = (gy + top) / 2;
  if (v.quality > 0) {
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.55;
    glowAt(g, env.glows.softWarm, cx, cy, rx * 1.35, ry * 1.15);
    g.globalAlpha = 0.35;
    glowAt(g, env.glows.softCyan, cx, cy, rx * 1.1, ry * 0.95);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
  g.save();
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  g.clip();
  g.globalCompositeOperation = "lighter";
  const bg = g.createRadialGradient(cx, cy, 10, cx, cy, ry);
  bg.addColorStop(0, "rgba(255,236,190,0.55)");
  bg.addColorStop(0.55, "rgba(255,190,110,0.28)");
  bg.addColorStop(1, "rgba(120,180,255,0.18)");
  g.fillStyle = bg;
  g.fillRect(cx - rx, top, rx * 2, gy - top);
  for (let i = 0; i < 26; i += 1) {
    const a = t * (0.7 + h1(i) * 0.6) + i * 2.399;
    const rr = (0.15 + 0.85 * h1(i * 7.1)) * rx;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a * 0.9) * ry * (0.2 + 0.8 * h1(i * 3.3));
    g.globalAlpha = 0.5 + 0.4 * Math.sin(t * 3 + i);
    glowAt(g, env.glows.white, x, y, 4 + 3 * h1(i));
  }
  g.restore();
  // Pfosten: rot-weiße Zuckerstangen
  for (const side of [-1, 1]) {
    const px = cx + side * hw;
    g.save();
    g.beginPath();
    roundRect(g, px - 13, top - 8, 26, gy - top + 8, 12);
    g.clip();
    g.fillStyle = "#fbf6f0";
    g.fillRect(px - 14, top - 10, 28, gy - top + 12);
    g.fillStyle = "#d8283a";
    for (let y = top - 40; y < gy + 20; y += 34) {
      g.beginPath();
      g.moveTo(px - 14, y);
      g.lineTo(px + 14, y + 20);
      g.lineTo(px + 14, y + 36);
      g.lineTo(px - 14, y + 16);
      g.closePath();
      g.fill();
    }
    g.restore();
    g.strokeStyle = "#1a1020";
    g.lineWidth = 4;
    roundRect(g, px - 13, top - 8, 26, gy - top + 8, 12);
    g.stroke();
    // Schneehaube + Laterne
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.ellipse(px, top - 8, 20, 9, 0, 0, TAU);
    g.fill();
    g.strokeStyle = "#1a1020";
    g.lineWidth = 3;
    g.stroke();
    const lan = env.spr.get("winter-lantern", 92, HALO_WARM, "foot");
    if (lan) blitSpr(g, lan, px + side * -24, top + 96, { sx: 0.9 });
    if (v.quality > 0) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.7 + 0.15 * Math.sin(t * 6 + side);
      glowAt(g, env.glows.warm, px - side * 24, top + 40, 40);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
  }
  // Girlande (Kettenlinie) mit Lichtern
  g.strokeStyle = "#1f6b34";
  g.lineWidth = 12;
  g.lineCap = "round";
  g.beginPath();
  for (let i = 0; i <= 20; i += 1) {
    const u = i / 20;
    const x = cx - hw + u * hw * 2;
    const y = top - 8 + Math.sin(u * Math.PI) * 30;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  g.strokeStyle = "#2f9a4a";
  g.lineWidth = 6;
  g.stroke();
  const cols = ["#ffd23f", "#ff5a5a", "#7dff9a", "#8fd3ff"];
  for (let i = 0; i <= 12; i += 1) {
    const u = i / 12;
    const x = cx - hw + u * hw * 2;
    const y = top - 8 + Math.sin(u * Math.PI) * 30 + 8;
    const on = v.reducedMotion ? 1 : 0.55 + 0.45 * Math.sin(t * 4 + i * 1.7);
    g.fillStyle = cols[i % 4];
    g.globalAlpha = 0.6 + 0.4 * on;
    g.beginPath();
    g.arc(x, y, 4.2, 0, TAU);
    g.fill();
    g.globalAlpha = 1;
    if (v.quality > 0) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.5 * on;
      glowAt(g, [env.glows.gold, env.glows.red, env.glows.green, env.glows.cyan][i % 4], x, y, 11);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
  }
  // Stern über dem Bogen
  const sy2 = top - 46;
  const spin = 0.9 + 0.1 * Math.sin(t * 2);
  const star = env.spr.get("winter-star", 88, null, "center");
  if (v.quality > 0) {
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.6;
    glowAt(g, env.glows.gold, cx, sy2, 74);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
  if (star) blitSpr(g, star, cx, sy2, { sx: spin, sy: spin, rot: Math.sin(t) * 0.06 });
  else {
    g.fillStyle = "#ffd23f";
    g.strokeStyle = "#a86a00";
    g.lineWidth = 3;
    starPath(g, cx, sy2, 34, 0.5);
    g.fill();
    g.stroke();
  }
}

// --- Verteiler -------------------------------------------------------------------------------------------

/** Zeichnet den Skin der Entität; `false` = Engine-Standard (z.B. Gast-Gegner, Herzen, Power-ups). */
export function drawWinterSkin(g: Ctx2D, env: SkinEnv, e: Ent, sx: number, sy: number, v: ViewState): boolean {
  switch (e.kind) {
    case "block":
      switch (e.skin) {
        case "snowman":
          drawSnowman(g, env, e, sx, sy, v);
          return true;
        case "presents":
          drawPresents(g, env, e, sx, sy, v);
          return true;
        case "xmas-tree":
          drawTree(g, env, e, sx, sy, v);
          return true;
        case "sugarcane":
          drawCane(g, env, e, sx, sy, v);
          return true;
        case "iceblock":
          drawIceblock(g, env, e, sx, sy, v);
          return true;
        case "stall":
          drawStall(g, env, e, sx, sy, v);
          return true;
        case "kessel":
          drawKessel(g, env, e, sx, sy, v);
          return true;
        case "firebasket":
          drawBasket(g, env, e, sx, sy, v);
          return true;
        default:
          return false;
      }
    case "overhead":
      if (e.skin === "icicles") {
        drawIcicles(g, env, e, sx, sy, v);
        return true;
      }
      if (e.skin === "chains") {
        drawChains(g, env, e, sx, sy, v);
        return true;
      }
      return false;
    case "platform":
      if (e.skin === "sled-ride") {
        drawSledRide(g, env, e, sx, sy, v);
        return true;
      }
      return e.skin === "stall-roof";
    case "walker":
      switch (e.skin) {
        case "gingerbread":
          drawGingerbread(g, env, e, sx, sy, v);
          return true;
        case "krampus":
          drawKrampus(g, env, e, sx, sy, v);
          return true;
        case "sled":
          drawSledHazard(g, env, e, sx, sy, v);
          return true;
        case "elf":
          drawElf(g, env, e, sx, sy, v);
          return true;
        default:
          return false;
      }
    case "projectile":
      if (e.skin === "snowball") {
        drawSnowball(g, env, e, sx, sy, v);
        return true;
      }
      return false;
    case "zone":
      if (e.skin === "icicle") {
        drawIcicleZone(g, env, e, sx, sy, v);
        return true;
      }
      return false;
    case "wind":
      drawSteam(g, env, e, sx, sy, v);
      return true;
    case "decor":
      if (e.skin === "elf") {
        drawElf(g, env, e, sx, sy, v);
        return true;
      }
      if (e.skin === "snow-burst") {
        drawSnowBurst(g, env, e, sx, sy, v);
        return true;
      }
      if (e.skin === "stall-bg") {
        drawStallBg(g, env, e, sx, sy, v);
        return true;
      }
      if (e.skin === "gateway") {
        drawGateway(g, env, e, sx, sy, v);
        return true;
      }
      return false;
    case "pickup":
      if (e.pickup === "coin") {
        drawStarCoin(g, env, e, sx, sy, v);
        return true;
      }
      if (e.pickup === "gem") {
        drawGingerHeart(g, env, e, sx, sy, v);
        return true;
      }
      return false;
    default:
      return false;
  }
}
