import type { SupabaseClient } from "@supabase/supabase-js";

import { UserVisibleError } from "./errors";

type ServerSupabaseClient = Pick<SupabaseClient, "from">;

export async function recordAdminRequest(options: {
  supabase: ServerSupabaseClient;
  userId: string;
  conversationId: string;
  content: string;
}): Promise<void> {
  const { error } = await options.supabase.from("admin_request_history").insert({
    user_id: options.userId,
    conversation_id: options.conversationId,
    content: options.content,
  });

  if (error) {
    throw new UserVisibleError(
      "Die Anfrage konnte nicht sicher protokolliert werden. Bitte erneut versuchen.",
      503,
    );
  }
}
