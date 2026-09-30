/**
 * Alpenpanorama – WorldRenderer. Stimmungsbogen: Almwiese am Morgen → Zirbenwald & Bergsee → Gipfelregion →
 * Hochplateau im Wind → Gletscher im Abendrot.
 *
 * Ebenen (hinten → vorne, Parallax): Himmel mit Sonne/Sternen (0) · Wolken (0.012) · gemalte Original-Kulisse (0.035)
 * · Hero-Gipfel `landmark-peak` (0.055) · Nebelband · ferne Waldhügel (0.1) · Seilbahn mit Gondeln (0.14)
 * · Almhänge mit Almhütte/Kapelle (0.2) · nahe Tannen (0.5) · Boden mit Schluchten (1.0) · Vordergrund-Gras (1.3)
 * + Wetter (Pollen, Blütenblätter, Schmetterlinge, Schnee, Windschlieren) + Lawine am linken Rand.
 * Performance: alle Ebenen pro Stufe vorgebacken (lazy, max. eine Kachel pro Frame), pro Frame nur 1:1-Blits.
 */
import { PLAYER_SX } from "../../constants";
import type { AssetLoader, Ent, PropLibrary, ViewState, WorldRenderer } from "../../types";
import { Motes } from "../shared-a/fx";
import { bigGlow, blitCentered, blitTiled, blitTiledRange, ctxOf, glowAt, paint, softSprite, solidSegments, type Ctx2D } from "../shared-b/canvas";
import { h1, mod, mulberry, stageVal } from "../shared-b/color";
import { StageCache, prepareStaged } from "../shared-b/layers";
import { AlpBackdrop, BACKDROP_H, bakeLandmark, propSprite, type LandmarkSet } from "./backdrop";
import { SnowField } from "./snow";
import {
  FAR_RIDGE,
  GROUND_TILE_H,
  GROUND_TILE_W,
  GROUND_TOP,
  MID_RIDGE,
  paintCanyon,
  paintCloud,
  paintFarHills,
  paintFarRange,
  paintForeGrass,
  paintGround,
  paintLake,
  paintMidHills,
  paintMist,
  paintNearTrees,
  paintPuff,
  paintRays,
  paintSky,
  mixHex,
  ridgeY,
  type RidgeSpec,
} from "./scenery";
import {
  drawBoulder,
  drawCairn,
  drawCargo,
  drawCow,
  drawCrag,
  drawCrate,
  drawCrumble,
  drawDeepSnow,
  drawEagle,
  drawEdelweiss,
  drawFence,
  drawGondola,
  drawIbex,
  drawIce,
  drawLedge,
  drawLogs,
  drawMarmot,
  drawPlank,
  drawRockfall,
  drawRoller,
  drawSummitCross,
  drawTrunk,
  drawUpdraft,
  makeSkinAssets,
  type SkinAssets,
  type SkinCtx,
} from "./skins";
import {
  BUTTERFLIES,
  CABLEWAY,
  CLOUD_DRIFT,
  CLOUD_SHADOWS,
  CLOUDS,
  GLOW,
  LAKE,
  MAX_STAGE,
  MIST,
  POLLEN,
  RAYS,
  SNOW,
  SNOWCOVER,
  STAGE_PAL,
  SUN_R,
  SUN_X,
  SUN_Y,
  WIND,
} from "./stages";

const TAU = Math.PI * 2;
const CLOUD_SCALE = [1, 0.72, 1.25, 0.6, 0.9, 1.1];

export const ALPEN_PROPS = [
  "boulder",
  "cow",
  "eagle-fly",
  "edelweiss",
  "gondola",
  "ibex-run",
  "wood-fence",
  "landmark-peak",
  "landmark-chalet",
  "landmark-church",
  "landmark-castle",
  "alpen-cairn",
  "alpen-logs",
  "alpen-trunk",
  "alpen-marmot",
  "alpen-cargo",
  "alpen-rollstone",
  "alpen-snowball",
];

// Ebenen-Geometrie
const BACK_Y = 40;
const BACK_PAR = 0.035;
const FAR_Y = 366;
const FAR_PAR = 0.1;
const MID_Y = 376;
const MID_PAR = 0.2;
const NEAR_Y = 250;
const NEAR_PAR = 0.5;
const PEAK_PAR = 0.055;
const CABLE_PAR = 0.14;
const FORE_PAR = 1.3;

/** Sichtbarkeit der Landmarken je Stufe */
const PEAK_VIS = [0, 0, 0, 1, 1];
const CHALET_VIS = [1, 1, 0.8, 0.45, 0.3];
const CHURCH_VIS = [1, 1, 0.6, 0, 0];
const CASTLE_VIS = [0, 0.9, 0.8, 0, 0];
const BIRDS = [1, 0.8, 0.3, 0, 0];
const EAGLES = [0, 0.3, 1, 0.8, 0.3];

interface Butterfly {
  x: number;
  y: number;
  ph: number;
  c: number;
  s: number;
}

const BF_COLORS = ["#ffd23f", "#ff8c42", "#7ec8ff", "#ffffff", "#c79bff"];

export class AlpenRenderer implements WorldRenderer {
  private ready = false;
  private props: PropLibrary | null = null;
  private A!: SkinAssets;
  private backdrop = new AlpBackdrop();
  private sky!: StageCache;
  private farRange!: StageCache;
  private far!: StageCache;
  private mid!: StageCache;
  private near!: StageCache;
  private ground!: StageCache;
  private staged: StageCache[] = [];
  private canyonRock!: HTMLCanvasElement;
  private canyonIce!: HTMLCanvasElement;
  private clouds: HTMLCanvasElement[] = [];
  private cloudsWarm: HTMLCanvasElement[] = [];
  private mist!: HTMLCanvasElement;
  private mistBand!: StageCache;
  private lowHaze!: StageCache;
  private lake!: HTMLCanvasElement;
  private rays!: HTMLCanvasElement;
  private sunGlow!: HTMLCanvasElement;
  private sunBloom!: HTMLCanvasElement;
  private warmFoot!: HTMLCanvasElement;
  private glowWarm!: HTMLCanvasElement;
  private glowWhite!: HTMLCanvasElement;
  private smoke!: HTMLCanvasElement;
  private shade!: HTMLCanvasElement;
  private buf: HTMLCanvasElement | null = null;
  private bufG: Ctx2D | null = null;
  private puffs: HTMLCanvasElement[] = [];
  private foreGrass: HTMLCanvasElement[] = [];
  private foreSnow: HTMLCanvasElement[] = [];
  private peak: LandmarkSet | null = null;
  private peakFlip: LandmarkSet | null = null;
  private chalet: LandmarkSet | null = null;
  private church: LandmarkSet | null = null;
  private castle: LandmarkSet | null = null;
  private cabin: HTMLCanvasElement | null = null;

  private motes = new Motes(260);
  private pollenT = 0;
  private petalT = 0;
  private snowField = new SnowField();
  private snowAmt = 0;
  private butterflies: Butterfly[] = [];
  private streaks = new Float32Array(24 * 4);
  private rng = mulberry(4711);
  private skin: SkinCtx = { s: 0, snow: 0, glow: 0, time: 0, reduced: false, quality: 2, groundY: 590 };

  async load(assets: AssetLoader): Promise<void> {
    this.props = assets.props;
    await Promise.all([assets.props.preload(ALPEN_PROPS).catch(() => undefined), this.backdrop.load(assets).catch(() => undefined)]);
    this.build();
    // Stufe 0 (und die Landmarken) vorbacken, damit der erste Frame ruckelfrei ist
    for (const s of this.staged) {
      s.get(0);
      await Promise.resolve();
    }
    this.backdrop.stages?.get(1);
  }

  private build(): void {
    if (this.ready) return;
    const P = this.props;
    this.A = makeSkinAssets(P);
    this.sky = new StageCache((s) => paintSky(s));
    this.farRange = new StageCache((s) => paintFarRange(s));
    this.far = new StageCache((s) => paintFarHills(s));
    this.mid = new StageCache((s) => paintMidHills(s));
    this.near = new StageCache((s) => paintNearTrees(s));
    this.ground = new StageCache((s) => paintGround(s));
    this.staged = [this.sky, this.far, this.mid, this.near, this.ground];
    const bst = this.backdrop.stages;
    if (bst) this.staged.push(bst);
    else this.staged.push(this.farRange);
    if (P) {
      this.peak = bakeLandmark(P, "landmark-peak", 400, 0.42);
      this.peakFlip = bakeLandmark(P, "landmark-peak", 330, 0.5, true);
      this.chalet = bakeLandmark(P, "landmark-chalet", 74, 0.18);
      this.church = bakeLandmark(P, "landmark-church", 96, 0.2);
      this.castle = bakeLandmark(P, "landmark-castle", 150, 0.42);
      this.cabin = propSprite(P, "gondola", 58);
      for (const L of [this.peak, this.peakFlip, this.chalet, this.church, this.castle]) if (L) this.staged.push(L.stages);
    }
    this.canyonRock = paintCanyon(false);
    this.canyonIce = paintCanyon(true);
    for (let i = 0; i < 6; i += 1) {
      const sc = CLOUD_SCALE[i];
      this.clouds.push(paintCloud((i % 3) + 1, Math.round(420 * sc), Math.round(150 * sc), false));
      this.cloudsWarm.push(paintCloud((i % 3) + 1, Math.round(420 * sc), Math.round(150 * sc), true));
    }
    this.mist = paintMist(1400, 120, "rgba(255,255,255,0.9)");
    this.mistBand = new StageCache((st) =>
      paint(1400, 150, (mg) => {
        const hz = STAGE_PAL[st].haze;
        const band = mg.createLinearGradient(0, 0, 0, 140);
        band.addColorStop(0, hexA(hz, 0));
        band.addColorStop(0.6, hexA(hz, 0.35 + MIST[st] * 0.3));
        band.addColorStop(1, hexA(hz, 0.2));
        mg.fillStyle = band;
        mg.fillRect(0, 0, 1400, 140);
        mg.globalAlpha = MIST[st] * 0.8;
        mg.drawImage(this.mist, 0, 30);
      }),
    );
    this.lake = paintLake();
    this.lowHaze = new StageCache((st) =>
      paint(1280, 72, (lg) => {
        const low = lg.createLinearGradient(0, 0, 0, 72);
        low.addColorStop(0, hexA(STAGE_PAL[st].haze, 0));
        low.addColorStop(1, hexA(STAGE_PAL[st].haze, 0.28));
        lg.fillStyle = low;
        lg.fillRect(0, 0, 1280, 72);
      }),
    );
    this.staged.push(this.mistBand, this.lowHaze);
    this.rays = paintRays(1100, 600, 1060, 40, 3);
    this.sunGlow = bigGlow(520, 520, [
      [0, "rgba(255,250,230,1)"],
      [0.1, "rgba(255,240,200,0.75)"],
      [0.35, "rgba(255,220,160,0.25)"],
      [1, "rgba(255,200,140,0)"],
    ]);
    this.sunBloom = bigGlow(720, 460, [
      [0, "rgba(255,230,180,0.8)"],
      [0.5, "rgba(255,200,150,0.22)"],
      [1, "rgba(255,180,120,0)"],
    ]);
    this.glowWarm = softSprite("rgba(255,200,120,1)");
    this.warmFoot = paint(1280, 200, (wg) => {
      const bot = wg.createLinearGradient(0, 0, 0, 200);
      bot.addColorStop(0, "rgba(255,120,80,0)");
      bot.addColorStop(1, "rgba(255,120,80,0.14)");
      wg.fillStyle = bot;
      wg.fillRect(0, 0, 1280, 200);
    });
    this.glowWhite = softSprite("rgba(255,255,255,1)");
    this.smoke = softSprite("rgba(236,238,242,0.8)");
    this.shade = softSprite("rgba(16,40,44,1)");
    this.puffs = [paintPuff(1), paintPuff(2), paintPuff(3)];
    this.foreGrass = [paintForeGrass(1, false), paintForeGrass(2, false)];
    this.foreSnow = [paintForeGrass(1, true), paintForeGrass(2, true)];
    for (let i = 0; i < 6; i += 1) {
      this.butterflies.push({ x: this.rng() * 1400, y: 380 + this.rng() * 170, ph: this.rng() * TAU, c: i % BF_COLORS.length, s: 0.8 + this.rng() * 0.5 });
    }
    for (let i = 0; i < 24; i += 1) this.resetStreak(i, true);
    this.ready = true;
  }

  private resetStreak(i: number, anywhere: boolean): void {
    const o = i * 4;
    this.streaks[o] = anywhere ? this.rng() * 1400 : 1300 + this.rng() * 300;
    this.streaks[o + 1] = 60 + this.rng() * 500;
    this.streaks[o + 2] = 60 + this.rng() * 160;
    this.streaks[o + 3] = 900 + this.rng() * 900;
  }

  // ------------------------------------------------------------------------------------------------------

  update(dt: number, v: ViewState): void {
    if (!this.ready) return;
    const d = Math.min(0.05, dt);
    prepareStaged(this.staged, v.stage, MAX_STAGE, 1);
    const s = v.stage + v.stageBlend;
    const q = v.quality === 0 ? 0.35 : v.quality === 1 ? 0.7 : 1;
    const wind = stageVal(WIND, s);
    // Pollen im Gegenlicht
    this.pollenT -= d * stageVal(POLLEN, s) * 16 * q;
    while (this.pollenT < 0) {
      this.pollenT += 1;
      this.motes.spawn("dust", Math.random() * 1400, 160 + Math.random() * 420, -10 + Math.random() * 20, -12 + Math.random() * 18, 4 + Math.random() * 4, 1.6 + Math.random() * 1.8, 0.5 + Math.random() * 0.5);
    }
    // Blütenblätter (Almwiese)
    this.petalT -= d * stageVal(BUTTERFLIES, s) * 2.5 * q;
    while (this.petalT < 0) {
      this.petalT += 1;
      this.motes.spawn("petal", 1300 + Math.random() * 100, 250 + Math.random() * 300, -80 - Math.random() * 60, 10 + Math.random() * 20, 9, 3 + Math.random() * 2, 0.7);
    }
    // Schnee
    const snow = stageVal(SNOW, s) * (0.7 + 0.3 * v.intensity);
    this.snowField.update(d, snow, wind, v.reducedMotion ? v.speed * 0.5 : v.speed, v.time, v.quality);
    this.snowAmt = snow;
    this.motes.update(d, v.reducedMotion ? v.speed * 0.5 : v.speed, -wind * 60, v.time);
    // Schmetterlinge
    const bf = stageVal(BUTTERFLIES, s);
    if (bf > 0.02) {
      for (const b of this.butterflies) {
        b.x -= v.speed * 0.85 * d + Math.sin(v.time * 0.8 + b.ph) * 20 * d;
        b.y += Math.sin(v.time * 1.7 + b.ph * 2) * 22 * d;
        if (b.x < -40) {
          b.x = 1320 + this.rng() * 400;
          b.y = 380 + this.rng() * 170;
        }
      }
    }
    // Windschlieren
    if (wind > 0.3) {
      for (let i = 0; i < 24; i += 1) {
        const o = i * 4;
        this.streaks[o] -= (this.streaks[o + 3] + v.speed * 0.6) * d;
        if (this.streaks[o] + this.streaks[o + 2] < -20) this.resetStreak(i, false);
      }
    }
    // Skin-Kontext
    this.skin.s = s;
    this.skin.snow = stageVal(SNOWCOVER, s);
    this.skin.glow = stageVal(GLOW, s);
    this.skin.time = v.time;
    this.skin.reduced = v.reducedMotion;
    this.skin.quality = v.quality;
    this.skin.groundY = v.groundY;
  }

  // ------------------------------------------------------------------------------------------------------

  drawBackground(g: Ctx2D, v: ViewState): void {
    this.withAlpha(g, (c) => this.renderBackground(c, v));
  }

  /**
   * Beim Tor-Übergang (Tour) zeichnet die Engine die Zielwelt mit globalAlpha < 1 über die alte. Unsere Ebenen setzen
   * globalAlpha intern selbst – deshalb in diesem Fall in einen Zwischenpuffer zeichnen und diesen mit Alpha blitten.
   */
  private withAlpha(g: Ctx2D, fn: (c: Ctx2D) => void): void {
    const a = g.globalAlpha;
    if (a >= 0.999) {
      fn(g);
      return;
    }
    if (a <= 0.001) return;
    if (!this.buf) {
      this.buf = paint(1280, 720, () => undefined);
      this.bufG = ctxOf(this.buf);
    }
    const bg = this.bufG as Ctx2D;
    bg.setTransform(1, 0, 0, 1, 0, 0);
    bg.globalAlpha = 1;
    bg.globalCompositeOperation = "source-over";
    bg.clearRect(0, 0, 1280, 720);
    fn(bg);
    g.drawImage(this.buf, 0, 0);
  }

  private renderBackground(g: Ctx2D, v: ViewState): void {
    this.build();
    const st = v.stage;
    const bl = v.stageBlend;
    const s = st + bl;
    const W = v.w;
    const q = g.imageSmoothingQuality;
    g.imageSmoothingQuality = "low";
    const rumble = v.reducedMotion ? 0 : (v.vars.avalancheRumble ?? 0) * (v.vars.avalanche ?? 0);
    const jx = rumble > 0.05 ? Math.sin(v.time * 41) * rumble * 1.6 : 0;
    const jy = rumble > 0.05 ? Math.sin(v.time * 53 + 1) * rumble * 1.2 : 0;
    // 1) Himmel (vorgebacken). Mit Kulisse genügt der obere Teil.
    const rows = this.backdrop.ready ? BACK_Y + 150 : 600;
    this.blitRows(g, this.sky.get(st), rows, 1);
    if (bl > 0.004 && st < MAX_STAGE) this.blitRows(g, this.sky.get(st + 1), rows, bl);
    if (!this.backdrop.ready) {
      g.fillStyle = STAGE_PAL[st].low;
      g.fillRect(0, 600, W, v.h - 600);
    }
    // 2) Sonne (hinter den Bergen)
    const sunX = stageVal(SUN_X, s);
    const sunY = stageVal(SUN_Y, s);
    const sunR = stageVal(SUN_R, s);
    const glow = stageVal(GLOW, s);
    g.fillStyle = glow > 0.5 ? "#ffd9a0" : "#fffbe8";
    g.beginPath();
    g.arc(sunX, sunY, sunR, 0, TAU);
    g.fill();
    // 3) Wolken (hinter den Gipfeln)
    this.drawClouds(g, v, s, glow, false);
    // Vögel am Himmel
    this.drawBirds(g, v, s);

    g.save();
    if (jx || jy) g.translate(jx, jy);
    // 4) Gemalte Fernkulisse
    if (this.backdrop.ready) {
      const scroll = v.dist * BACK_PAR;
      this.backdrop.draw(g, st, scroll, BACK_Y);
      if (bl > 0.004 && st < MAX_STAGE) this.backdrop.draw(g, st + 1, scroll, BACK_Y, bl);
    } else {
      this.drawStagedTile(g, this.farRange, v, 2048, 420, v.dist * BACK_PAR, BACK_Y + 20);
    }
    // Sockel unter der Kulisse (in Senken zwischen den Hügelkämmen sonst unbemalt)
    g.fillStyle = this.baseFill(st);
    g.fillRect(0, BACK_Y + BACKDROP_H - 2, W, 600 - (BACK_Y + BACKDROP_H - 2));
    if (bl > 0.004 && st < MAX_STAGE) {
      g.globalAlpha = bl;
      g.fillStyle = this.baseFill(st + 1);
      g.fillRect(0, BACK_Y + BACKDROP_H - 2, W, 600 - (BACK_Y + BACKDROP_H - 2));
      g.globalAlpha = 1;
    }

    // Sonnen-Glanz über den (ausgeblendeten) Gipfeln
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.75 * (1 - glow * 0.5);
    glowAt(g, this.sunGlow, sunX, sunY, sunR * 4.2);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";

    // 5) Abendsonne glüht über die Grate, Lichtstrahlen
    if (glow > 0.3) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = (glow - 0.3) * 0.9;
      blitCentered(g, this.sunBloom, sunX, sunY - 40);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    const rays = stageVal(RAYS, s);
    if (rays > 0.05 && v.quality === 2) {
      const pulse = v.reducedMotion ? 0.8 : 0.72 + 0.28 * Math.sin(v.time * 0.35);
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = rays * pulse;
      g.drawImage(this.rays, Math.round(sunX - 1060), Math.round(sunY - 40));
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    // 6) Hero-Gipfel
    this.drawPeaks(g, v, s);
    // 7) Nebelband an der Kulissen-Basis (vorgebacken je Stufe, Schwaden driften)
    this.drawStagedTile(g, this.mistBand, v, 1400, 150, v.dist * 0.06 + (v.reducedMotion ? 0 : v.time * 6), 330);
    // 8) Ferne Waldhügel (+ Burgruine)
    this.drawStagedTile(g, this.far, v, 2048, 230, v.dist * FAR_PAR, FAR_Y);
    this.drawLandmarkOnRidge(g, v, this.castle, CASTLE_VIS, FAR_PAR, FAR_Y, FAR_RIDGE, 5200, 900, 10);
    // Bergsee zwischen fernen Hügeln und Almhängen
    const lake = stageVal(LAKE, s);
    if (lake > 0.02) this.drawLake(g, v, lake);
    // 9) Seilbahn
    const cw = stageVal(CABLEWAY, s);
    if (cw > 0.05) this.drawCableway(g, v, cw);
    // 10) Almhänge + Almhütten/Kapelle
    this.drawStagedTile(g, this.mid, v, 2048, 250, v.dist * MID_PAR, MID_Y);
    this.drawLandmarkOnRidge(g, v, this.church, CHURCH_VIS, MID_PAR, MID_Y, MID_RIDGE, 3700, 2300, 8);
    this.drawLandmarkOnRidge(g, v, this.chalet, CHALET_VIS, MID_PAR, MID_Y, MID_RIDGE, 2300, 700, 12, true);
    this.drawCloudShadows(g, v, s);
    g.restore();
    // 11) Nahe Tannen
    this.drawStagedTile(g, this.near, v, 2048, 360, v.dist * NEAR_PAR, NEAR_Y);
    // bodennaher Dunst vor dem Waldrand (vorgebacken je Stufe)
    g.drawImage(this.lowHaze.get(st), 0, 520);
    if (bl > 0.004 && st < MAX_STAGE) {
      g.globalAlpha = bl;
      g.drawImage(this.lowHaze.get(st + 1), 0, 520);
      g.globalAlpha = 1;
    }
    g.imageSmoothingQuality = q;
  }

  private baseFills: string[] = [];
  private baseFill(st: number): string {
    let c = this.baseFills[st];
    if (!c) {
      const P = STAGE_PAL[st];
      c = mixHex(P.haze, mixHex(P.grassDark, "#b9c9da", SNOWCOVER[st] * 0.8), 0.45);
      this.baseFills[st] = c;
    }
    return c;
  }

  private blitRows(g: Ctx2D, c: HTMLCanvasElement, rows: number, a: number): void {
    const pa = g.globalAlpha;
    g.globalAlpha = pa * a;
    g.drawImage(c, 0, 0, 1280, rows, 0, 0, 1280, rows);
    g.globalAlpha = pa;
  }

  private drawStagedTile(g: Ctx2D, cache: StageCache, v: ViewState, w: number, h: number, scroll: number, y: number): void {
    const st = v.stage;
    blitTiled(g, cache.get(st), w, h, scroll, y);
    if (v.stageBlend > 0.004 && st < MAX_STAGE) {
      const pa = g.globalAlpha;
      g.globalAlpha = pa * v.stageBlend;
      blitTiled(g, cache.get(st + 1), w, h, scroll, y);
      g.globalAlpha = pa;
    }
  }

  private drawStagedSprite(g: Ctx2D, L: LandmarkSet, v: ViewState, x: number, bottom: number, alpha: number): void {
    const st = v.stage;
    const pa = g.globalAlpha;
    const xx = Math.round(x - L.w / 2);
    const yy = Math.round(bottom - L.h);
    g.globalAlpha = pa * alpha;
    g.drawImage(L.stages.get(st), xx, yy);
    if (v.stageBlend > 0.004 && st < MAX_STAGE) {
      g.globalAlpha = pa * alpha * v.stageBlend;
      g.drawImage(L.stages.get(st + 1), xx, yy);
    }
    g.globalAlpha = pa;
  }

  private drawClouds(g: Ctx2D, v: ViewState, s: number, glow: number, low: boolean): void {
    const amt = stageVal(CLOUDS, s);
    if (amt < 0.02) return;
    const drift = stageVal(CLOUD_DRIFT, s);
    const n = Math.round(3 + amt * 4);
    for (let i = 0; i < n; i += 1) {
      const par = 0.008 + h1(i + 3) * 0.012;
      const span = 1900;
      const idx = i % 6;
      const spr = this.clouds[idx];
      const x = Math.round(mod(h1(i) * span - v.dist * par - v.time * drift * (0.6 + h1(i + 9) * 0.8), span) - 420);
      if (x > 1300) continue;
      const y = Math.round((low ? 250 : 18) + h1(i + 20) * (low ? 90 : 150));
      const a = Math.min(1, amt * 1.2) * (0.75 + h1(i + 60) * 0.25);
      if (glow < 0.98) {
        g.globalAlpha = a * (1 - glow);
        g.drawImage(spr, x, y);
      }
      if (glow > 0.02) {
        g.globalAlpha = a * glow;
        g.drawImage(this.cloudsWarm[idx], x, y);
      }
    }
    g.globalAlpha = 1;
  }

  private drawBirds(g: Ctx2D, v: ViewState, s: number): void {
    const b = stageVal(BIRDS, s);
    const eg = stageVal(EAGLES, s);
    if (b > 0.05) {
      // kleiner Vogelschwarm (V-Formation), zieht langsam über den Himmel
      const span = 2600;
      const fx = mod(-v.time * 38 - v.dist * 0.02, span) - 300;
      const fy = 120 + Math.sin(v.time * 0.2) * 20;
      g.strokeStyle = `rgba(40,50,70,${(0.55 * b).toFixed(3)})`;
      g.lineWidth = 1.6;
      g.beginPath();
      for (let i = 0; i < 7; i += 1) {
        const row = Math.ceil(i / 2);
        const side = i % 2 ? 1 : -1;
        const x = fx + row * 16;
        const y = fy + row * 9 * side;
        const f = v.reducedMotion ? 0.5 : Math.sin(v.time * 9 + i);
        g.moveTo(x - 6, y - 2 * f);
        g.lineTo(x, y + 1);
        g.lineTo(x + 6, y - 2 * f);
      }
      g.stroke();
    }
    if (eg > 0.05) {
      // ferne Adler kreisen in der Thermik
      for (let k = 0; k < 2; k += 1) {
        const cx = mod(400 + k * 700 - v.dist * 0.03, 1700) - 200;
        const a = v.time * (0.35 + k * 0.1) + k * 2;
        const x = cx + Math.cos(a) * 70;
        const y = 150 + k * 40 + Math.sin(a) * 26;
        g.strokeStyle = `rgba(35,30,30,${(0.6 * eg).toFixed(3)})`;
        g.lineWidth = 2.2;
        g.beginPath();
        g.moveTo(x - 14, y - 3);
        g.quadraticCurveTo(x - 6, y - 6, x, y);
        g.quadraticCurveTo(x + 6, y - 6, x + 14, y - 3);
        g.stroke();
      }
    }
  }

  private drawPeaks(g: Ctx2D, v: ViewState, s: number): void {
    const vis = stageVal(PEAK_VIS, s);
    if (vis < 0.02) return;
    const scroll = v.dist * PEAK_PAR;
    const period = 2300;
    const k0 = Math.floor((scroll - 800) / period);
    for (let k = k0; k <= k0 + 2; k += 1) {
      const flip = h1(k * 3.3) < 0.5;
      const L = flip ? this.peakFlip : this.peak;
      if (!L) continue;
      const x = k * period + 500 + h1(k) * 900 - scroll;
      if (x < -L.w || x > v.w + L.w) continue;
      this.drawStagedSprite(g, L, v, x, 486 + h1(k + 7) * 20, vis);
    }
  }

  private drawLandmarkOnRidge(g: Ctx2D, v: ViewState, L: LandmarkSet | null, visTab: number[], par: number, layerY: number, R: RidgeSpec, period: number, offset: number, sink: number, smoke = false): void {
    if (!L) return;
    const vis = stageVal(visTab, v.stage + v.stageBlend);
    if (vis < 0.02) return;
    const scroll = v.dist * par;
    const k0 = Math.floor((scroll - offset - L.w) / period);
    for (let k = k0; k <= k0 + 2; k += 1) {
      const lx = k * period + offset + h1(k * 1.7 + offset) * period * 0.3;
      const x = lx - scroll;
      if (x < -L.w || x > v.w + L.w) continue;
      const ry = ridgeY(R, mod(lx, R.W));
      const bottom = layerY + ry + sink;
      this.drawStagedSprite(g, L, v, x, bottom, vis);
      if (smoke && v.quality > 0) {
        // Rauch aus dem Kamin
        const cx = x - L.w * 0.14;
        const cy = bottom - L.h * 0.98;
        for (let p = 0; p < 4; p += 1) {
          const life = (v.time * 0.22 + p / 4) % 1;
          const sz = 8 + life * 34;
          g.globalAlpha = vis * (1 - life) * Math.min(1, life * 5) * 0.55;
          g.drawImage(this.smoke, cx - sz / 2 + life * 30, cy - life * 70 - sz / 2, sz, sz);
        }
        g.globalAlpha = 1;
      }
      if (smoke && stageVal(GLOW, v.stage + v.stageBlend) > 0.4) {
        // Fensterlicht in der Abenddämmerung
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = vis * 0.6;
        glowAt(g, this.glowWarm, x - L.w * 0.1, bottom - L.h * 0.45, 16, 10);
        glowAt(g, this.glowWarm, x + L.w * 0.18, bottom - L.h * 0.3, 14, 9);
        g.globalAlpha = 1;
        g.globalCompositeOperation = "source-over";
      }
    }
  }

  /** Bergsee: Wasserstreifen mit Ufer-Spiegelung und glitzernden Lichtreflexen. */
  private drawLake(g: Ctx2D, v: ViewState, a: number): void {
    const y = 450;
    const scroll = v.dist * 0.13;
    g.globalAlpha = a;
    blitTiled(g, this.lake, 2048, 56, scroll, y);
    // Sonnenglitzern
    g.globalCompositeOperation = "lighter";
    const sunX = stageVal(SUN_X, v.stage + v.stageBlend);
    for (let i = 0; i < 26; i += 1) {
      const x = mod(h1(i * 3.1) * 1500 - scroll * 1.0, 1500) - 100;
      const tw = v.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(v.time * (2 + h1(i) * 3) + i);
      const near = 1 - Math.min(1, Math.abs(x - sunX) / 700);
      g.globalAlpha = a * tw * (0.25 + 0.75 * near);
      g.fillStyle = "#fffbe6";
      g.fillRect(x, y + 16 + h1(i + 5) * 34, 6 + h1(i + 9) * 16, 1.6);
    }
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
  }

  /** Seilbahn im Mittelgrund: Stützen, Tragseil, fahrende Kabinen (Prop `gondola`). */
  private drawCableway(g: Ctx2D, v: ViewState, alpha: number): void {
    const scroll = v.dist * CABLE_PAR;
    const period = 3400;
    const k0 = Math.floor((scroll - 1600) / period);
    g.save();
    g.globalAlpha = alpha;
    for (let k = k0; k <= k0 + 1; k += 1) {
      const x0 = k * period + 200 - scroll;
      const x1 = x0 + 1500;
      if (x1 < -50 || x0 > v.w + 50) continue;
      const y0 = 470;
      const y1 = 230;
      const yAt = (x: number): number => y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
      // Stützen
      for (const u of [0.02, 0.36, 0.7, 0.98]) {
        const px = x0 + (x1 - x0) * u;
        const top = yAt(px) - 10;
        const base = Math.max(top + 40, 500 - u * 30);
        g.strokeStyle = "rgba(70,78,92,0.9)";
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(px - 7, base);
        g.lineTo(px - 2, top);
        g.moveTo(px + 7, base);
        g.lineTo(px + 2, top);
        for (let yy = top + 10; yy < base; yy += 12) {
          g.moveTo(px - 2 - ((yy - top) / (base - top)) * 5, yy);
          g.lineTo(px + 2 + ((yy + 12 - top) / (base - top)) * 5, yy + 12);
        }
        g.moveTo(px - 12, top);
        g.lineTo(px + 12, top);
        g.stroke();
      }
      // Seile
      g.strokeStyle = "rgba(30,34,42,0.85)";
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(x0, yAt(x0) - 8);
      g.lineTo(x1, yAt(x1) - 8);
      g.moveTo(x0, yAt(x0) - 4);
      g.lineTo(x1, yAt(x1) - 4);
      g.stroke();
      // Kabinen
      for (let c = 0; c < 3; c += 1) {
        const u = mod(v.time * 0.028 + c / 3 + k * 0.17, 1);
        const cx = x0 + (x1 - x0) * u;
        const cy = yAt(cx) - 8;
        if (this.cabin) g.drawImage(this.cabin, Math.round(cx - this.cabin.width / 2), Math.round(cy - 6));
        else {
          g.fillStyle = "#e0561a";
          g.fillRect(cx - 9, cy + 22, 18, 16);
          g.strokeStyle = "#333";
          g.beginPath();
          g.moveTo(cx, cy);
          g.lineTo(cx, cy + 22);
          g.stroke();
        }
      }
    }
    g.restore();
  }

  /** Wolkenschatten ziehen über die Almhänge */
  private drawCloudShadows(g: Ctx2D, v: ViewState, s: number): void {
    const cs = stageVal(CLOUD_SHADOWS, s);
    if (cs < 0.05 || v.quality === 0) return;
    const drift = stageVal(CLOUD_DRIFT, s);
    for (let i = 0; i < 3; i += 1) {
      const span = 2400;
      const x = mod(h1(i + 90) * span - v.dist * 0.2 - v.time * drift * 2.2, span) - 400;
      if (x > 1400) continue;
      g.globalAlpha = cs * 0.3;
      g.drawImage(this.shade, x, 450 + h1(i) * 40, 520, 80);
    }
    g.globalAlpha = 1;
  }

  // ------------------------------------------------------------------------------------------------------

  drawGround(g: Ctx2D, v: ViewState, pits: ReadonlyArray<{ x0: number; x1: number; skin: string }>): void {
    this.withAlpha(g, (c) => this.renderGround(c, v, pits));
  }

  private renderGround(g: Ctx2D, v: ViewState, pits: ReadonlyArray<{ x0: number; x1: number; skin: string }>): void {
    this.build();
    const st = v.stage;
    const bl = v.stageBlend;
    const s = st + bl;
    const gy = v.groundY;
    const q = g.imageSmoothingQuality;
    g.imageSmoothingQuality = "low";
    const snow = stageVal(SNOWCOVER, s);
    for (const p of pits) this.drawGorge(g, v, p.x0, p.x1, snow);
    const segs = solidSegments(pits, v.w);
    const gA = this.ground.get(st);
    const gB = bl > 0.004 && st < MAX_STAGE ? this.ground.get(st + 1) : null;
    const y = gy - GROUND_TOP;
    for (const sg of segs) {
      const a = Math.max(-2, sg.x0);
      const b = Math.min(v.w + 2, sg.x1);
      if (b <= a) continue;
      blitTiledRange(g, gA, GROUND_TILE_W, GROUND_TILE_H, v.dist, a, b, y);
      if (gB) {
        g.globalAlpha = bl;
        blitTiledRange(g, gB, GROUND_TILE_W, GROUND_TILE_H, v.dist, a, b, y);
        g.globalAlpha = 1;
      }
      // Abbruchkanten zur Schlucht
      if (sg.x0 > -30) this.drawCliffEdge(g, v, sg.x0, 1, snow);
      if (sg.x1 < v.w + 30) this.drawCliffEdge(g, v, sg.x1, -1, snow);
    }
    g.imageSmoothingQuality = q;
  }

  private drawGorge(g: Ctx2D, v: ViewState, x0r: number, x1r: number, snow: number): void {
    const gy = v.groundY;
    const x0 = Math.round(Math.max(-20, x0r));
    const x1 = Math.round(Math.min(v.w + 20, x1r));
    if (x1 <= x0) return;
    const H = v.h - gy;
    const ice = snow > 0.75 ? Math.min(1, (snow - 0.75) / 0.2) : 0;
    // gegenüberliegende Schluchtwand (Parallax → Tiefe)
    const wallScroll = v.dist * 0.82;
    if (ice < 1) blitTiledRange(g, this.canyonRock, 512, 170, wallScroll, x0, x1, gy);
    if (ice > 0) {
      g.globalAlpha = ice;
      blitTiledRange(g, this.canyonIce, 512, 170, wallScroll, x0, x1, gy);
      g.globalAlpha = 1;
    }
    // ferne Abbruchkante (Rasen/Schnee) der Gegenseite
    const P = STAGE_PAL[v.stage];
    g.fillStyle = snow > 0.4 ? "rgba(225,236,248,0.9)" : hexA(P.grassDark, 0.85);
    g.fillRect(x0, gy + 2, x1 - x0, 5);
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.fillRect(x0, gy + 7, x1 - x0, 3);
    // Tiefe: nach unten ins Dunkel, ganz unten Gischt/Nebel vom Wildbach
    const dk = g.createLinearGradient(0, gy + 12, 0, v.h);
    dk.addColorStop(0, "rgba(6,8,14,0.05)");
    dk.addColorStop(0.55, "rgba(6,8,14,0.55)");
    dk.addColorStop(0.85, "rgba(6,8,14,0.7)");
    dk.addColorStop(1, ice > 0.5 ? "rgba(120,170,230,0.5)" : "rgba(120,160,200,0.35)");
    g.fillStyle = dk;
    g.fillRect(x0, gy + 12, x1 - x0, H - 12);
    if (ice < 0.9) {
      g.fillStyle = "rgba(90,150,200,0.6)";
      g.fillRect(x0, v.h - 10, x1 - x0, 10);
      if (!v.reducedMotion) {
        g.fillStyle = "rgba(235,248,255,0.85)";
        const off = mod(v.time * 180 + v.dist * 0.82, 46);
        for (let x = x0 - off; x < x1; x += 46) {
          const xx = Math.max(x0, x);
          g.fillRect(xx, v.h - 8 + (Math.floor((x + v.dist) / 46) % 2) * 3, Math.min(14, x1 - xx), 2);
        }
      }
    }
    // Innenkanten-Schatten (Wandnähe)
    const ls = g.createLinearGradient(x0, 0, x0 + 40, 0);
    ls.addColorStop(0, "rgba(0,0,0,0.55)");
    ls.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = ls;
    g.fillRect(x0, gy, 40, H);
  }

  /** Felsige Abbruchkante eines Bodensegments (dir = +1: Segment beginnt hier, Schlucht links davon). */
  private drawCliffEdge(g: Ctx2D, v: ViewState, x: number, dir: 1 | -1, snow: number): void {
    const gy = v.groundY;
    const seed = Math.round(x + v.dist);
    const r = mulberry(seed * 13 + (dir > 0 ? 1 : 2));
    const ice = snow > 0.85;
    // Felswand: reicht ~12 px in die Schlucht, nach unten zurückweichend
    g.beginPath();
    g.moveTo(x + dir * 34, gy + 2);
    g.lineTo(x - dir * 10, gy + 2);
    let yy = gy + 2;
    while (yy < v.h + 10) {
      yy += 14 + r() * 16;
      const xx = x - dir * (6 + r() * 12) + dir * Math.max(0, yy - gy - 40) * 0.05;
      g.lineTo(xx, yy);
    }
    g.lineTo(x + dir * 34, v.h + 10);
    g.closePath();
    const grd = g.createLinearGradient(0, gy, 0, v.h);
    if (ice) {
      grd.addColorStop(0, "#cfe3f6");
      grd.addColorStop(1, "#40669a");
    } else {
      grd.addColorStop(0, "#8a8178");
      grd.addColorStop(0.5, "#5e5750");
      grd.addColorStop(1, "#2a2622");
    }
    g.fillStyle = grd;
    g.fill();
    g.lineWidth = 2.5;
    g.strokeStyle = "#1a1612";
    g.stroke();
    // Facetten & Kluft
    g.fillStyle = "rgba(255,245,225,0.16)";
    g.beginPath();
    g.moveTo(x - dir * 8, gy + 8);
    g.lineTo(x + dir * 10, gy + 16);
    g.lineTo(x - dir * 4, gy + 58);
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(20,16,12,0.6)";
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x + dir * 14, gy + 20);
    g.lineTo(x + dir * 8, gy + 50);
    g.lineTo(x + dir * 16, gy + 86);
    g.stroke();
    // überhängende Grasnarbe / Schneewechte
    g.fillStyle = ice ? "#f5faff" : snow > 0.4 ? "#eef4fb" : STAGE_PAL[v.stage].grass;
    g.beginPath();
    g.moveTo(x + dir * 30, gy - 3);
    g.quadraticCurveTo(x - dir * 6, gy - 4, x - dir * 14, gy + 5);
    g.quadraticCurveTo(x - dir * 4, gy + 12, x + dir * 30, gy + 9);
    g.closePath();
    g.fill();
    if (!ice && snow < 0.4) {
      g.strokeStyle = STAGE_PAL[v.stage].grassDark;
      g.lineWidth = 1.5;
      g.beginPath();
      for (let i = 0; i < 4; i += 1) {
        const bx = x - dir * (10 - i * 3);
        g.moveTo(bx, gy + 7);
        g.lineTo(bx - dir * 2, gy + 14 + r() * 8);
      }
      g.stroke();
    }
  }

  // ------------------------------------------------------------------------------------------------------

  drawEntity(g: Ctx2D, e: Ent, sx: number, sy: number, v: ViewState): boolean {
    if (!this.ready) return false;
    const k = this.skin;
    const A = this.A;
    if (e.kind === "pickup") {
      if (e.pickup === "coin") {
        drawEdelweiss(g, A, e, sx, sy, k);
        return true;
      }
      return false;
    }
    switch (e.skin) {
      case "fence":
        drawFence(g, A, e, sx, k);
        return true;
      case "boulder":
        drawBoulder(g, A, e, sx, k);
        return true;
      case "logs":
        drawLogs(g, A, e, sx, sy, k);
        return true;
      case "cow":
        drawCow(g, A, e, sx, sy, k);
        return true;
      case "trunk":
        drawTrunk(g, A, e, sx, sy, k);
        return true;
      case "marmot":
        drawMarmot(g, A, e, sx, sy, k);
        return true;
      case "cairn":
        drawCairn(g, A, e, sx, k);
        return true;
      case "ledge":
        drawLedge(g, e, sx, sy, k);
        return true;
      case "cargo":
        drawCargo(g, A, e, sx, sy, k);
        return true;
      case "gorge":
        return true;
      case "plank":
        drawPlank(g, e, sx, sy, k);
        return true;
      case "crumble":
        drawCrumble(g, e, sx, sy, k);
        return true;
      case "crag":
        drawCrag(g, e, sx, sy, k);
        return true;
      case "gondola":
        drawGondola(g, e, sx, sy, k);
        return true;
      case "ibex":
        drawIbex(g, A, e, sx, sy, v, k);
        return true;
      case "eagle":
        drawEagle(g, A, e, sx, sy, v, k);
        return true;
      case "rockfall":
        drawRockfall(g, A, e, sx, sy, k);
        return true;
      case "rollstone":
        drawRoller(g, A, e, sx, sy, k, false);
        return true;
      case "snowball":
        drawRoller(g, A, e, sx, sy, k, k.snow > 0.3);
        return true;
      case "crate":
        if (e.kind !== "block") return false;
        drawCrate(g, e, sx, sy, k);
        return true;
      case "updraft":
        drawUpdraft(g, A, e, sx, sy, k);
        return true;
      case "deepsnow":
        drawDeepSnow(g, A, e, sx, k);
        return true;
      case "ice":
        drawIce(g, e, sx, k);
        return true;
      case "summit-cross":
        drawSummitCross(g, e, sx, sy, k);
        return true;
      default:
        return false;
    }
  }

  // ------------------------------------------------------------------------------------------------------

  drawForeground(g: Ctx2D, v: ViewState): void {
    this.withAlpha(g, (c) => this.renderForeground(c, v));
  }

  private renderForeground(g: Ctx2D, v: ViewState): void {
    this.build();
    const s = v.stage + v.stageBlend;
    // Pollen, Blütenblätter, Schnee
    this.motes.draw(g, v.time);
    this.snowField.draw(g, Math.min(1, this.snowAmt * 1.5));
    // Schmetterlinge
    const bf = stageVal(BUTTERFLIES, s);
    if (bf > 0.02 && v.quality > 0) this.drawButterflies(g, v, bf);
    // Windschlieren
    const wind = stageVal(WIND, s);
    if (wind > 0.3 && !v.reducedMotion) {
      g.strokeStyle = `rgba(255,255,255,${((wind - 0.3) * 0.5).toFixed(3)})`;
      g.lineWidth = 1.2;
      g.beginPath();
      const n = v.quality === 0 ? 8 : 24;
      for (let i = 0; i < n; i += 1) {
        const o = i * 4;
        const x = this.streaks[o];
        const y = this.streaks[o + 1];
        const len = this.streaks[o + 2];
        g.moveTo(x, y);
        g.quadraticCurveTo(x + len * 0.5, y - 3, x + len, y + 1);
      }
      g.stroke();
    }
    // Lawine
    const av = v.vars.avalanche ?? 0;
    if (av > 0.01) this.drawAvalanche(g, v, av);
    // Vordergrund-Gras (nah an der Kamera, ganz unten)
    this.drawForeGrass(g, v, s);
  }

  private drawButterflies(g: Ctx2D, v: ViewState, a: number): void {
    for (const b of this.butterflies) {
      const flap = v.reducedMotion ? 0.6 : Math.abs(Math.sin(v.time * 14 + b.ph));
      const x = b.x;
      const y = b.y + Math.sin(v.time * 3 + b.ph) * 6;
      const sz = 6 * b.s;
      g.globalAlpha = a;
      g.fillStyle = BF_COLORS[b.c];
      g.beginPath();
      g.ellipse(x - sz * 0.55 * flap, y - 1, sz * flap, sz * 0.8, -0.4, 0, TAU);
      g.ellipse(x + sz * 0.55 * flap, y - 1, sz * flap, sz * 0.8, 0.4, 0, TAU);
      g.fill();
      g.fillStyle = "#2a2018";
      g.fillRect(x - 1, y - 4, 2, 8);
    }
    g.globalAlpha = 1;
  }

  private drawForeGrass(g: Ctx2D, v: ViewState, s: number): void {
    if (v.quality === 0) return;
    const snow = stageVal(SNOWCOVER, s);
    const scroll = v.dist * FORE_PAR;
    const slot = 560;
    const k0 = Math.floor((scroll - 260) / slot);
    for (let k = k0; k <= k0 + 3; k += 1) {
      if (h1(k * 5.1) < 0.35) continue;
      const x = k * slot + h1(k) * 200 - scroll;
      if (x < -240 || x > v.w + 20) continue;
      const i = k & 1;
      const y = v.h - 88 + h1(k + 3) * 18;
      if (snow < 0.98) {
        g.globalAlpha = 0.95 * (1 - snow);
        g.drawImage(this.foreGrass[i], Math.round(x), Math.round(y));
      }
      if (snow > 0.02) {
        g.globalAlpha = 0.9 * snow;
        g.drawImage(this.foreSnow[i], Math.round(x), Math.round(y));
      }
    }
    g.globalAlpha = 1;
  }

  /**
   * Lawine am linken Rand: Staubwolke (Puderschnee), rollende Schneewalze mit Trümmern, Sprühschnee vorneweg.
   * Die Front liegt zeitbasiert vor der Figur: x = Figur − Vorsprung[s] × 330 px (je näher, desto bedrohlicher).
   */
  private drawAvalanche(g: Ctx2D, v: ViewState, presence: number): void {
    const gy = v.groundY;
    const gapT = Math.max(0, v.vars.avalancheT ?? 1);
    // zeitbasierte Darstellung: bei Soll-Vorsprung (0.62 s) steht die Walze sichtbar am linken Rand
    const front = PLAYER_SX - 26 - gapT * 330 - (1 - presence) * 420;
    if (front < -440) return;
    const t = v.reducedMotion ? v.time * 0.3 : v.time;
    const q = v.quality === 0 ? 0.55 : 1;
    const P = this.puffs;
    g.save();
    g.globalAlpha = Math.min(1, presence * 1.3);
    // Schneedecke hinter der Front
    g.fillStyle = "#eef4fc";
    g.fillRect(-10, gy - 6, Math.max(0, front + 10), 30);
    // Welle aus Puderschnee: Fuß an der Front, Kamm bricht nach vorn über, Rücken türmt sich nach hinten
    const bx0 = front - 30;
    const by0 = gy - 50;
    const cx1 = front + 150;
    const cy1 = gy - 330;
    const bx2 = front - 280;
    const by2 = gy - 520;
    const waveAt = (u: number): [number, number] => {
      const m = 1 - u;
      return [m * m * bx0 + 2 * m * u * cx1 + u * u * bx2, m * m * by0 + 2 * m * u * cy1 + u * u * by2];
    };
    // Körper unter der Welle (keine Lücken zwischen den Ballen)
    const body = g.createLinearGradient(0, gy - 420, 0, gy);
    body.addColorStop(0, "rgba(248,251,255,0.92)");
    body.addColorStop(0.7, "#eaf1fa");
    body.addColorStop(1, "#c9d8ec");
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(front + 16, gy + 8);
    for (let i = 0; i <= 10; i += 1) {
      const [x, y] = waveAt(i / 10);
      g.lineTo(x - 30, y + 40);
    }
    g.lineTo(-40, gy - 520);
    g.lineTo(-40, gy + 8);
    g.closePath();
    g.fill();
    const nB = Math.round(18 * q);
    for (let i = 0; i < nB; i += 1) {
      const u = i / Math.max(1, nB - 1);
      const [x0, y0] = waveAt(u);
      const ph = h1(i * 5.3 + 2);
      const x = x0 + Math.sin(t * 1.1 + i * 1.3) * 16;
      const y = y0 + Math.cos(t * 0.9 + i * 1.7) * 14;
      const sz = 150 + u * 170 + ph * 60;
      if (x + sz * 0.5 < -20) continue;
      g.globalAlpha = Math.min(1, presence * 1.3) * (1 - u * 0.3);
      g.drawImage(P[i % 3], x - sz / 2, y - sz / 2, sz, sz);
    }
    // feiner Pulverschleier über dem Kamm
    g.globalAlpha = Math.min(1, presence * 1.3) * 0.5;
    for (let i = 0; i < 4; i += 1) {
      const life = (t * 0.25 + i / 4) % 1;
      const [x0, y0] = waveAt(0.45 + i * 0.1);
      const sz = 220 + life * 200;
      g.globalAlpha = Math.min(1, presence * 1.3) * 0.45 * (1 - life);
      g.drawImage(P[(i + 2) % 3], x0 - sz / 2 - life * 80, y0 - sz / 2 - life * 120, sz, sz);
    }
    g.globalAlpha = Math.min(1, presence * 1.3);
    // Glanz auf der Lichtseite des Kamms (additiv → strahlend weiß trotz Vignette)
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = Math.min(1, presence * 1.3) * 0.45;
    {
      const [hx, hy] = waveAt(0.3);
      glowAt(g, this.glowWhite, hx + 30, hy, 170, 190);
    }
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = Math.min(1, presence * 1.3);
    // Schattenkante am Boden vor der Walze
    g.fillStyle = "rgba(40,70,120,0.28)";
    g.beginPath();
    g.ellipse(front - 10, gy + 4, 70, 9, 0, 0, TAU);
    g.fill();
    // rollende Walze: Ballen entlang der Front, drehen sich
    const nF = Math.round(10 * q);
    for (let i = 0; i < nF; i += 1) {
      const u = i / Math.max(1, nF - 1);
      const a = -t * 2.6 + i * 0.9;
      const bx = front - 20 - u * 150 + Math.cos(a) * 18;
      const by = gy - 30 - u * 220 + Math.sin(a) * 16;
      const sz = 110 + h1(i + 40) * 60 - u * 20;
      g.drawImage(P[(i + 1) % 3], bx - sz / 2, by - sz / 2, sz, sz);
    }
    // Trümmer: Baumstamm, Felsen, Schneeklumpen wirbeln in der Walze
    g.save();
    g.translate(front - 110 + Math.sin(t * 1.3) * 24, gy - 150 + Math.cos(t * 2.1) * 34);
    g.rotate(t * 3.1);
    g.fillStyle = "#5a3a22";
    g.strokeStyle = "#1e120a";
    g.lineWidth = 3;
    g.fillRect(-58, -8, 116, 16);
    g.strokeRect(-58, -8, 116, 16);
    g.fillStyle = "#2f5a36";
    g.beginPath();
    g.moveTo(40, -8);
    g.lineTo(72, -28);
    g.lineTo(80, 0);
    g.lineTo(72, 28);
    g.lineTo(40, 8);
    g.closePath();
    g.fill();
    g.restore();
    for (let i = 0; i < 3; i += 1) {
      const a = t * (2.2 + i * 0.7) + i * 2.1;
      const rx = front - 40 - i * 70 + Math.cos(a) * 30;
      const ry = gy - 70 - i * 60 + Math.sin(a) * 34;
      const sz = 40 - i * 7;
      g.save();
      g.translate(rx, ry);
      g.rotate(a * 1.4);
      g.drawImage(i === 1 ? this.A.snowball : this.A.rock, -sz / 2, -sz / 2, sz, sz);
      g.restore();
    }
    // Sprühschnee vorneweg
    g.fillStyle = "#ffffff";
    const nS = Math.round(46 * q);
    for (let i = 0; i < nS; i += 1) {
      const ph = h1(i * 3.3 + 1);
      const life = (t * (1.1 + ph) + ph) % 1;
      const x = front + 4 + life * (50 + ph * 150);
      const y = gy - 8 - ph * 200 + life * life * 150;
      const r = 1.6 + ph * 3;
      g.globalAlpha = Math.min(1, presence * 1.3) * (1 - life);
      g.fillRect(x, y, r, r);
    }
    g.restore();
  }

  drawOverlay(g: Ctx2D, v: ViewState): void {
    if (!this.ready) return;
    const s = v.stage + v.stageBlend;
    const glow = stageVal(GLOW, s);
    // Sonnen-Bloom (warmes Gegenlicht)
    if (v.quality === 2 && glow > 0.3) {
      const sunX = stageVal(SUN_X, s);
      const sunY = stageVal(SUN_Y, s);
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.1 + glow * 0.12;
      blitCentered(g, this.sunBloom, sunX, sunY + 60);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    // Farbstimmung: Abendrot-Schimmer am unteren Bildrand (vorgerendert, 1:1 geblittet)
    if (glow > 0.3) {
      g.globalAlpha = (glow - 0.3) / 0.7;
      g.drawImage(this.warmFoot, 0, v.h - 200);
      g.globalAlpha = 1;
    }
    // Lawinen-Treffer: weißer Schneestaub
    const hit = v.vars.avalancheHit ?? 0;
    if (hit > 0.01) {
      g.fillStyle = `rgba(245,250,255,${(hit * (v.reducedMotion ? 0.25 : 0.6)).toFixed(3)})`;
      g.fillRect(0, 0, v.w, v.h);
    }
    // Staub/Schnee am linken Rand während der Jagd
    const av = v.vars.avalanche ?? 0;
    if (av > 0.02) {
      const grd = g.createLinearGradient(0, 0, 260, 0);
      grd.addColorStop(0, `rgba(240,246,255,${(0.35 * av).toFixed(3)})`);
      grd.addColorStop(1, "rgba(240,246,255,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, 260, v.h);
    }
  }
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}
