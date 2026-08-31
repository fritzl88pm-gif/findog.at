import { NextResponse } from "next/server";

import { authenticateAdminRequest } from "@/lib/admin-users";
import { UserVisibleError } from "@/lib/errors";
import { getOmniRouteUsageSnapshot } from "@/lib/omniroute-usage";
import type { OmniRouteUsageRange } from "@/lib/omniroute-usage-types";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
const USAGE_RANGES = new Set<OmniRouteUsageRange>(["24h", "7d", "30d"]);

function parseRange(request: Request): OmniRouteUsageRange {
  const value = new URL(request.url).searchParams.get("range") ?? "24h";
  if (!USAGE_RANGES.has(value as OmniRouteUsageRange)) {
    throw new UserVisibleError("Der Zeitraum ist ungültig.", 400);
  }
  return value as OmniRouteUsageRange;
}

function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" },
  });
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof UserVisibleError) return json({ error: error.message }, error.status);
  return json({ error: "Die OmniRoute-Nutzung konnte nicht geladen werden." }, 503);
}

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) throw new UserVisibleError("Administration ist derzeit nicht verfügbar.", 503);
    await authenticateAdminRequest(request, supabase);
    const range = parseRange(request);
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    return json(await getOmniRouteUsageSnapshot(range, { refresh }));
  } catch (error) {
    return errorResponse(error);
  }
}
