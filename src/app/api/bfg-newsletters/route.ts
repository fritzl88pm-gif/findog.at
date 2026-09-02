import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import {
  BFG_NEWSLETTER_SELECT,
  mapBfgNewsletterItem,
  type BfgNewsletterItem,
  type BfgNewsletterRow,
} from "@/lib/bfg-newsletters";
import { UserVisibleError } from "@/lib/errors";
import {
  extractBfgGzCandidates,
  linkVerifiedBfgCitations,
  verifyBfgCitations,
} from "@/lib/findok/bfg-citations";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Vary: "Authorization",
    },
  });
}

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

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) throw new UserVisibleError("BFG Newsletter ist derzeit nicht verfügbar.", 503);
    await authenticateSupabaseRequest(request, supabase);

    const { data, error } = await supabase
      .from("bfg_newsletters")
      .select(BFG_NEWSLETTER_SELECT)
      .is("deleted_at", null)
      .order("publication_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(500);
    if (error) throw new UserVisibleError("BFG Newsletter konnte nicht geladen werden.", 503);

    const items = ((data ?? []) as unknown as BfgNewsletterRow[]).map(mapBfgNewsletterItem);
    let linkedItems = items;
    try {
      linkedItems = await linkNewsletterItems(items);
    } catch {
      // Best effort: on Findok timeouts/errors the raw markdown stays readable.
    }

    return json({ items: linkedItems });
  } catch (error) {
    if (error instanceof UserVisibleError) return json({ error: error.message }, error.status);
    return json({ error: "BFG Newsletter ist derzeit nicht verfügbar." }, 500);
  }
}
