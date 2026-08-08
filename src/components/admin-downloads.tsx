"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { DownloadCatalog, DownloadCategory, DownloadDocument } from "@/lib/downloads";

type CategoryDraft = { name: string; description: string; sortOrder: string };
type DocumentDraft = { categoryId: string; title: string; description: string; sortOrder: string };

const EMPTY_CATEGORY: CategoryDraft = { name: "", description: "", sortOrder: "0" };
const EMPTY_DOCUMENT: DocumentDraft = { categoryId: "", title: "", description: "", sortOrder: "0" };

function catalogFromPayload(value: unknown): DownloadCatalog | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (!Array.isArray(payload.categories) || !Array.isArray(payload.documents)) return null;
  return {
    categories: payload.categories as DownloadCategory[],
    documents: payload.documents as DownloadDocument[],
  };
}

function payloadError(value: unknown, fallback: string): string {
  return value && typeof value === "object" && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).error === "string"
    ? String((value as Record<string, unknown>).error)
    : fallback;
}

function draftForCategory(category: DownloadCategory): CategoryDraft {
  return {
    name: category.name,
    description: category.description,
    sortOrder: String(category.sortOrder),
  };
}

function draftForDocument(document: DownloadDocument): DocumentDraft {
  return {
    categoryId: document.categoryId,
    title: document.title,
    description: document.description,
    sortOrder: String(document.sortOrder),
  };
}

export default function AdminDownloads({ accessToken }: { accessToken: string }) {
  const [catalog, setCatalog] = useState<DownloadCatalog>({ categories: [], documents: [] });
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft>(EMPTY_CATEGORY);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [documentDraft, setDocumentDraft] = useState<DocumentDraft>(EMPTY_DOCUMENT);
  const [uploadDraft, setUploadDraft] = useState<DocumentDraft>(EMPTY_DOCUMENT);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const selectedCategory = catalog.categories.find((category) => category.id === selectedCategoryId) ?? null;
  const categoryDocuments = useMemo(
    () => catalog.documents.filter((document) => document.categoryId === selectedCategoryId),
    [catalog.documents, selectedCategoryId],
  );

  const load = useCallback(async (preferredCategoryId?: string) => {
    if (!accessToken) return;
    setIsLoading(true);
    try {
      const response = await fetch("/api/downloads", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as unknown;
      if (!response.ok) throw new Error(payloadError(payload, "Downloads konnten nicht geladen werden."));
      const nextCatalog = catalogFromPayload(payload);
      if (!nextCatalog) throw new Error("Downloads konnten nicht geladen werden.");
      setCatalog(nextCatalog);
      const nextCategoryId = nextCatalog.categories.some((category) => category.id === preferredCategoryId)
        ? preferredCategoryId ?? ""
        : nextCatalog.categories[0]?.id ?? "";
      const nextCategory = nextCatalog.categories.find((category) => category.id === nextCategoryId) ?? null;
      setSelectedCategoryId(nextCategoryId);
      setCategoryDraft(nextCategory ? draftForCategory(nextCategory) : EMPTY_CATEGORY);
      setUploadDraft((current) => ({
        ...current,
        categoryId: nextCatalog.categories.some((category) => category.id === current.categoryId)
          ? current.categoryId
          : nextCategoryId,
      }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Downloads konnten nicht geladen werden.");
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  function clearFeedback() {
    setError("");
    setNotice("");
  }

  function selectCategory(category: DownloadCategory) {
    clearFeedback();
    setSelectedCategoryId(category.id);
    setCategoryDraft(draftForCategory(category));
    setIsCreatingCategory(false);
    setSelectedDocumentId("");
    setUploadDraft((current) => ({ ...current, categoryId: category.id }));
  }

  async function saveCategory(event: React.FormEvent) {
    event.preventDefault();
    if (!accessToken || isMutating) return;
    clearFeedback();
    setIsMutating(true);
    try {
      const response = await fetch("/api/admin/downloads/categories", {
        method: isCreatingCategory ? "POST" : "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...(isCreatingCategory ? {} : { id: selectedCategoryId }),
          name: categoryDraft.name,
          description: categoryDraft.description,
          sortOrder: Number(categoryDraft.sortOrder),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) throw new Error(payloadError(payload, "Die Kategorie konnte nicht gespeichert werden."));
      const category = payload.category as DownloadCategory | undefined;
      await load(category?.id ?? selectedCategoryId);
      if (category) setCategoryDraft(draftForCategory(category));
      setIsCreatingCategory(false);
      setNotice(isCreatingCategory ? "Kategorie angelegt." : "Kategorie gespeichert.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Die Kategorie konnte nicht gespeichert werden.");
    } finally {
      setIsMutating(false);
    }
  }

  async function deleteCategory() {
    if (!accessToken || !selectedCategory || isMutating) return;
    if (!window.confirm(`Kategorie „${selectedCategory.name}“ wirklich löschen?`)) return;
    clearFeedback();
    setIsMutating(true);
    try {
      const response = await fetch("/api/admin/downloads/categories", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: selectedCategory.id }),
      });
      const payload = (await response.json().catch(() => ({}))) as unknown;
      if (!response.ok) throw new Error(payloadError(payload, "Die Kategorie konnte nicht gelöscht werden."));
      setCategoryDraft(EMPTY_CATEGORY);
      await load();
      setNotice("Kategorie gelöscht.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Die Kategorie konnte nicht gelöscht werden.");
    } finally {
      setIsMutating(false);
    }
  }

  async function uploadDocument(event: React.FormEvent) {
    event.preventDefault();
    if (!accessToken || !uploadFile || isMutating) return;
    clearFeedback();
    setIsMutating(true);
    try {
      const formData = new FormData();
      formData.set("file", uploadFile);
      formData.set("categoryId", uploadDraft.categoryId);
      formData.set("title", uploadDraft.title);
      formData.set("description", uploadDraft.description);
      formData.set("sortOrder", uploadDraft.sortOrder);
      const response = await fetch("/api/admin/downloads/documents", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
      });
      const payload = (await response.json().catch(() => ({}))) as unknown;
      if (!response.ok) throw new Error(payloadError(payload, "Das Dokument konnte nicht hochgeladen werden."));
      setUploadFile(null);
      setUploadDraft({ categoryId: uploadDraft.categoryId, title: "", description: "", sortOrder: "0" });
      if (uploadInputRef.current) uploadInputRef.current.value = "";
      await load(uploadDraft.categoryId);
      setNotice("Dokument hochgeladen.");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Das Dokument konnte nicht hochgeladen werden.");
    } finally {
      setIsMutating(false);
    }
  }

  function selectDocument(document: DownloadDocument) {
    clearFeedback();
    setSelectedDocumentId(document.id);
    setDocumentDraft(draftForDocument(document));
  }

  async function saveDocument(event: React.FormEvent) {
    event.preventDefault();
    if (!accessToken || !selectedDocumentId || isMutating) return;
    clearFeedback();
    setIsMutating(true);
    try {
      const response = await fetch("/api/admin/downloads/documents", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: selectedDocumentId, ...documentDraft, sortOrder: Number(documentDraft.sortOrder) }),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) throw new Error(payloadError(payload, "Das Dokument konnte nicht gespeichert werden."));
      const document = payload.document as DownloadDocument | undefined;
      await load(document?.categoryId ?? selectedCategoryId);
      if (document) setDocumentDraft(draftForDocument(document));
      setNotice("Dokument gespeichert.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Das Dokument konnte nicht gespeichert werden.");
    } finally {
      setIsMutating(false);
    }
  }

  async function deleteDocument(document: DownloadDocument) {
    if (!accessToken || isMutating) return;
    if (!window.confirm(`Dokument „${document.title}“ wirklich entfernen?`)) return;
    clearFeedback();
    setIsMutating(true);
    try {
      const response = await fetch("/api/admin/downloads/documents", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: document.id }),
      });
      const payload = (await response.json().catch(() => ({}))) as unknown;
      if (!response.ok) throw new Error(payloadError(payload, "Das Dokument konnte nicht entfernt werden."));
      if (selectedDocumentId === document.id) setSelectedDocumentId("");
      await load(selectedCategoryId);
      setNotice("Dokument entfernt.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Das Dokument konnte nicht entfernt werden.");
    } finally {
      setIsMutating(false);
    }
  }

  if (isLoading && catalog.categories.length === 0) {
    return (
      <section className="admin-downloads-panel" role="tabpanel" id="admin-panel-downloads" aria-labelledby="admin-tab-downloads">
        <p className="admin-empty-state">Downloadverwaltung wird geladen …</p>
      </section>
    );
  }

  return (
    <section className="admin-downloads-panel" role="tabpanel" id="admin-panel-downloads" aria-labelledby="admin-tab-downloads">
      <div className="admin-downloads-heading">
        <div>
          <h2>Downloadverwaltung</h2>
          <p>Kategorien, Metadaten und freigegebene Dateien verwalten.</p>
        </div>
        <button
          className="primary-button"
          type="button"
          onClick={() => {
            clearFeedback();
            setIsCreatingCategory(true);
            setCategoryDraft(EMPTY_CATEGORY);
          }}
          disabled={isMutating}
        >
          Neue Kategorie
        </button>
      </div>

      {error ? <div className="error-box" role="alert">{error}</div> : null}
      {notice ? <div className="notice-box" role="status">{notice}</div> : null}

      <div className="admin-downloads-grid">
        <div className="form-generator-card admin-downloads-categories-card">
          <h3>Kategorien</h3>
          {catalog.categories.length === 0 ? (
            <p className="admin-empty-state">Noch keine Kategorie vorhanden.</p>
          ) : (
            <ul className="admin-downloads-category-list">
              {catalog.categories.map((category) => (
                <li key={category.id}>
                  <button
                    type="button"
                    className={selectedCategoryId === category.id && !isCreatingCategory ? "active" : undefined}
                    onClick={() => selectCategory(category)}
                    disabled={isMutating}
                  >
                    <span><strong>{category.name}</strong><small>{category.documentCount} Dokumente</small></span>
                    <span aria-hidden="true">›</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {(isCreatingCategory || selectedCategory) ? (
            <form className="admin-downloads-form" onSubmit={saveCategory}>
              <div className="field-group">
                <label htmlFor="admin-download-category-name">Name</label>
                <input id="admin-download-category-name" maxLength={80} value={categoryDraft.name} onChange={(event) => setCategoryDraft((draft) => ({ ...draft, name: event.target.value }))} required disabled={isMutating} />
              </div>
              <div className="field-group">
                <label htmlFor="admin-download-category-description">Beschreibung</label>
                <input id="admin-download-category-description" maxLength={240} value={categoryDraft.description} onChange={(event) => setCategoryDraft((draft) => ({ ...draft, description: event.target.value }))} disabled={isMutating} />
              </div>
              <div className="field-group admin-downloads-order-field">
                <label htmlFor="admin-download-category-order">Reihenfolge</label>
                <input id="admin-download-category-order" type="number" min="0" max="1000000" value={categoryDraft.sortOrder} onChange={(event) => setCategoryDraft((draft) => ({ ...draft, sortOrder: event.target.value }))} required disabled={isMutating} />
              </div>
              <div className="admin-model-actions">
                <button className="primary-button" type="submit" disabled={isMutating || !categoryDraft.name.trim()}>{isCreatingCategory ? "Kategorie anlegen" : "Kategorie speichern"}</button>
                {!isCreatingCategory && selectedCategory ? <button className="danger-button" type="button" onClick={() => void deleteCategory()} disabled={isMutating || selectedCategory.documentCount > 0}>Kategorie löschen</button> : null}
              </div>
              {!isCreatingCategory && selectedCategory?.documentCount ? <p className="field-help">Vor dem Löschen müssen alle Dokumente aus dieser Kategorie entfernt oder verschoben werden.</p> : null}
            </form>
          ) : null}
        </div>

        <div className="form-generator-card admin-downloads-upload-card">
          <h3>Dokument hochladen</h3>
          <form className="admin-downloads-form" onSubmit={uploadDocument}>
            <div className="field-group">
              <label htmlFor="admin-download-file">Datei</label>
              <input
                ref={uploadInputRef}
                id="admin-download-file"
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setUploadFile(file);
                  if (file && !uploadDraft.title.trim()) {
                    setUploadDraft((draft) => ({ ...draft, title: file.name.replace(/\.[^.]+$/u, "") }));
                  }
                }}
                required
                disabled={isMutating || catalog.categories.length === 0}
              />
              <p className="field-help">PDF, Word, Excel, PowerPoint, Text, Markdown oder CSV; maximal 20 MB.</p>
            </div>
            <div className="field-group">
              <label htmlFor="admin-download-upload-title">Anzeigename</label>
              <input id="admin-download-upload-title" maxLength={160} value={uploadDraft.title} onChange={(event) => setUploadDraft((draft) => ({ ...draft, title: event.target.value }))} required disabled={isMutating} />
            </div>
            <div className="field-group">
              <label htmlFor="admin-download-upload-description">Kurzbeschreibung</label>
              <input id="admin-download-upload-description" maxLength={500} value={uploadDraft.description} onChange={(event) => setUploadDraft((draft) => ({ ...draft, description: event.target.value }))} disabled={isMutating} />
            </div>
            <div className="admin-downloads-inline-fields">
              <div className="field-group">
                <label htmlFor="admin-download-upload-category">Kategorie</label>
                <select id="admin-download-upload-category" value={uploadDraft.categoryId} onChange={(event) => setUploadDraft((draft) => ({ ...draft, categoryId: event.target.value }))} required disabled={isMutating}>
                  <option value="">Kategorie wählen</option>
                  {catalog.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </div>
              <div className="field-group admin-downloads-order-field">
                <label htmlFor="admin-download-upload-order">Reihenfolge</label>
                <input id="admin-download-upload-order" type="number" min="0" max="1000000" value={uploadDraft.sortOrder} onChange={(event) => setUploadDraft((draft) => ({ ...draft, sortOrder: event.target.value }))} required disabled={isMutating} />
              </div>
            </div>
            <button className="primary-button" type="submit" disabled={isMutating || !uploadFile || !uploadDraft.categoryId || !uploadDraft.title.trim()}>Dokument hochladen</button>
          </form>
        </div>
      </div>

      <div className="form-generator-card admin-downloads-documents-card">
        <div className="admin-downloads-document-heading">
          <div><h3>Dokumente</h3><p>{selectedCategory ? selectedCategory.name : "Kategorie auswählen"}</p></div>
          <span>{categoryDocuments.length}</span>
        </div>
        {categoryDocuments.length === 0 ? (
          <p className="admin-empty-state">In dieser Kategorie sind noch keine Dokumente vorhanden.</p>
        ) : (
          <ul className="admin-downloads-document-list">
            {categoryDocuments.map((document) => (
              <li key={document.id}>
                <span className="admin-downloads-file-type">{document.fileExtension.toUpperCase()}</span>
                <div><strong>{document.title}</strong><small>{document.originalFilename}</small></div>
                <button type="button" onClick={() => selectDocument(document)} disabled={isMutating}>Bearbeiten</button>
                <button className="danger-button" type="button" onClick={() => void deleteDocument(document)} disabled={isMutating}>Entfernen</button>
              </li>
            ))}
          </ul>
        )}

        {selectedDocumentId ? (
          <form className="admin-downloads-form admin-downloads-document-edit" onSubmit={saveDocument}>
            <h3>Dokument bearbeiten</h3>
            <div className="field-group">
              <label htmlFor="admin-download-edit-title">Anzeigename</label>
              <input id="admin-download-edit-title" maxLength={160} value={documentDraft.title} onChange={(event) => setDocumentDraft((draft) => ({ ...draft, title: event.target.value }))} required disabled={isMutating} />
            </div>
            <div className="field-group">
              <label htmlFor="admin-download-edit-description">Kurzbeschreibung</label>
              <input id="admin-download-edit-description" maxLength={500} value={documentDraft.description} onChange={(event) => setDocumentDraft((draft) => ({ ...draft, description: event.target.value }))} disabled={isMutating} />
            </div>
            <div className="admin-downloads-inline-fields">
              <div className="field-group">
                <label htmlFor="admin-download-edit-category">Kategorie</label>
                <select id="admin-download-edit-category" value={documentDraft.categoryId} onChange={(event) => setDocumentDraft((draft) => ({ ...draft, categoryId: event.target.value }))} required disabled={isMutating}>
                  {catalog.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </div>
              <div className="field-group admin-downloads-order-field">
                <label htmlFor="admin-download-edit-order">Reihenfolge</label>
                <input id="admin-download-edit-order" type="number" min="0" max="1000000" value={documentDraft.sortOrder} onChange={(event) => setDocumentDraft((draft) => ({ ...draft, sortOrder: event.target.value }))} required disabled={isMutating} />
              </div>
            </div>
            <div className="admin-model-actions">
              <button className="primary-button" type="submit" disabled={isMutating || !documentDraft.title.trim()}>Dokument speichern</button>
              <button type="button" onClick={() => setSelectedDocumentId("")} disabled={isMutating}>Abbrechen</button>
            </div>
          </form>
        ) : null}
      </div>
    </section>
  );
}
