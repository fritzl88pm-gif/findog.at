import type { SupabaseClient } from "@supabase/supabase-js";

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
