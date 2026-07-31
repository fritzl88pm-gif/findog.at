import { describe, expect, it } from "vitest";

import {
  isKnownSlashCommand,
  looksLikeSlashCommand,
  parseSlashCommand,
} from "./commands";

describe("parseSlashCommand", () => {
  it("parses /start without @mention", () => {
    const result = parseSlashCommand("/start");
    expect(result).toEqual({ command: "start", botUsername: undefined });
  });

  it("parses /start with @mention", () => {
    const result = parseSlashCommand("/start@findog_bot");
    expect(result).toEqual({ command: "start", botUsername: "findog_bot" });
  });

  it("parses /new", () => {
    expect(parseSlashCommand("/new")).toEqual({ command: "new", botUsername: undefined });
  });

  it("parses /new@findog_bot", () => {
    expect(parseSlashCommand("/new@findog_bot")).toEqual({ command: "new", botUsername: "findog_bot" });
  });

  it("parses /stop", () => {
    expect(parseSlashCommand("/stop")).toEqual({ command: "stop", botUsername: undefined });
  });

  it("parses /stop with args (ignored)", () => {
    const result = parseSlashCommand("/stop please");
    expect(result).toEqual({ command: "stop", botUsername: undefined });
  });

  it("parses /status", () => {
    expect(parseSlashCommand("/status")).toEqual({ command: "status", botUsername: undefined });
  });

  it("parses /help", () => {
    expect(parseSlashCommand("/help")).toEqual({ command: "help", botUsername: undefined });
  });

  it("parses /settings", () => {
    expect(parseSlashCommand("/settings")).toEqual({ command: "settings", botUsername: undefined });
  });

  it("returns null for non-command text", () => {
    expect(parseSlashCommand("hello")).toBeNull();
    expect(parseSlashCommand("")).toBeNull();
    expect(parseSlashCommand("  ")).toBeNull();
  });

  it("returns null for unknown slash commands", () => {
    expect(parseSlashCommand("/unknown")).toBeNull();
    expect(parseSlashCommand("/unknown@bot")).toBeNull();
  });

  it("normalizes whitespace", () => {
    expect(parseSlashCommand("  /start  ")).toEqual({ command: "start", botUsername: undefined });
  });

  it("normalizes trailing bot username", () => {
    expect(parseSlashCommand("/START@Findog_Bot")).toEqual({
      command: "start",
      botUsername: "findog_bot",
    });
  });

  it("handles /start with payload (deep link)", () => {
    const result = parseSlashCommand("/start pairing_token_123");
    expect(result).toEqual({ command: "start", botUsername: undefined });
  });
});

describe("isKnownSlashCommand", () => {
  it("returns true for all known commands", () => {
    expect(isKnownSlashCommand("/start")).toBe(true);
    expect(isKnownSlashCommand("/new")).toBe(true);
    expect(isKnownSlashCommand("/stop")).toBe(true);
    expect(isKnownSlashCommand("/status")).toBe(true);
    expect(isKnownSlashCommand("/help")).toBe(true);
    expect(isKnownSlashCommand("/settings")).toBe(true);
  });

  it("returns false for unknown commands", () => {
    expect(isKnownSlashCommand("/unknown")).toBe(false);
    expect(isKnownSlashCommand("hello")).toBe(false);
  });
});

describe("looksLikeSlashCommand", () => {
  it("returns true for known and unknown slash-shaped text", () => {
    expect(looksLikeSlashCommand("/start")).toBe(true);
    expect(looksLikeSlashCommand("/unknown")).toBe(true);
    expect(looksLikeSlashCommand("/unknown@findog_bot arg")).toBe(true);
  });

  it("returns false for free text, including text that merely contains a slash", () => {
    expect(looksLikeSlashCommand("hello")).toBe(false);
    expect(looksLikeSlashCommand("")).toBe(false);
    expect(looksLikeSlashCommand("Wie hoch ist 1/2 der Steuer?")).toBe(false);
  });
});
