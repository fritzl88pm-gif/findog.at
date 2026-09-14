import "server-only";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { runWithTimeout } from "@/lib/deadline";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_BYTES = 50 * 1024 * 1024;
type ValidArtifact = {
  upstreamMessageId: string;
  upstreamIndex: number;
  fileName: string;
  fileType: string;
  sourceUri: string;
};

function errorResponse(error: unknown): Response {
  const visible = error instanceof UserVisibleError ? error : new UserVisibleError("Datei konnte nicht geladen werden.", 500);
  return Response.json({ error: visible.message }, { status: visible.status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request, context: { params: Promise<{ conversationId: string; messageId: string; artifactIndex: string }> }) {
  try {
    if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") throw new UserVisibleError("Diese Anfrage ist nicht erlaubt.", 403);
    const { conversationId, messageId, artifactIndex } = await context.params;
    const messageNumber = Number(messageId);
    const index = Number(artifactIndex);
    if (!UUID.test(conversationId) || !Number.isSafeInteger(messageNumber) || messageNumber <= 0
      || !Number.isSafeInteger(index) || index < 0 || index > 99) throw new UserVisibleError("Datei ist ungültig.", 400);
    const supabase = getSupabaseServerClient();
    if (!supabase) throw new UserVisibleError("Der Dienst ist derzeit nicht verfügbar.", 503);
    const user = await authenticateSupabaseRequest(request, supabase);
    const { data: conversation, error: conversationError } = await supabase.from("fred_conversations")
      .select("id,weknora_session_id,client_id").eq("id", conversationId).eq("client_id", user.id).maybeSingle();
    if (conversationError) throw new UserVisibleError("Datei konnte nicht geladen werden.", 503);
    if (!conversation || typeof conversation.weknora_session_id !== "string" || !/^[-A-Za-z0-9_]{1,128}$/u.test(conversation.weknora_session_id)) throw new UserVisibleError("Datei nicht gefunden.", 404);
    const { data: message, error } = await supabase.from("fred_messages")
      .select("artifacts,conversation_id,client_id")
      .eq("id", messageNumber).eq("conversation_id", conversationId).eq("client_id", user.id).maybeSingle();
    if (error) throw new UserVisibleError("Datei konnte nicht geladen werden.", 503);
    if (!message || !Array.isArray(message.artifacts)) throw new UserVisibleError("Datei nicht gefunden.", 404);
    const validArtifacts: ValidArtifact[] = message.artifacts.flatMap((candidate): ValidArtifact[] => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
      const artifact = candidate as Record<string, unknown>;
      const upstreamIndex = Number(artifact.upstreamIndex);
      if (typeof artifact.upstreamMessageId !== "string" || !/^[-A-Za-z0-9_]{1,128}$/u.test(artifact.upstreamMessageId)
        || !Number.isSafeInteger(upstreamIndex) || upstreamIndex < 0 || upstreamIndex > 99
        || typeof artifact.fileName !== "string" || !artifact.fileName || artifact.fileName.length > 255
        || typeof artifact.fileType !== "string" || !/^\.(?:txt|md|pdf)$/u.test(artifact.fileType)
        || typeof artifact.sourceUri !== "string" || !/^resource:\/\/[^\u0000-\u001f\u007f]+$/u.test(artifact.sourceUri)) return [];
      return [{
        upstreamMessageId: artifact.upstreamMessageId,
        upstreamIndex,
        fileName: artifact.fileName,
        fileType: artifact.fileType,
        sourceUri: artifact.sourceUri,
      }];
    });
    const indexCounts = new Map<number, number>();
    for (const artifact of validArtifacts) indexCounts.set(artifact.upstreamIndex, (indexCounts.get(artifact.upstreamIndex) ?? 0) + 1);
    const artifact = validArtifacts.find((candidate) => candidate.upstreamIndex === index);
    if (!artifact || indexCounts.get(index) !== 1) {
      throw new UserVisibleError("Datei nicht gefunden.", 404);
    }
    const apiKey = process.env.WEKNORA_API_KEY?.trim();
    if (!apiKey) throw new UserVisibleError("Dateienabruf ist derzeit nicht konfiguriert.", 503);
    const upstream = new URL(`https://taxdog.cloud/api/v1/sessions/${encodeURIComponent(conversation.weknora_session_id)}/messages/${encodeURIComponent(artifact.upstreamMessageId)}/artifacts/${artifact.upstreamIndex}/download`);
    const { bytes } = await runWithTimeout(async (signal) => {
      const response = await fetch(upstream, {
        headers: { "X-API-Key": apiKey, Accept: "application/octet-stream" }, cache: "no-store", redirect: "error", signal,
      });
      if (!response.ok) throw new UserVisibleError(response.status === 404 ? "Datei nicht gefunden." : "Dateienabruf fehlgeschlagen.", response.status === 404 ? 404 : 502);
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > MAX_BYTES) throw new UserVisibleError("Die Datei ist zu groß.", 413);
      if (!response.body) throw new UserVisibleError("Ungültige Dateiantwort.", 502);
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          total += part.value.byteLength;
          if (total > MAX_BYTES) throw new UserVisibleError("Die Datei ist zu groß.", 413);
          chunks.push(part.value);
        }
      } catch (error) {
        await reader.cancel(signal.reason ?? error).catch(() => undefined);
        throw error;
      } finally {
        if (signal.aborted) await reader.cancel(signal.reason).catch(() => undefined);
      }
      const bytes = new Uint8Array(total); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return { bytes };
    }, { timeoutMs: 20_000, timeoutMessage: "Dateienabruf hat zu lange gedauert.", signal: request.signal });
    const safeName = artifact.fileName.replace(/[\\/\r\n"\u0000-\u001f\u007f]/gu, "_").slice(0, 255) || "datei";
    const encoded = encodeURIComponent(safeName).replace(/['()]/gu, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    return new Response(bytes, { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(bytes.byteLength), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": `attachment; filename="download"; filename*=UTF-8''${encoded}` } });
  } catch (error) { return errorResponse(error); }
}
