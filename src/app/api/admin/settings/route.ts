import { NextResponse } from "next/server";

import { isAdminUser } from "@/lib/admin-auth";
import { authenticateSupabaseRequest, type AuthenticatedUser } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import {
  getGlobalSystemPromptRecord,
  updateGlobalSystemPrompt,
} from "@/lib/global-system-prompt";
import {
  getResearchResultLimit,
  MAX_RESEARCH_RESULT_LIMIT,
  MIN_RESEARCH_RESULT_LIMIT,
  parseResearchResultLimit,
  updateResearchResultLimit,
} from "@/lib/research-settings";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ServerClient = NonNullable<ReturnType<typeof getSupabaseServerClient>>;

const ALLOWED_SETTING_KEYS = new Set(["systemPrompt", "researchResultLimit"]);

async function authenticateAdmin(
  request: Request,
  supabase: ServerClient,
): Promise<AuthenticatedUser> {
  const user = await authenticateSupabaseRequest(request, supabase);
  if (!await isAdminUser(supabase, user.id)) {
    throw new UserVisibleError("Du hast keine Administrationsberechtigung.", 403);
  }
  return user;
}

async function readSettings(supabase: ServerClient) {
  const [record, researchResultLimit] = await Promise.all([
    getGlobalSystemPromptRecord(supabase),
    getResearchResultLimit(supabase),
  ]);
  return {
    systemPrompt: record.systemPrompt,
    researchResultLimit,
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
  };
}

function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof UserVisibleError) {
    return json({ error: error.message }, error.status);
  }
  return json({ error: "Die globalen Einstellungen konnten nicht verarbeitet werden." }, 500);
}

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Administration ist derzeit nicht verfügbar.", 503);
    }
    await authenticateAdmin(request, supabase);
    return json(await readSettings(supabase));
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
    const entries = body as Record<string, unknown>;
    const keys = Object.keys(entries);
    if (keys.length === 0 || keys.some((key) => !ALLOWED_SETTING_KEYS.has(key))) {
      throw new UserVisibleError("Die globalen Einstellungen enthalten ungültige Felder.", 400);
    }

    // Validate everything before writing so an invalid field can never leave a
    // partially-applied settings row behind.
    if ("systemPrompt" in entries
      && (typeof entries.systemPrompt !== "string" || !entries.systemPrompt.trim())) {
      throw new UserVisibleError("Der globale Systemprompt darf nicht leer sein.", 400);
    }
    if ("researchResultLimit" in entries
      && parseResearchResultLimit(entries.researchResultLimit) === null) {
      throw new UserVisibleError(
        `Das Rechercheergebnis-Limit muss eine ganze Zahl zwischen ${MIN_RESEARCH_RESULT_LIMIT} und ${MAX_RESEARCH_RESULT_LIMIT} sein.`,
        400,
      );
    }

    if ("systemPrompt" in entries) {
      await updateGlobalSystemPrompt(supabase, user.id, entries.systemPrompt);
    }
    if ("researchResultLimit" in entries) {
      await updateResearchResultLimit(supabase, user.id, entries.researchResultLimit);
    }

    return json(await readSettings(supabase));
  } catch (error) {
    return errorResponse(error);
  }
}
