import { getSupabaseServerClient } from "./supabase/server";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PersistenceSupabaseClient = {
  from: {
    (table: "conversations"): {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          maybeSingle: () => Promise<{
            data: { client_id: string | null } | null;
            error: unknown;
          }>;
        };
      };
      upsert: (
        value: { id: string; client_id: string; title: string; updated_at: string },
        options: { onConflict: string },
      ) => Promise<{ error: unknown }>;
    };
    (table: "messages"): {
      insert: (
        values: Array<{
          conversation_id: string;
          client_id: string;
          role: "user" | "assistant";
          content: string;
        }>,
      ) => Promise<{ error: unknown }>;
    };
  };
};

function isUuid(value: string): boolean {
  return uuidPattern.test(value);
}

export function isConversationOwnedByClient(existingClientId: string | null | undefined, clientId: string): boolean {
  return !existingClientId || existingClientId === clientId;
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

  const persistenceClient = supabase as unknown as PersistenceSupabaseClient;
  const { data: existingConversation, error: lookupError } = await persistenceClient
    .from("conversations")
    .select("client_id")
    .eq("id", options.conversationId)
    .maybeSingle();

  if (lookupError) {
    console.error("Supabase conversation ownership check failed");
    return;
  }

  if (!isConversationOwnedByClient(existingConversation?.client_id, options.clientId)) {
    console.error("Supabase conversation ownership mismatch");
    return;
  }

  const now = new Date().toISOString();
  const title = options.userMessage.trim().slice(0, 90) || "Neues Gespräch";

  const { error: conversationError } = await persistenceClient.from("conversations").upsert(
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

  const { error: messageError } = await persistenceClient.from("messages").insert([
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
