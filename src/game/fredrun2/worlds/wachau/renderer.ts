/**
 * Wachau – WorldRenderer. Stimmungsbogen: Morgennebel → Goldener Vormittag → Sonnenuntergang → Blaue Stunde →
 * Sternennacht mit Glühwürmchen.
 * Ebenen (hinten → vorne): Himmel/Sonne/Mond/Sterne/Wolken/Zugvögel · Waldviertel-Höhen (0.025) · Nebel ·
 * gegenüberliegendes Ufer mit Weinterrassen, Dürnstein, Stift, Kirche, Weinberg (0.07) · Donau mit Spiegelung,
 * Glitzern und Raddampfer (0.07/0.1) · Lichtstrahlen · nahes Ufer mit Pappeln, Marillenbäumen, Heurigem (0.3) ·
 * Weinzeilen am Weg (0.62) · Uferweg (1.0) · Weinlaub-Girlande (1.25) · Gräser (1.4) · Blätter, Glühwürmchen, Nebel.
 * Performance: alle Ebenen sind pro Stufe vorgebacken (Licht multipliziert + Dunst) und werden ganzzahlig geblittet.
 */
import type { AssetLoader, Ent, ViewState, WorldRenderer } from "../../types";
import { Motes } from "../shared-a/fx";
import { blitCentered, blitTiled, blitTiledRange, bigGlow, glowAt, glowSprite, paint, softSprite, solidSegments, wrapDraw, type Ctx2D } from "../shared-b/canvas";
import { h1, mod, mulberry, stageVal } from "../shared-b/color";
import { StageCache, prepareStaged } from "../shared-b/layers";
import { LANDMARK_IDS, buildLandmark, steamshipLights, type Landmark, type LandmarkSpec } from "./landmarks";
import {
  ENT_NIGHT,
  FIREFLY,
  FOG,
  LEAVES,
  LIGHTS,
  MAX_STAGE,
  MOON,
  NIGHT,
  PAL,
  RAYS,
  STAGES,
  STARS,
  SUN_R,
  SUN_X,
  SUN_Y,
  WATER_DY,
  layerTint,
  tintCanvas,
} from "./palette";
import {
  BANK_SPOTS,
  CLOUD_H,
  CLOUD_W,
  GRASS_LIP,
  bankTile,
  birdStrip,
  cloudAtlas,
  colorize,
  farRidge,
  fogTile,
  garlandTile,
  grassTile,
  groundTile,
  moonSprite,
  nearBankTile,
  raysSprite,
  reflectionTile,
  riverShimmer,
  skyCanvas,
  vineRowTile,
} from "./scenery";
import { WachauSkins, type SkinCtx } from "./skins";
import { WaterFx } from "./water";

const TAU = Math.PI * 2;

export const WACHAU_PROPS = ["raft", "wine-barrel", "bee-swarm", "apricot", "crate-wine", "grape-bunch", ...LANDMARK_IDS];

/** Ebene: Quelle + Stufen-Varianten + (optional) Lichtkachel */
interface Layer {
  staged: StageCache;
  lights: HTMLCanvasElement | null;
  /** vertikaler Versatz der (zugeschnittenen) Lichtkachel */
  lightsDy: number;
  w: number;
  h: number;
  y: number;
  factor: number;
}

/** Schneidet eine (meist leere) Lichtkachel auf das Band mit Inhalt zu → billigere additive Blits */
function cropRows(c: HTMLCanvasElement): { canvas: HTMLCanvasElement; dy: number } {
  const g = c.getContext("2d");
  if (!g) return { canvas: c, dy: 0 };
  const data = g.getImageData(0, 0, c.width, c.height).data;
  let y0 = c.height;
  let y1 = -1;
  for (let y = 0; y < c.height; y += 1) {
    const row = y * c.width * 4;
    for (let x = 0; x < c.width; x += 3) {
      if (data[row + x * 4 + 3] > 3) {
        if (y < y0) y0 = y;
        y1 = y;
        break;
      }
    }
  }
  if (y1 < y0) return { canvas: c, dy: 0 };
  y0 = Math.max(0, y0 - 2);
  y1 = Math.min(c.height - 1, y1 + 2);
  const out = paint(c.width, y1 - y0 + 1, (cg) => cg.drawImage(c, 0, -y0));
  return { canvas: out, dy: y0 };
}

function layer(src: HTMLCanvasElement, y: number, factor: number, tint: (s: number) => Parameters<typeof tintCanvas>[1], lights: HTMLCanvasElement | null = null): Layer {
  const cropped = lights ? cropRows(lights) : null;
  return { staged: new StageCache((s) => tintCanvas(src, tint(s))), lights: cropped?.canvas ?? null, lightsDy: cropped?.dy ?? 0, w: src.width, h: src.height, y, factor };
}

// Geometrie (logische Pixel)
const RIDGE_Y = 214;
const BANK_Y = 178;
const BANK_H = 270;
const WATERLINE = BANK_Y + BANK_H - 4; // 444
const RIVER_BOTTOM = 560;
/** Himmel nur bis knapp unter die Wasserlinie (darunter verdecken Fluss, Ufer und Weg alles) */
const SKY_H = 452;
const NEAR_Y = 262;
const VINE_Y = 436;
const BANK_F = 0.07;
const SHIP_F = 0.1;

const LANDMARKS: Array<{ spec: LandmarkSpec; x: number; up: number }> = [
  { spec: { id: "landmark-abbey", h: 226, fade: 0.3, haze: 0.4, flood: 1 }, x: BANK_SPOTS.abbey, up: -30 },
  { spec: { id: "landmark-castle", h: 196, fade: 0.3, haze: 0.44, flood: 0.8 }, x: BANK_SPOTS.castle, up: 100 },
  { spec: { id: "landmark-vineyard", h: 184, fade: 0.36, haze: 0.44, flood: 0.2 }, x: BANK_SPOTS.vineyardA, up: -44 },
  { spec: { id: "landmark-church", h: 118, fade: 0.25, haze: 0.42, flood: 0.9 }, x: BANK_SPOTS.church, up: 24 },
  { spec: { id: "landmark-vineyard", h: 164, fade: 0.36, haze: 0.44, flood: 0.2, flip: true }, x: BANK_SPOTS.vineyardB, up: -40 },
];

export class WachauRenderer implements WorldRenderer {
  private ready = false;
  private props: AssetLoader["props"] | null = null;
  private skins = new WachauSkins();
  private water!: WaterFx;
  private sky!: StageCache;
  private clouds!: StageCache;
  private fogs!: StageCache;
  private ridge!: Layer;
  private bank!: Layer;
  private bankRefl!: Layer;
  private near!: Layer;
  private vines!: Layer;
  private ground!: Layer;
  private garland!: Layer;
  private grass!: Layer;
  private landmarks: Array<{ lm: Landmark; x: number; up: number }> = [];
  private ship: Landmark | null = null;
  private shipLights: HTMLCanvasElement | null = null;
  private staged: StageCache[] = [];
  private shimmer!: HTMLCanvasElement;
  private bankLightsRefl!: HTMLCanvasElement;
  private shimmer2!: HTMLCanvasElement;
  private moon!: HTMLCanvasElement;
  private birds!: HTMLCanvasElement;
  private rays: HTMLCanvasElement[] = [];
  private sunGlow!: HTMLCanvasElement;
  private moonGlow!: HTMLCanvasElement;
  private bloom!: HTMLCanvasElement;
  private glowWhite!: HTMLCanvasElement;
  private glowFire!: HTMLCanvasElement;
  private softFog!: HTMLCanvasElement;
  private softWarm!: HTMLCanvasElement;
  private k: SkinCtx = {
    night: 0,
    lights: 0,
    stage: 0,
    blend: 0,
    time: 0,
    quality: 2,
    reduced: false,
    groundY: 590,
    waterY: 612,
    water: "#5b9ccb",
    waterDeep: "#1a4868",
    waterTint: "rgba(91,156,203,0.6)",
    rim: "#fff0c0",
  };
  private motes = new Motes(150);
  private leafT = 0;
  private flyT = 0;
  private mistT = 0;
  private shootT = 5;
  private shoot = { x: 0, y: 0, t: -1 };
  private splashCd = 0;
  private rng = mulberry(2468);
  private riverGrd: { key: string; grd: CanvasGradient | null } = { key: "", grd: null };
  private blendCanvas: HTMLCanvasElement | null = null;
  private blendCtx: CanvasRenderingContext2D | null = null;

  async load(assets: AssetLoader): Promise<void> {
    this.props = assets.props;
    await assets.props.preload(WACHAU_PROPS).catch(() => undefined);
    this.skins.setProps(assets.props);
    this.ready = false;
    this.build();
  }

  resize(dpr: number): void {
    void dpr;
  }

  private build(): void {
    if (this.ready) return;
    this.sky = new StageCache((s) => skyCanvas(s, 1280, SKY_H));
    this.clouds = new StageCache((s) => cloudAtlas(s));
    const fogW = fogTile(1024, 150, 11);
    this.fogs = new StageCache((s) => colorize(fogW, STAGES[s].fog));
    this.ridge = layer(farRidge(2048, 236), RIDGE_Y, 0.025, (s) => layerTint(s, 0.62, 0.78));
    const bank = bankTile(3072, BANK_H);
    this.bank = layer(bank.canvas, BANK_Y, BANK_F, (s) => layerTint(s, 0.36, 0.5), bank.lights);
    const refl = reflectionTile(bank.canvas, 120, RIVER_BOTTOM - WATERLINE);
    this.bankLightsRefl = reflectionTile(bank.lights, 120, RIVER_BOTTOM - WATERLINE);
    this.bankRefl = layer(refl, WATERLINE + 2, BANK_F, (s) => ({ ...layerTint(s, 0.3, 0.4), flat: { color: STAGES[s].water, a: 0.25 } }));
    const props = this.props;
    const near = nearBankTile(2560, 332, (g, W, shoreY) => {
      if (!props || !props.has("raft")) return;
      for (const bx of [1900, 2480]) {
        wrapDraw(W, bx, 60, (x) => {
          props.draw(g, "raft", x, shoreY(bx) + 14, { h: 44, flipX: bx > 2000, ax: 0.5, ay: 0.98 });
        });
      }
    });
    this.near = layer(near.canvas, NEAR_Y, 0.3, (s) => layerTint(s, 0.2, 0.12, 0.35), near.lights);
    const vr = vineRowTile(2048, 160);
    this.vines = layer(vr.canvas, VINE_Y, 0.62, (s) => layerTint(s, 0.06, 0, 0.62, 0.95), vr.lights);
    this.ground = layer(groundTile(1024, 140), 590 - GRASS_LIP, 1, (s) => ({ mul: mixLight(s, 0.85), haze: { color: STAGES[s].haze, aTop: 0.06, aBottom: 0 } }));
    const ga = garlandTile(1600, 150);
    this.garland = layer(ga.canvas, -10, 1.25, (s) => ({ mul: mixLight(s, 0.9), flat: { color: "#0a0e1c", a: NIGHT[s] * 0.25 } }), ga.lights);
    this.grass = layer(grassTile(1600, 84), 720 - 84, 1.4, (s) => ({ mul: mixLight(s, 1), flat: { color: "#0c0f18", a: 0.25 + NIGHT[s] * 0.35 } }));
    this.landmarks = LANDMARKS.map((d) => ({ lm: buildLandmark(d.spec, this.props), x: d.x, up: d.up }));
    this.ship = buildLandmark({ id: "landmark-steamship", h: 62, fade: 0, haze: 0.22, flood: 0.4 }, this.props);
    this.shipLights = steamshipLights(this.ship.w, this.ship.h);
    this.staged = [
      this.sky,
      this.clouds,
      this.fogs,
      this.ridge.staged,
      this.bank.staged,
      this.bankRefl.staged,
      this.near.staged,
      this.vines.staged,
      this.ground.staged,
      this.garland.staged,
      this.grass.staged,
      ...this.landmarks.flatMap((l) => [l.lm.staged, l.lm.refl]),
      this.ship.staged,
      this.ship.refl,
    ];
    prepareStaged(this.staged, 0, MAX_STAGE, 99);
    this.shimmer = riverShimmer(1024, RIVER_BOTTOM - WATERLINE, 21);
    this.shimmer2 = riverShimmer(1024, RIVER_BOTTOM - WATERLINE, 57);
    this.moon = moonSprite();
    this.birds = birdStrip();
    this.rays = [raysSprite(1280, 440, 1010, 250, 3, "#ffe8c0")];
    this.sunGlow = bigGlow(620, 620, [
      [0, "rgba(255,240,200,0.95)"],
      [0.12, "rgba(255,210,140,0.55)"],
      [0.42, "rgba(255,170,100,0.16)"],
      [1, "rgba(255,140,80,0)"],
    ]);
    this.moonGlow = bigGlow(320, 320, [
      [0, "rgba(210,228,255,0.55)"],
      [0.3, "rgba(160,190,255,0.18)"],
      [1, "rgba(120,150,255,0)"],
    ]);
    this.bloom = bigGlow(640, 440, [
      [0, "rgba(255,200,130,0.9)"],
      [0.5, "rgba(255,160,100,0.28)"],
      [1, "rgba(255,120,80,0)"],
    ]);
    this.glowWhite = glowSprite("#fff6e0", 0.2);
    this.glowFire = glowSprite("#d8ff7a", 0.25);
    this.softFog = softSprite("rgba(255,255,255,1)");
    this.softWarm = softSprite("rgba(255,190,110,1)");
    this.water = new WaterFx(this.glowWhite);
    this.ready = true;
  }

  // ---------------------------------------------------------------------------------------------

  update(dt: number, v: ViewState): void {
    if (!this.ready) this.build();
    prepareStaged(this.staged, v.stage, MAX_STAGE, 1);
    const s = v.stage + v.stageBlend;
    const q = v.quality;
    const scroll = v.speed;
    const gust = v.vars.gust ?? 0;
    this.water.update(dt);
    this.splashCd = Math.max(0, this.splashCd - dt);
    // Sturz ins Wasser → großer Spritzer
    if (v.playerFeetY > v.groundY + WATER_DY - 4 && this.splashCd <= 0 && v.gravDir === 1) {
      this.water.splash(v.dist + v.playerX, v.groundY + WATER_DY, 1.6, v.reducedMotion);
      this.splashCd = 1.2;
    }
    // Herbstlaub (mehr bei Böen)
    const leafRate = (stageVal(LEAVES, s) * 3 + gust * 14) * (q === 0 ? 0.35 : q === 1 ? 0.7 : 1);
    this.leafT += dt * leafRate;
    while (this.leafT >= 1) {
      this.leafT -= 1;
      const near = this.rng() < 0.35;
      this.motes.spawn("leaf", 200 + this.rng() * 1200, -20, -40 - this.rng() * 60 - gust * 260, 50 + this.rng() * 70, 9, near ? 6 + this.rng() * 3 : 3.5 + this.rng() * 2, near ? 1.1 : 0.6);
    }
    // Glühwürmchen
    const ff = stageVal(FIREFLY, s) * (q === 0 ? 0.4 : 1);
    if (ff > 0.02) {
      this.flyT += dt * ff * 7;
      while (this.flyT >= 1) {
        this.flyT -= 1;
        const fg = this.rng() < 0.3;
        this.motes.spawn("firefly", 100 + this.rng() * 1300, fg ? 420 + this.rng() * 200 : 360 + this.rng() * 200, 0, 0, 5 + this.rng() * 4, fg ? 2.4 : 1.4, fg ? 0.9 : 0.4);
      }
    }
    // Nebelschwaden (Morgen) – als Staub-Partikel nicht nötig; eigener Timer für Wisps
    this.mistT += dt;
    this.motes.update(dt, scroll, -20 - gust * 120, v.time);
    // Sternschnuppe
    if (stageVal(STARS, s) > 0.6 && !v.reducedMotion) {
      this.shootT -= dt;
      if (this.shootT <= 0) {
        this.shootT = 4 + this.rng() * 6;
        this.shoot = { x: 300 + this.rng() * 900, y: 30 + this.rng() * 120, t: 0 };
      }
      if (this.shoot.t >= 0) {
        this.shoot.t += dt;
        if (this.shoot.t > 0.9) this.shoot.t = -1;
      }
    }
  }

  /**
   * Die Engine blendet Welten beim Tor-Übergang über `globalAlpha`. Intern setzen wir Alpha-Werte absolut – daher wird bei
   * Teil-Deckkraft in eine Zwischenfläche gezeichnet und diese einmal mit der Deckkraft der Engine aufgetragen.
   */
  private blended(g: Ctx2D, paintFn: (cg: Ctx2D) => void): void {
    const A = g.globalAlpha;
    if (A > 0.995) {
      paintFn(g);
      return;
    }
    if (A < 0.004) return;
    if (!this.blendCanvas) {
      this.blendCanvas = paint(1280, 720, () => undefined);
      this.blendCtx = this.blendCanvas.getContext("2d");
    }
    const cg = this.blendCtx;
    if (!cg || !this.blendCanvas) return;
    cg.setTransform(1, 0, 0, 1, 0, 0);
    cg.globalAlpha = 1;
    cg.globalCompositeOperation = "source-over";
    cg.clearRect(0, 0, 1280, 720);
    paintFn(cg);
    g.drawImage(this.blendCanvas, 0, 0);
  }

  private skinCtx(v: ViewState): SkinCtx {
    const s = v.stage + v.stageBlend;
    const P = PAL.css(s);
    const k = this.k;
    k.night = stageVal(ENT_NIGHT, s);
    k.lights = stageVal(LIGHTS, s);
    k.stage = v.stage;
    k.blend = v.stageBlend;
    k.time = v.time;
    k.quality = v.quality;
    k.reduced = v.reducedMotion;
    k.groundY = v.groundY;
    k.waterY = v.groundY + WATER_DY;
    k.water = P.water;
    k.waterDeep = P.waterDeep;
    const R = PAL.rgb(s).water;
    k.waterTint = `rgba(${R[0] | 0},${R[1] | 0},${R[2] | 0},0.62)`;
    k.rim = STAGES[Math.min(MAX_STAGE, Math.round(s))].rim;
    return k;
  }

  drawBackground(g: Ctx2D, v: ViewState): void {
    this.blended(g, (cg) => this.paintBackground(cg, v));
  }

  private paintBackground(g: Ctx2D, v: ViewState): void {
    if (!this.ready) this.build();
    const st = v.stage;
    const bl = v.stageBlend;
    const s = st + bl;
    this.skinCtx(v);
    const night = stageVal(NIGHT, s);
    const lights = stageVal(LIGHTS, s);
    const fog = stageVal(FOG, s);
    const q0 = g.imageSmoothingQuality;
    g.imageSmoothingQuality = "low";

    // Himmel
    g.drawImage(this.sky.get(st), 0, 0);
    if (bl > 0.004 && st < MAX_STAGE) {
      g.globalAlpha = bl;
      g.drawImage(this.sky.get(st + 1), 0, 0);
      g.globalAlpha = 1;
    }
    const P = PAL.css(s);

    // funkelnde Sterne
    const starA = stageVal(STARS, s);
    if (starA > 0.05 && v.quality > 0) {
      g.globalCompositeOperation = "lighter";
      for (let i = 0; i < 16; i += 1) {
        const x = h1(i + 3) * 1280;
        const y = 16 + h1(i + 40) * 260;
        const tw = v.reducedMotion ? 0.6 : 0.5 + 0.5 * Math.sin(v.time * (1.3 + h1(i + 9) * 2.2) + i * 1.7);
        g.globalAlpha = starA * tw * 0.8;
        glowAt(g, this.glowWhite, x, y, 5 + h1(i + 5) * 5);
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    // Sternschnuppe
    if (this.shoot.t >= 0) {
      const t = this.shoot.t;
      const x = this.shoot.x - t * 460;
      const y = this.shoot.y + t * 170;
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = Math.sin((t / 0.9) * Math.PI) * starA;
      g.strokeStyle = "rgba(220,235,255,0.9)";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + 100, y - 37);
      g.stroke();
      glowAt(g, this.glowWhite, x, y, 9);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }

    // Sonne
    const sunX = stageVal(SUN_X, s);
    const sunY = stageVal(SUN_Y, s);
    const sunR = stageVal(SUN_R, s);
    if (sunY < 700) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.85 * (1 - night * 0.7);
      blitCentered(g, this.sunGlow, sunX, sunY);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
      g.fillStyle = P.sun;
      g.beginPath();
      g.arc(sunX, sunY, sunR, 0, TAU);
      g.fill();
    }
    // Mond
    const moonA = stageVal(MOON, s);
    if (moonA > 0.01) {
      const mx = 1060;
      const my = 118;
      g.globalAlpha = moonA;
      g.globalCompositeOperation = "lighter";
      blitCentered(g, this.moonGlow, mx, my);
      g.globalCompositeOperation = "source-over";
      g.drawImage(this.moon, mx - 48, my - 48);
      g.globalAlpha = 1;
    }

    // Wolken
    this.drawClouds(g, v);
    // Zugvögel (Tag)
    if (night < 0.6 && v.quality > 0) this.drawBirds(g, v, night);

    // Ferne Höhen
    this.drawLayer(g, this.ridge, v);
    // Nebel über dem Tal (hinten)
    if (fog > 0.15) this.drawFog(g, v, 0.04, 312, fog * 0.9, 12);

    // Gegenüberliegendes Ufer + Wahrzeichen
    this.drawLayer(g, this.bank, v, lights * 0.95);
    this.drawLandmarks(g, v, lights, false);

    // Donau
    this.drawRiver(g, v, night, lights, sunX, moonA);

    // Nebel über dem Wasser
    if (fog > 0.15) this.drawFog(g, v, 0.1, 396, fog, 18);

    // Lichtstrahlen
    const rays = stageVal(RAYS, s) * (v.quality === 2 ? 1 : 0);
    if (rays > 0.03 && sunY < 700) {
      const pulse = v.reducedMotion ? 0.8 : 0.72 + 0.28 * Math.sin(v.time * 0.45);
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = rays * 0.55 * pulse;
      g.drawImage(this.rays[0], Math.round(sunX - 1010), Math.round(sunY - 250));
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }

    // Nahes Ufer
    this.drawLayer(g, this.near, v, lights);
    if (fog > 0.3) this.drawFog(g, v, 0.34, 470, fog * 0.8, 30);
    // Weinzeilen am Weg
    this.drawLayer(g, this.vines, v, lights);
    g.imageSmoothingQuality = q0;
  }

  private drawLayer(g: Ctx2D, L: Layer, v: ViewState, lightA = 0, y = L.y): void {
    const st = v.stage;
    const bl = v.stageBlend;
    const scroll = v.dist * L.factor;
    blitTiled(g, L.staged.get(st), L.w, L.h, scroll, y);
    if (bl > 0.004 && st < MAX_STAGE) {
      const pa = g.globalAlpha;
      g.globalAlpha = pa * bl;
      blitTiled(g, L.staged.get(st + 1), L.w, L.h, scroll, y);
      g.globalAlpha = pa;
    }
    if (L.lights && lightA > 0.03) {
      const pa = g.globalAlpha;
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = pa * Math.min(1, lightA);
      blitTiled(g, L.lights, L.lights.width, L.lights.height, scroll, y + L.lightsDy);
      g.globalAlpha = pa;
      g.globalCompositeOperation = "source-over";
    }
  }

  private drawStagedSprite(g: Ctx2D, c: StageCache, v: ViewState, x: number, y: number, alpha = 1): void {
    const st = v.stage;
    const bl = v.stageBlend;
    const pa = g.globalAlpha;
    g.globalAlpha = pa * alpha;
    g.drawImage(c.get(st), Math.round(x), Math.round(y));
    if (bl > 0.004 && st < MAX_STAGE) {
      g.globalAlpha = pa * alpha * bl;
      g.drawImage(c.get(st + 1), Math.round(x), Math.round(y));
    }
    g.globalAlpha = pa;
  }

  private drawLandmarks(g: Ctx2D, v: ViewState, lights: number, refl: boolean): void {
    const W = this.bank.w;
    const scroll = v.dist * BANK_F;
    const off = mod(scroll, W);
    for (const L of this.landmarks) {
      const lm = L.lm;
      for (let k = -1; k <= 1; k += 1) {
        const cx = L.x - off + k * W;
        if (cx + lm.w / 2 < -20 || cx - lm.w / 2 > 1300) continue;
        const bottom = WATERLINE - L.up;
        if (!refl) {
          this.drawStagedSprite(g, lm.staged, v, cx - lm.w / 2, bottom - lm.h);
          if (lights > 0.3 && lm.spec.flood > 0.5) {
            g.globalCompositeOperation = "lighter";
            g.globalAlpha = (lights - 0.3) * 0.5 * lm.spec.flood;
            glowAt(g, this.softWarm, cx, bottom - lm.h * 0.45, lm.w * 0.6, lm.h * 0.5);
            g.globalAlpha = 1;
            g.globalCompositeOperation = "source-over";
          }
        } else if (L.up < 40) {
          // Spiegelung nur für Wahrzeichen direkt am Wasser
          this.drawStagedSprite(g, lm.refl, v, cx - lm.w / 2 - 4, WATERLINE + 2 + (bottom - WATERLINE), 0.8);
        }
      }
    }
  }

  private drawRiver(g: Ctx2D, v: ViewState, night: number, lights: number, sunX: number, moonA: number): void {
    const s = v.stage + v.stageBlend;
    const P = PAL.css(s);
    const top = WATERLINE;
    const bot = RIVER_BOTTOM;
    const key = `${P.skyLow}|${P.water}`;
    if (this.riverGrd.key !== key) {
      const grd = g.createLinearGradient(0, top, 0, bot);
      grd.addColorStop(0, P.skyLow);
      grd.addColorStop(0.3, P.water);
      grd.addColorStop(1, P.waterDeep);
      this.riverGrd = { key, grd };
    }
    g.fillStyle = this.riverGrd.grd ?? P.water;
    g.fillRect(0, top, v.w, bot - top);
    // Spiegelung von Ufer + Wahrzeichen
    this.drawLayer(g, this.bankRefl, v);
    this.drawLandmarks(g, v, lights, true);
    if (lights > 0.1) {
      // Uferlichter spiegeln sich als gewellte Streifen (vorgerendert)
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = Math.min(1, lights * 0.9);
      blitTiled(g, this.bankLightsRefl, this.bankLightsRefl.width, this.bankLightsRefl.height, v.dist * BANK_F, top + 2);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    // Wellen-Glitzer
    const t = v.reducedMotion ? 0 : v.time;
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.16 + 0.12 * (1 - night);
    blitTiled(g, this.shimmer, 1024, bot - top, v.dist * 0.12 + t * 9, top);
    if (v.quality === 2) {
      g.globalAlpha = 0.1 + 0.08 * (1 - night);
      blitTiled(g, this.shimmer2, 1024, bot - top, v.dist * 0.18 - t * 6, top);
    }
    // Sonnen-/Mondglitzerbahn
    const sunA = stageVal(RAYS, s);
    const gx = moonA > 0.5 ? 1060 : sunX;
    const ga = Math.max(sunA * 0.9, moonA * 0.8);
    if (ga > 0.03 && v.quality > 0) {
      for (let i = 0; i < 18; i += 1) {
        const yy = top + 6 + (i / 18) * (bot - top - 20);
        const spread = 10 + (i / 18) * 70;
        const tw = v.reducedMotion ? 0.6 : Math.max(0, Math.sin(t * (4 + h1(i) * 3) + i * 2.3));
        g.globalAlpha = ga * tw * 0.8;
        glowAt(g, this.glowWhite, gx + (h1(i + 11) - 0.5) * spread * 2, yy, 4 + (i / 18) * 5, 2 + (i / 18) * 2);
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    // Raddampfer
    this.drawShip(g, v, lights);
  }

  private drawShip(g: Ctx2D, v: ViewState, lights: number): void {
    const sh = this.ship;
    if (!sh) return;
    const period = 5200;
    const x = mod(900 + v.time * 16 - v.dist * SHIP_F, period) - 400;
    if (x < -sh.w - 10 || x > 1290) return;
    const waterline = WATERLINE + 34;
    const bob = v.reducedMotion ? 0 : Math.sin(v.time * 1.2) * 1;
    // Spiegelung
    this.drawStagedSprite(g, sh.refl, v, x - 4, waterline - 4 + bob, 0.7);
    this.drawStagedSprite(g, sh.staged, v, x, waterline - sh.h + bob);
    if (lights > 0.1 && this.shipLights) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = lights;
      g.drawImage(this.shipLights, Math.round(x), Math.round(waterline - sh.h + bob));
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    // Bugwelle
    g.strokeStyle = "rgba(240,248,255,0.5)";
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(x + sh.w * 0.92, waterline + 1);
    g.lineTo(x + sh.w * 1.05, waterline + 4);
    g.moveTo(x + sh.w * 0.1, waterline + 1);
    g.lineTo(x - sh.w * 0.2, waterline + 3);
    g.stroke();
    // Rauchfahne
    if (v.quality > 0) {
      for (let i = 0; i < 5; i += 1) {
        const u = ((v.time * 0.25 + i / 5) % 1);
        g.globalAlpha = 0.22 * (1 - u);
        glowAt(g, this.softFog, x + sh.w * 0.48 - u * 70, waterline - sh.h * 0.9 - u * 40, 8 + u * 18);
      }
      g.globalAlpha = 1;
    }
  }

  private drawClouds(g: Ctx2D, v: ViewState): void {
    const st = v.stage;
    const bl = v.stageBlend;
    const a = this.clouds.get(st);
    const b = bl > 0.004 && st < MAX_STAGE ? this.clouds.get(st + 1) : null;
    const defs = [
      [0, 100, 40, 0.014],
      [1, 620, 110, 0.01],
      [3, 980, 190, 0.02],
      [2, 1400, 70, 0.012],
      [3, 1850, 150, 0.018],
      [0, 2300, 20, 0.008],
    ] as const;
    for (const [idx, x0, y, f] of defs) {
      const x = Math.round(mod(x0 - v.dist * f - v.time * 5, 2600) - 440);
      if (x > 1290 || x < -CLOUD_W) continue;
      g.drawImage(a, 0, idx * CLOUD_H, CLOUD_W, CLOUD_H, x, y, CLOUD_W, CLOUD_H);
      if (b) {
        g.globalAlpha = bl;
        g.drawImage(b, 0, idx * CLOUD_H, CLOUD_W, CLOUD_H, x, y, CLOUD_W, CLOUD_H);
        g.globalAlpha = 1;
      }
    }
  }

  private drawBirds(g: Ctx2D, v: ViewState, night: number): void {
    const period = 3400;
    const x = mod(1500 - v.time * 38 - v.dist * 0.03, period) - 200;
    if (x < -100 || x > 1290) return;
    const f = Math.floor(v.time * 9) % 8;
    const y = 150 + Math.sin(v.time * 0.3) * 20;
    g.globalAlpha = 0.7 * (1 - night);
    g.drawImage(this.birds, f * 90, 0, 90, 40, Math.round(x), Math.round(y), 90, 40);
    g.drawImage(this.birds, ((f + 3) % 8) * 90, 0, 90, 40, Math.round(x + 130), Math.round(y + 40), 72, 32);
    g.globalAlpha = 1;
  }

  private drawFog(g: Ctx2D, v: ViewState, factor: number, y: number, a: number, drift: number): void {
    if (v.quality === 0 && factor > 0.2) return;
    const st = v.stage;
    const bl = v.stageBlend;
    const t = v.reducedMotion ? 0 : v.time;
    const scroll = v.dist * factor + t * drift;
    const pa = g.globalAlpha;
    g.globalAlpha = pa * Math.min(1, a) * (1 - bl);
    blitTiled(g, this.fogs.get(st), 1024, 150, scroll, y);
    if (bl > 0.004 && st < MAX_STAGE) {
      g.globalAlpha = pa * Math.min(1, a) * bl;
      blitTiled(g, this.fogs.get(st + 1), 1024, 150, scroll, y);
    }
    g.globalAlpha = pa;
  }

  // ---------------------------------------------------------------------------------------------

  drawGround(g: Ctx2D, v: ViewState, pits: ReadonlyArray<{ x0: number; x1: number; skin: string }>): void {
    this.blended(g, (cg) => this.paintGround(cg, v, pits));
  }

  private paintGround(g: Ctx2D, v: ViewState, pits: ReadonlyArray<{ x0: number; x1: number; skin: string }>): void {
    if (!this.ready) this.build();
    const k = this.skinCtx(v);
    const st = v.stage;
    const bl = v.stageBlend;
    const s = st + bl;
    const P = PAL.css(s);
    const night = stageVal(NIGHT, s);
    const q0 = g.imageSmoothingQuality;
    g.imageSmoothingQuality = "low";
    const gy = v.groundY;
    // Wasser
    this.water.drawPits(g, v, pits, {
      water: P.water,
      waterDeep: P.waterDeep,
      sky: P.skyLow,
      glint: stageVal(RAYS, s),
      moon: stageVal(MOON, s),
      night,
      waterY: k.waterY,
    });
    // Uferweg
    const segs = solidSegments(pits, v.w);
    const gA = this.ground.staged.get(st);
    const gB = bl > 0.004 && st < MAX_STAGE ? this.ground.staged.get(st + 1) : null;
    const ty = gy - GRASS_LIP;
    for (const sg of segs) {
      const a = Math.max(0, sg.x0);
      const b = Math.min(v.w, sg.x1);
      if (b <= a) continue;
      blitTiledRange(g, gA, this.ground.w, this.ground.h, v.dist, a, b, ty);
      if (gB) {
        g.globalAlpha = bl;
        blitTiledRange(g, gB, this.ground.w, this.ground.h, v.dist, a, b, ty);
        g.globalAlpha = 1;
      }
      // Ufermauer-Stirnseiten zu den Lücken
      if (sg.x0 > -30) this.bankEdge(g, Math.round(sg.x0), gy, v, 1, night);
      if (sg.x1 < v.w + 30) this.bankEdge(g, Math.round(sg.x1), gy, v, -1, night);
    }
    // Lichtpfützen der Laternen (Weg)
    const lights = stageVal(LIGHTS, s);
    if (lights > 0.1 && v.quality > 0) {
      g.globalCompositeOperation = "lighter";
      const step = 640;
      const wx0 = Math.floor((v.dist - 300) / step) * step;
      for (let wx = wx0; wx < v.dist + v.w + 300; wx += step) {
        const sx = wx + 200 - v.dist;
        let inPit = false;
        for (const p of pits) if (sx > p.x0 - 80 && sx < p.x1 + 80) inPit = true;
        if (inPit) continue;
        g.globalAlpha = lights * 0.35;
        glowAt(g, this.softWarm, sx, gy + 20, 170, 26);
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    g.imageSmoothingQuality = q0;
  }

  /** Stirnseite der Ufermauer an einer Lücke; dir = +1 → Segment beginnt hier (Mauer links davon ist Wasser) */
  private bankEdge(g: Ctx2D, x: number, gy: number, v: ViewState, dir: 1 | -1, night: number): void {
    const w = 12;
    const x0 = dir === 1 ? x : x - w;
    const grd = g.createLinearGradient(x0, 0, x0 + w, 0);
    const dark = `rgba(34,26,20,${(0.85).toFixed(2)})`;
    const lit = `rgba(150,136,116,${(1 - night * 0.6).toFixed(3)})`;
    grd.addColorStop(0, dir === 1 ? lit : dark);
    grd.addColorStop(1, dir === 1 ? dark : lit);
    g.fillStyle = grd;
    g.fillRect(x0, gy + 2, w, v.h - gy);
    // Steinfugen
    g.fillStyle = "rgba(20,14,10,0.5)";
    for (let y = gy + 12; y < v.h; y += 14) g.fillRect(x0, y, w, 2);
    // Grasnase oben
    g.fillStyle = night > 0.5 ? "#2a3424" : "#6e7a34";
    g.beginPath();
    g.ellipse(x - dir * 3, gy + 1, 9, 4, 0, 0, TAU);
    g.fill();
  }

  // ---------------------------------------------------------------------------------------------

  drawEntity(g: Ctx2D, e: Ent, sx: number, sy: number, v: ViewState): boolean {
    if (!this.ready) this.build();
    const k = this.k;
    const S = this.skins;
    switch (e.kind) {
      case "pickup":
        if (e.pickup === "coin") {
          S.drawApricot(g, e, sx, sy, v, k);
          return true;
        }
        return false;
      case "platform":
        this.platformFx(e, sx, v);
        if (e.skin === "raft") S.drawRaft(g, e, sx, sy, v, k);
        else if (e.skin === "cargo") S.drawCargo(g, e, sx, sy, v, k);
        else if (e.skin === "boat") S.drawBoat(g, e, sx, sy, v, k);
        else S.drawTerrace(g, e, sx, sy, v, k);
        return true;
      case "walker":
        if (e.skin === "barrel") {
          if (e.state === "sunk" && !e.fx.splashed) {
            e.fx.splashed = 1;
            this.water.splash(e.x + e.w / 2, k.waterY, 0.8, v.reducedMotion);
          }
          S.drawBarrel(g, e, sx, sy, v, k);
          return true;
        }
        return false;
      case "flyer":
        if (e.skin === "bees") {
          S.drawBees(g, e, sx, sy, v, k);
          return true;
        }
        return false;
      case "block":
        if (e.skin === "crate") S.drawCrate(g, e, sx, sy, v, k, 1);
        else if (e.skin === "crates") S.drawCrate(g, e, sx, sy, v, k, 2);
        else if (e.skin === "cask") S.drawCask(g, e, sx, sy, v, k);
        else S.drawWall(g, e, sx, sy, v, k);
        return true;
      case "overhead":
        S.drawBranch(g, e, sx, sy, v, k, e.skin === "vines");
        return true;
      case "wind":
        S.drawGust(g, e, sx, sy, v, k);
        return true;
      case "pit":
        return true;
      case "decor":
        // Tour-Tor in die Wachau: rustikale Weinlaube als Rahmen; den Portalring zeichnet die Engine davor (false)
        if (e.skin === "gateway") S.drawGateArch(g, e, sx, sy, v, k);
        return false;
      default:
        return false;
    }
  }

  /** Spritzer beim Landen auf / Versinken von Flößen */
  private platformFx(e: Ent, sx: number, v: ViewState): void {
    if (e.skin !== "raft" && e.skin !== "boat" && e.skin !== "cargo") return;
    if (sx < -100 || sx > 1380) return;
    const wy = this.k.waterY;
    if (e.state === "crumbling" && !e.fx.landed) {
      e.fx.landed = 1;
      this.water.splash(e.x + e.w * 0.3, wy, 0.55, v.reducedMotion);
      this.water.splash(e.x + e.w * 0.8, wy, 0.4, v.reducedMotion);
    } else if (e.state === "fallen" && !e.fx.sunk) {
      e.fx.sunk = 1;
      this.water.splash(e.x + e.w / 2, wy, 1.1, v.reducedMotion);
    }
  }

  drawForeground(g: Ctx2D, v: ViewState): void {
    this.blended(g, (cg) => this.paintForeground(cg, v));
  }

  private paintForeground(g: Ctx2D, v: ViewState): void {
    if (!this.ready) this.build();
    const st = v.stage;
    const bl = v.stageBlend;
    const s = st + bl;
    const lights = stageVal(LIGHTS, s);
    const fog = stageVal(FOG, s);
    const q0 = g.imageSmoothingQuality;
    g.imageSmoothingQuality = "low";
    // Spritzer
    this.water.drawSplashes(g, v, v.groundY + WATER_DY);
    // Blätter + Glühwürmchen
    this.motes.draw(g, v.time, 1);
    if (stageVal(FIREFLY, s) > 0.05 && v.quality > 0) this.drawFireflyGlow(g, v);
    // Bodennebel (Morgen)
    if (fog > 0.25 && v.quality > 0) {
      this.drawFog(g, v, 1.1, 548, (fog - 0.2) * 0.55, 26);
      if (!v.reducedMotion) {
        g.globalAlpha = 1;
        for (let i = 0; i < 4; i += 1) {
          const x = mod(h1(i + 70) * 1600 - v.dist * 1.2 - v.time * 20, 1700) - 200;
          g.globalAlpha = (fog - 0.2) * 0.22;
          glowAt(g, this.softFog, x, 600 + h1(i + 71) * 60, 220, 40);
        }
        g.globalAlpha = 1;
      }
    }
    // Gräser unten
    this.drawLayer(g, this.grass, v);
    // Weinlaub-Girlande oben
    const flick = v.reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(v.time * 7.3) * Math.sin(v.time * 3.1);
    this.drawLayer(g, this.garland, v, lights * flick);
    g.imageSmoothingQuality = q0;
  }

  private drawFireflyGlow(g: Ctx2D, v: ViewState): void {
    const M = this.motes;
    g.globalCompositeOperation = "lighter";
    const fk = Motes.KINDS.indexOf("firefly");
    for (let i = 0; i < M.count; i += 1) {
      if (M.kind[i] !== fk) continue;
      const pulse = 0.4 + 0.6 * Math.max(0, Math.sin(v.time * 2.2 + M.seed[i]));
      g.globalAlpha = 0.5 * pulse;
      glowAt(g, this.glowFire, M.x[i], M.y[i], M.size[i] * 6);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  drawOverlay(g: Ctx2D, v: ViewState): void {
    if (v.quality < 2) return;
    const s = v.stage + v.stageBlend;
    const night = stageVal(NIGHT, s);
    // Sonnen-Bloom (vorgerendert, 1:1, ganzzahlig)
    if (night < 0.9) {
      const sunX = stageVal(SUN_X, s);
      const sunY = stageVal(SUN_Y, s);
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.12 * (1 - night) * (1 + stageVal(RAYS, s) * 0.5);
      blitCentered(g, this.bloom, sunX, Math.min(520, sunY));
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
  }
}

function mixLight(stage: number, k: number): string {
  const L = STAGES[stage].light;
  const a = parseInt(L.slice(1), 16);
  const r = Math.round(255 + (((a >> 16) & 255) - 255) * k);
  const gg = Math.round(255 + (((a >> 8) & 255) - 255) * k);
  const b = Math.round(255 + ((a & 255) - 255) * k);
  return `#${((1 << 24) | (r << 16) | (gg << 8) | b).toString(16).slice(1)}`;
}
