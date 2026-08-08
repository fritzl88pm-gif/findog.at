import { NextResponse } from "next/server";

import { authenticateAdminRequest } from "@/lib/admin-users";
import {
  mapDownloadCategory,
  parseDownloadCategoryInput,
  parseDownloadDeleteInput,
  requireDownloadUuid,
} from "@/lib/downloads";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type CategoryRow = Parameters<typeof mapDownloadCategory>[0];

function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

async function requestJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new UserVisibleError("Die Anfrage enthält kein gültiges JSON.", 400);
  }
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof UserVisibleError) {
    return json({ error: error.message }, error.status);
  }
  return json({ error: "Die Downloadkategorie konnte nicht verarbeitet werden." }, 500);
}

function databaseError(error: { code?: string } | null, fallback: string): never {
  if (error?.code === "23505") {
    throw new UserVisibleError("Eine aktive Kategorie mit diesem Namen besteht bereits.", 409);
  }
  if (error?.code === "23503") {
    throw new UserVisibleError("Die Kategorie enthält noch Dokumente und kann nicht gelöscht werden.", 409);
  }
  throw new UserVisibleError(fallback, 503);
}

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Administration ist derzeit nicht verfügbar.", 503);
    }
    const user = await authenticateAdminRequest(request, supabase);
    const input = parseDownloadCategoryInput(await requestJson(request));
    const { data, error } = await supabase
      .from("download_categories")
      .insert({
        name: input.name,
        description: input.description,
        sort_order: input.sortOrder,
        created_by: user.id,
        updated_by: user.id,
      })
      .select("id,name,description,sort_order,created_at,updated_at")
      .single();
    if (error || !data) {
      databaseError(error, "Die Kategorie konnte nicht angelegt werden.");
    }
    return json({ category: mapDownloadCategory(data as CategoryRow) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Administration ist derzeit nicht verfügbar.", 503);
    }
    const user = await authenticateAdminRequest(request, supabase);
    const body = await requestJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new UserVisibleError("Die Kategorieangaben sind ungültig.", 400);
    }
    const fields = body as Record<string, unknown>;
    const keys = Object.keys(fields).sort();
    if (keys.join(",") !== "description,id,name,sortOrder") {
      throw new UserVisibleError("Die Kategorieangaben enthalten ungültige Felder.", 400);
    }
    const id = requireDownloadUuid(fields.id, "Die Kategorie-ID");
    const input = parseDownloadCategoryInput({
      name: fields.name,
      description: fields.description,
      sortOrder: fields.sortOrder,
    });
    const { data, error } = await supabase
      .from("download_categories")
      .update({
        name: input.name,
        description: input.description,
        sort_order: input.sortOrder,
        updated_by: user.id,
      })
      .eq("id", id)
      .is("deleted_at", null)
      .select("id,name,description,sort_order,created_at,updated_at")
      .maybeSingle();
    if (error) {
      databaseError(error, "Die Kategorie konnte nicht gespeichert werden.");
    }
    if (!data) {
      throw new UserVisibleError("Die Kategorie wurde nicht gefunden.", 404);
    }
    return json({ category: mapDownloadCategory(data as CategoryRow) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Administration ist derzeit nicht verfügbar.", 503);
    }
    const user = await authenticateAdminRequest(request, supabase);
    const id = parseDownloadDeleteInput(await requestJson(request), "Die Kategorie-ID");

    const { count, error: countError } = await supabase
      .from("download_documents")
      .select("id", { count: "exact", head: true })
      .eq("category_id", id)
      .is("deleted_at", null);
    if (countError) {
      throw new UserVisibleError("Die Kategorie konnte nicht geprüft werden.", 503);
    }
    if ((count ?? 0) > 0) {
      throw new UserVisibleError("Die Kategorie enthält noch Dokumente und kann nicht gelöscht werden.", 409);
    }

    const { data, error } = await supabase
      .from("download_categories")
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: user.id,
        updated_by: user.id,
      })
      .eq("id", id)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (error) {
      databaseError(error, "Die Kategorie konnte nicht gelöscht werden.");
    }
    if (!data) {
      throw new UserVisibleError("Die Kategorie wurde nicht gefunden.", 404);
    }
    return json({ id });
  } catch (error) {
    return errorResponse(error);
  }
}
