import { NextResponse } from "next/server";

import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  readFredEmbedServerConfig,
  readQuickFredEmbedServerConfig,
} from "@/lib/weknora/fred-embed";
import {
  fredWebhookDeliverySha256,
  parseFredWebhookEvent,
  readBoundedFredEventBody,
  readFredWebhookSecret,
  verifyFredWebhookSignature,
} from "@/lib/weknora/fred-history";

export const runtime = "nodejs";

function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      throw new UserVisibleError("Webhook content type rejected.", 415);
    }
    const rawBody = await readBoundedFredEventBody(request);
    const secret = readFredWebhookSecret();
    if (!verifyFredWebhookSignature(
      rawBody,
      request.headers.get("x-weknora-signature"),
      secret,
    )) {
      throw new UserVisibleError("Webhook signature rejected.", 401);
    }
    const config = readFredEmbedServerConfig();
    const channelIds = [config.channelId];
    try {
      const quickFredConfig = readQuickFredEmbedServerConfig();
      if (!channelIds.includes(quickFredConfig.channelId)) {
        channelIds.push(quickFredConfig.channelId);
      }
    } catch {
      // QuickFred is optional; Fred webhooks remain available without it.
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new UserVisibleError("Webhook JSON rejected.", 400);
    }
    const event = parseFredWebhookEvent(body, channelIds);
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Webhook storage unavailable.", 503);
    }
    const { data, error } = await supabase.rpc("record_fred_webhook_event", {
      payload: {
        delivery_sha256: fredWebhookDeliverySha256(rawBody),
        channel_id: event.channelId,
        session_id: event.sessionId,
        event_type: event.type,
        content: event.content,
        provider_created_at: event.providerCreatedAt,
        raw_event: event.rawEvent,
      },
    });
    if (error) {
      throw new UserVisibleError("Webhook storage unavailable.", 503);
    }
    const result = data && typeof data === "object" && !Array.isArray(data)
      ? data as Record<string, unknown>
      : {};
    return json({ received: true, pending: result.pending === true });
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return json({ error: error.message }, error.status);
    }
    return json({ error: "Webhook rejected." }, 500);
  }
}
