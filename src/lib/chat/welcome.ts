const MORNING_GREETINGS = [
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
] as const;

const DAYTIME_GREETINGS = [
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
] as const;

const EVENING_GREETINGS = [
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
] as const;

const LATE_NIGHT_GREETINGS = [
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
] as const;

const VIENNA_DATE_TIME = new Intl.DateTimeFormat("de-AT", {
  timeZone: "Europe/Vienna",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  hourCycle: "h23",
});

export function getWelcomeGreeting(instant: Date = new Date()): string {
  const parts = VIENNA_DATE_TIME.formatToParts(instant);
  const valueOf = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const year = valueOf("year");
  const month = valueOf("month");
  const day = valueOf("day");
  const hour = valueOf("hour");

  const greetings = hour >= 5 && hour < 11
    ? MORNING_GREETINGS
    : hour >= 11 && hour < 18
      ? DAYTIME_GREETINGS
      : hour >= 18 && hour < 22
        ? EVENING_GREETINGS
        : LATE_NIGHT_GREETINGS;
  const greetingIndex = (year + month + day) % greetings.length;

  return greetings[greetingIndex];
}
