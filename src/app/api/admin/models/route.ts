import { NextResponse } from "next/server";

import { authenticateAdminRequest, adminUsersErrorResponse } from "@/lib/admin-users";
import { UserVisibleError } from "@/lib/errors";
import { modelImageAssetDtos, modelImageUrlMap, readModelImageAssets } from "@/lib/model-images";
import {
  adminModelDtos,
  assertConfiguredModelsCanBeEnabled,
  createOpenAICompatibleModel,
  parseCreateOpenAICompatibleModelBody,
  parseModelSettingsPatch,
  readModelDefaultPolicy,
  readModelSettings,
  updateModelSettings,
} from "@/lib/model-settings";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function modelDtosWithImages(
  models: ReturnType<typeof adminModelDtos>,
  imageUrls: ReadonlyMap<string, string>,
) {
  return models.map((model) => ({
    ...model,
    imageUrl: model.imageAssetId ? imageUrls.get(model.imageAssetId) ?? null : null,
  }));
}

function serverClient() {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new UserVisibleError("Die Modellkonfiguration ist derzeit nicht verfügbar.", 503);
  return supabase;
}

export async function POST(request: Request) {
  try {
    const supabase = serverClient();
    const admin = await authenticateAdminRequest(request, supabase);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new UserVisibleError("Die Anfrage ist ungültig.", 400);
    }
    const created = await createOpenAICompatibleModel({
      supabase,
      adminUserId: admin.id,
      input: parseCreateOpenAICompatibleModelBody(body),
    });
    return NextResponse.json({
      model: adminModelDtos({ source: "database", models: [created] })[0],
    }, { status: 201 });
  } catch (error) {
    return adminUsersErrorResponse(error, "Das Modell konnte nicht angelegt werden.");
  }
}

export async function GET(request: Request) {
  try {
    const supabase = serverClient();
    await authenticateAdminRequest(request, supabase);
    const [settings, defaultPolicy, imageAssets] = await Promise.all([
      readModelSettings(supabase),
      readModelDefaultPolicy(supabase),
      readModelImageAssets(supabase),
    ]);
    const imageUrls = modelImageUrlMap(supabase, imageAssets);
    return NextResponse.json({
      models: modelDtosWithImages(adminModelDtos(settings), imageUrls),
      defaultModelId: defaultPolicy.modelId,
      defaultRevision: defaultPolicy.revision,
      images: modelImageAssetDtos(supabase, imageAssets),
    });
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
    const updated = await updateModelSettings({ supabase, adminUserId: admin.id, current, requested });
    const imageAssets = await readModelImageAssets(supabase);
    return NextResponse.json({
      models: modelDtosWithImages(adminModelDtos(updated), modelImageUrlMap(supabase, imageAssets)),
    });
  } catch (error) {
    return adminUsersErrorResponse(error, "Die Modellkonfiguration konnte nicht gespeichert werden.");
  }
}
