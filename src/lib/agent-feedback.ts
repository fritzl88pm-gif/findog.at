export const MAX_AGENT_FEEDBACK_CHARS = 10_000;

export function findNearestPrecedingUserMessage(
  messages: ReadonlyArray<{ role: "user" | "assistant"; content: string }>,
  index: number,
): string | null {
  for (let messageIndex = index - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (message?.role === "user" && message.content.trim()) {
      return message.content;
    }
  }
  return null;
}
