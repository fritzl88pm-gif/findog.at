/**
 * Finanzamt bei Nacht – WorldRenderer.
 * Ebenen (hinten → vorne): Decken-/Wandgrund · gemalte Amtsräume (Originalbilder, 0.08, je Stufe überblendet) ·
 * Rasterdecke mit Einbauleuchten (0.3) · ferner Boden · Mittelgrund je Stufe (0.42: Schreibtisch-Inseln, Regale,
 * Glasbüros, Archiv, Serverschränke/Tresortür + Lichtkacheln) · Lichtschächte · Säulen mit Notausgang, Kameras und
 * Rundumleuchten + Hängeleuchten mit Flackern (0.72) · Linoleum-/Riffelblechboden mit Spiegelungen, Stempelabdrücken
 * und Schredder-Lücken (1.0) · Vordergrund-Deckenträger (1.25) + Papier & Staub · Taschenlampen-Dunkelheit (Overlay)
 * mit nachgezeichneten Gefahren (Rim-Light).
 */
import { drawPickup } from "../../pickups";
import type { AssetLoader, Ent, PropLibrary, ViewState, WorldRenderer } from "../../types";
import { yieldToMain } from "../../yield";
import { Motes } from "../shared-a/fx";
import { blitTiled, blitTiledRange, glowAt, paint, solidSegments, type Ctx2D } from "../shared-b/canvas";
import { h1, mod, stageVal } from "../shared-b/color";
import { nowMs, stageProgress } from "../shared-b/layers";
import {
  BACK_FLOOR_Y,
  BACK_H,
  BACK_Y,
  CEIL_PAR,
  COLUMN_STEP,
  COLUMN_W,
  FG_PAR,
  FG_W,
  FIXTURE_STEP,
  FLOOR_H,
  FLOOR_W,
  FaBackdrop,
  MASK_H,
  MID_PAR,
  MID_W,
  MID_Y,
  NEAR_PAR,
  paintCeiling,
  paintColumn,
  paintColumnDeco,
  paintExitSign,
  paintFarFloor,
  paintFgTop,
  paintFixture,
  paintFixtureGlow,
  paintFlashlightMask,
  paintBeam,
  BEAM_OX,
  BEAM_OY,
  paintFloor,
  paintMid,
  paintShaft,
  SHAFT_W,
  rgbaHex,
  type MidTiles,
} from "./backdrop";
import {
  FA_OBSTACLE_PROPS,
  drawBat,
  drawBelt,
  drawBlock,
  drawBoxPlatform,
  drawCabin,
  drawChair,
  drawCoin,
  drawGuest,
  drawImprint,
  drawLampSwing,
  drawLaserHigh,
  drawLaserLow,
  drawOverhead,
  drawPlane,
  drawStamp,
  OFFSCREEN_X,
  blitC,
  makeAssets,
  makeCoinStrip,
  type FaAssets,
  type SkinCtx,
} from "./skins";
import { Chunked } from "./chunked";
import { DARK, DRAFT, DUST, EMERGENCY, FAULTY, FA_BACKDROPS, FA_STAGE_METERS, GLASS, LAMPS, LEDS, MAX_STAGE, NEON, PALETTE, PAPER } from "./stages";

const TAU = Math.PI * 2;

/** Meter je Stimmungsstufe (wie WORLD_FINANZAMT.stageMeters; Test in finanzamt.test.ts hält beides gleich) */
export { FA_STAGE_METERS };

/** Mittelgrund einer Stufe samt zerlegten Lichtkacheln */
type MidEntry = MidTiles & { cl: Chunked; cl2: Chunked | null };

/** Pixeldichte der Sprites: Skala der Zeichenfläche, auf Viertel gerundet, 1 … 2 (beim Zeichnen aus der Transformation, in `resize` aus der gemeldeten Skala – dieselbe Rechnung) */
function faDensity(scale: number): number {
  if (!(scale > 0)) return 1;
  return Math.max(1, Math.min(2, Math.round(scale * 4) / 4));
}

export const FA_PROPS = ["office-chair", "bat-fly", "shredder", ...FA_OBSTACLE_PROPS];
const BACK_PAR = 0.08;
const CAMERAS = [0.15, 0.55, 0.8, 0.6, 0.75];
const GUESTS = new Set(["odo", "madinger", "jqa", "luki"]);
const MAX_FIX = 8;

export class FinanzamtRenderer implements WorldRenderer {
  private backdrop = new FaBackdrop(FA_BACKDROPS);
  private A!: FaAssets;
  private K!: SkinCtx;
  private props: PropLibrary | null = null;
  private built = false;
  private ceil!: { base: HTMLCanvasElement; lights: Chunked };
  private mids = new Map<number, MidEntry>();
  private floors: HTMLCanvasElement[] = [];
  private farFloors: HTMLCanvasElement[] = [];
  private columns: HTMLCanvasElement[] = [];
  private colDeco: HTMLCanvasElement[] = [];
  private fixture!: HTMLCanvasElement;
  private fixGlow!: HTMLCanvasElement;
  private fixGlowC!: Chunked;
  private fixRefl!: HTMLCanvasElement;
  private alarmWash!: HTMLCanvasElement;
  private topShade!: HTMLCanvasElement;
  private shaft!: HTMLCanvasElement;
  private exitSign!: { base: HTMLCanvasElement; glow: HTMLCanvasElement };
  private fgTop!: HTMLCanvasElement;
  private mask!: HTMLCanvasElement;
  private beam!: Chunked;
  private motes = new Motes(170);
  private paperT = 0;
  private gustT = 9;
  private dustT = 0;
  // Stempelabdrücke (Weltkoordinaten)
  private impX = new Float64Array(10);
  private impT = new Float64Array(10).fill(-99);
  private impN = 0;
  // Hängeleuchten dieses Frames (für Boden-Spiegelung & Overlay)
  private fixX = new Float32Array(MAX_FIX);
  private fixA = new Float32Array(MAX_FIX);
  private fixN = 0;
  // Säulen dieses Frames (Kamera-/Rundumleuchten-Glühen im Overlay)
  private colX = new Float32Array(4);
  private colSlot = new Float32Array(4);
  private colN = 0;
  // Gefahren dieses Frames (für das Nachzeichnen über der Dunkelheit)
  private rec: Ent[] = [];
  private recX: number[] = [];
  private recY: number[] = [];
  private recN = 0;
  private lastStage = -1;
  /** Pixeldichte der Sprites (aus `resize`, beim Zeichnen nachgeführt) */
  private pixelK = 1;
  /** Zeitpunkt (ms) des letzten Vorbereitungsschritts der Folgestufe */
  private prepAt = -1e9;
  private time = 0;
  private burstSeen = 0;
  private sparkT = 0;

  async load(assets: AssetLoader): Promise<void> {
    this.props = assets.props;
    await Promise.all([this.backdrop.load(assets.image), assets.props.preload(FA_PROPS).catch(() => undefined)]);
    // Statisches in Schritten bauen und dazwischen den Hauptthread freigeben (kein Long Task, Eingaben laufen weiter)
    while (this.stepBuild()) await yieldToMain();
    this.A.props = assets.props;
    for (const stage of [0, 1]) {
      const it = this.midSteps(stage);
      for (;;) {
        const r = it.next();
        if (r.done) break;
        await yieldToMain();
      }
      await yieldToMain();
    }
    this.backdrop.tile(0);
    await yieldToMain();
    this.backdrop.tile(1);
  }

  /**
   * Skalenwechsel (Governor, Vollbild, DPR). Idempotent: dieselbe Pixeldichte (auf Viertel gerundet) ändert nichts; nur eine
   * echte Änderung verwirft die Hindernis-Sprites und backt den Münzstreifen neu (sonst erst beim nächsten Zeichnen). Vor
   * dem Laden wird nur die Dichte gemerkt, damit beim Bauen gleich in der richtigen Auflösung gebacken wird.
   */
  resize(dpr: number): void {
    this.applyScale(faDensity(dpr));
  }

  private applyScale(k: number): void {
    this.pixelK = k;
    const A = this.A as FaAssets | undefined;
    if (!A || A.cache.k === k) return;
    A.cache.k = k;
    A.cache.clear();
    A.pcache.k = k;
    A.pcache.clear();
    A.coin = makeCoinStrip(k);
    A.coinSize = A.coin.height;
  }

  /**
   * Bauabschnitte des statischen Zeichnens. Jeder ist ein Generator, der zwischen seinen Teilstücken `yield`et: `load` gibt
   * dort den Hauptthread frei (kein Long Task, auch bei 4× gedrosselter CPU), der Fallback `build` läuft einfach durch.
   */
  private readonly parts: Array<() => Generator<void, void, void>> = [
    () => this.buildAssets(),
    () => this.buildCeiling(),
    () => this.buildGrounds(),
    () => this.buildFixtures(),
    () => this.buildOverlays(),
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
    if (this.built) return;
    while (this.stepBuild()) {
      /* durchlaufen */
    }
  }

  private *buildAssets(): Generator<void, void, void> {
    this.A = makeAssets(this.pixelK);
    this.A.props = this.props;
    this.A.cache.k = this.pixelK;
    this.A.pcache.k = this.pixelK;
    this.K = { A: this.A, time: 0, reduced: false, quality: 2, dark: 0 };
    yield;
  }

  private *buildCeiling(): Generator<void, void, void> {
    const ce = paintCeiling();
    yield;
    this.ceil = { base: ce.base, lights: yield* Chunked.steps(ce.lights, 128) };
  }

  private *buildGrounds(): Generator<void, void, void> {
    for (let s = 0; s <= MAX_STAGE; s += 1) {
      this.floors.push(paintFloor(s));
      this.farFloors.push(paintFarFloor(s));
      this.columns.push(paintColumn(s));
      yield;
    }
    this.colDeco = [paintColumnDeco(0), paintColumnDeco(1), paintColumnDeco(2)];
  }

  private *buildFixtures(): Generator<void, void, void> {
    this.fixture = paintFixture();
    this.fixGlow = paintFixtureGlow("#cfe2ff");
    this.fixGlowC = yield* Chunked.steps(this.fixGlow, 60);
    yield;
    this.fixRefl = paint(360, 110, (g) => {
      const blob = (cx: number, cy: number, rx: number, ry: number, col: string, a: number): void => {
        g.save();
        g.translate(cx, cy);
        g.scale(1, ry / rx);
        const grd = g.createRadialGradient(0, 0, 0, 0, 0, rx);
        grd.addColorStop(0, rgbaHex(col, a));
        grd.addColorStop(0.4, rgbaHex(col, a * 0.4));
        grd.addColorStop(1, rgbaHex(col, 0));
        g.fillStyle = grd;
        g.fillRect(-rx, -rx, rx * 2, rx * 2);
        g.restore();
      };
      blob(180, 36, 90, 34, "#5ac8ff", 0.45);
      blob(180, 80, 170, 20, "#cfe2ff", 0.2);
      g.fillStyle = "rgba(235,245,255,0.3)";
      g.fillRect(100, 78, 160, 2);
    });
    this.alarmWash = paint(1280, 180, (g) => {
      const grd = g.createLinearGradient(0, 0, 0, 180);
      grd.addColorStop(0, "rgba(255,30,50,0.12)");
      grd.addColorStop(1, "rgba(255,30,50,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, 1280, 180);
    });
    this.topShade = paint(1280, 220, (g) => {
      const grd = g.createLinearGradient(0, 0, 0, 220);
      grd.addColorStop(0, rgbaHex("#020612", 0.35));
      grd.addColorStop(1, rgbaHex("#020612", 0));
      g.fillStyle = grd;
      g.fillRect(0, 0, 1280, 220);
    });
  }

  private *buildOverlays(): Generator<void, void, void> {
    this.shaft = paintShaft("#cfe2ff");
    this.exitSign = paintExitSign();
    this.fgTop = paintFgTop();
    yield;
    this.mask = paintFlashlightMask("#02050d");
    yield;
    this.beam = yield* Chunked.steps(paintBeam("#fff1d6"), 80, 2, 40);
    this.built = true;
  }

  private shredderProp = (g: Ctx2D, x: number, base: number, h: number): void => {
    if (this.props?.has("shredder")) this.props.draw(g, "shredder", x, base, { h });
    else {
      g.fillStyle = "#3a4254";
      g.fillRect(x - 26, base - h * 0.8, 52, h * 0.8);
      g.fillStyle = "#e8e3d4";
      g.fillRect(x - 16, base - h * 0.8 - 14, 32, 16);
    }
  };

  /** Mittelgrund einer Stufe, in Schritten (Kacheln malen, Lichtkacheln zerlegen); `mid` läuft am Stück durch */
  private *midSteps(stage: number): Generator<void, MidEntry, void> {
    let m = this.mids.get(stage);
    if (m) return m;
    const t = paintMid(stage, this.props ? this.shredderProp : null);
    yield;
    const cl = yield* Chunked.steps(t.lights, 64, 3, 32);
    yield;
    const cl2 = t.lights2 ? yield* Chunked.steps(t.lights2, 64, 3, 32) : null;
    m = { ...t, cl, cl2 };
    this.mids.set(stage, m);
    if (this.mids.size > 3) {
      for (const k of [...this.mids.keys()]) {
        if (this.mids.size <= 3) break;
        if (k !== stage && k !== this.lastStage && k !== this.lastStage + 1) this.mids.delete(k);
      }
    }
    return m;
  }

  private mid(stage: number): MidEntry {
    const hit = this.mids.get(stage);
    if (hit) return hit;
    const it = this.midSteps(stage);
    for (;;) {
      const r = it.next();
      if (r.done) return r.value;
    }
  }

  update(dt: number, v: ViewState): void {
    this.build();
    const d = Math.min(0.05, dt);
    this.time += d;
    this.A.budget.n = 0;
    const st = v.stage;
    const s = st + v.stageBlend;
    // Folgestufe verteilt vorbereiten: nicht am Stufenanfang (dort drängt sich sonst alles auf den Übergang), sondern ab ~28 %
    // der Stufe, ein Schritt (Mittelgrund bzw. Kulissenkachel) je ~100 ms; beginnt die Überblendung, wird nachgeholt
    this.lastStage = st;
    if (!this.mids.has(st)) this.mid(st);
    if (st < MAX_STAGE) {
      const urgent = v.stageBlend > 0.001;
      if (urgent || stageProgress(v.worldMeters, FA_STAGE_METERS) >= 0.28) {
        const t = nowMs();
        if (t < this.prepAt) this.prepAt = t; // Uhr zurückgesetzt
        if (urgent || t - this.prepAt >= 100) {
          if (!this.mids.has(st + 1)) {
            this.mid(st + 1);
            this.prepAt = t;
          } else if (!this.backdrop.has(st + 1)) {
            this.backdrop.tile(st + 1);
            this.prepAt = t;
          }
        }
      }
    }
    // Papier im Luftzug + Staub
    const q = v.quality === 0 ? 0.3 : v.quality === 1 ? 0.6 : 1;
    const draft = stageVal(DRAFT, s);
    this.paperT -= d * stageVal(PAPER, s) * 2.2 * q;
    while (this.paperT < 0) {
      this.paperT += 1;
      this.motes.spawn("paper", 1300, 120 + Math.random() * 440, -60 - Math.random() * 120, -20 + Math.random() * 50, 7, 4 + Math.random() * 4, 0.35 + Math.random() * 0.55);
    }
    // gelegentliche Böe: ein Schwall Papier fegt durchs Bild
    this.gustT -= d;
    if (this.gustT <= 0) {
      this.gustT = 8 + Math.random() * 10;
      if (!v.reducedMotion && v.quality > 0) {
        const n = Math.round(8 + 10 * stageVal(PAPER, s));
        const y0 = 180 + Math.random() * 260;
        for (let i = 0; i < n; i += 1) {
          this.motes.spawn("paper", 1300 + Math.random() * 260, y0 + (Math.random() - 0.5) * 160, -380 - Math.random() * 260, -40 + Math.random() * 80, 5, 4 + Math.random() * 5, 0.6 + Math.random() * 0.4);
        }
      }
    }
    this.dustT -= d * stageVal(DUST, s) * 14 * q;
    while (this.dustT < 0) {
      this.dustT += 1;
      this.motes.spawn("dust", Math.random() * 1400, 60 + Math.random() * 520, -8 + Math.random() * 16, -6 + Math.random() * 12, 5 + Math.random() * 4, 1.2 + Math.random() * 1.6, 0.25 + Math.random() * 0.4);
    }
    // zerlegte Aktenstapel: Papier fliegt auseinander
    const burst = v.vars["fa:burst"] ?? 0;
    if (burst !== this.burstSeen) {
      this.burstSeen = burst;
      const bx = v.vars["fa:burstX"] ?? 400;
      const by = v.vars["fa:burstY"] ?? 520;
      const n = v.quality === 0 ? 6 : 16;
      for (let i = 0; i < n; i += 1) {
        const a = Math.random() * Math.PI * 2;
        const sp = 180 + Math.random() * 380;
        this.motes.spawn("paper", bx + (Math.random() - 0.5) * 40, by + (Math.random() - 0.5) * 40, Math.cos(a) * sp, Math.sin(a) * sp - 160, 1.8, 4 + Math.random() * 5, 1);
      }
    }
    // Serverkeller: Funken aus der Kabeltrasse
    if (s > 3.5 && !v.reducedMotion && v.quality > 0) {
      this.sparkT -= d;
      if (this.sparkT <= 0) {
        this.sparkT = 0.9 + Math.random() * 2.2;
        const x = 200 + Math.random() * 1000;
        for (let i = 0; i < 7; i += 1) this.motes.spawn("spark", x, 150 + Math.random() * 20, (Math.random() - 0.5) * 160, -40 - Math.random() * 120, 0.5 + Math.random() * 0.4, 1.2 + Math.random(), 0.42);
      }
    }
    this.motes.update(d, v.speed, v.reducedMotion ? 0 : draft * 0.5, v.time);
  }

  // ------------------------------------------------------------------------------------------------

  private darkness(v: ViewState): number {
    const s = v.stage + v.stageBlend;
    const base = v.vars.darkness ?? stageVal(DARK, s);
    const fadeIn = Math.min(1, v.worldMeters / 10);
    const exit = v.vars["fa:exit"] ?? 0;
    return Math.max(0, Math.min(0.9, base * fadeIn * (1 - exit)));
  }

  /** Helligkeit einer Deckenleuchte (Flackern defekter Röhren, Stromausfall) */
  private neonLevel(slot: number, v: ViewState, s: number): number {
    const black = v.vars.blackout ?? 0;
    let a = stageVal(NEON, s) * (1 - black);
    if (black > 0.02 && black < 0.98 && !v.reducedMotion) a = h1(Math.floor(v.time * 14) + slot * 7.7) < 0.5 ? stageVal(NEON, s) : 0.05;
    if (h1(slot * 3.17 + 0.5) < stageVal(FAULTY, s)) {
      if (v.reducedMotion) a *= 0.4;
      else if (h1(Math.floor(v.time * 11) + slot * 13.1) < 0.28) a *= 0.12;
    }
    return a;
  }

  drawBackground(g: Ctx2D, v: ViewState): void {
    this.build();
    this.recN = 0;
    const A0 = g.globalAlpha;
    const st = v.stage;
    const bl = v.stageBlend;
    const s = st + bl;
    const P = PALETTE[st];
    const P2 = PALETTE[Math.min(MAX_STAGE, st + 1)];
    const q = g.imageSmoothingQuality;
    g.imageSmoothingQuality = "low";
    // Pixeldichte der Zeichenfläche → Entitäts-Sprites in Zielauflösung (scharf auf Hi-DPI)
    const tk = typeof g.getTransform === "function" ? g.getTransform().a : 1;
    const k = faDensity(tk);
    if (k !== this.A.cache.k) this.applyScale(k);
    this.K.time = v.time;
    this.K.reduced = v.reducedMotion;
    this.K.quality = v.quality;
    this.K.dark = this.darkness(v);

    // 1) Grund: nur die Streifen, die keine deckende Ebene überdeckt (Decke oben, Übergang zum fernen Boden)
    g.fillStyle = bl > 0.5 ? P2.ceil : P.ceil;
    g.fillRect(0, 0, v.w, BACK_Y + 2);
    g.fillStyle = bl > 0.5 ? P2.floorLo : P.floorLo;
    g.fillRect(0, BACK_Y + BACK_H - 4, v.w, 600 - (BACK_Y + BACK_H - 4));
    if (!this.backdrop.ready) {
      g.fillStyle = P.wall;
      g.fillRect(0, BACK_Y, v.w, BACK_H);
    }

    // 2) Gemalte Amtsräume (Originalbilder)
    const bScroll = v.dist * BACK_PAR;
    if (this.backdrop.ready) {
      this.backdrop.draw(g, st, bScroll, BACK_Y);
      if (bl > 0.004 && st < MAX_STAGE) {
        g.globalAlpha = A0 * bl;
        this.backdrop.draw(g, st + 1, bScroll, BACK_Y);
        g.globalAlpha = A0;
      }
    } else this.drawBackFallback(g, v, s);

    // 3) Rasterdecke (0.3) mit Einbauleuchten
    const cScroll = v.dist * CEIL_PAR;
    blitTiled(g, this.ceil.base, this.ceil.base.width, this.ceil.base.height, cScroll, 0, v.w);
    const neon = stageVal(NEON, s) * (1 - (v.vars.blackout ?? 0));
    if (neon > 0.03) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = A0 * neon * 0.85;
      this.ceil.lights.drawTiled(g, cScroll, 0, v.w);
      g.globalAlpha = A0;
      g.globalCompositeOperation = "source-over";
    }

    // 4) Ferner Boden
    const ffy = BACK_FLOOR_Y - 8;
    g.drawImage(this.farFloors[st], 0, ffy);
    if (bl > 0.004 && st < MAX_STAGE) {
      g.globalAlpha = A0 * bl;
      g.drawImage(this.farFloors[st + 1], 0, ffy);
      g.globalAlpha = A0;
    }

    // 5) Mittelgrund
    const mScroll = v.dist * MID_PAR;
    const mA = this.mid(st);
    blitTiled(g, mA.base, MID_W, mA.base.height, mScroll, MID_Y, v.w);
    const mB = bl > 0.004 && st < MAX_STAGE && this.mids.has(st + 1) ? this.mid(st + 1) : null;
    if (mB) {
      g.globalAlpha = A0 * bl;
      blitTiled(g, mB.base, MID_W, mB.base.height, mScroll, MID_Y, v.w);
      g.globalAlpha = A0;
    }
    this.drawMidLights(g, v, mA, mB, s, bl, 1);
    // Glas-Spiegelung wandert über die Glasbüros
    const glass = stageVal(GLASS, s);
    if (glass > 0.2 && v.quality > 0) {
      g.globalCompositeOperation = "lighter";
      const off = mod(v.dist * (1 - MID_PAR) * 0.35, 900);
      for (let x = -off - 200; x < v.w + 200; x += 900) {
        const grd = g.createLinearGradient(x, 0, x + 160, 0);
        grd.addColorStop(0, "rgba(180,230,255,0)");
        grd.addColorStop(0.5, `rgba(180,230,255,${(0.07 * glass).toFixed(3)})`);
        grd.addColorStop(1, "rgba(180,230,255,0)");
        g.fillStyle = grd;
        g.beginPath();
        g.moveTo(x + 60, MID_Y + 70);
        g.lineTo(x + 160, MID_Y + 70);
        g.lineTo(x + 100, MID_Y + 300);
        g.lineTo(x, MID_Y + 300);
        g.closePath();
        g.fill();
      }
      g.globalCompositeOperation = "source-over";
    }

    // 6) Nahe Ebene: Hängeleuchten mit Lichtschächten, Säulen
    this.drawNear(g, v, s, A0);
    g.imageSmoothingQuality = q;
    g.globalAlpha = A0;
  }

  private drawMidLights(g: Ctx2D, v: ViewState, mA: MidTiles & { cl: Chunked; cl2: Chunked | null }, mB: (MidTiles & { cl: Chunked; cl2: Chunked | null }) | null, s: number, bl: number, k: number, withLeds = true): void {
    const A0 = g.globalAlpha;
    const lamps = stageVal(LAMPS, s) * (1 - (v.vars.blackout ?? 0) * 0.6) * k;
    const leds = stageVal(LEDS, s) * k;
    const blink = v.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(v.time * 2.3);
    const mScroll = v.dist * MID_PAR;
    g.globalCompositeOperation = "lighter";
    const one = (m: MidTiles & { cl: Chunked; cl2: Chunked | null }, a: number): void => {
      if (a * lamps > 0.02) {
        g.globalAlpha = A0 * a * Math.min(1, lamps + leds * 0.4);
        m.cl.drawTiled(g, mScroll, MID_Y, v.w);
      }
      if (withLeds && m.cl2 && a * leds > 0.02) {
        g.globalAlpha = A0 * a * leds * blink;
        m.cl2.drawTiled(g, mScroll, MID_Y, v.w);
      }
    };
    one(mA, mB ? 1 - bl : 1);
    if (mB) one(mB, bl);
    g.globalAlpha = A0;
    g.globalCompositeOperation = "source-over";
  }

  private drawBackFallback(g: Ctx2D, v: ViewState, s: number): void {
    // ohne Originalbilder: Wand mit Regal-Silhouetten und Deckenleuchten
    const P = PALETTE[Math.round(s)] ?? PALETTE[0];
    g.fillStyle = P.wall;
    g.fillRect(0, BACK_Y, v.w, BACK_FLOOR_Y - BACK_Y);
    const scroll = v.dist * BACK_PAR;
    g.fillStyle = "rgba(10,14,24,0.6)";
    for (let i = -1; i < 10; i += 1) {
      const x = Math.round(i * 180 - mod(scroll, 180));
      g.fillRect(x, BACK_Y + 130, 130, BACK_FLOOR_Y - BACK_Y - 130);
    }
  }

  private drawNear(g: Ctx2D, v: ViewState, s: number, A0: number): void {
    const scroll = v.dist * NEAR_PAR;
    const st = v.stage;
    // Hängeleuchten
    this.fixN = 0;
    const f0 = Math.floor((scroll - 260) / FIXTURE_STEP);
    const f1 = Math.floor((scroll + v.w + 260) / FIXTURE_STEP);
    for (let slot = f0; slot <= f1; slot += 1) {
      const x = Math.round(slot * FIXTURE_STEP - scroll + FIXTURE_STEP / 2);
      const a = this.neonLevel(slot, v, s);
      if (this.fixN < MAX_FIX) {
        this.fixX[this.fixN] = x;
        this.fixA[this.fixN] = a;
        this.fixN += 1;
      }
      // Lichtschacht (jede zweite Leuchte – Füllrate)
      if (a > 0.05 && v.quality > 0 && (slot & 1) === 0) {
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = A0 * a * 0.5;
        g.drawImage(this.shaft, x - SHAFT_W / 2, 62);
        g.globalCompositeOperation = "source-over";
        g.globalAlpha = A0;
      }
    }
    // Säulen
    this.colN = 0;
    const c0 = Math.floor((scroll - 200) / COLUMN_STEP);
    const c1 = Math.floor((scroll + v.w + 200) / COLUMN_STEP);
    const col = this.columns[st];
    const colB = v.stageBlend > 0.004 && st < MAX_STAGE ? this.columns[st + 1] : null;
    for (let slot = c0; slot <= c1; slot += 1) {
      const x = Math.round(slot * COLUMN_STEP - scroll);
      if (x < -140 || x > v.w + 40) continue;
      g.drawImage(col, x - 10, 0);
      if (colB) {
        g.globalAlpha = A0 * v.stageBlend;
        g.drawImage(colB, x - 10, 0);
        g.globalAlpha = A0;
      }
      if (this.colN < 4) {
        this.colX[this.colN] = x;
        this.colSlot[this.colN] = slot;
        this.colN += 1;
      }
      // Notausgang-Schild, Deko (Feuerlöscher / Aushang / Uhr)
      if (h1(slot * 1.7) < 0.5) g.drawImage(this.exitSign.base, x + COLUMN_W / 2 - 36, 150);
      const dk = h1(slot * 9.3 + 2);
      if (dk < 0.8) g.drawImage(this.colDeco[dk < 0.4 ? 0 : dk < 0.65 ? 1 : 2], x + COLUMN_W / 2 - 30, dk < 0.4 ? 346 : 300);
      // Kamera
      if (h1(slot * 5.3 + 1) < stageVal(CAMERAS, s)) this.drawCamera(g, v, x + COLUMN_W / 2, 112);
      // Rundumleuchte (Gehäuse)
      if (stageVal(EMERGENCY, s) > 0.05 || (v.vars.blackout ?? 0) > 0.05) {
        g.fillStyle = "#1a1d24";
        g.fillRect(x + COLUMN_W / 2 - 9, 72, 18, 7);
        g.fillStyle = st >= 4 ? "#a0141e" : "#b0600e";
        g.beginPath();
        g.arc(x + COLUMN_W / 2, 72, 8, Math.PI, TAU);
        g.fill();
      }
    }
    // Hängeleuchten-Gehäuse + Röhre
    for (let i = 0; i < this.fixN; i += 1) {
      const x = this.fixX[i];
      if (x < -200 || x > v.w + 200) continue;
      g.drawImage(this.fixture, x - 100, 0);
      const a = this.fixA[i];
      if (a > 0.03) {
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = A0 * a;
        this.fixGlowC.draw(g, x - 180, -2);
        g.globalCompositeOperation = "source-over";
        g.globalAlpha = A0;
      }
    }
  }

  private drawCamera(g: Ctx2D, v: ViewState, x: number, y: number): void {
    // zielt auf die Figur (Kopfhöhe), sanft begrenzt
    const tx = v.playerX;
    const ty = v.playerFeetY - 110;
    let ang = Math.atan2(ty - y, tx - x);
    ang = Math.max(Math.PI * 0.2, Math.min(Math.PI * 0.95, ang));
    if (v.reducedMotion) ang = Math.PI * 0.7;
    g.fillStyle = "#12161e";
    g.fillRect(x - 4, y - 18, 8, 16);
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.fillStyle = "#c9ced8";
    g.beginPath();
    g.rect(-6, -8, 34, 16);
    g.fill();
    g.strokeStyle = "#0c0e14";
    g.lineWidth = 1.5;
    g.stroke();
    g.fillStyle = "#1a1d24";
    g.fillRect(26, -6, 7, 12);
    g.fillStyle = "#3a6a9a";
    g.beginPath();
    g.arc(32, 0, 3.5, 0, TAU);
    g.fill();
    g.fillStyle = "#e8ecf2";
    g.fillRect(-4, -10, 30, 3);
    g.restore();
    const on = v.reducedMotion ? true : v.time % 1.2 < 0.6;
    g.fillStyle = on ? "#ff2a44" : "#5a1016";
    g.beginPath();
    g.arc(x + 8, y - 4, 2.5, 0, TAU);
    g.fill();
  }

  // ------------------------------------------------------------------------------------------------

  drawGround(g: Ctx2D, v: ViewState, pits: ReadonlyArray<{ x0: number; x1: number; skin: string }>): void {
    this.build();
    const A0 = g.globalAlpha;
    const st = v.stage;
    const bl = v.stageBlend;
    const gy = v.groundY;
    const H = v.h - gy;
    const q = g.imageSmoothingQuality;
    g.imageSmoothingQuality = "low";
    const segs = solidSegments(pits, v.w);
    const fA = this.floors[st];
    const fB = bl > 0.004 && st < MAX_STAGE ? this.floors[st + 1] : null;
    for (const sg of segs) {
      const a = Math.max(0, sg.x0);
      const b = Math.min(v.w, sg.x1);
      if (b <= a) continue;
      blitTiledRange(g, fA, FLOOR_W, FLOOR_H, v.dist, a, b, gy);
      if (fB) {
        g.globalAlpha = A0 * bl;
        blitTiledRange(g, fB, FLOOR_W, FLOOR_H, v.dist, a, b, gy);
        g.globalAlpha = A0;
      }
    }
    // Spiegelungen der Leuchten im polierten Linoleum
    if (v.quality > 0) {
      g.globalCompositeOperation = "lighter";
      for (let i = 0; i < this.fixN; i += 1) {
        const a = this.fixA[i];
        const x = this.fixX[i];
        if (a < 0.05 || x < -120 || x > v.w + 120 || inPit(pits, x, 60)) continue;
        g.globalAlpha = A0 * a;
        g.drawImage(this.fixRefl, Math.round(x - 180), gy);
      }
      g.globalAlpha = A0;
      g.globalCompositeOperation = "source-over";
    }
    // Stempelabdrücke
    for (let i = 0; i < this.impX.length; i += 1) {
      const age = this.time - this.impT[i];
      if (age > 9 || age < 0) continue;
      const x = this.impX[i] - v.dist;
      if (x < -80 || x > v.w + 80 || inPit(pits, x, 60)) continue;
      drawImprint(g, x, gy, A0 * Math.min(0.75, (9 - age) / 3));
    }
    g.globalAlpha = A0;
    // Lücken
    for (const p of pits) {
      if (p.skin === "shaft") this.drawShaft(g, v, p.x0, p.x1);
      else this.drawShredder(g, v, p.x0, p.x1);
    }
    // Kanten zur Lücke
    for (const sg of segs) {
      if (sg.x0 > -20 && sg.x0 < v.w + 20) this.edge(g, sg.x0, gy, H, false);
      if (sg.x1 > -20 && sg.x1 < v.w + 20) this.edge(g, sg.x1, gy, H, true);
    }
    g.imageSmoothingQuality = q;
  }

  private edge(g: Ctx2D, x: number, gy: number, H: number, right: boolean): void {
    const xx = Math.round(right ? x - 6 : x);
    g.fillStyle = "#0b0e14";
    g.fillRect(xx, gy, 6, H);
    g.fillStyle = "rgba(200,220,255,0.35)";
    g.fillRect(right ? xx : xx + 5, gy, 1, H);
    // Warnstreifen auf der Bodenkante
    const x0 = right ? x - 30 : x;
    for (let i = 0; i < 3; i += 1) {
      g.fillStyle = i % 2 === 0 ? "#d9a520" : "#141414";
      g.fillRect(Math.round(x0 + i * 10), gy + 1, 10, 5);
    }
  }

  private drawShredder(g: Ctx2D, v: ViewState, px0: number, px1: number): void {
    const gy = v.groundY;
    const x0 = Math.max(-20, px0);
    const x1 = Math.min(v.w + 20, px1);
    if (x1 <= x0) return;
    const w = x1 - x0;
    const A0 = g.globalAlpha;
    g.save();
    g.beginPath();
    g.rect(x0, gy, w, v.h - gy);
    g.clip();
    const bg = g.createLinearGradient(0, gy, 0, v.h);
    bg.addColorStop(0, "#1a2130");
    bg.addColorStop(0.45, "#0b0f16");
    bg.addColorStop(1, "#030407");
    g.fillStyle = bg;
    g.fillRect(x0, gy, w, v.h - gy);
    // Wandbleche mit Nieten
    g.fillStyle = "#222a38";
    g.fillRect(px0, gy, 16, v.h - gy);
    g.fillRect(px1 - 16, gy, 16, v.h - gy);
    g.fillStyle = "rgba(170,190,220,0.35)";
    for (let y = gy + 12; y < v.h; y += 22) {
      g.fillRect(px0 + 6, y, 3, 3);
      g.fillRect(px1 - 10, y, 3, 3);
    }
    // Schneidwalzen im Trichter
    const ry = gy + 70;
    g.fillStyle = "#2c3446";
    g.beginPath();
    g.moveTo(px0 + 16, gy);
    g.lineTo(px0 + 34, gy);
    g.lineTo(px0 + 54, ry - 20);
    g.lineTo(px0 + 16, ry - 20);
    g.closePath();
    g.moveTo(px1 - 16, gy);
    g.lineTo(px1 - 34, gy);
    g.lineTo(px1 - 54, ry - 20);
    g.lineTo(px1 - 16, ry - 20);
    g.closePath();
    g.fill();
    g.fillStyle = "rgba(190,210,240,0.3)";
    g.fillRect(px0 + 16, gy, 18, 1.5);
    g.fillRect(px1 - 34, gy, 18, 1.5);
    const t = v.reducedMotion ? 0 : v.time;
    const pulse = v.reducedMotion ? 0.7 : 0.6 + 0.4 * Math.sin(v.time * 6);
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = A0 * 0.22 * pulse;
    g.fillStyle = "#ff2a30";
    g.fillRect(x0, ry - 16, w, 36);
    g.globalAlpha = A0;
    g.globalCompositeOperation = "source-over";
    for (const [yy, dir] of [
      [ry - 10, 1],
      [ry + 14, -1],
    ] as const) {
      const grd = g.createLinearGradient(0, yy - 10, 0, yy + 10);
      grd.addColorStop(0, "#1a1e26");
      grd.addColorStop(0.45, "#5a6272");
      grd.addColorStop(1, "#12151c");
      g.fillStyle = grd;
      g.fillRect(x0, yy - 9, w, 18);
      // Zähne (Spitzen hell, greifen ineinander)
      const off = mod(t * 160 * dir + v.dist, 18);
      g.fillStyle = "#c9d2e0";
      g.strokeStyle = "#0a0c10";
      g.lineWidth = 1.2;
      g.beginPath();
      for (let x = x0 - 18 + off; x < x1 + 18; x += 18) {
        const tip = dir > 0 ? yy + 15 : yy - 15;
        const b = dir > 0 ? yy + 4 : yy - 4;
        g.moveTo(x, b);
        g.lineTo(x + 6, tip);
        g.lineTo(x + 12, b);
      }
      g.fill();
      g.stroke();
    }
    // glühender Schneidspalt
    g.globalCompositeOperation = "lighter";
    g.fillStyle = `rgba(255,50,40,${(0.5 * pulse).toFixed(3)})`;
    g.fillRect(x0, ry + 1, w, 3);
    g.globalCompositeOperation = "source-over";
    // Tiefe: oberer Schachtrand dunkel (klarer Abgrund)
    const lip = g.createLinearGradient(0, gy, 0, gy + 34);
    lip.addColorStop(0, "rgba(0,0,0,0.65)");
    lip.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = lip;
    g.fillRect(x0, gy, w, 34);
    // Papierstreifen fallen hinein, Schnipsel darunter
    if (v.quality > 0) {
      g.fillStyle = "rgba(240,236,224,0.85)";
      const n = Math.min(10, Math.floor(w / 36));
      for (let i = 0; i < n; i += 1) {
        const life = (t * 0.9 + h1(i * 3.3 + px0 * 0.001)) % 1;
        const x = x0 + ((i + 0.5) / n) * w + Math.sin(life * 9 + i) * 6;
        const y = gy + 4 + life * 56;
        g.fillRect(x, y, 3, 14 * (1 - life) + 4);
      }
      g.fillStyle = "rgba(220,216,204,0.6)";
      for (let i = 0; i < n * 2; i += 1) {
        const life = (t * 1.3 + h1(i * 1.7)) % 1;
        const x = x0 + h1(i * 7.1) * w;
        g.fillRect(x, ry + 26 + life * 60, 2, 5);
      }
    }
    const dark = g.createLinearGradient(0, ry + 30, 0, v.h);
    dark.addColorStop(0, "rgba(0,0,0,0.1)");
    dark.addColorStop(1, "rgba(0,0,0,0.85)");
    g.fillStyle = dark;
    g.fillRect(x0, ry + 30, w, v.h - ry - 30);
    // Schattenkante links
    const lg = g.createLinearGradient(px0, 0, px0 + 50, 0);
    lg.addColorStop(0, "rgba(0,0,0,0.6)");
    lg.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = lg;
    g.fillRect(px0, gy, 50, v.h - gy);
    g.restore();
  }

  private drawShaft(g: Ctx2D, v: ViewState, px0: number, px1: number): void {
    const gy = v.groundY;
    const x0 = Math.max(-20, px0);
    const x1 = Math.min(v.w + 20, px1);
    if (x1 <= x0) return;
    const w = x1 - x0;
    const A0 = g.globalAlpha;
    g.save();
    g.beginPath();
    g.rect(x0, gy, w, v.h - gy);
    g.clip();
    const bg = g.createLinearGradient(0, gy, 0, v.h);
    bg.addColorStop(0, "#161c28");
    bg.addColorStop(1, "#020306");
    g.fillStyle = bg;
    g.fillRect(x0, gy, w, v.h - gy);
    // Mauerwerk
    g.strokeStyle = "rgba(90,100,130,0.22)";
    g.lineWidth = 1;
    g.beginPath();
    for (let y = gy + 8, r = 0; y < v.h; y += 12, r += 1) {
      g.moveTo(x0, y);
      g.lineTo(x1, y);
      const off = (r % 2) * 16 + mod(v.dist, 32);
      for (let x = x0 - off; x < x1; x += 32) {
        g.moveTo(x, y);
        g.lineTo(x, y + 12);
      }
    }
    g.stroke();
    // Führungsschienen + Ketten
    g.fillStyle = "#3a4254";
    for (let x = px0 + 40; x < px1 - 20; x += 110) g.fillRect(x, gy, 6, v.h - gy);
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = A0 * 0.4;
    blitC(g, this.A.glow.get("rgba(90,200,255,1)", Math.min(400, w * 0.5), 30), (px0 + px1) / 2, v.h - 10);
    g.globalAlpha = A0;
    g.globalCompositeOperation = "source-over";
    const dark = g.createLinearGradient(0, gy, 0, v.h);
    dark.addColorStop(0, "rgba(0,0,0,0.05)");
    dark.addColorStop(1, "rgba(0,0,0,0.75)");
    g.fillStyle = dark;
    g.fillRect(x0, gy, w, v.h - gy);
    g.restore();
  }

  // ------------------------------------------------------------------------------------------------

  private record(e: Ent, sx: number, sy: number): void {
    const i = this.recN;
    if (i >= 48) return;
    this.rec[i] = e;
    this.recX[i] = sx;
    this.recY[i] = sy;
    this.recN = i + 1;
  }

  private sideEffects(e: Ent, sx: number, v: ViewState): void {
    if (e.skin === "stamp" && e.state === "active" && !e.fx.slammed) {
      e.fx.slammed = 1;
      const k = this.impN % this.impX.length;
      this.impX[k] = e.x + e.w / 2;
      this.impT[k] = this.time;
      this.impN += 1;
      const n = v.quality === 0 ? 4 : 10;
      for (let i = 0; i < n; i += 1) {
        this.motes.spawn("paper", sx + e.w / 2 + (Math.random() - 0.5) * e.w, v.groundY - 10, (Math.random() - 0.5) * 520, -260 - Math.random() * 320, 1.6, 4 + Math.random() * 4, 1);
      }
    }
  }

  private paint(g: Ctx2D, e: Ent, sx: number, sy: number, v: ViewState): boolean {
    const K = this.K;
    switch (e.kind) {
      case "pickup":
        if (e.pickup === "coin") drawCoin(g, K, e, sx, sy);
        else if (this.props && e.pickup) drawPickup(g, this.props, e.pickup, e.skin, sx + e.w / 2, sy + e.h / 2, e.w, v.time, e.id * 0.37);
        else return false;
        return true;
      case "zone":
        if (e.skin === "stamp") drawStamp(g, K, e, sx, v);
        else if (e.skin === "laser-low") drawLaserLow(g, K, e, sx, v);
        else if (e.skin === "laser-high") drawLaserHigh(g, K, e, sx, sy, v);
        else return false;
        return true;
      case "block":
        drawBlock(g, K, e, sx, sy);
        return true;
      case "overhead":
        if (e.skin === "laser-guard") return true;
        drawOverhead(g, K, e, sx, sy);
        return true;
      case "platform":
        if (e.skin === "cart-top") return true;
        if (e.skin === "box-plat") drawBoxPlatform(g, K, e, sx, sy, v);
        else drawCabin(g, K, e, sx, sy);
        return true;
      case "walker":
        if (e.skin === "office-chair") {
          drawChair(g, K, e, sx, sy, v);
          return true;
        }
        if (GUESTS.has(e.skin)) return drawGuest(g, K, e, sx, sy, v.groundY);
        return false;
      case "flyer":
        if (e.skin !== "bat") return false;
        drawBat(g, K, e, sx, sy);
        return true;
      case "projectile":
        if (e.skin !== "paper-plane") return false;
        drawPlane(g, K, e, sx, sy);
        return true;
      case "swinger":
        if (e.skin !== "lamp-swing") return false;
        drawLampSwing(g, K, e, sx, sy, v);
        return true;
      case "speedzone":
        drawBelt(g, K, e, sx, v);
        return true;
      case "pit":
        return true;
      default:
        return false;
    }
  }

  drawEntity(g: Ctx2D, e: Ent, sx: number, sy: number, v: ViewState): boolean {
    this.build();
    if (e.skin === "gateway") return false;
    this.sideEffects(e, sx, v);
    // noch ganz außerhalb des Bildes: höchstens ein Sprite-Bake je Frame (siehe BakeBudget)
    this.A.budget.off = sx >= OFFSCREEN_X;
    let ok: boolean;
    try {
      ok = this.paint(g, e, sx, sy, v);
    } finally {
      this.A.budget.off = false;
    }
    if (ok && e.skin !== "laser-guard" && (e.harmful || e.kind === "zone" || e.kind === "pickup" || e.kind === "walker" || e.kind === "flyer" || e.kind === "swinger" || e.kind === "projectile" || e.kind === "overhead" || e.kind === "block")) {
      if (e.state !== "defeated") this.record(e, sx, sy);
    }
    return ok;
  }

  // ------------------------------------------------------------------------------------------------

  drawForeground(g: Ctx2D, v: ViewState): void {
    this.build();
    const A0 = g.globalAlpha;
    const q = g.imageSmoothingQuality;
    g.imageSmoothingQuality = "low";
    this.motes.draw(g, v.time, A0);
    // Deckenträger ganz vorne
    blitTiled(g, this.fgTop, FG_W, this.fgTop.height, v.dist * FG_PAR, -4, v.w);
    g.globalAlpha = A0;
    g.imageSmoothingQuality = q;
  }

  drawOverlay(g: Ctx2D, v: ViewState): void {
    this.build();
    const s = v.stage + v.stageBlend;
    const dark = this.darkness(v);
    /** Tour: am Ausgangstor alles Welt-Eigene ausblenden */
    const keep = 1 - (v.vars["fa:exit"] ?? 0);
    const q = g.imageSmoothingQuality;
    g.imageSmoothingQuality = "low";
    if (dark > 0.03) {
      // Taschenlampe: Maske folgt der Figur teilweise nach oben
      const lift = Math.max(0, v.groundY - v.playerFeetY);
      const dy = Math.round(Math.max(-(MASK_H - 720), -lift * 0.42));
      g.globalAlpha = dark;
      g.drawImage(this.mask, 0, dy);
      g.globalAlpha = 1;
      // sichtbarer Lichtstrahl (Staub im Kegel)
      if (v.quality > 0 && dark > 0.12) {
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = Math.min(0.9, (dark - 0.1) * 0.9);
        this.beam.draw(g, 318 - BEAM_OX, Math.round(492 - lift - BEAM_OY));
        g.globalCompositeOperation = "source-over";
        g.globalAlpha = 1;
      }
      // Leuchtende Dinge brechen durch die Dunkelheit
      g.globalCompositeOperation = "lighter";
      for (let i = 0; i < this.fixN; i += 1) {
        const a = this.fixA[i];
        if (a < 0.05) continue;
        g.globalAlpha = Math.min(1, a * dark * 1.1);
        this.fixGlowC.draw(g, this.fixX[i] - 180, -2);
      }
      if (v.quality === 2 && dark > 0.3) {
        const st = v.stage;
        const mA = this.mid(st);
        const mB = v.stageBlend > 0.004 && st < MAX_STAGE && this.mids.has(st + 1) ? this.mid(st + 1) : null;
        g.globalCompositeOperation = "source-over";
        g.globalAlpha = 1;
        this.drawMidLights(g, v, mA, mB, s, v.stageBlend, dark * 0.7, false);
        g.globalCompositeOperation = "lighter";
      }
      // Notausgänge, Kamera-LEDs, Rundumleuchten
      const emerg = Math.max(stageVal(EMERGENCY, s), v.vars.blackout ?? 0);
      for (let i = 0; i < this.colN; i += 1) {
        const x = this.colX[i];
        const slot = this.colSlot[i];
        const cx = x + COLUMN_W / 2;
        if (h1(slot * 1.7) < 0.5) {
          g.globalAlpha = Math.min(1, 0.35 + dark) * keep;
          g.drawImage(this.exitSign.glow, cx - 80, 150 - 36);
        }
        if (h1(slot * 5.3 + 1) < stageVal(CAMERAS, s) && (v.reducedMotion || v.time % 1.2 < 0.6)) {
          g.globalAlpha = Math.min(1, 0.4 + dark) * keep;
          glowAt(g, this.A.glowRed, cx + 8, 108, 9);
        }
        if (emerg > 0.05) {
          const red = v.stage >= 4;
          const rot = v.reducedMotion ? 0.6 : 0.5 + 0.5 * Math.cos(v.time * 5 + slot * 1.3);
          g.globalAlpha = Math.min(1, emerg * (0.3 + 0.55 * rot)) * keep;
          blitC(g, this.A.glow.get(red ? "rgba(255,40,60,1)" : "rgba(255,190,110,1)", 140, 96), cx, 70);
          g.globalAlpha = Math.min(1, emerg) * keep;
          glowAt(g, red ? this.A.glowRed : this.A.glowAmber, cx, 68, 16);
        }
      }
      g.globalCompositeOperation = "source-over";
      // Gefahren/Münzen über der Dunkelheit nachzeichnen (Rim-Light-Garantie)
      const k = Math.min(0.9, dark * 1.05);
      if (k > 0.05) {
        for (let i = 0; i < this.recN; i += 1) {
          const e = this.rec[i];
          if (e.dead) continue;
          g.globalAlpha = k;
          this.A.budget.off = this.recX[i] >= OFFSCREEN_X;
          this.paint(g, e, this.recX[i], this.recY[i], v);
          this.A.budget.off = false;
        }
      }
      g.globalAlpha = 1;
    }
    // Stufe 5: pulsierendes Alarmlicht am Rand
    const alarm = v.vars.alarm ?? stageVal(EMERGENCY, s);
    if (alarm > 0.9 && v.stage >= 4) {
      const p = v.reducedMotion ? 0.4 : 0.5 + 0.5 * Math.sin(v.time * 3.2);
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = p * keep;
      g.drawImage(this.alarmWash, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    // kühle Farbstimmung oben
    g.globalAlpha = keep;
    g.drawImage(this.topShade, 0, 0);
    g.globalAlpha = 1;
    g.imageSmoothingQuality = q;
  }
}

function inPit(pits: ReadonlyArray<{ x0: number; x1: number }>, x: number, pad: number): boolean {
  for (const p of pits) if (x > p.x0 - pad && x < p.x1 + pad) return true;
  return false;
}
