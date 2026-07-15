import { NextResponse } from "next/server";

import { isAdminUser } from "@/lib/admin-auth";
import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { publicEnabledModelDtos, readEffectiveModelSettings } from "@/lib/model-settings";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Einstellungen sind derzeit nicht verfügbar.", 503);
    }

    const user = await authenticateSupabaseRequest(request, supabase);
    const [isAdmin, modelSettings] = await Promise.all([
      isAdminUser(supabase, user.id),
      readEffectiveModelSettings(supabase),
    ]);

    return NextResponse.json({
      isAdmin,
      enabledModels: publicEnabledModelDtos(modelSettings, isAdmin),
    });
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Einstellungen konnten nicht geladen werden." }, { status: 500 });
  }
}
