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
