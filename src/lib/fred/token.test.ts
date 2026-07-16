import { describe, expect, it } from "vitest";

import {
  FRED_TOKEN_VERSION,
  FRED_TOKEN_TTL_MS,
  FRED_MAX_QUERY_LENGTH,
  createFredSessionToken,
  parseFredSessionToken,
} from "./token";

const WEKNORA_API_KEY = "test-api-key-1234567890abcdef";
const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_ID = "session-12345";
const WRONG_USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("Fred session token", () => {
  it("returns an opaque HMAC-signed token for a valid session", () => {
    const token = createFredSessionToken({
      apiKey: WEKNORA_API_KEY,
      userId: USER_ID,
      weknoraSessionId: SESSION_ID,
    });

    expect(token).toBeTruthy();
    expect(token.startsWith("fred_")).toBe(true);
    // Token should be URL/body safe - no characters needing encoding
    expect(/^[A-Za-z0-9._~-]+$/.test(token)).toBe(true);
    // Token should be reasonably compact (under 512 chars)
    expect(token.length).toBeLessThan(512);
  });

  it("does not expose the user or WeKnora session id in the encoded payload", () => {
    const token = createFredSessionToken({
      apiKey: WEKNORA_API_KEY,
      userId: USER_ID,
      weknoraSessionId: SESSION_ID,
    });
    const encryptedPayload = token.slice("fred_".length).split(".")[0] ?? "";
    const decodedPayload = Buffer.from(encryptedPayload, "base64url").toString("utf8");

    expect(decodedPayload).not.toContain(USER_ID);
    expect(decodedPayload).not.toContain(SESSION_ID);
  });

  it("parses a valid token and returns the original session data", () => {
    const token = createFredSessionToken({
      apiKey: WEKNORA_API_KEY,
      userId: USER_ID,
      weknoraSessionId: SESSION_ID,
    });

    const parsed = parseFredSessionToken({
      apiKey: WEKNORA_API_KEY,
      token,
      expectedUserId: USER_ID,
    });

    expect(parsed).not.toBeNull();
    expect(parsed!.weknoraSessionId).toBe(SESSION_ID);
    expect(parsed!.userId).toBe(USER_ID);
    expect(parsed!.version).toBe(FRED_TOKEN_VERSION);
  });

  it("rejects a tampered token (modified signature)", () => {
    const token = createFredSessionToken({
      apiKey: WEKNORA_API_KEY,
      userId: USER_ID,
      weknoraSessionId: SESSION_ID,
    });

    // Flip a character in the token body (not the prefix)
    const tampered = token.slice(0, 10) + "Z" + token.slice(11);

    const parsed = parseFredSessionToken({
      apiKey: WEKNORA_API_KEY,
      token: tampered,
      expectedUserId: USER_ID,
    });

    expect(parsed).toBeNull();
  });

  it("rejects a token with wrong user id", () => {
    const token = createFredSessionToken({
      apiKey: WEKNORA_API_KEY,
      userId: USER_ID,
      weknoraSessionId: SESSION_ID,
    });

    const parsed = parseFredSessionToken({
      apiKey: WEKNORA_API_KEY,
      token,
      expectedUserId: WRONG_USER_ID,
    });

    expect(parsed).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = createFredSessionToken({
      apiKey: WEKNORA_API_KEY,
      userId: USER_ID,
      weknoraSessionId: SESSION_ID,
      now: 0, // epoch
    });

    const parsed = parseFredSessionToken({
      apiKey: WEKNORA_API_KEY,
      token,
      expectedUserId: USER_ID,
      now: FRED_TOKEN_TTL_MS + 1, // just past expiry
    });

    expect(parsed).toBeNull();
  });

  it("accepts a token that is not yet expired", () => {
    const token = createFredSessionToken({
      apiKey: WEKNORA_API_KEY,
      userId: USER_ID,
      weknoraSessionId: SESSION_ID,
      now: 1000,
    });

    const parsed = parseFredSessionToken({
      apiKey: WEKNORA_API_KEY,
      token,
      expectedUserId: USER_ID,
      now: 1000 + FRED_TOKEN_TTL_MS - 1, // just under TTL
    });

    expect(parsed).not.toBeNull();
    expect(parsed!.weknoraSessionId).toBe(SESSION_ID);
  });

  it("rejects a malformed token (wrong prefix)", () => {
    const parsed = parseFredSessionToken({
      apiKey: WEKNORA_API_KEY,
      token: "bad_prefix_abc123",
      expectedUserId: USER_ID,
    });

    expect(parsed).toBeNull();
  });

  it("rejects a token with different api key (domain separation)", () => {
    const token = createFredSessionToken({
      apiKey: "first-api-key",
      userId: USER_ID,
      weknoraSessionId: SESSION_ID,
    });

    const parsed = parseFredSessionToken({
      apiKey: "different-api-key",
      token,
      expectedUserId: USER_ID,
    });

    expect(parsed).toBeNull();
  });

  it("returns null for empty or missing token", () => {
    expect(
      parseFredSessionToken({
        apiKey: WEKNORA_API_KEY,
        token: "",
        expectedUserId: USER_ID,
      }),
    ).toBeNull();

    expect(
      parseFredSessionToken({
        apiKey: WEKNORA_API_KEY,
        token: "fred_",
        expectedUserId: USER_ID,
      }),
    ).toBeNull();
  });
});

describe("Fred query length limit", () => {
  it("exports a max query length constant", () => {
    expect(FRED_MAX_QUERY_LENGTH).toBeGreaterThan(0);
    expect(FRED_MAX_QUERY_LENGTH).toBeLessThanOrEqual(10000);
  });
});
