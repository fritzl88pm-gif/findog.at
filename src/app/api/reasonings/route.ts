import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { parseReasoningInput } from "@/lib/reasonings";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type CategoryRow = {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
};

type ReasoningRow = {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
};

type CategoryLinkRow = {
  reasoning_id: string;
  category_id: string;
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

export async function GET(request: Request) {
  try {
    const { supabase, user } = await authenticatedContext(request);
    const [categoriesResult, reasoningsResult, linksResult] = await Promise.all([
      supabase
        .from("user_reasoning_categories")
        .select("id,name,parent_id,created_at,updated_at")
        .eq("client_id", user.id)
        .order("name", { ascending: true }),
      supabase
        .from("user_reasonings")
        .select("id,title,content,created_at,updated_at")
        .eq("client_id", user.id)
        .order("updated_at", { ascending: false })
        .order("id", { ascending: false }),
      supabase
        .from("user_reasoning_category_links")
        .select("reasoning_id,category_id")
        .eq("client_id", user.id),
    ]);

    if (categoriesResult.error || reasoningsResult.error || linksResult.error) {
      throw new UserVisibleError("Textbausteine konnten nicht geladen werden.", 503);
    }

    const linksByReasoning = new Map<string, string[]>();
    for (const link of (linksResult.data ?? []) as CategoryLinkRow[]) {
      const categoryIds = linksByReasoning.get(link.reasoning_id) ?? [];
      categoryIds.push(link.category_id);
      linksByReasoning.set(link.reasoning_id, categoryIds);
    }

    return json({
      categories: ((categoriesResult.data ?? []) as CategoryRow[]).map((category) => ({
        id: category.id,
        name: category.name,
        parentId: category.parent_id,
        createdAt: category.created_at,
        updatedAt: category.updated_at,
      })),
      reasonings: ((reasoningsResult.data ?? []) as ReasoningRow[]).map((reasoning) => ({
        id: reasoning.id,
        title: reasoning.title,
        content: reasoning.content,
        categoryIds: linksByReasoning.get(reasoning.id) ?? [],
        createdAt: reasoning.created_at,
        updatedAt: reasoning.updated_at,
      })),
    });
  } catch (error) {
    if (error instanceof UserVisibleError) return json({ error: error.message }, error.status);
    return json({ error: "Textbausteine konnten nicht geladen werden." }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await authenticatedContext(request);
    const input = parseReasoningInput(await requestBody(request));
    const { data, error } = await supabase.rpc("save_user_reasoning", {
      p_client_id: user.id,
      p_reasoning_id: null,
      p_title: input.title,
      p_content: input.content,
      p_category_ids: input.categoryIds,
    });
    if (error || typeof data !== "string") {
      throw new UserVisibleError(
        error?.code === "42501"
          ? "Mindestens eine Kategorie ist nicht verfügbar."
          : "Textbaustein konnte nicht angelegt werden.",
        error?.code === "42501" ? 400 : 503,
      );
    }
    return json({ id: data }, 201);
  } catch (error) {
    if (error instanceof UserVisibleError) return json({ error: error.message }, error.status);
    return json({ error: "Textbaustein konnte nicht angelegt werden." }, 500);
  }
}
