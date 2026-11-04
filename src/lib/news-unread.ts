import type { DashboardNewsItem } from "./dashboard";

/** localStorage key holding the time (epoch ms) the user last opened "Neuigkeiten". */
export const NEWS_LAST_SEEN_STORAGE_KEY = "findog.newsLastSeenAt";

type NewsTimestampSource = Pick<DashboardNewsItem, "publishedAt" | "updatedAt" | "createdAt">;

/** Epoch ms at which a news item became visible to readers, or null when unknown. */
export function getNewsItemTimestamp(item: Partial<NewsTimestampSource>): number | null {
  for (const value of [item.publishedAt, item.updatedAt, item.createdAt]) {
    if (!value) continue;
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return null;
}

export function getLatestNewsTimestamp(items: readonly Partial<NewsTimestampSource>[]): number | null {
  let latest: number | null = null;
  for (const item of items) {
    const timestamp = getNewsItemTimestamp(item);
    if (timestamp !== null && (latest === null || timestamp > latest)) latest = timestamp;
  }
  return latest;
}

/** Parses the persisted last-seen value; anything that is not a positive finite number means "never". */
export function parseStoredNewsLastSeen(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** True when at least one news item is newer than the last time the news view was opened. */
export function hasUnreadNews(
  items: readonly Partial<NewsTimestampSource>[],
  lastSeenAt: number | null,
): boolean {
  const latest = getLatestNewsTimestamp(items);
  if (latest === null) return false;
  return lastSeenAt === null || latest > lastSeenAt;
}

/**
 * Timestamp to persist when the news view is opened. Never lower than the newest item so a
 * future-dated or clock-skewed item cannot keep the dot lit after the user has seen it.
 */
export function nextNewsLastSeen(
  items: readonly Partial<NewsTimestampSource>[],
  now: number,
): number {
  const latest = getLatestNewsTimestamp(items);
  return latest === null ? now : Math.max(now, latest);
}
