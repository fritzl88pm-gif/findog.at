import "server-only";

import { UserVisibleError } from "./errors";
import { getSupabaseServerClient } from "./supabase/server";

export const FRED_PUBLIC_SHARE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const FRED_PUBLIC_SHARE_PATH_PREFIX = "/fred/share/";

export type FredPublicShareRow = {
  question_content: string;
  answer_content: string;
};

export function validateShareId(shareId: string): asserts shareId is string {
  if (!FRED_PUBLIC_SHARE_UUID_PATTERN.test(shareId)) {
    throw new UserVisibleError("Die geteilte Fred-Antwort wurde nicht gefunden.", 404);
  }
}

export async function createFredPublicShare(options: {
  clientId: string;
  conversationId: string;
  assistantMessageId: number;
}): Promise<{ shareId: string; sharePath: string }> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    throw new UserVisibleError("Fred ist derzeit nicht verfügbar.", 503);
  }

  const { data, error } = await supabase.rpc("create_fred_public_answer_share", {
    payload: {
      client_id: options.clientId,
      conversation_id: options.conversationId,
      assistant_message_id: options.assistantMessageId,
    },
  });

  if (error) {
    // Map known RPC error codes before falling back to message inspection.
    const code = (error as unknown as Record<string, unknown>)?.code;
    if (code === "P0002") {
      throw new UserVisibleError(
        "Diese Fred-Antwort kann nicht geteilt werden.",
        404,
      );
    }
    if (code === "22023") {
      throw new UserVisibleError(
        "Diese Fred-Antwort kann nicht geteilt werden.",
        400,
      );
    }
    // Fallback message inspection (kept for forward compatibility).
    if (error.message?.includes("conversation not found")
      || error.message?.includes("assistant message not found")
      || error.message?.includes("not an assistant message")
      || error.message?.includes("missing preceding question")) {
      throw new UserVisibleError(
        "Diese Fred-Antwort kann nicht geteilt werden.",
        404,
      );
    }
    if (error.message?.includes("fields are invalid")
      || error.message?.includes("content out of bounds")) {
      throw new UserVisibleError(
        "Diese Fred-Antwort kann nicht geteilt werden.",
        400,
      );
    }
    throw new UserVisibleError("Das Teilen der Fred-Antwort ist fehlgeschlagen.", 503);
  }

  const shareId = (data as Record<string, unknown>)?.share_id;
  if (typeof shareId !== "string" || !FRED_PUBLIC_SHARE_UUID_PATTERN.test(shareId)) {
    throw new UserVisibleError("Das Teilen der Fred-Antwort ist fehlgeschlagen.", 503);
  }

  return {
    shareId,
    sharePath: `${FRED_PUBLIC_SHARE_PATH_PREFIX}${shareId}`,
  };
}

export async function loadFredPublicShare(shareId: string): Promise<FredPublicShareRow> {
  validateShareId(shareId);

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    throw new UserVisibleError("Die geteilte Fred-Antwort wurde nicht gefunden.", 404);
  }

  const { data, error } = await supabase
    .from("fred_public_answer_shares")
    .select("question_content,answer_content,question_message_id,assistant_message_id")
    .eq("id", shareId)
    .maybeSingle();

  if (error || !data) {
    throw new UserVisibleError(
      "Diese geteilte Fred-Antwort ist nicht mehr verfügbar.",
      404,
    );
  }

  const row = data as FredPublicShareRow & {
    question_message_id: unknown;
    assistant_message_id: unknown;
  };
  if (
    typeof row.question_content !== "string"
    || typeof row.answer_content !== "string"
    || !row.question_content.trim()
    || !row.answer_content.trim()
  ) {
    throw new UserVisibleError(
      "Diese geteilte Fred-Antwort ist nicht mehr verfügbar.",
      404,
    );
  }

  // An answer the owner regenerated is superseded together with its question
  // and is no longer part of the visible transcript, so it is not shown here.
  const { data: supersededMessages, error: supersededError } = await supabase
    .from("fred_messages")
    .select("id")
    .in("id", [row.question_message_id, row.assistant_message_id])
    .not("superseded_at", "is", null)
    .limit(1);
  if (supersededError || !Array.isArray(supersededMessages) || supersededMessages.length > 0) {
    throw new UserVisibleError(
      "Diese geteilte Fred-Antwort ist nicht mehr verfügbar.",
      404,
    );
  }

  return {
    question_content: row.question_content,
    answer_content: row.answer_content,
  };
}
