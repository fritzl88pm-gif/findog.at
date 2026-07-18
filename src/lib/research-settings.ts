import type { SupabaseClient } from "@supabase/supabase-js";

import { UserVisibleError } from "./errors";

type ServerSupabaseClient = Pick<SupabaseClient, "from">;

/** Default number of results per non-law research source. */
export const DEFAULT_RESEARCH_RESULT_LIMIT = 8;
export const MIN_RESEARCH_RESULT_LIMIT = 1;
export const MAX_RESEARCH_RESULT_LIMIT = 50;

/** Coerce and range-check a candidate limit; returns null when invalid. */
export function parseResearchResultLimit(value: unknown): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (
    !Number.isInteger(numeric)
    || numeric < MIN_RESEARCH_RESULT_LIMIT
    || numeric > MAX_RESEARCH_RESULT_LIMIT
  ) {
    return null;
  }
  return numeric;
}

/**
 * Reads the centrally configured research result limit.  Unlike the global
 * system prompt this never throws: retrieval must not fail because the
 * setting row or column is missing, so any error falls back to the default.
 */
export async function getResearchResultLimit(
  supabase: ServerSupabaseClient,
): Promise<number> {
  try {
    const { data, error } = await supabase
      .from("global_settings")
      .select("research_result_limit")
      .eq("id", true)
      .maybeSingle();
    if (error || !data) {
      return DEFAULT_RESEARCH_RESULT_LIMIT;
    }
    const parsed = parseResearchResultLimit(
      (data as Record<string, unknown>).research_result_limit,
    );
    return parsed ?? DEFAULT_RESEARCH_RESULT_LIMIT;
  } catch {
    return DEFAULT_RESEARCH_RESULT_LIMIT;
  }
}

/**
 * Persists a new research result limit on the single-row global_settings
 * table.  Uses UPDATE (not UPSERT) so the NOT NULL system_prompt column is
 * never touched; the settings row is expected to already exist.
 */
export async function updateResearchResultLimit(
  supabase: ServerSupabaseClient,
  userId: string,
  value: unknown,
): Promise<number> {
  const parsed = parseResearchResultLimit(value);
  if (parsed === null) {
    throw new UserVisibleError(
      `Das Rechercheergebnis-Limit muss eine ganze Zahl zwischen ${MIN_RESEARCH_RESULT_LIMIT} und ${MAX_RESEARCH_RESULT_LIMIT} sein.`,
      400,
    );
  }

  const { data, error } = await supabase
    .from("global_settings")
    .update({
      research_result_limit: parsed,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq("id", true)
    .select("research_result_limit")
    .maybeSingle();
  if (error || !data) {
    throw new UserVisibleError(
      "Das Rechercheergebnis-Limit konnte nicht gespeichert werden.",
      503,
    );
  }

  return (
    parseResearchResultLimit((data as Record<string, unknown>).research_result_limit)
    ?? parsed
  );
}
