import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// ── Helpers ──────────────────────────────────────────────────────────────

const MAX_NAME_CODEPOINTS = 80;
const NAME_VALID_RE = /^[\p{L}\p{M}\p{Zs}'.\-]*$/u;
const NAME_INVALID_RE = /[\r\n\u0000-\u001F\u007F-\u009F<>]/u;

function codePointLength(s: string): number {
  return [...s].length;
}

function normalizeName(raw: unknown): { value: string; codePoints: number } | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (NAME_INVALID_RE.test(trimmed)) return null;
  if (!NAME_VALID_RE.test(trimmed)) return null;
  const collapsed = trimmed.replace(/\s+/gu, " ");
  return { value: collapsed, codePoints: codePointLength(collapsed) };
}

function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Vary: "Authorization",
    },
  });
}

type PersonalityOption = { id: string; title: string };

async function loadPersonalityOptions(
  supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
): Promise<PersonalityOption[]> {
  const { data, error } = await supabase
    .from("fred_personality_profiles")
    .select("id,title")
    .order("is_builtin", { ascending: false })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error || !data) {
    throw new UserVisibleError(
      "Persönliche Fred-Einstellungen sind derzeit nicht verfügbar.",
      503,
    );
  }

  return (data as { id: string; title: string }[]).map((row) => ({
    id: row.id,
    title: row.title,
  }));
}

async function verifyPersonalityExists(
  supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  personalityId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("fred_personality_profiles")
    .select("id")
    .eq("id", personalityId)
    .maybeSingle();

  if (error) {
    throw new UserVisibleError(
      "Persönliche Fred-Einstellungen sind derzeit nicht verfügbar.",
      503,
    );
  }

  return data !== null;
}

// ── GET ──────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError(
        "Persönliche Fred-Einstellungen sind derzeit nicht verfügbar.",
        503,
      );
    }
    const user = await authenticateSupabaseRequest(request, supabase);

    const [{ data: prefData, error: prefError }, personalities] = await Promise.all([
      supabase
        .from("fred_user_preferences")
        .select("preferred_name,personality")
        .eq("user_id", user.id)
        .maybeSingle(),
      loadPersonalityOptions(supabase),
    ]);

    if (prefError) {
      throw new UserVisibleError(
        "Persönliche Fred-Einstellungen sind derzeit nicht verfügbar.",
        503,
      );
    }

    return json({
      preferredName: prefData?.preferred_name ?? "",
      personality: prefData?.personality ?? "standard",
      personalities,
    });
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return json({ error: error.message }, error.status);
    }
    return json(
      { error: "Persönliche Fred-Einstellungen sind derzeit nicht verfügbar." },
      503,
    );
  }
}

// ── PUT ──────────────────────────────────────────────────────────────────

const EXPECTED_PUT_KEYS = new Set(["preferredName", "personality"]);

export async function PUT(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError(
        "Persönliche Fred-Einstellungen sind derzeit nicht verfügbar.",
        503,
      );
    }
    const user = await authenticateSupabaseRequest(request, supabase);

    // Parse and validate body.
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

    // Strict: exactly the two expected keys, no missing, no extras.
    const receivedKeys = Object.keys(record);
    if (receivedKeys.length !== EXPECTED_PUT_KEYS.size) {
      throw new UserVisibleError("Ungültiger Request-Body.", 400);
    }
    for (const key of receivedKeys) {
      if (!EXPECTED_PUT_KEYS.has(key)) {
        throw new UserVisibleError("Ungültiger Request-Body.", 400);
      }
    }

    // Validate preferredName
    const rawName: unknown = record.preferredName;
    if (typeof rawName !== "string") {
      throw new UserVisibleError("Der Anzeigename ist ungültig.", 400);
    }
    const normalized = normalizeName(rawName);
    let storageName: string | null = null;
    let responseName = "";
    if (normalized === null) {
      if (rawName.trim().length === 0) {
        storageName = null;
        responseName = "";
      } else {
        const trimmed = rawName.trim();
        if (NAME_INVALID_RE.test(trimmed) || !NAME_VALID_RE.test(trimmed)) {
          throw new UserVisibleError("Der Anzeigename enthält ungültige Zeichen.", 400);
        }
        throw new UserVisibleError("Der Anzeigename ist ungültig.", 400);
      }
    } else if (normalized.codePoints > MAX_NAME_CODEPOINTS) {
      throw new UserVisibleError("Der Anzeigename ist zu lang.", 400);
    } else {
      storageName = normalized.value;
      responseName = normalized.value;
    }

    // Validate personality — must be a string
    const rawPersonality: unknown = record.personality;
    if (typeof rawPersonality !== "string") {
      throw new UserVisibleError("Ungültige Persönlichkeit.", 400);
    }
    const personality = rawPersonality;

    // Verify the requested profile exists AND load the option list
    const [exists, personalities] = await Promise.all([
      verifyPersonalityExists(supabase, personality),
      loadPersonalityOptions(supabase),
    ]);

    if (!exists) {
      throw new UserVisibleError("Ungültige Persönlichkeit.", 400);
    }

    const { error } = await supabase
      .from("fred_user_preferences")
      .upsert(
        {
          user_id: user.id,
          preferred_name: storageName,
          personality,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );

    if (error) {
      throw new UserVisibleError(
        "Persönliche Fred-Einstellungen konnten nicht gespeichert werden.",
        503,
      );
    }

    return json({
      preferredName: responseName,
      personality,
      personalities,
    });
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return json({ error: error.message }, error.status);
    }
    return json(
      { error: "Persönliche Fred-Einstellungen konnten nicht gespeichert werden." },
      503,
    );
  }
}
