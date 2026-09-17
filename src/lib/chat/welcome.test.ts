import { describe, expect, it } from "vitest";

import {
  FALLBACK_WELCOME_IMAGE,
  getWelcomeGreeting,
  getWelcomeImage,
  getWelcomePeriod,
} from "@/lib/chat/welcome";

describe("getWelcomeGreeting", () => {
  it.each([
    ["morning", "07:00:00.000Z", [
      "Guten Morgen! Ich hab mich schon zweimal gestreckt und einmal geschüttelt – bereit, wenn du es bist.",
      "Guten Morgen! Der Kaffee ist heiß, der Aktenstapel ist kalt. Womit fangen wir an?",
      "Guten Morgen! Ich hab die Nacht auf dem Ordnerstapel verbracht – überraschend bequem. Wobei kann ich helfen?",
      "Guten Morgen! Erste Runde ums Revier gedreht, alles ruhig. Und bei dir?",
      "Einen wunderschönen guten Morgen! Wirf mir deine Frage zu, ich bin schon in Position.",
      "Guten Morgen! Frisch aus dem Körbchen und bereits auf der Fährte. Wo geht's hin?",
      "Guten Morgen! Frühstück verschlungen, Platz für deine Fragen ist trotzdem noch da.",
      "Guten Morgen! Ohren aufgestellt, Nase justiert, Schwanz auf Betriebstemperatur. Leg los!",
      "Guten Morgen! Wer früh aufsteht, dem apportiert Fred. Was darf's sein?",
      "Guten Morgen! Ich hab schon die Zeitung geholt – jetzt bist du dran.",
    ]],
    ["midday", "11:30:00.000Z", [
      "Mahlzeit! Ich hab schon zweimal um den Tisch geschlichen. Was gibt's bei dir?",
      "Mahlzeit! Die Jause ist gesichert, die Ohren sind frei. Wobei kann ich helfen?",
      "Hallo! Mittagspause – ich teile alles, außer der Wurstsemmel.",
      "Mahlzeit! Kurz durchgeatmet, Napf geleert, volle Konzentration für dich.",
      "Servus! Ich sitz mit treuem Blick neben dem Tisch. Funktioniert erstaunlich oft.",
      "Mahlzeit! Zwischen zwei Bissen hab ich immer Zeit für deine Frage.",
      "Hallo! Ich hab das Mittagessen im Blick und dich im Ohr. Leg los.",
      "Mahlzeit! Erst die Pause, dann die Arbeit – oder beides gleichzeitig, das ist meine Spezialität.",
      "Servus! Mittagszeit ist der beste Moment, um Unangenehmes zu erledigen. Was steht an?",
      "Mahlzeit! Ich kau noch, aber ich hör dir schon zu.",
    ]],
    ["afternoon", "15:00:00.000Z", [
      "Hallo! Mittagsschlaf verschoben, deine Frage ist wichtiger.",
      "Servus! Ich sitz brav neben dem Ordner und wedle. Wobei kann ich helfen?",
      "Hallo! Ich hab die Nase tief im Papierstapel – wirf mir was zu.",
      "Hallo! Zwei Runden um den Schreibtisch gedreht, jetzt bin ich voll fokussiert. Was liegt an?",
      "Servus! Welche Frage soll ich für dich apportieren?",
      "Hallo! Ich bin der einzige Hund, der freiwillig Formulare holt. Welches darf's sein?",
      "Hallo! Gerade einen Beleg gefunden, der unter dem Sofa lag. Hast du auch welche?",
      "Grüß dich! Ich hab Zeit, Geduld und eine ausgezeichnete Nase. Leg los.",
      "Hallo! Kurze Pause vom Stöckchen, volle Aufmerksamkeit für dich.",
      "Servus! Sag ein Stichwort, den Rest bring ich dir.",
    ]],
    ["evening", "19:00:00.000Z", [
      "Guten Abend! Der Tag war lang, mein Schwanz wedelt trotzdem noch. Was liegt an?",
      "Guten Abend! Noch eine Runde durchs Aktenrevier, bevor wir Feierabend machen?",
      "Guten Abend! Ich hab mir den Platz vorm Kamin gesichert – frag ruhig von dort aus.",
      "Guten Abend! Wirf mir deine Frage zu, ich fang sie auch im Halbdunkel.",
      "Guten Abend! Der Napf ist leer, der Kopf ist voll. Womit kann ich helfen?",
      "Guten Abend! Ich hab den ganzen Tag Papier gehütet. Jetzt bist du dran.",
      "Guten Abend! Für dich mach ich gern Überstunden – zahlt mir eh keiner in Leckerlis.",
      "Schönen Abend! Ein letzter Schnüffler durchs Steuerrecht, bevor Ruhe einkehrt?",
      "Guten Abend! Müde genug für Gemütlichkeit, wach genug für deine Frage.",
      "Guten Abend! Was hat sich heute angesammelt? Ich hör zu.",
    ]],
    ["late night", "22:00:00.000Z", [
      "Andere zählen Schafe, ich sortiere Ordner. Was hält dich wach?",
      "So spät noch auf der Fährte? Ich bin dabei.",
      "Um die Zeit sind nur Nachtschwärmer, Eulen und ich unterwegs. Was liegt an?",
      "Ich hab ein Ohr im Körbchen und eins bei dir. Erzähl.",
      "Nachtschicht? Ich hab mich extra nicht zusammengerollt. Leg los.",
      "Der Mond steht hoch, der Papierstapel auch. Womit fangen wir an?",
      "Psst, die anderen schlafen. Wir zwei können ganz leise arbeiten.",
      "Zu später Stunde noch was Steuerliches? Ich schnüffel mit.",
      "Ich hab mich dreimal im Kreis gedreht und mich dann doch für dich entschieden.",
      "Späte Stunde, wache Nase. Was beschäftigt dich?",
    ]],
  ])("uses exactly the requested deterministic %s rotation", (_period, time, expected) => {
    const greetings = expected.map((_greeting, index) =>
      getWelcomeGreeting(new Date(`2026-01-${13 + index}T${time}`)),
    );

    expect(greetings).toEqual(expected);
    expect(expected).toHaveLength(10);
    expect(getWelcomeGreeting(new Date(`2026-01-13T${time}`))).toBe(expected[0]);
  });

  it("uses Europe/Vienna daylight-saving time before choosing the period", () => {
    expect(getWelcomeGreeting(new Date("2026-07-01T02:30:00.000Z"))).toBe(
      "Nachtschicht? Ich hab mich extra nicht zusammengerollt. Leg los.",
    );
    expect(getWelcomeGreeting(new Date("2026-07-01T03:30:00.000Z"))).toContain("Morgen");
  });

  it.each([
    ["2026-01-13T03:59:00.000Z", "Andere zählen Schafe, ich sortiere Ordner. Was hält dich wach?"],
    ["2026-01-13T04:00:00.000Z", "Guten Morgen! Ich hab mich schon zweimal gestreckt und einmal geschüttelt – bereit, wenn du es bist."],
    ["2026-01-13T09:59:00.000Z", "Guten Morgen! Ich hab mich schon zweimal gestreckt und einmal geschüttelt – bereit, wenn du es bist."],
    ["2026-01-13T10:00:00.000Z", "Mahlzeit! Ich hab schon zweimal um den Tisch geschlichen. Was gibt's bei dir?"],
    ["2026-01-13T12:59:00.000Z", "Mahlzeit! Ich hab schon zweimal um den Tisch geschlichen. Was gibt's bei dir?"],
    ["2026-01-13T13:00:00.000Z", "Hallo! Mittagsschlaf verschoben, deine Frage ist wichtiger."],
    ["2026-01-13T16:59:00.000Z", "Hallo! Mittagsschlaf verschoben, deine Frage ist wichtiger."],
    ["2026-01-13T17:00:00.000Z", "Guten Abend! Der Tag war lang, mein Schwanz wedelt trotzdem noch. Was liegt an?"],
    ["2026-01-13T20:59:00.000Z", "Guten Abend! Der Tag war lang, mein Schwanz wedelt trotzdem noch. Was liegt an?"],
    ["2026-01-13T21:00:00.000Z", "Andere zählen Schafe, ich sortiere Ordner. Was hält dich wach?"],
  ])("keeps the Vienna-local period boundary at %s", (timestamp, expected) => {
    expect(getWelcomeGreeting(new Date(timestamp))).toBe(expected);
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

  it("gives midday its own three-hour window between morning and afternoon", () => {
    // 11:00 bis 13:59 Wiener Zeit, im Januar also 10:00Z bis 12:59Z
    expect(getWelcomePeriod(new Date("2026-01-13T09:59:00.000Z"))).toBe("morning");
    expect(getWelcomePeriod(new Date("2026-01-13T10:00:00.000Z"))).toBe("midday");
    expect(getWelcomePeriod(new Date("2026-01-13T12:59:00.000Z"))).toBe("midday");
    expect(getWelcomePeriod(new Date("2026-01-13T13:00:00.000Z"))).toBe("afternoon");
  });
});

describe("getWelcomeImage", () => {
  const MORNING = new Date("2026-01-13T07:00:00.000Z");
  const MIDDAY = new Date("2026-01-13T11:30:00.000Z");

  it("rotates through every morning motif", () => {
    expect(getWelcomeImage(MORNING, 0)).toBe("/fred-welcome-morgen-1.png");
    expect(getWelcomeImage(MORNING, 0.75)).toBe("/fred-welcome-morgen-2.png");
  });

  it("rotates through every midday motif", () => {
    expect(getWelcomeImage(MIDDAY, 0)).toBe("/fred-welcome-mittag-1.png");
    expect(getWelcomeImage(MIDDAY, 0.5)).toBe("/fred-welcome-mittag-2.png");
    expect(getWelcomeImage(MIDDAY, 0.99)).toBe("/fred-welcome-mittag-3.png");
  });

  it("covers each motif of a period across many random draws", () => {
    const drawn = new Set(
      Array.from({ length: 300 }, (_unused, index) => getWelcomeImage(MIDDAY, index / 300)),
    );

    expect(drawn).toEqual(new Set([
      "/fred-welcome-mittag-1.png",
      "/fred-welcome-mittag-2.png",
      "/fred-welcome-mittag-3.png",
    ]));
  });

  it("stays inside the motif list even when the draw returns the upper bound", () => {
    expect(getWelcomeImage(MIDDAY, 1)).toBe("/fred-welcome-mittag-3.png");
    expect(getWelcomeImage(MORNING, 1)).toBe("/fred-welcome-morgen-2.png");
  });

  it("serves the single afternoon motif for every draw", () => {
    const afternoon = new Date("2026-01-13T15:00:00.000Z");

    expect(getWelcomeImage(afternoon, 0)).toBe("/fred-welcome-nachmittag-1.png");
    expect(getWelcomeImage(afternoon, 0.5)).toBe("/fred-welcome-nachmittag-1.png");
    expect(getWelcomeImage(afternoon, 1)).toBe("/fred-welcome-nachmittag-1.png");
  });

  it("serves the single late night motif for every draw", () => {
    const lateNight = new Date("2026-01-13T23:00:00.000Z");

    expect(getWelcomeImage(lateNight, 0)).toBe("/fred-welcome-nacht-1.png");
    expect(getWelcomeImage(lateNight, 0.5)).toBe("/fred-welcome-nacht-1.png");
    expect(getWelcomeImage(lateNight, 1)).toBe("/fred-welcome-nacht-1.png");
  });

  it("falls back to the shared image while the evening has no motif of its own", () => {
    expect(getWelcomeImage(new Date("2026-01-13T19:00:00.000Z"))).toBe(FALLBACK_WELCOME_IMAGE);
  });

  it("uses a real random draw when no explicit pick is given", () => {
    const drawn = new Set(Array.from({ length: 200 }, () => getWelcomeImage(MIDDAY)));

    expect(drawn.size).toBe(3);
  });
});
