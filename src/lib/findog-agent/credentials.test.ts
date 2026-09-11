import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  FINDOG_AGENT_CREDENTIALS_ENV,
  applyFindogAgentSecretPatch,
  decryptFindogAgentSecret,
  decryptFindogAgentSecretMap,
  encryptFindogAgentSecret,
  parseFindogAgentCredentialsKey,
} from "./credentials";

const VALID_KEY = Buffer.alloc(32, 7).toString("base64");

describe("findog agent credentials", () => {
  beforeEach(() => {
    process.env[FINDOG_AGENT_CREDENTIALS_ENV] = VALID_KEY;
  });

  afterEach(() => {
    delete process.env[FINDOG_AGENT_CREDENTIALS_ENV];
  });

  it("round-trips a secret without exposing the plaintext", () => {
    const ciphertext = encryptFindogAgentSecret("sk-live-secret");
    expect(ciphertext).not.toContain("sk-live-secret");
    expect(ciphertext.startsWith("v1.")).toBe(true);
    expect(decryptFindogAgentSecret(ciphertext)).toBe("sk-live-secret");
  });

  it("uses a fresh nonce for every encryption", () => {
    expect(encryptFindogAgentSecret("same")).not.toBe(encryptFindogAgentSecret("same"));
  });

  it("rejects tampered ciphertext", () => {
    const ciphertext = encryptFindogAgentSecret("sk-live-secret");
    const parts = ciphertext.split(".");
    const tampered = [parts[0], parts[1], parts[2], Buffer.from("tampered").toString("base64url")].join(".");
    expect(() => decryptFindogAgentSecret(tampered)).toThrowError(/nicht verfügbar/);
    expect(() => decryptFindogAgentSecret(ciphertext.replace("v1.", "v2."))).toThrowError(/nicht verfügbar/);
    expect(() => decryptFindogAgentSecret("not-a-ciphertext")).toThrowError(/nicht verfügbar/);
  });

  it("refuses to work without a valid runtime key", () => {
    delete process.env[FINDOG_AGENT_CREDENTIALS_ENV];
    expect(() => encryptFindogAgentSecret("x")).toThrowError(/nicht verfügbar/);
    process.env[FINDOG_AGENT_CREDENTIALS_ENV] = "too-short";
    expect(() => encryptFindogAgentSecret("x")).toThrowError(/nicht verfügbar/);
    process.env[FINDOG_AGENT_CREDENTIALS_ENV] = Buffer.alloc(16, 1).toString("base64");
    expect(() => encryptFindogAgentSecret("x")).toThrowError(/nicht verfügbar/);
  });

  it("validates the runtime key through one shared boundary without exposing it", () => {
    expect(parseFindogAgentCredentialsKey(VALID_KEY).length).toBe(32);
    const rejected: Array<string | null | undefined> = [
      undefined,
      null,
      "",
      "not-a-key",
      Buffer.alloc(16, 1).toString("base64"),
    ];
    for (const value of rejected) {
      let message = "";
      try {
        parseFindogAgentCredentialsKey(value);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/nicht verfügbar/);
      if (value) {
        expect(message).not.toContain(value);
      }
    }
  });

  it("preserves omitted secrets, removes nulled secrets and rejects blank strings", () => {
    const existing = { "connection:primary:apiKey": encryptFindogAgentSecret("old") };
    const allowed = ["connection:primary:apiKey", "web:exaApiKey"];

    const preserved = applyFindogAgentSecretPatch(existing, allowed, {});
    expect(Object.keys(preserved)).toEqual(["connection:primary:apiKey"]);
    expect(decryptFindogAgentSecret(preserved["connection:primary:apiKey"])).toBe("old");

    const added = applyFindogAgentSecretPatch(existing, allowed, { "web:exaApiKey": "exa-1" });
    expect(decryptFindogAgentSecret(added["web:exaApiKey"])).toBe("exa-1");
    expect(decryptFindogAgentSecret(added["connection:primary:apiKey"])).toBe("old");

    const removed = applyFindogAgentSecretPatch(existing, allowed, { "connection:primary:apiKey": null });
    expect(removed).toEqual({});

    expect(() => applyFindogAgentSecretPatch(existing, allowed, { "connection:primary:apiKey": "" }))
      .toThrowError(/darf nicht leer sein/);
    expect(() => applyFindogAgentSecretPatch(existing, allowed, { "connection:primary:apiKey": "   " }))
      .toThrowError(/darf nicht leer sein/);
    expect(() => applyFindogAgentSecretPatch(existing, allowed, { "connection:other:apiKey": "x" }))
      .toThrowError(/unbekannt/);
    expect(() => applyFindogAgentSecretPatch(existing, allowed, { "connection:primary:apiKey": 5 as never }))
      .toThrowError(/ungültig/);
  });

  it("decrypts a stored secret map for the worker only", () => {
    const stored = {
      "connection:primary:apiKey": encryptFindogAgentSecret("sk-1"),
      "web:exaApiKey": encryptFindogAgentSecret("exa-2"),
    };
    expect(decryptFindogAgentSecretMap(stored)).toEqual({
      "connection:primary:apiKey": "sk-1",
      "web:exaApiKey": "exa-2",
    });
    expect(decryptFindogAgentSecretMap(null)).toEqual({});
  });
});
