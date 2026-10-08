/**
 * Prater – WorldRenderer. Stimmungsbogen: Goldene Stunde → Dämmerung → Lichterzauber → Feuerwerk → Mitternachtszauber.
 * Ebenen (hinten → vorne): Himmel/Sonne/Mond/Sterne/Wolken/Feuerwerk · Wien-Skyline (0.035) · Riesenrad & Praterturm (0.06)
 * · Hochschaubahn mit Zug (0.13) · gemalte Fahrgeschäfte (Ringelspiel, Zirkuszelt; 0.2) · Luftballons · Budenreihe (0.3)
 * · Kandelaber & Lichterketten (0.6) · Promenade (1.0)
 * · Vordergrund-Girlande (1.25) + Konfetti.
 * Performance: Ebenen sind pro Stufe vorgebacken (Nacht + Dunst) und werden ganzzahlig geblittet; große Glows sind
 * fertige 1:1-Flächen.
 */
import type { AssetLoader, Ent, ViewState, WorldRenderer } from "../../types";
import { yieldToMain } from "../../yield";
import { bigGlow, blitCentered, blitTiled, blitTiledRange, ctxOf, glowAt, glowSprite, paint, softSprite, solidSegments, type Ctx2D } from "../shared-b/canvas";
import { StagePalette, h1, mod, mulberry, stageVal } from "../shared-b/color";
import { flashFactor } from "../shared-b/flash";
import { StageCache, StagePrep, Staged, drawStaged, stageProgress, stagedLayer, type StageTint, type StagedLayer } from "../shared-b/layers";
import { WarmQueue } from "../shared-b/warm";
import {
  BULB_COLORS,
  boothTiles,
  coasterTiles,
  coasterTrackY,
  farSkyline,
  groundTile,
  landmarkTilesAsync,
  LANDMARK_PROP_IDS,
  lampTiles,
  topGarland,
  trenchTile,
  wheelSprites,
  type WheelSprites,
} from "./backdrop";
import {
  drawBooth,
  drawCandyCrate,
  drawCannonball,
  drawGhost,
  drawGhostGate,
  drawGondola,
  drawJeton,
  drawScooter,
  drawSwingChair,
  drawTires,
  drawTrampoline,
  drawValance,
  makeSkinAssets,
  OBSTACLE_PROPS,
  praterPropJobs,
  type PraterSkinAssets,
  type SkinCtx,
} from "./skins";

const TAU = Math.PI * 2;
const MAX_STAGE = 4;
/** Meter je Stimmungsstufe (wie WORLD_PRATER.stageMeters; Test in prater.test.ts hält beides gleich) */
export const PRATER_STAGE_METERS = 300;

export const PRATER_PROPS = ["ghost", "ghost-float", "autoscooter", ...Object.values(OBSTACLE_PROPS), ...LANDMARK_PROP_IDS];

const STAGES = [
  { top: "#3b3f92", mid: "#e0808a", low: "#ffc56a", haze: "#f3a07e", sun: "#ffd27a", glow: "#ff9a4a", ground: "#ffcf9a" },
  { top: "#1f1858", mid: "#86378a", low: "#ff7b5a", haze: "#a24f88", sun: "#ff8a4a", glow: "#ff5f7a", ground: "#ff9ab0" },
  { top: "#090c2b", mid: "#1f1552", low: "#522468", haze: "#34205e", sun: "#ffe0a0", glow: "#8a4cff", ground: "#c9a0ff" },
  { top: "#06081f", mid: "#1a0f46", low: "#62205c", haze: "#3a1a56", sun: "#ffe0a0", glow: "#ff4fa3", ground: "#ff9ad0" },
  { top: "#040318", mid: "#140a3a", low: "#2c1a62", haze: "#261859", sun: "#e8f0ff", glow: "#5ef2ff", ground: "#a8e8ff" },
];
const PAL = new StagePalette(STAGES);
const NIGHT = [0, 0.55, 1, 1, 1];
const LIGHTS = [0.1, 0.75, 1, 1, 1];
const STARS = [0, 0.12, 0.75, 0.85, 1];
const SUN_Y = [292, 468, 760, 760, 760];
const MOON = [0, 0, 1, 1, 1];
const FIREWORKS = [0, 0, 0.18, 1, 0.55];
const CONFETTI = [0.12, 0.16, 0.25, 1, 0.7];
const MAGIC = [0, 0, 0, 0.15, 1];

interface Burst {
  x: number;
  y: number;
  t: number;
  life: number;
  spr: HTMLCanvasElement;
  n: number;
  sp: number;
  seed: number;
  ring: boolean;
}
interface Rocket {
  x: number;
  y0: number;
  y1: number;
  t: number;
  dur: number;
  spr: HTMLCanvasElement;
}

const FW_COLORS = ["#ffd24a", "#ff4fa3", "#5ef2ff", "#9dff6a", "#b98cff", "#ff8a5c", "#fff6e0"];

/** Einfärbung pro Stufe: Nacht-Silhouette (Farbe/Stärke) + Dunst (Stufen-Dunstfarbe) */
function tintFor(nightColor: string, nightK: number, hazeTop: number, hazeBottom: number, shade = 0): (s: number) => StageTint {
  return (s) => ({
    night: { color: nightColor, a: NIGHT[s] * nightK },
    haze: { color: STAGES[s].haze, aTop: hazeTop * (1 - NIGHT[s] * 0.35), aBottom: hazeBottom * (1 - NIGHT[s] * 0.3) },
    shade: shade > 0 ? { color: "#12081c", a: shade + NIGHT[s] * 0.15, from: 0.55 } : undefined,
  });
}

export class PraterRenderer implements WorldRenderer {
  private ready = false;
  private A!: PraterSkinAssets;
  private sky!: StageCache;
  private far!: StagedLayer;
  private coaster!: StagedLayer;
  private rides: StagedLayer | null = null;
  private booths!: StagedLayer;
  private lamps!: StagedLayer;
  private garland!: StagedLayer;
  private groundL!: StagedLayer;
  private wheel!: WheelSprites;
  private wheelS!: Staged;
  private baseS!: Staged;
  /** alle Stufen-Caches (Liste gehört dem StagePrep) */
  private staged: StageCache[] = [];
  private prep = new StagePrep(this.staged, MAX_STAGE);
  private warmQ = new WarmQueue();
  private warmInit = false;
  private loaded = false;
  private lastStage = 0;
  private trench!: HTMLCanvasElement;
  private moon!: HTMLCanvasElement;
  private clouds: HTMLCanvasElement[] = [];
  private cloudsNight: HTMLCanvasElement[] = [];
  private aurora!: HTMLCanvasElement;
  private sunGlow!: HTMLCanvasElement;
  private moonGlow!: HTMLCanvasElement;
  private bloom!: HTMLCanvasElement;
  private underGlow!: HTMLCanvasElement;
  private softWarm!: HTMLCanvasElement;
  private softPink!: HTMLCanvasElement;
  private softCyan!: HTMLCanvasElement;
  private fwSprites: HTMLCanvasElement[] = [];
  private trenchGrd: CanvasGradient | null = null;
  private wheelCache!: { c: HTMLCanvasElement; g: Ctx2D; rot: number; st: number; bl: number; la: number };

  // Ambient-Zustand
  private bursts: Burst[] = [];
  private rockets: Rocket[] = [];
  private fwTimer = 1;
  private skyFlash = 0;
  private confetti: Float32Array = new Float32Array(0);
  private balloons: Array<{ x: number; y: number; r: number; c: string; ph: number }> = [];
  private shootT = 4;
  private shoot = { x: 0, y: 0, t: -1 };
  private rng = mulberry(1234);

  /** Pixelfaktor der Zeichenfläche (Hindernis-Sprites werden dafür vorgerendert) */
  private pixelK = 1;

  /**
   * Skalenwechsel (Governor, Vollbild, DPR). Idempotent: PropBank.setScale ignoriert Änderungen innerhalb von 0,2; nur
   * eine echte Änderung verwirft die Hindernis-Sprites (und stellt das Vorbacken wieder in die Warteschlange).
   */
  resize(dpr: number): void {
    this.pixelK = Math.min(2, Math.max(1, dpr));
    if (!this.ready) return;
    const before = this.A.bank.scale;
    this.A.bank.setScale(this.pixelK);
    if (this.A.bank.scale !== before && this.warmInit) this.queueProps();
  }

  async load(assets: AssetLoader): Promise<void> {
    // Statisches in Schritten bauen und dazwischen den Hauptthread freigeben (kein Long Task)
    await this.buildAsync();
    this.A.props = assets.props;
    this.A.bank.setProps(assets.props);
    await assets.props.preload(PRATER_PROPS);
    // Gemalte Fahrgeschäfte (Ringelspiel, Zirkuszelt) als eigene Tiefenebene zwischen Hochschaubahn und Buden
    const P = assets.props;
    await yieldToMain();
    const lm = await landmarkTilesAsync((id) => P.has(id), (g, id, x, y, o) => P.draw(g, id, x, y, o), 2600, 280, yieldToMain);
    if (lm) {
      this.rides = stagedLayer(lm.day, 266, 0.2, tintFor("#1b1238", 0.8, 0.26, 0.42), { lights: lm.lights, lights2: lm.lights2, recycle: true });
      this.staged.push(this.rides.staged);
    }
    // erste beiden Stufen vorbacken (Tinten-Schritte einzeln, mit Pausen)
    for (const stage of [0, 1]) {
      for (const c of this.staged) {
        while (!c.has(stage)) {
          await yieldToMain();
          c.step(stage);
        }
      }
    }
    this.loaded = true;
  }

  // --- Aufwärmen -----------------------------------------------------------------------------------

  /**
   * Leerlauf-Aufwärmen (Countdown, Menü-Demo, Lauf-Anfang): backt in Zeitscheiben von ca. `budgetMs` fehlende Stufen-
   * Varianten und alle bekannten Hindernis-Sprites vor, damit sie nicht mitten im Lauf entstehen. true = nichts mehr zu tun.
   */
  warm(budgetMs: number): boolean {
    if (!this.loaded) return true; // noch nicht geladen
    if (!this.warmInit) this.initWarm();
    return this.warmQ.run(budgetMs);
  }

  private initWarm(): void {
    this.warmInit = true;
    this.warmQ.add(() => this.prep.warm(this.lastStage, 0), 6);
    this.queueProps();
  }

  /** Hindernis-Sprites (bekannte Maße) vorbacken – nach Skalenwechsel erneut */
  private queueProps(): void {
    const jobs = praterPropJobs(this.A);
    let i = 0;
    this.warmQ.add(() => {
      if (i < jobs.length) jobs[i++]();
      return i >= jobs.length;
    }, 3);
  }

  /** Bauschritte des statischen Zeichnens (jeder für sich klein; `load` gibt dazwischen den Hauptthread frei) */
  private readonly parts: Array<() => void> = [
    () => this.buildSky(),
    () => this.buildLayers1(),
    () => this.buildLayers2(),
    () => this.buildLayers3(),
    () => this.buildLayers4(),
    () => this.buildWheel(),
    () => this.buildSprites(),
    () => this.buildGlows(),
  ];
  private nextPart = 0;

  /** Alles (verbleibende) auf einmal bauen – Fallback für Aufrufe vor/ohne `load` */
  private build(): void {
    while (this.nextPart < this.parts.length) {
      const i = this.nextPart;
      this.nextPart += 1;
      this.parts[i]();
    }
  }

  private async buildAsync(): Promise<void> {
    while (this.nextPart < this.parts.length) {
      const i = this.nextPart;
      this.nextPart += 1;
      this.parts[i]();
      await yieldToMain();
    }
  }

  private buildSky(): void {
    this.A = makeSkinAssets();
    this.A.bank.setScale(this.pixelK);
    const stars = paint(1280, 460, (g) => {
      const r = mulberry(5);
      for (let i = 0; i < 300; i += 1) {
        const s = r() < 0.9 ? 0.7 + r() * 0.9 : 1.6 + r();
        g.fillStyle = r() < 0.8 ? "rgba(255,255,255,0.9)" : "rgba(255,210,240,0.9)";
        g.beginPath();
        g.arc(r() * 1280, r() * 460, s, 0, TAU);
        g.fill();
      }
    });
    this.sky = new StageCache(
      (s, reuse) =>
        paint(
          1280,
          600,
          (g) => {
            const P = STAGES[s];
            const grd = g.createLinearGradient(0, 0, 0, 600);
            grd.addColorStop(0, P.top);
            grd.addColorStop(0.55, P.mid);
            grd.addColorStop(1, P.low);
            g.fillStyle = grd;
            g.fillRect(0, 0, 1280, 600);
            if (STARS[s] > 0.01) {
              g.globalAlpha = STARS[s];
              g.drawImage(stars, 0, 0);
              g.globalAlpha = 1;
            }
          },
          reuse,
        ),
      { recycle: true },
    );
  }

  private buildLayers1(): void {
    const far = farSkyline(2048, 280);
    this.far = stagedLayer(far.day, 310, 0.035, tintFor("#1b1740", 0.86, 0.34, 0.62), { lights: far.lights, recycle: true });
    const co = coasterTiles(2048, 340);
    this.coaster = stagedLayer(co.day, 250, 0.13, tintFor("#1d1336", 0.84, 0.16, 0.34), { lights: co.lights, lights2: co.lights2, recycle: true });
  }

  private buildLayers2(): void {
    const bo = boothTiles(2048, 240);
    this.booths = stagedLayer(bo.day, 358, 0.3, tintFor("#1b1030", 0.74, 0.2, 0.3, 0.38), { lights: bo.lights, lights2: bo.lights2, recycle: true });
  }

  private buildLayers3(): void {
    const la = lampTiles(1536, 540, 512, 290);
    this.lamps = stagedLayer(la.day, 50, 0.6, (s) => ({ night: { color: "#0d0a18", a: NIGHT[s] * 0.6 } }), { lights: la.lights, lights2: la.lights2, recycle: true });
  }

  private buildLayers4(): void {
    const ga = topGarland(1400, 96);
    this.garland = stagedLayer(ga.day, -6, 1.25, (s) => ({ night: { color: "#0b0812", a: NIGHT[s] * 0.45 } }), { lights: ga.lights, lights2: ga.lights2, recycle: true });
    this.groundL = stagedLayer(
      groundTile(1024, 130),
      590,
      1,
      (s) => ({
        night: { color: "#1a1030", a: NIGHT[s] * 0.5 },
        haze: { color: STAGES[s].ground, aTop: 0.1 * (1 - NIGHT[s] * 0.5), aBottom: 0 },
      }),
      { recycle: true },
    );
  }

  private buildWheel(): void {
    this.wheel = wheelSprites(200);
    const wcan = paint(this.wheel.size, this.wheel.size, () => undefined);
    this.wheelCache = { c: wcan, g: ctxOf(wcan), rot: -99, st: -1, bl: 0, la: 0 };
    this.wheelS = new Staged(this.wheel.wheel, (s) => ({ night: { color: "#1a1233", a: NIGHT[s] * 0.88 }, haze: { color: STAGES[s].haze, aTop: 0.3, aBottom: 0.3 } }), true);
    this.baseS = new Staged(this.wheel.base, (s) => ({ night: { color: "#170f2c", a: NIGHT[s] * 0.85 }, haze: { color: STAGES[s].haze, aTop: 0.28, aBottom: 0.45 } }), true);
    // alle Stufen-Caches beim StagePrep anmelden (die Stufen 0/1 backt `load` in kleinen Schritten, sonst `update`)
    for (const c of [this.sky, this.far.staged, this.wheelS, this.baseS, this.coaster.staged, this.booths.staged, this.lamps.staged, this.groundL.staged, this.garland.staged]) this.prep.add(c);
  }

  private buildSprites(): void {
    this.trench = trenchTile(480, 130);
    this.moon = paint(120, 120, (g) => {
      const grd = g.createRadialGradient(50, 48, 4, 60, 60, 36);
      grd.addColorStop(0, "#ffffff");
      grd.addColorStop(1, "#dfe4ff");
      g.fillStyle = grd;
      g.beginPath();
      g.arc(60, 60, 34, 0, TAU);
      g.fill();
      g.fillStyle = "rgba(150,160,210,0.35)";
      for (const [x, y, r] of [
        [48, 50, 7],
        [70, 66, 9],
        [62, 44, 4],
        [52, 74, 5],
      ]) {
        g.beginPath();
        g.arc(x, y, r, 0, TAU);
        g.fill();
      }
    });
    for (let i = 0; i < 3; i += 1) {
      this.clouds.push(cloudSprite(i, false));
      this.cloudsNight.push(cloudSprite(i, true));
    }
    this.aurora = paint(1280, 220, (g) => {
      const strip = paint(1, 160, (sg) => {
        const grd = sg.createLinearGradient(0, 0, 0, 160);
        grd.addColorStop(0, "rgba(94,242,255,0)");
        grd.addColorStop(0.25, "rgba(94,242,255,0.55)");
        grd.addColorStop(0.6, "rgba(185,140,255,0.35)");
        grd.addColorStop(1, "rgba(255,79,163,0)");
        sg.fillStyle = grd;
        sg.fillRect(0, 0, 1, 160);
      });
      for (let x = 0; x < 1280; x += 2) {
        const u = (x / 1280) * TAU;
        const top = 30 + 26 * Math.sin(u * 2 + 0.5) + 14 * Math.sin(u * 5 + 1.1);
        const h = 110 + 40 * Math.sin(u * 3 + 2);
        g.globalAlpha = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(u * 7));
        g.drawImage(strip, x, top, 2, h);
      }
    });
  }

  private buildGlows(): void {
    this.sunGlow = bigGlow(600, 600, [
      [0, "rgba(255,236,190,0.95)"],
      [0.12, "rgba(255,200,120,0.6)"],
      [0.4, "rgba(255,150,90,0.18)"],
      [1, "rgba(255,120,80,0)"],
    ]);
    this.moonGlow = bigGlow(300, 300, [
      [0, "rgba(200,230,255,0.5)"],
      [0.3, "rgba(150,200,255,0.18)"],
      [1, "rgba(120,160,255,0)"],
    ]);
    this.bloom = bigGlow(960, 640, [
      [0, "rgba(255,190,120,0.9)"],
      [0.5, "rgba(255,150,100,0.3)"],
      [1, "rgba(255,120,90,0)"],
    ]);
    this.underGlow = bigGlow(1400, 240, [
      [0, "rgba(255,79,163,0.8)"],
      [0.5, "rgba(160,60,255,0.25)"],
      [1, "rgba(120,40,255,0)"],
    ]);
    this.softWarm = softSprite("rgba(255,196,120,1)");
    this.softPink = softSprite("rgba(255,79,163,1)");
    this.softCyan = softSprite("rgba(94,242,255,1)");
    this.fwSprites = FW_COLORS.map((c) => glowSprite(c, 0.25));
    // Konfetti: x, y, vx, vy, rot, vrot, colorIdx, size
    const n = 70;
    this.confetti = new Float32Array(n * 8);
    for (let i = 0; i < n; i += 1) this.resetConfetti(i, true);
    for (let i = 0; i < 5; i += 1) {
      this.balloons.push({ x: this.rng() * 1280, y: 200 + this.rng() * 400, r: 8 + this.rng() * 6, c: BULB_COLORS[i % BULB_COLORS.length], ph: this.rng() * TAU });
    }
    this.ready = true;
  }

  private resetConfetti(i: number, anywhere: boolean): void {
    const o = i * 8;
    const c = this.confetti;
    c[o] = this.rng() * 1400;
    c[o + 1] = anywhere ? this.rng() * 720 : -20 - this.rng() * 80;
    c[o + 2] = -30 - this.rng() * 60;
    c[o + 3] = 50 + this.rng() * 70;
    c[o + 4] = this.rng() * TAU;
    c[o + 5] = (this.rng() - 0.5) * 12;
    c[o + 6] = Math.floor(this.rng() * BULB_COLORS.length);
    c[o + 7] = 4 + this.rng() * 5;
  }

  update(dt: number, v: ViewState): void {
    if (!this.ready) return;
    // Stufen-Varianten: die Folgestufe erst ab ~28 % der Stufe und höchstens ein Schritt je ~6 Frames (nicht am Stufenanfang)
    const stage = Math.min(MAX_STAGE, v.stage);
    this.lastStage = stage;
    this.prep.setLow(v.quality === 0); // Qualität 0: Folgestufe später (ab ~60 %) und nicht im Leerlauf vorbacken (Speicher)
    this.prep.step(stage, stageProgress(v.worldMeters, PRATER_STAGE_METERS), v.stageBlend);
    const s = Math.min(MAX_STAGE, v.stage + v.stageBlend);
    // Feuerwerk
    const fw = stageVal(FIREWORKS, s) * (v.quality === 0 ? 0.4 : 1);
    this.skyFlash = Math.max(0, this.skyFlash - dt * 3);
    if (fw > 0.02) {
      this.fwTimer -= dt * fw;
      if (this.fwTimer <= 0 && this.rockets.length + this.bursts.length < (v.quality === 2 ? 5 : 3)) {
        this.fwTimer = 0.6 + this.rng() * 0.9;
        const spr = this.fwSprites[Math.floor(this.rng() * this.fwSprites.length)];
        this.rockets.push({ x: 160 + this.rng() * 1040, y0: 520, y1: 70 + this.rng() * 200, t: 0, dur: 0.7 + this.rng() * 0.4, spr });
      }
    }
    for (let i = this.rockets.length - 1; i >= 0; i -= 1) {
      const r = this.rockets[i];
      r.t += dt;
      if (r.t >= r.dur) {
        this.rockets.splice(i, 1);
        this.bursts.push({ x: r.x, y: r.y1, t: 0, life: 1.6 + this.rng() * 0.6, spr: r.spr, n: v.quality === 2 ? 32 : 20, sp: 190 + this.rng() * 110, seed: this.rng() * 100, ring: this.rng() < 0.3 });
        // „Blitze“-Regler (flashScale) ersetzt das Dämpfen bei „Weniger Bewegung“ (keine Doppel-Skalierung), dort aber nie
        // über 0,3 – auch wenn der Aufrufer den Regler nicht kappt; ohne Regler bleibt es bei „kein Blitz“ (flashFactor)
        const fs = flashFactor(v, 0);
        if (fs > 0) this.skyFlash = Math.min(1, this.skyFlash + 0.55 * fs);
      }
    }
    for (let i = this.bursts.length - 1; i >= 0; i -= 1) {
      const b = this.bursts[i];
      b.t += dt;
      if (b.t >= b.life) this.bursts.splice(i, 1);
    }
    // Konfetti
    const c = this.confetti;
    const n = c.length / 8;
    const drift = v.speed * 0.9;
    for (let i = 0; i < n; i += 1) {
      const o = i * 8;
      c[o] += (c[o + 2] - drift) * dt;
      c[o + 1] += c[o + 3] * dt;
      c[o + 4] += c[o + 5] * dt;
      c[o + 2] += Math.sin(v.time * 2 + i) * 20 * dt;
      if (c[o + 1] > 740 || c[o] < -40) {
        this.resetConfetti(i, false);
        c[o] = 200 + this.rng() * 1300;
      }
    }
    // Luftballons (steigen langsam, Parallaxe 0.22)
    for (const b of this.balloons) {
      b.y -= (18 + b.r) * dt;
      b.x -= v.speed * 0.22 * dt;
      if (b.y < -60 || b.x < -40) {
        b.y = 560 + this.rng() * 60;
        b.x = 100 + this.rng() * 1300;
        b.c = BULB_COLORS[Math.floor(this.rng() * BULB_COLORS.length)];
      }
    }
    // Sternschnuppen (Mitternachtszauber)
    const magic = stageVal(MAGIC, s);
    if (magic > 0.3 && !v.reducedMotion) {
      this.shootT -= dt;
      if (this.shootT <= 0) {
        this.shootT = 3 + this.rng() * 4;
        this.shoot = { x: 500 + this.rng() * 700, y: 40 + this.rng() * 120, t: 0 };
      }
      if (this.shoot.t >= 0) {
        this.shoot.t += dt;
        if (this.shoot.t > 1) this.shoot.t = -1;
      }
    }
  }

  drawBackground(g: Ctx2D, v: ViewState): void {
    this.build();
    const st = Math.min(MAX_STAGE, v.stage);
    const bl = v.stageBlend;
    const s = Math.min(MAX_STAGE, st + bl);
    const P = PAL.css(s);
    const night = stageVal(NIGHT, s);
    const lights = stageVal(LIGHTS, s);
    // Lauflicht nur, wenn die Lichter wirklich leuchten; sonst eine Lichtkachel (spart Füllrate)
    const chase = v.reducedMotion || v.quality === 0 || lights < 0.5 ? 0 : Math.sin(v.time * 5.5);
    const la = lights < 0.5 ? lights * 1.1 : lights * (0.62 + 0.38 * chase);
    const lb = lights < 0.5 ? 0 : lights * (0.62 - 0.38 * chase);
    const q = g.imageSmoothingQuality;
    g.imageSmoothingQuality = "low";

    // Himmel (vorgebacken: Verlauf + Sterne)
    g.drawImage(this.sky.get(st), 0, 0);
    if (bl > 0.004 && st < MAX_STAGE) {
      g.globalAlpha = bl;
      g.drawImage(this.sky.get(st + 1), 0, 0);
      g.globalAlpha = 1;
    }
    g.fillStyle = P.low;
    g.fillRect(0, 600, v.w, v.h - 600);

    // funkelnde Sterne
    const starA = stageVal(STARS, s);
    if (starA > 0.05 && v.quality > 0) {
      g.globalCompositeOperation = "lighter";
      for (let i = 0; i < 12; i += 1) {
        const x = h1(i) * 1280;
        const y = 20 + h1(i + 30) * 300;
        const tw = v.reducedMotion ? 0.6 : 0.5 + 0.5 * Math.sin(v.time * (1.5 + h1(i + 7) * 2) + i);
        g.globalAlpha = starA * tw * 0.8;
        glowAt(g, this.A.glowWhite, x, y, 6 + h1(i + 3) * 5);
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }

    // Aurora / Magie
    const magic = stageVal(MAGIC, s);
    if (magic > 0.01) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = magic * (0.85 + (v.reducedMotion ? 0 : 0.15 * Math.sin(v.time * 0.7)));
      blitTiled(g, this.aurora, 1280, 220, v.dist * 0.01 + v.time * 6, 20);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }

    // Sonne
    const sunY = stageVal(SUN_Y, s);
    const sunX = 920;
    if (sunY < 720) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.8 * (1 - night * 0.6);
      blitCentered(g, this.sunGlow, sunX, sunY);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
      g.fillStyle = "#fff4d6";
      g.beginPath();
      g.arc(sunX, sunY, 40, 0, TAU);
      g.fill();
    }
    // Mond
    const moonA = stageVal(MOON, s);
    if (moonA > 0.01) {
      const mx = 1080;
      const my = 150;
      g.globalAlpha = moonA;
      g.globalCompositeOperation = "lighter";
      blitCentered(g, this.moonGlow, mx, my);
      g.globalCompositeOperation = "source-over";
      g.drawImage(this.moon, mx - 60, my - 60);
      g.globalAlpha = 1;
    }
    // Sternschnuppe
    if (this.shoot.t >= 0 && magic > 0.3) {
      const t = this.shoot.t;
      const x = this.shoot.x - t * 420;
      const y = this.shoot.y + t * 160;
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = Math.sin(t * Math.PI) * magic;
      g.strokeStyle = "rgba(220,240,255,0.9)";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + 90, y - 34);
      g.stroke();
      glowAt(g, this.A.glowWhite, x, y, 10);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }

    // Wolken
    this.drawClouds(g, v, night);

    // Feuerwerk (hinter der Skyline)
    this.drawFireworks(g, v);
    if (this.skyFlash > 0.01) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = this.skyFlash * 0.1;
      g.fillStyle = P.glow;
      g.fillRect(0, 0, v.w, 590);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }

    // Ferne Skyline
    drawStaged(g, this.far, v.dist, st, bl, MAX_STAGE, lights > 0.2 ? lights * 0.9 : 0);

    // Riesenrad + Praterturm
    this.drawGiants(g, v, night, lights);

    // Hochschaubahn
    drawStaged(g, this.coaster, v.dist, st, bl, MAX_STAGE, la, lb);
    this.drawTrain(g, v, night, lights);

    // Fahrgeschäfte (gemalte Landmarks)
    if (this.rides) drawStaged(g, this.rides, v.dist, st, bl, MAX_STAGE, la * 0.9, lb * 0.9);

    // Luftballons
    if (v.quality > 0) this.drawBalloons(g, night);

    // Budenreihe
    drawStaged(g, this.booths, v.dist, st, bl, MAX_STAGE, la * 0.9, lb * 0.9);

    // Kandelaber + Lichterketten
    drawStaged(g, this.lamps, v.dist, st, bl, MAX_STAGE, lb, la);
    g.imageSmoothingQuality = q;
  }

  private drawClouds(g: Ctx2D, v: ViewState, night: number): void {
    const defs = [
      [0, 120, 150, 0.018],
      [1, 520, 90, 0.012],
      [2, 900, 190, 0.022],
      [0, 1300, 60, 0.009],
      [1, 1700, 220, 0.026],
    ] as const;
    for (const [idx, x0, y, f] of defs) {
      const x = Math.round(mod(x0 - v.dist * f - v.time * 4, 2000) - 360);
      if (x > 1300) continue;
      if (night < 0.98) {
        g.globalAlpha = 0.9 * (1 - night);
        g.drawImage(this.clouds[idx], x, y);
      }
      if (night > 0.02) {
        g.globalAlpha = 0.55 * night;
        g.drawImage(this.cloudsNight[idx], x, y);
      }
    }
    g.globalAlpha = 1;
  }

  private drawFireworks(g: Ctx2D, v: ViewState): void {
    if (!this.rockets.length && !this.bursts.length) return;
    g.globalCompositeOperation = "lighter";
    for (const r of this.rockets) {
      const u = r.t / r.dur;
      const y = r.y0 + (r.y1 - r.y0) * (1 - (1 - u) * (1 - u));
      g.globalAlpha = 0.9;
      glowAt(g, r.spr, r.x, y, 7);
      g.globalAlpha = 0.35;
      glowAt(g, r.spr, r.x, y + 14, 4, 10);
    }
    const trails = v.quality === 2;
    for (const b of this.bursts) {
      const k = b.t / b.life;
      const fade = (1 - k) * (1 - k);
      const drag = (1 - Math.exp(-2.4 * b.t)) / 2.4;
      const grav = 46 * b.t * b.t;
      const tb = Math.max(0, b.t - 0.09);
      const d2 = (1 - Math.exp(-2.4 * tb)) / 2.4;
      for (let i = 0; i < b.n; i += 1) {
        const a = (i / b.n) * TAU + b.seed;
        const sp = b.sp * (b.ring ? 1 : 0.55 + 0.45 * h1(i + b.seed));
        const ca = Math.cos(a) * sp;
        const sa = Math.sin(a) * sp;
        const tw = 0.7 + 0.3 * Math.sin(b.t * 30 + i);
        g.globalAlpha = fade * tw;
        glowAt(g, b.spr, b.x + ca * drag, b.y + sa * drag + grav, 8 + 5 * (1 - k));
        if (trails) {
          g.globalAlpha = fade * 0.35;
          glowAt(g, b.spr, b.x + ca * d2, b.y + sa * d2 + 46 * tb * tb, 5);
        }
      }
      if (b.t < 0.35) {
        g.globalAlpha = (1 - b.t / 0.35) * 0.9;
        glowAt(g, b.spr, b.x, b.y, 110);
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  private drawGiants(g: Ctx2D, v: ViewState, night: number, lights: number): void {
    const W = this.wheel;
    const period = 2600;
    const scroll = v.dist * 0.06;
    const cy = 318;
    const rot = v.time * 0.055;
    const k0 = Math.floor((scroll - 1400) / period);
    for (let k = k0; k <= k0 + 2; k += 1) {
      const cx = Math.round(k * period + 900 - scroll);
      if (cx > -W.R - 200 && cx < 1280 + W.R + 200) this.drawWheel(g, cx, cy, rot, night, lights, v);
      const tx = Math.round(k * period + 2050 - scroll);
      if (tx > -150 && tx < 1430) this.drawTower(g, tx, v, night, lights);
    }
  }

  private drawWheel(g: Ctx2D, cx: number, cy: number, rot: number, night: number, lights: number, v: ViewState): void {
    const W = this.wheel;
    const st = Math.min(MAX_STAGE, v.stage);
    const bl = v.stageBlend;
    // Sockel
    const bx = cx - Math.round(W.baseW / 2);
    const by = cy - 14;
    g.drawImage(this.baseS.get(st), bx, by);
    if (bl > 0.004 && st < MAX_STAGE) {
      g.globalAlpha = bl;
      g.drawImage(this.baseS.get(st + 1), bx, by);
      g.globalAlpha = 1;
    }
    if (lights > 0.05) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = lights;
      g.drawImage(W.baseLights, bx, by);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    // Rad (rotierte Zusammensetzung gecacht; Neuaufbau nur bei spürbarer Drehung/Stimmungsänderung)
    const h = W.size / 2;
    const la = lights > 0.05 ? lights * (v.reducedMotion ? 0.9 : 0.85 + 0.15 * Math.sin(v.time * 2)) : 0;
    const wc = this.wheelCache;
    if (Math.abs(rot - wc.rot) > 0.0045 || wc.st !== st || Math.abs(bl - wc.bl) > 0.03 || Math.abs(la - wc.la) > 0.06) {
      wc.rot = rot;
      wc.st = st;
      wc.bl = bl;
      wc.la = la;
      const cg = wc.g;
      cg.setTransform(1, 0, 0, 1, 0, 0);
      cg.clearRect(0, 0, W.size, W.size);
      cg.imageSmoothingQuality = "low";
      cg.translate(h, h);
      cg.rotate(rot);
      cg.drawImage(this.wheelS.get(st), -h, -h);
      if (bl > 0.004 && st < MAX_STAGE) {
        cg.globalAlpha = bl;
        cg.drawImage(this.wheelS.get(st + 1), -h, -h);
        cg.globalAlpha = 1;
      }
      if (la > 0.01) {
        cg.globalCompositeOperation = "lighter";
        cg.globalAlpha = la;
        cg.drawImage(W.wheelLights, -h, -h);
        cg.globalAlpha = 1;
        cg.globalCompositeOperation = "source-over";
      }
    }
    g.drawImage(wc.c, cx - h, cy - h);
    // Streiflicht der tiefen Sonne
    if (night < 0.9) {
      g.globalCompositeOperation = "lighter";
      g.strokeStyle = `rgba(255,190,110,${(0.35 * (1 - night)).toFixed(3)})`;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(cx, cy, W.R + 1, -1.2, 0.6);
      g.stroke();
      g.globalCompositeOperation = "source-over";
    }
    // Gondeln (hängen immer senkrecht)
    const n = 15;
    const body = night > 0.5 ? "#5a1a30" : "#c42c3a";
    const roof = night > 0.5 ? "#2a0a16" : "#7e1424";
    const win = lights > 0.3 ? `rgba(255,214,140,${lights.toFixed(3)})` : "rgba(190,225,240,0.8)";
    for (let i = 0; i < n; i += 1) {
      const a = rot + (i / n) * TAU;
      const gx = cx + Math.cos(a) * (W.R + 2);
      const gy = cy + Math.sin(a) * (W.R + 2);
      g.fillStyle = body;
      g.fillRect(gx - 1, gy, 2, 5);
      g.fillRect(gx - 10, gy + 4, 20, 14);
      g.fillStyle = roof;
      g.fillRect(gx - 11, gy + 3, 22, 3);
      g.fillStyle = win;
      g.fillRect(gx - 7, gy + 8, 5, 5);
      g.fillRect(gx + 2, gy + 8, 5, 5);
    }
  }

  private drawTower(g: Ctx2D, x: number, v: ViewState, night: number, lights: number): void {
    const base = 580;
    const top = 70;
    const col = night > 0.5 ? "#231a3c" : "#7a6480";
    g.fillStyle = col;
    g.fillRect(x - 5, top, 10, base - top);
    g.strokeStyle = col;
    g.lineWidth = 1.2;
    g.beginPath();
    for (let y = top; y < base; y += 22) {
      g.moveTo(x - 5, y);
      g.lineTo(x + 5, y + 22);
    }
    g.stroke();
    g.fillRect(x - 10, top - 20, 20, 22);
    g.fillRect(x - 1, top - 44, 2, 26);
    // Fahrgeschäft (Kranz fährt auf und ab, Sitze fliegen aus)
    const ride = v.reducedMotion ? 0.6 : 0.5 + 0.5 * Math.sin(v.time * 0.23);
    const cy = 170 + ride * 150;
    const spin = v.time * 1.6;
    const R = 66;
    g.fillStyle = night > 0.5 ? "#3a1840" : "#c2365e";
    g.beginPath();
    g.ellipse(x, cy, 30, 8, 0, 0, TAU);
    g.fill();
    g.strokeStyle = night > 0.5 ? "#6a5a80" : "#e6d8ea";
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < 12; i += 1) {
      const a = spin + (i / 12) * TAU;
      g.moveTo(x + Math.cos(a) * 28, cy + Math.sin(a) * 7);
      g.lineTo(x + Math.cos(a) * R, cy + 46 + Math.sin(a) * 7);
    }
    g.stroke();
    for (let i = 0; i < 12; i += 1) {
      const a = spin + (i / 12) * TAU;
      g.fillStyle = BULB_COLORS[i % BULB_COLORS.length];
      g.fillRect(x + Math.cos(a) * R - 3, cy + 46 + Math.sin(a) * 7, 6, 5);
    }
    if (lights > 0.1) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = lights;
      for (let i = 0; i < 10; i += 1) {
        const a = (i / 10) * TAU + spin * 0.2;
        glowAt(g, i % 2 ? this.A.glowGold : this.A.glowPink, x + Math.cos(a) * 30, cy + Math.sin(a) * 8, 7);
      }
      glowAt(g, this.A.glowPink, x, top - 40, 8);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
  }

  private drawTrain(g: Ctx2D, v: ViewState, night: number, lights: number): void {
    const L = this.coaster;
    const W = L.w;
    const scroll = v.dist * L.factor;
    const off = Math.round(mod(scroll, W));
    const head = mod(v.time * 260, W);
    for (let c = 0; c < 5; c += 1) {
      const u = mod(head - c * 27, W);
      let sx = u - off;
      if (sx < -60) sx += W;
      if (sx > 1340) sx -= W;
      if (sx < -60 || sx > 1340) continue;
      const y = L.y + coasterTrackY(u, W, L.h);
      const y2 = L.y + coasterTrackY(u + 6, W, L.h);
      const ang = Math.atan2(y2 - y, 6);
      g.save();
      g.translate(sx, y - 2);
      g.rotate(ang);
      g.fillStyle = night > 0.5 ? "#5a2040" : c === 0 ? "#ffd24a" : "#e2366f";
      g.beginPath();
      g.moveTo(-12, -12);
      g.lineTo(12, -12);
      g.lineTo(10, 0);
      g.lineTo(-10, 0);
      g.closePath();
      g.fill();
      g.fillStyle = night > 0.5 ? "#140a1c" : "#3a2a3a";
      g.beginPath();
      g.arc(-4, -15, 3.2, 0, TAU);
      g.arc(5, -15, 3.2, 0, TAU);
      g.fill();
      g.fillRect(-7, -24, 1.5, 8);
      g.fillRect(8, -24, 1.5, 8);
      g.restore();
      if (c === 0 && lights > 0.2) {
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = lights;
        glowAt(g, this.A.glowGold, sx + 12, y - 8, 12);
        g.globalAlpha = 1;
        g.globalCompositeOperation = "source-over";
      }
    }
  }

  private drawBalloons(g: Ctx2D, night: number): void {
    for (const b of this.balloons) {
      g.strokeStyle = "rgba(240,230,255,0.45)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(b.x, b.y + b.r);
      g.quadraticCurveTo(b.x - 4, b.y + b.r + 14, b.x + 2, b.y + b.r + 26);
      g.stroke();
      g.fillStyle = b.c;
      g.globalAlpha = 0.9 - night * 0.35;
      g.beginPath();
      g.ellipse(b.x, b.y, b.r * 0.85, b.r, 0, 0, TAU);
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = "rgba(255,255,255,0.55)";
      g.beginPath();
      g.ellipse(b.x - b.r * 0.3, b.y - b.r * 0.35, b.r * 0.18, b.r * 0.3, -0.5, 0, TAU);
      g.fill();
    }
  }

  drawGround(g: Ctx2D, v: ViewState, pits: ReadonlyArray<{ x0: number; x1: number; skin: string }>): void {
    this.build();
    const st = Math.min(MAX_STAGE, v.stage);
    const bl = v.stageBlend;
    const s = Math.min(MAX_STAGE, st + bl);
    const lights = stageVal(LIGHTS, s);
    const gy = v.groundY;
    const H = v.h - gy;
    const q = g.imageSmoothingQuality;
    g.imageSmoothingQuality = "low";
    // Lücken: Achterbahn-Graben
    for (const p of pits) {
      const x0 = Math.round(Math.max(-20, p.x0));
      const x1 = Math.round(Math.min(v.w + 20, p.x1));
      if (x1 <= x0) continue;
      if (!this.trenchGrd) {
        const grd = g.createLinearGradient(0, gy, 0, v.h);
        grd.addColorStop(0, "#2a1740");
        grd.addColorStop(0.4, "#140a24");
        grd.addColorStop(1, "#05030a");
        this.trenchGrd = grd;
      }
      g.fillStyle = this.trenchGrd;
      g.fillRect(x0, gy, x1 - x0, H);
      blitTiledRange(g, this.trench, 480, 130, v.dist, x0, x1, gy + 8);
      g.globalCompositeOperation = "lighter";
      const step = 160;
      const wx0 = Math.ceil((x0 + v.dist) / step) * step;
      for (let wx = wx0; wx < x1 + v.dist; wx += step) {
        g.globalAlpha = 0.35 + 0.4 * lights;
        glowAt(g, h1(wx) < 0.5 ? this.softPink : this.softCyan, wx - v.dist, gy + 96, 40, 26);
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
      g.fillStyle = "rgba(0,0,0,0.55)";
      g.fillRect(x0, gy, 14, H);
      g.fillStyle = "rgba(0,0,0,0.3)";
      g.fillRect(x0 + 14, gy, 12, H);
      g.fillRect(x1 - 18, gy, 18, H);
    }
    // Promenade (Segmente zwischen den Lücken)
    const segs = solidSegments(pits, v.w);
    const gA = this.groundL.staged.get(st);
    const gB = bl > 0.004 && st < MAX_STAGE ? this.groundL.staged.get(st + 1) : null;
    for (const sg of segs) {
      const a = Math.max(0, sg.x0);
      const b = Math.min(v.w, sg.x1);
      if (b <= a) continue;
      blitTiledRange(g, gA, 1024, 130, v.dist, a, b, gy);
      if (gB) {
        g.globalAlpha = bl;
        blitTiledRange(g, gB, 1024, 130, v.dist, a, b, gy);
        g.globalAlpha = 1;
      }
      if (sg.x0 > -30) {
        g.fillStyle = "#3a2436";
        g.fillRect(Math.round(sg.x0), gy, 5, H);
        g.fillStyle = "#e6d0b8";
        g.fillRect(Math.round(sg.x0), gy, 5, 6);
      }
      if (sg.x1 < v.w + 30) {
        g.fillStyle = "#2a1828";
        g.fillRect(Math.round(sg.x1) - 5, gy, 5, H);
        g.fillStyle = "#e6d0b8";
        g.fillRect(Math.round(sg.x1) - 5, gy, 5, 6);
      }
    }
    // Lichtpfützen
    if (lights > 0.08) {
      g.globalCompositeOperation = "lighter";
      const step = 420;
      const wx0 = Math.floor((v.dist - 200) / step) * step;
      for (let wx = wx0; wx < v.dist + v.w + 200; wx += step) {
        const sx = wx + 130 - v.dist;
        let inPit = false;
        for (const p of pits) if (sx > p.x0 - 60 && sx < p.x1 + 60) inPit = true;
        if (inPit) continue;
        const r = h1(wx * 0.01);
        g.globalAlpha = lights * 0.4;
        glowAt(g, r < 0.4 ? this.softPink : r < 0.7 ? this.softWarm : this.softCyan, sx, gy + 36, 150, 30);
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    g.imageSmoothingQuality = q;
  }

  drawEntity(g: Ctx2D, e: Ent, sx: number, sy: number, v: ViewState): boolean {
    this.build();
    const s = Math.min(MAX_STAGE, v.stage + v.stageBlend);
    const k: SkinCtx = { night: stageVal(NIGHT, s), time: v.time, quality: v.quality, reduced: v.reducedMotion };
    const A = this.A;
    switch (e.kind) {
      case "pickup":
        if (e.pickup === "coin") {
          drawJeton(g, A, e, sx, sy, v);
          return true;
        }
        return false;
      case "swinger":
        drawSwingChair(g, A, e, sx, sy, v, k);
        return true;
      case "spring":
        drawTrampoline(g, A, e, sx, sy, v, k);
        return true;
      case "platform":
        drawGondola(g, A, e, sx, sy, v, k);
        return true;
      case "pit":
        return true;
      case "projectile":
        drawCannonball(g, A, e, sx, sy, v, k);
        return true;
      case "flyer":
        drawGhost(g, A, e, sx, sy, v, k);
        return true;
      case "walker":
        drawScooter(g, A, e, sx, sy, v, k);
        return true;
      case "block":
        if (e.skin === "candy-crate") drawCandyCrate(g, A, e, sx, sy, v, k);
        else if (e.skin === "booth") drawBooth(g, A, e, sx, sy, v, k);
        else drawTires(g, A, e, sx, sy, v, k);
        return true;
      case "overhead":
        if (e.skin === "ghostgate") drawGhostGate(g, A, e, sx, sy, v, k);
        else drawValance(g, A, e, sx, sy, v, k);
        return true;
      default:
        return false;
    }
  }

  drawForeground(g: Ctx2D, v: ViewState): void {
    this.build();
    const st = Math.min(MAX_STAGE, v.stage);
    const bl = v.stageBlend;
    const s = Math.min(MAX_STAGE, st + bl);
    const lights = stageVal(LIGHTS, s);
    const chase = v.reducedMotion || v.quality === 0 ? 0 : Math.sin(v.time * 5.5 + 1);
    const q = g.imageSmoothingQuality;
    g.imageSmoothingQuality = "low";
    // Konfetti
    const amt = stageVal(CONFETTI, s) * (v.quality === 0 ? 0.3 : 1);
    const c = this.confetti;
    const n = Math.floor((c.length / 8) * amt);
    g.globalAlpha = 0.85;
    for (let i = 0; i < n; i += 1) {
      const o = i * 8;
      const x = c[o];
      const y = c[o + 1];
      if (x < -10 || x > 1290) continue;
      const w = c[o + 7] * Math.abs(Math.cos(c[o + 4]));
      g.fillStyle = BULB_COLORS[c[o + 6]];
      g.fillRect(x, y, w + 0.8, c[o + 7] * 0.55);
    }
    g.globalAlpha = 1;
    // Girlande oben (vor allem)
    drawStaged(g, this.garland, v.dist, st, bl, MAX_STAGE, lights * (0.65 + 0.35 * chase), lights * (0.65 - 0.35 * chase));
    // Mitternachtszauber: Glitzer
    const magic = stageVal(MAGIC, s);
    if (magic > 0.05 && v.quality > 0) {
      g.globalCompositeOperation = "lighter";
      for (let i = 0; i < 16; i += 1) {
        const x = mod(h1(i + 50) * 1400 - v.dist * 0.8 - v.time * 30, 1400) - 60;
        const y = mod(h1(i + 80) * 600 + v.time * (20 + h1(i) * 30), 640);
        const tw = v.reducedMotion ? 0.6 : 0.5 + 0.5 * Math.sin(v.time * 6 + i * 1.7);
        g.globalAlpha = magic * tw * 0.8;
        glowAt(g, i % 2 ? this.A.glowCyan : this.A.glowPink, x, y, 5 + tw * 4);
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    g.imageSmoothingQuality = q;
  }

  drawOverlay(g: Ctx2D, v: ViewState): void {
    const s = Math.min(MAX_STAGE, v.stage + v.stageBlend);
    const night = stageVal(NIGHT, s);
    if (night < 0.95 && v.quality === 2) {
      const sunY = stageVal(SUN_Y, s);
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.13 * (1 - night);
      blitCentered(g, this.bloom, 920, Math.min(560, sunY));
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    if (night > 0.3) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.08 * night;
      g.drawImage(this.underGlow, -60, 600);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
  }
}

function cloudSprite(i: number, night: boolean): HTMLCanvasElement {
  const W = 360;
  const H = 110;
  return paint(W, H, (g) => {
    const r = mulberry(40 + i * 7);
    const grd = g.createLinearGradient(0, 10, 0, H - 10);
    if (night) {
      grd.addColorStop(0, "rgba(90,70,140,0.55)");
      grd.addColorStop(1, "rgba(200,70,150,0.45)");
    } else {
      grd.addColorStop(0, "rgba(255,236,240,0.95)");
      grd.addColorStop(0.55, "rgba(255,180,160,0.9)");
      grd.addColorStop(1, "rgba(255,150,90,0.85)");
    }
    g.fillStyle = grd;
    const n = 9;
    for (let k = 0; k < n; k += 1) {
      const x = 40 + (k / (n - 1)) * (W - 80) + (r() - 0.5) * 20;
      const rad = 18 + r() * 26 * Math.sin((k / (n - 1)) * Math.PI) + 8;
      g.beginPath();
      g.ellipse(x, H - 30 - rad * 0.4, rad * 1.5, rad * 0.8, 0, 0, TAU);
      g.fill();
    }
    g.fillRect(40, H - 34, W - 80, 14);
  });
}
