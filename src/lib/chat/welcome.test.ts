import { describe, expect, it } from "vitest";

import { getWelcomeGreeting } from "@/lib/chat/welcome";

describe("getWelcomeGreeting", () => {
  it.each([
    ["morning", "07:00:00.000Z", [
      "Guten Morgen! Wobei kann ich heute steuerlich helfen?",
      "Guten Morgen! Welche Steuerfrage darf ich heute klären?",
      "Guten Morgen! Frisch aus dem Körbchen und bereit für deine Steuerfragen.",
      "Guten Morgen! Ich hab schon Witterung aufgenommen – wobei kann ich helfen?",
      "Einen guten Morgen! Womit sollen wir heute die Fährte aufnehmen?",
    ]],
    ["daytime", "12:00:00.000Z", [
      "Hallo! Wobei kann ich heute steuerlich helfen?",
      "Hallo! Welche steuerliche Frage darf ich heute klären?",
      "Hallo! Welche Steuerfrage soll ich für dich apportieren?",
      "Hallo! Ich hab die Nase im Gesetzestext – wobei kann ich helfen?",
      "Servus! Was darf ich heute für dich aufspüren?",
    ]],
    ["evening", "19:00:00.000Z", [
      "Guten Abend! Wobei kann ich steuerlich helfen?",
      "Guten Abend! Welche Steuerfrage beschäftigt dich?",
      "Guten Abend! Noch eine Runde durchs Steuerrecht, bevor wir Feierabend machen?",
      "Guten Abend! Wirf mir deine Frage zu, ich fang sie.",
      "Guten Abend! Womit kann ich dir zum Tagesausklang steuerlich helfen?",
    ]],
    ["late night", "22:00:00.000Z", [
      "Was liegt so spät noch an?",
      "Noch eine späte Steuerfrage? Ich helfe gern.",
      "So spät noch auf der Fährte? Ich bin dabei.",
      "Andere schlafen, ich hab die Ohren gespitzt – was liegt an?",
      "Zu später Stunde noch was Steuerliches? Ich schnüffel mit.",
    ]],
  ])("uses exactly the requested deterministic %s rotation", (_period, time, expected) => {
    const greetings = expected.map((_greeting, index) =>
      getWelcomeGreeting(new Date(`2026-01-${13 + index}T${time}`)),
    );

    expect(greetings).toEqual(expected);
    expect(getWelcomeGreeting(new Date(`2026-01-13T${time}`))).toBe(expected[0]);
  });

  it("uses Europe/Vienna daylight-saving time before choosing the period", () => {
    expect(getWelcomeGreeting(new Date("2026-07-01T02:30:00.000Z"))).toBe(
      "Zu später Stunde noch was Steuerliches? Ich schnüffel mit.",
    );
    expect(getWelcomeGreeting(new Date("2026-07-01T03:30:00.000Z"))).toContain("Morgen");
  });

  it.each([
    ["2026-01-13T03:59:00.000Z", "Was liegt so spät noch an?"],
    ["2026-01-13T04:00:00.000Z", "Guten Morgen! Wobei kann ich heute steuerlich helfen?"],
    ["2026-01-13T09:59:00.000Z", "Guten Morgen! Wobei kann ich heute steuerlich helfen?"],
    ["2026-01-13T10:00:00.000Z", "Hallo! Wobei kann ich heute steuerlich helfen?"],
    ["2026-01-13T16:59:00.000Z", "Hallo! Wobei kann ich heute steuerlich helfen?"],
    ["2026-01-13T17:00:00.000Z", "Guten Abend! Wobei kann ich steuerlich helfen?"],
    ["2026-01-13T20:59:00.000Z", "Guten Abend! Wobei kann ich steuerlich helfen?"],
    ["2026-01-13T21:00:00.000Z", "Was liegt so spät noch an?"],
  ])("keeps the Vienna-local period boundary at %s", (timestamp, expected) => {
    expect(getWelcomeGreeting(new Date(timestamp))).toBe(expected);
  });
});
