import { chatCompletion, type AppChatMessage, type DeepSeekMessage } from "./deepseek";
import { UserVisibleError } from "./errors";
import { McpClient } from "./mcp/client";
import type { JsonObject } from "./mcp/tools";
import type { ChatModel } from "./config";
import {
  summarizeStepText,
  summarizeToolArguments,
  summarizeToolNames,
  type AgentRunResult,
  type AgentStep,
} from "./agent-steps";

const MAX_TOOL_ITERATIONS = 12;

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
}): Promise<AgentRunResult> {
  const mcp = new McpClient();
  const steps: AgentStep[] = [
    {
      type: "plan",
      title: "Arbeitsplan",
      content:
        "Ich folge dem Fred-Ablauf: zuerst Rechtslage, Beträge und Verwaltungspraxis prüfen; bei Relevanz gezielt BFG-Judikatur recherchieren; danach eine verwaltungspraktisch verwertbare Gesamtbeurteilung formulieren.",
    },
  ];
  const session = await mcp.openToolSession(options.mcpBearerToken);
  const toolNames = session.tools.map((tool) => tool.name);
  steps.push({
    type: "tools",
    title: "MCP-Werkzeuge geladen",
    content: `${toolNames.length} BFG/WeKnora-MCP-Werkzeuge verfügbar: ${summarizeToolNames(toolNames)}`,
    tools: toolNames,
  });

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
      steps.push({
        type: "answer",
        title: "Finale Antwort",
        content: summarizeStepText(answer),
      });
      return {
        answer,
        steps,
        tools: toolNames,
      };
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
      const parsedArguments = parseToolArguments(call.name, call.arguments);
      const argumentSummary = summarizeToolArguments(parsedArguments);
      steps.push({
        type: "tool_call",
        title: `Werkzeugaufruf: ${call.name}`,
        content: `Argumente:\n${argumentSummary}`,
        toolName: call.name,
        arguments: argumentSummary,
      });

      let toolResult: string;
      try {
        toolResult = await mcp.callTool({
          token: options.mcpBearerToken,
          sessionId: session.sessionId,
          name: call.name,
          arguments: parsedArguments,
        });
      } catch (error) {
        steps.push({
          type: "tool_result",
          title: `Werkzeugfehler: ${call.name}`,
          content:
            error instanceof Error
              ? summarizeStepText(error.message)
              : "Das Werkzeug konnte nicht erfolgreich ausgeführt werden.",
          toolName: call.name,
          success: false,
        });
        throw error;
      }

      const success = !toolResult.startsWith("MCP-Fehler:");
      steps.push({
        type: "tool_result",
        title: success ? `Werkzeugergebnis: ${call.name}` : `Werkzeugfehler: ${call.name}`,
        content: summarizeStepText(toolResult),
        toolName: call.name,
        success,
      });

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: toolResult,
      });
    }
  }

  steps.push({
    type: "finalize",
    title: "Finalisierung ohne weitere Werkzeuge",
    content:
      "Das Werkzeuglimit ist erreicht. Ich erstelle jetzt eine finale Antwort aus den bisherigen Ergebnissen, ohne weitere MCP-Werkzeuge aufzurufen.",
  });
  const finalResult = await chatCompletion({
    apiKey: options.apiKey,
    model: options.model,
    messages,
  });
  const answer = finalResult.content?.trim();
  if (!answer) {
    throw new UserVisibleError(
      "DeepSeek konnte aus den bisherigen Werkzeugergebnissen keine finale Antwort erstellen.",
      502,
    );
  }

  steps.push({
    type: "answer",
    title: "Finale Antwort",
    content: summarizeStepText(answer),
  });
  return {
    answer,
    steps,
    tools: toolNames,
  };
}
