"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  MAX_REASONING_CATEGORY_NAME_CHARS,
  MAX_REASONING_CONTENT_CHARS,
  MAX_REASONING_TITLE_CHARS,
} from "@/lib/reasonings";

type ReasoningCategory = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

type ReasoningCard = {
  id: string;
  title: string;
  content: string;
  categoryIds: string[];
  createdAt: string;
  updatedAt: string;
};

type EditorState = {
  id: string | null;
  title: string;
  content: string;
  categoryIds: string[];
};

type ReasoningsViewProps = {
  accessToken: string;
};

const EMPTY_EDITOR: EditorState = {
  id: null,
  title: "",
  content: "",
  categoryIds: [],
};

function normalizePayload(value: unknown): {
  categories: ReasoningCategory[];
  reasonings: ReasoningCard[];
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { categories: [], reasonings: [] };
  }
  const payload = value as Record<string, unknown>;
  const categories = Array.isArray(payload.categories)
    ? payload.categories.flatMap((candidate): ReasoningCategory[] => {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
        const row = candidate as Record<string, unknown>;
        if (typeof row.id !== "string" || typeof row.name !== "string") return [];
        return [{
          id: row.id,
          name: row.name,
          createdAt: typeof row.createdAt === "string" ? row.createdAt : "",
          updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
        }];
      })
    : [];
  const reasonings = Array.isArray(payload.reasonings)
    ? payload.reasonings.flatMap((candidate): ReasoningCard[] => {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
        const row = candidate as Record<string, unknown>;
        if (
          typeof row.id !== "string"
          || typeof row.title !== "string"
          || typeof row.content !== "string"
        ) return [];
        return [{
          id: row.id,
          title: row.title,
          content: row.content,
          categoryIds: Array.isArray(row.categoryIds)
            ? row.categoryIds.filter((id): id is string => typeof id === "string")
            : [],
          createdAt: typeof row.createdAt === "string" ? row.createdAt : "",
          updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
        }];
      })
    : [];
  return { categories, reasonings };
}

async function responsePayload(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => ({}));
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("de-AT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function ReasoningsView({ accessToken }: ReasoningsViewProps) {
  const [categories, setCategories] = useState<ReasoningCategory[]>([]);
  const [reasonings, setReasonings] = useState<ReasoningCard[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [isCategoriesOpen, setIsCategoriesOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState("");
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadReasonings = useCallback(async () => {
    if (!accessToken) {
      setError("Deine Anmeldung ist abgelaufen. Bitte erneut anmelden.");
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetch("/api/reasonings", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "Begründungen konnten nicht geladen werden.",
        );
      }
      const normalized = normalizePayload(payload);
      setCategories(normalized.categories);
      setReasonings(normalized.reasonings);
      setActiveCategoryId((current) =>
        current && !normalized.categories.some((category) => category.id === current)
          ? ""
          : current
      );
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error
        ? loadError.message
        : "Begründungen konnten nicht geladen werden.");
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void loadReasonings(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadReasonings]);

  const categoriesById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );
  const visibleReasonings = useMemo(
    () => activeCategoryId
      ? reasonings.filter((reasoning) => reasoning.categoryIds.includes(activeCategoryId))
      : reasonings,
    [activeCategoryId, reasonings],
  );

  function openNewEditor() {
    setEditor({ ...EMPTY_EDITOR, categoryIds: activeCategoryId ? [activeCategoryId] : [] });
    setNotice("");
    setError("");
  }

  function openEditEditor(reasoning: ReasoningCard) {
    setEditor({
      id: reasoning.id,
      title: reasoning.title,
      content: reasoning.content,
      categoryIds: [...reasoning.categoryIds],
    });
    setNotice("");
    setError("");
  }

  function toggleEditorCategory(categoryId: string) {
    setEditor((current) => {
      if (!current) return current;
      return {
        ...current,
        categoryIds: current.categoryIds.includes(categoryId)
          ? current.categoryIds.filter((id) => id !== categoryId)
          : [...current.categoryIds, categoryId],
      };
    });
  }

  async function saveReasoning(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || isSaving) return;
    setIsSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        editor.id ? `/api/reasonings/${encodeURIComponent(editor.id)}` : "/api/reasonings",
        {
          method: editor.id ? "PATCH" : "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: editor.title,
            content: editor.content,
            categoryIds: editor.categoryIds,
          }),
        },
      );
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "Begründung konnte nicht gespeichert werden.",
        );
      }
      const wasEditing = Boolean(editor.id);
      setEditor(null);
      await loadReasonings();
      setNotice(wasEditing ? "Begründung wurde gespeichert." : "Begründung wurde angelegt.");
    } catch (saveError) {
      setError(saveError instanceof Error
        ? saveError.message
        : "Begründung konnte nicht gespeichert werden.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteReasoning(reasoning: ReasoningCard) {
    if (
      !window.confirm(`„${reasoning.title}“ wirklich löschen?`)
      || isSaving
    ) return;
    setIsSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/reasonings/${encodeURIComponent(reasoning.id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "Begründung konnte nicht gelöscht werden.",
        );
      }
      if (editor?.id === reasoning.id) setEditor(null);
      await loadReasonings();
      setNotice("Begründung wurde gelöscht.");
    } catch (deleteError) {
      setError(deleteError instanceof Error
        ? deleteError.message
        : "Begründung konnte nicht gelöscht werden.");
    } finally {
      setIsSaving(false);
    }
  }

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/reasoning-categories", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: newCategoryName }),
      });
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "Kategorie konnte nicht angelegt werden.",
        );
      }
      setNewCategoryName("");
      await loadReasonings();
      setNotice("Kategorie wurde angelegt.");
    } catch (categoryError) {
      setError(categoryError instanceof Error
        ? categoryError.message
        : "Kategorie konnte nicht angelegt werden.");
    } finally {
      setIsSaving(false);
    }
  }

  async function renameCategory(event: FormEvent<HTMLFormElement>, categoryId: string) {
    event.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/reasoning-categories/${encodeURIComponent(categoryId)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: editingCategoryName }),
        },
      );
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "Kategorie konnte nicht umbenannt werden.",
        );
      }
      setEditingCategoryId("");
      setEditingCategoryName("");
      await loadReasonings();
      setNotice("Kategorie wurde umbenannt.");
    } catch (categoryError) {
      setError(categoryError instanceof Error
        ? categoryError.message
        : "Kategorie konnte nicht umbenannt werden.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteCategory(category: ReasoningCategory) {
    if (
      !window.confirm(
        `Kategorie „${category.name}“ wirklich löschen? Die Begründungen selbst bleiben erhalten.`,
      )
      || isSaving
    ) return;
    setIsSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/reasoning-categories/${encodeURIComponent(category.id)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "Kategorie konnte nicht gelöscht werden.",
        );
      }
      setEditor((current) => current ? {
        ...current,
        categoryIds: current.categoryIds.filter((id) => id !== category.id),
      } : current);
      if (activeCategoryId === category.id) setActiveCategoryId("");
      if (editingCategoryId === category.id) setEditingCategoryId("");
      await loadReasonings();
      setNotice("Kategorie wurde gelöscht. Die Begründungen bleiben erhalten.");
    } catch (categoryError) {
      setError(categoryError instanceof Error
        ? categoryError.message
        : "Kategorie konnte nicht gelöscht werden.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="forms-panel reasonings-panel" aria-labelledby="reasonings-view-title">
      <div className="reasonings-view">
        <header className="reasonings-header">
          <div>
            <p className="eyebrow">Persönliche Textsammlung</p>
            <h1 id="reasonings-view-title">Begründungen</h1>
            <p>
              Lege wiederverwendbare Begründungstexte an und ordne sie einer oder mehreren
              Kategorien zu.
            </p>
          </div>
          <div className="reasonings-header-actions">
            <button
              className="secondary-button"
              type="button"
              aria-expanded={isCategoriesOpen}
              aria-controls="reasoning-category-manager"
              onClick={() => setIsCategoriesOpen((open) => !open)}
            >
              Kategorien
            </button>
            <button className="primary-button" type="button" onClick={openNewEditor}>
              Neue Begründung
            </button>
          </div>
        </header>

        {error ? <div className="error-box" role="alert">{error}</div> : null}
        {notice ? <div className="reasonings-notice" role="status">{notice}</div> : null}

        {isCategoriesOpen ? (
          <section
            className="reasoning-category-manager"
            id="reasoning-category-manager"
            aria-labelledby="reasoning-category-manager-title"
          >
            <div className="reasoning-section-heading">
              <div>
                <h2 id="reasoning-category-manager-title">Kategorien verwalten</h2>
                <p>Gelöschte Kategorien entfernen nur die Zuordnung, nicht die Begründung.</p>
              </div>
            </div>
            <form className="reasoning-category-create" onSubmit={createCategory}>
              <label htmlFor="new-reasoning-category">Neue Kategorie</label>
              <div>
                <input
                  id="new-reasoning-category"
                  value={newCategoryName}
                  onChange={(event) => setNewCategoryName(event.target.value)}
                  maxLength={MAX_REASONING_CATEGORY_NAME_CHARS}
                  placeholder="z. B. Betriebsausgaben"
                  disabled={isSaving}
                  required
                />
                <button
                  className="primary-button compact-button"
                  type="submit"
                  disabled={isSaving || !newCategoryName.trim()}
                >
                  Anlegen
                </button>
              </div>
            </form>
            {categories.length > 0 ? (
              <ul className="reasoning-category-list">
                {categories.map((category) => (
                  <li key={category.id}>
                    {editingCategoryId === category.id ? (
                      <form onSubmit={(event) => void renameCategory(event, category.id)}>
                        <input
                          aria-label={`Neuer Name für ${category.name}`}
                          value={editingCategoryName}
                          onChange={(event) => setEditingCategoryName(event.target.value)}
                          maxLength={MAX_REASONING_CATEGORY_NAME_CHARS}
                          disabled={isSaving}
                          autoFocus
                          required
                        />
                        <button
                          className="secondary-button compact-button"
                          type="submit"
                          disabled={isSaving || !editingCategoryName.trim()}
                        >
                          Speichern
                        </button>
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => setEditingCategoryId("")}
                        >
                          Abbrechen
                        </button>
                      </form>
                    ) : (
                      <>
                        <span>
                          <strong>{category.name}</strong>
                          <small>
                            {reasonings.filter((reasoning) =>
                              reasoning.categoryIds.includes(category.id)
                            ).length} Begründungen
                          </small>
                        </span>
                        <span className="reasoning-category-actions">
                          <button
                            className="text-button"
                            type="button"
                            onClick={() => {
                              setEditingCategoryId(category.id);
                              setEditingCategoryName(category.name);
                            }}
                            disabled={isSaving}
                          >
                            Umbenennen
                          </button>
                          <button
                            className="text-button danger-text-button"
                            type="button"
                            onClick={() => void deleteCategory(category)}
                            disabled={isSaving}
                          >
                            Löschen
                          </button>
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="reasonings-empty-inline">Noch keine Kategorien angelegt.</p>
            )}
          </section>
        ) : null}

        {editor ? (
          <form className="reasoning-editor" onSubmit={saveReasoning}>
            <div className="reasoning-section-heading">
              <div>
                <p className="eyebrow">{editor.id ? "Bearbeiten" : "Neu anlegen"}</p>
                <h2>{editor.id ? "Begründung bearbeiten" : "Neue Begründung"}</h2>
              </div>
              <button className="text-button" type="button" onClick={() => setEditor(null)}>
                Schließen
              </button>
            </div>
            <label htmlFor="reasoning-title">Titel</label>
            <input
              id="reasoning-title"
              value={editor.title}
              onChange={(event) =>
                setEditor((current) => current ? { ...current, title: event.target.value } : current)
              }
              maxLength={MAX_REASONING_TITLE_CHARS}
              placeholder="Kurzer, eindeutiger Titel"
              disabled={isSaving}
              required
            />
            <label htmlFor="reasoning-content">Begründungstext</label>
            <textarea
              id="reasoning-content"
              value={editor.content}
              onChange={(event) =>
                setEditor((current) => current ? { ...current, content: event.target.value } : current)
              }
              maxLength={MAX_REASONING_CONTENT_CHARS}
              rows={12}
              placeholder="Formuliere hier deine Begründung …"
              disabled={isSaving}
              required
            />
            <fieldset className="reasoning-category-options">
              <legend>Kategorien</legend>
              {categories.length > 0 ? (
                <div>
                  {categories.map((category) => (
                    <label key={category.id}>
                      <input
                        type="checkbox"
                        checked={editor.categoryIds.includes(category.id)}
                        onChange={() => toggleEditorCategory(category.id)}
                        disabled={isSaving}
                      />
                      <span>{category.name}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <p>Noch keine Kategorien vorhanden. Du kannst die Begründung auch ohne Kategorie speichern.</p>
              )}
            </fieldset>
            <div className="reasoning-editor-actions">
              <button className="primary-button" type="submit" disabled={isSaving}>
                {isSaving ? "Wird gespeichert …" : "Begründung speichern"}
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setEditor(null)}
                disabled={isSaving}
              >
                Abbrechen
              </button>
            </div>
          </form>
        ) : null}

        <section className="reasoning-library" aria-labelledby="reasoning-library-title">
          <div className="reasoning-library-toolbar">
            <div>
              <h2 id="reasoning-library-title">Meine Begründungen</h2>
              <p>
                {visibleReasonings.length} von {reasonings.length} angezeigt
              </p>
            </div>
            <div className="reasoning-category-filters" aria-label="Nach Kategorie filtern">
              <button
                className={activeCategoryId === "" ? "active" : ""}
                type="button"
                onClick={() => setActiveCategoryId("")}
                aria-pressed={activeCategoryId === ""}
              >
                Alle
              </button>
              {categories.map((category) => (
                <button
                  className={activeCategoryId === category.id ? "active" : ""}
                  type="button"
                  key={category.id}
                  onClick={() => setActiveCategoryId(category.id)}
                  aria-pressed={activeCategoryId === category.id}
                >
                  {category.name}
                </button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <p className="reasonings-empty-state" role="status">Begründungen werden geladen …</p>
          ) : visibleReasonings.length === 0 ? (
            <div className="reasonings-empty-state">
              <h3>{reasonings.length === 0 ? "Noch keine Begründungen" : "Keine Treffer"}</h3>
              <p>
                {reasonings.length === 0
                  ? "Lege deine erste Begründung als persönliche Karte an."
                  : "In dieser Kategorie ist noch keine Begründung gespeichert."}
              </p>
              {reasonings.length === 0 ? (
                <button className="primary-button" type="button" onClick={openNewEditor}>
                  Erste Begründung anlegen
                </button>
              ) : null}
            </div>
          ) : (
            <div className="reasoning-card-grid">
              {visibleReasonings.map((reasoning) => (
                <article className="reasoning-card" key={reasoning.id}>
                  <div className="reasoning-card-heading">
                    <h3>{reasoning.title}</h3>
                    <div className="reasoning-card-actions">
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => openEditEditor(reasoning)}
                        disabled={isSaving}
                      >
                        Bearbeiten
                      </button>
                      <button
                        className="text-button danger-text-button"
                        type="button"
                        onClick={() => void deleteReasoning(reasoning)}
                        disabled={isSaving}
                      >
                        Löschen
                      </button>
                    </div>
                  </div>
                  <p className="reasoning-card-content">{reasoning.content}</p>
                  <footer>
                    <div className="reasoning-card-categories">
                      {reasoning.categoryIds.flatMap((categoryId) => {
                        const category = categoriesById.get(categoryId);
                        return category ? <span key={category.id}>{category.name}</span> : [];
                      })}
                    </div>
                    <small>
                      {reasoning.updatedAt
                        ? `Aktualisiert ${formatUpdatedAt(reasoning.updatedAt)}`
                        : ""}
                    </small>
                  </footer>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
