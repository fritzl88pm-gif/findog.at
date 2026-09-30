import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { FREDRUN_ACCESS_BLOCK_CODE } from "@/lib/fredrun-access";
import { assertFredRunAccessAllowed, FredRunAccessBlockedServerError } from "@/lib/fredrun-access-server";
import {
  FREDRUN2_LEADERBOARD_LIMIT,
  isFredRun2Board,
  normalizeFredRun2Name,
  normalizeFredRun2Rows,
  parseFredRun2Submission,
  splitFredRun2Rows,
  type FredRun2BoardResponse,
} from "@/lib/fredrun2-highscores";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ServerClient = NonNullable<ReturnType<typeof getSupabaseServerClient>>;

function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

function errorMessage(error: unknown): string {
  return error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string"
    ? (error as { message: string }).message
    : "";
}

async function authenticatedContext(request: Request) {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new UserVisibleError("Die Fredrun-Bestenliste ist derzeit nicht verfügbar.", 503);
  const user = await authenticateSupabaseRequest(request, supabase);
  return { supabase, user };
}

async function loadPlayerName(supabase: ServerClient, userId: string): Promise<string> {
  const { data, error } = await supabase.from("fredrun_player_profiles").select("player_name").eq("user_id", userId).maybeSingle();
  if (error) throw new UserVisibleError("Die Fredrun-Bestenliste konnte nicht geladen werden.", 503);
  return normalizeFredRun2Name((data as { player_name?: unknown } | null)?.player_name) ?? "";
}

async function loadBoard(supabase: ServerClient, userId: string, board: string): Promise<FredRun2BoardResponse> {
  const [rowsResult, playerName] = await Promise.all([
    supabase.rpc("get_fredrun2_leaderboard", { requested_board: board, viewer_id: userId, max_rows: FREDRUN2_LEADERBOARD_LIMIT }),
    loadPlayerName(supabase, userId),
  ]);
  if (rowsResult.error) throw new UserVisibleError("Die Fredrun-Bestenliste konnte nicht geladen werden.", 503);
  const { top, me } = splitFredRun2Rows(normalizeFredRun2Rows(rowsResult.data));
  return { board, entries: top, me, playerName };
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof FredRunAccessBlockedServerError) {
    return json({ error: error.message, code: FREDRUN_ACCESS_BLOCK_CODE }, error.status);
  }
  if (error instanceof UserVisibleError) return json({ error: error.message }, error.status);
  return json({ error: "Die Fredrun-Bestenliste ist derzeit nicht verfügbar." }, 500);
}

/** Globale Bestenliste eines Boards (`world:<welt>`, `tour`, `daily:<Datum>`), je Spieler der beste Lauf. */
export async function GET(request: Request) {
  try {
    const { supabase, user } = await authenticatedContext(request);
    await assertFredRunAccessAllowed(supabase, user.id);
    const boards = new URL(request.url).searchParams.getAll("board");
    if (boards.length !== 1 || !isFredRun2Board(boards[0])) {
      throw new UserVisibleError("Bitte eine gültige Bestenliste auswählen.", 400);
    }
    return json(await loadBoard(supabase, user.id, boards[0]));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Reicht einen Lauf ein (idempotent über runId) und liefert die aktualisierte Bestenliste samt eigenem Platz. */
export async function POST(request: Request) {
  try {
    const { supabase, user } = await authenticatedContext(request);
    await assertFredRunAccessAllowed(supabase, user.id);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new UserVisibleError("Die Einreichung enthält kein gültiges JSON.", 400);
    }
    const submission = parseFredRun2Submission(body);
    if (!submission) {
      throw new UserVisibleError("Bitte einen Namen mit höchstens 16 Zeichen und einen gültigen Lauf einreichen.", 400);
    }
    // Ohne Namen (z. B. übersprungen) bleibt der vorhandene Fredrun-Name erhalten
    const name = submission.name || (await loadPlayerName(supabase, user.id)) || "Spieler";

    const { data, error } = await supabase.rpc("submit_fredrun2_score", {
      player_id: user.id,
      submitted_run_id: submission.runId,
      submitted_name: name,
      submitted_board: submission.board,
      submitted_score: submission.score,
      submitted_meters: submission.meters,
      submitted_hero: submission.character,
    });
    if (error) {
      if (errorMessage(error).includes("fredrun submission rate limit exceeded")) {
        throw new UserVisibleError("Zu viele Einreichungen. Bitte kurz warten.", 429);
      }
      throw new UserVisibleError("Der Score konnte nicht eingereicht werden.", 503);
    }
    return json({ ...(await loadBoard(supabase, user.id, submission.board)), submitted: data === true });
  } catch (error) {
    return errorResponse(error);
  }
}
