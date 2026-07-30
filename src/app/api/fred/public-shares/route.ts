import "server-only";

import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { createFredPublicShare } from "@/lib/fred-public-share";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Vary: "Authorization",
    },
  });
}

function requireSameSiteRequest(request: Request): void {
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    throw new UserVisibleError("Diese Anfrage ist nicht erlaubt.", 403);
  }
}

function validatePayload(value: unknown): { conversationId: string; assistantMessageId: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UserVisibleError("Die Fred-Share-Anfrage ist ungültig.", 400);
  }
  const body = value as Record<string, unknown>;
  const conversationId = typeof body.conversationId === "string" ? body.conversationId.trim() : "";
  if (!UUID_PATTERN.test(conversationId)) {
    throw new UserVisibleError("Die Fred-Unterhaltung ist ungültig.", 400);
  }
  if (typeof body.assistantMessageId !== "number") {
    throw new UserVisibleError("Die Fred-Nachrichten-ID ist ungültig.", 400);
  }
  const rawAssistantId = body.assistantMessageId;
  if (
    !Number.isFinite(rawAssistantId)
    || rawAssistantId <= 0
    || !Number.isSafeInteger(rawAssistantId)
  ) {
    throw new UserVisibleError("Die Fred-Nachrichten-ID ist ungültig.", 400);
  }
  return { conversationId, assistantMessageId: rawAssistantId };
}

export async function POST(request: Request) {
  try {
    const supabase = (await import("@/lib/supabase/server")).getSupabaseServerClient();
    if (!supabase) throw new UserVisibleError("Fred ist derzeit nicht verfügbar.", 503);
    const user = await authenticateSupabaseRequest(request, supabase);
    requireSameSiteRequest(request);

    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("application/json")) {
      throw new UserVisibleError("Die Fred-Share-Anfrage muss JSON enthalten.", 415);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new UserVisibleError("Die Fred-Share-Anfrage enthält kein gültiges JSON.", 400);
    }

    const { conversationId, assistantMessageId } = validatePayload(body);

    const result = await createFredPublicShare({
      clientId: user.id,
      conversationId,
      assistantMessageId,
    });

    return json({ shareId: result.shareId, sharePath: result.sharePath });
  } catch (error) {
    if (error instanceof UserVisibleError) return json({ error: error.message }, error.status);
    return json({ error: "Das Teilen der Fred-Antwort ist fehlgeschlagen." }, 500);
  }
}
