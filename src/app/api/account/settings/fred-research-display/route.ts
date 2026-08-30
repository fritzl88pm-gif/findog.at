import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ResearchDisplayMode = "simple" | "advanced";

function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Vary: "Authorization",
    },
  });
}

function normalizeResearchDisplayMode(value: unknown): ResearchDisplayMode {
  return value === "advanced" ? "advanced" : "simple";
}

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Die Rechercheanzeige ist derzeit nicht verfügbar.", 503);
    }
    const user = await authenticateSupabaseRequest(request, supabase);

    const { data, error } = await supabase
      .from("fred_user_preferences")
      .select("research_display_mode")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      throw new UserVisibleError("Die Rechercheanzeige ist derzeit nicht verfügbar.", 503);
    }

    return json({
      researchDisplayMode: normalizeResearchDisplayMode(data?.research_display_mode),
    });
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return json({ error: error.message }, error.status);
    }
    return json({ error: "Die Rechercheanzeige ist derzeit nicht verfügbar." }, 503);
  }
}

export async function PUT(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Die Rechercheanzeige ist derzeit nicht verfügbar.", 503);
    }
    const user = await authenticateSupabaseRequest(request, supabase);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new UserVisibleError("Ungültiges JSON.", 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new UserVisibleError("Ungültiger Request-Body.", 400);
    }

    const record = body as Record<string, unknown>;
    if (
      Object.keys(record).length !== 1
      || !Object.hasOwn(record, "researchDisplayMode")
    ) {
      throw new UserVisibleError("Ungültiger Request-Body.", 400);
    }

    const rawMode = record.researchDisplayMode;
    if (rawMode !== "simple" && rawMode !== "advanced") {
      throw new UserVisibleError("Ungültiger Rechercheanzeige-Modus.", 400);
    }
    const researchDisplayMode: ResearchDisplayMode = rawMode;

    const { error } = await supabase
      .from("fred_user_preferences")
      .upsert(
        {
          user_id: user.id,
          research_display_mode: researchDisplayMode,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );

    if (error) {
      throw new UserVisibleError("Die Rechercheanzeige konnte nicht gespeichert werden.", 503);
    }

    return json({ researchDisplayMode });
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return json({ error: error.message }, error.status);
    }
    return json({ error: "Die Rechercheanzeige konnte nicht gespeichert werden." }, 503);
  }
}
