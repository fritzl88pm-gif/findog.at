/**
 * Minimal Streamable-HTTP MCP client (read-only by policy).
 *
 * Implements `initialize` / `notifications/initialized` / paginated
 * `tools/list` / `tools/call` with JSON-RPC id correlation, session and
 * protocol headers on follow-up calls, and both JSON and SSE response framing.
 * `isError` and the full bounded `structuredContent` are preserved.
 *
 * Authorization is the administrator's explicit `allowedTools` allowlist. MCP
 * annotations are hints only and never grant access; an unapproved or unknown
 * tool is refused before any network activity. V1 supports bearer tokens only
 * (no stdio transport, no OAuth flow).
 */

import { FindogAgentAdapterError } from "../errors";
import type { FindogAgentJsonSchema } from "../jsonschema";
import type { FindogAgentTransport, FindogAgentTransportResponse } from "../network";
import { boundFindogAgentText } from "../text";

export const FINDOG_AGENT_MCP_PROTOCOL_VERSION = "2025-06-18";
export const FINDOG_AGENT_MCP_CLIENT_NAME = "findog-agent-preview";

export type FindogAgentMcpServerEndpoint = {
  id: string;
  name: string;
  url: string;
  allowedTools: string[];
  bearer: string | null;
};

export type FindogAgentMcpToolDescriptor = {
  name: string;
  description: string;
  inputSchema: FindogAgentJsonSchema;
  /** True only when the administrator allowlisted the tool. */
  approved: boolean;
  /**
   * Server-declared `annotations.readOnlyHint`, surfaced for display only. A
   * hint is never authorization: only the explicit `allowedTools` allowlist
   * decides whether a tool may be called.
   */
  readOnlyHint: boolean | null;
};

export type FindogAgentMcpCallResult = {
  isError: boolean;
  text: string;
  structuredContent: unknown | null;
  structuredTruncated: boolean;
};

export type FindogAgentMcpClient = {
  server: FindogAgentMcpServerEndpoint;
  listTools(input?: { signal?: AbortSignal | null }): Promise<FindogAgentMcpToolDescriptor[]>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    input?: { signal?: AbortSignal | null },
  ): Promise<FindogAgentMcpCallResult>;
};

export type FindogAgentMcpClientOptions = {
  server: FindogAgentMcpServerEndpoint;
  transport: FindogAgentTransport;
  timeoutMs: number;
  maxResultCharacters?: number;
  protocolVersion?: string;
};

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string };
};

const DEFAULT_MAX_RESULT_CHARACTERS = 20000;
const MAX_PAGES = 10;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Extracts JSON-RPC messages from a Streamable HTTP response that may be either
 * a plain JSON body or an SSE stream.
 */
export function parseFindogAgentMcpMessages(body: string): JsonRpcMessage[] {
  const trimmed = body.trim();
  if (!trimmed) {
    return [];
  }

  const direct = (() => {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return undefined;
    }
  })();

  const fromPayload = (payload: unknown): JsonRpcMessage[] => {
    if (Array.isArray(payload)) {
      return payload as JsonRpcMessage[];
    }
    const record = asRecord(payload);
    return record ? [record as JsonRpcMessage] : [];
  };

  if (direct !== undefined) {
    return fromPayload(direct);
  }

  const messages: JsonRpcMessage[] = [];
  for (const block of trimmed.split(/\r?\n\r?\n/)) {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart());
    if (dataLines.length === 0) {
      continue;
    }
    try {
      messages.push(...fromPayload(JSON.parse(dataLines.join("\n"))));
    } catch {
      // Ignore keep-alive comments or partial frames; the caller sees a
      // missing response id as an invalid response instead.
    }
  }
  return messages;
}

function flattenToolContent(content: unknown, maxCharacters: number): {
  text: string;
  truncated: boolean;
} {
  if (!Array.isArray(content)) {
    return { text: "", truncated: false };
  }
  const parts: string[] = [];
  for (const entry of content) {
    const part = asRecord(entry);
    if (!part) {
      continue;
    }
    const type = asString(part.type);
    if (type === "text") {
      parts.push(asString(part.text) ?? "");
      continue;
    }
    parts.push(`[${type ?? "unbekannter Inhalt"}]`);
  }
  return boundFindogAgentText(parts.join("\n"), maxCharacters);
}

export function createFindogAgentMcpClient(
  options: FindogAgentMcpClientOptions,
): FindogAgentMcpClient {
  const protocolVersion = options.protocolVersion ?? FINDOG_AGENT_MCP_PROTOCOL_VERSION;
  const maxResultCharacters = options.maxResultCharacters ?? DEFAULT_MAX_RESULT_CHARACTERS;
  const approved = new Set(options.server.allowedTools);

  let sessionId: string | null = null;
  let sessionPromise: Promise<void> | null = null;
  let nextId = 1;

  function baseHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": protocolVersion,
    };
    if (options.server.bearer) {
      headers.authorization = `Bearer ${options.server.bearer}`;
    }
    if (sessionId) {
      headers["mcp-session-id"] = sessionId;
    }
    return headers;
  }

  async function post(
    payload: JsonRpcMessage,
    signal?: AbortSignal | null,
    expectResponse = true,
  ): Promise<JsonRpcMessage | null> {
    const response: FindogAgentTransportResponse = await options.transport.send({
      url: options.server.url,
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({ jsonrpc: "2.0", ...payload }),
      purpose: `mcp:${options.server.id}`,
      timeoutMs: options.timeoutMs,
      signal: signal ?? null,
    });

    const responseSession = response.headers["mcp-session-id"];
    if (responseSession) {
      sessionId = responseSession;
    }

    if (response.status === 401 || response.status === 403) {
      throw new FindogAgentAdapterError(
        "upstream_error",
        `Der MCP-Server "${options.server.name}" hat die Anmeldung abgelehnt.`,
        response.status,
      );
    }
    if (response.status < 200 || response.status >= 300) {
      throw new FindogAgentAdapterError(
        "upstream_error",
        `Der MCP-Server "${options.server.name}" hat mit Status ${response.status} geantwortet.`,
        response.status,
      );
    }
    if (!expectResponse && !response.body.trim()) {
      return null;
    }

    const messages = parseFindogAgentMcpMessages(response.body);
    if (messages.length === 0) {
      if (!expectResponse) {
        return null;
      }
      throw new FindogAgentAdapterError(
        "invalid_response",
        `Der MCP-Server "${options.server.name}" hat keine JSON-RPC-Antwort geliefert.`,
      );
    }

    const wanted = payload.id;
    const match = wanted === undefined
      ? messages[0]
      : messages.find((message) => message.id === wanted) ?? messages[0];
    if (match.error) {
      // Never forward the upstream JSON-RPC error message: an MCP server can
      // echo the bearer token or other sensitive diagnostics there. Only the
      // numeric code (a protocol field) is safe to surface.
      const errorCode = typeof match.error.code === "number" && Number.isFinite(match.error.code)
        ? Math.trunc(match.error.code)
        : null;
      throw new FindogAgentAdapterError(
        "upstream_error",
        errorCode === null
          ? `Der MCP-Server "${options.server.name}" hat einen Fehler gemeldet.`
          : `Der MCP-Server "${options.server.name}" hat einen Fehler gemeldet (Code ${errorCode}).`,
      );
    }
    return match;
  }

  async function ensureSession(signal?: AbortSignal | null): Promise<void> {
    if (sessionPromise) {
      return sessionPromise;
    }
    sessionPromise = (async () => {
      const initialize = await post({
        id: nextId++,
        method: "initialize",
        params: {
          protocolVersion,
          capabilities: {},
          clientInfo: { name: FINDOG_AGENT_MCP_CLIENT_NAME, version: "0.1.0" },
        },
      }, signal);
      const result = initialize ? asRecord(initialize.result) : null;
      const negotiated = result ? asString(result.protocolVersion) : null;
      if (!negotiated) {
        throw new FindogAgentAdapterError(
          "invalid_response",
          `Der MCP-Server "${options.server.name}" hat die Initialisierung nicht bestätigt.`,
        );
      }

      await post({ method: "notifications/initialized" }, signal, false);
    })();
    try {
      await sessionPromise;
    } catch (error) {
      sessionPromise = null;
      throw error;
    }
    return;
  }

  return {
    server: options.server,

    async listTools(input) {
      await ensureSession(input?.signal);
      const tools: FindogAgentMcpToolDescriptor[] = [];
      let cursor: string | null = null;

      for (let page = 0; page < MAX_PAGES; page += 1) {
        const message = await post({
          id: nextId++,
          method: "tools/list",
          params: cursor ? { cursor } : {},
        }, input?.signal);
        const result = message ? asRecord(message.result) : null;
        const entries = result && Array.isArray(result.tools) ? result.tools : [];
        for (const entry of entries) {
          const tool = asRecord(entry);
          const name = tool ? asString(tool.name) : null;
          if (!tool || !name) {
            continue;
          }
          tools.push({
            name,
            description: asString(tool.description) ?? "",
            inputSchema: (asRecord(tool.inputSchema) as FindogAgentJsonSchema | null) ?? {
              type: "object",
            },
            approved: approved.has(name),
            readOnlyHint: (() => {
              const annotations = asRecord(tool.annotations);
              return annotations && typeof annotations.readOnlyHint === "boolean"
                ? annotations.readOnlyHint
                : null;
            })(),
          });
        }
        const nextCursor = result ? asString(result.nextCursor) : null;
        if (!nextCursor) {
          break;
        }
        cursor = nextCursor;
      }

      return tools;
    },

    async callTool(name, args, input) {
      if (!approved.has(name)) {
        throw new FindogAgentAdapterError(
          "tool_not_approved",
          `Das MCP-Werkzeug "${name}" ist nicht freigegeben.`,
        );
      }
      await ensureSession(input?.signal);
      const message = await post({
        id: nextId++,
        method: "tools/call",
        params: { name, arguments: args },
      }, input?.signal);
      const result = message ? asRecord(message.result) : null;
      if (!result) {
        throw new FindogAgentAdapterError(
          "invalid_response",
          `Der MCP-Server "${options.server.name}" hat kein Ergebnis geliefert.`,
        );
      }

      const text = flattenToolContent(result.content, maxResultCharacters);
      const structured = result.structuredContent ?? null;
      const structuredText = structured === null ? "" : JSON.stringify(structured);
      const boundedStructured = boundFindogAgentText(structuredText, maxResultCharacters);

      return {
        isError: result.isError === true,
        text: text.truncated
          ? `${text.text}\n\n[Inhalt gekürzt]`
          : text.text,
        structuredContent: structured,
        structuredTruncated: structured !== null
          && (boundedStructured.truncated || structuredText.length > maxResultCharacters),
      };
    },
  };
}
