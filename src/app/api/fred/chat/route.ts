import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  FRED_MAX_QUERY_LENGTH,
  parseFredSessionToken,
} from "@/lib/fred/token";
import { createRateLimiter } from "@/lib/fred/rate-limit";
import {
  formatSseFrame,
  parseSseChunk,
  sanitizeFredEvent,
} from "@/lib/fred/sse";

export const runtime = "nodejs";

const FRED_AGENT_ID = "e8b65a4d-dc41-4281-ba62-e01e50b0947a";
const FRED_KB_IDS = [
  "30ac8ebb-13b6-462a-ada0-a35e63f99dbb",
  "9ddef4d4-79c3-4910-a312-604360720ac3",
  "7e203a75-9e51-4839-afd4-7d24d2e5b033",
];

const chatLimiter = createRateLimiter();

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

function parseSessionTokenHeader(
  request: Request,
  apiKey: string,
  expectedUserId: string,
): string {
  const token = request.headers.get("X-Fred-Session-Token");
  if (!token) {
    throw new UserVisibleError("Keine gültige Fred-Sitzung.", 401);
  }

  const parsed = parseFredSessionToken({
    apiKey,
    token,
    expectedUserId,
  });

  if (!parsed) {
    throw new UserVisibleError("Fred-Sitzung ist ungültig oder abgelaufen.", 401);
  }

  return parsed.weknoraSessionId;
}

function validateQuery(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new UserVisibleError("Ungültige Anfrage.", 400);
  }

  const query = (body as Record<string, unknown>).query;
  if (typeof query !== "string" || !query.trim()) {
    throw new UserVisibleError("Bitte eine Frage eingeben.", 400);
  }

  const trimmed = query.trim();
  if (trimmed.length > FRED_MAX_QUERY_LENGTH) {
    throw new UserVisibleError("Die Frage ist zu lang.", 400);
  }

  return trimmed;
}

function safeUpstreamError(): string {
  return "Fred konnte nicht antworten. Bitte später erneut versuchen.";
}

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Anmeldung kann derzeit nicht geprüft werden.", 503);
    }

    const authenticatedUser = await authenticateSupabaseRequest(request, supabase);

    if (!chatLimiter.check(authenticatedUser.id)) {
      throw new UserVisibleError(
        "Zu viele Anfragen. Bitte in einigen Minuten erneut versuchen.",
        429,
      );
    }

    const { baseUrl, apiKey } = getConfig();
    const weknoraSessionId = parseSessionTokenHeader(
      request,
      apiKey,
      authenticatedUser.id,
    );

    const body = await request.json().catch(() => ({}));
    const query = validateQuery(body);

    // Build the upstream request URL
    const url = `${baseUrl}/agent-chat/${encodeURIComponent(weknoraSessionId)}`;

    const upstreamBody = JSON.stringify({
      query,
      agent_id: FRED_AGENT_ID,
      agent_enabled: true,
      knowledge_base_ids: FRED_KB_IDS,
      web_search_enabled: true,
      enable_memory: false,
      channel: "web",
    });

    const upstreamResponse = await fetch(url, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "X-Request-ID": crypto.randomUUID(),
      },
      body: upstreamBody,
      signal: request.signal,
    });

    if (!upstreamResponse.ok) {
      throw new UserVisibleError(safeUpstreamError(), 502);
    }

    if (!upstreamResponse.body) {
      throw new UserVisibleError(safeUpstreamError(), 502);
    }

    // Relay the SSE stream, filtering sensitive events
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Read from upstream and write to our stream, filtering as needed
    const reader = upstreamResponse.body.getReader();
    const pump = async () => {
      try {
        const decoder = new TextDecoder();
        let remainder = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const parsed = parseSseChunk(
            remainder + decoder.decode(value, { stream: true }),
          );
          remainder = parsed.remainder;

          for (const event of parsed.events) {
            await writer.write(
              encoder.encode(formatSseFrame(sanitizeFredEvent(event))),
            );
          }
        }

        const finalParsed = parseSseChunk(remainder + decoder.decode());
        for (const event of finalParsed.events) {
          await writer.write(
            encoder.encode(formatSseFrame(sanitizeFredEvent(event))),
          );
        }

        await writer.close();
      } catch (error) {
        try {
          await writer.abort(error);
        } catch {
          // Ignore stream shutdown errors.
        }
      }
    };

    void pump();

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return new Response(
        JSON.stringify({ error: error.message }),
        {
          status: error.status,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    console.error("Fred chat route failed", error);
    return new Response(
      JSON.stringify({ error: "Unerwarteter Serverfehler. Bitte später erneut versuchen." }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
