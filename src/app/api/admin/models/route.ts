import { NextResponse } from "next/server";

import { authenticateAdminRequest, adminUsersErrorResponse } from "@/lib/admin-users";
import { UserVisibleError } from "@/lib/errors";
import {
  adminModelDtos,
  assertConfiguredModelsCanBeEnabled,
  parseModelSettingsPatch,
  readModelSettings,
  updateModelSettings,
} from "@/lib/model-settings";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function serverClient() {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    throw new UserVisibleError("Die Modellkonfiguration ist derzeit nicht verfügbar.", 503);
  }
  return supabase;
}

export async function GET(request: Request) {
  try {
    const supabase = serverClient();
    await authenticateAdminRequest(request, supabase);
    const snapshot = await readModelSettings(supabase);
    return NextResponse.json({ models: adminModelDtos(snapshot) });
  } catch (error) {
    return adminUsersErrorResponse(error, "Die Modellkonfiguration konnte nicht geladen werden.");
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = serverClient();
    const admin = await authenticateAdminRequest(request, supabase);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new UserVisibleError("Die Modellkonfiguration ist ungültig.", 400);
    }

    const requested = parseModelSettingsPatch(body);
    const current = await readModelSettings(supabase);
    assertConfiguredModelsCanBeEnabled(current, requested);
    const updated = await updateModelSettings({
      supabase,
      adminUserId: admin.id,
      current,
      requested,
    });
    return NextResponse.json({ models: adminModelDtos(updated) });
  } catch (error) {
    return adminUsersErrorResponse(error, "Die Modellkonfiguration konnte nicht gespeichert werden.");
  }
}
