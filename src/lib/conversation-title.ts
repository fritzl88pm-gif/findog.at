import type { Deadline } from "./deadline";
import { chatCompletion } from "./deepseek";
import { withRuntimeReasoning, type LlmRuntime } from "./llm/runtime";

export const MAX_CONVERSATION_TITLE_CHARS = 80;

function compactText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export function fallbackConversationTitle(userRequest: string): string {
  const normalized = compactText(userRequest)
    .replace(/^(?:PDF|Bild)-Anhang:\s*.+$/gimu, "")
    .replace(/\s+/gu, " ")
    .trim() || "Neue Unterhaltung";

  if (normalized.length <= MAX_CONVERSATION_TITLE_CHARS) {
    return normalized;
  }

  const candidate = normalized.slice(0, MAX_CONVERSATION_TITLE_CHARS - 1);
  const lastWordBoundary = candidate.lastIndexOf(" ");
  const shortened = lastWordBoundary >= 48 ? candidate.slice(0, lastWordBoundary) : candidate;
  return `${shortened.trimEnd()}…`;
}

function normalizeGeneratedTitle(value: string | null, fallback: string): string {
  const firstLine = value?.split(/\r?\n/u)[0] ?? "";
  const normalized = compactText(firstLine)
    .replace(/^#{1,6}\s*/u, "")
    .replace(/^["'„“”]+|["'„“”]+$/gu, "")
    .trim();

  return normalized ? fallbackConversationTitle(normalized) : fallback;
}

export async function generateConversationTitle(options: {
  runtime: LlmRuntime;
  userRequest: string;
  deadline?: Deadline;
}): Promise<string> {
  const fallback = fallbackConversationTitle(options.userRequest);

  try {
    const result = await chatCompletion({
      runtime: withRuntimeReasoning(options.runtime, "disabled"),
      deadline: options.deadline,
      messages: [
        {
          role: "system",
          content: [
            "Erzeuge einen kurzen, präzisen deutschen Titel für eine Chat-Unterhaltung.",
            "Leite ihn ausschließlich aus der folgenden neuesten Nutzeranfrage ab.",
            "Gib nur den Titel aus, ohne Anführungszeichen, Antwort, Erklärung oder Satzzeichen am Ende.",
            `Maximal ${MAX_CONVERSATION_TITLE_CHARS} Zeichen.`,
          ].join("\n"),
        },
        { role: "user", content: options.userRequest },
      ],
    });

    return normalizeGeneratedTitle(result.content, fallback);
  } catch {
    return fallback;
  }
}
