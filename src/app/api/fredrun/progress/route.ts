import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { FREDRUN_ACCESS_BLOCK_CODE } from "@/lib/fredrun-access";
import {
  assertFredRunAccessAllowed,
  FredRunAccessBlockedServerError,
} from "@/lib/fredrun-access-server";
import {
  parseFredRunProgressAction,
  parseFredRunProgressApiResponse,
  parseFredRunServerProgress,
  type FredRunProgressAction,
} from "@/lib/fredrun-progress";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function authenticatedContext(request: Request) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    throw new UserVisibleError("Dein FredRun-Spielstand ist derzeit nicht verfügbar.", 503);
  }
  const user = await authenticateSupabaseRequest(request, supabase);
  return { supabase, user };
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof FredRunAccessBlockedServerError) {
    return json({ error: error.message, code: FREDRUN_ACCESS_BLOCK_CODE }, error.status);
  }
  if (error instanceof UserVisibleError) return json({ error: error.message }, error.status);
  return json({ error: "Dein FredRun-Spielstand ist derzeit nicht verfügbar." }, 500);
}

function mutationParameters(action: FredRunProgressAction, userId: string) {
  return {
    player_id: userId,
    requested_action: action.action,
    submitted_run_id: action.action === "settle_run" ? action.runId : null,
    submitted_coins: action.action === "settle_run" ? action.collectedCoins : null,
    submitted_score: action.action === "settle_run" ? action.score : null,
    target_type: action.action === "settle_run" ? null : action.itemType,
    target_id: action.action === "settle_run" ? null : action.itemId,
  };
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await authenticatedContext(request);
    await assertFredRunAccessAllowed(supabase, user.id);
    const { data, error } = await supabase.rpc("ensure_fredrun_user_progress", {
      player_id: user.id,
    });
    const progress = error ? null : parseFredRunServerProgress(data);
    if (!progress) {
      throw new UserVisibleError("Dein FredRun-Spielstand konnte nicht geladen werden.", 503);
    }
    return json({ progress, awardedCoins: 0 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await authenticatedContext(request);
    await assertFredRunAccessAllowed(supabase, user.id);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new UserVisibleError("Die FredRun-Aktion enthält kein gültiges JSON.", 400);
    }
    const action = parseFredRunProgressAction(body);
    if (!action) {
      throw new UserVisibleError("Die FredRun-Aktion ist ungültig.", 400);
    }

    const { data, error } = await supabase.rpc(
      "apply_fredrun_progress_action",
      mutationParameters(action, user.id),
    );
    const raw = record(data);
    const progress = error ? null : parseFredRunServerProgress(raw);
    const response = progress && raw
      ? parseFredRunProgressApiResponse({
        progress,
        status: raw.status,
        awardedCoins: raw.awardedCoins,
      })
      : null;
    if (!response) {
      throw new UserVisibleError("Die FredRun-Aktion konnte nicht gespeichert werden.", 503);
    }
    return json(response);
  } catch (error) {
    return errorResponse(error);
  }
}
