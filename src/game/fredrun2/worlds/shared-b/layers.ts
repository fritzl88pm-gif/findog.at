/**
 * Parallax-Ebenen mit pro Stimmungsstufe VORGEBACKENER Einfärbung (Nacht-Silhouette + atmosphärischer Dunst +
 * Bodenschatten). Pro Frame kostet eine Ebene damit nur einen ganzzahligen Blit (zwei während einer Überblendung)
 * plus optionale additive Leuchtkacheln. Varianten werden lazy erzeugt; `StagePrep` verteilt das Backen der Folgestufe
 * auf wenige, zeitlich gedrosselte Schritte (kein Stau am Stufenwechsel), `WarmQueue` (warm.ts) nutzt Leerlaufzeit.
 */
import { blitTiled, paint, touchCanvas, type Ctx2D } from "./canvas";

export interface StageTint {
  /** Flache Einfärbung (z.B. Nacht-Silhouette) */
  night?: { color: string; a: number };
  /** Vertikaler Dunst-Verlauf über die Höhe der Quelle */
  haze?: { color: string; aTop: number; aBottom: number };
  /** Abdunkeln zum unteren Rand hin (Kontakt-/Bodenschatten), ab Anteil `from` der Höhe */
  shade?: { color: string; a: number; from: number };
}

/** Wanduhr in Millisekunden (performance.now, sonst Date.now – z.B. in Tests ohne Fenster). */
export function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export interface StageCacheOpts {
  /**
   * Verworfene Stufen-Flächen für den nächsten Bake aufheben und dem `make` anbieten (zweiter Parameter; passende Größe
   * mit `recycled()`/`paint(…, reuse)` nutzen, sonst einfach ignorieren). Nur sinnvoll, wenn `make` sie auch verwendet:
   * ungenutzte Angebote werden verworfen, es bleibt also nie mehr als eine Stufe zusätzlich im Speicher.
   */
  recycle?: boolean;
  /**
   * Vorarbeit für einen Bake (z.B. ein gemeinsames Rohbild malen), damit ein Schritt klein bleibt. Rückgabe true =
   * es wurde jetzt Arbeit geleistet (der eigentliche Bake folgt im nächsten Schritt), false = nichts (mehr) vorzubereiten.
   */
  prep?: (stage: number) => boolean;
  /**
   * Hält die Vorarbeit eigenen Zustand je Stufe (z.B. ein unfertiges Rohbild), muss er mit den Stufen des Caches
   * verschwinden: wird bei jedem `keep(a, b)` aufgerufen (auch bei leerem Cache, vor dem Verwerfen) und soll allen Zustand
   * für andere Stufen als a und b verwerfen. Läuft pro Frame – ohne Allokation, im Normalfall nur eine Längenprüfung.
   */
  onKeep?: (a: number, b: number) => void;
  /** Wie `onKeep`, für `clear()`: allen Zustand der Vorarbeit verwerfen (er gehört zur alten Skala/Größe) */
  onClear?: () => void;
}

/** Lazy erzeugte Zeichenflächen pro Stufe (z.B. Himmel), mit Verwerfen alter Stufen. */
export class StageCache {
  private cache = new Map<number, HTMLCanvasElement>();
  private spare: HTMLCanvasElement | null = null;
  private readonly recycle: boolean;
  private readonly prep: ((stage: number) => boolean) | undefined;
  private readonly onKeep: ((a: number, b: number) => void) | undefined;
  private readonly onClear: (() => void) | undefined;
  /** Anzahl tatsächlich gebackener Varianten seit Erzeugung (Diagnose, Tests) */
  baked = 0;
  /** gleitender Mittelwert der Bake-Dauer in ms (Schätzung für Zeitbudgets) */
  costMs = 4;

  constructor(
    private readonly make: (stage: number, reuse: HTMLCanvasElement | null) => HTMLCanvasElement,
    opts: StageCacheOpts = {},
  ) {
    this.recycle = !!opts.recycle;
    this.prep = opts.prep;
    this.onKeep = opts.onKeep;
    this.onClear = opts.onClear;
  }

  has(stage: number): boolean {
    return this.cache.has(stage);
  }

  get(stage: number): HTMLCanvasElement {
    let c = this.cache.get(stage);
    if (!c) {
      const t0 = nowMs();
      const offer = this.spare;
      this.spare = null;
      c = this.make(stage, offer);
      // Rasterkosten in diesen (gedrosselten) Schritt ziehen statt in den ersten Frame, der die Fläche zeichnet
      touchCanvas(c);
      this.baked += 1;
      this.costMs = this.costMs * 0.5 + (nowMs() - t0) * 0.5;
      this.cache.set(stage, c);
    }
    return c;
  }

  /**
   * Ein Bake-Schritt für `stage`: erst die Vorarbeit (`prep`), danach der Bake selbst. Rückgabe true = es wurde Arbeit
   * geleistet, false = die Variante lag schon vor.
   */
  step(stage: number): boolean {
    if (this.cache.has(stage)) return false;
    if (this.prep?.(stage)) return true;
    this.get(stage);
    return true;
  }

  /** Nur die Stufen a und b im Cache behalten (Normalfall ohne Iteration und Allokation) */
  keep(a: number, b: number): void {
    this.onKeep?.(a, b); // Zustand der Vorarbeit für andere Stufen mit verwerfen (auch bei leerem Cache)
    const n = this.cache.size;
    if (n === 0) return;
    let own = 0;
    if (this.cache.has(a)) own += 1;
    if (b !== a && this.cache.has(b)) own += 1;
    if (own === n) return;
    for (const [k, c] of this.cache) {
      if (k === a || k === b) continue;
      this.cache.delete(k);
      if (this.recycle) this.spare = c;
    }
  }

  /** Alles verwerfen (z.B. bei Skalenwechsel), die Flächen bleiben zur Wiederverwendung erhalten */
  clear(): void {
    this.onClear?.();
    for (const [, c] of this.cache) if (this.recycle) this.spare = c;
    this.cache.clear();
  }

  /** Eine verworfene Fläche (z.B. ein unfertiges Rohbild der vorigen Stufe) für den nächsten Bake anbieten; nur mit `recycle` */
  offerSpare(c: HTMLCanvasElement): void {
    if (this.recycle) this.spare = c;
  }

  /** Zwischengelagerte Fläche freigeben (Speicher) */
  dropSpare(): void {
    this.spare = null;
  }

  /** Zwischengelagerte Fläche entnehmen (für eine `prep`-Vorarbeit, die selbst malt); null, wenn keine vorliegt */
  takeSpare(): HTMLCanvasElement | null {
    const c = this.spare;
    this.spare = null;
    return c;
  }
}

/**
 * Ein Einfärbe-Schritt eines `gradedCache` (malt auf die fertige Fläche). Rückgabe `false` = nichts getan (z.B. Stufe ohne
 * Stimmungsmischung): der Cache geht dann im selben Aufruf zum nächsten Schritt, es wird kein Zeitfenster verbraucht.
 */
export type GradeStep = (canvas: HTMLCanvasElement, stage: number) => boolean | void;

/**
 * Stufen-Cache in mehreren kleinen Schritten: `paintBase(stage, reuse, false)` malt das Rohbild (Vorarbeit), danach legen
 * die `grade`-Schritte die Stufen-Färbung darauf – alle bis auf den letzten als Vorarbeit, der letzte ist der eigentliche
 * Bake. Jeder Schritt wird sofort gerastert (`touchCanvas`), damit seine Kosten nicht im ersten Frame mit der Fläche
 * anfallen. Die Schritte nacheinander müssen dasselbe Bild ergeben wie `paintBase(stage, reuse, true)` (Direktweg ohne
 * Vorarbeit, wenn die Stufe sofort gebraucht wird). Höchstens 5 Schritte insgesamt (StagePrep erlaubt 6 je Variante und Aufruf).
 * Ein unfertiges Rohbild lebt nur so lange wie seine Stufe: `keep(a, b)` verwirft die anderer Stufen, `clear()` (Skalenwechsel)
 * alle – danach beginnt die Stufe von vorn, in der dann gültigen Größe.
 */
export function gradedCache(
  paintBase: (stage: number, reuse: HTMLCanvasElement | null, grade: boolean) => HTMLCanvasElement,
  grade: GradeStep | readonly GradeStep[],
): StageCache {
  const steps: readonly GradeStep[] = typeof grade === "function" ? [grade] : grade;
  const last = steps.length - 1;
  const pending = new Map<number, { c: HTMLCanvasElement; done: number }>();
  const cache: StageCache = new StageCache(
    (stage, reuse) => {
      const p = pending.get(stage);
      if (!p) return paintBase(stage, reuse, true);
      pending.delete(stage);
      for (let i = p.done; i <= last; i += 1) steps[i](p.c, stage);
      return p.c;
    },
    {
      recycle: true,
      prep: (stage) => {
        const p = pending.get(stage);
        if (!p) {
          const base = paintBase(stage, cache.takeSpare(), false);
          touchCanvas(base); // Rohbild jetzt rastern; die Schritte danach rastern nur noch ihren Anteil
          pending.set(stage, { c: base, done: 0 });
          return true;
        }
        // Zwischenschritte (alle außer dem letzten); einer ohne Wirkung kostet kein Zeitfenster
        while (p.done < last) {
          const did = steps[p.done](p.c, stage) !== false;
          p.done += 1;
          if (did) {
            touchCanvas(p.c);
            return true;
          }
        }
        return false;
      },
      // Unfertige Rohbilder gehören zu ihrer Stufe und Größe: mit der Stufe (keep) bzw. beim Skalenwechsel (clear) verwerfen,
      // sonst setzt das nächste step/get mit einem Rohbild in alter Größe fort. Die Flächen gehen als Ersatz an den Cache.
      onKeep: (a, b) => {
        if (pending.size === 0) return;
        for (const [k, p] of pending) {
          if (k === a || k === b) continue;
          pending.delete(k);
          cache.offerSpare(p.c);
        }
      },
      onClear: () => {
        for (const [, p] of pending) cache.offerSpare(p.c);
        pending.clear();
      },
    },
  );
  return cache;
}

/** Quelle + lazy erzeugte, pro Stufe eingefärbte Varianten (`recycle`: verworfene Stufen für den nächsten Bake wiederverwenden) */
export class Staged extends StageCache {
  constructor(
    readonly src: HTMLCanvasElement,
    tint: (stage: number) => StageTint,
    recycle = false,
  ) {
    super((stage, reuse) => tinted(src, tint(stage), reuse), { recycle });
  }
}

export function tinted(src: HTMLCanvasElement, t: StageTint, reuse?: HTMLCanvasElement | null): HTMLCanvasElement {
  return paint(src.width, src.height, (g, w, h) => {
    g.drawImage(src, 0, 0);
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
  }, reuse);
}

export interface StagedLayer {
  staged: Staged;
  lights: HTMLCanvasElement | null;
  lights2: HTMLCanvasElement | null;
  /** vertikaler Versatz der Leuchtkacheln relativ zur Ebene (zugeschnittene Lichtbänder) */
  lightsDy: number;
  w: number;
  h: number;
  y: number;
  factor: number;
}

export function stagedLayer(
  tile: HTMLCanvasElement,
  y: number,
  factor: number,
  tint: (stage: number) => StageTint,
  opts: { lights?: HTMLCanvasElement | null; lights2?: HTMLCanvasElement | null; lightsDy?: number; recycle?: boolean } = {},
): StagedLayer {
  return {
    staged: new Staged(tile, tint, opts.recycle),
    lights: opts.lights ?? null,
    lights2: opts.lights2 ?? null,
    lightsDy: opts.lightsDy ?? 0,
    w: tile.width,
    h: tile.height,
    y,
    factor,
  };
}

/** Zeichnet Stufe `stage` (und blendet `blend` in stage+1). */
export function drawStaged(g: Ctx2D, L: StagedLayer, dist: number, stage: number, blend: number, maxStage: number, lightA = 0, lights2A = lightA, dy = 0): void {
  const scroll = dist * L.factor;
  const y = L.y + dy;
  const a = L.staged.get(stage);
  blitTiled(g, a, L.w, L.h, scroll, y);
  if (blend > 0.004 && stage + 1 <= maxStage) {
    const pa = g.globalAlpha;
    g.globalAlpha = pa * blend;
    blitTiled(g, L.staged.get(stage + 1), L.w, L.h, scroll, y);
    g.globalAlpha = pa;
  }
  drawLights(g, L, scroll, y, lightA, lights2A);
}

export function drawLights(g: Ctx2D, L: StagedLayer, scroll: number, y: number, lightA: number, lights2A: number): void {
  if (!((L.lights && lightA > 0.03) || (L.lights2 && lights2A > 0.03))) return;
  const pa = g.globalAlpha;
  const op = g.globalCompositeOperation;
  g.globalCompositeOperation = "lighter";
  if (L.lights && lightA > 0.03) {
    g.globalAlpha = pa * Math.min(1, lightA);
    blitTiled(g, L.lights, L.lights.width, L.lights.height, scroll, y + L.lightsDy);
  }
  if (L.lights2 && lights2A > 0.03) {
    g.globalAlpha = pa * Math.min(1, lights2A);
    blitTiled(g, L.lights2, L.lights2.width, L.lights2.height, scroll, y + L.lightsDy);
  }
  g.globalAlpha = pa;
  g.globalCompositeOperation = op;
}

/**
 * Hält für alle Staged-Objekte die Varianten `stage` und `stage+1` bereit; erzeugt pro Aufruf höchstens `budget`
 * fehlende Varianten (Verteilung der Kosten über mehrere Frames) und verwirft alte. Einfache Variante ohne Zeitsteuerung
 * (die Folgestufe wird sofort vorbereitet) – Welten mit Stufen-Fortschritt nutzen `StagePrep`.
 */
export function prepareStaged(list: StageCache[], stage: number, maxStage: number, budget = 1): void {
  let made = 0;
  const next = Math.min(maxStage, stage + 1);
  for (const s of list) {
    s.keep(stage, next);
    if (made < budget && !s.has(stage)) {
      s.step(stage);
      made += 1;
    }
    if (made < budget && !s.has(next)) {
      s.step(next);
      made += 1;
    }
  }
}

/** Fortschritt 0..1 innerhalb der aktuellen Stufe aus den Welt-Metern (Stufenlänge `stageMeters`). */
export function stageProgress(worldMeters: number, stageMeters: number): number {
  if (!(stageMeters > 0) || !Number.isFinite(worldMeters)) return 0;
  const p = worldMeters / stageMeters;
  return p - Math.floor(p);
}

/** `onApproach` kommt so viel Stufenfortschritt vor dem Beginn des Vorbackens (≈ 2,5 s bei 260 m Stufenlänge und 25 m/s) */
const APPROACH_LEAD = 0.1;

/** höchstens so viele Schritte (Vorarbeit + Bake) je Variante und Aufruf – Schutz gegen eine fehlerhafte Vorarbeit */
const MAX_STEPS_PER_VARIANT = 6;

export interface StagePrepOpts {
  /** Folgestufe erst ab diesem Fortschritt (0..1) der aktuellen Stufe vorbacken (Standard 0,28) */
  nextFrom?: number;
  /** Wie `nextFrom` auf Qualität 0 (`setLow`; Standard 0,6): die Folgestufe belegt dort möglichst kurz Speicher */
  nextFromLow?: number;
  /**
   * Einmal je Stufe, kurz bevor die Folgestufe vorbereitet wird (Fortschritt ab `nextFrom` − 0,1, auf Qualität 0 ab
   * `nextFromLow` − 0,1): Parameter = Folgestufe. Für Arbeit, die nicht in den Bake-Schritt gehört und sonst im selben
   * Frame zuschlüge (z.B. das Kulissenbild der Folgestufe vordekodieren). Läuft im Frame der Meldung, nie am Stufenanfang.
   */
  onApproach?: (next: number) => void;
  /** Mindestabstand zweier Bake-Schritte in Millisekunden (Standard 100 ≈ 6 Frames) */
  gapMs?: number;
  /** Uhr (Tests); Standard performance.now */
  now?: () => number;
}

/**
 * Zeitgesteuertes Vorbacken der Stufen-Varianten einer Welt. Die aktuelle Stufe liegt immer vor (fehlende werden sofort
 * gebacken – sie wird gleich gezeichnet). Die Folgestufe wird NICHT am Stufenanfang vorbereitet (dort drängt sich sonst
 * alles auf den Übergang), sondern erst ab `nextFrom` des Stufen-Fortschritts und höchstens einen Schritt je `gapMs`;
 * beginnt die Überblendung (blend > 0) und fehlt noch etwas, wird nachgeholt (gezeichnet würde es ohnehin).
 */
export class StagePrep {
  private lastAt = -1e9;
  private low = false;
  /** Stufe, für die `onApproach` schon gemeldet wurde */
  private approached = -1;
  private readonly onApproach: ((next: number) => void) | undefined;
  private readonly nextFrom: number;
  private readonly nextFromLow: number;
  private readonly gapMs: number;
  private readonly now: () => number;

  constructor(
    private readonly list: StageCache[],
    private readonly maxStage: number,
    opts: StagePrepOpts = {},
  ) {
    this.nextFrom = opts.nextFrom ?? 0.28;
    this.nextFromLow = opts.nextFromLow ?? 0.6;
    this.onApproach = opts.onApproach;
    this.gapMs = opts.gapMs ?? 100;
    this.now = opts.now ?? nowMs;
  }

  /**
   * Qualität 0 (schwache Geräte, wenig Speicher): die Folgestufe wird nicht im Leerlauf (`warm`) und erst ab `nextFromLow`
   * des Stufen-Fortschritts vorgebacken; beginnt die Überblendung, wird Fehlendes wie immer sofort nachgeholt. Läuft pro
   * Frame (nur eine Zuweisung).
   */
  setLow(on: boolean): void {
    this.low = on;
  }

  /** Cache nachträglich aufnehmen (z.B. Landmarken, die erst beim Laden entstehen) */
  add(c: StageCache): void {
    if (!this.list.includes(c)) this.list.push(c);
  }

  /** Cache aus der Verwaltung nehmen (z.B. Spiegelungen, die auf Q0 nicht gezeichnet werden) */
  remove(c: StageCache): void {
    const i = this.list.indexOf(c);
    if (i >= 0) this.list.splice(i, 1);
  }

  /**
   * Pro Frame aus update(): `progress` = Fortschritt in der Stufe (siehe `stageProgress`), `blend` = Überblendung in die
   * Folgestufe. Rückgabe: Anzahl der Bake-Schritte dieses Aufrufs.
   */
  step(stage: number, progress: number, blend: number): number {
    const list = this.list;
    const next = Math.min(this.maxStage, stage + 1);
    let made = 0;
    for (let i = 0; i < list.length; i += 1) {
      const c = list[i];
      c.keep(stage, next);
      // aktuelle Stufe: wird jetzt gezeichnet → sofort, ganz (Vorarbeit + Bake; Schutz gegen eine Vorarbeit ohne Ende)
      for (let guard = 0; !c.has(stage) && guard < MAX_STEPS_PER_VARIANT; guard += 1) {
        c.step(stage);
        made += 1;
      }
    }
    if (next === stage) return made;
    const urgent = blend > 0.001;
    const from = this.low ? this.nextFromLow : this.nextFrom;
    if (this.onApproach && this.approached !== stage && progress >= from - APPROACH_LEAD) {
      this.approached = stage;
      this.onApproach(next);
    }
    if (!urgent && progress < from) return made;
    const t = this.now();
    if (!urgent) {
      if (t < this.lastAt) this.lastAt = t; // Uhr zurückgesetzt
      if (t - this.lastAt < this.gapMs) return made;
    }
    for (let i = 0; i < list.length; i += 1) {
      const c = list[i];
      if (c.has(next)) continue;
      c.step(next);
      made += 1;
      this.lastAt = t;
      if (!urgent) break;
      // bei Dringlichkeit: diesen Cache zu Ende bringen (Vorarbeit + Bake), dann weiter
      for (let guard = 1; !c.has(next) && guard < MAX_STEPS_PER_VARIANT; guard += 1) {
        c.step(next);
        made += 1;
      }
    }
    return made;
  }

  /**
   * Leerlauf (Countdown, Menü-Demo, Lauf-Anfang): fehlende Varianten der Stufe und der Folgestufe backen, solange das
   * Budget reicht (der erste Schritt läuft immer); auf Qualität 0 (`setLow`) nur die aktuelle Stufe. true = nichts mehr zu tun.
   */
  warm(stage: number, budgetMs: number): boolean {
    const next = this.low ? stage : Math.min(this.maxStage, stage + 1);
    const t0 = this.now();
    let did = false;
    for (let pass = 0; pass < 2; pass += 1) {
      const target = pass === 0 ? stage : next;
      if (pass === 1 && next === stage) break;
      for (let i = 0; i < this.list.length; i += 1) {
        const c = this.list[i];
        // Vorarbeit und Bake sind getrennte Schritte; Schutz gegen eine Vorarbeit ohne Ende
        for (let guard = 0; !c.has(target) && guard < MAX_STEPS_PER_VARIANT; guard += 1) {
          // der erste Schritt läuft immer (sonst verhungert ein großer Bake); weitere nur, wenn sie ins Budget passen
          if (did && this.now() - t0 + c.costMs > budgetMs) return false;
          did = true;
          c.step(target);
        }
      }
    }
    return true;
  }
}

export function rgbaOf(color: string, a: number): string {
  const al = Math.max(0, Math.min(1, a)).toFixed(3);
  if (color.startsWith("#")) {
    let h = color.slice(1);
    if (h.length === 3) h = h.split("").map((x) => x + x).join("");
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${al})`;
  }
  if (color.startsWith("rgb(")) return color.replace("rgb(", "rgba(").replace(")", `,${al})`);
  return color;
}
