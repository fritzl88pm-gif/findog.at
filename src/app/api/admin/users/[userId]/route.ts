import { NextResponse } from "next/server";

import {
  adminUsersErrorResponse,
  authenticateAdminRequest,
  managedUserSummary,
  parseManagedUserId,
} from "@/lib/admin-users";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type RequestHistoryRow = {
  id: number;
  conversation_id: string;
  content: string;
  created_at: string;
};

function serverClient() {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    throw new UserVisibleError("Benutzerverwaltung ist derzeit nicht verfügbar.", 503);
  }
  return supabase;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  try {
    const supabase = serverClient();
    await authenticateAdminRequest(request, supabase);
    const userId = parseManagedUserId((await context.params).userId);

    const { data: authData, error: authError } = await supabase.auth.admin.getUserById(userId);
    if (authError || !authData.user) {
      throw new UserVisibleError("Benutzer wurde nicht gefunden.", 404);
    }

    const { data, error } = await supabase
      .from("admin_request_history")
      .select("id,conversation_id,content,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (error) {
      throw new UserVisibleError("Anfrageverlauf konnte nicht geladen werden.", 503);
    }

    const requests = ((data ?? []) as RequestHistoryRow[]).map((entry) => ({
      id: entry.id,
      conversationId: entry.conversation_id,
      content: entry.content,
      createdAt: entry.created_at,
    }));

    return NextResponse.json({
      user: managedUserSummary(authData.user),
      requestCount: requests.length,
      requests,
    });
  } catch (error) {
    return adminUsersErrorResponse(error, "Benutzerprofil konnte nicht geladen werden.");
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  try {
    const supabase = serverClient();
    const administrator = await authenticateAdminRequest(request, supabase);
    const userId = parseManagedUserId((await context.params).userId);
    if (userId === administrator.id) {
      throw new UserVisibleError("Das eigene Administratorkonto kann nicht gelöscht werden.", 400);
    }

    const { error } = await supabase.rpc("admin_delete_managed_user", {
      target_user_id: userId,
    });
    if (error) {
      throw new UserVisibleError("Das Benutzerkonto konnte nicht gelöscht werden.", 503);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return adminUsersErrorResponse(error, "Das Benutzerkonto konnte nicht gelöscht werden.");
  }
}
