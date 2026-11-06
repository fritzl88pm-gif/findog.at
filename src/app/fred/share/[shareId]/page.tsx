import type { Metadata } from "next";
import { notFound } from "next/navigation";

import RichAnswer from "@/components/rich-answer";
import { loadFredPublicShare } from "@/lib/fred-public-share";
import { citedSourceLabel, renderCitedAnswer } from "@/lib/fred/citations";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Geteilte Fred-Antwort",
  description: "Geteilte Fred-Antwort",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    googleBot: { index: false, follow: false, noarchive: true },
  },
};

type PageParams = {
  params: Promise<{ shareId: string }>;
};

export default async function FredPublicSharePage({ params }: PageParams) {
  const { shareId } = await params;

  let share;
  try {
    share = await loadFredPublicShare(shareId);
  } catch {
    notFound();
  }

  // Citation tags become numbered markers; the public page shows them as plain [n].
  const citedAnswer = renderCitedAnswer(share.answer_content);
  const sourceNames = citedAnswer.cited.map(citedSourceLabel);

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
        <div className="fred-public-share-card">
          <section
            className="fred-public-share-section fred-public-share-question"
            aria-labelledby="shared-question-heading"
          >
            <div className="fred-public-share-section-header">
              <span className="fred-public-share-section-tag" aria-hidden="true" />
              <h1 id="shared-question-heading">Anfrage</h1>
            </div>
            <p className="fred-public-share-text">{share.question_content}</p>
          </section>

          <div className="fred-public-share-divider" aria-hidden="true" />

          <section
            className="fred-public-share-section fred-public-share-answer"
            aria-labelledby="shared-answer-heading"
          >
            <div className="fred-public-share-section-header">
              <span className="fred-public-share-section-tag fred-public-share-section-tag-answer" aria-hidden="true" />
              <h2 id="shared-answer-heading">Freds Antwort</h2>
            </div>
            <RichAnswer content={citedAnswer.text} showTableCopyActions={false} />
            {sourceNames.length > 0 ? (
              <div className="fred-public-share-sources">
                <strong>Quellen</strong>
                <ol>
                  {sourceNames.map((name, index) => (
                    <li key={`${index}-${name}`} value={index + 1}>{name}</li>
                  ))}
                </ol>
              </div>
            ) : null}
          </section>
        </div>

        <footer className="fred-public-share-footer">
          <span>findog.at — KI-Recherche für österreichisches Steuer- &amp; Wirtschaftsrecht</span>
        </footer>
      </main>
    </div>
  );
}
