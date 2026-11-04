"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { DashboardNewsItem, DashboardPayload } from "@/lib/dashboard";

export type PlatformNewsState = {
  items: DashboardNewsItem[];
  error: string;
  isLoading: boolean;
  /** Re-fetches the news in the background; existing items stay visible meanwhile. */
  refresh: () => void;
};

const LOAD_ERROR = "Die Neuigkeiten konnten nicht geladen werden.";

/** Loads the platform updates (`news.product`) from `/api/dashboard`. */
export function usePlatformNews(accessToken: string): PlatformNewsState {
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    let isActive = true;
    queueMicrotask(() => {
      if (!isActive) return;
      setLoadError("");
      void fetch("/api/dashboard", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          const body = await response.json().catch(() => ({})) as DashboardPayload & { error?: string };
          if (!response.ok || !body.news) {
            throw new Error(body.error ?? LOAD_ERROR);
          }
          if (isActive) setPayload(body);
        })
        .catch((error) => {
          if (isActive && (error as { name?: string }).name !== "AbortError") {
            setLoadError(error instanceof Error ? error.message : LOAD_ERROR);
          }
        });
    });
    return () => {
      isActive = false;
      controller.abort();
    };
  }, [accessToken, reloadCount]);

  const refresh = useCallback(() => setReloadCount((count) => count + 1), []);

  const items = useMemo(() => payload?.news.product ?? [], [payload]);

  return {
    items,
    error: payload ? (payload.sectionErrors?.productNews ?? "") : loadError,
    isLoading: !payload && !loadError,
    refresh,
  };
}
