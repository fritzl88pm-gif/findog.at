"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import type {
  DashboardLegalDocumentKind,
  DashboardNewsInput,
  DashboardNewsItem,
  DashboardNewsKind,
  DashboardNewsSourceSystem,
  DashboardNewsStatus,
} from "@/lib/dashboard";

type Props = {
  accessToken: string;
};

type NewsForm = {
  kind: DashboardNewsKind;
  title: string;
  summary: string;
  status: DashboardNewsStatus;
  pinned: boolean;
  publishedAt: string | null;
  sourceSystem: DashboardNewsSourceSystem;
  documentKind: DashboardLegalDocumentKind;
  sourceIdentifier: string;
  sourceUrl: string;
  documentDate: string;
  asOfDate: string;
};

const EMPTY_FORM: NewsForm = {
  kind: "product",
  title: "",
  summary: "",
  status: "draft",
  pinned: false,
  publishedAt: null,
  sourceSystem: "ris",
  documentKind: "norm",
  sourceIdentifier: "",
  sourceUrl: "",
  documentDate: "",
  asOfDate: "",
};

const STATUS_LABELS: Record<DashboardNewsStatus, string> = {
  draft: "Entwurf",
  published: "Veröffentlicht",
  archived: "Archiviert",
};

const KIND_LABELS: Record<DashboardNewsKind, string> = {
  product: "Produktmeldung",
  legal: "Rechtsmeldung",
};

function formFromItem(item: DashboardNewsItem): NewsForm {
  return {
    kind: item.kind,
    title: item.title,
    summary: item.summary,
    status: item.status,
    pinned: item.pinned,
    publishedAt: item.publishedAt,
    sourceSystem: item.sourceSystem ?? "ris",
    documentKind: item.documentKind ?? "norm",
    sourceIdentifier: item.sourceIdentifier ?? "",
    sourceUrl: item.sourceUrl ?? "",
    documentDate: item.documentDate ?? "",
    asOfDate: item.asOfDate ?? "",
  };
}

function formatAdminNewsDate(value: string | null): string {
  if (!value) return "Noch nicht veröffentlicht";
  return new Intl.DateTimeFormat("de-AT", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Vienna",
  }).format(new Date(value));
}

export default function AdminDashboardNews({ accessToken }: Props) {
  const [items, setItems] = useState<DashboardNewsItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<NewsForm>(EMPTY_FORM);
  const [kindFilter, setKindFilter] = useState<"all" | DashboardNewsKind>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | DashboardNewsStatus>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadItems = useCallback(async (signal?: AbortSignal) => {
    if (!accessToken) return;
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/dashboard-news", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
        signal,
      });
      const payload = await response.json().catch(() => ({})) as {
        items?: DashboardNewsItem[];
        error?: string;
      };
      if (!response.ok || !Array.isArray(payload.items)) {
        throw new Error(payload.error ?? "Startseiten-News konnten nicht geladen werden.");
      }
      setItems(payload.items);
    } catch (loadError) {
      if ((loadError as { name?: string }).name !== "AbortError") {
        setError(loadError instanceof Error ? loadError.message : "Startseiten-News konnten nicht geladen werden.");
      }
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    const controller = new AbortController();
    let isActive = true;
    queueMicrotask(() => {
      if (isActive) void loadItems(controller.signal);
    });
    return () => {
      isActive = false;
      controller.abort();
    };
  }, [loadItems]);

  const visibleItems = useMemo(() => items.filter((item) => (
    (kindFilter === "all" || item.kind === kindFilter)
    && (statusFilter === "all" || item.status === statusFilter)
  )), [items, kindFilter, statusFilter]);

  function startNewItem() {
    setSelectedId(null);
    setForm(EMPTY_FORM);
    setError("");
    setNotice("");
  }

  function selectItem(item: DashboardNewsItem) {
    setSelectedId(item.id);
    setForm(formFromItem(item));
    setError("");
    setNotice("");
  }

  function requestInput(status: DashboardNewsStatus): DashboardNewsInput {
    const isLegal = form.kind === "legal";
    return {
      kind: form.kind,
      title: form.title,
      summary: form.summary,
      status,
      pinned: form.pinned,
      publishedAt: status === "draft"
        ? null
        : form.status === "archived" && status === "published"
          ? new Date().toISOString()
          : form.publishedAt ?? new Date().toISOString(),
      sourceSystem: isLegal ? form.sourceSystem : null,
      documentKind: isLegal ? form.documentKind : null,
      sourceIdentifier: isLegal ? form.sourceIdentifier : null,
      sourceUrl: isLegal ? form.sourceUrl : null,
      documentDate: isLegal ? form.documentDate : null,
      asOfDate: isLegal ? form.asOfDate : null,
    };
  }

  async function saveItem(status: DashboardNewsStatus = form.status) {
    if (!accessToken || isSaving) return;
    setIsSaving(true);
    setError("");
    setNotice("");
    try {
      const method = selectedId ? "PUT" : "POST";
      const response = await fetch("/api/admin/dashboard-news", {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(selectedId
          ? { id: selectedId, ...requestInput(status) }
          : requestInput(status)),
      });
      const payload = await response.json().catch(() => ({})) as {
        item?: DashboardNewsItem;
        error?: string;
      };
      if (!response.ok || !payload.item) {
        throw new Error(payload.error ?? "Die Meldung konnte nicht gespeichert werden.");
      }
      const saved = payload.item;
      setItems((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setSelectedId(saved.id);
      setForm(formFromItem(saved));
      setNotice(status === "published"
        ? "Die Meldung ist veröffentlicht."
        : status === "archived"
          ? "Die Meldung wurde archiviert."
          : "Der Entwurf wurde gespeichert.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Die Meldung konnte nicht gespeichert werden.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteItem() {
    if (!selectedId || !accessToken || isSaving) return;
    if (!window.confirm("Diese Meldung wirklich soft-löschen? Der Auditverlauf bleibt erhalten.")) return;
    setIsSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/dashboard-news", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: selectedId }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Die Meldung konnte nicht gelöscht werden.");
      setItems((current) => current.filter((item) => item.id !== selectedId));
      startNewItem();
      setNotice("Die Meldung wurde soft-gelöscht; der Auditverlauf bleibt erhalten.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Die Meldung konnte nicht gelöscht werden.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section
      className="admin-dashboard-news"
      role="tabpanel"
      id="admin-panel-dashboard-news"
      aria-labelledby="admin-tab-dashboard-news"
    >
      <div className="admin-dashboard-news-heading">
        <div>
          <h2>Startseiten-News</h2>
          <p>Produktmeldungen und redaktionell geprüfte RIS-/EVI-Rechtsmeldungen verwalten.</p>
        </div>
        <button className="secondary-button" type="button" onClick={startNewItem} disabled={isSaving}>
          Neue Meldung
        </button>
      </div>

      {error ? <div className="error-box" role="alert">{error}</div> : null}
      {notice ? <div className="notice-box" role="status">{notice}</div> : null}

      <div className="admin-dashboard-news-layout">
        <div className="admin-news-list-column">
          <div className="admin-news-filters" aria-label="Meldungen filtern">
            <label>
              Typ
              <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)}>
                <option value="all">Alle</option>
                <option value="product">Produkt</option>
                <option value="legal">Recht</option>
              </select>
            </label>
            <label>
              Status
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
                <option value="all">Alle</option>
                <option value="draft">Entwurf</option>
                <option value="published">Veröffentlicht</option>
                <option value="archived">Archiviert</option>
              </select>
            </label>
          </div>
          {isLoading ? (
            <p className="admin-empty-state" role="status">Meldungen werden geladen …</p>
          ) : visibleItems.length === 0 ? (
            <p className="admin-empty-state">Keine Meldungen für diesen Filter vorhanden.</p>
          ) : (
            <div className="admin-news-list">
              {visibleItems.map((item) => (
                <button
                  key={item.id}
                  className={`admin-news-list-item${selectedId === item.id ? " active" : ""}`}
                  type="button"
                  onClick={() => selectItem(item)}
                  aria-pressed={selectedId === item.id}
                >
                  <span className="admin-news-list-meta">
                    <span>{KIND_LABELS[item.kind]}</span>
                    <span data-status={item.status}>{STATUS_LABELS[item.status]}</span>
                    {item.pinned ? <span>Gepinnt</span> : null}
                  </span>
                  <strong>{item.title}</strong>
                  <small>{formatAdminNewsDate(item.publishedAt)}</small>
                </button>
              ))}
            </div>
          )}
        </div>

        <form
          className="admin-news-editor"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void saveItem();
          }}
        >
          <div className="admin-news-editor-header">
            <div>
              <span className="eyebrow">{selectedId ? "Meldung bearbeiten" : "Meldung anlegen"}</span>
              <h3>{selectedId ? STATUS_LABELS[form.status] : "Neuer Entwurf"}</h3>
            </div>
            <label className="admin-news-pin">
              <input
                type="checkbox"
                checked={form.pinned}
                onChange={(event) => setForm((current) => ({ ...current, pinned: event.target.checked }))}
              />
              Oben anheften
            </label>
          </div>

          <div className="field-group">
            <label htmlFor="dashboard-news-kind">Meldungstyp</label>
            <select
              id="dashboard-news-kind"
              value={form.kind}
              onChange={(event) => setForm((current) => ({ ...current, kind: event.target.value as DashboardNewsKind }))}
              disabled={isSaving}
            >
              <option value="product">Neu bei findog.at</option>
              <option value="legal">Recht aktuell</option>
            </select>
          </div>
          <div className="field-group">
            <label htmlFor="dashboard-news-title">Titel</label>
            <input
              id="dashboard-news-title"
              value={form.title}
              maxLength={160}
              required
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              disabled={isSaving}
            />
          </div>
          <div className="field-group">
            <label htmlFor="dashboard-news-summary">Kurztext</label>
            <textarea
              id="dashboard-news-summary"
              value={form.summary}
              maxLength={600}
              rows={5}
              required
              onChange={(event) => setForm((current) => ({ ...current, summary: event.target.value }))}
              disabled={isSaving}
            />
            <span className="field-help">Administrativ gepflegter Klartext, maximal 600 Zeichen.</span>
          </div>

          {form.kind === "legal" ? (
            <fieldset className="admin-news-legal-fields">
              <legend>Amtliche Rechtsquelle</legend>
              <div className="admin-news-field-grid">
                <div className="field-group">
                  <label htmlFor="dashboard-news-source">Quellsystem</label>
                  <select
                    id="dashboard-news-source"
                    value={form.sourceSystem}
                    onChange={(event) => setForm((current) => ({ ...current, sourceSystem: event.target.value as DashboardNewsSourceSystem }))}
                    disabled={isSaving}
                  >
                    <option value="ris">RIS</option>
                    <option value="evi">EVI</option>
                  </select>
                </div>
                <div className="field-group">
                  <label htmlFor="dashboard-news-document-kind">Dokumenttyp</label>
                  <select
                    id="dashboard-news-document-kind"
                    value={form.documentKind}
                    onChange={(event) => setForm((current) => ({ ...current, documentKind: event.target.value as DashboardLegalDocumentKind }))}
                    disabled={isSaving}
                  >
                    <option value="norm">Norm</option>
                    <option value="rechtssatz">Rechtssatz</option>
                    <option value="entscheidungsdokument">Entscheidungsdokument</option>
                  </select>
                </div>
                <div className="field-group admin-news-field-span">
                  <label htmlFor="dashboard-news-identifier">Amtliche Kennung</label>
                  <input
                    id="dashboard-news-identifier"
                    value={form.sourceIdentifier}
                    maxLength={200}
                    required
                    onChange={(event) => setForm((current) => ({ ...current, sourceIdentifier: event.target.value }))}
                    disabled={isSaving}
                  />
                </div>
                <div className="field-group admin-news-field-span">
                  <label htmlFor="dashboard-news-source-url">HTTPS-Quellenlink</label>
                  <input
                    id="dashboard-news-source-url"
                    type="url"
                    value={form.sourceUrl}
                    placeholder={form.sourceSystem === "ris" ? "https://www.ris.bka.gv.at/…" : "https://www.evi.gv.at/…"}
                    required
                    onChange={(event) => setForm((current) => ({ ...current, sourceUrl: event.target.value }))}
                    disabled={isSaving}
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="dashboard-news-document-date">Dokument-/Entscheidungsdatum</label>
                  <input
                    id="dashboard-news-document-date"
                    type="date"
                    value={form.documentDate}
                    required
                    onChange={(event) => setForm((current) => ({ ...current, documentDate: event.target.value }))}
                    disabled={isSaving}
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="dashboard-news-as-of-date">Rechtlicher Stichtag</label>
                  <input
                    id="dashboard-news-as-of-date"
                    type="date"
                    value={form.asOfDate}
                    required
                    onChange={(event) => setForm((current) => ({ ...current, asOfDate: event.target.value }))}
                    disabled={isSaving}
                  />
                </div>
              </div>
              <p className="field-help">Veröffentlichungen beschreiben nur den redaktionell gepflegten Stand zum angegebenen Stichtag.</p>
            </fieldset>
          ) : null}

          <div className="admin-news-editor-actions">
            <button className="primary-button" type="submit" disabled={isSaving}>
              {isSaving ? "Speichert …" : form.status === "draft" ? "Entwurf speichern" : "Änderungen speichern"}
            </button>
            {form.status === "draft" ? (
              <button className="secondary-button" type="button" onClick={() => void saveItem("published")} disabled={isSaving}>
                Veröffentlichen
              </button>
            ) : form.status === "published" ? (
              <button className="secondary-button" type="button" onClick={() => void saveItem("archived")} disabled={isSaving}>
                Archivieren
              </button>
            ) : (
              <button className="secondary-button" type="button" onClick={() => void saveItem("published")} disabled={isSaving}>
                Erneut veröffentlichen
              </button>
            )}
            {selectedId ? (
              <button className="secondary-button danger-button" type="button" onClick={() => void deleteItem()} disabled={isSaving}>
                Soft-löschen
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </section>
  );
}
