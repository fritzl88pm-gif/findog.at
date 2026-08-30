"use client";

import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";

import {
  formatDashboardDate,
  getDashboardGreeting,
  type DashboardNewsItem,
  type DashboardPayload,
} from "@/lib/dashboard";

export type DashboardAppTarget =
  | "bfg-decisions"
  | "bfg-pro"
  | "data"
  | "scanning"
  | "reasonings"
  | "forms"
  | "downloads"
  | "german-sv-pension"
  | "l17b-currency"
  | "fredrun"
  | "quiz"
  | "administration";

export type DashboardConversation = {
  id: string;
  title: string;
  updatedAt: string;
  origin?: "web" | "telegram";
};

type Props = {
  accessToken: string;
  conversations: DashboardConversation[];
  isHistoryLoading: boolean;
  isAdmin: boolean;
  onStartConversation: () => void;
  onOpenConversation: (id: string) => void;
  onOpenApp: (target: DashboardAppTarget) => void;
};

type QuickLink = {
  label: string;
  description: string;
  icon: IconName;
  target?: DashboardAppTarget;
  primary?: boolean;
  adminOnly?: boolean;
};

type QuickLinkGroup = {
  title: string;
  links: QuickLink[];
};

type IconName = "home" | "chat" | "search" | "sparkles" | "database" | "scan" | "text" | "form" | "download" | "calculator" | "currency" | "game" | "quiz" | "admin" | "clock" | "external";

const QUICK_LINK_GROUPS: QuickLinkGroup[] = [
  {
    title: "Recherche",
    links: [
      { label: "Fred", description: "Rechtsfrage stellen", icon: "chat", primary: true },
      { label: "BFG Suche", description: "Entscheidungen finden", icon: "search", target: "bfg-decisions" },
      { label: "BFG Suche PRO", description: "KI-gestützt reihen", icon: "sparkles", target: "bfg-pro" },
      { label: "Daten", description: "Wissenslandschaft", icon: "database", target: "data" },
    ],
  },
  {
    title: "Arbeitswerkzeuge",
    links: [
      { label: "Scanning", description: "Belege auswerten", icon: "scan", target: "scanning" },
      { label: "Textbausteine", description: "Eigene Vorlagen", icon: "text", target: "reasonings" },
      { label: "Formulare", description: "Formulare erstellen", icon: "form", target: "forms" },
      { label: "Downloads", description: "Dokumente abrufen", icon: "download", target: "downloads" },
    ],
  },
  {
    title: "Spezialwerkzeuge",
    links: [
      { label: "Deutsche SV Rente", description: "Schnellcheck", icon: "calculator", target: "german-sv-pension" },
      { label: "L17b Währungsrechner", description: "Beträge umrechnen", icon: "currency", target: "l17b-currency" },
    ],
  },
  {
    title: "Lernen und Spiel",
    links: [
      { label: "Fredrun", description: "Lernspiel starten", icon: "game", target: "fredrun" },
      { label: "Quiz", description: "Wissen testen", icon: "quiz", target: "quiz", adminOnly: true },
    ],
  },
  {
    title: "Administration",
    links: [
      { label: "Administration", description: "System verwalten", icon: "admin", target: "administration", adminOnly: true },
    ],
  },
];

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    home: <><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></>,
    chat: <><path d="M4 5h16v11H8l-4 4V5Z"/><path d="M8 9h8M8 12h5"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M8 11h6"/></>,
    sparkles: <><path d="m12 3 1.4 4.2L18 9l-4.6 1.8L12 15l-1.4-4.2L6 9l4.6-1.8L12 3Z"/><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/></>,
    database: <><ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></>,
    scan: <><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8h10M7 12h10M7 16h6"/></>,
    text: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5V5.5Z"/><path d="M8 7h8M8 11h8"/></>,
    form: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h8"/></>,
    download: <><path d="M12 3v12m0 0 5-5m-5 5-5-5"/><path d="M5 20h14"/></>,
    calculator: <><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 11h2M14 11h2M8 16h2M14 16h2"/></>,
    currency: <><circle cx="12" cy="12" r="10"/><path d="M16 8.5a5 5 0 1 0 0 7M7 10h7M7 14h7"/></>,
    game: <><path d="M7 9h10a4 4 0 0 1 3.8 5.2l-1 3a2 2 0 0 1-3.3.8L14 16h-4l-2.5 2a2 2 0 0 1-3.3-.8l-1-3A4 4 0 0 1 7 9Z"/><path d="M7 13h4M9 11v4M16 13h.01"/></>,
    quiz: <><circle cx="12" cy="12" r="10"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 3-3 5M12 18h.01"/></>,
    admin: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    external: <><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/></>,
  };
  return (
    <svg className="dashboard-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("de-AT", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Vienna",
  }).format(new Date(value));
}

function formatLegalDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function NewsCard({
  item,
  isFeatured,
}: {
  item: DashboardNewsItem;
  isFeatured: boolean;
}) {
  const isLegal = item.kind === "legal";
  const HeadingTag = isFeatured ? "h3" : "h4";

  return (
    <article
      className={`dashboard-news-card ${isFeatured ? "is-featured" : "is-secondary"}`}
    >
      <div className="dashboard-news-card-topline">
        <div className="dashboard-news-tags">
          <span className={`dashboard-news-badge ${isFeatured ? "" : "is-subtle"}`.trim()}>
            {isLegal ? "Rechtsmeldung" : "Produktmeldung"}
          </span>
          {item.pinned ? (
            <span className="dashboard-pinned-badge">Angeheftet</span>
          ) : null}
        </div>
        {!isLegal && item.publishedAt ? (
          <time dateTime={item.publishedAt} className="dashboard-news-time">
            {formatTimestamp(item.publishedAt)}
          </time>
        ) : null}
      </div>

      <HeadingTag className="dashboard-news-title">{item.title}</HeadingTag>

      <p className="dashboard-news-summary">{item.summary}</p>

      {isLegal ? (
        <>
          <dl className={`dashboard-legal-meta ${isFeatured ? "" : "is-compact"}`.trim()}>
            <div>
              <dt>Quelle</dt>
              <dd>{item.sourceSystem?.toUpperCase()}</dd>
            </div>
            <div>
              <dt>Typ</dt>
              <dd>
                {item.documentKind === "entscheidungsdokument"
                  ? "Entscheidungsdokument"
                  : item.documentKind === "rechtssatz"
                    ? "Rechtssatz"
                    : "Norm"}
              </dd>
            </div>
            <div>
              <dt>Datum</dt>
              <dd>{formatLegalDate(item.documentDate)}</dd>
            </div>
            <div>
              <dt>Stichtag</dt>
              <dd>{formatLegalDate(item.asOfDate)}</dd>
            </div>
          </dl>

          <div className="dashboard-news-source-row">
            <span title={item.sourceIdentifier ?? undefined}>
              {item.sourceIdentifier}
            </span>
            {item.sourceUrl ? (
              <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                Amtliche Quelle <Icon name="external" />
              </a>
            ) : null}
          </div>

          <p className="dashboard-legal-note">
            Redaktionelle Information zum angegebenen Stichtag; maßgeblich bleibt die amtliche Quelle.
          </p>
        </>
      ) : null}
    </article>
  );
}

function NewsSection({
  id,
  title,
  subtitle,
  eyebrow,
  items,
  error,
  isLoading,
}: {
  id: string;
  title: string;
  subtitle: string;
  eyebrow?: string;
  items: DashboardNewsItem[];
  error?: string;
  isLoading: boolean;
}) {
  const featuredItem = items[0];
  const secondaryItems = items.slice(1);

  return (
    <section className="dashboard-section dashboard-news-section" aria-labelledby={id} aria-busy={isLoading}>
      <div className="dashboard-section-heading">
        <div>
          {eyebrow ? <span className="dashboard-section-eyebrow">{eyebrow}</span> : null}
          <h2 id={id}>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </div>
      {isLoading ? (
        <div className="dashboard-news-list" role="status" aria-label={`${title} werden geladen`}>
          <div className="dashboard-news-card is-featured dashboard-skeleton-card" />
          <div className="dashboard-news-card is-secondary dashboard-skeleton-card" />
        </div>
      ) : error ? (
        <div className="dashboard-inline-state is-error" role="status">
          <strong>Vorübergehend nicht verfügbar</strong>
          <span>{error}</span>
        </div>
      ) : items.length === 0 ? (
        <div className="dashboard-inline-state">
          <strong>Derzeit keine Meldungen</strong>
          <span>Neue, redaktionell freigegebene Inhalte erscheinen hier.</span>
        </div>
      ) : (
        <div className="dashboard-news-list">
          {featuredItem ? (
            <NewsCard item={featuredItem} isFeatured={true} />
          ) : null}
          {secondaryItems.length > 0 ? (
            <div className="dashboard-news-secondary-list">
              {secondaryItems.map((item) => (
                <NewsCard key={item.id} item={item} isFeatured={false} />
              ))}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

export default function DashboardView({
  accessToken,
  conversations,
  isHistoryLoading,
  isAdmin,
  onStartConversation,
  onOpenConversation,
  onOpenApp,
}: Props) {
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [now] = useState(() => new Date());
  const latestConversation = conversations[0];

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    let isActive = true;
    queueMicrotask(() => {
      if (!isActive) return;
      setIsLoading(true);
      setLoadError("");
      void fetch("/api/dashboard", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          const body = await response.json().catch(() => ({})) as DashboardPayload & { error?: string };
          if (!response.ok || !body.counts || !body.news || !body.knowledge) {
            throw new Error(body.error ?? "Die Startseitendaten konnten nicht geladen werden.");
          }
          if (isActive) setPayload(body);
        })
        .catch((error) => {
          if (isActive && (error as { name?: string }).name !== "AbortError") {
            setLoadError(error instanceof Error ? error.message : "Die Startseitendaten konnten nicht geladen werden.");
          }
        })
        .finally(() => {
          if (isActive) setIsLoading(false);
        });
    });
    return () => {
      isActive = false;
      controller.abort();
    };
  }, [accessToken]);

  return (
    <section className="dashboard-panel" aria-labelledby="dashboard-title">
      <div className="dashboard-view">
        <header className="dashboard-hero">
          <div className="dashboard-hero-copy">
            <p className="dashboard-date">{formatDashboardDate(now)}</p>
            <h1 id="dashboard-title">{getDashboardGreeting(now)}!</h1>
            <p>Was darf Fred heute für Sie recherchieren oder vorbereiten?</p>
            <div className="dashboard-hero-actions">
              <button className="dashboard-primary-action" type="button" onClick={onStartConversation}>
                <Icon name="chat" /> Neue Frage an Fred
              </button>
              {latestConversation ? (
                <button
                  className="dashboard-secondary-action"
                  type="button"
                  onClick={() => onOpenConversation(latestConversation.id)}
                  disabled={isHistoryLoading}
                >
                  Letzte Unterhaltung fortsetzen
                </button>
              ) : null}
            </div>
          </div>
          <div className="dashboard-hero-art" aria-hidden="true">
            <span className="dashboard-hero-ring" />
            <Image src="/fred_casual.png" alt="" width={409} height={614} priority unoptimized />
          </div>
        </header>

        {loadError ? (
          <div className="dashboard-data-warning" role="status">
            <strong>Einige Startseitendaten sind vorübergehend nicht verfügbar.</strong>
            <span>{loadError} Quicklinks und Unterhaltungen können weiterhin verwendet werden.</span>
          </div>
        ) : null}

        <div className="dashboard-news-grid">
          <NewsSection
            id="dashboard-product-news-title"
            title="Neu bei findog.at"
            subtitle="Produktneuigkeiten und Hinweise"
            eyebrow="Plattform-Updates"
            items={payload?.news.product ?? []}
            error={payload?.sectionErrors?.productNews ?? (loadError || undefined)}
            isLoading={isLoading}
          />
          <NewsSection
            id="dashboard-legal-news-title"
            title="Recht aktuell"
            subtitle="Redaktionell freigegebene Meldungen mit amtlicher Quelle und Stichtag"
            eyebrow="Recht & Praxis"
            items={payload?.news.legal ?? []}
            error={payload?.sectionErrors?.legalNews ?? (loadError || undefined)}
            isLoading={isLoading}
          />
        </div>

        <section className="dashboard-section dashboard-quicklinks-section" aria-labelledby="dashboard-quicklinks-title">
          <div className="dashboard-section-heading">
            <div>
              <h2 id="dashboard-quicklinks-title">Anwendungen</h2>
              <p>Direkt zum passenden Arbeitsbereich</p>
            </div>
          </div>
          <div className="dashboard-quicklink-groups">
            {QUICK_LINK_GROUPS.map((group) => {
              const links = group.links.filter((link) => !link.adminOnly || isAdmin);
              if (links.length === 0) return null;
              return (
                <section key={group.title} className="dashboard-quicklink-group" aria-labelledby={`quicklink-${group.title.replaceAll(" ", "-").toLowerCase()}`}>
                  <h3 id={`quicklink-${group.title.replaceAll(" ", "-").toLowerCase()}`}>{group.title}</h3>
                  <div className="dashboard-quicklink-grid">
                    {links.map((link) => (
                      <button
                        key={link.label}
                        type="button"
                        onClick={link.primary ? onStartConversation : () => link.target && onOpenApp(link.target)}
                      >
                        <span className="dashboard-quicklink-icon"><Icon name={link.icon} /></span>
                        <span><strong>{link.label}</strong><small>{link.description}</small></span>
                        <span aria-hidden="true">›</span>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </section>
      </div>
    </section>
  );
}
