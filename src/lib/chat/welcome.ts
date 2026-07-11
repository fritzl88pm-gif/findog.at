const MORNING_GREETINGS = [
  "Guten Morgen! Wobei kann ich heute steuerlich helfen?",
  "Guten Morgen! Welche Steuerfrage darf ich heute klären?",
  "Einen guten Morgen! Was kann ich steuerlich für dich tun?",
] as const;

const DAYTIME_GREETINGS = [
  "Hallo! Wobei kann ich heute steuerlich helfen?",
  "Hallo! Welche steuerliche Frage darf ich heute klären?",
  "Was darf ich heute steuerlich für dich klären?",
] as const;

const EVENING_GREETINGS = [
  "Guten Abend! Wobei kann ich steuerlich helfen?",
  "Guten Abend! Welche Steuerfrage beschäftigt dich?",
  "Guten Abend! Was kann ich steuerlich für dich tun?",
] as const;

const LATE_NIGHT_GREETINGS = [
  "Was liegt so spät noch an?",
  "Noch eine späte Steuerfrage? Ich helfe gern.",
  "Zu später Stunde noch etwas Steuerliches zu klären?",
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
