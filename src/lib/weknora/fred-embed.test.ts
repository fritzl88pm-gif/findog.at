import { describe, expect, it, vi } from "vitest";

import {
  FRED_EMBED_ORIGIN,
  FredEmbedConfigurationError,
  mintFredEmbedSession,
  readFredEmbedServerConfig,
  readFredProModelId,
  readQuickFredEmbedServerConfig,
} from "./fred-embed";

const VALID_ENVIRONMENT = {
  WEKNORA_FRED_CHANNEL_ID: "fred-channel-2026",
  WEKNORA_FRED_PUBLISH_TOKEN: "em_publish_token_fixture_123456",
  WEKNORA_FRED_EXCHANGE_ORIGIN: "https://findog.at",
};

function upstreamSession(overrides: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    success: true,
    data: {
      session_token: "ems_session_token_fixture_123456",
      expires_in: 1_800,
      ...overrides,
    },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Fred WeKnora Secure Embed", () => {
  it("accepts only server-side channel, em publish token and an exact HTTPS origin", () => {
    expect(readFredEmbedServerConfig(VALID_ENVIRONMENT)).toEqual({
      agentKey: "fred",
      channelId: "fred-channel-2026",
      publishToken: "em_publish_token_fixture_123456",
      exchangeOrigin: "https://findog.at",
    });
  });

  it("accepts a complete server-only QuickFred channel and expected agent UUID", () => {
    expect(readQuickFredEmbedServerConfig({
      ...VALID_ENVIRONMENT,
      WEKNORA_QUICKFRED_CHANNEL_ID: "quickfred-channel-2026",
      WEKNORA_QUICKFRED_PUBLISH_TOKEN: "em_quickfred_publish_fixture_123456",
      WEKNORA_QUICKFRED_EXCHANGE_ORIGIN: "https://findog.at",
      WEKNORA_QUICKFRED_AGENT_ID: "a1b2c3d4-e5f6-4789-abcd-ef0123456789",
    })).toEqual({
      agentKey: "quickfred",
      channelId: "quickfred-channel-2026",
      publishToken: "em_quickfred_publish_fixture_123456",
      exchangeOrigin: "https://findog.at",
      expectedAgentId: "a1b2c3d4-e5f6-4789-abcd-ef0123456789",
    });
  });

  it.each([
    ["missing channel", { WEKNORA_QUICKFRED_CHANNEL_ID: "" }],
    ["wrong token", { WEKNORA_QUICKFRED_PUBLISH_TOKEN: "sk-not-an-embed-token" }],
    ["unsafe origin", { WEKNORA_QUICKFRED_EXCHANGE_ORIGIN: "http://findog.at" }],
    ["missing agent", { WEKNORA_QUICKFRED_AGENT_ID: "" }],
    ["non-UUID agent", { WEKNORA_QUICKFRED_AGENT_ID: "quickfred" }],
  ])("rejects incomplete QuickFred configuration: %s", (_label, override) => {
    expect(() => readQuickFredEmbedServerConfig({
      ...VALID_ENVIRONMENT,
      WEKNORA_QUICKFRED_CHANNEL_ID: "quickfred-channel-2026",
      WEKNORA_QUICKFRED_PUBLISH_TOKEN: "em_quickfred_publish_fixture_123456",
      WEKNORA_QUICKFRED_EXCHANGE_ORIGIN: "https://findog.at",
      WEKNORA_QUICKFRED_AGENT_ID: "a1b2c3d4-e5f6-4789-abcd-ef0123456789",
      ...override,
    })).toThrow(FredEmbedConfigurationError);
  });

  it.each([
    ["missing channel", { ...VALID_ENVIRONMENT, WEKNORA_FRED_CHANNEL_ID: "" }],
    ["path-like channel", { ...VALID_ENVIRONMENT, WEKNORA_FRED_CHANNEL_ID: "../fred" }],
    ["account API key", { ...VALID_ENVIRONMENT, WEKNORA_FRED_PUBLISH_TOKEN: "sk-account-key-is-not-a-publish-token" }],
    ["session token", { ...VALID_ENVIRONMENT, WEKNORA_FRED_PUBLISH_TOKEN: "ems_session_token_fixture_123456" }],
    ["origin path", { ...VALID_ENVIRONMENT, WEKNORA_FRED_EXCHANGE_ORIGIN: "https://findog.at/fred" }],
    ["insecure remote origin", { ...VALID_ENVIRONMENT, WEKNORA_FRED_EXCHANGE_ORIGIN: "http://findog.at" }],
  ])("rejects unsafe or incomplete configuration: %s", (_label, environment) => {
    expect(() => readFredEmbedServerConfig(environment)).toThrow(FredEmbedConfigurationError);
  });

  it("exchanges the publish token only in the upstream Authorization header", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => upstreamSession());

    const result = await mintFredEmbedSession({
      environment: VALID_ENVIRONMENT,
      fetchImpl,
    });

    expect(result).toEqual({
      token: "ems_session_token_fixture_123456",
      expiresIn: 1_800,
      channelId: "fred-channel-2026",
      embedOrigin: FRED_EMBED_ORIGIN,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://taxdog.cloud/api/v1/embed/fred-channel-2026/exchange");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Embed em_publish_token_fixture_123456");
    expect(headers.get("origin")).toBe("https://findog.at");
    expect(headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/u);
    expect(init?.cache).toBe("no-store");
  });

  it.each([
    ["wrong token class", { session_token: "em_long_lived_publish_token_123", expires_in: 1_800 }],
    ["missing expiry", { session_token: "ems_session_token_fixture_123456", expires_in: undefined }],
    ["excessive expiry", { session_token: "ems_session_token_fixture_123456", expires_in: 86_400 }],
  ])("rejects an invalid session response: %s", async (_label, data) => {
    await expect(mintFredEmbedSession({
      environment: VALID_ENVIRONMENT,
      fetchImpl: vi.fn(async () => upstreamSession(data)),
    })).rejects.toMatchObject({
      name: "FredEmbedUpstreamError",
      kind: "invalid_response",
    });
  });

  it("maps upstream authorization and rate-limit failures without response details", async () => {
    await expect(mintFredEmbedSession({
      environment: VALID_ENVIRONMENT,
      fetchImpl: vi.fn(async () => new Response("private token diagnostic", { status: 403 })),
    })).rejects.toMatchObject({ kind: "rejected" });

    await expect(mintFredEmbedSession({
      environment: VALID_ENVIRONMENT,
      fetchImpl: vi.fn(async () => new Response("private rate-limit diagnostic", { status: 429 })),
    })).rejects.toMatchObject({
      kind: "rate_limited",
      message: expect.not.stringContaining("private"),
    });
  });

  it("rejects an oversized successful exchange response before parsing it", async () => {
    await expect(mintFredEmbedSession({
      environment: VALID_ENVIRONMENT,
      fetchImpl: vi.fn(async () => new Response("x", {
        status: 200,
        headers: { "Content-Length": String(64 * 1_024 + 1) },
      })),
    })).rejects.toMatchObject({
      name: "FredEmbedUpstreamError",
      kind: "invalid_response",
    });
  });

  describe("readFredProModelId", () => {
    const VALID_UUID = "a1b2c3d4-e5f6-4789-abcd-ef0123456789";

    it("accepts a valid canonical UUID as the Pro model ID", () => {
      expect(readFredProModelId({ WEKNORA_FRED_PRO_MODEL_ID: VALID_UUID })).toBe(VALID_UUID);
    });

    it.each([
      ["missing variable", {}],
      ["blank", { WEKNORA_FRED_PRO_MODEL_ID: "" }],
      ["whitespace-only", { WEKNORA_FRED_PRO_MODEL_ID: "  " }],
      ["path-like value", { WEKNORA_FRED_PRO_MODEL_ID: "../model" }],
      ["URL-like value", { WEKNORA_FRED_PRO_MODEL_ID: "https://model" }],
      ["short model name", { WEKNORA_FRED_PRO_MODEL_ID: "deepseek-v4" }],
      ["arbitrary label", { WEKNORA_FRED_PRO_MODEL_ID: "deepseek-chat" }],
      ["malformed UUID", { WEKNORA_FRED_PRO_MODEL_ID: "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz" }],
    ])("rejects an invalid or absent Pro model ID: %s", (_label, environment) => {
      expect(() => readFredProModelId(environment)).toThrow(FredEmbedConfigurationError);
    });
  });
});
