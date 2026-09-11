/**
 * Bounded-text helpers shared by adapters, tools and the engine.
 *
 * Retrieved content is untrusted and always bounded before it is handed to a
 * model or persisted as evidence.
 */

export type FindogAgentBoundedText = {
  text: string;
  truncated: boolean;
  originalCharacters: number;
};

export function boundFindogAgentText(input: unknown, maxCharacters: number): FindogAgentBoundedText {
  const text = typeof input === "string" ? input : String(input ?? "");
  if (text.length <= maxCharacters) {
    return { text, truncated: false, originalCharacters: text.length };
  }
  return {
    text: text.slice(0, maxCharacters),
    truncated: true,
    originalCharacters: text.length,
  };
}

/**
 * Deliberately coarse token estimate. It is only used to refuse or visibly
 * truncate oversized conversations before a paid request, never to claim exact
 * provider accounting.
 */
export function estimateFindogAgentTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function findogAgentTruncationSuffix(bounded: FindogAgentBoundedText): string {
  if (!bounded.truncated) {
    return "";
  }
  return `\n\n[Auszug gekürzt: ${bounded.originalCharacters} Zeichen insgesamt, ${bounded.text.length} Zeichen übernommen]`;
}
