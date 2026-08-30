import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import {
  BFG_NEWSLETTER_SELECT,
  mapBfgNewsletterItem,
  type BfgNewsletterRow,
} from "@/lib/bfg-newsletters";
import { UserVisibleError } from "@/lib/errors";
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

    return json({
      items: ((data ?? []) as unknown as BfgNewsletterRow[]).map(mapBfgNewsletterItem),
    });
  } catch (error) {
    if (error instanceof UserVisibleError) return json({ error: error.message }, error.status);
    return json({ error: "BFG Newsletter ist derzeit nicht verfügbar." }, 500);
  }
}
