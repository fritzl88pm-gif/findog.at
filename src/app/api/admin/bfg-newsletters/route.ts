import { NextResponse } from "next/server";

import { authenticateAdminRequest } from "@/lib/admin-users";
import {
  BFG_NEWSLETTER_SELECT,
  bfgNewsletterInputToRow,
  mapBfgNewsletterItem,
  parseBfgNewsletterInput,
  requireBfgNewsletterId,
  type BfgNewsletterRow,
} from "@/lib/bfg-newsletters";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Vary: "Authorization",
    },
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
  if (error instanceof UserVisibleError) return json({ error: error.message }, error.status);
  return json({ error: "BFG Newsletter konnte nicht verarbeitet werden." }, 500);
}

function databaseWriteError(error: { code?: string } | null): UserVisibleError {
  if (error?.code === "23514") {
    return new UserVisibleError("Der Newsletter verletzt eine Datenregel und konnte nicht gespeichert werden.", 400);
  }
  return new UserVisibleError("Der Newsletter konnte nicht gespeichert werden.", 503);
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) throw new UserVisibleError("Administration ist derzeit nicht verfügbar.", 503);
    await authenticateAdminRequest(request, supabase);

    const { data, error } = await supabase
      .from("bfg_newsletters")
      .select(BFG_NEWSLETTER_SELECT)
      .is("deleted_at", null)
      .order("publication_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(500);
    if (error) throw new UserVisibleError("BFG Newsletter konnte nicht geladen werden.", 503);
    return json({
      items: ((data ?? []) as unknown as BfgNewsletterRow[]).map(mapBfgNewsletterItem),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) throw new UserVisibleError("Administration ist derzeit nicht verfügbar.", 503);
    const user = await authenticateAdminRequest(request, supabase);
    const input = parseBfgNewsletterInput(await requestJson(request));

    const { data, error } = await supabase
      .from("bfg_newsletters")
      .insert({
        ...bfgNewsletterInputToRow(input),
        created_by: user.id,
        updated_by: user.id,
      })
      .select(BFG_NEWSLETTER_SELECT)
      .single();
    if (error || !data) throw databaseWriteError(error);
    return json({ item: mapBfgNewsletterItem(data as unknown as BfgNewsletterRow) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) throw new UserVisibleError("Administration ist derzeit nicht verfügbar.", 503);
    const user = await authenticateAdminRequest(request, supabase);
    const body = await requestJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new UserVisibleError("Die Newsletterangaben sind ungültig.", 400);
    }
    const { id: rawId, ...rawInput } = body as Record<string, unknown>;
    if (Object.keys(body).length !== 3) {
      throw new UserVisibleError("Die Newsletterangaben enthalten ungültige Felder.", 400);
    }
    const id = requireBfgNewsletterId(rawId);
    const input = parseBfgNewsletterInput(rawInput);

    const { data, error } = await supabase
      .from("bfg_newsletters")
      .update({ ...bfgNewsletterInputToRow(input), updated_by: user.id })
      .eq("id", id)
      .is("deleted_at", null)
      .select(BFG_NEWSLETTER_SELECT)
      .maybeSingle();
    if (error) throw databaseWriteError(error);
    if (!data) throw new UserVisibleError("Der Newsletter wurde nicht gefunden.", 404);
    return json({ item: mapBfgNewsletterItem(data as unknown as BfgNewsletterRow) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) throw new UserVisibleError("Administration ist derzeit nicht verfügbar.", 503);
    const user = await authenticateAdminRequest(request, supabase);
    const body = await requestJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new UserVisibleError("Die Newsletter-ID ist ungültig.", 400);
    }
    const fields = body as Record<string, unknown>;
    if (Object.keys(fields).length !== 1 || !("id" in fields)) {
      throw new UserVisibleError("Die Löschanfrage enthält ungültige Felder.", 400);
    }
    const id = requireBfgNewsletterId(fields.id);

    const { data, error } = await supabase
      .from("bfg_newsletters")
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: user.id,
        updated_by: user.id,
      })
      .eq("id", id)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw new UserVisibleError("Der Newsletter konnte nicht gelöscht werden.", 503);
    if (!data) throw new UserVisibleError("Der Newsletter wurde nicht gefunden.", 404);
    return json({ id });
  } catch (error) {
    return errorResponse(error);
  }
}
