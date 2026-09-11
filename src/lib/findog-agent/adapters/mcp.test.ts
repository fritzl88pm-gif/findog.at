import { describe, expect, it } from "vitest";

import {
  createFindogAgentMockTransport,
  findogAgentJsonResponse,
  type FindogAgentMockRoute,
  type FindogAgentRecordedRequest,
} from "../testing";
import {
  FINDOG_AGENT_MCP_PROTOCOL_VERSION,
  createFindogAgentMcpClient,
  parseFindogAgentMcpMessages,
} from "./mcp";

const SERVER = {
  id: "docs",
  name: "Docs",
  url: "https://mcp.example.com/mcp",
  allowedTools: ["search"],
  bearer: "mcp-bearer",
};

function rpc(request: FindogAgentRecordedRequest): string {
  return typeof request.json.method === "string" ? request.json.method : "";
}

function id(request: FindogAgentRecordedRequest): number {
  return typeof request.json.id === "number" ? request.json.id : -1;
}

function build(
  extra: FindogAgentMockRoute[] = [],
  options: { maxResultCharacters?: number; allowedTools?: string[] } = {},
) {
  const routes: FindogAgentMockRoute[] = [
    {
      name: "initialize",
      match: (request) => rpc(request) === "initialize",
      handle: (request) => findogAgentJsonResponse(
        200,
        { jsonrpc: "2.0", id: id(request), result: { protocolVersion: FINDOG_AGENT_MCP_PROTOCOL_VERSION } },
        { "mcp-session-id": "session-1" },
      ),
    },
    {
      name: "initialized",
      match: (request) => rpc(request) === "notifications/initialized",
      handle: () => ({ status: 202, headers: {}, body: "", truncated: false }),
    },
    {
      name: "list",
      match: (request) => rpc(request) === "tools/list",
      handle: (request) => {
        const cursor = request.json.params && (request.json.params as Record<string, unknown>).cursor;
        if (cursor === "page-2") {
          return findogAgentJsonResponse(200, {
            jsonrpc: "2.0",
            id: id(request),
            result: { tools: [{ name: "calc", description: "Rechnet", inputSchema: { type: "object" } }] },
          });
        }
        return findogAgentJsonResponse(200, {
          jsonrpc: "2.0",
          id: id(request),
          result: {
            nextCursor: "page-2",
            tools: [
              { name: "search", description: "Sucht", inputSchema: { type: "object", properties: { q: { type: "string" } } } },
              { name: "write", description: "Schreibt", inputSchema: { type: "object" } },
            ],
          },
        });
      },
    },
    ...extra,
  ];
  const http = createFindogAgentMockTransport(routes);
  const client = createFindogAgentMcpClient({
    server: {
      ...SERVER,
      allowedTools: options.allowedTools ?? SERVER.allowedTools,
    },
    transport: http.transport,
    timeoutMs: 5000,
    ...(options.maxResultCharacters ? { maxResultCharacters: options.maxResultCharacters } : {}),
  });
  return { client, http };
}

function callRoute(handler: (request: FindogAgentRecordedRequest) => unknown): FindogAgentMockRoute {
  return {
    name: "call",
    match: (request) => rpc(request) === "tools/call",
    handle: (request) => findogAgentJsonResponse(200, {
      jsonrpc: "2.0",
      id: id(request),
      result: handler(request),
    }),
  };
}

describe("findog agent mcp client", () => {
  it("initializes, paginates tools/list and carries session plus protocol headers", async () => {
    const { client, http } = build();
    const tools = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(["search", "write", "calc"]);
    expect(tools.map((tool) => tool.approved)).toEqual([true, false, false]);

    const listRequests = http.requests.filter((request) => rpc(request) === "tools/list");
    expect(listRequests).toHaveLength(2);
    expect(listRequests[0].headers["mcp-protocol-version"]).toBe(FINDOG_AGENT_MCP_PROTOCOL_VERSION);
    expect(listRequests[0].headers.authorization).toBe("Bearer mcp-bearer");
    expect(listRequests[1].headers["mcp-session-id"]).toBe("session-1");
    expect(listRequests[1].json.params).toEqual({ cursor: "page-2" });

    const initialize = http.requests.find((request) => rpc(request) === "initialize");
    expect(initialize?.json.params).toMatchObject({ protocolVersion: FINDOG_AGENT_MCP_PROTOCOL_VERSION });
    expect(http.requests.some((request) => rpc(request) === "notifications/initialized")).toBe(true);
  });

  it("refuses unapproved tools without any further network activity", async () => {
    const { client, http } = build([callRoute(() => ({ content: [] }))]);
    await client.listTools();
    const before = http.requests.length;
    await expect(client.callTool("write", {})).rejects.toMatchObject({ code: "tool_not_approved" });
    expect(http.requests.length).toBe(before);
  });

  it("preserves isError and the bounded structured content", async () => {
    const { client, http } = build([
      callRoute((request) => {
        const params = request.json.params as Record<string, unknown>;
        if (params.name === "search") {
          return {
            content: [{ type: "text", text: "Treffer" }],
            structuredContent: { rows: [{ value: 1 }, { value: 2 }], note: "x".repeat(50) },
            isError: false,
          };
        }
        return { content: [{ type: "text", text: "kaputt" }], isError: true };
      }),
    ], { allowedTools: ["search", "broken"] });

    const ok = await client.callTool("search", { q: "x" });
    expect(ok.isError).toBe(false);
    expect(ok.text).toBe("Treffer");
    expect(ok.structuredContent).toEqual({ rows: [{ value: 1 }, { value: 2 }], note: "x".repeat(50) });
    expect(ok.structuredTruncated).toBe(false);

    const error = await client.callTool("broken", {});
    expect(error.isError).toBe(true);
    expect(error.text).toBe("kaputt");
    expect(http.requests.filter((request) => rpc(request) === "tools/call")).toHaveLength(2);
  });

  it("marks oversized structured content as truncated", async () => {
    const { client } = build([
      callRoute(() => ({
        content: [{ type: "text", text: "x".repeat(500) }],
        structuredContent: { blob: "y".repeat(500) },
        isError: false,
      })),
    ], { maxResultCharacters: 40 });
    const result = await client.callTool("search", {});
    expect(result.structuredTruncated).toBe(true);
    expect(result.text.length).toBeLessThan(200);
  });

  it("rejects unknown tools and json-rpc errors explicitly", async () => {
    const { client } = build([{
      name: "call",
      match: (request) => rpc(request) === "tools/call",
      handle: (request) => findogAgentJsonResponse(200, {
        jsonrpc: "2.0",
        id: id(request),
        error: { code: -32601, message: "unknown tool" },
      }),
    }], { allowedTools: ["ghost"] });
    await expect(client.callTool("ghost", {})).rejects.toMatchObject({ code: "upstream_error" });

    const unauthorizedHttp = createFindogAgentMockTransport([{
      name: "unauthorized",
      match: () => true,
      handle: () => findogAgentJsonResponse(401, { error: "unauthorized" }),
    }]);
    const rejected = createFindogAgentMcpClient({
      server: SERVER,
      transport: unauthorizedHttp.transport,
      timeoutMs: 5000,
    });
    await expect(rejected.listTools()).rejects.toMatchObject({ code: "upstream_error", status: 401 });
  });

  it("parses SSE framed responses and JSON-RPC error frames", () => {
    const sse = [
      "event: message",
      'data: {"jsonrpc":"2.0","id":7,"result":{"tools":[]}}',
      "",
      "event: message",
      'data: {"jsonrpc":"2.0","id":8,"error":{"code":-32601,"message":"kein Werkzeug"}}',
      "",
    ].join("\n");
    const messages = parseFindogAgentMcpMessages(sse);
    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe(7);
    expect(messages[1].error?.message).toBe("kein Werkzeug");
    expect(parseFindogAgentMcpMessages("")).toEqual([]);
  });
});
