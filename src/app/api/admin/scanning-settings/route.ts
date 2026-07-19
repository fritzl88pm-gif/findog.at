import { NextResponse } from "next/server";

import { isAdminUser } from "@/lib/admin-auth";
import { authenticateSupabaseRequest, type AuthenticatedUser } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getScanningSettings, isValidModelId, updateScanningSettings } from "@/lib/scanning/settings";
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
  const record = await getScanningSettings(supabase);
  return {
    modelId: record.modelId,
    prompt: record.prompt,
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
  };
}

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function errorResponse(error: unknown) {
  if (error instanceof UserVisibleError) return json({ error: error.message }, error.status);
  return json({ error: "Die Scanning-Konfiguration konnte nicht verarbeitet werden." }, 500);
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
    ) {
      throw new UserVisibleError("Die Anfrage ist ungültig.", 400);
    }
    const fields = body as Record<string, unknown>;
    if (Object.keys(fields).length !== 2) {
      throw new UserVisibleError("Die Anfrage muss genau die Felder modelId und prompt enthalten.", 400);
    }
    if (typeof fields.modelId !== "string" || typeof fields.prompt !== "string") {
      throw new UserVisibleError("Die Anfrage muss genau die Felder modelId und prompt enthalten.", 400);
    }
    if (!isValidModelId(fields.modelId)) {
      throw new UserVisibleError("Die OpenRouter-Modell-ID ist ungültig.", 400);
    }
    if (!fields.prompt.trim()) {
      throw new UserVisibleError("Der Scanning-Prompt darf nicht leer sein.", 400);
    }
    const record = await updateScanningSettings(supabase, user.id, fields.modelId, fields.prompt);
    return json({
      modelId: record.modelId,
      prompt: record.prompt,
      updatedAt: record.updatedAt,
      updatedBy: record.updatedBy,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
