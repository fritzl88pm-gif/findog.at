/**
 * Wachau – Entitäts-Skins. Aufwändige Formen werden einmal pro Größe vorgerendert (Sprite-Cache) und pro
 * Stimmungsstufe leicht getönt (Entitäten bleiben heller als die Kulisse → Gefahren lesbar). Nachts tragen Gefahren
 * einen warmen Rim-Schein. Props (wine-barrel, crate-wine, bee-swarm, apricot) werden genutzt, wenn vorhanden; die
 * Hindernisse (wachau-cask/-crates/-wall/-branch/-vines) kommen als eng zugeschnittene Silhouetten, einmal pro Zielgröße
 * gebacken (Pixelfaktor `pk`), mit prozeduralem Fallback ohne Props.
 */
import type { Ent, PropLibrary, ViewState } from "../../types";
import { glowAt, glowSprite, paint, rr, softSprite, type Ctx2D } from "../shared-b/canvas";
import { mulberry } from "../shared-b/color";
import { MAX_STAGE, STAGES, SpriteCache, mixHex, silhouetteGlow, tintCanvas, withA } from "./palette";
import { PROP_PAD, bakeProp, bakeStretch, fitBox, propAspect, propScale, quant } from "./propfit";
import { grapeBunch, grapeLeaf, stoneWall } from "./scenery";

const TAU = Math.PI * 2;

export interface SkinCtx {
  /** 0..1 Nacht (Entitäten) */
  night: number;
  /** 0..1 Laternen/Lichter */
  lights: number;
  stage: number;
  blend: number;
  time: number;
  quality: 0 | 1 | 2;
  reduced: boolean;
  groundY: number;
  waterY: number;
  water: string;
  waterDeep: string;
  /** durchscheinendes Wasser (über getauchten Teilen) */
  waterTint: string;
  rim: string;
}

type Variants = Array<HTMLCanvasElement | undefined>;

/** Stufen-Varianten eines Sprites: Entitäten bekommen ~55 % des Szenenlichts */
function entTint(src: HTMLCanvasElement, stage: number): HTMLCanvasElement {
  const L = STAGES[stage].light;
  const k = stage >= 3 ? 0.62 : 0.5;
  return tintCanvas(src, { mul: mixHex("#ffffff", L, k) });
}

export class WachauSkins {
  props: PropLibrary | null = null;
  private cache = new SpriteCache(64);
  private variants = new Map<string, Variants>();
  readonly glowWarm = glowSprite("#ffc46a", 0.2);
  readonly glowGold = glowSprite("#ffe08a", 0.22);
  readonly glowWhite = glowSprite("#fff6e0", 0.2);
  readonly glowRed = glowSprite("#ff6a3a", 0.18);
  readonly softWater = softSprite("rgba(220,240,255,1)");
  readonly softWarm = softSprite("rgba(255,180,90,1)");
  readonly softLeaf = softSprite("rgba(255,220,140,1)");
  private apricotStrip: HTMLCanvasElement | null = null;
  private grapeStrip: HTMLCanvasElement | null = null;
  private apricotFromProp = false;
  static readonly APRICOT = 48;
  /** Pixelfaktor der Zeichenfläche (1 … 2): Hindernis-Sprites werden dafür vorgerendert */
  private pk = 1;

  setProps(p: PropLibrary): void {
    this.props = p;
    this.apricotStrip = null;
    this.grapeStrip = null;
    this.cache.clear();
    this.variants.clear();
  }

  setScale(k: number): void {
    const nk = Math.min(2, Math.max(1, k));
    if (Math.abs(nk - this.pk) > 0.2) {
      this.pk = nk;
      this.cache.clear();
      this.variants.clear();
    }
  }

  /**
   * Sprite nach Schlüssel (vorgerendert) in Stufen-Tönung; blendet in die nächste Stufe über.
   * `sc` = Pixelfaktor, mit dem das Sprite gebacken wurde (Zeichengröße = Canvas / sc).
   */
  private drawStaged(g: Ctx2D, key: string, make: () => HTMLCanvasElement, x: number, y: number, k: SkinCtx, alpha = 1, sc = 1): HTMLCanvasElement {
    const base = this.cache.get(key, make);
    let v = this.variants.get(key);
    if (!v || v.length === 0) {
      v = [];
      this.variants.set(key, v);
      if (this.variants.size > 80) {
        const first = this.variants.keys().next().value;
        if (first !== undefined && first !== key) this.variants.delete(first);
      }
    }
    const st = k.stage;
    const a = v[st] ?? this.tinted(v, base, st);
    const pa = g.globalAlpha;
    g.globalAlpha = pa * alpha;
    const px = Math.round(x * sc) / sc;
    const py = Math.round(y * sc) / sc;
    const dw = a.width / sc;
    const dh = a.height / sc;
    g.drawImage(a, px, py, dw, dh);
    if (k.blend > 0.02 && st < MAX_STAGE) {
      const b = v[st + 1] ?? this.tinted(v, base, st + 1);
      g.globalAlpha = pa * alpha * k.blend;
      g.drawImage(b, px, py, dw, dh);
    }
    g.globalAlpha = pa;
    return base;
  }

  /** Neue Stufen-Variante; Varianten weit entfernter Stufen werden verworfen (Speicher – die Läufe gehen Stufe für Stufe voran) */
  private tinted(v: Variants, base: HTMLCanvasElement, st: number): HTMLCanvasElement {
    const t = entTint(base, st);
    v[st] = t;
    for (let i = 0; i < v.length; i += 1) if (i < st - 1 || i > st + 1) v[i] = undefined;
    return t;
  }

  private rimOf(key: string, base: HTMLCanvasElement, color: string, sc = 1): HTMLCanvasElement {
    return this.cache.get(`${key}|rim`, () => silhouetteGlow(base, color, 10 * sc, 12 * sc));
  }

  /** Warmes Rimlight hinter Gefahren (nachts stärker) */
  private rim(g: Ctx2D, key: string, base: HTMLCanvasElement, x: number, y: number, k: SkinCtx, color = "#ffb45a", strength = 1, sc = 1): void {
    const a = (0.18 + 0.62 * k.night) * strength;
    if (a < 0.03 || k.quality === 0) return;
    const r = this.rimOf(key, base, color, sc);
    const pa = g.globalAlpha;
    const op = g.globalCompositeOperation;
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = pa * Math.min(1, a);
    g.drawImage(r, Math.round(x * sc) / sc - 12, Math.round(y * sc) / sc - 12, r.width / sc, r.height / sc);
    g.globalCompositeOperation = op;
    g.globalAlpha = pa;
  }

  // ---------------------------------------------------------------------------------------------
  // Marille (Münze)

  /** Traube (Münzvariante am Weinberg): Prop grape-bunch oder prozedural, 12 Wiegeframes */
  private buildGrapes(): HTMLCanvasElement {
    const S = WachauSkins.APRICOT;
    const props = this.props;
    const useProp = !!props && props.has("grape-bunch");
    return paint(S * 12, S, (g) => {
      for (let f = 0; f < 12; f += 1) {
        const ph = (f / 12) * TAU;
        g.save();
        g.beginPath();
        g.rect(f * S, 0, S, S);
        g.clip();
        g.translate(f * S + S / 2, 4);
        g.rotate(Math.sin(ph) * 0.18);
        if (useProp && props) props.draw(g, "grape-bunch", 0, 0, { h: S * 0.9, ax: 0.5, ay: 0.02 });
        else grapeBunch(g, 0, S * 0.3, S * 0.72, "#5a2a78", "#7a44a0", "rgba(255,255,255,0.6)");
        g.restore();
      }
    });
  }

  private buildApricots(): HTMLCanvasElement {
    const S = WachauSkins.APRICOT;
    const props = this.props;
    this.apricotFromProp = !!props && props.has("apricot");
    return paint(S * 12, S, (g) => {
      for (let f = 0; f < 12; f += 1) {
        const ph = (f / 12) * TAU;
        const rot = Math.sin(ph) * 0.22;
        const sq = 0.86 + 0.14 * Math.cos(ph);
        g.save();
        g.beginPath();
        g.rect(f * S, 0, S, S);
        g.clip();
        g.translate(f * S + S / 2, S / 2 + 2);
        g.rotate(rot);
        g.scale(sq, 1);
        if (this.apricotFromProp && props) {
          props.draw(g, "apricot", 0, 0, { h: S * 0.86, ax: 0.5, ay: 0.5 });
        } else {
          apricotShape(g, S * 0.36);
        }
        g.restore();
      }
    });
  }

  drawApricot(g: Ctx2D, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
    if (!this.apricotStrip) this.apricotStrip = this.buildApricots();
    if (!this.grapeStrip) this.grapeStrip = this.buildGrapes();
    const strip = e.skin === "grape" ? this.grapeStrip : this.apricotStrip;
    const S = WachauSkins.APRICOT;
    const f = Math.floor((v.time * 7 + e.id * 1.3) % 12);
    const cx = sx + e.w / 2;
    const cy = sy + e.h / 2 + (k.reduced ? 0 : Math.sin(v.time * 3 + e.id) * 2.5);
    if (k.quality > 0) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.28 + 0.3 * k.night;
      glowAt(g, this.glowWarm, cx, cy, 30);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    g.drawImage(strip, f * S, 0, S, S, Math.round(cx - S / 2), Math.round(cy - S / 2), S, S);
    // Glanzpunkt funkelt
    if (k.quality > 0 && !k.reduced) {
      const tw = Math.max(0, Math.sin(v.time * 4 + e.id * 2.1));
      if (tw > 0.6) {
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = (tw - 0.6) * 2;
        glowAt(g, this.glowWhite, cx - 7, cy - 8, 8);
        g.globalAlpha = 1;
        g.globalCompositeOperation = "source-over";
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Floß (sinkt beim Landen), Frachtfloß (höheres Deck), Zille (gleitet), Terrasse

  private raftSprite(w: number): HTMLCanvasElement {
    return paint(w + 24, 60, (g) => {
      const x0 = 12;
      const deck = 12;
      const r = mulberry(w);
      logRow(g, x0, deck, w, r);
      // Deck (Bohlen)
      const dg = g.createLinearGradient(0, deck - 2, 0, deck + 8);
      dg.addColorStop(0, "#f4d6a0");
      dg.addColorStop(1, "#b88a56");
      g.fillStyle = dg;
      g.beginPath();
      rr(g, x0 - 3, deck - 2, w + 6, 10, 4);
      g.fill();
      g.fillStyle = "rgba(90,60,30,0.5)";
      for (let x = x0 + 18; x < x0 + w - 6; x += 24) g.fillRect(x, deck - 1, 1.5, 8);
      g.fillStyle = "rgba(255,250,228,0.8)";
      g.fillRect(x0, deck - 1, w, 1.5);
      g.fillStyle = "#8a5e34";
      g.fillRect(x0 - 3, deck + 6, w + 6, 2);
      // Seilbünde über Deck und Stämme
      g.fillStyle = "#e0c890";
      const nb = Math.max(2, Math.round(w / 110));
      for (let i = 0; i < nb; i += 1) {
        const x = x0 + 16 + ((w - 36) * i) / Math.max(1, nb - 1);
        g.fillRect(x, deck - 3, 5, 30);
        g.fillStyle = "rgba(110,80,40,0.6)";
        for (let k = 0; k < 5; k += 1) g.fillRect(x, deck + k * 6, 5, 1.2);
        g.fillStyle = "#e0c890";
      }
    });
  }

  drawRaft(g: Ctx2D, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
    const w = Math.round(e.w);
    const key = `raft:${w}`;
    const crumbling = e.state === "crumbling";
    const fallen = e.state === "fallen";
    const u = crumbling ? Math.min(1, e.stateT / Math.max(0.1, e.p.crumble || 1)) : fallen ? 1 : 0;
    const shake = crumbling && !k.reduced ? Math.sin(e.stateT * 55) * 1.6 * u : 0;
    const dip = crumbling ? u * 3 : 0;
    const x = sx - 12 + shake;
    const y = sy - 12 + dip;
    const wy = k.waterY + (k.reduced ? 0 : Math.sin(v.time * 2.4 + sx * 0.02) * 1.5);
    // Schatten/Spiegelung
    g.fillStyle = withA(k.waterDeep, 0.35);
    g.beginPath();
    g.ellipse(sx + w / 2, wy + 10, w * 0.55, 7, 0, 0, TAU);
    g.fill();
    if (fallen) {
      g.save();
      g.beginPath();
      g.rect(sx - 30, -10, w + 60, wy + 10);
      g.clip();
    }
    const base = this.drawStaged(g, key, () => this.raftSprite(w), x, y, k);
    if (fallen) g.restore();
    // Fahne (animiert)
    if (!fallen) this.flag(g, sx + w - 6 + shake, y + 2, v, k);
    // Wasser über dem unteren Teil
    this.waterline(g, sx - 8, sx + w + 8, wy, y + 60, v, k, u);
    // Sinken: Wasser auf dem Deck + Blasen
    if (u > 0 && !fallen) {
      g.fillStyle = withA(k.water, 0.35 * u);
      g.fillRect(sx, sy + dip + 2, w, 6 * u);
      if (!k.reduced && k.quality > 0) {
        g.fillStyle = "rgba(235,248,255,0.8)";
        for (let i = 0; i < 5; i += 1) {
          const bx = sx + ((i * 53 + e.id * 17) % Math.max(10, w));
          const t = (v.time * 1.6 + i * 0.37) % 1;
          g.beginPath();
          g.arc(bx, wy - t * 10, 1.5 + (1 - t) * 1.5, 0, TAU);
          g.fill();
        }
      }
    }
    // Laterne/Rimlight nachts
    if (k.lights > 0.05 && !fallen) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = k.lights * 0.85;
      glowAt(g, this.glowWarm, sx + w - 16 + shake, y - 2, 18);
      g.globalAlpha = k.lights * 0.35;
      glowAt(g, this.softWarm, sx + w / 2, sy + 2, w * 0.55, 10);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    // Deckkante gut lesbar
    g.fillStyle = withA(k.rim, 0.35 + 0.35 * k.night);
    g.fillRect(sx + 2 + shake, y + 10, w - 4, 1.5);
    void base;
  }

  private flag(g: Ctx2D, x: number, y: number, v: ViewState, k: SkinCtx): void {
    const t = k.reduced ? 0 : v.time;
    g.fillStyle = "#4a3424";
    g.fillRect(x - 11, y - 20, 2, 22);
    for (let i = 0; i < 3; i += 1) {
      g.fillStyle = i === 1 ? "#f4f0ea" : "#c8202c";
      g.beginPath();
      const y0 = y - 20 + i * 4;
      g.moveTo(x - 9, y0);
      for (let s = 0; s <= 4; s += 1) {
        const fx = x - 9 + s * 4;
        g.lineTo(fx, y0 + Math.sin(t * 7 + s * 0.9) * 1.2 * (s / 4));
      }
      for (let s = 4; s >= 0; s -= 1) {
        const fx = x - 9 + s * 4;
        g.lineTo(fx, y0 + 4 + Math.sin(t * 7 + s * 0.9) * 1.2 * (s / 4));
      }
      g.closePath();
      g.fill();
    }
  }

  /** Wasserlinie mit Schaum + durchscheinendem Wasser über getauchten Teilen */
  private waterline(g: Ctx2D, x0: number, x1: number, wy: number, bottom: number, v: ViewState, k: SkinCtx, churn = 0): void {
    if (bottom > wy) {
      g.fillStyle = k.waterTint;
      g.fillRect(x0, wy, x1 - x0, bottom - wy);
    }
    const t = k.reduced ? 0 : v.time;
    g.strokeStyle = `rgba(240,250,255,${(0.55 + churn * 0.3).toFixed(3)})`;
    g.lineWidth = 2;
    g.beginPath();
    for (let x = x0; x <= x1; x += 8) {
      const y = wy + Math.sin(x * 0.12 + t * 5) * (1.2 + churn * 1.5);
      if (x === x0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    // Wellenringe an den Enden
    g.strokeStyle = "rgba(230,245,255,0.35)";
    g.lineWidth = 1.2;
    const ph = (t * 0.8) % 1;
    g.beginPath();
    g.ellipse(x0 + 4, wy + 3, 8 + ph * 16, 2 + ph * 2, 0, Math.PI * 0.5, Math.PI * 1.5);
    g.ellipse(x1 - 4, wy + 3, 8 + ph * 16, 2 + ph * 2, 0, -Math.PI * 0.5, Math.PI * 0.5);
    g.stroke();
  }

  private cargoSprite(w: number, stackH: number): HTMLCanvasElement {
    const H = stackH + 60;
    return paint(w + 24, H, (g) => {
      const x0 = 12;
      const raftTop = stackH + 12;
      const r = mulberry(w * 7 + stackH);
      // Floß unten
      logRow(g, x0, raftTop, w, r);
      g.fillStyle = "#e8c690";
      g.beginPath();
      rr(g, x0 - 4, raftTop - 2, w + 8, 7, 3);
      g.fill();
      // Ladung: Weinkisten-Stapel oder liegende Fässer unter Bohlen (obere Kante = Lauffläche)
      const casks = Math.round(w / 10) % 2 === 1;
      const rows = Math.max(1, Math.round(stackH / (casks ? 34 : 30)));
      const rh = stackH / rows;
      for (let row = 0; row < rows; row += 1) {
        const y = raftTop - (row + 1) * rh;
        if (casks) {
          const d = Math.min(rh, 40);
          const n = Math.max(1, Math.floor(w / (d * 1.02)));
          const off = (w - n * d) / 2 + (row % 2) * d * 0.25;
          for (let i = 0; i < n; i += 1) {
            const cx = x0 + off + i * d + d / 2;
            if (cx + d / 2 > x0 + w + 2) continue;
            const cy = y + rh - d / 2;
            const grd = g.createRadialGradient(cx - d * 0.15, cy - d * 0.15, 1, cx, cy, d / 2);
            grd.addColorStop(0, "#c8905a");
            grd.addColorStop(1, "#6a4222");
            g.fillStyle = grd;
            g.beginPath();
            g.arc(cx, cy, d / 2 - 1, 0, TAU);
            g.fill();
            g.strokeStyle = "#3a3a40";
            g.lineWidth = 3;
            g.beginPath();
            g.arc(cx, cy, d / 2 - 2.5, 0, TAU);
            g.stroke();
            g.strokeStyle = "rgba(60,30,10,0.45)";
            g.lineWidth = 1;
            g.beginPath();
            g.moveTo(cx - d * 0.3, cy);
            g.lineTo(cx + d * 0.3, cy);
            g.moveTo(cx, cy - d * 0.3);
            g.lineTo(cx, cy + d * 0.3);
            g.stroke();
          }
          // Zwischenbohle
          g.fillStyle = "#b88a56";
          g.fillRect(x0 - 2, y - 2, w + 4, 4);
        } else {
          const n = Math.max(1, Math.round(w / 52));
          const cw = w / n;
          for (let i = 0; i < n; i += 1) {
            const cx = x0 + i * cw;
            crateBox(g, cx + 1, y + 1, cw - 2, rh - 1, r);
          }
        }
      }
      // Deckbrett oben (klare Kante)
      g.fillStyle = "#f0d49e";
      g.beginPath();
      rr(g, x0 - 3, 10, w + 6, 8, 3);
      g.fill();
      g.fillStyle = "#a07040";
      g.fillRect(x0 - 3, 16, w + 6, 2);
      // Seil über die Ladung
      g.strokeStyle = "#d8c08a";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x0 + 6, raftTop);
      g.lineTo(x0 + w * 0.3, 16);
      g.moveTo(x0 + w - 6, raftTop);
      g.lineTo(x0 + w * 0.7, 16);
      g.stroke();
    });
  }

  drawCargo(g: Ctx2D, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
    const w = Math.round(e.w);
    const stackH = Math.max(24, Math.round((k.waterY - 20 - e.p.by) / 6) * 6);
    const key = `cargo:${w}:${stackH}`;
    const x = sx - 12;
    const y = sy - 10;
    const wy = k.waterY + (k.reduced ? 0 : Math.sin(v.time * 2.2 + sx * 0.02) * 1.5);
    g.fillStyle = withA(k.waterDeep, 0.35);
    g.beginPath();
    g.ellipse(sx + w / 2, wy + 10, w * 0.6, 8, 0, 0, TAU);
    g.fill();
    this.drawStaged(g, key, () => this.cargoSprite(w, stackH), x, y, k);
    this.waterline(g, sx - 14, sx + w + 14, wy, y + stackH + 60, v, k);
    if (k.lights > 0.05) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = k.lights * 0.9;
      glowAt(g, this.glowWarm, sx + 10, sy - 6, 16);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    g.fillStyle = withA(k.rim, 0.35 + 0.4 * k.night);
    g.fillRect(sx + 1, y + 10, w - 2, 1.5);
  }

  private boatSprite(w: number): HTMLCanvasElement {
    return paint(w + 60, 70, (g) => {
      const x0 = 20;
      const deck = 14;
      // Rumpf (Zille: flach, geteerter Rumpf, hochgezogener Bug rechts)
      const grd = g.createLinearGradient(0, deck, 0, deck + 40);
      grd.addColorStop(0, "#5a3a26");
      grd.addColorStop(1, "#22160e");
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(x0 - 4, deck);
      g.lineTo(x0 + w, deck);
      g.quadraticCurveTo(x0 + w + 26, deck - 4, x0 + w + 34, deck - 16);
      g.quadraticCurveTo(x0 + w + 22, deck + 30, x0 + w - 20, deck + 36);
      g.lineTo(x0 + 6, deck + 36);
      g.quadraticCurveTo(x0 - 6, deck + 26, x0 - 4, deck);
      g.closePath();
      g.fill();
      // Plankenlinien
      g.strokeStyle = "rgba(160,110,70,0.45)";
      g.lineWidth = 1.2;
      g.beginPath();
      for (let i = 1; i < 4; i += 1) {
        g.moveTo(x0, deck + i * 8);
        g.quadraticCurveTo(x0 + w * 0.7, deck + i * 8 + 1, x0 + w + 20 - i * 6, deck - 6 + i * 9);
      }
      g.stroke();
      // Dollbord (Lauffläche)
      g.fillStyle = "#d8aa6a";
      g.beginPath();
      g.moveTo(x0 - 5, deck - 2);
      g.lineTo(x0 + w, deck - 2);
      g.quadraticCurveTo(x0 + w + 26, deck - 6, x0 + w + 34, deck - 18);
      g.lineTo(x0 + w + 34, deck - 13);
      g.quadraticCurveTo(x0 + w + 24, deck + 2, x0 + w, deck + 4);
      g.lineTo(x0 - 5, deck + 4);
      g.closePath();
      g.fill();
      g.fillStyle = "rgba(255,240,210,0.7)";
      g.fillRect(x0 - 3, deck - 1, w, 1.5);
      // Ruderpinne + Seilrolle
      g.fillStyle = "#6a4a30";
      g.fillRect(x0 - 16, deck - 6, 22, 4);
      g.fillStyle = "#cdb07a";
      g.beginPath();
      g.ellipse(x0 + w * 0.7, deck - 4, 9, 4, 0, 0, TAU);
      g.fill();
      g.strokeStyle = "#9a8050";
      g.lineWidth = 1;
      g.beginPath();
      g.ellipse(x0 + w * 0.7, deck - 4, 5, 2, 0, 0, TAU);
      g.stroke();
    });
  }

  drawBoat(g: Ctx2D, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
    const w = Math.round(e.w);
    const key = `boat:${w}`;
    const wy = k.waterY + (k.reduced ? 0 : Math.sin(v.time * 2 + sx * 0.02) * 1.5);
    // Kielwasser je nach Gleitrichtung
    const per = e.p.per || 3;
    const vel = e.p.ampX ? Math.cos((e.age * TAU) / per + (e.p.ph || 0)) : 0;
    if (Math.abs(vel) > 0.15 && !k.reduced) {
      g.strokeStyle = `rgba(240,250,255,${(0.35 * Math.abs(vel)).toFixed(3)})`;
      g.lineWidth = 1.5;
      const back = vel > 0 ? sx - 10 : sx + w + 30;
      const dir = vel > 0 ? -1 : 1;
      g.beginPath();
      for (let i = 0; i < 3; i += 1) {
        const ox = back + dir * i * 16;
        g.moveTo(ox, wy + 2 + i * 1.5);
        g.lineTo(ox + dir * 14, wy + 5 + i * 2.5);
      }
      g.stroke();
    }
    g.fillStyle = withA(k.waterDeep, 0.35);
    g.beginPath();
    g.ellipse(sx + w / 2 + 10, wy + 10, w * 0.62, 8, 0, 0, TAU);
    g.fill();
    this.drawStaged(g, key, () => this.boatSprite(w), sx - 20, sy - 14, k);
    this.waterline(g, sx - 16, sx + w + 30, wy, sy + 56, v, k);
    if (k.lights > 0.05) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = k.lights * 0.9;
      glowAt(g, this.glowWarm, sx + w + 10, sy - 22, 18);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
      g.fillStyle = "#3a2a1a";
      g.fillRect(sx + w + 9, sy - 18, 2, 16);
    }
    g.fillStyle = withA(k.rim, 0.35 + 0.4 * k.night);
    g.fillRect(sx - 3, sy - 1, w + 2, 1.5);
  }

  private terraceSprite(w: number): HTMLCanvasElement {
    return paint(w + 20, 70, (g) => {
      const x0 = 10;
      const r = mulberry(w * 3);
      // Mauerkörper (warm, kräftig) mit Unterschatten
      stoneWall(g, x0, 8, w, 26, r, 0.85);
      const sh = g.createLinearGradient(0, 8, 0, 34);
      sh.addColorStop(0, "rgba(255,236,200,0.12)");
      sh.addColorStop(1, "rgba(30,18,8,0.55)");
      g.fillStyle = sh;
      g.fillRect(x0, 8, w, 26);
      g.fillStyle = "rgba(20,12,6,0.55)";
      g.fillRect(x0, 33, w, 3);
      // Deckplatten + saftiges Gras (klare Lauffläche)
      const top = g.createLinearGradient(0, 0, 0, 10);
      top.addColorStop(0, "#e8d8b4");
      top.addColorStop(1, "#b8a07a");
      g.fillStyle = top;
      g.beginPath();
      rr(g, x0 - 4, 1, w + 8, 9, 3);
      g.fill();
      g.fillStyle = "#7e9236";
      g.fillRect(x0 - 2, 0, w + 4, 3);
      g.strokeStyle = "#95a83e";
      g.lineWidth = 1.5;
      g.beginPath();
      for (let x = x0 - 2; x < x0 + w + 2; x += 3) {
        g.moveTo(x, 2);
        g.lineTo(x + (r() - 0.5) * 3, -2 - r() * 5);
      }
      g.stroke();
      // Rebzeile auf der Terrasse (klein, dahinter) + Weinlaub über die Kante
      for (let x = x0 + 8; x < x0 + w - 4; x += 16 + r() * 10) {
        const c = r();
        grapeLeaf(g, x, 36 + r() * 12, 8 + r() * 4, r() * TAU, c < 0.4 ? "#d4942e" : c < 0.7 ? "#b8502c" : "#94a038", "rgba(50,30,10,0.35)");
      }
      if (w > 120) grapeBunch(g, x0 + w * 0.62, 40, 20, "#4a2660", "#643a82", "rgba(255,255,255,0.5)");
    });
  }

  drawTerrace(g: Ctx2D, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
    const w = Math.round(e.w);
    // Stützen (schlank, dunkel – klar Hintergrund)
    g.fillStyle = withA("#3a2c22", 0.85);
    const gy = k.groundY;
    for (const px of [sx + 14, sx + w - 18]) {
      g.fillRect(px, sy + 34, 5, Math.max(0, gy - sy - 34));
    }
    g.fillStyle = "rgba(0,0,0,0.18)";
    g.beginPath();
    g.ellipse(sx + w / 2, gy + 4, w * 0.45, 5, 0, 0, TAU);
    g.fill();
    this.drawStaged(g, `terrace:${w}`, () => this.terraceSprite(w), sx - 10, sy - 1, k);
    g.fillStyle = withA(k.rim, 0.45 + 0.35 * k.night);
    g.fillRect(sx - 2, sy, w + 4, 1.5);
    void v;
  }

  // ---------------------------------------------------------------------------------------------
  // Rollendes Weinfass (walker)

  private barrelHead(d: number): HTMLCanvasElement {
    return paint(d, d, (g) => {
      const r = d / 2;
      g.translate(r, r);
      // Deckel (Dauben)
      g.save();
      g.beginPath();
      g.arc(0, 0, r - 5, 0, TAU);
      g.clip();
      const n = 6;
      for (let i = 0; i < n; i += 1) {
        const x = -r + (i / n) * d;
        g.fillStyle = i % 2 ? "#a86c38" : "#b87a42";
        g.fillRect(x, -r, d / n + 0.5, d);
        g.fillStyle = "rgba(60,30,10,0.4)";
        g.fillRect(x, -r, 1.2, d);
      }
      // Weinbrand-Stempel (Traube)
      g.fillStyle = "rgba(80,30,20,0.55)";
      for (let i = 0; i < 6; i += 1) {
        const row = i < 3 ? 0 : i < 5 ? 1 : 2;
        const col = i < 3 ? i - 1 : i < 5 ? i - 3.5 : 0;
        g.beginPath();
        g.arc(col * r * 0.2, -r * 0.1 + row * r * 0.18, r * 0.09, 0, TAU);
        g.fill();
      }
      g.fillRect(-1, -r * 0.3, 2, r * 0.14);
      // Spund
      g.fillStyle = "#5a3418";
      g.beginPath();
      g.arc(0, r * 0.55, r * 0.09, 0, TAU);
      g.fill();
      g.restore();
      // Eisenreifen
      g.strokeStyle = "#3a3a3e";
      g.lineWidth = 6;
      g.beginPath();
      g.arc(0, 0, r - 3.5, 0, TAU);
      g.stroke();
      g.strokeStyle = "rgba(200,200,210,0.55)";
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(0, 0, r - 5.5, -2.4, -0.9);
      g.stroke();
      // Nieten
      g.fillStyle = "#9a9aa4";
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * TAU;
        g.beginPath();
        g.arc(Math.cos(a) * (r - 3.5), Math.sin(a) * (r - 3.5), 1.3, 0, TAU);
        g.fill();
      }
    });
  }

  private barrelShade(d: number): HTMLCanvasElement {
    return paint(d, d, (g) => {
      const r = d / 2;
      const grd = g.createRadialGradient(r * 0.7, r * 0.6, r * 0.1, r, r, r);
      grd.addColorStop(0, "rgba(255,240,210,0.28)");
      grd.addColorStop(0.55, "rgba(255,240,210,0)");
      grd.addColorStop(0.8, "rgba(20,10,5,0.12)");
      grd.addColorStop(1, "rgba(20,10,5,0.4)");
      g.fillStyle = grd;
      g.beginPath();
      g.arc(r, r, r, 0, TAU);
      g.fill();
    });
  }

  /** Fasskörper (Dauben + Reifen) schräg nach hinten oben; Deckel wird separat (rotierend) davor gezeichnet */
  private barrelBody(d: number): HTMLCanvasElement {
    const r = d / 2;
    const ox = Math.round(d * 0.46);
    const oy = Math.round(d * 0.3);
    return paint(d + ox + 4, d + oy + 4, (g) => {
      const fx = 2 + r;
      const fy = 2 + oy + r;
      const bx = fx + ox;
      const by = fy - oy;
      const len = Math.hypot(ox, oy);
      const nx = oy / len;
      const ny = ox / len;
      // Mantel (Silhouette: Rückdeckel + Verbindungsband)
      const body = g.createLinearGradient(fx - r * ny, fy - r * nx, fx + r * ny, fy + r * nx);
      body.addColorStop(0, "#c8884a");
      body.addColorStop(0.45, "#9a6232");
      body.addColorStop(1, "#5a3618");
      g.fillStyle = body;
      g.beginPath();
      g.arc(bx, by, r * 0.96, 0, TAU);
      g.fill();
      g.beginPath();
      g.moveTo(fx - nx * r, fy - ny * r);
      g.lineTo(bx - nx * r * 0.96, by - ny * r * 0.96);
      g.lineTo(bx + nx * r * 0.96, by + ny * r * 0.96);
      g.lineTo(fx + nx * r, fy + ny * r);
      g.closePath();
      g.fill();
      // Dauben-Fugen (vom vorderen zum hinteren Rand, sichtbare Oberseite)
      g.strokeStyle = "rgba(50,26,10,0.5)";
      g.lineWidth = 1.2;
      g.beginPath();
      for (let i = 0; i < 9; i += 1) {
        const a = -Math.PI * 0.95 + (i / 8) * Math.PI * 1.25;
        const cx0 = fx + Math.cos(a) * r;
        const cy0 = fy + Math.sin(a) * r;
        g.moveTo(cx0, cy0);
        g.quadraticCurveTo(cx0 + ox * 0.5 + Math.cos(a) * 2, cy0 - oy * 0.5 + Math.sin(a) * 2, cx0 + ox * 0.96, cy0 - oy * 0.96);
      }
      g.stroke();
      // Eisenreifen
      for (const t of [0.22, 0.78]) {
        const hx = fx + ox * t;
        const hy = fy - oy * t;
        g.strokeStyle = "#34343a";
        g.lineWidth = 4.5;
        g.beginPath();
        g.arc(hx, hy, r * (1.01 + 0.03 * Math.sin(t * Math.PI)), -Math.PI * 1.05, Math.PI * 0.35);
        g.stroke();
        g.strokeStyle = "rgba(210,210,220,0.5)";
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(hx, hy, r * 1.01 - 1.5, -Math.PI * 0.95, -Math.PI * 0.55);
        g.stroke();
      }
      // Glanz auf dem Bauch
      g.strokeStyle = "rgba(255,230,190,0.35)";
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(fx - r * 0.35, fy - r * 0.9);
      g.lineTo(bx - r * 0.35, by - r * 0.9);
      g.stroke();
      // Vorderer Rand (dunkel, der Deckel liegt darin)
      g.fillStyle = "#3a3a40";
      g.beginPath();
      g.arc(fx, fy, r, 0, TAU);
      g.fill();
    });
  }

  drawBarrel(g: Ctx2D, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
    const d = Math.round(Math.min(e.w, e.h) / 2) * 2;
    const r = d / 2;
    const cx = sx + e.w / 2;
    const gy = k.groundY;
    const sunk = e.state === "sunk";
    let cy = sy + e.h - r;
    if (sunk) cy = k.waterY + 4 + (k.reduced ? 0 : Math.sin(v.time * 2.5 + e.id) * 2);
    const key = `barrel:${d}`;
    const head = this.cache.get(key, () => this.barrelHead(d));
    const shade = this.cache.get(`${key}|sh`, () => this.barrelShade(d));
    const oy = Math.round(d * 0.3);
    const bodyX = cx - r - 2;
    const bodyY = cy - r - oy - 2;
    const air = gy - (sy + e.h);
    // Bodenschatten (wächst beim Herabfallen)
    if (!sunk) {
      const sk = Math.max(0.25, 1 - air / 500);
      g.fillStyle = `rgba(0,0,0,${(0.3 * sk).toFixed(3)})`;
      g.beginPath();
      g.ellipse(cx + r * 0.25, gy + 5, r * 1.3 * sk, 6 * sk, 0, 0, TAU);
      g.fill();
    }
    // Aufprall (Terrassen-Fass): Staubwolke
    if (e.p.tumble && air < 2 && !e.fx.thudT) e.fx.thudT = v.time;
    if (e.fx.thudT && !sunk) {
      const u = (v.time - e.fx.thudT) / 0.5;
      if (u >= 0 && u < 1) {
        g.fillStyle = `rgba(220,196,150,${(0.55 * (1 - u)).toFixed(3)})`;
        for (let i = 0; i < 6; i += 1) {
          const a = Math.PI + (i / 5) * Math.PI;
          const rr0 = 6 + u * 26;
          g.beginPath();
          g.arc(cx + Math.cos(a) * (r + u * 40), gy - 4 + Math.sin(a) * u * 22, rr0, 0, TAU);
          g.fill();
        }
      }
    }
    // Staub hinter dem Fass
    if (!sunk && air < 4 && k.quality > 0 && !k.reduced) {
      for (let i = 0; i < 4; i += 1) {
        const t = (v.time * 2.6 + i * 0.25 + e.id * 0.13) % 1;
        g.fillStyle = `rgba(214,190,150,${(0.35 * (1 - t)).toFixed(3)})`;
        g.beginPath();
        g.arc(cx + r * 0.9 + t * 46, gy - 4 - t * 14, 4 + t * 9, 0, TAU);
        g.fill();
      }
    }
    if (sunk) {
      g.save();
      g.beginPath();
      g.rect(cx - r - 10, cy - r - oy - 10, d + oy + 40, k.waterY - (cy - r - oy - 10) + 2);
      g.clip();
    }
    // Rimlight (Gefahr) + Körper
    const body = this.drawStaged(g, `${key}|b`, () => this.barrelBody(d), bodyX, bodyY, k);
    this.rim(g, `${key}|b`, body, bodyX, bodyY, k, "#ffae4a", 1.1);
    const ang = sunk ? Math.sin(v.time * 1.3 + e.id) * 0.3 : e.x / r;
    g.save();
    g.translate(cx, cy);
    g.rotate(ang);
    g.drawImage(head, -r, -r);
    g.restore();
    g.drawImage(shade, Math.round(cx - r), Math.round(cy - r));
    // Nacht-Tönung des Deckels
    if (k.night > 0.05) {
      g.fillStyle = `rgba(20,26,60,${(0.36 * k.night).toFixed(3)})`;
      g.beginPath();
      g.arc(cx, cy, r - 1, 0, TAU);
      g.fill();
    }
    if (sunk) {
      g.restore();
      this.waterline(g, cx - r - 8, cx + r + oy + 20, k.waterY, k.waterY, v, k, 0.5);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Bienenschwarm (flyer)

  drawBees(g: Ctx2D, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
    const cx = sx + e.w / 2;
    const cy = sy + e.h / 2;
    const t = v.time + e.id * 0.7;
    // Warn-Aura
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.35 + 0.35 * k.night;
    glowAt(g, this.glowGold, cx, cy, e.w * 0.75, e.h * 0.8);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    const props = this.props;
    const drawn = !!props && props.has("bee-swarm") && props.draw(g, "bee-swarm", cx, cy + 2, { h: e.h * 1.15, t: k.reduced ? 0 : t, ax: 0.5, ay: 0.5 });
    const n = drawn ? (k.quality === 2 ? 5 : 3) : 9;
    // Einzelbienen umkreisen den Schwarm
    for (let i = 0; i < n; i += 1) {
      const a = t * (2.2 + (i % 3) * 0.6) + i * 1.9;
      const bx = cx + Math.cos(a) * e.w * (drawn ? 0.52 : 0.36);
      const by = cy + Math.sin(a * 1.3) * e.h * (drawn ? 0.45 : 0.32);
      bee(g, bx, by, drawn ? 5 : 7, t * 40 + i, Math.cos(a) > 0);
    }
    if (k.night > 0.3) {
      g.fillStyle = `rgba(20,26,60,${(0.25 * k.night).toFixed(3)})`;
      g.beginPath();
      g.ellipse(cx, cy, e.w * 0.45, e.h * 0.42, 0, 0, TAU);
      g.fill();
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Blöcke: Weinkiste (zerbrechlich), Kistenstapel, Trockensteinmauer, stehendes Fass

  /**
   * Hindernis-Prop als Bodenblock: Silhouette in die Hitbox eingepasst (Unterkante 2 px im Boden), in Stufen-Tönung,
   * mit Rimlight. false = Prop nicht geladen → prozeduraler Fallback.
   */
  private propBlock(g: Ctx2D, id: string, e: Ent, sx: number, sy: number, k: SkinCtx, lim: readonly [number, number], rim: string, rimK: number): boolean {
    const props = this.props;
    const asp = propAspect(props, id);
    if (!props || asp === null) return false;
    const f = fitBox(asp, e.w, e.h, lim[0], lim[1]);
    const w = quant(f.w);
    const h = quant(f.h);
    const key = `${id}:${w}:${h}`;
    const x = sx + (e.w - w) / 2;
    const y = sy + e.h + 2 - h;
    const base = this.drawStaged(g, key, () => bakeProp(props, id, w, h, this.pk), x, y, k, 1, this.pk);
    this.rim(g, key, base, x, y, k, rim, rimK, this.pk);
    return true;
  }

  private crateSprite(w: number, h: number, stack: number): HTMLCanvasElement {
    const props = this.props;
    const useProp = !!props && props.has("crate-wine");
    return paint(w + 16, h + 16, (g) => {
      const r = mulberry(w * 13 + h);
      // Stapel: obere Kisten überdecken die Flaschenhälse der unteren (kein Luftspalt)
      const overlap = 0.64;
      const each = h / (1 + overlap * (stack - 1));
      for (let i = 0; i < stack; i += 1) {
        const bottom = h + 8 - i * each * overlap;
        const off = i % 2 ? -w * 0.06 : 0;
        if (useProp && props) {
          props.draw(g, "crate-wine", 8 + w / 2 + off, bottom + 1, { h: each * 1.08, ax: 0.5, ay: 0.9856 });
        } else {
          const bh = each * 0.72;
          for (let b = 0; b < 3; b += 1) {
            const bx = 8 + off + w * (0.25 + b * 0.25);
            g.fillStyle = b === 1 ? "#2f5a2a" : "#4a2a1a";
            g.fillRect(bx - 3, bottom - bh - 16, 6, 18);
            g.fillStyle = b === 1 ? "#e0b040" : "#a02a2a";
            g.fillRect(bx - 2, bottom - bh - 20, 4, 5);
          }
          crateBox(g, 8 + off, bottom - bh, w, bh, r);
        }
      }
    });
  }

  drawCrate(g: Ctx2D, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx, stack = 1): void {
    const w = Math.round(e.w);
    const h = Math.round(e.h);
    const key = `crate:${w}:${h}:${stack}`;
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.beginPath();
    g.ellipse(sx + w / 2, sy + h + 3, w * 0.55, 5, 0, 0, TAU);
    g.fill();
    if (!(stack === 2 && this.propBlock(g, "wachau-crates", e, sx, sy, k, [0.7, 1.35], "#ffc46a", 0.7))) {
      const base = this.drawStaged(g, key, () => this.crateSprite(w, h, stack), sx - 8, sy - 8, k);
      this.rim(g, key, base, sx - 8, sy - 8, k, "#ffc46a", 0.7);
    }
    // Zerbrechlich: Glitzern
    if (e.breakable) {
      const tw = k.reduced ? 0.6 : 0.5 + 0.5 * Math.sin(v.time * 5 + e.id);
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.3 + 0.4 * tw;
      glowAt(g, this.glowWhite, sx + w * 0.82, sy + 6, 10);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
  }

  private wallSprite(w: number, h: number): HTMLCanvasElement {
    return paint(w + 20, h + 26, (g) => {
      const x0 = 10;
      const top = 18;
      const r = mulberry(w * 31 + h * 7);
      stoneWall(g, x0, top, w, h, r, 1);
      const sh = g.createLinearGradient(0, top, 0, top + h);
      sh.addColorStop(0, "rgba(255,240,210,0.12)");
      sh.addColorStop(1, "rgba(20,14,8,0.4)");
      g.fillStyle = sh;
      g.fillRect(x0, top, w, h);
      // Seitenkanten
      g.fillStyle = "rgba(30,20,10,0.35)";
      g.fillRect(x0 + w - 5, top, 5, h);
      g.fillStyle = "rgba(255,240,220,0.18)";
      g.fillRect(x0, top, 3, h);
      // Deckplatten
      g.fillStyle = "#b8a88a";
      g.beginPath();
      rr(g, x0 - 3, top - 5, w + 6, 8, 3);
      g.fill();
      g.fillStyle = "rgba(255,248,230,0.45)";
      g.fillRect(x0 - 1, top - 4, w + 2, 1.5);
      // Gras & Blumen oben
      g.strokeStyle = "#7a8a38";
      g.lineWidth = 1.4;
      g.beginPath();
      for (let x = x0; x < x0 + w; x += 3) {
        g.moveTo(x, top - 3);
        g.lineTo(x + (r() - 0.5) * 4, top - 6 - r() * 8);
      }
      g.stroke();
      for (let i = 0; i < Math.max(2, w / 30); i += 1) {
        g.fillStyle = r() < 0.5 ? "#f2e6c8" : "#e0a030";
        g.beginPath();
        g.arc(x0 + r() * w, top - 8 - r() * 5, 2.2, 0, TAU);
        g.fill();
      }
      // Moos + Ranke
      for (let i = 0; i < 4; i += 1) {
        g.fillStyle = "rgba(90,120,50,0.8)";
        g.beginPath();
        g.arc(x0 + r() * w, top + r() * h, 3 + r() * 3, 0, TAU);
        g.fill();
      }
      const vx = x0 + w * (0.2 + r() * 0.5);
      for (let y = top; y < top + h * 0.7; y += 9) {
        grapeLeaf(g, vx + Math.sin(y * 0.2) * 6, y, 6, r() * TAU, r() < 0.5 ? "#c9822e" : "#8a9434", null);
      }
    });
  }

  drawWall(g: Ctx2D, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
    const w = Math.round(e.w);
    const h = Math.round(e.h);
    if (this.propBlock(g, "wachau-wall", e, sx, sy, k, [0.7, 1.5], "#ffc890", 0.6)) return;
    const key = `wall:${w}:${h}`;
    const base = this.drawStaged(g, key, () => this.wallSprite(w, h), sx - 10, sy - 18, k);
    this.rim(g, key, base, sx - 10, sy - 18, k, "#ffc890", 0.6);
    void v;
  }

  private caskSprite(w: number, h: number): HTMLCanvasElement {
    const props = this.props;
    return paint(w + 16, h + 12, (g) => {
      if (props && props.has("wine-barrel")) {
        props.draw(g, "wine-barrel", 8 + w / 2, h + 10, { h: h * 1.04, ax: 0.5, ay: 0.9868 });
        return;
      }
      const grd = g.createLinearGradient(8, 0, 8 + w, 0);
      grd.addColorStop(0, "#6a4222");
      grd.addColorStop(0.4, "#b07840");
      grd.addColorStop(1, "#5a3a1e");
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(8 + w * 0.1, 8);
      g.quadraticCurveTo(8 - w * 0.05, 8 + h / 2, 8 + w * 0.1, 8 + h);
      g.lineTo(8 + w * 0.9, 8 + h);
      g.quadraticCurveTo(8 + w * 1.05, 8 + h / 2, 8 + w * 0.9, 8);
      g.closePath();
      g.fill();
      g.fillStyle = "#3a3a40";
      for (const f of [0.15, 0.32, 0.68, 0.85]) g.fillRect(8 + w * 0.02, 8 + h * f, w * 0.96, 5);
    });
  }

  drawCask(g: Ctx2D, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
    const w = Math.round(e.w);
    const h = Math.round(e.h);
    const key = `cask:${w}:${h}`;
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.beginPath();
    g.ellipse(sx + w / 2, sy + h + 3, w * 0.55, 5, 0, 0, TAU);
    g.fill();
    if (this.propBlock(g, "wachau-cask", e, sx, sy, k, [0.75, 1.35], "#ffb45a", 0.8)) return;
    const base = this.drawStaged(g, key, () => this.caskSprite(w, h), sx - 8, sy - 2, k);
    this.rim(g, key, base, sx - 8, sy - 2, k, "#ffb45a", 0.8);
    void v;
  }

  // ---------------------------------------------------------------------------------------------
  // Überhänge: Marillenast, Weinlaube (rutschen)

  private branchFoliage(w: number, depth: number, vines: boolean): HTMLCanvasElement {
    return paint(w + 60, depth + 12, (g) => {
      const x0 = 30;
      const r = mulberry(w * 17 + (vines ? 5 : 0));
      if (vines) {
        // Querbalken der Laube
        g.fillStyle = "#5a4230";
        g.fillRect(x0 - 26, depth - 70, w + 52, 10);
        g.fillStyle = "rgba(255,230,190,0.25)";
        g.fillRect(x0 - 26, depth - 70, w + 52, 2);
        for (let x = x0 - 20; x < x0 + w + 20; x += 44) {
          g.fillStyle = "#4a3424";
          g.fillRect(x, 0, 6, depth - 64);
        }
      }
      // Laub-Masse (unten dicht, Unterkante = Gefahrenlinie)
      const lower = depth - 4;
      // dunkler Kronenkörper aus runden Laubbüscheln → organische Oberkante, glatte Gefahrenlinie unten
      g.save();
      g.beginPath();
      g.rect(0, 0, w + 60, lower);
      g.clip();
      const nc = Math.max(2, Math.round(w / 72));
      const clumps: Array<[number, number, number, number]> = [];
      for (let i = 0; i < nc; i += 1) {
        const cxC = x0 + ((i + 0.5) / nc) * w + (r() - 0.5) * 12;
        const rxC = (w / nc) * (0.72 + r() * 0.12);
        const ryC = vines ? 40 : 46 + r() * 14;
        const cyC = lower - ryC * 0.72 - (i % 2) * 10;
        clumps.push([cxC, cyC, rxC, ryC]);
        g.fillStyle = vines ? "#5a5626" : "#3f5424";
        g.beginPath();
        g.ellipse(cxC, cyC, rxC, ryC, 0, 0, TAU);
        g.fill();
        g.fillStyle = vines ? "#6a6428" : "#4c6228";
        g.beginPath();
        g.ellipse(cxC - rxC * 0.15, cyC - ryC * 0.25, rxC * 0.7, ryC * 0.62, 0, 0, TAU);
        g.fill();
      }
      if (vines) {
        g.fillStyle = "#5a5626";
        g.fillRect(x0 - 10, depth - 66, w + 20, lower - (depth - 66));
      }
      g.restore();
      for (let pass = 0; pass < 2; pass += 1) {
        const n = Math.floor(w / (pass ? 5 : 8)) + 10;
        for (let i = 0; i < n; i += 1) {
          const cl = clumps[Math.floor(r() * clumps.length)];
          const a = r() * TAU;
          const rad = Math.sqrt(r()) * (pass ? 1 : 0.8);
          const x = cl[0] + Math.cos(a) * cl[2] * rad;
          const yy = pass ? Math.max(cl[1] - cl[3] * 0.9, lower - 12 - r() * 34) : cl[1] + Math.sin(a) * cl[3] * rad;
          const c = r();
          const col = vines
            ? c < 0.35
              ? "#8a9636"
              : c < 0.6
                ? "#c98a2e"
                : c < 0.8
                  ? "#a8482c"
                  : "#6f8430"
            : c < 0.45
              ? "#5f7a30"
              : c < 0.7
                ? "#7a8e36"
                : c < 0.85
                  ? "#b0a03a"
                  : "#c87a2c";
          grapeLeaf(g, x, Math.min(yy, lower - 10), (vines ? 11 : 9) + r() * 6, r() * TAU, col, "rgba(40,30,10,0.3)");
        }
      }
      // Früchte
      if (vines) {
        for (let x = x0 + 18; x < x0 + w - 10; x += 46 + r() * 20) {
          const purple = r() < 0.65;
          grapeBunch(g, x, lower - 26, 26, purple ? "#4a2660" : "#b4b43a", purple ? "#643a82" : "#d0cc54", "rgba(255,255,255,0.55)");
        }
      } else {
        for (let i = 0; i < w / 16; i += 1) {
          const fx = x0 + 8 + r() * (w - 16);
          const fy = lower - 16 - r() * depth * 0.4;
          g.save();
          g.translate(fx, fy);
          apricotShape(g, 6.5);
          g.restore();
        }
      }
      // Unterkante: klare, warme Linie (Lesbarkeit)
      g.fillStyle = "rgba(255,226,160,0.5)";
      for (let x = x0; x < x0 + w; x += 6) g.fillRect(x, lower - 5 + Math.sin(x * 0.3) * 1.5, 5, 2);
    });
  }

  /**
   * Überhang aus dem Prop (wachau-branch = Marillenzweig, wachau-vines = Weinranken): Breite = Hitbox-Breite, Unterkante auf der
   * Hitbox-Unterkante. Nach oben verankern wir prozedural: der Zweig bekommt seinen abgeschnittenen Ast (gezogener Streifen des
   * Bildes, in Ast-Richtung), die Ranken hängen an einer Laube (Querbalken + zwei Pfosten bis zum Bildrand).
   */
  private drawHangingProp(g: Ctx2D, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx, vines: boolean): boolean {
    const props = this.props;
    const id = vines ? "wachau-vines" : "wachau-branch";
    const asp = propAspect(props, id);
    if (!props || asp === null) return false;
    const w = Math.round(e.w);
    const h = Math.round(w * asp);
    // Hitbox-Unterkante = bottom − 4; die Ranken hängen etwas tiefer (Trauben statt Ranken-Spitzen decken die Hitbox)
    const bottom = sy + e.h - 3 + (vines ? 8 : 0);
    const top = bottom - h;
    const sway = k.reduced ? 0 : Math.sin(v.time * 1.3 + e.id) * 1.5;
    const x = sx + sway;
    const kx = propScale(props, id, w);
    const cell = props.cell(id);
    if (vines) {
      // Laube: zwei Pfosten von oben und ein Querbalken, über dem das Blattwerk hängt
      const night = k.night;
      const beamY = top - 4;
      const beamH = Math.max(20, 60 * kx);
      const pw = 17;
      for (const px of [sx + w * 0.08, sx + w * 0.92 - pw]) {
        g.fillStyle = mixDark("#1c0e06", night);
        g.fillRect(px - 2.5, -10, pw + 5, beamY + beamH);
        g.fillStyle = mixDark("#6a4222", night);
        g.fillRect(px, -10, pw, beamY + beamH);
        g.fillStyle = mixDark("#9a6630", night);
        g.fillRect(px + 2, -10, 4, beamY + beamH);
        g.fillStyle = mixDark("#40260f", night);
        g.fillRect(px + pw - 4, -10, 4, beamY + beamH);
        g.fillStyle = mixDark("#40260f", night);
        for (let gy = 30 + ((px * 7) % 23); gy < beamY; gy += 61) g.fillRect(px + 7, gy, 2, 14);
      }
      g.fillStyle = mixDark("#1c0e06", night);
      g.fillRect(sx - 9, beamY - 2.5, w + 18, beamH + 5);
      const bg = g.createLinearGradient(0, beamY, 0, beamY + beamH);
      bg.addColorStop(0, mixDark("#a06a30", night));
      bg.addColorStop(0.45, mixDark("#75481f", night));
      bg.addColorStop(1, mixDark("#48290f", night));
      g.fillStyle = bg;
      g.fillRect(sx - 6.5, beamY, w + 13, beamH);
      g.fillStyle = mixDark("#40260f", night);
      for (let gx = sx + 8; gx < sx + w; gx += 37) g.fillRect(gx, beamY + beamH * 0.3, 14, 1.8);
      for (let gx = sx + 27; gx < sx + w; gx += 43) g.fillRect(gx, beamY + beamH * 0.62, 10, 1.6);
    } else if (cell) {
      // Abgeschnittener Ast oben im Bild: Streifen (Zellspalten 214–362, Zeilen 8–22) in Astrichtung nach oben ziehen
      const rowY = top + (8 - PROP_PAD) * kx;
      const extH = Math.ceil(rowY + 14);
      if (extH > 8) {
        const ex = x + (214 - PROP_PAD) * kx;
        this.drawStaged(g, `${id}|ext:${w}:${extH}`, () => bakeStretch(props, id, 214, 362, 8, 22, kx, extH, 1.35), ex, -14, k);
      }
    }
    // große Sprites: Pixelfaktor gedeckelt (Speicher; das Blattwerk verträgt eine leichte Vergrößerung)
    const hk = Math.min(this.pk, 1.5);
    const key = `${id}:${w}`;
    const base = this.drawStaged(g, key, () => bakeProp(props, id, w, h, hk), x, top, k, 1, hk);
    this.rim(g, key, base, x, top, k, "#ffd27a", 0.55, hk);
    // Leuchtkante der Gefahrenlinie
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.25 + 0.35 * k.night;
    glowAt(g, this.glowGold, sx + w / 2, bottom - 4, w * 0.55, 12);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    return true;
  }

  drawBranch(g: Ctx2D, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx, vines: boolean): void {
    if (this.drawHangingProp(g, e, sx, sy, v, k, vines)) return;
    const w = Math.round(e.w);
    const bottom = sy + e.h;
    const depth = vines ? 150 : 170;
    const sway = k.reduced ? 0 : Math.sin(v.time * 1.3 + e.id) * 2;
    // Stamm/Ast von oben
    const top = Math.max(-10, sy);
    if (!vines) {
      // knorriger Ast schräg von rechts oben (der Baum steht oberhalb am Hang): verjüngte Bézier-Kurve
      const ax = sx + w + 30 + sway * 0.3;
      const ay = top;
      const bx = sx + w * 1.18;
      const by = top + (bottom - depth * 0.5 - top) * 0.82;
      const cx2 = sx + w * 0.4 + sway;
      const cy2 = bottom - depth * 0.5;
      const n = 10;
      const L: number[] = [];
      const R: number[] = [];
      for (let i = 0; i <= n; i += 1) {
        const t = i / n;
        const px = (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * bx + t * t * cx2;
        const py = (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * by + t * t * cy2;
        const dx = 2 * (1 - t) * (bx - ax) + 2 * t * (cx2 - bx);
        const dy = 2 * (1 - t) * (by - ay) + 2 * t * (cy2 - by);
        const len = Math.hypot(dx, dy) || 1;
        const hw = 24 - 17 * t + Math.sin(t * 9 + 1) * 1.8;
        L.push(px - (dy / len) * hw, py + (dx / len) * hw);
        R.push(px + (dy / len) * hw, py - (dx / len) * hw);
      }
      g.fillStyle = mixDark("#4e3626", k.night);
      g.beginPath();
      g.moveTo(L[0], L[1]);
      for (let i = 2; i < L.length; i += 2) g.lineTo(L[i], L[i + 1]);
      for (let i = R.length - 2; i >= 0; i -= 2) g.lineTo(R[i], R[i + 1]);
      g.closePath();
      g.fill();
      // Rindenlicht + Astknoten
      g.strokeStyle = "rgba(255,226,180,0.24)";
      g.lineWidth = 3;
      g.beginPath();
      for (let i = 0; i < L.length; i += 2) {
        const px = (L[i] * 0.7 + R[i] * 0.3);
        const py = (L[i + 1] * 0.7 + R[i + 1] * 0.3);
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke();
      g.fillStyle = mixDark("#3a281c", k.night);
      g.beginPath();
      g.ellipse((L[8] + R[8]) / 2, (L[9] + R[9]) / 2, 7, 4, 0.6, 0, TAU);
      g.fill();
      // Zweige in die Krone
      g.strokeStyle = mixDark("#4e3626", k.night);
      g.lineCap = "round";
      g.lineWidth = 6;
      g.beginPath();
      const jx = (L[12] + R[12]) / 2;
      const jy = (L[13] + R[13]) / 2;
      g.moveTo(jx, jy);
      g.quadraticCurveTo(jx + 10, jy + 30, sx + w * 0.8 + sway, bottom - depth * 0.35);
      g.moveTo(cx2, cy2);
      g.quadraticCurveTo(cx2 - 30, cy2 + 10, sx + w * 0.12 + sway, bottom - depth * 0.38);
      g.stroke();
    }
    const key = `${vines ? "vines" : "branch"}:${w}`;
    // Sprite-Unterkante (lower = depth − 4) liegt exakt auf der Trefferflächen-Unterkante (bottom − 4)
    const base = this.drawStaged(g, key, () => this.branchFoliage(w, depth, vines), sx - 30 + sway, bottom - depth, k);
    this.rim(g, key, base, sx - 30 + sway, bottom - depth, k, "#ffd27a", 0.55);
    // Leuchtkante der Gefahrenlinie
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.25 + 0.35 * k.night;
    glowAt(g, this.glowGold, sx + w / 2, bottom - 4, w * 0.55, 12);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  // ---------------------------------------------------------------------------------------------
  // Tour-Tor: Weinlauben-Bogen mit Laternen (Rahmen hinter dem Engine-Portal)

  private gateSprite(): HTMLCanvasElement {
    return paint(300, 500, (g) => {
      const r = mulberry(99);
      const cx = 150;
      // Pfosten
      for (const px of [cx - 112, cx + 104]) {
        const grd = g.createLinearGradient(px, 0, px + 12, 0);
        grd.addColorStop(0, "#7a5636");
        grd.addColorStop(1, "#4a3220");
        g.fillStyle = grd;
        g.fillRect(px, 70, 12, 430);
        g.fillStyle = "rgba(255,230,190,0.25)";
        g.fillRect(px + 2, 70, 2, 430);
      }
      // Bogen (Holz)
      g.strokeStyle = "#5e4028";
      g.lineWidth = 12;
      g.beginPath();
      g.moveTo(cx - 106, 80);
      g.quadraticCurveTo(cx, -10, cx + 110, 80);
      g.stroke();
      g.strokeStyle = "rgba(255,230,190,0.25)";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(cx - 106, 76);
      g.quadraticCurveTo(cx, -14, cx + 110, 76);
      g.stroke();
      // Weinranken am Bogen und an den Pfosten
      for (let i = 0; i < 26; i += 1) {
        const t = i / 25;
        const x = (1 - t) * (1 - t) * (cx - 106) + 2 * (1 - t) * t * cx + t * t * (cx + 110);
        const y = (1 - t) * (1 - t) * 80 + 2 * (1 - t) * t * -10 + t * t * 80;
        const c = r();
        grapeLeaf(g, x + (r() - 0.5) * 10, y + (r() - 0.5) * 12, 11 + r() * 6, r() * TAU, c < 0.35 ? "#d4a434" : c < 0.6 ? "#c8702c" : c < 0.8 ? "#a8402c" : "#8a9638", "rgba(60,30,10,0.4)");
      }
      for (const px of [cx - 106, cx + 110]) {
        for (let y = 100; y < 480; y += 26 + r() * 20) {
          const c = r();
          grapeLeaf(g, px + (r() - 0.5) * 14, y, 9 + r() * 5, r() * TAU, c < 0.5 ? "#8a9638" : "#c8802c", "rgba(60,30,10,0.4)");
        }
      }
      grapeBunch(g, cx - 70, 58, 26, "#4a2660", "#643a82", "rgba(255,255,255,0.55)");
      grapeBunch(g, cx + 76, 60, 24, "#b8b83a", "#d0cc54", "rgba(255,255,255,0.55)");
      // Laternen
      for (const lx of [cx - 106, cx + 110]) {
        g.fillStyle = "#2a2018";
        g.fillRect(lx - 1, 84, 2, 18);
        g.fillStyle = "#3a2a1a";
        g.fillRect(lx - 8, 102, 16, 3);
        g.fillStyle = "#f2dc9a";
        g.fillRect(lx - 6, 105, 12, 16);
        g.fillStyle = "#3a2a1a";
        g.fillRect(lx - 8, 121, 16, 3);
      }
      // kleines Schild
      g.fillStyle = "#6a4a2e";
      g.beginPath();
      rr(g, cx - 40, 20, 80, 22, 5);
      g.fill();
      g.strokeStyle = "#e0c890";
      g.lineWidth = 1.5;
      g.beginPath();
      rr(g, cx - 40, 20, 80, 22, 5);
      g.stroke();
      g.fillStyle = "#f6e6c0";
      g.font = "700 13px system-ui, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("Wachau", cx, 32);
    });
  }

  drawGateArch(g: Ctx2D, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
    const spr = this.cache.get("gate", () => this.gateSprite());
    const cx = sx + e.w / 2;
    const bottom = sy + e.h;
    g.drawImage(spr, Math.round(cx - 150), Math.round(bottom - 500));
    const flick = k.reduced ? 1 : 0.85 + 0.15 * Math.sin(v.time * 9) * Math.sin(v.time * 4.3);
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.7 * flick;
    for (const lx of [cx - 106, cx + 110]) glowAt(g, this.glowWarm, lx, bottom - 500 + 113, 30);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  // ---------------------------------------------------------------------------------------------
  // Böe / Blätterwirbel (wind)

  drawGust(g: Ctx2D, e: Ent, sx: number, sy: number, v: ViewState, k: SkinCtx): void {
    const t = k.reduced ? v.time * 0.3 : v.time;
    const cx = sx + e.w / 2;
    const top = sy;
    const bot = sy + e.h;
    const rx = e.w * 0.42;
    // Luftsäule (weich, hell)
    g.globalAlpha = 0.16 + 0.08 * k.night;
    glowAt(g, this.softWater, cx, sy + e.h * 0.5, e.w * 0.62, e.h * 0.62);
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.16 + 0.2 * k.night;
    glowAt(g, this.softLeaf, cx, sy + e.h * 0.6, e.w * 0.55, e.h * 0.55);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    // Wirbel-Bänder (Helix)
    g.lineCap = "round";
    for (let band = 0; band < 3; band += 1) {
      const a0 = band * 2.1 + t * 3.2;
      g.strokeStyle = `rgba(255,252,240,${(0.42 - band * 0.08).toFixed(3)})`;
      g.lineWidth = 2.6 - band * 0.5;
      g.beginPath();
      for (let i = 0; i <= 18; i += 1) {
        const u = i / 18;
        const y = bot - u * e.h;
        const a = a0 + u * 7;
        const x = cx + Math.cos(a) * rx * (0.55 + 0.45 * u);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    // Blätter wirbeln aufwärts
    const n = k.quality === 0 ? 9 : 18;
    for (let i = 0; i < n; i += 1) {
      const ph = (t * (0.42 + (i % 4) * 0.07) + i / n) % 1;
      const a = t * 3.2 + i * 2.1 + ph * 7;
      const x = cx + Math.cos(a) * rx * (0.55 + ph * 0.45);
      const y = bot - e.h * ph;
      const depth = Math.sin(a);
      g.globalAlpha = Math.min(1, ph * 5, (1 - ph) * 5) * (0.7 + 0.3 * depth);
      g.fillStyle = i % 3 === 0 ? "#f0b038" : i % 3 === 1 ? "#d8682a" : "#c8b040";
      g.beginPath();
      g.ellipse(x, y, 7, 3 * Math.abs(Math.cos(a * 1.7)) + 1, a, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
    // Staubwirbel am Fuß
    g.strokeStyle = "rgba(255,244,220,0.45)";
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(cx, bot - 4, rx * 0.8, 7, 0, t * 2, t * 2 + Math.PI * 1.3);
    g.stroke();
    // Pfeile nach oben (Hinweis)
    const pulse = k.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(v.time * 5 + e.id);
    g.strokeStyle = `rgba(255,240,200,${(0.45 + 0.4 * pulse).toFixed(3)})`;
    g.lineWidth = 4;
    for (let i = 0; i < 3; i += 1) {
      const yy = top + e.h * 0.42 - i * 20 - pulse * 8;
      g.beginPath();
      g.moveTo(cx - 13, yy + 10);
      g.lineTo(cx, yy);
      g.lineTo(cx + 13, yy + 10);
      g.stroke();
    }
  }
}

// ------------------------------------------------------------------------------------------------

function mixDark(hex: string, night: number): string {
  return mixHex(hex, "#10141e", Math.min(0.7, night * 0.6));
}

/** Marille (Fallback): Kugel mit Wange, Naht, Stiel und Blatt – zentriert bei (0,0) */
export function apricotShape(g: Ctx2D, r: number): void {
  const grd = g.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r * 1.05);
  grd.addColorStop(0, "#ffd88a");
  grd.addColorStop(0.45, "#f7a33c");
  grd.addColorStop(0.85, "#e0682a");
  grd.addColorStop(1, "#b8481e");
  g.fillStyle = grd;
  g.beginPath();
  g.ellipse(0, 0, r, r * 0.95, 0, 0, TAU);
  g.fill();
  g.fillStyle = "rgba(214,60,40,0.35)";
  g.beginPath();
  g.ellipse(r * 0.35, r * 0.2, r * 0.45, r * 0.5, 0.4, 0, TAU);
  g.fill();
  g.strokeStyle = "rgba(150,60,20,0.45)";
  g.lineWidth = Math.max(1, r * 0.08);
  g.beginPath();
  g.moveTo(-r * 0.05, -r * 0.9);
  g.quadraticCurveTo(r * 0.3, 0, -r * 0.1, r * 0.9);
  g.stroke();
  g.strokeStyle = "#5a3a1a";
  g.lineWidth = Math.max(1, r * 0.12);
  g.beginPath();
  g.moveTo(0, -r * 0.85);
  g.lineTo(r * 0.1, -r * 1.2);
  g.stroke();
  g.fillStyle = "#5f8a2e";
  g.beginPath();
  g.ellipse(r * 0.42, -r * 1.12, r * 0.42, r * 0.18, -0.4, 0, TAU);
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.6)";
  g.beginPath();
  g.ellipse(-r * 0.38, -r * 0.4, r * 0.18, r * 0.28, -0.6, 0, TAU);
  g.fill();
}

/** Reihe quer liegender Stämme (Stirnseiten) unter einem Floßdeck bei Oberkante deck */
function logRow(g: Ctx2D, x0: number, deck: number, w: number, r: () => number): void {
  // Stämme quer: Stirnseiten als Reihe (klassisches Floß)
  const lr = 11;
  const n = Math.max(3, Math.round(w / (lr * 2 - 1)));
  const step = (w - lr * 2) / (n - 1);
  for (let i = 0; i < n; i += 1) {
    const cx = x0 + lr + i * step;
    const cy = deck + 7 + lr + (r() - 0.5) * 1.5;
    const rr0 = lr + (r() - 0.5) * 1.6;
    const bark = g.createRadialGradient(cx - 3, cy - 4, 1, cx, cy, rr0);
    bark.addColorStop(0, "#8a5a32");
    bark.addColorStop(1, "#4a2e18");
    g.fillStyle = bark;
    g.beginPath();
    g.arc(cx, cy, rr0, 0, TAU);
    g.fill();
    const face = g.createRadialGradient(cx - 2, cy - 2, 1, cx, cy, rr0 - 2);
    face.addColorStop(0, "#f2cf96");
    face.addColorStop(1, "#c89458");
    g.fillStyle = face;
    g.beginPath();
    g.arc(cx, cy, rr0 - 2.4, 0, TAU);
    g.fill();
    g.strokeStyle = "rgba(140,90,40,0.55)";
    g.lineWidth = 1;
    g.beginPath();
    g.arc(cx, cy, (rr0 - 2.4) * 0.62, 0, TAU);
    g.moveTo(cx + (rr0 - 2.4) * 0.3, cy);
    g.arc(cx, cy, (rr0 - 2.4) * 0.3, 0, TAU);
    g.stroke();
  }
}

/** Weinkiste (Holz, Latten) */
function crateBox(g: Ctx2D, x: number, y: number, w: number, h: number, r: () => number): void {
  const grd = g.createLinearGradient(0, y, 0, y + h);
  grd.addColorStop(0, "#c8955a");
  grd.addColorStop(1, "#8a5a30");
  g.fillStyle = grd;
  g.fillRect(x, y, w, h);
  g.fillStyle = "rgba(60,30,10,0.35)";
  const slats = Math.max(2, Math.round(h / 12));
  for (let i = 1; i < slats; i += 1) g.fillRect(x, y + (i * h) / slats - 1, w, 2);
  g.fillStyle = "#6a4222";
  g.fillRect(x, y, 4, h);
  g.fillRect(x + w - 4, y, 4, h);
  g.fillStyle = "rgba(255,240,210,0.35)";
  g.fillRect(x + 4, y + 1, w - 8, 1.5);
  // Brandzeichen
  g.fillStyle = "rgba(60,20,10,0.45)";
  g.beginPath();
  g.arc(x + w / 2, y + h / 2, Math.min(w, h) * 0.12, 0, TAU);
  g.fill();
  void r;
}

/** Einzelne Biene */
function bee(g: Ctx2D, x: number, y: number, s: number, flap: number, right: boolean): void {
  const wing = Math.abs(Math.sin(flap)) * 0.8 + 0.2;
  g.fillStyle = "rgba(235,245,255,0.75)";
  g.beginPath();
  g.ellipse(x - s * 0.1, y - s * 0.6, s * 0.45, s * 0.7 * wing, -0.4, 0, TAU);
  g.ellipse(x + s * 0.3, y - s * 0.55, s * 0.4, s * 0.6 * wing, 0.4, 0, TAU);
  g.fill();
  g.fillStyle = "#f2c230";
  g.beginPath();
  g.ellipse(x, y, s * 0.75, s * 0.52, 0, 0, TAU);
  g.fill();
  g.fillStyle = "#2a2014";
  g.fillRect(x - s * 0.2, y - s * 0.5, s * 0.18, s);
  g.fillRect(x + s * 0.22, y - s * 0.46, s * 0.16, s * 0.92);
  g.beginPath();
  g.arc(x + (right ? s * 0.7 : -s * 0.7), y - s * 0.05, s * 0.3, 0, TAU);
  g.fill();
}
