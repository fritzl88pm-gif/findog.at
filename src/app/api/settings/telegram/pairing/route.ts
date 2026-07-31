import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { rotatePairingToken } from "@/lib/telegram/settings";

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

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Datenbankzugang ist derzeit nicht verfügbar.", 503);
    }
    const user = await authenticateSupabaseRequest(request, supabase);

    const result = await rotatePairingToken(user.id);
    return json(result);
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return json({ error: error.message }, error.status);
    }
    return json({ error: "Pairing-Token konnte nicht aktualisiert werden." }, 500);
  }
}
