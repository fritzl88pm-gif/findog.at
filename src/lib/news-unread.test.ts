import { describe, expect, it } from "vitest";

import {
  getLatestNewsTimestamp,
  getNewsItemTimestamp,
  hasUnreadNews,
  NEWS_LAST_SEEN_STORAGE_KEY,
  nextNewsLastSeen,
  parseStoredNewsLastSeen,
} from "@/lib/news-unread";

const MAY = "2026-05-01T10:00:00.000Z";
const JUNE = "2026-06-01T10:00:00.000Z";

describe("news unread helpers", () => {
  it("uses the documented storage key", () => {
    expect(NEWS_LAST_SEEN_STORAGE_KEY).toBe("findog.newsLastSeenAt");
  });

  it("reads the publish time and falls back to updated/created times", () => {
    expect(getNewsItemTimestamp({ publishedAt: MAY })).toBe(Date.parse(MAY));
    expect(getNewsItemTimestamp({ publishedAt: null, updatedAt: JUNE })).toBe(Date.parse(JUNE));
    expect(getNewsItemTimestamp({ publishedAt: "kaputt", createdAt: MAY })).toBe(Date.parse(MAY));
    expect(getNewsItemTimestamp({ publishedAt: null })).toBeNull();
  });

  it("finds the newest item regardless of order", () => {
    expect(getLatestNewsTimestamp([{ publishedAt: MAY }, { publishedAt: JUNE }, { publishedAt: null }]))
      .toBe(Date.parse(JUNE));
    expect(getLatestNewsTimestamp([])).toBeNull();
  });

  it("parses the stored last-seen value defensively", () => {
    expect(parseStoredNewsLastSeen(String(Date.parse(MAY)))).toBe(Date.parse(MAY));
    expect(parseStoredNewsLastSeen(null)).toBeNull();
    expect(parseStoredNewsLastSeen(undefined)).toBeNull();
    expect(parseStoredNewsLastSeen("")).toBeNull();
    expect(parseStoredNewsLastSeen("gestern")).toBeNull();
    expect(parseStoredNewsLastSeen("-5")).toBeNull();
    expect(parseStoredNewsLastSeen("0")).toBeNull();
  });

  it("flags unread news only when something is newer than the last visit", () => {
    const items = [{ publishedAt: MAY }, { publishedAt: JUNE }];
    expect(hasUnreadNews(items, null)).toBe(true);
    expect(hasUnreadNews(items, Date.parse(MAY))).toBe(true);
    expect(hasUnreadNews(items, Date.parse(JUNE))).toBe(false);
    expect(hasUnreadNews(items, Date.parse(JUNE) + 1)).toBe(false);
    expect(hasUnreadNews([], null)).toBe(false);
    expect(hasUnreadNews([{ publishedAt: null }], null)).toBe(false);
  });

  it("persists a last-seen time that clears the dot for the current items", () => {
    const items = [{ publishedAt: JUNE }];
    const now = Date.parse("2026-07-01T00:00:00.000Z");
    expect(nextNewsLastSeen(items, now)).toBe(now);
    expect(hasUnreadNews(items, nextNewsLastSeen(items, now))).toBe(false);

    const futureDated = [{ publishedAt: "2030-01-01T00:00:00.000Z" }];
    expect(nextNewsLastSeen(futureDated, now)).toBe(Date.parse("2030-01-01T00:00:00.000Z"));
    expect(hasUnreadNews(futureDated, nextNewsLastSeen(futureDated, now))).toBe(false);

    expect(nextNewsLastSeen([], now)).toBe(now);
  });
});
