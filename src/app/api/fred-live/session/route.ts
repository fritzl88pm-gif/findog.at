import { NextResponse } from "next/server";

import { authenticateAdminRequest } from "@/lib/admin-users";
import { createFredLiveSession, resolveFredLiveApiKey } from "@/lib/fred-live";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 512 * 1024;

function errorResponse(error: unknown): Response {
  if (error instanceof UserVisibleError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: "Fred Live konnte nicht gestartet werden." }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    const contentLength = request.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
      throw new UserVisibleError("Die WebRTC-Anfrage ist zu groß.", 400);
    }

    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Fred Live ist derzeit nicht verfügbar.", 503);
    }
    await authenticateAdminRequest(request, supabase);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new UserVisibleError("Die WebRTC-Anfrage ist ungültig.", 400);
    }
    const sdp = body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).sdp
      : undefined;
    if (typeof sdp !== "string" || !sdp.trim()) {
      throw new UserVisibleError("Die WebRTC-Anfrage ist ungültig.", 400);
    }
    if (!resolveFredLiveApiKey()) {
      throw new UserVisibleError("Fred Live ist derzeit nicht verfügbar.", 503);
    }

    const result = await createFredLiveSession({ sdp, apiKey: resolveFredLiveApiKey() });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
