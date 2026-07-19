import { NextResponse } from "next/server";

import { isAdminUser } from "@/lib/admin-auth";
import { authenticateSupabaseRequest, type AuthenticatedUser } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getGlobalSystemPromptRecord, updateGlobalSystemPrompt } from "@/lib/global-system-prompt";
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

async function readSettings(supabase: ServerClient) {
  const record = await getGlobalSystemPromptRecord(supabase);
  return {
    systemPrompt: record.systemPrompt,
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
  };
}

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function errorResponse(error: unknown) {
  if (error instanceof UserVisibleError) return json({ error: error.message }, error.status);
  return json({ error: "Der BFG-PRO-Systemprompt konnte nicht verarbeitet werden." }, 500);
}

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) throw new UserVisibleError("Administration ist derzeit nicht verfügbar.", 503);
    await authenticateAdmin(request, supabase);
    return json(await readSettings(supabase));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) throw new UserVisibleError("Administration ist derzeit nicht verfügbar.", 503);
    const user = await authenticateAdmin(request, supabase);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new UserVisibleError("Die Anfrage enthält kein gültiges JSON.", 400);
    }
    if (
      !body
      || typeof body !== "object"
      || Array.isArray(body)
      || Object.keys(body).length !== 1
      || typeof (body as Record<string, unknown>).systemPrompt !== "string"
      || !(body as Record<string, string>).systemPrompt.trim()
    ) {
      throw new UserVisibleError("Der BFG-PRO-Systemprompt ist ungültig.", 400);
    }
    await updateGlobalSystemPrompt(supabase, user.id, (body as Record<string, string>).systemPrompt);
    return json(await readSettings(supabase));
  } catch (error) {
    return errorResponse(error);
  }
}
