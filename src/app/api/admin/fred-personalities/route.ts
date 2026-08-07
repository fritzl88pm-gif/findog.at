import { NextResponse } from "next/server";

import { authenticateAdminRequest } from "@/lib/admin-users";
import { UserVisibleError } from "@/lib/errors";
import {
  generateProfileId,
  normalizePromptText,
  normalizeTitle,
  validatePostBody,
  validatePutBody,
} from "@/lib/fred/personality-profiles";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// ── Response shape ─────────────────────────────────────────────────────────

interface ProfileRow {
  id: string;
  title: string;
  prompt_text: string;
  is_builtin: boolean;
  created_at: string;
  updated_at: string;
}

interface ProfileResponseEntry {
  id: string;
  title: string;
  promptText: string;
  isBuiltin: boolean;
}

function mapProfileRow(row: ProfileRow): ProfileResponseEntry {
  return {
    id: row.id,
    title: row.title,
    promptText: row.prompt_text,
    isBuiltin: row.is_builtin,
  };
}

function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

// ── GET ────────────────────────────────────────────────────────────────────
// Admin-only. Returns all profiles ordered builtin-first, then by created_at.

export async function GET(_request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Persönlichkeitsprofile sind derzeit nicht verfügbar.", 503);
    }
    await authenticateAdminRequest(_request, supabase);

    const { data, error } = await supabase
      .from("fred_personality_profiles")
      .select("id,title,prompt_text,is_builtin,created_at,updated_at")
      .order("is_builtin", { ascending: false })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    if (error) {
      throw new UserVisibleError("Persönlichkeitsprofile sind derzeit nicht verfügbar.", 503);
    }

    const personalities: ProfileResponseEntry[] = ((data ?? []) as ProfileRow[]).map(mapProfileRow);

    return json({ personalities });
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return json({ error: error.message }, error.status);
    }
    return json(
      { error: "Persönlichkeitsprofile sind derzeit nicht verfügbar." },
      503,
    );
  }
}

// ── POST ───────────────────────────────────────────────────────────────────
// Admin-only. Create a new profile from {title, promptText}.
// ID is server-generated via crypto.randomUUID().

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Persönlichkeitsprofile sind derzeit nicht verfügbar.", 503);
    }
    await authenticateAdminRequest(request, supabase);

    // Parse the body
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      throw new UserVisibleError("Ungültiger Request-Body.", 400);
    }

    // Body validation — uses validatePostBody which enforces exact keys
    let validatedBody: { title: string; promptText: string };
    try {
      validatedBody = validatePostBody(rawBody);
    } catch {
      throw new UserVisibleError("Ungültiger Request-Body.", 400);
    }

    // Normalize title
    const title = normalizeTitle(validatedBody.title);
    if (title === null) {
      throw new UserVisibleError("Der Titel ist ungültig.", 400);
    }

    // Normalize prompt
    const promptText = normalizePromptText(validatedBody.promptText);
    if (promptText === null) {
      throw new UserVisibleError("Das Prompt-Textfeld ist ungültig.", 400);
    }

    // Server-generated UUID
    const id = generateProfileId();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("fred_personality_profiles")
      .insert({
        id,
        title,
        prompt_text: promptText,
        is_builtin: false,
        created_at: now,
        updated_at: now,
      })
      .select("id,title,prompt_text,is_builtin,created_at,updated_at")
      .single();

    if (error || !data) {
      throw new UserVisibleError(
        "Persönlichkeitsprofil konnte nicht erstellt werden.",
        503,
      );
    }

    return json({ personality: mapProfileRow(data as ProfileRow) });
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return json({ error: error.message }, error.status);
    }
    return json(
      { error: "Persönlichkeitsprofil konnte nicht erstellt werden." },
      503,
    );
  }
}

// ── PUT ────────────────────────────────────────────────────────────────────
// Admin-only. Update an existing profile from {id, title, promptText}.
// ID is immutable (identifies the row, not updated).

export async function PUT(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Persönlichkeitsprofile sind derzeit nicht verfügbar.", 503);
    }
    await authenticateAdminRequest(request, supabase);

    // Parse the body
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      throw new UserVisibleError("Ungültiger Request-Body.", 400);
    }

    // Body validation — uses validatePutBody which enforces exact keys
    let validatedBody: { id: string; title: string; promptText: string };
    try {
      validatedBody = validatePutBody(rawBody);
    } catch {
      throw new UserVisibleError("Ungültiger Request-Body.", 400);
    }

    // Normalize title
    const title = normalizeTitle(validatedBody.title);
    if (title === null) {
      throw new UserVisibleError("Der Titel ist ungültig.", 400);
    }

    // Normalize prompt
    const promptText = normalizePromptText(validatedBody.promptText);
    if (promptText === null) {
      throw new UserVisibleError("Das Prompt-Textfeld ist ungültig.", 400);
    }

    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("fred_personality_profiles")
      .update({
        title,
        prompt_text: promptText,
        updated_at: now,
      })
      .eq("id", validatedBody.id)
      .select("id,title,prompt_text,is_builtin,created_at,updated_at")
      .maybeSingle();

    if (error) {
      throw new UserVisibleError(
        "Persönlichkeitsprofil konnte nicht aktualisiert werden.",
        503,
      );
    }

    if (!data) {
      throw new UserVisibleError("Persönlichkeitsprofil nicht gefunden.", 404);
    }

    return json({ personality: mapProfileRow(data as ProfileRow) });
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return json({ error: error.message }, error.status);
    }
    return json(
      { error: "Persönlichkeitsprofil konnte nicht aktualisiert werden." },
      503,
    );
  }
}
