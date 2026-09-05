"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type AdminUserOption = {
  id: string;
  email: string;
};

type AdminFeedbackEntry = {
  id: number;
  userId: string;
  conversationId: string;
  userRequest: string;
  assistantResponse: string;
  feedback: string;
  createdAt: string;
};

type AdminFeedbackViewProps = {
  accessToken: string;
  users: AdminUserOption[];
};

function normalizeFeedback(value: unknown): AdminFeedbackEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.id !== "number"
    || !Number.isSafeInteger(entry.id)
    || typeof entry.userId !== "string"
    || typeof entry.conversationId !== "string"
    || typeof entry.userRequest !== "string"
    || typeof entry.assistantResponse !== "string"
    || typeof entry.feedback !== "string"
    || typeof entry.createdAt !== "string"
  ) {
    return null;
  }
  return {
    id: entry.id,
    userId: entry.userId,
    conversationId: entry.conversationId,
    userRequest: entry.userRequest,
    assistantResponse: entry.assistantResponse,
    feedback: entry.feedback,
    createdAt: entry.createdAt,
  };
}

function formattedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unbekannter Zeitpunkt";
  return new Intl.DateTimeFormat("de-AT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function AdminFeedbackView({
  accessToken,
  users,
}: AdminFeedbackViewProps) {
  const [entries, setEntries] = useState<AdminFeedbackEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const usersById = useMemo(
    () => new Map(users.map((user) => [user.id, user.email])),
    [users],
  );

  const loadFeedback = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/feedback", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Authorization: `Bearer ${accessToken}` },
        signal,
      });
      const payload = await response.json().catch(() => null) as unknown;
      if (
        !response.ok
        || !payload
        || typeof payload !== "object"
        || Array.isArray(payload)
        || !Array.isArray((payload as Record<string, unknown>).feedback)
      ) {
        const message = payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>).error
          : null;
        throw new Error(
          typeof message === "string" ? message : "Rückmeldungen konnten nicht geladen werden.",
        );
      }
      const rawEntries = (payload as Record<string, unknown>).feedback as unknown[];
      const normalized = rawEntries.flatMap((entry) => {
        const parsed = normalizeFeedback(entry);
        return parsed ? [parsed] : [];
      });
      if (normalized.length !== rawEntries.length) {
        throw new Error("Die geladenen Rückmeldungen sind ungültig.");
      }
      setEntries(normalized);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Rückmeldungen konnten nicht geladen werden.",
      );
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    const controller = new AbortController();
    const loadFrame = window.requestAnimationFrame(() => void loadFeedback(controller.signal));
    return () => {
      window.cancelAnimationFrame(loadFrame);
      controller.abort();
    };
  }, [loadFeedback]);

  const filtered = entries.filter((entry) => (!userFilter || entry.userId === userFilter)
    && [entry.feedback, entry.userRequest, usersById.get(entry.userId) ?? ""].join(" ").toLocaleLowerCase("de-AT").includes(query.toLocaleLowerCase("de-AT")));
  const selected = filtered.find((entry) => entry.id === selectedId) ?? filtered[0];
  return (
    <section className="admin-feedback-panel" id="admin-panel-feedback" aria-labelledby="admin-feedback-title">
      <div className="admin-section-toolbar">
        <div><h2 id="admin-feedback-title">Negative Fred-Rückmeldungen</h2><p>{entries.length} Rückmeldungen · Frage, Antwort und Begründung im Zusammenhang prüfen.</p></div>
        <button className="secondary-button compact-button" type="button" onClick={() => void loadFeedback()} disabled={isLoading}>{isLoading ? "Wird geladen …" : "Aktualisieren"}</button>
      </div>
      {error ? <div className="error-box" role="alert">{error}</div> : null}
      <div className="admin-feedback-filters">
        <label className="admin-search-field">Rückmeldungen suchen<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Frage oder Rückmeldung …" /></label>
        <label className="admin-search-field">Benutzer<select value={userFilter} onChange={(event) => setUserFilter(event.target.value)}><option value="">Alle Benutzer</option>{users.map((user) => <option key={user.id} value={user.id}>{user.email}</option>)}</select></label>
      </div>
      {isLoading && entries.length === 0 ? <p className="admin-empty-state" role="status">Rückmeldungen werden geladen …</p> : !filtered.length ? <p className="admin-empty-state">{entries.length ? "Keine Rückmeldungen für diese Auswahl gefunden." : "Noch keine negativen Rückmeldungen vorhanden."}</p> : (
        <div className="admin-feedback-layout">
          <ol className="admin-feedback-inbox" aria-label="Rückmeldungen auswählen">
            {filtered.map((entry) => <li key={entry.id}><button type="button" aria-pressed={selected.id === entry.id} onClick={() => setSelectedId(entry.id)}>
              <strong>{usersById.get(entry.userId) || "Unbekannter Benutzer"}</strong>
              <time dateTime={entry.createdAt}>{formattedDate(entry.createdAt)}</time>
              <span>{entry.feedback}</span>
            </button></li>)}
          </ol>
          <article className="admin-feedback-detail" aria-label="Ausgewählte Rückmeldung">
            <header><h3>{usersById.get(selected.userId) || "Unbekannter Benutzer"}</h3><time dateTime={selected.createdAt}>{formattedDate(selected.createdAt)}</time><small>Gespräch {selected.conversationId}</small></header>
            <section className="admin-feedback-report"><h3>Rückmeldung</h3><p>{selected.feedback}</p></section>
            <section><h3>Frage</h3><p>{selected.userRequest}</p></section>
            <section><h3>Fred-Antwort</h3><p>{selected.assistantResponse}</p></section>
          </article>
        </div>
      )}
    </section>
  );
}
