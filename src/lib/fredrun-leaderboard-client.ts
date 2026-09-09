"use client";

import { useCallback, useEffect, useState } from "react";
import { parseFredRunAccessBlockedResponse } from "./fredrun-access";
import { parseFredRunHighscoresResponse, type FredRunLeaderboardEntry } from "./fredrun-highscores";
import type { FredRunWorldId } from "./fredrun-worlds";

type BoardResult = {
  world: FredRunWorldId;
  token: string;
  attempt: number;
  state: "ready" | "error";
  entries: FredRunLeaderboardEntry[];
  error: string;
};

export function useFredRunLeaderboard(
  accessToken: string,
  gameWorld: FredRunWorldId,
  onPlayerName: (name: string) => void,
  onBlocked: (message: string) => void,
) {
  const [selection, setSelection] = useState({ gameWorld, world: gameWorld });
  // A real game-world change resets the default board; browsing never changes the game.
  if (selection.gameWorld !== gameWorld) setSelection({ gameWorld, world: gameWorld });
  const world = selection.gameWorld === gameWorld ? selection.world : gameWorld;
  const [attempts, setAttempts] = useState<Record<FredRunWorldId, number>>({ vienna: 0, "finanzamt-night": 0, alps: 0 });
  const attempt = attempts[world];
  const [result, setResult] = useState<BoardResult | null>(null);
  const selectWorld = useCallback((next: FredRunWorldId) => setSelection({ gameWorld, world: next }), [gameWorld]);
  const refreshWorld = useCallback((submittedWorld: FredRunWorldId) => {
    setAttempts(current => ({ ...current, [submittedWorld]: current[submittedWorld] + 1 }));
  }, []);
  const retry = useCallback(() => refreshWorld(world), [refreshWorld, world]);

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    void fetch(`/api/fredrun/highscores?world=${world}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    }).then(async response => {
      const payload: unknown = await response.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (!response.ok) {
        const blocked = parseFredRunAccessBlockedResponse(payload);
        if (blocked) onBlocked(blocked);
        throw new Error(blocked || "Die Topliste konnte nicht geladen werden.");
      }
      const parsed = parseFredRunHighscoresResponse(payload);
      if (!parsed || parsed.world !== world) throw new Error("Die Topliste lieferte ein ungültiges Antwortformat.");
      setResult({ world, token: accessToken, attempt, state: "ready", entries: parsed.entries, error: "" });
      onPlayerName(parsed.playerName);
    }).catch(() => {
      if (controller.signal.aborted) return;
      setResult({ world, token: accessToken, attempt, state: "error", entries: [], error: "Die Topliste konnte nicht geladen werden." });
    });
    return () => controller.abort();
  }, [accessToken, world, attempt, onBlocked, onPlayerName]);

  // Tag rendered data as well as requests: no stale rows even before effect cleanup.
  const current = result?.world === world && result.token === accessToken && result.attempt === attempt ? result : null;
  return {
    world, selectWorld, retry, refreshWorld,
    entries: current?.entries ?? [],
    state: !accessToken ? "error" as const : current?.state ?? "loading" as const,
    error: !accessToken ? "Die Topliste kann ohne aktive Anmeldung nicht geladen werden." : current?.error ?? "",
  };
}
