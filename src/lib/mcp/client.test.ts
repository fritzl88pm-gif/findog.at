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
});
