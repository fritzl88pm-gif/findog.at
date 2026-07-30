import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { parseCategoryInput } from "@/lib/reasonings";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type CategoryRow = {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
};

function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

async function authenticatedContext(request: Request) {
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

export async function GET(request: Request) {
  try {
    const { supabase, user } = await authenticatedContext(request);
    const { data, error } = await supabase
      .from("user_reasoning_categories")
      .select("id,name,parent_id,created_at,updated_at")
      .eq("client_id", user.id)
      .order("name", { ascending: true });
    if (error) {
      throw new UserVisibleError("Kategorien konnten nicht geladen werden.", 503);
    }
    return json({
      categories: ((data ?? []) as CategoryRow[]).map((category) => ({
        id: category.id,
        name: category.name,
        parentId: category.parent_id,
        createdAt: category.created_at,
        updatedAt: category.updated_at,
      })),
    });
  } catch (error) {
    if (error instanceof UserVisibleError) return json({ error: error.message }, error.status);
    return json({ error: "Kategorien konnten nicht geladen werden." }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await authenticatedContext(request);
    const input = parseCategoryInput(await requestBody(request));
    const insertPayload: Record<string, unknown> = {
      client_id: user.id,
      name: input.name,
    };
    if (input.parentId) {
      insertPayload.parent_id = input.parentId;
    }
    const { data, error } = await supabase
      .from("user_reasoning_categories")
      .insert(insertPayload)
      .select("id,name,parent_id,created_at,updated_at")
      .single();
    if (error || !data) {
      const isConflict = error?.code === "23505";
      const isDepthViolation = error?.code === "23514";
      const isMissingParent = error?.code === "23503";
      throw new UserVisibleError(
        isConflict
          ? "Eine Kategorie mit diesem Namen gibt es unter dieser übergeordneten Kategorie bereits."
          : isDepthViolation
            ? "Kategorien unterstützen nur eine Hierarchieebene."
            : isMissingParent
              ? "Die übergeordnete Kategorie ist nicht verfügbar."
              : "Kategorie konnte nicht angelegt werden.",
        isConflict ? 409 : isDepthViolation || isMissingParent ? 400 : 503,
      );
    }
    return json({
      category: {
        id: data.id,
        name: data.name,
        parentId: data.parent_id,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
    }, 201);
  } catch (error) {
    if (error instanceof UserVisibleError) return json({ error: error.message }, error.status);
    return json({ error: "Kategorie konnte nicht angelegt werden." }, 500);
  }
}
