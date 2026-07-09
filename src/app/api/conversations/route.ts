import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

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
