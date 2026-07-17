import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import {
  FredEmbedConfigurationError,
  FredEmbedUpstreamError,
  mintFredEmbedSession,
} from "@/lib/weknora/fred-embed";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const RATE_LIMIT_MAX_REQUESTS = 12;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1_000;

type RateLimitEntry = { count: number; resetAt: number };
const rateLimit = new Map<string, RateLimitEntry>();

function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      Vary: "Authorization",
    },
  });
}

function requireSameSiteBrowserRequest(request: Request): void {
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site") {
    throw new UserVisibleError("Diese Fred-Anfrage ist nicht erlaubt.", 403);
  }
}

function enforceRateLimit(userId: string): void {
  const now = Date.now();
  for (const [key, entry] of rateLimit) {
    if (entry.resetAt <= now) rateLimit.delete(key);
  }
  const current = rateLimit.get(userId);
  if (!current) {
    rateLimit.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return;
  }
  if (current.count >= RATE_LIMIT_MAX_REQUESTS) {
    throw new UserVisibleError("Zu viele Fred-Verbindungen. Bitte kurz warten.", 429);
  }
  current.count += 1;
}

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Fred ist derzeit nicht verfügbar.", 503);
    }
    const user = await authenticateSupabaseRequest(request, supabase);
    requireSameSiteBrowserRequest(request);
    enforceRateLimit(user.id);
    return json(await mintFredEmbedSession({ signal: request.signal }));
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return json({ error: error.message }, error.status);
    }
    if (error instanceof FredEmbedConfigurationError) {
      return json({ error: "Fred ist noch nicht vollständig eingerichtet." }, 503);
    }
    if (error instanceof FredEmbedUpstreamError) {
      const status = error.kind === "rate_limited" ? 503 : 502;
      return json({ error: "Fred ist derzeit nicht erreichbar. Bitte später erneut versuchen." }, status);
    }
    return json({ error: "Fred konnte nicht geladen werden." }, 500);
  }
}
