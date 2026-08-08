"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  DOWNLOAD_PAGE_SIZE,
  downloadDisplayFilename,
  type DownloadCatalog,
  type DownloadCategory,
  type DownloadDocument,
} from "@/lib/downloads";

function normalizeCategory(value: unknown): DownloadCategory | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string"
    || typeof item.name !== "string"
    || typeof item.description !== "string"
    || typeof item.sortOrder !== "number"
    || typeof item.documentCount !== "number"
    || typeof item.createdAt !== "string"
    || typeof item.updatedAt !== "string"
  ) return null;
  return item as DownloadCategory;
}

function normalizeDocument(value: unknown): DownloadDocument | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string"
    || typeof item.categoryId !== "string"
    || typeof item.title !== "string"
    || typeof item.description !== "string"
    || typeof item.originalFilename !== "string"
    || typeof item.mimeType !== "string"
    || typeof item.fileExtension !== "string"
    || typeof item.fileSize !== "number"
    || typeof item.sortOrder !== "number"
    || typeof item.createdAt !== "string"
    || typeof item.updatedAt !== "string"
  ) return null;
  return item as DownloadDocument;
}

function normalizeCatalog(value: unknown): DownloadCatalog | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (!Array.isArray(payload.categories) || !Array.isArray(payload.documents)) return null;
  const categories = payload.categories.map(normalizeCategory);
  const documents = payload.documents.map(normalizeDocument);
  if (categories.some((item) => item === null) || documents.some((item) => item === null)) return null;
  return {
    categories: categories as DownloadCategory[],
    documents: documents as DownloadDocument[],
  };
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    return `${new Intl.NumberFormat("de-AT", { maximumFractionDigits: 0 }).format(bytes / 1024)} KB`;
  }
  return `${new Intl.NumberFormat("de-AT", { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} MB`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "–";
  return new Intl.DateTimeFormat("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function errorMessage(payload: unknown, fallback: string): string {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    && typeof (payload as Record<string, unknown>).error === "string"
    ? String((payload as Record<string, unknown>).error)
    : fallback;
}

export default function DownloadsView({ accessToken }: { accessToken: string }) {
  const [catalog, setCatalog] = useState<DownloadCatalog>({ categories: [], documents: [] });
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [visibleCount, setVisibleCount] = useState(DOWNLOAD_PAGE_SIZE);
  const [downloadingId, setDownloadingId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!accessToken) return;
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/downloads", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as unknown;
      if (!response.ok) {
        throw new Error(errorMessage(payload, "Downloads konnten nicht geladen werden."));
      }
      const nextCatalog = normalizeCatalog(payload);
      if (!nextCatalog) throw new Error("Downloads konnten nicht geladen werden.");
      setCatalog(nextCatalog);
      setSelectedCategoryId((current) => (
        nextCatalog.categories.some((category) => category.id === current)
          ? current
          : nextCatalog.categories[0]?.id ?? ""
      ));
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

  const selectedCategory = catalog.categories.find((category) => category.id === selectedCategoryId) ?? null;
  const categoryDocuments = useMemo(
    () => catalog.documents.filter((entry) => entry.categoryId === selectedCategoryId),
    [catalog.documents, selectedCategoryId],
  );
  const visibleDocuments = categoryDocuments.slice(0, visibleCount);

  async function download(entry: DownloadDocument) {
    if (!accessToken || downloadingId) return;
    setDownloadingId(entry.id);
    setError("");
    try {
      const response = await fetch(`/api/downloads/${encodeURIComponent(entry.id)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as unknown;
        throw new Error(errorMessage(payload, "Das Dokument konnte nicht heruntergeladen werden."));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = downloadDisplayFilename(entry.title, entry.fileExtension);
      anchor.style.display = "none";
      window.document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "Das Dokument konnte nicht heruntergeladen werden.",
      );
    } finally {
      setDownloadingId("");
    }
  }

  return (
    <section className="forms-panel downloads-panel" aria-labelledby="downloads-view-title">
      <div className="downloads-view">
        <header className="downloads-view-header">
          <p className="eyebrow">Dokumentenservice</p>
          <h1 id="downloads-view-title">Downloads</h1>
          <p>Formulare, Vorlagen und Arbeitshilfen zentral und aktuell bereitgestellt.</p>
        </header>

        {error ? <div className="error-box downloads-error" role="alert">{error}</div> : null}

        {isLoading ? (
          <div className="downloads-loading" role="status">Downloads werden geladen …</div>
        ) : catalog.categories.length === 0 ? (
          <div className="downloads-empty-state">
            <strong>Noch keine Downloads verfügbar</strong>
            <p>Sobald Dokumente freigegeben wurden, erscheinen sie hier.</p>
          </div>
        ) : (
          <div className="downloads-layout">
            <aside className="downloads-category-card" aria-label="Downloadkategorien">
              <span className="downloads-card-label">Kategorie</span>
              <nav>
                {catalog.categories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    className={category.id === selectedCategoryId ? "active" : undefined}
                    aria-current={category.id === selectedCategoryId ? "page" : undefined}
                    onClick={() => {
                      setSelectedCategoryId(category.id);
                      setVisibleCount(DOWNLOAD_PAGE_SIZE);
                    }}
                  >
                    <span>{category.name}</span>
                    <small>{category.documentCount}</small>
                  </button>
                ))}
              </nav>
            </aside>

            <div className="downloads-document-card">
              <header className="downloads-document-heading">
                <div>
                  <span>{categoryDocuments.length} {categoryDocuments.length === 1 ? "Dokument" : "Dokumente"}</span>
                  <strong>·</strong>
                  <span>{selectedCategory?.name}</span>
                </div>
                <span>Größe</span>
              </header>
              {selectedCategory?.description ? (
                <p className="downloads-category-description">{selectedCategory.description}</p>
              ) : null}
              {categoryDocuments.length === 0 ? (
                <div className="downloads-category-empty">In dieser Kategorie sind noch keine Dokumente verfügbar.</div>
              ) : (
                <ul className="downloads-document-list">
                  {visibleDocuments.map((entry) => (
                    <li key={entry.id}>
                      <span className={`downloads-file-icon downloads-file-${entry.fileExtension}`} aria-hidden="true">
                        {entry.fileExtension.toUpperCase()}
                      </span>
                      <div className="downloads-document-copy">
                        <strong>{entry.title}</strong>
                        <span>
                          {entry.description ? `${entry.description} · ` : ""}
                          {entry.fileExtension.toUpperCase()} · aktualisiert {formatDate(entry.updatedAt)}
                        </span>
                      </div>
                      <span className="downloads-file-size">{formatFileSize(entry.fileSize)}</span>
                      <button
                        type="button"
                        className="downloads-download-button"
                        onClick={() => void download(entry)}
                        disabled={Boolean(downloadingId)}
                      >
                        <span aria-hidden="true">↓</span>
                        {downloadingId === entry.id ? "Lädt …" : "Download"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <footer className="downloads-document-footer">
                <span>{Math.min(visibleCount, categoryDocuments.length)} von {categoryDocuments.length} angezeigt</span>
                {visibleCount < categoryDocuments.length ? (
                  <button type="button" onClick={() => setVisibleCount((count) => count + DOWNLOAD_PAGE_SIZE)}>
                    Weitere laden <span aria-hidden="true">→</span>
                  </button>
                ) : null}
              </footer>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
