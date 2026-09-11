import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  FINDOG_AGENT_CREDENTIALS_ENV,
  decryptFindogAgentSecret,
  encryptFindogAgentSecret,
} from "./credentials";
import { runFindogAgentConnectionTest } from "./discovery";
import {
  FINDOG_AGENT_TEST_CREDENTIALS,
  createFindogAgentMockTransport,
  findogAgentJsonResponse,
  findogAgentTestSettings,
  type FindogAgentMockRoute,
} from "./testing";
import type { FindogAgentSettingsSnapshot } from "./types";

const REVISION = 4;

function snapshot(overrides: Parameters<typeof findogAgentTestSettings>[0] = {}): FindogAgentSettingsSnapshot {
  return {
    revision: REVISION,
    updatedAt: "2026-09-10T20:00:00.000Z",
    settings: findogAgentTestSettings(overrides),
    encryptedCredentials: Object.fromEntries(
      Object.entries(FINDOG_AGENT_TEST_CREDENTIALS).map(([name, value]) => [
        name,
        encryptFindogAgentSecret(value),
      ]),
    ),
  };
}

function mcpRoutes(): FindogAgentMockRoute[] {
  return [
    {
      name: "mcp-initialize",
      match: (request) => request.json.method === "initialize",
      handle: () => findogAgentJsonResponse(
        200,
        { jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } },
        { "mcp-session-id": "session-1" },
      ),
    },
    {
      name: "mcp-initialized",
      match: (request) => request.json.method === "notifications/initialized",
      handle: () => ({
        status: 202,
        headers: { "content-type": "application/json" },
        body: "",
        truncated: false,
      }),
    },
    {
      name: "mcp-tools",
      match: (request) => request.json.method === "tools/list",
      handle: () => findogAgentJsonResponse(200, {
        jsonrpc: "2.0",
        id: 2,
        result: {
          tools: [
            {
              name: "read_document",
              description: "Liest ein Dokument.",
              inputSchema: { type: "object" },
              annotations: { readOnlyHint: true },
            },
            {
              name: "delete_document",
              description: "Löscht ein Dokument.",
              inputSchema: { type: "object" },
            },
          ],
        },
      }),
    },
  ];
}

describe("findog agent connection tests / discovery", () => {
  beforeEach(() => {
    process.env[FINDOG_AGENT_CREDENTIALS_ENV] = Buffer.alloc(32, 5).toString("base64");
  });

  afterEach(() => {
    delete process.env[FINDOG_AGENT_CREDENTIALS_ENV];
  });

  it("tests a configured model with a fixed small prompt and no retries", async () => {
    const http = createFindogAgentMockTransport([{
      name: "model",
      match: (request) => request.url.endsWith("/chat/completions"),
      handle: () => findogAgentJsonResponse(200, {
        id: "chatcmpl-test",
        choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 12, completion_tokens: 1, total_tokens: 13 },
      }),
    }]);

    const result = await runFindogAgentConnectionTest({
      snapshot: snapshot(),
      kind: "model",
      id: "flash",
      deps: { transport: http.transport, decryptSecret: decryptFindogAgentSecret },
    });

    expect(result.ok).toBe(true);
    expect(result.kind).toBe("model");
    expect(http.requests).toHaveLength(1);
    const request = http.requests[0];
    expect(request.url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(request.headers.authorization).toBe(`Bearer ${FINDOG_AGENT_TEST_CREDENTIALS["connection:primary:apiKey"]}`);
    expect(request.json.max_tokens).toBe(64);
    // No tools are advertised, so the test model cannot call a tool.
    expect(request.json.tools).toBeUndefined();
    expect(request.json.tool_choice).toBeUndefined();
    expect(http.requests).toHaveLength(1);
    expect(result.detail).toMatchObject({ finishReason: "stop", answered: true });
  });

  it("does not report success for an empty model response", async () => {
    const http = createFindogAgentMockTransport([{
      name: "model",
      match: (request) => request.url.endsWith("/chat/completions"),
      handle: () => findogAgentJsonResponse(200, {
        choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 12, completion_tokens: 0, total_tokens: 12 },
      }),
    }]);

    const result = await runFindogAgentConnectionTest({
      snapshot: snapshot(),
      kind: "model",
      id: "flash",
      deps: { transport: http.transport, decryptSecret: decryptFindogAgentSecret },
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe("empty_output");
    expect(result.detail).toMatchObject({ answered: false, finishReason: "stop" });
  });

  it("reports a truncated thinking model test instead of a fake success", async () => {
    const http = createFindogAgentMockTransport([{
      name: "model",
      match: (request) => request.url.endsWith("/chat/completions"),
      handle: () => findogAgentJsonResponse(200, {
        choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "length" }],
        usage: { prompt_tokens: 10, completion_tokens: 64, total_tokens: 74 },
      }),
    }]);

    const result = await runFindogAgentConnectionTest({
      snapshot: snapshot(),
      kind: "model",
      id: "flash",
      deps: { transport: http.transport, decryptSecret: decryptFindogAgentSecret },
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe("incomplete_output");
    // Diagnostic usage/finish reason is preserved for the administrator.
    expect(result.detail).toMatchObject({
      answered: false,
      finishReason: "length",
      promptTokens: 10,
      completionTokens: 64,
    });
  });

  it("never serializes a leaked secret from a provider error", async () => {
    const secret = "sk-provider-secret";
    const http = createFindogAgentMockTransport([{
      name: "model",
      match: (request) => request.url.endsWith("/chat/completions"),
      handle: () => findogAgentJsonResponse(401, { error: `bad key ${secret}` }),
    }]);

    const result = await runFindogAgentConnectionTest({
      snapshot: snapshot(),
      kind: "model",
      id: "flash",
      deps: { transport: http.transport, decryptSecret: decryptFindogAgentSecret },
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe("model_http_error");
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("lists WeKnora knowledge bases from the configured scope", async () => {
    const http = createFindogAgentMockTransport([{
      name: "weknora",
      match: (request) => request.url.endsWith("/api/v1/knowledge-bases"),
      handle: () => findogAgentJsonResponse(200, {
        success: true,
        data: [
          { id: "kb-1", name: "Vereinsrecht" },
          { id: "kb-2", name: "Andere" },
        ],
      }),
    }]);

    const result = await runFindogAgentConnectionTest({
      snapshot: snapshot({
        knowledge: { enabled: true, baseUrl: "https://weknora.example.com/api/v1", knowledgeBaseIds: ["kb-1"] },
      }),
      kind: "weknora",
      id: null,
      deps: { transport: http.transport, decryptSecret: decryptFindogAgentSecret },
    });

    expect(result.ok).toBe(true);
    expect(result.detail).toMatchObject({
      total: 2,
      knowledgeBases: [
        { id: "kb-1", name: "Vereinsrecht", configured: true },
        { id: "kb-2", name: "Andere", configured: false },
      ],
    });
    expect(http.requests[0].url).toBe("https://weknora.example.com/api/v1/knowledge-bases");
  });

  it("runs exactly one bounded Exa query and keeps the fixed origin", async () => {
    const http = createFindogAgentMockTransport([{
      name: "exa",
      match: (request) => request.url.startsWith("https://api.exa.ai/search"),
      handle: () => findogAgentJsonResponse(200, {
        costDollars: 0.005,
        results: [{ id: "w1", title: "T", url: "https://example.com/a", text: "Inhalt" }],
      }),
    }]);

    const result = await runFindogAgentConnectionTest({
      snapshot: snapshot({ web: { mode: "auto" } }),
      kind: "exa",
      id: null,
      deps: { transport: http.transport, decryptSecret: decryptFindogAgentSecret },
    });

    expect(result.ok).toBe(true);
    expect(http.requests).toHaveLength(1);
    expect(http.requests[0].url).toBe("https://api.exa.ai/search");
    expect(result.detail).toMatchObject({ hits: 1, estimatedCostUsd: 0.005 });
  });

  it("discovers MCP tools and reports the read-only hint as display data only", async () => {
    const http = createFindogAgentMockTransport(mcpRoutes());

    const result = await runFindogAgentConnectionTest({
      snapshot: snapshot({
        mcp: {
          servers: [{
            id: "docs",
            name: "Docs",
            url: "https://mcp.example.com/mcp",
            allowedTools: ["read_document"],
          }],
        },
      }),
      kind: "mcp",
      id: "docs",
      deps: { transport: http.transport, decryptSecret: decryptFindogAgentSecret },
    });

    expect(result.ok).toBe(true);
    expect(result.detail).toMatchObject({
      total: 2,
      tools: [
        { name: "read_document", approved: true, readOnlyHint: true },
        { name: "delete_document", approved: false, readOnlyHint: null },
      ],
    });
    // initialize -> initialized notification -> tools/list
    expect(http.requests).toHaveLength(3);
  });

  it("authenticates MCP discovery before any tool is allowlisted", async () => {
    const bearer = FINDOG_AGENT_TEST_CREDENTIALS["mcp:docs:bearer"];
    const http = createFindogAgentMockTransport([{
      name: "mcp",
      match: () => true,
      handle: (request) => {
        if (request.headers.authorization !== `Bearer ${bearer}`) {
          return findogAgentJsonResponse(401, { error: "missing auth" });
        }
        if (request.json.method === "initialize") {
          return findogAgentJsonResponse(200, {
            jsonrpc: "2.0",
            id: request.json.id,
            result: { protocolVersion: "2025-06-18" },
          });
        }
        if (request.json.method === "notifications/initialized") {
          return { status: 202, headers: {}, body: "", truncated: false };
        }
        return findogAgentJsonResponse(200, {
          jsonrpc: "2.0",
          id: request.json.id,
          result: { tools: [{ name: "read_document", inputSchema: { type: "object" } }] },
        });
      },
    }]);

    const result = await runFindogAgentConnectionTest({
      snapshot: snapshot({
        mcp: {
          servers: [{
            id: "docs",
            name: "Docs",
            url: "https://mcp.example.com/mcp",
            allowedTools: [],
          }],
        },
      }),
      kind: "mcp",
      id: "docs",
      deps: { transport: http.transport, decryptSecret: decryptFindogAgentSecret },
    });

    expect(result.ok).toBe(true);
    // initialize -> initialized notification -> tools/list, all authenticated.
    expect(http.requests).toHaveLength(3);
    expect(http.requests.every((request) => request.headers.authorization === `Bearer ${bearer}`))
      .toBe(true);
    // Discovery never approves anything by itself.
    expect(result.detail).toMatchObject({
      total: 1,
      tools: [{ name: "read_document", approved: false }],
    });
    expect(JSON.stringify(result)).not.toContain(bearer);
  });

  it("refuses an unknown entry instead of guessing a destination", async () => {
    const http = createFindogAgentMockTransport([]);
    const result = await runFindogAgentConnectionTest({
      snapshot: snapshot(),
      kind: "model",
      id: "ghost",
      deps: { transport: http.transport, decryptSecret: decryptFindogAgentSecret },
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("invalid_request");
    expect(http.requests).toHaveLength(0);
  });

  it("reports a missing credential without any network call", async () => {
    const http = createFindogAgentMockTransport([]);
    const withoutSecrets = { ...snapshot(), encryptedCredentials: {} };
    const result = await runFindogAgentConnectionTest({
      snapshot: withoutSecrets,
      kind: "exa",
      id: null,
      deps: { transport: http.transport, decryptSecret: decryptFindogAgentSecret },
    });
    expect(result).toMatchObject({ ok: false, code: "credentials_missing" });
    expect(http.requests).toHaveLength(0);
  });
});
