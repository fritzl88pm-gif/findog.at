import { NextResponse } from "next/server";

import { authenticateAdminRequest, adminUsersErrorResponse } from "@/lib/admin-users";
import { UserVisibleError } from "@/lib/errors";
import { adminModelDtos, parseModelImagePatch, updateModelImage } from "@/lib/model-settings";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ modelId: string }> },
) {
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
    const { modelId } = await params;
    const input = parseModelImagePatch(body);
    const model = await updateModelImage({
      supabase,
      adminUserId: admin.id,
      modelId,
      ...input,
    });
    return NextResponse.json({
      model: adminModelDtos({ source: "database", models: [model] })[0],
    });
  } catch (error) {
    return adminUsersErrorResponse(error, "Das Modellbild konnte nicht gespeichert werden.");
  }
}
