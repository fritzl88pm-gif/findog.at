/**
 * Fredrun 2.0 – gemeinsame Typen und Schnittstellen.
 *
 * Diese Datei ist der VERTRAG zwischen Engine (sim.ts, render.ts, game.ts) und den Welt-Modulen
 * (worlds/*.ts). Welt-Module liefern: Muster (Patterns) für den Level-Generator, Skins (Zeichenfunktionen)
 * für Entitäten, einen WorldRenderer (Parallax-Hintergrund, Boden, Vordergrund, Wetter) und optionale
 * Systeme (Blitze, Lawine …).
 */
import type { Rng } from "./rng";
import type { Sim } from "./sim";

import type { MusicTrackId } from "./audio/types";

export const WORLD_IDS = ["wien", "alpen", "finanzamt", "prater", "wachau", "cyber", "winter", "oper"] as const;
export type WorldId = (typeof WORLD_IDS)[number];

export const CHARACTER_IDS = ["fred", "frida", "superfred", "cyberfred", "superfrida"] as const;
export type CharacterId = (typeof CHARACTER_IDS)[number];

export type PickupType = "coin" | "gem" | "heart" | "magnet" | "shield" | "slowmo" | "turbo";

/**
 * Entitäts-Archetypen. Die Engine besitzt Physik und Kollision; Welten liefern nur Aussehen (skin) und Parameter.
 *
 *  block      Bodenhindernis (Rechteck auf dem Boden). Überspringen. `breakable` → Dash/Stampf zerstört es.
 *  overhead   Hängt von oben herab (Unterkante `bottom` über Boden). Nur RUTSCHEN kommt durch.
 *  pit        Bodenlücke (kein Boden). Überspringen oder über Plattformen. `skin` "water" o.ä. nur Optik.
 *  platform   Einseitige Plattform (Oberkante = y). Optional beweglich (p.ampX/ampY/per/ph) oder bröckelnd (p.crumble=Sek.).
 *  walker     Bodengegner mit Eigengeschwindigkeit `vx` (relativ zur Welt, negativ = kommt schneller entgegen). `stompable`.
 *  flyer      Fluggegner, Sinusflug (p.baseY, p.amp, p.per, p.ph; optional p.track = Verfolgungsrate 0..1). `stompable` optional.
 *  projectile Geschoss mit vx (und optional Bogen p.gravity). Zerstörbar per Dash.
 *  swinger    Pendel (p.ax, p.ay = Ankerpunkt in Weltkoordinaten relativ zum Muster-Start, p.len, p.amp rad, p.per s, p.ph, p.r = Radius).
 *  zone       Zeitgesteuerte Gefahrenzone (Blitz, Stempel, Laser …): `cycle.phases` (warn/active/idle), Treffer nur in harmful-Phase.
 *             `p.blockStand = 1` verhindert das Aufstehen aus dem Rutschen unter der Zone (wie ein Überhang).
 *  spring     Sprungfeder / Trampolin (Bodenkontakt → SPRING_V).
 *  portal     Schwerkraft-Portal (senkrechte Linie): kippt die Schwerkraft beim Durchlaufen (nur in Welten mit gravityFlip).
 *  wind       Aufwindzone (Rechteck): p.lift = Beschleunigung nach oben (px/s²) solange Spieler drin ist.
 *  speedzone  Tempozone (Rechteck am Boden): p.mult = Tempofaktor (z.B. 0.7 Schlamm/Papier, 1.35 Förderband).
 *  pickup     Sammelobjekt (Münze, Herz, Power-up); Größe w = h = Durchmesser.
 *  decor      Reine Deko, keine Kollision (kann per Skin animiert werden).
 */
export type EntKind =
  | "block"
  | "overhead"
  | "pit"
  | "platform"
  | "walker"
  | "flyer"
  | "projectile"
  | "swinger"
  | "zone"
  | "spring"
  | "portal"
  | "wind"
  | "speedzone"
  | "pickup"
  | "decor";

export interface ZonePhase {
  /** "warn" = sichtbar, aber harmlos; "active" = gefährlich; "idle" = Pause */
  name: "warn" | "active" | "idle";
  dur: number;
}

export interface ZoneCycle {
  phases: ZonePhase[];
  /** true = Wiederholung; false = einmaliger Ablauf, danach entfernt */
  loop: boolean;
  /** Startversatz in Sekunden (verschiebt die Phasen) */
  offset: number;
}

export type Hitbox = [ox: number, oy: number, w: number, h: number];

export interface Ent {
  id: number;
  kind: EntKind;
  /** Kennung für die Optik der Welt (z.B. "tram", "stamp", "crate"). */
  skin: string;
  /** Weltkoordinaten (Pixel), linke obere Ecke der sichtbaren Fläche. Bildschirm-x = x - dist. */
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  /** Trefferfläche relativ zur linken oberen Ecke. */
  hb: Hitbox;
  harmful: boolean;
  stompable: boolean;
  breakable: boolean;
  /** an der Decke verankert (Gravitationswelten) */
  ceil: boolean;
  /** Off-Screen-Warnmarker anzeigen, solange rechts außerhalb und im Anflug */
  warn: boolean;
  dead: boolean;
  age: number;
  /** freier Zustand für Skins/Verhalten: "idle" | "warn" | "active" | "crumbling" | "defeated" | "broken" ... */
  state: string;
  stateT: number;
  cycle?: ZoneCycle;
  pickup?: PickupType;
  /** freie numerische Parameter (siehe EntKind-Doku) */
  p: Record<string, number>;
  /** Engine-intern */
  minClear: number;
  passed: boolean;
  /** Skins dürfen hier eigenen Zustand ablegen (Animation, Zufall) */
  fx: Record<string, number>;
  /** ID des Musters, das dieses Element erzeugt hat (Diagnose/Tests) */
  pat: string;
}

/** Pattern-Baustein; alle x relativ zum Muster-Start, y absolut (Bildschirm), aber nutze die Builder in PatternCtx. */
export type EntSpec = Partial<Omit<Ent, "id" | "kind" | "skin" | "x" | "y" | "w" | "h">> & {
  kind: EntKind;
  skin: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

// --- Level-Generator ----------------------------------------------------------------------------

export type PatternTag = "hop" | "slide" | "gap" | "enemy" | "timing" | "combo" | "special" | "reward" | "flip";

export interface BuilderOpts {
  skin?: string;
  breakable?: boolean;
  stompable?: boolean;
  warn?: boolean;
  vx?: number;
  hb?: Hitbox;
  p?: Record<string, number>;
  state?: string;
  ceil?: boolean;
}

/**
 * Baukasten für Muster. Alle "elev"-Angaben sind Höhen ÜBER der Lauffläche (Boden bzw. bei ceil=true UNTER der Decke).
 * `dt` / `t()` sind ZEITEN in Sekunden bei aktuellem Tempo – Abstände in Zeit zu definieren garantiert, dass ein Muster
 * bei jedem Tempo mit derselben Reaktionszeit lösbar bleibt. Breiten/Höhen sind Pixel.
 */
export interface PatternCtx {
  readonly speed: number;
  /** Schwierigkeit 0 … ~12 (Fließkomma) */
  readonly diff: number;
  readonly groundY: number;
  readonly ceilY: number;
  readonly rng: Rng;
  /** Horizontale Weite eines vollen Einzelsprungs bei diesem Tempo (px) */
  readonly jumpDist: number;
  readonly worldId: WorldId;
  /** Sekunden → Pixel bei aktuellem Tempo */
  t(sec: number): number;
  /** Rohes Hinzufügen */
  add(spec: EntSpec): EntSpec;
  block(dx: number, w: number, h: number, o?: BuilderOpts): EntSpec;
  /** Hängendes Hindernis: Unterkante `bottom` px über dem Boden; dicke `thick` px darüber (bis zur Bildschirmoberkante möglich). */
  overhead(dx: number, w: number, bottom: number, o?: BuilderOpts & { thick?: number }): EntSpec;
  pit(dx: number, w: number, o?: BuilderOpts): EntSpec;
  platform(dx: number, w: number, elev: number, o?: BuilderOpts & { thick?: number; crumble?: number; ampX?: number; ampY?: number; per?: number; ph?: number }): EntSpec;
  walker(dx: number, w: number, h: number, o?: BuilderOpts): EntSpec;
  flyer(dx: number, w: number, h: number, elev: number, o?: BuilderOpts & { amp?: number; per?: number; ph?: number; track?: number }): EntSpec;
  projectile(dx: number, w: number, h: number, elev: number, o?: BuilderOpts & { gravity?: number }): EntSpec;
  swinger(dx: number, anchorElev: number, len: number, o?: BuilderOpts & { amp?: number; per?: number; ph?: number; r?: number }): EntSpec;
  zone(dx: number, w: number, h: number, elev: number, phases: ZonePhase[], o?: BuilderOpts & { loop?: boolean; offset?: number }): EntSpec;
  spring(dx: number, w?: number, o?: BuilderOpts): EntSpec;
  portal(dx: number, o?: BuilderOpts): EntSpec;
  wind(dx: number, w: number, h: number, elev: number, lift: number, o?: BuilderOpts): EntSpec;
  speedzone(dx: number, w: number, mult: number, o?: BuilderOpts): EntSpec;
  decor(dx: number, w: number, h: number, elev: number, o?: BuilderOpts): EntSpec;
  pickup(type: PickupType, dx: number, elev: number, o?: BuilderOpts): EntSpec;
  coin(dx: number, elev: number, o?: BuilderOpts): EntSpec;
  /** Münzreihe waagrecht (n Stück, Abstand `gap` px) */
  coinLine(dx: number, elev: number, n: number, gap?: number, o?: BuilderOpts): void;
  /** Münzbogen, der einem vollen Sprung folgt: startet bei dx, spannt `span` px, Scheitelhöhe `apex` px */
  coinArc(dx: number, span: number, apex: number, n?: number, o?: BuilderOpts): void;
  /** Bogen über ein Hindernis der Breite w (zentriert bei dx + w/2) */
  coinsOver(dx: number, w: number, clear: number, n?: number, o?: BuilderOpts): void;
}

export interface PatternDef {
  id: string;
  /** relative Auswahlwahrscheinlichkeit (Standard 1) */
  weight?: number;
  minDiff: number;
  maxDiff?: number;
  tags?: PatternTag[];
  /**
   * Muster aufbauen. Rückgabe = Länge des Musters in Pixeln (Abstand Start → Ende des letzten Elements).
   * Der Generator fügt danach eine (schwierigkeitsabhängige) Ruhezone an.
   */
  build(c: PatternCtx): number;
}

// --- Welt-Systeme (Sonderereignisse) ------------------------------------------------------------

export interface WorldSystem {
  /** Wird in jedem Sim-Schritt aufgerufen (dt bereits durch Slow-Mo skaliert). Darf Sim.spawn/vars/speedMult/hurt nutzen. */
  update(sim: Sim, dt: number): void;
  /** Nach einem Treffer des Spielers (z.B. Lawine holt auf). */
  onHurt?(sim: Sim, source: string): void;
  /** Spielstart / Welt betreten */
  reset?(sim: Sim): void;
}

// --- Rendering -----------------------------------------------------------------------------------

export interface ViewState {
  readonly w: number;
  readonly h: number;
  /** interpolierte Scroll-Distanz (px). Bildschirm-x einer Entität = e.x - dist. */
  readonly dist: number;
  readonly speed: number;
  /** Spielzeit in Sekunden (läuft auch beim Sterben weiter, nicht in Pause) */
  readonly time: number;
  readonly dt: number;
  readonly groundY: number;
  readonly ceilY: number;
  /** Meter in DIESER Welt seit Betreten (0 … ∞) */
  readonly worldMeters: number;
  /** Stimmungsstufe 0…(stageCount-1) und Überblendung 0…1 in die nächste Stufe */
  readonly stage: number;
  readonly stageBlend: number;
  /** 0…1 Ambient-Intensität (Schwierigkeit) für Wetter, Partikel etc. */
  readonly intensity: number;
  readonly gravDir: 1 | -1;
  readonly playerX: number;
  readonly playerFeetY: number;
  /** 0..1 Treffer-Nachglühen */
  readonly hurtGlow: number;
  readonly dashing: boolean;
  readonly turbo: boolean;
  readonly slowmo: number;
  readonly reducedMotion: boolean;
  /** 0 = niedrig, 1 = mittel, 2 = hoch. Welten sollten bei 0 Partikel/Effekte reduzieren. */
  readonly quality: 0 | 1 | 2;
  /** Vom Welt-System gefüllte Werte (z.B. avalancheGap, lightningFlash, darkness) */
  readonly vars: Readonly<Record<string, number>>;
  /** Kurzer Blitz-/Flashwert 0..1 vom Sim (z.B. Blitz) */
  readonly flash: number;
}

export interface SpriteOpts {
  /** Zielhöhe in px (Breite proportional) */
  h?: number;
  /** Zielbreite in px (Höhe proportional). h hat Vorrang. */
  w?: number;
  /** Skalierungsfaktor auf Originalgröße der Zelle */
  scale?: number;
  flipX?: boolean;
  flipY?: boolean;
  /** Animationszeit in Sekunden (Frameauswahl) */
  t?: number;
  /** ab 0 starten und nicht loopen */
  once?: boolean;
  alpha?: number;
  rotation?: number;
  /** überschreibt Anker (0..1) */
  ax?: number;
  ay?: number;
  frame?: number;
}

export interface PropLibrary {
  has(id: string): boolean;
  /** Laden (idempotent). Fehler werden verschluckt → has() bleibt false. */
  preload(ids: string[]): Promise<void>;
  /** Zeichnet Prop mit Anker (x,y). Rückgabe false, wenn nicht verfügbar. */
  draw(g: CanvasRenderingContext2D, id: string, x: number, y: number, o?: SpriteOpts): boolean;
  /** Rohmaße einer Zelle (Sheet-Pixel) */
  cell(id: string): { w: number; h: number; frames: number } | null;
}

export interface AssetLoader {
  image(url: string): Promise<HTMLImageElement | null>;
  props: PropLibrary;
}

export interface WorldRenderer {
  /** Einmaliges Laden (z.B. Bilder, Prop-Sprites). Darf scheitern → Renderer muss ohne Bilder gut aussehen. */
  load(assets: AssetLoader): Promise<void>;
  /** Wird bei Größenwechsel aufgerufen (logische Größe bleibt 1280×720; dpr = Pixeldichte der Zeichenfläche) */
  resize?(dpr: number): void;
  /** Ambiente-Animation pro Frame (Wolken, Wetter, Partikel) */
  update(dt: number, v: ViewState): void;
  /** Himmel + Parallax-Ebenen (hinter Boden & Spielgeschehen). Muss die komplette Fläche 1280×720 füllen. */
  drawBackground(g: CanvasRenderingContext2D, v: ViewState): void;
  /** Lauffläche/Boden inkl. Lücken (pits: Bildschirm-x-Intervalle [x0,x1] ohne Boden). Zeichnet ab groundY nach unten. */
  drawGround(g: CanvasRenderingContext2D, v: ViewState, pits: ReadonlyArray<{ x0: number; x1: number; skin: string }>): void;
  /**
   * Entität zeichnen. (sx, sy) = Bildschirmposition der linken oberen Ecke (e.x - dist, e.y).
   * Rückgabe true, wenn gezeichnet; false → Standard-Fallback der Engine (einfache Formen).
   */
  drawEntity(g: CanvasRenderingContext2D, e: Ent, sx: number, sy: number, v: ViewState): boolean;
  /** Vordergrund über Spielfigur: Wetter, nahe Parallax-Objekte, Nebel */
  drawForeground(g: CanvasRenderingContext2D, v: ViewState): void;
  /** Optionale Endstufe (Licht/Dunkelheit/Color-Grading) über allem außer HUD */
  drawOverlay?(g: CanvasRenderingContext2D, v: ViewState): void;
}

// --- Welt-Definition ------------------------------------------------------------------------------

export interface WorldDef {
  id: WorldId;
  name: string;
  tagline: string;
  description: string;
  /** Mechanik-Stichpunkte für das Menü (max. 4, je kurz) */
  mechanics: string[];
  /** UI-Akzentfarbe (CSS) */
  accent: string;
  /** dunkle UI-Farbe für Karten (CSS) */
  accentDark: string;
  music: MusicTrackId;
  /** Bodenlinie; Standard DEFAULT_GROUND_Y */
  groundY?: number;
  /** Schwerkraft-Umkehr möglich (Decke ceilY) */
  gravityFlip?: boolean;
  ceilY?: number;
  /** Tempofaktor auf globale Kurve (Standard 1) */
  speedScale?: number;
  /** Meter pro Stimmungsstufe und Anzahl Stufen (Renderer bekommt v.stage/v.stageBlend) */
  stageMeters: number;
  stageCount: number;
  stageNames: string[];
  patterns: PatternDef[];
  /** Systeme pro Lauf frisch instanziieren */
  createSystems?: () => WorldSystem[];
  createRenderer: () => WorldRenderer;
  /** Prop-IDs (aus public/fredrun2/props/manifest.json), die diese Welt braucht (Vorladen) */
  propIds?: string[];
}

// --- Sim-Ereignisse (Engine → Audio/Partikel/HUD) ------------------------------------------------

export type SimEventType =
  | "start"
  | "jump"
  | "doublejump"
  | "land"
  | "slide"
  | "slide-end"
  | "dash"
  | "dash-end"
  | "stomp-start"
  | "stomp-land"
  | "bounce"
  | "spring"
  | "portal"
  | "coin"
  | "gem"
  | "heart"
  | "powerup"
  | "shield-on"
  | "shield-hit"
  | "hurt"
  | "death"
  | "near-miss"
  | "combo-up"
  | "combo-break"
  | "enemy-defeat"
  | "wallbreak"
  | "pit-fall"
  | "world-transition"
  | "milestone"
  | "custom";

export interface SimEvent {
  type: SimEventType;
  /** Weltposition des Ereignisses in Bildschirmkoordinaten (x relativ zum Bildschirm, y absolut) */
  x: number;
  y: number;
  value?: number;
  /** z.B. Pickup-Typ, Entitäts-Kind/-Skin oder Systemname */
  tag?: string;
  skin?: string;
}

export type RunMode = "world" | "tour" | "daily";

export interface RunConfig {
  mode: RunMode;
  world: WorldId;
  character: CharacterId;
  seed: number;
  /** Bot/Tests: Startdistanz in Metern (überspringt Einstieg) */
  startMeters?: number;
  /** QA: Meter in der Startwelt (setzt die Stimmungsstufe), unabhängig von startMeters */
  startWorldMeters?: number;
}
