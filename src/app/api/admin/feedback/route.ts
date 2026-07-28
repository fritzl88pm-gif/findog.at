import { NextResponse } from "next/server";

import {
  authenticateAdminRequest,
} from "@/lib/admin-users";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MAX_ADMIN_FEEDBACK_ROWS = 250;

type FeedbackRow = {
  id: number;
  user_id: string;
  conversation_id: string;
  user_request: string;
  assistant_response: string;
  user_feedback: string;
  created_at: string;
};

function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Rückmeldungen sind derzeit nicht verfügbar.", 503);
    }
    await authenticateAdminRequest(request, supabase);

    const { data, error } = await supabase
      .from("agent_feedback")
      .select("id,user_id,conversation_id,user_request,assistant_response,user_feedback,created_at")
      .order("id", { ascending: false })
      .limit(MAX_ADMIN_FEEDBACK_ROWS);
    if (error) {
      throw new UserVisibleError("Rückmeldungen konnten nicht geladen werden.", 503);
    }

    return json({
      feedback: ((data ?? []) as FeedbackRow[]).map((entry) => ({
        id: entry.id,
        userId: entry.user_id,
        conversationId: entry.conversation_id,
        userRequest: entry.user_request,
        assistantResponse: entry.assistant_response,
        feedback: entry.user_feedback,
        createdAt: entry.created_at,
      })),
      limit: MAX_ADMIN_FEEDBACK_ROWS,
    });
  } catch (error) {
    if (error instanceof UserVisibleError) return json({ error: error.message }, error.status);
    return json({ error: "Rückmeldungen konnten nicht geladen werden." }, 500);
  }
}
