import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  decryptOpenAICompatibleApiKey,
  encryptOpenAICompatibleApiKey,
} from "./openai-compatible-credentials";

const ENV_NAME = "OPENAI_COMPATIBLE_CREDENTIALS_KEY";

afterEach(() => {
  delete process.env[ENV_NAME];
});

describe("OpenAI-compatible credential encryption", () => {
  it("round-trips API keys using versioned AES-256-GCM ciphertext", () => {
    process.env[ENV_NAME] = randomBytes(32).toString("base64");

    const ciphertext = encryptOpenAICompatibleApiKey("provider-secret");

    expect(ciphertext).toMatch(/^v1\./);
    expect(ciphertext).not.toContain("provider-secret");
    expect(decryptOpenAICompatibleApiKey(ciphertext)).toBe("provider-secret");
  });

  it("fails closed when the environment key is missing", () => {
    expect(() => encryptOpenAICompatibleApiKey("provider-secret")).toThrow(
      "OpenAI-kompatible Zugangsdaten",
    );
  });

  it("rejects ciphertext with a different key or modified authentication tag", () => {
    process.env[ENV_NAME] = randomBytes(32).toString("base64");
    const ciphertext = encryptOpenAICompatibleApiKey("provider-secret");

    process.env[ENV_NAME] = randomBytes(32).toString("base64");
    expect(() => decryptOpenAICompatibleApiKey(ciphertext)).toThrow(
      "OpenAI-kompatible Zugangsdaten",
    );

    process.env[ENV_NAME] = randomBytes(32).toString("base64");
    const replacement = encryptOpenAICompatibleApiKey("provider-secret");
    const parts = replacement.split(".");
    parts[2] = `${parts[2]?.startsWith("A") ? "B" : "A"}${parts[2]?.slice(1)}`;
    const tampered = parts.join(".");
    expect(() => decryptOpenAICompatibleApiKey(tampered)).toThrow(
      "OpenAI-kompatible Zugangsdaten",
    );
  });

  it("validates the lazy environment key without exposing it", () => {
    process.env[ENV_NAME] = "not-a-32-byte-key";

    expect(() => encryptOpenAICompatibleApiKey("provider-secret")).toThrow(
      "OpenAI-kompatible Zugangsdaten",
    );
    expect(() => encryptOpenAICompatibleApiKey("provider-secret")).not.toThrow(
      process.env[ENV_NAME],
    );
  });
});
