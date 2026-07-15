import { NextResponse } from "next/server";

import { authenticateAdminRequest, adminUsersErrorResponse } from "@/lib/admin-users";
import { UserVisibleError } from "@/lib/errors";
import {
  adminModelDtos,
  deleteOpenAICompatibleModel,
  parseDeleteOpenAICompatibleModelBody,
  parseUpdateOpenAICompatibleModelBody,
  updateOpenAICompatibleModel,
} from "@/lib/model-settings";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function serverClient() {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new UserVisibleError("Die Modellkonfiguration ist derzeit nicht verfügbar.", 503);
  return supabase;
}

async function requestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new UserVisibleError("Die Anfrage ist ungültig.", 400);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ modelId: string }> },
) {
  try {
    const supabase = serverClient();
    const admin = await authenticateAdminRequest(request, supabase);
    const { modelId } = await params;
    const updated = await updateOpenAICompatibleModel({
      supabase,
      adminUserId: admin.id,
      modelId,
      input: parseUpdateOpenAICompatibleModelBody(await requestBody(request)),
    });
    return NextResponse.json({
      model: adminModelDtos({ source: "database", models: [updated] })[0],
    });
  } catch (error) {
    return adminUsersErrorResponse(error, "Die Modellkonfiguration konnte nicht gespeichert werden.");
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ modelId: string }> },
) {
  try {
    const supabase = serverClient();
    const admin = await authenticateAdminRequest(request, supabase);
    const { modelId } = await params;
    const { revision } = parseDeleteOpenAICompatibleModelBody(await requestBody(request));
    await deleteOpenAICompatibleModel({ supabase, adminUserId: admin.id, modelId, revision });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return adminUsersErrorResponse(error, "Das Modell konnte nicht gelöscht werden.");
  }
}
