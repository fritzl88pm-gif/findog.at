import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { getDownloadCatalog } from "@/lib/downloads";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Downloads sind derzeit nicht verfügbar.", 503);
    }
    await authenticateSupabaseRequest(request, supabase);
    return json(await getDownloadCatalog(supabase));
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return json({ error: error.message }, error.status);
    }
    return json({ error: "Downloads konnten nicht geladen werden." }, 500);
  }
}
