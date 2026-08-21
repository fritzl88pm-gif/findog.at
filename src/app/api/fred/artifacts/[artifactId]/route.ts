import "server-only";

import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import {
  hasExpectedSignature,
  sanitizedFilename,
} from "@/lib/attachments/validation";
import { runWithTimeout } from "@/lib/deadline";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAllowedProviderImageUri } from "@/lib/weknora/fred-native";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_IMAGE_FETCH_BYTES = 10 * 1024 * 1024; // 10 MiB
const UPSTREAM_FETCH_TIMEOUT_MS = 20_000;
const ALLOWED_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

function requireSameSiteRequest(request: Request): void {
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    throw new UserVisibleError("Diese Anfrage ist nicht erlaubt.", 403);
  }
}

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    },
  );
}

export async function GET(
  request: Request,
  routeContext: { params: Promise<{ artifactId: string }> },
) {
  try {
    const { artifactId } = await routeContext.params;
    if (!UUID_PATTERN.test(artifactId)) {
      throw new UserVisibleError("Bild-ID ist ungültig.", 400);
    }

    requireSameSiteRequest(request);

    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Der Dienst ist derzeit nicht verfügbar.", 503);
    }

    const user = await authenticateSupabaseRequest(request, supabase);

    const { data: artifact, error: dbError } = await supabase
      .from("fred_native_image_artifacts")
      .select("id, client_id, source_uri, mime_type, original_name")
      .eq("id", artifactId)
      .eq("client_id", user.id)
      .maybeSingle();

    if (dbError) {
      throw new UserVisibleError("Bild konnte nicht geladen werden.", 503);
    }
    if (!artifact) {
      throw new UserVisibleError("Bild nicht gefunden.", 404);
    }

    const sourceUri = typeof artifact.source_uri === "string" ? artifact.source_uri.trim() : "";
    if (!isAllowedProviderImageUri(sourceUri)) {
      throw new UserVisibleError("Bild nicht gefunden.", 404);
    }

    const apiKey = process.env.WEKNORA_API_KEY?.trim();
    if (!apiKey) {
      throw new UserVisibleError("Bilderabruf ist derzeit nicht konfiguriert.", 503);
    }

    const upstreamUrl = new URL("https://taxdog.cloud/api/v1/files");
    upstreamUrl.searchParams.set("file_path", sourceUri);

    let upstreamResponse: Response;
    try {
      upstreamResponse = await runWithTimeout(
        (signal) => fetch(upstreamUrl.toString(), {
          method: "GET",
          headers: {
            "X-API-Key": apiKey,
            Accept: "image/*",
          },
          cache: "no-store",
          redirect: "error",
          signal,
        }),
        {
          timeoutMs: UPSTREAM_FETCH_TIMEOUT_MS,
          timeoutMessage: "Bilderabruf hat zu lange gedauert.",
        },
      );
    } catch (fetchError) {
      if (fetchError instanceof UserVisibleError) throw fetchError;
      throw new UserVisibleError("Bilderabruf fehlgeschlagen.", 502);
    }

    if (!upstreamResponse.ok) {
      if (upstreamResponse.status === 404) {
        throw new UserVisibleError("Bild nicht gefunden.", 404);
      }
      if (upstreamResponse.status === 429) {
        throw new UserVisibleError("Bilderabruf ist derzeit überlastet.", 429);
      }
      throw new UserVisibleError("Bilderabruf vom Server fehlgeschlagen.", 502);
    }

    const declaredLength = Number(upstreamResponse.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_FETCH_BYTES) {
      throw new UserVisibleError("Das Bild überschreitet das Limit von 10 MB.", 413);
    }

    if (!upstreamResponse.body) {
      throw new UserVisibleError("Ungültige Antwort beim Bilderabruf.", 502);
    }

    const reader = upstreamResponse.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_IMAGE_FETCH_BYTES) {
          await reader.cancel();
          throw new UserVisibleError("Das Bild überschreitet das Limit von 10 MB.", 413);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    const fullBytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      fullBytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const mimeType = upstreamResponse.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase() ?? "";
    if (!ALLOWED_IMAGE_MIMES.has(mimeType)) {
      throw new UserVisibleError("Ungültiger Bildtyp.", 502);
    }

    if (!hasExpectedSignature(fullBytes, mimeType)) {
      throw new UserVisibleError("Bildinhalt stimmt nicht mit dem Dateityp überein.", 502);
    }

    const safeFilename = sanitizedFilename(artifact.original_name || "image");
    const asciiFallback = mimeType === "image/jpeg" ? "image.jpg" : `image.${mimeType.slice("image/".length)}`;
    const encodedFilename = encodeURIComponent(safeFilename)
      .replace(/['()]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

    return new Response(fullBytes, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(fullBytes.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `inline; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`,
      },
    });
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return jsonError(error.message, error.status);
    }
    return jsonError("Bild konnte nicht geladen werden.", 500);
  }
}
