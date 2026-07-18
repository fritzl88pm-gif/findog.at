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

  function toolCallSuccess(): Response {
    return jsonRpcResponse({
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: "Treffer" }] },
    });
  }

  it("retries a transient 503 and then succeeds", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(toolCallSuccess());
    const result = await new McpClient().callTool({ token: "t", name: "hybrid_search", arguments: {} });
    expect(result).toBe("Treffer");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a network error and then succeeds", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(toolCallSuccess());
    const result = await new McpClient().callTool({ token: "t", name: "hybrid_search", arguments: {} });
    expect(result).toBe("Treffer");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry an authentication failure", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response("no", { status: 401 }));
    await expect(
      new McpClient().callTool({ token: "t", name: "hybrid_search", arguments: {} }),
    ).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after the maximum number of attempts on persistent 5xx", async () => {
    const fetchMock = vi.mocked(fetch);
    // A fresh Response per call: a body can only be read once.
    fetchMock.mockImplementation(() => Promise.resolve(new Response("down", { status: 502 })));
    await expect(
      new McpClient().callTool({ token: "t", name: "hybrid_search", arguments: {} }),
    ).rejects.toMatchObject({ status: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 10_000);
});
