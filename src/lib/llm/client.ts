import { type Deadline, runWithTimeout } from "../deadline";
import { UserVisibleError } from "../errors";
import type { DeepSeekTool, JsonObject } from "../mcp/tools";
import type { LlmRuntime } from "./runtime";

export const LLM_CHAT_TIMEOUT_MS = 120_000;
export const LLM_THINKING_TIMEOUT_MS = 220_000;

export type AppChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type LlmToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type LlmMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  reasoning_content?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
};

export type FinishReason =
  | "stop"
  | "length"
  | "tool_calls"
  | "content_filter"
  | (string & {});

export type LlmResult = {
  content: string | null;
  reasoningContent?: string | null;
  toolCalls: LlmToolCall[];
  finishReason: FinishReason;
};

function providerLabel(runtime: LlmRuntime): string {
  if (runtime.provider === "deepseek") return "DeepSeek";
  if (runtime.provider === "openai_compatible") return "OpenAI-kompatibler Provider";
  return "Z.AI";
}

function providerError(runtime: LlmRuntime, status: number): string {
  const label = providerLabel(runtime);
  if (status === 401 || status === 403) {
    return `${label} API-Zugang wurde abgelehnt. Bitte Administrator kontaktieren.`;
  }
  if (status === 429) {
    return `${label} Rate Limit erreicht. Bitte später erneut versuchen.`;
  }
  if (status >= 500) {
    return `${label} ist derzeit nicht erreichbar. Bitte später erneut versuchen.`;
  }
  return `${label} Anfrage ist mit HTTP ${status} fehlgeschlagen.`;
}

function serializedToolArguments(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return "{}";
    }
  }
  return "{}";
}

function thinkingEnabled(runtime: LlmRuntime): boolean {
  return runtime.reasoning !== "disabled";
}

function completionPayload(
  runtime: LlmRuntime,
  messages: LlmMessage[],
  tools: DeepSeekTool[],
): JsonObject {
  const usesThinking = thinkingEnabled(runtime);
  const isOpenAICompatible = runtime.provider === "openai_compatible";
  const payload: JsonObject = {
    model: runtime.upstreamModel,
    messages,
    stream: false,
  };

  if (isOpenAICompatible) {
    payload.temperature = 0.2;
    payload.max_tokens = 16000;
  } else {
    payload.thinking = { type: usesThinking ? "enabled" : "disabled" };

    if (usesThinking) {
      if (runtime.reasoning === "high" || runtime.reasoning === "max") {
        payload.reasoning_effort = runtime.reasoning;
      }
    } else {
      payload.temperature = 0.2;
    }
  }

  if (tools.length > 0) {
    payload.tools = tools;
    if (!usesThinking && !isOpenAICompatible) {
      payload.tool_choice = "auto";
    }
  }

  return payload;
}

export async function chatCompletion(options: {
  runtime: LlmRuntime;
  messages: LlmMessage[];
  tools?: DeepSeekTool[];
  deadline?: Deadline;
  signal?: AbortSignal;
  timeoutMs?: number;
  reserveMs?: number;
}): Promise<LlmResult> {
  const tools = options.tools ?? [];
  const usesThinking = thinkingEnabled(options.runtime);
  const payload = completionPayload(options.runtime, options.messages, tools);
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${options.runtime.apiKey}`,
    "Content-Type": "application/json",
  };
  if (options.runtime.provider === "zai") {
    headers["Accept-Language"] = "en-US,en";
  }

  const { response, body } = await runWithTimeout(
    (signal) =>
      fetch(`${options.runtime.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        cache: "no-store",
        signal,
      }).then(async (response) => ({
        response,
        body: await response.text(),
      })),
    {
      deadline: options.deadline,
      signal: options.signal,
      timeoutMs: options.timeoutMs
        ?? (usesThinking ? LLM_THINKING_TIMEOUT_MS : LLM_CHAT_TIMEOUT_MS),
      timeoutMessage: `${providerLabel(options.runtime)} hat nicht rechtzeitig geantwortet. Bitte erneut versuchen.`,
      reserveMs: options.reserveMs,
    },
  );

  if (!response.ok) {
    throw new UserVisibleError(
      providerError(options.runtime, response.status),
      response.status,
    );
  }

  let parsed: JsonObject;
  try {
    parsed = JSON.parse(body) as JsonObject;
  } catch {
    throw new UserVisibleError(
      `${providerLabel(options.runtime)} lieferte keine gültige JSON-Antwort.`,
      502,
    );
  }

  const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
  const firstChoice = choices[0] as JsonObject | undefined;
  const finishReason = typeof firstChoice?.finish_reason === "string" ? firstChoice.finish_reason : "";
  const message = firstChoice?.message as JsonObject | undefined;
  if (!message) {
    throw new UserVisibleError(
      `${providerLabel(options.runtime)} Antwort enthält keine Auswahl.`,
      502,
    );
  }

  const rawToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const toolCalls = rawToolCalls
    .map((call, index): LlmToolCall | null => {
      if (!call || typeof call !== "object") {
        return null;
      }
      const item = call as JsonObject;
      const fn = item.function as JsonObject | undefined;
      const name = typeof fn?.name === "string" ? fn.name : "";
      if (!name) {
        return null;
      }
      return {
        id: typeof item.id === "string" ? item.id : `tool-${index}`,
        name,
        arguments: serializedToolArguments(fn?.arguments),
      };
    })
    .filter((call): call is LlmToolCall => call !== null);

  const content =
    typeof message.content === "string"
      ? message.content
      : message.content === null
        ? null
        : "";
  const reasoningContent = typeof message.reasoning_content === "string"
    ? message.reasoning_content
    : null;

  if (finishReason === "tool_calls" && toolCalls.length === 0) {
    throw new UserVisibleError(
      `${providerLabel(options.runtime)} hat eine unvollständige Werkzeugauswahl geliefert.`,
      502,
    );
  }
  if (finishReason === "content_filter") {
    throw new UserVisibleError(
      `${providerLabel(options.runtime)} hat die Antwort aufgrund eines Sicherheitsfilters abgelehnt.`,
      502,
    );
  }
  if (!["stop", "length", "tool_calls"].includes(finishReason)) {
    throw new UserVisibleError(
      `${providerLabel(options.runtime)} hat die Antwort mit einem unbekannten Status beendet.`,
      502,
    );
  }

  return {
    content,
    reasoningContent,
    toolCalls,
    finishReason: finishReason as FinishReason,
  };
}
