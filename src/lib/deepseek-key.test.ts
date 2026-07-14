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

  it("uses the server DeepSeek key for Pro", () => {
    process.env.DEEPSEEK_API_KEY = "  pro-server-key  ";
    process.env.GLOBAL_DEEPSEEK_API_KEY = "fallback-server-key";

    expect(resolveDeepSeekApiKey()).toBe("pro-server-key");
  });

  it("falls back to GLOBAL_DEEPSEEK_API_KEY for Pro", () => {
    process.env.DEEPSEEK_API_KEY = " ";
    process.env.GLOBAL_DEEPSEEK_API_KEY = " fallback-server-key ";

    expect(resolveDeepSeekApiKey()).toBe("fallback-server-key");
  });

  it("raises a German user-visible error when Pro server configuration is missing", () => {
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.GLOBAL_DEEPSEEK_API_KEY;

    expect(() => resolveDeepSeekApiKey()).toThrow(UserVisibleError);
    expect(() => resolveDeepSeekApiKey()).toThrow(
      "Serverseitige DeepSeek-Konfiguration fehlt. Bitte Administrator kontaktieren.",
    );
  });

  it("validates Pro server key length", () => {
    process.env.DEEPSEEK_API_KEY = "x".repeat(MAX_DEEPSEEK_KEY_CHARS + 1);

    expect(() => resolveDeepSeekApiKey()).toThrow("DeepSeek API Key ist zu lang.");
  });
});
