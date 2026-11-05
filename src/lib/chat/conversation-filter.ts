function normalizeSearchText(value: string): string {
  return value
    .toLocaleLowerCase("de-AT")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Filters conversations by title: case- and diacritic-insensitive,
 * every whitespace-separated term of the query must match (AND).
 * An empty (or whitespace-only) query returns the input list unchanged.
 */
export function filterConversationsByTitle<T extends { title: string }>(
  conversations: T[],
  query: string,
): T[] {
  const terms = normalizeSearchText(query.trim()).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return conversations;

  return conversations.filter((conversation) => {
    const title = normalizeSearchText(conversation.title);
    return terms.every((term) => title.includes(term));
  });
}
