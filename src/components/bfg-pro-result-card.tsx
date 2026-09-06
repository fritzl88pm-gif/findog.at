export type BfgProResult = {
  title: string;
  gz: string;
  documentType: string;
  decisionDate: string;
  publicationDate: string;
  caseSummary: string;
  whyRelevant: string;
  score: number;
  htmlUrl: string | null;
  pdfUrl: string | null;
  legalIssue: string;
  similarities: string;
  differences: string;
  sourceQuote: string | null;
  periodAssessment: string;
  textTruncated: boolean;
};

export function normalizeBfgProResults(value: unknown): BfgProResult[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const payload = value as Record<string, unknown>;
  if (!Array.isArray(payload.results) || payload.results.length > 10) {
    return null;
  }
  const results = payload.results.flatMap((value): BfgProResult[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [];
    }
    const item = value as Record<string, unknown>;
    if (
      typeof item.title !== "string"
      || typeof item.gz !== "string"
      || typeof item.documentType !== "string"
      || typeof item.decisionDate !== "string"
      || typeof item.publicationDate !== "string"
      || typeof item.caseSummary !== "string"
      || !item.caseSummary.trim()
      || item.caseSummary.length > 500
      || typeof item.whyRelevant !== "string"
      || typeof item.score !== "number"
      || item.score < 0
      || item.score > 100
      || (item.htmlUrl !== null && typeof item.htmlUrl !== "string")
      || (item.pdfUrl !== null && typeof item.pdfUrl !== "string")
      || typeof item.legalIssue !== "string"
      || typeof item.similarities !== "string"
      || typeof item.differences !== "string"
      || (item.sourceQuote !== null && typeof item.sourceQuote !== "string")
      || typeof item.periodAssessment !== "string"
      || typeof item.textTruncated !== "boolean"
    ) {
      return [];
    }
    return [{
      title: item.title,
      gz: item.gz,
      documentType: item.documentType,
      decisionDate: item.decisionDate,
      publicationDate: item.publicationDate,
      caseSummary: item.caseSummary,
      whyRelevant: item.whyRelevant,
      score: item.score,
      htmlUrl: item.htmlUrl,
      pdfUrl: item.pdfUrl,
      legalIssue: item.legalIssue,
      similarities: item.similarities,
      differences: item.differences,
      sourceQuote: item.sourceQuote,
      periodAssessment: item.periodAssessment,
      textTruncated: item.textTruncated,
    }];
  });
  return results.length === payload.results.length ? results : null;
}

function formatBfgPublicationDate(value: string): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function BfgProResultCard({ result }: { result: BfgProResult }) {
  return (
    <article>
      <h2>{result.title}</h2>
      <p className="bfg-result-meta">
        {[
          result.gz,
          result.documentType,
          result.decisionDate
            ? `Entscheidung vom ${formatBfgPublicationDate(result.decisionDate)}`
            : result.publicationDate
              ? `Veröffentlicht am ${formatBfgPublicationDate(result.publicationDate)}`
              : "",
        ].filter(Boolean).join(" · ")}
      </p>
      <div className="bfg-pro-relevance">
        <div className="bfg-pro-relevance-heading">
          <h3>Warum relevant</h3>
          <span className="bfg-pro-score">Relevanz {result.score}/100</span>
        </div>
        <p>{result.whyRelevant}</p>
      </div>
      {result.legalIssue ? (
        <div className="bfg-pro-excerpt">
          <h3>Rechtliche Kernfrage</h3>
          <p>{result.legalIssue}</p>
        </div>
      ) : null}
      {result.caseSummary ? (
        <div className="bfg-pro-excerpt">
          <h3>Sachverhalt</h3>
          <p>{result.caseSummary}</p>
        </div>
      ) : null}
      {result.similarities || result.differences ? (
        <div className="bfg-pro-excerpt">
          <h3>Sachverhaltsvergleich</h3>
          {result.similarities ? (
            <p><strong>Gemeinsamkeiten:</strong> {result.similarities}</p>
          ) : null}
          {result.differences ? (
            <p><strong>Unterschiede:</strong> {result.differences}</p>
          ) : null}
        </div>
      ) : null}
      {result.periodAssessment ? (
        <div className="bfg-pro-excerpt">
          <h3>Zeitliche Einordnung &amp; Rechtslage</h3>
          <p>{result.periodAssessment}</p>
        </div>
      ) : null}
      <div className="bfg-pro-excerpt">
        <h3>Quellenzitat</h3>
        {result.sourceQuote ? (
          <blockquote>„{result.sourceQuote}“</blockquote>
        ) : (
          <p>Kein verifiziertes Quellenzitat vorhanden.</p>
        )}
      </div>
      {result.textTruncated ? (
        <div className="bfg-pro-excerpt">
          <p><em>Hinweis: Bewertung erfolgte auf Basis eines gekürzten Entscheidungstextes (Teilnachweis).</em></p>
        </div>
      ) : null}
      <div className="bfg-result-links">
        {result.htmlUrl ? (
          <a href={result.htmlUrl} target="_blank" rel="noreferrer noopener">
            <svg className="bfg-result-link-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 5h5v5" />
              <path d="M10 14 19 5" />
              <path d="M19 14v5H5V5h5" />
            </svg>
            Entscheidung öffnen
          </a>
        ) : null}
        {result.pdfUrl ? (
          <a href={result.pdfUrl} target="_blank" rel="noreferrer noopener">
            <svg className="bfg-result-link-icon bfg-result-pdf-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
              <path d="M14 2v6h6" />
            </svg>
            PDF öffnen
          </a>
        ) : null}
      </div>
    </article>
  );
}
