import { describe, expect, it } from "vitest";

import { DEFAULT_CHAT_SETTINGS, normalizeStoredChatSettings } from "./settings";

describe("normalizeStoredChatSettings", () => {
  it("migrates stored settings without a model to DeepSeek v4 Pro", () => {
    expect(normalizeStoredChatSettings({ systemPrompt: "Mein Prompt" })).toEqual({
      systemPrompt: "Mein Prompt",
      model: "deepseek-v4-pro",
    });
  });

  it("retains a supported Flash selection", () => {
    expect(normalizeStoredChatSettings({
      systemPrompt: "Mein Prompt",
      model: "deepseek-v4-flash",
    })).toEqual({
      systemPrompt: "Mein Prompt",
      model: "deepseek-v4-flash",
    });
  });

  it("falls back safely for invalid stored values", () => {
    expect(normalizeStoredChatSettings({ systemPrompt: "", model: "deepseek-chat" })).toEqual(
      DEFAULT_CHAT_SETTINGS,
    );
    expect(normalizeStoredChatSettings(null)).toEqual(DEFAULT_CHAT_SETTINGS);
  });
});
