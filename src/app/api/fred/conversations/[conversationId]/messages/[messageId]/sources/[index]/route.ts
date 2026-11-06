import "server-only";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { renderCitedAnswer } from "@/lib/fred/citations";
import { fetchFredChunkSnippet, SNIPPET_UNAVAILABLE_MESSAGE } from "@/lib/fred/source-snippet";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  FredEmbedConfigurationError,
  FredEmbedUpstreamError,
  readFredEmbedServerConfig,
  readQuickFredEmbedServerConfig,
  type FredEmbedServerConfig,
} from "@/lib/weknora/fred-embed";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 60;
const rateLimit = new Map<string, { count: number; resetAt: number }>();

type RouteContext = { params: Promise<{ conversationId: string; messageId: string; index: string }> };

function respond(payload: unknown, status = 200): Response {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" },
  });
}

function errorResponse(error: unknown): Response {
  const visible = error instanceof UserVisibleError
    ? error
    : new UserVisibleError(
      "Die Fundstelle konnte nicht geladen werden.",
      error instanceof FredEmbedUpstreamError ? 502 : 500,
    );
  return respond({ error: visible.message }, visible.status);
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
  if (current.count >= MAX_REQUESTS_PER_WINDOW) {
    throw new UserVisibleError("Zu viele Anfragen. Bitte kurz warten.", 429);
  }
  current.count += 1;
}

function embedConfigFor(agentKey: unknown): FredEmbedServerConfig {
  try {
    return agentKey === "quickfred" ? readQuickFredEmbedServerConfig() : readFredEmbedServerConfig();
  } catch (error) {
    if (error instanceof FredEmbedConfigurationError) {
      throw new UserVisibleError("Die Fundstellenanzeige ist derzeit nicht verfügbar.", 503);
    }
    throw error;
  }
}

/**
 * Returns the cited passage behind marker `index + 1` of an assistant message.
 * The cited source is resolved from the stored answer (never from the client),
 * and only name, location and text leave the server: no chunk or knowledge-base ids.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
      throw new UserVisibleError("Diese Anfrage ist nicht erlaubt.", 403);
    }
    const { conversationId, messageId, index: rawIndex } = await context.params;
    const messageNumber = Number(messageId);
    if (
      !UUID.test(conversationId)
      || !/^\d+$/u.test(messageId) || !Number.isSafeInteger(messageNumber) || messageNumber <= 0
      || !/^\d{1,3}$/u.test(rawIndex)
    ) {
      throw new UserVisibleError("Die Fundstelle ist ungültig.", 400);
    }
    const index = Number(rawIndex);

    const supabase = getSupabaseServerClient();
    if (!supabase) throw new UserVisibleError("Der Fred-Verlauf ist derzeit nicht verfügbar.", 503);
    const user = await authenticateSupabaseRequest(request, supabase);
    enforceRateLimit(user.id);

    const { data: conversation, error: conversationError } = await supabase
      .from("fred_conversations")
      .select("id,agent_key")
      .eq("id", conversationId)
      .eq("client_id", user.id)
      .maybeSingle();
    if (conversationError) throw new UserVisibleError("Die Fundstelle konnte nicht geladen werden.", 503);
    if (!conversation) throw new UserVisibleError(SNIPPET_UNAVAILABLE_MESSAGE, 404);

    const { data: message, error: messageError } = await supabase
      .from("fred_messages")
      .select("role,content,display_content")
      .eq("id", messageNumber)
      .eq("conversation_id", conversationId)
      .eq("client_id", user.id)
      .maybeSingle();
    if (messageError) throw new UserVisibleError("Die Fundstelle konnte nicht geladen werden.", 503);
    if (!message || message.role !== "assistant" || typeof message.content !== "string") {
      throw new UserVisibleError(SNIPPET_UNAVAILABLE_MESSAGE, 404);
    }

    // Same stored text and the same function as the live answer and the reload route.
    const { cited } = renderCitedAnswer(
      (typeof message.display_content === "string" && message.display_content) || message.content,
    );
    const source = cited[index];
    if (!source) throw new UserVisibleError(SNIPPET_UNAVAILABLE_MESSAGE, 404);

    if (source.kind === "web") {
      return respond({ doc: source.title || new URL(source.url).hostname, url: source.url });
    }
    if (!source.chunkId) throw new UserVisibleError(SNIPPET_UNAVAILABLE_MESSAGE, 404);

    const snippet = await fetchFredChunkSnippet({
      config: embedConfigFor(conversation.agent_key),
      chunkId: source.chunkId,
      signal: request.signal,
    });
    return respond({
      doc: source.doc,
      ...(snippet.location ? { location: snippet.location } : {}),
      text: snippet.text,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
