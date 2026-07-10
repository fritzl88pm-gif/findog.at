import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BULK_DELETE_IDS = 100;

type ConversationRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Gesprächsverlauf ist derzeit nicht verfügbar.", 503);
    }
    const user = await authenticateSupabaseRequest(request, supabase);
    const { data, error } = await supabase
      .from("conversations")
      .select("id,title,created_at,updated_at")
      .eq("client_id", user.id)
      .order("updated_at", { ascending: false });

    if (error) {
      throw new UserVisibleError("Gesprächsverlauf konnte nicht geladen werden.", 503);
    }

    return NextResponse.json({
      conversations: ((data ?? []) as ConversationRow[]).map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.created_at,
        updatedAt: conversation.updated_at,
      })),
    });
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "Gesprächsverlauf konnte nicht geladen werden." },
      { status: 500 },
    );
  }
}

async function parseBulkDeleteIds(request: Request): Promise<string[]> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new UserVisibleError("Die Löschanfrage enthält kein gültiges JSON.", 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new UserVisibleError("Die Löschanfrage ist ungültig.", 400);
  }
  const ids = (body as Record<string, unknown>).ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new UserVisibleError("Bitte mindestens eine Gespräch-ID zum Löschen auswählen.", 400);
  }
  if (ids.length > MAX_BULK_DELETE_IDS) {
    throw new UserVisibleError(
      `Es können maximal ${MAX_BULK_DELETE_IDS} Unterhaltungen auf einmal gelöscht werden.`,
      400,
    );
  }

  if (ids.some((id) => typeof id !== "string" || !uuidPattern.test(id.trim()))) {
    throw new UserVisibleError("Eine oder mehrere Gespräch-IDs sind ungültig.", 400);
  }
  return [...new Set(ids.map((id) => (id as string).trim()))];
}

export async function DELETE(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Unterhaltungen können derzeit nicht gelöscht werden.", 503);
    }
    const user = await authenticateSupabaseRequest(request, supabase);
    const ids = await parseBulkDeleteIds(request);
    const { data, error } = await supabase
      .from("conversations")
      .delete()
      .in("id", ids)
      .eq("client_id", user.id)
      .select("id");

    if (error) {
      throw new UserVisibleError("Unterhaltungen konnten nicht gelöscht werden.", 503);
    }

    return NextResponse.json({
      deletedIds: ((data ?? []) as Array<{ id: string }>).map((row) => row.id),
    });
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "Unterhaltungen konnten nicht gelöscht werden." },
      { status: 500 },
    );
  }
}
