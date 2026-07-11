import { describe, expect, it } from "vitest";

import { getWelcomeGreeting } from "@/lib/chat/welcome";

describe("getWelcomeGreeting", () => {
  it.each([
    [
      "morning",
      "2026-01-13T07:00:00.000Z",
      "Guten Morgen! Wobei kann ich heute steuerlich helfen?",
    ],
    [
      "daytime",
      "2026-01-14T12:00:00.000Z",
      "Hallo! Welche steuerliche Frage darf ich heute klären?",
    ],
    [
      "evening",
      "2026-01-15T19:00:00.000Z",
      "Guten Abend! Was kann ich steuerlich für dich tun?",
    ],
    [
      "late night",
      "2026-07-15T22:30:00.000Z",
      "Was liegt so spät noch an?",
    ],
  ])("returns a deterministic Vienna-local %s greeting", (_period, timestamp, expected) => {
    const instant = new Date(timestamp);

    expect(getWelcomeGreeting(instant)).toBe(expected);
    expect(getWelcomeGreeting(instant)).toBe(expected);
  });

  it("uses Europe/Vienna daylight-saving time before choosing the period", () => {
    expect(getWelcomeGreeting(new Date("2026-07-01T02:30:00.000Z"))).toBe("Was liegt so spät noch an?");
    expect(getWelcomeGreeting(new Date("2026-07-01T03:30:00.000Z"))).toContain("Morgen");
  });

  it("rotates through several stable variations by Vienna calendar date", () => {
    const greetings = [13, 14, 15].map((day) =>
      getWelcomeGreeting(new Date(`2026-01-${day}T07:00:00.000Z`)),
    );

    expect(new Set(greetings).size).toBe(3);
  });
});
