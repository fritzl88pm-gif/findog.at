export const TOOL_RESULT_CONTEXT_CHAR_LIMIT = 12_000;
export const TOOL_LOG_SYNTHESIS_CHAR_BUDGET = 60_000;
export const TOOL_LOG_MIN_ENTRY_CHARS = 400;
export const TOOL_LOOP_CONTEXT_CHAR_BUDGET = 60_000;

const TRUNCATION_SUFFIX =
  "\n… [gekürzt – vollständige Fundstelle in der gespeicherten Evidenz]";

type BudgetEntry = {
  result: string;
  success: boolean;
};

type ToolProtocolMessage = {
  role: string;
  content?: string | null;
  tool_call_id?: string;
};

function unicodeSafePrefix(text: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;

  const prefix = text.slice(0, maxChars);
  const lastCodeUnit = prefix.charCodeAt(prefix.length - 1);
  return lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff
    ? prefix.slice(0, -1)
    : prefix;
}

function shortenToolResult(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars < TRUNCATION_SUFFIX.length) {
    return unicodeSafePrefix(text, maxChars);
  }

  const sourceText = text.endsWith(TRUNCATION_SUFFIX)
    ? text.slice(0, -TRUNCATION_SUFFIX.length)
    : text;
  const prefix = unicodeSafePrefix(
    sourceText,
    maxChars - TRUNCATION_SUFFIX.length,
  );
  return prefix + TRUNCATION_SUFFIX;
}

function applyPrioritizedBudget<T extends BudgetEntry>(
  entries: readonly T[],
  budget: number,
): T[] {
  if (entries.length === 0) return [];

  const working = entries.map((entry) => ({ ...entry }));
  let totalChars = working.reduce((sum, entry) => sum + entry.result.length, 0);
  if (totalChars <= budget) return working;

  const effectiveMinFloor = Math.min(
    TOOL_LOG_MIN_ENTRY_CHARS,
    Math.floor(budget / working.length),
  );
  const prioritizedIndices = [
    ...working.flatMap((entry, index) => (entry.success ? [] : [index])),
    ...working.flatMap((entry, index) => (entry.success ? [index] : [])),
  ];

  for (const index of prioritizedIndices) {
    const excessChars = totalChars - budget;
    if (excessChars <= 0) break;

    const currentLength = working[index].result.length;
    const reducibleChars = Math.max(0, currentLength - effectiveMinFloor);
    if (reducibleChars === 0) continue;

    const targetLength = currentLength - Math.min(excessChars, reducibleChars);
    const shortenedResult = shortenToolResult(
      working[index].result,
      targetLength,
    );
    totalChars -= currentLength - shortenedResult.length;
    working[index] = { ...working[index], result: shortenedResult };
  }

  return working;
}

/**
 * Truncate a tool result for LLM context. If the text exceeds the per-result
 * limit, take a prefix leaving room for the suffix without splitting Unicode
 * UTF-16 surrogate pairs. Preserve text <= limit as-is.
 */
export function truncateToolResultForContext(text: string): string {
  return shortenToolResult(text, TOOL_RESULT_CONTEXT_CHAR_LIMIT);
}

/**
 * Apply the tool log synthesis budget to an ordered list of entries.
 * Preserves entry count and order, non-mutating.
 * Re-shrinks failed entries oldest-first, then successful entries oldest-first.
 * If entry count makes count * minEntryFloor exceed the hard budget,
 * the effective floor is dynamically lowered so that every entry is preserved.
 */
export function applyToolLogBudget<T extends BudgetEntry>(
  entries: readonly T[],
): T[] {
  return applyPrioritizedBudget(entries, TOOL_LOG_SYNTHESIS_CHAR_BUDGET);
}

/**
 * Apply the aggregate agent-loop budget to role=tool messages while preserving
 * every protocol message and tool_call_id. Changed messages are rebuilt rather
 * than mutated in place.
 */
export function applyToolLoopContextBudget<T extends ToolProtocolMessage>(
  messages: readonly T[],
  successByToolCallId: ReadonlyMap<string, boolean>,
): T[] {
  const toolEntries = messages.flatMap((message, messageIndex) => {
    if (message.role !== "tool") return [];
    return [
      {
        messageIndex,
        result: message.content ?? "",
        success: successByToolCallId.get(message.tool_call_id ?? "") ?? true,
      },
    ];
  });
  const budgetedEntries = applyPrioritizedBudget(
    toolEntries,
    TOOL_LOOP_CONTEXT_CHAR_BUDGET,
  );
  const resultByMessageIndex = new Map(
    budgetedEntries.map((entry) => [entry.messageIndex, entry.result]),
  );

  return messages.map((message, messageIndex) => {
    const budgetedContent = resultByMessageIndex.get(messageIndex);
    if (
      budgetedContent === undefined ||
      budgetedContent === (message.content ?? "")
    ) {
      return message;
    }
    return { ...message, content: budgetedContent };
  });
}
