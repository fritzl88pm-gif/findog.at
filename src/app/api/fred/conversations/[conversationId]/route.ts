import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type FredConversationRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type FredMessageRow = {
  id: number;
  role: "user" | "assistant";
  content: string;
  provider_created_at: string | null;
  created_at: string;
  attachments: unknown;
  web_search_enabled: boolean;
};

function attachmentMetadata(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const item = candidate as Record<string, unknown>;
    if (
      (item.kind !== "image" && item.kind !== "file")
      || typeof item.name !== "string"
      || typeof item.mime_type !== "string"
      || typeof item.size_bytes !== "number"
      || typeof item.sha256 !== "string"
    ) return [];
    return [{
      kind: item.kind,
      name: item.name,
      mimeType: item.mime_type,
      sizeBytes: item.size_bytes,
      sha256: item.sha256,
    }];
  });
}

function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

async function contextFor(request: Request, conversationId: string) {
  if (!UUID_PATTERN.test(conversationId)) {
    throw new UserVisibleError("Gespräch-ID ist ungültig.", 400);
  }
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    throw new UserVisibleError("Der Fred-Verlauf ist derzeit nicht verfügbar.", 503);
  }
  const user = await authenticateSupabaseRequest(request, supabase);
  return { supabase, user };
}

export async function GET(
  request: Request,
  routeContext: { params: Promise<{ conversationId: string }> },
) {
  try {
    const { conversationId } = await routeContext.params;
    const { supabase, user } = await contextFor(request, conversationId);
    const { data: conversation, error: conversationError } = await supabase
      .from("fred_conversations")
      .select("id,title,created_at,updated_at")
      .eq("id", conversationId)
      .eq("client_id", user.id)
      .maybeSingle();
    if (conversationError) {
      throw new UserVisibleError("Fred-Unterhaltung konnte nicht geladen werden.", 503);
    }
    if (!conversation) {
      throw new UserVisibleError("Fred-Unterhaltung wurde nicht gefunden.", 404);
    }
    const { data: messages, error: messagesError } = await supabase
      .from("fred_messages")
      .select("id,role,content,provider_created_at,created_at,attachments,web_search_enabled")
      .eq("conversation_id", conversationId)
      .eq("client_id", user.id)
      .order("provider_created_at", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true });
    if (messagesError) {
      throw new UserVisibleError("Fred-Nachrichten konnten nicht geladen werden.", 503);
    }
    const row = conversation as FredConversationRow;
    return json({
      conversation: {
        id: row.id,
        title: row.title,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
      messages: ((messages ?? []) as FredMessageRow[]).map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.provider_created_at ?? message.created_at,
        attachments: attachmentMetadata(message.attachments),
        webSearchEnabled: message.web_search_enabled,
      })),
    });
  } catch (error) {
    if (error instanceof UserVisibleError) return json({ error: error.message }, error.status);
    return json({ error: "Fred-Unterhaltung konnte nicht geladen werden." }, 500);
  }
}

export async function DELETE(
  request: Request,
  routeContext: { params: Promise<{ conversationId: string }> },
) {
  try {
    const { conversationId } = await routeContext.params;
    const { supabase, user } = await contextFor(request, conversationId);
    const { data, error } = await supabase
      .from("fred_conversations")
      .delete()
      .eq("id", conversationId)
      .eq("client_id", user.id)
      .select("id");
    if (error) {
      throw new UserVisibleError("Fred-Unterhaltung konnte nicht gelöscht werden.", 503);
    }
    const deletedIds = ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
    if (deletedIds.length === 0) {
      throw new UserVisibleError("Fred-Unterhaltung wurde nicht gefunden.", 404);
    }
    return json({ deletedIds });
  } catch (error) {
    if (error instanceof UserVisibleError) return json({ error: error.message }, error.status);
    return json({ error: "Fred-Unterhaltung konnte nicht gelöscht werden." }, 500);
  }
}
