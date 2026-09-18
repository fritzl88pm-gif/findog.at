import { NextResponse } from "next/server";

import { authenticateAdminRequest } from "@/lib/admin-users";
import { askQuickFred } from "@/lib/fred-live/ask";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_QUESTION_CHARS = 2_000;

function errorResponse(error: unknown): Response {
  if (error instanceof UserVisibleError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "Die Wissensbasis konnte die Frage nicht beantworten." }, { status: 502 });
}

export async function POST(request: Request) {
  try {
    const contentLength = request.headers.get("content-length");
    if (contentLength && Number.parseInt(contentLength, 10) > MAX_BODY_BYTES) {
      throw new UserVisibleError("Die Anfrage ist zu groß.", 400);
    }
    const supabase = getSupabaseServerClient();
    if (!supabase) throw new UserVisibleError("Fred Live ist derzeit nicht verfügbar.", 503);
    await authenticateAdminRequest(request, supabase);
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      throw new UserVisibleError("Die Anfrage ist zu groß.", 400);
    }
    let body: unknown;
    try { body = JSON.parse(rawBody); } catch { throw new UserVisibleError("Die Anfrage ist ungültig.", 400); }
    const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const question = typeof record.question === "string" ? record.question.trim() : "";
    if (!question || question.length > MAX_QUESTION_CHARS) throw new UserVisibleError("Die Frage muss zwischen 1 und 2.000 Zeichen lang sein.", 400);
    const upstreamSessionId = record.upstreamSessionId;
    if (upstreamSessionId !== undefined && (typeof upstreamSessionId !== "string" || !upstreamSessionId.trim())) {
      throw new UserVisibleError("Die Fred-Sitzung ist ungültig.", 400);
    }
    const timeout = AbortSignal.timeout(45_000);
    const signal = AbortSignal.any([request.signal, timeout]);
    const result = await askQuickFred({ question, upstreamSessionId: upstreamSessionId as string | undefined, signal });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
