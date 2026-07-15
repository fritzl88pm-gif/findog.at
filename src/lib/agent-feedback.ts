/**
 * Safely resolves the nearest preceding user message content
 * before the given index, walking backwards through the messages array.
 * Returns null when no user message exists before the given index.
 */
export function findNearestPrecedingUserMessage(
  messages: ReadonlyArray<{ role: "user" | "assistant"; content: string }>,
  index: number,
): string | null {
  for (let i = index - 1; i >= 0; i--) {
    const message = messages[i];
    if (message && message.role === "user" && typeof message.content === "string") {
      return message.content;
    }
  }
  return null;
}
