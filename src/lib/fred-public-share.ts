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
    .select("question_content,answer_content")
    .eq("id", shareId)
    .maybeSingle();

  if (error || !data) {
    throw new UserVisibleError(
      "Diese geteilte Fred-Antwort ist nicht mehr verfügbar.",
      404,
    );
  }

  const row = data as FredPublicShareRow;
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

  return row;
}
