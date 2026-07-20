import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getWeKnoraDashboard } from "@/lib/weknora/dashboard";

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
    if (!supabase) {
      throw new UserVisibleError("Die Wissenslandschaft ist derzeit nicht verfügbar.", 503);
    }
    await authenticateSupabaseRequest(request, supabase);
    const dashboard = await getWeKnoraDashboard();
    return json(dashboard);
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return json({ error: error.message }, error.status);
    }
    return json({ error: "Die Wissenslandschaft ist derzeit nicht verfügbar." }, 503);
  }
}
