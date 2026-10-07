/**
 * Einsteiger-Hinweise (nur die ersten Läufe): kontextbezogen statt nach Uhrzeit und geräteabhängig im Wortlaut.
 * Reine Logik ohne Sim-/DOM-Zugriff: der Hub liefert pro Frame einen HintContext (Abstände der nächsten Elemente voraus),
 * markiert benutzte Mechaniken (HintScheduler.markUsed) und zeigt das Ergebnis von update() im HUD (hud.hint).
 */

export type HintId = "jump" | "doublejump" | "slide" | "stomp" | "dash";

/** Alle Hinweise in Prioritätsreihenfolge (vorn = wichtiger, weil gerade ein passendes Element anrückt) */
export const HINT_IDS: readonly HintId[] = ["slide", "stomp", "doublejump", "dash", "jump"];

/** Ein Element zählt als "voraus", wenn es weniger als so viele Pixel vor der Figur steht (ca. 1,6 bis 2,7 s bei üblichem Tempo) */
export const HINT_LOOKAHEAD_PX = 1100;
/** Anzeigedauer eines Hinweises in Sekunden */
export const HINT_SHOW_S = 3.5;
/** Kurze Pause zwischen zwei Hinweisen, damit sie nicht ineinanderfließen */
export const HINT_GAP_S = 0.5;
/** Hinweise nur, solange lifetime.runs kleiner ist (die ersten drei Läufe) */
export const HINT_MAX_RUNS = 3;
/** Sprung-Hinweis ab dieser Laufzeit (s) … */
export const JUMP_HINT_AT_S = 0.2;
/** … und nur bis zu dieser (Startphase): später passt "Tippen = springen" nicht mehr in die Lage */
export const JUMP_HINT_UNTIL_S = 2;
/** Dash-Hinweis frühestens ab dieser Laufzeit (s): der Energiering ist von Beginn an gefüllt, die Mechanik soll nicht den Start überdecken */
export const DASH_HINT_AFTER_S = 7;

const TEXTS: Record<HintId, { key: string; touch: string }> = {
  jump: { key: "Springen: Leertaste · halten = höher · nochmal = Doppelsprung", touch: "Tippen = springen · halten = höher · nochmal = Doppelsprung" },
  doublejump: { key: "In der Luft nochmal Leertaste = Doppelsprung", touch: "In der Luft nochmal tippen = Doppelsprung" },
  slide: { key: "Rutschen: ↓ · in der Luft: Stampfen", touch: "Rutschen: ↓-Knopf unten links oder links nach unten wischen" },
  stomp: { key: "Auf Gegner springen = besiegen", touch: "Auf Gegner springen = besiegen" },
  dash: { key: "Dash: Shift – unverwundbar, wenn der Energiering voll genug ist", touch: "⚡-Knopf rechts: Dash, wenn der Ring voll ist" },
};

/** Hinweistext je Gerät: Tastatur (touch=false) oder Touch (ohne Tasten-Namen, die es dort nicht gibt) */
export function hintText(id: HintId, touch: boolean): string {
  return touch ? TEXTS[id].touch : TEXTS[id].key;
}

export interface HintContext {
  /** Laufzeit in Sekunden (ohne Countdown) */
  time: number;
  /** Touch-Gerät (bestimmt nur den Wortlaut) */
  touch: boolean;
  /** Bisherige Läufe insgesamt (lifetime.runs); Hinweise nur bei < HINT_MAX_RUNS */
  runs: number;
  /** Einstellung "Hinweise" */
  hintsEnabled: boolean;
  /** Abstand (px) von der Figur bis zum nächsten Überhang VORAUS; fehlend/null/negativ = keiner */
  overheadDist?: number | null;
  /** … bis zur nächsten Grube voraus */
  pitDist?: number | null;
  /** … bis zum nächsten stompbaren Gegner voraus */
  stompDist?: number | null;
  /** Energie reicht für einen Dash */
  energyReady: boolean;
  /** In diesem Lauf bereits benutzte Mechaniken (zusätzlich zu HintScheduler.markUsed); für reine pickHint-Aufrufe */
  used?: ReadonlySet<HintId>;
}

function ahead(d: number | null | undefined): boolean {
  return d !== null && d !== undefined && d >= 0 && d < HINT_LOOKAHEAD_PX;
}

/** Ist der Hinweis gesperrt (benutzt oder schon gezeigt)? Modulweit statt Closure, damit pick() pro Frame nichts allokiert. */
function blocked(id: HintId, a: ReadonlySet<HintId> | undefined, b: ReadonlySet<HintId> | undefined, c: ReadonlySet<HintId> | undefined): boolean {
  return a?.has(id) === true || b?.has(id) === true || c?.has(id) === true;
}

function pick(ctx: HintContext, used: ReadonlySet<HintId> | undefined, shown: ReadonlySet<HintId> | undefined): HintId | null {
  if (!ctx.hintsEnabled || ctx.runs >= HINT_MAX_RUNS) return null;
  const u = ctx.used;
  const time = Number.isFinite(ctx.time) ? ctx.time : 0;
  if (ahead(ctx.overheadDist) && !blocked("slide", used, u, shown)) return "slide";
  if (ahead(ctx.stompDist) && !blocked("stomp", used, u, shown)) return "stomp";
  if (ahead(ctx.pitDist) && !blocked("doublejump", used, u, shown)) return "doublejump";
  if (ctx.energyReady && time >= DASH_HINT_AFTER_S && !blocked("dash", used, u, shown)) return "dash";
  if (time >= JUMP_HINT_AT_S && time <= JUMP_HINT_UNTIL_S && !blocked("jump", used, u, shown)) return "jump";
  return null;
}

/**
 * Wählt den passenden Hinweis für die aktuelle Lage oder null. Reine Funktion (kennt nur `ctx.used`, nicht, was schon angezeigt
 * wurde – das merkt sich der HintScheduler). Priorität: Rutschen (Überhang < 1100 px) > Stampfen (stompbarer Gegner < 1100 px) >
 * Doppelsprung (Grube < 1100 px) > Dash (Energie bereit, ab 7 s) > Springen (0,2 bis 2 s nach dem Start). Keine Hinweise ab runs >= 3 oder ohne hintsEnabled.
 */
export function pickHint(ctx: HintContext): HintId | null {
  return pick(ctx, undefined, undefined);
}

export interface ActiveHint {
  readonly id: HintId;
  readonly text: string;
}

/**
 * Zeitsteuerung der Hinweise eines Laufs: höchstens einer gleichzeitig, je 3,5 s, jeder Hinweis höchstens einmal pro Lauf und nur,
 * solange die Mechanik in diesem Lauf noch nicht benutzt wurde. `update` liefert den aktuell sichtbaren Hinweis (dasselbe Objekt
 * solange er steht, kein Allokieren pro Frame) oder null.
 */
export class HintScheduler {
  private readonly used = new Set<HintId>();
  private readonly shown = new Set<HintId>();
  private active: ActiveHint | null = null;
  private activeFor = 0;
  private gap = 0;

  /** Neuer Lauf: alles vergessen */
  reset(): void {
    this.used.clear();
    this.shown.clear();
    this.active = null;
    this.activeFor = 0;
    this.gap = 0;
  }

  /** Die Mechanik wurde benutzt: kein (weiterer) Hinweis dazu; ein gerade sichtbarer verschwindet sofort */
  markUsed(id: HintId): void {
    this.used.add(id);
    if (this.active && this.active.id === id) {
      this.active = null;
      this.gap = HINT_GAP_S;
    }
  }

  update(dt: number, ctx: HintContext): ActiveHint | null {
    if (!ctx.hintsEnabled || ctx.runs >= HINT_MAX_RUNS) {
      this.active = null;
      return null;
    }
    if (this.active) {
      this.activeFor += dt;
      // kleine Toleranz gegen Fließkomma-Reste beim Aufsummieren
      if (this.activeFor < HINT_SHOW_S - 1e-9) return this.active;
      this.active = null;
      this.gap = HINT_GAP_S;
    }
    if (this.gap > 0) {
      this.gap -= dt;
      if (this.gap > 1e-9) return null;
      this.gap = 0;
    }
    const id = pick(ctx, this.used, this.shown);
    if (!id) return null;
    this.shown.add(id);
    this.active = { id, text: hintText(id, ctx.touch) };
    this.activeFor = 0;
    return this.active;
  }
}
