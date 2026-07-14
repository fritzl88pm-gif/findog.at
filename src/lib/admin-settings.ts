import type { SupabaseClient } from "@supabase/supabase-js";

import { DEFAULT_SYSTEM_PROMPT } from "./config";
import { UserVisibleError } from "./errors";

type ServerSupabaseClient = Pick<SupabaseClient, "from">;

const LEGACY_SYSTEM_PROMPT_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  [
    "Eine Live- oder Websuche steht auf findog.at nicht zur Verfügung – auch nicht auf ausdrücklichen Wunsch des Nutzers.",
    "",
  ],
  [
    "Eine Websuche/Live-Recherche steht auf findog.at nicht zur Verfügung – auch nicht auf ausdrücklichen Wunsch des Nutzers.",
    "",
  ],
  [
    "es darf keine externe Recherche angekündigt und keine VwGH-Entscheidung oder kein Rechtssatz behauptet werden.",
    "es darf keine VwGH-Entscheidung und kein Rechtssatz behauptet werden.",
  ],
];

export function sanitizeGlobalSystemPrompt(value: string): string {
  const sanitized = LEGACY_SYSTEM_PROMPT_REPLACEMENTS.reduce(
    (prompt, [obsoleteText, replacement]) => prompt.replaceAll(obsoleteText, replacement),
    value,
  );

  return sanitized
    .replace(/^-[ \t]{2,}/gm, "- ")
    .replace(/[ \t]+(?=\r?$)/gm, "")
    .trim();
}

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

  const prompt = typeof data?.system_prompt === "string"
    ? sanitizeGlobalSystemPrompt(data.system_prompt)
    : "";
  return prompt || DEFAULT_SYSTEM_PROMPT;
}

export async function updateGlobalSystemPrompt(
  supabase: ServerSupabaseClient,
  userId: string,
  value: unknown,
): Promise<string> {
  if (typeof value !== "string") {
    throw new UserVisibleError("Der globale System Prompt darf nicht leer sein.", 400);
  }

  const systemPrompt = sanitizeGlobalSystemPrompt(value);
  if (!systemPrompt) {
    throw new UserVisibleError("Der globale System Prompt darf nicht leer sein.", 400);
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

  return sanitizeGlobalSystemPrompt(data.system_prompt);
}
