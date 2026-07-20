"use client";

import { useEffect, useState } from "react";

import {
  calculateGroupSubtotal,
  getDominantKnowledgeBase,
  getRankedKnowledgeBases,
} from "@/lib/weknora/analytics";
import type {
  WeKnoraDashboard,
  WeKnoraKnowledgeBase,
} from "@/lib/weknora/dashboard-types";

type KnowledgeLandscapeViewProps = {
  accessToken: string;
};

type ViewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; dashboard: WeKnoraDashboard };

class DashboardResponseError extends Error {}

function formatCount(value: number): string {
  return value.toLocaleString("de-AT");
}

function formatPercent(value: number): string {
  return value.toLocaleString("de-AT", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }) + " %";
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "nicht verfügbar";
  return new Intl.DateTimeFormat("de-AT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDashboard(value: unknown): value is WeKnoraDashboard {
  if (!isRecord(value) || !Array.isArray(value.knowledgeBases) || !isRecord(value.totals)) {
    return false;
  }
  const totals = value.totals;
  const totalKeys = ["knowledgeBases", "contents", "documents", "faqEntries", "processing"];
  return totalKeys.every((key) => Number.isSafeInteger(totals[key]) && Number(totals[key]) >= 0)
    && typeof value.fetchedAt === "string"
    && typeof value.stale === "boolean"
    && value.knowledgeBases.every((item) => (
      isRecord(item)
      && typeof item.id === "string"
      && typeof item.name === "string"
      && (item.kind === "document" || item.kind === "faq")
      && Number.isSafeInteger(item.count)
      && Number(item.count) >= 0
      && typeof item.isProcessing === "boolean"
      && Number.isSafeInteger(item.processingCount)
      && Number(item.processingCount) >= 0
    ));
}

function KnowledgeIcon({ kind }: { kind: WeKnoraKnowledgeBase["kind"] }) {
  return (
    <span className={`knowledge-source-icon knowledge-source-icon-${kind}`} aria-hidden="true">
      {kind === "document" ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 3h9l3 3v15H6z" />
          <path d="M15 3v4h4M9 11h6M9 15h6" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 5h14v14H5z" />
          <path d="M8 9h8M8 13h5M8 17h3" />
        </svg>
      )}
    </span>
  );
}

function KnowledgeGroup({
  title,
  description,
  kind,
  items,
  totalContents,
}: {
  title: string;
  description: string;
  kind: WeKnoraKnowledgeBase["kind"];
  items: WeKnoraKnowledgeBase[];
  totalContents: number;
}) {
  const subtotal = calculateGroupSubtotal(items, kind, totalContents);
  const maxGroupCount = items.reduce((max, item) => Math.max(max, item.count), 0);

  return (
    <section className="knowledge-group" aria-labelledby={`knowledge-group-${kind}`}>
      <header className="knowledge-group-header">
        <div className="knowledge-group-title-wrapper">
          <h2 id={`knowledge-group-${kind}`}>{title}</h2>
          <p>{description}</p>
        </div>
        <div className="knowledge-group-subtotal" aria-label={`Subtotal für ${title}`}>
          <span className="knowledge-subtotal-badge">
            {subtotal.kbCount} {subtotal.kbCount === 1 ? "Quelle" : "Quellen"}
          </span>
          <span className="knowledge-subtotal-count">
            {formatCount(subtotal.totalCount)} {kind === "document" ? "Dokumente" : "FAQ-Einträge"}
          </span>
          <span className="knowledge-subtotal-percent">
            ({formatPercent(subtotal.percentage)})
          </span>
        </div>
      </header>

      {items.length > 0 ? (
        <ul className="knowledge-source-list">
          {items.map((item) => {
            const itemRelativePercent = maxGroupCount > 0 ? (item.count / maxGroupCount) * 100 : 0;
            const itemOverallPercent = totalContents > 0 ? (item.count / totalContents) * 100 : 0;

            return (
              <li className="knowledge-source-row" key={item.id}>
                <KnowledgeIcon kind={item.kind} />
                <div className="knowledge-source-copy">
                  <div className="knowledge-source-title-line">
                    <strong>{item.name}</strong>
                    <span className="knowledge-source-kind-badge">
                      {item.kind === "document" ? "Dokument" : "FAQ"}
                    </span>
                  </div>
                  <div className="knowledge-source-status-line">
                    <span className={item.isProcessing || item.processingCount > 0 ? "is-processing" : ""}>
                      {item.isProcessing || item.processingCount > 0
                        ? `${formatCount(item.processingCount)} in Verarbeitung`
                        : "Aktuell verfügbar"}
                    </span>
                    <span className="knowledge-source-overall-pct">
                      Anteil: {formatPercent(itemOverallPercent)}
                    </span>
                  </div>
                  <div
                    className="knowledge-source-progress"
                    role="img"
                    aria-label={`Relative Größe in der Gruppe: ${formatPercent(itemRelativePercent)}`}
                  >
                    <span
                      className={`knowledge-source-progress-bar knowledge-source-progress-${item.kind}`}
                      style={{ width: `${itemRelativePercent}%` }}
                    />
                  </div>
                </div>
                <div className="knowledge-source-count">
                  <strong>{formatCount(item.count)}</strong>
                  <span>{item.kind === "document"
                    ? item.count === 1 ? "Dokument" : "Dokumente"
                    : item.count === 1 ? "FAQ-Eintrag" : "FAQ-Einträge"}</span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="knowledge-group-empty">Keine Wissensquellen verfügbar.</p>
      )}
    </section>
  );
}

function LoadingState() {
  return (
    <div className="knowledge-landscape-skeleton" aria-busy="true" aria-label="Wissenslandschaft wird geladen">
      <div className="knowledge-skeleton-line knowledge-skeleton-title" />
      <div className="knowledge-skeleton-stats">
        {Array.from({ length: 4 }, (_, index) => <div key={index} className="knowledge-skeleton-card" />)}
      </div>
      <div className="knowledge-skeleton-analytics">
        <div className="knowledge-skeleton-panel" />
        <div className="knowledge-skeleton-panel" />
      </div>
      <div className="knowledge-skeleton-groups">
        <div className="knowledge-skeleton-panel" />
        <div className="knowledge-skeleton-panel" />
      </div>
      <span className="sr-only">Wissenslandschaft wird geladen.</span>
    </div>
  );
}

export default function KnowledgeLandscapeView({ accessToken }: KnowledgeLandscapeViewProps) {
  const [state, setState] = useState<ViewState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function loadDashboard() {
      if (!accessToken) {
        setState({ status: "error", message: "Deine Anmeldung ist abgelaufen. Bitte erneut anmelden." });
        return;
      }
      try {
        const response = await fetch("/api/weknora-data", {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null) as unknown;
        if (!response.ok) {
          const message = isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : "Die Wissenslandschaft konnte nicht geladen werden.";
          throw new DashboardResponseError(message);
        }
        if (!isDashboard(payload)) {
          throw new Error("Die Wissenslandschaft konnte nicht geladen werden.");
        }
        if (active) setState({ status: "ready", dashboard: payload });
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        setState({
          status: "error",
          message: error instanceof DashboardResponseError
            ? error.message
            : "Die Wissenslandschaft konnte nicht geladen werden.",
        });
      }
    }

    void loadDashboard();
    return () => {
      active = false;
      controller.abort();
    };
  }, [accessToken]);

  if (state.status === "loading") {
    return (
      <section className="forms-panel knowledge-landscape-panel" aria-labelledby="knowledge-landscape-title">
        <div className="knowledge-landscape-view">
          <header className="knowledge-landscape-header">
            <div className="knowledge-landscape-heading-copy">
              <p className="eyebrow">Transparenz</p>
              <h1 id="knowledge-landscape-title">Wissenslandschaft</h1>
              <p>Ein Überblick über die Wissensquellen, die Fred für seine Antworten zur Verfügung stehen.</p>
            </div>
          </header>
          <LoadingState />
        </div>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="forms-panel knowledge-landscape-panel" aria-labelledby="knowledge-landscape-title">
        <div className="knowledge-landscape-view">
          <header className="knowledge-landscape-header">
            <div className="knowledge-landscape-heading-copy">
              <p className="eyebrow">Transparenz</p>
              <h1 id="knowledge-landscape-title">Wissenslandschaft</h1>
              <p>Ein Überblick über die Wissensquellen, die Fred für seine Antworten zur Verfügung stehen.</p>
            </div>
          </header>
          <div className="knowledge-landscape-error" role="alert">
            <strong>Daten derzeit nicht verfügbar</strong>
            <p>{state.message}</p>
          </div>
        </div>
      </section>
    );
  }

  const { dashboard } = state;
  const documents = dashboard.knowledgeBases.filter(({ kind }) => kind === "document");
  const faqs = dashboard.knowledgeBases.filter(({ kind }) => kind === "faq");
  const documentPercent = dashboard.totals.contents > 0
    ? (dashboard.totals.documents / dashboard.totals.contents) * 100
    : 0;
  const faqPercent = dashboard.totals.contents > 0 ? 100 - documentPercent : 0;
  const isProcessing = dashboard.totals.processing > 0
    || dashboard.knowledgeBases.some((item) => item.isProcessing);

  const dominantKB = getDominantKnowledgeBase(dashboard.knowledgeBases, dashboard.totals.contents);
  const rankedKBs = getRankedKnowledgeBases(dashboard.knowledgeBases, dashboard.totals.contents);

  const docSubtotal = calculateGroupSubtotal(dashboard.knowledgeBases, "document", dashboard.totals.contents);
  const faqSubtotal = calculateGroupSubtotal(dashboard.knowledgeBases, "faq", dashboard.totals.contents);

  const statCards = [
    { label: "Wissensbasen", value: dashboard.totals.knowledgeBases, subtext: `${dashboard.totals.knowledgeBases} aktive Quellen` },
    { label: "Inhalte gesamt", value: dashboard.totals.contents, subtext: "Gesamte Wissensbasis" },
    { label: "Dokumente", value: dashboard.totals.documents, subtext: `${formatPercent(docSubtotal.percentage)} aller Inhalte` },
    { label: "FAQ-Einträge", value: dashboard.totals.faqEntries, subtext: `${formatPercent(faqSubtotal.percentage)} aller Inhalte` },
  ];

  return (
    <section className="forms-panel knowledge-landscape-panel" aria-labelledby="knowledge-landscape-title">
      <div className="knowledge-landscape-view">
        <header className="knowledge-landscape-header">
          <div className="knowledge-landscape-heading-copy">
            <p className="eyebrow">Transparenz</p>
            <h1 id="knowledge-landscape-title">Wissenslandschaft</h1>
            <p>Ein Überblick über die Wissensquellen, die Fred für seine Antworten zur Verfügung stehen.</p>
          </div>
          <div className="knowledge-readiness" aria-label={isProcessing
            ? dashboard.totals.processing > 0
              ? `${dashboard.totals.processing} Inhalte werden verarbeitet`
              : "Wissensquellen werden aktualisiert"
            : "Alle Wissensquellen sind bereit"}>
            <span className={isProcessing ? "is-processing" : "is-ready"} aria-hidden="true" />
            <div>
              <strong>{isProcessing ? "Aktualisierung läuft" : "Bereit"}</strong>
              <span>Datenstand: <time dateTime={dashboard.fetchedAt}>{formatTimestamp(dashboard.fetchedAt)}</time></span>
            </div>
          </div>
        </header>

        {dashboard.stale ? (
          <div className="knowledge-landscape-stale" role="status">
            Die letzte Aktualisierung war nicht erreichbar. Angezeigt wird der zuletzt verfügbare Datenstand.
          </div>
        ) : null}

        {dashboard.knowledgeBases.length === 0 ? (
          <div className="knowledge-landscape-empty">
            <strong>Keine Wissensquellen verfügbar</strong>
            <p>Sobald Wissensquellen freigegeben sind, werden sie hier angezeigt.</p>
          </div>
        ) : (
          <>
            <dl className="knowledge-landscape-stats" aria-label="Kennzahlen der Wissenslandschaft">
              {statCards.map((card) => (
                <div className="knowledge-stat-card" key={card.label}>
                  <dt>{card.label}</dt>
                  <dd>{formatCount(card.value)}</dd>
                  <span className="knowledge-stat-subtext">{card.subtext}</span>
                </div>
              ))}
            </dl>

            <div className="knowledge-analytics-grid">
              <section className="knowledge-mix" aria-labelledby="knowledge-mix-title">
                <div className="knowledge-mix-heading">
                  <div>
                    <p className="eyebrow">Verteilung</p>
                    <h2 id="knowledge-mix-title">Wissensmix</h2>
                  </div>
                  <p>{formatCount(dashboard.totals.contents)} Inhalte insgesamt</p>
                </div>
                <div
                  className="knowledge-mix-bar"
                  role="img"
                  aria-label={`Dokumente: ${formatCount(dashboard.totals.documents)} (${formatPercent(documentPercent)}); FAQ-Einträge: ${formatCount(dashboard.totals.faqEntries)} (${formatPercent(faqPercent)})`}
                >
                  <span className="knowledge-mix-documents" style={{ width: `${documentPercent}%` }} />
                  <span className="knowledge-mix-faqs" style={{ width: `${faqPercent}%` }} />
                </div>
                <div className="knowledge-mix-legend">
                  <div>
                    <span className="knowledge-mix-key knowledge-mix-key-documents" aria-hidden="true" />
                    <span><strong>{formatPercent(documentPercent)}</strong> Dokumente</span>
                    <span>{formatCount(dashboard.totals.documents)}</span>
                  </div>
                  <div>
                    <span className="knowledge-mix-key knowledge-mix-key-faqs" aria-hidden="true" />
                    <span><strong>{formatPercent(faqPercent)}</strong> FAQ-Einträge</span>
                    <span>{formatCount(dashboard.totals.faqEntries)}</span>
                  </div>
                </div>
              </section>

              {dominantKB ? (
                <section className="knowledge-dominant-card" aria-labelledby="knowledge-dominant-title">
                  <header className="knowledge-dominant-header">
                    <div>
                      <p className="eyebrow">Spitzenreiter</p>
                      <h2 id="knowledge-dominant-title">Hauptwissensquelle</h2>
                    </div>
                    <span className={`knowledge-kind-pill knowledge-kind-pill-${dominantKB.kind}`}>
                      {dominantKB.kind === "document" ? "Dokumentwissen" : "FAQ-Sammlung"}
                    </span>
                  </header>
                  <div className="knowledge-dominant-body">
                    <strong className="knowledge-dominant-name">{dominantKB.name}</strong>
                    <div className="knowledge-dominant-metrics">
                      <div className="knowledge-dominant-count">
                        <span className="knowledge-dominant-value">{formatCount(dominantKB.count)}</span>
                        <span className="knowledge-dominant-label">Inhalte</span>
                      </div>
                      <div className="knowledge-dominant-pct">
                        <span className="knowledge-dominant-value">{formatPercent(dominantKB.percentage)}</span>
                        <span className="knowledge-dominant-label">aller Inhalte</span>
                      </div>
                    </div>
                    <p className="knowledge-dominant-note">
                      Stellt den größten Einzelbestand der aktuellen Wissenslandschaft dar.
                    </p>
                  </div>
                </section>
              ) : null}
            </div>

            <section className="knowledge-ranking-section" aria-labelledby="knowledge-ranking-title">
              <header className="knowledge-ranking-header">
                <div>
                  <p className="eyebrow">Hierarchie & Umfang</p>
                  <h2 id="knowledge-ranking-title">Quellen-Ranking</h2>
                </div>
                <p>Übersicht aller Wissensquellen geordnet nach Umfang und relativem Anteil.</p>
              </header>

              <ol className="knowledge-ranking-list">
                {rankedKBs.map((item) => (
                  <li className="knowledge-ranking-row" key={item.id}>
                    <span className="knowledge-ranking-rank" aria-label={`Rang ${item.rank}`}>
                      #{item.rank}
                    </span>
                    <KnowledgeIcon kind={item.kind} />
                    <div className="knowledge-ranking-content">
                      <div className="knowledge-ranking-meta">
                        <strong className="knowledge-ranking-name">{item.name}</strong>
                        <span className={`knowledge-kind-badge knowledge-kind-badge-${item.kind}`}>
                          {item.kind === "document" ? "Dokument" : "FAQ"}
                        </span>
                      </div>
                      <div
                        className="knowledge-ranking-bar-wrapper"
                        role="img"
                        aria-label={`${item.name}: ${formatCount(item.count)} Inhalte (${formatPercent(item.percentage)} des Gesamtwissens)`}
                      >
                        <span
                          className={`knowledge-ranking-bar knowledge-ranking-bar-${item.kind}`}
                          style={{ width: `${item.percentage}%` }}
                        />
                      </div>
                    </div>
                    <div className="knowledge-ranking-stats">
                      <strong>{formatCount(item.count)}</strong>
                      <span>{formatPercent(item.percentage)}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <div className="knowledge-landscape-groups">
              <KnowledgeGroup
                title="Dokumentwissen"
                description="Freigegebene Dokumentbestände für fundierte Antworten."
                kind="document"
                items={documents}
                totalContents={dashboard.totals.contents}
              />
              <KnowledgeGroup
                title="Strukturiertes Wissen"
                description="Kompakte Frage-Antwort-Sammlungen für wiederkehrende Themen."
                kind="faq"
                items={faqs}
                totalContents={dashboard.totals.contents}
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
