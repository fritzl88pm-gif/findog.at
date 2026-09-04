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
    parseManagedUserId((await context.params).userId);
    return NextResponse.json({
      error: "Der separate Anfrageverlauf wurde entfernt. Anfragen werden aus den vorhandenen Unterhaltungen angezeigt.",
    }, { status: 410 });
  } catch (error) {
    return adminUsersErrorResponse(error, "Anfrageverlauf konnte nicht gelöscht werden.");
  }
}
