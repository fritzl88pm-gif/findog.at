import type { SupabaseClient } from "@supabase/supabase-js";

import { UserVisibleError } from "./errors";

type ServerSupabaseClient = Pick<SupabaseClient, "from">;

export type GlobalSystemPromptRecord = {
  systemPrompt: string;
  updatedAt: string;
  updatedBy: string | null;
};

function parseGlobalSystemPromptRecord(value: unknown): GlobalSystemPromptRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.system_prompt !== "string"
    || !row.system_prompt.trim()
    || typeof row.updated_at !== "string"
    || (row.updated_by !== null && typeof row.updated_by !== "string")
  ) {
    return null;
  }
  return {
    systemPrompt: row.system_prompt,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export async function getGlobalSystemPromptRecord(
  supabase: ServerSupabaseClient,
): Promise<GlobalSystemPromptRecord> {
  const { data, error } = await supabase
    .from("global_settings")
    .select("system_prompt,updated_at,updated_by")
    .eq("id", true)
    .maybeSingle();

  const record = parseGlobalSystemPromptRecord(data);
  if (error || !record) {
    throw new UserVisibleError(
      "Der globale Systemprompt ist derzeit nicht verfügbar. Bitte die Administration prüfen.",
      503,
    );
  }
  return record;
}

export async function getGlobalSystemPrompt(
  supabase: ServerSupabaseClient,
): Promise<string> {
  return (await getGlobalSystemPromptRecord(supabase)).systemPrompt;
}

export async function updateGlobalSystemPrompt(
  supabase: ServerSupabaseClient,
  userId: string,
  value: unknown,
): Promise<GlobalSystemPromptRecord> {
  if (typeof value !== "string" || !value.trim()) {
    throw new UserVisibleError("Der globale Systemprompt darf nicht leer sein.", 400);
  }

  const updatedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("global_settings")
    .upsert({
      id: true,
      system_prompt: value,
      updated_at: updatedAt,
      updated_by: userId,
    }, { onConflict: "id" })
    .select("system_prompt,updated_at,updated_by")
    .maybeSingle();

  const record = parseGlobalSystemPromptRecord(data);
  if (error || !record) {
    throw new UserVisibleError("Der globale Systemprompt konnte nicht gespeichert werden.", 503);
  }
  return record;
}
