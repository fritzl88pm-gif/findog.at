import { BFG_MCP_ENDPOINT, MCP_PROTOCOL_VERSION } from "../config";
import { MissingMcpBearerTokenError, UserVisibleError } from "../errors";
import { extractJsonPayloads } from "./parser";
import { mcpToolToDeepSeekTool, type DeepSeekTool, type JsonObject, type McpTool } from "./tools";

type McpHttpResult = {
  payloads: JsonObject[];
  sessionId?: string;
};

type McpSession = {
  sessionId?: string;
  tools: McpTool[];
  deepSeekTools: DeepSeekTool[];
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
  const result = resultObject(payloads, "BFG MCP tools/list Antwort ist unvollständig.");
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

function stringifyToolContent(payloads: JsonObject[]): string {
  const result = resultObject(payloads, "BFG MCP tools/call Antwort ist unvollständig.");
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
  return result.isError === true ? `MCP-Fehler: ${text}` : text;
}

export class McpClient {
  private nextId = 1;

  async openToolSession(token?: string): Promise<McpSession> {
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
      allowEmptyResponse: false,
    });

    const sessionId = toolsResult.sessionId ?? initialize.sessionId;
    const tools = parseTools(toolsResult.payloads);

    return {
      sessionId,
      tools,
      deepSeekTools: tools.map(mcpToolToDeepSeekTool),
    };
  }

  async callTool(options: {
    token?: string;
    sessionId?: string;
    name: string;
    arguments: JsonObject;
  }): Promise<string> {
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
      allowEmptyResponse: false,
    });

    return stringifyToolContent(result.payloads);
  }

  private async postJson(options: {
    payload: JsonObject;
    token?: string;
    sessionId?: string;
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

    const response = await fetch(BFG_MCP_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(options.payload),
      cache: "no-store",
    });

    const body = await response.text();
    if (response.status === 401 && !options.token) {
      throw new MissingMcpBearerTokenError();
    }
    if (response.status === 401) {
      throw new UserVisibleError("BFG MCP Token wurde abgelehnt. Bitte in den Einstellungen prüfen.", 401);
    }
    if (!response.ok) {
      throw new UserVisibleError(`BFG MCP Fehler HTTP ${response.status}.`, 502);
    }

    const payloads = extractJsonPayloads(body);
    if (payloads.length === 0 && !options.allowEmptyResponse) {
      throw new UserVisibleError("BFG MCP Antwort ist leer.", 502);
    }

    const jsonRpcError = getJsonRpcError(payloads);
    if (jsonRpcError) {
      throw new UserVisibleError(
        `BFG MCP Fehler${jsonRpcError.code ? ` ${jsonRpcError.code}` : ""}: ${
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
