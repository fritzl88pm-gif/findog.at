"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

type Personality = {
  id: string;
  title: string;
  promptText: string;
  isBuiltin: boolean;
};

// ── Normalizers ────────────────────────────────────────────────────────────

function normalizePersonality(item: unknown): Personality | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const entry = item as Record<string, unknown>;
  if (
    typeof entry.id !== "string" ||
    typeof entry.title !== "string" ||
    typeof entry.promptText !== "string" ||
    typeof entry.isBuiltin !== "boolean"
  ) {
    return null;
  }
  return {
    id: entry.id,
    title: entry.title,
    promptText: entry.promptText,
    isBuiltin: entry.isBuiltin,
  };
}

function normalizePersonalities(value: unknown): Personality[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const payload = value as Record<string, unknown>;
  if (!Array.isArray(payload.personalities)) return [];
  return payload.personalities.flatMap((item: unknown) => {
    const p = normalizePersonality(item);
    return p ? [p] : [];
  });
}

// ── Component ──────────────────────────────────────────────────────────────

export default function AdminFredPersonalities({
  accessToken,
}: {
  accessToken: string;
}) {
  const [personalities, setPersonalities] = useState<Personality[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // Form state for create/edit
  const [formTitle, setFormTitle] = useState("");
  const [formPromptText, setFormPromptText] = useState("");

  const mountedRef = useRef(true);
  const requestSequenceRef = useRef(0);
  const controllersRef = useRef(new Set<AbortController>());

  const clearFeedback = useCallback(() => {
    setError("");
    setNotice("");
  }, []);

  // ── Load ─────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!accessToken) {
      setIsLoading(false);
      return;
    }

    const sequence = ++requestSequenceRef.current;
    const controller = new AbortController();
    controllersRef.current.add(controller);

    if (mountedRef.current) {
      setIsLoading(true);
      setError("");
    }

    try {
      const response = await fetch("/api/admin/fred-personalities", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
        signal: controller.signal,
      });

      if (!mountedRef.current || controller.signal.aborted || sequence !== requestSequenceRef.current) {
        return;
      }

      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "Persönlichkeitsprofile konnten nicht geladen werden.");
        return;
      }

      const list = normalizePersonalities(payload);

      setPersonalities(list);
      setSelectedId(null);
      setIsCreating(false);
      setFormTitle("");
      setFormPromptText("");
    } catch {
      if (mountedRef.current && !controller.signal.aborted && sequence === requestSequenceRef.current) {
        setError("Persönlichkeitsprofile konnten nicht geladen werden.");
      }
    } finally {
      controllersRef.current.delete(controller);
      if (mountedRef.current && sequence === requestSequenceRef.current) {
        setIsLoading(false);
      }
    }
  }, [accessToken]);

  // ── Lifecycle ────────────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    const controllers = controllersRef.current;
    return () => {
      mountedRef.current = false;
      requestSequenceRef.current += 1;
      for (const ctrl of controllers) ctrl.abort();
      controllers.clear();
    };
  }, [accessToken]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  // ── Select ───────────────────────────────────────────────────────────────

  const selectPersonality = useCallback(
    (id: string) => {
      const p = personalities.find((p) => p.id === id);
      if (!p) return;
      setSelectedId(id);
      setIsCreating(false);
      setFormTitle(p.title);
      setFormPromptText(p.promptText);
      clearFeedback();
    },
    [personalities, clearFeedback],
  );

  // ── Start create ─────────────────────────────────────────────────────────

  const startCreate = useCallback(() => {
    setSelectedId(null);
    setIsCreating(true);
    setFormTitle("");
    setFormPromptText("");
    clearFeedback();
  }, [clearFeedback]);

  // ── Save (PUT) ───────────────────────────────────────────────────────────

  const handleEditSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!accessToken || !selectedId) return;

      const controller = new AbortController();
      controllersRef.current.add(controller);
      setIsSaving(true);
      clearFeedback();

      try {
        const response = await fetch("/api/admin/fred-personalities", {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ id: selectedId, title: formTitle, promptText: formPromptText }),
          signal: controller.signal,
        });

        if (!mountedRef.current || controller.signal.aborted) return;

        const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

        if (!response.ok) {
          setError(typeof payload.error === "string" ? payload.error : "Personalisierung konnte nicht gespeichert werden.");
          return;
        }

        const saved = normalizePersonality(payload.personality);
        if (!saved) {
          setError("Personalisierung konnte nicht gespeichert werden.");
          return;
        }

        setPersonalities((prev) =>
          prev.map((p) => (p.id === saved.id ? saved : p)),
        );
        setSelectedId(saved.id);
        setFormTitle(saved.title);
        setFormPromptText(saved.promptText);
        setNotice("Persönlichkeitsprofil gespeichert.");
      } catch {
        if (mountedRef.current && !controller.signal.aborted) {
          setError("Personalisierung konnte nicht gespeichert werden.");
        }
      } finally {
        controllersRef.current.delete(controller);
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [accessToken, selectedId, formTitle, formPromptText, clearFeedback],
  );

  // ── Create (POST) ────────────────────────────────────────────────────────

  const handleCreateSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!accessToken) return;

      const controller = new AbortController();
      controllersRef.current.add(controller);
      setIsSaving(true);
      clearFeedback();

      try {
        const response = await fetch("/api/admin/fred-personalities", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: formTitle, promptText: formPromptText }),
          signal: controller.signal,
        });

        if (!mountedRef.current || controller.signal.aborted) return;

        const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

        if (!response.ok) {
          setError(typeof payload.error === "string" ? payload.error : "Personalisierung konnte nicht gespeichert werden.");
          return;
        }

        const created = normalizePersonality(payload.personality);
        if (!created) {
          setError("Personalisierung konnte nicht gespeichert werden.");
          return;
        }

        setPersonalities((prev) => [...prev, created]);
        setSelectedId(created.id);
        setIsCreating(false);
        setFormTitle(created.title);
        setFormPromptText(created.promptText);
        setNotice("Persönlichkeitsprofil angelegt.");
      } catch {
        if (mountedRef.current && !controller.signal.aborted) {
          setError("Personalisierung konnte nicht gespeichert werden.");
        }
      } finally {
        controllersRef.current.delete(controller);
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [accessToken, formTitle, formPromptText, clearFeedback],
  );

  // ── Render ───────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <section
        className="admin-personality-section"
        role="tabpanel"
        id="admin-panel-personalities"
        aria-labelledby="admin-tab-personalities"
      >
        <p className="field-help">Persönlichkeitsprofile werden geladen…</p>
      </section>
    );
  }

  return (
    <section
      className="admin-personality-section"
      role="tabpanel"
      id="admin-panel-personalities"
      aria-labelledby="admin-tab-personalities"
    >
      {error ? (
        <div className="error-box" role="alert" aria-live="polite">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="notice-box" role="status" aria-live="polite">
          {notice}
        </div>
      ) : null}

      <button
        className="primary-button admin-personality-create-button"
        type="button"
        onClick={startCreate}
        disabled={isSaving}
      >
        Neue Persönlichkeit
      </button>

      <ul className="admin-personality-list">
        {personalities.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className={selectedId === p.id && !isCreating ? "active" : undefined}
              onClick={() => selectPersonality(p.id)}
              disabled={isSaving}
            >
              <strong>{p.title}</strong>
            </button>
          </li>
        ))}
      </ul>

      {(selectedId || isCreating) ? (
        <form
          className="form-generator-card admin-personality-form"
          onSubmit={isCreating ? handleCreateSubmit : handleEditSubmit}
        >
          <div className="field-group">
            <label htmlFor="admin-personality-title">Titel</label>
            <input
              id="admin-personality-title"
              type="text"
              maxLength={80}
              value={formTitle}
              onChange={(event) => {
                setFormTitle(event.target.value);
                clearFeedback();
              }}
              disabled={isSaving}
              required
            />
          </div>

          <div className="field-group">
            <label htmlFor="admin-personality-prompt">Textblock</label>
            <textarea
              id="admin-personality-prompt"
              maxLength={4000}
              value={formPromptText}
              onChange={(event) => {
                setFormPromptText(event.target.value);
                clearFeedback();
              }}
              rows={12}
              disabled={isSaving}
            />
          </div>

          <div className="admin-model-actions">
            <button
              className="primary-button"
              type="submit"
              disabled={isSaving || !formTitle.trim()}
            >
              {isSaving
                ? "Wird gespeichert…"
                : isCreating
                  ? "Persönlichkeit anlegen"
                  : "Änderungen speichern"}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
