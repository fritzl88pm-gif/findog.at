"use client";

import { useCallback, useEffect, useState } from "react";

import RichAnswer from "@/components/rich-answer";
import type { BfgNewsletterItem } from "@/lib/bfg-newsletters";

function normalizeItem(value: unknown): BfgNewsletterItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string"
    || typeof item.publicationDate !== "string"
    || typeof item.contentMarkdown !== "string"
    || typeof item.createdAt !== "string"
    || typeof item.updatedAt !== "string"
  ) return null;
  return item as BfgNewsletterItem;
}

function formatPublicationDate(value: string): string {
  return new Intl.DateTimeFormat("de-AT", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function payloadError(payload: unknown, fallback: string): string {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    && typeof (payload as Record<string, unknown>).error === "string"
    ? String((payload as Record<string, unknown>).error)
    : fallback;
}

export default function BfgNewsletterView({ accessToken }: { accessToken: string }) {
  const [items, setItems] = useState<BfgNewsletterItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!accessToken) return;
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/bfg-newsletters", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
        signal,
      });
      const payload = await response.json().catch(() => ({})) as unknown;
      if (!response.ok) throw new Error(payloadError(payload, "BFG Newsletter konnte nicht geladen werden."));
      const rawItems = payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).items
        : null;
      if (!Array.isArray(rawItems)) throw new Error("BFG Newsletter konnte nicht geladen werden.");
      const nextItems = rawItems.map(normalizeItem);
      if (nextItems.some((item) => item === null)) {
        throw new Error("BFG Newsletter konnte nicht geladen werden.");
      }
      setItems(nextItems as BfgNewsletterItem[]);
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
    const timeout = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [load]);

  return (
    <section className="forms-panel bfg-newsletter-panel" aria-labelledby="bfg-newsletter-view-title">
      <div className="bfg-newsletter-view">
        <header className="bfg-newsletter-header">
          <p className="eyebrow">Bundesfinanzgericht</p>
          <h1 id="bfg-newsletter-view-title">BFG Newsletter</h1>
          <p>Aktuelle Ausgaben in chronologischer Reihenfolge.</p>
        </header>

        {isLoading ? (
          <div className="bfg-newsletter-state" role="status">Newsletter werden geladen …</div>
        ) : error ? (
          <div className="error-box bfg-newsletter-error" role="alert">
            <strong>Vorübergehend nicht verfügbar</strong>
            <span>{error}</span>
          </div>
        ) : items.length === 0 ? (
          <div className="bfg-newsletter-state">
            <strong>Noch keine Newsletter verfügbar</strong>
            <span>Neue Ausgaben erscheinen hier automatisch mit der neuesten Ausgabe zuerst.</span>
          </div>
        ) : (
          <ol className="bfg-newsletter-list">
            {items.map((item) => (
              <li key={item.id}>
                <article className="bfg-newsletter-entry">
                  <time dateTime={item.publicationDate}>
                    {formatPublicationDate(item.publicationDate)}
                  </time>
                  <RichAnswer content={item.contentMarkdown} showTableCopyActions={false} />
                </article>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
