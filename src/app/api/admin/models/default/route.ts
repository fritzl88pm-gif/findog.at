import { NextResponse } from "next/server";

import { authenticateAdminRequest, adminUsersErrorResponse } from "@/lib/admin-users";
import { UserVisibleError } from "@/lib/errors";
import {
  parseDefaultModelPatch,
  updateGlobalDefaultModel,
} from "@/lib/model-settings";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) throw new UserVisibleError("Die Modellkonfiguration ist derzeit nicht verfügbar.", 503);
    const admin = await authenticateAdminRequest(request, supabase);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new UserVisibleError("Die Anfrage ist ungültig.", 400);
    }
    const input = parseDefaultModelPatch(body);
    const policy = await updateGlobalDefaultModel({
      supabase,
      adminUserId: admin.id,
      ...input,
    });
    return NextResponse.json({
      defaultModelId: policy.modelId,
      defaultRevision: policy.revision,
    });
  } catch (error) {
    return adminUsersErrorResponse(error, "Das Standardmodell konnte nicht gespeichert werden.");
  }
}
