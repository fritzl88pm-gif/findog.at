/**
 * Wien – Renderer: gemalte Katastrophen-Kulisse (8 Stufen, gespiegelt gekachelt) + prozedurale Dachlandschaft,
 * Gründerzeit-Fassaden, Laternen/Platanen, Oberleitung, nasses Kopfsteinpflaster mit Gleisen, Regen/Glut/Asche,
 * Blitze.
 */
import { clamp } from "../../draw-utils";
import type { AssetLoader, Ent, PropLibrary, ViewState, WorldRenderer } from "../../types";
import { Motes, Rain } from "../shared-a/fx";
import {
  PaintedBackdrop,
  blitTiled,
  blitTiledClip,
  css,
  groundSegments,
  hash,
  stageRgb,
  stageVal,
  type Tile,
} from "../shared-a/gfx";
import {
  paintClouds,
  paintFacades,
  paintGlow,
  paintLamp,
  paintLampOff,
  paintLitfass,
  paintRainSheet,
  paintRooftops,
  paintSmokePuff,
  paintStreet,
  paintTree,
  type FacadeOpts,
} from "./scenery";
import {
  drawBauzaun,
  drawBolt,
  drawBrick,
  drawBurningBeam,
  drawFiaker,
  drawPigeon,
  drawPoller,
  drawPuddle,
  drawRoofTile,
  drawRubble,
  drawScaffold,
  drawSign,
  drawTram,
  type SkinCtx,
} from "./skins";
import {
  ASH,
  CLOUDS,
  FACADE_OF_STAGE,
  FIRE,
  HAZE,
  LAMPS,
  RAIN,
  ROOF_OF_STAGE,
  SKY_BOT,
  SKY_TOP,
  SMOKE,
  WIEN_BACKDROPS,
  WIND,
} from "./stages";

const FACADE_VARIANTS: FacadeOpts[] = [
  { lit: 0.62, fire: 0, damage: 0 },
  { lit: 0.3, fire: 0, damage: 1 },
  { lit: 0.08, fire: 0.07, damage: 1 },
  { lit: 0, fire: 0.34, damage: 1 },
  { lit: 0, fire: 0.02, damage: 2 },
];
const ROOF_VARIANTS = [
  { lit: 0.42, ruin: 0 },
  { lit: 0.06, ruin: 0 },
  { lit: 0, ruin: 1 },
];

/** Dunstdichte vor den Fassaden je Stufe */
const FACADE_HAZE = [0.34, 0.42, 0.46, 0.55, 0.5, 0.5, 0.62, 0.66];
const FACADE_W = 2048;
const FACADE_H = 320;
const FACADE_BOTTOM = 580;
const ROOF_W = 2048;
const ROOF_H = 200;
const NEAR_PAR = 0.72;
const NEAR_SLOT = 190;
const WIRE_SPAN = 430;

export class WienRenderer implements WorldRenderer {
  private backdrop = new PaintedBackdrop(
    WIEN_BACKDROPS.map((url) => ({ url, seam: "mirror" as const })),
    560,
    3,
  );
  private facades: Array<Tile | null> = [];
  private roofs: Array<Tile | null> = [];
  private clouds: Tile | null = null;
  private smoke: Tile | null = null;
  private steam: Tile | null = null;
  private street: Tile | null = null;
  private lamp: Tile | null = null;
  private lampOff: Tile | null = null;
  private trees: Tile[] = [];
  private litfass: Tile | null = null;
  private rainSheet: Tile | null = null;
  private glowWarm: Tile | null = null;
  private glowCold: Tile | null = null;
  private props: PropLibrary | null = null;
  private rain = new Rain(380);
  private motes = new Motes(220);
  private k = 1;
  private built = false;
  private skinCtx: SkinCtx = { props: null, flash: 0, stage: 0, reduced: false };
  private emberT = 0;
  private ashT = 0;
  private debrisT = 0;
  private lastStage = -1;
  private lightning = 0;

  async load(assets: AssetLoader): Promise<void> {
    this.props = assets.props;
    this.skinCtx.props = assets.props;
    await this.backdrop.load(assets.image);
    this.buildStatic();
    // große Kacheln verteilt vorbereiten (hält den Hauptthread reaktionsfähig)
    for (let i = 0; i < FACADE_VARIANTS.length; i += 1) {
      this.facade(i);
      await Promise.resolve();
    }
    for (let i = 0; i < ROOF_VARIANTS.length; i += 1) this.roof(i);
    this.backdrop.warm(0);
    this.backdrop.warm(1);
  }

  resize(dpr: number): void {
    const k = clamp(dpr, 1, 2);
    if (Math.abs(k - this.k) > 0.01) {
      this.k = k;
      this.built = false;
    }
  }

  private buildStatic(): void {
    if (this.built) return;
    this.built = true;
    const k = this.k;
    this.street = paintStreet(512, 130, k);
    this.lamp = paintLamp(k);
    this.lampOff = paintLampOff(k);
    this.trees = [paintTree(k, 1), paintTree(k, 2), paintTree(k, 3)];
    this.litfass = paintLitfass(k);
    if (!this.clouds) this.clouds = paintClouds(2048, 300);
    if (!this.rainSheet) this.rainSheet = paintRainSheet(512, 512);
    if (!this.smoke) this.smoke = paintSmokePuff(256);
    if (!this.steam) {
      this.steam = paintGlow(128, "rgba(220,225,235,0.5)");
      this.glowWarm = paintGlow(256, "rgba(255,196,110,0.55)");
      this.glowCold = paintGlow(256, "rgba(170,200,255,0.6)");
    }
  }

  private facade(i: number): Tile {
    let t = this.facades[i];
    if (!t) {
      t = paintFacades(FACADE_W, FACADE_H, FACADE_VARIANTS[i]);
      this.facades[i] = t;
    }
    return t;
  }

  private roof(i: number): Tile {
    let t = this.roofs[i];
    if (!t) {
      t = paintRooftops(ROOF_W, ROOF_H, ROOF_VARIANTS[i]);
      this.roofs[i] = t;
    }
    return t;
  }

  update(dt: number, v: ViewState): void {
    this.buildStatic();
    const d = Math.min(0.05, dt);
    const st = v.stage;
    const bl = v.stageBlend;
    if (st !== this.lastStage) {
      this.lastStage = st;
      this.backdrop.warm(st + 1);
    }
    const target = (v.vars.lightning ?? 0) * (v.reducedMotion ? 0.25 : 1);
    this.lightning = Math.max(target, this.lightning - d * 3);
    const rainK = stageVal(RAIN, st, bl) * (0.75 + 0.25 * v.intensity);
    this.rain.wind = stageVal(WIND, st, bl);
    this.rain.update(d, v, rainK, v.groundY);
    // Glut / Asche / Sturmtrümmer
    const q = v.quality === 0 ? 0.3 : v.quality === 1 ? 0.6 : 1;
    const fire = stageVal(FIRE, st, bl);
    const ash = stageVal(ASH, st, bl);
    this.emberT -= d * fire * 60 * q;
    while (this.emberT < 0) {
      this.emberT += 1;
      this.motes.spawn("ember", Math.random() * 1400, 560 + Math.random() * 160, -60 + Math.random() * 120, -120 - Math.random() * 200, 2 + Math.random() * 2.5, 1.2 + Math.random() * 1.8, 0.4 + Math.random() * 0.6);
    }
    this.ashT -= d * ash * 40 * q;
    while (this.ashT < 0) {
      this.ashT += 1;
      this.motes.spawn("ash", Math.random() * 1500, -20, -20, 40 + Math.random() * 50, 9, 1.5 + Math.random() * 2, 0.3 + Math.random() * 0.8);
    }
    if (st === 2 || (st === 1 && bl > 0.5)) {
      this.debrisT -= d * 3 * q;
      while (this.debrisT < 0) {
        this.debrisT += 1;
        this.motes.spawn(Math.random() < 0.5 ? "leaf" : "paper", 1320, 200 + Math.random() * 380, -300 - Math.random() * 300, -40 + Math.random() * 80, 4, 5 + Math.random() * 5, 0.5);
      }
    }
    this.motes.update(d, v.speed, stageVal(WIND, st, bl) * 0.4, v.time);
    this.skinCtx.flash = this.lightning;
    this.skinCtx.stage = st;
    this.skinCtx.reduced = v.reducedMotion;
  }

  // -------------------------------------------------------------------------------------------------

  drawBackground(g: CanvasRenderingContext2D, v: ViewState): void {
    this.buildStatic();
    const st = v.stage;
    const bl = v.stageBlend;
    const W = v.w;
    const gy = v.groundY;
    const fl = this.lightning;

    // 1) Himmel
    const top = stageRgb(SKY_TOP, st, bl);
    const bot = stageRgb(SKY_BOT, st, bl);
    const sky = g.createLinearGradient(0, 0, 0, gy);
    sky.addColorStop(0, css(top));
    sky.addColorStop(1, css(bot));
    g.fillStyle = sky;
    g.fillRect(0, 0, W, gy);

    // 2) Gemalte Fernkulisse (Stephansdom, Rathaus, Riesenrad) mit Stufen-Überblendung
    const bScroll = v.dist * 0.06;
    const by = -84;
    if (this.backdrop.ready) {
      this.backdrop.draw(g, st, bScroll, by);
      if (bl > 0.002) this.backdrop.draw(g, st + 1, bScroll, by, bl);
      if (fl > 0.02) {
        g.globalCompositeOperation = "lighter";
        this.backdrop.draw(g, Math.min(7, st + (bl > 0.5 ? 1 : 0)), bScroll, by, fl * 0.45);
        g.globalCompositeOperation = "source-over";
      }
    }

    // 3) Ziehende Sturmwolken
    const cl = stageVal(CLOUDS, st, bl);
    if (this.clouds && cl > 0.01) {
      g.globalAlpha = cl;
      blitTiled(g, this.clouds, v.dist * 0.03 + v.time * 22, -40, W);
      g.globalAlpha = cl * 0.6;
      blitTiled(g, this.clouds, v.dist * 0.05 + v.time * 38 + 700, 60, W, 220);
      g.globalAlpha = 1;
    }
    // Blitz-Leuchten am Himmel
    if (fl > 0.02 && this.glowCold) {
      const bx = v.vars.boltX ?? 640;
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = fl * 0.9;
      g.drawImage(this.glowCold.canvas, bx - 520, -380, 1040, 900);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    // Ferner Blitzstrahl (Ambient)
    const far = v.vars.farBolt ?? 0;
    if (far > 0.05 && !v.reducedMotion) this.drawFarBolt(g, v.vars.boltX ?? 640, far, v.vars.boltSeed ?? 1);

    // 4) Brandschein am Horizont
    const fire = stageVal(FIRE, st, bl);
    if (fire > 0.01) {
      const flick = v.reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(v.time * 3.1) * Math.sin(v.time * 7.3 + 1);
      g.globalCompositeOperation = "lighter";
      const fg = g.createLinearGradient(0, 180, 0, gy);
      fg.addColorStop(0, "rgba(255,90,20,0)");
      fg.addColorStop(0.6, `rgba(255,110,30,${0.22 * fire * flick})`);
      fg.addColorStop(1, `rgba(255,150,60,${0.4 * fire * flick})`);
      g.fillStyle = fg;
      g.fillRect(0, 180, W, gy - 180);
      g.globalCompositeOperation = "source-over";
    }
    // Rauchsäulen
    const smoke = stageVal(SMOKE, st, bl);
    if (smoke > 0.02 && this.smoke) this.drawSmokeColumns(g, v, smoke);

    // 5) Dunst + ferne Dachlandschaft
    const haze = stageRgb(HAZE, st, bl);
    g.fillStyle = css(haze, 0.22);
    g.fillRect(0, 0, W, gy);
    const rv = ROOF_OF_STAGE[st];
    const rv2 = ROOF_OF_STAGE[Math.min(7, st + 1)];
    const roofY = gy - ROOF_H + 10;
    blitTiled(g, this.roof(rv), v.dist * 0.16, roofY, W);
    if (rv2 !== rv && bl > 0.002) {
      g.globalAlpha = bl;
      blitTiled(g, this.roof(rv2), v.dist * 0.16, roofY, W);
      g.globalAlpha = 1;
    }
    const rh = g.createLinearGradient(0, roofY + 30, 0, gy);
    rh.addColorStop(0, css(haze, 0.12));
    rh.addColorStop(1, css(haze, 0.62));
    g.fillStyle = rh;
    g.fillRect(0, roofY + 30, W, gy - roofY - 30);

    // 6) Gründerzeit-Fassaden
    const fv = FACADE_OF_STAGE[st];
    const fv2 = FACADE_OF_STAGE[Math.min(7, st + 1)];
    const fy = FACADE_BOTTOM - FACADE_H;
    const fScroll = v.dist * 0.38;
    blitTiled(g, this.facade(fv), fScroll, fy, W);
    if (fv2 !== fv && bl > 0.002) {
      g.globalAlpha = bl;
      blitTiled(g, this.facade(fv2), fScroll, fy, W);
      g.globalAlpha = 1;
    }
    // Lichtstimmung auf den Fassaden (Dunst nach unten dichter, Ruß in späten Stufen)
    const fh = stageVal(FACADE_HAZE, st, bl);
    const fhg = g.createLinearGradient(0, fy + 60, 0, FACADE_BOTTOM);
    fhg.addColorStop(0, css(haze, fh * 0.35));
    fhg.addColorStop(1, css(haze, fh));
    g.fillStyle = fhg;
    g.fillRect(0, fy + 60, W, FACADE_BOTTOM - fy - 60);
    if (fl > 0.02) {
      g.globalCompositeOperation = "lighter";
      g.fillStyle = `rgba(150,175,230,${0.22 * fl})`;
      g.fillRect(0, fy, W, FACADE_BOTTOM - fy);
      g.globalCompositeOperation = "source-over";
    }
    if (fire > 0.05) {
      const flick = v.reducedMotion ? 1 : 0.8 + 0.2 * Math.sin(v.time * 5.3) * Math.sin(v.time * 2.1);
      g.globalCompositeOperation = "lighter";
      const fg = g.createLinearGradient(0, fy + 60, 0, FACADE_BOTTOM);
      fg.addColorStop(0, "rgba(255,110,40,0)");
      fg.addColorStop(1, `rgba(255,120,40,${0.28 * fire * flick})`);
      g.fillStyle = fg;
      g.fillRect(0, fy + 60, W, FACADE_BOTTOM - fy - 60);
      g.globalCompositeOperation = "source-over";
    }

    // Regenvorhänge
    const rainK = stageVal(RAIN, st, bl);
    if (rainK > 0.05 && this.rainSheet) {
      const sheet = this.rainSheet;
      const off = (v.time * 900) % 512;
      g.globalAlpha = Math.min(1, rainK * 1.1);
      for (let yy = -512 + off; yy < FACADE_BOTTOM; yy += 512) blitTiled(g, sheet, v.dist * 0.45 - v.time * 120, yy, W);
      g.globalAlpha = 1;
    }

    // 7) Gehsteig
    const sw = g.createLinearGradient(0, FACADE_BOTTOM, 0, gy);
    sw.addColorStop(0, "#2a2e38");
    sw.addColorStop(1, "#3b404c");
    g.fillStyle = sw;
    g.fillRect(0, FACADE_BOTTOM, W, gy - FACADE_BOTTOM);
    g.fillStyle = "rgba(180,195,225,0.18)";
    g.fillRect(0, gy - 3, W, 1.5);

    // 8) Nahe Straßenmöbel (Laternen, Platanen, Litfaßsäulen)
    this.drawNear(g, v);

    // 9) Oberleitung
    this.drawWires(g, v);
  }

  private drawFarBolt(g: CanvasRenderingContext2D, bx: number, k: number, seed: number): void {
    g.save();
    g.globalCompositeOperation = "lighter";
    g.lineCap = "round";
    for (const [lw, a] of [
      [7, 0.25],
      [2.2, 0.95],
    ] as Array<[number, number]>) {
      g.strokeStyle = `rgba(200,220,255,${a * k})`;
      g.lineWidth = lw;
      g.beginPath();
      let x = bx + (hash(seed) - 0.5) * 80;
      let y = 10;
      g.moveTo(x, y);
      const endY = 330 + hash(seed + 1) * 60;
      let i = 0;
      while (y < endY) {
        y += 18 + hash(seed + i * 3.3) * 20;
        x += (hash(seed + i * 7.1) - 0.5) * 42;
        g.lineTo(x, y);
        if (i === 4) {
          g.moveTo(x, y);
          g.lineTo(x + 40 + hash(seed + 9) * 40, y + 50);
          g.moveTo(x, y);
        }
        i += 1;
      }
      g.stroke();
    }
    g.restore();
  }

  private drawSmokeColumns(g: CanvasRenderingContext2D, v: ViewState, smoke: number): void {
    const puff = this.smoke;
    if (!puff) return;
    const par = 0.1;
    const span = 520;
    const scroll = v.dist * par;
    const first = Math.floor(scroll / span) - 1;
    g.save();
    for (let s = first; s < first + 5; s += 1) {
      if (hash(s * 3.7) > 0.72) continue;
      const baseX = s * span + hash(s) * 300 - scroll;
      const baseY = 470 - hash(s * 1.3) * 40;
      for (let p = 0; p < 7; p += 1) {
        const life = (v.time * 0.09 + p / 7 + hash(s + p)) % 1;
        const size = 90 + life * 380;
        const x = baseX + life * 260 + Math.sin(life * 5 + s) * 20;
        const y = baseY - life * 460;
        g.globalAlpha = smoke * (1 - life) * Math.min(1, life * 5) * 0.9;
        g.drawImage(puff.canvas, x - size / 2, y - size / 2, size, size);
      }
    }
    g.restore();
  }

  private drawNear(g: CanvasRenderingContext2D, v: ViewState): void {
    const st = v.stage;
    const bl = v.stageBlend;
    const lamps = stageVal(LAMPS, st, bl);
    const scroll = v.dist * NEAR_PAR;
    const first = Math.floor((scroll - 220) / NEAR_SLOT);
    const last = Math.floor((scroll + v.w + 220) / NEAR_SLOT);
    const base = v.groundY - 6;
    const wind = stageVal(WIND, st, bl);
    const flick = v.reducedMotion ? 1 : st === 2 ? (Math.sin(v.time * 23) > -0.6 ? 1 : 0.2) : 1;
    for (let s = first; s <= last; s += 1) {
      const x = s * NEAR_SLOT - scroll + (hash(s * 2.9) - 0.5) * 50;
      const hv = hash(s * 7.13 + 1);
      if (s % 3 === 0) {
        const on = lamps * flick * (hash(s * 5.1) < 0.12 && st >= 2 ? 0 : 1);
        const spr = on > 0.1 ? this.lamp : this.lampOff;
        if (spr) g.drawImage(spr.canvas, x - 30, base - 300, 60, 320);
        if (on > 0.05 && this.glowWarm) {
          g.globalCompositeOperation = "lighter";
          g.globalAlpha = on * 0.8;
          g.drawImage(this.glowWarm.canvas, x - 90, base - 330, 180, 180);
          g.globalAlpha = on * 0.25;
          g.drawImage(this.glowWarm.canvas, x - 160, base - 200, 320, 260);
          g.globalAlpha = 1;
          g.globalCompositeOperation = "source-over";
        }
      } else if (hv < 0.3 && this.trees.length) {
        const tr = this.trees[s % this.trees.length];
        const sway = v.reducedMotion ? 0 : (Math.sin(v.time * 1.7 + s) * 0.5 + 0.5) * wind * 0.00018;
        g.save();
        g.translate(x, base + 20);
        g.transform(1, 0, sway, 1, 0, 0);
        g.drawImage(tr.canvas, -100, -300, 200, 300);
        g.restore();
      }
    }
  }

  private drawWires(g: CanvasRenderingContext2D, v: ViewState): void {
    const scroll = v.dist;
    const first = Math.floor(scroll / WIRE_SPAN);
    const cy = 118;
    const my = 92;
    g.save();
    g.strokeStyle = "rgba(12,14,20,0.75)";
    g.lineWidth = 1.4;
    g.beginPath();
    // Fahrdraht
    g.moveTo(0, cy);
    g.lineTo(v.w, cy);
    for (let s = first; s <= first + 4; s += 1) {
      const x0 = s * WIRE_SPAN - scroll;
      const x1 = x0 + WIRE_SPAN;
      // Tragseil (Kettenlinie)
      g.moveTo(x0, my);
      g.quadraticCurveTo((x0 + x1) / 2, my + 30, x1, my);
      // Hänger
      for (let d = 1; d < 8; d += 1) {
        const u = d / 8;
        const xx = x0 + WIRE_SPAN * u;
        const yy = my + 30 * 2 * u * (1 - u) * 1;
        g.moveTo(xx, yy);
        g.lineTo(xx, cy);
      }
    }
    g.stroke();
    // Isolatoren
    g.fillStyle = "#20242d";
    for (let s = first; s <= first + 4; s += 1) {
      const x0 = s * WIRE_SPAN - scroll;
      g.fillRect(x0 - 3, my - 4, 6, 8);
    }
    if (this.lightning > 0.05) {
      g.strokeStyle = `rgba(200,220,255,${this.lightning * 0.7})`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, cy - 1);
      g.lineTo(v.w, cy - 1);
      g.stroke();
    }
    g.restore();
  }

  // -------------------------------------------------------------------------------------------------

  drawGround(g: CanvasRenderingContext2D, v: ViewState, pits: ReadonlyArray<{ x0: number; x1: number; skin: string }>): void {
    const gy = v.groundY;
    const H = v.h - gy;
    const st = v.stage;
    const bl = v.stageBlend;
    const segs = groundSegments(pits, v.w);
    // Lücken (Gully/Baugrube)
    for (const p of pits) this.drawPit(g, v, p.x0, p.x1);
    const street = this.street;
    for (let i = 0; i < segs.length; i += 2) {
      const a = segs[i];
      const b = segs[i + 1];
      if (b <= a) continue;
      if (street) blitTiledClip(g, street, v.dist, gy, a, b);
      else {
        g.fillStyle = "#23262e";
        g.fillRect(a, gy, b - a, H);
      }
      // Kante zur Lücke
      if (a > 0) {
        g.fillStyle = "#4b505c";
        g.fillRect(a - 3, gy, 4, H);
      }
      if (b < v.w) {
        g.fillStyle = "#0b0d12";
        g.fillRect(b - 2, gy, 4, H);
      }
    }
    // Spiegelung der Fassaden im nassen Pflaster
    const wetK = Math.max(stageVal(RAIN, st, bl), 0.3) * (1 - stageVal(ASH, st, bl) * 0.8);
    if (wetK > 0.05 && v.quality > 0) {
      g.save();
      g.beginPath();
      for (let i = 0; i < segs.length; i += 2) g.rect(segs[i], gy + 2, segs[i + 1] - segs[i], H);
      g.clip();
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.2 * wetK;
      g.translate(0, (gy - 4) * 2);
      g.scale(1, -1);
      blitTiled(g, this.facade(FACADE_OF_STAGE[st]), v.dist * 0.38, FACADE_BOTTOM - FACADE_H, v.w);
      g.restore();
      const fade = g.createLinearGradient(0, gy, 0, v.h);
      fade.addColorStop(0, "rgba(8,10,16,0)");
      fade.addColorStop(1, "rgba(8,10,16,0.5)");
      g.fillStyle = fade;
      for (let i = 0; i < segs.length; i += 2) g.fillRect(segs[i], gy, segs[i + 1] - segs[i], H);
    }
    // Laternen-Spiegelung auf nassem Pflaster
    const lamps = stageVal(LAMPS, st, bl);
    const wet = Math.max(stageVal(RAIN, st, bl), 0.35);
    if (lamps > 0.05 && this.glowWarm) {
      const scroll = v.dist * NEAR_PAR;
      const first = Math.floor((scroll - 100) / NEAR_SLOT);
      g.globalCompositeOperation = "lighter";
      for (let s = first; s <= first + 9; s += 1) {
        if (s % 3 !== 0) continue;
        const x = s * NEAR_SLOT - scroll + (hash(s * 2.9) - 0.5) * 50;
        g.globalAlpha = lamps * wet * 0.35;
        g.drawImage(this.glowWarm.canvas, x - 22, gy + 2, 44, 120);
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    // Blitz spiegelt sich im nassen Boden
    if (this.lightning > 0.03) {
      g.globalCompositeOperation = "lighter";
      g.fillStyle = `rgba(160,185,240,${0.18 * this.lightning * wet})`;
      g.fillRect(0, gy, v.w, H);
      g.globalCompositeOperation = "source-over";
    }
    // Asche / Trümmer in späten Stufen
    const ash = stageVal(ASH, st, bl);
    if (ash > 0.05) {
      g.fillStyle = `rgba(92,90,94,${0.45 * ash})`;
      for (let i = 0; i < segs.length; i += 2) g.fillRect(segs[i], gy, segs[i + 1] - segs[i], H);
      const scroll = v.dist;
      const first = Math.floor(scroll / 140);
      for (let s = first; s <= first + 10; s += 1) {
        if (hash(s * 3.3) > ash * 0.8) continue;
        const x = s * 140 - scroll + hash(s) * 100;
        if (inPit(pits, x)) continue;
        const y = gy + 10 + hash(s * 1.7) * (H - 30);
        g.fillStyle = hash(s * 9.1) < 0.5 ? "#5b3226" : "#3d3a38";
        g.save();
        g.translate(x, y);
        g.rotate(hash(s * 4.4) * 3);
        g.fillRect(-9, -4, 18, 8);
        g.restore();
        const fire = stageVal(FIRE, st, bl);
        if (fire > 0.2 && hash(s * 6.6) < 0.4 && this.glowWarm) {
          g.globalCompositeOperation = "lighter";
          g.globalAlpha = fire * 0.5 * (v.reducedMotion ? 1 : 0.7 + 0.3 * Math.sin(v.time * 4 + s));
          g.drawImage(this.glowWarm.canvas, x - 18, y - 12, 36, 24);
          g.globalAlpha = 1;
          g.globalCompositeOperation = "source-over";
        }
      }
    }
    // Obere Kante (nasser Glanz)
    g.fillStyle = `rgba(190,205,235,${0.22 + this.lightning * 0.4})`;
    for (let i = 0; i < segs.length; i += 2) g.fillRect(segs[i], gy, segs[i + 1] - segs[i], 2);
  }

  private drawPit(g: CanvasRenderingContext2D, v: ViewState, x0: number, x1: number): void {
    const gy = v.groundY;
    const w = x1 - x0;
    g.save();
    g.beginPath();
    g.rect(x0, gy, w, v.h - gy);
    g.clip();
    const sg = g.createLinearGradient(0, gy, 0, v.h);
    sg.addColorStop(0, "#2a2320");
    sg.addColorStop(0.35, "#120f0e");
    sg.addColorStop(1, "#050505");
    g.fillStyle = sg;
    g.fillRect(x0, gy, w, v.h - gy);
    // Ziegelwand im Schacht
    g.strokeStyle = "rgba(90,60,45,0.35)";
    g.lineWidth = 1;
    g.beginPath();
    for (let y = gy + 6, r = 0; y < v.h - 30; y += 11, r += 1) {
      g.moveTo(x0, y);
      g.lineTo(x1, y);
      const off = (r % 2) * 14 + ((v.dist % 28) + 28) % 28;
      for (let x = x0 - off; x < x1; x += 28) {
        g.moveTo(x, y);
        g.lineTo(x, y + 11);
      }
    }
    g.stroke();
    const dark = g.createLinearGradient(0, gy, 0, v.h);
    dark.addColorStop(0, "rgba(0,0,0,0.1)");
    dark.addColorStop(1, "rgba(0,0,0,0.85)");
    g.fillStyle = dark;
    g.fillRect(x0, gy, w, v.h - gy);
    // Wasser am Grund
    g.fillStyle = "rgba(40,60,80,0.6)";
    g.fillRect(x0, v.h - 26, w, 26);
    g.fillStyle = "rgba(170,200,240,0.35)";
    for (let i = 0; i < w / 30; i += 1) {
      const gx = x0 + ((i * 37 + v.time * 30) % w);
      g.fillRect(gx, v.h - 24 + (i % 3) * 5, 10, 1.5);
    }
    // Schattenkanten
    const lg = g.createLinearGradient(x0, 0, x0 + 40, 0);
    lg.addColorStop(0, "rgba(0,0,0,0.7)");
    lg.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = lg;
    g.fillRect(x0, gy, 40, v.h - gy);
    g.restore();
    // Dampf
    if (this.steam && !v.reducedMotion) {
      g.save();
      for (let i = 0; i < 5; i += 1) {
        const life = (v.time * 0.45 + i / 5 + hash(x0 + v.dist) * 0) % 1;
        const cx = x0 + w * (0.3 + 0.4 * hash(i * 3.1)) + Math.sin(life * 6 + i) * 12;
        const cy = gy + 10 - life * 190;
        const sz = 60 + life * 140;
        g.globalAlpha = (1 - life) * Math.min(1, life * 4) * 0.45;
        g.drawImage(this.steam.canvas, cx - sz / 2, cy - sz / 2, sz, sz);
      }
      g.restore();
    }
    // abgelegter Kanaldeckel links der Lücke
    g.fillStyle = "#1b1d22";
    g.beginPath();
    g.ellipse(x0 - 34, gy + 8, 26, 6, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(160,170,190,0.4)";
    g.lineWidth = 1.5;
    g.stroke();
  }

  // -------------------------------------------------------------------------------------------------

  drawEntity(g: CanvasRenderingContext2D, e: Ent, sx: number, sy: number, v: ViewState): boolean {
    const c = this.skinCtx;
    const P = this.props;
    const gy = v.groundY;
    switch (e.skin) {
      case "tram":
        drawTram(g, e, sx, sy, v, c);
        return true;
      case "tram-roof":
      case "manhole":
        return true;
      case "fiaker":
        drawFiaker(g, e, sx, sy, v, c);
        return true;
      case "pigeon":
        drawPigeon(g, e, sx, sy, v);
        return true;
      case "puddle":
        drawPuddle(g, e, sx, v, c);
        return true;
      case "bolt":
        drawBolt(g, e, sx, sy, v, c);
        return true;
      case "poller":
        drawPoller(g, sx, sy, e.w, e.h, gy);
        return true;
      case "bauzaun":
        drawBauzaun(g, sx, sy, e.w, e.h, gy, v.time, v.reducedMotion);
        return true;
      case "rubble":
        drawRubble(g, e, sx, sy, gy, v.time, c);
        return true;
      case "scaffold":
        drawScaffold(g, e, sx, sy, v);
        return true;
      case "beam":
        drawBurningBeam(g, e, sx, sy, v);
        return true;
      case "sign":
        drawSign(g, e, sx, sy, v);
        return true;
      case "rooftile":
        drawRoofTile(g, e, sx, sy, v);
        return true;
      case "brick":
        drawBrick(g, e, sx, sy, v);
        return true;
      case "plank": {
        // Holzbohle über der Baugrube
        const pg = g.createLinearGradient(0, sy, 0, sy + e.h);
        pg.addColorStop(0, "#c89a5b");
        pg.addColorStop(1, "#6e4a24");
        g.fillStyle = pg;
        g.fillRect(sx, sy, e.w, e.h);
        g.strokeStyle = "#2b1a0a";
        g.lineWidth = 2.5;
        g.strokeRect(sx, sy, e.w, e.h);
        g.fillStyle = "#2b2f38";
        g.fillRect(sx + 12, sy + e.h, 8, gy + 60 - sy - e.h);
        g.fillRect(sx + e.w - 20, sy + e.h, 8, gy + 60 - sy - e.h);
        g.fillStyle = "rgba(255,230,180,0.35)";
        g.fillRect(sx + 2, sy + 2, e.w - 4, 2);
        return true;
      }
      case "cone":
      case "bench":
      case "wurstel": {
        const id = e.skin === "cone" ? "traffic-cone" : e.skin === "bench" ? "park-bench" : "wuerstelstand";
        g.fillStyle = "rgba(0,0,0,0.35)";
        g.beginPath();
        g.ellipse(sx + e.w / 2, gy + 3, e.w * 0.55, 6, 0, 0, Math.PI * 2);
        g.fill();
        if (P?.has(id)) {
          const h = e.skin === "wurstel" ? e.h * 1.14 : e.skin === "bench" ? e.h * 1.25 : e.h * 1.08;
          P.draw(g, id, sx + e.w / 2, gy + 3, { h });
          if (e.skin === "wurstel") this.drawWurstelLight(g, sx, sy, e, v);
          return true;
        }
        this.drawBlockFallback(g, e, sx, sy, gy);
        return true;
      }
      default:
        return false;
    }
  }

  private drawWurstelLight(g: CanvasRenderingContext2D, sx: number, sy: number, e: Ent, v: ViewState): void {
    if (!this.glowWarm) return;
    g.save();
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.5;
    g.drawImage(this.glowWarm.canvas, sx - 30, sy - 10, e.w + 60, e.h * 0.9);
    g.restore();
    // Dampf vom Grill
    if (this.steam && !v.reducedMotion) {
      for (let i = 0; i < 3; i += 1) {
        const life = (v.time * 0.6 + i / 3) % 1;
        const sz = 30 + life * 60;
        g.globalAlpha = (1 - life) * 0.35;
        g.drawImage(this.steam.canvas, sx + e.w * 0.6 - sz / 2 + life * 20, sy - life * 90 - sz / 2, sz, sz);
      }
      g.globalAlpha = 1;
    }
  }

  private drawBlockFallback(g: CanvasRenderingContext2D, e: Ent, sx: number, sy: number, gy: number): void {
    g.save();
    if (e.skin === "cone") {
      g.fillStyle = "#ff6a1a";
      g.beginPath();
      g.moveTo(sx + e.w / 2, sy);
      g.lineTo(sx + e.w - 6, gy - 8);
      g.lineTo(sx + 6, gy - 8);
      g.closePath();
      g.fill();
      g.fillStyle = "#fff";
      g.fillRect(sx + e.w * 0.3, sy + e.h * 0.45, e.w * 0.4, 7);
      g.fillStyle = "#2b2b2b";
      g.fillRect(sx, gy - 8, e.w, 8);
    } else if (e.skin === "bench") {
      g.fillStyle = "#7a4a22";
      g.fillRect(sx, sy + 8, e.w, 10);
      g.fillRect(sx, sy + 30, e.w, 10);
      g.fillStyle = "#222";
      g.fillRect(sx + 8, sy + 40, 8, gy - sy - 40);
      g.fillRect(sx + e.w - 16, sy + 40, 8, gy - sy - 40);
    } else {
      g.fillStyle = "#6b4a2a";
      g.fillRect(sx, sy + 20, e.w, e.h - 20);
      g.fillStyle = "#b8392e";
      g.fillRect(sx - 6, sy, e.w + 12, 22);
      g.fillStyle = "#f6c983";
      g.fillRect(sx + 10, sy + 30, e.w - 20, 30);
    }
    g.restore();
  }

  // -------------------------------------------------------------------------------------------------

  drawForeground(g: CanvasRenderingContext2D, v: ViewState): void {
    const st = v.stage;
    const bl = v.stageBlend;
    // Glut, Asche, Trümmerflug
    this.motes.draw(g, v.time);
    // Regen
    const rainK = stageVal(RAIN, st, bl);
    if (rainK > 0.01) {
      const col = this.lightning > 0.2 ? "#e6eeff" : "#aebbd6";
      this.rain.draw(g, col, 0.55 + 0.35 * rainK, v.groundY);
    }
    // Bodennaher Rauch vor der Szene
    const smoke = stageVal(SMOKE, st, bl);
    if (smoke > 0.2 && this.smoke) {
      g.save();
      const scroll = v.dist * 1.15 + v.time * 30;
      for (let i = 0; i < 4; i += 1) {
        const x = ((i * 460 - scroll) % 1840 + 1840) % 1840 - 280;
        g.globalAlpha = (smoke - 0.2) * 0.35;
        g.drawImage(this.smoke.canvas, x, v.groundY - 170 + (i % 2) * 40, 420, 300);
      }
      g.restore();
    }
    // Blitz-Aufhellung der ganzen Szene
    if (this.lightning > 0.03) {
      g.save();
      g.globalCompositeOperation = "lighter";
      g.fillStyle = `rgba(120,140,190,${0.12 * this.lightning})`;
      g.fillRect(0, 0, v.w, v.h);
      g.restore();
    }
  }

  drawOverlay(g: CanvasRenderingContext2D, v: ViewState): void {
    // Farbstimmung: oben Gewitterdunkel, unten Brandschein
    const st = v.stage;
    const bl = v.stageBlend;
    const fire = stageVal(FIRE, st, bl);
    const top = g.createLinearGradient(0, 0, 0, 260);
    top.addColorStop(0, "rgba(6,8,16,0.32)");
    top.addColorStop(1, "rgba(6,8,16,0)");
    g.fillStyle = top;
    g.fillRect(0, 0, v.w, 260);
    if (fire > 0.1) {
      g.save();
      g.globalCompositeOperation = "lighter";
      const fg = g.createLinearGradient(0, v.h, 0, v.h - 260);
      fg.addColorStop(0, `rgba(255,90,30,${0.12 * fire})`);
      fg.addColorStop(1, "rgba(255,90,30,0)");
      g.fillStyle = fg;
      g.fillRect(0, v.h - 260, v.w, 260);
      g.restore();
    }
  }
}

function inPit(pits: ReadonlyArray<{ x0: number; x1: number }>, x: number): boolean {
  for (const p of pits) if (x > p.x0 - 20 && x < p.x1 + 20) return true;
  return false;
}
