"use client";

import { useEffect, useState } from "react";

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
}: {
  title: string;
  description: string;
  kind: WeKnoraKnowledgeBase["kind"];
  items: WeKnoraKnowledgeBase[];
}) {
  return (
    <section className="knowledge-group" aria-labelledby={`knowledge-group-${kind}`}>
      <header className="knowledge-group-header">
        <div>
          <h2 id={`knowledge-group-${kind}`}>{title}</h2>
          <p>{description}</p>
        </div>
      </header>
      {items.length > 0 ? (
        <ul className="knowledge-source-list">
          {items.map((item) => (
            <li className="knowledge-source-row" key={item.id}>
              <KnowledgeIcon kind={item.kind} />
              <div className="knowledge-source-copy">
                <strong>{item.name}</strong>
                <span className={item.isProcessing || item.processingCount > 0 ? "is-processing" : ""}>
                  {item.isProcessing || item.processingCount > 0
                    ? `${formatCount(item.processingCount)} in Verarbeitung`
                    : "Aktuell verfügbar"}
                </span>
              </div>
              <div className="knowledge-source-count">
                <strong>{formatCount(item.count)}</strong>
                <span>{item.kind === "document"
                  ? item.count === 1 ? "Dokument" : "Dokumente"
                  : item.count === 1 ? "FAQ-Eintrag" : "FAQ-Einträge"}</span>
              </div>
            </li>
          ))}
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
  const statCards = [
    { label: "Wissensbasen", value: dashboard.totals.knowledgeBases },
    { label: "Inhalte", value: dashboard.totals.contents },
    { label: "Dokumente", value: dashboard.totals.documents },
    { label: "FAQ-Einträge", value: dashboard.totals.faqEntries },
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
                </div>
              ))}
            </dl>

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
                aria-label={`Dokumente: ${formatCount(dashboard.totals.documents)} (${documentPercent.toLocaleString("de-AT", { maximumFractionDigits: 1 })} Prozent); FAQ-Einträge: ${formatCount(dashboard.totals.faqEntries)} (${faqPercent.toLocaleString("de-AT", { maximumFractionDigits: 1 })} Prozent)`}
              >
                <span className="knowledge-mix-documents" style={{ width: `${documentPercent}%` }} />
                <span className="knowledge-mix-faqs" style={{ width: `${faqPercent}%` }} />
              </div>
              <div className="knowledge-mix-legend">
                <div>
                  <span className="knowledge-mix-key knowledge-mix-key-documents" aria-hidden="true" />
                  <span><strong>{documentPercent.toLocaleString("de-AT", { maximumFractionDigits: 1 })} %</strong> Dokumente</span>
                  <span>{formatCount(dashboard.totals.documents)}</span>
                </div>
                <div>
                  <span className="knowledge-mix-key knowledge-mix-key-faqs" aria-hidden="true" />
                  <span><strong>{faqPercent.toLocaleString("de-AT", { maximumFractionDigits: 1 })} %</strong> FAQ-Einträge</span>
                  <span>{formatCount(dashboard.totals.faqEntries)}</span>
                </div>
              </div>
            </section>

            <div className="knowledge-landscape-groups">
              <KnowledgeGroup
                title="Dokumentwissen"
                description="Freigegebene Dokumentbestände für fundierte Antworten."
                kind="document"
                items={documents}
              />
              <KnowledgeGroup
                title="Strukturiertes Wissen"
                description="Kompakte Frage-Antwort-Sammlungen für wiederkehrende Themen."
                kind="faq"
                items={faqs}
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
