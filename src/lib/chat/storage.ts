const HISTORY_STORAGE_KEY = "findog.history.v1";

export function chatHistoryStorageKey(userId: string): string {
  return `${HISTORY_STORAGE_KEY}.${userId}`;
}
