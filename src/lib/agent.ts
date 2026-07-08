import { chatCompletion, type AppChatMessage, type DeepSeekMessage } from "./deepseek";
import { UserVisibleError } from "./errors";
import { McpClient } from "./mcp/client";
import type { JsonObject } from "./mcp/tools";
import type { ChatModel } from "./config";

const MAX_TOOL_ITERATIONS = 4;

function parseToolArguments(name: string, rawArguments: string): JsonObject {
  if (!rawArguments.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawArguments) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as JsonObject;
    }
  } catch {
    throw new UserVisibleError(`DeepSeek lieferte ungültige Werkzeugargumente für ${name}.`, 502);
  }

  throw new UserVisibleError(`DeepSeek lieferte ungültige Werkzeugargumente für ${name}.`, 502);
}

export async function runAgent(options: {
  apiKey: string;
  model: ChatModel;
  systemPrompt: string;
  messages: AppChatMessage[];
  mcpBearerToken?: string;
}): Promise<string> {
  const mcp = new McpClient();
  const session = await mcp.openToolSession(options.mcpBearerToken);
  const messages: DeepSeekMessage[] = [
    {
      role: "system",
      content: options.systemPrompt,
    },
    ...options.messages.map(
      (message): DeepSeekMessage => ({
        role: message.role,
        content: message.content,
      }),
    ),
  ];

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const result = await chatCompletion({
      apiKey: options.apiKey,
      model: options.model,
      messages,
      tools: session.deepSeekTools,
    });

    if (result.toolCalls.length === 0) {
      const answer = result.content?.trim();
      if (!answer) {
        throw new UserVisibleError("DeepSeek Antwort ist leer.", 502);
      }
      return answer;
    }

    messages.push({
      role: "assistant",
      content: result.content,
      tool_calls: result.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: call.name,
          arguments: call.arguments,
        },
      })),
    });

    for (const call of result.toolCalls) {
      const toolResult = await mcp.callTool({
        token: options.mcpBearerToken,
        sessionId: session.sessionId,
        name: call.name,
        arguments: parseToolArguments(call.name, call.arguments),
      });

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: toolResult,
      });
    }
  }

  throw new UserVisibleError(
    "DeepSeek hat nach 4 Werkzeugrunden keine finale Antwort geliefert. Bitte die Frage enger formulieren.",
    502,
  );
}
