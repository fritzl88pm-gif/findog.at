import { BFG_MCP_ENDPOINT, MCP_PROTOCOL_VERSION } from "./config";
import { type Deadline, runWithTimeout } from "../deadline";
import { MissingMcpBearerTokenError, UserVisibleError } from "../errors";
import { extractJsonPayloads } from "./parser";
import type { JsonObject, McpTool } from "./tools";

export const MCP_HTTP_TIMEOUT_MS = 60_000;

type McpHttpResult = {
  payloads: JsonObject[];
  sessionId?: string;
};

type McpSession = {
  sessionId?: string;
  tools: McpTool[];
};

export type McpToolResult = {
  text: string;
  structuredContent?: JsonObject;
  isError: boolean;
};

type JsonRpcError = {
  code?: number;
  message?: string;
};

function getJsonRpcError(payloads: JsonObject[]): JsonRpcError | null {
  for (const payload of payloads) {
    const error = payload.error;
    if (error && typeof error === "object" && !Array.isArray(error)) {
      return error as JsonRpcError;
    }
  }
  return null;
}

function resultObject(payloads: JsonObject[], fallbackMessage: string): JsonObject {
  const withResult = payloads.findLast(
    (payload) => payload.result && typeof payload.result === "object" && !Array.isArray(payload.result),
  );
  if (!withResult) {
    throw new UserVisibleError(fallbackMessage, 502);
  }
  return withResult.result as JsonObject;
}

function parseTools(payloads: JsonObject[]): McpTool[] {
  const result = resultObject(payloads, "Datenbankantwort ist unvollständig.");
  if (!Array.isArray(result.tools)) {
    return [];
  }

  return result.tools.flatMap((tool): McpTool[] => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
      return [];
    }
    const item = tool as JsonObject;
    const name = typeof item.name === "string" ? item.name : "";
    if (!name) {
      return [];
    }
    const inputSchema =
      item.inputSchema && typeof item.inputSchema === "object" && !Array.isArray(item.inputSchema)
        ? (item.inputSchema as JsonObject)
        : undefined;
    return [
      {
        name,
        description: typeof item.description === "string" ? item.description : "",
        inputSchema,
      },
    ];
  });
}

function parseToolContent(payloads: JsonObject[]): McpToolResult {
  const result = resultObject(payloads, "Datenbankantwort ist unvollständig.");
  const parts: string[] = [];

  if (Array.isArray(result.content)) {
    for (const item of result.content) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }
      const content = item as JsonObject;
      if (content.type === "text" && typeof content.text === "string") {
        parts.push(content.text);
      } else {
        parts.push(JSON.stringify(content));
      }
    }
  }

  const text = parts.filter(Boolean).join("\n\n") || JSON.stringify(result);
  const isError = result.isError === true;
  const structuredContent = result.structuredContent
    && typeof result.structuredContent === "object"
    && !Array.isArray(result.structuredContent)
    ? result.structuredContent as JsonObject
    : undefined;
  return {
    text: isError ? `Datenbankfehler: ${text}` : text,
    ...(structuredContent ? { structuredContent } : {}),
    isError,
  };
}

export class McpClient {
  private nextId = 1;

  async openToolSession(
    token?: string,
    options: { deadline?: Deadline; signal?: AbortSignal } = {},
  ): Promise<McpSession> {
    const initialize = await this.postJson({
      payload: {
        jsonrpc: "2.0",
        id: this.nextId++,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: {
            name: "findog.at",
            version: "0.1.0",
          },
        },
      },
      token,
      deadline: options.deadline,
      signal: options.signal,
      allowEmptyResponse: false,
    });

    await this.postJson({
      payload: {
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      },
      token,
      sessionId: initialize.sessionId,
      deadline: options.deadline,
      signal: options.signal,
      allowEmptyResponse: true,
    }).catch(() => undefined);

    const toolsResult = await this.postJson({
      payload: {
        jsonrpc: "2.0",
        id: this.nextId++,
        method: "tools/list",
        params: {},
      },
      token,
      sessionId: initialize.sessionId,
      deadline: options.deadline,
      signal: options.signal,
      allowEmptyResponse: false,
    });

    const sessionId = toolsResult.sessionId ?? initialize.sessionId;
    const tools = parseTools(toolsResult.payloads);

    return {
      sessionId,
      tools,
    };
  }

  async callTool(options: {
    token?: string;
    sessionId?: string;
    name: string;
    arguments: JsonObject;
    deadline?: Deadline;
    signal?: AbortSignal;
  }): Promise<string> {
    return (await this.callToolDetailed(options)).text;
  }

  async callToolDetailed(options: {
    token?: string;
    sessionId?: string;
    name: string;
    arguments: JsonObject;
    deadline?: Deadline;
    signal?: AbortSignal;
  }): Promise<McpToolResult> {
    const result = await this.postJson({
      payload: {
        jsonrpc: "2.0",
        id: this.nextId++,
        method: "tools/call",
        params: {
          name: options.name,
          arguments: options.arguments,
        },
      },
      token: options.token,
      sessionId: options.sessionId,
      deadline: options.deadline,
      signal: options.signal,
      allowEmptyResponse: false,
    });

    return parseToolContent(result.payloads);
  }

  private async postJson(options: {
    payload: JsonObject;
    token?: string;
    sessionId?: string;
    deadline?: Deadline;
    signal?: AbortSignal;
    allowEmptyResponse: boolean;
  }): Promise<McpHttpResult> {
    const headers: Record<string, string> = {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    };

    if (options.token) {
      headers.Authorization = `Bearer ${options.token}`;
    }
    if (options.sessionId) {
      headers["Mcp-Session-Id"] = options.sessionId;
    }

    const { response, body } = await runWithTimeout(
      (signal) =>
        fetch(BFG_MCP_ENDPOINT, {
          method: "POST",
          headers,
          body: JSON.stringify(options.payload),
          cache: "no-store",
          signal,
        }).then(async (response) => ({
          response,
          body: await response.text(),
        })),
      {
        deadline: options.deadline,
        signal: options.signal,
        timeoutMs: MCP_HTTP_TIMEOUT_MS,
        timeoutMessage: "Die Datenbank hat nicht rechtzeitig geantwortet. Bitte erneut versuchen.",
      },
    );

    if (response.status === 401 && !options.token) {
      throw new MissingMcpBearerTokenError();
    }
    if (response.status === 401) {
      throw new UserVisibleError(
        "Datenbankzugang wurde abgelehnt. Bitte serverseitige Datenbank-Konfiguration prüfen.",
        401,
      );
    }
    if (!response.ok) {
      throw new UserVisibleError(`Datenbankfehler HTTP ${response.status}.`, 502);
    }

    const payloads = extractJsonPayloads(body);
    if (payloads.length === 0 && !options.allowEmptyResponse) {
      throw new UserVisibleError("Datenbankantwort ist leer.", 502);
    }

    const jsonRpcError = getJsonRpcError(payloads);
    if (jsonRpcError) {
      throw new UserVisibleError(
        `Datenbankfehler${jsonRpcError.code ? ` ${jsonRpcError.code}` : ""}: ${
          jsonRpcError.message ?? "Unbekannter JSON-RPC Fehler."
        }`,
        502,
      );
    }

    return {
      payloads,
      sessionId: response.headers.get("Mcp-Session-Id") ?? response.headers.get("MCP-Session-Id") ?? undefined,
    };
  }
}
