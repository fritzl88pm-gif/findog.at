/**
 * Adaptive Qualität (rein, ohne DOM): entscheidet anhand der Frame-Intervalle, ob die Qualitätsstufe (0 = niedrig, 2 = hoch)
 * gesenkt oder angehoben wird. Der Hub ruft pro Frame `feed(rawDtMs, busyMs, nowMs)` und wendet ein zurückgegebenes Niveau an
 * (Effekte + Auflösungs-Skala, siehe render-scale.ts). Alle Fenster sind zeitbasiert (nicht frame-zahl-basiert), damit 60/90/120 Hz
 * gleich behandelt werden; in feed() wird nichts allokiert.
 *
 * Regeln:
 *  - Anzeige-Intervall T = unteres Quartil der letzten 120 Intervalle, Ziel = max(16,7 ms, T). Ist T > 28 ms oder die Schleife
 *    ausgelastet (busy ≥ 70 % des Intervalls), bestimmt nicht die Anzeige, sondern das Gerät das Tempo → Ziel 16,7 ms.
 *  - Abstieg je 1,5-s-Fenster bei ≥ 25 % Frames > 1,35 · Ziel oder Mittel > 1,25 · Ziel (Mittel ohne Hänger > 3 · Ziel);
 *    nach einem Aufstieg frühestens nach 3 s. Dauerhaft > 60 ms über 0,8 s → sofort auf Q0 (zwei Stufen).
 *    Frames > 250 ms (Tab-Rückkehr, Laden) zählen nicht.
 *  - 30-Hz-Anzeige (≥ 90 % der Intervalle in 28–38 ms, busy < 40 % des Intervalls, höchstens 5 % Frames > 50 ms, also kein
 *    Dauerruckeln): Ziel 33,3 ms – die Stufe wird gehalten (iOS-Stromsparmodus), nicht gesenkt.
 *  - Aufstieg nur nach ≥ 20 s mit ≤ 2 % schlechten Frames und busy < 0,5 · Ziel. Wird ein Aufstieg binnen 10 s zurückgenommen,
 *    bleibt die Maximalstufe 120 s gedeckelt, danach 240 s usw. (verdoppelt sich, höchstens 960 s).
 *  - Persistenz: zuletzt stabile Stufe in localStorage ('findog.fredrun2.q', bewusst nicht im Profil) als Startstufe.
 * Grenze: busyMs misst nur CPU-Zeit. Ein GPU-gebundenes Gerät mit konstant 33 ms ist daher von einer 30-Hz-Anzeige nicht zu
 * unterscheiden und wird gehalten.
 */

export type QualityLevel = 0 | 1 | 2;

export const QUALITY_STORAGE_KEY = "findog.fredrun2.q";

/** Untere Schranke des Ziel-Intervalls (60 fps). */
const MIN_TARGET_MS = 16.7;
const TARGET_30HZ_MS = 1000 / 30;
const WINDOW_MS = 1500;
const SEVERE_MS = 800;
const SEVERE_DT_MS = 60;
const SEVERE_MIN_FRAMES = 6;
const OUTLIER_MS = 250;
const MIN_DWELL_AFTER_UP_MS = 3000;
const BAD_FACTOR = 1.35;
const MEAN_FACTOR = 1.25;
const HITCH_FACTOR = 3;
const BAD_SHARE = 0.25;
const ASCENT_AFTER_MS = 20_000;
const ASCENT_RESET_MS = 25_000;
const ASCENT_BAD_SHARE = 0.02;
const ASCENT_BUSY_FACTOR = 0.5;
const FAIL_WINDOW_MS = 10_000;
const FAIL_FORGET_MS = 60_000;
const BACKOFF_BASE_MS = 120_000;
const BACKOFF_MAX_MS = 960_000;
const PERSIST_AFTER_MS = 30_000;
const SATURATED_SHARE = 0.7;
const RING = 120;
const WINDOW_CAP = 1024;

/** Das, was der Governor von Storage braucht (localStorage passt strukturell). */
export type GovernorStorage = Pick<Storage, "getItem" | "setItem">;

export interface QualityGovernorOptions {
  /** Speicher für die zuletzt stabile Stufe; undefined = localStorage (falls nutzbar), null = nichts speichern. */
  storage?: GovernorStorage | null;
  /** Startstufe, wenn nichts gespeichert ist (Standard 2, Heuristik: initialLevel()). Eine gespeicherte Stufe hat Vorrang. */
  initial?: QualityLevel;
}

export interface DeviceHints {
  deviceMemory?: number | null;
  hardwareConcurrency?: number | null;
  /** (pointer: coarse), also Touch-Gerät */
  coarse?: boolean;
  dpr?: number;
}

function toLevel(v: unknown): QualityLevel | null {
  return v === 0 || v === 1 || v === 2 ? v : null;
}

function parseStored(raw: string | null): QualityLevel | null {
  return raw === "0" ? 0 : raw === "1" ? 1 : raw === "2" ? 2 : null;
}

function defaultStorage(): GovernorStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // Zugriff gesperrt (z. B. Safari privat)
  }
}

export class QualityGovernor {
  private storage: GovernorStorage | null;
  private lvl: QualityLevel;
  private persisted: QualityLevel | null = null;

  // Intervall-Ring (Anzeige-Intervall T)
  private readonly ring = new Float32Array(RING);
  private readonly scratch = new Float32Array(RING);
  private ringPos = 0;
  private ringN = 0;

  // aktuelles Fenster
  private readonly winDt = new Float32Array(WINDOW_CAP);
  private winN = 0;
  private winSpan = 0;
  private winBusySum = 0;
  private winSlow = 0; // Frames > 60 ms im Fenster

  // stabile Phase (für Aufstieg und Persistenz)
  private stableSpan = 0;
  private stableFrames = 0;
  private stableBad = 0;
  private stableBusy = 0;
  private levelSpan = 0;
  private target = MIN_TARGET_MS;

  // Aufstieg/Backoff
  private lastUpAt = Number.NEGATIVE_INFINITY;
  private failCount = 0;
  private capLevel: QualityLevel = 2;
  private capUntil = Number.NEGATIVE_INFINITY;

  constructor(opts: QualityGovernorOptions = {}) {
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    let stored: QualityLevel | null = null;
    if (this.storage) {
      try {
        stored = parseStored(this.storage.getItem(QUALITY_STORAGE_KEY));
      } catch {
        stored = null;
      }
    }
    this.persisted = stored;
    this.lvl = stored ?? toLevel(opts.initial) ?? 2;
  }

  get level(): QualityLevel {
    return this.lvl;
  }

  /**
   * Startstufe aus Geräte-Hinweisen: schwaches Touch-Gerät (≤ 4 Kerne oder ≤ 3 GB) mit hoher Pixeldichte (dpr ≥ 2) → 1, sonst 2.
   * Unbekannte Werte (undefined/null, z. B. deviceMemory in Safari) zählen nicht als schwach.
   */
  static initialLevel(h: DeviceHints): QualityLevel {
    const mem = h.deviceMemory;
    const cores = h.hardwareConcurrency;
    const weak = (typeof mem === "number" && mem > 0 && mem <= 3) || (typeof cores === "number" && cores > 0 && cores <= 4);
    return h.coarse === true && weak && (h.dpr ?? 1) >= 2 ? 1 : 2;
  }

  /** Alles zurücksetzen (Fenster, Backoff), optional auf eine feste Stufe (z. B. nach einer Qualitäts-Einstellung). */
  reset(level?: QualityLevel): void {
    if (level !== undefined) this.lvl = level;
    this.ringPos = 0;
    this.ringN = 0;
    this.clearWindow();
    this.clearStable();
    this.levelSpan = 0;
    this.target = MIN_TARGET_MS;
    this.lastUpAt = Number.NEGATIVE_INFINITY;
    this.failCount = 0;
    this.capLevel = 2;
    this.capUntil = Number.NEGATIVE_INFINITY;
  }

  /**
   * Einen Frame melden. rawDtMs = Zeit seit dem letzten rAF (ungeklemmt), busyMs = CPU-Zeit dieses Frames (negativ/NaN = unbekannt),
   * nowMs = laufende Uhr (performance.now()). Rückgabe: neue Stufe, wenn gewechselt werden soll, sonst null.
   */
  feed(rawDtMs: number, busyMs: number, nowMs: number): QualityLevel | null {
    if (!(rawDtMs >= 2) || rawDtMs > OUTLIER_MS) return null; // ungültig bzw. Tab-Rückkehr/Laden: nicht werten
    const busy = busyMs >= 0 && busyMs < 1e6 ? busyMs : rawDtMs; // unbekannt → als ausgelastet annehmen
    this.ring[this.ringPos] = rawDtMs;
    this.ringPos = (this.ringPos + 1) % RING;
    if (this.ringN < RING) this.ringN++;
    if (this.winN < WINDOW_CAP) this.winDt[this.winN++] = rawDtMs;
    if (rawDtMs > SEVERE_DT_MS) this.winSlow++;
    this.winSpan += rawDtMs;
    this.winBusySum += busy;
    const half = 0.5 * rawDtMs; // Fenstergrenzen auf den nächsten Frame runden

    // Dauerhaft > 60 ms (mindestens 6 Frames, die Mehrheit davon lang – einzelne Hänger beim Laden reichen nicht): gleich auf Q0
    if (this.lvl > 0 && this.winN >= SEVERE_MIN_FRAMES && this.winSpan >= SEVERE_MS - half && this.winSlow * 2 > this.winN && this.winSpan / this.winN > SEVERE_DT_MS) {
      return this.change(0, nowMs, false);
    }
    if (this.winSpan >= WINDOW_MS - half) return this.evaluate(nowMs);
    return null;
  }

  // --- intern ----------------------------------------------------------------------------------------------------

  private clearWindow(): void {
    this.winN = 0;
    this.winSpan = 0;
    this.winBusySum = 0;
    this.winSlow = 0;
  }

  private clearStable(): void {
    this.stableSpan = 0;
    this.stableFrames = 0;
    this.stableBad = 0;
    this.stableBusy = 0;
  }

  /** Unteres Quartil der letzten Intervalle (Sortieren auf vorab angelegtem Puffer, höchstens einmal je Fenster). */
  private displayInterval(): number {
    const n = this.ringN;
    if (n === 0) return MIN_TARGET_MS;
    const s = this.scratch.subarray(0, n);
    s.set(this.ring.subarray(0, n));
    s.sort();
    return s[Math.floor((n - 1) * 0.25)];
  }

  private evaluate(now: number): QualityLevel | null {
    const n = this.winN;
    const span = this.winSpan;
    const busySum = this.winBusySum;
    this.clearWindow();
    if (n === 0 || span <= 0) return null;

    const dt = this.winDt;
    let n30 = 0;
    let over50 = 0;
    for (let i = 0; i < n; i++) {
      const d = dt[i];
      if (d >= 28 && d <= 38) n30++;
      if (d > 50) over50++;
    }
    const busyShare = busySum / span;
    const hold30 = n30 >= 0.9 * n && busyShare < 0.4 && over50 <= 0.05 * n;
    const t = this.displayInterval();
    const target = hold30 ? TARGET_30HZ_MS : t > 28 || busyShare >= SATURATED_SHARE ? MIN_TARGET_MS : Math.max(MIN_TARGET_MS, t);
    this.target = target;
    // Mittel ohne Hänger (> 3 · Ziel): ein einzelner Freeze beim Laden soll nicht wie dauerhaft zu langsam wirken (er zählt als schlechter Frame)
    let bad = 0;
    let trimSum = 0;
    let trimN = 0;
    const limit = BAD_FACTOR * target;
    const hitch = HITCH_FACTOR * target;
    for (let i = 0; i < n; i++) {
      const d = dt[i];
      if (d > limit) bad++;
      if (d <= hitch) {
        trimSum += d;
        trimN++;
      }
    }
    const mean = trimN > 0 ? trimSum / trimN : span / n;

    this.levelSpan += span;
    if (this.lastUpAt > Number.NEGATIVE_INFINITY && now - this.lastUpAt >= FAIL_FORGET_MS) {
      this.failCount = 0; // der Aufstieg hat gehalten → Backoff vergessen
      this.lastUpAt = Number.NEGATIVE_INFINITY;
    }

    if (bad >= BAD_SHARE * n || mean > MEAN_FACTOR * target) {
      this.clearStable();
      if (this.lvl > 0 && now - this.lastUpAt >= MIN_DWELL_AFTER_UP_MS) return this.change((this.lvl - 1) as QualityLevel, now, false);
      return null;
    }

    this.stableSpan += span;
    this.stableFrames += n;
    this.stableBad += bad;
    this.stableBusy += busySum;
    if (this.levelSpan >= PERSIST_AFTER_MS && this.persisted !== this.lvl) this.persist(this.lvl);
    if (this.lvl < 2 && this.stableSpan >= ASCENT_AFTER_MS) {
      const maxLevel = now < this.capUntil ? this.capLevel : 2;
      if (this.lvl < maxLevel && this.stableBad <= ASCENT_BAD_SHARE * this.stableFrames && this.stableBusy < ASCENT_BUSY_FACTOR * target * this.stableFrames) {
        return this.change((this.lvl + 1) as QualityLevel, now, true);
      }
      if (this.stableSpan >= ASCENT_RESET_MS) this.clearStable(); // schlechte Phase vergessen, neue Messperiode
    }
    return null;
  }

  private change(next: QualityLevel, now: number, up: boolean): QualityLevel {
    const prev = this.lvl;
    this.lvl = next;
    this.clearWindow();
    this.clearStable();
    this.levelSpan = 0;
    if (up) {
      this.lastUpAt = now;
    } else {
      if (now - this.lastUpAt <= FAIL_WINDOW_MS) {
        // gescheiterter Aufstieg: Maximalstufe deckeln, Dauer verdoppelt sich bei jedem Scheitern
        this.capLevel = next;
        this.capUntil = now + Math.min(BACKOFF_BASE_MS * 2 ** this.failCount, BACKOFF_MAX_MS);
        this.failCount++;
      }
      this.lastUpAt = Number.NEGATIVE_INFINITY;
      if (prev !== next) this.persist(next); // Abstiege sind echte Messwerte: sofort merken
    }
    return next;
  }

  private persist(level: QualityLevel): void {
    this.persisted = level;
    if (!this.storage) return;
    try {
      this.storage.setItem(QUALITY_STORAGE_KEY, String(level));
    } catch {
      // Speicher voll/gesperrt: nur nicht merken
    }
  }
}
