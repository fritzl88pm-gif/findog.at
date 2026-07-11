const MORNING_GREETINGS = [
  "Guten Morgen! Wobei kann ich heute steuerlich helfen?",
  "Guten Morgen! Welche Steuerfrage darf ich heute klären?",
  "Guten Morgen! Frisch aus dem Körbchen und bereit für deine Steuerfragen.",
  "Guten Morgen! Ich hab schon Witterung aufgenommen – wobei kann ich helfen?",
  "Einen guten Morgen! Womit sollen wir heute die Fährte aufnehmen?",
] as const;

const DAYTIME_GREETINGS = [
  "Hallo! Wobei kann ich heute steuerlich helfen?",
  "Hallo! Welche steuerliche Frage darf ich heute klären?",
  "Hallo! Welche Steuerfrage soll ich für dich apportieren?",
  "Hallo! Ich hab die Nase im Gesetzestext – wobei kann ich helfen?",
  "Servus! Was darf ich heute für dich aufspüren?",
] as const;

const EVENING_GREETINGS = [
  "Guten Abend! Wobei kann ich steuerlich helfen?",
  "Guten Abend! Welche Steuerfrage beschäftigt dich?",
  "Guten Abend! Noch eine Runde durchs Steuerrecht, bevor wir Feierabend machen?",
  "Guten Abend! Wirf mir deine Frage zu, ich fang sie.",
  "Guten Abend! Womit kann ich dir zum Tagesausklang steuerlich helfen?",
] as const;

const LATE_NIGHT_GREETINGS = [
  "Was liegt so spät noch an?",
  "Noch eine späte Steuerfrage? Ich helfe gern.",
  "So spät noch auf der Fährte? Ich bin dabei.",
  "Andere schlafen, ich hab die Ohren gespitzt – was liegt an?",
  "Zu später Stunde noch was Steuerliches? Ich schnüffel mit.",
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
