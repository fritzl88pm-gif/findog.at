/**
 * Model transport for DeepSeek, OpenRouter and OpenAI-compatible
 * chat-completions endpoints.
 *
 * The wire payload is derived exclusively from the captured settings revision
 * and the decrypted credential handed in by the caller. Declared model
 * capabilities control which parameter fields are sent: a model without the
 * `tools` capability never receives a tool list, and a model without the
 * `reasoning` capability never receives a reasoning field. Responses are
 * complete (non-streaming) so tool call accounting stays truthful; the engine
 * never claims token streaming.
 *
 * Provider-specific reasoning fields: DeepSeek/V4.1-Flash native uses
 * `reasoning_effort` and requires `reasoning_content` replay on tool
 * continuations, OpenRouter uses a `reasoning` object, and plain
 * OpenAI-compatible servers use `reasoning_effort` when the administrator
 * declared the capability. This mapping is an explicit, capability-gated
 * assumption and must be re-confirmed against a live endpoint before release.
 */

import { FindogAgentProviderError } from "./errors";
import type { FindogAgentJsonSchema } from "./jsonschema";
import type { FindogAgentTransport } from "./network";
import type {
  FindogAgentModelCapability,
  FindogAgentProvider,
  FindogAgentReasoningEffort,
} from "./types";

export type FindogAgentProviderToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: FindogAgentJsonSchema;
  };
};

export type FindogAgentProviderToolCall = {
  id: string;
  name: string;
  /** Raw JSON string exactly as returned by the provider. */
  arguments: string;
};

export type FindogAgentProviderMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
    role: "assistant";
    content: string;
    reasoningContent?: string | null;
    toolCalls?: FindogAgentProviderToolCall[];
  }
  | { role: "tool"; content: string; toolCallId: string; name?: string };

export type FindogAgentModelUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  reasoningTokens: number | null;
  /** Provider-reported cost (OpenRouter `usage.cost`); null when absent. */
  reportedCostUsd: number | null;
};

export type FindogAgentModelResponse = {
  content: string;
  reasoningContent: string | null;
  toolCalls: FindogAgentProviderToolCall[];
  finishReason: string;
  usage: FindogAgentModelUsage;
};

export type FindogAgentModelCallRequest = {
  messages: FindogAgentProviderMessage[];
  tools: FindogAgentProviderToolDefinition[] | null;
  toolChoice: "auto" | "none";
  maxOutputTokens: number;
  signal?: AbortSignal | null;
  timeoutMs?: number;
};

export type FindogAgentChatPayload = {
  model: string;
  messages: Array<Record<string, unknown>>;
  max_tokens: number;
  stream: false;
  tools?: FindogAgentProviderToolDefinition[];
  tool_choice?: "auto" | "none";
  reasoning_effort?: string;
  reasoning?: { effort: string };
};

type ProviderProfile = {
  path: string;
  reasoningField: "reasoning_effort" | "reasoning_object" | null;
  replayReasoningContent: boolean;
  extraHeaders: Record<string, string>;
};

export const FINDOG_AGENT_PROVIDER_PROFILES: Record<FindogAgentProvider, ProviderProfile> = {
  deepseek: {
    path: "/chat/completions",
    reasoningField: "reasoning_effort",
    replayReasoningContent: true,
    extraHeaders: {},
  },
  openrouter: {
    path: "/chat/completions",
    reasoningField: "reasoning_object",
    replayReasoningContent: false,
    extraHeaders: {},
  },
  "openai-compatible": {
    path: "/chat/completions",
    reasoningField: "reasoning_effort",
    replayReasoningContent: false,
    extraHeaders: {},
  },
};

function serializeMessage(
  provider: FindogAgentProvider,
  message: FindogAgentProviderMessage,
): Record<string, unknown> {
  const profile = FINDOG_AGENT_PROVIDER_PROFILES[provider];
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content,
    };
  }
  if (message.role === "assistant") {
    const serialized: Record<string, unknown> = {
      role: "assistant",
      content: message.content,
    };
    if (message.toolCalls && message.toolCalls.length > 0) {
      serialized.tool_calls = message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      }));
    }
    if (
      profile.replayReasoningContent
      && typeof message.reasoningContent === "string"
      && message.reasoningContent.length > 0
    ) {
      serialized.reasoning_content = message.reasoningContent;
    }
    return serialized;
  }
  return { role: message.role, content: message.content };
}

/**
 * Builds the exact chat-completions payload. Exported so tests can assert the
 * wire contract without duplicating serialization logic.
 */
export function buildFindogAgentChatPayload(input: {
  provider: FindogAgentProvider;
  model: string;
  capabilities: readonly FindogAgentModelCapability[];
  reasoningEffort: FindogAgentReasoningEffort | null;
  messages: FindogAgentProviderMessage[];
  tools: FindogAgentProviderToolDefinition[] | null;
  toolChoice: "auto" | "none";
  maxOutputTokens: number;
}): FindogAgentChatPayload {
  const profile = FINDOG_AGENT_PROVIDER_PROFILES[input.provider];
  const supportsTools = input.capabilities.includes("tools");
  const supportsReasoning = input.capabilities.includes("reasoning");

  const payload: FindogAgentChatPayload = {
    model: input.model,
    messages: input.messages.map((message) => serializeMessage(input.provider, message)),
    max_tokens: input.maxOutputTokens,
    stream: false,
  };

  // A tool list is only ever sent when the administrator declared tool support.
  if (supportsTools && input.tools && input.tools.length > 0) {
    payload.tools = input.tools;
    payload.tool_choice = input.toolChoice;
  }

  // Reasoning fields are only sent when both the capability and an effort exist.
  if (supportsReasoning && input.reasoningEffort && profile.reasoningField === "reasoning_effort") {
    payload.reasoning_effort = input.reasoningEffort;
  }
  if (supportsReasoning && input.reasoningEffort && profile.reasoningField === "reasoning_object") {
    payload.reasoning = { effort: input.reasoningEffort };
  }

  return payload;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asFiniteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseToolCalls(value: unknown): FindogAgentProviderToolCall[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const calls: FindogAgentProviderToolCall[] = [];
  for (const entry of value) {
    const call = asRecord(entry);
    const fn = call ? asRecord(call.function) : null;
    if (!call || !fn || typeof fn.name !== "string" || !fn.name) {
      continue;
    }
    const rawArguments = fn.arguments;
    calls.push({
      id: typeof call.id === "string" && call.id ? call.id : `call_${calls.length + 1}`,
      name: fn.name,
      arguments: typeof rawArguments === "string"
        ? rawArguments
        : rawArguments === undefined || rawArguments === null
          ? "{}"
          : JSON.stringify(rawArguments),
    });
  }
  return calls;
}

export function parseFindogAgentChatResponse(bodyText: string): FindogAgentModelResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new FindogAgentProviderError(
      "model_invalid_response",
      "Die Modellantwort war kein gültiges JSON.",
    );
  }

  const root = asRecord(parsed);
  const choices = root && Array.isArray(root.choices) ? root.choices : null;
  const first = choices && choices.length > 0 ? asRecord(choices[0]) : null;
  const message = first ? asRecord(first.message) : null;
  if (!first || !message) {
    throw new FindogAgentProviderError(
      "model_invalid_response",
      "Die Modellantwort enthielt keine verwertbare Nachricht.",
    );
  }

  const usage = root ? asRecord(root.usage) : null;
  const completionDetails = usage ? asRecord(usage.completion_tokens_details) : null;

  return {
    content: typeof message.content === "string" ? message.content : "",
    reasoningContent: typeof message.reasoning_content === "string"
      ? message.reasoning_content
      : null,
    toolCalls: parseToolCalls(message.tool_calls),
    finishReason: typeof first.finish_reason === "string" ? first.finish_reason : "",
    usage: {
      promptTokens: asFiniteNumberOrNull(usage?.prompt_tokens),
      completionTokens: asFiniteNumberOrNull(usage?.completion_tokens),
      totalTokens: asFiniteNumberOrNull(usage?.total_tokens),
      reasoningTokens: asFiniteNumberOrNull(completionDetails?.reasoning_tokens),
      reportedCostUsd: asFiniteNumberOrNull(usage?.cost),
    },
  };
}

export type FindogAgentProviderOptions = {
  provider: FindogAgentProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  capabilities: readonly FindogAgentModelCapability[];
  reasoningEffort: FindogAgentReasoningEffort | null;
  transport: FindogAgentTransport;
  timeoutMs?: number;
};

export type FindogAgentModelClient = {
  complete(request: FindogAgentModelCallRequest): Promise<FindogAgentModelResponse>;
};

export function createFindogAgentProvider(
  options: FindogAgentProviderOptions,
): FindogAgentModelClient {
  const profile = FINDOG_AGENT_PROVIDER_PROFILES[options.provider];
  const url = `${options.baseUrl.replace(/\/+$/, "")}${profile.path}`;

  return {
    async complete(request) {
      const payload = buildFindogAgentChatPayload({
        provider: options.provider,
        model: options.model,
        capabilities: options.capabilities,
        reasoningEffort: options.reasoningEffort,
        messages: request.messages,
        tools: request.tools,
        toolChoice: request.toolChoice,
        maxOutputTokens: request.maxOutputTokens,
      });

      if (!options.apiKey) {
        throw new FindogAgentProviderError(
          "model_http_error",
          "Für dieses Modell ist kein Zugangsschlüssel hinterlegt.",
          401,
        );
      }

      const response = await options.transport.send({
        url,
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Bearer ${options.apiKey}`,
          ...profile.extraHeaders,
        },
        body: JSON.stringify(payload),
        purpose: "model:chat-completions",
        timeoutMs: request.timeoutMs ?? options.timeoutMs,
        signal: request.signal ?? null,
      });

      if (response.status < 200 || response.status >= 300) {
        // Never echo the raw provider body: an upstream may repeat API keys or
        // sensitive diagnostics in its error payload. Only the status survives,
        // which is enough for a truthful, safe user-facing message.
        throw new FindogAgentProviderError(
          "model_http_error",
          `Das Modell hat mit Status ${response.status} geantwortet.`,
          response.status,
        );
      }

      return parseFindogAgentChatResponse(response.body);
    },
  };
}
