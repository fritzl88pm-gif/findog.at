/**
 * Opernball – WorldRenderer.
 * Ebenen (hinten → vorne): gemalte Saalwand je Stimmungsstufe (`far-*`, 0.05, Überblendung) mit Kerzenfunkeln und – in der
 * Polonaise – animiertem Feuerwerk hinter den Fenstern · Lichtkegel mit Lichtstaub (0.18) · Mittelgrund Säulen/Tafeln
 * (0.30 / 0.42, gedämpft) · Boden Teppich/Parkett mit Lichtpfützen, Orchestergräben in den Lücken (1.0) · Skins mit Rim-Light,
 * Schatten und Spiegelung · Vordergrund: Vorhangsaum (0.9), Konfetti, Champagner-Perlen, Effektpartikel · Overlay: Verdunklung.
 * Speicher: nur aktuelle + nächste Fernebene, Quellbilder werden nach dem Vorrendern freigegeben.
 */
import { VIEW_W } from "../../constants";
import { clamp } from "../../draw-utils";
import type { AssetLoader, Ent, ViewState, WorldRenderer } from "../../types";
import { bigGlow, blitTiled, colorWithAlpha, glowSprite, paint, solidSegments, type Ctx2D } from "../shared-b/canvas";
import { h1, mod, stageVal } from "../shared-b/color";
import { StageCache, StagePrep, stageProgress } from "../shared-b/layers";
import { yieldBetweenBakes } from "../shared-b/yield";
import {
  FarLayers,
  GROUND_TILE_H,
  GROUND_TILE_W,
  bakeGround,
  loadGroundBase,
  loadMids,
  loadNear,
  type GroundBase,
  type MidLayer,
  type NearLayer,
} from "./backdrop";
import { CHANDELIERS, FIREWORK_PANES, FAR_H, FAR_W, GLINTS } from "./glints";
import { Bubbles, Confetti, WindowFireworks, starSprite } from "./fx";
import { OPER_PROPS, OperSkins } from "./skins";
import { BEAT, BUBBLES, COLORS, CONFETTI, FIREWORKS, FLOOR_LIGHT, GLINT, MAX_STAGE, MID_COLUMNS, MID_TABLES } from "./stages";
import { drawGateway } from "./gateway";
import { drawPit } from "./pit";

/** Meter je Stimmungsstufe (wie WORLD_OPER.stageMeters; Test in oper.test.ts hält beides gleich) */
export const OPER_STAGE_METERS = 300;

/** x ab dem eine Entität als „noch außerhalb des Bildes“ gilt: Sprites reichen bis ca. 40 px links über die Trefferfläche hinaus */
const OFFSCREEN_X = VIEW_W + 40;

const FAR_PAR = 0.05;
const COLS_PAR = 0.3;
const TABS_PAR = 0.42;
const NEAR_PAR = 0.9;
const MID_FOOT = 572;

export { OPER_PROPS };

/** Weicher Lichtfleck auf dem Parkett (380×58, unskaliert blitbar) in Farbe `color` */
function floorGlow(color: string): HTMLCanvasElement {
  const c = colorWithAlpha(color, 1);
  return bigGlow(380, 58, [
    [0, c],
    [0.45, colorWithAlpha(color, 0.45)],
    [1, colorWithAlpha(color, 0)],
  ]);
}

/** Glanzstern in drei festen Größen (16/26/40 px), damit pro Frame nur unskalierte Blits nötig sind. */
function scaledStar(src: HTMLCanvasElement): HTMLCanvasElement[] {
  return [16, 26, 40].map((n) =>
    paint(n, n, (g) => {
      g.imageSmoothingQuality = "high";
      g.drawImage(src, 0, 0, n, n);
    }),
  );
}

/** Takt-Puls: 1 auf Schlag 1 (Betonung), fällt ab; bei reduzierter Bewegung konstant. */
export function beatPulse(time: number, reduced: boolean): number {
  if (reduced) return 0.6;
  const ph = (time / BEAT) % 3;
  const frac = ph % 1;
  return (ph < 1 ? 0.55 : 0.25) + (ph < 1 ? 0.45 : 0.2) * Math.exp(-4 * frac);
}

export class OperRenderer implements WorldRenderer {
  private far = new FarLayers();
  private cols: MidLayer | null = null;
  private tabs: MidLayer | null = null;
  private near: NearLayer | null = null;
  private groundBase: GroundBase = { carpet: null, parquet: null };
  private ground: StageCache | null = null;
  /** Bodenvarianten: aktuelle Stufe sofort, Folgestufe erst ab ~28 % der Stufe (Liste: nur `ground`, siehe makeGroundCache) */
  private prep = new StagePrep([], MAX_STAGE);
  private skins = new OperSkins();
  private confetti = new Confetti(120);
  private bubbles = new Bubbles(56);
  private fireworks = new WindowFireworks();
  private stars = [scaledStar(starSprite("#fff3c8")), scaledStar(starSprite("#e2eeff")), scaledStar(starSprite("#ffc6f0"))];
  private floorLights: HTMLCanvasElement[] = [];
  private glowGold = glowSprite("#ffc94a", 0.2);
  private k = 1;
  private time = 0;
  private lastCannon = 0;
  private lastDebris = 0;
  private lastStage = -1;
  private ready = false;

  async load(assets: AssetLoader): Promise<void> {
    this.skins.setProps(assets.props);
    this.skins.bank.setScale(this.k);
    // Die gemalten Ebenen backen jeweils in Schritten und geben dazwischen den Hauptthread frei (kein Long Task)
    const [, mids, near, gb] = await Promise.all([assets.props.preload(OPER_PROPS).catch(() => undefined), loadMids(), loadNear(), loadGroundBase()]);
    // Fehlen Props (Netzfehler, Blocker, veralteter Cache): Ersatzbilder jetzt backen statt beim ersten Auftritt im Lauf
    if (OPER_PROPS.some((id) => !assets.props.has(id))) {
      await yieldBetweenBakes();
      try {
        this.skins.warm();
      } catch {
        // wird beim ersten Zeichnen erneut versucht bzw. übersprungen
      }
    }
    this.cols = mids.cols;
    this.tabs = mids.tabs;
    this.near = near;
    this.groundBase = gb;
    await yieldBetweenBakes();
    this.makeGroundCache();
    this.floorLights = [];
    for (let s = 0; s <= 4; s += 1) this.floorLights.push(floorGlow(COLORS.css(s).floor));
    await yieldBetweenBakes();
    await this.far.ensure(0);
    await yieldBetweenBakes();
    await this.far.ensure(1);
    this.ready = true;
  }

  private makeGroundCache(): void {
    if (this.ground) this.prep.remove(this.ground);
    this.ground = new StageCache((s) => bakeGround(this.groundBase, s, this.k));
    this.prep.add(this.ground);
  }

  /**
   * Skalenwechsel (Governor, Vollbild, DPR). Idempotent: Werte innerhalb von 0,2 der zuletzt angewandten Skala ändern nichts
   * (wie SpriteBank.setScale); nur eine echte Änderung verwirft die Bodenkacheln und die Hindernis-Sprites (sie entstehen
   * beim nächsten Zeichnen bzw. in `update` neu, die Bodenkachel der Stufe sofort).
   */
  resize(dpr: number): void {
    const k = clamp(dpr, 1, 2);
    if (Math.abs(k - this.k) > 0.2) {
      this.k = k;
      this.skins.bank.setScale(k);
      this.makeGroundCache();
    }
  }

  // --- Zeitschritt ---------------------------------------------------------------------------------------------------------

  update(dt: number, v: ViewState): void {
    this.time = v.time;
    this.skins.bank.baked = 0;
    const stage = clamp(v.stage, 0, MAX_STAGE);
    const s = Math.min(MAX_STAGE, stage + v.stageBlend);
    if (stage !== this.lastStage) {
      this.lastStage = stage;
    }
    // Fernebenen: die aktuelle laden, die nächste erst ab ~28 % der Stufe (nicht am Stufenanfang: dort läge sonst Laden,
    // Dekodieren und Backen auf dem Übergang; die erste Folgestufe liegt schon seit `load` vor), den Rest freigeben
    const progress = stageProgress(v.worldMeters, OPER_STAGE_METERS);
    const wantNext = stage < MAX_STAGE && (progress >= 0.28 || v.stageBlend > 0.001);
    void this.far.ensure(stage);
    if (wantNext) void this.far.ensure(stage + 1);
    this.far.keep(stage, Math.min(MAX_STAGE, stage + 1));
    // Bodenvarianten: aktuelle sofort, Folgestufe ab ~28 % und höchstens ein Schritt je ~100 ms (bei Überblendung sofort)
    if (this.ground) this.prep.step(stage, progress, v.stageBlend);
    const q = v.quality === 0 ? 0.35 : v.quality === 1 ? 0.7 : 1;
    const reduced = v.reducedMotion;
    const scroll = v.speed;
    // Konfetti
    const cf = stageVal(CONFETTI, stage + v.stageBlend);
    if (!reduced) {
      this.confetti.rain(dt, cf * 34 * q, cf > 0.5 ? 1 : 0, scroll);
      // Kanonensalven (vom Weltsystem ausgelöst)
      const cannon = v.vars.cannonN ?? 0;
      if (cannon !== this.lastCannon) {
        this.lastCannon = cannon;
        if (cannon > 0 && v.quality > 0) {
          const n = v.quality === 2 ? 34 : 20;
          this.confetti.burst(30, 520, 1, n, 1);
          this.confetti.burst(1250, 520, -1, n, 1);
        }
      }
    }
    this.confetti.update(dt, scroll);
    // Champagner-Perlen
    const bb = stageVal(BUBBLES, stage + v.stageBlend);
    this.bubbles.update(dt, reduced ? 0 : bb * 7 * q, v.groundY, scroll, v.time);
    // Feuerwerk hinter den Fenstern
    const fw = stageVal(FIREWORKS, stage + v.stageBlend);
    this.fireworks.update(reduced ? 0 : dt, reduced ? 0 : fw, FIREWORK_PANES, v.quality);
    this.debris(v);
    this.skins.pops.update(dt, scroll);
    void s;
  }

  /** Trümmer eines zerbrochenen Hindernisses (vom Weltsystem gemeldet) */
  private debris(v: ViewState): void {
    const n = v.vars.debrisN ?? 0;
    if (n === this.lastDebris) return;
    this.lastDebris = n;
    if (n === 0) return;
    const x = v.vars.debrisX ?? 640;
    const y = v.vars.debrisY ?? 500;
    const k = v.vars.debrisK ?? 0;
    const P = this.skins.pops;
    const count = v.quality === 0 ? 8 : 18;
    for (let i = 0; i < count; i += 1) {
      const a = -Math.PI / 2 + (h1(n * 7 + i) - 0.5) * 2.8;
      const sp = 140 + h1(n * 3 + i * 5) * 380;
      const vx = Math.cos(a) * sp;
      const vy = Math.sin(a) * sp;
      const life = 0.8 + h1(i + n) * 0.7;
      if (k === 0) P.emit("petal", x, y, vx, vy, life, 11 + (i % 3) * 3, 420);
      else if (k === 1) P.emit(i % 3 === 0 ? "star" : "drop", x, y, vx, vy - 60, life, i % 3 === 0 ? 12 : 5, 900);
      else if (k === 2) P.emit(i % 2 ? "foam" : "drop", x, y, vx, vy, life, i % 2 ? 8 : 5, 800);
      else P.emit(i % 2 ? "gold" : "star", x, y, vx, vy, life * 0.7, i % 2 ? 6 : 12, 500);
    }
    P.emit("star", x, y, 0, 0, 0.3, 36);
  }

  // --- Hintergrund -----------------------------------------------------------------------------------------------------------

  drawBackground(g: Ctx2D, v: ViewState): void {
    const stage = clamp(v.stage, 0, MAX_STAGE);
    const bl = stage >= MAX_STAGE ? 0 : v.stageBlend;
    const s = Math.min(MAX_STAGE, stage + bl);
    const q = g.imageSmoothingQuality;
    g.imageSmoothingQuality = "low";
    // Saalwand
    const A = this.far.tile(stage) ?? this.far.best(stage);
    if (A) {
      blitTiled(g, A, FAR_W, FAR_H, v.dist * FAR_PAR, 0, v.w);
      const B = bl > 0.004 ? this.far.tile(stage + 1) : null;
      if (B) {
        g.globalAlpha = bl;
        blitTiled(g, B, FAR_W, FAR_H, v.dist * FAR_PAR, 0, v.w);
        g.globalAlpha = 1;
      }
    } else {
      // Platzhalter bis das Bild geladen ist: Saalfarbe
      const c = COLORS.css(s);
      const grd = g.createLinearGradient(0, 0, 0, v.h);
      grd.addColorStop(0, "#1a0508");
      grd.addColorStop(0.7, c.vignette);
      grd.addColorStop(1, "#0a0204");
      g.fillStyle = grd;
      g.fillRect(0, 0, v.w, v.h);
    }
    // Funkeln, Feuerwerk
    this.drawFarFx(g, v, stage, bl, s);
    // Mittelgrund
    const colA = stageVal(MID_COLUMNS, s);
    const tabA = stageVal(MID_TABLES, s);
    if (this.cols && colA > 0.01) this.drawMid(g, v, this.cols, COLS_PAR, colA);
    if (this.tabs && tabA > 0.01) this.drawMid(g, v, this.tabs, TABS_PAR, tabA);
    g.imageSmoothingQuality = q;
  }

  private drawMid(g: Ctx2D, v: ViewState, L: MidLayer, par: number, alpha: number): void {
    const y = Math.round(MID_FOOT - L.footY);
    const off = Math.round(mod(v.dist * par, L.w));
    if (alpha < 0.99) g.globalAlpha = alpha;
    for (let base = -off; base < v.w; base += L.w) {
      for (const [a, b] of L.spans) {
        const x0 = base + a;
        if (x0 + (b - a) < 0 || x0 > v.w) continue;
        g.drawImage(L.c, a, 0, b - a, L.h, x0, y, b - a, L.h);
      }
    }
    g.globalAlpha = 1;
  }

  private drawFarFx(g: Ctx2D, v: ViewState, stage: number, bl: number, s: number): void {
    const scroll = v.dist * FAR_PAR;
    const off = Math.round(mod(scroll, FAR_W));
    const t = v.time;
    const gl = stageVal(GLINT, s);
    const pulse = beatPulse(t, v.reducedMotion);
    g.globalCompositeOperation = "lighter";
    const draws: Array<[number, number]> = [[stage, 1 - bl]];
    if (bl > 0.004 && stage < MAX_STAGE) draws.push([stage + 1, bl]);
    const stride = v.quality === 0 ? 0 : v.quality === 1 ? 3 : 2;
    for (const [st, w] of draws) {
      if (!this.far.has(st) || w < 0.03 || stride === 0) continue;
      const pts = GLINTS[st];
      const spr = this.stars[st === 3 ? 1 : st === 4 ? 2 : 0];
      for (let i = 0; i < pts.length; i += 2 * stride) {
        let x = pts[i] - off;
        if (x < -40) x += FAR_W;
        if (x > v.w + 40) continue;
        const tw = v.reducedMotion ? 0.55 : 0.5 + 0.5 * Math.sin(t * (2.2 + (i % 7) * 0.31) + i * 0.73);
        const a = w * gl * (0.25 + 0.75 * tw * tw) * (0.7 + 0.3 * pulse);
        if (a < 0.08) continue;
        const sz = tw < 0.45 ? 0 : tw < 0.8 ? 1 : 2;
        const im = spr[sz];
        g.globalAlpha = Math.min(1, a);
        g.drawImage(im, Math.round(x - im.width / 2), Math.round(pts[i + 1] - im.height / 2));
      }
      // Lichtstaub in den Kegeln unter den Kronleuchtern
      if (v.quality > 0 && !v.reducedMotion) {
        const ch = CHANDELIERS[st];
        g.fillStyle = "#fff0c8";
        for (let ci = 0; ci < ch.length; ci += 1) {
          let cx = ch[ci][0] - off;
          if (cx < -200) cx += FAR_W;
          if (cx > v.w + 200) continue;
          for (let j = 0; j < 3; j += 1) {
            const u = (t * 0.05 * (1 + j * 0.2) + h1(ci * 13 + j + st * 5)) % 1;
            const half = 14 + u * 110;
            const mx = cx + (h1(ci * 31 + j * 7) - 0.5) * half * 1.6 + Math.sin(t * 0.7 + j + ci) * 8;
            g.globalAlpha = Math.sin(u * Math.PI) * 0.55 * w;
            g.fillRect(Math.round(mx), Math.round(ch[ci][1] + 30 + u * 450), 2, 2);
          }
        }
      }
    }
    // Feuerwerk (nur wo die Mitternachtsebene zu sehen ist)
    const fw = stageVal(FIREWORKS, s);
    if (fw > 0.02 && this.fireworks.active && this.far.has(MAX_STAGE)) {
      g.globalAlpha = 1;
      this.fireworks.draw(g, -off, 0, FIREWORK_PANES, fw);
      this.fireworks.draw(g, -off + FAR_W, 0, FIREWORK_PANES, fw);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  // --- Boden -----------------------------------------------------------------------------------------------------------------

  drawGround(g: Ctx2D, v: ViewState, pits: ReadonlyArray<{ x0: number; x1: number; skin: string }>): void {
    const stage = clamp(v.stage, 0, MAX_STAGE);
    const bl = stage >= MAX_STAGE ? 0 : v.stageBlend;
    const gy = v.groundY;
    const H = v.h - gy;
    const q = g.imageSmoothingQuality;
    g.imageSmoothingQuality = "low";
    const cache = this.ground;
    const A = cache ? cache.get(stage) : null;
    const B = cache && bl > 0.02 && cache.has(stage + 1) ? cache.get(stage + 1) : null;
    // Orchestergräben in den Lücken
    for (const p of pits) drawPit(g, p.x0, p.x1, gy, H, v, this.k);
    const segs = solidSegments(pits, v.w);
    for (const sg of segs) {
      const a = Math.max(0, sg.x0);
      const b = Math.min(v.w, sg.x1);
      if (b <= a) continue;
      if (A) {
        this.blitGround(g, A, v.dist, a, b, gy);
        if (B) {
          g.globalAlpha = bl;
          this.blitGround(g, B, v.dist, a, b, gy);
          g.globalAlpha = 1;
        }
      } else {
        g.fillStyle = "#4a1a12";
        g.fillRect(a, gy, b - a, H);
      }
      // Kanten der Lücke: goldene Leiste + Schatten
      if (sg.x0 > -30) this.capEdge(g, sg.x0, gy, H, 1);
      if (sg.x1 < v.w + 30) this.capEdge(g, sg.x1, gy, H, -1);
    }
    // obere Kante: schmaler Lichtsaum (Laufkante gut lesbar)
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.5;
    g.fillStyle = "#ffe4a8";
    for (const sg of segs) {
      const a = Math.max(0, sg.x0 + (sg.x0 > -30 ? 5 : 0));
      const b = Math.min(v.w, sg.x1 - (sg.x1 < v.w + 30 ? 5 : 0));
      if (b > a) g.fillRect(a, gy, b - a, 2);
    }
    g.globalAlpha = 1;
    // Lichtpfützen (Takt-Puls)
    this.drawFloorLights(g, v, pits, stage, bl);
    g.globalCompositeOperation = "source-over";
    g.imageSmoothingQuality = q;
  }

  private blitGround(g: Ctx2D, tile: HTMLCanvasElement, dist: number, x0: number, x1: number, y: number): void {
    const a = Math.round(x0);
    const b = Math.round(x1);
    const W = GROUND_TILE_W;
    const k = tile.width / W;
    const off = Math.round(mod(dist, W));
    let x = a;
    let guard = 0;
    while (x < b && guard < 12) {
      const u = mod(x + off, W);
      const w = Math.min(W - u, b - x);
      if (w > 0) g.drawImage(tile, u * k, 0, w * k, tile.height, x, y, w, GROUND_TILE_H);
      x += w;
      guard += 1;
    }
  }

  private capEdge(g: Ctx2D, x: number, gy: number, H: number, dir: 1 | -1): void {
    const xr = Math.round(x);
    g.fillStyle = "#2a0c08";
    g.fillRect(dir === 1 ? xr : xr - 6, gy, 6, H);
    g.fillStyle = "#e0a52a";
    g.fillRect(dir === 1 ? xr : xr - 6, gy, 6, 5);
    g.fillStyle = "rgba(255,240,190,0.9)";
    g.fillRect(dir === 1 ? xr : xr - 6, gy, 6, 2);
  }

  private drawFloorLights(g: Ctx2D, v: ViewState, pits: ReadonlyArray<{ x0: number; x1: number }>, stage: number, bl: number): void {
    const fl = stageVal(FLOOR_LIGHT, stage + bl);
    if (fl < 0.05 || v.quality === 0) return;
    const pulse = beatPulse(v.time, v.reducedMotion);
    const step = 3 * 260;
    const wx0 = Math.floor((v.dist - 240) / step) * step;
    const gy = v.groundY;
    for (let wx = wx0; wx < v.dist + v.w + 240; wx += step) {
      for (let j = 0; j < 2; j += 1) {
        const sx = wx + j * 470 + 90 * (h1(wx * 0.013 + j) - 0.5) - v.dist + 200;
        let inPit = false;
        for (const p of pits) if (sx > p.x0 - 90 && sx < p.x1 + 90) inPit = true;
        if (inPit) continue;
        const a = fl * (j ? 0.16 : 0.24) * (0.65 + 0.35 * pulse);
        const A = this.floorLights[stage];
        g.globalAlpha = a * (1 - bl);
        g.drawImage(A, Math.round(sx - 190), gy - 6);
        if (bl > 0.02) {
          g.globalAlpha = a * bl;
          g.drawImage(this.floorLights[Math.min(MAX_STAGE, stage + 1)], Math.round(sx - 190), gy - 6);
        }
      }
    }
    g.globalAlpha = 1;
  }

  // --- Entitäten ----------------------------------------------------------------------------------------------------------------

  drawEntity(g: Ctx2D, e: Ent, sx: number, sy: number, v: ViewState): boolean {
    const stage = clamp(v.stage, 0, MAX_STAGE);
    const f = this.skins.f;
    f.time = v.time;
    f.dt = v.dt;
    f.dist = v.dist;
    f.quality = v.quality;
    f.reduced = v.reducedMotion;
    f.groundY = v.groundY;
    f.stage = Math.min(MAX_STAGE, stage + v.stageBlend);
    if (e.kind === "decor" && e.skin === "gateway") {
      drawGateway(g, e, sx, sy, v, this.skins.f.time);
      return true;
    }
    // noch ganz außerhalb des Bildes: höchstens ein Sprite-Bake je Frame (siehe SpriteBank.baked)
    const bank = this.skins.bank;
    bank.off = sx >= OFFSCREEN_X;
    try {
      return this.skins.draw(g, e, sx, sy, v);
    } finally {
      bank.off = false;
    }
  }

  // --- Vordergrund -----------------------------------------------------------------------------------------------------------------

  drawForeground(g: Ctx2D, v: ViewState): void {
    const stage = clamp(v.stage, 0, MAX_STAGE);
    const q = g.imageSmoothingQuality;
    g.imageSmoothingQuality = "low";
    // Vorhangsaum oben (Nahgrund, schnell)
    if (this.near) {
      const L = this.near;
      const off = Math.round(mod(v.dist * NEAR_PAR, L.w));
      for (let base = -off; base < v.w; base += L.w) {
        for (const [a, b] of L.spans) {
          const x0 = base + a;
          if (x0 + (b - a) < 0 || x0 > v.w) continue;
          g.drawImage(L.c, a, 0, b - a, L.h, x0, -6, b - a, L.h);
        }
      }
    }
    this.skins.pops.draw(g);
    this.bubbles.draw(g, 0.85, v.groundY);
    this.confetti.draw(g, 0.9);
    g.imageSmoothingQuality = q;
    void stage;
  }
}

