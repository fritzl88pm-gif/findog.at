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

describe("parseSlashCommand: pro and web commands", () => {
  it("parses /pro as known command with no argument", () => {
    const result = parseSlashCommand("/pro");
    expect(result).toEqual({ command: "pro", botUsername: undefined, argument: undefined });
  });

  it("parses /pro on", () => {
    expect(parseSlashCommand("/pro on")).toEqual({ command: "pro", botUsername: undefined, argument: "on" });
  });

  it("parses /pro off", () => {
    expect(parseSlashCommand("/pro off")).toEqual({ command: "pro", botUsername: undefined, argument: "off" });
  });

  it("parses /pro status", () => {
    expect(parseSlashCommand("/pro status")).toEqual({ command: "pro", botUsername: undefined, argument: "status" });
  });

  it("parses /web as known command", () => {
    expect(parseSlashCommand("/web")).toEqual({ command: "web", botUsername: undefined, argument: undefined });
  });

  it("parses /web on", () => {
    expect(parseSlashCommand("/web on")).toEqual({ command: "web", botUsername: undefined, argument: "on" });
  });

  it("parses /web off", () => {
    expect(parseSlashCommand("/web off")).toEqual({ command: "web", botUsername: undefined, argument: "off" });
  });

  it("parses /web status", () => {
    expect(parseSlashCommand("/web status")).toEqual({ command: "web", botUsername: undefined, argument: "status" });
  });

  it("parses /pro with @mention", () => {
    expect(parseSlashCommand("/pro@findog_bot on")).toEqual({ command: "pro", botUsername: "findog_bot", argument: "on" });
  });

  it("parses /web@findog_bot off", () => {
    expect(parseSlashCommand("/web@findog_bot off")).toEqual({ command: "web", botUsername: "findog_bot", argument: "off" });
  });

  it("parses /PRO ON (uppercase) as normalized lowercase", () => {
    expect(parseSlashCommand("/PRO ON")).toEqual({ command: "pro", botUsername: undefined, argument: "on" });
  });

  it("parses /WEB OFF with surrounding whitespace", () => {
    expect(parseSlashCommand("  /web off  ")).toEqual({ command: "web", botUsername: undefined, argument: "off" });
  });

  it("parses /pro with @mention and extra whitespace", () => {
    expect(parseSlashCommand("  /pro@Findog_Bot  on  ")).toEqual({ command: "pro", botUsername: "findog_bot", argument: "on" });
  });

  it("returns known command with raw argument for invalid /pro arguments (not on/off/status)", () => {
    expect(parseSlashCommand("/pro toggle")).toEqual({ command: "pro", botUsername: undefined, argument: "toggle" });
  });

  it("returns known command with raw argument for /web with multiple arguments", () => {
    expect(parseSlashCommand("/web on please")).toEqual({ command: "web", botUsername: undefined, argument: "on please" });
  });

  it("parses /pro with trailing whitespace as bare command", () => {
    expect(parseSlashCommand("/pro  ")).toEqual({ command: "pro", botUsername: undefined, argument: undefined });
  });
  it("parses /pro nonsense as known command with raw argument", () => {
    expect(parseSlashCommand("/pro nonsense")).toEqual({ command: "pro", botUsername: undefined, argument: "nonsense" });
  });

  it("parses /web on please as known command with raw argument", () => {
    expect(parseSlashCommand("/web on please")).toEqual({ command: "web", botUsername: undefined, argument: "on please" });
  });


  it("returns known command with raw argument for /web with unrecognized argument", () => {
    expect(parseSlashCommand("/web maybe")).toEqual({ command: "web", botUsername: undefined, argument: "maybe" });
  });
});

describe("isKnownSlashCommand: pro and web", () => {
  it("returns true for /pro", () => {
    expect(isKnownSlashCommand("/pro")).toBe(true);
    expect(isKnownSlashCommand("/pro on")).toBe(true);
    expect(isKnownSlashCommand("/pro off")).toBe(true);
  });

  it("returns true for /web", () => {
    expect(isKnownSlashCommand("/web")).toBe(true);
    expect(isKnownSlashCommand("/web status")).toBe(true);
  });
});

describe("looksLikeSlashCommand: regression", () => {
  it("returns true for new commands", () => {
    expect(looksLikeSlashCommand("/pro")).toBe(true);
    expect(looksLikeSlashCommand("/pro on")).toBe(true);
    expect(looksLikeSlashCommand("/web off")).toBe(true);
  });
});
