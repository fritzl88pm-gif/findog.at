"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  getChildCategoryIds,
  MAX_REASONING_CATEGORY_NAME_CHARS,
  MAX_REASONING_CONTENT_CHARS,
  MAX_REASONING_TITLE_CHARS,
  orderReasoningCategories,
  reasoningCategoryLabel,
} from "@/lib/reasonings";
import CopyIconButton from "@/components/copy-icon-button";

type ReasoningCategory = {
  id: string;
  name: string;
  parentId: string | null;
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
          parentId: typeof row.parentId === "string" ? row.parentId : null,
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
  const [newCategoryParentId, setNewCategoryParentId] = useState("");
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
            : "Textbausteine konnten nicht geladen werden.",
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
        : "Textbausteine konnten nicht geladen werden.");
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
  const childIdsByParent = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const category of categories) {
      if (category.parentId) {
        const list = map.get(category.parentId) ?? [];
        list.push(category.id);
        map.set(category.parentId, list);
      }
    }
    return map;
  }, [categories]);

  const topLevelCategories = useMemo(
    () => categories.filter((category) => !category.parentId),
    [categories],
  );

  const orderedCategories = useMemo(
    () => orderReasoningCategories(categories),
    [categories],
  );

  const visibleReasonings = useMemo(
    () => activeCategoryId
      ? reasonings.filter((reasoning) => {
          const allowedIds = getChildCategoryIds(activeCategoryId, childIdsByParent);
          return reasoning.categoryIds.some((id) => allowedIds.includes(id));
        })
      : reasonings,
    [activeCategoryId, reasonings, childIdsByParent],
  );

  function categoryDisplayName(category: ReasoningCategory): string {
    return reasoningCategoryLabel(category, categories);
  }

  function reasoningCountForCategory(categoryId: string): number {
    const categoryIds = getChildCategoryIds(categoryId, childIdsByParent);
    return reasonings.filter((reasoning) =>
      reasoning.categoryIds.some((id) => categoryIds.includes(id))
    ).length;
  }

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
            : "Textbaustein konnte nicht gespeichert werden.",
        );
      }
      const wasEditing = Boolean(editor.id);
      setEditor(null);
      await loadReasonings();
      setNotice(wasEditing ? "Textbaustein wurde gespeichert." : "Textbaustein wurde angelegt.");
    } catch (saveError) {
      setError(saveError instanceof Error
        ? saveError.message
        : "Textbaustein konnte nicht gespeichert werden.");
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
            : "Textbaustein konnte nicht gelöscht werden.",
        );
      }
      if (editor?.id === reasoning.id) setEditor(null);
      await loadReasonings();
      setNotice("Textbaustein wurde gelöscht.");
    } catch (deleteError) {
      setError(deleteError instanceof Error
        ? deleteError.message
        : "Textbaustein konnte nicht gelöscht werden.");
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
      const body: Record<string, unknown> = { name: newCategoryName };
      if (newCategoryParentId) {
        body.parentId = newCategoryParentId;
      }
      const response = await fetch("/api/reasoning-categories", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
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
      setNewCategoryParentId("");
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
        `Kategorie „${category.name}“ wirklich löschen? Die Textbausteine selbst bleiben erhalten.`,
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
      setNotice("Kategorie wurde gelöscht. Die Textbausteine bleiben erhalten.");
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
            <h1 id="reasonings-view-title">Textbausteine</h1>
            <p>
              Lege wiederverwendbare Textbausteine an und ordne sie einer oder mehreren
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
              Neuer Textbaustein
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
                <p>Gelöschte Kategorien entfernen nur die Zuordnung, nicht den Textbaustein.</p>
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
              </div>
              <label htmlFor="new-reasoning-category-parent">Unterkategorie von</label>
              <div>
                <select
                  id="new-reasoning-category-parent"
                  value={newCategoryParentId}
                  onChange={(event) => setNewCategoryParentId(event.target.value)}
                  disabled={isSaving || topLevelCategories.length === 0}
                >
                  <option value="">-- Keine (oberste Ebene) --</option>
                  {topLevelCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
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
                {orderedCategories.map((category) => (
                  <li key={category.id} className={category.parentId ? "is-subcategory" : ""}>
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
                          <strong>{categoryDisplayName(category)}</strong>
                          <small>
                            {reasoningCountForCategory(category.id)} Textbausteine
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
                <h2>{editor.id ? "Textbaustein bearbeiten" : "Neuer Textbaustein"}</h2>
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
            <label htmlFor="reasoning-content">Textbaustein</label>
            <textarea
              id="reasoning-content"
              value={editor.content}
              onChange={(event) =>
                setEditor((current) => current ? { ...current, content: event.target.value } : current)
              }
              maxLength={MAX_REASONING_CONTENT_CHARS}
              rows={12}
              placeholder="Formuliere hier deinen Textbaustein …"
              disabled={isSaving}
              required
            />
            <fieldset className="reasoning-category-options">
              <legend>Kategorien</legend>
              {categories.length > 0 ? (
                <div>
                  {orderedCategories.map((category) => (
                    <label key={category.id} className={category.parentId ? "subcategory-label" : ""}>
                      <input
                        type="checkbox"
                        checked={editor.categoryIds.includes(category.id)}
                        onChange={() => toggleEditorCategory(category.id)}
                        disabled={isSaving}
                      />
                      <span>{categoryDisplayName(category)}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <p>Noch keine Kategorien vorhanden. Du kannst den Textbaustein auch ohne Kategorie speichern.</p>
              )}
            </fieldset>
            <div className="reasoning-editor-actions">
              <button className="primary-button" type="submit" disabled={isSaving}>
                {isSaving ? "Wird gespeichert …" : "Textbaustein speichern"}
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
              <h2 id="reasoning-library-title">Meine Textbausteine</h2>
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
              {orderedCategories.map((category) => (
                <button
                  className={activeCategoryId === category.id ? "active" : ""}
                  type="button"
                  key={category.id}
                  onClick={() => setActiveCategoryId(category.id)}
                  aria-pressed={activeCategoryId === category.id}
                >
                  {categoryDisplayName(category)}
                </button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <p className="reasonings-empty-state" role="status">Textbausteine werden geladen …</p>
          ) : visibleReasonings.length === 0 ? (
            <div className="reasonings-empty-state">
              <h3>{reasonings.length === 0 ? "Noch keine Textbausteine" : "Keine Treffer"}</h3>
              <p>
                {reasonings.length === 0
                  ? "Lege deinen ersten Textbaustein als persönliche Karte an."
                  : "In dieser Kategorie ist noch kein Textbaustein gespeichert."}
              </p>
              {reasonings.length === 0 ? (
                <button className="primary-button" type="button" onClick={openNewEditor}>
                  Ersten Textbaustein anlegen
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
                      <CopyIconButton
                        className="reasoning-copy-button"
                        text={reasoning.content}
                        label={`Textbaustein „${reasoning.title}“ kopieren`}
                      />
                      <button
                        className="reasoning-card-icon-button"
                        type="button"
                        onClick={() => openEditEditor(reasoning)}
                        disabled={isSaving}
                        aria-label={`Textbaustein „${reasoning.title}“ bearbeiten`}
                        title="Textbaustein bearbeiten"
                      >
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.9"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="m4 20 4.4-1 9.8-9.8-3.4-3.4L5 15.6 4 20Z" />
                          <path d="m13.8 6.8 3.4 3.4M14.8 5.8l1.4-1.4a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8l-1.4 1.4" />
                        </svg>
                      </button>
                      <button
                        className="reasoning-card-icon-button is-danger"
                        type="button"
                        onClick={() => void deleteReasoning(reasoning)}
                        disabled={isSaving}
                        aria-label={`Textbaustein „${reasoning.title}“ löschen`}
                        title="Textbaustein löschen"
                      >
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.9"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M4 7h16" />
                          <path d="M9 7V4h6v3" />
                          <path d="m6 7 1 13h10l1-13" />
                          <path d="M10 11v5M14 11v5" />
                        </svg>
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
