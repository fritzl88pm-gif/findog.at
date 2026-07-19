import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  parseFredBridgeEvent,
  parseFredConversationSummary,
  readBoundedFredEventBody,
} from "@/lib/weknora/fred-history";
import {
  FredEmbedConfigurationError,
  readFredEmbedServerConfig,
} from "@/lib/weknora/fred-embed";

export const runtime = "nodejs";

function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      throw new UserVisibleError("Das Fred-Ereignis muss JSON enthalten.", 415);
    }
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Der Fred-Verlauf ist derzeit nicht verfügbar.", 503);
    }
    const user = await authenticateSupabaseRequest(request, supabase);
    const config = readFredEmbedServerConfig();
    const rawBody = await readBoundedFredEventBody(request);
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new UserVisibleError("Das Fred-Ereignis enthält kein gültiges JSON.", 400);
    }
    const event = parseFredBridgeEvent(body, config.channelId);
    const { data, error } = await supabase.rpc("record_fred_bridge_event", {
      payload: {
        client_id: user.id,
        channel_id: event.channelId,
        session_id: event.sessionId,
        event_id: event.eventId,
        event_type: event.type,
        content: event.content,
        occurred_at: new Date().toISOString(),
      },
    });
    if (error) {
      throw new UserVisibleError("Das Fred-Ereignis konnte nicht gespeichert werden.", 503);
    }
    return json({ conversation: parseFredConversationSummary(data) });
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return json({ error: error.message }, error.status);
    }
    if (error instanceof FredEmbedConfigurationError) {
      return json({ error: "Fred ist noch nicht vollständig eingerichtet." }, 503);
    }
    return json({ error: "Das Fred-Ereignis konnte nicht gespeichert werden." }, 500);
  }
}
