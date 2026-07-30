import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { parseReasoningInput, requireReasoningUuid } from "@/lib/reasonings";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

async function contextFor(request: Request, reasoningId: string) {
  requireReasoningUuid(reasoningId, "Textbaustein-ID");
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    throw new UserVisibleError("Textbausteine sind derzeit nicht verfügbar.", 503);
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
  routeContext: { params: Promise<{ reasoningId: string }> },
) {
  try {
    const { reasoningId } = await routeContext.params;
    const { supabase, user } = await contextFor(request, reasoningId);
    const input = parseReasoningInput(await requestBody(request));
    const { data, error } = await supabase.rpc("save_user_reasoning", {
      p_client_id: user.id,
      p_reasoning_id: reasoningId,
      p_title: input.title,
      p_content: input.content,
      p_category_ids: input.categoryIds,
    });
    if (error || data !== reasoningId) {
      const notFound = error?.code === "P0002";
      throw new UserVisibleError(
        notFound
          ? "Textbaustein wurde nicht gefunden."
          : error?.code === "42501"
            ? "Mindestens eine Kategorie ist nicht verfügbar."
            : "Textbaustein konnte nicht gespeichert werden.",
        notFound ? 404 : error?.code === "42501" ? 400 : 503,
      );
    }
    return json({ id: data });
  } catch (error) {
    if (error instanceof UserVisibleError) return json({ error: error.message }, error.status);
    return json({ error: "Textbaustein konnte nicht gespeichert werden." }, 500);
  }
}

export async function DELETE(
  request: Request,
  routeContext: { params: Promise<{ reasoningId: string }> },
) {
  try {
    const { reasoningId } = await routeContext.params;
    const { supabase, user } = await contextFor(request, reasoningId);
    const { data, error } = await supabase
      .from("user_reasonings")
      .delete()
      .eq("id", reasoningId)
      .eq("client_id", user.id)
      .select("id");
    if (error) {
      throw new UserVisibleError("Textbaustein konnte nicht gelöscht werden.", 503);
    }
    if (!Array.isArray(data) || data.length === 0) {
      throw new UserVisibleError("Textbaustein wurde nicht gefunden.", 404);
    }
    return json({ id: reasoningId });
  } catch (error) {
    if (error instanceof UserVisibleError) return json({ error: error.message }, error.status);
    return json({ error: "Textbaustein konnte nicht gelöscht werden." }, 500);
  }
}
