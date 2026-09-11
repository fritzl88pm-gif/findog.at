/**
 * Test support for the Findog Agent runtime.
 *
 * These helpers are fixture builders only: they construct validated settings
 * documents and clearly labelled in-memory transports. They never talk to a
 * real provider, never use real credentials and are not imported by production
 * code.
 */

import { normalizeFindogAgentSettings } from "./settings";
import type { FindogAgentTransport, FindogAgentTransportResponse } from "./network";
import type { FindogAgentSettings } from "./types";

export const FINDOG_AGENT_TEST_CREDENTIALS: Record<string, string> = {
  "connection:primary:apiKey": "test-model-key",
  "knowledge:apiKey": "test-knowledge-key",
  "web:exaApiKey": "test-exa-key",
  "mcp:docs:bearer": "test-mcp-bearer",
};

export type FindogAgentSettingsOverrides = {
  enabled?: boolean;
  agentName?: string;
  systemPrompt?: string;
  activeModelId?: string | null;
  connectionBaseUrl?: string;
  provider?: string;
  model?: Record<string, unknown>;
  knowledge?: Record<string, unknown>;
  web?: Record<string, unknown>;
  mcp?: Record<string, unknown>;
  limits?: Record<string, unknown>;
};

export function findogAgentTestSettings(
  overrides: FindogAgentSettingsOverrides = {},
): FindogAgentSettings {
  const raw = {
    schemaVersion: 1,
    agentName: overrides.agentName ?? "Findog Agent (Test)",
    systemPrompt: overrides.systemPrompt ?? "Recherchiere gründlich und belege jede Aussage.",
    enabled: overrides.enabled ?? true,
    activeModelId: overrides.activeModelId === undefined ? "flash" : overrides.activeModelId,
    connections: [{
      id: "primary",
      name: "DeepSeek (Test)",
      provider: overrides.provider ?? "deepseek",
      baseUrl: overrides.connectionBaseUrl ?? "https://api.deepseek.com/v1",
    }],
    models: [{
      id: "flash",
      label: "DeepSeek V4.1 Flash (Test)",
      connectionId: "primary",
      model: "deepseek-flash",
      reasoningEffort: "high",
      capabilities: ["tools", "reasoning"],
      maxOutputTokens: 1024,
      contextTokens: null,
      inputCostPerMillionUsd: null,
      outputCostPerMillionUsd: null,
      ...(overrides.model ?? {}),
    }],
    knowledge: {
      enabled: false,
      baseUrl: null,
      knowledgeBaseIds: [],
      ...(overrides.knowledge ?? {}),
    },
    web: {
      mode: "off",
      allowedDomains: [],
      maxResults: 3,
      maxTextCharacters: 4000,
      ...(overrides.web ?? {}),
    },
    mcp: { servers: [], ...(overrides.mcp ?? {}) },
    limits: {
      requestTimeoutSeconds: 30,
      deadlineSeconds: 60,
      maxSteps: 6,
      maxToolCalls: 8,
      maxOutputTokens: 500,
      estimatedCostLimitUsd: null,
      ...(overrides.limits ?? {}),
    },
  };

  return normalizeFindogAgentSettings(raw, { allowInsecureHttp: true });
}

export type FindogAgentRecordedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  json: Record<string, unknown>;
  purpose: string | undefined;
};

export type FindogAgentMockRoute = {
  name: string;
  match: (request: FindogAgentRecordedRequest) => boolean;
  handle: (
    request: FindogAgentRecordedRequest,
  ) => FindogAgentTransportResponse | Promise<FindogAgentTransportResponse>;
};

export type FindogAgentMockTransport = {
  transport: FindogAgentTransport;
  requests: FindogAgentRecordedRequest[];
  forPurpose(purpose: string): FindogAgentRecordedRequest[];
  matched(name: string): number;
};

function parseJsonBody(body: string | null | undefined): Record<string, unknown> {
  if (!body) {
    return {};
  }
  try {
    const parsed = JSON.parse(body) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function createFindogAgentMockTransport(
  routes: FindogAgentMockRoute[],
): FindogAgentMockTransport {
  const requests: FindogAgentRecordedRequest[] = [];
  const matchedCounts = new Map<string, number>();

  return {
    requests,
    forPurpose: (purpose: string) => requests.filter((request) => request.purpose === purpose),
    matched: (name: string) => matchedCounts.get(name) ?? 0,
    transport: {
      async send(request) {
        const recorded: FindogAgentRecordedRequest = {
          url: request.url,
          method: request.method,
          headers: { ...(request.headers ?? {}) },
          body: request.body ?? null,
          json: parseJsonBody(request.body),
          purpose: request.purpose,
        };
        requests.push(recorded);
        const route = routes.find((candidate) => candidate.match(recorded));
        if (!route) {
          throw new Error(`Unmatched request: ${recorded.method} ${recorded.url}`);
        }
        matchedCounts.set(route.name, (matchedCounts.get(route.name) ?? 0) + 1);
        return route.handle(recorded);
      },
    },
  };
}

export function findogAgentJsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): FindogAgentTransportResponse {
  return {
    status,
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
    truncated: false,
  };
}

export type ChatCompletionScript = {
  content?: string;
  reasoningContent?: string | null;
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown>; id?: string }>;
  finishReason?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number } | null;
};

export function findogAgentChatCompletionBody(script: ChatCompletionScript): Record<string, unknown> {
  const toolCalls = (script.toolCalls ?? []).map((call, index) => ({
    id: call.id ?? `call_${index + 1}`,
    type: "function",
    function: { name: call.name, arguments: JSON.stringify(call.arguments) },
  }));
  const usage = script.usage === undefined
    ? { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
    : script.usage;

  const body: Record<string, unknown> = {
    id: "chatcmpl-test",
    object: "chat.completion",
    model: "deepseek-flash",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: script.content ?? "",
        ...(script.reasoningContent ? { reasoning_content: script.reasoningContent } : {}),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: script.finishReason ?? (toolCalls.length > 0 ? "tool_calls" : "stop"),
    }],
  };
  if (usage !== null) {
    body.usage = usage;
  }
  return body;
}

/** Model route that replays a scripted list of completions, repeating the last one. */
export function findogAgentModelRoute(
  script: ChatCompletionScript[],
): FindogAgentMockRoute {
  let index = 0;
  return {
    name: "model",
    match: (request) => request.url.endsWith("/chat/completions"),
    handle: () => {
      const entry = script[Math.min(index, script.length - 1)];
      index += 1;
      return findogAgentJsonResponse(200, findogAgentChatCompletionBody(entry ?? {}));
    },
  };
}

export function findogAgentModelRequests(
  http: FindogAgentMockTransport,
): FindogAgentRecordedRequest[] {
  return http.forPurpose("model:chat-completions");
}

export function findogAgentMessagesOf(
  request: FindogAgentRecordedRequest,
): Array<Record<string, unknown>> {
  const messages = request.json.messages;
  return Array.isArray(messages) ? messages as Array<Record<string, unknown>> : [];
}
