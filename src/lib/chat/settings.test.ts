import { describe, expect, it } from "vitest";

import { DEFAULT_SYSTEM_PROMPT } from "../config";
import {
  DEFAULT_CHAT_SETTINGS,
  displayedSystemPrompt,
  editPersonalSystemPrompt,
  normalizeStoredChatSettings,
  resetToGlobalSystemPrompt,
  systemPromptForChatRequest,
} from "./settings";

describe("normalizeStoredChatSettings", () => {
  it("migrates stored settings without a model to DeepSeek v4 Pro", () => {
    expect(normalizeStoredChatSettings({ systemPrompt: "Mein Prompt" })).toEqual({
      systemPrompt: "Mein Prompt",
      model: "deepseek-v4-pro",
      usesGlobalDefault: false,
    });
  });

  it("retains a supported Flash selection", () => {
    expect(normalizeStoredChatSettings({
      systemPrompt: "Mein Prompt",
      model: "deepseek-v4-flash",
    })).toEqual({
      systemPrompt: "Mein Prompt",
      model: "deepseek-v4-flash",
      usesGlobalDefault: false,
    });
  });

  it("migrates the historical built-in prompt to dynamic global-default mode", () => {
    expect(normalizeStoredChatSettings({
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      model: "deepseek-v4-flash",
    })).toEqual({
      systemPrompt: "",
      model: "deepseek-v4-flash",
      usesGlobalDefault: true,
    });
  });

  it("retains explicit personal mode, including a prompt equal to the built-in default", () => {
    expect(normalizeStoredChatSettings({
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      model: "deepseek-v4-pro",
      usesGlobalDefault: false,
    })).toEqual({
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      model: "deepseek-v4-pro",
      usesGlobalDefault: false,
    });
  });

  it("falls back safely for invalid stored values", () => {
    expect(normalizeStoredChatSettings({ systemPrompt: "", model: "deepseek-chat" })).toEqual(
      DEFAULT_CHAT_SETTINGS,
    );
    expect(normalizeStoredChatSettings(null)).toEqual(DEFAULT_CHAT_SETTINGS);
  });
});

describe("dynamic global system prompt settings", () => {
  it("displays the latest global prompt and omits a personal prompt from chat requests", () => {
    const settings = resetToGlobalSystemPrompt({
      systemPrompt: "Mein Prompt",
      model: "deepseek-v4-pro",
      usesGlobalDefault: false,
    });

    expect(displayedSystemPrompt(settings, "Global v1")).toBe("Global v1");
    expect(displayedSystemPrompt(settings, "Global v2")).toBe("Global v2");
    expect(systemPromptForChatRequest(settings)).toBeUndefined();
  });

  it("turns editing in default mode into a personal override", () => {
    const settings = editPersonalSystemPrompt(DEFAULT_CHAT_SETTINGS, "Mein neuer Prompt");

    expect(settings).toEqual({
      systemPrompt: "Mein neuer Prompt",
      model: "deepseek-v4-pro",
      usesGlobalDefault: false,
    });
    expect(displayedSystemPrompt(settings, "Späterer globaler Prompt")).toBe("Mein neuer Prompt");
    expect(systemPromptForChatRequest(settings)).toBe("Mein neuer Prompt");
  });
});
