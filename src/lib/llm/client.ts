import { type Deadline, runWithTimeout } from "../deadline";
import { UserVisibleError } from "../errors";
import type { DeepSeekTool, JsonObject } from "../mcp/tools";
import type { LlmRuntime } from "./runtime";

export const LLM_CHAT_TIMEOUT_MS = 120_000;
export const LLM_THINKING_TIMEOUT_MS = 220_000;
export const LLM_OPENAI_COMPATIBLE_TIMEOUT_MS = 600_000;

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

export type LlmToolChoice = "auto" | "required";

function publicLabel(runtime: LlmRuntime): string {
  return runtime.label ?? providerLabel(runtime);
}

function providerLabel(runtime: LlmRuntime): string {
  if (runtime.provider === "deepseek") return "DeepSeek";
  if (runtime.provider === "openai_compatible") return "OpenAI-kompatibler Provider";
  return "Z.AI";
}

function providerError(runtime: LlmRuntime, status: number): string {
  const label = publicLabel(runtime);
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
  toolChoice?: LlmToolChoice,
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
    if (toolChoice) {
      payload.tool_choice = toolChoice;
    } else if (!usesThinking && !isOpenAICompatible) {
      payload.tool_choice = "auto";
    }
  }

  return payload;
}

export function effectiveTimeoutMs(runtime: LlmRuntime): number {
  if (runtime.provider === "openai_compatible") {
    return LLM_OPENAI_COMPATIBLE_TIMEOUT_MS;
  }
  return thinkingEnabled(runtime) ? LLM_THINKING_TIMEOUT_MS : LLM_CHAT_TIMEOUT_MS;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  deadline: { signal?: AbortSignal; deadline?: Deadline; timeoutMs: number; timeoutMessage: string; reserveMs?: number },
): Promise<{ response: Response; body: string }> {
  return runWithTimeout(async (signal) => {
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetch(url, { ...init, signal });
        return { response, body: await response.text() };
      } catch (error) {
        const isLastAttempt = attempt === maxAttempts;
        const isTransportFailure = error instanceof TypeError;
        if (signal.aborted || !isTransportFailure || isLastAttempt) {
          throw error;
        }
      }
    }
    throw new Error("unreachable");
  }, deadline);
}

export async function chatCompletion(options: {
  runtime: LlmRuntime;
  messages: LlmMessage[];
  tools?: DeepSeekTool[];
  deadline?: Deadline;
  signal?: AbortSignal;
  timeoutMs?: number;
  reserveMs?: number;
  toolChoice?: LlmToolChoice;
}): Promise<LlmResult> {
  const tools = options.tools ?? [];
  const payload = completionPayload(
    options.runtime,
    options.messages,
    tools,
    options.toolChoice,
  );
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${options.runtime.apiKey}`,
    "Content-Type": "application/json",
  };
  if (options.runtime.provider === "zai") {
    headers["Accept-Language"] = "en-US,en";
  }

  const timeoutMs = options.timeoutMs ?? effectiveTimeoutMs(options.runtime);

  let response: Response;
  let body: string;
  try {
    const result = await fetchWithRetry(
      `${options.runtime.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        cache: "no-store",
      },
      {
        deadline: options.deadline,
        signal: options.signal,
        timeoutMs,
        timeoutMessage: `${publicLabel(options.runtime)} hat nicht rechtzeitig geantwortet. Bitte erneut versuchen.`,
        reserveMs: options.reserveMs,
      },
    );
    response = result.response;
    body = result.body;
  } catch (error) {
    if (error instanceof TypeError) {
      throw new UserVisibleError(
        `${publicLabel(options.runtime)} ist nach einem Verbindungsfehler nicht erreichbar. Bitte später erneut versuchen.`,
        502,
      );
    }
    throw error;
  }

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
      `${publicLabel(options.runtime)} lieferte keine gültige JSON-Antwort.`,
      502,
    );
  }

  const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
  const firstChoice = choices[0] as JsonObject | undefined;
  const finishReason = typeof firstChoice?.finish_reason === "string" ? firstChoice.finish_reason : "";
  const message = firstChoice?.message as JsonObject | undefined;
  if (!message) {
    throw new UserVisibleError(
      `${publicLabel(options.runtime)} Antwort enthält keine Auswahl.`,
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
      `${publicLabel(options.runtime)} hat eine unvollständige Werkzeugauswahl geliefert.`,
      502,
    );
  }
  if (finishReason === "content_filter") {
    throw new UserVisibleError(
      `${publicLabel(options.runtime)} hat die Antwort aufgrund eines Sicherheitsfilters abgelehnt.`,
      502,
    );
  }
  if (!["stop", "length", "tool_calls"].includes(finishReason)) {
    throw new UserVisibleError(
      `${publicLabel(options.runtime)} hat die Antwort mit einem unbekannten Status beendet.`,
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
