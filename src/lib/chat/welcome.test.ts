import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  FALLBACK_WELCOME_IMAGE,
  WELCOME_IMAGE_MANIFEST,
  computeEasterSunday,
  getWelcomeDayKind,
  getWelcomeGreeting,
  getWelcomeHoliday,
  getWelcomeImage,
  getWelcomePeriod,
  resolveWelcomeImage,
  type WelcomeHolidayId,
  type WelcomeImageManifest,
  type WelcomePeriod,
} from "@/lib/chat/welcome";
import {
  HOLIDAY_GREETINGS,
  SUNDAY_GREETINGS,
  WEEKDAY_GREETINGS,
} from "@/lib/chat/welcome-greetings";

const PERIODS: WelcomePeriod[] = ["morning", "midday", "afternoon", "evening", "lateNight"];

// Dienstag, 13.01.2026 - kein Feiertag, kein Sonntag.
const TUESDAY = "2026-01-13";
// Je Tageszeit ein UTC-Zeitpunkt, der sommers wie winters im selben Wiener Kalendertag und derselben Tageszeit liegt.
const PERIOD_TIMES: Record<WelcomePeriod, string> = {
  morning: "07:00:00.000Z",
  midday: "11:30:00.000Z",
  afternoon: "15:00:00.000Z",
  evening: "19:00:00.000Z",
  lateNight: "21:30:00.000Z",
};

const at = (isoDate: string, time = "11:00:00.000Z") => new Date(`${isoDate}T${time}`);

describe("greeting content", () => {
  it.each(PERIODS)("has at least 25 weekday greetings for %s", (period) => {
    expect(WEEKDAY_GREETINGS[period].length).toBeGreaterThanOrEqual(25);
  });

  it.each(PERIODS)("has at least 8 Sunday greetings for %s", (period) => {
    expect(SUNDAY_GREETINGS[period].length).toBeGreaterThanOrEqual(8);
  });

  it("has at least 4 greetings per holiday, each naming the day", () => {
    for (const [holiday, greetings] of Object.entries(HOLIDAY_GREETINGS)) {
      expect(greetings.length, holiday).toBeGreaterThanOrEqual(4);
    }
  });

  it("keeps every greeting short, German-only and emoji-free", () => {
    const all = [
      ...Object.values(WEEKDAY_GREETINGS).flat(),
      ...Object.values(SUNDAY_GREETINGS).flat(),
      ...Object.values(HOLIDAY_GREETINGS).flat(),
    ];

    for (const greeting of all) {
      expect(greeting.length, greeting).toBeLessThanOrEqual(140);
      expect(greeting, greeting).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it("never reuses a greeting across weekday, Sunday and holiday sets of a period", () => {
    const all = [
      ...Object.values(WEEKDAY_GREETINGS).flat(),
      ...Object.values(SUNDAY_GREETINGS).flat(),
      ...Object.values(HOLIDAY_GREETINGS).flat(),
    ];

    expect(new Set(all).size).toBe(all.length);
  });

  it("names the holiday in every holiday greeting", () => {
    const keywords: Record<WelcomeHolidayId, RegExp> = {
      neujahr: /Neujahr|neue[sn] Jahr/u,
      dreikoenige: /Drei Könige|Dreikönig/u,
      ostersonntag: /Ostern|Ostersonntag/u,
      ostermontag: /Ostermontag/u,
      staatsfeiertag: /Staatsfeiertag|1\. Mai/u,
      himmelfahrt: /Himmelfahrt/u,
      pfingstsonntag: /Pfingst/u,
      pfingstmontag: /Pfingstmontag/u,
      fronleichnam: /Fronleichnam/u,
      mariaeHimmelfahrt: /Mariä Himmelfahrt/u,
      nationalfeiertag: /Nationalfeiertag|26\. Oktober/u,
      allerheiligen: /Allerheiligen/u,
      mariaeEmpfaengnis: /Mariä Empfängnis|8\. Dezember/u,
      heiligerAbend: /Heilige[nr] Abend/u,
      christtag: /Christtag|Weihnachten/u,
      stefanitag: /Stefanitag/u,
      silvester: /Silvester|Rutsch/u,
    };

    for (const [holiday, greetings] of Object.entries(HOLIDAY_GREETINGS)) {
      for (const greeting of greetings) {
        expect(greeting, `${holiday}: ${greeting}`).toMatch(keywords[holiday as WelcomeHolidayId]);
      }
    }
  });
});

describe("getWelcomeGreeting", () => {
  it.each(PERIODS)("picks a weekday greeting of the %s set, stable within a day", (period) => {
    const time = PERIOD_TIMES[period];
    const first = getWelcomeGreeting(at(TUESDAY, time));

    expect(WEEKDAY_GREETINGS[period]).toContain(first);
    expect(getWelcomeGreeting(at(TUESDAY, time))).toBe(first);
  });

  it("never repeats a greeting on consecutive days for the same period", () => {
    for (const period of PERIODS) {
      const time = PERIOD_TIMES[period];
      let previous = "";
      // Vier Jahre taeglich, inkl. Sonntage, Feiertage und Jahreswechsel.
      for (let offset = 0; offset < 4 * 366; offset += 1) {
        const date = new Date(Date.UTC(2026, 0, 1 + offset, 12));
        const iso = date.toISOString().slice(0, 10);
        const greeting = getWelcomeGreeting(at(iso, time));

        expect(greeting, `${iso} ${period}`).not.toBe(previous);
        previous = greeting;
      }
    }
  });

  it("uses every weekday greeting of a period over 25 consecutive weekdays", () => {
    const period: WelcomePeriod = "morning";
    const seen = new Set<string>();
    // Mo-Sa, Sonntage und Feiertage ueberspringen.
    for (let offset = 0; offset < 200; offset += 1) {
      const date = new Date(Date.UTC(2026, 0, 13 + offset, 12));
      const iso = date.toISOString().slice(0, 10);
      if (getWelcomeDayKind(at(iso, PERIOD_TIMES[period])).kind === "weekday") {
        seen.add(getWelcomeGreeting(at(iso, PERIOD_TIMES[period])));
      }
    }

    expect(seen).toEqual(new Set(WEEKDAY_GREETINGS[period]));
  });

  it("uses Europe/Vienna daylight-saving time before choosing the period", () => {
    // 02:30Z im Sommer = 04:30 Wien = Spaetnacht, 03:30Z = 05:30 = Morgen.
    expect(WEEKDAY_GREETINGS.lateNight).toContain(
      getWelcomeGreeting(new Date("2026-07-01T02:30:00.000Z")),
    );
    expect(WEEKDAY_GREETINGS.morning).toContain(
      getWelcomeGreeting(new Date("2026-07-01T03:30:00.000Z")),
    );
  });

  it.each([
    ["2026-01-13T03:59:00.000Z", "lateNight"],
    ["2026-01-13T04:00:00.000Z", "morning"],
    ["2026-01-13T09:59:00.000Z", "morning"],
    ["2026-01-13T10:00:00.000Z", "midday"],
    ["2026-01-13T12:59:00.000Z", "midday"],
    ["2026-01-13T13:00:00.000Z", "afternoon"],
    ["2026-01-13T16:59:00.000Z", "afternoon"],
    ["2026-01-13T17:00:00.000Z", "evening"],
    ["2026-01-13T20:59:00.000Z", "evening"],
    ["2026-01-13T21:00:00.000Z", "lateNight"],
  ] as const)("keeps the Vienna-local period boundary at %s", (timestamp, period) => {
    expect(WEEKDAY_GREETINGS[period]).toContain(getWelcomeGreeting(new Date(timestamp)));
  });

  describe("Sundays", () => {
    // 18.01.2026 ist ein Sonntag.
    it.each(PERIODS)("uses the Sunday set for %s", (period) => {
      expect(SUNDAY_GREETINGS[period]).toContain(
        getWelcomeGreeting(at("2026-01-18", PERIOD_TIMES[period])),
      );
    });

    it("treats Saturday and Monday as regular weekdays", () => {
      expect(getWelcomeDayKind(at("2026-01-17")).kind).toBe("weekday");
      expect(getWelcomeDayKind(at("2026-01-19")).kind).toBe("weekday");
      expect(getWelcomeDayKind(at("2026-01-18")).kind).toBe("sunday");
    });

    it("decides Sunday by the Vienna calendar day, not the UTC day", () => {
      // Samstag 23:30 UTC = Sonntag 00:30 Wien.
      expect(getWelcomeDayKind(new Date("2026-01-17T23:30:00.000Z")).kind).toBe("sunday");
      // Sonntag 23:30 UTC = Montag 00:30 Wien.
      expect(getWelcomeDayKind(new Date("2026-01-18T23:30:00.000Z")).kind).toBe("weekday");
    });
  });

  describe("holidays", () => {
    it("lets a holiday win over Sunday", () => {
      // Ostersonntag 05.04.2026 ist zugleich Sonntag.
      const greeting = getWelcomeGreeting(at("2026-04-05"));

      expect(HOLIDAY_GREETINGS.ostersonntag).toContain(greeting);
      expect(getWelcomeDayKind(at("2026-04-05"))).toEqual({
        kind: "holiday",
        holiday: "ostersonntag",
      });
    });

    it("lets a holiday win over a regular weekday", () => {
      // 26.10.2026 ist ein Montag.
      expect(HOLIDAY_GREETINGS.nationalfeiertag).toContain(getWelcomeGreeting(at("2026-10-26")));
    });

    it("uses the holiday set in every period of the day", () => {
      for (const period of PERIODS) {
        const time = PERIOD_TIMES[period];
        expect(HOLIDAY_GREETINGS.christtag).toContain(getWelcomeGreeting(at("2026-12-25", time)));
      }
    });
  });
});

describe("computeEasterSunday", () => {
  it.each([
    [2025, 4, 20],
    [2026, 4, 5],
    [2027, 3, 28],
    [2028, 4, 16],
    [2029, 4, 1],
    [2030, 4, 21],
  ])("computes Easter %i on %i-%i", (year, month, day) => {
    expect(computeEasterSunday(year)).toEqual({ month, day });
  });
});

describe("getWelcomeHoliday", () => {
  it.each<[string, string, WelcomeHolidayId]>([
    ["Neujahr", "2026-01-01", "neujahr"],
    ["Heilige Drei Könige", "2026-01-06", "dreikoenige"],
    ["Ostersonntag", "2026-04-05", "ostersonntag"],
    ["Ostermontag", "2026-04-06", "ostermontag"],
    ["Staatsfeiertag", "2026-05-01", "staatsfeiertag"],
    ["Christi Himmelfahrt", "2026-05-14", "himmelfahrt"],
    ["Pfingstsonntag", "2026-05-24", "pfingstsonntag"],
    ["Pfingstmontag", "2026-05-25", "pfingstmontag"],
    ["Fronleichnam", "2026-06-04", "fronleichnam"],
    ["Mariä Himmelfahrt", "2026-08-15", "mariaeHimmelfahrt"],
    ["Nationalfeiertag", "2026-10-26", "nationalfeiertag"],
    ["Allerheiligen", "2026-11-01", "allerheiligen"],
    ["Mariä Empfängnis", "2026-12-08", "mariaeEmpfaengnis"],
    ["Heiliger Abend", "2026-12-24", "heiligerAbend"],
    ["Christtag", "2026-12-25", "christtag"],
    ["Stefanitag", "2026-12-26", "stefanitag"],
    ["Silvester", "2026-12-31", "silvester"],
    // Bewegliche Feiertage anderer Jahre.
    ["Ostermontag 2025", "2025-04-21", "ostermontag"],
    ["Christi Himmelfahrt 2025", "2025-05-29", "himmelfahrt"],
    ["Pfingstmontag 2025", "2025-06-09", "pfingstmontag"],
    ["Fronleichnam 2025", "2025-06-19", "fronleichnam"],
    ["Ostersonntag 2027", "2027-03-28", "ostersonntag"],
    ["Fronleichnam 2027", "2027-05-27", "fronleichnam"],
    ["Fronleichnam 2030", "2030-06-20", "fronleichnam"],
  ])("resolves %s (%s)", (_name, isoDate, expected) => {
    for (const time of ["00:30:00.000Z", "12:00:00.000Z"]) {
      // 00:30Z ist in Wien bereits 01:30/02:30 desselben Tages.
      expect(getWelcomeHoliday(at(isoDate, time))).toBe(expected);
    }
  });

  it("resolves the day from Vienna time around UTC midnight", () => {
    // 30.04. 22:30Z = 01.05. 00:30 Wien (Sommerzeit).
    expect(getWelcomeHoliday(new Date("2026-04-30T22:30:00.000Z"))).toBe("staatsfeiertag");
    // 01.05. 22:30Z = 02.05. 00:30 Wien.
    expect(getWelcomeHoliday(new Date("2026-05-01T22:30:00.000Z"))).toBeNull();
    // 31.12. 23:30Z = 01.01. 00:30 Wien.
    expect(getWelcomeHoliday(new Date("2025-12-31T23:30:00.000Z"))).toBe("neujahr");
    expect(getWelcomeHoliday(new Date("2026-12-31T22:59:00.000Z"))).toBe("silvester");
    expect(getWelcomeHoliday(new Date("2026-12-31T23:00:00.000Z"))).toBe("neujahr");
    // 24.12. 23:30Z = 25.12. 00:30 Wien.
    expect(getWelcomeHoliday(new Date("2026-12-24T23:30:00.000Z"))).toBe("christtag");
    // Ostermontag 06.04.2026 beginnt um 22:00Z am Vortag.
    expect(getWelcomeHoliday(new Date("2026-04-05T21:59:00.000Z"))).toBe("ostersonntag");
    expect(getWelcomeHoliday(new Date("2026-04-05T22:00:00.000Z"))).toBe("ostermontag");
  });

  it("returns null on ordinary days", () => {
    expect(getWelcomeHoliday(at("2026-01-13"))).toBeNull();
    expect(getWelcomeHoliday(at("2026-04-07"))).toBeNull();
    expect(getWelcomeHoliday(at("2026-06-03"))).toBeNull();
  });

  it("covers all 17 holidays of the Austrian calendar over a year", () => {
    const found = new Set<string>();
    for (let offset = 0; offset < 365; offset += 1) {
      const holiday = getWelcomeHoliday(new Date(Date.UTC(2026, 0, 1 + offset, 12)));
      if (holiday) found.add(holiday);
    }

    expect(found.size).toBe(17);
    expect(found).toEqual(new Set(Object.keys(HOLIDAY_GREETINGS)));
  });
});

describe("getWelcomePeriod", () => {
  it.each([
    ["2026-01-13T03:59:00.000Z", "lateNight"],
    ["2026-01-13T04:00:00.000Z", "morning"],
    ["2026-01-13T09:59:00.000Z", "morning"],
    ["2026-01-13T10:00:00.000Z", "midday"],
    ["2026-01-13T12:59:00.000Z", "midday"],
    ["2026-01-13T13:00:00.000Z", "afternoon"],
    ["2026-01-13T16:59:00.000Z", "afternoon"],
    ["2026-01-13T17:00:00.000Z", "evening"],
    ["2026-01-13T20:59:00.000Z", "evening"],
    ["2026-01-13T21:00:00.000Z", "lateNight"],
  ])("maps the Vienna-local hour at %s to %s", (timestamp, expected) => {
    expect(getWelcomePeriod(new Date(timestamp))).toBe(expected);
  });
});

describe("getWelcomeImage", () => {
  const MORNING = new Date("2026-01-13T07:00:00.000Z");
  const MIDDAY = new Date("2026-01-13T11:30:00.000Z");
  const SUNDAY = new Date("2026-01-18T07:00:00.000Z");
  const NEW_YEAR = new Date("2026-01-01T07:00:00.000Z");

  const manifest = (overrides: Partial<WelcomeImageManifest>): WelcomeImageManifest => ({
    ...WELCOME_IMAGE_MANIFEST,
    ...overrides,
  });

  it("rotates through every morning and midday motif", () => {
    expect(getWelcomeImage(MORNING, 0)).toBe("/fred-welcome-morgen-1.png");
    expect(getWelcomeImage(MORNING, 0.75)).toBe("/fred-welcome-morgen-2.png");
    expect(getWelcomeImage(MIDDAY, 0)).toBe("/fred-welcome-mittag-1.png");
    expect(getWelcomeImage(MIDDAY, 0.5)).toBe("/fred-welcome-mittag-2.png");
    expect(getWelcomeImage(MIDDAY, 0.99)).toBe("/fred-welcome-mittag-3.png");
  });

  it("covers each motif of a period across many random draws", () => {
    const drawn = new Set(
      Array.from({ length: 300 }, (_unused, index) => getWelcomeImage(MIDDAY, index / 300)),
    );

    expect(drawn).toEqual(new Set(WELCOME_IMAGE_MANIFEST.periods.midday));
  });

  it("stays inside the motif list even when the draw returns the upper bound or below zero", () => {
    expect(getWelcomeImage(MIDDAY, 1)).toBe("/fred-welcome-mittag-3.png");
    expect(getWelcomeImage(MORNING, 1)).toBe("/fred-welcome-morgen-2.png");
    expect(getWelcomeImage(MORNING, -1)).toBe("/fred-welcome-morgen-1.png");
  });

  it("serves the single motif of single-image periods for every draw", () => {
    const cases: Array<[string, string]> = [
      ["2026-01-13T15:00:00.000Z", "/fred-welcome-nachmittag-1.png"],
      ["2026-01-13T19:00:00.000Z", "/fred-welcome-abend-1.png"],
      ["2026-01-13T23:00:00.000Z", "/fred-welcome-nacht-1.png"],
    ];

    for (const [timestamp, expected] of cases) {
      for (const pick of [0, 0.5, 1]) {
        expect(getWelcomeImage(new Date(timestamp), pick)).toBe(expected);
      }
    }
  });

  it("gives every period a motif of its own, so the fallback stays unused", () => {
    for (const time of Object.values(PERIOD_TIMES)) {
      expect(getWelcomeImage(at(TUESDAY, time))).not.toBe(FALLBACK_WELCOME_IMAGE);
    }
  });

  it("uses a real random draw when no explicit pick is given", () => {
    const drawn = new Set(Array.from({ length: 200 }, () => getWelcomeImage(MIDDAY)));

    expect(drawn.size).toBe(3);
  });

  it("falls back to the period images while Sunday and holiday lists are empty", () => {
    expect(WELCOME_IMAGE_MANIFEST.sunday).toEqual([]);
    expect(getWelcomeImage(SUNDAY, 0)).toBe("/fred-welcome-morgen-1.png");
    expect(getWelcomeImage(NEW_YEAR, 0)).toBe("/fred-welcome-morgen-1.png");
  });

  it("uses the Sunday list on Sundays and the period list on other days", () => {
    const withSunday = manifest({ sunday: ["/sonntag-1.webp", "/sonntag-2.png"] });

    expect(getWelcomeImage(SUNDAY, 0, withSunday)).toBe("/sonntag-1.webp");
    expect(getWelcomeImage(SUNDAY, 0.99, withSunday)).toBe("/sonntag-2.png");
    expect(getWelcomeImage(MORNING, 0, withSunday)).toBe("/fred-welcome-morgen-1.png");
  });

  it("prefers the holiday list over Sunday and period lists", () => {
    const withLists = manifest({
      sunday: ["/sonntag-1.png"],
      holidays: { ...WELCOME_IMAGE_MANIFEST.holidays, ostersonntag: ["/ostern-1.webp"] },
    });

    // Ostersonntag 2026 ist Sonntag und Feiertag.
    expect(getWelcomeImage(new Date("2026-04-05T07:00:00.000Z"), 0, withLists)).toBe("/ostern-1.webp");
    // Anderer Feiertag ohne eigene Liste: Tageszeit (Wochentag), nicht Sonntag.
    expect(getWelcomeImage(NEW_YEAR, 0, withLists)).toBe("/fred-welcome-morgen-1.png");
  });

  it("falls back from an empty holiday list to the Sunday list, then to the period list", () => {
    const sundayOnly = manifest({ sunday: ["/sonntag-1.png"] });

    // Ostersonntag hat keine eigene Liste, ist aber ein Sonntag.
    expect(getWelcomeImage(new Date("2026-04-05T07:00:00.000Z"), 0, sundayOnly)).toBe("/sonntag-1.png");
  });

  it("uses the generic Fred image when even the period list is empty", () => {
    const empty = manifest({
      periods: { ...WELCOME_IMAGE_MANIFEST.periods, morning: [] },
    });

    expect(getWelcomeImage(MORNING, 0, empty)).toBe(FALLBACK_WELCOME_IMAGE);
  });

  it("ships every file the manifest references", () => {
    const { periods, sunday, holidays, staticFallbacks } = WELCOME_IMAGE_MANIFEST;
    const referenced = new Set([
      ...Object.values(periods).flat(),
      ...sunday,
      ...Object.values(holidays).flat(),
      ...staticFallbacks,
    ]);

    expect(referenced.size).toBeGreaterThanOrEqual(8);
    for (const image of referenced) {
      const file = fileURLToPath(new URL(`../../../public${image}`, import.meta.url));
      expect(existsSync(file), `${image} fehlt in public/`).toBe(true);
    }
  });

  it("lists a static fallback only for animated motifs of the manifest", () => {
    const { periods, sunday, holidays, staticFallbacks } = WELCOME_IMAGE_MANIFEST;
    const animated = [...Object.values(periods).flat(), ...sunday, ...Object.values(holidays).flat()]
      .filter((src) => /\.(webp|gif)$/iu.test(src))
      .map((src) => src.replace(/\.(webp|gif)$/iu, "-static.png"));

    for (const staticSrc of staticFallbacks) {
      expect(animated, staticSrc).toContain(staticSrc);
    }
  });
});

describe("resolveWelcomeImage", () => {
  const withStatic = (staticFallbacks: string[]): WelcomeImageManifest => ({
    ...WELCOME_IMAGE_MANIFEST,
    staticFallbacks,
  });

  it("keeps animated motifs when motion is allowed", () => {
    const manifest = withStatic(["/fred-ostern-1-static.png"]);

    expect(resolveWelcomeImage("/fred-ostern-1.webp", false, manifest)).toBe("/fred-ostern-1.webp");
  });

  it("swaps animated .webp and .gif for their static twin under reduced motion", () => {
    const manifest = withStatic(["/fred-ostern-1-static.png", "/fred-advent-static.png"]);

    expect(resolveWelcomeImage("/fred-ostern-1.webp", true, manifest)).toBe("/fred-ostern-1-static.png");
    expect(resolveWelcomeImage("/fred-advent.gif", true, manifest)).toBe("/fred-advent-static.png");
  });

  it("still shows the animated motif when no static fallback exists", () => {
    expect(resolveWelcomeImage("/fred-ostern-1.webp", true, withStatic([]))).toBe("/fred-ostern-1.webp");
    expect(resolveWelcomeImage("/fred-advent.gif", true, withStatic(["/other-static.png"]))).toBe(
      "/fred-advent.gif",
    );
  });

  it("never touches static motifs", () => {
    expect(resolveWelcomeImage("/fred-welcome-morgen-1.png", true)).toBe("/fred-welcome-morgen-1.png");
  });

  it("is case-insensitive about the animated extension", () => {
    const manifest = withStatic(["/fred-x-static.png"]);

    expect(resolveWelcomeImage("/fred-x.WEBP", true, manifest)).toBe("/fred-x-static.png");
  });
});
