"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import {
  BFG_NEWSLETTER_MAX_CONTENT_CHARS,
  sortBfgNewsletters,
  type BfgNewsletterInput,
  type BfgNewsletterItem,
} from "@/lib/bfg-newsletters";

type Props = { accessToken: string };

function todayInVienna(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vienna",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function formatDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return "Datum auswählen";
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "Datum auswählen";
  return new Intl.DateTimeFormat("de-AT", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function preview(value: string): string {
  const compact = value
    .replace(/```[\s\S]*?```/gu, " Code ")
    .replace(/[#>*_`|\[\]()~-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return compact.length > 110 ? `${compact.slice(0, 107)}…` : compact;
}

const emptyInput = (): BfgNewsletterInput => ({
  publicationDate: todayInVienna(),
  contentMarkdown: "",
});

export default function AdminBfgNewsletters({ accessToken }: Props) {
  const [items, setItems] = useState<BfgNewsletterItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<BfgNewsletterInput>(emptyInput);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadItems = useCallback(async (signal?: AbortSignal) => {
    if (!accessToken) return;
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/bfg-newsletters", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
        signal,
      });
      const payload = await response.json().catch(() => ({})) as {
        items?: BfgNewsletterItem[];
        error?: string;
      };
      if (!response.ok || !Array.isArray(payload.items)) {
        throw new Error(payload.error ?? "BFG Newsletter konnte nicht geladen werden.");
      }
      setItems(sortBfgNewsletters(payload.items));
    } catch (loadError) {
      if ((loadError as { name?: string }).name !== "AbortError") {
        setError(loadError instanceof Error ? loadError.message : "BFG Newsletter konnte nicht geladen werden.");
      }
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => void loadItems(controller.signal), 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [loadItems]);

  function startNewItem() {
    setSelectedId(null);
    setForm(emptyInput());
    setError("");
    setNotice("");
  }

  function selectItem(item: BfgNewsletterItem) {
    setSelectedId(item.id);
    setForm({ publicationDate: item.publicationDate, contentMarkdown: item.contentMarkdown });
    setError("");
    setNotice("");
  }

  async function saveItem(event?: FormEvent) {
    event?.preventDefault();
    if (!accessToken || isSaving) return;
    setIsSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/bfg-newsletters", {
        method: selectedId ? "PUT" : "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(selectedId ? { id: selectedId, ...form } : form),
      });
      const payload = await response.json().catch(() => ({})) as {
        item?: BfgNewsletterItem;
        error?: string;
      };
      if (!response.ok || !payload.item) {
        throw new Error(payload.error ?? "Der Newsletter konnte nicht gespeichert werden.");
      }
      setItems((current) => sortBfgNewsletters([
        payload.item!,
        ...current.filter((item) => item.id !== payload.item!.id),
      ]));
      setSelectedId(payload.item.id);
      setForm({
        publicationDate: payload.item.publicationDate,
        contentMarkdown: payload.item.contentMarkdown,
      });
      setNotice("Der Newsletter wurde gespeichert.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Der Newsletter konnte nicht gespeichert werden.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteItem() {
    if (!selectedId || !accessToken || isSaving) return;
    if (!window.confirm("Diesen Newsletter wirklich soft-löschen? Der Auditverlauf bleibt erhalten.")) return;
    setIsSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/bfg-newsletters", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: selectedId }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Der Newsletter konnte nicht gelöscht werden.");
      setItems((current) => current.filter((item) => item.id !== selectedId));
      setSelectedId(null);
      setForm(emptyInput());
      setNotice("Der Newsletter wurde soft-gelöscht; der Auditverlauf bleibt erhalten.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Der Newsletter konnte nicht gelöscht werden.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section
      className="admin-dashboard-news admin-bfg-newsletters"
      role="tabpanel"
      id="admin-panel-bfg-newsletters"
      aria-labelledby="admin-tab-bfg-newsletters"
    >
      <div className="admin-dashboard-news-heading">
        <div>
          <h2>BFG Newsletter</h2>
          <p>Datierte Text- oder Markdown-Ausgaben verwalten. Die neueste Ausgabe erscheint zuerst.</p>
        </div>
        <button className="secondary-button" type="button" onClick={startNewItem} disabled={isSaving}>
          Neuer Newsletter
        </button>
      </div>

      {error ? <div className="error-box" role="alert">{error}</div> : null}
      {notice ? <div className="notice-box" role="status">{notice}</div> : null}

      <div className="admin-dashboard-news-layout">
        <div className="admin-news-list-column">
          {isLoading ? (
            <p className="admin-empty-state" role="status">Newsletter werden geladen …</p>
          ) : items.length === 0 ? (
            <p className="admin-empty-state">Noch keine Newsletter vorhanden.</p>
          ) : (
            <div className="admin-news-list">
              {items.map((item) => (
                <button
                  key={item.id}
                  className={`admin-news-list-item${selectedId === item.id ? " active" : ""}`}
                  type="button"
                  onClick={() => selectItem(item)}
                  aria-pressed={selectedId === item.id}
                >
                  <span className="admin-news-list-meta"><span>BFG Newsletter</span></span>
                  <strong>{formatDate(item.publicationDate)}</strong>
                  <small>{preview(item.contentMarkdown)}</small>
                </button>
              ))}
            </div>
          )}
        </div>

        <form className="admin-news-editor" onSubmit={(event) => void saveItem(event)}>
          <div className="admin-news-editor-header">
            <div>
              <span className="eyebrow">{selectedId ? "Newsletter bearbeiten" : "Newsletter anlegen"}</span>
              <h3>{selectedId ? formatDate(form.publicationDate) : "Neue Ausgabe"}</h3>
            </div>
          </div>

          <div className="field-group">
            <label htmlFor="bfg-newsletter-publication-date">Datum</label>
            <input
              id="bfg-newsletter-publication-date"
              type="date"
              value={form.publicationDate}
              required
              onChange={(event) => setForm((current) => ({
                ...current,
                publicationDate: event.target.value,
              }))}
              disabled={isSaving}
            />
          </div>

          <div className="field-group">
            <label htmlFor="bfg-newsletter-content">Inhalt</label>
            <textarea
              id="bfg-newsletter-content"
              className="admin-bfg-newsletter-textarea"
              value={form.contentMarkdown}
              maxLength={BFG_NEWSLETTER_MAX_CONTENT_CHARS}
              rows={22}
              required
              spellCheck
              onChange={(event) => setForm((current) => ({
                ...current,
                contentMarkdown: event.target.value,
              }))}
              disabled={isSaving}
              placeholder="Text oder Markdown eingeben …"
            />
            <span className="field-help">
              Reiner Text oder Markdown, keine Datei- oder Bildanhänge. {form.contentMarkdown.length.toLocaleString("de-AT")}
              /{BFG_NEWSLETTER_MAX_CONTENT_CHARS.toLocaleString("de-AT")} Zeichen.
            </span>
          </div>

          <div className="admin-news-editor-actions">
            <button
              className="primary-button"
              type="submit"
              disabled={isSaving || !form.publicationDate || !form.contentMarkdown.trim()}
            >
              {isSaving ? "Wird gespeichert …" : "Newsletter speichern"}
            </button>
            {selectedId ? (
              <button
                className="secondary-button danger-button"
                type="button"
                onClick={() => void deleteItem()}
                disabled={isSaving}
              >
                Soft-löschen
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </section>
  );
}
