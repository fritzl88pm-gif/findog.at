import type { BfgNewsletterItem } from "@/lib/bfg-newsletters";
import { extractBfgGzCandidates, linkVerifiedBfgCitations, verifyBfgCitations } from "@/lib/findok/bfg-citations";

export async function linkNewsletterItems(
  items: BfgNewsletterItem[],
  fetchImpl: typeof fetch = fetch,
): Promise<BfgNewsletterItem[]> {
  const candidates = new Set<string>();
  for (const item of items) {
    for (const gz of extractBfgGzCandidates(item.contentMarkdown)) {
      candidates.add(gz);
    }
  }
  if (candidates.size === 0) return items;

  const { verified } = await verifyBfgCitations([...candidates], fetchImpl);
  if (verified.length === 0) return items;

  return items.map((item) => ({
    ...item,
    contentMarkdown: linkVerifiedBfgCitations(item.contentMarkdown, verified, {
      target: "fullText",
    }),
  }));
}

