import { NextResponse } from "next/server";

import {
  getGlobalSystemPrompt,
  isAdminUser,
  updateGlobalSystemPrompt,
} from "@/lib/admin-settings";
import { authenticateSupabaseRequest, type AuthenticatedUser } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ServerClient = NonNullable<ReturnType<typeof getSupabaseServerClient>>;

async function authenticateAdmin(request: Request, supabase: ServerClient): Promise<AuthenticatedUser> {
  const user = await authenticateSupabaseRequest(request, supabase);
  if (!await isAdminUser(supabase, user.id)) {
    throw new UserVisibleError("Du hast keine Administrationsberechtigung.", 403);
  }
  return user;
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof UserVisibleError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json(
    { error: "Globale Einstellungen konnten nicht verarbeitet werden." },
    { status: 500 },
  );
}

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Administration ist derzeit nicht verfügbar.", 503);
    }
    await authenticateAdmin(request, supabase);
    return NextResponse.json({ systemPrompt: await getGlobalSystemPrompt(supabase) });
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
    const user = await authenticateAdmin(request, supabase);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new UserVisibleError("Die Anfrage enthält kein gültiges JSON.", 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new UserVisibleError("Die globalen Einstellungen sind ungültig.", 400);
    }
    const keys = Object.keys(body);
    if (keys.length !== 1 || keys[0] !== "systemPrompt") {
      throw new UserVisibleError("Die globalen Einstellungen enthalten ungültige Felder.", 400);
    }

    const systemPrompt = await updateGlobalSystemPrompt(
      supabase,
      user.id,
      (body as Record<string, unknown>).systemPrompt,
    );
    return NextResponse.json({ systemPrompt });
  } catch (error) {
    return errorResponse(error);
  }
}
