/**
 * Christkindlmarkt – WorldRenderer.
 * Stimmungsbogen: Dämmerung am Rathausplatz → Marktgetümmel (blaue Stunde, alle Lichter) → Eistraum (Polarlicht, Glitzer) →
 * Schneesturm (Whiteout, Böen) → Krampuslauf (rote Glut, Fackeln, riesiger Krampus-Schatten).
 *
 * Ebenen: Himmel (0.02) · Ferne Stadt (0.06) · Fernschnee · Mittelgrund Markt/Eisbahn/Krampusmarkt (0.4) · Mittelschnee ·
 * Tannen (0.85) · Boden (1.0) · Entitäten · Nahschnee, Eisspur, Atem, Krampus, Funken, Lichterkette.
 */
import { PLAYER_SX } from "../../constants";
import type { AssetLoader, Ent, ViewState, WorldRenderer } from "../../types";
import { bigGlow, blitTiled, paint, type Ctx2D } from "../shared-b/canvas";
import { mod, mulberry, stageVal } from "../shared-b/color";
import { blitSpr, glowAt, makeGlows, sat, SpriteCache, sprPoint, TAU } from "./gfx";
import { LAYER_LIGHTS } from "./lights";
import { EMBERS, LIGHTS, NIGHT, REDGLOW, SKYLANTERN, SNOW, SPARKLE, VEIL, WIND } from "./look";
import { Backdrop, type StageView } from "./scenery";
import { drawWinterSkin, type SkinEnv } from "./skins";
import { MAX_STAGE } from "./stages";
import { Bits, drawBreath, drawEmbers, drawIceSpray, Footprints, Glitter, SkyLanterns, SnowField, WindStreaks } from "./weather";

export const WINTER_PROPS = [
  "winter-stall",
  "winter-snowman",
  "winter-presents",
  "winter-tree",
  "winter-sled",
  "winter-iceblock",
  "winter-candycane",
  "winter-icicles",
  "winter-snowball",
  "winter-kessel",
  "winter-krampus",
  "winter-elf",
  "winter-gingerbread",
  "winter-star",
  "winter-lantern",
  "lebkuchenherz",
];

/** Lichterkette am oberen Rand: 1 in Marktstufen, gedämpft im Sturm, aus im Krampuslauf */
const GARLAND = [1, 1, 1, 0.4, 0];
const STAGE_METERS = 300;
const NO_PROPS = { has: () => false, preload: async () => undefined, draw: () => false, cell: () => null };

interface Bulb {
  x: number;
  y: number;
  c: number;
}

export class WinterRenderer implements WorldRenderer {
  private readonly back = new Backdrop();
  private readonly glows = makeGlows();
  private readonly env: SkinEnv;
  private readonly snow = new SnowField();
  private readonly streaks = new WindStreaks();
  private readonly glitter = new Glitter();
  private readonly lanterns = new SkyLanterns();
  private readonly prints = new Footprints();
  private readonly embers = new Bits(90);
  private readonly spray = new Bits(48);
  private readonly breath = new Bits(10);
  private readonly rng = mulberry(4242);
  private readonly sv: { stage: number; blend: number } = { stage: 0, blend: 0 };
  private breathT = 0.4;
  private sprayT = 0;
  private emberT = 0;
  private garland: HTMLCanvasElement | null = null;
  private bulbs: Bulb[] = [];
  private underRed: HTMLCanvasElement | null = null;
  private underCyan: HTMLCanvasElement | null = null;
  private darkMass: HTMLCanvasElement | null = null;

  constructor() {
    this.env = { props: null, spr: new SpriteCache(NO_PROPS), glows: this.glows, s: 0, night: 0 };
  }

  async load(assets: AssetLoader): Promise<void> {
    this.env.props = assets.props;
    this.env.spr.props = assets.props;
    await Promise.all([this.back.load(assets), assets.props.preload(WINTER_PROPS)]);
  }

  resize(dpr: number): void {
    this.env.spr.reset(dpr);
  }

  private stageView(v: ViewState): StageView {
    const stage = Math.max(0, Math.min(MAX_STAGE, v.stage));
    this.sv.stage = stage;
    this.sv.blend = stage >= MAX_STAGE ? 0 : Math.max(0, Math.min(1, v.stageBlend));
    return this.sv;
  }

  // --- Update ----------------------------------------------------------------------------------------------

  update(dt: number, v: ViewState): void {
    const sv = this.stageView(v);
    const s = sv.stage + sv.blend;
    this.env.s = s;
    this.env.night = stageVal(NIGHT, s);
    const progress = sat((v.worldMeters - sv.stage * STAGE_METERS) / STAGE_METERS);
    this.back.prepare(sv.stage, progress);
    const gust = v.vars.gust ?? 0;
    const storm = stageVal(VEIL, s);
    this.snow.cool = sat(storm * 1.1);
    this.snow.update(dt, v, stageVal(SNOW, s), stageVal(WIND, s), gust);
    this.streaks.update(dt, v, storm * 0.8 + gust * 0.9);
    this.glitter.update(dt, v, stageVal(SPARKLE, s));
    this.lanterns.update(dt, v, stageVal(SKYLANTERN, s));
    this.prints.update(v.dist + PLAYER_SX, v.gravDir === 1 && Math.abs(v.playerFeetY - v.groundY) < 3, (v.vars.onIce ?? 0) > 0.3, v.quality);
    // Glut/Funkenflug der Fackeln (Krampuslauf)
    const em = stageVal(EMBERS, s);
    if (em > 0.02 && v.quality > 0) {
      this.emberT -= dt;
      if (this.emberT <= 0) {
        this.emberT = (0.07 + this.rng() * 0.08) / em / (v.quality === 1 ? 0.6 : 1);
        this.spawnEmber(v);
      }
    }
    this.embers.step(dt, v.speed, 0.4, -34, 0.4);
    // Eisspur unter den Füßen
    const onIce = v.vars.onIce ?? 0;
    const feet = v.playerFeetY;
    if (onIce > 0.4 && v.quality > 0 && !v.reducedMotion) {
      this.sprayT -= dt;
      if (this.sprayT <= 0) {
        this.sprayT = 0.022;
        const n = v.quality === 2 ? 2 : 1;
        for (let i = 0; i < n; i += 1) this.spray.add(PLAYER_SX - 22 + this.rng() * 14, feet - 2 - this.rng() * 5, -(30 + this.rng() * 150), -(20 + this.rng() * 110), 0.34 + this.rng() * 0.3, 1.4 + this.rng() * 1.6);
      }
    }
    this.spray.step(dt, v.speed, 0.92, 260, 0);
    // Atemwölkchen
    if (v.quality > 0) {
      this.breathT -= dt;
      if (this.breathT <= 0) {
        this.breathT = 0.55 + this.rng() * 0.25;
        const slide = (v.vars.pSlide ?? 0) > 0.5;
        this.breath.add(PLAYER_SX + 22, feet - (slide ? 54 : 128), -22, -26, 0.95, 7 + this.rng() * 3);
      }
    }
    this.breath.step(dt, v.speed, 0.7, 0, 0.9);
  }

  private spawnEmber(v: ViewState): void {
    const list = LAYER_LIGHTS["mid-krampus"];
    if (!list) return;
    const k = 0.8;
    const off = mod(v.dist * 0.4, 1792);
    for (let tries = 0; tries < 4; tries += 1) {
      const i = Math.floor(this.rng() * 26);
      let x = list[i * 3] * k - off;
      if (x < -50) x += 1792;
      if (x < 20 || x > 1260) continue;
      const y = list[i * 3 + 1] * k + 46;
      this.embers.add(x + (this.rng() - 0.5) * 8, y, (this.rng() - 0.5) * 50, -(50 + this.rng() * 90), 1.1 + this.rng() * 1.2, 2.4 + this.rng() * 2.6);
      return;
    }
  }

  // --- Hintergrund -----------------------------------------------------------------------------------------

  drawBackground(g: Ctx2D, v: ViewState): void {
    const sv = this.stageView(v);
    const s = sv.stage + sv.blend;
    const q = g.imageSmoothingQuality;
    g.imageSmoothingQuality = "low";
    g.fillStyle = "#0a1230";
    g.fillRect(0, 590, v.w, v.h - 590);
    this.back.drawSky(g, v.dist, sv, v.time, v.reducedMotion, v.quality);
    // rote Glut am Horizont (Krampuslauf)
    const rg = stageVal(REDGLOW, s);
    if (rg > 0.02) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = rg * (0.5 + (v.reducedMotion ? 0 : 0.08 * Math.sin(v.time * 1.7)));
      g.drawImage(this.getUnder("red"), -60, 380);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    this.lanterns.draw(g, this.glows, v.time, v.reducedMotion, stageVal(SKYLANTERN, s) > 0.02 ? 1 : 0, stageVal(REDGLOW, s));
    this.back.drawFar(g, v.dist, sv, v.time, v.reducedMotion, v.quality);
    this.snow.drawFine(g, this.glows, 0, 1);
    this.back.drawMid(g, v.dist, sv, v.time, v.reducedMotion, v.quality);
    this.snow.drawFine(g, this.glows, 1, 1);
    this.back.drawNear(g, v.dist, sv, v.time, v.reducedMotion, v.quality);
    this.back.drawVeil(g, sv);
    g.imageSmoothingQuality = q;
  }

  private getUnder(kind: "red" | "cyan"): HTMLCanvasElement {
    if (kind === "red") {
      this.underRed ??= bigGlow(1400, 300, [
        [0, "rgba(255,90,40,0.85)"],
        [0.5, "rgba(255,50,30,0.3)"],
        [1, "rgba(255,30,20,0)"],
      ]);
      return this.underRed;
    }
    this.underCyan ??= bigGlow(1400, 260, [
      [0, "rgba(120,220,255,0.7)"],
      [0.5, "rgba(80,180,255,0.22)"],
      [1, "rgba(60,140,255,0)"],
    ]);
    return this.underCyan;
  }

  // --- Boden -----------------------------------------------------------------------------------------------

  drawGround(g: Ctx2D, v: ViewState, pits: ReadonlyArray<{ x0: number; x1: number; skin: string }>): void {
    const sv = this.stageView(v);
    const q = g.imageSmoothingQuality;
    g.imageSmoothingQuality = "low";
    this.back.drawGround(g, v.dist, v.groundY, v.h, pits, sv, v.time, v.reducedMotion, v.quality);
    this.prints.draw(g, v.dist, v.groundY, pits);
    g.imageSmoothingQuality = q;
  }

  // --- Entitäten -------------------------------------------------------------------------------------------

  drawEntity(g: Ctx2D, e: Ent, sx: number, sy: number, v: ViewState): boolean {
    if (e.kind === "pit") return true;
    if (e.kind === "speedzone") {
      if (e.skin === "ice") this.back.drawIceZone(g, v.dist, v.groundY, sx, e.w, this.stageView(v), v.time, v.reducedMotion, v.quality, e.id);
      return true;
    }
    return drawWinterSkin(g, this.env, e, sx, sy, v);
  }

  // --- Vordergrund -----------------------------------------------------------------------------------------

  drawForeground(g: Ctx2D, v: ViewState): void {
    const sv = this.stageView(v);
    const s = sv.stage + sv.blend;
    const q = g.imageSmoothingQuality;
    g.imageSmoothingQuality = "low";
    if (v.quality > 0) {
      drawIceSpray(g, this.spray);
      drawBreath(g, this.glows, this.breath, 0.9);
    }
    this.drawKrampus(g, v);
    // Funken
    drawEmbers(g, this.glows, this.embers, 1);
    // Glitzer, Schnee, Windstreifen
    this.glitter.draw(g, this.glows, v.time, v.reducedMotion, 1);
    this.snow.drawNear(g, this.glows, 1);
    this.streaks.draw(g, 1);
    // Lichterkette oben
    this.drawGarland(g, v, GARLAND[Math.min(MAX_STAGE, sv.stage)] * (1 - sv.blend) + (sv.stage < MAX_STAGE ? GARLAND[sv.stage + 1] * sv.blend : 0), s);
    g.imageSmoothingQuality = q;
  }

  private buildGarland(): void {
    const W = 1024;
    const H = 96;
    const r = mulberry(555);
    this.bulbs = [];
    const bulbs = this.bulbs;
    this.garland = paint(W, H, (g) => {
      const swag = 256;
      // Kabel und Tannengrün
      for (let sIdx = 0; sIdx < W / swag; sIdx += 1) {
        const x0 = sIdx * swag;
        const pts: Array<[number, number]> = [];
        for (let i = 0; i <= 32; i += 1) {
          const u = i / 32;
          pts.push([x0 + u * swag, 8 + Math.sin(u * Math.PI) * 34]);
        }
        g.lineCap = "round";
        g.lineJoin = "round";
        g.strokeStyle = "#14201a";
        g.lineWidth = 3;
        g.beginPath();
        pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.stroke();
        // Tannenzweige
        for (let i = 0; i < 38; i += 1) {
          const u = (i + r() * 0.6) / 38;
          const x = x0 + u * swag;
          const y = 8 + Math.sin(u * Math.PI) * 34;
          g.strokeStyle = r() < 0.5 ? "#1c5a30" : "#2a7a3e";
          g.lineWidth = 3.2;
          const a = -0.5 + r() * 2.2;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + Math.cos(a) * 12, y + Math.sin(a) * 12 + 2);
          g.stroke();
        }
        // Glühbirnen
        for (let i = 1; i < 12; i += 1) {
          const u = i / 12;
          const x = x0 + u * swag;
          const y = 8 + Math.sin(u * Math.PI) * 34 + 8;
          bulbs.push({ x, y, c: (i + sIdx) % 5 });
        }
        // Schleife am Pfosten
        g.fillStyle = "#c81e2e";
        g.strokeStyle = "#5a0a12";
        g.lineWidth = 2;
        g.beginPath();
        g.ellipse(x0 - 7, 12, 8, 5, -0.5, 0, TAU);
        g.ellipse(x0 + 7, 12, 8, 5, 0.5, 0, TAU);
        g.fill();
        g.stroke();
        g.beginPath();
        g.arc(x0, 12, 3.2, 0, TAU);
        g.fill();
      }
      const cols = ["#ff5a5a", "#ffd23f", "#7dff9a", "#8fd3ff", "#ff9adc"];
      for (const b of bulbs) {
        g.fillStyle = cols[b.c];
        g.strokeStyle = "rgba(0,0,0,0.5)";
        g.lineWidth = 1;
        g.beginPath();
        g.ellipse(b.x, b.y, 3.2, 4.4, 0, 0, TAU);
        g.fill();
        g.stroke();
      }
    });
  }

  private drawGarland(g: Ctx2D, v: ViewState, alpha: number, s: number): void {
    if (alpha < 0.03) return;
    if (!this.garland) this.buildGarland();
    if (!this.garland) return;
    const scroll = v.dist * 1.15;
    g.globalAlpha = alpha * 0.95;
    blitTiled(g, this.garland, 1024, 96, scroll, -6);
    g.globalAlpha = 1;
    if (v.quality === 0) return;
    const lit = 0.55 + 0.45 * stageVal(LIGHTS, s);
    const off = mod(scroll, 1024);
    g.globalCompositeOperation = "lighter";
    const glowKeys = [this.glows.red, this.glows.gold, this.glows.green, this.glows.cyan, this.glows.warm];
    for (let rep = -1; rep < 2; rep += 1) {
      for (let i = 0; i < this.bulbs.length; i += 1) {
        const b = this.bulbs[i];
        const x = b.x + rep * 1024 - off;
        if (x < -20 || x > 1300) continue;
        const blink = v.reducedMotion ? 0.8 : 0.5 + 0.5 * Math.sin(v.time * 4.2 + (i % 2) * Math.PI + i * 0.35);
        g.globalAlpha = alpha * lit * (0.35 + 0.65 * blink);
        glowAt(g, glowKeys[b.c], x, b.y - 6, 9 + 4 * blink);
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  /** Krampus-Verfolgung: riesiger Schatten mit roten Augen am linken Rand (Vorderkante rückt mit dem Vorsprung vor) */
  private drawKrampus(g: Ctx2D, v: ViewState): void {
    const pres = v.vars.krampus ?? 0;
    const hit = v.vars.krampusHit ?? 0;
    if (pres < 0.02 && hit < 0.02) return;
    const gap = Math.min(v.vars.krampusGap ?? 99999, 1600);
    const t = v.time;
    const gy = v.groundY;
    // Vorsprung 0 px → der Krampus hat die Figur (Vorderkante bei x ≈ 340); ≈ 0.6 s Vorsprung → Krallen am linken Rand
    const front = 40 + PLAYER_SX - gap * 0.72;
    const surge = v.vars.krampusSurge ?? 0;
    // roter Nebel am linken Rand
    g.globalCompositeOperation = "lighter";
    const near = sat(1 - (gap - 100) / 700);
    g.globalAlpha = pres * (0.22 + 0.4 * near);
    glowAt(g, this.glows.softRed, 0, gy - 150, 380, 420);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    const h = 560;
    const spr = this.env.spr.get("winter-krampus", h, null, "foot", "silhouette", (c, s) => {
      c.globalCompositeOperation = "source-atop";
      c.fillStyle = "rgba(14,4,10,0.94)";
      c.fillRect(0, 0, s.c.width, s.c.height);
    });
    const bob = v.reducedMotion ? 0 : -Math.abs(Math.sin(t * 6.5)) * 16;
    let eyeX = -999;
    let eyeY = gy - 250;
    if (spr) {
      const cx = front + 60 - spr.w * 0.44;
      const foot = gy + 96 + bob;
      if (cx + spr.w / 2 > -20) {
        g.globalAlpha = sat(pres * 1.25) * 0.94;
        blitSpr(g, spr, cx, foot, { rot: v.reducedMotion ? 0 : Math.sin(t * 6.5) * 0.02 });
        g.globalAlpha = 1;
      }
      const eye = sprPoint(spr, cx, foot, 850, 335, false);
      eyeX = eye.x;
      eyeY = eye.y;
    }
    // Augen: an der Figur, sonst als Warn-Augen am linken Bildrand (gelb-weißer Kern, damit sie auf rotem Grund leuchten)
    g.globalCompositeOperation = "lighter";
    const pulse = 0.75 + 0.25 * Math.sin(t * 9);
    const a = sat(pres * 1.3) * pulse;
    if (eyeX > 46) {
      g.globalAlpha = a;
      glowAt(g, this.glows.red, eyeX, eyeY, 42);
      glowAt(g, this.glows.gold, eyeX, eyeY, 16);
      glowAt(g, this.glows.white, eyeX, eyeY, 6);
    } else if (pres > 0.05) {
      // dunkle Masse hinter den Augen, damit sie nicht wie Marktlichter wirken
      this.darkMass ??= bigGlow(300, 420, [
        [0, "rgba(10,2,8,0.92)"],
        [0.55, "rgba(10,2,8,0.6)"],
        [1, "rgba(10,2,8,0)"],
      ]);
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = sat(pres * 1.2) * (0.55 + 0.4 * sat(1 - (gap - 100) / 700));
      g.drawImage(this.darkMass, -150, gy - 460, 300, 420);
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = a;
      for (const ex of [34, 80]) {
        glowAt(g, this.glows.red, ex, gy - 250, 32);
        glowAt(g, this.glows.gold, ex, gy - 250, 14);
        glowAt(g, this.glows.white, ex, gy - 250, 6);
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    if (surge > 0.05 || hit > 0.02) {
      // Rutenhieb: rote Krallenstreifen
      const k = Math.max(hit, surge * 0.6);
      g.globalCompositeOperation = "lighter";
      g.strokeStyle = "#ff5a3a";
      g.lineCap = "round";
      g.globalAlpha = k * 0.85;
      g.lineWidth = 9 * k + 2;
      for (let i = 0; i < 3; i += 1) {
        g.beginPath();
        g.moveTo(40 + i * 40, gy - 420 + i * 26);
        g.quadraticCurveTo(220 + i * 40, gy - 290 + i * 40, 420 + i * 40, gy - 90 + i * 50);
        g.stroke();
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
  }

  // --- Overlay ---------------------------------------------------------------------------------------------

  drawOverlay(g: Ctx2D, v: ViewState): void {
    const sv = this.stageView(v);
    const s = sv.stage + sv.blend;
    if (v.quality === 0) return;
    const rg = stageVal(REDGLOW, s);
    if (rg > 0.05) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.09 * rg;
      g.drawImage(this.getUnder("red"), -60, 520);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    const ice = stageVal(SPARKLE, s);
    if (ice > 0.3 && v.quality > 1) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.06 * ice;
      g.drawImage(this.getUnder("cyan"), -60, 560);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
  }
}
