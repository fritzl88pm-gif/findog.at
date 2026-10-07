/** Leichtgewichtiges Partikelsystem (Objekt-Pool, keine Allokationen im Betrieb). */
import { VIEW_H, VIEW_W } from "./constants";
import { clamp } from "./draw-utils";

/**
 * Formen. "puff": weiches vorgerendertes Sprite (Größe = Radius des früheren Kreises, `color` wird ignoriert, Deckkraft über
 * `alpha`; ohne Canvas Rückfall auf einen Kreis). "coin": drehende Flug-Münze (siehe `tx`/`ty` in EmitOpts).
 */
export type ParticleShape = "circle" | "spark" | "ring" | "square" | "star" | "streak" | "puff" | "coin";

interface P {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  drag: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  rot: number;
  vr: number;
  color: string;
  shape: ParticleShape;
  additive: boolean;
  /** Weltfest: scrollt mit der Welt nach links mit (`update(dt, scroll)` zieht scroll*dt von x ab) */
  world: boolean;
  /** Grunddeckkraft (Faktor zum Ausblenden über die Lebenszeit), Standard 1 */
  alpha: number;
  /** Dunkler Rand (nur Stern): lesbar auf hellen Welten, wirkt nur ohne `additive` */
  outline: string;
  /** Puff-Sprite-Variante 0/1 */
  variant: number;
  /** Flug-Partikel: bewegt sich per Ease-in von (sx, sy) nach (tx, ty) in `max` Sekunden */
  fly: boolean;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

export interface EmitOpts {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  ax?: number;
  ay?: number;
  drag?: number;
  life?: number;
  size?: number;
  grow?: number;
  rot?: number;
  vr?: number;
  color?: string;
  shape?: ParticleShape;
  additive?: boolean;
  world?: boolean;
  /** Grunddeckkraft 0..1 (für Puffs: ersetzt das Alpha im Farbwert) */
  alpha?: number;
  /** Dunkler Rand für Sterne (zeichnet source-over statt additiv sinnvoll) */
  outline?: string;
  /** Puff-Sprite 0/1 (Standard: abwechselnd) */
  variant?: number;
  /** Flugziel (Bildschirmkoordinaten): setzt den Partikel auf Flugbahn (Ease-in über `life`), siehe MAX_FLYING */
  tx?: number;
  ty?: number;
  /** Vom Qualitätsbudget ausgenommen (immer emittieren) */
  essential?: boolean;
}

/** Textbox eines Popups (Mittelpunkt x/y, Breite w, Höhe h) – Grundlage der Platzierung. */
export interface PopupRect {
  active: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Alter in Sekunden (zur Wahl des ältesten Popups) */
  life: number;
}

export interface Popup extends PopupRect {
  text: string;
  color: string;
  max: number;
  size: number;
  /** Schlüssel zur Zusammenführung ("combo", "hurt"), "" = keiner */
  key: string;
}

export interface PopupPlacement {
  x: number;
  y: number;
  /** Index (in `active`) des Popups, das überschrieben werden soll, sonst -1 */
  replace: number;
}

/** Höchstens so viele Flug-Münzen gleichzeitig (vom Qualitätsbudget ausgenommen). */
export const MAX_FLYING = 3;
/** Höchstens so viele kreisende Sternchen (Tod-Pose). */
export const ORBIT_MAX = 4;
/** Sichere Zone für Popup-Textboxen (HUD-Ränder und Bodenstreifen bleiben frei). */
export const POPUP_ZONE = { x0: 140, x1: VIEW_W - 140, y0: 120, y1: VIEW_H - 130 } as const;
/** HUD-Panel links oben (22..314 × 18..136): Popups, die in seine Spalte ragen, bleiben darunter. */
const HUD_LEFT = { x1: 330, y1: 142 } as const;
/** Abstandsfaktor beim Stapeln: um size*1,1 verschieben. */
const STACK_GAP = 1.1;
/** Steiggeschwindigkeit der Popups (px/s) – für alle gleich, damit gestapelte Popups nie ineinander laufen. */
const POPUP_RISE = 34;

/** Grobe Textbreite eines Popups (fette Schrift, ohne Canvas messbar – bewusst eher großzügig). */
export function popupWidth(text: string, size: number): number {
  return text.length * size * 0.6 + 12;
}

function rectsOverlap(q: PopupRect, x: number, y: number, w: number, h: number): boolean {
  return Math.abs(q.x - x) < (q.w + w) / 2 && Math.abs(q.y - y) < (q.h + h) / 2;
}

function zoneX(x: number, w: number): number {
  const lo = POPUP_ZONE.x0 + w / 2;
  const hi = POPUP_ZONE.x1 - w / 2;
  return lo > hi ? (POPUP_ZONE.x0 + POPUP_ZONE.x1) / 2 : clamp(x, lo, hi);
}

function zoneY(cx: number, y: number, w: number, h: number): number {
  let lo = POPUP_ZONE.y0 + h / 2;
  if (cx - w / 2 < HUD_LEFT.x1) lo = Math.max(lo, HUD_LEFT.y1 + h / 2);
  const hi = POPUP_ZONE.y1 - h / 2;
  return lo > hi ? (lo + hi) / 2 : clamp(y, lo, hi);
}

function freeAt(active: ReadonlyArray<PopupRect>, skip: number, x: number, y: number, w: number, h: number): boolean {
  for (let i = 0; i < active.length; i += 1) {
    if (i !== skip && active[i].active && rectsOverlap(active[i], x, y, w, h)) return false;
  }
  return true;
}

/**
 * Platziert ein Popup (Mittelpunkt x/y, Textbox w × h; h = Schriftgröße): klemmt die ganze Box in die sichere Zone
 * (POPUP_ZONE, HUD-Panel links oben ausgespart) und weicht aktiven Popups aus. Reihenfolge der Stapelplätze: Wunschplatz,
 * dann direkt über, dann direkt unter dem überlappten Stapel (Abstand = Höhe * 1,1). Sind alle drei belegt, wird das
 * älteste überlappte Popup überschrieben (`replace` = sein Index in `active`, neues Popup nimmt einen Platz ohne
 * Überlappung mit den übrigen). `active` darf den ganzen Pool samt inaktiven Einträgen enthalten. Rein, deterministisch.
 */
export function placePopup(
  active: ReadonlyArray<PopupRect>,
  x: number,
  y: number,
  w: number,
  h: number,
  out: PopupPlacement = { x: 0, y: 0, replace: -1 },
): PopupPlacement {
  const cx = zoneX(Number.isFinite(x) ? x : VIEW_W / 2, w);
  const cy = zoneY(cx, Number.isFinite(y) ? y : POPUP_ZONE.y0, w, h);
  let top = Infinity;
  let bottom = -Infinity;
  let oldest = -1;
  let oldestLife = -Infinity;
  for (let i = 0; i < active.length; i += 1) {
    const q = active[i];
    if (!q.active || !rectsOverlap(q, cx, cy, w, h)) continue;
    top = Math.min(top, q.y - q.h / 2);
    bottom = Math.max(bottom, q.y + q.h / 2);
    if (q.life > oldestLife) {
      oldestLife = q.life;
      oldest = i;
    }
  }
  out.x = cx;
  out.replace = -1;
  if (oldest < 0) {
    out.y = cy;
    return out;
  }
  const up = zoneY(cx, top - h * (STACK_GAP - 0.5), w, h);
  if (freeAt(active, -1, cx, up, w, h)) {
    out.y = up;
    return out;
  }
  const down = zoneY(cx, bottom + h * (STACK_GAP - 0.5), w, h);
  if (freeAt(active, -1, cx, down, w, h)) {
    out.y = down;
    return out;
  }
  // Alle Stapelplätze belegt: ältestes überschreiben, Platz ohne Überlappung mit den übrigen bevorzugen.
  out.replace = oldest;
  const o = active[oldest];
  const slotY = zoneY(cx, o.y, w, h);
  if (freeAt(active, oldest, cx, cy, w, h)) out.y = cy;
  else if (freeAt(active, oldest, cx, slotY, w, h)) out.y = slotY;
  else if (freeAt(active, oldest, cx, up, w, h)) out.y = up;
  else if (freeAt(active, oldest, cx, down, w, h)) out.y = down;
  else out.y = cy;
  return out;
}

// --- Weiche Puff-Sprites ------------------------------------------------------------------------------------------------

/** Anzahl der vorgerenderten Puff-Varianten. */
export const PUFF_VARIANTS = 2;
const PUFF_PX = 64;
/** Sichtbarer Durchmesser relativ zum früheren harten Kreis (der weiche Rand "verliert" optische Masse). */
const PUFF_SCALE = 1.6;
let puffCache: HTMLCanvasElement[] | null = null;
let puffFailed = false;

function renderPuff(variant: number): HTMLCanvasElement | null {
  const c = document.createElement("canvas");
  c.width = PUFF_PX;
  c.height = PUFF_PX;
  const g = c.getContext("2d");
  if (!g) return null;
  // Variante 0: eine runde Wolke; Variante 1: drei versetzte Keulen (unregelmäßiger). Kühles Weiß, Farbe/Alpha steuert der Aufrufer.
  const lobes = variant === 0 ? [[32, 32, 30]] : [[24, 35, 21], [41, 29, 20], [34, 42, 17]];
  for (const [lx, ly, lr] of lobes) {
    const grd = g.createRadialGradient(lx, ly, 0, lx, ly, lr);
    grd.addColorStop(0, "rgba(240,242,248,0.98)");
    grd.addColorStop(0.4, "rgba(238,240,247,0.82)");
    grd.addColorStop(0.75, "rgba(236,238,245,0.3)");
    grd.addColorStop(1, "rgba(236,238,245,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, PUFF_PX, PUFF_PX);
  }
  return c;
}

/**
 * Vorgerendertes Puff-Sprite (0 oder 1), einmalig erzeugt und gecacht. Ohne DOM (Node/SSR) oder ohne 2D-Kontext: null
 * (Aufrufer fällt auf einen einfachen Kreis zurück); es wird nie geworfen.
 */
export function puffSprite(variant: number): CanvasImageSource | null {
  if (puffCache) return puffCache[variant & 1];
  if (puffFailed || typeof document === "undefined") return null;
  try {
    const a = renderPuff(0);
    const b = a ? renderPuff(1) : null;
    if (a && b) {
      puffCache = [a, b];
      return puffCache[variant & 1];
    }
  } catch {
    // Offscreen-Erzeugung nicht möglich → Fallback-Kreis
  }
  puffFailed = true;
  return null;
}

/** Erzeugt beide Sprites vorab (z. B. im Menü); true = verfügbar. */
export function warmPuffSprites(): boolean {
  return puffSprite(0) !== null;
}

function starPath(g: CanvasRenderingContext2D, s: number): void {
  g.beginPath();
  for (let i = 0; i < 4; i += 1) {
    const ang = (i * Math.PI) / 2;
    g.lineTo(Math.cos(ang) * s, Math.sin(ang) * s);
    g.lineTo(Math.cos(ang + Math.PI / 4) * s * 0.28, Math.sin(ang + Math.PI / 4) * s * 0.28);
  }
  g.closePath();
}

export class Particles {
  private readonly pool: P[] = [];
  private readonly popups: Popup[] = [];
  private cursor = 0;
  private pcursor = 0;
  private seq = 0;
  /** Sammler für das Qualitätsbudget (deterministisch statt Zufall: jedes n-te Partikel bei Budget 1/n). */
  private acc = 0;
  private arrivals = 0;
  private readonly place: PopupPlacement = { x: 0, y: 0, replace: -1 };
  // Kreisende Sternchen (Tod-Pose): höchstens ORBIT_MAX, laufen nur solange `orbit()` aufgerufen wird.
  private orbitN = 0;
  private orbitX = 0;
  private orbitY = 0;
  private orbitR = 30;
  private orbitA = 0;
  private orbitTtl = 0;
  budget = 1;

  constructor(readonly capacity = 640) {
    for (let i = 0; i < capacity; i += 1) {
      this.pool.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, drag: 0, life: 0, max: 1, size: 4, grow: 0, rot: 0, vr: 0, color: "#fff", shape: "circle", additive: false, world: false, alpha: 1, outline: "", variant: 0, fly: false, sx: 0, sy: 0, tx: 0, ty: 0 });
    }
    for (let i = 0; i < 24; i += 1) this.popups.push({ active: false, x: 0, y: 0, w: 0, h: 0, text: "", color: "#fff", life: 0, max: 1, size: 28, key: "" });
  }

  clear(): void {
    for (const p of this.pool) {
      p.active = false;
      p.fly = false;
    }
    for (const p of this.popups) p.active = false;
    this.orbitN = 0;
    this.orbitTtl = 0;
    this.arrivals = 0;
    this.acc = 0;
  }

  /** Aktive Flug-Münzen (Partikel mit Flugziel). */
  get flying(): number {
    let n = 0;
    for (const p of this.pool) if (p.active && p.fly) n += 1;
    return n;
  }

  /** Anzahl aktiver Partikel (optional nur einer Form) – für Tests und Diagnose. */
  count(shape?: ParticleShape): number {
    let n = 0;
    for (const p of this.pool) if (p.active && (shape === undefined || p.shape === shape)) n += 1;
    return n;
  }

  /** Lesezugriff auf den Popup-Pool (Tests/Diagnose); aktive Einträge haben `active === true`. */
  get popupPool(): readonly Readonly<Popup>[] {
    return this.popups;
  }

  /** Zahl der seit dem letzten Aufruf am Ziel angekommenen Flug-Münzen (für HUD-Bump); setzt den Zähler zurück. */
  takeArrivals(): number {
    const n = this.arrivals;
    this.arrivals = 0;
    return n;
  }

  /** Momentaufnahme der aktiven Partikel (allokiert – nur für Tests und Diagnose). */
  inspect(): Array<{ x: number; y: number; shape: ParticleShape; world: boolean; fly: boolean; life: number }> {
    const r: Array<{ x: number; y: number; shape: ParticleShape; world: boolean; fly: boolean; life: number }> = [];
    for (const p of this.pool) if (p.active) r.push({ x: p.x, y: p.y, shape: p.shape, world: p.world, fly: p.fly, life: p.life });
    return r;
  }

  emit(o: EmitOpts): void {
    const flies = o.tx !== undefined && o.ty !== undefined && Number.isFinite(o.tx) && Number.isFinite(o.ty);
    if (flies) {
      // Flug-Münzen: ausgenommen vom Budget, aber höchstens MAX_FLYING gleichzeitig.
      if (this.flying >= MAX_FLYING) return;
    } else if (this.budget < 1 && !o.essential) {
      this.acc += Math.max(0, this.budget);
      if (this.acc < 1) return;
      this.acc -= 1;
    }
    // Ringpuffer; aktive Flug-Münzen werden nicht überschrieben.
    let p = this.pool[this.cursor];
    for (let n = 0; n < this.capacity && p.active && p.fly; n += 1) {
      this.cursor = (this.cursor + 1) % this.capacity;
      p = this.pool[this.cursor];
    }
    this.cursor = (this.cursor + 1) % this.capacity;
    p.active = true;
    p.x = o.x;
    p.y = o.y;
    p.vx = o.vx ?? 0;
    p.vy = o.vy ?? 0;
    p.ax = o.ax ?? 0;
    p.ay = o.ay ?? 0;
    p.drag = o.drag ?? 0;
    p.life = 0;
    p.max = o.life ?? 0.6;
    p.size = o.size ?? 5;
    p.grow = o.grow ?? 0;
    p.rot = o.rot ?? 0;
    p.vr = o.vr ?? 0;
    p.color = o.color ?? "#fff";
    p.shape = o.shape ?? "circle";
    p.additive = o.additive ?? false;
    p.world = o.world ?? false;
    p.alpha = o.alpha ?? 1;
    p.outline = o.outline ?? "";
    p.variant = (o.variant ?? this.seq) & 1;
    this.seq += 1;
    p.fly = flies;
    if (flies) {
      p.sx = o.x;
      p.sy = o.y;
      p.tx = o.tx as number;
      p.ty = o.ty as number;
    }
  }

  /**
   * Münz-Feedback: Gold-Ring (immer), 8 Sterne mit dunklem Rand (Qualitätsbudget gilt) und – wenn ein Ziel (tx, ty) angegeben
   * ist – eine Flug-Münze zum HUD-Zähler (Ease-in 0,4 s, höchstens MAX_FLYING gleichzeitig, vom Budget ausgenommen).
   * Je Aufruf höchstens 9 Partikel plus Flug-Münze. Deterministisch.
   */
  coinFx(x: number, y: number, tx = NaN, ty = NaN): void {
    this.emit({ x, y, life: 0.25, size: 10, grow: 240, shape: "ring", color: "#ffcf33", essential: true });
    const off = this.seq * 0.7;
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2 + off;
      this.emit({ x, y, vx: Math.cos(a) * 190, vy: Math.sin(a) * 190 - 40, drag: 1.6, life: 0.42, size: 5 + (i & 1), color: "#ffe066", outline: "#7a4b00", shape: "star", vr: 8 });
    }
    if (Number.isFinite(tx) && Number.isFinite(ty)) {
      this.emit({ x, y, tx, ty, life: 0.4, size: 11, vr: 14, color: "#ffd23f", shape: "coin" });
    }
  }

  /**
   * Kreisende Sternchen (Tod-Pose) um (cx, cy): `count` 0..ORBIT_MAX; muss jeden Frame aufgerufen werden, solange sie
   * sichtbar sein sollen (ohne Aufruf verschwinden sie nach 0,12 s). Eigener Speicher, belegt keine Pool-Partikel.
   */
  orbit(cx: number, cy: number, count: number, radius = 30): void {
    this.orbitN = Math.max(0, Math.min(ORBIT_MAX, Math.floor(count)));
    this.orbitX = cx;
    this.orbitY = cy;
    this.orbitR = radius;
    this.orbitTtl = this.orbitN > 0 ? 0.12 : 0;
  }

  /** Anzahl aktuell sichtbarer kreisender Sternchen. */
  get orbiting(): number {
    return this.orbitTtl > 0 ? this.orbitN : 0;
  }

  /**
   * Zeigt ein Popup an. Die Platzierung ist zentral (`placePopup`): in die sichere Zone geklemmt, ohne Überlappung mit
   * aktiven Popups. "Kombo …" und "Autsch…" tragen einen Schlüssel: ein weiteres Popup mit demselben Schlüssel
   * aktualisiert das bestehende (Text, Farbe, Alter) statt ein neues zu erzeugen. Lebensdauer Kombo/Autsch 0,7 s,
   * sonst 0,9 s (explizites `life` gewinnt).
   */
  popup(x: number, y: number, text: string, color = "#fff", size = 30, life?: number, key?: string): void {
    const k = key ?? (text.startsWith("Kombo") ? "combo" : text.startsWith("Autsch") ? "hurt" : "");
    const max = life ?? (k === "combo" || k === "hurt" ? 0.7 : 0.9);
    const w = popupWidth(text, size);
    if (k) {
      for (const q of this.popups) {
        if (!q.active || q.key !== k) continue;
        q.text = text;
        q.color = color;
        q.size = size;
        q.w = w;
        q.h = size;
        q.life = 0;
        q.max = max;
        return;
      }
    }
    const pl = placePopup(this.popups, x, y, w, size, this.place);
    let slot = pl.replace;
    if (slot < 0) {
      // freien Platz im Ring suchen, sonst das älteste überschreiben
      for (let n = 0; n < this.popups.length; n += 1) {
        const c = (this.pcursor + n) % this.popups.length;
        if (!this.popups[c].active) {
          slot = c;
          break;
        }
      }
      if (slot < 0) {
        let age = -1;
        for (let n = 0; n < this.popups.length; n += 1) {
          if (this.popups[n].life > age) {
            age = this.popups[n].life;
            slot = n;
          }
        }
      }
      this.pcursor = (slot + 1) % this.popups.length;
    }
    const p = this.popups[slot];
    p.active = true;
    p.x = pl.x;
    p.y = pl.y;
    p.w = w;
    p.h = size;
    p.text = text;
    p.color = color;
    p.life = 0;
    p.max = max;
    p.size = size;
    p.key = k;
    // Reste einer Überschreibung (unterschiedliche Größen) beseitigen: nie überlappende Popups
    for (const q of this.popups) {
      if (q !== p && q.active && rectsOverlap(q, p.x, p.y, w, size)) q.active = false;
    }
  }

  update(dt: number, scroll: number): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life += dt;
      if (p.life >= p.max) {
        if (p.fly) this.arrivals += 1;
        p.active = false;
        p.fly = false;
        continue;
      }
      if (p.fly) {
        const u = p.life / p.max;
        const e = u * u; // Ease-in
        p.x = p.sx + (p.tx - p.sx) * e;
        p.y = p.sy + (p.ty - p.sy) * e - Math.sin(u * Math.PI) * 28;
        p.rot += p.vr * dt;
        continue;
      }
      p.vx += p.ax * dt;
      p.vy += p.ay * dt;
      if (p.drag) {
        const f = Math.max(0, 1 - p.drag * dt);
        p.vx *= f;
        p.vy *= f;
      }
      p.x += p.vx * dt - (p.world ? scroll * dt : 0);
      p.y += p.vy * dt;
      p.size += p.grow * dt;
      p.rot += p.vr * dt;
    }
    for (let i = 0; i < this.popups.length; i += 1) {
      const q = this.popups[i];
      if (!q.active) continue;
      q.life += dt;
      if (q.life >= q.max) {
        q.active = false;
        continue;
      }
      // Steigen bis zur Oberkante der sicheren Zone; nie in ein anderes Popup hinein (Stapel bleiben lesbar).
      const ny = Math.max(zoneY(q.x, POPUP_ZONE.y0, q.w, q.h), q.y - POPUP_RISE * dt);
      if (ny < q.y && freeAt(this.popups, i, q.x, ny, q.w, q.h)) q.y = ny;
    }
    if (this.orbitTtl > 0) {
      this.orbitTtl -= dt;
      this.orbitA += dt * 7;
    }
  }

  draw(g: CanvasRenderingContext2D): void {
    g.save();
    let additive = false;
    for (const p of this.pool) {
      if (!p.active) continue;
      const u = p.life / p.max;
      const a = (p.fly ? 1 : Math.max(0, 1 - u * u)) * p.alpha;
      if (p.additive !== additive) {
        additive = p.additive;
        g.globalCompositeOperation = additive ? "lighter" : "source-over";
      }
      g.globalAlpha = a;
      g.fillStyle = p.color;
      g.strokeStyle = p.color;
      const s = Math.max(0.1, p.size);
      switch (p.shape) {
        case "circle":
          g.beginPath();
          g.arc(p.x, p.y, s, 0, Math.PI * 2);
          g.fill();
          break;
        case "puff": {
          const spr = puffSprite(p.variant);
          if (spr) {
            const d = s * 2 * PUFF_SCALE;
            g.drawImage(spr, p.x - d / 2, p.y - d / 2, d, d);
          } else {
            g.beginPath();
            g.arc(p.x, p.y, s, 0, Math.PI * 2);
            g.fill();
          }
          break;
        }
        case "coin": {
          // Drehende Münze: Scheibe mit dunklem Rand und Glanzstrich
          g.save();
          g.translate(p.x, p.y);
          g.scale(Math.max(0.22, Math.abs(Math.cos(p.rot))), 1);
          g.beginPath();
          g.arc(0, 0, s, 0, Math.PI * 2);
          g.fill();
          g.lineWidth = Math.max(1.5, s * 0.2);
          g.strokeStyle = "#a86a00";
          g.stroke();
          g.beginPath();
          g.arc(0, 0, s * 0.55, Math.PI * 1.15, Math.PI * 1.85);
          g.strokeStyle = "rgba(255,255,255,0.8)";
          g.lineWidth = Math.max(1, s * 0.14);
          g.stroke();
          g.restore();
          break;
        }
        case "square":
          g.save();
          g.translate(p.x, p.y);
          g.rotate(p.rot);
          g.fillRect(-s, -s * 0.6, s * 2, s * 1.2);
          g.restore();
          break;
        case "ring":
          g.lineWidth = Math.max(1, s * 0.12);
          g.beginPath();
          g.arc(p.x, p.y, s, 0, Math.PI * 2);
          g.stroke();
          break;
        case "spark": {
          g.lineWidth = Math.max(1.5, s * 0.5);
          g.lineCap = "round";
          g.beginPath();
          g.moveTo(p.x, p.y);
          g.lineTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045);
          g.stroke();
          break;
        }
        case "streak":
          g.fillRect(p.x, p.y - 1, s * 6, 2);
          break;
        case "star": {
          g.save();
          g.translate(p.x, p.y);
          g.rotate(p.rot);
          starPath(g, s);
          if (p.outline) {
            g.lineJoin = "round";
            g.lineWidth = Math.max(1.5, s * 0.4);
            g.strokeStyle = p.outline;
            g.stroke();
          }
          g.fill();
          g.restore();
          break;
        }
      }
    }
    if (this.orbitTtl > 0 && this.orbitN > 0) {
      // Orbit-Sternchen: flache Ellipse über dem Kopf; vorne (sin > 0) etwas größer
      if (additive) g.globalCompositeOperation = "source-over";
      g.globalAlpha = Math.min(1, this.orbitTtl / 0.06);
      g.fillStyle = "#ffe066";
      g.strokeStyle = "#7a4b00";
      g.lineJoin = "round";
      for (let i = 0; i < this.orbitN; i += 1) {
        const ang = this.orbitA + (i / this.orbitN) * Math.PI * 2;
        const sn = Math.sin(ang);
        const ss = 8.5 * (1 + 0.25 * sn);
        g.save();
        g.translate(this.orbitX + Math.cos(ang) * this.orbitR, this.orbitY + sn * this.orbitR * 0.36);
        g.rotate(ang * 1.5);
        starPath(g, ss);
        g.lineWidth = 2.5;
        g.stroke();
        g.fill();
        g.restore();
      }
    }
    g.restore();
  }

  drawPopups(g: CanvasRenderingContext2D): void {
    g.save();
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineJoin = "round";
    for (const q of this.popups) {
      if (!q.active) continue;
      const u = q.life / q.max;
      const pop = u < 0.15 ? 0.6 + (u / 0.15) * 0.55 : 1.15 - Math.min(0.15, (u - 0.15) * 0.3);
      g.globalAlpha = u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1;
      g.font = `800 ${Math.round(q.size * pop)}px ${FONT}`;
      g.lineWidth = 6;
      g.strokeStyle = "rgba(20,24,40,0.85)";
      g.strokeText(q.text, q.x, q.y);
      g.fillStyle = q.color;
      g.fillText(q.text, q.x, q.y);
    }
    g.restore();
  }
}

export const FONT = '"Nunito", "Baloo 2", "Trebuchet MS", "Segoe UI", system-ui, -apple-system, sans-serif';
