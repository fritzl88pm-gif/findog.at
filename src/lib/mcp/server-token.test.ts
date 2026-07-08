import { afterEach, describe, expect, it } from "vitest";

import { MAX_MCP_TOKEN_CHARS } from "../config";
import { UserVisibleError } from "../errors";
import { getServerMcpBearerToken } from "./server-token";

const originalBfgToken = process.env.BFG_MCP_BEARER_TOKEN;
const originalMcpToken = process.env.MCP_BEARER_TOKEN;

function resetEnv() {
  if (originalBfgToken === undefined) {
    delete process.env.BFG_MCP_BEARER_TOKEN;
  } else {
    process.env.BFG_MCP_BEARER_TOKEN = originalBfgToken;
  }

  if (originalMcpToken === undefined) {
    delete process.env.MCP_BEARER_TOKEN;
  } else {
    process.env.MCP_BEARER_TOKEN = originalMcpToken;
  }
}

describe("getServerMcpBearerToken", () => {
  afterEach(resetEnv);

  it("reads and trims the fixed BFG MCP bearer token from server environment", () => {
    process.env.BFG_MCP_BEARER_TOKEN = "  fixed-token  ";
    process.env.MCP_BEARER_TOKEN = "fallback-token";

    expect(getServerMcpBearerToken()).toBe("fixed-token");
  });

  it("falls back to MCP_BEARER_TOKEN", () => {
    process.env.BFG_MCP_BEARER_TOKEN = " ";
    process.env.MCP_BEARER_TOKEN = " fallback-token ";

    expect(getServerMcpBearerToken()).toBe("fallback-token");
  });

  it("raises a user-visible error when server-side BFG MCP configuration is missing", () => {
    delete process.env.BFG_MCP_BEARER_TOKEN;
    delete process.env.MCP_BEARER_TOKEN;

    expect(() => getServerMcpBearerToken()).toThrow(UserVisibleError);
    expect(() => getServerMcpBearerToken()).toThrow(
      "Serverseitige BFG MCP Konfiguration fehlt. Bitte Administrator kontaktieren.",
    );
  });

  it("validates the server-side token length", () => {
    process.env.BFG_MCP_BEARER_TOKEN = "x".repeat(MAX_MCP_TOKEN_CHARS + 1);

    expect(() => getServerMcpBearerToken()).toThrow("BFG MCP Bearer Token ist zu lang.");
  });
});
