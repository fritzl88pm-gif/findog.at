export const MIN_SIDEBAR_HISTORY_PERCENT = 20;
export const MAX_SIDEBAR_HISTORY_PERCENT = 80;
export const DEFAULT_SIDEBAR_HISTORY_PERCENT = 50;
export const SIDEBAR_HISTORY_PERCENT_STORAGE_KEY = "findog.sidebar.historyPercent";
export const SIDEBAR_APPLICATION_NAVIGATION_STORAGE_KEY =
  "findog.sidebar.applicationNavigationExpanded";

export function clampSidebarHistoryPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SIDEBAR_HISTORY_PERCENT;
  }

  return Math.min(
    MAX_SIDEBAR_HISTORY_PERCENT,
    Math.max(MIN_SIDEBAR_HISTORY_PERCENT, value),
  );
}

export function parseStoredSidebarHistoryPercent(value: string | null): number {
  if (value === null || value.trim() === "") {
    return DEFAULT_SIDEBAR_HISTORY_PERCENT;
  }

  return clampSidebarHistoryPercent(Number(value));
}

export function parseStoredApplicationNavigationExpanded(value: string | null): boolean {
  if (value === "false") {
    return false;
  }

  return true;
}
