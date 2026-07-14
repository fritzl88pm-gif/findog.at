import { describe, expect, it } from "vitest";

import {
  DEFAULT_CHAT_SETTINGS,
  normalizeStoredChatSettings,
} from "./settings";

describe("normalizeStoredChatSettings", () => {
  it("ignores legacy personal prompt fields and keeps only the selected model", () => {
    expect(normalizeStoredChatSettings({ systemPrompt: "Mein Prompt" })).toEqual({
      model: "deepseek-v4-flash",
    });
    expect(normalizeStoredChatSettings({
      systemPrompt: "Mein Prompt",
      model: "deepseek-v4-flash",
      usesGlobalDefault: false,
    })).toEqual({
      model: "deepseek-v4-flash",
    });
  });

  it("falls back safely for invalid stored values", () => {
    expect(normalizeStoredChatSettings({ systemPrompt: "", model: "deepseek-chat" })).toEqual(
      DEFAULT_CHAT_SETTINGS,
    );
    expect(normalizeStoredChatSettings(null)).toEqual(DEFAULT_CHAT_SETTINGS);
  });

  it("has no client-side prompt state in its public settings contract", () => {
    expect(DEFAULT_CHAT_SETTINGS).toEqual({ model: "deepseek-v4-flash" });
    expect(DEFAULT_CHAT_SETTINGS).not.toHaveProperty("systemPrompt");
    expect(DEFAULT_CHAT_SETTINGS).not.toHaveProperty("usesGlobalDefault");
  });
});
