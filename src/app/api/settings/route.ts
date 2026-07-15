import { NextResponse } from "next/server";

import { isAdminUser } from "@/lib/admin-auth";
import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { modelImageUrlMap, readModelImageAssets } from "@/lib/model-images";
import {
  globalDefaultModelSetting,
  publicEnabledModelDtos,
  readEffectiveModelSettings,
  readModelDefaultPolicy,
} from "@/lib/model-settings";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Einstellungen sind derzeit nicht verfügbar.", 503);
    }

    const user = await authenticateSupabaseRequest(request, supabase);
    const [isAdmin, modelSettings, defaultPolicy, imageAssets] = await Promise.all([
      isAdminUser(supabase, user.id),
      readEffectiveModelSettings(supabase),
      readModelDefaultPolicy(supabase),
      readModelImageAssets(supabase),
    ]);
    const defaultSetting = globalDefaultModelSetting(modelSettings, defaultPolicy);
    const imageUrls = modelImageUrlMap(supabase, imageAssets);
    const enabledModels = publicEnabledModelDtos(modelSettings, isAdmin).map((model) => ({
      id: model.id,
      label: model.label,
      imageUrl: model.imageAssetId ? imageUrls.get(model.imageAssetId) ?? null : null,
    }));
    const defaultModel = enabledModels.find((model) => model.id === defaultSetting.id);
    if (!defaultModel) throw new UserVisibleError("Das Standardmodell ist derzeit nicht verfügbar.", 503);

    return NextResponse.json({
      isAdmin,
      enabledModels,
      defaultModel,
    });
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Einstellungen konnten nicht geladen werden." }, { status: 500 });
  }
}
