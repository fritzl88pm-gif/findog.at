"use client";

/** Fredrun 2.0 – Client der globalen Bestenliste (Abruf, Einreichung, Sitzungs-Token). */
import { useCallback, useEffect, useRef, useState } from "react";

import { parseFredRun2BoardResponse, type FredRun2BoardResponse, type FredRun2Submission } from "@/lib/fredrun2-highscores";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

const ENDPOINT = "/api/fredrun2/highscores";

/** Token der App-Sitzung; auf der eigenständigen Seite (/fredrun2) aus der Supabase-Sitzung des Browsers. */
export function useAccessToken(initial: string): string {
  const [token, setToken] = useState("");
  useEffect(() => {
    if (initial) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    let alive = true;
    void client.auth.getSession().then(({ data }) => {
      if (alive) setToken(data.session?.access_token ?? "");
    });
    const { data } = client.auth.onAuthStateChange((_event, session) => setToken(session?.access_token ?? ""));
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, [initial]);
  return initial || token;
}

async function request(token: string, url: string, init: RequestInit = {}): Promise<FredRun2BoardResponse> {
  const res = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  const payload: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string" ? (payload as { error: string }).error : "";
    throw new Error(message || "Die Bestenliste konnte nicht geladen werden.");
  }
  const parsed = parseFredRun2BoardResponse(payload);
  if (!parsed) throw new Error("Die Bestenliste lieferte ein ungültiges Antwortformat.");
  return parsed;
}

export type BoardState =
  | { status: "idle" | "loading"; board: string }
  | { status: "error"; board: string; error: string }
  | { status: "ready"; board: string; data: FredRun2BoardResponse };

type BoardResult = { key: string; value: Extract<BoardState, { status: "error" | "ready" }> };

/** Lädt die globale Liste eines Boards (neu bei Board-/Token-Wechsel, `retry` und jedem Öffnen der Ansicht). Ohne Token: idle. */
export function useGlobalBoard(token: string, board: string, enabled: boolean): { state: BoardState; retry: () => void } {
  const [result, setResult] = useState<BoardResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${token}|${board}|${attempt}`;
  useEffect(() => {
    if (!token || !enabled) return;
    const controller = new AbortController();
    request(token, `${ENDPOINT}?board=${encodeURIComponent(board)}`, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key, value: { status: "ready", board, data } });
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) {
          setResult({ key, value: { status: "error", board, error: e instanceof Error ? e.message : "Die Bestenliste konnte nicht geladen werden." } });
        }
      });
    return () => controller.abort();
  }, [token, board, enabled, attempt, key]);
  const retry = useCallback(() => {
    setResult(null);
    setAttempt((n) => n + 1);
  }, []);
  const state: BoardState = !token || !enabled ? { status: "idle", board } : result?.key === key ? result.value : { status: "loading", board };
  return { state, retry };
}

export type SubmitState =
  | { status: "sending" }
  | { status: "done"; rank: number | null; score: number | null; submitted: boolean }
  | { status: "failed"; error: string };

/**
 * Reicht das Ergebnis eines Laufs genau einmal ein (Schlüssel = runId) und meldet den weltweiten Platz.
 * Ein Fehlversuch wird einmal wiederholt; die runId macht Wiederholungen serverseitig idempotent.
 * Die Einreichung läuft auch weiter, wenn der Spieler schon im Menü ist.
 */
export function useRunSubmission(token: string, submission: FredRun2Submission | null): SubmitState | null {
  const [state, setState] = useState<{ runId: string; value: SubmitState } | null>(null);
  const sent = useRef(new Set<string>());
  const mounted = useRef(true);
  const latest = useRef<FredRun2Submission | null>(submission);
  useEffect(() => {
    latest.current = submission;
  }, [submission]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const runId = submission?.runId ?? "";
  useEffect(() => {
    const sub = latest.current;
    if (!token || !runId || !sub || sent.current.has(runId)) return;
    sent.current.add(runId);
    const set = (value: SubmitState): void => {
      if (mounted.current) setState({ runId, value });
    };
    set({ status: "sending" });
    const attempt = (retriesLeft: number): void => {
      request(token, ENDPOINT, { method: "POST", body: JSON.stringify(sub) })
        .then((data) => set({ status: "done", rank: data.me?.rank ?? null, score: data.me?.score ?? null, submitted: data.submitted === true }))
        .catch((e: unknown) => {
          if (retriesLeft > 0 && mounted.current) window.setTimeout(() => attempt(retriesLeft - 1), 2500);
          else set({ status: "failed", error: e instanceof Error ? e.message : "Der Lauf konnte nicht eingereicht werden." });
        });
    };
    attempt(1);
  }, [token, runId]);
  return runId && state?.runId === runId ? state.value : null;
}
