import { NextResponse } from "next/server";

import { parsePasswordChangeBody } from "@/lib/auth/password";
import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import {
  getSupabasePasswordVerifierClient,
  getSupabaseServerClient,
} from "@/lib/supabase/server";

export const runtime = "nodejs";

function errorResponse(error: unknown): NextResponse {
  if (error instanceof UserVisibleError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json(
    { error: "Das Passwort konnte nicht geändert werden." },
    { status: 500 },
  );
}

export async function PUT(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Die Passwortänderung ist derzeit nicht verfügbar.", 503);
    }

    const user = await authenticateSupabaseRequest(request, supabase);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new UserVisibleError("Die Anfrage enthält kein gültiges JSON.", 400);
    }
    const { currentPassword, newPassword } = parsePasswordChangeBody(body);

    const verifier = getSupabasePasswordVerifierClient();
    if (!verifier) {
      throw new UserVisibleError("Die Passwortänderung ist derzeit nicht verfügbar.", 503);
    }
    if (!user.email) {
      throw new UserVisibleError("Das aktuelle Passwort konnte nicht geprüft werden.", 400);
    }

    const verification = await verifier.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (verification.error || verification.data.user?.id !== user.id) {
      throw new UserVisibleError("Das aktuelle Passwort ist falsch.", 400);
    }

    const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
      password: newPassword,
    });
    if (updateError) {
      throw new UserVisibleError("Das Passwort konnte nicht geändert werden.", 500);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
