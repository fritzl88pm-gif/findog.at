import type { SupabaseClient } from "@supabase/supabase-js";

import { DEFAULT_SYSTEM_PROMPT, MAX_SYSTEM_PROMPT_CHARS } from "./config";
import { UserVisibleError } from "./errors";

type ServerSupabaseClient = Pick<SupabaseClient, "from">;

export async function isAdminUser(
  supabase: ServerSupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new UserVisibleError("Administrationsberechtigung konnte nicht geprüft werden.", 503);
  }

  return Boolean(data?.user_id);
}

export async function getGlobalSystemPrompt(
  supabase: ServerSupabaseClient,
): Promise<string> {
  const { data, error } = await supabase
    .from("global_settings")
    .select("system_prompt")
    .eq("id", true)
    .maybeSingle();

  if (error) {
    throw new UserVisibleError("Globale Einstellungen konnten nicht geladen werden.", 503);
  }

  const prompt = typeof data?.system_prompt === "string" ? data.system_prompt.trim() : "";
  return prompt || DEFAULT_SYSTEM_PROMPT;
}

export async function updateGlobalSystemPrompt(
  supabase: ServerSupabaseClient,
  userId: string,
  value: unknown,
): Promise<string> {
  if (typeof value !== "string" || !value.trim()) {
    throw new UserVisibleError("Der globale System Prompt darf nicht leer sein.", 400);
  }

  const systemPrompt = value.trim();
  if (systemPrompt.length > MAX_SYSTEM_PROMPT_CHARS) {
    throw new UserVisibleError("Der globale System Prompt ist zu lang.", 400);
  }

  const { data, error } = await supabase
    .from("global_settings")
    .upsert({
      id: true,
      system_prompt: systemPrompt,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    }, { onConflict: "id" })
    .select("system_prompt")
    .maybeSingle();

  if (error || typeof data?.system_prompt !== "string") {
    throw new UserVisibleError("Globale Einstellungen konnten nicht gespeichert werden.", 503);
  }

  return data.system_prompt;
}
