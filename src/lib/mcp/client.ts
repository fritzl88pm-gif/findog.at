import { BFG_MCP_ENDPOINT, MCP_PROTOCOL_VERSION } from "./config";
import { type Deadline, hasDeadlineTime, runWithTimeout } from "../deadline";
import { MissingMcpBearerTokenError, UserVisibleError } from "../errors";
import { extractJsonPayloads } from "./parser";
import type { JsonObject, McpTool } from "./tools";

export const MCP_HTTP_TIMEOUT_MS = 60_000;

const MCP_MAX_ATTEMPTS = 3;
const MCP_RETRY_BASE_DELAY_MS = 500;
const MCP_RETRY_MIN_ATTEMPT_MS = 2_000;

/** Marks a transient upstream failure (5xx/429) that is safe to retry. */
class TransientMcpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientMcpError";
  }
}

type McpPostOptions = {
  payload: JsonObject;
  token?: string;
  sessionId?: string;
  deadline?: Deadline;
  signal?: AbortSignal;
  allowEmptyResponse: boolean;
};

function mcpBackoffMs(attempt: number): number {
  return MCP_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
}

/**
 * Retryable = transient upstream (5xx/429) or a raw network/connection error.
 * Auth failures (401), timeouts and other UserVisibleErrors are terminal, so
 * only idempotent read calls to the MCP endpoint are ever retried.
 */
function isRetryableMcpError(error: unknown): boolean {
  if (error instanceof TransientMcpError) {
    return true;
  }
  if (error instanceof MissingMcpBearerTokenError || error instanceof UserVisibleError) {
    return false;
  }
  return true;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason instanceof Error
    ? signal.reason
    : new UserVisibleError("Die Datenbankabfrage wurde abgebrochen.", 499);
}

/** Waits `ms`, rejecting early if any provided signal aborts. */
function abortableDelay(ms: number, signals: Array<AbortSignal | undefined>): Promise<void> {
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  return new Promise((resolve, reject) => {
    const alreadyAborted = active.find((signal) => signal.aborted);
    if (alreadyAborted) {
      reject(abortReason(alreadyAborted));
      return;
    }
    const cleanup = () => {
      clearTimeout(timer);
      for (const signal of active) {
        signal.removeEventListener("abort", onAbort);
      }
    };
    const onAbort = (event: Event) => {
      cleanup();
      reject(abortReason(event.target as AbortSignal));
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    if (typeof timer === "object" && "unref" in timer && typeof timer.unref === "function") {
      timer.unref();
    }
    for (const signal of active) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

type McpHttpResult = {
  payloads: JsonObject[];
  sessionId?: string;
};

type McpSession = {
  sessionId?: string;
  tools: McpTool[];
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

function stringifyToolContent(payloads: JsonObject[]): string {
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
  return result.isError === true ? `Datenbankfehler: ${text}` : text;
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

    return stringifyToolContent(result.payloads);
  }

  private async postJson(options: McpPostOptions): Promise<McpHttpResult> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MCP_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.attemptPostJson(options);
      } catch (error) {
        lastError = error;
        const canRetry =
          isRetryableMcpError(error)
          && attempt < MCP_MAX_ATTEMPTS
          && hasDeadlineTime(options.deadline, mcpBackoffMs(attempt) + MCP_RETRY_MIN_ATTEMPT_MS);
        if (!canRetry) {
          if (error instanceof TransientMcpError) {
            throw new UserVisibleError(error.message, 502);
          }
          throw error;
        }
        await abortableDelay(mcpBackoffMs(attempt), [options.deadline?.signal, options.signal]);
      }
    }
    if (lastError instanceof TransientMcpError) {
      throw new UserVisibleError(lastError.message, 502);
    }
    throw lastError;
  }

  private async attemptPostJson(options: McpPostOptions): Promise<McpHttpResult> {
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
    if (response.status === 429 || response.status >= 500) {
      throw new TransientMcpError(`Datenbankfehler HTTP ${response.status}.`);
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
