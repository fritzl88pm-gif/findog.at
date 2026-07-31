import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  generatePairingToken,
  generateWebhookSecret,
  hashToken,
  timingSafeDigestEqual,
} from "./pairing";

describe("generateWebhookSecret", () => {
  it("returns 32 random bytes as base64url", () => {
    const secret = generateWebhookSecret();
    const decoded = Buffer.from(secret, "base64url");
    expect(decoded.length).toBe(32);
  });

  it("produces different values each call", () => {
    const s1 = generateWebhookSecret();
    const s2 = generateWebhookSecret();
    expect(s1).not.toBe(s2);
  });
});

describe("generatePairingToken", () => {
  it("returns a base64url token of 32 random bytes", () => {
    const token = generatePairingToken();
    const decoded = Buffer.from(token, "base64url");
    expect(decoded.length).toBe(32);
  });

  it("when encoded, is at most 64 characters", () => {
    for (let i = 0; i < 20; i++) {
      const token = generatePairingToken();
      expect(token.length).toBeLessThanOrEqual(64);
    }
  });

  it("produces different values each call", () => {
    const t1 = generatePairingToken();
    const t2 = generatePairingToken();
    expect(t1).not.toBe(t2);
  });
});

describe("hashToken", () => {
  it("returns a SHA-256 hex digest (64 chars)", () => {
    const digest = hashToken("hello-world");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches the expected SHA-256 output for a known input", () => {
    const digest = hashToken("test-token");
    const expected = createHash("sha256").update("test-token").digest("hex");
    expect(digest).toBe(expected);
  });
});

describe("timingSafeDigestEqual", () => {
  it("returns true for identical digests", () => {
    const a = hashToken("secret");
    const b = hashToken("secret");
    expect(timingSafeDigestEqual(a, b)).toBe(true);
  });

  it("returns false for different digests", () => {
    const a = hashToken("secret-a");
    const b = hashToken("secret-b");
    expect(timingSafeDigestEqual(a, b)).toBe(false);
  });

  it("returns false when lengths differ", () => {
    const a = hashToken("a");
    const b = "short";
    expect(timingSafeDigestEqual(a, b)).toBe(false);
  });

  it("returns false for empty vs non-empty digest", () => {
    const a = hashToken("a");
    expect(timingSafeDigestEqual(a, "")).toBe(false);
    expect(timingSafeDigestEqual("", a)).toBe(false);
  });

  it("returns true for two empty strings", () => {
    expect(timingSafeDigestEqual("", "")).toBe(true);
  });

  it("returns false for non-hex input", () => {
    const a = hashToken("a");
    const b = "gg" + "00".repeat(31); // 'gg' is not valid hex
    expect(timingSafeDigestEqual(a, b)).toBe(false);
  });
});
