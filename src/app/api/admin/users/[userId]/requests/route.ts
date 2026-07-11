import { NextResponse } from "next/server";

import {
  adminUsersErrorResponse,
  authenticateAdminRequest,
  parseManagedUserId,
} from "@/lib/admin-users";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Benutzerverwaltung ist derzeit nicht verfügbar.", 503);
    }
    await authenticateAdminRequest(request, supabase);
    const userId = parseManagedUserId((await context.params).userId);

    const { error } = await supabase
      .from("admin_request_history")
      .delete()
      .eq("user_id", userId);
    if (error) {
      throw new UserVisibleError("Anfrageverlauf konnte nicht gelöscht werden.", 503);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return adminUsersErrorResponse(error, "Anfrageverlauf konnte nicht gelöscht werden.");
  }
}
