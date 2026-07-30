import type { Metadata } from "next";
import { notFound } from "next/navigation";

import RichAnswer from "@/components/rich-answer";
import { loadFredPublicShare } from "@/lib/fred-public-share";
import { transformWeKnoraAnswer } from "@/lib/weknora/fred-research";

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

  // Transform the stored answer content so legacy <kb>/<web> tags are handled.
  const transformedAnswer = transformWeKnoraAnswer(share.answer_content);

  return (
    <main className="fred-public-share">
      <section aria-labelledby="shared-question-heading">
        <h1 id="shared-question-heading">Anfrage</h1>
        <p className="fred-public-share-text">{share.question_content}</p>
      </section>
      <section aria-labelledby="shared-answer-heading">
        <h2 id="shared-answer-heading">Freds Antwort</h2>
        <RichAnswer content={transformedAnswer.text} showTableCopyActions={false} />
      </section>
    </main>
  );
}
