import {
  HOLIDAY_GREETINGS,
  SUNDAY_GREETINGS,
  WEEKDAY_GREETINGS,
  type WelcomeHolidayId,
  type WelcomePeriod,
} from "@/lib/chat/welcome-greetings";

export type { WelcomeHolidayId, WelcomePeriod };

/** Bild, das gezeigt wird, solange kein Motiv der Auswahl vorhanden ist. */
export const FALLBACK_WELCOME_IMAGE = "/fred.png";

export interface WelcomeImageManifest {
  /** Motive je Tageszeit - der letzte Rueckfall vor FALLBACK_WELCOME_IMAGE. */
  periods: Record<WelcomePeriod, readonly string[]>;
  /** Motive fuer Sonntage; leer = Motive der Tageszeit. */
  sunday: readonly string[];
  /** Motive je Feiertag; leer = Sonntags-/Tageszeitmotive. */
  holidays: Record<WelcomeHolidayId, readonly string[]>;
  /**
   * Statische Ersatzbilder (`<name>-static.png`) fuer animierte Motive
   * (.webp/.gif). Nur Pfade eintragen, die in public/ wirklich existieren.
   */
  staticFallbacks: readonly string[];
}

/**
 * Einziger Ort fuer Bildpfade. Neue Motive (auch animierte .webp/.gif) werden
 * nur hier eingetragen, die Auswahllogik bleibt unveraendert.
 */
export const WELCOME_IMAGE_MANIFEST: WelcomeImageManifest = {
  periods: {
    morning: ["/fred-welcome-morgen-1.png", "/fred-welcome-morgen-2.png", "/fred-welcome-morgen-3.png", "/fred-welcome-morgen-4.png", "/fred-welcome-morgen-5.png"],
    midday: [
      "/fred-welcome-mittag-1.png",
      "/fred-welcome-mittag-2.png",
      "/fred-welcome-mittag-3.png",
      "/fred-welcome-mittag-4.png",
      "/fred-welcome-mittag-5.png",
      "/fred-welcome-mittag-6.png",
    ],
    afternoon: ["/fred-welcome-nachmittag-1.png", "/fred-welcome-nachmittag-2.png", "/fred-welcome-nachmittag-3.png", "/fred-welcome-nachmittag-4.png"],
    evening: ["/fred-welcome-abend-1.png", "/fred-welcome-abend-2.png", "/fred-welcome-abend-3.png", "/fred-welcome-abend-4.png"],
    lateNight: ["/fred-welcome-nacht-1.png", "/fred-welcome-nacht-2.png", "/fred-welcome-nacht-3.png", "/fred-welcome-nacht-4.png"],
  },
  sunday: ["/fred-welcome-sonntag-1.png", "/fred-welcome-sonntag-2.png"],
  holidays: {
    neujahr: ["/fred-welcome-neujahr-1.png"],
    dreikoenige: [],
    ostersonntag: ["/fred-welcome-ostern-1.png"],
    ostermontag: ["/fred-welcome-ostern-1.png"],
    staatsfeiertag: [],
    himmelfahrt: [],
    pfingstsonntag: ["/fred-welcome-pfingsten-1.png"],
    pfingstmontag: ["/fred-welcome-pfingsten-1.png"],
    fronleichnam: [],
    mariaeHimmelfahrt: [],
    nationalfeiertag: ["/fred-welcome-nationalfeiertag-1.png"],
    allerheiligen: ["/fred-welcome-allerheiligen-1.png"],
    mariaeEmpfaengnis: [],
    heiligerAbend: ["/fred-welcome-weihnachten-1.png"],
    christtag: ["/fred-welcome-weihnachten-1.png"],
    stefanitag: ["/fred-welcome-weihnachten-1.png"],
    silvester: ["/fred-welcome-silvester-1.png"],
  },
  staticFallbacks: [],
};

const VIENNA_DATE_TIME = new Intl.DateTimeFormat("de-AT", {
  timeZone: "Europe/Vienna",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  hourCycle: "h23",
});

function readViennaParts(instant: Date) {
  const parts = VIENNA_DATE_TIME.formatToParts(instant);
  const valueOf = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    year: valueOf("year"),
    month: valueOf("month"),
    day: valueOf("day"),
    hour: valueOf("hour"),
  };
}

export type WelcomeDayKind =
  | { kind: "holiday"; holiday: WelcomeHolidayId }
  | { kind: "sunday" }
  | { kind: "weekday" };

/**
 * Ostersonntag nach dem Gregorianischen Algorithmus (Meeus/Jones/Butcher).
 * Liefert Monat (3 oder 4) und Tag.
 */
export function computeEasterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return { month, day };
}

const FIXED_HOLIDAYS: Record<string, WelcomeHolidayId> = {
  "1-1": "neujahr",
  "1-6": "dreikoenige",
  "5-1": "staatsfeiertag",
  "8-15": "mariaeHimmelfahrt",
  "10-26": "nationalfeiertag",
  "11-1": "allerheiligen",
  "12-8": "mariaeEmpfaengnis",
  "12-24": "heiligerAbend",
  "12-25": "christtag",
  "12-26": "stefanitag",
  "12-31": "silvester",
};

/** Bewegliche Feiertage als Abstand in Tagen zum Ostersonntag. */
const EASTER_RELATIVE_HOLIDAYS: ReadonlyArray<readonly [number, WelcomeHolidayId]> = [
  [0, "ostersonntag"],
  [1, "ostermontag"],
  [39, "himmelfahrt"],
  [49, "pfingstsonntag"],
  [50, "pfingstmontag"],
  [60, "fronleichnam"],
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dayNumber(year: number, month: number, day: number): number {
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

export function getWelcomeHoliday(instant: Date = new Date()): WelcomeHolidayId | null {
  const { year, month, day } = readViennaParts(instant);
  const fixed = FIXED_HOLIDAYS[`${month}-${day}`];
  if (fixed) return fixed;

  const easter = computeEasterSunday(year);
  const easterDay = dayNumber(year, easter.month, easter.day);
  const today = dayNumber(year, month, day);

  return EASTER_RELATIVE_HOLIDAYS.find(([offset]) => easterDay + offset === today)?.[1] ?? null;
}

function isSundayInVienna(instant: Date): boolean {
  const { year, month, day } = readViennaParts(instant);

  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 0;
}

/** Feiertag vor Sonntag vor Werktag (Wiener Kalendertag). */
export function getWelcomeDayKind(instant: Date = new Date()): WelcomeDayKind {
  const holiday = getWelcomeHoliday(instant);
  if (holiday) return { kind: "holiday", holiday };

  return isSundayInVienna(instant) ? { kind: "sunday" } : { kind: "weekday" };
}

export function getWelcomePeriod(instant: Date = new Date()): WelcomePeriod {
  const { hour } = readViennaParts(instant);

  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 14) return "midday";
  if (hour >= 14 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 22) return "evening";
  return "lateNight";
}

export function getWelcomeGreeting(instant: Date = new Date()): string {
  const { year, month, day } = readViennaParts(instant);
  const dayKind = getWelcomeDayKind(instant);
  const period = getWelcomePeriod(instant);
  const greetings =
    dayKind.kind === "holiday"
      ? HOLIDAY_GREETINGS[dayKind.holiday]
      : dayKind.kind === "sunday"
        ? SUNDAY_GREETINGS[period]
        : WEEKDAY_GREETINGS[period];

  // Fortlaufende Tagesnummer statt Datumssumme: aufeinanderfolgende Tage
  // landen so immer auf unterschiedlichen Eintraegen derselben Liste.
  return greetings[dayNumber(year, month, day) % greetings.length];
}

/**
 * Wählt zufällig eines der Motive des Tages: Feiertag, sonst Sonntag, sonst
 * Tageszeit - jeweils mit Rückfall auf die nächste nicht leere Liste.
 * `pick` ist nur für Tests da und erwartet einen Wert aus [0, 1).
 */
export function getWelcomeImage(
  instant: Date = new Date(),
  pick: number = Math.random(),
  manifest: WelcomeImageManifest = WELCOME_IMAGE_MANIFEST,
): string {
  const dayKind = getWelcomeDayKind(instant);
  const candidates: ReadonlyArray<readonly string[]> = [
    dayKind.kind === "holiday" ? manifest.holidays[dayKind.holiday] : [],
    isSundayInVienna(instant) ? manifest.sunday : [],
    manifest.periods[getWelcomePeriod(instant)],
  ];
  const images = candidates.find((list) => list.length > 0);
  if (!images) return FALLBACK_WELCOME_IMAGE;

  const imageIndex = Math.min(images.length - 1, Math.max(0, Math.floor(pick * images.length)));

  return images[imageIndex];
}

const ANIMATED_IMAGE = /\.(webp|gif)$/iu;

/**
 * Bei `prefers-reduced-motion` wird für animierte Motive (.webp/.gif) das
 * statische Ersatzbild `<name>-static.png` genutzt, sofern es im Manifest
 * eingetragen ist. Sonst bleibt das animierte Motiv.
 */
export function resolveWelcomeImage(
  src: string,
  reducedMotion: boolean,
  manifest: WelcomeImageManifest = WELCOME_IMAGE_MANIFEST,
): string {
  if (!reducedMotion || !ANIMATED_IMAGE.test(src)) return src;

  const staticSrc = src.replace(ANIMATED_IMAGE, "-static.png");

  return manifest.staticFallbacks.includes(staticSrc) ? staticSrc : src;
}
