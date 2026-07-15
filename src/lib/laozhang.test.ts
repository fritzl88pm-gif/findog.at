import { afterEach, describe, expect, it } from "vitest";

import { isLaoZhangApiKeyConfigured, resolveLaoZhangApiKey } from "./laozhang-key";
import { UserVisibleError } from "./errors";

const originalLaoZhangKey = process.env.LAOZHANG_API_KEY;

afterEach(() => {
  if (originalLaoZhangKey === undefined) {
    delete process.env.LAOZHANG_API_KEY;
  } else {
    process.env.LAOZHANG_API_KEY = originalLaoZhangKey;
  }
});

describe("resolveLaoZhangApiKey", () => {
  it("returns a configured LaoZhang API key", () => {
    process.env.LAOZHANG_API_KEY = "  lz-secret-key  ";

    expect(resolveLaoZhangApiKey()).toBe("lz-secret-key");
  });

  it("raises a user-visible error when the key is missing", () => {
    delete process.env.LAOZHANG_API_KEY;

    expect(() => resolveLaoZhangApiKey()).toThrow(UserVisibleError);
    expect(() => resolveLaoZhangApiKey()).toThrow(
      "Serverseitige LaoZhang-Konfiguration fehlt",
    );
  });

  it("rejects keys over the maximum length", () => {
    process.env.LAOZHANG_API_KEY = "k".repeat(600);

    expect(() => resolveLaoZhangApiKey()).toThrow("LaoZhang API Key ist zu lang.");
  });

  it("isLaoZhangApiKeyConfigured returns false when key is missing", () => {
    delete process.env.LAOZHANG_API_KEY;

    expect(isLaoZhangApiKeyConfigured()).toBe(false);
  });

  it("isLaoZhangApiKeyConfigured returns true when key is set", () => {
    process.env.LAOZHANG_API_KEY = "lz-secret";

    expect(isLaoZhangApiKeyConfigured()).toBe(true);
  });
});
