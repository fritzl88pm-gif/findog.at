import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function errorResponse(error: unknown): NextResponse {
  if (error instanceof UserVisibleError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  return NextResponse.json(
    { error: "Das Benutzerkonto konnte nicht gelöscht werden." },
    { status: 500 },
  );
}

export async function DELETE(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Die Kontolöschung ist derzeit nicht verfügbar.", 503);
    }

    const user = await authenticateSupabaseRequest(request, supabase);
    const { error } = await supabase.rpc("admin_delete_managed_user", {
      target_user_id: user.id,
    });

    if (error) {
      throw new UserVisibleError("Das Benutzerkonto konnte nicht gelöscht werden.", 503);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
