import { describe, expect, it } from "vitest";

import {
  DEFAULT_CHAT_SETTINGS,
  normalizeStoredChatSettings,
} from "./settings";

describe("normalizeStoredChatSettings", () => {
  it("treats the former implicit Flash value as inherited global default", () => {
    expect(normalizeStoredChatSettings({ systemPrompt: "Mein Prompt" })).toEqual({
      model: null,
      followsDefault: true,
    });
    expect(normalizeStoredChatSettings({
      systemPrompt: "Mein Prompt",
      model: "deepseek-v4-flash",
      usesGlobalDefault: false,
    })).toEqual({
      model: null,
      followsDefault: true,
    });
  });

  it("preserves deliberate built-in and dynamic model choices", () => {
    expect(normalizeStoredChatSettings({ model: "deepseek-v4-pro" })).toEqual({
      model: "deepseek-v4-pro",
      followsDefault: false,
    });
    expect(normalizeStoredChatSettings({
      model: "openai:12345678-1234-4234-8234-123456789abc",
      followsDefault: false,
    })).toEqual({
      model: "openai:12345678-1234-4234-8234-123456789abc",
      followsDefault: false,
    });
  });

  it("continues following a changed administrator default without pinning its old id", () => {
    expect(normalizeStoredChatSettings({
      model: "deepseek-v4-pro",
      followsDefault: true,
    })).toEqual(DEFAULT_CHAT_SETTINGS);
  });

  it("falls back safely for invalid stored values", () => {
    expect(normalizeStoredChatSettings({ systemPrompt: "", model: "deepseek-chat" })).toEqual(
      DEFAULT_CHAT_SETTINGS,
    );
    expect(normalizeStoredChatSettings(null)).toEqual(DEFAULT_CHAT_SETTINGS);
  });

  it("has no client-side prompt state in its public settings contract", () => {
    expect(DEFAULT_CHAT_SETTINGS).toEqual({ model: null, followsDefault: true });
    expect(DEFAULT_CHAT_SETTINGS).not.toHaveProperty("systemPrompt");
    expect(DEFAULT_CHAT_SETTINGS).not.toHaveProperty("usesGlobalDefault");
  });
});
