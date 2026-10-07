/**
 * Reine UI-Logik für Fredrun 2.0 (ohne DOM/Canvas, ohne Importe aus game.ts): Zahlenformat, Eingabesperre, Hochzählen,
 * Textanpassung und die Texte der Game-Over-Karte. Alles deterministisch und damit per Vitest prüfbar.
 */

// --- Zahlenformat --------------------------------------------------------------------------------

/**
 * Ganzzahl mit Punkt als Tausendertrenner ("4.210", "1.234.567"), wie das bisherige HUD. Bewusst KEIN toLocaleString:
 * de-AT liefert dort einen geschützten Leerschritt und SSR/Client könnten abweichen. Nachkommastellen werden abgeschnitten,
 * NaN/Infinity ergeben "0".
 */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const t = Math.trunc(n);
  if (t === 0) return "0";
  // oberhalb von 2^53 würde String() in Exponentialschreibweise kippen
  const digits = String(Math.min(Math.abs(t), Number.MAX_SAFE_INTEGER));
  return (t < 0 ? "-" : "") + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// --- Eingabesperre -------------------------------------------------------------------------------

/** Sperrzeit (ms), bevor die Game-Over-Karte Eingaben annimmt (verhindert versehentliches "Nochmal" durch Dauertippen) */
export const ARM_DELAY_MS = 450;
/** Sperrzeit (ms) nach dem Öffnen der Pause (verhindert, dass ein Doppeltipp sofort "Weiter"/"Menü" auslöst) */
export const PAUSE_ARM_MS = 250;

/** true, sobald seit dem Einblenden (`shownAtMs`) mindestens `delayMs` vergangen sind. Zeiten aus derselben Uhr (z. B. performance.now()). */
export function armed(nowMs: number, shownAtMs: number, delayMs: number = ARM_DELAY_MS): boolean {
  return nowMs - shownAtMs >= delayMs;
}

// --- Hochzählen ----------------------------------------------------------------------------------

/**
 * Hochzähl-Wert für die Punktzahl: `t01` (0..1 Fortschritt der Animation) → Zahl 0..target mit easeOut (kubisch).
 * Monoton steigend, ganzzahlig, bei t01 >= 1 exakt `target` (nie darüber).
 */
export function countUpValue(t01: number, target: number): number {
  if (!Number.isFinite(target)) return 0;
  if (!(t01 > 0)) return 0;
  if (t01 >= 1) return target;
  const inv = 1 - t01;
  const eased = 1 - inv * inv * inv;
  return target >= 0 ? Math.floor(target * eased) : Math.ceil(target * eased);
}

// --- Textanpassung -------------------------------------------------------------------------------

/** Textbreite in Pixeln bei Schriftgröße `px` (z. B. `(s, px) => { g.font = `700 ${px}px …`; return g.measureText(s).width; }`) */
export type MeasureText = (text: string, px: number) => number;

export interface FitResult {
  /** gewählte Schriftgröße (maxPx … minPx) */
  px: number;
  /** eine oder (nur wenn selbst minPx nicht reicht) genau zwei Zeilen */
  lines: string[];
}

function ellipsize(measure: MeasureText, s: string, px: number, maxW: number): string {
  if (measure(s, px) <= maxW) return s;
  const chars = Array.from(s);
  for (let n = chars.length - 1; n > 0; n -= 1) {
    const cut = `${chars.slice(0, n).join("").trimEnd()}…`;
    if (measure(cut, px) <= maxW) return cut;
  }
  return "…";
}

/** Teilt `text` bei `px` in genau zwei Zeilen (Wortgrenze mit möglichst gleichmäßigen Zeilen, sonst nach Zeichen); Überlanges bekommt "…". */
function splitTwoLines(measure: MeasureText, text: string, px: number, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  let first = "";
  let second = "";
  if (words.length >= 2) {
    let best = Infinity;
    for (let k = 1; k < words.length; k += 1) {
      const a = words.slice(0, k).join(" ");
      const b = words.slice(k).join(" ");
      const cost = Math.max(measure(a, px), measure(b, px));
      if (cost < best) {
        best = cost;
        first = a;
        second = b;
      }
    }
  } else {
    // ein einziges langes Wort (oder Text ohne Leerzeichen): nach Zeichen trennen, erste Zeile so voll wie möglich
    const chars = Array.from(text);
    if (chars.length < 2) return [text];
    let n = chars.length - 1;
    while (n > 1 && measure(chars.slice(0, n).join(""), px) > maxW) n -= 1;
    first = chars.slice(0, n).join("");
    second = chars.slice(n).join("");
  }
  return [ellipsize(measure, first, px, maxW), ellipsize(measure, second, px, maxW)];
}

/**
 * Passt `text` in die Breite `maxW`: zuerst Schrift von `maxPx` in 1-px-Schritten bis `minPx` verkleinern; passt es auch bei
 * `minPx` nicht, wird bei `minPx` auf genau zwei Zeilen umgebrochen (Überlanges mit "…" gekürzt). Ergebnis: entweder eine Zeile
 * mit Breite <= maxW oder genau zwei Zeilen. Degenerierte Eingaben (leerer Text, maxW <= 0) liefern eine Zeile in maxPx/minPx.
 */
export function fitText(measure: MeasureText, text: string, maxW: number, maxPx: number, minPx: number): FitResult {
  const hi = Math.max(minPx, maxPx);
  const lo = Math.min(minPx, maxPx);
  if (!text || !(maxW > 0)) return { px: hi, lines: [text] };
  for (let px = hi; px >= lo; px -= 1) {
    if (measure(text, px) <= maxW) return { px, lines: [text] };
  }
  // bei nicht ganzzahligem Abstand hi - lo wurde minPx selbst noch nicht geprüft
  if (measure(text, lo) <= maxW) return { px: lo, lines: [text] };
  return { px: lo, lines: splitTwoLines(measure, text, lo, maxW) };
}

// --- Game-Over-Karte -----------------------------------------------------------------------------

/** Strukturelle Eingabe aus dem Lauf-Ergebnis (RunResult aus game.ts passt, ohne dass hier importiert wird) */
export interface RunResultLike {
  score: number;
  /** Rekord dieser Bestenliste VOR dem Lauf (0 = noch keiner) */
  previousBest: number;
  /** In dieser Lauf-Runde gesammelte Münzen */
  coins: number;
  /** 1-basierter Platz der lokalen Top-Liste, null = nicht in der Liste */
  rank: number | null;
  /** Neuer Rekord (Game: Treffer und Punktzahl > 0); fehlt das Feld, gilt score > previousBest */
  isNewBest?: boolean;
}

/** Stand des Profils NACH dem Lauf: `coins` = Guthaben inklusive der Münzen dieses Laufs */
export interface ProfileLike {
  coins: number;
  unlocked: readonly string[];
}

export interface HeroLike {
  id: string;
  name: string;
  price: number;
}

export interface GameOverSummary {
  /** Zeile unter der Punktzahl (Erstlauf, Rekord-Vorsprung oder Abstand zum Rekord) */
  recordLine: string;
  /** 0..1 für den dünnen Fortschrittsbalken (score/Rekord; bei neuem Rekord 1) */
  progress: number;
  /** "Platz n deiner Bestenliste" oder null, wenn nicht in der Liste */
  rankLine: string | null;
  /** "+C Münzen · Guthaben G" */
  coinsLine: string;
  /** "Noch N bis <Held>" für den günstigsten noch gesperrten Helden, null wenn alle freigeschaltet sind */
  nextGoalLine: string | null;
  /** erster Lauf in dieser Bestenliste (previousBest === 0): weicherer Pill-Text statt "Persönliche Bestleistung" */
  firstRun: boolean;
}

/** Der günstigste noch nicht freigeschaltete Held (Gratis-Helden zählen nicht als Ziel); bei Gleichstand der erste in der Liste. */
function cheapestLocked(heroes: ReadonlyArray<HeroLike> | Readonly<Record<string, HeroLike>>, unlocked: readonly string[]): HeroLike | null {
  const list: ReadonlyArray<HeroLike> = Array.isArray(heroes) ? (heroes as ReadonlyArray<HeroLike>) : Object.values(heroes as Readonly<Record<string, HeroLike>>);
  let best: HeroLike | null = null;
  for (const h of list) {
    if (h.price <= 0 || unlocked.includes(h.id)) continue;
    if (!best || h.price < best.price) best = h;
  }
  return best;
}

/**
 * Texte und Fortschritt der Game-Over-Karte. `heroes` = Liste oder Record der Helden (z. B. CHARACTERS).
 * Alle Zahlen laufen über formatNumber.
 */
export function gameOverSummary(
  r: RunResultLike,
  profile: ProfileLike,
  heroes: ReadonlyArray<HeroLike> | Readonly<Record<string, HeroLike>>,
): GameOverSummary {
  const score = Math.max(0, Math.floor(r.score));
  const prev = Math.max(0, Math.floor(r.previousBest));
  const firstRun = prev === 0;
  const isNewBest = (r.isNewBest ?? score > prev) && score > 0;

  let recordLine: string;
  let progress: number;
  if (isNewBest && firstRun) {
    recordLine = "Erster Lauf! Dein erster Rekord";
    progress = 1;
  } else if (isNewBest) {
    recordLine = `+${formatNumber(score - prev)} über deinem alten Rekord (${formatNumber(prev)})`;
    progress = 1;
  } else if (prev === 0) {
    recordLine = "Noch kein Rekord – der nächste Lauf zählt";
    progress = 0;
  } else if (score >= prev) {
    recordLine = `Rekord ${formatNumber(prev)} eingestellt`;
    progress = 1;
  } else {
    recordLine = `Rekord ${formatNumber(prev)} · noch ${formatNumber(prev - score)} Punkte`;
    progress = Math.min(1, Math.max(0, score / prev));
  }

  const rankLine = r.rank !== null && r.rank > 0 ? `Platz ${formatNumber(r.rank)} deiner Bestenliste` : null;
  const coinsLine = `+${formatNumber(r.coins)} Münzen · Guthaben ${formatNumber(profile.coins)}`;

  const goal = cheapestLocked(heroes, profile.unlocked);
  let nextGoalLine: string | null = null;
  if (goal) {
    const missing = Math.ceil(goal.price - profile.coins);
    // "Noch 0 bis …" wäre irreführend: das Guthaben reicht schon
    nextGoalLine = missing > 0 ? `Noch ${formatNumber(missing)} bis ${goal.name}` : `${goal.name} ist jetzt freischaltbar`;
  }

  return { recordLine, progress, rankLine, coinsLine, nextGoalLine, firstRun };
}
