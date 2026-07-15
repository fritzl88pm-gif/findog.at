import { NextResponse } from "next/server";

import { authenticateAdminRequest, adminUsersErrorResponse } from "@/lib/admin-users";
import { UserVisibleError } from "@/lib/errors";
import {
  adminModelDtos,
  parseDynamicModelEnablePatch,
  readModelSettings,
} from "@/lib/model-settings";
import { isLaoZhangApiKeyConfigured } from "@/lib/laozhang-key";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function serverClient() {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    throw new UserVisibleError("Die Modellkonfiguration ist derzeit nicht verfügbar.", 503);
  }
  return supabase;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ modelId: string }> },
) {
  try {
    const supabase = serverClient();
    const admin = await authenticateAdminRequest(request, supabase);
    const { modelId } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new UserVisibleError("Die Anfrage ist ungültig.", 400);
    }

    const { enabled } = parseDynamicModelEnablePatch(body);
    const current = await readModelSettings(supabase);
    const setting = current.models.find((m) => m.id === modelId);

    if (!setting) {
      throw new UserVisibleError("Das Modell wurde nicht gefunden.", 404);
    }

    if (!setting.isDynamic) {
      throw new UserVisibleError(
        "Dieses Modell kann nicht über diesen Endpunkt aktualisiert werden.",
        400,
      );
    }

    if (enabled && !isLaoZhangApiKeyConfigured()) {
      throw new UserVisibleError(
        "LaoZhang ist nicht konfiguriert. Bitte LAOZHANG_API_KEY setzen.",
        400,
      );
    }

    // Use the existing update_model_settings RPC for the enable toggle
    const rpcChanges = [{
      model_id: modelId,
      enabled,
      reasoning_setting: "disabled" as const,
      expected_revision: setting.revision,
    }];

    const { error } = await supabase.rpc("update_model_settings", {
      p_admin_user_id: admin.id,
      p_changes: rpcChanges,
    });

    if (error) {
      if (typeof error === "object" && (error as { code?: string }).code === "40001") {
        throw new UserVisibleError(
          "Die Modellkonfiguration wurde zwischenzeitlich geändert. Bitte neu laden.",
          409,
        );
      }
      throw new UserVisibleError("Die Modellkonfiguration konnte nicht gespeichert werden.", 503);
    }

    const updated = await readModelSettings(supabase);
    const updatedSetting = updated.models.find((m) => m.id === modelId);
    if (!updatedSetting) {
      throw new UserVisibleError("Das Modell konnte nach der Aktualisierung nicht geladen werden.", 503);
    }

    return NextResponse.json({
      model: adminModelDtos({ source: "database", models: [updatedSetting] })[0],
    });
  } catch (error) {
    return adminUsersErrorResponse(
      error,
      "Die Modellkonfiguration konnte nicht gespeichert werden.",
    );
  }
}
