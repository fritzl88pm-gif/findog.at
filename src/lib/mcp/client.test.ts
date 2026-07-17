import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDeadline } from "../deadline";
import { MCP_HTTP_TIMEOUT_MS } from "./client";
import { McpClient } from "./client";

function jsonRpcResponse(body: unknown, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}


describe("MCP timeout constants", () => {
  it("MCP_HTTP_TIMEOUT_MS is 60_000", () => {
    expect(MCP_HTTP_TIMEOUT_MS).toBe(60_000);
  });
});

describe("McpClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes bounded abort signals to MCP HTTP calls", async () => {
    const deadline = createDeadline(240_000);
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        jsonRpcResponse(
          {
            jsonrpc: "2.0",
            id: 1,
            result: {},
          },
          { "Mcp-Session-Id": "session-1" },
        ),
      )
      .mockResolvedValueOnce(new Response("", { status: 202 }))
      .mockResolvedValueOnce(
        jsonRpcResponse(
          {
            jsonrpc: "2.0",
            id: 2,
            result: {
              tools: [
                {
                  name: "hybrid_search",
                  description: "Search",
                  inputSchema: { type: "object" },
                },
              ],
            },
          },
          { "Mcp-Session-Id": "session-1" },
        ),
      );

    const session = await new McpClient().openToolSession("mcp-token", { deadline });
    expect(session).toMatchObject({
      sessionId: "session-1",
      tools: [{ name: "hybrid_search" }],
    });
    expect(session).not.toHaveProperty("deepSeekTools");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      expect(call[1]?.signal).toBeInstanceOf(AbortSignal);
    }
    deadline.dispose();
  });

  it.each([
    [400, 400],
    [403, 403],
    [408, 504],
    [429, 429],
    [500, 502],
    [502, 502],
    [503, 503],
    [504, 504],
  ] as const)("preserves the retry semantics of MCP HTTP %i", async (upstreamStatus, exposedStatus) => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("upstream error", { status: upstreamStatus }));

    await expect(new McpClient().callTool({
      token: "mcp-token",
      name: "hybrid_search",
      arguments: { query: "Test" },
    })).rejects.toMatchObject({ status: exposedStatus });
  });
});
