import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { parseCategoryName, requireReasoningUuid } from "@/lib/reasonings";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

async function contextFor(request: Request, categoryId: string) {
  requireReasoningUuid(categoryId, "Kategorie-ID");
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    throw new UserVisibleError("Kategorien sind derzeit nicht verfügbar.", 503);
  }
  const user = await authenticateSupabaseRequest(request, supabase);
  return { supabase, user };
}

async function requestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new UserVisibleError("Die Anfrage enthält kein gültiges JSON.", 400);
  }
}

export async function PATCH(
  request: Request,
  routeContext: { params: Promise<{ categoryId: string }> },
) {
  try {
    const { categoryId } = await routeContext.params;
    const { supabase, user } = await contextFor(request, categoryId);
    const name = parseCategoryName(await requestBody(request));
    const { data, error } = await supabase
      .from("user_reasoning_categories")
      .update({ name, updated_at: new Date().toISOString() })
      .eq("id", categoryId)
      .eq("client_id", user.id)
      .select("id,name,parent_id,created_at,updated_at")
      .maybeSingle();
    if (error) {
      throw new UserVisibleError(
        error.code === "23505"
          ? "Eine Kategorie mit diesem Namen gibt es bereits."
          : "Kategorie konnte nicht umbenannt werden.",
        error.code === "23505" ? 409 : 503,
      );
    }
    if (!data) {
      throw new UserVisibleError("Kategorie wurde nicht gefunden.", 404);
    }
    return json({
      category: {
        id: data.id,
        name: data.name,
        parentId: data.parent_id,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
    });
  } catch (error) {
    if (error instanceof UserVisibleError) return json({ error: error.message }, error.status);
    return json({ error: "Kategorie konnte nicht umbenannt werden." }, 500);
  }
}

export async function DELETE(
  request: Request,
  routeContext: { params: Promise<{ categoryId: string }> },
) {
  try {
    const { categoryId } = await routeContext.params;
    const { supabase, user } = await contextFor(request, categoryId);
    const { data, error } = await supabase
      .from("user_reasoning_categories")
      .delete()
      .eq("id", categoryId)
      .eq("client_id", user.id)
      .select("id");
    if (error) {
      // FK violation - parent has children
      if (error.code === "23503") {
        throw new UserVisibleError(
          "Diese Kategorie enthält Unterkategorien und kann daher nicht gelöscht werden. Bitte lösche zuerst die Unterkategorien.",
          409,
        );
      }
      throw new UserVisibleError("Kategorie konnte nicht gelöscht werden.", 503);
    }
    if (!Array.isArray(data) || data.length === 0) {
      throw new UserVisibleError("Kategorie wurde nicht gefunden.", 404);
    }
    return json({ id: categoryId });
  } catch (error) {
    if (error instanceof UserVisibleError) return json({ error: error.message }, error.status);
    return json({ error: "Kategorie konnte nicht gelöscht werden." }, 500);
  }
}
