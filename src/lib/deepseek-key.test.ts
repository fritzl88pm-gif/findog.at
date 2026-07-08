import { afterEach, describe, expect, it } from "vitest";

import { MAX_DEEPSEEK_KEY_CHARS } from "./config";
import { resolveDeepSeekApiKey } from "./deepseek-key";
import { UserVisibleError } from "./errors";

const originalDeepSeekKey = process.env.DEEPSEEK_API_KEY;
const originalGlobalDeepSeekKey = process.env.GLOBAL_DEEPSEEK_API_KEY;

function resetEnv() {
  if (originalDeepSeekKey === undefined) {
    delete process.env.DEEPSEEK_API_KEY;
  } else {
    process.env.DEEPSEEK_API_KEY = originalDeepSeekKey;
  }

  if (originalGlobalDeepSeekKey === undefined) {
    delete process.env.GLOBAL_DEEPSEEK_API_KEY;
  } else {
    process.env.GLOBAL_DEEPSEEK_API_KEY = originalGlobalDeepSeekKey;
  }
}

describe("resolveDeepSeekApiKey", () => {
  afterEach(resetEnv);

  it("uses the server DeepSeek key for Flash and ignores any user key", () => {
    process.env.DEEPSEEK_API_KEY = "  flash-server-key  ";
    process.env.GLOBAL_DEEPSEEK_API_KEY = "fallback-server-key";

    expect(resolveDeepSeekApiKey({ model: "deepseek-v4-flash", userApiKey: "user-key" })).toBe(
      "flash-server-key",
    );
  });

  it("falls back to GLOBAL_DEEPSEEK_API_KEY for Flash", () => {
    process.env.DEEPSEEK_API_KEY = " ";
    process.env.GLOBAL_DEEPSEEK_API_KEY = " fallback-server-key ";

    expect(resolveDeepSeekApiKey({ model: "deepseek-v4-flash" })).toBe("fallback-server-key");
  });

  it("raises a German user-visible error when Flash server configuration is missing", () => {
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.GLOBAL_DEEPSEEK_API_KEY;

    expect(() => resolveDeepSeekApiKey({ model: "deepseek-v4-flash" })).toThrow(UserVisibleError);
    expect(() => resolveDeepSeekApiKey({ model: "deepseek-v4-flash" })).toThrow(
      "Serverseitige DeepSeek Flash Konfiguration fehlt. Bitte Administrator kontaktieren.",
    );
  });

  it("uses the request user key for Pro and ignores server keys", () => {
    process.env.DEEPSEEK_API_KEY = "flash-server-key";

    expect(resolveDeepSeekApiKey({ model: "deepseek-v4-pro", userApiKey: "  user-pro-key  " })).toBe(
      "user-pro-key",
    );
  });

  it("raises a German user-visible error when Pro user key is missing", () => {
    process.env.DEEPSEEK_API_KEY = "flash-server-key";

    expect(() => resolveDeepSeekApiKey({ model: "deepseek-v4-pro" })).toThrow(UserVisibleError);
    expect(() => resolveDeepSeekApiKey({ model: "deepseek-v4-pro" })).toThrow(
      "DeepSeek Pro benötigt deinen eigenen API Key. Bitte in den Einstellungen eintragen.",
    );
  });

  it("validates Flash server key length", () => {
    process.env.DEEPSEEK_API_KEY = "x".repeat(MAX_DEEPSEEK_KEY_CHARS + 1);

    expect(() => resolveDeepSeekApiKey({ model: "deepseek-v4-flash" })).toThrow(
      "DeepSeek Flash API Key ist zu lang.",
    );
  });

  it("validates Pro user key length", () => {
    expect(() =>
      resolveDeepSeekApiKey({
        model: "deepseek-v4-pro",
        userApiKey: "x".repeat(MAX_DEEPSEEK_KEY_CHARS + 1),
      }),
    ).toThrow("DeepSeek Pro API Key ist zu lang.");
  });
});
