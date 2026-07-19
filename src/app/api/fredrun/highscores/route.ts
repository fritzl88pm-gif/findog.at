import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import {
  normalizeFredRunLeaderboardRows,
  normalizeFredRunPlayerName,
  parseFredRunScoreSubmission,
} from "@/lib/fredrun-highscores";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type DatabaseError = { message?: string };

function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

function databaseErrorMessage(error: unknown): string {
  return error && typeof error === "object" && !Array.isArray(error)
    && typeof (error as DatabaseError).message === "string"
    ? (error as DatabaseError).message ?? ""
    : "";
}

async function authenticatedContext(request: Request) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    throw new UserVisibleError("Die Fredrun-Topliste ist derzeit nicht verfügbar.", 503);
  }
  const user = await authenticateSupabaseRequest(request, supabase);
  return { supabase, user };
}

async function loadHighscores(
  supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  userId: string,
) {
  const [scoresResult, profileResult] = await Promise.all([
    supabase
      .from("fredrun_scores")
      .select("id,score,created_at,fredrun_player_profiles!inner(player_name)")
      .order("score", { ascending: false })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(10),
    supabase
      .from("fredrun_player_profiles")
      .select("player_name")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (scoresResult.error || profileResult.error) {
    throw new UserVisibleError("Die Fredrun-Topliste konnte nicht geladen werden.", 503);
  }

  const profile = profileResult.data as { player_name?: unknown } | null;
  return {
    entries: normalizeFredRunLeaderboardRows(scoresResult.data),
    playerName: normalizeFredRunPlayerName(profile?.player_name) ?? "",
  };
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof UserVisibleError) return json({ error: error.message }, error.status);
  return json({ error: "Die Fredrun-Topliste ist derzeit nicht verfügbar." }, 500);
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await authenticatedContext(request);
    return json(await loadHighscores(supabase, user.id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await authenticatedContext(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new UserVisibleError("Die Highscore-Einreichung enthält kein gültiges JSON.", 400);
    }
    const submission = parseFredRunScoreSubmission(body);
    if (!submission) {
      throw new UserVisibleError(
        "Bitte einen Namen mit höchstens 20 Zeichen und einen gültigen Score eingeben.",
        400,
      );
    }

    const { data, error } = await supabase.rpc("submit_fredrun_score", {
      player_id: user.id,
      submitted_run_id: submission.runId,
      submitted_name: submission.name,
      submitted_score: submission.score,
    });
    if (error) {
      if (databaseErrorMessage(error).includes("fredrun submission rate limit exceeded")) {
        throw new UserVisibleError("Zu viele Highscore-Einreichungen. Bitte kurz warten.", 429);
      }
      throw new UserVisibleError("Der Score konnte nicht eingereicht werden.", 503);
    }

    return json({
      ...(await loadHighscores(supabase, user.id)),
      submitted: data === true,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
