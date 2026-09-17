import { describe, expect, it } from "vitest";

import { getWelcomeGreeting } from "@/lib/chat/welcome";

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
    ["daytime", "12:00:00.000Z", [
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
    ["2026-01-13T10:00:00.000Z", "Hallo! Mittagsschlaf verschoben, deine Frage ist wichtiger."],
    ["2026-01-13T16:59:00.000Z", "Hallo! Mittagsschlaf verschoben, deine Frage ist wichtiger."],
    ["2026-01-13T17:00:00.000Z", "Guten Abend! Der Tag war lang, mein Schwanz wedelt trotzdem noch. Was liegt an?"],
    ["2026-01-13T20:59:00.000Z", "Guten Abend! Der Tag war lang, mein Schwanz wedelt trotzdem noch. Was liegt an?"],
    ["2026-01-13T21:00:00.000Z", "Andere zählen Schafe, ich sortiere Ordner. Was hält dich wach?"],
  ])("keeps the Vienna-local period boundary at %s", (timestamp, expected) => {
    expect(getWelcomeGreeting(new Date(timestamp))).toBe(expected);
  });
});
