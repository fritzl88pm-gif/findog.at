import { authenticateSupabaseRequest } from "@/lib/auth/server";
import {
  DOWNLOAD_BUCKET,
  downloadContentDisposition,
  downloadDisplayFilename,
  requireDownloadUuid,
} from "@/lib/downloads";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type DownloadRow = {
  storage_path: string;
  title: string;
  file_extension: string;
  mime_type: string;
  file_size: number;
};

function errorResponse(error: unknown): Response {
  const status = error instanceof UserVisibleError ? error.status : 500;
  const message = error instanceof UserVisibleError
    ? error.message
    : "Das Dokument konnte nicht heruntergeladen werden.";
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}

export async function GET(
  request: Request,
  routeContext: { params: Promise<{ documentId: string }> },
) {
  try {
    const { documentId: rawDocumentId } = await routeContext.params;
    const documentId = requireDownloadUuid(rawDocumentId, "Die Dokument-ID");
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Downloads sind derzeit nicht verfügbar.", 503);
    }
    await authenticateSupabaseRequest(request, supabase);

    const { data, error } = await supabase
      .from("download_documents")
      .select("storage_path,title,file_extension,mime_type,file_size")
      .eq("id", documentId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) {
      throw new UserVisibleError("Das Dokument konnte nicht geladen werden.", 503);
    }
    if (!data) {
      throw new UserVisibleError("Das Dokument wurde nicht gefunden.", 404);
    }

    const document = data as DownloadRow;
    const { data: file, error: downloadError } = await supabase.storage
      .from(DOWNLOAD_BUCKET)
      .download(document.storage_path);
    if (downloadError || !file) {
      throw new UserVisibleError("Die Datei ist derzeit nicht verfügbar.", 503);
    }

    const filename = downloadDisplayFilename(document.title, document.file_extension);
    return new Response(file.stream(), {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": downloadContentDisposition(filename),
        "Content-Length": String(document.file_size),
        "Content-Type": document.mime_type,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
