import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  decryptTelegramToken,
  encryptTelegramToken,
} from "./credentials";

const ENV_NAME = "TELEGRAM_CREDENTIALS_KEY";

afterEach(() => {
  delete process.env[ENV_NAME];
});

describe("Telegram token encryption", () => {
  it("round-trips tokens using versioned AES-256-GCM ciphertext", () => {
    process.env[ENV_NAME] = randomBytes(32).toString("base64");

    const aad = {
      integrationId: "c0a00000-0000-0000-0000-000000000001",
      clientId: "b0a00000-0000-0000-0000-000000000001",
      botUserId: 123456789,
    };
    const ciphertext = encryptTelegramToken("1234567890:AAECDefghIJKLMNOPQRSTUVWXYZabcdefg", aad);

    expect(ciphertext).toMatch(/^v1\./);
    expect(ciphertext).not.toContain("1234567890");
    const decrypted = decryptTelegramToken(ciphertext, aad);
    expect(decrypted).toBe("1234567890:AAECDefghIJKLMNOPQRSTUVWXYZabcdefg");
  });

  it("fails closed when the environment key is missing", () => {
    expect(() =>
      encryptTelegramToken("dummy-token", {
        integrationId: "c0a00000-0000-0000-0000-000000000001",
        clientId: "b0a00000-0000-0000-0000-000000000001",
        botUserId: 1,
      }),
    ).toThrow("Telegram-Zugangsdaten");
  });

  it("rejects ciphertext with a different key", () => {
    process.env[ENV_NAME] = randomBytes(32).toString("base64");
    const aad = {
      integrationId: "c0a00000-0000-0000-0000-000000000001",
      clientId: "b0a00000-0000-0000-0000-000000000001",
      botUserId: 123,
    };
    const ciphertext = encryptTelegramToken("my-token", aad);

    process.env[ENV_NAME] = randomBytes(32).toString("base64");
    expect(() => decryptTelegramToken(ciphertext, aad)).toThrow(
      "Telegram-Zugangsdaten",
    );
  });

  it("rejects ciphertext with modified authentication tag", () => {
    process.env[ENV_NAME] = randomBytes(32).toString("base64");
    const aad = {
      integrationId: "c0a00000-0000-0000-0000-000000000001",
      clientId: "b0a00000-0000-0000-0000-000000000001",
      botUserId: 123,
    };
    const ciphertext = encryptTelegramToken("my-token", aad);
    const parts = ciphertext.split(".");
    // Tamper with auth tag (third part)
    parts[2] = `A${parts[2]?.slice(1) ?? ""}`;
    const tampered = parts.join(".");

    expect(() => decryptTelegramToken(tampered, aad)).toThrow(
      "Telegram-Zugangsdaten",
    );
  });

  it("rejects ciphertext with wrong AAD (different integrationId)", () => {
    process.env[ENV_NAME] = randomBytes(32).toString("base64");
    const aad = {
      integrationId: "c0a00000-0000-0000-0000-000000000001",
      clientId: "b0a00000-0000-0000-0000-000000000001",
      botUserId: 123,
    };
    const ciphertext = encryptTelegramToken("my-token", aad);

    const wrongAad = { ...aad, integrationId: "c0a00000-0000-0000-0000-000000000002" };
    expect(() => decryptTelegramToken(ciphertext, wrongAad)).toThrow(
      "Telegram-Zugangsdaten",
    );
  });

  it("rejects ciphertext with wrong AAD (different clientId)", () => {
    process.env[ENV_NAME] = randomBytes(32).toString("base64");
    const aad = {
      integrationId: "c0a00000-0000-0000-0000-000000000001",
      clientId: "b0a00000-0000-0000-0000-000000000001",
      botUserId: 123,
    };
    const ciphertext = encryptTelegramToken("my-token", aad);

    const wrongAad = { ...aad, clientId: "b0a00000-0000-0000-0000-000000000002" };
    expect(() => decryptTelegramToken(ciphertext, wrongAad)).toThrow(
      "Telegram-Zugangsdaten",
    );
  });

  it("rejects ciphertext with wrong AAD (different botUserId)", () => {
    process.env[ENV_NAME] = randomBytes(32).toString("base64");
    const aad = {
      integrationId: "c0a00000-0000-0000-0000-000000000001",
      clientId: "b0a00000-0000-0000-0000-000000000001",
      botUserId: 123,
    };
    const ciphertext = encryptTelegramToken("my-token", aad);

    const wrongAad = { ...aad, botUserId: 456 };
    expect(() => decryptTelegramToken(ciphertext, wrongAad)).toThrow(
      "Telegram-Zugangsdaten",
    );
  });

  it("never exposes the token in error messages", () => {
    process.env[ENV_NAME] = randomBytes(32).toString("base64");
    const aad = {
      integrationId: "c0a00000-0000-0000-0000-000000000001",
      clientId: "b0a00000-0000-0000-0000-000000000001",
      botUserId: 123,
    };
    const token = "my-secret-bot-token";

    // Decryption failure shouldn't leak token
    const ciphertext = encryptTelegramToken(token, aad);
    process.env[ENV_NAME] = randomBytes(32).toString("base64");

    try {
      decryptTelegramToken(ciphertext, aad);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      expect(msg).not.toContain(token);
      expect(msg).not.toContain("my-secret-bot-token");
    }

    // Encryption key validation failure shouldn't leak token
    process.env[ENV_NAME] = "not-a-32-byte-key";
    try {
      encryptTelegramToken(token, aad);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      expect(msg).not.toContain(token);
    }
  });

  it("never exposes the token in the ciphertext", () => {
    process.env[ENV_NAME] = randomBytes(32).toString("base64");
    const token = "1234567890:AAECDefghIJKLMNOPQRSTUVWXYZabcdefg";
    const aad = {
      integrationId: "c0a00000-0000-0000-0000-000000000001",
      clientId: "b0a00000-0000-0000-0000-000000000001",
      botUserId: 123,
    };
    const ciphertext = encryptTelegramToken(token, aad);
    expect(ciphertext).not.toContain("1234567890");
    expect(ciphertext).not.toContain("AAEC");
  });

  it("rejects tampered IV", () => {
    process.env[ENV_NAME] = randomBytes(32).toString("base64");
    const aad = {
      integrationId: "c0a00000-0000-0000-0000-000000000001",
      clientId: "b0a00000-0000-0000-0000-000000000001",
      botUserId: 123,
    };
    const ciphertext = encryptTelegramToken("my-token", aad);
    const parts = ciphertext.split(".");
    parts[1] = `A${parts[1]?.slice(1) ?? ""}`;
    const tampered = parts.join(".");

    expect(() => decryptTelegramToken(tampered, aad)).toThrow(
      "Telegram-Zugangsdaten",
    );
  });

  it("fails on empty token", () => {
    process.env[ENV_NAME] = randomBytes(32).toString("base64");
    expect(() =>
      encryptTelegramToken("", {
        integrationId: "c0a00000-0000-0000-0000-000000000001",
        clientId: "b0a00000-0000-0000-0000-000000000001",
        botUserId: 1,
      }),
    ).toThrow("Telegram-Zugangsdaten");
  });

  it("produces different ciphertexts for the same token (random IV)", () => {
    process.env[ENV_NAME] = randomBytes(32).toString("base64");
    const aad = {
      integrationId: "c0a00000-0000-0000-0000-000000000001",
      clientId: "b0a00000-0000-0000-0000-000000000001",
      botUserId: 123,
    };
    const token = "1234567890:AAECDefghIJKLMNOPQRSTUVWXYZabcdefg";
    const c1 = encryptTelegramToken(token, aad);
    const c2 = encryptTelegramToken(token, aad);
    expect(c1).not.toBe(c2);
    // Both must decrypt to the same token
    expect(decryptTelegramToken(c1, aad)).toBe(token);
    expect(decryptTelegramToken(c2, aad)).toBe(token);
  });

  it("rejects malformed ciphertext with missing parts", () => {
    process.env[ENV_NAME] = randomBytes(32).toString("base64");
    const aad = {
      integrationId: "c0a00000-0000-0000-0000-000000000001",
      clientId: "b0a00000-0000-0000-0000-000000000001",
      botUserId: 123,
    };
    expect(() => decryptTelegramToken("v1.only.three", aad)).toThrow(
      "Telegram-Zugangsdaten",
    );
    expect(() => decryptTelegramToken("v1.a.b.c.d", aad)).toThrow(
      "Telegram-Zugangsdaten",
    );
  });
});
