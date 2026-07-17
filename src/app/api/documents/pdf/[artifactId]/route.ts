import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { renderChatPdf } from "@/lib/documents/pdf";
import { UserVisibleError } from "@/lib/errors";
import { formatViennaDate } from "@/lib/forms/values";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type ArtifactRow = {
  title: string;
  filename: string;
  content_markdown: string;
  content_sha256: string;
};

function safeErrorDetails(error: unknown): Record<string, string> {
  if (error instanceof Error) {
    return { name: error.name.slice(0, 100), message: error.message.slice(0, 500) };
  }
  return { message: String(error).slice(0, 500) };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ artifactId: string }> },
) {
  try {
    const { artifactId } = await context.params;
    if (!uuidPattern.test(artifactId)) {
      throw new UserVisibleError("Dokument wurde nicht gefunden.", 404);
    }

    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Das Dokument ist derzeit nicht verfügbar.", 503);
    }
    const user = await authenticateSupabaseRequest(request, supabase);
    const { data, error } = await supabase
      .from("document_artifacts")
      .select("title,filename,content_markdown,content_sha256")
      .eq("id", artifactId)
      .eq("client_id", user.id)
      .eq("kind", "pdf")
      .maybeSingle();
    if (error) {
      throw new UserVisibleError("Das Dokument konnte nicht geladen werden.", 503);
    }
    if (!data) {
      throw new UserVisibleError("Dokument wurde nicht gefunden.", 404);
    }

    const artifact = data as ArtifactRow;
    const digest = createHash("sha256").update(artifact.content_markdown, "utf8").digest("hex");
    if (digest !== artifact.content_sha256) {
      console.error("PDF artifact integrity check failed", { artifactId });
      throw new UserVisibleError("Das Dokument konnte nicht sicher erstellt werden.", 409);
    }

    let pdf: Uint8Array;
    try {
      pdf = await renderChatPdf({
        title: artifact.title,
        content: artifact.content_markdown,
        date: formatViennaDate(),
      });
    } catch (error) {
      console.error("Stored PDF rendering failed", safeErrorDetails(error));
      throw new UserVisibleError("Das PDF konnte nicht erstellt werden. Bitte später erneut versuchen.", 500);
    }

    return new Response(Uint8Array.from(pdf).buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${artifact.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Stored PDF route failed", safeErrorDetails(error));
    return NextResponse.json(
      { error: "Das PDF konnte nicht erstellt werden. Bitte später erneut versuchen." },
      { status: 500 },
    );
  }
}
