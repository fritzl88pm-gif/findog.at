"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getChildCategoryIds,
  MAX_REASONING_CATEGORY_NAME_CHARS,
  MAX_REASONING_CONTENT_CHARS,
  MAX_REASONING_TITLE_CHARS,
  orderReasoningCategories,
  reasoningCategoryLabel,
} from "@/lib/reasonings";
import {
  filterAndSortReasonings,
  type ReasoningLibraryItem,
  type ReasoningSortBy,
} from "@/lib/reasonings-library";
import CopyIconButton from "@/components/copy-icon-button";

type ReasoningCategory = {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
};

type ReasoningCard = ReasoningLibraryItem;

type EditorState = {
  id: string | null;
  title: string;
  content: string;
  categoryIds: string[];
};

type ReasoningsViewProps = {
  accessToken: string;
};

const REASONINGS_TITLE_VIEW_STORAGE_KEY = "findog_reasonings_title_view_enabled";

function getTitleOnlyStoredPreference(): boolean {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return false;
    }
    return window.localStorage.getItem(REASONINGS_TITLE_VIEW_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function persistTitleOnlyPreference(value: boolean): void {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(REASONINGS_TITLE_VIEW_STORAGE_KEY, String(value));
    }
  } catch {
    // Storage can be unavailable in private browsing or restricted environments.
  }
}

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
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<ReasoningSortBy>("updated");
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
  const [isTitleOnly, setIsTitleOnly] = useState(false);
  const [expandedReasoningIds, setExpandedReasoningIds] = useState<Set<string>>(() => new Set());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPlacement, setMenuPlacement] = useState<"top" | "bottom">("bottom");
  const [editorSession, setEditorSession] = useState(0);

  const menuContainerRef = useRef<HTMLDivElement | null>(null);
  const activeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const editorTitleInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (getTitleOnlyStoredPreference()) {
      setIsTitleOnly(true);
    }
  }, []);

  // Close open action menu on outside click or Escape
  useEffect(() => {
    if (!openMenuId) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenuId(null);
        activeTriggerRef.current?.focus();
      }
    }

    function handleClickOutside(event: MouseEvent) {
      if (
        menuContainerRef.current
        && !menuContainerRef.current.contains(event.target as Node)
      ) {
        setOpenMenuId(null);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [openMenuId]);

  // Focus editor title field when a create/edit session is explicitly opened
  useEffect(() => {
    if (editorSession > 0 && editorTitleInputRef.current) {
      editorTitleInputRef.current.focus();
      if (typeof editorTitleInputRef.current.scrollIntoView === "function") {
        editorTitleInputRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [editorSession]);

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

  const filteredReasonings = useMemo(() => {
    return filterAndSortReasonings(reasonings, {
      query: searchQuery,
      categoryId: activeCategoryId,
      childIdsByParent,
      sortBy,
    });
  }, [reasonings, searchQuery, activeCategoryId, childIdsByParent, sortBy]);

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
    setOpenMenuId(null);
    setEditorSession((prev) => prev + 1);
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
    setOpenMenuId(null);
    setEditorSession((prev) => prev + 1);
  }

  function toggleTitleOnly() {
    const next = !isTitleOnly;
    setIsTitleOnly(next);
    persistTitleOnlyPreference(next);
  }

  function toggleReasoningExpansion(id: string) {
    setExpandedReasoningIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
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
      setExpandedReasoningIds((current) => {
        if (!current.has(reasoning.id)) return current;
        const next = new Set(current);
        next.delete(reasoning.id);
        return next;
      });
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
              Wiederverwendbare Textbausteine für Schriftsätze, Bescheidprüfungen und Korrespondenz.
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
              ref={editorTitleInputRef}
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
            <div className="reasoning-filter-row">
              <div className="reasoning-filter-group reasoning-search-group">
                <label htmlFor="reasonings-search-input">Textbausteine durchsuchen</label>
                <div className="reasoning-search-wrapper">
                  <svg
                    className="reasoning-search-icon"
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.35-4.35" />
                  </svg>
                  <input
                    id="reasonings-search-input"
                    type="search"
                    placeholder="Titel oder Inhalt suchen …"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                  {searchQuery ? (
                    <button
                      type="button"
                      className="reasoning-search-clear"
                      aria-label="Suche zurücksetzen"
                      onClick={() => setSearchQuery("")}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="reasoning-filter-group">
                <label htmlFor="reasonings-category-select">Kategorie</label>
                <select
                  id="reasonings-category-select"
                  value={activeCategoryId}
                  onChange={(event) => setActiveCategoryId(event.target.value)}
                >
                  <option value="">Alle Kategorien</option>
                  {orderedCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {categoryDisplayName(category)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="reasoning-filter-group">
                <label htmlFor="reasonings-sort-select">Sortierung</label>
                <select
                  id="reasonings-sort-select"
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as ReasoningSortBy)}
                >
                  <option value="updated">Zuletzt geändert</option>
                  <option value="alpha">A–Z</option>
                </select>
              </div>
            </div>

            <div className="reasoning-toolbar-meta-row">
              <span className="reasoning-library-counter">
                {filteredReasonings.length} von {reasonings.length} Textbausteinen
              </span>

              <button
                type="button"
                role="switch"
                aria-checked={isTitleOnly}
                className={`reasoning-title-toggle ${isTitleOnly ? "is-active" : ""}`}
                onClick={toggleTitleOnly}
              >
                <span className="reasoning-title-toggle-track" aria-hidden="true">
                  <span className="reasoning-title-toggle-thumb" />
                </span>
                <span>Nur Titel</span>
              </button>
            </div>
          </div>

          {isLoading ? (
            <p className="reasonings-empty-state" role="status">Textbausteine werden geladen …</p>
          ) : filteredReasonings.length === 0 ? (
            <div className="reasonings-empty-state">
              <h3>{reasonings.length === 0 ? "Noch keine Textbausteine" : "Keine Treffer"}</h3>
              <p>
                {reasonings.length === 0
                  ? "Lege deinen ersten Textbaustein als persönliche Vorlage an."
                  : "Keine Textbausteine entsprechen deinen Suchkriterien."}
              </p>
              {reasonings.length === 0 ? (
                <button className="primary-button" type="button" onClick={openNewEditor}>
                  Ersten Textbaustein anlegen
                </button>
              ) : null}
            </div>
          ) : (
            <div className="reasoning-stream" role="list">
              {filteredReasonings.map((reasoning) => {
                const isExpanded = isTitleOnly
                  ? expandedReasoningIds.has(reasoning.id)
                  : true;
                const isMenuOpen = openMenuId === reasoning.id;
                const contentId = `reasoning-entry-content-${reasoning.id}`;

                return (
                  <article
                    className={`reasoning-card reasoning-row ${isTitleOnly ? "is-title-only" : ""} ${isExpanded ? "is-expanded" : ""}`}
                    key={reasoning.id}
                    role="listitem"
                  >
                    <div className="reasoning-row-header">
                      {isTitleOnly ? (
                        <button
                          type="button"
                          className="reasoning-row-title-btn"
                          aria-expanded={isExpanded}
                          aria-controls={contentId}
                          onClick={() => toggleReasoningExpansion(reasoning.id)}
                        >
                          <svg
                            className={`reasoning-disclosure-chevron ${isExpanded ? "is-expanded" : ""}`}
                            aria-hidden="true"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                          <span className="reasoning-row-title-text">{reasoning.title}</span>
                        </button>
                      ) : (
                        <div className="reasoning-card-title-group">
                          <h3 className="reasoning-row-title-text">{reasoning.title}</h3>
                        </div>
                      )}

                      <div className="reasoning-row-actions">
                        <CopyIconButton
                          className="reasoning-copy-button"
                          text={reasoning.content}
                          label={`Textbaustein „${reasoning.title}“ kopieren`}
                        />

                        <div
                          ref={isMenuOpen ? menuContainerRef : null}
                          className="reasoning-menu-wrapper"
                        >
                          <button
                            ref={isMenuOpen ? activeTriggerRef : null}
                            className="reasoning-menu-trigger"
                            type="button"
                            aria-label={`Weitere Aktionen für „${reasoning.title}“`}
                            aria-haspopup="true"
                            aria-expanded={isMenuOpen}
                            onClick={(event) => {
                              event.stopPropagation();
                              activeTriggerRef.current = event.currentTarget;
                              if (openMenuId === reasoning.id) {
                                setOpenMenuId(null);
                              } else {
                                const rect = event.currentTarget.getBoundingClientRect();
                                const spaceBelow = window.innerHeight - rect.bottom;
                                setMenuPlacement(spaceBelow < 120 ? "top" : "bottom");
                                setOpenMenuId(reasoning.id);
                              }
                            }}
                            title="Weitere Aktionen"
                          >
                            <svg
                              aria-hidden="true"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <circle cx="12" cy="12" r="1" />
                              <circle cx="19" cy="12" r="1" />
                              <circle cx="5" cy="12" r="1" />
                            </svg>
                          </button>

                          {isMenuOpen ? (
                            <div
                              className={`reasoning-action-menu is-${menuPlacement}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                className="reasoning-card-icon-button"
                                aria-label={`Textbaustein „${reasoning.title}“ bearbeiten`}
                                onClick={() => openEditEditor(reasoning)}
                                disabled={isSaving}
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
                                <span>Bearbeiten</span>
                              </button>
                              <button
                                type="button"
                                className="reasoning-card-icon-button is-danger"
                                aria-label={`Textbaustein „${reasoning.title}“ löschen`}
                                onClick={() => {
                                  setOpenMenuId(null);
                                  void deleteReasoning(reasoning);
                                }}
                                disabled={isSaving}
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
                                <span>Löschen</span>
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div
                      id={contentId}
                      hidden={!isExpanded}
                      className="reasoning-card-body"
                    >
                      <p className="reasoning-card-content">{reasoning.content}</p>
                      <div className="reasoning-card-footer">
                        <div className="reasoning-card-categories">
                          {reasoning.categoryIds.flatMap((categoryId) => {
                            const cat = categoriesById.get(categoryId);
                            return cat ? <span key={cat.id}>{cat.name}</span> : [];
                          })}
                        </div>
                        {reasoning.updatedAt ? (
                          <small className="reasoning-card-date">
                            Aktualisiert {formatUpdatedAt(reasoning.updatedAt)}
                          </small>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
