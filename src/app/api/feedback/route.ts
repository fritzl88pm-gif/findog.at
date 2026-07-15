import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { MAX_REQUEST_BYTES } from "@/lib/config";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_CONVERSATION_ID_LENGTH = 64;
const MAX_USER_REQUEST_LENGTH = 100_000;
const MAX_ASSISTANT_RESPONSE_LENGTH = 100_000;
const MAX_FEEDBACK_LENGTH = 10_000;

type FeedbackBody = {
  conversationId: string;
  userRequest: string;
  assistantResponse: string;
  feedback: string;
};

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 0) return new Uint8Array(0);
  if (chunks.length === 1) return chunks[0];
  const totalLength = chunks.reduce((a, c) => a + c.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function readBoundedJsonBody(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const length = Number(contentLength);
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new UserVisibleError("Anfrage header ungültig.", 400);
    }
    if (length > MAX_REQUEST_BYTES) {
      throw new UserVisibleError("Die Anfrage ist zu groß.", 413);
    }
  }

  const reader = request.body?.getReader();
  if (!reader) {
    throw new UserVisibleError("Die Anfrage enthält keinen Body.", 400);
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new UserVisibleError("Die Anfrage ist zu groß.", 413);
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let jsonStr: string;
  try {
    jsonStr = decoder.decode(concatUint8Arrays(chunks));
  } catch {
    throw new UserVisibleError("Die Anfrage enthält kein gültiges UTF-8.", 400);
  }

  try {
    return JSON.parse(jsonStr);
  } catch {
    throw new UserVisibleError("Die Anfrage enthält kein gültiges JSON.", 400);
  }
}

async function parseFeedbackBody(request: Request): Promise<FeedbackBody> {
  const body = await readBoundedJsonBody(request);

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new UserVisibleError("Die Anfrage ist ungültig.", 400);
  }

  const data = body as Record<string, unknown>;

  if (typeof data.conversationId !== "string" || !uuidPattern.test(data.conversationId.trim())) {
    throw new UserVisibleError("Die Gespräch-ID ist ungültig.", 400);
  }

  if (typeof data.userRequest !== "string" || !data.userRequest.trim()) {
    throw new UserVisibleError("Die Benutzeranfrage darf nicht leer sein.", 400);
  }

  if (typeof data.assistantResponse !== "string" || !data.assistantResponse.trim()) {
    throw new UserVisibleError("Die Antwort darf nicht leer sein.", 400);
  }

  if (typeof data.feedback !== "string" || !data.feedback.trim()) {
    throw new UserVisibleError("Bitte gib dein Feedback ein.", 400);
  }

  if (
    data.conversationId.length > MAX_CONVERSATION_ID_LENGTH ||
    data.userRequest.length > MAX_USER_REQUEST_LENGTH ||
    data.assistantResponse.length > MAX_ASSISTANT_RESPONSE_LENGTH ||
    data.feedback.length > MAX_FEEDBACK_LENGTH
  ) {
    throw new UserVisibleError("Eine oder mehrere Angaben sind zu lang.", 400);
  }

  return {
    conversationId: data.conversationId.trim(),
    userRequest: data.userRequest.trim(),
    assistantResponse: data.assistantResponse.trim(),
    feedback: data.feedback.trim(),
  };
}

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Feedback kann derzeit nicht gespeichert werden.", 503);
    }

    const { conversationId, userRequest, assistantResponse, feedback } =
      await parseFeedbackBody(request);

    const user = await authenticateSupabaseRequest(request, supabase);

    const { error } = await supabase.from("agent_feedback").insert({
      user_id: user.id,
      conversation_id: conversationId,
      user_request: userRequest,
      assistant_response: assistantResponse,
      user_feedback: feedback,
    });

    if (error) {
      throw new UserVisibleError(
        "Feedback konnte nicht gespeichert werden. Bitte versuche es später erneut.",
        503,
      );
    }

    return NextResponse.json({ message: "Danke für dein Feedback" });
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "Feedback konnte nicht gespeichert werden." },
      { status: 500 },
    );
  }
}
