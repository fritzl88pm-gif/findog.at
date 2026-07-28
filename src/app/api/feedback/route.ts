import { NextResponse } from "next/server";

import { MAX_AGENT_FEEDBACK_CHARS } from "@/lib/agent-feedback";
import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { MAX_REQUEST_BYTES } from "@/lib/config";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_MESSAGE_CHARS = 100_000;

type FeedbackBody = {
  conversationId: string;
  userRequest: string;
  assistantResponse: string;
  feedback: string;
};

function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

async function readBoundedJsonBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    throw new UserVisibleError("Die Feedback-Anfrage ist zu groß.", 413);
  }
  if (!request.body) {
    throw new UserVisibleError("Die Feedback-Anfrage ist leer.", 400);
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteLength = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new UserVisibleError("Die Feedback-Anfrage ist zu groß.", 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof UserVisibleError) throw error;
    throw new UserVisibleError("Die Feedback-Anfrage enthält kein gültiges UTF-8.", 400);
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new UserVisibleError("Die Feedback-Anfrage enthält kein gültiges JSON.", 400);
  }
}

function parseFeedbackBody(value: unknown): FeedbackBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UserVisibleError("Die Feedback-Angaben sind ungültig.", 400);
  }
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body).sort();
  if (
    keys.length !== 4
    || keys[0] !== "assistantResponse"
    || keys[1] !== "conversationId"
    || keys[2] !== "feedback"
    || keys[3] !== "userRequest"
    || typeof body.conversationId !== "string"
    || typeof body.userRequest !== "string"
    || typeof body.assistantResponse !== "string"
    || typeof body.feedback !== "string"
  ) {
    throw new UserVisibleError("Die Feedback-Angaben enthalten ungültige Felder.", 400);
  }

  const conversationId = body.conversationId.trim();
  const userRequest = body.userRequest.trim();
  const assistantResponse = body.assistantResponse.trim();
  const feedback = body.feedback.trim();
  if (!UUID_PATTERN.test(conversationId)) {
    throw new UserVisibleError("Die Gespräch-ID ist ungültig.", 400);
  }
  if (!userRequest || !assistantResponse) {
    throw new UserVisibleError("Frage und Antwort dürfen nicht leer sein.", 400);
  }
  if (!feedback) {
    throw new UserVisibleError("Bitte beschreibe, warum die Antwort nicht korrekt ist.", 400);
  }
  if (
    userRequest.length > MAX_MESSAGE_CHARS
    || assistantResponse.length > MAX_MESSAGE_CHARS
    || feedback.length > MAX_AGENT_FEEDBACK_CHARS
  ) {
    throw new UserVisibleError("Eine oder mehrere Feedback-Angaben sind zu lang.", 400);
  }
  return { conversationId, userRequest, assistantResponse, feedback };
}

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Feedback kann derzeit nicht gespeichert werden.", 503);
    }
    const user = await authenticateSupabaseRequest(request, supabase);
    const body = parseFeedbackBody(await readBoundedJsonBody(request));

    const { data: conversation, error: conversationError } = await supabase
      .from("fred_conversations")
      .select("id")
      .eq("id", body.conversationId)
      .eq("client_id", user.id)
      .maybeSingle();
    if (conversationError) {
      throw new UserVisibleError("Die Fred-Unterhaltung konnte nicht geprüft werden.", 503);
    }
    if (!conversation) {
      throw new UserVisibleError("Die Fred-Unterhaltung wurde nicht gefunden.", 404);
    }

    const { error } = await supabase.from("agent_feedback").insert({
      user_id: user.id,
      conversation_id: body.conversationId,
      user_request: body.userRequest,
      assistant_response: body.assistantResponse,
      user_feedback: body.feedback,
    });
    if (error) {
      throw new UserVisibleError("Feedback konnte nicht gespeichert werden.", 503);
    }
    return json({ message: "Danke für deine Rückmeldung." }, 201);
  } catch (error) {
    if (error instanceof UserVisibleError) return json({ error: error.message }, error.status);
    return json({ error: "Feedback konnte nicht gespeichert werden." }, 500);
  }
}
