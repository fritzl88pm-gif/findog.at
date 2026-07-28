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

  return (
    <section
      className="admin-feedback-panel"
      role="tabpanel"
      id="admin-panel-feedback"
      aria-labelledby="admin-tab-feedback"
    >
      <div className="form-generator-card admin-feedback-card">
        <div className="form-generator-heading admin-feedback-heading">
          <div>
            <h2>Negative Fred-Rückmeldungen</h2>
            <p>
              Gemeldete Antworten mit ursprünglicher Frage, Antworttext und Begründung.
            </p>
          </div>
          <button
            className="secondary-button compact-button"
            type="button"
            onClick={() => void loadFeedback()}
            disabled={isLoading}
          >
            {isLoading ? "Wird geladen …" : "Aktualisieren"}
          </button>
        </div>

        {error ? (
          <div className="error-box" role="alert">{error}</div>
        ) : null}
        {isLoading && entries.length === 0 ? (
          <p className="admin-empty-state">Rückmeldungen werden geladen …</p>
        ) : entries.length === 0 ? (
          <p className="admin-empty-state">Noch keine negativen Rückmeldungen vorhanden.</p>
        ) : (
          <ol className="admin-feedback-list">
            {entries.map((entry) => (
              <li key={entry.id}>
                <header>
                  <div>
                    <strong>{usersById.get(entry.userId) || "Unbekannter Benutzer"}</strong>
                    <small>Gespräch {entry.conversationId}</small>
                  </div>
                  <time dateTime={entry.createdAt}>{formattedDate(entry.createdAt)}</time>
                </header>
                <div className="admin-feedback-report">
                  <span>Rückmeldung</span>
                  <p>{entry.feedback}</p>
                </div>
                <details>
                  <summary>Frage und gemeldete Antwort anzeigen</summary>
                  <div className="admin-feedback-context">
                    <section>
                      <h3>Frage</h3>
                      <p>{entry.userRequest}</p>
                    </section>
                    <section>
                      <h3>Fred-Antwort</h3>
                      <p>{entry.assistantResponse}</p>
                    </section>
                  </div>
                </details>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
