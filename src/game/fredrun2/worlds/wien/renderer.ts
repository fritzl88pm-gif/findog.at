/**
 * Wien – Renderer: gemalte Katastrophen-Kulisse (8 Stufen, gespiegelt gekachelt) + prozedurale Dachlandschaft,
 * Gründerzeit-Fassaden mit Fensterlicht und Leuchtreklamen (Brand → Ruine), Rauchsäulen und Dachbrände, Laternen,
 * Platanen, Litfaßsäulen, Oberleitungsmasten mit (später gerissener) Fahrleitung, nasses Kopfsteinpflaster mit Gleisen
 * und Spiegelungen, Regen/Glut/Asche, Blitze.
 *
 * Performance: Ebenen werden je Stufe VORGEBACKEN (Dunst eingerechnet) und nur 1:1 an ganzzahligen Positionen
 * geblittet; Verläufe, Lichthöfe und Rauchwolken liegen als fertige Flächen in fester Größe vor (siehe cache.ts).
 */
import { clamp } from "../../draw-utils";
import type { AssetLoader, Ent, PropLibrary, ViewState, WorldRenderer } from "../../types";
import { yieldToMain } from "../../yield";
import { Motes, Rain } from "../shared-a/fx";
import { css, groundSegments, hash, lerpRgb, stageRgb, stageVal, type RGB, type Tile } from "../shared-a/gfx";
import { touchCanvas } from "../shared-b/canvas";
import { flashFactor } from "../shared-b/flash";
import { StageCache, StagePrep, stageProgress } from "../shared-b/layers";
import { WarmQueue } from "../shared-b/warm";
import { MirrorBackdrop, SizedSprites, blitAt, blitRange, blitRow, blitSlice, canvas, ellipseGlow, mod, vGradient } from "./cache";
import {
  MAST_AX,
  MAST_H,
  MAST_TIP_X,
  MAST_TIP_Y,
  MAST_W,
  paintBareTree,
  paintCloudsA,
  paintCloudsB,
  startFacades,
  paintFlameFrames,
  paintGlow,
  paintLamp,
  paintLampOff,
  paintLitfass,
  paintMast,
  paintRainSheet,
  paintRooftops,
  paintShaft,
  paintSmokePuff,
  paintStreet,
  paintTree,
  type FacadeBuild,
  type FacadeOpts,
  type FacadeTile,
} from "./scenery";
import {
  PropSprites,
  TramBodies,
  WIEN_PROPS,
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
  propBakeJobs,
  warmSkinFx,
  type SkinCtx,
} from "./skins";
import {
  ASH,
  CLOUDS,
  FACADE_HAZE,
  FACADE_OF_STAGE,
  FIRE,
  HAZE,
  LAMPS,
  RAIN,
  ROOF_HAZE,
  ROOF_OF_STAGE,
  SKY_BOT,
  SKY_TOP,
  SMOKE,
  WIEN_BACKDROPS,
  WIND,
  WIRES,
} from "./stages";

const FACADE_VARIANTS: FacadeOpts[] = [
  { lit: 0.62, fire: 0, damage: 0 },
  { lit: 0.3, fire: 0, damage: 1 },
  { lit: 0.08, fire: 0.07, damage: 1 },
  { lit: 0, fire: 0.34, damage: 1 },
  { lit: 0, fire: 0, damage: 2, embers: true },
  { lit: 0, fire: 0, damage: 2, embers: false },
];
const ROOF_VARIANTS = [
  { lit: 0.42, ruin: 0 },
  { lit: 0.06, ruin: 0 },
  { lit: 0, ruin: 1 },
];

const LAST = 7;
/** Rauchwolken bis zu dieser Größe (px) bäckt `warm` im Leerlauf; die vier größten (≥ 368 px, zusammen 2,8 MB) folgen erst, wenn die Rauchsäulen bald erscheinen */
const PUFF_WARM_MAX = 336;
/** Meter je Stimmungsstufe (wie WORLD_WIEN.stageMeters; Test in wien.test.ts hält beides gleich) */
export const WIEN_STAGE_METERS = 260;
const FACADE_W = 2048;
const FACADE_H = 320;
const FACADE_BOTTOM = 580;
const FACADE_Y = FACADE_BOTTOM - FACADE_H;
const FACADE_PAR = 0.38;
const ROOF_W = 2048;
const ROOF_H = 200;
const ROOF_PAR = 0.16;
/** Gemalte Kulisse: Bildoberkante bei y = -84, Bildhöhe 560; gespeichert wird nur der sichtbare Teil bis BACK_H */
const BACK_TOP = -84;
const BACK_DRAW_H = 560;
const BACK_H = 476;
const BACK_PAR = 0.06;
const NEAR_PAR = 0.72;
const NEAR_SLOT = 190;
/** Oberleitung: Masten in jedem 3. Nah-Slot (Slot % 3 === 1) */
const WIRE_SPAN = NEAR_SLOT * 3;
const CARRIER_Y = 64 + MAST_TIP_Y;
const CONTACT_Y = 118;
const GROUND_H = 130;

/** Farbe unter/hinter der Kulisse (Übergang in den Stadtdunst) */
function footRgb(s: number): RGB {
  return lerpRgb(SKY_BOT[s], HAZE[s], 0.55);
}

/** Vorgebackene Verläufe/Glühen (Himmel, Fassaden, Boden, Overlay) */
interface WienGradients {
  skyFlash: HTMLCanvasElement;
  horizonFire: HTMLCanvasElement;
  facadeFire: HTMLCanvasElement;
  facadeFlash: HTMLCanvasElement;
  groundFade: HTMLCanvasElement;
  overlayTop: HTMLCanvasElement;
  overlayFire: HTMLCanvasElement;
}

function wetOf(s: number): number {
  return Math.max(RAIN[s], 0.3) * (1 - ASH[s] * 0.8);
}

export class WienRenderer implements WorldRenderer {
  private backdrop = new MirrorBackdrop(WIEN_BACKDROPS, BACK_TOP, BACK_DRAW_H, BACK_H, (s) => ({ foot: css(footRgb(s)) }));
  private facadeVar = new Map<number, FacadeTile>();
  /** angefangene Rohfassaden (werden in Teilschritten gemalt, siehe prepFacade) */
  private facadeBuild = new Map<number, FacadeBuild>();
  private roofVar = new Map<number, Tile>();
  // Stufen-Varianten: Rohvarianten (Fassaden/Dächer) malt die Vorarbeit eines Schritts, der Bake selbst ist ein zweiter,
  // kleiner Schritt; verworfene Stufen-Flächen werden für den nächsten Bake wiederverwendet (keine Neuanlage großer Bitmaps)
  private facades = new StageCache((s, reuse) => this.bakeFacade(s, reuse), { recycle: true, prep: (s) => this.prepFacade(s) });
  private roofs = new StageCache((s, reuse) => this.bakeRoof(s, reuse), { recycle: true, prep: (s) => this.prepRoof(s) });
  private reflections = new StageCache((s, reuse) => this.bakeReflection(s, reuse), { recycle: true, prep: (s) => this.prepFacade(s) });
  private readonly allStaged: StageCache[] = [this.backdrop.cache, this.facades, this.roofs, this.reflections];
  private prep = new StagePrep([...this.allStaged], LAST, { onApproach: (next) => this.backdrop.predecode(next) });
  /** Spiegelungen werden nur ab Qualität 1 gezeichnet – auf Q0 weder gebacken noch vorgehalten */
  private reflOn = true;
  private roofSlots: Array<[number, number, number]> = [];
  private roofSlotsBuilt = false;
  /** verworfene Roh-Fassaden zur Wiederverwendung (statt Neuanlage der 2,6-MB-Fläche) */
  private facadeSpares: HTMLCanvasElement[] = [];
  private lastStage = 0;
  private tilesBuilt = false;
  private tiles2Built = false;
  private warmQ = new WarmQueue();
  private warmInit = false;
  /** große Rauchgrößen (> PUFF_WARM_MAX) fehlen noch: sie werden erst kurz vor den ersten Rauchsäulen gebacken (Speicher) */
  private puffsLate = true;
  /** Sekunden bis zum nächsten Bake einer großen Rauchgröße */
  private puffsLateT = 0;

  private clouds1: HTMLCanvasElement | null = null;
  /** Wolkenkachel mit erster Hälfte der Ballen (bis `buildClouds` sie fertigstellt) */
  private cloudsPartial: Tile | null = null;
  private clouds2: HTMLCanvasElement | null = null;
  private rainSheet: HTMLCanvasElement | null = null;
  private street: HTMLCanvasElement | null = null;
  private shaft: HTMLCanvasElement | null = null;
  private shaftEdge: HTMLCanvasElement | null = null;
  private puffs: SizedSprites | null = null;
  private steam: SizedSprites | null = null;
  private flames: HTMLCanvasElement[] = [];
  /** Verläufe (Teil 3 des statischen Zeichnens), gehen in `fx` auf */
  private fxA1: Pick<WienGradients, "skyFlash" | "horizonFire" | "facadeFire"> | null = null;
  private fxA: WienGradients | null = null;
  private fxLamps: Pick<NonNullable<WienRenderer["fx"]>, "lampSmall" | "lampBig" | "lampRefl" | "roofGlow" | "ember" | "wurstel"> | null = null;
  private fx: (WienGradients & {
    lampSmall: HTMLCanvasElement;
    lampBig: HTMLCanvasElement;
    lampRefl: HTMLCanvasElement;
    roofGlow: HTMLCanvasElement;
    ember: HTMLCanvasElement;
    wurstel: HTMLCanvasElement;
    fgSmoke: HTMLCanvasElement;
    pigeonRim: HTMLCanvasElement;
    spark: HTMLCanvasElement;
  }) | null = null;

  // Nah-Sprites (in Pixeldichte k gerendert)
  private lamp: Tile | null = null;
  private lampOff: Tile | null = null;
  private mast: Tile | null = null;
  private mastBroken: Tile | null = null;
  private trees: Tile[] = [];
  private bareTrees: Tile[] = [];
  private litfass: Tile | null = null;

  private props: PropLibrary | null = null;
  private tramBodies = new TramBodies();
  private rain = new Rain(380);
  private motes = new Motes(220);
  private k = 1;
  private nearK = 0;
  private skinCtx: SkinCtx = { props: null, sprites: new PropSprites(), flash: 0, stage: 0, reduced: false };
  private emberT = 0;
  private ashT = 0;
  private debrisT = 0;
  private lightning = 0;
  private sidewalk: CanvasGradient | null = null;

  async load(assets: AssetLoader): Promise<void> {
    this.props = assets.props;
    this.skinCtx.props = assets.props;
    await Promise.all([this.backdrop.load(assets.image), assets.props.preload(["pigeon-fly", ...WIEN_PROPS]).catch(() => undefined)]);
    this.skinCtx.sprites.setProps(assets.props);
    // Zwischen den Bake-Schritten den Hauptthread freigeben (Eingaben/Frames laufen weiter, kein Long Task)
    await yieldToMain();
    this.buildCloudsA();
    await yieldToMain();
    this.buildCloudsB();
    await yieldToMain();
    this.buildCloudsC();
    await yieldToMain();
    this.buildTiles();
    await yieldToMain();
    this.buildTiles2();
    await yieldToMain();
    this.buildFxA1();
    await yieldToMain();
    this.buildFxA();
    await yieldToMain();
    this.buildFxLamps();
    await yieldToMain();
    this.buildFx();
    await yieldToMain();
    // Rohfassade der Stufe 0 (liefert die Dachfenster-Plätze) in Teilschritten – der größte Einzelblock des Weltladens
    for (let guard = 0; !this.facadeVar.has(FACADE_OF_STAGE[0]) && guard < 8; guard += 1) {
      this.prepFacade(0);
      await yieldToMain();
    }
    this.buildRoofSlots();
    await yieldToMain();
    if (!(this.nearK === this.k && this.lamp)) {
      this.buildNearA();
      await yieldToMain();
      this.buildNearB();
    }
    // erste beiden Stufen vorbereiten (Vorarbeit und Bake je als eigener Schritt)
    for (const stage of [0, 1]) {
      for (const c of this.allStaged) {
        while (!c.has(stage)) {
          await yieldToMain();
          c.step(stage);
        }
      }
    }
  }

  /**
   * Skalenwechsel (Governor, Vollbild, DPR). Idempotent: Werte innerhalb von 0,2 der zuletzt angewandten Skala ändern
   * nichts (wie PropSprites.setScale); nur eine echte Änderung backt Nah-Sprites (beim nächsten update) und
   * Hindernis-Sprites neu.
   */
  resize(dpr: number): void {
    const k = clamp(dpr, 1, 2);
    if (Math.abs(k - this.k) <= 0.2) return;
    this.k = k;
    this.skinCtx.sprites.setScale(k);
    if (this.warmInit) this.queueProps();
  }

  // --- Vorrendern ----------------------------------------------------------------------------------

  /** Statisches Zeichnen, Teil 1a: Wolken, erste Hälfte der Ballen (jeder Teil für sich gemalt und gerastert: drei kleine Schritte statt eines großen) */
  private buildCloudsA(): void {
    if (this.clouds1 || this.cloudsPartial) return;
    const t = paintCloudsA(2048, 300);
    touchCanvas(t.canvas);
    this.cloudsPartial = t;
  }

  /** Statisches Zeichnen, Teil 1b: Wolken, Rest der Ballen und Ausblendung (ohne Teil 1a malt dies die ganze Kachel) */
  private buildCloudsB(): void {
    if (this.clouds1) return;
    this.buildCloudsA();
    const t = this.cloudsPartial;
    if (!t) return;
    paintCloudsB(t);
    touchCanvas(t.canvas);
    this.cloudsPartial = null;
    this.clouds1 = t.canvas;
  }

  /** Statisches Zeichnen, Teil 1c: verkleinerte Zweitkachel der Wolken; ohne die Teile davor werden sie mit gebaut */
  private buildCloudsC(): void {
    if (this.clouds2) return;
    this.buildCloudsB();
    const cl = this.clouds1;
    if (!cl) return;
    const c2 = canvas(2048, 220, (g) => g.drawImage(cl, 0, 0, 2048, 220));
    touchCanvas(c2);
    this.clouds2 = c2;
  }

  /** Statisches Zeichnen, Teil 1 auf einmal (Fallback für Aufrufe vor/ohne `load`) */
  private buildClouds(): void {
    this.buildCloudsC();
  }

  /** Statisches Zeichnen, Teil 1b: Regenblatt, Straße (und Wolken, falls noch nicht gebaut) */
  private buildTiles(): void {
    if (this.tilesBuilt) return;
    this.tilesBuilt = true;
    this.buildClouds();
    this.rainSheet = paintRainSheet(512, 512).canvas;
    this.street = paintStreet(512, GROUND_H, 1).canvas;
  }

  /** Statisches Zeichnen, Teil 2: Schacht, Rauch-/Dampf-Größen (Hüllen), Flammen */
  private buildTiles2(): void {
    if (this.tiles2Built) return;
    this.tiles2Built = true;
    this.shaft = paintShaft(280, GROUND_H);
    this.shaftEdge = canvas(40, GROUND_H, (g) => {
      const lg = g.createLinearGradient(0, 0, 40, 0);
      lg.addColorStop(0, "rgba(0,0,0,0.7)");
      lg.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = lg;
      g.fillRect(0, 0, 40, GROUND_H);
    });
    this.puffs = new SizedSprites((s) => paintSmokePuff(s).canvas, 48, 464, 32);
    this.steam = new SizedSprites((s) => paintGlow(s, "rgba(220,225,235,0.5)").canvas, 32, 208, 16);
    this.flames = paintFlameFrames(8);
  }

  /** Statisches Zeichnen, Teil 3a: Verläufe, erste Hälfte (Himmelsblitz, Horizont-/Fassadenbrand) */
  private buildFxA1(): void {
    if (this.fxA1 || this.fxA) return;
    this.fxA1 = {
      skyFlash: ellipseGlow(1040, 520, [
        [0, "rgba(170,200,255,0.6)"],
        [0.25, "rgba(170,200,255,0.35)"],
        [1, "rgba(170,200,255,0)"],
      ], 520, 70, 520, 450),
      horizonFire: vGradient(1280, 410, [
        [0, "rgba(255,90,20,0)"],
        [0.6, "rgba(255,110,30,0.22)"],
        [1, "rgba(255,150,60,0.4)"],
      ]),
      facadeFire: vGradient(1280, FACADE_H - 60, [
        [0, "rgba(255,110,40,0)"],
        [1, "rgba(255,120,40,0.28)"],
      ]),
    };
  }

  /** Statisches Zeichnen, Teil 3b: Verläufe, zweite Hälfte (Fassadenblitz, Boden, Overlay); danach liegt `fxA` komplett vor */
  private buildFxA(): void {
    if (this.fxA) return;
    this.buildFxA1();
    const first = this.fxA1;
    if (!first) return;
    this.fxA = {
      ...first,
      facadeFlash: vGradient(1280, FACADE_H - 40, [
        [0, "rgba(150,175,230,0)"],
        [0.35, "rgba(150,175,230,0.2)"],
        [1, "rgba(150,175,230,0.14)"],
      ]),
      groundFade: vGradient(1280, GROUND_H, [
        [0, "rgba(8,10,16,0)"],
        [1, "rgba(8,10,16,0.5)"],
      ]),
      overlayTop: vGradient(1280, 260, [
        [0, "rgba(6,8,16,0.32)"],
        [1, "rgba(6,8,16,0)"],
      ]),
      overlayFire: vGradient(1280, 260, [
        [0, "rgba(255,90,30,0)"],
        [1, "rgba(255,90,30,0.12)"],
      ]),
    };
    this.fxA1 = null;
  }

  /** Statisches Zeichnen, Teile 4 und 5 auf einmal (Fallback für Aufrufe vor/ohne `load`, das sie getrennt baut) */
  private buildStatic(): void {
    this.buildFx();
    this.buildRoofSlots();
  }

  /** Statisches Zeichnen, Teil 4a: warme Lichthöfe (Laternen, Dachbrand, Glut, Würstelstand) */
  private buildFxLamps(): void {
    if (this.fxLamps || this.fx) return;
    const warm = (a: number): Array<[number, string]> => [
      [0, `rgba(255,196,110,${a})`],
      [0.25, "rgba(255,196,110,0.35)"],
      [1, "rgba(255,196,110,0)"],
    ];
    this.fxLamps = {
      lampSmall: ellipseGlow(180, 180, warm(0.55)),
      lampBig: ellipseGlow(320, 260, warm(0.55)),
      lampRefl: ellipseGlow(44, 120, warm(0.55)),
      roofGlow: ellipseGlow(220, 200, warm(0.55)),
      ember: ellipseGlow(36, 24, warm(0.55)),
      wurstel: ellipseGlow(184, 112, warm(0.55)),
    };
  }

  /** Statisches Zeichnen, Teil 4b: Rauch, Taubenlicht, Funke (`fx` komplett) */
  private buildFx(): void {
    if (this.fx) return;
    this.buildTiles();
    this.buildTiles2();
    this.buildFxA();
    this.buildFxLamps();
    const fxA = this.fxA;
    const lamps = this.fxLamps;
    if (!fxA || !lamps) return;
    const smokeTile = paintSmokePuff(256).canvas;
    this.fx = {
      ...fxA,
      ...lamps,
      fgSmoke: canvas(420, 300, (g) => g.drawImage(smokeTile, 0, 0, 420, 300)),
      pigeonRim: ellipseGlow(76, 56, [
        [0, "rgba(235,240,255,0.55)"],
        [0.5, "rgba(200,215,245,0.22)"],
        [1, "rgba(200,215,245,0)"],
      ]),
      spark: ellipseGlow(40, 40, [
        [0, "rgba(230,240,255,1)"],
        [0.3, "rgba(150,190,255,0.5)"],
        [1, "rgba(120,160,255,0)"],
      ]),
    };
    this.fxLamps = null;
  }

  /** Statisches Zeichnen, Teil 5: Dachfenster-Plätze der Fassade (malt deren Rohvariante der Stufe 0, die der erste Bake ohnehin braucht) */
  private buildRoofSlots(): void {
    if (this.roofSlotsBuilt) return;
    this.roofSlotsBuilt = true;
    this.roofSlots = this.facadeVariant(0).roofs;
  }

  private buildNear(): void {
    if (this.nearK === this.k && this.lamp) return;
    this.buildNearA();
    this.buildNearB();
  }

  /** Nah-Sprites, Teil 1: Laternen und Masten (in Pixeldichte k) */
  private buildNearA(): void {
    const k = this.k;
    this.lamp = paintLamp(k);
    this.lampOff = paintLampOff(k);
    this.mast = paintMast(k, false);
    this.mastBroken = paintMast(k, true);
  }

  /** Nah-Sprites, Teil 2: Bäume und Litfaßsäule; danach gilt `nearK` */
  private buildNearB(): void {
    const k = this.k;
    this.trees = [paintTree(k, 1), paintTree(k, 2), paintTree(k, 3)];
    this.bareTrees = [paintBareTree(k, 1), paintBareTree(k, 2)];
    this.litfass = paintLitfass(k);
    this.nearK = k;
  }

  /** Rohvariante `i` der Fassaden: fertig gemalt (ein angefangener Bau wird zu Ende geführt) */
  private facadeVariant(i: number): FacadeTile {
    let t = this.facadeVar.get(i);
    if (!t) {
      const b = this.facadeBuild.get(i) ?? this.beginFacade(i);
      while (!b.step()) {
        // Rest am Stück (nur wenn die Rohvariante sofort gebraucht wird)
      }
      t = this.finishFacade(i, b);
    }
    return t;
  }

  private beginFacade(i: number): FacadeBuild {
    const b = startFacades(FACADE_W, FACADE_H, FACADE_VARIANTS[i], 1, this.facadeSpares.pop());
    this.facadeBuild.set(i, b);
    return b;
  }

  private finishFacade(i: number, b: FacadeBuild): FacadeTile {
    this.facadeBuild.delete(i);
    touchCanvas(b.tile.canvas); // Rohbild jetzt rastern (der Bake dieser Stufe folgt als eigener, kleiner Schritt)
    this.facadeVar.set(i, b.tile);
    return b.tile;
  }

  /**
   * Vorarbeit eines Fassaden-/Spiegelungs-Bakes: die Rohvariante der Stufe in Teilschritten malen (je ein Schritt von ca.
   * 5 ms statt eines 15-20-ms-Blocks); false, wenn sie schon vorliegt.
   */
  private prepFacade(s: number): boolean {
    const i = FACADE_OF_STAGE[s];
    if (this.facadeVar.has(i)) return false;
    const b = this.facadeBuild.get(i) ?? this.beginFacade(i);
    if (b.step()) this.finishFacade(i, b);
    else touchCanvas(b.tile.canvas); // schon der angefangene Teil wird gerastert (Kosten in diesem Schritt, nicht im Zeichenframe)
    return true;
  }

  private prepRoof(s: number): boolean {
    const i = ROOF_OF_STAGE[s];
    if (this.roofVar.has(i)) return false;
    this.roofVariant(i);
    return true;
  }

  private roofVariant(i: number): Tile {
    let t = this.roofVar.get(i);
    if (!t) {
      t = paintRooftops(ROOF_W, ROOF_H, ROOF_VARIANTS[i]);
      touchCanvas(t.canvas);
      this.roofVar.set(i, t);
    }
    return t;
  }

  /** Fassaden einer Stufe mit eingerechnetem Dunst (nach unten dichter). */
  private bakeFacade(s: number, reuse: HTMLCanvasElement | null): HTMLCanvasElement {
    const src = this.facadeVariant(FACADE_OF_STAGE[s]).canvas;
    const haze = HAZE[s];
    const fh = FACADE_HAZE[s];
    return canvas(
      src.width,
      src.height,
      (g, w, h) => {
        g.drawImage(src, 0, 0);
        g.globalCompositeOperation = "source-atop";
        const grd = g.createLinearGradient(0, 60, 0, h);
        grd.addColorStop(0, css(haze, fh * 0.35));
        grd.addColorStop(1, css(haze, fh));
        g.fillStyle = grd;
        g.fillRect(0, 60, w, h - 60);
      },
      reuse,
    );
  }

  private bakeRoof(s: number, reuse: HTMLCanvasElement | null): HTMLCanvasElement {
    const src = this.roofVariant(ROOF_OF_STAGE[s]).canvas;
    const haze = HAZE[s];
    return canvas(
      src.width,
      src.height,
      (g, w, h) => {
        g.drawImage(src, 0, 0);
        g.globalCompositeOperation = "source-atop";
        const grd = g.createLinearGradient(0, 30, 0, h - 10);
        grd.addColorStop(0, css(haze, 0.12));
        grd.addColorStop(1, css(haze, ROOF_HAZE[s]));
        g.fillStyle = grd;
        g.fillRect(0, 0, w, h);
      },
      reuse,
    );
  }

  /** Gespiegelte Fassaden im nassen Pflaster (additiv zu zeichnen; Stärke je Stufe eingerechnet). */
  private bakeReflection(s: number, reuse: HTMLCanvasElement | null): HTMLCanvasElement {
    const src = this.facadeVariant(FACADE_OF_STAGE[s]).canvas;
    const a = 0.2 * wetOf(s);
    return canvas(
      src.width,
      GROUND_H,
      (g, w, h) => {
        if (a < 0.008) return;
        // Bildschirmzeile gy + ry spiegelt Fassadenzeile 322 - ry
        g.setTransform(1, 0, 0, -1, 0, 322);
        g.drawImage(src, 0, 0);
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalCompositeOperation = "destination-in";
        g.fillStyle = `rgba(0,0,0,${a.toFixed(3)})`;
        g.fillRect(0, 0, w, h);
      },
      reuse,
    );
  }

  /** Spiegelungen ein-/ausschalten (Q0 zeichnet sie nicht: gebackene Flächen freigeben, nichts vorbacken) */
  private setReflections(on: boolean): void {
    this.reflOn = on;
    if (on) this.prep.add(this.reflections);
    else {
      this.prep.remove(this.reflections);
      this.reflections.clear();
      this.reflections.dropSpare();
    }
  }

  // --- Aufwärmen -----------------------------------------------------------------------------------

  /**
   * Leerlauf-Aufwärmen (Countdown, Menü-Demo, Lauf-Anfang): backt in Zeitscheiben von ca. `budgetMs` fehlende Stufen-
   * Varianten, alle Rauch-/Dampfgrößen, die Hindernis-Sprites und die statischen Leuchtflächen vor – damit sie später
   * nicht mitten im Lauf entstehen. true = nichts mehr zu tun.
   */
  warm(budgetMs: number): boolean {
    if (!this.fx) return true; // noch nicht geladen
    if (!this.warmInit) this.initWarm();
    return this.warmQ.run(budgetMs);
  }

  private initWarm(): void {
    this.warmInit = true;
    const q = this.warmQ;
    q.add(() => this.prep.warm(this.lastStage, 0), 6);
    q.add(() => this.puffs?.prewarm(1, PUFF_WARM_MAX) ?? true, 4);
    q.add(() => this.steam?.prewarm(1) ?? true, 2);
    q.add(() => {
      warmSkinFx();
      return true;
    }, 1);
    this.queueProps();
  }

  /** Hindernis-Sprites (bekannte Maße) vorbacken – nach Skalenwechsel erneut */
  private queueProps(): void {
    const jobs = propBakeJobs(this.skinCtx.sprites);
    let i = 0;
    this.warmQ.add(() => {
      if (i < jobs.length) jobs[i++]();
      return i >= jobs.length;
    }, 3);
  }

  // --- Ambiente ------------------------------------------------------------------------------------

  update(dt: number, v: ViewState): void {
    this.buildStatic();
    if (this.nearK !== this.k) this.buildNear();
    const d = Math.min(0.05, dt);
    const st = Math.min(LAST, v.stage);
    const bl = v.stageBlend;
    // Stufen-Kacheln: aktuelle Stufe sofort, die Folgestufe erst ab ~28 % der Stufe und höchstens ein Schritt je ~6 Frames
    // (nicht am Stufenanfang, wo sich sonst alles auf den Übergang drängt); Spiegelungen nur, wenn sie gezeichnet werden
    this.lastStage = st;
    const wantRefl = v.quality > 0;
    if (wantRefl !== this.reflOn) this.setReflections(wantRefl);
    const progress = stageProgress(v.worldMeters, WIEN_STAGE_METERS);
    this.prep.setLow(v.quality === 0); // Qualität 0: Folgestufe später (ab ~60 %) und nicht im Leerlauf vorbacken (Speicher)
    this.prep.step(st, progress, bl);
    // nicht mehr benötigte Fassaden-Rohvarianten freigeben (werden bei Bedarf in ≤ 20 ms neu gemalt, die Fläche wird
    // wiederverwendet) – spart Speicher auf Mobilgeräten. Schon beim Stufenwechsel (nicht erst, wenn eine dritte Variante
    // vorliegt): so steht die Fläche der alten Variante bereit, wenn die Vorarbeit der übernächsten Stufe beginnt.
    if (this.facadeVar.size > 0 || this.facadeBuild.size > 0) {
      const a = FACADE_OF_STAGE[st];
      const b = FACADE_OF_STAGE[Math.min(LAST, st + 1)];
      const own = (this.facadeVar.has(a) ? 1 : 0) + (b !== a && this.facadeVar.has(b) ? 1 : 0);
      if (this.facadeVar.size > own) {
        for (const [key, t] of this.facadeVar) {
          if (key === a || key === b) continue;
          this.facadeVar.delete(key);
          this.facadeSpares.push(t.canvas);
        }
      }
      // ein angefangener Bau einer Variante, die nicht mehr gebraucht wird (Stufe übersprungen): Fläche zurücklegen
      if (this.facadeBuild.size > 0) {
        for (const [key, fb] of this.facadeBuild) {
          if (key === a || key === b) continue;
          this.facadeBuild.delete(key);
          this.facadeSpares.push(fb.tile.canvas);
        }
      }
    }
    // große Rauchgrößen: erst, wenn die Rauchsäulen bald gezeichnet werden (Stufe 0 ab der Hälfte; SMOKE > 0,02 ab der
    // Überblendung in Stufe 1), dann einer je ~100 ms – gerastert beim Backen, nicht im ersten Frame mit dem Rauch
    if (this.puffsLate && this.puffs && (st > 0 || progress > 0.5)) {
      this.puffsLateT -= d;
      if (this.puffsLateT <= 0) {
        this.puffsLateT = 0.1;
        this.puffsLate = !this.puffs.prewarm(1);
      }
    }
    // Blitz-Aufheller: „Blitze“-Regler (flashScale) ersetzt das Dämpfen bei „Weniger Bewegung“ (keine Doppel-Skalierung),
    // bei „Weniger Bewegung“ aber nie über 0,3 – auch wenn der Aufrufer den Regler nicht kappt (flashFactor)
    const target = (v.vars.lightning ?? 0) * flashFactor(v, 0.25);
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

  // --- Hintergrund ---------------------------------------------------------------------------------

  drawBackground(g: CanvasRenderingContext2D, v: ViewState): void {
    this.buildStatic();
    if (!this.lamp) this.buildNear();
    const fx = this.fx;
    if (!fx) return;
    const st = Math.min(LAST, v.stage);
    const bl = v.stageBlend;
    const nxt = Math.min(LAST, st + 1);
    const W = v.w;
    const gy = v.groundY;
    const fl = this.lightning;
    const haze = stageRgb(HAZE, st, bl);

    // 1) Gemalte Fernkulisse (Stephansdom, Rathaus, Riesenrad …) mit Stufen-Überblendung
    if (this.backdrop.ready) {
      const scroll = v.dist * BACK_PAR;
      this.backdrop.draw(g, st, scroll);
      if (bl > 0.002 && st < LAST) this.backdrop.draw(g, nxt, scroll, bl);
      if (fl > 0.02) {
        g.globalCompositeOperation = "lighter";
        this.backdrop.draw(g, bl > 0.5 ? nxt : st, scroll, fl * 0.45);
        g.globalCompositeOperation = "source-over";
      }
      g.fillStyle = css(lerpRgb(footRgb(st), footRgb(nxt), bl));
      g.fillRect(0, BACK_H, W, gy - BACK_H);
    } else {
      const sky = g.createLinearGradient(0, 0, 0, gy);
      sky.addColorStop(0, css(stageRgb(SKY_TOP, st, bl)));
      sky.addColorStop(1, css(stageRgb(SKY_BOT, st, bl)));
      g.fillStyle = sky;
      g.fillRect(0, 0, W, gy);
    }

    // 2) Ziehende Sturmwolken
    const cl = stageVal(CLOUDS, st, bl);
    if (this.clouds1 && this.clouds2 && cl > 0.01) {
      g.globalAlpha = cl;
      blitRow(g, this.clouds1, v.dist * 0.03 + v.time * 22, -40, W);
      g.globalAlpha = cl * 0.6;
      blitRow(g, this.clouds2, v.dist * 0.05 + v.time * 38 + 700, 60, W);
      g.globalAlpha = 1;
    }
    // Blitz-Leuchten am Himmel + ferner Blitzstrahl
    if (fl > 0.02) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = Math.min(1, fl * 1.4);
      g.drawImage(fx.skyFlash, Math.round((v.vars.boltX ?? 640) - 520), 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    const far = (v.vars.farBolt ?? 0) * flashFactor(v);
    if (far > 0.05 && !v.reducedMotion) this.drawFarBolt(g, v.vars.boltX ?? 640, far, v.vars.boltSeed ?? 1);

    // 3) Brandschein am Horizont + Rauchsäulen
    const fire = stageVal(FIRE, st, bl);
    if (fire > 0.01) {
      const flick = v.reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(v.time * 3.1) * Math.sin(v.time * 7.3 + 1);
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = Math.min(1, fire * flick);
      g.drawImage(fx.horizonFire, 0, 180);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    const smoke = stageVal(SMOKE, st, bl);
    if (smoke > 0.02) this.drawSmokeColumns(g, v, smoke);

    // 4) Dunst + ferne Dachlandschaft (Dunst eingebacken)
    g.fillStyle = css(haze, 0.22);
    g.fillRect(0, 0, W, gy);
    const roofY = gy - ROOF_H + 10;
    blitRow(g, this.roofs.get(st), v.dist * ROOF_PAR, roofY, W);
    if (bl > 0.002 && st < LAST) {
      g.globalAlpha = bl;
      blitRow(g, this.roofs.get(nxt), v.dist * ROOF_PAR, roofY, W);
      g.globalAlpha = 1;
    }

    // 5) Gründerzeit-Fassaden (Dunst eingebacken)
    const fScroll = v.dist * FACADE_PAR;
    blitRow(g, this.facades.get(st), fScroll, FACADE_Y, W);
    if (bl > 0.002 && st < LAST) {
      g.globalAlpha = bl;
      blitRow(g, this.facades.get(nxt), fScroll, FACADE_Y, W);
      g.globalAlpha = 1;
    }
    if (fl > 0.02) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = Math.min(1, fl);
      g.drawImage(fx.facadeFlash, 0, FACADE_Y + 40);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    if (fire > 0.05) {
      const flick = v.reducedMotion ? 1 : 0.8 + 0.2 * Math.sin(v.time * 5.3) * Math.sin(v.time * 2.1);
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = Math.min(1, fire * flick);
      g.drawImage(fx.facadeFire, 0, FACADE_Y + 60);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    // Brennende Dachstühle / Rauchfahnen (Ruinen: nur noch Rauch aus den Trümmern)
    if (fire > 0.15 || smoke > 0.3) {
      const ruinA = FACADE_VARIANTS[FACADE_OF_STAGE[st]].damage === 2 ? 1 : 0;
      const ruinB = FACADE_VARIANTS[FACADE_OF_STAGE[nxt]].damage === 2 ? 1 : 0;
      const ruin = ruinA + (ruinB - ruinA) * bl;
      this.drawRoofFires(g, v, fire * (1 - ruin), smoke, fScroll, FACADE_Y + ruin * 70);
    }

    // Regenvorhänge
    const rainK = stageVal(RAIN, st, bl);
    if (rainK > 0.05) this.drawRainSheets(g, v, rainK);

    // 6) Gehsteigkante
    if (!this.sidewalk) {
      this.sidewalk = g.createLinearGradient(0, FACADE_BOTTOM, 0, gy);
      this.sidewalk.addColorStop(0, "#2a2e38");
      this.sidewalk.addColorStop(1, "#3b404c");
    }
    g.fillStyle = this.sidewalk;
    g.fillRect(0, FACADE_BOTTOM, W, gy - FACADE_BOTTOM);
    g.fillStyle = "rgba(180,195,225,0.18)";
    g.fillRect(0, gy - 3, W, 1.5);

    // 7) Nahe Straßenmöbel + Oberleitung
    this.drawNear(g, v);
    this.drawWires(g, v);
  }

  private drawRainSheets(g: CanvasRenderingContext2D, v: ViewState, rainK: number): void {
    const sheet = this.rainSheet;
    if (!sheet) return;
    const H = sheet.height;
    const off = Math.round(mod(v.time * 900, H));
    const scroll = v.dist * 0.45 - v.time * 120;
    g.globalAlpha = Math.min(1, rainK * 1.1);
    for (let y0 = off - H; y0 < FACADE_BOTTOM; y0 += H) {
      const sy = Math.max(0, -y0);
      const h = Math.min(H, FACADE_BOTTOM - y0) - sy;
      if (h > 0) blitRange(g, sheet, scroll, 0, v.w, y0 + sy, h, sy);
    }
    g.globalAlpha = 1;
  }

  private drawRoofFires(g: CanvasRenderingContext2D, v: ViewState, fire: number, smoke: number, scroll: number, fy: number): void {
    const fx = this.fx;
    const puffs = this.puffs;
    if (!fx || !puffs) return;
    const W = FACADE_W;
    const off = mod(scroll, W);
    const t = v.reducedMotion ? 0 : v.time;
    const k = fire > 0.15 ? Math.min(1, (fire - 0.1) * 1.4) : 0;
    const smokeA = Math.min(1, 0.35 + smoke) * 0.8;
    const nFlames = this.flames.length;
    for (const [rx, rtop, rw] of this.roofSlots) {
      const hv = hash(rx * 0.013 + 7);
      if (hv > 0.5) continue;
      for (let rep = 0; rep <= W; rep += W) {
        const x = rx - off + rep;
        if (x + rw < -120 || x > v.w + 120) continue;
        const cx = x + rw * (0.3 + hv * 0.8);
        const y = fy + rtop + 4;
        if (k > 0) {
          g.globalCompositeOperation = "lighter";
          g.globalAlpha = 0.55 * k;
          blitAt(g, fx.roofGlow, cx, y - 20);
          if (nFlames) {
            const fr = this.flames[Math.floor(t * 12 + rx * 0.37) % nFlames];
            g.globalAlpha = k;
            g.drawImage(fr, Math.round(cx - fr.width / 2), Math.round(y - fr.height + 6));
          }
          g.globalCompositeOperation = "source-over";
        }
        // Rauchfahne
        const np = v.quality === 0 ? 2 : 4;
        for (let p2 = 0; p2 < np; p2 += 1) {
          const life = (v.time * 0.16 + p2 / np + hv) % 1;
          const sz = 50 + life * 170;
          g.globalAlpha = (1 - life) * Math.min(1, life * 4) * smokeA;
          puffs.draw(g, sz, cx + life * 90, y - 30 - life * 230);
        }
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  private drawFarBolt(g: CanvasRenderingContext2D, bx: number, k: number, seed: number): void {
    g.save();
    g.globalCompositeOperation = "lighter";
    g.lineCap = "round";
    for (const [lw, a] of [
      [7, 0.25],
      [2.2, 0.95],
    ] as Array<[number, number]>) {
      g.strokeStyle = `rgba(200,220,255,${(a * k).toFixed(3)})`;
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
    const puffs = this.puffs;
    if (!puffs) return;
    const span = 520;
    const scroll = v.dist * 0.1;
    const first = Math.floor(scroll / span) - 1;
    for (let s = first; s < first + 5; s += 1) {
      if (hash(s * 3.7) > 0.72) continue;
      const baseX = s * span + hash(s) * 300 - scroll;
      const baseY = 470 - hash(s * 1.3) * 40;
      const np = v.quality === 0 ? 3 : 6;
      for (let p = 0; p < np; p += 1) {
        const life = (v.time * 0.09 + p / np + hash(s + p)) % 1;
        const size = 90 + life * 370;
        const x = baseX + life * 260 + Math.sin(life * 5 + s) * 20;
        if (x + size / 2 < 0 || x - size / 2 > v.w) continue;
        g.globalAlpha = smoke * (1 - life) * Math.min(1, life * 5) * 0.9;
        puffs.draw(g, size, x, baseY - life * 460);
      }
    }
    g.globalAlpha = 1;
  }

  private drawNear(g: CanvasRenderingContext2D, v: ViewState): void {
    const fx = this.fx;
    if (!fx) return;
    const st = Math.min(LAST, v.stage);
    const bl = v.stageBlend;
    const lamps = stageVal(LAMPS, st, bl);
    const scroll = v.dist * NEAR_PAR;
    const first = Math.floor((scroll - 240) / NEAR_SLOT);
    const last = Math.floor((scroll + v.w + 240) / NEAR_SLOT);
    const base = v.groundY - 6;
    const wind = stageVal(WIND, st, bl);
    const ruined = st >= 6;
    const bare = st >= 5 || (st === 4 && bl > 0.5);
    const sway = v.quality === 2 && !v.reducedMotion;
    for (let s = first; s <= last; s += 1) {
      const slot = mod(s, 3);
      const hv = hash(s * 7.13 + 1);
      if (slot === 1) {
        // Oberleitungsmast (Achse exakt auf dem Slot → Fahrleitung trifft den Ausleger)
        const x = Math.round(s * NEAR_SLOT - scroll);
        const broken = ruined && hash(s * 3.3 + 2) < 0.45;
        const spr = broken ? this.mastBroken : this.mast;
        if (spr) g.drawImage(spr.canvas, x - MAST_AX, base + 20 - MAST_H, MAST_W, MAST_H);
        continue;
      }
      const x = Math.round(s * NEAR_SLOT - scroll + (hash(s * 2.9) - 0.5) * 50);
      if (slot === 0) {
        // Laterne (Stufe 2: jede flackert für sich)
        const flick = v.reducedMotion || st !== 2 ? 1 : Math.sin(v.time * 23 + s * 2.3) > -0.6 ? 1 : 0.2;
        const on = lamps * flick * (hash(s * 5.1) < 0.12 && st >= 2 ? 0 : 1);
        const spr = on > 0.1 ? this.lamp : this.lampOff;
        if (spr) g.drawImage(spr.canvas, x - 30, base - 300, 60, 320);
        if (on > 0.05) {
          g.globalCompositeOperation = "lighter";
          g.globalAlpha = Math.min(1, on * 0.8);
          blitAt(g, fx.lampSmall, x, base - 240);
          g.globalAlpha = on * 0.25;
          blitAt(g, fx.lampBig, x, base - 70);
          g.globalAlpha = 1;
          g.globalCompositeOperation = "source-over";
        }
        continue;
      }
      // Slot 2: Platane oder Litfaßsäule
      if (hv < 0.55 && this.trees.length) {
        const tr = bare ? this.bareTrees[mod(s, this.bareTrees.length)] : this.trees[mod(s, this.trees.length)];
        if (sway) {
          const sk = (Math.sin(v.time * 1.7 + s) * 0.5 + 0.5) * wind * 0.00018;
          g.save();
          g.translate(x, base + 20);
          g.transform(1, 0, sk, 1, 0, 0);
          g.drawImage(tr.canvas, -100, -300, 200, 300);
          g.restore();
        } else g.drawImage(tr.canvas, x - 100, base - 280, 200, 300);
      } else if (hv < 0.78 && this.litfass && !(ruined && hv > 0.7)) {
        g.drawImage(this.litfass.canvas, x - 35, base - 170, 70, 190);
        if (lamps > 0.3) {
          g.globalCompositeOperation = "lighter";
          g.globalAlpha = lamps * 0.35;
          blitAt(g, fx.lampSmall, x, base - 110);
          g.globalAlpha = 1;
          g.globalCompositeOperation = "source-over";
        }
      }
    }
  }

  /** Fahrleitung zwischen den Masten: Tragseil, Hänger, Fahrdraht; später gerissen und baumelnd. */
  private drawWires(g: CanvasRenderingContext2D, v: ViewState): void {
    const fx = this.fx;
    const st = Math.min(LAST, v.stage);
    const scroll = v.dist * NEAR_PAR;
    const intact = stageVal(WIRES, st, v.stageBlend);
    const stubs = st >= 6;
    const m0 = Math.floor((scroll - 400) / WIRE_SPAN);
    const tip = (m: number): number => Math.round((m * 3 + 1) * NEAR_SLOT - scroll) - MAST_AX + MAST_TIP_X;
    const mastOk = (m: number): boolean => !(stubs && hash((m * 3 + 1) * 3.3 + 2) < 0.45);
    g.save();
    g.strokeStyle = "rgba(12,14,20,0.8)";
    g.lineWidth = 1.4;
    g.beginPath();
    const dangling: Array<[number, number]> = [];
    for (let m = m0; m <= m0 + 4; m += 1) {
      const x0 = tip(m);
      const x1 = tip(m + 1);
      if (x1 < -40 || x0 > v.w + 40) continue;
      const ok = hash(m * 5.7 + 1) < intact && mastOk(m) && mastOk(m + 1);
      if (ok) {
        g.moveTo(x0, CONTACT_Y);
        g.lineTo(x1, CONTACT_Y);
        g.moveTo(x0, CARRIER_Y);
        g.quadraticCurveTo((x0 + x1) / 2, CARRIER_Y + 30, x1, CARRIER_Y);
        for (let d = 1; d < 8; d += 1) {
          const u = d / 8;
          const xx = x0 + (x1 - x0) * u;
          g.moveTo(xx, CARRIER_Y + 60 * u * (1 - u));
          g.lineTo(xx, CONTACT_Y);
        }
      } else {
        // gerissen: beide Enden hängen herab (ab Stufe 6 nur noch kurze Stümpfe)
        const len = stubs ? 40 + hash(m * 2.1) * 40 : 150 + hash(m * 2.1) * 90;
        const ends: Array<[number, number, number]> = [
          [x0, 1, len],
          [x1, -1, len * (0.7 + hash(m * 4.3) * 0.5)],
        ];
        for (const [xa, dir, l] of ends) {
          if (dir === -1 && !mastOk(m + 1)) continue;
          if (dir === 1 && !mastOk(m)) continue;
          const ex = xa + dir * (30 + l * 0.35);
          const ey = CONTACT_Y + l;
          g.moveTo(xa, CARRIER_Y);
          g.bezierCurveTo(xa + dir * 30, CARRIER_Y + l * 0.5, ex - dir * 10, ey - 20, ex, ey);
          g.moveTo(xa, CONTACT_Y);
          g.quadraticCurveTo(xa + dir * 10, CONTACT_Y + l * 0.6, ex - dir * 18, ey - 12);
          if (!stubs) dangling.push([ex, ey]);
        }
      }
    }
    g.stroke();
    // Isolatoren
    g.fillStyle = "#20242d";
    for (let m = m0; m <= m0 + 5; m += 1) {
      if (!mastOk(m)) continue;
      const x = tip(m);
      if (x > -10 && x < v.w + 10) g.fillRect(x - 3, CARRIER_Y - 4, 6, 8);
    }
    // Blitz spiegelt sich im Fahrdraht
    if (this.lightning > 0.05) {
      g.strokeStyle = `rgba(200,220,255,${(this.lightning * 0.7).toFixed(3)})`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, CONTACT_Y - 1);
      g.lineTo(v.w, CONTACT_Y - 1);
      g.stroke();
    }
    // Funken an den gerissenen Drahtenden (Sturm/Brand), bei reduzierter Bewegung ruhig
    if (fx && dangling.length && st >= 2 && st <= 5) {
      g.globalCompositeOperation = "lighter";
      for (let i = 0; i < dangling.length; i += 1) {
        const [ex, ey] = dangling[i];
        const burst = v.reducedMotion ? 0.35 : Math.max(0, Math.sin(v.time * 7 + i * 2.7 + ex * 0.01)) ** 6;
        if (burst < 0.05) continue;
        g.globalAlpha = burst;
        blitAt(g, fx.spark, ex, ey);
        if (!v.reducedMotion) {
          g.fillStyle = "rgba(220,235,255,0.95)";
          for (let p = 0; p < 5; p += 1) {
            const a = hash(i * 13 + p + Math.floor(v.time * 18)) * Math.PI;
            const r = 6 + hash(p * 3.1 + i + Math.floor(v.time * 18)) * 18;
            g.fillRect(ex + Math.cos(a) * r, ey + Math.sin(a) * r * 0.8, 2, 2);
          }
        }
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    g.restore();
  }

  // --- Boden ---------------------------------------------------------------------------------------

  drawGround(g: CanvasRenderingContext2D, v: ViewState, pits: ReadonlyArray<{ x0: number; x1: number; skin: string }>): void {
    const fx = this.fx;
    const street = this.street;
    if (!fx || !street) return;
    const gy = v.groundY;
    const H = v.h - gy;
    const st = Math.min(LAST, v.stage);
    const bl = v.stageBlend;
    const nxt = Math.min(LAST, st + 1);
    const segs = groundSegments(pits, v.w);
    // Lücken (Gully/Baugrube)
    for (const p of pits) this.drawPit(g, v, p.x0, p.x1);
    for (let i = 0; i < segs.length; i += 2) {
      const a = segs[i];
      const b = segs[i + 1];
      if (b <= a) continue;
      blitRange(g, street, v.dist, a, b, gy);
      if (a > 0) {
        g.fillStyle = "#4b505c";
        g.fillRect(Math.round(a) - 3, gy, 4, H);
      }
      if (b < v.w) {
        g.fillStyle = "#0b0d12";
        g.fillRect(Math.round(b) - 2, gy, 4, H);
      }
    }
    // Spiegelung der Fassaden im nassen Pflaster (vorgebacken, additiv)
    if (v.quality > 0) {
      const rA = this.reflections.get(st);
      const rB = bl > 0.002 && st < LAST ? this.reflections.get(nxt) : null;
      const rs = v.dist * FACADE_PAR;
      g.globalCompositeOperation = "lighter";
      for (let i = 0; i < segs.length; i += 2) {
        g.globalAlpha = rB ? 1 - bl : 1;
        blitRange(g, rA, rs, segs[i], segs[i + 1], gy);
        if (rB) {
          g.globalAlpha = bl;
          blitRange(g, rB, rs, segs[i], segs[i + 1], gy);
        }
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
      for (let i = 0; i < segs.length; i += 2) blitSlice(g, fx.groundFade, segs[i], segs[i + 1], gy);
    }
    // Laternen-Spiegelung auf nassem Pflaster
    const lamps = stageVal(LAMPS, st, bl);
    const wet = Math.max(stageVal(RAIN, st, bl), 0.35);
    if (lamps > 0.05) {
      const scroll = v.dist * NEAR_PAR;
      const first = Math.floor((scroll - 100) / NEAR_SLOT);
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = lamps * wet * 0.35;
      for (let s = first; s <= first + 9; s += 1) {
        if (mod(s, 3) !== 0) continue;
        const x = s * NEAR_SLOT - scroll + (hash(s * 2.9) - 0.5) * 50;
        if (inPit(pits, x)) continue;
        g.drawImage(fx.lampRefl, Math.round(x - 22), gy + 2);
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    // Blitz spiegelt sich im nassen Boden
    if (this.lightning > 0.03) {
      g.globalCompositeOperation = "lighter";
      g.fillStyle = `rgba(160,185,240,${(0.18 * this.lightning * wet).toFixed(3)})`;
      g.fillRect(0, gy, v.w, H);
      g.globalCompositeOperation = "source-over";
    }
    // Asche / Trümmer in späten Stufen
    const ash = stageVal(ASH, st, bl);
    if (ash > 0.05) {
      g.fillStyle = `rgba(92,90,94,${(0.45 * ash).toFixed(3)})`;
      for (let i = 0; i < segs.length; i += 2) g.fillRect(segs[i], gy, segs[i + 1] - segs[i], H);
      const fire = stageVal(FIRE, st, bl);
      const first = Math.floor(v.dist / 140);
      for (let s = first; s <= first + 10; s += 1) {
        if (hash(s * 3.3) > ash * 0.8) continue;
        const x = s * 140 - v.dist + hash(s) * 100;
        if (inPit(pits, x)) continue;
        const y = gy + 10 + hash(s * 1.7) * (H - 30);
        g.fillStyle = hash(s * 9.1) < 0.5 ? "#5b3226" : "#3d3a38";
        g.save();
        g.translate(x, y);
        g.rotate(hash(s * 4.4) * 3);
        g.fillRect(-9, -4, 18, 8);
        g.restore();
        if (fire > 0.2 && hash(s * 6.6) < 0.4) {
          g.globalCompositeOperation = "lighter";
          g.globalAlpha = fire * 0.5 * (v.reducedMotion ? 1 : 0.7 + 0.3 * Math.sin(v.time * 4 + s));
          g.drawImage(fx.ember, Math.round(x - 18), Math.round(y - 12));
          g.globalAlpha = 1;
          g.globalCompositeOperation = "source-over";
        }
      }
    }
    // Obere Kante (nasser Glanz)
    g.fillStyle = `rgba(190,205,235,${(0.22 + this.lightning * 0.4).toFixed(3)})`;
    for (let i = 0; i < segs.length; i += 2) g.fillRect(segs[i], gy, segs[i + 1] - segs[i], 2);
  }

  private drawPit(g: CanvasRenderingContext2D, v: ViewState, x0: number, x1: number): void {
    const shaft = this.shaft;
    if (!shaft) return;
    const gy = v.groundY;
    const w = x1 - x0;
    // Ziegelwand in der Tiefe (scrollt mit dem Boden)
    blitRange(g, shaft, v.dist, x0, x1, gy);
    g.fillStyle = "rgba(170,200,240,0.35)";
    for (let i = 0; i < w / 30; i += 1) {
      const gx = x0 + ((i * 37 + v.time * 30) % w);
      g.fillRect(gx, v.h - 24 + (i % 3) * 5, 10, 1.5);
    }
    if (this.shaftEdge) g.drawImage(this.shaftEdge, Math.round(x0), gy);
    // Dampf
    if (this.steam && !v.reducedMotion) {
      for (let i = 0; i < 5; i += 1) {
        const life = (v.time * 0.45 + i / 5) % 1;
        const cx = x0 + w * (0.3 + 0.4 * hash(i * 3.1)) + Math.sin(life * 6 + i) * 12;
        g.globalAlpha = (1 - life) * Math.min(1, life * 4) * 0.45;
        this.steam.draw(g, 60 + life * 140, cx, gy + 10 - life * 190);
      }
      g.globalAlpha = 1;
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

  // --- Entitäten -----------------------------------------------------------------------------------

  drawEntity(g: CanvasRenderingContext2D, e: Ent, sx: number, sy: number, v: ViewState): boolean {
    const c = this.skinCtx;
    const P = this.props;
    const gy = v.groundY;
    switch (e.skin) {
      case "tram":
        drawTram(g, e, sx, sy, v, c, this.tramBodies);
        return true;
      case "tram-roof":
      case "manhole":
        return true;
      case "fiaker":
        drawFiaker(g, e, sx, sy, v, c);
        return true;
      case "pigeon":
        drawPigeon(g, e, sx, sy, v, c, this.fx?.pigeonRim ?? null);
        return true;
      case "puddle":
        drawPuddle(g, e, sx, v, c);
        return true;
      case "bolt":
        drawBolt(g, e, sx, sy, v, c);
        return true;
      case "poller":
        drawPoller(g, sx, sy, e.w, e.h, gy, c);
        return true;
      case "bauzaun":
        drawBauzaun(g, sx, sy, e.w, e.h, gy, v.time, v.reducedMotion, c);
        return true;
      case "rubble":
        drawRubble(g, e, sx, sy, gy, v.time, c);
        return true;
      case "scaffold":
        drawScaffold(g, e, sx, sy, v);
        return true;
      case "beam":
        drawBurningBeam(g, e, sx, sy, v, c);
        return true;
      case "sign":
        drawSign(g, e, sx, sy, v, c);
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
    const fx = this.fx;
    if (!fx) return;
    g.save();
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.5;
    g.drawImage(fx.wurstel, Math.round(sx + e.w / 2 - fx.wurstel.width / 2), Math.round(sy - 10));
    g.restore();
    // Dampf vom Grill
    if (this.steam && !v.reducedMotion) {
      for (let i = 0; i < 3; i += 1) {
        const life = (v.time * 0.6 + i / 3) % 1;
        g.globalAlpha = (1 - life) * 0.35;
        this.steam.draw(g, 30 + life * 60, sx + e.w * 0.6 + life * 20, sy - life * 90);
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

  // --- Vordergrund / Endstufe ----------------------------------------------------------------------

  drawForeground(g: CanvasRenderingContext2D, v: ViewState): void {
    const st = Math.min(LAST, v.stage);
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
    const fx = this.fx;
    if (smoke > 0.2 && fx) {
      const scroll = v.dist * 1.15 + v.time * 30;
      g.globalAlpha = (smoke - 0.2) * 0.35;
      for (let i = 0; i < 4; i += 1) {
        const x = mod(i * 460 - scroll, 1840) - 280;
        g.drawImage(fx.fgSmoke, Math.round(x), v.groundY - 170 + (i % 2) * 40);
      }
      g.globalAlpha = 1;
    }
    // Blitz-Aufhellung der ganzen Szene
    if (this.lightning > 0.03) {
      g.save();
      g.globalCompositeOperation = "lighter";
      g.fillStyle = `rgba(120,140,190,${(0.12 * this.lightning).toFixed(3)})`;
      g.fillRect(0, 0, v.w, v.h);
      g.restore();
    }
  }

  drawOverlay(g: CanvasRenderingContext2D, v: ViewState): void {
    const fx = this.fx;
    if (!fx) return;
    // Farbstimmung: oben Gewitterdunkel, unten Brandschein
    g.drawImage(fx.overlayTop, 0, 0);
    const fire = stageVal(FIRE, Math.min(LAST, v.stage), v.stageBlend);
    if (fire > 0.1) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = Math.min(1, fire);
      g.drawImage(fx.overlayFire, 0, v.h - 260);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
  }
}

function inPit(pits: ReadonlyArray<{ x0: number; x1: number }>, x: number): boolean {
  for (const p of pits) if (x > p.x0 - 20 && x < p.x1 + 20) return true;
  return false;
}
