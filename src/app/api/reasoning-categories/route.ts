import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { parseCategoryName } from "@/lib/reasonings";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

async function requestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new UserVisibleError("Die Anfrage enthält kein gültiges JSON.", 400);
  }
}

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Kategorien sind derzeit nicht verfügbar.", 503);
    }
    const user = await authenticateSupabaseRequest(request, supabase);
    const name = parseCategoryName(await requestBody(request));
    const { data, error } = await supabase
      .from("user_reasoning_categories")
      .insert({ client_id: user.id, name })
      .select("id,name,created_at,updated_at")
      .single();
    if (error || !data) {
      throw new UserVisibleError(
        error?.code === "23505"
          ? "Eine Kategorie mit diesem Namen gibt es bereits."
          : "Kategorie konnte nicht angelegt werden.",
        error?.code === "23505" ? 409 : 503,
      );
    }
    return json({
      category: {
        id: data.id,
        name: data.name,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
    }, 201);
  } catch (error) {
    if (error instanceof UserVisibleError) return json({ error: error.message }, error.status);
    return json({ error: "Kategorie konnte nicht angelegt werden." }, 500);
  }
}
