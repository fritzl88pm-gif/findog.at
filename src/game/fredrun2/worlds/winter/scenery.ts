/**
 * Christkindlmarkt – gemalte Kulissen als Parallax-Stapel.
 *
 *   Himmel (0.02) → Ferne Stadt (0.06) → Mittelgrund Markt/Eisbahn/Krampusmarkt (0.4) → Nahgrund Tannen (0.85) → Boden (1.0)
 *
 * Speicher: Jede Ebene wird EINMAL auf Zielgröße skaliert (Canvas) und pro Stimmungsstufe eingefärbt (Staged: höchstens die
 * aktuelle und die nächste Stufe bleiben im Speicher). Bilder für spätere Stufen werden erst kurz vorher geladen; nicht mehr
 * benötigte Ebenen (Markt, Dämmerhimmel) werden freigegeben. Pro Frame: ganzzahlige 1:1-Blits + additive Leuchtpunkte.
 */
import type { AssetLoader } from "../../types";
import { blitTiled, blitTiledRange, glowSprite, paint, solidSegments, type Ctx2D } from "../shared-b/canvas";
import { mod, stageVal } from "../shared-b/color";
import { StageCache, Staged, nowMs, tinted, type StageTint } from "../shared-b/layers";
import { glowAt, makeGlows, sat, TAU, type GlowSet } from "./gfx";
import { LAYER_LIGHTS, SKY_STARS } from "./lights";
import {
  AURORA,
  FAR_TINT,
  GROUND_TINT,
  ICE_TINT,
  KRAMPUS_TINT,
  LIGHTS,
  MARKET_TINT,
  NEAR_TINT,
  NIGHT,
  RINK_TINT,
  SKY_H,
  STARS,
  VEIL,
  VIS_KRAMPUS,
  VIS_MARKET,
  VIS_RINK,
  type TintFn,
} from "./look";
import { MAX_STAGE } from "./stages";

const BASE = "/fredrun2/worlds/winter/";

/** Folgestufe erst ab diesem Fortschritt (0..1) der aktuellen Stufe vorbacken … */
const NEXT_FROM = 0.28;
/** … und höchstens einen Bake je so vielen Millisekunden (≈ 6 Frames) */
const NEXT_GAP_MS = 100;

interface ImgSpec {
  file: string;
  /** Zielgröße (logisch) des GESAMTEN Bildes */
  w: number;
  h: number;
  /** Quell-Ausschnitt: obere Höhe in Quellpixeln (Boden-Streifen) */
  cropH?: number;
  /** leere obere Quellzeilen, die nicht gespeichert/geblittet werden (spart Speicher und Füllrate) */
  cropTop?: number;
}

const IMG: Record<string, ImgSpec> = {
  "sky-dusk": { file: "sky-dusk.webp", w: 1750, h: SKY_H },
  "sky-night": { file: "sky-night.webp", w: 1750, h: SKY_H },
  "far-city": { file: "far-city.webp", w: 1492, h: 511, cropTop: 170 },
  "mid-market": { file: "mid-market.webp", w: 1792, h: 614, cropTop: 224 },
  "mid-rink": { file: "mid-rink.webp", w: 1792, h: 614, cropTop: 60 },
  "mid-krampus": { file: "mid-krampus.webp", w: 1792, h: 614, cropTop: 190 },
  "near-fir": { file: "near-fir.webp", w: 1478, h: 507 },
  ground: { file: "ground.webp", w: 736, h: 132, cropH: 264 },
  ice: { file: "ice.webp", w: 736, h: 132, cropH: 264 },
};

/** Ebenen im Stapel (hinten → vorne, ohne Himmel/Boden) */
interface Layer {
  name: string;
  factor: number;
  /** Bildschirm-y der Oberkante */
  y: number;
  vis: readonly number[];
  tint: TintFn;
  /** Leuchtpunkte: Farbe des Glühens */
  glow: "warm" | "fire" | null;
  staged: StageCache | null;
  w: number;
  /** Höhe des gespeicherten (oben beschnittenen) Bildes */
  h: number;
  /** Skalierung Quellbild → Ebene (Leuchtpunkt-Koordinaten) */
  k: number;
  /** Versatz des gespeicherten Bildes nach unten (beschnittene Zeilen, in Zielpixeln) */
  oy: number;
  /** Anzahl animierter Leuchtpunkte (die größten; alle anderen sind in die Varianten eingebrannt) */
  lightN: number;
}

export interface StageView {
  stage: number;
  blend: number;
}

export class Backdrop {
  private assets: AssetLoader | null = null;
  private readonly canv = new Map<string, HTMLCanvasElement>();
  private readonly loading = new Set<string>();
  private readonly glows: GlowSet = makeGlows();
  private layers: Layer[];
  private readonly skyMap = new Map<number, { c: HTMLCanvasElement; base: string }>();
  private ground: Staged | null = null;
  private ice: Staged | null = null;
  private pitGrd: CanvasGradient | null = null;
  private veil: HTMLCanvasElement | null = null;
  private glare: HTMLCanvasElement;
  private lastStage = -1;
  /** Zeitpunkt (ms) des letzten Bakes für die Folgestufe */
  private nextAt = -1e9;
  private starSprite: HTMLCanvasElement;

  constructor() {
    const mk = (name: string, factor: number, y: number, vis: readonly number[], tint: TintFn, glow: "warm" | "fire" | null, lightN: number): Layer => {
      const spec = IMG[name];
      const k = spec.w / (name === "far-city" ? 2016 : 2240);
      const oy = Math.round((spec.cropTop ?? 0) * (spec.h / (name === "far-city" ? 691 : 768)));
      return { name, factor, y, vis, tint, glow, staged: null, w: spec.w, h: spec.h - oy, k, oy, lightN };
    };
    this.layers = [
      mk("far-city", 0.06, 93, [1, 1, 1, 1, 1], FAR_TINT, "warm", 22),
      mk("mid-market", 0.4, 22, VIS_MARKET, MARKET_TINT, "warm", 34),
      mk("mid-rink", 0.4, 12, VIS_RINK, RINK_TINT, "warm", 34),
      mk("mid-krampus", 0.4, 46, VIS_KRAMPUS, KRAMPUS_TINT, "fire", 30),
      mk("near-fir", 0.85, 223, [1, 1, 1, 1, 1], NEAR_TINT, "warm", 5),
    ];
    this.glare = paint(220, 132, (g) => {
      g.transform(1, 0, -0.55, 1, 60, 0);
      const grd = g.createLinearGradient(0, 0, 90, 0);
      grd.addColorStop(0, "rgba(255,255,255,0)");
      grd.addColorStop(0.5, "rgba(255,255,255,0.5)");
      grd.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, 90, 132);
    });
    this.starSprite = glowSprite("#dfeaff", 0.2);
  }

  // --- Laden ------------------------------------------------------------------------------------------

  /** Grundausstattung: Dämmerhimmel, Stadt, Markt, Tannen, Boden, Eis */
  async load(assets: AssetLoader): Promise<void> {
    this.assets = assets;
    await Promise.all(["sky-dusk", "far-city", "mid-market", "near-fir", "ground", "ice"].map((n) => this.fetch(n)));
    this.attach();
  }

  private async fetch(name: string): Promise<void> {
    if (this.canv.has(name) || this.loading.has(name) || !this.assets) return;
    this.loading.add(name);
    try {
      const img = await this.assets.image(BASE + IMG[name].file);
      if (!img) return;
      const spec = IMG[name];
      const top = spec.cropTop ?? 0;
      const kY = spec.h / img.height;
      const outH = spec.cropH ? spec.h : Math.round(spec.h - top * kY);
      const c = paint(spec.w, outH, (g, w, h) => {
        g.imageSmoothingQuality = "high";
        const sh = spec.cropH ?? img.height - top;
        g.drawImage(img, 0, top, img.width, sh, 0, 0, w, h);
      });
      this.canv.set(name, c);
    } catch {
      // Ebene fehlt → Welt sieht ohne sie trotzdem gut aus
    } finally {
      this.loading.delete(name);
    }
  }

  /** Gelieferte Bilder in Ebenen/Boden einhängen */
  private attach(): void {
    for (const L of this.layers) {
      if (!L.staged) {
        const src = this.canv.get(L.name);
        if (src) L.staged = this.lit(L, src);
      }
    }
    const g = this.canv.get("ground");
    if (g && !this.ground) this.ground = new Staged(g, GROUND_TINT);
    const i = this.canv.get("ice");
    if (i && !this.ice) this.ice = new Staged(i, ICE_TINT);
  }

  /** Stufen-Varianten mit eingebrannten Lichtern (Fenster, Laternen, Lichterketten): Glühen kostet zur Laufzeit nichts */
  private lit(L: Layer, src: HTMLCanvasElement): StageCache {
    const list = LAYER_LIGHTS[L.name];
    const glows = this.glows;
    return new StageCache((stage) => {
      const c = tinted(src, L.tint(stage));
      if (!list || !L.glow) return c;
      const g = c.getContext("2d");
      if (!g) return c;
      const level = LIGHTS[stage] * (L.glow === "fire" ? 0.75 : 0.6);
      const spr = L.glow === "fire" ? glows.orange : glows.warm;
      const spr2 = L.glow === "fire" ? glows.red : glows.gold;
      g.globalCompositeOperation = "lighter";
      const n = Math.floor(list.length / 3);
      for (let i = L.lightN; i < n; i += 1) {
        const x = list[i * 3] * L.k;
        const y = list[i * 3 + 1] * L.k - L.oy;
        const r = list[i * 3 + 2] * L.k;
        const rad = r * 2.4 + 6;
        g.globalAlpha = Math.min(1, level * (r > 6 ? 0.9 : 0.75));
        const sp = i % 3 === 0 ? spr2 : spr;
        glowAt(g, sp, x, y, rad);
        if (x < rad) glowAt(g, sp, x + L.w, y, rad);
        else if (x > L.w - rad) glowAt(g, sp, x - L.w, y, rad);
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
      return c;
    });
  }

  /** Was wird in Stufe s gebraucht? */
  private static needs(s: number): string[] {
    const out = ["far-city", "near-fir", "ground", "ice"];
    out.push(s <= 1 ? "sky-dusk" : "sky-night");
    if (VIS_MARKET[s]) out.push("mid-market");
    if (VIS_RINK[s]) out.push("mid-rink");
    if (VIS_KRAMPUS[s]) out.push("mid-krampus");
    return out;
  }

  /** Lädt Bilder der aktuellen und (ab halber Stufe) der nächsten Stufe nach; gibt Unbrauchbares frei. */
  private manage(stage: number, progress: number): void {
    const want = new Set(Backdrop.needs(stage));
    if (stage < MAX_STAGE && progress > 0.45) for (const n of Backdrop.needs(stage + 1)) want.add(n);
    for (const n of want) {
      if (!this.canv.has(n) && !this.loading.has(n)) {
        void this.fetch(n).then(() => this.attach());
      }
    }
    // freigeben: Bilder, die ab jetzt nie mehr gebraucht werden
    for (const n of ["mid-market", "sky-dusk", "mid-rink"]) {
      if (this.canv.has(n) && !want.has(n) && !this.usedLater(n, stage)) {
        this.canv.delete(n);
        const L = this.layers.find((l) => l.name === n);
        if (L) L.staged = null;
      }
    }
  }

  private usedLater(name: string, stage: number): boolean {
    for (let s = stage; s <= MAX_STAGE; s += 1) if (Backdrop.needs(s).includes(name)) return true;
    return false;
  }

  // --- Himmel -----------------------------------------------------------------------------------------

  /** Welche Himmelsquelle gehört (nach aktuellem Ladestand) zu dieser Stufe? */
  private skyName(stage: number): string {
    const dusk = this.canv.has("sky-dusk");
    const night = this.canv.has("sky-night");
    if (stage <= 1) return dusk ? "sky-dusk" : night ? "sky-night" : "";
    return night ? "sky-night" : dusk ? "sky-dusk" : "";
  }

  private hasSky(stage: number): boolean {
    const e = this.skyMap.get(stage);
    return !!e && e.base === this.skyName(stage);
  }

  /** Himmelsvariante; wird neu gebacken, wenn inzwischen die passende Quelle geladen wurde (z.B. Neustart nach Freigabe) */
  private getSky(stage: number): HTMLCanvasElement {
    const e = this.skyMap.get(stage);
    const want = this.skyName(stage);
    if (e && e.base === want) return e.c;
    const c = this.buildSky(stage);
    this.skyMap.set(stage, { c, base: want });
    return c;
  }

  private buildSky(stage: number): HTMLCanvasElement {
    const dusk = this.canv.get("sky-dusk");
    const night = this.canv.get("sky-night");
    const base = stage <= 1 ? dusk ?? night : night ?? dusk;
    const w = IMG["sky-dusk"].w;
    const h = SKY_H;
    if (!base) {
      // Rückfall: Verlauf
      const cols: Array<[string, string, string]> = [
        ["#1b2a6a", "#c26a86", "#ffb070"],
        ["#0a1238", "#233a86", "#c06a60"],
        ["#04102a", "#0b3a66", "#3aa0c8"],
        ["#8a98ac", "#aab6c6", "#cbd4e0"],
        ["#12040c", "#3a0a1a", "#a0301e"],
      ];
      return paint(w, h, (g) => {
        const grd = g.createLinearGradient(0, 0, 0, h);
        grd.addColorStop(0, cols[stage][0]);
        grd.addColorStop(0.6, cols[stage][1]);
        grd.addColorStop(1, cols[stage][2]);
        g.fillStyle = grd;
        g.fillRect(0, 0, w, h);
      });
    }
    return paint(w, h, (g) => {
      g.drawImage(base, 0, 0);
      g.globalCompositeOperation = "source-atop";
      const wash = (color: string, a0: number, a1: number): void => {
        const grd = g.createLinearGradient(0, 0, 0, h);
        grd.addColorStop(0, color.replace("A", a0.toFixed(3)));
        grd.addColorStop(1, color.replace("A", a1.toFixed(3)));
        g.fillStyle = grd;
        g.fillRect(0, 0, w, h);
      };
      switch (stage) {
        case 1:
          wash("rgba(10,18,64,A)", 0.7, 0.4);
          break;
        case 2:
          wash("rgba(70,200,255,A)", 0.04, 0.22);
          break;
        case 3:
          wash("rgba(176,190,206,A)", 0.86, 0.9);
          break;
        case 4: {
          // Grün → Rot: Farbton verschieben (bleibt der Browser ohne „hue“, genügt ein roter Schleier)
          g.globalCompositeOperation = "hue";
          const ok = g.globalCompositeOperation === "hue";
          g.fillStyle = "rgba(226,26,18,0.92)";
          g.fillRect(0, 0, w, h);
          g.globalCompositeOperation = "source-atop";
          if (!ok) wash("rgba(150,10,10,A)", 0.5, 0.5);
          wash("rgba(20,0,10,A)", 0.4, 0.2);
          wash("rgba(255,70,30,A)", 0, 0.42);
          break;
        }
        default:
          break;
      }
    });
  }

  // --- Update / Vorbereitung ------------------------------------------------------------------------

  /**
   * Pro Frame: Nachladen, höchstens eine fehlende Variante backen. Die Varianten der aktuellen Stufe sofort; die der Folgestufe
   * nicht am Stufenanfang (dort drängt sich sonst alles auf den Übergang), sondern erst ab `NEXT_FROM` des Stufen-Fortschritts
   * und höchstens eine je `NEXT_GAP_MS`; beginnt die Überblendung (`blend` > 0), wird nachgeholt (eine je Frame).
   */
  prepare(stage: number, progress: number, blend = 0): void {
    const next = Math.min(MAX_STAGE, stage + 1);
    if (stage !== this.lastStage) {
      this.lastStage = stage;
      for (const k of [...this.skyMap.keys()]) if (k !== stage && k !== next) this.skyMap.delete(k);
    }
    this.manage(stage, progress);
    const now: Array<() => void> = [];
    const later: Array<() => void> = [];
    if (!this.hasSky(stage)) now.push(() => void this.getSky(stage));
    for (const L of this.layers) {
      const staged = L.staged;
      if (!staged) continue;
      staged.keep(stage, next);
      for (const st of [stage, next]) {
        if (L.vis[st] > 0 && !staged.has(st)) (st === stage ? now : later).push(() => void staged.get(st));
      }
    }
    for (const G of [this.ground, this.ice]) {
      if (!G) continue;
      G.keep(stage, next);
      for (const st of [stage, next]) if (!G.has(st)) (st === stage ? now : later).push(() => void G.get(st));
    }
    if (!this.hasSky(next)) later.push(() => void this.getSky(next));
    // höchstens eine fehlende Variante pro Frame backen (Kosten verteilen); die Folgestufe erst spät (siehe oben)
    if (now.length) {
      now[0]();
      return;
    }
    if (!later.length) return;
    const urgent = blend > 0.001;
    if (!urgent && progress < NEXT_FROM) return;
    const t = nowMs();
    if (t < this.nextAt) this.nextAt = t; // Uhr zurückgesetzt
    if (!urgent && t - this.nextAt < NEXT_GAP_MS) return;
    this.nextAt = t;
    later[0]();
  }

  // --- Zeichnen -----------------------------------------------------------------------------------------

  drawSky(g: Ctx2D, dist: number, sv: StageView, time: number, reduced: boolean, quality: number): void {
    const { stage, blend } = sv;
    const scroll = dist * 0.02;
    const w = IMG["sky-dusk"].w;
    blitTiled(g, this.getSky(stage), w, SKY_H, scroll, 0);
    if (blend > 0.004 && stage < MAX_STAGE) {
      g.globalAlpha = blend;
      blitTiled(g, this.getSky(stage + 1), w, SKY_H, scroll, 0);
      g.globalAlpha = 1;
    }
    // Polarlicht wogt: dieselbe Himmelsebene noch einmal, sanft versetzt und additiv
    const s = stage + blend;
    const au = stageVal(AURORA, s);
    if (au > 0.05 && quality > 1 && !reduced) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = au * (0.1 + 0.05 * Math.sin(time * 0.5));
      blitTiled(g, this.getSky(stage), w, SKY_H, scroll + Math.sin(time * 0.23) * 46, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    // Sterne funkeln
    const sa = stageVal(STARS, s);
    if (sa > 0.05 && quality > 0) {
      const key = stage >= 2 ? "sky-night" : "sky-dusk";
      const list = SKY_STARS[key];
      const kx = w / 1680;
      const off = mod(scroll, w);
      g.globalCompositeOperation = "lighter";
      const n = Math.floor(list.length / 3);
      const cap = quality === 1 ? Math.min(n, 16) : Math.min(n, 34);
      for (let i = 0; i < cap; i += 1) {
        let x = list[i * 3] * kx - off;
        if (x < -20) x += w;
        if (x > 1300) continue;
        const r = list[i * 3 + 2];
        const tw = reduced ? 0.7 : 0.5 + 0.5 * Math.sin(time * (1.3 + (i % 5) * 0.55) + i * 2.1);
        g.globalAlpha = sa * tw * 0.85;
        glowAt(g, this.glows.cross, x, list[i * 3 + 1] * kx, 5 + r * 3);
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
  }

  /** Zeichnet eine Ebene (mit Kreuzblende der Stufen) samt Leuchtpunkten */
  drawLayer(g: Ctx2D, L: Layer, dist: number, sv: StageView, time: number, reduced: boolean, quality: number, force = false): void {
    const staged = L.staged;
    if (!staged) return;
    const { stage, blend } = sv;
    const next = Math.min(MAX_STAGE, stage + 1);
    const scroll = dist * L.factor;
    const wa = force ? 1 : L.vis[stage] * (1 - blend);
    const wb = force ? 0 : stage < MAX_STAGE ? L.vis[next] * blend : 0;
    const same = !force && L.vis[stage] > 0 && L.vis[next] > 0;
    if (wa <= 0.004 && wb <= 0.004) return;
    const pa = g.globalAlpha;
    if (same || (stage === MAX_STAGE && !force)) {
      // identische Bildinhalte: A voll, B darüber (tönt über)
      g.globalAlpha = pa * Math.max(wa + wb, 0);
      blitTiled(g, staged.get(stage), L.w, L.h, scroll, L.y + L.oy);
      if (blend > 0.004 && stage < MAX_STAGE) {
        g.globalAlpha = pa * blend;
        blitTiled(g, staged.get(next), L.w, L.h, scroll, L.y + L.oy);
      }
    } else {
      if (wa > 0.004) {
        g.globalAlpha = pa * wa;
        blitTiled(g, staged.get(stage), L.w, L.h, scroll, L.y + L.oy);
      }
      if (wb > 0.004) {
        g.globalAlpha = pa * wb;
        blitTiled(g, staged.get(next), L.w, L.h, scroll, L.y + L.oy);
      }
    }
    g.globalAlpha = pa;
    if (quality > 0 || L.name === "mid-krampus") this.drawLights(g, L, scroll, Math.max(wa + wb, 0), sv, time, reduced, quality);
  }

  /** Animierte Leuchtpunkte (die größten je Ebene): funkeln zusätzlich zu den eingebrannten Lichtern */
  private drawLights(g: Ctx2D, L: Layer, scroll: number, vis: number, sv: StageView, time: number, reduced: boolean, quality: number): void {
    const list = LAYER_LIGHTS[L.name];
    if (!list || !L.glow) return;
    const s = sv.stage + sv.blend;
    const lit = stageVal(LIGHTS, s) * vis;
    if (lit < 0.03) return;
    const spr = L.glow === "fire" ? this.glows.orange : this.glows.warm;
    const spr2 = L.glow === "fire" ? this.glows.red : this.glows.gold;
    const off = mod(scroll, L.w);
    const total = Math.floor(list.length / 3);
    const n = Math.min(total, quality === 1 ? Math.ceil(L.lightN * 0.5) : L.lightN);
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < n; i += 1) {
      let x = list[i * 3] * L.k - off;
      if (x < -50) x += L.w;
      if (x > 1330) continue;
      const y = list[i * 3 + 1] * L.k + L.y;
      const r = list[i * 3 + 2] * L.k;
      const tw = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(time * (1.7 + (i % 5) * 0.6) + i * 1.93 + ((i & 1) === 0 ? 0 : Math.PI));
      let a = lit * (0.12 + 0.38 * tw);
      if (L.glow === "fire" && !reduced) a *= 0.7 + 0.5 * Math.abs(Math.sin(time * 11 + i * 2.7) * Math.sin(time * 7.3 + i));
      g.globalAlpha = Math.min(1, a);
      glowAt(g, i % 3 === 0 ? spr2 : spr, x, y, r * 2.6 + 7);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  drawFar(g: Ctx2D, dist: number, sv: StageView, time: number, reduced: boolean, quality: number): void {
    this.drawLayer(g, this.layers[0], dist, sv, time, reduced, quality);
  }

  drawMid(g: Ctx2D, dist: number, sv: StageView, time: number, reduced: boolean, quality: number): void {
    const next = Math.min(MAX_STAGE, sv.stage + 1);
    let ready = false;
    for (let i = 1; i <= 3; i += 1) {
      const L = this.layers[i];
      if (L.staged && (L.vis[sv.stage] * (1 - sv.blend) > 0.004 || L.vis[next] * sv.blend > 0.004)) ready = true;
      this.drawLayer(g, L, dist, sv, time, reduced, quality);
    }
    if (!ready) {
      // Bild der Stufe noch nicht geladen (z.B. direkt nach einem Neustart): vorläufig eine bereite Ebene zeigen
      const F = this.layers.slice(1, 4).find((L) => L.staged);
      if (F) this.drawLayer(g, F, dist, sv, time, reduced, quality, true);
    }
  }

  drawNear(g: Ctx2D, dist: number, sv: StageView, time: number, reduced: boolean, quality: number): void {
    this.drawLayer(g, this.layers[4], dist, sv, time, reduced, quality);
  }

  /** Whiteout-Schleier (Stufe Schneesturm) */
  drawVeil(g: Ctx2D, sv: StageView): void {
    const k = stageVal(VEIL, sv.stage + sv.blend);
    if (k < 0.02) return;
    if (!this.veil) {
      this.veil = paint(1280, 600, (c, w, h) => {
        const grd = c.createLinearGradient(0, 0, 0, h);
        grd.addColorStop(0, "rgba(206,218,234,0.55)");
        grd.addColorStop(0.6, "rgba(214,224,238,0.42)");
        grd.addColorStop(1, "rgba(226,234,246,0.62)");
        c.fillStyle = grd;
        c.fillRect(0, 0, w, h);
      });
    }
    g.globalAlpha = k * 0.9;
    g.drawImage(this.veil, 0, 0);
    g.globalAlpha = 1;
  }

  // --- Boden ------------------------------------------------------------------------------------------

  private groundTile(sv: StageView, ice: boolean, which: "a" | "b"): HTMLCanvasElement | null {
    const G = ice ? this.ice : this.ground;
    if (!G) return null;
    const st = which === "a" ? sv.stage : Math.min(MAX_STAGE, sv.stage + 1);
    return G.get(st);
  }

  /** Bodenband zwischen x0 und x1 (Schnee-Pflaster oder Eis), Stufen-Überblendung */
  blitGround(g: Ctx2D, dist: number, gy: number, x0: number, x1: number, sv: StageView, ice: boolean): void {
    const A = this.groundTile(sv, ice, "a");
    if (!A) {
      g.fillStyle = ice ? "#7fc8f0" : "#5a6486";
      g.fillRect(x0, gy, x1 - x0, 130);
      return;
    }
    blitTiledRange(g, A, 736, 132, dist, x0, x1, gy);
    if (sv.blend > 0.004 && sv.stage < MAX_STAGE) {
      const B = this.groundTile(sv, ice, "b");
      if (B) {
        g.globalAlpha = sv.blend;
        blitTiledRange(g, B, 736, 132, dist, x0, x1, gy);
        g.globalAlpha = 1;
      }
    }
  }

  /** Lauffläche mit Eisspalten (pits), Schneekanten und Lichtreflexen */
  drawGround(g: Ctx2D, dist: number, gy: number, viewH: number, pits: ReadonlyArray<{ x0: number; x1: number; skin: string }>, sv: StageView, time: number, reduced: boolean, quality: number): void {
    const H = viewH - gy;
    // Spalten zuerst (Segmente überdecken deren Kanten)
    for (const p of pits) this.drawCrevasse(g, dist, gy, H, p.x0, p.x1, time, reduced, quality);
    const segs = solidSegments(pits, 1280);
    for (const sg of segs) {
      const a = Math.max(0, sg.x0);
      const b = Math.min(1280, sg.x1);
      if (b <= a) continue;
      this.blitGround(g, dist, gy, a, b, sv, false);
      // Schneewulst an den Kanten zur Spalte
      if (sg.x0 > -30) this.snowLip(g, sg.x0, gy, 1);
      if (sg.x1 < 1310) this.snowLip(g, sg.x1, gy, -1);
    }
    // warme Lichtreflexe auf dem Pflaster (nachts)
    const lit = stageVal(NIGHT, sv.stage + sv.blend);
    if (quality > 0 && lit > 0.3) {
      g.globalCompositeOperation = "lighter";
      const step = 430;
      const wx0 = Math.floor((dist - 200) / step) * step;
      for (let wx = wx0; wx < dist + 1500; wx += step) {
        const sx = wx + 120 - dist;
        let inPit = false;
        for (const p of pits) if (sx > p.x0 - 90 && sx < p.x1 + 90) inPit = true;
        if (inPit) continue;
        g.globalAlpha = 0.16 * lit * (0.75 + 0.25 * Math.sin(wx * 0.13 + (reduced ? 0 : time * 2.2)));
        glowAt(g, this.glows.softWarm, sx, gy + 30, 170, 24);
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
  }

  private snowLip(g: Ctx2D, x: number, gy: number, dir: 1 | -1): void {
    const xr = Math.round(x);
    g.fillStyle = "#eef4ff";
    g.beginPath();
    g.ellipse(xr, gy + 3, 11, 7, 0, 0, TAU);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.9)";
    g.beginPath();
    g.ellipse(xr + dir * -7, gy + 1, 8, 5, 0, 0, TAU);
    g.fill();
    // Kante zur Spalte: helles Eisband
    g.fillStyle = "rgba(150,220,255,0.55)";
    g.fillRect(dir === 1 ? xr - 2 : xr - 2, gy + 6, 3, 40);
  }

  /** Eisspalte: tiefblaue Schlucht mit Eiszähnen, kaltem Leuchten aus der Tiefe und glitzernden Kristallen */
  private drawCrevasse(g: Ctx2D, dist: number, gy: number, H: number, px0: number, px1: number, time: number, reduced: boolean, quality: number): void {
    const x0 = Math.round(Math.max(-30, px0));
    const x1 = Math.round(Math.min(1310, px1));
    if (x1 <= x0) return;
    if (!this.pitGrd) {
      const grd = g.createLinearGradient(0, gy, 0, gy + H);
      grd.addColorStop(0, "#215d94");
      grd.addColorStop(0.22, "#0e3060");
      grd.addColorStop(0.6, "#071a3c");
      grd.addColorStop(1, "#02060f");
      this.pitGrd = grd;
    }
    g.fillStyle = this.pitGrd;
    g.fillRect(x0, gy, x1 - x0, H);
    // Wände
    const lw = g.createLinearGradient(x0, 0, x0 + 26, 0);
    lw.addColorStop(0, "rgba(170,230,255,0.42)");
    lw.addColorStop(1, "rgba(170,230,255,0)");
    g.fillStyle = lw;
    g.fillRect(x0, gy, 26, H);
    const rw = g.createLinearGradient(x1 - 34, 0, x1, 0);
    rw.addColorStop(0, "rgba(0,4,16,0)");
    rw.addColorStop(1, "rgba(0,4,16,0.6)");
    g.fillStyle = rw;
    g.fillRect(x1 - 34, gy, 34, H);
    // Eiszähne an den Rändern
    g.fillStyle = "#c9f0ff";
    g.strokeStyle = "#173a5c";
    g.lineWidth = 2;
    for (let i = 0; i < 4; i += 1) {
      const lx = x0 + 3 + i * 8;
      const lh = 16 + ((i * 37) % 3) * 9;
      g.beginPath();
      g.moveTo(lx, gy + 6);
      g.lineTo(lx + 8, gy + 6);
      g.lineTo(lx + 3, gy + 6 + lh);
      g.closePath();
      g.fill();
      g.stroke();
      const rx = x1 - 6 - i * 8;
      g.beginPath();
      g.moveTo(rx, gy + 6);
      g.lineTo(rx - 8, gy + 6);
      g.lineTo(rx - 3, gy + 6 + lh * 0.8);
      g.closePath();
      g.fill();
      g.stroke();
    }
    if (quality === 0) return;
    // Rissmuster (mit der Welt scrollend)
    g.strokeStyle = "rgba(170,225,255,0.22)";
    g.lineWidth = 1.5;
    g.beginPath();
    const step = 96;
    const w0 = Math.floor((dist + x0) / step) * step;
    for (let wx = w0; wx < dist + x1 + step; wx += step) {
      const sx = wx - dist;
      if (sx < x0 + 20 || sx > x1 - 20) continue;
      const h = 34 + ((wx * 7) % 46);
      g.moveTo(sx, gy + 30);
      g.lineTo(sx + 9, gy + 30 + h * 0.5);
      g.lineTo(sx - 5, gy + 30 + h);
    }
    g.stroke();
    // kaltes Glühen aus der Tiefe + Glitzer
    g.globalCompositeOperation = "lighter";
    const cx = (x0 + x1) / 2;
    const rr = Math.min(560, (x1 - x0) * 0.9);
    g.globalAlpha = 0.34 + (reduced ? 0 : 0.08 * Math.sin(time * 1.6));
    glowAt(g, this.glows.softCyan, cx, gy + H - 6, rr, 70);
    for (let i = 0; i < 6; i += 1) {
      const wx = Math.floor((dist + x0) / 160) * 160 + i * 160 + 40;
      const sx = wx - dist;
      if (sx < x0 + 16 || sx > x1 - 16) continue;
      const tw = reduced ? 0.5 : Math.max(0, Math.sin(time * 2 + wx * 0.017));
      g.globalAlpha = tw * 0.9;
      glowAt(g, this.glows.cross, sx, gy + 60 + ((wx * 13) % 50), 9);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  /** Eisfläche als Streifen über dem Pflaster (Entität `ice`): Eisband, Kanten, Glanzlauf, Glitzer */
  drawIceZone(g: Ctx2D, dist: number, gy: number, sx: number, w: number, sv: StageView, time: number, reduced: boolean, quality: number, id: number): void {
    const x0 = Math.max(-20, sx);
    const x1 = Math.min(1300, sx + w);
    if (x1 <= x0) return;
    this.blitGround(g, dist, gy, x0, x1, sv, true);
    // weiche Kanten (Übergang Schnee → Eis): heller Rand
    g.fillStyle = "rgba(210,244,255,0.85)";
    if (sx > -20) g.fillRect(Math.round(sx), gy, 3, 132);
    if (sx + w < 1300) g.fillRect(Math.round(sx + w) - 3, gy, 3, 132);
    // Eiskristalle wachsen an den Kanten der Fläche
    for (const [ex, dir] of [
      [sx, 1],
      [sx + w, -1],
    ] as const) {
      if (ex < -40 || ex > 1320) continue;
      this.crystals(g, Math.round(ex), gy, dir, id);
    }
    if (quality === 0) return;
    g.save();
    g.beginPath();
    g.rect(x0, gy, x1 - x0, 132);
    g.clip();
    g.globalCompositeOperation = "lighter";
    // Glanzlauf
    const speed = reduced ? 0 : 0.28;
    const u = ((time * speed + id * 0.37) % 1 + 1) % 1;
    g.globalAlpha = 0.42;
    g.drawImage(this.glare, sx - 60 + u * (w + 260), gy);
    // Glitzer auf dem Eis
    const step = 120;
    const w0 = Math.floor((dist + x0) / step) * step;
    for (let wx = w0; wx < dist + x1 + step; wx += step) {
      const px = wx - dist + ((wx * 31) % 90);
      if (px < x0 || px > x1) continue;
      const tw = reduced ? 0.5 : Math.max(0, Math.sin(time * (2 + (wx % 3)) + wx * 0.05));
      g.globalAlpha = tw;
      glowAt(g, this.glows.cross, px, gy + 12 + ((wx * 17) % 70), 9 + (wx % 5));
    }
    // warme Reflexe der Marktlichter
    const lit = stageVal(NIGHT, sv.stage + sv.blend);
    g.globalAlpha = 0.16 * lit;
    for (let wx = Math.floor((dist + x0) / 300) * 300; wx < dist + x1 + 300; wx += 300) glowAt(g, this.glows.softWarm, wx + 90 - dist, gy + 26, 120, 18);
    g.restore();
  }

  /** Kleine, durchscheinende Eiskristalle (Dreiecksspitzen) an einer Kante der Eisfläche */
  private crystals(g: Ctx2D, x: number, gy: number, dir: 1 | -1, id: number): void {
    const defs = [
      [4, 26, 8],
      [15, 17, 6],
      [24, 22, 7],
    ];
    g.lineJoin = "round";
    for (let i = 0; i < defs.length; i += 1) {
      const [dx, h, bw] = defs[i];
      const cx = x + dir * dx;
      const hh = h + ((id + i) % 3) * 3;
      const grd = g.createLinearGradient(cx - bw, 0, cx + bw, 0);
      grd.addColorStop(0, "rgba(150,226,255,0.85)");
      grd.addColorStop(0.5, "rgba(246,253,255,0.95)");
      grd.addColorStop(1, "rgba(96,178,232,0.85)");
      g.fillStyle = grd;
      g.strokeStyle = "rgba(24,64,104,0.85)";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(cx - bw, gy + 3);
      g.lineTo(cx + bw, gy + 3);
      g.lineTo(cx + dir * 1.5, gy + 3 - hh);
      g.closePath();
      g.fill();
      g.stroke();
    }
  }

  get ready(): boolean {
    return this.canv.size > 0;
  }

  /** Tint-Beschreibung für Tests/Debug */
  static tintOf(name: string, stage: number): StageTint {
    const T: Record<string, TintFn> = { far: FAR_TINT, market: MARKET_TINT, rink: RINK_TINT, krampus: KRAMPUS_TINT, near: NEAR_TINT, ground: GROUND_TINT, ice: ICE_TINT };
    return T[name]?.(stage) ?? {};
  }
}

export { sat, tinted };
