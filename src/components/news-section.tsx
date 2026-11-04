import type { DashboardNewsItem } from "@/lib/dashboard";

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("de-AT", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Vienna",
  }).format(new Date(value));
}

function NewsCard({
  item,
  isFeatured,
  sectionHeading,
}: {
  item: DashboardNewsItem;
  isFeatured: boolean;
  sectionHeading: "h1" | "h2";
}) {
  const HeadingTag = sectionHeading === "h1"
    ? (isFeatured ? "h2" : "h3")
    : (isFeatured ? "h3" : "h4");

  return (
    <article
      className={`dashboard-news-card ${isFeatured ? "is-featured" : "is-secondary"}`}
    >
      <div className="dashboard-news-card-topline">
        <div className="dashboard-news-tags">
          <span className={`dashboard-news-badge ${isFeatured ? "" : "is-subtle"}`.trim()}>
            Plattformupdate
          </span>
          {item.pinned ? (
            <span className="dashboard-pinned-badge">Angeheftet</span>
          ) : null}
        </div>
        {item.publishedAt ? (
          <time dateTime={item.publishedAt} className="dashboard-news-time">
            {formatTimestamp(item.publishedAt)}
          </time>
        ) : null}
      </div>

      <HeadingTag className="dashboard-news-title">{item.title}</HeadingTag>

      <p className="dashboard-news-summary">{item.summary}</p>

    </article>
  );
}

export function NewsSection({
  id,
  title,
  subtitle,
  eyebrow,
  headingLevel = "h2",
  items,
  error,
  isLoading,
}: {
  id: string;
  title: string;
  subtitle: string;
  eyebrow?: string;
  headingLevel?: "h1" | "h2";
  items: DashboardNewsItem[];
  error?: string;
  isLoading: boolean;
}) {
  const HeadingTag = headingLevel;
  const featuredItem = items[0];
  const secondaryItems = items.slice(1);

  return (
    <section className="dashboard-section dashboard-news-section" aria-labelledby={id} aria-busy={isLoading}>
      <div className="dashboard-section-heading">
        <div>
          {eyebrow ? <span className="dashboard-section-eyebrow">{eyebrow}</span> : null}
          <HeadingTag id={id}>{title}</HeadingTag>
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
            <NewsCard item={featuredItem} isFeatured={true} sectionHeading={headingLevel} />
          ) : null}
          {secondaryItems.length > 0 ? (
            <div className="dashboard-news-secondary-list">
              {secondaryItems.map((item) => (
                <NewsCard key={item.id} item={item} isFeatured={false} sectionHeading={headingLevel} />
              ))}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
