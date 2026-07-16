import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { createFredSessionToken } from "@/lib/fred/token";
import { createRateLimiter } from "@/lib/fred/rate-limit";

export const runtime = "nodejs";

const sessionLimiter = createRateLimiter();

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

    if (!sessionLimiter.check(authenticatedUser.id)) {
      throw new UserVisibleError(
        "Zu viele Anfragen. Bitte in einigen Minuten erneut versuchen.",
        429,
      );
    }

    const { baseUrl, apiKey } = getConfig();

    // Create a WeKnora session
    const sessionResponse = await fetch(`${baseUrl}/sessions`, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Fred Chat Session",
        description: "Fred agent chat session",
      }),
    });

    if (!sessionResponse.ok) {
      throw new UserVisibleError(
        "Fred-Sitzung konnte nicht erstellt werden. Bitte später erneut versuchen.",
        502,
      );
    }

    const sessionData = (await sessionResponse.json()) as Record<string, unknown>;
    const weknoraSessionId =
      typeof sessionData.data === "object" &&
      sessionData.data !== null &&
      !Array.isArray(sessionData.data)
        ? ((sessionData.data as Record<string, unknown>).id as string | undefined)
        : undefined;

    if (!weknoraSessionId || typeof weknoraSessionId !== "string") {
      throw new UserVisibleError(
        "Fred-Sitzung konnte nicht erstellt werden. Bitte später erneut versuchen.",
        502,
      );
    }

    const token = createFredSessionToken({
      apiKey,
      userId: authenticatedUser.id,
      weknoraSessionId,
    });

    return Response.json({ token });
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("Fred sessions route failed", error);
    return NextResponse.json(
      { error: "Unerwarteter Serverfehler. Bitte später erneut versuchen." },
      { status: 500 },
    );
  }
}
