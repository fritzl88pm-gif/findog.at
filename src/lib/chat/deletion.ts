export function applyConversationDeletion<T extends { id: string }>(options: {
  conversations: T[];
  selectedIds: string[];
  activeConversationId: string;
  deletedIds: string[];
}): {
  conversations: T[];
  selectedIds: string[];
  activeConversationDeleted: boolean;
} {
  const deleted = new Set(options.deletedIds);
  return {
    conversations: options.conversations.filter((conversation) => !deleted.has(conversation.id)),
    selectedIds: options.selectedIds.filter((id) => !deleted.has(id)),
    activeConversationDeleted: deleted.has(options.activeConversationId),
  };
}

/** Splits ids into consecutive chunks of at most `size` entries. */
export function chunkIds(ids: string[], size: number): string[][] {
  const chunkSize = Math.max(1, Math.floor(size));
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += chunkSize) {
    chunks.push(ids.slice(index, index + chunkSize));
  }
  return chunks;
}
