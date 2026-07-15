import { NextResponse } from "next/server";

import { authenticateAdminRequest, adminUsersErrorResponse } from "@/lib/admin-users";
import { UserVisibleError } from "@/lib/errors";
import {
  MAX_MODEL_IMAGE_BYTES,
  modelImageAssetDtos,
  readModelImageAssets,
  uploadModelImageAsset,
} from "@/lib/model-images";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function serverClient() {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new UserVisibleError("Die Modellbilder sind derzeit nicht verfügbar.", 503);
  return supabase;
}

export async function GET(request: Request) {
  try {
    const supabase = serverClient();
    await authenticateAdminRequest(request, supabase);
    return NextResponse.json({ images: modelImageAssetDtos(supabase, await readModelImageAssets(supabase)) });
  } catch (error) {
    return adminUsersErrorResponse(error, "Die Modellbilder konnten nicht geladen werden.");
  }
}

export async function POST(request: Request) {
  try {
    const supabase = serverClient();
    const admin = await authenticateAdminRequest(request, supabase);
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_MODEL_IMAGE_BYTES + 100_000) {
      throw new UserVisibleError("Das Modellbild darf maximal 1 MB groß sein.", 413);
    }
    const formData = await request.formData();
    const file = formData.get("image");
    if (typeof File === "undefined" || !(file instanceof File)) {
      throw new UserVisibleError("Bitte ein Bild auswählen.", 400);
    }
    const image = await uploadModelImageAsset({ supabase, adminUserId: admin.id, file });
    return NextResponse.json({ image: modelImageAssetDtos(supabase, [image])[0] }, { status: 201 });
  } catch (error) {
    return adminUsersErrorResponse(error, "Das Modellbild konnte nicht hochgeladen werden.");
  }
}
