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

  it("preserves MCP structuredContent alongside the legacy text result", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonRpcResponse({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [{ type: "text", text: "Lesbarer Treffer" }],
        structuredContent: {
          hits: [{ kind: "norm", canonicalId: "ris:norm:123" }],
        },
        isError: false,
      },
    }));

    const result = await new McpClient().callToolDetailed({
      token: "mcp-token",
      name: "hybrid_search",
      arguments: { query: "§ 33 EStG" },
    });

    expect(result).toEqual({
      text: "Lesbarer Treffer",
      structuredContent: {
        hits: [{ kind: "norm", canonicalId: "ris:norm:123" }],
      },
      isError: false,
    });
  });

describe("McpClient transport retry", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries once after TypeError from fetch and succeeds on second attempt", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonRpcResponse({
        jsonrpc: "2.0",
        id: 1,
        result: {
          content: [{ type: "text", text: "Gerettet" }],
        },
      }));

    const result = await new McpClient().callToolDetailed({
      name: "hybrid_search",
      arguments: { query: "test" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.text).toBe("Gerettet");
  });

  it("does not retry when the signal is already aborted", async () => {
    const fetchMock = vi.mocked(fetch);
    const controller = new AbortController();
    controller.abort();
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonRpcResponse({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "Zu spät" }] },
      }));

    const deadline = createDeadline(60_000);
    // Abort the deadline signal
    // We need a deadline that is aborted, so use a custom signal
    await expect(new McpClient().callToolDetailed({
      name: "hybrid_search",
      arguments: { query: "test" },
      signal: controller.signal,
    })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    deadline.dispose();
  });

  it("does not retry for HTTP 5xx errors (not TypeError)", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response("Server Error", { status: 502 }));

    await expect(new McpClient().callToolDetailed({
      name: "hybrid_search",
      arguments: { query: "test" },
    })).rejects.toThrow("Datenbankfehler HTTP 502");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

});
