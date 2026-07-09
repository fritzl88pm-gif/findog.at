import { DEEPSEEK_BASE_URL, type ChatModel } from "./config";
import { UserVisibleError } from "./errors";
import type { DeepSeekTool, JsonObject } from "./mcp/tools";

export type AppChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type DeepSeekToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type DeepSeekMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
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

export type DeepSeekResult = {
  content: string | null;
  toolCalls: DeepSeekToolCall[];
};

type DeepSeekErrorBody = {
  error?: {
    message?: string;
  };
};

function parseDeepSeekError(code: number, body: string): string {
  let apiMessage = "";
  try {
    apiMessage = (JSON.parse(body) as DeepSeekErrorBody).error?.message ?? "";
  } catch {
    apiMessage = "";
  }

  if (code === 401) {
    return "DeepSeek API Key wurde abgelehnt. Bitte Administrator kontaktieren.";
  }
  if (code === 429) {
    return "DeepSeek Rate Limit erreicht. Bitte später erneut versuchen.";
  }
  if (code >= 500) {
    return "DeepSeek ist derzeit nicht erreichbar. Bitte später erneut versuchen.";
  }

  return `DeepSeek Fehler HTTP ${code}${apiMessage ? `: ${apiMessage}` : ""}`;
}

export async function chatCompletion(options: {
  apiKey: string;
  model: ChatModel;
  messages: DeepSeekMessage[];
  tools?: DeepSeekTool[];
}): Promise<DeepSeekResult> {
  const tools = options.tools ?? [];
  const payload: JsonObject = {
    model: options.model,
    messages: options.messages,
    temperature: 0.2,
  };

  if (tools.length > 0) {
    payload.tools = tools;
    payload.tool_choice = "auto";
  }

  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const body = await response.text();
  if (!response.ok) {
    throw new UserVisibleError(parseDeepSeekError(response.status, body), response.status);
  }

  let parsed: JsonObject;
  try {
    parsed = JSON.parse(body) as JsonObject;
  } catch {
    throw new UserVisibleError("DeepSeek lieferte keine gültige JSON-Antwort.", 502);
  }

  const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
  const firstChoice = choices[0] as JsonObject | undefined;
  const message = firstChoice?.message as JsonObject | undefined;
  if (!message) {
    throw new UserVisibleError("DeepSeek Antwort enthält keine Auswahl.", 502);
  }

  const rawToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const toolCalls = rawToolCalls
    .map((call, index): DeepSeekToolCall | null => {
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
        arguments: typeof fn?.arguments === "string" ? fn.arguments : "{}",
      };
    })
    .filter((call): call is DeepSeekToolCall => call !== null);

  const content =
    typeof message.content === "string"
      ? message.content
      : message.content === null
        ? null
        : "";

  return {
    content,
    toolCalls,
  };
}
