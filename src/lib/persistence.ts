import { getSupabaseServerClient } from "./supabase/server";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return uuidPattern.test(value);
}

export async function persistConversationTurn(options: {
  conversationId?: string;
  clientId?: string;
  userMessage?: string;
  assistantMessage: string;
}): Promise<void> {
  const supabase = getSupabaseServerClient();
  if (!supabase || !options.conversationId || !options.clientId || !options.userMessage) {
    return;
  }
  if (!isUuid(options.conversationId) || !isUuid(options.clientId)) {
    return;
  }

  const now = new Date().toISOString();
  const title = options.userMessage.trim().slice(0, 90) || "Neues Gespräch";

  const { error: conversationError } = await supabase.from("conversations").upsert(
    {
      id: options.conversationId,
      client_id: options.clientId,
      title,
      updated_at: now,
    },
    {
      onConflict: "id",
    },
  );

  if (conversationError) {
    console.error("Supabase conversation persistence failed");
    return;
  }

  const { error: messageError } = await supabase.from("messages").insert([
    {
      conversation_id: options.conversationId,
      client_id: options.clientId,
      role: "user",
      content: options.userMessage,
    },
    {
      conversation_id: options.conversationId,
      client_id: options.clientId,
      role: "assistant",
      content: options.assistantMessage,
    },
  ]);

  if (messageError) {
    console.error("Supabase message persistence failed");
  }
}
