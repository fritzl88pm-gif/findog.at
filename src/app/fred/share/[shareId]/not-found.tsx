import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Geteilte Fred-Antwort",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    googleBot: { index: false, follow: false, noarchive: true },
  },
};

export default function FredPublicShareNotFound() {
  return (
    <div className="fred-public-share-shell">
      <header className="fred-public-share-header">
        <div className="fred-public-share-brand">
          <span className="austria-flag" aria-hidden="true">
            <span className="red" />
            <span className="white" />
            <span className="red" />
          </span>
          <span className="fred-public-share-brand-title">findog.at</span>
          <span className="fred-public-share-badge">Fred</span>
        </div>
        <span className="fred-public-share-doc-type">Geteilte Antwort</span>
      </header>

      <main className="fred-public-share">
        <div className="fred-public-share-card fred-public-share-card-unavailable">
          <div className="fred-public-share-unavailable-icon" aria-hidden="true">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <p className="fred-public-share-text">
            Diese geteilte Fred-Antwort ist nicht mehr verfügbar.
          </p>
        </div>

        <footer className="fred-public-share-footer">
          <span>findog.at — KI-Recherche für österreichisches Steuer- &amp; Wirtschaftsrecht</span>
        </footer>
      </main>
    </div>
  );
}
