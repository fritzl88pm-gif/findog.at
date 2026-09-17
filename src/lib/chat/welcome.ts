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

const MIDDAY_GREETINGS = [
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
] as const;

const AFTERNOON_GREETINGS = [
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

/** Bild, das gezeigt wird, solange eine Tageszeit noch keine eigenen Motive hat. */
export const FALLBACK_WELCOME_IMAGE = "/fred.png";

const MORNING_IMAGES = [
  "/fred-welcome-morgen-1.png",
  "/fred-welcome-morgen-2.png",
] as const;

const MIDDAY_IMAGES = [
  "/fred-welcome-mittag-1.png",
  "/fred-welcome-mittag-2.png",
  "/fred-welcome-mittag-3.png",
] as const;

const AFTERNOON_IMAGES = [
  "/fred-welcome-nachmittag-1.png",
] as const;

const EVENING_IMAGES = [] as const;

const LATE_NIGHT_IMAGES = [
  "/fred-welcome-nacht-1.png",
] as const;

type WelcomePeriod = "morning" | "midday" | "afternoon" | "evening" | "lateNight";

const PERIOD_CONTENT: Record<
  WelcomePeriod,
  { greetings: readonly string[]; images: readonly string[] }
> = {
  morning: { greetings: MORNING_GREETINGS, images: MORNING_IMAGES },
  midday: { greetings: MIDDAY_GREETINGS, images: MIDDAY_IMAGES },
  afternoon: { greetings: AFTERNOON_GREETINGS, images: AFTERNOON_IMAGES },
  evening: { greetings: EVENING_GREETINGS, images: EVENING_IMAGES },
  lateNight: { greetings: LATE_NIGHT_GREETINGS, images: LATE_NIGHT_IMAGES },
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
  const { greetings } = PERIOD_CONTENT[getWelcomePeriod(instant)];
  const greetingIndex = (year + month + day) % greetings.length;

  return greetings[greetingIndex];
}

/**
 * Wählt zufällig eines der Motive der aktuellen Tageszeit. `pick` ist nur für
 * Tests da und erwartet einen Wert aus [0, 1).
 */
export function getWelcomeImage(
  instant: Date = new Date(),
  pick: number = Math.random(),
): string {
  const { images } = PERIOD_CONTENT[getWelcomePeriod(instant)];
  if (images.length === 0) return FALLBACK_WELCOME_IMAGE;

  const imageIndex = Math.min(images.length - 1, Math.max(0, Math.floor(pick * images.length)));

  return images[imageIndex];
}
