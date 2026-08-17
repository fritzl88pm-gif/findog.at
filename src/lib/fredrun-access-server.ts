import type { SupabaseClient } from "@supabase/supabase-js";

import { UserVisibleError } from "@/lib/errors";
import { normalizeFredRunAccessMessage } from "@/lib/fredrun-access";

export class FredRunAccessBlockedServerError extends UserVisibleError {
  constructor(message: string) {
    super(message, 403);
    this.name = "FredRunAccessBlockedServerError";
  }
}

export async function assertFredRunAccessAllowed(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("fredrun_user_blocks")
    .select("message")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new UserVisibleError("Dein FredRun-Zugriff konnte nicht geprüft werden.", 503);
  }
  if (!data) return;

  const message = normalizeFredRunAccessMessage((data as { message?: unknown }).message);
  if (!message) {
    throw new UserVisibleError("Dein FredRun-Zugriff konnte nicht geprüft werden.", 503);
  }
  throw new FredRunAccessBlockedServerError(message);
}
