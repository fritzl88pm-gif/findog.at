import { NextResponse } from "next/server";

import { authenticateAdminRequest } from "@/lib/admin-users";
import {
  assertDashboardNewsStatusTransition,
  DASHBOARD_NEWS_SELECT,
  dashboardNewsInputToRow,
  mapDashboardNewsItem,
  parseDashboardNewsInput,
  requireDashboardNewsId,
  type DashboardNewsRow,
  type DashboardNewsStatus,
} from "@/lib/dashboard";
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
  if (error instanceof UserVisibleError) {
    return json({ error: error.message }, error.status);
  }
  return json({ error: "Die Startseiten-News konnten nicht verarbeitet werden." }, 500);
}

function databaseWriteError(error: { code?: string } | null): UserVisibleError {
  if (error?.code === "23505") {
    return new UserVisibleError(
      "Für dieses Quellsystem und diese amtliche Kennung besteht bereits eine aktive Rechtsmeldung.",
      409,
    );
  }
  if (error?.code === "23514") {
    return new UserVisibleError("Die Meldung verletzt eine Datenregel und konnte nicht gespeichert werden.", 400);
  }
  return new UserVisibleError("Die Meldung konnte nicht gespeichert werden.", 503);
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) throw new UserVisibleError("Administration ist derzeit nicht verfügbar.", 503);
    await authenticateAdminRequest(request, supabase);
    const { data, error } = await supabase
      .from("dashboard_news_items")
      .select(DASHBOARD_NEWS_SELECT)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(500);
    if (error) throw new UserVisibleError("Startseiten-News konnten nicht geladen werden.", 503);
    return json({ items: ((data ?? []) as unknown as DashboardNewsRow[]).map(mapDashboardNewsItem) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) throw new UserVisibleError("Administration ist derzeit nicht verfügbar.", 503);
    const user = await authenticateAdminRequest(request, supabase);
    const input = parseDashboardNewsInput(await requestJson(request));
    assertDashboardNewsStatusTransition(null, input.status);
    const { data, error } = await supabase
      .from("dashboard_news_items")
      .insert({
        ...dashboardNewsInputToRow(input),
        created_by: user.id,
        updated_by: user.id,
      })
      .select(DASHBOARD_NEWS_SELECT)
      .single();
    if (error || !data) throw databaseWriteError(error);
    return json({ item: mapDashboardNewsItem(data as unknown as DashboardNewsRow) }, 201);
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
      throw new UserVisibleError("Die Meldungsangaben sind ungültig.", 400);
    }
    const { id: rawId, ...rawInput } = body as Record<string, unknown>;
    if (Object.keys(body).length !== 13) {
      throw new UserVisibleError("Die Meldungsangaben enthalten ungültige Felder.", 400);
    }
    const id = requireDashboardNewsId(rawId);
    const input = parseDashboardNewsInput(rawInput);
    const { data: current, error: currentError } = await supabase
      .from("dashboard_news_items")
      .select("status")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (currentError) throw new UserVisibleError("Die Meldung konnte nicht geprüft werden.", 503);
    if (!current) throw new UserVisibleError("Die Meldung wurde nicht gefunden.", 404);
    assertDashboardNewsStatusTransition((current as { status: DashboardNewsStatus }).status, input.status);

    const { data, error } = await supabase
      .from("dashboard_news_items")
      .update({ ...dashboardNewsInputToRow(input), updated_by: user.id })
      .eq("id", id)
      .is("deleted_at", null)
      .select(DASHBOARD_NEWS_SELECT)
      .maybeSingle();
    if (error) throw databaseWriteError(error);
    if (!data) throw new UserVisibleError("Die Meldung wurde nicht gefunden.", 404);
    return json({ item: mapDashboardNewsItem(data as unknown as DashboardNewsRow) });
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
      throw new UserVisibleError("Die Meldungs-ID ist ungültig.", 400);
    }
    const fields = body as Record<string, unknown>;
    if (Object.keys(fields).length !== 1 || !("id" in fields)) {
      throw new UserVisibleError("Die Löschanfrage enthält ungültige Felder.", 400);
    }
    const id = requireDashboardNewsId(fields.id);
    const { data, error } = await supabase
      .from("dashboard_news_items")
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: user.id,
        updated_by: user.id,
      })
      .eq("id", id)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw new UserVisibleError("Die Meldung konnte nicht gelöscht werden.", 503);
    if (!data) throw new UserVisibleError("Die Meldung wurde nicht gefunden.", 404);
    return json({ id });
  } catch (error) {
    return errorResponse(error);
  }
}
