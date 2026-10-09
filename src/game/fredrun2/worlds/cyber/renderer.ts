/**
 * Cyber-Wien 2099 – WorldRenderer.
 * Ebenen (hinten → vorne): Himmel/Sterne/Synthwave-Sonne bzw. Singularität · Laserraster (0.01) · ferne Skyline mit
 * Donauturm, DC-Tower & Neon-Riesenrad (0.05) · Hologramm-Stephansdom (0.07) · Schwebeverkehr · ferner Datenregen (0.15)
 * · Server-Monolithen (0.32, Serverherz) · Glas-Wolkenkratzer mit Holo-Reklamen (0.2) · Hintergrund-Drohnen · Magnetbahn-
 * Pylonen (0.55) · naher Datenregen · Tron-Gitter in Boden UND Decke (1.0) · Vordergrund-Datenpartikel.
 * Performance: Ebenen sind pro Stufe vorgebacken (StageCache/Staged) und werden ganzzahlig geblittet; Leuchten nur über
 * vorgerenderte Glow-Sprites (additiv), kein shadowBlur im Frame.
 */
import { makeCanvas } from "../../draw-utils";
import type { AssetLoader, Ent, PropLibrary, ViewState, WorldRenderer } from "../../types";
import { blitTiled, colorWithAlpha, ctxOf, glowAt, paint, touchCanvas, type Ctx2D } from "../shared-b/canvas";
import { h1, mod, mulberry, stageVal } from "../shared-b/color";
import { flashFactor } from "../shared-b/flash";
import { StageCache, StagePrep, gradedCache, rgbaOf, stageProgress, type StageTint } from "../shared-b/layers";
import { WarmQueue } from "../shared-b/warm";
import { yieldBetweenBakes } from "../shared-b/yield";
import { GUEST_PROP_IDS } from "../shared-a/guests";
import {
  adIcons,
  cathedralSource,
  ceilBase,
  edgeGlow,
  farSkyline,
  floorBase,
  holoSteps,
  midCity,
  nearPylons,
  primeProp,
  rainStrips,
  reflectionTile,
  serverMonoliths,
  singularitySprite,
  starField,
  synthSun,
  paintOpaque,
  type Board,
  type PrimeSink,
  type Pylon,
} from "./backdrop";
import {
  CYAN,
  DOME,
  GLITCH,
  LIGHTS,
  MAGENTA,
  MAX_STAGE,
  MINT,
  PAL,
  RAIN,
  RASTER,
  SERVER,
  SING,
  STAGES,
  STARS,
  SUN,
  TAU,
  TRAFFIC,
  VIOLET,
} from "./palette";
import {
  bakePropSprites,
  drawBarrier,
  drawBeamFence,
  drawChip,
  drawCrystal,
  drawDrone,
  drawGlitchCube,
  drawHall,
  drawHint,
  drawHover,
  drawLaser,
  drawPhaseGate,
  drawPlasma,
  drawPortal,
  drawRack,
  hoverDensity,
  makeSkinAssetsSteps,
  HOVER_PROP,
  type CyberSkinAssets,
  type SkinCtx,
} from "./skins";

/** Meter je Stimmungsstufe (wie WORLD_CYBER.stageMeters; Test in cyber.test.ts hält beides gleich) */
export const CYBER_STAGE_METERS = 280;

/** Gerät meldet weniger als 4 GB Arbeitsspeicher (Chromium: `navigator.deviceMemory`); sonst false */
const LOW_MEMORY = typeof navigator !== "undefined" && ((navigator as { deviceMemory?: number }).deviceMemory ?? 8) < 4;

export const CYBER_PROPS = [
  "drone-hover",
  "glitch-cube",
  "server-rack",
  "data-coin",
  "landmark-cathedral",
  HOVER_PROP,
  ...GUEST_PROP_IDS,
];

/** Props, die `bakePropSprites` schon beim Laden auf eigene Sprites malt (Reihenfolge wie dort) */
const CYBER_BAKE_PROPS = ["data-coin", "glitch-cube", "server-rack"] as const;

/** Props, die erst im Lauf zum ersten Mal gezeichnet werden (alle anderen entstehen schon beim Laden): Erstkosten im Aufwärmen */
export const CYBER_RUN_PROPS = ["drone-hover", HOVER_PROP] as const;

const GUESTS = new Set(["odo", "madinger", "jqa", "luki"]);
const SING_X = 900;
const SING_Y = 300;

/** Parallax-Ebene, deren Stufen-Varianten Einfärbung, Lichter und Dunst bereits enthalten (1 Blit pro Frame). */
export interface BakedLayer {
  cache: StageCache;
  w: number;
  h: number;
  y: number;
  factor: number;
}

export function bakedLayer(
  body: HTMLCanvasElement,
  lights: HTMLCanvasElement,
  y: number,
  factor: number,
  tint: (s: number) => StageTint,
  lightK: (s: number) => number,
  extra?: (g: Ctx2D, s: number, w: number, h: number) => void,
): BakedLayer {
  const w = body.width;
  const h = body.height;
  // Einfärben direkt auf der Fläche (statt über eine Zwischenfläche) und verworfene Stufenflächen wiederverwenden: kein
  // Neuanlegen großer Bitmaps je Bake; das Bild ist dasselbe wie „getönte Kopie + Lichter“. Die Variante entsteht in zwei
  // Schritten (Körper + Tönung · Lichter + Zusatz), jeder wird sofort gerastert (`gradedCache`): kein Bake belegt einen Frame
  // am Stück.
  const lit = (c: HTMLCanvasElement, s: number): void => {
    const g = ctxOf(c);
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = Math.min(1, lightK(s));
    g.drawImage(lights, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    extra?.(g, s, w, h);
  };
  const cache = gradedCache(
    (s, reuse, grade) => {
      const c = paint(
        w,
        h,
        (g) => {
          g.drawImage(body, 0, 0);
          tintInPlace(g, w, h, tint(s));
        },
        reuse,
      );
      if (grade) lit(c, s);
      return c;
    },
    lit,
  );
  return { cache, w, h, y, factor };
}

/** Glitch-Stärke der Stufe (`GLITCH`), ab der die RGB-Split-Kopien vorbereitet werden (der Split zeichnet ab 0,45) */
const SPLIT_FROM = 0.3;

/** Streifen je RGB-Split-Kopie: jede Kopie entsteht in so vielen Schritten (je Schritt ein Viertel der Rasterkosten statt ca. 13 ms am Stück) */
export const SPLIT_STRIPS = 4;
/** Schritte, bis beide Kopien (rot, cyan) einer Stufe bemalt sind */
const SPLIT_STEPS = SPLIT_STRIPS * 2;

/**
 * Waagerechter Streifen [y0, y1) von `dst`: Silhouette von `src` in Vollfarbe (Ergebnis wie `tintCopy`, aber in Teilen und auf
 * einer bestehenden Fläche gleicher Größe). Der Rest der Fläche bleibt unberührt, sie ist also zu jedem Zeitpunkt zeichenbar
 * (auch mitten in der Auffrischung nach einem Stufenwechsel).
 */
function tintStrip(dst: HTMLCanvasElement, src: HTMLCanvasElement, color: string, y0: number, y1: number): void {
  const g = ctxOf(dst);
  const w = dst.width;
  const h = y1 - y0;
  g.save();
  g.clearRect(0, y0, w, h);
  g.drawImage(src, 0, y0, w, h, 0, y0, w, h);
  g.globalCompositeOperation = "source-atop";
  g.fillStyle = color;
  g.fillRect(0, y0, w, h);
  g.restore();
}

/** Einfärbung wie `tinted` (shared-b/layers), aber auf den schon gemalten Inhalt der Fläche (nur wo Pixel sind: source-atop) */
function tintInPlace(g: Ctx2D, w: number, h: number, t: StageTint): void {
  g.globalCompositeOperation = "source-atop";
  if (t.night && t.night.a > 0.001) {
    g.globalAlpha = Math.min(1, t.night.a);
    g.fillStyle = t.night.color;
    g.fillRect(0, 0, w, h);
    g.globalAlpha = 1;
  }
  if (t.haze && (t.haze.aTop > 0.001 || t.haze.aBottom > 0.001)) {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, rgbaOf(t.haze.color, t.haze.aTop));
    grd.addColorStop(1, rgbaOf(t.haze.color, t.haze.aBottom));
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  }
  if (t.shade && t.shade.a > 0.001) {
    const grd = g.createLinearGradient(0, h * t.shade.from, 0, h);
    grd.addColorStop(0, rgbaOf(t.shade.color, 0));
    grd.addColorStop(1, rgbaOf(t.shade.color, t.shade.a));
    g.fillStyle = grd;
    g.fillRect(0, h * t.shade.from, w, h * (1 - t.shade.from));
  }
}

function drawBaked(g: Ctx2D, L: BakedLayer, dist: number, st: number, bl: number, dy: number): void {
  const scroll = dist * L.factor;
  blitTiled(g, L.cache.get(st), L.w, L.h, scroll, L.y + dy);
  if (bl > 0.004 && st < MAX_STAGE) {
    const pa = g.globalAlpha;
    g.globalAlpha = pa * bl;
    blitTiled(g, L.cache.get(st + 1), L.w, L.h, scroll, L.y + dy);
    g.globalAlpha = pa;
  }
}

interface RainCol {
  x: number;
  speed: number;
  ph: number;
  strip: number;
  scale: number;
}

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  s: number;
  c: number;
}

export class CyberRenderer implements WorldRenderer {
  private ready = false;
  private A!: CyberSkinAssets;
  private sky!: StageCache;
  private floorS!: StageCache;
  private ceilS!: StageCache;
  private edgeS!: StageCache;
  private far!: BakedLayer;
  private mid!: BakedLayer;
  private servers!: BakedLayer;
  private near!: BakedLayer;
  private pylons: Pylon[] = [];
  /** RGB-Split-Kopien der Stadt-Ebene (rot/cyan); die Flächen bleiben über Stufenwechsel erhalten und werden streifenweise neu bemalt */
  private splitR: HTMLCanvasElement | null = null;
  private splitC: HTMLCanvasElement | null = null;
  /** Stufe, für die die Kopien bemalt sind bzw. werden */
  private splitStage = -1;
  /** wie viele Streifen-Schritte (0 … SPLIT_STEPS: erst die rote, dann die cyanfarbene Kopie) für `splitStage` fertig sind */
  private splitDone = 0;
  /** beide Kopien waren schon einmal vollständig bemalt: ab dann zeichenbar, auch während der Auffrischung nach einem Stufenwechsel */
  private splitBuilt = false;
  /** Spielzeit (s) des letzten Vorbereitungsschritts der Kopien */
  private splitT = -1e9;
  private boards: Board[] = [];
  /** alle Stufen-Caches (Liste gehört dem StagePrep) */
  private staged: StageCache[] = [];
  private prep = new StagePrep(this.staged, MAX_STAGE);
  private warmQ = new WarmQueue();
  private warmInit = false;
  /** winzige Aufwärmfläche für `primeProp` (wiederverwendet) */
  private primeSink: PrimeSink | null = null;
  private loaded = false;
  private lastStage = 0;
  /** Qualität 0 (schwache Geräte): Folgestufe erst spät und nicht im Leerlauf vorbacken – spart Speicher in der ersten Stufenhälfte */
  private lowQ = false;
  private props: PropLibrary | null = null;
  /** Pixeldichte (1 … 2, auf Viertel gerundet) der Schwebe-Plattformen fürs Vorbacken; beim Zeichnen wird sie erkannt */
  private pixelK = 1;
  private stars!: HTMLCanvasElement;
  private sun!: HTMLCanvasElement;
  private sunGlow!: HTMLCanvasElement;
  private sing!: HTMLCanvasElement;
  private dome!: HTMLCanvasElement;
  private domeGhost!: HTMLCanvasElement;
  private domeFromProp = false;
  private ads: HTMLCanvasElement[] = [];
  private rain: HTMLCanvasElement[][] = [];
  private refl!: HTMLCanvasElement;
  private rainFar: RainCol[] = [];
  private rainNear: RainCol[] = [];
  private bits: Bit[] = [];
  private cam = 0;
  private lastGrav: 1 | -1 = 1;
  private flipT = 9;
  private glitchCool = 0;
  private glitchLocal = 0;
  private rng = mulberry(2099);
  private skin!: SkinCtx;
  /** Glitch-Sturm: Daten-Blitz (Punkte x,y abwechselnd), Restlebenszeit */
  private bolt = new Float32Array(20);
  private boltT = 0;
  private boltCool = 2;
  private debris: Bit[] = [];

  async load(assets: AssetLoader): Promise<void> {
    if (this.loaded) return;
    this.props = assets.props;
    await assets.props.preload(CYBER_PROPS);
    // Statisches in Schritten bauen und dazwischen den Hauptthread freigeben (kein Long Task, Eingaben laufen weiter)
    await yieldBetweenBakes(); // nicht im selben Task wie das Ende des Prop-Ladens
    while (this.stepBuild()) await yieldBetweenBakes();
    this.ready = true;
    // erste beiden Stufen vorbacken (jeder Teilschritt eines Bakes ein eigener Schritt, dazwischen Pausen)
    for (const stage of [0, 1]) {
      for (const c of this.staged) {
        while (!c.has(stage)) {
          await yieldBetweenBakes();
          c.step(stage);
        }
      }
    }
    this.loaded = true;
  }

  /**
   * Skalenwechsel (Governor, Vollbild, DPR). Cyber backt seine Kulissen in logischer Größe; nur die Schwebe-Plattformen
   * entstehen in der Pixeldichte des Zeichenkontexts (beim Zeichnen erkannt). Der Aufruf ist idempotent: dieselbe Dichte
   * (auf Viertel gerundet) ändert nichts, bei einer echten Änderung werden die Plattformen der alten Dichte freigegeben
   * (Speicher) und bei Bedarf einmal neu gebacken.
   */
  resize(dpr: number): void {
    const k = hoverDensity(dpr);
    if (k === this.pixelK) return;
    this.pixelK = k;
    this.A?.hover.clear();
  }

  // --- Aufwärmen -----------------------------------------------------------------------------------

  /**
   * Leerlauf-Aufwärmen (Countdown, Menü-Demo, Lauf-Anfang): backt in Zeitscheiben von ca. `budgetMs` die fehlenden Stufen-
   * Varianten (aktuelle und Folgestufe) vor, damit sie nicht am Stufenübergang entstehen. true = nichts mehr zu tun.
   * Die Schwebe-Plattformen haben tempoabhängige Breiten (150 … 230 px) und entstehen beim ersten Zeichnen, höchstens eine
   * je Frame, solange sie noch außerhalb des Bildes stehen.
   */
  warm(budgetMs: number): boolean {
    if (!this.loaded) return true; // noch nicht geladen
    if (!this.warmInit) {
      this.warmInit = true;
      this.warmQ.add(() => this.warmStages(), 6);
      // Erstkosten der Prop-Bilder, die erst im Lauf gezeichnet werden (Drohne direkt, Schwebe-Plattform beim Bake): im Leerlauf
      for (const id of CYBER_RUN_PROPS) {
        this.warmQ.add(() => {
          this.primeSink = primeProp(this.props, id, this.primeSink);
          return true;
        }, 4);
      }
    }
    return this.warmQ.run(budgetMs);
  }

  /** Stufen-Varianten vorbacken: aktuelle + Folgestufe; auf Qualität 0 nur die aktuelle (Folgestufe siehe `prepProgress`) */
  private warmStages(): boolean {
    if (!this.lowQ) return this.prep.warm(this.lastStage, 0);
    this.prep.step(this.lastStage, 0, 0);
    return true;
  }

  /** Stufenfortschritt für die Vorbereitung der Folgestufe: auf Qualität 0 beginnt sie erst ab ~60 % statt ~28 % der Stufe */
  private prepProgress(progress: number): number {
    return this.lowQ ? progress * (0.28 / 0.6) : progress;
  }

  /**
   * Bauabschnitte des statischen Zeichnens. Jeder ist ein Generator, der zwischen seinen Teilstücken `yield`et: `load` gibt
   * dort den Hauptthread frei (kein Long Task, auch bei 4× gedrosselter CPU), der Fallback `build` läuft einfach durch.
   */
  private readonly parts: Array<() => Generator<void, void, void>> = [
    () => this.buildSky(),
    () => this.buildFar(),
    () => this.buildMid(),
    () => this.buildServers(),
    () => this.buildNear(),
    () => this.buildDome(),
    () => this.buildFx(),
  ];
  private nextPart = 0;
  private partGen: Generator<void, void, void> | null = null;

  /** Ein Teilstück des Bauens ausführen; false = alles gebaut */
  private stepBuild(): boolean {
    if (!this.partGen) {
      if (this.nextPart >= this.parts.length) return false;
      this.partGen = this.parts[this.nextPart]();
      this.nextPart += 1;
    }
    if (this.partGen.next().done) this.partGen = null;
    return true;
  }

  /** Alles (verbleibende) auf einmal bauen – Fallback für Aufrufe vor/ohne `load` */
  private build(): void {
    if (this.ready) return;
    while (this.stepBuild()) {
      /* durchlaufen */
    }
    this.ready = true;
    this.prep.step(0, 0, 0);
    for (const c of this.staged) c.get(1);
  }

  /** Stufen-Cache in die Verwaltung (StagePrep) aufnehmen */
  private addStaged<T extends StageCache>(c: T): T {
    this.staged.push(c);
    return c;
  }

  private *buildSky(): Generator<void, void, void> {
    this.A = yield* makeSkinAssetsSteps();
    this.A.props = this.props;
    yield;
    // Erstkosten der drei Prop-Bilder, die gleich auf Sprites gemalt werden (Münzstreifen, Würfel, Rack), je in einem eigenen
    // Schritt: das Dekodieren (bei 4× CPU 15 bis 50 ms je Bild) steht sonst zusammen mit dem Malen im selben Task
    for (const id of CYBER_BAKE_PROPS) {
      this.primeSink = primeProp(this.props, id, this.primeSink);
      yield;
    }
    bakePropSprites(this.A);
    this.stars = starField(1280, 420);
    this.sun = synthSun(150);
    this.sunGlow = paint(900, 560, (g) => {
      const grd = g.createRadialGradient(450, 300, 30, 450, 300, 450);
      grd.addColorStop(0, "rgba(255,170,120,0.75)");
      grd.addColorStop(0.3, "rgba(255,80,160,0.3)");
      grd.addColorStop(1, "rgba(160,40,200,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, 900, 560);
    });
    this.sing = singularitySprite(70);
    yield;
    this.sky = new StageCache(
      (s, reuse) =>
        paintOpaque(
          1280,
          600,
          (g) => {
            const P = STAGES[s];
            const grd = g.createLinearGradient(0, 0, 0, 600);
            grd.addColorStop(0, P.top);
            grd.addColorStop(0.5, P.mid);
            grd.addColorStop(0.86, P.low);
            grd.addColorStop(1, P.horizon);
            g.fillStyle = grd;
            g.fillRect(0, 0, 1280, 600);
            g.globalAlpha = STARS[s] * 0.9;
            g.drawImage(this.stars, 0, 0);
            g.globalAlpha = 1;
            // Synthwave-Horizontstreifen
            g.globalCompositeOperation = "lighter";
            for (let i = 0; i < 6; i += 1) {
              const y = 470 + i * 22;
              g.fillStyle = `rgba(255,255,255,${(0.015 + i * 0.008).toFixed(3)})`;
              g.fillRect(0, y, 1280, 2);
            }
            // Synthwave-Sonne (Dämmerung) – eingebacken
            if (SUN[s] > 0) {
              g.globalAlpha = 0.85 * SUN[s];
              g.drawImage(this.sunGlow, 780 - this.sunGlow.width / 2, 409 - this.sunGlow.height / 2);
              g.globalCompositeOperation = "source-over";
              g.globalAlpha = SUN[s];
              g.drawImage(this.sun, 780 - this.sun.width / 2, 409 - this.sun.height / 2);
            }
            // Singularität – eingebacken (Ring, Scheibe, Halo)
            if (SING[s] > 0) {
              g.globalCompositeOperation = "lighter";
              g.globalAlpha = SING[s];
              g.drawImage(this.sing, SING_X - this.sing.width / 2, SING_Y + 4 - this.sing.height / 2);
              g.globalCompositeOperation = "source-over";
              g.fillStyle = "#000000";
              g.beginPath();
              g.arc(SING_X, SING_Y + 4, 70, 0, TAU);
              g.fill();
            }
            g.globalAlpha = 1;
            g.globalCompositeOperation = "source-over";
          },
          reuse,
        ),
      { recycle: true },
    );
    // verworfene Stufenflächen werden für den nächsten Bake wiederverwendet (kein Neuanlegen am Stufenwechsel)
    this.floorS = new StageCache((s, reuse) => floorBase(1280, 120, STAGES[s].floor, STAGES[s].grid, STAGES[s].haze, reuse), { recycle: true });
    this.ceilS = new StageCache((s, reuse) => ceilBase(1280, 140, STAGES[s].floor, STAGES[s].grid, STAGES[s].haze, reuse), { recycle: true });
    this.edgeS = new StageCache((s, reuse) => edgeGlow(1280, STAGES[s].grid, reuse), { recycle: true });
  }

  private *buildFar(): Generator<void, void, void> {
    const far = farSkyline(2048, 350);
    yield;
    this.far = bakedLayer(
      far.body,
      far.lights,
      250,
      0.05,
      (s) => ({
        night: { color: STAGES[s].haze, a: 1 },
        haze: { color: STAGES[s].night, aTop: 0.55, aBottom: 0.25 },
        shade: { color: STAGES[s].horizon, a: 0.55, from: 0.45 },
      }),
      (s) => LIGHTS[s] * 0.85,
      (g, s, w, h) => {
        // Dunst über der ganzen unteren Kachel (auch zwischen den Türmen)
        const grd = g.createLinearGradient(0, 110, 0, h);
        grd.addColorStop(0, colorWithAlpha(STAGES[s].horizon, 0));
        grd.addColorStop(0.7, colorWithAlpha(STAGES[s].horizon, 0.22));
        grd.addColorStop(1, colorWithAlpha(STAGES[s].horizon, 0.5));
        g.fillStyle = grd;
        g.fillRect(0, 110, w, h - 110);
      },
    );
  }

  private *buildMid(): Generator<void, void, void> {
    const mid = midCity(2048, 360);
    yield;
    this.boards = mid.boards;
    this.mid = bakedLayer(
      mid.body,
      mid.lights,
      240,
      0.2,
      (s) => ({ night: { color: STAGES[s].night, a: 0.5 }, haze: { color: STAGES[s].haze, aTop: 0.0, aBottom: 0.35 } }),
      (s) => LIGHTS[s] * 0.95,
      (g, s, w, h) => {
        // Straßenglühen zwischen den Häusern
        g.globalCompositeOperation = "lighter";
        const grd = g.createLinearGradient(0, h - 100, 0, h);
        grd.addColorStop(0, colorWithAlpha(STAGES[s].grid, 0));
        grd.addColorStop(1, colorWithAlpha(STAGES[s].grid, 0.28));
        g.fillStyle = grd;
        g.fillRect(0, h - 100, w, 100);
        g.globalCompositeOperation = "source-over";
      },
    );
    this.refl = reflectionTile(mid.lights, 120);
  }

  private *buildServers(): Generator<void, void, void> {
    const srv = serverMonoliths(2048, 420);
    yield;
    this.servers = bakedLayer(
      srv.body,
      srv.lights,
      180,
      0.32,
      (s) => ({ night: { color: STAGES[s].night, a: 0.25 }, haze: { color: STAGES[s].haze, aTop: 0, aBottom: 0.35 } }),
      () => 0.9,
    );
  }

  private *buildNear(): Generator<void, void, void> {
    const near = nearPylons(2048, 360);
    yield;
    this.pylons = near.pylons;
    this.near = bakedLayer(
      near.body,
      near.lights,
      140,
      0.55,
      (s) => ({ night: { color: STAGES[s].night, a: 0.35 }, haze: { color: STAGES[s].haze, aTop: 0.12, aBottom: 0.2 } }),
      (s) => LIGHTS[s] * 0.8,
    );
    this.staged.push(this.sky, this.floorS, this.ceilS, this.edgeS, this.far.cache, this.mid.cache, this.servers.cache, this.near.cache);
  }

  /** Hologramm-Stephansdom (gemaltes Landmark, sonst prozedural): zwei Hologramme, jeweils in Schritten */
  private *buildDome(): Generator<void, void, void> {
    const props = this.props && this.props.has("landmark-cathedral") ? this.props : null;
    // Das Bild wird beim ersten Zeichnen dekodiert und die Quelle danach im selben Task gerastert (zusammen mit der Sobel-
    // Vorbereitung bei 4× CPU weit über 100 ms): Dekodieren, Malen+Rastern und Auswerten sind je ein eigener Schritt
    if (props) {
      this.primeSink = primeProp(props, "landmark-cathedral", this.primeSink);
      yield;
    }
    const src = cathedralSource(props, 430);
    touchCanvas(src);
    yield;
    this.dome = yield* holoSteps(src, CYAN, VIOLET, { scan: 3, fadeBottom: 0.22, gain: 2.6 });
    yield;
    this.domeGhost = yield* holoSteps(src, MAGENTA, MAGENTA, { scan: 2, fadeBottom: 0.3, gain: 2.0 });
    this.domeFromProp = !!props;
  }

  private *buildFx(): Generator<void, void, void> {
    this.ads = adIcons(150);
    yield;
    // je Farbe ein Schritt (die Streifen zeichnen Zeichenketten: der erste Text lädt Schriften, bei 4× CPU ca. 200 ms am Stück)
    const rainColors = [CYAN, CYAN, MINT, MAGENTA, VIOLET];
    this.rain = [];
    for (let i = 0; i < rainColors.length; i += 1) {
      this.rain.push(rainStrips(rainColors[i], 5, 560, 40 + i));
      yield;
    }
    const r = mulberry(55);
    for (let i = 0; i < 18; i += 1) this.rainFar.push({ x: r() * 2048, speed: 60 + r() * 90, ph: r() * 900, strip: Math.floor(r() * 5), scale: 0.65 + r() * 0.25 });
    for (let i = 0; i < 7; i += 1) this.rainNear.push({ x: r() * 2048, speed: 150 + r() * 120, ph: r() * 900, strip: Math.floor(r() * 5), scale: 1 });
    for (let i = 0; i < 46; i += 1) this.debris.push({ x: r() * 1300, y: 140 + r() * 460, vx: -380 - r() * 420, vy: 60 + r() * 120, s: 2 + r() * 5, c: Math.floor(r() * 2) });
    for (let i = 0; i < 40; i += 1) this.bits.push({ x: r() * 1300, y: 150 + r() * 440, vx: -20 - r() * 60, vy: -10 + r() * 20, s: 1.5 + r() * 2.5, c: Math.floor(r() * 3) });
    this.skin = { beat: 0, time: 0, quality: 2, reduced: false, groundY: 600, ceilY: 140, glitch: 0 };
    this.ready = true;
  }

  update(dt: number, v: ViewState): void {
    if (!this.ready) return;
    this.A.baked = 0;
    // Stufen-Varianten: die aktuelle sofort, die Folgestufe erst ab ~28 % der Stufe und höchstens ein Schritt je ~6 Frames
    // (nicht am Stufenanfang, wo sich sonst alles auf den Übergang drängt)
    const st = stIdx(v);
    this.lastStage = st;
    this.lowQ = v.quality === 0;
    const progress = stageProgress(v.worldMeters, CYBER_STAGE_METERS);
    this.prep.step(st, this.prepProgress(progress), stBl(v));
    this.prepSplit(v, st);
    // wenig Speicher (Qualität 0 oder Gerät mit < 4 GB): verworfene Stufenflächen nicht für den nächsten Bake aufheben
    if (this.lowQ || LOW_MEMORY) for (const c of this.staged) c.dropSpare();
    // Kamera neigt sich zur Lauffläche (Decke → Kulisse wandert etwas nach unten)
    const target = v.gravDir === -1 ? 16 : 0;
    this.cam += (target - this.cam) * Math.min(1, dt * 3);
    if (v.gravDir !== this.lastGrav) {
      this.lastGrav = v.gravDir;
      this.flipT = 0;
    }
    this.flipT += dt;
    // Datenpartikel
    const drift = v.speed * 0.35;
    for (const b of this.bits) {
      b.x += (b.vx - drift) * dt;
      b.y += b.vy * dt;
      if (b.x < -20 || b.y < 140 || b.y > 600) {
        b.x = 1290 + this.rng() * 200;
        b.y = 150 + this.rng() * 440;
      }
    }
    // Glitch-Schübe (lokal, ergänzt Systemwert)
    const s = stF(v);
    const gl = stageVal(GLITCH, s);
    // Sturm: Pixel-Trümmer + Daten-Blitze
    if (gl > 0.05) {
      const k = v.reducedMotion ? 0.3 : 1;
      for (const d of this.debris) {
        d.x += (d.vx * k - v.speed * 0.4) * dt;
        d.y += d.vy * k * dt;
        if (d.x < -20 || d.y > 600) {
          d.x = 1290 + this.rng() * 300;
          d.y = 120 + this.rng() * 380;
        }
      }
      this.boltT = Math.max(0, this.boltT - dt);
      if (!v.reducedMotion && gl > 0.3) {
        this.boltCool -= dt * gl;
        if (this.boltCool <= 0) {
          this.boltCool = 1.6 + this.rng() * 2.8;
          this.boltT = 0.28;
          let x = 180 + this.rng() * 1000;
          let y = 140;
          const yEnd = 300 + this.rng() * 160;
          for (let i = 0; i < 10; i += 1) {
            this.bolt[i * 2] = x;
            this.bolt[i * 2 + 1] = y;
            x += (this.rng() - 0.5) * 70;
            y += (yEnd - 140) / 9;
          }
        }
      }
    }
    this.glitchLocal = Math.max(0, this.glitchLocal - dt * 3);
    if (gl > 0.05) {
      this.glitchCool -= dt * gl;
      if (this.glitchCool <= 0) {
        this.glitchCool = 1.2 + this.rng() * 2.6;
        this.glitchLocal = 0.6 + this.rng() * 0.4;
      }
    }
  }

  private skinCtx(v: ViewState): SkinCtx {
    const k = this.skin;
    k.time = v.time;
    k.quality = v.quality;
    k.reduced = v.reducedMotion;
    k.groundY = v.groundY;
    k.ceilY = v.ceilY;
    k.beat = beatOf(v);
    k.glitch = Math.max(v.vars.glitch ?? 0, this.glitchLocal) * stageVal(GLITCH, stF(v));
    return k;
  }

  drawBackground(g: Ctx2D, v: ViewState): void {
    this.build();
    const st = stIdx(v);
    const bl = stBl(v);
    const s = st + bl;
    const beat = beatOf(v);
    const cam = this.cam;
    const q = g.imageSmoothingQuality;
    g.imageSmoothingQuality = "low";

    // Himmel (nur der sichtbare Streifen zwischen Decke und Boden wird geblittet)
    const P = PAL.css(s);
    const skyDy = Math.round(cam * 0.2) - 4;
    const sy0 = 128 - skyDy;
    g.fillStyle = P.top;
    g.fillRect(0, 0, v.w, 128);
    g.drawImage(this.sky.get(st), 0, sy0, 1280, 600 - sy0, 0, 128, 1280, 600 - sy0);
    if (bl > 0.004 && st < MAX_STAGE) {
      g.globalAlpha = bl;
      g.drawImage(this.sky.get(st + 1), 0, sy0, 1280, 600 - sy0, 0, 128, 1280, 600 - sy0);
      g.globalAlpha = 1;
    }
    g.fillStyle = P.horizon;
    g.fillRect(0, 596, v.w, v.h - 596);

    // funkelnde Sterne
    const starA = stageVal(STARS, s);
    if (starA > 0.1 && v.quality > 0) {
      g.globalCompositeOperation = "lighter";
      for (let i = 0; i < 12; i += 1) {
        const tw = v.reducedMotion ? 0.6 : 0.5 + 0.5 * Math.sin(v.time * (1.3 + h1(i + 9) * 2) + i);
        g.globalAlpha = starA * tw * 0.7;
        glowAt(g, i % 3 ? this.A.glowWhite : this.A.glowCyan, h1(i) * 1280, 150 + h1(i + 40) * 200 + cam * 0.2, 4 + h1(i + 3) * 5);
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }

    // Singularität
    const sing = stageVal(SING, s);
    if (sing > 0.01) this.drawSingularity(g, v, sing, cam);

    // Laserraster (Linien statt Vollbild-Blit)
    const ras = stageVal(RASTER, s);
    if (ras > 0.02) this.drawRaster(g, v, ras * (0.5 + 0.2 * beat), P.grid, 150 + cam * 0.25);

    // ferne Skyline + Dunst
    const dyFar = Math.round(cam * 0.35);
    drawBaked(g, this.far, v.dist, st, bl, dyFar);
    if (this.boltT > 0) this.drawBolt(g, v, P.grid2);

    // Schwebeverkehr (fern)
    const traffic = stageVal(TRAFFIC, s);
    if (v.quality > 0 && traffic > 0.05) this.drawTraffic(g, v, traffic, 0);

    // Hologramm-Stephansdom
    this.drawDome(g, v, s, cam);

    // ferner Datenregen
    const rainA = stageVal(RAIN, s);
    if (rainA > 0.03) this.drawRain(g, v, this.rainFar, 0.15, rainA * 0.5, cam * 0.5);

    // Server-Monolithen (Serverherz)
    const srv = stageVal(SERVER, s);
    if (srv > 0.02) {
      g.globalAlpha = srv;
      drawBaked(g, this.servers, v.dist, st, bl, Math.round(cam * 0.6));
      g.globalAlpha = 1;
    }

    // Glas-Wolkenkratzer + Holo-Reklamen
    const dyMid = Math.round(cam * 0.7);
    drawBaked(g, this.mid, v.dist, st, bl, dyMid);
    this.drawBoards(g, v, dyMid);

    // Verkehr (nah) + Hintergrund-Drohnen
    if (v.quality > 0 && traffic > 0.05) this.drawTraffic(g, v, traffic, 1);
    this.drawBgDrones(g, v, cam);

    // Magnetbahn-Pylonen
    this.drawNear(g, v, st, bl, Math.round(cam));

    // naher Datenregen
    if (rainA > 0.03 && v.quality > 0) this.drawRain(g, v, this.rainNear, 0.6, rainA * 0.42, cam);

    g.imageSmoothingQuality = q;
  }

  /** Pylonen-Ebene: nur Kabelband (oben) + die einzelnen Träger aus der gebackenen Kachel blitten (spart Füllrate). */
  private drawNear(g: Ctx2D, v: ViewState, st: number, bl: number, dy: number): void {
    const L = this.near;
    const off = Math.round(mod(v.dist * L.factor, L.w));
    const band = 110;
    const draw = (tile: HTMLCanvasElement): void => {
      blitStrip(g, tile, L.w, 0, band, off, L.y + dy);
      for (const p of this.pylons) {
        let x = p.x - off;
        if (x < -80) x += L.w;
        if (x > v.w + 20) continue;
        const h = Math.min(L.h - band, p.len + 14 - band);
        if (h > 0) g.drawImage(tile, p.x - 10, band, p.w + 20, h, x - 10, L.y + dy + band, p.w + 20, h);
      }
    };
    draw(L.cache.get(st));
    if (bl > 0.004 && st < MAX_STAGE) {
      g.globalAlpha = bl;
      draw(L.cache.get(st + 1));
      g.globalAlpha = 1;
    }
  }

  /**
   * Daten-Blitz im Glitch-Sturm (hinter der Stadt): gezackter Bogen + kurzes Himmelsaufleuchten. Die Stärke folgt dem
   * „Blitze“-Regler (`flashScale`, bei „Weniger Bewegung“ höchstens 0,3; ohne Regler 1 = wie bisher).
   */
  private drawBolt(g: Ctx2D, v: ViewState, color: string): void {
    const fs = flashFactor(v);
    if (fs <= 0) return;
    const a = (this.boltT / 0.28) * fs;
    const flick = Math.floor(v.time * 30) % 2 ? 1 : 0.55;
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.07 * a;
    g.fillStyle = color;
    g.fillRect(0, 140, v.w, 300);
    g.beginPath();
    g.moveTo(this.bolt[0], this.bolt[1]);
    for (let i = 1; i < 10; i += 1) g.lineTo(this.bolt[i * 2], this.bolt[i * 2 + 1]);
    g.strokeStyle = color;
    g.globalAlpha = 0.45 * a * flick;
    g.lineWidth = 7;
    g.stroke();
    g.strokeStyle = "#ffffff";
    g.globalAlpha = 0.9 * a * flick;
    g.lineWidth = 2;
    g.stroke();
    g.globalAlpha = a;
    glowAt(g, this.A.glowWhite, this.bolt[18], this.bolt[19], 18);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  private drawRaster(g: Ctx2D, v: ViewState, a: number, color: string, y0: number): void {
    const H = 200;
    g.strokeStyle = color;
    g.lineWidth = 1;
    g.globalAlpha = a * 0.55;
    g.beginPath();
    for (let i = 0; i < 12; i += 1) {
      const u = i / 11;
      const y = Math.round(y0 + H * Math.pow(u, 0.62)) + 0.5;
      g.moveTo(0, y);
      g.lineTo(v.w, y);
    }
    const sp = 80;
    const off = mod(v.dist * 0.012 + v.time * 3, sp);
    for (let x = -off; x < v.w; x += sp) {
      g.moveTo(Math.round(x) + 0.5, y0 + 30);
      g.lineTo(Math.round(x) + 0.5, y0 + H);
    }
    g.stroke();
    g.globalAlpha = 1;
  }

  /** Singularität: Ring & Scheibe sind in den Himmel eingebacken; hier nur einfallende Lichtpunkte. */
  private drawSingularity(g: Ctx2D, v: ViewState, a: number, cam: number): void {
    if (v.quality === 0) return;
    const cx = SING_X;
    const cy = SING_Y + Math.round(cam * 0.2);
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < 18; i += 1) {
      const ph = mod(v.time * (v.reducedMotion ? 0.02 : 0.12) + h1(i + 3), 1);
      const rad = 70 * 1.3 + (1 - ph) * 260;
      const ang = i * 1.9 + ph * 5;
      g.globalAlpha = a * Math.sin(ph * Math.PI) * 0.8;
      glowAt(g, i % 2 ? this.A.glowViolet : this.A.glowWhite, cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad * 0.35, 3 + ph * 3);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  private drawDome(g: Ctx2D, v: ViewState, s: number, cam: number): void {
    const f = 0.07;
    const period = 3100;
    const scroll = v.dist * f;
    const W = this.dome.width;
    const H = this.dome.height;
    const intensity = stageVal(DOME, s);
    const k0 = Math.floor((scroll - 1600) / period);
    for (let k = k0; k <= k0 + 1; k += 1) {
      const cx = Math.round(k * period + 1500 - scroll);
      if (cx < -W || cx > 1280 + W) continue;
      const baseY = Math.round(600 - 12 + cam * 0.45);
      const x = cx - W / 2;
      const y = baseY - H;
      // Flackern: sanftes Atmen + seltene Aussetzer
      let fl = 0.82 + 0.18 * Math.sin(v.time * 1.4);
      if (!v.reducedMotion && h1(Math.floor(v.time * 7) + k * 13) > 0.93) fl *= 0.45;
      if (v.reducedMotion) fl = 0.9;
      const a = intensity * fl;
      g.globalCompositeOperation = "lighter";
      // Projektorkegel (nur hohe Qualität)
      if (v.quality === 2) {
        g.globalAlpha = 0.14 * a;
        g.drawImage(this.A.softCyan, cx - W * 0.4, y + H * 0.1, W * 0.8, H * 0.95);
      }
      // Geister-Versatz (chromatisch)
      const gl = this.skin.glitch;
      const jx = v.reducedMotion ? 2 : 2 + gl * 10 + Math.sin(v.time * 3) * 1.5;
      if (v.quality > 0) {
        g.globalAlpha = 0.35 * a;
        g.drawImage(this.domeGhost, x + jx, y);
      }
      g.globalAlpha = 0.95 * a;
      if (gl > 0.2 && !v.reducedMotion && v.quality > 0) {
        // horizontale Schnitte
        const n = 6;
        const sh = Math.ceil(H / n);
        for (let i = 0; i < n; i += 1) {
          const off = (h1(Math.floor(v.time * 12) + i * 5) - 0.5) * 26 * gl;
          g.drawImage(this.dome, 0, i * sh, W, sh, x + off, y + i * sh, W, sh);
        }
      } else g.drawImage(this.dome, x, y);
      // Scan-Balken
      if (!v.reducedMotion) {
        const sy = Math.floor(mod(v.time * 70, H + 60)) - 30;
        const y0 = Math.max(0, sy);
        const y1 = Math.min(H, sy + 14);
        if (y1 > y0) {
          g.globalAlpha = 0.9 * a;
          g.drawImage(this.dome, 0, H - y1, W, y1 - y0, x, y + H - y1, W, y1 - y0);
        }
      }
      // Sockel-Emitter
      g.globalAlpha = 0.8 * a;
      glowAt(g, this.A.glowCyan, cx, baseY + 4, 60, 12);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
  }

  private drawBoards(g: Ctx2D, v: ViewState, dy: number): void {
    const L = this.mid;
    const off = Math.round(mod(v.dist * L.factor, L.w));
    const slot = Math.floor(v.time / 5);
    g.globalCompositeOperation = "lighter";
    for (const b of this.boards) {
      let x = b.x - off;
      if (x < -b.w - 20) x += L.w;
      if (x > 1300) continue;
      const y = L.y + b.y + dy;
      const idx = (b.kind + slot) % this.ads.length;
      const into = v.time - slot * 5;
      const flick = v.reducedMotion ? 0.8 : into < 0.25 ? (Math.floor(into * 40) % 2 ? 0.25 : 0.9) : 0.72 + 0.12 * Math.sin(v.time * 6 + b.x);
      g.globalAlpha = flick;
      g.drawImage(this.ads[idx], x, y, b.w, b.h);
      if (!v.reducedMotion) {
        const sy = mod(v.time * 40 + b.x, b.h);
        g.globalAlpha = 0.25;
        g.fillStyle = b.kind % 2 ? MAGENTA : CYAN;
        g.fillRect(x, y + sy, b.w, 2);
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  private drawTraffic(g: Ctx2D, v: ViewState, a: number, lane: 0 | 1): void {
    const A = this.A;
    const factor = lane === 0 ? 0.1 : 0.3;
    const y0 = lane === 0 ? 330 : 250;
    const n = lane === 0 ? 12 : 8;
    const period = 1700;
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < n; i += 1) {
      const dir = i % 2 ? 1 : -1;
      const sp = (lane === 0 ? 60 : 140) + h1(i + lane * 17) * 80;
      const x = mod(h1(i * 3 + lane) * period + (v.reducedMotion ? 0 : v.time * sp * dir) - v.dist * factor, period) - 200;
      if (x < -20 || x > 1300) continue;
      const y = y0 + (i % 3) * (lane === 0 ? 10 : 18) + this.cam * (lane === 0 ? 0.4 : 0.6);
      const r = lane === 0 ? 3 : 5;
      g.globalAlpha = a * 0.9;
      glowAt(g, dir > 0 ? A.glowWhite : A.glowRed, x, y, r * 2);
      g.globalAlpha = a * 0.35;
      g.drawImage(dir > 0 ? A.softCyan : A.softRed, x - (dir > 0 ? 34 : 0), y - r * 0.6, 34, r * 1.2);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  private drawBgDrones(g: Ctx2D, v: ViewState, cam: number): void {
    if (v.quality === 0) return;
    const A = this.A;
    for (let i = 0; i < 4; i += 1) {
      const x = mod(h1(i + 70) * 1600 - v.dist * 0.12 - (v.reducedMotion ? 0 : v.time * (30 + i * 12)), 1600) - 160;
      if (x < -30 || x > 1310) continue;
      const y = 190 + i * 38 + Math.sin(v.time * 0.9 + i) * 10 + cam * 0.5;
      g.fillStyle = "#070814";
      g.fillRect(x - 9, y - 2, 18, 5);
      g.fillRect(x - 13, y - 5, 6, 2);
      g.fillRect(x + 7, y - 5, 6, 2);
      g.globalCompositeOperation = "lighter";
      const blink = v.reducedMotion ? 0.7 : Math.floor(v.time * 2 + i * 0.37) % 2 ? 1 : 0.25;
      g.globalAlpha = blink;
      glowAt(g, i % 2 ? A.glowRed : A.glowMint, x, y + 1, 6);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
  }

  private drawRain(g: Ctx2D, v: ViewState, cols: RainCol[], factor: number, a: number, dy: number): void {
    const set = this.rain[stIdx(v)];
    const off = mod(v.dist * factor, 2048);
    g.globalCompositeOperation = "lighter";
    for (const c of cols) {
      let x = c.x - off;
      if (x < -30) x += 2048;
      if (x > 1300) continue;
      const strip = set[c.strip];
      const h = strip.height * c.scale;
      const y = mod(c.ph + (v.reducedMotion ? 0 : v.time * c.speed), 900) - h + 140 + dy;
      if (y > 600 || y + h < 140) continue;
      g.globalAlpha = a;
      g.drawImage(strip, Math.round(x), Math.round(y), 18 * c.scale, h);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  drawGround(g: Ctx2D, v: ViewState, pits: ReadonlyArray<{ x0: number; x1: number; skin: string }>): void {
    this.build();
    const st = stIdx(v);
    const bl = stBl(v);
    const s = st + bl;
    const gy = v.groundY;
    const cy = v.ceilY;
    const P = PAL.css(s);
    const beat = beatOf(v);
    const q = g.imageSmoothingQuality;
    g.imageSmoothingQuality = "low";
    const fh = v.h - gy;
    // Grundflächen (vorgebacken pro Stufe)
    g.drawImage(this.floorS.get(st), 0, gy, v.w, fh);
    g.drawImage(this.ceilS.get(st), 0, 0, v.w, cy);
    if (bl > 0.004 && st < MAX_STAGE) {
      g.globalAlpha = bl;
      g.drawImage(this.floorS.get(st + 1), 0, gy, v.w, fh);
      g.drawImage(this.ceilS.get(st + 1), 0, 0, v.w, cy);
      g.globalAlpha = 1;
    }
    g.globalCompositeOperation = "lighter";
    // Spiegelung der Stadtlichter im Boden
    g.globalAlpha = 0.32 * stageVal(LIGHTS, s);
    blitTiled(g, this.refl, this.refl.width, 120, v.dist * this.mid.factor, gy + 2);
    // Tron-Gitter (perspektivisch, bewegt sich exakt mit dist an der Lauffläche)
    const pulse = v.reducedMotion ? 0.55 : 0.45 + 0.55 * beat;
    const sp = 96;
    const vpx = 640;
    const kF = 1.75;
    const kC = 1 + 0.75 * (cy / 120);
    const x0 = -mod(v.dist, sp) - sp;
    g.beginPath();
    for (let x = x0; x < v.w + sp; x += sp) {
      g.moveTo(x, gy);
      g.lineTo(vpx + (x - vpx) * kF, v.h);
      g.moveTo(x, cy);
      g.lineTo(vpx + (x - vpx) * kC, 0);
    }
    // (source-over statt additiv: auf dem dunklen Grund optisch gleich, im Software-Rendering deutlich billiger)
    g.globalCompositeOperation = "source-over";
    g.strokeStyle = P.grid;
    g.globalAlpha = 0.22 + 0.18 * pulse;
    g.lineWidth = 5;
    g.stroke();
    g.globalAlpha = 0.55 + 0.35 * pulse;
    g.lineWidth = 1.5;
    g.stroke();
    g.globalCompositeOperation = "lighter";
    // Beat-Welle (läuft von der Lauffläche weg)
    if (!v.reducedMotion) {
      const ph = mod(v.time * 2, 1);
      const wy = ph * ph;
      g.globalAlpha = 0.5 * (1 - ph);
      g.fillStyle = P.grid2;
      g.fillRect(0, gy + 4 + wy * (fh - 6), v.w, 2 + ph * 3);
      g.fillRect(0, cy - 6 - wy * (cy - 8), v.w, 2 + ph * 3);
    }
    // Leuchtkanten
    const edge = this.edgeS.get(st);
    g.globalAlpha = 0.85 + 0.15 * pulse;
    g.drawImage(edge, 0, gy - 15);
    g.drawImage(edge, 0, cy - 15);
    // Lauflichter an den Kanten (weltfest)
    if (v.quality > 0) {
      const step = 128;
      const i0 = Math.floor(v.dist / step);
      const chase = Math.floor(v.time * 10);
      for (let i = i0; i < i0 + 12; i += 1) {
        const sx = i * step - v.dist;
        const on = v.reducedMotion ? 0.5 : mod(i + chase, 6) === 0 ? 1 : 0.28;
        g.globalAlpha = on;
        glowAt(g, i % 2 ? this.A.glowCyan : this.A.glowMagenta, sx, gy + 8, 9);
        glowAt(g, i % 2 ? this.A.glowMagenta : this.A.glowCyan, sx + 64, cy - 8, 9);
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    // Lücken (in Cyber-Wien nicht vorgesehen; nur für Welt-Übergänge sauber ausschneiden)
    for (const p of pits) {
      const a = Math.round(Math.max(0, p.x0));
      const b = Math.round(Math.min(v.w, p.x1));
      if (b <= a) continue;
      g.fillStyle = "#010103";
      g.fillRect(a, gy, b - a, fh);
      g.fillStyle = P.grid;
      g.fillRect(a, gy, 3, fh);
      g.fillRect(b - 3, gy, 3, fh);
    }
    g.imageSmoothingQuality = q;
  }

  drawEntity(g: Ctx2D, e: Ent, sx: number, sy: number, v: ViewState): boolean {
    this.build();
    const k = this.skinCtx(v);
    const A = this.A;
    switch (e.kind) {
      case "pickup":
        if (e.pickup === "coin") {
          drawChip(g, A, e, sx, sy, k);
          return true;
        }
        if (e.pickup === "gem") {
          drawCrystal(g, A, e, sx, sy, k);
          return true;
        }
        return false;
      case "portal":
        drawPortal(g, A, e, sx, sy, v, k);
        return true;
      case "zone":
        if (e.skin === "phase-cyan" || e.skin === "phase-magenta") drawPhaseGate(g, A, e, sx, sy, v, k);
        else if (e.skin === "glitch-cube") drawGlitchCube(g, A, e, sx, sy, v, k);
        else if (e.skin === "beam-fence") drawBeamFence(g, A, e, sx, sy, v, k);
        else drawLaser(g, A, e, sx, sy, v, k);
        return true;
      case "flyer":
        if (GUESTS.has(e.skin)) return false;
        drawDrone(g, A, e, sx, sy, v, k);
        return true;
      case "block":
        if (e.skin === "server-rack") drawRack(g, A, e, sx, sy, v, k);
        else drawBarrier(g, A, e, sx, sy, v, k);
        return true;
      case "projectile":
        drawPlasma(g, A, e, sx, sy, v, k);
        return true;
      case "platform":
        drawHover(g, A, e, sx, sy, v, k);
        return true;
      case "decor":
        if (e.skin === "flip-hint") {
          drawHint(g, A, e, sx, sy, v, k);
          return true;
        }
        if (e.skin === "corridor" || e.skin === "shaft") {
          drawHall(g, A, e, sx, sy, v, k);
          return true;
        }
        return false;
      case "pit":
        return true;
      default:
        return false;
    }
  }

  drawForeground(g: Ctx2D, v: ViewState): void {
    this.build();
    const s = stF(v);
    const A = this.A;
    // Datenpartikel
    const n = v.quality === 0 ? 10 : v.quality === 1 ? 24 : this.bits.length;
    g.globalCompositeOperation = "lighter";
    const sprs = [A.glowCyan, A.glowMagenta, stageVal(SERVER, s) > 0.5 ? A.glowMint : A.glowViolet];
    for (let i = 0; i < n; i += 1) {
      const b = this.bits[i];
      g.globalAlpha = 0.55;
      glowAt(g, sprs[b.c], b.x, b.y, b.s * 2.2);
    }
    // Schwerkraft-Sog an der Figur direkt nach dem Portal-Flip (Energiewirbel, kaschiert das Umklappen)
    if (this.flipT < 0.34) {
      const u = this.flipT / 0.34;
      const toCeil = v.gravDir === -1;
      const px = v.playerX;
      const cy = v.playerFeetY + (toCeil ? 75 : -75);
      const a = 1 - u;
      const soft = toCeil ? A.softCyan : A.softMagenta;
      g.globalAlpha = (v.reducedMotion ? 0.5 : 0.95) * a;
      glowAt(g, soft, px, cy, 80 + 50 * u, 105 + 40 * u);
      g.globalAlpha = 0.85 * a;
      glowAt(g, A.glowWhite, px, cy, 18 + 34 * (1 - u));
      if (!v.reducedMotion) {
        g.fillStyle = toCeil ? CYAN : MAGENTA;
        for (let i = 0; i < 7; i += 1) {
          const x = px - 48 + i * 16;
          const len = 70 + 70 * h1(i + 5);
          const y0 = toCeil ? cy - len * (0.4 + u) : cy + len * u - len * 0.6;
          g.globalAlpha = 0.55 * a;
          g.fillRect(x, y0, 2, len);
        }
      }
    }
    // Glitch-Sturm: vom Wind getriebene Pixel-Trümmer
    const storm = stageVal(GLITCH, s);
    if (storm > 0.15) {
      const n2 = v.quality === 0 ? 12 : v.quality === 1 ? 26 : this.debris.length;
      g.globalCompositeOperation = "source-over";
      for (let i = 0; i < n2; i += 1) {
        const d = this.debris[i];
        g.globalAlpha = 0.55 * storm;
        g.fillStyle = d.c ? CYAN : MAGENTA;
        g.fillRect(d.x, d.y, d.s * 1.8, d.s * 0.7);
      }
      g.globalCompositeOperation = "lighter";
    }
    // Glitch-Sturm: Farb-Balken (additive Streifen, mit 14 Hz neu gewürfelt: Stärke folgt dem „Blitze“-Regler)
    const gl = this.skin.glitch;
    const fs = flashFactor(v);
    if (gl > 0.15 && !v.reducedMotion && v.quality > 0 && fs > 0) {
      const seed = Math.floor(v.time * 14);
      for (let i = 0; i < 4; i += 1) {
        if (h1(seed + i * 3) > 0.55) continue;
        const y = 140 + h1(seed * 7 + i) * 460;
        g.globalAlpha = 0.18 * gl * fs;
        g.fillStyle = i % 2 ? CYAN : MAGENTA;
        g.fillRect(0, y, 1280, 2 + h1(seed + i) * 10);
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  /**
   * RGB-Split-Kopien der Stadt-Ebene für Stufe `st` (im Glitch-Sturm; nach einem Stufenwechsel aufgefrischt): höchstens EIN
   * Streifen-Schritt je Aufruf (die ganze Kopie kostet ca. 13 ms inkl. Rastern, ein Streifen ein Viertel davon), danach true.
   * Die Flächen werden über Stufenwechsel hinweg wiederverwendet (nur beim ersten Mal entstehen sie) und streifenweise
   * überschrieben. Bis beide zum ersten Mal vollständig sind, entfällt der schwache Geister-Versatz – kein Mehrfach-Bake-Ruckler.
   */
  private ensureSplit(st: number): boolean {
    if (this.splitStage !== st) {
      this.splitStage = st;
      this.splitDone = 0;
    }
    if (this.splitDone >= SPLIT_STEPS) return true;
    const tile = this.mid.cache.get(st);
    const second = this.splitDone >= SPLIT_STRIPS;
    let dst = second ? this.splitC : this.splitR;
    if (!dst || dst.width !== tile.width || dst.height !== tile.height) {
      dst = makeCanvas(tile.width, tile.height); // erste Anlage (oder Ebene in anderer Größe neu gebaut)
      if (second) this.splitC = dst;
      else this.splitR = dst;
      this.splitBuilt = false;
    }
    const strip = this.splitDone % SPLIT_STRIPS;
    const y0 = Math.floor((tile.height * strip) / SPLIT_STRIPS);
    const y1 = Math.floor((tile.height * (strip + 1)) / SPLIT_STRIPS);
    tintStrip(dst, tile, second ? "#20e8ff" : "#ff2050", y0, y1);
    touchCanvas(dst);
    this.splitDone += 1;
    if (this.splitDone < SPLIT_STEPS) return false;
    this.splitBuilt = true;
    return true;
  }

  /**
   * Die Kopien rechtzeitig (ab Glitch-Stärke `SPLIT_FROM`, also vor dem ersten Sturm) und nach jedem Stufenwechsel vorbereiten,
   * höchstens ein Streifen-Schritt je 0,1 s Spielzeit – nicht mitten im Sturm beim ersten Zeichnen.
   */
  private prepSplit(v: ViewState, st: number): void {
    if (v.quality === 0 || stageVal(GLITCH, stF(v)) < SPLIT_FROM) return;
    if (this.splitStage === st && this.splitDone >= SPLIT_STEPS) return;
    if (v.time < this.splitT) this.splitT = -1e9; // Spielzeit zurückgesetzt (neuer Lauf)
    if (v.time - this.splitT < 0.1) return;
    this.splitT = v.time;
    this.ensureSplit(st);
  }

  /**
   * Liegen die Kopien vor? Einmal vollständig gebaut, werden sie immer gezeichnet (nach einem Stufenwechsel frischt das Update
   * sie streifenweise auf; die Silhouette ändert sich dabei kaum). Ist die Vorbereitung im Update ausgefallen (z.B. Qualität
   * eben erst gestiegen, Lauf mitten in einer späten Stufe begonnen), backt das Zeichnen als Rückfall – aber nie zusätzlich zu
   * einem Schritt, der in diesem Frame (gleiche Spielzeit) schon lief: höchstens ein Streifen je Frame.
   */
  private splitReady(v: ViewState, st: number): boolean {
    if (this.splitBuilt) return true;
    if (this.splitT === v.time) return false;
    this.splitT = v.time;
    return this.ensureSplit(st);
  }

  drawOverlay(g: Ctx2D, v: ViewState): void {
    const gl = this.skin ? this.skin.glitch : 0;
    // RGB-Split der Stadt-Ebene während Glitch-Schüben (bei reducedMotion nur schwach & ohne Versatzsprünge)
    if (gl > 0.45 && v.quality > 0 && this.splitReady(v, stIdx(v))) {
      const L = this.mid;
      const dy = Math.round(this.cam * 0.7);
      const amp = v.reducedMotion ? 2 : Math.round(3 + 6 * gl);
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = (v.reducedMotion ? 0.08 : 0.2) * (gl - 0.3);
      blitTiled(g, this.splitR as HTMLCanvasElement, L.w, L.h, v.dist * L.factor - amp, L.y + dy);
      blitTiled(g, this.splitC as HTMLCanvasElement, L.w, L.h, v.dist * L.factor + amp, L.y + dy);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    // Glitch-Schnitte: waagrecht versetzte Streifen der Stadt-Ebene + RGB-Balken (nicht bei reducedMotion)
    if (gl > 0.35 && !v.reducedMotion && v.quality > 0) {
      const L = this.mid;
      const tile = L.cache.get(stIdx(v));
      const seed = Math.floor(v.time * 16);
      const dy = Math.round(this.cam * 0.7);
      for (let i = 0; i < 3; i += 1) {
        if (h1(seed + i * 11) > 0.6) continue;
        const y = Math.round(260 + h1(seed * 3 + i) * 320);
        const h = Math.round(6 + h1(seed + i * 5) * 22);
        const dx = Math.round((h1(seed + i * 2) - 0.5) * 60 * gl);
        const sy = Math.max(0, Math.min(L.h - h, y - L.y - dy));
        const off = Math.round(mod(v.dist * L.factor - dx, L.w));
        g.globalAlpha = 0.85;
        blitStrip(g, tile, L.w, sy, h, off, L.y + dy);
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = 0.16 * gl * flashFactor(v); // additive RGB-Balken: Stärke folgt dem „Blitze“-Regler
        g.fillStyle = i % 2 ? CYAN : MAGENTA;
        g.fillRect(0, y, v.w, h);
        g.fillRect(dx, y + h, v.w, 2);
        g.globalAlpha = 1;
        g.globalCompositeOperation = "source-over";
      }
    }
    // Flip-Impuls: kurzer Streifen-Schimmer an der neuen Lauffläche
    if (this.flipT < 0.45 && !v.reducedMotion) {
      const u = this.flipT / 0.45;
      const y = v.gravDir === -1 ? v.ceilY : v.groundY;
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.35 * (1 - u);
      g.drawImage(v.gravDir === -1 ? this.A.softCyan : this.A.softMagenta, -100, y - 60 - u * 20, v.w + 200, 120 + u * 40);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
  }
}

/** Zeilenband [sy, sy+sh) einer horizontal gekachelten Fläche blitten (ganzzahlig, unskaliert). */
function blitStrip(g: Ctx2D, tile: HTMLCanvasElement, tileW: number, sy: number, sh: number, off: number, y: number, viewW = 1280): void {
  let x = -off;
  let guard = 0;
  while (x < viewW && guard < 8) {
    const x0 = Math.max(0, x);
    const u = x0 - x;
    const w = Math.min(tileW - u, viewW - x0);
    if (w > 0) g.drawImage(tile, u, sy, w, sh, x0, y + sy, w, sh);
    x += tileW;
    guard += 1;
  }
}

/** Stufe robust (0 … MAX_STAGE, NaN → 0) */
function stIdx(v: ViewState): number {
  const s = Math.floor(v.stage);
  return Number.isFinite(s) ? Math.max(0, Math.min(MAX_STAGE, s)) : 0;
}
function stBl(v: ViewState): number {
  const b = v.stageBlend;
  return Number.isFinite(b) && stIdx(v) < MAX_STAGE ? Math.max(0, Math.min(1, b)) : 0;
}
function stF(v: ViewState): number {
  return stIdx(v) + stBl(v);
}

/** 120 BPM Puls (scharfer Anschlag, weiches Abklingen) */
function beatOf(v: ViewState): number {
  if (v.reducedMotion) return 0.4;
  const ph = mod(v.time * 2, 1);
  return Math.exp(-ph * 5);
}
