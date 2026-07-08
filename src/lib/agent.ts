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

function requireModelContent(content: string | null, errorMessage: string): string {
  const text = content?.trim();
  if (!text) {
    throw new UserVisibleError(errorMessage, 502);
  }

  return text;
}

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

function planningInstruction(): string {
  return [
    "Erstelle zuerst einen dynamischen Arbeitsplan für diese konkrete Anfrage.",
    "Der Plan ist verpflichtend, aber Umfang und Zahl der Punkte bestimmst du selbst.",
    "Nutze keine fixe Vorlage; Gesetze, Richtlinien oder BFG-Urteile sind nur mögliche Beispiele, wenn sie zur Anfrage passen.",
    "Gib nur den Plan als nummerierte oder stichpunktartige Markdown-Liste aus.",
  ].join("\n");
}

function executionInstruction(plan: string): string {
  return [
    "Arbeite den Arbeitsplan systematisch ab.",
    "Nutze MCP-Werkzeuge gezielt für die jeweils offenen Planpunkte und vermeide Recherche, die nicht zum Plan beiträgt.",
    "Wenn ein Planpunkt erledigt ist, berücksichtige das in späteren Fortschritts- und Abschlussprüfungen.",
    "",
    "Arbeitsplan:",
    plan,
  ].join("\n");
}

function progressInstruction(plan: string): string {
  return [
    "Aktualisiere den Arbeitsplan anhand der bisherigen Werkzeugergebnisse.",
    "Gib den vollständigen Plan als Markdown-Liste zurück.",
    "Streiche erledigte Punkte mit ~~Punkt~~ durch und lasse offene Punkte ungestrichen.",
    "Antworte knapp und ohne finale Fallbeurteilung.",
    "",
    "Ursprünglicher Arbeitsplan:",
    plan,
  ].join("\n");
}

function selfCheckInstruction(plan: string): string {
  return [
    "Prüfe vor der finalen Antwort, ob alle Punkte des Arbeitsplans abgearbeitet wurden.",
    "Nenne knapp erledigte Punkte, offene Punkte und ob die finale Antwort trotz offener Punkte belastbar ist.",
    "Gib nur den Selbstcheck aus.",
    "",
    "Arbeitsplan:",
    plan,
  ].join("\n");
}

function finalAnswerInstruction(plan: string): string {
  return [
    "Formuliere jetzt die finale Antwort aus Anfrage, Arbeitsplan, Werkzeugergebnissen und Selbstcheck.",
    "Nutze keine weiteren Werkzeuge.",
    "Wenn Planpunkte offen geblieben sind, benenne die Unsicherheit transparent.",
    "",
    "Arbeitsplan:",
    plan,
  ].join("\n");
}

type ToolLogEntry = {
  toolName: string;
  arguments: string;
  result: string;
  success: boolean;
};

type AgentStepHandler = (step: AgentStep) => void | Promise<void>;

async function appendAgentStep(
  steps: AgentStep[],
  step: AgentStep,
  onStep?: AgentStepHandler,
): Promise<void> {
  steps.push(step);
  await onStep?.(step);
}

function formatConversation(messages: AppChatMessage[]): string {
  return messages
    .map((message) => `${message.role === "user" ? "Nutzer" : "Assistent"}: ${message.content}`)
    .join("\n\n");
}

function formatToolLog(toolLog: ToolLogEntry[]): string {
  if (toolLog.length === 0) {
    return "Noch keine Werkzeugergebnisse.";
  }

  return toolLog
    .map((entry, index) =>
      [
        `${index + 1}. ${entry.success ? "Erfolg" : "Fehler"}: ${entry.toolName}`,
        `Argumente: ${entry.arguments}`,
        `Ergebnis: ${summarizeStepText(entry.result, 4_000)}`,
      ].join("\n"),
    )
    .join("\n\n");
}

function supportMessages(options: {
  systemPrompt: string;
  conversation: AppChatMessage[];
  instruction: string;
  toolLog: ToolLogEntry[];
  draftAnswer?: string;
  selfCheck?: string;
}): DeepSeekMessage[] {
  const context = [
    "Chatverlauf:",
    formatConversation(options.conversation),
    "",
    "Bisherige Werkzeugergebnisse:",
    formatToolLog(options.toolLog),
  ];

  if (options.draftAnswer) {
    context.push("", "Vorläufige Antwort des Agenten:", options.draftAnswer);
  }
  if (options.selfCheck) {
    context.push("", "Selbstcheck des Arbeitsplans:", options.selfCheck);
  }

  return [
    {
      role: "system",
      content: options.systemPrompt,
    },
    {
      role: "user",
      content: [context.join("\n"), options.instruction].join("\n\n"),
    },
  ];
}

async function createProgressUpdate(options: {
  apiKey: string;
  model: ChatModel;
  systemPrompt: string;
  conversation: AppChatMessage[];
  toolLog: ToolLogEntry[];
  plan: string;
  steps: AgentStep[];
  onStep?: AgentStepHandler;
}): Promise<void> {
  const progressResult = await chatCompletion({
    apiKey: options.apiKey,
    model: options.model,
    messages: supportMessages({
      systemPrompt: options.systemPrompt,
      conversation: options.conversation,
      instruction: progressInstruction(options.plan),
      toolLog: options.toolLog,
    }),
  });
  const progress = requireModelContent(
    progressResult.content,
    "DeepSeek konnte keinen Fortschrittsstatus zum Arbeitsplan erstellen.",
  );

  await appendAgentStep(options.steps, {
    type: "progress",
    title: "Fortschritt im Arbeitsplan",
    content: summarizeStepText(progress),
  }, options.onStep);
}

async function finalizeAgentRun(options: {
  apiKey: string;
  model: ChatModel;
  systemPrompt: string;
  conversation: AppChatMessage[];
  toolLog: ToolLogEntry[];
  draftAnswer?: string;
  plan: string;
  steps: AgentStep[];
  tools: string[];
  reason: string;
  onStep?: AgentStepHandler;
}): Promise<AgentRunResult> {
  await appendAgentStep(options.steps, {
    type: "finalize",
    title: "Finalisierung ohne weitere Werkzeuge",
    content: options.reason,
  }, options.onStep);

  const selfCheckResult = await chatCompletion({
    apiKey: options.apiKey,
    model: options.model,
    messages: supportMessages({
      systemPrompt: options.systemPrompt,
      conversation: options.conversation,
      instruction: selfCheckInstruction(options.plan),
      toolLog: options.toolLog,
      draftAnswer: options.draftAnswer,
    }),
  });
  const selfCheck = requireModelContent(
    selfCheckResult.content,
    "DeepSeek konnte keinen Selbstcheck zum Arbeitsplan erstellen.",
  );
  await appendAgentStep(options.steps, {
    type: "self_check",
    title: "Selbstcheck des Arbeitsplans",
    content: summarizeStepText(selfCheck),
  }, options.onStep);

  const finalResult = await chatCompletion({
    apiKey: options.apiKey,
    model: options.model,
    messages: supportMessages({
      systemPrompt: options.systemPrompt,
      conversation: options.conversation,
      instruction: finalAnswerInstruction(options.plan),
      toolLog: options.toolLog,
      draftAnswer: options.draftAnswer,
      selfCheck,
    }),
  });
  const answer = requireModelContent(
    finalResult.content,
    "DeepSeek konnte aus den bisherigen Werkzeugergebnissen keine finale Antwort erstellen.",
  );

  await appendAgentStep(options.steps, {
    type: "answer",
    title: "Finale Antwort",
    content: summarizeStepText(answer),
  }, options.onStep);
  return {
    answer,
    steps: options.steps,
    tools: options.tools,
  };
}

export async function runAgent(options: {
  apiKey: string;
  model: ChatModel;
  systemPrompt: string;
  messages: AppChatMessage[];
  mcpBearerToken?: string;
  onStep?: AgentStepHandler;
}): Promise<AgentRunResult> {
  const mcp = new McpClient();
  const conversationMessages = options.messages.map(
    (message): DeepSeekMessage => ({
      role: message.role,
      content: message.content,
    }),
  );

  const planResult = await chatCompletion({
    apiKey: options.apiKey,
    model: options.model,
    messages: [
      {
        role: "system",
        content: [options.systemPrompt, planningInstruction()].join("\n\n"),
      },
      ...conversationMessages,
    ],
  });
  const plan = requireModelContent(
    planResult.content,
    "DeepSeek konnte keinen Arbeitsplan für die Anfrage erstellen.",
  );

  const steps: AgentStep[] = [];
  await appendAgentStep(steps, {
    type: "plan",
    title: "Arbeitsplan",
    content: summarizeStepText(plan),
  }, options.onStep);
  const session = await mcp.openToolSession(options.mcpBearerToken);
  const toolNames = session.tools.map((tool) => tool.name);
  await appendAgentStep(steps, {
    type: "tools",
    title: "MCP-Werkzeuge geladen",
    content: `${toolNames.length} BFG/WeKnora-MCP-Werkzeuge verfügbar: ${summarizeToolNames(toolNames)}`,
    tools: toolNames,
  }, options.onStep);

  const messages: DeepSeekMessage[] = [
    {
      role: "system",
      content: [options.systemPrompt, executionInstruction(plan)].join("\n\n"),
    },
    ...conversationMessages,
  ];
  const toolLog: ToolLogEntry[] = [];

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const result = await chatCompletion({
      apiKey: options.apiKey,
      model: options.model,
      messages: [...messages],
      tools: session.deepSeekTools,
    });

    if (result.toolCalls.length === 0) {
      const draftAnswer = result.content?.trim();
      return finalizeAgentRun({
        apiKey: options.apiKey,
        model: options.model,
        systemPrompt: options.systemPrompt,
        conversation: options.messages,
        toolLog,
        draftAnswer,
        plan,
        steps,
        tools: toolNames,
        onStep: options.onStep,
        reason:
          "Die Werkzeugrecherche ist abgeschlossen. Ich prüfe den Arbeitsplan und erstelle daraus die finale Antwort ohne weitere MCP-Werkzeuge.",
      });
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
      await appendAgentStep(steps, {
        type: "tool_call",
        title: `Werkzeugaufruf: ${call.name}`,
        content: `Argumente:\n${argumentSummary}`,
        toolName: call.name,
        arguments: argumentSummary,
      }, options.onStep);

      let toolResult: string;
      try {
        toolResult = await mcp.callTool({
          token: options.mcpBearerToken,
          sessionId: session.sessionId,
          name: call.name,
          arguments: parsedArguments,
        });
      } catch (error) {
        await appendAgentStep(steps, {
          type: "tool_result",
          title: `Werkzeugfehler: ${call.name}`,
          content:
            error instanceof Error
              ? summarizeStepText(error.message)
              : "Das Werkzeug konnte nicht erfolgreich ausgeführt werden.",
          toolName: call.name,
          success: false,
        }, options.onStep);
        throw error;
      }

      const success = !toolResult.startsWith("MCP-Fehler:");
      toolLog.push({
        toolName: call.name,
        arguments: argumentSummary,
        result: toolResult,
        success,
      });
      await appendAgentStep(steps, {
        type: "tool_result",
        title: success ? `Werkzeugergebnis: ${call.name}` : `Werkzeugfehler: ${call.name}`,
        content: summarizeStepText(toolResult),
        toolName: call.name,
        success,
      }, options.onStep);

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: toolResult,
      });
    }

    await createProgressUpdate({
      apiKey: options.apiKey,
      model: options.model,
      systemPrompt: options.systemPrompt,
      conversation: options.messages,
      toolLog,
      plan,
      steps,
      onStep: options.onStep,
    });
  }

  return finalizeAgentRun({
    apiKey: options.apiKey,
    model: options.model,
    systemPrompt: options.systemPrompt,
    conversation: options.messages,
    toolLog,
    plan,
    steps,
    tools: toolNames,
    onStep: options.onStep,
    reason:
      "Das Werkzeuglimit ist erreicht. Ich erstelle jetzt eine finale Antwort aus den bisherigen Ergebnissen, ohne weitere MCP-Werkzeuge aufzurufen.",
  });
}
