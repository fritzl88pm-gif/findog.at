import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { parseFredSessionToken } from "@/lib/fred/token";

export const runtime = "nodejs";

function getConfig(): { baseUrl: string; apiKey: string } {
  const baseUrl = process.env.WEKNORA_BASE_URL;
  const apiKey = process.env.WEKNORA_API_KEY;

  if (!baseUrl || !apiKey) {
    throw new UserVisibleError(
      "Fred ist derzeit nicht verfügbar. Bitte später erneut versuchen.",
      503,
    );
  }

  return { baseUrl, apiKey };
}

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Anmeldung kann derzeit nicht geprüft werden.", 503);
    }

    const authenticatedUser = await authenticateSupabaseRequest(request, supabase);
    const { baseUrl, apiKey } = getConfig();

    const sessionToken = request.headers.get("X-Fred-Session-Token");
    if (!sessionToken) {
      throw new UserVisibleError("Keine gültige Fred-Sitzung.", 401);
    }

    const parsed = parseFredSessionToken({
      apiKey,
      token: sessionToken,
      expectedUserId: authenticatedUser.id,
    });

    if (!parsed) {
      throw new UserVisibleError("Fred-Sitzung ist ungültig oder abgelaufen.", 401);
    }

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const messageId = body.messageId;

    if (typeof messageId !== "string" || !messageId.trim()) {
      throw new UserVisibleError("Keine gültige Nachrichten-ID.", 400);
    }

    const stopUrl = `${baseUrl}/sessions/${encodeURIComponent(parsed.weknoraSessionId)}/stop`;
    const stopResponse = await fetch(stopUrl, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message_id: messageId }),
    });

    if (!stopResponse.ok) {
      throw new UserVisibleError(
        "Fred-Antwort konnte nicht gestoppt werden. Bitte später erneut versuchen.",
        502,
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("Fred stop route failed", error);
    return NextResponse.json(
      { error: "Unerwarteter Serverfehler. Bitte später erneut versuchen." },
      { status: 500 },
    );
  }
}
